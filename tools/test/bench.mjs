// Mesure la vitesse du moteur dans Chromium, page ouverte en file:// (comme un utilisateur).
// Prérequis : node build.mjs --embed whisper-small (modèle installé dans app/models).
//
// --cores [N] : vitesse de chaque modèle installé avec 1 à N moteurs en même temps (N : nombre de
// fils du PC par défaut), pour la recommandation de modèle (decision.md §26). Prérequis :
// node build.mjs --embed whisper-small whisper-base
import { chromium } from 'playwright-core';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const page = await browser.newPage();
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('request', (r) => {
  if (!r.url().startsWith('file:') && !r.url().startsWith('blob:') && !r.url().startsWith('data:'))
    console.log('[RÉSEAU]', r.url());
});
const cores = process.argv.indexOf('--cores');
const max = cores > 0 ? Number(process.argv[cores + 1]) || 0 : 0;
const file = cores > 0 ? 'bench-cores.html' : 'bench.html';
await page.goto(pathToFileURL(join(here, file)).href + (max ? `?max=${max}` : ''));
await page.evaluate(() => window.benchResult);
await browser.close();
