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
  *Remplacé par §15.7 : le moteur WebGPU est livré pour les modèles « carte graphique ».*

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
  *Remplacé par §15.5 et §15.14 : les voix des participants sont désormais distinguées.*

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
  *Précisé par §15.20 : tout le son de la réunion reste en mémoire jusqu'à la réunion suivante ou
  la fermeture de la page (filet de sécurité), toujours sans écriture sur le disque.*
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
  un message invite à utiliser Edge ou Chrome. Firefox ne transcrit donc qu'avec un dossier dont le
  modèle a déjà été installé depuis Edge ou Chrome (§14).
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
| Firefox | Oui, si le modèle a été installé depuis Edge ou Chrome (§13) | Non (Firefox ne capte pas le son d'un partage d'écran) : mode micro seul |
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

## 17. Socle vitrine : build reproductible, contrôles automatiques, données fictives

Objectif : un dépôt public que l'on peut montrer tel quel, dont chaque garantie annoncée est
vérifiée par une machine, et qui ne contient aucune donnée réelle.

### 17.1 Build reproductible : le verrou des modèles

**Constat.** Sur un clone neuf, `node build.mjs` échouait en une seconde : il attendait Silero VAD
et WeSpeaker dans `tools/.cache`, mais `fetch-model.mjs` ne savait pas les télécharger. Pire, le
build commençait par vider `app/engine` : lancé dans le dépôt, il laissait l'application sans
détection de parole ni empreintes vocales. Par ailleurs, `fetch-model.mjs` résolvait la révision
`main` au moment du téléchargement : deux développeurs pouvaient obtenir des fichiers différents
(constaté : la révision de `whisper-base` avait changé, par chance avec les mêmes empreintes).

| Option | Verdict |
|---|---|
| Documenter un téléchargement manuel de Silero et WeSpeaker | Fragile, invérifiable. Écarté. |
| Versionner les fichiers sources dans `tools/` | 8 Mo de binaires en double dans le dépôt. Écarté. |
| **Verrou `tools/models.lock.json`** | **Retenu** : comme `package-lock.json`, il fige pour chaque modèle la source, le commit et l'empreinte SHA-256 de chaque fichier. |

- `fetch-model.mjs` télécharge la révision du verrou et refuse tout fichier dont l'empreinte
  diffère. Changer de révision est un acte volontaire (`--update`), relu dans une pull request.
- Silero VAD vient du dépôt officiel (commit figé, fichier identique à celui livré, vérifié par
  empreinte) ; WeSpeaker de `onnx-community/wespeaker-voxceleb-resnet34-LM`.
- `build.mjs` lit le catalogue dans le verrou (inutile de télécharger 1 Go pour connaître des
  empreintes) et vérifie tous ses prérequis **avant** de modifier `app/engine`.
- Vérifié : sur un clone neuf, `npm run fetch-all` puis `npm run build` reproduisent les neuf
  fichiers de `app/engine` **à l'octet près**, et le manifeste à l'identique hors date de build.

### 17.2 Intégration continue : ce qui tourne à chaque pull request, et ce qui reste manuel

| Contrôle | En CI | Pourquoi |
|---|---|---|
| Lint (ESLint), formatage (Prettier) | Oui | Quelques secondes. |
| Tests unitaires (`unit.mjs`) | Oui | 16 s, Node seul, sans modèle. |
| Test de non-fuite réseau (`csp.mjs`) | Oui | 15 s, Chromium seul, sans modèle (§17.3). |
| Bout en bout (`e2e.mjs`) | Non, manuel | 330 Mo de modèles à télécharger ou mettre en cache, 4 min sur la machine de développement, sensible à la vitesse de la machine (seuils de file d'attente). Sur les machines partagées de la CI, il serait lent et instable : un test qui échoue au hasard finit ignoré. |
| Qualité (`eval.mjs`, `eval-hebdo.mjs`), endurance (`soak.mjs`) | Non, manuel | Ce sont des mesures, pas des tests : de 5 min à plus d'une heure, résultats à interpréter. |

Règle (`AGENTS.md`) : l'e2e est lancé à la main avant toute pull request qui touche la capture,
le moteur ou l'interface, et son résultat est noté dans la description.

### 17.3 Test de non-fuite réseau rapide

Jusqu'ici, la non-fuite n'était vérifiée qu'en fin d'e2e. `tools/test/csp.mjs` la vérifie en
15 secondes, sans modèle :
- **statique** : une seule politique, avant tout script ; `connect-src` égal à la liste Hugging
  Face, ni plus ni moins ; `default-src 'none'` ; aucune origine distante ailleurs ; ni
  `'unsafe-inline'` ni `'unsafe-eval'` ; aucune API réseau (`fetch`, `XMLHttpRequest`,
  `WebSocket`, `sendBeacon`, `EventSource`...) dans `app/js` hors de `installer.js` ; aucune
  ressource distante dans la page ni les styles ;
- **dans Chromium** : la page ouverte en `file://` ne fait aucune requête ; un envoi vers un autre
  site (`fetch` en POST, `WebSocket`, `sendBeacon`) est bloqué par la politique.
- Vérifié qu'il échoue : avec un site supplémentaire dans `connect-src`, le test passe en échec.

Analogie : l'e2e est l'essai sur route, `csp.mjs` le contrôle technique. Le second ne remplace pas
le premier, mais il tourne à chaque modification.

### 17.4 Outils de qualité, réservés aux développeurs

- ESLint 9 et Prettier 3 en dépendances de développement de `tools/`, versions exactes. Rien n'est
  ajouté à ce que télécharge l'utilisateur, hormis des fichiers de configuration dans `tools/`.
- Réglage Prettier choisi pour coller au style existant : sur 6 782 lignes, la largeur 120 avec
  virgules finales « es5 » en modifie 260 (4 %), contre 394 à 408 en largeur 100. Une ligne
  reformatée pouvant devenir plusieurs, le commit compte 927 lignes ajoutées et 261 retirées. Il
  est isolé (`style:`) et ne contient que du formatage, pour ne pas brouiller la relecture.
- Le lint a relevé dix erreurs, toutes sans effet sur le comportement : caractères échappés
  inutilement dans des expressions régulières, une importation et une variable inutilisées.

### 17.5 Versionnage

SemVer, tags `vX.Y.Z`, journal `CHANGELOG.md` au format Keep a Changelog. Première version
taguée : **3.0.0**, cohérente avec la « version 3 » de §15 ; les versions antérieures n'ont pas de
tag. Une version majeure signale que l'utilisateur doit agir (format de `app/models` ou de
`app/reglages.txt`, navigateur abandonné).

### 17.6 Zéro donnée réelle, y compris dans l'historique

