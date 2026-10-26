// Περιοχή έρευνας. Την ορίζει ο/η εκπαιδευτικός και φτάνει σε όλα τα tablet με QR, σύνδεσμο ή κωδικό καταλόγου.
// Μορφή: { code: 'RETH26', name: 'Ρέθυμνο …', poly: [[lat, lon], …] }  (πολύγωνο χωρίς επανάληψη της 1ης κορυφής)
// Καθαρές συναρτήσεις: δεν αγγίζουν DOM ή βάση. Ελέγχονται από το tools/check_all.mjs.

export const CODE_RE = /^[A-Z0-9-]{3,16}$/;

// Κανονικοποίηση κωδικού που πληκτρολόγησε κάποιος: κεφαλαία, χωρίς κενά, ελληνικά γράμματα που μοιάζουν → λατινικά.
const LOOKALIKE = {
  Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X',
};
export function normCode(s) {
  return String(s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[ΑΒΕΖΗΙΚΜΝΟΡΤΥΧ]/g, (c) => LOOKALIKE[c]).replace(/[\s_]+/g, '').trim();
}

export function validArea(a) {
  if (!a || typeof a !== 'object') return 'Δεν υπάρχει περιοχή.';
  if (!a.name || !String(a.name).trim()) return 'Η περιοχή δεν έχει όνομα.';
  if (!CODE_RE.test(String(a.code || ''))) return 'Ο κωδικός θέλει 3–16 λατινικά κεφαλαία, αριθμούς ή παύλα.';
  if (!Array.isArray(a.poly) || a.poly.length < 3) return 'Η περιοχή χρειάζεται τουλάχιστον 3 κορυφές.';
  for (const p of a.poly) {
    if (!Array.isArray(p) || p.length !== 2) return 'Λάθος κορυφή στο περίγραμμα.';
    const [lat, lon] = p;
    if (!(Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return 'Λάθος συντεταγμένες στο περίγραμμα.';
  }
  return null;
}

export function areaBounds(a) {
  const lats = a.poly.map((p) => p[0]);
  const lons = a.poly.map((p) => p[1]);
  return {
    south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lons), east: Math.max(...lons),
  };
}

export function areaCenter(a) {
  const b = areaBounds(a);
  return { lat: (b.south + b.north) / 2, lon: (b.west + b.east) / 2 };
}

// GeoJSON: σειρά [μήκος, πλάτος] και κλειστός δακτύλιος.
export function areaGeometry(a) {
  const ring = a.poly.map(([lat, lon]) => [lon, lat]);
  ring.push(ring[0]);
  return { type: 'Polygon', coordinates: [ring] };
}

// Εμβαδόν περίπου (μ²), για να δει ο/η εκπαιδευτικός αν η περιοχή είναι λογική.
export function areaSquareMeters(a) {
  const c = areaCenter(a);
  const kx = 111320 * Math.cos((c.lat * Math.PI) / 180);
  const ky = 110540;
  let s = 0;
  for (let i = 0; i < a.poly.length; i += 1) {
    const [la1, lo1] = a.poly[i];
    const [la2, lo2] = a.poly[(i + 1) % a.poly.length];
    s += (lo1 * kx) * (la2 * ky) - (lo2 * kx) * (la1 * ky);
  }
  return Math.abs(s / 2);
}

// ---- Κωδικοποίηση για QR / σύνδεσμο ----
// Κείμενο: 1~όνομα~κωδικός~lat0,lon0,dlat1,dlon1,…  (ακέραιοι ×1e5 ≈ 1 μέτρο), μετά base64url.
const SCALE = 1e5;

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeArea(a) {
  const err = validArea(a);
  if (err) throw new Error(err);
  const nums = [];
  let pl = 0;
  let po = 0;
  a.poly.forEach(([lat, lon], i) => {
    const il = Math.round(lat * SCALE);
    const io = Math.round(lon * SCALE);
    nums.push(i === 0 ? il : il - pl, i === 0 ? io : io - po);
    pl = il;
    po = io;
  });
  const name = String(a.name).replace(/~/g, '-');
  return b64urlEncode(`1~${name}~${a.code}~${nums.join(',')}`);
}

export function decodeArea(s) {
  let txt;
  try {
    txt = b64urlDecode(String(s).trim());
  } catch {
    throw new Error('Ο κωδικός δεν διαβάζεται. Έλεγξε ότι τον αντέγραψες ολόκληρο.');
  }
  const parts = txt.split('~');
  if (parts.length !== 4 || parts[0] !== '1') throw new Error('Ο κωδικός δεν είναι περιοχή αυτής της εφαρμογής.');
  const nums = parts[3].split(',').map(Number);
  if (nums.length < 6 || nums.length % 2 || nums.some((n) => !Number.isInteger(n))) throw new Error('Ο κωδικός είναι κομμένος ή λάθος.');
  const poly = [];
  let il = 0;
  let io = 0;
  for (let i = 0; i < nums.length; i += 2) {
    il = i === 0 ? nums[0] : il + nums[i];
    io = i === 0 ? nums[1] : io + nums[i + 1];
    poly.push([il / SCALE, io / SCALE]);
  }
  const a = { name: parts[1], code: parts[2], poly };
  const err = validArea(a);
  if (err) throw new Error(err);
  return a;
}

// Σύνδεσμος για QR. base: η διεύθυνση της εφαρμογής χωρίς # (π.χ. https://x.github.io/dunes-pwa/).
export function areaLink(base, a) {
  return `${base.split('#')[0]}#area=${encodeArea(a)}`;
}

// Από το #… της διεύθυνσης: { area } ή { code } ή null.
export function parseHash(hash) {
  const h = String(hash || '').replace(/^#/, '');
  const q = new URLSearchParams(h);
  if (q.get('area')) return { area: decodeArea(q.get('area')) };
  if (q.get('code')) return { code: normCode(q.get('code')) };
  return null;
}

// Αναζήτηση στον κατάλογο: ακριβής κωδικός πρώτα, μετά λέξεις στο όνομα/περιοχή.
export function searchCatalog(list, query) {
  const q = String(query || '').trim();
  if (!q) return list.slice();
  const code = normCode(q);
  const exact = list.filter((a) => a.code === code);
  if (exact.length) return exact;
  const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const words = fold(q).split(/\s+/).filter(Boolean);
  return list.filter((a) => {
    const hay = fold(`${a.code} ${a.name} ${a.region || ''}`);
    return words.every((w) => hay.includes(w));
  });
}

// Πολύγωνο από KML (μέσα σε KMZ ή σκέτο). Παίρνει το πρώτο Polygon, αλλιώς το πρώτο LineString.
export function polyFromKml(text) {
  const m = text.match(/<Polygon[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/i)
    || text.match(/<LineString[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/i);
  if (!m) throw new Error('Δεν βρέθηκε πολύγωνο μέσα στο αρχείο.');
  const pts = m[1].trim().split(/\s+/).map((t) => t.split(',').map(Number)).filter((c) => c.length >= 2 && c.every(Number.isFinite));
  return closeFree(pts.map(([lon, lat]) => [lat, lon]));
}

// Πολύγωνο από GeoJSON (Feature, FeatureCollection ή Geometry).
export function polyFromGeoJson(obj) {
  const geoms = [];
  const walk = (o) => {
    if (!o) return;
    if (o.type === 'FeatureCollection') o.features.forEach(walk);
    else if (o.type === 'Feature') walk(o.geometry);
    else if (o.type === 'Polygon') geoms.push(o.coordinates[0]);
    else if (o.type === 'MultiPolygon') geoms.push(o.coordinates[0][0]);
  };
  walk(obj);
  if (!geoms.length) throw new Error('Δεν βρέθηκε πολύγωνο μέσα στο αρχείο.');
  return closeFree(geoms[0].map(([lon, lat]) => [lat, lon]));
}

function closeFree(poly) {
  const p = poly.map(([a, b]) => [Math.round(a * SCALE) / SCALE, Math.round(b * SCALE) / SCALE]);
  if (p.length > 1 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1]) p.pop();
  return p;
}

// Πρόταση κωδικού από όνομα: πρώτα 4 λατινικά γράμματα + έτος.
const GR2LAT = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
};
const COMMON_WORDS = new Set(['paralia', 'akti', 'ormos', 'kolpos', 'beach', 'tis', 'tou', 'ton', 'sto', 'sti', 'kai']);
export function suggestCode(name, year = new Date().getFullYear()) {
  const words = String(name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ου/g, 'ou').replace(/[α-ω]/g, (c) => GR2LAT[c] || '').split(/[^a-z0-9]+/).filter(Boolean);
  const main = words.filter((w) => !COMMON_WORDS.has(w));
  const lat = (main.length ? main : words).join('');
  return `${(lat.slice(0, 4) || 'AREA').toUpperCase()}${String(year).slice(-2)}`;
}

// Προσυμπλήρωση συντεταγμένης ως το 1ο δεκαδικό της μοίρας (π.χ. 35.37 → «35.3»). Αποκοπή, όχι στρογγύλευση.
export function coordPrefix(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  const t = Math.trunc(n * 10) / 10;
  return t.toFixed(1);
}

// Διαβάζει συντεταγμένη που έγραψε μαθητής: δέχεται κόμμα ή τελεία. Επιστρέφει αριθμό ή null.
export function parseCoord(s, max) {
  const t = String(s || '').trim().replace(',', '.');
  if (!/^-?\d{1,3}(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Math.abs(n) <= max ? n : null;
}

// Πόσα δεκαδικά έγραψε (για το μήνυμα ακρίβειας).
export function decimalsOf(s) {
  const t = String(s || '').trim().replace(',', '.');
  const i = t.indexOf('.');
  return i < 0 ? 0 : t.length - i - 1;
}
