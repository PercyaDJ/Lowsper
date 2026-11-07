# Refonte : plan des lots

Une session de travail égale un lot, et chaque lot égale une pull request. Ce fichier dit :
- ce qui reste à faire, dans l'ordre ;
- ce que chaque lot doit livrer ;
- le texte à donner pour ouvrir la session suivante.

Les spécifications détaillées sont dans [refonte.md](refonte.md). Les maquettes validées sont
sur le canevas de conception du mainteneur, hors du dépôt.

Chaque lot respecte `AGENTS.md`, et en particulier :
- tests unitaires et de bout en bout verts ;
- test de non-fuite réseau vert ;
- captures sans donnée réelle ;
- README, CHANGELOG, `decision.md` et `AGENTS.md` à jour ;
- mesure de la charge du moteur avant et après, si le direct est touché ;
- une PR relisible en 15 minutes.

À la fin de chaque lot, mettre à jour l'état dans le tableau ci-dessous.

**Versions** (décision du mainteneur) :
- les lots R2 à R7 sont publiés ensemble en version 4.0.0 (décision du 6 novembre 2026 : publier
  sans attendre R8 et R9) ;
- R8 et R9 ont chacun leur version mineure (4.1.0, puis 4.2.0) : le lot passe la version de
  `tools/package.json`, renomme la section « Non publié » du CHANGELOG, puis le mainteneur publie
  la release correspondante.

| Lot | Contenu | Version | État |
|---|---|---|---|
| R1 | Fondations visuelles : couleurs, thème, style commun | 3.5.0 | Livré |
| R2 | Interface en français et en anglais | 4.0.0 | Livré |
| R3 | Premier lancement guidé | 4.0.0 | Livré |
| R4 | Accueil | 4.0.0 | Livré |
| R5 | Réunion : mini-fenêtre et fenêtre agrandie | 4.0.0 | Livré |
| R6 | Fin de réunion et consignes réécrites | 4.0.0 | Livré |
| R7 | Réglages en onglets | 4.0.0 | Livré |
| R8 | Langues parlées multiples et vocabulaires métier élargis | 4.1.0 | Livré |
| R9 | Mémoire des voix d'une visio à l'autre | 4.2.0 | Livré |

