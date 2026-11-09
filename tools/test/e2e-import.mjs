// Test de bout en bout de l'import de fichiers audio, dans la vraie page et avec le vrai moteur.
//   1. file de trois fichiers (M4A, MP3, fichier invalide) choisis par le bouton ;
//   2. deux transcripts téléchargés, en-tête « Source : fichier », date d'enregistrement du M4A,
//      texte reconnu, voix distinguées ; l'échec du fichier invalide est signalé ;
//   3. annulation en cours de route : retour à l'accueil, rien de téléchargé ;
//   4. aucune requête réseau.
// Prérequis : node build.mjs --embed whisper-small   (CHROMIUM_PATH si besoin)
// Usage : node test/e2e-import.mjs
import { chromium } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(here, 'output');
const fixtures = join(here, 'fixtures', 'import');
await mkdir(out, { recursive: true });
const bogus = join(out, 'pas-un-son.mp3');
await writeFile(bogus, 'Ceci est un fichier texte, pas un enregistrement.'.repeat(20));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const context = await browser.newContext({
  // Interface en français : les vérifications portent sur les textes français (decision.md §25)
  locale: 'fr-FR',
  acceptDownloads: true,
  viewport: { width: 900, height: 900 },
});
const page = await context.newPage();
const network = [];
page.on('request', (r) => {
  if (!/^(file|blob|data):/.test(r.url())) network.push(r.url());
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const downloads = [];
page.on('download', (d) => downloads.push(d));

await page.goto(pathToFileURL(join(root, 'Lowsper.html')).href);
await page.waitForSelector('#engine[data-state="ready"]', { timeout: 300000 });
await page.click('#settings-open');
await page.click('[data-open="glossary"]');
await page.fill('#glossary', 'ServiceNow, COPIL, KPI');
await page.click('#page-glossary [data-back]');
await page.click('#settings-close');
// Sans accord pour le dossier Lowsper : explication avant la fenêtre de choix (§57), « Plus tard »
if (await page.waitForSelector('#folder-ask[open]', { timeout: 1500 }).catch(() => null))
  await page.click('#folder-ask-later');

let failed = 0;
const check = (ok, name, detail = '') => {
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ' : ' + detail : ''}`);
  if (!ok) failed++;
};

// 1. Trois fichiers d'un coup, par le bouton « Transcrire un fichier »
const t0 = Date.now();
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#import-pick')]);
await chooser.setFiles([join(fixtures, 'extrait.m4a'), join(fixtures, 'extrait.mp3'), bogus]);
await page.waitForSelector('#view-import:not([hidden])');
await page.waitForTimeout(3000);
await page.screenshot({ path: join(out, 'import-en-cours.png') });
const progressSeen = await page.evaluate(() => document.getElementById('import-text').textContent);
await page.waitForSelector('#view-done:not([hidden])', { timeout: 600000 });
console.log(`Trois fichiers traités en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
await page.screenshot({ path: join(out, 'import-fin.png'), fullPage: true });

for (let i = 0; i < 20 && downloads.length < 2; i++) await page.waitForTimeout(500);
const files = {};
for (const d of downloads) {
  const p = join(out, 'import-' + d.suggestedFilename());
  await d.saveAs(p);
  files[d.suggestedFilename()] = await readFile(p, 'utf8');
}
const names = Object.keys(files);
const m4a = Object.entries(files).find(([, md]) => md.includes('fichier « extrait.m4a »'));
const mp3 = Object.entries(files).find(([, md]) => md.includes('fichier « extrait.mp3 »'));
check(downloads.length === 2, 'deux transcripts téléchargés, un par fichier valide', names.join(', '));
check(
  !!m4a && /\*\*Enregistré le\*\* : samedi 14 mars 2026/.test(m4a[1]),
  "date d'enregistrement du M4A dans l'en-tête"
);
check(!!m4a && /2026-03-14/.test(m4a[0]), "nom du fichier daté du jour de l'enregistrement", m4a && m4a[0]);
check(
  !!mp3 && /\*\*Date du fichier\*\*/.test(mp3[1]),
  'MP3 sans date interne : date du fichier, présentée comme telle'
);
check(!!m4a && /\*\*Durée\*\* : 20 s/.test(m4a[1]), 'durée du fichier');
check(
  !!m4a && /bonjour à tous/i.test(m4a[1]) && /centre de service/i.test(m4a[1]),
  'texte reconnu',
  m4a && (m4a[1].match(/\*\*\[00:00:\d\d\][^\n]*/) || [''])[0].slice(0, 90)
);
check(!!m4a && /\*\*Couverture\*\* : toute la parole détectée a été transcrite/.test(m4a[1]), 'couverture totale');
check(!!m4a && !/« Vous »/.test(m4a[1]), 'pas de « Vous » (micro) dans un enregistrement importé');
check(!!m4a && /Intervenant \d|Participant/.test(m4a[1]), 'voix distinguées');
const info = await page.textContent('#done-info');
check(
  /pas-un-son\.mp3/.test(info) && /non transcrit/.test(info),
  "échec du fichier invalide signalé à l'écran",
  info.slice(0, 160)
);
check(/%/.test(progressSeen), 'avancement affiché pendant le traitement', progressSeen);

// 2. Annulation : un fichier plus long, annulé après quelques secondes
await page.click('#again');
await page.waitForSelector('#view-idle:not([hidden])');
const long = join(out, 'import-annulation.wav');
const wav = await readFile(join(fixtures, 'extrait.wav'));
// 6 fois l'extrait : en-tête WAV d'origine (jusqu'au bloc « data »), données répétées, tailles corrigées
const at = wav.indexOf('data') + 8;
const data = Buffer.concat(Array(6).fill(wav.subarray(at)));
const header = Buffer.from(wav.subarray(0, at));
header.writeUInt32LE(header.length - 8 + data.length, 4);
header.writeUInt32LE(data.length, at - 4);
await writeFile(long, Buffer.concat([header, data]));
const before = downloads.length;
await page.setInputFiles('#import-input', long);
await page.waitForSelector('#view-import:not([hidden])');
await page.waitForTimeout(4000);
await page.click('#import-cancel');
await page.waitForSelector('#view-idle:not([hidden])', { timeout: 120000 });
await page.waitForTimeout(1000);
check(downloads.length === before, 'annulation : retour à l’accueil, aucun transcript téléchargé');
const queueLeft = await page.evaluate(() => LowsperApp.queue.length);
check(queueLeft === 0, 'annulation : file de transcription vidée', String(queueLeft));

await browser.close();
check(network.length === 0, 'aucune requête réseau', network.join(', '));
if (failed) {
  console.log(`\n${failed} vérification(s) en échec.`);
  process.exit(1);
}
console.log('\nImport de fichiers conforme.');
