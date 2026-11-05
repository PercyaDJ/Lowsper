// Banc d'étude (decision.md §21) : un petit modèle de langage peut-il résumer une réunion en
// français, dans le navigateur, sur le processeur, comme le reste de Lowsper ?
//
// Rien de ce banc n'est livré : les modèles de langage ne font pas partie de Lowsper. Pour la
// mesure, la page de test est servie par un petit serveur local (seulement pour charger les
// fichiers) ; le calcul, lui, se fait comme dans Lowsper : WebAssembly, un seul fil d'exécution
// (une page ouverte depuis le disque n'a pas le multifil, decision.md §2).
//
// Entrée : la vérité terrain du corpus fictif « hebdo » (2 min 40, 20 répliques), au format des
// transcripts de Lowsper ; --long répète d'autres corpus fictifs pour mesurer la lecture d'un long
// transcript. Sortie : temps de chargement, de lecture (préremplissage) et de génération, mémoire,
// texte produit, et faits du corpus retrouvés ou non.
//
// Prérequis : modèles dans tools/.cache/llm/onnx-community/<nom>/ (config, tokenizer,
// onnx/model_quantized.onnx), téléchargés depuis Hugging Face.
// Usage : node test/eval-summary.mjs <nom du modèle> [--long]   (CHROMIUM_PATH si besoin)
import { chromium } from 'playwright-core';
import { build } from 'esbuild';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tools = join(here, '..');
const out = join(here, 'output', 'summary');
await mkdir(out, { recursive: true });
const modelName = process.argv[2] || 'Qwen2.5-0.5B-Instruct';
const long = process.argv.includes('--long');
// --dtype=q4 : poids 4 bits (model_q4.onnx) ; par défaut q8 (model_quantized.onnx)
const dtype = (process.argv.find((a) => a.startsWith('--dtype=')) || '--dtype=q8').split('=')[1];
// --sanity : simple question, pour vérifier le banc avant de juger la qualité
const sanity = process.argv.includes('--sanity');

// Exemple fictif, consigne et faits : ceux de la sonde de l'application (app/js/localai.js)
const sandbox = { setTimeout, clearTimeout };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(await readFile(join(tools, '..', 'app', 'js', 'localai.js'), 'utf8'), sandbox);
const { CONSIGNE: consigne, FACTS, sampleTranscript } = sandbox.Lowsper.LocalAI;