**Constat.** Le dépôt contenait le nom d'un employeur réel (README, code, tests, corpus, y compris
prononcé dans les fichiers audio de l'entretien de test), celui d'un client et des mots déformés
tirés de transcripts réels. Ils figuraient aussi dans l'historique Git et dans un message de commit.

- Noms remplacés par des noms fictifs (« Ombrelune Industries », projet « Mira Bello »...) partout.
- Corpus d'entretien **régénéré** avec le nom fictif (Piper, mêmes voix), et non simplement coupé.
  Les variantes « son de visio » et « écho » sont désormais produites par un script
  (`tools/test/corpus/make-variants.py`, graine fixe), alors qu'elles avaient été faites à la main.
- Historique réécrit (`git filter-repo`) avec la même table de remplacement, anciens fichiers audio
  de l'entretien retirés, ainsi que l'ancien modèle `whisper-base` versionné au tout début du
  projet (sans risque, mais 100 Mo inutiles à chaque clone).
- `AGENTS.md` fait de cette règle une contrainte non négociable, et le modèle de pull request la
  rappelle.

**Mesures refaites sur le corpus régénéré** (Whisper small, processeur, vocabulaire
cybersécurité et nom de la réunion, comme la version finale de §15.15) :

| Corpus | Sigles et noms bien écrits | Erreurs (micro) | Erreurs (recruteur, son de visio) | Voix trouvées |
|---|---|---|---|---|
| Ancien corpus (§15.15) | 13 / 35 | 6,7 % | 42 % | 1 pour 1 |
| **Corpus régénéré** | **11 / 35** | **5,8 %** | **49 %** | **1 pour 1** |

Les écarts ne viennent pas du code (inchangé) mais du son : version récente de Piper, qui ne
redonne pas les mêmes échantillons, et variante « son de visio » désormais produite par script,
dont les réglages exacts d'origine n'étaient pas connus. Le constat de §15.15 tient : sur un son de
visio dégradé, Whisper small se trompe sur près d'un mot sur deux ; sur le micro, moins d'un sur
dix. La mesure « micro sans casque » (§15.16) a d'abord révélé un défaut du moteur ; elle a été
refaite après sa correction (§17.8).

### 17.7 Règles du projet pour les agents de code

`AGENTS.md` est la source de vérité des règles : contraintes, conventions, définition de
« terminé », commandes, carte du dépôt. `CLAUDE.md` ne fait que l'importer : une seule copie à
maintenir. Le README reste destiné aux utilisateurs.

### 17.8 Défaut corrigé (3.0.1) : contexte et texte généré dépassaient la fenêtre de Whisper

En refaisant la mesure « micro sans casque » sur le corpus régénéré, le moteur a échoué
(« failed to call OrtRun », erreur de dimension dans le décodeur).

**Cause, confirmée par une mesure instrumentée.** Whisper ne traite que **448 jetons** au total
(`max_target_positions`), contexte compris. Lowsper donne jusqu'à 200 jetons de contexte
(glossaire, vocabulaire métier, nom de la réunion), plus 4 jetons de tâche, et autorise
`11 × durée + 24` jetons générés. Sur le corpus d'entretien (contexte de 192 jetons), le seul bloc
en échec durait 23,9 s : 196 + 288 = **484** jetons prévus. Tous les blocs réussis restaient sous
448 (435 au plus). L'échec suppose une génération qui s'allonge (parole dense, écho), d'où sa
rareté.

**Conséquence avant correctif.** Le passage était relancé trois fois sur un moteur neuf, avec la
même entrée, donc trois fois en échec, puis signalé « Passage non transcrit » (§15.18). Cause
plausible de passages manquants sur le terrain, non confirmée faute de journal.

| Option | Verdict |
|---|---|
| Plafonner le budget à `448 − préfixe` | Écarté : un bloc long atteindrait le plafond, serait pris pour une boucle (§15.2) et redécodé **sans glossaire**, avec perte des sigles et un décodage de plus. |
| Réessayer sans contexte après un échec | Écarté : soigne le symptôme, coûte un décodage raté à chaque fois. |
| **Raccourcir le contexte quand la place manque** | **Retenu** : le contexte perd son début (sa fin, la plus importante, est gardée), le budget du bloc est inchangé. Si tout tenait déjà, rien ne change. |

- Fonction pure `decodePlan` (`app/js/engine.js`), partagée par la page et le Worker. La limite est
  lue dans la configuration du modèle.
- Test unitaire : toutes les combinaisons de durée (3 à 40 s) et de contexte (0 à 200 jetons)
  tiennent dans 448, et le comportement est inchangé quand tout tenait.
- Effet : sur un bloc de 24 s avec un contexte plein, le contexte garde 156 jetons sur 200.

**Mesure après correctif** (entretien, micro sans casque, Whisper small, vocabulaire cybersécurité
et nom de la réunion) : le banc va jusqu'au bout. Erreurs sur votre voix 5,8 % (autant qu'avec
casque), aucune phrase d'écho attribuée à « Vous » (6 retirées par la voix), 12 sigles et noms bien
écrits sur 35, une voix trouvée pour une.

**Performance du direct.** Banc `npm run bench` (Whisper small, 25 s de parole, sans contexte),
versions alternées sur la machine de développement : médiane 15,7 s avant, 16,1 s après, sur
6 mesures chacune, avec une dispersion de 1,2 à 3,2 s à l'intérieur d'une même version. Les deux
versions produisent un texte identique (4 transcriptions, horodatages compris), donc le même
nombre de jetons et le même calcul : l'écart est du bruit de mesure. Le correctif n'ajoute qu'un
calcul arithmétique par décodage. Le banc ne fonctionnait plus depuis l'installation du modèle au
premier lancement (`bench.html` ne lisait pas `app/models/index.txt`) : réparé.

## 18. Ouverture à la communauté : paquet de distribution et documentation

Objectif : qu'une personne qui découvre le dépôt comprenne en une minute ce que fait Lowsper,
l'installe sans aide, et qu'un contributeur ou un RSSI trouve ce qu'il cherche sans lire le code.

### 18.1 Un paquet par version, plutôt que « Download ZIP »

Le zip automatique de GitHub contient tout le dépôt : outils, tests, une vingtaine de Mo de corpus
audio, et des fichiers qui ne parlent qu'aux développeurs.

| Option | Verdict |
|---|---|
| Garder « Download ZIP » | Simple, mais l'utilisateur reçoit des fichiers inutiles et ne peut vérifier aucune empreinte. Écarté. |
| Paquet construit à la main à chaque version | Erreurs d'oubli, empreinte non reproductible. Écarté. |
| Action GitHub tierce de publication | Dépendance de plus dans la chaîne de publication, pour un besoin couvert par la commande `gh` déjà présente sur les machines de GitHub. Écarté. |
| **Script `tools/release.mjs` + workflow à la publication d'une release** | **Retenu.** |

