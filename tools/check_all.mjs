// Φύλακες πριν από κάθε commit / deploy. Τρέχει: node tools/check_all.mjs
// 1. σύνταξη  2. εισαγωγές/εξαγωγές  3. ανύπαρκτα στοιχεία HTML  4. service worker (αρχεία, κρυφή μνήμη)
// 5. στήλες εξαγωγής  6. ESLint no-undef (μεταβλητές)
// Μηδέν ευρήματα, αλλιώς exit 1. Ποτέ μη «κρύβεις» εύρημα: διόρθωσε τον κώδικα ή τον φύλακα.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const findings = [];
const add = (guard, msg) => findings.push(`[${guard}] ${msg}`);
const read = (p) => readFileSync(join(root, p), 'utf8');

const jsFiles = readdirSync(join(root, 'js')).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`);

// 1. Σύνταξη. Οι unit του js/ είναι modules, το sw.js είναι κλασικό script.
for (const f of jsFiles) {
  const r = spawnSync('node', ['--input-type=module', '--check'], { input: read(f), encoding: 'utf8' });
  if (r.status !== 0) add('σύνταξη', `${f}: ${r.stderr.split('\n').slice(0, 4).join(' ')}`);
}
{
  const r = spawnSync('node', ['--check', join(root, 'sw.js')], { encoding: 'utf8' });
  if (r.status !== 0) add('σύνταξη', `sw.js: ${r.stderr.split('\n').slice(0, 4).join(' ')}`);
}

// 2. Κάθε import { a, b } from './x.js' πρέπει να υπάρχει ως export στο x.js.
function exportsOf(src) {
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => names.add(s.split(/\s+as\s+/).pop().trim()));
  }
  return names;
}
for (const f of jsFiles) {
  const src = read(f);
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(\.\/[^']+)'/g)) {
    const target = `js/${m[2].replace('./', '')}`;
    if (!existsSync(join(root, target))) { add('εισαγωγές', `${f}: λείπει το αρχείο ${target}`); continue; }
    const have = exportsOf(read(target));
    m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => {
      const name = s.split(/\s+as\s+/)[0].trim();
      if (!have.has(name)) add('εισαγωγές', `${f}: το ${name} δεν εξάγεται από ${target}`);
    });
  }
}

// 3. Στοιχεία HTML: κάθε id που ζητείται πρέπει να ορίζεται (στο index.html ή σε template της JavaScript).
{
  const html = read('index.html');
  const defined = new Set();
  const all = [html, ...jsFiles.map(read)];
  all.forEach((s) => {
    for (const m of s.matchAll(/\bid=\\?["']([A-Za-z0-9_-]+)\\?["']/g)) defined.add(m[1]);
    for (const m of s.matchAll(/\.id\s*=\s*['"]([^'"]+)['"]/g)) defined.add(m[1]);
  });
  for (const f of jsFiles) {
    const s = read(f);
    const asked = [];
    for (const m of s.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) asked.push(m[1]);
    for (const m of s.matchAll(/\$\(\s*['"]([^'"]+)['"]\s*\)/g)) asked.push(m[1]);
    for (const m of s.matchAll(/querySelector(?:All)?\(\s*['"]#([A-Za-z0-9_-]+)/g)) asked.push(m[1]);
    asked.forEach((id) => { if (!defined.has(id)) add('στοιχεία HTML', `${f}: ζητά #${id} που δεν ορίζεται πουθενά`); });
  }
}

