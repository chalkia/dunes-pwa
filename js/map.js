// Χάρτης (Leaflet). Η βιβλιοθήκη φορτώνεται ως καθολική μεταβλητή «L» από το lib/leaflet.
import { AREA, areaBounds } from './area.js';
import {
  effectivePos, tilesForBounds, expandBounds, hasLatLon, toNum,
} from './geo.js';
import { KINDS } from './schema.js';
import { pointName } from './rows.js';

// Το όνομα της κρυφής μνήμης πρέπει να είναι ίδιο με αυτό στο sw.js (το ελέγχει το tools/check_all.mjs).
export const TILE_CACHE = 'dunes-tiles-v1';

export const BASEMAPS = {
  sat: {
    label: 'Δορυφορικός',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxNative: 18,
    attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics',
  },
  osm: {
    label: 'Χάρτης',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxNative: 19,
    attribution: '© OpenStreetMap contributors',
  },
};

const TEAM_COLORS = ['#1F6B91', '#B8660B', '#7B3FA0', '#2F6B50', '#C0392B', '#5A5A5A', '#0E8F8F', '#A0527C'];
const MIN_ZOOM = 13;

let map = null;
let baseLayer = null;
let baseName = 'none';
let markerLayer = null;
let handlers = {};
let placing = null;
let watchId = null;
let meDot = null;
let meCircle = null;

const esc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function teamColor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TEAM_COLORS[h % TEAM_COLORS.length];
}

