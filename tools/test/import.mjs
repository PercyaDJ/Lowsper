// Décodage des fichiers importés, dans Chromium, avec la même politique de sécurité que Lowsper.
//   - chaque format de tools/test/fixtures/import est décodé en 16 kHz mono : durée exacte, et
//     enveloppe sonore identique à celle du WAV de référence (rien de décalé, rien de perdu) ;
//   - aucune requête réseau ;
//   - --long : fichiers synthétiques de 3 h (MP3, M4A, Ogg Opus) générés avec ffmpeg, décodés en
//     entier ; la mémoire de la page doit rester bornée (mesure du lot 1, decision.md §19).
// Usage : node test/import.mjs [--long]   (CHROMIUM_PATH si besoin)
import { chromium } from 'playwright-core';
import { execFileSync, execSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(here, 'output');
const fixtures = join(here, 'fixtures', 'import');
await mkdir(out, { recursive: true });
const csp = (await import('node:fs'))
  .readFileSync(join(root, 'Lowsper.html'), 'utf8')
  .match(/Content-Security-Policy" content="([^"]+)"/)[1];

// Le code de test est dans un fichier à part : la politique de Lowsper interdit les scripts en ligne
await writeFile(
  join(out, 'import.html'),
  `<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<input type="file" id="f" multiple>
<script src="../../../app/js/capture.js"></script>
<script src="../../../app/js/audiofile.js"></script>
<script src="import-page.js"></script>`
);
await writeFile(
  join(out, 'import-page.js'),
  `// Enveloppe : énergie moyenne par tranche de 10 ms
const envelope = (chunks) => {
  const env = []; let acc = 0, n = 0;
  for (const c of chunks) for (let i = 0; i < c.length; i++) { acc += c[i] * c[i]; if (++n === 160) { env.push(Math.sqrt(acc / n)); acc = 0; n = 0; } }
  return env;
};
window.decodeFile = async (i, keep) => {
  const file = document.getElementById('f').files[i];
  const t0 = performance.now();
  let meta = null, samples = 0;
  const chunks = [];
  for await (const c of Lowsper.AudioFile.decode(file, { onInfo: (m) => (meta = m) })) {
    samples += c.length;
    if (keep) chunks.push(c);
  }
  return { name: file.name, seconds: samples / 16000, ms: Math.round(performance.now() - t0), meta, env: keep ? envelope(chunks) : null };
};`
);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
const network = [];
page.on('request', (r) => {
  if (!/^(file|blob|data):/.test(r.url())) network.push(r.url());
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(pathToFileURL(join(out, 'import.html')).href);

let failed = 0;
const check = (ok, name, detail = '') => {
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ' : ' + detail : ''}`);
  if (!ok) failed++;
};
// Meilleure correspondance en décalant de -300 à +300 ms : les codecs MP3 et AAC ajoutent un délai
// d'amorçage au début du son ; on le mesure au lieu de le confondre avec une perte.
const bestLag = (a, b) => {
  let best = { c: -1, lag: 0 };
  for (let lag = -30; lag <= 30; lag++) {
    const c = corr(lag >= 0 ? a : a.slice(-lag), lag >= 0 ? b.slice(lag) : b);
    if (c > best.c) best = { c, lag: lag * 10 };
  }
  return best;
};
const corr = (a, b) => {
  const n = Math.min(a.length, b.length);
  let sa = 0,
    sb = 0;
  for (let i = 0; i < n; i++) ((sa += a[i]), (sb += b[i]));
  const ma = sa / n,
    mb = sb / n;
  let num = 0,
    da = 0,
    db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
};

const names = [
  'extrait.wav',
  'extrait.mp3',
  'extrait.aac',
  'extrait.m4a',
  'extrait.ogg',
  'extrait.webm',
  'extrait.flac',
];
await page.setInputFiles(
  '#f',
  names.map((n) => join(fixtures, n))
);
const ref = await page.evaluate(() => decodeFile(0, true));
for (let i = 0; i < names.length; i++) {
  const r = i ? await page.evaluate((k) => decodeFile(k, true), i) : ref;
  const { c, lag } = bestLag(ref.env, r.env);
  check(
    Math.abs(r.seconds - 20) < 0.15 && c > 0.97 && Math.abs(lag) <= 100,
    `${r.name} (${r.meta.method})`,
    `${r.seconds.toFixed(2)} s, enveloppe identique à ${(c * 100).toFixed(1)} %, décalage ${lag} ms, ${r.ms} ms`
  );
}
const m4a = await page.evaluate(() => decodeFile(3, false));
check(m4a.meta.recordedAt === Date.UTC(2026, 2, 14, 9, 30), "date d'enregistrement du M4A transmise");

if (process.argv.includes('--long')) {
  const rss = () =>
    Number(
      execSync("ps -eo rss,args | grep -- '--type=renderer' | grep -v grep | awk '{s+=$1} END {print s}'").toString()
    ) / 1024;
  const src = join(fixtures, 'extrait.wav');
  for (const [ext, codec] of [
    ['mp3', ['-c:a', 'libmp3lame', '-b:a', '64k']],
    ['m4a', ['-c:a', 'aac', '-b:a', '64k']],
    ['ogg', ['-c:a', 'libopus', '-b:a', '32k']],
  ]) {
    const f = join(out, `long-3h.${ext}`);
    if (!existsSync(f))
      execFileSync('ffmpeg', [
        '-loglevel',
        'error',
        '-y',
        '-stream_loop',
        '539',
        '-i',
        src,
        '-t',
        '10800',
        ...codec,
        f,
      ]);
    await page.setInputFiles('#f', f);
    const before = rss();
    let peak = before;
    const timer = setInterval(() => (peak = Math.max(peak, rss())), 250);
    const r = await page.evaluate(() => decodeFile(0, false));
    clearInterval(timer);
    check(
      Math.abs(r.seconds - 10800) < 2 && peak - before < 400,
      `3 h en ${ext.toUpperCase()}`,
      `${(r.seconds / 3600).toFixed(3)} h décodées en ${(r.ms / 1000).toFixed(0)} s, mémoire de pointe +${Math.round(peak - before)} Mo`
    );
  }
}
await browser.close();
check(network.length === 0, 'aucune requête réseau', network.join(', '));
if (failed) process.exit(1);
console.log('\nDécodage des fichiers importés conforme.');
