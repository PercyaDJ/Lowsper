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

[Non publié]: https://github.com/PercyaDJ/Lowsper/compare/v3.4.1...HEAD
[3.4.1]: https://github.com/PercyaDJ/Lowsper/compare/v3.4.0...v3.4.1
[3.4.0]: https://github.com/PercyaDJ/Lowsper/compare/v3.3.0...v3.4.0
[3.3.0]: https://github.com/PercyaDJ/Lowsper/compare/v3.2.0...v3.3.0
[3.2.0]: https://github.com/PercyaDJ/Lowsper/compare/v3.1.0...v3.2.0
[3.1.0]: https://github.com/PercyaDJ/Lowsper/compare/v3.0.2...v3.1.0
[3.0.2]: https://github.com/PercyaDJ/Lowsper/compare/v3.0.1...v3.0.2
[3.0.1]: https://github.com/PercyaDJ/Lowsper/compare/v3.0.0...v3.0.1
[3.0.0]: https://github.com/PercyaDJ/Lowsper/releases/tag/v3.0.0
