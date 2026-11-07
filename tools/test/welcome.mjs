// Premier lancement guidé (decision.md §26), dans la vraie page ouverte en file://, sur une copie
// du dossier Lowsper sans aucun modèle installé.
//
// 1. Ce qui est détecté (processeurs logiques, mémoire, carte graphique) est affiché ; un seul
//    modèle est coché, le recommandé ; sans carte graphique, les modèles qui en demandent une sont
//    grisés avec leur raison ; le dossier de la page est affiché ; un seul bouton.
// 2. Recommandation selon le matériel simulé : 4 fils, Whisper base ; 8 fils, Whisper small.
// 3. Carte graphique simulée : ses modèles deviennent utilisables, sans être recommandés.
// 4. Menu de langue de l'en-tête, au clavier.
// 5. Installation : le modèle choisi seul (plus Whisper base avec un modèle processeur) est
//    téléchargé, et le même accord au dossier sert à la copie des réglages (app/reglages.txt).
// Aucune erreur de page, aucune requête réseau (le téléchargement est simulé).
//
// Usage : node test/welcome.mjs   (CHROMIUM_PATH si besoin ; aucun modèle requis)
import { chromium } from 'playwright-core';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const site = join(here, 'output', 'welcome-site');
await rm(site, { recursive: true, force: true });
await mkdir(join(site, 'app', 'models'), { recursive: true });
await cp(join(root, 'Lowsper.html'), join(site, 'Lowsper.html'));
for (const d of ['css', 'js']) await cp(join(root, 'app', d), join(site, 'app', d), { recursive: true });
await cp(join(root, 'app', 'manifest.js'), join(site, 'app', 'manifest.js'));
const url = pathToFileURL(join(site, 'Lowsper.html')).href;

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

/** Ouvre la page avec un matériel simulé : { threads, memory, gpu }, une langue, des modèles installés. */
async function open({ threads, memory, gpu = false, locale = 'fr-FR', installed = null }) {
  const context = await browser.newContext({ locale, viewport: { width: 900, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (!/^(file|data|blob):/.test(r.url())) requests.push(r.url());
  });
  if (installed) await page.addInitScript((ids) => (window.LOWSPER_INSTALLED = ids.map((id) => ({ id }))), installed);
  await page.addInitScript(
    ({ threads, memory, gpu }) => {
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => threads });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => memory });
      // Carte graphique : présente (fausse) ou absente
      Object.defineProperty(navigator, 'gpu', {
        get: () =>
          gpu
            ? {
                requestAdapter: async () => ({
                  info: { vendor: 'test', description: 'carte de test' },
                  features: new Set(),
                }),
              }
            : undefined,
      });
    },
    { threads, memory, gpu }
  );
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  // Modèle déjà installé : l'écran s'ouvre depuis les paramètres, « Installer ou ajouter des modèles »
  if (installed) {
    await page.click('#settings-open');
    await page.click('#tab-advanced');
    await page.click('[data-open="model"]');
    await page.click('#add-model');
  }
  await page.waitForSelector('#view-install:not([hidden])');
  // La détection de la carte graphique est asynchrone : on attend sa puce
  await page.waitForFunction(() => !/…/.test(document.getElementById('hw-chips').textContent));
  return { context, page, errors, requests };
}

const state = (page) =>
  page.evaluate(() => {
    const rows = [...document.querySelectorAll('#model-choices .model-row')].map((l) => {
      const i = l.querySelector('input');
      return {
        id: i.value,
        type: i.type,
        checked: i.checked,
        disabled: i.disabled,
        best: !!l.querySelector('.badge.best'),
        text: l.textContent.replace(/\s+/g, ' ').trim(),
      };
    });
    return {
      chips: [...document.querySelectorAll('#hw-chips li')].map((li) => li.textContent),
      rows,
      button: document.getElementById('install').textContent,
      buttons: [...document.querySelectorAll('#view-install button:not([hidden])')].length,
      folder: document.getElementById('install-folder').textContent,
      folderVisible: !!document.getElementById('install-folder').offsetParent,
      // La sous-page « Dossier » des paramètres n'est pas écrasée par le chemin (decision.md §38)
      settingsFolderPage: !!document.querySelector('#page-folder .settings-head'),
      langMenu: !document.getElementById('lang-menu').hidden,
    };
  });

