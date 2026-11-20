// Procedural SYNTHETIC cheek close-ups. No real patient imagery anywhere in this prototype.
// Same subject => same lesion map; later visits keep a subset (lesions resolve, they don't move).

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

const cache = new Map();

// opts: { subject, base (lesion count), remain (fraction), visitIdx, lighting, view, align, w, h }
export function renderTile(opts) {
  const key = JSON.stringify(opts);
  if (cache.has(key)) return cache.get(key);
  const { subject, base, remain, visitIdx, lighting, view, align, w, h } = opts;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const R = rng(hash(subject));
  const sk = [214 + R() * 22, 162 + R() * 22, 132 + R() * 20]; // subject skin tone

  // pose jitter per visit (what registration removes)
  const J = rng(hash(subject + visitIdx));
  const jx = align ? 0 : (J() - 0.5) * 0.12 * w;
  const jy = align ? 0 : (J() - 0.5) * 0.1 * h;
  const rot = align ? 0 : (J() - 0.5) * 0.12;
  const sc = align ? 1 : 0.94 + J() * 0.12;

  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.save();
  g.translate(w / 2 + jx, h / 2 + jy);
  g.rotate(rot);
  g.scale(sc, sc);
  g.translate(-w / 2, -h / 2);

  const vx = view === 'L45' ? 0.38 : view === 'R45' ? 0.62 : 0.5;
  const lx = view === 'L45' ? 0.25 : view === 'R45' ? 0.75 : 0.5;

  // face/cheek mass
  const uv = lighting === 'UV';
  const tint = lighting === 'XPOL' ? [1.0, 0.93, 0.92] : lighting === 'PPOL' ? [1.02, 1.0, 0.99] : [1, 1, 1];
  const col = uv ? [58, 44, 96] : sk.map((v, i) => Math.min(255, v * tint[i]));
  const grad = g.createRadialGradient(w * lx, h * 0.35, w * 0.05, w * vx, h * 0.55, w * 0.62);
  grad.addColorStop(0, `rgb(${col.map((v) => Math.min(255, v + 18)).join(',')})`);
  grad.addColorStop(0.6, `rgb(${col.join(',')})`);
  grad.addColorStop(1, `rgb(${col.map((v) => v * 0.45).join(',')})`);
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(w * vx, h * 0.56, w * 0.5, h * 0.62, 0, 0, Math.PI * 2);
  g.fill();

  // pores / texture
  const P = rng(hash(subject + 'pores'));
  const nP = Math.round((w * h) / 90);
  for (let i = 0; i < nP; i++) {
    const x = P() * w, y = P() * h;
    g.fillStyle = uv ? `rgba(20,10,40,${0.15 + P() * 0.2})` : `rgba(110,60,45,${0.05 + P() * (lighting === 'PPOL' ? 0.16 : 0.08)})`;
    g.fillRect(x, y, 1, 1);
  }

  // diffuse erythema (more visible cross-polarized), fading with response
  if (!uv) {
    const E = rng(hash(subject + 'ery'));
    for (let i = 0; i < 5; i++) {
      const ex = w * (vx - 0.25 + E() * 0.5), ey = h * (0.4 + E() * 0.35), er = w * (0.08 + E() * 0.1);
      const a = (lighting === 'XPOL' ? 0.22 : 0.1) * (0.35 + 0.65 * remain);
      const eg = g.createRadialGradient(ex, ey, 0, ex, ey, er);
      eg.addColorStop(0, `rgba(200,70,70,${a})`);
      eg.addColorStop(1, 'rgba(200,70,70,0)');
      g.fillStyle = eg;
      g.beginPath(); g.arc(ex, ey, er, 0, Math.PI * 2); g.fill();
    }
  }

  // lesions: fixed map, first N survive
  const L = rng(hash(subject + 'lesions'));
  const all = [];
  for (let i = 0; i < base; i++) {
    all.push({ x: w * (vx - 0.33 + L() * 0.66), y: h * (0.28 + L() * 0.6), r: (2.2 + L() * 3.6) * (w / 320), pus: L() < 0.25, k: L() });
  }
  all.sort((a, b) => a.k - b.k);
  const n = Math.round(base * remain);
  const shown = all.slice(0, n);
  for (const l of shown) {
    if (uv) {
      // porphyrin fluorescence (orange-red dots)
      g.fillStyle = 'rgba(255,120,60,0.85)';
      g.beginPath(); g.arc(l.x, l.y, Math.max(1, l.r * 0.35), 0, Math.PI * 2); g.fill();
      continue;
    }
    const strength = lighting === 'XPOL' ? 1 : lighting === 'PPOL' ? 0.6 : 0.8;
    const halo = g.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r * 2.4);
    halo.addColorStop(0, `rgba(185,50,55,${0.55 * strength})`);
    halo.addColorStop(1, 'rgba(185,50,55,0)');
    g.fillStyle = halo;
    g.beginPath(); g.arc(l.x, l.y, l.r * 2.4, 0, Math.PI * 2); g.fill();
    g.fillStyle = `rgba(165,40,45,${0.8 * strength})`;
    g.beginPath(); g.arc(l.x, l.y, l.r, 0, Math.PI * 2); g.fill();
    if (l.pus) {
      g.fillStyle = 'rgba(245,225,170,0.9)';
      g.beginPath(); g.arc(l.x, l.y, l.r * 0.42, 0, Math.PI * 2); g.fill();
    }
    if (lighting === 'PPOL') {
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.beginPath(); g.arc(l.x - l.r * 0.3, l.y - l.r * 0.3, l.r * 0.25, 0, Math.PI * 2); g.fill();
    }
  }
  // extra UV porphyrin background speckle
  if (uv) {
    const U = rng(hash(subject + 'uv' + visitIdx));
    for (let i = 0; i < base * 1.5 * remain; i++) {
      g.fillStyle = 'rgba(255,140,70,0.6)';
      g.fillRect(w * (vx - 0.35 + U() * 0.7), h * (0.25 + U() * 0.62), 1.4, 1.4);
    }
  }
  // specular sheen for parallel-polarized
  if (lighting === 'PPOL') {
    const sh = g.createLinearGradient(w * lx - w * 0.2, 0, w * lx + w * 0.2, h);
    sh.addColorStop(0, 'rgba(255,255,255,0)');
    sh.addColorStop(0.5, 'rgba(255,255,255,0.14)');
    sh.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sh;
    g.fillRect(0, 0, w, h);
  }
  g.restore();

  // colour-checker strip (standardisation target) bottom-left
  const sw = Math.max(4, Math.round(w / 40));
  ['#735244', '#c29682', '#627a9d', '#576c43', '#8580b1', '#67bdaa'].forEach((cc, i) => {
    g.fillStyle = uv ? '#222' : cc;
    g.fillRect(6 + i * (sw + 1), h - sw - 6, sw, sw);
  });

  const url = c.toDataURL('image/jpeg', 0.86);
  cache.set(key, url);
  return url;
}
