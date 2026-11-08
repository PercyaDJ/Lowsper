// Accueil (lot R4, decision.md §27), dans la vraie page ouverte en file://, sur une copie du
// dossier Lowsper : un modèle est déclaré installé pour que l'accueil s'affiche, sans moteur.
//
// 1. Écran : un titre, « Nom », « Enregistrer la note dans », « Démarrer », le lien d'import ;
//    plus de bandeau jaune ni de « Comment ça marche », plus de champ « Personnes ».
// 2. Menu « Enregistrer la note dans » (composant commun) : coche, dossier en sous-titre,
//    « Nouvel emplacement… », clavier (flèches, Entrée, Échap), choix gardé après rechargement.
// 3. « Démarrer » : fenêtre « Avant de commencer » (trois étapes), Annuler, Continuer, et
//    « Ne plus afficher » ; Entrée dans le nom suit le même chemin.
// 4. « Nombre de personnes » dans les paramètres : gardé, vide par défaut (automatique).
// 5. Navigateur sans accès au dossier Lowsper : « Choisir le dossier Lowsper » proposé (§52).
// Aucune erreur de page, aucune requête réseau.
//
// Usage : node test/home.mjs   (CHROMIUM_PATH si besoin ; aucun modèle requis)
import { chromium } from 'playwright-core';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const site = join(here, 'output', 'home-site');
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
// Un seul contexte : le stockage (profils, choix) survit aux rechargements, comme chez l'utilisateur
const context = await browser.newContext({ locale: 'fr-FR', viewport: { width: 900, height: 900 } });
const page = await context.newPage();
const errors = [];
const requests = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('request', (r) => {
  if (!/^(file|data|blob):/.test(r.url())) requests.push(r.url());
});
// Modèle déclaré installé : l'accueil s'affiche (le moteur, absent, ne démarre pas)
await page.addInitScript(() => (window.LOWSPER_INSTALLED = [{ id: 'whisper-small', label: 'Whisper small' }]));
// Démarrage simulé : on relève les demandes de partage d'écran sans en ouvrir
await page.addInitScript(() => {
  window.__shares = 0;
  navigator.mediaDevices.getDisplayMedia = async () => {
    window.__shares++;
    throw Object.assign(new Error('refus simulé'), { name: 'NotAllowedError' });
  };
  navigator.mediaDevices.getUserMedia = async () => {
    throw Object.assign(new Error('refus simulé'), { name: 'NotAllowedError' });
  };
});

async function load() {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#view-idle:not([hidden])');
  // Moteur absent : on le déclare prêt pour que « Démarrer » aille jusqu'au partage d'écran
  await page.waitForFunction(() => window.LowsperApp && window.LowsperApp.engineError);
  await page.evaluate(() => {
    window.LowsperApp.engineError = null;
    window.LowsperApp.engineReady = true;
    // Copie des réglages dans le dossier (à la fermeture des paramètres) : hors sujet ici, et elle
    // ouvrirait la fenêtre de choix du dossier
    window.Lowsper.Settings.save = async () => 'unchanged';
  });
}
await load();

await test('écran : titre, deux lignes, Démarrer, lien d’import ; bandeau et mode d’emploi retirés', async () => {
  assert.equal(await page.textContent('#view-idle h1'), 'Enregistrer une réunion');
  assert.equal(await page.getAttribute('#title', 'placeholder'), 'Facultatif');
  assert.equal(await page.textContent('#place-current'), 'Par défaut');
  assert.match(await page.textContent('#start'), /Démarrer/);
  assert.match(await page.textContent('#import-pick'), /Transcrire un fichier audio/);
  for (const sel of ['#consent', '#howto-idle', '#view-idle #people', '#profile'])
    assert.equal(await page.$(sel), null, sel + ' devrait avoir disparu');
  assert.equal((await page.textContent('#privacy-pill')).trim(), 'Reste sur ce PC');
});

await test('menu « Enregistrer la note dans » : coche, dossier, clavier, choix gardé', async () => {
  // Deux profils, dont un avec dossier (créés comme le ferait l'utilisateur dans les paramètres)
  await page.evaluate(() => {
    const N = window.Lowsper.Notes;
    const p = Object.assign(N.newProfile('Travail', N.list()), { folderName: 'Coffre-notes' });
    N.saveAll([...N.list(), p]);
  });
  await load();
  await page.focus('#place-btn');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.getAttribute('#place-btn', 'aria-expanded'), 'true');
  const items = await page.$$eval('#place-list [role="menuitemradio"]', (b) =>
    b.map((x) => ({ text: x.textContent, checked: x.getAttribute('aria-checked') }))
  );
  assert.deepEqual(items, [
    { text: '✓Par défautVos Téléchargements', checked: 'true' },
    { text: '✓TravailDossier « Coffre-notes »', checked: 'false' },
  ]);
  assert.equal(await page.textContent('#place-list [role="menuitem"]'), 'Nouvel emplacement…');
  // Le focus est sur le choix actuel ; flèche bas puis Entrée choisit « Travail »
  assert.equal(await page.evaluate(() => document.activeElement.textContent), '✓Par défautVos Téléchargements');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.equal(await page.isHidden('#place-list'), true);
  assert.equal(await page.textContent('#place-current'), 'Travail');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'place-btn');
  // Échap referme sans changer
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  assert.equal(await page.isHidden('#place-list'), true);
  // Gardé après rechargement
  await load();
  assert.equal(await page.textContent('#place-current'), 'Travail');
});

