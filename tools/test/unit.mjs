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
  setTimeout,
  clearTimeout,
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
};
sandbox.window = sandbox;
sandbox.self = sandbox;
// Navigateur en français : les vérifications ci-dessous portent sur l'interface française
sandbox.navigator = { language: 'fr-FR' };
vm.createContext(sandbox);
for (const f of [
  'i18n.js',
  'recommend.js',
  'meeting.js',
  'browser.js',
  'engine.js',
  'capture.js',
  'audiofile.js',
  'languages.js',
  'vocabularies.js',
  'vocabulary.js',
  'extract.js',
  'transcript.js',
  'speakers.js',
  'notes.js',
  'localai.js',
  'installer.js',
]) {
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
  const segs = segment([
    [2, 'silence'],
    [4, 'speech'],
    [3, 'silence'],
    [5, 'speech'],
    [2, 'silence'],
  ]);
  assert.equal(segs.length, 1);
  const b = segs[0];
  assert.ok(b.audio.length / 16000 < 11, 'bloc compact (< 11 s), obtenu ' + (b.audio.length / 16000).toFixed(1));
  assert.equal(b.map.length, 2);
  assert.ok(Math.abs(L.blockTime(b, 0.5) - 2) < 0.6, 'début 1re prise ~2 s, obtenu ' + L.blockTime(b, 0.5));
  const second = b.map[1].at + 0.5;
  assert.ok(Math.abs(L.blockTime(b, second) - 9) < 0.6, 'début 2e prise ~9 s, obtenu ' + L.blockTime(b, second));
});

await test('un long silence (> 10 s) termine le bloc pour l’affichage en direct', () => {
  const segs = segment([
    [1, 'silence'],
    [4, 'speech'],
    [12, 'silence'],
    [4, 'speech'],
    [1, 'silence'],
  ]);
  assert.equal(segs.length, 2);
});

await test('une parole continue de 70 s donne des blocs de 28,5 s maximum, sans perte', () => {
  const segs = segment([
    [1, 'silence'],
    [70, 'speech'],
    [1, 'silence'],
  ]);
  assert.ok(segs.length >= 3, 'au moins 3 blocs, obtenu ' + segs.length);
  for (const s of segs) assert.ok(s.audio.length / 16000 <= 28.6, 'bloc trop long : ' + s.audio.length / 16000);
  const total = segs.reduce((n, s) => n + s.audio.length, 0) / 16000;
  assert.ok(total >= 69, 'aucune parole perdue (total ' + total.toFixed(1) + ' s)');
});

await test('beaucoup de phrases courtes sont regroupées en peu de blocs', () => {
  const pattern = [];
  for (let i = 0; i < 20; i++) pattern.push([3, 'speech'], [2, 'silence']);
  const segs = segment(pattern);
  assert.ok(
    segs.length <= 4,
    '20 phrases de 3 s (60 s de parole) -> au plus 4 blocs au lieu de 20, obtenu ' + segs.length
  );
});

await test('un bruit très court (clic) est ignoré', () => {
  assert.equal(
    segment([
      [2, 'silence'],
      [0.1, 'speech'],
      [3, 'silence'],
    ]).length,
    0
  );
});

await test('la pause fait avancer le temps sans rien enregistrer', () => {
  const segs = [];
  const s = new L.Segmenter((seg) => segs.push(seg));
  s.push(signal([[5, 'speech']]), true);
  s.push(
    signal([
      [3, 'speech'],
      [2, 'silence'],
    ]),
    false
  );
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
  const block = {
    start: 10,
    end: 40,
    speech: 8,
    map: [
      { at: 0, t: 10 },
      { at: 4.3, t: 30 },
    ],
  };
  t.addSegment('me', block, {
    chunks: [
      { from: 0, to: 4, text: 'Première phrase.' },
      { from: 4.3, to: 8, text: 'Seconde phrase.' },
    ],
  });
  assert.equal(t.lines[0].start, 10);
  assert.equal(t.lines[1].start, 30);
});

await test("l'écho des participants capté par le micro est supprimé", () => {
  const t = new L.Transcript({ sources: ['me', 'others'] });
  t.addSegment('others', seg(10, 15), {
    chunks: [{ from: 0, to: 5, text: 'On valide le budget du projet pour le trimestre prochain.' }],
  });
  t.addSegment('me', seg(10.3, 15.5), {
    chunks: [{ from: 0, to: 5, text: 'On valide le budget du projet pour le trimestre.' }],
  });
  t.addSegment('me', seg(20, 23), { chunks: [{ from: 0, to: 3, text: "D'accord, je m'occupe du chiffrage." }] });
  assert.equal(t.lines.map((l) => l.source).join(','), 'others,me');
  assert.match(t.lines[1].text, /chiffrage/);
});

await test("l'écho découpé autrement que l'original (à cheval sur deux phrases) est supprimé", () => {
  const t = new L.Transcript({ sources: ['me', 'others'] });
  t.addSegment('others', seg(10, 18), {
    chunks: [
      { from: 0, to: 4, text: "J'ai relu la nouvelle procédure d'accès." },
      { from: 4, to: 8, text: 'Elle me paraît claire, il faudra juste ajouter un exemple.' },
    ],
  });
  // L'écho, transcrit en une seule phrase, avec une erreur de Whisper (« reçu »)
  t.addSegment('me', seg(10.2, 18.3), {
    chunks: [
      { from: 0, to: 8, text: "J'ai reçu la nouvelle procédure d'accès, elle me paraît claire, il faudra juste" },
    ],
  });
  // Votre vraie question, dite juste après, avec quelques mots déjà entendus : gardée
  t.addSegment('me', seg(19, 22), {
    chunks: [{ from: 0, to: 3, text: 'Tu peux envoyer la procédure à toute l’équipe avant lundi ?' }],
  });
  assert.equal(t.lines.map((l) => l.source).join(','), 'others,others,me');
  assert.match(t.lines[2].text, /avant lundi/);
});

await test('les hallucinations classiques de Whisper sont filtrées', () => {
  const t = new L.Transcript();
  t.addSegment('others', seg(0, 5, 0.5), {
    chunks: [{ from: 0, to: 5, text: "Sous-titres réalisés par la communauté d'Amara.org" }],
  });
  t.addSegment('others', seg(6, 7, 0.5), { chunks: [{ from: 0, to: 1, text: 'Merci.' }] });
  t.addSegment('others', seg(8, 12, 3), { chunks: [{ from: 0, to: 4, text: 'Merci pour la présentation.' }] });
  assert.equal(t.lines.length, 1);
});

await test('les boucles de répétition sont réduites', () => {
  const t = new L.Transcript();
  t.addSegment('me', seg(0, 10), {
    chunks: [{ from: 0, to: 10, text: 'Oui oui oui oui oui oui. On avance. On avance. On avance.' }],
  });
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
  const t = new L.Transcript({
    title: 'Point hebdo',
    glossary: 'RSSI, COMEX',
    startedAt: Date.UTC(2026, 9, 3, 15, 0),
    endedAt: Date.UTC(2026, 9, 3, 16, 0),
    sources: ['me', 'others'],
    model: 'Whisper base',
  });
  t.addSegment('me', seg(5, 9), {
    chunks: [
      { from: 0, to: 2, text: 'Bonjour à tous.' },
      { from: 2, to: 4, text: 'On commence ?' },
    ],
  });
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
  t.addSegment(
    'others',
    seg(0, 10),
    {
      chunks: [
        { from: 0, to: 4, text: 'Bonjour à tous, on commence.' },
        { from: 5, to: 9, text: 'Les chiffres de la semaine sont bons.' },
      ],
    },
    [
      { voice: 7, key: 0 },
      { voice: 3, key: 1 },
    ]
  );
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

// Réunion simulée : empreintes bruitées (comme un son de visio compressé), tours enchaînés
async function simulateMeeting(speakers, minutes, noise, expected) {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const unitv = (v) => {
    const n = Math.hypot(...v);
    return v.map((x) => x / n);
  };
  const centers = Array.from({ length: speakers }, () => unitv(Array.from({ length: 256 }, gauss)));
  const fake = {
    embed: async (a) => {
      let i1 = 0;
      while (i1 < a.length && !a[i1]) i1++;
      let i2 = a.length - 1;
      while (i2 > 0 && !a[i2]) i2--;
      const s1 = Math.round(a[i1] * 10) - 1,
        s2 = Math.round(a[i2] * 10) - 1;
      const c = centers[s1].map((x, i) => (s1 === s2 ? x : (x + centers[s2][i]) / 2));
      return Float32Array.from(unitv(c.map((x) => x + (gauss() * noise) / 16)));
    },
  };
  const tr = new L.SpeakerTracker(fake);
  if (expected) tr.expected = expected;
  let t = 0;
  while (t < minutes * 60) {
    const parts = [];
    let bd = 0;
    while (bd < 18) {
      const spk = Math.floor(rnd() * speakers);
      const d = 1 + rnd() * 10;
      parts.push({ spk, d });
      bd += d;
    }
    const audio = new Float32Array(Math.floor(bd * 16000));
    let off = 0;
    const chunks = [];
    for (const p of parts) {
      const n = Math.floor(p.d * 16000);
      audio.fill((p.spk + 1) / 10, off, off + n);
      chunks.push({ from: off / 16000, to: (off + n) / 16000 });
      off += n;
    }
    await tr.label(audio, chunks, { start: t, map: [{ at: 0, t }] });
    t += bd + 0.5;
  }
  return { tr, voices: new Set(tr.finalize().values()).size };
}

await test('intervenants : le bon nombre de voix, même sur un son dégradé (bug des 300 intervenants)', async () => {
  for (const [spk, noise] of [
    [1, 1.1],
    [2, 1.1],
    [6, 1.1],
    [6, 1.6],
  ]) {
    const { tr, voices } = await simulateMeeting(spk, 10, noise);
    assert.equal(voices, spk, `${spk} personne(s), bruit ${noise} : ${voices} voix trouvées`);
    assert.ok(tr.voices.length <= 12, 'pendant la réunion, jamais plus de 12 voix');
  }
});

await test('intervenants : le nombre de personnes indiqué est respecté', async () => {
  const { voices } = await simulateMeeting(6, 10, 1.4, 4);
  assert.equal(voices, 4);
});

await test('mémoire des voix : voix mémorisées par la 4.1.0 lues, reconnues et enrichies', () => {
  const day = 86400000;
  const now = Date.now();
  const v = (i, noise = 0) => {
    const a = new Array(256).fill(0);
    a[i] = 1;
    a[(i + 1) % 256] = noise;
    const n = Math.hypot(1, noise);
    return a.map((x) => x / n);
  };
  // Format écrit par les versions précédentes : une empreinte moyenne, pas de « prints »
  const old = JSON.stringify({
    enabled: true,
    keepDays: 90,
    voices: [{ name: 'Personne A', emb: v(1), seconds: 300, createdAt: now - 10 * day, updatedAt: now - 10 * day }],
  });
  const mem = new Map([['lowsper.voices.v1', old]]);
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, val) => mem.set(k, val) };
  const m = new L.VoiceMemory(storage);
  assert.equal(m.count, 1, 'ancienne voix lue');
  assert.equal(m.match(new Map([[1, { emb: Float32Array.from(v(1, 0.2)) }]])).get(1), 'Personne A');
  // Nouvel appareil : la voix est loin de la première empreinte, l'utilisateur la nomme
  m.remember('Personne A', Float32Array.from(v(40)), 60, now);
  const stored = JSON.parse(mem.get('lowsper.voices.v1')).voices[0];
  assert.equal(stored.prints.length, 2, "l'ancienne empreinte devient la première de la liste");
  assert.equal(stored.prints[0].at, now - 10 * day, 'sa date de création est gardée');
  assert.equal(stored.emb.length, 256, 'moyenne gardée pour les versions précédentes');
  // Comparaison à l'empreinte la plus proche : les deux appareils sont reconnus
  const both = m.match(
    new Map([
      [1, { emb: Float32Array.from(v(40, 0.1)) }],
      [2, { emb: Float32Array.from(v(9)) }],
    ])
  );
  assert.equal(both.get(1), 'Personne A');
  assert.equal(both.has(2), false);
  // Au plus 5 empreintes, la plus ancienne oubliée
  for (let k = 0; k < 6; k++) m.remember('personne a', Float32Array.from(v(100 + k)), 30, now + k);
  const p = JSON.parse(mem.get('lowsper.voices.v1')).voices[0].prints;
  assert.equal(p.length, L.SPEAKER_CFG.rememberPrints);
  assert.equal(p[0].emb[101], 1, 'les plus récentes restent');
  // Effacement par empreinte : la personne disparaît quand il ne lui en reste aucune
  const r = new L.VoiceMemory(storage);
  r.remember('Personne B', Float32Array.from(v(200)), 30, now - 100 * day);
  r.remember('Personne B', Float32Array.from(v(210)), 30, now - 5 * day);
  r.purge(now);
  assert.equal(r.names().sort().join(), 'Personne A,Personne B');
  assert.equal(JSON.parse(mem.get('lowsper.voices.v1')).voices[1].prints.length, 1, 'empreinte trop ancienne effacée');
  r.purge(now + 200 * day);
  assert.equal(r.count, 0);
});

await test('mémoire des voix : deux personnes presque aussi proches, pas de nom', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, val) => mem.set(k, val) };
  const m = new L.VoiceMemory(storage);
  const mix = (a, b) => {
    const x = new Float32Array(256);
    x[a] = 1;
    x[b] = 0.95;
    const n = Math.hypot(1, 0.95);
    return x.map((y) => y / n);
  };
  const e = (i) => {
    const x = new Float32Array(256);
    x[i] = 1;
    return x;
  };
  m.remember('Personne A', e(3), 60);
  m.remember('Personne B', e(4), 60);
  // similarité 0,72 et 0,69 : sous le seuil ; avec une voix plus nette, l'écart compte
  assert.equal(m.match(new Map([[1, { emb: mix(3, 4) }]])).size, 0);
  const close = Float32Array.from(e(3)).map((x, i) => (i === 4 ? 0.3 : x));
  const n = Math.hypot(1, 0.3);
  assert.equal(m.match(new Map([[1, { emb: close.map((x) => x / n) }]])).get(1), 'Personne A');
});

