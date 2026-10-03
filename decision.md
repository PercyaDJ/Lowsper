# Lowsper : décisions techniques et arbitrages

Ce document trace chaque choix structurant du projet, ce qui a été écarté et pourquoi.
Les mesures citées ont été faites sur la machine de développement (conteneur Linux, 4 cœurs
virtuels peu rapides, Chromium 141). Un PC portable récent sera en général plus rapide,
mais ce n'a pas été mesuré.

---

## 1. Forme de l'application : une page HTML ouverte en double-clic

**Décision** : Lowsper est un dossier contenant `Lowsper.html`. On l'ouvre en double-cliquant
dessus, il s'exécute dans Edge ou Chrome, en `file://`, sans serveur, sans installation.

| Option | Pourquoi elle est écartée |
|---|---|
| Exécutable (.exe, Electron, Tauri) | Bloqué par AppLocker, SmartScreen ou l'EDR sur la plupart des postes d'entreprise. |
| Script (PowerShell, Python, .bat) | Politiques d'exécution de scripts bloquées en entreprise, Python rarement installé. |
| Serveur local (`localhost`) | Il faut un exécutable pour le lancer (Node, Python) et l'ouverture d'un port réseau alerte les outils de sécurité. |
| Extension de navigateur | Installation souvent interdite par GPO, publication sur un store nécessaire. |
| Site web hébergé (PWA) | Contraire à l'objectif : dépend d'Internet et du proxy, et l'audio transiterait par un tiers. |

Analogie : plutôt que d'installer un logiciel, on apporte un document que le navigateur sait
« lire ». Le navigateur est déjà là, autorisé et maintenu à jour par la DSI.

## 2. Contourner les restrictions du mode `file://`

Une page ouverte depuis le disque est très bridée par le navigateur. Chaque restriction a sa parade :

| Restriction en `file://` | Parade retenue |
|---|---|
| `fetch()` et XHR vers les fichiers voisins interdits | Le moteur, le WebAssembly et le modèle sont convertis en scripts classiques `.js` contenant les données en base64. Les balises `<script src>` restent autorisées. |
| Modules ES (`import`) interdits | Tout est livré en scripts classiques (IIFE construite avec esbuild). |
| Web Worker depuis un fichier interdit | Le Worker est créé depuis un `Blob` en mémoire. |
| AudioWorklet depuis un `Blob` refusé par Chrome | Chargé depuis une URL `data:` (vérifié : `blob:` échoue, `data:` passe). |
| Multithread WebAssembly impossible (exige les en-têtes COOP/COEP d'un serveur) | Un thread par moteur, et deux moteurs en parallèle (voir §6). |
| transformers.js veut télécharger le modèle et le WebAssembly depuis Internet | Un « cache personnalisé » sert les fichiers depuis la mémoire, le binaire WebAssembly est injecté directement (`wasmBinary`). |

## 3. Garantie technique « aucune donnée ne sort »

- La page déclare une **Content Security Policy** stricte : `connect-src 'none'`, aucune
  source distante autorisée pour les scripts, styles, images, polices, cadres. Même en cas
  de bug ou de dépendance malveillante, le navigateur bloquerait toute connexion réseau.
- Aucune ressource externe (pas de CDN, pas de police Google, polices système uniquement).
- Le test automatique de bout en bout échoue si la page émet **une seule** requête réseau.
- Conséquence pratique : les proxys d'entreprise ne peuvent pas bloquer l'application,
  puisqu'elle ne les sollicite jamais. Seul le téléchargement initial du dossier passe par
  le réseau (et peut se faire par clé USB, SharePoint, Teams...).

## 4. Choix du modèle : Whisper base multilingue, quantifié int8

| Modèle | Taille | Verdict |
|---|---|---|
| Whisper tiny | ~40 Mo | Trop d'erreurs en français pour un compte rendu exploitable. |
| **Whisper base** | **~77 Mo** | **Retenu** : correct en français, assez léger pour tourner en continu sans faire souffler le PC. |
| Whisper small | ~250 Mo | Nettement meilleur, mais environ 3 fois plus lent et 3 fois plus lourd. Proposé en option (voir README). |
| Whisper large-v3-turbo | 800 Mo et plus | Irréaliste sur processeur en un seul thread. |
| Distil-Whisper, Moonshine | | Anglais uniquement. |

- Source : `onnx-community/whisper-base` (format ONNX, quantification int8 « q8 »).
- Licence : Whisper est publié par OpenAI sous licence MIT, la redistribution dans le dépôt est permise.
- Le modèle est **dans le dépôt** : télécharger le zip suffit, aucun téléchargement au premier lancement.

**Arbitrage qualité / sobriété** : le transcript est destiné à une autre IA qui rédigera le
compte rendu. Ces IA tolèrent bien quelques mots mal reconnus, elles reconstituent le sens.
On privilégie donc un modèle sobre qui tourne en direct plutôt qu'un modèle parfait qui ferait
chauffer le PC toute la journée.

## 5. Moteur d'inférence : transformers.js + ONNX Runtime Web, sur processeur (WebAssembly)

- transformers.js 4.3 gère tout le pipeline Whisper (spectrogramme, tokenizer, génération).
- ONNX Runtime Web en WebAssembly SIMD, variante « CPU seulement » (14 Mo).
- **WebGPU écarté pour la v1** : +27 Mo de WebAssembly, pilotes graphiques très hétérogènes sur
  un parc d'entreprise, et les modèles int8 sont mal accélérés en WebGPU (il faudrait d'autres
  fichiers de modèle). C'est la principale piste d'accélération future (§13).

