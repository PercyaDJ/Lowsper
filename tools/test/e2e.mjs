// Test de bout en bout, sur une copie du dossier Lowsper sans modèle :
//   1. premier lancement : installation du modèle (sélection du dossier simulée, téléchargements
//      Hugging Face servis depuis tools/.cache pour ne pas dépendre du réseau) ;
//   2. rechargement : le modèle est relu depuis le dossier, sans réseau ;
//   3. réunion simulée (micro = extrait français, participants = extrait anglais) ;
//   4. vérification du transcript Markdown et de l'absence de requête réseau hors installation.
//
// Usage : node test/e2e.mjs [durée_en_secondes]
import { chromium } from 'playwright-core';
import http from 'node:http';
import { cp, mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(here, 'output');
await mkdir(out, { recursive: true });
const meetingSeconds = Number(process.argv[2] || 45);

// Copie du dossier Lowsper sans aucun modèle installé
const site = join(out, 'site');
await rm(site, { recursive: true, force: true });
await mkdir(join(site, 'app', 'models'), { recursive: true });
await cp(join(root, 'Lowsper.html'), join(site, 'Lowsper.html'));
for (const d of ['css', 'js', 'engine']) await cp(join(root, 'app', d), join(site, 'app', d), { recursive: true });
await cp(join(root, 'app', 'manifest.js'), join(site, 'app', 'manifest.js'));
const manifestSrc = await readFile(join(root, 'app', 'manifest.js'), 'utf8');
const catalog = JSON.parse(manifestSrc.slice(manifestSrc.indexOf('{'), manifestSrc.lastIndexOf('}') + 1)).catalog;

// Le son « participants » est injecté en remplaçant getDisplayMedia (impossible en headless)
// Corpus « hebdo » : micro et participants sur deux canaux, sans répétition
const othersWav = await readFile(join(here, 'corpus', 'hebdo-others.wav'));
const corpusInfo = JSON.parse(await readFile(join(here, 'corpus', 'hebdo-fr.json'), 'utf8'));
const othersPcm = othersWav.subarray(44).toString('base64'); // PCM 16 bits, 16 kHz, mono

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  // Proxy éventuel de l'environnement de test (le navigateur headless ne le lit pas seul)
  proxy: process.env.REAL_HF && process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${join(here, 'corpus', 'hebdo-me.wav')}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});
// IGNORE_TLS=1 : uniquement pour un environnement de test dont le navigateur headless ne connaît
// pas l'autorité de certification. L'intégrité reste garantie par la vérification SHA-256.
const context = await browser.newContext({
  // Interface en français : les vérifications portent sur les textes français (decision.md §25)
  locale: 'fr-FR',
  acceptDownloads: true,
  viewport: { width: 900, height: 1000 },
  ignoreHTTPSErrors: !!process.env.IGNORE_TLS,
});
const page = await context.newPage();

const network = [];
let installing = true;
page.on('request', (r) => {
  const u = r.url();
  if (!/^(file|blob|data):/.test(u) && !installing) network.push(u);
  if (
    installing &&
    !/^(file|blob|data):/.test(u) &&
    !u.startsWith(hfBase || 'https://huggingface.co') &&
    !/^https:\/\/[^/]*hf\.co\//.test(u)
  )
    network.push(u);
});

