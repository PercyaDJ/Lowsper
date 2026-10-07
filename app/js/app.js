/*
 * Lowsper : contrôleur de l'interface.
 *
 * États : idle -> recording -> finishing -> done -> idle
 * Le moteur se prépare dès l'ouverture de la page, en arrière-plan. On peut lancer
 * l'enregistrement avant qu'il soit prêt : les segments attendent dans la file.
 */
(function () {
  'use strict';

  const L = window.Lowsper;
  // Les éléments de la mini-fenêtre changent de document : on garde des références directes.
  const cache = new Map();
  const $ = (id) => {
    let el = cache.get(id);
    if (!el || (!el.isConnected && document.getElementById(id))) {
      el = document.getElementById(id);
      if (el) cache.set(id, el);
    }
    return el;
  };

  const AI_PROMPT =
    "Voici le transcript automatique d'une réunion (il peut contenir des erreurs de reconnaissance). " +
    'Rédige un compte rendu structuré en français : contexte et participants identifiables, ' +
    'points abordés, décisions prises, actions à mener (qui, quoi, échéance), questions ouvertes. ' +
    "N'invente rien : si un passage est incompréhensible ou ambigu, signale-le.\n\n---\n\n";

  const app = {
    state: 'idle',
    workers: [],
    engineReady: false,
    engineError: null,
    modelLabel: '',
    queue: [], // { source, seg }
    inFlight: 0,
    transcript: null,
    capture: null,
    pausedAt: null,
    timer: null,
    wakeLock: null,
    finalMarkdown: '',
  };
  window.LowsperApp = app; // utile pour le diagnostic et les tests

  // ---------------------------------------------------------------------------
  // Moteur
  // ---------------------------------------------------------------------------

  function setEngine(state, text) {
    $('engine').dataset.state = state;
    $('engine-text').textContent = text;
  }

  async function bootEngine() {
    const problem = checkBrowser();
    if (problem) {
      app.engineError = problem;
      setEngine('error', 'Navigateur non compatible');
      toast(problem, 10000);
      return;
    }
    const installed = self.LOWSPER_INSTALLED || [];
    if (!installed.length) {
      setEngine('idle', 'Modèle à installer');
      showInstall();
      return;
    }
    try {
      const preferred = store.get('lowsper.model');
      const model = installed.find((m) => m.id === preferred) || installed[0];
      app.modelLabel = model.label;
      $('foot-model').textContent = model.label;
      renderModelSelect(installed, model.id);

      const assets = await L.loadAssets((r) => setEngine('loading', `Préparation du moteur ${Math.round(r * 100)} %`), model.id);
      setEngine('loading', 'Démarrage du moteur');

      // Analyse audio : détection de parole (Silero) et empreintes vocales (WeSpeaker)
      if (assets.analysis) {
        try {
          app.analyzer = new L.Analyzer(assets.analysis);
          await app.analyzer.ready;
        } catch (e) {
          console.warn("Analyse audio indisponible, repli sur la détection par volume", e);
          app.analyzer = null;
        }
      }
      // Plusieurs moteurs en parallèle si la machine le permet : chaque moteur utilise un cœur
      // du processeur ; avec la carte graphique (WebGPU), un seul moteur suffit.
      app.workers.push(...createWorkers(assets));
      await Promise.all(app.workers.map((w) => w.ready));
      app.engineReady = true;
      setEngine('ready', 'Moteur prêt');
      pump();
    } catch (err) {
      console.error(err);
      app.engineError = String(err.message || err);
      setEngine('error', 'Moteur indisponible');
      toast('Le moteur de transcription n\'a pas pu démarrer : ' + app.engineError, 12000);
    }
  }

  function workerCount(device) {
    if (device === 'webgpu') return 1;
    const cores = navigator.hardwareConcurrency || 2;
    const memory = navigator.deviceMemory || 8; // plafonné à 8 par Chrome
    let n = Math.max(1, Math.min(3, Math.floor(cores / 2)));
    if (memory < 8) n = Math.min(n, 2);
    if (memory < 4) n = 1;
    return n;
  }

  function createWorkers(assets) {
    const list = [];
    for (let i = 0; i < workerCount(assets.device); i++) {
      const w = new L.Transcriber(assets);
      w.idle = true;
      list.push(w);
    }
    return list;
  }

  // Un moteur est libre et rien n'attend : les blocs partent dès la fin d'une phrase
  function engineIdle() {
    return app.engineReady && app.queue.length === 0 && app.workers.some((w) => w.idle);
  }

  function checkBrowser() {
    if (!window.WebAssembly || !window.Worker || !window.Blob) {
      return 'Ce navigateur est trop ancien. Utilisez Microsoft Edge ou Google Chrome à jour.';
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return "Ce navigateur n'autorise pas l'accès au micro depuis un fichier local. Utilisez Microsoft Edge ou Google Chrome.";
    }
    return null;
  }

  // File de transcription : le segment le plus ancien part vers le premier moteur libre.
  function pump() {
    if (!app.engineReady) return updateQueue();
    for (const w of app.workers) {
      if (!w.idle || !app.queue.length) continue;
      app.queue.sort((a, b) => a.seg.start - b.seg.start);
      const job = app.queue.shift();
      w.idle = false;
      app.inFlight++;
      const lang = job.transcript.meta.language === 'auto' ? ['fr', 'en'] : job.transcript.meta.language;
      // Copie de l'audio pour l'analyse des voix (l'original est transféré au moteur)
      const tracker = job.source === 'others' ? job.transcript.tracker : null;
      job.dur = job.seg.audio.length / 16000;
      const keep = tracker ? job.seg.audio.slice() : null;
      w.transcribe(job.seg.audio, lang, job.transcript.meta.glossary, (job.seg.map || []).map((m) => m.at))
        .then(async (res) => {
          recordLoad(res.ms || 0, job.dur);
          let voices = null;
          if (tracker) {
            try {
              voices = await tracker.label(keep, res.chunks, job.seg);
            } catch (e) {
              console.warn('Distinction des voix impossible pour ce passage', e);
            }
          }
          job.transcript.addSegment(job.source, job.seg, res, voices);
        })
        .catch((err) => console.error('Segment non transcrit', err))
        .finally(() => {
          w.idle = true;
          app.inFlight--;
          pump();
        });
    }
    updateQueue();
  }

  // Charge du moteur : temps de calcul / durée d'audio, sur les derniers passages
  app.loadSamples = [];
  app.behindSince = null;
  function recordLoad(ms, dur) {
    app.loadSamples.push({ ms, dur: dur || 1, at: Date.now() });
    if (app.loadSamples.length > 12) app.loadSamples.shift();
  }
  function engineLoad() {
    const s = app.loadSamples;
    if (!s.length) return null;
    const ms = s.reduce((n, x) => n + x.ms, 0);
    const dur = s.reduce((n, x) => n + x.dur, 0);
    return ms / 1000 / dur / Math.max(1, app.workers.length);
  }

  function pendingCount() {
    return app.queue.length + app.inFlight;
  }

  function updateQueue() {
    const n = pendingCount();
    let text = '';
    if (app.state === 'recording') {
      if (!app.engineReady && !app.engineError) text = 'Le moteur termine sa préparation, la transcription démarrera dans un instant.';
      else if (n === 0) text = 'Transcription à jour.';
      else if (n === 1) text = 'Transcription en cours…';
      else text = `${n} passages en attente de transcription.`;
      const load = engineLoad();
      if (load != null) text += ` Charge du moteur : ${Math.round(load * 100)} %.`;
      // Retard durable : le PC ne suit pas le rythme de la réunion
      if (n >= 4) {
        app.behindSince = app.behindSince || Date.now();
        if (Date.now() - app.behindSince > 120000 && !app.warnedSlow) {
          app.warnedSlow = true;
          notice(
            "Ce PC ne suit pas le rythme de la réunion : rien n'est perdu, mais la fin du transcript arrivera après la réunion. " +
              'Pour les prochaines fois, installez un modèle plus rapide (Options, « Installer un autre modèle »).'
          );
        }
      } else {
        app.behindSince = null;
      }
    }
    $('queue').textContent = text;
    if (app.state === 'finishing') {
      $('finish-text').textContent = !app.engineReady
        ? 'Le moteur termine sa préparation…'
        : n > 1
          ? `${n} passages restants…`
          : 'Transcription des dernières phrases…';
    }
  }

  // ---------------------------------------------------------------------------
  // Démarrage
  // ---------------------------------------------------------------------------

  async function start() {
    if (app.state !== 'idle' || $('start').disabled) return;
    if (app.engineError && !app.engineReady) {
      toast('Le moteur de transcription est indisponible : ' + app.engineError, 8000);
      return;
    }
    const withOthers = $('with-others').checked && !!navigator.mediaDevices.getDisplayMedia;
    $('start').disabled = true;

    // 1. Partage d'écran EN PREMIER : le navigateur exige qu'il suive directement le clic.
    let others = null;
    let othersError = null;
    if (withOthers) {
      try {
        others = await L.getSystemAudio();
      } catch (err) {
        othersError = err;
      }
    }

    // 2. Micro
    let mic = null;
    let micError = null;
    try {
      mic = await L.getMicrophone();
    } catch (err) {
      micError = err;
    }

    if (!mic && !others) {
      $('start').disabled = false;
      toast(micError && micError.name === 'NotAllowedError'
        ? "L'accès au micro a été refusé. Autorisez-le dans la barre d'adresse puis réessayez."
        : 'Aucune source audio disponible : ' + ((micError || othersError || {}).message || 'erreur inconnue'), 9000);
      return;
    }

    L.Transcript.clearSaved();
    $('recover').hidden = true;
    app.warnedSlow = false;
    app.behindSince = null;
    app.loadSamples = [];
    app.transcript = new L.Transcript({
      title: $('title').value.trim(),
      startedAt: Date.now(),
      language: $('language').value,
      glossary: $('glossary').value.trim(),
      model: app.modelLabel,
      sources: [],
    });
    app.transcript.onChange(renderLive);
    if (app.analyzer && app.analyzer.hasSpeaker && $('distinguish').checked) {
      app.transcript.tracker = new L.SpeakerTracker(app.analyzer);
    }

    app.capture = new L.Capture(
      (source, seg) => {
        app.queue.push({ source, seg, transcript: app.transcript });
        pump();
      },
      { analyzer: app.analyzer, emitEarly: engineIdle }
    );
    await app.capture.init();
    if (mic) attachSource('me', mic);
    if (others) attachSource('others', others);

    setState('recording');
    renderLive();
    setMeter('me', mic ? 'on' : 'off');
    setMeter('others', others ? 'on' : 'off');
    if (!mic) notice("Micro indisponible : seule la voix des participants est transcrite.");
    else if (withOthers && !others) explainOthersError(othersError);
    else if (!withOthers) notice('Seul votre micro est capté (option « participants » désactivée).');

    app.timer = setInterval(tick, 100);
    requestWakeLock();
  }

  function attachSource(id, stream) {
    app.capture.attach(id, stream);
    if (!app.transcript.meta.sources.includes(id)) app.transcript.meta.sources.push(id);
    const track = stream.getAudioTracks()[0];
    if (track) {
      track.addEventListener('ended', () => {
        if (app.state !== 'recording' || !app.capture || !app.capture.sources[id]) return;
        app.capture.detach(id);
        setMeter(id, 'off');
        notice(id === 'others'
          ? "Le partage audio a été arrêté : la voix des participants n'est plus captée. "
          : "Le micro a été déconnecté : votre voix n'est plus captée. ", id);
      });
    }
  }

  function explainOthersError(err) {
    let msg;
    if (err && err.code === 'NO_AUDIO') {
      msg = "Le partage ne contient pas de son : la case « Partager l'audio » n'était pas cochée. ";
    } else if (err && err.name === 'NotAllowedError') {
      msg = 'Partage annulé : seule votre voix est captée. ';
    } else {
      msg = "Le son des participants n'a pas pu être capté (" + ((err && err.message) || 'erreur inconnue') + '). ';
    }
    notice(msg, 'others');
  }

  // Relance du partage audio en cours de réunion (nécessite un clic : on est dans un handler)
  async function retryOthers() {
    try {
      const stream = await L.getSystemAudio();
      attachSource('others', stream);
      setMeter('others', 'on');
      $('rec-notice').hidden = true;
      toast('Son des participants capté.');
    } catch (err) {
      explainOthersError(err);
    }
  }

  function notice(text, retryFor) {
    const el = $('rec-notice');
    el.textContent = text;
    if (retryFor === 'others' && navigator.mediaDevices.getDisplayMedia) {
      const b = document.createElement('button');
      b.textContent = 'Partager le son des participants';
      b.addEventListener('click', retryOthers);
      el.appendChild(b);
    }
    el.hidden = false;
  }

  function setMeter(id, mode) {
    const el = $('meter-' + id);
    el.classList.toggle('off', mode === 'off');
    const state = el.querySelector('.state');
    state.textContent = '';
    if (mode === 'off') {
      if (id === 'others' && navigator.mediaDevices.getDisplayMedia) {
        const b = document.createElement('button');
        b.textContent = 'non capté, activer';
        b.addEventListener('click', retryOthers);
        state.appendChild(b);
      } else {
        state.textContent = 'non capté';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Pendant l'enregistrement
  // ---------------------------------------------------------------------------

  function tick() {
    if (!app.capture) return;
    const t = app.capture.now();
    $('timer').textContent = L.formatTime(t);
    for (const id of ['me', 'others']) {
      const el = $('meter-' + id);
      const on = !!app.capture.sources[id];
      el.querySelector('.bar i').style.width = on ? Math.round(app.capture.level(id) * 100) + '%' : '0';
      el.classList.toggle('speaking', on && app.capture.isSpeaking(id));
      if (on) el.querySelector('.state').textContent = app.capture.isSpeaking(id) ? 'parle' : '';
    }
  }

  function togglePause() {
    if (!app.capture) return;
    const paused = !app.capture.paused;
    app.capture.setPaused(paused);
    if (paused) {
      app.pausedAt = app.capture.now();
    } else if (app.pausedAt != null) {
      app.transcript.addPause(app.pausedAt, app.capture.now());
      app.pausedAt = null;
    }
    $('pause').textContent = paused ? 'Reprendre' : 'Pause';
    $('rec-label').textContent = paused ? 'En pause' : 'Enregistrement';
    $('rec-status').classList.toggle('paused', paused);
  }

  function renderLive() {
    if (!app.transcript || app.state === 'idle') return;
    const box = $('live');
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    const paras = app.transcript.paragraphs().slice(-60);
    if (!paras.length) {
      box.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'placeholder';
      p.textContent = 'Le transcript apparaîtra ici au fil de la réunion.';
      box.appendChild(p);
      return;
    }
    const frag = document.createDocumentFragment();
    for (const para of paras) {
      const p = document.createElement('p');
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = L.formatTime(para.start);
      const s = document.createElement('span');
      s.className = 's ' + para.source;
      s.textContent = app.transcript.speakerName(para) + ' :';
      p.append(t, s, document.createTextNode(para.text));
      frag.appendChild(p);
    }
    box.replaceChildren(frag);
    if (nearBottom) box.scrollTop = box.scrollHeight;
    const lastPara = paras[paras.length - 1];
    $('last-line').textContent = lastPara ? `${app.transcript.speakerName(lastPara)} : ${lastPara.text}` : '';
  }

  // ---------------------------------------------------------------------------
  // Fin de réunion
  // ---------------------------------------------------------------------------

  async function stop() {
    if (app.state !== 'recording') return;
    if (app.capture.paused && app.pausedAt != null) {
      app.transcript.meta.pauses.push({ from: app.pausedAt, to: app.capture.now() });
      app.pausedAt = null;
    }
    app.transcript.meta.endedAt = Date.now();
    clearInterval(app.timer);
    if (app.pip) closePip();
    setState('finishing');
    await app.capture.stop(); // termine les segments en cours -> file d'attente
    app.capture = null;
    releaseWakeLock();
    pump();

    await new Promise((resolve) => {
      const check = () => (pendingCount() === 0 && app.engineReady) || app.engineError ? resolve() : setTimeout(check, 200);
      check();
    });

    if (app.transcript.tracker) {
      $('finish-text').textContent = 'Identification des intervenants…';
      await new Promise((r) => setTimeout(r, 30)); // laisse l'affichage se mettre à jour
      try {
        app.transcript.applyVoiceMap(app.transcript.tracker.finalize());
      } catch (e) {
        console.warn('Regroupement final des voix impossible', e);
      }
    }
    app.transcript.emit(); // dernière sauvegarde, marquée comme terminée
    app.finalMarkdown = app.transcript.toMarkdown();
    const paras = app.transcript.paragraphs().length;
    const minutes = Math.max(1, Math.round((app.transcript.meta.endedAt - app.transcript.meta.startedAt) / 60000));
    $('done-info').textContent = `${minutes} min de réunion, ${paras} intervention${paras > 1 ? 's' : ''}. Le fichier a été enregistré dans votre dossier Téléchargements.`;
    $('preview').textContent = app.finalMarkdown;
    renderVoices();
    setState('done');
    download(app.finalMarkdown, app.transcript.fileName());
  }

  // Écran de fin : renommer les intervenants détectés
  function renderVoices() {
    const t = app.transcript;
    const list = t ? t.voiceSummary() : [];
    $('voices').hidden = !list.length;
    const box = $('voice-list');
    box.replaceChildren();
    for (const v of list) {
      const row = document.createElement('div');
      row.className = 'voice-row';
      const label = document.createElement('div');
      label.className = 'vlabel';
      label.textContent = v.label;
      const small = document.createElement('small');
      const talk = v.seconds < 90 ? `${Math.round(v.seconds)} s` : `${Math.round(v.seconds / 60)} min`;
      small.textContent = `${talk} de parole · dès ${L.formatTime(v.at)}`;
      label.appendChild(small);
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 60;
      input.placeholder = 'Nom (facultatif)';
      input.value = (t.meta.names && t.meta.names[v.voice]) || '';
      input.addEventListener('input', () => {
        t.nameVoice(v.voice, input.value);
        app.finalMarkdown = t.toMarkdown();
        $('preview').textContent = app.finalMarkdown;
      });
      const sample = document.createElement('div');
      sample.className = 'vsample';
      sample.textContent = '« ' + v.sample + ' »';
      sample.title = v.sample;
      row.append(label, input, sample);
      box.appendChild(row);
    }
  }

  function reset() {
    L.Transcript.clearSaved();
    app.transcript = null;
    app.finalMarkdown = '';
    $('title').value = '';
    $('start').disabled = false;
    $('pause').textContent = 'Pause';
    $('rec-label').textContent = 'Enregistrement';
    $('rec-status').classList.remove('paused');
    $('rec-notice').hidden = true;
    $('timer').textContent = '00:00:00';
    setState('idle');
  }

  // ---------------------------------------------------------------------------
  // Utilitaires
  // ---------------------------------------------------------------------------

  function setState(state) {
    app.state = state;
    $('view-install').hidden = state !== 'install';
    $('view-idle').hidden = state !== 'idle';
    $('view-rec').hidden = state !== 'recording';
    $('view-finish').hidden = state !== 'finishing';
    $('view-done').hidden = state !== 'done';
    updateQueue();
  }

  function download(text, name) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('Copié dans le presse-papiers.');
  }

  let toastTimer = null;
  function toast(text, ms) {
    const el = $('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), ms || 3000);
  }

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) app.wakeLock = await navigator.wakeLock.request('screen');
    } catch {}
  }
  function releaseWakeLock() {
    try {
      if (app.wakeLock) app.wakeLock.release();
    } catch {}
    app.wakeLock = null;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && app.state === 'recording') requestWakeLock();
  });

  window.addEventListener('beforeunload', (e) => {
    if (app.state === 'recording' || app.state === 'finishing' || app.installing) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Session interrompue (navigateur fermé pendant une réunion)
  function checkRecovery() {
    const saved = L.Transcript.loadUnfinished();
    if (!saved) return;
    const d = new Date(saved.meta.startedAt);
    const last = saved.lines[saved.lines.length - 1];
    $('recover-info').textContent =
      `${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}, ` +
      `${Math.max(1, Math.round((last ? last.end : 0) / 60))} min transcrites`;
    $('recover').hidden = false;
    $('recover-download').addEventListener('click', () => {
      saved.meta.endedAt = saved.meta.startedAt + Math.round((last ? last.end : 0) * 1000);
      download(saved.toMarkdown(), saved.fileName());
    });
    $('recover-dismiss').addEventListener('click', () => {
      L.Transcript.clearSaved();
      $('recover').hidden = true;
    });
  }

  // ---------------------------------------------------------------------------
  // Mini-fenêtre (Document Picture-in-Picture : Edge et Chrome récents)
  // ---------------------------------------------------------------------------

  app.pip = null;

  async function openPip() {
    if (app.pip || app.state !== 'recording') return;
    if (!('documentPictureInPicture' in window)) {
      toast("Ce navigateur ne propose pas de mini-fenêtre. Astuce : réduisez la fenêtre de Lowsper, l'affichage devient compact.", 7000);
      return;
    }
    let win;
    try {
      win = await window.documentPictureInPicture.requestWindow({ width: 360, height: 250 });
    } catch (e) {
      toast("La mini-fenêtre n'a pas pu s'ouvrir : " + e.message, 6000);
      return;
    }
    // Même feuille de style (fichier local : autorisé par la politique de sécurité)
    const link = win.document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('app/css/lowsper.css', location.href).href;
    win.document.head.appendChild(link);
    win.document.title = 'Lowsper';
    win.document.body.className = 'pip';
    win.document.body.appendChild($('rec-core'));
    $('pip-placeholder').hidden = false;
    app.pip = win;
    win.addEventListener('pagehide', closePip, { once: true });
  }

  function closePip() {
    const core = app.pip && app.pip.document.getElementById('rec-core');
    const view = $('view-rec');
    view.insertBefore(core || $('rec-core'), view.firstChild);
    $('pip-placeholder').hidden = true;
    const w = app.pip;
    app.pip = null;
    try {
      if (w && !w.closed) w.close();
    } catch {}
  }

  // Ouverture automatique quand on change d'onglet, si le navigateur le permet
  // (Chrome récent, pour les pages qui utilisent le micro).
  try {
    if (navigator.mediaSession && navigator.mediaSession.setActionHandler) {
      navigator.mediaSession.setActionHandler('enterpictureinpicture', () => {
        if (app.state === 'recording') openPip();
      });
    }
  } catch {}

  // ---------------------------------------------------------------------------
  // Installation du modèle (premier lancement)
  // ---------------------------------------------------------------------------

  const store = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch {}
    },
  };

  function showInstall() {
    const catalog = (self.LOWSPER_MANIFEST && self.LOWSPER_MANIFEST.catalog) || [];
    const installed = self.LOWSPER_INSTALLED || [];
    const box = $('model-choices');
    box.replaceChildren();
    let firstChecked = false;
    catalog.forEach((m) => {
      const mb = Math.round(m.files.reduce((n, f) => n + f.size, 0) / 1e6);
      const needsGpu = m.device === 'webgpu';
      const gpuMissing = needsGpu && !app.gpu;
      const label = document.createElement('label');
      label.className = 'model-opt';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'model-choice';
      input.value = m.id;
      input.disabled = gpuMissing;
      input.checked = !firstChecked && !gpuMissing && (m.recommended || !catalog.some((x) => x.recommended));
      if (input.checked) firstChecked = true;
      if (gpuMissing) label.classList.add('disabled');
      const title = document.createElement('strong');
      title.textContent = m.label;
      if (m.recommended) {
        const b = document.createElement('span');
        b.className = 'badge';
        b.textContent = 'recommandé';
        title.appendChild(b);
      }
      if (installed.some((x) => x.id === m.id)) {
        const b = document.createElement('span');
        b.className = 'badge';
        b.textContent = 'installé';
        title.appendChild(b);
      }
      const size = document.createElement('span');
      size.className = 'size';
      size.textContent = `${mb} Mo`;
      const desc = document.createElement('span');
      desc.className = 'desc';
      desc.textContent =
        (m.description || '') +
        (gpuMissing ? ' Aucune carte graphique compatible (WebGPU) détectée sur ce PC.' : needsGpu && app.gpu ? ` Carte détectée : ${app.gpu.description || app.gpu.vendor || 'compatible'}.` : '');
      label.append(input, title, size, desc);
      box.appendChild(label);
    });
    $('install-back').hidden = !installed.length;
    $('page-folder').textContent = L.pageFolder();
    $('temp-warning').hidden = !L.openedFromTemp();
    $('install-error').hidden = true;
    setState('install');
  }

  async function install() {
    if (app.installing) return;
    const catalog = self.LOWSPER_MANIFEST.catalog;
    const choice = document.querySelector('input[name="model-choice"]:checked');
    const entry = catalog.find((m) => m.id === (choice && choice.value)) || catalog[0];
    const err = $('install-error');
    err.hidden = true;
    if (!L.canInstall()) {
      err.textContent =
        "Ce navigateur ne permet pas d'enregistrer le modèle dans un dossier. Ouvrez Lowsper.html avec Microsoft Edge ou Google Chrome.";
      err.hidden = false;
      return;
    }
    let folder;
    try {
      folder = await L.pickLowsperFolder(); // doit suivre immédiatement le clic
    } catch (e) {
      if (e.code !== 'CANCELLED') {
        err.textContent = e.message;
        err.hidden = false;
      }
      return;
    }
    app.installing = true;
    $('install').disabled = true;
    document.querySelectorAll('input[name="model-choice"]').forEach((i) => (i.disabled = true));
    $('install-progress').hidden = false;
    setEngine('loading', 'Téléchargement du modèle');
    const t0 = performance.now();
    try {
      await L.installModel(folder, entry, (p) => {
        $('install-bar').style.width = (p.ratio * 100).toFixed(1) + '%';
        const secs = (performance.now() - t0) / 1000;
        const speed = p.done / 1e6 / Math.max(secs, 0.1);
        const left = speed > 0 ? Math.round((p.total - p.done) / 1e6 / speed) : 0;
        $('install-text').textContent =
          `${Math.round(p.done / 1e6)} / ${Math.round(p.total / 1e6)} Mo · ${speed.toFixed(1)} Mo/s` +
          (left > 2 ? ` · environ ${left > 90 ? Math.round(left / 60) + ' min' : left + ' s'} restantes` : '');
      });
      store.set('lowsper.model', entry.id);
      $('install-text').textContent = 'Modèle installé. Démarrage…';
      app.installing = false;
      setTimeout(() => location.reload(), 400);
    } catch (e) {
      console.error(e);
      app.installing = false;
      $('install').disabled = false;
      document.querySelectorAll('input[name="model-choice"]').forEach((i) => (i.disabled = false));
      $('install-progress').hidden = true;
      setEngine('error', 'Installation interrompue');
      let msg = e.message || String(e);
      if (e.code === 'NETWORK' || e.code === 'HTTP') {
        msg +=
          " Le réseau de l'entreprise bloque peut-être ce site. Essayez depuis un autre réseau (partage de connexion, domicile), " +
          "ou copiez le dossier Lowsper d'un collègue qui l'a déjà installé.";
      }
      err.textContent = msg;
      err.hidden = false;
    }
  }

  function renderModelSelect(installed, current) {
    const sel = $('model');
    sel.replaceChildren();
    for (const m of installed) {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.label;
      o.selected = m.id === current;
      sel.appendChild(o);
    }
    $('model-field').hidden = installed.length < 2;
  }

  // ---------------------------------------------------------------------------
  // Branchements
  // ---------------------------------------------------------------------------

  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    $('with-others').checked = false;
    $('with-others').disabled = true;
    $('with-others').parentElement.title = "Ce navigateur ne permet pas de capter le son d'une autre application.";
  }

  $('install').addEventListener('click', install);
  $('install-back').addEventListener('click', () => setState('idle'));
  $('add-model').addEventListener('click', showInstall);
  $('model').addEventListener('change', (e) => {
    store.set('lowsper.model', e.target.value);
    location.reload();
  });
  $('glossary').value = store.get('lowsper.glossary') || '';
  $('glossary').addEventListener('input', (e) => store.set('lowsper.glossary', e.target.value));
  $('start').addEventListener('click', start);
  $('pause').addEventListener('click', togglePause);
  $('stop').addEventListener('click', stop);
  $('download').addEventListener('click', () => download(app.finalMarkdown, app.transcript.fileName()));
  $('copy').addEventListener('click', () => copy(app.finalMarkdown));
  $('copy-ai').addEventListener('click', () => copy(AI_PROMPT + app.finalMarkdown));
  $('again').addEventListener('click', reset);
  $('next-meeting').addEventListener('click', () => {
    reset();
    start(); // le clic sert de geste utilisateur pour le partage d'écran
  });
  $('pip').addEventListener('click', openPip);
  $('pip-back').addEventListener('click', closePip);
  $('title').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') start();
  });

  checkRecovery();
  L.detectWebGPU().then((gpu) => {
    app.gpu = gpu;
    if (app.state === 'install') showInstall();
  });
  bootEngine();
})();
