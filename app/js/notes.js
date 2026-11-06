/*
 * Lowsper : profils de sortie et notes Markdown.
 *
 * Un profil, appelé « emplacement » dans l'interface (« Personnel », « Travail »...), dit où et sous
 * quelle forme arrive la note d'une réunion : dossier de destination (par défaut
 * Lowsper/Notes/<emplacement>, ou un dossier choisi, comme une base de notes de type Obsidian),
 * nom du fichier, propriétés en tête de note (front matter YAML), modèle de note à variables,
 * intervenants nommés écrits en liens [[Nom]].
 *
 * Le profil « Par défaut » garde le format classique de Lowsper, à l'identique : rien ne change
 * pour qui ne configure rien (decision.md §20).
 *
 * Les profils sont des réglages comme les autres (stockage du navigateur, copiés dans
 * app/reglages.txt). L'accès à un dossier, lui, est un droit accordé par le navigateur : il est
 * gardé dans IndexedDB et ne survit pas à un nettoyage du navigateur ; il faut alors redésigner
 * le dossier (la note part dans les Téléchargements en attendant).
 *
 * Sans dossier choisi, la note va dans Lowsper/Notes/<emplacement>, à l'intérieur du dossier
 * Lowsper déjà accordé à l'installation (settings.js). Le nom du sous-dossier est figé à la
 * première note écrite : renommer l'emplacement ensuite ne disperse pas les notes (decision.md §30).
 * Sans accès au dossier Lowsper (Firefox, accord refusé), la note part dans les Téléchargements.
 */
