// Transcrit un extrait de fichier WAV 16 kHz mono avec le moteur Lowsper (diagnostic).
// Usage : node test/transcribe-file.mjs <modèle> <fichier.wav> [début_s] [fin_s] [glossaire]
import { chromium } from 'playwright-core';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'output');
await mkdir(out, { recursive: true });
const [model, file, from = 0, to = 1e9, glossary = ''] = process.argv.slice(2);
const pcm = (await readFile(resolve(file))).subarray(44);
const a = Math.floor(from * 16000) * 2, b = Math.min(pcm.length, Math.floor(to * 16000) * 2);
await writeFile(join(out, 'tf-pcm.js'), `window.TF=${JSON.stringify(pcm.subarray(a, b).toString('base64'))};`);
await writeFile(join(out, 'tf.html'), `<!doctype html><meta charset="utf-8"><title>tf</title>
<script>window.Lowsper = { assetBase: '../../../app/' };</script>
<script src="../../../app/manifest.js"></script><script src="../../../app/models/index.txt"></script>
<script src="../../../app/js/engine.js"></script><script src="tf-pcm.js"></script>
<script>window.run = async (m, g) => { const by = Uint8Array.from(atob(TF), (c) => c.charCodeAt(0));
const audio = Float32Array.from(new Int16Array(by.buffer), (v) => v / 32768);
const tr = new Lowsper.Transcriber(await Lowsper.loadAssets(null, m)); await tr.ready;
return tr.transcribe(audio, 'fr', g); };</script>`);
// Drapeaux WebGPU : sans carte graphique, Chromium émule WebGPU sur le processeur (SwiftShader)
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'] });
const page = await browser.newPage();
await page.goto(pathToFileURL(join(out, 'tf.html')).href);
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text().slice(0, 300)); });
const r = await page.evaluate(([m, g]) => window.run(m, g), [model, glossary]);
console.log(`${(r.ms / 1000).toFixed(1)} s, qualité ${r.quality}${r.retried ? ', relu' : ''}`);
for (const c of r.chunks) console.log(`[${c.from?.toFixed(1)}-${c.to?.toFixed(1)}] ${c.text}`);
await browser.close();
