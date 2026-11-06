// Paramètres en onglets (lot R7, decision.md §30), dans la vraie page ouverte en file://.
//
// 1. Trois onglets (Transcription, Notes et compte rendu, Avancé), au clavier.
// 2. Aucune liste déroulante native : chaque choix ouvre un sous-écran dessiné par Lowsper.
// 3. Nouveaux noms, chacun expliqué sous sa ligne ; le bouton « Conserver mes réglages » a disparu.
// 4. Sous-écran : focus sur son titre, Échap revient à l'écran principal (focus sur la ligne), un
//    second Échap ferme la fenêtre. Liste à choix unique : flèches, choix gardé.
// 5. Corrections automatiques et nombre de mots : la valeur de la ligne suit.
// 6. Exporter : un fichier JSON sans empreintes vocales ; importer : réglages remplacés, page
//    rechargée, message ; fichier qui n'est pas un fichier de réglages : message clair.
// 7. Aucune erreur de page, aucune requête réseau.
//
// Usage : node test/settings.mjs   (CHROMIUM_PATH si besoin ; aucun modèle requis)
import { chromium } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(here, 'output', 'settings');
await mkdir(out, { recursive: true });
const url = pathToFileURL(join(root, 'Lowsper.html')).href;

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
// Interface en français : les vérifications portent sur les textes français (decision.md §25)
const context = await browser.newContext({ locale: 'fr-FR', acceptDownloads: true });
const page = await context.newPage();
const errors = [];
const requests = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('request', (r) => {
  if (!/^(file|data|blob):/.test(r.url())) requests.push(r.url());
});
// Réglages de départ, dont une empreinte vocale fictive qui ne doit jamais être exportée : écrits
// une seule fois, puis la page est rechargée
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem('lowsper.glossary', 'COPIL, KPI');
  localStorage.setItem(
    'lowsper.voices.v1',
    JSON.stringify({ enabled: true, keepDays: 90, voices: [{ name: 'Voix fictive', createdAt: Date.now(), emb: [] }] })
  );
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#settings-open');
const active = () =>
  page.evaluate(
    () =>
      document.activeElement &&
      (document.activeElement.id || document.activeElement.dataset.open || document.activeElement.textContent.trim())
  );

await test('trois onglets, au clavier', async () => {
  await page.click('#settings-open');
  const tabs = await page.$$eval('#set-tabs [role="tab"]', (t) => t.map((x) => x.textContent));
  assert.deepEqual(tabs, ['Transcription', 'Notes et compte rendu', 'Avancé']);
  assert.equal(await page.isVisible('#tp-transcription'), true);
  assert.equal(await page.isHidden('#tp-notes'), true);
  await page.focus('#tab-transcription');
  await page.keyboard.press('ArrowRight');
  assert.equal(await active(), 'tab-notes');
  assert.equal(await page.getAttribute('#tab-notes', 'aria-selected'), 'true');
  assert.equal(await page.isVisible('#tp-notes'), true);
  assert.equal(await page.isHidden('#tp-transcription'), true);
  await page.keyboard.press('End');
  assert.equal(await page.isVisible('#tp-advanced'), true);
  await page.keyboard.press('ArrowRight');
  assert.equal(await active(), 'tab-transcription', 'retour au premier onglet');
  // Un seul onglet dans l'ordre de tabulation
  assert.deepEqual(await page.$$eval('#set-tabs [role="tab"]', (t) => t.map((x) => x.tabIndex)), [0, -1, -1]);
});

