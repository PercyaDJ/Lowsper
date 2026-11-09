// Test de bout en bout du son de la réunion quand Windows refuse le son de tout l'ordinateur
// (decision.md §51), dans la vraie page. Le partage d'écran est simulé : il échoue avec
// NotReadableError (« Could not start audio source ») sauf quand la page demande restrictOwnAudio,
// comme sur le PC Windows 11 du mainteneur avec un casque surround.
//   1. premier partage refusé : le message propose d'abord « Partager le son de toutes les
//      applications », qui redemande l'écran entier avec restrictOwnAudio et capte le son ;
//   2. plus de message une fois le son capté, le bouton devient « Ajouter un onglet », et le choix
//      est retenu ;
//   3. réunion suivante : restrictOwnAudio est demandé d'emblée, sans échec ;
//   4. « Ajouter un onglet » ouvre la fenêtre de choix sur les onglets ;
//   5. navigateur qui ne connaît pas restrictOwnAudio : comportement d'avant (onglet d'abord) ;
//   6. Windows 11 (simulé) : le son de toutes les applications d'emblée, aucun message, bouton
//      « Ajouter un onglet » (decision.md §52) ;
//   7. bouton « Couper » du micro, dans la fenêtre et la mini-barre (decision.md §53) ;
//   8. aucune requête réseau.
// Prérequis : node build.mjs --embed whisper-small   (CHROMIUM_PATH si besoin)
// Usage : node test/e2e-share.mjs
import { chromium } from 'playwright-core';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const fail = (m) => {
  throw new Error(m);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

async function open(restrictKnown, windows11) {
  const context = await browser.newContext({ locale: 'fr-FR', viewport: { width: 900, height: 1000 } });
  const page = await context.newPage();
  const network = [];
  page.on('request', (r) => {
    if (!/^(file|blob|data):/.test(r.url())) network.push(r.url());
  });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await context.addInitScript(
    ([known, win11]) => {
      // Pas de mini-fenêtre automatique : la mini-barre reste dans la page, où le test la lit
      localStorage.setItem('lowsper.opt.autopip', '0');
      if (win11)
        Object.defineProperty(navigator, 'userAgentData', {
          value: { platform: 'Windows', getHighEntropyValues: async () => ({ platformVersion: '19.0.0' }) },
        });
      const md = navigator.mediaDevices;
      const supported = md.getSupportedConstraints.bind(md);
      md.getSupportedConstraints = () => ({ ...supported(), restrictOwnAudio: known });
      window.__asked = [];
      md.getDisplayMedia = async (opts) => {
        window.__asked.push(JSON.parse(JSON.stringify(opts)));
        const restrict = !!(opts.audio && opts.audio.restrictOwnAudio);
        // Le son du système passe par la sortie son de Windows : refusé, comme sur le PC du mainteneur
        if (!restrict && (!opts.video || !opts.video.displaySurface || opts.video.displaySurface === 'monitor'))
          throw new DOMException('Could not start audio source', 'NotReadableError');
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const dest = ctx.createMediaStreamDestination();
        osc.connect(dest);
        osc.start();
        const track = dest.stream.getAudioTracks()[0];
        const settings = track.getSettings.bind(track);
        track.getSettings = () => ({ ...settings(), restrictOwnAudio: restrict });
        const video = document.createElement('canvas').captureStream(1).getVideoTracks();
        video[0].getSettings = () => ({ displaySurface: restrict ? 'monitor' : opts.video.displaySurface });
        return new MediaStream([track, ...video]);
      };
    },
    [restrictKnown, !!windows11]
  );
  await page.goto(pathToFileURL(join(root, 'Lowsper.html')).href);
  await page.waitForSelector('#engine[data-state="ready"]', { timeout: 180000 });
  return { context, page, network };
}

async function startMeeting(page) {
  await page.click('#start');
  const before = await page.waitForSelector('#before[open]', { timeout: 3000 }).catch(() => null);
  if (before) await page.click('#before-continue');
  await page.waitForSelector('#view-rec:not([hidden])');
  await page.waitForTimeout(1500);
}

const notice = (page) => page.evaluate(() => document.getElementById('rec-notice').textContent);
const buttons = (page) =>
  page.evaluate(() => [...document.querySelectorAll('#rec-notice button')].map((b) => b.textContent));
const pref = (page) => page.evaluate(() => localStorage.getItem('lowsper.share.surface'));

// 1 à 4 : navigateur qui connaît restrictOwnAudio
{
  const { context, page, network } = await open(true);
  await startMeeting(page);
  let b = await buttons(page);
  console.log('Après le refus de Windows :', b.join(' | '));
  if (b[0] !== 'Partager le son de toutes les applications')
    fail('chemin « toutes les applications » attendu en premier');
  if (!/capter le son de tout l'ordinateur/.test(await notice(page))) fail('message du refus attendu');
  if ((await pref(page)) !== 'apps') fail('choix « apps » non retenu après le refus');
  await page.click('#rec-notice button[data-mode="apps"]');
  await page.waitForTimeout(800);
  let asked = await page.evaluate(() => window.__asked);
  const last = asked[asked.length - 1];
  if (!last.audio || last.audio.restrictOwnAudio !== true)
    fail('restrictOwnAudio non demandé : ' + JSON.stringify(last));
  if (!(await page.isHidden('#rec-notice'))) fail('aucun message attendu une fois le son capté');
  if ((await page.textContent('#others-add')) !== 'Ajouter un onglet') fail('bouton « Ajouter un onglet » attendu');
  if ((await pref(page)) !== 'apps') fail('choix « apps » non gardé après succès');
  console.log('Son de toutes les applications capté, bouton « Ajouter un onglet »');

  // 4. Ajouter un onglet : onglets présélectionnés
  await page.evaluate(() => document.getElementById('others-add').click());
  await page.waitForTimeout(800);
  asked = await page.evaluate(() => window.__asked);
  if (asked[asked.length - 1].video.displaySurface !== 'browser')
    fail('« Ajouter un onglet » doit proposer les onglets');
  console.log('Ajouter un onglet : onglets présélectionnés');

  // 3. Réunion suivante : restrictOwnAudio d'emblée, aucun refus
  await page.click('#stop');
  await page.waitForSelector('#view-rec[hidden]', { timeout: 120000 }).catch(() => {});
  await page.goto(pathToFileURL(join(root, 'Lowsper.html')).href);
  await page.waitForSelector('#engine[data-state="ready"]', { timeout: 180000 });
  await startMeeting(page);
  asked = await page.evaluate(() => window.__asked);
  if (asked.length !== 1 || !asked[0].audio.restrictOwnAudio)
    fail('réunion suivante : restrictOwnAudio attendu d’emblée');
  if ((await buttons(page)).length) fail('aucun refus attendu à la réunion suivante');
  console.log('Réunion suivante : son de toutes les applications demandé d’emblée');
  if (network.length) fail('requêtes réseau : ' + network.join(', '));
  await context.close();
}

// 5. Navigateur sans restrictOwnAudio : comportement d'avant
{
  const { context, page, network } = await open(false);
  await startMeeting(page);
  const b = await buttons(page);
  console.log('Sans restrictOwnAudio :', b.join(' | '));
  if (b[0] !== "Partager l'onglet de la visio") fail('sans restrictOwnAudio, l’onglet doit rester proposé en premier');
  if ((await pref(page)) !== 'tab') fail('préférence « tab » attendue');
  if (network.length) fail('requêtes réseau : ' + network.join(', '));
  await context.close();
}

// 6. Windows 11 : toutes les applications d'emblée, sans aucun message
{
  const { context, page, network } = await open(true, true);
  await startMeeting(page);
  const asked = await page.evaluate(() => window.__asked);
  if (asked.length !== 1 || !asked[0].audio.restrictOwnAudio) fail('Windows 11 : restrictOwnAudio attendu d’emblée');
  if (!(await page.isHidden('#rec-notice'))) fail('Windows 11 : aucun message attendu');
  if ((await page.textContent('#others-add')) !== 'Ajouter un onglet')
    fail('Windows 11 : « Ajouter un onglet » attendu');
  console.log('Windows 11 : son de toutes les applications d’emblée, aucun message');
  // Couper le micro (§53) : dans la fenêtre et la mini-barre, piste muette, état dit en clair
  await page.click('#mic-mute');
  const muted = await page.evaluate(() => ({
    pressed: document.getElementById('mic-mute').getAttribute('aria-pressed'),
    mini: document.getElementById('mini-mute').getAttribute('aria-pressed'),
    label: document.getElementById('mic-mute').textContent,
    status: document.getElementById('me-status').textContent,
    track: LowsperApp.micTrack.enabled,
  }));
  if (muted.pressed !== 'true' || muted.mini !== 'true' || muted.track !== false || muted.label !== 'Rétablir')
    fail('micro non coupé : ' + JSON.stringify(muted));
  if (!/Coupé/.test(muted.status)) fail('état « Coupé » attendu : ' + muted.status);
  await page.evaluate(() => document.getElementById('mini-mute').click());
  const back = await page.evaluate(() => [
    document.getElementById('mic-mute').getAttribute('aria-pressed'),
    LowsperApp.micTrack.enabled,
  ]);
  if (back[0] !== 'false' || back[1] !== true) fail('micro non rétabli : ' + JSON.stringify(back));
  console.log('Micro coupé puis rétabli (fenêtre et mini-barre)');
  if (network.length) fail('requêtes réseau : ' + network.join(', '));
  await context.close();
}

await browser.close();
console.log('Son de la réunion après un refus de Windows : conforme (decision.md §51).');