Après la refonte : correctif 4.2.1 (dossier Lowsper : accès d'une ancienne version oublié, chemin
de nouveau affiché à l'installation, dossier parent accepté ; `decision.md` §38). Correctif 4.2.2 :
étude du son de visio, des paroles simultanées et de l'écho, anti-écho corrigé (`decision.md` §39).

### Feuille de route suivante (validée par le mainteneur le 7 novembre 2026)

Cap : faire le travail d'un outil de compte rendu de réunion, mais sur le PC, sans installation et
hors ligne (après le téléchargement unique du modèle). Machine de référence : portable d'entreprise
sans carte graphique, 16 Go, Edge ou Chrome. Pas de discussion avec la réunion ; téléphone plus tard.

| Lot | Objectif | État |
|---|---|---|
| C1 | Compte rendu extractif : décisions, actions, questions ouvertes, recopiées mot pour mot avec leur horodatage en haut de la note, transcript complet dessous ; français et anglais ; mesuré sur un corpus fictif | Livré |
| C2 | Notes rapides tapées pendant la réunion, reprises dans la note ; consigne « e-mail de suivi » | Livré |
| C3 | Compte rendu rédigé par une IA locale, seulement là où une mesure sur le portable de référence le valide | À étudier |
| Étude | Séparation des voix plus légère ; vocabulaire « IA et informatique » | À étudier |

## C2 : notes rapides et e-mail de suivi (livré)

Livré, voir `decision.md` §41. Choix du mainteneur en cours de lot : section « Vos notes » après le
compte rendu et avant le transcript (variable `{{notes}}` ; un modèle modifié sans elle reçoit les
notes à la fin) ; saisie dans la fenêtre agrandie seulement, mini-fenêtre inchangée ; heure de la
première frappe. Consigne « E-mail de suivi » en français et en anglais, même structure que les
consignes du lot R6. Charge du moteur avant et après dans le bruit de mesure (0,462 et 0,448 en
médiane). Non vérifié : la qualité des e-mails rédigés par une IA, et la saisie sur le portable de
référence pendant une vraie visio.

## C1 : compte rendu extractif (livré)

Livré, voir `decision.md` §40. Règles explicites en français et en anglais (`app/js/extract.js`),
sans modèle ; chaque phrase recopiée est une sous-chaîne exacte du transcript. Choix du mainteneur
en cours de lot : activé par défaut avec un interrupteur dans « Notes et compte rendu » ; une ligne
le dit quand rien n'est repéré ; section placée avant le transcript ; variable `{{compte_rendu}}`
dans le modèle par défaut, modèles modifiés inchangés. Mesure qui fait foi, sur un second corpus
écrit à l'aveugle et jamais utilisé pour le réglage, de l'audio jusqu'à la note : 52 % des phrases
retrouvées en français, 70 % en anglais, 81 à 82 % de phrases justes, toutes bien rangées. Non vérifié : de vraies
réunions, et la vitesse sur le portable de référence.

## R1 : fondations visuelles (livré)

Neutres teintés de vert, clairs ou sombres. Le thème suit le système, avec une bascule dans
l'en-tête et le réglage « Affichage ». La police est celle du système. Boutons en pilule, cases à
cocher en interrupteurs, réglages en listes groupées. Voir `decision.md` §24.

## R2 : interface en français et en anglais (livré)

Livré tel que décrit ci-dessous, voir `decision.md` §25. Choix du mainteneur en cours de lot :
les noms des variables de modèle et les clés du front matter restent les mêmes dans les deux
langues ; en anglais, le fichier du format classique s'appelle `meeting_...md`. La note prend la
langue de l'interface au début de la réunion. Restent en français, volontairement : les termes
des vocabulaires métier (lot R8) et l'essai de l'IA intégrée sur la réunion fictive française.

- **Catalogue** : `app/js/i18n.js`, avec une fonction `t(clé, variables)` et deux catalogues
  complets (`fr`, `en`).
  - Textes fixes de `Lowsper.html` : attributs `data-i18n`, et `data-i18n-attr` pour
    `placeholder`, `aria-label` et `title`.
  - Textes de `app.js`, `notes.js`, `browser.js`, `localai.js` et `installer.js` : appels à `t()`.
  - Textes écrits en CSS (`content:`) : à déplacer dans le HTML ou le JavaScript.
- **Langue** :
  - celle du navigateur (`navigator.language`) : `fr*` donne le français, sinon l'anglais ;
  - un réglage « Langue de l'interface » la change, et le choix est mémorisé
    (`lowsper.opt.lang`).
- **Note produite** :
  - en français, elle reste identique au caractère près ;
  - en anglais, son en-tête et ses libellés (« Speaker 1 », « You »...) sont traduits ;
  - les consignes fournies existent dans les deux langues, et une consigne modifiée par
    l'utilisateur ne change jamais.
- **Tests** :
  - les tests de bout en bout imposent le français (option `locale: 'fr-FR'` du contexte
    Playwright) pour garder leurs vérifications ;
  - un nouveau test vérifie l'anglais, et qu'aucune clé ne manque dans l'un ou l'autre catalogue ;
  - le test unitaire du compte rendu par défaut reste identique en français.
- **Règle** : la contrainte n° 5 d'`AGENTS.md` passe à « interface en français et en anglais ».
  Le README anglais est mis à jour.

## R3 : premier lancement guidé (livré)

Livré, voir `decision.md` §26. Choix du mainteneur en cours de lot : un seul modèle à choisir
(comme la maquette) ; règle de recommandation mesurée sur le conteneur de développement, à
ajuster avec `npm run bench -- --cores` lancé sur un ou deux vrais PC ; `startIn` à vérifier par le
mainteneur avec `tools/test/startin.html`. Les modèles « carte graphique » ne sont jamais
recommandés d'office (vitesse non mesurée).

Voir `refonte.md` §2.
- **Avant de coder** : mesurer, avec `npm run bench`, la vitesse de Whisper base et de Whisper
  small selon le nombre de cœurs, pour fonder la règle de recommandation. Consigner les mesures
  dans `decision.md`.
- **Écran de bienvenue** :
  - ce qui a été détecté (cœurs, mémoire, carte graphique) ;
  - le modèle recommandé (« Best for this PC »), les autres au choix, les modèles inutilisables
    grisés avec leur raison ;
  - le dossier détecté ;
  - un seul bouton.
- **Accord du navigateur** : le même accord sert aussi à la copie automatique des réglages
  (`app/reglages.txt`) et au dossier de notes par défaut (R7).
- **À vérifier** : le comportement de `showDirectoryPicker` (option `startIn`) dans Chrome et
  Edge.

## R4 : accueil (livré)

Livré, voir `decision.md` §27. Choix du mainteneur en cours de lot : le nombre de personnes,
déplacé dans les paramètres, est gardé d'une réunion à l'autre, avec un avertissement (c'est un
plafond pour la distinction des voix). Le menu `app/js/menu.js` est le composant commun à
réutiliser pour les menus suivants.

Voir `refonte.md` §3.
- **Écran** : un titre, « Name », « Save note to » (un menu dessiné par Lowsper, réutilisable :
  composant commun), « Start » et le lien « Transcribe an audio file ».
- **Fenêtre « Before you start »** : prévenir les participants, choisir l'écran avec le son,
  autoriser le micro, et « Don't show again ».
- **Disparaissent de l'accueil** : le bandeau jaune permanent et « Comment ça marche ». Le nombre
  de personnes passe dans les réglages.
- **Tests** : mettre à jour les tests de bout en bout du parcours de réunion.

## R5 : réunion (livré)

Livré, voir `decision.md` §28. Tailles de la mini-fenêtre mesurées dans Chromium sous Linux
(écran virtuel) : 248 × 52 respecté, minimum 240 × 52 ; à confirmer dans Chrome et Edge avec
`tools/test/pip-sizes.html`. Seuils réglés sur les corpus : 60 s de silence du son de la réunion,
aucune alerte de silence du micro, 30 s de retard du texte.

Voir `refonte.md` §4 et §5.
- **Avant de coder** : mesurer les tailles minimale et maximale qu'acceptent Chrome et Edge pour
  `documentPictureInPicture.requestWindow`. Consigner le résultat.
- **Mini-fenêtre** : environ 248 × 52, avec le temps, le niveau du micro et du son de la réunion,
  Pause et Stop. Une alerte orange s'affiche si le son de la réunion n'arrive pas.
- **Fenêtre agrandie** :
  - grand chronomètre et nom de la réunion modifiable ;
  - contrôle d'état en langage simple (micro, son de la réunion, texte à jour) ;
  - trois gros boutons ;
  - « Start a new meeting without stopping » ;
  - le texte en direct derrière un interrupteur.
- **Seuils d'alerte** : silence prolongé, retard. Les régler sur le corpus de test et les
  consigner.
- **Performance** : mesurer la charge du moteur avant et après (`npm run bench`). Le direct ne
  doit pas ralentir.

## R6 : fin de réunion et consignes (livré)

Livré, voir `decision.md` §29. Choix du mainteneur en cours de lot : « Nouvelle réunion » ramène à
l'accueil (comme la maquette), et le panneau « Intervenants détectés » est retiré, le renommage se
faisant sur les répliques. La synthèse d'appel et la liste d'actions gardent le contexte et les
règles du compte rendu ; leur rôle et leurs sections changent.

Voir `refonte.md` §6 et §7.
- **Disposition** : deux colonnes. Le texte lisible à gauche, renommage des voix directement sur
  les répliques. À droite, « Note saved » et « What next? » (Get a summary, Copy the text, Save a
  copy), « See what is copied », « Fix a misheard word » et « New meeting ».
- **Consignes** : les consignes fournies sont réécrites comme un prompt système, avec la structure
  de `refonte.md` §7, en français et en anglais. Les consignes déjà modifiées par l'utilisateur
  sont conservées telles quelles (règle de rétrocompatibilité).

## R7 : réglages en onglets (livré)

Livré, voir `decision.md` §30. Choix du mainteneur en cours de lot : les emplacements sans dossier
choisi, dont « Par défaut », passent à `Lowsper/Notes/<emplacement>` (Téléchargements en secours
sans accès au dossier Lowsper) ; le nom du sous-dossier est figé (à la première note écrite, pour
ne pas figer « Nouvel emplacement ») ; les empreintes vocales ne sont jamais exportées. Non
vérifié : si Chrome et Edge gardent l'accord au dossier Lowsper après un redémarrage.

Voir `refonte.md` §8.
- **Organisation** : trois onglets (Transcription, Notes et compte rendu, Avancé), des listes
  groupées et des sous-écrans.
- **Nouveaux noms**, chacun expliqué en une phrase sous la ligne : « Mots à reconnaître »,
  « Corrections automatiques », « Emplacement », « Format de la note ».
- **Sauvegarde** : « Exporter les réglages » et « Importer des réglages ».
- **Dossier de notes par défaut** : `Lowsper/Notes/<emplacement>`. Les profils existants gardent
  leur dossier. C'est un changement visible, à signaler dans le CHANGELOG.
- **Compatibilité** : `app/reglages.txt` reste lisible (règle de compatibilité ; migration si le
  format change).

## R8 : langues parlées multiples et vocabulaires élargis (livré)

Livré, voir `decision.md` §34 et §35. Choix du mainteneur en cours de lot : seuil de qualité
(au plus 10 % d'erreur : proposée ; 10 à 25 % : mise en garde ; au-delà : pas proposée, donc onze
langues sur les douze de la maquette, le hindi écarté) ; aucune limite au nombre de langues ni de
vocabulaires cochés, un conseil sous la liste ; noms des langues dans leur propre langue, traduits
dessous ; vocabulaires en français et en anglais seulement, les autres langues ouvertes aux
contributions ; listes françaises d'origine gardées telles quelles (noms de produits compris) ;
règle de l'alternance pour plusieurs vocabulaires. Corrigés au passage : la langue parlée ignorée
depuis la 4.0.0, et deux défauts de l'écran de bienvenue signalés par le mainteneur (§36).

Voir `refonte.md` §8.1 et §8.4.
- **Avant d'exposer une langue** : mesurer la qualité de Whisper small sur des corpus synthétiques
  au moins en espagnol, mandarin et japonais. Une langue mal reconnue n'est pas proposée, ou
  l'est avec une mise en garde.
- **Langues** : liste à cocher. Le moteur détecte déjà la langue parmi une liste (`engine.js`).
- **Vocabulaires** : santé, juridique, finance, ressources humaines, éducation, commerce, secteur
  public, ingénierie, immobilier. Les listes sont par langue, et le format est documenté dans
  `CONTRIBUTING.md`.
- **Contexte de Whisper** : il est limité en longueur. Mesurer l'effet de plusieurs listes
  cochées à la fois.

## R9 : mémoire des voix d'une visio à l'autre (livré)

Livré, voir `decision.md` §37. Choix du mainteneur en cours de lot, sur mesures : compromis
« équilibré » (seuil 0,825, marge 0,05 avec la deuxième personne la plus proche), 5 empreintes au
plus par personne, effacement par empreinte, copie locale gardée dans `app/reglages.txt` (jamais
exportée). Non vérifié : le comportement sur de vraies voix et de vrais appareils.

Voir `refonte.md` §9.
1. Construire un corpus synthétique où une même voix passe par plusieurs micros simulés.
2. Mesurer l'existant (`speakers.js`).
3. Seulement ensuite, essayer plusieurs empreintes par personne et la comparaison à la plus
   proche, et régler le seuil sur ce corpus.

## Texte pour ouvrir la session suivante

Remplacer `C3` par le lot voulu, et sa ligne d'objectif par celle du tableau.

```text
Tu travailles sur le dépôt PercyaDJ/Lowsper (application de transcription de réunions 100 %
locale, dans le navigateur).

Avant tout, lis AGENTS.md (règles non négociables), docs/lots.md (feuille de route après la
refonte) et decision.md §22, §23, §40 et §41.

Ta mission : le lot C3 de docs/lots.md, et seulement ce lot : compte rendu rédigé par une IA
locale, seulement là où une mesure sur le portable de référence le valide. Commence par mesurer
(vitesse, mémoire, fidélité au transcript, phrases inventées) avant de coder quoi que ce soit, et
propose-moi un arbitrage sur ces mesures. Machine de référence : portable d'entreprise sans carte
graphique (16 Go, Edge ou Chrome), hors ligne. Le direct ne doit pas ralentir : mesure la charge
du moteur avant et après (npm run bench) si le chemin du direct change.
Respecte toutes les règles d'AGENTS.md. Mesure au lieu de supposer, et si un point n'est pas
vérifiable, écris-le comme non vérifié.

Pose-moi tes questions sous forme de choix à sélectionner, et seulement quand un choix
important n'est pas couvert.

Quand le lot est terminé :
1. tous les tests passent, y compris le test de non-fuite réseau ;
2. README, CHANGELOG, decision.md, AGENTS.md et docs/lots.md sont à jour (lot marqué livré) ;
3. ouvre la pull request avec le modèle du dépôt ;
4. donne-moi le résumé en 5 lignes, les actions à faire de mon côté étape par étape, et le
   texte pour ouvrir la session du lot suivant.

Réponds-moi toujours en français, avec des analogies pour expliquer, sans émoji et sans
tiret long. N'invente jamais rien : si tu ne sais pas, demande-moi.
```
