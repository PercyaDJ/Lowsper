// Paroles simultanées : relit le détail par réplique écrit par eval-hebdo.mjs sur le corpus
// « simultane » (corpus/make-overlap.py) et compare, pour les mêmes voix, les répliques
// chevauchées aux répliques témoins (sans chevauchement).
// Mesuré : couverture (part des mots de la réplique retrouvés au bon moment), répliques perdues
// (moins de 30 % des mots), et pour la personne qui coupe la parole, si ses mots sont attribués à
// sa propre voix ou à celle de la personne coupée.
// Prérequis : node test/eval-hebdo.mjs <modèle> --corpus=simultane [--teams] [--echo]
// Usage : node test/eval-overlap.mjs [modèle] [--teams] [--echo]
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const modelId = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'whisper-small';
const tag = (process.argv.includes('--teams') ? '-teams' : '') + (process.argv.includes('--echo') ? '-echo' : '');
const { lines, hyp } = JSON.parse(
  await readFile(join(here, 'output', `simultane${tag}-${modelId}-lignes.json`), 'utf8')
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
const pct = (x) => (x * 100).toFixed(0) + ' %';
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

// Voix trouvée pour chaque personne : la voix majoritaire de ses répliques témoins
const voiceOf = {};
for (const who of new Set(lines.map((l) => l.who))) {
  const count = new Map();
  for (const l of lines.filter((x) => x.who === who && x.kind === 'temoin'))
    for (const h of hyp.filter((x) => x.source === l.channel && x.end > l.start && x.start < l.end))
      count.set(h.speaker, (count.get(h.speaker) || 0) + (Math.min(h.end, l.end) - Math.max(h.start, l.start)));
  voiceOf[who] = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

const rows = [];
const groups = [['temoin', 'premier']];
for (const k of ['acquiescement', 'interruption', 'simultane', 'long', 'vous'])
  groups.push([k, 'premier'], [k, 'second']);
for (const [kind, role] of groups) {
  const sel = lines.filter((l) => l.kind === kind && l.role === role);
  if (!sel.length) continue;
  // Attribution : les mots de la réplique, retrouvés dans une phrase de la bonne voix ?
  let own = 0;
  for (const l of sel) {
    const ref = new Set(norm(l.ref));
    const near = hyp.filter((h) => h.source === l.channel && h.end >= l.start - 1 && h.start <= l.end + 1);
    let mine = 0,
      all = 0;
    for (const h of near) {
      const n = norm(h.text).filter((w) => ref.has(w)).length;
      all += n;
      // Micro : une seule voix, la vôtre ; côté participants, la voix trouvée pour cette personne
      if (l.channel === 'me' || h.speaker === voiceOf[l.who]) mine += n;
    }
    if (all && mine / all >= 0.5) own++;
  }
  rows.push({
    type: kind,
    role,
    repliques: sel.length,
    chevauchement_moyen: kind === 'temoin' ? '' : mean(sel.map((l) => l.overlap)).toFixed(1) + ' s',
    couverture: pct(mean(sel.map((l) => l.cov))),
    perdues: sel.filter((l) => l.cov < 0.3).length,
    bonne_voix: pct(own / sel.length),
  });
}
console.log(`Corpus « simultane »${tag ? ' (son de visio)' : ''}, ${modelId}`);
console.table(rows);
console.log('Voix trouvées par personne (répliques témoins) :', voiceOf);
