/*
 * Lowsper : profils de sortie et notes Markdown.
 *
 * Un profil (« Personnel », « Travail »...) dit où et sous quelle forme arrive la note d'une
 * réunion : dossier de destination (une base de notes de type Obsidian, ou les Téléchargements),
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
 */
(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const Lowsper = (root.Lowsper = root.Lowsper || {});
  const KEY = 'lowsper.profiles';
  const CURRENT = 'lowsper.profile';
  const DEFAULT_ID = 'defaut';

  const DEFAULT_TEMPLATE = '# {{titre}}\n\n{{en_tete}}\n\n## Transcript\n\n{{transcript}}\n';
  const DEFAULT_FILENAME = '{{date}} {{titre}}';

  /** Variables des modèles et des noms de fichier, avec leur explication (affichée dans les paramètres). */
  const VARIABLES = [
    ['titre', 'nom de la réunion, ou du fichier importé'],
    ['date', 'date de la réunion, AAAA-MM-JJ'],
    ['date_longue', 'date en toutes lettres (jeudi 5 novembre 2026)'],
    ['heure', 'heure de début, HHhMM (utilisable dans un nom de fichier)'],
    ['heure_debut', 'heure de début, HH:MM'],
    ['duree', 'durée (61 min)'],
    ['intervenants', 'intervenants, séparés par des virgules'],
    ['source', 'réunion en direct, ou fichier « nom »'],
    ['modele', 'modèle de transcription'],
    ['langue', 'langue parlée'],
    ['profil', 'nom du profil'],
    ['en_tete', "lignes d'informations du format classique (date, horaires, couverture...)"],
    ['avertissement', 'rappel sur la fiabilité de la transcription automatique'],
    ['transcript', 'les interventions horodatées'],
    ['transcript_complet', 'tout le format classique de Lowsper'],
  ];
  const NAMES = new Set(VARIABLES.map((v) => v[0]));

  // Propriétés proposées dans le front matter (cases à cocher des paramètres)
  const FRONT_FIELDS = [
    ['date', 'date'],
    ['duree', 'durée (minutes)'],
    ['intervenants', 'intervenants'],
    ['source', 'source'],
    ['modele', 'modèle'],
  ];

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
      prompt: 'compte-rendu', // consigne proposée par « Copier pour une IA »
    };
  }

  function newProfile(name, existing) {
    const ids = new Set((existing || []).map((p) => p.id));
    let id;
    do id = 'p' + Math.random().toString(36).slice(2, 8);
    while (ids.has(id));
    return Object.assign(defaultProfile(), {
      id,
      name: String(name || 'Nouveau profil').slice(0, 40),
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
    out.name = String(out.name || 'Profil').slice(0, 40);
    return out;
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
    const langs = { fr: 'français', en: 'anglais', auto: 'français et anglais' };
    return {
      titre: m.title || (m.file ? m.file.name.replace(/\.[^.]+$/, '') : 'Réunion'),
      date: `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`,
      date_longue: when.toLocaleDateString('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
      heure: `${pad(when.getHours())}h${pad(when.getMinutes())}`,
      heure_debut: `${pad(when.getHours())}:${pad(when.getMinutes())}`,
      duree: `${minutes} min`,
      intervenants: t.speakerNames(links).join(', '),
      source: m.file ? `fichier « ${m.file.name} »` : 'réunion en direct',
      modele: m.model || 'Whisper',
      langue: langs[m.language] || m.language || '',
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
  function safeFileName(name) {
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
    if (!base) base = 'reunion';
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
      name: safeFileName(render(p.fileName || DEFAULT_FILENAME, vars)),
      content: front ? front + '\n' + body : body,
    };
  }

  // ---------------------------------------------------------------------------
  // Consignes pour l'IA (« Copier pour une IA ») : fournies, modifiables, ou personnelles
  // ---------------------------------------------------------------------------
  const PROMPTS_KEY = 'lowsper.prompts';
  const BUILTIN_PROMPTS = [
    {
      id: 'compte-rendu',
      name: 'Compte rendu de réunion',
      text:
        "Voici le transcript automatique d'une réunion (il peut contenir des erreurs de reconnaissance). " +
        'Rédige un compte rendu structuré en français : contexte et participants identifiables, ' +
        'points abordés, décisions prises, actions à mener (qui, quoi, échéance), questions ouvertes. ' +
        "N'invente rien : si un passage est incompréhensible ou ambigu, signale-le.",
    },
    {
      id: 'synthese-appel',
      name: "Synthèse d'appel",
      text:
        "Voici le transcript automatique d'un appel (il peut contenir des erreurs de reconnaissance). " +
        "Rédige une synthèse courte en français, en quelques lignes : objet de l'appel, points clés, " +
        'engagements pris de part et d’autre, prochaines étapes et leur date si elle est citée. ' +
        "N'invente rien : si un passage est incompréhensible ou ambigu, signale-le.",
    },
    {
      id: 'actions',
      name: "Liste d'actions",
      text:
        "Voici le transcript automatique d'une réunion (il peut contenir des erreurs de reconnaissance). " +
        'Extrais uniquement les actions à mener, sous forme de tableau : action, responsable, échéance, ' +
        "phrase du transcript qui la justifie (avec son horodatage). Si le responsable ou l'échéance ne " +
        "sont pas dits explicitement, écris « non précisé » : n'invente ni nom ni date.",
    },
  ];

  /** Consignes enregistrées : textes modifiés des consignes fournies, et consignes personnelles. */
  function storedPrompts() {
    try {
      const v = JSON.parse(ls.get(PROMPTS_KEY) || '[]');
      return Array.isArray(v) ? v.filter((p) => p && typeof p.id === 'string' && typeof p.text === 'string') : [];
    } catch {
      return [];
    }
  }

  /** Toutes les consignes : fournies (éventuellement modifiées), puis personnelles. */
  function prompts() {
    const stored = storedPrompts();
    const builtin = BUILTIN_PROMPTS.map((b) => {
      const o = stored.find((p) => p.id === b.id);
      return Object.assign({}, b, { builtin: true, modified: !!o && o.text !== b.text }, o ? { text: o.text } : {});
    });
    const own = stored
      .filter((p) => !BUILTIN_PROMPTS.some((b) => b.id === p.id))
      .map((p) => ({ id: p.id, name: String(p.name || 'Consigne').slice(0, 60), text: p.text, builtin: false }));
    return [...builtin, ...own];
  }

  function savePrompt(id, patch) {
    const stored = storedPrompts();
    const current = prompts().find((p) => p.id === id) || { id, name: 'Consigne', text: '' };
    const next = { id, name: current.name, text: current.text, ...patch };
    const others = stored.filter((p) => p.id !== id);
    ls.set(PROMPTS_KEY, JSON.stringify([...others, { id: next.id, name: next.name, text: next.text }]));
  }

  function newPrompt(name) {
    const id = 'c' + Math.random().toString(36).slice(2, 8);
    savePrompt(id, { name: String(name || 'Nouvelle consigne').slice(0, 60), text: BUILTIN_PROMPTS[0].text });
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
    try {
      dir = await root.showDirectoryPicker({ id: 'lowsper-notes', mode: 'readwrite' });
    } catch (e) {
      if (e && e.name === 'AbortError') return null;
      throw e;
    }
    await folders.put(id, dir);
    return dir.name;
  }

  /**
   * État de l'accès au dossier d'un profil : 'aucun' (pas de dossier), 'oublie' (désigné puis
   * perdu, navigateur nettoyé), 'accorde', ou 'a-demander' (un clic est nécessaire).
   * interactive : appelé depuis un clic, l'accès peut être redemandé.
   */
  async function access(profile, interactive) {
    if (!profile || !profile.folderName) return { state: 'aucun' };
    const dir = await getFolder(profile.id);
    if (!dir) return { state: 'oublie' };
    let perm = 'prompt';
    try {
      perm = await dir.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted' && interactive) perm = await dir.requestPermission({ mode: 'readwrite' });
    } catch {}
    return perm === 'granted' ? { state: 'accorde', dir } : { state: 'a-demander' };
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
    writeNote,
    folders,
    BUILTIN_PROMPTS,
    prompts,
    savePrompt,
    newPrompt,
    removePrompt,
    promptText,
  };
})();
