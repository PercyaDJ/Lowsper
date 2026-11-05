// Lint du code de Lowsper (outil de développement : rien n'est livré à l'utilisateur final).
// Lancé depuis tools/ : npm run lint
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'app/engine/**',
      'app/manifest.js',
      'app/models/**',
      'tools/node_modules/**',
      'tools/.cache/**',
      'tools/test/output/**',
      'tools/test/audio-fixture.js',
    ],
  },
  js.configs.recommended,
  {
    // Application : scripts classiques (pas de modules ES, voir decision.md §2), navigateur et Workers
    files: ['app/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.worker },
    },
  },
  {
    // Outils et tests : modules Node
    files: ['tools/**/*.{js,mjs}'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } },
  },
  {
    // Les tests de bout en bout contiennent du code exécuté dans la page (page.evaluate)
    files: ['tools/test/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.browser, Lowsper: 'readonly', LowsperApp: 'readonly', decodeFile: 'readonly' },
    },
  },
  {
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
