/*
 * Lowsper : réglages conservés d'un jour sur l'autre.
 *
 * Les réglages (sigles, vocabulaire métier, langue, puissance, modèle, voix mémorisées...) sont
 * rangés dans le stockage du navigateur. Or beaucoup de postes d'entreprise effacent ce stockage
 * à la fermeture du navigateur (stratégie « effacer les données de navigation en quittant ») :
 * les sigles saisis le vendredi avaient disparu le lundi.
 *
 * Parade : une copie des réglages est écrite dans le dossier Lowsper (app/reglages.txt), relue
 * au lancement par une simple balise <script> (comme les modèles installés). Si le navigateur a
 * perdu un réglage, il est restauré depuis ce fichier, sans aucune action de l'utilisateur.
 * Écrire dans le dossier demande l'accord du navigateur : il est demandé une fois, au moment où
 * l'utilisateur ferme les paramètres après une modification (ou à l'installation du modèle).
 */
(function () {
  'use strict';

  const Lowsper = (window.Lowsper = window.Lowsper || {});
  const PREFIX = 'lowsper.';
  // Pas de copie sur disque : session en cours (texte de réunion), mesures internes
  const SKIP = /^lowsper\.(session\.|consent\.|folderSavedAt$)/;
  const FILE = 'reglages.txt';

  const ls = {
    keys() {
      try {
        return Object.keys(localStorage);
      } catch {
        return [];
      }
    },
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch {}
    },
  };

  /** Réglages actuels du navigateur, à copier dans le dossier. */
  function snapshot() {
    const data = {};
    for (const k of ls.keys().sort()) {
      if (!k.startsWith(PREFIX) || SKIP.test(k)) continue;
      data[k] = ls.get(k);
    }
    return data;
  }

  // Copie lue au lancement (app/reglages.txt, chargé avant ce script)
  const file = self.LOWSPER_SETTINGS && self.LOWSPER_SETTINGS.data ? self.LOWSPER_SETTINGS : null;
  let restored = [];
  /** Restaure les réglages que le navigateur a perdus. Le navigateur garde la main sur le reste. */
  function restore() {
    if (!file) return [];
    restored = [];
    for (const [k, v] of Object.entries(file.data)) {
      if (!k.startsWith(PREFIX) || SKIP.test(k) || typeof v !== 'string') continue;
      if (ls.get(k) === null) {
        ls.set(k, v);
        restored.push(k);
      }
    }
    return restored;
  }
  restore();
  // Thème retrouvé dans le dossier : l'appliquer tout de suite
  if (Lowsper.Theme) Lowsper.Theme.apply();

  let lastWritten = file ? JSON.stringify(file.data) : null;
  let handle = null; // dossier Lowsper (FileSystemDirectoryHandle)

  // --- Mémorisation du dossier entre deux lancements (IndexedDB, si le navigateur le garde) ---
  function idb(mode, fn) {
    return new Promise((resolve) => {
      let req;
      try {
        req = indexedDB.open('lowsper', 1);
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

  async function savedHandle() {
    if (handle) return handle;
    handle = await idb('readonly', (s) => s.get('folder'));
    return handle;
  }

  /** À appeler quand on obtient le dossier Lowsper (installation, ou choix explicite). */
  async function setFolder(dir) {
    handle = dir;
    await idb('readwrite', (s) => s.put(dir, 'folder'));
  }

  const dirty = () => JSON.stringify(snapshot()) !== lastWritten;

  async function write(dir) {
    const data = snapshot();
    const payload = { savedAt: Date.now(), data };
    const app = await dir.getDirectoryHandle('app', { create: true });
    const f = await app.getFileHandle(FILE, { create: true });
    const w = await f.createWritable();
    await w.write(
      '/* Réglages de Lowsper (sigles, vocabulaire, préférences). Fichier écrit par Lowsper : ne pas modifier. */\n' +
        'self.LOWSPER_SETTINGS=' +
        JSON.stringify(payload) +
        ';\n'
    );
    await w.close();
    lastWritten = JSON.stringify(data);
    ls.set('lowsper.folderSavedAt', String(payload.savedAt));
    return payload.savedAt;
  }

  /**
   * Écrit la copie si les réglages ont changé.
   * interactive : appelé depuis un clic, on peut demander l'accord du navigateur ou le dossier.
   * Retourne 'saved', 'unchanged', 'needs-folder' (aucun dossier connu) ou 'denied'.
   */
  async function save({ interactive = false, force = false } = {}) {
    if (!force && !dirty()) return 'unchanged';
    let dir = await savedHandle();
    if (!dir) {
      if (!interactive || !Lowsper.pickLowsperFolder) return 'needs-folder';
      dir = await Lowsper.pickLowsperFolder();
      await setFolder(dir);
    }
    let perm = 'prompt';
    try {
      perm = await dir.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted' && interactive) perm = await dir.requestPermission({ mode: 'readwrite' });
    } catch {}
    if (perm !== 'granted') return 'denied';
    await write(dir);
    return 'saved';
  }

  function status() {
    const at = Number(ls.get('lowsper.folderSavedAt')) || (file && file.savedAt) || 0;
    return { savedAt: at, dirty: dirty(), restored: restored.slice(), hasFile: !!file };
  }

  Lowsper.Settings = { snapshot, restore, save, setFolder, status };
})();
