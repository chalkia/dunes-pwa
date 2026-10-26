// Κύρια λογική: κατάσταση, οθόνες, φόρμες, συμβάντα.
import {
  ZONES, KINDS, NEW_KINDS, PRESSURES, PHOTO_SUBJECTS, SPECIES, CRITERIA, WEATHER_CHIPS, SRC_LABEL, MODES, APP_NAME,
} from './schema.js';
import {
  dbGetAll, dbPut, dbDelete, dbDeleteMany, dbByIndex, dbClear, getSetting, setSetting, askPersistent, storageInfo,
} from './db.js';
import {
  effectivePos, getPosition, gpsErrorText, hasLatLon, mapLength, toNum, haversine,
} from './geo.js';
import { resizeImage } from './photos.js';
import { GUIDE, OBS_URL } from './guide.js';
import {
  pointName, healthScore, byDistance, dateOf, isPlot, pinLabel,
} from './rows.js';
import {
  initMap, showMap, fitArea, setBase, getBaseName, refreshMarkers, startPlacing, finishPlacing, toggleLocate,
  BASEMAPS, tileStatus, downloadTiles, tilePlan, setMapArea, startDrawing, drawUndo, finishDrawing,
} from './map.js';
import {
  validArea, areaCenter, areaBounds, areaSquareMeters, encodeArea, decodeArea, areaLink, parseHash, searchCatalog,
  polyFromKml, polyFromGeoJson, suggestCode, normCode, coordPrefix, parseCoord, decimalsOf,
} from './area.js';
import {
  collect, counts, buildPackage, buildKmz, buildCsv, exportBaseName, saveBlob, canShareFiles, shareBlob, importPackage,
} from './pack.js';

// ---------- Βοηθητικά ----------
const $ = (id) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Λείπει το στοιχείο #${id}`);
  return el;
};

const esc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Εικονίδια Font Awesome: ic('house') → <i class="fa-solid fa-house">. Ο φύλακας ελέγχει ότι κάθε fa-* υπάρχει.
const ic = (name, style = 'solid') => `<i class="fa-${style} fa-${name}" aria-hidden="true"></i>`;

const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const nowIso = () => new Date().toISOString();

