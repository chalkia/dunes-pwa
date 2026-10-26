// Μετατροπή των δεδομένων σε γραμμές, CSV, GeoJSON και KML. Καθαρές συναρτήσεις, χωρίς DOM.
// Έτσι δοκιμάζονται και στο Node (tools/check_columns.mjs).
import {
  KINDS, PRESSURES, PHOTO_SUBJECTS, SPECIES, CRITERIA, HEALTH_BANDS, POINT_COLUMNS, TRANSECT_COLUMNS, SRC_LABEL, MODES, APP_NAME, LEVELS,
} from './schema.js';
import { effectivePos, hasLatLon, toNum } from './geo.js';
import { areaGeometry } from './area.js';

const pressureById = Object.fromEntries(PRESSURES.map((p) => [p.id, p]));
const subjectById = Object.fromEntries(PHOTO_SUBJECTS.map((s) => [s.id, s]));
const speciesById = Object.fromEntries(SPECIES.map((s) => [s.id, s]));

export const dateOf = (t) => ((t && t.datetime) || '').slice(0, 10);
export const timeOf = (t) => ((t && t.datetime) || '').slice(11, 16);

export function clockOf(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

const blank = (v) => (v === null || v === undefined ? '' : v);

// Πλαίσιο έρευνας: τετράγωνο με αριθμό πλαισίου (τρόπος «πλαίσια»), χωρίς απόσταση στη διατομή.
export const isPlot = (p) => p.kind === 'quadrat' && toNum(p.plot) !== null;

// Πινέζες κάτοψης σε κείμενο: «1: Κρινάκι (σημείωση); 2: …».
export function pinLabel(pin) {
  const sp = pin.species && speciesById[pin.species] ? speciesById[pin.species].name : '';
  const name = [sp, pin.other].filter(Boolean).join(' / ') || 'φυτό;';
  return `${name}${pin.note ? ` (${pin.note})` : ''}`;
}
export function pinsText(p) {
  return (p.pins || []).map((pin, i) => `${i + 1}: ${pinLabel(pin)}`).join('; ');
}

// Όνομα αρχείου της κάτοψης με ζωγραφισμένες πινέζες (φτιάχνεται στην εξαγωγή).
export function pinnedName(topName) {
  return topName.replace(/\.jpg$/i, '_πινέζες.jpg');
}

// Κάτοψη με το πλέγμα 10×10 στις 4 γωνίες του πλαισίου (lite, φτιάχνεται στην εξαγωγή).
export function gridName(topName) {
  return topName.replace(/\.jpg$/i, '_πλέγμα.jpg');
}
export const hasQuad = (p) => Array.isArray(p.quad) && p.quad.length === 4;
const levelById = Object.fromEntries(LEVELS.map((l) => [l.id, l]));

export function pointName(p) {
  switch (p.kind) {
    case 'quadrat': return isPlot(p) ? `Πλαίσιο ${p.plot}` : `Τετράγωνο ${blank(p.dist_m)} μ.`;
    case 'pressure': return `Πίεση: ${(pressureById[p.pressure_type] || { short: '—' }).short.replace(/_/g, ' ')}`;
    case 'lilies': return `Κρινάκια${p.lilies ? ` (${p.lilies})` : ''}`;
    case 'invasive': return 'Εισβλητικό φυτό';
    case 'unknown': return `Άγνωστο φυτό ${blank(p.seq)}`.trim();
    case 'zone': return `Ζώνη ${blank(p.zone)} ξεκινά${p.dist_m !== null && p.dist_m !== undefined ? ` στα ${p.dist_m} μ.` : ''}`;
    case 'photo': return (subjectById[p.subject] || subjectById.other).label;
    case 'stop': return `Στάση ${blank(p.letter)}${p.dist_m !== null && p.dist_m !== undefined ? ` (${p.dist_m} μ.)` : ''}`;
    default: return KINDS[p.kind] ? KINDS[p.kind].label : String(p.kind);
  }
}

export function bandFor(total) {
  return HEALTH_BANDS.find((b) => total <= b.max) || HEALTH_BANDS[HEALTH_BANDS.length - 1];
}

export function healthScore(t) {
  const sc = (t.health && t.health.scores) || {};
  const vals = CRITERIA.map((c) => toNum(sc[c.id]));
  const answered = vals.filter((v) => v !== null).length;
  const partial = vals.reduce((a, v) => a + (v || 0), 0);
  const complete = answered === CRITERIA.length;
  return { answered, complete, partial, total: complete ? partial : null, band: complete ? bandFor(partial) : null };
}

// Σύγκριση για ταξινόμηση: πρώτα κατά απόσταση (όσα δεν έχουν, στο τέλος), μετά κατά χρόνο.
export function byDistance(a, b) {
  const da = toNum(a.dist_m);
  const db = toNum(b.dist_m);
  if (da !== null && db !== null && da !== db) return da - db;
  if (da !== null && db === null) return -1;
  if (da === null && db !== null) return 1;
  return String(a.ts || '').localeCompare(String(b.ts || ''));
}

// ---- Ονόματα αρχείων φωτογραφιών: Παραλία_ημερομηνία_ομάδα_T10_τετράγωνο.jpg ----
const safe = (s) => String(s === null || s === undefined ? '' : s)
  .normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '');

