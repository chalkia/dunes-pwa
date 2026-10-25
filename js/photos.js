// Σμίκρυνση φωτογραφιών. Μια φωτογραφία tablet είναι 4–12 MB. Εδώ γίνεται ≈ 300–500 KB.
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Δεν διαβάστηκε η φωτογραφία.')); };
    img.src = url;
  });
}

export async function resizeImage(file, maxSide = 1600, quality = 0.85) {
  let src;
  if (typeof createImageBitmap === 'function') {
    try {
      src = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
      // Κάποιοι browsers δεν δέχονται τη ρύθμιση προσανατολισμού. Δοκιμάζουμε με εικόνα.
      console.warn('createImageBitmap απέτυχε, δοκιμή με Image:', e);
      src = await loadImage(file);
    }
  } else {
    src = await loadImage(file);
  }
  const w = src.width || src.naturalWidth;
  const h = src.height || src.naturalHeight;
  if (!w || !h) throw new Error('Άκυρο μέγεθος φωτογραφίας.');
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.round(w * scale);
  const ch = Math.round(h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  canvas.getContext('2d').drawImage(src, 0, 0, cw, ch);
  if (typeof src.close === 'function') src.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Αποτυχία συμπίεσης φωτογραφίας.'))), 'image/jpeg', quality);
  });
}
