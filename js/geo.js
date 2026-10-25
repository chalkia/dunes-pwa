// Γεωμετρία και θέση. Καθαρές συναρτήσεις, εκτός από το getPosition.
const R_EARTH = 6371008.8;

export function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function hasLatLon(p) {
  return !!p && toNum(p.lat) !== null && toNum(p.lon) !== null;
}

// Απόσταση σε μέτρα ανάμεσα σε δύο σημεία {lat, lon}.
export function haversine(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Σημείο στο ευθύγραμμο τμήμα a→b, στο κλάσμα f (0..1). Αρκεί για αποστάσεις δεκάδων μέτρων.
export function lerp(a, b, f) {
  return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
}

// Μήκος διατομής από τον χάρτη (αν υπάρχουν αρχή και τέλος), αλλιώς null.
export function mapLength(t) {
  if (!t || !hasLatLon(t.start) || !hasLatLon(t.end)) return null;
  return haversine(t.start, t.end);
}

// Η θέση που δείχνουμε για ένα σημείο.
//  1. Η δική του θέση (GPS ή χάρτης).
//  2. Αλλιώς, αν έχει απόσταση από τη θάλασσα και η διατομή έχει αρχή και τέλος,
//     υπολογίζεται πάνω στην ευθεία της διατομής (src = 'calc').
//  3. Αλλιώς null.
export function effectivePos(p, t) {
  if (hasLatLon(p.pos)) {
    return { lat: Number(p.pos.lat), lon: Number(p.pos.lon), src: p.pos.src || 'map', acc: toNum(p.pos.acc) };
  }
  const d = toNum(p.dist_m);
  if (d !== null && t && hasLatLon(t.start) && hasLatLon(t.end)) {
    const len = toNum(t.length_m) || haversine(t.start, t.end);
    if (len > 0) {
      const f = Math.min(1, Math.max(0, d / len));
      const q = lerp(t.start, t.end, f);
      return { lat: q.lat, lon: q.lon, src: 'calc', acc: null };
    }
  }
  return null;
}

// Θέση από το GPS της συσκευής. Απορρίπτει με { code, message } όταν δεν υπάρχει θέση.
export function getPosition({ timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject({ code: 0, message: 'Η συσκευή δεν υποστηρίζει θέση.' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({
        lat: p.coords.latitude,
        lon: p.coords.longitude,
        acc: Math.round(p.coords.accuracy),
        src: 'gps',
        ts: new Date(p.timestamp).toISOString(),
      }),
      (e) => reject({ code: e.code, message: e.message }),
      { enableHighAccuracy: true, timeout, maximumAge: 0 },
    );
  });
}

export function gpsErrorText(e) {
  if (e && e.code === 1) return 'Δεν επιτρέπεται η θέση. Άνοιξε τις ρυθμίσεις του browser και δώσε άδεια θέσης.';
  if (e && e.code === 3) return 'Δεν βρέθηκε θέση εγκαίρως. Το tablet μάλλον δεν έχει GPS. Διάλεξε θέση στον χάρτη ή άφησέ την για αργότερα.';
  return 'Το tablet δεν δίνει θέση. Διάλεξε θέση στον χάρτη ή άφησέ την για αργότερα.';
}

// ---- Πλακίδια χάρτη (για τη λήψη εκτός σύνδεσης) ----
export function lonToTileX(lon, z) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

export function latToTileY(lat, z) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

// Όλα τα πλακίδια που καλύπτουν το ορθογώνιο b από το zmin ώς το zmax.
export function tilesForBounds(b, zmin, zmax) {
  const out = [];
  for (let z = zmin; z <= zmax; z += 1) {
    const x0 = lonToTileX(b.west, z);
    const x1 = lonToTileX(b.east, z);
    const y0 = latToTileY(b.north, z);
    const y1 = latToTileY(b.south, z);
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) out.push({ z, x, y });
    }
  }
  return out;
}

export function expandBounds(b, margin) {
  return { south: b.south - margin, north: b.north + margin, west: b.west - margin, east: b.east + margin };
}
