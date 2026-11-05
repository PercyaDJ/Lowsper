// Sonde de l'IA intégrée du navigateur (decision.md §23), dans la vraie page ouverte en file://.
//
// 1. Navigateur tel quel : la sonde répond sans erreur de page et sans aucune requête réseau
//    (Chromium de test n'a pas d'IA intégrée : état attendu « absente »).
// 2. Fausse IA injectée (Summarizer et LanguageModel) : vérification, avertissement avant le
//    téléchargement par le navigateur, progression, essai sur la réunion fictive, faits comptés,
//    rapport copié ; aucun transcript réel n'est lu.
//
// Usage : node test/localai.mjs   (CHROMIUM_PATH si besoin ; aucun modèle requis)
import { chromium } from 'playwright-core';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const url = pathToFileURL(join(here, '..', '..', 'Lowsper.html')).href;

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log('OK    ' + name);
  } catch (e) {
    failed++;
    console.log('ÉCHEC ' + name + '\n      ' + e.message);
  }
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

async function open(fake) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (!r.url().startsWith('file:') && !r.url().startsWith('data:') && !r.url().startsWith('blob:'))
      requests.push(r.url());
  });
  if (fake) await page.addInitScript(fake);
  await page.addInitScript(() => {
    window.__copied = null;
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (t) => (window.__copied = t) },
    });
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#settings-open');
  await page.click('#settings-open');
  await page.click('#lai-probe');
  await page.waitForFunction(() => !document.getElementById('lai-probe').disabled);
  return { context, page, errors, requests };
}

await test('navigateur tel quel : sonde sans erreur ni requête réseau', async () => {
  const { context, page, errors, requests } = await open();
  const states = await page.$$eval('#lai-states li', (li) => li.map((x) => x.textContent));
  assert.equal(states.length, 2);
  console.log('      ' + states.join('\n      '));
  assert.ok(await page.isHidden('#lai-trial'), "pas d'essai proposé sans IA utilisable");
  assert.match(await page.textContent('#lai-status'), /Copier pour une IA/);
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  await context.close();
});

// Fausse IA : le résumé est « à télécharger », le modèle de langage est « indisponible »
const fake = () => {
  window.__seen = [];
  window.Summarizer = {
    availability: async (o) => (window.__seen.push(o), 'downloadable'),
    create: async (o) => {
      o.monitor({ addEventListener: (n, f) => [0.25, 1].forEach((loaded) => f({ loaded })) });
      return {
        summarize: async (t) => {
          window.__input = t;
          return '- Karim régularise le changement en CAB.\n- COPIL de jeudi.';
        },
        destroy() {},
      };
    },
  };
  window.LanguageModel = { availability: async () => 'unavailable' };
};

await test('fausse IA : avertissement, essai sur la réunion fictive, faits, rapport', async () => {
  const { context, page, errors, requests } = await open(fake);
  const states = await page.$$eval('#lai-states li', (li) => li.map((x) => x.className + ' ' + x.textContent));
  assert.match(states[0], /^ok Résumé \(Summarizer\) : utilisable, mais le navigateur doit d'abord/);
  assert.match(states[1], /^ko Modèle de langage \(Prompt API\) : indisponible/);
  const seen = await page.evaluate(() => window.__seen[0]);
  assert.deepEqual(seen.expectedInputLanguages, ['fr']);
  assert.equal(seen.outputLanguage, 'fr');

  // Refus de l'avertissement : rien ne se passe
  page.once('dialog', (d) => d.dismiss());
  await page.click('#lai-trial');
  assert.equal(await page.evaluate(() => window.__input || null), null);

  let warning = '';
  page.once('dialog', (d) => ((warning = d.message()), d.accept()));
  await page.click('#lai-trial');
  await page.waitForFunction(() => /Essai terminé/.test(document.getElementById('lai-status').textContent));
  assert.match(warning, /fait par le navigateur, pas par Lowsper/);
  const input = await page.evaluate(() => window.__input);
  assert.match(input, /^\*\*\[00:00:02\] Claire :\*\* Bonjour à tous/);
  const out = await page.textContent('#lai-out');
  assert.match(out, /Faits retrouvés : 2\/8/);
  assert.match(out, /Karim régularise/);
  assert.ok(await page.isHidden('#lai-progress'));

  await page.click('#lai-copy');
  const copied = await page.evaluate(() => window.__copied);
  assert.match(copied, /^Sonde de l'IA intégrée du navigateur \(Lowsper\)/);
  assert.match(copied, /Page : file:/);
  assert.match(copied, /Résumé \(Summarizer\) : downloadable/);
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  await context.close();
});

await browser.close();
if (failed) {
  console.log(`\n${failed} test(s) en échec`);
  process.exit(1);
}
console.log('\nSonde de l’IA intégrée conforme.');
