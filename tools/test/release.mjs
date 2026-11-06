// Test du paquet de distribution (tools/release.mjs), rapide et sans navigateur, lancé en CI :
//   - il contient la page, app/ et les documents utiles, et rien d'autre (ni outils, ni tests,
//     ni modèles installés, ni réglages personnels) ;
//   - le zip produit se relit à l'identique ;
//   - deux constructions donnent exactement les mêmes octets (empreinte publiable).
// Usage : node test/release.mjs
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import { selectFiles, zip } from '../release.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
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

// Relecture d'un zip par son répertoire central (ce que fait l'Explorateur de Windows)
function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, 'répertoire central');
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = zlib.inflateRawSync(buf.subarray(start, start + size));
    assert.equal(zlib.crc32(data), buf.readUInt32LE(p + 16), 'CRC de ' + name);
    out.set(name, data);
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
const files = selectFiles(tracked);

await test("le paquet contient la page, app/ et les documents de l'utilisateur", () => {
  for (const f of [
    'Lowsper.html',
    'LICENSE',
    'README.md',
    'SECURITY.md',
    'app/manifest.js',
    'app/js/app.js',
    'app/js/i18n.js',
  ]) {
    assert.ok(files.includes(f), f + ' manquant');
  }
  assert.ok(
    files.some((f) => f.startsWith('app/engine/')),
    'moteur manquant'
  );
  assert.ok(files.includes('app/engine/THIRD_PARTY_LICENSES.txt'), 'licences tierces manquantes');
});

await test('rien pour les développeurs ni aucune donnée personnelle', () => {
  const extra = files.filter(
    (f) => /^(tools|\.github)\//.test(f) || /^(AGENTS|CLAUDE|CONTRIBUTING|decision)\.md$/.test(f) || f.startsWith('.')
  );
  assert.deepEqual(extra, []);
  const fake = selectFiles([
    ...tracked,
    'app/models/whisper-small/encoder.part0.txt',
    'app/models/index.txt',
    'app/reglages.txt',
  ]);
  assert.ok(!fake.some((f) => /app\/models\/(whisper|index)|reglages/.test(f)), 'modèles ou réglages livrés');
});

await test('le zip se relit à l’identique', async () => {
  const entries = await Promise.all(
    files.slice(0, 6).map(async (f) => ({ name: 'L/' + f, data: await readFile(join(root, f)) }))
  );
  const back = unzip(zip(entries));
  assert.equal(back.size, entries.length);
  for (const e of entries) assert.ok(back.get(e.name).equals(e.data), e.name);
});

await test('deux constructions donnent les mêmes octets (empreinte publiable)', () => {
  const entries = [
    { name: 'a.txt', data: Buffer.from('Lowsper') },
    { name: 'dossier/é.txt', data: Buffer.alloc(100000, 7) },
  ];
  assert.ok(zip(entries).equals(zip(entries)));
});

if (failed) {
  console.log(`\n${failed} test(s) du paquet en échec.`);
  process.exit(1);
}
console.log('\nPaquet de distribution conforme.');
