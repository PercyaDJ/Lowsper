/*
 * Lowsper : sonde de l'IA intégrée du navigateur (expérimental, decision.md §23).
 *
 * Chrome et Edge récents peuvent embarquer un petit modèle de langage (Gemini Nano dans Chrome),
 * exposé aux pages par deux interfaces : Summarizer (résumé) et LanguageModel (Prompt API). La
 * sonde répond à deux questions, sur le PC de l'utilisateur, depuis la page ouverte en file:// :
 *   1. ces interfaces existent-elles, et le navigateur les déclare-t-il utilisables en français ?
 *      (vérification sans rien télécharger) ;
 *   2. sur demande explicite, que vaut le résultat sur une réunion fictive (le corpus « hebdo »
 *      des tests), mesuré avec les mêmes 8 faits que le banc tools/test/eval-summary.mjs ?
 *
 * La sonde ne lit jamais un vrai transcript : seul l'exemple fictif ci-dessous lui est donné.
 * Aucune requête réseau n'est faite par Lowsper ; si le modèle manque, c'est le navigateur qui le
 * télécharge, hors de la page, après le clic de l'utilisateur.
 */
(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const Lowsper = (root.Lowsper = root.Lowsper || {});

  // Réunion fictive « hebdo » (tools/test/corpus/hebdo.truth.json) : [début en s, qui, texte].
  // Un test unitaire vérifie qu'elle reste identique au corpus.
  const SAMPLE = [
    [
      1.5,
      'Claire',
      "Bonjour à tous, on démarre l'hebdo du centre de service. On a beaucoup de sujets aujourd'hui, donc je vous propose d'aller vite sur les indicateurs et de garder du temps pour les incidents de la semaine.",
    ],
    [13.13, 'Claire', 'Julien, tu peux commencer par les KPI ?'],
    [
      16.5,
      'Julien',
      "Oui. Cette semaine on a reçu mille deux cent quarante tickets dans ServiceNow, c'est dix pour cent de plus que la semaine dernière. Le taux de résolution au premier contact est à soixante-huit pour cent, et on a tenu le SLA sur les P1, mais pas sur les P2 : on est à quatre-vingt-sept pour cent pour un objectif de quatre-vingt-quinze.",
    ],
    [34.75, 'Sophie', "Attends, les P2 c'est surtout le week-end."],
    [39.39, 'Julien', "Oui, c'est surtout le samedi, on n'avait qu'une personne d'astreinte."],
    [
      43.81,
      'Vous',
      "Je confirme, j'ai vu passer les alertes du SOC samedi matin, il y avait trois incidents en parallèle sur le VPN.",
    ],
    [
      51.54,
      'Karim',
      "C'est le problème de certificat sur la passerelle VPN. On a fait le correctif lundi, et depuis on n'a plus eu de coupure.",
    ],
    [
      62.35,
      'Nathalie',
      "Est-ce que ça a été validé en CAB ? Parce que je n'ai pas vu passer la demande de changement.",
    ],
    [66.88, 'Karim', "Non, c'était un changement urgent, on régularise cette semaine."],
    [72.38, 'Nathalie', "D'accord, mais il faut vraiment qu'on évite ça. Le RSSI m'a déjà posé la question deux fois."],
    [
      78.38,
      'Thomas',
      "De mon côté, la migration de GLPI vers ServiceNow avance. On a migré les catégories et les groupes d'affectation. Il reste les modèles de réponse et les bases de connaissance, et pour ça j'ai besoin de deux jours avec Élodie la semaine prochaine.",
    ],
    [93.94, 'Elodie', 'Mardi et mercredi, ça me va.'],
    [
      96.74,
      'Marc',
      "Petite remarque sur le MCO : on a toujours les serveurs de l'ancien outil allumés. Si on les coupe à la fin du mois, ça fait des économies, mais il faut l'accord du COPIL.",
    ],
    [107.64, 'Claire', "Je le mets à l'ordre du jour du COPIL de jeudi. Marc, tu m'envoies le chiffrage ?"],
    [116.36, 'Marc', 'Oui, avant mercredi.'],
    [
      119.61,
      'Sophie',
      "J'ai un point sur les ressources. Avec le départ de Kevin, on est en sous-effectif sur le niveau un jusqu'à fin novembre. J'ai demandé un renfort au prestataire, mais rien n'est signé.",
    ],
    [131.13, 'Vous', 'On peut décaler les formations ITSM pour libérer du temps ?'],
    [135.42, 'Sophie', "Oui, c'est une piste. Je regarde avec Claire."],
    [
      140.77,
      'Claire',
      'Très bien. Pour résumer les actions : Karim régularise le changement VPN en CAB, Thomas et Élodie finalisent la migration mardi et mercredi, Marc envoie le chiffrage avant mercredi, et Sophie relance le prestataire pour le renfort.',
    ],
    [155.54, 'Claire', 'Merci à tous, bonne semaine.'],
  ];

  const fmt = (s) => {
    const t = Math.round(s);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(Math.floor(t / 3600))}:${p(Math.floor(t / 60) % 60)}:${p(t % 60)}`;
  };
  /** L'exemple au format des transcripts de Lowsper. */
  const sampleTranscript = () => SAMPLE.map(([s, who, text]) => `**[${fmt(s)}] ${who} :** ${text}`).join('\n\n');

  const SYSTEM = 'Tu es un assistant qui rédige des comptes rendus de réunion fidèles, en français.';
  const CONSIGNE =
    "Voici le transcript automatique d'une réunion (il peut contenir des erreurs de reconnaissance). " +
    'Rédige un compte rendu structuré en français : contexte et participants identifiables, ' +
    'points abordés, décisions prises, actions à mener (qui, quoi, échéance), questions ouvertes. ' +
    "N'invente rien : si un passage est incompréhensible ou ambigu, signale-le.";

  // Faits de l'exemple qu'un bon compte rendu doit contenir (mêmes critères que decision.md §22)
  const FACTS = [
    ['1 240 tickets', /1\s?240|mille deux cent quarante/i],
    ['SLA des P2 à 87 % pour 95 %', /87/],
    ['incident du certificat de la passerelle VPN', /certificat/i],
    ['Karim régularise le changement en CAB', /Karim[^.\n]*(CAB|régularis)|(CAB|régularis)[^.\n]*Karim/i],
    [
      'Thomas et Élodie : migration mardi et mercredi',
      /(Thomas|[ÉE]lodie)[^\n]*(mardi|mercredi)|(mardi|mercredi)[^\n]*(Thomas|[ÉE]lodie)/i,
    ],
    ['Marc envoie le chiffrage avant mercredi', /Marc[^.\n]*chiffrage|chiffrage[^.\n]*Marc/i],
    ['COPIL de jeudi', /COPIL[^.\n]*jeudi|jeudi[^.\n]*COPIL/i],
    [
      'Sophie relance le prestataire (renfort)',
      /Sophie[^.\n]*(prestataire|renfort)|(prestataire|renfort)[^.\n]*Sophie/i,
    ],
  ];
  /** Faits retrouvés dans un texte : { found: [noms], missing: [noms] }. */
  function checkFacts(text) {
    const found = FACTS.filter(([, re]) => re.test(String(text || ''))).map(([n]) => n);
    return {
      found,
      missing: FACTS.map(([n]) => n).filter((n) => !found.includes(n)),
    };
  }

  // Options déclarées au navigateur : entrée et sortie en français
  const SUMMARIZER_OPTIONS = {
    type: 'key-points',
    format: 'markdown',
    length: 'long',
    sharedContext: "Transcript automatique d'une réunion de travail, en français.",
    expectedInputLanguages: ['fr'],
    expectedContextLanguages: ['fr'],
    outputLanguage: 'fr',
  };
  const PROMPT_OPTIONS = {
    expectedInputs: [{ type: 'text', languages: ['fr'] }],
    expectedOutputs: [{ type: 'text', languages: ['fr'] }],
  };

  const APIS = [
    {
      id: 'summarizer',
      name: 'Résumé (Summarizer)',
      global: 'Summarizer',
      options: SUMMARIZER_OPTIONS,
    },
    {
      id: 'prompt',
      name: 'Modèle de langage (Prompt API)',
      global: 'LanguageModel',
      options: PROMPT_OPTIONS,
    },
  ];

  /** Explication d'un état, pour l'utilisateur. */
  const STATES = {
    absent: 'absente de ce navigateur (ou bloquée pour une page ouverte depuis le disque)',
    unavailable:
      "indisponible sur ce PC : matériel insuffisant, espace disque, langue non prise en charge ou désactivée par l'entreprise",
    downloadable: "utilisable, mais le navigateur doit d'abord télécharger son modèle",
    downloading: 'le navigateur télécharge son modèle',
    available: 'disponible',
    timeout: 'pas de réponse du navigateur en 10 s',
    error: 'erreur',
  };
  const usable = (state) => state === 'available' || state === 'downloadable' || state === 'downloading';

  function withTimeout(promise, ms) {
    let timer;
    const late = new Promise((resolve) => (timer = setTimeout(() => resolve({ timeout: true }), ms)));
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
  }

  /**
   * Vérifie chaque interface, sans rien télécharger. Renvoie
   * [{ id, name, state, detail }], state étant l'un des STATES (ou une valeur inconnue renvoyée
   * telle quelle par le navigateur).
   */
  async function probe(scope = root, timeoutMs = 10000) {
    const out = [];
    for (const api of APIS) {
      const Api = scope[api.global];
      const r = { id: api.id, name: api.name, state: 'absent', detail: '' };
      if (Api && typeof Api.availability === 'function') {
        try {
          const v = await withTimeout(Promise.resolve(Api.availability(api.options)), timeoutMs);
          if (v && v.timeout) r.state = 'timeout';
          else r.state = String(v);
        } catch (e) {
          r.state = 'error';
          r.detail = (e && (e.name ? e.name + ' : ' : '') + e.message) || String(e);
        }
      }
      out.push(r);
    }
    return out;
  }

  /**
   * Essai sur la réunion fictive, pour une interface utilisable. À appeler depuis un clic : le
   * navigateur exige un geste de l'utilisateur pour télécharger son modèle. onProgress(fraction)
   * suit ce téléchargement. Renvoie { text, createMs, runMs, facts }.
   */
  async function trial(id, { scope = root, onProgress, signal } = {}) {
    const api = APIS.find((a) => a.id === id);
    const Api = scope[api.global];
    const monitor = (m) =>
      m.addEventListener('downloadprogress', (e) => onProgress && onProgress(Number(e.loaded) || 0));
    const transcript = sampleTranscript();
    const t0 = Date.now();
    let session;
    if (id === 'summarizer') {
      session = await Api.create(Object.assign({}, api.options, { monitor, signal }));
    } else {
      session = await Api.create(
        Object.assign({}, api.options, {
          monitor,
          signal,
          initialPrompts: [{ role: 'system', content: SYSTEM }],
        })
      );
    }
    const t1 = Date.now();
    try {
      const text =
        id === 'summarizer'
          ? await session.summarize(transcript, { signal })
          : await session.prompt(CONSIGNE + '\n\n---\n\n' + transcript, {
              signal,
            });
      return {
        text: String(text),
        createMs: t1 - t0,
        runMs: Date.now() - t1,
        facts: checkFacts(text),
      };
    } finally {
      if (session && typeof session.destroy === 'function') session.destroy();
    }
  }

  /** Rapport en texte brut, à copier : ne contient que l'exemple fictif et l'état du navigateur. */
  function report({ probe: states = [], trials = {}, userAgent = '', protocol = '', secure = null }) {
    const lines = ["Sonde de l'IA intégrée du navigateur (Lowsper)", ''];
    lines.push(`Navigateur : ${userAgent}`);
    lines.push(
      `Page : ${protocol}${secure === null ? '' : secure ? ', contexte sécurisé' : ', contexte non sécurisé'}`
    );
    for (const s of states) lines.push(`${s.name} : ${s.state}${s.detail ? ' (' + s.detail + ')' : ''}`);
    for (const s of states) {
      const t = trials[s.id];
      if (!t) continue;
      lines.push('', `--- Essai : ${s.name} ---`);
      if (t.error) {
        lines.push(`Erreur : ${t.error}`);
        continue;
      }
      lines.push(`Préparation : ${(t.createMs / 1000).toFixed(1)} s ; rédaction : ${(t.runMs / 1000).toFixed(1)} s`);
      lines.push(`Faits retrouvés : ${t.facts.found.length}/${FACTS.length}`);
      if (t.facts.missing.length) lines.push(`Manquants : ${t.facts.missing.join(' ; ')}`);
      lines.push('', t.text);
    }
    return lines.join('\n');
  }

  Lowsper.LocalAI = {
    SAMPLE,
    SYSTEM,
    CONSIGNE,
    FACTS,
    STATES,
    APIS,
    usable,
    sampleTranscript,
    checkFacts,
    probe,
    trial,
    report,
  };
})();
