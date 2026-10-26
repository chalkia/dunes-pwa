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

// ---- Πλέγμα 10×10 πάνω στο πλαίσιο 1×1 μ. (lite) ----
// quad: 4 γωνίες [x, y] από 0 έως 1, με σειρά πάνω-αριστερά, πάνω-δεξιά, κάτω-δεξιά, κάτω-αριστερά.
// Η φωτογραφία σπάνια είναι τέλεια από πάνω: χρησιμοποιούμε προβολικό μετασχηματισμό (ομογραφία)
// από το τετράγωνο [0,1]×[0,1] στις 4 γωνίες, ώστε οι γραμμές να «κάθονται» πάνω στο πλαίσιο.
export function homography(quad) {
  const src = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i += 1) {
    const [x, y] = src[i];
    const [u, v] = quad[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  // Gauss με μερική οδήγηση.
  const n = 8;
  for (let c = 0; c < n; c += 1) {
    let piv = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-12) throw new Error('Οι 4 γωνίες δεν σχηματίζουν τετράπλευρο.');
    [A[c], A[piv]] = [A[piv], A[c]];
    [b[c], b[piv]] = [b[piv], b[c]];
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k += 1) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const h = b.map((v, i) => v / A[i][i]);
  return (x, y) => {
    const w = h[6] * x + h[7] * y + 1;
    return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
  };
}

// Σχεδιάζει το πλέγμα στο ctx. w, h: μέγεθος εικόνας σε pixel. dark: σκούρες γραμμές (για ανοιχτή άμμο).
export function drawGrid(ctx, quad, w, h, dark = false) {
  const H = homography(quad);
  const P = (x, y) => { const [u, v] = H(x, y); return [u * w, v * h]; };
  const line = (x0, y0, x1, y1, thick) => {
    ctx.beginPath();
    const steps = 20;
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const [px, py] = P(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.lineWidth = thick;
    ctx.stroke();
  };
  const base = Math.max(1, Math.min(w, h) / 500);
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i <= 10; i += 1) {
    const major = i % 5 === 0;
    ctx.strokeStyle = dark ? (major ? 'rgba(20,20,20,0.95)' : 'rgba(20,20,20,0.6)') : (major ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.65)');
    const t = major ? base * 3 : base * 1.3;
    line(i / 10, 0, i / 10, 1, t);
    line(0, i / 10, 1, i / 10, t);
  }
  ctx.restore();
}

// Κάτοψη + πλέγμα + τίτλος (για την εξαγωγή «…_πλέγμα.jpg»).
export async function gridImage(blob, quad, title, dark = false) {
  const src = await createImageBitmap(blob);
  const w = src.width;
  const h = src.height;
  const band = Math.max(40, Math.round(h * 0.06));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h + band;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, 0, 0);
  if (typeof src.close === 'function') src.close();
  drawGrid(g, quad, w, h, dark);
  g.fillStyle = '#213236';
  g.font = `bold ${Math.round(band * 0.45)}px sans-serif`;
  g.textBaseline = 'middle';
  g.fillText(`${title} · πλέγμα 10×10: κάθε κελί = 1%`, band * 0.4, h + band / 2, w - band);
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Η κάτοψη με πλέγμα δεν φτιάχτηκε.'))), 'image/jpeg', 0.88);
  });
}
