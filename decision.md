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
| Une page ne peut pas écrire sur le disque | API File System Access (Edge, Chrome) : l'utilisateur désigne une fois le dossier Lowsper, la page y écrit le modèle (§13). Vérifié disponible en `file://`. |

## 3. Garantie technique « ni le son ni le texte ne sortent »

- La page déclare une **Content Security Policy** stricte : seules les connexions vers
  **Hugging Face** (`huggingface.co` et ses serveurs de fichiers `*.hf.co`) sont permises, pour
  le téléchargement initial du modèle. Tout autre site est bloqué par le navigateur, même en cas
  de bug ou de dépendance malveillante.
- Le code n'envoie jamais l'audio ni le texte : les seules requêtes réseau sont les
  téléchargements des fichiers du modèle, en lecture (GET), sans cookie ni identifiant.
- Une fois le modèle installé, Lowsper ne fait plus **aucune** requête. Le test de bout en bout
  échoue si une seule requête réseau est émise après l'installation.
- Aucune ressource externe (pas de CDN, pas de police distante, polices système uniquement).
- Les proxys d'entreprise n'interviennent qu'au premier lancement. S'ils bloquent Hugging Face,
  on installe ailleurs (partage de connexion, domicile) ou on copie le dossier d'un collègue (§13).

## 4. Choix du modèle : Whisper small (int8) + glossaire de sigles

Besoin : réunions à 90-95 % en français, 5-10 % en anglais, **beaucoup de sigles d'entreprise**.

### Méthode de comparaison

Un corpus de réunion fictive (`tools/test/corpus`) : 55 s, 8 répliques, 3 voix de synthèse
françaises (Piper), 20 sigles prononcés comme à l'oral (« R S S I », « comex », « nisse deux »...).
Le banc `tools/test/eval.mjs` mesure, dans Chromium et dans les conditions réelles de Lowsper
(découpage, moteur, 1 cœur) : le taux de mots erronés (WER), les sigles écrits correctement,
et le temps de calcul par seconde de parole. Machine de mesure : conteneur 4 cœurs virtuels lents.

| Modèle | Taille | Mots erronés | Sigles retrouvés | Calcul / seconde de parole |
|---|---|---|---|---|
| Whisper base | 80 Mo | 24 % | 8 / 20 | 0,33 s |
| Whisper base + glossaire | 80 Mo | 17 % | 14 / 20 | 0,31 s |
| Whisper small | 252 Mo | 17 % | 10 / 20 | 0,89 s |
| **Whisper small + glossaire** | **252 Mo** | **11 %** | **14 / 20** | **0,88 s** |
| Whisper small, décodeur 4 bits + glossaire | 325 Mo | 9 % | 15 / 20 | 1,7 s |
| Whisper small affiné français (CV11) + glossaire | 325 Mo | 13 % | 7 / 20 | 1,9 s |

Non retenus sans mesure complète :
- **Whisper large-v3-turbo** (760 Mo en 4 bits) : son encodeur fait 32 couches contre 12 pour
  small, et les poids 4 bits se sont révélés 2 fois plus lents que l'int8 dans ce moteur. Il
  serait plusieurs fois plus lent que le temps réel sur un seul cœur.
- **Whisper tiny** : encore moins précis que base. **Distil-Whisper, Moonshine** : anglais uniquement.

### Décision

- **Par défaut : Whisper small int8**, proposé avec la mention « recommandé ». Divise presque par
  deux les erreurs par rapport à base. Les sigles qui résistent (« KPI » lu « KP »,
  « ETP » lu « OTP »...) sont des erreurs que l'IA de compte rendu corrige facilement grâce au
  vocabulaire de référence placé en tête du transcript (§10).
- **Alternative : Whisper base**, pour les PC anciens. Avec le glossaire, il retrouve autant de
  sigles que small, mais fait plus d'erreurs sur le reste du texte.
- La version 4 bits est un peu plus précise mais 2 fois plus lente : écartée. La version affinée
  en français est plus lente et retrouve moins de sigles (elle écrit souvent les sigles en lettres séparées) : écartée.
- Licence : Whisper (OpenAI) est sous licence MIT. Fichiers ONNX : `onnx-community/whisper-small`.
- Limite de la mesure : voix de synthèse et non vraies réunions. L'ordre des modèles est fiable,
  les pourcentages exacts ne le sont pas.

## Glossaire de sigles : comment il aide

Analogie : c'est comme donner à un sténographe la liste des sigles de l'entreprise avant la réunion.

