# Lowsper

[![CI](https://github.com/PercyaDJ/Lowsper/actions/workflows/ci.yml/badge.svg)](https://github.com/PercyaDJ/Lowsper/actions/workflows/ci.yml)
[![Licence MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)
[![Dernière version](https://img.shields.io/github/v/release/PercyaDJ/Lowsper?label=version)](https://github.com/PercyaDJ/Lowsper/releases/latest)

**Transcription de réunions 100 % locale, dans le navigateur, sans rien installer.**
Lowsper capte votre micro et le son de la réunion (Teams, Zoom, Meet...), transcrit en direct avec
Whisper, distingue les intervenants, et vous donne à la fin un transcript Markdown horodaté, prêt à
être confié à une IA pour rédiger le compte rendu. Ni le son ni le texte ne quittent l'ordinateur.

*English summary: [README.en.md](README.en.md).*

![Lowsper pendant une réunion fictive : transcript en direct, niveaux du micro et des participants](docs/images/enregistrement.png)

## Pour qui, pour quoi

- **Vous prenez des notes en réunion** et préférez écouter : Lowsper écrit, vous gardez le fil.
- **Vous travaillez sur un poste d'entreprise** où l'on ne peut rien installer : Lowsper est un
  simple fichier HTML ouvert dans Edge ou Chrome, sans exécutable, sans droits d'administrateur.
- **Vos réunions sont confidentielles** : tout est calculé sur le poste. La page interdit
  techniquement toute connexion, sauf le téléchargement initial du modèle (voir
  [SECURITY.md](SECURITY.md)).

Ce que Lowsper fait :
- transcription **en direct** du micro (« Vous ») et du son partagé de la visio (« Participants ») ;
- **intervenants distingués** automatiquement (Intervenant 1, 2, 3...), renommables à la fin ;
- **glossaire** et **vocabulaires métier** pour bien écrire vos sigles et noms propres, corrections
  de mots retenues d'une réunion à l'autre ;
- **profils de sortie** : la note arrive directement dans votre base de notes (type Obsidian),
  avec son modèle, ses propriétés et ses liens `[[Nom]]`, un profil par contexte ;
- **mini-fenêtre** toujours visible pendant la visio, **réunions enchaînées** sans temps mort ;
- **import de fichiers audio** (dictaphone, téléphone, enregistrement fait ailleurs), même de
  plusieurs heures, avec le même moteur que le direct ;
- **rien n'est perdu en silence** : passage en échec relancé, parole manquée rattrapée en fin de
  réunion, couverture indiquée en tête du transcript.

## Pourquoi Lowsper plutôt qu'un autre outil

| | Services de transcription en ligne | Applications de dictée locales | **Lowsper** |
|---|---|---|---|
| Où part le son | Sur les serveurs du service | Reste sur le poste | **Reste sur le poste** |
| Installation | Compte, parfois extension ou application | Exécutable à installer | **Aucune : un fichier HTML** |
| Son de la visio (les autres participants) | Oui, souvent via un robot invité | Généralement micro seul | **Oui, via le partage d'écran** |
| Intervenants, horodatage, Markdown | Variable | Rarement | **Oui** |
| Poste d'entreprise verrouillé | Souvent bloqué par la politique de sécurité | Souvent bloqué (exécutable) | **Fonctionne dans Edge ou Chrome** |

Lowsper n'est pas un outil de dictée (il n'écrit pas dans vos applications) : c'est un greffier de
réunion qui travaille hors ligne.

## Installation et utilisation

1. **Téléchargez** la dernière version : page [Releases](https://github.com/PercyaDJ/Lowsper/releases/latest),
   fichier `Lowsper-X.Y.Z.zip` (environ 23 Mo ; son empreinte SHA-256 est publiée à côté).
   **Dézippez-le** où vous voulez (clic droit, « Extraire tout »), par exemple dans Documents.
2. **Double-cliquez sur `Lowsper.html`**. Il s'ouvre dans votre navigateur (Edge ou Chrome).
   Si un autre navigateur s'ouvre : clic droit sur le fichier, « Ouvrir avec », Microsoft Edge.
3. **Premier lancement uniquement** : cochez le ou les modèles voulus (Whisper small est coché par
   défaut), cliquez sur « Installer », sélectionnez le **dossier Lowsper** (celui qui contient
   `Lowsper.html`) et acceptez que Lowsper y enregistre des fichiers. Le téléchargement (environ
   250 Mo) prend une à quelques minutes, la page redémarre toute seule à la fin.
4. Dans les **paramètres** (roue crantée en haut à droite), cochez votre **vocabulaire métier**
   (cybersécurité, informatique, gestion de projet) et remplissez une fois pour toutes le champ
   **« Sigles et noms propres »** avec le vocabulaire de vos réunions (ex. `Ombrelune, projet Atlas,
   Mme Durand`). Tout est mémorisé, et copié dans le dossier Lowsper pour survivre à un nettoyage
   du navigateur. Donnez aussi un **nom à chaque réunion** (« Entretien Ombrelune ») :
   Lowsper le fournit au moteur, les noms propres qu'il contient sont alors bien écrits.
5. **Prévenez les participants** que la réunion est transcrite.
6. Cliquez sur **« Démarrer l'enregistrement »** :
   - le navigateur propose un **partage d'écran** : choisissez l'écran entier (ou l'onglet de la
     réunion) et **cochez « Partager l'audio »**. Seul le son est utilisé, rien n'est filmé ;
   - autorisez le **micro**.
   Lowsper se réduit aussitôt en **mini-fenêtre** : une barre d'une ligne toujours visible (durée,
   niveaux, pause, fin), comme un appel réduit. La flèche affiche la dernière phrase.

   ![La barre réduite : durée, niveaux, pause, mini-fenêtre, réunion suivante, fin](docs/images/barre.png)
7. En fin de réunion, cliquez sur **« Terminer »** (carré rouge). Le fichier `.md` est enregistré
   dans vos Téléchargements (ou le dossier de votre profil). Nommez les intervenants si vous le
   souhaitez ; **« Copier pour une IA »** copie la note précédée de la consigne choisie (compte
   rendu de réunion, synthèse d'appel, liste d'actions, ou la vôtre), à coller dans l'assistant
   de votre choix.

![Écran de fin d'une réunion fictive : intervenants nommés, aperçu du transcript Markdown](docs/images/fin.png)

*Captures faites sur une réunion entièrement fictive (voix de synthèse), sur la machine de
développement, lente : l'indicateur « Charge du moteur » y dépasse 100 %. Elles se régénèrent avec
`node tools/test/screenshots.mjs`.*

Conseils :
- Un **casque** donne un meilleur résultat (le micro ne réentend pas les participants). Sans
  casque, Lowsper reconnaît votre voix et retire à la fin les phrases du micro qui sont l'écho des
  haut-parleurs.
- Gardez l'onglet Lowsper ouvert pendant la réunion (il peut être en arrière-plan).
- Si le navigateur se ferme pendant une réunion, le texte déjà transcrit est proposé au lancement suivant.

### Transcrire un enregistrement fait ailleurs

Un dictaphone, un téléphone, une réunion enregistrée par un autre outil : sur l'écran d'accueil,
cliquez sur **« Transcrire un fichier »**, ou glissez un ou plusieurs fichiers dans la page.

- Formats : **WAV, MP3, M4A/AAC, OGG/Opus, WebM**, de quelques secondes à plusieurs heures. Les
  autres formats que le navigateur sait lire (FLAC par exemple) sont acceptés jusqu'à 25 Mo.
- Même chaîne que le direct : détection de parole, intervenants distingués, glossaire,
  vocabulaires et corrections retenues. Le champ « Personnes » indique le nombre de voix de
  l'enregistrement ; le nom de la réunion vaut pour un fichier seul.
- Une barre indique l'avancement et le temps restant estimé ; « Annuler » arrête proprement.
  Chaque transcript arrive dans vos Téléchargements dès que son fichier est terminé, daté du jour
  de l'enregistrement quand le fichier le précise.
- Le fichier est lu par morceaux depuis son emplacement, jamais copié ni envoyé ; le son décodé
  n'est jamais écrit sur le disque.

![Transcription de deux fichiers fictifs : avancement, file d'attente, annulation](docs/images/import.png)

### Envoyer la note dans votre base de notes : les profils

Un **profil de sortie** dit où et sous quelle forme arrive la note d'une réunion. Créez-en autant
que de contextes (« Personnel », « Travail »...) dans les paramètres, section **« Profils de
sortie »**, puis choisissez le profil sur l'écran d'accueil avant la réunion.

- **Dossier de destination** : choisi une fois (par exemple le dossier de votre base Obsidian).
  La note y est écrite dès la fin de la réunion ; sans dossier, elle va dans vos Téléchargements.
- **Nom du fichier** à variables, par exemple `{{date}} {{titre}}` ; les caractères interdits par
  Windows sont retirés d'office. Un nom déjà pris reçoit « (2) » : aucune note n'est écrasée.
- **Propriétés en tête de note** (front matter YAML) : date, durée, intervenants, source,
  modèle, étiquettes et champs libres (`projet: Atlas`).
- **Modèle de note** éditable, avec des variables (`{{titre}}`, `{{date}}`, `{{intervenants}}`,
  `{{transcript}}`... liste complète dans les paramètres).
- **Liens** : les intervenants que vous nommez peuvent être écrits `[[Nom]]`, comme des liens
  entre notes.
- Après la réunion, chaque correction (intervenant nommé, mot corrigé) **met à jour la note** du
  dossier, toute seule.
- Le profil **« Par défaut »** garde le format classique de Lowsper, dans les Téléchargements :
  rien ne change pour qui ne configure rien.

![Éditeur de profils dans les paramètres : nom, dossier, nom de fichier, propriétés, étiquettes](docs/images/profils.png)

Attention : si ce dossier est synchronisé par un autre outil (stockage en ligne, synchronisation
de votre base de notes), la note quittera l'ordinateur par cet outil. Pour des réunions
confidentielles, choisissez un dossier qui reste sur le poste.

Les profils sont conservés avec vos réglages (y compris dans `app\reglages.txt`). L'accès au
dossier, lui, est un accord donné au navigateur : s'il est oublié ou doit être redonné, l'écran
d'accueil le signale et un clic suffit.

Déploiement sur un parc (DSI, RSSI) : voir [docs/deploiement.md](docs/deploiement.md).

### Interface en français ou en anglais

Lowsper s'affiche en français si le navigateur est en français, en anglais sinon. Pour changer :
paramètres, rubrique **Affichage**, **Langue de l'interface**. Le choix est gardé avec vos
réglages, y compris dans `app\reglages.txt`. La langue se change entre deux réunions, pas pendant.

![Paramètres en anglais : rubrique « Display », thème et langue de l'interface](docs/images/langue.png)

La note suit la langue de l'interface au moment où la réunion commence :
- **en français**, elle est identique à celle des versions précédentes, au caractère près ;
- **en anglais**, son en-tête et ses libellés sont traduits (« Speaker 1 », « You »...) et le
  fichier s'appelle `meeting_...md`.

Dans un profil avec modèle de note, les noms des variables (`{{titre}}`, `{{duree}}`...) et les
propriétés écrites en tête de note (`duree:`, `intervenants:`...) restent les mêmes dans les deux
langues : un modèle ou une recherche dans votre base de notes ne casse pas si vous changez de
langue. Les consignes fournies pour « Copier pour une IA » existent dans les deux langues ; une
consigne que vous avez modifiée n'est jamais changée.

## À quoi ressemble le transcript

```markdown
# Transcript de réunion : Point hebdo du centre de service

- **Date** : jeudi 5 novembre 2026
- **Horaires** : 09:04 à 09:05 (2 min)
- **Sources** : micro (« Vous »), audio partagé (« Participants »)
- **Participants** : 6 personnes (vous compris)
- **Langue** : français
- **Transcription** : Whisper small, exécuté localement par Lowsper (hors ligne)
- **Couverture** : toute la parole détectée a été transcrite
- **Vocabulaire de référence** (sigles et noms propres attendus) : RSSI, SLA, ITSM, ServiceNow, ...

> Transcription automatique : elle peut contenir des erreurs de reconnaissance. [...]

## Transcript

**[00:00:01] Claire :** Bonjour à tous, on démarre l'hebdo du centre de service. [...]

**[00:00:15] Julien :** Cette semaine, on a reçu 1240 tickets dans ServiceNow. [...]
```

## Questions fréquentes

**Lowsper s'affiche en anglais alors que je le veux en français (ou l'inverse).**
Lowsper prend la langue du navigateur. Ouvrez les paramètres (roue crantée), rubrique
« Affichage » (« Display » en anglais), et choisissez la langue de l'interface. La langue des
réunions, elle, se règle à part : « Langue parlée ».

**Le téléchargement du modèle échoue au bureau.**
Le réseau de l'entreprise bloque peut-être Hugging Face. Faites l'installation depuis un autre
réseau (partage de connexion du téléphone, domicile), ou copiez le dossier Lowsper d'un collègue
qui l'a déjà installé : le modèle est dedans (`app/models`).

**Beaucoup de mots incohérents sur les sigles de mon métier (« l'NSI », « BIOCRM »...).**
Cochez le vocabulaire métier correspondant dans les paramètres et ajoutez vos propres termes au
glossaire : sur notre entretien de test en cybersécurité, les sigles bien écrits passent de 6 à 13
sur 35. Le son d'une visio est compressé : Whisper small y fait nettement plus d'erreurs que sur le
micro. Sur un PC équipé d'une carte graphique, le modèle « large-v3 turbo » est bien plus précis.

**Quel modèle choisir ?**
- « Whisper small » (recommandé, 250 Mo) : bon compromis, fonctionne sur tous les PC.
- « Whisper small (carte graphique) » et « Whisper large-v3 turbo » (le plus précis, 760 Mo) :
  utilisent la carte graphique, proposés seulement si le PC en a une compatible.
- « Whisper base » (80 Mo) : pour un PC ancien.
Un modèle plus précis n'est pas plus rapide. Pendant la réunion, l'indicateur « Charge du moteur »
doit rester sous 100 % ; sinon, installez un modèle plus rapide (paramètres, « Installer ou ajouter des modèles »). Plusieurs
modèles peuvent être installés en une fois ; un sélecteur apparaît alors dans les paramètres. Un
modèle « carte graphique » peut être installé même sur un PC sans carte compatible, pour copier
ensuite le dossier Lowsper vers un PC équipé.

**Mes sigles et réglages ont disparu après avoir fermé le navigateur.**
Beaucoup de postes d'entreprise effacent les données du navigateur à la fermeture. Lowsper en garde
une copie dans son dossier (`app\reglages.txt`) et la restaure tout seul au lancement suivant.
Il faut avoir autorisé Lowsper une fois à écrire dans le dossier : c'est fait à l'installation du
modèle, sinon via le bouton « Conserver mes réglages dans le dossier Lowsper » des paramètres.

**Des mots sont mal compris (noms de projets, de clients, sigles maison).**
Whisper ne peut pas connaître votre jargon. À la fin de la réunion, utilisez « Corriger un mot mal
reconnu » : le mot est corrigé partout, et Lowsper retient la correction pour les réunions
suivantes. La liste « À vérifier » propose les noms propres douteux : un clic suffit pour commencer.
Si vous connaissez déjà les déformations, entrez-les à l'avance dans les paramètres (« Mots que
Whisper déforme », ex. `Kalmar` → `CALMAR`).

**J'ai enregistré une réunion avec mon téléphone. Combien de temps pour la transcrire ?**
Lire le fichier est rapide, même pour plusieurs heures : sur notre machine de test, lente, 3 h se
lisent en 20 à 30 s (MP3, M4A) et en moins de 2 min (OGG). C'est la transcription qui prend le
temps : le même calcul qu'en direct, avec le renfort de moteurs de votre réglage de puissance,
puisque le PC n'est pas occupé par une visio. La barre d'avancement affiche une estimation après quelques
secondes ; le test de vitesse des paramètres donne un ordre de grandeur pour votre PC.

**J'utilise Obsidian (ou une autre base de notes en Markdown).**
Créez un profil, choisissez comme dossier celui de votre coffre (ou un sous-dossier, comme
`Réunions`), cochez les propriétés et les liens `[[Nom]]` : la note arrive dans le coffre à la fin
de la réunion, avec ses propriétés lisibles par Obsidian, et les intervenants que vous nommez
renvoient vers leurs notes.

**Ma note est partie dans les Téléchargements et pas dans mon dossier.**
Le navigateur demande votre accord pour écrire dans un dossier, et ne peut le faire qu'après un
clic. Sur l'écran de fin, « Enregistrer aussi dans le dossier » règle la question ; pour l'éviter,
cliquez sur « Autoriser maintenant » sur l'écran d'accueil avant la réunion. Si le navigateur a
effacé ses données (fréquent sur un poste d'entreprise), il faut désigner le dossier à nouveau.

**Comment obtenir un compte rendu ?**
Sur l'écran de fin, choisissez une consigne à côté de « Copier pour une IA », cliquez, puis collez
dans l'assistant d'IA autorisé par votre entreprise. Trois consignes sont fournies (compte rendu de
réunion, synthèse d'appel, liste d'actions) ; modifiez-les ou créez les vôtres dans les paramètres,
section « Consignes pour l'IA », et rattachez-en une à chaque profil. Attention : coller le
transcript dans un assistant en ligne le fait sortir de l'ordinateur ; c'est votre choix, pas celui
de Lowsper.

**Lowsper peut-il résumer lui-même la réunion, sans rien envoyer ?**
Pas encore. Un petit modèle de langage dans la page a été mesuré : il invente des faits en
français (`decision.md` §22). Chrome et Edge récents embarquent parfois leur propre modèle ; pour
savoir si c'est le cas sur votre PC, ouvrez les paramètres, section « IA intégrée du navigateur
(expérimental) », et cliquez sur « Vérifier ce PC ». Rien n'est téléchargé et aucun de vos
transcripts n'est lu. Si le navigateur répond oui, « Essayer sur une réunion fictive » montre ce
que vaut le résultat (le navigateur peut alors devoir télécharger son modèle, après votre
accord). « Copier le rapport » produit un texte sans aucune donnée réelle, que vous pouvez joindre
à une [issue](https://github.com/PercyaDJ/Lowsper/issues/new/choose) pour aider à décider de la
suite.

![La sonde de l'IA intégrée dans les paramètres (réponse simulée d'un navigateur qui peut télécharger son modèle)](docs/images/sonde-ia.png)

**Mon fichier est refusé.**
Lowsper lit le contenu du fichier, pas son extension. Formats lus en entier : WAV, MP3, M4A/AAC,
OGG/Opus, WebM. Un autre format (FLAC, Vorbis, WMA...) n'est accepté que jusqu'à 25 Mo, et
seulement si le navigateur sait le lire : convertissez-le en MP3 ou M4A, ou découpez-le. Un
fichier abîmé (enregistrement interrompu) est lu jusqu'à l'endroit où il est intact.

**J'enchaîne plusieurs réunions.**
Bouton « Réunion suivante » (icône lecture-fin, aussi dans la mini-fenêtre) : la réunion en cours
se termine et la suivante commence aussitôt, sans repartager l'écran. La réunion terminée est
enregistrée dans vos Téléchargements dès qu'elle est prête, chacune dans son propre fichier.

**Il manque des passages dans le transcript.**
Regardez la ligne « Couverture » en haut du transcript : elle dit si toute la parole détectée a
été transcrite. Pendant la réunion, Lowsper garde le son en mémoire : en fin de réunion, il le
relit et transcrit toute parole qui aurait échappé au direct (ligne « Rattrapage »). Si un problème
persiste, téléchargez le « Journal technique » sur l'écran de fin (aucun texte de réunion dedans)
et transmettez-le. Si le moteur échoue sur un passage, Lowsper le relance sur un moteur neuf ; s'il
échoue encore, le passage est signalé à sa place et un bouton « Réessayer ces passages » apparaît
sur l'écran de fin. Rien n'est perdu en silence.

**Les boutons de la mini-fenêtre ne répondent pas.**
Utilisez le bouton « Terminer la réunion » de la page principale de Lowsper : il fonctionne même si
la mini-fenêtre est bloquée. Le texte déjà transcrit n'est jamais perdu (il est proposé au
lancement suivant si le navigateur se ferme).

**Le modèle est retéléchargé à chaque fois.**
Vérifiez que Lowsper n'est pas ouvert directement depuis le zip (clic droit sur le zip, « Extraire
tout »). Après avoir téléchargé une nouvelle version de Lowsper, copiez le dossier `app\models`
de l'ancienne version dans la nouvelle au lieu de retélécharger (et le fichier `app\reglages.txt`,
qui contient vos sigles et préférences).

**Lowsper va-t-il ralentir mon PC pendant les réunions ?**
Non, par défaut (puissance « Équilibrée ») il n'utilise qu'environ un quart du processeur, un peu
plus seulement quand il prend du retard. Si la réunion est très dense, une « voie rapide » affiche
quand même le texte en direct (en italique), puis le retranscrit précisément dès que possible.
Réglable dans paramètres : Économe, Équilibrée, Maximale.

**Lowsper trouve trop ou pas assez d'intervenants.**
Indiquez le nombre de personnes (vous compris) sur l'écran d'accueil, à côté du nom de la réunion :
c'est le réglage le plus fiable (2 pour un entretien en tête-à-tête). Sans indication, Lowsper estime lui-même le nombre de voix (12 au
maximum). Deux voix très proches peuvent être regroupées : renommez-les à la fin de la réunion.

**Mon PC est-il assez rapide ?**
paramètres, « Mesurer la vitesse de ce PC » (fait automatiquement la première fois) : Lowsper indique
la charge estimée pour une réunion où l'on parle sans arrêt, et conseille un modèle plus rapide si
besoin.

**Lowsper peut-il reconnaître mes collègues d'une réunion à l'autre ?**
Oui, si vous l'activez (paramètres, « Mémoriser les voix », désactivé par défaut). Nommez les
intervenants à la fin d'une réunion : aux réunions suivantes, leurs voix sont reconnues. Une
empreinte vocale est une donnée biométrique : demandez l'accord des personnes. Les empreintes
restent sur votre poste, sont effacées automatiquement après 1, 3 ou 6 mois, et peuvent être
effacées à tout moment.

**Comment garder Lowsper visible pendant la visio ?**
Par défaut, Lowsper se réduit en mini-fenêtre dès le démarrage : une barre de 300 x 48 pixels,
toujours au premier plan, à placer où vous voulez. Si le navigateur ne l'a pas ouverte (il exige
parfois un clic), utilisez le bouton « Mini-fenêtre ». Vous pouvez aussi réduire la hauteur de la
fenêtre de Lowsper : elle devient la même barre. Réglable dans les paramètres.

**Le partage d'écran ne propose pas « Partager l'audio ».**
Sur Windows, choisissez « Écran entier » : la case « Partager aussi l'audio du système » apparaît.
Pour une réunion dans le navigateur, partager l'onglet de la réunion fonctionne partout.
Sans son partagé, Lowsper continue avec le micro seul.

**Mon PC va-t-il chauffer ?**
Le silence n'est jamais traité, la parole est regroupée en blocs pour limiter les calculs, et
chaque voix utilise un seul cœur du processeur. Avec Whisper small, attendez-vous à ce qu'un cœur
travaille une bonne partie de la réunion ; le reste du PC reste disponible. Voir `decision.md` §6.

**Mes données partent-elles quelque part ?**
Non. La seule connexion autorisée est le téléchargement du modèle depuis Hugging Face au premier
lancement ; tout autre site est bloqué par la page elle-même. L'audio n'est jamais enregistré
sur le disque : il est seulement gardé en mémoire pendant la réunion (filet de sécurité contre les
pertes) et effacé en quittant la page. Seul le texte du transcript en cours est sauvegardé dans le navigateur (pour la
récupération en cas de plantage), et effacé à la réunion suivante.

**Comment passer en thème clair ou sombre ?**
Lowsper suit le thème de votre système. Le bouton lune (ou soleil) en haut à droite bascule
d'un clic ; « Paramètres », « Affichage » permet de revenir au choix automatique.

**Quel navigateur ?**
Microsoft Edge ou Google Chrome récents. Firefox ne sait pas installer le modèle (il n'a pas
l'accès aux dossiers) et ne capte pas le son d'un partage d'écran : il ne fonctionne qu'en micro
seul, dans un dossier Lowsper où le modèle a déjà été installé depuis Edge ou Chrome.

**J'utilise Brave : « Ce navigateur ne permet pas d'enregistrer le modèle ».**
Brave bloque par défaut l'écriture dans un dossier, dont Lowsper a besoin pour installer le
modèle et pour écrire les notes d'un profil. Deux solutions :
1. l'autoriser : ouvrez `brave://flags`, cherchez « File System Access », choisissez « Enabled »,
   puis relancez Brave ;
2. ou installer le modèle une fois avec Microsoft Edge (clic droit sur `Lowsper.html`, « Ouvrir
   avec »), puis revenir dans Brave : le modèle est déjà dans le dossier. Sans la première
   solution, les notes vont alors dans les Téléchargements.

Lowsper reconnaît Brave et affiche ces explications au bon moment.

## Limites connues

- **Son de visio dégradé** : sur le son compressé d'une visio, Whisper small se trompe nettement
  plus que sur le micro (mesures dans `decision.md` §15.15 et §17.6). Un modèle plus gros
  (large-v3 turbo) aide, mais demande une carte graphique.
- **Paroles simultanées** : une seule voix est retenue pendant un chevauchement.
- **Voix proches** : deux personnes à la voix proche peuvent partager un numéro d'intervenant.
- **Mesures** : vitesses mesurées sur une machine de développement lente, qualité mesurée sur des
  voix de synthèse. Le test de vitesse intégré (paramètres) donne la réalité de votre PC.
- **Navigateurs** : Edge et Chrome. Brave après un réglage (voir la FAQ). Firefox seulement en
  micro seul, avec un modèle déjà installé.
- **Interface en anglais** : la reconnaissance reste réglée pour le français, l'anglais ou les
  deux ; les vocabulaires métier sont des listes françaises (leurs termes s'affichent tels quels) ;
  l'essai de l'IA intégrée du navigateur porte sur une réunion fictive en français. Les messages
  techniques du navigateur lui-même (erreurs, fenêtres d'autorisation) sont dans sa propre langue.
- **Fichiers importés** : les formats sans lecteur dédié (FLAC, Vorbis...) sont limités à 25 Mo.
  Les horodatages d'un MP3 ou d'un AAC peuvent être décalés de quelques centièmes de seconde
  (délai propre à ces formats).
- **Dossier de notes** : l'accès est gardé par le navigateur ; il disparaît avec ses données
  (nettoyage, profil effacé) et doit alors être redonné. Le navigateur peut aussi redemander son
  accord à chaque ouverture de Lowsper : un clic sur l'accueil suffit.

## Feuille de route

Évolutions prévues, dans l'ordre (détail dans les [jalons](https://github.com/PercyaDJ/Lowsper/milestones)
et `decision.md`) :
1. **Refonte de l'interface** : style unique et épuré, pensé pour les débutants, interface en
   anglais et en français, installation guidée selon la puissance du PC, mini-fenêtre réduite au
   strict nécessaire. Spécifications : [docs/refonte.md](docs/refonte.md), plan des lots : [docs/lots.md](docs/lots.md).
   Livré : nouvelles couleurs, thème clair ou sombre (3.5.0) ; interface en français et en
   anglais (lot R2, publié avec la 4.0.0).
2. **Langues parlées multiples et vocabulaires métier élargis**, après mesure de la qualité.
3. **Mémoire des voix plus fiable** d'une visio à l'autre, après mesure.
4. **Résumé local** : la piste de l'IA intégrée du navigateur reste à l'étude (`decision.md`
   §22 et §23). D'ici là, « Copier pour une IA » reste la voie recommandée.

Une idée, un problème ? Ouvrez une [issue](https://github.com/PercyaDJ/Lowsper/issues/new/choose),
ou posez votre question dans les [discussions](https://github.com/PercyaDJ/Lowsper/discussions).

## Pour les développeurs

`app/engine` et `app/manifest.js` sont générés. Pour les reconstruire (Node.js 20 ou plus) :

```bash
cd tools
npm ci --ignore-scripts
node node_modules/esbuild/install.js
npm run fetch-all                    # modèles à la révision figée de models.lock.json, empreintes vérifiées
npm run build                        # moteur + catalogue, identique à l'octet près au dépôt
npm test                             # lint, formatage, tests unitaires, paquet, non-fuite réseau (comme la CI)
npm run release                      # paquet de distribution tools/dist/Lowsper-X.Y.Z.zip + empreinte
npm run test:e2e                     # installation + réunion simulée (corpus hebdo) dans Chromium, 4 min
node test/eval-hebdo.mjs whisper-small # réunion réaliste : phrases perdues, sigles, intervenants
node test/eval-hebdo.mjs whisper-small --corpus=entretien --vocab=cyber --title
                                     # entretien en tête-à-tête, son de visio, vocabulaire cyber
node build.mjs --embed whisper-small whisper-base && node test/eval.mjs whisper-small whisper-base
                                     # comparaison des modèles sur le corpus avec sigles
```

Si Playwright ne trouve pas son navigateur, indiquez-le : `CHROMIUM_PATH=/chemin/vers/chrome`.
`node build.mjs --embed whisper-small` produit aussi une version avec le modèle pré-installé,
pour une distribution sans aucun accès à Internet.

Pour aller plus loin :
- [docs/architecture.md](docs/architecture.md) : le trajet du son, du micro au Markdown, module par module ;
- [AGENTS.md](AGENTS.md) : règles du projet (contraintes, conventions, commandes) ;
- [CONTRIBUTING.md](CONTRIBUTING.md) : proposer une modification ;
- [SECURITY.md](SECURITY.md) : modèle de menace et signalement des failles ;
- [CHANGELOG.md](CHANGELOG.md) : évolutions ; [decision.md](decision.md) : décisions et mesures.

Structure :

```
Lowsper.html          page à ouvrir (interface + politique de sécurité)
app/css/              styles
app/js/i18n.js        langue de l'interface : catalogues français et anglais, fonction t()
app/js/engine.js      chargement des fichiers, moteur Whisper dans un Worker (glossaire, langue)
app/js/installer.js   installation du modèle au premier lancement
app/js/settings.js    réglages copiés dans le dossier (survivent au nettoyage du navigateur)
app/js/analyzer.js    détection de parole (Silero) et empreintes vocales (WeSpeaker), dans un Worker
app/js/speakers.js    distinction et regroupement des intervenants
app/js/capture.js     capture micro / partage d'écran, détection de parole, découpage
app/js/vocabulary.js  vocabulaires métier intégrés et contexte donné au moteur
app/js/transcript.js  assemblage, sigles, anti-écho, filtres, Markdown, sauvegarde
app/js/app.js         contrôleur de l'interface
app/engine/           runtime transformers.js + ONNX Runtime (généré)
app/models/           modèle(s) installé(s) au premier lancement (non versionné)
tools/                construction, verrou des modèles et tests (inutile pour l'utilisateur final)
docs/                 architecture, guide de déploiement, captures d'écran
decision.md           décisions techniques et arbitrages
AGENTS.md             règles du projet pour les contributeurs et les agents de code
SECURITY.md           modèle de menace, signalement des failles
```

## Licences

- Code Lowsper : MIT.
- Modèle Whisper (OpenAI) : MIT. Conversions ONNX : `onnx-community/whisper-small`, `onnx-community/whisper-base`.
- transformers.js (Hugging Face) : Apache 2.0. ONNX Runtime Web (Microsoft) : MIT.
- Silero VAD (détection de parole) : MIT. WeSpeaker ResNet34 (empreintes vocales,
  `onnx-community/wespeaker-voxceleb-resnet34-LM`) : CC BY 4.0.
- Textes complets : `app/engine/THIRD_PARTY_LICENSES.txt`.
