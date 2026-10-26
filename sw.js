// Service worker: κάνει την εφαρμογή να δουλεύει χωρίς σύνδεση.
// 1. Τα αρχεία της εφαρμογής αποθηκεύονται στην εγκατάσταση (SHELL).
// 2. Τα πλακίδια του χάρτη μπαίνουν στην κρυφή μνήμη TILE_CACHE (κατεβάζονται από την καρτέλα «Αποστολή»).
// Οι φύλακες tools/check_all.mjs ελέγχουν ότι κάθε αρχείο του SHELL υπάρχει και ότι το TILE_CACHE
// είναι ίδιο με αυτό στο js/map.js. Ένα αρχείο που λείπει από το SHELL ακυρώνει ΟΛΗ την εγκατάσταση.
const APP_CACHE = 'dunes-shell-v2-gfd8fac7a';
const TILE_CACHE = 'dunes-tiles-v1';
const TILE_HOSTS = ['tile.openstreetmap.org', 'server.arcgisonline.com'];

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/area.js',
  './js/db.js',
  './js/geo.js',
  './js/guide.js',
  './js/map.js',
  './js/pack.js',
  './js/photos.js',
  './js/rows.js',
  './js/schema.js',
  './lib/leaflet/leaflet.js',
  './lib/leaflet/leaflet.css',
  './lib/jszip.min.js',
  './lib/qrcode.js',
  './lib/fa/css/fontawesome.min.css',
  './lib/fa/css/solid.min.css',
  './lib/fa/css/regular.min.css',
  './lib/fa/webfonts/fa-solid-900.woff2',
  './lib/fa/webfonts/fa-regular-400.woff2',
  './lib/jsQR.js',
  './lib/fonts/comfortaa-greek-700-normal.woff2',
  './lib/fonts/comfortaa-latin-700-normal.woff2',
  './areas/areas.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  // plants:start — τα γράφει το «npm run guide». Μην τα αλλάζεις με το χέρι.
  './plants/Pancratium_maritimum/01.jpg',
  './plants/Pancratium_maritimum/02.jpg',
  './plants/Pancratium_maritimum/03.jpg',
  './plants/Pancratium_maritimum/04.jpg',
  './plants/Pancratium_maritimum/05.jpg',
  './plants/Pancratium_maritimum/06.jpg',
  './plants/Pancratium_maritimum/07.jpg',
  './plants/Pancratium_maritimum/08.jpg',
  './plants/Pancratium_maritimum/09.jpg',
  './plants/Pancratium_maritimum/10.jpg',
  './plants/Eryngium_maritimum/01.jpg',
  './plants/Eryngium_maritimum/02.jpg',
  './plants/Eryngium_maritimum/03.jpg',
  './plants/Eryngium_maritimum/04.jpg',
  './plants/Eryngium_maritimum/05.jpg',
  './plants/Eryngium_maritimum/06.jpg',
  './plants/Eryngium_maritimum/07.jpg',
  './plants/Eryngium_maritimum/08.jpg',
  './plants/Eryngium_maritimum/09.jpg',
  './plants/Eryngium_maritimum/10.jpg',
  './plants/Euphorbia_paralias/01.jpg',
  './plants/Euphorbia_paralias/02.jpg',
  './plants/Euphorbia_paralias/03.jpg',
  './plants/Euphorbia_paralias/04.jpg',
  './plants/Euphorbia_paralias/05.jpg',
  './plants/Euphorbia_paralias/06.jpg',
  './plants/Euphorbia_paralias/07.jpg',
  './plants/Euphorbia_paralias/08.jpg',
  './plants/Euphorbia_paralias/09.jpg',
  './plants/Euphorbia_paralias/10.jpg',
  './plants/Calystegia_soldanella/01.jpg',
  './plants/Calystegia_soldanella/02.jpg',
  './plants/Calystegia_soldanella/03.jpg',
  './plants/Calystegia_soldanella/04.jpg',
  './plants/Calystegia_soldanella/05.jpg',
  './plants/Calystegia_soldanella/06.jpg',
  './plants/Calystegia_soldanella/07.jpg',
  './plants/Calystegia_soldanella/08.jpg',
  './plants/Calystegia_soldanella/09.jpg',
  './plants/Calystegia_soldanella/10.jpg',
  './plants/Cakile_maritima/01.jpg',
  './plants/Cakile_maritima/02.jpg',
  './plants/Cakile_maritima/03.jpg',
  './plants/Cakile_maritima/04.jpg',
  './plants/Cakile_maritima/05.jpg',
  './plants/Cakile_maritima/06.jpg',
  './plants/Cakile_maritima/07.jpg',
  './plants/Medicago_marina/01.jpg',
  './plants/Medicago_marina/02.jpg',
  './plants/Medicago_marina/03.jpg',
  './plants/Medicago_marina/04.jpg',
  './plants/Medicago_marina/05.jpg',
  './plants/Medicago_marina/06.jpg',
  './plants/Medicago_marina/07.jpg',
  './plants/Medicago_marina/08.jpg',
  './plants/Matthiola_tricuspidata/01.jpg',
  './plants/Matthiola_tricuspidata/02.jpg',
  './plants/Matthiola_tricuspidata/03.jpg',
  './plants/Matthiola_tricuspidata/04.jpg',
  './plants/Matthiola_tricuspidata/05.jpg',
  './plants/Matthiola_tricuspidata/06.jpg',
  './plants/Matthiola_tricuspidata/07.jpg',
  './plants/Matthiola_tricuspidata/08.jpg',
  './plants/Matthiola_tricuspidata/09.jpg',
  './plants/Matthiola_tricuspidata/10.jpg',
  './plants/Otanthus_maritimus/01.jpg',
  './plants/Otanthus_maritimus/02.jpg',
  './plants/Otanthus_maritimus/03.jpg',
  './plants/Otanthus_maritimus/04.jpg',
  './plants/Otanthus_maritimus/05.jpg',
  './plants/Otanthus_maritimus/06.jpg',
  './plants/Otanthus_maritimus/07.jpg',
  './plants/Otanthus_maritimus/08.jpg',
  './plants/Otanthus_maritimus/09.jpg',
  './plants/Otanthus_maritimus/10.jpg',
  './plants/Juniperus_macrocarpa/01.jpg',
  './plants/Juniperus_macrocarpa/02.jpg',
  './plants/Juniperus_macrocarpa/03.jpg',
  './plants/Juniperus_macrocarpa/04.jpg',
  './plants/Juniperus_macrocarpa/05.jpg',
  './plants/Juniperus_macrocarpa/06.jpg',
  './plants/Juniperus_macrocarpa/07.jpg',
  './plants/Juniperus_macrocarpa/08.jpg',
  './plants/Juniperus_macrocarpa/09.jpg',
  './plants/Juniperus_macrocarpa/10.jpg',
  './plants/Centaurea_spinosa/01.jpg',
  './plants/Centaurea_spinosa/02.jpg',
  './plants/Centaurea_spinosa/03.jpg',
  './plants/Centaurea_spinosa/04.jpg',
  './plants/Centaurea_spinosa/05.jpg',
  './plants/Centaurea_spinosa/06.jpg',
  './plants/Centaurea_spinosa/07.jpg',
  './plants/Centaurea_spinosa/08.jpg',
  './plants/Centaurea_spinosa/09.jpg',
  './plants/Centaurea_spinosa/10.jpg',
  './plants/Carpobrotus_edulis/01.jpg',
  './plants/Carpobrotus_edulis/02.jpg',
  './plants/Carpobrotus_edulis/03.jpg',
  './plants/Carpobrotus_edulis/04.jpg',
  './plants/Carpobrotus_edulis/05.jpg',
  './plants/Carpobrotus_edulis/06.jpg',
  './plants/Carpobrotus_edulis/07.jpg',
  './plants/Carpobrotus_edulis/08.jpg',
  './plants/Carpobrotus_edulis/09.jpg',
  './plants/Carpobrotus_edulis/10.jpg',
  // plants:end
];

