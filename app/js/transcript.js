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

    /**
     * Ajoute le résultat du moteur pour un bloc audio.
     * voices : identifiant de voix par phrase (source « Participants »), voir speakers.js
     */
    addSegment(source, seg, result, voices) {
      const chunks = result.chunks && result.chunks.length
        ? result.chunks
        : [{ from: 0, to: null, text: result.text }];
      chunks.forEach((c, i) => {
        const text = fixCase(fixAcronyms(collapseRepeats(String(c.text || '').trim()), this.meta.glossary), this.meta.glossary);
        if (!text || isHallucination(text, seg.speech)) return;
        const at = (t) => (Lowsper.blockTime ? Lowsper.blockTime(seg, t) : seg.start + t);
        const start = at(c.from || 0);
        const end = c.to != null ? at(c.to) : seg.end;
        const line = { source, start, end: Math.max(end, start), text };
        if (voices && voices[i] != null) {
          line.voice = voices[i].voice;
          line.vkey = voices[i].key;
        }
        this.lines.push(line);
      });
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
      const clean = String(name || '').replace(/[*_\[\]`]/g, '').trim().slice(0, 60);
      if (clean) this.meta.names[voice] = clean;
      else delete this.meta.names[voice];
      this.save();
    }

    /** Applique le regroupement final des voix (clé de phrase -> voix finale). */
    applyVoiceMap(map) {
      for (const l of this.lines) if (l.vkey != null && map.has(l.vkey)) l.voice = map.get(l.vkey);
      this.emit();
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
        } else {
          items.push({ source: l.source, voice: l.voice, start: l.start, end: l.end, text: l.text });
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
      events.sort((a, b) => a.t - b.t);

      if (!events.length) out.push('_Aucune parole détectée._');
      for (const e of events) {
        if (e.pause) {
          out.push(`_[${fmt(e.pause.from)} à ${fmt(e.pause.to)}] Enregistrement en pause._`);
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
  Lowsper.fixCase = fixCase;
  Lowsper.formatTime = fmt;
  Lowsper.SPEAKERS = SPEAKERS;
})();
