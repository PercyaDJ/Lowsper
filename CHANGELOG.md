# Journal des modifications

Toutes les évolutions notables de Lowsper sont consignées ici.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet respecte le
[versionnage sémantique](https://semver.org/lang/fr/) :
- **majeur** : un changement qui oblige l'utilisateur à agir (format de `app/models` ou de
  `app/reglages.txt` incompatible, navigateur abandonné) ;
- **mineur** : une fonctionnalité nouvelle, sans rien casser ;
- **correctif** : une correction, sans changement de comportement attendu.

Les détails techniques et les mesures sont dans `decision.md`.

## [Non publié]

### Ajouté
- **Vocabulaire métier « IA et informatique »** (« AI and computing » en anglais), à cocher dans
  Paramètres, Transcription, Vocabulaire métier : IA, LLM, carte graphique, GPU, RAM, prompt, RAG,
  fine-tuning, et quelques langages et logiciels libres très courants (Python, Linux, Git...).
  Mesuré sur un corpus fictif en français : 24 termes sur 31 bien écrits avec la liste, contre 15
  sans (decision.md §44). Les vocabulaires déjà cochés ne changent pas.
- Outils de mesure (développeurs) : `eval-vocab.mjs --corpus=vocab-ia` (corpus « IA et
  informatique », français et anglais) ; `eval-separation.mjs --model=convtasnet` et
  `export-convtasnet.py`, étude d'une séparation des voix plus légère que MossFormer2, non intégrée
  (decision.md §44).
- Outils de mesure (développeurs) : le banc `tools/test/eval-summary.mjs` mesure les modèles
  Qwen3 et peut ne donner au modèle que le compte rendu extractif (`--extrait`). Étude du lot C3 :
  aucun compte rendu rédigé par une IA locale n'est intégré, le seul modèle qui tient dans le
  navigateur inventant des chiffres, des dates ou des personnes (decision.md §43). Rien ne change
  pour l'utilisateur.

## [4.4.0] - 2026-11-07

Rien à faire en passant à cette version : copiez `app\models`, `app\reglages.txt` et `Notes` comme
d'habitude.

### Ajouté
- **Notes rapides pendant la réunion** (lot C2) : un champ « Note rapide » dans la fenêtre de
  Lowsper ; Entrée ajoute la note, « Retirer » l'enlève. Les notes sont reprises dans la note,
  section « Vos notes » (« Your notes » en anglais), après le compte rendu et avant le transcript,
  chacune avec l'heure où vous avez commencé à la taper. Une note tapée sans Entrée au moment de
  terminer est gardée. Elles restent sur le PC et sont conservées par la sauvegarde de secours.
- **Consigne « E-mail de suivi »** pour « Obtenir un résumé », en français et en anglais :
  l'e-mail à envoyer aux participants (objet, décisions, actions, questions ouvertes, prochaine
  étape), sans signature, avec entre crochets ce qu'il faut vérifier avant l'envoi.
- Variable `{{notes}}` pour les modèles de note, présente dans le modèle par défaut.
- **Publication d'une release lancée à la main** (mainteneur) : le workflow « Paquet de release »
  se lance aussi depuis l'onglet Actions avec le tag voulu. Il crée la release depuis `main`, avec
  le texte du CHANGELOG, puis joint le paquet ; ou il complète une release déjà publiée sans
  paquet (decision.md §42).

### Modifié
- Un modèle de note par défaut jamais modifié (versions précédentes) reçoit la section « Vos
  notes » avant le transcript. Un modèle que vous avez modifié reste tel quel ; s'il n'a pas
  `{{notes}}`, vos notes rapides sont ajoutées à la fin de la note, pour ne jamais les perdre.

### Corrigé
- **Release 4.3.0 sans paquet** : le numéro de version avait été oublié dans `tools/package.json`,
  et le workflow refusait de construire `Lowsper-4.3.0.zip`. Le paquet est joint à la release
  4.3.0 par le lancement manuel ci-dessus, construit depuis son tag (non déplacé).