function photoLabel(p) {
  switch (p.kind) {
    case 'quadrat': return isPlot(p) ? `πλαίσιο${p.plot}` : 'τετράγωνο';
    case 'unknown': return `άγνωστο${blank(p.seq)}`;
    case 'pressure': return `πίεση_${(pressureById[p.pressure_type] || { short: 'άλλο' }).short}`;
    case 'lilies': return 'κρινάκια';
    case 'invasive': return 'εισβλητικό';
    case 'zone': return `ζώνη${blank(p.zone)}`;
    case 'photo': return (subjectById[p.subject] || subjectById.other).short;
    case 'stop': return `στάση${blank(p.letter)}`;
    default: return String(p.kind);
  }
}

// Επιστρέφει Map από id φωτογραφίας σε όνομα αρχείου. Τα ονόματα είναι μοναδικά.
export function assignPhotoNames(data) {
  const tById = new Map(data.transects.map((t) => [t.id, t]));
  const pById = new Map(data.points.map((p) => [p.id, p]));
  const sorted = [...data.photos].sort((a, b) => String(a.ts).localeCompare(String(b.ts)) || String(a.id).localeCompare(String(b.id)));
  const perPoint = new Map();
  sorted.forEach((ph) => perPoint.set(ph.pointId, (perPoint.get(ph.pointId) || 0) + 1));
  const seenAtPoint = new Map();
  const used = new Set();
  const names = new Map();
  sorted.forEach((ph) => {
    const p = pById.get(ph.pointId) || { kind: 'photo' };
    const t = tById.get(ph.transectId || p.transectId) || {};
    const d = toNum(p.dist_m);
    const idx = (seenAtPoint.get(ph.pointId) || 0) + 1;
    seenAtPoint.set(ph.pointId, idx);
    const parts = [
      safe(t.beach), dateOf(t), safe(t.team), d !== null ? safe(`T${d}`) : '', safe(photoLabel(p)), p.topPhotoId === ph.id ? 'κάτοψη' : '',
      perPoint.get(ph.pointId) > 1 ? String(idx) : '',
    ].filter(Boolean);
    const base = parts.join('_') || `φωτογραφία_${safe(ph.id)}`;
    let name = `${base}.jpg`;
    let n = 2;
    while (used.has(name)) { name = `${base}_${n}.jpg`; n += 1; }
    used.add(name);
    names.set(ph.id, name);
  });
  return names;
}

// ---- Γραμμές ----
function posFields(pos) {
  if (!pos) return { lat: '', lon: '', pos_source: SRC_LABEL.none, accuracy_m: '' };
  return {
    lat: Number(pos.lat.toFixed(7)),
    lon: Number(pos.lon.toFixed(7)),
    pos_source: SRC_LABEL[pos.src] || pos.src,
    accuracy_m: pos.acc === null || pos.acc === undefined ? '' : pos.acc,
  };
}

