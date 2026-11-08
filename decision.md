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

Remplacé pour la reconnaissance et la conservation par le §37 (4.2.0) : plusieurs empreintes par
personne, seuil 0,825 et marge, effacement par empreinte.

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

## 26. Refonte, lot R3 : premier lancement guidé

**Contexte.** Au premier lancement, l'utilisateur devait choisir lui-même un ou plusieurs modèles
dans une liste. La refonte (`docs/refonte.md` §2, maquette validée) demande qu'il n'ait qu'à
valider : Lowsper lit le PC, recommande un modèle (« Best for this PC »), grise ceux qui ne
peuvent pas tourner avec leur raison, montre le dossier, et n'offre qu'un bouton.

**Mesures avant de coder.** Nouveau banc `npm run bench -- --cores` (après
`node build.mjs --embed whisper-small whisper-base`) : pour chaque modèle, de 1 à N moteurs au
travail en même temps (un moteur occupe un cœur), coût d'un bloc de 18 s, puis charge d'une
réunion où l'on parle sans arrêt, calculée comme le test de vitesse des paramètres
(`Lowsper.estimateLoad`). Charge sous 1 : le direct suit. Moyenne de 2 mesures par moteur, après
une mesure de chauffe.

Machine : le conteneur de développement, Chromium de Playwright sans écran, 4 fils (Intel Xeon
2,1 GHz), sans carte graphique ; le navigateur y annonce 16 Go de mémoire.

| Moteurs en même temps | Whisper small : encodeur, par jeton, charge | Whisper base : encodeur, par jeton, charge |
|---|---|---|
| 1 | 10 416 ms, 144 ms, **1,44** | 3 114 ms, 57 ms, **0,51** |
| 2 | 10 398 ms, 144 ms, **0,72** | 3 131 ms, 60 ms, **0,27** |
| 3 | 10 320 ms, 140 ms, **0,47** | 3 226 ms, 60 ms, **0,18** |
| 4 | 10 896 ms, 157 ms, **0,39** | 3 343 ms, 63 ms, **0,14** |

Lecture : chaque moteur garde sa vitesse jusqu'à 3 en parallèle ; à 4 (tous les fils), il ralentit
d'environ 5 à 10 %. La charge baisse donc presque en proportion du nombre de moteurs. Whisper base
suit le direct dès un seul moteur ; Whisper small en demande au moins deux sur ce processeur.

**Règle de recommandation** (`app/js/recommend.js`, testée sans navigateur).
- **Nombre de moteurs** : celui de la puissance « équilibrée », par défaut (§15.12) : un quart des
  fils, plafonné par la mémoire. La formule est désormais dans `recommend.js` et utilisée aussi
  pendant les réunions ; un test vérifie qu'elle donne exactement les mêmes résultats que l'ancien
  code de `app.js`, sur toutes les combinaisons courantes.
- **Whisper small** si sa charge mesurée avec ce nombre de moteurs est d'au plus 1, sinon
  **Whisper base**. Avec les mesures ci-dessus : small à partir de 5 fils (2 moteurs, charge
  0,72) et 4 Go de mémoire ; base à 4 fils ou moins, ou sous 4 Go. Au-delà de 4 moteurs, la
  charge par moteur est supposée rester celle du 4e.
- **Modèles « carte graphique »** : utilisables seulement si WebGPU trouve une carte, et **jamais
  recommandés d'office** : leur vitesse n'a jamais pu être mesurée ici (§15.7). Ils restent au
  choix.
- **Navigateur muet** (Firefox ne donne pas la mémoire) : mêmes valeurs par défaut que pendant les
  réunions (4 fils, 8 Go), donc une recommandation prudente.
- **Provisoire.** La règle repose sur un seul processeur, lent et sans turbo : un portable récent
  a probablement des cœurs plus rapides, ce qui rendrait la règle trop prudente, mais ce n'est pas
  mesuré. Le mainteneur lancera `npm run bench -- --cores` sur un ou deux vrais PC ; les seuils
  seront ajustés avec ces chiffres (tableau `MEASURED` de `recommend.js`).

**Écran de bienvenue.**
- **Détection** : processeurs logiques (`navigator.hardwareConcurrency`, des fils et non des
  cœurs physiques, d'où ce mot), mémoire (`navigator.deviceMemory`, arrondie vers le bas par le
  navigateur, d'où « ou plus »), carte graphique (adaptateur WebGPU).
- **Un seul modèle** (choix du mainteneur, comme la maquette) : boutons ronds, le recommandé coché.
  Whisper base reste ajouté d'office avec un modèle processeur (voie rapide de secours, §15.12) :
  la ligne le dit et sa taille l'inclut. Ajouter un autre modèle plus tard se fait depuis les
  paramètres, un à la fois, sur le même écran (titre « Ajouter un modèle »). *Remplace la
  sélection multiple de §15.13.*
- **Modèles grisés** : sans carte graphique compatible, les modèles « carte graphique » ne sont
  plus installables (ils l'étaient, pour préparer un dossier à copier vers un PC équipé, §15.13).
  Pour ce cas rare, il suffit d'installer le modèle depuis le PC équipé, puis de copier le
  dossier Lowsper vers les autres.
- **Dossier** : celui de la page, affiché avant le clic. La consigne dit d'y choisir « ce dossier,
  puis valider », sans citer le libellé du bouton du navigateur (il dépend du navigateur et de sa
  langue, non vérifié).
- **Langue** : menu dessiné par Lowsper dans l'en-tête, sur cet écran seulement (maquette,
  `refonte.md` §1) ; au clavier : flèches, Entrée, Échap.
- **Un seul accord** : le dossier choisi sert à installer le modèle et à la copie automatique des
  réglages (`app/reglages.txt`), comme avant ; il est gardé (IndexedDB) pour le dossier de notes
  par défaut du lot R7. Le test `npm run test:welcome` vérifie qu'une seule fenêtre de choix est
  ouverte et que le même dossier sert aux deux.

**À vérifier : `startIn`.** La spécification de `showDirectoryPicker` n'accepte comme point de
départ qu'un dossier connu (« documents », « downloads »...) ou un dossier déjà autorisé, pas un
chemin libre : la fenêtre ne peut donc pas s'ouvrir d'elle-même sur le dossier Lowsper au premier
lancement. **Non vérifié dans Chrome ni Edge** : le Chromium sans écran de l'environnement de
développement n'affiche pas cette fenêtre. Page d'essai pour le mainteneur :
`tools/test/startin.html` (six cas, journal à copier). Lowsper garde pour l'instant l'option `id`
(le navigateur rouvre le dernier dossier choisi), sans `startIn`.

**Tests.**
- `npm run test:welcome` (Chromium, aussi en CI, sur une copie du dossier sans modèle) : matériel
  simulé (4 fils : base ; 8 fils : small ; carte graphique : modèles utilisables, non
  recommandés), détection affichée, un seul choix coché, raisons des modèles grisés, un seul
  bouton, menu de langue au clavier, ajout d'un modèle depuis les paramètres, et liste exacte des
  modèles téléchargés (small entraîne base ; base seul) avec un seul choix de dossier.
- Tests unitaires : règle de recommandation, formule des moteurs identique à l'ancienne.
- `npm run test:e2e` : choisit Whisper small explicitement (ses vérifications de qualité portent
  sur small), et vérifie que le recommandé est le seul coché.

**Charge du moteur en direct** (`npm run bench`, Whisper small, même machine) : le nombre de
moteurs est maintenant calculé par `recommend.js`, avec la même formule. Passage de 25 s :
14 172 ms et 14 339 ms avant (lot R2), **14 274 ms (RTF 0,571)** après. Aucune régression.

**Limites.**
- Mesures sur une seule machine, lente : règle provisoire (voir plus haut).
- Vitesse sur carte graphique toujours non mesurée.
- `startIn` non vérifié dans les navigateurs.
- Le nombre de fils n'est pas la vitesse : deux PC à 8 fils peuvent différer du simple au double.
  Le test de vitesse des paramètres, fait automatiquement au premier démarrage du modèle, reste la
  mesure de référence sur le poste.

## 27. Refonte, lot R4 : accueil

**Contexte.** L'accueil empilait un bandeau jaune permanent, un formulaire (nom, nombre de
personnes, profil), un gros bouton, une zone d'import, un lien vers les paramètres et un mode
d'emploi déplié. La refonte (`docs/refonte.md` §3, maquette validée) le réduit à un titre, deux
lignes (« Nom », « Enregistrer la note dans »), un bouton « Démarrer » et le lien « Transcrire un
fichier audio ». Les explications arrivent au moment où elles servent : dans la fenêtre « Avant de
commencer ».

**Menu dessiné par Lowsper, composant commun** (`app/js/menu.js`).
- Remplace la liste déroulante native du profil, et le menu de langue de l'écran de bienvenue
  (lot R3) l'utilise désormais aussi. Il servira aux lots suivants (réglages en sous-écrans, R7).
- Motif « menu button » de WAI-ARIA : bouton `aria-haspopup="menu"` et `aria-expanded`, entrées
  `menuitemradio` cochées, entrées d'action après un séparateur (« Nouvel emplacement… ») ;
  flèches, Début, Fin, Entrée, Échap (le focus revient au bouton), Tab ferme ; clic ailleurs
  ferme.
- « Enregistrer la note dans » : chaque profil, avec en sous-titre son dossier ou « Vos
  Téléchargements ». « Nouvel emplacement… » crée un profil dans les paramètres. Le mot
  « emplacement » annonce le lot R7, où « Profil » devient « Emplacement » partout ; d'ici là, les
  paramètres disent encore « profil ».

**Fenêtre « Avant de commencer ».**
- `<dialog>` modal du navigateur : focus enfermé, Échap pour fermer, sans code de plus.
- Trois étapes (prévenir les participants, choisir l'écran et cocher « Partager l'audio »,
  autoriser le micro), « Continuer », « Annuler », « Ne plus afficher ».
- Le clic sur « Continuer » sert de geste de l'utilisateur au partage d'écran, que le navigateur
  exige ; le parcours de capture lui-même ne change pas. « Démarrer la réunion suivante » (écran
  de fin) et Entrée dans le nom suivent le même chemin.
- **Défaut trouvé par le test et corrigé** : Entrée dans le nom ouvrait la fenêtre et donnait le
  focus à « Continuer », que le même appui activait aussitôt. La réunion démarrait donc sans
  laisser lire les étapes. La touche est désormais consommée.
- « Ne plus afficher » se défait dans les paramètres (« Afficher « Avant de commencer » avant
  chaque réunion ») : effacer les données du navigateur ne suffirait pas, le choix étant restauré
  depuis `app/reglages.txt`.

**Ce qui disparaît de l'accueil.**
- **Bandeau jaune permanent** : son rappel (prévenir les participants, rien ne quitte le poste)
  passe dans la fenêtre « Avant de commencer » et dans la pastille « Reste sur ce PC » de
  l'en-tête, comme sur la maquette. Avec « Ne plus afficher », plus aucun rappel de prévenir les
  participants ne s'affiche : c'est voulu par la spécification, pour les habitués.
- **« Comment ça marche ? »** et le lien vers les paramètres : la fenêtre « Avant de commencer »
  et la roue crantée les remplacent.
- **Texte de la zone d'import** : le lien seul reste ; glisser un fichier n'importe où dans la
  page fonctionne toujours.
- **Champ « Personnes »** : il passe dans les paramètres (« Nombre de personnes dans vos réunions,
  vous compris »), **gardé d'une réunion à l'autre** (choix du mainteneur), vide par défaut
  (automatique). Vérifié dans `speakers.js` : ce nombre est un plafond strict pour la distinction
  des voix. Une phrase sous le champ le dit, et une question de la FAQ aussi : trop bas, des voix
  différentes sont regroupées. Clé `lowsper.opt.people`, copiée dans `app/reglages.txt`.

