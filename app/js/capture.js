/*
 * Lowsper : capture audio et découpage de la parole.
 *
 * Deux sources indépendantes :
 *   - "me"     : le micro (getUserMedia)            -> ce que vous dites
 *   - "others" : l'audio du partage d'écran/onglet  -> ce que disent les participants
 *
 * Chaque source est ramenée en mono 16 kHz (format attendu par Whisper) puis passe
 * dans un détecteur d'activité vocale (VAD) qui ne garde que les passages parlés et
 * les découpe en segments de 1 à 28 s, coupés de préférence dans les pauses.
 * Le silence n'est jamais envoyé au modèle : c'est la principale économie de calcul.
 */
(function () {
  'use strict';

  const Lowsper = (window.Lowsper = window.Lowsper || {});
  const RATE = 16000;
  const FRAME = 512; // 32 ms à 16 kHz (taille imposée par le détecteur Silero)

  // Réglages du découpage (en secondes)
  const VAD = {
    preRoll: 0.4, // audio conservé avant le début détecté de la parole
    minSpeech: 0.35, // en dessous, une prise de parole est ignorée (toux, clic...)
    endPause: 0.6, // pause qui termine une prise de parole
    hangover: 0.25, // la parole est prolongée de ce délai après la dernière trame forte
    maxUtterance: 24, // une prise de parole plus longue est coupée dans un creux
    gap: 0.3, // silence laissé entre deux prises de parole dans un bloc
    blockTarget: 18, // un bloc part vers le modèle dès qu'il atteint cette durée
    blockMax: 24, // Whisper traite des fenêtres de 30 s ; plus court = un passage raté contamine moins
    flushSilence: 6, // ...ou après ce délai sans parole (affichage en direct)
    earlyMin: 3, // ...ou dès 3 s de parole si un moteur est libre
    vadTimeout: 3, // détecteur sans réponse : ce morceau passe au seuil de volume (rien n'attend)
  };

  // ---------------------------------------------------------------------------
  // Rééchantillonnage vers 16 kHz (moyenne par fenêtre = filtre anti-repliement simple)
  // ---------------------------------------------------------------------------
  class Resampler {
    constructor(inRate) {
      this.ratio = inRate / RATE;
      this.acc = 0;
      this.count = 0;
      this.pos = 0; // position fractionnaire dans la fenêtre courante
    }
    process(input) {
      const out = new Float32Array(Math.ceil(input.length / this.ratio) + 1);
      let n = 0;
      for (let i = 0; i < input.length; i++) {
        this.acc += input[i];
        this.count++;
        this.pos += 1;
        if (this.pos >= this.ratio) {
          out[n++] = this.acc / this.count;
          this.acc = 0;
          this.count = 0;
          this.pos -= this.ratio;
        }
      }
      return out.subarray(0, n);
    }
  }

  // ---------------------------------------------------------------------------
  // Détecteur d'activité vocale et constitution des blocs
  //
  // Whisper paie le même prix pour 3 s ou 30 s d'audio (il traite toujours une fenêtre de
  // 30 s). Plutôt que d'envoyer chaque phrase, on accumule les prises de parole en retirant
  // les silences, et on envoie des blocs d'environ 25 s de parole « compacte ». Chaque bloc
  // garde une table de correspondance pour retrouver l'heure réelle de chaque phrase.
  // ---------------------------------------------------------------------------
  class Segmenter {
    /**
     * @param {(block:{start:number,end:number,audio:Float32Array,speech:number,map:Array<{at:number,t:number}>}) => void} onBlock
     */
    /**
     * options.vad : { run(samples) -> Promise<Float32Array> } probabilité de parole par trame
     *               (Silero). Sans lui, repli sur un détecteur à seuil de volume.
     * options.emitEarly : () => booléen. Vrai quand un moteur est libre : le bloc part dès la
     *               fin d'une prise de parole, pour un transcript plus « en direct ».
     */
    constructor(onBlock, options) {
      this.onBlock = onBlock;
      this.vad = (options && options.vad) || null;
      this.emitEarly = (options && options.emitEarly) || null;
      // Délai accordé au détecteur de parole (s). En direct, il ne doit jamais bloquer la capture ;
      // pour un fichier (null), rien ne presse : on l'attend toujours, aucune parole n'est jugée au volume.
      this.vadTimeout = options && 'vadTimeout' in options ? options.vadTimeout : VAD.vadTimeout;
      this.t = 0; // temps (s) du prochain échantillon reçu, depuis le début de la session
      this.pending = new Float32Array(0);
      this.noise = -60; // plancher de bruit estimé (dBFS)
      this.level = -100; // niveau de la dernière trame, pour l'affichage
      this.preRoll = []; // trames récentes hors prise de parole
      this.utt = null; // prise de parole en cours
      this.block = null; // { pieces: [{frames}], dur, speech, lastEnd }
      this.chain = Promise.resolve();
    }

    // Ajoute de l'audio 16 kHz. paused=true : le temps avance mais rien n'est gardé.
    // Avec le détecteur Silero, le traitement est asynchrone (les appels restent dans l'ordre).
    push(samples, paused) {
      if (!this.vad) return this.pushNow(samples, paused, null);
      const copy = samples.slice();
      this.chain = this.chain.then(async () => {
        if (paused) return this.pushNow(copy, true, null);
        let buf = copy;
        if (this.pending.length) {
          buf = new Float32Array(this.pending.length + copy.length);
          buf.set(this.pending);
          buf.set(copy, this.pending.length);
        }
        const n = Math.floor(buf.length / FRAME) * FRAME;
        this.pending = buf.slice(n);
        if (!n) return;
        let probs = null;
        try {
          // Le détecteur ne doit jamais bloquer la capture : sans réponse rapide (PC surchargé),
          // ce morceau est découpé au seuil de volume et la suite continue.
          probs = await (this.vadTimeout == null
            ? this.vad.run(buf.subarray(0, n))
            : Promise.race([
                this.vad.run(buf.subarray(0, n)),
                new Promise((r) => setTimeout(() => r('timeout'), this.vadTimeout * 1000)),
              ]));
          if (probs === 'timeout') {
            probs = null;
            this.vadTimeouts = (this.vadTimeouts || 0) + 1;
          }
        } catch (e) {
          console.warn('Détecteur de parole indisponible, repli sur le seuil de volume', e);
          this.vad = null;
        }
        for (let i = 0, k = 0; i < n; i += FRAME, k++) this.frame(buf.subarray(i, i + FRAME), probs ? probs[k] : null);
      });
      return this.chain;
    }

    pushNow(samples, paused, probs) {
      if (paused) {
        this.flushNow();
        this.t += samples.length / RATE;
        this.preRoll = [];
        return;
      }
      let buf = samples;
      if (this.pending.length) {
        buf = new Float32Array(this.pending.length + samples.length);
        buf.set(this.pending);
        buf.set(samples, this.pending.length);
      }
      let i = 0;
      for (; i + FRAME <= buf.length; i += FRAME) this.frame(buf.subarray(i, i + FRAME), null);
      this.pending = buf.slice(i);
    }

    isLoud(db) {
      return db > this.noise + 9 && db > -58;
    }

    frame(f, prob) {
      const start = this.t;
      this.t += FRAME / RATE;
      let sum = 0;
      for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
      const db = 10 * Math.log10(sum / f.length + 1e-10);
      this.level = db;

      // Plancher de bruit : descend vite, remonte lentement (~3 dB/s)
      if (db < this.noise) this.noise = this.noise * 0.7 + db * 0.3;
      else this.noise += 0.09;
      this.noise = Math.max(-80, Math.min(this.noise, -30));

      // Silero : seuil avec hystérésis (0,5 pour entrer dans la parole, 0,35 pour y rester)
      const loud = prob != null ? prob > (this.utt ? 0.35 : 0.5) : this.isLoud(db);
      const fr = { start, data: f.slice(), db, loud };

      if (!this.utt) {
        this.preRoll.push(fr);
        const keep = Math.ceil(VAD.preRoll / (FRAME / RATE));
        if (this.preRoll.length > keep) this.preRoll.shift();
        if (loud) {
          this.utt = { frames: this.preRoll, speech: FRAME / RATE, lastLoud: start };
          this.preRoll = [];
        } else if (this.block && this.t - this.block.lastEnd >= VAD.flushSilence) {
          this.emitBlock();
        }
        return;
      }

      const utt = this.utt;
      utt.frames.push(fr);
      if (loud) {
        utt.lastLoud = start;
        utt.speech += FRAME / RATE;
      }
      const length = this.t - utt.frames[0].start;
      const pause = this.t - utt.lastLoud - VAD.hangover;

      if (pause >= VAD.endPause) {
        this.endUtterance(utt.lastLoud + VAD.hangover + 0.15);
      } else if (length >= VAD.maxUtterance) {
        // Trop long sans pause : coupe sur la trame la plus calme des 5 dernières secondes
        let best = null;
        for (const x of utt.frames) if (x.start >= this.t - 5 && (!best || x.db < best.db)) best = x;
        this.endUtterance(best ? best.start : this.t);
      }
    }

    // Termine la prise de parole à l'instant cutAt ; ce qui suit repart dans une nouvelle.
    endUtterance(cutAt) {
      const utt = this.utt;
      this.utt = null;
      const keep = utt.frames.filter((x) => x.start < cutAt);
      const rest = utt.frames.filter((x) => x.start >= cutAt);
      if (keep.length && utt.speech >= VAD.minSpeech) this.addToBlock(keep, utt.speech);
      const loudRest = rest.filter((x) => x.loud);
      if (loudRest.length) {
        this.utt = {
          frames: rest,
          speech: loudRest.length * (FRAME / RATE),
          lastLoud: loudRest[loudRest.length - 1].start,
        };
      } else if (rest.length) {
        this.preRoll = rest.slice(-Math.ceil(VAD.preRoll / (FRAME / RATE)));
      }
    }

    addToBlock(frames, speech) {
      const dur = (frames.length * FRAME) / RATE;
      if (this.block && this.block.dur + VAD.gap + dur > VAD.blockMax) this.emitBlock();
      if (!this.block) this.block = { pieces: [], dur: 0, speech: 0, lastEnd: 0 };
      const b = this.block;
      b.dur += (b.pieces.length ? VAD.gap : 0) + dur;
      b.speech += speech;
      b.pieces.push(frames);
      b.lastEnd = frames[frames.length - 1].start + FRAME / RATE;
      // Bloc plein, ou moteur libre : inutile d'attendre, on transcrit tout de suite
      if (b.dur >= VAD.blockTarget || (b.dur >= VAD.earlyMin && this.emitEarly && this.emitEarly())) this.emitBlock();
    }

    emitBlock() {
      const b = this.block;
      this.block = null;
      if (!b || !b.pieces.length) return;
      const gap = Math.round(VAD.gap * RATE);
      const total = b.pieces.reduce((n, p) => n + p.length * FRAME, 0) + gap * (b.pieces.length - 1);
      const audio = new Float32Array(total);
      const map = [];
      let off = 0;
      b.pieces.forEach((frames, i) => {
        if (i) off += gap;
        map.push({ at: off / RATE, t: frames[0].start });
        frames.forEach((x, k) => audio.set(x.data, off + k * FRAME));
        off += frames.length * FRAME;
      });
      normalize(audio);
      this.onBlock({
        start: b.pieces[0][0].start,
        end: b.lastEnd,
        audio,
        speech: b.speech,
        map,
      });
    }

    // Envoie tout ce qui est en attente (pause, fin de réunion, source coupée)
    flush() {
      if (!this.vad) return this.flushNow();
      this.chain = this.chain.then(() => this.flushNow());
      return this.chain;
    }

    flushNow() {
      if (this.utt) {
        const utt = this.utt;
        this.utt = null;
        if (utt.speech >= VAD.minSpeech) this.addToBlock(utt.frames, utt.speech);
      }
      this.emitBlock();
    }

    // Prise de parole en cours ou bloc en attente (pour l'affichage « parle »)
    get active() {
      return !!this.utt;
    }
  }

  /** Convertit un instant d'un bloc (secondes depuis son début) en temps de session. */
  function blockTime(block, at) {
    if (!block.map || !block.map.length) return block.start + at;
    let m = block.map[0];
    for (const x of block.map) if (x.at <= at + 0.05) m = x;
    return m.t + Math.max(0, at - m.at);
  }

  // Remonte le volume des voix faibles (gain plafonné) : Whisper y est sensible.
  function normalize(audio) {
    let peak = 0;
    for (let i = 0; i < audio.length; i++) peak = Math.max(peak, Math.abs(audio[i]));
    if (peak < 1e-4) return;
    const gain = Math.min(0.9 / peak, 20);
    if (gain <= 1.05) return;
    for (let i = 0; i < audio.length; i++) audio[i] *= gain;
  }

  // ---------------------------------------------------------------------------
  // Branchement d'un MediaStream sur le découpeur
  // ---------------------------------------------------------------------------

  // Arrête un son partagé, y compris la piste vidéo gardée ouverte pour lui (getSystemAudio)
  function stopStream(stream) {
    stream.getTracks().forEach((t) => t.stop());
    (stream._lowsperVideo || []).forEach((t) => t.stop());
  }

  const WORKLET = `
    class LowsperTap extends AudioWorkletProcessor {
      constructor() { super(); this.buf = new Float32Array(4096); this.n = 0; }
      process(inputs) {
        const input = inputs[0];
        if (input && input.length) {
          const chans = input.length, len = input[0].length;
          for (let i = 0; i < len; i++) {
            let v = 0;
            for (let c = 0; c < chans; c++) v += input[c][i];
            this.buf[this.n++] = v / chans;
            if (this.n === this.buf.length) { this.port.postMessage(this.buf); this.buf = new Float32Array(4096); this.n = 0; }
          }
        }
        return true;
      }
    }
    registerProcessor('lowsper-tap', LowsperTap);
  `;

  /**
   * Enregistreur en mémoire d'une source : morceaux de son 16 bits horodatés. Lecture d'un
   * intervalle quelconque, libération des morceaux anciens (réunions enchaînées).
   */
  class Recorder {
    constructor(t0) {
      this.parts = []; // { t, data: Int16Array }
      this.t = t0; // instant de fin du dernier morceau
    }

    // Source rebranchée (partage relancé) : le temps reprend à l'heure de la capture
    resync(now) {
      if (now > this.t) this.t = now;
    }

    push(samples) {
      const data = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i++)
        data[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)));
      this.parts.push({ t: this.t, data });
      this.t += samples.length / RATE;
    }

    end() {
      return this.t;
    }

    read(from, to) {
      const out = new Float32Array(Math.max(0, Math.round((to - from) * RATE)));
      for (const p of this.parts) {
        const pEnd = p.t + p.data.length / RATE;
        if (pEnd <= from || p.t >= to) continue;
        const a = Math.max(0, Math.round((from - p.t) * RATE));
        const b = Math.min(p.data.length, Math.round((to - p.t) * RATE));
        const at = Math.round((p.t - from) * RATE);
        for (let i = a; i < b; i++) {
          const k = at + i;
          if (k >= 0 && k < out.length) out[k] = p.data[i] / 32768;
        }
      }
      return out;
    }

    /** Oublie le son antérieur à un instant (mémoire libérée). */
    trim(before) {
      this.parts = this.parts.filter((p) => p.t + p.data.length / RATE > before);
    }
  }

  /**
   * Repère la parole d'un son brut qui n'a PAS été transcrite (rattrapage de fin de réunion).
   * Trames de 32 ms au-dessus du bruit de fond, regroupées en passages (pause < 0,8 s), hors des
   * intervalles déjà couverts. Retourne des passages { from, to, speech } en temps absolu.
   */
  function findUncovered(samples, t0, covered, opts) {
    const o = Object.assign({ margin: 10, floor: -55, gap: 0.8, minSpeech: 0.8, pad: 0.3 }, opts || {});
    const dt = FRAME / RATE;
    const n = Math.floor(samples.length / FRAME);
    if (!n) return [];
    const db = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      let e = 0;
      for (let i = k * FRAME; i < (k + 1) * FRAME; i++) e += samples[i] * samples[i];
      db[k] = 10 * Math.log10(e / FRAME + 1e-10);
    }
    const sorted = Array.from(db).sort((a, b) => a - b);
    const noise = sorted[Math.floor(n * 0.2)];
    const limit = Math.max(noise + o.margin, o.floor);
    const isCovered = (t) => covered.some(([a, b]) => t >= a - o.pad && t <= b + o.pad);
    const regions = [];
    let cur = null;
    for (let k = 0; k < n; k++) {
      const t = t0 + k * dt;
      if (db[k] <= limit || isCovered(t)) continue;
      if (cur && t - cur.to <= o.gap) {
        cur.to = t + dt;
        cur.speech += dt;
      } else {
        if (cur) regions.push(cur);
        cur = { from: t, to: t + dt, speech: dt };
      }
    }
    if (cur) regions.push(cur);
    return regions.filter((r) => r.speech >= o.minSpeech);
  }

  class Capture {
    /**
     * @param {(source:string, seg:object) => void} onSegment
     */
    /**
     * options.analyzer : Lowsper.Analyzer (détection de parole Silero), facultatif
     * options.emitEarly : () => booléen, voir Segmenter
     */
    constructor(onSegment, options) {
      this.onSegment = onSegment;
      this.analyzer = (options && options.analyzer) || null;
      this.emitEarly = (options && options.emitEarly) || null;
      this.ctx = null;
      this.sources = {}; // id -> { stream, node, segmenter, resampler }
      this.paused = false;
      this.startTime = 0;
      // Filet de sécurité : tout le son reçu, en mémoire (16 kHz, 16 bits), pour rattraper en fin de
      // réunion la parole que la chaîne en direct aurait manquée. Jamais écrit sur le disque.
      this.recorders = (options && options.recorders) || {};
    }

    /** Son brut reçu d'une source entre deux instants (s, temps de la capture). */
    audio(id, from, to) {
      const rec = this.recorders[id];
      return rec ? rec.read(from, to) : new Float32Array(0);
    }

    /** Retard de la détection de parole sur le son reçu (s) : PC surchargé si ça grandit. */
    lag(id) {
      const e = this.sources[id];
      const rec = this.recorders[id];
      return e && rec ? Math.max(0, rec.end() - e.segmenter.t) : 0;
    }

    async init() {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      this.useWorklet = false;
      if (this.ctx.audioWorklet) {
        // En file://, Chrome refuse les worklets chargés depuis un blob: mais accepte data:.
        const urls = [
          'data:text/javascript;base64,' + btoa(WORKLET),
          URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })),
        ];
        for (const url of urls) {
          try {
            await this.ctx.audioWorklet.addModule(url);
            this.useWorklet = true;
            break;
          } catch (e) {
            console.info('AudioWorklet refusé pour %s', url.slice(0, 5), e);
          }
        }
        URL.revokeObjectURL(urls[1]);
        if (!this.useWorklet) console.warn('AudioWorklet indisponible, repli sur ScriptProcessor');
      }
      this.startTime = this.ctx.currentTime;
    }

    // Temps écoulé depuis le début de la session (s)
    now() {
      return this.ctx ? this.ctx.currentTime - this.startTime : 0;
    }

    attach(id, stream) {
      this.detach(id);
      const ctx = this.ctx;
      const src = ctx.createMediaStreamSource(stream);
      const resampler = new Resampler(ctx.sampleRate);
      const analyzer = this.analyzer;
      if (analyzer) analyzer.reset(id).catch(() => {});
      const segmenter = new Segmenter((seg) => this.onSegment(id, seg), {
        vad: analyzer ? { run: (samples) => analyzer.vad(id, samples) } : null,
        emitEarly: this.emitEarly,
      });
      // La source peut être branchée en cours de session : on aligne son horloge.
      segmenter.t = this.now();
      // heard : du son est-il vraiment passé depuis l'ouverture ? Une piste peut s'ouvrir sans
      // erreur et rester muette selon le PC (decision.md §55). Plus aucun calcul une fois entendu.
      const entry = {
        stream,
        src,
        resampler,
        segmenter,
        inputs: [{ stream, src }],
        heard: false,
        openedAt: this.now(),
      };
      const floor = (Lowsper.Meeting && Lowsper.Meeting.SOUND_RMS) || 0.0005;
      if (!this.recorders[id]) this.recorders[id] = new Recorder(this.now());
      const rec = this.recorders[id];
      rec.resync(this.now());
      const feed = (block) => {
        if (!entry.heard && block.length) {
          let sum = 0;
          for (let i = 0; i < block.length; i++) sum += block[i] * block[i];
          entry.heard = Math.sqrt(sum / block.length) >= floor;
        }
        const samples = resampler.process(block);
        rec.push(samples);
        return segmenter.push(samples, this.paused);
      };

      if (this.useWorklet) {
        const node = new AudioWorkletNode(ctx, 'lowsper-tap', { numberOfOutputs: 0 });
        node.port.onmessage = (e) => feed(e.data);
        src.connect(node);
        entry.node = node;
      } else {
        const node = ctx.createScriptProcessor(4096, 1, 1);
        node.onaudioprocess = (e) => feed(new Float32Array(e.inputBuffer.getChannelData(0)));
        const mute = ctx.createGain();
        mute.gain.value = 0;
        src.connect(node);
        node.connect(mute);
        mute.connect(ctx.destination);
        entry.node = node;
        entry.mute = mute;
      }
      this.sources[id] = entry;
    }

    /** Du son est-il passé sur la source depuis son ouverture ? { heard, elapsedS }, ou null. */
    soundCheck(id) {
      const e = this.sources[id];
      return e ? { heard: e.heard, elapsedS: this.now() - e.openedAt } : null;
    }

    // Niveau sonore lissé 0..1 pour les vumètres
    level(id) {
      const e = this.sources[id];
      if (!e || this.paused) return 0;
      const db = e.segmenter.level;
      return Math.max(0, Math.min(1, (db + 65) / 50));
    }

    isSpeaking(id) {
      const e = this.sources[id];
      return !!(e && e.segmenter.active && !this.paused);
    }

    /**
     * Ajoute un son à une source déjà branchée (decision.md §48) : par exemple l'onglet d'une
     * vidéo présentée, en plus de l'onglet de la visio. Les sons sont additionnés avant le
     * découpage : la source reste une seule voix pour le moteur (« participants »).
     * Retourne le nombre de sons de la source.
     */
    addInput(id, stream) {
      const e = this.sources[id];
      if (!e) {
        this.attach(id, stream);
        return 1;
      }
      const src = this.ctx.createMediaStreamSource(stream);
      src.connect(e.node);
      e.inputs.push({ stream, src });
      return e.inputs.length;
    }

    /** Retire un son d'une source ; retourne le nombre de sons restants (0 : source débranchée). */
    removeInput(id, stream) {
      const e = this.sources[id];
      if (!e) return 0;
      const i = e.inputs.findIndex((x) => x.stream === stream);
      if (i < 0) return e.inputs.length;
      if (e.inputs.length === 1) {
        this.detach(id);
        return 0;
      }
      const [x] = e.inputs.splice(i, 1);
      try {
        x.src.disconnect();
      } catch {}
      stopStream(x.stream);
      return e.inputs.length;
    }

    detach(id) {
      const e = this.sources[id];
      if (!e) return Promise.resolve();
      const done = e.segmenter.flush();
      try {
        for (const x of e.inputs) x.src.disconnect();
        e.node.disconnect();
        if (e.mute) e.mute.disconnect();
      } catch {}
      for (const x of e.inputs) stopStream(x.stream);
      delete this.sources[id];
      return Promise.resolve(done);
    }

    /** Termine les passages en cours sur toutes les sources, sans couper la capture (enchaînement). */
    cut() {
      return Promise.all(Object.values(this.sources).map((e) => e.segmenter.flush()));
    }

    setPaused(paused) {
      this.paused = paused;
      if (paused) for (const e of Object.values(this.sources)) e.segmenter.flush();
    }

    async stop() {
      await Promise.all(Object.keys(this.sources).map((id) => this.detach(id)));
      if (this.ctx) await this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Demandes d'accès aux périphériques
  // ---------------------------------------------------------------------------

  // Réglages souhaités, jamais exigés : un PC qui ne sait pas les appliquer doit quand même
  // donner le son (decision.md §46). Chrome refuse parfois d'ouvrir une source quand il ne peut
  // pas appliquer un réglage demandé (« Could not start audio source », NotReadableError).
  const MIC_WANTED = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
  const OTHERS_WANTED = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  // Erreurs après lesquelles un autre essai a un sens (pas un refus de l'utilisateur)
  const RETRY = new Set(['NotReadableError', 'OverconstrainedError', 'AbortError', 'NotFoundError', 'TypeError']);

  /** Applique des réglages à une piste déjà ouverte, sans jamais échouer. Retourne true si appliqués. */
  async function tryConstraints(track, wanted) {
    if (!track || !track.applyConstraints) return false;
    try {
      await track.applyConstraints(wanted);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Micro, quel qu'il soit (intégré, webcam, casque filaire, USB, Bluetooth). Essais successifs :
   *   1. le micro par défaut avec ses réglages (anti-écho, réduction de bruit, gain) ;
   *   2. le micro par défaut sans aucun réglage (les réglages sont ensuite tentés sur la piste) ;
   *   3. chacun des autres micros, sans réglage.
   * Un refus de l'utilisateur (NotAllowedError) arrête tout. md : navigator.mediaDevices (tests).
   */
  Lowsper.getMicrophone = async function (md) {
    md = md || navigator.mediaDevices;
    const tries = [
      { audio: MIC_WANTED, video: false, note: 'réglages' },
      { audio: true, video: false, note: 'simple' },
    ];
    let last = null;
    const attempt = async (c) => {
      const stream = await md.getUserMedia({ audio: c.audio, video: false });
      if (c.note !== 'réglages')
        stream._lowsperProcessed = await tryConstraints(stream.getAudioTracks()[0], MIC_WANTED);
      stream._lowsperAttempt = c.note;
      return stream;
    };
    for (const c of tries) {
      try {
        return await attempt(c);
      } catch (err) {
        last = err;
        if (!RETRY.has(err && err.name)) throw err;
      }
    }
    // Un autre micro : le micro par défaut peut être occupé ou indisponible (casque débranché...)
    let devices = [];
    try {
      devices = (await md.enumerateDevices()).filter(
        (d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default'
      );
    } catch {}
    for (const d of devices) {
      try {
        return await attempt({ audio: { deviceId: { exact: d.deviceId } }, note: 'autre micro' });
      } catch (err) {
        last = err;
        if (!RETRY.has(err && err.name)) throw err;
      }
    }
    throw last;
  };

  /**
   * Demande le partage d'écran pour récupérer le son de l'ordinateur (les participants), quelle
   * que soit la sortie : haut-parleurs, casque filaire, USB ou Bluetooth.
   * mode (decision.md §46 et §47) :
   *   - 'screen' (par défaut) : écran entier ou fenêtre, avec le son du système ou de la fenêtre ;
   *   - 'simple' : le même, avec le strict minimum, après un échec ;
   *   - 'tab' : la fenêtre de choix s'ouvre sur les onglets. Le son d'un onglet est pris dans le
   *     navigateur, avant Windows : il ne dépend ni du casque ni de la sortie son.
   *   - 'apps' : écran entier, son de toutes les applications sauf ce navigateur
   *     (restrictOwnAudio). Sous Windows 11, Chromium copie alors le son de chaque application au
   *     lieu de la sortie son : il marche quand la sortie est refusée (casque surround, §51) ;
   *   - 'system' : écran entier présélectionné, son du système (test du son, decision.md §56).
   * Toutes les surfaces restent proposées : le mode ne fait que présélectionner.
   * Lowsper.canRestrictOwnAudio() dit si le navigateur connaît restrictOwnAudio.
   * La vidéo est obligatoire pour la plupart des navigateurs : on la demande au minimum
   * (1 image/s, petite taille) et on ne l'utilise jamais. Le son est demandé sans réglage
   * (audio: true) ; l'absence de traitement (anti-écho, gain) est tentée ensuite sur la piste.
   * Retourne un MediaStream audio seul, ou lève une erreur explicite.
   */
  Lowsper.getSystemAudio = async function (mode, md) {
    md = md || navigator.mediaDevices;
    if (mode === true) mode = 'simple';
    const small = { frameRate: 1, width: { max: 640 }, height: { max: 360 } };
    const surface = { tab: 'browser', apps: 'monitor', system: 'monitor' }[mode];
    const options =
      mode === 'simple'
        ? { video: true, audio: true, systemAudio: 'include', windowAudio: 'window' }
        : {
            video: surface ? { ...small, displaySurface: surface } : small,
            // Le seul réglage demandé à l'ouverture, et seulement ici : c'est lui qui change le
            // chemin pris dans Windows (decision.md §51)
            audio: mode === 'apps' ? { restrictOwnAudio: true } : true,
            systemAudio: 'include',
            // Fenêtre d'une application (Teams, Jabber) : son de cette fenêtre plutôt que du système
            windowAudio: 'window',
            selfBrowserSurface: 'exclude',
            surfaceSwitching: 'include',
            monitorTypeSurfaces: 'include',
          };
    const stream = await md.getDisplayMedia(options);
    const audio = stream.getAudioTracks();
    if (!audio.length) {
      stream.getTracks().forEach((t) => t.stop());
      const err = new Error('NO_AUDIO');
      err.code = 'NO_AUDIO';
      throw err;
    }
    // La piste vidéo reste ouverte (l'arrêter couperait l'audio sur certains navigateurs)
    // mais elle n'est lue par personne. On garde une référence pour l'arrêter à la fin.
    const out = new MediaStream(audio);
    out._lowsperVideo = stream.getVideoTracks();
    out._lowsperProcessed = await tryConstraints(audio[0], OTHERS_WANTED);
    out._lowsperAttempt = mode || 'screen';
    // Surface réellement choisie (monitor, window, browser), pour retenir ce qui marche
    const video = stream.getVideoTracks()[0];
    out._lowsperSurface = (video && video.getSettings && video.getSettings().displaySurface) || '';
    // Son de ce navigateur exclu (restrictOwnAudio appliqué) : ses onglets sont à ajouter à part
    const set = audio[0].getSettings ? audio[0].getSettings() : {};
    out._lowsperRestricted = set.restrictOwnAudio === true;
    return out;
  };

  /**
   * Windows 11 ? Sous Windows, platformVersion 13 ou plus désigne Windows 11 (Client Hints). Le
   * code de Chromium ne copie le son par application qu'à partir de Windows 11 (decision.md §51).
   */
  Lowsper.isWindows11 = async function (nav) {
    nav = nav || navigator;
    try {
      const ua = nav.userAgentData;
      if (!ua || ua.platform !== 'Windows') return false;
      const h = await ua.getHighEntropyValues(['platformVersion']);
      return parseInt(h.platformVersion, 10) >= 13;
    } catch {
      return false;
    }
  };

  /** Le navigateur sait-il exclure son propre son du partage (restrictOwnAudio) ? */
  Lowsper.canRestrictOwnAudio = function (md) {
    md = md || navigator.mediaDevices;
    try {
      return !!(md && md.getSupportedConstraints && md.getSupportedConstraints().restrictOwnAudio);
    } catch {
      return false;
    }
  };

  Lowsper.Capture = Capture;
  Lowsper.Segmenter = Segmenter;
  Lowsper.blockTime = blockTime;
  Lowsper.Recorder = Recorder;
  Lowsper.findUncovered = findUncovered;
  /** Intervalles de parole réels [début, fin] (s) d'un bloc, d'après la détection de parole. */
  Lowsper.speechIntervals = function (block) {
    const m = block.map || [];
    const total = block.audio ? block.audio.length / RATE : block.end - block.start;
    return m.map((x, i) => [x.t, x.t + Math.max(0, (i + 1 < m.length ? m[i + 1].at - VAD.gap : total) - x.at)]);
  };
  Lowsper.Resampler = Resampler;
  Lowsper.AUDIO_RATE = RATE;
})();
