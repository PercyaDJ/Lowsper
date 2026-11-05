// Construit les fichiers embarqués de Lowsper (dossier app/engine et app/models).
//
// Pourquoi tout est converti en .js ?
//   Lowsper s'ouvre en double-cliquant sur un fichier HTML (protocole file://).
//   Dans ce mode, les navigateurs interdisent fetch()/XHR vers les fichiers voisins
//   et interdisent les modules ES. Seules les balises <script src> classiques passent.
//   On emballe donc le moteur, le binaire WebAssembly et le modèle sous forme de
//   scripts classiques qui déposent leurs données (texte ou base64) dans une variable globale.
//
// Usage :
//   node build.mjs                      moteur + catalogue (le modèle sera téléchargé au 1er lancement)
//   node build.mjs --embed whisper-small  idem, avec un modèle déjà installé (version hors ligne / tests)
//
// Prérequis : node fetch-model.mjs silero-vad && node fetch-model.mjs wespeaker (et chaque modèle
// passé à --embed). Révisions et empreintes viennent de models.lock.json : le build est reproductible.
import { build } from 'esbuild';
import { mkdir, readFile, rm, writeFile, readdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS } from './models.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..', 'app');
const engineDir = join(appDir, 'engine');
const modelsDir = join(appDir, 'models');

// Taille brute maximale d'un morceau binaire. 24 Mo bruts = ~32 Mo en base64,
// sous la limite d'avertissement de GitHub (50 Mo) et raisonnable pour le parseur JS.
const CHUNK = 24 * 1024 * 1024;

const args = process.argv.slice(2);
const embedIds = args[0] === '--embed' ? args.slice(1) : [];
// Modèles proposés au téléchargement dans l'application
const CATALOG = ['whisper-small', 'whisper-small-gpu', 'whisper-turbo', 'whisper-base'];

const header = '/* Fichier généré par tools/build.mjs : ne pas modifier à la main. */\n';
const lock = JSON.parse(await readFile(join(here, 'models.lock.json'), 'utf8'));
const readMeta = async (id) => {
  if (!lock[id]) throw new Error(`${id} absent de models.lock.json.`);
  return lock[id];
};
const cache = join(here, '.cache', 'models');

// Toutes les vérifications ont lieu AVANT de vider app/engine : un build qui échoue ne doit
// jamais laisser l'application amputée.
async function checkCache(id) {
  const entry = await readMeta(id);
  for (const [path, f] of Object.entries(entry.files)) {
    const file = join(cache, id, f.as || path);
    const buf = await readFile(file).catch(() => null);
    if (!buf) throw new Error(`${id} : ${f.as || path} absent du cache. Lancez d'abord : node fetch-model.mjs ${id}`);
    if (createHash('sha256').update(buf).digest('hex') !== f.sha256) {
      throw new Error(`${id} : ${f.as || path} ne correspond pas au verrou. Relancez : node fetch-model.mjs ${id}`);
    }
  }
}
const ortDist = join(here, 'node_modules', 'onnxruntime-web', 'dist');
await access(ortDist).catch(() => {
  throw new Error('Dépendances absentes. Lancez d\'abord : npm ci --ignore-scripts');
});
for (const id of ['silero-vad', 'wespeaker', ...embedIds]) await checkCache(id);
const register = (key, payload) =>
  `${header}(self.LOWSPER_ASSETS=self.LOWSPER_ASSETS||{})[${JSON.stringify(key)}]=${payload};\n`;

async function writeBinary(dir, relDir, baseName, buf, ext = 'js') {
  const parts = [];
  for (let i = 0, n = 0; i < buf.length; i += CHUNK, n++) {
    const name = `${baseName}.part${n}.${ext}`;
    const key = `${relDir}/${baseName}.part${n}`;
    await writeFile(join(dir, name), register(key, JSON.stringify(buf.subarray(i, i + CHUNK).toString('base64'))));
    parts.push({ src: `${relDir}/${name}`, bytes: Math.min(CHUNK, buf.length - i) });
  }
  return parts;
}

