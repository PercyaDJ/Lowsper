# Lowsper

**Transcription de réunions 100 % locale, dans le navigateur.** Lowsper capte votre micro et le
son de la réunion (Teams, Zoom, Meet...), transcrit en direct avec Whisper, et vous donne à la fin
un transcript Markdown horodaté, prêt à être confié à une IA pour rédiger le compte rendu.

- Aucune installation de logiciel, aucun exécutable, aucun script : un fichier HTML à ouvrir.
- Le modèle de reconnaissance vocale est téléchargé **une seule fois**, au premier lancement, et
  rangé dans le dossier Lowsper. Ensuite, tout fonctionne hors ligne.
- Ni le son ni le texte ne quittent l'ordinateur (bloqué techniquement, voir `decision.md`).
- Un **glossaire** de vos sigles (RSSI, COMEX, KPI...) améliore nettement leur reconnaissance.
- Le transcript est prêt une vingtaine de secondes après la fin de la réunion.

## Utilisation

1. **Téléchargez** le dossier (bouton vert « Code » puis « Download ZIP » sur GitHub) et
   **dézippez-le** où vous voulez (Documents, Bureau...).
2. **Double-cliquez sur `Lowsper.html`**. Il s'ouvre dans votre navigateur (Edge ou Chrome).
   Si un autre navigateur s'ouvre : clic droit sur le fichier, « Ouvrir avec », Microsoft Edge.
3. **Premier lancement uniquement** : cliquez sur « Installer le modèle », sélectionnez le
   **dossier Lowsper** (celui qui contient `Lowsper.html`) et acceptez que Lowsper y enregistre
   des fichiers. Le téléchargement (environ 250 Mo) prend une à quelques minutes, la page
   redémarre toute seule à la fin.
4. Dans « Options », remplissez une fois pour toutes le champ **« Sigles et noms propres »**
   avec le vocabulaire de vos réunions (ex. `RSSI, COMEX, KPI, NIS 2, projet Atlas`). Il est mémorisé.
5. **Prévenez les participants** que la réunion est transcrite.
6. Cliquez sur **« Démarrer l'enregistrement »** :
   - le navigateur propose un **partage d'écran** : choisissez l'écran entier (ou l'onglet de la
     réunion) et **cochez « Partager l'audio »**. Seul le son est utilisé, rien n'est filmé ;
   - autorisez le **micro**.
7. En fin de réunion, cliquez sur **« Terminer la réunion »**. Le fichier `.md` est enregistré
   dans vos Téléchargements. Le bouton **« Copier pour une IA »** copie le transcript précédé
   d'une consigne de compte rendu.

Conseils :
- Un **casque** donne un meilleur résultat (le micro ne réentend pas les participants).
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

**Quel modèle choisir ?**
« Whisper small » (recommandé) est le plus précis. Sur un PC ancien qui peine à suivre (la file
« passages en attente » grossit pendant la réunion), installez « Whisper base » via Options,
« Installer un autre modèle » : 3 fois plus rapide, moins précis.

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
node test/e2e.mjs 45                 # installation réelle + réunion simulée dans Chromium
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
app/js/capture.js     capture micro / partage d'écran, détection de parole, découpage
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
