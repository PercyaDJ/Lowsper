# Refonte de l'interface : spécifications

Ce document décrit ce qu'il faudra programmer pour la refonte. Il s'appuie sur :
- l'inventaire de l'interface 3.4.1 ;
- les maquettes validées étape par étape avec le mainteneur ;
- ses retours du 5 novembre 2026.

Ce n'est pas une décision technique au sens de `decision.md`. Chaque choix non trivial y sera
consigné au moment de sa mise en œuvre.

Chaque point indique :
- **Besoin** : ce que l'utilisateur doit pouvoir faire ;
- **Attendu** : le comportement visé ;
- **À vérifier** : ce qui n'est pas mesuré ou pas certain aujourd'hui. Rien n'y est présenté
  comme acquis.

## Principes

1. **Un débutant doit tout comprendre sans aide.** Des mots du quotidien, une action principale
   par écran, et l'explication au moment où elle sert, pas en permanence.
2. **Un style unique, inspiré d'Apple.** Les mêmes couleurs, rayons d'arrondi, boutons en
   pilule, interrupteurs et listes groupées partout, en clair comme en sombre. Aucun contrôle
   natif du navigateur qui détonne : listes déroulantes et menus sont dessinés par Lowsper.
3. **Police système.** SF Pro sur Mac, Segoe UI Variable sous Windows. SF Pro ne peut pas être
   embarquée (licence) et aucune police n'est ajoutée au paquet.
4. **Les contraintes du projet ne bougent pas** : `file://`, aucun CDN, aucune donnée qui quitte
   le poste, accessibilité au clavier, aucune régression de performance en direct.

## 1. Langue de l'interface et thème : ceux du système

**Décidé par le mainteneur (5 novembre 2026).**
- **Langue** :
  - l'interface s'ouvre en français si le navigateur est en français, en anglais sinon ;
  - elle se change sur l'écran de bienvenue et dans les réglages, et ce choix est mémorisé ;
  - toutes les chaînes passent dans un catalogue par langue (`en`, `fr`), écrites en anglais
    simple : phrases courtes, aucun terme technique.
- **Thème** : clair ou sombre comme le système, avec une bascule (bouton de l'en-tête et réglage
  « Affichage »). Livré au lot R1.
- **Couleurs** : des neutres légèrement teintés de vert, clairs ou très sombres (gris sapin), sans
  couleur vive. Les valeurs sont dans `app/css/lowsper.css` et leurs contrastes dans
  `decision.md` §24. Livré au lot R1.
- **Règle du projet** : la contrainte n° 5 d'`AGENTS.md` est mise à jour en conséquence.

## 2. Premier lancement : détection de l'ordinateur et du dossier

- **Besoin** : n'avoir qu'à valider. Lowsper propose le bon modèle, au bon endroit.
- **Attendu** :
  1. au lancement, Lowsper lit les capacités du poste : nombre de cœurs
     (`navigator.hardwareConcurrency`), mémoire (`navigator.deviceMemory`, plafonnée à 8 Go par
     Chrome), présence d'une carte graphique utilisable (WebGPU) ;
  2. il recommande un modèle (« Best for this PC ») et laisse choisir les autres. Un modèle
     inutilisable sur ce poste est grisé, avec la raison ;
  3. il affiche le dossier détecté, celui qui contient `Lowsper.html` (déjà connu :
     `Lowsper.pageFolder()`) ;
  4. un seul bouton : « Download and install ».
- **Limite du navigateur, non contournable** : une page ne peut pas écrire dans un dossier sans
  que l'utilisateur le désigne lui-même dans la fenêtre du navigateur. Ce garde-fou de sécurité
  ne peut pas être levé. On peut le rendre évident :
  - le chemin détecté est affiché avant le clic ;
  - la consigne dit « cliquez sur Sélectionner le dossier » ;
  - le dossier choisi est vérifié (Lowsper vérifie déjà la présence de `Lowsper.html`).
- **À vérifier** :
  - la règle de recommandation (seuils de cœurs et de mémoire) est à établir avec
    `npm run bench` sur plusieurs postes. Ne pas la fixer au jugé ;
  - l'option `startIn` de `showDirectoryPicker` n'accepte pas un chemin libre, d'après la
    spécification : à confirmer dans Chrome et Edge ;
  - la mesure de vitesse existante pourrait affiner la recommandation après l'installation.

## 3. Accueil

- **Attendu** :
  - un titre, deux lignes (« Name », « Save note to ») et un bouton « Start » ;
  - le lien « Transcribe an audio file » ;
  - « Save note to » ouvre un menu dessiné par Lowsper (coche, sous-titre avec le chemin, entrée
    « New place… »), pas une liste déroulante native ;
  - « Start » ouvre une fenêtre « Before you start » qui explique les trois étapes à venir :
    prévenir les participants, choisir l'écran et cocher « Share system audio », autoriser le
    micro. Une case « Don't show again » est à prévoir pour les habitués.
