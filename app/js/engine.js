/*
 * Lowsper : moteur de transcription.
 *
 * 1. Charge les fichiers embarqués (runtime, WebAssembly, modèle) via des balises <script>,
 *    seule méthode autorisée par les navigateurs pour une page ouverte en file://.
 * 2. Démarre un ou plusieurs Web Workers construits à partir d'un Blob (pas de fichier
 *    externe à charger), qui exécutent Whisper sur le processeur via WebAssembly.
 *
 * Aucune requête réseau n'est faite. La politique de sécurité (CSP) de Lowsper.html
 * l'interdit de toute façon : connect-src n'autorise ni http ni https.
 */
(function () {
  'use strict';

  const Lowsper = (window.Lowsper = window.Lowsper || {});
  if (!Lowsper.assetBase) Lowsper.assetBase = 'app/';

  // ---------------------------------------------------------------------------
  // Chargement des fichiers embarqués
  // ---------------------------------------------------------------------------

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = Lowsper.assetBase + src;
      s.async = true;
      s.onload = () => {
        s.remove();
        resolve();
      };
      s.onerror = () => reject(new Error('Fichier introuvable : ' + Lowsper.assetBase + src));
      document.head.appendChild(s);
    });
  }

  function takeAsset(src) {
    const key = src.replace(/\.(js|txt)$/, '');
    const store = self.LOWSPER_ASSETS || {};
    const value = store[key];
    delete store[key]; // libère la mémoire occupée par la chaîne base64
    if (value === undefined) throw new Error('Contenu manquant : ' + src);
    return value;
  }

  function base64ToBytes(b64, target, offset) {
    if (typeof Uint8Array.fromBase64 === 'function') {
      target.set(Uint8Array.fromBase64(b64), offset);
      return;
    }
    const bin = atob(b64);
    for (let i = 0; i < bin.length; i++) target[offset + i] = bin.charCodeAt(i);
  }

  async function loadBinary(parts, onBytes) {
    const total = parts.reduce((n, p) => n + p.bytes, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      await loadScript(part.src);
      base64ToBytes(takeAsset(part.src), out, offset);
      offset += part.bytes;
      onBytes(part.bytes);
    }
    return out.buffer;
  }

  /**
   * Charge tout ce qu'il faut pour transcrire. onProgress(ratio entre 0 et 1).
   * Le résultat est mis en cache : un seul chargement par ouverture de la page.
   */
  let assetsPromise = null;
  Lowsper.loadAssets = function (onProgress, modelId) {
    if (assetsPromise) return assetsPromise;
    assetsPromise = (async () => {
      const manifest = self.LOWSPER_MANIFEST;
      if (!manifest) throw new Error('app/manifest.js introuvable : le dossier est incomplet.');
      const installed = self.LOWSPER_INSTALLED || [];
      const model = installed.find((m) => m.id === modelId) || installed[0];
      if (!model) throw new Error('Aucun modèle installé.');
      const device = model.device === 'webgpu' ? 'webgpu' : 'wasm';
      const runtimes = manifest.runtimes || { cpu: { src: manifest.runtime.src, bytes: manifest.runtime.bytes, wasm: manifest.wasm } };
      const needed = device === 'webgpu' ? [runtimes.cpu, runtimes.webgpu] : [runtimes.cpu];

      const sum = (parts) => parts.reduce((n, p) => n + p.bytes, 0);
      const total =
        needed.reduce((n, r) => n + r.bytes + sum(r.wasm), 0) +
        sum(Object.values(model.files).flat()) +
        (manifest.vad ? sum(manifest.vad) : 0) +
        (manifest.speaker ? sum(Object.values(manifest.speaker.files).flat()) : 0);
      let done = 0;
      const tick = (n) => {
        done += n;
        if (onProgress) onProgress(Math.min(1, done / total));
      };

      const loaded = [];
      for (const r of needed) {
        await loadScript(r.src);
        const code = takeAsset(r.src);
        tick(r.bytes);
        loaded.push({ code, wasm: await loadBinary(r.wasm, tick) });
      }
      const cpu = loaded[0];
      const main = loaded[loaded.length - 1];

      await loadScript(model.config);
      const texts = takeAsset(model.config);
      const files = {};
      for (const [name, parts] of Object.entries(model.files)) files[name] = await loadBinary(parts, tick);

      // Analyse audio (détection de parole, empreintes vocales) : toujours sur le processeur
      let analysis = null;
      if (manifest.vad) {
        const vad = await loadBinary(manifest.vad, tick);
        let speaker = null;
        if (manifest.speaker) {
          await loadScript(manifest.speaker.config);
          const sTexts = takeAsset(manifest.speaker.config);
          const sFiles = {};
          for (const [name, parts] of Object.entries(manifest.speaker.files)) sFiles[name] = await loadBinary(parts, tick);
          speaker = { texts: sTexts, files: sFiles };
        }
        analysis = { runtime: cpu.code, wasm: cpu.wasm, vad, speaker };
      }
      return {
        runtime: main.code,
        wasm: main.wasm,
        device,
        model: { id: model.id, label: model.label, dtype: model.dtype, device, texts, files },
        analysis,
      };
    })();
    assetsPromise.catch(() => {
      assetsPromise = null;
    });
    return assetsPromise;
  };

  /** Vrai si le navigateur dispose d'une carte graphique utilisable en WebGPU. */
  Lowsper.detectWebGPU = async function () {
    try {
      if (!navigator.gpu) return null;
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) return null;
      const info = adapter.info || {};
      return { vendor: info.vendor || '', description: info.description || info.architecture || '', f16: adapter.features.has('shader-f16') };
    } catch {
      return null;
    }
  };

  // ---------------------------------------------------------------------------
  // Code exécuté dans le Worker (sérialisé via Function.prototype.toString)
  // ---------------------------------------------------------------------------

  function workerMain() {
    let asr = null;
    let queue = Promise.resolve();

    async function init(msg) {
      const { pipeline, env } = self.LowsperRuntime;
      const { model, wasm } = msg;
      const enc = new TextEncoder();
      const blobs = {};
      for (const [name, text] of Object.entries(model.texts)) blobs[name] = enc.encode(text);
      for (const [name, buf] of Object.entries(model.files)) blobs[name] = new Uint8Array(buf);

      // Tous les fichiers du modèle sont servis depuis la mémoire.
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.localModelPath = '/lowsper/';
      env.useBrowserCache = false;
      env.useWasmCache = false;
      env.useCustomCache = true;
      env.customCache = {
        async match(key) {
          const k = typeof key === 'string' ? key : key.url;
          for (const name in blobs) {
            if (k.endsWith(model.id + '/' + name)) {
              return new Response(blobs[name], {
                headers: { 'content-length': String(blobs[name].byteLength) },
              });
            }
          }
          return undefined;
        },
        async put() {},
      };

      const onnx = env.backends.onnx;
      onnx.wasm.wasmPaths = undefined;
      onnx.wasm.wasmBinary = wasm;
      onnx.wasm.numThreads = 1; // file:// n'autorise pas le multithread WebAssembly
      onnx.wasm.proxy = false;

      if (model.device === 'webgpu') onnx.webgpu.powerPreference = 'high-performance';
      asr = await pipeline('automatic-speech-recognition', model.id, {
        device: model.device === 'webgpu' ? 'webgpu' : 'wasm',
        dtype: model.dtype || { encoder_model: 'q8', decoder_model_merged: 'q8' },
      });
      // Permet de transmettre à generate() la sortie d'encodeur déjà calculée
      // (sinon transformers.js l'ignore et réencode l'audio).
      if (!asr.model.forward_params.includes('encoder_outputs')) {
        asr.model.forward_params = asr.model.forward_params.concat('encoder_outputs');
      }
      const tok = asr.tokenizer;
      const gen = asr.model.generation_config;
      ids = {
        sot: gen.decoder_start_token_id,
        prev: tokenId('<|startofprev|>'),
        transcribe: gen.task_to_id.transcribe,
        eos: gen.eos_token_id,
        tsBegin: gen.no_timestamps_token_id + 1, // <|0.00|>
        special: new Set(tok.all_special_ids),
        lang: gen.lang_to_id,
      };
      // Préchauffe (la première inférence est plus lente). Quelques jetons suffisent :
      // sur du silence, Whisper a tendance à « halluciner » sans fin.
      await transcribe({ audio: new Float32Array(16000), language: 'fr', maxTokens: 4 });
    }

    let ids = null;
    function tokenId(token) {
      const t = asr.tokenizer;
      const id = t.model && t.model.tokens_to_ids ? t.model.tokens_to_ids.get(token) : undefined;
      if (id !== undefined) return id;
      const enc = t.encode(token, { add_special_tokens: false });
      if (enc.length === 1) return enc[0];
      throw new Error('Jeton inconnu : ' + token);
    }

    // Glossaire -> jetons du « prompt » Whisper (contexte précédent). Whisper imite
    // l'orthographe de ce contexte : les sigles listés sont écrits correctement.
    let promptCache = { text: null, ids: [] };
    function promptIds(text) {
      text = (text || '').trim();
      if (!text) return [];
      if (promptCache.text !== text) {
        const encoded = asr.tokenizer.encode(' ' + text, { add_special_tokens: false });
        // Whisper limite le contexte à la moitié de sa fenêtre (224 jetons)
        promptCache = { text, ids: encoded.slice(-200) };
      }
      return promptCache.ids;
    }

    async function encode(features) {
      const inputs = await asr.model._prepare_encoder_decoder_kwargs_for_generation({
        inputs_tensor: features,
        model_inputs: { input_features: features },
        model_input_name: 'input_features',
        generation_config: { guidance_scale: null },
      });
      return inputs.encoder_outputs;
    }

    // Détection de la langue parmi une liste restreinte (ex. ['fr', 'en']) :
    // une seule étape du décodeur, sur la sortie d'encodeur déjà calculée.
    async function detect(encoderOutputs, candidates) {
      const { Tensor } = self.LowsperRuntime;
      const out = await asr.model.forward({
        encoder_outputs: encoderOutputs,
        decoder_input_ids: new Tensor('int64', BigInt64Array.from([BigInt(ids.sot)]), [1, 1]),
      });
      const logits = out.logits.data;
      let best = candidates[0];
      let bestScore = -Infinity;
      for (const code of candidates) {
        const id = ids.lang['<|' + code + '|>'];
        if (id != null && logits[id] > bestScore) {
          bestScore = logits[id];
          best = code;
        }
      }
      return best;
    }

    const countWords = (cs) => cs.reduce((n, c) => n + c.text.split(/\s+/).filter(Boolean).length, 0);

    // Détecte une boucle de répétition (« je ne sais pas si... » x 10) : peu de groupes de
    // 4 mots distincts, ou une même phrase répétée au moins 3 fois.
    function isLoop(chunks) {
      const words = chunks.map((c) => c.text).join(' ').toLowerCase().split(/\s+/).filter(Boolean);
      if (words.length >= 12) {
        // Paraphrases en boucle (« je ne sais pas... je ne sais plus... ») : peu de paires de mots distinctes
        const pairs = new Set();
        for (let i = 0; i + 2 <= words.length; i++) pairs.add(words[i] + ' ' + words[i + 1]);
        if (pairs.size / (words.length - 1) < 0.75) return true;
      }
      if (words.length >= 16) {
        const grams = new Set();
        for (let i = 0; i + 4 <= words.length; i++) grams.add(words.slice(i, i + 4).join(' '));
        if (grams.size / (words.length - 3) < 0.6) return true;
      }
      const seen = new Map();
      for (const c of chunks) {
        const k = c.text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').trim();
        if (k.length < 8) continue;
        seen.set(k, (seen.get(k) || 0) + 1);
        if (seen.get(k) >= 3) return true;
      }
      return false;
    }

    // Un résultat est « suspect » s'il a atteint le plafond de jetons, s'il boucle, ou s'il
    // est anormalement court pour la durée de parole (passage sauté).
    function quality(chunks, seconds) {
      if (chunks.capped || isLoop(chunks)) return 'loop';
      if (seconds >= 2 && countWords(chunks) < seconds * 0.9) return 'short';
      return 'ok';
    }

    async function transcribe(msg) {
      const t0 = performance.now();
      const r = await transcribeAudio(msg.audio, msg, 0);
      return Object.assign(r, { ms: performance.now() - t0 });
    }

    // Stratégie de décodage robuste, inspirée du « repli » de l'implémentation de référence
    // de Whisper : 1) décodage normal avec le glossaire ; 2) si le résultat est suspect,
    // nouveau décodage sans glossaire et en interdisant les répétitions (l'encodeur n'est pas
    // recalculé) ; 3) si c'est encore suspect, le bloc est coupé en deux dans un creux de
    // parole et chaque moitié est transcrite séparément.
    async function transcribeAudio(audio, msg, depth) {
      const seconds = audio.length / 16000;
      const features = (await asr.processor(audio)).input_features;
      const encoderOutputs = await encode(features);
      const language = Array.isArray(msg.language) ? await detect(encoderOutputs, msg.language) : msg.language || 'fr';
      const prompt = promptIds(msg.prompt);

      let chunks = await decode(features, encoderOutputs, language, prompt, seconds, msg.maxTokens, 0);
      let q = quality(chunks, seconds);
      let retried = false;
      // Boucle, ou rien du tout : nouveau décodage sans glossaire, répétitions interdites.
      // (Un texte simplement trop court est traité plus bas par la reprise, moins coûteuse.)
      if ((q === 'loop' || !chunks.length) && !msg.maxTokens) {
        retried = true;
        const alt = await decode(features, encoderOutputs, language, [], seconds, 0, 4);
        const qa = quality(alt, seconds);
        if (qa === 'ok' || (q === 'loop' && qa !== 'loop') || (qa === q && countWords(alt) > countWords(chunks))) {
          chunks = alt;
          q = qa;
        }
      }
      if (q === 'loop' && depth === 0 && seconds >= 6 && !msg.noSplit) {
        // Découpe aux frontières des prises de parole qui composent le bloc (un passage
        // incompréhensible ne contamine plus les autres), sinon dans le creux le plus calme.
        let cuts = (msg.pieces || []).map((t) => Math.round(t * 16000)).filter((c) => c > 16000 && c < audio.length - 16000);
        if (!cuts.length) cuts = [quietestPoint(audio, 0.35, 0.65)];
        const bounds = [0, ...cuts, audio.length];
        chunks = [];
        let anyLoop = false;
        for (let i = 0; i + 1 < bounds.length; i++) {
          const part = await transcribeAudio(audio.subarray(bounds[i], bounds[i + 1]), msg, 1);
          const offset = bounds[i] / 16000;
          if (part.quality === 'loop') anyLoop = true;
          for (const c of part.chunks) chunks.push({ from: c.from + offset, to: c.to == null ? null : c.to + offset, text: c.text });
        }
        q = anyLoop ? 'loop' : 'ok';
        retried = true;
      }
      if (q === 'loop') chunks = dropRepeats(chunks);

      // Reprise (« seek ») : Whisper déclare parfois la fin du texte alors qu'il reste de la
      // parole dans le bloc. On transcrit alors la suite à partir du dernier horodatage.
      const last = chunks.length ? chunks[chunks.length - 1] : null;
      const covered = last ? (last.to != null ? last.to : seconds) : 0;
      if (depth < 4 && seconds - covered > 1.5 && covered > 0.5 && !msg.maxTokens) {
        const start = Math.floor(covered * 16000);
        const rest = audio.subarray(start);
        if (hasSpeech(rest, audio)) {
          const more = await transcribeAudio(rest, Object.assign({}, msg, { pieces: [] }), depth + 1);
          const offset = start / 16000;
          for (const c of more.chunks) chunks.push({ from: c.from + offset, to: c.to == null ? null : c.to + offset, text: c.text });
          if (more.quality === 'loop') q = 'loop';
          retried = true;
        }
      }
      return { text: chunks.map((c) => c.text).join(' '), chunks, language, retried, capped: !!chunks.capped, quality: q };
    }

    // Y a-t-il au moins ~0,8 s de signal comparable à la parole du bloc dans ce reste ?
    function hasSpeech(rest, whole) {
      const rms = (a, i, n) => {
        let e = 0;
        for (let k = i; k < i + n; k++) e += a[k] * a[k];
        return Math.sqrt(e / n);
      };
      const ref = rms(whole, 0, whole.length);
      let loud = 0;
      for (let i = 0; i + 1600 <= rest.length; i += 1600) if (rms(rest, i, 1600) > ref * 0.5) loud++;
      return loud >= 8;
    }

    // Instant (en échantillons) le plus calme entre deux proportions du bloc, par fenêtres de 100 ms.
    function quietestPoint(audio, from, to) {
      const win = 1600;
      let best = Math.floor(audio.length / 2);
      let bestE = Infinity;
      for (let i = Math.floor(audio.length * from); i + win < audio.length * to; i += win / 2) {
        let e = 0;
        for (let k = i; k < i + win; k++) e += audio[k] * audio[k];
        if (e < bestE) {
          bestE = e;
          best = i + win / 2;
        }
      }
      return best;
    }

    // Dernier recours : garde chaque phrase une seule fois.
    function dropRepeats(chunks) {
      const seen = new Set();
      return chunks.filter((c) => {
        const k = c.text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').trim();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }

    async function decode(features, encoderOutputs, language, prompt, seconds, maxTokens, noRepeat) {
      const prefix = (prompt.length ? [ids.prev, ...prompt] : []).concat([
        ids.sot,
        ids.lang['<|' + language + '|>'],
        ids.transcribe,
      ]);
      // Budget de jetons : large (un débit très rapide avec des chiffres dépasse 8 jetons/s),
      // les boucles sont détectées et traitées à part.
      const budget = maxTokens || Math.min(440, Math.ceil(seconds * 11) + 24);
      const options = {
        inputs: features,
        encoder_outputs: encoderOutputs,
        decoder_input_ids: prefix,
        language,
        task: 'transcribe',
        return_timestamps: true, // horodatage par phrase, à l'intérieur du bloc
        num_frames: Math.floor(seconds * 100),
        max_new_tokens: budget,
      };
      if (noRepeat) options.no_repeat_ngram_size = noRepeat;
      const output = await asr.model.generate(options);
      const tokens = output.tolist()[0].map(Number).slice(prefix.length);
      const chunks = parse(tokens, seconds);
      chunks.capped = tokens.length >= budget;
      return chunks;
    }

    // Découpe la suite <|t0|> texte <|t1|> <|t1|> texte <|t2|> ... en phrases horodatées.
    function parse(tokens, seconds) {
      const chunks = [];
      let from = null;
      let text = [];
      const flush = (to) => {
        const t = asr.tokenizer.decode(text, { skip_special_tokens: true }).trim();
        if (t) chunks.push({ from: from == null ? 0 : from, to, text: t });
        text = [];
      };
      for (const t of tokens) {
        if (t >= ids.tsBegin) {
          const time = (t - ids.tsBegin) * 0.02;
          if (from === null || !text.length) from = time;
          else {
            flush(time);
            from = null;
          }
        } else if (!ids.special.has(t)) {
          text.push(t);
        }
      }
      if (text.length) flush(seconds);
      return chunks;
    }

    // Mesure de vitesse : coût fixe de l'encodeur par bloc, puis coût par mot généré.
    // Le contenu de l'audio n'importe pas : on force la génération d'un nombre fixe de jetons.
    async function bench() {
      const seconds = 18;
      const audio = new Float32Array(seconds * 16000);
      for (let i = 0; i < audio.length; i++) audio[i] = (Math.random() - 0.5) * 0.02;
      const t0 = performance.now();
      const features = (await asr.processor(audio)).input_features;
      const encoderOutputs = await encode(features);
      const encMs = performance.now() - t0;
      const n = 40;
      const t1 = performance.now();
      await asr.model.generate({
        inputs: features,
        encoder_outputs: encoderOutputs,
        decoder_input_ids: [ids.sot, ids.lang['<|fr|>'], ids.transcribe, ids.tsBegin - 1],
        language: 'fr',
        task: 'transcribe',
        return_timestamps: false,
        max_new_tokens: n,
        min_new_tokens: n,
      });
      return { encMs, tokMs: (performance.now() - t1) / n };
    }

    self.onmessage = (e) => {
      const msg = e.data;
      queue = queue.then(async () => {
        try {
          if (msg.type === 'bench') {
            const r = await bench();
            self.postMessage({ id: msg.id, ok: true, encMs: r.encMs, tokMs: r.tokMs });
          } else if (msg.type === 'init') {
            await init(msg);
            self.postMessage({ id: msg.id, ok: true });
          } else if (msg.type === 'transcribe') {
            const r = await transcribe(msg);
            self.postMessage({ id: msg.id, ok: true, text: r.text, chunks: r.chunks, language: r.language, capped: r.capped, retried: r.retried, ms: r.ms });
          }
        } catch (err) {
          self.postMessage({ id: msg.id, ok: false, error: String((err && err.stack) || err) });
        }
      });
    };
  }

  // ---------------------------------------------------------------------------
  // Côté page : pilotage d'un Worker
  // ---------------------------------------------------------------------------

  class Transcriber {
    constructor(assets) {
      const code = assets.runtime + '\n;(' + workerMain.toString() + ')();';
      this.url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      this.worker = new Worker(this.url);
      this.pending = new Map();
      this.nextId = 1;
      this.busy = 0;
      this.worker.onmessage = (e) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        this.busy--;
        e.data.ok ? p.resolve(e.data) : p.reject(new Error(e.data.error));
      };
      this.worker.onerror = (e) => {
        const err = new Error('Erreur du moteur : ' + (e.message || 'inconnue'));
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
      };
      // Chaque worker reçoit sa propre copie des buffers (clonage structuré).
      this.ready = this.call({ type: 'init', wasm: assets.wasm, model: assets.model });
    }

    call(msg, transfer) {
      const id = this.nextId++;
      this.busy++;
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.worker.postMessage({ ...msg, id }, transfer || []);
      });
    }

    async transcribe(audio, language, prompt, pieces) {
      await this.ready;
      return this.call({ type: 'transcribe', audio, language, prompt, pieces }, [audio.buffer]);
    }

    async bench() {
      await this.ready;
      return this.call({ type: 'bench' });
    }

    dispose() {
      this.worker.terminate();
      URL.revokeObjectURL(this.url);
    }
  }

  /**
   * Estime la charge d'un moteur pour une réunion où l'on parle en continu, à partir d'une mesure :
   * un bloc de 18 s coûte l'encodeur + environ 6 jetons par seconde de parole (texte et horodatages).
   * Retourne la part du temps réel utilisée (1 = juste suffisant), pour `workers` moteurs.
   */
  Lowsper.estimateLoad = function (bench, workers) {
    const block = 18;
    const ms = bench.encMs + block * 6 * bench.tokMs;
    return ms / 1000 / block / Math.max(1, workers);
  };

  Lowsper.Transcriber = Transcriber;
})();