## [4.3.0] - 2026-11-07

Rien à faire en passant à cette version : copiez `app\models`, `app\reglages.txt` et `Notes` comme
d'habitude.

### Ajouté
- **Compte rendu en haut de la note** (lot C1) : Lowsper recopie mot pour mot les phrases
  prononcées qui portent une décision, une action ou une question restée ouverte, avec leur
  horodatage et la personne, rangées en « Décisions », « Actions » et « Questions ouvertes ». Le
  transcript complet reste dessous, inchangé. Rien n'est réécrit ni inventé : chaque phrase est
  copiée telle quelle du transcript. Français et anglais, hors ligne, sans modèle à télécharger.
  Mesuré sur des réunions fictives jamais utilisées pour le réglage, de l'audio jusqu'à la note :
  52 % des phrases retrouvées en français, 70 % en anglais, 81 à 82 % des phrases recopiées justes
  (sur le texte exact : 61 % et 73 %, 86 à 87 % ; decision.md §40).
- Variable `{{compte_rendu}}` pour les modèles de note, présente dans le modèle par défaut.
- Outils de mesure (développeurs) : corpus fictifs annotés (`tools/test/corpus/compte-rendu*.json`),
  générateur audio `make-cr.py` et banc `tools/test/eval-extract.mjs`.

### Modifié
- **Les notes ont une section « Compte rendu » de plus**, avant le transcript, activée par défaut.
  Pour la retirer : Paramètres, Notes et compte rendu, « Recopier les décisions, actions et
  questions en haut de la note ». Les modèles de note que vous avez modifiés ne changent pas.

## [4.2.2] - 2026-11-07

Rien à faire en passant à cette version : copiez `app\models`, `app\reglages.txt` et `Notes` comme
d'habitude.

### Corrigé
- **Écho des haut-parleurs attribué à « Vous »** (micro sans casque) : une phrase du micro est
  désormais comparée à tout ce que les participants ont dit autour, et plus à une seule de leurs
  phrases. Quand Whisper découpait l'écho autrement que l'original, il restait dans la note.
  Mesuré sur un corpus de paroles simultanées : 118,5 % d'erreurs sur « Vous » avant, 48,1 % après,
  sans aucune de vos phrases perdue (decision.md §39).

### Ajouté
- Outils de mesure (développeurs) : corpus de paroles simultanées
  (`tools/test/corpus/make-overlap.py`), bancs `eval-overlap.mjs`, `eval-separation.mjs` (séparation
  des voix) et `eval-kyutai.py` (Kyutai STT). Étude complète dans decision.md §39.

## [4.2.1] - 2026-11-07

Corrections du premier lancement et du dossier Lowsper. Rien à faire en passant à cette version :
copiez `app\models`, `app\reglages.txt` et `Notes` comme d'habitude.

### Corrigé
- **Fenêtre d'accès au dossier d'une ancienne version** (« Lowsper-3.4.0 », même supprimé) :
  toutes les copies de Lowsper ouvertes depuis le disque partagent la mémoire du navigateur, et la
  4.x réutilisait l'accès rangé par une copie précédente. Elle aurait pu y écrire ses réglages et
  ses notes. Un accès qui ne correspond pas au dossier de la page est désormais oublié sans rien
  demander, et le dossier est vérifié avant toute écriture (decision.md §38).
- **Chemin du dossier absent de l'écran de bienvenue** depuis la 4.0.0 : deux éléments de la page
  portaient le même identifiant, et le chemin s'écrivait dans la page « Dossier » des paramètres,
  qu'il effaçait.
- **Choix du dossier plus simple** : choisir un dossier qui contient le dossier Lowsper suffit
  (le premier des deux dossiers `Lowsper-X.Y.Z` créés par « Extraire tout » de Windows, ou
  Téléchargements). Lowsper retrouve celui de la page ouverte. Consigne de l'écran réécrite.
- Journal des modifications : liens de comparaison des versions 4.0.0, 4.1.0 et 4.2.0 ajoutés, lien
  « Non publié » à partir de la 4.2.0.

