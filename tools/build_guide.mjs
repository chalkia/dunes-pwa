// Ενημέρωση του οδηγού φυτών από τον φάκελο φωτογραφιών.
//
//   npm run guide                      (φωτογραφίες στο ../plants_photos, δίπλα στο repo)
//   npm run guide -- "D:\άλλος\φάκελος"  (φωτογραφίες αλλού)
//
// Τι κάνει:
//  1. Για κάθε είδος του plants/species.json διαβάζει τον φάκελό του (π.χ. plants_photos/Cakile_maritima).
//     Παίρνει ΟΛΕΣ τις εικόνες .jpg/.jpeg/.png, με σειρά ονόματος. Όσες είναι στο «exclude» μένουν έξω.
//  2. Για κάθε φωτογραφία βρίσκει τον δημιουργό και την άδεια στο plants_photos/credits.csv.
//     Φωτογραφία χωρίς γραμμή στο credits.csv = ΣΤΟΠ (δεν μπαίνει φωτογραφία χωρίς άδεια).
//  3. Μικραίνει (720 px, JPEG) στο plants/<φάκελος>/01.jpg, 02.jpg… και σβήνει όσες περισσεύουν.
//  4. Γράφει το js/guide.js και τη λίστα φωτογραφιών στο SHELL του sw.js (για χωρίς σύνδεση).
//     Αλλάζει και την έκδοση της μνήμης του service worker, ώστε τα tablet να πάρουν τις νέες φωτογραφίες.
// Μετά: npm run check
import {
  readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, rmSync, statSync,
} from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(process.argv[2] || join(root, '..', 'plants_photos'));
const MAX_SIDE = 720;
const QUALITY = 78;
const IMG = new Set(['.jpg', '.jpeg', '.png']);

const fail = (msg) => { console.error(`✖ ${msg}`); process.exit(1); };
const warn = [];

let sharp;
try {
  sharp = require('sharp');
} catch {
  fail('Δεν υπάρχει το sharp. Τρέξε: cd tools && npm install');
}

if (!existsSync(src)) fail(`Δεν βρέθηκε ο φάκελος φωτογραφιών: ${src}`);
const cfgPath = join(root, 'plants', 'species.json');
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));

// ---- credits.csv (με εισαγωγικά και κόμματα μέσα σε πεδία) ----
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  const t = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < t.length; i += 1) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  const head = rows.shift().map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}

const credPath = join(src, 'credits.csv');
if (!existsSync(credPath)) fail(`Λείπει το ${credPath}`);
const credits = parseCsv(readFileSync(credPath, 'utf8'));
for (const col of ['folder', 'filename', 'photographer', 'license']) {
  if (!credits.length || !(col in credits[0])) fail(`Το credits.csv πρέπει να έχει στήλη «${col}».`);
}
const credOf = new Map(credits.map((r) => [`${r.folder}/${r.filename}`.toLowerCase(), r]));
const obsId = (r) => {
  const m = String(r.observation_url || '').match(/observations\/(\d+)/);
  return m ? m[1] : '';
};

