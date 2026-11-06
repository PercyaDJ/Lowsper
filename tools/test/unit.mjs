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
  'browser.js',
  'engine.js',
  'capture.js',
  'audiofile.js',
  'vocabulary.js',
  'transcript.js',
  'speakers.js',
  'notes.js',
  'localai.js',
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
await test('consignes : « Compte rendu de réunion » identique à l’ancien bouton « Copier pour une IA »', () => {
  store.delete('lowsper.prompts');
  const t = sampleMeeting();
  const p = L.Notes.list()[0];
  const before =
    "Voici le transcript automatique d'une réunion (il peut contenir des erreurs de reconnaissance). " +
    'Rédige un compte rendu structuré en français : contexte et participants identifiables, ' +
    'points abordés, décisions prises, actions à mener (qui, quoi, échéance), questions ouvertes. ' +
    "N'invente rien : si un passage est incompréhensible ou ambigu, signale-le.\n\n---\n\n";
  assert.equal(L.Notes.promptText(t, p), before + t.toMarkdown());
  assert.equal(L.Notes.prompts().length, 3);
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
  assert.equal(L.Notes.prompts().length, 3);
  // Consigne disparue : repli sur la première
  assert.ok(
    L.Notes.promptText(t, Object.assign(p, { prompt: id })).startsWith("Voici le transcript automatique d'une réunion")
  );
  store.set('lowsper.prompts', 'abîmé');
  assert.equal(L.Notes.prompts().length, 3);
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

await test('langue : descriptions des modèles, en français identiques au manifeste, traduites', async () => {
  const box = {};
  box.self = box;
  vm.createContext(box);
  vm.runInContext(await readFile(join(appJs, '..', 'manifest.js'), 'utf8'), box);
  const catalog = box.LOWSPER_MANIFEST.catalog;
  assert.ok(catalog.length >= 3);
  for (const m of catalog) {
    assert.equal(L.i18n.t('model.desc.' + m.id, null, 'fr'), m.description, m.id);
    assert.notEqual(L.i18n.t('model.desc.' + m.id, null, 'en'), 'model.desc.' + m.id, m.id);
  }
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
    assert.deepEqual([...list.map((p) => p.name)], ['Meeting minutes', 'Call summary', 'Action items']);
    assert.match(list[0].text, /^Here is the automatic transcript of a meeting/);
    // Texte d'origine français enregistré (version précédente) : non modifié, il suit la langue
    L.Notes.savePrompt('compte-rendu', { text: L.i18n.t('prompt.compte-rendu.text', null, 'fr') });
    list = L.Notes.prompts();
    assert.equal(list[0].modified, false);
    assert.match(list[0].text, /^Here is the automatic transcript/);
    // Consigne modifiée par l'utilisateur : gardée telle quelle dans les deux langues
    L.Notes.savePrompt('actions', { text: 'Mes actions à moi.' });
    assert.equal(L.Notes.prompts().find((p) => p.id === 'actions').text, 'Mes actions à moi.');
    L.i18n.setLang('fr');
    const fr = L.Notes.prompts();
    assert.equal(fr.find((p) => p.id === 'actions').text, 'Mes actions à moi.');
    assert.ok(fr.find((p) => p.id === 'actions').modified);
    assert.match(fr[0].text, /^Voici le transcript automatique d'une réunion/);
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

if (failed) {
  console.log(`\n${failed} test(s) en échec`);
  process.exit(1);
}
console.log('\nTous les tests unitaires passent.');