## [4.2.0] - 2026-11-07

Mémoire des voix d'une visio à l'autre (lot R9). Rien à faire en passant à cette version : copiez
`app\models`, `app\reglages.txt` et `Notes` comme d'habitude ; les voix déjà mémorisées restent
reconnues.

### Modifié
- **Mémoire des voix plus sûre quand une personne change de micro** : Lowsper garde jusqu'à cinq
  empreintes par personne (une par réunion où vous la nommez ou corrigez son nom) et compare
  chaque voix à la plus proche. Une voix qui ressemble presque autant à deux personnes ne reçoit
  aucun nom. Mesuré sur un corpus synthétique de cinq appareils simulés (decision.md §37) : les
  confusions passent de 12-15 % à 1-4 %, et les personnes de passage nommées à tort de 79-83 % à
  0-8 %. En contrepartie, une voix est plus souvent laissée sans nom (65 à 71 % reconnues, contre
  84 à 87 %) : nommez-la une fois sur ce nouvel appareil, elle sera reconnue ensuite.
- **Effacement automatique par empreinte** : chaque empreinte est effacée 1, 3 ou 6 mois après sa
  création ; une personne est oubliée quand il ne lui en reste aucune.

### Ajouté
- Outils de mesure (développeurs) : corpus `tools/test/corpus/make-voices.py`, calcul des
  empreintes `tools/test/embed-voices.mjs`, banc `tools/test/eval-voices.mjs`.

## [4.1.0] - 2026-11-06

Langues parlées multiples et vocabulaires métier élargis (lot R8). Rien à faire en passant à cette
version : copiez `app\models`, `app\reglages.txt` et `Notes` comme d'habitude ; l'ancien réglage
de langue parlée est relu tel quel.

### Ajouté
- **Plusieurs langues parlées** : « Langues parlées dans mes réunions » devient une liste à
  cocher. Lowsper reconnaît la langue de chaque passage parmi celles cochées. Onze langues
  proposées après mesure sur un corpus synthétique (decision.md §34) : français, anglais, espagnol,
  allemand, portugais, néerlandais, arabe, japonais, et, avec la mention « reconnaissance moins
  fiable », mandarin, italien et coréen. Chaque langue est écrite dans sa propre langue
  (« Español », « 日本語 »), traduite dessous.
- **Neuf vocabulaires métier** : santé, juridique, finance et comptabilité, ressources humaines,
  éducation, commerce et marketing, secteur public, ingénierie et industrie, immobilier, en plus
  des trois existants. Tous en français et en anglais ; chaque passage reçoit les termes de sa
  langue. Format pour en proposer d'autres dans `CONTRIBUTING.md`.
- Bancs de mesure `eval-langs` et `eval-vocab`, corpus synthétiques multilingues (voix Piper).

### Modifié
- **Plusieurs vocabulaires cochés** : leurs termes sont alternés dans le contexte donné à Whisper,
  si bien que chacun garde ses meilleurs termes. Avant, la dernière liste du catalogue prenait
  toute la place et la première était presque effacée (mesure : 35 termes sur 44 bien écrits au
  lieu de 32, decision.md §35).
- La correction de casse garde la majuscule d'un début de phrase (« Planning validé » ne devient
  plus « planning validé »).
- Actions GitHub des workflows passées sur Node.js 24 (`actions/checkout` v7.0.1,
  `actions/setup-node` v7.1.0), toujours figées sur leur empreinte : Node.js 20 est déprécié sur
  les machines de GitHub.

### Corrigé
- **La langue parlée choisie n'était plus prise en compte depuis la 4.0.0** : Lowsper transcrivait
  toujours en français, même réglé sur l'anglais, et la note indiquait « Langue : undefined ».
- Écran de bienvenue : la fenêtre de choix du dossier Lowsper s'ouvre sur Téléchargements, et non
  plus sur Documents ; la page ne se décale plus quand la barre de défilement apparaît
  (« Déjà installé ailleurs »).