- Contenu : `Lowsper.html`, `app/` (sans modèles installés ni réglages, exclus explicitement),
  `LICENSE`, les deux README, `SECURITY.md`, `CHANGELOG.md`. 27 fichiers, 22,7 Mo pour la 3.0.2.
- **Reproductible** : fichiers triés, dates fixes, compression déterministe, zip écrit sans
  dépendance (Node.js). Deux constructions donnent les mêmes octets : l'empreinte SHA-256 publiée
  peut être vérifiée par quiconque reconstruit le paquet depuis le tag.
- Vérifié : relu par `unzip` et par Python ; la page extraite s'ouvre dans Chromium sans erreur
  ni requête réseau. Le test `tools/test/release.mjs` (en CI) contrôle le contenu et la
  reproductibilité ; il a d'ailleurs attrapé un oubli dans la première version de la sélection
  (`app/reglages.txt` aurait été livré s'il avait été versionné).
- Le workflow refuse un tag qui ne correspond pas à la version de `tools/package.json`, et ignore
  sans échec les versions antérieures au paquet (3.0.0 et 3.0.1).

### 18.2 Documentation par public

| Public | Document |
|---|---|
| Utilisateur | `README.md` : promesse, captures, comparatif, installation, FAQ, limites, feuille de route |
| Lecteur anglophone | `README.en.md` : une page, renvoie au README pour le détail |
| DSI, RSSI | `docs/deploiement.md` (flux réseau, distribution hors ligne, prérequis, données produites) et `SECURITY.md` |
| Contributeur | `CONTRIBUTING.md`, `docs/architecture.md` (schéma du trajet du son, où modifier quoi), `AGENTS.md` |

- **Langue** : l'interface et la documentation restent en français (contrainte du projet) ; un
  résumé anglais d'une page élargit l'audience sans doubler la maintenance.
- **Comparatif** : le README compare des catégories d'outils (services en ligne, applications de
  dictée locales) plutôt que des produits nommés, dont les fonctions changent vite. Lowsper n'est
  pas un outil de dictée : c'est un greffier de réunion hors ligne.
- **Captures** : produites par `tools/test/screenshots.mjs`, qui rejoue le corpus synthétique dans
  la vraie page avec le vrai moteur, puis nomme les voix avec des prénoms fictifs. Aucune donnée
  réelle ne peut y apparaître, et elles se régénèrent à chaque évolution visible. Prises sur la
  machine de développement, lente : l'indicateur de charge y dépasse 100 %, ce que la légende dit.
- **Guide de déploiement** : les stratégies de navigateur (micro, capture d'écran, système de
  fichiers, URL bloquées) sont citées par fonction, sans nom exact : ce guide renvoie à la
  documentation officielle de Microsoft et de Google plutôt que de risquer un nom inexact.
- **Code de conduite** : traduction française officielle du Contributor Covenant 2.1, sans
  modification hormis le canal de signalement (signalement privé du dépôt, en attendant une
  adresse dédiée).

## 19. Import de fichiers audio (3.1.0)

Objectif : transcrire un enregistrement fait sans PC (dictaphone, téléphone, autre outil) avec
exactement le même moteur que le direct, y compris pour des fichiers de plusieurs heures.

### 19.1 Le vrai problème : décoder des heures de son sans saturer la mémoire

Mesures dans Chromium, même politique de sécurité que Lowsper, fichiers synthétiques d'une heure
(corpus « hebdo » répété) :

