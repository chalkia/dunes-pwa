// Κάτοψη quadrat: γωνίες του πλαισίου και πλέγμα 10×10 πάνω στη φωτογραφία.
// Η φωτογραφία ΔΕΝ αλλάζει. Αποθηκεύονται μόνο οι 4 γωνίες (0–1) στο σημείο (p.quad).
import { drawGrid } from '../../js/photos.js';

// Βάζει 4 σημεία στη σειρά: πάνω-αριστερά, πάνω-δεξιά, κάτω-δεξιά, κάτω-αριστερά.
// Ο μαθητής μπορεί να τα πατήσει με όποια σειρά θέλει.
export function orderCorners(pts) {
  if (pts.length !== 4) throw new Error('Χρειάζονται 4 γωνίες.');
  const cx = pts.reduce((a, p) => a + p[0], 0) / 4;
  const cy = pts.reduce((a, p) => a + p[1], 0) / 4;
  const byAngle = [...pts].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  // Ξεκινάμε από το σημείο με το μικρότερο x + y (πάνω-αριστερά).
  let start = 0;
  byAngle.forEach((p, i) => { if (p[0] + p[1] < byAngle[start][0] + byAngle[start][1]) start = i; });
  return [0, 1, 2, 3].map((k) => byAngle[(start + k) % 4]);
}

// Εμβαδόν (για να καταλάβουμε αν οι γωνίες είναι πολύ κοντά μεταξύ τους).
export function quadArea(q) {
  let s = 0;
  for (let i = 0; i < 4; i += 1) {
    const [x1, y1] = q[i];
    const [x2, y2] = q[(i + 1) % 4];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s / 2);
}

// Σχεδιάζει πάνω στο canvas (ίδιο μέγεθος με την εικόνα στην οθόνη):
// τις γωνίες που έχουν πατηθεί και, αν υπάρχουν και οι 4 και showGrid, το πλέγμα.
export function drawOverlay(canvas, img, { quad, corners, showGrid, dark }) {
  const dpr = window.devicePixelRatio || 1;
  const w = img.clientWidth;
  const h = img.clientHeight;
  if (!w || !h) return;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  const W = canvas.width;
  const H = canvas.height;
  if (quad && showGrid) drawGrid(g, quad, W, H, dark);
  if (quad && !showGrid) {
    g.save();
    g.strokeStyle = dark ? '#222' : '#fff';
    g.lineWidth = 3 * dpr;
    g.beginPath();
    quad.forEach(([x, y], i) => { if (i === 0) g.moveTo(x * W, y * H); else g.lineTo(x * W, y * H); });
    g.closePath();
    g.stroke();
    g.restore();
  }
  const dots = quad || corners || [];
  dots.forEach(([x, y], i) => {
    g.save();
    g.beginPath();
    g.arc(x * W, y * H, 11 * dpr, 0, Math.PI * 2);
    g.fillStyle = '#E8684A';
    g.fill();
    g.lineWidth = 3 * dpr;
    g.strokeStyle = '#fff';
    g.stroke();
    g.fillStyle = '#fff';
    g.font = `bold ${12 * dpr}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(i + 1), x * W, y * H + dpr);
    g.restore();
  });
}
