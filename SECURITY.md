# Sécurité de Lowsper

Lowsper transcrit des réunions sur le poste de l'utilisateur, dans le navigateur. Ce document dit
ce que Lowsper protège, ce qu'il ne protège pas, et comment signaler une faille.

## Versions suivies

Seule la dernière version publiée (voir `CHANGELOG.md`) reçoit des correctifs de sécurité.

## Ce que Lowsper protège

| Bien | Protection | Comment c'est vérifié |
|---|---|---|
| Le son de la réunion | Traité en mémoire, jamais écrit sur le disque, effacé en quittant la page. | Revue de code : aucune écriture de son (`app/js/capture.js`, `Recorder`). |
| Le texte du transcript | Reste sur le poste : téléchargé par l'utilisateur, copie de secours dans le stockage local du navigateur, effacée à la réunion suivante. | Revue de code (`app/js/transcript.js`). |
| La confidentialité réseau | La politique de sécurité de `Lowsper.html` interdit toute connexion, sauf vers Hugging Face pour télécharger le modèle. Une fois le modèle installé, aucune requête. | `tools/test/csp.mjs` (en CI) et `tools/test/e2e.mjs`. |
| L'intégrité du modèle téléchargé | Révision figée, empreinte SHA-256 de chaque fichier contrôlée avant écriture. Un fichier modifié est refusé. | `app/js/installer.js`, `tools/models.lock.json`. |
| L'intégrité du code livré | Aucun CDN, aucune police ni ressource distante. Moteur reconstruit à l'identique depuis le verrou. | `tools/test/csp.mjs`, `node build.mjs`. |
| Les empreintes vocales | Désactivées par défaut. Si activées : une suite de nombres (pas d'audio), sur le poste, effacée automatiquement après 1, 3 ou 6 mois. | `app/js/speakers.js` (`VoiceMemory`). |

## Ce que Lowsper ne protège pas

- **Un poste compromis.** Un logiciel malveillant sur l'ordinateur, une extension de navigateur
  malveillante ou un administrateur du poste peuvent lire l'écran, le micro, la mémoire et les
  fichiers. Lowsper n'y peut rien.
- **Les fichiers produits.** Le transcript téléchargé, la copie des réglages (`app/reglages.txt`)
  et le journal technique sont des fichiers ordinaires, non chiffrés. Leur protection relève du
  poste (chiffrement du disque, droits d'accès).
- **Le stockage du navigateur.** La sauvegarde de secours du transcript et les empreintes vocales
  mémorisées y sont lisibles par toute personne ayant accès à la session.
- **Ce que l'utilisateur fait du texte.** Le bouton « Copier pour une IA » met le transcript dans
  le presse-papiers. S'il est collé dans un service en ligne, il quitte le poste, par choix de
  l'utilisateur.
- **Le consentement des participants.** Lowsper rappelle de prévenir les participants. Le recueil
  de leur accord reste de la responsabilité de l'utilisateur.
- **Le premier téléchargement.** Il dépend de Hugging Face et du réseau. Les empreintes garantissent
  que le fichier reçu est le bon, pas que le service est disponible.

## Choix assumés de la politique de sécurité

- `script-src` accepte `blob:` et `data:`. Le moteur tourne dans un Worker créé depuis la mémoire,
  et Chrome refuse l'AudioWorklet chargé depuis `blob:` en `file://` (decision.md §2). Aucune
  donnée externe n'entre dans ces scripts : ils sont construits par Lowsper à partir de ses propres
  fichiers.
- `'wasm-unsafe-eval'` est nécessaire pour exécuter le moteur WebAssembly. `'unsafe-eval'` et
  `'unsafe-inline'` restent interdits.
- La politique est déclarée dans la page (balise `meta`), seul moyen disponible en `file://`.

## Signaler une faille

N'ouvrez pas d'issue publique. Utilisez le signalement privé de GitHub :
**Security, Report a vulnerability** sur la page du dépôt.

Indiquez la version, le navigateur, les étapes pour reproduire et l'impact. Ne joignez aucun
enregistrement ni transcript réel. Une première réponse est donnée sous 7 jours ; le correctif et
sa publication sont coordonnés avec vous.
