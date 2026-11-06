/*
 * Lowsper : ce que Lowsper sait du PC, et le modèle à recommander au premier lancement.
 *
 * Fonctions pures (testées sans navigateur), sauf hardware() qui lit le navigateur.
 *   - limits() : nombre de moteurs de transcription selon la puissance choisie (un moteur occupe
 *     un cœur à 100 %). Formule de decision.md §15.12, utilisée aussi pendant les réunions.
 *   - choose() : modèles proposés, utilisables ou non (avec la raison), et le recommandé
 *     (decision.md §26).
 */
(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const Lowsper = (root.Lowsper = root.Lowsper || {});

  /**
   * Moteurs autorisés : { start, normal, boost, max }.
   * threads : navigator.hardwareConcurrency ; memory : navigator.deviceMemory (Go, arrondi) ;
   * power : 'eco', 'balanced' ou 'max' ; device : 'webgpu' ou 'wasm'.
   */
  function limits(threads, memory, power, device) {
    if (device === 'webgpu') return { start: 1, normal: 1, boost: 1, max: 1 };
    threads = threads || 4;
    memory = memory || 8;
    const memCap = memory < 4 ? 1 : memory < 8 ? 2 : 6;
    const clamp = (n) => Math.max(1, Math.min(memCap, n));
    if (power === 'eco') return { start: 1, normal: 1, boost: 1, max: 1 };
    if (power === 'max') {
      const n = clamp(Math.floor(threads / 2));
      return { start: Math.min(n, 3), normal: n, boost: n, max: n };
    }
    const normal = clamp(Math.ceil(threads / 4));
    const boost = clamp(Math.max(normal, Math.floor(threads / 3)));
    return { start: normal, normal, boost, max: boost };
  }

  /**
   * Charge mesurée d'une réunion où l'on parle sans arrêt, selon le nombre de moteurs au travail
   * en même temps (1 = juste suffisant). Mesures de decision.md §26 (npm run bench -- --cores),
   * sur la machine de développement : processeur lent, sans carte graphique. Au-delà du dernier
   * nombre mesuré, la charge par moteur est supposée rester celle du dernier mesuré.
   */
  const MEASURED = {
    'whisper-small': [1.44, 0.72, 0.47, 0.39],
    'whisper-base': [0.51, 0.27, 0.18, 0.14],
  };

  /** Charge estimée d'un modèle avec n moteurs, ou null si le modèle n'a pas été mesuré. */
  function estimatedLoad(id, n) {
    const m = MEASURED[id];
    if (!m || !m.length) return null;
    if (n <= m.length) return m[n - 1];
    const perEngine = m[m.length - 1] * m.length; // charge d'un moteur, au dernier palier mesuré
    return perEngine / n;
  }

  /** Ce que la page sait du PC. gpu : résultat de Lowsper.detectWebGPU() (null si aucune carte). */
  function hardware(nav = root.navigator || {}, gpu = null) {
    return {
      threads: nav.hardwareConcurrency || null,
      memory: nav.deviceMemory || null,
      gpu: gpu || null,
    };
  }

  /**
   * Modèles proposés au premier lancement.
   * catalog : manifeste (id, device, files) ; hw : hardware() ; installed : identifiants installés.
   * Retourne { recommended, options: [{ id, usable, reason, installed }] }. reason : 'gpu'
   * (aucune carte graphique compatible) ou null.
   * Règle : les modèles « carte graphique » ne sont jamais recommandés (vitesse non mesurée) ;
   * Whisper small est recommandé s'il suit le direct avec les moteurs de la puissance
   * « équilibrée », sinon Whisper base.
   */
  function choose(catalog, hw, installed) {
    const done = new Set(installed || []);
    const options = (catalog || []).map((m) => {
      const needsGpu = m.device === 'webgpu';
      const usable = !needsGpu || !!hw.gpu;
      return { id: m.id, usable, reason: usable ? null : 'gpu', installed: done.has(m.id) };
    });
    const has = (id) => options.some((o) => o.id === id && o.usable);
    const n = limits(hw.threads, hw.memory, 'balanced', 'wasm').normal;
    const small = estimatedLoad('whisper-small', n);
    let recommended = null;
    if (has('whisper-small') && (small === null || small <= 1)) recommended = 'whisper-small';
    else if (has('whisper-base')) recommended = 'whisper-base';
    else if (has('whisper-small')) recommended = 'whisper-small';
    return { recommended, options, workers: n, load: small };
  }

  Lowsper.Recommend = { limits, MEASURED, estimatedLoad, hardware, choose };
})();
