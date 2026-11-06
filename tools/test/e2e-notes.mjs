// Test de bout en bout des profils de sortie et de l'écriture des notes, dans la vraie page.
// Le dossier de notes est simulé en mémoire (un vrai accès à un dossier exige un clic humain dans
// la fenêtre du système) ; la logique d'accès de Lowsper, elle, est réellement exercée.
//   1. création d'un profil « Travail » (dossier, nom de fichier, propriétés, liens) dans les
//      paramètres, conservé après rechargement de la page ;
//   2. dossier oublié par le navigateur : l'accueil propose de le désigner à nouveau ;
//   3. import d'un enregistrement : note écrite dans le dossier, avec propriétés et transcript,
//      aucun téléchargement ; voix renommée : la note est réécrite, avec le lien [[Nom]] ;
//   4. accord du navigateur à redemander : repli sur les Téléchargements, puis bouton
//      « Enregistrer aussi dans le dossier » ; nom déjà pris : « (2) » ;
//   5. profil « Par défaut » : format classique, Téléchargements ;
//   6. consignes pour l'IA : celle du profil proposée, consigne modifiée copiée avec la note ;
//   7. aucune requête réseau.
// Prérequis : node build.mjs --embed whisper-small   (CHROMIUM_PATH si besoin)
// Usage : node test/e2e-notes.mjs
import { chromium } from 'playwright-core';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(here, 'output');
const fixtures = join(here, 'fixtures', 'import');
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const context = await browser.newContext({
  // Interface en français : les vérifications portent sur les textes français (decision.md §25)
  locale: 'fr-FR',
  acceptDownloads: true,
  viewport: { width: 900, height: 1000 },
});
const page = await context.newPage();
const network = [];
page.on('request', (r) => {
  if (!/^(file|blob|data):/.test(r.url())) network.push(r.url());
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const downloads = [];
page.on('download', (d) => downloads.push(d));

// Faux dossier de notes, en mémoire de la page : permission « à demander » tant qu'on ne l'accorde pas
await context.addInitScript(() => {
  const files = (window.__vault = new Map());
  window.__perm = 'granted';
  const handle = {
    kind: 'directory',
    name: 'Coffre-notes',
    async queryPermission() {
      return window.__perm;
    },
    async requestPermission() {
      window.__perm = 'granted';
      return 'granted';
    },
    async getFileHandle(name, opts = {}) {
      if (!files.has(name) && !opts.create) throw new DOMException('absent', 'NotFoundError');
      return {
        kind: 'file',
        async createWritable() {
          let text = '';
          return {
            async write(t) {
              text += t;
            },
            async close() {
              files.set(name, text);
            },
          };
        },
      };
    },
  };
  window.showDirectoryPicker = async () => {
    window.__perm = 'granted';
    return handle;
  };
  // Rangement des accès en mémoire (un faux accès ne peut pas aller dans IndexedDB) ; il est perdu
  // au rechargement de la page, comme après un nettoyage du navigateur
  const kept = new Map();
  const patch = () => {
    if (!window.Lowsper || !window.Lowsper.Notes) return setTimeout(patch, 10);
    Object.assign(window.Lowsper.Notes.folders, {
      get: async (id) => kept.get(id) || null,
      put: async (id, dir) => kept.set(id, dir),
      delete: async (id) => kept.delete(id),
    });
  };
  patch();
});

let failed = 0;
const check = (ok, name, detail = '') => {
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail ? ' : ' + detail : ''}`);
  if (!ok) failed++;
};
const vault = () => page.evaluate(() => Object.fromEntries(window.__vault));

async function importFile(name, title) {
  await page.fill('#title', title || '');
  await page.setInputFiles('#import-input', join(fixtures, name));
  await page.waitForSelector('#view-import:not([hidden])');
  await page.waitForSelector('#view-done:not([hidden])', { timeout: 300000 });
  await page.waitForTimeout(500);
}

await page.goto(pathToFileURL(join(root, 'Lowsper.html')).href);
await page.waitForSelector('#engine[data-state="ready"]', { timeout: 300000 });

// 1. Profil « Travail » créé dans les paramètres
await page.click('#settings-open');
await page.click('#prof-new');
await page.fill('#prof-name', 'Travail');
await page.click('#prof-folder-pick');
await page.waitForFunction(() => /Coffre-notes/.test(document.getElementById('prof-folder').textContent));
await page.check('#prof-links');
await page.fill('#prof-tags', 'reunion, travail');
await page.fill('#prof-extra', 'projet: Atlas');
await page.selectOption('#prof-prompt', 'synthese-appel');
// Consigne fournie modifiée dans les paramètres
await page.selectOption('#ai-select', 'actions');
await page.fill('#ai-text', 'Liste les actions de « {{titre}} » :\n\n{{note}}');
const example = await page.textContent('#prof-filename-example');
await page.screenshot({ path: join(out, 'notes-parametres.png'), fullPage: true });
await page.click('#settings-close');
check(/Exemple : \d{4}-\d\d-\d\d Point hebdo\.md/.test(example), 'exemple de nom de fichier', example);
// Accueil : « Enregistrer la note dans », menu dessiné par Lowsper (menu.js)
await page.click('#place-btn');
const places = await page.$$eval('#place-list [role="menuitemradio"]', (b) => b.map((x) => x.textContent));
check(
  places.length === 2 && places.some((t) => /Travail.*Dossier « Coffre-notes »/.test(t)),
  "choix du profil sur l'accueil, avec son dossier",
  places.join(' | ')
);
await page.click('#place-list [role="menuitemradio"]:has-text("Travail")');
check((await page.textContent('#place-current')) === 'Travail', 'profil choisi affiché sur l’accueil');

// 2. Rechargement : le profil reste, l'accès au dossier est oublié
await page.reload();
await page.waitForSelector('#engine[data-state="ready"]', { timeout: 300000 });
const kept = await page.evaluate(() => ({
  name: Lowsper.Notes.current().name,
  folder: Lowsper.Notes.current().folderName,
}));
check(kept.name === 'Travail' && kept.folder === 'Coffre-notes', 'profil et choix conservés après rechargement');
await page.waitForSelector('#profile-access:not([hidden])');
const forgot = await page.textContent('#profile-access');
check(
  /oublié/.test(forgot),
  'accueil : dossier oublié signalé, avec un bouton pour le désigner',
  forgot.trim().slice(0, 80)
);
await page.click('#profile-allow');
await page.waitForSelector('#profile-access', { state: 'hidden' });

// 3. Import : note écrite dans le dossier, puis réécrite après un renommage
await importFile('extrait.m4a', 'Point hebdo');
let files = await vault();
const note = files['2026-03-14 Point hebdo.md'] || '';
check(!!note, 'note écrite dans le dossier, datée du jour de l’enregistrement', Object.keys(files).join(', '));
check(downloads.length === 0, 'aucun téléchargement quand le dossier est accessible');
check(
  /^---\ndate: 2026-03-14\nduree: 1\nintervenants:\n {2}- "Intervenant 1"\n(.|\n)*tags:\n {2}- "reunion"\n {2}- "travail"\nprojet: "Atlas"\n---\n\n# Point hebdo\n/.test(
    note
  ),
  'propriétés YAML, étiquettes et champ libre en tête de note',
  note.slice(0, 160).replace(/\n/g, '⏎')
);
check(/## Transcript\n\n\*\*\[00:00:01\] Intervenant 1 :\*\* Bonjour à tous/.test(note), 'transcript dans la note');
check(
  /Dans le dossier « Coffre-notes »/.test(await page.textContent('#export-info')) &&
    (await page.textContent('#saved-title')) === 'Note enregistrée',
  'écran de fin : « Note enregistrée », avec son emplacement'
);
// Écran de fin en deux colonnes (lot R6) : le texte lisible à gauche, la suite à droite
const layout = await page.evaluate(() => {
  const a = document.querySelector('.done-main').getBoundingClientRect();
  const b = document.querySelector('.done-side').getBoundingClientRect();
  const lines = document.querySelectorAll('#done-lines .done-line').length;
  const raw = /\*\*\[/.test(document.getElementById('done-lines').textContent);
  return { twoCols: a.right <= b.left && Math.abs(a.top - b.top) < 40, lines, raw };
});
check(
  layout.twoCols && layout.lines > 0 && !layout.raw,
  'deux colonnes, texte lisible sans Markdown brut',
  JSON.stringify(layout)
);
// Consigne pour l'IA : celle du profil proposée, une autre choisie, texte copié
await page.evaluate(() => {
  window.__copied = null;
  navigator.clipboard.writeText = async (text) => {
    window.__copied = text;
  };
});
check((await page.textContent('#ai-choice-label')) === "Synthèse d'appel", 'consigne du profil proposée par défaut');
await page.click('#copy-ai');
const call = await page.evaluate(() => window.__copied);
check(
  /^# Rôle\nTu rédiges des synthèses d'appel[\s\S]*\n# Règles\n[\s\S]*\n# Transcript\n---\ndate: 2026-03-14/.test(
    call || ''
  ),
  "« Obtenir un résumé » : prompt système de synthèse d'appel, puis la note"
);
check((await page.textContent('#copy-ai-title')) === 'Copié', '« Obtenir un résumé » devient « Copié »');
// « Voir ce qui est copié » montre exactement le texte copié
await page.click('#ai-see');
check((await page.textContent('#ai-preview')) === call, '« Voir ce qui est copié » : texte exact');
await page.keyboard.press('Escape');
check(!(await page.isVisible('#ai-dialog')), 'fenêtre « Voir ce qui est copié » fermée par Échap');
// Autre consigne : menu dessiné par Lowsper, ouvert au clavier
await page.focus('#ai-choice');
await page.keyboard.press('Enter');
await page.click('#ai-list [role="menuitemradio"]:has-text("Liste d")');
check((await page.textContent('#copy-ai-title')) === 'Obtenir un résumé', 'autre consigne : bouton remis à zéro');
await page.click('#copy-ai');
const actions = await page.evaluate(() => window.__copied);
check(
  /^Liste les actions de « Point hebdo » :\n\n---\ndate:/.test(actions || ''),
  'consigne modifiée, variable rendue, note à la place de {{note}}'
);
// Renommer une voix directement sur une réplique : Échap annule, Entrée valide
await page.click('#done-lines button.chip');
await page.keyboard.type('Zoé');
await page.keyboard.press('Escape');
const undone = await page.textContent('#done-lines button.chip');
check(undone === 'Intervenant 1', 'renommage annulé par Échap', undone);
await page.click('#done-lines button.chip');
await page.keyboard.type('Claire');
await page.keyboard.press('Enter');
const chips = await page.$$eval('#done-lines .chip.others', (els) => els.map((e) => e.textContent));
check(
  chips.length > 0 && chips.every((c) => c === 'Claire'),
  'voix renommée sur toutes ses répliques',
  chips.join(', ')
);
await page.waitForTimeout(3000);
files = await vault();
const updated = files['2026-03-14 Point hebdo.md'] || '';
check(
  /\*\*\[00:00:01\] \[\[Claire\]\] :\*\*/.test(updated) && /- "\[\[Claire\]\]"/.test(updated),
  'voix renommée : note réécrite, avec le lien [[Claire]]'
);
check(Object.keys(files).length === 1, 'la mise à jour réécrit le même fichier');
await page.screenshot({ path: join(out, 'notes-fin.png'), fullPage: true });

// 4. Accord à redemander : repli sur les Téléchargements, puis enregistrement en un clic
await page.click('#again');
check(await page.isVisible('#view-idle'), '« Nouvelle réunion » ramène à l’accueil');
await page.evaluate(() => (window.__perm = 'prompt'));
await importFile('extrait.m4a', 'Point hebdo');
check(downloads.length === 1, 'accord à redemander : note dans les Téléchargements en attendant');
check(
  await page.isVisible('#export-folder'),
  'bouton « Enregistrer aussi dans le dossier »',
  await page.textContent('#export-folder')
);
await page.click('#export-folder');
await page.waitForFunction(() => /dossier « Coffre-notes »/.test(document.getElementById('export-info').textContent));
files = await vault();
check(
  !!files['2026-03-14 Point hebdo (2).md'],
  'nom déjà pris : « (2) », la première note n’est pas écrasée',
  Object.keys(files).join(', ')
);
check(downloads.length === 1, 'pas de second téléchargement');

// 5. Profil « Par défaut » : format classique, Téléchargements
await page.click('#again');
await page.click('#place-btn');
await page.click('#place-list [role="menuitemradio"]:has-text("Par défaut")');
await importFile('extrait.mp3', '');
await page.waitForTimeout(500);
const d = downloads[downloads.length - 1];
const p = join(out, 'notes-' + d.suggestedFilename());
await d.saveAs(p);
const classic = await readFile(p, 'utf8');
check(
  /^reunion_.*_extrait\.md$/.test(d.suggestedFilename()) &&
    classic.startsWith('# Transcript de réunion : extrait\n\n- **Source** : fichier « extrait.mp3 »'),
  'profil « Par défaut » : format et nom classiques',
  d.suggestedFilename()
);

await browser.close();
check(network.length === 0, 'aucune requête réseau', network.join(', '));
if (failed) {
  console.log(`\n${failed} vérification(s) en échec.`);
  process.exit(1);
}
console.log('\nProfils de sortie et notes conformes.');
