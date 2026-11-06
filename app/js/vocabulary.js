/*
 * Lowsper : vocabulaire métier intégré et contexte donné à Whisper.
 *
 * Whisper reconnaît mal les sigles et les noms propres qu'il ne connaît pas (« l'NSI » pour
 * « l'ANSSI », « BIOCRM » pour « EBIOS RM », « carpéro hosting » pour « Kerberoasting »...).
 * Le remède le plus efficace est de lui donner, avant chaque passage, un « contexte » où ces
 * termes sont bien écrits : il en imite l'orthographe. Ce contexte réunit :
 *   1. le nom de la réunion (« Entretien Ombrelune » : le nom propre est alors bien écrit) ;
 *   2. les vocabulaires métier cochés dans les paramètres (listes dans vocabularies.js, par
 *      langue parlée) ;
 *   3. le glossaire personnel de l'utilisateur (prioritaire) ;
 *   4. éventuellement la fin du passage précédent de la même source (voir decision.md).
 *
 * Chaque vocabulaire porte aussi quelques corrections de déformations réellement observées
 * dans des transcripts (jamais de devinette : uniquement des formes sans autre sens possible
 * dans une réunion de ce domaine).
 */
(function () {
  'use strict';

  const Lowsper = (window.Lowsper = window.Lowsper || {});

  // Corrections de déformations réellement observées, par vocabulaire et par langue parlée
  const FIXES = {
    cyber: {
      fr: [
        [/\b([Ll]['’]\s?)(?:NSI|NCI|ANSI|ANC|ANSII)\b/g, '$1ANSSI'],
        [/\b(?:NTRM|NTM|NTLN)\b/g, 'NTLM'],
        [/\b(?:E?BIO[CS]{1,2}[\s-]?RM|EBIOS-RM|EBIOSRM)\b/gi, 'EBIOS RM'],
        [/\bWann?a[\s-]?(?:krai|kraï|cry|crai)(?![\p{L}\p{N}])/giu, 'WannaCry'],
        [/(?<![\p{L}\p{N}])[EÉé]ternal[\s-]?Blue\b/giu, 'EternalBlue'],
        [/\bSMB\s?-?V\s?1\b/gi, 'SMBv1'],
        [/\b(?:App?[\s-]?locker|Apoker)\b/gi, 'AppLocker'],
        [/\bpass?e? (?:du|de|the|ze) hash\b/gi, 'pass-the-hash'],
        [/\b(?:carp[ée]ro|kerb[ée]ro|kerberos)[\s-]?(?:hosting|asting|roasting)\b/gi, 'Kerberoasting'],
      ],
    },
    it: {
      fr: [
        [/\bShare[\s-]?point\b/gi, 'SharePoint'],
        [/\bService[\s-]?now\b/gi, 'ServiceNow'],
      ],
    },
  };

  // Vocabulaires connus (listes dans vocabularies.js). label : nom de secours si le catalogue
  // i18n.js manque ; terms : termes en français, comme avant la version 4.1 (compatibilité).
  const LISTS = Lowsper.VOCABULARIES || {};
  const PRESETS = {};
  for (const id of Object.keys(LISTS)) {
    PRESETS[id] = {
      label: id,
      terms: (LISTS[id].fr || []).join(', '),
      fixes: (FIXES[id] && FIXES[id].fr) || [],
    };
  }

  /** Termes d'un vocabulaire dans une langue parlée (aucun si la langue n'a pas de liste). */
  function terms(id, lang) {
    const list = LISTS[id] && LISTS[id][lang || 'fr'];
    return Array.isArray(list) ? list : [];
  }

  const split = (t) =>
    String(t || '')
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  /**
   * Glossaire complet, pour corriger le texte après la transcription : vocabulaires cochés dans
   * les langues parlées, puis glossaire personnel (sans doublons). Pas de limite de longueur ici.
   */
  function merge(glossary, ids, langs) {
    const seen = new Set();
    const out = [];
    const add = (term) => {
      const k = term.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push(term);
    };
    for (const lang of langs && langs.length ? langs : ['fr']) for (const id of ids || []) terms(id, lang).forEach(add);
    split(glossary).forEach(add);
    return out.join(', ');
  }

  /**
   * Termes des vocabulaires cochés pour le contexte de Whisper, dans une langue parlée. Le moteur
   * ne garde que la fin du contexte (200 jetons au plus, moins pour un long passage) et coupe par
   * le début. Les listes sont donc alternées, un terme de chacune à tour de rôle, les premiers
   * (les plus utiles) à la fin : quelle que soit la place restante, chaque liste cochée garde ses
   * meilleurs termes, au lieu que la dernière prenne toute la place (decision.md §35). Les termes
   * déjà dans le glossaire personnel sont omis : il passe après, à la toute fin.
   */
  function alternate(ids, lang, glossary) {
    const mine = new Set(split(glossary).map((t) => t.toLowerCase()));
    const lists = (ids || []).map((id) => terms(id, lang).filter((t) => !mine.has(t.toLowerCase())));
    const seen = new Set();
    const order = [];
    const longest = Math.max(0, ...lists.map((l) => l.length));
    for (let i = 0; i < longest; i++)
      for (const l of lists) {
        const term = l[i];
        if (!term || seen.has(term.toLowerCase())) continue;
        seen.add(term.toLowerCase());
        order.push(term);
      }
    return order.reverse().join(', ');
  }

  // Expression d'un mot ou groupe de mots entier, sans tenir compte de la casse ni des accents
  // proches (« mira bello », « Mira Bello »). Une suite d'espaces et de tirets qui contient une
  // espace devient un seul séparateur [\s-]+ : un séparateur n'est jamais collé à un tiret
  // littéral, sinon « a - - b » faisait exploser le temps de calcul (ReDoS, decision.md §33).
  function wordPattern(wrong) {
    const esc = String(wrong)
      .trim()
      .split(/[\s-]*\s[\s-]*/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[\\s-]+');
    // Mot échappé et séparateurs bornés par des lettres : pas de retour arrière exponentiel
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
    return new RegExp('(^|[^\\p{L}\\p{N}])(' + esc + ')(?![\\p{L}\\p{N}])', 'giu');
  }

  /** Remplace un mot ou groupe de mots entier. Retourne { text, count }. */
  function replaceWord(text, wrong, right) {
    let count = 0;
    const out = String(text).replace(wordPattern(wrong), (m, before) => {
      count++;
      return before + right;
    });
    return { text: out, count };
  }

  /**
   * Corrige les déformations connues : celles des vocabulaires cochés, puis vos propres
   * corrections (« Mira Bello » -> « Mirabelle »), apprises à la fin des réunions.
   */
  function fix(text, ids, userFixes, langs) {
    let out = text;
    for (const lang of langs && langs.length ? langs : ['fr'])
      for (const id of ids || []) {
        const list = FIXES[id] && FIXES[id][lang];
        if (list) for (const [re, rep] of list) out = out.replace(re, rep);
      }
    for (const [wrong, right] of userFixes || []) if (wrong && right) out = replaceWord(out, wrong, right).text;
    return out;
  }

  /**
   * Contexte donné à Whisper avant chaque passage. Le moteur n'en garde que la fin
   * (200 jetons) : on met donc le plus important à la fin, juste avant le passage. Ordre :
   * vocabulaires métier (alternés, voir alternate), nom de la réunion, glossaire personnel,
   * texte précédent. Sans vocabulaire, le contexte est le même qu'avant la version 4.1.
   */
  function prompt({ title, glossary, context, vocab }) {
    const parts = [];
    if (vocab)
      parts.push(
        String(vocab)
          .trim()
          .replace(/[.,;]*$/, '.')
      );
    if (title)
      parts.push(
        String(title)
          .trim()
          .replace(/[.!?]*$/, '.')
      );
    if (glossary)
      parts.push(
        String(glossary)
          .trim()
          .replace(/[.,;]*$/, '.')
      );
    if (context) parts.push(String(context).trim());
    return parts.join(' ');
  }

  /**
   * Nom d'un vocabulaire dans la langue de l'interface (catalogue i18n.js). Les termes, eux,
   * suivent la langue parlée (terms).
   */
  function label(id, lang) {
    const key = 'vocab.' + id;
    const text = Lowsper.t ? Lowsper.t(key, null, lang) : key;
    return text === key && PRESETS[id] ? PRESETS[id].label : text;
  }

  Lowsper.Vocabulary = { PRESETS, FIXES, terms, label, merge, alternate, fix, prompt, replaceWord };
})();