## 6. Performance : transcrire pendant la réunion, pas après

C'est la décision qui répond à « je ne veux pas laisser mon PC allumé une heure de plus ».

- **Transcription en direct** : chaque phrase est transcrite quelques secondes après avoir été
  prononcée. À la fin de la réunion, il ne reste que les dernières secondes à traiter.
  Mesure : transcript téléchargé **5 à 6 secondes** après le clic sur « Terminer ».
- **Le silence n'est jamais envoyé au modèle** : un détecteur d'activité vocale (VAD) ne garde
  que les passages parlés. Dans une réunion, chaque source est silencieuse une bonne partie du temps.
- **Segments longs** (jusqu'à 28 s, coupés dans les pauses) : Whisper paie toujours le coût d'une
  fenêtre de 30 s, même pour 2 s d'audio. Mesure : 6 s d'audio coûtent ~4 s de calcul,
  25 s d'audio coûtent aussi ~4 s (soit 0,17 seconde de calcul par seconde de parole).
- **Deux moteurs en parallèle** (un par voix qui parle) si la machine a au moins 4 cœurs et 4 Go
  de mémoire, sinon un seul. Chacun n'utilise qu'un cœur : le reste du PC reste disponible.
- **Garde-fou anti-boucle** : Whisper peut « halluciner » indéfiniment sur du bruit. Le nombre de
  mots générés est plafonné selon la durée du segment. Sans ce garde-fou, une seconde de silence
  coûtait 28 s de calcul.
- Ordre de grandeur sur la machine de test : une heure de parole continue représente environ
  10 minutes de calcul sur un cœur, étalées pendant la réunion.
- Chargement : ~2 s pour lire les fichiers, ~5 à 10 s pour démarrer les moteurs. On peut lancer
  l'enregistrement pendant ce temps, l'audio attend dans la file.

## 7. Deux sources audio, deux « locuteurs »

- **Micro** (`getUserMedia`) : étiqueté **« Vous »**.
- **Son de la réunion** via le partage d'écran (`getDisplayMedia` avec audio) : étiqueté
  **« Participants »**. Fonctionne avec Teams, Zoom, Meet, Webex, en application ou dans le navigateur.
- La vidéo du partage d'écran est demandée au minimum (1 image/s, petite taille) car les
  navigateurs l'imposent, mais elle n'est jamais lue ni enregistrée.
- **Ordre des demandes** : partage d'écran d'abord, micro ensuite. Le navigateur exige que le
  partage d'écran suive immédiatement un clic ; demander le micro avant ferait échouer le partage.
- **Pas d'identification individuelle des participants (diarisation)** : les modèles qui le font
  (pyannote...) sont lourds, peu fiables en navigateur et auraient doublé la charge. L'IA de
  compte rendu déduit souvent qui parle grâce au contexte (« merci Julie »...).

## 8. Écho : quand le micro réentend les participants

Sans casque, le micro capte aussi la voix des participants sortant des haut-parleurs : elle
apparaîtrait deux fois. Trois niveaux de défense :
1. Annulation d'écho du navigateur activée sur le micro.
2. **Déduplication** : une phrase du micro qui reprend à 60 % ou plus les mots d'une phrase des
   participants prononcée au même moment (à 6 s près) est supprimée.
3. Recommandation affichée : utiliser un casque.

## 9. Langue

- **Français par défaut**, anglais disponible.
- **Mode « français et anglais »** pour les réunions mixtes : la langue est détectée à chaque
  passage. transformers.js ne sait pas le faire (il force l'anglais et *traduit* le français, vérifié) :
  la détection est donc implémentée dans Lowsper, en réutilisant le calcul de l'encodeur.
  Coût : +0,7 s par passage au lieu de +3,4 s pour une détection naïve.
- La détection est limitée au français et à l'anglais pour éviter les erreurs sur les passages courts.

## 10. Format du transcript

- Fichier Markdown nommé `reunion_AAAA-MM-JJ_HHhMM_nom.md`, téléchargé automatiquement à la fin.
- En-tête : date, horaires, durée, sources, langue, modèle, avertissement sur la fiabilité.
- Une ligne par intervention : `**[00:12:34] Participants :** texte`. Les phrases consécutives
  d'une même personne sont regroupées en paragraphes (lisibilité, et moins de jetons pour l'IA).
- Horodatage relatif au début de l'enregistrement. Les pauses sont indiquées.
- Bouton **« Copier pour une IA »** : copie le transcript précédé d'une consigne de compte rendu
  (points abordés, décisions, actions, questions ouvertes, ne rien inventer).
- Filtrage des **hallucinations connues** de Whisper (« Sous-titres réalisés par la communauté
  d'Amara.org », « Merci d'avoir regardé »...) et des répétitions en boucle.

## 11. Confidentialité

- **Bandeau permanent** en haut de l'application : prévenir les participants avant d'enregistrer.
- **L'audio n'est jamais stocké** : il n'existe qu'en mémoire, le temps d'être transcrit.
- Le **texte** est sauvegardé au fil de l'eau dans le stockage local du navigateur, sur le poste,
  pour survivre à un plantage ou une fermeture accidentelle (proposition de récupération au
  lancement suivant). Il est effacé dès que l'on démarre une nouvelle réunion ou clique sur
  « Nouvelle réunion ».

## 12. Expérience utilisateur

- **Un seul bouton** pour commencer, un seul pour finir. Les options (langue, son des
  participants) sont repliées.
- Le moteur se prépare dès l'ouverture, en arrière-plan, avec un indicateur d'état.
- Pendant la réunion : chronomètre, deux vumètres (« Vous », « Participants »), transcript en
  direct, état de la file. Bouton Pause (les pauses sont tracées dans le transcript).
- Cas dégradés gérés sans bloquer : partage refusé ou sans son (case « Partager l'audio » oubliée)
  → la réunion continue en micro seul, avec un bouton pour réessayer ; partage arrêté en cours de route ;
  micro refusé ; navigateur incompatible.
- La mise en veille de l'écran est empêchée pendant l'enregistrement, et le navigateur demande
  confirmation si l'on ferme l'onglet en pleine réunion.
- Thème clair et sombre automatiques, interface en français, sans émojis.

## 13. Taille du dépôt et distribution

- ~120 Mo au total, découpés en fichiers de 35 Mo maximum (GitHub refuse les fichiers de plus de
  100 Mo et avertit au-delà de 50 Mo).
- **Git LFS écarté** : le bouton « Download ZIP » de GitHub n'inclut pas les fichiers LFS par
  défaut, ce qui casserait l'usage « je télécharge le zip et je double-clique ».
- Les fichiers générés (`app/engine`, `app/models`, `app/manifest.js`) sont reconstruits par
  `tools/build.mjs`. Les outils de construction ne servent qu'aux développeurs.

## 14. Compatibilité

| Navigateur | Micro | Son des participants |
|---|---|---|
| Edge, Chrome (Windows) | Oui | Oui : partager l'écran entier et cocher « Partager l'audio du système », ou un onglet |
| Chrome (macOS) | Oui | Garanti pour un onglet du navigateur (réunion web). Pour une application de bureau, dépend des versions de macOS et de Chrome |
| Firefox | Oui | Non (Firefox ne capte pas le son d'un partage d'écran) : mode micro seul |
| Safari | Non testé | Non testé |

Si une stratégie d'entreprise interdit le partage d'écran, Lowsper fonctionne en micro seul.

## 15. Limites connues et pistes d'évolution

1. **WebGPU** : accélération forte sur les PC équipés d'un GPU correct ; à ajouter en option
   avec détection automatique et repli sur le processeur.
2. **Pack Whisper small** pour ceux qui veulent plus de précision (`node build.mjs whisper-small`) ;
   un sélecteur de modèle apparaîtra dans l'interface si plusieurs modèles sont présents.
3. **Diarisation** légère côté « Participants » (distinguer plusieurs voix).
4. **Compte rendu local** par un petit modèle de langage dans le navigateur : écarté pour
   l'instant (plusieurs centaines de Mo à plusieurs Go, qualité nettement inférieure aux IA
   auxquelles l'utilisateur confiera le transcript).
5. Vocabulaire métier : Whisper accepte une « invite » de mots attendus (noms propres, sigles),
   ce qui améliorerait les noms de projets et de personnes.
