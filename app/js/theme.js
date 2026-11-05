/*
 * Lowsper : thème clair ou sombre.
 *
 * Par défaut, Lowsper suit le système (clair ou sombre). L'utilisateur peut imposer l'un ou
 * l'autre : son choix est gardé avec les autres réglages (lowsper.opt.theme) et posé sur la page
 * par l'attribut data-theme, que la feuille de style lit. Ce script est chargé dans <head>, avant
 * l'affichage, pour éviter un éclair de la mauvaise couleur.
 */
(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const Lowsper = (root.Lowsper = root.Lowsper || {});
  const KEY = 'lowsper.opt.theme';

  /** Choix enregistré : 'light', 'dark' ou 'auto' (suivre le système). */
  function stored() {
    try {
      const v = root.localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : 'auto';
    } catch {
      return 'auto';
    }
  }

  function systemDark() {
    try {
      return !!root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  }

  /** Thème réellement affiché : 'light' ou 'dark'. */
  function effective(pref = stored()) {
    if (pref === 'auto') return systemDark() ? 'dark' : 'light';
    return pref;
  }

  /** Pose le thème sur un document (la page, ou la mini-fenêtre). */
  function apply(pref = stored(), doc = root.document) {
    if (!doc) return;
    const el = doc.documentElement;
    if (pref === 'auto') delete el.dataset.theme;
    else el.dataset.theme = pref;
  }

  function set(pref) {
    try {
      if (pref === 'light' || pref === 'dark') root.localStorage.setItem(KEY, pref);
      else root.localStorage.removeItem(KEY);
    } catch {
      /* stockage indisponible : le choix vaut pour cette page seulement */
    }
    apply(pref === 'light' || pref === 'dark' ? pref : 'auto');
  }

  /**
   * Bascule clair / sombre depuis le thème affiché. Revenir au thème du système remet le choix
   * sur « automatique » : le changement suivant du système sera de nouveau suivi.
   */
  function toggle() {
    const next = effective() === 'dark' ? 'light' : 'dark';
    set(next === (systemDark() ? 'dark' : 'light') ? 'auto' : next);
    return next;
  }

  Lowsper.Theme = { KEY, stored, effective, apply, set, toggle };
  apply();
})();