**Tests.**
- `npm run test:home` (Chromium, aussi en CI, sur une copie du dossier, moteur absent) : écran,
  disparition du bandeau et du mode d'emploi, menu au clavier, choix gardé après rechargement,
  « Nouvel emplacement… », fenêtre (Annuler, Échap, Entrée dans le nom, Continuer qui demande bien
  le partage d'écran), « Ne plus afficher » puis l'interrupteur des paramètres, nombre de
  personnes gardé, aucune requête réseau.
- `npm run test:e2e` passe par la fenêtre ; `test:e2e-notes` choisit le profil dans le nouveau
  menu ; `test:welcome` lit le menu de langue du composant commun.
- **Charge du moteur** : non mesurée de nouveau. Le chemin du direct (capture, découpage, moteurs)
  ne change pas ; seul le geste qui le lance passe par la fenêtre.

**Limites.**
- Rendu vérifié dans Chromium seulement, pas dans Edge ni Chrome du commerce.
- Vocabulaire « profil » et « emplacement » mélangé jusqu'au lot R7.

## 28. Refonte, lot R5 : réunion, mini-fenêtre et fenêtre agrandie

**Contexte.** Pendant la réunion, Lowsper montrait des barres de niveau, un texte d'état technique
(« 3 passages en attente de transcription. Charge du moteur : 87 % ») et cinq boutons. La mini-
fenêtre reprenait le même bloc en plus petit. La refonte (`docs/refonte.md` §4 et §5, maquettes
validées) sépare les deux usages : une mini-fenêtre minuscule pour travailler à côté, et une
fenêtre agrandie qui dit en langage simple si tout va bien.

**Mesure avant de coder : tailles acceptées par la mini-fenêtre.** Page d'essai
`tools/test/pip-sizes.html` (un clic par taille demandée, car chaque ouverture exige un geste de
l'utilisateur). Chromium 153 sous Linux, dans un écran virtuel Xvfb de 1920 × 1080, sans
gestionnaire de fenêtres, sans l'émulation de taille de Playwright :

| Demandé | Obtenu (intérieur) | Extérieur |
|---|---|---|
| 1 × 1, 100 × 30, 180 × 40 | 240 × 52 | 248 × 90 |
| **248 × 52** (maquette) | **248 × 52** | 256 × 90 |
| 300 × 48 (avant ce lot) | 300 × 52 | 308 × 90 |
| 400 × 120 | 400 × 120 | 408 × 158 |
| 1000 × 800 | 804 × 643 | 812 × 681 |
| 4000 × 3000 | 831 × 623 | 839 × 661 |

- Minimum : 240 × 52 ; la taille de la maquette est donc respectée telle quelle. La mini-fenêtre
  est désormais demandée en 248 × 52.
- Maximum : environ 830 × 640 sur cet écran, plafond imposé par le navigateur.
- La barre de titre dessinée par le navigateur ajoute 38 px de haut.
- Sans écran virtuel (Chromium sans écran), la taille demandée est ignorée : mesure inutilisable,
  écartée.
- **Non vérifié** : Chrome et Edge sous Windows et macOS. Le mainteneur ouvrira la page d'essai ;
  le tableau sera complété.

**Mini-fenêtre.**
- Un élément à part, `#mini`, déplacé dans la fenêtre Document Picture-in-Picture : temps
  (minutes:secondes), niveau du micro, niveau du son de la réunion, Pause, Terminer. Le reste de
  l'écran de réunion reste dans la page : il n'est plus déplacé, et l'ancien texte « piloté depuis
  la mini-fenêtre » disparaît.
- Son de la réunion absent ou silencieux trop longtemps : icône et barre orange, explication au
  survol.
- Même barre quand la fenêtre de Lowsper est très basse (moins de 240 px de haut), comme avant.
- Retirés : la flèche qui dépliait la dernière phrase et les avis dans la mini-fenêtre (absents de
  la maquette).

**Fenêtre agrandie.**
- État (« Enregistrement » ou « En pause »), grand chronomètre, nom de la réunion modifiable. Le
  nom modifié sert à la note et au contexte donné à Whisper pour les passages suivants.
- **Contrôle d'état** : trois lignes, chacune avec une coche verte, un point d'exclamation orange
  ou un tiret gris :
  - micro : « Je vous entends » (ou « Non capté ») ;
  - son de la réunion : « Le son arrive », « Rien ne passe » (source perdue), « Rien ne passe
    depuis 1 min » (silence), ou « Non capté (option désactivée) » ;
  - texte écrit : « À jour », « N s de retard », ou « Le moteur se prépare ».
  Le détail technique (passages en attente, charge du moteur) reste en infobulle de la dernière
  ligne.
- « Comment corriger » : l'explication, avec le bouton existant pour partager de nouveau le son.
  Vérifié dans `capture.js` : un nouveau partage remplace l'ancien proprement.
- Trois gros boutons ronds légendés (Pause, Réduire, Terminer), « Commencer une nouvelle réunion
  sans arrêter », et le texte en direct derrière un interrupteur, masqué par défaut (choix gardé,
  `lowsper.opt.showLive`).
- La logique des états est une fonction pure, `app/js/meeting.js`, couverte par un test unitaire
  qui relit les corpus pour vérifier les seuils.

**Seuils d'alerte, réglés sur les corpus de test.**
- **Silence du son de la réunion** : plus long silence naturel des participants mesuré dans les
  corpus, 8,3 s (« hebdo ») et 7,1 s (« entretien »). Seuil retenu : **60 s** sans aucune parole
  détectée. La marge couvre les longs moments où vous parlez seul, que ces corpus de 3 minutes ne
  contiennent pas. Le test unitaire exige au moins cinq fois le plus long silence mesuré.
- **Silence du micro** : **jamais d'alerte**. Jusqu'à 80 s de silence au micro dans « hebdo », en
  réunion normale : vous écoutez.
- **Retard du texte** : âge du plus ancien passage de la réunion encore à transcrire. Mesuré
  toutes les 2 s pendant le test de bout en bout (corpus « hebdo », machine de développement lente,
  un seul moteur, panne de moteur simulée) : médiane 0 s, 90 % des relevés sous 8,9 s, maximum
  12,9 s. Seuil retenu : **30 s**, plus du double du pire cas normal. Au-delà de 15 s, la voie
  rapide de secours prend déjà le relais (§15.12).

**Tests.**
- Unitaires : contrôle d'état et seuils.
- `npm run test:e2e` : mini-fenêtre ouverte en 248 × 52 si le navigateur le permet, avec ses
  boutons Pause et Terminer, clics réels ; barre en fenêtre très basse ; retard du texte relevé et
  contrôle d'état affiché.
- Charge du moteur (`npm run bench`) : voir le tableau ci-dessous.

| Passage de 25 s, Whisper small | Avant | Après (deux mesures) |
|---|---|---|
| Durée (RTF) | 13 883 ms (0,555) | 14 332 ms (0,573) ; 14 354 ms (0,574) |

  Écart de 3 %, attribué au bruit de la machine : le banc ne charge que `engine.js`, que ce lot ne
  modifie pas, et ce même moteur a déjà donné de 14 172 à 14 456 ms aux lots R2 et R3. Le travail
  ajouté au direct est l'affichage (contrôle d'état), hors du moteur.
- **Capture `enregistrement.png`** : elle montre « 36 s de retard », mesuré au moment de la
  capture sur cette machine lente (un seul moteur, charge au-dessus de 100 %). C'est le
  comportement voulu : le retard réel est affiché.

**Limites.**
- Tailles de la mini-fenêtre non mesurées dans Chrome et Edge sous Windows et macOS.
- Corpus courts (3 minutes) : le seuil de silence de 60 s n'est pas mesuré sur de vraies réunions
  longues ; il est choisi avec une large marge.
- Le contrôle d'état se met à jour dix fois par seconde, comme les barres de niveau avant lui ; il
  n'écrit dans la page que ce qui change.

## 29. Refonte, lot R6 : fin de réunion et consignes réécrites

**Contexte.** L'écran de fin empilait un résumé, quatre boutons (télécharger, copier, une liste
déroulante de consignes, « Copier pour une IA »), un panneau « Intervenants détectés », la
correction de mots dépliable, deux boutons de sortie et l'aperçu du Markdown brut. La refonte
(`docs/refonte.md` §6, maquette validée « Fin de réunion ») le met en deux colonnes. Les consignes
fournies, trois phrases chacune, deviennent un prompt système structuré (§7).

**Écran de fin.**
- **À gauche, le texte lisible** : titre, « Aujourd'hui, 10:02 · 12 minutes · 5 personnes », puis
  les répliques (étiquette, heure, texte). Plus de Markdown brut. Le nombre de personnes n'est
  affiché que si les voix ont été distinguées ; sinon il est inconnu, et il est omis.
