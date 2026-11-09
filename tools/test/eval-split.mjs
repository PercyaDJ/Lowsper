// Mesure des coupures d'une même personne en deux intervenants (decision.md §57).
// Lit les phrases produites par eval-hebdo.mjs (test/output/<corpus><variante>-<modèle>-lignes.json)
// et la vérité du corpus, sans navigateur, en quelques secondes. Pour chaque réplique réelle d'un
// participant, regarde les phrases transcrites qui la composent :
//   - réplique coupée : ses phrases ont reçu au moins deux intervenants différents ;
//   - changement en cours de réplique : deux phrases consécutives de la même réplique, intervenants
//     différents (c'est ce que l'utilisateur voit : une personne coupée au milieu de ce qu'elle dit).
// Usage : node test/eval-split.mjs [modèle] [fichier-lignes...]  (défaut : tous les fichiers de test/output)
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'output');
const args = process.argv.slice(2);
const model = args.find((a) => a.startsWith('whisper')) || 'whisper-small';
let files = args.filter((a) => a.endsWith('.json'));
if (!files.length)
  files = (await readdir(out)).filter((f) => f.endsWith(`-${model}-lignes.json`)).map((f) => join(out, f));

/** Analyse pure, exportée pour les tests : truth et hyp comme dans les fichiers. */
export function splits(truth, hyp) {
  const turns = truth.filter((t) => t.channel === 'others');
  const lines = hyp.filter((l) => l.source === 'others' && l.speaker);
  let multi = 0;
  let cut = 0;
  let changes = 0;
  let pairs = 0;
  const examples = [];
  for (const t of turns) {
    const own = lines
      .filter((l) => {
        const mid = (l.start + l.end) / 2;
        return mid >= t.start - 0.3 && mid <= t.end + 0.3;
      })
      .sort((a, b) => a.start - b.start);
    if (own.length < 2) continue;
    multi++;
    pairs += own.length - 1;
    let c = 0;
    for (let i = 1; i < own.length; i++) if (own[i].speaker !== own[i - 1].speaker) c++;
    changes += c;
    if (new Set(own.map((l) => l.speaker)).size > 1) {
      cut++;
      examples.push({ who: t.who, at: t.start, labels: own.map((l) => l.speaker) });
    }
  }
  const voices = new Set(lines.map((l) => l.speaker)).size;
  const real = new Set(turns.map((t) => t.who)).size;
  return { turns: turns.length, multi, cut, changes, pairs, voices, real, examples };
}

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(0) + ' %' : '-');
if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = [];
  for (const f of files) {
    const base = f.split('/').pop().replace(`-${model}-lignes.json`, '');
    const corpus = base.split('-')[0];
    const truth = JSON.parse(await readFile(join(here, 'corpus', `${corpus}.truth.json`), 'utf8'));
    const { hyp } = JSON.parse(await readFile(f, 'utf8'));
    const r = splits(truth, hyp);
    rows.push({
      corpus: base,
      'voix (réelles)': `${r.voices} (${r.real})`,
      'répliques en plusieurs phrases': `${r.multi} / ${r.turns}`,
      'répliques coupées': `${r.cut} (${pct(r.cut, r.multi)})`,
      'changements en cours de réplique': `${r.changes} / ${r.pairs} (${pct(r.changes, r.pairs)})`,
    });
    for (const e of r.examples) console.log(`  ${base} : ${e.who} à ${e.at.toFixed(1)} s -> ${e.labels.join(' | ')}`);
  }
  console.table(rows);
}