| Option | Mesure | Verdict |
|---|---|---|
| A. Décodage complet par le navigateur (`decodeAudioData`) | Tous les formats lus. 1 h : 12 à 21 s, **+2,2 à 3,4 Go** de mémoire (MP3 2,6 Go, M4A 3,4 Go, Ogg Opus 2,2 Go) | Écarté pour les longs fichiers : 3 h feraient tomber l'onglet. Gardé en repli pour les fichiers courts. |
| B. Lecture accélérée par un élément `<audio>`, son capté au passage | Demande d'ouvrir `media-src blob:`. Avec `ScriptProcessor`, sur 60 s : 55 s captées à ×3, 20,7 s à ×8, 10,2 s à ×16, **sans aucune erreur signalée**. L'essai avec `AudioWorklet` n'a pas abouti (bloqué, arrêté au bout de 15 min) : non mesuré | Écarté : dépend du temps réel de la machine, et perd du son en silence, contraire au principe de §15.18. |
| C. **WebCodecs + lecteurs de conteneur écrits dans Lowsper** | Prototype M4A, 1 h : **10,8 s, +90 Mo**, 3 600,0 s décodées, son exact | **Retenu** (validé par l'utilisateur). |
| C'. WebCodecs + bibliothèques de lecture (mp4box.js...) | Non mesuré | Écarté : dépendances à auditer et à embarquer, pour des formats dont la lecture tient en quelques centaines de lignes. |

Analogie : plutôt que de faire recopier tout un livre par le navigateur avant de le lire (A), ou
de l'écouter lu à toute vitesse en espérant ne rien manquer (B), Lowsper tourne les pages lui-même
et les fait lire une par une (C).

### 19.2 Ce qui a été construit

- `app/js/audiofile.js` : reconnaissance du format par le contenu (l'extension peut mentir) et
  lecteurs sans dépendance pour WAV (lu directement), MP3, AAC brut (ADTS), M4A/MP4, Ogg Opus et
  WebM Opus. Les trames sont confiées par petits lots au décodeur WebCodecs du navigateur ; la
  sortie est convertie en 16 kHz mono au fil de l'eau. Octets parasites en tête et fichiers coupés
  sont lus au mieux, jusqu'à l'endroit intact.
- **Repli** : les autres formats que le navigateur sait lire (FLAC, Vorbis, WMA selon le
  navigateur) passent par le décodage complet, limité à 25 Mo, avec un message clair au-delà.
- **Même chaîne que le direct** : découpage par la détection de parole Silero, file de
  transcription, moteurs, distinction des voix, glossaire, vocabulaires, corrections apprises.
  Différences assumées, et pourquoi :
  - la détection de parole n'a **pas de délai** : rien ne presse, donc aucun morceau n'est jugé
    au simple volume ;
  - **pas de voie rapide** (§15.12) : elle ne sert qu'à tenir le direct ;
  - **pas de rattrapage** de fin (§15.20), décision validée par l'utilisateur : sans délai de
    détection, rien ne peut échapper en route, et garder tout le son coûterait 115 Mo par heure ;
  - **renfort de moteurs** autorisé : aucune visio n'occupe le PC.
- **Mémoire bornée** : le décodage attend dès que 6 passages sont en file (contre-pression).
- **Politique de sécurité inchangée** : aucune requête, aucun `media-src`.
- **En-tête du transcript** : « Source : fichier », date d'enregistrement quand le fichier la
  contient (MP4, WebM), sinon « date du fichier » présentée comme telle (dernière modification,
  pas forcément le jour de l'enregistrement), durée, date d'import. Pas de « Vous » : dans un
  enregistrement, toutes les voix sont « de l'autre côté ». Le nom du transcript est daté du jour
  de l'enregistrement quand il est connu.
- **Interface** : bouton « Transcrire un fichier » et glisser-déposer n'importe où dans la page,
  sélection multiple traitée en file, barre d'avancement (part transcrite, temps restant estimé
  d'après le rythme observé), annulation propre (file vidée, rien de téléchargé).

### 19.3 Mesures du résultat

| Mesure | Résultat |
|---|---|
| Décodage de 3 h (fichier synthétique) | MP3 30 s, +50 Mo ; M4A 22 s, +18 Mo ; Ogg Opus 104 s, +1 Mo (mémoire des seuls processus du test) |
| Exactitude, 7 formats de 20 s | Durées à 0,06 s près ; enveloppe sonore identique au WAV de référence à 97,8 % ou plus |
| Délai propre aux codecs | MP3 50 ms, AAC 20 ms, Opus et WAV 0 : décalage des horodatages, négligeable à la seconde |
| Bout en bout (M4A, MP3, fichier invalide, annulation) | 14 vérifications sur 14, 2 min 28 s ; aucune requête réseau |

**Deux pièges de mesure, corrigés en route.**
1. Le premier test de 3 h annonçait +1 359 Mo pour l'Ogg. Cause : la mesure additionnait la
   mémoire de **tous** les Chromium de la machine, dont celle d'un autre test lancé en parallèle,
   avec Whisper chargé. Le même fichier, seul, restait sous 124 Mo, et trois fichiers de 3 h
   enchaînés dans la même page sous 145 Mo. La mesure ne compte plus que les processus du test.
2. La première comparaison d'enveloppes donnait 78 % pour le MP3 : c'était le délai d'amorçage du
   codec (50 ms), pas une perte. Le test cherche désormais le meilleur alignement et le mesure.

### 19.4 Limites connues

- Non mesuré : la transcription complète d'un fichier de plusieurs heures (seul le décodage l'a
  été) ; sa durée dépend du PC, comme en direct.
- Formats non pris en charge en flux : Vorbis, FLAC, ALAC, WebM à blocs groupés (« lacing »),
  entrées MP4 QuickTime anciennes (non vérifiées) : repli limité à 25 Mo.
- Firefox : la disponibilité de WebCodecs pour l'audio n'a pas été vérifiée ; Lowsper y reste
  en mode dégradé (§14).

## 20. Profils de sortie et notes Markdown (3.2.0)

Objectif : la note d'une réunion arrive directement au bon endroit (une base de notes de type
Obsidian), au bon format, avec des profils distincts pour séparer les contextes (personnel,
travail).

### 20.1 Choix validés avec l'utilisateur

| Question | Options | Choix et raison |
|---|---|---|
| Syntaxe du modèle de note | Variables seules ; variables et blocs conditionnels | **Variables seules** (`{{titre}}`...). Impossible à casser, facile à tester ; une variable inconnue reste visible telle quelle, et les paramètres la signalent. |
| Note déjà enregistrée, puis corrigée | Mise à jour automatique ; bouton « Enregistrer » | **Mise à jour automatique** : chaque correction sur l'écran de fin réécrit la note du dossier 1,5 s après la dernière modification. |
| Profils proposés d'office | Un profil « Par défaut » ; « Personnel » et « Travail » | **Un profil « Par défaut »**, qui garde le format classique de Lowsper dans les Téléchargements : rien ne change pour qui ne configure rien. |

### 20.2 L'accès au dossier : une contrainte du navigateur

L'écriture dans un dossier passe par l'API d'accès aux fichiers (déjà utilisée pour installer le
modèle, §13). Deux contraintes structurent la conception :
1. **L'accord du navigateur ne peut être demandé qu'après un clic.** La fin d'une réunion n'est pas
   un clic. Donc : si l'accord est déjà donné, la note est écrite ; sinon, elle part dans les
   Téléchargements et l'écran de fin propose « Enregistrer aussi dans le dossier » (un clic). Pour
   l'éviter, l'écran d'accueil signale avant la réunion qu'un accord est à donner, avec un bouton.
   Demander l'accord au clic sur « Démarrer » a été écarté : ce clic sert déjà au partage d'écran,
   que le navigateur exige immédiatement après (§7).
2. **L'accès à un dossier ne peut être gardé que par le navigateur** (IndexedDB), pas dans
   `app/reglages.txt`. Les profils eux-mêmes sont des réglages et survivent à un nettoyage du
   navigateur ; l'accès au dossier, non. Lowsper le détecte (« dossier oublié ») et propose de le
   désigner à nouveau ; la note va dans les Téléchargements en attendant, rien n'est perdu.

### 20.3 Format de la note

- **Profil « Par défaut »** : `toMarkdown()` a été découpé en morceaux (`parts()` : titre, en-tête,
  avertissement, corps) puis réassemblé. Sortie vérifiée **identique à l'octet près** avant et
  après, sur cinq transcripts de référence (réunion, fichier importé, pause, passage en échec,
  voix nommées et numérotées).
- **Nom de fichier** : variables, puis nettoyage pour Windows (caractères `< > : " / \ | ? *` et de
  contrôle, point ou espace final, noms réservés `CON`, `NUL`, `COM1`..., 120 caractères au plus).
  Un nom déjà pris reçoit « (2) », « (3) »... : aucune note n'est jamais écrasée ; les mises à jour
  réécrivent le même fichier.
- **Front matter YAML** : toutes les chaînes entre guillemets, avec échappements. Raison : en YAML,
  `no`, `yes`, `null`, un deux-points ou un dièse changent le sens d'une valeur nue. Vérifié en
  relisant la sortie avec PyYAML : les valeurs piégées restent du texte.
