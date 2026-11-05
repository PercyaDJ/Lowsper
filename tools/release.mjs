// Construit le paquet de distribution : tools/dist/Lowsper-<version>.zip et son empreinte SHA-256.
//
// Pourquoi un paquet, alors que GitHub propose « Download ZIP » ?
//   Le zip automatique de GitHub contient tout le dépôt : outils de développement, tests, corpus
//   audio (une vingtaine de Mo). L'utilisateur n'a besoin que de la page et de son dossier app/.
//   Ce paquet ne contient que les fichiers versionnés utiles, et il est reproductible : mêmes
//   fichiers, même ordre, mêmes dates, donc même empreinte pour une même version (decision.md §18).
//
// Usage : node release.mjs   (version lue dans tools/package.json)
// Aucune dépendance : le format zip est écrit ici, compression par zlib (Node.js 22 ou plus).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const { version } = JSON.parse(await readFile(join(here, 'package.json'), 'utf8'));

// Ce que reçoit l'utilisateur final : la page, son dossier app/, et les documents qui le concernent.
// Modèles installés et réglages personnels : exclus ici, en plus d'être ignorés par Git.
const DOCS = ['LICENSE', 'README.md', 'README.en.md', 'SECURITY.md', 'CHANGELOG.md'];
export function selectFiles(tracked) {
  return tracked
    .filter(
      (f) =>
        f === 'Lowsper.html' ||
        DOCS.includes(f) ||
        (f.startsWith('app/') &&
          f !== 'app/reglages.txt' &&
          (!f.startsWith('app/models/') || f === 'app/models/LISEZMOI.txt'))
    )
    .sort();
}

// --- Écriture d'un zip minimal (méthode « deflate », sans chiffrement ni extension) ---
// Date fixe (1er janvier 2020, format DOS) : le paquet ne dépend pas du moment où il est construit.
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

export function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version requise
    local.writeUInt16LE(0x0800, 6); // noms en UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, deflated);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + deflated.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  const files = selectFiles(tracked);
  const base = `Lowsper-${version}`;
  const entries = [];
  for (const f of files) entries.push({ name: `${base}/${f}`, data: await readFile(join(root, f)) });
  const archive = zip(entries);
  const dist = join(here, 'dist');
  await mkdir(dist, { recursive: true });
  const name = `${base}.zip`;
  await writeFile(join(dist, name), archive);
  const sha = createHash('sha256').update(archive).digest('hex');
  await writeFile(join(dist, `${name}.sha256`), `${sha}  ${name}\n`);
  console.log(`${name} : ${files.length} fichiers, ${(archive.length / 1e6).toFixed(1)} Mo`);
  console.log(`SHA-256 ${sha}`);
}
