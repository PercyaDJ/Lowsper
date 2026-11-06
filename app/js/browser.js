/*
 * Lowsper : reconnaître le navigateur, pour des messages justes.
 *
 * Brave et Chrome envoient la même identification (« Chrome/... ») : Brave se reconnaît à
 * navigator.brave. Brave désactive par défaut l'écriture dans un dossier choisi (File System
 * Access), Firefox ne l'a pas : le message dit alors quoi faire, au lieu de « utilisez Edge ».
 */
(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const Lowsper = (root.Lowsper = root.Lowsper || {});

  /** Nom du navigateur : 'Brave', 'Microsoft Edge', 'Google Chrome', 'Opera', 'Firefox', 'Chromium' ou 'inconnu'. */
  function name(nav = root.navigator || {}) {
    if (nav.brave) return 'Brave';
    const ua = String(nav.userAgent || '');
    if (/Firefox\//.test(ua)) return 'Firefox';
    const brands = ((nav.userAgentData && nav.userAgentData.brands) || []).map((b) => b.brand);
    for (const b of ['Microsoft Edge', 'Opera', 'Google Chrome']) if (brands.includes(b)) return b;
    if (/Edg\//.test(ua)) return 'Microsoft Edge';
    if (/OPR\//.test(ua)) return 'Opera';
    if (/Chrome\//.test(ua)) return 'Chromium';
    return 'inconnu';
  }

  /** Le navigateur sait-il écrire dans un dossier choisi par l'utilisateur ? */
  const canWriteFolder = (scope = root) => typeof scope.showDirectoryPicker === 'function';

  // Messages dans la langue de l'interface (i18n.js, chargé avant ce fichier)
  const tx = (key, vars) => Lowsper.t(key, vars);

  /**
   * Message quand l'écriture dans un dossier est impossible. purpose : 'model' (installer le
   * modèle) ou 'notes' (dossier d'un profil de sortie).
   */
  function folderMessage(purpose, nav) {
    const browser = name(nav);
    const which = browser === 'Brave' ? 'brave' : browser === 'Firefox' ? 'firefox' : 'other';
    const area = purpose === 'notes' ? 'notes' : 'model';
    return tx(`browser.${area}.${which}`, { flag: tx('browser.braveFlag') });
  }

  Lowsper.Browser = { name, canWriteFolder, folderMessage };
})();