- **Renommage sur les répliques** : un clic sur « Intervenant 2 » le remplace par un champ ; la
  saisie change le nom sur toutes ses répliques et réécrit la note du dossier (même délai de
  1,5 s qu'avant). Entrée ou un clic ailleurs valide, Échap annule. La mémoire des voix apprend le
  nom à la validation, comme le faisait le panneau. « Vous » et « Participant » ne sont pas des
  boutons : ce ne sont pas des voix distinguées. Pendant une saisie, le texte n'est jamais
  redessiné (le champ serait perdu) ; il l'est à la fin si une version précise d'un passage est
  arrivée entre-temps. À la fin d'une saisie, l'étiquette revient à sa place sans redessiner le
  texte, sinon un clic sur une autre étiquette, qui a provoqué la fin de la saisie, serait perdu.
- **Défaut trouvé en relecture et corrigé** : chaque frappe du nom marquait le texte « à
  redessiner », qui l'était donc juste après la saisie, entre l'appui et le relâchement du clic
  sur l'étiquette suivante : ce clic était perdu. La saisie d'un nom ne demande plus de rendu
  complet (seules les étiquettes changent). Le test de bout en bout ne reproduisait pas le défaut
  avec un clic instantané ; avec un clic de 120 ms entre appui et relâchement, comme un clic
  humain, il échoue sur l'ancien code et passe sur le nouveau (vérifié dans les deux sens).
- **Panneau « Intervenants détectés » retiré** (choix du mainteneur). Il disait aussi le temps de
  parole et un extrait de chaque voix ; ce n'est plus affiché. Le badge « reconnu » devient
  l'infobulle de l'étiquette.
- **À droite** : la carte « Note enregistrée » (où, et « Vos modifications y sont ajoutées »), qui
  dit « Enregistrement de la note… » tant que l'écriture n'est pas finie et garde le bouton
  « Enregistrer aussi dans le dossier » quand l'accord du navigateur manque. Puis « Et
  maintenant ? » : « Obtenir un résumé », la consigne choisie et « Voir ce qui est copié »,
  « Copier le texte », « Enregistrer une copie ». Puis « Corriger un mot mal reconnu », qui ouvre
  la correction existante dans une fenêtre, et « Nouvelle réunion ».
- **« Nouvelle réunion » ramène à l'accueil** (choix du mainteneur, comme la maquette).
  « Démarrer la réunion suivante » disparaît ; enchaîner sans arrêter reste possible pendant la
  réunion (« Commencer une nouvelle réunion sans arrêter », §28).
- **Choix de la consigne** : le menu commun (`menu.js`, §27) remplace la liste déroulante native.
  Par défaut, la consigne du profil ; un autre choix ne vaut que pour cet écran.
- **« Voir ce qui est copié »** montre le texte produit par la même fonction que la copie : ce qui
  est affiché est exactement ce qui part dans le presse-papiers (vérifié par le test de bout en
  bout).
- Restent, à leur place dans la nouvelle disposition : avis des passages rapides et des passages
  non transcrits (en tête du texte), réunions précédentes de la session, journal technique.

**Consignes réécrites comme un prompt système.**
- **Compte rendu de réunion** : le texte anglais est celui de `docs/refonte.md` §7, au caractère
  près. Un test unitaire relit le document et compare. Le français en est la traduction, avec les
  libellés de la note française (« Vous », « Intervenant 1 »).
- **Synthèse d'appel et liste d'actions** : même structure, même contexte et mêmes règles ; le rôle
  et les sections changent (objet de l'appel, points clés, engagements, prochaines étapes ;
  tableau action, responsable, échéance, source avec l'heure). Pour la liste d'actions, « Utilise
  des listes à puces » est retiré des règles, puisqu'on demande un tableau. Le contexte de la
  synthèse d'appel dit « un appel » au lieu d'« une réunion ». Un test vérifie que contexte et
  règles sont identiques d'une consigne à l'autre.
- **Langue** : chaque consigne demande la langue principale du transcript (l'ancienne demandait
  « en français » ou « in English »). Les consignes restent proposées dans la langue de
  l'interface.
- **Place de la note** : le texte se termine par `# Transcript` puis `{{note}}`. La note, elle, ne
  change pas.

**Rétrocompatibilité des consignes (règle de §25 prolongée).**
- Un texte enregistré est « non modifié » s'il est identique à un texte fourni actuel, dans l'une
  ou l'autre langue, **ou à un texte fourni d'une version précédente**. Les anciens textes (3.3.0
  à 3.5.0 en français, lot R2 en anglais) sont gardés dans `notes.js` (`LEGACY_PROMPTS`), jamais
  affichés. Mesure : comparés par programme au code de la 3.3.0 (`git show 5a5d736`) et à celui
  d'avant ce lot, les six textes sont identiques au caractère près.
- Un texte non modifié passe donc au prompt système ; un texte modifié, même d'un caractère, est
  gardé tel quel (test unitaire). Le format de `app/reglages.txt` ne change pas : aucune migration.
- Les consignes personnelles ne sont jamais touchées.

**La note en français ne change pas.** `transcript.js` n'est pas modifié, et `notes.js` ne l'est
que dans la partie des consignes. Mesure : les tests unitaires d'avant ce lot, lancés sur le
nouveau code, passent tous (59) sauf les trois qui vérifiaient l'ancien texte des consignes.

**Libellé.** « Copier pour une IA » devient « Obtenir un résumé » partout : paramètres (« Consigne
proposée par « Obtenir un résumé » »), sonde de l'IA intégrée, README, `SECURITY.md`.

**Tests.**
- Unitaires : structure des six consignes (titres dans l'ordre, transcript à la fin), égalité avec
  le texte de la spécification, anciens textes reconnus, texte modifié gardé.
- `npm run test:e2e-notes` : deux colonnes, texte sans Markdown brut, « Note enregistrée » avec
  l'emplacement, consigne du profil proposée, copie (prompt système de synthèse d'appel puis la
  note), « Copié », « Voir ce qui est copié » identique au presse-papiers, Échap, autre consigne
  par le menu au clavier, renommage annulé par Échap puis validé par Entrée sur toutes les
  répliques, note réécrite avec le lien `[[Claire]]`, « Nouvelle réunion » vers l'accueil.
- `npm run test:e2e` : correction d'un mot dans la nouvelle fenêtre, texte de l'écran mis à jour ;
  nom saisi puis clic direct sur une autre voix (défaut ci-dessus).
- `npm run test:i18n` : textes de la page identiques au catalogue, aucun français en anglais.
- Captures `fin.png`, `fin-sombre.png` et `profils.png` régénérées.

**Charge du moteur** (`npm run bench`, 4 cœurs, Whisper small, même machine). Le chemin du direct
n'est pas modifié ; mesure faite quand même, le code d'avant ce lot remis en place le temps d'un
passage :

| Passage de 25 s, Whisper small | Avant | Après |
|---|---|---|
| Durée (RTF) | 12 854 ms (0,514) | 12 631 ms (0,505) |
| Second passage | 12 603 ms | 12 760 ms |

  Écarts de l'ordre du bruit de la machine, dans les deux sens.

**Limites.**
- Rendu vérifié dans Chromium (Playwright) seulement, pas dans Edge ni Chrome du commerce.
- La traduction française des consignes et la qualité des réponses obtenues avec elles n'ont pas
  été évaluées sur un assistant d'IA : Lowsper n'en appelle aucun. Non vérifié.
- Le texte de l'écran de fin est redessiné en entier à chaque correction. Mesure dans Chromium,
  sur une réunion fictive de 1 h 15 (469 répliques, une toutes les 8 s) : un changement de langue
  avec l'écran de fin affiché, mise en page comprise, prend 30 à 49 ms (médiane de 5 passages, deux
  essais), contre 2 ms sans l'écran de fin. Imperceptible pour un clic, mais à surveiller si l'on
  redessinait à chaque frappe : la saisie d'un nom ne redessine donc que les étiquettes.
- Les guillemets « » du texte anglais viennent de la spécification validée ; le reste de
  l'interface anglaise utilise “ ”.

## 30. Refonte, lot R7 : réglages en onglets

**Contexte.** Les paramètres étaient une longue page de sept rubriques, avec dix listes
déroulantes natives, des cases à cocher et des éditeurs empilés (profils, consignes, sonde de
l'IA). La refonte (`docs/refonte.md` §8, maquette validée « Paramètres ») les range en trois
onglets, en listes groupées, chaque élément à choix ouvrant un sous-écran.

**Organisation.**
- **Transcription** : Langues (langue de l'interface, langue parlée), Mots (« Mots à
  reconnaître », « Corrections automatiques », « Vocabulaire métier »), Pendant la réunion (son
  de la réunion, reconnaître qui parle, nombre de personnes, mini-fenêtre, « Avant de
  commencer »).
- **Notes et compte rendu** : Où vont les notes (« Emplacement », « Dossier », « Format de la
  note »), Compte rendu (« Consigne », « Modifier les consignes »), « Ajouter un emplacement ».
- **Avancé** : Reconnaissance vocale (modèle, vitesse, mesure de vitesse), Affichage (thème),
  Voix (mémoire des voix), Sauvegarde (exporter, importer), Expérimental (IA intégrée), Aide
  (journal technique).
- **Hors maquette, placés par nous** : le thème (la maquette ne montre qu'un bouton d'essai) va
  dans Avancé › Affichage ; le nombre de personnes et « Avant de commencer », réglages des lots R4
  et R5, vont dans « Pendant la réunion ». La langue parlée garde ses trois choix actuels : la liste
  à cocher de plusieurs langues est le lot R8.
- **Nouveaux noms**, chacun expliqué sous sa ligne : « Mots à reconnaître » (donnés à Whisper
  avant la transcription, sans garantie), « Corrections automatiques » (appliquées après, à
  chaque fois), « Emplacement » (ancien « profil » : un dossier et un format de note), « Format
  de la note » (« Texte simple » ou « Pour les applications de notes »). « Profil » disparaît de
  l'interface ; dans le code et dans `app/reglages.txt`, les clés restent `lowsper.profiles` et
  `lowsper.profile`, et la variable de modèle `{{profil}}` ne change pas (rétrocompatibilité).
- **Format de la note** : « Texte simple » est l'ancien format classique, « Pour les applications
  de notes » l'ancien « modèle » (propriétés, étiquettes, liens `[[Nom]]`, modèle et nom de
  fichier). Les réglages avancés du modèle restent dans le même sous-écran, sous le choix.

**Composant commun `app/js/panel.js`** (comme `menu.js` au §27).
- **Onglets** : motif WAI-ARIA « tabs », flèches gauche et droite, Début, Fin ; un seul onglet
  dans l'ordre de tabulation.
- **Sous-écrans** : une ligne `[data-open]` ouvre sa page ; le focus va au titre ; « ‹ Paramètres »
  ou Échap reviennent à l'écran principal, le focus sur la ligne d'origine. Échap n'y ferme pas la
  fenêtre (événement `cancel` intercepté) ; un second Échap la ferme. Un seul niveau de sous-écran.
- **Listes à choix** : choix unique en `role="radiogroup"` (flèches, le choix suit le focus,
  appliqué tout de suite), choix multiple en `role="checkbox"`. Plus aucune liste déroulante native
  dans les paramètres (principe 2 de la refonte, vérifié par `npm run test:settings`).

**Sauvegarde : exporter et importer.**
- **Exporter** télécharge `lowsper-reglages_AAAA-MM-JJ.json`, un JSON lisible :
  `{ "lowsper": "reglages", "version": 1, "exportedAt": ..., "data": { ... } }`.
- **Restent sur ce PC** : les empreintes vocales (`lowsper.voices.*`, donnée biométrique ; choix
  du mainteneur), les mesures de vitesse (`lowsper.speed.*`) et le modèle choisi
  (`lowsper.model`), propres au matériel. La phrase sous la rubrique le dit. Comme pour
  `app/reglages.txt`, la réunion en cours n'est jamais copiée.
- **Importer** accepte un export, ou une copie de `app/reglages.txt` (même filtre : ses empreintes
  vocales sont ignorées). Les réglages du fichier remplacent ceux du navigateur, les autres
  restent. Une confirmation, puis la page se recharge et dit combien de réglages ont été importés.
  Un fichier qui n'en contient pas : message clair, rien n'est touché.
- **Accès aux dossiers** : un export ne contient aucun accès de navigateur (ils ne sont pas
  exportables). Sur l'autre PC, un emplacement avec un dossier choisi demande de le redésigner.
- **Le bouton « Conserver mes réglages dans le dossier Lowsper » disparaît** (§8.3). L'accord au
  dossier est demandé à l'installation (§26) ; sinon, au plus tard à la fermeture des paramètres,
  comme avant. La phrase sous « Mots » dit l'état réel : « Enregistrés dans le dossier Lowsper :
  toujours là après un redémarrage du PC. », « Pas encore copiés... » ou, dans un navigateur sans
  accès aux dossiers, « Gardés par ce navigateur seulement ».

**Dossier de notes par défaut : `Lowsper/Notes/<emplacement>`** (refonte §8.5).
- **Règle** (choix du mainteneur) : un emplacement avec un dossier choisi le garde. Un emplacement
  sans dossier choisi, dont « Par défaut », écrit désormais dans `Notes/<emplacement>`, dans le
  dossier Lowsper accordé à l'installation, et non plus dans les Téléchargements. Changement
  visible, signalé dans le CHANGELOG.
- **Repli** : sans dossier Lowsper accordé (Firefox, accord jamais donné), la note part dans les
  Téléchargements, comme avant. Accord à redemander (`queryPermission` différent de `granted`) :
  l'accueil propose « Autoriser maintenant », et l'écran de fin « Enregistrer aussi dans le
  dossier », comme pour un dossier choisi (§20).
- **Nom figé** (choix du mainteneur : renommer ne doit pas disperser les notes). Le sous-dossier
  prend le nom de l'emplacement, nettoyé des caractères interdits sous Windows, et ce nom est
  enregistré dans l'emplacement (`subfolder`) à la première note écrite. Il est figé à la première
  note plutôt qu'à la création : « Ajouter un emplacement » crée « Nouvel emplacement », que
  l'utilisateur renomme aussitôt ; le figer à la création aurait créé un dossier « Nouvel
  emplacement ». La page « Dossier » le dit.
- **Pas de dossier créé pour rien** : la vérification de l'accueil ne crée rien ; `Notes` et le
  sous-dossier sont créés au moment d'écrire.
- **Compatibilité** : un ancien emplacement n'a pas de `subfolder` ; il est complété à vide,
  aucune migration. Une version plus ancienne de Lowsper qui relit ces réglages ignore le champ.
- **Mise à jour de Lowsper** : les notes sont dans le dossier de la version utilisée. Le README
  dit de copier aussi le dossier `Notes` vers la nouvelle version, comme `app/models` et
  `app/reglages.txt`. Le dépôt ignore `/Notes/`.

**Défauts trouvés en relecture et corrigés.**
- **Liste écrasée** : dans une page plus haute que la fenêtre (format « Pour les applications de
  notes »), la liste de choix tombait à 0 pixel de haut. Cause : dans un conteneur flexible qui
  défile, un bloc à débordement masqué peut rétrécir jusqu'à zéro. Correction : aucun bloc des
  paramètres ne rétrécit, c'est la page qui défile. Le test vérifie la hauteur de la liste ; il
  échoue sans la correction (0 px) et passe avec (vérifié dans les deux sens). Les tests de bout en
  bout ne le voyaient pas : le clic sur un élément invisible passait quand même.
- **Focus perdu** : un choix qui redessine sa propre liste (thème, langue de l'interface, format)
  retirait l'élément qui avait le focus ; au clavier, on perdait sa place. Le focus revient
  désormais sur le choix actuel (test : trois flèches de suite dans la liste des thèmes).
- **Emplacement montré** : les paramètres s'ouvraient sur le dernier emplacement modifié, pas sur
  celui choisi à l'accueil. Ils s'ouvrent maintenant sur celui de l'accueil (trouvé par le test de
  bout en bout des notes).

**Journal technique dans les paramètres** (Avancé › Aide), en plus de l'écran de fin. La maquette
promet « Ne contient aucun texte de réunion » : vérifié en relisant chaque appel de `journal()`
dans `app.js` (début, fin, santé du moteur, erreurs, couverture, emplacement de la note : aucun
texte transcrit).

**Tests.**
- Unitaires : export sans empreintes vocales ni mesures, import d'un export et d'une copie
  `app/reglages.txt`, fichiers refusés, réglages de ce PC gardés ; dossier par défaut (accord à
  demander, simple vérification sans création, écriture, nom figé, repli), noms de dossier sûrs.
- `npm run test:settings` (nouveau, en CI, 15 s) : onglets au clavier, aucune liste déroulante
  native, nouveaux noms expliqués, sous-écran (focus, Échap), choix au clavier, valeurs des
  lignes, export, import et fichier refusé, « Ajouter un emplacement », ni erreur ni réseau.
- `npm run test:e2e-notes` : création d'un emplacement par les sous-écrans ; avec un dossier
  Lowsper accordé, note de « Par défaut » écrite dans `Notes/Par défaut` sans téléchargement ;
  emplacement renommé, sous-dossier inchangé.
- `npm run test:e2e` : les deux notes de la réunion sont lues dans `Notes/Par défaut` (dossier
  accordé à l'installation), aucun téléchargement.
- Tests de l'accueil, de la langue, de la sonde, du premier lancement et captures adaptés aux
  sous-écrans.

**Charge du moteur.** Pas de mesure avant et après : le chemin du direct n'est pas modifié.
`engine.js`, `capture.js`, `analyzer.js`, `speakers.js`, `transcript.js`, `meeting.js` et
`audiofile.js` sont identiques à ceux de `main` (`git diff` vide), et le banc (`npm run bench`) ne
charge que `engine.js` : il exécuterait le même code. Le réglage « Vitesse » écrit la même clé
(`lowsper.power`) et appelle le même recalcul qu'avant.

**Limites.**
- Rendu vérifié dans Chromium (Playwright) seulement, pas dans Edge ni Chrome du commerce.
- **Non vérifié** : si Chrome et Edge gardent l'accord d'écriture au dossier Lowsper après un
  redémarrage du navigateur. S'ils le redemandent, l'accueil affiche « Autoriser maintenant » avant
  la réunion ; sans ce clic, la note part dans les Téléchargements et l'écran de fin propose de
  l'enregistrer aussi dans le dossier. À observer sur un vrai poste.
- La langue parlée reste à trois choix jusqu'au lot R8.

## 31. Documentation : page d'accueil en anglais, courte, guide complet à part

**Contexte.** Le README faisait 586 lignes en français, avec un résumé anglais séparé
(`README.en.md`). Demande du mainteneur (6 novembre 2026) : une page d'accueil en anglais, une
bascule vers le français, et une documentation plus courte, lisible par quelqu'un qui ne prendra
pas le temps de tout lire.

**Arbitrage.**
- `README.md` en anglais, `README.fr.md` en français : même plan, une page chacun (environ 85
  lignes), avec en tête « English | Français » pour passer de l'un à l'autre. GitHub affiche
  `README.md` à l'accueil du dépôt.
- Plan commun : la promesse, pourquoi Lowsper, démarrage en cinq étapes, ce qu'il fait, bon à
  savoir (navigateurs, qualité, mise à jour), liens, commandes des développeurs, licences.
- **Rien n'est perdu** (choix du mainteneur) : l'ancien README français, complet, devient
  `docs/guide.md` (écrans, questions fréquentes, limites, feuille de route), liens recalculés pour
  son nouvel emplacement. Les deux README y renvoient. `README.en.md` disparaît.
- Le paquet de distribution contient `README.md` et `README.fr.md` (test `npm run test:release`).
  Le guide, avec ses captures, reste en ligne dans le dépôt.
- La contrainte n° 5 d'`AGENTS.md` change en conséquence : documentation en français, sauf les
  deux pages d'accueil, tenues ensemble et courtes.

## 32. Suivi des vulnérabilités par l'agent Lysbor

**Contexte.** Le mainteneur veut suivre les vulnérabilités de Lowsper avec Lysbor, son service
de suivi (SBOM confronté chaque nuit à la base OSV, alertes). Lysbor fournit un agent CI,
`lysbor-scan`, et son propre dépôt l'utilise sur lui-même (workflow de référence, recopié ici).

**Ce que fait `.github/workflows/lysbor.yml`.**
- Déclencheurs : le 1er du mois, à la demande, et à chaque changement sur `main` de
  `tools/package.json`, `tools/package-lock.json` ou des workflows. Lysbor revérifie chaque nuit
  le dernier inventaire reçu : le renvoyer n'est utile que quand il change.
- `lysbor-scan --all .` : inventaire CycloneDX par Syft, analyse du code par Semgrep (`p/default`),
  configuration et secrets par Trivy. Envoi au projet Lowsper de l'instance `https://lysbor.com`.
- **Ne bloque jamais** (choix du mainteneur) : pas de `--fail-on`, workflow séparé de la CI. Les
  alertes viennent de Lysbor.
- Réglages : secret `LYSBOR_API_KEY`, variable `LYSBOR_PROJECT`. Sans l'un des deux, le job
  s'arrête proprement (copie du dépôt, ou avant la configuration).

**Durcissements par rapport au workflow de référence.**
- **Script de l'agent figé par son empreinte SHA-256** : il est téléchargé depuis l'instance puis
  vérifié avant exécution. Mesure : le script servi par `https://lysbor.com/agent/lysbor-scan.sh`
  et celui du dépôt Lysbor ont la même empreinte (`69ac8537...`). Une mise à jour de l'agent fait
  donc échouer le job tant que l'empreinte n'est pas remplacée, après relecture.
- **Semgrep figé** à 1.177.0, la version de l'image Docker de l'agent. Syft (1.52.0) et Trivy
  (0.74.0) sont installés par l'agent depuis leurs archives publiées, empreinte vérifiée.
- **Actions GitHub figées** sur l'empreinte de leur commit (`actions/checkout` et
  `actions/setup-node` v4.4.0, la version désignée par `@v4` le 6 novembre 2026), dans les trois
  workflows, au lieu d'une étiquette modifiable. Comportement inchangé.

**Ce qui est envoyé, et pourquoi la contrainte n° 1 tient.** La CI de GitHub envoie à Lysbor la
liste des dépendances et les résultats des analyses de ce dépôt public. L'application, elle, ne
se connecte toujours à rien d'autre qu'Hugging Face (test de non-fuite inchangé). Aucune donnée
d'utilisateur ne peut s'y trouver : le dépôt n'en contient pas (contrainte n° 9).

**Exclusions.** Syft et Trivy ignorent `tools/test`, `tools/.cache`, `tools/node_modules` et
`app/models` ; Semgrep lit `.semgrepignore` (mêmes dossiers, plus `app/engine`, le moteur
généré : son code tiers est suivi par l'inventaire des dépendances, pas par l'analyse de code).

**Mesures, outils lancés ici sans envoi (pas de clé dans cet environnement).**
- Syft 1.52.0 : 194 composants, dont 185 paquets npm de `tools/package-lock.json` (parmi eux
  `@huggingface/transformers` 4.3.0 et `onnxruntime-web` 1.31.0-dev, empaquetés dans
  l'application) et les actions des workflows.
- Trivy 0.74.0 (configuration, secrets) : aucun résultat.
- Semgrep 1.177.0 : 19 résultats avant les exclusions, 5 après le figeage des actions et
  l'exclusion de `tools/test`. Les 5 restants sont des faux positifs, vérifiés ligne par ligne, à
  marquer comme tels dans Lysbor :
  - `detect-non-literal-regexp` (`transcript.js`, `vocabulary.js`) : les mots saisis sont
    échappés avant de construire l'expression ;
  - `unsafe-formatstring` (`app.js`, `capture.js`) : messages de console au texte fixe ;
  - `missing-integrity` (`Lowsper.html`) : la feuille de style est un fichier local du même
    dossier, un contrôle d'intégrité n'y ajoute rien.

**Limites.**
- Le premier envoi réel n'a pas pu être fait ici : il demande la clé et le projet. Non vérifié
  tant que le mainteneur n'a pas lancé le workflow une fois.
- Le moteur empaqueté (`app/engine`) est suivi à travers `tools/package-lock.json` ; une
  modification à la main du fichier généré (interdite par `AGENTS.md`) échapperait à l'inventaire.

## 33. Résultats Lysbor du 6 novembre 2026 : un vrai ReDoS, quatre corrections mineures ou faux positifs

**Contexte.** Premier envoi de l'agent Lysbor (§32) : 5 résultats Semgrep ouverts (3 moyens,
2 faibles), aucun résultat Trivy. Consigne de Lysbor : corriger la cause, n'exclure qu'un faux
positif avéré, avec sa raison. Au §32, les cinq avaient été jugés faux positifs à la lecture ; la
mesure en a démenti un.

**`detect-non-literal-regexp`, `app/js/vocabulary.js` : vrai défaut, corrigé.**
- Cause : dans `wordPattern`, chaque suite d'espaces du mot à corriger devenait `[\s-]+`, et les
  tirets restaient littéraux. Un mot comme « a - - - - b » donnait `a[\s-]+-[\s-]+-...b` : des
  groupes collés à des tirets qu'ils peuvent eux-mêmes absorber. Sur un texte qui contient une
  longue suite « - - - », le moteur essaie un nombre polynomial de découpages.
- Mesure (Node.js 22, `replaceWord`, texte « a » suivi de n fois « - ») : mot avec 2 tirets,
  n = 200, 400, 800 : 3,7, 20, 174 ms ; mot avec 4 tirets, n = 200 : 8,4 s ; au-delà, arrêté au
  bout de 120 s sans résultat. Le mot vient de l'utilisateur (« Corrections automatiques ») ou
  d'un fichier de réglages importé : un fichier piégé pouvait figer la page, y compris pendant
  une réunion.
- Correction : toute suite d'espaces et de tirets qui contient une espace devient un seul
  séparateur `[\s-]+`. Un séparateur n'est donc jamais collé à un tiret littéral, il est borné par
  des lettres. Mêmes saisies : moins de 1 ms jusqu'à n = 800 et 6 tirets.
- Comportement gardé : espace du mot = espace ou tiret dans le texte (« mira bello » trouve
  « Mira-Bello »), tiret du mot littéral (« Jean-Pierre » ne trouve pas « Jean Pierre »), mot
  entier. Seul changement : un mot où espaces et tirets se touchent (« a - b ») accepte désormais
  n'importe quelle suite d'espaces et de tirets à cet endroit, y compris une simple espace.
- Test unitaire : correspondances ci-dessus et saisie piégée (5 000 répétitions, moins de
  500 ms). Lancé sur l'ancien code, il bloque (arrêté au bout de 60 s) ; il passe sur le nouveau.
- L'expression reste construite à partir de la saisie, échappée et bornée : la règle continue de
  la signaler, une exclusion `nosemgrep` motivée est posée sur cette ligne.

**`detect-non-literal-regexp`, `app/js/transcript.js` (`fixCase`) : faux positif, mesuré.**
Le terme est échappé, et ses espaces deviennent `\s+`, qui ne peut pas absorber un tiret : pas
d'ambiguïté. Mesure avec les mêmes saisies piégées : moins de 1,5 ms jusqu'à n = 800, et 22 ms
pour un million de caractères avec cinq termes hostiles. Exclusion `nosemgrep` motivée.

**`unsafe-formatstring`, `app/js/app.js` et `app/js/capture.js` : corrigés.** Les deux messages
de console concaténaient une valeur dans la chaîne de format. Ils utilisent maintenant une chaîne
constante (`%d`, `%s`) ; le message affiché est identique.

**`missing-integrity`, `Lowsper.html` : faux positif.** La ligne visée est l'icône de la page,
une URI `data:` écrite dans le HTML : rien n'est téléchargé, l'attribut `integrity` n'a pas
d'objet. Exclusion `nosemgrep` motivée, en commentaire HTML (syntaxe vérifiée avec Semgrep
1.177.0 sur une copie de la page).