- **Remplace** : le bandeau jaune permanent, « Comment ça marche », le champ « Personnes »
  (détection automatique, réglage avancé conservé).

## 4. Mini-fenêtre pendant la réunion

- **Besoin** : continuer à utiliser l'ordinateur, Lowsper prenant le moins de place possible.
- **Attendu** :
  - fenêtre « Picture-in-Picture » de document d'environ 248 × 52 px ;
  - le temps écoulé ;
  - le niveau du micro et celui du son de la réunion ;
  - Pause/Reprendre et Arrêter ;
  - une icône orange si le son de la réunion n'arrive pas, avec l'explication au survol.
- **À vérifier** : les tailles minimale et maximale qu'acceptent Chrome et Edge pour une fenêtre
  Document Picture-in-Picture ne sont pas mesurées. À mesurer en premier, et adapter si la
  fenêtre est imposée plus grande.

## 5. Réunion, fenêtre agrandie

- **Attendu** :
  - un grand chronomètre et le nom de la réunion, modifiable ;
  - un **contrôle d'état** en langage simple, ligne par ligne :
    - micro : « Hearing you » ;
    - son de la réunion : « Coming through », ou « Nothing is coming through » avec un bouton
      « How to fix » ;
    - texte : « Up to date », ou le retard en secondes ;
  - trois gros boutons ronds légendés : Pause, Minimize, Stop ;
  - « Start a new meeting without stopping » ;
  - le texte en direct derrière un interrupteur, masqué par défaut.
- **Données existantes** : les niveaux sonores, le nombre de passages en attente et la charge du
  moteur sont déjà calculés (`app.js`). Il reste à les traduire en états compréhensibles. Les
  seuils, par exemple combien de secondes de silence avant d'alerter, sont à régler sur le corpus
  de test.

## 6. Fin de réunion

- **Attendu** :
  - le texte lisible à gauche (plus de Markdown brut), avec une aide pour renommer les voix
    directement sur les répliques ;
  - à droite, « Note saved » (et elle se met à jour), puis la liste « What next? » :
    - « Get a summary » : copie la consigne et le texte. « See what is copied » montre le texte
      exact ;
    - « Copy the text » ;
    - « Save a copy » ;
  - « Fix a misheard word » ;
  - « New meeting ».

## 7. Consigne de compte rendu, réécrite comme un prompt système

- **Besoin** : une consigne de qualité professionnelle, structurée comme un prompt système, placée
  avant le transcript.
- **Attendu** : la consigne par défaut devient le texte ci-dessous, dans la langue de l'interface.
  Les consignes modifiées par l'utilisateur sont conservées telles quelles.
  - Sa structure : rôle, contexte, tâche, règles, puis transcript.
  - Elle garde les variables actuelles (`{{note}}`, `{{titre}}`...) et la règle de rétrocompatibilité.
  - Elle s'écrit dans la langue principale du transcript.

```text
# Role
You write accurate, useful meeting minutes.

# Context
Below is an automatic transcript of a meeting, recorded and transcribed on the user's own
computer by Lowsper.
- It may contain speech recognition errors.
- « You » is the person who recorded. Other people may appear as « Speaker 1 », « Speaker 2 »...
  when their names are unknown.
- Times are relative to the start of the recording.

# Task
Write the minutes in the main language of the transcript, with these sections:
1. Summary: 3 to 5 sentences.
2. Participants: names or labels as they appear.
3. Topics discussed.
4. Decisions made.
5. Action items: who, what, deadline. Write « not specified » when something is missing.
6. Open questions.

# Rules
- Use only what is in the transcript. Never invent a name, a number or a date.
- Copy numbers exactly.
- When a passage is unclear or looks misheard, say so instead of guessing.
- Be concise. Use bullet points.

# Transcript
{{note}}
```

La synthèse d'appel et la liste d'actions suivent la même structure. Elles changent seulement les
sections demandées.

## 8. Réglages

Trois onglets : **Transcription**, **Notes and summary** et **Advanced**. Chaque rubrique est une
liste groupée, et un élément à choix ouvre un sous-écran.

### 8.1 Langues parlées : plusieurs, au choix

- **Besoin** : réunions en anglais, en français, en espagnol, en mandarin, en japonais...,
  parfois mélangées.
- **Attendu** : une liste à cocher des langues parlées dans les réunions. Lowsper reconnaît la
  langue de chaque passage parmi celles cochées.
