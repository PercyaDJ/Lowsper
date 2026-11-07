// Étude : séparer deux voix qui parlent en même temps, avant Whisper (decision.md §39).
// Pour chaque chevauchement du corpus « simultane » (corpus/make-overlap.py), côté participants :
//   1. le passage est découpé (les deux répliques, plus 0,5 s de part et d'autre) ;
//   2. MossFormer2 (séparation de deux voix, 16 kHz, Apache 2.0) en tire deux pistes, dans
//      Chromium, avec ONNX Runtime Web en WebAssembly sur un seul fil, comme Lowsper (§2) :
//      le temps de calcul mesuré est celui qu'aurait la page ;
//   3. Whisper small transcrit le mélange, puis chacune des deux pistes (dans Node, mêmes poids) ;
//   4. pour chaque personne, part de ses mots retrouvés (couverture) dans le mélange, puis dans
//      la meilleure des deux pistes.
// Prérequis : modèle de séparation dans tools/.cache/sep/model.int8.onnx (révision figée, voir
// decision.md §39), Whisper small dans tools/.cache/models (npm run fetch-all), corpus généré.
// Usage : node test/eval-separation.mjs [--teams] [--max=N]
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, pipeline } from '@huggingface/transformers';

const here = dirname(fileURLToPath(import.meta.url));
const tools = join(here, '..');
const RATE = 16000;
const teams = process.argv.includes('--teams');
const max = Number((process.argv.find((a) => a.startsWith('--max=')) || '').split('=')[1]) || Infinity;

const truth = JSON.parse(await readFile(join(here, 'corpus', 'simultane.truth.json'), 'utf8'));
const wav = await readFile(join(here, 'corpus', `simultane-others${teams ? '-teams' : ''}.wav`));
const pcm = Float32Array.from(
  new Int16Array(wav.buffer, wav.byteOffset + 44, (wav.length - 44) >> 1),
  (v) => v / 32768
);

// Chevauchements côté participants : paires premier / second
const pairs = [];
for (let i = 1; i < truth.length; i++) {
  const a = truth[i - 1],
    b = truth[i];
  if (b.role === 'second' && a.role === 'premier' && a.channel === 'others' && b.channel === 'others')
    pairs.push({ kind: b.kind, overlap: b.overlap, a, b });
}
const cases = pairs.slice(0, max).map((p) => {
  const from = Math.max(0, Math.min(p.a.start, p.b.start) - 0.5);
  const to = Math.max(p.a.end, p.b.end) + 0.5;
  return { ...p, from, to, audio: pcm.slice(Math.floor(from * RATE), Math.floor(to * RATE)) };
});

// --- Séparation dans Chromium (ONNX Runtime Web, WebAssembly, un seul fil) ---
const roots = {
  '/sep/': join(tools, '.cache', 'sep'),
  '/ort/': join(tools, 'node_modules', 'onnxruntime-web', 'dist'),
};
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm' };
const page = `<!doctype html><meta charset="utf-8"><script src="/ort/ort.min.js"></script><script>
window.separate = async (clips) => {
  ort.env.wasm.numThreads = 1;
  const t0 = performance.now();
  const session = await ort.InferenceSession.create('/sep/model.int8.onnx', { executionProviders: ['wasm'] });
  const loadMs = performance.now() - t0;
  const out = [];
  for (const c of clips) {
    const x = Float32Array.from(c);
    const t = performance.now();
    const r = await session.run({ inputs: new ort.Tensor('float32', x, [1, x.length]) });
    const ms = performance.now() - t;
    console.log('clip ' + (out.length + 1) + '/' + clips.length + ' : ' + (c.length / 16000).toFixed(1) + ' s de son, ' + (ms / 1000).toFixed(1) + ' s de calcul');
    out.push({ ms, spk0: Array.from(r.spk0.data), spk1: Array.from(r.spk1.data) });
  }
  return { loadMs, out };
};</script>`;
const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end(page);
  const prefix = Object.keys(roots).find((p) => url.startsWith(p));
  if (!prefix) return res.writeHead(404).end();
  const file = normalize(join(roots[prefix], url.slice(prefix.length)));
  if (!file.startsWith(roots[prefix])) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const tab = await browser.newPage();
