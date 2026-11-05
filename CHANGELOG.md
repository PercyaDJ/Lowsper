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

[Non publié]: https://github.com/PercyaDJ/Lowsper/compare/v3.0.1...HEAD
[3.0.1]: https://github.com/PercyaDJ/Lowsper/compare/v3.0.0...v3.0.1
[3.0.0]: https://github.com/PercyaDJ/Lowsper/releases/tag/v3.0.0
