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
  const FRAME = 480; // 30 ms à 16 kHz

  // Réglages du découpage (en secondes)
  const VAD = {
    preRoll: 0.4, // audio conservé avant le début détecté de la parole
    minSpeech: 0.35, // en dessous, le segment est ignoré (toux, clic...)
    softPause: 0.7, // pause qui permet de couper si le segment est déjà long
    softLength: 14, // longueur à partir de laquelle une pause courte suffit
    hardPause: 1.6, // pause qui termine toujours le segment
    maxLength: 28, // Whisper traite des fenêtres de 30 s
    hangover: 0.25, // la parole est prolongée de ce délai après la dernière trame forte
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
  // Détecteur d'activité vocale et découpeur de segments
  // ---------------------------------------------------------------------------
  class Segmenter {
    /**
     * @param {(seg:{start:number,end:number,audio:Float32Array,speech:number}) => void} onSegment
     */
    constructor(onSegment) {
      this.onSegment = onSegment;
      this.t = 0; // temps (s) du prochain échantillon reçu, depuis le début de la session
      this.pending = new Float32Array(0);
      this.noise = -60; // plancher de bruit estimé (dBFS)
      this.level = -100; // niveau de la dernière trame, pour l'affichage
      this.preRoll = []; // trames récentes hors segment
      this.seg = null; // segment en cours
    }

    // Ajoute de l'audio 16 kHz. paused=true : le temps avance mais rien n'est gardé.
    push(samples, paused) {
      if (paused) {
        this.flush();
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
      for (; i + FRAME <= buf.length; i += FRAME) this.frame(buf.subarray(i, i + FRAME));
      this.pending = buf.slice(i);
    }

    frame(f) {
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

      const loud = db > this.noise + 9 && db > -58;
      const copy = f.slice();

      if (!this.seg) {
        this.preRoll.push({ start, data: copy, db });
        const keep = Math.ceil(VAD.preRoll / (FRAME / RATE));
        if (this.preRoll.length > keep) this.preRoll.shift();
        if (loud) {
          this.seg = { frames: this.preRoll, speech: 0, lastLoud: start };
          this.preRoll = [];
          this.seg.speech += FRAME / RATE;
        }
        return;
      }

      const seg = this.seg;
      seg.frames.push({ start, data: copy, db });
      if (loud) {
        seg.lastLoud = start;
        seg.speech += FRAME / RATE;
      }
      const length = this.t - seg.frames[0].start;
      const pause = this.t - seg.lastLoud - VAD.hangover;

      if (pause >= VAD.hardPause || (pause >= VAD.softPause && length >= VAD.softLength)) {
        // Coupe au début de la pause, en gardant un peu de marge
        this.emit(seg.lastLoud + VAD.hangover + 0.2);
      } else if (length >= VAD.maxLength) {
        // Trop long : coupe sur la trame la plus calme des 5 dernières secondes
        const from = this.t - 5;
        let best = null;
        for (const fr of seg.frames) {
          if (fr.start < from) continue;
          if (!best || fr.db < best.db) best = fr;
        }
        this.emit(best ? best.start : this.t);
      }
    }

    // Termine le segment courant à l'instant cutAt ; ce qui suit repart dans un nouveau segment.
    emit(cutAt) {
      const seg = this.seg;
      this.seg = null;
      const keep = seg.frames.filter((fr) => fr.start < cutAt);
      const rest = seg.frames.filter((fr) => fr.start >= cutAt);
      this.deliver(keep, seg.speech);
      if (rest.length) {
        const loudRest = rest.filter((fr) => fr.db > this.noise + 9 && fr.db > -58);
        if (loudRest.length) {
          this.seg = {
            frames: rest,
            speech: loudRest.length * (FRAME / RATE),
            lastLoud: loudRest[loudRest.length - 1].start,
          };
        } else {
          this.preRoll = rest.slice(-Math.ceil(VAD.preRoll / (FRAME / RATE)));
        }
      }
    }

    deliver(frames, speech) {
      if (!frames.length || speech < VAD.minSpeech) return;
      const audio = new Float32Array(frames.length * FRAME);
      frames.forEach((fr, i) => audio.set(fr.data, i * FRAME));
      normalize(audio);
      this.onSegment({
        start: frames[0].start,
        end: frames[frames.length - 1].start + FRAME / RATE,
        audio,
        speech,
      });
    }

    flush() {
      if (this.seg) {
        const seg = this.seg;
        this.seg = null;
        this.deliver(seg.frames, seg.speech);
      }
    }
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

  class Capture {
    /**
     * @param {(source:string, seg:object) => void} onSegment
     */
    constructor(onSegment) {
      this.onSegment = onSegment;
      this.ctx = null;
      this.sources = {}; // id -> { stream, node, segmenter, resampler }
      this.paused = false;
      this.startTime = 0;
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
            console.info('AudioWorklet refusé pour ' + url.slice(0, 5), e);
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
      const segmenter = new Segmenter((seg) => this.onSegment(id, seg));
      // La source peut être branchée en cours de session : on aligne son horloge.
      segmenter.t = this.now();
      const entry = { stream, src, resampler, segmenter };
      const feed = (block) => segmenter.push(resampler.process(block), this.paused);

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

    // Niveau sonore lissé 0..1 pour les vumètres
    level(id) {
      const e = this.sources[id];
      if (!e || this.paused) return 0;
      const db = e.segmenter.level;
      return Math.max(0, Math.min(1, (db + 65) / 50));
    }

    isSpeaking(id) {
      const e = this.sources[id];
      return !!(e && e.segmenter.seg && !this.paused);
    }

    detach(id) {
      const e = this.sources[id];
      if (!e) return;
      e.segmenter.flush();
      try {
        e.src.disconnect();
        e.node.disconnect();
        if (e.mute) e.mute.disconnect();
      } catch {}
      e.stream.getTracks().forEach((t) => t.stop());
      (e.stream._lowsperVideo || []).forEach((t) => t.stop());
      delete this.sources[id];
    }

    setPaused(paused) {
      this.paused = paused;
      if (paused) for (const e of Object.values(this.sources)) e.segmenter.flush();
    }

    async stop() {
      for (const id of Object.keys(this.sources)) this.detach(id);
      if (this.ctx) await this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Demandes d'accès aux périphériques
  // ---------------------------------------------------------------------------

  Lowsper.getMicrophone = function () {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    });
  };

  /**
   * Demande le partage d'écran pour récupérer le son des participants.
   * La vidéo est obligatoire pour la plupart des navigateurs : on la demande au minimum
   * (1 image/s, petite taille) et on ne l'utilise jamais.
   * Retourne un MediaStream audio seul, ou lève une erreur explicite.
   */
  Lowsper.getSystemAudio = async function () {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 1, width: { max: 640 }, height: { max: 360 } },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        suppressLocalAudioPlayback: false,
      },
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      monitorTypeSurfaces: 'include',
    });
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
    return out;
  };

  Lowsper.Capture = Capture;
  Lowsper.Segmenter = Segmenter;
  Lowsper.Resampler = Resampler;
  Lowsper.AUDIO_RATE = RATE;
})();