// ---- είδη του schema.js ----
const schema = readFileSync(join(root, 'js', 'schema.js'), 'utf8');
const spBlock = (schema.match(/export const SPECIES = \[([\s\S]*?)\n\];/) || [])[1];
if (!spBlock) fail('Δεν βρέθηκε το SPECIES στο js/schema.js.');
const speciesIds = new Set([...spBlock.matchAll(/\{ id: '([a-z]+)', name:/g)].map((m) => m[1]));

// 1ος γύρος: μόνο έλεγχοι. Αν κάτι λείπει, σταματά ΠΡΙΝ αλλάξει οποιοδήποτε αρχείο.
const plan = [];
for (const sp of cfg.species) {
  if (!speciesIds.has(sp.id)) fail(`plants/species.json: το id «${sp.id}» δεν υπάρχει στο SPECIES του js/schema.js.`);
  const dir = join(src, sp.folder);
  if (!existsSync(dir)) fail(`Λείπει ο φάκελος ${dir} (είδος ${sp.name}).`);
  const exclude = new Set((sp.exclude || []).map((x) => x.toLowerCase()));
  const files = readdirSync(dir)
    .filter((f) => IMG.has(extname(f).toLowerCase()) && statSync(join(dir, f)).isFile())
    .filter((f) => !exclude.has(f.toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  if (!files.length) fail(`Ο φάκελος ${sp.folder} δεν έχει φωτογραφίες (ή είναι όλες στο exclude).`);
  if (files.length > 12) warn.push(`${sp.folder}: ${files.length} φωτογραφίες. Πολλές για tablet· προτείνεται ως 10.`);
  const noCred = files.filter((f) => !credOf.has(`${sp.folder}/${f}`.toLowerCase()));
  if (noCred.length) {
    fail(`Φωτογραφίες χωρίς γραμμή στο credits.csv (${sp.folder}): ${noCred.join(', ')}\n`
      + '  Πρόσθεσε γραμμή με folder, filename, photographer, license (για δικές σας: photographer = όνομα σχολείου, license = CC-BY).');
  }
  plan.push({ sp, dir, files });
}

// 2ος γύρος: μίκρυνση και εγγραφή.
const guide = [];
const shell = [];
let total = 0;
let bytes = 0;
for (const { sp, dir, files } of plan) {
  const outDir = join(root, 'plants', sp.folder);
  mkdirSync(outDir, { recursive: true });
  const photos = [];
  for (let i = 0; i < files.length; i += 1) {
    const name = `${String(i + 1).padStart(2, '0')}.jpg`;
    const out = join(outDir, name);
    const info = await sharp(join(dir, files[i])).rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: QUALITY, mozjpeg: true }).toFile(out);
    bytes += info.size;
    const c = credOf.get(`${sp.folder}/${files[i]}`.toLowerCase());
    photos.push([name, c.photographer, c.license, obsId(c)]);
    shell.push(`./plants/${sp.folder}/${name}`);
  }
  // Σβήσιμο παλιών αρχείων που περισσεύουν.
  readdirSync(outDir).filter((f) => !photos.some((p) => p[0] === f)).forEach((f) => rmSync(join(outDir, f)));
  total += photos.length;
  guide.push({ ...sp, photos });
  console.log(`  ${sp.name}: ${photos.length} φωτογραφίες`);
}
// Φάκελοι στο plants/ που δεν είναι πια στον οδηγό.
for (const d of readdirSync(join(root, 'plants'))) {
  if (statSync(join(root, 'plants', d)).isDirectory() && !cfg.species.some((s) => s.folder === d)) {
    rmSync(join(root, 'plants', d), { recursive: true });
    console.log(`  σβήστηκε ο παλιός φάκελος plants/${d}`);
  }
}
const missing = [...speciesIds].filter((id) => !cfg.species.some((s) => s.id === id));
if (missing.length) warn.push(`Είδη χωρίς φωτογραφίες στον οδηγό: ${missing.join(', ')}`);

// ---- js/guide.js ----
const J = (v) => JSON.stringify(v);
let js = '// ΠΑΡΑΓΕΤΑΙ ΑΠΟ ΤΟ «npm run guide» (tools/build_guide.mjs). Μην το αλλάζεις με το χέρι:\n'
  + '// άλλαξε τις φωτογραφίες στο plants_photos ή τα κείμενα στο plants/species.json και τρέξε ξανά.\n'
  + '// Φωτογραφίες: plants/<φάκελος>/<αριθμός>.jpg · [αρχείο, δημιουργός, άδεια, παρατήρηση iNaturalist]\n'
  + 'export const GUIDE = [\n';
for (const g of guide) {
  js += `  { id: ${J(g.id)}, dir: ${J(g.folder)}, name: ${J(g.name)}, latin: ${J(g.latin)}, note: ${J(g.note)},\n    photos: [\n`;
  g.photos.forEach((p) => { js += `      [${p.map(J).join(', ')}],\n`; });
  js += '    ] },\n';
}
js += ']\n\nexport const OBS_URL = (id) => `https://www.inaturalist.org/observations/${id}`;\n';
writeFileSync(join(root, 'js', 'guide.js'), js);

// ---- sw.js: λίστα φωτογραφιών + νέα έκδοση μνήμης ----
const swPath = join(root, 'sw.js');
let sw = readFileSync(swPath, 'utf8');
const re = /( *\/\/ plants:start[^\n]*\n)[\s\S]*?( *\/\/ plants:end)/;
if (!re.test(sw)) fail('Στο sw.js λείπουν τα σημάδια // plants:start και // plants:end.');
sw = sw.replace(re, (m, a, b) => `${a}${shell.map((s) => `  '${s}',\n`).join('')}${b}`);
const hash = createHash('sha1').update(js).digest('hex').slice(0, 8);
sw = sw.replace(/const APP_CACHE = 'dunes-shell-[^']*';/, `const APP_CACHE = 'dunes-shell-g${hash}';`);
writeFileSync(swPath, sw);

console.log(`✔ Οδηγός: ${guide.length} είδη, ${total} φωτογραφίες, ${(bytes / 1e6).toFixed(1)} MB. Μνήμη: dunes-shell-g${hash}`);
warn.forEach((w) => console.log(`⚠ ${w}`));
console.log('Τώρα τρέξε: npm run check');