await test('aucune liste déroulante native, nouveaux noms expliqués sous leur ligne', async () => {
  assert.equal(await page.$$eval('#settings select', (s) => s.length), 0);
  assert.equal(await page.$('#settings-keep'), null, 'bouton « Conserver mes réglages » retiré');
  const row = (open) =>
    page.$eval(`[data-open="${open}"]`, (b) => ({
      label: b.querySelector('.set-label').textContent,
      sub: (b.querySelector('.set-sub') || {}).textContent || '',
      value: (b.querySelector('.set-value') || {}).textContent || '',
    }));
  const words = await row('glossary');
  assert.equal(words.label, 'Mots à reconnaître');
  assert.match(words.sub, /par exemple Dr Martin, KPI/);
  assert.equal(words.value, '2', 'deux mots déjà saisis');
  const fixes = await row('fixes');
  assert.equal(fixes.label, 'Corrections automatiques');
  assert.match(fixes.sub, /Kalmar devient CALMAR/);
  assert.equal((await row('place')).label, 'Emplacement');
  assert.equal((await row('format')).label, 'Format de la note');
  assert.equal((await row('format')).value, 'Texte simple');
  assert.match(await page.textContent('#settings-saved'), /dossier Lowsper/);
  assert.match(await page.textContent('#tp-advanced'), /ne sert qu'à les déplacer vers un autre PC/);
  assert.match(
    await page.textContent('#tp-advanced'),
    /Vérifie si ce PC peut rédiger des résumés hors ligne, sans service d'IA en ligne\./
  );
  await page.screenshot({ path: join(out, 'transcription.png') });
});

await test('sous-écran : titre, choix au clavier, Échap revient puis ferme', async () => {
  await page.focus('[data-open="language"]');
  await page.keyboard.press('Enter');
  assert.equal(await page.isVisible('#page-language'), true);
  assert.equal(await page.isHidden('#set-main'), true);
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Langue parlée');
  const options = await page.$$eval('#language [role="radio"]', (b) =>
    b.map((x) => [x.querySelector('.set-label').textContent, x.getAttribute('aria-checked')])
  );
  assert.deepEqual(options, [
    ['Français', 'true'],
    ['Anglais', 'false'],
    ['Français et anglais (détection automatique)', 'false'],
  ]);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.value), 'fr', 'focus sur le choix actuel');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.getAttribute('#language [data-value="auto"]', 'aria-checked'), 'true');
  assert.equal(await page.evaluate(() => localStorage.getItem('lowsper.language')), 'auto');
  await page.keyboard.press('Escape');
  assert.equal(await page.isVisible('#settings'), true, 'la fenêtre reste ouverte');
  assert.equal(await page.isVisible('#set-main'), true);
  assert.equal(await active(), 'language', 'focus revenu sur la ligne');
  assert.equal(await page.textContent('#v-language'), 'Français et anglais (détection automatique)');
  await page.keyboard.press('Escape');
  assert.equal(await page.isHidden('#settings'), true);
  // Liste redessinée par son propre choix (thème) : le focus reste sur le choix actuel
  await page.click('#settings-open');
  await page.click('#tab-advanced');
  await page.click('[data-open="theme"]');
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.value), 'light');
  assert.equal(await page.evaluate(() => localStorage.getItem('lowsper.opt.theme')), 'light');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.value), 'dark', 'focus gardé');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  assert.equal(await page.textContent('#v-theme'), 'Automatique (comme le système)');
  await page.keyboard.press('Escape');
});

await test('corrections automatiques et mots : la valeur de la ligne suit', async () => {
  await page.click('#settings-open');
  await page.click('[data-open="fixes"]');
  assert.match(await page.textContent('#fix-chips'), /Aucune correction/);
  await page.fill('#set-fix-wrong', 'Kalmar');
  await page.fill('#set-fix-right', 'CALMAR');
  await page.press('#set-fix-right', 'Enter');
  assert.match(await page.textContent('#fix-chips'), /Kalmar → CALMAR/);
  await page.click('#page-fixes [data-back]');
  assert.equal(await page.textContent('#v-fixes'), '1');
  assert.equal(await page.textContent('#v-glossary'), '3', 'le bon mot rejoint les mots à reconnaître');
  // Vocabulaire métier : liste à cocher multiple
  await page.click('[data-open="vocab"]');
  const boxes = await page.$$('#vocab-list [role="checkbox"]');
  assert.ok(boxes.length >= 3);
  await boxes[0].click();
  assert.equal(await boxes[0].getAttribute('aria-checked'), 'true');
  await page.click('#page-vocab [data-back]');
  assert.notEqual(await page.textContent('#v-vocab'), 'Aucun');
});

