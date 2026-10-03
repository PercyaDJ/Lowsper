// Test de bout en bout : ouvre Lowsper.html en file:// dans Chromium, simule une réunion
// (micro = extrait français, son des participants = extrait anglais), puis vérifie le
// transcript Markdown téléchargé et l'absence de toute requête réseau.
//
// Usage : node test/e2e.mjs [durée_en_secondes]
import { chromium } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(here, 'output');
await mkdir(out, { recursive: true });
const meetingSeconds = Number(process.argv[2] || 45);

// Le son « participants » est injecté en remplaçant getDisplayMedia (impossible en headless)
const othersWav = await readFile(join(here, 'fixtures', 'others-en.wav'));
const othersPcm = othersWav.subarray(44).toString('base64'); // PCM 16 bits, 16 kHz, mono

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${join(here, 'fixtures', 'mic-fr.wav')}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 900, height: 1000 } });
const page = await context.newPage();

const network = [];
page.on('request', (r) => {
  const u = r.url();
  if (!/^(file|blob|data):/.test(u)) network.push(u);
});
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[page ${m.type()}]`, m.text());
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.addInitScript((pcmB64) => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const ctx = new AudioContext();
    const bytes = Uint8Array.from(atob(pcmB64), (c) => c.charCodeAt(0));
    const pcm = new Int16Array(bytes.buffer);
    const buf = ctx.createBuffer(1, pcm.length, 16000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const dest = ctx.createMediaStreamDestination();
    src.connect(dest);
    src.start(ctx.currentTime + 2);
    const canvas = document.createElement('canvas');
    const video = canvas.captureStream(1).getVideoTracks();
    return new MediaStream([...dest.stream.getAudioTracks(), ...video]);
  };
}, othersPcm);

const t0 = Date.now();
await page.goto(pathToFileURL(join(root, 'Lowsper.html')).href);
await page.screenshot({ path: join(out, '1-chargement.png') });
await page.waitForSelector('#engine[data-state="ready"]', { timeout: 180000 });
console.log(`Moteur prêt en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await page.screenshot({ path: join(out, '2-accueil.png') });

await page.fill('#title', 'Test automatique');
await page.click('details.options summary');
await page.selectOption('#language', 'auto');
await page.click('#start');
await page.waitForSelector('#view-rec:not([hidden])');
console.log(`Réunion simulée pendant ${meetingSeconds} s...`);
let maxBacklog = 0;
for (let waited = 0; waited < meetingSeconds; waited += 2) {
  await page.waitForTimeout(2000);
  const backlog = await page.evaluate(() => LowsperApp.queue.length + LowsperApp.inFlight);
  maxBacklog = Math.max(maxBacklog, backlog);
}
console.log(`File d'attente maximale pendant la réunion : ${maxBacklog} passage(s)`);
await page.screenshot({ path: join(out, '3-enregistrement.png') });

const downloadPromise = page.waitForEvent('download', { timeout: 180000 });
const tStop = Date.now();
await page.click('#stop');
const download = await downloadPromise;
console.log(`Transcript final ${((Date.now() - tStop) / 1000).toFixed(1)} s après « Terminer »`);
const mdPath = join(out, download.suggestedFilename());
await download.saveAs(mdPath);
await page.screenshot({ path: join(out, '4-termine.png'), fullPage: true });
const md = await readFile(mdPath, 'utf8');
console.log('----- ' + download.suggestedFilename() + ' -----\n' + md + '-----');

// Thème sombre
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForTimeout(500);
await page.screenshot({ path: join(out, '5-termine-sombre.png'), fullPage: true });
await browser.close();

const checks = [
  ['titre', md.startsWith('# Transcript de réunion : Test automatique')],
  ['horodatage', /\*\*\[00:00:\d\d\] /.test(md)],
  ['voix micro (Vous)', /\] Vous :\*\*/.test(md)],
  ['voix participants', /\] Participants :\*\*/.test(md)],
  ['contenu français', /aime/i.test(md)],
  ['contenu anglais', /country/i.test(md)],
  ['aucune requête réseau', network.length === 0],
  ['le moteur suit le rythme (file <= 3)', maxBacklog <= 3],
];
let ok = true;
for (const [name, pass] of checks) {
  console.log(`${pass ? 'OK  ' : 'ÉCHEC'} ${name}`);
  ok &&= pass;
}
if (network.length) console.log('Requêtes réseau détectées :', network);
await writeFile(join(out, 'resultat.txt'), checks.map(([n, p]) => `${p ? 'OK' : 'ECHEC'} ${n}`).join('\n'));
process.exit(ok ? 0 : 1);
