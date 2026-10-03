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
import { build } from 'esbuild';
import { mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, DEFAULT_MODEL } from './models.mjs';

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
const CATALOG = ['whisper-small', 'whisper-base'];

const header = '/* Fichier généré par tools/build.mjs : ne pas modifier à la main. */\n';
const readMeta = async (id) =>
  JSON.parse(await readFile(join(here, '.cache', 'models', id, 'meta.json'), 'utf8').catch(() => {
    throw new Error(`Métadonnées absentes pour ${id}. Lancez d'abord : node fetch-model.mjs ${id}`);
  }));
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

// 1. Runtime JS (transformers.js + onnxruntime-web, CPU WebAssembly uniquement)
await rm(engineDir, { recursive: true, force: true });
await mkdir(engineDir, { recursive: true });
const ortDist = join(here, 'node_modules', 'onnxruntime-web', 'dist');
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
  alias: { 'onnxruntime-web/webgpu': join(ortDist, 'ort.wasm.bundle.min.mjs') },
  define: { 'import.meta.url': 'undefined' },
});
const runtimeCode = result.outputFiles[0].text;
await writeFile(join(engineDir, 'runtime.js'), register('engine/runtime', JSON.stringify(runtimeCode)));

const wasmBuf = await readFile(join(ortDist, 'ort-wasm-simd-threaded.wasm'));
const wasmParts = await writeBinary(engineDir, 'engine', 'ort-wasm', wasmBuf);

// Licences des composants embarqués (obligation des licences Apache 2.0 et MIT)
const MIT_ORT = `MIT License\n\nCopyright (c) Microsoft Corporation.\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n`;
const licenseParts = [];
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
    repo: model.repo,
    revision: meta.revision,
    dtype: model.dtype,
    files: model.files.map((path) => ({ path, ...meta.files[path] })),
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
  installed.push({ id, label: model.label, dtype: model.dtype, revision: meta.revision, config: `models/${id}/config.txt`, files });
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
  runtime: { src: 'engine/runtime.js', bytes: runtimeCode.length },
  wasm: wasmParts,
  catalog,
};
await writeFile(join(appDir, 'manifest.js'), `${header}self.LOWSPER_MANIFEST=${JSON.stringify(manifest, null, 2)};\n`);

const total = async (d) => (await readdir(d, { recursive: true, withFileTypes: true }))
  .filter((e) => e.isFile()).length;
console.log(`Runtime : ${(runtimeCode.length / 1e6).toFixed(2)} Mo`);
console.log(`WASM    : ${(wasmBuf.length / 1e6).toFixed(1)} Mo en ${wasmParts.length} morceau(x)`);
console.log(`Catalogue : ${catalog.map((m) => `${m.id} (${(m.files.reduce((n, f) => n + f.size, 0) / 1e6).toFixed(0)} Mo)`).join(', ')}`);
console.log(`Fichiers générés : ${await total(engineDir) + await total(modelsDir) + 1}`);
