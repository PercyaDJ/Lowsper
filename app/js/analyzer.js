/*
 * Lowsper : analyse audio (détection de parole et empreintes vocales), dans un Worker.
 *
 * - Silero VAD : probabilité de parole toutes les 32 ms, bien plus fiable qu'un seuil de
 *   volume (ne confond pas un clavier, une musique ou un souffle avec de la voix, et ne rate
 *   pas une voix faible quand le volume du partage d'écran est bas).
 * - WeSpeaker ResNet34 : « empreinte vocale » de 256 nombres par phrase, qui sert à
 *   distinguer les intervenants côté « Participants » (voir speakers.js).
 *
 * Ces deux modèles sont petits (8 Mo au total) et tournent sur le processeur.
 */
(function () {
  'use strict';

  const Lowsper = (window.Lowsper = window.Lowsper || {});
  const VAD_FRAME = 512; // 32 ms à 16 kHz, taille imposée par Silero

  function workerMain() {
    const R = self.LowsperRuntime;
    const VAD_FRAME = 512; // (redéfini ici : ce code est exécuté seul dans le Worker)
    let vad = null;
    let embedder = null;
    const states = new Map(); // état récurrent de Silero, par source

    async function init(msg) {
      const onnx = R.env.backends.onnx;
      onnx.wasm.wasmPaths = undefined;
      onnx.wasm.wasmBinary = msg.wasm;
      onnx.wasm.numThreads = 1;
      onnx.wasm.proxy = false;
      vad = await R.InferenceSession.create(new Uint8Array(msg.vad), { executionProviders: ['wasm'] });

      if (msg.speaker) {
        const enc = new TextEncoder();
        const blobs = {};
        for (const [name, text] of Object.entries(msg.speaker.texts)) blobs[name] = enc.encode(text);
        for (const [name, buf] of Object.entries(msg.speaker.files)) blobs[name] = new Uint8Array(buf);
        const env = R.env;
        env.allowRemoteModels = false;
        env.allowLocalModels = true;
        env.localModelPath = '/lowsper/';
        env.useBrowserCache = false;
        env.useWasmCache = false;
        env.useCustomCache = true;
        env.customCache = {
          async match(key) {
            const k = typeof key === 'string' ? key : key.url;
            for (const name in blobs) if (k.endsWith('wespeaker/' + name)) return new Response(blobs[name]);
            return undefined;
          },
          async put() {},
        };
        const processor = await R.AutoProcessor.from_pretrained('wespeaker');
        const model = await R.AutoModel.from_pretrained('wespeaker', { device: 'wasm', dtype: 'q8' });
        embedder = { processor, model };
      }
    }

    // Probabilités de parole pour une suite de trames de 512 échantillons.
    async function runVad(source, samples) {
      let st = states.get(source);
      if (!st) {
        st = { state: new Float32Array(2 * 128), context: new Float32Array(64) };
        states.set(source, st);
      }
      const n = Math.floor(samples.length / VAD_FRAME);
      const probs = new Float32Array(n);
      const sr = new R.OrtTensor('int64', BigInt64Array.from([16000n]), []);
      for (let i = 0; i < n; i++) {
        // Silero v5 attend les 64 derniers échantillons de la trame précédente en tête
        const input = new Float32Array(64 + VAD_FRAME);
        input.set(st.context, 0);
        input.set(samples.subarray(i * VAD_FRAME, (i + 1) * VAD_FRAME), 64);
        const out = await vad.run({
          input: new R.OrtTensor('float32', input, [1, input.length]),
          state: new R.OrtTensor('float32', st.state, [2, 1, 128]),
          sr,
        });
        probs[i] = out.output.data[0];
        st.state = new Float32Array(out.stateN.data);
        st.context = input.slice(input.length - 64);
      }
      return probs;
    }

    async function embed(audio) {
      const inputs = await embedder.processor(audio);
      const out = await embedder.model(inputs);
      const v = Float32Array.from(out.last_hidden_state.data);
      let norm = 0;
      for (const x of v) norm += x * x;
      norm = Math.sqrt(norm) || 1;
      for (let i = 0; i < v.length; i++) v[i] /= norm;
      return v;
    }

    let queue = Promise.resolve();
    self.onmessage = (e) => {
      const msg = e.data;
      queue = queue.then(async () => {
        try {
          if (msg.type === 'init') {
            await init(msg);
            self.postMessage({ id: msg.id, ok: true });
          } else if (msg.type === 'vad') {
            const probs = await runVad(msg.source, msg.samples);
            self.postMessage({ id: msg.id, ok: true, probs }, [probs.buffer]);
          } else if (msg.type === 'reset') {
            states.delete(msg.source);
            self.postMessage({ id: msg.id, ok: true });
          } else if (msg.type === 'embed') {
            const v = embedder ? await embed(msg.audio) : null;
            self.postMessage({ id: msg.id, ok: true, embedding: v }, v ? [v.buffer] : []);
          }
        } catch (err) {
          self.postMessage({ id: msg.id, ok: false, error: String((err && err.stack) || err) });
        }
      });
    };
  }

  class Analyzer {
    /** assets : { runtime, wasm, vad, speaker? } (voir engine.js loadAnalysisAssets) */
    constructor(assets) {
      const code = assets.runtime + '\n;(' + workerMain.toString() + ')();';
      this.url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      this.worker = new Worker(this.url);
      this.pending = new Map();
      this.nextId = 1;
      this.hasSpeaker = !!assets.speaker;
      this.worker.onmessage = (e) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        e.data.ok ? p.resolve(e.data) : p.reject(new Error(e.data.error));
      };
      this.worker.onerror = (e) => {
        const err = new Error("Erreur de l'analyse audio : " + (e.message || 'inconnue'));
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
      };
      this.ready = this.call({ type: 'init', wasm: assets.wasm, vad: assets.vad, speaker: assets.speaker });
    }

    call(msg, transfer) {
      const id = this.nextId++;
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.worker.postMessage({ ...msg, id }, transfer || []);
      });
    }

    /** Probabilités de parole (une par trame de 512 échantillons). */
    async vad(source, samples) {
      await this.ready;
      const r = await this.call({ type: 'vad', source, samples }, []);
      return r.probs;
    }

    reset(source) {
      return this.call({ type: 'reset', source });
    }

    /** Empreinte vocale normalisée (256 valeurs), ou null si indisponible. */
    async embed(audio) {
      await this.ready;
      const r = await this.call({ type: 'embed', audio });
      return r.embedding;
    }

    dispose() {
      this.worker.terminate();
      URL.revokeObjectURL(this.url);
    }
  }

  Lowsper.Analyzer = Analyzer;
  Lowsper.VAD_FRAME = VAD_FRAME;
})();