export function initMap(el, h) {
  handlers = h || {};
  map = L.map(el, { minZoom: MIN_ZOOM, maxZoom: 21, zoomControl: true });
  L.control.scale({ metric: true, imperial: false }).addTo(map);
  L.geoJSON(AREA, { style: { color: '#1F6B91', weight: 2, dashArray: '6 4', fillOpacity: 0.06 }, interactive: false }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  fitArea();
  map.on('click', (e) => {
    if (!placing) return;
    placing.marker.setLatLng(e.latlng);
    if (handlers.onPlaceMove) handlers.onPlaceMove(e.latlng);
  });
  return map;
}

// Ο χάρτης δημιουργείται όταν η καρτέλα είναι κρυφή (μέγεθος 0). Την πρώτη φορά που φαίνεται,
// ξαναπροσαρμόζουμε το κάδρο, αλλιώς το fitBounds διαλέγει λάθος μεγέθυνση.
let needFit = true;
export function showMap() {
  map.invalidateSize();
  if (needFit) {
    needFit = false;
    fitArea();
  }
}

export function fitArea() {
  const b = areaBounds();
  map.fitBounds([[b.south, b.west], [b.north, b.east]], { padding: [30, 30], maxZoom: 19 });
}

export function getBaseName() {
  return baseName;
}

export function setBase(name) {
  if (baseLayer) { map.removeLayer(baseLayer); baseLayer = null; }
  baseName = BASEMAPS[name] ? name : 'none';
  if (baseName === 'none') return;
  const bm = BASEMAPS[baseName];
  baseLayer = L.tileLayer(bm.url, { maxNativeZoom: bm.maxNative, maxZoom: 21, attribution: bm.attribution }).addTo(map);
}

function quadratColor(p) {
  const plants = toNum(p.plants_pct);
  if (plants === null) return { bg: '#9AA5A8', fg: '#fff' };
  if (plants < 20) return { bg: '#E8CF4F', fg: '#222' }; // κίτρινο = γυμνή άμμος
  if (plants <= 60) return { bg: '#8CC084', fg: '#112' }; // ανοιχτό πράσινο = αραιά φυτά
  return { bg: '#2F6B50', fg: '#fff' }; // σκούρο πράσινο = πυκνά φυτά / θάμνοι
}

function makeIcon(kind, p, calc) {
  const k = KINDS[kind];
  let bg = k.color;
  let fg = '#fff';
  let text = k.sym;
  let cls = 'mk';
  if (kind === 'quadrat') {
    ({ bg, fg } = quadratColor(p));
    const d = toNum(p.dist_m);
    text = d === null ? '▦' : String(d);
    cls += ' sq';
  }
  if (kind === 'lilies') fg = '#222';
  if (calc) cls += ' calc';
  return L.divIcon({
    className: '',
    html: `<div class="${cls}" style="background:${bg};color:${fg}">${esc(text)}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function addMarker(pos, kind, p, name, small) {
  const calc = pos.src === 'calc';
  const m = L.marker([pos.lat, pos.lon], { icon: makeIcon(kind, p || {}, calc), keyboard: false }).addTo(markerLayer);
  const el = document.createElement('div');
  el.innerHTML = `<b>${esc(name)}</b><br><small>${esc(small)}</small>`;
  if (p && handlers.onOpenPoint) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small';
    b.textContent = 'Άνοιγμα';
    b.addEventListener('click', () => { m.closePopup(); handlers.onOpenPoint(p.id); });
    el.appendChild(document.createElement('br'));
    el.appendChild(b);
  }
  m.bindPopup(el);
}

// d: { transects, points, scope: 'active' | 'all', activeId }
export function refreshMarkers(d) {
  markerLayer.clearLayers();
  const ts = d.scope === 'active' ? d.transects.filter((t) => t.id === d.activeId) : d.transects;
  ts.forEach((t) => {
    const color = teamColor(t.id);
    const label = `${t.team || 'Ομάδα'} · ${t.beach || 'παραλία'}`;
    if (hasLatLon(t.start) && hasLatLon(t.end)) {
      L.polyline([[t.start.lat, t.start.lon], [t.end.lat, t.end.lon]], { color, weight: 3, dashArray: '8 6', interactive: false }).addTo(markerLayer);
    }
    ['start', 'end'].forEach((w) => {
      if (hasLatLon(t[w])) addMarker({ lat: Number(t[w].lat), lon: Number(t[w].lon), src: t[w].src }, w, null, KINDS[w].label, label);
    });
    d.points.filter((p) => p.transectId === t.id).forEach((p) => {
      const pos = effectivePos(p, t);
      if (!pos) return;
      const note = pos.src === 'calc' ? `${label} · υπολογισμένη θέση` : label;
      addMarker(pos, p.kind, p, pointName(p), note);
    });
  });
}

// ---- Τοποθέτηση σημείου με πάτημα στον χάρτη ----
export function startPlacing({ initial } = {}) {
  if (placing) finishPlacing(false);
  const b = areaBounds();
  const c = initial && hasLatLon(initial)
    ? { lat: Number(initial.lat), lng: Number(initial.lon) }
    : map.getCenter() || { lat: (b.north + b.south) / 2, lng: (b.east + b.west) / 2 };
  const marker = L.marker(c, {
    draggable: true,
    keyboard: false,
    zIndexOffset: 2000,
    icon: L.divIcon({ className: 'place-wrap', html: '<div class="mk place">＋</div>', iconSize: [44, 44], iconAnchor: [22, 22] }),
  }).addTo(map);
  marker.on('drag', () => { if (handlers.onPlaceMove) handlers.onPlaceMove(marker.getLatLng()); });
  document.body.classList.add('placing');
  map.panTo(c);
  if (handlers.onPlaceMove) handlers.onPlaceMove(marker.getLatLng());
  return new Promise((resolve) => { placing = { marker, resolve }; });
}

export function finishPlacing(ok) {
  if (!placing) return;
  const p = placing;
  placing = null;
  const ll = p.marker.getLatLng();
  map.removeLayer(p.marker);
  document.body.classList.remove('placing');
  p.resolve(ok ? { lat: ll.lat, lon: ll.lng, src: 'map', ts: new Date().toISOString() } : null);
}

export function isPlacing() {
  return placing !== null;
}

// ---- Η θέση μου ----
export function stopLocate() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  if (meDot) { map.removeLayer(meDot); meDot = null; }
  if (meCircle) { map.removeLayer(meCircle); meCircle = null; }
}

// Επιστρέφει true όταν ξεκίνησε, false όταν σταμάτησε.
export function toggleLocate() {
  if (watchId !== null) { stopLocate(); return false; }
  if (!('geolocation' in navigator)) {
    if (handlers.onLocateError) handlers.onLocateError({ code: 0, message: 'no geolocation' });
    return false;
  }
  let first = true;
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const ll = [pos.coords.latitude, pos.coords.longitude];
      if (!meDot) {
        meDot = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#1A73E8', fillOpacity: 1, interactive: false }).addTo(map);
        meCircle = L.circle(ll, { radius: pos.coords.accuracy, color: '#1A73E8', weight: 1, fillOpacity: 0.1, interactive: false }).addTo(map);
      } else {
        meDot.setLatLng(ll);
        meCircle.setLatLng(ll);
        meCircle.setRadius(pos.coords.accuracy);
      }
      if (first) { first = false; map.setView(ll, Math.max(map.getZoom(), 18)); }
    },
    (err) => {
      stopLocate();
      if (handlers.onLocateError) handlers.onLocateError({ code: err.code, message: err.message });
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 },
  );
  return true;
}

// ---- Χάρτης εκτός σύνδεσης: λήψη πλακιδίων της περιοχής ----
export function areaTileBounds() {
  return expandBounds(areaBounds(), 0.004);
}

export function tileUrls(name) {
  const bm = BASEMAPS[name];
  if (!bm) throw new Error(`Άγνωστος χάρτης: ${name}`);
  return tilesForBounds(areaTileBounds(), MIN_ZOOM, bm.maxNative)
    .map((t) => bm.url.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y));
}

export async function tileStatus(name) {
  const cache = await caches.open(TILE_CACHE);
  const urls = tileUrls(name);
  let cached = 0;
  for (const u of urls) {
    if (await cache.match(u)) cached += 1;
  }
  return { total: urls.length, cached };
}

export async function downloadTiles(name, onProgress) {
  const cache = await caches.open(TILE_CACHE);
  const urls = tileUrls(name);
  const total = urls.length;
  let next = 0;
  let done = 0;
  let failed = 0;
  let streak = 0;
  let aborted = null;
  async function worker() {
    while (next < urls.length && !aborted) {
      const u = urls[next]; next += 1;
      try {
        if (!(await cache.match(u))) {
          const r = await fetch(u, { mode: 'cors', credentials: 'omit' });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          await cache.put(u, r);
        }
        streak = 0;
      } catch (e) {
        failed += 1;
        streak += 1;
        if (streak >= 8) aborted = `Δεν υπάρχει σύνδεση ή ο διακομιστής αρνείται τα πλακίδια (${e.message}).`;
      }
      done += 1;
      onProgress({ done, total, failed });
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  if (aborted) throw new Error(aborted);
  return { total, failed };
}
