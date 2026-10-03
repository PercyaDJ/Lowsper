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
  const HALLUCINATION_ONLY = [/^merci\.?$/, /^thank you\.?$/, /^bye\.?$/, /^au revoir\.?$/];

  function normalizeText(t) {
    return t
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[’`]/g, "'")
      .replace(/[\[\]()*]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function words(t) {
    return normalizeText(t)
      .replace(/[^a-z0-9' ]/g, ' ')
      .split(' ')
      .filter((w) => w.length > 1);
  }

  // Supprime les boucles du type « oui oui oui oui oui » ou une phrase répétée 5 fois.
  function collapseRepeats(text) {
    let t = text.replace(/\b(\w+)(?:[\s,]+\1\b){3,}/gi, '$1');
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
      const key = term.replace(/[\s.\-]/g, '').toUpperCase();
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
        const pieces = cores.flatMap((w) => w.split(/[.\-]/)).filter(Boolean);
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

  function isHallucination(text, segSpeech) {
    const n = normalizeText(text);
    if (!n) return true;
    if (HALLUCINATIONS.some((re) => re.test(n))) return true;
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

    /** Ajoute le résultat du moteur pour un segment audio. */
    addSegment(source, seg, result) {
      const chunks = result.chunks && result.chunks.length
        ? result.chunks
        : [{ from: 0, to: null, text: result.text }];
      for (const c of chunks) {
        const text = fixAcronyms(collapseRepeats(String(c.text || '').trim()), this.meta.glossary);
        if (!text || isHallucination(text, seg.speech)) continue;
        const at = (t) => (Lowsper.blockTime ? Lowsper.blockTime(seg, t) : seg.start + t);
        const start = at(c.from || 0);
        const end = c.to != null ? at(c.to) : seg.end;
        this.lines.push({ source, start, end: Math.max(end, start), text });
      }
      this.lines.sort((a, b) => a.start - b.start);
      this.removeEcho();
      this.emit();
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
          l.start - last.end < 4 &&
          l.end - last.start < 90
        ) {
          last.text += ' ' + l.text;
          last.end = Math.max(last.end, l.end);
        } else {
          items.push({ source: l.source, start: l.start, end: l.end, text: l.text });
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
      out.push(`- **Langue** : ${langs[m.language] || m.language}`);
      out.push(`- **Transcription** : ${m.model || 'Whisper'}, exécuté localement par Lowsper (hors ligne)`);
      if (m.glossary) out.push(`- **Vocabulaire de référence** (sigles et noms propres attendus) : ${m.glossary.replace(/\s+/g, ' ')}`);
      out.push('');
      out.push(
        '> Transcription automatique : elle peut contenir des erreurs de reconnaissance. ' +
          '« Vous » désigne la personne qui enregistre (micro). « Participants » regroupe ' +
          "toutes les autres voix entendues via l'audio de la réunion, sans distinction de personne. " +
          'Les horodatages [hh:mm:ss] sont relatifs au début de l’enregistrement.'
      );
      out.push('');
      out.push('## Transcript');
      out.push('');

      const events = this.paragraphs().map((p) => ({ t: p.start, p }));
      for (const pause of m.pauses) events.push({ t: pause.from, pause });
      events.sort((a, b) => a.t - b.t);

      if (!events.length) out.push('_Aucune parole détectée._');
      for (const e of events) {
        if (e.pause) {
          out.push(`_[${fmt(e.pause.from)} à ${fmt(e.pause.to)}] Enregistrement en pause._`);
        } else {
          out.push(`**[${fmt(e.p.start)}] ${SPEAKERS[e.p.source] || e.p.source} :** ${e.p.text}`);
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

  function fmt(sec) {
    const s = Math.max(0, Math.floor(sec));
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  }

  Lowsper.Transcript = Transcript;
  Lowsper.fixAcronyms = fixAcronyms;
  Lowsper.formatTime = fmt;
  Lowsper.SPEAKERS = SPEAKERS;
})();
