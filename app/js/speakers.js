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
    onlineJoin: 0.5, // similarité pour rejoindre une voix existante pendant la réunion
    maxVoices: 12, // nombre maximal de voix si le nombre de participants n'est pas indiqué
    segment: 0.6, // similarité pour prolonger un tour de parole avec la fenêtre suivante
    silhouetteMin: 0.12, // en dessous, aucun découpage n'est net : une seule voix (réglé sur simulations)
    maxSegments: 900, // au-delà, les tours voisins sont regroupés deux à deux (temps de calcul borné)
    minVoice: 8, // une voix de moins de 8 s de parole...
    minShare: 0.02, // ... ou de moins de 2 % du temps de parole est rattachée à la plus proche
    micMin: 1.0, // phrase du micro analysée à partir de 1 s
    micLearn: 10, // secondes de parole « seul au micro » avant de juger une phrase
    micForeign: 0.4, // en dessous : phrase étrangère à votre voix
    sameVoice: 0.75, // deux voix finales plus proches que cela sont une même personne (mesuré : 0,89 vs 0,6 au plus)
    remember: 0.65, // similarité pour reconnaître une voix mémorisée (prudent : un mauvais nom est pire qu'aucun)
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
    return Array.from(v, (x) => x / n);
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
        if (voice == null) return null;
        // Après un regroupement en cours de réunion, les voix provisoires prennent leur voix regroupée
        return { voice: (this.liveMap && this.liveMap.get(voice)) || voice, key };
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
      // Nouvelle voix seulement si aucune n'est proche, et dans la limite du nombre attendu :
      // au-delà, la fenêtre rejoint la voix la plus proche (évite l'explosion du nombre de voix).
      const cap = this.expected || CFG.maxVoices;
      if (!best || (bestSim < CFG.onlineJoin && this.voices.length < cap)) {
        best = { id: this.nextId++, sum: new Float32Array(emb.length), dur: 0 };
        this.voices.push(best);
      }
      for (let i = 0; i < emb.length; i++) best.sum[i] += emb[i] * dur;
      best.dur += dur;
      this.items.push({ emb, dur, voice: best.id, at });
      return best.id;
    }

    /**
     * Regroupement global de fin de réunion, sur toutes les fenêtres analysées.
     *
     * 1. Tours de parole : fenêtres consécutives et semblables réunies.
     * 2. Arbre de regroupement complet (UPGMA, lien moyen). Avec des empreintes normalisées, la
     *    similarité moyenne entre deux groupes vaut dot(somme A, somme B) / (poids A x poids B) :
     *    on tient à jour la matrice des produits scalaires et le plus proche voisin de chaque
     *    groupe. Une heure de réunion se traite en quelques secondes.
     * 3. Choix du nombre de voix :
     *    - si l'utilisateur a indiqué le nombre de participants, on coupe l'arbre à ce nombre ;
     *    - sinon, on choisit le nombre (2 à 12) dont les groupes sont les plus nets (critère de
     *      silhouette : chaque tour ressemble-t-il davantage à sa voix qu'à la voix voisine ?),
     *      et une seule voix si aucun découpage n'est net.
     *    Un seuil de similarité fixe ne convient pas : avec le son compressé d'une visio, les
     *    empreintes d'une même personne se ressemblent moins, et un seuil réglé sur un son propre
     *    découpait une réunion d'une heure en centaines de « voix ».
     * 4. Les voix qui parlent trop peu (moins de 8 s ou de 2 % du temps de parole) sont
     *    rattachées à la plus proche (bruit, rires, paroles simultanées).
     * @returns {Map<number, number>} clé de phrase -> voix finale
     */
    finalize(opts) {
      // En cours de réunion, calcul allégé (moins de tours de parole) : le regroupement tourne
      // sur la page elle-même, il ne doit jamais la figer plus d'une fraction de seconde.
      const maxSegments = (opts && opts.maxSegments) || CFG.maxSegments;
      const items = this.items;
      if (!items.length) return new Map();
      const dim = items[0].emb.length;
      const dotv = (a, b) => {
        let d = 0;
        for (let k = 0; k < dim; k++) d += a[k] * b[k];
        return d;
      };

      // 1. tours de parole
      let segs = [];
      items.forEach((it, idx) => {
        const last = segs[segs.length - 1];
        const near = last && it.at != null && last.endAt != null && it.at - last.endAt <= 1.6;
        if (near && cosine(normalize(last.sum), it.emb) >= CFG.segment) {
          for (let k = 0; k < dim; k++) last.sum[k] += it.emb[k] * it.dur;
          last.w += it.dur;
          last.members.push(idx);
          last.endAt = it.at;
        } else {
          const sum = new Float64Array(dim);
          for (let k = 0; k < dim; k++) sum[k] = it.emb[k] * it.dur;
          segs.push({ sum, w: it.dur, members: [idx], endAt: it.at });
        }
      });
      // Réunion très longue : on regroupe deux à deux les tours voisins pour borner le calcul
      while (segs.length > maxSegments) {
        const next = [];
        for (let i = 0; i < segs.length; i += 2) {
          const a = segs[i];
          const b = segs[i + 1];
          if (b) {
            for (let k = 0; k < dim; k++) a.sum[k] += b.sum[k];
            a.w += b.w;
            a.members.push(...b.members);
          }
          next.push(a);
        }
        segs = next;
      }
      const n = segs.length;

      // 2. arbre UPGMA complet, avec historique des fusions
      const D = new Float64Array(n * n);
      for (let i = 0; i < n; i++) for (let j = i; j < n; j++) D[i * n + j] = D[j * n + i] = dotv(segs[i].sum, segs[j].sum);
      const W = Float64Array.from(segs, (g) => g.w);
      const alive = new Uint8Array(n).fill(1);
      const sim = (i, j) => D[i * n + j] / (W[i] * W[j]);
      const best = new Int32Array(n).fill(-1);
      const bestV = new Float64Array(n).fill(-Infinity);
      const refresh = (i) => {
        best[i] = -1;
        bestV[i] = -Infinity;
        for (let j = 0; j < n; j++) {
          if (j === i || !alive[j]) continue;
          const v = sim(i, j);
          if (v > bestV[i]) {
            bestV[i] = v;
            best[i] = j;
          }
        }
      };
      for (let i = 0; i < n; i++) refresh(i);
      const history = [];
      for (let count = n; count > 1; count--) {
        let a = -1;
        for (let i = 0; i < n; i++) if (alive[i] && best[i] >= 0 && (a < 0 || bestV[i] > bestV[a])) a = i;
        if (a < 0) break;
        const b = best[a];
        for (let k = 0; k < n; k++) {
          if (!alive[k] || k === b) continue;
          D[a * n + k] += D[b * n + k];
          D[k * n + a] = D[a * n + k];
        }
        W[a] += W[b];
        alive[b] = 0;
        history.push([a, b]);
        for (let i = 0; i < n; i++) {
          if (!alive[i]) continue;
          if (i === a || best[i] === a || best[i] === b) refresh(i);
          else {
            const v = sim(i, a);
            if (v > bestV[i]) {
              bestV[i] = v;
              best[i] = a;
            }
          }
        }
      }
      // Étiquettes obtenues en coupant l'arbre à K groupes
      const cut = (K) => {
        const parent = Int32Array.from({ length: n }, (_, i) => i);
        const find = (x) => {
          while (parent[x] !== x) x = parent[x] = parent[parent[x]];
          return x;
        };
        for (let m = 0; m < Math.min(history.length, n - K); m++) parent[find(history[m][1])] = find(history[m][0]);
        const roots = new Map();
        return Int32Array.from({ length: n }, (_, i) => {
          const r = find(i);
          if (!roots.has(r)) roots.set(r, roots.size);
          return roots.get(r);
        });
      };

      // 3. nombre de voix
      //    Seuls les groupes qui parlent assez longtemps (« voix significatives ») comptent : en
      //    coupant l'arbre, les petits fragments (bruit, paroles mêlées) apparaissent souvent avant
      //    les vraies voix. Pour K voix, on prend donc la coupe la plus grossière qui fait
      //    apparaître K voix significatives, puis les fragments rejoignent la voix la plus proche.
      const totalW = segs.reduce((acc, g) => acc + g.w, 0);
      const minW = Math.max(CFG.minVoice, CFG.minShare * totalW);
      const unit = segs.map((g) => normalize(g.sum));
      const absorb = (lab) => {
        // poids et sommes par groupe ; les petits groupes rejoignent le grand groupe le plus proche
        const sums = new Map();
        lab.forEach((l, i) => {
          let g = sums.get(l);
          if (!g) sums.set(l, (g = { sum: new Float64Array(dim), w: 0 }));
          for (let k = 0; k < dim; k++) g.sum[k] += segs[i].sum[k];
          g.w += segs[i].w;
        });
        const big = [...sums].filter(([, g]) => g.w >= minW);
        if (!big.length) return { lab: new Int32Array(n), k: 1 };
        const remap = new Map();
        big.forEach(([id], r) => remap.set(id, r));
        for (const [id, g] of sums) {
          if (remap.has(id)) continue;
          let target = 0;
          let tv = -Infinity;
          big.forEach(([, o], r) => {
            const v = dotv(g.sum, o.sum) / (g.w * o.w);
            if (v > tv) {
              tv = v;
              target = r;
            }
          });
          remap.set(id, target);
        }
        return { lab: Int32Array.from(lab, (l) => remap.get(l)), k: big.length };
      };
      // Pour chaque nombre de voix significatives, la coupe la plus grossière qui le donne
      const byK = new Map();
      const kMax = Math.max(CFG.maxVoices, this.expected || 0);
      for (let c = 1; c <= n; c++) {
        const r = absorb(cut(c));
        if (!byK.has(r.k)) byK.set(r.k, r.lab);
        if (r.k > kMax) break;
      }
      let lab;
      if (this.expected) {
        // nombre indiqué : la coupe qui s'en approche le plus sans le dépasser
        const ks = [...byK.keys()].filter((k) => k <= this.expected).sort((x, y) => y - x);
        lab = byK.get(ks[0] || 1) || new Int32Array(n);
      } else {
        const dist = new Float32Array(n * n);
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) dist[i * n + j] = dist[j * n + i] = 1 - dotv(unit[i], unit[j]);
        const silhouette = (labs, k) => {
          const acc = new Float64Array(k);
          const wts = new Float64Array(k);
          let total = 0;
          let wsum = 0;
          for (let i = 0; i < n; i++) {
            acc.fill(0);
            wts.fill(0);
            for (let j = 0; j < n; j++) {
              if (j === i) continue;
              acc[labs[j]] += dist[i * n + j] * segs[j].w;
              wts[labs[j]] += segs[j].w;
            }
            if (!wts[labs[i]]) continue;
            const own = acc[labs[i]] / wts[labs[i]];
            let other = Infinity;
            for (let c = 0; c < k; c++) if (c !== labs[i] && wts[c]) other = Math.min(other, acc[c] / wts[c]);
            total += ((other - own) / Math.max(own, other, 1e-9)) * segs[i].w;
            wsum += segs[i].w;
          }
          return wsum ? total / wsum : -1;
        };
        lab = new Int32Array(n);
        this.scores = [];
        let bestS = CFG.silhouetteMin;
        for (const [k, l] of byK) {
          if (k < 2 || k > CFG.maxVoices) continue;
          const sc = silhouette(l, k);
          this.scores.push([k, sc]);
          if (sc > bestS) {
            bestS = sc;
            lab = l;
          }
        }
        this.silhouette = bestS;
      }

      const groups = new Map();
      lab.forEach((l, i) => {
        let g = groups.get(l);
        if (!g) groups.set(l, (g = { sum: new Float64Array(dim), w: 0, segs: [] }));
        for (let k = 0; k < dim; k++) g.sum[k] += segs[i].sum[k];
        g.w += segs[i].w;
        g.segs.push(i);
      });

      // 5. Deux groupes dont les empreintes moyennes restent très proches sont une même personne
      //    (le critère de silhouette trouve toujours une « structure », même dans une seule voix :
      //    variations d'intonation, de micro, de compression). Mesuré : une même voix coupée en deux
      //    donne des moyennes à 0,89 ; deux personnes réelles, 0,6 au plus après regroupement.
      if (!this.expected) {
        for (let merged = true; merged && groups.size > 1; ) {
          merged = false;
          const gl = [...groups];
          let best = null;
          let bestSim = CFG.sameVoice;
          for (let i = 0; i < gl.length; i++) {
            for (let j = i + 1; j < gl.length; j++) {
              const sim = cosine(normalize(gl[i][1].sum), normalize(gl[j][1].sum));
              if (sim >= bestSim) {
                bestSim = sim;
                best = [gl[i], gl[j]];
              }
            }
          }
          if (best) {
            const [[, a], [kb, b]] = best;
            for (let k = 0; k < dim; k++) a.sum[k] += b.sum[k];
            a.w += b.w;
            a.segs.push(...b.segs);
            groups.delete(kb);
            merged = true;
          }
        }
      }

      // Voix finales : identifiants stables, empreinte moyenne (mémoire des voix)
      const itemGroup = new Int32Array(items.length);
      this.centroids = new Map();
      let rank = 0;
      for (const g of groups.values()) {
        const id = 1000 + ++rank;
        for (const si of g.segs) for (const m of segs[si].members) itemGroup[m] = id;
        this.centroids.set(id, { emb: Float32Array.from(normalize(g.sum)), seconds: g.w });
      }
      // Correspondance voix provisoire -> voix regroupée (pour les phrases suivantes, en direct)
      const live = new Map();
      items.forEach((it, idx) => {
        const m = live.get(it.voice) || new Map();
        m.set(itemGroup[idx], (m.get(itemGroup[idx]) || 0) + it.dur);
        live.set(it.voice, m);
      });
      this.liveMap = new Map();
      for (const [v, m] of live) this.liveMap.set(v, [...m].sort((a, b) => b[1] - a[1])[0][0]);
      // Chaque phrase prend la voix finale majoritaire parmi ses fenêtres
      const map = new Map();
      this.covers.forEach((cover, key) => {
        const votes = new Map();
        for (const [idx, o] of cover) votes.set(itemGroup[idx], (votes.get(itemGroup[idx]) || 0) + o);
        let bestG = null;
        let bestO = 0;
        for (const [g, o] of votes) if (o > bestO) { bestO = o; bestG = g; }
        if (bestG != null) map.set(key, bestG);
      });
      return map;
    }
  }

  /**
   * Voix du micro : par construction, une seule personne (vous). Sans casque, le micro réentend
   * aussi les participants dans les haut-parleurs, et cet écho était attribué à « Vous ».
   *
   * Votre empreinte vocale est apprise uniquement sur les phrases du micro prononcées pendant que
   * les participants se taisent : à ce moment-là, ce ne peut être que vous. (Apprendre sur tout le
   * micro ne marche pas : dans un entretien où l'autre parle beaucoup, l'écho est majoritaire et
   * c'est sa voix qui aurait été apprise.) Une phrase du micro prononcée pendant que les
   * participants parlent, et qui n'a pas votre voix, est retirée (Transcript.removeEcho).
   * L'empreinte reste en mémoire le temps de la réunion, elle n'est jamais enregistrée.
   */
  class MicVoice {
    constructor(analyzer) {
      this.analyzer = analyzer;
      this.items = []; // { emb, from, to } en temps réel de la réunion
    }

    /** Une empreinte par phrase (au centre, 3 s au plus), null si la phrase est trop courte. */
    async embed(audio, chunks, block) {
      const total = audio.length / RATE;
      const at = (t) => (block && Lowsper.blockTime ? Lowsper.blockTime(block, t) : t);
      const out = [];
      for (const c of chunks) {
        const from = Math.max(0, c.from || 0);
        const to = Math.min(total, c.to != null ? c.to : total);
        if (to - from < CFG.micMin) {
          out.push(null);
          continue;
        }
        const mid = (from + to) / 2;
        const half = Math.min(1.5, (to - from) / 2);
        const slice = audio.slice(Math.floor((mid - half) * RATE), Math.floor((mid + half) * RATE));
        let emb = null;
        if (hasVoice(slice)) {
          try {
            emb = await this.analyzer.embed(slice);
          } catch (err) {
            console.warn('Empreinte du micro indisponible', err);
          }
        }
        if (emb) this.items.push({ emb, from: at(from), to: at(to) });
        out.push(emb);
      }
      return out;
    }

    /**
     * Votre empreinte, à partir des phrases du micro sans participant qui parle au même moment
     * (busy : intervalles [début, fin] de parole des participants, donnés par la détection de
     * parole, plus précise que les horodatages du texte). Rien sous 10 s de parole.
     */
    centroid(busy) {
      // « Seul au micro » : moins d'un quart de la phrase pendant que les participants parlent
      // (les horodatages de Whisper débordent souvent un peu sur la parole voisine)
      const quiet = this.items.filter((it) => {
        const shared = busy.reduce((n, [a, b]) => n + Math.max(0, Math.min(b, it.to) - Math.max(a, it.from)), 0);
        return shared <= 0.25 * (it.to - it.from);
      });
      const total = quiet.reduce((n, it) => n + (it.to - it.from), 0);
      if (!quiet.length || total < CFG.micLearn) return null;
      const dim = quiet[0].emb.length;
      const sum = new Float64Array(dim);
      for (const it of quiet) for (let k = 0; k < dim; k++) sum[k] += it.emb[k] * (it.to - it.from);
      return normalize(sum);
    }
  }

  /**
   * Mémoire des voix (facultative, désactivée par défaut).
   *
   * Quand l'utilisateur nomme un intervenant, son empreinte vocale moyenne (256 nombres, pas
   * d'audio) est conservée sur ce poste, dans le stockage du navigateur. Aux réunions suivantes,
   * une voix suffisamment proche reçoit automatiquement ce nom.
   *
   * Une empreinte vocale est une donnée biométrique (RGPD, article 9) : consentement des
   * personnes, stockage local uniquement, durée de conservation limitée (effacement automatique)
   * et effacement manuel à tout moment.
   */
  class VoiceMemory {
    constructor(storage) {
      this.storage = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
      this.key = 'lowsper.voices.v1';
      this.data = this.load();
    }

    load() {
      try {
        const raw = this.storage && this.storage.getItem(this.key);
        const d = raw ? JSON.parse(raw) : null;
        if (d && Array.isArray(d.voices)) return d;
      } catch {}
      return { enabled: false, keepDays: 90, voices: [] };
    }

    save() {
      try {
        if (this.storage) this.storage.setItem(this.key, JSON.stringify(this.data));
      } catch {}
    }

    get enabled() {
      return !!this.data.enabled;
    }
    setEnabled(on) {
      this.data.enabled = !!on;
      this.save();
    }
    get keepDays() {
      return this.data.keepDays || 90;
    }
    setKeepDays(days) {
      this.data.keepDays = days;
      this.purge();
    }
    get count() {
      return this.data.voices.length;
    }
    names() {
      return this.data.voices.map((v) => v.name);
    }

    /** Efface les empreintes plus anciennes que la durée de conservation (depuis leur création). */
    purge(now) {
      const limit = (now || Date.now()) - this.keepDays * 86400000;
      this.data.voices = this.data.voices.filter((v) => v.createdAt >= limit);
      this.save();
    }

    clear() {
      this.data.voices = [];
      this.save();
    }

    forget(name) {
      this.data.voices = this.data.voices.filter((v) => v.name !== name);
      this.save();
    }

    /**
     * Associe des voix d'une réunion à des voix mémorisées (une à une, la plus proche d'abord).
     * @param {Map<number,{emb:Float32Array}>} centroids
     * @returns {Map<number,string>} voix de la réunion -> nom
     */
    match(centroids) {
      const pairs = [];
      for (const [voice, c] of centroids) {
        for (const m of this.data.voices) pairs.push({ voice, name: m.name, sim: cosine(c.emb, m.emb) });
      }
      pairs.sort((a, b) => b.sim - a.sim);
      const out = new Map();
      const used = new Set();
      for (const p of pairs) {
        if (p.sim < CFG.remember) break;
        if (out.has(p.voice) || used.has(p.name)) continue;
        out.set(p.voice, p.name);
        used.add(p.name);
      }
      return out;
    }

    /** Ajoute ou affine l'empreinte d'une personne nommée. */
    remember(name, emb, seconds) {
      if (!name || !emb) return;
      const now = Date.now();
      const v = this.data.voices.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (v) {
        const w1 = Math.min(v.seconds, 600);
        const w2 = Math.min(seconds, 600);
        v.emb = normalize(v.emb.map((x, i) => x * w1 + emb[i] * w2));
        v.seconds = w1 + w2;
        v.updatedAt = now;
      } else {
        this.data.voices.push({ name, emb: Array.from(emb), seconds, createdAt: now, updatedAt: now });
      }
      this.save();
    }
  }

  Lowsper.SpeakerTracker = SpeakerTracker;
  Lowsper.MicVoice = MicVoice;
  Lowsper.SPEAKER_CFG = CFG;
  Lowsper.VoiceMemory = VoiceMemory;
  Lowsper.SPEAKER_CONFIG = CFG;
})();
