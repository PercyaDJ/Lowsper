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
5. **Français** pour l'interface et la documentation. Ton clair et sobre, sans émoji.
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
- README mis à jour dans le même lot que la fonctionnalité : usage, FAQ, limites connues.
  `README.en.md` aussi, si la promesse, l'installation ou une fonction majeure change.
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
- `README.md`, `CHANGELOG.md`, `decision.md` et `AGENTS.md` sont à jour.
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
| Sonde de l'IA intégrée, page en `file://`, fausse IA (20 s, Chromium) | `npm run test:localai` |
| Étude du résumé local (modèles dans `.cache/llm`, decision.md §22) | `node test/eval-summary.mjs <modèle> [--dtype=q8\|q4] [--sanity] [--long]` |

Chromium : si Playwright ne trouve pas son navigateur, définissez `CHROMIUM_PATH`. Le test de
décodage a besoin d'un navigateur qui lit l'AAC et le MP3 (Google Chrome en CI). Les tests e2e
utilisent les modèles de `tools/.cache` (environ 330 Mo) et un faux serveur Hugging Face local.

Changer de révision d'un modèle : `node fetch-model.mjs <id> --update`, puis relire et commiter
`tools/models.lock.json`. Jamais de révision `main` dans le verrou.

## Carte du dépôt

| Chemin | Rôle |
|---|---|
| `Lowsper.html` | Page à ouvrir : interface et politique de sécurité (CSP) |
| `app/js/engine.js` | Chargement des fichiers embarqués, moteur Whisper dans un Worker (glossaire, langue, reprise, boucles) |
| `app/js/analyzer.js` | Détection de parole (Silero) et empreintes vocales (WeSpeaker), dans des Workers |
| `app/js/capture.js` | Micro et partage d'écran, rééchantillonnage 16 kHz, découpage en blocs, son gardé en mémoire |
| `app/js/audiofile.js` | Fichiers importés : lecteurs de conteneur (WAV, MP3, AAC, M4A, Ogg, WebM), décodage WebCodecs en flux |
| `app/js/speakers.js` | Distinction, regroupement et mémoire des voix ; voix du micro (anti-écho) |
| `app/js/transcript.js` | Assemblage, sigles, filtres, couverture, Markdown, sauvegarde de secours |
| `app/js/notes.js` | Profils de sortie : modèle de note, nom de fichier, front matter, liens, dossier de destination |
| `app/js/localai.js` | Sonde de l'IA intégrée du navigateur (expérimental) : disponibilité, essai sur une réunion fictive, rapport |
| `app/js/vocabulary.js` | Vocabulaires métier et contexte donné à Whisper |
| `app/js/installer.js` | Téléchargement vérifié du modèle : seul code réseau de l'application |
| `app/js/settings.js` | Copie des réglages dans `app/reglages.txt` |
| `app/js/app.js` | Contrôleur de l'interface, file de transcription, cycle de la réunion |
| `app/css/` | Styles (thèmes clair et sombre) |
| `app/engine/`, `app/manifest.js` | Générés par `tools/build.mjs` : ne pas modifier à la main |
| `app/models/` | Modèles installés chez l'utilisateur (non versionnés) |
| `tools/build.mjs`, `fetch-model.mjs`, `models.mjs`, `models.lock.json` | Construction et verrou des modèles |
| `tools/test/` | Tests unitaires, non-fuite, e2e, bancs de mesure ; `corpus/` : corpus synthétiques et leurs générateurs |
| `docs/` | Architecture, guide de déploiement (DSI, RSSI), captures d'écran (`docs/images`, régénérées par `tools/test/screenshots.mjs`) |
| `tools/release.mjs` | Paquet de distribution, joint aux releases par `.github/workflows/release.yml` |
| `README.en.md` | Résumé en anglais du README |
| `CODE_OF_CONDUCT.md` | Code de conduite (Contributor Covenant 2.1, traduction officielle) |
| `decision.md` | Décisions techniques et arbitrages |
| `SECURITY.md` | Modèle de menace et signalement des failles |
| `.github/` | CI, modèles d'issue et de pull request |
