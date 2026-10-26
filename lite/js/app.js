// Αμμοθίνες lite. Εργαλείο πεδίου για μαθητές:
// φωτογραφίες, κάτοψη τετραγώνου πλαισίου με πλέγμα 10×10, πινέζες στον χάρτη, γρήγορος κατάλογος φυτών.
// Κοινός κώδικας με την πλήρη εφαρμογή (φάκελος ../js). Δική της βάση δεδομένων.
// Τα πακέτα ZIP είναι ίδια με της πλήρους: ανοίγουν και εκεί με «Εισαγωγή».
import {
  setDbName, dbGetAll, dbPut, dbDelete, dbDeleteMany, dbByIndex, dbClear, getSetting, setSetting, askPersistent, storageInfo,
} from '../../js/db.js';
import {
  effectivePos, getPosition, gpsErrorText, hasLatLon, toNum, haversine,
} from '../../js/geo.js';
import {
  validArea, areaCenter, areaBounds, decodeArea, parseHash, searchCatalog, normCode, coordPrefix, parseCoord, decimalsOf,
} from '../../js/area.js';
import { resizeImage } from '../../js/photos.js';
import {
  initMap, showMap, fitArea, setBase, getBaseName, refreshMarkers, startPlacing, finishPlacing, toggleLocate,
  BASEMAPS, tileStatus, downloadTiles, tilePlan, setMapArea,
} from '../../js/map.js';
import { pointName } from '../../js/rows.js';
import {
  collect, counts, buildPackage, buildKmz, buildCsv, exportBaseName, saveBlob, canShareFiles, shareBlob, importPackage,
} from '../../js/pack.js';
import {
  KINDS, ZONES, PRESSURES, SPECIES, LEVELS, SRC_LABEL, MODES,
} from '../../js/schema.js';
import {
  CATALOG, PLANTS_CACHE, OBS_URL, bigUrl, thumbUrl,
} from './catalog.js';
import { orderCorners, quadArea, drawOverlay } from './quadrat.js';