await test('4 fils, sans carte graphique : détection affichée, Whisper base recommandé et seul coché', async () => {
  const { context, page, errors, requests } = await open({ threads: 4, memory: 8 });
  const s = await state(page);
  assert.deepEqual(s.chips, ['4 processeurs logiques', '8 Go de mémoire ou plus', 'Aucune carte graphique trouvée']);
  assert.ok(
    s.rows.every((r) => r.type === 'radio'),
    'un seul choix possible'
  );
  assert.deepEqual(
    s.rows.filter((r) => r.checked).map((r) => r.id),
    ['whisper-base']
  );
  assert.deepEqual(
    s.rows.filter((r) => r.best).map((r) => r.id),
    ['whisper-base']
  );
  // Modèles « carte graphique » : grisés, avec la raison, après les modèles utilisables
  const gpuRows = s.rows.filter((r) => /carte graphique|turbo/.test(r.text));
  assert.ok(gpuRows.length >= 2);
  for (const r of gpuRows) {
    assert.ok(r.disabled, r.id);
    assert.match(r.text, /Demande une carte graphique : aucune trouvée sur ce PC\./);
  }
  assert.ok(s.rows.findIndex((r) => r.disabled) > s.rows.findIndex((r) => r.id === 'whisper-small'));
  assert.match(s.button, /^Télécharger et installer \(\d+ Mo\)$/);
  assert.equal(s.buttons, 1, 'un seul bouton (pas de « Retour » au premier lancement)');
  assert.ok(s.folder.endsWith('welcome-site'), s.folder);
  assert.ok(s.folderVisible, 'chemin du dossier affiché sur l’écran de bienvenue');
  assert.ok(s.settingsFolderPage, 'sous-page Dossier des paramètres intacte');
  assert.ok(s.langMenu, 'menu de langue visible sur l’écran de bienvenue');
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  await context.close();
});

await test('8 fils : Whisper small recommandé, avec son modèle de secours compté dans la taille', async () => {
  const { context, page, errors } = await open({ threads: 8, memory: 8 });
  const s = await state(page);
  const small = s.rows.find((r) => r.id === 'whisper-small');
  assert.ok(small.checked && small.best);
  assert.match(small.text, /Inclut un modèle de secours plus rapide\./);
  // small + base : la taille du bouton est celle de la ligne
  const size = small.text.match(/(\d+) Mo/)[1];
  assert.equal(s.button, `Télécharger et installer (${size} Mo)`);
  assert.deepEqual(errors, []);
  await context.close();
});

await test('carte graphique présente : ses modèles utilisables, mais pas recommandés', async () => {
  const { context, page, errors } = await open({ threads: 16, memory: 8, gpu: true });
  const s = await state(page);
  assert.ok(s.chips.includes('Carte graphique trouvée'));
  assert.ok(s.rows.every((r) => !r.disabled));
  assert.deepEqual(
    s.rows.filter((r) => r.best).map((r) => r.id),
    ['whisper-small']
  );
  assert.deepEqual(errors, []);
  await context.close();
});

await test('ajout d’un modèle depuis les paramètres : modèle installé marqué, retour possible', async () => {
  const { context, page, errors } = await open({ threads: 8, memory: 8, installed: ['whisper-small', 'whisper-base'] });
  const s = await state(page);
  assert.equal(await page.textContent('#install-title'), 'Ajouter un modèle');
  for (const id of ['whisper-small', 'whisper-base']) {
    const r = s.rows.find((x) => x.id === id);
    assert.ok(r.disabled && !r.checked && /installé/.test(r.text), id);
  }
  assert.equal(s.button, 'Tous les modèles utilisables sont déjà installés');
  assert.equal(await page.isVisible('#install-back'), true);
  await page.click('#install-back');
  assert.equal(await page.isVisible('#view-idle'), true);
  assert.equal(await page.isHidden('#lang-menu'), true, 'menu de langue seulement sur l’écran de bienvenue');
  assert.deepEqual(errors, []);
  await context.close();
});

