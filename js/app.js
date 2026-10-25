// Κύρια λογική: κατάσταση, οθόνες, φόρμες, συμβάντα.
import {
  ZONES, KINDS, NEW_KINDS, PRESSURES, PHOTO_SUBJECTS, SPECIES, CRITERIA, WEATHER_CHIPS, SRC_LABEL,
} from './schema.js';
import {
  dbGetAll, dbPut, dbDelete, dbDeleteMany, dbByIndex, dbClear, getSetting, setSetting, askPersistent, storageInfo,
} from './db.js';
import {
  effectivePos, getPosition, gpsErrorText, hasLatLon, mapLength, toNum,
} from './geo.js';
import { resizeImage } from './photos.js';
import { GUIDE, OBS_URL } from './guide.js';
import {
  pointName, healthScore, byDistance, dateOf,
} from './rows.js';
import {
  initMap, showMap, fitArea, setBase, getBaseName, refreshMarkers, startPlacing, finishPlacing, toggleLocate,
  BASEMAPS, tileStatus, downloadTiles,
} from './map.js';
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

const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const nowIso = () => new Date().toISOString();

function localIso(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

let toastTimer = null;
function toast(msg, ms = 3500) {
  const el = $('toast');
  el.textContent = msg;
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

async function doPos(scope, mode) {
  if (mode === 'clear') { setPos(scope, null); return; }
  if (mode === 'gps') {
    S.posBusy = scope;
    rerenderPosHost(scope);
    try {
      const p = await getPosition();
      S.posBusy = null;
      setPos(scope, p);
      toast(`Θέση από GPS (±${p.acc} μ.)`);
    } catch (e) {
      S.posBusy = null;
      rerenderPosHost(scope);
      toast(gpsErrorText(e), 8000);
    }
    return;
  }
  // Διάλεξε θέση στον χάρτη
  const label = scope === 'sheet' ? pointName(S.sheet.draft) : scope === 'start' ? 'Αρχή διατομής (θάλασσα)' : 'Τέλος διατομής (ενδοχώρα)';
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
  if (pos) setPos(scope, pos);
}

function rerenderPosHost(scope) {
  if (scope === 'sheet' && S.sheet) renderSheet();
  else renderHome();
}

function posBlock(scope, pos, derived) {
  const busy = S.posBusy === scope;
  let status;
  let cls;
  if (hasLatLon(pos)) {
    const acc = toNum(pos.acc);
    status = `✔ ${SRC_LABEL[pos.src] || pos.src}${acc !== null ? ` (±${acc} μ.)` : ''} · ${Number(pos.lat).toFixed(6)}, ${Number(pos.lon).toFixed(6)}`;
    cls = 'ok';
  } else if (derived) {
    status = `≈ Υπολογισμένη από τη διατομή (${derived.lat.toFixed(6)}, ${derived.lon.toFixed(6)}). Μπορείς να τη διορθώσεις.`;
    cls = 'calc';
  } else {
    status = '— Χωρίς θέση. Μπορεί να μπει αργότερα, στο σχολείο.';
    cls = 'none';
  }
  return `<div class="pos ${cls}">
    <div class="pos-status">${esc(status)}</div>
    <div class="btn-row">
      <button type="button" class="btn" data-act="pos" data-scope="${scope}" data-m="gps" ${busy ? 'disabled' : ''}>${busy ? 'Ψάχνω θέση…' : '📍 GPS τώρα'}</button>
      <button type="button" class="btn" data-act="pos" data-scope="${scope}" data-m="map">🗺 Στον χάρτη</button>
      ${hasLatLon(pos) ? `<button type="button" class="btn ghost" data-act="pos" data-scope="${scope}" data-m="clear">✖ Καθαρισμός</button>` : ''}
    </div>
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
  $('topTitle').innerHTML = `<b>Θίνες Ρεθύμνου</b><small>${t ? esc(tLabel(t)) : 'Δεν υπάρχει διατομή ακόμη'}</small>`;
  const on = navigator.onLine;
  const net = $('netBadge');
  net.textContent = on ? '● συνδεδεμένο' : '○ εκτός σύνδεσης';
  net.className = `net ${on ? 'on' : 'off'}`;
}

function offlineCard() {
  const tileOk = (n) => S.tiles[n] && S.tiles[n].total > 0 && S.tiles[n].cached === S.tiles[n].total;
  const anyTiles = tileOk('sat') || tileOk('osm');
  const item = (ok, text) => `<li class="${ok ? 'ok' : 'no'}">${ok ? '✔' : '○'} ${text}</li>`;
  const allOk = S.swReady && anyTiles;
  return `<section class="card ${allOk ? 'good' : 'warnc'}">
    <h2>Έτοιμο για εκτός σύνδεσης;</h2>
    <ul class="steps">
      ${item(S.swReady, 'Η εφαρμογή είναι αποθηκευμένη στο tablet')}
      ${item(anyTiles, 'Ο χάρτης της περιοχής είναι αποθηκευμένος')}
      ${item(!!(S.storage && S.storage.persisted), 'Ο χώρος αποθήκευσης προστατεύεται από διαγραφή')}
    </ul>
    ${allOk ? '' : '<p class="hint">Κάν’ το στο σχολείο, με wifi. Πήγαινε στην καρτέλα «Αποστολή» και πάτησε «Κατέβασμα χάρτη».</p>'}
  </section>`;
}

function identityCard(t) {
  const len = mapLength(t);
  const lenBtn = len !== null
    ? `<button type="button" class="btn small" data-act="len-from-map">Από τον χάρτη: ${Math.round(len)} μ. — χρήση</button>`
    : '';
  return `<section class="card">
    <h2>Φύλλο 1 — Ταυτότητα έρευνας</h2>
    <div class="grid2">
      <label class="field">Σχολείο<input data-tf="school" value="${esc(t.school)}" autocomplete="off"></label>
      <label class="field">Ομάδα<input data-tf="team" value="${esc(t.team)}" autocomplete="off"></label>
    </div>
    <label class="field">Ονόματα μελών<input data-tf="members" value="${esc(t.members)}" autocomplete="off"></label>
    <label class="field">Παραλία / τοποθεσία<input data-tf="beach" value="${esc(t.beach)}" autocomplete="off"></label>
    <label class="field">Ημερομηνία και ώρα<input type="datetime-local" data-tf="datetime" value="${esc(t.datetime)}"></label>
    <label class="field">Καιρός (ήλιος / άνεμος / θερμοκρασία)<input data-tf="weather" value="${esc(t.weather)}" autocomplete="off"></label>
    <div class="chips">${WEATHER_CHIPS.map((w) => `<button type="button" class="chip" data-act="weather" data-v="${esc(w)}">${esc(w)}</button>`).join('')}</div>
    <div class="grid2">
      <label class="field">Μήκος διατομής (μ.)<input type="number" inputmode="decimal" step="any" min="0" data-tf="length_m" data-t="num" value="${esc(t.length_m)}"></label>
      <label class="field">Απόσταση μεταξύ τετραγώνων (μ.)<input type="number" inputmode="decimal" step="any" min="1" data-tf="spacing_m" data-t="num" value="${esc(t.spacing_m)}"></label>
    </div>
    <div class="chips">
      <button type="button" class="chip" data-act="spacing" data-v="5">5 μ.</button>
      <button type="button" class="chip" data-act="spacing" data-v="10">10 μ.</button>
      ${lenBtn}
    </div>
    <h3>GPS αρχής (θάλασσα)</h3>
    ${posBlock('start', t.start, null)}
    <h3>GPS τέλους (ενδοχώρα)</h3>
    ${posBlock('end', t.end, null)}
    <p class="hint">Αν βάλεις αρχή και τέλος, τα τετράγωνα παίρνουν θέση πάνω στη διατομή από την απόστασή τους. Δεν χρειάζεται GPS σε κάθε τετράγωνο.</p>
    <label class="field">Σημειώσεις<textarea data-tf="notes" rows="2">${esc(t.notes)}</textarea></label>
    <p class="hint">Φωτογραφίες σε αυτή τη διατομή: <b>${photoTotal(t)}</b></p>
  </section>`;
}

function progressCard(t) {
  const pts = pointsOf(t);
  const nq = pts.filter((p) => p.kind === 'quadrat').length;
  const np = pts.filter((p) => p.kind === 'pressure').length;
  const hasSub = (s) => pts.some((p) => p.kind === 'photo' && p.subject === s);
  const hs = healthScore(t);
  const item = (ok, text, extra = '') => `<li class="${ok ? 'ok' : 'no'}">${ok ? '✔' : '○'} ${text}${extra}</li>`;
  return `<section class="card">
    <h2>Πρόοδος του πρωτοκόλλου</h2>
    <ul class="steps">
      ${item(!!((t.team || t.school) && t.beach), 'Α. Ταυτότητα έρευνας')}
      ${item(hasLatLon(t.start) && hasLatLon(t.end), 'Α. Θέση αρχής και τέλους')}
      ${item(hasSub('inland') && hasSub('sea'), 'Α. Δύο πανοραμικές φωτογραφίες',
    `<div class="chips">
        <button type="button" class="chip" data-act="new" data-kind="photo" data-subject="inland">＋ προς ενδοχώρα</button>
        <button type="button" class="chip" data-act="new" data-kind="photo" data-subject="sea">＋ προς θάλασσα</button></div>`)}
      ${item(toNum(t.length_m) !== null, 'Γ. Μήκος διατομής')}
      ${item(nq > 0, `Δ. Τετράγωνα: <b>${nq}</b>`)}
      ${item(np > 0, `Ε. Πιέσεις που καταγράφηκαν: <b>${np}</b>`)}
      ${item(photoTotal(t) > 0, `ΣΤ. Φωτογραφίες: <b>${photoTotal(t)}</b>`)}
      ${item(hs.complete, `Φύλλο 4. Βαθμολογία υγείας${hs.complete ? ` — ${hs.total}/10` : ''}`)}
    </ul>
  </section>`;
}

function renderHome() {
  const t = activeT();
  const chips = S.transects.map((x) => `<button type="button" class="chip ${x.id === S.activeId ? 'on' : ''}" data-act="pick-t" data-id="${esc(x.id)}">${esc(tLabel(x))}</button>`).join('');
  keepScroll(() => {
    $('view-home').innerHTML = `
      ${offlineCard()}
      <section class="card">
        <h2>Διατομές σε αυτό το tablet</h2>
        <div class="chips">${chips}<button type="button" class="chip add" data-act="new-t">＋ Νέα διατομή</button></div>
        ${S.transects.length ? '' : '<p class="hint">Μια διατομή είναι μία ευθεία γραμμή από τη θάλασσα προς την ενδοχώρα. Κάθε ομάδα κάνει μία. Πάτησε «Νέα διατομή» για να ξεκινήσεις.</p>'}
      </section>
      ${t ? `${identityCard(t)}${progressCard(t)}
      <section class="card"><button type="button" class="btn danger" data-act="del-t">🗑 Διαγραφή αυτής της διατομής</button></section>` : ''}`;
  });
}

function pointMeta(p, t) {
  const bits = [];
  if (p.kind === 'quadrat') {
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
    $('view-records').innerHTML = '<section class="card"><h2>Καταγραφή</h2><p>Φτιάξε πρώτα μια διατομή στην καρτέλα «Διατομή».</p><button type="button" class="btn primary" data-act="tab" data-tab="home">Πήγαινε στη Διατομή</button></section>';
    return;
  }
  const pts = pointsOf(t).sort(byDistance);
  const noPos = pts.filter((p) => !effectivePos(p, t));
  const nextD = nextQuadratDist(t);
  const rows = pts.map((p) => {
    const { text, eff } = pointMeta(p, t);
    const k = KINDS[p.kind];
    const nph = p.photoIds ? p.photoIds.length : 0;
    let badge;
    if (!eff) badge = '<span class="chip warn">⚠ χωρίς θέση</span>';
    else if (eff.src === 'calc') badge = '<span class="chip calc">≈ υπολογισμένη</span>';
    else badge = `<span class="chip ok">✔ ${esc(SRC_LABEL[eff.src] || eff.src)}</span>`;
    const placeBtn = !eff || eff.src === 'calc'
      ? `<button type="button" class="btn small" data-act="place-row" data-id="${esc(p.id)}">🗺 Βάλε στον χάρτη</button>` : '';
    return `<div class="row" data-act="edit" data-id="${esc(p.id)}">
      <div class="sym" style="background:${k.color}">${esc(k.sym)}</div>
      <div class="rbody"><b>${esc(pointName(p))}</b><span class="meta">${esc(text)}</span>
        <span class="badges">${badge}${nph ? `<span class="chip">📷 ${nph}</span>` : ''}${placeBtn}</span></div>
    </div>`;
  }).join('');
  const needsEnds = !(hasLatLon(t.start) && hasLatLon(t.end));
  const unplacedHint = noPos.length
    ? `<section class="card warnc" id="unplacedBox"><h2>⚠ Χωρίς θέση: ${noPos.length}</h2>
        <p>${needsEnds ? 'Βάλε αρχή και τέλος διατομής (καρτέλα «Διατομή») και τα σημεία με απόσταση παίρνουν θέση μόνα τους. Ή πάτησε «Βάλε στον χάρτη» σε κάθε σημείο.' : 'Πάτησε «Βάλε στον χάρτη» στα σημεία που δεν έχουν απόσταση από τη θάλασσα.'}</p></section>`
    : '<span id="unplacedBox"></span>';
  keepScroll(() => {
    $('view-records').innerHTML = `
      <section class="card">
        <h2>Τι βλέπεις τώρα;</h2>
        <p class="hint">Επόμενο τετράγωνο: στα <b>${nextD} μ.</b></p>
        <div class="kindgrid">${NEW_KINDS.map((k) => `<button type="button" class="kbtn" style="--kc:${KINDS[k].color}" data-act="new" data-kind="${k}"><i>${esc(KINDS[k].sym)}</i><span>${esc(KINDS[k].label)}</span></button>`).join('')}</div>
      </section>
      ${unplacedHint}
      <section class="card"><h2>Καταγραφές (${pts.length})</h2>
        ${rows || '<p class="hint">Δεν έχεις καταγράψει τίποτα ακόμη.</p>'}
      </section>`;
  });
}

// ---- Υγεία θίνας ----
function mean(arr) {
  const v = arr.filter((x) => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function chartSvg(t) {
  const qs = pointsOf(t).filter((p) => p.kind === 'quadrat' && toNum(p.dist_m) !== null).sort(byDistance);
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
    out += `<text x="${x0 + bw / 2}" y="${T0 + ih + 32}" text-anchor="middle" font-size="13" fill="#222">${esc(p.dist_m)}</text>`;
  });
  out += `<text x="${L0 + iw / 2}" y="${H - 6}" text-anchor="middle" font-size="13" fill="#222">Απόσταση από τη θάλασσα (μ.) — λωρίδα χρώματος = ζώνη</text>`;
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
    $('view-health').innerHTML = '<section class="card"><h2>Υγεία θίνας</h2><p>Φτιάξε πρώτα μια διατομή.</p></section>';
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
      <section class="card"><h2>Γράφημα διατομής</h2>${chartSvg(t)}
        <div class="legendrow"><i style="background:#E8D8A0"></i>γυμνή άμμος <i style="background:#A98467"></i>νεκρά υλικά <i style="background:#2F6B50"></i>φυτά <i style="background:#7B3FA0"></i>εισβλητικά</div>
      </section>
      <section class="card"><h2>Από τα δεδομένα σου</h2>
        <p class="hint">Βοήθημα για τη συζήτηση. Τη βαθμολογία την αποφασίζει η ομάδα.</p>
        <ul class="plain">${dataHints(t).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      </section>
      <section class="card"><h2>Φύλλο 4 — Βαθμολογία υγείας</h2>
        ${crit}
        ${total}
        <p class="hint">0–3: κακή. 4–7: μέτρια. 8–10: καλή. Το σκορ είναι εργαλείο συζήτησης, όχι «βαθμός» της φύσης.</p>
      </section>
      <section class="card"><h2>Τρία πράγματα που μας έκαναν εντύπωση</h2>
        ${[0, 1, 2].map((i) => `<label class="field">${i + 1}.<input data-hf="imp.${i}" value="${esc(h.impressions[i] || '')}" autocomplete="off"></label>`).join('')}
        <label class="field">Μία πρόταση προστασίας από την ομάδα μας<textarea data-hf="proposal" rows="3">${esc(h.proposal || '')}</textarea></label>
      </section>`;
  });
}

