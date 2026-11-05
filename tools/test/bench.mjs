// Mesure la vitesse du moteur dans Chromium, page ouverte en file:// (comme un utilisateur).
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
await page.goto(pathToFileURL(join(here, 'bench.html')).href);
await page.evaluate(() => window.benchResult);
await browser.close();
