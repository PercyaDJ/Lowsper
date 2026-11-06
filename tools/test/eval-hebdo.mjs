// Banc « réunion réaliste » : rejoue le corpus hebdo (2 canaux, 9 voix, interruptions)
// dans toute la chaîne Lowsper (découpage, moteur, assemblage) et mesure :
//   - la couverture de chaque réplique (part des mots de référence retrouvés au bon moment),
//   - les répliques perdues ou mal captées,
//   - le taux d'erreur global, les sigles et noms propres retrouvés,
//   - les blocs tronqués (plafond de jetons) et le temps de calcul,
//   - si disponible, la justesse de l'identification des intervenants.
// Prérequis : node build.mjs --embed <modèle>
// Usage : node test/eval-hebdo.mjs <modèle> [--no-glossary] [--device=webgpu] [--teams]
//         [--corpus=entretien] (entretien d'embauche en tête-à-tête, vocabulaire cybersécurité, son de visio)
//         [--vocab=cyber,it] (vocabulaire métier intégré) [--title] (titre de réunion dans le contexte) [--context]
import { chromium } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'output');
await mkdir(out, { recursive: true });
const modelId = process.argv[2] || 'whisper-small';
const useGlossary = !process.argv.includes('--no-glossary');
const device = (process.argv.find((a) => a.startsWith('--device=')) || '').split('=')[1] || '';
const opts = { energy: process.argv.includes('--energy'), noSpeakers: process.argv.includes('--no-speakers') };
const arg = (k) => (process.argv.find((a) => a.startsWith('--' + k + '=')) || '').split('=')[1] || '';
const name = arg('corpus') || 'hebdo';
const corpus = JSON.parse(await readFile(join(here, 'corpus', `${name}-fr.json`), 'utf8'));
const truth = JSON.parse(await readFile(join(here, 'corpus', `${name}.truth.json`), 'utf8'));
opts.vocab = arg('vocab') ? arg('vocab').split(',') : [];
opts.title = process.argv.includes('--title') ? corpus.title.replace(/ \(.*\)$/, '') : '';
opts.context = process.argv.includes('--context');
// --echo : micro sans casque, qui réentend les participants dans les haut-parleurs
opts.echo = process.argv.includes('--echo');
const pcm = {};
// --teams : son des participants dégradé façon visio (compression Opus 12 kb/s, bande 200-3800 Hz, bruit rose)
const variant = process.argv.includes('--teams') || name === 'entretien' ? '-teams' : '';
for (const ch of ['me', 'others'])
  pcm[ch] = (
    await readFile(join(here, 'corpus', `${name}-${ch}${ch === 'others' ? variant : opts.echo ? '-echo' : ''}.wav`))
  )
    .subarray(44)
    .toString('base64');
await writeFile(join(out, 'hebdo-pcm.js'), `window.HEBDO=${JSON.stringify(pcm)};`);

const scripts = [
  'manifest.js',
  'models/index.txt',
  'js/i18n.js',
  'js/languages.js',
  'js/engine.js',
  'js/analyzer.js',
  'js/capture.js',
  'js/transcript.js',
  'js/speakers.js',
  'js/vocabularies.js',
  'js/vocabulary.js',
]
  .map((s) => `<script src="../../../app/${s}"></script>`)
  .join('\n');
