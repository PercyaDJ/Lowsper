/*
 * Lowsper : langue de l'interface (français ou anglais).
 *
 * - Langue : le choix mémorisé (lowsper.opt.lang), sinon celle du navigateur : « fr... » donne le
 *   français, toute autre langue l'anglais (docs/refonte.md §1).
 * - t(clé, variables, langue) : texte du catalogue. Une entrée est une chaîne, où {nom} est
 *   remplacé par variables.nom, ou une fonction (variables) => chaîne, pour les pluriels.
 * - Textes fixes de Lowsper.html : attribut data-i18n (texte seul), data-i18n-html (texte avec
 *   balises <strong>, <em>, <code>), data-i18n-attr (« placeholder:clé;title:clé »). Le HTML
 *   garde le texte français : la page reste lisible sans script, et un test vérifie qu'il est
 *   identique au catalogue français.
 * - Les catalogues ne contiennent que du texte écrit ici : jamais de saisie de l'utilisateur, ce
 *   qui permet data-i18n-html sans risque d'injection.
 *
 * Ce fichier n'a aucune dépendance : il est chargé avant les autres scripts, et aussi par les
 * tests sans navigateur.
 */
(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const Lowsper = (root.Lowsper = root.Lowsper || {});
  const KEY = 'lowsper.opt.lang';
  const LANGS = ['fr', 'en'];

  // Accord de nombre : un seul mot à changer, en français (« 2 passages ») comme en anglais.
  const s = (n, plural = 's') => (n > 1 ? plural : '');
  const sEn = (n, plural = 's') => (n === 1 ? '' : plural);

  // ---------------------------------------------------------------------------
  // Catalogue français : le texte de Lowsper 3.5.0, au caractère près.
  // ---------------------------------------------------------------------------
  const fr = {
    // --- Page : bandeau, en-tête ---
    'engine.preparing': 'Préparation du moteur',
    'engine.preparingPct': 'Préparation du moteur {pct} %',
    'engine.starting': 'Démarrage du moteur',
    'engine.ready': 'Moteur prêt',
    'engine.incompatible': 'Navigateur non compatible',
    'engine.toInstall': 'Modèle à installer',
    'engine.unavailable': 'Moteur indisponible',
    'engine.downloading': 'Téléchargement du modèle',
    'engine.installStopped': 'Installation interrompue',
    'theme.title': 'Thème clair ou sombre',
    'theme.toDark': 'Passer en thème sombre',
    'theme.toLight': 'Passer en thème clair',
    'settings.title': 'Paramètres',
    'settings.close': 'Fermer les paramètres',

    // --- Paramètres : transcription ---
    'set.transcription': 'Transcription',
    'set.language': 'Langue parlée',
    'set.language.fr': 'Français',
    'set.language.en': 'Anglais',
    'set.language.auto': 'Français et anglais (détection automatique)',
    'set.glossary': 'Sigles et noms propres de vos réunions <em>(aide la reconnaissance, conservé sur ce poste)</em>',
    'set.glossaryPlaceholder': 'Ex. RSSI, COMEX, KPI, RGPD, NIS 2, projet Atlas, Mme Durand',
    'set.vocab': 'Vocabulaire métier intégré <em>(sigles et termes du domaine, en plus des vôtres)</em>',
    'set.withOthers': "Capter aussi le son des participants (partage d'écran)",
    'set.withOthersUnsupported': "Ce navigateur ne permet pas de capter le son d'une autre application.",
    'set.distinguish': 'Distinguer les intervenants (Intervenant 1, 2, 3...)',
    'set.autopip': "Réduire Lowsper en mini-fenêtre dès le début de l'enregistrement",
    'set.showBefore': 'Afficher « Avant de commencer » avant chaque réunion',
    'set.fixes': 'Mots que Whisper déforme <em>(corrigés automatiquement dans chaque transcript)</em>',
    'set.fixWrong': 'Mal reconnu (ex. Kalmar)',
    'set.fixRight': 'Bonne écriture (ex. CALMAR)',
    'set.fixAdd': 'Ajouter',
    'set.fixForget': 'Oublier cette correction',
    'set.keep': 'Conserver mes réglages dans le dossier Lowsper',
    'set.savedLine': (v) =>
      `Réglages copiés dans le dossier Lowsper (${v.when}) : ils survivent à un nettoyage du navigateur.` +
      (v.dirty ? ' Les dernières modifications seront copiées à la fermeture de ce panneau.' : ''),
    'set.notSaved':
      'Vos réglages sont gardés par le navigateur. Certains postes d’entreprise les effacent à la fermeture : conservez-les aussi dans le dossier Lowsper.',
    'set.kept': 'Réglages conservés dans le dossier Lowsper.',
    'set.restored':
      'Vos réglages (sigles, préférences) ont été restaurés depuis le dossier Lowsper : le navigateur les avait effacés.',

    // --- Paramètres : profils de sortie ---
    'prof.title': 'Profils de sortie',
    'prof.intro':
      "Où et sous quelle forme arrive la note de chaque réunion, par exemple directement dans votre base de notes. Le profil se choisit sur l'écran d'accueil.",
    'prof.edit': 'Profil à modifier',
    'prof.new': 'Nouveau profil',
    'prof.delete': 'Supprimer ce profil',
    'prof.name': 'Nom du profil',
    'prof.folder': 'Dossier de destination',
    'prof.folderPick': 'Choisir le dossier',
    'prof.folderClear': 'Revenir aux Téléchargements',
    'prof.syncWarning':
      'Un dossier synchronisé en ligne (stockage en ligne, synchronisation de votre base de notes) fera quitter la note de cet ordinateur.',
    'prof.prompt': 'Consigne proposée par « Obtenir un résumé »',
    'prof.classic': 'Format classique de Lowsper (sans modèle ni propriétés)',
    'prof.fileName': 'Nom du fichier <em>(variables possibles, ex. {{date}} {{titre}})</em>',
    'prof.front': 'Propriétés en tête de note (front matter)',
    'prof.frontOn': 'Ajouter des propriétés',
    'prof.tags': 'Étiquettes, séparées par des virgules',
    'prof.extra': 'Champs libres, un par ligne <em>(clé: valeur ; variables possibles)</em>',
    'prof.links': 'Écrire les intervenants nommés en liens <code>[[Nom]]</code>',
    'prof.template': 'Modèle de note',
    'prof.templateReset': 'Rétablir le modèle par défaut',
    'prof.vars': 'Variables disponibles',
    'prof.default': 'Par défaut',
    'prof.fallbackName': 'Profil',
    'prof.inFolder': ' (dossier « {folder} »)',
    'prof.folderNamed': 'Dossier « {folder} »',
    'prof.downloads': 'Vos Téléchargements',
    'prof.unknownVars': 'Variable inconnue, laissée telle quelle : {list}.',
    'prof.badExtra': 'Champ libre ignoré (il faut « clé: valeur ») : {list}.',
    'prof.example': 'Exemple : {name}',
    'prof.deleteConfirm': 'Supprimer le profil « {name} » ? Les notes déjà enregistrées restent dans leur dossier.',
    'prof.access.ask':
      'Les notes du profil « {name} » vont dans le dossier « {folder} » : le navigateur demande votre accord.',
    'prof.access.allow': 'Autoriser maintenant',
    'prof.access.forgotten':
      'Le navigateur a oublié le dossier « {folder} » du profil « {name} » (données de navigation effacées ?). En attendant, les notes vont dans vos Téléchargements.',
    'prof.access.repick': 'Désigner à nouveau le dossier',
    'prof.folderError': "Impossible d'utiliser ce dossier : {error}",
    // Variables des modèles (notes.js)
    'var.titre': 'nom de la réunion, ou du fichier importé',
    'var.date': 'date de la réunion, AAAA-MM-JJ',
    'var.date_longue': 'date en toutes lettres (jeudi 5 novembre 2026)',
    'var.heure': 'heure de début, HHhMM (utilisable dans un nom de fichier)',
    'var.heure_debut': 'heure de début, HH:MM',
    'var.duree': 'durée (61 min)',
    'var.intervenants': 'intervenants, séparés par des virgules',
    'var.source': 'réunion en direct, ou fichier « nom »',
    'var.modele': 'modèle de transcription',
    'var.langue': 'langue parlée',
    'var.profil': 'nom du profil',
    'var.en_tete': "lignes d'informations du format classique (date, horaires, couverture...)",
    'var.avertissement': 'rappel sur la fiabilité de la transcription automatique',
    'var.transcript': 'les interventions horodatées',
    'var.transcript_complet': 'tout le format classique de Lowsper',
    'front.date': 'date',
    'front.duree': 'durée (minutes)',
    'front.intervenants': 'intervenants',
    'front.source': 'source',
    'front.modele': 'modèle',

    // --- Paramètres : consignes pour l'IA ---
    'ai.title': "Consignes pour l'IA",
    'ai.intro':
      "Texte placé devant la note par « Obtenir un résumé », pour demander un compte rendu à l'assistant de votre choix. Variables possibles, comme dans les modèles de note ; <code>{{note}}</code> place la note ailleurs qu'à la fin.",
    'ai.edit': 'Consigne à modifier',
    'ai.new': 'Nouvelle consigne',
    'ai.name': 'Nom',
    'ai.text': 'Texte de la consigne',
    'ai.modified': ' (modifiée)',
    'ai.restore': 'Rétablir le texte d’origine',
    'ai.delete': 'Supprimer cette consigne',
    'ai.deleteConfirm': 'Supprimer la consigne « {name} » ?',
    'ai.fallbackName': 'Consigne',
    'ai.choice': "Consigne pour l'IA",
    'prompt.compte-rendu.name': 'Compte rendu de réunion',
    'prompt.compte-rendu.text':
      '# Rôle\n' +
      'Tu rédiges des comptes rendus de réunion exacts et utiles.\n' +
      '\n' +
      '# Contexte\n' +
      "Ci-dessous figure le transcript automatique d'une réunion, enregistrée et transcrite par Lowsper sur l'ordinateur de l'utilisateur.\n" +
      '- Il peut contenir des erreurs de reconnaissance vocale.\n' +
      "- « Vous » est la personne qui a enregistré. Les autres personnes peuvent apparaître sous la forme « Intervenant 1 », « Intervenant 2 »... quand leur nom n'est pas connu.\n" +
      "- Les heures sont comptées depuis le début de l'enregistrement.\n" +
      '\n' +
      '# Tâche\n' +
      'Rédige le compte rendu dans la langue principale du transcript, avec ces sections :\n' +
      '1. Résumé : 3 à 5 phrases.\n' +
      "2. Participants : noms ou étiquettes tels qu'ils apparaissent.\n" +
      '3. Sujets abordés.\n' +
      '4. Décisions prises.\n' +
      '5. Actions à mener : qui, quoi, échéance. Écris « non précisé » quand une information manque.\n' +
      '6. Questions ouvertes.\n' +
      '\n' +
      '# Règles\n' +
      "- N'utilise que ce qui figure dans le transcript. N'invente jamais un nom, un chiffre ou une date.\n" +
      '- Recopie les chiffres exactement.\n' +
      '- Quand un passage est peu clair ou semble mal reconnu, signale-le au lieu de deviner.\n' +
      '- Sois concis. Utilise des listes à puces.\n' +
      '\n' +
      '# Transcript\n' +
      '{{note}}',
    'prompt.synthese-appel.name': "Synthèse d'appel",
    'prompt.synthese-appel.text':
      '# Rôle\n' +
      "Tu rédiges des synthèses d'appel exactes et utiles.\n" +
      '\n' +
      '# Contexte\n' +
      "Ci-dessous figure le transcript automatique d'un appel, enregistré et transcrit par Lowsper sur l'ordinateur de l'utilisateur.\n" +
      '- Il peut contenir des erreurs de reconnaissance vocale.\n' +
      "- « Vous » est la personne qui a enregistré. Les autres personnes peuvent apparaître sous la forme « Intervenant 1 », « Intervenant 2 »... quand leur nom n'est pas connu.\n" +
      "- Les heures sont comptées depuis le début de l'enregistrement.\n" +
      '\n' +
      '# Tâche\n' +
      'Rédige la synthèse dans la langue principale du transcript, avec ces sections :\n' +
      "1. Objet de l'appel : 1 à 2 phrases.\n" +
      "2. Participants : noms ou étiquettes tels qu'ils apparaissent.\n" +
      '3. Points clés.\n' +
      '4. Engagements pris de part et d’autre.\n' +
      '5. Prochaines étapes : qui, quoi, date. Écris « non précisé » quand une information manque.\n' +
      '\n' +
      '# Règles\n' +
      "- N'utilise que ce qui figure dans le transcript. N'invente jamais un nom, un chiffre ou une date.\n" +
      '- Recopie les chiffres exactement.\n' +
      '- Quand un passage est peu clair ou semble mal reconnu, signale-le au lieu de deviner.\n' +
      '- Sois concis. Utilise des listes à puces.\n' +
      '\n' +
      '# Transcript\n' +
      '{{note}}',
    'prompt.actions.name': "Liste d'actions",
    'prompt.actions.text':
      '# Rôle\n' +
      'Tu relèves avec exactitude les actions décidées en réunion.\n' +
      '\n' +
      '# Contexte\n' +
      "Ci-dessous figure le transcript automatique d'une réunion, enregistrée et transcrite par Lowsper sur l'ordinateur de l'utilisateur.\n" +
      '- Il peut contenir des erreurs de reconnaissance vocale.\n' +
      "- « Vous » est la personne qui a enregistré. Les autres personnes peuvent apparaître sous la forme « Intervenant 1 », « Intervenant 2 »... quand leur nom n'est pas connu.\n" +
      "- Les heures sont comptées depuis le début de l'enregistrement.\n" +
      '\n' +
      '# Tâche\n' +
      'Relève uniquement les actions à mener, dans la langue principale du transcript, sous forme de tableau avec ces colonnes :\n' +
      '1. Action.\n' +
      '2. Responsable.\n' +
      '3. Échéance.\n' +
      '4. Source : la phrase du transcript qui la justifie, avec son heure.\n' +
      "Écris « non précisé » quand le responsable ou l'échéance n'est pas dit explicitement.\n" +
      '\n' +
      '# Règles\n' +
      "- N'utilise que ce qui figure dans le transcript. N'invente jamais un nom, un chiffre ou une date.\n" +
      '- Recopie les chiffres exactement.\n' +
      '- Quand un passage est peu clair ou semble mal reconnu, signale-le au lieu de deviner.\n' +
      '- Sois concis.\n' +
      '\n' +
      '# Transcript\n' +
      '{{note}}',

    // --- Paramètres : IA intégrée du navigateur ---
    'lai.title': 'IA intégrée du navigateur (expérimental)',
    'lai.intro':
      "Chrome et Edge récents peuvent embarquer un petit modèle de langage qui rédige des résumés sur le PC, sans service en ligne, si le matériel le permet. La vérification ne télécharge rien et ne lit aucun de vos transcripts ; l'essai porte sur une réunion fictive.",
    'lai.probe': 'Vérifier ce PC',
    'lai.trial': 'Essayer sur une réunion fictive',
    'lai.stop': 'Arrêter',
    'lai.copy': 'Copier le rapport',
    'lai.progress': 'Téléchargement du modèle par le navigateur',
    'lai.checking': 'Vérification…',
    'lai.usableHere':
      'Le navigateur déclare pouvoir travailler en français sur ce PC. L’essai dira ce que vaut le résultat.',
    'lai.notUsable': 'L’IA intégrée n’est pas utilisable ici. « Obtenir un résumé » reste disponible.',
    'lai.downloadConfirm':
      'Le navigateur doit d’abord télécharger son modèle de langage. Ce téléchargement est fait par le navigateur, pas par Lowsper, et demande au moins 22 Go d’espace libre (documentation de Chrome). Continuer ?',
    'lai.writing': '{name} : rédaction du compte rendu de la réunion fictive…',
    'lai.downloadPct': 'Téléchargement du modèle par le navigateur : {pct} %',
    'lai.stopped': 'Essai arrêté.',
    'lai.done': 'Essai terminé. « Copier le rapport » ne contient que la réunion fictive et l’état du navigateur.',
    'lai.unexpected': 'réponse inattendue du navigateur (« {state} »)',
    'lai.api.summarizer': 'Résumé (Summarizer)',
    'lai.api.prompt': 'Modèle de langage (Prompt API)',
    'lai.state.absent': 'absente de ce navigateur (ou bloquée pour une page ouverte depuis le disque)',
    'lai.state.unavailable':
      "indisponible sur ce PC : matériel insuffisant, espace disque, langue non prise en charge ou désactivée par l'entreprise",
    'lai.state.downloadable': "utilisable, mais le navigateur doit d'abord télécharger son modèle",
    'lai.state.downloading': 'le navigateur télécharge son modèle',
    'lai.state.available': 'disponible',
    'lai.state.timeout': 'pas de réponse du navigateur en 10 s',
    'lai.state.error': 'erreur',
    'lai.report.title': "Sonde de l'IA intégrée du navigateur (Lowsper)",
    'lai.report.browser': 'Navigateur détecté : {browser}',
    'lai.report.ua': 'Identification : {ua}',
    'lai.report.page': 'Page : {protocol}',
    'lai.report.secure': ', contexte sécurisé',
    'lai.report.insecure': ', contexte non sécurisé',
    'lai.report.trial': '--- Essai : {name} ---',
    'lai.report.error': 'Erreur : {error}',
    'lai.report.times': 'Préparation : {create} s ; rédaction : {run} s',
    'lai.report.facts': 'Faits retrouvés : {found}/{total}',
    'lai.report.missing': 'Manquants : {list}',

    // --- Paramètres : affichage, modèle, performance, voix ---
    'set.look': 'Affichage',
    'set.theme': 'Thème',
    'set.theme.auto': 'Automatique (comme le système)',
    'set.theme.light': 'Clair',
    'set.theme.dark': 'Sombre',
    'set.uiLang': "Langue de l'interface",
    'set.uiLangBusy': 'La langue se change en dehors d’une réunion ou d’une transcription en cours.',
    'set.model': 'Modèle',
    'set.modelSelect': 'Modèle de transcription',
    'set.addModel': 'Installer ou ajouter des modèles',
    'set.modelCurrent': 'Modèle utilisé : {current}. Installés sur ce poste : {list}.',
    'set.noModel': 'Aucun modèle installé pour l’instant.',
    'set.perf': 'Performance',
    'set.power': 'Puissance de calcul <em>(part du processeur utilisée pour transcrire)</em>',
    'set.power.eco': 'Économe : 1 cœur, la transcription peut prendre du retard',
    'set.power.balanced': 'Équilibrée : laisse de la marge à Teams, Office... (conseillé)',
    'set.power.max': 'Maximale : le plus de direct possible, PC plus sollicité',
    'set.speedTest': 'Mesurer la vitesse de ce PC avec le modèle actuel',
    'set.voices': 'Voix des intervenants',
    'set.memory': 'Mémoriser les voix des intervenants que je nomme, pour les reconnaître aux réunions suivantes',
    'set.memoryWarn':
      "Une empreinte vocale est une donnée biométrique : à n'activer qu'avec l'accord des personnes concernées. Seule une empreinte (une suite de nombres, pas d'enregistrement) est conservée, uniquement sur ce poste.",
    'set.memoryDays': 'Effacement automatique',
    'set.memoryDays.30': 'après 1 mois',
    'set.memoryDays.90': 'après 3 mois',
    'set.memoryDays.180': 'après 6 mois',
    'set.memoryClear': 'Effacer les voix mémorisées',
    'memory.list': (v) => `${v.n} voix mémorisée${s(v.n)} : ${v.names}.`,
    'memory.none': 'Aucune voix mémorisée pour l’instant. Nommez les intervenants à la fin d’une réunion.',
    'memory.confirm':
      'Mémoriser les voix ?\n\nUne empreinte vocale est une donnée biométrique (RGPD). ' +
      "Ne l'activez qu'avec l'accord des personnes concernées. Les empreintes restent uniquement sur ce poste " +
      'et sont effacées automatiquement après la durée choisie.',
    'memory.clearConfirm': 'Effacer définitivement toutes les voix mémorisées ?',
    'memory.cleared': 'Voix mémorisées effacées.',

    // --- Vitesse ---
    'speed.last': "Dernière mesure : charge estimée {pct} % pour une réunion où l'on parle sans arrêt.",
    'speed.notReady': 'Le moteur n’est pas encore prêt.',
    'speed.measuring': 'Mesure en cours (quelques secondes à une minute)…',
    'speed.comfortable': 'Très confortable : la transcription suivra la réunion en direct.',
    'speed.ok': 'Correct : la transcription suit la réunion, avec un léger décalage quand ça parle beaucoup.',
    'speed.tight':
      "Juste : lors d'échanges très denses, la transcription prendra du retard puis le rattrapera dans les silences.",
    'speed.fastLane':
      'Lors des échanges denses, la voie rapide prendra le relais pour garder le direct, et les passages concernés seront retranscrits précisément ensuite.',
    'speed.tooSlow':
      'Trop lent pour suivre en direct : installez Whisper base (Options, « Installer un autre modèle ») pour activer la voie rapide, ou choisissez un modèle plus rapide.',
    'speed.result': (v) =>
      `${v.model} : environ ${v.perMin} s de calcul par minute de parole continue ` +
      `(charge estimée ${v.pct} % avec ${v.n} moteur${s(v.n)}` +
      (v.boost ? `, ${v.boost} en renfort` : '') +
      (v.fast ? ', plus la voie rapide en secours' : '') +
      `). ${v.advice}`,
    'speed.failed': 'Mesure impossible : {error}',

    // --- Session interrompue ---
    'recover.title': "Une réunion précédente n'a pas été terminée",
    'recover.saved': 'Son transcript a été sauvegardé.',
    'recover.download': 'Télécharger ce transcript',
    'recover.dismiss': 'Ignorer',
    'recover.info': '{date} à {time}, {min} min transcrites',

    // --- Installation du modèle ---
    'install.temp':
      '<strong>Lowsper semble ouvert directement depuis le fichier zip.</strong> Windows le place alors dans un dossier temporaire, et le modèle serait à retélécharger à chaque fois.\n        Fermez cette page, faites un clic droit sur le zip, « Extraire tout », puis ouvrez Lowsper.html depuis le dossier extrait.',
    'install.title': 'Bienvenue dans Lowsper',
    'install.lead':
      'Une dernière étape : télécharger la reconnaissance vocale. Une seule fois, ensuite tout fonctionne hors ligne.',
    'install.titleAdd': 'Ajouter un modèle',
    'install.leadAdd': 'Le modèle choisi est téléchargé une fois, puis rangé à côté des autres.',
    'install.detected': 'Détecté sur ce PC',
    'install.threads': (v) => `${v.n} processeur${s(v.n)} logique${s(v.n)}`,
    'install.memory': '{n} Go de mémoire ou plus',
    'install.gpuYes': 'Carte graphique trouvée',
    'install.gpuNo': 'Aucune carte graphique trouvée',
    'install.gpuChecking': 'Recherche d’une carte graphique…',
    'install.choose': 'Choisir un modèle',
    'install.best': 'Le meilleur pour ce PC',
    'install.installed': 'installé',
    'install.reasonGpu': 'Demande une carte graphique : aucune trouvée sur ce PC.',
    'install.withBackup': 'Inclut un modèle de secours plus rapide.',
    'install.size': '{mb} Mo',
    'install.savedNext': 'Enregistré à côté de Lowsper.html',
    'install.button': 'Télécharger et installer',
    'install.cta': 'Télécharger et installer ({mb} Mo)',
    'install.nothing': 'Tous les modèles utilisables sont déjà installés',
    'install.hint': 'Votre navigateur va ouvrir une fenêtre : choisissez ce dossier, puis validez.',
    'install.more': 'Déjà installé ailleurs, ou PC sans Internet ?',
    'model.label.whisper-small': 'Whisper small',
    'model.label.whisper-small-gpu': 'Whisper small (carte graphique)',
    'model.label.whisper-turbo': 'Whisper large-v3 turbo',
    'model.label.whisper-base': 'Whisper base',
    'model.short.whisper-small': 'Précis.',
    'model.short.whisper-small-gpu': 'Le même que Whisper small, calculé par la carte graphique.',
    'model.short.whisper-turbo': 'Le plus précis.',
    'model.short.whisper-base': 'Plus rapide, moins précis. Pour les PC anciens ou très chargés.',
    'install.back': 'Retour',
    'install.preparing': 'Préparation…',
    'install.already':
      "<strong>Vous aviez déjà installé le modèle</strong> dans une version précédente de Lowsper ? Inutile de le retélécharger : copiez le dossier <code>app\\models</code> de l'ancien dossier Lowsper dans celui-ci (remplacez le dossier existant), puis rechargez la page (F5).",
    'install.source':
      "Le téléchargement se fait depuis Hugging Face (huggingface.co), à une version figée, et chaque fichier est vérifié par empreinte numérique. Pour équiper un poste sans accès à Internet, copiez le dossier Lowsper d'un poste déjà installé.",
    'install.running': 'Installation en cours…',
    'install.progress': '{done} / {total} Mo · {speed} Mo/s',
    'install.left': ' · environ {left} restantes',
    'install.doneOne': 'Modèle installé. Démarrage…',
    'install.doneMany': 'Modèles installés. Démarrage…',
    'install.network':
      " Le réseau de l'entreprise bloque peut-être ce site. Essayez depuis un autre réseau (partage de connexion, domicile), " +
      "ou copiez le dossier Lowsper d'un collègue qui l'a déjà installé.",
    'install.busy': 'Terminez la réunion en cours avant d’installer un modèle.',
    // --- Erreurs de l'installateur (installer.js) ---
    'err.hfUnreachable': 'Hugging Face est injoignable depuis ce réseau.',
    'err.http': 'Téléchargement refusé (HTTP {status}).',
    'err.tooBig': 'Fichier plus gros que prévu.',
    'err.incomplete': 'Téléchargement incomplet.',
    'err.cancelled': 'Sélection annulée.',
    'err.picker': "Le navigateur n'autorise pas l'accès à ce dossier : {error}",
    'err.wrongFolder':
      'Ce dossier ne contient pas Lowsper.html. Choisissez le dossier Lowsper lui-même (celui où se trouve Lowsper.html).',
    'err.cannotWrite': "Impossible d'écrire dans ce dossier : {error}",
    'err.otherCopy':
      'Ce dossier est une autre copie de Lowsper que celle ouverte dans cette page. ' +
      'Choisissez le dossier qui contient la page actuellement ouverte : {folder}',
    'err.checksum': 'Fichier altéré ou inattendu : {path}. Installation annulée.',

    // --- Erreurs du moteur (engine.js, analyzer.js) ---
    'err.fileMissing': 'Fichier introuvable : {src}',
    'err.contentMissing': 'Contenu manquant : {src}',
    'err.noManifest': 'app/manifest.js introuvable : le dossier est incomplet.',
    'err.noModel': 'Aucun modèle installé.',
    'err.engine': 'Erreur du moteur : {error}',
    'err.analyzer': "Erreur de l'analyse audio : {error}",
    'err.unknown': 'inconnue',
    'err.notResponding': 'le moteur ne répond plus',

    // --- Navigateur (browser.js) ---
    'browser.tooOld': 'Ce navigateur est trop ancien. Utilisez Microsoft Edge ou Google Chrome à jour.',
    'browser.noMic':
      "Ce navigateur n'autorise pas l'accès au micro depuis un fichier local. Utilisez Microsoft Edge ou Google Chrome.",
    'browser.braveFlag':
      "Brave bloque par défaut l'écriture dans un dossier. Pour l'autoriser : ouvrez brave://flags, " +
      'cherchez « File System Access », choisissez « Enabled », puis relancez Brave.',
    'browser.notes.brave': '{flag} En attendant, les notes vont dans les Téléchargements.',
    'browser.notes.firefox':
      'Firefox ne sait pas écrire dans un dossier choisi : les notes vont dans les Téléchargements.',
    'browser.notes.other':
      'Ce navigateur ne sait pas écrire dans un dossier choisi : les notes vont dans les Téléchargements. ' +
      'Pour les envoyer dans un dossier, ouvrez Lowsper.html avec Microsoft Edge ou Google Chrome.',
    'browser.model.brave':
      '{flag} Autre solution : installez le modèle une fois avec Microsoft Edge, puis revenez dans Brave.',
    'browser.model.firefox':
      'Firefox ne sait pas enregistrer le modèle dans un dossier. Installez-le une fois avec Microsoft Edge ' +
      "ou Google Chrome ; Firefox pourra ensuite transcrire le micro seul (pas le son d'une visio).",
    'browser.model.other':
      "Ce navigateur ne permet pas d'enregistrer le modèle dans un dossier. Ouvrez Lowsper.html avec Microsoft Edge ou Google Chrome.",
    'browser.unsupported': 'dossier non pris en charge',

    // --- Accueil ---
    // --- Démarrage de la réunion ---
    'home.title': 'Enregistrer une réunion',
    'home.lead': 'Lowsper écrit ce qui se dit, pendant que vous participez.',
    'home.name': 'Nom',
    'home.namePlaceholder': 'Facultatif',
    'home.saveTo': 'Enregistrer la note dans',
    'home.inFolder': 'Dossier « {folder} »',
    'home.downloads': 'Vos Téléchargements',
    'home.newPlace': 'Nouvel emplacement…',
    'home.start': 'Démarrer',
    'home.import': 'Transcrire un fichier audio',
    'home.privacy': 'Reste sur ce PC',
    'home.privacyTitle': 'Ni le son ni le texte ne quittent cet ordinateur',
    'before.title': 'Avant de commencer',
    'before.tell': 'Prévenez les autres participants',
    'before.tellSub': 'Dites-leur que la réunion est transcrite. Tout reste sur cet ordinateur.',
    'before.screen': "Choisissez l'écran de la réunion",
    'before.screenSub': "Puis cochez « Partager l'audio ». Rien n'est filmé.",
    'before.mic': 'Autorisez le micro',
    'before.micSub': 'Lowsper se réduit ensuite en petite fenêtre.',
    'before.skip': 'Ne plus afficher',
    'before.continue': 'Continuer',
    'before.cancel': 'Annuler',
    'set.people': 'Nombre de personnes dans vos réunions, vous compris',
    'set.peopleAuto': 'Automatique',
    'set.peopleHelp':
      "Laissez vide pour que Lowsper compte les voix lui-même. Ce nombre est gardé pour les réunions suivantes, et c'est un plafond : trop bas, des voix différentes sont regroupées.",
    'start.engineDown': 'Le moteur de transcription est indisponible : {error}',
    'start.engineFailed': "Le moteur de transcription n'a pas pu démarrer : {error}",
    'start.micDenied': "L'accès au micro a été refusé. Autorisez-le dans la barre d'adresse puis réessayez.",
    'start.noSource': 'Aucune source audio disponible : {error}',
    'start.unknownError': 'erreur inconnue',

    // --- Pendant la réunion ---
    'rec.recording': 'Enregistrement',
    'rec.paused': 'En pause',
    'rec.pause': 'Pause',
    'rec.resume': 'Reprendre',
    'rec.pip': 'Réduire',
    'rec.pipTitle': 'Petite fenêtre toujours visible, comme un appel réduit',
    'rec.chain': 'Commencer une nouvelle réunion sans arrêter',
    'meet.name': 'Nom de la réunion',
    'meet.untitled': 'Réunion sans nom',
    'meet.mic': 'Votre micro',
    'meet.micOk': 'Je vous entends',
    'meet.micOff': 'Non capté',
    'meet.sound': 'Son de la réunion',
    'meet.soundOk': 'Le son arrive',
    'meet.soundNone': 'Rien ne passe',
    'meet.soundSilent': 'Rien ne passe depuis 1 min',
    'meet.soundOff': 'Non capté (option désactivée)',
    'meet.paused': 'En pause',
    'meet.text': 'Texte écrit',
    'meet.textOk': 'À jour',
    'meet.textLate': '{s} s de retard',
    'meet.textPreparing': 'Le moteur se prépare',
    'meet.howToFix': 'Comment corriger',
    'meet.fixShort': 'Vérifiez le partage du son.',
    'meet.fixHelp':
      "Lowsper n'entend pas la réunion. Partagez à nouveau l'écran ou l'onglet de la visio, et cochez « Partager l'audio ». ",
    'meet.showText': 'Afficher le texte pendant la réunion',
    'rec.stop': 'Terminer',
    'rec.placeholder': 'Le transcript apparaîtra ici au fil de la réunion.',
    'rec.draftTitle': 'Transcription rapide provisoire : la version précise arrive dès que le moteur est disponible.',
    'rec.speaker': '{name} :',
    'rec.shareOthers': 'Partager le son des participants',
    'rec.othersCaptured': 'Son des participants capté.',
    'rec.noMic': 'Micro indisponible : seule la voix des participants est transcrite.',
    'rec.micOnly': 'Seul votre micro est capté (option « participants » désactivée).',
    'rec.othersStopped': "Le partage audio a été arrêté : la voix des participants n'est plus captée. ",
    'rec.micStopped': "Le micro a été déconnecté : votre voix n'est plus captée. ",
    'rec.noAudio': "Le partage ne contient pas de son : la case « Partager l'audio » n'était pas cochée. ",
    'rec.shareCancelled': 'Partage annulé : seule votre voix est captée. ',
    'rec.othersFailed': "Le son des participants n'a pas pu être capté ({error}). ",
    'rec.gap':
      'Un passage n’a pas pu être transcrit : il sera signalé dans le transcript, et vous pourrez le relancer à la fin.',
    'rec.slow':
      "Ce PC ne suit pas le rythme de la réunion : rien n'est perdu, mais la fin du transcript arrivera après la réunion. " +
      'Pour les prochaines fois, installez un modèle plus rapide (Options, « Installer un autre modèle »).',
    'rec.lag':
      'PC très chargé : la détection de parole prend du retard. Rien n’est perdu : le son est gardé et sera rattrapé.',
    'rec.chained': 'Nouvelle réunion démarrée. La note de la précédente sera enregistrée dès qu’elle est prête.',
    'rec.chainedSaved': (v) =>
      `Note de la réunion précédente${v.title ? ' « ' + v.title + ' »' : ''} enregistrée ${v.where}.`,
    'where.folder': 'dans « {folder} »',
    'where.downloads': 'dans vos Téléchargements',
    'pip.unsupported':
      'Ce navigateur ne propose pas de mini-fenêtre. Astuce : réduisez la hauteur de la fenêtre de Lowsper, elle devient une simple barre.',
    'pip.failed': "La mini-fenêtre n'a pas pu s'ouvrir : {error}",
    'queue.preparing': 'Le moteur termine sa préparation, la transcription démarrera dans un instant.',
    'queue.upToDate': 'Transcription à jour.',
    'queue.one': 'Transcription en cours…',
    'queue.many': '{n} passages en attente de transcription.',
    'queue.load': ' Charge du moteur : {pct} %.',

    // --- Import de fichiers ---
    'import.title': 'Transcription de fichiers',
    'import.cancel': 'Annuler',
    'import.cancelling': 'Annulation…',
    'import.privacy':
      "Chaque transcript est enregistré dans vos Téléchargements dès que son fichier est terminé. Le son n'est jamais écrit sur le disque : il est lu par morceaux depuis votre fichier, puis oublié.",
    'import.status.waiting': 'en attente',
    'import.status.cancelled': 'annulé',
    'import.status.running': 'en cours',
    'import.status.done': 'terminé',
    'import.status.failed': 'échec',
    'import.failedWith': 'échec : {error}',
    'import.aborted': 'Transcription du fichier annulée.',
    'import.cancelledToast': 'Transcription annulée.',
    'import.failure': '{name} : {error}',
    'import.ofFiles': ' (fichier {i} sur {n})',
    'import.reading': 'Lecture du fichier…',
    'import.pct': '{pct} % transcrit',
    'import.position': ' ({at} sur {total})',
    'import.left': ' · environ {left} restantes',

    // --- Finalisation ---
    'finish.title': 'Finalisation du transcript',
    'finish.last': 'Transcription des dernières phrases…',
    'finish.preparing': 'Le moteur termine sa préparation…',
    'finish.left': '{n} passages restants…',
    'finish.sweep': 'Vérification : aucune parole oubliée…',
    'finish.sweepN': (v) => `Rattrapage de ${v.n} passage${s(v.n)} oublié${s(v.n)}…`,
    'finish.voices': 'Identification des intervenants…',

    // --- Écran de fin ---
    'done.textLabel': 'Texte de la réunion',
    'done.hint': 'Cliquez sur un nom comme « Intervenant 2 » pour écrire le vrai nom. Il change partout.',
    'done.today': 'Aujourd’hui, {time}',
    'done.minutes': (v) => `${v.n} minute${s(v.n)}`,
    'done.people': (v) => `${v.n} personne${s(v.n)}`,
    'done.subSep': ' · ',
    'done.rename': 'Nom de {label}',
    'done.renameTitle': 'Cliquez pour écrire le vrai nom',
    'done.recognized': 'Voix reconnue grâce à la mémoire des voix',
    'done.saved': 'Note enregistrée',
    'done.saving': 'Enregistrement de la note…',
    'done.notSaved': 'Note non enregistrée',
    'done.next': 'Et maintenant ?',
    'done.summary': 'Obtenir un résumé',
    'done.summarySub': 'Copie le texte avec une consigne, à coller dans votre assistant IA.',
    'done.summaryCopied': 'Copié',
    'done.summaryCopiedSub': 'Collez-le maintenant dans votre assistant IA habituel.',
    'done.see': 'Voir ce qui est copié',
    'done.seeTitle': 'Ce que copie « Obtenir un résumé »',
    'done.ok': 'OK',
    'done.copyText': 'Copier le texte',
    'done.copyTextSub': 'Pour le coller dans un e-mail ou un document.',
    'done.saveCopy': 'Enregistrer une copie',
    'done.saveCopySub': 'Dans votre dossier Téléchargements.',
    'done.fixOpen': 'Corriger un mot mal reconnu',
    'done.copied': 'Copié dans le presse-papiers.',
    'done.finished': 'Réunions précédentes de cette session (déjà dans vos Téléchargements) :',
    'done.downloadAgain': 'Télécharger à nouveau',
    'done.retry': 'Réessayer ces passages',
    'done.fixer': 'Corriger un mot mal reconnu, partout et pour les prochaines réunions',
    'done.fixWrong': 'Mal reconnu (ex. Mira Bello)',
    'done.fixRight': 'Bonne écriture',
    'done.fixApply': 'Corriger',
    'done.fixHint':
      "Lowsper retient la correction : elle s'appliquera toute seule aux réunions suivantes, et le bon mot rejoint vos sigles et noms propres.",
    'done.suspects': 'À vérifier :',
    'done.again': 'Nouvelle réunion',
    'done.journal': 'Journal technique',
    'done.journalTitle':
      "Fonctionnement du logiciel pendant la réunion (aucun texte) : utile si quelque chose s'est mal passé",
    'done.journalHead':
      'Journal technique de Lowsper : aucun texte de réunion, uniquement le fonctionnement du logiciel.\n\n',
    'done.meeting': (v) => `${v.min} min de réunion, ${v.n} intervention${s(v.n)}.`,
    'done.file': (v) => `Fichier « ${v.name} » : ${v.dur} d'enregistrement, ${v.n} intervention${s(v.n)}.`,
    'done.allCovered': ' Toute la parole détectée a été transcrite.',
    'done.recovered': ' (dont {s} s rattrapées en fin de réunion).',
    'done.echo': (v) => ` ${v.n} phrase${s(v.n)} du micro retirée${s(v.n)} : écho des haut-parleurs, pas votre voix.`,
    'done.filesFailed': (v) => ` ${v.n} fichier${s(v.n)} non transcrit${s(v.n)} : ${v.list}`,
    'done.fileFailed': '{name} ({error})',
    'done.listSep': ' ; ',
    'done.drafts': (v) =>
      `${v.n} passage${v.n > 1 ? 's ont été transcrits' : ' a été transcrit'} en mode rapide pendant la réunion pour garder le direct. ` +
      'Leur version précise est en cours de calcul…',
    'done.draftsFolder': 'Tous les passages ont maintenant leur version précise : la note du dossier est mise à jour.',
    'done.draftsDownload':
      'Tous les passages ont maintenant leur version précise. Enregistrez une copie pour avoir la version finale.',
    'done.gaps': (v) =>
      `${v.n} passage${s(v.n)} (${v.s} s de parole) n'${v.n > 1 ? 'ont' : 'a'} pas pu être transcrit${s(v.n)}. ` +
      'Ils sont signalés dans le transcript.',
    'done.gapsAll':
      'Tous les passages ont finalement été transcrits. Enregistrez une copie pour avoir la version finale.',
    'done.retrying': 'Nouvel essai en cours…',
    'done.fixResult': (v) =>
      (v.n
        ? `${v.n} remplacement${s(v.n)} dans ce transcript (retéléchargez le fichier). `
        : 'Mot absent de ce transcript. ') + 'Correction retenue pour les prochaines réunions.',
    'export.folder':
      'Dans le dossier « {folder} » (profil « {profile} ») : {file}. Vos modifications y sont ajoutées (dernière : {at}).',
    'export.downloads': 'Dans vos Téléchargements : {file}.',
    'export.repick': 'Désigner à nouveau le dossier « {folder} » et y enregistrer la note',
    'export.alsoFolder': 'Enregistrer aussi dans le dossier « {folder} »',
    'export.forgotten':
      " Le navigateur a oublié l'accès au dossier du profil « {profile} » (données de navigation effacées ?).",
    'export.ask': ' Le navigateur demande votre accord pour écrire dans le dossier du profil « {profile} ».',
    'export.writeError': ' Écriture dans le dossier impossible : {error}',
    'export.denied': "L'accès au dossier n'a pas été accordé : la note reste dans vos Téléchargements.",
    'export.failed': "Impossible d'enregistrer dans ce dossier : {error}",
    'meeting.untitled': 'Réunion',
    'sample.title': 'Point hebdo',
    'foot.model': 'Modèle local',
    'foot.text': ' · transcription 100 % locale · ni le son ni le texte ne quittent ce poste',

    // --- Note produite (transcript.js, notes.js) : identique à Lowsper 3.5.0 ---
    'note.title': (v) => `# Transcript de réunion${v.title ? ' : ' + v.title : ''}`,
    'note.me': 'Vous',
    'note.others': 'Participants',
    'note.participant': 'Participant',
    'note.speaker': 'Intervenant {n}',
    'note.langs.fr': 'français',
    'note.langs.en': 'anglais',
    'note.langs.auto': 'français et anglais (détection automatique)',
    'note.srcMe': 'micro (« Vous »)',
    'note.srcOthers': 'audio partagé (« Participants »)',
    'note.file': '- **Source** : fichier « {name} »',
    'note.recordedAt': '- **Enregistré le** : {day} (date inscrite dans le fichier)',
    'note.fileDate': "- **Date du fichier** : {day} (dernière modification, pas forcément le jour de l'enregistrement)",
    'note.duration': '- **Durée** : {dur}',
    'note.importedAt': '- **Importé le** : {day}',
    'note.peopleFile': '- **Participants** : {n} personnes',
    'note.date': '- **Date** : {date}',
    'note.hours': '- **Horaires** : {from} à {to} ({min} min)',
    'note.sources': '- **Sources** : {sources}',
    'note.noSource': 'aucune',
    'note.people': '- **Participants** : {n} personnes (vous compris)',
    'note.language': '- **Langue** : {lang}',
    'note.model': '- **Transcription** : {model}, exécuté localement par Lowsper (hors ligne)',
    'note.coverageAll': '- **Couverture** : toute la parole détectée a été transcrite',
    'note.coverage':
      "- **Couverture** : {pct} % de la parole détectée transcrite ; {missing} de parole n'ont pas pu l'être (passages signalés ci-dessous)",
    'note.recovered': '- **Rattrapage** : {dur} de parole manquée en direct, retrouvée et transcrite en fin de réunion',
    'note.glossary': '- **Vocabulaire de référence** (sigles et noms propres attendus) : {glossary}',
    'note.vocab': '- **Domaine** : {list}',
    'note.notice': '> Transcription automatique : elle peut contenir des erreurs de reconnaissance. ',
    'note.noticeMe': '« Vous » désigne la personne qui enregistre (micro). ',
    'note.noticeVoicesFile':
      "Les intervenants sont les voix distinctes détectées automatiquement dans l'enregistrement ",
    'note.noticeVoices':
      "Les autres intervenants sont les voix distinctes détectées automatiquement dans l'audio de la réunion ",
    'note.noticeNamed': '(certaines nommées à la main après la réunion, les autres numérotées « Intervenant n ») : ',
    'note.noticeNumbered':
      '(« Intervenant 1, 2... », noms réels inconnus, ils peuvent souvent se déduire des échanges) : ',
    'note.noticeLimits':
      'deux personnes à la voix proche peuvent partager un numéro, et une même personne peut en recevoir deux. ' +
      'Les phrases trop courtes pour identifier la voix sont notées « Participant ». ',
    'note.noticeAllFile':
      "« Participants » regroupe toutes les voix de l'enregistrement, sans distinction de personne. ",
    'note.noticeAll':
      "« Participants » regroupe toutes les autres voix entendues via l'audio de la réunion, sans distinction de personne. ",
    'note.noticeTimes': 'Les horodatages [hh:mm:ss] sont relatifs au début de l’enregistrement.',
    'note.noSpeech': '_Aucune parole détectée._',
    'note.pause': '_[{from} à {to}] Enregistrement en pause._',
    'note.gap': '_[{from} à {to}] Passage non transcrit ({who}) : le moteur a échoué sur ce passage._',
    'note.line': '**[{t}] {name} :** {text}',
    'note.fileName': 'reunion',
    'note.defaultTitle': 'Réunion',
    'note.sourceFile': 'fichier « {name} »',
    'note.sourceLive': 'réunion en direct',
    'note.varLangs.fr': 'français',
    'note.varLangs.en': 'anglais',
    'note.varLangs.auto': 'français et anglais',

    // --- Vocabulaires métier (vocabulary.js) ---
    'vocab.cyber': 'Cybersécurité',
    'vocab.it': 'Informatique et cloud',
    'vocab.projet': 'Gestion de projet',

    // --- Lecture des fichiers importés (audiofile.js) ---
    'audio.wavNoFmt': 'Fichier WAV incomplet (description du son absente).',
    'audio.wavCodec': 'Ce fichier WAV utilise un codage compressé non pris en charge.',
    'audio.wavNoData': 'Fichier WAV sans données audio.',
    'audio.noMp3': 'Aucune trame MP3 lisible dans ce fichier.',
    'audio.noAac': 'Aucune trame AAC lisible dans ce fichier.',
    'audio.mp4NoIndex': 'Fichier MP4 incomplet (index absent) : enregistrement interrompu ?',
    'audio.noTrack': 'Ce fichier ne contient pas de piste audio.',
    'audio.mp4Codec': 'Codage audio « {type} » non pris en charge dans ce fichier MP4.',
    'audio.noAacConfig': 'Configuration AAC introuvable dans ce fichier.',
    'audio.oggBad': 'Page Ogg illisible : fichier abîmé ?',
    'audio.webmBad': 'Fichier WebM abîmé (élément de taille inconnue).',
    'audio.webmNoTrack': 'Ce fichier WebM ne contient pas de piste audio.',
    'audio.webmLacing': 'Fichier WebM à blocs groupés (« lacing ») non pris en charge.',
    'audio.decoderFailed': 'Le décodeur du navigateur a échoué sur ce fichier : {error}',
    'audio.tooLong':
      'Ce format n’est lu que pour des fichiers courts (25 Mo au plus) : convertissez-le en MP3 ou M4A, ou découpez-le.',
    'audio.unknownFormat':
      'Format audio non reconnu par ce navigateur. Formats lus : WAV, MP3, M4A/AAC, OGG/Opus, WebM.',
  };

  // ---------------------------------------------------------------------------
  // Catalogue anglais : anglais simple, phrases courtes, aucun terme technique inutile.
  // ---------------------------------------------------------------------------
  const en = {
    'engine.preparing': 'Preparing the engine',
    'engine.preparingPct': 'Preparing the engine {pct}%',
    'engine.starting': 'Starting the engine',
    'engine.ready': 'Engine ready',
    'engine.incompatible': 'Browser not supported',
    'engine.toInstall': 'Model to install',
    'engine.unavailable': 'Engine unavailable',
    'engine.downloading': 'Downloading the model',
    'engine.installStopped': 'Installation stopped',
    'theme.title': 'Light or dark',
    'theme.toDark': 'Switch to dark mode',
    'theme.toLight': 'Switch to light mode',
    'settings.title': 'Settings',
    'settings.close': 'Close the settings',

    'set.transcription': 'Transcription',
    'set.language': 'Spoken language',
    'set.language.fr': 'French',
    'set.language.en': 'English',
    'set.language.auto': 'French and English (automatic detection)',
    'set.glossary': 'Acronyms and names used in your meetings <em>(helps recognition, kept on this PC)</em>',
    'set.glossaryPlaceholder': 'e.g. CISO, KPI, GDPR, NIS 2, Atlas project, Dr Martin',
    'set.vocab': 'Industry vocabulary <em>(acronyms and terms of the field, in addition to yours)</em>',
    'set.withOthers': 'Also capture the sound of the other people (screen sharing)',
    'set.withOthersUnsupported': 'This browser cannot capture the sound of another app.',
    'set.distinguish': 'Tell speakers apart (Speaker 1, 2, 3...)',
    'set.autopip': 'Shrink Lowsper to a small window when recording starts',
    'set.showBefore': 'Show “Before you start” before each meeting',
    'set.fixes': 'Words Whisper gets wrong <em>(fixed automatically in every transcript)</em>',
    'set.fixWrong': 'Misheard (e.g. Kalmar)',
    'set.fixRight': 'Correct spelling (e.g. CALMAR)',
    'set.fixAdd': 'Add',
    'set.fixForget': 'Forget this fix',
    'set.keep': 'Keep my settings in the Lowsper folder',
    'set.savedLine': (v) =>
      `Settings copied to the Lowsper folder (${v.when}): they survive a browser cleanup.` +
      (v.dirty ? ' Your latest changes will be copied when you close this panel.' : ''),
    'set.notSaved':
      'Your settings are kept by the browser. Some work computers erase them when the browser closes: keep them in the Lowsper folder too.',
    'set.kept': 'Settings kept in the Lowsper folder.',
    'set.restored':
      'Your settings (acronyms, preferences) were restored from the Lowsper folder: the browser had erased them.',

    'prof.title': 'Output profiles',
    'prof.intro':
      'Where each meeting note goes and what it looks like, for example straight into your notes app. You pick the profile on the home screen.',
    'prof.edit': 'Profile to edit',
    'prof.new': 'New profile',
    'prof.delete': 'Delete this profile',
    'prof.name': 'Profile name',
    'prof.folder': 'Destination folder',
    'prof.folderPick': 'Choose the folder',
    'prof.folderClear': 'Back to Downloads',
    'prof.syncWarning':
      'A folder synced online (cloud storage, notes app sync) will make the note leave this computer.',
    'prof.prompt': 'Instructions offered by “Get a summary”',
    'prof.classic': 'Lowsper classic format (no template, no properties)',
    'prof.fileName': 'File name <em>(variables allowed, e.g. {{date}} {{titre}})</em>',
    'prof.front': 'Properties at the top of the note (front matter)',
    'prof.frontOn': 'Add properties',
    'prof.tags': 'Tags, separated by commas',
    'prof.extra': 'Custom fields, one per line <em>(key: value; variables allowed)</em>',
    'prof.links': 'Write named speakers as links <code>[[Name]]</code>',
    'prof.template': 'Note template',
    'prof.templateReset': 'Restore the default template',
    'prof.vars': 'Available variables',
    'prof.default': 'Default',
    'prof.fallbackName': 'Profile',
    'prof.inFolder': ' (folder “{folder}”)',
    'prof.folderNamed': 'Folder “{folder}”',
    'prof.downloads': 'Your Downloads',
    'prof.unknownVars': 'Unknown variable, left as is: {list}.',
    'prof.badExtra': 'Custom field ignored (it must be “key: value”): {list}.',
    'prof.example': 'Example: {name}',
    'prof.deleteConfirm': 'Delete the profile “{name}”? Notes already saved stay in their folder.',
    'prof.access.ask':
      'Notes of the profile “{name}” go to the folder “{folder}”: the browser asks for your permission.',
    'prof.access.allow': 'Allow now',
    'prof.access.forgotten':
      'The browser forgot the folder “{folder}” of the profile “{name}” (browsing data erased?). Until then, notes go to your Downloads.',
    'prof.access.repick': 'Choose the folder again',
    'prof.folderError': 'This folder cannot be used: {error}',
    'var.titre': 'name of the meeting, or of the imported file',
    'var.date': 'date of the meeting, YYYY-MM-DD',
    'var.date_longue': 'date in words (Thursday 5 November 2026)',
    'var.heure': 'start time, HHhMM (can be used in a file name)',
    'var.heure_debut': 'start time, HH:MM',
    'var.duree': 'duration (61 min)',
    'var.intervenants': 'speakers, separated by commas',
    'var.source': 'live meeting, or file “name”',
    'var.modele': 'transcription model',
    'var.langue': 'spoken language',
    'var.profil': 'profile name',
    'var.en_tete': 'information lines of the classic format (date, times, coverage...)',
    'var.avertissement': 'reminder about the reliability of automatic transcription',
    'var.transcript': 'the timestamped lines',
    'var.transcript_complet': 'the whole Lowsper classic format',
    'front.date': 'date',
    'front.duree': 'duration (minutes)',
    'front.intervenants': 'speakers',
    'front.source': 'source',
    'front.modele': 'model',

    'ai.title': 'Instructions for the AI',
    'ai.intro':
      'Text placed before the note by “Get a summary”, to ask the assistant of your choice for minutes. Variables are allowed, as in note templates; <code>{{note}}</code> puts the note somewhere other than at the end.',
    'ai.edit': 'Instructions to edit',
    'ai.new': 'New instructions',
    'ai.name': 'Name',
    'ai.text': 'Instructions text',
    'ai.modified': ' (edited)',
    'ai.restore': 'Restore the original text',
    'ai.delete': 'Delete these instructions',
    'ai.deleteConfirm': 'Delete the instructions “{name}”?',
    'ai.fallbackName': 'Instructions',
    'ai.choice': 'Instructions for the AI',
    'prompt.compte-rendu.name': 'Meeting minutes',
    'prompt.compte-rendu.text':
      '# Role\n' +
      'You write accurate, useful meeting minutes.\n' +
      '\n' +
      '# Context\n' +
      "Below is an automatic transcript of a meeting, recorded and transcribed on the user's own computer by Lowsper.\n" +
      '- It may contain speech recognition errors.\n' +
      '- « You » is the person who recorded. Other people may appear as « Speaker 1 », « Speaker 2 »... when their names are unknown.\n' +
      '- Times are relative to the start of the recording.\n' +
      '\n' +
      '# Task\n' +
      'Write the minutes in the main language of the transcript, with these sections:\n' +
      '1. Summary: 3 to 5 sentences.\n' +
      '2. Participants: names or labels as they appear.\n' +
      '3. Topics discussed.\n' +
      '4. Decisions made.\n' +
      '5. Action items: who, what, deadline. Write « not specified » when something is missing.\n' +
      '6. Open questions.\n' +
      '\n' +
      '# Rules\n' +
      '- Use only what is in the transcript. Never invent a name, a number or a date.\n' +
      '- Copy numbers exactly.\n' +
      '- When a passage is unclear or looks misheard, say so instead of guessing.\n' +
      '- Be concise. Use bullet points.\n' +
      '\n' +
      '# Transcript\n' +
      '{{note}}',
    'prompt.synthese-appel.name': 'Call summary',
    'prompt.synthese-appel.text':
      '# Role\n' +
      'You write accurate, useful call summaries.\n' +
      '\n' +
      '# Context\n' +
      "Below is an automatic transcript of a call, recorded and transcribed on the user's own computer by Lowsper.\n" +
      '- It may contain speech recognition errors.\n' +
      '- « You » is the person who recorded. Other people may appear as « Speaker 1 », « Speaker 2 »... when their names are unknown.\n' +
      '- Times are relative to the start of the recording.\n' +
      '\n' +
      '# Task\n' +
      'Write the summary in the main language of the transcript, with these sections:\n' +
      '1. Purpose of the call: 1 or 2 sentences.\n' +
      '2. Participants: names or labels as they appear.\n' +
      '3. Key points.\n' +
      '4. Commitments made by each side.\n' +
      '5. Next steps: who, what, date. Write « not specified » when something is missing.\n' +
      '\n' +
      '# Rules\n' +
      '- Use only what is in the transcript. Never invent a name, a number or a date.\n' +
      '- Copy numbers exactly.\n' +
      '- When a passage is unclear or looks misheard, say so instead of guessing.\n' +
      '- Be concise. Use bullet points.\n' +
      '\n' +
      '# Transcript\n' +
      '{{note}}',
    'prompt.actions.name': 'Action items',
    'prompt.actions.text':
      '# Role\n' +
      'You list the action items agreed in meetings, accurately.\n' +
      '\n' +
      '# Context\n' +
      "Below is an automatic transcript of a meeting, recorded and transcribed on the user's own computer by Lowsper.\n" +
      '- It may contain speech recognition errors.\n' +
      '- « You » is the person who recorded. Other people may appear as « Speaker 1 », « Speaker 2 »... when their names are unknown.\n' +
      '- Times are relative to the start of the recording.\n' +
      '\n' +
      '# Task\n' +
      'List only the action items, in the main language of the transcript, as a table with these columns:\n' +
      '1. Action.\n' +
      '2. Owner.\n' +
      '3. Deadline.\n' +
      '4. Source: the sentence of the transcript that supports it, with its time.\n' +
      'Write « not specified » when the owner or the deadline is not stated explicitly.\n' +
      '\n' +
      '# Rules\n' +
      '- Use only what is in the transcript. Never invent a name, a number or a date.\n' +
      '- Copy numbers exactly.\n' +
      '- When a passage is unclear or looks misheard, say so instead of guessing.\n' +
      '- Be concise.\n' +
      '\n' +
      '# Transcript\n' +
      '{{note}}',

    'lai.title': 'Browser built-in AI (experimental)',
    'lai.intro':
      'Recent Chrome and Edge can include a small language model that writes summaries on this PC, without any online service, if the hardware allows it. The check downloads nothing and reads none of your transcripts; the trial uses a made-up meeting.',
    'lai.probe': 'Check this PC',
    'lai.trial': 'Try on a made-up meeting',
    'lai.stop': 'Stop',
    'lai.copy': 'Copy the report',
    'lai.progress': 'Model download by the browser',
    'lai.checking': 'Checking…',
    'lai.usableHere': 'The browser says it can work in French on this PC. The trial will tell how good the result is.',
    'lai.notUsable': 'The built-in AI cannot be used here. “Get a summary” is still available.',
    'lai.downloadConfirm':
      'The browser must first download its language model. The browser does this download, not Lowsper, and it needs at least 22 GB of free space (Chrome documentation). Continue?',
    'lai.writing': '{name}: writing minutes of the made-up meeting…',
    'lai.downloadPct': 'Model download by the browser: {pct}%',
    'lai.stopped': 'Trial stopped.',
    'lai.done': 'Trial finished. “Copy the report” only contains the made-up meeting and the browser state.',
    'lai.unexpected': 'unexpected answer from the browser (“{state}”)',
    'lai.api.summarizer': 'Summary (Summarizer)',
    'lai.api.prompt': 'Language model (Prompt API)',
    'lai.state.absent': 'missing from this browser (or blocked for a page opened from the disk)',
    'lai.state.unavailable':
      'unavailable on this PC: hardware too weak, disk space, language not supported or turned off by your organization',
    'lai.state.downloadable': 'usable, but the browser must first download its model',
    'lai.state.downloading': 'the browser is downloading its model',
    'lai.state.available': 'available',
    'lai.state.timeout': 'no answer from the browser within 10 s',
    'lai.state.error': 'error',
    'lai.report.title': 'Browser built-in AI check (Lowsper)',
    'lai.report.browser': 'Browser detected: {browser}',
    'lai.report.ua': 'User agent: {ua}',
    'lai.report.page': 'Page: {protocol}',
    'lai.report.secure': ', secure context',
    'lai.report.insecure': ', insecure context',
    'lai.report.trial': '--- Trial: {name} ---',
    'lai.report.error': 'Error: {error}',
    'lai.report.times': 'Setup: {create} s; writing: {run} s',
    'lai.report.facts': 'Facts found: {found}/{total}',
    'lai.report.missing': 'Missing: {list}',

    'set.look': 'Display',
    'set.theme': 'Theme',
    'set.theme.auto': 'Automatic (same as the system)',
    'set.theme.light': 'Light',
    'set.theme.dark': 'Dark',
    'set.uiLang': 'App language',
    'set.uiLangBusy': 'You can change the language when no meeting or transcription is running.',
    'set.model': 'Model',
    'set.modelSelect': 'Transcription model',
    'set.addModel': 'Install or add models',
    'set.modelCurrent': 'Model in use: {current}. Installed on this PC: {list}.',
    'set.noModel': 'No model installed yet.',
    'set.perf': 'Performance',
    'set.power': 'Computing power <em>(share of the processor used to transcribe)</em>',
    'set.power.eco': 'Saver: 1 core, the transcription may fall behind',
    'set.power.balanced': 'Balanced: leaves room for Teams, Office... (recommended)',
    'set.power.max': 'Maximum: as live as possible, the PC works harder',
    'set.speedTest': 'Test the speed of this PC with the current model',
    'set.voices': 'Speaker voices',
    'set.memory': 'Remember the voices of the speakers I name, to recognize them in later meetings',
    'set.memoryWarn':
      'A voiceprint is biometric data: only turn this on with the consent of the people concerned. Only a voiceprint (a series of numbers, not a recording) is kept, only on this PC.',
    'set.memoryDays': 'Delete automatically',
    'set.memoryDays.30': 'after 1 month',
    'set.memoryDays.90': 'after 3 months',
    'set.memoryDays.180': 'after 6 months',
    'set.memoryClear': 'Delete remembered voices',
    'memory.list': (v) => `${v.n} voice${sEn(v.n)} remembered: ${v.names}.`,
    'memory.none': 'No voice remembered yet. Name the speakers at the end of a meeting.',
    'memory.confirm':
      'Remember voices?\n\nA voiceprint is biometric data (GDPR). ' +
      'Only turn this on with the consent of the people concerned. Voiceprints stay only on this PC ' +
      'and are deleted automatically after the chosen time.',
    'memory.clearConfirm': 'Permanently delete all remembered voices?',
    'memory.cleared': 'Remembered voices deleted.',

    'speed.last': 'Last test: estimated load {pct}% for a meeting where people talk non-stop.',
    'speed.notReady': 'The engine is not ready yet.',
    'speed.measuring': 'Testing (a few seconds to a minute)…',
    'speed.comfortable': 'Very comfortable: the transcription will keep up with the meeting live.',
    'speed.ok': 'Good: the transcription keeps up, with a small delay when people talk a lot.',
    'speed.tight': 'Tight: when people talk a lot, the transcription will fall behind, then catch up during silences.',
    'speed.fastLane':
      'When people talk a lot, the fast lane will take over to stay live, and those passages will be transcribed accurately afterwards.',
    'speed.tooSlow':
      'Too slow to keep up live: install Whisper base (Settings, “Install or add models”) to turn on the fast lane, or choose a faster model.',
    'speed.result': (v) =>
      `${v.model}: about ${v.perMin} s of computing per minute of continuous speech ` +
      `(estimated load ${v.pct}% with ${v.n} engine${sEn(v.n)}` +
      (v.boost ? `, ${v.boost} as backup` : '') +
      (v.fast ? ', plus the fast lane as a fallback' : '') +
      `). ${v.advice}`,
    'speed.failed': 'Test failed: {error}',

    'recover.title': 'A previous meeting was not finished',
    'recover.saved': 'Its transcript was saved.',
    'recover.download': 'Download this transcript',
    'recover.dismiss': 'Ignore',
    'recover.info': '{date} at {time}, {min} min transcribed',

    'install.temp':
      '<strong>Lowsper seems to be opened straight from the zip file.</strong> Windows then puts it in a temporary folder, and the model would have to be downloaded again every time.\n        Close this page, right-click the zip, choose “Extract All”, then open Lowsper.html from the extracted folder.',
    'install.title': 'Welcome to Lowsper',
    'install.lead': 'One last step: download the speech recognition. Only once, then everything works offline.',
    'install.titleAdd': 'Add a model',
    'install.leadAdd': 'The chosen model is downloaded once, then stored next to the others.',
    'install.detected': 'Found on this PC',
    'install.threads': (v) => `${v.n} logical processor${sEn(v.n)}`,
    'install.memory': '{n} GB of memory or more',
    'install.gpuYes': 'Graphics card found',
    'install.gpuNo': 'No graphics card found',
    'install.gpuChecking': 'Looking for a graphics card…',
    'install.choose': 'Choose a model',
    'install.best': 'Best for this PC',
    'install.installed': 'installed',
    'install.reasonGpu': 'Needs a graphics card: none found on this PC.',
    'install.withBackup': 'Includes a faster backup model.',
    'install.size': '{mb} MB',
    'install.savedNext': 'Saved next to Lowsper.html',
    'install.button': 'Download and install',
    'install.cta': 'Download and install ({mb} MB)',
    'install.nothing': 'All usable models are already installed',
    'install.hint': 'Your browser will open a window: choose this folder, then confirm.',
    'install.more': 'Installed elsewhere already, or PC without Internet?',
    'model.label.whisper-small': 'Whisper small',
    'model.label.whisper-small-gpu': 'Whisper small (graphics card)',
    'model.label.whisper-turbo': 'Whisper large-v3 turbo',
    'model.label.whisper-base': 'Whisper base',
    'model.short.whisper-small': 'Accurate.',
    'model.short.whisper-small-gpu': 'Same as Whisper small, run by the graphics card.',
    'model.short.whisper-turbo': 'The most accurate.',
    'model.short.whisper-base': 'Faster, less accurate. For older or very busy PCs.',
    'install.back': 'Back',
    'install.preparing': 'Preparing…',
    'install.already':
      '<strong>You already installed the model</strong> with an earlier version of Lowsper? No need to download it again: copy the <code>app\\models</code> folder from the old Lowsper folder into this one (replace the existing folder), then reload the page (F5).',
    'install.source':
      'The download comes from Hugging Face (huggingface.co), at a fixed version, and every file is checked with a digital fingerprint. To set up a PC without Internet access, copy the Lowsper folder of a PC where it is already installed.',
    'install.running': 'Installing…',
    'install.progress': '{done} / {total} MB · {speed} MB/s',
    'install.left': ' · about {left} left',
    'install.doneOne': 'Model installed. Starting…',
    'install.doneMany': 'Models installed. Starting…',
    'install.network':
      ' Your organization’s network may block this site. Try another network (phone hotspot, home), ' +
      'or copy the Lowsper folder of a colleague who already installed it.',
    'install.busy': 'Finish the current meeting before installing a model.',
    'err.hfUnreachable': 'Hugging Face cannot be reached from this network.',
    'err.http': 'Download refused (HTTP {status}).',
    'err.tooBig': 'File larger than expected.',
    'err.incomplete': 'Download incomplete.',
    'err.cancelled': 'Selection cancelled.',
    'err.picker': 'The browser does not allow access to this folder: {error}',
    'err.wrongFolder':
      'This folder does not contain Lowsper.html. Choose the Lowsper folder itself (the one where Lowsper.html is).',
    'err.cannotWrite': 'Cannot write to this folder: {error}',
    'err.otherCopy':
      'This folder is another copy of Lowsper, not the one open in this page. ' +
      'Choose the folder that contains the page open now: {folder}',
    'err.checksum': 'Altered or unexpected file: {path}. Installation cancelled.',

    'err.fileMissing': 'File not found: {src}',
    'err.contentMissing': 'Missing content: {src}',
    'err.noManifest': 'app/manifest.js not found: the folder is incomplete.',
    'err.noModel': 'No model installed.',
    'err.engine': 'Engine error: {error}',
    'err.analyzer': 'Audio analysis error: {error}',
    'err.unknown': 'unknown',
    'err.notResponding': 'the engine is not responding',

    'browser.tooOld': 'This browser is too old. Use an up-to-date Microsoft Edge or Google Chrome.',
    'browser.noMic':
      'This browser does not allow microphone access from a local file. Use Microsoft Edge or Google Chrome.',
    'browser.braveFlag':
      'Brave blocks writing to a folder by default. To allow it: open brave://flags, ' +
      'search for “File System Access”, choose “Enabled”, then restart Brave.',
    'browser.notes.brave': '{flag} Until then, notes go to your Downloads.',
    'browser.notes.firefox': 'Firefox cannot write to a chosen folder: notes go to your Downloads.',
    'browser.notes.other':
      'This browser cannot write to a chosen folder: notes go to your Downloads. ' +
      'To send them to a folder, open Lowsper.html with Microsoft Edge or Google Chrome.',
    'browser.model.brave': '{flag} Another way: install the model once with Microsoft Edge, then come back to Brave.',
    'browser.model.firefox':
      'Firefox cannot save the model in a folder. Install it once with Microsoft Edge ' +
      'or Google Chrome; Firefox can then transcribe the microphone only (not the sound of a video call).',
    'browser.model.other':
      'This browser cannot save the model in a folder. Open Lowsper.html with Microsoft Edge or Google Chrome.',
    'browser.unsupported': 'folder not supported',

    'home.title': 'Record a meeting',
    'home.lead': 'Lowsper writes down what is said, while you take part.',
    'home.name': 'Name',
    'home.namePlaceholder': 'Optional',
    'home.saveTo': 'Save note to',
    'home.inFolder': 'Folder “{folder}”',
    'home.downloads': 'Your Downloads folder',
    'home.newPlace': 'New place…',
    'home.start': 'Start',
    'home.import': 'Transcribe an audio file',
    'home.privacy': 'Stays on this PC',
    'home.privacyTitle': 'Neither the sound nor the text leaves this computer',
    'before.title': 'Before you start',
    'before.tell': 'Tell the other people',
    'before.tellSub': 'Let them know the meeting is being transcribed. Everything stays on this computer.',
    'before.screen': 'Pick the meeting screen',
    'before.screenSub': 'Then tick “Share audio”. Nothing is filmed.',
    'before.mic': 'Allow the microphone',
    'before.micSub': 'Lowsper then shrinks to a small window.',
    'before.skip': "Don't show again",
    'before.continue': 'Continue',
    'before.cancel': 'Cancel',
    'set.people': 'Number of people in your meetings, you included',
    'set.peopleAuto': 'Automatic',
    'set.peopleHelp':
      'Leave empty to let Lowsper count the voices itself. This number is kept for the next meetings, and it is a limit: too low, and different voices are grouped together.',
    'start.engineDown': 'The transcription engine is unavailable: {error}',
    'start.engineFailed': 'The transcription engine could not start: {error}',
    'start.micDenied': 'Microphone access was refused. Allow it in the address bar, then try again.',
    'start.noSource': 'No audio source available: {error}',
    'start.unknownError': 'unknown error',

    'rec.recording': 'Recording',
    'rec.paused': 'Paused',
    'rec.pause': 'Pause',
    'rec.resume': 'Resume',
    'rec.pip': 'Minimize',
    'rec.pipTitle': 'Small window always visible, like a minimized call',
    'rec.chain': 'Start a new meeting without stopping',
    'meet.name': 'Meeting name',
    'meet.untitled': 'Untitled meeting',
    'meet.mic': 'Your microphone',
    'meet.micOk': 'Hearing you',
    'meet.micOff': 'Not captured',
    'meet.sound': 'Meeting sound',
    'meet.soundOk': 'Coming through',
    'meet.soundNone': 'Nothing is coming through',
    'meet.soundSilent': 'Nothing has come through for 1 min',
    'meet.soundOff': 'Not captured (option turned off)',
    'meet.paused': 'Paused',
    'meet.text': 'Written text',
    'meet.textOk': 'Up to date',
    'meet.textLate': '{s} s behind',
    'meet.textPreparing': 'The engine is getting ready',
    'meet.howToFix': 'How to fix',
    'meet.fixShort': 'Check the sound sharing.',
    'meet.fixHelp':
      'Lowsper cannot hear the meeting. Share the screen or the video call tab again, and tick “Share audio”. ',
    'meet.showText': 'Show the text during the meeting',
    'rec.stop': 'Stop',
    'rec.placeholder': 'The transcript will appear here as the meeting goes on.',
    'rec.draftTitle': 'Quick draft transcription: the accurate version comes as soon as the engine is free.',
    'rec.speaker': '{name}:',
    'rec.shareOthers': 'Share the sound of the other people',
    'rec.othersCaptured': 'Sound of the other people captured.',
    'rec.noMic': 'Microphone unavailable: only the voices of the other people are transcribed.',
    'rec.micOnly': 'Only your microphone is captured (“other people” option turned off).',
    'rec.othersStopped': 'Audio sharing was stopped: the voices of the other people are no longer captured. ',
    'rec.micStopped': 'The microphone was disconnected: your voice is no longer captured. ',
    'rec.noAudio': 'The sharing has no sound: the “Share audio” box was not ticked. ',
    'rec.shareCancelled': 'Sharing cancelled: only your voice is captured. ',
    'rec.othersFailed': 'The sound of the other people could not be captured ({error}). ',
    'rec.gap':
      'A passage could not be transcribed: it will be marked in the transcript, and you can try it again at the end.',
    'rec.slow':
      'This PC cannot keep up with the meeting: nothing is lost, but the end of the transcript will come after the meeting. ' +
      'Next time, install a faster model (Settings, “Install or add models”).',
    'rec.lag':
      'PC very busy: speech detection is falling behind. Nothing is lost: the sound is kept and will be caught up.',
    'rec.chained': 'New meeting started. The note of the previous one will be saved as soon as it is ready.',
    'rec.chainedSaved': (v) => `Note of the previous meeting${v.title ? ' “' + v.title + '”' : ''} saved ${v.where}.`,
    'where.folder': 'in “{folder}”',
    'where.downloads': 'in your Downloads',
    'pip.unsupported':
      'This browser has no small window. Tip: reduce the height of the Lowsper window, it turns into a simple bar.',
    'pip.failed': 'The small window could not open: {error}',
    'queue.preparing': 'The engine is finishing its preparation, the transcription will start in a moment.',
    'queue.upToDate': 'Transcription up to date.',
    'queue.one': 'Transcribing…',
    'queue.many': '{n} passages waiting to be transcribed.',
    'queue.load': ' Engine load: {pct}%.',

    'import.title': 'File transcription',
    'import.cancel': 'Cancel',
    'import.cancelling': 'Cancelling…',
    'import.privacy':
      'Each transcript is saved to your Downloads as soon as its file is done. The sound is never written to the disk: it is read in pieces from your file, then forgotten.',
    'import.status.waiting': 'waiting',
    'import.status.cancelled': 'cancelled',
    'import.status.running': 'in progress',
    'import.status.done': 'done',
    'import.status.failed': 'failed',
    'import.failedWith': 'failed: {error}',
    'import.aborted': 'File transcription cancelled.',
    'import.cancelledToast': 'Transcription cancelled.',
    'import.failure': '{name}: {error}',
    'import.ofFiles': ' (file {i} of {n})',
    'import.reading': 'Reading the file…',
    'import.pct': '{pct}% transcribed',
    'import.position': ' ({at} of {total})',
    'import.left': ' · about {left} left',

    'finish.title': 'Finishing the transcript',
    'finish.last': 'Transcribing the last sentences…',
    'finish.preparing': 'The engine is finishing its preparation…',
    'finish.left': '{n} passages left…',
    'finish.sweep': 'Checking: no forgotten speech…',
    'finish.sweepN': (v) => `Catching up ${v.n} forgotten passage${sEn(v.n)}…`,
    'finish.voices': 'Identifying speakers…',

    'done.textLabel': 'Meeting text',
    'done.hint': 'Click a name such as “Speaker 2” to type the real name. It changes everywhere.',
    'done.today': 'Today, {time}',
    'done.minutes': (v) => `${v.n} minute${sEn(v.n)}`,
    'done.people': (v) => `${v.n} ${v.n === 1 ? 'person' : 'people'}`,
    'done.subSep': ' · ',
    'done.rename': 'Name of {label}',
    'done.renameTitle': 'Click to type the real name',
    'done.recognized': 'Voice recognized from the voice memory',
    'done.saved': 'Note saved',
    'done.saving': 'Saving the note…',
    'done.notSaved': 'Note not saved',
    'done.next': 'What next?',
    'done.summary': 'Get a summary',
    'done.summarySub': 'Copies the text with instructions, to paste into your AI assistant.',
    'done.summaryCopied': 'Copied',
    'done.summaryCopiedSub': 'Now paste it into your usual AI assistant.',
    'done.see': 'See what is copied',
    'done.seeTitle': 'What “Get a summary” copies',
    'done.ok': 'Done',
    'done.copyText': 'Copy the text',
    'done.copyTextSub': 'To paste in an email or a document.',
    'done.saveCopy': 'Save a copy',
    'done.saveCopySub': 'In your Downloads folder.',
    'done.fixOpen': 'Fix a misheard word',
    'done.copied': 'Copied to the clipboard.',
    'done.finished': 'Earlier meetings of this session (already in your Downloads):',
    'done.downloadAgain': 'Download again',
    'done.retry': 'Try these passages again',
    'done.fixer': 'Fix a misheard word, everywhere and for the next meetings',
    'done.fixWrong': 'Misheard (e.g. Mira Bello)',
    'done.fixRight': 'Correct spelling',
    'done.fixApply': 'Fix',
    'done.fixHint':
      'Lowsper remembers the fix: it will apply by itself to the next meetings, and the right word joins your acronyms and names.',
    'done.suspects': 'To check:',
    'done.again': 'New meeting',
    'done.journal': 'Technical log',
    'done.journalTitle': 'How the software ran during the meeting (no text): useful if something went wrong',
    'done.journalHead': 'Lowsper technical log: no meeting text, only how the software ran.\n\n',
    'done.meeting': (v) => `${v.min} min meeting, ${v.n} turn${sEn(v.n)}.`,
    'done.file': (v) => `File “${v.name}”: ${v.dur} of recording, ${v.n} turn${sEn(v.n)}.`,
    'done.allCovered': ' All detected speech was transcribed.',
    'done.recovered': ' (including {s} s caught up at the end of the meeting).',
    'done.echo': (v) => ` ${v.n} microphone sentence${sEn(v.n)} removed: echo from the speakers, not your voice.`,
    'done.filesFailed': (v) => ` ${v.n} file${sEn(v.n)} not transcribed: ${v.list}`,
    'done.fileFailed': '{name} ({error})',
    'done.listSep': '; ',
    'done.drafts': (v) =>
      `${v.n} passage${v.n === 1 ? ' was' : 's were'} transcribed in quick mode during the meeting to stay live. ` +
      'Their accurate version is being computed…',
    'done.draftsFolder': 'All passages now have their accurate version: the note in the folder is updated.',
    'done.draftsDownload': 'All passages now have their accurate version. Save a copy to get the final version.',
    'done.gaps': (v) =>
      `${v.n} passage${sEn(v.n)} (${v.s} s of speech) could not be transcribed. ` +
      `${v.n === 1 ? 'It is' : 'They are'} marked in the transcript.`,
    'done.gapsAll': 'All passages were transcribed in the end. Save a copy to get the final version.',
    'done.retrying': 'Trying again…',
    'done.fixResult': (v) =>
      (v.n
        ? `${v.n} replacement${sEn(v.n)} in this transcript (download the file again). `
        : 'Word not found in this transcript. ') + 'Fix kept for the next meetings.',
    'export.folder':
      'In the folder “{folder}” (profile “{profile}”): {file}. Your changes are added to it (last: {at}).',
    'export.downloads': 'In your Downloads: {file}.',
    'export.repick': 'Choose the folder “{folder}” again and save the note there',
    'export.alsoFolder': 'Also save in the folder “{folder}”',
    'export.forgotten': ' The browser forgot access to the folder of the profile “{profile}” (browsing data erased?).',
    'export.ask': ' The browser asks for your permission to write to the folder of the profile “{profile}”.',
    'export.writeError': ' Writing to the folder failed: {error}',
    'export.denied': 'Access to the folder was not granted: the note stays in your Downloads.',
    'export.failed': 'Cannot save in this folder: {error}',
    'meeting.untitled': 'Meeting',
    'sample.title': 'Weekly check-in',
    'foot.model': 'Local model',
    'foot.text': ' · 100% local transcription · neither the sound nor the text leaves this PC',

    // Note produite en anglais : en-tête et libellés traduits, même structure qu'en français
    'note.title': (v) => `# Meeting transcript${v.title ? ': ' + v.title : ''}`,
    'note.me': 'You',
    'note.others': 'Participants',
    'note.participant': 'Participant',
    'note.speaker': 'Speaker {n}',
    'note.langs.fr': 'French',
    'note.langs.en': 'English',
    'note.langs.auto': 'French and English (automatic detection)',
    'note.srcMe': 'microphone (“You”)',
    'note.srcOthers': 'shared audio (“Participants”)',
    'note.file': '- **Source**: file “{name}”',
    'note.recordedAt': '- **Recorded on**: {day} (date stored in the file)',
    'note.fileDate': '- **File date**: {day} (last modified, not necessarily the day of the recording)',
    'note.duration': '- **Duration**: {dur}',
    'note.importedAt': '- **Imported on**: {day}',
    'note.peopleFile': '- **Participants**: {n} people',
    'note.date': '- **Date**: {date}',
    'note.hours': '- **Time**: {from} to {to} ({min} min)',
    'note.sources': '- **Sources**: {sources}',
    'note.noSource': 'none',
    'note.people': '- **Participants**: {n} people (including you)',
    'note.language': '- **Language**: {lang}',
    'note.model': '- **Transcription**: {model}, run locally by Lowsper (offline)',
    'note.coverageAll': '- **Coverage**: all detected speech was transcribed',
    'note.coverage':
      '- **Coverage**: {pct}% of detected speech transcribed; {missing} of speech could not be (passages marked below)',
    'note.recovered': '- **Catch-up**: {dur} of speech missed live, found and transcribed at the end of the meeting',
    'note.glossary': '- **Reference vocabulary** (expected acronyms and names): {glossary}',
    'note.vocab': '- **Field**: {list}',
    'note.notice': '> Automatic transcription: it may contain recognition errors. ',
    'note.noticeMe': '“You” is the person recording (microphone). ',
    'note.noticeVoicesFile': 'The speakers are the distinct voices detected automatically in the recording ',
    'note.noticeVoices': 'The other speakers are the distinct voices detected automatically in the meeting audio ',
    'note.noticeNamed': '(some named by hand after the meeting, the others numbered “Speaker n”): ',
    'note.noticeNumbered':
      '(“Speaker 1, 2...”, real names unknown, they can often be inferred from the conversation): ',
    'note.noticeLimits':
      'two people with similar voices may share a number, and one person may get two. ' +
      'Sentences too short to identify the voice are marked “Participant”. ',
    'note.noticeAllFile': '“Participants” groups all the voices of the recording, without telling people apart. ',
    'note.noticeAll':
      '“Participants” groups all the other voices heard through the meeting audio, without telling people apart. ',
    'note.noticeTimes': 'Timestamps [hh:mm:ss] are relative to the start of the recording.',
    'note.noSpeech': '_No speech detected._',
    'note.pause': '_[{from} to {to}] Recording paused._',
    'note.gap': '_[{from} to {to}] Passage not transcribed ({who}): the engine failed on this passage._',
    'note.line': '**[{t}] {name}:** {text}',
    'note.fileName': 'meeting',
    'note.defaultTitle': 'Meeting',
    'note.sourceFile': 'file “{name}”',
    'note.sourceLive': 'live meeting',
    'note.varLangs.fr': 'French',
    'note.varLangs.en': 'English',
    'note.varLangs.auto': 'French and English',

    'vocab.cyber': 'Cybersecurity',
    'vocab.it': 'IT and cloud',
    'vocab.projet': 'Project management',

    'audio.wavNoFmt': 'Incomplete WAV file (sound description missing).',
    'audio.wavCodec': 'This WAV file uses an unsupported compressed encoding.',
    'audio.wavNoData': 'WAV file without audio data.',
    'audio.noMp3': 'No readable MP3 frame in this file.',
    'audio.noAac': 'No readable AAC frame in this file.',
    'audio.mp4NoIndex': 'Incomplete MP4 file (index missing): interrupted recording?',
    'audio.noTrack': 'This file has no audio track.',
    'audio.mp4Codec': 'Audio encoding “{type}” not supported in this MP4 file.',
    'audio.noAacConfig': 'AAC configuration not found in this file.',
    'audio.oggBad': 'Unreadable Ogg page: damaged file?',
    'audio.webmBad': 'Damaged WebM file (element of unknown size).',
    'audio.webmNoTrack': 'This WebM file has no audio track.',
    'audio.webmLacing': 'WebM file with grouped blocks (“lacing”) not supported.',
    'audio.decoderFailed': 'The browser decoder failed on this file: {error}',
    'audio.tooLong': 'This format is only read for short files (25 MB at most): convert it to MP3 or M4A, or split it.',
    'audio.unknownFormat':
      'Audio format not recognized by this browser. Formats read: WAV, MP3, M4A/AAC, OGG/Opus, WebM.',
  };

  const CATALOGS = { fr, en };

  // ---------------------------------------------------------------------------
  // Langue courante
  // ---------------------------------------------------------------------------
  function stored() {
    try {
      const v = root.localStorage.getItem(KEY);
      return LANGS.includes(v) ? v : null;
    } catch {
      return null;
    }
  }

  /** Langue déduite du navigateur : « fr », « fr-FR », « fr-CA »... donnent le français, le reste l'anglais. */
  function detect(nav = root.navigator) {
    const l = String((nav && nav.language) || '');
    return /^fr\b/i.test(l) ? 'fr' : 'en';
  }

  let current = stored() || detect();
  const listeners = new Set();

  const lang = () => current;

  /**
   * Relit le choix enregistré (après la restauration des réglages depuis app/reglages.txt) et
   * réapplique la langue si elle a changé.
   */
  function reload() {
    const next = stored() || detect();
    if (next !== current) {
      current = next;
      apply();
      for (const fn of listeners) fn(current);
    }
  }

  /** Change la langue : mémorisée, appliquée aux textes fixes, puis signalée aux écouteurs. */
  function setLang(l) {
    if (!LANGS.includes(l)) return;
    try {
      root.localStorage.setItem(KEY, l);
    } catch {
      /* stockage indisponible : le choix vaut pour cette page seulement */
    }
    if (l === current) return;
    current = l;
    apply();
    for (const fn of listeners) fn(current);
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /**
   * Paramètres régionaux des dates et des heures. Anglais : ceux du navigateur s'il est en anglais
   * (en-US, en-GB...), sinon en-GB (jour, mois, année ; heures sur 24 h).
   */
  function locale(l = current) {
    if (l === 'fr') return 'fr-FR';
    const nav = String((root.navigator && root.navigator.language) || '');
    return /^en\b/i.test(nav) ? nav : 'en-GB';
  }

  /** Texte du catalogue. Clé absente : repli sur le français, puis sur la clé (erreur visible). */
  function t(key, vars, l = current) {
    const cat = CATALOGS[l] || fr;
    let entry = key in cat ? cat[key] : fr[key];
    if (entry === undefined) return key;
    if (typeof entry === 'function') return entry(vars || {});
    if (vars) entry = entry.replace(/\{(\w+)\}/g, (all, k) => (k in vars ? String(vars[k]) : all));
    return entry;
  }

  /** Applique la langue aux textes fixes d'un document (la page, ou la mini-fenêtre). */
  function apply(doc = root.document) {
    if (!doc || !doc.querySelectorAll) return;
    if (doc.documentElement) doc.documentElement.lang = current;
    for (const el of doc.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of doc.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
    for (const el of doc.querySelectorAll('[data-i18n-attr]')) {
      for (const pair of el.dataset.i18nAttr.split(';')) {
        const [attr, key] = pair.split(':').map((x) => x.trim());
        if (attr && key) el.setAttribute(attr, t(key));
      }
    }
  }

  /** Clés présentes dans un catalogue et absentes de l'autre (test de complétude). */
  function missing() {
    const out = [];
    for (const k of Object.keys(fr)) if (!(k in en)) out.push('en:' + k);
    for (const k of Object.keys(en)) if (!(k in fr)) out.push('fr:' + k);
    return out;
  }

  Lowsper.i18n = { KEY, LANGS, CATALOGS, detect, lang, setLang, reload, onChange, locale, t, apply, missing };
  Lowsper.t = t;
  apply();
})();
