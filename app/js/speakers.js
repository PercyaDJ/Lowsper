/*
 * Lowsper : distinction des intervenants sur la source « Participants ».
 *
 * Analogie : chaque phrase reçoit une « empreinte vocale » (256 nombres calculés par
 * WeSpeaker). Deux phrases d'une même personne ont des empreintes proches. On regroupe
 * donc les phrases en voix distinctes, nommées « Intervenant 1, 2, 3... » dans l'ordre
 * d'apparition. Le micro reste toujours « Vous ».
 *
 * - Pendant la réunion : regroupement au fil de l'eau (chaque phrase rejoint la voix la plus
 *   proche, ou crée une nouvelle voix), pour l'affichage en direct.
 * - À la fin : regroupement global de toutes les empreintes (plus fiable), qui peut fusionner
 *   deux voix créées à tort pendant la réunion.
 *
 * Limites : les noms réels ne sont pas connus (l'IA de compte rendu les déduit souvent des
 * échanges, « merci Julie... ») ; deux voix très proches peuvent être confondues ; une personne
 * dont le son change (micro différent) peut apparaître sous deux numéros.
 */
(function () {
  'use strict';

  const Lowsper = (window.Lowsper = window.Lowsper || {});
  const RATE = 16000;

  const CFG = {
    window: 2, // durée (s) d'une fenêtre d'analyse
    hop: 1, // pas entre deux fenêtres
    onlineJoin: 0.55, // similarité pour rejoindre une voix existante pendant la réunion
    segment: 0.6, // similarité pour prolonger un tour de parole avec la fenêtre suivante
    finalMerge: 0.55, // similarité moyenne pour fusionner deux voix à la fin (réglé sur corpus)
    minVoice: 8, // une « voix » de moins de 8 s de parole est rattachée à la plus proche
  };

  function cosine(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  // La fenêtre contient-elle autre chose que du silence (les blocs incluent de courts silences) ?
  function hasVoice(a) {
    let e = 0;
    for (let i = 0; i < a.length; i++) e += a[i] * a[i];
    return Math.sqrt(e / a.length) > 0.01;
  }

  function normalize(v) {
    let n = 0;
    for (const x of v) n += x * x;
    n = Math.sqrt(n) || 1;
    return v.map((x) => x / n);
  }

  class SpeakerTracker {
    constructor(analyzer) {
      this.analyzer = analyzer;
      this.voices = []; // { id, sum: Float32Array, dur }
      this.items = []; // fenêtres analysées : { emb, dur, voice, at }
      this.covers = []; // par phrase : [[indice de fenêtre, recouvrement en s], ...]
      this.nextId = 1;
    }

    /**
     * Attribue une voix à chaque phrase d'un bloc.
     *
     * Méthode des fenêtres glissantes : le bloc est parcouru par fenêtres de 2 s (pas de 1 s).
     * Chaque fenêtre reçoit une empreinte et rejoint la voix la plus proche (ou en crée une).
     * Chaque phrase prend ensuite la voix majoritaire parmi les fenêtres qu'elle recouvre.
     * Ainsi, deux personnes qui s'enchaînent sans pause, ou qui se coupent la parole, sont
     * quand même séparées (à la seconde près).
     *
     * @param {Float32Array} audio  audio du bloc (16 kHz)
     * @param {Array<{from:number,to:number|null}>} chunks phrases horodatées dans le bloc
     * @param {object} block  bloc (pour l'heure réelle de chaque fenêtre)
     * @returns {Promise<Array<number|null>>} identifiant de voix par phrase
     */
    async label(audio, chunks, block) {
      const total = audio.length / RATE;
      const spans = []; // { from, to, voice }
      if (total >= CFG.window * 0.75) {
        const win = Math.min(CFG.window, total);
        const starts = [];
        for (let t = 0; t + win <= total + 0.01; t += CFG.hop) starts.push(t);
        if (total - (starts[starts.length - 1] + win) > CFG.hop / 2) starts.push(total - win);
        for (const t of starts) {
          const slice = audio.slice(Math.floor(t * RATE), Math.floor((t + win) * RATE));
          if (!hasVoice(slice)) continue;
          let emb = null;
          try {
            emb = await this.analyzer.embed(slice);
          } catch (err) {
            console.warn('Empreinte vocale indisponible', err);
            break;
          }
          const at = block && Lowsper.blockTime ? Lowsper.blockTime(block, t) : null;
          const voice = this.assign(emb, win, at);
          spans.push({ from: t, to: t + win, voice, item: this.items.length - 1 });
        }
      }
      let prev = null;
      return chunks.map((c) => {
        const from = Math.max(0, c.from || 0);
        const to = Math.min(total, c.to != null ? c.to : total);
        const cover = new Map();
        const items = [];
        for (const sp of spans) {
          const o = Math.min(to, sp.to) - Math.max(from, sp.from);
          if (o <= 0) continue;
          cover.set(sp.voice, (cover.get(sp.voice) || 0) + o);
          items.push([sp.item, o]);
        }
        let voice = prev;
        let best = 0;
        for (const [v, o] of cover) if (o > best) { best = o; voice = v; }
        // Mémorise les fenêtres de la phrase, pour la réattribuer après le regroupement final
        const key = this.covers.length;
        this.covers.push(items.length ? items : this.covers[key - 1] || []);
        prev = voice;
        return voice == null ? null : { voice, key };
      });
    }

    assign(emb, dur, at) {
      let best = null;
      let bestSim = -1;
      for (const v of this.voices) {
        const sim = cosine(emb, normalize(v.sum));
        if (sim > bestSim) {
          bestSim = sim;
          best = v;
        }
      }
      if (!best || bestSim < CFG.onlineJoin) {
        best = { id: this.nextId++, sum: new Float32Array(emb.length), dur: 0 };
        this.voices.push(best);
      }
      for (let i = 0; i < emb.length; i++) best.sum[i] += emb[i] * dur;
      best.dur += dur;
      this.items.push({ emb, dur, voice: best.id, at });
      return best.id;
    }

    /**
     * Regroupement global de fin de réunion, sur toutes les fenêtres :
     * 1. les fenêtres consécutives et semblables forment des « tours de parole » ;
     * 2. regroupement hiérarchique à lien moyen (UPGMA) des tours, tant que deux groupes
     *    ont une similarité moyenne d'au moins CFG.finalMerge. Avec des empreintes
     *    normalisées, la similarité moyenne entre deux groupes se calcule directement à partir
     *    de la somme pondérée de leurs empreintes : le calcul reste rapide sur une heure ;
     * 3. les voix de moins de CFG.minVoice secondes rejoignent la voix la plus proche.
     * @returns {Map<number, number>} clé de phrase -> voix finale
     */
    finalize() {
      const items = this.items;
      if (!items.length) return new Map();
      const dim = items[0].emb.length;
      const add = (sum, e, w) => {
        for (let i = 0; i < dim; i++) sum[i] += e[i] * w;
      };
      const dot = (a, b) => {
        let s = 0;
        for (let i = 0; i < dim; i++) s += a[i] * b[i];
        return s;
      };
      // 1. tours de parole
      let groups = [];
      items.forEach((it, idx) => {
        const last = groups[groups.length - 1];
        const near = last && it.at != null && last.endAt != null && it.at - last.endAt <= 1.6;
        if (near && cosine(normalize(last.sum), it.emb) >= CFG.segment) {
          add(last.sum, it.emb, it.dur);
          last.w += it.dur;
          last.members.push(idx);
          last.endAt = it.at;
        } else {
          const sum = new Float32Array(dim);
          add(sum, it.emb, it.dur);
          groups.push({ sum, w: it.dur, members: [idx], endAt: it.at });
        }
      });
      const sim = (a, b) => dot(a.sum, b.sum) / (a.w * b.w);
      // 2. UPGMA
      for (;;) {
        let best = null;
        for (let i = 0; i < groups.length; i++) {
          for (let j = i + 1; j < groups.length; j++) {
            const v = sim(groups[i], groups[j]);
            if (!best || v > best.v) best = { i, j, v };
          }
        }
        if (!best || best.v < CFG.finalMerge) break;
        const a = groups[best.i];
        const b = groups[best.j];
        add(a.sum, b.sum, 1);
        a.w += b.w;
        a.members.push(...b.members);
        groups.splice(best.j, 1);
      }
      // 3. petites voix
      groups.sort((x, y) => x.w - y.w);
      for (const g of groups.slice()) {
        if (groups.length < 2 || g.w >= CFG.minVoice) continue;
        let target = null;
        let bv = -Infinity;
        for (const o of groups) {
          if (o === g) continue;
          const v = sim(g, o);
          if (v > bv) {
            bv = v;
            target = o;
          }
        }
        add(target.sum, g.sum, 1);
        target.w += g.w;
        target.members.push(...g.members);
        groups.splice(groups.indexOf(g), 1);
      }
      const itemGroup = new Int32Array(items.length);
      groups.forEach((g, gi) => g.members.forEach((m) => (itemGroup[m] = gi + 1)));
      // Chaque phrase prend la voix finale majoritaire parmi ses fenêtres
      const map = new Map();
      this.covers.forEach((cover, key) => {
        const votes = new Map();
        for (const [idx, o] of cover) votes.set(itemGroup[idx], (votes.get(itemGroup[idx]) || 0) + o);
        let bestG = null;
        let bestO = 0;
        for (const [g, o] of votes) if (o > bestO) { bestO = o; bestG = g; }
        if (bestG != null) map.set(key, 1000 + bestG);
      });
      return map;
    }
  }

  Lowsper.SpeakerTracker = SpeakerTracker;
  Lowsper.SPEAKER_CONFIG = CFG;
})();
