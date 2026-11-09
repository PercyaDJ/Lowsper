// Captures d'écran de la documentation (docs/images), sur une réunion entièrement fictive.
//
// Rejoue le corpus synthétique « hebdo » (voix de synthèse, noms inventés) dans la vraie page,
// avec le vrai moteur, puis capture l'accueil, l'enregistrement, la barre réduite et l'écran de fin
// (thèmes clair et sombre), la fenêtre « Avant de commencer », l'import d'un fichier, les trois onglets
// des paramètres, le format de note, la sonde de l'IA intégrée, les paramètres en anglais et l'écran
// de bienvenue (matériel simulé), à double résolution. Aucune donnée réelle ne peut y apparaître.
//
// Prérequis : node build.mjs --embed whisper-small   (CHROMIUM_PATH si besoin)
// Usage : node test/screenshots.mjs
import { chromium } from 'playwright-core';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(root, 'docs', 'images');
await mkdir(out, { recursive: true });
const corpus = JSON.parse(await readFile(join(here, 'corpus', 'hebdo-fr.json'), 'utf8'));
const othersPcm = (await readFile(join(here, 'corpus', 'hebdo-others.wav'))).subarray(44).toString('base64');
const SECONDS = 100;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${join(here, 'corpus', 'hebdo-me.wav')}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const context = await browser.newContext({
  // Captures de la documentation française
  locale: 'fr-FR',
  viewport: { width: 900, height: 760 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
const network = [];
page.on('request', (r) => {
  if (!/^(file|blob|data):/.test(r.url())) network.push(r.url());
});
await page.addInitScript((pcmB64) => {
  // Pas de mini-fenêtre automatique : on capture la page elle-même
  localStorage.setItem('lowsper.opt.autopip', '0');
  // Réunion fictive à 6 personnes (réglage « Nombre de personnes »)
  localStorage.setItem('lowsper.opt.people', '6');
  // Texte en direct affiché (interrupteur de la fenêtre de réunion), pour la capture
  localStorage.setItem('lowsper.opt.showLive', '1');
  // Le son des participants remplace le partage d'écran (impossible sans écran)
  navigator.mediaDevices.getDisplayMedia = async () => {
    const ctx = new AudioContext();
    const bytes = Uint8Array.from(atob(pcmB64), (c) => c.charCodeAt(0));
    const pcm = new Int16Array(bytes.buffer);
    const buf = ctx.createBuffer(1, pcm.length, 16000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const dest = ctx.createMediaStreamDestination();
    src.connect(dest);
    src.start();
    const video = document.createElement('canvas').captureStream(1).getVideoTracks();
    return new MediaStream([...dest.stream.getAudioTracks(), ...video]);
  };
}, othersPcm);

await page.goto(pathToFileURL(join(root, 'Lowsper.html')).href);
await page.waitForSelector('#engine[data-state="ready"]', { timeout: 300000 });
await page.click('#settings-open');
await page.click('[data-open="glossary"]');
await page.fill('#glossary', corpus.glossary);
await page.click('#page-glossary [data-back]');
await page.click('#settings-close');
// Explication avant la fenêtre de choix du dossier Lowsper (§57), avec un chemin Windows fictif
await page.waitForSelector('#folder-ask[open]');
await page.evaluate(
  () => (document.getElementById('folder-ask-path').textContent = 'C:\\Users\\utilisateur\\Downloads\\Lowsper')
);
await page.waitForTimeout(300);
await page.locator('#folder-ask').screenshot({ path: join(out, 'dossier.png') });
await page.click('#folder-ask-later');
await page.fill('#title', 'Point hebdo du centre de service');
// Accueil tel que le voit l'utilisateur après l'installation, dossier Lowsper accordé : sans la
// proposition « Choisir le dossier Lowsper » d'un navigateur qui n'y a pas encore accès (§52)
await page.evaluate(() => (document.getElementById('profile-access').hidden = true));
await page.screenshot({ path: join(out, 'accueil.png') });

// Test du son de la réunion (§56) : la fenêtre telle qu'elle s'ouvre depuis l'accueil
await page.click('#sound-check-btn');
await page.waitForSelector('#sound-test[open]');
await page.waitForTimeout(300);
await page.locator('#sound-test').screenshot({ path: join(out, 'test-son.png') });
await page.click('#sound-test-close');

// « Avant de commencer », capturée puis passée
await page.click('#start');
await page.waitForSelector('#before[open]');
await page.waitForTimeout(300);
await page.screenshot({ path: join(out, 'avant.png') });
await page.click('#before-continue');
await page.waitForSelector('#view-rec:not([hidden])');
// Capture dès que le transcript en direct montre quelques interventions
const t0 = Date.now();
while (Date.now() - t0 < SECONDS * 1000 * 0.8) {
  const shown = await page.evaluate(() => document.querySelectorAll('#live > :not(.placeholder)').length);
  if (shown >= 4) break;
  await page.waitForTimeout(1000);
}
await page.screenshot({ path: join(out, 'enregistrement.png') });
// Notes rapides (lot C2) : deux notes fictives tapées pendant la réunion, Entrée pour ajouter
for (const note of ['Vérifier le chiffre du budget T3 avec la finance', 'Relancer le prestataire pour le devis']) {
  await page.fill('#qn-input', note);
  await page.press('#qn-input', 'Enter');
  await page.waitForTimeout(1500);
}
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await page.locator('#qn-form').screenshot({ path: join(out, 'notes-rapides.png') });
// Fenêtre très basse : la mini-barre, la même que dans la mini-fenêtre (248 × 52)
await page.setViewportSize({ width: 248, height: 52 });
await page.waitForTimeout(500);
await page.screenshot({ path: join(out, 'barre.png') });
await page.setViewportSize({ width: 900, height: 760 });
await page.waitForTimeout(Math.max(0, SECONDS * 1000 - (Date.now() - t0)));

await page.click('#stop');
await page.waitForSelector('#view-done:not([hidden])', { timeout: 300000 });
for (let i = 0; i < 120; i++) {
  if (!(await page.evaluate(() => LowsperApp.transcript.draftCount()))) break;
  await page.waitForTimeout(2000);
}
// Les voix reçoivent des prénoms fictifs, comme le ferait l'utilisateur
const names = ['Claire', 'Julien', 'Sophie', 'Karim', 'Nathalie'];
// Renommage directement sur les répliques (lot R6) : une voix après l'autre, dans l'ordre
const voices = await page.$$eval('#done-lines button.chip', (els) => [...new Set(els.map((e) => e.dataset.voice))]);
for (let i = 0; i < voices.length && i < names.length; i++) {
  await page.click(`#done-lines button.chip[data-voice="${voices[i]}"]`);
  await page.keyboard.type(names[i]);
  await page.keyboard.press('Enter');
}
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await page.waitForTimeout(300);
await page.screenshot({ path: join(out, 'fin.png'), fullPage: true });
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForTimeout(300);
await page.screenshot({ path: join(out, 'fin-sombre.png'), fullPage: true });
await page.emulateMedia({ colorScheme: 'light' });
// Compte rendu extractif (lot C1) : section produite par le vrai code (Transcript.summary) sur le
// texte de l'hebdo fictif (corpus/hebdo.truth.json), avec ses heures, affichée dans la fenêtre
// « Voir ce qui est copié ». La courte réunion des captures n'a presque aucune décision.
const hebdo = JSON.parse(await readFile(join(here, 'corpus', 'hebdo.truth.json'), 'utf8'));
await page.click('#ai-see');
await page.waitForSelector('#ai-dialog[open]');
await page.evaluate((lines) => {
  const t = new Lowsper.Transcript({ sources: ['me', 'others'], noteLang: 'fr' });
  t.lines = lines.map((l) => ({ source: l.channel, start: l.start, end: l.end, text: l.ref, voice: l.who }));
  t.meta.names = Object.fromEntries(lines.map((l) => [l.who, l.who]));
  const pre = document.getElementById('ai-preview');
  pre.textContent = t.summary();
  pre.scrollTop = 0;
}, hebdo);
await page.locator('#ai-dialog').screenshot({ path: join(out, 'compte-rendu.png') });
await page.click('#ai-dialog-close');

// Import d'enregistrements faits ailleurs : écran d'avancement
await page.click('#again');
await page.waitForSelector('#view-idle:not([hidden])');
const fixtures = join(here, 'fixtures', 'import');
await page.setInputFiles('#import-input', [join(fixtures, 'extrait.m4a'), join(fixtures, 'extrait.ogg')]);
await page.waitForSelector('#view-import:not([hidden])');
await page.waitForFunction(() => /restantes|%/.test(document.getElementById('import-text').textContent), null, {
  timeout: 60000,
});
await page.waitForTimeout(1500);
await page.screenshot({ path: join(out, 'import.png') });
await page.click('#import-cancel');
await page.waitForSelector('#view-idle:not([hidden])', { timeout: 120000 });

// Paramètres : les trois onglets (glossaire du corpus fictif, emplacement fictif « Travail »)
await page.click('#settings-open');
await page.waitForTimeout(300);
await page.locator('#settings').screenshot({ path: join(out, 'reglages.png') });
// Langues parlées (lot R8) : français et anglais cochés, réunions mixtes
await page.click('[data-open="language"]');
await page.click('#language [data-value="en"]');
await page.waitForTimeout(300);
await page.locator('#settings').screenshot({ path: join(out, 'langues-parlees.png') });
await page.click('#language [data-value="en"]');
await page.click('#page-language [data-back]');
// Vocabulaires métier : deux domaines cochés
await page.click('[data-open="vocab"]');
for (const id of ['sante', 'juridique']) await page.click(`#vocab-list [data-value="${id}"]`);
await page.waitForTimeout(300);
await page.locator('#settings').screenshot({ path: join(out, 'vocabulaires.png') });
for (const id of ['sante', 'juridique']) await page.click(`#vocab-list [data-value="${id}"]`);
await page.click('#page-vocab [data-back]');
await page.click('#tab-notes');
await page.click('#prof-new');
await page.keyboard.type('Travail');
await page.click('#page-place [data-back]');
await page.waitForTimeout(300);
await page.locator('#settings').screenshot({ path: join(out, 'reglages-notes.png') });
// Format de la note « Pour les applications de notes » : propriétés, étiquettes, liens
await page.click('[data-open="format"]');
await page.check('#prof-links');
await page.fill('#prof-tags', 'reunion, travail');
await page.fill('#prof-extra', 'projet: Atlas');
await page.evaluate(() => document.querySelector('#page-format .settings-body').scrollTo(0, 0));
await page.waitForTimeout(300);
await page.locator('#settings').screenshot({ path: join(out, 'profils.png') });
await page.click('#page-format [data-back]');
await page.click('#tab-advanced');
await page.waitForTimeout(300);
await page.locator('#settings').screenshot({ path: join(out, 'reglages-avance.png') });

// Sonde de l'IA intégrée : réponse simulée d'un navigateur qui peut télécharger son modèle (le
// Chromium de capture n'a pas d'IA intégrée) ; seul l'état est capturé, pas un résultat d'essai
await page.evaluate(() => {
  window.Summarizer = { availability: async () => 'downloadable' };
  window.LanguageModel = { availability: async () => 'downloadable' };
});
await page.click('[data-open="lai"]');
await page.click('#lai-probe');
await page.waitForFunction(() => !document.getElementById('lai-trial').hidden);
await page.waitForTimeout(300);
await page.locator('#settings').screenshot({ path: join(out, 'sonde-ia.png') });
await page.click('#page-lai [data-back]');

// Langue de l'interface : bascule en anglais, onglet « Transcription » des paramètres
await page.click('#tab-transcription');
await page.click('[data-open="ui-lang"]');
await page.click('#ui-lang [data-value="en"]');
await page.click('#page-ui-lang [data-back]');
await page.waitForTimeout(300);
await page.locator('#settings').screenshot({ path: join(out, 'langue.png') });
await page.click('[data-open="ui-lang"]');
await page.click('#ui-lang [data-value="fr"]');
await page.click('#page-ui-lang [data-back]');
await page.click('#settings-close');
if (await page.waitForSelector('#folder-ask[open]', { timeout: 1000 }).catch(() => null))
  await page.click('#folder-ask-later');

// Écran de bienvenue (premier lancement) : copie du dossier sans modèle, PC simulé à 8 fils,
// 8 Go et sans carte graphique (configuration courante d'un portable de bureau)
const welcomeSite = join(here, 'output', 'shots-welcome');
await rm(welcomeSite, { recursive: true, force: true });
await mkdir(join(welcomeSite, 'app', 'models'), { recursive: true });
await cp(join(root, 'Lowsper.html'), join(welcomeSite, 'Lowsper.html'));
for (const d of ['css', 'js']) await cp(join(root, 'app', d), join(welcomeSite, 'app', d), { recursive: true });
await cp(join(root, 'app', 'manifest.js'), join(welcomeSite, 'app', 'manifest.js'));
const welcome = await context.newPage();
await welcome.addInitScript(() => {
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
  Object.defineProperty(navigator, 'gpu', { get: () => undefined });
});
await welcome.goto(pathToFileURL(join(welcomeSite, 'Lowsper.html')).href);
await welcome.waitForSelector('#view-install:not([hidden])');
await welcome.waitForFunction(() => !/…/.test(document.getElementById('hw-chips').textContent));
// Chemin d'exemple, sans rien de la machine de capture
await welcome.evaluate(
  () =>
    (document.getElementById('install-folder').textContent = 'C:\\Users\\vous\\Downloads\\Lowsper-4.2.1\\Lowsper-4.2.1')
);
await welcome.evaluate(() => (document.getElementById('temp-warning').hidden = true));
await welcome.screenshot({ path: join(out, 'bienvenue.png'), fullPage: true });
await welcome.close();
await browser.close();

if (network.length) {
  console.log('Requêtes réseau inattendues :', network);
  process.exit(1);
}
console.log(`Captures écrites dans ${out} (aucune requête réseau).`);