function localIso(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

let toastTimer = null;
// icon: εικονίδιο από ic(…), ή κενό.
function toast(msg, ms = 3500, icon = '') {
  const el = $('toast');
  el.innerHTML = `${icon ? `${icon} ` : ''}${esc(msg)}`;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function confirmBox(text, okLabel = 'Ναι, συνέχεια') {
  return new Promise((resolve) => {
    const dlg = $('dialog');
    $('dialogText').textContent = text;
    $('dialogOk').textContent = okLabel;
    dlg.hidden = false;
    const done = (v) => {
      dlg.hidden = true;
      $('dialogOk').onclick = null;
      $('dialogCancel').onclick = null;
      resolve(v);
    };
    $('dialogOk').onclick = () => done(true);
    $('dialogCancel').onclick = () => done(false);
  });
}

const fmtDateTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('el-GR', { dateStyle: 'short', timeStyle: 'short' });
};

// ---------- Κατάσταση ----------
const S = {
  tab: 'home',
  transects: [],
  points: [],
  identity: {},
  activeId: null,
  scope: 'active', // 'active' | 'all' (στον χάρτη)
  sheet: null, // { draft, photos, removed, isNew }
  posBusy: null,
  swReady: false,
  tiles: {},
  tileProg: null,
  storage: null,
  exportAll: true,
  busy: null,
  lastExport: null,
  installEvent: null,
  mapReady: false,
  returnTab: 'home',
  placeLabel: '',
  area: null, // η ενεργή περιοχή έρευνας { code, name, poly }
  catalog: null, // κατάλογος περιοχών από το areas/areas.json
  catalogErr: null,
  areaQ: '', // αναζήτηση στον κατάλογο
  areaDraft: null, // νέα περιοχή που φτιάχνει ο/η εκπαιδευτικός
  teacherOpen: false,
  manualOpen: {}, // ανοιχτά πεδία συντεταγμένων ανά θέση (start, end, sheet)
  coordDraft: {}, // ό,τι γράφει ο μαθητής στα πεδία συντεταγμένων
  tilesAll: false, // κατεβαίνουν οι χάρτες
};

const isPlots = (t) => !!t && t.mode === 'plots';
const kindLabel = (k, t) => (k === 'quadrat' && isPlots(t) ? 'Πλαίσιο 1×1 μ.' : KINDS[k].label);
const kindIcon = (k) => `<i class="${KINDS[k].icon}"></i>`;
const KIND_HELP = {
  quadrat: 'κάτοψη + φυτά', pressure: 'ομπρέλες, ρόδες, σκουπίδια', lilies: 'μέτρα τα άτομα', invasive: 'π.χ. χουζούρι', unknown: 'δεν το ξέρουμε', zone: 'αλλάζει το τοπίο', photo: 'ό,τι άλλο',
};

const activeT = () => S.transects.find((t) => t.id === S.activeId) || null;
const pointsOf = (t) => S.points.filter((p) => p.transectId === t.id);
const tLabel = (t) => `${t.team || 'Ομάδα;'} · ${t.beach || 'παραλία;'} · ${dateOf(t)}`;
const photoTotal = (t) => pointsOf(t).reduce((a, p) => a + (p.photoIds ? p.photoIds.length : 0), 0);

// ---------- Αποθήκευση ----------
let pendingT = null;
let pendingTimer = null;

async function saveTransect(t) {
  t.updatedAt = nowIso();
  await dbPut('transects', t);
}

function scheduleSaveTransect(t) {
  pendingT = t;
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(flushPending, 400);
}

function flushPending() {
  clearTimeout(pendingTimer);
  if (!pendingT) return Promise.resolve();
  const t = pendingT;
  pendingT = null;
  return saveTransect(t).catch((e) => {
    console.error(e);
    toast(`Δεν αποθηκεύτηκε η διατομή: ${e.message}`, 7000);
  });
}

async function savePoint(p) {
  p.updatedAt = nowIso();
  await dbPut('points', p);
}

function newTransect() {
  const idn = S.identity || {};
  return {
    id: uid('t'),
    mode: null,
    areaCode: S.area ? S.area.code : '',
    areaName: S.area ? S.area.name : '',
    school: idn.school || '',
    team: idn.team || '',
    members: idn.members || '',
    beach: idn.beach || '',
    datetime: localIso(),
    weather: '',
    length_m: null,
    spacing_m: 10,
    start: null,
    end: null,
    notes: '',
    health: { scores: {}, why: {}, impressions: ['', '', ''], proposal: '' },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

async function rememberIdentity(t) {
  S.identity = { school: t.school, team: t.team, members: t.members, beach: t.beach };
  await setSetting('identity', S.identity);
}

async function reloadFromDb() {
  S.transects = await dbGetAll('transects');
  S.points = await dbGetAll('points');
  // Παλιές εγγραφές (πριν υπάρξει επιλογή τρόπου): όσες έχουν διατομή ή σημεία είναι «πλήρες πρωτόκολλο».
  S.transects.forEach((t) => {
    if (t.mode === undefined) {
      const used = t.start || t.end || S.points.some((p) => p.transectId === t.id);
      t.mode = used ? 'protocol' : null;
    }
  });
  if (!activeT()) S.activeId = S.transects.length ? S.transects[0].id : null;
}

// ---------- Θέση ----------
function currentPos(scope) {
  const t = activeT();
  if (scope === 'sheet') return S.sheet.draft.pos || effectivePos(S.sheet.draft, t);
  return t ? t[scope] : null;
}

function setPos(scope, pos) {
  if (scope === 'sheet') {
    S.sheet.draft.pos = pos;
    renderSheet();
    return;
  }
  const t = activeT();
  t[scope] = pos;
  saveTransect(t).catch((e) => toast(`Δεν αποθηκεύτηκε η θέση: ${e.message}`, 7000));
  renderAll();
}

// Ανοίγει τα πεδία συντεταγμένων, προσυμπληρωμένα.
// Με θέση: όλα τα ψηφία (5 δεκαδικά ≈ 1 μ.). Χωρίς θέση: ως το 1ο δεκαδικό της μοίρας, από το κέντρο της περιοχής.
function openManual(scope, pos) {
  let lat = '';
  let lon = '';
  if (hasLatLon(pos)) {
    lat = Number(pos.lat).toFixed(5);
    lon = Number(pos.lon).toFixed(5);
  } else if (S.area) {
    const c = areaCenter(S.area);
    lat = coordPrefix(c.lat);
    lon = coordPrefix(c.lon);
  }
  S.manualOpen[scope] = true;
  S.coordDraft[scope] = { lat, lon };
}

function closeManual(scope) {
  delete S.manualOpen[scope];
  delete S.coordDraft[scope];
}

async function saveManual(scope) {
  const d = S.coordDraft[scope] || {};
  const lat = parseCoord(d.lat, 90);
  const lon = parseCoord(d.lon, 180);
  if (lat === null || lon === null) {
    toast('Οι αριθμοί δεν είναι σωστοί. Παράδειγμα: 35.37142 και 24.51533 (τελεία ή κόμμα).', 7000);
    return;
  }
  const dec = Math.min(decimalsOf(d.lat), decimalsOf(d.lon));
  if (dec < 4) {
    const err = [11000, 1100, 110, 11][dec] || 11000;
    const ok = await confirmBox(`Έγραψες μόνο ${dec} δεκαδικά. Η θέση μπορεί να απέχει έως ${err >= 1000 ? `${err / 1000} χλμ.` : `${err} μ.`} από την πραγματική. Τη βάζω έτσι;`, 'Ναι, έτσι');
    if (!ok) return;
  }
  if (S.area) {
    const c = areaCenter(S.area);
    const b = areaBounds(S.area);
    const radius = haversine({ lat: b.south, lon: b.west }, { lat: b.north, lon: b.east }) / 2;
    const far = haversine({ lat, lon }, c);
    if (far > Math.max(1500, radius * 3)) {
      const ok = await confirmBox(`Αυτή η θέση είναι ${(far / 1000).toFixed(1)} χλμ. μακριά από την περιοχή «${S.area.name}». Μήπως μπερδεύτηκαν τα ψηφία;`, 'Είναι σωστή');
      if (!ok) return;
    }
  }
  closeManual(scope);
  setPos(scope, { lat, lon, src: 'manual', ts: nowIso() });
  toast('Η θέση μπήκε', 3500, ic('circle-check'));
}

async function doPos(scope, mode) {
  if (mode === 'clear') { closeManual(scope); setPos(scope, null); return; }
  if (mode === 'manual') {
    if (S.manualOpen[scope]) closeManual(scope); else openManual(scope, currentPos(scope));
    rerenderPosHost(scope);
    return;
  }
  if (mode === 'manual-save') { await saveManual(scope); return; }
  if (mode === 'gps') {
    S.posBusy = scope;
    rerenderPosHost(scope);
    try {
      const p = await getPosition();
      S.posBusy = null;
      closeManual(scope);
      setPos(scope, p);
      toast(`Θέση από GPS (±${p.acc} μ.)`, 3500, ic('circle-check'));
    } catch (e) {
      S.posBusy = null;
      rerenderPosHost(scope);
      toast(`${gpsErrorText(e)} Δοκίμασε «Στον χάρτη».`, 8000);
    }
    return;
  }
  // Πρόχειρη θέση στον χάρτη. Μετά ανοίγουν τα πεδία με τους αριθμούς, για διόρθωση.
  const label = scope === 'sheet' ? pointName(S.sheet.draft) : scope === 'start' ? 'Αρχή γραμμής (θάλασσα)' : 'Τέλος γραμμής (ενδοχώρα)';
  const initial = currentPos(scope);
  const back = S.tab;
  if (scope === 'sheet') $('sheet').hidden = true;
  S.placeLabel = label;
  switchTab('map');
  const pos = await startPlacing({ initial });
  $('placeBanner').hidden = true;
  if (scope === 'sheet') {
    $('sheet').hidden = false;
    switchTab(S.returnTab || back);
  } else {
    switchTab('home');
  }
  if (pos) {
    openManual(scope, pos);
    setPos(scope, pos);
    toast('Πρόχειρη θέση. Αν ξέρεις τους ακριβείς αριθμούς, διόρθωσέ τους από κάτω.', 6000, ic('circle-check'));
  }
}

function rerenderPosHost(scope) {
  if (scope === 'sheet' && S.sheet) renderSheet();
  else renderHome();
}

function manualBox(scope) {
  const d = S.coordDraft[scope] || { lat: '', lon: '' };
  return `<div class="coords">
    <div class="grid2">
      <label class="field">Πλάτος (Β) <i class="fa-solid fa-arrows-up-down"></i><input data-coord="${scope}|lat" inputmode="decimal" autocomplete="off" spellcheck="false" value="${esc(d.lat)}" placeholder="π.χ. 35.37142"></label>
      <label class="field">Μήκος (Α) <i class="fa-solid fa-arrows-left-right"></i><input data-coord="${scope}|lon" inputmode="decimal" autocomplete="off" spellcheck="false" value="${esc(d.lon)}" placeholder="π.χ. 24.51533"></label>
    </div>
    <div class="btn-row"><button type="button" class="btn primary" data-act="pos" data-scope="${scope}" data-m="manual-save"><i class="fa-solid fa-check"></i> Βάλε αυτή τη θέση</button></div>
    <p class="hint"><i class="fa-solid fa-lightbulb"></i> Τα πρώτα ψηφία είναι ήδη γραμμένα. Συμπλήρωσε τα υπόλοιπα δεκαδικά (από GPS κινητού ή χάρτη στο σχολείο).
      Κάθε δεκαδικό ψηφίο είναι 10 φορές πιο ακριβές: 0,1° ≈ 11 χλμ. · 0,001° ≈ 110 μ. · 0,00001° ≈ 1 μ.</p>
  </div>`;
}

function posBlock(scope, pos, derived) {
  const busy = S.posBusy === scope;
  let status;
  let cls;
  let icon;
  if (hasLatLon(pos)) {
    const acc = toNum(pos.acc);
    icon = ic('circle-check');
    status = `${SRC_LABEL[pos.src] || pos.src}${acc !== null ? ` (±${acc} μ.)` : ''} · ${Number(pos.lat).toFixed(5)}, ${Number(pos.lon).toFixed(5)}`;
    cls = 'ok';
  } else if (derived) {
    icon = ic('calculator');
    status = `Υπολογίστηκε από τη γραμμή (${derived.lat.toFixed(5)}, ${derived.lon.toFixed(5)}). Μπορείς να τη διορθώσεις.`;
    cls = 'calc';
  } else {
    icon = ic('circle', 'regular');
    status = 'Δεν έχει θέση ακόμη. Δεν πειράζει: μπαίνει και αργότερα, στο σχολείο.';
    cls = 'none';
  }
  const open = !!S.manualOpen[scope];
  return `<div class="pos ${cls}">
    <div class="pos-status">${icon} ${esc(status)}</div>
    <div class="btn-row">
      <button type="button" class="btn" data-act="pos" data-scope="${scope}" data-m="gps" ${busy ? 'disabled' : ''}>${busy ? '<i class="fa-solid fa-hourglass-half"></i> Ψάχνω…' : '<i class="fa-solid fa-location-dot"></i> GPS'}</button>
      <button type="button" class="btn" data-act="pos" data-scope="${scope}" data-m="map"><i class="fa-solid fa-map-location-dot"></i> Στον χάρτη</button>
      <button type="button" class="btn ${open ? 'on' : ''}" data-act="pos" data-scope="${scope}" data-m="manual"><i class="fa-solid fa-keyboard"></i> Με αριθμούς</button>
      ${hasLatLon(pos) ? `<button type="button" class="btn ghost" data-act="pos" data-scope="${scope}" data-m="clear"><i class="fa-solid fa-xmark"></i></button>` : ''}
    </div>
    ${open ? manualBox(scope) : ''}
  </div>`;
}

// ---------- Οθόνες ----------
function keepScroll(fn) {
  const v = $('views');
  const top = v.scrollTop;
  fn();
  v.scrollTop = top;
}

function renderTopbar() {
  const t = activeT();
  const sub = [S.area ? S.area.name : 'Διάλεξε περιοχή', t ? (t.team || 'ομάδα;') : ''].filter(Boolean).join(' · ');
  $('topTitle').innerHTML = `<b>${ic('umbrella-beach')} ${esc(APP_NAME)}</b><small>${esc(sub)}</small>`;
  const on = navigator.onLine;
  const net = $('netBadge');
  net.innerHTML = on ? `${ic('wifi')} με wifi` : `${ic('plane')} χωρίς σύνδεση`;
  net.className = `net ${on ? 'on' : 'off'}`;
}

// ---- Αρχή: η «αποστολή» σε 7 βήματα ----
const tileOk = (n) => S.tiles[n] && S.tiles[n].total > 0 && S.tiles[n].cached === S.tiles[n].total;
const mapsReady = () => !!S.area && tileOk('sat');

function stepCard(n, icon, title, done, body, opts = {}) {
  return `<section class="card step ${done ? 'done' : ''} ${opts.locked ? 'locked' : ''}" data-step="${n}">
    <div class="step-head"><span class="badge">${done ? ic('check') : n}</span><h2>${ic(icon)} ${title}</h2></div>
    ${opts.locked ? `<p class="hint"><i class="fa-solid fa-lock"></i> ${esc(opts.locked)}</p>` : body}
  </section>`;
}

function tilesBox() {
  const prog = S.tileProg;
  const row = (name) => {
    const st = S.tiles[name];
    const plan = S.area ? tilePlan(name) : { urls: [], zmax: null };
    const full = tileOk(name);
    const mb = Math.max(1, Math.round((plan.urls.length * (name === 'sat' ? 25 : 12)) / 1000));
    return `<li class="${full ? 'ok' : 'no'}">${full ? '<i class="fa-solid fa-check"></i>' : '<i class="fa-regular fa-circle"></i>'} ${esc(BASEMAPS[name].label)}: ${st ? `${st.cached}/${st.total}` : '…'} κομμάτια <small>(~${mb} MB, ζουμ ως ${plan.zmax || '—'})</small></li>`;
  };
  return `<ul class="steps">
      <li class="${S.swReady ? 'ok' : 'no'}">${S.swReady ? '<i class="fa-solid fa-check"></i>' : '<i class="fa-regular fa-circle"></i>'} Η εφαρμογή και ο οδηγός φυτών είναι στο tablet</li>
      ${row('sat')}${row('osm')}
    </ul>
    ${prog ? `<progress max="${prog.total || 1}" value="${prog.done}"></progress><p class="hint">${esc(BASEMAPS[prog.name].label)}: ${prog.done} / ${prog.total}${prog.failed ? ` · ${prog.failed} απέτυχαν` : ''}</p>` : ''}
    <div class="btn-row">
      <button type="button" class="btn ${mapsReady() ? '' : 'primary big'}" data-act="tiles-all" ${S.tileProg || !navigator.onLine ? 'disabled' : ''}>${mapsReady() ? '<i class="fa-solid fa-rotate"></i> Ξανά κατέβασμα' : '<i class="fa-solid fa-download"></i> Κατέβασε τους χάρτες'}</button>
    </div>
    ${navigator.onLine || mapsReady() ? '' : '<p class="hint warn"><i class="fa-solid fa-wifi"></i> Χρειάζεσαι wifi για να κατεβάσεις τους χάρτες.</p>'}
    <p class="hint">Κάν’ το <b>στο σχολείο, με wifi</b>, πριν πάτε στην παραλία. Εκεί δεν θα έχετε internet.</p>`;
}

function teamBody(t) {
  const chips = S.transects.map((x) => `<button type="button" class="chip ${x.id === S.activeId ? 'on' : ''}" data-act="pick-t" data-id="${esc(x.id)}">${esc(tLabel(x))}</button>`).join('');
  const pick = `<div class="chips">${chips}<button type="button" class="chip add" data-act="new-t"><i class="fa-solid fa-plus"></i> Νέα ομάδα / γραμμή</button></div>`;
  if (!t) return `${pick}<p class="hint">Κάθε ομάδα κάνει μία γραμμή (διατομή) από τη θάλασσα προς τη στεριά. Πάτησε «<i class="fa-solid fa-plus"></i> Νέα ομάδα».</p>`;
  return `${pick}
    <div class="grid2">
      <label class="field">Σχολείο<input data-tf="school" value="${esc(t.school)}" autocomplete="off"></label>
      <label class="field">Όνομα ομάδας<input data-tf="team" value="${esc(t.team)}" autocomplete="off" placeholder="π.χ. Οι Κρινάκηδες"></label>
    </div>
    <label class="field">Ποιοι είμαστε (ονόματα)<input data-tf="members" value="${esc(t.members)}" autocomplete="off"></label>
    <div class="grid2">
      <label class="field">Παραλία<input data-tf="beach" value="${esc(t.beach)}" autocomplete="off"></label>
      <label class="field">Ημέρα και ώρα<input type="datetime-local" data-tf="datetime" value="${esc(t.datetime)}"></label>
    </div>
    <label class="field">Καιρός<input data-tf="weather" value="${esc(t.weather)}" autocomplete="off"></label>
    <div class="chips">${WEATHER_CHIPS.map((w) => `<button type="button" class="chip" data-act="weather" data-v="${esc(w.label)}"><i class="${w.icon}"></i> ${esc(w.label)}</button>`).join('')}</div>
    <p class="hint">Φύλλο 1 του πρωτοκόλλου.</p>`;
}

function modeChooser(t) {
  const card = (m, text, steps) => `<button type="button" class="mode-card ${t.mode === m ? 'on' : ''}" data-act="set-mode" data-v="${m}">
      <span class="mode-ic"><i class="${MODES[m].icon}"></i></span>
      <b>${esc(MODES[m].label)}</b><span>${text}</span><small>${steps}</small></button>`;
  return `<p>Διαλέξτε <b>έναν</b> τρόπο. Ρωτήστε τον/την καθηγητή/τρια.</p>
    <div class="modes">
      ${card('protocol', 'Μια γραμμή από τη θάλασσα στη στεριά. Τετράγωνο κάθε λίγα μέτρα, σε όλες τις ζώνες.', 'Θέλει: αρχή και τέλος γραμμής, μετροταινία.')}
      ${card('plots', 'Λίγα τετράγωνα 1×1 μ. εκεί που θέλετε. Φωτογραφία από πάνω και πινέζες στα φυτά.', 'Θέλει: θέση για κάθε πλαίσιο.')}
    </div>`;
}

function plotsBody(t) {
  const plots = pointsOf(t).filter(isPlot);
  const placed = plots.filter((p) => effectivePos(p, t)).length;
  return `<p>Κάθε πλαίσιο είναι ένα τετράγωνο 1×1 μ. Για το καθένα:</p>
    <ol class="plain">
      <li>${ic('location-dot')} βάλτε τη θέση του (GPS, χάρτης ή αριθμοί),</li>
      <li>${ic('camera')} βγάλτε φωτογραφία <b>από πάνω</b> (κάτοψη), να φαίνεται όλο το πλαίσιο,</li>
      <li>${ic('thumbtack')} πατήστε πάνω στα φυτά της φωτογραφίας και βάλτε πινέζες.</li>
    </ol>
    <p>Πλαίσια: <b>${plots.length}</b> · με θέση: <b>${placed}</b></p>
    <label class="field">Σημειώσεις<textarea data-tf="notes" rows="2">${esc(t.notes)}</textarea></label>`;
}

function methodBody(t) {
  if (!t.mode) return modeChooser(t);
  const body = t.mode === 'plots' ? plotsBody(t) : lineBody(t);
  return `<p class="mode-now">${ic(MODES[t.mode].icon.replace('fa-solid fa-', ''))} <b>${esc(MODES[t.mode].label)}</b>
    <button type="button" class="chip" data-act="mode-change">${ic('arrows-rotate')} Αλλαγή</button></p>${body}`;
}

function lineBody(t) {
  const len = mapLength(t);
  const lenBtn = len !== null
    ? `<button type="button" class="chip" data-act="len-from-map"><i class="fa-solid fa-ruler"></i> Από τον χάρτη: ${Math.round(len)} μ.</button>`
    : '';
  return `<div class="line-pic" aria-hidden="true"><span><i class="fa-solid fa-water"></i> θάλασσα</span><i></i><span><i class="fa-solid fa-tree"></i> στεριά</span></div>
    <h3><i class="fa-solid fa-water"></i> Αρχή: στο νερό</h3>
    ${posBlock('start', t.start, null)}
    <h3><i class="fa-solid fa-tree"></i> Τέλος: στη στεριά</h3>
    ${posBlock('end', t.end, null)}
    <p class="hint"><i class="fa-solid fa-lightbulb"></i> Δεν έχει GPS το tablet; Βάλε πρόχειρα την αρχή και το τέλος στον χάρτη. Μετά διόρθωσε τους αριθμούς. Τα τετράγωνα παίρνουν θέση μόνα τους πάνω στη γραμμή.</p>
    <div class="grid2">
      <label class="field">Μήκος γραμμής (μ.)<input type="number" inputmode="decimal" step="any" min="0" data-tf="length_m" data-t="num" value="${esc(t.length_m)}"></label>
      <label class="field">Κάθε πόσα μέτρα ένα τετράγωνο;<input type="number" inputmode="decimal" step="any" min="1" data-tf="spacing_m" data-t="num" value="${esc(t.spacing_m)}"></label>
    </div>
    <div class="chips">
      <button type="button" class="chip" data-act="spacing" data-v="5">5 μ.</button>
      <button type="button" class="chip" data-act="spacing" data-v="10">10 μ.</button>
      ${lenBtn}
    </div>
    <label class="field">Σημειώσεις<textarea data-tf="notes" rows="2">${esc(t.notes)}</textarea></label>`;
}

function recordBody(t) {
  const pts = pointsOf(t);
  if (isPlots(t)) {
    const plots = pts.filter(isPlot);
    const withTop = plots.filter((p) => p.topPhotoId).length;
    const pins = plots.reduce((a, p) => a + (p.pins || []).length, 0);
    const tk = (ok, text) => `<li class="${ok ? 'ok' : 'no'}">${ok ? ic('check') : ic('circle', 'regular')} ${text}</li>`;
    return `<ul class="steps">
      ${tk(plots.length > 0, `${ic('vector-square')} Πλαίσια: <b>${plots.length}</b>`)}
      ${tk(plots.length > 0 && withTop === plots.length, `${ic('camera')} Με κάτοψη: <b>${withTop}</b>`)}
      ${tk(pins > 0, `${ic('thumbtack')} Πινέζες φυτών: <b>${pins}</b>`)}
    </ul>
    <div class="btn-row"><button type="button" class="btn primary" data-act="new" data-kind="quadrat">${ic('plus')} Νέο πλαίσιο</button>
      <button type="button" class="btn" data-act="tab" data-tab="records">${ic('list-check')} Όλες οι καταγραφές</button></div>`;
  }
  const nq = pts.filter((p) => p.kind === 'quadrat').length;
  const np = pts.filter((p) => p.kind === 'pressure').length;
  const hasSub = (sub) => pts.some((p) => p.kind === 'photo' && p.subject === sub);
  const tick = (ok, text) => `<li class="${ok ? 'ok' : 'no'}">${ok ? '<i class="fa-solid fa-check"></i>' : '<i class="fa-regular fa-circle"></i>'} ${text}</li>`;
  return `<ul class="steps">
      ${tick(hasSub('inland'), '<i class="fa-solid fa-camera"></i> Πανοραμική προς τη στεριά')}
      ${tick(hasSub('sea'), '<i class="fa-solid fa-camera"></i> Πανοραμική προς τη θάλασσα')}
      ${tick(nq > 0, `<i class="fa-solid fa-vector-square"></i> Τετράγωνα: <b>${nq}</b>`)}
      ${tick(np > 0, `<i class="fa-solid fa-shoe-prints"></i> Πιέσεις: <b>${np}</b>`)}
      ${tick(photoTotal(t) > 0, `<i class="fa-solid fa-camera"></i> Φωτογραφίες: <b>${photoTotal(t)}</b>`)}
    </ul>
    <div class="btn-row">
      ${hasSub('inland') ? '' : '<button type="button" class="btn" data-act="new" data-kind="photo" data-subject="inland"><i class="fa-solid fa-camera"></i> Προς στεριά</button>'}
      ${hasSub('sea') ? '' : '<button type="button" class="btn" data-act="new" data-kind="photo" data-subject="sea"><i class="fa-solid fa-camera"></i> Προς θάλασσα</button>'}
      <button type="button" class="btn primary" data-act="tab" data-tab="records"><i class="fa-solid fa-seedling"></i> Πάμε για καταγραφή</button>
    </div>`;
}

function renderHome() {
  const t = activeT();
  const hs = t ? healthScore(t) : null;
  const done = [
    !!S.area,
    mapsReady(),
    !!(t && (t.team || t.school) && t.beach),
    !!(t && (isPlots(t) || (t.mode === 'protocol' && hasLatLon(t.start) && hasLatLon(t.end)))),
    !!(t && pointsOf(t).some((p) => p.kind === 'quadrat')),
    !!(hs && hs.complete),
    !!S.lastExport,
  ];
  const nDone = done.filter(Boolean).length;
  const noArea = S.area ? null : 'Πρώτα διάλεξε περιοχή (βήμα 1).';
  const noT = t ? null : 'Πρώτα φτιάξε ομάδα (βήμα 3).';
  const noMode = t && !t.mode ? 'Πρώτα διαλέξτε τρόπο έρευνας (βήμα 4).' : null;
  const areaBody = S.area
    ? `<p class="big-name"><i class="fa-solid fa-location-dot"></i> ${esc(S.area.name)} <span class="code">${esc(S.area.code)}</span></p>
       <div class="btn-row"><button type="button" class="btn" data-act="tab" data-tab="area"><i class="fa-solid fa-arrows-rotate"></i> Άλλαξε ή μοιράσου (QR)</button></div>`
    : `<p>Ο/Η καθηγητής/τρια σας δίνει ένα <b>QR</b> ή έναν <b>κωδικό</b>.</p>
       <div class="btn-row"><button type="button" class="btn primary big" data-act="scan"><i class="fa-solid fa-camera"></i> Σκάναρε QR</button>
       <button type="button" class="btn" data-act="tab" data-tab="area"><i class="fa-solid fa-magnifying-glass"></i> Γράψε κωδικό</button></div>`;
  keepScroll(() => {
    $('view-home').innerHTML = `
      <section class="card hero">
        <h1>Γεια σας, ερευνητές! ${ic('magnifying-glass')} ${ic('seedling')}</h1>
        <p>Σήμερα εξερευνούμε μια <b>αμμοθίνα</b>: τους λόφους από άμμο που κρατούν τα φυτά.</p>
        <div class="meter" role="img" aria-label="Πρόοδος ${nDone} από 7"><i style="width:${Math.round((nDone / 7) * 100)}%"></i></div>
        <p class="hint"><span class="stars">${ic('star').repeat(nDone)}${ic('star', 'regular').repeat(7 - nDone)}</span> · ${nDone} από 7 βήματα</p>
      </section>
      ${stepCard(1, 'map-location-dot', 'Πού ερευνούμε;', done[0], areaBody)}
      ${stepCard(2, 'download', 'Χάρτες στο tablet', done[1], tilesBox(), { locked: noArea })}
      ${stepCard(3, 'people-group', 'Η ομάδα μας', done[2], teamBody(t), { locked: noArea })}
      ${stepCard(4, t && t.mode === 'protocol' ? 'route' : t && t.mode === 'plots' ? 'border-all' : 'compass', t && t.mode === 'protocol' ? 'Η γραμμή μας (διατομή)' : t && t.mode === 'plots' ? 'Τα πλαίσιά μας' : 'Πώς θα ερευνήσουμε;', done[3], t ? methodBody(t) : '', { locked: noArea || noT })}
      ${stepCard(5, 'seedling', 'Καταγράφουμε', done[4], t && t.mode ? recordBody(t) : '', { locked: noArea || noT || noMode })}
      ${stepCard(6, 'star', 'Πόσο υγιής είναι η θίνη;', done[5], `<p>${hs && hs.complete ? `Η βαθμολογία σας: <b>${hs.total}/10</b>` : 'Στο τέλος, η ομάδα βάζει βαθμό από 0 έως 10.'}</p><button type="button" class="btn" data-act="tab" data-tab="health"><i class="fa-solid fa-star"></i> Βαθμολογία</button>`, { locked: noT })}
      ${stepCard(7, 'paper-plane', 'Στέλνουμε τα δεδομένα', done[6], `<p>${S.lastExport ? `Τελευταία αποστολή: ${esc(fmtDateTime(S.lastExport))}` : 'Φτιάχνεις ένα πακέτο ZIP και το δίνεις στον/στην καθηγητή/τρια.'}</p><button type="button" class="btn" data-act="tab" data-tab="export"><i class="fa-solid fa-paper-plane"></i> Στείλε</button>`, { locked: noT })}
      ${t ? '<section class="card"><button type="button" class="btn danger" data-act="del-t"><i class="fa-solid fa-trash-can"></i> Διαγραφή αυτής της ομάδας</button></section>' : ''}`;
  });
}

// Προειδοποίηση στις οθόνες πεδίου όταν οι χάρτες δεν έχουν κατέβει.
function mapsWarning() {
  if (mapsReady()) return '';
  return `<section class="card warnc"><b><i class="fa-solid fa-triangle-exclamation"></i> Οι χάρτες δεν είναι στο tablet.</b>
    <p>${navigator.onLine ? 'Κατέβασέ τους τώρα, όσο έχεις wifi.' : 'Χωρίς χάρτες θα βλέπεις μόνο πλέγμα. Βάλε θέσεις με αριθμούς ή αργότερα στο σχολείο.'}</p>
    ${navigator.onLine && S.area ? '<button type="button" class="btn primary" data-act="tiles-all"><i class="fa-solid fa-download"></i> Κατέβασε τους χάρτες</button>' : ''}</section>`;
}

function pointMeta(p, t) {
  const bits = [];
  if (p.kind === 'quadrat') {
    if (p.topPhotoId) bits.push('κάτοψη');
    if (toNum(p.zone) !== null) bits.push(`ζώνη ${p.zone}`);
    if (toNum(p.bare_pct) !== null) bits.push(`άμμος ${p.bare_pct}%`);
    if (toNum(p.plants_pct) !== null) bits.push(`φυτά ${p.plants_pct}%`);
    if (toNum(p.species_count) !== null) bits.push(`${p.species_count} είδη`);
    if (toNum(p.lilies)) bits.push(`${p.lilies} κρινάκια`);
  } else if (p.kind === 'pressure') {
    const pr = PRESSURES.find((x) => x.id === p.pressure_type);
    if (pr) bits.push(pr.label);
    if (toNum(p.dist_m) !== null) bits.push(`στα ${p.dist_m} μ.`);
  } else if (toNum(p.dist_m) !== null) {
    bits.push(`στα ${p.dist_m} μ.`);
  }
  if (p.comment) bits.push(`«${p.comment.slice(0, 40)}${p.comment.length > 40 ? '…' : ''}»`);
  const eff = effectivePos(p, t);
  return { text: bits.join(' · '), eff };
}

function renderRecords() {
  const t = activeT();
  if (!t) {
    $('view-records').innerHTML = '<section class="card"><h2><i class="fa-solid fa-seedling"></i> Καταγραφή</h2><p>Πρώτα φτιάξτε ομάδα, στην «Αρχή» (βήμα 3).</p><button type="button" class="btn primary" data-act="tab" data-tab="home"><i class="fa-solid fa-house"></i> Πήγαινε στην Αρχή</button></section>';
    return;
  }
  if (!t.mode) {
    $('view-records').innerHTML = `<section class="card"><h2>${ic('compass')} Πρώτα: πώς θα ερευνήσετε;</h2>${modeChooser(t)}</section>`;
    return;
  }
  const plots = isPlots(t);
  const pts = pointsOf(t).sort((a, b) => (isPlot(a) && isPlot(b) ? a.plot - b.plot : byDistance(a, b)));
  const noPos = pts.filter((p) => !effectivePos(p, t));
  const nextQ = plots ? `Επόμενο: <b>Πλαίσιο ${nextPlotNo(t)}</b>` : `Επόμενο τετράγωνο: στα <b>${nextQuadratDist(t)} μέτρα</b> από τη θάλασσα`;
  const rows = pts.map((p) => {
    const { text, eff } = pointMeta(p, t);
    const k = KINDS[p.kind];
    const nph = p.photoIds ? p.photoIds.length : 0;
    let badge;
    if (!eff) badge = '<span class="chip warn"><i class="fa-solid fa-triangle-exclamation"></i> χωρίς θέση</span>';
    else if (eff.src === 'calc') badge = '<span class="chip calc">≈ υπολογισμένη</span>';
    else badge = `<span class="chip ok"><i class="fa-solid fa-check"></i> ${esc(SRC_LABEL[eff.src] || eff.src)}</span>`;
    const placeBtn = !eff || eff.src === 'calc'
      ? `<button type="button" class="btn small" data-act="place-row" data-id="${esc(p.id)}"><i class="fa-solid fa-map-location-dot"></i> Βάλε στον χάρτη</button>` : '';
    return `<div class="row" data-act="edit" data-id="${esc(p.id)}">
      <div class="sym" style="background:${k.color}">${kindIcon(p.kind)}</div>
      <div class="rbody"><b>${esc(pointName(p))}</b><span class="meta">${esc(text)}</span>
        <span class="badges">${badge}${nph ? `<span class="chip"><i class="fa-solid fa-camera"></i> ${nph}</span>` : ''}${(p.pins || []).length ? `<span class="chip">${ic('thumbtack')} ${p.pins.length}</span>` : ''}${placeBtn}</span></div>
    </div>`;
  }).join('');
  const needsEnds = !(hasLatLon(t.start) && hasLatLon(t.end));
  const unplacedHint = noPos.length
    ? `<section class="card warnc" id="unplacedBox"><h2><i class="fa-solid fa-triangle-exclamation"></i> Χωρίς θέση: ${noPos.length}</h2>
        <p>${plots ? 'Κάθε πλαίσιο θέλει τη δική του θέση. Πάτησε «Βάλε στον χάρτη» ή άνοιξέ το και γράψε αριθμούς.' : needsEnds ? 'Βάλε αρχή και τέλος της γραμμής (Αρχή → βήμα 4). Τότε τα σημεία με απόσταση παίρνουν θέση μόνα τους. Ή πάτησε «Βάλε στον χάρτη» σε κάθε σημείο.' : 'Πάτησε «Βάλε στον χάρτη» στα σημεία που δεν έχουν απόσταση από τη θάλασσα.'}</p></section>`
    : '<span id="unplacedBox"></span>';
  keepScroll(() => {
    $('view-records').innerHTML = `
      ${mapsWarning()}
      <section class="card">
        <h2><i class="fa-solid fa-eye"></i> Τι βλέπεις τώρα;</h2>
        <p class="next-q">${nextQ} <span class="mode-tag">${ic(MODES[t.mode].icon.replace('fa-solid fa-', ''))} ${esc(MODES[t.mode].label)}</span></p>
        <div class="kindgrid">${NEW_KINDS[t.mode].map((k) => `<button type="button" class="kbtn" style="--kc:${KINDS[k].color}" data-act="new" data-kind="${k}"><i>${kindIcon(k)}</i><span>${esc(kindLabel(k, t))}</span><small>${esc(KIND_HELP[k])}</small></button>`).join('')}</div>
      </section>
      ${unplacedHint}
      <section class="card"><h2><i class="fa-solid fa-clipboard-list"></i> Τι έχουμε βρει (${pts.length})</h2>
        ${rows || '<p class="hint">Τίποτα ακόμη. Ξεκίνα από το πρώτο τετράγωνο, στο νερό (0 μ.).</p>'}
      </section>`;
  });
}

// ---- Υγεία θίνας ----
function mean(arr) {
  const v = arr.filter((x) => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function chartSvg(t) {
  const plots = isPlots(t);
  const qs = plots
    ? pointsOf(t).filter(isPlot).sort((a, b) => a.plot - b.plot)
    : pointsOf(t).filter((p) => p.kind === 'quadrat' && toNum(p.dist_m) !== null).sort(byDistance);
  if (!qs.length) return '<p class="hint">Το γράφημα εμφανίζεται μόλις καταγράψεις τετράγωνα.</p>';
  const W = 640;
  const H = 270;
  const L0 = 44;
  const B = 62;
  const T0 = 12;
  const R0 = 10;
  const iw = W - L0 - R0;
  const ih = H - T0 - B;
  const slot = iw / qs.length;
  const bw = Math.min(54, slot * 0.72);
  const y = (v) => T0 + ih - (Math.max(0, Math.min(100, v)) / 100) * ih;
  let out = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Κάλυψη ανά απόσταση από τη θάλασσα">`;
  [0, 25, 50, 75, 100].forEach((v) => {
    out += `<line x1="${L0}" x2="${W - R0}" y1="${y(v)}" y2="${y(v)}" stroke="#d8c79a" stroke-width="1"/><text x="${L0 - 6}" y="${y(v) + 4}" text-anchor="end" font-size="12" fill="#444">${v}</text>`;
  });
  qs.forEach((p, i) => {
    const bare = toNum(p.bare_pct) || 0;
    const lit = toNum(p.litter_pct) || 0;
    const pl = toNum(p.plants_pct) || 0;
    const inv = Math.min(pl, toNum(p.invasive_pct) || 0);
    const nat = pl - inv;
    const x0 = L0 + i * slot + (slot - bw) / 2;
    let acc = 0;
    [[bare, '#E8D8A0'], [lit, '#A98467'], [nat, '#2F6B50'], [inv, '#7B3FA0']].forEach(([v, c]) => {
      if (v > 0) {
        out += `<rect x="${x0}" y="${y(acc + v)}" width="${bw}" height="${y(acc) - y(acc + v)}" fill="${c}"/>`;
        acc += v;
      }
    });
    const z = ZONES.find((zz) => zz.n === toNum(p.zone));
    out += `<rect x="${x0}" y="${T0 + ih + 4}" width="${bw}" height="10" fill="${z ? z.color : '#eee'}" stroke="#999" stroke-width="0.5"/>`;
    out += `<text x="${x0 + bw / 2}" y="${T0 + ih + 32}" text-anchor="middle" font-size="13" fill="#222">${esc(plots ? `Π${p.plot}` : p.dist_m)}</text>`;
  });
  out += `<text x="${L0 + iw / 2}" y="${H - 6}" text-anchor="middle" font-size="13" fill="#222">${plots ? 'Πλαίσιο' : 'Απόσταση από τη θάλασσα (μ.)'} — λωρίδα χρώματος = ζώνη</text>`;
  out += `<text x="12" y="${T0 + ih / 2}" font-size="13" fill="#222" transform="rotate(-90 12 ${T0 + ih / 2})" text-anchor="middle">% κάλυψη</text></svg>`;
  return out;
}

function dataHints(t) {
  const qs = pointsOf(t).filter((p) => p.kind === 'quadrat');
  const q23 = qs.filter((p) => [2, 3].includes(toNum(p.zone)));
  const a23 = mean(q23.map((p) => toNum(p.plants_pct)));
  const inv = mean(qs.map((p) => toNum(p.invasive_pct)));
  const lil = pointsOf(t).reduce((a, p) => a + (p.kind === 'quadrat' || p.kind === 'lilies' ? (toNum(p.lilies) || 0) : 0), 0);
  const zones = [...new Set(pointsOf(t).filter((p) => ['quadrat', 'zone'].includes(p.kind)).map((p) => toNum(p.zone)).filter((z) => z !== null))].sort();
  const pressByType = PRESSURES.map((pr) => [pr, pointsOf(t).filter((p) => p.kind === 'pressure' && p.pressure_type === pr.id).length]).filter(([, n]) => n > 0);
  const li = [];
  li.push(`Φυτοκάλυψη στις ζώνες 2–3: ${a23 === null ? 'δεν υπάρχουν τετράγωνα σε αυτές τις ζώνες' : `κατά μέσο όρο ${Math.round(a23)}%`}`);
  li.push(`Κρινάκια που μετρήθηκαν: ${lil}`);
  li.push(`Ζώνες που καταγράφηκαν: ${zones.length ? zones.join(', ') : '—'}`);
  li.push(`Εισβλητικά (μέσος όρος στα τετράγωνα): ${inv === null ? '—' : `${Math.round(inv)}%`}`);
  li.push(`Πιέσεις: ${pressByType.length ? pressByType.map(([pr, n]) => `${pr.short.replace(/_/g, ' ')} ×${n}`).join(', ') : 'καμία καταγραφή'}`);
  return li;
}

function renderHealth() {
  const t = activeT();
  if (!t) {
    $('view-health').innerHTML = '<section class="card"><h2><i class="fa-solid fa-star"></i> Υγεία θίνας</h2><p>Πρώτα φτιάξτε ομάδα, στην «Αρχή».</p></section>';
    return;
  }
  const h = t.health;
  const hs = healthScore(t);
  const crit = CRITERIA.map((c, i) => `<div class="crit">
      <h3>${i + 1}. ${esc(c.name)}</h3>
      <div class="opts">${c.opts.map((o, v) => `<button type="button" class="opt s${v} ${toNum(h.scores[c.id]) === v ? 'on' : ''}" data-act="score" data-c="${c.id}" data-v="${v}"><b>${v}</b><span>${esc(o)}</span></button>`).join('')}</div>
      <input data-hf="why.${c.id}" placeholder="Γιατί;" value="${esc(h.why[c.id] || '')}" autocomplete="off">
    </div>`).join('');
  const total = hs.complete
    ? `<div class="total" style="background:${hs.band.color}"><b>${hs.total} / 10</b><span>${esc(hs.band.label)}</span></div>`
    : `<div class="total pending"><b>${hs.partial} / 10</b><span>Έχεις βαθμολογήσει ${hs.answered} από ${CRITERIA.length} κριτήρια.</span></div>`;
  keepScroll(() => {
    $('view-health').innerHTML = `
      <section class="card"><h2><i class="fa-solid fa-chart-column"></i> ${isPlots(t) ? 'Τι δείχνουν τα πλαίσιά μας' : 'Τι δείχνει η γραμμή μας'}</h2>${chartSvg(t)}
        <div class="legendrow"><i style="background:#E8D8A0"></i>γυμνή άμμος <i style="background:#A98467"></i>νεκρά υλικά <i style="background:#2F6B50"></i>φυτά <i style="background:#7B3FA0"></i>εισβλητικά</div>
      </section>
      <section class="card"><h2><i class="fa-solid fa-hashtag"></i> Τα νούμερά μας</h2>
        <p class="hint">Βοήθεια για τη συζήτηση. Τον βαθμό τον αποφασίζει η ομάδα.</p>
        <ul class="plain">${dataHints(t).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      </section>
      <section class="card"><h2><i class="fa-solid fa-star"></i> Πόσο υγιής είναι η θίνη;</h2>
        <p class="hint">Για κάθε ερώτηση διάλεξε 0, 1 ή 2. Γράψε και ένα «γιατί». (Φύλλο 4)</p>
        ${crit}
        ${total}
        <p class="hint">0–3: κακή · 4–7: μέτρια · 8–10: καλή. Δεν είναι «βαθμός» της φύσης. Είναι αφορμή για συζήτηση.</p>
      </section>
      <section class="card"><h2><i class="fa-solid fa-face-surprise"></i> Τρία πράγματα που μας έκαναν εντύπωση</h2>
        ${[0, 1, 2].map((i) => `<label class="field">${i + 1}.<input data-hf="imp.${i}" value="${esc(h.impressions[i] || '')}" autocomplete="off"></label>`).join('')}
        <label class="field"><i class="fa-solid fa-shield-halved"></i> Πώς θα προστατεύαμε αυτή τη θίνη;<textarea data-hf="proposal" rows="3">${esc(h.proposal || '')}</textarea></label>
      </section>`;
  });
}

// ---- Αποστολή / εξαγωγή ----
function fmtBytes(n) {
  if (n === null || n === undefined) return '—';
  if (n > 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  return `${Math.round(n / 1e6)} MB`;
}

// ---------- Οδηγός φυτών ----------
const LB = { sp: 0, i: 0 };

function renderGuide() {
  $('view-guide').innerHTML = `<section class="card"><h2>Οδηγός φυτών</h2>
    <p>Δουλεύει χωρίς σύνδεση. Πάτα μια φωτογραφία για να τη δεις μεγάλη. Οι φωτογραφίες είναι από το iNaturalist, με άδεια Creative Commons.</p></section>${
    GUIDE.map((g, si) => `<section class="card guide">
      <h3>${esc(g.name)} <small><i>${esc(g.latin)}</i></small></h3>
      <p>${esc(g.note)}</p>
      <div class="thumbs">${g.photos.map((p, i) => `<button type="button" class="th" data-act="lb-open" data-s="${si}" data-i="${i}"><img loading="lazy" src="plants/${esc(g.dir)}/${esc(p[0])}" alt="${esc(g.name)} ${i + 1}"></button>`).join('')}</div>
    </section>`).join('')}
    <section class="card"><h3>Πηγές</h3><p>Κάθε φωτογραφία έχει τον δημιουργό και την άδειά της στην εικόνα μεγάλου μεγέθους. Χρήση μόνο για εκπαίδευση, με αναφορά του δημιουργού.</p></section>`;
}

function showLightbox() {
  const g = GUIDE[LB.sp];
  const p = g.photos[LB.i];
  $('lbImg').src = `plants/${g.dir}/${p[0]}`;
  $('lbCap').innerHTML = `<b>${esc(g.name)}</b> <i>${esc(g.latin)}</i> (${LB.i + 1}/${g.photos.length})<br>© ${esc(p[1])} · ${esc(p[2])}${p[3] ? ` · <a href="${OBS_URL(p[3])}" target="_blank" rel="noopener">iNaturalist</a>` : ''}`;
  $('lightbox').hidden = false;
}

function renderExport() {
  const t = activeT();
  const nT = S.transects.length;
  const nP = S.points.length;
  const nPh = S.points.reduce((a, p) => a + (p.photoIds ? p.photoIds.length : 0), 0);
  const noPos = S.points.filter((p) => !effectivePos(p, S.transects.find((x) => x.id === p.transectId))).length;
  const st = S.storage;
  const b = (k, label, cls = '') => `<button type="button" class="btn ${cls}" data-act="export" data-k="${k}" ${S.busy ? 'disabled' : ''}>${S.busy === k ? '<i class="fa-solid fa-hourglass-half"></i> Ετοιμάζω…' : label}</button>`;
  keepScroll(() => {
    $('view-export').innerHTML = `
      <section class="card">
        <h2><i class="fa-solid fa-paper-plane"></i> Στείλε τα δεδομένα</h2>
        <p>Στο tablet: <b>${nT}</b> ομάδες, <b>${nP}</b> καταγραφές, <b>${nPh}</b> φωτογραφίες${noPos ? `, <b>${noPos}</b> χωρίς θέση` : ''}.</p>
        <p class="hint">Τελευταία αποστολή: ${esc(fmtDateTime(S.lastExport))}</p>
        <div class="chips">
          <button type="button" class="chip ${S.exportAll ? 'on' : ''}" data-act="scope-export" data-v="all">Όλες οι ομάδες</button>
          <button type="button" class="chip ${S.exportAll ? '' : 'on'}" data-act="scope-export" data-v="active" ${t ? '' : 'disabled'}>Μόνο η δική μας</button>
        </div>
        <div class="stack">
          ${b('zip', '<i class="fa-solid fa-box-archive"></i> Πακέτο ZIP — όλα μαζί (αυτό θέλει ο/η καθηγητής/τρια)', 'primary big')}
          ${canShareFiles() ? b('share', '<i class="fa-solid fa-share-from-square"></i> Στείλ’ το κατευθείαν (Drive, email…)') : ''}
          ${b('kmz', '<i class="fa-solid fa-earth-europe"></i> KMZ για Google Earth / My Maps')}
          ${b('csv', '<i class="fa-solid fa-file-csv"></i> Μόνο πίνακας CSV')}
        </div>
        <p class="hint"><i class="fa-solid fa-floppy-disk"></i> Το ZIP είναι και αντίγραφο ασφαλείας. Φτιάξ’ το στο τέλος κάθε μέρας.</p>
      </section>
      <section class="card">
        <h2><i class="fa-solid fa-chalkboard-user"></i> Για τον/την καθηγητή/τρια: ένας κοινός χάρτης</h2>
        <ol class="plain">
          <li>Κάθε ομάδα στέλνει το πακέτο ZIP (Drive, email).</li>
          <li>Φόρτωσε όλα τα ZIP εδώ, με «Εισαγωγή», και κάνε ένα ZIP για όλους.</li>
          <li>Στο <b>mymaps.google.com</b>: νέος χάρτης → Εισαγωγή → <b>points_mymaps.csv</b>. Θέση: Latitude, Longitude. Τίτλος: Όνομα.</li>
          <li>Για QGIS: <b>data.geojson</b>. Για Google Earth με φωτογραφίες: <b>.kmz</b>.</li>
        </ol>
        <button type="button" class="btn" data-act="import"><i class="fa-solid fa-file-import"></i> Εισαγωγή πακέτου ZIP</button>
      </section>
      <section class="card">
        <h2><i class="fa-solid fa-screwdriver-wrench"></i> Το tablet</h2>
        <ul class="plain">
          <li>Δουλεύει χωρίς internet: ${S.swReady ? '<i class="fa-solid fa-check"></i> ναι' : '<i class="fa-regular fa-circle"></i> όχι ακόμη'}</li>
          <li>Χάρτες: ${mapsReady() ? '<i class="fa-solid fa-check"></i> κατεβασμένοι' : '<i class="fa-regular fa-circle"></i> όχι ακόμη (Αρχή → βήμα 2)'}</li>
          <li>Προστασία δεδομένων από σβήσιμο: ${st && st.persisted ? '<i class="fa-solid fa-check"></i> ναι' : '<i class="fa-regular fa-circle"></i> όχι'} ${st && st.persisted ? '' : '<button type="button" class="btn small" data-act="persist">Ζήτησέ την</button>'}</li>
          <li>Χώρος: ${esc(fmtBytes(st && st.usage))} από ${esc(fmtBytes(st && st.quota))}</li>
        </ul>
        ${S.installEvent ? '<button type="button" class="btn" data-act="install"><i class="fa-solid fa-download"></i> Βάλε την εφαρμογή στην αρχική οθόνη</button>' : '<p class="hint">Εγκατάσταση: Chrome → <i class="fa-solid fa-ellipsis-vertical"></i> → «Εγκατάσταση εφαρμογής». iPad (Safari) → Κοινοποίηση → «Προσθήκη στην οθόνη Αφετηρίας».</p>'}
      </section>
      <section class="card">
        <h2><i class="fa-solid fa-trash-can"></i> Καθάρισμα</h2>
        <button type="button" class="btn danger" data-act="wipe">Σβήσε ΟΛΑ τα δεδομένα από αυτό το tablet</button>
        <p class="hint">Πρώτα φτιάξε πακέτο ZIP. Το σβήσιμο δεν γυρίζει πίσω.</p>
      </section>`;
  });
}

// ---------- Περιοχή έρευνας ----------
async function loadCatalog() {
  try {
    const r = await fetch('areas/areas.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const list = (j.areas || []).filter((a) => !validArea(a));
    S.catalog = list;
    S.catalogErr = null;
  } catch (e) {
    console.error(e);
    S.catalog = [];
    S.catalogErr = `Ο κατάλογος περιοχών δεν φορτώθηκε (${e.message}).`;
  }
}

function areaInfo(a) {
  const m2 = areaSquareMeters(a);
  const size = m2 >= 1e6 ? `${(m2 / 1e6).toFixed(1)} τ.χλμ.` : `${Math.round(m2 / 1000)} στρέμματα`;
  return `${a.poly.length} κορυφές · περίπου ${size}`;
}

// QR ως SVG, με τη βιβλιοθήκη qrcode-generator (καθολική μεταβλητή «qrcode»).
function qrSvg(text) {
  const q = qrcode(0, 'M');
  q.addData(text, 'Byte');
  q.make();
  return q.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
}

function shareCard(a) {
  let link;
  let code;
  try {
    link = areaLink(location.href, a);
    code = encodeArea(a);
  } catch (e) {
    return `<section class="card warnc"><p>Δεν φτιάχνεται QR: ${esc(e.message)}</p></section>`;
  }
  return `<section class="card share">
    <h2><i class="fa-solid fa-qrcode"></i> Μοιράσου την περιοχή</h2>
    <p>Οι μαθητές σκανάρουν το QR (με την κάμερα του tablet ή μέσα από την εφαρμογή: «<i class="fa-solid fa-camera"></i> Σκάναρε QR»).</p>
    <div class="qr" id="qrBox">${qrSvg(link)}</div>
    <p class="big-name">${esc(a.name)} <span class="code">${esc(a.code)}</span></p>
    <div class="btn-row">
      <button type="button" class="btn" data-act="copy" data-v="${esc(link)}"><i class="fa-solid fa-link"></i> Αντιγραφή συνδέσμου</button>
      <button type="button" class="btn" data-act="qr-png"><i class="fa-solid fa-image"></i> Αποθήκευση QR (εικόνα)</button>
      <button type="button" class="btn ghost" data-act="copy" data-v="${esc(JSON.stringify({ code: a.code, name: a.name, region: a.region || '', poly: a.poly }))}"><i class="fa-solid fa-clipboard-list"></i> Αντιγραφή για τον κατάλογο</button>
    </div>
    <details><summary>Ο κωδικός σε κείμενο (αν δεν δουλεύει το QR)</summary><p class="mono">${esc(code)}</p></details>
  </section>`;
}

function teacherCard() {
  const d = S.areaDraft || { name: '', code: '', poly: [] };
  const err = d.poly.length ? validArea(d) : null;
  return `<section class="card teacher">
    <h2><i class="fa-solid fa-chalkboard-user"></i> Νέα περιοχή (για καθηγητές)</h2>
    <p class="hint">Η περιοχή δεν είναι στον κατάλογο; Φτιάξε τη. Μετά δείξε το QR στους μαθητές.</p>
    <label class="field">Όνομα περιοχής<input data-ad="name" value="${esc(d.name)}" placeholder="π.χ. Παραλία Ρεθύμνου — 3ο Γυμνάσιο" autocomplete="off"></label>
    <label class="field">Σύντομος κωδικός (λατινικά, 3–16)<input data-ad="code" value="${esc(d.code)}" placeholder="π.χ. RETH26" autocomplete="off" spellcheck="false"></label>
    <p>${d.poly.length ? `<i class="fa-solid fa-check"></i> Περίγραμμα: ${esc(areaInfo(d))}` : '<i class="fa-regular fa-circle"></i> Δεν έχει περίγραμμα ακόμη.'}</p>
    <div class="btn-row">
      <button type="button" class="btn" data-act="area-draw"><i class="fa-solid fa-pen"></i> ${d.poly.length ? 'Άλλαξε' : 'Σχεδίασε'} στον χάρτη</button>
      <button type="button" class="btn" data-act="area-file"><i class="fa-solid fa-folder-open"></i> Από αρχείο KMZ / KML / GeoJSON</button>
    </div>
    ${err ? `<p class="hint warn"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(err)}</p>` : ''}
    <div class="btn-row"><button type="button" class="btn primary" data-act="area-save" ${d.poly.length >= 3 ? '' : 'disabled'}><i class="fa-solid fa-check"></i> Χρήση αυτής της περιοχής</button></div>
    <p class="hint">Για να μπει μόνιμα στον κατάλογο με σύντομο κωδικό: «<i class="fa-solid fa-clipboard-list"></i> Αντιγραφή για τον κατάλογο» και πρόσθεσέ τη στο αρχείο <b>areas/areas.json</b> της εφαρμογής.</p>
  </section>`;
}

function renderArea() {
  const q = S.areaQ;
  let results = [];
  let decoded = null;
  if (q.trim().length > 24) {
    try { decoded = decodeArea(q); } catch { decoded = null; }
  }
  if (S.catalog) results = searchCatalog(S.catalog, q);
  const list = decoded
    ? `<div class="arow"><div><b>${esc(decoded.name)}</b> <span class="code">${esc(decoded.code)}</span><br><small>${esc(areaInfo(decoded))}</small></div><button type="button" class="btn primary" data-act="area-use-code">Αυτή! <i class="fa-solid fa-check"></i></button></div>`
    : results.map((a) => `<div class="arow ${S.area && S.area.code === a.code ? 'on' : ''}"><div><b>${esc(a.name)}</b> <span class="code">${esc(a.code)}</span><br><small>${esc(a.region || '')} · ${esc(areaInfo(a))}</small></div>
        <button type="button" class="btn ${S.area && S.area.code === a.code ? '' : 'primary'}" data-act="area-use" data-code="${esc(a.code)}">${S.area && S.area.code === a.code ? '<i class="fa-solid fa-check"></i> Ενεργή' : 'Αυτή! <i class="fa-solid fa-check"></i>'}</button></div>`).join('');
  const empty = S.catalog === null ? '<p class="hint"><i class="fa-solid fa-hourglass-half"></i> Φορτώνω τον κατάλογο…</p>'
    : (list ? '' : `<p class="hint">Δεν βρέθηκε. Έλεγξε τον κωδικό ή ρώτα τον/την καθηγητή/τρια σου για το QR.${S.catalogErr ? ` ${esc(S.catalogErr)}` : ''}</p>`);
  keepScroll(() => {
    $('view-area').innerHTML = `
      <section class="card">
        <h2><i class="fa-solid fa-map-location-dot"></i> Πού ερευνούμε;</h2>
        ${S.area ? `<p class="big-name">Τώρα: <i class="fa-solid fa-location-dot"></i> ${esc(S.area.name)} <span class="code">${esc(S.area.code)}</span></p>` : ''}
        <div class="btn-row"><button type="button" class="btn primary big" data-act="scan"><i class="fa-solid fa-camera"></i> Σκάναρε QR</button></div>
        <label class="field">…ή γράψε τον κωδικό ή ένα όνομα<input id="areaQ" data-aq="1" value="${esc(q)}" placeholder="π.χ. RETH26 ή Ρέθυμνο" autocomplete="off" spellcheck="false"></label>
        <div class="alist">${list}</div>${empty}
      </section>
      ${S.area ? shareCard(S.area) : ''}
      ${S.teacherOpen ? teacherCard() : '<section class="card"><button type="button" class="btn ghost" data-act="teacher"><i class="fa-solid fa-chalkboard-user"></i> Είμαι καθηγητής/τρια: νέα περιοχή</button></section>'}
      <section class="card"><button type="button" class="btn" data-act="tab" data-tab="home"><i class="fa-solid fa-arrow-left"></i> Πίσω στην Αρχή</button></section>`;
  });
}

async function useArea(a, { quiet = false } = {}) {
  const err = validArea(a);
  if (err) throw new Error(err);
  const clean = { code: a.code, name: String(a.name).trim(), region: a.region || '', poly: a.poly };
  if (S.area && S.area.code === clean.code && JSON.stringify(S.area.poly) === JSON.stringify(clean.poly)) {
    if (!quiet) toast(`Η περιοχή «${clean.name}» είναι ήδη ενεργή`, 3500, ic('circle-check'));
    return;
  }
  if (S.area && !quiet) {
    const ok = await confirmBox(`Αλλαγή περιοχής σε «${clean.name}»; Οι καταγραφές που έχετε δεν σβήνονται.`, 'Ναι, αλλαγή');
    if (!ok) return;
  }
  S.area = clean;
  await setSetting('area', clean);
  setMapArea(clean);
  await refreshTiles();
  renderAll();
  switchTab('home');
  toast(`${clean.name}. Τώρα κατέβασε τους χάρτες (βήμα 2).`, 6000, ic('location-dot'));
  const el = document.querySelector('[data-step="2"]');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function areaFromFile(file) {
  const name = file.name.toLowerCase();
  let poly;
  if (name.endsWith('.kmz')) {
    const zip = await JSZip.loadAsync(file);
    const kml = Object.values(zip.files).find((f) => f.name.toLowerCase().endsWith('.kml'));
    if (!kml) throw new Error('Το KMZ δεν έχει αρχείο KML μέσα.');
    poly = polyFromKml(await kml.async('string'));
  } else if (name.endsWith('.kml')) {
    poly = polyFromKml(await file.text());
  } else if (name.endsWith('.geojson') || name.endsWith('.json')) {
    poly = polyFromGeoJson(JSON.parse(await file.text()));
  } else {
    throw new Error('Θέλω αρχείο .kmz, .kml ή .geojson.');
  }
  if (poly.length < 3) throw new Error('Το περίγραμμα έχει λιγότερες από 3 κορυφές.');
  const d = S.areaDraft || { name: '', code: '', poly: [] };
  d.poly = poly;
  if (!d.name) d.name = file.name.replace(/\.[^.]+$/, '');
  if (!d.code) d.code = suggestCode(d.name);
  S.areaDraft = d;
  renderArea();
  toast(`Περίγραμμα από αρχείο (${poly.length} κορυφές)`, 3500, ic('circle-check'));
}

async function drawArea() {
  const d = S.areaDraft || { name: '', code: '', poly: [] };
  S.areaDraft = d;
  switchTab('map');
  $('drawBanner').hidden = false;
  $('drawText').textContent = 'Πάτα στον χάρτη τις γωνίες της περιοχής, τη μία μετά την άλλη.';
  const poly = await startDrawing(d.poly);
  $('drawBanner').hidden = true;
  switchTab('area');
  if (poly && poly.length >= 3) {
    d.poly = poly;
    if (!d.code && d.name) d.code = suggestCode(d.name);
    renderArea();
    toast(`Περίγραμμα (${poly.length} κορυφές)`, 3500, ic('circle-check'));
  } else if (poly) {
    toast('Χρειάζονται τουλάχιστον 3 γωνίες.', 5000);
  }
}

// Ο σύνδεσμος/QR μπορεί να έχει #area=… (πλήρης περιοχή) ή #code=… (κωδικός καταλόγου).
async function handleHash() {
  if (!location.hash || location.hash.length < 3) return;
  let r;
  try {
    r = parseHash(location.hash);
  } catch (e) {
    toast(`Ο σύνδεσμος περιοχής δεν διαβάζεται: ${e.message}`, 9000);
    return;
  } finally {
    history.replaceState(null, '', location.pathname + location.search);
  }
  if (!r) return;
  if (r.area) await useArea(r.area);
  else if (r.code) await useCode(r.code);
}

async function useCode(code) {
  if (S.catalog === null) await loadCatalog();
  const a = (S.catalog || []).find((x) => x.code === normCode(code));
  if (!a) { toast(`Δεν βρέθηκε περιοχή με κωδικό ${code}.`, 7000); return; }
  await useArea(a);
}

// ---- Σάρωση QR με την κάμερα (βιβλιοθήκη jsQR, καθολική μεταβλητή «jsQR») ----
const SCAN = { stream: null, timer: null };

function stopScan() {
  clearInterval(SCAN.timer);
  SCAN.timer = null;
  if (SCAN.stream) SCAN.stream.getTracks().forEach((tr) => tr.stop());
  SCAN.stream = null;
  $('scanBox').hidden = true;
}

async function startScan() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast('Η κάμερα δεν είναι διαθέσιμη εδώ. Άνοιξε τον σύνδεσμο ή γράψε τον κωδικό.', 7000);
    return;
  }
  $('scanBox').hidden = false;
  $('scanText').textContent = 'Στόχευσε το QR μέσα στο πλαίσιο…';
  try {
    SCAN.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  } catch (e) {
    stopScan();
    toast(`Δεν άνοιξε η κάμερα (${e.name}). Δώσε άδεια κάμερας ή γράψε τον κωδικό.`, 8000);
    return;
  }
  const video = $('scanVideo');
  video.srcObject = SCAN.stream;
  await video.play().catch(() => {});
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  SCAN.timer = setInterval(() => {
    if (!video.videoWidth) return;
    const w = Math.min(800, video.videoWidth);
    const h = Math.round((video.videoHeight / video.videoWidth) * w);
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    const res = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
    if (!res || !res.data) return;
    stopScan();
    onScanned(res.data).catch((e) => toast(e.message, 8000));
  }, 250);
}

async function onScanned(text) {
  const i = text.indexOf('#');
  if (i >= 0) {
    const r = parseHash(text.slice(i));
    if (r && r.area) { await useArea(r.area); return; }
    if (r && r.code) { await useCode(r.code); return; }
  }
  if (text.length > 24) { await useArea(decodeArea(text)); return; }
  await useCode(text);
}

async function copyText(v) {
  try {
    await navigator.clipboard.writeText(v);
    toast('Αντιγράφηκε', 3500, ic('copy'));
  } catch {
    window.prompt('Αντίγραψε από εδώ:', v);
  }
}

// QR σε εικόνα PNG για εκτύπωση ή προβολή.
async function saveQrPng() {
  const svg = document.querySelector('#qrBox svg');
  if (!svg) return;
  const xml = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Το QR δεν έγινε εικόνα.')); img.src = url; });
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size + 120;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, size, size);
  g.fillStyle = '#123';
  g.font = 'bold 40px sans-serif';
  g.textAlign = 'center';
  g.fillText(`${S.area.name}`.slice(0, 44), size / 2, size + 50, size - 40);
  g.font = '34px sans-serif';
  g.fillText(`Κωδικός: ${S.area.code}`, size / 2, size + 100);
  URL.revokeObjectURL(url);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  saveBlob(blob, `QR_${S.area.code}.png`);
}

// ---------- Φόρμα σημείου (sheet) ----------
function nextQuadratDist(t) {
  const qs = pointsOf(t).filter((p) => p.kind === 'quadrat' && toNum(p.dist_m) !== null);
  const sp = toNum(t.spacing_m) || 10;
  if (!qs.length) return 0;
  return Math.max(...qs.map((p) => Number(p.dist_m))) + sp;
}

function nextPlotNo(t) {
  const ns = pointsOf(t).filter(isPlot).map((p) => Number(p.plot));
  return (ns.length ? Math.max(...ns) : 0) + 1;
}

function nextUnknownSeq(t) {
  const seqs = pointsOf(t).filter((p) => p.kind === 'unknown').map((p) => toNum(p.seq) || 0);
  return (seqs.length ? Math.max(...seqs) : 0) + 1;
}

function newPoint(kind, subject) {
  const t = activeT();
  const p = {
    id: uid('p'), transectId: t.id, kind, ts: nowIso(), updatedAt: nowIso(), dist_m: null, comment: '', pos: null, photoIds: [],
  };
  if (kind === 'quadrat') {
    Object.assign(p, {
      dist_m: isPlots(t) ? null : nextQuadratDist(t), zone: null, bare_pct: null, litter_pct: null, plants_pct: null, invasive_pct: null,
      species: [], species_other: '', species_count: null, lilies: null, footprint: '', topPhotoId: null, pins: [],
    });
    if (isPlots(t)) p.plot = nextPlotNo(t);
  }
  if (kind === 'pressure') p.pressure_type = null;
  if (kind === 'lilies') p.lilies = null;
  if (kind === 'invasive') { p.invasive_pct = null; p.species = ['carpobrotus']; }
  if (kind === 'unknown') p.seq = nextUnknownSeq(t);
  if (kind === 'zone') p.zone = null;
  if (kind === 'photo') {
    p.subject = subject || 'other';
    if (subject === 'inland' || subject === 'sea') p.dist_m = 0;
  }
  return p;
}

const numField = (label, f, val, attrs = '') => `<label class="field">${label}<input type="number" inputmode="decimal" step="any" min="0" data-f="${f}" data-t="num" value="${esc(val)}" ${attrs}></label>`;

function pctField(label, f, val) {
  const v = toNum(val);
  return `<div class="pct"><span class="plabel">${label}</span>
    <input type="range" min="0" max="100" step="5" value="${v === null ? 0 : v}" data-f="${f}" data-t="num" data-pct>
    <input type="number" class="num" inputmode="numeric" min="0" max="100" step="5" value="${v === null ? '' : v}" placeholder="—" data-f="${f}" data-t="num" data-pct><span>%</span></div>`;
}

function zoneButtons(d) {
  return `<div class="zones">${ZONES.map((z) => `<button type="button" class="zbtn ${toNum(d.zone) === z.n ? 'on' : ''}" style="--zc:${z.color}" data-act="set" data-f="zone" data-v="${z.n}" data-t="num"><b>${z.n}</b><span>${esc(z.short)}</span></button>`).join('')}</div>`;
}

function chipSet(f, items, cur) {
  return `<div class="chips">${items.map((it) => `<button type="button" class="chip ${cur === it.id ? 'on' : ''}" data-act="set" data-f="${f}" data-v="${esc(it.id)}">${esc(it.label)}</button>`).join('')}</div>`;
}

function speciesChips(d) {
  return `<div class="chips">${SPECIES.map((s) => `<button type="button" class="chip ${d.species.includes(s.id) ? 'on' : ''} ${s.invasive ? 'inv' : ''}" data-act="species" data-id="${s.id}">${esc(s.name)}</button>`).join('')}</div>`;
}

function photosBlock(sh, hint) {
  const list = sh.photos.filter((ph) => ph.id !== sh.draft.topPhotoId);
  const thumbs = list.map((ph) => `<div class="thumb"><img src="${ph.url}" alt="φωτογραφία"><button type="button" class="x" data-act="photo-del" data-pid="${esc(ph.id)}" aria-label="Διαγραφή φωτογραφίας"><i class="fa-solid fa-xmark"></i></button></div>`).join('');
  return `<div class="block"><h3>${sh.draft.kind === 'quadrat' ? 'Άλλες φωτογραφίες' : 'Φωτογραφίες'} (${list.length})</h3>
    ${hint ? `<p class="hint">${esc(hint)}</p>` : ''}
    <div class="thumbs">${thumbs}</div>
    <div class="btn-row"><button type="button" class="btn" data-act="photo-cam"><i class="fa-solid fa-camera"></i> Φωτογραφία</button><button type="button" class="btn ghost" data-act="photo-gal"><i class="fa-solid fa-image"></i> Από τη συλλογή</button></div></div>`;
}

// ---- Κάτοψη πλαισίου με πινέζες φυτών ----
function planBlock(sh) {
  const d = sh.draft;
  const top = sh.photos.find((ph) => ph.id === d.topPhotoId);
  if (!top) {
    return `<div class="block plan-empty"><h3>${ic('camera')} Κάτοψη (από πάνω)</h3>
      <p class="hint">Σταθείτε πάνω από το πλαίσιο. Κρατήστε το tablet <b>οριζόντια, παράλληλα με την άμμο</b>. Να φαίνονται και οι 4 γωνίες.</p>
      <div class="btn-row"><button type="button" class="btn primary big" data-act="top-cam">${ic('camera')} Φωτογραφία κάτοψης</button>
      <button type="button" class="btn ghost" data-act="top-gal">${ic('image')} Από τη συλλογή</button></div></div>`;
  }
  const sel = sh.pinSel;
  const pins = d.pins || [];
  const marks = pins.map((p, i) => `<button type="button" class="pin ${i === sel ? 'on' : ''}" style="left:${(p.x * 100).toFixed(2)}%;top:${(p.y * 100).toFixed(2)}%" data-act="pin-sel" data-i="${i}" aria-label="Πινέζα ${i + 1}">${i + 1}</button>`).join('');
  const list = pins.map((p, i) => `<li class="${i === sel ? 'on' : ''}" data-act="pin-sel" data-i="${i}"><span class="pin-n">${i + 1}</span> ${esc(pinLabel(p))}</li>`).join('');
  return `<div class="block"><h3>${ic('thumbtack')} Κάτοψη: πάτα πάνω σε ένα φυτό</h3>
    <p class="hint">${sh.pinMove ? `${ic('arrows-up-down-left-right')} Πάτα στη φωτογραφία τη νέα θέση της πινέζας ${sel + 1}.` : 'Κάθε πάτημα βάζει μια πινέζα. Μετά διάλεξε τι φυτό είναι.'}</p>
    <div class="plan ${sh.pinMove ? 'moving' : ''}" data-act="pin-add"><img src="${top.url}" alt="Κάτοψη πλαισίου" draggable="false">${marks}</div>
    <div class="btn-row"><button type="button" class="btn ghost small" data-act="top-cam">${ic('camera-rotate')} Νέα κάτοψη</button></div>
    ${sel !== null && sel !== undefined && pins[sel] ? pinEditor(pins[sel], sel) : ''}
    ${pins.length ? `<ol class="pin-list">${list}</ol>` : ''}
  </div>`;
}

function pinEditor(p, i) {
  const g = GUIDE.findIndex((x) => x.id === p.species);
  return `<div class="pin-edit">
    <div class="pin-edit-head"><span class="pin-n">${i + 1}</span><b>Τι φυτό είναι;</b></div>
    <div class="chips">${SPECIES.map((s) => `<button type="button" class="chip ${p.species === s.id ? 'on' : ''} ${s.invasive ? 'inv' : ''}" data-act="pin-sp" data-id="${s.id}">${esc(s.name)}</button>`).join('')}</div>
    <div class="grid2">
      <label class="field">Άλλο / άγνωστο (π.χ. «Α1»)<input data-pin="other" value="${esc(p.other)}" autocomplete="off"></label>
      <label class="field">Σημείωση (π.χ. «ανθισμένο»)<input data-pin="note" value="${esc(p.note)}" autocomplete="off"></label>
    </div>
    <div class="btn-row">
      ${g >= 0 ? `<button type="button" class="btn small" data-act="lb-open" data-s="${g}" data-i="0">${ic('leaf')} Δες στον οδηγό</button>` : ''}
      <button type="button" class="btn small" data-act="pin-move">${ic('arrows-up-down-left-right')} Μετακίνηση</button>
      <button type="button" class="btn small danger" data-act="pin-del">${ic('trash-can')} Σβήσε</button>
      <button type="button" class="btn small primary" data-act="pin-done">${ic('check')} Εντάξει</button>
    </div>
  </div>`;
}

function pinAt(el, e) {
  const img = el.querySelector('img');
  const r = img.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return null;
  return { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
}

// Κάθε είδος πινέζας μπαίνει και στη λίστα ειδών του πλαισίου.
function syncPinSpecies(d) {
  (d.pins || []).forEach((p) => {
    if (p.species && !d.species.includes(p.species)) d.species.push(p.species);
  });
  d.species_count = Math.max(toNum(d.species_count) || 0, d.species.length);
}

function renderSheet() {
  const sh = S.sheet;
  const d = sh.draft;
  const t = activeT();
  const parts = [];
  switch (d.kind) {
    case 'quadrat':
      if (isPlot(d)) {
        parts.push(`<div class="block"><h3>${ic('location-dot')} Πού είναι το πλαίσιο;</h3>${posBlock('sheet', d.pos, null)}</div>`);
      } else {
        parts.push(numField('Απόσταση από τη θάλασσα (μ.)', 'dist_m', d.dist_m));
      }
      parts.push(planBlock(sh));
      parts.push(`<div class="block"><h3>Ζώνη (0–4)${isPlot(d) ? ' — αν την ξέρετε' : ''}</h3>${zoneButtons(d)}</div>`);
      parts.push(`<div class="block"><h3>Κάλυψη του τετραγώνου (φαντάσου πίτσα σε 100 κομμάτια)</h3>
        ${pctField('Γυμνή άμμος', 'bare_pct', d.bare_pct)}
        ${pctField('Νεκρά φύλλα / ξύλα / φύκια', 'litter_pct', d.litter_pct)}
        ${pctField('Φυτά, σύνολο', 'plants_pct', d.plants_pct)}
        ${pctField('Εισβλητικά φυτά (μέσα στα φυτά)', 'invasive_pct', d.invasive_pct)}
        <div id="sumBox" class="sum"></div></div>`);
      parts.push(`<div class="block"><h3>Είδη φυτών</h3>${speciesChips(d)}
        <label class="field">Άλλα ή άγνωστα είδη (γράψε «Α1», «Α2»…)<input data-f="species_other" value="${esc(d.species_other)}" autocomplete="off"></label>
        <div class="grid2">${numField('Πόσα διαφορετικά είδη βλέπεις;', 'species_count', d.species_count, 'step="1"')}${numField('Κρινάκια μέσα στο τετράγωνο (άτομα)', 'lilies', d.lilies, 'step="1"')}</div></div>`);
      parts.push(`<div class="block"><h3>Υπάρχει μονοπάτι / αποτύπωμα παπουτσιού / ρόδα μέσα στο τετράγωνο;</h3>
        <div class="chips"><button type="button" class="chip ${d.footprint === 'yes' ? 'on' : ''}" data-act="set" data-f="footprint" data-v="yes">Ναι</button><button type="button" class="chip ${d.footprint === 'no' ? 'on' : ''}" data-act="set" data-f="footprint" data-v="no">Όχι</button></div></div>`);
      break;
    case 'pressure':
      parts.push(`<div class="block"><h3>Τι είδους πίεση;</h3>${chipSet('pressure_type', PRESSURES, d.pressure_type)}</div>`);
      parts.push(numField('Πού; Απόσταση από τη θάλασσα (μ.) — προαιρετικό', 'dist_m', d.dist_m));
      break;
    case 'lilies':
      parts.push(numField('Πόσα άτομα κρινάκι βλέπεις;', 'lilies', d.lilies, 'step="1"'));
      parts.push(numField('Απόσταση από τη θάλασσα (μ.) — προαιρετικό', 'dist_m', d.dist_m));
      parts.push('<p class="hint">Προστατευόμενο είδος. Μην το αγγίζεις.</p>');
      break;
    case 'invasive':
      parts.push(`<div class="block"><h3>Πόσο % της επιφάνειας καλύπτει περίπου;</h3>${pctField('Κάλυψη', 'invasive_pct', d.invasive_pct)}</div>`);
      parts.push(numField('Απόσταση από τη θάλασσα (μ.) — προαιρετικό', 'dist_m', d.dist_m));
      parts.push('<p class="hint">Μην το ξεριζώνεις μόνος σου, χωρίς ενήλικα. Κομμάτια του ξαναριζώνουν.</p>');
      break;
    case 'unknown':
      parts.push(`<p><b>Άγνωστο φυτό ${esc(d.seq)}</b></p>`);
      parts.push(numField('Απόσταση από τη θάλασσα (μ.) — προαιρετικό', 'dist_m', d.dist_m));
      break;
    case 'zone':
      parts.push(`<div class="block"><h3>Ποια ζώνη ξεκινά εδώ;</h3>${zoneButtons(d)}</div>`);
      parts.push(numField('Σε ποια απόσταση από τη θάλασσα (μ.)', 'dist_m', d.dist_m));
      break;
    case 'photo':
      parts.push(`<div class="block"><h3>Τι δείχνει;</h3>${chipSet('subject', PHOTO_SUBJECTS, d.subject)}</div>`);
      parts.push(numField('Απόσταση από τη θάλασσα (μ.) — προαιρετικό', 'dist_m', d.dist_m));
      break;
    default:
      throw new Error(`Άγνωστο είδος σημείου: ${d.kind}`);
  }
  const photoHint = {
    quadrat: 'Κοντινές φωτογραφίες φυτών, αν θέλετε.',
    unknown: 'Βγάλε καθαρή φωτογραφία φύλλου και άνθους ή ολόκληρου του φυτού.',
    pressure: 'Μία φωτογραφία της πίεσης.',
  }[d.kind];
  parts.push(photosBlock(sh, photoHint));
  const derived = d.pos ? null : effectivePos(d, t);
  if (!isPlot(d)) parts.push(`<div class="block"><h3>Θέση</h3>${posBlock('sheet', d.pos, derived)}</div>`);
  parts.push(`<label class="field">Σχόλιο<textarea data-f="comment" rows="2">${esc(d.comment)}</textarea></label>`);

  $('sheetTitle').innerHTML = `${kindIcon(d.kind)} ${esc(isPlot(d) ? pointName(d) : kindLabel(d.kind, t))}${sh.isNew ? '' : ' (αλλαγή)'}`;
  $('sheetDelete').hidden = sh.isNew;
  const body = $('sheetBody');
  const top = body.scrollTop;
  body.innerHTML = parts.join('');
  body.scrollTop = top;
  updateSum();
}

function updateSum() {
  const box = document.getElementById('sumBox');
  if (!box || !S.sheet) return;
  const d = S.sheet.draft;
  const sum = (toNum(d.bare_pct) || 0) + (toNum(d.litter_pct) || 0) + (toNum(d.plants_pct) || 0);
  const any = ['bare_pct', 'litter_pct', 'plants_pct'].some((f) => toNum(d[f]) !== null);
  const bad = any && (sum < 90 || sum > 110);
  const invBad = (toNum(d.invasive_pct) || 0) > (toNum(d.plants_pct) || 0);
  box.className = `sum ${any ? (bad ? 'warn' : 'ok') : ''}`;
  box.textContent = any
    ? `Σύνολο: ${sum}% ${bad ? '— πρέπει να είναι περίπου 100%' : '(εντάξει)'}${invBad ? ' · Τα εισβλητικά είναι περισσότερα από τα φυτά σύνολο.' : ''}`
    : 'Τα ποσοστά πρέπει να αθροίζουν περίπου 100%. Μην αγχώνεσαι για ακρίβεια 1–5%.';
}

async function openSheet(kind, id, subject) {
  const t = activeT();
  if (!t) { toast('Φτιάξε πρώτα ομάδα.'); return; }
  if (!t.mode && !id) { toast('Πρώτα διαλέξτε τρόπο έρευνας (Αρχή, βήμα 4).', 5000); return; }
  let draft;
  let photos = [];
  if (id) {
    const p = S.points.find((x) => x.id === id);
    if (!p) throw new Error('Δεν βρέθηκε η καταγραφή.');
    draft = structuredClone(p);
    const rows = await dbByIndex('photos', 'pointId', id);
    photos = rows.sort((a, b) => String(a.ts).localeCompare(String(b.ts)))
      .map((r) => ({ id: r.id, blob: r.blob, url: URL.createObjectURL(r.blob), isNew: false, ts: r.ts }));
  } else {
    draft = newPoint(kind, subject);
  }
  if (draft.kind === 'quadrat' && !Array.isArray(draft.pins)) draft.pins = [];
  S.sheet = {
    draft, photos, removed: [], isNew: !id, pinSel: null, pinMove: false,
  };
  S.returnTab = S.tab;
  renderSheet();
  $('sheet').hidden = false;
  document.body.classList.add('sheet-open');
}

function closeSheet() {
  if (S.sheet) S.sheet.photos.forEach((ph) => URL.revokeObjectURL(ph.url));
  S.sheet = null;
  $('sheet').hidden = true;
  document.body.classList.remove('sheet-open');
}

function validateDraft(d) {
  if (d.kind === 'quadrat' && !isPlot(d) && toNum(d.dist_m) === null) return 'Γράψε την απόσταση από τη θάλασσα.';
  if (d.kind === 'quadrat' && (d.pins || []).some((p) => !p.species && !String(p.other || '').trim())) return 'Κάποια πινέζα δεν έχει φυτό. Διάλεξε φυτό ή σβήσ’ την.';
  if (d.kind === 'pressure' && !d.pressure_type) return 'Διάλεξε τι είδους πίεση είναι.';
  if (d.kind === 'zone' && (toNum(d.zone) === null || toNum(d.dist_m) === null)) return 'Διάλεξε ζώνη και απόσταση.';
  return null;
}

async function saveSheet() {
  const sh = S.sheet;
  const d = sh.draft;
  const err = validateDraft(d);
  if (err) { toast(err, 5000); return; }
  if (d.kind === 'quadrat') {
    const sum = (toNum(d.bare_pct) || 0) + (toNum(d.litter_pct) || 0) + (toNum(d.plants_pct) || 0);
    const any = ['bare_pct', 'litter_pct', 'plants_pct'].some((f) => toNum(d[f]) !== null);
    if (any && (sum < 90 || sum > 110)) {
      const ok = await confirmBox(`Τα ποσοστά αθροίζουν ${sum}%. Πρέπει να είναι περίπου 100%. Να αποθηκευτεί έτσι;`, 'Ναι, αποθήκευση');
      if (!ok) return;
    }
  }
  if (isPlot(d) && !hasLatLon(d.pos)) {
    const ok = await confirmBox('Το πλαίσιο δεν έχει θέση. Να αποθηκευτεί και να μπει η θέση αργότερα;', 'Ναι, αργότερα');
    if (!ok) return;
  }
  if (d.kind === 'quadrat') syncPinSpecies(d);
  for (const ph of sh.photos.filter((x) => x.isNew)) {
    await dbPut('photos', { id: ph.id, pointId: d.id, transectId: d.transectId, ts: ph.ts, kind: d.kind, blob: ph.blob });
  }
  if (sh.removed.length) await dbDeleteMany('photos', sh.removed);
  d.photoIds = sh.photos.map((x) => x.id);
  await savePoint(d);
  const i = S.points.findIndex((p) => p.id === d.id);
  if (i >= 0) S.points[i] = d; else S.points.push(d);
  closeSheet();
  renderAll();
  toast('Αποθηκεύτηκε', 3500, ic('circle-check'));
}

async function cancelSheet() {
  const sh = S.sheet;
  if (sh && sh.isNew && sh.photos.length) {
    const ok = await confirmBox('Έχεις βγάλει φωτογραφίες που δεν αποθηκεύτηκαν. Να χαθούν;', 'Ναι, να χαθούν');
    if (!ok) return;
  }
  closeSheet();
}

async function deleteSheetPoint() {
  const sh = S.sheet;
  if (!sh || sh.isNew) return;
  const ok = await confirmBox('Να διαγραφεί αυτή η καταγραφή και οι φωτογραφίες της;', 'Ναι, διαγραφή');
  if (!ok) return;
  const id = sh.draft.id;
  const phs = await dbByIndex('photos', 'pointId', id);
  await dbDeleteMany('photos', phs.map((r) => r.id));
  await dbDelete('points', id);
  S.points = S.points.filter((p) => p.id !== id);
  closeSheet();
  renderAll();
  toast('Διαγράφηκε.');
}

// asTop: η πρώτη φωτογραφία γίνεται η κάτοψη του πλαισίου (αντικαθιστά την παλιά, οι πινέζες μένουν).
async function addPhotos(files, asTop = false) {
  if (!S.sheet) return;
  for (const f of files) {
    try {
      const blob = await resizeImage(f, asTop ? 2000 : 1600);
      const ph = { id: uid('f'), blob, url: URL.createObjectURL(blob), isNew: true, ts: nowIso() };
      S.sheet.photos.push(ph);
      if (asTop) {
        const d = S.sheet.draft;
        const old = S.sheet.photos.find((x) => x.id === d.topPhotoId);
        if (old) {
          S.sheet.photos = S.sheet.photos.filter((x) => x !== old);
          URL.revokeObjectURL(old.url);
          if (!old.isNew) S.sheet.removed.push(old.id);
          if ((d.pins || []).length) toast('Νέα κάτοψη. Οι πινέζες έμειναν: έλεγξε ότι πέφτουν πάνω στα φυτά.', 6000, ic('thumbtack'));
        }
        d.topPhotoId = ph.id;
        asTop = false;
      }
    } catch (e) {
      console.error(e);
      toast(`Η φωτογραφία δεν προστέθηκε: ${e.message}`, 6000);
    }
  }
  renderSheet();
}

// ---------- Συμβάντα ----------
function sheetInput(el) {
  const d = S.sheet.draft;
  const f = el.dataset.f;
  let v = el.value;
  if (el.dataset.t === 'num') {
    v = v === '' ? null : Number(v);
    if (Number.isNaN(v)) v = null;
  }
  d[f] = v;
  if (el.hasAttribute('data-pct')) {
    $('sheetBody').querySelectorAll(`[data-f="${f}"]`).forEach((o) => { if (o !== el) o.value = el.value; });
    updateSum();
  }
}

function transectInput(el) {
  const t = activeT();
  if (!t) return;
  const f = el.dataset.tf;
  let v = el.value;
  if (el.dataset.t === 'num') {
    v = v === '' ? null : Number(v);
    if (Number.isNaN(v)) v = null;
  }
  t[f] = v;
  if (['school', 'team', 'beach', 'members'].includes(f)) rememberIdentity(t).catch((e) => console.error(e));
  scheduleSaveTransect(t);
  renderTopbar();
}

function healthInput(el) {
  const t = activeT();
  if (!t) return;
  const path = el.dataset.hf;
  const h = t.health;
  if (path === 'proposal') h.proposal = el.value;
  else if (path.startsWith('why.')) h.why[path.slice(4)] = el.value;
  else if (path.startsWith('imp.')) h.impressions[Number(path.slice(4))] = el.value;
  else throw new Error(`Άγνωστο πεδίο υγείας: ${path}`);
  scheduleSaveTransect(t);
}

function onInput(e) {
  const el = e.target;
  if (!(el instanceof HTMLElement)) return;
  if (el.dataset.coord) {
    const [scope, k] = el.dataset.coord.split('|');
    S.coordDraft[scope] = S.coordDraft[scope] || { lat: '', lon: '' };
    S.coordDraft[scope][k] = el.value;
    return;
  }
  if (el.dataset.ad) {
    const d = S.areaDraft || { name: '', code: '', poly: [] };
    S.areaDraft = d;
    if (el.dataset.ad === 'name') {
      const auto = !d.code || d.code === suggestCode(d.name);
      d.name = el.value;
      if (auto) {
        d.code = suggestCode(d.name);
        const c = document.querySelector('[data-ad="code"]');
        if (c) c.value = d.code;
      }
    } else {
      d.code = normCode(el.value);
    }
    return;
  }
  if (el.dataset.aq) {
    S.areaQ = el.value;
    const pos = el.selectionStart;
    renderArea();
    const q = document.getElementById('areaQ');
    if (q) { q.focus(); q.setSelectionRange(pos, pos); }
    return;
  }
  if (el.dataset.pin && S.sheet) {
    const pin = S.sheet.draft.pins[S.sheet.pinSel];
    if (pin) {
      pin[el.dataset.pin] = el.value;
      const li = document.querySelector(`.pin-list li[data-i="${S.sheet.pinSel}"]`);
      if (li) li.innerHTML = `<span class="pin-n">${S.sheet.pinSel + 1}</span> ${esc(pinLabel(pin))}`;
    }
    return;
  }
  if (el.dataset.f && S.sheet && el.closest('#sheet')) sheetInput(el);
  else if (el.dataset.tf) transectInput(el);
  else if (el.dataset.hf) healthInput(el);
}

function switchTab(tab) {
  S.tab = tab;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${tab}`));
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'map') {
    showMap();
    refreshMap();
  }
  if (tab === 'guide') renderGuide();
  if (tab === 'area') {
    renderArea();
    if (S.catalog === null) loadCatalog().then(renderArea).catch((e) => console.error(e));
  }
  if (tab === 'export') refreshTiles().then(renderExport).catch((e) => console.error(e));
  $('views').scrollTop = 0;
}

function updateMapTools() {
  $('btnBase').textContent = `Υπόβαθρο: ${BASEMAPS[getBaseName()] ? BASEMAPS[getBaseName()].label : 'χωρίς'}`;
  $('btnScope').textContent = S.scope === 'active' ? 'Μόνο η διατομή μου' : 'Όλες οι ομάδες';
  const t = activeT();
  const n = S.points.filter((p) => !effectivePos(p, S.transects.find((x) => x.id === p.transectId))).length;
  const b = $('btnUnplaced');
  b.hidden = n === 0 || !t;
  b.innerHTML = `${ic('triangle-exclamation')} Χωρίς θέση (${n})`;
}

function refreshMap() {
  if (!S.mapReady) return;
  refreshMarkers({ transects: S.transects, points: S.points, scope: S.scope, activeId: S.activeId });
  updateMapTools();
}

function renderAll() {
  renderTopbar();
  renderHome();
  renderRecords();
  renderHealth();
  renderExport();
  renderArea();
  refreshMap();
}

async function refreshTiles() {
  for (const n of Object.keys(BASEMAPS)) {
    try {
      S.tiles[n] = await tileStatus(n);
    } catch (e) {
      console.error(e);
      S.tiles[n] = { total: 0, cached: 0 };
    }
  }
  S.storage = await storageInfo();
}

// Κατεβάζει δορυφορικό και απλό χάρτη, τον έναν μετά τον άλλο.
async function doTilesAll() {
  if (S.tileProg) return;
  if (!S.area) { toast('Πρώτα διάλεξε περιοχή.'); return; }
  let failed = 0;
  try {
    for (const name of ['sat', 'osm']) {
      S.tileProg = { name, done: 0, total: 0, failed: 0 };
      renderHome();
      const r = await downloadTiles(name, (p) => { S.tileProg = { name, ...p }; queueHomeRender(); });
      failed += r.failed;
    }
    toast(failed ? `Έτοιμο, αλλά ${failed} κομμάτια έλειψαν. Πάτα ξανά «Κατέβασμα».` : 'Οι χάρτες είναι στο tablet!', 7000, failed ? ic('triangle-exclamation') : ic('circle-check'));
  } catch (e) {
    console.error(e);
    toast(e.message, 9000);
  } finally {
    S.tileProg = null;
    await refreshTiles();
    renderAll();
  }
}

let homeRenderQueued = false;
function queueHomeRender() {
  if (homeRenderQueued) return;
  homeRenderQueued = true;
  requestAnimationFrame(() => { homeRenderQueued = false; if (S.tab === 'home') renderHome(); });
}

async function doExport(kind) {
  S.busy = kind;
  renderExport();
  try {
    const data = await collect(S.exportAll ? null : S.activeId);
    if (!data.transects.length) { toast('Δεν υπάρχουν δεδομένα για εξαγωγή.'); return; }
    const base = exportBaseName(data);
    if (kind === 'zip' || kind === 'share') {
      const blob = await buildPackage(data);
      if (kind === 'share') {
        try {
          await shareBlob(blob, `${base}.zip`, 'application/zip');
        } catch (e) {
          if (e.name !== 'AbortError') throw e;
          return;
        }
      } else {
        saveBlob(blob, `${base}.zip`);
      }
    } else if (kind === 'kmz') {
      saveBlob(await buildKmz(data), `${base}.kmz`);
    } else if (kind === 'csv') {
      saveBlob(buildCsv(data), `${base}.csv`);
    } else {
      throw new Error(`Άγνωστη εξαγωγή: ${kind}`);
    }
    S.lastExport = nowIso();
    await setSetting('lastExport', S.lastExport);
    const c = counts(data);
    toast(`Έτοιμο: ${c.nTransects} διατομές, ${c.nPoints} σημεία, ${c.nPhotos} φωτογραφίες.`, 5000);
  } finally {
    S.busy = null;
    renderExport();
  }
}

async function doImport(files) {
  let tot = { transects: 0, points: 0, photos: 0, missing: 0 };
  let importedArea = null;
  for (const f of files) {
    try {
      const r = await importPackage(f);
      if (r.area) importedArea = r.area;
      tot = {
        transects: tot.transects + r.transects, points: tot.points + r.points, photos: tot.photos + r.photos, missing: tot.missing + r.missing,
      };
    } catch (e) {
      console.error(e);
      toast(`${f.name}: ${e.message}`, 9000);
    }
  }
  if (!S.area && importedArea && !validArea(importedArea)) await useArea(importedArea, { quiet: true });
  await reloadFromDb();
  renderAll();
  toast(`Εισαγωγή: ${tot.transects} διατομές, ${tot.points} σημεία, ${tot.photos} φωτογραφίες${tot.missing ? `, ${tot.missing} φωτογραφίες έλειπαν από το αρχείο` : ''}.`, 7000);
}

async function handleAct(act, el, ev) {
  const t = activeT();
  switch (act) {
    case 'tab': switchTab(el.dataset.tab); break;
    case 'lb-open': LB.sp = Number(el.dataset.s); LB.i = Number(el.dataset.i); showLightbox(); break;
    case 'lb-step': {
      const n = GUIDE[LB.sp].photos.length;
      LB.i = (LB.i + Number(el.dataset.d) + n) % n;
      showLightbox();
      break;
    }
    case 'lb-close': $('lightbox').hidden = true; break;
    case 'pick-t':
      S.activeId = el.dataset.id;
      await setSetting('activeId', S.activeId);
      renderAll();
      break;
    case 'new-t': {
      if (!S.area) { toast('Πρώτα διάλεξε περιοχή (βήμα 1).'); break; }
      const nt = newTransect();
      S.transects.push(nt);
      S.activeId = nt.id;
      await saveTransect(nt);
      await setSetting('activeId', nt.id);
      renderAll();
      toast('Νέα ομάδα. Γράψτε τα στοιχεία σας.', 3500, ic('people-group'));
      break;
    }
    case 'del-t': {
      if (!t) break;
      const ok = await confirmBox(`Να διαγραφεί η διατομή «${tLabel(t)}» με όλα τα σημεία και τις φωτογραφίες της;`, 'Ναι, διαγραφή');
      if (!ok) break;
      const phs = await dbByIndex('photos', 'transectId', t.id);
      await dbDeleteMany('photos', phs.map((r) => r.id));
      await dbDeleteMany('points', pointsOf(t).map((p) => p.id));
      await dbDelete('transects', t.id);
      S.transects = S.transects.filter((x) => x.id !== t.id);
      S.points = S.points.filter((p) => p.transectId !== t.id);
      S.activeId = S.transects.length ? S.transects[0].id : null;
      await setSetting('activeId', S.activeId);
      renderAll();
      break;
    }
    case 'weather':
      if (t) {
        t.weather = t.weather ? `${t.weather}, ${el.dataset.v}` : el.dataset.v;
        await saveTransect(t);
        renderHome();
      }
      break;
    case 'spacing':
      if (t) { t.spacing_m = Number(el.dataset.v); await saveTransect(t); renderHome(); renderRecords(); }
      break;
    case 'len-from-map':
      if (t && mapLength(t) !== null) { t.length_m = Math.round(mapLength(t)); await saveTransect(t); renderHome(); }
      break;
    case 'pos': await doPos(el.dataset.scope, el.dataset.m); break;
    case 'new': await openSheet(el.dataset.kind, null, el.dataset.subject); break;
    case 'edit': await openSheet(null, el.dataset.id); break;
    case 'place-row': {
      const id = el.dataset.id;
      const p = S.points.find((x) => x.id === id);
      if (!p) break;
      const back = S.tab;
      S.placeLabel = pointName(p);
      switchTab('map');
      const pos = await startPlacing({ initial: p.pos || effectivePos(p, t) });
      $('placeBanner').hidden = true;
      switchTab(back);
      if (pos) {
        p.pos = pos;
        await savePoint(p);
        renderAll();
        toast('Η θέση μπήκε <i class="fa-solid fa-check"></i>');
      }
      break;
    }
    case 'set': {
      const d = S.sheet.draft;
      const f = el.dataset.f;
      let v = el.dataset.v;
      if (el.dataset.t === 'num') v = Number(v);
      d[f] = d[f] === v ? (typeof v === 'number' ? null : '') : v;
      renderSheet();
      break;
    }
    case 'species': {
      const d = S.sheet.draft;
      const id = el.dataset.id;
      const i = d.species.indexOf(id);
      if (i >= 0) d.species.splice(i, 1);
      else {
        d.species.push(id);
        d.species_count = Math.max(toNum(d.species_count) || 0, d.species.length);
        if (SPECIES.find((s) => s.id === id).invasive && !toNum(d.invasive_pct) && d.kind === 'quadrat') toast('Έβαλες εισβλητικό. Βάλε και το % κάλυψής του.', 5000);
      }
      renderSheet();
      break;
    }
    case 'set-mode': {
      if (!t) break;
      const m = el.dataset.v;
      if (t.mode && t.mode !== m && pointsOf(t).length) {
        const ok = await confirmBox(`Αλλαγή σε «${MODES[m].label}»; Οι καταγραφές σας μένουν όπως είναι.`, 'Ναι, αλλαγή');
        if (!ok) break;
      }
      t.mode = m;
      await saveTransect(t);
      renderAll();
      toast(MODES[m].label, 3500, ic(MODES[m].icon.replace('fa-solid fa-', '')));
      break;
    }
    case 'mode-change':
      if (t) { t.mode = null; renderHome(); }
      break;
    case 'top-cam': $('fileTop').click(); break;
    case 'top-gal': $('fileTopGal').click(); break;
    case 'pin-add': {
      const sh = S.sheet;
      if (!sh || !ev || ev.target.closest('.pin')) break;
      const at = pinAt(el, ev);
      if (!at) break;
      const d = sh.draft;
      if (sh.pinMove && d.pins[sh.pinSel]) {
        Object.assign(d.pins[sh.pinSel], at);
        sh.pinMove = false;
      } else {
        d.pins.push({ ...at, species: null, other: '', note: '' });
        sh.pinSel = d.pins.length - 1;
      }
      renderSheet();
      break;
    }
    case 'pin-sel':
      if (S.sheet) {
        const i = Number(el.dataset.i);
        S.sheet.pinSel = S.sheet.pinSel === i ? null : i;
        S.sheet.pinMove = false;
        renderSheet();
      }
      break;
    case 'pin-sp': {
      const sh = S.sheet;
      const pin = sh && sh.draft.pins[sh.pinSel];
      if (pin) { pin.species = pin.species === el.dataset.id ? null : el.dataset.id; renderSheet(); }
      break;
    }
    case 'pin-move': if (S.sheet) { S.sheet.pinMove = true; renderSheet(); } break;
    case 'pin-del': {
      const sh = S.sheet;
      if (sh && sh.draft.pins[sh.pinSel]) {
        sh.draft.pins.splice(sh.pinSel, 1);
        sh.pinSel = null;
        sh.pinMove = false;
        renderSheet();
      }
      break;
    }
    case 'pin-done': if (S.sheet) { S.sheet.pinSel = null; S.sheet.pinMove = false; renderSheet(); } break;
    case 'photo-cam': $('fileCam').click(); break;
    case 'photo-gal': $('fileGal').click(); break;
    case 'photo-del': {
      const sh = S.sheet;
      const i = sh.photos.findIndex((x) => x.id === el.dataset.pid);
      if (i >= 0) {
        const [ph] = sh.photos.splice(i, 1);
        URL.revokeObjectURL(ph.url);
        if (!ph.isNew) sh.removed.push(ph.id);
        renderSheet();
      }
      break;
    }
    case 'score':
      if (t) {
        const cur = toNum(t.health.scores[el.dataset.c]);
        const v = Number(el.dataset.v);
        t.health.scores[el.dataset.c] = cur === v ? null : v;
        await saveTransect(t);
        renderHealth();
      }
      break;
    case 'scope-export': S.exportAll = el.dataset.v === 'all'; renderExport(); break;
    case 'export': await doExport(el.dataset.k); break;
    case 'import': $('importFile').click(); break;
    case 'tiles-all': await doTilesAll(); break;
    case 'scan': await startScan(); break;
    case 'scan-close': stopScan(); break;
    case 'area-use': {
      const a = (S.catalog || []).find((x) => x.code === el.dataset.code);
      if (a) await useArea(a);
      break;
    }
    case 'area-use-code': await useArea(decodeArea(S.areaQ)); S.areaQ = ''; break;
    case 'teacher': S.teacherOpen = true; renderArea(); break;
    case 'area-draw': await drawArea(); break;
    case 'area-file': $('areaFile').click(); break;
    case 'area-save': {
      const d = S.areaDraft;
      const err = validArea(d);
      if (err) { toast(err, 6000); break; }
      await useArea(d);
      S.teacherOpen = false;
      S.areaDraft = null;
      switchTab('area');
      toast('Η περιοχή είναι έτοιμη. Δείξε το QR στους μαθητές.', 7000, ic('qrcode'));
      break;
    }
    case 'draw-undo': drawUndo(); break;
    case 'draw-ok': finishDrawing(true); break;
    case 'draw-cancel': finishDrawing(false); break;
    case 'copy': await copyText(el.dataset.v); break;
    case 'qr-png': await saveQrPng(); break;
    case 'persist': {
      const ok = await askPersistent();
      S.storage = await storageInfo();
      renderExport();
      renderHome();
      toast(ok ? 'Τα δεδομένα προστατεύονται' : 'Ο browser δεν το επέτρεψε. Εγκατέστησε την εφαρμογή στην αρχική οθόνη και δοκίμασε ξανά.', 7000, ok ? ic('shield-halved') : '');
      break;
    }
    case 'install':
      if (S.installEvent) {
        S.installEvent.prompt();
        await S.installEvent.userChoice;
        S.installEvent = null;
        renderExport();
      }
      break;
    case 'wipe': {
      const ok = await confirmBox('ΠΡΟΣΟΧΗ: θα διαγραφούν όλες οι διατομές, τα σημεία και οι φωτογραφίες από αυτό το tablet. Έκανες εξαγωγή;', 'Ναι, διαγραφή όλων');
      if (!ok) break;
      const ok2 = await confirmBox('Τελευταία ερώτηση. Η διαγραφή δεν αναιρείται. Συνέχεια;', 'Διαγραφή');
      if (!ok2) break;
      await dbClear('photos');
      await dbClear('points');
      await dbClear('transects');
      await reloadFromDb();
      renderAll();
      toast('Όλα διαγράφηκαν.');
      break;
    }
    default:
      throw new Error(`Άγνωστη ενέργεια: ${act}`);
  }
}

function bindEvents() {
  document.body.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    handleAct(el.dataset.act, el, e).catch((err) => {
      console.error(err);
      toast(`Σφάλμα: ${err.message}`, 8000);
    });
  });
  document.addEventListener('input', onInput);
  $('sheetSave').addEventListener('click', () => saveSheet().catch((err) => { console.error(err); toast(`Δεν αποθηκεύτηκε: ${err.message}`, 8000); }));
  $('sheetCancel').addEventListener('click', () => cancelSheet().catch((err) => console.error(err)));
  $('sheetDelete').addEventListener('click', () => deleteSheetPoint().catch((err) => { console.error(err); toast(`Σφάλμα: ${err.message}`, 8000); }));
  $('fileCam').addEventListener('change', (e) => { const fs = [...e.target.files]; e.target.value = ''; addPhotos(fs); });
  $('fileGal').addEventListener('change', (e) => { const fs = [...e.target.files]; e.target.value = ''; addPhotos(fs); });
  $('fileTop').addEventListener('change', (e) => { const fs = [...e.target.files]; e.target.value = ''; addPhotos(fs.slice(0, 1), true); });
  $('fileTopGal').addEventListener('change', (e) => { const fs = [...e.target.files]; e.target.value = ''; addPhotos(fs.slice(0, 1), true); });
  $('areaFile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) areaFromFile(f).catch((err) => { console.error(err); toast(err.message, 8000); }); });
  window.addEventListener('hashchange', () => { handleHash().catch((err) => toast(err.message, 8000)); });
  $('importFile').addEventListener('change', (e) => { const fs = [...e.target.files]; e.target.value = ''; doImport(fs).catch((err) => { console.error(err); toast(`Σφάλμα εισαγωγής: ${err.message}`, 8000); }); });

  $('placeOk').addEventListener('click', () => finishPlacing(true));
  $('placeCancel').addEventListener('click', () => finishPlacing(false));
  $('btnLocate').addEventListener('click', () => {
    const on = toggleLocate();
    $('btnLocate').classList.toggle('on', on);
  });
  $('btnFit').addEventListener('click', () => fitArea());
  $('btnBase').addEventListener('click', async () => {
    const order = ['sat', 'osm', 'none'];
    const next = order[(order.indexOf(getBaseName()) + 1) % order.length];
    setBase(next);
    await setSetting('basemap', next);
    updateMapTools();
  });
  $('btnScope').addEventListener('click', async () => {
    S.scope = S.scope === 'active' ? 'all' : 'active';
    await setSetting('scope', S.scope);
    refreshMap();
  });
  $('btnLegend').addEventListener('click', () => { $('legendBox').hidden = !$('legendBox').hidden; });
  $('btnUnplaced').addEventListener('click', () => {
    switchTab('records');
    document.getElementById('unplacedBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  window.addEventListener('online', () => { renderTopbar(); renderHome(); });
  window.addEventListener('offline', () => { renderTopbar(); renderHome(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPending(); });
  window.addEventListener('pagehide', () => { flushPending(); });
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvent = e; renderExport(); });
}

async function registerSw() {
  if (!('serviceWorker' in navigator)) {
    toast('Αυτός ο browser δεν υποστηρίζει λειτουργία εκτός σύνδεσης.', 8000);
    return;
  }
  try {
    await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
    S.swReady = true;
    renderHome();
    renderExport();
  } catch (e) {
    console.error(e);
    toast(`Η λειτουργία εκτός σύνδεσης δεν ενεργοποιήθηκε: ${e.message}`, 9000);
  }
}

function showFatal(err) {
  console.error(err);
  const v = document.getElementById('views');
  if (v) {
    v.innerHTML = `<section class="card warnc"><h2>Η εφαρμογή δεν ξεκίνησε</h2><p>${esc(err && err.message ? err.message : err)}</p><p class="hint">Κλείσε και άνοιξε ξανά την εφαρμογή. Τα δεδομένα σου δεν έχουν χαθεί.</p></section>`;
  }
}

async function boot() {
  await reloadFromDb();
  S.activeId = await getSetting('activeId', S.activeId);
  if (!activeT()) S.activeId = S.transects.length ? S.transects[0].id : null;
  S.identity = await getSetting('identity', {});
  S.scope = await getSetting('scope', 'active');
  S.lastExport = await getSetting('lastExport', null);
  S.area = await getSetting('area', null);
  if (S.area && validArea(S.area)) S.area = null;
  initMap($('map'), {
    onOpenPoint: (id) => { switchTab('records'); openSheet(null, id).catch((e) => toast(e.message, 6000)); },
    onPlaceMove: (ll) => {
      $('placeBanner').hidden = false;
      $('placeText').innerHTML = `Πάτησε στον χάρτη ή σύρε το ${ic('crosshairs')} για: ${esc(S.placeLabel || 'σημείο')} (${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)})`;
    },
    onLocateError: (e) => toast(gpsErrorText(e), 8000),
    onDrawChange: (n) => {
      $('drawText').textContent = n < 3 ? `Πάτα στον χάρτη τις γωνίες της περιοχής (${n} ως τώρα, θέλει τουλάχιστον 3).` : `${n} γωνίες. Πρόσθεσε κι άλλες ή πάτα «Έτοιμο».`;
      $('drawOk').disabled = n < 3;
    },
  });
  S.mapReady = true;
  setMapArea(S.area);
  setBase(await getSetting('basemap', 'sat'));
  bindEvents();
  renderAll();
  askPersistent().then(() => storageInfo()).then((s) => { S.storage = s; renderHome(); renderExport(); }).catch((e) => console.error(e));
  registerSw();
  refreshTiles().then(() => { renderHome(); renderExport(); }).catch((e) => console.error(e));
  loadCatalog().then(() => { if (S.tab === 'area') renderArea(); }).catch((e) => console.error(e));
  await handleHash();
}

boot().catch(showFatal);