### Sécurité
- Correction d'un blocage de la page (ReDoS) : une correction de mot mêlant espaces et tirets
  (« a - - - - b »), saisie à la main ou venue d'un fichier de réglages importé, pouvait figer
  Lowsper plusieurs secondes, voire indéfiniment, sur un texte contenant une longue suite de
  tirets. Signalé par l'analyse Semgrep de Lysbor, mesuré, corrigé et couvert par un test
  (decision.md §33). Les corrections habituelles fonctionnent comme avant.
- Résultats Lysbor traités : deux messages de console à format constant ; trois faux positifs
  justifiés et marqués dans le code (icône intégrée à la page, expression du glossaire mesurée
  sans risque).

## [4.0.0] - 2026-11-06

Refonte de l'interface (lots R1 à R7). Version majeure : les notes vont désormais dans le dossier
Lowsper (`Notes\<emplacement>`) et non plus dans les Téléchargements. En passant à cette
version, copiez `app\models` et `app\reglages.txt` de l'ancienne version vers la nouvelle, comme
d'habitude ; aux mises à jour suivantes, copiez aussi le dossier `Notes`. Les réglages ne
demandent aucune action : leur format ne change pas.

### Documentation (4.0.0)
- La page d'accueil du dépôt passe en anglais (`README.md`), avec sa version française
  (`README.fr.md`) et un lien de bascule de l'une à l'autre. Les deux tiennent sur une page ; le
  guide complet (écrans, questions fréquentes, limites) est dans `docs/guide.md` (decision.md
  §31). `README.en.md` disparaît, remplacé par `README.md`.

### Sécurité (4.0.0)
- Suivi des vulnérabilités par l'agent Lysbor : inventaire des dépendances (Syft), analyse du code
  (Semgrep) et de la configuration (Trivy), envoyés à Lysbor chaque mois et à chaque changement
  des dépendances sur `main`. Le workflow ne bloque rien ; il n'envoie que des informations sur ce
  dépôt public, jamais de donnée d'utilisateur (decision.md §32).
- Les actions GitHub des workflows sont figées sur l'empreinte de leur version (v4.4.0) au lieu
  d'une étiquette modifiable.

### Ajouté
- Interface en français et en anglais (lot R2) : Lowsper prend la langue du navigateur, et le
  réglage « Langue de l'interface » (paramètres, « Affichage ») la change sans recharger. Le
  choix est gardé avec les autres réglages, y compris dans `app/reglages.txt` (decision.md §25).
- Note en anglais quand l'interface est en anglais au début de la réunion : en-tête et libellés
  traduits (« Speaker 1 », « You »...), fichier `meeting_...md`. Les noms des variables de
  modèle et les clés du front matter ne changent pas.
- Consignes fournies pour « Copier pour une IA » en français et en anglais. Une consigne modifiée
  par l'utilisateur ne change jamais.

### Ajouté (lot R7)
- Paramètres en trois onglets : Transcription, Notes et compte rendu, Avancé (decision.md §30).
  Listes groupées ; chaque élément à choix ouvre un sous-écran (« ‹ Paramètres » ou Échap pour
  revenir). Plus aucune liste déroulante native : les choix sont dessinés par Lowsper,
  utilisables au clavier.
- « Exporter les réglages dans un fichier » et « Importer des réglages depuis un fichier »
  (onglet Avancé), pour déplacer les réglages vers un autre PC. Les voix mémorisées, le modèle et
  les mesures de vitesse ne sont pas exportés. L'import accepte aussi une copie de
  `app/reglages.txt`.
- « Télécharger le journal technique » dans les paramètres (Avancé, Aide), en plus de l'écran de
  fin.

### Modifié (lot R7)
- **Changement visible : les notes vont désormais dans `Notes\<emplacement>`, dans le dossier
  Lowsper** (par exemple `Notes\Par défaut`), et non plus dans les Téléchargements. Les
  emplacements qui avaient un dossier choisi le gardent. Le nom du sous-dossier est figé à la
  première note : renommer l'emplacement ne disperse pas les notes. Sans accès au dossier
  Lowsper (Firefox, accord jamais donné), la note va dans les Téléchargements, comme avant. En
  changeant de version de Lowsper, copiez aussi le dossier `Notes`.
