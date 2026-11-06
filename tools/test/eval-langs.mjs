// Qualité de Whisper par langue parlée (lot R8, decision.md §34), sur le corpus synthétique
// multilingue (corpus/langs.json, audio généré par corpus/make-langs.py dans .cache/langs).
// Pour chaque phrase : transcription avec la langue imposée, puis avec la langue détectée parmi
// toutes celles du corpus, et, si la détection se trompe, parmi trois (français, anglais, la
// langue de la phrase). Mesures : taux d'erreur par mot (par caractère pour le mandarin et le
// japonais, écrits sans espaces), part de langues bien détectées, temps de calcul.
// Prérequis : node build.mjs --embed <modèle>. Usage : node test/eval-langs.mjs [modèle] [langues...]
import { chromium } from 'playwright-core';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'output');
const cache = join(here, '..', '.cache', 'langs');
await mkdir(out, { recursive: true });
const corpus = JSON.parse(await readFile(join(here, 'corpus', 'langs.json'), 'utf8'));
const [model = 'whisper-small', ...only] = process.argv.slice(2);
const all = Object.keys(corpus.lines);
const langs = only.length ? only : all;
const CHAR = new Set(['zh', 'ja']); // langues écrites sans espaces : erreur par caractère

// Normalisation avant comparaison : casse, ponctuation, chiffres arabes et formes de l'arabe
export function normalize(text, lang) {
  let s = String(text).normalize('NFKC').toLowerCase();
  if (lang === 'ar')
    s = s
      .replace(/[ً-ْٰـ]/g, '') // voyelles brèves et allongement
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي');
  s = s
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return CHAR.has(lang) ? [...s.replace(/\s+/g, '')] : s.split(' ').filter(Boolean);
}

// Distance d'édition (substitutions, insertions, suppressions) entre deux suites
export function edits(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const l of langs)
    if (!existsSync(join(cache, l + '.wav'))) throw new Error(`Corpus absent : lancez corpus/make-langs.py (${l})`);
  await writeFile(
    join(out, 'el.html'),
    `<!doctype html><meta charset="utf-8"><title>eval-langs</title>
<script>window.Lowsper = { assetBase: '../../../app/' };</script>
<script src="../../../app/manifest.js"></script><script src="../../../app/models/index.txt"></script>
<script src="../../../app/js/engine.js"></script>
<script>
window.init = async (m) => { window.tr = new Lowsper.Transcriber(await Lowsper.loadAssets(null, m)); await window.tr.ready; };
window.run = async (b64, language, prompt) => {
  const by = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const audio = Float32Array.from(new Int16Array(by.buffer), (v) => v / 32768);
  const r = await window.tr.transcribe(audio, language, prompt || '');
  return { text: r.chunks.map((c) => c.text).join(' ').trim(), language: r.language, ms: r.ms };
};
</script>`
  );
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(pathToFileURL(join(out, 'el.html')).href);
  await page.evaluate((m) => window.init(m), model);

  const results = {};
  for (const lang of langs) {
    const pcm = (await readFile(join(cache, lang + '.wav'))).subarray(44);
    const timeline = JSON.parse(await readFile(join(cache, lang + '.json'), 'utf8'));
    const r = (results[lang] = { lines: [], errors: 0, total: 0, detected12: 0, detected3: 0, ms: 0, seconds: 0 });
    for (const line of timeline) {
      // Phrase seule, avec 0,3 s de silence de part et d'autre (comme un passage découpé)
      const a = Math.max(0, Math.floor((line.start - 0.3) * 16000)) * 2;
      const b = Math.min(pcm.length, Math.floor((line.end + 0.3) * 16000) * 2);
      const b64 = Buffer.from(pcm.subarray(a, b)).toString('base64');
      // Langue bien détectée : même jeton de langue, même contexte, donc même texte qu'avec la
      // langue imposée (une seule transcription au lieu de deux)
      const auto = await page.evaluate(([x, l]) => window.run(x, l), [b64, all]);
      let forced = auto;
      let three = lang;
      if (auto.language !== lang) {
        forced = await page.evaluate(([x, l]) => window.run(x, l), [b64, lang]);
        const set = [...new Set(['fr', 'en', lang])];
        three = (await page.evaluate(([x, l]) => window.run(x, l), [b64, set])).language;
      }
      const ref = normalize(line.text, lang);
      const err = edits(ref, normalize(forced.text, lang));
      r.errors += err;
      r.total += ref.length;
      r.detected12 += auto.language === lang ? 1 : 0;
      r.detected3 += three === lang ? 1 : 0;
      r.ms += forced.ms;
      r.seconds += (b - a) / 32000;
      r.lines.push({ ref: line.text, forced: forced.text, rate: err / ref.length, auto: auto.language, three });
      console.log(`${lang} ${(err / ref.length).toFixed(2)} [${auto.language}/${three}] ${forced.text}`);
    }
    r.rate = r.errors / r.total;
  }
  console.log('\nLangue | erreur | détection parmi 12 | parmi 3 | temps / s d’audio');
  for (const [lang, r] of Object.entries(results))
    console.log(
      `${lang} | ${(r.rate * 100).toFixed(1)} % ${CHAR.has(lang) ? '(caractères)' : '(mots)'} | ` +
        `${r.detected12}/${r.lines.length} | ${r.detected3}/${r.lines.length} | ${Math.round(r.ms / r.seconds)} ms`
    );
  const suffix = only.length ? '-' + only.join('-') : '';
  await writeFile(join(out, `eval-langs-${model}${suffix}.json`), JSON.stringify(results, null, 1));
  await browser.close();
}