**Leçon.** Un faux positif « évident à la lecture » se mesure avant d'être exclu : la relecture
du §32 avait manqué les tirets collés aux séparateurs.

**Après correction.** Semgrep 1.177.0 relancé sur le dépôt avec la configuration du workflow :
voir le compte rendu de la pull request. Lysbor reçoit le nouveau rapport au prochain passage du
workflow (il se déclenche à la fusion, les workflows ayant changé).

## 34. Refonte, lot R8 : langues parlées multiples, qualité mesurée avant de proposer une langue

**Contexte.** La langue parlée se choisissait entre trois valeurs (français, anglais, les deux).
Besoin (`docs/refonte.md` §8.1) : des réunions en anglais, espagnol, mandarin, japonais..., parfois
mélangées, avec une liste à cocher. Le moteur savait déjà reconnaître la langue d'un passage parmi
une liste (§9), mais l'application ne lui donnait que français et anglais.

**Défaut trouvé en début de lot (4.0.0).** Depuis le lot R7, la langue parlée n'était plus lue :
`createTranscript` lisait `$('language').value` sur la liste dessinée par Lowsper (un `div`, sans
`value`). La langue de la réunion valait donc `undefined` : le moteur transcrivait toujours en
français (valeur par défaut du Worker), un anglais forcé était transcrit en français, et la note
écrivait « Langue : undefined ». Corrigé par le nouveau réglage ; test unitaire (la note d'une
session sans langue écrit « français », comme ce que le moteur a réellement fait).

**Méthode de mesure.**
- **Corpus** `tools/test/corpus/langs.json` : la même réunion fictive de dix phrases (budget,
  livraison, planning, compte rendu), sans nom réel, traduite dans les douze langues de la maquette.
  Nombres écrits en lettres ou évités.
- **Voix** : Piper (`rhasspy/piper-voices`, révision figée `e7229f7d`), deux voix en alternance
  quand la langue en a deux (une seule en arabe, japonais, coréen). Audio régénéré par
  `corpus/make-langs.py` dans `tools/.cache/langs` (environ 20 Mo, non versionné).
  Piper et ses voix ne servent qu'à fabriquer cet audio de test : ni versionnés, ni distribués,
  aucune dépendance nouvelle pour l'utilisateur (comme pour les corpus français du §15.1).
- **Banc** `tools/test/eval-langs.mjs` : le vrai moteur de Lowsper (`engine.js`, Whisper small,
  Chromium), chaque phrase seule avec 0,3 s de silence autour ; détection parmi les douze langues,
  et transcription avec la langue imposée. Taux d'erreur par mot après normalisation (casse,
  ponctuation ; formes de l'alif et voyelles brèves en arabe), par caractère pour le mandarin et le
  japonais, écrits sans espaces.

**Mesures (Whisper small, 10 phrases par langue).**

| Langue | Erreur | Détection parmi 12 | Décision |
|---|---|---|---|
| Anglais | 0,9 % | 10/10 | proposée |
| Espagnol | 3,6 % | 10/10 | proposée |
| Allemand | 4,7 % | 10/10 | proposée |
| Portugais | 6,3 % | 10/10 | proposée |
| Français | 7,0 % | 10/10 | proposée |
| Arabe | 7,3 % | 10/10 | proposée |
| Japonais | 7,9 % (caractères) | 10/10 | proposée |
| Néerlandais | 8,5 % | 10/10 | proposée |
| Mandarin | 15,4 % (caractères) | 10/10 | mise en garde |
| Italien | 18,6 % | 10/10 | mise en garde |
| Coréen | 21,0 % | 10/10 | mise en garde |
| Hindi | 50,4 % | 10/10 | pas proposée |

**Seuil (choix du mainteneur).** Erreur d'au plus 10 % : proposée. De 10 à 25 % : proposée avec la
mention « reconnaissance moins fiable ». Au-delà : pas proposée. Le hindi n'apparaît donc pas ;
il reviendra si une mesure meilleure le justifie (autre modèle, autres voix).

**Lecture des chiffres.**
- **Voix de synthèse, propres** : une vraie réunion (son de visio, accents, bruit) sera moins bonne.
  Le classement compte plus que la valeur.
- **Mandarin** : une part des erreurs n'en est pas. Avec l'une des voix, Whisper écrit en
  caractères traditionnels (我們) au lieu des simplifiés (我们), compté comme faux.
- **Italien** : l'écart vient en partie de la voix (26,5 % avec l'une, 11,7 % avec l'autre).
- **Coréen** : l'erreur par mot est sévère pour une langue où un mot réunit plusieurs éléments.
- **Détection** : 120 phrases sur 120 reconnues dans la bonne langue parmi les douze. Ce sont des
  phrases de 3 à 8 s ; **non mesuré** : un passage très court (« oui », « d'accord »).
- **Coût** : la détection est une seule étape du décodeur sur la sortie de l'encodeur déjà
  calculée, quel que soit le nombre de langues cochées (§9). D'où, avec l'accord du mainteneur,
  **aucune limite** au nombre de langues cochées ; le texte sous la liste conseille de n'en cocher
  pas plus que nécessaire.

**Mise en œuvre.**
- `app/js/languages.js` : liste des onze langues proposées, avec leur qualité ; réglage
  `lowsper.languages` (« fr,en »). **Rétrocompatibilité** : tant qu'il n'existe pas, l'ancien
  `lowsper.language` est lu (« fr », « en », « auto » = français et anglais), y compris depuis un
  `app/reglages.txt` d'une version précédente ; aucune migration écrite, rien n'est perdu. Au moins
  une langue reste cochée.
- **Interface** (choix du mainteneur) : le nom dans la langue elle-même (« Español », « 日本語 »),
  traduit dessous dans la langue de l'interface s'il diffère. L'attribut `lang` (et `dir="auto"`
  pour l'arabe) ne porte que sur le nom natif, pour les lecteurs d'écran.
- **Moteur** : une seule langue cochée, elle est imposée (comme avant) ; plusieurs, le moteur
  reconnaît celle du passage. Le contexte peut être un objet par langue : le Worker prend celui de
  la langue reconnue (les termes d'une liste espagnole n'aident pas un passage en français).
- **Note** : les trois réglages d'avant gardent exactement leur texte (« français », « français et
  anglais (détection automatique) ») ; sinon, liste des langues (« français, anglais et espagnol
  (détection automatique) »).

**Charge du moteur** (`npm run bench`, 4 fils, Whisper small, même machine, deux passages).

| Passage | Avant | Après |
|---|---|---|
| 6,2 s de parole | 15 292 ms ; 14 550 ms | 13 742 ms ; 13 562 ms |
| 25 s de parole, français | 15 045 ms (RTF 0,602) ; 13 644 ms (RTF 0,546) | 13 737 ms (RTF 0,549) ; 13 784 ms (RTF 0,551) |
| 25 s, détection automatique | 15 389 ms ; 14 975 ms | 14 345 ms ; 14 737 ms |

Aucune régression : les écarts sont du bruit de machine partagée.

**Limites.**
- **Non traité** : la détection des boucles et le contrôle « texte trop court » du moteur comptent
  des mots séparés par des espaces ; en mandarin et en japonais, une boucle sans espace n'est
  arrêtée que par le budget de jetons. Non observé sur ce corpus de phrases courtes.
- Les filtres d'hallucinations et de mots courants (`transcript.js`) restent pensés pour le
  français et l'anglais.
- Les noms des langues n'ont pas été relus par des locuteurs natifs.

## 35. Refonte, lot R8 : vocabulaires métier élargis, par langue, et contexte partagé

**Contexte.** Trois vocabulaires (cybersécurité, informatique, gestion de projet), en français.
Besoin (`refonte.md` §8.4) : neuf domaines de plus, des listes par langue, un format simple pour
en proposer. Contrainte : Whisper ne garde que 200 jetons de contexte, moins pour un long passage
(`decodePlan`, §17.8), en coupant par le début.

**Mesure de départ.** Taille en jetons Whisper de chaque liste française : 74 à 183 (cybersécurité
183 à elle seule). Deux listes cochées dépassent déjà le budget ; avec l'ancienne règle (listes
bout à bout dans l'ordre du catalogue, glossaire personnel à la fin), la première liste était
rognée, et avec trois ou plus, seule la dernière survivait.

**Listes.** `app/js/vocabularies.js`, fichier de données seul : douze domaines (cybersécurité,
informatique et cloud, gestion de projet, santé, juridique, finance et comptabilité, ressources
humaines, éducation, commerce et marketing, secteur public, ingénierie et industrie, immobilier),
de 23 à 49 termes, en français et en anglais (choix du mainteneur : les autres langues restent
ouvertes aux contributions, format dans `CONTRIBUTING.md`). Une langue sans liste n'a que les mots
à reconnaître de l'utilisateur, jamais les termes d'une autre langue. Termes génériques seulement.
**Exception gardée** (choix du mainteneur) : les listes françaises d'origine contiennent des noms
de produits (Teams, SharePoint, ServiceNow...) ; elles sont conservées telles quelles, dans le même
ordre, pour ne rien changer aux réunions déjà réglées. Les nouvelles listes n'en contiennent pas.
Les corrections de déformations restent celles réellement observées (cybersécurité, informatique,
en français) : aucune n'est inventée pour les nouvelles listes.

**Mesure de plusieurs listes cochées.** Corpus `corpus/vocab-fr.json` : huit phrases fictives par
domaine (santé, juridique, finance), 44 termes pris au début, au milieu et à la fin des listes ;
voix Piper françaises ; banc `tools/test/eval-vocab.mjs`, contextes construits avec le vrai
découpage en jetons de Whisper. Terme compté bien écrit sans tenir compte de la casse ni des
accents (la correction de casse les rétablit ensuite).

| Contexte | Termes bien écrits | Domaine le moins bien servi |
|---|---|---|
| Aucune liste | 26/44 | finance 7/15 |
| La liste du domaine seule | 37/44 | finance 12/15 |
| 3 listes bout à bout (règle 4.0) | 32/44 | santé 10/14 (1 terme sur 14 resté dans le contexte) |
| 3 listes, part égale du budget | 35/44 | finance 11/15 |
| 3 listes en alternance | 35/44 | finance 11/15 |
| 12 listes bout à bout | 29/44 | finance 9/15 |
| 12 listes, part égale | 31/44 | finance 9/15 |
| 12 listes en alternance | 30/44 | finance 9/15 |

**Règle retenue (choix du mainteneur) : l'alternance.** Un terme de chaque liste cochée à tour de
rôle, les premiers (les plus utiles) à la fin. Le moteur coupant par le début, chaque liste garde
ses meilleurs termes quelle que soit la place restante, y compris pour un long passage, sans
compter les jetons dans la page (la part égale donne le même score mais demande cette estimation).
Ordre du contexte : vocabulaires alternés, nom de la réunion, glossaire personnel, texte
précédent. Sans vocabulaire, le contexte est identique à celui de la 4.0. Les termes déjà dans le
glossaire personnel sont omis des listes.

**Pas de plafond** (choix du mainteneur) : avec douze listes, on retombe presque au niveau
« aucune liste » ; le texte sous la liste conseille de ne cocher que ses domaines.

**Après la transcription**, le glossaire complet (toutes les listes cochées dans les langues
parlées, sans limite de longueur) sert comme avant à la casse, aux sigles et au filtre des
hallucinations.

**Correction de casse : majuscule de début de phrase.** `fixCase` réécrit un terme du glossaire
dans sa forme exacte ; un terme en minuscules (« planning ») abaissait la majuscule d'un début de
phrase (« Planning validé » devenait « planning validé »). Avec des listes plus longues, l'effet
grandissait ; la majuscule initiale est désormais gardée. Test unitaire.

