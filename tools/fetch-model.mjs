// Télécharge les fichiers d'un modèle depuis Hugging Face dans tools/.cache/models/<id>,
// en figeant la révision (commit) et en notant l'empreinte SHA-256 de chaque fichier.
// Ces informations alimentent le catalogue utilisé par l'installateur intégré à Lowsper.
// Usage : node fetch-model.mjs [id]   (ids : voir models.mjs)
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, DEFAULT_MODEL } from './models.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const id = process.argv[2] || DEFAULT_MODEL;
const model = MODELS[id];
if (!model) {
  console.error(`Modèle inconnu "${id}". Choix : ${Object.keys(MODELS).join(', ')}`);
  process.exit(1);
}

const outDir = join(here, '.cache', 'models', id);
const metaPath = join(outDir, 'meta.json');
let meta = await readFile(metaPath, 'utf8').then(JSON.parse).catch(() => null);
if (!meta || meta.repo !== model.repo) {
  const info = await (await fetch(`https://huggingface.co/api/models/${model.repo}/revision/${model.revision}`)).json();
  meta = { repo: model.repo, revision: info.sha, files: {} };
}

for (const file of model.files) {
  const target = join(outDir, file);
  let buf = await readFile(target).catch(() => null);
  if (!buf) {
    const url = `https://huggingface.co/${model.repo}/resolve/${meta.revision}/${file}`;
    process.stdout.write(`télécharge    ${file} ... `);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, buf);
    console.log(`${(buf.length / 1e6).toFixed(1)} Mo`);
  } else {
    console.log(`déjà présent  ${file}`);
  }
  meta.files[file] = { size: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
}
await writeFile(metaPath, JSON.stringify(meta, null, 2));
console.log(`OK : ${outDir} (révision ${meta.revision.slice(0, 10)})`);