export function pointRow(p, t, names) {
  const sp = (p.species || []).map((id) => (speciesById[id] ? speciesById[id].name : id));
  if (p.species_other) sp.push(p.species_other);
  const files = (p.photoIds || []).map((id) => names.get(id)).filter(Boolean);
  const top = p.topPhotoId && names.get(p.topPhotoId);
  if (top && (p.pins || []).length) files.unshift(pinnedName(top));
  if (top && hasQuad(p)) files.unshift(gridName(top));
  return {
    id: p.id,
    team: blank(t.team),
    school: blank(t.school),
    beach: blank(t.beach),
    date: dateOf(t),
    time: clockOf(p.ts),
    kind: (KINDS[p.kind] || { label: p.kind }).label,
    name: pointName(p),
    dist_m: blank(toNum(p.dist_m)),
    zone: blank(toNum(p.zone)),
    bare_pct: blank(toNum(p.bare_pct)),
    litter_pct: blank(toNum(p.litter_pct)),
    plants_pct: blank(toNum(p.plants_pct)),
    invasive_pct: blank(toNum(p.invasive_pct)),
    species_count: blank(toNum(p.species_count)),
    lilies: blank(toNum(p.lilies)),
    species: sp.join('; '),
    footprint: p.footprint === 'yes' ? 'Ναι' : p.footprint === 'no' ? 'Όχι' : '',
    pressure_type: p.kind === 'pressure' && pressureById[p.pressure_type] ? pressureById[p.pressure_type].label : '',
    plot: isPlot(p) ? Number(p.plot) : '',
    pins: pinsText(p),
    level: levelById[p.level] ? levelById[p.level].label : '',
    observe: blank(p.observe),
    comment: blank(p.comment),
    ...posFields(effectivePos(p, t)),
    photos: files.join(' | '),
  };
}

function endRow(t, which) {
  const pos = t[which];
  const len = toNum(t.length_m);
  return {
    id: `${t.id}:${which}`,
    team: blank(t.team),
    school: blank(t.school),
    beach: blank(t.beach),
    date: dateOf(t),
    time: '',
    kind: KINDS[which].label,
    name: KINDS[which].label,
    dist_m: which === 'start' ? 0 : blank(len),
    zone: '',
    bare_pct: '',
    litter_pct: '',
    plants_pct: '',
    invasive_pct: '',
    species_count: '',
    lilies: '',
    species: '',
    footprint: '',
    pressure_type: '',
    plot: '',
    pins: '',
    level: '',
    observe: '',
    comment: '',
    ...posFields(hasLatLon(pos) ? { lat: Number(pos.lat), lon: Number(pos.lon), src: pos.src || 'map', acc: toNum(pos.acc) } : null),
    photos: '',
  };
}

export function transectRow(t, data) {
  const h = t.health || {};
  const sc = h.scores || {};
  const why = h.why || {};
  const imp = h.impressions || [];
  const hs = healthScore(t);
  const mine = data.points.filter((p) => p.transectId === t.id);
  return {
    id: t.id,
    school: blank(t.school),
    team: blank(t.team),
    members: blank(t.members),
    beach: blank(t.beach),
    area: blank(t.areaCode),
    mode: MODES[t.mode] ? MODES[t.mode].label : '',
    date: dateOf(t),
    time: timeOf(t),
    weather: blank(t.weather),
    length_m: blank(toNum(t.length_m)),
    spacing_m: blank(toNum(t.spacing_m)),
    start_lat: hasLatLon(t.start) ? Number(Number(t.start.lat).toFixed(7)) : '',
    start_lon: hasLatLon(t.start) ? Number(Number(t.start.lon).toFixed(7)) : '',
    start_source: hasLatLon(t.start) ? (SRC_LABEL[t.start.src] || t.start.src) : SRC_LABEL.none,
    end_lat: hasLatLon(t.end) ? Number(Number(t.end.lat).toFixed(7)) : '',
    end_lon: hasLatLon(t.end) ? Number(Number(t.end.lon).toFixed(7)) : '',
    end_source: hasLatLon(t.end) ? (SRC_LABEL[t.end.src] || t.end.src) : SRC_LABEL.none,
    n_quadrats: mine.filter((p) => p.kind === 'quadrat').length,
    n_photos: data.photos.filter((ph) => ph.transectId === t.id).length,
    score_cover: blank(toNum(sc.cover)),
    why_cover: blank(why.cover),
    score_lilies: blank(toNum(sc.lilies)),
    why_lilies: blank(why.lilies),
    score_zonation: blank(toNum(sc.zonation)),
    why_zonation: blank(why.zonation),
    score_invasive: blank(toNum(sc.invasive)),
    why_invasive: blank(why.invasive),
    score_pressure: blank(toNum(sc.pressure)),
    why_pressure: blank(why.pressure),
    score_total: hs.total === null ? '' : hs.total,
    health_label: hs.band ? hs.band.label : '',
    impression_1: blank(imp[0]),
    impression_2: blank(imp[1]),
    impression_3: blank(imp[2]),
    proposal: blank(h.proposal),
    notes: blank(t.notes),
  };
}

