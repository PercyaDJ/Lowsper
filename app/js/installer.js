/*
 * Lowsper : installation du modèle au premier lancement.
 *
 * Le modèle n'est pas dans le zip (trop lourd). Au premier lancement :
 *   1. l'utilisateur désigne le dossier Lowsper (celui qui contient Lowsper.html) ;
 *   2. les fichiers du modèle sont téléchargés depuis Hugging Face, à une révision figée,
 *      et leur empreinte SHA-256 est vérifiée ;
 *   3. ils sont écrits dans app/models/<modèle>/ sous forme de fichiers .txt lisibles par
 *      une balise <script> (seul moyen de les relire ensuite en file://, sans autorisation).
 * Aux lancements suivants, tout est lu sur le disque : plus aucun accès réseau.
 *
 * C'est la seule partie de Lowsper qui utilise le réseau, et uniquement vers Hugging Face
 * (voir la politique connect-src de Lowsper.html).
 */
(function () {
  'use strict';

  const Lowsper = (window.Lowsper = window.Lowsper || {});
  const tx = (key, vars) => Lowsper.t(key, vars);
  const CHUNK = 24 * 1024 * 1024; // même découpage que tools/build.mjs

  /** Dossier de la page ouverte, lisible par l'utilisateur (ex. C:\Users\...\Lowsper). */
  Lowsper.pageFolder = function () {
    let p = decodeURIComponent(location.pathname).replace(/\/[^/]*$/, '');
    if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1).replace(/\//g, '\\');
    return p;
  };

  /** Page ouverte depuis un zip non extrait (Windows l'ouvre alors depuis un dossier temporaire). */
  Lowsper.openedFromTemp = function () {
    const p = decodeURIComponent(location.pathname).toLowerCase();
    return /\/(appdata\/local\/temp|temp|tmp)\//.test(p) || /\.zip\//.test(p) || /\/temporary internet files\//.test(p);
  };

  Lowsper.canInstall = function () {
    return typeof window.showDirectoryPicker === 'function';
  };

  function installError(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
  }

  function toBase64(bytes) {
    if (typeof bytes.toBase64 === 'function') return bytes.toBase64();
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  async function sha256(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  const header = "/* Fichier écrit par l'installateur de Lowsper : ne pas modifier. */\n";
  const register = (key, payload) =>
    `${header}(self.LOWSPER_ASSETS=self.LOWSPER_ASSETS||{})[${JSON.stringify(key)}]=${payload};\n`;

  async function writeText(dir, name, text) {
    const handle = await dir.getFileHandle(name, { create: true });
    const w = await handle.createWritable();
    await w.write(text);
    await w.close();
  }

  async function download(url, size, onBytes, signal) {
    let res;
    try {
      res = await fetch(url, { signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    } catch (err) {
      if (signal && signal.aborted) throw err;
      throw installError('NETWORK', tx('err.hfUnreachable'));
    }
    if (!res.ok) throw installError('HTTP', tx('err.http', { status: res.status }));
    const out = new Uint8Array(size);
    let offset = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.length > size) throw installError('SIZE', tx('err.tooBig'));
      out.set(value, offset);
      offset += value.length;
      onBytes(value.length);
    }
    if (offset !== size) throw installError('SIZE', tx('err.incomplete'));
    return out;
  }

  /**
   * Demande le dossier Lowsper. Doit être appelé directement depuis un clic.
   * Retourne un FileSystemDirectoryHandle vérifié.
   */
  Lowsper.pickLowsperFolder = async function () {
    let dir;
    try {
      // Le navigateur refuse un chemin libre comme point de départ (seulement un dossier connu ou
      // déjà autorisé) : Téléchargements, où Lowsper est le plus souvent décompressé, plutôt que
      // Documents. Avec « id », un dossier déjà choisi une fois reste prioritaire (decision.md §36).
      dir = await window.showDirectoryPicker({ id: 'lowsper', mode: 'readwrite', startIn: 'downloads' });
    } catch (err) {
      if (err && err.name === 'AbortError') throw installError('CANCELLED', tx('err.cancelled'));
      throw installError('PICKER', tx('err.picker', { error: err.message }));
    }
    // Le dossier choisi peut être un dossier parent : « Extraire tout » de Windows crée
    // Lowsper-X.Y.Z\Lowsper-X.Y.Z, et la fenêtre s'ouvre sur Téléchargements. Lowsper y cherche
    // lui-même le dossier de cette page (decision.md §38).
    const found = await Lowsper.findLowsperFolders(dir, pageFolderName());
    if (!found.length) throw installError('WRONG_FOLDER', tx('err.wrongFolder'));
    for (const candidate of found) {
      let same;
      try {
        same = await Lowsper.isPageFolder(candidate);
      } catch (e) {
        throw installError('PICKER', tx('err.cannotWrite', { error: e.message }));
      }
      if (same) return candidate;
    }
    throw installError('OTHER_COPY', tx('err.otherCopy', { folder: Lowsper.pageFolder() }));
  };

  /** Nom du dossier de la page ouverte (ex. « Lowsper-4.2.0 »). */
  function pageFolderName() {
    const p = Lowsper.pageFolder().replace(/[\\/]+$/, '');
    return p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);
  }

  const hasFile = async (dir, name) => {
    try {
      await dir.getFileHandle(name);
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Dossiers contenant Lowsper.html : le dossier choisi lui-même, sinon ses sous-dossiers, sinon
   * les sous-dossiers de ses sous-dossiers dont le nom contient « lowsper » (cas de
   * Téléchargements\Lowsper-X.Y.Z\Lowsper-X.Y.Z). Ceux qui portent le nom du dossier de la page
   * viennent en premier. Parcours borné : un dossier choisi par erreur (Documents...) ne bloque
   * pas la page.
   */
  Lowsper.findLowsperFolders = async function (dir, pageName, limit = 400) {
    if (await hasFile(dir, 'Lowsper.html')) return [dir];
    const want = String(pageName || '').toLowerCase();
    const found = [];
    const deeper = [];
    let seen = 0;
    const subfolders = async function* (d) {
      if (typeof d.values !== 'function') return;
      for await (const h of d.values()) {
        if (++seen > limit) return;
        if (h.kind === 'directory' && !h.name.startsWith('.')) yield h;
      }
    };
    for await (const sub of subfolders(dir)) {
      if (await hasFile(sub, 'Lowsper.html')) found.push(sub);
      else if (sub.name.toLowerCase().includes('lowsper') || sub.name.toLowerCase() === want) deeper.push(sub);
    }
    if (!found.length)
      for (const d of deeper)
        for await (const sub of subfolders(d)) if (await hasFile(sub, 'Lowsper.html')) found.push(sub);
    // Le nom du dossier de la page d'abord, l'ordre du disque ensuite
    return found.sort((a, b) => (b.name.toLowerCase() === want) - (a.name.toLowerCase() === want));
  };

  /**
   * Vérifie que ce dossier est celui de CETTE page (et pas une autre copie de Lowsper) : on y
   * écrit un petit fichier, puis on essaie de le relire depuis la page. Demande l'accord
   * d'écriture déjà donné.
   */
  Lowsper.isPageFolder = async function (dir) {
    const token = Math.random().toString(36).slice(2);
    const name = `.verification-${token}.txt`;
    let same = false;
    let models = null;
    try {
      const app = await dir.getDirectoryHandle('app', { create: true });
      models = await app.getDirectoryHandle('models', { create: true });
      await writeText(models, name, `self.__lowsperProbe=${JSON.stringify(token)};`);
      same = await new Promise((resolve) => {
        const sc = document.createElement('script');
        sc.src = (Lowsper.assetBase || 'app/') + 'models/' + name;
        sc.onload = () => resolve(self.__lowsperProbe === token);
        sc.onerror = () => resolve(false);
        document.head.appendChild(sc);
        setTimeout(() => resolve(false), 5000);
      });
    } finally {
      try {
        if (models) await models.removeEntry(name);
      } catch {}
    }
    return same;
  };

  /**
   * Télécharge et installe un modèle du catalogue dans le dossier fourni.
   * onProgress({ ratio, done, total, file }) ; signal : AbortSignal facultatif.
   */
  Lowsper.installModel = async function (root, entry, onProgress, signal) {
    const app = await root.getDirectoryHandle('app', { create: true });
    const modelsDir = await app.getDirectoryHandle('models', { create: true });
    const dir = await modelsDir.getDirectoryHandle(entry.id, { create: true });

    const total = entry.files.reduce((n, f) => n + f.size, 0);
    let done = 0;
    const texts = {};
    const files = {};

    for (const f of entry.files) {
      const url = `${Lowsper.hfBase || 'https://huggingface.co'}/${entry.repo}/resolve/${entry.revision}/${f.path}`;
      const bytes = await download(
        url,
        f.size,
        (n) => {
          done += n;
          if (onProgress) onProgress({ ratio: done / total, done, total, file: f.path });
        },
        signal
      );
      if ((await sha256(bytes)) !== f.sha256) {
        throw installError('CHECKSUM', tx('err.checksum', { path: f.path }));
      }
      if (f.path.endsWith('.json')) {
        texts[f.path] = new TextDecoder().decode(bytes);
        continue;
      }
      const base = f.path.replace(/^onnx\//, '').replace(/\.onnx$/, '');
      const parts = [];
      for (let i = 0, n = 0; i < bytes.length; i += CHUNK, n++) {
        const name = `${base}.part${n}.txt`;
        const key = `models/${entry.id}/${base}.part${n}`;
        await writeText(dir, name, register(key, JSON.stringify(toBase64(bytes.subarray(i, i + CHUNK)))));
        parts.push({ src: `models/${entry.id}/${name}`, bytes: Math.min(CHUNK, bytes.length - i) });
      }
      files[f.path] = parts;
    }
    await writeText(dir, 'config.txt', register(`models/${entry.id}/config`, JSON.stringify(texts)));

    // L'index est écrit en dernier : une installation interrompue reste invisible.
    const installed = (self.LOWSPER_INSTALLED || []).filter((m) => m.id !== entry.id);
    installed.push({
      id: entry.id,
      label: entry.label,
      dtype: entry.dtype,
      device: entry.device || 'wasm',
      revision: entry.revision,
      config: `models/${entry.id}/config.txt`,
      files,
    });
    await writeText(modelsDir, 'index.txt', `${header}self.LOWSPER_INSTALLED=${JSON.stringify(installed, null, 1)};\n`);
    self.LOWSPER_INSTALLED = installed;
    return installed[installed.length - 1];
  };
})();
