/*
 * Lowsper : test du son de la réunion (decision.md §56).
 *
 * Trouve une fois pour toutes le chemin par lequel ce PC laisse passer le son de l'ordinateur
 * (Teams, Jabber, une vidéo), en dehors de toute réunion :
 *   - son du système : Lowsper joue un court signal et vérifie qu'il revient dans le partage.
 *     La copie de la sortie son de Windows contient le son de toutes les applications, ce
 *     navigateur compris : le test se fait seul, sans rien demander d'autre ;
 *   - son de toutes les applications : ce chemin exclut par principe le son de ce navigateur, le
 *     signal n'y revient pas. On attend donc un son venu d'une autre application.
 * Rien n'est enregistré : le son est seulement mesuré, puis le partage est arrêté.
 */
(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const Lowsper = (root.Lowsper = root.Lowsper || {});

  const TONE_HZ = 1000;
  // Part de l'énergie à la fréquence du signal : 1 pour le signal seul, quelques centièmes pour de
  // la parole ou de la musique
  const TONE_RATIO = 0.25;
  const floor = () => (Lowsper.Meeting && Lowsper.Meeting.SOUND_RMS) || 0.0005;

  /** Niveau efficace d'un bloc d'échantillons. */
  function rms(samples) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    return samples.length ? Math.sqrt(sum / samples.length) : 0;
  }

  /**
   * Part de l'énergie d'un bloc portée par la fréquence freq (algorithme de Goertzel), entre 0 et
   * environ 1. Fonction pure.
   */
  function toneRatio(samples, rate, freq) {
    const n = samples.length;
    if (!n) return 0;
    const w = (2 * Math.PI * freq) / rate;
    const c = 2 * Math.cos(w);
    let s1 = 0;
    let s2 = 0;
    let energy = 0;
    for (let i = 0; i < n; i++) {
      const s0 = samples[i] + c * s1 - s2;
      s2 = s1;
      s1 = s0;
      energy += samples[i] * samples[i];
    }
    const power = s1 * s1 + s2 * s2 - c * s1 * s2;
    return energy > 0 ? power / ((n / 2) * energy) : 0;
  }

  /** Le signal est-il dans ce bloc ? Assez fort et dominant. Fonction pure. */
  function toneHeard(samples, rate, freq) {
    return rms(samples) >= floor() && toneRatio(samples, rate, freq || TONE_HZ) >= TONE_RATIO;
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // Lecture du son d'un partage, sans rien garder : un analyseur relu à intervalle régulier
  function listen(stream) {
    const ctx = new (root.AudioContext || root.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    return {
      ctx,
      read() {
        an.getFloatTimeDomainData(buf);
        return buf;
      },
      close() {
        try {
          src.disconnect();
        } catch {}
        return ctx.close().catch(() => {});
      },
    };
  }

  /**
   * Joue un signal court (trois bips de 1 000 Hz) et dit s'il revient dans le partage.
   * Retourne true dès que deux lectures le contiennent, false après timeoutMs.
   */
  async function probeTone(stream, timeoutMs) {
    const l = listen(stream);
    if (l.ctx.state === 'suspended') await l.ctx.resume().catch(() => {});
    const osc = l.ctx.createOscillator();
    const gain = l.ctx.createGain();
    osc.frequency.value = TONE_HZ;
    gain.gain.value = 0;
    const t0 = l.ctx.currentTime + 0.05;
    for (let i = 0; i < 3; i++) {
      gain.gain.setValueAtTime(0.2, t0 + i * 0.4);
      gain.gain.setValueAtTime(0, t0 + i * 0.4 + 0.25);
    }
    osc.connect(gain).connect(l.ctx.destination);
    osc.start();
    let hits = 0;
    const end = Date.now() + (timeoutMs || 3000);
    try {
      while (Date.now() < end) {
        await wait(50);
        if (toneHeard(l.read(), l.ctx.sampleRate, TONE_HZ) && ++hits >= 2) return true;
      }
      return false;
    } finally {
      try {
        osc.stop();
      } catch {}
      await l.close();
    }
  }

  /** Attend un son quelconque dans le partage ; true dès qu'il arrive, false après timeoutMs. */
  async function waitForSound(stream, timeoutMs, cancelled) {
    const l = listen(stream);
    const end = Date.now() + (timeoutMs || 30000);
    try {
      while (Date.now() < end && !(cancelled && cancelled())) {
        await wait(100);
        if (rms(l.read()) >= floor()) return true;
      }
      return false;
    } finally {
      await l.close();
    }
  }

  Lowsper.SoundTest = { TONE_HZ, TONE_RATIO, rms, toneRatio, toneHeard, probeTone, waitForSound };
})();
