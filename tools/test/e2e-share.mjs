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
//   8. PC d'entreprise (Windows 11, decision.md §55) : le son de toutes les applications s'ouvre
//      sans erreur mais reste muet, le son du système marche. Au bout de 20 s, « Partager le son
//      du système » est proposé ; une fois le son entendu, ce choix est retenu et la réunion
//      suivante le demande d'emblée ;
//   9. test du son (decision.md §56), PC d'entreprise : le signal de Lowsper revient par le son du
//      système, chemin retenu, ligne de l'accueil masquée, valeur dans les paramètres ;
//  10. test du son, PC du §51 : son du système refusé, son de toutes les applications essayé, un
//      son d'une autre application l'atteste, chemin retenu ;
//  11. aucune requête réseau.
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

async function open(restrictKnown, windows11, mutedApps) {
  const context = await browser.newContext({ locale: 'fr-FR', viewport: { width: 900, height: 1000 } });
  const page = await context.newPage();
  const network = [];
  page.on('request', (r) => {
    if (!/^(file|blob|data):/.test(r.url())) network.push(r.url());
  });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await context.addInitScript(
    ([known, win11, muted]) => {
      // Diagnostic : chaque écriture du chemin retenu, avec son origine, gardée d'un chargement à l'autre
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === 'lowsper.share.surface') {
          const w = JSON.parse(sessionStorage.getItem('__writes') || '[]');
          w.push(
            v +
              ' @' +
              new Date().toISOString().slice(14, 23) +
              ' ' +
              (new Error().stack.split('\n')[2] || '').trim().replace(/.*\//, '')
          );
          setItem.call(sessionStorage, '__writes', JSON.stringify(w));
        }
        return setItem.call(this, k, v);
      };
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
        if (
          !muted &&
          !restrict &&
          (!opts.video || !opts.video.displaySurface || opts.video.displaySurface === 'monitor')
        )
          throw new DOMException('Could not start audio source', 'NotReadableError');
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const dest = ctx.createMediaStreamDestination();
        // PC d'entreprise (§55) : la copie par processus s'ouvre mais ne laisse rien passer ; la
        // copie de la sortie son rend tout ce qui sort, le signal du test du son compris (§56)
        if (!(muted && restrict)) osc.connect(dest);
        if (muted && !restrict) osc.frequency.value = 1000;
        osc.start();
        const track = dest.stream.getAudioTracks()[0];
        const settings = track.getSettings.bind(track);
        track.getSettings = () => ({ ...settings(), restrictOwnAudio: restrict });
        const video = document.createElement('canvas').captureStream(1).getVideoTracks();
        video[0].getSettings = () => ({ displaySurface: restrict ? 'monitor' : opts.video.displaySurface });
        return new MediaStream([track, ...video]);
      };
    },
    [restrictKnown, !!windows11, !!mutedApps]
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
    fail(
      'réunion suivante : restrictOwnAudio attendu d’emblée : ' +
        JSON.stringify(asked) +
        ' ; ' +
        (await page.evaluate(() =>
          JSON.stringify({
            vues: [...document.querySelectorAll('.view')].filter((v) => !v.hidden).map((v) => v.id),
            dialogues: [...document.querySelectorAll('dialog[open]')].map((d) => d.id),
            avis: document.getElementById('rec-notice').textContent,
            toast: (document.querySelector('.toast') || {}).textContent,
            écritures: JSON.parse(sessionStorage.getItem('__writes') || '[]'),
          })
        ))
    );
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

