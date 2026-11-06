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
  // Texte de l'interface dans la langue choisie (i18n.js)
  const tr = (key, vars) => L.t(key, vars);
  // Les éléments de la mini-fenêtre changent de document : on garde des références directes.
  const cache = new Map();
  const $ = (id) => {
    let el = cache.get(id);
    if (!el || (!el.isConnected && document.getElementById(id))) {
      el = document.getElementById(id);
      // Élément déjà passé dans la mini-fenêtre avant sa première utilisation
      if (!el && window.LowsperApp && window.LowsperApp.pip) el = window.LowsperApp.pip.document.getElementById(id);
      if (el) cache.set(id, el);
    }
    return el;
  };

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

  // État du moteur : gardé pour être réécrit si la langue de l'interface change
  function setEngine(state, key, vars) {
    app.engineStatus = { state, key, vars };
    $('engine').dataset.state = state;
    $('engine-text').textContent = tr(key, vars);
  }

  async function bootEngine() {
    const problem = checkBrowser();
    if (problem) {
      app.engineError = problem;
      setEngine('error', 'engine.incompatible');
      toast(problem, 10000);
      return;
    }
    const installed = self.LOWSPER_INSTALLED || [];
    if (!installed.length) {
      setEngine('idle', 'engine.toInstall');
      $('model-current').textContent = tr('set.noModel');
      showInstall();
      return;
    }
    try {
      const preferred = store.get('lowsper.model');
      const model = installed.find((m) => m.id === preferred) || installed[0];
      app.modelLabel = model.label;
      app.modelId = model.id;
      $('foot-model').textContent = modelLabel(model);
      renderModelSelect(installed, model.id);

      const assets = await L.loadAssets(
        (r) => setEngine('loading', 'engine.preparingPct', { pct: Math.round(r * 100) }),
        model.id
      );
      setEngine('loading', 'engine.starting');

      // Analyse audio : détection de parole (Silero) et empreintes vocales (WeSpeaker)
      if (assets.analysis) {
        try {
          // Deux analyseurs séparés : la détection de parole (temps réel, légère) ne doit jamais
          // attendre derrière le calcul des empreintes vocales (lourd). Sur un PC chargé, une file
          // commune retardait la détection de plusieurs minutes, et l'audio en attente était perdu.
          app.analyzer = new L.Analyzer({ ...assets.analysis, speaker: null });
          app.voiceAnalyzer = assets.analysis.speaker ? new L.Analyzer(assets.analysis) : null;
          await app.analyzer.ready;
          if (app.voiceAnalyzer) await app.voiceAnalyzer.ready.catch(() => (app.voiceAnalyzer = null));
        } catch (e) {
          console.warn('Analyse audio indisponible, repli sur la détection par volume', e);
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
      setEngine('ready', 'engine.ready');
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
          $('speed-result').textContent = tr('speed.last', { pct: Math.round(k.load * 100) });
        } catch {}
      } else if (app.state !== 'recording') {
        speedTest(true);
      }
    } catch (err) {
      console.error(err);
      app.engineError = String(err.message || err);
      setEngine('error', 'engine.unavailable');
      toast(tr('start.engineFailed', { error: app.engineError }), 12000);
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
  // Santé du moteur pendant la réunion : relances, passages impossibles à transcrire (audio gardé)
  app.health = { restarts: 0, retried: 0 };
  app.failed = [];
  app.running = new Set(); // passages en cours de transcription
  app.stats = { ok: 0, failed: 0 };
  // Journal technique (sur ce poste uniquement, sans aucun texte de réunion) : pour comprendre
  // un incident. Téléchargeable sur l'écran de fin.
  app.journalLines = [];
  function journal(type, data) {
    const line = new Date().toISOString().slice(11, 19) + ' ' + type + (data ? ' ' + JSON.stringify(data) : '');
    app.journalLines.push(line);
    if (app.journalLines.length > 5000) app.journalLines.splice(0, 1000);
  }
  document.addEventListener('visibilitychange', () => journal('onglet', { visible: !document.hidden }));
  window.addEventListener('error', (e) => journal('erreur-page', { message: String(e.message).slice(0, 200) }));
  app.finished = []; // réunions déjà terminées pendant cette session (enchaînement)
  app.drafts = []; // passages transcrits par la voie rapide, à améliorer
  app.blockSeq = 0;

  // Formule partagée avec la recommandation de l'écran de bienvenue (recommend.js)
  function computeLimits(device) {
    return L.Recommend.limits(
      navigator.hardwareConcurrency,
      navigator.deviceMemory,
      store.get('lowsper.power') || 'balanced',
      device
    );
  }

  function newWorker(assets) {
    const w = new L.Transcriber(assets);
    w.assets = assets;
    w.idle = true;
    w.jobs = 0;
    w.ready.catch(() => (w.broken = true));
    return w;
  }

  // Remplace un moteur en panne (ou usé) par un moteur neuf : mémoire remise à zéro.
  // La file d'attente garde l'audio : rien n'est perdu pendant le redémarrage (une vingtaine de s).
  function replaceWorker(w) {
    const pool = app.fastWorkers.includes(w) ? app.fastWorkers : app.workers;
    const i = pool.indexOf(w);
    if (i < 0) return;
    try {
      w.dispose();
    } catch {}
    const fresh = newWorker(w.assets);
    fresh.starting = true;
    pool[i] = fresh;
    app.health.restarts++;
    fresh.ready
      .then(() => {
        fresh.starting = false;
        pump();
      })
      .catch((e) => console.error('Redémarrage du moteur impossible', e));
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
      return tr('browser.tooOld');
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return tr('browser.noMic');
    }
    return null;
  }

  // File de transcription : le segment le plus ancien part vers le premier moteur libre.
  const FAST_AFTER = 15000; // un passage qui attend plus de 15 s part par la voie rapide

  function pump() {
    if (!app.engineReady) return updateQueue();
    // Ordre d'arrivée (numéro de passage) : deux réunions enchaînées ont chacune leur horloge
    app.queue.sort((a, b) => a.seg.id - b.seg.id);
    const backlog = app.queue.length;
    // Combien de moteurs principaux ont le droit de travailler en ce moment
    // Réunion terminée : le PC est libéré, la fin du transcript peut utiliser le renfort
    // Import d'un fichier : pas de réunion en cours, le PC peut aussi utiliser le renfort
    const allowed =
      backlog >= 2 || app.state === 'finishing' || app.state === 'importing' ? app.limits.boost : app.limits.normal;
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
      // Un fichier n'a pas de « direct » à tenir : la voie rapide ne ferait que doubler le travail
      if (oldest.transcript && oldest.transcript.meta.file) break;
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

  // Délai maximal d'un passage : au-delà, le moteur est considéré bloqué et remplacé
  const jobTimeout = (job) => Math.max(180000, job.dur * 15000);

  function run(w, job, fast) {
    w.idle = false;
    w.jobs++;
    app.inFlight++;
    app.running.add(job);
    const t = job.transcript;
    const lang = t.meta.language === 'auto' ? ['fr', 'en'] : t.meta.language;
    const tracker = job.source === 'others' ? t.tracker : null;
    job.dur = job.seg.audio.length / 16000;
    // L'audio du passage reste dans la file tant qu'il n'est pas transcrit : le moteur reçoit
    // une copie. Si le moteur tombe en panne, le passage est relancé au lieu d'être perdu.
    const mic = job.source === 'me' && !job.redo ? t.micVoice : null;
    const keep = (tracker || mic) && !job.redo ? job.seg.audio.slice() : null;
    const keepDraft = fast ? job.seg.audio.slice() : null;
    let timer;
    const watchdog = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(tr('err.notResponding'))), jobTimeout(job));
    });
    Promise.race([
      w.transcribe(
        job.seg.audio.slice(),
        lang,
        promptFor(t, job),
        (job.seg.map || []).map((m) => m.at)
      ),
      watchdog,
    ])
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
        let embs = null;
        if (mic) {
          try {
            embs = await mic.embed(keep, res.chunks, job.seg);
          } catch (e) {
            console.warn('Empreinte du micro impossible pour ce passage', e);
          }
        }
        t.addSegment(job.source, job.seg, res, voices, {
          block: job.seg.id,
          draft: fast,
          embs,
        });
        if (tracker) regroupLive(t, tracker);
        if (fast)
          app.drafts.push({
            source: job.source,
            seg: { ...job.seg, audio: null },
            transcript: t,
            keepDraft,
          });
      })
      .then(() => {
        if (job.redo) return;
        t.markDone(job.source, job.seg);
        t.covered = t.covered || {};
        (t.covered[job.source] = t.covered[job.source] || []).push(...(job.seg.abs || []));
        app.stats.ok++;
      })
      .catch((err) => jobFailed(w, job, err))
      .finally(() => {
        clearTimeout(timer);
        app.running.delete(job);
        w.idle = true;
        app.inFlight--;
        pump();
      });
  }

  // Échec d'un passage : le moteur est remplacé (une panne de mémoire le laisse inutilisable),
  // le passage repart en tête de file. Après 3 essais, il est mis de côté avec son audio et
  // signalé dans le transcript ; « Réessayer » sur l'écran de fin le relance.
  function jobFailed(w, job, err) {
    console.error('Passage non transcrit, essai ' + ((job.attempts || 0) + 1), err);
    journal('échec', {
      source: job.source,
      essai: (job.attempts || 0) + 1,
      erreur: String((err && err.message) || err).slice(0, 200),
    });
    app.stats.failed++;
    replaceWorker(w);
    job.attempts = (job.attempts || 0) + 1;
    app.health.retried++;
    if (job.redo) {
      // Retranscription d'un passage « rapide » : la version rapide reste en place
      if (job.attempts < 3)
        app.drafts.push({
          ...job,
          seg: { ...job.seg, audio: null },
          keepDraft: job.seg.audio,
        });
      return;
    }
    if (job.attempts < 3) {
      app.queue.unshift(job);
    } else {
      app.failed.push(job);
      job.transcript.markGap(job.source, job.seg);
      if (app.state === 'recording') notice(tr('rec.gap'));
    }
  }

  // Corrections apprises (« Mira Bello » -> « Mirabelle »), conservées comme les réglages
  function learnedFixes() {
    try {
      const v = JSON.parse(store.get('lowsper.fixes') || '[]');
      return Array.isArray(v) ? v.filter((x) => Array.isArray(x) && x.length === 2) : [];
    } catch {
      return [];
    }
  }

  // Retient une correction (mal reconnu -> bonne écriture) ; le bon mot rejoint le glossaire.
  // Retourne false si la saisie est incomplète.
  function learnFix(wrong, right) {
    wrong = String(wrong || '').trim();
    right = String(right || '')
      .trim()
      .replace(/[*_`[\]]/g, '');
    if (!wrong || !right || wrong.toLowerCase() === right.toLowerCase()) return false;
    const fixes = learnedFixes().filter(([w]) => w.toLowerCase() !== wrong.toLowerCase());
    fixes.push([wrong, right]);
    store.set('lowsper.fixes', JSON.stringify(fixes.slice(-200)));
    // Le bon mot rejoint le glossaire : Whisper l'écrira directement la prochaine fois
    const terms = $('glossary')
      .value.split(/[,;\n]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (!terms.some((x) => x.toLowerCase() === right.toLowerCase())) {
      terms.push(right);
      $('glossary').value = terms.join(', ');
      store.set('lowsper.glossary', $('glossary').value);
    }
    renderFixes();
    return true;
  }

  // Paramètres : ajouter une correction à l'avance, sans attendre la fin d'une réunion
  function addFixFromSettings() {
    if (!learnFix($('set-fix-wrong').value, $('set-fix-right').value)) return;
    $('set-fix-wrong').value = '';
    $('set-fix-right').value = '';
    $('set-fix-wrong').focus();
  }

  // Écran de fin : corriger dans le transcript et retenir pour la suite
  function applyFix() {
    const t = app.transcript;
    const wrong = $('fix-wrong').value.trim();
    const right = $('fix-right')
      .value.trim()
      .replace(/[*_`[\]]/g, '');
    if (!t || !learnFix(wrong, right)) return;
    const n = t.replaceEverywhere(wrong, right);
    refreshNote(t);
    $('fix-wrong').value = '';
    $('fix-right').value = '';
    $('fix-wrong').focus();
    renderSuspects();
    toast(tr('done.fixResult', { n }), 6000);
    // Copie dans le dossier Lowsper (clic = geste de l'utilisateur)
    L.Settings.save({ interactive: true })
      .then(renderSaved)
      .catch(() => {});
  }

  // Écran de fin : noms propres probables à vérifier, un clic pré-remplit la correction
  function renderSuspects() {
    const box = $('fix-suspects');
    box.replaceChildren();
    if (!app.transcript) return;
    const words = app.transcript.suspectWords();
    if (words.length) {
      const label = document.createElement('span');
      label.className = 'suspects-label';
      label.textContent = tr('done.suspects');
      box.appendChild(label);
    }
    for (const w of words) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = w;
      b.addEventListener('click', () => {
        $('fix-wrong').value = w;
        $('fix-right').focus();
      });
      box.appendChild(b);
    }
  }

  function renderFixes() {
    const fixes = learnedFixes();
    const box = $('fix-chips');
    box.replaceChildren();
    for (const [wrong, right] of fixes) {
      const chip = document.createElement('span');
      chip.className = 'fix-chip';
      chip.textContent = `${wrong} → ${right}`;
      const del = document.createElement('button');
      del.type = 'button';
      del.title = tr('set.fixForget');
      del.setAttribute('aria-label', tr('set.fixForget') + ' : ' + wrong);
      del.textContent = '×';
      del.addEventListener('click', () => {
        store.set('lowsper.fixes', JSON.stringify(learnedFixes().filter(([w]) => w !== wrong)));
        renderFixes();
      });
      chip.appendChild(del);
      box.appendChild(chip);
    }
  }

  function selectedVocab() {
    return [...document.querySelectorAll('#vocab-list input:checked')].map((b) => b.value);
  }

  // Contexte donné à Whisper : nom de la réunion, vocabulaires métier et glossaire (vocabulary.js)
  function promptFor(t, job) {
    return L.Vocabulary.prompt({
      title: t.meta.title,
      glossary: t.fullGlossary(),
    });
  }

  // Regroupement des voix en cours de réunion (toutes les 45 s environ) : l'affichage en
  // direct converge vers le bon nombre d'intervenants au lieu d'accumuler des voix provisoires.
  function regroupLive(t, tracker) {
    if (app.state !== 'recording' || tracker.items.length < 20) return;
    if (Date.now() - (tracker.regroupedAt || 0) < 45000) return;
    tracker.regroupedAt = Date.now();
    try {
      t.applyVoiceMap(tracker.finalize({ maxSegments: 240 }));
    } catch (e) {
      console.warn('Regroupement des voix en direct impossible', e);
    }
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
      if (!app.engineReady && !app.engineError) text = tr('queue.preparing');
      else if (n === 0) text = tr('queue.upToDate');
      else if (n === 1) text = tr('queue.one');
      else text = tr('queue.many', { n });
      const load = engineLoad();
      if (load != null) text += tr('queue.load', { pct: Math.round(load * 100) });
      // Retard durable : le PC ne suit pas le rythme de la réunion
      if (n >= 4) {
        app.behindSince = app.behindSince || Date.now();
        if (Date.now() - app.behindSince > 120000 && !app.warnedSlow) {
          app.warnedSlow = true;
          notice(tr('rec.slow'));
        }
      } else {
        app.behindSince = null;
      }
    }
    $('queue').textContent = text;
    if (app.state === 'finishing') {
      $('finish-text').textContent = !app.engineReady
        ? tr('finish.preparing')
        : n > 1
          ? tr('finish.left', { n })
          : tr('finish.last');
    }
  }

  // ---------------------------------------------------------------------------
  // Démarrage
  // ---------------------------------------------------------------------------

  async function start() {
    if (app.state !== 'idle' || $('start').disabled) return;
    if (app.engineError && !app.engineReady) {
      toast(tr('start.engineDown', { error: app.engineError }), 8000);
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
      toast(
        micError && micError.name === 'NotAllowedError'
          ? tr('start.micDenied')
          : tr('start.noSource', { error: (micError || othersError || {}).message || tr('start.unknownError') }),
        9000
      );
      return;
    }

    L.Transcript.clearSaved();
    $('recover').hidden = true;
    app.warnedSlow = false;
    app.behindSince = null;
    app.loadSamples = [];
    app.transcript = createTranscript($('title').value.trim(), parseInt($('people').value, 10));

    app.capture = new L.Capture(
      (source, seg) => {
        const t = app.transcript;
        seg.id = ++app.blockSeq;
        const abs = L.speechIntervals ? L.speechIntervals(seg) : []; // temps de la capture
        shiftSeg(seg, t.meta.offset); // horodatage relatif au début de CETTE réunion
        seg.abs = abs;
        journal('bloc', { source, s: +(seg.speech || 0).toFixed(1) });
        // Moments où les participants parlent (pour reconnaître l'écho au micro, en fin de réunion)
        if (source === 'others' && L.speechIntervals) t.othersBusy.push(...L.speechIntervals(seg));
        app.queue.push({ source, seg, transcript: t, queuedAt: Date.now() });
        t.markQueued(source, seg);
        pump();
      },
      {
        analyzer: app.analyzer,
        emitEarly: engineIdle,
        recorders: (app.recorders = {}),
      }
    );
    await app.capture.init();
    if (mic) attachSource('me', mic);
    if (others) attachSource('others', others);

    setState('recording');
    journal('début', {
      modèle: app.modelId,
      puissance: store.get('lowsper.power') || 'balanced',
      moteurs: app.workers.length,
      coeurs: navigator.hardwareConcurrency,
      memoire_go: navigator.deviceMemory,
      micro: !!mic,
      participants: !!others,
      navigateur: navigator.userAgent.slice(0, 120),
    });
    app.lastHealth = 0;
    app.warnedLag = false;
    renderLive();
    // Après quelques réunions, le mode d'emploi se replie (il reste à un clic)
    store.set('lowsper.meetings', String((Number(store.get('lowsper.meetings')) || 0) + 1));
    // Comme un appel Teams : Lowsper se réduit tout de suite en mini-fenêtre, si le navigateur
    // l'autorise encore (le clic sur « Démarrer » compte comme geste pendant quelques secondes).
    if (store.get('lowsper.opt.autopip') !== '0' && navigator.userActivation && navigator.userActivation.isActive) {
      openPip({ quiet: true });
    }
    setMeter('me', mic ? 'on' : 'off');
    setMeter('others', others ? 'on' : 'off');
    if (!mic) notice(tr('rec.noMic'));
    else if (withOthers && !others) explainOthersError(othersError);
    else if (!withOthers) notice(tr('rec.micOnly'));

    app.timer = setInterval(tick, 100);
    requestWakeLock();
  }

  // Nouveau transcript de réunion, avec ses propres outils (voix, écho, couverture)
  function createTranscript(title, people, offset) {
    const t = new L.Transcript({
      title,
      startedAt: Date.now(),
      language: $('language').value,
      glossary: $('glossary').value.trim(),
      vocab: selectedVocab(),
      fixes: learnedFixes(),
      model: app.modelLabel,
      sources: [],
      offset: offset || 0,
      profile: L.Notes.current().id, // profil de sortie choisi à l'accueil
      noteLang: L.i18n.lang(), // langue de la note : celle de l'interface au début de la réunion
    });
    L.Transcript.current = t; // seule la réunion en cours est sauvegardée pour la récupération
    t.onChange(renderLive);
    t.onChange(renderDrafts);
    t.onChange(() => {
      if (app.state !== 'done' || !app.gapsShown || t !== app.transcript) return;
      refreshNote(t);
      renderGaps();
    });
    // Micro = une seule personne (vous) : votre voix sert à reconnaître l'écho des haut-parleurs
    if (app.voiceAnalyzer) t.micVoice = new L.MicVoice(app.voiceAnalyzer);
    t.othersBusy = [];
    if (app.voiceAnalyzer && $('distinguish').checked) {
      t.tracker = new L.SpeakerTracker(app.voiceAnalyzer);
      // Nombre de personnes indiqué (vous compris) : les autres voix sont au plus n - 1
      if (people >= 2) {
        t.tracker.expected = Math.min(29, people - 1);
        t.meta.people = people;
      }
    }
    return t;
  }

  // ---------------------------------------------------------------------------
  // Import de fichiers audio (dictaphone, téléphone, enregistrement fait ailleurs)
  //
  // Même chaîne que le direct : découpage par la détection de parole, file de transcription,
  // moteurs, distinction des voix, glossaire et corrections. Différences : la détection de parole
  // n'a pas de délai (rien ne presse, rien n'est sauté), la voie rapide est inutile, et le décodage
  // attend que la file se vide (mémoire bornée, même pour plusieurs heures).
  // ---------------------------------------------------------------------------
  const FILE_AHEAD = 6; // passages d'avance au plus dans la file pendant un import

  function createFileTranscript(file, people, title) {
    const t = new L.Transcript({
      title: title || file.name.replace(/\.[^.]+$/, ''),
      startedAt: Date.now(),
      language: $('language').value,
      glossary: $('glossary').value.trim(),
      vocab: selectedVocab(),
      fixes: learnedFixes(),
      model: app.modelLabel,
      sources: ['others'],
      offset: 0,
      file: {
        name: file.name,
        size: file.size,
        modifiedAt: file.lastModified || null,
        recordedAt: null,
        duration: 0,
      },
      profile: L.Notes.current().id,
      noteLang: L.i18n.lang(),
    });
    t.othersBusy = [];
    if (app.voiceAnalyzer && $('distinguish').checked) {
      t.tracker = new L.SpeakerTracker(app.voiceAnalyzer);
      // Dans un enregistrement, toutes les personnes sont « de l'autre côté » : pas de « vous » au micro
      if (people >= 1) {
        t.tracker.expected = Math.min(30, people);
        t.meta.people = people;
      }
    }
    return t;
  }

  async function importFiles(list) {
    const files = [...list].filter((f) => f && f.size > 0);
    if (!files.length || (app.state !== 'idle' && app.state !== 'done')) return;
    if (app.engineError && !app.engineReady) {
      toast(tr('start.engineDown', { error: app.engineError }), 8000);
      return;
    }
    if (app.state === 'done') reset();
    L.Transcript.clearSaved();
    $('recover').hidden = true;
    const people = parseInt($('people').value, 10);
    // Le nom de réunion saisi ne vaut que pour un fichier seul ; sinon, chacun garde le sien
    const title = files.length === 1 ? $('title').value.trim() : '';
    app.imports = files.map((file) => ({ file, status: 'waiting' }));
    app.importAbort = new AbortController();
    app.finished = [];
    app.failed = [];
    setState('importing');
    requestWakeLock();
    renderImport();
    const done = [];
    for (const item of app.imports) {
      if (app.importAbort.signal.aborted) {
        item.status = 'cancelled';
        continue;
      }
      item.status = 'running';
      renderImport();
      try {
        const t = await transcribeFile(item, people, title, app.importAbort.signal);
        item.status = 'done';
        done.push(t);
        await exportNote(t);
      } catch (e) {
        item.status = e && e.code === 'ABORT' ? 'cancelled' : 'failed';
        item.error = (e && e.message) || String(e);
        journal('import-échec', {
          format: item.meta && item.meta.format,
          erreur: item.error.slice(0, 200),
        });
      }
      renderImport();
    }
    releaseWakeLock();
    const failures = app.imports.filter((i) => i.status === 'failed');
    if (!done.length) {
      setState('idle');
      if (failures.length)
        toast(failures.map((i) => tr('import.failure', { name: i.file.name, error: i.error })).join('\n'), 12000);
      else toast(tr('import.cancelledToast'), 4000);
      return;
    }
    // Écran de fin : le dernier fichier transcrit ; les autres restent téléchargeables
    const t = done.pop();
    app.finished = done;
    app.transcript = t;
    L.Transcript.current = t;
    app.finalMarkdown = noteOf(t).content;
    app.doneFailures = failures.map((i) => ({ name: i.file.name, error: i.error }));
    renderDoneInfo();
    $('preview').textContent = app.finalMarkdown;
    renderExport(t);
    $('next-meeting').hidden = true;
    renderVoices();
    renderPrompts();
    renderSuspects();
    renderGaps();
    renderFinished();
    setState('done');
  }

  async function transcribeFile(item, people, title, signal) {
    const t = createFileTranscript(item.file, people, title);
    app.transcript = t;
    L.Transcript.current = t;
    item.t = t;
    item.startedAt = Date.now();
    item.decoded = 0; // secondes de son décodées
    item.ratio = 0; // part du fichier lue
    const analyzer = app.analyzer;
    const VAD_ID = 'fichier';
    if (analyzer) await analyzer.reset(VAD_ID).catch(() => {});
    const segmenter = new L.Segmenter(
      (seg) => {
        seg.id = ++app.blockSeq;
        seg.abs = L.speechIntervals ? L.speechIntervals(seg) : [];
        app.queue.push({
          source: 'others',
          seg,
          transcript: t,
          queuedAt: Date.now(),
        });
        t.markQueued('others', seg);
        pump();
      },
      {
        vad: analyzer ? { run: (samples) => analyzer.vad(VAD_ID, samples) } : null,
        vadTimeout: null,
      }
    );
    const tick = setInterval(() => renderImportProgress(item), 500);
    try {
      for await (const chunk of L.AudioFile.decode(item.file, {
        signal,
        onInfo: (meta) => {
          item.meta = meta;
          if (meta.recordedAt) t.meta.file.recordedAt = meta.recordedAt;
          journal('import', {
            format: meta.format,
            méthode: meta.method,
            durée_min: meta.duration ? Math.round(meta.duration / 60) : null,
          });
        },
        onProgress: (r) => (item.ratio = r),
      })) {
        await segmenter.push(chunk, false);
        item.decoded += chunk.length / L.AUDIO_RATE;
        // Mémoire bornée : le décodage attend que la transcription rattrape son retard
        while (pendingFor(t) > FILE_AHEAD && !signal.aborted) await new Promise((r) => setTimeout(r, 200));
        if (signal.aborted)
          throw Object.assign(new Error(tr('import.aborted')), {
            code: 'ABORT',
          });
      }
      await segmenter.flush();
      t.meta.file.duration = item.decoded;
      t.meta.endedAt = Date.now();
      item.ratio = 1;
      // Fin de la transcription, annulable à tout moment (la finalisation n'attend plus rien ensuite)
      await new Promise((resolve, reject) => {
        const wait = () => {
          if (signal.aborted)
            reject(
              Object.assign(new Error(tr('import.aborted')), {
                code: 'ABORT',
              })
            );
          else if (pendingFor(t) === 0) resolve();
          else setTimeout(wait, 200);
        };
        wait();
      });
      await finalizeMeeting(t, (text) => (item.step = text));
      if (signal.aborted)
        throw Object.assign(new Error(tr('import.aborted')), {
          code: 'ABORT',
        });
      return t;
    } catch (e) {
      // Annulation ou échec : les passages en attente de ce fichier sont retirés de la file
      app.queue = app.queue.filter((j) => j.transcript !== t);
      throw e;
    } finally {
      clearInterval(tick);
    }
  }

  // Avancement : la part du fichier déjà transcrite (tout ce qui précède le plus ancien passage
  // encore en attente), et une estimation du temps restant d'après le rythme observé.
  function renderImportProgress(item) {
    if (app.state !== 'importing' || !item.t) return;
    const t = item.t;
    let frontier = item.decoded;
    for (const j of [...app.queue, ...app.running]) if (j.transcript === t) frontier = Math.min(frontier, j.seg.start);
    const total =
      item.meta && item.meta.duration
        ? Math.max(item.meta.duration, item.decoded)
        : item.ratio > 0.02
          ? item.decoded / item.ratio
          : 0;
    const ratio = total ? Math.min(1, frontier / total) : 0;
    const pct = Math.round(ratio * 100);
    $('import-bar').style.width = pct + '%';
    $('import-progress').setAttribute('aria-valuenow', String(pct));
    const elapsed = (Date.now() - item.startedAt) / 1000;
    let text = item.step && item.ratio >= 1 && pendingFor(t) === 0 ? item.step : tr('import.pct', { pct });
    if (total) text += tr('import.position', { at: L.formatTime(frontier), total: L.formatTime(total) });
    if (ratio > 0.03 && elapsed > 20 && ratio < 1) {
      const left = (elapsed / ratio) * (1 - ratio);
      text += tr('import.left', { left: left < 90 ? Math.round(left) + ' s' : Math.round(left / 60) + ' min' });
    }
    $('import-text').textContent = text;
  }

  function renderImport() {
    const list = app.imports || [];
    const i = list.findIndex((x) => x.status === 'running');
    const current = i >= 0 ? list[i] : null;
    $('import-current').textContent = current
      ? current.file.name + (list.length > 1 ? tr('import.ofFiles', { i: i + 1, n: list.length }) : '')
      : '';
    if (current) {
      $('import-bar').style.width = '0%';
      $('import-progress').setAttribute('aria-valuenow', '0');
      $('import-text').textContent = tr('import.reading');
    }
    const box = $('import-list');
    box.replaceChildren();
    for (const x of list) {
      const li = document.createElement('li');
      if (x === current) li.className = 'current';
      if (x.status === 'failed') li.className = 'error';
      const name = document.createElement('span');
      name.textContent = x.file.name;
      const st = document.createElement('span');
      st.className = 'st';
      st.textContent =
        x.status === 'failed' ? tr('import.failedWith', { error: x.error }) : tr('import.status.' + x.status);
      li.append(name, st);
      box.appendChild(li);
    }
    $('import-list').hidden = list.length < 2 && !list.some((x) => x.status === 'failed');
  }

  // Temps de la réunion en cours (la capture continue d'une réunion à l'autre quand on enchaîne)
  function meetingNow() {
    return app.capture ? app.capture.now() - ((app.transcript && app.transcript.meta.offset) || 0) : 0;
  }

  function shiftSeg(seg, off) {
    if (!off) return;
    seg.start -= off;
    seg.end -= off;
    if (seg.map) for (const m of seg.map) m.t -= off;
  }

  /**
   * « Réunion suivante » : la réunion en cours se termine et la suivante commence aussitôt, avec le
   * même partage d'écran et le même micro (aucune fenêtre à revalider, aucun temps mort). La
   * réunion terminée est finalisée en arrière-plan puis enregistrée dans les Téléchargements.
   */
  async function chainNext() {
    if (app.state !== 'recording' || app.chaining) return;
    app.chaining = true;
    try {
      const old = app.transcript;
      if (app.capture.paused) togglePause();
      // Les paroles en cours appartiennent encore à la réunion qui se termine
      await app.capture.cut();
      const cut = app.capture.now();
      old.meta.endedAt = Date.now();
      old.meta.endAbs = cut;
      app.transcript = createTranscript('', NaN, cut);
      for (const id of Object.keys(app.capture.sources))
        if (!app.transcript.meta.sources.includes(id)) app.transcript.meta.sources.push(id);
      app.pausedAt = null;
      renderLive();
      toast(tr('rec.chained'), 6000);
      finalizeMeeting(old)
        .then(() => {
          // Le son brut de la réunion terminée n'est plus utile : mémoire libérée
          for (const rec of Object.values(app.recorders || {})) rec.trim(old.meta.endAbs);
          app.finished.push(old);
          return exportNote(old).then((ex) =>
            toast(
              tr('rec.chainedSaved', {
                title: old.meta.title,
                where: ex.where === 'dossier' ? tr('where.folder', { folder: ex.folder }) : tr('where.downloads'),
              }),
              7000
            )
          );
        })
        .catch((e) => console.error('Finalisation de la réunion précédente', e));
    } finally {
      app.chaining = false;
    }
  }

  /**
   * Rattrapage d'une réunion : relit le son brut reçu (en mémoire), repère la parole qu'aucun
   * passage transcrit ne couvre, la confirme avec le détecteur de parole et l'envoie au moteur.
   * Retourne le nombre de passages ajoutés.
   */
  async function sweepMeeting(t) {
    const recs = app.recorders || {};
    const from = t.meta.offset || 0;
    const to = t.meta.endAbs || from;
    let added = 0;
    for (const [source, rec] of Object.entries(recs)) {
      const covered = ((t.covered && t.covered[source]) || []).slice();
      for (const p of t.meta.pauses || []) covered.push([p.from + from, p.to + from]); // pauses voulues
      const regions = [];
      for (let w = from; w < to; w += 300) {
        const we = Math.min(to, w + 300);
        regions.push(...L.findUncovered(rec.read(w, we), w, covered));
      }
      // Confirmation par le détecteur de parole (évite de transcrire bruits, clics, musique)
      const speech = [];
      for (const r of regions) {
        const audio = rec.read(r.from, r.to);
        let keep = true;
        if (app.analyzer) {
          try {
            await app.analyzer.reset('rattrapage');
            const probs = await app.analyzer.vad('rattrapage', audio.subarray(0, Math.floor(audio.length / 512) * 512));
            const voiced = Array.from(probs).filter((p) => p > 0.4).length;
            keep = voiced >= Math.max(8, probs.length * 0.2);
          } catch {}
        }
        if (keep) speech.push({ ...r, audio });
      }
      // Passages regroupés en blocs de 22 s de parole au plus, comme en direct
      let block = null;
      const flush = () => {
        if (!block) return;
        const total = block.parts.reduce((n, p) => n + p.audio.length, 0) + 4800 * (block.parts.length - 1);
        const audio = new Float32Array(total);
        const map = [];
        let off = 0;
        block.parts.forEach((p, i) => {
          if (i) off += 4800; // 0,3 s de silence entre deux passages
          map.push({ at: off / 16000, t: p.from - from });
          audio.set(p.audio, off);
          off += p.audio.length;
        });
        const seg = {
          id: ++app.blockSeq,
          start: block.parts[0].from - from,
          end: block.parts[block.parts.length - 1].to - from,
          audio,
          speech: block.speech,
          map,
          abs: block.parts.map((p) => [p.from, p.to]),
        };
        app.queue.push({
          source,
          seg,
          transcript: t,
          queuedAt: Date.now(),
          sweep: true,
        });
        t.markQueued(source, seg);
        t.meta.recovered = (t.meta.recovered || 0) + seg.speech;
        added++;
        block = null;
      };
      for (const r of speech) {
        if (block && (block.speech + r.speech > 22 || r.from - block.parts[block.parts.length - 1].to > 30)) flush();
        if (!block) block = { parts: [], speech: 0 };
        block.parts.push(r);
        block.speech += r.speech;
      }
      flush();
    }
    journal('rattrapage', {
      passages: added,
      secondes: Math.round(t.meta.recovered || 0),
    });
    pump();
    return added;
  }

  // Passages encore à transcrire pour une réunion donnée
  function pendingFor(t) {
    let n = app.queue.filter((j) => j.transcript === t).length;
    for (const j of app.running) if (j.transcript === t && !j.redo) n++;
    return n;
  }

  /**
   * Termine une réunion : attend ses derniers passages, regroupe les voix, retire l'écho reconnu
   * à la voix. Utilisé à la fin (« Terminer ») et en arrière-plan quand on enchaîne.
   */
  async function finalizeMeeting(t, onStep) {
    const settled = () =>
      new Promise((resolve) => {
        const check = () =>
          (pendingFor(t) === 0 && app.engineReady) || app.engineError ? resolve() : setTimeout(check, 200);
        check();
      });
    await settled();
    // Rattrapage : la parole présente dans le son reçu mais jamais transcrite (détection en retard,
    // moteur en panne, PC saturé...) est retrouvée et transcrite maintenant.
    // Fichier importé : la détection de parole n'a pas de délai, rien n'a pu échapper en route
    if (!t.meta.file) {
      try {
        if (onStep) onStep(tr('finish.sweep'));
        const n = await sweepMeeting(t);
        if (n) {
          if (onStep) onStep(tr('finish.sweepN', { n }));
          await settled();
        }
      } catch (e) {
        console.warn('Rattrapage impossible', e);
        journal('rattrapage-erreur', {
          erreur: String(e.message || e).slice(0, 200),
        });
      }
    }
    if (t.tracker) {
      if (onStep) onStep(tr('finish.voices'));
      await new Promise((r) => setTimeout(r, 30)); // laisse l'affichage se mettre à jour
      try {
        const tracker = t.tracker;
        t.applyVoiceMap(tracker.finalize());
        // Voix mémorisées : reconnaissance automatique des intervenants déjà nommés
        if (app.memory.enabled && app.memory.count && tracker.centroids) {
          const present = new Map([...tracker.centroids].filter(([v]) => t.lines.some((l) => l.voice === v)));
          t.meta.recognized = [];
          for (const [voice, name] of app.memory.match(present)) {
            t.nameVoice(voice, name);
            t.meta.recognized.push(voice);
          }
        }
      } catch (e) {
        console.warn('Regroupement final des voix impossible', e);
      }
    }
    // Écho des haut-parleurs reconnu à la voix (micro = vous seul)
    try {
      t.meta.echoRemoved = t.removeVoiceEcho(t.micVoice, t.othersBusy);
    } catch (e) {
      console.warn('Filtrage de l’écho par la voix impossible', e);
    }
    t.emit();
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
        notice(id === 'others' ? tr('rec.othersStopped') : tr('rec.micStopped'), id);
      });
    }
  }

  function explainOthersError(err) {
    let msg;
    if (err && err.code === 'NO_AUDIO') {
      msg = tr('rec.noAudio');
    } else if (err && err.name === 'NotAllowedError') {
      msg = tr('rec.shareCancelled');
    } else {
      msg = tr('rec.othersFailed', { error: (err && err.message) || tr('start.unknownError') });
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
      toast(tr('rec.othersCaptured'));
    } catch (err) {
      explainOthersError(err);
    }
  }

  function notice(text, retryFor) {
    const el = $('rec-notice');
    el.textContent = text;
    if (retryFor === 'others' && navigator.mediaDevices.getDisplayMedia) {
      const b = document.createElement('button');
      b.textContent = tr('rec.shareOthers');
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
        b.textContent = tr('rec.offActivate');
        b.addEventListener('click', retryOthers);
        state.appendChild(b);
      } else {
        state.textContent = tr('rec.off');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Pendant l'enregistrement
  // ---------------------------------------------------------------------------

  function tick() {
    if (!app.capture) return;
    $('timer').textContent = L.formatTime(meetingNow());
    // Santé toutes les 30 s : retard de la détection de parole, file d'attente
    const now = Date.now();
    if (now - (app.lastHealth || 0) > 30000) {
      app.lastHealth = now;
      const lag = Math.max(...['me', 'others'].map((id) => app.capture.lag(id)), 0);
      const vadTimeouts = Object.values(app.capture.sources).reduce((n, e) => n + (e.segmenter.vadTimeouts || 0), 0);
      journal('santé', {
        retard_s: Math.round(lag),
        file: app.queue.length,
        en_cours: app.inFlight,
        vad_lent: vadTimeouts,
        ok: app.stats.ok,
        échecs: app.stats.failed,
        mémoire_mo: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : undefined,
      });
      if (lag > 30 && !app.warnedLag) {
        app.warnedLag = true;
        notice(tr('rec.lag'));
      }
    }
    for (const id of ['me', 'others']) {
      const el = $('meter-' + id);
      const on = !!app.capture.sources[id];
      el.querySelector('.bar i').style.width = on ? Math.round(app.capture.level(id) * 100) + '%' : '0';
      el.classList.toggle('speaking', on && app.capture.isSpeaking(id));
      if (on) el.querySelector('.state').textContent = app.capture.isSpeaking(id) ? tr('rec.speaking') : '';
    }
  }

  function renderPauseLabels(paused) {
    $('pause').querySelector('.lbl').textContent = paused ? tr('rec.resume') : tr('rec.pause');
    $('rec-label').textContent = paused ? tr('rec.paused') : tr('rec.recording');
  }

  function togglePause() {
    if (!app.capture) return;
    const paused = !app.capture.paused;
    app.capture.setPaused(paused);
    if (paused) {
      app.pausedAt = meetingNow();
    } else if (app.pausedAt != null) {
      app.transcript.addPause(app.pausedAt, meetingNow());
      app.pausedAt = null;
    }
    renderPauseLabels(paused);
    $('pause').classList.toggle('paused', paused);
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
      p.textContent = tr('rec.placeholder');
      box.appendChild(p);
      return;
    }
    const frag = document.createDocumentFragment();
    for (const para of paras) {
      const p = document.createElement('p');
      if (para.draft) {
        p.className = 'draft';
        p.title = tr('rec.draftTitle');
      }
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = L.formatTime(para.start);
      const s = document.createElement('span');
      s.className = 's ' + para.source;
      s.textContent = tr('rec.speaker', { name: app.transcript.speakerName(para) });
      p.append(t, s, document.createTextNode(para.text));
      frag.appendChild(p);
    }
    box.replaceChildren(frag);
    if (nearBottom) box.scrollTop = box.scrollHeight;
    const lastPara = paras[paras.length - 1];
    $('last-line').textContent = lastPara
      ? tr('rec.lastLine', { name: app.transcript.speakerName(lastPara), text: lastPara.text })
      : '';
  }

  // ---------------------------------------------------------------------------
  // Fin de réunion
  // ---------------------------------------------------------------------------

  async function stop() {
    if (app.state !== 'recording') return;
    if (app.capture.paused && app.pausedAt != null) {
      app.transcript.meta.pauses.push({ from: app.pausedAt, to: meetingNow() });
      app.pausedAt = null;
    }
    app.transcript.meta.endedAt = Date.now();
    app.transcript.meta.endAbs = app.capture.now();
    clearInterval(app.timer);
    // Rien ne doit empêcher de terminer : chaque étape est protégée
    try {
      if (app.pip) closePip();
    } catch (e) {
      console.warn('Fermeture de la mini-fenêtre', e);
      app.pip = null;
    }
    setState('finishing');
    try {
      // termine les segments en cours -> file d'attente (10 s au plus)
      await Promise.race([app.capture.stop(), new Promise((r) => setTimeout(r, 10000))]);
    } catch (e) {
      console.warn('Arrêt de la capture', e);
    }
    app.capture = null;
    releaseWakeLock();
    pump();

    journal('fin', {
      durée_min: Math.round(((app.transcript.meta.endAbs || 0) - (app.transcript.meta.offset || 0)) / 60),
    });
    await finalizeMeeting(app.transcript, (text) => ($('finish-text').textContent = text));
    journal('couverture', app.transcript.coverageSummary());
    app.finalMarkdown = noteOf(app.transcript).content;
    app.doneFailures = [];
    renderDoneInfo();
    $('preview').textContent = app.finalMarkdown;
    renderVoices();
    renderPrompts();
    renderSuspects();
    renderGaps();
    renderFinished();
    setState('done');
    renderDrafts();
    const ended = app.transcript;
    await exportNote(ended);
    if (app.transcript === ended) renderExport(ended);
  }

  // Écran de fin : résumé de la réunion ou du fichier (réécrit si la langue change)
  function renderDoneInfo() {
    const t = app.transcript;
    if (!t) return;
    const paras = t.paragraphs().length;
    const cov = t.coverageSummary();
    const covered = cov.missing < 1 ? tr('done.allCovered') : '';
    if (t.meta.file) {
      const failures = app.doneFailures || [];
      $('done-info').textContent =
        tr('done.file', { name: t.meta.file.name, dur: L.formatTime(t.meta.file.duration), n: paras }) +
        covered +
        (failures.length
          ? tr('done.filesFailed', {
              n: failures.length,
              list: failures.map((f) => tr('done.fileFailed', f)).join(tr('done.listSep')),
            })
          : '');
      return;
    }
    const minutes = Math.max(1, Math.round((t.meta.endedAt - t.meta.startedAt) / 60000));
    const echo = t.meta.echoRemoved || 0;
    $('done-info').textContent =
      tr('done.meeting', { min: minutes, n: paras }) +
      covered +
      (t.meta.recovered >= 1 ? tr('done.recovered', { s: Math.round(t.meta.recovered) }) : '') +
      (echo ? tr('done.echo', { n: echo }) : '');
  }

  // Écran de fin : suivi de la retranscription des passages « rapides »
  function renderDrafts() {
    const t = app.transcript;
    const box = $('drafts');
    if (!t || app.state !== 'done') return;
    const n = t.draftCount();
    if (n) {
      box.textContent = tr('done.drafts', { n });
      box.hidden = false;
      app.improvedPending = true;
    } else if (app.improvedPending) {
      app.improvedPending = false;
      refreshNote(t);
      app.draftsDone = true;
      box.textContent = t.export && t.export.where === 'dossier' ? tr('done.draftsFolder') : tr('done.draftsDownload');
      box.hidden = false;
    } else {
      box.hidden = true;
    }
  }

  // Écran de fin : réunions enchaînées plus tôt dans la session (nouveau téléchargement possible)
  function renderFinished() {
    const box = $('finished-list');
    box.replaceChildren();
    for (const t of app.finished) {
      const b = document.createElement('button');
      b.type = 'button';
      const d = new Date(t.meta.startedAt);
      b.textContent =
        (t.meta.title || tr('meeting.untitled')) +
        ' · ' +
        d.toLocaleTimeString(L.i18n.locale(), { hour: '2-digit', minute: '2-digit' });
      b.title = tr('done.downloadAgain');
      b.addEventListener('click', () => {
        const n = noteOf(t);
        download(n.content, n.name);
      });
      box.appendChild(b);
    }
    $('finished').hidden = !app.finished.length;
  }

  // Écran de fin : passages que le moteur n'a pas pu transcrire (audio gardé en mémoire)
  function renderGaps() {
    const t = app.transcript;
    if (!t || app.state !== 'done') return;
    const gaps = (t.meta.gaps || []).length;
    const pending = app.failed.length;
    if (gaps) {
      const cov = t.coverageSummary();
      $('gaps-text').textContent = tr('done.gaps', { n: gaps, s: Math.round(cov.missing) });
      $('gaps-retry').hidden = !pending;
      $('gaps').hidden = false;
    } else if (app.gapsShown) {
      $('gaps-text').textContent = tr('done.gapsAll');
      $('gaps-retry').hidden = true;
      $('gaps').hidden = false;
    } else {
      $('gaps').hidden = true;
    }
    if (gaps) app.gapsShown = true;
  }

  function retryGaps() {
    const jobs = app.failed.splice(0);
    for (const j of jobs) {
      j.attempts = 0;
      app.queue.push(j);
    }
    $('gaps-retry').hidden = true;
    $('gaps-text').textContent = tr('done.retrying');
    pump();
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
      small.textContent = tr('voice.talk', { talk, at: L.formatTime(v.at) });
      label.appendChild(small);
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 60;
      input.placeholder = tr('voice.name');
      input.setAttribute('aria-label', v.label);
      input.value = (t.meta.names && t.meta.names[v.voice]) || '';
      input.addEventListener('input', () => {
        t.nameVoice(v.voice, input.value);
        refreshNote(t);
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
        b.textContent = tr('voice.recognized');
        label.appendChild(b);
      }
      const sample = document.createElement('div');
      sample.className = 'vsample';
      sample.textContent = tr('voice.sample', { text: v.sample });
      sample.title = v.sample;
      row.append(label, input, sample);
      box.appendChild(row);
    }
  }

  function reset() {
    L.Transcript.clearSaved();
    app.transcript = null;
    app.failed = [];
    app.finished = [];
    app.gapsShown = false;
    $('gaps').hidden = true;
    app.finalMarkdown = '';
    $('title').value = '';
    $('start').disabled = false;
    renderPauseLabels(false);
    $('pause').classList.remove('paused');
    $('rec-status').classList.remove('paused');
    $('rec-notice').hidden = true;
    $('timer').textContent = '00:00:00';
    $('last-line').textContent = '';
    app.improvedPending = false;
    app.draftsDone = false;
    $('next-meeting').hidden = false;
    setState('idle');
  }

  // ---------------------------------------------------------------------------
  // Utilitaires
  // ---------------------------------------------------------------------------

  // Fenêtre de Lowsper réduite à une barre (très basse) pendant l'enregistrement : même
  // présentation que la mini-fenêtre.
  function updateMini() {
    document.body.classList.toggle('mini', app.state === 'recording' && !app.pip && window.innerHeight <= 240);
  }
  window.addEventListener('resize', updateMini);

  function setState(state) {
    app.state = state;
    setTimeout(updateMini, 0);
    $('view-install').hidden = state !== 'install';
    $('view-idle').hidden = state !== 'idle';
    $('view-rec').hidden = state !== 'recording';
    $('view-import').hidden = state !== 'importing';
    $('view-finish').hidden = state !== 'finishing';
    $('view-done').hidden = state !== 'done';
    // Langue de l'interface : changeable seulement quand rien ne tourne (textes en cours stables)
    const busy = state === 'recording' || state === 'finishing' || state === 'importing';
    $('ui-lang').disabled = busy;
    $('ui-lang-busy').hidden = !busy;
    // Menu de langue de l'en-tête : sur l'écran de bienvenue seulement
    $('lang-menu').hidden = state !== 'install';
    if (state !== 'install') closeLangMenu();
    updateQueue();
  }

  // ---------------------------------------------------------------------------
  // Note de la réunion : profil de sortie, dossier de destination, mises à jour (notes.js)
  // ---------------------------------------------------------------------------
  const profileOf = (t) => L.Notes.list().find((p) => p.id === t.meta.profile) || L.Notes.current();
  const noteOf = (t) => L.Notes.note(t, profileOf(t));

  /**
   * Enregistre la note d'un transcript : dans le dossier du profil si l'accès est accordé, sinon
   * dans les Téléchargements. options.interactive : appelé depuis un clic (l'accès peut être
   * redemandé). options.update : mise à jour d'une note déjà écrite dans le dossier (jamais de
   * nouveau téléchargement).
   */
  async function exportNote(t, options) {
    const o = options || {};
    const profile = profileOf(t);
    const n = L.Notes.note(t, profile);
    const ex = (t.export = t.export || {});
    ex.profile = profile.name;
    let acc = { state: 'aucun' };
    try {
      acc = await L.Notes.access(profile, !!o.interactive);
    } catch (e) {
      console.warn('Accès au dossier de notes', e);
    }
    if (acc.state === 'accorde') {
      try {
        ex.savedAs = await L.Notes.writeNote(acc.dir, n.name, n.content, ex.where === 'dossier' ? ex.savedAs : null);
        Object.assign(ex, {
          where: 'dossier',
          folder: profile.folderName,
          at: Date.now(),
          error: null,
          pending: null,
        });
        journal('note', { où: 'dossier', profil: profile.format });
        return ex;
      } catch (e) {
        ex.error = (e && e.message) || String(e);
        journal('note-erreur', { erreur: ex.error.slice(0, 200) });
      }
    }
    if (o.update) return ex;
    if (o.interactive && ex.where === 'telechargements') return ex; // pas de second téléchargement
    download(n.content, n.name);
    Object.assign(ex, {
      where: 'telechargements',
      savedAs: n.name,
      at: Date.now(),
      pending: acc.state,
    });
    journal('note', { où: 'téléchargements', accès: acc.state });
    return ex;
  }

  // Après la réunion, chaque correction (voix nommée, mot corrigé, passage retranscrit) réécrit
  // la note du dossier, quelques secondes après la dernière modification.
  function refreshNote(t) {
    if (!t) return;
    app.finalMarkdown = noteOf(t).content;
    $('preview').textContent = app.finalMarkdown;
    if (!t.export || t.export.where !== 'dossier') return;
    clearTimeout(t.export.timer);
    t.export.timer = setTimeout(async () => {
      await exportNote(t, { update: true });
      if (t === app.transcript) renderExport(t);
    }, 1500);
  }

  /** Ligne de l'écran de fin : où est la note, et comment l'enregistrer dans le dossier. */
  function renderExport(t) {
    const ex = (t && t.export) || {};
    const box = $('export-info');
    const btn = $('export-folder');
    const hm = (ms) =>
      new Date(ms).toLocaleTimeString(L.i18n.locale(), {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    const profile = profileOf(t);
    btn.hidden = true;
    if (ex.where === 'dossier') {
      box.textContent = tr('export.folder', {
        folder: ex.folder,
        profile: profile.name,
        file: ex.savedAs,
        at: hm(ex.at),
      });
    } else if (ex.where === 'telechargements') {
      box.textContent = tr('export.downloads', { file: ex.savedAs });
      if (ex.pending === 'a-demander' || ex.pending === 'oublie') {
        btn.textContent =
          ex.pending === 'oublie'
            ? tr('export.repick', { folder: profile.folderName })
            : tr('export.alsoFolder', { folder: profile.folderName });
        btn.hidden = false;
        box.textContent +=
          ex.pending === 'oublie'
            ? tr('export.forgotten', { profile: profile.name })
            : tr('export.ask', { profile: profile.name });
      }
    } else box.textContent = '';
    if (ex.error) box.textContent += tr('export.writeError', { error: ex.error });
    box.hidden = !box.textContent;
  }

  async function saveToFolder() {
    const t = app.transcript;
    if (!t) return;
    const profile = profileOf(t);
    try {
      if (t.export && t.export.pending === 'oublie') {
        const name = await L.Notes.pickFolder(profile.id);
        if (!name) return;
        updateProfile(profile.id, { folderName: name });
      }
      const ex = await exportNote(t, { interactive: true });
      if (ex.where !== 'dossier') toast(tr('export.denied'), 6000);
    } catch (e) {
      toast(e.code === 'unsupported' ? e.message : tr('export.failed', { error: e.message }), 8000);
    }
    renderExport(t);
    renderProfileAccess();
  }

  // --- Consignes pour l'IA : éditeur, choix par profil, choix sur l'écran de fin ---
  function fillPromptSelect(sel, value) {
    const list = L.Notes.prompts();
    sel.replaceChildren(
      ...list.map((p) => {
        const o = document.createElement('option');
        o.value = p.id;
        o.textContent = p.name + (p.modified ? tr('ai.modified') : '');
        return o;
      })
    );
    sel.value = list.some((p) => p.id === value) ? value : list[0].id;
  }

  function renderPrompts() {
    const list = L.Notes.prompts();
    if (!list.some((p) => p.id === app.editPromptId)) app.editPromptId = list[0].id;
    fillPromptSelect($('ai-select'), app.editPromptId);
    const p = list.find((x) => x.id === app.editPromptId);
    $('ai-name').value = p.name;
    $('ai-name').disabled = p.builtin;
    $('ai-text').value = p.text;
    $('ai-remove').textContent = p.builtin ? tr('ai.restore') : tr('ai.delete');
    $('ai-remove').disabled = p.builtin && !p.modified;
    const prof = L.Notes.list().find((x) => x.id === app.editProfileId);
    if (prof) fillPromptSelect($('prof-prompt'), prof.prompt);
    if (app.transcript) fillPromptSelect($('ai-choice'), profileOf(app.transcript).prompt);
  }

  // --- Profils de sortie : choix à l'accueil, éditeur dans les paramètres ---
  function updateProfile(id, patch) {
    const all = L.Notes.list().map((p) => (p.id === id ? L.Notes.normalize(Object.assign(p, patch)) : p));
    L.Notes.saveAll(all);
    return all.find((p) => p.id === id);
  }

  function fillSelect(sel, profiles, value) {
    sel.replaceChildren(
      ...profiles.map((p) => {
        const o = document.createElement('option');
        o.value = p.id;
        o.textContent = p.name + (p.folderName ? tr('prof.inFolder', { folder: p.folderName }) : '');
        return o;
      })
    );
    sel.value = value;
  }

  // Exemple de nom de fichier, sur une réunion fictive
  function sampleTranscript() {
    const t = new L.Transcript({
      title: tr('sample.title'),
      startedAt: Date.now() - 3600000,
      endedAt: Date.now(),
      sources: ['me', 'others'],
      model: app.modelLabel,
      noteLang: L.i18n.lang(),
    });
    return t;
  }

  function renderProfiles() {
    const profiles = L.Notes.list();
    const current = L.Notes.current();
    renderPlace();
    if (!profiles.some((p) => p.id === app.editProfileId)) app.editProfileId = current.id;
    fillSelect($('prof-select'), profiles, app.editProfileId);
    const p = profiles.find((x) => x.id === app.editProfileId);
    $('prof-delete').disabled = p.id === L.Notes.DEFAULT_ID;
    $('prof-name').value = p.name;
    $('prof-folder').textContent = p.folderName
      ? tr('prof.folderNamed', { folder: p.folderName })
      : tr('prof.downloads');
    $('prof-folder-clear').hidden = !p.folderName;
    $('prof-classic').checked = p.format === 'classique';
    $('prof-custom').hidden = p.format === 'classique';
    $('prof-filename').value = p.fileName;
    $('prof-front').checked = !!p.front.enabled;
    const box = $('prof-front-fields');
    box.replaceChildren(
      ...L.Notes.FRONT_FIELDS.map(([key, label]) => {
        const l = document.createElement('label');
        l.className = 'check';
        const c = document.createElement('input');
        c.type = 'checkbox';
        c.checked = p.front.fields.includes(key);
        c.disabled = !p.front.enabled;
        c.addEventListener('change', () => {
          const q = L.Notes.list().find((x) => x.id === app.editProfileId);
          const fields = new Set(q.front.fields);
          if (c.checked) fields.add(key);
          else fields.delete(key);
          updateProfile(q.id, {
            front: Object.assign(q.front, { fields: [...fields] }),
          });
        });
        const sp = document.createElement('span');
        sp.textContent = label();
        l.append(c, sp);
        return l;
      })
    );
    $('prof-tags').value = p.front.tags;
    $('prof-extra').value = p.front.extra;
    for (const id of ['prof-tags', 'prof-extra']) $(id).disabled = !p.front.enabled;
    $('prof-links').checked = !!p.links;
    $('prof-template').value = p.template;
    fillPromptSelect($('prof-prompt'), p.prompt);
    renderProfileHints(p);
    renderProfileAccess();
  }

  function renderProfileHints(p) {
    const warn = [];
    const unknown = [...L.Notes.unknownVariables(p.template), ...L.Notes.unknownVariables(p.fileName)];
    if (unknown.length) warn.push(tr('prof.unknownVars', { list: unknown.map((v) => `{{${v}}}`).join(', ') }));
    const bad = L.Notes.badExtraLines(p.front.extra);
    if (bad.length) warn.push(tr('prof.badExtra', { list: bad.join(tr('done.listSep')) }));
    $('prof-warn').textContent = warn.join(' ');
    $('prof-filename-example').textContent =
      p.format === 'classique' ? '' : tr('prof.example', { name: L.Notes.note(sampleTranscript(), p).name });
  }

  // Champs texte de l'éditeur : enregistrés à chaque frappe
  function bindProfileField(id, apply) {
    $(id).addEventListener('input', () => {
      const p = L.Notes.list().find((x) => x.id === app.editProfileId);
      const q = updateProfile(p.id, apply(p, $(id)));
      renderProfileHints(q);
      if (id === 'prof-name') {
        fillSelect($('prof-select'), L.Notes.list(), q.id);
        renderPlace();
      }
    });
  }

  /** Accueil : nom du profil choisi, dans la ligne « Enregistrer la note dans ». */
  function renderPlace() {
    $('place-current').textContent = L.Notes.current().name;
  }

  /** Accueil : le dossier du profil choisi demande-t-il un clic avant la réunion ? */
  async function renderProfileAccess() {
    const p = L.Notes.current();
    let acc = { state: 'aucun' };
    try {
      acc = await L.Notes.access(p, false);
    } catch {}
    const box = $('profile-access');
    app.profileAccess = acc.state;
    if (acc.state === 'a-demander') {
      $('profile-access-text').textContent = tr('prof.access.ask', { name: p.name, folder: p.folderName });
      $('profile-allow').textContent = tr('prof.access.allow');
    } else if (acc.state === 'oublie') {
      $('profile-access-text').textContent = tr('prof.access.forgotten', { name: p.name, folder: p.folderName });
      $('profile-allow').textContent = tr('prof.access.repick');
    }
    box.hidden = !(acc.state === 'a-demander' || acc.state === 'oublie');
  }

  async function allowProfileFolder() {
    const p = L.Notes.current();
    try {
      if (app.profileAccess === 'oublie') {
        const name = await L.Notes.pickFolder(p.id);
        if (name) updateProfile(p.id, { folderName: name });
      } else await L.Notes.access(p, true);
    } catch (e) {
      toast(e.code === 'unsupported' ? e.message : tr('prof.folderError', { error: e.message }), 8000);
    }
    renderProfiles();
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
    toast(tr('done.copied'));
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
    if (app.state === 'recording' || app.state === 'finishing' || app.state === 'importing' || app.installing) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  function renderRecovery() {
    const saved = app.recovered;
    if (!saved) return;
    const d = new Date(saved.meta.startedAt);
    const last = saved.lines[saved.lines.length - 1];
    const loc = L.i18n.locale();
    $('recover-info').textContent = tr('recover.info', {
      date: d.toLocaleDateString(loc),
      time: d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }),
      min: Math.max(1, Math.round((last ? last.end : 0) / 60)),
    });
  }

  // Session interrompue (navigateur fermé pendant une réunion)
  function checkRecovery() {
    const saved = L.Transcript.loadUnfinished();
    if (!saved) return;
    const last = saved.lines[saved.lines.length - 1];
    app.recovered = saved;
    renderRecovery();
    $('recover').hidden = false;
    $('recover-download').addEventListener('click', () => {
      saved.meta.endedAt = saved.meta.startedAt + Math.round((last ? last.end : 0) * 1000);
      const n = noteOf(saved);
      download(n.content, n.name);
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
      if (!auto) toast(tr('speed.notReady'));
      return;
    }
    const out = $('speed-result');
    out.textContent = tr('speed.measuring');
    $('speed-test').disabled = true;
    try {
      const b = await app.workers[0].bench();
      const n = app.limits.normal;
      const load = L.estimateLoad(b, n);
      const perMin = Math.round(load * 60);
      const model = app.modelLabel;
      let advice;
      if (load <= 0.5) advice = tr('speed.comfortable');
      else if (load <= 0.9) advice = tr('speed.ok');
      else if (load <= 1.3) advice = tr('speed.tight');
      else advice = app.fastWorkers.length ? tr('speed.fastLane') : tr('speed.tooSlow');
      out.textContent = tr('speed.result', {
        model,
        perMin,
        pct: Math.round(load * 100),
        n,
        boost: app.limits.boost > n ? app.limits.boost : 0,
        fast: app.fastWorkers.length > 0,
        advice,
      });
      store.set('lowsper.speed.' + app.modelId, JSON.stringify({ load, at: Date.now() }));
    } catch (e) {
      out.textContent = tr('speed.failed', { error: e.message });
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
      ? tr('memory.list', { n: m.count, names: m.names().join(', ') })
      : tr('memory.none');
  }

  // ---------------------------------------------------------------------------
  // Mini-fenêtre (Document Picture-in-Picture : Edge et Chrome récents)
  // ---------------------------------------------------------------------------

  app.pip = null;
  app.closePip = () => closePip(); // tests

  async function openPip(opts) {
    const quiet = opts && opts.quiet;
    if (app.pip || app.state !== 'recording') return;
    if (!('documentPictureInPicture' in window)) {
      if (!quiet) toast(tr('pip.unsupported'), 7000);
      return;
    }
    let win;
    try {
      // Taille d'un appel Teams réduit : une barre, la dernière phrase en dessous
      // Une seule ligne, comme un appel Teams réduit (la flèche déplie la dernière phrase)
      win = await window.documentPictureInPicture.requestWindow({
        width: 300,
        height: 48,
      });
    } catch (e) {
      if (!quiet) toast(tr('pip.failed', { error: e.message }), 6000);
      return;
    }
    // Même feuille de style (fichier local : autorisé par la politique de sécurité)
    const link = win.document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('app/css/lowsper.css', location.href).href;
    win.document.head.appendChild(link);
    win.document.title = 'Lowsper';
    win.document.documentElement.lang = L.i18n.lang();
    L.Theme.apply(L.Theme.stored(), win.document);
    win.document.body.className = 'pip mini' + (document.body.classList.contains('expanded') ? ' expanded' : '');
    win.document.body.appendChild($('rec-core'));
    $('pip-placeholder').hidden = false;
    app.pip = win;
    updateMini();
    win.addEventListener('pagehide', closePip, { once: true });
  }

  function closePip() {
    const w = app.pip;
    app.pip = null;
    try {
      const core = (w && !w.closed && w.document.getElementById('rec-core')) || $('rec-core');
      const view = $('view-rec');
      if (core) view.insertBefore(document.adoptNode(core), view.firstChild);
    } catch (e) {
      console.warn('Retour des commandes dans la page', e);
    }
    $('pip-placeholder').hidden = true;
    updateMini();
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

  // Nom d'un modèle dans la langue de l'interface (repli : celui du manifeste)
  const modelLabel = (m) =>
    L.t('model.label.' + m.id) !== 'model.label.' + m.id ? tr('model.label.' + m.id) : m.label;

  // Modèle « processeur » autre que Whisper base : Whisper base l'accompagne (voie rapide de secours)
  const needsBackup = (m) => m.device !== 'webgpu' && m.id !== 'whisper-base';

  /**
   * Écran de bienvenue (premier lancement), ou ajout d'un modèle depuis les paramètres : ce qui a
   * été détecté, un seul modèle à choisir, le recommandé présélectionné, les modèles inutilisables
   * grisés avec leur raison, le dossier, un seul bouton (decision.md §26).
   */
  function showInstall() {
    const catalog = (self.LOWSPER_MANIFEST && self.LOWSPER_MANIFEST.catalog) || [];
    const installed = self.LOWSPER_INSTALLED || [];
    const installedIds = installed.map((m) => m.id);
    const adding = installed.length > 0;
    const hw = L.Recommend.hardware(navigator, app.gpu);
    const plan = L.Recommend.choose(catalog, hw, installedIds);
    app.installPlan = plan;
    $('install-title').textContent = tr(adding ? 'install.titleAdd' : 'install.title');
    $('view-install').querySelector('.lead').textContent = tr(adding ? 'install.leadAdd' : 'install.lead');
    renderHardware(hw);
    // Choix présélectionné : celui déjà fait sur cet écran, sinon le recommandé, sinon le premier possible
    const free = (id) => plan.options.some((o) => o.id === id && o.usable && !o.installed);
    if (!free(app.installChoice)) {
      app.installChoice = free(plan.recommended)
        ? plan.recommended
        : (plan.options.find((o) => o.usable && !o.installed) || {}).id || null;
    }
    const box = $('model-choices');
    box.replaceChildren();
    // Modèles utilisables d'abord, ceux qui demandent une carte graphique absente ensuite
    for (const o of [...plan.options.filter((x) => x.usable), ...plan.options.filter((x) => !x.usable)]) {
      const m = catalog.find((x) => x.id === o.id);
      const label = document.createElement('label');
      label.className = 'model-row';
      if (!o.usable) label.classList.add('unusable');
      if (o.installed) label.classList.add('done');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'model-choice';
      input.value = m.id;
      input.checked = m.id === app.installChoice;
      input.disabled = !o.usable || o.installed || !!app.installing;
      input.addEventListener('change', () => {
        app.installChoice = m.id;
        updateInstallButton();
      });
      const text = document.createElement('span');
      text.className = 'model-text';
      const name = document.createElement('span');
      name.className = 'model-name';
      const strong = document.createElement('strong');
      strong.textContent = modelLabel(m);
      name.appendChild(strong);
      const badge = (key, cls) => {
        const b = document.createElement('span');
        b.className = 'badge' + (cls ? ' ' + cls : '');
        b.textContent = tr(key);
        name.appendChild(b);
      };
      if (o.id === plan.recommended && !o.installed) badge('install.best', 'best');
      if (o.installed) badge('install.installed', 'auto');
      const desc = document.createElement('span');
      desc.className = 'desc';
      // Texte court du catalogue si connu, sinon la description du manifeste
      const key = 'model.short.' + m.id;
      const parts = [L.t(key) !== key ? tr(key) : m.description || ''];
      const base = catalog.find((x) => x.id === 'whisper-base');
      const withBase = needsBackup(m) && base && !installedIds.includes(base.id);
      if (withBase && o.usable) parts.push(tr('install.withBackup'));
      if (!o.usable) parts.push(tr('install.reasonGpu'));
      desc.textContent = parts.filter(Boolean).join(' ');
      text.append(name, desc);
      const size = document.createElement('span');
      size.className = 'size';
      const bytes = modelSize(m) + (withBase ? modelSize(base) : 0);
      size.textContent = tr('install.size', { mb: Math.round(bytes / 1e6) });
      label.append(input, text, size);
      box.appendChild(label);
    }
    $('install-back').hidden = !adding;
    $('page-folder').textContent = L.pageFolder();
    $('temp-warning').hidden = !L.openedFromTemp();
    $('install-error').hidden = true;
    updateInstallButton();
    setState('install');
  }

  /** Puces « Détecté sur ce PC » : processeurs logiques, mémoire, carte graphique. */
  function renderHardware(hw) {
    const chips = [];
    if (hw.threads) chips.push(tr('install.threads', { n: hw.threads }));
    if (hw.memory) chips.push(tr('install.memory', { n: hw.memory }));
    chips.push(tr(app.gpuChecked ? (hw.gpu ? 'install.gpuYes' : 'install.gpuNo') : 'install.gpuChecking'));
    $('hw-chips').replaceChildren(
      ...chips.map((c) => {
        const li = document.createElement('li');
        li.textContent = c;
        return li;
      })
    );
  }

  // Modèles à télécharger : le modèle choisi, plus Whisper base avec un modèle processeur
  // (voie rapide de secours), s'il n'est pas déjà installé.
  function installList() {
    const catalog = self.LOWSPER_MANIFEST.catalog;
    const installedIds = (self.LOWSPER_INSTALLED || []).map((m) => m.id);
    const picked = catalog.find((m) => m.id === app.installChoice && !installedIds.includes(m.id));
    if (!picked) return [];
    const list = [picked];
    const fast = catalog.find((m) => m.id === 'whisper-base');
    if (needsBackup(picked) && fast && !installedIds.includes(fast.id)) list.push(fast);
    return list;
  }

  function updateInstallButton() {
    const list = installList();
    const mb = Math.round(list.reduce((n, m) => n + modelSize(m), 0) / 1e6);
    const btn = $('install');
    btn.disabled = !list.length || !!app.installing;
    btn.textContent = list.length ? tr('install.cta', { mb }) : tr('install.nothing');
    $('install-hint').hidden = !list.length;
  }

  async function install() {
    if (app.installing) return;
    const catalog = self.LOWSPER_MANIFEST.catalog;
    const list = installList();
    if (!list.length) return;
    const err = $('install-error');
    err.hidden = true;
    if (!L.canInstall()) {
      err.textContent = L.Browser.folderMessage('model');
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
    // Le dossier sert aussi à conserver les réglages (sigles...) même si le navigateur les efface
    L.Settings.setFolder(folder)
      .then(() => L.Settings.save({ force: true }))
      .then(renderSaved)
      .catch(() => {});
    app.installing = true;
    $('install').disabled = true;
    document.querySelectorAll('input[name="model-choice"]').forEach((i) => (i.disabled = true));
    $('install').textContent = tr('install.running');
    $('install-progress').hidden = false;
    setEngine('loading', 'engine.downloading');
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
            tr('install.progress', {
              done: Math.round(done / 1e6),
              total: Math.round(grand / 1e6),
              speed: speed.toFixed(1),
            }) +
            (left > 2 ? tr('install.left', { left: left > 90 ? Math.round(left / 60) + ' min' : left + ' s' }) : '') +
            (list.length > 1 ? ` · ${modelLabel(m)}` : '');
        });
        before += m.files.reduce((k, f) => k + f.size, 0);
      }
      // Modèle utilisé ensuite : celui déjà choisi s'il existe, sinon le premier utilisable sur ce PC
      // (dans l'ordre du catalogue : recommandé d'abord).
      const usable = (m) => m.device !== 'webgpu' || app.gpu;
      const nowInstalled = (self.LOWSPER_INSTALLED || []).map((m) => m.id);
      const current = store.get('lowsper.model');
      if (!current || !nowInstalled.includes(current)) {
        const first =
          catalog.find((m) => nowInstalled.includes(m.id) && usable(m) && m.id !== 'whisper-base') ||
          catalog.find((m) => nowInstalled.includes(m.id) && usable(m));
        if (first) store.set('lowsper.model', first.id);
      }
      $('install-text').textContent = list.length > 1 ? tr('install.doneMany') : tr('install.doneOne');
      app.installing = false;
      setTimeout(() => location.reload(), 400);
    } catch (e) {
      console.error(e);
      app.installing = false;
      $('install').disabled = false;
      showInstall(); // réaffiche les cases (et ce qui a déjà été installé)
      $('install-progress').hidden = true;
      setEngine('error', 'engine.installStopped');
      let msg = e.message || String(e);
      if (e.code === 'NETWORK' || e.code === 'HTTP') msg += tr('install.network');
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
      o.textContent = modelLabel(m);
      o.selected = m.id === current;
      sel.appendChild(o);
    }
    $('model-field').hidden = installed.length < 2;
    $('model-current').textContent = tr('set.modelCurrent', {
      current: modelLabel(installed.find((m) => m.id === current) || installed[0]),
      list: installed.map(modelLabel).join(', '),
    });
  }

  // ---------------------------------------------------------------------------
  // Branchements
  // ---------------------------------------------------------------------------

  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    $('with-others').checked = false;
    $('with-others').disabled = true;
    $('with-others').parentElement.title = tr('set.withOthersUnsupported');
  }

  $('install').addEventListener('click', install);
  $('speed-test').addEventListener('click', () => speedTest(false));
  // Thème clair / sombre : bouton de l'en-tête et réglage « Affichage »
  function renderTheme() {
    const mode = L.Theme.effective();
    const btn = $('theme-toggle');
    btn.dataset.mode = mode;
    btn.setAttribute('aria-label', mode === 'dark' ? tr('theme.toLight') : tr('theme.toDark'));
    $('theme').value = L.Theme.stored();
    if (app.pip) L.Theme.apply(L.Theme.stored(), app.pip.document);
  }
  $('theme-toggle').addEventListener('click', () => {
    L.Theme.toggle();
    renderTheme();
  });
  $('theme').addEventListener('change', (e) => {
    L.Theme.set(e.target.value);
    renderTheme();
  });
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderTheme);
  } catch {
    /* navigateur ancien : le thème suit au prochain lancement */
  }
  renderTheme();

  // Langue de l'interface (i18n.js) : réglage « Affichage », choix mémorisé (lowsper.opt.lang)
  $('ui-lang').value = L.i18n.lang();
  $('ui-lang').addEventListener('change', (e) => L.i18n.setLang(e.target.value));
  /**
   * Réécrit les textes calculés par ce fichier dans la nouvelle langue. Les textes fixes de la
   * page sont déjà traduits par i18n.js. La note d'une réunion garde la langue qu'elle avait au
   * début (meta.noteLang) : seule l'interface change.
   */
  function relabel() {
    $('ui-lang').value = L.i18n.lang();
    if (app.pip) L.i18n.apply(app.pip.document);
    if (app.engineStatus) setEngine(app.engineStatus.state, app.engineStatus.key, app.engineStatus.vars);
    renderTheme();
    renderSaved();
    renderMemory();
    renderFixes();
    renderVariables();
    renderProfiles();
    renderPrompts();
    renderLocalAI(!!lai.abort);
    if (lai.status) $('lai-status').textContent = tr(lai.status);
    for (const el of document.querySelectorAll('#vocab-list [data-vocab]'))
      el.querySelector('span').textContent = L.Vocabulary.label(el.dataset.vocab);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia)
      $('with-others').parentElement.title = tr('set.withOthersUnsupported');
    const installed = self.LOWSPER_INSTALLED || [];
    if (installed.length && app.modelId) renderModelSelect(installed, app.modelId);
    else $('model-current').textContent = tr('set.noModel');
    const inUse = installed.find((m) => m.id === app.modelId);
    if (inUse) $('foot-model').textContent = modelLabel(inUse);
    const known = app.modelId && store.get('lowsper.speed.' + app.modelId);
    if (known) {
      try {
        $('speed-result').textContent = tr('speed.last', { pct: Math.round(JSON.parse(known).load * 100) });
      } catch {}
    }
    renderPauseLabels(false);
    if (app.state === 'install') {
      // Pendant le téléchargement, l'écran n'est pas redessiné : seul le bouton change de langue
      if (app.installing) $('install').textContent = tr('install.running');
      else showInstall();
    }
    if (app.state === 'done' && app.transcript) {
      renderDoneInfo();
      renderExport(app.transcript);
      renderVoices();
      renderSuspects();
      renderGaps();
      renderFinished();
      if (app.draftsDone) app.improvedPending = true;
      renderDrafts();
    }
    if (!$('recover').hidden) renderRecovery();
    updateQueue();
  }
  L.i18n.onChange(relabel);

  // Menu de langue de l'écran de bienvenue (composant commun, menu.js)
  const LANG_NAMES = { fr: 'Français', en: 'English' };
  app.langMenu = L.Menu.attach({
    button: $('lang-btn'),
    menu: $('lang-list'),
    items: () => L.i18n.LANGS.map((l) => ({ value: l, label: LANG_NAMES[l], lang: l, checked: l === L.i18n.lang() })),
    onSelect: (l) => L.i18n.setLang(l),
  });
  function renderLangMenu() {
    const lang = L.i18n.lang();
    $('lang-current').textContent = LANG_NAMES[lang];
    $('lang-current').lang = lang;
  }
  // Appelée aussi par setState(), avant que le menu existe : déclaration de fonction
  function closeLangMenu() {
    if (app.langMenu) app.langMenu.close(false);
  }
  renderLangMenu();
  L.i18n.onChange(renderLangMenu);

  $('power').value = store.get('lowsper.power') || 'balanced';
  $('power').addEventListener('change', (e) => {
    store.set('lowsper.power', e.target.value);
    if (app.mainAssets) app.limits = computeLimits(app.mainAssets.device);
    pump();
  });
  $('memory-on').addEventListener('change', (e) => {
    if (e.target.checked && !confirm(tr('memory.confirm'))) {
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
    if (!confirm(tr('memory.clearConfirm'))) return;
    app.memory.clear();
    renderMemory();
    toast(tr('memory.cleared'));
  });
  renderMemory();
  $('install-back').addEventListener('click', () => setState('idle'));
  $('add-model').addEventListener('click', () => {
    closeSettings();
    if (app.state === 'recording' || app.state === 'finishing') {
      toast(tr('install.busy'));
      return;
    }
    showInstall();
  });
  // Roue crantée : panneau Paramètres, accessible à tout moment
  const openSettings = () => {
    renderProfiles();
    renderPrompts();
    renderMemory();
    renderFixes();
    const d = $('settings');
    if (!d.open) d.showModal();
  };
  function closeSettings() {
    const d = $('settings');
    if (d.open) d.close();
  }
  // À la fermeture des paramètres (geste de l'utilisateur) : copie des réglages dans le dossier
  // Lowsper si quelque chose a changé et que le dossier est connu.
  $('settings').addEventListener('close', () => {
    L.Settings.save({ interactive: true })
      .then(renderSaved)
      .catch((e) => console.warn('Réglages non copiés dans le dossier', e));
  });
  $('settings-keep').addEventListener('click', async () => {
    try {
      const r = await L.Settings.save({ interactive: true, force: true });
      if (r === 'saved') toast(tr('set.kept'));
    } catch (e) {
      if (e.code !== 'CANCELLED') toast(e.message, 7000);
    }
    renderSaved();
  });
  function renderSaved() {
    const st = L.Settings.status();
    const line = $('settings-saved');
    if (st.savedAt) {
      const d = new Date(st.savedAt);
      const loc = L.i18n.locale();
      line.textContent = tr('set.savedLine', {
        when: d.toLocaleDateString(loc) + ' ' + d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }),
        dirty: st.dirty,
      });
      $('settings-keep').hidden = true;
    } else {
      line.textContent = tr('set.notSaved');
      $('settings-keep').hidden = false;
    }
  }
  renderSaved();
  if (L.Settings.status().restored.length) {
    toast(tr('set.restored'), 7000);
  }
  $('settings-open').addEventListener('click', openSettings);
  $('settings-close').addEventListener('click', closeSettings);
  $('settings').addEventListener('click', (e) => {
    if (e.target === $('settings')) closeSettings(); // clic à côté du panneau
  });
  $('model').addEventListener('change', (e) => {
    store.set('lowsper.model', e.target.value);
    location.reload();
  });
  // Vocabulaires métier intégrés (vocabulary.js) : cases à cocher, mémorisées sur ce poste
  const vocabSaved = (store.get('lowsper.vocab') || '').split(',').filter(Boolean);
  for (const [id, p] of Object.entries(L.Vocabulary.PRESETS)) {
    const label = document.createElement('label');
    label.className = 'check';
    label.title = p.terms;
    label.innerHTML = '<input type="checkbox"><span></span>';
    label.querySelector('span').textContent = L.Vocabulary.label(id);
    label.dataset.vocab = id;
    const box = label.querySelector('input');
    box.value = id;
    box.checked = vocabSaved.includes(id);
    box.addEventListener('change', () => store.set('lowsper.vocab', selectedVocab().join(',')));
    $('vocab-list').appendChild(label);
  }
  // Langue et options : mémorisées comme le reste
  const lang = store.get('lowsper.language');
  if (lang && [...$('language').options].some((o) => o.value === lang)) $('language').value = lang;
  $('language').addEventListener('change', (e) => store.set('lowsper.language', e.target.value));
  for (const id of ['with-others', 'distinguish', 'autopip']) {
    const v = store.get('lowsper.opt.' + id);
    if (v != null && !$(id).disabled) $(id).checked = v === '1';
    $(id).addEventListener('change', (e) => store.set('lowsper.opt.' + id, e.target.checked ? '1' : '0'));
  }
  // Nombre de personnes (réglage gardé, vide = automatique) : un plafond pour la distinction des voix
  $('people').value = store.get('lowsper.opt.people') || '';
  $('people').addEventListener('input', (e) => {
    const n = parseInt(e.target.value, 10);
    store.set('lowsper.opt.people', n >= 2 && n <= 30 ? String(n) : '');
  });
  $('glossary').value = store.get('lowsper.glossary') || '';
  $('glossary').addEventListener('input', (e) => store.set('lowsper.glossary', e.target.value));
  $('fix-apply').addEventListener('click', applyFix);
  $('gaps-retry').addEventListener('click', retryGaps);
  $('journal-dl').addEventListener('click', () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const name = `lowsper-journal_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}h${pad(d.getMinutes())}.txt`;
    const head = tr('done.journalHead');
    download(head + app.journalLines.join('\n') + '\n', name);
  });
  $('set-fix-add').addEventListener('click', addFixFromSettings);
  $('set-fix-right').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addFixFromSettings();
  });
  $('fix-right').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyFix();
  });
  renderFixes();
  /**
   * « Démarrer » : la fenêtre « Avant de commencer » explique les trois étapes à venir, sauf si
   * l'utilisateur a coché « Ne plus afficher ». Le clic sur « Continuer » sert de geste de
   * l'utilisateur pour le partage d'écran, que le navigateur exige.
   */
  function askBeforeStart() {
    if (app.state !== 'idle' || $('start').disabled) return;
    if (store.get('lowsper.opt.skipBefore') === '1') return start();
    $('before-skip').checked = false;
    $('before').showModal();
    $('before-continue').focus();
  }
  $('start').addEventListener('click', askBeforeStart);
  $('before-continue').addEventListener('click', () => {
    if ($('before-skip').checked) {
      store.set('lowsper.opt.skipBefore', '1');
      $('show-before').checked = false;
    }
    $('before').close();
    start();
  });
  $('before-cancel').addEventListener('click', () => $('before').close());
  // Paramètres : remettre la fenêtre après « Ne plus afficher »
  $('show-before').checked = store.get('lowsper.opt.skipBefore') !== '1';
  $('show-before').addEventListener('change', (e) => store.set('lowsper.opt.skipBefore', e.target.checked ? '0' : '1'));
  // Profils de sortie
  $('export-folder').addEventListener('click', saveToFolder);
  // « Enregistrer la note dans » : menu des profils (composant commun, menu.js)
  L.Menu.attach({
    button: $('place-btn'),
    menu: $('place-list'),
    items: () =>
      L.Notes.list().map((p) => ({
        value: p.id,
        label: p.name,
        sub: p.folderName ? tr('home.inFolder', { folder: p.folderName }) : tr('home.downloads'),
        checked: p.id === L.Notes.current().id,
      })),
    actions: () => [{ id: 'new', label: tr('home.newPlace') }],
    onSelect: (id) => {
      L.Notes.select(id);
      renderPlace();
      renderProfileAccess();
    },
    onAction: () => {
      // Nouvel emplacement : un nouveau profil, dans les paramètres
      openSettings();
      $('prof-new').click();
      $('prof-title').scrollIntoView({ block: 'start' });
    },
  });
  $('profile-allow').addEventListener('click', allowProfileFolder);
  $('prof-select').addEventListener('change', () => {
    app.editProfileId = $('prof-select').value;
    renderProfiles();
  });
  $('prof-new').addEventListener('click', () => {
    const p = L.Notes.newProfile(tr('prof.new'), L.Notes.list());
    L.Notes.saveAll([...L.Notes.list(), p]);
    app.editProfileId = p.id;
    renderProfiles();
    $('prof-name').select();
  });
  $('prof-delete').addEventListener('click', async () => {
    const p = L.Notes.list().find((x) => x.id === app.editProfileId);
    if (!p || p.id === L.Notes.DEFAULT_ID || !confirm(tr('prof.deleteConfirm', { name: p.name }))) return;
    await L.Notes.forgetFolder(p.id);
    L.Notes.saveAll(L.Notes.list().filter((x) => x.id !== p.id));
    if (L.Notes.current().id === p.id) L.Notes.select(L.Notes.DEFAULT_ID);
    app.editProfileId = L.Notes.DEFAULT_ID;
    renderProfiles();
  });
  $('prof-folder-pick').addEventListener('click', async () => {
    try {
      const name = await L.Notes.pickFolder(app.editProfileId);
      if (name) updateProfile(app.editProfileId, { folderName: name });
    } catch (e) {
      toast(e.code === 'unsupported' ? e.message : tr('prof.folderError', { error: e.message }), 8000);
    }
    renderProfiles();
  });
  $('prof-folder-clear').addEventListener('click', async () => {
    await L.Notes.forgetFolder(app.editProfileId);
    updateProfile(app.editProfileId, { folderName: '' });
    renderProfiles();
  });
  $('prof-classic').addEventListener('change', () => {
    updateProfile(app.editProfileId, {
      format: $('prof-classic').checked ? 'classique' : 'modele',
    });
    renderProfiles();
  });
  $('prof-front').addEventListener('change', () => {
    const p = L.Notes.list().find((x) => x.id === app.editProfileId);
    updateProfile(p.id, {
      front: Object.assign(p.front, { enabled: $('prof-front').checked }),
    });
    renderProfiles();
  });
  $('prof-prompt').addEventListener('change', () =>
    updateProfile(app.editProfileId, { prompt: $('prof-prompt').value })
  );
  $('ai-select').addEventListener('change', () => {
    app.editPromptId = $('ai-select').value;
    renderPrompts();
  });
  $('ai-new').addEventListener('click', () => {
    app.editPromptId = L.Notes.newPrompt(tr('ai.new'));
    renderPrompts();
    $('ai-name').select();
  });
  $('ai-remove').addEventListener('click', () => {
    const p = L.Notes.prompts().find((x) => x.id === app.editPromptId);
    if (!p.builtin && !confirm(tr('ai.deleteConfirm', { name: p.name }))) return;
    L.Notes.removePrompt(p.id);
    renderPrompts();
  });
  $('ai-name').addEventListener('input', () => {
    L.Notes.savePrompt(app.editPromptId, {
      name: $('ai-name').value.trim() || tr('ai.fallbackName'),
    });
    fillPromptSelect($('ai-select'), app.editPromptId);
  });
  $('ai-text').addEventListener('input', () => {
    L.Notes.savePrompt(app.editPromptId, { text: $('ai-text').value });
    const p = L.Notes.prompts().find((x) => x.id === app.editPromptId);
    $('ai-remove').disabled = p.builtin && !p.modified;
  });
  // --- IA intégrée du navigateur : sonde et essai sur une réunion fictive (decision.md §23) ---
  const lai = { states: [], trials: {}, abort: null };
  function laiReport() {
    return L.LocalAI.report({
      probe: lai.states,
      trials: lai.trials,
      browser: L.Browser.name(),
      userAgent: navigator.userAgent,
      protocol: location.protocol,
      secure: window.isSecureContext,
    });
  }
  function renderLocalAI(busy) {
    const ul = $('lai-states');
    ul.textContent = '';
    for (const s of lai.states) {
      const li = document.createElement('li');
      const b = document.createElement('strong');
      b.textContent = tr('rec.speaker', { name: L.LocalAI.apiName(s.id) }) + ' ';
      li.appendChild(b);
      const explain = L.LocalAI.stateText(s.state);
      li.appendChild(document.createTextNode(explain + (s.detail ? ` (${s.detail})` : '')));
      li.className = L.LocalAI.usable(s.state) ? 'ok' : 'ko';
      ul.appendChild(li);
    }
    const any = lai.states.some((s) => L.LocalAI.usable(s.state));
    $('lai-probe').disabled = !!busy;
    $('lai-trial').hidden = !any;
    $('lai-trial').disabled = !!busy;
    $('lai-stop').hidden = !busy;
    $('lai-copy').hidden = !lai.states.length || !!busy;
    const results = Object.keys(lai.trials).length;
    $('lai-out').hidden = !results;
    if (results) $('lai-out').textContent = laiReport().split('\n').slice(2).join('\n');
  }
  $('lai-probe').addEventListener('click', async () => {
    $('lai-status').textContent = tr('lai.checking');
    lai.trials = {};
    renderLocalAI(true);
    lai.states = await L.LocalAI.probe();
    const any = lai.states.some((s) => L.LocalAI.usable(s.state));
    lai.status = any ? 'lai.usableHere' : 'lai.notUsable';
    $('lai-status').textContent = tr(lai.status);
    renderLocalAI(false);
  });
  $('lai-trial').addEventListener('click', async () => {
    const todo = lai.states.filter((s) => L.LocalAI.usable(s.state));
    if (todo.some((s) => s.state !== 'available') && !confirm(tr('lai.downloadConfirm'))) return;
    lai.abort = new AbortController();
    lai.trials = {};
    renderLocalAI(true);
    for (const s of todo) {
      if (lai.abort.signal.aborted) break;
      $('lai-status').textContent = tr('lai.writing', { name: L.LocalAI.apiName(s.id) });
      try {
        lai.trials[s.id] = await L.LocalAI.trial(s.id, {
          signal: lai.abort.signal,
          onProgress: (f) => {
            $('lai-progress').hidden = f >= 1;
            $('lai-progress').value = f;
            $('lai-status').textContent = tr('lai.downloadPct', { pct: Math.round(f * 100) });
          },
        });
      } catch (e) {
        lai.trials[s.id] = {
          error: (e && (e.name ? e.name + ' : ' : '') + e.message) || String(e),
        };
      }
      $('lai-progress').hidden = true;
      renderLocalAI(true);
    }
    const aborted = lai.abort.signal.aborted;
    lai.abort = null;
    lai.status = aborted ? 'lai.stopped' : 'lai.done';
    $('lai-status').textContent = tr(lai.status);
    renderLocalAI(false);
  });
  $('lai-stop').addEventListener('click', () => lai.abort && lai.abort.abort());
  $('lai-copy').addEventListener('click', () => copy(laiReport()));
  $('prof-links').addEventListener('change', () =>
    updateProfile(app.editProfileId, { links: $('prof-links').checked })
  );
  bindProfileField('prof-name', (p, el) => ({
    name: el.value.trim() || tr('prof.fallbackName'),
  }));
  bindProfileField('prof-filename', (p, el) => ({ fileName: el.value }));
  bindProfileField('prof-template', (p, el) => ({ template: el.value }));
  bindProfileField('prof-tags', (p, el) => ({
    front: Object.assign(p.front, { tags: el.value }),
  }));
  bindProfileField('prof-extra', (p, el) => ({
    front: Object.assign(p.front, { extra: el.value }),
  }));
  $('prof-template-reset').addEventListener('click', () => {
    updateProfile(app.editProfileId, {
      template: L.Notes.DEFAULT_TEMPLATE,
      fileName: L.Notes.DEFAULT_FILENAME,
    });
    renderProfiles();
  });
  function renderVariables() {
    const dl = $('prof-vars');
    dl.replaceChildren();
    for (const [name, desc] of L.Notes.VARIABLES) {
      const dt = document.createElement('dt');
      const code = document.createElement('code');
      code.textContent = `{{${name}}}`;
      dt.appendChild(code);
      const dd = document.createElement('dd');
      dd.textContent = desc();
      dl.append(dt, dd);
    }
  }
  renderVariables();
  renderProfiles();
  renderPrompts();
  // Import : bouton, sélection de fichiers, glisser-déposer (n'importe où dans la page)
  $('import-pick').addEventListener('click', () => $('import-input').click());
  $('import-input').addEventListener('change', () => {
    const files = [...$('import-input').files];
    $('import-input').value = '';
    importFiles(files);
  });
  $('import-cancel').addEventListener('click', () => {
    if (app.importAbort) app.importAbort.abort();
    $('import-text').textContent = tr('import.cancelling');
  });
  const canDrop = () => app.state === 'idle' || app.state === 'done';
  document.addEventListener('dragover', (e) => {
    // Sans cela, le navigateur ouvrirait le fichier déposé à la place de Lowsper
    e.preventDefault();
    if (canDrop()) $('view-idle').classList.add('dragging');
  });
  document.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) $('view-idle').classList.remove('dragging');
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    $('view-idle').classList.remove('dragging');
    if (canDrop() && e.dataTransfer && e.dataTransfer.files.length) importFiles(e.dataTransfer.files);
  });
  $('pause').addEventListener('click', togglePause);
  $('stop').addEventListener('click', stop);
  $('stop-main').addEventListener('click', stop);
  $('chain').addEventListener('click', chainNext);
  $('download').addEventListener('click', () => {
    const n = noteOf(app.transcript);
    download(n.content, n.name);
  });
  $('copy').addEventListener('click', () => copy(app.finalMarkdown));
  // Consigne choisie (celle du profil par défaut) + note, à coller dans un assistant
  $('copy-ai').addEventListener('click', () => {
    const t = app.transcript;
    if (t) copy(L.Notes.promptText(t, profileOf(t), $('ai-choice').value));
  });
  $('again').addEventListener('click', reset);
  $('next-meeting').addEventListener('click', () => {
    reset();
    askBeforeStart(); // le clic sert de geste utilisateur pour le partage d'écran
  });
  $('pip').addEventListener('click', () => openPip());
  // Flèche de la barre : déplie ou replie la deuxième ligne (dernière phrase, avis)
  $('pip-more').addEventListener('click', () => {
    const bodies = [document.body, app.pip && app.pip.document.body].filter(Boolean);
    const on = !document.body.classList.contains('expanded');
    for (const b of bodies) b.classList.toggle('expanded', on);
    if (app.pip) {
      try {
        app.pip.resizeTo(app.pip.outerWidth, app.pip.outerHeight + (on ? 40 : -40));
      } catch {}
    }
  });
  $('pip-back').addEventListener('click', closePip);
  $('title').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    // Touche consommée : sinon le même appui activerait « Continuer », qui vient de recevoir le focus
    e.preventDefault();
    askBeforeStart();
  });

  checkRecovery();
  L.detectWebGPU().then((gpu) => {
    app.gpu = gpu;
    app.gpuChecked = true;
    if (app.state === 'install' && !app.installing) showInstall();
  });
  bootEngine();
})();
