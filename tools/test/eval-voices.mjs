// Banc de la mémoire des voix (lot R9, decision.md §37), sans navigateur.
//
// Rejoue, sur les empreintes calculées par embed-voices.mjs, la vie d'une mémoire des voix :
// 8 équipes de 6 habituées, 6 réunions chacune (les équipes alternent), plus des personnes de
// passage. À la première réunion, l'utilisateur nomme chaque habituée. Ensuite, à chaque réunion :
//   1. la mémoire propose des noms (association une à une, comme l'application) ;
//   2. on compte : bon nom, mauvais nom (confusion), aucun nom, nom donné à une personne de passage ;
//   3. l'utilisateur corrige : une habituée sans nom ou mal nommée est renommée, ce qui enrichit la
//      mémoire (comme app.js : on retient l'empreinte quand l'utilisateur saisit un nom).
// Une personne bien reconnue ne change rien à la mémoire (l'utilisateur ne renomme rien).
//
// Le corpus est coupé en deux moitiés indépendantes (équipes 1 à 4, 5 à 8, chacune avec sa propre
// mémoire) : le seuil est choisi sur la première (« réglage ») et vérifié sur la seconde
// (« contrôle »), pour ne pas sur-ajuster.
//
// Usage : node test/eval-voices.mjs [--sweep] [--json]
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const cache = join(here, '..', '.cache', 'voices');
const corpus = JSON.parse(await readFile(join(cache, 'voices.json'), 'utf8'));
const embs = JSON.parse(await readFile(join(cache, 'embeddings.json'), 'utf8'));

// Le vrai code de l'application, chargé tel quel
const sandbox = { window: {}, console };
sandbox.self = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(await readFile(join(here, '..', '..', 'app', 'js', 'speakers.js'), 'utf8'), sandbox);
const L = sandbox.window.Lowsper;
const memStore = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

const sessions = corpus.sessions.filter((s) => embs[s.id]);
const missing = corpus.sessions.length - sessions.length;
const byTeamMeeting = new Map();
for (const s of sessions) {
  const k = s.team + ':' + s.meeting;
  if (!byTeamMeeting.has(k)) byTeamMeeting.set(k, []);
  byTeamMeeting.get(k).push(s);
}

/**
 * Rejoue les réunions des équipes données avec une mémoire neuve.
 * make() : fabrique la mémoire ; elle expose remember(name, emb, seconds) et match(centroids).
 */
function simulate(teams, make, opts = {}) {
  const memory = make();
  const r = {
    ok: 0,
    wrong: 0,
    none: 0,
    known: 0,
    oneoffNamed: 0,
    oneoff: 0,
    newDevice: { ok: 0, n: 0 },
    sameDevice: { ok: 0, n: 0 },
  };
  const devicesSeen = new Map(); // personne -> appareils déjà retenus en mémoire
  for (let m = 1; m <= 6; m++) {
    for (const team of teams) {
      const list = byTeamMeeting.get(team + ':' + m) || [];
      const centroids = new Map();
      list.forEach((s, i) =>
        centroids.set(i + 1, { emb: Float32Array.from(embs[s.id].emb), seconds: embs[s.id].seconds })
      );
      const names = m === 1 ? new Map() : memory.match(centroids);
      list.forEach((s, i) => {
        const got = names.get(i + 1);
        const e = embs[s.id];
        if (s.kind === 'passage') {
          r.oneoff++;
          if (got) r.oneoffNamed++;
          return;
        }
        const seen = devicesSeen.get(s.person) || new Set();
        if (m > 1) {
          r.known++;
          const bucket = seen.has(s.device) ? r.sameDevice : r.newDevice;
          bucket.n++;
          if (got === s.person) {
            r.ok++;
            bucket.ok++;
          } else if (got) r.wrong++;
          else r.none++;
        }
        // L'utilisateur nomme (première réunion) ou corrige (nom absent ou faux)
        if (got !== s.person || (opts.confirm && got === s.person)) {
          memory.remember(s.person, Float32Array.from(e.emb), e.seconds);
          seen.add(s.device);
          devicesSeen.set(s.person, seen);
        }
      });
    }
  }
  return r;
}