await test('mémoire des voix : reconnaissance, prudence, effacement', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const unit = (i, noise = 0) => {
    const v = new Float32Array(256);
    v[i] = 1;
    v[(i + 1) % 256] = noise;
    const n = Math.hypot(1, noise);
    return v.map((x) => x / n);
  };
  const m = new L.VoiceMemory(storage);
  assert.equal(m.enabled, false, 'désactivée par défaut');
  m.setEnabled(true);
  m.remember('Julien', unit(1), 120);
  m.remember('Claire', unit(5), 60);
  const found = m.match(
    new Map([
      [1001, { emb: unit(5, 0.3) }],
      [1002, { emb: unit(1, 0.2) }],
      [1003, { emb: unit(9) }],
    ])
  );
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
  t.addSegment('others', b, { chunks: [{ from: 0, to: 5, text: 'Texte approximatif.' }] }, [{ voice: 1003, key: 4 }], {
    block: 7,
    draft: true,
  });
  t.addSegment(
    'others',
    { id: 8, start: 120, end: 125, speech: 4, map: [{ at: 0, t: 120 }] },
    { chunks: [{ from: 0, to: 4, text: 'Autre passage.' }] },
    null,
    { block: 8 }
  );
  assert.equal(t.draftCount(), 1);
  t.replaceBlock('others', b, {
    chunks: [
      { from: 0, to: 2, text: 'Texte précis,' },
      { from: 2, to: 5, text: 'en deux phrases.' },
    ],
  });
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

// --- Cas réels relevés dans le transcript d'un entretien (one-to-one, cybersécurité) ---
await test('entretien : lettres étirées, hésitations seules et phrases répétées en boucle', () => {
  assert.equal(L.collapseRepeats('Heuuuuuuuuuuuuuuuuuuu'), 'Heu');
  assert.ok(L.isHallucination('Heu', 2), 'une hésitation seule ne mérite pas une ligne');
  assert.ok(L.isHallucination('Euh... Hum.', 2));
  assert.ok(!L.isHallucination('Euh, non plus.', 2));
  assert.equal(
    L.collapseRepeats(
      "c'est qu'il y ait aussi l'autonomie, qu'on a aussi l'autonomie, qu'on a aussi l'autonomie, qu'on a aussi l'autonomie,"
    ),
    "c'est qu'il y ait aussi l'autonomie, qu'on a aussi l'autonomie,"
  );
  assert.equal(
    L.collapseRepeats(
      'Vous aurez un second entretien, pas de repis. pas de repis, pas de vie, pas de vies, pas de balefette, pas de vrais, pas des balefettes'
    ),
    'Vous aurez un second entretien, pas de repis.'
  );
  // répétition naturelle courte : conservée
  const natural = 'alors vous êtes sorti il y a combien il y a combien de temps ?';
  assert.equal(L.collapseRepeats(natural), natural);
});

await test('correction d’un mot : pas de ReDoS, mêmes correspondances (decision.md §33)', () => {
  const V = L.Vocabulary;
  // Comportement gardé : espace = espace ou tiret, tiret du mot gardé tel quel, mot entier
  assert.equal(
    V.replaceWord('La société Mira-Bello signe.', 'mira bello', 'MIRABELLO').text,
    'La société MIRABELLO signe.'
  );
  assert.equal(V.replaceWord('Jean Pierre et Jean-Pierre', 'Jean-Pierre', 'J.-P.').text, 'Jean Pierre et J.-P.');
  assert.equal(V.replaceWord('voir a - b ici', 'a - b', 'X').text, 'voir X ici');
  assert.equal(V.replaceWord('Kalmarade', 'Kalmar', 'CALMAR').count, 0, 'mot entier seulement');
  // Saisie piégée (avant : 8 s pour 200 répétitions, puis le blocage de la page)
  const text = 'a' + ' -'.repeat(5000) + ' c';
  const t0 = Date.now();
  V.replaceWord(text, 'a' + ' -'.repeat(6) + ' b', 'X');
  L.fixCase('aaa' + ' -'.repeat(5000) + ' ccc', 'aaa' + ' -'.repeat(6) + ' bbb');
  assert.ok(Date.now() - t0 < 500, `${Date.now() - t0} ms`);
});

await test('langues parlées : l’ancien réglage est converti sans perte (rétrocompatibilité)', () => {
  const Lg = L.Languages;
  const from = (o) => Lg.read((k) => (k in o ? o[k] : null));
  // Réglages des versions 4.0 et précédentes (« lowsper.language »), y compris dans app/reglages.txt
  assert.deepEqual([...from({ 'lowsper.language': 'fr' })], ['fr']);
  assert.deepEqual([...from({ 'lowsper.language': 'en' })], ['en']);
  assert.deepEqual([...from({ 'lowsper.language': 'auto' })], ['fr', 'en']);
  assert.deepEqual([...from({})], ['fr'], 'rien de réglé : français, comme avant');
  // Le nouveau réglage l'emporte ; codes inconnus ignorés, ordre du catalogue
  assert.deepEqual([...from({ 'lowsper.language': 'fr', 'lowsper.languages': 'en,fr' })], ['fr', 'en']);
  assert.deepEqual([...from({ 'lowsper.language': 'en', 'lowsper.languages': 'xx,' })], ['en'], 'liste illisible');
  // Le moteur reçoit un code, ou la liste où reconnaître la langue de chaque passage
  assert.equal(Lg.forEngine(['fr']), 'fr');
  assert.deepEqual([...Lg.forEngine(['fr', 'en'])], ['fr', 'en']);
  assert.deepEqual([...Lg.forEngine('auto')], ['fr', 'en'], 'session interrompue d’une version 4.0');
  assert.equal(Lg.forEngine(undefined), 'fr');
  // Écriture : jamais de liste vide
  const saved = new Map();
  Lg.write((k, v) => saved.set(k, v), []);
  assert.equal(saved.size, 0);
  Lg.write((k, v) => saved.set(k, v), ['en', 'fr', 'en']);
  assert.equal(saved.get('lowsper.languages'), 'fr,en');
});

await test('langues parlées : la note garde exactement son texte pour les anciens réglages', () => {
  const lines = (language, lang) => {
    const t = new L.Transcript({
      title: 'Point',
      startedAt: Date.parse('2026-03-02T09:00:00'),
      language,
      noteLang: lang,
    });
    t.meta.endedAt = t.meta.startedAt + 600000;
    return t
      .toMarkdown()
      .split('\n')
      .find((l) => /\*\*Lang/.test(l));
  };
  assert.equal(lines('fr', 'fr'), '- **Langue** : français');
  assert.equal(lines('auto', 'fr'), '- **Langue** : français et anglais (détection automatique)');
  assert.equal(lines(['fr'], 'fr'), '- **Langue** : français');
  assert.equal(lines(['fr', 'en'], 'fr'), '- **Langue** : français et anglais (détection automatique)');
  assert.equal(lines(['en'], 'en'), '- **Language**: English');
  assert.equal(lines(['fr', 'en'], 'en'), '- **Language**: French and English (automatic detection)');
  // Défaut de la 4.0.0 : la langue n'était plus lue (« undefined ») ; le moteur transcrivait en français
  assert.equal(lines(undefined, 'fr'), '- **Langue** : français');
});

await test('vocabulaires : les trois listes d’origine sont inchangées en français, chaque liste a ses deux langues', () => {
  const V = L.Vocabulary;
  // Listes de la version 4.0, dans le même ordre (réglages et réunions déjà faits)
  assert.equal(V.PRESETS.projet.terms.split(', ')[0], 'COPIL');
  assert.equal(V.merge('', ['projet']).split(', ').length, 23);
  assert.equal(V.merge('', ['cyber']).split(', ').length, 49);
  assert.equal(V.merge('', ['it']).split(', ').length, 31);
  const ids = Object.keys(L.VOCABULARIES);
  assert.equal(ids.length, 13);
  // Domaine « IA et informatique » (decision.md §44) : jargon relevé au §39, dans les deux langues
  for (const term of ['IA', 'LLM', 'carte graphique', 'RAM']) assert.ok(V.terms('ia', 'fr').includes(term), term);
  for (const term of ['AI', 'LLM', 'graphics card', 'RAM']) assert.ok(V.terms('ia', 'en').includes(term), term);
  for (const id of ids) {
    assert.match(id, /^[a-z]+$/, 'identifiant gardé dans les réglages : court, sans accent');
    for (const lang of ['fr', 'en']) {
      const terms = V.terms(id, lang);
      assert.ok(terms.length >= 20, `${id} ${lang} : ${terms.length} termes`);
      assert.equal(new Set(terms.map((x) => x.toLowerCase())).size, terms.length, `${id} ${lang} : doublon`);
      for (const term of terms) assert.ok(term.trim() === term && term && !/[,;\n]/.test(term), `${id} : « ${term} »`);
    }
    assert.ok(L.i18n.CATALOGS.fr['vocab.' + id] && L.i18n.CATALOGS.en['vocab.' + id], 'nom dans les deux langues');
  }
  // Langue sans liste : aucun terme (pas de termes français dans une réunion en japonais)
  assert.deepEqual([...V.terms('sante', 'ja')], []);
  assert.equal(V.merge('Atlas', ['sante'], ['ja']), 'Atlas');
  // Glossaire complet : vocabulaires dans chaque langue parlée, puis glossaire personnel
  const g = V.merge('Atlas', ['projet'], ['fr', 'en']).split(', ');
  assert.ok(g.includes('COPIL') && g.includes('steering committee') && g.at(-1) === 'Atlas');
});

await test('vocabulaires : plusieurs listes alternées, chacune garde ses meilleurs termes à la fin du contexte', () => {
  const V = L.Vocabulary;
  const alt = V.alternate(['sante', 'juridique', 'finance'], 'fr', 'RGPD').split(', ');
  // Fin du contexte (gardée par le moteur) : le premier terme de chaque liste
  assert.deepEqual(alt.slice(-3), ['EBITDA', 'CNIL', 'CHU'], 'RGPD, déjà dans le glossaire personnel, est omis');
  assert.ok(!alt.includes('RGPD'));
  // Une seule liste : ses premiers termes en dernier
  assert.equal(V.alternate(['projet'], 'fr', '').split(', ').at(-1), 'COPIL');
  assert.equal(V.alternate([], 'fr', ''), '');
  // Ordre du contexte : vocabulaires, nom de la réunion, glossaire personnel ; sans vocabulaire,
  // le même qu'avant la version 4.1
  assert.equal(
    V.prompt({ vocab: 'KPI, COPIL', title: 'Point hebdo', glossary: 'Atlas' }),
    'KPI, COPIL. Point hebdo. Atlas.'
  );
  assert.equal(V.prompt({ title: 'Point hebdo', glossary: 'Atlas' }), 'Point hebdo. Atlas.');
  // Transcript : contexte dans la langue du passage
  const t = new L.Transcript({ glossary: 'Atlas', vocab: ['projet'], language: ['fr', 'en'] });
  assert.equal(t.promptVocab('fr').split(', ').at(-1), 'COPIL');
  assert.equal(t.promptVocab('en').split(', ').at(-1), 'KPI');
  assert.equal(t.promptVocab('es'), '');
});

await test('vocabulaires : expressions construites depuis les listes, saisies piégées (decision.md §33)', () => {
  // Tous les termes de toutes les listes passent par la correction de casse (fixCase)
  const all = Object.keys(L.VOCABULARIES)
    .flatMap((id) => ['fr', 'en'].flatMap((lang) => L.Vocabulary.terms(id, lang)))
    .join(', ');
  const traps = [
    'a' + ' -'.repeat(5000) + ' b',
    ' '.repeat(20000) + 'x',
    'pass' + '-the'.repeat(4000),
    'P&'.repeat(5000),
    "d'".repeat(5000) + 'avoir',
    'ISO ' + '9'.repeat(20000),
  ];
  const t0 = Date.now();
  for (const text of traps) L.fixCase(text, all);
  assert.ok(Date.now() - t0 < 2000, `${Date.now() - t0} ms pour ${traps.length} textes piégés`);
  // Les caractères spéciaux des termes sont littéraux
  assert.equal(L.fixCase('le p&l du mois', 'P&L'), 'le P&L du mois');
  assert.equal(L.fixCase('la ci/cd tourne', 'CI/CD'), 'la CI/CD tourne');
  assert.equal(L.fixCase('cixcd', 'CI.CD'), 'cixcd', 'point littéral');
});

await test('micro : quel que soit le micro, un essai simple puis les autres micros (decision.md §46)', async () => {
  const err = (name) => Object.assign(new Error(name), { name });
  const track = (fail) => ({
    applyConstraints: async () => {
      if (fail) throw err('OverconstrainedError');
    },
  });
  const stream = (fail) => ({ getAudioTracks: () => [track(fail)] });
  // Le micro par défaut refuse ses réglages, il s'ouvre sans
  let calls = [];
  let md = {
    getUserMedia: async (c) => {
      calls.push(c.audio);
      if (calls.length === 1) throw err('NotReadableError');
      return stream(true);
    },
  };
  let s = await L.getMicrophone(md);
  assert.equal(s._lowsperAttempt, 'simple');
  assert.equal(s._lowsperProcessed, false, 'réglages tentés ensuite, sans échec');
  assert.equal(calls[1], true, 'second essai sans aucun réglage');
  // Le micro par défaut est indisponible : un autre micro est essayé
  calls = [];
  md = {
    getUserMedia: async (c) => {
      calls.push(c.audio);
      if (!(c.audio.deviceId && c.audio.deviceId.exact === 'usb')) throw err('NotReadableError');
      return stream(false);
    },
    enumerateDevices: async () => [
      { kind: 'audiooutput', deviceId: 'hp' },
      { kind: 'audioinput', deviceId: 'default' },
      { kind: 'audioinput', deviceId: 'webcam' },
      { kind: 'audioinput', deviceId: 'usb' },
    ],
  };
  s = await L.getMicrophone(md);
  assert.equal(s._lowsperAttempt, 'autre micro');
  assert.equal(s._lowsperProcessed, true);
  assert.equal(calls.length, 4, 'réglages, simple, webcam, usb');
  // Un refus de l'utilisateur arrête tout, sans essayer d'autres micros
  calls = [];
  md = {
    getUserMedia: async (c) => {
      calls.push(c);
      throw err('NotAllowedError');
    },
    enumerateDevices: async () => [],
  };
  await assert.rejects(L.getMicrophone(md), { name: 'NotAllowedError' });
  assert.equal(calls.length, 1);
});

await test('son de l’ordinateur : demandé sans réglage obligatoire, essai simple après un échec (§46)', async () => {
  sandbox.MediaStream = class {
    constructor(tracks) {
      this.tracks = tracks;
    }
  };
  const asked = [];
  const audio = {
    applyConstraints: async () => {
      throw new Error('non');
    },
  };
  const md = {
    getDisplayMedia: async (c) => {
      asked.push(c);
      return { getAudioTracks: () => [audio], getVideoTracks: () => [{}], getTracks: () => [] };
    },
  };
  const s = await L.getSystemAudio(false, md);
  assert.equal(asked[0].audio, true, 'aucun réglage exigé à l’ouverture du son');
  assert.equal(asked[0].systemAudio, 'include');
  assert.equal(s._lowsperProcessed, false, 'réglage refusé sans faire échouer le partage');
  await L.getSystemAudio(true, md);
  assert.deepEqual(Object.keys(asked[1]).sort(), ['audio', 'systemAudio', 'video']);
  // Partage sans son : erreur explicite
  const none = {
    getDisplayMedia: async () => ({ getAudioTracks: () => [], getVideoTracks: () => [], getTracks: () => [] }),
  };
  await assert.rejects(L.getSystemAudio(false, none), (e) => e.code === 'NO_AUDIO');
});

await test('correction de casse : un terme en minuscules garde la majuscule d’un début de phrase', () => {
  assert.equal(L.fixCase('Planning validé. Le planning bouge.', 'planning'), 'Planning validé. Le planning bouge.');
  assert.equal(L.fixCase('copil demain', 'COPIL'), 'COPIL demain');
  assert.equal(L.fixCase('Elodie arrive', 'Élodie'), 'Élodie arrive');
});

await test('entretien : vocabulaire cybersécurité, déformations connues corrigées', () => {
  const t = new L.Transcript({ glossary: 'Ombrelune', vocab: ['cyber'] });
  const seg = { start: 0, end: 30, speech: 30 };
  const said = [
    "C'est poussé par l'NSI pour certains produits.",
    'Pourquoi supprimer le protocole NTRM ?',
    "Si vous connaissez les BIOCRM, c'est bien.",
    "Derrière ça c'est surtout Wannakrai et Eternal Blue.",
    'Et le SMBV1 ? Et Apoker ? Le passe du hash ?',
    'Je suis chez ombrelune, on parle de gmsa et de pki.',
  ];
  t.addSegment('others', seg, { chunks: said.map((text, i) => ({ from: i * 4, to: i * 4 + 3, text })) });
  const all = t.lines.map((l) => l.text).join(' ');
  for (const w of [
    "l'ANSSI",
    'NTLM',
    'EBIOS RM',
    'WannaCry',
    'EternalBlue',
    'SMBv1',
    'AppLocker',
    'pass-the-hash',
    'Ombrelune',
    'gMSA',
    'PKI',
  ]) {
    assert.ok(all.includes(w), w + ' manquant dans : ' + all);
  }
  // sans le vocabulaire coché, rien n'est réécrit
  const t2 = new L.Transcript({});
  t2.addSegment('others', seg, { chunks: [{ from: 0, to: 3, text: 'Pourquoi supprimer le protocole NTRM ?' }] });
  assert.match(t2.lines[0].text, /NTRM/);
  assert.match(t.toMarkdown(), /\*\*Domaine\*\* : cybersécurité/);
});

await test('entretien : Whisper qui récite la liste du glossaire est filtré', () => {
  const g = L.Vocabulary.merge('', ['cyber']);
  assert.ok(L.isHallucination('ANSSI, EBIOS RM, SSI, RSSI, CISO, SOC.', 3, g));
  assert.ok(!L.isHallucination('On travaille avec le SOC et le SIEM tous les jours.', 3, g));
});

await test('entretien : le contexte et le titre sont donnés à Whisper, le plus important en dernier', () => {
  const p = L.Vocabulary.prompt({ title: 'Entretien Ombrelune', glossary: 'ANSSI, PKI', context: 'la suite' });
  assert.equal(p, 'Entretien Ombrelune. ANSSI, PKI. la suite');
  const t = new L.Transcript({});
  t.addSegment(
    'others',
    { start: 0, end: 10, speech: 10 },
    { chunks: [{ from: 0, to: 4, text: 'Bonjour, je suis responsable de la sécurité.' }] }
  );
  assert.equal(t.contextFor('others', 12), 'Bonjour, je suis responsable de la sécurité.');
  assert.equal(t.contextFor('me', 12), '');
});

await test("entretien : un fragment court coincé dans le discours d'une voix reste à cette voix", () => {
  const t = new L.Transcript({});
  const mk = (from, to, text, key) => ({ chunks: [{ from, to, text }] });
  t.addSegment('others', { start: 0, end: 30, speech: 30 }, mk(0, 5, 'Donc voilà il faut passer par le jeu des'), [
    { voice: 1, key: 0 },
  ]);
  t.addSegment('others', { start: 0, end: 30, speech: 30 }, mk(5.3, 6.5, 'questions techniques'), [
    { voice: 2, key: 1 },
  ]);
  t.addSegment('others', { start: 0, end: 30, speech: 30 }, mk(6.8, 12, "pour qu'on puisse faire une évaluation."), [
    { voice: 1, key: 2 },
  ]);
  t.applyVoiceMap(new Map());
  assert.equal(new Set(t.lines.map((l) => l.voice)).size, 1);
  assert.equal(t.paragraphs().length, 1, 'une seule prise de parole');
});

await test('entretien en tête-à-tête de 40 min, son dégradé : une seule voix, y compris en direct', async () => {
  const { tr, voices } = await simulateMeeting(1, 40, 2.0);
  assert.equal(voices, 1);
  // après un regroupement en cours de réunion, les phrases suivantes prennent la voix regroupée
  const target = tr.liveMap.get(tr.voices[tr.voices.length - 1].id);
  assert.ok(target >= 1000, 'voix provisoire traduite en voix regroupée');
});

await test('réglages : restaurés depuis le dossier quand le navigateur les a effacés (sigles perdus du vendredi au lundi)', async () => {
  const mem = new Map([['lowsper.glossary', 'RSSI, COPIL (modifié dans le navigateur)']]);
  const box = {
    console,
    localStorage: {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k),
    },
    LOWSPER_SETTINGS: {
      savedAt: 1,
      data: {
        'lowsper.glossary': 'RSSI, COPIL',
        'lowsper.vocab': 'cyber',
        'lowsper.voices.v1': '{"enabled":true}',
        'lowsper.session.v1': '{"texte":"ne doit pas revenir"}',
        'autre.cle': 'x',
      },
    },
  };
  box.window = box;
  box.self = box;
  Object.defineProperty(box.localStorage, 'keys', { value: () => [...mem.keys()] });
  vm.createContext(box);
  vm.runInContext(
    'Object.keys = ((orig) => (o) => (o === localStorage ? localStorage.keys() : orig(o)))(Object.keys);',
    box
  );
  vm.runInContext(await readFile(join(appJs, 'settings.js'), 'utf8'), box, { filename: 'settings.js' });
  assert.equal(mem.get('lowsper.vocab'), 'cyber', 'réglage perdu : restauré');
  assert.equal(mem.get('lowsper.voices.v1'), '{"enabled":true}');
  assert.equal(
    mem.get('lowsper.glossary'),
    'RSSI, COPIL (modifié dans le navigateur)',
    'le navigateur garde la main sur ce qu’il a'
  );
  assert.ok(!mem.has('lowsper.session.v1'), 'la réunion en cours n’est jamais copiée ni restaurée');
  assert.ok(!mem.has('autre.cle'));
  const st = box.Lowsper.Settings.status();
  assert.deepEqual([...st.restored].sort(), ['lowsper.vocab', 'lowsper.voices.v1']);
  assert.ok(st.dirty, 'le glossaire modifié devra être recopié');
  // écriture dans un dossier factice
  const files = new Map();
  const dir = {
    queryPermission: async () => 'granted',
    getDirectoryHandle: async () => ({
      getFileHandle: async (name) => ({
        createWritable: async () => {
          let buf = '';
          return { write: async (t) => (buf += t), close: async () => files.set(name, buf) };
        },
      }),
    }),
  };
  await box.Lowsper.Settings.setFolder(dir);
  assert.equal(await box.Lowsper.Settings.save(), 'saved');
  const written = files.get('reglages.txt');
  assert.match(written, /self\.LOWSPER_SETTINGS=/);
  assert.match(written, /modifié dans le navigateur/);
  assert.ok(!/ne doit pas revenir/.test(written));
  assert.equal(await box.Lowsper.Settings.save(), 'unchanged');
});

