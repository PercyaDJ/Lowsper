// Langue de l'interface (decision.md §25), dans la vraie page ouverte en file://.
//
// 1. Le texte français écrit dans Lowsper.html est identique au catalogue français : la page sans
//    script et la page traduite disent la même chose.
// 2. Navigateur en anglais : interface en anglais, aucun reste de français visible ni dans les
//    attributs (title, placeholder, aria-label), aucune erreur de page, aucune requête réseau.
// 3. Réglage « Langue de l'interface » : changement immédiat, choix gardé après rechargement.
// 4. Navigateur en français (fr-CA) : français ; autre langue (de-DE) : anglais.
// 5. Note et consignes en anglais quand l'interface est en anglais.
//
// Usage : node test/i18n.mjs   (CHROMIUM_PATH si besoin ; aucun modèle requis)
import { chromium } from 'playwright-core';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const url = pathToFileURL(join(root, 'Lowsper.html')).href;

// Catalogues lus sans navigateur
const box = { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
box.window = box;
vm.createContext(box);
vm.runInContext(await readFile(join(root, 'app', 'js', 'i18n.js'), 'utf8'), box);
const I = box.Lowsper.i18n;

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

async function open(locale) {
  const context = await browser.newContext({ locale });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (!/^(file|data|blob):/.test(r.url())) requests.push(r.url());
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#settings-open');
  return { context, page, errors, requests };
}

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
// Textes de départ que l'application remplace ensuite (état du moteur, nom du modèle, bouton
// d'installation) : le contrôle « aucun reste de français » les couvre
const DYNAMIC = new Set(['engine.preparing', 'foot.model', 'install.button']);
const differs = (found, lang) =>
  found.filter(([key, text]) => !DYNAMIC.has(key) && norm(I.t(key, null, lang)) !== norm(text)).map(([key]) => key);

// Textes de la page : éléments marqués data-i18n, data-i18n-html et data-i18n-attr
function collect() {
  const out = [];
  for (const el of document.querySelectorAll('[data-i18n]')) out.push([el.dataset.i18n, el.textContent]);
  for (const el of document.querySelectorAll('[data-i18n-html]')) out.push([el.dataset.i18nHtml, el.innerHTML]);
  for (const el of document.querySelectorAll('[data-i18n-attr]'))
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':');
      out.push([key, el.getAttribute(attr)]);
    }
  return out;
}

await test('catalogues complets : aucune clé ne manque en français ni en anglais', () => {
  assert.deepEqual([...I.missing()], []);
});

await test('Lowsper.html : le texte écrit dans la page est celui du catalogue français', async () => {
  // La page brute, sans aucun script : ce que voit un navigateur sans JavaScript
  const html = (await readFile(join(root, 'Lowsper.html'), 'utf8')).replace(/<script[\s\S]*?<\/script>/g, '');
  const page = await browser.newPage();
  await page.setContent(html);
  const found = await page.evaluate(collect);
  await page.close();
  assert.ok(found.length > 150, `${found.length} textes marqués seulement`);
  const wrong = found.filter(([key, text]) => norm(I.t(key, null, 'fr')) !== norm(text));
  assert.deepEqual(
    wrong.map(([key, text]) => `${key} : « ${norm(text)} » au lieu de « ${norm(I.t(key, null, 'fr'))} »`),
    []
  );
});

await test('navigateur en anglais : interface en anglais, sans reste de français', async () => {
  const { context, page, errors, requests } = await open('en-US');
  assert.equal(await page.getAttribute('html', 'lang'), 'en');
  await page.click('#settings-open');
  assert.equal(await page.textContent('#settings-title'), 'Settings');
  assert.equal(await page.getAttribute('#ui-lang [data-value="en"]', 'aria-checked'), 'true');
  assert.equal(await page.textContent('#v-ui-lang'), 'English');
  // Chaque texte marqué est celui du catalogue anglais
  const found = await page.evaluate(collect);
  assert.deepEqual(differs(found, 'en'), []);
  // Aucun texte français, marqué ou calculé : lettres accentuées et petits mots du français
  const leftovers = await page.evaluate(() => {
    const french = /[éèêàùâîôûçœÉÈÀ]|\b(le|la|les|des|du|une|vous|votre|pour|avec|dans)\b/;
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const p = n.parentElement;
      if (!n.textContent.trim() || p.closest('noscript, script, style')) continue;
      if (p.closest('[lang="fr"]')) continue; // nom de la langue dans le menu : « Français »
      if (french.test(n.textContent)) out.push(n.textContent.trim().slice(0, 80));
    }
    for (const el of document.querySelectorAll('[title], [placeholder], [aria-label]'))
      for (const a of ['title', 'placeholder', 'aria-label'])
        if (el.hasAttribute(a) && french.test(el.getAttribute(a))) out.push(`${a}: ${el.getAttribute(a)}`);
    return out;
  });
  assert.deepEqual(leftovers, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  await context.close();
});