const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1).padStart(5) + ' %' : '   -   ');
function line(label, r) {
  return (
    `${label.padEnd(34)} reconnues ${pct(r.ok, r.known)} | confusions ${pct(r.wrong, r.known)} | sans nom ${pct(r.none, r.known)}` +
    ` | passage nommé ${pct(r.oneoffNamed, r.oneoff)} | même appareil ${pct(r.sameDevice.ok, r.sameDevice.n)}` +
    ` | appareil nouveau ${pct(r.newDevice.ok, r.newDevice.n)}`
  );
}

// Mémoire de l'application (seuil réglable par L.SPEAKER_CFG.remember)
const BASE = { ...L.SPEAKER_CFG };
const current = (threshold) => () => {
  // les simulations se suivent : le seuil partagé est réglé juste avant chacune
  L.SPEAKER_CFG.remember = threshold != null ? threshold : BASE.remember;
  const mem = new L.VoiceMemory(memStore());
  mem.setEnabled(true);
  return mem;
};

// Mémoire jusqu'à la version 4.1.0, recopiée à l'identique pour garder la comparaison « avant » :
// une empreinte moyenne par personne, seuil 0,65, sans marge.
class Before {
  constructor(threshold = 0.65) {
    this.threshold = threshold;
    this.voices = [];
  }
  match(centroids) {
    const pairs = [];
    for (const [voice, c] of centroids)
      for (const m of this.voices) pairs.push({ voice, name: m.name, sim: dot(c.emb, m.emb) });
    pairs.sort((a, b) => b.sim - a.sim);
    const out = new Map();
    const used = new Set();
    for (const p of pairs) {
      if (p.sim < this.threshold) break;
      if (out.has(p.voice) || used.has(p.name)) continue;
      out.set(p.voice, p.name);
      used.add(p.name);
    }
    return out;
  }
  remember(name, emb, seconds) {
    const v = this.voices.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (v) {
      const w1 = Math.min(v.seconds, 600);
      const w2 = Math.min(seconds, 600);
      v.emb = unit(v.emb.map((x, i) => x * w1 + emb[i] * w2));
      v.seconds = w1 + w2;
    } else this.voices.push({ name, emb: Array.from(emb), seconds });
  }
}
const before = (threshold) => () => new Before(threshold);