1. **Contexte Whisper** : le glossaire est donné au modèle comme « texte précédent ». Whisper
   imite alors l'orthographe de ce contexte : « comex » devient « COMEX », « nisse deux » devient
   « NIS 2 ». Gain mesuré : de 10 à 14 sigles sur 20 avec small.
2. **Filet de sécurité** : ce contexte fait parfois sauter un passage à Whisper (constaté avec
   base). Si un bloc revient anormalement court, il est redécodé sans glossaire (sans recalculer
   l'encodeur, donc pour un coût faible) et la version la plus complète est gardée.
3. **Recollage des sigles** : quand Whisper écrit un sigle du glossaire en morceaux (« V P N »,
   « VP n », « R.O.I. »), il est recollé (« VPN », « ROI »). La correction ne s'applique que si les
   lettres forment exactement un sigle du glossaire : aucun risque de modifier un mot ordinaire.
4. **Pour l'IA de compte rendu** : le glossaire est recopié dans l'en-tête du transcript, ce qui lui
   permet de corriger elle-même les sigles mal reconnus.

Le glossaire se remplit dans les options (« Sigles et noms propres de vos réunions ») et reste
mémorisé sur le poste. Il accepte aussi les noms de projets et de personnes.

## 5. Moteur d'inférence : transformers.js + ONNX Runtime Web, sur processeur (WebAssembly)

- transformers.js 4.3 gère tout le pipeline Whisper (spectrogramme, tokenizer, génération).
- ONNX Runtime Web en WebAssembly SIMD, variante « CPU seulement » (14 Mo).
- **WebGPU écarté pour la v1** : +27 Mo de WebAssembly, pilotes graphiques très hétérogènes sur
  un parc d'entreprise, et les modèles int8 sont mal accélérés en WebGPU (il faudrait d'autres
  fichiers de modèle). C'est la principale piste d'accélération future (§13).

## 6. Performance : transcrire pendant la réunion, pas après

C'est la décision qui répond à « je ne veux pas laisser mon PC allumé une heure de plus ».

- **Transcription en direct** : la parole est transcrite au fil de la réunion. À la fin, il ne
  reste que le dernier bloc de chaque source à traiter. Mesuré avec Whisper small sur la machine
  de test : transcript téléchargé **20 s** après « Terminer » (5 s avec Whisper base).
- **Le silence n'est jamais envoyé au modèle** : un détecteur d'activité vocale ne garde que les
  passages parlés.
- **Blocs de parole compactés** : Whisper paie toujours le prix d'une fenêtre de 30 s, même pour
  une phrase de 3 s. Lowsper accumule donc les prises de parole d'une même source en retirant les
  silences entre elles, et envoie des blocs d'environ 25 s de parole « pure ». Chaque bloc garde
  une table de correspondance pour rendre à chaque phrase son heure réelle. Exemple : 20 phrases
  de 3 s donnent 4 appels au modèle au lieu de 20. Un bloc part aussi après 10 s sans parole, pour
  que le transcript en direct reste à jour.
- **Deux moteurs en parallèle** (un par source : vous, les participants) si la machine a au moins
  4 cœurs et 4 Go de mémoire. Chacun n'utilise qu'un cœur : le reste du PC reste disponible.
- **Garde-fou anti-boucle** : Whisper peut « halluciner » indéfiniment sur du bruit. Le nombre de
  jetons générés est plafonné selon la durée du bloc.
- **Ordre de grandeur avec Whisper small** (machine de mesure lente, 0,88 s de calcul par seconde
  de parole) : dans une réunion d'une heure où les participants parlent 40 min et vous 20 min, le
  moteur « participants » calcule environ 35 min et le moteur « vous » environ 18 min, en parallèle,
  pendant la réunion. Il suit donc le rythme, mais occupe un cœur une bonne partie du temps. Un PC
  portable récent devrait être plus rapide, ce qui n'a pas été mesuré. Si la machine est trop lente,
  rien n'est perdu : la file d'attente s'allonge et se vide après la réunion (affiché à l'écran).
  Dans ce cas, choisir Whisper base (3 fois plus rapide).
- Chargement : 20 à 30 s au lancement pour Whisper small (lecture et démarrage des deux moteurs).
  On peut lancer l'enregistrement pendant ce temps, l'audio attend dans la file.

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
- En-tête : date, horaires, durée, sources, langue, modèle, **vocabulaire de référence** (le
  glossaire), avertissement sur la fiabilité.
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
- Le glossaire est conservé dans le stockage local du navigateur, sur le poste.
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

