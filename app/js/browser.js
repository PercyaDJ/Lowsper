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

  const BRAVE_FLAG =
    "Brave bloque par défaut l'écriture dans un dossier. Pour l'autoriser : ouvrez brave://flags, " +
    'cherchez « File System Access », choisissez « Enabled », puis relancez Brave.';

  /**
   * Message quand l'écriture dans un dossier est impossible. purpose : 'model' (installer le
   * modèle) ou 'notes' (dossier d'un profil de sortie).
   */
  function folderMessage(purpose, nav) {
    const browser = name(nav);
    if (purpose === 'notes') {
      if (browser === 'Brave') return BRAVE_FLAG + ' En attendant, les notes vont dans les Téléchargements.';
      if (browser === 'Firefox')
        return 'Firefox ne sait pas écrire dans un dossier choisi : les notes vont dans les Téléchargements.';
      return (
        'Ce navigateur ne sait pas écrire dans un dossier choisi : les notes vont dans les Téléchargements. ' +
        'Pour les envoyer dans un dossier, ouvrez Lowsper.html avec Microsoft Edge ou Google Chrome.'
      );
    }
    if (browser === 'Brave')
      return (
        BRAVE_FLAG + ' Autre solution : installez le modèle une fois avec Microsoft Edge, puis revenez dans Brave.'
      );
    if (browser === 'Firefox')
      return (
        'Firefox ne sait pas enregistrer le modèle dans un dossier. Installez-le une fois avec Microsoft Edge ' +
        "ou Google Chrome ; Firefox pourra ensuite transcrire le micro seul (pas le son d'une visio)."
      );
    return "Ce navigateur ne permet pas d'enregistrer le modèle dans un dossier. Ouvrez Lowsper.html avec Microsoft Edge ou Google Chrome.";
  }

  Lowsper.Browser = { name, canWriteFolder, folderMessage };
})();
