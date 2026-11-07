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
// Avec --corpus=vocab-ia (decision.md §44) : corpus corpus/vocab-ia.json, une série de phrases par
// langue parlée (audio : corpus/make-langs.py vocab-ia), et les contextes nommés dans le corpus
// (« conditions » : listes cochées), construits par les fonctions de Lowsper (Vocabulary.alternate
// et Vocabulary.prompt). Un terme y est compté comme mot entier (« IA » n'est pas trouvé dans
// « via ») ; les domaines en argument deviennent les langues parlées (fr, en).
// Prérequis : node build.mjs --embed whisper-small.
// Usage : node test/eval-vocab.mjs [modèle] [domaines ou langues...] [--corpus=vocab-ia]
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
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const corpusName = (process.argv.find((a) => a.startsWith('--corpus=')) || '--corpus=vocab-fr').slice(9);
const model = args[0] || 'whisper-small';
const domains = args.slice(1);
const corpus = JSON.parse(await readFile(join(here, 'corpus', corpusName + '.json'), 'utf8'));

env.allowRemoteModels = false;
env.localModelPath = join(cache, 'models') + '/';
const tok = await AutoTokenizer.from_pretrained(model.replace(/-gpu$/, ''));
const count = (text) => tok.encode(' ' + text, { add_special_tokens: false }).length;
const sb = { window: {} };
vm.createContext(sb);
for (const f of ['vocabularies.js', 'vocabulary.js'])
  vm.runInContext(await readFile(join(here, '..', '..', 'app', 'js', f), 'utf8'), sb);
const LISTS = sb.window.Lowsper.VOCABULARIES;
const V = sb.window.Lowsper.Vocabulary;
// Les douze listes du lot R8 : le domaine « ia » (§44) est exclu, pour garder la mesure du §35
const ALL = Object.keys(LISTS).filter((id) => id !== 'ia');
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
// Mot entier, pluriel en « s » accepté, tirets et espaces équivalents (corpus « match »: « word »)
const esc = (t) =>
  fold(t)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/[\s-]+/g, '[\\s-]+');
// Terme échappé, tirets et espaces en une seule classe : pas de retour arrière exponentiel
// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
const hasWord = (text, term) => new RegExp(`(^|[^a-z0-9])${esc(term)}s?([^a-z0-9]|$)`).test(fold(text));
const has = corpus.match === 'word' ? hasWord : (text, term) => fold(text).includes(fold(term));

await writeFile(
  join(out, 'ev.html'),
  `<!doctype html><meta charset="utf-8"><title>eval-vocab</title>
<script>window.Lowsper = { assetBase: '../../../app/' };</script>
<script src="../../../app/manifest.js"></script><script src="../../../app/models/index.txt"></script>
<script src="../../../app/js/engine.js"></script>
<script>
window.init = async (m) => { window.tr = new Lowsper.Transcriber(await Lowsper.loadAssets(null, m)); await window.tr.ready; };
window.run = async (b64, prompt, lang) => {
  const by = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const audio = Float32Array.from(new Int16Array(by.buffer), (v) => v / 32768);
  const r = await window.tr.transcribe(audio, lang || 'fr', prompt);
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
// Séries à mesurer : un domaine du corpus R8 (phrases françaises), ou une langue de vocab-ia
const series = corpus.langs
  ? Object.entries(corpus.langs).map(([lang, d]) => [lang, { ...d, lang, file: `${corpusName}-${lang}` }])
  : Object.entries(corpus.domains).map(([domain, d]) => [domain, { ...d, lang: 'fr', file: `vocab-${domain}` }]);
for (const [domain, d] of series) {
  if (domains.length && !domains.includes(domain)) continue;
  const named =
    corpus.conditions &&
    Object.fromEntries(
      Object.entries(corpus.conditions).map(([name, ids]) => [name, V.prompt({ vocab: V.alternate(ids, d.lang, '') })])
    );
  const conditions = named || {
    aucun: '',
    seule: LISTS[domain].fr.join(', '),
    'trois bout à bout': tail(THREE),
    'douze bout à bout': tail(ALL),
    'trois, part égale': share(THREE),
    'douze, part égale': share(ALL),
    'trois en alternance': alternate(THREE),
    'douze en alternance': alternate(ALL),
  };
  const pcm = (await readFile(join(cache, 'langs', `${d.file}.wav`))).subarray(44);
  const timeline = JSON.parse(await readFile(join(cache, 'langs', `${d.file}.json`), 'utf8'));
  for (const [name, prompt] of Object.entries(conditions)) {
    const r = { found: 0, terms: 0, errors: 0, words: 0, inPrompt: 0, tokens: Math.min(BUDGET, count(prompt || ' ')) };
    for (const line of timeline) {
      const a = Math.max(0, Math.floor((line.start - 0.3) * 16000)) * 2;
      const b = Math.min(pcm.length, Math.floor((line.end + 0.3) * 16000) * 2);
      const text = await page.evaluate(
        ([x, p, l]) => window.run(x, p, l),
        [Buffer.from(pcm.subarray(a, b)).toString('base64'), prompt, d.lang]
      );
      for (const term of d.terms.filter((t) => has(line.text, t))) {
        r.terms++;
        if (has(text, term)) r.found++;
        else (r.missed = r.missed || []).push(term);
        if (fold(prompt).includes(fold(term).replace(/s$/, ''))) r.inPrompt++;
      }
      const ref = normalize(line.text, d.lang);
      r.errors += edits(ref, normalize(text, d.lang));
      r.words += ref.length;
      (r.texts = r.texts || []).push(text);
      if (name === 'aucun' || name === 'trois bout à bout' || named) console.log(`${domain} / ${name} : ${text}`);
    }
    (results[domain] = results[domain] || {})[name] = r;
    console.log(
      `${domain} | ${name} | termes ${r.found}/${r.terms} | dans le contexte ${r.inPrompt}/${r.terms} | ` +
        `erreur ${((r.errors / r.words) * 100).toFixed(1)} % | ${r.tokens} jetons` +
        (r.missed ? ` | manqués : ${r.missed.join(', ')}` : '')
    );
  }
}
await writeFile(
  join(out, `eval-${corpusName}-${model}${domains.length ? '-' + domains.join('-') : ''}.json`),
  JSON.stringify(results, null, 1)
);
await browser.close();
