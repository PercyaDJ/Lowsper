# Lowsper

**Transcription de réunions 100 % locale, dans le navigateur.** Lowsper capte votre micro et le
son de la réunion (Teams, Zoom, Meet...), transcrit en direct avec Whisper, et vous donne à la fin
un transcript Markdown horodaté, prêt à être confié à une IA pour rédiger le compte rendu.

- Aucune installation de logiciel, aucun exécutable, aucun script : un fichier HTML à ouvrir.
- Le modèle de reconnaissance vocale est téléchargé **une seule fois**, au premier lancement, et
  rangé dans le dossier Lowsper. Ensuite, tout fonctionne hors ligne.
- Ni le son ni le texte ne quittent l'ordinateur (bloqué techniquement, voir `decision.md`).
- Un **glossaire** de vos sigles (RSSI, COMEX, KPI...) améliore nettement leur reconnaissance.
- Les **intervenants** sont distingués automatiquement (Intervenant 1, 2, 3...) et peuvent être
  renommés à la fin de la réunion.
- Une **mini-fenêtre** toujours visible permet de piloter l'enregistrement pendant la visio.
- Le transcript est prêt une vingtaine de secondes après la fin de la réunion.

## Utilisation

1. **Téléchargez** le dossier (bouton vert « Code » puis « Download ZIP » sur GitHub) et
   **dézippez-le** où vous voulez (Documents, Bureau...).
2. **Double-cliquez sur `Lowsper.html`**. Il s'ouvre dans votre navigateur (Edge ou Chrome).
   Si un autre navigateur s'ouvre : clic droit sur le fichier, « Ouvrir avec », Microsoft Edge.
3. **Premier lancement uniquement** : cochez le ou les modèles voulus (Whisper small est coché par
   défaut), cliquez sur « Installer », sélectionnez le
   **dossier Lowsper** (celui qui contient `Lowsper.html`) et acceptez que Lowsper y enregistre
   des fichiers. Le téléchargement (environ 250 Mo) prend une à quelques minutes, la page
   redémarre toute seule à la fin.
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
   niveaux, pause, fin), comme un appel Teams réduit. La flèche affiche la dernière phrase.
7. En fin de réunion, cliquez sur **« Terminer »** (carré rouge). Le fichier `.md` est enregistré
   dans vos Téléchargements. Le bouton **« Copier pour une IA »** copie le transcript précédé
   d'une consigne de compte rendu.

Conseils :
- Un **casque** donne un meilleur résultat (le micro ne réentend pas les participants). Sans
  casque, Lowsper reconnaît votre voix et retire à la fin les phrases du micro qui sont l'écho des
  haut-parleurs.
- Gardez l'onglet Lowsper ouvert pendant la réunion (il peut être en arrière-plan).
- Si le navigateur se ferme pendant une réunion, le texte déjà transcrit est proposé au lancement suivant.

## À quoi ressemble le transcript

```markdown
# Transcript de réunion : Point hebdo projet

- **Date** : lundi 5 octobre 2026
- **Horaires** : 17:00 à 18:01 (61 min)
- **Sources** : micro (« Vous »), audio partagé (« Participants »)
- **Langue** : français
- **Transcription** : Whisper base, exécuté localement par Lowsper (hors ligne)

> Transcription automatique : elle peut contenir des erreurs de reconnaissance. [...]

## Transcript

**[00:00:04] Vous :** Bonjour à tous, on commence par le point budget ?

**[00:00:09] Participants :** Oui, alors on a validé l'enveloppe pour le trimestre prochain.
```

## Questions fréquentes

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
sur le disque. Seul le texte du transcript en cours est sauvegardé dans le navigateur (pour la
récupération en cas de plantage), et effacé à la réunion suivante.

**Quel navigateur ?**
Microsoft Edge ou Google Chrome récents. Firefox fonctionne en micro seul.

## Pour les développeurs

`app/engine` et `app/manifest.js` sont générés. Pour les reconstruire (Node.js 20 ou plus) :

```bash
cd tools
npm install --ignore-scripts
node node_modules/esbuild/install.js
node fetch-model.mjs whisper-small   # télécharge le modèle et note révision + empreintes
node fetch-model.mjs whisper-base
node build.mjs                       # moteur + catalogue des modèles téléchargeables
node test/unit.mjs                   # tests unitaires (découpage, sigles, anti-écho, Markdown)
node test/e2e.mjs 60                 # installation + réunion simulée (corpus hebdo) dans Chromium
node test/eval-hebdo.mjs whisper-small # réunion réaliste : phrases perdues, sigles, intervenants
node test/eval-hebdo.mjs whisper-small --corpus=entretien --vocab=cyber --title
                                     # entretien en tête-à-tête, son de visio, vocabulaire cyber
node build.mjs --embed whisper-small whisper-base && node test/eval.mjs whisper-small whisper-base
                                     # comparaison des modèles sur le corpus avec sigles
```

`node build.mjs --embed whisper-small` produit aussi une version avec le modèle pré-installé,
pour une distribution sans aucun accès à Internet.

Structure :

```
Lowsper.html          page à ouvrir (interface + politique de sécurité)
app/css/              styles
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
tools/                construction et tests (inutile pour l'utilisateur final)
decision.md           décisions techniques et arbitrages
```

## Licences

- Code Lowsper : MIT.
- Modèle Whisper (OpenAI) : MIT. Conversions ONNX : `onnx-community/whisper-small`, `onnx-community/whisper-base`.
- transformers.js (Hugging Face) : Apache 2.0. ONNX Runtime Web (Microsoft) : MIT.
