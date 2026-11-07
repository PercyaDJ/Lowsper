// Banc du compte rendu extractif (lot C1, decision.md §40) : compare les phrases retenues par
// app/js/extract.js aux phrases étiquetées du corpus fictif (corpus/compte-rendu.json) et des corpus
// hebdo et entretien, écrits avant ce lot.
//   - mode texte (défaut) : sur le texte exact des répliques, sans reconnaissance vocale ;
//   - --transcribe : rejoue l'audio de chaque réunion dans la chaîne Lowsper (découpage, Whisper,
//     voix), comme en réunion, et garde les répliques transcrites (.cache/cr/<id>-<modèle>.json) ;
//   - --audio : mesure sur ces répliques transcrites (horodatage et personne compris).
// Prérequis du mode audio : python corpus/make-cr.py, node build.mjs --embed whisper-small,
// et node test/eval-hebdo.mjs whisper-small (puis --corpus=entretien) pour les corpus indépendants.
// Usage : node test/eval-extract.mjs [--list] [--transcribe | --audio] [--model=whisper-small]
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..', '..', 'app');
const cacheDir = join(here, '..', '.cache', 'cr');
const out = join(here, 'output');
const arg = (k) => (process.argv.find((a) => a.startsWith('--' + k + '=')) || '').split('=')[1] || '';
const flag = (k) => process.argv.includes('--' + k);
const modelId = arg('model') || 'whisper-small';
const corpus = JSON.parse(await readFile(join(here, 'corpus', 'compte-rendu.json'), 'utf8'));
// Corpus aveugle : écrit par un autre rédacteur, sans voir les règles (decision.md §40)
for (const f of ['compte-rendu-aveugle.json', 'compte-rendu-aveugle-2.json'])
  corpus.meetings.push(...JSON.parse(await readFile(join(here, 'corpus', f), 'utf8')).meetings);

// extract.js chargé comme dans la page (script classique qui étend window.Lowsper)
const sandbox = {};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(await readFile(join(app, 'js', 'extract.js'), 'utf8'), sandbox);
const X = sandbox.Lowsper.Extract;

const norm = (t) =>
  String(t)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/'/g, "' ")
    .split(/\s+/)
    .filter(Boolean);
/** Part des mots de a retrouvés dans b. */
function cover(a, b) {
  const bag = new Map();
  for (const w of norm(b)) bag.set(w, (bag.get(w) || 0) + 1);
  const ref = norm(a);
  let hit = 0;
  for (const w of ref)
    if (bag.get(w)) {
      hit++;
      bag.set(w, bag.get(w) - 1);
    }
  return ref.length ? hit / ref.length : 0;
}