**Expressions construites à partir des listes (§33).** Seules deux expressions sont construites
dynamiquement : `wordPattern` (corrections de l'utilisateur, inchangé) et `fixCase`, par où passent
désormais les 792 termes des listes. Terme échappé, espaces en `\s+` seul, jamais collé à un
caractère qu'il peut absorber. Mesure (Node.js 22, les 792 termes sur des textes piégés de 10 000 à
20 000 caractères : suites « - - - », espaces, « -the » répété, « P& », apostrophes, chiffres) :
de 12 à 23 ms par texte ; sur la suite de tirets, 11, 13 puis 22 ms quand le texte double (coût
linéaire ; le tout premier appel prend environ 560 ms, compilation des 792 expressions). Test
unitaire sur ces saisies.

**Limites.**
- 24 phrases et 44 termes, une mesure par condition : un écart de 1 ou 2 termes n'est pas
  significatif. 4 à 11 listes cochées n'ont pas été mesurées.
- Listes anglaises non mesurées (corpus français seulement) et non relues par un anglophone.
- Les voix de synthèse prononcent parfois mal un sigle (« CHU ») : la mesure compare des contextes
  entre eux, pas une qualité absolue.

## 36. Écran de bienvenue : retours du mainteneur sur la 4.0.0

Observé par le mainteneur dans Brave et Chrome sous Windows (6 novembre 2026), corrigé dans le
même lot à sa demande, en commits séparés.
- **La fenêtre de choix du dossier s'ouvrait sur Documents.** Elle ne peut pas s'ouvrir sur le
  dossier de la page : `showDirectoryPicker` n'accepte comme point de départ qu'un dossier connu ou
  déjà autorisé (§26), pas le chemin lu dans l'adresse de la page. Elle s'ouvre désormais sur
  Téléchargements (`startIn: 'downloads'`), où Lowsper est le plus souvent décompressé ; un dossier
  déjà choisi une fois reste prioritaire (`id`). Vérifié par le test de bout en bout (option
  demandée) ; l'effet dans Chrome et Edge du commerce reste à confirmer par le mainteneur.
- **La page se décalait** quand « Déjà installé ailleurs » faisait apparaître la barre de
  défilement : sa place est désormais réservée (`scrollbar-gutter: stable`).
- **Non changé** : la recommandation ne retient jamais un modèle « carte graphique », faute de
  mesure de sa vitesse (§26) ; le mainteneur mesurera d'abord sur son PC (16 fils, 32 Go, carte
  graphique). Le choix d'un seul modèle est celui du lot R3.

## 37. Refonte, lot R9 : mémoire des voix d'une visio à l'autre

**Contexte.** Constat du mainteneur (`docs/refonte.md` §9) : la mémoire des voix (§15.10)
reconnaît mal une personne qui change de micro. Aucune mesure n'existait. Remplace, pour la
reconnaissance et la conservation, les règles du §15.10 ; le reste (désactivée par défaut,
consentement, stockage local, effacement manuel) est inchangé.

**Corpus (synthétique, aucune donnée réelle).** `tools/test/corpus/make-voices.py`, graine fixe,
régénéré à l'identique (environ 4 h 25 de son, non versionné, dans `tools/.cache/voices`).
- 96 voix Piper distinctes du modèle multi-voix `fr_FR-mls-medium` (révision figée) : 48
  « habituées » (8 équipes de 6, 6 réunions chacune) et 48 « de passage » (une seule réunion).
- Cinq appareils simulés, chacun suivi de l'aller-retour Opus d'une visio et d'un bruit rose :
  casque (90-7000 Hz, Opus 24 kb/s), micro du portable (graves coupés, résonance, écho de la pièce,
  ventilateur, 16 kb/s), téléphone (300-3400 Hz, 8 kb/s), salle équipée (réverbération,
  compresseur, 20 kb/s), écouteurs Bluetooth (200-3800 Hz, compresseur, 12 kb/s). Chaque habituée
  passe par les cinq, dans un ordre tiré au hasard.
- À chaque réunion varient aussi le débit et l'intonation, la distance au micro (-8 à +4 dB), le
  volume reçu (-6 à +3 dB) et la durée de parole (3 à 10 phrases).
- Empreintes calculées dans le vrai moteur (`tools/test/embed-voices.mjs` : WeSpeaker dans
  Chromium, fenêtres de 2 s de `SpeakerTracker`, empreinte finale de la voix). Le regroupement des
  voix de la réunion est supposé parfait : la mesure isole la mémoire.

**Protocole** (`tools/test/eval-voices.mjs`, sans navigateur, quelques secondes). Rejoue 6
réunions par équipe, mémoire partagée par toutes les équipes d'une moitié. À la première réunion,
l'utilisateur nomme chaque habituée ; ensuite la mémoire propose des noms, puis l'utilisateur
corrige les noms absents ou faux, ce qui enrichit la mémoire (comme `app.js`). Le corpus est coupé
en deux moitiés indépendantes : le seuil est choisi sur la première (« réglage ») et vérifié sur
la seconde (« contrôle »). Mesuré : bon nom, mauvais nom (confusion), aucun nom, personne de
passage nommée à tort.

**Ce que dit le corpus** (`--stats`, similarité entre deux réunions) :

| | 5 % | médiane | 95 % | maximum |
|---|---|---|---|---|
| Même personne, même appareil | 0,891 | 0,945 | 0,970 | 0,975 |
| Même personne, autre appareil | 0,652 | 0,849 | 0,926 | 0,951 |
| Deux personnes différentes | 0,172 | 0,434 | 0,739 | 0,936 |

Le téléphone est l'appareil qui éloigne le plus une voix d'elle-même (médiane 0,69 à 0,73 avec
les autres appareils, contre 0,85 à 0,91 entre les autres). Les deux zones se chevauchent : aucun
seuil seul ne sépare une même personne sur un autre appareil de deux personnes proches.

**Mesure de l'existant** (une empreinte moyenne par personne, seuil 0,65) : 82 % de bonnes
reconnaissances, mais 17 % de confusions et **81 % des personnes de passage reçoivent un nom**.
Avec 24 personnes en mémoire, une voix inconnue en trouve presque toujours une au-dessus de 0,65.
Monter le seuil seul ne suffit pas : à 0,875, encore 2,5 % de confusions et 6 % de passage nommé,
pour 53 % de reconnaissances.

**Pistes essayées** (grille : 1 à 12 empreintes par personne ; comparaison à la plus proche, à la
moyenne, ou au meilleur des deux ; liste pleine : oublier la plus ancienne ou fusionner les deux
plus proches ; marge de 0 à 0,15 avec la deuxième personne la plus proche ; seuil de 0,40 à
0,95) :
- **plusieurs empreintes, comparées à la plus proche** : chaque appareil corrigé une fois est
  reconnu ensuite (même appareil : 100 % sur la moitié « réglage ») ; une seule empreinte, même
  avec marge, plafonne à 45 % de reconnaissances aux mêmes taux d'erreur ;
- **la marge avec la deuxième personne** est le levier principal contre les faux noms : une voix
  qui ressemble presque autant à deux personnes n'en reçoit aucune ;
- 3, 5 ou 8 empreintes donnent les mêmes chiffres sur ce corpus (au plus 6 réunions par
  personne) ; « oublier la plus ancienne » et « fusionner » font jeu égal ;
- ajouter aussi une empreinte quand le nom proposé est gardé gagne 3 à 5 points, mais suppose que
  l'utilisateur corrige toujours un faux nom : écarté (un faux nom non corrigé polluerait la
  mémoire de la mauvaise personne).

**Choix du mainteneur** (7 novembre 2026), parmi trois compromis présentés : « équilibré ».
- Jusqu'à **5 empreintes par personne**, une par réunion où on la nomme ou la corrige ; au-delà,
  la plus ancienne est oubliée.
- Comparaison à **l'empreinte la plus proche** de chaque personne, **seuil 0,825**, et **marge de
  0,05** avec la deuxième personne la plus proche. Association une à une, comme avant.
- **Conservation par empreinte** : chaque empreinte est effacée 1, 3 ou 6 mois après sa création ;
  la personne est oubliée quand il ne lui en reste aucune.
- **Copie locale gardée** dans `app/reglages.txt` (§15.16) : les empreintes y restent, sur ce PC,
  pour survivre à l'effacement des données du navigateur ; jamais dans l'export ni dans un
  fichier importé (§30).

**Avant et après, mêmes chiffres** (`node test/eval-voices.mjs`) :

| Moitié | Version | Bon nom | Confusion | Sans nom | Passage nommé | Appareil nouveau |
|---|---|---|---|---|---|---|
| Réglage | 4.1.0 | 86,7 % | 11,7 % | 1,7 % | 83,3 % | 86,1 % |
| Réglage | 4.2.0 | 70,8 % | 4,2 % | 25,0 % | 8,3 % | 68,8 % |
| Contrôle | 4.1.0 | 84,2 % | 15,0 % | 0,8 % | 79,2 % | 82,9 % |
| Contrôle | 4.2.0 | 65,0 % | 0,8 % | 34,2 % | 0,0 % | 62,4 % |

Chaque moitié compte 120 reconnaissances à juger et 24 personnes de passage : une personne de
passage vaut 4,2 points. Lecture : moins de noms proposés, mais presque jamais faux ; une voix
sans nom se corrige d'un clic et enrichit la mémoire, un faux nom passe inaperçu dans la note.

**Format et rétrocompatibilité.** Clé `lowsper.voices.v1` inchangée, format étendu sans rien
retirer : chaque personne garde `emb` (la moyenne, que lisent les versions antérieures) et reçoit
`prints` (ses empreintes datées, arrondies à 4 décimales, environ 2 Ko chacune). Une voix sans
`prints` (mémorisée par une version précédente) est lue comme une seule empreinte, datée de sa
création : aucune migration à lancer, testé (`npm run test:unit`). Limite : revenir à une version
antérieure puis renommer une voix met à jour `emb` sans `prints` ; la 4.2.0 garde alors les
anciennes `prints`.

**Coût.** Aucun pendant la réunion : la reconnaissance a lieu à la fin, sur quelques voix
(au plus 5 empreintes par personne mémorisée). Le chemin du direct n'a pas changé, d'où aucune
mesure `npm run bench`.

**Limites, non vérifiées ici.**
- Les voix d'un même modèle Piper se ressemblent sans doute plus que de vraies voix (deux
  personnes : médiane 0,43) : le seuil est probablement prudent pour de vraies réunions. Seul un
  essai réel le dira.
- Le corpus ne contient pas les erreurs du regroupement des voix (une personne coupée en deux, deux
  personnes fusionnées), mesurées à part (§15.14).
- Pas de vrais appareils ni de vrais logiciels de visio : la dégradation est simulée par des
  filtres et le codec Opus.

## 38. Dossier Lowsper : accès d'une ancienne version, chemin absent, dossier parent accepté (4.2.1)

**Constats du mainteneur** (Chrome sous Windows, 4.2.0, 7 novembre 2026) :
1. une fenêtre du navigateur demande l'autorisation de modifier le dossier « Lowsper-3.4.0 »,
   alors que ce dossier n'existe plus ;
2. à l'installation, Lowsper « ne trouve pas » le dossier de `Lowsper.html`, alors que la barre
   d'adresse le montre (`file:///C:/Users/.../Downloads/Lowsper-4.2.0/Lowsper-4.2.0/Lowsper.html`).