// Transcript au format Lowsper, d'après la vérité terrain d'un corpus fictif
const fmt = (s) => new Date(Math.round(s) * 1000).toISOString().slice(11, 19);
async function transcriptOf(name) {
  const truth = JSON.parse(await readFile(join(here, 'corpus', `${name}.truth.json`), 'utf8'));
  return truth.map((l) => `**[${fmt(l.start)}] ${l.channel === 'me' ? 'Vous' : l.who} :** ${l.ref}`).join('\n\n');
}
let transcript = sampleTranscript();
if (long) {
  const other = await transcriptOf('entretien');
  transcript = [transcript, other, transcript, other, transcript].join('\n\n');
}
// Bibliothèque transformers.js (module) pour la page de test
await build({
  entryPoints: [join(tools, 'node_modules', '@huggingface', 'transformers', 'dist', 'transformers.web.js')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: join(out, 'transformers.js'),
  logLevel: 'error',
  minify: true,
});
await writeFile(
  join(out, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>résumé local</title>
<script type="module">
import { pipeline, env, TextStreamer } from './transformers.js';
env.allowLocalModels = false;
env.useBrowserCache = false;
env.remoteHost = location.origin + '/models/';
env.remotePathTemplate = '{model}/';
env.backends.onnx.wasm.wasmPaths = location.origin + '/ort/';
env.backends.onnx.wasm.numThreads = 1; // comme Lowsper : pas de multifil en file://
window.run = async (model, consigne, transcript, dtype) => {
  const t0 = performance.now();
  const gen = await pipeline('text-generation', model, { dtype, device: 'wasm' });
  const loadMs = performance.now() - t0;
  const messages = [
    { role: 'system', content: 'Tu es un assistant qui rédige des comptes rendus de réunion fidèles, en français.' },
    { role: 'user', content: consigne + '\\n\\n---\\n\\n' + transcript },
  ];
  const ids = gen.tokenizer.apply_chat_template(messages, { add_generation_prompt: true, tokenize: true, return_tensor: false });
  const promptTokens = Array.isArray(ids) ? ids.length : null;
  let first = null, tokens = 0;
  const start = performance.now();
  const streamer = new TextStreamer(gen.tokenizer, { skip_prompt: true, callback_function: () => {}, token_callback_function: () => { tokens++; if (first === null) first = performance.now(); } });
  const res = await gen(messages, { max_new_tokens: 600, do_sample: false, repetition_penalty: 1.05, streamer });
  const end = performance.now();
  const text = res[0].generated_text.at(-1).content;
  return { loadMs, promptTokens, prefillMs: first - start, genMs: end - first, tokens, text };
};
</script>`
);

// Serveur local du banc : la page, la bibliothèque, ONNX Runtime, les modèles du cache
const roots = {
  '/models/': join(tools, '.cache', 'llm'),
  '/ort/': join(tools, 'node_modules', 'onnxruntime-web', 'dist'),
  '/': out,
};
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
};
const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const prefix = Object.keys(roots).find((p) => url.startsWith(p));
  const file = normalize(join(roots[prefix], url.slice(prefix.length)));
  if (!file.startsWith(roots[prefix])) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const outside = [];
page.on('request', (r) => {
  if (!r.url().startsWith(base)) outside.push(r.url());
});
// Mémoire des seuls processus de rendu lancés par ce banc
const rss = () => {
  const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,rss=,args='], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .map(([pid, ppid, kb, ...a]) => ({ pid: +pid, ppid: +ppid, kb: +kb, args: a.join(' ') }));
  const mine = new Set([process.pid]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of rows) {
      if (!mine.has(r.pid) && mine.has(r.ppid)) {
        mine.add(r.pid);
        grew = true;
      }
    }
  }
  return rows.filter((r) => mine.has(r.pid) && r.args.includes('--type=renderer')).reduce((n, r) => n + r.kb, 0) / 1024;
};
await page.goto(base + '/index.html');
const before = rss();
let peak = before;
const timer = setInterval(() => (peak = Math.max(peak, rss())), 500);
const r = await page.evaluate(
  ([m, c, t, d]) => window.run('onnx-community/' + m, c, t, d),
  [
    modelName,
    sanity ? 'Réponds en une phrase.' : consigne,
    sanity ? 'Quelle est la capitale de la France ?' : transcript,
    dtype,
  ]
);
clearInterval(timer);
await browser.close();
server.close();

const found = [...sandbox.Lowsper.LocalAI.checkFacts(r.text).found];
const report = {
  modele: modelName,
  precision: dtype,
  entree_jetons: r.promptTokens,
  chargement_s: +(r.loadMs / 1000).toFixed(1),
  lecture_s: +(r.prefillMs / 1000).toFixed(1),
  lecture_jetons_par_s: +(r.promptTokens / (r.prefillMs / 1000)).toFixed(1),
  generation_jetons: r.tokens,
  generation_jetons_par_s: +(r.tokens / (r.genMs / 1000)).toFixed(2),
  memoire_pointe_mo: Math.round(peak - before),
  faits_retrouves: `${found.length}/${FACTS.length}`,
  faits_manquants: FACTS.map(([n]) => n).filter((n) => !found.includes(n)),
  requetes_hors_banc: outside.length,
};
console.log(JSON.stringify(report, null, 1));
if (!long) console.log('\n----- texte produit -----\n' + r.text);
await writeFile(
  join(out, `${modelName}-${dtype}${long ? '-long' : ''}${sanity ? '-controle' : ''}.json`),
  JSON.stringify({ ...report, texte: r.text }, null, 1)
);