// ---------------------------------------------------------------------------
// Transcription par la chaîne Lowsper (navigateur), une réunion à la fois
// ---------------------------------------------------------------------------
async function transcribeAll() {
  const { chromium } = await import('playwright-core');
  await mkdir(out, { recursive: true });
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
    join(out, 'eval-extract.html'),
    `<!doctype html><meta charset="utf-8"><title>eval extract</title>
<script>window.Lowsper = { assetBase: '../../../app/' };</script>
${scripts}
<script>
window.runMeeting = async (modelId, lang, pcm) => {
  const toF32 = (b64) => { const b = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); return Float32Array.from(new Int16Array(b.buffer), (v) => v / 32768); };
  if (!window.TR) {
    const assets = await Lowsper.loadAssets(null, modelId);
    window.TR = new Lowsper.Transcriber(assets);
    await window.TR.ready;
    window.AN = assets.analysis ? new Lowsper.Analyzer(assets.analysis) : null;
    if (window.AN) await window.AN.ready;
  }
  const tr = window.TR, an = window.AN;
  const tracker = an && an.hasSpeaker ? new Lowsper.SpeakerTracker(an) : null;
  const V = Lowsper.Vocabulary;
  const transcript = new Lowsper.Transcript({ sources: ['me', 'others'], language: lang, noteLang: lang });
  const queue = [];
  for (const ch of ['me', 'others']) {
    const audio = toF32(pcm[ch]);
    const s = new Lowsper.Segmenter((b) => queue.push({ ch, b }), { vad: an ? { run: (x) => an.vad(ch, x) } : null });
    for (let i = 0; i < audio.length; i += 4096) await s.push(audio.subarray(i, i + 4096), false);
    await s.flush();
  }
  queue.sort((x, y) => x.b.start - y.b.start);
  let ms = 0;
  for (const { ch, b } of queue) {
    const keep = b.audio.slice();
    const prompt = V ? V.prompt({ vocab: transcript.promptVocab(lang), title: '', glossary: '' }) : '';
    const r = await tr.transcribe(b.audio, lang, prompt, (b.map || []).map((m) => m.at));
    ms += r.ms;
    const voices = tracker && ch === 'others' ? await tracker.label(keep, r.chunks, b) : null;
    transcript.addSegment(ch, b, r, voices, {});
  }
  if (tracker) transcript.applyVoiceMap(tracker.finalize());
  return { ms, hyp: transcript.lines.map((l) => ({ source: l.source, start: l.start, end: l.end, speaker: transcript.speakerName(l), text: l.text })) };
};
</script>`
  );
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(pathToFileURL(join(out, 'eval-extract.html')).href);
  for (const m of corpus.meetings) {
    const done = join(cacheDir, `${m.id}-${modelId}.json`);
    if (
      !flag('force') &&
      (await access(done).then(
        () => true,
        () => false
      ))
    )
      continue;
    try {
      await access(join(cacheDir, `${m.id}-me.wav`));
    } catch {
      console.log(`${m.id} : pas d'audio, lancez python corpus/make-cr.py`);
      continue;
    }
    const pcm = {};
    for (const ch of ['me', 'others'])
      pcm[ch] = (await readFile(join(cacheDir, `${m.id}-${ch}.wav`))).subarray(44).toString('base64');
    const t0 = Date.now();
    const res = await page.evaluate(([id, lang, p]) => window.runMeeting(id, lang, p), [modelId, m.lang, pcm]);
    await writeFile(join(cacheDir, `${m.id}-${modelId}.json`), JSON.stringify(res.hyp, null, 1));
    console.log(`${m.id} : ${res.hyp.length} répliques, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  await browser.close();
}

// ---------------------------------------------------------------------------
// Jeux de mesure : répliques (texte exact ou transcrit) et phrases étiquetées
// ---------------------------------------------------------------------------
const meName = (lang) => (lang === 'en' ? 'You' : 'Vous');

async function sets(audio) {
  const list = [];
  for (const m of corpus.meetings) {
    const marks = [];
    let items;
    if (audio) {
      if (
        !(await access(join(cacheDir, `${m.id}-${modelId}.json`)).then(
          () => true,
          () => false
        ))
      ) {
        console.log(`(${m.id} : pas encore transcrite, lancez --transcribe)`);
        continue;
      }
      const truth = JSON.parse(await readFile(join(cacheDir, `${m.id}.truth.json`), 'utf8'));
      for (const t of truth)
        for (const k of t.marks) marks.push({ ...k, who: t.who, channel: t.channel, start: t.start, end: t.end });
      items = JSON.parse(await readFile(join(cacheDir, `${m.id}-${modelId}.json`), 'utf8'));
    } else {
      items = m.lines.map((l, i) => ({ start: i, speaker: l.who, text: l.text, line: i }));
      m.lines.forEach((l, i) => (l.marks || []).forEach((k) => marks.push({ ...k, who: l.who, line: i })));
    }
    list.push({ id: m.id, lang: m.lang, split: m.split, items, marks });
  }
  for (const ind of corpus.independent) {
    const src = JSON.parse(await readFile(join(here, 'corpus', `${ind.corpus}-fr.json`), 'utf8'));
    const marks = [];
    let items;
    if (audio) {
      const file = join(out, `${ind.corpus}-${modelId}-lignes.json`);
      try {
        await access(file);
      } catch {
        console.log(
          `(${ind.corpus} : lancez d'abord node test/eval-hebdo.mjs ${modelId}${ind.corpus === 'hebdo' ? '' : ' --corpus=' + ind.corpus})`
        );
        continue;
      }
      const res = JSON.parse(await readFile(file, 'utf8'));
      items = res.hyp;
      for (const k of ind.marks) {
        const t = res.lines.find((l) => l.ref.includes(k.text));
        marks.push({ ...k, who: t.who, channel: t.channel, start: t.start, end: t.end });
      }
    } else {
      items = src.lines.map((l, i) => ({ start: i, speaker: l.who, text: l.ref, line: i }));
      for (const k of ind.marks) marks.push({ ...k, line: src.lines.findIndex((l) => l.ref.includes(k.text)) });
    }
    list.push({ id: ind.corpus, lang: 'fr', split: 'indépendant', items, marks });
  }
  return list;
}

