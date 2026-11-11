// Isometric (2:1, "45 degree") canvas renderer.
import { TILE_W as TW, TILE_H as TH, MAP_W, MAP_H, PLAYER, ENEMY, UNIT_TYPES, SEASONS } from './config.js';
import { tileAt } from './map.js';
import { canBuild } from './game.js';
import { Atmosphere } from './atmosphere.js';
import { Relief } from './relief.js';

// Ground is rendered supersampled for sharpness when zoomed in (lighter on low-memory devices).
const GS = typeof navigator !== 'undefined' && navigator.deviceMemory && navigator.deviceMemory < 4 ? 1 : 1.5;
function supersample(ctx) {
  if (ctx.__gs) return ctx;
  const st = ctx.setTransform.bind(ctx);
  ctx.setTransform = (a, b, c, d, e, f) => st(a * GS, b * GS, c * GS, d * GS, e * GS, f * GS);
  ctx.__gs = true;
  return ctx;
}

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
/** Load an image; rejects on error or after a timeout. */
function loadImage(src, timeout = 30000) {
  return new Promise((res, rej) => {
    const img = new Image();
    const t = setTimeout(() => { img.src = ''; rej(new Error('timeout ' + src)); }, timeout);
    img.onload = () => { clearTimeout(t); res(img); };
    img.onerror = () => { clearTimeout(t); rej(new Error(src)); };
    img.src = src;
  });
}
/** Retry an async step with back-off (fn receives the attempt number). */
function retry(fn, tries = 4) {
  return fn(0).catch((e) => (tries > 1 ? new Promise((r) => setTimeout(r, 800 * (5 - tries))).then(() => retry((n) => fn(n + 1), tries - 1)) : Promise.reject(e)));
}