// Prototypes des pistes de refonte.md §9, pour les essais avant de toucher à l'application.
//   max : nombre d'empreintes gardées par personne ; full : quand la liste est pleine, oublier la
//   plus ancienne (« oldest ») ou fusionner les deux plus proches (« merge ») ;
//   score : « max » (empreinte la plus proche), « mean » (moyenne des empreintes, comme avant),
//   « both » (le meilleur des deux) ; margin : écart minimal avec la deuxième personne.
const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};
const unit = (v) => {
  const n = Math.sqrt(dot(v, v)) || 1;
  return Float32Array.from(v, (x) => x / n);
};
class Proto {
  constructor({ max = 5, full = 'oldest', score = 'max', threshold = 0.65, margin = 0 }) {
    Object.assign(this, { max, full, score, threshold, margin });
    this.people = new Map(); // nom -> [{ emb, seconds }]
  }
  remember(name, emb, seconds) {
    const list = this.people.get(name) || [];
    list.push({ emb: unit(emb), seconds });
    while (list.length > this.max) {
      if (this.full === 'oldest') list.shift();
      else {
        let bi = 0;
        let bj = 1;
        let bv = -2;
        for (let i = 0; i < list.length; i++)
          for (let j = i + 1; j < list.length; j++) {
            const v = dot(list[i].emb, list[j].emb);
            if (v > bv) [bv, bi, bj] = [v, i, j];
          }
        const a = list[bi];
        const b = list[bj];
        a.emb = unit(a.emb.map((x, k) => x * a.seconds + b.emb[k] * b.seconds));
        a.seconds += b.seconds;
        list.splice(bj, 1);
      }
    }
    this.people.set(name, list);
  }
  sim(list, emb) {
    const best = Math.max(...list.map((p) => dot(p.emb, emb)));
    if (this.score === 'max') return best;
    const mean = dot(
      unit(
        list.reduce(
          (acc, p) => acc.map((x, k) => x + p.emb[k] * Math.min(p.seconds, 600)),
          new Float32Array(emb.length)
        )
      ),
      emb
    );
    return this.score === 'mean' ? mean : Math.max(best, mean);
  }
  match(centroids) {
    const pairs = [];
    const bestOf = new Map();
    for (const [voice, c] of centroids) {
      const sims = [...this.people].map(([name, list]) => ({ voice, name, sim: this.sim(list, c.emb) }));
      sims.sort((a, b) => b.sim - a.sim);
      bestOf.set(voice, sims);
      pairs.push(...sims);
    }
    pairs.sort((a, b) => b.sim - a.sim);
    const out = new Map();
    const used = new Set();
    for (const p of pairs) {
      if (p.sim < this.threshold) break;
      if (out.has(p.voice) || used.has(p.name)) continue;
      const sims = bestOf.get(p.voice);
      const second = sims.find((s) => s.name !== p.name);
      if (this.margin && second && p.sim - second.sim < this.margin) continue;
      out.set(p.voice, p.name);
      used.add(p.name);
    }
    return out;
  }
}
const proto = (o) => () => new Proto(o);

const halves = { réglage: [0, 1, 2, 3], contrôle: [4, 5, 6, 7] };
const json = process.argv.includes('--json');
const results = {};
console.log(`Corpus : ${sessions.length} sessions${missing ? ` (${missing} sans empreinte)` : ''}`);
for (const [half, teams] of Object.entries(halves)) {
  console.log(`\n=== Moitié « ${half} » (équipes ${teams.map((t) => t + 1).join(', ')}) ===`);
  const run = (label, make, opts) => {
    const r = simulate(teams, make, opts);
    (results[half] = results[half] || {})[label] = r;
    if (!json) console.log(line(label, r));
  };
  run('Avant (4.1.0, seuil 0,65)', before());
  run(`Après (4.2.0, seuil ${BASE.remember})`, current());
  if (process.argv.includes('--sweep'))
    for (let th = 0.6; th <= 0.901; th += 0.025) run(`après, seuil ${th.toFixed(3)}`, current(th));
}