await writeFile(
  join(out, 'eval-hebdo.html'),
  `<!doctype html><meta charset="utf-8"><title>eval hebdo</title>
<script>window.Lowsper = { assetBase: '../../../app/' };</script>
${scripts}
<script src="hebdo-pcm.js"></script>
<script>
window.runHebdo = async (modelId, glossary, opts) => {
  const toF32 = (b64) => { const b = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); return Float32Array.from(new Int16Array(b.buffer), (v) => v / 32768); };
  const assets = await Lowsper.loadAssets(null, modelId);
  const tr = new Lowsper.Transcriber(assets);
  await tr.ready;
  const an = assets.analysis && !opts.energy ? new Lowsper.Analyzer(assets.analysis) : null;
  if (an) await an.ready;
  if (an) { const p = await an.vad('test', new Float32Array(1024)); if (!p || p.length !== 2) throw new Error('VAD Silero en échec'); }
  const tracker = an && an.hasSpeaker && !opts.noSpeakers ? new Lowsper.SpeakerTracker(an) : null;
  const mic = an && an.hasSpeaker && !opts.noSpeakers ? new Lowsper.MicVoice(an) : null;
  const micSims = [];
  const V = Lowsper.Vocabulary;
  const transcript = new Lowsper.Transcript({ glossary, title: opts.title, vocab: opts.vocab, sources: ['me', 'others'] });
  const blocks = [];
  let ms = 0;
  // Les deux sources sont traitées dans l'ordre chronologique des passages, comme en réunion
  const queue = [];
  for (const ch of ['me', 'others']) {
    const audio = toF32(HEBDO[ch]);
    const s = new Lowsper.Segmenter((b) => queue.push({ ch, b }), { vad: an ? { run: (x) => an.vad(ch, x) } : null });
    for (let i = 0; i < audio.length; i += 4096) await s.push(audio.subarray(i, i + 4096), false);
    await s.flush();
  }
  queue.sort((x, y) => x.b.start - y.b.start);
  const busy = queue.filter((q) => q.ch === 'others').flatMap((q) => Lowsper.speechIntervals(q.b));
  for (const { ch, b } of queue) {
    {
      const keep = b.audio.slice();
      // Même contexte que l'application (app.js, promptFor) : vocabulaires alternés, nom, glossaire
      const prompt = V ? V.prompt({ vocab: transcript.promptVocab('fr'), title: opts.title, glossary: transcript.meta.glossary, context: opts.context ? transcript.contextFor(ch, b.start) : '' }) : glossary;
      const r = await tr.transcribe(b.audio, 'fr', prompt, (b.map || []).map((m) => m.at));
      ms += r.ms;
      blocks.push({ ch, dur: +(keep.length / 16000).toFixed(1), ms: Math.round(r.ms), capped: r.capped, retried: r.retried });
      const voices = tracker && ch === 'others' ? await tracker.label(keep, r.chunks, b) : null;
      let embs = null;
      if (mic && ch === 'me') {
        embs = await mic.embed(keep, r.chunks, b);
        embs.forEach((e, i) => micSims.push({ at: Lowsper.blockTime(b, r.chunks[i].from || 0), to: Lowsper.blockTime(b, r.chunks[i].to != null ? r.chunks[i].to : (keep.length / 16000)), e, text: r.chunks[i].text }));
      }
      transcript.addSegment(ch, b, r, voices, { embs });
    }
  }
  if (tracker) transcript.applyVoiceMap(tracker.finalize());
  window.SPK_ITEMS = tracker ? tracker.items.map((it) => ({ emb: Array.from(it.emb), dur: it.dur, at: it.at })) : [];
  // similarité finale (empreinte complète) de chaque phrase du micro, pour le réglage du seuil
  if (mic) {
    window.ECHO_REMOVED = transcript.removeVoiceEcho(mic, busy);
    window.MIC_DEBUG = { busy, items: mic.items.map((it) => ({ from: it.from, to: it.to, emb: Array.from(it.emb) })) };
    const c = mic.centroid(busy);
    for (const m of micSims) { m.sim = m.e && c ? m.e.reduce((n, x, k) => n + x * c[k], 0) : null; delete m.e; }
  }
  window.MIC_SIMS = micSims;
  return { micDebug: window.MIC_DEBUG, echoRemoved: window.ECHO_REMOVED || 0, micSims, items: window.SPK_ITEMS, lines: transcript.lines.map((l) => ({ ...l, speaker: l.voice != null ? transcript.speakerName(l) : null })), blocks, ms, markdown: transcript.toMarkdown() };
};
</script>`
);

const norm = (t) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/'/g, "' ")
    .split(/\s+/)
    .filter(Boolean);

function coverage(refWords, hypWords) {
  const bag = new Map();
  for (const w of hypWords) bag.set(w, (bag.get(w) || 0) + 1);
  let hit = 0;
  for (const w of refWords)
    if (bag.get(w)) {
      hit++;
      bag.set(w, bag.get(w) - 1);
    }
  return hit / refWords.length;
}

function wer(ref, hyp) {
  const r = norm(ref),
    h = norm(hyp);
  let prev = Array.from({ length: h.length + 1 }, (_, j) => j);
  for (let i = 1; i <= r.length; i++) {
    const cur = [i];
    for (let j = 1; j <= h.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[h.length] / r.length;
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args:
    device === 'webgpu'
      ? [
          '--enable-unsafe-webgpu',
          '--enable-features=Vulkan',
          '--use-angle=swiftshader',
          '--use-webgpu-adapter=swiftshader',
        ]
      : [],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console]', m.text());
});
await page.goto(pathToFileURL(join(out, 'eval-hebdo.html')).href);
const t0 = Date.now();
const res = await page.evaluate(
  ([m, g, o]) => window.runHebdo(m, g, o),
  [modelId, useGlossary ? corpus.glossary : '', opts]
);
await browser.close();