let PAT = null; // texture pattern lookup for the context currently being drawn, or null for vector fallback
function drawPuddle(g, c, rx, ry, S, h) {
  const blobs = [[0, 0, 1, 1], [rx * 0.55, ry * 0.35, 0.6, 0.7], [-rx * 0.5, -ry * 0.25, 0.55, 0.65]];
  g.save();
  g.translate(c.x, c.y);
  g.fillStyle = 'rgba(14,10,8,0.6)';
  for (const [x, y, sx, sy] of blobs) { g.beginPath(); g.ellipse(x, y + 0.8, rx * sx + 1.8, ry * sy + 1.2, 0, 0, TAU); g.fill(); }
  const gr = g.createLinearGradient(0, -ry, 0, ry);
  if (S > 0.3) { gr.addColorStop(0, 'rgba(176,186,198,0.9)'); gr.addColorStop(1, 'rgba(96,108,122,0.9)'); }
  else { gr.addColorStop(0, 'rgba(138,150,166,0.85)'); gr.addColorStop(1, 'rgba(32,38,46,0.9)'); }
  if (PAT) {
    g.fillStyle = PAT(S > 0.3 ? 'ice' : 'water');
    for (const [x, y, sx, sy] of blobs) { g.beginPath(); g.ellipse(x * (0.9 + h * 0.2), y, rx * sx, ry * sy, 0, 0, TAU); g.fill(); }
    g.globalAlpha = 0.45;
  }
  g.fillStyle = gr;
  for (const [x, y, sx, sy] of blobs) { g.beginPath(); g.ellipse(x * (0.9 + h * 0.2), y, rx * sx, ry * sy, 0, 0, TAU); g.fill(); }
  g.globalAlpha = 1;
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
    this.gw = ((MAP_W + MAP_H) * TW) / 2;
    this.gh = ((MAP_W + MAP_H) * TH) / 2 + TH * 4;
    this.ground.width = Math.round(this.gw * GS);
    this.ground.height = Math.round(this.gh * GS);
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
    const minX = -this.OX, maxX = this.gw - this.OX;
    const minY = 0, maxY = ((MAP_W + MAP_H) * TH) / 2;
    this.cam.x = Math.max(minX, Math.min(maxX, this.cam.x));
    this.cam.y = Math.max(minY, Math.min(maxY, this.cam.y));
    this.cam.zoom = Math.max(0.45, Math.min(2.2, this.cam.zoom));
  }

  // ------------------------------------------------------------ ground layer

  /**
   * Load one sprite-sheet group (assets/atlas/<group>.json + sheets). Each group loads independently,
   * with retries, so one slow or failed download never blocks the others.
   */
  loadAtlas(group) {
    this.atlas = this.atlas || {};
    this.atlasLoading = this.atlasLoading || {};
    if (this.atlas[group] || this.atlasLoading[group]) return this.atlasLoading[group];
    const base = 'assets/atlas/';
    const p = retry(() => fetch(base + group + '.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }))
      .then((meta) => Promise.all(Array.from({ length: meta.sheets }, (_, i) => retry((n) => loadImage(`${base}${group}-${i}.webp${n ? '?r=' + n : ''}`))))
        .then((sheets) => {
          this.atlas[group] = { frames: meta.frames, sheets };
          if (group.startsWith('props')) this.groundDrawn = false; // redraw the ground with the real props
        }))
      .catch((e) => { console.warn('Sprite sheet unavailable:', group, e.message); delete this.atlasLoading[group]; });
    this.atlasLoading[group] = p;
    return p;
  }

  /** Props for the given snow amount (only the set the season needs is downloaded). */
  propGroup(S = this.S ?? 1) { return S > 0.7 ? 'props-snow' : 'props-bare'; }
  loadProps(season) {
    const S = (SEASONS[season] || SEASONS.winter).snow;
    this.loadAtlas('units');
    return this.loadAtlas(this.propGroup(S));
  }
  get props() { return this.atlas && this.atlas[this.propGroup()]; }

  /** Draw an atlas frame with its ground anchor at (x, y); k scales relative to life size. */
  drawFrame(ctx, group, name, x, y, k = 1, mirror = false) {
    const A = this.atlas && this.atlas[group], f = A && A.frames[name];
    if (!f) return false;
    const s = k / f.scale;
    if (mirror) { ctx.save(); ctx.translate(x, y); ctx.scale(-1, 1); x = 0; y = 0; }
    ctx.drawImage(A.sheets[f.s], f.x, f.y, f.w, f.h, x - f.ax * s, y - f.ay * s, f.w * s, f.h * s);
    if (mirror) ctx.restore();
    return true;
  }

  /** Load the PNG textures; until they arrive the vector fallback is drawn. */
  loadTextures(base = 'assets/textures/') {
    const names = ['mud', 'earth', 'snow', 'grass', 'ice', 'water', 'planks', 'sandbags', 'duckboard'];
    return Promise.all(names.map((n) => new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res([n, img]);
      img.onerror = () => rej(new Error('texture ' + n));
      img.src = base + n + '.png';
    }))).then((list) => { this.tex = Object.fromEntries(list); this.groundDrawn = false; })
      .catch((e) => console.warn('Textures unavailable, using vector ground:', e.message));
  }

  pattern(ctx, name) {
    const cache = ctx.__pats || (ctx.__pats = {});
    return cache[name] || (cache[name] = ctx.createPattern(this.tex[name], 'repeat'));
  }

  /** Noise used to break up the edges between terrain layers (fixed per map size). */
  maskNoise(mw, mh, R, k) {
    const key = mw + 'x' + mh + ':' + k;
    this._mn = this._mn || {};
    if (this._mn[key]) return this._mn[key];
    const out = new Float32Array(mw * mh);
    const vn = (x, y) => {
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const a = hash(x0 + k * 97, y0), b = hash(x0 + 1 + k * 97, y0), c = hash(x0 + k * 97, y0 + 1), d = hash(x0 + 1 + k * 97, y0 + 1);
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
      const u = x / R, v = y / R;
      out[y * mw + x] = vn(u * 0.7, v * 0.7) * 0.5 + vn(u * 1.9, v * 1.9) * 0.3 + vn(u * 5.3, v * 5.3) * 0.2;
    }
    return (this._mn[key] = out);
  }

  /** Tile bounds (inclusive, clamped) of the area being redrawn, or null for a full redraw. */
  clipTiles(map) {
    const c = this._clip;
    if (!c) return null;
    const pts = [[c.x, c.y], [c.x + c.w, c.y], [c.x, c.y + c.h], [c.x + c.w, c.y + c.h]].map(([x, y]) => unIso(x - this.OX, y - this.OY));
    const cl = (v, m) => Math.max(0, Math.min(m, v));
    return {
      x0: cl(Math.floor(Math.min(...pts.map((p) => p.x))) - 1, map.w - 1), x1: cl(Math.ceil(Math.max(...pts.map((p) => p.x))) + 1, map.w - 1),
      y0: cl(Math.floor(Math.min(...pts.map((p) => p.y))) - 1, map.h - 1), y1: cl(Math.ceil(Math.max(...pts.map((p) => p.y))) + 1, map.h - 1),
    };
  }

  /** Draw only the part of a per-tile image (R px per tile, already in iso-tile transform) that the redraw needs. */
  drawTileImage(ctx, img, R, tb, data = null) {
    if (!tb) { ctx.drawImage(img, 0, 0); return; }
    const sx = tb.x0 * R, sy = tb.y0 * R, sw = (tb.x1 - tb.x0 + 1) * R, sh = (tb.y1 - tb.y0 + 1) * R;
    if (data) {
      // copy just this region of the pixel data: drawing a large canvas that was just written to
      // forces the browser to snapshot all of it
      const t = this._tileTmp || (this._tileTmp = document.createElement('canvas'));
      if (t.width < sw || t.height < sh) { t.width = Math.max(t.width, sw); t.height = Math.max(t.height, sh); }
      const tc = t.getContext('2d');
      tc.clearRect(0, 0, sw, sh);
      tc.putImageData(data, -sx, -sy, sx, sy, sw, sh);
      ctx.drawImage(t, 0, 0, sw, sh, sx, sy, sw, sh);
      return;
    }
    ctx.drawImage(img, sx, sy, sw, sh, sx, sy, sw, sh);
  }

  /** Alpha mask (R px per tile) from per-tile amounts, with ragged noisy edges. */
  buildMask(map, amounts, k, spread = 0.7, tb = null) {
    const R = 8, mw = map.w * R, mh = map.h * R;
    const noise = this.maskNoise(mw, mh, R, k);
    let c = this._mask;
    const fresh = !c || c.width !== mw || c.height !== mh || !this._maskImg;
    if (fresh) { c = this._mask = document.createElement('canvas'); c.width = mw; c.height = mh; this._maskImg = c.getContext('2d').createImageData(mw, mh); tb = null; }
    const mc = c.getContext('2d');
    const img = this._maskImg;
    const py0 = tb ? tb.y0 * R : 0, py1 = tb ? (tb.y1 + 1) * R : mh, px0 = tb ? tb.x0 * R : 0, px1 = tb ? (tb.x1 + 1) * R : mw;
    const A = (x, y) => amounts[Math.max(0, Math.min(map.h - 1, y)) * map.w + Math.max(0, Math.min(map.w - 1, x))];
    for (let y = py0; y < py1; y++) {
      const ty = (y + 0.5) / R - 0.5, y0 = Math.floor(ty), fy = ty - y0;
      for (let x = px0; x < px1; x++) {
        const tx = (x + 0.5) / R - 0.5, x0 = Math.floor(tx), fx = tx - x0;
        const a = (A(x0, y0) * (1 - fx) + A(x0 + 1, y0) * fx) * (1 - fy) + (A(x0, y0 + 1) * (1 - fx) + A(x0 + 1, y0 + 1) * fx) * fy;
        const v = a + (noise[y * mw + x] - 0.5) * spread;
        const t = Math.max(0, Math.min(1, (v - 0.42) / 0.16));
        const i = (y * mw + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = t * t * (3 - 2 * t) * 255;
      }
    }
    if (tb) mc.putImageData(img, 0, 0, px0, py0, px1 - px0, py1 - py0); else mc.putImageData(img, 0, 0);
    return c;
  }

  /** Ground from PNG textures, sculpted and lit by the battlefield relief. */
  drawTexturedBase(g, map, S, cover) {
    const tb = this.clipTiles(map);
    const fillMap = (ctx) => (tb ? ctx.fillRect(tb.x0 / K, tb.y0 / K, (tb.x1 - tb.x0 + 1) / K, (tb.y1 - tb.y0 + 1) / K) : ctx.fillRect(0, 0, map.w / K, map.h / K));
    const K = 1 / 96; // texture pixels per tile = 96
    const isoT = (ctx, s) => ctx.setTransform((TW / 2) * s, (TH / 2) * s, (-TW / 2) * s, (TH / 2) * s, this.OX, this.OY);

    // relief: full build once per map/season, then only around changed tiles
    const ch = map.changes || [];
    if (!this.relief || this.reliefMap !== map || this.reliefS !== S || ch.length > 80) {
      this.relief = new Relief(map, 16); this.reliefMap = map; this.reliefS = S;
      this.relief.update(map, { S, snowTile: cover });
    } else if (ch.length) {
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (const c of ch) { x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x); y1 = Math.max(y1, c.y); }
      this.relief.update(map, { S, snowTile: cover }, { x0, y0, x1, y1 });
    }
    map.changes = [];
    const rf = this.relief;
    if (!this.rcv || this.rcv.src !== rf) {
      const mk = (arr) => { const cv = document.createElement('canvas'); cv.width = rf.mw; cv.height = rf.mh; const img = new ImageData(arr, rf.mw, rf.mh); cv.__data = img; return { cv, img }; };
      this.rcv = { src: rf, shade: mk(rf.shade), snow: mk(rf.snow), earth: mk(rf.earth), water: mk(rf.water) };
      rf.dirty = { x: 0, y: 0, w: rf.mw, h: rf.mh };
    }
    if (rf.dirty) {
      const d = rf.dirty;
      for (const k of ['shade', 'snow', 'earth', 'water']) this.rcv[k].cv.getContext('2d').putImageData(this.rcv[k].img, 0, 0, d.x, d.y, d.w, d.h);
      rf.dirty = null;
    }

    isoT(g, K);
    g.fillStyle = this.pattern(g, 'mud');
    fillMap(g);

    const L = this.layer || (this.layer = document.createElement('canvas'));
    if (L.width !== this.ground.width || L.height !== this.ground.height) { L.width = this.ground.width; L.height = this.ground.height; }
    const lc = supersample(L.getContext('2d'));
    const clip = this._clip;
    const layer = (name, mask, R) => {
      lc.save();
      lc.setTransform(1, 0, 0, 1, 0, 0);
      lc.globalCompositeOperation = 'source-over';
      if (clip) { lc.beginPath(); lc.rect(clip.x, clip.y, clip.w, clip.h); lc.clip(); lc.clearRect(clip.x, clip.y, clip.w, clip.h); }
      else lc.clearRect(0, 0, L.width, L.height);
      isoT(lc, K);
      lc.fillStyle = this.pattern(lc, name);
      fillMap(lc);
      lc.globalCompositeOperation = 'destination-in';
      isoT(lc, 1 / R);
      lc.imageSmoothingEnabled = true;
      this.drawTileImage(lc, mask, R, tb, mask.__data);
      lc.restore();
      g.setTransform(1, 0, 0, 1, 0, 0);
      if (clip) {
        const sx = clip.x * GS, sy = clip.y * GS;
        g.drawImage(L, sx, sy, clip.w * GS, clip.h * GS, clip.x, clip.y, clip.w, clip.h);
      } else g.drawImage(L, 0, 0, L.width / GS, L.height / GS);
    };
    const grassA = new Float32Array(map.w * map.h);
    for (const t of map.tiles) grassA[t.y * map.w + t.x] = !t.mud && !t.crater ? 1 : 0;
    const gm = this.buildMask(map, grassA, 1, 0.8, tb); gm.__data = this._maskImg;
    layer('grass', gm, 8);
    layer('earth', this.rcv.earth.cv, 16);
    if (S > 0) layer('snow', this.rcv.snow.cv, 16);
    layer(S > 0.3 ? 'ice' : 'water', this.rcv.water.cv, 16);

    // sculpt everything with the relief light: soft-light for form, a gentler overlay for contrast
    g.save();
    isoT(g, 1 / 16);
    g.imageSmoothingEnabled = true;
    g.globalCompositeOperation = 'soft-light';
    this.drawTileImage(g, this.rcv.shade.cv, 16, tb, this.rcv.shade.img);
    g.globalAlpha = 0.18;
    g.globalCompositeOperation = 'overlay';
    this.drawTileImage(g, this.rcv.shade.cv, 16, tb, this.rcv.shade.img);
    g.restore();

    // broad light/dark variation so the textures never visibly repeat
    const field = this.field || (this.field = document.createElement('canvas'));
    field.width = map.w; field.height = map.h;
    const fc = field.getContext('2d');
    const img = fc.createImageData(map.w, map.h);
    for (const t of map.tiles) {
      const i = (t.y * map.w + t.x) * 4;
      const v = 255 * (0.84 + 0.16 * hash(t.x * 0.37, t.y * 0.53));
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    fc.putImageData(img, 0, 0);
    g.save();
    g.globalCompositeOperation = 'multiply';
    isoT(g, 1);
    g.imageSmoothingEnabled = true;
    this.drawTileImage(g, field, 1, tb);
    g.restore();
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

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
    const g = supersample(this.ground.getContext('2d'));
    // Redraw only around changed tiles when the relief is already built for this map and season.
    const ch = map.changes || [];
    let clip = null;
    if (this.groundDrawn && this.tex && this.relief && this.reliefMap === map && this.reliefS === S && ch.length && ch.length <= 80) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const c of ch) { x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x); y1 = Math.max(y1, c.y); }
      x0 -= 2; y0 -= 2; x1 += 3; y1 += 3;
      const pts = [iso(x0, y0), iso(x1, y0), iso(x0, y1), iso(x1, y1)];
      const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
      const minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
      clip = { x: Math.floor(minX + this.OX), y: Math.floor(minY + this.OY - 40), w: Math.ceil(maxX - minX), h: Math.ceil(maxY - minY + 60) };
    }
    if (clip) {
      // Incremental: draw the changed area into a small patch canvas (cheap), then copy it in.
      const patch = this.patch || (this.patch = document.createElement('canvas'));
      const pw = Math.ceil(clip.w * GS), ph = Math.ceil(clip.h * GS);
      if (patch.width !== pw || patch.height !== ph) { patch.width = pw; patch.height = ph; }
      const save = { ground: this.ground, layer: this.layer, OX: this.OX, OY: this.OY };
      this.ground = patch; this.layer = this.patchLayer || (this.patchLayer = document.createElement('canvas'));
      this.OX = save.OX - clip.x; this.OY = save.OY - clip.y;
      this._clip = { x: 0, y: 0, w: clip.w, h: clip.h, real: clip };
      const pg = supersample(patch.getContext('2d'));
      pg.save(); pg.setTransform(1, 0, 0, 1, 0, 0); pg.clearRect(0, 0, clip.w, clip.h);
      try {
        this.drawGroundInner(pg, map, S);
      } finally {
        pg.restore();
        Object.assign(this, save);
      }
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(clip.x, clip.y, clip.w, clip.h);
      g.drawImage(patch, clip.x, clip.y, clip.w, clip.h);
      g.restore();
      this._clip = null;
      return;
    }
    this._clip = null;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.ground.width, this.ground.height);
    try {
      this.drawGroundInner(g, map, S);
    } finally {
      g.restore();
      if (!this.tex) map.changes = [];
    }
  }

  drawGroundInner(g, map, S) {

    const cover = new Float32Array(map.w * map.h);
    for (const t of map.tiles) cover[t.y * map.w + t.x] = snowCover(t, S);

    PAT = this.tex ? (name) => this.pattern(g, name) : null;
    if (this.tex) this.drawTexturedBase(g, map, S, cover);
    // 1. (vector fallback) smooth colour field, bilinearly stretched into the isometric diamond
    else {
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
    }

    g.setTransform(1, 0, 0, 1, this.OX, this.OY);
    g.save();
    const c0 = iso(0, 0), c1 = iso(map.w, 0), c2 = iso(map.w, map.h), c3 = iso(0, map.h);
    g.beginPath(); g.moveTo(c0.x, c0.y); g.lineTo(c1.x, c1.y); g.lineTo(c2.x, c2.y); g.lineTo(c3.x, c3.y); g.closePath();
    g.clip();

    if (!this.tex) {
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
    } else {
      for (const t of map.tiles) {
        const h = hash(t.x, t.y);
        if (!this.relief && t.mud && !t.trench && h > 0.97 && !t.crater) drawPuddle(g, iso(t.x + 0.5, t.y + 0.5), 10 + h * 6, 4, S, h);
      }
    }

    // 4. shell craters: black earth blasted through the snow, spoil lip, ice or water
    for (const t of map.tiles) {
      if (!t.crater) continue;
      const h = hash(t.x * 3.1, t.y * 1.7);
      const c = iso(t.x + 0.25 + t.shade * 0.5, t.y + 0.25 + h * 0.5);
      const r = (5 + t.crater * 4) * (0.8 + h * 0.45);
      if (this.relief && PAT) {
        // ejecta: clods of black earth flung over the surrounding ground
        g.save(); g.translate(c.x, c.y); g.scale(1, 0.5); g.fillStyle = PAT('earth');
        for (let i = 0; i < 10; i++) {
          const ang = frac(h * (i + 1) * 5.7) * TAU, dd = r * (1.3 + frac(h * (i + 2) * 3.1) * 1.1);
          g.beginPath(); g.arc(Math.cos(ang) * dd, Math.sin(ang) * dd, r * (0.06 + frac(h * i * 7.3) * 0.12), 0, TAU); g.fill();
        }
        g.restore();
        continue;
      }
      g.save();
      g.translate(c.x, c.y); g.scale(1, 0.5);
      let gr;
      g.fillStyle = PAT ? PAT('earth') : 'rgba(20,15,11,0.55)';
      for (let i = 0; i < 9; i++) {
        const ang = frac(h * (i + 1) * 5.7) * TAU, dd = r * (0.9 + frac(h * (i + 2) * 3.1) * 0.9);
        g.beginPath(); g.arc(Math.cos(ang) * dd, Math.sin(ang) * dd, r * (0.12 + frac(h * i * 7.3) * 0.25), 0, TAU); g.fill();
      }
      const lumps = 7;
      for (let i = 0; i < lumps; i++) {
        const ang = (i / lumps) * TAU + h * 6;
        const lr = r * (0.95 + frac(h * (i + 3) * 7.7) * 0.25);
        const snowy = !PAT && S > 0.7 && i % 3 === 0;
        g.fillStyle = PAT ? PAT(snowy ? 'snow' : 'earth') : snowy ? 'rgba(200,207,216,0.75)' : (i % 3 ? 'rgba(46,36,28,0.7)' : 'rgba(66,54,42,0.6)');
        g.beginPath(); g.arc(Math.cos(ang) * lr * 0.6, Math.sin(ang) * lr * 0.6, r * (0.45 + frac(h * i * 3.3) * 0.25), 0, TAU); g.fill();
      }
      gr = g.createRadialGradient(r * 0.1, r * 0.3, 0, 0, 0, r * 0.85);
      gr.addColorStop(0, '#120d09'); gr.addColorStop(0.7, '#1d1610'); gr.addColorStop(1, 'rgba(40,31,24,0.6)');
      if (PAT) { g.fillStyle = PAT('earth'); g.beginPath(); g.ellipse(0, 0, r * 0.85, r * (0.7 + h * 0.25), h * 2, 0, TAU); g.fill(); gr = g.createRadialGradient(r * 0.1, r * 0.3, 0, 0, 0, r * 0.85); gr.addColorStop(0, 'rgba(8,6,4,0.85)'); gr.addColorStop(1, 'rgba(8,6,4,0.1)'); }
      g.fillStyle = gr;
      g.beginPath(); g.ellipse(0, 0, r * 0.85, r * (0.7 + h * 0.25), h * 2, 0, TAU); g.fill();
      // lit far rim and shadowed near rim give the hole depth
      g.lineWidth = Math.max(1.5, r * 0.18);
      g.strokeStyle = S > 0.3 ? 'rgba(235,240,246,0.35)' : 'rgba(150,135,115,0.35)';
      g.beginPath(); g.ellipse(0, 0, r * 0.9, r * (0.75 + h * 0.25), h * 2, Math.PI * 0.95, Math.PI * 1.85); g.stroke();
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.beginPath(); g.ellipse(0, 0, r * 0.8, r * (0.65 + h * 0.25), h * 2, Math.PI * 0.05, Math.PI * 0.9); g.stroke();
      g.restore();
      if ((t.crater >= 3 && h > 0.6) || (t.crater === 2 && h > 0.88)) drawPuddle(g, { x: c.x + r * 0.05, y: c.y + r * 0.1 }, r * 0.5, r * 0.2, S, h);
    }
    g.restore(); // clip

    if (this.props && this.tex) {
      this.drawPropsGround(g, map, S);
      return;
    }
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
    let berm = mixHex('#3a3028', '#c3cad3', S * 0.85);
    let bermTop = mixHex('#4d4136', '#e2e7ec', S * 0.9);
    if (PAT) { berm = PAT(S > 0.6 ? 'snow' : 'earth'); bermTop = S > 0.25 ? PAT('snow') : PAT('mud'); }
    // a band of texture laid along each trench run, oriented with it
    const band = (t, width, name, scale, ox = 0, oy = 0) => {
      const c = iso(t.x + 0.5, t.y + 0.5);
      c.x += ox; c.y += oy;
      g.fillStyle = PAT(name);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = T(t.x + dx, t.y + dy);
        if (!n || !n.trench) continue;
        const m = iso(t.x + 0.5 + dx * 0.5, t.y + 0.5 + dy * 0.5);
        const ang = Math.atan2(m.y + oy - c.y, m.x + ox - c.x), len = Math.hypot(m.x + ox - c.x, m.y + oy - c.y);
        g.save(); g.translate(c.x, c.y); g.rotate(ang); g.scale(scale, scale);
        g.fillRect(0, -width / 2 / scale, (len + 1) / scale, width / scale);
        g.restore();
      }
      g.save(); g.translate(c.x, c.y); g.scale(scale, scale);
      g.beginPath(); g.arc(0, 0, width / 2 / scale, 0, TAU); g.fill();
      g.restore();
    };
    g.lineCap = 'round';
    if (!this.relief) {
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
        if (PAT && S > 0.25 && S < 0.75 && frac(h * i * 3.7) > 0.5) { g.fillStyle = PAT('earth'); g.beginPath(); g.ellipse(x + 1, y, rr * 0.8, rr * 0.4, 0, 0, TAU); g.fill(); }
        if (S > 0.3 && frac(h * i * 6.1) > 0.55) {
          g.fillStyle = 'rgba(34,27,21,0.75)';
          g.beginPath(); g.ellipse(x + 2, y + 1, rr * 0.4, rr * 0.18, 0, 0, TAU); g.fill();
        }
      }
    }
    }
    if (PAT) {
      for (const t of trenches) if (t.trench >= 2) { if (t.trench >= 3) strokeTrench(t, 23, '#86857f'); else band(t, 23, 'sandbags', 0.32); }
      for (const t of trenches) band(t, 16, 'planks', 0.28);
      for (const t of trenches) strokeTrench(t, 9.5, 'rgba(0,0,0,0.55)', 0, 2.2);
      for (const t of trenches) band(t, 8, t.trench >= 2 ? 'duckboard' : (S > 0.3 ? 'ice' : 'water'), t.trench >= 2 ? 0.3 : 0.25, 0, 2.2);
      for (const t of trenches) if (t.trench < 2) strokeTrench(t, 8, 'rgba(10,8,6,0.45)', 0, 2.2);
    } else {
    for (const t of trenches) if (t.trench >= 2) strokeTrench(t, 23, t.trench >= 3 ? '#86857f' : (S > 0.3 ? '#a9a59b' : '#655d50'));
    for (const t of trenches) strokeTrench(t, 16, '#3c3024');
    g.setLineDash([1.8, 5.5]);
    for (const t of trenches) strokeTrench(t, 16, '#1a140f');
    g.setLineDash([]);
    for (const t of trenches) strokeTrench(t, 8.5, '#140f0b', 0, 2.2);
    }
    g.setLineDash([5, 7]);
    if (!PAT) for (const t of trenches) if (t.trench < 2) strokeTrench(t, 2, S > 0.3 ? 'rgba(190,205,220,0.55)' : 'rgba(140,156,176,0.5)', 0, 2.2);
    g.setLineDash([2.5, 2]);
    if (!PAT) for (const t of trenches) if (t.trench >= 2) strokeTrench(t, 3, '#5a4630', 0, 2.2);
    g.setLineDash([]);
    // sandbags along both lips (more on reinforced works), snow-capped in winter
    for (const t of trenches) {
      const c = iso(t.x + 0.5, t.y + 0.5);
      const n = this.relief ? (t.trench >= 2 ? 5 : 0) : t.trench >= 2 ? 9 : 4;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + t.shade * 2;
        const bx = c.x + Math.cos(a) * 10.5, by = c.y + Math.sin(a) * 5.5;
        g.fillStyle = t.trench >= 3 ? '#8d8b84' : PAT ? PAT('sandbags') : (i % 2 ? '#6b6455' : '#5d5649');
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

  /** True if tile (x,y) lies near the area being redrawn (always true on a full redraw). */
  inClip(x, y, m = 2) {
    const c = this._clip;
    if (!c) return true;
    const p = iso(x + 0.5, y + 0.5);
    const gx = p.x + this.OX, gy = p.y + this.OY;
    return gx > c.x - m * 64 && gx < c.x + c.w + m * 64 && gy > c.y - m * 40 && gy < c.y + c.h + m * 40;
  }

  /** Draw a pre-rendered 3D prop with its origin (ground point) at (x, y) in the current space. */
  drawProp(ctx, name, x, y, mirror = false) {
    if (name.startsWith('mg_') || name.startsWith('gun_')) return this.drawFrame(ctx, 'units', name, x, y, 1, mirror);
    return this.drawFrame(ctx, this.propGroup(), name, x, y, 1, mirror);
  }

  /** Trenches, wire and debris from the pre-rendered 3D tiles, baked into the ground image. */
  drawPropsGround(g, map, S) {
    const snow = S > 0.7 ? '_s' : '';
    const T = (x, y) => x >= 0 && y >= 0 && x < map.w && y < map.h ? map.tiles[y * map.w + x] : null;
    g.setTransform(1, 0, 0, 1, this.OX, this.OY);
    // debris lying on the ground
    for (const t of map.tiles) {
      if (t.trench || t.wire || t.decor || !this.inClip(t.x, t.y, 1)) continue;
      const h = hash(t.x * 9.7, t.y * 4.3);
      if (!((t.mud && h > 0.86) || h > 0.975)) continue;
      const p = iso(t.x + 0.3 + h * 0.4, t.y + 0.3 + t.shade * 0.4);
      this.drawProp(g, `debris${Math.floor(h * 97) % 3}${snow}`, p.x, p.y);
    }
    // trench tiles by connectivity, back to front
    const trenches = map.tiles.filter((t) => t.trench && this.inClip(t.x, t.y, 2)).sort((a, b) => a.x + a.y - (b.x + b.y) || a.x - b.x);
    for (const t of trenches) {
      const has = (dx, dy) => { const n = T(t.x + dx, t.y + dy); return n && n.trench ? 1 : 0; };
      const mask = has(0, -1) | (has(1, 0) << 1) | (has(0, 1) << 2) | (has(-1, 0) << 3);
      const p = iso(t.x + 0.5, t.y + 0.5);
      const v = Math.floor(hash(t.x * 3.3, t.y * 7.1) * 3) % 3;
      this.drawProp(g, `trench_m${mask}_l${Math.max(1, Math.min(3, t.trench))}_v${v}${snow}`, p.x, p.y);
    }
    // pennant posts showing who holds each stretch of trench
    for (const t of trenches) {
      if (t.owner < 0 || hash(t.x * 5.3, t.y * 3.7) < 0.78) continue;
      const p = iso(t.x + 0.22, t.y + 0.22);
      g.strokeStyle = '#1e1a16'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x, p.y - 14); g.stroke();
      g.fillStyle = t.owner === PLAYER ? '#d8c27a' : '#a9b8c4';
      g.beginPath(); g.moveTo(p.x, p.y - 14); g.lineTo(p.x + 7, p.y - 12.3); g.lineTo(p.x, p.y - 10.5); g.closePath(); g.fill();
    }
    // barbed wire belts, laid along each belt's run
    const W = (x, y) => { const n = T(x, y); return n && n.wire > 0; };
    for (const t of map.tiles) {
      if (t.wire <= 0 || !this.inClip(t.x, t.y, 2)) continue;
      const nx = (W(t.x - 1, t.y) ? 1 : 0) + (W(t.x + 1, t.y) ? 1 : 0), ny = (W(t.x, t.y - 1) ? 1 : 0) + (W(t.x, t.y + 1) ? 1 : 0);
      const dir = nx > ny ? 'x' : 'y';
      const v = Math.floor(hash(t.x * 1.3, t.y * 2.9) * 2) % 2;
      const p = iso(t.x + 0.5, t.y + 0.5);
      this.drawProp(g, `${t.wire > 50 ? 'wire' : 'wired'}_${dir}${v}${snow}`, p.x, p.y);
    }
  }

  // ------------------------------------------------------------ frame

  update(dt, simDt, state) { this.atmo.update(dt, simDt, state, this); }
  onEvent(ev) { this.atmo.onEvent(ev, this); }

  draw(state, ui) {
    const ctx = this.ctx;
    const now = performance.now();
    // craters are batched: they appear under the shell smoke, so ~0.7 s of latency is invisible
    if (!this.groundDrawn || (state.map.dirty && now - this.lastGround > 1000)) {
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
    ctx.drawImage(this.ground, -this.OX, -this.OY, this.gw, this.gh);

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
      ctx.globalAlpha = a * 0.9;
      const nat = this.nations && this.nations[b.team];
      if (this.hasArmy(nat)) {
        const v = b.view || 0;
        if (this.drawSoldier(ctx, nat, 'dead', 0, [1, 0, -1, 0][v], [0, -1, 0, 1][v], p.x, p.y)) continue;
      }
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
    if (this.props && t.decor !== 'ruin') {
      const snow = (this.S ?? 1) > 0.7 ? '_s' : '';
      const h = hash(t.x * 2.3, t.y * 5.1);
      const c = iso(t.x + 0.3 + t.shade * 0.4, t.y + 0.3 + h * 0.4);
      const name = t.decor === 'stump' ? `stump${Math.floor(h * 4) % 4}` : t.decor === 'tree' ? `tree${Math.floor(h * 2) % 2}` : `log${Math.floor(h * 3) % 3}`;
      if (this.drawProp(ctx, name + snow, c.x, c.y)) return;
    }
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
    const HQK = 1.6; // the command post is drawn larger than life so it reads as the objective
    if (this.drawFrame(ctx, this.propGroup(), 'hq' + (S > 0.7 ? '_s' : ''), c.x, c.y, HQK)) {
      const UP = 39.2; // screen px per world unit of height (45.25 * cos 30deg)
      const at = (dx, dy, z) => { const p = iso(q.x + 0.5 + dx * HQK, q.y + 0.5 + dy * HQK); return { x: p.x, y: p.y - z * UP * HQK }; };
      // stovepipe smoke
      const pipe = at(-0.15, -0.12, 0.44);
      for (let i = 0; i < 5; i++) {
        const k = ((state.time * 0.25 + i / 5) % 1);
        ctx.fillStyle = `rgba(90,88,84,${0.28 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(pipe.x + k * 14 + Math.sin(k * 6 + i) * 2, pipe.y - k * 30, 2.5 + k * 7, 0, TAU); ctx.fill();
      }
      // field-telephone wires sagging away from the pole
      const top = at(-0.62, -0.52, 0.72);
      ctx.strokeStyle = 'rgba(20,18,16,0.75)'; ctx.lineWidth = 0.6;
      for (const [dx, dy, sag] of [[1.6, -2.2, 14], [2.8, -1.4, 18], [-1.8, 1.5, 12]]) {
        const e = at(-0.62 + dx * f, -0.52 + dy, 0.55);
        ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.quadraticCurveTo((top.x + e.x) / 2, (top.y + e.y) / 2 + sag, e.x, e.y); ctx.stroke();
      }
      // flag by the entrance shows who holds the HQ
      const base = at(0.5, -0.2, 0), head = at(0.5, -0.2, 0.95);
      ctx.strokeStyle = '#1e1a16'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(head.x, head.y); ctx.stroke();
      ctx.fillStyle = owner < 0 ? '#999' : TEAM_COLOR[owner];
      const wave = Math.sin(state.time * 3 + team) * 2;
      ctx.beginPath(); ctx.moveTo(head.x, head.y); ctx.quadraticCurveTo(head.x + 8, head.y + wave, head.x + 17, head.y + 3 + wave);
      ctx.lineTo(head.x + 17, head.y + 9 + wave); ctx.quadraticCurveTo(head.x + 8, head.y + 7 - wave, head.x, head.y + 9); ctx.closePath(); ctx.fill();
      ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillText('HQ', c.x + 0.5, c.y + 34.5);
      ctx.fillStyle = '#e8e8e0'; ctx.fillText('HQ', c.x, c.y + 34);
      return;
    }
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

  /** Load soldier sheets for the nations in play, plus the artillery art. */
  loadArmies(nations) {
    for (const n of new Set(nations)) this.loadAtlas('soldiers-' + n);
    if (!this.gunArt && !this.gunLoading) {
      this.gunLoading = Promise.all(['gun-a', 'gun-b'].map((k) => retry((n) => loadImage(`assets/art/${k}.png${n ? '?r=' + n : ''}`))))
        .then(([a, b]) => { this.gunArt = { a, b }; })
        .catch((e) => { this.gunLoading = null; console.warn('Gun art unavailable:', e.message); });
    }
  }
  hasArmy(nation) { return !!(nation && this.atlas && this.atlas['soldiers-' + nation]); }

  /** Pick a rendered view for a ground heading: a = +x, b = -y, mirrored for +y / -x. */
  static viewFor(hx, hy) {
    const opts = [[hx, 'a', false], [-hy, 'b', false], [hy, 'a', true], [-hx, 'b', true]];
    let best = opts[0];
    for (const o of opts) if (o[0] > best[0]) best = o;
    return { view: best[1], mirror: best[2] };
  }

  drawSoldier(ctx, nation, poseName, frame, hx, hy, x, y) {
    const { view, mirror } = Renderer.viewFor(hx, hy);
    // units are drawn slightly larger than life for legibility
    return this.drawFrame(ctx, 'soldiers-' + nation, `${poseName}${frame}_${view}`, x, y, 1.35, mirror);
  }

  /** Howitzer from the supplied art: a faces -x, b faces +y; mirrored for -y / +x. */
  /** Heading a gun is drawn with: trail-first while being moved, otherwise laid on its target. */
  static gunHeading(u) { return u.moving ? [-u.hx, -u.hy] : [u.aimX ?? u.hx, u.aimY ?? u.hy]; }

  /** Pre-rendered 3D howitzer: 8 directions, wheels turning while it moves. */
  drawGun3D(ctx, p, u, time) {
    const [hx, hy] = Renderer.gunHeading(u);
    const dir = ((Math.round(Math.atan2(hy, hx) / (Math.PI / 4)) % 8) + 8) % 8;
    // 2 spoke-passes per second while moving: smooth rolling without wagon-wheel strobing
    const frame = u.moving ? Math.floor(time * 16 + u.seed * 8) % 8 : 0;
    const recoil = u.firing > 0 && !u.moving ? u.firing * 0.08 : 0;
    const q = iso(u.x - hx * recoil, u.y - hy * recoil);
    return this.drawFrame(ctx, 'units', `gun_d${dir}_f${frame}`, q.x, q.y, 1.5);
  }

  drawGunArt(ctx, p, u) {
    if (!this.gunArt) return false;
    const opts = [[u.hx, 'b', true], [u.hy, 'b', false], [-u.hx, 'a', false], [-u.hy, 'a', true]];
    let best = opts[0];
    for (const o of opts) if (o[0] > best[0]) best = o;
    const [, which, mirror] = best;
    const img = this.gunArt[which];
    // ground point under the axle, in source pixels
    const anchor = which === 'a' ? [156, 270] : [136, 258];
    const k = 0.13;
    const recoil = u.firing > 0 ? u.firing * 8 : 0;
    const d = iso(u.hx, u.hy), dl = Math.hypot(d.x, d.y) || 1;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(p.x + 4, p.y + 1, 24, 9, 0, 0, TAU); ctx.fill();
    ctx.translate(p.x - (d.x / dl) * recoil, p.y - (d.y / dl) * recoil);
    if (mirror) ctx.scale(-1, 1);
    ctx.drawImage(img, -anchor[0] * k, -anchor[1] * k, img.width * k, img.height * k);
    ctx.restore();
    return true;
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
      if (u.type === 'artillery') {
        const [gx, gy] = Renderer.gunHeading(u);
        const CREW = [[-0.25, 0.42], [-0.25, -0.42], [-0.6, 0.34], [-0.6, -0.34], [-0.95, 0.24], [-0.95, -0.24]];
        const [cf, cs] = CREW[i % CREW.length];
        ox = gx * cf - gy * cs; oy = gy * cf + gx * cs;
      }
      else if (u.type === 'mg') { ox = -dir * (0.1 + (i % 2) * 0.12); oy = (Math.floor(i / 2) - 0.5) * 0.22 + 0.15; }
      else { ox = (row - 0.5) * 0.22 * -dir; oy = (col - 2) * 0.17; }
      const s = iso(u.x + ox + jx, u.y + oy + jy);
      men.push(s);
    }
    men.sort((a, b) => a.y - b.y);
    const phase = time * (charging ? 14 : 9) + u.seed * 10;
    const nation = this.nations && this.nations[u.team];
    const useSpr = this.hasArmy(nation);
    let gunDrawn = u.type !== 'artillery';
    const drawGunNow = () => { if (!gunDrawn) { gunDrawn = true; if (!this.drawGun3D(ctx, p, u, time) && !this.drawGunArt(ctx, p, u)) this.drawGun(ctx, p, u, time); } };
    if (!useSpr) drawGunNow();
    if (u.type === 'mg') {
      const { view, mirror } = Renderer.viewFor(u.hx, u.hy);
      const g = iso(u.x + u.hx * 0.12, u.y + u.hy * 0.12);
      let ok = false;
      ok = this.drawProp(ctx, 'mg_' + view, g.x, g.y, mirror);
      if (!ok) this.drawMG(ctx, p, u, time);
      if (u.firing > 0) {
        const d = iso(u.hx, u.hy), dl = Math.hypot(d.x, d.y) || 1;
        ctx.fillStyle = 'rgba(255,220,120,0.95)';
        ctx.beginPath(); ctx.arc(g.x + (d.x / dl) * 9, g.y + (d.y / dl) * 9 - 4.5, 2 + Math.random() * 2, 0, TAU); ctx.fill();
      }
    }
    if (useSpr) {
      const fr4 = Math.floor(phase / 1.6) % 4;
      men.forEach((s, i) => {
        if (s.y >= p.y) drawGunNow(); // crew behind the gun first, the rest in front
        let pn = pose, fr = 0;
        if (pose === 'walk' || pose === 'charge') fr = (fr4 + i) % 4;
        else if (pose === 'stand') {
          if (u.digging && i % 2 === 0) { pn = 'dig'; fr = Math.floor(phase / 2 + i) % 2; }
          else if (u.type === 'mg') pn = 'prone';
          else if (u.target && (u.firing > 0 || u.type === 'rifle')) pn = 'fire';
        }
        if (!this.drawSoldier(ctx, nation, pn, fr, u.hx, u.hy, s.x, s.y)) drawMan(ctx, s.x, s.y, u.team, pose, u.facing, phase + i * 1.7, false);
      });
      drawGunNow();
    }
    if (useSpr) { /* figures drawn above */ } else {
    if (pose !== 'trench') {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      for (const s of men) { ctx.beginPath(); ctx.ellipse(s.x + 2, s.y, pose === 'prone' ? 6 : 3.5, 1.5, 0, 0, TAU); ctx.fill(); }
    }
    men.forEach((s, i) => drawMan(ctx, s.x, s.y, u.team, pose, u.facing, phase + i * 1.7, u.digging && i % 2 === 0));
    }

    // small-arms muzzle flashes
    if (u.firing > 0 && u.type === 'rifle' && pose !== 'charge') {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < men.length; i += 2) {
        if (Math.sin(time * 40 + i) < 0.2) continue;
        const s = men[i];
        const hd = iso(u.hx, u.hy), hl = Math.hypot(hd.x, hd.y) || 1;
        const fx = s.x + (useSpr ? (hd.x / hl) * 9 : u.facing * 7.5), fy = s.y + (useSpr ? (hd.y / hl) * 9 : 0) - (pose === 'trench' ? (useSpr ? 2 : 7) : 11);
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

  /**
   * Incoming shells along a ballistic arc from the firing battery: the visible trail is the last part of
   * the flight, so it comes in from the gun's direction and steepens as it falls.
   */
  drawShells(ctx, state) {
    const UP = 39.2; // screen px per tile of height
    const at = (s, u) => {
      const d = Math.hypot(s.x - s.fromX, s.y - s.fromY);
      const z = 4 * (0.16 * d + 1.2) * u * (1 - u); // apex height grows with range
      const p = iso(s.fromX + (s.x - s.fromX) * u, s.fromY + (s.y - s.fromY) * u);
      return { x: p.x, y: p.y - z * UP };
    };
    ctx.lineCap = 'round';
    for (const s of state.shells) {
      const u = 1 - s.t / s.flight;
      if (u < 0.8) continue; // only the descent near the target is on screen
      const tail = Math.max(0, u - 0.07), head = at(s, u), back = at(s, tail);
      const fade = Math.min(1, (u - 0.8) / 0.06);
      const g = ctx.createLinearGradient(back.x, back.y, head.x, head.y);
      g.addColorStop(0, 'rgba(255,250,235,0)'); g.addColorStop(1, `rgba(255,238,200,${0.85 * fade})`);
      ctx.strokeStyle = g; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(back.x, back.y);
      for (let k = 1; k <= 4; k++) { const q = at(s, tail + ((u - tail) * k) / 4); ctx.lineTo(q.x, q.y); }
      ctx.stroke();
    }
  }

  drawEffects(ctx, state) {
    const anim = !!this.fx; // once loaded, impacts replace the older code-drawn blast visuals
    if (anim) { const base = ctx.getTransform(); for (const e of state.effects.filter((q) => q.type === 'impact').sort((a, b) => a.x + a.y - (b.x + b.y))) this.drawImpact(ctx, e, base); }
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
        if (anim) continue; // the impact animation has its own flash and earth column
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
        if (anim && e.shell) continue;
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
        if (anim) continue;
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
        if (e.hx !== undefined) {
          const d = iso(e.hx, e.hy), dl = Math.hypot(d.x, d.y) || 1, mz = iso(e.x + e.hx * 0.33, e.y + e.hy * 0.33), mx = mz.x, my = mz.y - 15;
          ctx.fillStyle = `rgba(200,200,190,${0.45 * (1 - k)})`;
          ctx.beginPath(); ctx.arc(mx + (d.x / dl) * k * 12 + wind.x * k * 10, my - k * 14, 6 + k * 16, 0, TAU); ctx.fill();
          if (k < 0.5) { ctx.globalCompositeOperation = 'lighter'; const gr = ctx.createRadialGradient(mx, my, 0, mx, my, 14); gr.addColorStop(0, `rgba(255,245,200,${1 - k * 2})`); gr.addColorStop(1, 'rgba(255,140,40,0)'); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(mx, my, 14, 0, TAU); ctx.fill(); ctx.globalCompositeOperation = 'source-over'; }
          continue;
        }
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

  // ------------------------------------------------------------ shell bursts

  /** Load the graded hand-drawn impact frames (assets/fx/impact.webp, built by scripts/process-impact.mjs). */
  loadImpact() {
    if (this.fx || this.fxLoading) return this.fxLoading;
    this.fxLoading = Promise.all([
      retry(() => fetch('assets/fx/impact.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })),
      retry((n) => loadImage(`assets/fx/impact.webp${n ? '?r=' + n : ''}`)),
    ]).then(([meta, img]) => {
      const buf = document.createElement('canvas'); buf.width = buf.height = meta.frameSize;
      const sh = document.createElement('canvas'); sh.width = 128; sh.height = 64; // soft ground shadow
      const sg = sh.getContext('2d'), gr = sg.createRadialGradient(64, 32, 0, 64, 32, 64);
      gr.addColorStop(0, 'rgba(4,5,8,0.55)'); gr.addColorStop(0.6, 'rgba(4,5,8,0.25)'); gr.addColorStop(1, 'rgba(4,5,8,0)');
      sg.setTransform(1, 0, 0, 0.5, 0, 16); sg.fillStyle = gr; sg.beginPath(); sg.arc(64, 32, 64, 0, TAU); sg.fill();
      const fl = document.createElement('canvas'); fl.width = fl.height = 64; // impact flash
      const fg = fl.getContext('2d'), fr = fg.createRadialGradient(32, 32, 0, 32, 32, 32);
      fr.addColorStop(0, 'rgba(255,240,210,1)'); fr.addColorStop(0.3, 'rgba(240,190,130,0.6)'); fr.addColorStop(1, 'rgba(200,140,90,0)');
      fg.fillStyle = fr; fg.fillRect(0, 0, 64, 64);
      this.fx = { meta, img, buf, shadow: sh, flash: fl };
    }).catch((e) => { this.fxLoading = null; console.warn('Impact animation unavailable:', e.message); });
    return this.fxLoading;
  }

  /**
   * One shell impact from the hand-drawn frames: neighbouring frames are crossfaded (premultiplied, in a
   * buffer), and the whole cloud keeps rising, swelling and drifting downwind between drawn frames so the
   * slow late frames read as continuous motion. A soft shadow on the ground anchors it to the terrain.
   */
  drawImpact(ctx, e, base) {
    const F = this.fx, M = F.meta, T = M.frameTimes, N = M.frameCount;
    const t = e.age;
    if (t >= M.duration) return;
    const opacity = Math.min(1, t / 0.035) * Math.min(1, (M.duration - t) / 1.2);
    const S = M.frameSize, cols = M.columns;
    // Blend in frame-index space with a cubic B-spline over four neighbouring frames: the weights always
    // sum to 1 and change smoothly through every drawn frame, so there is no pulse as each one passes
    // (a plain two-frame crossfade reads as stop motion). Premultiplied sum into a buffer.
    const b = F.buf.getContext('2d');
    b.globalCompositeOperation = 'source-over'; b.globalAlpha = 1;
    b.clearRect(0, 0, S, S);
    let i = 0;
    while (i < N - 1 && t >= T[i + 1]) i++;
    const u = i < N - 1 ? i + (t - T[i]) / (T[i + 1] - T[i]) : N - 1;
    const i0 = Math.floor(u), f = u - i0, f2 = f * f, f3 = f2 * f;
    const bw = [(1 - f) ** 3 / 6, (3 * f3 - 6 * f2 + 4) / 6, (-3 * f3 + 3 * f2 + 3 * f + 1) / 6, f3 / 6];
    const acc = new Map();
    for (let q = 0; q < 4; q++) { const j = Math.max(0, Math.min(N - 1, i0 - 1 + q)); acc.set(j, (acc.get(j) || 0) + bw[q]); }
    const ws = [...acc.entries()].filter(([, w]) => w > 0.002);
    const wsum = ws.reduce((s2, [, w]) => s2 + w, 0);
    let first = true;
    for (const [j, w] of ws) {
      b.globalCompositeOperation = first ? 'source-over' : 'lighter';
      b.globalAlpha = w / wsum;
      b.drawImage(F.img, (j % cols) * S, Math.floor(j / cols) * S, S, S, 0, 0, S, S);
      first = false;
    }
    b.globalAlpha = 1; b.globalCompositeOperation = 'source-over';
    // continuous motion layered over the drawn frames (eases in once the column has formed)
    const wind = this.atmo.wind, k = e.scale || 1;
    const late = Math.max(0, t - 0.35);
    const drift = late * late / (late + 1.2);
    const p = iso(e.x, e.y);
    const gx = p.x + wind.x * drift * 16 * k, gy = p.y + wind.y * drift * 6 * k;
    const size = 140 * k * (1 + 0.07 * drift);
    const rise = drift * 7 * k;
    // ground shadow, cast away from the sun (lower right)
    const dense = Math.min(1, t / 0.25) * (1 - Math.min(1, Math.max(0, (t - 2.2) / 2)));
    ctx.setTransform(base.a, base.b, base.c, base.d, base.e, base.f);
    ctx.globalAlpha = 0.85 * dense;
    const sw = size * (0.45 + 0.35 * Math.min(1, t / 0.8));
    ctx.drawImage(F.shadow, gx + size * 0.08 - sw / 2, gy - sw * 0.2, sw, sw * 0.5);
    // the cloud (optionally mirrored)
    const fl = e.flip ? -1 : 1;
    ctx.setTransform(base.a * fl, base.b * fl, base.c, base.d, base.a * gx + base.c * (gy - rise) + base.e, base.b * gx + base.d * (gy - rise) + base.f);
    ctx.globalAlpha = opacity;
    ctx.drawImage(F.buf, -size * M.anchor.x, -size * M.anchor.y, size, size);
    // flash at the moment of impact
    if (t < 0.11) {
      ctx.setTransform(base.a, base.b, base.c, base.d, base.e, base.f);
      ctx.globalCompositeOperation = 'lighter';
      const f = 1 - t / 0.11, r = (16 + 26 * (t / 0.11)) * k;
      ctx.globalAlpha = f * 0.85;
      ctx.drawImage(F.flash, p.x - r, p.y - r * 0.7 - 5 * k, r * 2, r * 1.4);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.setTransform(base.a, base.b, base.c, base.d, base.e, base.f);
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------ minimap

  drawMinimap(mctx, state, w, h) {
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.fillStyle = '#121309'; mctx.fillRect(0, 0, w, h);
    const s = Math.min(w / this.gw, h / this.gh);
    const ox = (w - this.gw * s) / 2, oy = (h - this.gh * s) / 2;
    mctx.drawImage(this.ground, ox, oy, this.gw * s, this.gh * s);
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