- Nouveaux noms, chacun expliqué sous sa ligne : « Sigles et noms propres » devient « Mots à
  reconnaître », « Mots que Whisper déforme » devient « Corrections automatiques », « Profil »
  devient « Emplacement », le format classique ou à modèle devient « Format de la note » (« Texte
  simple » ou « Pour les applications de notes »).
- Le bouton « Conserver mes réglages dans le dossier Lowsper » disparaît : l'accord est demandé à
  l'installation, sinon à la fermeture des paramètres. Une phrase sous « Mots » dit si les
  réglages sont enregistrés dans le dossier Lowsper.
- Le format de `app/reglages.txt` ne change pas ; un emplacement gagne seulement un champ
  facultatif (`subfolder`). Aucune migration.

### Tests (lot R7)
- `npm run test:settings` (aussi en CI) : onglets au clavier, sous-écrans, listes dessinées,
  nouveaux noms, export et import.
- Les tests de bout en bout lisent les notes dans `Notes\Par défaut` quand le dossier Lowsper est
  accordé.

### Ajouté (lot R6)
- Écran de fin en deux colonnes (decision.md §29). À gauche, le texte de la réunion, lisible (plus
  de Markdown brut) : un clic sur « Intervenant 2 » permet de taper le vrai nom, qui change
  partout. À droite, « Note enregistrée » (mise à jour à chaque correction) et « Et maintenant ? » :
  « Obtenir un résumé », « Voir ce qui est copié », « Copier le texte », « Enregistrer une copie »,
  puis « Corriger un mot mal reconnu » et « Nouvelle réunion ».

### Modifié (lot R6)
- Les trois consignes fournies (compte rendu de réunion, synthèse d'appel, liste d'actions) sont
  réécrites comme un prompt système : rôle, contexte, tâche, règles, puis le transcript, en
  français et en anglais. Elles demandent la langue principale du transcript. Une consigne que
  vous aviez laissée telle quelle passe au nouveau texte ; une consigne modifiée, même d'un
  caractère, est gardée telle quelle.
- « Copier pour une IA » devient « Obtenir un résumé ». La consigne se choisit dans un menu
  dessiné par Lowsper, sous le bouton.
- « Nouvelle réunion » ramène à l'accueil : « Démarrer la réunion suivante » et « Retour à
  l'accueil » sont fusionnés (choix du mainteneur). Pour enchaîner sans arrêter, « Commencer une
  nouvelle réunion sans arrêter » reste dans la fenêtre de réunion.
- Le panneau « Intervenants détectés » disparaît : on renomme directement sur les répliques. La
  mémoire des voix apprend le nom quand la saisie est validée, comme avant.
- « Corriger un mot mal reconnu » s'ouvre dans une fenêtre.
- La note en français produite par le format classique ne change pas.

### Ajouté (lot R5)
- Fenêtre de réunion : grand chronomètre, nom de la réunion modifiable, contrôle d'état en langage
  simple (micro, son de la réunion, texte écrit) avec « Comment corriger », trois gros boutons
  (Pause, Réduire, Terminer), « Commencer une nouvelle réunion sans arrêter » (decision.md §28).
- Mini-fenêtre de 248 × 52 : temps, niveaux du micro et du son de la réunion, Pause, Terminer ;
  icône orange si le son de la réunion n'arrive pas.
- Page d'essai `tools/test/pip-sizes.html` : tailles acceptées par la mini-fenêtre.

### Modifié (lot R5)
- Le texte en direct est masqué par défaut pendant la réunion ; un interrupteur l'affiche (choix
  gardé).
- La mini-fenêtre ne montre plus la dernière phrase ni les avis.
- Alerte « Rien ne passe depuis 1 min » quand aucune parole n'arrive du son de la réunion ; pas
  d'alerte de silence pour le micro.