// ---- Αποστολή / εξαγωγή ----
function fmtBytes(n) {
  if (n === null || n === undefined) return '—';
  if (n > 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  return `${Math.round(n / 1e6)} MB`;
}

function tileRow(name) {
  const bm = BASEMAPS[name];
  const st = S.tiles[name];
  const prog = S.tileProg && S.tileProg.name === name ? S.tileProg : null;
  const full = st && st.total > 0 && st.cached === st.total;
  const status = st ? `${st.cached} / ${st.total} πλακίδια ${full ? '✔' : ''}` : '…';
  return `<div class="tilerow">
    <div><b>${esc(bm.label)}</b><br><small>${esc(status)}</small>
      ${prog ? `<progress max="${prog.total}" value="${prog.done}"></progress><small>${prog.done} / ${prog.total}${prog.failed ? ` · αποτυχίες ${prog.failed}` : ''}</small>` : ''}</div>
    <button type="button" class="btn" data-act="tiles" data-n="${name}" ${S.tileProg ? 'disabled' : ''}>${full ? 'Ανανέωση' : 'Κατέβασμα'}</button>
  </div>`;
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
  $('lbCap').innerHTML = `<b>${esc(g.name)}</b> <i>${esc(g.latin)}</i> (${LB.i + 1}/${g.photos.length})<br>© ${esc(p[1])} · ${esc(p[2])} · <a href="${OBS_URL(p[3])}" target="_blank" rel="noopener">iNaturalist</a>`;
  $('lightbox').hidden = false;
}

function renderExport() {
  const t = activeT();
  const nT = S.transects.length;
  const nP = S.points.length;
  const nPh = S.points.reduce((a, p) => a + (p.photoIds ? p.photoIds.length : 0), 0);
  const noPos = S.points.filter((p) => !effectivePos(p, S.transects.find((x) => x.id === p.transectId))).length;
  const st = S.storage;
  const b = (k, label, cls = '') => `<button type="button" class="btn ${cls}" data-act="export" data-k="${k}" ${S.busy ? 'disabled' : ''}>${S.busy === k ? 'Ετοιμάζω…' : label}</button>`;
  keepScroll(() => {
    $('view-export').innerHTML = `
      <section class="card">
        <h2>Χάρτης εκτός σύνδεσης</h2>
        <p class="hint">Κατέβασέ τον ΜΙΑ φορά, στο σχολείο με wifi, πριν πας στην παραλία. Καλύπτει μόνο την περιοχή της δράσης.</p>
        ${tileRow('sat')}${tileRow('osm')}
        <p class="hint">Χωρίς χάρτη, η εφαρμογή δουλεύει κανονικά με απλό πλέγμα και το περίγραμμα της περιοχής.</p>
      </section>
      <section class="card">
        <h2>Αποστολή δεδομένων</h2>
        <p>Στο tablet: <b>${nT}</b> διατομές, <b>${nP}</b> σημεία, <b>${nPh}</b> φωτογραφίες${noPos ? `, <b>${noPos}</b> χωρίς θέση` : ''}.</p>
        <p class="hint">Τελευταία εξαγωγή: ${esc(fmtDateTime(S.lastExport))}</p>
        <div class="chips">
          <button type="button" class="chip ${S.exportAll ? 'on' : ''}" data-act="scope-export" data-v="all">Όλες οι διατομές</button>
          <button type="button" class="chip ${S.exportAll ? '' : 'on'}" data-act="scope-export" data-v="active" ${t ? '' : 'disabled'}>Μόνο η ενεργή</button>
        </div>
        <div class="stack">
          ${b('zip', '📦 Πακέτο ZIP (όλα: φωτογραφίες, CSV, KML, GeoJSON)', 'primary')}
          ${b('kmz', '🌍 KMZ για Google Earth / My Maps')}
          ${b('csv', '📄 Μόνο CSV (πίνακας)')}
          ${canShareFiles() ? b('share', '↗ Κοινοποίηση πακέτου (Drive, email…)') : ''}
        </div>
        <p class="hint">Το πακέτο ZIP είναι και αντίγραφο ασφαλείας. Κάν’ το πριν κλείσεις το tablet και στο τέλος της μέρας.</p>
      </section>
      <section class="card">
        <h2>Ένας κοινός χάρτης για όλες τις ομάδες</h2>
        <ol class="plain">
          <li>Κάθε ομάδα στέλνει το πακέτο ZIP στον/στην εκπαιδευτικό (Drive, email).</li>
          <li>Στο <b>mymaps.google.com</b>: νέος χάρτης → Εισαγωγή → το <b>points_mymaps.csv</b> κάθε ομάδας (ένα επίπεδο ανά ομάδα).</li>
          <li>Στήλες θέσης: Latitude, Longitude. Τίτλος: Όνομα.</li>
          <li>Ή: φόρτωσε όλα τα πακέτα εδώ, με «Εισαγωγή», και κάνε μία εξαγωγή.</li>
        </ol>
        <button type="button" class="btn" data-act="import">📥 Εισαγωγή πακέτου ZIP (από άλλη ομάδα ή αντίγραφο)</button>
      </section>
      <section class="card">
        <h2>Κατάσταση συσκευής</h2>
        <ul class="plain">
          <li>Εκτός σύνδεσης: ${S.swReady ? '✔ έτοιμο' : '○ δεν είναι ακόμη έτοιμο'}</li>
          <li>Προστασία δεδομένων από διαγραφή: ${st && st.persisted ? '✔ ναι' : '○ όχι'} ${st && st.persisted ? '' : '<button type="button" class="btn small" data-act="persist">Ζήτησέ την</button>'}</li>
          <li>Χώρος που χρησιμοποιείται: ${esc(fmtBytes(st && st.usage))} από ${esc(fmtBytes(st && st.quota))}</li>
        </ul>
        ${S.installEvent ? '<button type="button" class="btn" data-act="install">⬇ Εγκατάσταση στην αρχική οθόνη</button>' : '<p class="hint">Εγκατάσταση: Chrome → ⋮ → «Εγκατάσταση εφαρμογής». Safari (iPad) → Κοινοποίηση → «Προσθήκη στην αρχική οθόνη».</p>'}
      </section>
      <section class="card">
        <h2>Καθαρισμός</h2>
        <button type="button" class="btn danger" data-act="wipe">🗑 Διαγραφή ΟΛΩΝ των δεδομένων από αυτό το tablet</button>
        <p class="hint">Κάν’ πρώτα εξαγωγή. Η διαγραφή δεν αναιρείται.</p>
      </section>`;
  });
}

let exportRenderQueued = false;
function queueExportRender() {
  if (exportRenderQueued) return;
  exportRenderQueued = true;
  requestAnimationFrame(() => { exportRenderQueued = false; renderExport(); });
}

// ---------- Φόρμα σημείου (sheet) ----------
function nextQuadratDist(t) {
  const qs = pointsOf(t).filter((p) => p.kind === 'quadrat' && toNum(p.dist_m) !== null);
  const sp = toNum(t.spacing_m) || 10;
  if (!qs.length) return 0;
  return Math.max(...qs.map((p) => Number(p.dist_m))) + sp;
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
      dist_m: nextQuadratDist(t), zone: null, bare_pct: null, litter_pct: null, plants_pct: null, invasive_pct: null,
      species: [], species_other: '', species_count: null, lilies: null, footprint: '',
    });
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
  const thumbs = sh.photos.map((ph) => `<div class="thumb"><img src="${ph.url}" alt="φωτογραφία"><button type="button" class="x" data-act="photo-del" data-pid="${esc(ph.id)}" aria-label="Διαγραφή φωτογραφίας">✖</button></div>`).join('');
  return `<div class="block"><h3>Φωτογραφίες (${sh.photos.length})</h3>
    ${hint ? `<p class="hint">${esc(hint)}</p>` : ''}
    <div class="thumbs">${thumbs}</div>
    <div class="btn-row"><button type="button" class="btn" data-act="photo-cam">📷 Φωτογραφία</button><button type="button" class="btn ghost" data-act="photo-gal">🖼 Από τη συλλογή</button></div></div>`;
}

