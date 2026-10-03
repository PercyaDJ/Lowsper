# Lowsper

**Transcription de réunions 100 % locale, dans le navigateur.** Lowsper capte votre micro et le
son de la réunion (Teams, Zoom, Meet...), transcrit en direct avec Whisper, et vous donne à la fin
un transcript Markdown horodaté, prêt à être confié à une IA pour rédiger le compte rendu.

- Aucune installation, aucun exécutable, aucun script : un fichier HTML à ouvrir.
- Aucune connexion Internet : rien ne sort de l'ordinateur (bloqué techniquement, voir `decision.md`).
- Le transcript est prêt quelques secondes après la fin de la réunion.

## Utilisation

1. **Téléchargez** le dossier (bouton vert « Code » puis « Download ZIP » sur GitHub) et
   **dézippez-le** où vous voulez (Documents, Bureau...).
2. **Double-cliquez sur `Lowsper.html`**. Il s'ouvre dans votre navigateur (Edge ou Chrome conseillés).
   Si un autre navigateur s'ouvre : clic droit sur le fichier, « Ouvrir avec », Microsoft Edge.
3. **Prévenez les participants** que la réunion est transcrite.
4. Cliquez sur **« Démarrer l'enregistrement »** :
   - le navigateur propose un **partage d'écran** : choisissez l'écran entier (ou l'onglet de la
     réunion) et **cochez « Partager l'audio »**. Seul le son est utilisé, rien n'est filmé ;
   - autorisez le **micro**.
5. En fin de réunion, cliquez sur **« Terminer la réunion »**. Le fichier `.md` est enregistré
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

**Le partage d'écran ne propose pas « Partager l'audio ».**
Sur Windows, choisissez « Écran entier » : la case « Partager aussi l'audio du système » apparaît.
Pour une réunion dans le navigateur, partager l'onglet de la réunion fonctionne partout.
Sans son partagé, Lowsper continue avec le micro seul.

**Mon PC va-t-il chauffer ?**
Le silence n'est jamais traité, et chaque voix utilise un seul cœur du processeur. Sur la
machine de test, une heure de parole représente environ 10 minutes de calcul, étalées
pendant la réunion.

**Mes données partent-elles quelque part ?**
Non. La page interdit au navigateur toute connexion réseau. L'audio n'est jamais enregistré
sur le disque. Seul le texte du transcript en cours est sauvegardé dans le navigateur (pour la
récupération en cas de plantage), et effacé à la réunion suivante.

**Quel navigateur ?**
Microsoft Edge ou Google Chrome récents. Firefox fonctionne en micro seul.

## Pour les développeurs

Le dossier `app/engine`, `app/models` et `app/manifest.js` sont générés. Pour les reconstruire
(Node.js 20 ou plus) :

```bash
cd tools
npm install --ignore-scripts
node node_modules/esbuild/install.js
node fetch-model.mjs            # télécharge whisper-base depuis Hugging Face
node build.mjs                  # génère app/engine, app/models, app/manifest.js
node test/unit.mjs              # tests unitaires (découpage, anti-écho, Markdown)
node test/e2e.mjs 45            # réunion simulée de 45 s dans Chromium (playwright-core)
```

Pour embarquer le modèle plus précis mais plus lourd : `node fetch-model.mjs whisper-small`
puis `node build.mjs whisper-small`.

Structure :

```
Lowsper.html          page à ouvrir (interface + politique de sécurité)
app/css/              styles
app/js/engine.js      chargement des fichiers embarqués, moteur Whisper dans un Worker
app/js/capture.js     capture micro / partage d'écran, détection de parole, découpage
app/js/transcript.js  assemblage, anti-écho, filtres, Markdown, sauvegarde
app/js/app.js         contrôleur de l'interface
app/engine/           runtime transformers.js + ONNX Runtime (généré)
app/models/           modèle Whisper encodé en scripts (généré)
tools/                construction et tests (inutile pour l'utilisateur final)
decision.md           décisions techniques et arbitrages
```

## Licences

- Code Lowsper : MIT.
- Modèle Whisper (OpenAI) : MIT. Conversion ONNX : `onnx-community/whisper-base`.
- transformers.js (Hugging Face) : Apache 2.0. ONNX Runtime Web (Microsoft) : MIT.