### Ajouté (lot R4)
- Nouvel accueil : un titre, « Nom », « Enregistrer la note dans » (menu dessiné par Lowsper, avec
  le dossier de chaque profil et « Nouvel emplacement… »), « Démarrer » et « Transcrire un fichier
  audio » (decision.md §27).
- Fenêtre « Avant de commencer » : prévenir les participants, choisir l'écran avec le son,
  autoriser le micro ; « Ne plus afficher », réversible dans les paramètres.
- Pastille « Reste sur ce PC » dans l'en-tête.

### Modifié (lot R4)
- Le bandeau jaune permanent et « Comment ça marche ? » disparaissent de l'accueil.
- Le nombre de personnes passe dans les paramètres (« Nombre de personnes dans vos réunions ») :
  vide par défaut, gardé d'une réunion à l'autre. C'est un plafond pour la distinction des voix.

### Ajouté (lot R3)
- Écran de bienvenue au premier lancement : ce que Lowsper détecte sur le PC (processeurs,
  mémoire, carte graphique), le modèle « Le meilleur pour ce PC » coché d'office, les modèles
  inutilisables grisés avec leur raison, le dossier affiché, un seul bouton « Télécharger et
  installer ». La langue se choisit dans l'en-tête de cet écran (decision.md §26).
- Banc `npm run bench -- --cores` : vitesse de chaque modèle selon le nombre de moteurs.

### Modifié (lot R3)
- Un seul modèle se choisit à la fois (Whisper base reste ajouté d'office avec Whisper small, en
  secours). Recommandation : Whisper small à partir de 5 processeurs logiques et 4 Go de mémoire,
  Whisper base en dessous ; règle provisoire, mesurée sur une seule machine.
- Changement visible : un modèle « carte graphique » ne s'installe plus sur un PC sans carte
  compatible (il est grisé). Pour équiper un PC qui en a une, installez depuis ce PC.

### Modifié
- La note en français reste identique au caractère près (vérifié sur 33 sorties de 5 réunions
  fictives, ancien et nouveau code).
- La langue de l'interface ne se change pas pendant une réunion, une finalisation ou un import.

### Tests
- `npm run test:i18n` (aussi en CI) : catalogue complet dans les deux langues, texte de la page
  identique au catalogue français, aucun reste de français en anglais, bascule de langue.
- Les tests de bout en bout et les captures imposent le français (`locale: 'fr-FR'`).
- `npm run test:home` (aussi en CI) : accueil, menu au clavier, fenêtre « Avant de commencer »,
  nombre de personnes dans les paramètres.
- `npm run test:welcome` (aussi en CI) : écran de bienvenue avec matériel simulé, recommandation,
  menu de langue au clavier, modèles téléchargés et dossier choisi une seule fois.

## [3.5.0] - 2026-11-05

### Modifié
- Nouveau style, début de la refonte (lot R1) :
  - couleurs neutres teintées de vert, thème sombre gris sapin ;
  - police du système, boutons arrondis, interrupteurs, réglages en listes groupées ;
  - logo vert sauge (decision.md §24).

### Ajouté
- Thème clair ou sombre : il suit le système, se bascule d'un clic dans l'en-tête et se règle dans « Affichage ».

### Documentation
- Plan des lots de la refonte et texte d'ouverture de chaque session (`docs/lots.md`).
- Spécifications de la refonte de l'interface (`docs/refonte.md`) : style, parcours, langues,
  réglages, consigne de compte rendu réécrite, points à mesurer avant développement.

## [3.4.1] - 2026-11-05

### Corrigé
- Brave : au lieu de « utilisez Edge ou Chrome », Lowsper explique comment autoriser l'écriture
  dans un dossier (`brave://flags`, « File System Access ») ou installer le modèle avec Edge.
  Même chose pour Firefox, et pour le choix du dossier d'un profil, qui affichait une erreur
  technique.
- Rapport de la sonde d'IA intégrée : il indique le navigateur réellement utilisé (Brave
  s'identifie comme Chrome).

