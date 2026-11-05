// Télécharge les fichiers d'un modèle dans tools/.cache/models/<id>, à la révision figée dans
// models.lock.json, et vérifie l'empreinte SHA-256 de chaque fichier. Un fichier différent de
// celui du verrou est refusé : deux développeurs obtiennent exactement les mêmes octets.
//
// Usage :
//   node fetch-model.mjs <id>            télécharge le modèle verrouillé (ids : voir models.lock.json)
//   node fetch-model.mjs --all           tous les modèles nécessaires au build (catalogue + analyse audio)
//   node fetch-model.mjs <id> --update   change volontairement de révision (dernière version publiée)
//                                        et réécrit le verrou : à relire et commiter avec soin
// Les variantes de mesure de models.mjs, absentes du verrou, sont téléchargées sans contrôle
// (dernière version publiée), avec un avertissement.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, DEFAULT_MODEL } from './models.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const lockPath = join(here, 'models.lock.json');
const lock = JSON.parse(await readFile(lockPath, 'utf8'));
const args = process.argv.slice(2);
const update = args.includes('--update');
const ids = args.includes('--all') ? Object.keys(lock) : [args.find((a) => !a.startsWith('--')) || DEFAULT_MODEL];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const fileUrl = (e, revision, path) =>
  e.source === 'github'
    ? `https://raw.githubusercontent.com/${e.repo}/${revision}/${path}`
    : `https://huggingface.co/${e.repo}/resolve/${revision}/${path}`;

async function latestRevision(e) {
  if (e.source === 'github')
    throw new Error(`Mise à jour de ${e.repo} : choisir le commit à la main dans models.lock.json.`);
  const info = await (await fetch(`https://huggingface.co/api/models/${e.repo}/revision/main`)).json();
  return info.sha;
}

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

for (const id of ids) {
  let entry = lock[id];
  const unlocked = !entry;
  if (unlocked) {
    const model = MODELS[id];
    if (!model) {
      console.error(
        `Modèle inconnu "${id}". Choix : ${[...new Set([...Object.keys(lock), ...Object.keys(MODELS)])].join(', ')}`
      );
      process.exit(1);
    }
    console.warn(`Attention : ${id} n'est pas verrouillé (variante de mesure), aucune empreinte attendue.`);
    entry = {
      source: 'huggingface',
      repo: model.repo,
      revision: null,
      files: Object.fromEntries(model.files.map((f) => [f, {}])),
    };
  }
  const revision = unlocked || update ? await latestRevision(entry) : entry.revision;
  const outDir = join(here, '.cache', 'models', id);
  const meta = { repo: entry.repo, revision, files: {} };
  const files = {};

  for (const [path, expected] of Object.entries(entry.files)) {
    const target = join(outDir, expected.as || path);
    let buf = await readFile(target).catch(() => null);
    // Un fichier en cache qui ne correspond pas au verrou (ancienne révision) est retéléchargé
    if (buf && !unlocked && !update && sha256(buf) !== expected.sha256) buf = null;
    if (buf) {
      console.log(`déjà présent  ${path}`);
    } else {
      process.stdout.write(`télécharge    ${path} ... `);
      buf = await get(fileUrl(entry, revision, path));
      console.log(`${(buf.length / 1e6).toFixed(1)} Mo`);
    }
    const actual = { size: buf.length, sha256: sha256(buf) };
    if (!unlocked && !update && (actual.sha256 !== expected.sha256 || actual.size !== expected.size)) {
      throw new Error(
        `Empreinte inattendue pour ${id}/${path} : fichier refusé (attendu ${expected.sha256.slice(0, 12)}, reçu ${actual.sha256.slice(0, 12)}).`
      );
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, buf);
    meta.files[path] = actual;
    files[path] = expected.as ? { ...actual, as: expected.as } : actual;
  }
  await writeFile(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2));
  if (update) {
    lock[id] = { ...entry, revision, files };
    await writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');
    console.log(`Verrou mis à jour : ${id} -> ${revision.slice(0, 10)}`);
  }
  console.log(`OK : ${id} (révision ${String(revision).slice(0, 10)})`);
}
