# Contribuer à Lowsper

Merci de votre intérêt. Les règles complètes du projet sont dans `AGENTS.md` : elles valent pour
les personnes comme pour les agents de code.

## L'essentiel

1. Lowsper reste **100 % local**, **sans installation**, et **n'écrit jamais l'audio sur le
   disque**. Une proposition qui affaiblit l'un de ces principes ne sera pas retenue.
2. **Aucune donnée réelle** : pas de transcript, d'enregistrement, ni de nom de personne ou
   d'entreprise réels, nulle part (code, tests, issues, captures).
3. Interface et documentation **en français**, ton clair et sobre.

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

5. Mettez à jour dans la même pull request : `README.md` (usage), `CHANGELOG.md` (section
   « Non publié »), `decision.md` (tout choix technique non trivial) et `AGENTS.md` (si une règle
   ou une commande change).
6. Remplissez le modèle de pull request.

## Signaler une faille

Voir `SECURITY.md`. Jamais dans une issue publique.
