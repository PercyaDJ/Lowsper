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
for (const f of ['capture.js', 'transcript.js', 'speakers.js']) {
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

await test('les silences sont retirés : deux prises de parole = un seul bloc compact', () => {
  const segs = segment([[2, 'silence'], [4, 'speech'], [3, 'silence'], [5, 'speech'], [2, 'silence']]);
  assert.equal(segs.length, 1);
  const b = segs[0];
  assert.ok(b.audio.length / 16000 < 11, 'bloc compact (< 11 s), obtenu ' + (b.audio.length / 16000).toFixed(1));
  assert.equal(b.map.length, 2);
  assert.ok(Math.abs(L.blockTime(b, 0.5) - 2) < 0.6, 'début 1re prise ~2 s, obtenu ' + L.blockTime(b, 0.5));
  const second = b.map[1].at + 0.5;
  assert.ok(Math.abs(L.blockTime(b, second) - 9) < 0.6, 'début 2e prise ~9 s, obtenu ' + L.blockTime(b, second));
});

await test('un long silence (> 10 s) termine le bloc pour l’affichage en direct', () => {
  const segs = segment([[1, 'silence'], [4, 'speech'], [12, 'silence'], [4, 'speech'], [1, 'silence']]);
  assert.equal(segs.length, 2);
});

await test('une parole continue de 70 s donne des blocs de 28,5 s maximum, sans perte', () => {
  const segs = segment([[1, 'silence'], [70, 'speech'], [1, 'silence']]);
  assert.ok(segs.length >= 3, 'au moins 3 blocs, obtenu ' + segs.length);
  for (const s of segs) assert.ok(s.audio.length / 16000 <= 28.6, 'bloc trop long : ' + s.audio.length / 16000);
  const total = segs.reduce((n, s) => n + s.audio.length, 0) / 16000;
  assert.ok(total >= 69, 'aucune parole perdue (total ' + total.toFixed(1) + ' s)');
});

await test('beaucoup de phrases courtes sont regroupées en peu de blocs', () => {
  const pattern = [];
  for (let i = 0; i < 20; i++) pattern.push([3, 'speech'], [2, 'silence']);
  const segs = segment(pattern);
  assert.ok(segs.length <= 4, '20 phrases de 3 s (60 s de parole) -> au plus 4 blocs au lieu de 20, obtenu ' + segs.length);
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

await test('horodatage des phrases retrouvé à travers les silences retirés', () => {
  const t = new L.Transcript();
  const block = { start: 10, end: 40, speech: 8, map: [{ at: 0, t: 10 }, { at: 4.3, t: 30 }] };
  t.addSegment('me', block, { chunks: [{ from: 0, to: 4, text: 'Première phrase.' }, { from: 4.3, to: 8, text: 'Seconde phrase.' }] });
  assert.equal(t.lines[0].start, 10);
  assert.equal(t.lines[1].start, 30);
});

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

await test('les sigles du glossaire écrits en morceaux sont recollés', () => {
  const g = 'VPN, ROI, NIS 2, KPI, Projet Atlas';
  const f = (t) => L.fixAcronyms(t, g);
  assert.equal(f('Le MCO du VP n passe chez le prestataire.'), 'Le MCO du VPN passe chez le prestataire.');
  assert.equal(f('un calcul de R O I et de R.O.I.'), 'un calcul de ROI et de ROI.');
  assert.equal(f('les K P I du mois'), 'les KPI du mois');
  assert.equal(f('Il a vu le p a.'), 'Il a vu le p a.');
  assert.equal(f('un VPN et un ROI'), 'un VPN et un ROI');
  assert.equal(L.fixAcronyms('V P N', ''), 'V P N', 'sans glossaire, rien ne change');
});

await test('les termes du glossaire retrouvent leur orthographe exacte', () => {
  const g = 'COPIL, ServiceNow, Élodie, Claire Moreau, CAB';
  const f = (t) => L.fixCase(t, g);
  assert.equal(f("l'accord du copil et de servicenow"), "l'accord du COPIL et de ServiceNow");
  assert.equal(f('avec elodie et claire moreau.'), 'avec Élodie et Claire Moreau.');
  assert.equal(f('un cabinet, une copilote'), 'un cabinet, une copilote', 'mots entiers seulement');
  assert.equal(f('validé en cab ?'), 'validé en CAB ?');
});

await test('Markdown : en-tête, horodatage, regroupement par locuteur et pauses', () => {
  const t = new L.Transcript({ title: 'Point hebdo', glossary: 'RSSI, COMEX', startedAt: Date.UTC(2026, 9, 3, 15, 0), endedAt: Date.UTC(2026, 9, 3, 16, 0), sources: ['me', 'others'], model: 'Whisper base' });
  t.addSegment('me', seg(5, 9), { chunks: [{ from: 0, to: 2, text: 'Bonjour à tous.' }, { from: 2, to: 4, text: 'On commence ?' }] });
  t.addSegment('others', seg(3700, 3705), { chunks: [{ from: 0, to: 5, text: 'Oui, allons-y.' }] });
  t.addPause(1800, 1900);
  const md = t.toMarkdown();
  assert.match(md, /^# Transcript de réunion : Point hebdo/);
  assert.match(md, /Vocabulaire de référence.*: RSSI, COMEX/);
  assert.match(md, /\*\*\[00:00:05\] Vous :\*\* Bonjour à tous\. On commence \?/);
  assert.match(md, /\*\*\[01:01:40\] Participants :\*\* Oui, allons-y\./);
  assert.match(md, /_\[00:30:00 à 00:31:40\] Enregistrement en pause\._/);
  assert.ok(md.indexOf('00:30:00') < md.indexOf('01:01:40'), 'ordre chronologique');
  assert.ok(!md.includes('—'), 'pas de tiret cadratin');
  assert.match(t.fileName(), /^reunion_2026-10-03_\d\dh00_point-hebdo\.md$/);
});

await test('les intervenants sont numérotés par ordre d’apparition et peuvent être renommés', () => {
  const t = new L.Transcript({ sources: ['me', 'others'] });
  t.addSegment('others', seg(0, 10), { chunks: [{ from: 0, to: 4, text: 'Bonjour à tous, on commence.' }, { from: 5, to: 9, text: 'Les chiffres de la semaine sont bons.' }] }, [{ voice: 7, key: 0 }, { voice: 3, key: 1 }]);
  t.addSegment('me', seg(11, 13), { chunks: [{ from: 0, to: 2, text: "D'accord, merci." }] });
  let md = t.toMarkdown();
  assert.match(md, /\] Intervenant 1 :\*\* Bonjour/);
  assert.match(md, /\] Intervenant 2 :\*\* Les chiffres/);
  t.nameVoice(3, 'Julien');
  md = t.toMarkdown();
  assert.match(md, /\] Julien :\*\* Les chiffres/);
  assert.match(md, /nommées à la main/);
  assert.equal(t.voiceSummary().length, 2);
  t.applyVoiceMap(new Map([[1, 7]]));
  assert.equal(t.voiceSummary().length, 1, 'le regroupement final fusionne les deux voix');
});

await test('mémoire des voix : reconnaissance, prudence, effacement', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const unit = (i, noise = 0) => { const v = new Float32Array(256); v[i] = 1; v[(i + 1) % 256] = noise; const n = Math.hypot(1, noise); return v.map((x) => x / n); };
  const m = new L.VoiceMemory(storage);
  assert.equal(m.enabled, false, 'désactivée par défaut');
  m.setEnabled(true);
  m.remember('Julien', unit(1), 120);
  m.remember('Claire', unit(5), 60);
  const found = m.match(new Map([[1001, { emb: unit(5, 0.3) }], [1002, { emb: unit(1, 0.2) }], [1003, { emb: unit(9) }]]));
  assert.equal(found.get(1001), 'Claire');
  assert.equal(found.get(1002), 'Julien');
  assert.equal(found.has(1003), false, 'voix inconnue : pas de nom inventé');
  const reload = new L.VoiceMemory(storage);
  assert.equal(reload.count, 2, 'conservé sur le poste');
  reload.setKeepDays(30);
  reload.purge(Date.now() + 31 * 86400000);
  assert.equal(reload.count, 0, 'effacement automatique après la durée choisie');
  m.clear();
  assert.equal(new L.VoiceMemory(storage).count, 0);
});

await test('un passage « rapide » est remplacé par sa version précise, en gardant la voix', () => {
  const t = new L.Transcript({ sources: ['others'] });
  const b = { id: 7, start: 100, end: 110, speech: 8, map: [{ at: 0, t: 100 }] };
  t.addSegment('others', b, { chunks: [{ from: 0, to: 5, text: 'Texte approximatif.' }] }, [{ voice: 1003, key: 4 }], { block: 7, draft: true });
  t.addSegment('others', { id: 8, start: 120, end: 125, speech: 4, map: [{ at: 0, t: 120 }] }, { chunks: [{ from: 0, to: 4, text: 'Autre passage.' }] }, null, { block: 8 });
  assert.equal(t.draftCount(), 1);
  t.replaceBlock('others', b, { chunks: [{ from: 0, to: 2, text: 'Texte précis,' }, { from: 2, to: 5, text: 'en deux phrases.' }] });
  assert.equal(t.draftCount(), 0);
  assert.equal(t.lines.map((l) => l.text).join(' | '), 'Texte précis, | en deux phrases. | Autre passage.');
  assert.equal(t.lines[0].voice, 1003);
  assert.equal(t.lines[1].vkey, 4);
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