// --- Réglages en onglets (lot R7, decision.md §30) ---
await test('réglages : export sans empreintes vocales, import d’un export ou d’une copie app/reglages.txt', async () => {
  const mem = new Map([
    ['lowsper.glossary', 'COPIL, KPI'],
    ['lowsper.fixes', '[["Kalmar","CALMAR"]]'],
    ['lowsper.voices.v1', '{"enabled":true,"voices":[{"name":"Intervenant fictif"}]}'],
    ['lowsper.speed.whisper-small', '{"load":0.4}'],
    ['lowsper.model', 'whisper-small'],
    ['lowsper.session.v1', '{"texte":"réunion en cours"}'],
    ['autre.cle', 'x'],
  ]);
  const box = {
    console,
    localStorage: {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k),
    },
    indexedDB: { open: () => ({}) },
  };
  box.window = box;
  box.self = box;
  Object.defineProperty(box.localStorage, 'keys', { value: () => [...mem.keys()] });
  vm.createContext(box);
  vm.runInContext(
    'Object.keys = ((orig) => (o) => (o === localStorage ? localStorage.keys() : orig(o)))(Object.keys);',
    box
  );
  vm.runInContext(await readFile(join(appJs, 'settings.js'), 'utf8'), box, { filename: 'settings.js' });
  const S = box.Lowsper.Settings;
  const out = S.exportData(Date.UTC(2026, 10, 6));
  assert.equal(out.lowsper, 'reglages');
  assert.equal(out.version, 1);
  assert.equal(out.exportedAt, '2026-11-06T00:00:00.000Z');
  assert.deepEqual(Object.keys(out.data).sort(), ['lowsper.fixes', 'lowsper.glossary']);
  const text = JSON.stringify(out, null, 2);
  assert.ok(
    !/voices|Intervenant fictif|réunion en cours|speed|whisper-small/.test(text),
    'rien de ce qui reste sur ce PC'
  );
  // Import d'un export : relu tel quel
  assert.deepEqual(S.parseImport(text), out.data);
  // Import d'une copie app/reglages.txt : les voix qu'elle contient sont ignorées
  const txt =
    '/* Réglages de Lowsper */\nself.LOWSPER_SETTINGS=' +
    JSON.stringify({
      savedAt: 1,
      data: {
        'lowsper.vocab': 'cyber',
        'lowsper.voices.v1': '{}',
        'lowsper.session.v1': '{}',
        'lowsper.opt.people': 6,
      },
    }) +
    ';\n';
  assert.deepEqual({ ...S.parseImport(txt) }, { 'lowsper.vocab': 'cyber' }, 'valeur non textuelle ignorée');
  // Fichier qui n'est pas un fichier de réglages
  for (const bad of ['', 'bonjour', '{"data":{"autre":"x"}}', '[1,2]', '{"data":{"lowsper.voices.v1":"{}"}}'])
    assert.throws(
      () => S.parseImport(bad),
      (e) => e.code === 'not-settings',
      JSON.stringify(bad)
    );
  // Application : remplace les valeurs du fichier, garde le reste
  assert.equal(S.importData({ 'lowsper.glossary': 'RSSI', 'lowsper.voices.v1': '{}', 'autre.cle': 'y' }), 1);
  assert.equal(mem.get('lowsper.glossary'), 'RSSI');
  assert.equal(mem.get('lowsper.fixes'), '[["Kalmar","CALMAR"]]');
  assert.match(mem.get('lowsper.voices.v1'), /Intervenant fictif/, 'voix de ce PC intactes');
  assert.equal(mem.get('autre.cle'), 'x');
});

// Faux dossier en mémoire : getDirectoryHandle, getFileHandle, createWritable
function fakeDir(name, perm = 'granted') {
  const dir = {
    name,
    perm,
    dirs: new Map(),
    files: new Map(),
    queryPermission: async () => dir.perm,
    requestPermission: async () => (dir.perm = 'granted'),
    async getDirectoryHandle(n, o) {
      if (!dir.dirs.has(n)) {
        if (!(o && o.create)) throw new Error('absent');
        dir.dirs.set(n, fakeDir(n));
      }
      return dir.dirs.get(n);
    },
    async getFileHandle(n, o) {
      if (!dir.files.has(n) && !(o && o.create)) throw new Error('absent');
      return {
        createWritable: async () => {
          let buf = '';
          return { write: async (t) => (buf += t), close: async () => dir.files.set(n, buf) };
        },
      };
    },
  };
  return dir;
}

await test('notes : sans dossier choisi, la note va dans Lowsper/Notes/<emplacement>', async () => {
  const N = L.Notes;
  const savedGet = N.lowsper.get;
  const base = fakeDir('Lowsper', 'prompt');
  N.lowsper.get = async () => base;
  const p = N.normalize({ id: 'p1', name: 'Travail : client/projet', format: 'modele' });
  assert.equal(p.subfolder, '', 'ancien profil : pas encore de sous-dossier figé');
  assert.equal(N.subfolderOf(p), 'Travail client projet', 'caractères interdits retirés');
  assert.equal(N.folderLabel(p, true), 'Lowsper › Notes › Travail client projet');
  assert.equal(N.folderLabel(p, false), 'Vos Téléchargements', 'navigateur sans accès au dossier Lowsper');
  assert.equal(N.folderLabel({ ...p, folderName: 'Coffre' }, true), 'Coffre', 'dossier choisi gardé');
  // Accord pas encore donné : un clic est nécessaire, rien n'est créé
  assert.deepEqual(
    { ...(await N.access(p, false, true)) },
    { state: 'a-demander', kind: 'lowsper', sub: 'Travail client projet' }
  );
  assert.equal(base.dirs.size, 0);
  // Simple vérification (accueil) : accordé, sans créer de dossier
  base.perm = 'granted';
  const check = await N.access(p, false, false);
  assert.equal(check.state, 'accorde');
  assert.equal(check.dir, undefined);
  assert.equal(base.dirs.size, 0, 'aucun dossier créé par une simple vérification');
  // Écriture : Notes puis le sous-dossier sont créés
  const acc = await N.access(p, false, true);
  assert.equal(acc.kind, 'lowsper');
  await N.writeNote(acc.dir, 'note.md', 'contenu');
  assert.equal(base.dirs.get('Notes').dirs.get('Travail client projet').files.get('note.md'), 'contenu');
  // Nom figé : un emplacement renommé garde son sous-dossier
  const renamed = N.normalize({ ...p, name: 'Clients', subfolder: acc.sub });
  assert.equal(N.subfolderOf(renamed), 'Travail client projet');
  assert.equal(N.folderLabel(renamed, true), 'Lowsper › Notes › Travail client projet');
  // Pas de dossier Lowsper (Firefox, accord jamais donné) : Téléchargements, comme avant
  N.lowsper.get = async () => null;
  assert.equal((await N.access(p, true, true)).state, 'aucun');
  N.lowsper.get = savedGet;
});

await test('notes : noms de dossier sûrs sous Windows', () => {
  const f = L.Notes.safeFolderName;
  assert.equal(f('  Réunions. '), 'Réunions');
  assert.equal(f('CON'), 'Emplacement', 'nom réservé par Windows');
  assert.equal(f('a\u0001b'), 'a b');
  assert.equal(f('///'), 'Emplacement');
  assert.equal(f('x'.repeat(80)).length, 60);
});

