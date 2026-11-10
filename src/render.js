// Isometric (2:1, "45 degree") canvas renderer.
import { TILE_W as TW, TILE_H as TH, MAP_W, MAP_H, PLAYER, ENEMY, UNIT_TYPES, SEASONS } from './config.js';
import { tileAt } from './map.js';
import { canBuild } from './game.js';
import { Atmosphere } from './atmosphere.js';

const TAU = Math.PI * 2;

export function iso(x, y) {
  return { x: ((x - y) * TW) / 2, y: ((x + y) * TH) / 2 };
}
export function unIso(wx, wy) {
  const a = wx / (TW / 2), b = wy / (TH / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

const UNIFORM = ['#7f6c3d', '#5f6a6a'];
const UNIFORM_DARK = ['#5e4f2b', '#454e4f'];
const HELMET = ['#5a5531', '#3f4849'];
const SKIN = '#cf9f74';
const TEAM_COLOR = ['#d8c27a', '#a9b8c4'];
const PARAPET = ['#a08b5b', '#8a8a7e', '#917b5b'];

function hslRGB(h, sat, l) {
  sat /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = sat * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
const frac = (v) => v - Math.floor(v);
const hash = (x, y) => frac(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Cold, desaturated earth: black-brown mud and dead olive-grey grass.
function earthRGB(t, S) {
  let c;
  if (t.mud) c = hslRGB(22 + t.shade * 8, 9 + t.shade * 5, 12 + t.shade * 6);
  else c = hslRGB(48 + t.shade * 16 + (1 - S) * 8, 9 + t.shade * 7, 21 + t.shade * 7);
  if (t.crater) c = c.map((v) => v * 0.75);
  return c;
}
function snowRGB(t) {
  return [204 + t.shade * 16, 212 + t.shade * 14, 223 + t.shade * 12];
}
/** How much of a tile is under snow. Shellfire, mud and digging expose the earth. */
function snowCover(t, S) {
  if (S <= 0) return 0;
  const n = (Math.sin(t.x * 0.37 + 1.1) * Math.cos(t.y * 0.29 - 0.4) + Math.sin((t.x + t.y) * 0.17)) * 0.25 + (t.shade - 0.5) * 0.3;
  let c = S * 1.35 - 0.35 + n;
  if (t.mud) c -= 0.78 - 0.12 * S;
  c -= t.crater * 0.35;
  if (t.trench) c -= 0.5;
  return clamp01(c);
}
function mixHex(a, b, f) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * f)).join(',')})`;
}
/** Standing water reflecting a grey sky, or cracked ice in the cold. */
function drawPuddle(g, c, rx, ry, S, h) {
  const blobs = [[0, 0, 1, 1], [rx * 0.55, ry * 0.35, 0.6, 0.7], [-rx * 0.5, -ry * 0.25, 0.55, 0.65]];
  g.save();
  g.translate(c.x, c.y);
  g.fillStyle = 'rgba(14,10,8,0.6)';
  for (const [x, y, sx, sy] of blobs) { g.beginPath(); g.ellipse(x, y + 0.8, rx * sx + 1.8, ry * sy + 1.2, 0, 0, TAU); g.fill(); }
  const gr = g.createLinearGradient(0, -ry, 0, ry);
  if (S > 0.3) { gr.addColorStop(0, 'rgba(176,186,198,0.9)'); gr.addColorStop(1, 'rgba(96,108,122,0.9)'); }
  else { gr.addColorStop(0, 'rgba(138,150,166,0.85)'); gr.addColorStop(1, 'rgba(32,38,46,0.9)'); }
  g.fillStyle = gr;
  for (const [x, y, sx, sy] of blobs) { g.beginPath(); g.ellipse(x * (0.9 + h * 0.2), y, rx * sx, ry * sy, 0, 0, TAU); g.fill(); }
  g.strokeStyle = S > 0.3 ? 'rgba(235,240,245,0.45)' : 'rgba(220,228,238,0.45)'; g.lineWidth = 0.8;
  g.beginPath(); g.moveTo(-rx * 0.5, -ry * 0.3); g.lineTo(rx * 0.25, -ry * 0.45);
  if (S > 0.3) { g.moveTo(-rx * 0.1, 0); g.lineTo(rx * 0.2, ry * 0.4); }
  g.stroke();
  g.restore();
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.ground = document.createElement('canvas');
    this.OX = (MAP_H * TW) / 2;
    this.OY = TH * 2;
    this.ground.width = ((MAP_W + MAP_H) * TW) / 2;
    this.ground.height = ((MAP_W + MAP_H) * TH) / 2 + TH * 4;
    this.lastGround = -1e9;
    this.groundDrawn = false;
    this.atmo = new Atmosphere();
    this.resize();
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.vw = this.canvas.clientWidth || window.innerWidth;
    this.vh = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.vw * this.dpr);
    this.canvas.height = Math.round(this.vh * this.dpr);
  }

  worldToScreen(wx, wy) {
    return { x: (wx - this.cam.x) * this.cam.zoom + this.vw / 2, y: (wy - this.cam.y) * this.cam.zoom + this.vh / 2 };
  }
  screenToWorld(sx, sy) {
    return { x: (sx - this.vw / 2) / this.cam.zoom + this.cam.x, y: (sy - this.vh / 2) / this.cam.zoom + this.cam.y };
  }
  screenToMap(sx, sy) {
    const w = this.screenToWorld(sx, sy);
    return unIso(w.x, w.y);
  }
  mapToScreen(x, y, z = 0) {
    const p = iso(x, y);
    return this.worldToScreen(p.x, p.y - z);
  }
  centerOn(x, y) {
    const p = iso(x, y);
    this.cam.x = p.x; this.cam.y = p.y;
    this.clampCam();
  }
  clampCam() {
    const minX = -this.OX, maxX = this.ground.width - this.OX;
    const minY = 0, maxY = ((MAP_W + MAP_H) * TH) / 2;
    this.cam.x = Math.max(minX, Math.min(maxX, this.cam.x));
    this.cam.y = Math.max(minY, Math.min(maxY, this.cam.y));
    this.cam.zoom = Math.max(0.45, Math.min(2.2, this.cam.zoom));
  }

  // ------------------------------------------------------------ ground layer

  groundNoise() {
    if (this._gnoise) return this._gnoise;
    const n = document.createElement('canvas');
    n.width = n.height = 256;
    const c = n.getContext('2d');
    const img = c.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random();
      const light = v > 0.5;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = light ? 230 : 0;
      img.data[i + 3] = Math.abs(v - 0.5) * 70;
    }
    c.putImageData(img, 0, 0);
    // a few larger blotches for low-frequency variation
    for (let i = 0; i < 60; i++) {
      c.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,240,200,0.04)';
      c.beginPath(); c.ellipse(Math.random() * 256, Math.random() * 256, 6 + Math.random() * 18, 3 + Math.random() * 9, 0, 0, TAU); c.fill();
    }
    this._gnoise = n;
    return n;
  }

  drawGround(map, seasonKey = 'winter') {
    const season = SEASONS[seasonKey] || SEASONS.winter;
    const S = season.snow;
    this.S = S;
    const g = this.ground.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.ground.width, this.ground.height);

    const cover = new Float32Array(map.w * map.h);
    for (const t of map.tiles) cover[t.y * map.w + t.x] = snowCover(t, S);

    // 1. smooth colour field: one pixel per tile, bilinearly stretched into the isometric diamond
    const field = this.field || (this.field = document.createElement('canvas'));
    field.width = map.w; field.height = map.h;
    const fc = field.getContext('2d');
    const img = fc.createImageData(map.w, map.h);
    for (const t of map.tiles) {
      const cv = cover[t.y * map.w + t.x];
      const a = earthRGB(t, S), b = snowRGB(t);
      const i = (t.y * map.w + t.x) * 4;
      for (let k = 0; k < 3; k++) img.data[i + k] = a[k] + (b[k] - a[k]) * cv;
      img.data[i + 3] = 255;
    }
    fc.putImageData(img, 0, 0);
    g.save();
    g.setTransform(TW / 2, TH / 2, -TW / 2, TH / 2, this.OX, this.OY);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(field, 0, 0);
    g.restore();

    g.setTransform(1, 0, 0, 1, this.OX, this.OY);
    g.save();
    const c0 = iso(0, 0), c1 = iso(map.w, 0), c2 = iso(map.w, map.h), c3 = iso(0, map.h);
    g.beginPath(); g.moveTo(c0.x, c0.y); g.lineTo(c1.x, c1.y); g.lineTo(c2.x, c2.y); g.lineTo(c3.x, c3.y); g.closePath();
    g.clip();

    // 2. fine texture
    g.fillStyle = g.createPattern(this.groundNoise(), 'repeat');
    g.fillRect(-this.OX, -this.OY, this.ground.width, this.ground.height);

    // 3. per-tile detail
    for (const t of map.tiles) {
      if (t.trench) continue;
      const h = hash(t.x, t.y);
      const cv = cover[t.y * map.w + t.x];
      const P = (i, a, b) => iso(t.x + frac(h * (i + 1) * a), t.y + frac(h * (i + 1) * b));
      // broken snow: white patches over earth / earth showing through snow
      if (cv > 0.12 && cv < 0.9) {
        for (let i = 0; i < 2; i++) {
          const q = P(i, 4.3, 8.1);
          const w = 10 + frac(h * (i + 5) * 3.3) * 12;
          if (frac(h * i * 9.1) >= cv && cv > 0.6) continue;
          g.fillStyle = frac(h * i * 9.1) < cv ? `rgba(214,221,230,${0.2 + cv * 0.25})` : 'rgba(24,19,15,0.3)';
          g.beginPath(); g.ellipse(q.x, q.y, w, w * 0.32, frac(h * i) * 0.6 - 0.3, 0, TAU); g.fill();
        }
      }
      if (cv > 0.55) {
        // wind-drift shading on snow
        const q = P(0, 2.7, 5.3);
        g.fillStyle = 'rgba(110,126,152,0.08)';
        g.beginPath(); g.ellipse(q.x + 3, q.y + 2, 14, 4, -0.2, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.08)';
        g.beginPath(); g.ellipse(q.x - 2, q.y - 1, 11, 3, -0.2, 0, TAU); g.fill();
      }
      if (cv < 0.6 && !t.mud) {
        // dead, frost-tipped grass tufts
        g.lineWidth = 1;
        for (let i = 0; i < 5; i++) {
          const q = P(i, 7.1, 3.7);
          g.strokeStyle = `hsla(${42 + frac(h * i * 5.3) * 18},${10 + t.shade * 8}%,${24 + frac(h * (i + 2)) * 20}%,0.8)`;
          g.beginPath();
          g.moveTo(q.x - 2.5, q.y - 3.5); g.lineTo(q.x, q.y); g.lineTo(q.x + 2.5, q.y - 4);
          g.moveTo(q.x, q.y); g.lineTo(q.x + 0.5, q.y - 5.5);
          g.stroke();
          if (S > 0.2) { g.fillStyle = 'rgba(230,236,242,0.6)'; g.fillRect(q.x, q.y - 6, 1, 1); g.fillRect(q.x - 2.5, q.y - 4, 1, 1); }
        }
      }
      if (t.mud && cv < 0.7) {
        g.fillStyle = 'rgba(14,10,8,0.4)';
        for (let i = 0; i < 3; i++) {
          const q = P(i, 5.9, 9.3);
          g.beginPath(); g.ellipse(q.x, q.y, 2 + frac(h * i) * 2.5, 1.1, 0, 0, TAU); g.fill();
        }
        // wet sheen
        g.strokeStyle = `rgba(185,198,214,${0.12 + (1 - S) * 0.12})`; g.lineWidth = 0.9;
        const q = P(3, 3.1, 6.7);
        g.beginPath(); g.moveTo(q.x - 6, q.y); g.lineTo(q.x + 4, q.y - 1.5); g.stroke();
        // cart/limber ruts
        if (h > 0.9) {
          const a = iso(t.x, t.y + 0.2), b = iso(t.x + 1, t.y + 0.8);
          g.strokeStyle = 'rgba(12,9,7,0.22)'; g.lineWidth = 2.2;
          for (const o of [-2.5, 2.5]) { g.beginPath(); g.moveTo(a.x, a.y + o); g.quadraticCurveTo((a.x + b.x) / 2 + 6, (a.y + b.y) / 2 + o, b.x, b.y + o); g.stroke(); }
        }
      }
      if (t.mud && h > 0.965 && !t.crater) drawPuddle(g, iso(t.x + 0.5, t.y + 0.5), 9 + h * 5, 3.6, S, h);
    }

    // 4. shell craters: black earth blasted through the snow, spoil lip, ice or water
    for (const t of map.tiles) {
      if (!t.crater) continue;
      const h = hash(t.x * 3.1, t.y * 1.7);
      const c = iso(t.x + 0.25 + t.shade * 0.5, t.y + 0.25 + h * 0.5);
      const r = (5 + t.crater * 4) * (0.8 + h * 0.45);
      g.save();
      g.translate(c.x, c.y); g.scale(1, 0.5);
      let gr;
      g.fillStyle = 'rgba(20,15,11,0.55)';
      for (let i = 0; i < 9; i++) {
        const ang = frac(h * (i + 1) * 5.7) * TAU, dd = r * (0.9 + frac(h * (i + 2) * 3.1) * 0.9);
        g.beginPath(); g.arc(Math.cos(ang) * dd, Math.sin(ang) * dd, r * (0.12 + frac(h * i * 7.3) * 0.25), 0, TAU); g.fill();
      }
      const lumps = 7;
      for (let i = 0; i < lumps; i++) {
        const ang = (i / lumps) * TAU + h * 6;
        const lr = r * (0.95 + frac(h * (i + 3) * 7.7) * 0.25);
        const snowy = S > 0.7 && i % 3 === 0;
        g.fillStyle = snowy ? 'rgba(200,207,216,0.75)' : (i % 3 ? 'rgba(46,36,28,0.7)' : 'rgba(66,54,42,0.6)');
        g.beginPath(); g.arc(Math.cos(ang) * lr * 0.6, Math.sin(ang) * lr * 0.6, r * (0.45 + frac(h * i * 3.3) * 0.25), 0, TAU); g.fill();
      }
      gr = g.createRadialGradient(r * 0.1, r * 0.3, 0, 0, 0, r * 0.85);
      gr.addColorStop(0, '#120d09'); gr.addColorStop(0.7, '#1d1610'); gr.addColorStop(1, 'rgba(40,31,24,0.6)');
      g.fillStyle = gr;
      g.beginPath(); g.ellipse(0, 0, r * 0.85, r * (0.7 + h * 0.25), h * 2, 0, TAU); g.fill();
      g.restore();
      if ((t.crater >= 3 && h > 0.6) || (t.crater === 2 && h > 0.88)) drawPuddle(g, { x: c.x + r * 0.05, y: c.y + r * 0.1 }, r * 0.5, r * 0.2, S, h);
    }
    g.restore(); // clip

    // 5. trenches between spoil heaps: plank revetments, sandbags, duckboards
    const trenches = map.tiles.filter((t) => t.trench > 0);
    const T = (x, y) => (x >= 0 && y >= 0 && x < map.w && y < map.h ? map.tiles[y * map.w + x] : null);
    const strokeTrench = (t, width, style, ox = 0, oy = 0) => {
      const c = iso(t.x + 0.5, t.y + 0.5);
      c.x += ox; c.y += oy;
      g.strokeStyle = style; g.fillStyle = style; g.lineWidth = width;
      g.beginPath(); g.arc(c.x, c.y, width / 2, 0, TAU); g.fill();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = T(t.x + dx, t.y + dy);
        if (!n || !n.trench) continue;
        const m = iso(t.x + 0.5 + dx * 0.5, t.y + 0.5 + dy * 0.5);
        g.beginPath(); g.moveTo(c.x, c.y); g.lineTo(m.x + ox, m.y + oy); g.stroke();
      }
    };
    const berm = mixHex('#3a3028', '#c3cad3', S * 0.85);
    const bermTop = mixHex('#4d4136', '#e2e7ec', S * 0.9);
    g.lineCap = 'round';
    for (const t of trenches) strokeTrench(t, 46, 'rgba(0,0,0,0.25)', 4, 6);
    for (const t of trenches) strokeTrench(t, 36, berm, 0, -1);
    for (const t of trenches) {
      const c = iso(t.x + 0.5, t.y + 0.5);
      const h = hash(t.x * 4.7, t.y * 2.1);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + h * 3;
        const d = 15 + frac(h * (i + 1) * 3.9) * 6;
        const x = c.x + Math.cos(a) * d, y = c.y + Math.sin(a) * d * 0.5 - 2;
        const rr = 7 + frac(h * (i + 4) * 2.3) * 6;
        g.fillStyle = berm; g.beginPath(); g.ellipse(x, y, rr, rr * 0.55, 0, 0, TAU); g.fill();
        g.fillStyle = bermTop; g.beginPath(); g.ellipse(x - 1, y - rr * 0.2, rr * 0.7, rr * 0.33, 0, 0, TAU); g.fill();
        if (S > 0.3 && frac(h * i * 6.1) > 0.55) {
          g.fillStyle = 'rgba(34,27,21,0.75)';
          g.beginPath(); g.ellipse(x + 2, y + 1, rr * 0.4, rr * 0.18, 0, 0, TAU); g.fill();
        }
      }
    }
    for (const t of trenches) if (t.trench >= 2) strokeTrench(t, 23, t.trench >= 3 ? '#86857f' : (S > 0.3 ? '#a9a59b' : '#655d50'));
    for (const t of trenches) strokeTrench(t, 16, '#3c3024');
    g.setLineDash([1.8, 5.5]);
    for (const t of trenches) strokeTrench(t, 16, '#1a140f');
    g.setLineDash([]);
    for (const t of trenches) strokeTrench(t, 8.5, '#140f0b', 0, 2.2);
    g.setLineDash([5, 7]);
    for (const t of trenches) if (t.trench < 2) strokeTrench(t, 2, S > 0.3 ? 'rgba(190,205,220,0.55)' : 'rgba(140,156,176,0.5)', 0, 2.2);
    g.setLineDash([2.5, 2]);
    for (const t of trenches) if (t.trench >= 2) strokeTrench(t, 3, '#5a4630', 0, 2.2);
    g.setLineDash([]);
    // sandbags along both lips (more on reinforced works), snow-capped in winter
    for (const t of trenches) {
      const c = iso(t.x + 0.5, t.y + 0.5);
      const n = t.trench >= 2 ? 9 : 4;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + t.shade * 2;
        const bx = c.x + Math.cos(a) * 10.5, by = c.y + Math.sin(a) * 5.5;
        g.fillStyle = t.trench >= 3 ? '#8d8b84' : (i % 2 ? '#6b6455' : '#5d5649');
        g.beginPath(); g.ellipse(bx, by, 2.8, 1.6, 0, 0, TAU); g.fill();
        if (S > 0.2) { g.fillStyle = `rgba(228,233,238,${S * 0.9})`; g.beginPath(); g.ellipse(bx, by - 0.7, 2.2, 0.8, 0, 0, TAU); g.fill(); }
      }
      // ownership: a faint pennant-coloured stripe on the parapet
      if (t.owner >= 0) {
        g.fillStyle = t.owner === PLAYER ? 'rgba(216,190,110,0.75)' : 'rgba(150,175,200,0.75)';
        g.fillRect(c.x - 1, c.y - 9, 2, 2);
      }
    }

    // 6. barbed wire on knife-rest frames, rusty coils
    for (const t of map.tiles) {
      if (t.wire <= 0) continue;
      const a = iso(t.x + 0.5, t.y + 0.05), b = iso(t.x + 0.5, t.y + 0.95);
      const h = hash(t.x * 1.3, t.y * 2.9);
      const intact = t.wire > 50;
      const frames = intact ? [0.2, 0.8] : [0.35];
      const pts = frames.map((f) => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }));
      // shadow
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(pts[0].x + 4, pts[0].y + 2); g.lineTo(pts[pts.length - 1].x + 4, pts[pts.length - 1].y + 2); g.stroke();
      // X frames
      g.strokeStyle = '#2b2119'; g.lineWidth = 1.7; g.lineCap = 'round';
      for (const p of pts) {
        const tilt = intact ? 0 : (h - 0.5) * 6;
        g.beginPath();
        g.moveTo(p.x - 5, p.y + 1); g.lineTo(p.x + 3 + tilt, p.y - 11);
        g.moveTo(p.x + 5, p.y + 1); g.lineTo(p.x - 3 + tilt, p.y - 11);
        g.stroke();
      }
      if (intact) {
        g.beginPath(); g.moveTo(pts[0].x, pts[0].y - 6); g.lineTo(pts[1].x, pts[1].y - 6); g.stroke();
        if (S > 0.2) { g.strokeStyle = `rgba(230,235,240,${0.7 * S})`; g.lineWidth = 0.8; g.beginPath(); g.moveTo(pts[0].x, pts[0].y - 7); g.lineTo(pts[1].x, pts[1].y - 7); g.stroke(); }
      }
      // coils
      g.strokeStyle = intact ? 'rgba(112,74,50,0.9)' : 'rgba(100,70,50,0.6)';
      g.lineWidth = 0.8;
      const loops = intact ? 8 : 3;
      for (let i = 0; i < loops; i++) {
        const f = (i + 0.5) / loops;
        const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
        g.beginPath(); g.ellipse(x + (intact ? 0 : (h - 0.5) * 8), y - 5, 3.4, 4.6, 0.45, 0, TAU); g.stroke();
      }
    }
  }

  // ------------------------------------------------------------ frame

  update(dt, simDt, state) { this.atmo.update(dt, simDt, state, this); }
  onEvent(ev) { this.atmo.onEvent(ev, this); }

  draw(state, ui) {
    const ctx = this.ctx;
    const now = performance.now();
    if (!this.groundDrawn || (state.map.dirty && now - this.lastGround > 200)) {
      this.drawGround(state.map, state.season);
      state.map.dirty = false;
      this.groundDrawn = true;
      this.lastGround = now;
    }
    const z = this.cam.zoom, d = this.dpr;
    const sh = this.atmo.shake;
    const shx = (Math.random() - 0.5) * sh, shy = (Math.random() - 0.5) * sh;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.fillStyle = '#101215';
    ctx.fillRect(0, 0, this.vw, this.vh);
    ctx.setTransform(d * z, 0, 0, d * z, d * (this.vw / 2 - this.cam.x * z + shx), d * (this.vh / 2 - this.cam.y * z + shy));
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.ground, -this.OX, -this.OY);

    this.updateTracks(state);
    this.drawTracks(ctx, state);
    this.drawDecals(ctx, state);
    this.drawBuildSites(ctx, state);
    this.drawHover(ctx, state, ui);

    // depth-sorted objects
    const objs = [];
    for (const t of state.map.tiles) if (t.decor) objs.push({ k: t.x + t.y + 1, kind: 'decor', t });
    for (const team of [PLAYER, ENEMY]) {
      const q = state.map.hq[team];
      objs.push({ k: q.x + q.y + 1, kind: 'hq', q, team });
    }
    for (const u of state.units) if (u.visible) objs.push({ k: u.x + u.y, kind: 'unit', u });
    objs.sort((a, b) => a.k - b.k);
    for (const o of objs) {
      if (o.kind === 'decor') this.drawDecor(ctx, o.t);
      else if (o.kind === 'hq') this.drawHQ(ctx, state, o.q, o.team);
      else this.drawUnit(ctx, o.u, ui.selected.has(o.u.id), state.time);
    }

    this.drawBarrageMarkers(ctx, state);
    this.drawShells(ctx, state);
    this.drawEffects(ctx, state);
    this.atmo.drawWorld(ctx, state);

    // screen-space overlays
    ctx.setTransform(d, 0, 0, d, 0, 0);
    this.atmo.drawScreen(ctx, state, this);
    if (ui.dragBox) {
      const b = ui.dragBox;
      ctx.strokeStyle = 'rgba(220,230,150,0.9)'; ctx.fillStyle = 'rgba(220,230,150,0.12)'; ctx.lineWidth = 1;
      ctx.fillRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
      ctx.strokeRect(Math.min(b.x0, b.x1) + 0.5, Math.min(b.y0, b.y1) + 0.5, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
    }
    // vignette
    const grd = ctx.createRadialGradient(this.vw / 2, this.vh / 2, Math.min(this.vw, this.vh) * 0.35, this.vw / 2, this.vh / 2, Math.max(this.vw, this.vh) * 0.75);
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(10,8,4,0.5)');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, this.vw, this.vh);
  }

  drawDecals(ctx, state) {
    for (const b of state.decals) {
      const age = state.time - b.t;
      const a = age < 100 ? 1 : Math.max(0, 1 - (age - 100) / 40);
      if (a <= 0) continue;
      const p = iso(b.x, b.y);
      ctx.globalAlpha = a * 0.85;
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(b.rot);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(1, 1, 6, 2.4, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = UNIFORM_DARK[b.team];
      ctx.beginPath(); ctx.ellipse(0, 0, 5.5, 1.9, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = HELMET[b.team];
      ctx.beginPath(); ctx.arc(5.5, -0.5, 1.8, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  diamondPath(ctx, x, y, shrink = 0) {
    const p = iso(x, y);
    const hw = TW / 2 - shrink * 2, hh = TH / 2 - shrink;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y + shrink);
    ctx.lineTo(p.x + hw, p.y + TH / 2);
    ctx.lineTo(p.x, p.y + TH - shrink);
    ctx.lineTo(p.x - hw, p.y + TH / 2);
    ctx.closePath();
  }

  drawBuildSites(ctx, state) {
    for (const t of state.map.tiles) {
      if (!t.build) continue;
      if (t.build.team !== PLAYER && !isTileSeen(state, t)) continue;
      const f = Math.min(1, t.build.progress / t.build.work);
      const color = t.build.team === PLAYER ? '220,200,120' : '170,190,210';
      this.diamondPath(ctx, t.x, t.y, 2);
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = `rgba(${color},0.8)`; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.setLineDash([]);
      const c = iso(t.x + 0.5, t.y + 0.5);
      if (t.build.type === 'trench') {
        ctx.fillStyle = `rgba(46,33,20,${0.25 + f * 0.6})`;
        ctx.beginPath(); ctx.ellipse(c.x, c.y, 6 + f * 4, 3 + f * 2, 0, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(c.x - 12, c.y - 2, 24, 4);
      ctx.fillStyle = `rgb(${color})`; ctx.fillRect(c.x - 12, c.y - 2, 24 * f, 4);
    }
  }

  drawHover(ctx, state, ui) {
    if (!ui.hover) return;
    const { x, y } = ui.hover;
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return;
    if (ui.mode && ui.mode.startsWith('build:')) {
      const type = ui.mode.slice(6);
      const c = canBuild(state, PLAYER, type, x, y);
      this.diamondPath(ctx, Math.floor(x), Math.floor(y), 1);
      ctx.fillStyle = c.ok ? 'rgba(120,220,110,0.28)' : 'rgba(230,80,60,0.28)';
      ctx.fill();
      ctx.strokeStyle = c.ok ? 'rgba(150,240,130,0.9)' : 'rgba(240,100,80,0.9)';
      ctx.lineWidth = 1.5; ctx.stroke();
    } else if (ui.mode === 'bombard') {
      const p = iso(x, y);
      const inRange = ui.batteriesInRange(x, y) > 0;
      ctx.strokeStyle = inRange ? 'rgba(255,120,60,0.95)' : 'rgba(140,140,140,0.8)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 2.2 * TW / 2 * 1.41, 2.2 * TH / 2 * 1.41, 0, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(p.x - 10, p.y); ctx.lineTo(p.x + 10, p.y); ctx.moveTo(p.x, p.y - 5); ctx.lineTo(p.x, p.y + 5); ctx.stroke();
    } else if (ui.mode === 'charge') {
      const p = iso(x, y);
      ctx.strokeStyle = 'rgba(255,220,90,0.95)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(p.x - 8, p.y + 4); ctx.lineTo(p.x, p.y - 4); ctx.lineTo(p.x + 8, p.y + 4); ctx.stroke();
    } else {
      this.diamondPath(ctx, Math.floor(x), Math.floor(y), 1);
      ctx.strokeStyle = 'rgba(255,255,220,0.25)'; ctx.lineWidth = 1; ctx.stroke();
    }
  }

  drawDecor(ctx, t) {
    const S = this.S ?? 1;
    const h = hash(t.x * 2.3, t.y * 5.1);
    const c = iso(t.x + 0.3 + t.shade * 0.4, t.y + 0.3 + h * 0.4);
    if (t.decor === 'stump' || t.decor === 'tree') {
      const tall = t.decor === 'tree' ? 34 + h * 14 : 14 + t.shade * 26;
      const w = t.decor === 'tree' ? 3.4 : 3 + h * 1.5;
      // long shadow on the ground
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath(); ctx.moveTo(c.x - w, c.y); ctx.lineTo(c.x + w, c.y); ctx.lineTo(c.x + tall * 0.9 + 2, c.y + tall * 0.3); ctx.lineTo(c.x + tall * 0.9 - 2, c.y + tall * 0.3 + 1); ctx.closePath(); ctx.fill();
      // splintered trunk
      ctx.fillStyle = '#251e19';
      ctx.beginPath();
      ctx.moveTo(c.x - w, c.y + 1); ctx.lineTo(c.x + w, c.y + 1);
      ctx.lineTo(c.x + w * 0.7, c.y - tall);
      ctx.lineTo(c.x + w * 0.3, c.y - tall - 4 - h * 4);
      ctx.lineTo(c.x, c.y - tall + 1);
      ctx.lineTo(c.x - w * 0.4, c.y - tall - 6 - t.shade * 5);
      ctx.lineTo(c.x - w * 0.7, c.y - tall);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#41372e';
      ctx.fillRect(c.x + w * 0.15, c.y - tall + 1, w * 0.5, tall);
      // pale splintered wood at the break
      ctx.fillStyle = '#b39a74';
      ctx.beginPath(); ctx.moveTo(c.x - w * 0.4, c.y - tall - 6 - t.shade * 5); ctx.lineTo(c.x - w * 0.1, c.y - tall + 2); ctx.lineTo(c.x - w * 0.6, c.y - tall + 1); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(c.x + w * 0.3, c.y - tall - 4 - h * 4); ctx.lineTo(c.x + w * 0.6, c.y - tall + 1); ctx.lineTo(c.x + w * 0.1, c.y - tall + 1); ctx.closePath(); ctx.fill();
      if (t.decor === 'tree') {
        ctx.strokeStyle = '#2a221c'; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
        for (let i = 0; i < 4; i++) {
          const y0 = c.y - tall * (0.45 + i * 0.13), dir = i % 2 ? 1 : -1;
          const len = 8 + frac(h * (i + 2) * 3.7) * 8;
          ctx.beginPath(); ctx.moveTo(c.x, y0); ctx.quadraticCurveTo(c.x + dir * len * 0.6, y0 - 3, c.x + dir * len, y0 - 7 - i); ctx.stroke();
        }
      }
      if (S > 0.2) {
        ctx.fillStyle = `rgba(228,233,238,${0.85 * S})`;
        ctx.beginPath(); ctx.ellipse(c.x, c.y + 1, w + 3, 2, 0, 0, TAU); ctx.fill();
      }
    } else if (t.decor === 'log') {
      const ang = (h - 0.5) * 1.6 + (t.shade > 0.5 ? Math.PI : 0);
      const len = 24 + t.shade * 20;
      const ex = c.x + Math.cos(ang) * len, ey = c.y + Math.sin(ang) * len * 0.5;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(c.x + 2, c.y + 2); ctx.lineTo(ex + 2, ey + 2); ctx.stroke();
      ctx.strokeStyle = '#2a221c'; ctx.lineWidth = 4.5;
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.strokeStyle = S > 0.2 ? `rgba(226,231,236,${0.85 * S})` : '#4a3f35'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(c.x, c.y - 1.8); ctx.lineTo(ex, ey - 1.8); ctx.stroke();
      // splintered pale end and a stray branch
      ctx.fillStyle = '#b8a07a';
      ctx.beginPath(); ctx.moveTo(ex - 2, ey - 2.5); ctx.lineTo(ex + Math.cos(ang) * 6, ey + Math.sin(ang) * 3 - 1); ctx.lineTo(ex + 1, ey + 2.5); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#2a221c'; ctx.lineWidth = 1;
      const mx = (c.x + ex) / 2, my = (c.y + ey) / 2;
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx + 5, my - 8); ctx.lineTo(mx + 9, my - 10); ctx.stroke();
    } else if (t.decor === 'ruin') {
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(c.x - 8, c.y - 1, 22, 4);
      ctx.fillStyle = '#5d5a56';
      ctx.fillRect(c.x - 10, c.y - 13, 6, 13);
      ctx.fillRect(c.x - 4, c.y - 7, 10, 7);
      ctx.fillStyle = '#47443f';
      ctx.fillRect(c.x + 6, c.y - 4, 5, 4);
      ctx.fillStyle = S > 0.2 ? '#dde2e7' : '#6d6a64';
      ctx.fillRect(c.x - 10, c.y - 14, 6, 2); ctx.fillRect(c.x - 4, c.y - 8, 10, 1.5);
    }
  }

  drawHQ(ctx, state, q, team) {
    const S = this.S ?? 1;
    const c = iso(q.x + 0.5, q.y + 0.5);
    const owner = tileAt(state.map, q.x, q.y).owner;
    const f = team === PLAYER ? 1 : -1;
    // earth mound
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(c.x + 5, c.y + 6, 44, 19, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = mixHex('#3a3028', '#bfc6cf', S * 0.85);
    ctx.beginPath(); ctx.ellipse(c.x, c.y - 4, 40, 18, 0, 0, TAU); ctx.fill();
    // log walls (two visible faces)
    const L = { x: c.x - 24, y: c.y - 6 }, M = { x: c.x, y: c.y + 6 }, R = { x: c.x + 24, y: c.y - 6 };
    const H = 15;
    const face = (a, b, col) => {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(a.x, a.y - H); ctx.lineTo(b.x, b.y - H); ctx.lineTo(b.x, b.y); ctx.lineTo(a.x, a.y); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(15,10,6,0.55)'; ctx.lineWidth = 0.8;
      for (let i = 1; i < 5; i++) { const k = (i / 5) * H; ctx.beginPath(); ctx.moveTo(a.x, a.y - k); ctx.lineTo(b.x, b.y - k); ctx.stroke(); }
      ctx.fillStyle = '#1e1813';
      for (const p of [a, b]) ctx.fillRect(p.x - 1.2, p.y - H - 2, 2.4, H + 2);
    };
    face(L, M, '#3d3127');
    face(M, R, '#2f261f');
    // doorway with a canvas curtain
    ctx.fillStyle = '#0d0a08';
    ctx.beginPath(); ctx.moveTo(c.x - 16, c.y - 2); ctx.lineTo(c.x - 8, c.y + 2); ctx.lineTo(c.x - 8, c.y - 9); ctx.lineTo(c.x - 16, c.y - 13); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#4a4a36';
    ctx.beginPath(); ctx.moveTo(c.x - 16, c.y - 13); ctx.lineTo(c.x - 12, c.y - 11); ctx.lineTo(c.x - 13, c.y - 1); ctx.lineTo(c.x - 16, c.y - 2); ctx.closePath(); ctx.fill();
    // roof: camouflage net (snowed over in winter) and sandbag lip
    ctx.fillStyle = S > 0.3 ? '#c8ced6' : '#34342b';
    ctx.beginPath(); ctx.moveTo(L.x - 2, L.y - H); ctx.lineTo(c.x, c.y - H - 13); ctx.lineTo(R.x + 2, R.y - H); ctx.lineTo(M.x, M.y - H + 1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = S > 0.3 ? 'rgba(60,62,55,0.55)' : 'rgba(80,80,62,0.8)';
    for (let i = 0; i < 26; i++) {
      const u = frac(Math.sin(i * 12.9 + q.x) * 43758), v = frac(Math.sin(i * 78.2 + q.y) * 12345);
      const px = c.x + (u - v) * 22, py = c.y - H - 6 + (u + v - 1) * 6;
      ctx.fillRect(px, py, 2, 1.2);
    }
    ctx.fillStyle = S > 0.3 ? '#a8a49a' : '#5d5649';
    for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.ellipse(c.x + 4 + i * 2.6, c.y - H - 2 - i * 1.3, 2.4, 1.4, 0, 0, TAU); ctx.fill(); }
    // ammunition crates
    ctx.fillStyle = '#4b4d38'; ctx.fillRect(c.x + 8, c.y - H - 12, 7, 5); ctx.fillRect(c.x + 12, c.y - H - 16, 6, 4);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.6; ctx.strokeRect(c.x + 8, c.y - H - 12, 7, 5);
    // telegraph pole with sagging field-telephone wires
    const px = c.x - 3, py = c.y - H - 8, top = py - 52;
    ctx.strokeStyle = '#231b15'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, top); ctx.stroke();
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(px - 9, top + 5); ctx.lineTo(px + 9, top + 5); ctx.moveTo(px - 7, top + 11); ctx.lineTo(px + 7, top + 11); ctx.stroke();
    ctx.strokeStyle = 'rgba(25,22,20,0.7)'; ctx.lineWidth = 0.6;
    const ends = [[-70 * f, 40], [-40 * f, 55], [60, 30], [-110 * f, -10], [30, 45]];
    ends.forEach(([dx, dy], i) => {
      const sx = px + (i % 2 ? 7 : -9), sy = top + (i < 2 ? 5 : 11);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(px + dx * 0.5, sy + 25, px + dx, py + dy); ctx.stroke();
    });
    // pennant shows who holds the HQ
    ctx.fillStyle = owner < 0 ? '#999' : TEAM_COLOR[owner];
    const wave = Math.sin(state.time * 3 + team) * 2;
    ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px + 15, top + 3 + wave); ctx.lineTo(px, top + 7); ctx.closePath(); ctx.fill();
    ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillText('HQ', c.x + 12.5, c.y + 0.5);
    ctx.fillStyle = '#e8e8e0'; ctx.fillText('HQ', c.x + 12, c.y);
  }

  /** Footprints / ruts left by moving troops. */
  updateTracks(state) {
    const tr = this.tracks || (this.tracks = []);
    const last = this.trackLast || (this.trackLast = new Map());
    for (const u of state.units) {
      if (!u.visible || !u.moving) continue;
      const p = last.get(u.id);
      if (!p) { last.set(u.id, { x: u.x, y: u.y }); continue; }
      const d = Math.hypot(u.x - p.x, u.y - p.y);
      if (d < 0.45) continue;
      tr.push({ x: u.x, y: u.y, ang: Math.atan2(u.y - p.y, u.x - p.x), t: state.time, w: u.type === 'artillery' ? 2 : 1 });
      p.x = u.x; p.y = u.y;
    }
    if (tr.length > 1600) tr.splice(0, tr.length - 1600);
  }
  drawTracks(ctx, state) {
    if (!this.tracks) return;
    const snow = (this.S ?? 1) > 0.2;
    for (const k of this.tracks) {
      const age = state.time - k.t;
      if (age > 90 || age < 0) continue;
      const a = (1 - age / 90) * (snow ? 0.35 : 0.25);
      const p = iso(k.x, k.y);
      ctx.fillStyle = snow ? `rgba(70,78,92,${a})` : `rgba(8,6,4,${a})`;
      const ox = Math.sin(k.ang) * 4, oy = -Math.cos(k.ang) * 2;
      for (let i = -k.w; i <= k.w; i += 2) {
        ctx.beginPath(); ctx.ellipse(p.x + ox * i * 0.6, p.y + oy * i * 0.6, 4.5, 2.2, 0, 0, TAU); ctx.fill();
      }
    }
  }

  drawUnit(ctx, u, selected, time) {
    const t = UNIT_TYPES[u.type];
    const p = iso(u.x, u.y);
    if (selected) {
      ctx.strokeStyle = 'rgba(160,255,110,0.95)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 22, 11, 0, 0, TAU); ctx.stroke();
    }
    const dir = u.team === PLAYER ? 1 : -1;
    const charging = !!(u.order && u.order.kind === 'charge');
    const pose = u.inTrench ? 'trench' : u.pinned ? 'prone' : charging ? 'charge' : u.order ? 'walk' : 'stand';
    const men = [];
    const count = u.type === 'artillery' ? u.men : u.men;
    for (let i = 0; i < count; i++) {
      const col = i % 5, row = Math.floor(i / 5);
      const jx = Math.sin(u.seed * 100 + i * 7.3) * 0.06, jy = Math.cos(u.seed * 77 + i * 3.1) * 0.06;
      let ox, oy;
      if (u.type === 'artillery') { ox = -dir * (0.18 + (i % 3) * 0.12); oy = (Math.floor(i / 3) - 0.5) * 0.28 + ((i % 3) - 1) * 0.1; }
      else if (u.type === 'mg') { ox = -dir * (0.1 + (i % 2) * 0.12); oy = (Math.floor(i / 2) - 0.5) * 0.22 + 0.15; }
      else { ox = (row - 0.5) * 0.22 * -dir; oy = (col - 2) * 0.17; }
      const s = iso(u.x + ox + jx, u.y + oy + jy);
      men.push(s);
    }
    men.sort((a, b) => a.y - b.y);
    const phase = time * (charging ? 14 : 9) + u.seed * 10;
    if (u.type === 'artillery') this.drawGun(ctx, p, u, time);
    if (u.type === 'mg') this.drawMG(ctx, p, u, time);
    if (pose !== 'trench') {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      for (const s of men) { ctx.beginPath(); ctx.ellipse(s.x + 2, s.y, pose === 'prone' ? 6 : 3.5, 1.5, 0, 0, TAU); ctx.fill(); }
    }
    men.forEach((s, i) => drawMan(ctx, s.x, s.y, u.team, pose, u.facing, phase + i * 1.7, u.digging && i % 2 === 0));

    // small-arms muzzle flashes
    if (u.firing > 0 && u.type === 'rifle' && pose !== 'charge') {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < men.length; i += 2) {
        if (Math.sin(time * 40 + i) < 0.2) continue;
        const s = men[i];
        const fx = s.x + u.facing * 7.5, fy = s.y - (pose === 'trench' ? 7 : 11);
        const gr = ctx.createRadialGradient(fx, fy, 0, fx, fy, 5);
        gr.addColorStop(0, 'rgba(255,240,180,0.95)'); gr.addColorStop(1, 'rgba(255,150,50,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(fx, fy, 5, 0, TAU); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // status bars
    const maxHp = t.men * t.hpPerMan;
    const by = p.y - 30;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(p.x - 13, by, 26, 4);
    const f = u.hp / maxHp;
    ctx.fillStyle = u.team === PLAYER ? (f > 0.5 ? '#8fd16a' : f > 0.25 ? '#e0c050' : '#e06040') : '#c97a6a';
    ctx.fillRect(p.x - 12, by + 1, 24 * Math.max(0, f), 2);
    if (u.suppression > 5) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(p.x - 13, by + 4, 26, 3);
      ctx.fillStyle = u.suppression > 60 ? '#ff7a2a' : '#d9a441';
      ctx.fillRect(p.x - 12, by + 5, 24 * (u.suppression / 100), 1.5);
    }
    if (u.type === 'mg' && u.setup > 0 && !u.order) {
      ctx.fillStyle = '#ddd'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('setting up', p.x, by - 2);
    }
    if (u.type === 'artillery' && u.team === PLAYER && u.cooldown > 0) {
      ctx.fillStyle = '#ddd'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`reload ${Math.ceil(u.cooldown)}s`, p.x, by - 2);
    }
    if (u.pinned) {
      ctx.fillStyle = '#ffb060'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('PINNED', p.x, by - 2);
    }
  }

  drawGun(ctx, p, u, time) {
    const f = u.facing;
    const recoil = u.firing > 0 ? u.firing * 10 : 0;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(p.x, p.y + 1, 18, 7, 0, 0, TAU); ctx.fill();
    // trail
    ctx.strokeStyle = '#3b3a2c'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(p.x, p.y - 5); ctx.lineTo(p.x - f * 16, p.y + 2); ctx.stroke();
    // barrel
    ctx.strokeStyle = '#2d2f26'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(p.x - f * (2 + recoil), p.y - 8 + recoil * 0.3); ctx.lineTo(p.x + f * (16 - recoil), p.y - 15 + recoil * 0.3); ctx.stroke();
    // shield
    ctx.fillStyle = '#4d5040';
    ctx.beginPath(); ctx.moveTo(p.x + f * 3, p.y - 16); ctx.lineTo(p.x + f * 6, p.y - 16); ctx.lineTo(p.x + f * 6, p.y - 4); ctx.lineTo(p.x + f * 3, p.y - 3); ctx.closePath(); ctx.fill();
    // wheel
    ctx.strokeStyle = '#2a2219'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(p.x, p.y - 5, 4, 5.5, 0, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p.x, p.y - 10.5); ctx.lineTo(p.x, p.y + 0.5); ctx.moveTo(p.x - 4, p.y - 5); ctx.lineTo(p.x + 4, p.y - 5); ctx.stroke();
  }

  drawMG(ctx, p, u) {
    const f = u.facing;
    const gx = p.x + f * 6, gy = p.y - 2;
    ctx.strokeStyle = '#26261f'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(gx, gy - 4); ctx.lineTo(gx - 4, gy + 1);
    ctx.moveTo(gx, gy - 4); ctx.lineTo(gx + 3, gy + 1);
    ctx.moveTo(gx, gy - 4); ctx.lineTo(gx - f * 1, gy + 2);
    ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeStyle = '#2b2d28';
    ctx.beginPath(); ctx.moveTo(gx - f * 4, gy - 5); ctx.lineTo(gx + f * 9, gy - 6); ctx.stroke();
    if (u.firing > 0) {
      ctx.fillStyle = 'rgba(255,220,120,0.95)';
      ctx.beginPath(); ctx.arc(gx + f * 11, gy - 6, 2 + Math.random() * 2, 0, TAU); ctx.fill();
    }
  }

  drawBarrageMarkers(ctx, state) {
    for (const u of state.units) {
      if (u.team !== PLAYER || !u.barrage) continue;
      const p = iso(u.barrage.x, u.barrage.y);
      ctx.strokeStyle = 'rgba(255,110,60,0.6)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 70, 35, 0, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  drawShells(ctx, state) {
    for (const s of state.shells) {
      if (s.t > 0.45) continue;
      const p = iso(s.x, s.y);
      const h = (s.t / 0.45) * 260;
      const g = ctx.createLinearGradient(p.x, p.y - h - 40, p.x, p.y - h);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,240,200,0.8)');
      ctx.strokeStyle = g; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(p.x + 6, p.y - h - 40); ctx.lineTo(p.x, p.y - h); ctx.stroke();
    }
  }

  drawEffects(ctx, state) {
    const wind = this.atmo.wind;
    for (const e of state.effects) {
      const k = e.age / e.life;
      const seed = (e.x * 13.37 + e.y * 7.77) % 1;
      if (e.type === 'tracer') {
        const a = iso(e.x, e.y), b = iso(e.tx, e.ty);
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 3; i++) {
          const f0 = (k * 3 + i * 0.3) % 1, f1 = Math.min(1, f0 + 0.14);
          const jx = Math.sin(e.age * 50 + i) * 6, jy = Math.cos(e.age * 40 + i) * 3;
          const x0 = a.x + (b.x - a.x) * f0, y0 = a.y - 8 + (b.y - a.y) * f0;
          const x1 = a.x + (b.x - a.x) * f1 + jx, y1 = a.y - 8 + (b.y - a.y) * f1 + jy;
          ctx.strokeStyle = `rgba(255,170,70,${0.25 * (1 - k)})`; ctx.lineWidth = 3.5;
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
          ctx.strokeStyle = `rgba(255,235,170,${0.9 * (1 - k)})`; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
      } else if (e.type === 'volley') {
        if (k > 0.6) continue;
        const b = iso(e.tx, e.ty);
        ctx.fillStyle = `rgba(150,130,100,${0.5 * (1 - k / 0.6)})`;
        for (let i = 0; i < 4; i++) {
          ctx.beginPath(); ctx.arc(b.x + Math.sin(i * 9 + e.x) * 11, b.y - 2 - k * 6 + Math.cos(i * 5 + e.y) * 4, 1.5 + k * 4, 0, TAU); ctx.fill();
        }
      } else if (e.type === 'boom') {
        const p = iso(e.x, e.y);
        // shockwave ring along the ground
        if (k < 0.45) {
          const kk = k / 0.45, rr = 10 + kk * 75;
          ctx.strokeStyle = `rgba(255,235,200,${0.55 * (1 - kk)})`; ctx.lineWidth = 2.5 * (1 - kk) + 0.5;
          ctx.beginPath(); ctx.ellipse(p.x, p.y, rr, rr * 0.5, 0, 0, TAU); ctx.stroke();
        }
        // fountain of earth thrown skyward
        if (k < 0.9) {
          const rise = Math.min(1, k * 4);
          for (let i = 0; i < 7; i++) {
            const h = (i / 6) * 70 * rise;
            const rad = (10 - i) * (0.9 + k * 0.8);
            const sway = Math.sin(i * 1.7 + seed * 9) * 5 * rise + wind.x * k * i * 3;
            ctx.fillStyle = `rgba(${48 + i * 4},${36 + i * 3},${24 + i * 2},${0.85 * (1 - k)})`;
            ctx.beginPath(); ctx.arc(p.x + sway, p.y - h, rad, 0, TAU); ctx.fill();
          }
        }
        // fireball
        if (k < 0.4) {
          const kk = k / 0.4, r = 8 + kk * 24;
          ctx.globalCompositeOperation = 'lighter';
          const gr = ctx.createRadialGradient(p.x, p.y - 8 - kk * 8, 0, p.x, p.y - 8 - kk * 8, r);
          gr.addColorStop(0, `rgba(255,250,225,${1 - kk})`);
          gr.addColorStop(0.4, `rgba(255,160,50,${0.85 * (1 - kk)})`);
          gr.addColorStop(1, 'rgba(180,40,0,0)');
          ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(p.x, p.y - 8 - kk * 8, r, 0, TAU); ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
        }
      } else if (e.type === 'smoke') {
        const p = iso(e.x, e.y);
        for (let i = 0; i < 4; i++) {
          const t = e.age + i * 0.4;
          const dx = wind.x * t * 16 + Math.sin(seed * 20 + i * 2) * 8;
          const dy = -t * 14 - i * 6 + wind.y * t * 6;
          const r = 9 + k * 34 + i * 4;
          const shade = i % 2 ? '95,90,82' : '62,58,52';
          ctx.fillStyle = `rgba(${shade},${0.32 * (1 - k) * (1 - i * 0.15)})`;
          ctx.beginPath(); ctx.arc(p.x + dx, p.y - 10 + dy, r, 0, TAU); ctx.fill();
        }
      } else if (e.type === 'dirt') {
        const p = iso(e.x, e.y);
        const tt = e.age;
        for (let i = 0; i < e.parts.length; i++) {
          const q = e.parts[i];
          const zz = q.vz * tt - 160 * tt * tt;
          if (zz < 0) continue;
          const gx = p.x + q.vx * tt, gy = p.y + q.vy * tt;
          ctx.fillStyle = `rgba(0,0,0,${0.2 * (1 - k)})`;
          ctx.fillRect(gx, gy, 2.5, 1.2);
          ctx.fillStyle = i % 3 ? `rgba(58,42,26,${1 - k})` : `rgba(95,80,60,${1 - k})`;
          const sz = 2 + (i % 3);
          ctx.fillRect(gx - sz / 2, gy - zz - sz / 2, sz, sz);
        }
      } else if (e.type === 'gunflash') {
        const p = iso(e.x, e.y);
        const f = e.facing || 1;
        ctx.fillStyle = `rgba(200,200,190,${0.45 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(p.x + f * (22 + k * 14) + wind.x * k * 10, p.y - 18 - k * 14, 6 + k * 16, 0, TAU); ctx.fill();
        if (k < 0.5) {
          const kk = k / 0.5;
          ctx.globalCompositeOperation = 'lighter';
          const gr = ctx.createRadialGradient(p.x + f * 20, p.y - 16, 0, p.x + f * 20, p.y - 16, 16);
          gr.addColorStop(0, `rgba(255,245,200,${1 - kk})`); gr.addColorStop(1, 'rgba(255,140,40,0)');
          ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(p.x + f * 20, p.y - 16, 16, 0, TAU); ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
        }
      }
    }
  }

  // ------------------------------------------------------------ minimap

  drawMinimap(mctx, state, w, h) {
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.fillStyle = '#121309'; mctx.fillRect(0, 0, w, h);
    const s = Math.min(w / this.ground.width, h / this.ground.height);
    const ox = (w - this.ground.width * s) / 2, oy = (h - this.ground.height * s) / 2;
    mctx.drawImage(this.ground, ox, oy, this.ground.width * s, this.ground.height * s);
    this.mini = { s, ox, oy };
    for (const u of state.units) {
      if (!u.visible) continue;
      const p = iso(u.x, u.y);
      mctx.fillStyle = u.team === PLAYER ? '#e8d27a' : '#ff6a5a';
      mctx.fillRect(ox + (p.x + this.OX) * s - 1.5, oy + (p.y + this.OY) * s - 1.5, 3, 3);
    }
    // viewport
    const tl = this.screenToWorld(0, 0), br = this.screenToWorld(this.vw, this.vh);
    mctx.strokeStyle = 'rgba(255,255,255,0.8)'; mctx.lineWidth = 1;
    mctx.strokeRect(ox + (tl.x + this.OX) * s, oy + (tl.y + this.OY) * s, (br.x - tl.x) * s, (br.y - tl.y) * s);
  }
  minimapToWorld(mx, my) {
    const m = this.mini;
    if (!m) return null;
    return { x: (mx - m.ox) / m.s - this.OX, y: (my - m.oy) / m.s - this.OY };
  }
}