## [3.4.0] - 2026-11-05

### Ajouté
- Sonde de l'IA intégrée du navigateur (expérimental), dans les paramètres : indique si Chrome ou
  Edge peut rédiger des résumés en français sur ce PC, sans rien télécharger ; essai facultatif
  sur une réunion fictive, faits retrouvés comptés, rapport à copier. Aucun vrai transcript n'est
  lu (decision.md §23).

### Modifié
- Le banc `tools/test/eval-summary.mjs` lit son exemple, sa consigne et ses faits dans
  `app/js/localai.js`.

## [3.3.0] - 2026-11-05

### Ajouté
- Consignes pour l'IA : « Copier pour une IA » propose un compte rendu de réunion (texte
  inchangé), une synthèse d'appel ou une liste d'actions ; consignes modifiables, personnelles,
  à variables, rattachées à chaque profil (decision.md §21).
- Étude d'un résumé 100 % local dans le navigateur, avec mesures et recommandation
  (decision.md §22) ; banc reproductible `tools/test/eval-summary.mjs`. Rien n'est intégré.

## [3.2.0] - 2026-11-05

### Ajouté
- Profils de sortie (« Personnel », « Travail »...) : dossier de destination, nom de fichier à
  variables, propriétés en tête de note (front matter YAML), modèle de note éditable, intervenants
  nommés en liens `[[Nom]]`. Choix du profil sur l'écran d'accueil (decision.md §20).
- La note est écrite directement dans le dossier du profil, puis mise à jour à chaque correction
  sur l'écran de fin ; repli sur les Téléchargements quand le navigateur demande son accord, avec
  un bouton pour enregistrer dans le dossier.

### Modifié
- Le profil « Par défaut » garde exactement le format classique et les Téléchargements.

## [3.1.0] - 2026-11-05

### Ajouté
- Import de fichiers audio : bouton « Transcrire un fichier » et glisser-déposer, plusieurs
  fichiers traités en file, WAV, MP3, M4A/AAC, OGG/Opus et WebM, de quelques secondes à plusieurs
  heures, avec le même moteur que le direct (détection de parole, intervenants, glossaire,
  corrections). Mémoire bornée, avancement et temps restant, annulation (decision.md §19).
- En-tête des transcripts importés : source « fichier », date d'enregistrement quand le fichier la
  contient, sinon date du fichier présentée comme telle, durée, date d'import.
- Tests : lecteurs de conteneur (unitaires), décodage dans le navigateur (en CI), import de bout
  en bout et décodage de fichiers de 3 h (manuels).

## [3.0.2] - 2026-11-05

### Ajouté
- Paquet de distribution `Lowsper-X.Y.Z.zip` joint à chaque release, avec son empreinte SHA-256 :
  seulement la page et ses fichiers, reproductible à l'identique (decision.md §18.1).
- Documentation : `README.en.md` (résumé en anglais), `docs/architecture.md`, `docs/deploiement.md`
  (guide DSI et RSSI), `CODE_OF_CONDUCT.md`, captures d'écran sur une réunion fictive.

### Modifié
- README réorganisé pour un premier visiteur : pour qui, comparatif, installation depuis la
  release, limites connues, feuille de route.

## [3.0.1] - 2026-11-05

### Corrigé
- Moteur : un passage long et dense, avec un glossaire ou un vocabulaire métier bien rempli, pouvait
  faire échouer Whisper (contexte et texte généré au-delà de sa fenêtre de 448 jetons) ; il était
  alors signalé « Passage non transcrit ». Le contexte est désormais raccourci quand la place manque
  (decision.md §17.8).
- `node build.mjs` fonctionne sur un clone neuf : Silero VAD et WeSpeaker se téléchargent avec
  `fetch-model.mjs`, et le build vérifie tout avant de toucher à `app/engine`.
- `fetch-model.mjs` télécharge la révision figée, et non la dernière version publiée.
- Banc de vitesse (`npm run bench`) de nouveau utilisable : il lit le modèle installé.
- Documentation alignée sur le code : Firefox, WebGPU, distinction des intervenants, son gardé en
  mémoire.