// Διάφανο πλακίδιο 1×1, όταν δεν υπάρχει σύνδεση και το πλακίδιο δεν έχει κατέβει.
const BLANK_TILE_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Σβήνει ΜΟΝΟ παλιές δικές του μνήμες. Η lite (lite/) έχει δικές της (lite-*) και κοινά πλακίδια χάρτη.
    await Promise.all(keys.filter((k) => k.startsWith('dunes-shell-') && k !== APP_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function blankTile() {
  const bin = atob(BLANK_TILE_B64);
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new Response(bytes, { status: 200, headers: { 'Content-Type': 'image/png' } });
}

async function tileResponse(request) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(request.url);
  if (hit) return hit;
  try {
    // Ζητάμε με CORS ώστε η απάντηση να αποθηκεύεται κανονικά (όχι «opaque»).
    const res = await fetch(request.url, { mode: 'cors', credentials: 'omit' });
    if (res.ok) await cache.put(request.url, res.clone());
    return res;
  } catch (e) {
    console.warn('SW: πλακίδιο με CORS απέτυχε, δοκιμή χωρίς CORS:', request.url, e && e.message);
  }
  try {
    return await fetch(request);
  } catch {
    // Εκτός σύνδεσης και χωρίς αποθηκευμένο πλακίδιο: αναμενόμενο. Φαίνεται το πλέγμα του χάρτη.
    return blankTile();
  }
}

async function shellResponse(event) {
  const request = event.request;
  const cache = await caches.open(APP_CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  if (hit) {
    event.waitUntil(network); // ενημέρωση στο παρασκήνιο για την επόμενη φορά
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
  if (TILE_HOSTS.includes(url.hostname)) {
    event.respondWith(tileResponse(request));
    return;
  }
  if (url.origin !== self.location.origin) return;
  event.respondWith(shellResponse(event));
});
