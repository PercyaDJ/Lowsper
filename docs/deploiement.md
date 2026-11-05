# Déployer Lowsper sur un parc (guide DSI et RSSI)

Ce guide répond aux questions d'une DSI ou d'un RSSI avant d'autoriser Lowsper. Le modèle de
menace complet est dans [SECURITY.md](../SECURITY.md), l'architecture dans
[architecture.md](architecture.md).

## En une minute

- **Ce que c'est** : une page HTML (`Lowsper.html`) et son dossier `app/`, ouverts dans Edge ou
  Chrome en `file://`. Aucun exécutable, aucun service, aucun droit d'administrateur, aucun port
  ouvert.
- **Ce qui sort du poste** : rien, hormis le téléchargement initial du modèle de reconnaissance
  vocale depuis Hugging Face. La page déclare une politique de sécurité (CSP) qui interdit toute
  autre connexion ; un test automatique le vérifie à chaque modification du code.
- **Ce qui est écrit sur le disque** : les modèles (dans le dossier Lowsper), une copie des
  réglages (`app/reglages.txt`, sans texte de réunion) et les transcripts, téléchargés par
  l'utilisateur. **Jamais d'audio.**
- **Code ouvert** (licence MIT), dépendances listées dans `app/engine/THIRD_PARTY_LICENSES.txt`.

## Flux réseau

| Quand | Destination | Contenu | Volume |
|---|---|---|---|
| Premier lancement, sur action de l'utilisateur | `huggingface.co`, `*.huggingface.co`, `*.hf.co` (HTTPS) | Téléchargement (GET) des fichiers du modèle, sans cookie ni identifiant | Whisper small : environ 250 Mo ; base : 80 Mo ; versions carte graphique : 300 à 760 Mo |
| Ensuite | Aucune | Aucun | 0 |

Chaque fichier téléchargé est contrôlé par son empreinte SHA-256, à une révision figée : un
fichier modifié côté serveur ou en transit est refusé. Ces empreintes sont publiées dans
`tools/models.lock.json` et `app/manifest.js`.

Si le proxy bloque Hugging Face, trois options : autoriser ces domaines le temps de
l'installation, installer depuis un autre réseau, ou distribuer un dossier déjà équipé (ci-dessous).

## Distribution

**Paquet officiel.** Chaque version publie `Lowsper-X.Y.Z.zip` et son empreinte SHA-256 sur la
page [Releases](https://github.com/PercyaDJ/Lowsper/releases). Le paquet est reproductible : il peut
être reconstruit depuis le code source (`cd tools && npm run release`) et comparé à l'empreinte
publiée.

**Poste sans accès à Hugging Face.** Deux possibilités :
1. installer le modèle une fois sur un poste qui y a accès, puis copier tout le dossier Lowsper
   (avec `app/models`) vers les autres postes (clé USB, partage réseau, outil de déploiement) ;
2. construire une version avec le modèle intégré, sans aucun accès réseau : `cd tools`,
   `npm ci --ignore-scripts`, `npm run fetch-all`, `node build.mjs --embed whisper-small` ; le
   dossier obtenu (page et `app/`) est prêt à copier.

**Emplacement.** Une copie par utilisateur, dans un dossier où il peut écrire (Documents par
exemple) : Lowsper y enregistre ses réglages. Une copie en lecture seule, avec le modèle déjà
installé, devrait fonctionner, les réglages restant alors dans le seul stockage du navigateur :
ce cas n'a pas été testé.

**Mise à jour.** Remplacer le dossier par la nouvelle version, en recopiant `app/models` et
`app/reglages.txt` de l'ancienne : rien n'est perdu (règle de compatibilité du projet).

## Prérequis navigateur

| Fonction | Utilisée pour | Si elle est bloquée |
|---|---|---|
| Ouverture de fichiers locaux (`file://`) | Lancer Lowsper | Lowsper ne démarre pas |
| Accès au micro | Votre voix | Lowsper transcrit seulement le son de la visio |
| Partage d'écran avec son | Le son des autres participants | Lowsper transcrit seulement le micro |
| Écriture dans un dossier choisi (File System Access) | Installer le modèle, conserver les réglages | Distribuer un dossier déjà équipé ; les réglages restent dans le navigateur |
| Mini-fenêtre (Document Picture-in-Picture) | Barre toujours visible | La page principale reste utilisable |
| WebAssembly, Web Workers | Le moteur | Lowsper ne démarre pas |

Edge et Chrome permettent d'autoriser ou de bloquer ces fonctions par stratégie (par exemple
l'accès au micro, la capture d'écran, l'écriture dans le système de fichiers, ou la liste des URL
bloquées, qui peut inclure `file://`). Les noms exacts et leur effet sont à vérifier dans la
documentation officielle des stratégies de Microsoft Edge et de Google Chrome : ce guide ne les
reproduit pas pour ne pas risquer de donner un nom inexact ou périmé.

Firefox et Safari ne sont pas pris en charge (pas d'écriture dans un dossier ; Firefox ne capte pas
le son d'un partage d'écran).

## Données produites sur le poste

| Donnée | Où | Durée de vie |
|---|---|---|
| Audio de la réunion | Mémoire de l'onglet uniquement | Effacé en quittant la page ou à la réunion suivante |
| Transcript (`.md`) | Dossier Téléchargements, ou dossier choisi par l'utilisateur pour un profil de sortie (base de notes) | Géré par l'utilisateur |
| Accès au dossier d'un profil | Stockage du navigateur (accord donné par l'utilisateur) | Jusqu'au nettoyage du navigateur |
| Copie de secours du transcript en cours | Stockage local du navigateur | Effacée à la réunion suivante |
| Réglages (glossaire, vocabulaire, préférences, profils de sortie) | Stockage du navigateur et `app/reglages.txt` | Jusqu'à modification |
| Empreintes vocales (facultatif, désactivé par défaut) | Stockage du navigateur | Effacement automatique après 1, 3 ou 6 mois, ou à la demande |
| Journal technique (facultatif) | Téléchargé à la demande | Ne contient aucun texte de réunion |

Les fichiers produits ne sont pas chiffrés par Lowsper : leur protection relève du poste
(chiffrement du disque, droits d'accès).

## Conformité

- **Information des participants** : un bandeau rappelle de prévenir les participants avant
  chaque enregistrement ; le recueil de leur accord reste de la responsabilité de l'utilisateur.
- **Données biométriques** : la mémoire des voix (empreintes vocales) est désactivée par défaut,
  activée seulement après une confirmation qui rappelle sa nature (RGPD, article 9), et limitée
  dans le temps.
- **Aucun sous-traitant** : aucun service tiers ne reçoit l'audio ni le texte.

## Signaler un problème de sécurité

Voir [SECURITY.md](../SECURITY.md) : signalement privé, jamais dans une issue publique.
