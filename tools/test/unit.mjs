// Tests unitaires sans navigateur : découpage de la parole et assemblage du transcript.
// Usage : node test/unit.mjs
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const appJs = join(here, '..', '..', 'app', 'js');

const store = new Map();
const sandbox = {
  console,
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
};
sandbox.window = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);
for (const f of ['capture.js', 'transcript.js']) {
  vm.runInContext(await readFile(join(appJs, f), 'utf8'), sandbox, { filename: f });
}
const L = sandbox.Lowsper;

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log('OK    ' + name);
  } catch (e) {
    failed++;
    console.log('ÉCHEC ' + name + '\n      ' + e.message);
  }
}

// --- Générateur de signal : alternance parole (bruit modulé) / silence ---
function signal(pattern) {
  // pattern : [[secondes, 'speech'|'silence'], ...]
  const out = [];
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (const [sec, kind] of pattern) {
    const n = Math.round(sec * 16000);
    for (let i = 0; i < n; i++) {
      const amp = kind === 'speech' ? 0.25 * (0.6 + 0.4 * Math.sin(i / 400)) : 0.0008;
      out.push(rnd() * amp);
    }
  }
  return Float32Array.from(out);
}

function segment(pattern) {
  const segs = [];
  const s = new L.Segmenter((seg) => segs.push(seg));
  const audio = signal(pattern);
  for (let i = 0; i < audio.length; i += 1600) s.push(audio.subarray(i, i + 1600), false);
  s.flush();
  return segs;
}

await test('le silence seul ne produit aucun segment', () => {
  assert.equal(segment([[20, 'silence']]).length, 0);
});

await test('deux prises de parole séparées par 3 s de silence = 2 segments', () => {
  const segs = segment([[2, 'silence'], [4, 'speech'], [3, 'silence'], [5, 'speech'], [2, 'silence']]);
  assert.equal(segs.length, 2);
  assert.ok(Math.abs(segs[0].start - 2) < 0.6, 'début du 1er segment ~2 s, obtenu ' + segs[0].start);
  assert.ok(Math.abs(segs[1].start - 9) < 0.6, 'début du 2e segment ~9 s, obtenu ' + segs[1].start);
});

await test('une parole continue de 70 s est découpée en morceaux de 28 s maximum', () => {
  const segs = segment([[1, 'silence'], [70, 'speech'], [1, 'silence']]);
  assert.ok(segs.length >= 3, 'au moins 3 segments, obtenu ' + segs.length);
  for (const s of segs) assert.ok(s.audio.length / 16000 <= 28.1, 'segment trop long : ' + s.audio.length / 16000);
  const total = segs.reduce((n, s) => n + s.audio.length, 0) / 16000;
  assert.ok(total >= 69, 'aucune parole perdue (total ' + total.toFixed(1) + ' s)');
});

await test('un bruit très court (clic) est ignoré', () => {
  assert.equal(segment([[2, 'silence'], [0.1, 'speech'], [3, 'silence']]).length, 0);
});

await test('la pause fait avancer le temps sans rien enregistrer', () => {
  const segs = [];
  const s = new L.Segmenter((seg) => segs.push(seg));
  s.push(signal([[5, 'speech']]), true);
  s.push(signal([[3, 'speech'], [2, 'silence']]), false);
  s.flush();
  assert.equal(segs.length, 1);
  assert.ok(segs[0].start >= 4.5, 'horodatage après la pause, obtenu ' + segs[0].start);
});

await test('rééchantillonnage 48 kHz -> 16 kHz', () => {
  const r = new L.Resampler(48000);
  let n = 0;
  for (let i = 0; i < 10; i++) n += r.process(new Float32Array(4800)).length;
  assert.equal(n, 16000);
});

await test('rééchantillonnage 44,1 kHz -> 16 kHz', () => {
  const r = new L.Resampler(44100);
  let n = 0;
  for (let i = 0; i < 10; i++) n += r.process(new Float32Array(4410)).length;
  assert.ok(Math.abs(n - 16000) <= 1, 'obtenu ' + n);
});