await test('menu de langue : au clavier, changement immédiat et mémorisé', async () => {
  const { context, page, errors } = await open({ threads: 8, memory: 8 });
  await page.focus('#lang-btn');
  await page.keyboard.press('ArrowDown'); // ouvre le menu, sur la langue actuelle
  assert.equal(await page.getAttribute('#lang-btn', 'aria-expanded'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.value), 'fr');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.equal(await page.getAttribute('html', 'lang'), 'en');
  assert.equal(await page.textContent('#install-title'), 'Welcome to Lowsper');
  assert.equal(await page.textContent('#lang-current'), 'English');
  assert.equal(await page.isHidden('#lang-list'), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'lang-btn', 'le focus revient au bouton');
  const s = await state(page);
  assert.ok(s.chips.includes('8 logical processors'));
  assert.match(s.button, /^Download and install \(\d+ MB\)$/);
  assert.equal(await page.evaluate(() => localStorage.getItem('lowsper.opt.lang')), 'en');
  // Échap referme sans rien changer
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  assert.equal(await page.isHidden('#lang-list'), true);
  assert.equal(await page.getAttribute('html', 'lang'), 'en');
  assert.deepEqual(errors, []);
  await context.close();
});

await test('dossier : un dossier parent (Téléchargements, double dossier de Windows) suffit', async () => {
  const { context, page, errors } = await open({ threads: 8, memory: 8 });
  const res = await page.evaluate(async () => {
    const L = window.Lowsper;
    // Arborescence factice : la fenêtre du navigateur et la vérification d'écriture sont simulées
    const node = (name, content) => ({
      kind: 'directory',
      name,
      getFileHandle: async (f) => {
        if (typeof content[f] !== 'string') throw new DOMException('absent', 'NotFoundError');
        return { kind: 'file', name: f };
      },
      async *values() {
        for (const [k, v] of Object.entries(content)) yield typeof v === 'string' ? { kind: 'file', name: k } : v;
      },
    });
    const here = node('welcome-site', { 'Lowsper.html': '' });
    const old = node('welcome-site', { 'Lowsper.html': '' });
    const downloads = node('Downloads', {
      'welcome-site': node('welcome-site', { 'welcome-site': here }),
      'Lowsper-3.4.0': node('Lowsper-3.4.0', { 'Lowsper-3.4.0': old }),
    });
    L.isPageFolder = async (d) => d === here;
    const pick = async (dir) => {
      window.showDirectoryPicker = async () => dir;
      try {
        return (await L.pickLowsperFolder()) === here ? 'ok' : 'autre';
      } catch (e) {
        return e.code;
      }
    };
    return {
      parent: await pick(downloads),
      double: await pick(node('welcome-site', { 'welcome-site': here })),
      nothing: await pick(node('Documents', { 'notes.txt': '' })),
      otherOnly: await pick(node('Downloads', { 'Lowsper-3.4.0': node('Lowsper-3.4.0', { 'Lowsper-3.4.0': old }) })),
    };
  });
  assert.deepEqual(res, { parent: 'ok', double: 'ok', nothing: 'WRONG_FOLDER', otherOnly: 'OTHER_COPY' });
  assert.deepEqual(errors, []);
  await context.close();
});

await test('installation : le modèle choisi seulement, et un seul accord au dossier', async () => {
  for (const [choice, expected] of [
    ['whisper-small', ['whisper-small', 'whisper-base']],
    ['whisper-base', ['whisper-base']],
  ]) {
    const { context, page, errors } = await open({ threads: 8, memory: 8 });
    await page.check(`input[name="model-choice"][value="${choice}"]`);
    // Dossier, téléchargement et copie des réglages simulés : on relève ce que Lowsper demande
    await page.evaluate(() => {
      const L = window.Lowsper;
      window.__seen = { picks: 0, models: [], settingsFolder: null };
      const dir = { name: 'Lowsper' };
      L.pickLowsperFolder = async () => (window.__seen.picks++, dir);
      L.installModel = async (folder, m) => {
        window.__seen.models.push(m.id);
        window.__seen.sameFolder = folder === dir;
      };
      L.Settings.setFolder = async (folder) => (window.__seen.settingsFolder = folder === dir);
      L.Settings.save = async () => 'saved';
      window.location.reload = () => {}; // pas de rechargement en fin d'installation
    });
    await page.click('#install');
    await page.waitForFunction(() => /Démarrage/.test(document.getElementById('install-text').textContent));
    const seen = await page.evaluate(() => window.__seen);
    assert.deepEqual(seen.models, expected, choice);
    assert.equal(seen.picks, 1, 'une seule fenêtre de choix du dossier');
    assert.equal(seen.sameFolder, true);
    assert.equal(seen.settingsFolder, true, 'le même dossier sert à la copie des réglages');
    assert.deepEqual(errors, []);
    await context.close();
  }
});

await browser.close();
if (failed) {
  console.log(`\n${failed} test(s) en échec`);
  process.exit(1);
}
console.log('\nPremier lancement guidé conforme.');
