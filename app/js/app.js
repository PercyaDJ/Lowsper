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
  const $ = (id) => document.getElementById(id);

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

      // Deux moteurs en parallèle (un par voix qui parle) si la machine le permet.
      const cores = navigator.hardwareConcurrency || 2;
      const memory = navigator.deviceMemory || 8;
      const count = cores >= 4 && memory >= 4 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const w = new L.Transcriber(assets);
        w.idle = true;
        app.workers.push(w);
      }
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
      w.transcribe(job.seg.audio, lang, job.transcript.meta.glossary)
        .then((res) => job.transcript.addSegment(job.source, job.seg, res))
        .catch((err) => console.error('Segment non transcrit', err))
        .finally(() => {
          w.idle = true;
          app.inFlight--;
          pump();
        });
    }
    updateQueue();
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
    app.transcript = new L.Transcript({
      title: $('title').value.trim(),
      startedAt: Date.now(),
      language: $('language').value,
      glossary: $('glossary').value.trim(),
      model: app.modelLabel,
      sources: [],
    });
    app.transcript.onChange(renderLive);

    app.capture = new L.Capture((source, seg) => {
      app.queue.push({ source, seg, transcript: app.transcript });
      pump();
    });
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
      s.textContent = L.SPEAKERS[para.source] + ' :';
      p.append(t, s, document.createTextNode(para.text));
      frag.appendChild(p);
    }
    box.replaceChildren(frag);
    if (nearBottom) box.scrollTop = box.scrollHeight;
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
    setState('finishing');
    await app.capture.stop(); // termine les segments en cours -> file d'attente
    app.capture = null;
    releaseWakeLock();
    pump();

    await new Promise((resolve) => {
      const check = () => (pendingCount() === 0 && app.engineReady) || app.engineError ? resolve() : setTimeout(check, 200);
      check();
    });

    app.transcript.emit(); // dernière sauvegarde, marquée comme terminée
    app.finalMarkdown = app.transcript.toMarkdown();
    const paras = app.transcript.paragraphs().length;
    const minutes = Math.max(1, Math.round((app.transcript.meta.endedAt - app.transcript.meta.startedAt) / 60000));
    $('done-info').textContent = `${minutes} min de réunion, ${paras} intervention${paras > 1 ? 's' : ''}. Le fichier a été enregistré dans votre dossier Téléchargements.`;
    $('preview').textContent = app.finalMarkdown;
    setState('done');
    download(app.finalMarkdown, app.transcript.fileName());
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
    catalog.forEach((m, i) => {
      const mb = Math.round(m.files.reduce((n, f) => n + f.size, 0) / 1e6);
      const label = document.createElement('label');
      label.className = 'model-opt';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'model-choice';
      input.value = m.id;
      input.checked = i === 0;
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
      desc.textContent = m.description || '';
      label.append(input, title, size, desc);
      box.appendChild(label);
    });
    $('install-back').hidden = !installed.length;
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
  $('title').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') start();
  });

  checkRecovery();
  bootEngine();
})();