await test("micro = une seule voix : l'écho des haut-parleurs est retiré, jamais vos phrases", async () => {
  const unit = (i, j = i, w = 0) => {
    const v = new Float32Array(256);
    v[i] = 1;
    v[j] += w;
    const n = Math.hypot(...v);
    return v.map((x) => x / n);
  };
  const YOU = 3,
    OTHER = 40;
  // Analyse factice : la valeur de l'audio dit qui parle (1 = vous, 2 = l'autre)
  const fake = { embed: async (a) => (a[0] > 1.5 ? unit(OTHER, OTHER + 1, 0.2) : unit(YOU, YOU + 1, 0.2)) };
  const mic = new L.MicVoice(fake);
  const t = new L.Transcript({});
  // L'autre parle beaucoup (comme un recruteur) : 60 s côté participants
  const others = [
    [0, 20],
    [30, 50],
    [60, 80],
  ];
  for (const [a, b] of others)
    t.addSegment(
      'others',
      { start: a, end: b, speech: b - a },
      { chunks: [{ from: 0, to: b - a, text: 'Le recruteur pose une longue question technique ici.' }] }
    );
  // Micro : vos réponses (participants silencieux) et l'écho, plus fréquent que vous
  const said = [
    [21, 29, 1, 'Ma réponse détaillée numéro un.'],
    [2, 8, 2, 'Phrase entendue en écho numéro un.'],
    [33, 40, 2, 'Une autre phrase du recruteur entendue en écho.'],
    [51, 59, 1, 'Ma deuxième réponse détaillée.'],
    [62, 70, 2, 'Encore un écho différent du texte original.'],
    [75, 78, 1, 'Oui je vous coupe, pardon.'],
    // Whisper a réuni la fin de l'écho et votre réponse en une phrase : gardée (votre parole d'abord)
    [78, 84, 2, 'Fin de question et début de ma réponse.'],
  ];
  for (const [a, b, who, text] of said) {
    const audio = new Float32Array((b - a) * 16000).fill(who === 1 ? 1 : 2);
    const seg = { start: a, end: b, speech: b - a, map: [{ at: 0, t: a }] };
    const embs = await mic.embed(audio, [{ from: 0, to: b - a }], seg);
    t.addSegment('me', seg, { chunks: [{ from: 0, to: b - a, text }] }, null, { embs });
  }
  const removed = t.removeVoiceEcho(mic);
  const mine = Array.from(
    t.lines.filter((l) => l.source === 'me'),
    (l) => l.text
  );
  assert.equal(removed, 3);
  assert.deepEqual(
    mine,
    [
      'Ma réponse détaillée numéro un.',
      'Ma deuxième réponse détaillée.',
      'Oui je vous coupe, pardon.',
      'Fin de question et début de ma réponse.',
    ],
    'vous gardez la parole, même en coupant la parole'
  );
  // L'empreinte n'est jamais enregistrée
  assert.ok(!JSON.stringify(t.lines).includes('emb'));
  // Sans assez de parole « seul au micro », on ne retire rien (prudence)
  const t2 = new L.Transcript({});
  t2.addSegment('others', { start: 0, end: 10, speech: 10 }, { chunks: [{ from: 0, to: 10, text: 'Bonjour.' }] });
  assert.equal(t2.removeVoiceEcho(new L.MicVoice(fake)), 0);
});

await test('corriger un mot partout : remplacé dans le transcript et appliqué aux réunions suivantes', () => {
  const t = new L.Transcript({});
  const seg = { start: 0, end: 20, speech: 20 };
  t.addSegment('others', seg, {
    chunks: [
      { from: 0, to: 5, text: "Le dernier projet suivi, c'était Mira Bello." },
      { from: 6, to: 10, text: 'Il y a un Kalmar pour mira bello ?' },
      { from: 11, to: 15, text: 'Les mirages et le bello ne changent pas.' },
    ],
  });
  assert.equal(t.replaceEverywhere('Mira Bello', 'Mirabelle'), 2);
  assert.equal(t.lines[0].text, "Le dernier projet suivi, c'était Mirabelle.");
  assert.equal(t.lines[1].text, 'Il y a un Kalmar pour Mirabelle ?');
  assert.equal(t.lines[2].text, 'Les mirages et le bello ne changent pas.', 'mots entiers seulement');
  const sus = Array.from(t.suspectWords());
  assert.ok(sus.includes('Kalmar'), 'nom propre douteux proposé : ' + sus.join(', '));
  assert.ok(!sus.includes('Les') && !sus.includes('Il'), 'pas les débuts de phrase');
  // réunion suivante : correction apprise appliquée d'office
  const t2 = new L.Transcript({
    fixes: [
      ['Mira Bello', 'Mirabelle'],
      ['Trivelle', 'TRIVEL'],
    ],
  });
  t2.addSegment('me', seg, { chunks: [{ from: 0, to: 5, text: 'Une RAO pour Trivelle et Mira-Bello.' }] });
  assert.equal(t2.lines[0].text, 'Une RAO pour TRIVEL et Mirabelle.');
  // Corrections confirmées par l'utilisateur (saisies à l'avance dans les paramètres)
  const mine = [
    ['Kalmar', 'CALMAR'],
    ['Mira Bello', 'Mirabelle'],
    ['Trivelle', 'TRIVEL'],
    ['Ostrale', 'Austral'],
  ];
  const t3 = new L.Transcript({ fixes: mine });
  t3.addSegment('others', seg, {
    chunks: [{ from: 0, to: 5, text: 'Il y a un Kalmar pour Mira Bello, une RAO TriVelle et Ostrale.' }],
  });
  assert.equal(t3.lines[0].text, 'Il y a un CALMAR pour Mirabelle, une RAO TRIVEL et Austral.');
});

await test("regroupement des voix en direct : jamais plus d'une seconde de calcul, même après 1 h", async () => {
  const { tr } = await simulateMeeting(6, 60, 1.6);
  const t0 = performance.now();
  const m = tr.finalize({ maxSegments: 240 });
  const ms = performance.now() - t0;
  assert.ok(ms < 1000, `${ms.toFixed(0)} ms (la page serait figée et les boutons ne répondraient plus)`);
  assert.equal(new Set(m.values()).size, 6);
});

await test('couverture : la parole non transcrite est comptée et signalée, jamais perdue en silence', () => {
  const t = new L.Transcript({ sources: ['me', 'others'] });
  const a = { start: 0, end: 20, speech: 18 };
  const b = { start: 540, end: 560, speech: 15 };
  t.markQueued('others', a);
  t.markQueued('others', b);
  t.addSegment('others', a, { chunks: [{ from: 0, to: 5, text: 'On a trente minutes, ça va être rapide.' }] });
  t.markDone('others', a);
  t.markGap('others', b);
  let md = t.toMarkdown();
  assert.match(md, /\*\*Couverture\*\* : 55 % de la parole détectée transcrite ; 15 s de parole/);
  assert.match(md, /_\[00:09:00 à 00:09:20\] Passage non transcrit \(Participants\)/);
  // relance réussie à la fin : le trou disparaît
  t.addSegment('others', b, { chunks: [{ from: 0, to: 5, text: 'Et malgré tout ce travail ?' }] });
  t.markDone('others', b);
  md = t.toMarkdown();
  assert.match(md, /\*\*Couverture\*\* : toute la parole détectée a été transcrite/);
  assert.ok(!/non transcrit/.test(md));
});

await test('filet de sécurité : le son brut est gardé et la parole jamais transcrite est retrouvée', () => {
  const rec = new L.Recorder(0);
  // 30 s : parole 2-8 s (transcrite en direct), parole 12-20 s (perdue en direct), silence ailleurs
  const sr = 16000;
  const sig = new Float32Array(30 * sr);
  for (let i = 0; i < sig.length; i++) {
    const t = i / sr;
    const speaking = (t >= 2 && t < 8) || (t >= 12 && t < 20);
    sig[i] = speaking
      ? 0.3 * Math.sin(2 * Math.PI * 180 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t))
      : (Math.random() - 0.5) * 0.002;
  }
  for (let i = 0; i < sig.length; i += 4096) rec.push(sig.subarray(i, i + 4096));
  assert.ok(Math.abs(rec.end() - 30) < 0.01);
  const back = rec.read(12, 13);
  assert.equal(back.length, sr);
  assert.ok(Math.abs(back[100] - sig[12 * sr + 100]) < 1e-3, 'relecture fidèle');
  const found = Array.from(L.findUncovered(rec.read(0, 30), 0, [[2, 8]]));
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.ok(
    found[0].from >= 11.5 && found[0].from <= 12.5 && found[0].to >= 19.5 && found[0].to <= 20.5,
    JSON.stringify(found)
  );
  // tout couvert : rien à rattraper
  assert.equal(
    L.findUncovered(rec.read(0, 30), 0, [
      [2, 8],
      [12, 20],
    ]).length,
    0
  );
  // mémoire libérée après une réunion enchaînée
  rec.trim(25);
  assert.equal(
    rec.read(0, 10).some((v) => v !== 0),
    false
  );
  assert.ok(rec.read(26, 27).length === sr);
});

await test('moteur : contexte et jetons générés tiennent toujours dans la fenêtre de Whisper (448)', () => {
  const plan = L.decodePlan;
  const ids = (n) => Array.from({ length: n }, (_, i) => i + 1);
  // Cas qui faisait échouer le moteur : contexte plein (200 jetons) et bloc de 24 s
  for (const seconds of [3, 10, 18, 20, 24, 28.5, 30, 40]) {
    for (const n of [0, 20, 120, 200]) {
      const p = plan(ids(n), seconds, 0, 448);
      const prefix = (p.prompt.length ? p.prompt.length + 1 : 0) + 3;
      assert.ok(prefix + p.budget <= 448, `${seconds} s, contexte ${n} : ${prefix} + ${p.budget} > 448`);
      assert.ok(p.budget >= 1);
    }
  }
  // Rien ne change quand tout tient déjà : même contexte, même budget qu'avant le correctif
  const short = plan(ids(120), 10, 0, 448);
  assert.equal(short.prompt.length, 120);
  assert.equal(short.budget, Math.ceil(10 * 11) + 24);
  // Sinon le budget est gardé, et c'est le contexte qui raccourcit, par le début (la fin compte le plus)
  const long = plan(ids(200), 24, 0, 448);
  assert.equal(long.budget, Math.ceil(24 * 11) + 24);
  assert.equal(long.prompt.length, 448 - 4 - long.budget);
  assert.equal(long.prompt[long.prompt.length - 1], 200, 'la fin du contexte est gardée');
  // Budget imposé (test de vitesse, passages courts) : respecté, et plafonné si besoin
  assert.equal(plan(ids(200), 1, 4, 448).budget, 4);
  assert.ok(plan([], 60, 0, 448).budget <= 445);
});

// --- Import de fichiers audio : lecteurs de conteneur (sans navigateur) ---
const fixtures = join(here, 'fixtures', 'import');
const bufferSource = (buf) => ({
  size: buf.length,
  read: async (o, n) => new Uint8Array(buf.buffer, buf.byteOffset + o, Math.max(0, Math.min(n, buf.length - o))),
});
async function packetsOf(info) {
  const all = [];
  for await (const g of info.packets(0)) all.push(...g.packets);
  return all;
}

await test('import : chaque format est reconnu par son contenu, pas par son extension', async () => {
  const expected = {
    'extrait.wav': 'wav',
    'extrait.mp3': 'mp3',
    'extrait.aac': 'adts',
    'extrait.m4a': 'mp4',
    'extrait.ogg': 'ogg',
    'extrait.webm': 'webm',
    'extrait.flac': 'flac',
  };
  for (const [f, fmt] of Object.entries(expected)) {
    const head = new Uint8Array((await readFile(join(fixtures, f))).subarray(0, 64));
    assert.equal(L.AudioFile.detect(head), fmt, f);
  }
  assert.equal(L.AudioFile.detect(new Uint8Array([1, 2, 3, 4])), 'inconnu');
});

await test('import : trames et durée retrouvées dans chaque conteneur (20 s de parole)', async () => {
  const cases = {
    'extrait.mp3': { codec: 'mp3', rate: 44100 },
    'extrait.aac': { codec: 'mp4a.40.2', rate: 44100 },
    'extrait.m4a': { codec: 'mp4a.40.2', rate: 44100, description: true },
    'extrait.ogg': { codec: 'opus', rate: 48000, description: true },
    'extrait.webm': { codec: 'opus', rate: 48000, description: true },
  };
  for (const [f, c] of Object.entries(cases)) {
    const info = await L.AudioFile.open(bufferSource(await readFile(join(fixtures, f))));
    assert.equal(info.codec, c.codec, f);
    assert.equal(info.sampleRate, c.rate, f);
    assert.equal(info.channels, 2, f);
    if (c.description) assert.ok(info.description && info.description.length >= 2, f + ' : configuration du décodeur');
    const pk = await packetsOf(info);
    assert.ok(pk.length > 100, f + ' : ' + pk.length + ' trames');
    // La dernière trame commence peu avant la fin : rien n'a été sauté
    const last = pk[pk.length - 1].timestamp / 1e6;
    assert.ok(last > 19.5 && last < 20.3, `${f} : dernière trame à ${last.toFixed(2)} s`);
    for (let i = 1; i < pk.length; i++) assert.ok(pk[i].timestamp > pk[i - 1].timestamp, f + ' : ordre');
    if (info.duration != null) assert.ok(Math.abs(info.duration - 20) < 0.6, `${f} : durée ${info.duration}`);
  }
});

await test("import : date d'enregistrement lue dans le M4A, WAV lu sans décodeur", async () => {
  const m4a = await L.AudioFile.open(bufferSource(await readFile(join(fixtures, 'extrait.m4a'))));
  assert.equal(new Date(m4a.recordedAt).toISOString(), '2026-03-14T09:30:00.000Z');
  const wav = await L.AudioFile.open(bufferSource(await readFile(join(fixtures, 'extrait.wav'))));
  assert.ok(wav.pcm);
  assert.equal(wav.sampleRate, 16000);
  assert.ok(Math.abs(wav.duration - 20) < 0.01);
  // PCM 24 bits stéréo -> mono : moyenne des deux canaux
  const b = new Uint8Array([0xff, 0xff, 0x3f, 0x00, 0x00, 0xc0]); // +0,5 et -0,5
  const mono = L.AudioFile.pcmToMono(b, { channels: 2, bits: 24, float: false });
  assert.ok(Math.abs(mono[0]) < 1e-6);
});

await test('import : formats sans lecteur dédié confiés au navigateur, fichiers abîmés lus au mieux', async () => {
  const flac = await L.AudioFile.open(bufferSource(await readFile(join(fixtures, 'extrait.flac'))));
  assert.ok(flac.fallback);
  // MP3 coupé au milieu et précédé d'octets parasites : les trames intactes restent lisibles
  const mp3 = await readFile(join(fixtures, 'extrait.mp3'));
  const damaged = Buffer.concat([Buffer.from('parasite'), mp3.subarray(0, Math.floor(mp3.length / 2))]);
  damaged[0] = 0xff; // faux début de synchronisation
  const info = await L.AudioFile.open(bufferSource(damaged));
  const pk = await packetsOf(info);
  const last = pk[pk.length - 1].timestamp / 1e6;
  assert.ok(last > 9 && last < 10.5, `moitié du fichier lue (${last.toFixed(1)} s)`);
  // Durée d'un paquet Opus d'après son octet TOC : 20 ms (config 31 = CELT 20 ms)
  assert.equal(L.AudioFile.opusSamples(new Uint8Array([31 << 3])), 960);
  await assert.rejects(L.AudioFile.open(bufferSource(Buffer.from('RIFF\0\0\0\0WAVEdata\0\0\0\0'))), /incomplet/);
});

