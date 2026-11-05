/*
 * Lowsper : assemblage du transcript.
 *
 * - Reçoit les phrases horodatées produites par le moteur pour chaque source.
 * - Filtre les hallucinations connues de Whisper et les répétitions.
 * - Supprime l'écho : sans casque, le micro réentend les participants ; si une phrase
 *   du micro ressemble fortement à une phrase des participants au même moment,
 *   elle est retirée.
 * - Produit le Markdown final et sauvegarde la session au fil de l'eau (localStorage)
 *   pour pouvoir la récupérer si le navigateur se ferme pendant la réunion.
 */
(function () {
  'use strict';

  const Lowsper = (window.Lowsper = window.Lowsper || {});
  const STORAGE_KEY = 'lowsper.session.v1';

  const SPEAKERS = {
    me: 'Vous',
    others: 'Participants',
  };

  // Phrases que Whisper invente sur du silence ou de la musique (issues de ses données
  // d'entraînement : sous-titres de vidéos). Comparaison sur le texte normalisé.
  const HALLUCINATIONS = [
    /sous[- ]?titr\w* (realise|fait|par)/,
    /amara\.?org/,
    /sous[- ]?titrage (st|societe|radio)/,
    /merci d'avoir regarde/,
    /abonnez[- ]vous/,
    /n'oubliez pas de (vous abonner|liker|like)/,
    /thanks? (you )?for watching/,
    /please subscribe/,
    /subtitles? by/,
    /^(\.|,|!|\?|…|\s)*$/,
    /^(musique|music|applaudissements|rires|silence)$/,
  ];
  // Mots courants souvent écrits avec une majuscule après une virgule (pas des noms propres)
  const COMMON = new Set(
    "donc c'est et mais alors voilà oui non ok okay bon bah ben ah oh après moi toi lui je tu il elle on nous vous ils elles ça ca pour parce enfin puis ensuite sinon bref quand comme est-ce est d'accord merci bonjour salut exactement effectivement tout tous très".split(' ')
  );
  const HALLUCINATION_ONLY = [/^merci\.?$/, /^thank you\.?$/, /^bye\.?$/, /^au revoir\.?$/];

  function normalizeText(t) {
    return t
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[’`]/g, "'")
      .replace(/[[\]()*]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function words(t) {
    return normalizeText(t)
      .replace(/[^a-z0-9' ]/g, ' ')
      .split(' ')
      .filter((w) => w.length > 1);
  }

  // Hésitations seules (« Euh... », « Hum. ») : aucune information pour le compte rendu.
  const FILLER_ONLY = /^(?:(?:euh|heu|hum|hmm|mmh?|bah|ben|ah|oh)[\s.,!?…]*)+$/;

  // Retire les groupes de mots répétés à la suite : 3 fois ou plus (« qu'on a aussi l'autonomie,
  // qu'on a aussi l'autonomie, qu'on a aussi l'autonomie »), ou 2 fois pour un groupe d'au moins
  // 6 mots. Une répétition naturelle courte (« il y a combien, il y a combien de temps ») reste.
  function collapsePhrases(text) {
    const tokens = text.split(/\s+/).filter(Boolean);
    const key = tokens.map((w) => normalizeText(w).replace(/[^\p{L}\p{N}']/gu, ''));
    const out = [];
    for (let i = 0; i < tokens.length; ) {
      let skipped = false;
      for (let n = Math.min(12, Math.floor((tokens.length - i) / 2)); n >= 3; n--) {
        let reps = 1;
        while (i + (reps + 1) * n <= tokens.length) {
          let same = true;
          for (let j = 0; j < n && same; j++) same = key[i + j] && key[i + j] === key[i + reps * n + j];
          if (!same) break;
          reps++;
        }
        if (reps >= 3 || (reps >= 2 && n >= 6)) {
          for (let j = 0; j < n; j++) out.push(tokens[i + j]);
          // garde la ponctuation finale de la dernière copie (« ... l'autonomie. »)
          const lastWord = tokens[i + reps * n - 1];
          const end = (lastWord.match(/[.!?…]+$/) || [''])[0];
          if (end) out[out.length - 1] = out[out.length - 1].replace(/[.,;:!?…]+$/, '') + end;
          i += reps * n;
          skipped = true;
          break;
        }
      }
      if (!skipped) out.push(tokens[i++]);
    }
    return out.join(' ');
  }

  // Fin de passage qui part en boucle avec des variantes (« pas de répit, pas de vie, pas de
  // vies, pas de balafre, pas de vrais... ») : un même couple de mots revient au moins 5 fois à
  // intervalles très courts. On garde le texte jusqu'à la première occurrence comprise.
  function cutLoopTail(text) {
    const tokens = text.split(/\s+/).filter(Boolean);
    const key = tokens.map((w) => normalizeText(w).replace(/[^\p{L}\p{N}']/gu, ''));
    for (let i = 0; i + 1 < tokens.length; i++) {
      if (!key[i] || !key[i + 1]) continue;
      const pos = [i];
      for (let j = i + 2; j + 1 < tokens.length && j - pos[pos.length - 1] <= 5; j++) {
        if (key[j] === key[i] && key[j + 1] === key[i + 1]) pos.push(j);
      }
      if (pos.length >= 5) {
        const kept = tokens.slice(0, pos[1]).join(' ').replace(/[,;:]+$/, '');
        return /[.!?…]$/.test(kept) ? kept : kept + '…';
      }
    }
    return text;
  }

  // Supprime les boucles du type « oui oui oui oui oui » ou une phrase répétée 5 fois,
  // et les lettres étirées (« Heuuuuuuuuuu »).
  function collapseRepeats(text) {
    let t = text.replace(/(\p{L})\1{3,}/gu, '$1').replace(/\b(\w+)(?:[\s,]+\1\b){3,}/gi, '$1');
    t = cutLoopTail(collapsePhrases(t));
    const sentences = t.split(/(?<=[.!?])\s+/);
    const out = [];
    for (const s of sentences) {
      const n = normalizeText(s);
      const prev = out.length ? normalizeText(out[out.length - 1]) : null;
      const prev2 = out.length > 1 ? normalizeText(out[out.length - 2]) : null;
      if (n && (n === prev || n === prev2)) continue;
      out.push(s);
    }
    return out.join(' ').trim();
  }

  /**
   * Recolle les sigles du glossaire que Whisper a écrits lettre par lettre ou en morceaux :
   * « V P N », « VP n », « R.O.I. » -> « VPN », « ROI ». Correction sûre : elle ne s'applique
   * que si les lettres recollées forment exactement un sigle du glossaire.
   */
  function fixAcronyms(text, glossary) {
    const acronyms = new Map();
    for (const raw of String(glossary || '').split(/[,;\n]+/)) {
      const term = raw.trim();
      const key = term.replace(/[\s.-]/g, '').toUpperCase();
      if (/^[A-Z0-9]{2,8}$/.test(key) && term === term.toUpperCase()) acronyms.set(key, term);
    }
    if (!acronyms.size) return text;
    // Morceaux : mots courts (1 à 3 caractères) séparés par espaces, points ou tirets.
    const parts = text.split(/(\s+)/);
    const out = [];
    for (let i = 0; i < parts.length; ) {
      let done = false;
      // Cherche la plus longue suite de 2 à 6 morceaux qui forme un sigle du glossaire
      for (let n = 6; n >= 1 && !done; n--) {
        const words = [];
        for (let k = 0; k < n * 2 - 1 && i + k < parts.length; k += 2) words.push(parts[i + k]);
        if (words.length !== n) continue;
        const cores = words.map((w) => w.replace(/[.\-,;:!?]+$/, ''));
        const pieces = cores.flatMap((w) => w.split(/[.-]/)).filter(Boolean);
        if (pieces.length < 2 || pieces.some((p) => p.length > 3 || !/^[A-Za-z0-9]+$/.test(p))) continue;
        const key = pieces.join('').toUpperCase();
        if (!acronyms.has(key)) continue;
        const letters = pieces.join('').replace(/[^A-Za-z]/g, '');
        const upper = letters.replace(/[^A-Z]/g, '').length;
        if (letters.length && upper / letters.length < 0.5) continue; // évite « le p a »
        const last = words[words.length - 1];
        // Conserve la ponctuation finale (« R.O.I. » en fin de phrase -> « ROI. »)
        out.push(acronyms.get(key) + (last.match(/[.,;:!?]+$/) || [''])[0]);
        i += n * 2 - 1;
        done = true;
      }
      if (!done) {
        out.push(parts[i]);
        i++;
      }
    }
    return out.join('');
  }

  /**
   * Réécrit les termes du glossaire reconnus avec une autre casse ou sans accent :
   * « copil » -> « COPIL », « servicenow » -> « ServiceNow », « elodie » -> « Élodie ».
   * Mot entier uniquement, termes de 3 lettres ou plus.
   */
  function fixCase(text, glossary) {
    const terms = String(glossary || '')
      .split(/[,;\n]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3);
    if (!terms.length) return text;
    const fold = (x) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    let out = text.normalize('NFC');
    if (fold(out).length !== out.length) return text; // caractères exotiques : on ne touche à rien
    for (const term of terms) {
      const pattern = fold(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      const re = new RegExp('(^|[^\\p{L}\\p{N}])(' + pattern + ')(?=$|[^\\p{L}\\p{N}])', 'giu');
      const folded = fold(out);
      // fold() conserve les longueurs (une lettre accentuée = une lettre), on remplace par positions
      let result = '';
      let last = 0;
      for (const m of folded.matchAll(re)) {
        const start = m.index + m[1].length;
        result += out.slice(last, start) + term;
        last = start + m[2].length;
      }
      out = result + out.slice(last);
    }
    return out;
  }

  function isHallucination(text, segSpeech, glossary) {
    const n = normalizeText(text);
    if (!n) return true;
    if (HALLUCINATIONS.some((re) => re.test(n))) return true;
    if (FILLER_ONLY.test(n)) return true;
    // Whisper récite parfois son contexte (la liste du glossaire) sur un passage peu audible
    if (glossary) {
      const w = words(text);
      const g = new Set(words(glossary));
      if (w.length >= 4 && w.filter((x) => g.has(x)).length / w.length >= 0.8) return true;
    }
    // « Merci. » isolé sur un segment avec très peu de parole : très probablement inventé
    if (segSpeech < 1.2 && HALLUCINATION_ONLY.some((re) => re.test(n))) return true;
    return false;
  }

  // Similarité entre deux phrases : part des mots de a présents dans b.
  function overlap(a, b) {
    const wa = words(a);
    if (wa.length < 3) return 0;
    const sb = new Set(words(b));
    let hit = 0;
    for (const w of wa) if (sb.has(w)) hit++;
    return hit / wa.length;
  }

  class Transcript {
    constructor(meta) {
      this.meta = Object.assign(
        {
          title: '',
          startedAt: Date.now(),
          endedAt: null,
          language: 'fr',
          model: '',
          sources: [],
          pauses: [],
        },
        meta || {}
      );
      this.lines = []; // { source, start, end, text }
      this.listeners = new Set();
    }

    onChange(fn) {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    }

    emit() {
      this.save();
      for (const fn of this.listeners) fn(this);
    }

    /**
     * Ajoute le résultat du moteur pour un bloc audio.
     * voices : identifiant de voix par phrase (source « Participants »), voir speakers.js
     */
    addSegment(source, seg, result, voices, opts) {
      const chunks = result.chunks && result.chunks.length
        ? result.chunks
        : [{ from: 0, to: null, text: result.text }];
      chunks.forEach((c, i) => {
        const glossary = this.fullGlossary();
        const raw = collapseRepeats(String(c.text || '').trim());
        const fixed = Lowsper.Vocabulary ? Lowsper.Vocabulary.fix(raw, this.meta.vocab, this.meta.fixes) : raw;
        const text = fixCase(fixAcronyms(fixed, glossary), glossary);
        if (!text || isHallucination(text, seg.speech, glossary)) return;
        // Whisper qui récite le nom de la réunion (donné en contexte)
        if (this.meta.title && normalizeText(text).replace(/[.!?…]+$/, '') === normalizeText(this.meta.title)) return;
        const at = (t) => (Lowsper.blockTime ? Lowsper.blockTime(seg, t) : seg.start + t);
        const start = at(c.from || 0);
        const end = c.to != null ? at(c.to) : seg.end;
        const line = { source, start, end: Math.max(end, start), text };
        if (voices && voices[i] != null) {
          line.voice = voices[i].voice;
          line.vkey = voices[i].key;
        }
        if (opts && opts.block != null) line.block = opts.block;
        if (opts && opts.draft) line.draft = true;
        // Empreinte vocale de la phrase du micro : en mémoire seulement (non enregistrée)
        if (opts && opts.embs && opts.embs[i]) Object.defineProperty(line, 'emb', { value: opts.embs[i], enumerable: false });
        this.lines.push(line);
      });
      this.lines.sort((a, b) => a.start - b.start);
      this.removeEcho();
      this.emit();
    }

    // --- Couverture : part de la parole détectée qui a bien été transcrite ---

    coverage() {
      this.meta.coverage = this.meta.coverage || {};
      return this.meta.coverage;
    }

    /** Un passage de parole part vers le moteur. */
    markQueued(source, seg) {
      const c = this.coverage();
      c[source] = c[source] || { speech: 0, done: 0 };
      c[source].speech += seg.speech || seg.end - seg.start;
    }

    /** Le passage est transcrit (ou relancé avec succès : son éventuel trou disparaît). */
    markDone(source, seg) {
      const c = this.coverage();
      c[source] = c[source] || { speech: 0, done: 0 };
      c[source].done += seg.speech || seg.end - seg.start;
      if (this.meta.gaps) this.meta.gaps = this.meta.gaps.filter((g) => !(g.source === source && g.start === seg.start));
      this.save();
    }

    /** Passage impossible à transcrire malgré les relances : signalé dans le transcript. */
    markGap(source, seg) {
      this.meta.gaps = this.meta.gaps || [];
      this.meta.gaps.push({ source, start: seg.start, end: seg.end, speech: seg.speech || seg.end - seg.start });
      this.emit();
    }

    /** Part de la parole transcrite (1 = tout), et secondes de parole manquantes. */
    coverageSummary() {
      let speech = 0;
      let done = 0;
      for (const c of Object.values(this.coverage())) {
        speech += c.speech;
        done += Math.min(c.done, c.speech);
      }
      return { ratio: speech ? done / speech : 1, missing: Math.max(0, speech - done), speech };
    }

    /** Remplace un mot mal reconnu dans tout le transcript. Retourne le nombre de remplacements. */
    replaceEverywhere(wrong, right) {
      if (!Lowsper.Vocabulary || !String(wrong).trim()) return 0;
      let n = 0;
      for (const l of this.lines) {
        const r = Lowsper.Vocabulary.replaceWord(l.text, wrong, right);
        if (r.count) {
          l.text = r.text;
          n += r.count;
        }
      }
      if (n) this.emit();
      return n;
    }

    /**
     * Mots à vérifier : noms propres probables (majuscule en milieu de phrase) absents du
     * glossaire. Ce sont eux que Whisper déforme le plus (« Trivelle », « Kalmar »...).
     */
    suspectWords(max = 12) {
      const known = new Set(
        this.fullGlossary().split(/[,;\n]+/).flatMap((t) => t.trim().toLowerCase().split(/\s+/)).filter(Boolean)
      );
      const count = new Map();
      for (const l of this.lines) {
        const words = l.text.split(/\s+/);
        for (let i = 1; i < words.length; i++) {
          if (/[.!?…:]$/.test(words[i - 1])) continue; // début de phrase
          const w = words[i].replace(/^[«"'(]+|[»"'),.;:!?…]+$/g, '');
          if (!/^\p{Lu}[\p{L}\p{N}'-]{2,}$/u.test(w) || /^\p{Lu}+$/u.test(w) && w.length <= 3) continue;
          if (known.has(w.toLowerCase()) || COMMON.has(w.toLowerCase())) continue;
          count.set(w, (count.get(w) || 0) + 1);
        }
      }
      // Les déformations sont rares (1 à 3 fois) ; un nom bien reconnu revient souvent
      return [...count].sort((a, b) => a[1] - b[1]).slice(0, max).map(([w]) => w);
    }

    /** Glossaire personnel complété par les vocabulaires métier cochés. */
    fullGlossary() {
      const m = this.meta;
      if (!Lowsper.Vocabulary || !m.vocab || !m.vocab.length) return m.glossary || '';
      if (!this._glossary || this._glossary.key !== m.glossary + '|' + m.vocab) {
        this._glossary = { key: m.glossary + '|' + m.vocab, text: Lowsper.Vocabulary.merge(m.glossary, m.vocab) };
      }
      return this._glossary.text;
    }

    /**
     * Fin du texte déjà transcrit pour une source, juste avant un instant : donnée à Whisper
     * comme contexte du passage suivant (continuité des noms propres et des phrases coupées).
     */
    contextFor(source, before, maxWords = 30) {
      const parts = [];
      let n = 0;
      for (let i = this.lines.length - 1; i >= 0 && n < maxWords; i--) {
        const l = this.lines[i];
        if (l.source !== source || l.draft || l.start > before) continue;
        if (before - l.end > 60) break;
        parts.unshift(l.text);
        n += l.text.split(/\s+/).length;
      }
      const w = parts.join(' ').split(/\s+/).filter(Boolean);
      return w.slice(-maxWords).join(' ');
    }

    /**
     * Retire les phrases du micro qui sont l'écho des participants
     * (même contenu, à quelques secondes près).
     */
    removeEcho() {
      const others = this.lines.filter((l) => l.source === 'others');
      if (!others.length) return;
      this.lines = this.lines.filter((l) => {
        if (l.source !== 'me') return true;
        for (const o of others) {
          if (o.end < l.start - 6 || o.start > l.end + 6) continue;
          if (overlap(l.text, o.text) >= 0.6) return false;
        }
        return true;
      });
    }

    /**
     * Écho reconnu à la voix (fin de réunion, quand tout est transcrit) : le micro n'entend
     * qu'une personne, vous. Votre empreinte est apprise sur les phrases du micro dites pendant
     * que les participants se taisent (speakers.js, MicVoice) ; une phrase du micro dite pendant
     * que les participants parlent, et qui n'a pas votre voix, est l'écho des haut-parleurs.
     * Fait une seule fois à la fin : en cours de réunion, les phrases des participants ne sont
     * pas toutes transcrites et l'empreinte pourrait être faussée.
     * @returns {number} nombre de phrases retirées
     */
    removeVoiceEcho(micVoice, busy) {
      const others = this.lines.filter((l) => l.source === 'others');
      if (!micVoice || !others.length) return 0;
      // Parole des participants : détection de parole si connue, sinon horodatage des phrases
      busy = busy && busy.length ? busy : others.map((o) => [o.start, o.end]);
      const me = micVoice.centroid(busy);
      if (!me) return 0;
      const limit = (Lowsper.SPEAKER_CFG && Lowsper.SPEAKER_CFG.micForeign) || 0.4;
      const before = this.lines.length;
      this.lines = this.lines.filter((l) => {
        if (l.source !== 'me' || !l.emb) return true;
        const dur = l.end - l.start;
        const shared = busy.reduce((n, [a, b]) => n + Math.max(0, Math.min(b, l.end) - Math.max(a, l.start)), 0);
        if (shared < Math.min(0.5, dur / 3)) return true; // participants silencieux : c'est vous
        // Phrase mêlant écho et réponse (Whisper ne les sépare pas toujours) : si plus d'1,2 s
        // tombe hors de la parole des participants, elle contient sans doute votre voix. On garde.
        if (dur - shared >= 1.2) return true;
        let sim = 0;
        for (let k = 0; k < me.length; k++) sim += me[k] * l.emb[k];
        return sim >= limit;
      });
      const removed = before - this.lines.length;
      if (removed) this.emit();
      return removed;
    }

    /**
     * Remplace le texte d'un bloc (retranscription d'un passage « rapide » avec le bon modèle).
     * Chaque nouvelle phrase reprend la voix de l'ancienne phrase qu'elle recouvre le plus.
     */
    replaceBlock(source, seg, result) {
      const old = this.lines.filter((l) => l.block === seg.id && l.source === source);
      this.lines = this.lines.filter((l) => !(l.block === seg.id && l.source === source));
      this.addSegment(source, seg, result, null, { block: seg.id });
      for (const l of this.lines.filter((x) => x.block === seg.id && x.source === source)) {
        let best = null;
        let bestO = 0;
        for (const o of old) {
          const ov = Math.min(l.end, o.end) - Math.max(l.start, o.start);
          if (ov > bestO) {
            bestO = ov;
            best = o;
          }
        }
        if (!best && old.length) best = old[0];
        if (best && best.voice != null) {
          l.voice = best.voice;
          l.vkey = best.vkey;
        }
      }
      this.emit();
    }

    draftCount() {
      return new Set(this.lines.filter((l) => l.draft).map((l) => l.block)).size;
    }

    hasVoices() {
      return this.lines.some((l) => l.voice != null);
    }

    /** Nom affiché : « Vous », « Intervenant n » (ordre d'apparition) ou « Participant(s) ». */
    speakerName(item) {
      if (item.source !== 'others') return SPEAKERS[item.source] || item.source;
      if (item.voice == null) return this.hasVoices() ? 'Participant' : SPEAKERS.others;
      const named = this.meta.names && this.meta.names[item.voice];
      if (named) return named;
      return 'Intervenant ' + (this.voiceOrder().indexOf(item.voice) + 1);
    }

    /** Voix dans leur ordre d'apparition. */
    voiceOrder() {
      const order = [];
      for (const l of this.lines) if (l.voice != null && !order.includes(l.voice)) order.push(l.voice);
      return order;
    }

    /** Résumé des voix pour l'écran de fin : numéro, temps de parole, première phrase. */
    voiceSummary() {
      return this.voiceOrder().map((voice, i) => {
        const lines = this.lines.filter((l) => l.voice === voice);
        const seconds = lines.reduce((n, l) => n + Math.max(0, l.end - l.start), 0);
        const sample = lines.find((l) => l.text.split(' ').length >= 5) || lines[0];
        return { voice, label: 'Intervenant ' + (i + 1), seconds, sample: sample ? sample.text : '', at: lines[0].start };
      });
    }

    /** Nomme une voix (« Intervenant 3 » -> « Julien »). Nom vide = retour au numéro. */
    nameVoice(voice, name) {
      this.meta.names = this.meta.names || {};
      const clean = String(name || '').replace(/[*_[\]`]/g, '').trim().slice(0, 60);
      if (clean) this.meta.names[voice] = clean;
      else delete this.meta.names[voice];
      this.save();
    }

    /** Applique le regroupement final des voix (clé de phrase -> voix finale). */
    applyVoiceMap(map) {
      for (const l of this.lines) if (l.vkey != null && map.has(l.vkey)) l.voice = map.get(l.vkey);
      this.smoothVoices();
      this.emit();
    }

    /**
     * Lissage : un fragment très court (moins de 2 s) collé entre deux phrases d'une même voix,
     * sans vraie pause, appartient presque toujours à cette voix (fin de phrase, « voilà »).
     * Évite qu'une phrase coupée en deux change d'intervenant en plein milieu.
     */
    smoothVoices() {
      const o = this.lines.filter((l) => l.source === 'others' && l.voice != null);
      for (let i = 1; i + 1 < o.length; i++) {
        const [a, l, b] = [o[i - 1], o[i], o[i + 1]];
        if (l.voice === a.voice || a.voice !== b.voice) continue;
        if (l.end - l.start < 2 && l.start - a.end < 0.8 && b.start - l.end < 0.8) l.voice = a.voice;
      }
    }

    addPause(from, to) {
      this.meta.pauses.push({ from, to });
      this.emit();
    }

    /** Regroupe les phrases consécutives d'un même locuteur en paragraphes. */
    paragraphs() {
      const items = [];
      for (const l of this.lines) {
        const last = items[items.length - 1];
        if (
          last &&
          last.source === l.source &&
          last.voice === l.voice &&
          l.start - last.end < 4 &&
          l.end - last.start < 90
        ) {
          last.text += ' ' + l.text;
          last.end = Math.max(last.end, l.end);
          if (l.draft) last.draft = true;
        } else {
          items.push({ source: l.source, voice: l.voice, start: l.start, end: l.end, text: l.text, draft: !!l.draft });
        }
      }
      return items;
    }

    toMarkdown() {
      const m = this.meta;
      const start = new Date(m.startedAt);
      const end = m.endedAt ? new Date(m.endedAt) : new Date();
      const durationMin = Math.max(1, Math.round((end - start) / 60000));
      const date = start.toLocaleDateString('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      const hm = (d) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const langs = { fr: 'français', en: 'anglais', auto: 'français et anglais (détection automatique)' };
      const sources = m.sources
        .map((s) => (s === 'me' ? 'micro (« Vous »)' : 'audio partagé (« Participants »)'))
        .join(', ');

      const out = [];
      out.push(`# Transcript de réunion${m.title ? ' : ' + m.title : ''}`);
      out.push('');
      out.push(`- **Date** : ${date}`);
      out.push(`- **Horaires** : ${hm(start)} à ${hm(end)} (${durationMin} min)`);
      out.push(`- **Sources** : ${sources || 'aucune'}`);
      if (m.people) out.push(`- **Participants** : ${m.people} personnes (vous compris)`);
      out.push(`- **Langue** : ${langs[m.language] || m.language}`);
      out.push(`- **Transcription** : ${m.model || 'Whisper'}, exécuté localement par Lowsper (hors ligne)`);
      const cov = this.coverageSummary();
      if (cov.speech > 0) {
        out.push(
          cov.missing < 1
            ? '- **Couverture** : toute la parole détectée a été transcrite'
            : `- **Couverture** : ${Math.round(cov.ratio * 100)} % de la parole détectée transcrite ; ${fmtDur(cov.missing)} de parole n'ont pas pu l'être (passages signalés ci-dessous)`
        );
      }
      if (m.recovered >= 1) out.push(`- **Rattrapage** : ${fmtDur(m.recovered)} de parole manquée en direct, retrouvée et transcrite en fin de réunion`);
      if (m.glossary) out.push(`- **Vocabulaire de référence** (sigles et noms propres attendus) : ${m.glossary.replace(/\s+/g, ' ')}`);
      const vocab = (m.vocab || []).map((id) => Lowsper.Vocabulary && Lowsper.Vocabulary.PRESETS[id] && Lowsper.Vocabulary.PRESETS[id].label).filter(Boolean);
      if (vocab.length) out.push(`- **Domaine** : ${vocab.join(', ').toLowerCase()}`);
      out.push('');
      out.push(
        '> Transcription automatique : elle peut contenir des erreurs de reconnaissance. ' +
          '« Vous » désigne la personne qui enregistre (micro). ' +
          (this.hasVoices()
            ? "Les autres intervenants sont les voix distinctes détectées automatiquement dans l'audio de la réunion " +
              (this.meta.names && Object.keys(this.meta.names).length
                ? '(certaines nommées à la main après la réunion, les autres numérotées « Intervenant n ») : '
                : '(« Intervenant 1, 2... », noms réels inconnus, ils peuvent souvent se déduire des échanges) : ') +
              'deux personnes à la voix proche peuvent partager un numéro, et une même personne peut en recevoir deux. ' +
              "Les phrases trop courtes pour identifier la voix sont notées « Participant ». "
            : "« Participants » regroupe toutes les autres voix entendues via l'audio de la réunion, sans distinction de personne. ") +
          'Les horodatages [hh:mm:ss] sont relatifs au début de l’enregistrement.'
      );
      out.push('');
      out.push('## Transcript');
      out.push('');

      const events = this.paragraphs().map((p) => ({ t: p.start, p }));
      for (const pause of m.pauses) events.push({ t: pause.from, pause });
      for (const gap of m.gaps || []) events.push({ t: gap.start, gap });
      events.sort((a, b) => a.t - b.t);

      if (!events.length) out.push('_Aucune parole détectée._');
      for (const e of events) {
        if (e.pause) {
          out.push(`_[${fmt(e.pause.from)} à ${fmt(e.pause.to)}] Enregistrement en pause._`);
        } else if (e.gap) {
          out.push(`_[${fmt(e.gap.start)} à ${fmt(e.gap.end)}] Passage non transcrit (${SPEAKERS[e.gap.source] || e.gap.source}) : le moteur a échoué sur ce passage._`);
        } else {
          out.push(`**[${fmt(e.p.start)}] ${this.speakerName(e.p)} :** ${e.p.text}`);
        }
        out.push('');
      }
      return out.join('\n').trim() + '\n';
    }

    fileName() {
      const d = new Date(this.meta.startedAt);
      const pad = (n) => String(n).padStart(2, '0');
      const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}h${pad(d.getMinutes())}`;
      const slug = normalizeText(this.meta.title || '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 50);
      return `reunion_${stamp}${slug ? '_' + slug : ''}.md`;
    }

    // --- Sauvegarde locale (survit à un plantage ou une fermeture accidentelle) ---

    save() {
      // Deux réunions enchaînées : seule la réunion en cours est gardée pour la récupération
      if (Transcript.current && Transcript.current !== this) return;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ meta: this.meta, lines: this.lines }));
      } catch {}
    }

    static clearSaved() {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
    }

    /** Session non terminée (endedAt vide) trouvée au démarrage, sinon null. */
    static loadUnfinished() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data || !data.meta || data.meta.endedAt || !data.lines || !data.lines.length) return null;
        const t = new Transcript(data.meta);
        t.lines = data.lines;
        return t;
      } catch {
        return null;
      }
    }
  }

  function fmtDur(sec) {
    return sec < 90 ? `${Math.round(sec)} s` : `${Math.round(sec / 60)} min`;
  }

  function fmt(sec) {
    const s = Math.max(0, Math.floor(sec));
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  }

  Lowsper.Transcript = Transcript;
  Lowsper.fixAcronyms = fixAcronyms;
  Lowsper.fixCase = fixCase;
  Lowsper.collapseRepeats = collapseRepeats;
  Lowsper.isHallucination = isHallucination;
  Lowsper.formatTime = fmt;
  Lowsper.SPEAKERS = SPEAKERS;
})();
