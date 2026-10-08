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
      $('model-current').textContent = 'Aucun modèle installé pour l’instant.';
      showInstall();
      return;
    }
    try {
      const preferred = store.get('lowsper.model');
      const model = installed.find((m) => m.id === preferred) || installed[0];
      app.modelLabel = model.label;
      app.modelId = model.id;
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
      // Moteurs : chaque moteur occupe un cœur du processeur pendant qu'il transcrit.
      // On en démarre quelques-uns ; d'autres sont ajoutés en renfort si du retard s'accumule.
      app.mainAssets = assets;
      app.limits = computeLimits(assets.device);
      for (let i = 0; i < app.limits.start; i++) app.workers.push(newWorker(assets));
      await Promise.all(app.workers.map((w) => w.ready));
      app.engineReady = true;
      setEngine('ready', 'Moteur prêt');
      pump();
      // Voie rapide de secours (Whisper base), si installé et si le modèle principal est plus lent
      const fastModel = installed.find((m) => m.id === 'whisper-base');
      if (fastModel && model.id !== 'whisper-base' && assets.device !== 'webgpu') {
        L.loadAssets(null, fastModel.id)
          .then((fa) => {
            const w = newWorker(fa);
            app.fastWorkers.push(w);
            return w.ready;
          })
          .then(() => pump())
          .catch((e) => console.warn('Voie rapide indisponible', e));
      }
      // Première utilisation de ce modèle sur ce PC : mesure automatique de la vitesse
      const known = store.get('lowsper.speed.' + model.id);
      if (known) {
        try {
          const k = JSON.parse(known);
          $('speed-result').textContent = `Dernière mesure : charge estimée ${Math.round(k.load * 100)} % pour une réunion où l'on parle sans arrêt.`;
        } catch {}
      } else if (app.state !== 'recording') {
        speedTest(true);
      }
    } catch (err) {
      console.error(err);
      app.engineError = String(err.message || err);
      setEngine('error', 'Moteur indisponible');
      toast('Le moteur de transcription n\'a pas pu démarrer : ' + app.engineError, 12000);
    }
  }

  // ---------------------------------------------------------------------------
  // Puissance de calcul
  //
  // Un moteur qui transcrit occupe un cœur à 100 %. Sur un portable à 6 cœurs / 12 fils qui fait
  // tourner en même temps Teams, Office, Outlook..., on limite le nombre de moteurs actifs :
  //   - économe    : 1 moteur ;
  //   - équilibrée : 1/4 des fils en temps normal, 1/3 en renfort si du retard s'accumule ;
  //   - maximale   : la moitié des fils.
  // Avec la carte graphique (WebGPU), un seul moteur suffit (le GPU traite les calculs en série).
  // ---------------------------------------------------------------------------

  app.fastWorkers = [];
  app.drafts = []; // passages transcrits par la voie rapide, à améliorer
  app.blockSeq = 0;

  function computeLimits(device) {
    if (device === 'webgpu') return { start: 1, normal: 1, boost: 1, max: 1 };
    const threads = navigator.hardwareConcurrency || 4;
    const memory = navigator.deviceMemory || 8; // plafonné à 8 par Chrome
    const memCap = memory < 4 ? 1 : memory < 8 ? 2 : 6;
    const clamp = (n) => Math.max(1, Math.min(memCap, n));
    const power = store.get('lowsper.power') || 'balanced';
    if (power === 'eco') return { start: 1, normal: 1, boost: 1, max: 1 };
    if (power === 'max') {
      const n = clamp(Math.floor(threads / 2));
      return { start: Math.min(n, 3), normal: n, boost: n, max: n };
    }
    const normal = clamp(Math.ceil(threads / 4));
    const boost = clamp(Math.max(normal, Math.floor(threads / 3)));
    return { start: normal, normal, boost, max: boost };
  }

  function newWorker(assets) {
    const w = new L.Transcriber(assets);
    w.idle = true;
    w.ready.catch(() => (w.broken = true));
    return w;
  }

  // Renfort : démarre des moteurs supplémentaires (une vingtaine de secondes de préparation)
  function ensureWorkers(n) {
    while (app.workers.length < Math.min(n, app.limits.max)) {
      const w = newWorker(app.mainAssets);
      w.starting = true;
      app.workers.push(w);
      w.ready.then(() => {
        w.starting = false;
        pump();
      });
    }
  }

  // Un moteur est libre et rien n'attend : les blocs partent dès la fin d'une phrase
  function engineIdle() {
    return app.engineReady && app.queue.length === 0 && app.workers.some((w) => w.idle && !w.starting);
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
  const FAST_AFTER = 15000; // un passage qui attend plus de 15 s part par la voie rapide

  function pump() {
    if (!app.engineReady) return updateQueue();
    app.queue.sort((a, b) => a.seg.start - b.seg.start);
    const backlog = app.queue.length;
    // Combien de moteurs principaux ont le droit de travailler en ce moment
    // Réunion terminée : le PC est libéré, la fin du transcript peut utiliser le renfort
    const allowed = backlog >= 2 || app.state === 'finishing' ? app.limits.boost : app.limits.normal;
    if (backlog >= 2) ensureWorkers(app.limits.boost);
    let busy = app.workers.filter((w) => !w.idle).length;

    for (const w of app.workers) {
      if (!app.queue.length || busy >= allowed) break;
      if (!w.idle || w.starting || w.broken) continue;
      busy++;
      run(w, app.queue.shift(), false);
    }
    // Voie rapide : le passage le plus ancien attend depuis trop longtemps
    for (const w of app.fastWorkers) {
      if (!w.idle || w.broken || !app.queue.length) continue;
      const oldest = app.queue[0];
      if (Date.now() - oldest.queuedAt < FAST_AFTER) break;
      run(w, app.queue.shift(), true);
    }
    // Rattrapage : en période calme, les passages « rapides » sont retranscrits avec le bon modèle
    if (!app.queue.length && app.drafts.length) {
      const limit = app.state === 'done' ? app.limits.boost : app.limits.normal;
      for (const w of app.workers) {
        if (!app.drafts.length || busy >= limit) break;
        if (!w.idle || w.starting || w.broken) continue;
        busy++;
        const d = app.drafts.shift();
        run(w, { ...d, seg: { ...d.seg, audio: d.keepDraft.slice() }, redo: true }, false);
      }
    }
    updateQueue();
  }

  function run(w, job, fast) {
    w.idle = false;
    app.inFlight++;
    const t = job.transcript;
    const lang = t.meta.language === 'auto' ? ['fr', 'en'] : t.meta.language;
    const tracker = job.source === 'others' ? t.tracker : null;
    job.dur = job.seg.audio.length / 16000;
    // Copies de l'audio : pour l'analyse des voix, et pour retranscrire un passage « rapide »
    const keep = tracker && !job.redo ? job.seg.audio.slice() : null;
    const keepDraft = fast ? job.seg.audio.slice() : null;
    w.transcribe(job.seg.audio, lang, t.meta.glossary, (job.seg.map || []).map((m) => m.at))
      .then(async (res) => {
        if (!fast) recordLoad(res.ms || 0, job.dur);
        if (job.redo) {
          t.replaceBlock(job.source, job.seg, res);
          return;
        }
        let voices = null;
        if (tracker) {
          try {
            voices = await tracker.label(keep, res.chunks, job.seg);
          } catch (e) {
            console.warn('Distinction des voix impossible pour ce passage', e);
          }
        }
        t.addSegment(job.source, job.seg, res, voices, { block: job.seg.id, draft: fast });
        if (fast) app.drafts.push({ source: job.source, seg: { ...job.seg, audio: null }, transcript: t, keepDraft });
      })
      .catch((err) => console.error('Segment non transcrit', err))
      .finally(() => {
        w.idle = true;
        app.inFlight--;
        pump();
      });
  }

  // Vérifie régulièrement l'âge des passages en attente (voie rapide)
  setInterval(() => {
    if (app.queue.length) pump();
  }, 3000);

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
    return ms / 1000 / dur / Math.max(1, app.limits ? app.limits.normal : app.workers.length);
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
    app.transcript.onChange(renderDrafts);
    if (app.analyzer && app.analyzer.hasSpeaker && $('distinguish').checked) {
      app.transcript.tracker = new L.SpeakerTracker(app.analyzer);
    }

    app.capture = new L.Capture(
      (source, seg) => {
        seg.id = ++app.blockSeq;
        app.queue.push({ source, seg, transcript: app.transcript, queuedAt: Date.now() });
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
      if (para.draft) {
        p.className = 'draft';
        p.title = 'Transcription rapide provisoire : la version précise arrive dès que le moteur est disponible.';
      }
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
        const tracker = app.transcript.tracker;
        app.transcript.applyVoiceMap(tracker.finalize());
        // Voix mémorisées : reconnaissance automatique des intervenants déjà nommés
        if (app.memory.enabled && app.memory.count && tracker.centroids) {
          const present = new Map([...tracker.centroids].filter(([v]) => app.transcript.lines.some((l) => l.voice === v)));
          app.transcript.meta.recognized = [];
          for (const [voice, name] of app.memory.match(present)) {
            app.transcript.nameVoice(voice, name);
            app.transcript.meta.recognized.push(voice);
          }
        }
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
    renderDrafts();
    download(app.finalMarkdown, app.transcript.fileName());
  }

  // Écran de fin : suivi de la retranscription des passages « rapides »
  function renderDrafts() {
    const t = app.transcript;
    const box = $('drafts');
    if (!t || app.state !== 'done') return;
    const n = t.draftCount();
    if (n) {
      box.textContent = `${n} passage${n > 1 ? 's ont été transcrits' : ' a été transcrit'} en mode rapide pendant la réunion pour garder le direct. ` +
        'Leur version précise est en cours de calcul…';
      box.hidden = false;
      app.improvedPending = true;
    } else if (app.improvedPending) {
      app.improvedPending = false;
      app.finalMarkdown = t.toMarkdown();
      $('preview').textContent = app.finalMarkdown;
      box.textContent = 'Tous les passages ont maintenant leur version précise. Retéléchargez le fichier pour avoir la version finale.';
      box.hidden = false;
    } else {
      box.hidden = true;
    }
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
      // Mémoire des voix : on retient l'empreinte quand la saisie est validée
      input.addEventListener('change', () => {
        const c = t.tracker && t.tracker.centroids && t.tracker.centroids.get(v.voice);
        if (app.memory.enabled && c && input.value.trim()) {
          app.memory.remember(input.value.trim(), c.emb, c.seconds);
          renderMemory();
        }
      });
      if ((t.meta.recognized || []).includes(v.voice)) {
        const b = document.createElement('span');
        b.className = 'badge auto';
        b.textContent = 'reconnu';
        label.appendChild(b);
      }
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
    $('last-line').textContent = '';
    app.improvedPending = false;
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
  // Test de vitesse sur ce PC
  // ---------------------------------------------------------------------------

  async function speedTest(auto) {
    if (!app.engineReady || !app.workers.length) {
      if (!auto) toast('Le moteur n’est pas encore prêt.');
      return;
    }
    const out = $('speed-result');
    out.textContent = 'Mesure en cours (quelques secondes à une minute)…';
    $('speed-test').disabled = true;
    try {
      const b = await app.workers[0].bench();
      const n = app.limits.normal;
      const load = L.estimateLoad(b, n);
      const perMin = Math.round(load * 60);
      const model = app.modelLabel;
      let advice;
      if (load <= 0.5) advice = 'Très confortable : la transcription suivra la réunion en direct.';
      else if (load <= 0.9) advice = 'Correct : la transcription suit la réunion, avec un léger décalage quand ça parle beaucoup.';
      else if (load <= 1.3) advice = "Juste : lors d'échanges très denses, la transcription prendra du retard puis le rattrapera dans les silences.";
      else advice = app.fastWorkers.length
        ? 'Lors des échanges denses, la voie rapide prendra le relais pour garder le direct, et les passages concernés seront retranscrits précisément ensuite.'
        : 'Trop lent pour suivre en direct : installez Whisper base (Options, « Installer un autre modèle ») pour activer la voie rapide, ou choisissez un modèle plus rapide.';
      out.textContent =
        `${model} : environ ${perMin} s de calcul par minute de parole continue ` +
        `(charge estimée ${Math.round(load * 100)} % avec ${n} moteur${n > 1 ? 's' : ''}` +
        (app.limits.boost > n ? `, ${app.limits.boost} en renfort` : '') +
        (app.fastWorkers.length ? ', plus la voie rapide en secours' : '') +
        `). ${advice}`;
      store.set('lowsper.speed.' + app.modelId, JSON.stringify({ load, at: Date.now() }));
    } catch (e) {
      out.textContent = 'Mesure impossible : ' + e.message;
    } finally {
      $('speed-test').disabled = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Mémoire des voix (facultative)
  // ---------------------------------------------------------------------------

  app.memory = new L.VoiceMemory();
  app.memory.purge(); // effacement automatique des empreintes trop anciennes

  function renderMemory() {
    const m = app.memory;
    $('memory-on').checked = m.enabled;
    $('memory-details').hidden = !m.enabled;
    $('memory-days').value = String(m.keepDays);
    $('memory-clear').disabled = !m.count;
    $('memory-list').textContent = m.count
      ? `${m.count} voix mémorisée${m.count > 1 ? 's' : ''} : ${m.names().join(', ')}.`
      : 'Aucune voix mémorisée pour l’instant. Nommez les intervenants à la fin d’une réunion.';
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

  const modelSize = (m) => m.files.reduce((n, f) => n + f.size, 0);

  function showInstall() {
    const catalog = (self.LOWSPER_MANIFEST && self.LOWSPER_MANIFEST.catalog) || [];
    const installed = self.LOWSPER_INSTALLED || [];
    const box = $('model-choices');
    box.replaceChildren();
    catalog.forEach((m) => {
      const mb = Math.round(modelSize(m) / 1e6);
      const needsGpu = m.device === 'webgpu';
      const gpuMissing = needsGpu && !app.gpu;
      const isInstalled = installed.some((x) => x.id === m.id);
      const label = document.createElement('label');
      label.className = 'model-opt';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.name = 'model-choice';
      input.value = m.id;
      // Déjà installé : coché et grisé. Sinon, seul le modèle recommandé est pré-coché.
      input.checked = isInstalled || (!installed.length && !!m.recommended);
      input.disabled = isInstalled;
      if (isInstalled) label.classList.add('done');
      if (gpuMissing) label.classList.add('nogpu');
      input.addEventListener('change', updateInstallButton);
      const title = document.createElement('strong');
      title.textContent = m.label;
      const badge = (text, cls) => {
        const b = document.createElement('span');
        b.className = 'badge' + (cls ? ' ' + cls : '');
        b.textContent = text;
        title.appendChild(b);
      };
      if (m.recommended) badge('recommandé');
      if (isInstalled) badge('installé', 'auto');
      if (needsGpu) badge('carte graphique');
      const size = document.createElement('span');
      size.className = 'size';
      size.textContent = `${mb} Mo`;
      const desc = document.createElement('span');
      desc.className = 'desc';
      desc.textContent =
        (m.description || '') +
        (gpuMissing
          ? ' Aucune carte graphique compatible détectée sur ce PC : inutilisable ici, utile seulement pour copier le dossier Lowsper vers un PC équipé.'
          : needsGpu
            ? ` Carte détectée : ${app.gpu.description || app.gpu.vendor || 'compatible'}.`
            : '');
      label.append(input, title, size, desc);
      box.appendChild(label);
    });
    $('install-back').hidden = !installed.length;
    $('page-folder').textContent = L.pageFolder();
    $('temp-warning').hidden = !L.openedFromTemp();
    $('install-error').hidden = true;
    updateInstallButton();
    setState('install');
  }

  // Modèles à télécharger : la sélection (hors déjà installés), plus Whisper base quand un
  // modèle processeur est choisi (voie rapide de secours).
  function installList() {
    const catalog = self.LOWSPER_MANIFEST.catalog;
    const installedIds = (self.LOWSPER_INSTALLED || []).map((m) => m.id);
    const picked = [...document.querySelectorAll('input[name="model-choice"]:checked')]
      .map((i) => catalog.find((m) => m.id === i.value))
      .filter((m) => m && !installedIds.includes(m.id));
    const fast = catalog.find((m) => m.id === 'whisper-base');
    const needsFast = picked.some((m) => m.device !== 'webgpu' && m.id !== 'whisper-base');
    if (needsFast && fast && !installedIds.includes(fast.id) && !picked.includes(fast)) picked.push(fast);
    return picked;
  }

  function updateInstallButton() {
    // Whisper base est ajouté d'office avec un modèle processeur : la case le montre
    const baseBox = document.querySelector('input[name="model-choice"][value="whisper-base"]');
    const installedIds = (self.LOWSPER_INSTALLED || []).map((m) => m.id);
    if (baseBox && !installedIds.includes('whisper-base')) {
      const catalog = self.LOWSPER_MANIFEST.catalog;
      const cpuPicked = [...document.querySelectorAll('input[name="model-choice"]:checked')]
        .map((i) => catalog.find((m) => m.id === i.value))
        .some((m) => m && m.device !== 'webgpu' && m.id !== 'whisper-base' && !installedIds.includes(m.id));
      if (cpuPicked) baseBox.checked = true;
      baseBox.disabled = cpuPicked;
      baseBox.closest('.model-opt').classList.toggle('auto', cpuPicked);
    }
    const list = installList();
    const mb = Math.round(list.reduce((n, m) => n + modelSize(m), 0) / 1e6);
    const btn = $('install');
    btn.disabled = !list.length || app.installing;
    btn.textContent = !list.length
      ? 'Cochez au moins un modèle'
      : list.length === 1
        ? `Installer ${list[0].label} (${mb} Mo)`
        : `Installer ${list.length} modèles (${mb} Mo)`;
  }

  async function install() {
    if (app.installing) return;
    const catalog = self.LOWSPER_MANIFEST.catalog;
    const list = installList();
    if (!list.length) return;
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
    $('install').textContent = 'Installation en cours…';
    $('install-progress').hidden = false;
    setEngine('loading', 'Téléchargement du modèle');
    const t0 = performance.now();
    try {
      const grand = list.reduce((n, m) => n + m.files.reduce((k, f) => k + f.size, 0), 0);
      let before = 0;
      for (const m of list) {
        await L.installModel(folder, m, (p) => {
          const done = before + p.done;
          $('install-bar').style.width = ((done / grand) * 100).toFixed(1) + '%';
          const secs = (performance.now() - t0) / 1000;
          const speed = done / 1e6 / Math.max(secs, 0.1);
          const left = speed > 0 ? Math.round((grand - done) / 1e6 / speed) : 0;
          $('install-text').textContent =
            `${Math.round(done / 1e6)} / ${Math.round(grand / 1e6)} Mo · ${speed.toFixed(1)} Mo/s` +
            (left > 2 ? ` · environ ${left > 90 ? Math.round(left / 60) + ' min' : left + ' s'} restantes` : '') +
            (list.length > 1 ? ` · ${m.label}` : '');
        });
        before += m.files.reduce((k, f) => k + f.size, 0);
      }
      // Modèle utilisé ensuite : celui déjà choisi s'il existe, sinon le premier utilisable sur ce PC
      // (dans l'ordre du catalogue : recommandé d'abord).
      const usable = (m) => m.device !== 'webgpu' || app.gpu;
      const nowInstalled = (self.LOWSPER_INSTALLED || []).map((m) => m.id);
      const current = store.get('lowsper.model');
      if (!current || !nowInstalled.includes(current)) {
        const first = catalog.find((m) => nowInstalled.includes(m.id) && usable(m) && m.id !== 'whisper-base') ||
          catalog.find((m) => nowInstalled.includes(m.id) && usable(m));
        if (first) store.set('lowsper.model', first.id);
      }
      $('install-text').textContent = list.length > 1 ? 'Modèles installés. Démarrage…' : 'Modèle installé. Démarrage…';
      app.installing = false;
      setTimeout(() => location.reload(), 400);
    } catch (e) {
      console.error(e);
      app.installing = false;
      $('install').disabled = false;
      showInstall(); // réaffiche les cases (et ce qui a déjà été installé)
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
    $('model-current').textContent =
      `Modèle utilisé : ${(installed.find((m) => m.id === current) || installed[0]).label}. ` +
      `Installés sur ce poste : ${installed.map((m) => m.label).join(', ')}.`;
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
  $('speed-test').addEventListener('click', () => speedTest(false));
  $('power').value = store.get('lowsper.power') || 'balanced';
  $('power').addEventListener('change', (e) => {
    store.set('lowsper.power', e.target.value);
    if (app.mainAssets) app.limits = computeLimits(app.mainAssets.device);
    pump();
  });
  $('memory-on').addEventListener('change', (e) => {
    if (e.target.checked && !confirm(
      "Mémoriser les voix ?\n\nUne empreinte vocale est une donnée biométrique (RGPD). " +
      "Ne l'activez qu'avec l'accord des personnes concernées. Les empreintes restent uniquement sur ce poste " +
      'et sont effacées automatiquement après la durée choisie.'
    )) {
      e.target.checked = false;
      return;
    }
    app.memory.setEnabled(e.target.checked);
    renderMemory();
  });
  $('memory-days').addEventListener('change', (e) => {
    app.memory.setKeepDays(Number(e.target.value));
    renderMemory();
  });
  $('memory-clear').addEventListener('click', () => {
    if (!confirm('Effacer définitivement toutes les voix mémorisées ?')) return;
    app.memory.clear();
    renderMemory();
    toast('Voix mémorisées effacées.');
  });
  renderMemory();
  $('install-back').addEventListener('click', () => setState('idle'));
  $('add-model').addEventListener('click', () => {
    closeSettings();
    if (app.state === 'recording' || app.state === 'finishing') {
      toast('Terminez la réunion en cours avant d’installer un modèle.');
      return;
    }
    showInstall();
  });
  // Roue crantée : panneau Paramètres, accessible à tout moment
  const openSettings = () => {
    renderMemory();
    const d = $('settings');
    if (!d.open) d.showModal();
  };
  function closeSettings() {
    const d = $('settings');
    if (d.open) d.close();
  }
  $('settings-open').addEventListener('click', openSettings);
  // Bandeau d'avertissement : fermé pour cette session, il revient à chaque ouverture de Lowsper
  try {
    if (sessionStorage.getItem('lowsper.consent.closed')) $('consent').hidden = true;
  } catch {}
  $('consent-close').addEventListener('click', () => {
    $('consent').hidden = true;
    try {
      sessionStorage.setItem('lowsper.consent.closed', '1');
    } catch {}
  });
  $('settings-open-2').addEventListener('click', openSettings);
  $('settings-close').addEventListener('click', closeSettings);
  $('settings').addEventListener('click', (e) => {
    if (e.target === $('settings')) closeSettings(); // clic à côté du panneau
  });
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