// --- Profils de sortie et notes Markdown ---
function sampleMeeting() {
  const t = new L.Transcript({
    title: 'Revue « budget » : T3',
    startedAt: new Date(2026, 9, 5, 17, 0).getTime(),
    endedAt: new Date(2026, 9, 5, 18, 1).getTime(),
    sources: ['me', 'others'],
    model: 'Whisper small',
  });
  t.addSegment('me', { start: 0, end: 30, speech: 30 }, { chunks: [{ from: 1, to: 4, text: 'Bonjour à tous.' }] });
  t.addSegment(
    'others',
    { start: 5, end: 40, speech: 30 },
    {
      chunks: [
        { from: 0, to: 4, text: 'Bonjour.' },
        { from: 10, to: 14, text: 'Le budget tient.' },
      ],
    },
    [
      { voice: 1, key: 'a' },
      { voice: 2, key: 'b' },
    ]
  );
  t.nameVoice(2, 'Claire [Finance]');
  return t;
}

await test('notes : le profil « Par défaut » garde exactement le format classique', () => {
  store.delete('lowsper.profiles');
  const t = sampleMeeting();
  const profiles = L.Notes.list();
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].format, 'classique');
  const n = L.Notes.note(t, profiles[0]);
  assert.equal(n.content, t.toMarkdown());
  assert.equal(n.name, t.fileName());
});

await test('notes : modèle à variables, variable inconnue laissée visible', () => {
  const t = sampleMeeting();
  const p = Object.assign(L.Notes.newProfile('Travail', []), {
    template: '# {{ titre }}\n{{date}} {{heure_debut}} ({{duree}})\n{{intervenants}}\n{{inconnue}}\n\n{{transcript}}',
  });
  const n = L.Notes.note(t, p);
  assert.match(n.content, /^---\n/);
  assert.match(
    n.content,
    /# Revue « budget » : T3\n2026-10-05 17:00 \(61 min\)\nVous, Intervenant 1, Claire Finance\n\{\{inconnue\}\}/
  );
  // Les crochets d'un nom saisi sont déjà retirés au renommage (nameVoice)
  assert.match(n.content, /\*\*\[00:00:15\] Claire Finance :\*\* Le budget tient\./);
  assert.deepEqual([...L.Notes.unknownVariables(p.template)], ['inconnue']);
});

await test('notes : intervenants nommés en liens [[Nom]], voix non nommées en texte', () => {
  const t = sampleMeeting();
  const p = Object.assign(L.Notes.newProfile('Notes', []), { links: true });
  const n = L.Notes.note(t, p);
  assert.match(n.content, /\*\*\[00:00:15\] \[\[Claire Finance\]\] :\*\*/);
  assert.match(n.content, /\*\*\[00:00:05\] Intervenant 1 :\*\*/, 'les voix non nommées restent du texte');
  assert.match(n.content, /intervenants:\n {2}- "Vous"\n {2}- "Intervenant 1"\n {2}- "\[\[Claire Finance\]\]"/);
});

await test('notes : noms de fichier valides sous Windows', () => {
  const s = L.Notes.safeFileName;
  assert.equal(s('Revue: budget/2026 <final>?'), 'Revue- budget-2026 final.md');
  assert.equal(s('con'), '_con.md');
  assert.equal(s('COM1.notes'), '_COM1.notes.md');
  assert.equal(s('Réunion...  '), 'Réunion.md');
  assert.equal(s('a\tb\nc'), 'a b c.md');
  assert.equal(s(''), 'reunion.md');
  assert.equal(s('note.md'), 'note.md');
  assert.ok(s('x'.repeat(300)).length <= 123);
  const t = sampleMeeting();
  const p = L.Notes.newProfile('Travail', []);
  assert.equal(L.Notes.note(t, p).name, '2026-10-05 Revue « budget » - T3.md');
});

await test('notes : front matter YAML échappé, étiquettes et champs libres', () => {
  const t = sampleMeeting();
  const p = L.Notes.newProfile('Travail', []);
  p.front = {
    enabled: true,
    fields: ['date', 'duree', 'source', 'modele'],
    tags: '#réunion, point hebdo',
    extra: 'projet: Atlas "v2"\ndate: écrasée ?\nligne sans deux-points\nlien: {{titre}}',
  };
  const fm = L.Notes.frontMatter(p.front, L.Notes.variables(t, p));
  assert.equal(
    fm,
    '---\ndate: 2026-10-05\nduree: 61\nsource: "réunion en direct"\nmodele: "Whisper small"\ntags:\n  - "réunion"\n  - "point-hebdo"\nprojet: "Atlas \\"v2\\""\nlien: "Revue « budget » : T3"\n---\n'
  );
  assert.deepEqual([...L.Notes.badExtraLines(p.front.extra)], ['ligne sans deux-points']);
  p.front.enabled = false;
  assert.ok(!L.Notes.note(t, p).content.startsWith('---'));
});

await test("notes : enregistrement importé daté du jour de l'enregistrement", () => {
  const t = new L.Transcript({
    startedAt: new Date(2026, 10, 5, 10, 0).getTime(),
    sources: ['others'],
    file: { name: 'memo.m4a', recordedAt: new Date(2026, 2, 14, 9, 30).getTime(), duration: 600 },
  });
  t.addSegment('others', { start: 0, end: 30, speech: 30 }, { chunks: [{ from: 1, to: 4, text: 'Mémo.' }] });
  const p = L.Notes.newProfile('Personnel', []);
  const v = L.Notes.variables(t, p);
  assert.equal(v.date, '2026-03-14');
  assert.equal(v.titre, 'memo');
  assert.equal(v.duree, '10 min');
  assert.equal(v.source, 'fichier « memo.m4a »');
  assert.equal(L.Notes.note(t, p).name, '2026-03-14 memo.md');
});

await test('notes : profils conservés, réglages abîmés ou anciens complétés', () => {
  store.set('lowsper.profiles', '{pas du json');
  assert.equal(L.Notes.list()[0].id, 'defaut');
  const travail = L.Notes.newProfile('Travail', L.Notes.list());
  L.Notes.saveAll([...L.Notes.list(), travail]);
  L.Notes.select(travail.id);
  assert.equal(L.Notes.current().name, 'Travail');
  // Profil écrit par une version future ou incomplète : complété sans erreur
  store.set('lowsper.profiles', JSON.stringify([{ id: 'x', name: 'Ancien', format: 'modele' }]));
  const all = L.Notes.list();
  assert.equal(all[0].id, 'defaut', 'le profil par défaut est toujours présent');
  assert.equal(all[1].template, L.Notes.DEFAULT_TEMPLATE);
  assert.ok(Array.isArray(all[1].front.fields));
  L.Notes.select('inexistant');
  assert.equal(L.Notes.current().id, 'defaut');
  store.delete('lowsper.profiles');
  store.delete('lowsper.profile');
});

// --- Consignes pour l'IA ---
// Consignes fournies réécrites en prompt système (lot R6, docs/refonte.md §7, decision.md §29)
await test('consignes : prompt système (rôle, contexte, tâche, règles, transcript), note à la fin', () => {
  store.delete('lowsper.prompts');
  const t = sampleMeeting();
  const p = L.Notes.list()[0];
  const out = L.Notes.promptText(t, p);
  assert.ok(out.startsWith('# Rôle\nTu rédiges des comptes rendus de réunion exacts et utiles.\n'));
  assert.ok(out.endsWith('\n# Transcript\n' + t.toMarkdown()), 'la note, inchangée, à la place de {{note}}');
  assert.equal(L.Notes.prompts().length, 4);
  const order = {
    fr: ['Rôle', 'Contexte', 'Tâche', 'Règles', 'Transcript'],
    en: ['Role', 'Context', 'Task', 'Rules', 'Transcript'],
  };
  for (const lang of ['fr', 'en'])
    for (const b of L.Notes.builtinPrompts(lang)) {
      const heads = b.text.split('\n').filter((l) => l.startsWith('# '));
      assert.deepEqual(
        heads,
        order[lang].map((h) => '# ' + h),
        `${lang} ${b.id} : structure`
      );
      assert.ok(b.text.endsWith('# Transcript\n{{note}}'), `${lang} ${b.id} : transcript à la fin`);
      // Mêmes règles et même contexte dans les trois consignes : seules les sections changent
      const rules = (x) => x.slice(x.indexOf('\n# ' + order[lang][3]), x.indexOf('\n# Transcript'));
      const ctx = (x) => x.slice(x.indexOf('\n- '), x.indexOf('\n# ' + order[lang][2]));
      const ref = L.Notes.builtinPrompts(lang)[0].text;
      assert.equal(ctx(b.text), ctx(ref), `${lang} ${b.id} : même contexte`);
      if (b.id === 'email-suivi') {
        // E-mail de suivi : les mêmes règles, plus celles propres à un e-mail envoyé
        const base = rules(ref).trim().split('\n').slice(0, -1).join('\n'); // sans « Sois concis »
        assert.ok(rules(b.text).trim().startsWith(base), `${lang} ${b.id} : règles communes reprises`);
      } else if (b.id !== 'actions') assert.equal(rules(b.text), rules(ref), `${lang} ${b.id} : mêmes règles`);
    }
});

