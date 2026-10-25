// Αποθήκευση στη συσκευή (IndexedDB). Δουλεύει χωρίς σύνδεση.
// Πίνακες: transects, points, photos (με blob), settings.
const DB_NAME = 'dunes-pwa';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('transects', { keyPath: 'id' });
        const pts = db.createObjectStore('points', { keyPath: 'id' });
        pts.createIndex('transectId', 'transectId');
        const ph = db.createObjectStore('photos', { keyPath: 'id' });
        ph.createIndex('pointId', 'pointId');
        ph.createIndex('transectId', 'transectId');
        db.createObjectStore('settings', { keyPath: 'key' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('Η βάση είναι ανοιχτή σε άλλη καρτέλα. Κλείσε τις άλλες καρτέλες.'));
    });
  }
  return dbPromise;
}

// Τρέχει fn(...stores) μέσα σε μία συναλλαγή. Επιστρέφει όταν ολοκληρωθεί ΟΛΗ η συναλλαγή.
function run(storeNames, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    const stores = (Array.isArray(storeNames) ? storeNames : [storeNames]).map((n) => t.objectStore(n));
    let out;
    try {
      out = fn(...stores);
    } catch (e) {
      t.abort();
      reject(e);
      return;
    }
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Η συναλλαγή ακυρώθηκε.'));
  }));
}

export const dbGetAll = (store) => run(store, 'readonly', (s) => s.getAll());
export const dbGet = (store, key) => run(store, 'readonly', (s) => s.get(key));
export const dbPut = (store, value) => run(store, 'readwrite', (s) => s.put(value));
export const dbDelete = (store, key) => run(store, 'readwrite', (s) => s.delete(key));
export const dbClear = (store) => run(store, 'readwrite', (s) => s.clear());
export const dbByIndex = (store, index, key) => run(store, 'readonly', (s) => s.index(index).getAll(key));

export function dbPutMany(store, values) {
  return run(store, 'readwrite', (s) => { values.forEach((v) => s.put(v)); });
}

export function dbDeleteMany(store, keys) {
  return run(store, 'readwrite', (s) => { keys.forEach((k) => s.delete(k)); });
}

export async function getSetting(key, fallback = null) {
  const row = await dbGet('settings', key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  return dbPut('settings', { key, value });
}

// Ζητά από τον browser να μη σβήσει τα δεδομένα όταν λείπει χώρος.
export async function askPersistent() {
  if (navigator.storage && navigator.storage.persist) {
    return navigator.storage.persist();
  }
  return false;
}

export async function storageInfo() {
  const info = { persisted: false, usage: null, quota: null };
  if (navigator.storage && navigator.storage.persisted) info.persisted = await navigator.storage.persisted();
  if (navigator.storage && navigator.storage.estimate) {
    const e = await navigator.storage.estimate();
    info.usage = e.usage ?? null;
    info.quota = e.quota ?? null;
  }
  return info;
}