## 13. Distribution : le modèle est téléchargé au premier lancement

**Décision** : le dépôt ne contient que l'application et le moteur (~16 Mo). Au premier lancement,
Lowsper propose d'installer le modèle :
1. l'utilisateur clique sur « Installer le modèle » puis désigne le dossier Lowsper (celui qui
   contient `Lowsper.html`, vérifié) et accepte que la page y écrive ;
2. les fichiers sont téléchargés depuis Hugging Face **à une révision figée** (identifiant de
   commit) et chaque fichier est contrôlé par **empreinte SHA-256** : un fichier modifié côté
   serveur ou en transit est refusé ;
3. ils sont écrits dans `app/models/<modèle>/` ; l'index `app/models/index.txt` est écrit en
   dernier, si bien qu'une installation interrompue reste invisible et peut être relancée.

Aux lancements suivants, le modèle est lu sur le disque comme le reste de l'application :
aucune autorisation à redonner, aucun réseau.

| Option | Verdict |
|---|---|
| Modèle dans le dépôt (version précédente) | Simple et 100 % hors ligne, mais 120 Mo pour base et 330 Mo pour small, à chaque téléchargement du zip. Écarté à la demande. |
| Stockage dans le navigateur (IndexedDB) | Invisible pour l'utilisateur, effacé par un nettoyage du profil, non copiable vers un autre poste. Écarté. |
| **Écriture dans le dossier Lowsper** | **Retenu** : le modèle est à côté du fichier HTML, le dossier complet se copie tel quel sur un autre poste (clé USB, partage réseau) pour équiper un PC sans accès à Hugging Face. |
| Git LFS | Le « Download ZIP » de GitHub n'inclut pas les fichiers LFS par défaut. Écarté. |

Détails :
- Fichiers écrits en `.txt` (contenant du JavaScript lisible par `<script>`) plutôt qu'en `.js` :
  un navigateur qui écrit des `.js` sur le disque est un comportement que les antivirus et
  l'analyse de téléchargements de Chrome peuvent signaler. Vérifié : Chrome exécute un `.txt`
  chargé par `<script>` en `file://`.
- Fonctionne avec Edge et Chrome. Firefox et Safari n'ont pas l'API d'écriture dans un dossier :
  un message invite à utiliser Edge ou Chrome.
- Test de bout en bout (`tools/test/e2e.mjs`) : installation complète dans une copie du dossier,
  rechargement, réunion simulée. Les empreintes de la révision figée ont été vérifiées contre le
  vrai serveur Hugging Face ; le test rejoue ensuite le téléchargement via un faux serveur local
  (même redirection, mêmes en-têtes CORS), le proxy de l'environnement de développement coupant
  les gros téléchargements de Chromium. `REAL_HF=1` force le vrai serveur.
- `node build.mjs --embed whisper-small` produit une version avec le modèle déjà installé
  (même format), pour une distribution entièrement hors ligne.

## 14. Compatibilité

| Navigateur | Micro | Son des participants |
|---|---|---|
| Edge, Chrome (Windows) | Oui | Oui : partager l'écran entier et cocher « Partager l'audio du système », ou un onglet |
| Chrome (macOS) | Oui | Garanti pour un onglet du navigateur (réunion web). Pour une application de bureau, dépend des versions de macOS et de Chrome |
| Firefox | Oui | Non (Firefox ne capte pas le son d'un partage d'écran) : mode micro seul |
| Safari | Non testé | Non testé |

Si une stratégie d'entreprise interdit le partage d'écran, Lowsper fonctionne en micro seul.

## 15. Limites connues et pistes d'évolution

1. **Mesures sur machine réelle** : les vitesses ont été mesurées sur un conteneur lent, et les
   tests de qualité sur des voix de synthèse. À valider sur un vrai PC et une vraie réunion.
2. **WebGPU** : accélération forte sur les PC équipés d'un GPU correct ; à ajouter en option avec
   détection automatique et repli sur le processeur. Permettrait d'envisager large-v3-turbo.
3. **Diarisation** légère côté « Participants » (distinguer plusieurs voix).
4. **Compte rendu local** par un petit modèle de langage dans le navigateur : écarté pour
   l'instant (plusieurs centaines de Mo à plusieurs Go, qualité nettement inférieure aux IA
   auxquelles l'utilisateur confiera le transcript).
5. **Miroir de téléchargement** (par exemple une version publiée sur GitHub) si Hugging Face est
   bloqué dans certaines entreprises.
