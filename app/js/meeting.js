/*
 * Lowsper : contrôle d'état de la réunion, en langage simple (lot R5, decision.md §28).
 *
 * Fonction pure, testée sans navigateur : à partir de ce que mesure app.js (sources captées,
 * dernière parole entendue, pause, moteur, retard du texte), elle dit pour chaque ligne son état
 * ('ok', 'warn' ou 'idle') et la clé du texte à afficher (catalogue i18n.js).
 *
 * Seuils, réglés sur les corpus de test (tools/test/corpus) :
 *   - son de la réunion : alerte après OTHERS_SILENT_MS sans aucune parole détectée. Le plus long
 *     silence naturel des participants est de 8,3 s (« hebdo ») et 7,1 s (« entretien ») ; la marge
 *     couvre les longs moments où vous parlez seul ;
 *   - micro : jamais d'alerte de silence. Vous écoutez souvent longtemps : jusqu'à 80 s de silence
 *     au micro dans « hebdo », sans aucun problème ;
 *   - texte : « à jour » tant que le plus ancien passage en attente a moins de TEXT_LATE_S.
 */
(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const Lowsper = (root.Lowsper = root.Lowsper || {});

  const OTHERS_SILENT_MS = 60000;
  const TEXT_LATE_S = 30;

  /**
   * s : {
   *   me, others : 'on' ou 'off' (source captée ou non) ;
   *   othersWanted : l'option « son des participants » est cochée ;
   *   othersSilentMs : temps depuis la dernière parole entendue dans le son de la réunion ;
   *   paused, engineReady, engineError ;
   *   delayS : âge du plus ancien passage en attente (secondes).
   * }
   * Retourne { me, others, text } : chacun { state, key, vars? } ; others.fix : bouton
   * « Comment corriger » à afficher.
   */
  function checks(s) {
    const me =
      s.me !== 'on'
        ? { state: 'warn', key: 'meet.micOff' }
        : s.paused
          ? { state: 'idle', key: 'meet.paused' }
          : { state: 'ok', key: 'meet.micOk' };

    let others;
    if (s.others !== 'on')
      others = s.othersWanted
        ? { state: 'warn', key: 'meet.soundNone', fix: true }
        : { state: 'idle', key: 'meet.soundOff', fix: false };
    else if (s.paused) others = { state: 'idle', key: 'meet.paused', fix: false };
    else if (s.othersSilentMs > OTHERS_SILENT_MS) others = { state: 'warn', key: 'meet.soundSilent', fix: true };
    else others = { state: 'ok', key: 'meet.soundOk', fix: false };

    const late = Math.round(s.delayS || 0);
    const text =
      !s.engineReady && !s.engineError
        ? { state: 'idle', key: 'meet.textPreparing' }
        : late < TEXT_LATE_S
          ? { state: 'ok', key: 'meet.textOk' }
          : { state: 'warn', key: 'meet.textLate', vars: { s: late } };

    return { me, others, text };
  }

  Lowsper.Meeting = { OTHERS_SILENT_MS, TEXT_LATE_S, checks };
})();