// 4. Service worker.
{
  const sw = read('sw.js');
  const shellBlock = sw.match(/const SHELL = \[([\s\S]*?)\];/);
  if (!shellBlock) add('service worker', 'δεν βρέθηκε η λίστα SHELL');
  else {
    const list = [...shellBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    list.forEach((p) => {
      const file = p === './' ? 'index.html' : p.replace('./', '');
      if (!existsSync(join(root, file))) add('service worker', `το SHELL αναφέρει ${p} που δεν υπάρχει (θα ακυρωθεί όλη η εγκατάσταση)`);
    });
    const inShell = new Set(list.map((p) => p.replace('./', '')));
    // Κάθε φωτογραφία του οδηγού φυτών πρέπει να υπάρχει και να είναι στο SHELL.
    const spBlock = (read('js/schema.js').match(/export const SPECIES = \[([\s\S]*?)\n\];/) || [])[1] || '';
    const spIds = new Set([...spBlock.matchAll(/\{ id: '([a-z]+)', name:/g)].map((m) => m[1]));
    // Ο οδηγός πρέπει να συμφωνεί με το plants/species.json (αλλιώς ξέχασες το «npm run guide»).
    const cfg = JSON.parse(read('plants/species.json'));
    const gIds = [...read('js/guide.js').matchAll(/\{ id: "([^"]+)"/g)].map((m) => m[1]);
    if (cfg.species.map((x) => x.id).join() !== gIds.join()) add('οδηγός φυτών', 'το js/guide.js δεν ταιριάζει με το plants/species.json. Τρέξε: npm run guide');
    for (const m of read('js/guide.js').matchAll(/\{ id: "([^"]+)"/g)) {
      if (!spIds.has(m[1])) add('οδηγός φυτών', `το είδος ${m[1]} του οδηγού δεν υπάρχει στο SPECIES του schema.js`);
    }
    const guideSrc = read('js/guide.js');
    for (const m of guideSrc.matchAll(/dir: "([^"]+)"[\s\S]*?photos: \[([\s\S]*?)\] \}/g)) {
      for (const pm of m[2].matchAll(/\["(\d+\.jpg)"/g)) {
        const rel = `plants/${m[1]}/${pm[1]}`;
        if (!existsSync(join(root, rel))) add('οδηγός φυτών', `λείπει η φωτογραφία ${rel}`);
        if (!inShell.has(rel)) add('οδηγός φυτών', `${rel} λείπει από το SHELL`);
      }
    }
    [...jsFiles, 'css/app.css', 'index.html', 'manifest.webmanifest', 'lib/leaflet/leaflet.js', 'lib/leaflet/leaflet.css', 'lib/jszip.min.js']
      .forEach((f) => { if (!inShell.has(f)) add('service worker', `το ${f} λείπει από το SHELL, δεν θα δουλεύει εκτός σύνδεσης`); });
    const man = JSON.parse(read('manifest.webmanifest'));
    man.icons.forEach((i) => { if (!existsSync(join(root, i.src))) add('manifest', `λείπει το εικονίδιο ${i.src}`); });
  }
  const tileA = sw.match(/const TILE_CACHE = '([^']+)'/);
  const tileB = read('js/map.js').match(/export const TILE_CACHE = '([^']+)'/);
  if (!tileA || !tileB || tileA[1] !== tileB[1]) add('service worker', 'το TILE_CACHE διαφέρει ανάμεσα σε sw.js και js/map.js');
  const hosts = [...sw.matchAll(/TILE_HOSTS = \[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  for (const m of read('js/map.js').matchAll(/url:\s*'https:\/\/([^/']+)/g)) {
    if (!hosts.includes(m[1])) add('service worker', `ο διακομιστής χάρτη ${m[1]} δεν υπάρχει στο TILE_HOSTS του sw.js`);
  }
  const html = read('index.html');
  for (const m of html.matchAll(/(?:src|href)="((?:css|js|lib|icons)\/[^"]+)"/g)) {
    if (!existsSync(join(root, m[1]))) add('index.html', `λείπει το αρχείο ${m[1]}`);
  }
}

// 5. Στήλες εξαγωγής: κάθε στήλη πρέπει να παίρνει τιμή από τον κώδικα εξαγωγής.
{
  const url = (p) => pathToFileURL(join(root, p)).href;
  const schema = await import(url('js/schema.js'));
  const rows = await import(url('js/rows.js'));
  const t = {
    id: 't1', school: 'Σχ', team: 'Α', members: 'x', beach: 'Πρέβελη', datetime: '2026-10-29T10:30', weather: 'ήλιος',
    length_m: 60, spacing_m: 10, start: { lat: 35.3696, lon: 24.5120, src: 'gps', acc: 5 }, end: { lat: 35.3697, lon: 24.5126, src: 'map' }, notes: '',
    health: { scores: { cover: 1, lilies: 2, zonation: 1, invasive: 2, pressure: 0 }, why: { cover: 'x' }, impressions: ['a', 'b', 'c'], proposal: 'p' },
  };
  const p = {
    id: 'p1', transectId: 't1', kind: 'quadrat', ts: new Date().toISOString(), dist_m: 10, zone: 2, bare_pct: 40, litter_pct: 10, plants_pct: 50,
    invasive_pct: 5, species: ['krinaki'], species_other: 'Α1', species_count: 3, lilies: 2, footprint: 'yes', comment: 'c', pos: null, photoIds: ['f1'],
  };
  const t2 = { ...t, id: 't2', mode: 'plots', start: null, end: null };
  const p2 = {
    id: 'p2', transectId: 't2', kind: 'quadrat', ts: p.ts, dist_m: null, plot: 3, zone: null, species: [], photoIds: ['f2'], topPhotoId: 'f2',
    pos: { lat: 35.37, lon: 24.51, src: 'manual' }, pins: [{ x: 0.2, y: 0.4, species: 'krinaki', other: '', note: 'ανθισμένο' }, { x: 0.5, y: 0.5, species: null, other: 'Α1', note: '' }],
  };
  const data = {
    transects: [t, t2],
    points: [p, p2],
    photos: [{ id: 'f1', pointId: 'p1', transectId: 't1', ts: p.ts, kind: 'quadrat' }, { id: 'f2', pointId: 'p2', transectId: 't2', ts: p.ts, kind: 'quadrat' }],
  };
  const names = rows.assignPhotoNames(data);
  const out = rows.buildRows(data, names);
  out.points.forEach((r) => schema.POINT_COLUMNS.forEach((c) => { if (r[c.key] === undefined) add('στήλες', `points: η στήλη ${c.key} δεν παίρνει τιμή`); }));
  out.transects.forEach((r) => schema.TRANSECT_COLUMNS.forEach((c) => { if (r[c.key] === undefined) add('στήλες', `transects: η στήλη ${c.key} δεν παίρνει τιμή`); }));
  const extra = Object.keys(out.points[0]).filter((k) => !schema.POINT_COLUMNS.some((c) => c.key === k));
  if (extra.length) add('στήλες', `points: το row έχει πεδία χωρίς στήλη: ${extra.join(', ')}`);
  const r2 = out.points.find((r) => r.id === 'p2');
  if (!r2 || r2.name !== 'Πλαίσιο 3' || r2.plot !== 3) add('πλαίσια', 'το πλαίσιο δεν ονομάζεται «Πλαίσιο 3» στην εξαγωγή');
  if (!r2 || r2.pins !== '1: Κρινάκι της θάλασσας (ανθισμένο); 2: Α1') add('πλαίσια', `λάθος στήλη πινεζών: «${r2 && r2.pins}»`);
  if (!r2 || !/κάτοψη_πινέζες\.jpg/.test(r2.photos.split(' | ')[0])) add('πλαίσια', `η εικόνα με πινέζες δεν είναι πρώτη στις φωτογραφίες: «${r2 && r2.photos}»`);
  if (!r2 || r2.pos_source !== 'με αριθμούς') add('πλαίσια', 'η θέση «με αριθμούς» δεν φαίνεται στην εξαγωγή');
  if (out.transects.find((r) => r.id === 't2').mode !== 'Πλαίσια έρευνας') add('πλαίσια', 'ο τρόπος έρευνας δεν φαίνεται στο transects.csv');
  const kml = rows.toKml(data, out, names);
  if (!kml.includes('<Placemark>')) add('στήλες', 'το KML δεν έχει Placemark');
  if (!/Θίνες_|Πρέβελη/.test([...names.values()].join(' ')) && ![...names.values()][0].includes('T10')) add('στήλες', 'το όνομα φωτογραφίας δεν περιέχει T10');
}

// 5β. Περιοχές: κατάλογος, κωδικοποίηση QR, συντεταγμένες, καθολικές βιβλιοθήκες.
{
  const url = (p) => pathToFileURL(join(root, p)).href;
  const area = await import(url('js/area.js'));
  const rows = await import(url('js/rows.js'));
  let cat = null;
  try { cat = JSON.parse(read('areas/areas.json')); } catch (e) { add('περιοχές', `το areas/areas.json δεν είναι σωστό JSON: ${e.message}`); }
  if (cat) {
    const seen = new Set();
    (cat.areas || []).forEach((a, i) => {
      const err = area.validArea(a);
      if (err) add('περιοχές', `areas.json, περιοχή ${i + 1} (${a.code}): ${err}`);
      if (seen.has(a.code)) add('περιοχές', `areas.json: ο κωδικός ${a.code} υπάρχει δύο φορές`);
      seen.add(a.code);
      if (!err) {
        const back = area.decodeArea(area.encodeArea(a));
        if (back.code !== a.code || back.name !== a.name || back.poly.length !== a.poly.length
          || back.poly.some((p, j) => Math.abs(p[0] - a.poly[j][0]) > 1e-5 || Math.abs(p[1] - a.poly[j][1]) > 1e-5)) {
          add('περιοχές', `η κωδικοποίηση QR αλλοιώνει την περιοχή ${a.code}`);
        }
        const h = area.parseHash(`#area=${area.encodeArea(a)}`);
        if (!h || !h.area || h.area.code !== a.code) add('περιοχές', `ο σύνδεσμος #area= δεν διαβάζεται για ${a.code}`);
        const data = { area: a, transects: [], points: [], photos: [] };
        const gj = rows.toGeoJson(data, { points: [] });
        if (gj.features[0].geometry.type !== 'Polygon') add('περιοχές', 'το GeoJSON δεν έχει το πολύγωνο της περιοχής');
        if (!rows.toKml(data, { points: [] }, new Map()).includes('<Polygon>')) add('περιοχές', 'το KML δεν έχει το πολύγωνο της περιοχής');
      }
    });
  }
  if (area.coordPrefix(35.3797) !== '35.3' || area.coordPrefix(24.51) !== '24.5' || area.coordPrefix(-0.05) !== '0.0') add('συντεταγμένες', 'λάθος προσυμπλήρωση ως το 1ο δεκαδικό');
  if (area.parseCoord('35,37142', 90) !== 35.37142 || area.parseCoord('135', 90) !== null || area.parseCoord('3a', 90) !== null) add('συντεταγμένες', 'λάθος ανάγνωση αριθμού συντεταγμένης');
  if (area.normCode('reth 26') !== 'RETH26') add('περιοχές', 'λάθος κανονικοποίηση κωδικού');
  // Κάθε καθολική βιβλιοθήκη του ESLint πρέπει να φορτώνεται από το index.html και να είναι στο SHELL.
  const html = read('index.html');
  const sw = read('sw.js');
  const libs = { L: 'lib/leaflet/leaflet.js', JSZip: 'lib/jszip.min.js', qrcode: 'lib/qrcode.js', jsQR: 'lib/jsQR.js' };
  const cfg = read('tools/eslint.config.mjs');
  for (const m of cfg.matchAll(/\b([A-Za-z]+): 'readonly'/g)) {
    const f = libs[m[1]];
    if (!f) { add('βιβλιοθήκες', `η καθολική ${m[1]} δεν έχει γνωστό αρχείο στο check_all.mjs`); continue; }
    if (!html.includes(`src="${f}"`)) add('βιβλιοθήκες', `το index.html δεν φορτώνει το ${f} (καθολική ${m[1]})`);
    if (!sw.includes(`'./${f}'`)) add('βιβλιοθήκες', `το ${f} λείπει από το SHELL`);
  }
  if (!sw.includes("'./areas/areas.json'")) add('service worker', 'το areas/areas.json λείπει από το SHELL');
  // Η δημοσίευση (GitHub Actions) πρέπει να αντιγράφει κάθε φάκελο/αρχείο που ζητά το SHELL.
  const wf = read('.github/workflows/pages.yml');
  const cp = (wf.match(/cp -r ([^\n]+) _site\//) || [])[1];
  if (!cp) add('δημοσίευση', 'δεν βρέθηκε η εντολή cp -r στο pages.yml');
  else {
    const shipped = new Set(cp.trim().split(/\s+/));
    const shellBlock = sw.match(/const SHELL = \[([\s\S]*?)\];/);
    const tops = new Set([...shellBlock[1].matchAll(/'\.\/([^'/]+)/g)].map((m) => m[1]));
    tops.forEach((t) => { if (!shipped.has(t)) add('δημοσίευση', `το pages.yml δεν αντιγράφει το «${t}» που χρειάζεται το SHELL`); });
  }
}

// 5γ. Εικονίδια: μόνο Font Awesome. Καμία εμοτζί στις οθόνες, και κάθε fa-* να υπάρχει στη γραμματοσειρά.
{
  const faCss = read('lib/fa/css/fontawesome.min.css');
  const known = new Set([...faCss.matchAll(/\.fa-([a-z0-9-]+):(?::)?before/g)].map((m) => m[1]));
  const modifiers = new Set(['solid', 'regular', 'brands', 'fw', 'spin', 'pulse', 'lg', 'xl', 'sm', 'xs', '2x', '3x', 'beat', 'bounce', 'fade', 'flip', 'shake']);
  if (known.size < 1000) add('εικονίδια', `το fontawesome.min.css έχει μόνο ${known.size} εικονίδια — λάθος αρχείο;`);
  const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{25A0}-\u{25FF}\u{2300}-\u{23FF}\u{21B0}-\u{21FF}\u{2195}-\u{21AF}\u{FF0B}\u{FE0F}]/u;
  const files = ['index.html', ...jsFiles.filter((f) => !f.endsWith('guide.js'))];
  for (const f of files) {
    const src = read(f);
    src.split('\n').forEach((line, i) => {
      if (/^\s*\/\//.test(line)) return; // σχόλια
      const m = line.match(emoji);
      if (m) add('εικονίδια', `${f}:${i + 1}: σύμβολο «${m[0]}» αντί για εικονίδιο Font Awesome`);
    });
    const names = [
      ...[...src.matchAll(/\bfa-([a-z0-9-]+)/g)].map((m) => m[1]),
      ...[...src.matchAll(/\bic\('([a-z0-9-]+)'/g)].map((m) => m[1]),
    ];
    names.filter((n) => !modifiers.has(n) && !known.has(n)).forEach((n) => add('εικονίδια', `${f}: το εικονίδιο fa-${n} δεν υπάρχει στο Font Awesome Free`));
  }
  // Οι γραμματοσειρές που ζητούν τα CSS του Font Awesome πρέπει να είναι στο SHELL (αλλιώς χωρίς σύνδεση: κουτάκια).
  const sw = read('sw.js');
  for (const css of ['lib/fa/css/solid.min.css', 'lib/fa/css/regular.min.css']) {
    if (!read('index.html').includes(`href="${css}"`)) add('εικονίδια', `το index.html δεν φορτώνει το ${css}`);
    for (const m of read(css).matchAll(/url\(\.\.\/webfonts\/([^)]+\.woff2)\)/g)) {
      const rel = `lib/fa/webfonts/${m[1]}`;
      if (!existsSync(join(root, rel))) add('εικονίδια', `λείπει το ${rel}`);
      if (!sw.includes(`'./${rel}'`)) add('εικονίδια', `το ${rel} λείπει από το SHELL`);
    }
  }
}

// 7. Lite (φάκελος lite/): ίδιοι φύλακες, με διαδρομές σχετικές με το lite/.
{
  const L = 'lite';
  const liteJs = readdirSync(join(root, L, 'js')).filter((f) => f.endsWith('.js')).map((f) => `${L}/js/${f}`);
  for (const f of liteJs) {
    const r = spawnSync('node', ['--input-type=module', '--check'], { input: read(f), encoding: 'utf8' });
    if (r.status !== 0) add('lite σύνταξη', `${f}: ${r.stderr.split('\n').slice(0, 4).join(' ')}`);
  }
  { const r = spawnSync('node', ['--check', join(root, L, 'sw.js')], { encoding: 'utf8' }); if (r.status !== 0) add('lite σύνταξη', `lite/sw.js: ${r.stderr.split('\n').slice(0, 3).join(' ')}`); }
  // Εισαγωγές (και προς ../../js). Μαζεύουμε και όλα τα modules που χρειάζεται η lite.
  const need = new Set();
  const visit = (f) => {
    if (need.has(f)) return;
    need.add(f);
    const src = read(f);
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(\.{1,2}\/[^']+)'/g)) {
      const target = join(dirname(f), m[2]).replace(/\\/g, '/');
      if (!existsSync(join(root, target))) { add('lite εισαγωγές', `${f}: λείπει το ${target}`); continue; }
      const have = exportsOf(read(target));
      m[1].split(',').map((x) => x.trim()).filter(Boolean).forEach((x) => {
        const name = x.split(/\s+as\s+/)[0].trim();
        if (!have.has(name)) add('lite εισαγωγές', `${f}: το ${name} δεν εξάγεται από ${target}`);
      });
      visit(target);
    }
  };
  visit(`${L}/js/app.js`);
  liteJs.forEach((f) => { if (!need.has(f)) add('lite', `το ${f} δεν το χρησιμοποιεί κανείς`); });
  // Στοιχεία HTML.
  const html = read(`${L}/index.html`);
  const defined = new Set();
  [html, ...liteJs.map(read)].forEach((x) => { for (const m of x.matchAll(/\bid=\\?["']([A-Za-z0-9_-]+)\\?["']/g)) defined.add(m[1]); });
  for (const f of liteJs) {
    const x = read(f);
    for (const m of x.matchAll(/(?:getElementById|\$)\(\s*['"]([^'"]+)['"]\s*\)/g)) if (!defined.has(m[1])) add('lite στοιχεία HTML', `${f}: ζητά #${m[1]}`);
  }
  // Service worker της lite.
  const sw = read(`${L}/sw.js`);
  const list = [...(sw.match(/const SHELL = \[([\s\S]*?)\];/) || ['', ''])[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const rel = (pth) => join(L, pth === './' ? 'index.html' : pth).replace(/\\/g, '/');
  const inShell = new Set(list.map(rel));
  list.forEach((pth) => { if (!existsSync(join(root, rel(pth)))) add('lite service worker', `το SHELL αναφέρει ${pth} που δεν υπάρχει`); });
  need.forEach((f) => { if (!inShell.has(f)) add('lite service worker', `το ${f} λείπει από το SHELL της lite`); });
  for (const m of html.matchAll(/(?:src|href)="([^"#:]+\.(?:js|css|webmanifest|svg|png))"/g)) {
    const f = join(L, m[1]).replace(/\\/g, '/');
    if (!existsSync(join(root, f))) add('lite index.html', `λείπει το ${m[1]}`);
    else if (!inShell.has(f) && !m[1].startsWith('js/app.js')) add('lite service worker', `το ${m[1]} (index.html) λείπει από το SHELL`);
  }
  for (const css of ['../lib/fa/css/solid.min.css', '../lib/fa/css/regular.min.css']) {
    for (const m of read(join(L, css)).matchAll(/url\(\.\.\/webfonts\/([^)]+\.woff2)\)/g)) {
      if (!sw.includes(`'../lib/fa/webfonts/${m[1]}'`)) add('lite service worker', `η γραμματοσειρά ${m[1]} λείπει από το SHELL`);
    }
  }
  const tl = sw.match(/const TILE_CACHE = '([^']+)'/);
  const tm = read('js/map.js').match(/export const TILE_CACHE = '([^']+)'/);
  if (!tl || !tm || tl[1] !== tm[1]) add('lite service worker', 'το TILE_CACHE της lite διαφέρει από το js/map.js (οι χάρτες δεν θα είναι κοινοί)');
  const pc1 = (sw.match(/const PLANTS_CACHE = '([^']+)'/) || [])[1];
  const cat = read(`${L}/js/catalog.js`);
  const pc2 = (cat.match(/export const PLANTS_CACHE = '([^']+)'/) || [])[1];
  if (!pc1 || pc1 !== pc2) add('lite κατάλογος', 'το PLANTS_CACHE διαφέρει ανάμεσα σε lite/sw.js και lite/js/catalog.js. Τρέξε: npm run lite-catalog');
  if (!/k\.startsWith\('lite-shell-'\)/.test(sw) || /keys\.filter\(\(k\) => k !== APP_CACHE/.test(sw)) add('lite service worker', 'το activate πρέπει να σβήνει μόνο μνήμες lite-*');
  if (!/k\.startsWith\('dunes-shell-'\)/.test(read('sw.js'))) add('service worker', 'το activate της πλήρους πρέπει να σβήνει μόνο μνήμες dunes-shell-* (αλλιώς σβήνει τη lite)');
  // Κατάλογος: κάθε φωτογραφία υπάρχει, οι μικρογραφίες είναι στο SHELL, τα είδη υπάρχουν στο SPECIES.
  const spBlock = (read('js/schema.js').match(/export const SPECIES = \[([\s\S]*?)\n\];/) || [])[1] || '';
  const spIds = new Set([...spBlock.matchAll(/\{ id: '([a-z]+)', name:/g)].map((m) => m[1]));
  const CATALOG = JSON.parse((cat.match(/export const CATALOG = (\[[\s\S]*?\]);\n/) || [])[1] || '[]');
  if (!CATALOG.length) add('lite κατάλογος', 'το CATALOG είναι άδειο');
  const cfg = JSON.parse(read(`${L}/plants/species.json`));
  if (cfg.species.map((x) => `${x.id}:${x.photos.length}`).join() !== CATALOG.map((x) => `${x.id}:${x.photos.length}`).join()) add('lite κατάλογος', 'το catalog.js δεν ταιριάζει με το lite/plants/species.json. Τρέξε: npm run lite-catalog');
  for (const sp of CATALOG) {
    if (!spIds.has(sp.id)) add('lite κατάλογος', `το είδος ${sp.id} δεν υπάρχει στο SPECIES`);
    for (const ph of sp.photos) {
      const big = `${L}/plants/${sp.dir}/${ph.n}.webp`;
      const th = `${L}/plants/${sp.dir}/${ph.n}_t.webp`;
      if (!existsSync(join(root, big))) add('lite κατάλογος', `λείπει το ${big}`);
      if (!existsSync(join(root, th))) add('lite κατάλογος', `λείπει το ${th}`);
      if (!inShell.has(th)) add('lite κατάλογος', `${th} λείπει από το SHELL`);
      if (!ph.by || !ph.lic) add('lite κατάλογος', `${big}: χωρίς δημιουργό ή άδεια`);
    }
  }
  const man = JSON.parse(read(`${L}/manifest.webmanifest`));
  man.icons.forEach((i) => { if (!existsSync(join(root, L, i.src))) add('lite manifest', `λείπει το εικονίδιο ${i.src}`); });
  // Εικονίδια: μόνο Font Awesome.
  const faCss = read('lib/fa/css/fontawesome.min.css');
  const known = new Set([...faCss.matchAll(/\.fa-([a-z0-9-]+):(?::)?before/g)].map((m) => m[1]));
  const mods = new Set(['solid', 'regular']);
  const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{25A0}-\u{25FF}\u{2300}-\u{23FF}\u{21B0}-\u{21FF}\u{2195}-\u{21AF}\u{FF0B}\u{FE0F}]/u;
  for (const f of [`${L}/index.html`, ...liteJs.filter((x) => !x.endsWith('catalog.js'))]) {
    const x = read(f);
    x.split('\n').forEach((line, i) => { if (!/^\s*\/\//.test(line) && emoji.test(line)) add('lite εικονίδια', `${f}:${i + 1}: σύμβολο αντί για Font Awesome`); });
    [...[...x.matchAll(/\bfa-([a-z0-9-]+)/g)].map((m) => m[1]), ...[...x.matchAll(/\bic\('([a-z0-9-]+)'/g)].map((m) => m[1])]
      .filter((n) => !mods.has(n) && !known.has(n)).forEach((n) => add('lite εικονίδια', `${f}: το fa-${n} δεν υπάρχει`));
  }
  // Πλέγμα: η ομογραφία πρέπει να στέλνει τις γωνίες του τετραγώνου ακριβώς στις 4 γωνίες.
  const url = (pth) => pathToFileURL(join(root, pth)).href;
  const photos = await import(url('js/photos.js'));
  const quad = [[0.1, 0.2], [0.8, 0.15], [0.9, 0.85], [0.15, 0.9]];
  const H = photos.homography(quad);
  [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([x, y], i) => {
    const [u, v] = H(x, y);
    if (Math.abs(u - quad[i][0]) > 1e-9 || Math.abs(v - quad[i][1]) > 1e-9) add('lite πλέγμα', `η γωνία ${i + 1} του πλέγματος δεν πέφτει στη θέση της`);
  });
  const q = await import(url(`${L}/js/quadrat.js`)).catch((e) => { add('lite πλέγμα', `το quadrat.js δεν φορτώνει: ${e.message}`); return null; });
  if (q) {
    const o = q.orderCorners([[0.9, 0.85], [0.1, 0.2], [0.15, 0.9], [0.8, 0.15]]);
    if (JSON.stringify(o) !== JSON.stringify(quad)) add('lite πλέγμα', `λάθος σειρά γωνιών: ${JSON.stringify(o)}`);
  }
  // Δημοσίευση.
  if (!/cp -r [^\n]*\blite\b[^\n]*_site\//.test(read('.github/workflows/pages.yml'))) add('δημοσίευση', 'το pages.yml δεν αντιγράφει τον φάκελο lite');
}

// 6. ESLint no-undef (αν έχει εγκατασταθεί στο tools/).
{
  // Τρέχουμε το ESLint με το node (δουλεύει σε Windows, Mac, Linux). Το .bin/eslint δεν τρέχει στα Windows.
  const bin = join(root, 'tools/node_modules/eslint/bin/eslint.js');
  if (!existsSync(bin)) add('μεταβλητές', 'δεν υπάρχει ESLint. Τρέξε: cd tools && npm install');
  else {
    const r = spawnSync(process.execPath, [bin, '--config', 'tools/eslint.config.mjs', 'js', 'sw.js', 'lite/js', 'lite/sw.js'], { cwd: root, encoding: 'utf8' });
    if (r.error) add('μεταβλητές', `ESLint δεν ξεκίνησε: ${r.error.message}`);
    else if (r.status !== 0) add('μεταβλητές', `ESLint (κωδικός ${r.status}):\n${r.stdout || ''}${r.stderr || ''}`);
  }
}

if (findings.length) {
  console.error(`✖ ${findings.length} ευρήματα:\n${findings.map((f) => ` - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('✔ Όλοι οι φύλακες πέρασαν: σύνταξη, εισαγωγές, στοιχεία HTML, service worker, στήλες, μεταβλητές.');
