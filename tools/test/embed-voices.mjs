// Corpus de la mémoire des voix (lot R9, decision.md §37) : calcule, dans le vrai moteur de
// Lowsper (WeSpeaker dans le navigateur, mêmes fenêtres de 2 s que l'application), l'empreinte de
// chaque personne à chaque réunion du corpus généré par corpus/make-voices.py.
//
// Pour chaque session : les fenêtres passent par SpeakerTracker.label, puis finalize() avec une
// seule voix attendue. L'empreinte obtenue est celle que l'application garderait pour cette voix
// (Tracker.centroids) si le regroupement des voix de la réunion était parfait : la mesure isole
// donc la mémoire des voix, sans les erreurs du regroupement (mesurées à part, decision.md §15.14).
// Les empreintes de chaque fenêtre sont aussi gardées, pour les essais.
//
// Prérequis : python corpus/make-voices.py. Aucun modèle Whisper nécessaire.
// Sortie : tools/.cache/voices/embeddings.json (non versionné).
// Usage : node test/embed-voices.mjs   (CHROMIUM_PATH pour choisir le navigateur)
import { chromium } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'output');
const cache = join(here, '..', '.cache', 'voices');
await mkdir(out, { recursive: true });
const corpus = JSON.parse(await readFile(join(cache, 'voices.json'), 'utf8'));

// Faux modèle Whisper « installé » : loadAssets l'exige, mais seule l'analyse audio sert ici.
const app = join(here, '..', '..', 'app');
const fake = relative(app, join(out, 'fake-model.js')).split('\\').join('/');
await writeFile(
  join(out, 'fake-model.js'),
  `self.LOWSPER_ASSETS=self.LOWSPER_ASSETS||{};self.LOWSPER_ASSETS[${JSON.stringify(fake.replace(/\.js$/, ''))}]={};`
);
const scripts = ['manifest.js', 'js/engine.js', 'js/analyzer.js', 'js/speakers.js']
  .map((s) => `<script src="../../../app/${s}"></script>`)
  .join('\n');
await writeFile(
  join(out, 'embed-voices.html'),
  `<!doctype html><meta charset="utf-8"><title>empreintes</title>
<script>window.Lowsper = { assetBase: '../../../app/' };
self.LOWSPER_INSTALLED = [{ id: 'aucun', config: ${JSON.stringify(fake)}, files: {} }];</script>
${scripts}
<script>
window.prepare = async () => {
  const assets = await Lowsper.loadAssets(null, 'aucun');
  window.an = new Lowsper.Analyzer(assets.analysis);
  await an.ready;
  return an.hasSpeaker;
};
window.embedSession = async (b64) => {
  const b = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const audio = Float32Array.from(new Int16Array(b.buffer, 0, b.length >> 1), (v) => v / 32768);
  const tracker = new Lowsper.SpeakerTracker(an);
  tracker.expected = 1;
  await tracker.label(audio, [{ from: 0, to: null }], null);
  if (!tracker.items.length) return null;
  tracker.finalize();
  const [c] = tracker.centroids.values();
  const r = (v) => Array.from(v, (x) => Math.round(x * 1e5) / 1e5);
  return { emb: r(c.emb), seconds: c.seconds, windows: tracker.items.map((it) => r(it.emb)) };
};
</script>`
);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page :', e.message));
await page.goto(pathToFileURL(join(out, 'embed-voices.html')).href);
if (!(await page.evaluate(() => window.prepare()))) throw new Error('modèle WeSpeaker absent de app/engine');
const result = {};
const t0 = Date.now();
for (const [i, s] of corpus.sessions.entries()) {
  const wav = await readFile(join(cache, s.id + '.wav'));
  result[s.id] = await page.evaluate((b64) => window.embedSession(b64), wav.subarray(44).toString('base64'));
  if (i % 20 === 0)
    console.log(`${i + 1}/${corpus.sessions.length} ${s.id} (${Math.round((Date.now() - t0) / 1000)} s)`);
}
await browser.close();
await writeFile(join(cache, 'embeddings.json'), JSON.stringify(result));
console.log(`${Object.keys(result).length} sessions, ${Math.round((Date.now() - t0) / 1000)} s`);