**Causes, trouvées dans le code.**
- **Mémoire partagée.** Le navigateur range les données de toutes les pages ouvertes en `file://`
  au même endroit (même origine). L'accès au dossier rangé par la 3.4.0 (IndexedDB, clé
  `folder`, §26) était relu par la 4.2.0 sans vérifier qu'il s'agissait de son propre dossier :
  au premier enregistrement des réglages ou d'une note, Lowsper redemandait l'accès à l'ancien
  dossier. Accordé sur un dossier encore présent, il y aurait écrit `app/reglages.txt` et les
  notes (`Notes/<emplacement>`), loin de la version utilisée. Déduit du code, non reproduit dans
  Chrome ou Edge du commerce ; le partage du stockage entre pages `file://` n'est pas vérifié ici
  sur ces navigateurs (il l'est dans Chromium, où les tests tournent).
- **Identifiant en double.** Depuis le lot R7 (4.0.0), `Lowsper.html` contenait deux éléments
  `id="page-folder"` : la sous-page « Dossier » des paramètres, et la ligne de l'écran de bienvenue
  censée afficher le chemin. Le code trouvait le premier : le chemin n'était jamais affiché à
  l'installation, et il effaçait le contenu de la sous-page « Dossier ». Le test de l'écran de
  bienvenue lisait le même mauvais élément, d'où un test vert.
- **Double dossier.** Le paquet contient un dossier `Lowsper-X.Y.Z` (`tools/release.mjs`), et
  « Extraire tout » de Windows en crée un second du même nom. La fenêtre s'ouvre sur
  Téléchargements (§36) : il faut descendre de deux niveaux, et choisir le premier
  `Lowsper-X.Y.Z` donnait « Ce dossier ne contient pas Lowsper.html ».
- **Non contournable** : la fenêtre de choix ne peut pas s'ouvrir sur le chemin lu dans l'adresse
  de la page (§26, §36).

**Options pour le double dossier.**
| Option | Effet | Arbitrage |
|---|---|---|
| Paquet sans dossier racine | « Extraire tout » crée un seul dossier | Écartée : d'autres outils (« Extraire ici ») répandraient les fichiers dans Téléchargements |
| Consigne seule | Rien à coder | Insuffisante : c'est l'erreur observée |
| **Lowsper cherche lui-même** dans le dossier choisi | Le premier `Lowsper-X.Y.Z`, ou Téléchargements, suffit | **Retenue** |

**Corrections.**
1. **Accès d'une autre copie** (`settings.js`) : l'accès rangé n'est utilisé que s'il porte le nom
   du dossier de la page (casse indifférente, comme Windows) ; sinon il est oublié, sans fenêtre.
   Une fois l'accès accordé, le dossier est vérifié une fois par ouverture de la page par la même
   sonde qu'à l'installation (un fichier écrit puis relu depuis la page) : une autre copie qui
   porterait le même nom est oubliée, rien n'y est écrit. Les notes (`notes.js`) passent par la
   même vérification et partent sinon dans les Téléchargements, comme sans dossier.
2. **Identifiant** : la ligne de l'écran de bienvenue devient `install-folder`. Le test vérifie
   que le chemin est visible et que la sous-page « Dossier » est intacte.
3. **Dossier parent accepté** (`installer.js`, `findLowsperFolders`) : si le dossier choisi ne
   contient pas `Lowsper.html`, Lowsper regarde ses sous-dossiers, puis, deux niveaux plus bas,
   seulement à travers les dossiers dont le nom contient « lowsper » ou est celui de la page. Les
   dossiers du nom de la page passent en premier ; chacun est vérifié par la sonde ; une ancienne
   version voisine (`Lowsper-3.4.0`) n'est jamais retenue. Parcours borné à 400 éléments : un
   dossier choisi par erreur (Documents) répond tout de suite « mauvais dossier ». Seul le dossier
   trouvé est mémorisé.
4. **Consigne** réécrite, en français et en anglais : « Une fenêtre va s'ouvrir sur vos
   Téléchargements : choisissez le dossier ci-dessus, puis validez. Vous ne le voyez pas ?
   Choisissez celui qui le contient, Lowsper le retrouve. »

**Non changé.** Un seul modèle au premier lancement (§26), confirmé par le mainteneur le
7 novembre 2026.

**Tests.** `npm run test:unit` : recherche depuis le dossier, son parent et Téléchargements, nom de
la page en premier, dossiers sans rapport non parcourus, parcours borné ; accès d'une autre copie
oublié sans fenêtre ; même nom mais autre copie oublié après vérification ; notes jamais écrites
dans une autre copie. `npm run test:welcome` (Chromium) : chemin affiché, sous-page intacte,
dossier parent et double dossier acceptés, ancienne version seule refusée.

**Limites.**
- Choisir Téléchargements donne au navigateur un accord d'écriture sur tout ce dossier, le temps de
  la page. Lowsper n'écrit que dans le dossier trouvé, et seul celui-ci est mémorisé ; la consigne
  invite d'abord à choisir le dossier affiché.
- Non vérifié dans Chrome et Edge du commerce : la fenêtre de choix et la sonde sont simulées dans
  les tests (une page ne peut pas fabriquer un vrai accès à un dossier).

## 39. Étude : son de visio, paroles simultanées, écho, séparation des voix et Kyutai STT (4.2.2)

**Contexte.** Demande du mainteneur : « tout capter », quand deux participants parlent en même temps
ou quand on parle en même temps que le haut-parleur. Piste suggérée : les travaux de Kyutai et de
Neil Zeghidour (Moshi, flux parallèles, transcription en continu). Machine de référence : portable
d'entreprise sans carte graphique (EliteBook 650 G9, 16 Go), Edge ou Chrome, hors ligne après le
premier téléchargement. Toutes les mesures ci-dessous : machine de développement à 4 cœurs, sans
carte graphique, voix de synthèse.

**1. L'instrument de mesure.** Sur le corpus hebdo, Whisper small se trompe sur 41,0 % des mots des
participants au son propre, et sur 34,6 % au son dégradé façon visio (`eval-hebdo.mjs`, une passe
chacun). Les erreurs viennent surtout des voix de synthèse, peu intelligibles, et non de la
compression de la visio : ce corpus ne permet pas de juger un levier propre au son de visio.
Un essai réel du mainteneur (vidéo publique, non versée au dépôt, règle 9) confirme que sur un son
de qualité, les erreurs portent surtout sur le jargon (« IA », « LLM », « carte graphique »,
« RAM », noms de logiciels) : piste du vocabulaire métier, à traiter dans un lot à part.

**2. Corpus « paroles simultanées »** (`tools/test/corpus/make-overlap.py`, graine fixe, sons non
versionnés). 5 min 12, 68 répliques, 30 chevauchements de 1,1 à 5 s, voix Piper du modèle
multi-voix : acquiescements courts pendant une phrase, interruptions, départs simultanés, longs
chevauchements, et vous au micro pendant qu'un participant parle ; répliques témoins des mêmes
voix sans chevauchement. `eval-overlap.mjs` compare les répliques chevauchées aux témoins.

**Mesure de l'existant** (Whisper small, part des mots de chaque réplique retrouvés) :

| Situation | Son propre | Son de visio | Visio, micro sans casque |
|---|---|---|---|
| Réplique seule (témoin) | 92 % | 92 % | 92 % |
| « Oui », « d'accord » dits par-dessus une phrase | 8 % (5 sur 6 perdus) | 8 % | 8 % |
| « Pardon, vas-y » dit en même temps qu'un autre | 0 % (6 sur 6) | 0 % | 0 % |
| Interruption de 1 à 2 s : la personne qui coupe | 80 % | 82 % | 82 % |
| Long chevauchement : la seconde personne | 63 % | 57 % | 57 % |
| Vous au micro pendant qu'un participant parle | 86 % | 86 % | 54 % |

Lecture : sur un son mélangé, Whisper suit la voix dominante ; ce qui se perd, ce sont surtout les
répliques courtes de la seconde voix. Vos propres paroles, sur une piste séparée, sont bien
captées avec un casque. Limite du corpus : le regroupement des voix fusionne les quatre voix de
synthèse en une seule ; l'attribution des répliques chevauchées n'est donc pas mesurable ici.

**3. Écho : correction livrée.** Sans casque, le micro réentend les haut-parleurs. L'anti-écho à la
voix (§15.16) n'agit qu'après 15 s de votre parole « seul au micro » : quelqu'un qui écoute plus
qu'il ne parle n'en bénéficie pas. L'anti-écho par le texte comparait chaque phrase du micro à
**une** phrase des participants (60 % de mots communs) : quand Whisper découpe l'écho autrement,
aucune comparaison n'atteignait le seuil. Elle est désormais comparée à **tout** ce que les
participants ont dit dans les 6 s autour (`transcript.js`, `removeEcho`).

| Corpus avec écho (micro sans casque) | Erreurs sur « Vous », 4.2.1 | 4.2.2 |
|---|---|---|
| Paroles simultanées, son de visio | 118,5 % (4 phrases d'écho restantes) | 48,1 % (aucune) |
| Entretien | 5,8 % | 5,8 % |
| Hebdo | 21,9 % | 21,9 % |

Aucune de vos phrases n'est perdue par la correction : les répliques de « Vous » mal captées sont
les mêmes avant et après, sur les trois corpus. Le reste des erreurs sur « Vous » vient de vos
répliques dites pendant que les participants parlent, mélangées à leur écho dans le micro.

**4. Séparation des voix : gardée à l'étude, non intégrée.** MossFormer2 (Alibaba, deux voix,
16 kHz, Apache 2.0), version ONNX 8 bits de la communauté (`ipsilondev/MossFormer2-SS-16K-ONNX`,
révision `abd8b1268dfded6b0e972ddae4c2dd6a3faf4f8a`, 91 Mo), mesurée dans Chromium avec ONNX
Runtime Web en WebAssembly sur un fil, comme Lowsper (`eval-separation.mjs`) :
- **693 s de calcul pour 35 s de son**, environ 20 fois plus lent que la parole ;
- sur 4 chevauchements, **aucun gain** : la seconde personne a 36 % de ses mots retrouvés, avec
  ou sans séparation (échantillon petit).
Sur une réunion d'une heure avec 5 min de chevauchements, il faudrait de l'ordre d'1 h 40 de calcul
après la réunion. Choix du mainteneur : garder la piste à l'étude (modèle plus léger, ou seulement
les passages qui se chevauchent vraiment), sans rien intégrer.

**5. Kyutai : Moshi, Kyutai STT, Gradium.**
- **Moshi** (conversation « full-duplex », deux flux parallèles, 7 milliards de paramètres) : c'est
  un assistant vocal, pas un transcripteur ; carte graphique de 24 Go en PyTorch selon des copies
  non officielles du dépôt (non vérifié sur le dépôt officiel). Écarté.