function renderSheet() {
  const sh = S.sheet;
  const d = sh.draft;
  const t = activeT();
  const parts = [];
  switch (d.kind) {
    case 'quadrat':
      parts.push(numField('Απόσταση από τη θάλασσα (μ.)', 'dist_m', d.dist_m));
      parts.push(`<div class="block"><h3>Ζώνη (0–4)</h3>${zoneButtons(d)}</div>`);
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
    quadrat: 'Βγάλε μία φωτογραφία από πάνω, να φαίνεται όλο το 1×1 μ.',
    unknown: 'Βγάλε καθαρή φωτογραφία φύλλου και άνθους ή ολόκληρου του φυτού.',
    pressure: 'Μία φωτογραφία της πίεσης.',
  }[d.kind];
  parts.push(photosBlock(sh, photoHint));
  const derived = d.pos ? null : effectivePos(d, t);
  parts.push(`<div class="block"><h3>Θέση</h3>${posBlock('sheet', d.pos, derived)}</div>`);
  parts.push(`<label class="field">Σχόλιο<textarea data-f="comment" rows="2">${esc(d.comment)}</textarea></label>`);

  $('sheetTitle').textContent = `${sh.isNew ? 'Νέα καταγραφή' : 'Επεξεργασία'}: ${KINDS[d.kind].label}`;
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
    ? `Σύνολο: ${sum}% ${bad ? '— πρέπει να είναι περίπου 100%' : '✔'}${invBad ? ' · Τα εισβλητικά είναι περισσότερα από τα φυτά σύνολο.' : ''}`
    : 'Τα ποσοστά πρέπει να αθροίζουν περίπου 100%. Μην αγχώνεσαι για ακρίβεια 1–5%.';
}