// 1. Runtimes JS (transformers.js + onnxruntime-web)
//    - « cpu »    : WebAssembly seul (14 Mo), le plus léger, fonctionne partout ;
//    - « webgpu » : WebAssembly + accélération par la carte graphique (27 Mo).
await rm(engineDir, { recursive: true, force: true });
await mkdir(engineDir, { recursive: true });
const runtimes = {};
for (const [name, bundle, wasmFile] of [
  ['cpu', 'ort.wasm.bundle.min.mjs', 'ort-wasm-simd-threaded.wasm'],
  ['webgpu', 'ort.webgpu.bundle.min.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'],
]) {
  const result = await build({
    entryPoints: [join(here, 'runtime-entry.js')],
    bundle: true,
    format: 'iife',
    globalName: 'LowsperRuntime',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    write: false,
    logLevel: 'error',
    alias: { 'onnxruntime-web/webgpu': join(ortDist, bundle) },
    define: { 'import.meta.url': 'undefined' },
  });
  const code = result.outputFiles[0].text;
  const file = name === 'cpu' ? 'runtime' : `runtime-${name}`;
  await writeFile(join(engineDir, `${file}.js`), register(`engine/${file}`, JSON.stringify(code)));
  const wasmBuf = await readFile(join(ortDist, wasmFile));
  runtimes[name] = {
    src: `engine/${file}.js`,
    bytes: code.length,
    wasm: await writeBinary(engineDir, 'engine', name === 'cpu' ? 'ort-wasm' : `ort-wasm-${name}`, wasmBuf),
  };
}

// Petits modèles d'analyse audio, livrés avec l'application (pas de téléchargement)
//   - Silero VAD : détection de parole (MIT)
//   - WeSpeaker ResNet34 : empreinte vocale pour distinguer les intervenants (CC BY 4.0)
const vadBuf = await readFile(join(cache, 'silero-vad', 'silero_vad_16k_op15.onnx'));
const vad = await writeBinary(engineDir, 'engine', 'silero-vad', vadBuf);
const spkTexts = {};
for (const f of ['config.json', 'preprocessor_config.json']) spkTexts[f] = await readFile(join(cache, 'wespeaker', f), 'utf8');
await writeFile(join(engineDir, 'wespeaker-config.js'), register('engine/wespeaker-config', JSON.stringify(spkTexts)));
const speaker = {
  id: 'wespeaker',
  config: 'engine/wespeaker-config.js',
  files: { 'onnx/model_quantized.onnx': await writeBinary(engineDir, 'engine', 'wespeaker', await readFile(join(cache, 'wespeaker', 'model_quantized.onnx'))) },
};
const runtimeCode = { length: runtimes.cpu.bytes };
const wasmBuf = { length: runtimes.cpu.wasm.reduce((n, p) => n + p.bytes, 0) };
const wasmParts = runtimes.cpu.wasm;

// Licences des composants embarqués (obligation des licences Apache 2.0 et MIT)
const MIT_ORT = `MIT License\n\nCopyright (c) Microsoft Corporation.\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n`;
const licenseParts = [
  `==== Silero VAD (MIT) : https://github.com/snakers4/silero-vad ====\n\n${(await readFile(join(cache, 'silero-vad', 'LICENSE.txt'), 'utf8')).trim()}\n`,
  `==== WeSpeaker ResNet34-LM, conversion onnx-community/wespeaker-voxceleb-resnet34-LM ====\n\nModèle publié sous licence Creative Commons Attribution 4.0 (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/\nAuteurs : projet WeSpeaker (https://github.com/wenet-e2e/wespeaker), entraîné sur VoxCeleb.\n`,
];
for (const pkg of ['@huggingface/transformers', '@huggingface/tokenizers', '@huggingface/jinja', 'onnxruntime-web']) {
  const dir = join(here, 'node_modules', pkg);
  const info = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  const text = await readFile(join(dir, 'LICENSE'), 'utf8').catch(() => (pkg.startsWith('onnxruntime') ? MIT_ORT : ''));
  licenseParts.push(`==== ${pkg} ${info.version} (${info.license}) ====\n\n${text.trim()}\n`);
}
await writeFile(join(engineDir, 'THIRD_PARTY_LICENSES.txt'), licenseParts.join('\n\n'));