// 8. PC d'entreprise : son de toutes les applications muet, son du système qui marche (§55)
{
  const { context, page, network } = await open(true, true, true);
  // Choix laissé par la 4.9.0 sur ce PC : le son de toutes les applications
  await page.evaluate(() => localStorage.setItem('lowsper.share.surface', 'apps'));
  await startMeeting(page);
  let asked = await page.evaluate(() => window.__asked);
  if (asked.length !== 1 || !asked[0].audio.restrictOwnAudio)
    fail('PC d’entreprise : restrictOwnAudio attendu d’abord');
  await page.waitForTimeout(10000);
  if (!(await page.isHidden('#rec-notice'))) fail('aucun message attendu avant 20 s');
  await page.waitForSelector('#rec-notice:not([hidden])', { timeout: 20000 });
  const b = await buttons(page);
  console.log('Partage muet :', b.join(' | '));
  if (b[0] !== 'Partager le son du système') fail('« Partager le son du système » attendu en premier');
  if (!/Aucun son n'arrive/.test(await notice(page))) fail('message du partage muet attendu');
  if ((await pref(page)) !== 'apps') fail('le choix ne doit pas changer avant que du son passe');
  await page.click('#rec-notice button[data-mode="screen"]');
  await page.waitForTimeout(1500);
  asked = await page.evaluate(() => window.__asked);
  const last = asked[asked.length - 1];
  if (last.audio !== true) fail('son du système attendu : ' + JSON.stringify(last.audio));
  if (!(await page.isHidden('#rec-notice'))) fail('message attendu masqué une fois le son capté');
  if ((await pref(page)) !== 'system') fail('choix « system » attendu une fois le son entendu : ' + (await pref(page)));
  console.log('Son du système capté et retenu');
  await page.click('#stop');
  await page.waitForSelector('#view-rec[hidden]', { timeout: 120000 }).catch(() => {});
  await page.goto(pathToFileURL(join(root, 'Lowsper.html')).href);
  await page.waitForSelector('#engine[data-state="ready"]', { timeout: 180000 });
  await startMeeting(page);
  asked = await page.evaluate(() => window.__asked);
  if (asked.length !== 1 || asked[0].audio !== true)
    fail('réunion suivante : son du système attendu d’emblée : ' + JSON.stringify(asked));
  await page.waitForTimeout(2000);
  if ((await pref(page)) !== 'system') fail('choix « system » perdu');
  console.log('Réunion suivante : son du système demandé d’emblée');
  if (network.length) fail('requêtes réseau : ' + network.join(', '));
  await context.close();
}

// 9 et 10. Test du son de la réunion, en dehors de toute réunion (§56)
async function soundTest(page) {
  if (await page.isHidden('#sound-check')) fail('ligne « pas encore vérifié » attendue sur l’accueil');
  await page.click('#sound-check-btn');
  await page.waitForSelector('#sound-test[open]');
  await page.click('#sound-test-actions button');
}
const stText = (page) => page.textContent('#sound-test-text');
{
  const { context, page, network } = await open(true, true, true);
  await soundTest(page);
  await page.waitForFunction(() => /arrive bien/.test(document.getElementById('sound-test-text').textContent), null, {
    timeout: 8000,
  });
  const asked = await page.evaluate(() => window.__asked);
  if (asked.length !== 1 || asked[0].audio !== true || asked[0].video.displaySurface !== 'monitor')
    fail('test du son : son du système et écran entier attendus : ' + JSON.stringify(asked));
  if ((await pref(page)) !== 'system') fail('test du son : choix « system » attendu');
  if (!/Teams/.test(await stText(page))) fail('message de réussite attendu');
  await page.click('#sound-test-close');
  if (!(await page.isHidden('#sound-check'))) fail('ligne de l’accueil attendue masquée après le test');
  if ((await page.textContent('#v-sound-test')) !== 'Son du système') fail('valeur « Son du système » attendue');
  console.log('Test du son (PC d’entreprise) : signal revenu par le son du système, chemin retenu');
  if (network.length) fail('requêtes réseau : ' + network.join(', '));
  await context.close();
}
{
  const { context, page, network } = await open(true, true);
  await soundTest(page);
  await page.waitForSelector('#sound-test-actions button');
  if (!/refusé le son du système/.test(await stText(page)))
    fail('refus du son du système attendu : ' + (await stText(page)));
  await page.click('#sound-test-actions button');
  await page.waitForFunction(() => /arrive bien/.test(document.getElementById('sound-test-text').textContent), null, {
    timeout: 35000,
  });
  const asked = await page.evaluate(() => window.__asked);
  if (!asked[asked.length - 1].audio.restrictOwnAudio) fail('son de toutes les applications attendu');
  if ((await pref(page)) !== 'apps') fail('test du son : choix « apps » attendu');
  if ((await page.textContent('#v-sound-test')) !== 'Toutes les applications')
    fail('valeur « Toutes les applications » attendue');
  console.log('Test du son (PC du §51) : son du système refusé, son des applications attesté et retenu');
  if (network.length) fail('requêtes réseau : ' + network.join(', '));
  await context.close();
}

await browser.close();
console.log('Son de la réunion après un refus de Windows : conforme (decision.md §51).');