setDbName('ammothines-lite');

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
const LETTERS = ['Α', 'Β', 'Γ', 'Δ', 'Ε', 'ΣΤ', 'Ζ', 'Η'];
const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('el-GR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

let toastTimer = null;
function toast(msg, ms = 3500, icon = '') {
  const el = $('toast');
  el.innerHTML = `${icon ? `${icon} ` : ''}${esc(msg)}`;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function confirmBox(text, okLabel = 'Ναι') {
  return new Promise((resolve) => {
    $('dialogText').textContent = text;
    $('dialogOk').textContent = okLabel;
    $('dialog').hidden = false;
    const done = (v) => {
      $('dialog').hidden = true;
      $('dialogOk').onclick = null;
      $('dialogCancel').onclick = null;
      resolve(v);
    };
    $('dialogOk').onclick = () => done(true);
    $('dialogCancel').onclick = () => done(false);
  });
}

// ---------- Κατάσταση ----------
const S = {
  tab: 'work',
  workStep: 1, // 1: Διαδρομή, 2: Τετράγωνα Πλαίσια, 3: Παρατηρήσεις
  plantsOpen: false, // Αναδυόμενος οδηγός φυτών πάνω από κάθε οθόνη
  setupDone: false,
  area: null,
  areas: null, // κατάλογος περιοχών (../areas/areas.json)
  areaQ: '',
  transects: [],
  points: [],
  activeId: null,
  tiles: {},
  tileProg: null,
  plantsHave: 0,
  plantsProg: null,
  swReady: false,
  storage: null,
  mapReady: false,
  sheet: null,
  coord: {}, // πεδία συντεταγμένων ανά θέση: { start: {lat, lon}, ... }
  viewer: null, // { sp, i, zoom, pick }
  pickFor: null, // πού πάει το φυτό που θα διαλέξει ο μαθητής στον κατάλογο
  filter: { q: '', zone: null },
  busy: null,
  lastExport: null,
  installEvent: null,
  placeLabel: '',
};
const activeT = () => S.transects.find((t) => t.id === S.activeId) || null;
const pointsOf = (t) => S.points.filter((p) => p.transectId === t.id);
const speciesName = (id) => (SPECIES.find((s) => s.id === id) || { name: id }).name;

async function saveT(t) {
  t.updatedAt = nowIso();
  await dbPut('transects', t);
}
async function saveP(p) {
  p.updatedAt = nowIso();
  await dbPut('points', p);
  const i = S.points.findIndex((x) => x.id === p.id);
  if (i >= 0) S.points[i] = p; else S.points.push(p);
}

// ---------- Ετοιμασία: περιοχή, χάρτες, κατάλογος φυτών ----------
const tileOk = (n) => S.tiles[n] && S.tiles[n].total > 0 && S.tiles[n].cached === S.tiles[n].total;
const plantsTotal = () => CATALOG.reduce((a, sp) => a + sp.photos.length, 0);
const plantsOk = () => S.plantsHave >= plantsTotal();
const ready = () => !!S.area && tileOk('sat') && plantsOk() && S.swReady;

async function refreshTiles() {
  for (const n of Object.keys(BASEMAPS)) {
    try { S.tiles[n] = await tileStatus(n); } catch (e) { console.error(e); S.tiles[n] = { total: 0, cached: 0 }; }
  }
}

async function refreshPlants() {
  const cache = await caches.open(PLANTS_CACHE);
  let have = 0;
  for (const sp of CATALOG) {
    for (const p of sp.photos) {
      if (await cache.match(new URL(bigUrl(sp, p), location.href).href)) have += 1;
    }
  }
  S.plantsHave = have;
}

async function downloadPlants() {
  const cache = await caches.open(PLANTS_CACHE);
  const urls = CATALOG.flatMap((sp) => sp.photos.map((p) => new URL(bigUrl(sp, p), location.href).href));
  let done = 0;
  let failed = 0;
  S.plantsProg = { done, total: urls.length };
  for (const u of urls) {
    try {
      if (!(await cache.match(u))) {
        const r = await fetch(u, { cache: 'no-cache' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        await cache.put(u, r);
      }
    } catch (e) {
      failed += 1;
      console.warn('φωτογραφία φυτού:', u, e.message);
    }
    done += 1;
    S.plantsProg = { done, total: urls.length };
    queuePrep();
  }
  S.plantsProg = null;
  return failed;
}

async function prepareAll() {
  if (!S.area) { toast('Πρώτα διάλεξε περιοχή.'); return; }
  if (!navigator.onLine) { toast('Χρειάζεσαι wifi.', 5000, ic('wifi')); return; }
  let failed = 0;
  try {
    for (const name of ['sat', 'osm']) {
      S.tileProg = { name, done: 0, total: 0, failed: 0 };
      renderPrep();
      const r = await downloadTiles(name, (p) => { S.tileProg = { name, ...p }; queuePrep(); });
      failed += r.failed;
    }
    S.tileProg = null;
    failed += await downloadPlants();
  } catch (e) {
    console.error(e);
    toast(e.message, 9000, ic('triangle-exclamation'));
  } finally {
    S.tileProg = null;
    S.plantsProg = null;
    await refreshTiles();
    await refreshPlants();
    renderAll();
  }
  toast(failed ? `Έλειψαν ${failed} κομμάτια. Πάτα ξανά.` : 'Το tablet είναι έτοιμο για την παραλία!', 7000, failed ? ic('triangle-exclamation') : ic('circle-check'));
}

let prepQueued = false;
function queuePrep() {
  if (prepQueued) return;
  prepQueued = true;
  requestAnimationFrame(() => { prepQueued = false; if (S.tab === 'prep') renderPrep(); });
}

async function loadAreas() {
  try {
    const r = await fetch('../areas/areas.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    S.areas = ((await r.json()).areas || []).filter((a) => !validArea(a));
  } catch (e) {
    console.error(e);
    S.areas = [];
  }
}

async function useArea(a) {
  const err = validArea(a);
  if (err) throw new Error(err);
  S.area = { code: a.code, name: String(a.name).trim(), region: a.region || '', poly: a.poly };
  await setSetting('area', S.area);
  setMapArea(S.area);
  const t = activeT();
  if (t && !t.beach) {
    t.beach = S.area.name;
    t.areaCode = S.area.code;
    t.areaName = S.area.name;
    await saveT(t);
  }
  await refreshTiles();
  renderAll();
  toast(`${S.area.name}. Τώρα «Ετοίμασε το tablet» ή «Ξεκινάμε»!`, 5000, ic('location-dot'));
}

async function handleHash() {
  if (!location.hash || location.hash.length < 3) return;
  let r = null;
  try { r = parseHash(location.hash); } catch (e) { toast(`Ο σύνδεσμος περιοχής δεν διαβάζεται: ${e.message}`, 9000); }
  history.replaceState(null, '', location.pathname + location.search);
  if (r && r.area) await useArea(r.area);
  else if (r && r.code) await useCode(r.code);
}

async function useCode(code) {
  if (S.areas === null) await loadAreas();
  const a = S.areas.find((x) => x.code === normCode(code));
  if (!a) { toast(`Δεν βρέθηκε περιοχή με κωδικό ${code}.`, 7000); return; }
  await useArea(a);
}

// Σάρωση QR (jsQR)
const SCAN = { stream: null, timer: null };
function stopScan() {
  clearInterval(SCAN.timer);
  SCAN.timer = null;
  if (SCAN.stream) SCAN.stream.getTracks().forEach((tr) => tr.stop());
  SCAN.stream = null;
  $('scanBox').hidden = true;
}
async function startScan() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('Η κάμερα δεν είναι διαθέσιμη. Γράψε τον κωδικό.', 7000); return; }
  $('scanBox').hidden = false;
  $('scanText').textContent = 'Στόχευσε το QR μέσα στο πλαίσιο…';
  try {
    SCAN.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  } catch (e) {
    stopScan();
    toast(`Δεν άνοιξε η κάμερα (${e.name}). Γράψε τον κωδικό.`, 8000);
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

// ---------- Θέση (GPS, χάρτης, αριθμοί) ----------
function openCoord(scope, pos) {
  let lat = '';
  let lon = '';
  if (hasLatLon(pos)) { lat = Number(pos.lat).toFixed(5); lon = Number(pos.lon).toFixed(5); } else if (S.area) {
    const c = areaCenter(S.area);
    lat = coordPrefix(c.lat);
    lon = coordPrefix(c.lon);
  }
  S.coord[scope] = { lat, lon };
}

function posHtml(scope, pos, derived) {
  let icon = ic('circle', 'regular');
  let text = 'Χωρίς θέση ακόμη.';
  let cls = 'none';
  if (hasLatLon(pos)) {
    icon = ic('circle-check');
    text = `${SRC_LABEL[pos.src] || pos.src}${pos.acc ? ` (±${pos.acc} μ.)` : ''} · ${Number(pos.lat).toFixed(5)}, ${Number(pos.lon).toFixed(5)}`;
    cls = 'ok';
  } else if (derived) {
    icon = ic('calculator');
    text = `Υπολογίστηκε από τη γραμμή (${derived.lat.toFixed(5)}, ${derived.lon.toFixed(5)})`;
    cls = 'calc';
  }
  const c = S.coord[scope];
  return `<div class="pos ${cls}"><div class="pos-status">${icon} ${esc(text)}</div>
    <div class="btn-row">
      <button type="button" class="btn small primary" data-act="pos" data-scope="${scope}" data-m="gps">${ic('location-dot')} Πάρε θέση GPS</button>
      <button type="button" class="btn small" data-act="pos" data-scope="${scope}" data-m="map">${ic('map-location-dot')} Στον χάρτη</button>
      <button type="button" class="btn small ghost" data-act="pos" data-scope="${scope}" data-m="num">${ic('keyboard')} Με αριθμούς</button>
    </div>
    ${c ? `<div class="coords"><div class="grid2">
      <label class="field">Πλάτος (Β)<input data-coord="${scope}|lat" inputmode="decimal" value="${esc(c.lat)}" autocomplete="off"></label>
      <label class="field">Μήκος (Α)<input data-coord="${scope}|lon" inputmode="decimal" value="${esc(c.lon)}" autocomplete="off"></label></div>
      <button type="button" class="btn primary small" data-act="pos" data-scope="${scope}" data-m="num-save">${ic('check')} Βάλε αυτή τη θέση</button>
      <p class="hint">${ic('lightbulb')} Τα πρώτα ψηφία είναι γραμμένα. Συμπλήρωσε τα δεκαδικά.</p></div>` : ''}
  </div>`;
}

function getPos(scope) {
  const t = activeT();
  if (scope === 'sheet') return S.sheet.draft.pos;
  return t ? t[scope] : null;
}
async function setPosTo(scope, pos) {
  delete S.coord[scope];
  if (scope === 'sheet') { S.sheet.draft.pos = pos; renderSheet(); return; }
  const t = activeT();
  t[scope] = pos;
  await saveT(t);
  renderAll();
}

async function doPos(scope, m) {
  if (m === 'num') {
    if (S.coord[scope]) delete S.coord[scope]; else openCoord(scope, getPos(scope));
    if (scope === 'sheet') renderSheet(); else renderWork();
    return;
  }
  if (m === 'num-save') {
    const c = S.coord[scope] || {};
    const lat = parseCoord(c.lat, 90);
    const lon = parseCoord(c.lon, 180);
    if (lat === null || lon === null) { toast('Οι αριθμοί δεν είναι σωστοί. Π.χ. 35.37142 και 24.51533.', 7000); return; }
    if (Math.min(decimalsOf(c.lat), decimalsOf(c.lon)) < 4) {
      const ok = await confirmBox('Λίγα δεκαδικά: η θέση μπορεί να απέχει εκατοντάδες μέτρα. Τη βάζω έτσι;', 'Ναι, έτσι');
      if (!ok) return;
    }
    if (S.area) {
      const b = areaBounds(S.area);
      const far = haversine({ lat, lon }, areaCenter(S.area));
      if (far > Math.max(1500, 3 * haversine({ lat: b.south, lon: b.west }, { lat: b.north, lon: b.east }) / 2)) {
        const ok = await confirmBox(`Η θέση είναι ${(far / 1000).toFixed(1)} χλμ. μακριά από την περιοχή. Μήπως μπερδεύτηκαν τα ψηφία;`, 'Είναι σωστή');
        if (!ok) return;
      }
    }
    await setPosTo(scope, { lat, lon, src: 'manual', ts: nowIso() });
    toast('Η θέση μπήκε', 3000, ic('circle-check'));
    return;
  }
  if (m === 'gps') {
    try {
      toast('Ψάχνω θέση…', 20000, ic('hourglass-half'));
      const p = await getPosition();
      await setPosTo(scope, p);
      toast(`GPS (±${p.acc} μ.)`, 3000, ic('circle-check'));
    } catch (e) {
      toast(`${gpsErrorText(e)} Δοκίμασε «Στον χάρτη».`, 8000);
    }
    return;
  }
  // στον χάρτη
  const back = S.tab;
  if (scope === 'sheet') $('sheet').hidden = true;
  S.placeLabel = scope === 'start' ? 'Αρχή γραμμής (θάλασσα)' : scope === 'end' ? 'Τέλος γραμμής' : pointName(S.sheet.draft);
  switchTab('map');
  const pos = await startPlacing({ initial: getPos(scope) });
  $('placeBanner').hidden = true;
  switchTab(back);
  if (scope === 'sheet') $('sheet').hidden = false;
  if (pos) {
    openCoord(scope, pos);
    if (scope === 'sheet') S.sheet.draft.pos = pos; else { activeT()[scope] = pos; await saveT(activeT()); }
    if (scope === 'sheet') renderSheet(); else renderAll();
    toast('Η θέση μπήκε από τον χάρτη.', 4000, ic('circle-check'));
  }
}

// ---------- Οθόνες ----------
function renderTopbar() {
  const t = activeT();
  const sub = [S.area ? S.area.name : 'Χωρίς περιοχή', t ? t.team || 'Ομάδα 1' : '', t && t.mode ? MODES[t.mode].short : ''].filter(Boolean).join(' · ');
  $('topTitle').innerHTML = `<b>${ic('umbrella-beach')} Αμμοθίνες <span class="lite-tag">lite</span></b><small>${esc(sub)}</small>`;
  $('netBadge').innerHTML = navigator.onLine ? `${ic('wifi')}` : `${ic('plane')}`;
  $('netBadge').className = `net ${navigator.onLine ? 'on' : 'off'}`;
  $('btnPrepTop').classList.toggle('active', S.tab === 'prep');
  $('btnSendTop').classList.toggle('active', S.tab === 'send');
  const nP = S.points.length;
  $('sendBadge').innerHTML = nP ? `Αποστολή <span class="badge-cnt">${nP}</span>` : 'Αποστολή';
}

const tick = (ok, text) => `<li class="${ok ? 'ok' : 'no'}">${ok ? ic('check') : ic('circle', 'regular')} ${text}</li>`;

function renderPrep() {
  const t = activeT();
  const list = S.areas ? searchCatalog(S.areas, S.areaQ).slice(0, 6) : [];
  const tp = S.tileProg;
  const pp = S.plantsProg;
  const plan = S.area ? tilePlan('sat') : { urls: [] };
  const mb = Math.round((plan.urls.length * 25 + (S.area ? tilePlan('osm').urls.length * 12 : 0)) / 1000) + 18;
  const chips = S.transects.map((x) => `<button type="button" class="chip ${x.id === S.activeId ? 'on' : ''}" data-act="pick-t" data-id="${esc(x.id)}">${esc(x.team || 'Ομάδα')} · ${esc(MODES[x.mode] ? MODES[x.mode].short : '')}</button>`).join('');
  const modeCard = (m, title, text) => `<button type="button" class="mode-card ${t && t.mode === m ? 'on' : ''}" data-act="set-mode" data-v="${m}">
      <span class="mode-ic"><i class="${MODES[m].icon}"></i></span><b>${esc(title)}</b><span>${text}</span></button>`;
  $('view-prep').innerHTML = `
    <section class="card hero"><h1>${ic('sliders')} Αρχική Ρύθμιση Ομάδας</h1>
      <p>Μόλις ρυθμίσετε την περιοχή και την ομάδα σας, πατήστε <b>«Ξεκινάμε την Έρευνα!»</b> και η οθόνη αυτή θα κρυφτεί.</p>
      ${ready() ? `<p class="ready">${ic('circle-check')} Το tablet είναι πλήρως έτοιμο για την παραλία!</p>` : ''}
      <div class="btn-row">
        <button type="button" class="btn primary big" data-act="finish-prep">${ic('play')} Ξεκινάμε την Έρευνα!</button>
        <button type="button" class="btn big" data-act="tab" data-tab="map">${ic('map')} Κατευθείαν στον Χάρτη</button>
      </div>
    </section>

    <section class="card"><h2>${ic('people-group')} 1. Η Ομάδα και ο Τρόπος Εργασίας</h2>
      <div class="chips">${chips}<button type="button" class="chip add" data-act="new-t">${ic('plus')} Νέα ομάδα</button></div>
      ${t ? `<div class="grid2">
          <label class="field">Όνομα ομάδας<input data-tf="team" value="${esc(t.team)}" placeholder="π.χ. Ομάδα Α1" autocomplete="off"></label>
          <label class="field">Σχολείο<input data-tf="school" value="${esc(t.school)}" autocomplete="off"></label></div>
        <div class="grid2">
          <label class="field">Παραλία<input data-tf="beach" value="${esc(t.beach)}" autocomplete="off"></label>
          <label class="field">Μέλη ομάδας<input data-tf="members" value="${esc(t.members)}" autocomplete="off"></label></div>
        <h3>Πώς θα δουλέψετε σήμερα;</h3>
        <div class="modes">
          ${modeCard('focus', 'Α. Εστίαση σε Τετράγωνο Πλαίσιο (Προτείνεται)', 'Λίγες στάσεις από το κύμα ως τη θίνη και ανάλυση σε Τετράγωνο Πλαίσιο 1×1 μ.')}
          ${modeCard('protocol', 'Β. Πλήρης Διατομή με Τετράγωνα Πλαίσια', 'Γραμμή από τη θάλασσα στη στεριά και Τετράγωνο Πλαίσιο κάθε 10 μέτρα.')}
        </div>` : '<p class="hint">Πάτησε «Νέα ομάδα».</p>'}
    </section>

    <section class="card"><h2>${ic('map-location-dot')} 2. Περιοχή Έρευνας & Αποθήκευση Χαρτών</h2>
      ${S.area ? `<p class="big-name">${ic('location-dot')} ${esc(S.area.name)} <span class="code">${esc(S.area.code)}</span></p>` : '<p>Σκάναρε το QR του/της καθηγητή/τριας ή διάλεξε περιοχή:</p>'}
      <div class="btn-row"><button type="button" class="btn ${S.area ? '' : 'primary'}" data-act="scan">${ic('qrcode')} Σκάναρε QR</button></div>
      <label class="field">Αναζήτηση περιοχής ή κωδικός<input id="areaQ" data-aq="1" value="${esc(S.areaQ)}" placeholder="π.χ. RETH26 ή Ρέθυμνο" autocomplete="off"></label>
      <div class="alist">${list.map((a) => `<div class="arow"><div><b>${esc(a.name)}</b> <span class="code">${esc(a.code)}</span></div><button type="button" class="btn primary small" data-act="area-use" data-code="${esc(a.code)}">Επιλογή</button></div>`).join('') || '<p class="hint">Δεν βρέθηκε.</p>'}</div>
      <hr style="border:0;border-top:1px dashed var(--line);margin:14px 0">
      <ul class="steps">
        ${tick(tileOk('sat'), `Δορυφορικός χάρτης εκτός σύνδεσης: ${S.tiles.sat ? `${S.tiles.sat.cached}/${S.tiles.sat.total}` : '…'}`)}
        ${tick(plantsOk(), `Φωτογραφίες φυτών υψηλής ανάλυσης: ${S.plantsHave}/${plantsTotal()}`)}
        ${tick(S.swReady, 'Εφαρμογή έτοιμη για εργασία χωρίς internet')}
      </ul>
      ${tp ? `<progress max="${tp.total || 1}" value="${tp.done}"></progress><p class="hint">Χάρτης: ${tp.done}/${tp.total}</p>` : ''}
      ${pp ? `<progress max="${pp.total}" value="${pp.done}"></progress><p class="hint">Φυτά: ${pp.done}/${pp.total}</p>` : ''}
      <button type="button" class="btn" data-act="prepare" ${!S.area || tp || pp || !navigator.onLine ? 'disabled' : ''}>${ic('download')} ${tileOk('sat') && plantsOk() ? 'Επαναληπτική λήψη' : `Αποθήκευση χαρτών & φυτών (~${mb} MB)`}</button>
    </section>

    <div class="step-nav">
      <span></span>
      <button type="button" class="btn primary big" data-act="finish-prep">${ic('play')} Ξεκινάμε την Έρευνα!</button>
    </div>`;
}

// ---- Έρευνα (Καθοδηγούμενη Πορεία 3 Βημάτων) ----
function nextDist(t) {
  const qs = pointsOf(t).filter((p) => p.kind === 'quadrat' && toNum(p.dist_m) !== null);
  return qs.length ? Math.max(...qs.map((p) => Number(p.dist_m))) + (toNum(t.spacing_m) || 10) : 0;
}

function quadRow(p, t) {
  const eff = effectivePos(p, t);
  const b = toNum(p.bare_pct) || 0;
  const l = toNum(p.litter_pct) || 0;
  const pl = toNum(p.plants_pct) || 0;
  const hasCov = ['bare_pct', 'litter_pct', 'plants_pct'].some((f) => toNum(p[f]) !== null);
  const bits = [];
  if (toNum(p.dist_m) !== null) bits.push(`στα ${p.dist_m} μ.`);
  if (toNum(p.zone) !== null) bits.push(`ζώνη ${p.zone}`);
  if (hasCov) bits.push(`φυτά ${pl}% · άμμος ${b}%`);
  if ((p.species || []).length) bits.push(`${p.species.length} είδη φυτών`);
  return `<div class="row" data-act="edit" data-id="${esc(p.id)}">
    <div class="sym" style="background:${KINDS.quadrat.color}"><i class="${KINDS.quadrat.icon}"></i></div>
    <div class="rbody"><b>${esc(p.label || pointName(p))}</b><span class="meta">${esc(bits.join(' · ') || 'Πάτησε για επεξεργασία πλαισίου')}</span>
      ${hasCov ? `<div class="cov-bar"><div class="cov-seg" style="width:${b}%;background:#E8CF4F"></div><div class="cov-seg" style="width:${l}%;background:#B08968"></div><div class="cov-seg" style="width:${pl}%;background:#2F8A5B"></div></div>` : ''}
      <span class="badges">${p.topPhotoId ? `<span class="chip ok">${ic('camera')} κάτοψη</span>` : `<span class="chip warn">${ic('camera')} βάλε κάτοψη</span>`}
      ${p.quad ? `<span class="chip ok">${ic('border-all')} πλέγμα 10×10</span>` : ''}
      ${eff ? `<span class="chip ok">${ic('location-dot')} με θέση</span>` : `<span class="chip warn">${ic('triangle-exclamation')} χωρίς θέση</span>`}</span></div></div>`;
}

function renderWork() {
  const t = activeT();
  if (!t) {
    $('view-work').innerHTML = `<section class="card"><h2>${ic('compass')} Έρευνα Πεδίου</h2><p>Πρώτα ορίστε την ομάδα σας.</p>
      <button type="button" class="btn primary big" data-act="tab" data-tab="prep">${ic('sliders')} Αρχική Ρύθμιση</button></section>`;
    return;
  }
  const pts = pointsOf(t);
  const quads = pts.filter((p) => p.kind === 'quadrat').sort((a, b) => (toNum(a.dist_m) ?? 1e9) - (toNum(b.dist_m) ?? 1e9) || String(a.ts).localeCompare(String(b.ts)));
  const stops = pts.filter((p) => p.kind === 'stop').sort((a, b) => LETTERS.indexOf(a.letter) - LETTERS.indexOf(b.letter));
  const unknowns = pts.filter((p) => p.kind === 'unknown').sort((a, b) => a.seq - b.seq);
  const others = pts.filter((p) => !['quadrat', 'stop', 'unknown'].includes(p.kind));

  const step1Done = hasLatLon(t.start) || stops.length > 0;
  const step2Done = quads.length > 0;
  const step3Done = unknowns.length > 0 || others.length > 0 || (t.detective && t.detective.length > 0);

  const stepper = `<div class="stepper">
    <button type="button" class="step-btn ${S.workStep === 1 ? 'active' : ''} ${step1Done ? 'done' : ''}" data-act="work-step" data-step="1">
      <span class="step-num">${step1Done && S.workStep !== 1 ? ic('check') : '1'}</span>
      <span>Η Διαδρομή μας</span>
    </button>
    <button type="button" class="step-btn ${S.workStep === 2 ? 'active' : ''} ${step2Done ? 'done' : ''}" data-act="work-step" data-step="2">
      <span class="step-num">${step2Done && S.workStep !== 2 ? ic('check') : '2'}</span>
      <span>Τετράγωνα Πλαίσια (${quads.length})</span>
    </button>
    <button type="button" class="step-btn ${S.workStep === 3 ? 'active' : ''} ${step3Done ? 'done' : ''}" data-act="work-step" data-step="3">
      <span class="step-num">${step3Done && S.workStep !== 3 ? ic('check') : '3'}</span>
      <span>Παρατηρήσεις (${unknowns.length + others.length + (t.detective ? t.detective.length : 0)})</span>
    </button>
  </div>`;

  if (S.workStep === 1) {
    const stopRow = (p) => `<div class="stop">
        <div class="stop-h"><b>${esc(p.letter)}</b>
          <label>απόσταση από κύμα:<input type="number" inputmode="decimal" min="0" step="any" data-pf="${esc(p.id)}|dist_m" value="${esc(p.dist_m)}"> μ.</label>
          <button type="button" class="btn small ghost" data-act="del-point" data-id="${esc(p.id)}">${ic('trash-can')}</button></div>
        <label class="field">Τι παρατηρώ εδώ;<input data-pf="${esc(p.id)}|observe" value="${esc(p.observe)}" placeholder="π.χ. ψιλή άμμος, κοχύλια, πρώτα φυτά…" autocomplete="off"></label>
        <div class="chips">${LEVELS.map((l) => `<button type="button" class="chip ${p.level === l.id ? 'on' : ''}" data-act="stop-level" data-id="${esc(p.id)}" data-v="${l.id}">${ic('seedling')} ${esc(l.label)} φυτά</button>`).join('')}
          <span class="sep"></span>${ZONES.map((z) => `<button type="button" class="chip zchip ${toNum(p.zone) === z.n ? 'on' : ''}" style="--zc:${z.color}" data-act="stop-zone" data-id="${esc(p.id)}" data-v="${z.n}">Ζώνη ${z.n}</button>`).join('')}</div>
      </div>`;

    $('view-work').innerHTML = `${stepper}
      <section class="card"><h2>${ic('route')} Βήμα 1: Η Γραμμή μας από τη Θάλασσα στη Θίνη</h2>
        <div class="line-pic" aria-hidden="true"><span>${ic('water')} Θάλασσα (0 μ.)</span><i></i><span>${ic('tree')} Αμμοθίνες</span></div>
        <h3>${ic('water')} Αρχή διαδρομής (δίπλα στο κύμα)</h3>${posHtml('start', t.start)}
        <h3>${ic('tree')} Τέλος διαδρομής${t.mode === 'focus' ? ' (εκεί που βάλατε το Τετράγωνο πλαίσιο)' : ' (στη στεριά)'}</h3>${posHtml('end', t.end)}
        ${t.mode === 'protocol' ? `<div class="grid2"><label class="field">Μήκος γραμμής (μ.)<input type="number" inputmode="decimal" data-tf="length_m" data-t="num" value="${esc(t.length_m)}"></label>
          <label class="field">Τετράγωνο πλαίσιο κάθε (μ.)<input type="number" inputmode="decimal" data-tf="spacing_m" data-t="num" value="${esc(t.spacing_m)}"></label></div>` : ''}
      </section>
      ${t.mode !== 'protocol' ? `<section class="card"><h2>${ic('flag')} Στάσεις στη Διαδρομή (${stops.length})</h2>
        <p class="hint">Περπατήστε από το κύμα προς τη θίνη και κάντε 2–4 σύντομες στάσεις παρατήρησης.</p>
        ${stops.map(stopRow).join('')}
        <button type="button" class="btn primary" data-act="new-stop" ${stops.length >= LETTERS.length ? 'disabled' : ''}>${ic('plus')} Προσθήκη Στάσης ${esc(LETTERS[stops.length] || '')}</button>
      </section>` : ''}
      <div class="step-nav">
        <button type="button" class="btn" data-act="tab" data-tab="map">${ic('map')} Δες στον Χάρτη</button>
        <button type="button" class="btn primary big" data-act="work-step" data-step="2">Συνέχεια: 2. Τετράγωνα Πλαίσια ${ic('arrow-right')}</button>
      </div>`;
    return;
  }

  if (S.workStep === 2) {
    $('view-work').innerHTML = `${stepper}
      <section class="card"><h2>${ic('vector-square')} Βήμα 2: Τετράγωνο Πλαίσιο (1×1 μ.)</h2>
        <p class="hint">Ακουμπήστε το τετράγωνο πλαίσιο 1×1 μ. στην άμμο, βγάλτε φωτογραφία από πάνω για το πλέγμα 10×10 και μετρήστε την κάλυψη και τα φυτά.</p>
        <div class="btn-row" style="margin:12px 0">
          <button type="button" class="btn primary big" data-act="new" data-kind="quadrat">${ic('plus')} ${t.mode === 'protocol' ? `Νέο Τετράγωνο Πλαίσιο (στα ${nextDist(t)} μ.)` : 'Νέο Τετράγωνο Πλαίσιο'}</button>
          <button type="button" class="btn big" data-act="tab" data-tab="map">${ic('map-location-dot')} Από τον Χάρτη</button>
        </div>
        ${quads.map((p) => quadRow(p, t)).join('') || '<p class="hint">Δεν έχετε προσθέσει ακόμη Τετράγωνο πλαίσιο. Πατήστε το κουμπί παραπάνω για να ξεκινήσετε!</p>'}
      </section>
      <div class="step-nav">
        <button type="button" class="btn" data-act="work-step" data-step="1">${ic('arrow-left')} 1. Διαδρομή</button>
        <button type="button" class="btn primary big" data-act="work-step" data-step="3">Συνέχεια: 3. Παρατηρήσεις ${ic('arrow-right')}</button>
      </div>`;
    return;
  }

  // Βήμα 3: Παρατηρήσεις & Ντετέκτιβ Φυτών
  $('view-work').innerHTML = `${stepper}
    <section class="card"><h2>${ic('magnifying-glass')} Βήμα 3: Ντετέκτιβ Φυτών & Παρατηρήσεις Πεδίου</h2>
      <p class="hint">Καταγράψτε ξεχωριστά φυτά, κρινάκια, ανθρώπινες πιέσεις ή βγάλτε πανοραμικές φωτογραφίες.</p>
      <div class="kindgrid" style="margin:12px 0">
        <button type="button" class="kbtn" style="--kc:${KINDS.lilies.color}" data-act="new" data-kind="lilies"><i class="${KINDS.lilies.icon}"></i><b>Κρινάκια</b><small>ομάδα / άτομα</small></button>
        <button type="button" class="kbtn" style="--kc:${KINDS.pressure.color}" data-act="new" data-kind="pressure"><i class="${KINDS.pressure.icon}"></i><b>Ανθρώπινη πίεση</b><small>σκουπίδια, ίχνη</small></button>
        <button type="button" class="kbtn" style="--kc:${KINDS.invasive.color}" data-act="new" data-kind="invasive"><i class="${KINDS.invasive.icon}"></i><b>Εισβλητικό</b><small>χουζούρι</small></button>
        <button type="button" class="kbtn" style="--kc:${KINDS.unknown.color}" data-act="new" data-kind="unknown"><i class="${KINDS.unknown.icon}"></i><b>Άγνωστο φυτό</b><small>φωτογραφία</small></button>
        <button type="button" class="kbtn" style="--kc:${KINDS.photo.color}" data-act="new" data-kind="photo" data-subject="inland"><i class="${KINDS.photo.icon}"></i><b>Πανοραμική</b><small>φωτογραφία</small></button>
      </div>
      ${others.map((p) => `<div class="row" data-act="edit" data-id="${esc(p.id)}"><div class="sym" style="background:${KINDS[p.kind].color}"><i class="${KINDS[p.kind].icon}"></i></div>
        <div class="rbody"><b>${esc(pointName(p))}</b><span class="meta">${effectivePos(p, t) ? 'με θέση' : 'χωρίς θέση'}${(p.photoIds || []).length ? ` · ${p.photoIds.length} φωτό` : ''}</span></div></div>`).join('')}
      ${unknowns.map((p) => `<div class="row" data-act="edit" data-id="${esc(p.id)}"><div class="sym" style="background:${KINDS.unknown.color}"><i class="${KINDS.unknown.icon}"></i></div>
        <div class="rbody"><b>${esc(pointName(p))}</b><span class="meta">${esc(p.observe || '')}</span></div></div>`).join('')}
    </section>

    <section class="card"><h2>${ic('leaf')} Φυτό που Ξεχωρίσαμε στη Διαδρομή</h2>
      ${(t.detective || []).map((d, i) => `<div class="det"><span class="pin-n">${i + 1}</span><b>${esc(speciesName(d.species))}</b>
        <input data-det="${i}" value="${esc(d.why)}" placeholder="Το ξεχωρίσαμε γιατί…" autocomplete="off">
        <button type="button" class="btn small ghost" data-act="det-del" data-i="${i}">${ic('xmark')}</button></div>`).join('')}
      <div class="btn-row"><button type="button" class="btn" data-act="pick" data-for="det">${ic('leaf')} Επιλογή από τον Κατάλογο Φυτών</button></div>
    </section>

    <div class="step-nav">
      <button type="button" class="btn" data-act="work-step" data-step="2">${ic('arrow-left')} 2. Τετράγωνα Πλαίσια</button>
      <button type="button" class="btn primary big" data-act="tab" data-tab="send">${ic('paper-plane')} Έτοιμοι — Αποστολή</button>
    </div>`;
}

// ---- Χάρτης: κουμπιά Τετραγώνου Πλαισίου & πινεζών ----
const PIN_KINDS = ['quadrat', 'lilies', 'pressure', 'invasive', 'zone', 'photo'];
function renderPinBar() {
  $('pinBar').innerHTML = PIN_KINDS.map((k) => `<button type="button" class="pbtn ${k === 'quadrat' ? 'pbtn-main' : ''}" style="--kc:${KINDS[k].color}" data-act="pin-new" data-kind="${k}"><i class="${KINDS[k].icon}"></i><span>${esc(k === 'quadrat' ? '+ Πλαίσιο' : KINDS[k].short)}</span></button>`).join('');
}

function refreshMap() {
  if (!S.mapReady) return;
  refreshMarkers({ transects: S.transects, points: S.points, scope: 'active', activeId: S.activeId });
  $('btnBase').innerHTML = `${ic('layer-group')} ${BASEMAPS[getBaseName()] ? BASEMAPS[getBaseName()].label : 'χωρίς'}`;
}

// ---- Κατάλογος φυτών (Σύντομη Αναφορά παντού) ----
function openPlantsOverlay() {
  S.plantsOpen = true;
  renderPlants();
  $('view-plants').classList.add('overlay-open');
}

function closePlantsOverlay() {
  S.plantsOpen = false;
  S.pickFor = null;
  $('view-plants').classList.remove('overlay-open');
  if (S.sheet) $('sheet').hidden = false;
}

function renderPlants() {
  const q = S.filter.q.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const fold = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const list = CATALOG.filter((sp) => (!q || fold(`${sp.name} ${sp.latin}`).includes(q)) && (S.filter.zone === null || sp.zones.includes(S.filter.zone)));
  const pick = S.pickFor;
  $('view-plants').innerHTML = `
    <div class="plants-sticky">
      <h2>${ic('leaf')} Οδηγός Φυτών Αμμοθινών</h2>
      <button type="button" class="btn small" data-act="plants-close">${ic('xmark')} Κλείσιμο</button>
    </div>
    ${pick ? `<section class="card warnc"><b>${ic('hand-pointer')} Διάλεξε φυτό</b> για: ${esc(pick.label)}. Άνοιξέ το και πάτα «Αυτό είναι!».
      <button type="button" class="btn small" data-act="pick-cancel">Άκυρο</button></section>` : ''}
    <section class="card">
      <label class="field">Αναζήτηση φυτού (ελληνικά ή λατινικά)<input id="plantQ" data-pq="1" value="${esc(S.filter.q)}" placeholder="π.χ. κρινάκι, Pancratium" autocomplete="off"></label>
      <div class="chips"><button type="button" class="chip ${S.filter.zone === null ? 'on' : ''}" data-act="zone-filter" data-v="">Όλες οι ζώνες</button>
        ${ZONES.map((z) => `<button type="button" class="chip zchip ${S.filter.zone === z.n ? 'on' : ''}" style="--zc:${z.color}" data-act="zone-filter" data-v="${z.n}">Ζώνη ${z.n}: ${esc(z.short)}</button>`).join('')}</div>
    </section>
    <div class="pgrid">${list.map((sp) => `<button type="button" class="pcard ${sp.id === 'carpobrotus' ? 'inv' : ''}" data-act="sp-open" data-id="${esc(sp.id)}">
        <img src="${thumbUrl(sp, sp.photos[0])}" alt="" loading="lazy"><b>${esc(sp.name)}</b><i>${esc(sp.latin)}</i>
        <span class="zones-mini">${sp.zones.map((z) => `<em style="background:${ZONES[z].color}">${z}</em>`).join('')}</span></button>`).join('') || '<p class="hint">Δεν βρέθηκε φυτό.</p>'}</div>
    <section class="card"><p class="hint">Φωτογραφίες: iNaturalist, άδειες Creative Commons. Πατήστε σε ένα φυτό για μεγέθυνση και περιγραφή.</p></section>`;
}

// Πλήρης οθόνη με ζουμ (κουμπιά, διπλό πάτημα, δύο δάχτυλα).
const VZ = { scale: 1, x: 0, y: 0, pts: new Map(), start: null };
function applyZoom() {
  $('viewerImg').style.transform = `translate(${VZ.x}px, ${VZ.y}px) scale(${VZ.scale})`;
}
function resetZoom() { VZ.scale = 1; VZ.x = 0; VZ.y = 0; applyZoom(); }
function showViewer() {
  const v = S.viewer;
  const sp = CATALOG.find((x) => x.id === v.sp);
  const p = sp.photos[v.i];
  const img = $('viewerImg');
  img.onerror = () => { img.onerror = null; img.src = thumbUrl(sp, p); toast('Η μεγάλη φωτογραφία δεν είναι στο tablet. Κάνε «Αποθήκευση χαρτών & φυτών» στη Ρύθμιση.', 6000); };
  img.src = bigUrl(sp, p);
  resetZoom();
  $('viewerTitle').innerHTML = `<b>${esc(sp.name)}</b> <i>${esc(sp.latin)}</i>`;
  $('viewerCap').innerHTML = `<b>${v.i + 1}/${sp.photos.length}</b> ${esc(p.caption)}<br><small>${esc(sp.note)}</small><br><small>© ${esc(p.by)} · ${esc(p.lic)}${p.obs ? ` · <a href="${OBS_URL(p.obs)}" target="_blank" rel="noopener">iNaturalist</a>` : ''}</small>`;
  $('viewerPick').hidden = !S.pickFor && !(S.sheet && S.sheet.draft && S.sheet.draft.kind === 'quadrat');
  $('viewer').hidden = false;
}
function bindViewerGestures() {
  const st = $('viewerStage');
  const dist = () => { const [a, b] = [...VZ.pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  st.addEventListener('pointerdown', (e) => {
    st.setPointerCapture(e.pointerId);
    VZ.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    VZ.start = { scale: VZ.scale, x: VZ.x, y: VZ.y, d: VZ.pts.size === 2 ? dist() : 0, px: e.clientX, py: e.clientY };
  });
  st.addEventListener('pointermove', (e) => {
    if (!VZ.pts.has(e.pointerId)) return;
    VZ.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (VZ.pts.size === 2 && VZ.start.d) {
      VZ.scale = Math.min(6, Math.max(1, VZ.start.scale * (dist() / VZ.start.d)));
    } else if (VZ.pts.size === 1 && VZ.scale > 1) {
      VZ.x = VZ.start.x + (e.clientX - VZ.start.px);
      VZ.y = VZ.start.y + (e.clientY - VZ.start.py);
    }
    applyZoom();
  });
  const end = (e) => { VZ.pts.delete(e.pointerId); if (VZ.scale <= 1) resetZoom(); VZ.start = { scale: VZ.scale, x: VZ.x, y: VZ.y, d: 0, px: e.clientX, py: e.clientY }; };
  st.addEventListener('pointerup', end);
  st.addEventListener('pointercancel', end);
  st.addEventListener('dblclick', () => { VZ.scale = VZ.scale > 1 ? 1 : 2.5; if (VZ.scale === 1) resetZoom(); else applyZoom(); });
}

// ---- Αποστολή ----
function renderSend() {
  const nP = S.points.length;
  const nPh = S.points.reduce((a, p) => a + (p.photoIds ? p.photoIds.length : 0), 0);
  const b = (k, label, cls = '') => `<button type="button" class="btn ${cls}" data-act="export" data-k="${k}" ${S.busy ? 'disabled' : ''}>${S.busy === k ? `${ic('hourglass-half')} Ετοιμάζω…` : label}</button>`;
  const st = S.storage;
  $('view-send').innerHTML = `
    <section class="card"><h2>${ic('paper-plane')} Αποστολή & Εξαγωγή Δεδομένων</h2>
      <p>Στο tablet: <b>${S.transects.length}</b> ομάδες, <b>${nP}</b> καταγραφές, <b>${nPh}</b> φωτογραφίες.</p>
      <p class="hint">Τελευταία αποστολή: ${esc(fmtDateTime(S.lastExport))}</p>
      <div class="stack">
        ${b('zip', `${ic('box-archive')} Πακέτο ZIP (για τον/την καθηγητή/τρια)`, 'primary big')}
        ${canShareFiles() ? b('share', `${ic('share-from-square')} Άμεση Κοινοποίηση`) : ''}
        ${b('kmz', `${ic('earth-europe')} Αρχείο KMZ για Google Earth / My Maps`)}
        ${b('csv', `${ic('file-csv')} Πίνακας CSV (Excel)`)}
      </div>
      <p class="hint">Το ZIP περιέχει και τις κατόψεις των τετραγώνων πλαισίων με το πλέγμα 10×10.</p>
      <button type="button" class="btn" data-act="import">${ic('file-import')} Εισαγωγή πακέτου ZIP</button>
    </section>
    <section class="card"><h2>${ic('screwdriver-wrench')} Διαχείριση Tablet</h2>
      <ul class="plain"><li>Χώρος που χρησιμοποιείται: ${st && st.usage ? `${Math.round(st.usage / 1e6)} MB` : '—'}</li>
        <li>Προστασία δεδομένων: ${st && st.persisted ? 'ναι' : 'όχι'}</li></ul>
      ${S.installEvent ? `<button type="button" class="btn" data-act="install">${ic('download')} Προσθήκη στην αρχική οθόνη</button>` : ''}
      <button type="button" class="btn danger" data-act="wipe">${ic('trash-can')} Διαγραφή όλων των δεδομένων</button>
    </section>`;
}

function renderAll() {
  renderTopbar();
  renderPrep();
  renderWork();
  renderPlants();
  renderSend();
  refreshMap();
}

function switchTab(tab) {
  if (tab === 'plants') {
    openPlantsOverlay();
    return;
  }
  S.plantsOpen = false;
  $('view-plants').classList.remove('overlay-open');
  S.tab = tab;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${tab}`));
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  renderTopbar();
  if (tab === 'map') { showMap(); refreshMap(); }
  $('views').scrollTop = 0;
}

// ---------- Παράθυρο Καταγραφής (Τετράγωνο πλαίσιο, άγνωστο φυτό, πινέζα, φωτογραφία) ----------
function newPoint(kind, extra = {}) {
  const t = activeT();
  const p = {
    id: uid('p'), transectId: t.id, kind, ts: nowIso(), updatedAt: nowIso(), dist_m: null, comment: '', pos: null, photoIds: [], ...extra,
  };
  if (kind === 'quadrat') {
    const n = pointsOf(t).filter((x) => x.kind === 'quadrat').length + 1;
    Object.assign(p, {
      dist_m: t.mode === 'protocol' ? nextDist(t) : null, zone: null, bare_pct: null, litter_pct: null, plants_pct: null, invasive_pct: null,
      species: [], species_other: '', species_count: null, lilies: null, footprint: '', topPhotoId: null, quad: null, gridDark: false,
      label: t.mode === 'focus' ? `Τετράγωνο πλαίσιο ${n}` : undefined,
    });
    if (t.mode === 'focus') p.plot = n;
  }
  if (kind === 'unknown') {
    const seqs = pointsOf(t).filter((x) => x.kind === 'unknown').map((x) => toNum(x.seq) || 0);
    p.seq = (seqs.length ? Math.max(...seqs) : 0) + 1;
    p.observe = '';
  }
  if (kind === 'pressure') p.pressure_type = null;
  if (kind === 'lilies') p.lilies = null;
  if (kind === 'invasive') { p.invasive_pct = null; p.species = ['carpobrotus']; }
  if (kind === 'zone') p.zone = null;
  if (kind === 'photo') p.subject = extra.subject || 'other';
  return p;
}

async function openSheet(p, isNew) {
  const rows = isNew ? [] : await dbByIndex('photos', 'pointId', p.id);
  const photos = rows.sort((a, b) => String(a.ts).localeCompare(String(b.ts))).map((r) => ({ id: r.id, blob: r.blob, url: URL.createObjectURL(r.blob), isNew: false, ts: r.ts }));
  S.sheet = {
    draft: structuredClone(p), photos, removed: [], isNew, corners: null, showGrid: true, zoom: 1, qTab: 'grid',
  };
  delete S.coord.sheet;
  renderSheet();
  $('sheet').hidden = false;
}

function closeSheet() {
  if (S.sheet) S.sheet.photos.forEach((ph) => URL.revokeObjectURL(ph.url));
  S.sheet = null;
  $('sheet').hidden = true;
}

function pctRowHtml(label, f, v, color) {
  return `<div class="pct-row" style="border-left: 6px solid ${color}">
    <div class="pct-label">${label}</div>
    <div class="pct-ctrls">
      <button type="button" class="pct-step" data-act="pct-step" data-f="${f}" data-d="-5">-5</button>
      <button type="button" class="pct-step" data-act="pct-step" data-f="${f}" data-d="-1">-1</button>
      <label class="pctf"><input type="number" inputmode="numeric" min="0" max="100" step="1" data-f="${f}" data-t="num" value="${esc(v)}"><b>%</b></label>
      <button type="button" class="pct-step" data-act="pct-step" data-f="${f}" data-d="1">+1</button>
      <button type="button" class="pct-step" data-act="pct-step" data-f="${f}" data-d="5">+5</button>
      <button type="button" class="pct-step" data-act="pct-step" data-f="${f}" data-d="10">+10</button>
    </div>
  </div>`;
}

function planHtml(sh, compact = false) {
  const d = sh.draft;
  const top = sh.photos.find((ph) => ph.id === d.topPhotoId);
  if (!top) {
    return `<div class="block plan-empty"><h3>${ic('camera')} 1. Φωτογραφία Κάτοψης (από πάνω)</h3>
      <p class="hint">Σταθείτε πάνω από το <b>Τετράγωνο πλαίσιο 1×1 μ.</b> Κρατήστε το tablet οριζόντια, παράλληλα με την άμμο, ώστε να φαίνονται καθαρά και οι 4 γωνίες.</p>
      <div class="btn-row"><button type="button" class="btn primary big" data-act="top-cam">${ic('camera')} Βγάλε Φωτογραφία Κάτοψης</button>
      <button type="button" class="btn" data-act="top-gal">${ic('image')} Από τη συλλογή</button></div></div>`;
  }
  const corners = sh.corners;
  const help = corners ? `${ic('hand-pointer')} Πατήστε πάνω στις 4 γωνίες του τετραγώνου πλαισίου (${corners.length}/4).`
    : d.quad ? 'Κάθε τετραγωνάκι του πλέγματος = 1%. Μετρήστε τα τετραγωνάκια!' : 'Πατήστε «Ορισμός 4 Γωνιών» και αγγίξτε τις 4 γωνίες του πλαισίου για να εμφανιστεί το πλέγμα 10×10.';
  return `<div class="block">
    ${compact ? '' : `<h3>${ic('border-all')} Κάτοψη Τετραγώνου Πλαισίου & Πλέγμα 10×10</h3>`}
    <p class="hint">${help}</p>
    <div class="qwrap ${compact ? 'compact' : ''}"><div class="qinner" style="width:${sh.zoom * 100}%" data-act="${corners ? 'corner' : 'noop'}">
      <img id="qImg" src="${top.url}" alt="Κάτοψη" draggable="false"><canvas id="qCanvas"></canvas></div></div>
    <div class="btn-row" style="margin-top:8px">
      <button type="button" class="btn small ${corners ? 'on' : 'primary'}" data-act="corners">${ic('vector-square')} ${corners ? 'Άκυρο γωνίες' : d.quad ? 'Αλλαγή 4 γωνιών' : 'Ορισμός 4 Γωνιών'}</button>
      <button type="button" class="btn small ${sh.showGrid ? 'on' : ''}" data-act="grid-toggle" ${d.quad ? '' : 'disabled'}>${ic('border-all')} Πλέγμα ${sh.showGrid ? 'ναι' : 'όχι'}</button>
      <button type="button" class="btn small" data-act="grid-dark" ${d.quad ? '' : 'disabled'}>${ic('circle-half-stroke')} ${d.gridDark ? 'Σκούρες' : 'Άσπρες'} γραμμές</button>
      <button type="button" class="btn small" data-act="qzoom" data-z="1">${ic('magnifying-glass-plus')}</button>
      <button type="button" class="btn small" data-act="qzoom" data-z="-1">${ic('magnifying-glass-minus')}</button>
      ${compact ? '' : `<button type="button" class="btn small ghost" data-act="top-cam">${ic('camera-rotate')} Νέα κάτοψη</button>`}
    </div></div>`;
}

function drawQuad() {
  const sh = S.sheet;
  const img = document.getElementById('qImg');
  const cv = document.getElementById('qCanvas');
  if (!sh || !img || !cv) return;
  const go = () => drawOverlay(cv, img, {
    quad: sh.corners ? null : sh.draft.quad, corners: sh.corners, showGrid: sh.showGrid, dark: !!sh.draft.gridDark,
  });
  if (img.complete && img.naturalWidth) go(); else img.onload = go;
}

function updateCoverDom(d) {
  const b = toNum(d.bare_pct) || 0;
  const l = toNum(d.litter_pct) || 0;
  const p = toNum(d.plants_pct) || 0;
  const sum = b + l + p;
  const any = ['bare_pct', 'litter_pct', 'plants_pct'].some((f) => toNum(d[f]) !== null);
  const box = document.getElementById('sumBox');
  if (box) {
    box.className = `sum ${any ? (Math.abs(sum - 100) <= 5 ? 'ok' : 'warn') : ''}`;
    box.textContent = any ? `Σύνολο: ${sum}% ${Math.abs(sum - 100) <= 5 ? '(εντάξει!)' : '— πρέπει να αθροίζουν 100%'}` : 'Άμμος + Νεκρά + Φυτά = 100%';
  }
  const segB = document.getElementById('segBare');
  const segL = document.getElementById('segLitter');
  const segP = document.getElementById('segPlants');
  if (segB) segB.style.width = `${Math.min(100, b)}%`;
  if (segL) segL.style.width = `${Math.min(100, l)}%`;
  if (segP) segP.style.width = `${Math.min(100, p)}%`;
}

function renderSheet() {
  const sh = S.sheet;
  const d = sh.draft;
  const t = activeT();
  const parts = [];
  if (d.kind === 'quadrat') {
    const qTab = sh.qTab || 'grid';
    const hasCov = ['bare_pct', 'litter_pct', 'plants_pct'].some((f) => toNum(d[f]) !== null);
    parts.push(`<div class="q-tabs">
      <button type="button" class="q-tab ${qTab === 'grid' ? 'active' : ''}" data-act="qtab" data-qtab="grid">${ic('border-all')} 1. Κάτοψη & Πλέγμα ${d.quad ? ic('check') : ''}</button>
      <button type="button" class="q-tab ${qTab === 'cover' ? 'active' : ''}" data-act="qtab" data-qtab="cover">${ic('chart-pie')} 2. Κάλυψη % ${hasCov ? ic('check') : ''}</button>
      <button type="button" class="q-tab ${qTab === 'plants' ? 'active' : ''}" data-act="qtab" data-qtab="plants">${ic('leaf')} 3. Φυτά (${(d.species || []).length})</button>
    </div>`);

    if (qTab === 'grid') {
      parts.push(planHtml(sh, false));
      parts.push(`<div class="block"><h3>${ic('location-dot')} Θέση Τετραγώνου Πλαισίου</h3>
        ${t.mode === 'protocol' ? '' : posHtml('sheet', d.pos)}
        <label class="field">Απόσταση από τη θάλασσα (μ.)<input type="number" inputmode="decimal" data-f="dist_m" data-t="num" value="${esc(d.dist_m)}" placeholder="π.χ. 10"></label></div>`);
      parts.push(`<div class="step-nav"><span></span><button type="button" class="btn primary" data-act="qtab" data-qtab="cover">Συνέχεια: 2. Κάλυψη (%) ${ic('arrow-right')}</button></div>`);
    } else if (qTab === 'cover') {
      if (d.topPhotoId) parts.push(planHtml(sh, true));
      const b = toNum(d.bare_pct) || 0;
      const l = toNum(d.litter_pct) || 0;
      const pl = toNum(d.plants_pct) || 0;
      const sum = b + l + pl;
      const any = ['bare_pct', 'litter_pct', 'plants_pct'].some((f) => toNum(d[f]) !== null);
      parts.push(`<div class="block"><h3>${ic('percent')} Ποσοστά Κάλυψης (1 τετραγωνάκι = 1%)</h3>
        <div class="cov-bar">
          <div id="segBare" class="cov-seg" style="width:${b}%;background:#E8CF4F" title="Γυμνή άμμος"></div>
          <div id="segLitter" class="cov-seg" style="width:${l}%;background:#B08968" title="Νεκρά υλικά"></div>
          <div id="segPlants" class="cov-seg" style="width:${pl}%;background:#2F8A5B" title="Φυτά"></div>
        </div>
        <div id="sumBox" class="sum ${any ? (Math.abs(sum - 100) <= 5 ? 'ok' : 'warn') : ''}">${any ? `Σύνολο: ${sum}% ${Math.abs(sum - 100) <= 5 ? '(εντάξει!)' : '— πρέπει να αθροίζουν 100%'}` : 'Άμμος + Νεκρά + Φυτά = 100%'}</div>
        <div class="pcts">
          ${pctRowHtml('Γυμνή άμμος', 'bare_pct', d.bare_pct, '#E8CF4F')}
          ${pctRowHtml('Νεκρά φύλλα / ξύλα / φύκια', 'litter_pct', d.litter_pct, '#B08968')}
          ${pctRowHtml('Φυτά, σύνολο', 'plants_pct', d.plants_pct, '#2F8A5B')}
          ${pctRowHtml('Εισβλητικά (μέσα στα φυτά)', 'invasive_pct', d.invasive_pct, '#7B3FA0')}
        </div></div>`);
      parts.push(`<div class="block"><h3>Ζώνη της Θίνας</h3><div class="zones">${ZONES.map((z) => `<button type="button" class="zbtn ${toNum(d.zone) === z.n ? 'on' : ''}" style="--zc:${z.color}" data-act="set" data-f="zone" data-v="${z.n}" data-t="num"><b>${z.n}</b><span>${esc(z.short)}</span></button>`).join('')}</div></div>`);
      parts.push(`<div class="step-nav"><button type="button" class="btn" data-act="qtab" data-qtab="grid">${ic('arrow-left')} 1. Κάτοψη</button><button type="button" class="btn primary" data-act="qtab" data-qtab="plants">Συνέχεια: 3. Φυτά ${ic('arrow-right')}</button></div>`);
    } else {
      // qTab === 'plants'
      const sel = new Set(d.species || []);
      parts.push(`<div class="block"><h3>${ic('leaf')} Ποια φυτά βρίσκονται μέσα στο Τετράγωνο πλαίσιο;</h3>
        <p class="hint">Πατήστε πάνω στη φωτογραφία κάθε φυτού που βλέπετε μέσα στο πλαίσιο (ή τον μεγεθυντικό φακό για μεγέθυνση).</p>
        <div class="sp-pick-grid">${CATALOG.map((sp) => {
          const isOn = sel.has(sp.id);
          return `<div class="sp-mini ${isOn ? 'on' : ''}">
            <button type="button" class="sp-mini-toggle" data-act="sp-toggle" data-id="${esc(sp.id)}">
              <span class="sp-mini-check">${isOn ? ic('check') : ''}</span>
              <img src="${thumbUrl(sp, sp.photos[0])}" alt="" loading="lazy">
              <b>${esc(sp.name)}</b>
            </button>
            <button type="button" class="sp-mini-zoom" data-act="sp-open" data-id="${esc(sp.id)}" title="Μεγέθυνση">${ic('magnifying-glass-plus')}</button>
          </div>`;
        }).join('')}</div>
        <label class="field">Άλλα / άγνωστα φυτά μέσα στο πλαίσιο (π.χ. «Άγνωστο 1»)<input data-f="species_other" value="${esc(d.species_other)}" autocomplete="off"></label>
        <div class="grid2"><label class="field">Πόσα διαφορετικά είδη συνολικά;<input type="number" inputmode="numeric" min="0" data-f="species_count" data-t="num" value="${esc(d.species_count)}"></label>
          <label class="field">Κρινάκια μέσα στο πλαίσιο (άτομα)<input type="number" inputmode="numeric" min="0" data-f="lilies" data-t="num" value="${esc(d.lilies)}"></label></div></div>`);
      const others = sh.photos.filter((ph) => ph.id !== d.topPhotoId);
      parts.push(`<div class="block"><h3>${ic('camera')} Κοντινές φωτογραφίες φυτών (${others.length})</h3>
        <div class="thumbs">${others.map((ph) => `<div class="thumb"><img src="${ph.url}" alt=""><button type="button" class="x" data-act="photo-del" data-pid="${esc(ph.id)}">${ic('xmark')}</button></div>`).join('')}</div>
        <button type="button" class="btn" data-act="photo-cam">${ic('camera')} Προσθήκη κοντινής φωτογραφίας</button></div>`);
      parts.push(`<label class="field">Σχόλιο ομάδας<textarea data-f="comment" rows="2">${esc(d.comment)}</textarea></label>`);
      parts.push(`<div class="step-nav"><button type="button" class="btn" data-act="qtab" data-qtab="cover">${ic('arrow-left')} 2. Κάλυψη (%)</button><span></span></div>`);
    }
  } else {
    if (d.kind === 'unknown') {
      parts.push(`<label class="field">Το ξεχώρισα γιατί…<input data-f="observe" value="${esc(d.observe)}" autocomplete="off"></label>`);
      parts.push(`<p class="hint">Βγάλτε καθαρή φωτογραφία φύλλου και άνθους για να το αναγνωρίσουμε.</p>`);
    } else if (d.kind === 'pressure') {
      parts.push(`<div class="chips">${PRESSURES.map((pr) => `<button type="button" class="chip ${d.pressure_type === pr.id ? 'on' : ''}" data-act="set" data-f="pressure_type" data-v="${pr.id}">${esc(pr.label)}</button>`).join('')}</div>`);
    } else if (d.kind === 'lilies') {
      parts.push(`<label class="field">Πόσα κρινάκια μετρήσατε;<input type="number" inputmode="numeric" min="0" data-f="lilies" data-t="num" value="${esc(d.lilies)}"></label>`);
    } else if (d.kind === 'invasive') {
      parts.push(`<label class="field">Πόσο % καλύπτει περίπου;<input type="number" inputmode="numeric" min="0" max="100" data-f="invasive_pct" data-t="num" value="${esc(d.invasive_pct)}"></label>`);
    } else if (d.kind === 'zone') {
      parts.push(`<div class="zones">${ZONES.map((z) => `<button type="button" class="zbtn ${toNum(d.zone) === z.n ? 'on' : ''}" style="--zc:${z.color}" data-act="set" data-f="zone" data-v="${z.n}" data-t="num"><b>${z.n}</b><span>${esc(z.short)}</span></button>`).join('')}</div>`);
    }
    parts.push(`<div class="block"><h3>${ic('location-dot')} Θέση</h3>${posHtml('sheet', d.pos)}</div>`);
    const others = sh.photos.filter((ph) => ph.id !== d.topPhotoId);
    parts.push(`<div class="block"><h3>${ic('camera')} Φωτογραφίες (${others.length})</h3>
      <div class="thumbs">${others.map((ph) => `<div class="thumb"><img src="${ph.url}" alt=""><button type="button" class="x" data-act="photo-del" data-pid="${esc(ph.id)}">${ic('xmark')}</button></div>`).join('')}</div>
      <button type="button" class="btn" data-act="photo-cam">${ic('camera')} Φωτογραφία</button></div>`);
    parts.push(`<label class="field">Σχόλιο<textarea data-f="comment" rows="2">${esc(d.comment)}</textarea></label>`);
  }

  $('sheetTitle').innerHTML = `<i class="${KINDS[d.kind].icon}"></i> ${esc(d.label || pointName(d))}`;
  $('sheetDelete').hidden = sh.isNew;
  const body = $('sheetBody');
  const top = body.scrollTop;
  body.innerHTML = parts.join('');
  body.scrollTop = top;
  drawQuad();
}

async function saveSheet() {
  const sh = S.sheet;
  const d = sh.draft;
  if (d.kind === 'quadrat' && activeT().mode === 'protocol' && toNum(d.dist_m) === null) { toast('Γράψε την απόσταση από τη θάλασσα (στο 1. Κάτοψη & Πλέγμα).', 5000); sh.qTab = 'grid'; renderSheet(); return; }
  if (d.kind === 'pressure' && !d.pressure_type) { toast('Διάλεξε τι είδους πίεση είναι.', 5000); return; }
  if (d.kind === 'quadrat') {
    const any = ['bare_pct', 'litter_pct', 'plants_pct'].some((f) => toNum(d[f]) !== null);
    const sum = ['bare_pct', 'litter_pct', 'plants_pct'].reduce((a, f) => a + (toNum(d[f]) || 0), 0);
    if (any && Math.abs(sum - 100) > 5 && !(await confirmBox(`Τα ποσοστά αθροίζουν ${sum}%. Να αποθηκευτεί έτσι;`, 'Ναι'))) return;
    if ((toNum(d.invasive_pct) || 0) > (toNum(d.plants_pct) || 0)) { toast('Τα εισβλητικά δεν μπορεί να είναι περισσότερα από τα φυτά σύνολο.', 6000); sh.qTab = 'cover'; renderSheet(); return; }
    d.species_count = Math.max(toNum(d.species_count) || 0, (d.species || []).length) || null;
  }
  for (const ph of sh.photos.filter((x) => x.isNew)) {
    await dbPut('photos', { id: ph.id, pointId: d.id, transectId: d.transectId, ts: ph.ts, kind: d.kind, blob: ph.blob });
  }
  if (sh.removed.length) await dbDeleteMany('photos', sh.removed);
  d.photoIds = sh.photos.map((x) => x.id);
  await saveP(d);
  closeSheet();
  renderAll();
  toast('Αποθηκεύτηκε!', 3000, ic('circle-check'));
}

async function addPhotos(files, asTop) {
  if (!S.sheet) return;
  for (const f of files) {
    try {
      const blob = await resizeImage(f, asTop ? 2400 : 1600, 0.85);
      const ph = { id: uid('f'), blob, url: URL.createObjectURL(blob), isNew: true, ts: nowIso() };
      S.sheet.photos.push(ph);
      if (asTop) {
        const d = S.sheet.draft;
        const old = S.sheet.photos.find((x) => x.id === d.topPhotoId);
        if (old) {
          S.sheet.photos = S.sheet.photos.filter((x) => x !== old);
          URL.revokeObjectURL(old.url);
          if (!old.isNew) S.sheet.removed.push(old.id);
        }
        d.topPhotoId = ph.id;
        d.quad = null;
        S.sheet.corners = [];
        toast('Τώρα πάτα τις 4 γωνίες του τετραγώνου πλαισίου.', 6000, ic('hand-pointer'));
      }
    } catch (e) {
      console.error(e);
      toast(`Η φωτογραφία δεν μπήκε: ${e.message}`, 6000);
    }
  }
  renderSheet();
}

async function ensureDefaultTeam() {
  if (S.transects.length) return activeT();
  const nt = {
    id: uid('t'), mode: 'focus', areaCode: S.area ? S.area.code : '', areaName: S.area ? S.area.name : '',
    school: '', team: 'Ομάδα 1', members: '', beach: S.area ? S.area.name : '',
    datetime: localIso(), weather: '', length_m: null, spacing_m: 10, start: null, end: null, notes: '', detective: [],
    health: { scores: {}, why: {}, impressions: ['', '', ''], proposal: '' }, createdAt: nowIso(),
  };
  S.transects.push(nt);
  S.activeId = nt.id;
  await saveT(nt);
  await setSetting('activeId', nt.id);
  return nt;
}

// ---------- Συμβάντα ----------
async function handleAct(act, el, ev) {
  let t = activeT();
  switch (act) {
    case 'tab': switchTab(el.dataset.tab); break;
    case 'work-step':
      S.workStep = Number(el.dataset.step) || 1;
      renderWork();
      $('views').scrollTop = 0;
      break;
    case 'finish-prep': {
      t = await ensureDefaultTeam();
      if (!t.mode) { t.mode = 'focus'; await saveT(t); }
      S.setupDone = true;
      await setSetting('setupDone', true);
      switchTab('work');
      renderAll();
      toast('Καλή έρευνα! Ξεκινάμε από το Βήμα 1 ή τα Τετράγωνα Πλαίσια.', 4000, ic('compass'));
      break;
    }
    case 'plants-open': openPlantsOverlay(); break;
    case 'plants-close': closePlantsOverlay(); break;
    case 'noop': break;
    case 'scan': await startScan(); break;
    case 'scan-close': stopScan(); break;
    case 'area-use': { const a = S.areas.find((x) => x.code === el.dataset.code); if (a) { S.areaQ = ''; await useArea(a); } break; }
    case 'prepare': await prepareAll(); break;
    case 'new-t': {
      const nt = {
        id: uid('t'), mode: 'focus', areaCode: S.area ? S.area.code : '', areaName: S.area ? S.area.name : '',
        school: '', team: `Ομάδα ${S.transects.length + 1}`, members: '', beach: S.area ? S.area.name : '',
        datetime: localIso(), weather: '', length_m: null, spacing_m: 10, start: null, end: null, notes: '', detective: [],
        health: { scores: {}, why: {}, impressions: ['', '', ''], proposal: '' }, createdAt: nowIso(),
      };
      S.transects.push(nt);
      S.activeId = nt.id;
      await saveT(nt);
      await setSetting('activeId', nt.id);
      renderAll();
      break;
    }
    case 'pick-t': S.activeId = el.dataset.id; await setSetting('activeId', S.activeId); renderAll(); break;
    case 'set-mode':
      if (t) { t.mode = el.dataset.v; await saveT(t); renderAll(); toast(MODES[t.mode].label, 3000, ic('check')); }
      break;
    case 'pos': await doPos(el.dataset.scope, el.dataset.m); break;
    case 'new-stop': {
      const n = pointsOf(t).filter((p) => p.kind === 'stop').length;
      await saveP(newPoint('stop', { letter: LETTERS[n], observe: '', level: null, zone: null }));
      renderWork();
      break;
    }
    case 'stop-level': case 'stop-zone': {
      const p = S.points.find((x) => x.id === el.dataset.id);
      if (act === 'stop-level') p.level = p.level === el.dataset.v ? null : el.dataset.v;
      else p.zone = toNum(p.zone) === Number(el.dataset.v) ? null : Number(el.dataset.v);
      await saveP(p);
      renderWork();
      break;
    }
    case 'del-point': {
      if (!(await confirmBox('Να σβηστεί;', 'Ναι, σβήσε'))) break;
      const phs = await dbByIndex('photos', 'pointId', el.dataset.id);
      await dbDeleteMany('photos', phs.map((r) => r.id));
      await dbDelete('points', el.dataset.id);
      S.points = S.points.filter((p) => p.id !== el.dataset.id);
      renderAll();
      break;
    }
    case 'new': {
      t = await ensureDefaultTeam();
      if (!t.mode) { t.mode = 'focus'; await saveT(t); }
      await openSheet(newPoint(el.dataset.kind, el.dataset.subject ? { subject: el.dataset.subject } : {}), true);
      break;
    }
    case 'edit': { const p = S.points.find((x) => x.id === el.dataset.id); if (p) await openSheet(p, false); break; }
    case 'pin-new': {
      t = await ensureDefaultTeam();
      if (!t.mode) { t.mode = 'focus'; await saveT(t); }
      const p = newPoint(el.dataset.kind);
      S.placeLabel = KINDS[p.kind].label;
      const pos = await startPlacing({});
      $('placeBanner').hidden = true;
      if (!pos) break;
      p.pos = pos;
      await openSheet(p, true);
      break;
    }
    case 'qtab':
      if (S.sheet) {
        S.sheet.qTab = el.dataset.qtab;
        renderSheet();
        $('sheetBody').scrollTop = 0;
      }
      break;
    case 'pct-step': {
      if (!S.sheet) break;
      const d = S.sheet.draft;
      const f = el.dataset.f;
      const delta = Number(el.dataset.d) || 0;
      const cur = toNum(d[f]) || 0;
      const next = Math.min(100, Math.max(0, cur + delta));
      d[f] = next;
      const inp = document.querySelector(`#sheetBody input[data-f="${f}"]`);
      if (inp) inp.value = String(next);
      updateCoverDom(d);
      break;
    }
    case 'sp-toggle': {
      if (!S.sheet) break;
      const d = S.sheet.draft;
      const id = el.dataset.id;
      d.species = d.species || [];
      if (d.species.includes(id)) d.species = d.species.filter((x) => x !== id);
      else d.species.push(id);
      d.species_count = Math.max(toNum(d.species_count) || 0, d.species.length) || null;
      renderSheet();
      break;
    }
    case 'set': {
      const d = S.sheet.draft;
      let v = el.dataset.v;
      if (el.dataset.t === 'num') v = Number(v);
      d[el.dataset.f] = d[el.dataset.f] === v ? null : v;
      renderSheet();
      break;
    }
    case 'top-cam': $('fileTop').click(); break;
    case 'top-gal': $('fileTopGal').click(); break;
    case 'photo-cam': $('fileCam').click(); break;
    case 'photo-del': {
      const sh = S.sheet;
      const i = sh.photos.findIndex((x) => x.id === el.dataset.pid);
      if (i >= 0) { const [ph] = sh.photos.splice(i, 1); URL.revokeObjectURL(ph.url); if (!ph.isNew) sh.removed.push(ph.id); renderSheet(); }
      break;
    }
    case 'corners': S.sheet.corners = S.sheet.corners ? null : []; renderSheet(); break;
    case 'corner': {
      const sh = S.sheet;
      const img = document.getElementById('qImg');
      const r = img.getBoundingClientRect();
      const x = (ev.clientX - r.left) / r.width;
      const y = (ev.clientY - r.top) / r.height;
      if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) break;
      sh.corners.push([Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
      if (sh.corners.length === 4) {
        const q = orderCorners(sh.corners);
        if (quadArea(q) < 0.02) { toast('Οι γωνίες είναι πολύ κοντά. Ξαναπάτα τις 4 γωνίες.', 6000); sh.corners = []; } else {
          sh.draft.quad = q;
          sh.corners = null;
          sh.showGrid = true;
          toast('Μπήκε το πλέγμα 10×10! Κάθε τετραγωνάκι = 1%.', 5000, ic('border-all'));
        }
      }
      renderSheet();
      break;
    }
    case 'grid-toggle': S.sheet.showGrid = !S.sheet.showGrid; renderSheet(); break;
    case 'grid-dark': S.sheet.draft.gridDark = !S.sheet.draft.gridDark; renderSheet(); break;
    case 'qzoom': S.sheet.zoom = Math.min(4, Math.max(1, S.sheet.zoom + Number(el.dataset.z))); renderSheet(); break;
    case 'sp-remove': { const d = S.sheet.draft; d.species = d.species.filter((x) => x !== el.dataset.id); renderSheet(); break; }
    case 'pick':
      S.pickFor = el.dataset.for === 'quad' ? { kind: 'quad', label: S.sheet.draft.label || pointName(S.sheet.draft) } : { kind: 'det', label: 'Ντετέκτιβ φυτών' };
      openPlantsOverlay();
      break;
    case 'pick-cancel':
      closePlantsOverlay();
      break;
    case 'zone-filter': S.filter.zone = el.dataset.v === '' ? null : Number(el.dataset.v); renderPlants(); break;
    case 'sp-open': S.viewer = { sp: el.dataset.id, i: 0 }; showViewer(); break;
    case 'viewer-close': $('viewer').hidden = true; S.viewer = null; break;
    case 'viewer-step': {
      const sp = CATALOG.find((x) => x.id === S.viewer.sp);
      S.viewer.i = (S.viewer.i + Number(el.dataset.d) + sp.photos.length) % sp.photos.length;
      showViewer();
      break;
    }
    case 'viewer-zoom': VZ.scale = Math.min(6, Math.max(1, VZ.scale + Number(el.dataset.z))); if (VZ.scale === 1) resetZoom(); else applyZoom(); break;
    case 'viewer-pick': {
      const id = S.viewer.sp;
      $('viewer').hidden = true;
      S.viewer = null;
      const pf = S.pickFor;
      closePlantsOverlay();
      if ((pf && pf.kind === 'quad') || (S.sheet && S.sheet.draft && S.sheet.draft.kind === 'quadrat')) {
        S.sheet.draft.species = S.sheet.draft.species || [];
        if (!S.sheet.draft.species.includes(id)) S.sheet.draft.species.push(id);
        S.sheet.draft.species_count = Math.max(toNum(S.sheet.draft.species_count) || 0, S.sheet.draft.species.length) || null;
        $('sheet').hidden = false;
        renderSheet();
      } else if (pf && pf.kind === 'det' && t) {
        t.detective = t.detective || [];
        t.detective.push({ species: id, why: '' });
        await saveT(t);
      }
      renderAll();
      toast(speciesName(id), 3000, ic('leaf'));
      break;
    }
    case 'det-del': t.detective.splice(Number(el.dataset.i), 1); await saveT(t); renderWork(); break;
    case 'export': await doExport(el.dataset.k); break;
    case 'import': $('importFile').click(); break;
    case 'install': if (S.installEvent) { S.installEvent.prompt(); await S.installEvent.userChoice; S.installEvent = null; renderSend(); } break;
    case 'wipe': {
      if (!(await confirmBox('Θα σβηστούν ΟΛΑ τα δεδομένα αυτού του tablet. Έκανες πακέτο ZIP;', 'Ναι, σβήσε'))) break;
      await dbClear('photos');
      await dbClear('points');
      await dbClear('transects');
      S.transects = [];
      S.points = [];
      S.activeId = null;
      S.setupDone = false;
      await setSetting('setupDone', false);
      await ensureDefaultTeam();
      switchTab('prep');
      renderAll();
      break;
    }
    default: throw new Error(`Άγνωστη ενέργεια: ${act}`);
  }
}

async function doExport(kind) {
  S.busy = kind;
  renderSend();
  try {
    const data = await collect(null);
    if (!data.transects.length) { toast('Δεν υπάρχουν δεδομένα.'); return; }
    const base = exportBaseName(data).replace(/^Ammothines/, 'Ammothines_lite');
    if (kind === 'zip' || kind === 'share') {
      const blob = await buildPackage(data);
      if (kind === 'share') {
        try { await shareBlob(blob, `${base}.zip`, 'application/zip'); } catch (e) { if (e.name !== 'AbortError') throw e; return; }
      } else saveBlob(blob, `${base}.zip`);
    } else if (kind === 'kmz') saveBlob(await buildKmz(data), `${base}.kmz`);
    else saveBlob(buildCsv(data), `${base}.csv`);
    S.lastExport = nowIso();
    await setSetting('lastExport', S.lastExport);
    const c = counts(data);
    toast(`Έτοιμο: ${c.nPoints} καταγραφές, ${c.nPhotos} φωτογραφίες.`, 5000, ic('circle-check'));
  } catch (e) {
    console.error(e);
    toast(`Σφάλμα εξαγωγής: ${e.message}`, 9000);
  } finally {
    S.busy = null;
    renderSend();
  }
}

function onInput(e) {
  const el = e.target;
  if (!(el instanceof HTMLElement)) return;
  const t = activeT();
  if (el.dataset.coord) { const [sc, k] = el.dataset.coord.split('|'); S.coord[sc] = S.coord[sc] || {}; S.coord[sc][k] = el.value; return; }
  if (el.dataset.aq) {
    S.areaQ = el.value;
    const pos = el.selectionStart;
    renderPrep();
    const q = document.getElementById('areaQ');
    if (q) { q.focus(); q.setSelectionRange(pos, pos); }
    return;
  }
  if (el.dataset.pq) {
    S.filter.q = el.value;
    const pos = el.selectionStart;
    renderPlants();
    const q = document.getElementById('plantQ');
    if (q) { q.focus(); q.setSelectionRange(pos, pos); }
    return;
  }
  if (el.dataset.tf && t) {
    let v = el.value;
    if (el.dataset.t === 'num') v = v === '' ? null : Number(v);
    t[el.dataset.tf] = v;
    clearTimeout(onInput.tm);
    onInput.tm = setTimeout(() => saveT(t).catch(console.error), 400);
    renderTopbar();
    return;
  }
  if (el.dataset.pf) {
    const [id, f] = el.dataset.pf.split('|');
    const p = S.points.find((x) => x.id === id);
    p[f] = f === 'dist_m' ? (el.value === '' ? null : Number(el.value)) : el.value;
    clearTimeout(onInput.tp);
    onInput.tp = setTimeout(() => saveP(p).catch(console.error), 400);
    return;
  }
  if (el.dataset.det !== undefined && t) {
    t.detective[Number(el.dataset.det)].why = el.value;
    clearTimeout(onInput.tm);
    onInput.tm = setTimeout(() => saveT(t).catch(console.error), 400);
    return;
  }
  if (el.dataset.f && S.sheet) {
    let v = el.value;
    if (el.dataset.t === 'num') { v = v === '' ? null : Number(v); if (Number.isNaN(v)) v = null; }
    S.sheet.draft[el.dataset.f] = v;
    if (/_pct$/.test(el.dataset.f)) {
      updateCoverDom(S.sheet.draft);
    }
  }
}

function bindEvents() {
  document.body.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    handleAct(el.dataset.act, el, e).catch((err) => { console.error(err); toast(`Σφάλμα: ${err.message}`, 8000); });
  });
  document.addEventListener('input', onInput);
  $('sheetSave').addEventListener('click', () => saveSheet().catch((err) => { console.error(err); toast(`Δεν αποθηκεύτηκε: ${err.message}`, 8000); }));
  $('sheetCancel').addEventListener('click', () => closeSheet());
  $('sheetDelete').addEventListener('click', async () => {
    const id = S.sheet.draft.id;
    if (!(await confirmBox('Να σβηστεί αυτή η καταγραφή;', 'Ναι, σβήσε'))) return;
    const phs = await dbByIndex('photos', 'pointId', id);
    await dbDeleteMany('photos', phs.map((r) => r.id));
    await dbDelete('points', id);
    S.points = S.points.filter((p) => p.id !== id);
    closeSheet();
    renderAll();
  });
  $('fileTop').addEventListener('change', (e) => { const fs = [...e.target.files]; e.target.value = ''; addPhotos(fs.slice(0, 1), true); });
  $('fileTopGal').addEventListener('change', (e) => { const fs = [...e.target.files]; e.target.value = ''; addPhotos(fs.slice(0, 1), true); });
  $('fileCam').addEventListener('change', (e) => { const fs = [...e.target.files]; e.target.value = ''; addPhotos(fs, false); });
  $('importFile').addEventListener('change', async (e) => {
    const fs = [...e.target.files];
    e.target.value = '';
    for (const f of fs) {
      try { await importPackage(f); } catch (err) { toast(`${f.name}: ${err.message}`, 8000); }
    }
    S.transects = await dbGetAll('transects');
    S.points = await dbGetAll('points');
    renderAll();
    toast('Εισαγωγή έγινε', 4000, ic('file-import'));
  });
  $('placeOk').addEventListener('click', () => finishPlacing(true));
  $('placeCancel').addEventListener('click', () => finishPlacing(false));
  $('btnLocate').addEventListener('click', () => $('btnLocate').classList.toggle('on', toggleLocate()));
  $('btnFit').addEventListener('click', () => fitArea());
  $('btnBase').addEventListener('click', async () => {
    const order = ['sat', 'osm', 'none'];
    const next = order[(order.indexOf(getBaseName()) + 1) % order.length];
    setBase(next);
    await setSetting('basemap', next);
    refreshMap();
  });
  window.addEventListener('resize', () => drawQuad());
  window.addEventListener('online', () => { renderTopbar(); renderPrep(); });
  window.addEventListener('offline', () => { renderTopbar(); renderPrep(); });
  window.addEventListener('hashchange', () => handleHash().catch((err) => toast(err.message, 8000)));
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvent = e; renderSend(); });
  bindViewerGestures();
}

async function boot() {
  S.transects = await dbGetAll('transects');
  S.points = await dbGetAll('points');
  S.activeId = await getSetting('activeId', null);
  if (!activeT()) S.activeId = S.transects.length ? S.transects[0].id : null;
  S.area = await getSetting('area', null);
  if (S.area && validArea(S.area)) S.area = null;
  S.setupDone = await getSetting('setupDone', false);
  S.lastExport = await getSetting('lastExport', null);
  await ensureDefaultTeam();
  initMap($('map'), {
    onOpenPoint: (id) => { const p = S.points.find((x) => x.id === id); if (p) openSheet(p, false).catch((e) => toast(e.message, 6000)); },
    onPlaceMove: (ll) => {
      $('placeBanner').hidden = false;
      $('placeText').innerHTML = `Πάτα στον χάρτη ή σύρε το ${ic('crosshairs')} για: ${esc(S.placeLabel)} (${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)})`;
    },
    onLocateError: (e) => toast(gpsErrorText(e), 8000),
  });
  S.mapReady = true;
  setMapArea(S.area);
  setBase(await getSetting('basemap', 'sat'));
  renderPinBar();
  bindEvents();
  const t = activeT();
  // Αν η αρχική ρύθμιση έχει ήδη γίνει (ή υπάρχουν ήδη σημεία/περιοχή), κρύβεται και ξεκινάμε στην Έρευνα!
  const startTab = (S.setupDone || S.points.length > 0 || (S.area && t && t.mode)) ? 'work' : 'prep';
  if (t && (hasLatLon(t.start) || pointsOf(t).some((p) => p.kind === 'quadrat'))) S.workStep = 2;
  switchTab(startTab);
  renderAll();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then(() => navigator.serviceWorker.ready).then(() => { S.swReady = true; renderPrep(); })
      .catch((e) => { console.error(e); toast(`Χωρίς λειτουργία offline: ${e.message}`, 9000); });
  }
  askPersistent().then(storageInfo).then((s) => { S.storage = s; renderSend(); }).catch(console.error);
  await Promise.all([refreshTiles(), refreshPlants(), loadAreas()]);
  // Αν δεν έχει επιλεγεί περιοχή και υπάρχει μία στον κατάλογο, την προεπιλέγουμε διακριτικά
  if (!S.area && S.areas && S.areas.length === 1) {
    await useArea(S.areas[0]);
  }
  renderAll();
  await handleHash();
}

boot().catch((err) => {
  console.error(err);
  $('views').innerHTML = `<section class="card warnc"><h2>Η εφαρμογή δεν ξεκίνησε</h2><p>${esc(err.message)}</p></section>`;
});