(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const Lowsper = (root.Lowsper = root.Lowsper || {});
  const KEY = 'lowsper.profiles';
  const CURRENT = 'lowsper.profile';
  const DEFAULT_ID = 'defaut';
  // Texte dans la langue voulue (i18n.js, chargé avant ce fichier)
  const tx = (key, vars, lang) => Lowsper.t(key, vars, lang);

  const DEFAULT_TEMPLATE = '# {{titre}}\n\n{{en_tete}}\n\n## Transcript\n\n{{transcript}}\n';
  const DEFAULT_FILENAME = '{{date}} {{titre}}';

  /**
   * Variables des modèles et des noms de fichier, avec leur explication (affichée dans les
   * paramètres, dans la langue de l'interface). Les noms ne changent jamais avec la langue : un
   * modèle de note écrit en français reste valable en anglais (decision.md §25).
   */
  const VARIABLES = [
    'titre',
    'date',
    'date_longue',
    'heure',
    'heure_debut',
    'duree',
    'intervenants',
    'source',
    'modele',
    'langue',
    'profil',
    'en_tete',
    'avertissement',
    'transcript',
    'transcript_complet',
  ].map((name) => [name, () => tx('var.' + name)]);
  const NAMES = new Set(VARIABLES.map((v) => v[0]));

  // Propriétés proposées dans le front matter (cases à cocher des paramètres). Les clés écrites
  // dans la note (date, duree...) restent les mêmes dans les deux langues.
  const FRONT_FIELDS = ['date', 'duree', 'intervenants', 'source', 'modele'].map((key) => [
    key,
    () => tx('front.' + key),
  ]);

  function defaultProfile() {
    return {
      id: DEFAULT_ID,
      name: 'Par défaut',
      format: 'classique', // format historique de Lowsper, nom de fichier historique
      fileName: DEFAULT_FILENAME,
      template: DEFAULT_TEMPLATE,
      links: false,
      front: { enabled: false, fields: ['date', 'duree', 'intervenants', 'source'], tags: '', extra: '' },
      folderName: '',
      subfolder: '', // sous-dossier de Lowsper/Notes, figé à la première note écrite
      prompt: 'compte-rendu', // consigne proposée par « Obtenir un résumé »
    };
  }

  // Nom du profil par défaut tant que l'utilisateur ne l'a pas changé : suit la langue de l'interface
  const DEFAULT_NAMES = new Set(['Par défaut', 'Default']);

  function newProfile(name, existing) {
    const ids = new Set((existing || []).map((p) => p.id));
    let id;
    do id = 'p' + Math.random().toString(36).slice(2, 8);
    while (ids.has(id));
    return Object.assign(defaultProfile(), {
      id,
      name: String(name || tx('prof.new')).slice(0, 40),
      format: 'modele',
      front: { enabled: true, fields: ['date', 'duree', 'intervenants', 'source'], tags: 'reunion', extra: '' },
    });
  }

  /** Profil complété des valeurs par défaut (réglages d'une version plus ancienne, fichier abîmé). */
  function normalize(p) {
    const d = defaultProfile();
    const out = Object.assign(d, p && typeof p === 'object' ? p : {});
    out.front = Object.assign(defaultProfile().front, (p && p.front) || {});
    if (!Array.isArray(out.front.fields)) out.front.fields = [];
    out.format = out.format === 'modele' ? 'modele' : 'classique';
    out.name = String(out.name || tx('prof.fallbackName')).slice(0, 40);
    out.subfolder = typeof out.subfolder === 'string' ? out.subfolder : '';
    return out;
  }

  /** Nom de dossier sûr sous Windows, macOS et Linux (caractères interdits retirés). */
  function safeFolderName(name) {
    const s = [...String(name || '')]
      .map((c) => (c.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(c) ? ' ' : c))
      .join('')
      .replace(/\s+/g, ' ')
      .replace(/^[\s.]+|[\s.]+$/g, '')
      .slice(0, 60)
      .trim();
    return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s) || !s ? tx('prof.fallbackName') : s;
  }

  /** Sous-dossier de Lowsper/Notes d'un emplacement : figé s'il a déjà reçu une note, sinon son nom. */
  const subfolderOf = (p) => p.subfolder || safeFolderName(p.name);

  /**
   * Où va la note, en clair : le dossier choisi, Lowsper › Notes › <emplacement>, ou les
   * Téléchargements quand ce navigateur n'a pas accès au dossier Lowsper.
   */
  function folderLabel(p, hasLowsper) {
    if (p.folderName) return p.folderName;
    if (!hasLowsper) return tx('home.downloads');
    return tx('prof.lowsperPath', { sub: subfolderOf(p) });
  }

  // ---------------------------------------------------------------------------
  // Profils enregistrés (stockage du navigateur, copié dans app/reglages.txt)
  // ---------------------------------------------------------------------------
  const ls = {
    get(k) {
      try {
        return root.localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        root.localStorage.setItem(k, v);
      } catch {}
    },
  };

  function list() {
    let stored = [];
    try {
      stored = JSON.parse(ls.get(KEY) || '[]');
    } catch {}
    const profiles = (Array.isArray(stored) ? stored : []).map(normalize);
    // Le profil « Par défaut » existe toujours, en tête
    if (!profiles.some((p) => p.id === DEFAULT_ID)) profiles.unshift(defaultProfile());
    for (const p of profiles) if (p.id === DEFAULT_ID && DEFAULT_NAMES.has(p.name)) p.name = tx('prof.default');
    return profiles;
  }

  function saveAll(profiles) {
    ls.set(KEY, JSON.stringify(profiles.map(normalize)));
  }

  function current() {
    const profiles = list();
    const id = ls.get(CURRENT);
    return profiles.find((p) => p.id === id) || profiles[0];
  }

  function select(id) {
    ls.set(CURRENT, id);
  }

  // ---------------------------------------------------------------------------
  // Variables, modèle, nom de fichier, front matter
  // ---------------------------------------------------------------------------
  const pad = (n) => String(n).padStart(2, '0');

  /** Valeurs des variables pour un transcript. */
  function variables(t, profile) {
    const m = t.meta;
    const links = !!profile.links;
    const parts = t.parts({ links });
    const when = new Date((m.file && m.file.recordedAt) || m.startedAt);
    const minutes = m.file
      ? Math.max(1, Math.round((m.file.duration || 0) / 60))
      : Math.max(1, Math.round(((m.endedAt || Date.now()) - m.startedAt) / 60000));
    // Valeurs dans la langue de la note (celle de l'interface au début de la réunion)
    const lang = t.noteLang ? t.noteLang() : 'fr';
    const tl = (key, v) => Lowsper.t(key, v, lang);
    const spoken = Lowsper.Languages ? Lowsper.Languages.noteLabel(m.language, lang, 'note.varLangs.') : m.language;
    return {
      titre: m.title || (m.file ? m.file.name.replace(/\.[^.]+$/, '') : tl('note.defaultTitle')),
      date: `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`,
      date_longue: when.toLocaleDateString(Lowsper.i18n.locale(lang), {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
      heure: `${pad(when.getHours())}h${pad(when.getMinutes())}`,
      heure_debut: `${pad(when.getHours())}:${pad(when.getMinutes())}`,
      duree: `${minutes} min`,
      intervenants: t.speakerNames(links).join(', '),
      source: m.file ? tl('note.sourceFile', { name: m.file.name }) : tl('note.sourceLive'),
      modele: m.model || 'Whisper',
      langue: spoken || '',
      profil: profile.name,
      en_tete: parts.header.join('\n'),
      avertissement: parts.notice,
      transcript: parts.body,
      transcript_complet: t.toMarkdown().trim(),
      // Pour le front matter (valeurs brutes)
      _minutes: minutes,
      _speakers: t.speakerNames(links),
    };
  }

  /** Remplace les {{variables}} connues ; une variable inconnue reste telle quelle (erreur visible). */
  function render(template, vars) {
    return String(template || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (all, name) =>
      NAMES.has(name) ? String(vars[name] == null ? '' : vars[name]) : all
    );
  }

  /** Variables inconnues d'un modèle (signalées dans les paramètres). */
  function unknownVariables(template) {
    const out = new Set();
    for (const m of String(template || '').matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)) if (!NAMES.has(m[1])) out.add(m[1]);
    return [...out];
  }

  const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  /**
   * Nom de fichier valide sous Windows (et ailleurs) : ni caractère interdit (< > : " / \ | ? *),
   * ni caractère de contrôle, ni point ou espace final, ni nom réservé (CON, NUL, COM1...).
   */
  function safeFileName(name, lang) {
    let base = String(name || '')
      .replace(/\.md$/i, '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/[/\\:]/g, '-')
      .replace(/[<>"|?*]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/, '');
    if (base.length > 120) base = base.slice(0, 120).replace(/[. ]+$/, '');
    if (!base) base = tx('note.fileName', null, lang || 'fr');
    if (RESERVED.test(base.split('.')[0])) base = '_' + base;
    return base + '.md';
  }

  /** Chaîne YAML entre guillemets, toujours (aucun piège : deux-points, dièse, oui/non...). */
  function yamlString(s) {
    return (
      '"' +
      String(s)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '')
        .replace(/\t/g, '\\t') +
      '"'
    );
  }

  /** Front matter YAML d'après les choix du profil. Retourne '' s'il est désactivé. */
  function frontMatter(front, vars) {
    if (!front || !front.enabled) return '';
    const lines = ['---'];
    const keys = new Set();
    const add = (key, value) => {
      keys.add(key);
      lines.push(...value);
    };
    const fields = new Set(front.fields || []);
    if (fields.has('date')) add('date', [`date: ${vars.date}`]);
    if (fields.has('duree')) add('duree', [`duree: ${vars._minutes}`]);
    if (fields.has('intervenants') && vars._speakers.length) {
      add('intervenants', ['intervenants:', ...vars._speakers.map((n) => `  - ${yamlString(n)}`)]);
    }
    if (fields.has('source')) add('source', [`source: ${yamlString(vars.source)}`]);
    if (fields.has('modele')) add('modele', [`modele: ${yamlString(vars.modele)}`]);
    // Étiquettes : sans espace ni dièse (contraintes des bases de notes)
    const tags = String(front.tags || '')
      .split(/[,\n]+/)
      .map((x) => x.trim().replace(/^#/, '').replace(/\s+/g, '-'))
      .filter(Boolean);
    if (tags.length) add('tags', ['tags:', ...tags.map((x) => `  - ${yamlString(x)}`)]);
    // Champs libres « clé: valeur », une ligne chacun ; les variables y sont permises
    for (const line of String(front.extra || '').split('\n')) {
      const m = line.match(/^\s*([\p{L}\p{N}_-]+)\s*:\s*(.*)$/u);
      if (!m || keys.has(m[1])) continue;
      add(m[1], [`${m[1]}: ${yamlString(render(m[2].trim(), vars))}`]);
    }
    lines.push('---');
    return lines.join('\n') + '\n';
  }

  /** Lignes de champs libres mal formées (signalées dans les paramètres). */
  function badExtraLines(extra) {
    return String(extra || '')
      .split('\n')
      .filter((l) => l.trim() && !/^\s*[\p{L}\p{N}_-]+\s*:/u.test(l));
  }

  /** La note d'un transcript selon un profil : { name, content }. */
  function note(t, profile) {
    const p = normalize(profile);
    if (p.format === 'classique') return { name: t.fileName(), content: t.toMarkdown() };
    const vars = variables(t, p);
    const body = render(p.template, vars).replace(/\s+$/, '') + '\n';
    const front = frontMatter(p.front, vars);
    return {
      name: safeFileName(render(p.fileName || DEFAULT_FILENAME, vars), t.noteLang()),
      content: front ? front + '\n' + body : body,
    };
  }

  // ---------------------------------------------------------------------------
  // Consignes pour l'IA (« Obtenir un résumé ») : fournies, modifiables, ou personnelles
  // ---------------------------------------------------------------------------
  const PROMPTS_KEY = 'lowsper.prompts';
  // Consignes fournies : textes dans le catalogue (i18n.js), en français et en anglais
  const BUILTIN_IDS = ['compte-rendu', 'synthese-appel', 'actions'];
  /** Consignes fournies dans une langue (par défaut, celle de l'interface). */
  function builtinPrompts(lang) {
    return BUILTIN_IDS.map((id) => ({
      id,
      name: tx('prompt.' + id + '.name', null, lang),
      text: tx('prompt.' + id + '.text', null, lang),
    }));
  }
  /**
   * Textes d'origine des versions précédentes (3.3.0 à 3.5.0 en français, lot R2 en anglais),
   * remplacés au lot R6 par un prompt système (decision.md §29). Ils ne sont jamais affichés :
   * ils servent seulement à reconnaître une consigne que l'utilisateur n'a pas modifiée.
   */
  const LEGACY_PROMPTS = {
    'compte-rendu': [
      "Voici le transcript automatique d'une réunion (il peut contenir des erreurs de reconnaissance). " +
        'Rédige un compte rendu structuré en français : contexte et participants identifiables, ' +
        'points abordés, décisions prises, actions à mener (qui, quoi, échéance), questions ouvertes. ' +
        "N'invente rien : si un passage est incompréhensible ou ambigu, signale-le.",
      'Here is the automatic transcript of a meeting (it may contain speech recognition errors). ' +
        'Write structured minutes in English: context and identifiable participants, ' +
        'topics discussed, decisions made, action items (who, what, deadline), open questions. ' +
        'Do not invent anything: if a passage is unclear or ambiguous, say so.',
    ],
    'synthese-appel': [
      "Voici le transcript automatique d'un appel (il peut contenir des erreurs de reconnaissance). " +
        "Rédige une synthèse courte en français, en quelques lignes : objet de l'appel, points clés, " +
        'engagements pris de part et d’autre, prochaines étapes et leur date si elle est citée. ' +
        "N'invente rien : si un passage est incompréhensible ou ambigu, signale-le.",
      'Here is the automatic transcript of a call (it may contain speech recognition errors). ' +
        'Write a short summary in English, in a few lines: purpose of the call, key points, ' +
        'commitments made by each side, next steps and their date if one is mentioned. ' +
        'Do not invent anything: if a passage is unclear or ambiguous, say so.',
    ],
    actions: [
      "Voici le transcript automatique d'une réunion (il peut contenir des erreurs de reconnaissance). " +
        'Extrais uniquement les actions à mener, sous forme de tableau : action, responsable, échéance, ' +
        "phrase du transcript qui la justifie (avec son horodatage). Si le responsable ou l'échéance ne " +
        "sont pas dits explicitement, écris « non précisé » : n'invente ni nom ni date.",
      'Here is the automatic transcript of a meeting (it may contain speech recognition errors). ' +
        'Extract only the action items, as a table: action, owner, deadline, ' +
        'sentence of the transcript that supports it (with its timestamp). If the owner or the deadline ' +
        'is not stated explicitly, write “not specified”: never invent a name or a date.',
    ],
  };
  /**
   * Texte d'origine d'une consigne fournie, dans l'une des langues ou d'une version précédente :
   * un texte enregistré identique à l'un d'eux n'a pas été modifié par l'utilisateur. Il suit donc
   * la langue de l'interface et le texte fourni actuel. Un texte modifié ne change jamais.
   */
  const isOriginal = (id, text) =>
    Lowsper.i18n.LANGS.some((l) => tx('prompt.' + id + '.text', null, l) === text) ||
    (LEGACY_PROMPTS[id] || []).includes(text);

  /** Consignes enregistrées : textes modifiés des consignes fournies, et consignes personnelles. */
  function storedPrompts() {
    try {
      const v = JSON.parse(ls.get(PROMPTS_KEY) || '[]');
      return Array.isArray(v) ? v.filter((p) => p && typeof p.id === 'string' && typeof p.text === 'string') : [];
    } catch {
      return [];
    }
  }

  /**
   * Toutes les consignes : fournies (éventuellement modifiées), puis personnelles. Une consigne
   * fournie non modifiée est dans la langue de l'interface ; une consigne modifiée par
   * l'utilisateur garde son texte, quelle que soit la langue.
   */
  function prompts() {
    const stored = storedPrompts();
    const builtin = builtinPrompts().map((b) => {
      const o = stored.find((p) => p.id === b.id);
      const modified = !!o && !isOriginal(b.id, o.text);
      return Object.assign({}, b, { builtin: true, modified }, modified ? { text: o.text } : {});
    });
    const own = stored
      .filter((p) => !BUILTIN_IDS.includes(p.id))
      .map((p) => ({
        id: p.id,
        name: String(p.name || tx('ai.fallbackName')).slice(0, 60),
        text: p.text,
        builtin: false,
      }));
    return [...builtin, ...own];
  }

  function savePrompt(id, patch) {
    const stored = storedPrompts();
    const current = prompts().find((p) => p.id === id) || { id, name: tx('ai.fallbackName'), text: '' };
    const next = { id, name: current.name, text: current.text, ...patch };
    const others = stored.filter((p) => p.id !== id);
    ls.set(PROMPTS_KEY, JSON.stringify([...others, { id: next.id, name: next.name, text: next.text }]));
  }

  function newPrompt(name) {
    const id = 'c' + Math.random().toString(36).slice(2, 8);
    savePrompt(id, { name: String(name || tx('ai.new')).slice(0, 60), text: builtinPrompts()[0].text });
    return id;
  }

  /** Rétablit le texte d'origine d'une consigne fournie, ou supprime une consigne personnelle. */
  function removePrompt(id) {
    ls.set(PROMPTS_KEY, JSON.stringify(storedPrompts().filter((p) => p.id !== id)));
  }

  /**
   * Texte copié pour l'IA : la consigne (variables possibles), puis la note. {{note}} place la
   * note à un endroit précis ; sans {{note}} ni {{transcript}}, elle est ajoutée à la fin.
   */
  function promptText(t, profile, promptId) {
    const p = normalize(profile);
    const list = prompts();
    const prompt = list.find((x) => x.id === (promptId || p.prompt)) || list[0];
    const n = note(t, p).content;
    const vars = variables(t, p);
    const text = render(
      String(prompt.text).replace(/\{\{\s*note\s*\}\}/g, () => '\u0000NOTE\u0000'),
      vars
    );
    if (text.includes('\u0000NOTE\u0000')) return text.split('\u0000NOTE\u0000').join(n);
    if (/\{\{\s*transcript\s*\}\}/.test(prompt.text)) return text;
    return text.replace(/\s+$/, '') + '\n\n---\n\n' + n;
  }

  // ---------------------------------------------------------------------------
  // Dossier de destination (navigateur) : désigné une fois, accès redemandé proprement
  // ---------------------------------------------------------------------------
  function idb(mode, fn) {
    return new Promise((resolve) => {
      let req;
      try {
        req = root.indexedDB.open('lowsper', 1);
      } catch {
        return resolve(null);
      }
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction('kv', mode);
          const r = fn(tx.objectStore('kv'));
          tx.oncomplete = () => resolve(r && 'result' in r ? r.result : null);
          tx.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      };
    });
  }

  const folderKey = (id) => 'dossier-notes:' + id;
  // Rangement des accès aux dossiers : IndexedDB (seul endroit où le navigateur les accepte).
  // Remplaçable par les tests, qui ne peuvent pas fabriquer un vrai accès à un dossier.
  const folders = {
    get: (id) => idb('readonly', (s) => s.get(folderKey(id))),
    put: (id, dir) => idb('readwrite', (s) => s.put(dir, folderKey(id))),
    delete: (id) => idb('readwrite', (s) => s.delete(folderKey(id))),
  };
  const getFolder = (id) => folders.get(id);
  const forgetFolder = (id) => folders.delete(id);

  /** Demande le dossier (depuis un clic). Retourne son nom, ou null si l'utilisateur renonce. */
  async function pickFolder(id) {
    let dir;
    if (typeof root.showDirectoryPicker !== 'function') {
      const e = new Error(Lowsper.Browser ? Lowsper.Browser.folderMessage('notes') : tx('browser.unsupported'));
      e.code = 'unsupported';
      throw e;
    }
    try {
      dir = await root.showDirectoryPicker({ id: 'lowsper-notes', mode: 'readwrite' });
    } catch (e) {
      if (e && e.name === 'AbortError') return null;
      throw e;
    }
    await folders.put(id, dir);
    return dir.name;
  }

  // Dossier Lowsper accordé à l'installation (settings.js). Remplaçable par les tests.
  const lowsper = { get: async () => (Lowsper.Settings ? Lowsper.Settings.folder() : null) };

  async function permission(dir, interactive) {
    let perm = 'prompt';
    try {
      perm = await dir.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted' && interactive) perm = await dir.requestPermission({ mode: 'readwrite' });
    } catch {}
    return perm === 'granted';
  }

  /**
   * État de l'accès au dossier d'un profil : 'aucun' (Téléchargements), 'oublie' (dossier choisi
   * puis perdu, navigateur nettoyé), 'accorde', ou 'a-demander' (un clic est nécessaire).
   * kind : 'choisi' (dossier désigné pour ce profil) ou 'lowsper' (Lowsper/Notes/<emplacement>).
   * interactive : appelé depuis un clic, l'accès peut être redemandé.
   * write : la note va être écrite, les sous-dossiers de Lowsper/Notes sont créés au besoin.
   */
  async function access(profile, interactive, write) {
    if (!profile) return { state: 'aucun' };
    if (!profile.folderName) {
      const base = await lowsper.get();
      if (!base) return { state: 'aucun' };
      const sub = subfolderOf(profile);
      if (!(await permission(base, interactive))) return { state: 'a-demander', kind: 'lowsper', sub };
      if (!write) return { state: 'accorde', kind: 'lowsper', sub };
      const notes = await base.getDirectoryHandle('Notes', { create: true });
      const dir = await notes.getDirectoryHandle(sub, { create: true });
      return { state: 'accorde', kind: 'lowsper', sub, dir };
    }
    const dir = await getFolder(profile.id);
    if (!dir) return { state: 'oublie', kind: 'choisi' };
    return (await permission(dir, interactive))
      ? { state: 'accorde', kind: 'choisi', dir }
      : { state: 'a-demander', kind: 'choisi' };
  }

  async function exists(dir, name) {
    try {
      await dir.getFileHandle(name);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Écrit la note dans le dossier. Première écriture : un nom déjà pris reçoit « (2) », « (3) »...
   * pour ne jamais écraser une autre note. Mises à jour : même fichier (savedAs).
   */
  async function writeNote(dir, name, content, savedAs) {
    let target = savedAs;
    if (!target) {
      target = name;
      for (let i = 2; (await exists(dir, target)) && i < 100; i++) target = name.replace(/\.md$/, ` (${i}).md`);
    }
    const handle = await dir.getFileHandle(target, { create: true });
    const w = await handle.createWritable();
    await w.write(content);
    await w.close();
    return target;
  }

  Lowsper.Notes = {
    DEFAULT_ID,
    DEFAULT_TEMPLATE,
    DEFAULT_FILENAME,
    VARIABLES,
    FRONT_FIELDS,
    defaultProfile,
    newProfile,
    normalize,
    list,
    saveAll,
    current,
    select,
    variables,
    render,
    unknownVariables,
    safeFileName,
    yamlString,
    frontMatter,
    badExtraLines,
    note,
    pickFolder,
    forgetFolder,
    access,
    lowsper,
    safeFolderName,
    subfolderOf,
    folderLabel,
    writeNote,
    folders,
    BUILTIN_IDS,
    builtinPrompts,
    LEGACY_PROMPTS,
    prompts,
    savePrompt,
    newPrompt,
    removePrompt,
    promptText,
  };
})();
