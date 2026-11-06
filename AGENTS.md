# AGENTS.md : règles du projet Lowsper

Source de vérité pour tout agent de code et tout contributeur. Le README s'adresse aux
utilisateurs ; ce fichier dit comment travailler sur le code. Mettez-le à jour dans la même pull
request dès qu'une règle ou une commande change.

Lowsper : transcription de réunions 100 % locale, dans le navigateur (Whisper via transformers.js
et ONNX Runtime Web). Dépôt public, vitrine professionnelle : chaque ligne doit pouvoir être
montrée à un recruteur ou à un RSSI.

## Règle d'or

En cas de doute, demandez. Ne supposez pas. N'inventez jamais un chiffre, une mesure, une
licence ou un comportement de navigateur : mesurez-le ou dites que ce n'est pas vérifié.

## Contraintes non négociables

Une modification qui affaiblit l'une d'elles est refusée, quelle qu'en soit la raison.

1. **Aucune donnée ne quitte le poste.** Seule connexion autorisée : le téléchargement des modèles
   depuis Hugging Face au premier lancement. Ne touchez pas à `connect-src` dans `Lowsper.html`
   sans décision écrite. Lancez le test de non-fuite après chaque changement.
2. **Aucune installation.** Pas d'exécutable, pas de script à lancer, pas de serveur. L'utilisateur
   ouvre `Lowsper.html` en `file://`, point. Pas de modules ES, pas de `fetch` vers les fichiers
   voisins (voir `decision.md` §2).
3. **L'audio n'est jamais écrit sur le disque.** En mémoire seulement, effacé en quittant la page.
   Vaut aussi pour les fichiers importés : lus, traités, libérés.
4. **Navigateurs cibles** : Edge et Chrome récents. Firefox en mode dégradé, documenté.
5. **Langues** : documentation en français, sauf la page d'accueil du dépôt : `README.md` en
   anglais et `README.fr.md` en français, courts, avec un lien de bascule de l'un à l'autre ; le
   détail est dans `docs/guide.md` (`decision.md` §31). Interface
   en français et en anglais, selon la langue du navigateur ou le réglage « Langue de
   l'interface » (`docs/refonte.md` §1, `decision.md` §25). Tout texte affiché passe par le
   catalogue `app/js/i18n.js`, dans les deux langues : jamais de texte en dur dans le HTML sans
   attribut `data-i18n`, ni dans le JavaScript sans `t()`, ni dans le CSS. La note en français
   reste identique au caractère près. Ton clair et sobre, sans émoji.
6. **Licence MIT** conservée. Toute dépendance nouvelle : licence vérifiée, ajoutée à
   `app/engine/THIRD_PARTY_LICENSES.txt` (via `tools/build.mjs`) et au README.
7. **Aucune dépendance chargée depuis un CDN.** Tout ce qui s'exécute est dans le dossier.
8. **Rétrocompatibilité** : copier `app/models` et `app/reglages.txt` d'une ancienne version vers
   la nouvelle ne fait rien perdre. Un changement de format exige une migration et une version
   majeure.
9. **Zéro donnée personnelle ou réelle** : corpus synthétiques uniquement. Aucun nom de client,
   d'entreprise ou de personne réels dans le code, les tests, les exemples, les captures, les
   commits ou les descriptions de pull request.

## Conventions

- **Une branche et une pull request par lot.** Ne commencez pas un lot avant la validation du
  précédent.
