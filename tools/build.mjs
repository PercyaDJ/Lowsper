// Construit les fichiers embarqués de Lowsper (dossier app/engine et app/models).
//
// Pourquoi tout est converti en .js ?
//   Lowsper s'ouvre en double-cliquant sur un fichier HTML (protocole file://).
//   Dans ce mode, les navigateurs interdisent fetch()/XHR vers les fichiers voisins
//   et interdisent les modules ES. Seules les balises <script src> classiques passent.
//   On emballe donc le moteur, le binaire WebAssembly et le modèle sous forme de
//   scripts classiques qui déposent leurs données (texte ou base64) dans une variable globale.
//
// Usage : node build.mjs [modèle ...]   (par défaut : whisper-base)
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

const modelIds = process.argv.slice(2).length ? process.argv.slice(2) : [DEFAULT_MODEL];

const header = '/* Fichier généré par tools/build.mjs : ne pas modifier à la main. */\n';
const register = (key, payload) =>
  `${header}(self.LOWSPER_ASSETS=self.LOWSPER_ASSETS||{})[${JSON.stringify(key)}]=${payload};\n`;

async function writeBinary(dir, relDir, baseName, buf) {
  const parts = [];
  for (let i = 0, n = 0; i < buf.length; i += CHUNK, n++) {
    const name = `${baseName}.part${n}.js`;
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

// 2. Modèles
await rm(modelsDir, { recursive: true, force: true });
const models = [];
for (const id of modelIds) {
  const model = MODELS[id];
  if (!model) throw new Error(`Modèle inconnu : ${id}`);
  const src = join(here, '.cache', 'models', id);
  const out = join(modelsDir, id);
  await mkdir(out, { recursive: true });
  const files = {};
  const texts = {};
  for (const file of model.files) {
    const buf = await readFile(join(src, file)).catch(() => {
      throw new Error(`Fichier manquant ${src}/${file}. Lancez d'abord : node fetch-model.mjs ${id}`);
    });
    if (file.endsWith('.json')) {
      texts[file] = buf.toString('utf8');
    } else {
      const base = file.replace(/^onnx\//, '').replace(/\.onnx$/, '');
      files[file] = await writeBinary(out, `models/${id}`, base, buf);
    }
  }
  await writeFile(join(out, 'config.js'), register(`models/${id}/config`, JSON.stringify(texts)));
  models.push({ id, label: model.label, repo: model.repo, config: `models/${id}/config.js`, files });
}

// 3. Manifeste lu par l'application au démarrage
const manifest = {
  builtAt: new Date().toISOString(),
  runtime: { src: 'engine/runtime.js', bytes: runtimeCode.length },
  wasm: wasmParts,
  models,
};
await writeFile(join(appDir, 'manifest.js'), `${header}self.LOWSPER_MANIFEST=${JSON.stringify(manifest, null, 2)};\n`);

const total = async (d) => (await readdir(d, { recursive: true, withFileTypes: true }))
  .filter((e) => e.isFile()).length;
console.log(`Runtime : ${(runtimeCode.length / 1e6).toFixed(2)} Mo`);
console.log(`WASM    : ${(wasmBuf.length / 1e6).toFixed(1)} Mo en ${wasmParts.length} morceau(x)`);
for (const m of models) console.log(`Modèle  : ${m.id} -> ${Object.keys(m.files).length} fichiers ONNX`);
console.log(`Fichiers générés : ${await total(engineDir) + await total(modelsDir) + 1}`);
