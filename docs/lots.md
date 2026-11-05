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

| Lot | Contenu | Version visée | État |
|---|---|---|---|
| R1 | Fondations visuelles : couleurs, thème, style commun | 3.5.0 | Livré |
| R2 | Interface en français et en anglais | 3.6.0 | À faire |
| R3 | Premier lancement guidé | 3.7.0 | À faire |
| R4 | Accueil | 3.8.0 | À faire |
| R5 | Réunion : mini-fenêtre et fenêtre agrandie | 3.9.0 | À faire |
| R6 | Fin de réunion et consignes réécrites | 3.10.0 | À faire |
| R7 | Réglages en onglets | 3.11.0 | À faire |
| R8 | Langues parlées multiples et vocabulaires métier élargis | 3.12.0 | À faire |
| R9 | Mémoire des voix d'une visio à l'autre | 3.13.0 | À faire |

## R1 : fondations visuelles (livré)

Neutres teintés de vert, clairs ou sombres. Le thème suit le système, avec une bascule dans
l'en-tête et le réglage « Affichage ». La police est celle du système. Boutons en pilule, cases à
cocher en interrupteurs, réglages en listes groupées. Voir `decision.md` §24.

## R2 : interface en français et en anglais

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

## R3 : premier lancement guidé

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

## R4 : accueil

Voir `refonte.md` §3.
- **Écran** : un titre, « Name », « Save note to » (un menu dessiné par Lowsper, réutilisable :
  composant commun), « Start » et le lien « Transcribe an audio file ».
- **Fenêtre « Before you start »** : prévenir les participants, choisir l'écran avec le son,
  autoriser le micro, et « Don't show again ».
- **Disparaissent de l'accueil** : le bandeau jaune permanent et « Comment ça marche ». Le nombre
  de personnes passe dans les réglages.
- **Tests** : mettre à jour les tests de bout en bout du parcours de réunion.

## R5 : réunion

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

## R6 : fin de réunion et consignes

Voir `refonte.md` §6 et §7.
- **Disposition** : deux colonnes. Le texte lisible à gauche, renommage des voix directement sur
  les répliques. À droite, « Note saved » et « What next? » (Get a summary, Copy the text, Save a
  copy), « See what is copied », « Fix a misheard word » et « New meeting ».
- **Consignes** : les consignes fournies sont réécrites comme un prompt système, avec la structure
  de `refonte.md` §7, en français et en anglais. Les consignes déjà modifiées par l'utilisateur
  sont conservées telles quelles (règle de rétrocompatibilité).

## R7 : réglages en onglets

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

## R8 : langues parlées multiples et vocabulaires élargis

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

## R9 : mémoire des voix d'une visio à l'autre

Voir `refonte.md` §9.
1. Construire un corpus synthétique où une même voix passe par plusieurs micros simulés.
2. Mesurer l'existant (`speakers.js`).
3. Seulement ensuite, essayer plusieurs empreintes par personne et la comparaison à la plus
   proche, et régler le seuil sur ce corpus.

## Texte pour ouvrir la session suivante

Remplacer `R2` par le lot voulu, et sa ligne d'objectif par celle du tableau.

```text
Tu travailles sur le dépôt PercyaDJ/Lowsper (application de transcription de réunions 100 %
locale, dans le navigateur).

Avant tout, lis AGENTS.md (règles non négociables), docs/refonte.md (spécifications de la
refonte) et docs/lots.md (plan des lots). Les maquettes validées sont sur
https://claude.ai/artifact/KeT2Rk6qFNieqFozpFJxMx : lis-les si tu as l'outil Artifact.

Ta mission : réaliser le lot R2 de docs/lots.md (interface en français et en anglais), et
seulement ce lot. Respecte toutes les règles d'AGENTS.md. Mesure au lieu de supposer, et si
un point n'est pas vérifiable, écris-le comme non vérifié.

Si un choix important n'est pas couvert par les spécifications, pose-moi la question avant
de le trancher.

Quand le lot est terminé :
1. tous les tests passent, y compris le test de non-fuite réseau ;
2. README, CHANGELOG, decision.md, AGENTS.md et docs/lots.md sont à jour (lot marqué livré) ;
3. ouvre la pull request avec le modèle du dépôt ;
4. donne-moi le résumé en 5 lignes, les actions à faire de mon côté étape par étape, et le
   texte pour ouvrir la session du lot suivant.

Réponds-moi toujours en français, avec des analogies pour expliquer, sans émoji et sans
tiret long. N'invente jamais rien : si tu ne sais pas, demande-moi.
```