### Ajouté
- Intégration continue : lint, formatage, tests unitaires et test de non-fuite réseau à chaque
  pull request.
- Test de non-fuite réseau rapide (`tools/test/csp.mjs`) : politique de sécurité, absence d'API
  réseau hors installateur, et blocage vérifié dans un vrai navigateur.
- Verrou des modèles (`tools/models.lock.json`) : révision et empreinte de chaque fichier, y compris
  la détection de parole et les empreintes vocales.
- `SECURITY.md` (modèle de menace), `CONTRIBUTING.md`, `AGENTS.md`, modèles d'issue et de pull
  request.
- Script de génération des variantes « son de visio » et « écho » du corpus de test.

### Modifié
- Exemples de l'interface, de la documentation et des tests : noms entièrement fictifs.
- Corpus d'entretien régénéré avec un employeur fictif ; mesures de §15.15 refaites (decision.md §17.6).

## [3.0.0] - 2026-10-19

Première version taguée. Elle correspond à l'état du projet après huit itérations ; les versions
antérieures n'ont pas été taguées (la numérotation reprend la « version 3 » de `decision.md` §15).

### Fonctionnalités
- Transcription en direct, 100 % locale, du micro (« Vous ») et du son partagé de la réunion,
  avec Whisper (small, base, small carte graphique, large-v3 turbo) dans le navigateur.
- Installation du modèle au premier lancement, à une révision figée, contrôlée par empreinte.
- Détection de parole Silero, distinction et renommage des intervenants, mémoire des voix
  facultative.
- Glossaire, vocabulaires métier intégrés, corrections de mots apprises.
- Anti-écho par la voix, filtres d'hallucinations et de répétitions.
- Mini-fenêtre, enchaînement de réunions sans temps mort, niveaux de puissance, voie rapide.
- Filet de sécurité : relance du moteur, rattrapage de la parole manquée, couverture affichée,
  journal technique.
- Réglages copiés dans le dossier (`app/reglages.txt`), restaurés après un nettoyage du navigateur.

[Non publié]: https://github.com/PercyaDJ/Lowsper/compare/v4.4.0...HEAD
[4.4.0]: https://github.com/PercyaDJ/Lowsper/compare/v4.3.0...v4.4.0
[4.3.0]: https://github.com/PercyaDJ/Lowsper/compare/v4.2.2...v4.3.0
[4.2.2]: https://github.com/PercyaDJ/Lowsper/compare/v4.2.1...v4.2.2
[4.2.1]: https://github.com/PercyaDJ/Lowsper/compare/v4.2.0...v4.2.1
[4.2.0]: https://github.com/PercyaDJ/Lowsper/compare/v4.1.0...v4.2.0
[4.1.0]: https://github.com/PercyaDJ/Lowsper/compare/v4.0.0...v4.1.0
[4.0.0]: https://github.com/PercyaDJ/Lowsper/releases/tag/v4.0.0
[3.5.0]: https://github.com/PercyaDJ/Lowsper/compare/v3.4.1...v3.5.0
[3.4.1]: https://github.com/PercyaDJ/Lowsper/compare/v3.4.0...v3.4.1
[3.4.0]: https://github.com/PercyaDJ/Lowsper/compare/v3.3.0...v3.4.0
[3.3.0]: https://github.com/PercyaDJ/Lowsper/compare/v3.2.0...v3.3.0
[3.2.0]: https://github.com/PercyaDJ/Lowsper/compare/v3.1.0...v3.2.0
[3.1.0]: https://github.com/PercyaDJ/Lowsper/compare/v3.0.2...v3.1.0
[3.0.2]: https://github.com/PercyaDJ/Lowsper/compare/v3.0.1...v3.0.2
[3.0.1]: https://github.com/PercyaDJ/Lowsper/compare/v3.0.0...v3.0.1
[3.0.0]: https://github.com/PercyaDJ/Lowsper/releases/tag/v3.0.0
