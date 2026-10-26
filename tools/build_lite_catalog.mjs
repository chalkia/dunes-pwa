// Κατάλογος φυτών της lite, σε υψηλή ανάλυση.
//
//   npm run lite-catalog                        (φωτογραφίες στο ../plants_photos_hires)
//   npm run lite-catalog -- "D:\άλλος\φάκελος"
//
// Διαβάζει το lite/plants/species.json (ποιες φωτογραφίες, με ποια σειρά, λεζάντες, ζώνες)
// και το credits.csv του φακέλου. Για κάθε φωτογραφία φτιάχνει:
//   lite/plants/<φάκελος>/NN.webp    μεγάλη, 1600 px (πλήρης οθόνη, ζουμ)
//   lite/plants/<φάκελος>/NN_t.webp  μικρογραφία, 360 px (λίστα)
// Γράφει το lite/js/catalog.js και, στο lite/sw.js, τις μικρογραφίες (μπαίνουν στην εγκατάσταση)
// και το όνομα της μνήμης των μεγάλων (κατεβαίνουν με το κουμπί «Ετοίμασε το tablet»).
// Αν λείπει φωτογραφία ή credits: ΣΤΟΠ πριν αλλάξει οποιοδήποτε αρχείο. Μετά: npm run check
import {
  readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, rmSync, statSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(process.argv[2] || join(root, '..', 'plants_photos_hires'));
const BIG = { side: 1600, q: 72 };
const THUMB = { side: 360, q: 68 };

const fail = (msg) => { console.error(`✖ ${msg}`); process.exit(1); };
let sharp;
try { sharp = require('sharp'); } catch { fail('Δεν υπάρχει το sharp. Τρέξε: cd tools && npm install'); }
if (!existsSync(src)) fail(`Δεν βρέθηκε ο φάκελος φωτογραφιών: ${src}`);

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

const cfg = JSON.parse(readFileSync(join(root, 'lite', 'plants', 'species.json'), 'utf8'));
const credPath = join(src, 'credits.csv');
if (!existsSync(credPath)) fail(`Λείπει το ${credPath}`);
const credOf = new Map(parseCsv(readFileSync(credPath, 'utf8')).map((r) => [`${r.folder}/${r.filename}`.toLowerCase(), r]));
const obsId = (r) => ((String(r.observation_url || '').match(/observations\/(\d+)/) || [])[1] || '');
const schema = readFileSync(join(root, 'js', 'schema.js'), 'utf8');
const spBlock = (schema.match(/export const SPECIES = \[([\s\S]*?)\n\];/) || [])[1] || '';
const speciesIds = new Set([...spBlock.matchAll(/\{ id: '([a-z]+)', name:/g)].map((m) => m[1]));

// 1ος γύρος: έλεγχοι.
for (const sp of cfg.species) {
  if (!speciesIds.has(sp.id)) fail(`lite/plants/species.json: το id «${sp.id}» δεν υπάρχει στο SPECIES του js/schema.js.`);
  if (!Array.isArray(sp.photos) || !sp.photos.length) fail(`${sp.folder}: δεν έχει φωτογραφίες στο species.json.`);
  if (!Array.isArray(sp.zones) || sp.zones.some((z) => !(z >= 0 && z <= 4))) fail(`${sp.folder}: λάθος «zones» (0–4).`);
  for (const p of sp.photos) {
    if (!existsSync(join(src, sp.folder, p.file))) fail(`Λείπει η φωτογραφία ${sp.folder}/${p.file}`);
    if (!credOf.has(`${sp.folder}/${p.file}`.toLowerCase())) fail(`Η ${sp.folder}/${p.file} δεν έχει γραμμή στο credits.csv`);
  }
}

// 2ος γύρος: μετατροπή.
const out = [];
const thumbs = [];
let bigBytes = 0;
let thumbBytes = 0;
for (const sp of cfg.species) {
  const dir = join(root, 'lite', 'plants', sp.folder);
  mkdirSync(dir, { recursive: true });
  const photos = [];
  for (let i = 0; i < sp.photos.length; i += 1) {
    const p = sp.photos[i];
    const n = String(i + 1).padStart(2, '0');
    const input = join(src, sp.folder, p.file);
    const big = await sharp(input).rotate().resize({ width: BIG.side, height: BIG.side, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: BIG.q }).toFile(join(dir, `${n}.webp`));
    const th = await sharp(input).rotate().resize({ width: THUMB.side, height: THUMB.side, fit: 'cover' })
      .webp({ quality: THUMB.q }).toFile(join(dir, `${n}_t.webp`));
    bigBytes += big.size;
    thumbBytes += th.size;
    const c = credOf.get(`${sp.folder}/${p.file}`.toLowerCase());
    photos.push({ n, caption: p.caption || '', by: c.photographer, lic: c.license, obs: obsId(c), w: big.width, h: big.height });
    thumbs.push(`./plants/${sp.folder}/${n}_t.webp`);
  }
  readdirSync(dir).filter((f) => !photos.some((p) => f === `${p.n}.webp` || f === `${p.n}_t.webp`)).forEach((f) => rmSync(join(dir, f)));
  out.push({
    id: sp.id, dir: sp.folder, name: sp.name, latin: sp.latin, note: sp.note, zones: sp.zones, photos,
  });
  console.log(`  ${sp.name}: ${photos.length}`);
}
for (const d of readdirSync(join(root, 'lite', 'plants'))) {
  if (statSync(join(root, 'lite', 'plants', d)).isDirectory() && !cfg.species.some((s) => s.folder === d)) {
    rmSync(join(root, 'lite', 'plants', d), { recursive: true });
  }
}

const hash = createHash('sha1').update(JSON.stringify(out)).digest('hex').slice(0, 8);
const js = '// ΠΑΡΑΓΕΤΑΙ ΑΠΟ ΤΟ «npm run lite-catalog» (tools/build_lite_catalog.mjs). Μην το αλλάζεις με το χέρι.\n'
  + '// Φωτογραφίες: plants/<dir>/<n>.webp (μεγάλη) και <n>_t.webp (μικρογραφία).\n'
  + `// Οι μεγάλες φωτογραφίες μπαίνουν σε αυτή τη μνήμη (ίδιο όνομα με το lite/sw.js).\nexport const PLANTS_CACHE = 'lite-plants-${hash}';\n\n`
  + `export const CATALOG = ${JSON.stringify(out, null, 1)};\n\n`
  + 'export const OBS_URL = (id) => `https://www.inaturalist.org/observations/${id}`;\n'
  + 'export const bigUrl = (sp, p) => `plants/${sp.dir}/${p.n}.webp`;\n'
  + 'export const thumbUrl = (sp, p) => `plants/${sp.dir}/${p.n}_t.webp`;\n';
writeFileSync(join(root, 'lite', 'js', 'catalog.js'), js);

const swPath = join(root, 'lite', 'sw.js');
if (existsSync(swPath)) {
  let sw = readFileSync(swPath, 'utf8');
  const re = /( *\/\/ thumbs:start[^\n]*\n)[\s\S]*?( *\/\/ thumbs:end)/;
  if (!re.test(sw)) fail('Στο lite/sw.js λείπουν τα σημάδια // thumbs:start και // thumbs:end.');
  sw = sw.replace(re, (m, a, b) => `${a}${thumbs.map((s) => `  '${s}',\n`).join('')}${b}`);
  sw = sw.replace(/const PLANTS_CACHE = 'lite-plants-[^']*';/, `const PLANTS_CACHE = 'lite-plants-${hash}';`);
  // APP_CACHE = 'lite-shell-<έκδοση κώδικα>-<κατάλογος>': αλλάζει όταν αλλάξουν οι μικρογραφίες.
  sw = sw.replace(/const APP_CACHE = 'lite-shell-([a-z0-9]+)-[0-9a-f]+';/, (m, v) => `const APP_CACHE = 'lite-shell-${v}-${hash}';`);
  writeFileSync(swPath, sw);
}
console.log(`✔ Κατάλογος: ${out.length} είδη, ${thumbs.length} φωτογραφίες. Μεγάλες ${(bigBytes / 1e6).toFixed(1)} MB, μικρογραφίες ${(thumbBytes / 1e6).toFixed(1)} MB.`);
console.log('Τώρα τρέξε: npm run check');