await test('exporter : un fichier JSON, sans empreintes vocales ni mesures de ce PC', async () => {
  await page.click('#tab-advanced');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#settings-export')]);
  assert.match(dl.suggestedFilename(), /^lowsper-reglages_\d{4}-\d\d-\d\d\.json$/);
  const file = join(out, dl.suggestedFilename());
  await dl.saveAs(file);
  const text = await readFile(file, 'utf8');
  const json = JSON.parse(text);
  assert.equal(json.lowsper, 'reglages');
  assert.equal(json.data['lowsper.glossary'], 'COPIL, KPI, CALMAR');
  assert.ok(json.data['lowsper.fixes']);
  assert.ok(!/voices|Voix fictive/.test(text), 'aucune empreinte vocale');
  await page.screenshot({ path: join(out, 'avance.png') });
});

await test('importer : réglages remplacés, page rechargée, message', async () => {
  const file = join(out, 'import.json');
  await writeFile(
    file,
    JSON.stringify({
      lowsper: 'reglages',
      version: 1,
      data: { 'lowsper.glossary': 'RSSI, COMEX', 'lowsper.voices.v1': '{}' },
    })
  );
  let asked = '';
  page.once('dialog', (d) => {
    asked = d.message();
    d.accept();
  });
  await Promise.all([page.waitForEvent('load'), page.setInputFiles('#settings-import-file', file)]);
  assert.match(asked, /Remplacer vos réglages par les 1 réglages de « import\.json »/);
  await page.waitForSelector('#settings-open');
  assert.equal(await page.evaluate(() => localStorage.getItem('lowsper.glossary')), 'RSSI, COMEX');
  assert.match(
    await page.evaluate(() => localStorage.getItem('lowsper.voices.v1')),
    /Voix fictive/,
    'les voix de ce PC restent'
  );
  await page.waitForFunction(() => /Réglages importés \(1\)/.test(document.body.textContent));
  // Fichier qui n'est pas un fichier de réglages
  const bad = join(out, 'pas-des-reglages.txt');
  await writeFile(bad, 'Ceci est un texte quelconque.');
  await page.setInputFiles('#settings-import-file', bad);
  await page.waitForFunction(() => /ne contient pas de réglages Lowsper/.test(document.body.textContent));
});

await test('« Ajouter un emplacement » : page ouverte, nom prêt à saisir, ligne mise à jour', async () => {
  await page.click('#settings-open');
  await page.click('#tab-notes');
  await page.click('#prof-new');
  assert.equal(await page.isVisible('#page-place'), true);
  await page.keyboard.type('Projet fictif');
  const places = await page.$$eval('#prof-select [role="radio"] .set-label', (l) => l.map((x) => x.textContent));
  assert.deepEqual(places, ['Par défaut', 'Projet fictif']);
  await page.keyboard.press('Escape');
  assert.equal(await page.textContent('#v-place'), 'Projet fictif');
  assert.equal(await page.textContent('#v-format'), 'Pour les applications de notes');
  // Page longue (format « Pour les applications de notes ») : la liste de choix reste entière
  await page.click('[data-open="format"]');
  const list = await page.$eval('#prof-format', (l) => l.getBoundingClientRect().height);
  assert.ok(list >= 2 * 48, `liste de choix écrasée : ${list} px`);
  assert.equal(await page.isVisible('#prof-format [data-value="modele"]'), true);
  await page.keyboard.press('Escape');
  // Aucun dossier Lowsper accordé dans ce navigateur de test : repli sur les Téléchargements
  assert.equal(await page.textContent('#v-folder'), 'Vos Téléchargements');
  await page.screenshot({ path: join(out, 'notes.png') });
  await page.click('#settings-close');
  // Réouverture : l'emplacement montré est celui choisi sur l'accueil
  await page.click('#settings-open');
  await page.click('#tab-notes');
  assert.equal(await page.textContent('#v-place'), 'Par défaut');
  await page.click('#settings-close');
});

await test('aucune erreur de page, aucune requête réseau', async () => {
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
});

await browser.close();
if (failed) {
  console.log(`\n${failed} test(s) en échec`);
  process.exit(1);
}
console.log('\nParamètres en onglets conformes.');