// --explore : grille des pistes. Pour chaque piste, le seuil est choisi sur la moitié « réglage »
// (le plus de bonnes reconnaissances, sous un plafond de faux noms : confusions et personnes de
// passage nommées, chacune au plus --cap %, 2 % par défaut), puis appliqué tel quel à la moitié
// « contrôle ».
if (process.argv.includes('--explore')) {
  const cap = Number((process.argv.find((a) => a.startsWith('--cap=')) || '=2').split('=')[1]) / 100;
  const safe = (r) => r.wrong / r.known <= cap && r.oneoffNamed / r.oneoff <= cap;
  const ths = [];
  for (let th = 0.4; th <= 0.9501; th += 0.025) ths.push(Math.round(th * 1000) / 1000);
  const tracks = [{ label: 'avant', make: (th) => before(th) }];
  for (const max of [1, 3, 5, 8])
    for (const score of max === 1 ? ['max'] : ['max', 'mean'])
      for (const full of max === 1 ? ['oldest'] : ['oldest', 'merge'])
        for (const margin of [0, 0.05, 0.1, 0.15])
          tracks.push({
            label: `max ${max}, ${score}, ${full}${margin ? ', marge ' + margin : ''}`,
            make: (th) => proto({ max, score, full, margin, threshold: th }),
          });
  for (const opts of [{}, { confirm: true }]) {
    console.log(
      `\n=== Grille${opts.confirm ? ' (empreinte ajoutée aussi quand le nom proposé est gardé)' : ''}, plafond ${cap * 100} % ===`
    );
    const rows = [];
    for (const tr of tracks) {
      let pick = null;
      for (const th of ths) {
        const r = simulate(halves.réglage, tr.make(th), opts);
        if (safe(r) && (!pick || r.ok > pick.r.ok)) pick = { th, r };
      }
      if (!pick) continue;
      rows.push({ tr, th: pick.th, tune: pick.r, test: simulate(halves.contrôle, tr.make(pick.th), opts) });
    }
    rows.sort((a, b) => b.tune.ok - a.tune.ok);
    for (const row of rows.slice(0, 14)) {
      console.log(line(`${row.tr.label}, seuil ${row.th}`, row.tune));
      console.log(line('   contrôle', row.test));
    }
  }
}
// --stats : similarité entre deux réunions, selon qu'il s'agit de la même personne (même appareil
// ou non) ou de deux personnes différentes. Et, pour chaque habituée, la personne la plus proche.
if (process.argv.includes('--stats')) {
  const groups = { 'même personne, même appareil': [], 'même personne, autre appareil': [], 'deux personnes': [] };
  const E = sessions.map((s) => ({ s, e: Float32Array.from(embs[s.id].emb) }));
  for (let i = 0; i < E.length; i++)
    for (let j = i + 1; j < E.length; j++) {
      const a = E[i].s;
      const b = E[j].s;
      const v = dot(E[i].e, E[j].e);
      if (a.person !== b.person) groups['deux personnes'].push(v);
      else groups[a.device === b.device ? 'même personne, même appareil' : 'même personne, autre appareil'].push(v);
    }
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))].toFixed(3);
  console.log('\nSimilarité entre deux réunions (quantiles 1 %, 5 %, 50 %, 95 %, 99 %, maximum)');
  for (const [k, arr] of Object.entries(groups)) {
    arr.sort((x, y) => x - y);
    console.log(
      `${k.padEnd(32)} n=${String(arr.length).padStart(6)}  ${[0.01, 0.05, 0.5, 0.95, 0.99].map((p) => q(arr, p)).join('  ')}  ${arr[arr.length - 1].toFixed(3)}`
    );
  }
  const devices = Object.keys(corpus.devices);
  console.log('\nMême personne, similarité médiane entre appareils');
  console.log(''.padEnd(10) + devices.map((d) => d.padStart(10)).join(''));
  for (const d1 of devices) {
    const row = devices.map((d2) => {
      const v = [];
      for (let i = 0; i < E.length; i++)
        for (let j = i + 1; j < E.length; j++) {
          const a = E[i].s;
          const b = E[j].s;
          if (a.person === b.person && ((a.device === d1 && b.device === d2) || (a.device === d2 && b.device === d1)))
            v.push(dot(E[i].e, E[j].e));
        }
      v.sort((x, y) => x - y);
      return (v.length ? v[v.length >> 1].toFixed(3) : '-').padStart(10);
    });
    console.log(d1.padEnd(10) + row.join(''));
  }
}
// --curve : compromis seuil par seuil, sur tout le corpus, pour la mémoire actuelle et la piste
// retenue (plusieurs empreintes, la plus proche, marge avec la deuxième personne).
if (process.argv.includes('--curve')) {
  const all = [...halves.réglage, ...halves.contrôle];
  const ths = [0.6, 0.65, 0.7, 0.75, 0.775, 0.8, 0.825, 0.85, 0.875, 0.9];
  console.log('\nCompromis sur tout le corpus (8 équipes)');
  for (const th of ths) console.log(line(`avant, seuil ${th}`, simulate(all, before(th))));
  for (const margin of [0, 0.05, 0.1])
    for (const max of [1, 5])
      for (const th of ths)
        console.log(
          line(`${max} empr., marge ${margin}, seuil ${th}`, simulate(all, proto({ max, margin, threshold: th })))
        );
}
if (json) console.log(JSON.stringify(results, null, 1));
