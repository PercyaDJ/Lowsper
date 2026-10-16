// Endurance du moteur : un même moteur transcrit des passages réalistes en continu, comme pendant
// une longue réunion. Détecte les pannes (erreurs, blocages) et le ralentissement (fuite mémoire).
// Usage : node test/soak.mjs [modèle] [minutes de parole]
import { chromium } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'output');
await mkdir(out, { recursive: true });
const modelId = process.argv[2] || 'whisper-small';
const minutes = Number(process.argv[3] || 45);
const pcm = (await readFile(join(here, 'corpus', 'hebdo-others-teams.wav'))).subarray(44).toString('base64');
const glossary = (await readFile(join(here, 'corpus', 'hebdo-fr.json'), 'utf8')).match(/"glossary":\s*"([^"]*)"/)[1];
await writeFile(join(out, 'soak-pcm.js'), `window.SOAK=${JSON.stringify(pcm)};`);
const scripts = ['manifest.js', 'models/index.txt', 'js/engine.js', 'js/analyzer.js', 'js/capture.js']
  .map((s) => `<script src="../../../app/${s}"></script>`).join('\n');
await writeFile(join(out, 'soak.html'), `<!doctype html><meta charset="utf-8"><title>soak</title>
<script>window.Lowsper = { assetBase: '../../../app/' };</script>
${scripts}<script src="soak-pcm.js"></script>
<script>
window.prepare = async (modelId) => {
  const b = Uint8Array.from(atob(SOAK), (c) => c.charCodeAt(0));
  const audio = Float32Array.from(new Int16Array(b.buffer), (v) => v / 32768);
  const assets = await Lowsper.loadAssets(null, modelId);
  const an = new Lowsper.Analyzer(assets.analysis); await an.ready;
  const segs = [];
  const s = new Lowsper.Segmenter((x) => segs.push(x), { vad: { run: (x) => an.vad('o', x) } });
  for (let i = 0; i < audio.length; i += 4096) await s.push(audio.subarray(i, i + 4096), false);
  await s.flush();
  window.BLOCKS = segs.map((x) => ({ audio: x.audio, pieces: (x.map || []).map((m) => m.at) }));
  window.TR = new Lowsper.Transcriber(assets); await TR.ready;
  return BLOCKS.length;
};
window.step = async (i, glossary) => {
  const b = BLOCKS[i % BLOCKS.length];
  const t0 = performance.now();
  try {
    const r = await Promise.race([TR.transcribe(b.audio.slice(), 'fr', glossary, b.pieces), new Promise((_, rej) => setTimeout(() => rej(new Error('pas de réponse en 5 min')), 300000))]);
    return { ok: true, ms: performance.now() - t0, sec: b.audio.length / 16000, words: r.text.split(/\\s+/).length };
  } catch (e) { return { ok: false, error: String(e.message || e), sec: b.audio.length / 16000 }; }
};
</script>`);
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
page.on('crash', () => console.log('[CRASH] la page a planté'));
await page.goto(pathToFileURL(join(out, 'soak.html')).href, { waitUntil: 'commit', timeout: 300000 });
await page.waitForFunction(() => window.prepare, null, { timeout: 300000 });
const n = await page.evaluate((m) => window.prepare(m), modelId);
console.log(`${n} passages types, objectif ${minutes} min de parole`);
let speech = 0, fails = 0, i = 0;
const t0 = Date.now();
const window10 = [];
while (speech < minutes * 60) {
  const r = await page.evaluate(([k, g]) => window.step(k, g), [i, glossary]);
  speech += r.sec;
  if (!r.ok) { fails++; console.log(`ÉCHEC passage ${i} (${(speech / 60).toFixed(1)} min) : ${r.error}`); }
  else window10.push(r.ms / 1000 / r.sec);
  if (++i % 20 === 0) {
    const avg = window10.reduce((a, b) => a + b, 0) / Math.max(1, window10.length);
    console.log(`${(speech / 60).toFixed(1)} min de parole, ${i} passages, ${fails} échec(s), calcul ${avg.toFixed(2)} s par s de parole, ${((Date.now() - t0) / 60000).toFixed(0)} min écoulées`);
    window10.length = 0;
  }
}
console.log(`FIN : ${i} passages, ${(speech / 60).toFixed(1)} min de parole, ${fails} échec(s)`);
await browser.close();