// data: { transects, points, photos }, names: Map από assignPhotoNames
export function buildRows(data, names) {
  const points = [];
  const transects = [];
  const ordered = [...data.transects].sort((a, b) => String(a.datetime).localeCompare(String(b.datetime)) || String(a.team).localeCompare(String(b.team)));
  ordered.forEach((t) => {
    transects.push(transectRow(t, data));
    points.push(endRow(t, 'start'));
    data.points.filter((p) => p.transectId === t.id).sort(byDistance).forEach((p) => points.push(pointRow(p, t, names)));
    points.push(endRow(t, 'end'));
  });
  return { points, transects };
}

// ---- CSV ----
function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows, columns) {
  const lines = [columns.map((c) => csvCell(c.label)).join(',')];
  rows.forEach((r) => lines.push(columns.map((c) => csvCell(r[c.key])).join(',')));
  return `﻿${lines.join('\r\n')}\r\n`; // BOM: ώστε τα ελληνικά να ανοίγουν σωστά στο Excel
}

const hasPos = (r) => r.lat !== '' && r.lon !== '';

export function describeRow(r) {
  const out = [];
  const add = (label, v) => { if (v !== '' && v !== null && v !== undefined) out.push([label, String(v)]); };
  add('Είδος', r.kind);
  add('Ομάδα', r.team);
  add('Παραλία', `${r.beach} ${r.date}`.trim());
  add('Απόσταση από θάλασσα', r.dist_m !== '' ? `${r.dist_m} μ.` : '');
  add('Ζώνη', r.zone);
  add('Γυμνή άμμος', r.bare_pct !== '' ? `${r.bare_pct}%` : '');
  add('Νεκρά φύλλα / ξύλα / φύκια', r.litter_pct !== '' ? `${r.litter_pct}%` : '');
  add('Φυτά σύνολο', r.plants_pct !== '' ? `${r.plants_pct}%` : '');
  add('Εισβλητικά', r.invasive_pct !== '' ? `${r.invasive_pct}%` : '');
  add('Αριθμός ειδών', r.species_count);
  add('Κρινάκια (άτομα)', r.lilies);
  add('Είδη', r.species);
  add('Αποτύπωμα / μονοπάτι στο τετράγωνο', r.footprint);
  add('Πίεση', r.pressure_type);
  add('Πλαίσιο', r.plot);
  add('Φυτά στην κάτοψη', r.pins);
  add('Φυτά', r.level);
  add('Τι βλέπω / γιατί', r.observe);
  add('Σχόλιο', r.comment);
  add('Θέση', r.pos_source);
  return out;
}

// CSV για εισαγωγή στο Google My Maps: μόνο σημεία με θέση, πρώτες στήλες Όνομα, Περιγραφή, πλάτος, μήκος.
export function toMyMapsCsv(rows) {
  const placed = rows.filter(hasPos).map((r) => ({
    ...r,
    description: describeRow(r).map(([k, v]) => `${k}: ${v}`).join(' | '),
  }));
  const rest = POINT_COLUMNS.filter((c) => !['name', 'lat', 'lon', 'id'].includes(c.key));
  const cols = [
    { key: 'name', label: 'Όνομα' },
    { key: 'description', label: 'Περιγραφή' },
    { key: 'lat', label: 'Latitude' },
    { key: 'lon', label: 'Longitude' },
    ...rest,
  ];
  return toCsv(placed, cols);
}