// Couverture par réplique
let sumCov = 0;
const missed = [];
for (const t of truth) {
  const hyp = res.lines.filter((l) => l.source === t.channel && l.end >= t.start - 2.5 && l.start <= t.end + 2.5);
  const cov = coverage(norm(t.ref), norm(hyp.map((l) => l.text).join(' ')));
  sumCov += cov;
  if (cov < 0.7) missed.push(`${t.who} [${t.start}s] ${(cov * 100).toFixed(0)} % : ${t.ref.slice(0, 70)}`);
}
const report = {
  corpus: name,
  echo_micro: opts.echo,
  modele: modelId,
  glossaire: useGlossary,
  vocabulaire: opts.vocab.join(',') || 'aucun',
  titre: !!opts.title,
  contexte: opts.context,
  vad: opts.energy ? 'volume' : 'silero',
};
for (const ch of ['me', 'others']) {
  const ref = truth
    .filter((t) => t.channel === ch)
    .map((t) => t.ref)
    .join(' ');
  const hyp = res.lines
    .filter((l) => l.source === ch)
    .map((l) => l.text)
    .join(' ');
  report[`wer_${ch}`] = (wer(ref, hyp) * 100).toFixed(1) + ' %';
}
report.couverture = ((sumCov / truth.length) * 100).toFixed(1) + ' %';
report.repliques_mal_captees = missed.length + ' / ' + truth.length;
const terms = corpus.terms || corpus.glossary.split(',').map((s) => s.trim());
const allRef = truth.map((t) => t.ref).join(' ');
const allHyp = res.lines.map((l) => l.text).join(' ');
let tTotal = 0,
  tFound = 0;
const tMissed = [];
for (const term of terms) {
  const re = new RegExp('(^|[^\\p{L}])' + term.replace(/ /g, '\\s?') + '(?![\\p{L}])', 'gu');
  const n = (allRef.match(re) || []).length;
  const m = Math.min(n, (allHyp.match(re) || []).length);
  tTotal += n;
  tFound += m;
  if (m < n) tMissed.push(term);
}
report.sigles_noms = `${tFound}/${tTotal}`;
report.blocs = res.blocks.length;
report.blocs_tronques = res.blocks.filter((b) => b.capped).length;
report.calcul = (res.ms / 1000).toFixed(1) + ' s';
report.audio = truth[truth.length - 1].end.toFixed(0) + ' s';
if (res.lines.some((l) => l.speaker)) {
  // Justesse des intervenants : pour chaque étiquette, l'intervenant réel majoritaire
  const byLabel = new Map();
  for (const l of res.lines.filter((x) => x.source === 'others' && x.speaker)) {
    const mid = (l.start + l.end) / 2;
    const t = truth.find((x) => x.channel === 'others' && mid >= x.start - 0.3 && mid <= x.end + 0.3);
    if (!t) continue;
    const m = byLabel.get(l.speaker) || new Map();
    m.set(t.who, (m.get(t.who) || 0) + l.text.length);
    byLabel.set(l.speaker, m);
  }
  let ok = 0,
    all = 0;
  for (const m of byLabel.values()) {
    const vals = [...m.values()];
    ok += Math.max(...vals);
    all += vals.reduce((a, b) => a + b, 0);
  }
  report.intervenants_detectes =
    byLabel.size + ' (réels : ' + new Set(truth.filter((t) => t.channel === 'others').map((t) => t.who)).size + ')';
  report.purete_intervenants = ((ok / all) * 100).toFixed(0) + ' %';
}
{
  // Écho : phrases attribuées à « Vous » alors que seul le participant parlait à ce moment-là
  const inside = (who, a, b) =>
    truth.some(
      (t) => (who === 'me' ? t.channel === 'me' : t.channel === 'others') && a < t.end + 0.3 && b > t.start - 0.3
    );
  const meLines = res.lines.filter((l) => l.source === 'me');
  const echo = meLines.filter((l) => !inside('me', l.start, l.end) && inside('others', l.start, l.end));
  report.echo_attribue_a_vous = echo.length + ' phrase(s) sur ' + meLines.length;
  report.echo_retire_par_la_voix = res.echoRemoved;
  if (opts.echo || process.argv.includes('--mic-sims')) {
    for (const m of res.micSims) {
      const own = inside('me', m.at, m.to);
      console.log(
        `  micro ${m.at.toFixed(1)}s ${own ? 'VOUS ' : 'ÉCHO '} sim=${m.sim == null ? '-' : m.sim.toFixed(2)} ${m.text.slice(0, 60)}`
      );
    }
    for (const l of echo) console.log('  écho restant : ' + l.text.slice(0, 80));
  }
}
console.log(JSON.stringify(report, null, 1));
console.log('Termes manqués : ' + tMissed.join(', '));
console.log('Répliques mal captées :\n  ' + missed.join('\n  '));
console.log(
  'Blocs : ' +
    res.blocks
      .map(
        (b) => `${b.ch}:${b.dur}s/${(b.ms / 1000).toFixed(1)}s${b.capped ? ' TRONQUÉ' : ''}${b.retried ? ' relu' : ''}`
      )
      .join('  ')
);
await writeFile(join(out, `${name}-embeddings${variant}.json`), JSON.stringify(res.items));
if (res.micDebug)
  await writeFile(join(out, `${name}-micro${opts.echo ? '-echo' : ''}.json`), JSON.stringify(res.micDebug));
await writeFile(join(out, `${name}-${modelId}${device ? '-' + device : ''}.md`), res.markdown);
console.log(`(durée totale du banc ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