async function openSheet(kind, id, subject) {
  const t = activeT();
  if (!t) { toast('Φτιάξε πρώτα μια διατομή.'); return; }
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
  S.sheet = { draft, photos, removed: [], isNew: !id };
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
  if (d.kind === 'quadrat' && toNum(d.dist_m) === null) return 'Γράψε την απόσταση από τη θάλασσα.';
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
  toast('Αποθηκεύτηκε ✔');
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

async function addPhotos(files) {
  if (!S.sheet) return;
  for (const f of files) {
    try {
      const blob = await resizeImage(f);
      S.sheet.photos.push({ id: uid('f'), blob, url: URL.createObjectURL(blob), isNew: true, ts: nowIso() });
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
  b.textContent = `⚠ Χωρίς θέση (${n})`;
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

async function doTiles(name) {
  if (S.tileProg) return;
  S.tileProg = { name, done: 0, total: 0, failed: 0 };
  renderExport();
  try {
    const r = await downloadTiles(name, (p) => { S.tileProg = { name, ...p }; queueExportRender(); });
    toast(r.failed ? `Έτοιμο, με ${r.failed} πλακίδια που έλειψαν.` : 'Ο χάρτης αποθηκεύτηκε ✔', 6000);
  } catch (e) {
    console.error(e);
    toast(e.message, 9000);
  } finally {
    S.tileProg = null;
    await refreshTiles();
    renderHome();
    renderExport();
  }
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
  for (const f of files) {
    try {
      const r = await importPackage(f);
      tot = {
        transects: tot.transects + r.transects, points: tot.points + r.points, photos: tot.photos + r.photos, missing: tot.missing + r.missing,
      };
    } catch (e) {
      console.error(e);
      toast(`${f.name}: ${e.message}`, 9000);
    }
  }
  await reloadFromDb();
  renderAll();
  toast(`Εισαγωγή: ${tot.transects} διατομές, ${tot.points} σημεία, ${tot.photos} φωτογραφίες${tot.missing ? `, ${tot.missing} φωτογραφίες έλειπαν από το αρχείο` : ''}.`, 7000);
}

async function handleAct(act, el) {
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
      const nt = newTransect();
      S.transects.push(nt);
      S.activeId = nt.id;
      await saveTransect(nt);
      await setSetting('activeId', nt.id);
      renderAll();
      toast('Νέα διατομή. Συμπλήρωσε την ταυτότητα έρευνας.');
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
        toast('Η θέση μπήκε ✔');
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
    case 'tiles': await doTiles(el.dataset.n); break;
    case 'persist': {
      const ok = await askPersistent();
      S.storage = await storageInfo();
      renderExport();
      renderHome();
      toast(ok ? 'Τα δεδομένα προστατεύονται ✔' : 'Ο browser δεν το επέτρεψε. Εγκατέστησε την εφαρμογή στην αρχική οθόνη και δοκίμασε ξανά.', 7000);
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
    handleAct(el.dataset.act, el).catch((err) => {
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

  window.addEventListener('online', renderTopbar);
  window.addEventListener('offline', renderTopbar);
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
  initMap($('map'), {
    onOpenPoint: (id) => { switchTab('records'); openSheet(null, id).catch((e) => toast(e.message, 6000)); },
    onPlaceMove: (ll) => {
      $('placeBanner').hidden = false;
      $('placeText').textContent = `Πάτησε στον χάρτη ή σύρε το ＋ για: ${S.placeLabel || 'σημείο'} (${ll.lat.toFixed(6)}, ${ll.lng.toFixed(6)})`;
    },
    onLocateError: (e) => toast(gpsErrorText(e), 8000),
  });
  S.mapReady = true;
  setBase(await getSetting('basemap', 'sat'));
  bindEvents();
  renderAll();
  askPersistent().then(() => storageInfo()).then((s) => { S.storage = s; renderHome(); renderExport(); }).catch((e) => console.error(e));
  registerSw();
  refreshTiles().then(() => { renderHome(); renderExport(); }).catch((e) => console.error(e));
}

boot().catch(showFatal);