// --- Transcript ---
const seg = (start, end, speech = 3) => ({ start, end, speech });

await test("l'écho des participants capté par le micro est supprimé", () => {
  const t = new L.Transcript({ sources: ['me', 'others'] });
  t.addSegment('others', seg(10, 15), { chunks: [{ from: 0, to: 5, text: 'On valide le budget du projet pour le trimestre prochain.' }] });
  t.addSegment('me', seg(10.3, 15.5), { chunks: [{ from: 0, to: 5, text: 'On valide le budget du projet pour le trimestre.' }] });
  t.addSegment('me', seg(20, 23), { chunks: [{ from: 0, to: 3, text: "D'accord, je m'occupe du chiffrage." }] });
  assert.equal(t.lines.map((l) => l.source).join(','), 'others,me');
  assert.match(t.lines[1].text, /chiffrage/);
});

await test('les hallucinations classiques de Whisper sont filtrées', () => {
  const t = new L.Transcript();
  t.addSegment('others', seg(0, 5, 0.5), { chunks: [{ from: 0, to: 5, text: "Sous-titres réalisés par la communauté d'Amara.org" }] });
  t.addSegment('others', seg(6, 7, 0.5), { chunks: [{ from: 0, to: 1, text: 'Merci.' }] });
  t.addSegment('others', seg(8, 12, 3), { chunks: [{ from: 0, to: 4, text: 'Merci pour la présentation.' }] });
  assert.equal(t.lines.length, 1);
});

await test('les boucles de répétition sont réduites', () => {
  const t = new L.Transcript();
  t.addSegment('me', seg(0, 10), { chunks: [{ from: 0, to: 10, text: 'Oui oui oui oui oui oui. On avance. On avance. On avance.' }] });
  assert.equal(t.lines[0].text, 'Oui. On avance.');
});

await test('Markdown : en-tête, horodatage, regroupement par locuteur et pauses', () => {
  const t = new L.Transcript({ title: 'Point hebdo', startedAt: Date.UTC(2026, 9, 3, 15, 0), endedAt: Date.UTC(2026, 9, 3, 16, 0), sources: ['me', 'others'], model: 'Whisper base' });
  t.addSegment('me', seg(5, 9), { chunks: [{ from: 0, to: 2, text: 'Bonjour à tous.' }, { from: 2, to: 4, text: 'On commence ?' }] });
  t.addSegment('others', seg(3700, 3705), { chunks: [{ from: 0, to: 5, text: 'Oui, allons-y.' }] });
  t.addPause(1800, 1900);
  const md = t.toMarkdown();
  assert.match(md, /^# Transcript de réunion : Point hebdo/);
  assert.match(md, /\*\*\[00:00:05\] Vous :\*\* Bonjour à tous\. On commence \?/);
  assert.match(md, /\*\*\[01:01:40\] Participants :\*\* Oui, allons-y\./);
  assert.match(md, /_\[00:30:00 à 00:31:40\] Enregistrement en pause\._/);
  assert.ok(md.indexOf('00:30:00') < md.indexOf('01:01:40'), 'ordre chronologique');
  assert.ok(!md.includes('—'), 'pas de tiret cadratin');
  assert.match(t.fileName(), /^reunion_2026-10-03_\d\dh00_point-hebdo\.md$/);
});

await test('sauvegarde et récupération d’une session interrompue', () => {
  store.clear();
  const t = new L.Transcript({ title: 'Crash', sources: ['me'] });
  t.addSegment('me', seg(1, 4), { chunks: [{ from: 0, to: 3, text: 'Texte à ne pas perdre.' }] });
  const back = L.Transcript.loadUnfinished();
  assert.ok(back, 'session retrouvée');
  assert.equal(back.lines[0].text, 'Texte à ne pas perdre.');
  t.meta.endedAt = Date.now();
  t.save();
  assert.equal(L.Transcript.loadUnfinished(), null, 'une session terminée ne déclenche pas la récupération');
});

if (failed) {
  console.log(`\n${failed} test(s) en échec`);
  process.exit(1);
}
console.log('\nTous les tests unitaires passent.');