await test('« Nouvel emplacement… » : un nouvel emplacement, sa page ouverte dans les paramètres', async () => {
  await page.click('#place-btn');
  await page.click('#place-list [role="menuitem"]');
  await page.waitForSelector('#settings[open]');
  assert.equal(await page.isVisible('#page-place'), true);
  assert.equal(await page.inputValue('#prof-name'), 'Nouvel emplacement');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'prof-name');
  assert.equal(await page.evaluate(() => window.Lowsper.Notes.list().length), 3);
  // Échap : retour à l'onglet « Notes et compte rendu », puis fermeture
  await page.keyboard.press('Escape');
  assert.equal(await page.isVisible('#tp-notes'), true);
  await page.click('#settings-close');
});

await test('« Démarrer » : fenêtre « Avant de commencer », Annuler puis Continuer', async () => {
  await page.click('#start');
  await page.waitForSelector('#before[open]');
  const steps = await page.$$eval('#before .steps strong', (s) => s.map((x) => x.textContent));
  assert.deepEqual(steps, [
    'Prévenez les autres participants',
    "Choisissez l'écran de la réunion",
    'Autorisez le micro',
  ]);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'before-continue');
  await page.click('#before-cancel');
  assert.equal(await page.isHidden('#before'), true);
  assert.equal(await page.evaluate(() => window.__shares), 0, 'Annuler ne démarre rien');
  // Entrée dans le nom : même chemin ; Échap ferme la fenêtre
  await page.focus('#title');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#before[open]');
  await page.keyboard.press('Escape');
  assert.equal(await page.isHidden('#before'), true);
  // Continuer : le partage d'écran est demandé (refusé ici)
  await page.click('#start');
  await page.click('#before-continue');
  await page.waitForFunction(() => window.__shares === 1);
  assert.equal(await page.isHidden('#before'), true);
});

await test('« Ne plus afficher » : la fenêtre ne revient plus, sauf si on la remet', async () => {
  await page.click('#start');
  await page.check('#before-skip');
  await page.click('#before-continue');
  await page.waitForFunction(() => window.__shares === 2);
  assert.equal(await page.evaluate(() => localStorage.getItem('lowsper.opt.skipBefore')), '1');
  await page.click('#start');
  await page.waitForFunction(() => window.__shares === 3);
  assert.equal(await page.isHidden('#before'), true);
  // Paramètres : l'interrupteur la remet
  await page.click('#settings-open');
  assert.equal(await page.isChecked('#show-before'), false);
  await page.click('label:has(#show-before)');
  await page.click('#settings-close');
  await page.click('#start');
  await page.waitForSelector('#before[open]');
  await page.click('#before-cancel');
});

await test('« Nombre de personnes » dans les paramètres : automatique par défaut, gardé', async () => {
  await page.click('#settings-open');
  assert.equal(await page.textContent('#v-people'), 'Automatique');
  await page.click('[data-open="people"]');
  assert.equal(await page.inputValue('#people'), '');
  assert.equal(await page.getAttribute('#people', 'placeholder'), 'Automatique');
  assert.match(await page.textContent('#people-help'), /plafond/);
  await page.fill('#people', '6');
  await page.click('#page-people [data-back]');
  assert.equal(await page.textContent('#v-people'), '6');
  await page.click('#settings-close');
  await load();
  assert.equal(await page.inputValue('#people'), '6');
  assert.equal(await page.evaluate(() => localStorage.getItem('lowsper.opt.people')), '6');
});

await test('nouveau navigateur sans accès au dossier Lowsper : un clic proposé, une fois (§52)', async () => {
  // Emplacement « Par défaut » (dossier Lowsper/Notes/...), comme au premier lancement
  await page.evaluate(() => localStorage.removeItem('lowsper.profile'));
  await load();
  await page.waitForSelector('#profile-access:not([hidden])');
  assert.match(await page.textContent('#profile-access-text'), /pas encore accès au dossier Lowsper/);
  assert.equal(await page.textContent('#profile-allow'), 'Choisir le dossier Lowsper');
  assert.equal(await page.isVisible('#profile-allow'), true);
  // Navigateur qui ne sait pas écrire dans un dossier (Brave par défaut, Firefox) : le dire, sans bouton
  const other = await context.newPage();
  await other.addInitScript(() => {
    window.LOWSPER_INSTALLED = [{ id: 'whisper-small', label: 'Whisper small' }];
    delete window.showDirectoryPicker;
  });
  await other.goto(url);
  await other.waitForSelector('#profile-access:not([hidden])');
  assert.match(await other.textContent('#profile-access-text'), /Téléchargements/);
  assert.equal(await other.isVisible('#profile-allow'), false);
  await other.close();
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
console.log('\nAccueil conforme.');