// Faux serveur Hugging Face local : sert tools/.cache avec la même mécanique que le vrai
// (redirection vers un CDN, en-têtes CORS). Avec REAL_HF=1, téléchargement réel.
let served = 0;
let hfBase = null;
if (!process.env.REAL_HF) {
  const server = http.createServer(async (req, res) => {
    const cors = { 'access-control-allow-origin': '*' };
    if (req.method === 'OPTIONS') {
      // Pré-vérification « Private Network Access » de Chrome (page publique -> 127.0.0.1)
      res.writeHead(204, {
        ...cors,
        'access-control-allow-private-network': 'true',
        'access-control-allow-headers': '*',
      });
      return res.end();
    }
    const m = req.url.match(/^\/(.+?)\/resolve\/([0-9a-f]+)\/(.+)$/);
    if (m) {
      res.writeHead(302, { ...cors, location: '/cdn/' + Buffer.from(req.url).toString('base64url') });
      return res.end();
    }
    const c = req.url.match(/^\/cdn\/(.+)$/);
    if (!c) return res.writeHead(404, cors).end();
    const [, repo, revision, path] = Buffer.from(c[1], 'base64url')
      .toString()
      .match(/^\/(.+?)\/resolve\/([0-9a-f]+)\/(.+)$/);
    const entry = catalog.find((x) => x.repo === repo && x.revision === revision);
    if (!entry) return res.writeHead(404, cors).end();
    const body = await readFile(join(here, '..', '.cache', 'models', entry.id, path));
    served += body.length;
    res.writeHead(200, { ...cors, 'content-type': 'application/octet-stream', 'content-length': body.length });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  hfBase = `http://127.0.0.1:${server.address().port}`;
  server.unref();
  // La copie de test autorise ce faux serveur dans la politique de sécurité
  const html = await readFile(join(site, 'Lowsper.html'), 'utf8');
  await writeFile(join(site, 'Lowsper.html'), html.replace('connect-src ', `connect-src ${hfBase} `));
  await page.addInitScript((base) => {
    window.Lowsper = Object.assign(window.Lowsper || {}, { hfBase: base });
  }, hfBase);
} else {
  page.on('requestfinished', async (r) => {
    const sizes = await r.sizes().catch(() => null);
    if (sizes && /hf\.co|huggingface\.co/.test(r.url())) served += sizes.responseBodySize;
  });
}

// Sélecteur de dossier simulé : un faux FileSystemDirectoryHandle qui écrit dans « site »
await page.exposeFunction('__lowsperFs', async (op, rel, data) => {
  const p = join(site, rel);
  if (op === 'dir') {
    if (data) await mkdir(p, { recursive: true });
    else await stat(p);
  } else if (op === 'file') {
    if (!data) await stat(p);
  } else if (op === 'write') {
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  } else if (op === 'rm') {
    await rm(p, { force: true });
  } else if (op === 'append') {
    await writeFile(p, data, { flag: 'a' });
  }
  return true;
});
await page.addInitScript((NOWRITE) => {
  const dir = (rel) => ({
    kind: 'directory',
    async getDirectoryHandle(name, opts = {}) {
      await window.__lowsperFs('dir', rel + '/' + name, !!opts.create);
      return dir(rel + '/' + name);
    },
    async removeEntry(name) {
      await window.__lowsperFs('rm', rel + '/' + name);
    },
    async getFileHandle(name, opts = {}) {
      const path = rel + '/' + name;
      await window.__lowsperFs('file', path, !!opts.create);
      return {
        kind: 'file',
        async createWritable() {
          const parts = [];
          return {
            async write(t) {
              parts.push(t);
            },
            // Envoi par morceaux de 2 Mo : les gros messages font tomber la liaison avec Playwright
            async close() {
              if (window.__NOWRITE) {
                console.log('close ' + path + ' ' + parts.join('').length);
                return;
              }
              const all = parts.join('');
              await window.__lowsperFs('write', path, all.slice(0, 2e6));
              for (let i = 2e6; i < all.length; i += 2e6)
                await window.__lowsperFs('append', path, all.slice(i, i + 2e6));
            },
          };
        },
      };
    },
  });
  window.showDirectoryPicker = async () => dir('.');
  window.__NOWRITE = NOWRITE;
}, !!process.env.NOWRITE);
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning' || process.env.NOWRITE)
    console.log(`[page ${m.type()}]`, m.text());
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('crash', () => console.log('[CRASH] la page a planté'));
page.on('close', () => console.log('[close]'));

await page.addInitScript((pcmB64) => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const ctx = new AudioContext();
    const bytes = Uint8Array.from(atob(pcmB64), (c) => c.charCodeAt(0));
    const pcm = new Int16Array(bytes.buffer);
    const buf = ctx.createBuffer(1, pcm.length, 16000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = false;
    const dest = ctx.createMediaStreamDestination();
    src.connect(dest);
    src.start(ctx.currentTime);
    const canvas = document.createElement('canvas');
    const video = canvas.captureStream(1).getVideoTracks();
    return new MediaStream([...dest.stream.getAudioTracks(), ...video]);
  };
}, othersPcm);

let t0 = Date.now();
await page.goto(pathToFileURL(join(site, 'Lowsper.html')).href);
await page.waitForSelector('#view-install:not([hidden])');
// Écran de bienvenue (decision.md §26) : ce qui est détecté, un seul choix, le recommandé coché
const welcome = await page.evaluate(() => ({
  chips: [...document.querySelectorAll('#hw-chips li')].map((li) => li.textContent),
  radios: document.querySelectorAll('input[name="model-choice"][type="radio"]').length,
  checked: [...document.querySelectorAll('input[name="model-choice"]:checked')].map((i) => i.value),
  best: [...document.querySelectorAll('.badge.best')].map((b) => b.closest('label').querySelector('input').value),
  folder: document.getElementById('page-folder').textContent,
}));
console.log(`Bienvenue : ${welcome.chips.join(' · ')} ; recommandé : ${welcome.best.join(', ')}`);
if (!welcome.chips.some((c) => /processeurs? logiques?/.test(c))) throw new Error('cœurs non affichés');
if (welcome.checked.length !== 1 || welcome.checked[0] !== welcome.best[0])
  throw new Error('le modèle recommandé doit être le seul coché : ' + JSON.stringify(welcome));
if (!welcome.folder) throw new Error('dossier détecté non affiché');
// Le test porte sur Whisper small (qualité attendue ci-dessous), quel que soit le recommandé ici
await page.check('input[name="model-choice"][value="whisper-small"]');
const installLabel = await page.textContent('#install');
console.log(`Bouton d'installation : ${installLabel}`);
await page.screenshot({ path: join(out, '0-installation.png') });
await page.click('#install');
await page.waitForSelector('#install-progress:not([hidden])');
await page.waitForTimeout(1500);
await page.screenshot({ path: join(out, '0b-installation-en-cours.png') });
await Promise.race([
  page.waitForEvent('load', { timeout: 900000 }), // rechargement automatique après installation
  page.waitForSelector('#install-error:not([hidden])', { timeout: 900000 }).then(async () => {
    throw new Error('Installation en échec : ' + (await page.textContent('#install-error')));
  }),
]);
console.log(`Installation : ${(served / 1e6).toFixed(0)} Mo en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
installing = false;

t0 = Date.now();
await page.waitForSelector('#engine[data-state="ready"]', { timeout: 180000 });
console.log(`Moteur prêt en ${((Date.now() - t0) / 1000).toFixed(1)} s (modèle relu depuis le dossier)`);
await page.screenshot({ path: join(out, '2-accueil.png') });

await page.fill('#title', 'Test automatique');
await page.click('#settings-open'); // roue crantée
await page.waitForSelector('#settings[open]');
await page.selectOption('#language', 'fr');
await page.fill('#glossary', corpusInfo.glossary);
await page.screenshot({ path: join(out, '2b-parametres.png') });
await page.click('#settings-close');
await page.click('#start');
await page.waitForSelector('#view-rec:not([hidden])');
console.log(`Réunion simulée pendant ${meetingSeconds} s...`);
// Panne simulée du moteur au milieu de la réunion : le passage doit être relancé, pas perdu
await page.waitForTimeout(8000);
await page.evaluate(() => {
  const w = LowsperApp.workers[0];
  const real = w.transcribe.bind(w);
  let once = true;
  w.transcribe = (...a) => (once ? ((once = false), Promise.reject(new Error('panne simulée'))) : real(...a));
});
let maxBacklog = 0;
// Enchaînement : à mi-parcours, « Réunion suivante » ; la première réunion est enregistrée seule
const downloads = [];
page.on('download', (d) => downloads.push(d));
let chained = false;
for (let waited = 0; waited < meetingSeconds; waited += 2) {
  await page.waitForTimeout(2000);
  // Perte simulée en direct (comme un détecteur bloqué) : les blocs de 38 à 50 s sont jetés.
  // Le rattrapage de fin de réunion doit les retrouver dans le son brut.
  if (waited === 2) {
    await page.evaluate(() => {
      const c = LowsperApp.capture;
      const real = c.onSegment;
      c.onSegment = (id, seg) =>
        seg.start >= 38 && seg.start < 50 ? (window.__dropped = (window.__dropped || 0) + 1) : real(id, seg);
    });
  }
  if (!chained && waited >= meetingSeconds / 2) {
    chained = true;
    await page.evaluate(() => (LowsperApp.pip ? LowsperApp.pip.document : document).getElementById('chain').click());
  }
  const backlog = await page.evaluate(() => LowsperApp.queue.length + LowsperApp.inFlight);
  maxBacklog = Math.max(maxBacklog, backlog);
}
const draftsDuring = await page.evaluate(
  () => (LowsperApp.transcript ? LowsperApp.transcript.draftCount() : 0) + LowsperApp.drafts.length
);
console.log(`Passages pris en charge par la voie rapide : ${draftsDuring}`);
console.log(`File d'attente maximale pendant la réunion : ${maxBacklog} passage(s)`);
// Comme un appel Teams : la mini-fenêtre s'ouvre d'elle-même au démarrage (si le navigateur le permet)
const pipAuto = await page.evaluate(() => !!LowsperApp.pip);
const pipSize = pipAuto
  ? await page.evaluate(() => [
      LowsperApp.pip.innerWidth,
      LowsperApp.pip.innerHeight,
      !!LowsperApp.pip.document.getElementById('stop'),
    ])
  : null;
console.log(
  'Mini-fenêtre ouverte au démarrage : ' +
    (pipAuto ? `oui (${pipSize[0]} x ${pipSize[1]})` : 'non (navigateur sans mini-fenêtre)')
);
// Les boutons de la mini-fenêtre répondent (vrai clic de souris dans la mini-fenêtre)
let pipClickOk = !pipAuto;
if (pipAuto) {
  const pipPage = context.pages().find((p) => p !== page);
  if (pipPage) {
    await pipPage.click('#pause', { timeout: 5000 }).catch(() => {});
    const paused = await page.evaluate(() => LowsperApp.capture.paused);
    await pipPage.click('#pause', { timeout: 5000 }).catch(() => {});
    const resumed = await page.evaluate(() => !LowsperApp.capture.paused);
    pipClickOk = paused && resumed;
  }
}
if (pipAuto) await page.evaluate(() => LowsperApp.closePip());
await page.waitForTimeout(300);
await page.screenshot({ path: join(out, '3-enregistrement.png') });
// Fenêtre réduite : les boutons doivent rester visibles sans défiler
await page.setViewportSize({ width: 360, height: 460 });
await page.waitForTimeout(300);
await page.screenshot({ path: join(out, '3b-fenetre-reduite.png') });
// Fenêtre très basse : Lowsper devient une simple barre, comme la mini-fenêtre
await page.setViewportSize({ width: 360, height: 110 });
await page.waitForTimeout(300);
await page.screenshot({ path: join(out, '3c-barre.png') });
const barOk = await page.evaluate(() => {
  const r = document.getElementById('stop').getBoundingClientRect();
  return document.body.classList.contains('mini') && r.bottom <= window.innerHeight && r.width > 0;
});
await page.setViewportSize({ width: 360, height: 460 });
await page.waitForTimeout(300);
const compactOk = await page.evaluate(() => {
  const r = document.getElementById('stop').getBoundingClientRect();
  return r.bottom <= window.innerHeight && r.right <= window.innerWidth && r.width > 0;
});
await page.setViewportSize({ width: 900, height: 1000 });

const tStop = Date.now();
await page.click('#stop');
for (let i = 0; i < 360 && downloads.length < 2; i++) await page.waitForTimeout(500);
// La première réunion porte le titre « Test automatique » ; la seconde, enchaînée, n'en a pas
const firstDl = downloads.find((d) => /test-automatique/.test(d.suggestedFilename())) || downloads[0];
const download = downloads.find((d) => d !== firstDl) || firstDl;
const firstPath = join(out, 'premiere-' + firstDl.suggestedFilename());
await firstDl.saveAs(firstPath);
const firstMd = await readFile(firstPath, 'utf8');
console.log(`Transcript final ${((Date.now() - tStop) / 1000).toFixed(1)} s après « Terminer »`);
const mdPath = join(out, download.suggestedFilename());
await download.saveAs(mdPath);
await page.screenshot({ path: join(out, '4-termine.png'), fullPage: true });
const md = await readFile(mdPath, 'utf8');
const health = await page.evaluate(() => ({
  ...LowsperApp.health,
  failed: LowsperApp.failed.length,
  dropped: window.__dropped || 0,
}));
console.log(`Blocs jetés volontairement en direct : ${health.dropped}`);
console.log(
  `Santé du moteur : ${health.retried} relance(s), ${health.restarts} redémarrage(s), ${health.failed} passage(s) abandonné(s)`
);
// Laisse le temps à la retranscription précise des passages « rapides »
for (let i = 0; i < 60; i++) {
  const left = await page.evaluate(() => LowsperApp.transcript.draftCount());
  if (!left) break;
  await page.waitForTimeout(5000);
}
const draftsLeft = await page.evaluate(() => LowsperApp.transcript.draftCount());
console.log(`Passages « rapides » restant à améliorer : ${draftsLeft}`);
console.log('----- ' + download.suggestedFilename() + ' -----\n' + md + '-----');

// Corriger un mot partout : remplacé dans l'aperçu, retenu pour les réunions suivantes
const hadTickets = await page.evaluate(() => /tickets/i.test(document.getElementById('preview').textContent));
await page.click('#fixer summary');
await page.fill('#fix-wrong', 'tickets');
await page.fill('#fix-right', 'demandes');
await page.click('#fix-apply');
await page.waitForTimeout(300);
const fixOk = await page.evaluate(
  (had) =>
    (!had || /demandes/.test(document.getElementById('preview').textContent)) &&
    JSON.parse(localStorage.getItem('lowsper.fixes') || '[]').some(([w, r]) => w === 'tickets' && r === 'demandes'),
  hadTickets
);
const suspects = await page.evaluate(() =>
  [...document.querySelectorAll('#fix-suspects button')].map((b) => b.textContent)
);
console.log('Mots à vérifier proposés : ' + suspects.join(', '));
await page.screenshot({ path: join(out, '4b-corriger.png'), fullPage: true });

// Thème sombre
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForTimeout(500);
await page.screenshot({ path: join(out, '5-termine-sombre.png'), fullPage: true });
await browser.close();

const checks = [
  ['installation du modèle', served > 50e6],
  ['titre', firstMd.startsWith('# Transcript de réunion : Test automatique')],
  ["glossaire dans l'en-tête", md.includes('ServiceNow, P1') && firstMd.includes('ServiceNow, P1')],
  ['horodatage', /\*\*\[00:00:\d\d\] /.test(md)],
  ['voix micro (Vous)', /\] Vous :\*\*/.test(firstMd + md)],
  ['voix participants', /\] (Participants|Intervenant \d+) :\*\*/.test(firstMd + md)],
  ['contenu « participants »', /tickets/i.test(firstMd + md) && /indicateurs/i.test(firstMd + md)],
  ['contenu « vous »', /VPN/.test(firstMd + md)],
  ['plusieurs intervenants distingués', /Intervenant 2/.test(firstMd + md)],
  ['aucune requête réseau après installation', network.length === 0],
  ['bouton Terminer visible en fenêtre réduite', compactOk],
  ['fenêtre très basse : barre façon appel Teams', barOk],
  // (taille non vérifiable sans écran : le navigateur de test donne à la mini-fenêtre la taille de la page)
  ['mini-fenêtre ouverte au démarrage, avec les commandes', !pipAuto || pipSize[2]],
  ['boutons de la mini-fenêtre : pause puis reprise au clic', pipClickOk],
  // (file un peu plus longue tolérée : la panne simulée impose le redémarrage d'un moteur, ~20 s)
  ['le moteur suit le rythme malgré la panne simulée (file <= 6)', maxBacklog <= 6],
  ['passages rapides tous retranscrits ensuite', draftsLeft === 0],
  ['corriger un mot partout, correction retenue', fixOk],
  [
    'réunion suivante sans temps mort : deux fichiers, chacun horodaté depuis son début',
    downloads.length === 2 && firstMd !== md && /\*\*\[00:00:\d\d\] /.test(md) && /à tous/.test(firstMd),
  ],
  ['parole perdue en direct retrouvée par le rattrapage', health.dropped === 0 || /\*\*Rattrapage\*\*/.test(md)],
  [
    'panne du moteur : passage relancé, toute la parole transcrite',
    health.retried >= 1 &&
      health.failed === 0 &&
      /toute la parole détectée a été transcrite/.test(md) &&
      /toute la parole détectée a été transcrite/.test(firstMd),
  ],
];
let ok = true;
for (const [name, pass] of checks) {
  console.log(`${pass ? 'OK  ' : 'ÉCHEC'} ${name}`);
  ok &&= pass;
}
if (network.length) console.log('Requêtes réseau détectées :', network);
await writeFile(join(out, 'resultat.txt'), checks.map(([n, p]) => `${p ? 'OK' : 'ECHEC'} ${n}`).join('\n'));
process.exit(ok ? 0 : 1);