- **Gradium** (société de N. Zeghidour et d'autres chercheurs de Kyutai, 2025) : transcription
  par service en ligne payant. Exclu par la contrainte n° 1.
- **Kyutai STT** (`kyutai/stt-1b-en_fr`, 1 milliard de paramètres, français et anglais,
  transcription en continu avec 0,5 s de délai, CC-BY 4.0) : mesuré dans sa version Transformers
  (`stt-1b-en_fr-trfs`, révision `98aadd47649e7ccb89d1e73a6b62bcb31d38170f`), PyTorch sur le
  processeur, 4 fils (`eval-kyutai.py`) :

| Piste des participants | Kyutai STT 1B | Whisper small (Lowsper) |
|---|---|---|
| Hebdo, son propre | 44,2 % d'erreurs | 41,0 % |
| Hebdo, son de visio | 39,0 % | 34,6 % |
| Entretien, son de visio | 40,7 % | 49,4 % |

  Qualité du même ordre ; Kyutai saute des passages entiers (de 35 à 62 s sur l'hebdo). Calcul :
  **1,6 s par seconde de son** avec 4 fils en code natif, donc plus lent que la parole sur cette
  machine. Aucune version officielle pour le navigateur ; un portage de la communauté existe en
  WebGPU (531 Mo), donc avec carte graphique. Écarté pour le portable d'entreprise. Non testé : le
  serveur de transcription en continu de Kyutai (Rust).
- **« Deux canaux »** : Lowsper sépare déjà le micro et le son de la réunion. Le cas qui perd des
  mots est celui de deux participants mêlés dans le **même** canal : aucun modèle à flux parallèles
  ne le règle, il faudrait séparer les voix d'abord (point 4).

**Suite décidée par le mainteneur** (7 novembre 2026) : compte rendu extractif (phrases prononcées
recopiées mot pour mot en haut de la note : décisions, actions, questions ouvertes ; transcript
complet dessous), puis notes rapides pendant la réunion et e-mail de suivi ; un compte rendu rédigé
par une IA locale seulement là où une mesure sur le portable de référence le valide. Pas de
discussion avec la réunion. Téléphone : plus tard. Voir `docs/lots.md`.

**Limites.** Voix de synthèse ; pas de vrai logiciel de visio ; écho simulé à 35 % du volume, sans
l'annulation d'écho du navigateur, qui le réduit sans doute en vrai (non mesuré).

## 40. Compte rendu extractif : décisions, actions, questions ouvertes, recopiées mot pour mot (lot C1)

**Contexte.** Feuille de route du 7 novembre 2026 (§39, `docs/lots.md`) : faire le travail d'un
outil de compte rendu de réunion, sur le PC, hors ligne, sans rien réécrire ni inventer. Lowsper
recopie en haut de la note les phrases prononcées qui portent une décision, une action ou une
question restée ouverte, avec leur horodatage et la personne ; le transcript complet reste dessous,
inchangé. Machine de référence : portable d'entreprise sans carte graphique, 16 Go, Edge ou Chrome.

**Options.**
1. *Règles explicites* sur les formules usuelles (« c'est décidé », « je m'en charge », « on ne
   sait pas encore »...), en français et en anglais. Instantané, hors ligne, vérifiable phrase par
   phrase, aucun modèle à télécharger.
2. *Petit modèle de classification* (de l'ordre de 100 Mo) dans le navigateur. Rien de tel
   n'existe en français et en anglais pour cette tâche sans l'entraîner nous-mêmes, sur des
   données réelles que la contrainte n° 9 exclut. Non retenu pour ce lot.
3. *IA locale qui rédige* : c'est le lot C3, seulement là où une mesure sur le portable de
   référence le valide (§22 : un modèle de résumé local est trop lent et invente).

**Arbitrage : règles explicites (`app/js/extract.js`).** Le texte retenu est toujours une
sous-chaîne exacte d'une réplique (vérifié par les tests) : une erreur de l'outil peut oublier ou
mal ranger une phrase, jamais en fabriquer une. Les deux jeux de règles s'appliquent quelle que
soit la langue parlée.
- *Décision* : formule de choix arrêté (« on garde », « nous retenons », « va pour », « let's go
  with », « we won't »...), date fixée, refus explicite.
- *Action* : engagement à la première personne (« je relance », « je vais », « I'll »), ou tâche
  confiée (« Paul, tu envoies... ? », « could you...? », « you own... »).
- *Question ouverte* : point déclaré non tranché (« on ne sait pas encore », « no answer yet »),
  ou question posée qui reste sans réponse : personne ne répond, la réponse est « je ne sais pas »,
  la personne ajoute elle-même que rien n'est tranché, ou la conversation change de sujet. La
  question est alors recopiée, pas la réplique « je ne sais pas ».
- *Écartés* : hypothèses (« si on avait », « we could »), rappels d'une décision passée (« on
  avait décidé », « last year we decided »), propositions encore discutées (« je propose qu'on »),
  questions techniques ou de politesse (« vous m'entendez ? »), formules sans contenu (« Will do »).
- Récapitulatif de fin de réunion (« pour résumer », « to sum up ») : recopié tel quel.

**Note.** Section « Compte rendu » (« Summary » en anglais) après l'en-tête et l'avertissement,
avant le transcript : une phrase d'avertissement, puis « Décisions », « Actions » et « Questions
ouvertes », chaque ligne au format `- **[00:01:05] Lucie :** « phrase »`. Choix du mainteneur
(7 novembre 2026) : activé par défaut, avec l'interrupteur « Recopier les décisions, actions et
questions en haut de la note » (Paramètres, Notes et compte rendu, `lowsper.opt.highlights`) ;
une catégorie vide est omise, et si rien n'est repéré, une ligne le dit ; dans les modèles de note,
variable `{{compte_rendu}}`, présente dans le modèle par défaut, retirée proprement quand le réglage
est désactivé. Les modèles déjà modifiés par l'utilisateur ne changent pas (contrainte n° 8). Le
réglage est lu au début de la réunion, comme la langue de la note.

**Méthode de mesure.** `tools/test/eval-extract.mjs`, sur des phrases étiquetées à la main selon
un guide écrit avant les règles (`compte-rendu.json`, clé `guide`) :
- *dev* (4 réunions) : servent à écrire les règles ;
- *test* (4 réunions) : écrites avant les règles, mais par le même auteur : pas vraiment aveugles ;
- *aveugle* (6 réunions, `compte-rendu-aveugle.json`) : écrites par un autre rédacteur qui n'a
  vu ni les règles ni le corpus ; mesurées une fois, **puis utilisées pour régler les règles** ;
- *aveugle-2* (6 réunions, `compte-rendu-aveugle-2.json`) : second rédacteur aveugle, contextes
  imposés, mesuré seulement après le réglage, **jamais utilisé pour régler** : c'est le chiffre
  qui fait foi ;
- *indépendant* : corpus hebdo et entretien, écrits avant ce lot pour d'autres mesures (§15, §39),
  annotés sans les modifier.
Chaque corpus est versionné dans un commit à part avant sa première mesure. Une phrase retenue est
« retrouvée » si elle correspond à une phrase étiquetée (même réplique, au moins 60 % des mots en
commun), « fausse » sinon ; les phrases neutres (« Will do ») ne comptent ni comme oubliées ni
comme fausses.

**Mesures, texte exact** (sans reconnaissance vocale) :

| Jeu | Phrases | Retrouvées | Précision | Décisions | Actions | Questions |
|---|---|---|---|---|---|---|
| aveugle, fr, règles avant réglage | 34 | 50 % | 89 % | 5/14 | 8/14 | 4/6 |
| aveugle, en, règles avant réglage | 34 | 53 % | 90 % | 5/14 | 11/14 | 2/6 |
| aveugle, fr, après réglage (vu) | 34 | 91 % | 94 % | 14/14 | 12/14 | 5/6 |
| aveugle, en, après réglage (vu) | 34 | 94 % | 97 % | 13/14 | 14/14 | 5/6 |
| **aveugle-2, fr (jamais vu)** | 33 | **61 %** | **87 %** | 6/11 | 12/15 | 2/7 |
| **aveugle-2, en (jamais vu)** | 33 | **73 %** | **86 %** | 5/11 | 14/15 | 5/7 |
| hebdo et entretien, fr | 8 | 75 % | 75 % | 0/0 | 4/6 | 2/2 |
| dev et test, fr et en | 72 | 100 % | 97 % | 23/23 | 33/33 | 16/16 |

Toutes les phrases retrouvées sont dans la bonne catégorie, sur tous les jeux. Lecture : sur le texte exact de
réunions jamais vues, Lowsper retrouve environ deux phrases sur trois, et neuf phrases retenues sur
dix sont justes. Les actions sont bien couvertes (26 sur 30) ; les décisions le sont mal (11 sur
22), parce qu'elles se disent de mille façons sans formule. L'écart entre le premier corpus aveugle
après réglage (91 à 94 %) et le second (61 à 73 %) mesure ce que valent des règles réglées sur un
corpus : elles s'y adaptent. Le chiffre de dev et test n'est pas une estimation.

**Mesures, de bout en bout** : audio de chaque réunion (voix de synthèse Piper, `make-cr.py`),
rejoué dans la chaîne Lowsper comme en réunion (découpage, Whisper small, distinction des voix),
puis extraction sur ce que Whisper a transcrit (`eval-extract.mjs --transcribe`, puis `--audio`).
Une phrase est retrouvée si la réplique transcrite qui la contient recouvre la réplique étiquetée
et a au moins 50 % de ses mots.

| Jeu | Retrouvées | Précision | Décisions | Actions | Questions | Personne juste | Heure à 3 s près |
|---|---|---|---|---|---|---|---|
| **aveugle-2, fr (jamais vu)** | **52 %** (17/33) | **81 %** | 6/11 | 10/15 | 1/7 | 100 % | 82 % |
| **aveugle-2, en (jamais vu)** | **70 %** (23/33) | **82 %** | 5/11 | 14/15 | 4/7 | 100 % | 96 % |
| aveugle, fr (vu au réglage) | 65 % | 79 % | 10/14 | 10/14 | 2/6 | 100 % | 82 % |
| aveugle, en (vu au réglage) | 85 % | 91 % | 11/14 | 14/14 | 4/6 | 100 % | 90 % |
| hebdo, fr | 38 % (3/8) | 100 % | 0/0 | 1/6 | 2/2 | 100 % | 33 % |

« Personne juste » : vous ou les participants (le canal), la seule attribution vérifiable ici, les
voix de synthèse d'un même modèle Piper étant souvent regroupées (§39). Lecture : la reconnaissance
vocale coûte de l'ordre de 10 points en français et 3 en anglais sur le chiffre de référence ; les
voix de synthèse françaises sont les moins bien reconnues (§39 : 35 à 41 % d'erreurs sur l'hebdo).
Les questions ouvertes souffrent le plus en français (1 sur 7) : quand Whisper perd le point
d'interrogation ou coupe la phrase, la question n'est plus reconnue. Sur l'hebdo, l'heure est
souvent celle d'un long segment qui réunit plusieurs participants (33 % à 3 s près).

**Vitesse.** L'extraction tourne une fois, quand la note est produite en fin de réunion ou
d'import : le chemin du direct n'est pas touché (pas de mesure `npm run bench` avant et après).
Machine de développement à 4 cœurs : 0,8 s pour 11 940 répliques (environ dix heures de réunion),
donc de l'ordre de 0,1 s pour une heure. Textes piégés de 20 000 à 32 000 caractères : 20 ms au
plus par phrase (pas de retour arrière explosif, §33). Non mesuré sur le portable de référence.

**Limites.**
- Voix de synthèse et réunions écrites, en français et en anglais seulement ; pas de vraie
  réunion. Les autres langues parlées n'ont aucune règle : la section dit alors « aucune décision
  repérée ».
- Une phrase est recopiée seule : une action dite en deux temps (« Tu peux t'en occuper ? »,
  « Oui, demain ») ne garde que la phrase qui a le contenu, ou la plus explicite.
- Quand deux participants s'enchaînent sur le son de la réunion sans pause, Whisper peut les
  réunir dans un même segment : la phrase est alors attribuée à la voix et à l'heure de ce segment.
- Les décisions implicites (« ça me va », un silence qui vaut accord) ne sont pas repérées.
- Suite possible, à mesurer d'abord : le lot C3 (IA locale) pourrait reprendre les phrases
  manquées, sur le portable de référence seulement si la mesure le valide.

## 41. Notes rapides pendant la réunion et consigne « e-mail de suivi » (lot C2)

**Contexte.** Feuille de route du 7 novembre 2026 (§39, `docs/lots.md`) : après le compte rendu
extractif (§40), laisser l'utilisateur taper ses propres notes pendant la réunion, et proposer
une consigne « e-mail de suivi » pour « Obtenir un résumé ». Machine de référence : portable
d'entreprise sans carte graphique, 16 Go, Edge ou Chrome, hors ligne. Le direct ne doit pas
ralentir.

**Choix du mainteneur** (7 novembre 2026, sur trois options chacun) :
- *Place dans la note* : une section « Vos notes » (« Your notes ») après le compte rendu et
  avant le transcript, plutôt qu'insérée dans le transcript à son heure (noyée dans le texte) ou
  les deux (doublon).
- *Saisie* : dans la fenêtre agrandie seulement. La mini-fenêtre (248 × 52, tailles mesurées au
  lot R5, §28) ne change pas : l'agrandir le temps de taper demanderait de nouvelles mesures dans
  Chrome et Edge, en partie non vérifiables ici.
- *Heure retenue* : celle de la première frappe, la plus proche du moment dont parle la note,
  plutôt que celle de la validation, décalée de quelques secondes.

**Réalisation.**
- *Données* : `meta.notes`, liste de `{ t, text }` dans le transcript (`transcript.js`, `addNote`,
  `removeNote`, `quickNotes`, `notesSection`). `t` est en secondes depuis le début de la réunion,
  sur la même horloge que les répliques et les pauses (`meetingNow`, temps du contexte audio). Le
  texte tient sur une ligne, espaces réduits, 500 caractères au plus. Gardées dans `meta`, les
  notes sont conservées par la sauvegarde de secours et proposées avec le texte au lancement
  suivant, sans code de plus.
- *Interface* (`Lowsper.html`, `app.js`) : un formulaire « Note rapide » sous les trois gros
  boutons. Entrée ou « Ajouter » valide, Échap efface, le focus reste dans le champ ; la liste
  montre l'heure, le texte et « Retirer » (libellé accessible avec l'heure) ; l'ajout est annoncé
  aux lecteurs d'écran. Une note tapée sans Entrée au moment de « Terminer » ou de « Commencer
  une nouvelle réunion sans arrêter » est ajoutée à la réunion qui se termine : rien de ce qui est
  tapé n'est perdu.
- *Modèles de note* (`notes.js`) : variable `{{notes}}`, placée dans le modèle par défaut juste
  avant le transcript, retirée proprement sans note rapide. Rétrocompatibilité (contrainte n° 8) :
  les deux anciens modèles par défaut (avant et après le lot C1), reconnus au caractère près
  comme jamais modifiés, reçoivent `{{notes}}` avant le transcript ; celui d'avant le lot C1 ne
  gagne pas de compte rendu, comme décidé au §40. Un modèle modifié sans `{{notes}}` reçoit les
  notes à la fin de la note : perdre ce que l'utilisateur a tapé serait pire qu'un emplacement
  imparfait. `{{transcript_complet}}` les contient déjà (pas de doublon).
- *Consigne « E-mail de suivi »* (`email-suivi`, textes dans `i18n.js`) : même structure que les
  consignes du lot R6 (§29 : rôle, contexte, tâche, règles, transcript), même contexte, mêmes
  trois premières règles. La tâche demande l'e-mail que « Vous » enverra aux participants
  (objet, remerciement et objet de la réunion, décisions, actions avec qui, quoi, échéance,
  questions ouvertes, prochaine étape seulement si elle a été fixée, formule de fin sans
  signature) et dit ce qu'est la section « Vos notes ». Règles propres : aucun engagement qui n'a
  pas été pris, ce qu'il faut vérifier entre crochets, ton professionnel et cordial. Ajoutée en
  quatrième position : la consigne par défaut des emplacements reste le compte rendu. Les trois
  consignes existantes ne changent pas.

**Mesures.**
- *Charge du moteur* (`npm run bench`, Whisper small, 25 s de son, machine de développement à
  4 cœurs, sans carte graphique, trois passes chacun) : avant, temps de calcul rapporté à la durée
  du son de 0,450 à 0,473 (médiane 0,462) ; après, de 0,440 à 0,457 (médiane 0,448). Écart dans le
  bruit de mesure. Le banc ne charge que le moteur (`engine.js`), que ce lot ne touche pas ; côté
  interface, aucun travail n'est ajouté à l'arrivée des répliques : la liste des notes n'est
  redessinée qu'à l'ajout ou au retrait d'une note.
- *Coût d'une note* (Node.js 22, même machine, réunion fictive d'une heure à 1 200 répliques) :
  ajout d'une note, sauvegarde de secours comprise, 0,4 ms en médiane, 1 ms au plus ; production
  de la note complète (compte rendu compris) 57 ms sans note rapide, 72 ms avec 200 notes.
- *Bout en bout* (`npm run test:e2e`, Chromium) : note commencée, 3 s d'attente, puis la suite et
  Entrée : l'heure retenue est celle de la première lettre (moins de 1,5 s d'écart) ; la note
  figure dans la note de sa réunion et pas dans celle qui suit ; une note tapée sans Entrée avant
  « Terminer » est gardée. Toutes les autres vérifications du parcours restent vertes.

**Limites.**
- Pas de saisie depuis la mini-fenêtre : il faut revenir à la fenêtre de Lowsper.
- Les notes n'apparaissent pas sur l'écran de fin, seulement dans la note enregistrée et dans ce
  que copie « Obtenir un résumé » (le compte rendu du §40 non plus).
- Non vérifié : la qualité des e-mails rédigés par une IA avec cette consigne (aucun assistant en
  ligne n'est appelé par les tests, contrainte n° 1), et le confort de saisie sur le portable de
  référence pendant une vraie visio.

## 42. Release lancée à la main, et paquet de la 4.3.0 (4.4.0)

**Contexte.** La release 4.3.0 a été publiée sans paquet : `tools/package.json` était resté en
4.2.2, et le workflow « Paquet de release » (§18.1) refuse, à juste titre, un tag différent de
cette version. Le tag ne peut pas être corrigé en place sans déplacer une version déjà publiée.
Par ailleurs, les agents de développement n'ont pas d'outil pour publier une release : ils
peuvent seulement lancer un workflow.

**Options.**
1. Déplacer le tag `v4.3.0` sur un commit corrigé : réécrit une version publiée, que d'autres
   ont pu télécharger. Écarté.
2. Laisser la 4.3.0 sans paquet et publier la 4.4.0 : la 4.3.0 resterait inutilisable telle
   quelle.
3. Ajouter au workflow un lancement manuel (`workflow_dispatch`, champ `tag`). Choix du
   mainteneur (7 novembre 2026).

**Arbitrage : option 3.** Le même workflow sert aux deux cas, avec les mêmes contrôles
(`test/release.mjs`, paquet reproductible).
- *Release absente* : lancée depuis `main` seulement ; la version de `tools/package.json` doit
  être celle du tag et le CHANGELOG doit avoir sa section, dont le texte devient celui de la
  release. La release est créée sur le commit lancé, puis le paquet est joint. Une release créée
  par le jeton du workflow ne relance pas le workflow (règle de GitHub) : pas de double paquet.
- *Release publiée sans paquet* : le paquet est construit depuis son tag, jamais déplacé. Seule
  réparation permise : si `tools/package.json` du tag porte un autre numéro **et** que le
  CHANGELOG du tag a la section de la version voulue, le numéro est corrigé pour la construction.
  Le numéro ne sert qu'au nom du paquet (`release.mjs`) : le contenu est celui du tag.
- *Publication depuis GitHub* : inchangée, toujours stricte.

**Limites.** Le texte d'une release créée à la main est celui du CHANGELOG, en Markdown, sans
retouche. Lancer le workflow demande les droits d'écriture sur le dépôt, comme publier une release.

## 43. Étude : compte rendu rédigé par une IA locale, sur le processeur (lot C3)

**Contexte.** Feuille de route du 7 novembre 2026 (§39, `docs/lots.md`) : un compte rendu rédigé
par une IA locale, **seulement là où une mesure sur le portable de référence le valide**
(portable d'entreprise sans carte graphique, 16 Go, Edge ou Chrome, hors ligne). Le §22 avait
écarté Qwen2.5 (0,5 et 1,5 milliard) : quantifiés, ils ne retrouvaient aucun fait. Depuis, de
nouveaux petits modèles existent en ONNX, et le compte rendu extractif (§40) offre une entrée bien
plus courte que le transcript. Les deux pistes sont mesurées ici, avec le banc du §22.

**Méthode.** `tools/test/eval-summary.mjs`, inchangé sur le fond : Chromium, transformers.js 4.3.0,
WebAssembly sur **un seul fil** comme Lowsper (§2), consigne « compte rendu » de la sonde (§23),
corpus fictif « hebdo » (2 min 40, 8 faits à retrouver), génération déterministe, 600 jetons au
plus. Ajouts de ce lot : dépôt Hugging Face complet en argument, réponse sans phase de réflexion
pour Qwen3 (`enable_thinking: false`, vérifiée par la question de contrôle), relevé des nombres
absents du transcript, et option `--extrait` qui donne au modèle le seul compte rendu extractif de
Lowsper (`Transcript.summary()`, 460 jetons au lieu de 1 060 ; il contient 5 des 8 faits, les
indicateurs chiffrés n'y étant pas). Machine de développement à 4 cœurs, sans carte graphique.

**Modèles essayés** (révisions de `onnx-community`, licences des modèles d'origine) :
- Qwen3 0,6 milliard (`Qwen3-0.6B-ONNX`, révision `58ca03a5e7`, Apache 2.0) : 8 bits (618 Mo),
  4 bits (919 Mo), pleine précision (2,4 Go) ;
- Qwen3 1,7 milliard (`Qwen3-1.7B-ONNX`, révision `3231b522c6`, Apache 2.0) : 8 bits (1,7 Go),
  4 bits (2,1 Go), 4 bits avec activations 16 bits (1,4 Go) ;
- Gemma 3 1 milliard (`gemma-3-1b-it-ONNX`, révision `a58439f400`, licence Gemma, non libre au
  sens de l'OSI : comparaison seulement), 8 bits.

**Mesures.**

| Modèle, précision, entrée | Lecture | Génération | Mémoire de pointe | Faits | Ce que contient le texte |
|---|---|---|---|---|---|
| Qwen3 0,6 Md, 8 bits, transcript | 103 s | 1,6 jeton/s | 4,7 Go | 3/8 | Recopie le transcript au lieu de le résumer, en altérant les chiffres (« quatre-vingt-quatre pour cent » pour 87, « mille et vingt-cent quarante ») |
| Qwen3 0,6 Md, 4 bits, transcript | 116 s | 0,66 jeton/s | 5,7 Go | 4/8 | Quatre pourcentages inventés (20 %, 47,5 %, 67,5 % pour un objectif de 65 %) ; actions écrites comme faites (« ont terminé la migration ») |
| Qwen3 0,6 Md, 8 bits, extrait | 26 s | 2,4 jetons/s | 3,6 Go | 4/8 | Actions écrites comme faites (« Marc a envoyé le chiffrage ») ; thème inventé (« la transition numérique ») |
| Qwen3 0,6 Md, 4 bits, extrait | 31 s | 0,78 jeton/s | 5,4 Go | 4/8 | Date inventée (« le 1er mois ») ; demande de renfort attribuée à Claire au lieu de Sophie ; Julien ajouté aux participants |
| Qwen3 0,6 Md, pleine précision | | | | | Ne se charge pas : `std::bad_alloc` (4 Go de WebAssembly) |
| Qwen3 1,7 Md, 8 bits ; 4 bits activations 16 bits | | | | | Ne se charge pas : `std::bad_alloc` |
| Qwen3 1,7 Md, 4 bits | | | | | Fichier de 2,1 Go non chargé par la page (« Failed to fetch ») |
| Gemma 3 1 Md, 8 bits | | | | | Ne se charge pas : opération `GatherBlockQuantized` absente d'ONNX Runtime en WebAssembly |

Contrôle du banc : à « Quelle est la capitale de la France ? », Qwen3 0,6 Md en 8 bits répond
« La capitale de la France est Paris. », sans phase de réflexion. Aucune requête hors du banc.
« Faits » : critères du §22 (expressions régulières de `app/js/localai.js`) ; ils comptent un
fait présent même si la phrase qui le porte est fausse par ailleurs. Les erreurs de la dernière
colonne sont relevées à la lecture des quatre textes, conservés dans `tools/test/output/summary`
(non versionné).

**Ce que cela dit.**
1. Le seul modèle libre qui tourne dans les limites de Lowsper (WebAssembly, un fil, 4 Go) est
   Qwen3 0,6 milliard quantifié, et **chacun de ses quatre textes contient au moins une fausseté**
   qu'un lecteur prendrait pour vraie : chiffre, date, personne, ou action future décrite comme
   faite. Le §22.2 (point 3) s'applique toujours : un compte rendu qui invente est pire que pas de
   compte rendu.
2. L'entrée courte (compte rendu extractif) divise le temps de lecture par 4 et la mémoire de
   pointe d'un quart, sans rendre le texte fidèle : le modèle reformule mal même des phrases déjà
   choisies.
3. Les modèles de taille supérieure, qui seraient plus fiables, **ne se chargent pas** en
   WebAssembly : la limite n'est pas la vitesse du portable mais la mémoire de WebAssembly. Une
   mesure sur le portable de référence ne changerait pas ce point ; elle ne pourrait que confirmer
   des durées du même ordre (non mesuré là-bas).

**Arbitrage du mainteneur** (7 novembre 2026, sur ces mesures) : **rien n'est intégré**.
« Obtenir un résumé » (consignes pour l'IA choisie par l'utilisateur ou sa DSI) reste la voie
conseillée ; le compte rendu extractif (§40) et les notes rapides (§41) restent ce que Lowsper
produit seul. Le banc et l'option `--extrait` sont gardés pour refaire la mesure quand un modèle
ou un moteur nouveau le justifiera.

**Seule piste restante : l'IA intégrée de Chrome et d'Edge** (option A du §22). Elle tourne hors
de la page, sans la limite de 4 Go de WebAssembly, et la documentation de Chrome annonce un
fonctionnement sur processeur avec 16 Go de mémoire et 4 cœurs, ce qu'a le portable de
référence (non vérifié). Elle se mesure **sur le portable de référence** avec la sonde déjà
livrée (Paramètres, Avancé, IA intégrée du navigateur, §23) : même exemple fictif, mêmes 8 faits.
Un rapport sans invention ouvrirait un lot à part ; sinon, la piste sera close ici.

**Limites.** Un seul corpus fictif de 2 min 40, en français ; génération déterministe ; aucune
mesure sur le portable de référence ni sur WebGPU (pas de carte graphique ici, et le portable de
référence n'en a pas). Le relevé automatique des nombres inventés compte aussi les horodatages
recopiés : seule la lecture des textes fait foi.

## 44. Étude : vocabulaire « IA et informatique » et séparation des voix plus légère

**Contexte.** Feuille de route du 7 novembre 2026 (`docs/lots.md`, lot « Étude »). Deux points
laissés ouverts par le §39 : sur un son de qualité, les erreurs de Whisper portent surtout sur le
jargon de l'IA et de l'informatique (« IA », « LLM », « carte graphique », « RAM », noms de
logiciels, point 1) ; la séparation des voix par MossFormer2 était 20 fois plus lente que la parole
(point 4). Machine de développement à 4 cœurs, sans carte graphique, voix de synthèse.

### 1. Vocabulaire « IA et informatique »

**Options.** Compléter la liste « Informatique et cloud » (`it`), ou créer un treizième domaine.
**Choix du mainteneur** : un nouveau domaine `ia` (« IA et informatique », « AI and computing »),
la liste `it` restant identique (réunions déjà réglées, §35). Contenu (choix du mainteneur) :
termes génériques, plus des langages et logiciels libres très courants (Python, JavaScript,
TypeScript, Linux, Git, PostgreSQL, PyTorch), jamais une marque d'éditeur commercial : exception
à la règle des listes (`CONTRIBUTING.md`), limitée à ce domaine. Les logiciels commerciaux ou
propres à une entreprise passent par les « Mots à reconnaître ». 39 termes en français, 37 en
anglais (`app/js/vocabularies.js`), du plus utile au moins utile ; aucune correction automatique
ajoutée (les déformations vues ci-dessous viennent des voix de synthèse, pas de vraies réunions).

**Mesure.** Corpus `tools/test/corpus/vocab-ia.json` : douze phrases fictives par langue (français :
voix Piper siwis et tom ; anglais : lessac et alan ; piper-tts 1.8.0), 31 occurrences de termes
par langue. Banc `eval-vocab.mjs --corpus=vocab-ia` : contextes construits par les fonctions de
Lowsper (`Vocabulary.alternate`, `Vocabulary.prompt`), terme compté comme mot entier (« IA »
n'est pas trouvé dans « via »), sans tenir compte de la casse ni des accents. Whisper small.

| Listes cochées | Français : termes | Français : erreur par mot | Anglais : termes | Anglais : erreur par mot |
|---|---|---|---|---|
| Aucune | 15/31 | 23,4 % | 29/31 | 6,8 % |
| Informatique et cloud (seule possibilité avant ce lot) | 16/31 | 24,1 % | 29/31 | 5,1 % |
| IA et informatique | **24/31** | **13,9 %** | 30/31 | 3,4 % |
| IA + informatique et cloud | 23/31 | 16,1 % | 30/31 | 3,4 % |
| IA + informatique + cybersécurité | 22/31 | 16,8 % | 30/31 | 3,4 % |

Termes encore manqués en français avec la liste : « carte graphique » (« 100 quart de
graphique »), « gigaoctet » (« gigactets »), « API » (« l'appi »), « Git » et « PostgreSQL »
(« le dépogis et la base posture SQL »), « AI Act » et « machine learning », prononcés à la
française par la voix de synthèse. En anglais, seul « PostgreSQL » reste manqué.

**Lecture.** En français, la liste corrige la moitié des termes manqués et divise presque par deux
l'erreur par mot de ces phrases ; en anglais, Whisper connaît déjà ce jargon, le gain est faible.
Cocher d'autres listes avec celle-ci coûte un ou deux termes (place partagée, §35).

**Direct.** Aucune ligne de code du chemin du direct ne change : le domaine est une donnée de plus,
et le contexte reste plafonné à 200 jetons comme avec les douze autres listes. Pas de mesure
`npm run bench` pour ce point (rien à comparer).

**Limites.** Phrases et liste écrites ensemble (corpus de réglage, pas à l'aveugle) ; une mesure
par condition ; voix de synthèse, dont la prononciation des sigles anglais en français est
approximative. Non vérifié : de vraies réunions, et le portable de référence.

### 2. Séparation des voix plus légère que MossFormer2

**Candidat.** ConvTasNet (Asteroid, 5 066 929 paramètres, 20 Mo en 32 bits, deux voix, 16 kHz),
entraîné sur Libri2Mix « sep_clean » (`JorisCos/ConvTasNet_Libri2Mix_sepclean_16k`, révision
`e1ef95ab7a037950f3a606b9a56760cf94701d3d`, licence **CC-BY-SA 4.0**). Exporté en ONNX par
`tools/test/export-convtasnet.py` (poids lus avec `torch.load(weights_only=True)`, aucun code du
fichier exécuté). Mesuré par `eval-separation.mjs --model=convtasnet`, dans les mêmes conditions
que MossFormer2 : Chromium, ONNX Runtime Web en WebAssembly, un seul fil, puis Whisper small sur
le mélange et sur chaque piste.

**Corpus.** « Paroles simultanées » (§39), régénéré : les sons n'étant pas versionnés et
`make-overlap.py` ne retombant pas au centième près sur `simultane.truth.json` du dépôt
(bibliothèques de synthèse d'une autre version), les deux modèles sont mesurés sur le **même** son
régénéré ; le fichier du dépôt n'est pas modifié. 24 chevauchements côté participants (le §39 en
mesurait 4 avec MossFormer2), découpés aux bornes connues des répliques, plus 0,5 s.

**Mesures** (part des mots de chaque personne retrouvés ; « séparé » : la meilleure des deux pistes ;
« même piste » : les deux personnes dans la même piste, séparation ratée).

| Son propre, 24 cas | Mélange, 2e personne | ConvTasNet, 1re / 2e | MossFormer2, 1re / 2e | Même piste (CT / MF) |
|---|---|---|---|---|
| « Oui », « d'accord » par-dessus une phrase (6) | 8 % | 83 % / 8 % | 88 % / 22 % | 5 / 0 |
| « Pardon, vas-y » en même temps (6) | 0 % | 79 % / 6 % | 88 % / 0 % | 2 / 1 |
| Interruption de 1 à 2 s (6) | 70 % | 82 % / 78 % | 90 % / 92 % | 3 / 0 |
| Long chevauchement (6) | 25 % | 87 % / **94 %** | 89 % / **95 %** | 0 / 0 |
| Tous (1re personne au mélange : 87 %) | 26 % | 83 % / 46 % | 89 % / 52 % | 10 / 1 |

Son de visio (ConvTasNet seul) : seconde personne 31 % au mélange, 45 % séparée ; longs
chevauchements 42 % puis 82 %, interruptions 75 % puis 90 %, courtes répliques inchangées.

| Calcul (WebAssembly, un fil) | Chargement | Par seconde de son | Une heure avec 5 min de chevauchements |
|---|---|---|---|
| ConvTasNet, 20 Mo | 1,1 à 1,7 s | **0,52 s** | environ 2 min 40 |
| MossFormer2, 91 Mo | 7,0 s | 18,3 s | environ 1 h 30 |

**Lecture.**
1. ConvTasNet est **35 fois plus rapide** que MossFormer2, plus vite que la parole sur un fil, et
   récupère presque autant : la seconde voix d'un long chevauchement passe de 25 % à 94 % de ses
   mots retrouvés (MossFormer2 : 95 %).
2. Les répliques courtes (« oui », « pardon, vas-y »), la vraie perte du §39, ne sont **pas**
   récupérées par ConvTasNet, et seulement un peu par MossFormer2 (22 % pour les acquiescements).
3. ConvTasNet laisse plus souvent les deux voix dans la même piste (10 cas sur 24, contre 1) et
   abaisse un peu la première personne (87 % à 83 %) : il faudrait garder le mélange pour elle.
4. Sur 24 cas, MossFormer2 apporte un gain que l'échantillon de 4 cas du §39 ne montrait pas
   (c'étaient des acquiescements).

**Arbitrage proposé : rien n'est intégré dans ce lot.** Une intégration demande trois briques non
mesurées ici : repérer les passages qui se chevauchent sans connaître les bornes (le banc les
découpe aux bornes vraies), attribuer chaque piste séparée à la bonne voix, et fusionner le texte
des pistes avec celui du mélange sans doublon. Il faudrait aussi vérifier que la licence
CC-BY-SA 4.0 des poids peut être distribuée avec Lowsper (MIT) : **non vérifié**. ConvTasNet est
le bon candidat pour un lot à part, après la réunion (2 à 3 min de calcul par heure) avant d'être
tenté en direct.

**Limites.** Voix de synthèse françaises, alors que ConvTasNet a été entraîné sur de l'anglais lu ;
bornes des chevauchements connues ; MossFormer2 mesuré sur le son propre seulement (1 h 06 de
calcul) ; Whisper small exécuté dans Node pour les pistes ; machine de développement, pas le
portable de référence (non vérifié). Le chemin du direct ne change pas.

## 45. Paquet de distribution : fichiers à la racine du zip (4.5.0)

**Contexte.** Retour du mainteneur : en dézippant `Lowsper-X.Y.Z.zip`, on obtenait deux dossiers du
même nom l'un dans l'autre (`Lowsper-4.2.1\Lowsper-4.2.1\Lowsper.html`). Cause : le paquet du
§18.1 rangeait tous les fichiers dans un dossier `Lowsper-X.Y.Z/`, et « Extraire tout » de Windows
crée déjà un dossier du nom du zip. Objectif : dézipper, double-cliquer sur `Lowsper.html`, le moins
d'actions possible.

**Options.**
| Option | Verdict |
|---|---|
| Garder le dossier dans le zip, et l'expliquer dans le guide (ce que faisait la 4.2.1) | Une étape de plus à comprendre pour chaque utilisateur. Écarté. |
| **Fichiers à la racine du zip** | **Retenu.** « Extraire tout » donne `Lowsper-X.Y.Z\Lowsper.html`. |
| Paquet avec le modèle déjà installé (environ 270 Mo, zéro téléchargement) | Proposé ; choix du mainteneur : un seul paquet, léger. Reste possible pour une DSI (`docs/deploiement.md`). |

**Ce qui change.** `tools/release.mjs` : noms des fichiers du zip sans préfixe (`entryName`). Le
paquet reste reproductible (§18.1) : 40 fichiers, 22,9 Mo pour la 4.5.0. Test `test/release.mjs` :
`Lowsper.html` et `app/` à la racine, aucun dossier `Lowsper-` autour. Vérifié : le zip extrait par
`unzip` dans un dossier `Lowsper-4.5.0` s'ouvre dans Chromium sur l'écran de bienvenue, sans erreur
ni requête réseau. La recherche du dossier Lowsper depuis un dossier parent (§38) est gardée : elle
sert encore aux copies d'anciennes versions.

**Limite.** Un outil qui extrait « ici », sans créer de dossier, répand les fichiers dans le dossier
courant (Téléchargements) : non vérifié avec les outils d'archive autres que celui de Windows,
et le guide conseille « Extraire tout ». Comportement de « Extraire tout » de Windows non revérifié
sur le portable de référence (non vérifié).
