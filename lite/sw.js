// Service worker της lite (scope: lite/). Κάνει την εφαρμογή να δουλεύει χωρίς σύνδεση.
// 1. APP_CACHE: τα αρχεία της εφαρμογής και οι μικρογραφίες φυτών (στην εγκατάσταση).
// 2. PLANTS_CACHE: οι μεγάλες φωτογραφίες φυτών (κατεβαίνουν με το κουμπί «Ετοίμασε το tablet»).
// 3. TILE_CACHE: τα πλακίδια του χάρτη. ΚΟΙΝΑ με την πλήρη εφαρμογή (ίδιο όνομα με το js/map.js).
// Τα PLANTS_CACHE και οι μικρογραφίες ενημερώνονται από το «npm run lite-catalog».
// Ο φύλακας tools/check_all.mjs ελέγχει ότι κάθε αρχείο του SHELL υπάρχει.
const APP_CACHE = 'lite-shell-v5-7a1f733f';
const PLANTS_CACHE = 'lite-plants-7a1f733f';
const TILE_CACHE = 'dunes-tiles-v1';
const TILE_HOSTS = ['tile.openstreetmap.org', 'server.arcgisonline.com'];

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/lite.css',
  './js/app.js',
  './js/catalog.js',
  './js/quadrat.js',
  '../css/app.css',
  '../js/area.js',
  '../js/db.js',
  '../js/geo.js',
  '../js/map.js',
  '../js/pack.js',
  '../js/photos.js',
  '../js/rows.js',
  '../js/schema.js',
  '../lib/leaflet/leaflet.js',
  '../lib/leaflet/leaflet.css',
  '../lib/jszip.min.js',
  '../lib/jsQR.js',
  '../lib/fa/css/fontawesome.min.css',
  '../lib/fa/css/solid.min.css',
  '../lib/fa/css/regular.min.css',
  '../lib/fa/webfonts/fa-solid-900.woff2',
  '../lib/fa/webfonts/fa-regular-400.woff2',
  '../lib/fonts/comfortaa-greek-700-normal.woff2',
  '../lib/fonts/comfortaa-latin-700-normal.woff2',
  '../areas/areas.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  // thumbs:start — τα γράφει το «npm run lite-catalog». Μην τα αλλάζεις με το χέρι.
  './plants/Pancratium_maritimum/01_t.webp',
  './plants/Pancratium_maritimum/02_t.webp',
  './plants/Pancratium_maritimum/03_t.webp',
  './plants/Pancratium_maritimum/04_t.webp',
  './plants/Pancratium_maritimum/05_t.webp',
  './plants/Pancratium_maritimum/06_t.webp',
  './plants/Eryngium_maritimum/01_t.webp',
  './plants/Eryngium_maritimum/02_t.webp',
  './plants/Eryngium_maritimum/03_t.webp',
  './plants/Eryngium_maritimum/04_t.webp',
  './plants/Eryngium_maritimum/05_t.webp',
  './plants/Eryngium_maritimum/06_t.webp',
  './plants/Euphorbia_paralias/01_t.webp',
  './plants/Euphorbia_paralias/02_t.webp',
  './plants/Euphorbia_paralias/03_t.webp',
  './plants/Euphorbia_paralias/04_t.webp',
  './plants/Euphorbia_paralias/05_t.webp',
  './plants/Euphorbia_paralias/06_t.webp',
  './plants/Calystegia_soldanella/01_t.webp',
  './plants/Calystegia_soldanella/02_t.webp',
  './plants/Calystegia_soldanella/03_t.webp',
  './plants/Calystegia_soldanella/04_t.webp',
  './plants/Calystegia_soldanella/05_t.webp',
  './plants/Calystegia_soldanella/06_t.webp',
  './plants/Cakile_maritima/01_t.webp',
  './plants/Cakile_maritima/02_t.webp',
  './plants/Cakile_maritima/03_t.webp',
  './plants/Cakile_maritima/04_t.webp',
  './plants/Cakile_maritima/05_t.webp',
  './plants/Cakile_maritima/06_t.webp',
  './plants/Medicago_marina/01_t.webp',
  './plants/Medicago_marina/02_t.webp',
  './plants/Medicago_marina/03_t.webp',
  './plants/Medicago_marina/04_t.webp',
  './plants/Medicago_marina/05_t.webp',
  './plants/Medicago_marina/06_t.webp',
  './plants/Matthiola_tricuspidata/01_t.webp',
  './plants/Matthiola_tricuspidata/02_t.webp',
  './plants/Matthiola_tricuspidata/03_t.webp',
  './plants/Matthiola_tricuspidata/04_t.webp',
  './plants/Matthiola_tricuspidata/05_t.webp',
  './plants/Matthiola_tricuspidata/06_t.webp',
  './plants/Otanthus_maritimus/01_t.webp',
  './plants/Otanthus_maritimus/02_t.webp',
  './plants/Otanthus_maritimus/03_t.webp',
  './plants/Otanthus_maritimus/04_t.webp',
  './plants/Otanthus_maritimus/05_t.webp',
  './plants/Otanthus_maritimus/06_t.webp',
  './plants/Juniperus_macrocarpa/01_t.webp',
  './plants/Juniperus_macrocarpa/02_t.webp',
  './plants/Juniperus_macrocarpa/03_t.webp',
  './plants/Juniperus_macrocarpa/04_t.webp',
  './plants/Juniperus_macrocarpa/05_t.webp',
  './plants/Juniperus_macrocarpa/06_t.webp',
  './plants/Centaurea_spinosa/01_t.webp',
  './plants/Centaurea_spinosa/02_t.webp',
  './plants/Centaurea_spinosa/03_t.webp',
  './plants/Centaurea_spinosa/04_t.webp',
  './plants/Centaurea_spinosa/05_t.webp',
  './plants/Centaurea_spinosa/06_t.webp',
  './plants/Carpobrotus_edulis/01_t.webp',
  './plants/Carpobrotus_edulis/02_t.webp',
  './plants/Carpobrotus_edulis/03_t.webp',
  './plants/Carpobrotus_edulis/04_t.webp',
  './plants/Carpobrotus_edulis/05_t.webp',
  './plants/Carpobrotus_edulis/06_t.webp',
  // thumbs:end
];