tab.on('pageerror', (e) => console.log('[pageerror]', e.message));
tab.on('console', (m) => console.log(m.text()));
await tab.goto(`http://127.0.0.1:${server.address().port}/`);
const sep = await tab.evaluate(
  (clips) => window.separate(clips),
  cases.map((c) => Array.from(c.audio))
);
await browser.close();
server.close();

// --- Transcription (Whisper small, mêmes poids que Lowsper) ---
env.localModelPath = join(tools, '.cache', 'models');
env.allowRemoteModels = false;
const asr = await pipeline('automatic-speech-recognition', 'whisper-small', { dtype: 'q8' });
const say = async (audio) => {
  // Même niveau que Lowsper avant Whisper (capture.js, normalize) : crête à 0,9, gain plafonné
  let peak = 0;
  for (const v of audio) peak = Math.max(peak, Math.abs(v));
  const g = peak > 1e-4 ? Math.min(0.9 / peak, 20) : 1;
  const x = Float32Array.from(audio, (v) => v * g);
  return (await asr(x, { language: 'french', task: 'transcribe' })).text;
};

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
const coverage = (ref, hyp) => {
  const bag = new Map();
  for (const w of norm(hyp)) bag.set(w, (bag.get(w) || 0) + 1);
  const r = norm(ref);
  let hit = 0;
  for (const w of r)
    if (bag.get(w)) {
      hit++;
      bag.set(w, bag.get(w) - 1);
    }
  return hit / r.length;
};

const rows = [];
let sepMs = 0,
  audioS = 0;
for (let i = 0; i < cases.length; i++) {
  const c = cases[i];
  const s = sep.out[i];
  sepMs += s.ms;
  audioS += c.audio.length / RATE;
  const mix = await say(c.audio);
  const t0 = await say(s.spk0);
  const t1 = await say(s.spk1);
  const best = (ref) => Math.max(coverage(ref, t0), coverage(ref, t1));
  rows.push({
    kind: c.kind,
    overlap: c.overlap,
    mixA: coverage(c.a.ref, mix),
    mixB: coverage(c.b.ref, mix),
    sepA: best(c.a.ref),
    sepB: best(c.b.ref),
    // Les deux personnes dans la même piste : la séparation a échoué
    sameTrack: coverage(c.a.ref, t0) > coverage(c.a.ref, t1) === coverage(c.b.ref, t0) > coverage(c.b.ref, t1),
  });
}

const pct = (x) => (x * 100).toFixed(0) + ' %';
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const table = [];
for (const kind of [...new Set(rows.map((r) => r.kind)), 'tous']) {
  const sel = kind === 'tous' ? rows : rows.filter((r) => r.kind === kind);
  table.push({
    type: kind,
    cas: sel.length,
    chevauchement: mean(sel.map((r) => r.overlap)).toFixed(1) + ' s',
    'mélange : 1re personne': pct(mean(sel.map((r) => r.mixA))),
    'mélange : 2e personne': pct(mean(sel.map((r) => r.mixB))),
    'séparé : 1re personne': pct(mean(sel.map((r) => r.sepA))),
    'séparé : 2e personne': pct(mean(sel.map((r) => r.sepB))),
    'même piste': sel.filter((r) => r.sameTrack).length,
  });
}
console.log(`Séparation de deux voix (MossFormer2, WebAssembly un fil), son ${teams ? 'de visio' : 'propre'}`);
console.table(table);
console.log(
  `Chargement du modèle : ${(sep.loadMs / 1000).toFixed(1)} s ; calcul : ${(sepMs / 1000).toFixed(1)} s pour ` +
    `${audioS.toFixed(1)} s de son (${(sepMs / 1000 / audioS).toFixed(2)} s de calcul par seconde de son)`
);