await test('consignes : texte anglais du compte rendu identique à docs/refonte.md §7', async () => {
  const doc = await readFile(join(here, '..', '..', 'docs', 'refonte.md'), 'utf8');
  const spec = doc.slice(doc.indexOf('## 7.')).match(/```text\n([\s\S]*?)\n```/)[1];
  // Le document coupe les lignes longues à 100 caractères : une ligne qui ne commence ni un titre,
  // ni une liste, ni un paragraphe (après un titre ou une ligne vide) prolonge la précédente.
  const out = [];
  for (const line of spec.split('\n')) {
    const prev = out[out.length - 1];
    const starts = !line.trim() || /^(#|- |\d+\. |\{\{)/.test(line.trim());
    if (out.length && !starts && prev && !prev.startsWith('#')) out[out.length - 1] = prev + ' ' + line.trim();
    else out.push(line);
  }
  const joined = out.join('\n');
  assert.equal(L.i18n.t('prompt.compte-rendu.text', null, 'en'), joined);
});

await test('consignes : un ancien texte fourni non modifié passe au prompt système, un texte modifié jamais', () => {
  for (const id of L.Notes.BUILTIN_IDS)
    for (const old of L.Notes.LEGACY_PROMPTS[id]) {
      store.set('lowsper.prompts', JSON.stringify([{ id, name: 'x', text: old }]));
      const p = L.Notes.prompts().find((x) => x.id === id);
      assert.equal(p.modified, false, id + ' : ancien texte reconnu comme non modifié');
      assert.equal(p.text, L.i18n.t('prompt.' + id + '.text', null, 'fr'));
    }
  // L'ancien texte du compte rendu, tel que le vérifiait ce test avant le lot R6
  assert.equal(
    L.Notes.LEGACY_PROMPTS['compte-rendu'][0],
    "Voici le transcript automatique d'une réunion (il peut contenir des erreurs de reconnaissance). " +
      'Rédige un compte rendu structuré en français : contexte et participants identifiables, ' +
      'points abordés, décisions prises, actions à mener (qui, quoi, échéance), questions ouvertes. ' +
      "N'invente rien : si un passage est incompréhensible ou ambigu, signale-le."
  );
  // Ancien texte retouché d'un seul caractère : modifié, donc gardé tel quel
  const edited = L.Notes.LEGACY_PROMPTS.actions[0] + ' Merci.';
  store.set('lowsper.prompts', JSON.stringify([{ id: 'actions', name: 'x', text: edited }]));
  const a = L.Notes.prompts().find((x) => x.id === 'actions');
  assert.ok(a.modified);
  assert.equal(a.text, edited);
  store.delete('lowsper.prompts');
});

await test('consignes : modifiables, rétablissables, personnelles, variables et place de la note', () => {
  store.delete('lowsper.prompts');
  const t = sampleMeeting();
  const p = L.Notes.newProfile('Travail', []);
  L.Notes.savePrompt('actions', { text: 'Actions de « {{titre}} » :\n{{note}}\nFin.' });
  const list = L.Notes.prompts();
  assert.ok(list.find((x) => x.id === 'actions').modified);
  const out = L.Notes.promptText(t, p, 'actions');
  assert.ok(out.startsWith('Actions de « Revue « budget » : T3 » :\n---\n'), 'variable rendue, note à sa place');
  assert.ok(out.endsWith('Le budget tient.\n\nFin.'));
  assert.ok(!out.includes('{{'), 'aucune variable de la note réinterprétée');
  L.Notes.removePrompt('actions');
  assert.ok(!L.Notes.prompts().find((x) => x.id === 'actions').modified, 'texte d’origine rétabli');
  const id = L.Notes.newPrompt('Pour le client');
  L.Notes.savePrompt(id, { text: 'Résume pour un client : {{transcript}}' });
  const own = L.Notes.promptText(t, Object.assign(p, { prompt: id }));
  assert.match(own, /^Résume pour un client : \*\*\[00:00:01\] Vous :\*\* Bonjour à tous\./);
  assert.ok(!own.includes('---\n\n'), '{{transcript}} présent : la note n’est pas ajoutée en plus');
  L.Notes.removePrompt(id);
  assert.equal(L.Notes.prompts().length, 4);
  // Consigne disparue : repli sur la première
  assert.ok(
    L.Notes.promptText(t, Object.assign(p, { prompt: id })).startsWith('# Rôle\nTu rédiges des comptes rendus')
  );
  store.set('lowsper.prompts', 'abîmé');
  assert.equal(L.Notes.prompts().length, 4);
  store.delete('lowsper.prompts');
});

await test('IA intégrée : exemple fictif identique au corpus, faits et rapport', async () => {
  const A = L.LocalAI;
  const truth = JSON.parse(await readFile(join(here, 'corpus', 'hebdo.truth.json'), 'utf8'));
  assert.deepEqual(
    [...A.SAMPLE].map((x) => [...x]),
    truth.map((l) => [l.start, l.channel === 'me' ? 'Vous' : l.who, l.ref])
  );
  const tr = A.sampleTranscript();
  assert.match(tr, /^\*\*\[00:00:02\] Claire :\*\* Bonjour/);
  // Critères des faits : un compte rendu complet les retrouve tous ; un texte vide, aucun
  const full =
    '1 240 tickets. SLA P2 à 87 %. Certificat VPN expiré.\nKarim régularise en CAB.\n' +
    'Thomas et Élodie migrent mardi.\nMarc envoie le chiffrage.\nCOPIL jeudi.\nSophie relance le prestataire.';
  assert.equal(A.checkFacts(full).found.length, A.FACTS.length);
  assert.equal(A.checkFacts('').found.length, 0);
  const r = A.report({
    probe: [{ id: 'summarizer', name: 'Résumé', state: 'available', detail: '' }],
    trials: {
      summarizer: {
        text: 'Karim passe en CAB.',
        createMs: 1500,
        runMs: 2500,
        facts: A.checkFacts('Karim passe en CAB.'),
      },
    },
    userAgent: 'UA',
    protocol: 'file:',
    secure: true,
  });
  assert.match(r, /Résumé : available/);
  assert.match(r, /Faits retrouvés : 1\/8/);
  assert.match(r, /Préparation : 1\.5 s ; rédaction : 2\.5 s/);
});

await test('IA intégrée : sonde (absente, états, erreur, délai) et essai', async () => {
  const A = L.LocalAI;
  assert.deepEqual(
    [...(await A.probe({}))].map((s) => s.state),
    ['absent', 'absent']
  );
  const seen = [];
  const scope = {
    Summarizer: {
      availability: async (o) => (seen.push(o), 'downloadable'),
      create: async (o) => {
        o.monitor({ addEventListener: (n, f) => f({ loaded: 0.5 }) });
        return {
          summarize: async (t) => 'Sophie relance le prestataire. ' + t.length,
          destroy() {
            this.done = true;
          },
        };
      },
    },
    LanguageModel: {
      availability: async () => {
        throw new TypeError('bloqué');
      },
    },
  };
  const st = await A.probe(scope);
  assert.equal(st[0].state, 'downloadable');
  assert.deepEqual([...seen[0].expectedInputLanguages], ['fr']);
  assert.equal(seen[0].outputLanguage, 'fr');
  assert.equal(st[1].state, 'error');
  assert.match(st[1].detail, /TypeError : bloqué/);
  assert.equal(A.usable('downloadable') && A.usable('available') && !A.usable('unavailable'), true);
  const slow = await A.probe({ Summarizer: { availability: () => new Promise(() => {}) } }, 20);
  assert.equal(slow[0].state, 'timeout');
  const progress = [];
  const t = await A.trial('summarizer', { scope, onProgress: (f) => progress.push(f) });
  assert.deepEqual(progress, [0.5]);
  assert.match(t.text, /^Sophie relance le prestataire/);
  assert.deepEqual([...t.facts.found], ['Sophie relance le prestataire (renfort)']);
  // Prompt API : consigne système, consigne et transcript dans le message
  let sys, msg;
  const lm = {
    LanguageModel: {
      create: async (o) => ((sys = o.initialPrompts[0].content), { prompt: async (m) => ((msg = m), 'ok') }),
    },
  };
  await A.trial('prompt', { scope: lm });
  assert.equal(sys, A.SYSTEM);
  assert.ok(msg.startsWith(A.CONSIGNE + '\n\n---\n\n**[00:00:02] Claire'));
});

await test('navigateur : Brave, Edge, Chrome, Firefox reconnus ; message adapté', async () => {
  const B = L.Browser;
  const chromeUA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';
  // Brave envoie la même identification que Chrome
  assert.equal(B.name({ userAgent: chromeUA, brave: {} }), 'Brave');
  assert.equal(B.name({ userAgent: chromeUA }), 'Chromium');
  assert.equal(
    B.name({ userAgent: chromeUA, userAgentData: { brands: [{ brand: 'Google Chrome' }] } }),
    'Google Chrome'
  );
  assert.equal(B.name({ userAgent: chromeUA + ' Edg/157.0.0.0' }), 'Microsoft Edge');
  assert.equal(
    B.name({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; rv:140.0) Gecko/20100101 Firefox/140.0' }),
    'Firefox'
  );
  assert.equal(B.name({}), 'inconnu');
  assert.match(
    B.folderMessage('model', { userAgent: chromeUA, brave: {} }),
    /brave:\/\/flags.*File System Access.*Microsoft Edge/
  );
  assert.match(B.folderMessage('notes', { userAgent: chromeUA, brave: {} }), /brave:\/\/flags.*Téléchargements/);
  assert.match(B.folderMessage('model', { userAgent: 'Firefox/140.0' }), /micro seul/);
  assert.match(B.folderMessage('model', { userAgent: 'x' }), /Microsoft Edge ou Google Chrome/);
  assert.equal(B.canWriteFolder({ showDirectoryPicker() {} }), true);
  assert.equal(B.canWriteFolder({}), false);
  // Rapport de la sonde : le navigateur détecté est écrit en plus de l'identification
  const r = L.LocalAI.report({ probe: [], browser: 'Brave', userAgent: chromeUA, protocol: 'file:', secure: true });
  assert.match(r, /Navigateur détecté : Brave\nIdentification : Mozilla/);
});

await test('notes : dossier impossible dans ce navigateur, message clair', async () => {
  const saved = sandbox.showDirectoryPicker;
  delete sandbox.showDirectoryPicker;
  sandbox.navigator = { userAgent: 'Chrome/157.0', brave: {} };
  await assert.rejects(
    L.Notes.pickFolder('defaut'),
    (e) => e.code === 'unsupported' && /brave:\/\/flags/.test(e.message)
  );
  delete sandbox.navigator;
  if (saved) sandbox.showDirectoryPicker = saved;
});

// --- Langue de l'interface (decision.md §25) ---
await test('langue : celle du navigateur, fr* en français, tout le reste en anglais', () => {
  const I = L.i18n;
  assert.equal(I.detect({ language: 'fr-FR' }), 'fr');
  assert.equal(I.detect({ language: 'fr-CA' }), 'fr');
  assert.equal(I.detect({ language: 'fr' }), 'fr');
  assert.equal(I.detect({ language: 'en-US' }), 'en');
  assert.equal(I.detect({ language: 'de-DE' }), 'en');
  assert.equal(I.detect({ language: 'frr' }), 'en', 'frison du Nord : pas du français');
  assert.equal(I.detect(undefined), 'en');
  assert.equal(I.lang(), 'fr');
  assert.equal(I.locale('fr'), 'fr-FR');
  // Variables {nom} remplacées ; variables de modèle {{date}} laissées telles quelles
  assert.equal(I.t('prof.example', { name: 'x.md' }), 'Exemple : x.md');
  assert.match(I.t('prof.fileName'), /\{\{date\}\} \{\{titre\}\}/);
  assert.equal(I.t('clé.inconnue'), 'clé.inconnue', 'clé absente : visible');
});

await test('langue : chaque clé utilisée dans le code et la page existe dans les deux catalogues', async () => {
  const { readdir } = await import('node:fs/promises');
  const used = new Set();
  for (const f of await readdir(appJs)) {
    if (!f.endsWith('.js') || f === 'i18n.js') continue;
    const code = await readFile(join(appJs, f), 'utf8');
    // Préfixes de clés composées (« 'var.' + nom ») : vérifiés plus bas, famille par famille
    for (const m of code.matchAll(/\b(?:tr|tx|tl|L\.t|Lowsper\.t)\(\s*'([\w.-]+)'/g))
      if (!m[1].endsWith('.')) used.add(m[1]);
    for (const m of code.matchAll(/setEngine\('\w+', '([\w.-]+)'/g)) used.add(m[1]);
  }
  const html = await readFile(join(appJs, '..', '..', 'Lowsper.html'), 'utf8');
  for (const m of html.matchAll(/data-i18n(?:-html)?="([\w.-]+)"/g)) used.add(m[1]);
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g))
    for (const pair of m[1].split(';')) used.add(pair.split(':')[1]);
  // Clés composées dans le code
  for (const s of ['waiting', 'cancelled', 'running', 'done', 'failed']) used.add('import.status.' + s);
  for (const [name] of L.Notes.VARIABLES) used.add('var.' + name);
  for (const [key] of L.Notes.FRONT_FIELDS) used.add('front.' + key);
  for (const id of L.Notes.BUILTIN_IDS) used.add(`prompt.${id}.name`).add(`prompt.${id}.text`);
  for (const s of L.LocalAI.STATES) used.add('lai.state.' + s);
  for (const a of L.LocalAI.APIS) used.add('lai.api.' + a.id);
  for (const id of Object.keys(L.Vocabulary.PRESETS)) used.add('vocab.' + id);
  for (const l of ['fr', 'en', 'auto']) used.add('note.langs.' + l).add('note.varLangs.' + l);
  used.add('note.langs.many').add('note.varLangs.many');
  for (const l of L.Languages.CODES) used.add('lang.' + l).add('lang.native.' + l);
  for (const area of ['notes', 'model'])
    for (const b of ['brave', 'firefox', 'other']) used.add(`browser.${area}.${b}`);
  assert.ok(used.size > 400, `${used.size} clés trouvées seulement`);
  const { fr, en } = L.i18n.CATALOGS;
  assert.deepEqual(
    [...used].filter((k) => !(k in fr) || !(k in en)),
    []
  );
  assert.deepEqual([...L.i18n.missing()], []);
});

async function manifestCatalog() {
  const box = {};
  box.self = box;
  vm.createContext(box);
  vm.runInContext(await readFile(join(appJs, '..', 'manifest.js'), 'utf8'), box);
  return box.LOWSPER_MANIFEST.catalog;
}

await test('langue : chaque modèle du manifeste a un nom et un texte court dans les deux langues', async () => {
  const catalog = await manifestCatalog();
  assert.ok(catalog.length >= 3);
  for (const m of catalog)
    for (const lang of ['fr', 'en'])
      for (const k of ['model.label.' + m.id, 'model.short.' + m.id])
        assert.notEqual(L.i18n.t(k, null, lang), k, `${k} (${lang})`);
  // Le nom français est celui du manifeste (index des modèles installés, notes)
  for (const m of catalog) assert.equal(L.i18n.t('model.label.' + m.id, null, 'fr'), m.label);
});

// --- Réunion : contrôle d'état (decision.md §28) ---
await test('réunion : contrôle d’état, seuils réglés sur les corpus', async () => {
  const M = L.Meeting;
  const base = {
    me: 'on',
    others: 'on',
    othersWanted: true,
    othersSilentMs: 0,
    paused: false,
    engineReady: true,
    engineError: null,
    delayS: 0,
  };
  const c = (patch) => M.checks({ ...base, ...patch });
  // Tout va bien
  let r = c({});
  assert.deepEqual([r.me.state, r.others.state, r.text.state], ['ok', 'ok', 'ok']);
  assert.deepEqual([r.me.key, r.others.key, r.text.key], ['meet.micOk', 'meet.soundOk', 'meet.textOk']);
  // Seuil du son de la réunion : au-dessus du plus long silence naturel mesuré sur les corpus
  const corpus = [];
  for (const name of ['hebdo', 'entretien']) {
    const truth = JSON.parse(
      await readFile(join(appJs, '..', '..', 'tools', 'test', 'corpus', name + '.truth.json'), 'utf8')
    );
    const end = Math.max(...truth.map((x) => x.end));
    for (const ch of ['me', 'others']) {
      let prev = 0;
      let gap = 0;
      for (const x of truth.filter((t) => t.channel === ch).sort((a, b) => a.start - b.start)) {
        gap = Math.max(gap, x.start - prev);
        prev = Math.max(prev, x.end);
      }
      corpus.push({ name, ch, gap: Math.max(gap, end - prev) });
    }
  }
  const othersMax = Math.max(...corpus.filter((x) => x.ch === 'others').map((x) => x.gap));
  assert.ok(othersMax < 10 && M.OTHERS_SILENT_MS / 1000 > othersMax * 5, `silence des participants : ${othersMax} s`);
  assert.equal(c({ othersSilentMs: othersMax * 1000 }).others.state, 'ok', 'silence naturel : pas d’alerte');
  r = c({ othersSilentMs: M.OTHERS_SILENT_MS + 1 });
  assert.deepEqual([r.others.state, r.others.key, r.others.fix], ['warn', 'meet.soundSilent', true]);
  // Micro : jamais d'alerte de silence (on écoute souvent longtemps : 80 s dans « hebdo »)
  const meMax = Math.max(...corpus.filter((x) => x.ch === 'me').map((x) => x.gap));
  assert.ok(meMax > 60, `silence du micro : ${meMax} s`);
  // Sources non captées
  r = c({ me: 'off', others: 'off' });
  assert.deepEqual([r.me.state, r.others.state, r.others.key, r.others.fix], ['warn', 'warn', 'meet.soundNone', true]);
  r = c({ others: 'off', othersWanted: false });
  assert.deepEqual([r.others.state, r.others.key, r.others.fix], ['idle', 'meet.soundOff', false]);
  // Pause : rien à signaler, même après un long silence
  r = c({ paused: true, othersSilentMs: 600000 });
  assert.deepEqual([r.me.state, r.others.state], ['idle', 'idle']);
  // Texte : à jour sous le seuil, retard en secondes au-delà, moteur en préparation
  assert.equal(c({ delayS: M.TEXT_LATE_S - 1 }).text.state, 'ok');
  r = c({ delayS: 47.4 });
  assert.deepEqual([r.text.state, r.text.key, r.text.vars.s], ['warn', 'meet.textLate', 47]);
  assert.equal(c({ engineReady: false }).text.key, 'meet.textPreparing');
  assert.equal(c({ engineReady: false, engineError: 'x', delayS: 0 }).text.key, 'meet.textOk');
});

// --- Premier lancement : recommandation du modèle (decision.md §26) ---
await test('recommandation : moteurs autorisés, formule inchangée (decision.md §15.12)', () => {
  const R = L.Recommend;
  // Ancienne formule de app.js (3.5.0), recopiée telle quelle pour la comparaison
  const old = (threads, memory, power, device) => {
    if (device === 'webgpu') return { start: 1, normal: 1, boost: 1, max: 1 };
    threads = threads || 4;
    memory = memory || 8;
    const memCap = memory < 4 ? 1 : memory < 8 ? 2 : 6;
    const clamp = (n) => Math.max(1, Math.min(memCap, n));
    if (power === 'eco') return { start: 1, normal: 1, boost: 1, max: 1 };
    if (power === 'max') {
      const n = clamp(Math.floor(threads / 2));
      return { start: Math.min(n, 3), normal: n, boost: n, max: n };
    }
    const normal = clamp(Math.ceil(threads / 4));
    const boost = clamp(Math.max(normal, Math.floor(threads / 3)));
    return { start: normal, normal, boost, max: boost };
  };
  for (const threads of [undefined, 1, 2, 4, 6, 8, 12, 16, 24, 32])
    for (const memory of [undefined, 1, 2, 4, 8, 16])
      for (const power of ['eco', 'balanced', 'max'])
        for (const device of ['wasm', 'webgpu'])
          assert.deepEqual({ ...R.limits(threads, memory, power, device) }, old(threads, memory, power, device));
  // Exemple de decision.md §15.12 : Ryzen 5, 12 fils, puissance équilibrée
  assert.deepEqual({ ...R.limits(12, 8, 'balanced', 'wasm') }, { start: 3, normal: 3, boost: 4, max: 4 });
});

await test('recommandation : modèle recommandé, modèles grisés avec leur raison', async () => {
  const R = L.Recommend;
  const catalog = await manifestCatalog();
  const pick = (hw, installed) => R.choose(catalog, { threads: null, memory: null, gpu: null, ...hw }, installed);
  // Sans carte graphique : les modèles « carte graphique » sont grisés, raison donnée
  let r = pick({ threads: 8, memory: 8 });
  for (const o of r.options) {
    const gpuModel = catalog.find((m) => m.id === o.id).device === 'webgpu';
    assert.equal(o.usable, !gpuModel, o.id);
    assert.equal(o.reason, gpuModel ? 'gpu' : null, o.id);
  }
  // 8 fils : 2 moteurs en puissance équilibrée, small suit le direct
  assert.equal(r.recommended, 'whisper-small');
  assert.equal(r.workers, 2);
  // 4 fils : 1 moteur, small ne suit pas une parole continue (charge mesurée 1,44)
  assert.equal(pick({ threads: 4, memory: 8 }).recommended, 'whisper-base');
  // Peu de mémoire : 1 moteur au plus, comme pendant les réunions
  assert.equal(pick({ threads: 16, memory: 2 }).recommended, 'whisper-base');
  // Navigateur muet (aucune information) : 4 fils supposés, comme pendant les réunions
  assert.equal(pick({}).recommended, 'whisper-base');
  // Carte graphique présente : modèles utilisables, mais jamais recommandés (vitesse non mesurée)
  r = pick({ threads: 16, memory: 8, gpu: { vendor: 'x' } });
  assert.ok(r.options.every((o) => o.usable));
  assert.equal(r.recommended, 'whisper-small');
  // Déjà installés : marqués comme tels
  r = pick({ threads: 8, memory: 8 }, ['whisper-small', 'whisper-base']);
  assert.ok(r.options.find((o) => o.id === 'whisper-small').installed);
  // Catalogue réduit : repli sur ce qui existe
  assert.equal(R.choose([{ id: 'whisper-small', device: 'wasm' }], { threads: 4 }).recommended, 'whisper-small');
  assert.equal(R.choose([], { threads: 4 }).recommended, null);
});

await test('note en anglais : en-tête, libellés et nom de fichier traduits', () => {
  L.i18n.setLang('en');
  try {
    const t = new L.Transcript({
      title: 'Budget review',
      startedAt: new Date(2026, 9, 5, 17, 0).getTime(),
      endedAt: new Date(2026, 9, 5, 18, 1).getTime(),
      sources: ['me', 'others'],
      language: 'auto',
      people: 3,
    });
    assert.equal(t.meta.noteLang, 'en', 'langue de l’interface au début de la réunion');
    t.addSegment('me', seg(1, 4), { chunks: [{ from: 0, to: 3, text: 'Hello everyone.' }] });
    t.addSegment('others', seg(5, 12), { chunks: [{ from: 0, to: 4, text: 'Hi, shall we start?' }] }, [
      { voice: 4, key: 0 },
    ]);
    t.addPause(30, 60);
    const md = t.toMarkdown();
    assert.match(md, /^# Meeting transcript: Budget review\n/);
    assert.match(md, /- \*\*Time\*\*: .+ to .+ \(61 min\)/);
    assert.match(md, /- \*\*Participants\*\*: 3 people \(including you\)/);
    assert.match(md, /- \*\*Language\*\*: French and English \(automatic detection\)/);
    assert.match(md, /\*\*\[00:00:01\] You:\*\* Hello everyone\./);
    assert.match(md, /\*\*\[00:00:05\] Speaker 1:\*\* Hi, shall we start\?/);
    assert.match(md, /_\[00:00:30 to 00:01:00\] Recording paused\._/);
    assert.ok(!/Intervenant|Vous|Enregistrement|réunion/.test(md), 'aucun libellé français');
    assert.match(t.fileName(), /^meeting_2026-10-05_17h00_budget-review\.md$/);
    // Profil avec modèle : variables et clés du front matter inchangées, valeurs en anglais
    const p = L.Notes.newProfile('Work', []);
    const n = L.Notes.note(t, p);
    assert.match(n.content, /^---\ndate: 2026-10-05\nduree: 61\nintervenants:\n {2}- "You"\n {2}- "Speaker 1"\n/);
    assert.match(n.content, /source: "live meeting"/);
    assert.equal(L.Notes.safeFileName('', 'en'), 'meeting.md');
    // Une réunion commencée en français reste en français, même si l'interface passe en anglais
    const fr = new L.Transcript({ noteLang: 'fr', sources: ['me'] });
    fr.addSegment('me', seg(1, 3), { chunks: [{ from: 0, to: 2, text: 'Bonjour.' }] });
    assert.match(fr.toMarkdown(), /^# Transcript de réunion\n[\s\S]*\] Vous :\*\* Bonjour\./);
  } finally {
    L.i18n.setLang('fr');
    store.delete('lowsper.opt.lang');
  }
});

await test('consignes : fournies dans la langue de l’interface, consigne modifiée jamais changée', () => {
  store.delete('lowsper.prompts');
  L.i18n.setLang('en');
  try {
    let list = L.Notes.prompts();
    assert.deepEqual(
      [...list.map((p) => p.name)],
      ['Meeting minutes', 'Call summary', 'Action items', 'Follow-up email']
    );
    assert.match(list[0].text, /^# Role\nYou write accurate, useful meeting minutes\./);
    // Texte d'origine français enregistré (version précédente) : non modifié, il suit la langue
    L.Notes.savePrompt('compte-rendu', { text: L.i18n.t('prompt.compte-rendu.text', null, 'fr') });
    list = L.Notes.prompts();
    assert.equal(list[0].modified, false);
    assert.match(list[0].text, /^# Role\n/);
    // Consigne modifiée par l'utilisateur : gardée telle quelle dans les deux langues
    L.Notes.savePrompt('actions', { text: 'Mes actions à moi.' });
    assert.equal(L.Notes.prompts().find((p) => p.id === 'actions').text, 'Mes actions à moi.');
    L.i18n.setLang('fr');
    const fr = L.Notes.prompts();
    assert.equal(fr.find((p) => p.id === 'actions').text, 'Mes actions à moi.');
    assert.ok(fr.find((p) => p.id === 'actions').modified);
    assert.match(fr[0].text, /^# Rôle\nTu rédiges/);
    assert.equal(fr[0].name, 'Compte rendu de réunion');
  } finally {
    L.i18n.setLang('fr');
    store.delete('lowsper.opt.lang');
    store.delete('lowsper.prompts');
  }
});

await test('langue : profil par défaut, navigateur et sonde traduits, noms donnés gardés', () => {
  store.delete('lowsper.profiles');
  L.i18n.setLang('en');
  try {
    assert.equal(L.Notes.list()[0].name, 'Default');
    L.Notes.saveAll(L.Notes.list()); // le nom traduit enregistré ne gêne pas le retour au français
    L.Notes.saveAll([Object.assign(L.Notes.newProfile('Travail', []), { id: 'w' }), ...L.Notes.list()]);
    assert.equal(L.Notes.list().find((p) => p.id === 'w').name, 'Travail', 'nom donné par l’utilisateur');
    assert.match(L.Browser.folderMessage('notes', { userAgent: 'Firefox/140.0' }), /^Firefox cannot write/);
    assert.equal(L.LocalAI.stateText('available'), 'available');
    assert.match(L.LocalAI.stateText('bizarre'), /unexpected answer from the browser \(“bizarre”\)/);
    assert.equal(L.Vocabulary.label('cyber'), 'Cybersecurity');
    L.i18n.setLang('fr');
    assert.equal(L.Notes.list().find((p) => p.id === 'defaut').name, 'Par défaut');
    assert.equal(L.Vocabulary.label('cyber'), 'Cybersécurité');
  } finally {
    L.i18n.setLang('fr');
    store.delete('lowsper.opt.lang');
    store.delete('lowsper.profiles');
  }
});

await test('thème : suit le système, choix clair ou sombre gardé, retour à automatique', async () => {
  const code = await readFile(join(appJs, 'theme.js'), 'utf8');
  const make = (dark) => {
    const st = new Map();
    const box = {
      localStorage: {
        getItem: (k) => (st.has(k) ? st.get(k) : null),
        setItem: (k, v) => st.set(k, String(v)),
        removeItem: (k) => st.delete(k),
      },
      matchMedia: () => ({ matches: dark }),
      document: { documentElement: { dataset: {} } },
    };
    box.window = box;
    vm.createContext(box);
    vm.runInContext(code, box);
    return { T: box.Lowsper.Theme, el: box.document.documentElement, st };
  };
  // Système sombre, aucun choix : sombre, sans attribut (la feuille de style suit le système)
  let { T, el, st } = make(true);
  assert.equal(T.stored(), 'auto');
  assert.equal(T.effective(), 'dark');
  assert.equal(el.dataset.theme, undefined);
  // Bascule : clair imposé et mémorisé
  assert.equal(T.toggle(), 'light');
  assert.equal(el.dataset.theme, 'light');
  assert.equal(st.get(T.KEY), 'light');
  // Nouvelle bascule : retour au thème du système, donc « automatique »
  assert.equal(T.toggle(), 'dark');
  assert.equal(el.dataset.theme, undefined);
  assert.equal(st.has(T.KEY), false);
  // Système clair, choix sombre retrouvé au lancement
  ({ T, el, st } = make(false));
  T.set('dark');
  assert.equal(el.dataset.theme, 'dark');
  T.set('n importe quoi');
  assert.equal(T.stored(), 'auto');
  assert.equal(T.effective(), 'light');
});

// --- Dossier Lowsper : recherche depuis un dossier parent, accès d'une autre copie (decision.md §38) ---
/** Arborescence factice : { 'Lowsper.html': '', sous: { ... } } ; seen compte les dossiers lus. */
function tree(name, content, seen = { n: 0 }) {
  const dir = {
    kind: 'directory',
    name,
    seen,
    getFileHandle: async (f) => {
      if (typeof content[f] !== 'string') throw new Error('NotFoundError');
      return { kind: 'file', name: f };
    },
    async *values() {
      seen.n++;
      for (const [k, v] of Object.entries(content))
        yield typeof v === 'string' ? { kind: 'file', name: k } : tree(k, v, seen);
    },
  };
  return dir;
}

await test('dossier Lowsper : trouvé depuis le dossier lui-même, un dossier parent ou Téléchargements', async () => {
  const lowsper = { 'Lowsper.html': '', app: {} };
  const find = (dir, page) => L.findLowsperFolders(dir, page).then((r) => Array.from(r, (d) => d.name));
  // Le bon dossier choisi directement
  assert.deepEqual(await find(tree('Lowsper-4.2.0', lowsper), 'Lowsper-4.2.0'), ['Lowsper-4.2.0']);
  // « Extraire tout » de Windows : Lowsper-4.2.0\Lowsper-4.2.0, le premier choisi
  assert.deepEqual(await find(tree('Lowsper-4.2.0', { 'Lowsper-4.2.0': lowsper }), 'Lowsper-4.2.0'), ['Lowsper-4.2.0']);
  // Téléchargements choisi tel quel : deux niveaux plus bas, à travers un dossier « lowsper »
  const downloads = tree('Downloads', {
    'facture.pdf': '',
    Photos: { 'a.jpg': '' },
    'Lowsper-3.4.0': { 'Lowsper-3.4.0': lowsper },
    'Lowsper-4.2.0': { 'Lowsper-4.2.0': lowsper },
  });
  assert.deepEqual(
    await find(downloads, 'Lowsper-4.2.0'),
    ['Lowsper-4.2.0', 'Lowsper-3.4.0'],
    'le nom de la page d’abord'
  );
  // Copie renommée par l'utilisateur : trouvée au premier niveau, quel que soit son nom
  assert.deepEqual(await find(tree('Bureau', { Transcription: lowsper }), 'Transcription'), ['Transcription']);
  // Rien : liste vide (message « mauvais dossier »), sans descendre dans les dossiers sans rapport
  const docs = tree('Documents', { Projets: { Lowsper: lowsper }, 'notes.txt': '' });
  assert.deepEqual(await find(docs, 'Lowsper-4.2.0'), []);
  assert.equal(docs.seen.n, 1, 'Projets n’est pas parcouru : seul un dossier « lowsper » l’est');
  // Parcours borné : un très grand dossier ne bloque pas la page
  const big = {};
  for (let i = 0; i < 2000; i++) big['dossier' + i] = {};
  big['zz-Lowsper'] = lowsper;
  assert.equal((await L.findLowsperFolders(tree('Gros', big), 'zz-Lowsper', 400)).length, 0);
});

await test('dossier Lowsper : l’accès rangé par une autre copie est oublié sans rien demander', async () => {
  const mem = new Map();
  const kv = new Map();
  // IndexedDB factice, suffisant pour settings.js (get, put, delete dans le magasin « kv »)
  const indexedDB = {
    open: () => {
      const req = {};
      setTimeout(() => {
        req.result = {
          transaction: () => {
            const tx = {};
            const store = {
              get: (k) => {
                const r = { result: kv.get(k) };
                return r;
              },
              put: (v, k) => (kv.set(k, v), {}),
              delete: (k) => (kv.delete(k), {}),
            };
            tx.objectStore = () => store;
            setTimeout(() => tx.oncomplete && tx.oncomplete());
            return tx;
          },
        };
        req.onsuccess();
      });
      return req;
    },
  };
  const make = async (path) => {
    const box = {
      console,
      setTimeout,
      location: { pathname: path },
      indexedDB,
      localStorage: {
        getItem: (k) => (mem.has(k) ? mem.get(k) : null),
        setItem: (k, v) => mem.set(k, String(v)),
        removeItem: (k) => mem.delete(k),
      },
    };
    box.window = box;
    box.self = box;
    Object.defineProperty(box.localStorage, 'keys', { value: () => [...mem.keys()] });
    vm.createContext(box);
    vm.runInContext(
      'Object.keys = ((orig) => (o) => (o === localStorage ? localStorage.keys() : orig(o)))(Object.keys);',
      box
    );
    vm.runInContext(await readFile(join(appJs, 'settings.js'), 'utf8'), box, { filename: 'settings.js' });
    return box;
  };
  let asked = 0;
  const handle = (name) => ({
    name,
    queryPermission: async () => 'prompt',
    requestPermission: async () => (asked++, 'granted'),
  });
  // La 3.4.0 avait rangé son dossier ; la 4.2.0 est ouverte depuis un autre dossier
  kv.set('folder', handle('Lowsper-3.4.0'));
  let box = await make('/C:/Users/u/Downloads/Lowsper-4.2.0/Lowsper-4.2.0/Lowsper.html');
  assert.equal(await box.Lowsper.Settings.folder(), null, 'accès d’une autre copie ignoré');
  assert.equal(kv.has('folder'), false, 'et oublié');
  mem.set('lowsper.glossary', 'COPIL');
  assert.equal(await box.Lowsper.Settings.save({ interactive: false, force: true }), 'needs-folder');
  assert.equal(asked, 0, 'aucune fenêtre d’autorisation pour l’ancien dossier');
  // Le dossier de cette page, rangé à l'installation : gardé (casse indifférente, comme Windows)
  kv.set('folder', handle('lowsper-4.2.0'));
  box = await make('/C:/Users/u/Downloads/Lowsper-4.2.0/Lowsper-4.2.0/Lowsper.html');
  assert.equal((await box.Lowsper.Settings.folder()).name, 'lowsper-4.2.0');
  // Même nom, mais autre copie (vérification après l'accord) : oublié, rien n'est écrit
  box.Lowsper.isPageFolder = async () => false;
  assert.equal(await box.Lowsper.Settings.save({ interactive: true, force: true }), 'needs-folder');
  assert.equal(kv.has('folder'), false);
});

await test('notes : le dossier Lowsper d’une autre copie n’est jamais utilisé', async () => {
  const N = L.Notes;
  const saved = { ...N.lowsper };
  const base = fakeDir('Lowsper', 'granted');
  N.lowsper.get = async () => base;
  N.lowsper.confirm = async () => false;
  const p = N.normalize({ id: 'p2', name: 'Travail', format: 'modele' });
  assert.equal((await N.access(p, true, true)).state, 'aucun', 'Téléchargements, comme sans dossier');
  assert.equal(base.dirs.size, 0, 'rien n’est créé dans l’autre copie');
  Object.assign(N.lowsper, saved);
});

// ---------------------------------------------------------------------------
// Compte rendu extractif (extract.js, decision.md §40)
// ---------------------------------------------------------------------------
await test('compte rendu : phrases recopiées telles quelles, rangées par catégorie', () => {
  const X = L.Extract;
  const items = [
    {
      start: 10,
      speaker: 'Lucie',
      text: "Bonjour à tous. Alors c'est décidé, la mise en ligne est fixée au quinze décembre.",
    },
    { start: 20, speaker: 'Hugo', text: "Je termine l'écran de paiement d'ici vendredi." },
    { start: 30, speaker: 'Vous', text: 'Qui valide la revue du code de paiement avant la mise en ligne ?' },
    { start: 34, speaker: 'Lucie', text: "Bonne question, je n'ai pas la réponse." },
    { start: 40, speaker: 'Maya', text: "Then let's drop the advanced filters from this release." },
    { start: 50, speaker: 'Priya', text: "I'll start on the export on Monday." },
  ];
  const found = JSON.parse(JSON.stringify(X.extract(items)));
  assert.deepEqual(
    found.map((f) => [f.kind, f.speaker, f.start]),
    [
      ['decision', 'Lucie', 10],
      ['action', 'Hugo', 20],
      ['question', 'Vous', 30],
      ['decision', 'Maya', 40],
      ['action', 'Priya', 50],
    ]
  );
  // Mot pour mot : chaque phrase est une sous-chaîne exacte de sa réplique
  for (const f of found)
    assert.ok(
      items.some((it) => it.start === f.start && it.text.includes(f.text)),
      f.text
    );
  assert.equal(found[0].text, "Alors c'est décidé, la mise en ligne est fixée au quinze décembre.");
});

await test('compte rendu : hypothèses, rappels du passé et propositions écartés', () => {
  const c = L.Extract.classify;
  assert.equal(c("L'an dernier, on avait décidé de tout sortir en même temps."), null);
  assert.equal(c('Si on avait plus de monde, on pourrait la lancer en parallèle.'), null);
  assert.equal(c("Je propose qu'on décale la mise en ligne au quinze décembre."), null);
  assert.equal(c('Last year we decided to keep the old format for two versions.'), null);
  assert.equal(c('We could also hire a contractor, if we had the budget.'), null);
  assert.equal(c("Je pense qu'on peut les corriger cette semaine."), null);
  assert.equal(c('Bonjour à tous, est-ce que tout le monde m’entend bien ?'), null);
  assert.equal(c('Moi je peux m’occuper de la pêche à la ligne, comme l’an dernier.'), 'action');
});

await test('compte rendu : une question qui reçoit une réponse n’est pas retenue', () => {
  const found = L.Extract.extract([
    { start: 0, speaker: 'Vous', text: 'Est-ce que les tests sur les vieux téléphones ont été faits ?' },
    { start: 4, speaker: 'Inès', text: 'Oui, sur quatre modèles, et tout passe.' },
    { start: 10, speaker: 'Gaël', text: 'Et qui s’occupe des clés de la salle pendant les vacances ?' },
    { start: 14, speaker: 'Odile', text: 'Il y a aussi le sujet des nouveaux maillots.' },
    { start: 20, speaker: 'You', text: 'Do we know how many volunteers we will need? Nobody has counted yet.' },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(found.map((f) => [f.kind, f.text]))), [
    ['question', 'Et qui s’occupe des clés de la salle pendant les vacances ?'],
    ['question', 'Do we know how many volunteers we will need?'],
  ]);
});

await test('compte rendu : section de la note avant le transcript, désactivable, en anglais', () => {
  const make = (meta) => {
    const t = new L.Transcript(
      Object.assign(
        {
          title: 'Projet',
          sources: ['me', 'others'],
          startedAt: Date.UTC(2026, 10, 7, 9),
          endedAt: Date.UTC(2026, 10, 7, 10),
        },
        meta
      )
    );
    t.addSegment('others', seg(65, 70), {
      chunks: [{ from: 0, to: 5, text: 'Bon, on garde le tarif actuel pour cette saison.' }],
    });
    t.addSegment('me', seg(80, 84), {
      chunks: [{ from: 0, to: 4, text: 'Je relance le sponsor par écrit cette semaine.' }],
    });
    return t;
  };
  const md = make({}).toMarkdown();
  assert.ok(
    md.indexOf('## Compte rendu') > md.indexOf('exécuté localement') &&
      md.indexOf('## Compte rendu') < md.indexOf('## Transcript')
  );
  assert.match(
    md,
    /### Décisions\n\n- \*\*\[00:01:05\] Participants :\*\* « Bon, on garde le tarif actuel pour cette saison\. »/
  );
  assert.match(md, /### Actions\n\n- \*\*\[00:01:20\] Vous :\*\* « Je relance le sponsor par écrit cette semaine\. »/);
  assert.ok(!md.includes('### Questions ouvertes'), 'catégorie vide omise');
  assert.ok(!make({ highlights: false }).toMarkdown().includes('Compte rendu'), 'réglage désactivé');
  const en = make({ noteLang: 'en' }).toMarkdown();
  assert.match(en, /## Summary[\s\S]*### Decisions\n\n- \*\*\[00:01:05\] Participants:\*\* "Bon, on garde/);
  // Rien de repéré : une ligne le dit
  const empty = new L.Transcript({ sources: ['me'] });
  empty.addSegment('me', seg(0, 3), { chunks: [{ from: 0, to: 3, text: 'Les chiffres de la semaine sont bons.' }] });
  assert.match(
    empty.toMarkdown(),
    /## Compte rendu[\s\S]*_Aucune décision, action ni question ouverte repérée\._[\s\S]*## Transcript/
  );
  // Modèle de note : variable {{compte_rendu}}, retirée proprement si le réglage est désactivé
  const prof = L.Notes.newProfile('Essai', []);
  assert.match(L.Notes.note(make({}), prof).content, /\n## Compte rendu\n[\s\S]*\n## Transcript\n/);
  assert.doesNotMatch(L.Notes.note(make({ highlights: false }), prof).content, /Compte rendu|\n\n\n/);
});

// --- Notes rapides et e-mail de suivi (lot C2) ---
const plain = (x) => JSON.parse(JSON.stringify(x));
function meetingWithNotes(meta) {
  const t = new L.Transcript(
    Object.assign(
      {
        title: 'Point équipe',
        startedAt: new Date(2026, 10, 9, 10, 0).getTime(),
        endedAt: new Date(2026, 10, 9, 10, 30).getTime(),
        sources: ['me'],
        highlights: false,
      },
      meta || {}
    )
  );
  t.addSegment('me', { start: 0, end: 30, speech: 30 }, { chunks: [{ from: 1, to: 4, text: 'Bonjour à tous.' }] });
  return t;
}

await test('notes rapides : rangées par heure, une ligne, vides ignorées, retirables', () => {
  const t = meetingWithNotes();
  assert.equal(t.addNote(12, '   '), null, 'note vide ignorée');
  const b = t.addNote(125.7, '  Relancer   le\nfournisseur  ');
  t.addNote(65, 'Budget : 12 400 €');
  assert.deepEqual(
    plain(t.meta.notes).map((n) => [n.t, n.text]),
    [
      [65, 'Budget : 12 400 €'],
      [125.7, 'Relancer le fournisseur'],
    ]
  );
  const long = t.addNote(200, 'x'.repeat(800));
  assert.equal(long.text.length, L.NOTE_MAX);
  t.removeNote(long);
  t.removeNote({ t: 65, text: 'Budget : 12 400 €' }); // autre objet de même contenu : rien n'est retiré
  assert.equal(t.meta.notes.length, 2);
  t.removeNote(b);
  assert.deepEqual(plain(t.quickNotes()), [{ t: 65, text: 'Budget : 12 400 €' }]);
  // Notes abîmées (fichier de secours d'une autre version) : ignorées sans erreur
  t.meta.notes = [null, { t: 'x', text: 'A' }, { t: 3 }, { t: 2, text: ' B ' }];
  assert.deepEqual(plain(t.quickNotes()), [
    { t: 0, text: 'A' },
    { t: 2, text: 'B' },
  ]);
});

await test('notes rapides : section « Vos notes » avant le transcript, après le compte rendu', () => {
  const plain = meetingWithNotes();
  const before = plain.toMarkdown();
  assert.ok(!before.includes('Vos notes'), 'sans note rapide, la note ne change pas');
  const t = meetingWithNotes({ highlights: true });
  t.addNote(65, 'Budget : 12 400 €');
  t.addNote(3725, 'Prochaine revue : {t} **mardi**');
  const md = t.toMarkdown();
  assert.match(
    md,
    /\n## Vos notes\n\n_Notes tapées pendant la réunion, recopiées telles quelles, avec l’heure où vous avez commencé à les écrire\._\n\n- \*\*\[00:01:05\]\*\* Budget : 12 400 €\n- \*\*\[01:02:05\]\*\* Prochaine revue : \{t\} \*\*mardi\*\*\n\n## Transcript\n/
  );
  assert.ok(md.indexOf('## Compte rendu') < md.indexOf('## Vos notes'), 'après le compte rendu');
  // Sans note rapide, le format classique reste identique au caractère près
  assert.equal(before, meetingWithNotes().toMarkdown());
  const en = meetingWithNotes({ noteLang: 'en' });
  en.addNote(5, 'Check the figures');
  assert.match(
    en.toMarkdown(),
    /\n## Your notes\n\n_Notes typed during the meeting[^\n]*\n\n- \*\*\[00:00:05\]\*\* Check the figures\n/
  );
});

await test('notes rapides : sauvegarde de secours et récupération', () => {
  const t = meetingWithNotes({ endedAt: null });
  L.Transcript.current = t;
  t.addNote(42, 'À garder');
  const back = L.Transcript.loadUnfinished();
  assert.deepEqual(plain(back.quickNotes()), [{ t: 42, text: 'À garder' }]);
  assert.match(back.toMarkdown(), /- \*\*\[00:00:42\]\*\* À garder/);
  L.Transcript.clearSaved();
  L.Transcript.current = null;
});

await test('notes rapides : modèles de note ({{notes}}, anciens modèles par défaut, modèle modifié)', () => {
  const t = meetingWithNotes();
  t.addNote(65, 'Budget validé');
  const prof = L.Notes.newProfile('Essai', []);
  // Modèle par défaut : {{notes}} juste avant le transcript
  const c = L.Notes.note(t, prof).content;
  assert.match(c, /\n## Vos notes\n[\s\S]*Budget validé\n\n## Transcript\n/);
  // Sans note rapide : variable retirée proprement
  assert.doesNotMatch(L.Notes.note(meetingWithNotes(), prof).content, /Vos notes|\n\n\n/);
  // Anciens modèles par défaut, jamais modifiés : reçoivent les notes avant le transcript
  for (const old of [
    '# {{titre}}\n\n{{en_tete}}\n\n{{compte_rendu}}\n\n## Transcript\n\n{{transcript}}\n',
    '# {{titre}}\n\n{{en_tete}}\n\n## Transcript\n\n{{transcript}}\n',
  ]) {
    const out = L.Notes.note(t, Object.assign({}, prof, { template: old })).content;
    assert.ok(out.indexOf('## Vos notes') > 0 && out.indexOf('## Vos notes') < out.indexOf('## Transcript'), old);
  }
  // Le modèle d'avant le lot C1 ne gagne pas de compte rendu
  const pre = L.Notes.note(
    meetingWithNotes({ highlights: true }),
    Object.assign({}, prof, {
      template: '# {{titre}}\n\n{{en_tete}}\n\n## Transcript\n\n{{transcript}}\n',
    })
  ).content;
  assert.ok(!pre.includes('Compte rendu'));
  // Modèle modifié sans {{notes}} : notes ajoutées à la fin, jamais perdues
  const own = L.Notes.note(t, Object.assign({}, prof, { template: '{{titre}}\n\n{{transcript}}' })).content;
  assert.ok(own.endsWith('- **[00:01:05]** Budget validé\n'), own);
  // {{transcript_complet}} contient déjà les notes : pas de doublon
  const full = L.Notes.note(t, Object.assign({}, prof, { template: '{{transcript_complet}}' })).content;
  assert.equal(full.split('Budget validé').length, 2);
  assert.equal(L.Notes.unknownVariables('{{notes}}').length, 0);
});

await test('e-mail de suivi : consigne fournie en français et en anglais, avec vos notes', () => {
  store.delete('lowsper.prompts');
  const t = meetingWithNotes();
  t.addNote(65, 'Envoyer le devis');
  const prof = Object.assign(L.Notes.newProfile('Essai', []), { prompt: 'email-suivi' });
  const out = L.Notes.promptText(t, prof);
  assert.ok(out.startsWith('# Rôle\nTu rédiges des e-mails de suivi de réunion exacts, clairs et courts.\n'));
  assert.match(out, /« Vos notes »/);
  assert.ok(
    out.endsWith('Envoyer le devis\n\n## Transcript\n\n**[00:00:01] Vous :** Bonjour à tous.\n'),
    out.slice(-200)
  );
  const en = L.Notes.builtinPrompts('en').find((p) => p.id === 'email-suivi');
  assert.equal(en.name, 'Follow-up email');
  assert.match(en.text, /« Your notes »/);
  assert.equal(L.i18n.t('note.notesTitle', null, 'en'), '## Your notes');
  // Les mots qui désignent la section dans la consigne sont ceux de la note
  assert.ok(
    L.Notes.builtinPrompts('fr')
      .find((p) => p.id === 'email-suivi')
      .text.includes('« ' + L.i18n.t('note.notesTitle', null, 'fr').slice(3) + ' »')
  );
  assert.ok(en.text.includes('« ' + L.i18n.t('note.notesTitle', null, 'en').slice(3) + ' »'));
});

if (failed) {
  console.log(`\n${failed} test(s) en échec`);
  process.exit(1);
}
console.log('\nTous les tests unitaires passent.');
