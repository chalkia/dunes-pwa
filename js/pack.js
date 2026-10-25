// Εξαγωγή και εισαγωγή πακέτων (ZIP, KMZ, CSV). Χρειάζεται το JSZip (καθολική μεταβλητή).
import { dbGetAll, dbPutMany } from './db.js';
import {
  assignPhotoNames, buildRows, toCsv, toMyMapsCsv, toGeoJson, toKml, readmeText, exportBaseName,
} from './rows.js';
import { POINT_COLUMNS, TRANSECT_COLUMNS, APP_VERSION } from './schema.js';

// Φέρνει τα δεδομένα από τη βάση. Με onlyId: μόνο μία διατομή.
export async function collect(onlyId = null) {
  const [transects, points, photos] = await Promise.all([dbGetAll('transects'), dbGetAll('points'), dbGetAll('photos')]);
  const ts = onlyId ? transects.filter((t) => t.id === onlyId) : transects;
  const ids = new Set(ts.map((t) => t.id));
  return {
    transects: ts,
    points: points.filter((p) => ids.has(p.transectId)),
    photos: photos.filter((ph) => ids.has(ph.transectId)),
  };
}

export function counts(data) {
  return { nTransects: data.transects.length, nPoints: data.points.length, nPhotos: data.photos.length };
}

export async function buildPackage(data) {
  const names = assignPhotoNames(data);
  const rows = buildRows(data, names);
  const exportedAt = new Date().toISOString();
  const zip = new JSZip();
  zip.file('README.txt', readmeText({ exportedAt, ...counts(data) }));
  zip.file('points.csv', toCsv(rows.points, POINT_COLUMNS));
  zip.file('points_mymaps.csv', toMyMapsCsv(rows.points));
  zip.file('transects.csv', toCsv(rows.transects, TRANSECT_COLUMNS));
  zip.file('data.geojson', JSON.stringify(toGeoJson(data, rows), null, 1));
  zip.file('doc.kml', toKml(data, rows, names));
  zip.file('data.json', JSON.stringify({
    format: 'dunes-pwa',
    version: 1,
    app: APP_VERSION,
    exportedAt,
    transects: data.transects,
    points: data.points,
    photos: data.photos.map((ph) => ({
      id: ph.id, pointId: ph.pointId, transectId: ph.transectId, ts: ph.ts, kind: ph.kind, file: `photos/${names.get(ph.id)}`,
    })),
  }, null, 1));
  data.photos.forEach((ph) => zip.file(`photos/${names.get(ph.id)}`, ph.blob, { compression: 'STORE' }));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'application/zip' });
}

export async function buildKmz(data) {
  const names = assignPhotoNames(data);
  const rows = buildRows(data, names);
  const zip = new JSZip();
  zip.file('doc.kml', toKml(data, rows, names));
  data.photos.forEach((ph) => zip.file(`photos/${names.get(ph.id)}`, ph.blob, { compression: 'STORE' }));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.google-earth.kmz' });
}

export function buildCsv(data) {
  const names = assignPhotoNames(data);
  const rows = buildRows(data, names);
  return new Blob([toCsv(rows.points, POINT_COLUMNS)], { type: 'text/csv;charset=utf-8' });
}

export { exportBaseName };

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function canShareFiles() {
  if (!navigator.canShare || !navigator.share) return false;
  try {
    return navigator.canShare({ files: [new File(['x'], 'x.txt', { type: 'text/plain' })] });
  } catch (e) {
    console.warn('canShare απέτυχε:', e);
    return false;
  }
}

export async function shareBlob(blob, name, type) {
  await navigator.share({ files: [new File([blob], name, { type })], title: name });
}

// Εισαγωγή πακέτου άλλης ομάδας. Συγχώνευση με το id: κερδίζει το νεότερο updatedAt.
export async function importPackage(file) {
  const zip = await JSZip.loadAsync(file);
  const jf = zip.file('data.json');
  if (!jf) throw new Error('Το αρχείο δεν είναι πακέτο της εφαρμογής (λείπει το data.json).');
  const m = JSON.parse(await jf.async('string'));
  if (m.format !== 'dunes-pwa') throw new Error('Το data.json δεν είναι από αυτή την εφαρμογή.');
  const [exT, exP, exPh] = await Promise.all([dbGetAll('transects'), dbGetAll('points'), dbGetAll('photos')]);
  const mapT = new Map(exT.map((r) => [r.id, r]));
  const mapP = new Map(exP.map((r) => [r.id, r]));
  const havePh = new Set(exPh.map((r) => r.id));
  const newer = (inc, ex) => !ex || String(inc.updatedAt || '') > String(ex.updatedAt || '');
  const addT = (m.transects || []).filter((t) => newer(t, mapT.get(t.id)));
  const addP = (m.points || []).filter((p) => newer(p, mapP.get(p.id)));
  const addPh = [];
  let missing = 0;
  for (const meta of m.photos || []) {
    if (havePh.has(meta.id)) continue;
    const entry = zip.file(meta.file);
    if (!entry) { missing += 1; continue; }
    const raw = await entry.async('blob');
    addPh.push({ id: meta.id, pointId: meta.pointId, transectId: meta.transectId, ts: meta.ts, kind: meta.kind, blob: new Blob([raw], { type: 'image/jpeg' }) });
  }
  await dbPutMany('transects', addT);
  await dbPutMany('points', addP);
  await dbPutMany('photos', addPh);
  return { transects: addT.length, points: addP.length, photos: addPh.length, missing };
}