- **Commits** : [Conventional Commits](https://www.conventionalcommits.org/fr/v1.0.0/), message en
  français. Types : `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `style`, `build`, `ci`,
  `chore`. Portée facultative : `feat(import): ...`.
- **Versions** : SemVer. Majeur si l'utilisateur doit agir, mineur pour une fonctionnalité,
  correctif sinon. La version de `tools/package.json` fait foi ; la release `vX.Y.Z` est publiée
  sur `main` et reçoit automatiquement son paquet (le workflow refuse un tag différent).
- **CHANGELOG** : format Keep a Changelog. Chaque pull request remplit la section « Non publié ».
- **Décisions** : tout choix technique non trivial va dans `decision.md`, dans le style existant :
  contexte, options, arbitrage, mesures, limites. Ne réécrivez pas une décision passée : ajoutez
  une section qui la remplace et renvoyez-y.
- **Style** : Prettier (`tools/.prettierrc.json`) et ESLint (`tools/eslint.config.js`). Scripts
  classiques dans `app/js`, chacun dans une fonction auto-exécutée qui étend `window.Lowsper`.
  Commentaires en français, là où l'intention n'est pas évidente.
- **Outils** : uniquement dans `tools/`, en dépendances de développement, versions exactes. Rien
  de nouveau côté utilisateur final.

## Exigences de qualité

- Tests unitaires pour toute logique nouvelle ; test e2e si la capture, le moteur ou l'interface
  changent.
- Documentation mise à jour dans le même lot que la fonctionnalité : `docs/guide.md` (usage,
  FAQ, limites connues), et `README.md` et `README.fr.md` ensemble si la promesse, l'installation
  ou une fonction majeure change. Les deux README restent courts : une page chacun.
- Captures ou GIF courts pour toute fonctionnalité visible, sans aucune donnée réelle : étendre
  `tools/test/screenshots.mjs` plutôt que capturer à la main.
- Accessibilité de base : navigation au clavier, libellés, contrastes.
- **Aucune régression de performance en direct.** Mesurez la charge du moteur avant et après
  (`npm run bench`) dès que le chemin du direct change ; notez les deux chiffres dans la PR.
- Description de pull request structurée (modèle fourni) : objectif, changements, décisions,
  tests, captures, points d'attention. Relisible en moins de 15 minutes.

## Définition de « terminé »

- Tous les tests passent, en local et en CI.
- Le test de non-fuite réseau passe.
- `README.md`, `README.fr.md`, `docs/guide.md`, `CHANGELOG.md`, `decision.md` et `AGENTS.md` sont
  à jour.
- La pull request est relisible en moins de 15 minutes.
- Un résumé de 5 lignes : ce qui a changé, ce qui reste, la suite recommandée.

## Commandes

Depuis `tools/`, Node.js 20 ou plus.

| Besoin | Commande |
|---|---|
| Installer les outils | `npm ci --ignore-scripts && node node_modules/esbuild/install.js` |
| Télécharger les modèles du build | `npm run fetch-all` (ou `node fetch-model.mjs <id>`) |
| Reconstruire `app/engine` et `app/manifest.js` | `npm run build` |
| Idem avec un modèle préinstallé (tests, version hors ligne) | `node build.mjs --embed whisper-small` |
| Lint | `npm run lint` |
| Formatage (vérifier, corriger) | `npm run format:check`, `npm run format` |
| Tests unitaires (16 s, sans navigateur) | `npm run test:unit` |
| Test de non-fuite réseau (15 s, Chromium) | `npm run test:csp` |
| Tout ce que lance la CI | `npm test` |
| Bout en bout : installation, réunion, non-fuite (4 min) | `npm run test:e2e` |
| Décodage des fichiers importés, 7 formats (10 s, Chrome) ; `--long` : 3 h, mémoire | `npm run test:import` |
| Bout en bout de l'import de fichiers (après `--embed`, 3 min) | `npm run test:e2e-import` |
| Bout en bout des profils et des notes, faux dossier (après `--embed`, 5 min) | `npm run test:e2e-notes` |
| Mesure de vitesse du moteur (après `node build.mjs --embed whisper-small`) | `npm run bench` |
| Paquet de distribution `tools/dist/Lowsper-X.Y.Z.zip` (et son test) | `npm run release`, `npm run test:release` |
| Captures d'écran de la documentation (après `--embed`, 5 min) | `node test/screenshots.mjs` |
| Qualité sur corpus réaliste | `node test/eval-hebdo.mjs whisper-small` |
| Qualité par langue parlée, corpus synthétique (après `corpus/make-langs.py` et `--embed`) | `node test/eval-langs.mjs whisper-small [langues...]` |
| Effet de plusieurs vocabulaires métier cochés (après `corpus/make-langs.py vocab` et `--embed`) | `node test/eval-vocab.mjs whisper-small [domaines...]` |
| Sonde de l'IA intégrée, page en `file://`, fausse IA (20 s, Chromium) | `npm run test:localai` |
| Interface en français et en anglais : catalogue, page, bascule (5 s, Chromium) | `npm run test:i18n` |
| Écran de bienvenue : matériel simulé, recommandation, installation simulée (10 s, Chromium) | `npm run test:welcome` |
| Accueil : menu, fenêtre « Avant de commencer », nombre de personnes (10 s, Chromium) | `npm run test:home` |
| Paramètres en onglets : clavier, sous-écrans, listes dessinées, export et import (15 s, Chromium) | `npm run test:settings` |
| Vitesse des modèles selon le nombre de moteurs (après `--embed whisper-small whisper-base`) | `npm run bench -- --cores` |
| Essai à la main de la fenêtre de choix de dossier (`startIn`) dans Chrome et Edge | ouvrir `tools/test/startin.html` |
| Essai à la main des tailles de la mini-fenêtre dans Chrome et Edge | ouvrir `tools/test/pip-sizes.html` |
| Étude du résumé local (modèles dans `.cache/llm`, decision.md §22) | `node test/eval-summary.mjs <modèle> [--dtype=q8\|q4] [--sanity] [--long]` |

Chromium : si Playwright ne trouve pas son navigateur, définissez `CHROMIUM_PATH`. Le test de
décodage a besoin d'un navigateur qui lit l'AAC et le MP3 (Google Chrome en CI). Les tests e2e
utilisent les modèles de `tools/.cache` (environ 330 Mo) et un faux serveur Hugging Face local.
Ils imposent le français (`locale: 'fr-FR'` du contexte Playwright) : leurs vérifications portent
sur les textes français. Un nouveau test de navigateur fait de même, ou vérifie les deux langues.

Changer de révision d'un modèle : `node fetch-model.mjs <id> --update`, puis relire et commiter
`tools/models.lock.json`. Jamais de révision `main` dans le verrou.

## Carte du dépôt

| Chemin | Rôle |
|---|---|
| `Lowsper.html` | Page à ouvrir : interface et politique de sécurité (CSP) |
| `app/js/theme.js` | Thème clair ou sombre (système par défaut, choix mémorisé), chargé dans `<head>` |
| `app/js/meeting.js` | Contrôle d'état de la réunion (micro, son, texte) et ses seuils (`decision.md` §28) |
| `app/js/menu.js` | Menu dessiné par Lowsper, composant commun (clavier, lecteur d'écran) : langue, « Enregistrer la note dans », consigne de « Obtenir un résumé » |
| `app/js/panel.js` | Paramètres : onglets, sous-écrans et listes à choix dessinées, composant commun (clavier, lecteur d'écran, `decision.md` §30) |
| `app/js/recommend.js` | Détection du PC, moteurs autorisés, modèle recommandé au premier lancement (`decision.md` §26) |
| `app/js/i18n.js` | Langue de l'interface : catalogues `fr` et `en`, `t(clé, variables)`, attributs `data-i18n`, chargé avant les autres scripts |
| `app/js/browser.js` | Reconnaissance du navigateur (Brave, Edge, Chrome, Firefox) et messages quand l'écriture dans un dossier est impossible |
| `app/js/engine.js` | Chargement des fichiers embarqués, moteur Whisper dans un Worker (glossaire, langue, reprise, boucles) |
| `app/js/analyzer.js` | Détection de parole (Silero) et empreintes vocales (WeSpeaker), dans des Workers |
| `app/js/capture.js` | Micro et partage d'écran, rééchantillonnage 16 kHz, découpage en blocs, son gardé en mémoire |
| `app/js/audiofile.js` | Fichiers importés : lecteurs de conteneur (WAV, MP3, AAC, M4A, Ogg, WebM), décodage WebCodecs en flux |
| `app/js/speakers.js` | Distinction, regroupement et mémoire des voix ; voix du micro (anti-écho) |
| `app/js/transcript.js` | Assemblage, sigles, filtres, couverture, Markdown, sauvegarde de secours |
| `app/js/notes.js` | Emplacements (profils de sortie) : modèle de note, nom de fichier, front matter, liens, dossier de destination (par défaut `Notes/<emplacement>` du dossier Lowsper, `decision.md` §30) ; consignes pour l'IA (textes fournis dans `i18n.js`, anciens textes reconnus pour la rétrocompatibilité, `decision.md` §29) |
| `app/js/localai.js` | Sonde de l'IA intégrée du navigateur (expérimental) : disponibilité, essai sur une réunion fictive, rapport |
| `app/js/languages.js` | Langues parlées proposées (qualité mesurée), lecture de l'ancien réglage `lowsper.language`, nom des langues dans la note (`decision.md` §34) |
| `app/js/vocabularies.js` | Données des vocabulaires métier, par domaine et par langue parlée ; format dans `CONTRIBUTING.md` |
| `app/js/vocabulary.js` | Vocabulaires métier : corrections connues, glossaire complet, termes alternés pour le contexte donné à Whisper (`decision.md` §35) |
| `app/js/installer.js` | Téléchargement vérifié du modèle : seul code réseau de l'application |
| `app/js/settings.js` | Copie des réglages dans `app/reglages.txt` ; export et import d'un fichier de réglages (sans empreintes vocales) |
| `app/js/app.js` | Contrôleur de l'interface, file de transcription, cycle de la réunion, écran de fin (texte lisible, renommage des voix sur les répliques) |
| `app/css/` | Styles (thèmes clair et sombre) |
| `app/engine/`, `app/manifest.js` | Générés par `tools/build.mjs` : ne pas modifier à la main |
| `app/models/` | Modèles installés chez l'utilisateur (non versionnés) |
| `tools/build.mjs`, `fetch-model.mjs`, `models.mjs`, `models.lock.json` | Construction et verrou des modèles |
| `tools/test/` | Tests unitaires, non-fuite, e2e, bancs de mesure ; `corpus/` : corpus synthétiques et leurs générateurs |
| `docs/` | Architecture, guide de déploiement (DSI, RSSI), spécifications de la refonte (`refonte.md`) et plan des lots (`lots.md`), captures d'écran (`docs/images`, régénérées par `tools/test/screenshots.mjs`) |
| `tools/release.mjs` | Paquet de distribution, joint aux releases par `.github/workflows/release.yml` |
| `README.md`, `README.fr.md` | Pages d'accueil courtes, en anglais et en français, avec bascule |
| `docs/guide.md` | Guide complet de l'utilisateur, en français : écrans, FAQ, limites |
| `.github/workflows/lysbor.yml`, `.semgrepignore` | Suivi des vulnérabilités par l'agent Lysbor (`decision.md` §32) |
| `CODE_OF_CONDUCT.md` | Code de conduite (Contributor Covenant 2.1, traduction officielle) |
| `decision.md` | Décisions techniques et arbitrages |
| `SECURITY.md` | Modèle de menace et signalement des failles |
| `.github/` | CI, modèles d'issue et de pull request |