- **Existant** : le moteur accepte déjà une liste de langues et détecte la bonne parmi elles
  (`engine.js`, mode automatique français/anglais). Il s'agit de l'étendre et de l'exposer.
- **À vérifier** :
  - la qualité de Whisper small hors français et anglais n'est pas mesurée ici. Il faut mesurer
    au moins l'espagnol, le mandarin et le japonais sur des corpus synthétiques avant de les
    annoncer ;
  - les sigles et le vocabulaire métier sont aujourd'hui pensés pour le français.

### 8.2 « Words to recognize » et « Automatic fixes » : deux outils différents

| | Words to recognize (aujourd'hui « Sigles et noms propres ») | Automatic fixes (aujourd'hui « Mots que Whisper déforme ») |
|---|---|---|
| Quand | **Avant** la transcription | **Après** la transcription |
| Comment | Les mots sont donnés à Whisper comme contexte : il a plus de chances de les écrire juste | Un mot mal reconnu est remplacé partout par le bon |
| Exemple | « COPIL, Dr Martin, KPI » | « Kalmar » devient « CALMAR » |
| Garantie | Aucune : une aide | Systématique |

Chaque ligne affiche cette explication en une phrase, avec un exemple.

### 8.3 Les réglages sont conservés, même un mois plus tard

- **Existant** : les réglages (mots, corrections, profils, consignes...) sont gardés dans le
  stockage du navigateur. Ils sont copiés automatiquement dans `app/reglages.txt`, dans le dossier
  Lowsper, et restaurés de là si le navigateur les a effacés (`settings.js`).
  - La copie demande l'accord du navigateur une fois.
  - Après un redémarrage, ou un mois plus tard, rien n'est perdu tant que ce fichier existe.
- **Attendu** :
  - demander cet accord dès l'installation, avec le même dossier, pour que la copie soit
    toujours active ;
  - l'écrire sous la rubrique : « Saved in the Lowsper folder: still there after you restart
    your PC. » ;
  - le bouton « Conserver mes réglages dans le dossier Lowsper » disparaît.

### 8.4 Vocabulaire métier élargi

- **Besoin** : Lowsper est open source, ses utilisateurs ne sont pas tous informaticiens.
- **Attendu** :
  - de nouvelles listes : santé, juridique, finance et comptabilité, ressources humaines,
    éducation, commerce et marketing, secteur public, ingénierie et industrie, immobilier, en
    plus des trois actuelles ;
  - un format simple, documenté dans `CONTRIBUTING.md`, pour en proposer d'autres ;
  - des listes par langue.
- **À vérifier** : le contexte donné à Whisper est limité en longueur (`vocabulary.js`). Il faut
  mesurer l'effet de plusieurs listes cochées à la fois.

### 8.5 Notes : dossier par défaut et format compréhensible

- **Attendu** :
  - le dossier par défaut des notes est `Lowsper/Notes/<profil>`, dans le dossier déjà autorisé
    à l'installation, et non plus les Téléchargements ;
  - « Profil » devient « Place » (un dossier et un format de note) ;
  - « Note format » propose « Plain text » ou « For note apps », qui ajoute des propriétés et des
    liens lisibles par des applications comme Obsidian, avec cette explication sous la
    rubrique ;
  - « Edit the instructions » ouvre l'éditeur de consignes.

### 8.6 Sauvegarde : exporter et importer, pas « copier »

- **Attendu** : « Export settings to a file » et « Import settings from a file ». La phrase
  « Settings save automatically. Use this only to move them to another PC. » lève l'ambiguïté.

### 8.7 IA intégrée du navigateur

- **Attendu** : la ligne dit ce qu'elle fait : « Checks if this PC can write summaries offline,
  without any online AI service. » La sonde actuelle (`localai.js`, `decision.md` §23) est
  conservée.

## 9. Empreintes vocales : mieux reconnaître une même personne d'une visio à l'autre

- **Constat du mainteneur** : en visio, la mémoire des voix reconnaît mal une personne quand elle
  change de micro (casque, micro du PC).
- **Pistes, à évaluer avant tout développement** :
  - garder plusieurs empreintes par personne, une par réunion ou par appareil, au lieu d'une
    seule ;
  - comparer à la plus proche plutôt qu'à une moyenne ;
  - régler le seuil sur des corpus synthétiques où l'on simule plusieurs micros (filtrage,
    compression du son de visio).
- **À vérifier** : aucune mesure n'existe encore sur ce point. Première étape : construire le
  corpus de test et mesurer l'existant (`speakers.js`).

## 10. Ordre de mise en œuvre

Le découpage en lots, leur état et le texte à donner pour ouvrir chaque session sont dans
[lots.md](lots.md).
