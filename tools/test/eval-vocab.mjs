// Effet de plusieurs vocabulaires métier cochés à la fois sur le contexte donné à Whisper (lot R8,
// decision.md §35). Corpus : corpus/vocab-fr.json (audio : corpus/make-langs.py vocab). Pour chaque
// domaine, les phrases sont transcrites avec plusieurs contextes :
//   - aucun vocabulaire ;
//   - la liste du domaine seule ;
//   - trois listes (santé, juridique, finance) mises bout à bout, dont Whisper ne garde que la fin
//     (règle de la version 4.0) ;
//   - les douze listes bout à bout ;
//   - trois et douze listes avec une part égale du contexte pour chacune (ses premiers termes) ;
//   - trois et douze listes en alternance : un terme de chaque liste à tour de rôle, les plus
//     utiles à la fin, si bien que la coupe par le début garde les premiers termes de chacune.
// Mesures : part des termes du domaine bien écrits (sans tenir compte de la casse ni des accents,
// que la correction de casse rétablit ensuite) et taux d'erreur par mot de la phrase.
// Prérequis : node build.mjs --embed whisper-small. Usage : node test/eval-vocab.mjs [modèle] [domaines...]
import { chromium } from 'playwright-core';
import { AutoTokenizer, env } from '@huggingface/transformers';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { normalize, edits } from './eval-langs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'output');
const cache = join(here, '..', '.cache');
await mkdir(out, { recursive: true });
const model = process.argv[2] || 'whisper-small';
const domains = process.argv.slice(3);
const corpus = JSON.parse(await readFile(join(here, 'corpus', 'vocab-fr.json'), 'utf8'));

env.allowRemoteModels = false;
env.localModelPath = join(cache, 'models') + '/';
const tok = await AutoTokenizer.from_pretrained(model.replace(/-gpu$/, ''));
const count = (text) => tok.encode(' ' + text, { add_special_tokens: false }).length;
const sb = { window: {} };
vm.createContext(sb);
for (const f of ['vocabularies.js', 'vocabulary.js'])
  vm.runInContext(await readFile(join(here, '..', '..', 'app', 'js', f), 'utf8'), sb);
const LISTS = sb.window.Lowsper.VOCABULARIES;
const ALL = Object.keys(LISTS);
const THREE = ['sante', 'juridique', 'finance'];
const BUDGET = 200; // jetons de contexte gardés par le moteur (engine.js)

// Règle 4.0 : listes bout à bout dans l'ordre du catalogue, le moteur garde les 200 derniers jetons
function tail(ids) {
  const text = ALL.filter((id) => ids.includes(id))
    .flatMap((id) => LISTS[id].fr)
    .join(', ');
  const ids2 = tok.encode(' ' + text, { add_special_tokens: false });
  return tok.decode(ids2.slice(-BUDGET)).trim();
}
// Part égale : chaque liste reçoit BUDGET / n jetons, remplis avec ses premiers termes
function share(ids) {
  const part = Math.floor(BUDGET / ids.length);
  const out = [];
  for (const id of ids) {
    const kept = [];
    for (const term of LISTS[id].fr) if (count([...kept, term].join(', ')) <= part) kept.push(term);
    out.push(...kept);
  }
  return out.join(', ');
}
// Alternance : premiers termes de chaque liste à la fin, puis le moteur garde la fin
function alternate(ids) {
  const lists = ids.map((id) => LISTS[id].fr);
  const order = [];
  for (let i = 0; i < Math.max(...lists.map((l) => l.length)); i++) for (const l of lists) if (l[i]) order.push(l[i]);
  const ids2 = tok.encode(' ' + order.reverse().join(', '), { add_special_tokens: false });
  return tok.decode(ids2.slice(-BUDGET)).trim();
}
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, "'");

await writeFile(
  join(out, 'ev.html'),
  `<!doctype html><meta charset="utf-8"><title>eval-vocab</title>
<script>window.Lowsper = { assetBase: '../../../app/' };</script>
<script src="../../../app/manifest.js"></script><script src="../../../app/models/index.txt"></script>
<script src="../../../app/js/engine.js"></script>
<script>
window.init = async (m) => { window.tr = new Lowsper.Transcriber(await Lowsper.loadAssets(null, m)); await window.tr.ready; };
window.run = async (b64, prompt) => {
  const by = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const audio = Float32Array.from(new Int16Array(by.buffer), (v) => v / 32768);
  const r = await window.tr.transcribe(audio, 'fr', prompt);
  return r.chunks.map((c) => c.text).join(' ').trim();
};
</script>`
);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(pathToFileURL(join(out, 'ev.html')).href);
await page.evaluate((m) => window.init(m), model);

const results = {};
for (const [domain, d] of Object.entries(corpus.domains)) {
  if (domains.length && !domains.includes(domain)) continue;
  const conditions = {
    aucun: '',
    seule: LISTS[domain].fr.join(', '),
    'trois bout à bout': tail(THREE),
    'douze bout à bout': tail(ALL),
    'trois, part égale': share(THREE),
    'douze, part égale': share(ALL),
    'trois en alternance': alternate(THREE),
    'douze en alternance': alternate(ALL),
  };
  const pcm = (await readFile(join(cache, 'langs', `vocab-${domain}.wav`))).subarray(44);
  const timeline = JSON.parse(await readFile(join(cache, 'langs', `vocab-${domain}.json`), 'utf8'));
  for (const [name, prompt] of Object.entries(conditions)) {
    const r = { found: 0, terms: 0, errors: 0, words: 0, inPrompt: 0, tokens: Math.min(BUDGET, count(prompt || ' ')) };
    for (const line of timeline) {
      const a = Math.max(0, Math.floor((line.start - 0.3) * 16000)) * 2;
      const b = Math.min(pcm.length, Math.floor((line.end + 0.3) * 16000) * 2);
      const text = await page.evaluate(
        ([x, p]) => window.run(x, p),
        [Buffer.from(pcm.subarray(a, b)).toString('base64'), prompt]
      );
      for (const term of d.terms.filter((t) => fold(line.text).includes(fold(t)))) {
        r.terms++;
        if (fold(text).includes(fold(term))) r.found++;
        if (fold(prompt).includes(fold(term).replace(/s$/, ''))) r.inPrompt++;
      }
      const ref = normalize(line.text, 'fr');
      r.errors += edits(ref, normalize(text, 'fr'));
      r.words += ref.length;
      if (name === 'aucun' || name === 'trois bout à bout') console.log(`${domain} / ${name} : ${text}`);
    }
    (results[domain] = results[domain] || {})[name] = r;
    console.log(
      `${domain} | ${name} | termes ${r.found}/${r.terms} | dans le contexte ${r.inPrompt}/${r.terms} | ` +
        `erreur ${((r.errors / r.words) * 100).toFixed(1)} % | ${r.tokens} jetons`
    );
  }
}
await writeFile(
  join(out, `eval-vocab-${model}${domains.length ? '-' + domains.join('-') : ''}.json`),
  JSON.stringify(results, null, 1)
);
await browser.close();