await test('réglage « Langue de l’interface » : changement immédiat, choix gardé', async () => {
  const { context, page, errors } = await open('en-US');
  await page.click('#settings-open');
  await page.click('[data-open="ui-lang"]');
  await page.click('#ui-lang [data-value="fr"]');
  assert.equal(await page.getAttribute('html', 'lang'), 'fr');
  assert.equal(await page.textContent('#settings-title'), 'Paramètres');
  // Textes calculés réécrits aussi (consignes, variables des modèles)
  assert.equal(await page.inputValue('#ai-name'), 'Compte rendu de réunion');
  assert.match(await page.textContent('#prof-vars'), /nom de la réunion/);
  const found = await page.evaluate(collect);
  assert.deepEqual(differs(found, 'fr'), []);
  // Rechargement : le choix l'emporte sur la langue du navigateur
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#settings-open');
  assert.equal(await page.getAttribute('html', 'lang'), 'fr');
  assert.equal(await page.evaluate(() => localStorage.getItem('lowsper.opt.lang')), 'fr');
  // Retour à l'anglais, sans recharger
  await page.click('#settings-open');
  await page.click('[data-open="ui-lang"]');
  await page.click('#ui-lang [data-value="en"]');
  assert.equal(await page.inputValue('#ai-name'), 'Meeting minutes');
  assert.equal(await page.textContent('#settings-title'), 'Settings');
  assert.deepEqual(errors, []);
  await context.close();
});

await test('langue du navigateur : fr-CA en français, de-DE en anglais', async () => {
  for (const [locale, lang] of [
    ['fr-CA', 'fr'],
    ['de-DE', 'en'],
  ]) {
    const { context, page } = await open(locale);
    assert.equal(await page.getAttribute('html', 'lang'), lang, locale);
    await context.close();
  }
});

await test('interface en anglais : note et consignes fournies en anglais', async () => {
  const { context, page, errors } = await open('en-GB');
  const r = await page.evaluate(() => {
    const L = window.Lowsper;
    const t = new L.Transcript({
      title: 'Weekly check-in',
      startedAt: new Date(2026, 9, 5, 17, 0).getTime(),
      endedAt: new Date(2026, 9, 5, 18, 1).getTime(),
      sources: ['me', 'others'],
    });
    t.addSegment('me', { start: 1, end: 4, speech: 3 }, { chunks: [{ from: 0, to: 3, text: 'Hello everyone.' }] });
    return {
      md: t.toMarkdown(),
      file: t.fileName(),
      prompt: L.Notes.promptText(t, L.Notes.list()[0]),
      profile: L.Notes.list()[0].name,
    };
  });
  assert.match(
    r.md,
    /^# Meeting transcript: Weekly check-in\n\n- \*\*Date\*\*: Monday,? 5 October 2026\n- \*\*Time\*\*: 17:00 to 18:01 \(61 min\)\n/
  );
  assert.match(r.md, /\*\*\[00:00:01\] You:\*\* Hello everyone\./);
  assert.match(r.file, /^meeting_2026-10-05_17h00_weekly-check-in\.md$/);
  assert.match(
    r.prompt,
    /^# Role\nYou write accurate, useful meeting minutes\.\n[\s\S]*\n# Transcript\n# Meeting transcript/
  );
  assert.equal(r.profile, 'Default');
  assert.deepEqual(errors, []);
  await context.close();
});

await browser.close();
if (failed) {
  console.log(`\n${failed} test(s) en échec`);
  process.exit(1);
}
console.log('\nInterface en français et en anglais conforme.');
