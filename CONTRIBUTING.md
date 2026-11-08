# Contribuer à Lowsper

Merci de votre intérêt. Les règles complètes du projet sont dans `AGENTS.md` : elles valent pour
les personnes comme pour les agents de code.

## L'essentiel

1. Lowsper reste **100 % local**, **sans installation**, et **n'écrit jamais l'audio sur le
   disque**. Une proposition qui affaiblit l'un de ces principes ne sera pas retenue.
2. **Aucune donnée réelle** : pas de transcript, d'enregistrement, ni de nom de personne ou
   d'entreprise réels, nulle part (code, tests, issues, captures).
3. Interface **en français et en anglais**, documentation **en français** (sauf les deux pages
   d'accueil, `README.md` en anglais et `README.fr.md`), ton clair et sobre.

## Par où commencer

- Les issues marquées **`bonne première contribution`** sont choisies pour être abordables sans
  connaître tout le code ; **`aide bienvenue`** signale un sujet où un coup de main est attendu.
- [docs/architecture.md](docs/architecture.md) explique le trajet du son, du micro au Markdown,
  et indique quel fichier modifier pour quoi.
- Une question qui n'est pas un bogue : les [discussions](https://github.com/PercyaDJ/Lowsper/discussions).
- Les échanges peuvent se faire en français ou en anglais ; l'interface et la documentation du
  projet restent en français.

En participant, vous acceptez le [code de conduite](CODE_OF_CONDUCT.md).

## Proposer une modification

1. Ouvrez d'abord une issue (modèle « Proposer une idée ») pour tout changement non trivial.
2. Créez une branche depuis `main`, une branche par sujet.
3. Écrivez vos messages de commit au format [Conventional Commits](https://www.conventionalcommits.org/fr/v1.0.0/) :
   `feat(import): glisser-déposer de fichiers audio`, `fix(capture): ...`, `docs: ...`.
4. Vérifiez avant d'ouvrir la pull request :

   ```bash
   cd tools
   npm ci --ignore-scripts
   npm test
   ```

5. Mettez à jour dans la même pull request : `docs/guide.md` (usage), `README.md` et `README.fr.md`
   ensemble si la promesse change, `CHANGELOG.md` (section
   « Non publié »), `decision.md` (tout choix technique non trivial) et `AGENTS.md` (si une règle
   ou une commande change).
6. Remplissez le modèle de pull request.

## Proposer un vocabulaire métier

Les vocabulaires métier (« Paramètres › Transcription › Vocabulaire métier ») sont des listes de
termes donnés à Whisper avant chaque passage : il a plus de chances de les écrire juste. Ils sont
tous dans un seul fichier de données, `app/js/vocabularies.js`. On peut y ajouter un domaine, ou
une langue à un domaine existant, sans toucher au reste du code.

**Format.** Un domaine est une entrée de `Lowsper.VOCABULARIES` ; ses termes sont rangés par
langue parlée, avec le code à deux lettres de Whisper (`fr`, `en`, `es`, `de`...), un terme par
ligne :

```js
logistique: {
  fr: [
    'WMS',
    'TMS',
    'EDI',
    'quai de chargement',
  ],
  en: [
    'WMS',
    'TMS',
    'EDI',
    'loading dock',
  ],
},
```

**Règles.**
- **Identifiant** court, en minuscules, sans accent ni espace (`logistique`). Il est gardé dans
  les réglages des utilisateurs : il ne change plus une fois publié.
- **Nom affiché** dans le catalogue `app/js/i18n.js`, clé `vocab.<identifiant>`, en français et en
  anglais (un test vérifie qu'il ne manque pas).
- **Du plus utile au moins utile.** Le contexte de Whisper est court (200 jetons, environ quarante
  sigles). Quand plusieurs listes sont cochées, chacune garde ses premiers termes : mettez en tête
  les sigles et le jargon que Whisper écrit mal, en fin de liste les termes plus courants
  (`decision.md` §35).
- **Seulement des termes génériques du domaine** : sigles, jargon, noms de lois, de normes ou
  d'organismes publics. **Jamais** de nom d'entreprise, de marque, de produit ou de personne
  (règle n° 9 d'`AGENTS.md`). Seule exception, décidée par le mainteneur : le domaine « IA et
  informatique » (`ia`) cite des langages et des logiciels libres très courants (Python, Linux,
  Git...), jamais une marque d'éditeur commercial (`decision.md` §44).
- **Inutile** d'ajouter un mot courant que Whisper écrit déjà bien (« budget », « réunion ») : il
  prend de la place sans rien apporter. Pas de virgule ni de point-virgule dans un terme.
- **Une langue parlée** ne reçoit que les termes de sa liste : une liste française n'est jamais
  donnée pour un passage en anglais. Une langue sans liste n'a que les mots à reconnaître de
  l'utilisateur.
- Les corrections automatiques d'un vocabulaire (« l'NSI » devient « l'ANSSI », dans
  `app/js/vocabulary.js`) ne s'ajoutent que pour une déformation **réellement observée**, sans
  autre sens possible dans une réunion du domaine.

**Vérifier.** `npm run test:unit` contrôle le format (identifiant, doublons, nom dans les deux
langues) et que les termes ne ralentissent pas la correction du texte. Pour mesurer l'effet d'une
liste sur la reconnaissance, voir `tools/test/eval-vocab.mjs` (option `--corpus=` pour un corpus
qui nomme ses propres listes cochées, comme `corpus/vocab-ia.json`).

## Signaler une faille

Voir `SECURITY.md`. Jamais dans une issue publique.