// ---- GeoJSON ----
export function toGeoJson(data, rows) {
  const features = data.area
    ? [{ type: 'Feature', properties: { kind: 'Περιοχή', name: data.area.name, code: data.area.code }, geometry: areaGeometry(data.area) }]
    : [];
  data.transects.forEach((t) => {
    if (hasLatLon(t.start) && hasLatLon(t.end)) {
      features.push({
        type: 'Feature',
        properties: { kind: 'Διατομή', name: `${blank(t.team)} — ${blank(t.beach)} ${dateOf(t)}`, team: blank(t.team), beach: blank(t.beach), date: dateOf(t) },
        geometry: { type: 'LineString', coordinates: [[Number(t.start.lon), Number(t.start.lat)], [Number(t.end.lon), Number(t.end.lat)]] },
      });
    }
  });
  rows.points.filter(hasPos).forEach((r) => {
    const props = {};
    POINT_COLUMNS.forEach((c) => { props[c.key] = r[c.key]; });
    features.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [r.lon, r.lat] } });
  });
  return { type: 'FeatureCollection', features };
}

// ---- KML ----
const x = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const kmlColor = (hex) => {
  const h = hex.replace('#', '');
  return `ff${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`; // KML: aabbggrr
};

// photoRel: φάκελος φωτογραφιών σχετικά με το KML, π.χ. 'photos'
export function toKml(data, rows, names, photoRel = 'photos') {
  const kindKey = Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [v.label, k]));
  const styles = Object.entries(KINDS).map(([k, v]) => `
  <Style id="k_${k}"><IconStyle><color>${kmlColor(v.color)}</color><scale>1.1</scale><Icon><href>https://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle><LabelStyle><scale>0.8</scale></LabelStyle></Style>`).join('');
  const ring = data.area ? areaGeometry(data.area).coordinates[0].map((c) => `${c[0]},${c[1]},0`).join(' ') : '';
  const areaKml = !data.area ? '' : `
  <Placemark><name>${x(data.area.name)}</name><Style><LineStyle><color>ff1f6b91</color><width>2</width></LineStyle><PolyStyle><color>331f6b91</color></PolyStyle></Style>
    <Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>${ring}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;

  const folders = [...data.transects].sort((a, b) => String(a.datetime).localeCompare(String(b.datetime))).map((t) => {
    const mine = rows.points.filter((r) => r.id.startsWith(`${t.id}:`) || data.points.some((p) => p.id === r.id && p.transectId === t.id));
    const photoOf = (r) => (r.photos ? r.photos.split(' | ') : []);
    let line = '';
    if (hasLatLon(t.start) && hasLatLon(t.end)) {
      line = `
    <Placemark><name>Διατομή</name><Style><LineStyle><color>ff1f6b91</color><width>3</width></LineStyle></Style>
      <LineString><tessellate>1</tessellate><coordinates>${Number(t.start.lon)},${Number(t.start.lat)},0 ${Number(t.end.lon)},${Number(t.end.lat)},0</coordinates></LineString></Placemark>`;
    }
    const marks = mine.filter(hasPos).map((r) => {
      const k = kindKey[r.kind] || 'photo';
      const table = describeRow(r).map(([a, b]) => `<tr><td><b>${x(a)}</b></td><td>${x(b)}</td></tr>`).join('');
      const imgs = photoOf(r).map((f) => `<p><img src="${x(`${photoRel}/${encodeURI(f)}`)}" width="360"/></p>`).join('');
      return `
    <Placemark><name>${x(r.name)}${r.pos_source === SRC_LABEL.calc ? ' ≈' : ''}</name><styleUrl>#k_${k}</styleUrl>
      <description><![CDATA[<table>${table}</table>${imgs}]]></description>
      <Point><coordinates>${r.lon},${r.lat},0</coordinates></Point></Placemark>`;
    }).join('');
    return `
  <Folder><name>${x(`${blank(t.team)} — ${blank(t.beach)} ${dateOf(t)}`)}</name>${line}${marks}
  </Folder>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <name>${x(data.area ? `${APP_NAME} — ${data.area.name}` : `${APP_NAME} — καταγραφή πεδίου`)}</name>${styles}${areaKml}${folders}
