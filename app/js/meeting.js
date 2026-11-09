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
   *   micMuted : micro coupé par l'utilisateur (decision.md §53) ;
   *   delayS : âge du plus ancien passage en attente (secondes).
   * }
   * Retourne { me, others, text } : chacun { state, key, vars? } ; others.fix : bouton
   * « Comment corriger » à afficher.
   */
  function checks(s) {
    const me =
      s.me !== 'on'
        ? { state: 'warn', key: 'meet.micOff' }
        : s.micMuted
          ? { state: 'idle', key: 'meet.micMuted' }
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

  /*
   * Son de la réunion muet (decision.md §55). Un chemin de Windows peut ouvrir une piste sans
   * erreur qui ne laisse passer aucun son : sur le PC d'entreprise du mainteneur (Windows 11 24H2,
   * Edge 156), le son de toutes les applications et celui d'une fenêtre donnaient un niveau
   * inférieur à 0,0005 pendant que le son du système donnait 0,383. Le chemin est jugé muet
   * quand aucun bloc n'a atteint SOUND_RMS pendant SOUND_MUTED_S depuis l'ouverture.
   */
  const SOUND_RMS = 0.0005;
  const SOUND_MUTED_S = 20;

  /**
   * s : { attempt : chemin ouvert ('apps', 'screen', 'simple', 'tab'), heard : du son est passé,
   * elapsedS : secondes depuis l'ouverture, offered : déjà proposé pour ce partage }.
   */
  function soundMuted(s) {
    return !!s.attempt && !s.heard && !s.offered && s.elapsedS >= SOUND_MUTED_S;
  }

  /**
   * Chemins à proposer, dans l'ordre, quand le chemin `failed` a échoué ou reste muet. Chaque
   * chemin passe par un mécanisme différent de Windows (§51) : un PC qui en ferme un laisse en
   * général passer un autre. Le son de toutes les applications n'est proposé que si le
   * navigateur connaît restrictOwnAudio.
   */
  function soundOffers(failed, canRestrict) {
    const all = ['apps', 'screen', 'tab'].filter((m) => m !== 'apps' || canRestrict);
    const same = failed === 'simple' || failed === 'system' ? 'screen' : failed;
    return all.filter((m) => m !== same);
  }

  /**
   * Préférence à retenir quand du son est vraiment passé par le chemin `attempt`. 'system' : le
   * son du système, retenu même sous Windows 11, où le son de toutes les applications est
   * demandé d'emblée sinon. null : ne rien changer (l'onglet dépend de la visio du jour).
   */
  function soundLearned(attempt, windows11, canRestrict) {
    if (attempt === 'apps') return 'apps';
    if (attempt === 'screen' || attempt === 'simple' || attempt === 'system')
      return windows11 && canRestrict ? 'system' : 'screen';
    return null;
  }

  Lowsper.Meeting = {
    OTHERS_SILENT_MS,
    TEXT_LATE_S,
    SOUND_RMS,
    SOUND_MUTED_S,
    checks,
    soundMuted,
    soundOffers,
    soundLearned,
  };
})();
