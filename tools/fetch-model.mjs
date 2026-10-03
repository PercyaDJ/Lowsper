// Télécharge les fichiers d'un modèle depuis Hugging Face dans tools/.cache/models/<id>.
// Usage : node fetch-model.mjs [whisper-base|whisper-small]
import { mkdir, stat, writeFile } from 'node:fs/promises';
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
for (const file of model.files) {
  const target = join(outDir, file);
  try {
    await stat(target);
    console.log(`déjà présent  ${file}`);
    continue;
  } catch {}
  const url = `https://huggingface.co/${model.repo}/resolve/${model.revision}/${file}`;
  process.stdout.write(`télécharge    ${file} ... `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, buf);
  console.log(`${(buf.length / 1e6).toFixed(1)} Mo`);
}
console.log(`OK : ${outDir}`);
