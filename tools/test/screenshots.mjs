// Captures d'écran de la documentation (docs/images), sur une réunion entièrement fictive.
//
// Rejoue le corpus synthétique « hebdo » (voix de synthèse, noms inventés) dans la vraie page,
// avec le vrai moteur, puis capture l'accueil, l'enregistrement, la barre réduite et l'écran de fin
// (thèmes clair et sombre), à double résolution. Aucune donnée réelle ne peut y apparaître.
//
// Prérequis : node build.mjs --embed whisper-small   (CHROMIUM_PATH si besoin)
// Usage : node test/screenshots.mjs
import { chromium } from 'playwright-core';
import { mkdir, readFile } from 'node:fs/promises';
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
const context = await browser.newContext({ viewport: { width: 900, height: 760 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const network = [];
page.on('request', (r) => {
  if (!/^(file|blob|data):/.test(r.url())) network.push(r.url());
});
await page.addInitScript((pcmB64) => {
  // Pas de mini-fenêtre automatique : on capture la page elle-même
  localStorage.setItem('lowsper.opt.autopip', '0');
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
await page.fill('#glossary', corpus.glossary);
await page.click('#settings-close');
await page.fill('#title', 'Point hebdo du centre de service');
await page.fill('#people', '6');
await page.screenshot({ path: join(out, 'accueil.png') });

await page.click('#start');
await page.waitForSelector('#view-rec:not([hidden])');
// Capture dès que le transcript en direct montre quelques interventions
const t0 = Date.now();
while (Date.now() - t0 < SECONDS * 1000 * 0.8) {
  const shown = await page.evaluate(() => document.querySelectorAll('#live > :not(.placeholder)').length);
  if (shown >= 4) break;
  await page.waitForTimeout(1000);
}
await page.screenshot({ path: join(out, 'enregistrement.png') });
// Fenêtre très basse : la barre façon appel en cours
await page.setViewportSize({ width: 380, height: 64 });
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
const inputs = await page.$$('#voice-list input');
for (let i = 0; i < inputs.length && i < names.length; i++) await inputs[i].fill(names[i]);
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await page.waitForTimeout(300);
await page.screenshot({ path: join(out, 'fin.png'), fullPage: true });
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForTimeout(300);
await page.screenshot({ path: join(out, 'fin-sombre.png'), fullPage: true });
await browser.close();

if (network.length) {
  console.log('Requêtes réseau inattendues :', network);
  process.exit(1);
}
console.log(`Captures écrites dans ${out} (aucune requête réseau).`);