function isTileSeen(state, t) {
  return state.units.some((u) => u.team === PLAYER && Math.hypot(u.x - t.x, u.y - t.y) < UNIT_TYPES[u.type].sight);
}

function drawMan(ctx, x, y, team, pose, facing, phase, digging) {
  const uni = UNIFORM[team], dark = UNIFORM_DARK[team], hel = HELMET[team];
  ctx.lineCap = 'round';
  if (pose === 'prone') {
    ctx.fillStyle = uni;
    ctx.beginPath(); ctx.ellipse(x, y - 1.5, 5.5, 1.8, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = hel;
    ctx.beginPath(); ctx.arc(x + facing * 5.5, y - 2.5, 1.9, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(x + facing * 4, y - 2); ctx.lineTo(x + facing * 10, y - 2.5); ctx.stroke();
    return;
  }
  if (pose === 'trench') {
    ctx.fillStyle = uni;
    ctx.fillRect(x - 2, y - 6, 4, 4);
    ctx.fillStyle = SKIN;
    ctx.beginPath(); ctx.arc(x, y - 7.5, 1.7, 0, TAU); ctx.fill();
    drawHelmet(ctx, x, y - 8.3, team, hel);
    ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 0.9;
    if (digging) {
      const s = Math.sin(phase) * 3;
      ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + facing * 4, y - 9 + s); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + facing * 7, y - 6.5); ctx.stroke();
    }
    return;
  }
  const walking = pose === 'walk' || pose === 'charge';
  const lean = pose === 'charge' ? facing * 2.5 : walking ? facing * 1 : 0;
  const swing = walking ? Math.sin(phase) * 2.2 : 0;
  // legs
  ctx.strokeStyle = dark; ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(x + lean * 0.3, y - 5); ctx.lineTo(x - 1 + swing, y);
  ctx.moveTo(x + lean * 0.3, y - 5); ctx.lineTo(x + 1 - swing, y);
  ctx.stroke();
  // body
  ctx.strokeStyle = uni; ctx.lineWidth = 3.4;
  ctx.beginPath(); ctx.moveTo(x + lean * 0.3, y - 5); ctx.lineTo(x + lean, y - 10); ctx.stroke();
  // head + helmet
  ctx.fillStyle = SKIN;
  ctx.beginPath(); ctx.arc(x + lean, y - 12, 1.8, 0, TAU); ctx.fill();
  drawHelmet(ctx, x + lean, y - 12.8, team, hel);
  // rifle
  ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 0.9;
  ctx.beginPath();
  if (pose === 'charge') { ctx.moveTo(x + lean - facing * 2, y - 8); ctx.lineTo(x + lean + facing * 9, y - 9.5); }
  else if (digging) { const s = Math.sin(phase) * 3; ctx.moveTo(x + lean, y - 9); ctx.lineTo(x + facing * 5, y - 2 + s); }
  else { ctx.moveTo(x + lean + facing * 1, y - 6); ctx.lineTo(x + lean + facing * 3, y - 16); }
  ctx.stroke();
  if (pose === 'charge') {
    ctx.strokeStyle = '#d8d8d0'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(x + lean + facing * 9, y - 9.5); ctx.lineTo(x + lean + facing * 12, y - 10); ctx.stroke();
  }
}

function drawHelmet(ctx, x, y, team, color) {
  ctx.fillStyle = color;
  if (team === PLAYER) {
    // wide-brimmed steel helmet
    ctx.beginPath(); ctx.ellipse(x, y + 0.3, 3.2, 1, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y + 0.2, 1.8, Math.PI, 0); ctx.fill();
  } else {
    // coal-scuttle helmet
    ctx.beginPath(); ctx.arc(x, y + 0.6, 2.3, Math.PI, 0); ctx.fill();
    ctx.fillRect(x - 2.6, y + 0.4, 5.2, 1.3);
  }
}