</Document></kml>
`;
}

// Ελληνικά → λατινικά (απλοποιημένο ΕΛΟΤ 743), μόνο για το όνομα του εξαγόμενου αρχείου.
// Λόγος: σε headless Chromium ένα ελληνικό όνομα στο «download» έβγαινε ως «download» (δοκιμή 25/10).
// Τα ονόματα των φωτογραφιών ΜΕΣΑ στο ZIP μένουν ελληνικά, όπως ζητά το πρωτόκολλο.
const GREEK = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x',
  ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
};
export function latinize(s) {
  const plain = String(s === null || s === undefined ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return [...plain].map((ch) => {
    const low = ch.toLowerCase();
    if (!GREEK[low]) return ch;
    const out = GREEK[low];
    return ch === low ? out : out.charAt(0).toUpperCase() + out.slice(1);
  }).join('');
}

// Βάση ονόματος για τα αρχεία εξαγωγής (λατινικά, ασφαλή για email και Drive).
export function exportBaseName(data) {
  if (data.transects.length === 1) {
    const t = data.transects[0];
    return ['Ammothines', safe(latinize(t.team)), safe(latinize(t.beach)), dateOf(t)].filter(Boolean).join('_');
  }
  return `Ammothines_${data.transects.length}_omades_${new Date().toISOString().slice(0, 10)}`;
}

export function readmeText(meta) {
  return `${APP_NAME.toUpperCase()} — ΠΑΚΕΤΟ ΔΕΔΟΜΕΝΩΝ${meta.area ? ` — ${meta.area.name} (${meta.area.code})` : ''}
Εξαγωγή: ${meta.exportedAt}
Διατομές: ${meta.nTransects} · Σημεία: ${meta.nPoints} · Φωτογραφίες: ${meta.nPhotos}

ΑΡΧΕΙΑ
  points.csv           όλα τα σημεία (και όσα δεν έχουν θέση)
  points_mymaps.csv    μόνο σημεία με θέση, έτοιμο για Google My Maps
  transects.csv        ταυτότητα έρευνας και βαθμολογία υγείας ανά διατομή
  data.geojson         για QGIS, ArcGIS και άλλα συστήματα GIS
  doc.kml              για Google Earth (οι φωτογραφίες είναι στον φάκελο photos)
  data.json            πλήρες αντίγραφο ασφαλείας. Η εφαρμογή το διαβάζει με «Εισαγωγή».
  photos/              οι φωτογραφίες, π.χ. Παραλία_ημερομηνία_ομάδα_T10_τετράγωνο.jpg ή …_πλαίσιο2_κάτοψη.jpg
                       (…_πινέζες.jpg: η κάτοψη με αριθμημένες πινέζες φυτών)

ΣΤΟ GOOGLE MY MAPS
  1. mymaps.google.com → Δημιουργία νέου χάρτη.
  2. Εισαγωγή → points_mymaps.csv (ή το KMZ).
  3. Στήλη θέσης: Latitude και Longitude. Τίτλος: Όνομα.
  4. Κάθε ομάδα μπορεί να βάλει το αρχείο της σε δικό της επίπεδο στον ΙΔΙΟ χάρτη.

ΣΗΜΕΙΩΣΗ ΓΙΑ ΘΕΣΕΙΣ
  Πηγή «υπολογισμένη»: το σημείο δεν είχε δική του θέση.
  Η θέση του βγήκε πάνω στην ευθεία από την αρχή ώς το τέλος της διατομής, με βάση την απόσταση.
`;
}

export { POINT_COLUMNS, TRANSECT_COLUMNS };