- **Liens `[[Nom]]`** : seulement pour les intervenants nommés à la main (« Intervenant 3 »
  n'est pas une personne) ; les caractères qui casseraient un lien (`[ ] | # ^`) sont retirés.
- **Date** : celle de l'enregistrement pour un fichier importé qui la contient (§19), sinon celle
  de la réunion.

### 20.4 Tests

| Test | Résultat |
|---|---|
| 7 tests unitaires (format classique identique, modèle, liens, noms de fichier, YAML, fichier importé, profils abîmés ou d'une autre version) | OK, dans deux fuseaux horaires |
| `tools/test/e2e-notes.mjs` (vraie page, faux dossier en mémoire, logique d'accès réelle) | 17/17, aucune requête réseau |

Le dossier est simulé en mémoire : un vrai accès à un dossier exige un clic humain dans la fenêtre
du système, que le navigateur de test ne peut pas produire. Le rangement des accès est
remplaçable pour cela ; tout le reste (accord demandé, oublié, accordé, écriture, mise à jour) est
le code réel. **Non vérifié** : le comportement exact d'Edge et de Chrome sur la durée de l'accord
d'une session à l'autre ; l'écran d'accueil s'adapte à ce que le navigateur répond.

## 21. Consignes pour l'IA éditables (3.3.0)

« Copier pour une IA » proposait une seule consigne figée (§10). Elle devient un choix :

- **Trois consignes fournies** : compte rendu de réunion (texte identique à l'ancienne consigne,
  sortie vérifiée par un test), synthèse d'appel, liste d'actions. Cette dernière demande d'écrire
  « non précisé » plutôt qu'un responsable ou une date absents du transcript : un petit défaut
  d'information vaut mieux qu'une invention.
- **Modifiables** (avec « Rétablir le texte d'origine ») et **consignes personnelles** à volonté.
  Stockées comme les autres réglages, donc copiées dans `app/reglages.txt`.
- **Variables** des modèles de note (`{{titre}}`, `{{date}}`...) ; `{{note}}` place la note dans
  la consigne, sinon elle est ajoutée à la fin. La note est insérée après le rendu des variables :
  un `{{...}}` présent dans un transcript n'est jamais réinterprété.
- **Rattachées aux profils** : chaque profil propose sa consigne, l'écran de fin permet d'en
  choisir une autre.

Lowsper n'envoie rien : la consigne et la note vont dans le presse-papiers ; les coller dans un
assistant en ligne est un choix de l'utilisateur, rappelé dans la FAQ.

## 22. Étude : un résumé 100 % local dans le navigateur ?

**Question.** Lowsper peut-il produire lui-même le compte rendu, sans que rien ne quitte le poste,
sur les postes visés (portables d'entreprise, souvent sans carte graphique dédiée, 8 à 32 Go de
mémoire), et sans affaiblir ses principes (§1 à §3) ? Étude seulement : rien n'est intégré.

### 22.1 Options examinées

| Option | Où est le modèle | Ce que dit la documentation (consultée le 2026-11-05) | Compatibilité avec Lowsper |
|---|---|---|---|
| **A. IA intégrée de Chrome** (Summarizer API, Prompt API, Gemini Nano) | Téléchargé et géré par le navigateur, pas par la page | Summarizer stable depuis Chrome 138, Prompt API stable depuis Chrome 148 ; français pris en charge. Exige **22 Go libres**, et **une carte graphique de plus de 4 Go** ou **16 Go de mémoire et 4 cœurs**. Désactivable par la stratégie d'entreprise `GenAILocalFoundationalModelSettings`. Taille de contexte non publiée (environ 6 000 à 9 000 jetons selon des sources non officielles) | Aucune connexion de la page, politique de sécurité inchangée. **Non vérifié** : fonctionnement depuis une page `file://`. Edge : préversion seulement (Canary, Dev) |
| **B. WebLLM** (MLC) | Téléchargé par la page | Exige WebGPU ; poids depuis Hugging Face mais bibliothèques WebAssembly depuis `raw.githubusercontent.com` ; mise en cache par Cache API, IndexedDB ou OPFS | **Écartée** : demande d'ouvrir la politique de sécurité à GitHub (§3), et repose sur des mécanismes que le mode `file://` restreint (§2). Non testée |
| **C. transformers.js + petit modèle ONNX** (moteur déjà utilisé par Lowsper) | Téléchargé une fois depuis Hugging Face, comme Whisper | Modèles multilingues sous licence Apache 2.0 disponibles (Qwen2.5 0,5 et 1,5 milliard de paramètres, 0,5 à 1,8 Go selon la précision) ; WebAssembly limité à 4 Go de mémoire | Compatible par construction ; **mesurée ci-dessous** |

Sources de l'option A : developer.chrome.com/docs/ai/summarizer-api, developer.chrome.com/docs/ai/prompt-api,
learn.microsoft.com/microsoft-edge/web-platform/prompt-api, learn.microsoft.com/deployedge/microsoft-edge-policies/genailocalfoundationalmodelsettings.
Option B : github.com/mlc-ai/web-llm. Option C : fiches des modèles sur huggingface.co, onnxruntime.ai/docs/tutorials/web/large-models.html.

### 22.2 Mesure de l'option C

Banc reproductible `tools/test/eval-summary.mjs` : Chromium, WebAssembly sur **un seul fil** comme
Lowsper (§2), consigne « Compte rendu de réunion », transcript parfait du corpus fictif « hebdo »
(2 min 40, 468 mots, 930 jetons, 8 répliques chiffrées et 4 actions). On vérifie 8 faits : 1 240
tickets, 87 % pour 95 % sur les P2, l'incident du certificat VPN, et les 4 actions (qui, quoi,
quand). Machine de développement lente (§0), sans carte graphique : WebGPU non mesurable.

| Modèle et précision | Chargement | Lecture du transcript | Génération | Mémoire de pointe | Faits retrouvés | Ce que contient le texte |
|---|---|---|---|---|---|---|
| Qwen2.5 0,5 milliard, 8 bits | 12 s | 46 s | 3,0 jetons/s | 4,1 Go | **0 / 8** | Boucle (« de la réunion de la réunion... ») |
| Qwen2.5 0,5 milliard, 4 bits | | | 0,78 jeton/s | 4,2 Go | | Échoue au contrôle (« L'Île-de-France est la capitale de la France ») |
| Qwen2.5 1,5 milliard, 8 bits | 67 s | 151 s | 1,08 jeton/s | 6,5 Go | **0 / 8** | Décrit le texte au lieu de le résumer (« le texte est écrit en français »), se répète |

Le banc lui-même a été contrôlé : à la question « Quelle est la capitale de la France ? », le
modèle 8 bits répond juste. **Contrôle de la précision** (hors navigateur, Node.js, même consigne) :

| Qwen2.5 0,5 milliard | Faits retrouvés | Défauts |
|---|---|---|
| 8 bits | 0 / 8 | boucle, comme dans le navigateur |
| **Pleine précision** (2 Go) | **3 / 8** | « 1200 tickets » au lieu de 1 240 ; échéance inventée (« jusqu'à décembre 2023 ») ; actions écrites comme déjà faites (« Thomas a finalisé la migration ») ; un lien faux entre deux faits (« Marc a envoyé le chiffrage avant le renfort du prestataire ») |

**Ce que cela dit.**
1. Sur le processeur, en WebAssembly, les modèles qui tiennent dans la mémoire permise sont soit
   **détruits par la quantification** (8 et 4 bits), soit **trop petits pour être fiables** (0,5
   milliard en pleine précision invente des chiffres et des dates). Le 1,5 milliard en pleine
   précision pèse 6,2 Go : au-delà des 4 Go de WebAssembly, impossible à faire tourner ainsi.
2. Le coût est hors de portée sur le processeur : rapporté à une réunion d'une heure (environ
   9 000 mots, soit environ 18 000 jetons au ratio mesuré de 2 jetons par mot), la seule lecture
   prendrait de l'ordre de 13 min (0,5 milliard) à 43 min (1,5 milliard) sur la machine de mesure.
   Extrapolation linéaire, **non mesurée** sur une heure ; le coût réel croît plus vite que
   linéairement avec la longueur.
3. Un compte rendu qui invente une date ou un chiffre est **pire que pas de compte rendu** : il
   serait relu avec la confiance qu'inspire un outil « qui a tout entendu ».

### 22.3 Recommandation

**Ne pas intégrer de résumé local pour l'instant.** La voie fiable reste « Copier pour une IA »
avec des consignes adaptées (§21), vers l'assistant que l'entreprise autorise : c'est à
l'utilisateur, ou à sa DSI, de décider où part le transcript.

**Piste à suivre : l'option A, en option expérimentale, seulement là où elle existe.** Elle est
la seule qui n'impose ni téléchargement à Lowsper, ni changement de la politique de sécurité, et
qui annonce le français. Mais elle exclut une partie des postes visés (matériel, disque), peut être
désactivée par la DSI, et deux points décisifs ne sont pas vérifiés. Prochaine étape proposée, à
valider avant tout développement : une **sonde** dans les paramètres, qui indique si l'IA intégrée
est disponible sur ce PC, depuis une page `file://`, sans rien télécharger ; puis, sur un PC où
elle l'est, une mesure de qualité avec le même banc et les mêmes 8 faits, transcript découpé en
morceaux pour tenir dans le contexte.

**Écartées** : WebLLM (politique de sécurité, `file://`) ; transformers.js sur le processeur
(qualité, mémoire, durée mesurées ci-dessus). **Non mesuré** : transformers.js sur WebGPU avec un
modèle de 1,5 à 4 milliards en 4 bits et activations 16 bits, faute de carte graphique ici ; à
mesurer sur un PC équipé avec le même banc, si l'option A échoue.

## 23. Sonde de l'IA intégrée du navigateur (3.4.0, expérimental)

**Contexte.** L'étude du §22 retient une seule piste pour un résumé local : l'IA intégrée de
Chrome et d'Edge (option A). Deux points décisifs n'étaient pas vérifiés : répond-elle à une page
ouverte en `file://`, et que vaut-elle en français sur un compte rendu ? Ils ne se tranchent que
sur un vrai PC équipé, pas sur la machine de développement. D'où une **sonde**, dans les
paramètres, que chacun peut lancer chez soi.

**Ce que fait la sonde.**
- **Vérifier ce PC** : appelle `Summarizer.availability()` et `LanguageModel.availability()` avec
  les options réellement visées (entrée et sortie en français, `expectedInputLanguages`,
  `outputLanguage`, `expectedInputs`/`expectedOutputs`). Rien n'est téléchargé : `availability()`
  ne fait que répondre `unavailable`, `downloadable`, `downloading` ou `available`. Délai de
  10 s, au-delà duquel l'état « pas de réponse » est affiché ; une valeur inconnue est montrée
  telle quelle.
- **Essayer sur une réunion fictive** : seulement si une interface est utilisable, après un clic.
  Si le navigateur doit d'abord télécharger son modèle, un avertissement le dit (téléchargement
  fait par le navigateur, au moins 22 Go d'espace libre selon la documentation de Chrome) et
  demande confirmation ; la progression est affichée. Le texte donné est le corpus fictif
  « hebdo », avec la même consigne et les mêmes 8 faits que le banc du §22 : les résultats sont
  directement comparables. Résumé (Summarizer) : type `key-points`, longueur `long`, Markdown.
  Prompt API : consigne « compte rendu » du banc.
- **Copier le rapport** : état de chaque interface, version du navigateur, protocole de la page,
  durées, faits retrouvés et texte produit. Rien d'autre : ni transcript réel, ni réglage.

**Arbitrages.**
- **Aucun vrai transcript dans la sonde.** Tant que la qualité n'est pas mesurée, brancher l'IA
  intégrée sur les réunions de l'utilisateur serait promettre ce que l'on ne sait pas tenir (§22.2,
  point 3). L'exemple fictif suffit à juger, et le rapport peut être partagé sans risque.
- **Aucun changement de la politique de sécurité.** La page ne fait aucune requête : le modèle
  est géré par le navigateur, hors de la page. Le test `tools/test/localai.mjs` vérifie qu'aucune
  requête ne part de la page pendant la sonde et l'essai.
- **Données de l'étude partagées.** L'exemple, la consigne et les faits sont définis une seule
  fois, dans `app/js/localai.js` ; le banc `tools/test/eval-summary.mjs` les y lit. Un test
  unitaire vérifie que l'exemple reste identique au corpus.
- **Rien n'est mémorisé.** La sonde n'ajoute aucun réglage : `app/reglages.txt` est inchangé.

**Mesuré ici** (Chromium 153 de Playwright, sans écran, sans carte graphique) :

| Page | Contexte sécurisé | `Summarizer` | `LanguageModel` | `LanguageDetector` |
|---|---|---|---|---|
| `file://` | oui | présent, `availability()` sans réponse en 15 s | idem | `downloadable` |
| `http://127.0.0.1` | oui | idem | idem | `downloadable` |

Ce que cela dit : une page `file://` est un contexte sécurisé, les interfaces de l'IA intégrée y
sont exposées et y répondent **comme sur un site local** (même résultat, `LanguageDetector`
répond). Le silence de `Summarizer` et `LanguageModel` vient donc de ce navigateur de test (pas
de modèle Gemini Nano disponible ici), pas de `file://`. **Non vérifié** : Chrome et Edge du
commerce sur un PC qui remplit les conditions matérielles ; c'est l'objet de la sonde.

**Limites.**
- Le premier `create()` exige un geste récent de l'utilisateur ; l'avertissement de
  téléchargement pourrait le consommer dans certains navigateurs. Non observé ; si cela arrive,
  le rapport montre l'erreur et un second clic suffit.
- La qualité dépend du modèle choisi par le navigateur, qui peut changer d'une version à l'autre :
  un rapport n'est valable que pour la version indiquée.
- Une DSI peut désactiver ces modèles par stratégie (`GenAILocalFoundationalModelSettings`, §22) ;
  la sonde affiche alors « indisponible ».

**Suite.** Selon les rapports obtenus sur de vrais PC : si les faits sont retrouvés sans
invention, proposer un « Résumé sur ce PC » à côté de « Copier pour une IA », toujours en option,
dans un lot à valider ; sinon, en rester à « Copier pour une IA » et le noter ici.

### 23.1 Premier rapport réel, et Brave (3.4.1)

**Rapport d'un PC fixe sous Windows**, page en `file://`, contexte sécurisé : identification
« Chrome/157 », `Summarizer` et `LanguageModel` répondent tous deux `unavailable`. Le navigateur
réel n'est pas certain : l'utilisateur se servait aussi de Brave, qui s'identifie exactement comme
Chrome. Un `unavailable` dans Brave ne dirait rien de Chrome. Le rapport indique donc désormais le
**navigateur détecté** (`navigator.brave` pour Brave, `navigator.userAgentData.brands` pour Edge,
Chrome et Opera). Ni le matériel ni la raison du refus ne sont connus : l'interface ne renvoie
pas de cause. À refaire dans Chrome ou Edge ; la page `chrome://on-device-internals`, que la
documentation de Chrome cite à propos du modèle, peut aider à comprendre le refus (non vérifié).

**Brave.** Il désactive par défaut l'écriture dans un dossier choisi (`showDirectoryPicker`),
d'après la documentation de Chrome et les tickets publics de Brave ; un réglage de `brave://flags` la rétablit
(nom exact non vérifié ici, d'où la consigne « cherchez « File System Access » »). Lowsper
reconnaissait seulement « ce navigateur ne permet pas », et conseillait Edge ou Chrome : juste
pour Firefox, inutilement radical pour Brave. Désormais `app/js/browser.js` reconnaît Brave et
Firefox et donne la marche à suivre, à l'installation comme au choix du dossier d'un profil (qui
affichait jusque-là l'erreur technique du navigateur). Brave n'est pas ajouté aux navigateurs
cibles : il n'est pas testé en CI.

## 24. Refonte, lot R1 : fondations visuelles (3.5.0)

**Contexte.** La refonte de l'interface (`docs/refonte.md`, plan dans `docs/lots.md`) commence par
ce que tous les écrans partagent : couleurs, thème et style des éléments communs. Les écrans
eux-mêmes seront revus lot par lot.

**Choix validés par le mainteneur, sur maquettes.**
- **Palette** : neutres légèrement teintés de vert, sans couleur vive. Une première version plus
  saturée a été jugée « trop pétante » et écartée.
- **Thème sombre** : gris très foncé teinté de vert sapin, pas du noir pur.
- **Thème** : celui du système par défaut, avec un bouton clair/sombre dans l'en-tête et un
  réglage « Affichage » (automatique, clair, sombre).

**Mise en œuvre.**
- **Jetons de couleur** :
  - sur `:root` pour le clair ;
  - deux blocs identiques pour le sombre : `@media (prefers-color-scheme: dark)` gardé par
    `:root:not([data-theme="light"])`, puis `:root[data-theme="dark"]`. Le choix explicite
    l'emporte ainsi dans les deux sens.
- **`app/js/theme.js`** :
  - chargé dans `<head>`, avant l'affichage, pour éviter un éclair de la mauvaise couleur ;
  - pose `data-theme` d'après `lowsper.opt.theme`. Revenir au thème du système remet le choix sur
    « automatique », pour que le système soit de nouveau suivi ;
  - le choix est copié dans `app/reglages.txt` comme les autres réglages, puis réappliqué si le
    navigateur l'avait perdu ;
  - la mini-fenêtre reçoit le même thème.
- **Style commun** :
  - police système : SF Pro sur Mac, Segoe UI Variable sous Windows. Aucune police n'est
    embarquée, et SF Pro ne peut pas l'être (licence) ;
  - texte de base en 16 px ;
  - boutons en pilule ;
  - champs sans bordure, sur fond teinté ;
  - cases à cocher dessinées en interrupteurs : même élément, même clavier, même lecteur
    d'écran ;
  - réglages en listes groupées : une carte par rubrique ;
  - logo vert sauge.
- **Aucun changement de comportement.** Les éléments et identifiants sont inchangés, et tous les
  tests de bout en bout passent sans modification.

**Contrastes mesurés** (rapport WCAG ; 4,5 minimum pour le texte courant) :

| Usage | Clair | Sombre |
|---|---|---|
| Texte secondaire sur fond | 5,59 (`#5a655f` sur `#f4f6f5`) | 8,11 (`#a5b1aa` sur `#121815`) |
| Texte secondaire sur carte | 6,07 | 7,40 |
| Lien sur carte | 6,56 (`#3a6651` sur blanc) | 8,77 (`#9cc7b1` sur `#1a211d`) |
| Texte blanc sur bouton principal | 6,09 (`#3f6b56`) | 6,09 |
| Texte blanc sur bouton rouge | 6,54 (`#b3261e`) | 6,54 |

**Limites.**
- Les textes restent en français jusqu'au lot R2.
- La structure des écrans ne change qu'à partir du lot R3.
- Le rendu n'a été vérifié que dans Chromium (Playwright), pas dans Edge ni Chrome du commerce.

## 25. Refonte, lot R2 : interface en français et en anglais

**Contexte.** L'interface s'ouvre dans la langue du navigateur, en français ou en anglais, et se
change dans les réglages (décision du mainteneur, `docs/refonte.md` §1). Jusqu'ici, tous les
textes étaient écrits en dur dans `Lowsper.html`, dans le JavaScript et même dans deux règles CSS
(`content:`).

**Options.**
- **Bibliothèque d'internationalisation** (i18next...) : écartée. Il faudrait l'embarquer
  (aucun CDN, contrainte n° 7), pour un besoin qui tient en une fonction.
- **Une page HTML par langue** : écartée. Deux pages à maintenir, et la langue ne pourrait pas
  changer sans recharger, donc pas après une réunion terminée.
- **Catalogue maison, un seul fichier** (retenu) : `app/js/i18n.js`, sans dépendance, chargé
  avant les autres scripts. Il est aussi lu par les tests sans navigateur.

**Mise en œuvre.**
- **`t(clé, variables, langue)`** : une entrée est une chaîne, où `{nom}` est remplacé, ou une
  fonction, pour les pluriels (« 2 passages », « 1 passage » ; en anglais, « 1 turn »).
  Seules les variables fournies sont remplacées : les variables de modèle `{{date}}` restent
  intactes. Une clé absente se replie sur le français, puis s'affiche telle quelle (erreur
  visible plutôt que texte vide).
- **Textes fixes de la page** : `data-i18n` (texte), `data-i18n-html` (texte avec `<strong>`,
  `<em>`, `<code>`) et `data-i18n-attr` (`placeholder`, `title`, `aria-label`). Le HTML garde le
  texte français : la page reste lisible sans script. `data-i18n-html` passe par `innerHTML`,
  mais uniquement avec des textes écrits dans le catalogue, jamais une saisie de l'utilisateur.
  Aucun élément concerné ne contient d'identifiant (les phrases qui en contenaient ont été
  découpées), pour que les références gardées par `app.js` restent valables.
- **Textes calculés** (`app.js`, `notes.js`, `browser.js`, `localai.js`, `installer.js`, et
  aussi `transcript.js`, `audiofile.js`, `engine.js`, `analyzer.js`, `vocabulary.js`, dont les
  messages arrivent à l'écran) : appels à `t()`. Les deux textes du CSS sont passés dans le
  JavaScript (`.auto-note`, `.suspects-label`).
- **Langue** : le choix mémorisé `lowsper.opt.lang`, sinon `navigator.language` (`fr`, `fr-FR`,
  `fr-CA`... donnent le français, tout le reste l'anglais). Le choix est copié dans
  `app/reglages.txt` comme les autres réglages ; `settings.js` réapplique la langue s'il la
  restaure.
- **Changement de langue sans rechargement** : `i18n.js` retraduit les textes fixes, puis `app.js`
  réécrit ses textes calculés (`relabel()`). Il est bloqué pendant une réunion, une finalisation
  ou un import : les états en cours (minuteur, avis, file d'attente) n'ont pas à être retraduits
  en vol, et recharger la page perdrait la réunion. Les messages passagers (bulles de 3 à 12 s)
  restent dans la langue où ils ont été affichés.
- **Statuts de l'import** : ils servaient à la fois d'état et de libellé (`'échec'`, `'en
  cours'`...). Ce sont désormais des identifiants (`failed`, `running`...), traduits à
  l'affichage.

**Note produite.**
- **Sa langue est celle de l'interface au début de la réunion** (`meta.noteLang`), puis ne bouge
  plus : changer la langue après la réunion ne réécrit pas, dans l'autre langue, la note déjà
  enregistrée dans le dossier d'un profil. Une session interrompue sauvegardée par une version
  précédente (sans `noteLang`) est restaurée en français.
- **En français, identique au caractère près.** Mesure : l'ancien code (3.5.0, `git show`) et le
  nouveau ont produit 33 sorties sur 5 réunions fictives (direct avec voix nommées, pause, passage
  non transcrit, rattrapage, glossaire, vocabulaires ; réunion vide ; participants sans voix ;
  deux fichiers importés) : notes classiques, noms de fichier, notes à modèle avec toutes les
  variables et le front matter, les trois consignes, nom du profil par défaut. **0 différence.**
  Les tests unitaires existants sur la note n'ont pas été modifiés et passent.
- **En anglais** : en-tête, avertissement, libellés (« You », « Speaker 1 », « Participant »),
  pauses et passages non transcrits traduits ; fichier `meeting_...md` au lieu de `reunion_...md`
  (choix du mainteneur). Dates et heures : celles du navigateur s'il est en anglais (`en-US`,
  `en-GB`...), sinon `en-GB`.
- **Variables et front matter** : les noms (`{{titre}}`, `{{duree}}`...) et les clés (`duree:`,
  `intervenants:`, `modele:`) ne changent pas avec la langue (choix du mainteneur). Un modèle de
  note ou une recherche dans une base de notes reste valable si l'on change de langue ; seules
  les explications des variables sont traduites.
- **Consignes pour l'IA** : les trois consignes fournies existent dans les deux langues. Un texte
  enregistré identique à l'original, dans l'une ou l'autre langue, est considéré comme non
  modifié et suit la langue de l'interface ; un texte modifié par l'utilisateur ne change jamais.
  La traduction anglaise reprend les consignes actuelles ; leur réécriture en prompt système est
  le lot R6.
- **Profil « Par défaut »** : tant que l'utilisateur ne l'a pas renommé, il s'appelle « Default »
  en anglais. Les noms donnés par l'utilisateur ne sont jamais traduits.

**Ce qui reste en français, volontairement.**
- Les termes des vocabulaires métier (contenu, pas interface) : les listes par langue sont le
  lot R8. Seuls leurs noms sont traduits.
- L'essai de l'IA intégrée (§23) : réunion fictive, consigne et faits mesurés sont ceux du corpus
  français, pour rester comparables au banc de §22. L'interface de la sonde et son rapport sont
  traduits.
- Le journal technique (clés internes, sans texte de réunion), sauf sa ligne d'en-tête.
- Les filtres d'hallucinations et de mots courants de `transcript.js` : ils portent sur ce que
  Whisper produit, pas sur l'interface.

**Mesures.**
- **Catalogues** : 477 clés par langue, dont 13 pluriels en fonction. Un test unitaire relève
  chaque clé utilisée dans le code et la page (plus de 400) et vérifie qu'elle existe dans les
  deux catalogues.
- **Page** : 155 attributs `data-i18n*`. Un test (`npm run test:i18n`, Chromium) vérifie que le
  texte français écrit dans `Lowsper.html` est exactement celui du catalogue, qu'en anglais aucun
  texte ni attribut ne garde de français, que le changement de langue est immédiat et gardé
  après rechargement, et que la page ne fait aucune requête réseau.
- **Charge du moteur** (`npm run bench`, 4 cœurs, Whisper small, même machine) : voir le tableau
  ci-dessous. Le chemin du direct n'est touché que par la mise en forme des textes d'état.

| Passage | Avant (3.5.0) | Après (deux mesures) |
|---|---|---|
| 6,2 s de parole | 14 206 ms | 13 971 ms |
| 25 s de parole, français | 14 456 ms (RTF 0,578) | 14 172 ms (RTF 0,567) ; 14 339 ms (RTF 0,574) |
| 25 s, détection automatique de la langue | 15 889 ms | 14 782 ms |

  Aucune régression : les écarts (moins de 2 % sur le passage de référence) sont de l'ordre du
  bruit d'une machine partagée.

**Limites.**
- **Non vérifié** : un bref affichage du français avant la traduction, au chargement d'une page en
  anglais. Les scripts sont en fin de page, juste avant le premier affichage habituel ; aucun
  éclair n'a été vu dans les tests, mais il n'a pas été mesuré.
- Rendu vérifié dans Chromium (Playwright) seulement, pas dans Edge ni Chrome du commerce.
- Les textes du navigateur lui-même (fenêtres d'autorisation, sélecteur de dossier, erreurs
  techniques remontées telles quelles) suivent la langue du navigateur, pas celle de Lowsper.
- La qualité de la traduction anglaise n'a pas été relue par un anglophone natif.