const BLANK_TILE_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Σβήνει μόνο παλιές μνήμες της lite. Της πλήρους εφαρμογής (dunes-*) δεν τις αγγίζει.
    await Promise.all(keys
      .filter((k) => (k.startsWith('lite-shell-') && k !== APP_CACHE) || (k.startsWith('lite-plants-') && k !== PLANTS_CACHE))
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function blankTile() {
  const bin = atob(BLANK_TILE_B64);
  return new Response(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)), { status: 200, headers: { 'Content-Type': 'image/png' } });
}

async function tileResponse(request) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(request.url);
  if (hit) return hit;
  try {
    const res = await fetch(request.url, { mode: 'cors', credentials: 'omit' });
    if (res.ok) await cache.put(request.url, res.clone());
    return res;
  } catch {
    return blankTile();
  }
}

// Μεγάλες φωτογραφίες φυτών: πρώτα από τη μνήμη τους. Χωρίς σύνδεση και χωρίς μνήμη: 404 (η εφαρμογή δείχνει τη μικρογραφία).
async function plantResponse(request) {
  const hit = await caches.match(request, { ignoreSearch: true });
  if (hit) return hit;
  try {
    return await fetch(request);
  } catch {
    return new Response('', { status: 404 });
  }
}

async function shellResponse(event) {
  const request = event.request;
  const cache = await caches.open(APP_CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request).then((res) => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  if (hit) {
    event.waitUntil(network);
    return hit;
  }
  const res = await network;
  if (res) return res;
  if (request.mode === 'navigate') {
    const index = await cache.match('./index.html');
    if (index) return index;
  }
  return new Response('Εκτός σύνδεσης και το αρχείο δεν είναι αποθηκευμένο.', { status: 503 });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (TILE_HOSTS.includes(url.hostname)) { event.respondWith(tileResponse(request)); return; }
  if (url.origin !== self.location.origin) return;
  if (/\/lite\/plants\/.+\/\d+\.webp$/.test(url.pathname)) { event.respondWith(plantResponse(request)); return; }
  event.respondWith(shellResponse(event));
});