/** Associe phrases retenues et phrases étiquetées. */
function score(set, audio) {
  const found = X.extract(set.items);
  const used = new Set();
  const rows = [];
  for (const f of found) {
    let best = -1,
      bestCov = 0;
    set.marks.forEach((k, i) => {
      if (used.has(i)) return;
      const near = audio
        ? set.items.some(
            (it) => it.start === f.start && it.text.includes(f.text) && it.start <= k.end + 1 && it.end >= k.start - 1
          )
        : set.items.some((it) => it.line === k.line && it.start === f.start);
      if (!near) return;
      const c = Math.min(cover(k.text, f.text), 1) * 0.5 + Math.min(cover(f.text, k.text), 1) * 0.5;
      if (c > bestCov) [best, bestCov] = [i, c];
    });
    if (best >= 0 && bestCov >= (audio ? 0.5 : 0.6)) {
      used.add(best);
      const k = set.marks[best];
      rows.push({ f, k, ok: k.kind === 'neutral' || k.kind === f.kind || (k.also || []).includes(f.kind) });
    } else rows.push({ f, k: null });
  }
  const missed = set.marks.filter((k, i) => !used.has(i) && k.kind !== 'neutral');
  return { found, rows, missed };
}

function summarize(name, results, audio) {
  const kinds = ['decision', 'action', 'question'];
  const tot = { marks: 0, hits: 0, right: 0, extracted: 0, false: 0, src: 0, srcN: 0, time: 0 };
  const per = Object.fromEntries(kinds.map((k) => [k, { marks: 0, hits: 0, right: 0 }]));
  for (const r of results) {
    for (const row of r.rows) {
      if (row.k && row.k.kind === 'neutral') continue;
      tot.extracted++;
      if (!row.k) {
        tot.false++;
        continue;
      }
      tot.hits++;
      per[row.k.kind].hits++;
      if (row.ok) {
        tot.right++;
        per[row.k.kind].right++;
      }
      if (audio) {
        const me = row.f.speaker === meName(r.lang);
        tot.srcN++;
        if (me === (row.k.channel === 'me')) tot.src++;
        if (Math.abs(row.f.start - row.k.start) <= 3) tot.time++;
      }
    }
    for (const k of r.marks) if (k.kind !== 'neutral') (tot.marks++, per[k.kind].marks++);
  }
  const pct = (a, b) => (b ? Math.round((100 * a) / b) + ' %' : '-');
  console.log(`\n${name}`);
  console.log(`  phrases étiquetées : ${tot.marks} ; retenues : ${tot.extracted}`);
  console.log(
    `  retrouvées : ${tot.hits} (${pct(tot.hits, tot.marks)}) ; manquées : ${tot.marks - tot.hits} ; fausses : ${tot.false} (précision ${pct(tot.hits, tot.extracted)})`
  );
  console.log(`  bien rangées : ${tot.right} sur ${tot.hits} (${pct(tot.right, tot.hits)})`);
  for (const k of kinds)
    console.log(`    ${k.padEnd(9)} : ${per[k].hits}/${per[k].marks} retrouvées, ${per[k].right} bien rangées`);
  if (audio)
    console.log(
      `  personne (vous ou les participants) juste : ${pct(tot.src, tot.srcN)} ; horodatage à 3 s près : ${pct(tot.time, tot.srcN)}`
    );
  return { ...tot, per };
}

if (flag('transcribe')) {
  await transcribeAll();
  process.exit(0);
}
const audio = flag('audio');
const all = await sets(audio);
const results = all.map((s) => ({ ...s, ...score(s, audio) }));
console.log(`Compte rendu extractif, mode ${audio ? 'audio (' + modelId + ')' : 'texte exact'}`);
const report = {};
for (const split of ['dev', 'test', 'aveugle', 'aveugle-2', 'indépendant']) {
  for (const lang of ['fr', 'en']) {
    const rs = results.filter((r) => r.split === split && r.lang === lang);
    if (rs.length)
      report[`${split}-${lang}`] = summarize(`${split} ${lang} (${rs.map((r) => r.id).join(', ')})`, rs, audio);
  }
}
if (flag('list')) {
  for (const r of results) {
    console.log(`\n=== ${r.id} (${r.split})`);
    for (const row of r.rows)
      console.log(
        `  ${row.k ? (row.ok ? 'OK   ' : 'RANG ') : 'FAUX '} ${row.f.kind.padEnd(8)} ${row.f.speaker} : ${row.f.text}${row.k && !row.ok ? '  [attendu ' + row.k.kind + ']' : ''}`
      );
    for (const k of r.missed) console.log(`  MANQUE ${k.kind.padEnd(8)} ${k.who || ''} : ${k.text}`);
  }
}
await mkdir(out, { recursive: true });
await writeFile(join(out, `eval-extract-${audio ? modelId : 'texte'}.json`), JSON.stringify(report, null, 1));
