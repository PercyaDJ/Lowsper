// Compare la qualité (taux d'erreur, sigles retrouvés) et la vitesse des modèles sur le
// corpus de réunion fictive (test/corpus). Les modèles doivent avoir été construits :
//   node build.mjs whisper-base whisper-small ...
// Usage : node test/eval.mjs whisper-base whisper-small ...
import { chromium } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'output');
await mkdir(out, { recursive: true });
const corpus = JSON.parse(await readFile(join(here, 'corpus', 'meeting-fr.json'), 'utf8'));
const wav = await readFile(join(here, 'corpus', 'meeting-fr.wav'));
await writeFile(
  join(out, 'corpus-pcm.js'),
  `window.CORPUS_PCM=${JSON.stringify(wav.subarray(44).toString('base64'))};`
);
await writeFile(
  join(out, 'eval.html'),
  `<!doctype html><meta charset="utf-8"><title>eval</title>
<script>window.Lowsper = { assetBase: '../../../app/' };</script>
<script src="../../../app/manifest.js"></script>
<script src="../../../app/models/index.txt"></script>
<script src="../../../app/js/engine.js"></script>
<script src="../../../app/js/capture.js"></script>
<script src="../../../app/js/transcript.js"></script>
<script src="corpus-pcm.js"></script>
<script>
window.runEval = async (modelId, glossary) => {
  const bytes = Uint8Array.from(atob(CORPUS_PCM), (c) => c.charCodeAt(0));
  const pcm16 = new Int16Array(bytes.buffer);
  const pcm = Float32Array.from(pcm16, (v) => v / 32768);
  const segs = [];
  const s = new Lowsper.Segmenter((seg) => segs.push(seg));
  for (let i = 0; i < pcm.length; i += 4096) s.push(pcm.subarray(i, i + 4096), false);
  s.flush();
  const t0 = performance.now();
  const assets = await Lowsper.loadAssets(null, modelId);
  const tr = new Lowsper.Transcriber(assets);
  await tr.ready;
  const initMs = performance.now() - t0;
  const runs = {};
  for (const [name, prompt] of [['sans glossaire', ''], ['avec glossaire', glossary]]) {
    let ms = 0, text = [];
    for (const seg of segs) {
      const r = await tr.transcribe(seg.audio.slice(), 'fr', prompt);
      ms += r.ms;
      text.push(prompt ? Lowsper.fixAcronyms(r.text, prompt) : r.text);
    }
    runs[name] = { ms, text: text.join(' ') };
  }
  return { initMs, segments: segs.length, audioSeconds: pcm.length / 16000, runs };
};
</script>`
);

const norm = (t) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/'/g, "' ")
    .split(/\s+/)
    .filter(Boolean);

function wer(ref, hyp) {
  const r = norm(ref),
    h = norm(hyp);
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++)
    for (let j = 1; j <= h.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
  return d[r.length][h.length] / r.length;
}

// Un sigle est « retrouvé » s'il apparaît écrit tel quel (majuscules, éventuellement avec points)
function acronyms(ref, hyp) {
  const list = corpus.glossary.split(',').map((s) => s.trim());
  let total = 0,
    found = 0;
  const missed = [];
  const h = hyp.replace(/\b([A-Z])\.(?=[A-Z]\.?)/g, '$1').replace(/\b([A-Z])\.\s/g, '$1 ');
  for (const a of list) {
    const re = new RegExp('(^|[^A-Za-z])' + a.replace(' ', '\\s?') + '(?![a-z])', 'g');
    const n = (ref.match(re) || []).length;
    const m = Math.min(n, (h.match(re) || []).length);
    total += n;
    found += m;
    if (m < n) missed.push(a);
  }
  return { total, found, missed };
}

const ref = corpus.lines.map((l) => l.ref).join(' ');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const report = [];
for (const id of process.argv.slice(2)) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(pathToFileURL(join(out, 'eval.html')).href);
  const res = await page.evaluate(([id, g]) => window.runEval(id, g), [id, corpus.glossary]);
  for (const [name, run] of Object.entries(res.runs)) {
    const a = acronyms(ref, run.text);
    const row = {
      modele: id,
      mode: name,
      wer: (wer(ref, run.text) * 100).toFixed(1) + ' %',
      sigles: `${a.found}/${a.total}`,
      calcul: (run.ms / 1000).toFixed(1) + ' s',
      rtf: (run.ms / 1000 / res.audioSeconds).toFixed(2),
      demarrage: (res.initMs / 1000).toFixed(1) + ' s',
      blocs: res.segments,
    };
    report.push(row);
    console.log(JSON.stringify(row));
    console.log('   manqués : ' + a.missed.join(', '));
    console.log('   texte   : ' + run.text);
  }
  await page.close();
}
await browser.close();
console.table(report);
await writeFile(join(out, 'eval.json'), JSON.stringify(report, null, 2));
