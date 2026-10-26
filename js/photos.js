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

// Πινέζα: κύκλος με αριθμό. x, y από 0 έως 1 (θέση πάνω στη φωτογραφία).
// Χρησιμοποιείται για την εικόνα «…_πινέζες.jpg» της εξαγωγής.
export function drawPin(ctx, x, y, n, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#E8684A';
  ctx.fill();
  ctx.lineWidth = Math.max(2, r * 0.18);
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(r * 1.1)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), x, y + r * 0.05);
  ctx.restore();
}

// Κάτοψη + αριθμημένες πινέζες + υπόμνημα στο κάτω μέρος. labels: κείμενο ανά πινέζα.
export async function pinnedImage(blob, pins, labels, title) {
  const src = await createImageBitmap(blob);
  const w = src.width;
  const h = src.height;
  const r = Math.max(14, Math.round(Math.min(w, h) * 0.028));
  const line = Math.round(r * 1.5);
  const legendH = Math.round(line * (pins.length + 1.6));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h + legendH;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, 0, 0);
  if (typeof src.close === 'function') src.close();
  pins.forEach((p, i) => drawPin(g, p.x * w, p.y * h, i + 1, r));
  g.fillStyle = '#213236';
  g.font = `bold ${Math.round(r * 1.05)}px sans-serif`;
  g.textBaseline = 'middle';
  g.fillText(title, r, h + line * 0.8, w - 2 * r);
  g.font = `${Math.round(r)}px sans-serif`;
  labels.forEach((t, i) => {
    const y = h + line * (i + 1.8);
    drawPin(g, r * 1.6, y, i + 1, r * 0.75);
    g.fillStyle = '#213236';
    g.fillText(t, r * 3, y, w - r * 4);
  });
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Η κάτοψη με πινέζες δεν φτιάχτηκε.'))), 'image/jpeg', 0.88);
  });
}
