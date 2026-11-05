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

**Décision** : le dépôt ne contient que l'application, les moteurs (processeur et carte graphique) et les deux petits modèles d'analyse audio (~65 Mo en tout). Au premier lancement,
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

## 15. Version 3 : retour d'une vraie réunion (hebdo de 1 h 15)

Retour utilisateur : transcription pas vraiment en direct, phrases manquantes ou mal captées,
aucune distinction entre les 10 à 12 personnes qui parlent, sigles et noms propres à améliorer,
fenêtre trop encombrante, modèle parfois retéléchargé.

### 15.1 Corpus de mesure réaliste

`tools/test/corpus/hebdo-fr.json` : hebdo fictif d'un centre de service, 2 min 40, 20 répliques,
9 voix de synthèse (1 au micro, 8 côté participants), noms propres, sigles, longues interventions
et 3 interruptions qui se chevauchent. Le banc `tools/test/eval-hebdo.mjs` rejoue toute la chaîne
et mesure, réplique par réplique, la part des mots retrouvés au bon moment (« couverture »).

### 15.2 Phrases manquantes : deux causes trouvées et corrigées

Mesure de départ avec Whisper small : **la dernière minute entière était perdue** (5 répliques à 0 %).

1. **Whisper s'arrête avant la fin du bloc.** Il transcrit les 5 premières secondes puis déclare la
   fin du texte, et les 14 secondes suivantes sont ignorées. Correction : **reprise automatique**
   (« seek », comme l'implémentation de référence de Whisper). S'il reste de la parole après le
   dernier horodatage, la suite est transcrite à part.
2. **Boucles d'hallucination** (« je ne sais pas si c'est que l'épargne » répété dix fois) qui épuisent
   le budget de mots du bloc. Correction : détection des boucles (paires de mots peu variées, phrase
   répétée), nouveau décodage sans glossaire avec répétitions interdites, puis en dernier recours
   découpage du bloc aux frontières des prises de parole.
3. Budget de mots élargi (11 jetons par seconde au lieu de 8) et blocs plus courts (18 à 24 s au lieu
   de 24 à 28 s) : un passage raté contamine moins de texte.

| Étape (Whisper small, glossaire) | Couverture | Blocs tronqués | Minute finale |
|---|---|---|---|
| Version 2 | 64 % | 2 | perdue |
| + détection des boucles | 69 % | 0 | perdue |
| + reprise automatique | 73 % | 0 | retrouvée |

Les répliques encore mal captées viennent surtout de deux voix de synthèse peu intelligibles
(vérifié en les transcrivant isolément). Sur la voix micro, aucune erreur.

### 15.3 Détection de parole : Silero VAD

Le détecteur à seuil de volume est remplacé par **Silero VAD** (1,3 Mo, licence MIT), qui donne une
probabilité de parole toutes les 32 ms. Il distingue une voix d'un clavier, d'une musique ou d'un
souffle, et ne rate pas une voix faible quand le volume du partage d'écran est bas. Sur le corpus
synthétique (très propre), le gain mesuré est faible (35,6 % d'erreurs contre 36,0 %) : son
intérêt est sur du vrai son, non mesurable ici. Repli automatique sur l'ancien détecteur en cas de
problème. Il tourne dans un worker d'analyse dédié, avec le modèle d'empreintes vocales.

### 15.4 Plus « en direct »

- Un bloc part **dès la fin d'une phrase** (3 s de parole minimum) quand un moteur est libre, au
  lieu d'attendre 18 à 24 s de parole. Les longs blocs ne servent plus qu'à absorber un retard.
- Après 6 s de silence (au lieu de 10), le bloc en attente part aussi.
- **Jusqu'à 3 moteurs en parallèle** (un par paire de cœurs logiques, 2 si moins de 8 Go de mémoire).
- Indicateur « Charge du moteur » pendant la réunion, et alerte si le PC ne suit pas pendant plus
  de 2 minutes (avec le conseil de passer à un modèle plus rapide).

### 15.5 Distinction des intervenants

Côté « Participants », les voix sont distinguées automatiquement (« Intervenant 1, 2, 3... »).

- Modèle d'empreintes vocales **WeSpeaker ResNet34** (6,7 Mo, licence CC BY 4.0), livré avec
  l'application.
- Méthode : fenêtres glissantes de 2 s (pas de 1 s) sur la parole ; pendant la réunion, chaque
  fenêtre rejoint la voix la plus proche (affichage en direct) ; à la fin, regroupement global :
  fenêtres consécutives semblables réunies en tours de parole, puis regroupement hiérarchique à lien
  moyen (UPGMA), puis les voix de moins de 8 s rattachées à la plus proche. Chaque phrase prend la
  voix majoritaire de ses fenêtres : une interruption sans pause est donc quand même séparée.
- Seuils réglés hors ligne sur les empreintes du corpus (`hebdo-embeddings.json`).

| Méthode | Voix trouvées (réelles : 8) | Phrases attribuées à la bonne voix |
|---|---|---|
| Une empreinte par phrase de Whisper | 6 | 77 % |
| Fenêtres + regroupement en ligne seul | 6 | 75 % |
| **Fenêtres + tours de parole + UPGMA** | **9 à 10** | **98 à 99 %** |

Limites honnêtes : des voix de synthèse sont plus faciles à distinguer que de vraies voix passées
par la compression de Teams ; deux collègues à la voix proche peuvent partager un numéro ; une
même personne peut en recevoir deux (micro différent, voix qui change). Pendant deux paroles
simultanées, une seule voix est retenue.

**Renommage** : à la fin, l'écran liste les voix détectées (temps de parole, première phrase
reconnaissable) et permet de leur donner un nom ; le transcript est mis à jour.

### 15.6 Sigles et noms propres

- Correction de casse sûre : un terme du glossaire reconnu avec une autre casse ou sans accent est
  réécrit dans sa forme exacte (« copil » -> « COPIL », « elodie » -> « Élodie »), mot entier uniquement.
- Le plus gros gain vient du modèle (voir 15.7).

### 15.7 Modèles plus performants et carte graphique

| Modèle (corpus 55 s, 20 sigles) | Mots erronés | Sigles | Calcul / s de parole (processeur) |
|---|---|---|---|
| Whisper small + glossaire | 11 % | 14/20 | 0,9 s |
| **Whisper large-v3-turbo 4 bits + glossaire** | **9,8 %** | **16/20** | 8,7 s |
| Whisper large-v3-turbo 4 bits, sans glossaire | 12 % | 13/20 | 8,7 s |

- Le turbo est le plus précis, mais **10 fois plus lent que small sur le processeur** : il n'est
  proposé qu'avec la **carte graphique (WebGPU)**, et grisé si aucune carte compatible n'est détectée.
- Un modèle plus précis n'est **pas plus rapide** et n'améliore **ni la détection de parole ni la
  distinction des voix** (briques séparées). La vitesse vient de la carte graphique.
- **Whisper small existe aussi en version carte graphique** (4 bits, 300 Mo).
- Le moteur WebGPU (ONNX Runtime, 27 Mo de plus) est livré avec l'application ; le moteur
  processeur seul reste utilisé pour les modèles « processeur » et pour l'analyse audio.
- **Non mesuré : la vitesse réelle sur carte graphique**, faute de carte graphique dans
  l'environnement de développement. Le chemin WebGPU est vérifié fonctionnellement avec une carte
  émulée (SwiftShader), qui ne dit rien de la vitesse. L'indicateur de charge permet à chacun de
  juger sur son propre PC.

### 15.8 Interface

- **Fenêtre réduite** : en dessous de 560 px de large ou 640 px de haut, l'affichage devient compact ;
  en dessous de 520 px de haut, seuls le chronomètre, les niveaux, la dernière phrase et les boutons
  restent. Le test vérifie que « Terminer » reste visible dans une fenêtre de 360 x 460 px.
- **Mini-fenêtre** (Document Picture-in-Picture, Edge et Chrome récents) : une petite fenêtre
  toujours au premier plan, déplaçable, avec chronomètre, niveaux, dernière phrase, Pause et Terminer.
  Ouverture par le bouton « Mini-fenêtre » ; ouverture automatique au changement d'onglet quand le
  navigateur le permet (fonction récente de Chrome pour les pages qui utilisent le micro, non
  garantie). Le passage à une autre application ne peut pas l'ouvrir automatiquement : le bouton
  reste le moyen fiable.
- **Enchaîner les réunions** : bouton « Démarrer la réunion suivante » sur l'écran de fin. Les
  moteurs restent chargés, le démarrage est immédiat.

### 15.9 Modèle retéléchargé : causes probables et parades

1. **Nouvelle version téléchargée en zip** dans un nouveau dossier, sans le modèle. Parade : l'écran
   d'installation explique de copier `app\models` de l'ancien dossier.
2. **Page ouverte directement depuis le zip** : Windows l'extrait dans un dossier temporaire à chaque
   ouverture. Parade : détection du chemin temporaire et message « Extraire tout ».
3. **Mauvais dossier choisi** à l'installation (une autre copie de Lowsper). Parade : Lowsper écrit un
   petit fichier de vérification dans le dossier choisi et vérifie que la page peut le relire ; sinon
   il affiche le bon chemin (« Dossier de cette page : ... »).

### 15.10 Mémoire des voix (facultative)

Pour les réunions récurrentes (hebdo), Lowsper peut reconnaître automatiquement les collègues déjà
nommés. Décision prise avec l'utilisateur, consentement recueilli auprès des participants.

- **Désactivée par défaut**, activation dans Options avec une confirmation qui rappelle qu'une
  empreinte vocale est une donnée biométrique (RGPD, article 9).
- Ce qui est conservé : l'empreinte moyenne de la voix (256 nombres) et le nom. **Aucun enregistrement
  audio.** Stockage uniquement sur le poste (stockage du navigateur).
- **Effacement automatique** 1, 3 ou 6 mois après la création de l'empreinte, et bouton « Effacer les
  voix mémorisées » à tout moment.
- Reconnaissance en fin de réunion seulement, sur les empreintes moyennes des voix (quelques dizaines
  de calculs) : **aucun coût pendant la réunion**.
- Seuil prudent (similarité 0,65) et association une à une : un mauvais nom est pire qu'aucun nom,
  une voix inconnue reste « Intervenant n ». Les noms reconnus sont signalés « reconnu » sur l'écran
  de fin, et restent modifiables.
- L'empreinte d'une personne s'affine à chaque fois qu'on confirme son nom.

### 15.11 Vitesse : le vrai goulot d'étranglement, et le test intégré

Mesure sur la machine de test avec Whisper small : 11,9 s d'encodeur par bloc de 18 s, puis 148 ms
par jeton généré. Pour une parole continue, cela donne une charge de 154 % avec un seul moteur :
**sur un processeur modeste, small ne suit pas une parole continue**, ce qui explique le décalage
ressenti en réunion. Ce n'était pas la cause des phrases manquantes (bugs corrigés en 15.2), mais
cela retardait leur affichage.

Leviers, dans l'ordre d'efficacité :
1. **La carte graphique** (versions « carte graphique » de small et turbo) : le calcul matriciel de
   Whisper est exactement ce que fait bien un GPU. Gain attendu important, non mesurable ici.
2. **Plusieurs moteurs en parallèle** (jusqu'à 3) : la charge est divisée d'autant sur un PC à 8 cœurs
   logiques ou plus.
3. **Whisper base** sur un PC sans carte graphique et peu puissant : environ 3 fois plus rapide, et
   avec le glossaire il retrouve autant de sigles que small (mais plus d'erreurs sur le reste).

Comme la vitesse dépend entièrement du PC, Lowsper **mesure lui-même** : au premier démarrage d'un
modèle (puis à la demande, dans Options), il chronomètre l'encodeur et la génération, et affiche
« environ X s de calcul par minute de parole continue, charge estimée Y % », avec un conseil. Cette
estimation a été vérifiée sur la machine de test : 154 % estimés, cohérent avec les blocs mesurés
sur le corpus (environ 1,5 s de calcul par seconde de parole).

### 15.12 Portable de bureau sans carte graphique, en multitâche

Cible précisée par l'utilisateur : portable professionnel milieu de gamme (processeur de type
Ryzen 5, 6 cœurs / 12 fils, pas de carte graphique dédiée), avec la visio et la suite bureautique
ouvertes. Lowsper doit tourner partout, sans faire ramer le PC, en restant le plus en
direct possible.

Mesures préalables (machine de test) : changer la précision des calculs n'accélère rien sur le
processeur. Whisper small en int8 reste le plus rapide (148 ms par jeton, contre 169 à 180 ms en
fp32), Whisper base est environ 3 fois plus rapide (59 ms par jeton, encodeur 3,5 s au lieu de 12 s).

Décisions :
1. **Niveaux de puissance** (Options) : un moteur qui transcrit occupe un cœur à 100 %.
   - Économe : 1 moteur.
   - **Équilibrée (par défaut)** : un quart des fils en temps normal (3 sur un Ryzen 5 à 12 fils,
     soit environ 25 % du processeur), un tiers en renfort (4) seulement quand du retard s'accumule.
     Les moteurs de renfort sont démarrés à la demande. Teams et Office gardent toujours de la marge.
   - Maximale : la moitié des fils (6).
   Une fois la réunion terminée, la fin du transcript utilise le renfort (le PC est libéré).
2. **Voie rapide de secours** : quand un passage attend depuis plus de 15 s (le PC n'arrive plus à
   suivre), il est transcrit par Whisper base, 3 fois plus rapide. Il s'affiche donc en direct
   (en italique, « provisoire »), puis il est **retranscrit avec le modèle principal** dès qu'un moteur
   est libre (pendant un silence, ou après la réunion). L'écran de fin indique l'avancement et invite
   à retélécharger la version finale. Le direct passe en premier, la qualité suit.
   Whisper base est installé automatiquement avec Whisper small (80 Mo de plus).
3. Le test de vitesse tient compte du nombre de moteurs et de la voie rapide dans son conseil.

Vérifié sur la machine de test (4 cœurs lents, 1 seul moteur autorisé) : la voie rapide a pris en
charge 2 passages pendant une réunion simulée de 90 s, tous retranscrits ensuite avec Whisper small ;
la file d'attente n'a jamais dépassé 3 passages.

Remarque : les Ryzen 5 de 5e génération ont une puce graphique intégrée (Radeon). Chrome et Edge
peuvent l'utiliser via WebGPU ; si Lowsper la détecte, les versions « carte graphique » apparaissent
dans le catalogue. Leur vitesse sur une puce intégrée n'est pas connue : le test de vitesse le dira.

### 15.13 Paramètres et installation de plusieurs modèles

- Toutes les options sont regroupées dans un panneau **Paramètres**, ouvert par une roue crantée en
  haut à droite, accessible à tout moment (y compris pendant une réunion pour la puissance de calcul).
  Sections : Transcription, Modèle, Performance, Voix des intervenants.
- L'écran d'installation utilise des **cases à cocher** : plusieurs modèles peuvent être installés en
  une fois (téléchargement enchaîné, une seule sélection de dossier). Whisper base est coché d'office
  quand un modèle processeur est choisi (voie rapide de secours). Les modèles « carte graphique »
  restent installables sans carte compatible, avec un avertissement : utile pour préparer un dossier
  à copier vers un PC équipé.
- Le bandeau d'avertissement peut être fermé (croix) ; il revient à chaque ouverture de Lowsper, car
  c'est le rappel de prévenir les participants.

### 15.14 Retour terrain : 300 intervenants détectés pour 6 personnes

Réunion réelle de 6 personnes, avec beaucoup d'interruptions : plus de 300 « intervenants ». La
transcription elle-même était complète.

**Cause.** Le regroupement final fusionnait deux voix seulement si leurs empreintes se
ressemblaient au-delà d'un seuil fixe (0,55), réglé sur mes voix de synthèse au son propre. Avec le
son réel d'une visio (compression, bruit, paroles mêlées), les empreintes d'une même personne se
ressemblent moins : presque rien n'était fusionné, et chaque tranche d'au moins 8 s devenait une
« voix » (une heure de parole / 8 s, soit de l'ordre de 300). S'y ajoutait un calcul en temps
cubique, qui devenait très lent sur une heure.

**Reproduction.** Réunion simulée d'une heure (6 ou 10 voix, empreintes bruitées comme un son de
visio, tours enchaînés et chevauchements) et corpus hebdo dégradé façon Teams (Opus 12 kb/s,
bande 200-3800 Hz, bruit rose). L'ancien seuil donnait 12 à 20 voix pour 6 après 5 à 10 minutes,
en hausse avec la durée.

**Corrections.**
1. Pendant la réunion, jamais plus de 12 voix (ou le nombre de personnes indiqué) : au-delà, une
   fenêtre rejoint la voix la plus proche.
2. Regroupement final sans seuil fixe : arbre de regroupement complet, puis choix automatique du
   nombre de voix (critère de silhouette, de 1 à 12) parmi les coupes qui font apparaître des voix
   « significatives » (au moins 8 s et 2 % du temps de parole) ; les fragments rejoignent la voix
   la plus proche.
3. Calcul rapide : matrice des produits scalaires mise à jour par simple addition, plus proche
   voisin mémorisé ; une heure se traite en moins de 3 s (au lieu de plusieurs minutes).
4. Nouveau champ facultatif **« Personnes (vous compris) »** sur l'écran d'accueil : s'il est
   rempli, le nombre de voix est plafonné à ce nombre moins un (vous êtes au micro).

**Résultats.**

| Cas (simulations, 10 à 60 min) | Avant | Après |
|---|---|---|
| 1 personne | jusqu'à 12 | 1 |
| 2 personnes | jusqu'à 12 | 2 |
| 6 personnes, son normal ou très dégradé | 12 à 20, et plus avec la durée | 6 |
| 10 personnes, 1 h | 12 et plus | 10 |
| 6 personnes, « 4 » indiqué | | 4 |

Sur le corpus hebdo (8 voix de synthèse en 2 min 40, deux personnes ne disant qu'une phrase), la
méthode trouve 5 à 6 voix : elle fusionne les voix les plus proches plutôt que d'en créer trop.
Avec « 9 personnes » indiqué, elle en sépare 8. Choix assumé : mieux vaut regrouper deux voix
proches (on peut corriger en renommant) que d'éclater une personne en dizaines de numéros.

Non vérifié : le résultat sur la réunion réelle d'origine. Les empreintes de vraies voix humaines sont en
principe mieux séparées que mes voix de synthèse, mais seul un nouvel essai le dira.

### 15.15 Retour terrain : entretien en tête-à-tête (cybersécurité), 41 min

Transcript d'un entretien en tête-à-tête en visio, deux personnes, vocabulaire cybersécurité.
Défauts relevés, ligne par ligne :

| Constat dans le transcript | Cause | Correction |
|---|---|---|
| 105 « intervenants » pour 1 interlocuteur, changement presque à chaque phrase | ancienne version, avant la correction du §15.14 (l'en-tête n'a pas la ligne « Participants ») | §15.14 + fusion des voix quasi identiques + regroupement en direct (ci-dessous) |
| Phrases coupées en plusieurs lignes (« c'est sur mon périmètre que... » / « que va ouvrir... ») | conséquence directe des fausses voix : deux lignes de voix différentes ne se regroupent pas | idem, plus lissage des fragments |
| « l'NSI », « l'ANC », « BIOCRM », « NTRM », « carpéro hosting », « Wannakrai », « Apoker », « Radat » | sigles inconnus de Whisper, glossaire vide, son de visio compressé | vocabulaires métier intégrés, nom de la réunion en contexte, corrections des déformations relevées |
| « Heuuuuuuuuuuuuuuu », lignes « Euh... », « Hum. » | Whisper étire les hésitations | lettres étirées réduites, hésitations seules retirées |
| « qu'on a aussi l'autonomie » x 3, « pas de répit, pas de vie, pas de vies... » | petites boucles de répétition, non détectées par le moteur | réduction des groupes de mots répétés et coupure des fins de passage en boucle |
| Phrase d'accueil perdue (« Morgenon! » au lieu de « Bonjour ») | son dégradé : Whisper small ne la comprend pas, même isolée | aucune côté logiciel ; un modèle plus gros aide (ci-dessous) |

**Corpus de reproduction.** Entretien fictif de 3 min (« entretien-fr.json »), un recruteur et un
candidat, 28 sigles et noms propres du même type que ceux du retour terrain (ANSSI, EBIOS RM, NTLM,
Kerberoasting, ORADAD, gMSA, SMBv1, EternalBlue, AppLocker, WDAC, CRL, OCSP...). Voix de synthèse,
son du recruteur dégradé façon Teams (comme au §15.14). Il reproduit fidèlement les défauts :
« Ombre Lunaire Industrie », « l'ANCI », « G. M. BZV1 », une boucle en fin de passage, et 2 voix
trouvées pour 1.

**1. Une seule voix pour une seule personne.** Le critère de silhouette trouve toujours une
« structure », même dans une voix unique (intonation, compression) : le recruteur était coupé en
2 voix. Les deux moitiés ont pourtant des empreintes moyennes très proches (0,89), alors que des
personnes réellement distinctes restent à 0,6 au plus après regroupement (corpus hebdo, son propre
ou dégradé). Règle ajoutée : deux voix finales à plus de 0,75 sont fusionnées (sauf si le nombre de
personnes est indiqué). Résultat : 1 voix sur l'entretien, inchangé sur l'hebdo (5 à 6 voix). Les
simulations de 40 min en tête-à-tête, même très dégradées, donnent 1 voix.

**2. Regroupement en direct.** Pendant la réunion, jusqu'à 12 voix provisoires pouvaient
s'afficher pour une seule personne (le regroupement n'avait lieu qu'à la fin). Le regroupement
complet tourne désormais toutes les 45 s environ (moins d'une seconde de calcul) et les voix
provisoires suivantes sont traduites vers les voix regroupées : l'affichage en direct converge.

**3. Lissage.** Un fragment de moins de 2 s, collé sans pause entre deux phrases d'une même voix,
prend cette voix : une phrase n'est plus coupée en deux intervenants.

**4. Vocabulaire métier et contexte.** Nouveau réglage « Vocabulaire métier intégré » (cases :
cybersécurité, informatique et cloud, gestion de projet) qui complète le glossaire personnel. Le
contexte donné à Whisper avant chaque passage devient : nom de la réunion, vocabulaires cochés,
glossaire personnel (le plus important à la fin, car seule la fin est gardée). Chaque vocabulaire
porte quelques corrections de déformations réellement observées (« l'NSI » -> « l'ANSSI »,
« NTRM » -> « NTLM », « BIOCRM » -> « EBIOS RM », « Wannakrai » -> « WannaCry »...), appliquées
seulement si le vocabulaire est coché. Garde-fous : si Whisper récite la liste du glossaire ou le
nom de la réunion sur un passage peu audible, la ligne est retirée.

Mesures sur le corpus d'entretien (Whisper small, processeur) :

| Réglage | Sigles et noms bien écrits | Erreurs (micro) | Erreurs (recruteur, son de visio) |
|---|---|---|---|
| Aucun vocabulaire (cas du vrai entretien) | 6 / 35 | 9,6 % | 48 % |
| Vocabulaire cybersécurité + nom de la réunion | 13 / 35 | 6,7 % | 47 % |
| Idem + fin du passage précédent en contexte | 13 / 35 | 8,7 % | 49 % |
| **Version finale** (vocabulaire + nom + filtres + fusion des voix) | **13 / 35** | **6,7 %** | **42 %** |

Version finale : 1 intervenant trouvé pour 1 réel (2 auparavant), la boucle de fin coupée.

Le contexte « passage précédent » (pratique de l'implémentation de référence de Whisper) n'apporte
rien ici et risque de propager une erreur : non retenu.

**5. Limite principale : le son de la visio.** Côté recruteur, Whisper small se trompe sur près d'un
mot sur deux avec un son compressé, quels que soient les réglages ; côté micro, moins d'un mot sur
dix. Le levier restant est le modèle : large-v3 turbo, plus précis sur les sigles (§15.7), mais
seulement avec une carte graphique (le PC fixe). Sur le processeur de l'environnement de test, il
n'a pas pu traiter ce corpus de 3 min en une heure : il n'est pas envisageable sur un portable sans
carte graphique, même après la réunion. Sa précision sur ce corpus dégradé n'a donc pas pu être
mesurée ici.

### 15.16 Réglages perdus, micro à une seule voix, mini-fenêtre façon Teams

Retours après la fusion : les sigles saisis le vendredi avaient disparu le lundi ; « ce qui vient de
mon micro est toujours un seul interlocuteur » ; l'application doit se réduire comme un appel Teams
et être vraiment petite.

**1. Réglages conservés.** Cause la plus probable (non vérifiable d'ici) : la stratégie d'entreprise
qui efface les données du navigateur à sa fermeture (fréquente sur les postes gérés). Le stockage
du navigateur ne peut donc pas être la seule copie. Lowsper écrit désormais ses réglages dans son
propre dossier (`app/reglages.txt`), relu au lancement par une balise `<script>`, comme les modèles :
tout réglage absent du navigateur est restauré depuis ce fichier, sans action de l'utilisateur.
- Contenu : sigles, vocabulaires métier, langue, options, puissance, modèle, mesures de vitesse,
  voix mémorisées si cette option est activée. Jamais le texte d'une réunion.
- Écriture : il faut l'accord du navigateur pour écrire dans le dossier. Il est obtenu à
  l'installation d'un modèle (le dossier est déjà choisi à ce moment-là), sinon par un bouton des
  paramètres. Ensuite, la copie est mise à jour à chaque fermeture du panneau Paramètres, si quelque
  chose a changé (au pire une petite demande d'autorisation du navigateur).
- Le navigateur garde la main : un réglage qu'il possède n'est jamais écrasé par la copie.
- Sont aussi mémorisés désormais : la langue et les cases à cocher (avant : remises à zéro).

**2. Le micro, c'est vous, et seulement vous.** C'était déjà le cas pour l'étiquette (« Vous »), mais
sans casque le micro réentend les haut-parleurs : l'écho des participants était attribué à « Vous »
(constaté dans l'entretien : « de la partie technique. », « complexe. »). L'anti-écho existant
compare les textes, ce qui échoue quand Whisper transcrit différemment les deux versions.
Lowsper utilise maintenant le fait que le micro n'a qu'une voix :
- votre empreinte vocale est apprise sur les phrases du micro dites **pendant que les participants
  se taisent** (détection de parole du son de la réunion) : à ce moment-là, ce ne peut être que vous ;
- une phrase du micro dite pendant que les participants parlent, et dont la voix n'est pas la vôtre
  (similarité < 0,4), est retirée en fin de réunion ; l'écran de fin indique combien.
Premier essai écarté : apprendre la voix sur tout le micro. Dans un entretien où l'autre parle
beaucoup, l'écho est majoritaire et c'est **sa** voix qui était apprise (mesuré : écho à 0,8, vraie
voix à 0,2) ; le filtre aurait retiré vos propres réponses.
Prudence : rien n'est retiré tant qu'il n'y a pas 15 s de parole « seul au micro » ; une phrase dite
quand les participants se taisent est toujours gardée ; l'empreinte n'est jamais enregistrée.
Mesure (entretien de test, micro sans casque : l'écho du recruteur arrive au micro à environ 35 %
de son volume) :

| | Erreurs sur votre voix | Phrases d'écho attribuées à « Vous » | Vos phrases perdues |
|---|---|---|---|
| Avec casque (référence) | 6,7 % | 0 | 0 |
| Sans casque, avant | 70 % | 6 | 0 |
| Sans casque, après | 10,6 % | 2 (très courtes : « PingCastle. », « Eh, le... ») | 0 |

Deuxième piège corrigé en route : Whisper réunit parfois la fin de l'écho et votre réponse dans la
même phrase. Une telle phrase est gardée dès que plus d'1,2 s tombe hors de la parole des
participants (premier réglage : 3 de vos réponses perdues ; réglage final : aucune). Choix assumé :
mieux vaut un reste d'écho que la perte d'une de vos phrases. Les phrases de moins d'une seconde ne
sont pas jugées (empreinte trop peu fiable).

**3. Mini-fenêtre façon appel Teams.**
- Dès le début de l'enregistrement, Lowsper se réduit en mini-fenêtre (Document Picture-in-Picture,
  toujours au premier plan) **si le navigateur l'autorise** : il faut que le clic sur « Démarrer »
  soit encore récent après les fenêtres de partage d'écran et de micro. Sinon, un clic sur
  « Mini-fenêtre » suffit, et Chrome/Edge peuvent l'ouvrir d'eux-mêmes au changement d'onglet.
  Désactivable dans les paramètres.
- Mini-fenêtre ramenée de 360 x 250 à **340 x 96** pixels : une barre (point rouge, durée, niveaux
  « Vous » et « Réunion », pause et fin en icônes), un avis éventuel, la dernière phrase transcrite.
- Même barre si l'on réduit la hauteur de la fenêtre de Lowsper (240 pixels ou moins).
- Écran d'accueil allégé : « Personnes » sans parenthèse (précision en info-bulle), mode d'emploi
  repliable, replié automatiquement après 3 réunions.
Non vérifiable ici : l'ouverture automatique de la mini-fenêtre dépend des règles d'activation du
navigateur, que le navigateur sans écran des tests ne reproduit pas.

### 15.17 Retour terrain : boutons bloqués après une heure, mots mal compris, barre encore plus petite

**1. Boutons qui ne répondent plus (réunion d'une heure, mini-fenêtre).** Cause exacte non prouvée
(pas de journal du poste), mais une cause mesurée suffit à l'expliquer : le regroupement des voix
en direct (§15.15), qui tourne sur la page elle-même toutes les 45 s, prenait **2,5 à 2,8 s** de
calcul après une heure de réunion (simulation, sur la machine de test ; davantage sur un portable
occupé par Teams et la transcription). Pendant ce temps, la page et la mini-fenêtre sont figées :
un clic tombe dans le vide ou arrive en retard, et deux clics rapides sur « Pause » s'annulent.
Corrections :
- regroupement en direct allégé (240 tours de parole au lieu de 900) : **0,2 à 0,3 s** après une
  heure, même nombre de voix trouvé (2 et 6) ; le regroupement final, une seule fois à la fin,
  garde le calcul complet ; un test vérifie le budget (moins d'une seconde) ;
- « Terminer » ne peut plus être bloqué : fermeture de la mini-fenêtre et arrêt de la capture
  protégés (au pire 10 s d'attente), retour des commandes dans la page sécurisé ;
- bouton **« Terminer la réunion » de secours dans la page principale**, toujours présent quand
  la mini-fenêtre est ouverte, indépendant d'elle ;
- test de bout en bout : vrais clics de souris dans la mini-fenêtre (pause puis reprise).
Autre cause possible, hors de portée du code : la mise en veille des onglets par Edge (« onglets
en veille », mode efficacité). À surveiller si le blocage se reproduit.

**2. Mini-fenêtre sur une seule ligne.** 300 x 48 pixels : point rouge et durée, deux fines
barres (micro et réunion, détail au survol), pause, flèche, fin. La flèche déplie une deuxième
ligne (dernière phrase, avis) ; elle se colore quand un avis attend d'être lu.

**3. Mots mal compris.** Dans l'extrait transmis, les erreurs portent surtout sur des noms propres
et du jargon interne que Whisper ne peut pas connaître : noms de projets et de clients, sigles
maison. Aucun modèle ne les
devinera ; le levier est de les lui apprendre, et de le faire sans effort :
- **« Corriger un mot partout »** sur l'écran de fin : mot mal reconnu, bonne écriture, et le
  transcript est corrigé partout ; la correction est **retenue** (appliquée d'office aux réunions
  suivantes) et le bon mot rejoint le glossaire (Whisper l'écrira directement la fois suivante) ;
- **« À vérifier »** : Lowsper propose les noms propres probables les plus rares (une majuscule en
  milieu de phrase, absents du glossaire). Sur l'extrait transmis, les mots proposés étaient exactement les mots
  déformés. Un clic pré-remplit la correction ;
- corrections apprises visibles et supprimables dans les paramètres, conservées avec les réglages
  (copie dans le dossier, §15.16) ;
- vocabulaires enrichis : BIA, PSSI, matrice de conformité, sensibilisation (cybersécurité) ; RAO,
  appel d'offres, TMA (gestion de projet). Écarté : « PAS » (plan d'assurance sécurité), qui
  aurait mis en majuscules chaque « pas » de la langue française.
Les termes ambigus de l'extrait n'ont pas été devinés : la bonne écriture vient de l'utilisateur.
Ce sont ses projets et ses clients : ils vont dans ses réglages, pas dans les vocabulaires intégrés partagés. Pour les saisir sans
attendre la fin d'une réunion, les paramètres permettent désormais d'ajouter une correction à
l'avance (« Mots que Whisper déforme »).

### 15.18 Retour terrain : la moitié d'un entretien manquante

Entretien de 22 min : transcript complet jusqu'à 9 min, puis une seule phrase isolée (14 min), puis
plus rien. Les deux sources (micro et participants) s'arrêtent au même moment : ce n'est pas la
capture du son, c'est le moteur.

**Cause dans le code (certaine) : un échec du moteur faisait perdre le passage, en silence.**
- L'audio d'un passage était *transféré* au moteur (plus aucune copie côté page) ; en cas
  d'erreur, le passage était simplement abandonné (`console.error`), sans nouvel essai.
- Le moteur en échec restait dans le circuit. Une erreur de mémoire du moteur WebAssembly le laisse
  inutilisable : tous les passages suivants échouent à leur tour. C'est exactement le profil
  observé (tout disparaît à partir d'un instant, sur les deux sources).
- Le transcript ne disait rien : impossible de savoir qu'il manquait la moitié de l'entretien.
Cause première de l'échec du moteur sur le poste (mémoire, mise en veille de l'onglet...) : non
déterminée faute de journal ; le test d'endurance ci-dessous vise à la reproduire.

**Principe adopté : ne jamais perdre un passage, et ne jamais se taire.**
1. Le moteur reçoit une *copie* de l'audio ; l'original reste dans la file jusqu'au succès.
2. En cas d'échec, le moteur est **remplacé par un moteur neuf** (mémoire remise à zéro) et le
   passage repart en tête de file, jusqu'à 3 essais.
3. **Chien de garde** : un passage sans réponse après 3 min (ou 15 fois sa durée) déclare le moteur
   bloqué ; il est remplacé et le passage relancé.
4. Après 3 échecs, le passage est mis de côté **avec son audio** (en mémoire seulement), signalé
   dans le transcript à sa place (« Passage non transcrit ») et un bouton « Réessayer ces passages »
   le relance sur l'écran de fin.
5. **Couverture** dans l'en-tête de chaque transcript : « toute la parole détectée a été
   transcrite », ou le pourcentage et la durée manquante. L'écran de fin le dit aussi.
6. Test de bout en bout : panne simulée du moteur en pleine réunion, le passage est relancé et la
   couverture reste totale.
Test d'endurance (`tools/test/soak.mjs`) : un même moteur transcrit en continu des passages
réalistes (son de visio dégradé, glossaire). Sur 45 min de parole (147 passages, 80 min de calcul) :
**aucun échec, mémoire stable** (2,1 Go pour la page, sans dérive), vitesse stable. La panne observée chez
l'utilisateur ne vient donc pas d'une usure progressive du moteur seul ; elle reste à attribuer
(mémoire du poste en multitâche, mise en veille de l'onglet, moteurs supplémentaires). Quelle
qu'en soit la cause, elle ne fait plus perdre de passage.

### 15.19 Exigence : quatre réunions d'une heure d'affilée, sans temps mort ni parole perdue

Rappel de l'utilisateur : l'outil devient stratégique (comptes rendus de réunion, aujourd'hui
inexistants) seulement s'il ne manque aucune parole et s'il enchaîne une matinée de réunions ; sa
valeur ajoutée est que tout reste sur le poste.

**Enchaînement sans temps mort.** Avant : « Terminer » arrêtait le partage d'écran et le micro,
attendait la fin des calculs, puis il fallait redémarrer et revalider le partage d'écran. Désormais
un bouton **« Réunion suivante »** (aussi dans la mini-fenêtre) termine la réunion en cours et
démarre la suivante **à la même seconde**, avec le même partage d'écran et le même micro : aucune
fenêtre à revalider, aucune parole perdue entre les deux. La réunion terminée est finalisée en
arrière-plan (derniers passages, voix, écho) puis enregistrée dans les Téléchargements ; chaque
fichier a ses propres horodatages, ses propres intervenants et sa ligne de couverture. L'écran de
fin liste les réunions précédentes de la session (nouveau téléchargement possible).

**Qualité « niveau Teams » : ce qui est atteignable, honnêtement.**
- La transcription de Teams tourne sur des serveurs avec de très gros modèles, sur le son avant
  compression. Lowsper n'entend que le son tel qu'il sort des haut-parleurs (compressé).
- Mesures : Whisper small sur le processeur fait environ 7 à 10 % de mots erronés sur le micro,
  mais 42 % sur notre son de visio de test très dégradé (voir §15.15). C'est la limite principale.
- Le levier est un modèle plus gros (large-v3 turbo), qui demande un processeur graphique. Les
  Ryzen 5 de portable ont un processeur graphique **intégré** (Radeon) ; Edge peut l'utiliser
  (WebGPU). À vérifier sur le poste : installer « Whisper small (carte graphique) » puis turbo, et
  lancer « Mesurer la vitesse de ce PC ». Non mesurable ici (pas de processeur graphique).
- Les noms propres et le jargon, quel que soit le modèle : glossaire, vocabulaires métier et
  corrections apprises (§15.17).


### 15.20 Retour terrain : réunion de 1 h 30, cinq phrases transcrites

Transcript d'une réunion de 90 min : 5 passages, très espacés (20, 23, 50, 63 et
87 min). L'en-tête n'a pas de ligne « Couverture » : la réunion a tourné **sans** le correctif du
§15.18 (pull request pas encore fusionnée), donc avec l'ancien comportement où un passage en échec
était jeté en silence. Cause première sur le poste : toujours inconnue faute de journal.

Deux autres maillons faibles trouvés en relisant la chaîne, chacun capable de perdre de la parole :
- **Détection de parole et empreintes vocales partageaient le même processus**, avec une file
  unique : sur un PC saturé (Teams, Office, trois moteurs de transcription), la détection de
  parole attendait derrière le calcul des empreintes et prenait des minutes de retard.
- **À la fin, l'arrêt n'attendait que 10 s** la fin de la détection en retard (§15.17) : tout le
  son encore en attente était abandonné.

**Principe : le son reçu est la référence, et rien ne doit dépendre d'un seul maillon.**
1. **Analyseurs séparés** : la détection de parole a son propre processus, jamais bloqué par les
   empreintes vocales.
2. **Détection jamais bloquante** : sans réponse en 3 s, le morceau est découpé au seuil de volume
   et la capture continue.
3. **Filet de sécurité** : tout le son reçu est gardé **en mémoire** (16 kHz, 16 bits : environ
   115 Mo par heure et par source ; jamais écrit sur le disque, effacé en quittant la page ou à la
   réunion suivante de la session). En fin de réunion, Lowsper relit ce son, repère la parole
   qu'aucun passage transcrit ne couvre (volume au-dessus du bruit de fond, confirmé par le
   détecteur de parole) et la transcrit : **rattrapage**. L'en-tête l'indique (« Rattrapage :
   X s de parole manquée en direct, retrouvée et transcrite »).
4. **Alerte pendant la réunion** si la détection prend plus de 30 s de retard (PC saturé), en
   précisant que rien n'est perdu.
5. **Journal technique** téléchargeable sur l'écran de fin : déroulé de la réunion côté logiciel
   (blocs, échecs et messages d'erreur, relances, retard de la détection, file d'attente, onglet
   masqué ou visible, mémoire), **sans aucun texte de la réunion**. Au prochain incident, il dira
   où la chaîne a cédé, au lieu de supposer.

Test de bout en bout : 12 s de parole volontairement jetées en direct (comme un détecteur bloqué),
plus une panne simulée du moteur, plus un enchaînement de deux réunions. Résultat : la parole jetée
est retrouvée par le rattrapage (« Rattrapage : 9 s »), couverture totale, 20 vérifications sur 20.

## 16. Limites connues et pistes d'évolution

1. **Mesures sur machine réelle** : vitesses mesurées sur un conteneur lent sans carte graphique,
   qualité mesurée sur des voix de synthèse. À valider sur un vrai PC et une vraie réunion.
2. **Vitesse réelle sur carte graphique** : à mesurer sur le PC de l'utilisateur (test intégré).
3. **Paroles simultanées** : une seule voix est transcrite pendant un chevauchement ; séparer deux
   voix mélangées demanderait des modèles beaucoup plus lourds.
4. **Compte rendu local** par un petit modèle de langage dans le navigateur : écarté pour l'instant.
5. **Miroir de téléchargement** si Hugging Face est bloqué dans certaines entreprises.