// 2. Catalogue des modèles téléchargeables (révision figée + empreintes SHA-256)
const catalog = [];
for (const id of CATALOG) {
  const model = MODELS[id];
  const meta = await readMeta(id);
  catalog.push({
    id,
    label: model.label,
    description: model.description,
    recommended: model.recommended,
    device: model.device,
    repo: model.repo,
    revision: meta.revision,
    dtype: model.dtype,
    files: model.files.map((path) => ({ path, size: meta.files[path].size, sha256: meta.files[path].sha256 })),
  });
}

// 3. Modèles embarqués (facultatif) : même format que ce qu'écrit l'installateur
await rm(modelsDir, { recursive: true, force: true });
await mkdir(modelsDir, { recursive: true });
const installed = [];
for (const id of embedIds) {
  const model = MODELS[id];
  if (!model) throw new Error(`Modèle inconnu : ${id}`);
  const meta = await readMeta(id);
  const src = join(here, '.cache', 'models', id);
  const out = join(modelsDir, id);
  await mkdir(out, { recursive: true });
  const files = {};
  const texts = {};
  for (const file of model.files) {
    const buf = await readFile(join(src, file));
    if (file.endsWith('.json')) texts[file] = buf.toString('utf8');
    else files[file] = await writeBinary(out, `models/${id}`, file.replace(/^onnx\//, '').replace(/\.onnx$/, ''), buf, 'txt');
  }
  await writeFile(join(out, 'config.txt'), register(`models/${id}/config`, JSON.stringify(texts)));
  installed.push({ id, label: model.label, dtype: model.dtype, device: model.device, revision: meta.revision, config: `models/${id}/config.txt`, files });
  console.log(`Modèle embarqué : ${id}`);
}
if (installed.length) {
  await writeFile(join(modelsDir, 'index.txt'), `${header}self.LOWSPER_INSTALLED=${JSON.stringify(installed, null, 1)};\n`);
}
await writeFile(
  join(modelsDir, 'LISEZMOI.txt'),
  "Ce dossier reçoit le modèle de transcription, téléchargé par Lowsper au premier lancement.\n" +
    "Pour équiper un autre poste sans Internet, copiez tout le dossier Lowsper (avec ce dossier rempli).\n"
);

// 4. Manifeste lu par l'application au démarrage
const manifest = {
  builtAt: new Date().toISOString().slice(0, 10),
  runtime: { src: runtimes.cpu.src, bytes: runtimes.cpu.bytes },
  wasm: runtimes.cpu.wasm,
  runtimes,
  vad,
  speaker,
  catalog,
};
await writeFile(join(appDir, 'manifest.js'), `${header}self.LOWSPER_MANIFEST=${JSON.stringify(manifest, null, 2)};\n`);

const total = async (d) => (await readdir(d, { recursive: true, withFileTypes: true }))
  .filter((e) => e.isFile()).length;
console.log(`Runtime : ${(runtimeCode.length / 1e6).toFixed(2)} Mo`);
console.log(`WASM    : ${(wasmBuf.length / 1e6).toFixed(1)} Mo en ${wasmParts.length} morceau(x)`);
console.log(`Catalogue : ${catalog.map((m) => `${m.id} (${(m.files.reduce((n, f) => n + f.size, 0) / 1e6).toFixed(0)} Mo)`).join(', ')}`);
console.log(`Fichiers générés : ${await total(engineDir) + await total(modelsDir) + 1}`);
