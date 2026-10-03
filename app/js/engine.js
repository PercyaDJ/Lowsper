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
    const key = src.replace(/\.js$/, '');
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
      const model = manifest.models.find((m) => m.id === modelId) || manifest.models[0];
      if (!model) throw new Error('Aucun modèle installé dans app/models.');

      const fileParts = Object.values(model.files).flat();
      const total =
        manifest.runtime.bytes +
        manifest.wasm.reduce((n, p) => n + p.bytes, 0) +
        fileParts.reduce((n, p) => n + p.bytes, 0);
      let done = 0;
      const tick = (n) => {
        done += n;
        if (onProgress) onProgress(Math.min(1, done / total));
      };

      await loadScript(manifest.runtime.src);
      const runtime = takeAsset(manifest.runtime.src);
      tick(manifest.runtime.bytes);

      const wasm = await loadBinary(manifest.wasm, tick);

      await loadScript(model.config);
      const texts = takeAsset(model.config);
      const files = {};
      for (const [name, parts] of Object.entries(model.files)) {
        files[name] = await loadBinary(parts, tick);
      }
      return { runtime, wasm, model: { id: model.id, label: model.label, texts, files } };
    })();
    assetsPromise.catch(() => {
      assetsPromise = null;
    });
    return assetsPromise;
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

      asr = await pipeline('automatic-speech-recognition', model.id, {
        device: 'wasm',
        dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
      });
      // Permet de transmettre à generate() la sortie d'encodeur déjà calculée lors de la
      // détection de langue (sinon transformers.js l'ignore et réencode l'audio).
      if (!asr.model.forward_params.includes('encoder_outputs')) {
        asr.model.forward_params = asr.model.forward_params.concat('encoder_outputs');
      }
      // Préchauffe (la première inférence est plus lente). Quelques jetons suffisent :
      // sur du silence, Whisper a tendance à « halluciner » sans fin.
      await asr(new Float32Array(16000), { language: 'fr', task: 'transcribe', max_new_tokens: 4 });
    }

    // Détection de la langue parmi une liste restreinte (ex. ['fr', 'en']) : une seule étape
    // du décodeur, en réutilisant la sortie de l'encodeur pour la transcription qui suit.
    async function detect(features, candidates) {
      const { Tensor } = self.LowsperRuntime;
      const model = asr.model;
      const inputs = await model._prepare_encoder_decoder_kwargs_for_generation({
        inputs_tensor: features,
        model_inputs: { input_features: features },
        model_input_name: 'input_features',
        generation_config: { guidance_scale: null },
      });
      const gen = model.generation_config;
      const sot = gen.decoder_start_token_id;
      const out = await model.forward({
        encoder_outputs: inputs.encoder_outputs,
        decoder_input_ids: new Tensor('int64', BigInt64Array.from([BigInt(sot)]), [1, 1]),
      });
      const logits = out.logits.data;
      let best = candidates[0];
      let bestScore = -Infinity;
      for (const code of candidates) {
        const id = gen.lang_to_id['<|' + code + '|>'];
        if (id != null && logits[id] > bestScore) {
          bestScore = logits[id];
          best = code;
        }
      }
      return { language: best, encoder_outputs: inputs.encoder_outputs };
    }

    async function transcribe(msg) {
      const t0 = performance.now();
      const seconds = msg.audio.length / 16000;
      const options = {
        language: msg.language,
        task: 'transcribe',
        // Horodatage par phrase, à l'intérieur du segment
        return_timestamps: true,
        // Garde-fou contre les boucles de répétition : on dépasse rarement 6 jetons de
        // texte par seconde de parole ; au-delà c'est presque toujours une hallucination.
        max_new_tokens: Math.min(440, Math.ceil(seconds * 8) + 16),
      };
      if (Array.isArray(msg.language)) {
        const features = (await asr.processor(msg.audio)).input_features;
        const d = await detect(features, msg.language);
        options.language = d.language;
        options.encoder_outputs = d.encoder_outputs;
      }
      const out = await asr(msg.audio, options);
      const chunks = ((out && out.chunks) || []).map((c) => ({
        from: c.timestamp ? c.timestamp[0] : 0,
        to: c.timestamp ? c.timestamp[1] : null,
        text: c.text,
      }));
      return { text: (out && out.text) || '', chunks, language: options.language, ms: performance.now() - t0 };
    }

    self.onmessage = (e) => {
      const msg = e.data;
      queue = queue.then(async () => {
        try {
          if (msg.type === 'init') {
            await init(msg);
            self.postMessage({ id: msg.id, ok: true });
          } else if (msg.type === 'transcribe') {
            const r = await transcribe(msg);
            self.postMessage({ id: msg.id, ok: true, text: r.text, chunks: r.chunks, language: r.language, ms: r.ms });
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

    async transcribe(audio, language) {
      await this.ready;
      return this.call({ type: 'transcribe', audio, language }, [audio.buffer]);
    }

    dispose() {
      this.worker.terminate();
      URL.revokeObjectURL(this.url);
    }
  }

  Lowsper.Transcriber = Transcriber;
})();
