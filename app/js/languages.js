/*
 * Lowsper : langues parlées dans les réunions (lot R8, decision.md §34).
 *
 * L'utilisateur coche les langues de ses réunions ; le moteur reconnaît celle de chaque passage
 * parmi elles (engine.js, détection sur la sortie de l'encodeur déjà calculée : une seule étape du
 * décodeur, quel que soit le nombre de langues cochées).
 *
 * Seules sont proposées les langues dont la qualité a été mesurée sur le corpus synthétique
 * (tools/test/eval-langs.mjs) ; celles qui passent de justesse sont proposées avec une mise en
 * garde. Les noms affichés sont dans le catalogue i18n.js (« lang.<code> » et
 * « lang.native.<code> »).
 *
 * Réglage : « lowsper.languages », codes séparés par des virgules (« fr,en »). L'ancien réglage
 * « lowsper.language » (« fr », « en » ou « auto » = français et anglais) des versions 4.0 et
 * précédentes est lu tant que le nouveau n'existe pas : rien n'est perdu en copiant un ancien
 * app/reglages.txt.
 */
(function () {
  'use strict';

  const Lowsper = (window.Lowsper = window.Lowsper || {});

  // Ordre d'affichage. quality : 'ok' (proposée), 'warn' (proposée avec une mise en garde).
  // Seuil (choix du mainteneur) : erreur de Whisper small sur le corpus synthétique d'au plus
  // 10 % : proposée ; de 10 à 25 % : mise en garde ; au-delà : pas proposée (hindi, 50 %).
  // Mesures : decision.md §34. err : taux d'erreur mesuré (par caractère pour zh et ja).
  const LIST = [
    { code: 'fr', quality: 'ok', err: 7.0 },
    { code: 'en', quality: 'ok', err: 0.9 },
    { code: 'es', quality: 'ok', err: 3.6 },
    { code: 'de', quality: 'ok', err: 4.7 },
    { code: 'it', quality: 'warn', err: 18.6 },
    { code: 'pt', quality: 'ok', err: 6.3 },
    { code: 'nl', quality: 'ok', err: 8.5 },
    { code: 'ar', quality: 'ok', err: 7.3 },
    { code: 'zh', quality: 'warn', err: 15.4 },
    { code: 'ja', quality: 'ok', err: 7.9 },
    { code: 'ko', quality: 'warn', err: 21.0 },
  ];
  const CODES = LIST.map((l) => l.code);
  const KEY = 'lowsper.languages';
  const OLD = 'lowsper.language';

  /** Liste de codes connus, dans l'ordre du catalogue, sans doublon. */
  function clean(codes) {
    const set = new Set(Array.isArray(codes) ? codes : String(codes || '').split(','));
    return CODES.filter((c) => set.has(c));
  }

  /**
   * Langues d'une réunion à partir d'une valeur enregistrée, ancienne ou nouvelle : « auto »
   * (versions 4.0 et précédentes) devient français et anglais ; une liste vide, le français.
   */
  function normalize(value) {
    if (value === 'auto') return ['fr', 'en'];
    const list = clean(value);
    return list.length ? list : ['fr'];
  }

  /** Langues cochées, depuis le stockage (get : clé -> valeur ou null). */
  function read(get) {
    const now = get(KEY);
    if (now != null && clean(now).length) return clean(now);
    return normalize(get(OLD));
  }

  /** Enregistre les langues cochées (au moins une : la dernière ne se décoche pas). */
  function write(set, codes) {
    const list = clean(codes);
    if (list.length) set(KEY, list.join(','));
    return list;
  }

  /** Ce que le moteur attend : un code si une seule langue, sinon la liste où détecter. */
  function forEngine(codes) {
    const list = normalize(codes);
    return list.length === 1 ? list[0] : list;
  }

  function info(code) {
    return LIST.find((l) => l.code === code) || null;
  }

  /**
   * Nom des langues d'une réunion pour la note (« français », « français et anglais (détection
   * automatique) »), dans la langue de la note. Les trois réglages d'avant la version 4.1 gardent
   * exactement leur texte d'origine.
   */
  function noteLabel(value, lang, prefix) {
    const tl = (key, vars) => Lowsper.t(key, vars, lang);
    const list = normalize(value);
    const key = list.join(',');
    if (key === 'fr' || key === 'en') return tl(prefix + key);
    if (key === 'fr,en') return tl(prefix + 'auto');
    // Dans une phrase, le français écrit les noms de langue en minuscules, l'anglais non
    const names = list.map((c) => (lang === 'fr' ? tl('lang.' + c).toLocaleLowerCase('fr') : tl('lang.' + c)));
    if (list.length === 1) return names[0];
    const joined = new Intl.ListFormat(Lowsper.i18n.locale(lang), { type: 'conjunction' }).format(names);
    return tl(prefix + 'many', { langs: joined });
  }

  Lowsper.Languages = { LIST, CODES, KEY, OLD, clean, normalize, read, write, forEngine, info, noteLabel };
})();
