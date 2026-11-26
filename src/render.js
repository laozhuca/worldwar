// Isometric (2:1, "45 degree") canvas renderer.
import { TILE_W as TW, TILE_H as TH, MAP_W, MAP_H, MAP_R, PLAYER, ENEMY, UNIT_TYPES, SEASONS } from './config.js';
import { tileAt, teamDir } from './map.js';
import { canBuild, MG_PACK, GUN_LIMBER, CLIMB_D } from './game.js';
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

/** A shell bursting in a muddy pool: its water thrown up brown (a canvas filter over the water effects). */
const MUDDY = 'sepia(1) saturate(1.05) hue-rotate(-6deg) brightness(0.5) contrast(1.15)';
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
  if (t.ground === 1) c -= 0.75; // open grass: the snow has gone
  else if (t.ground === 2) c += 0.8; // a snowfield
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
    this.insets = { top: 0, bottom: 0 }; // screen strips covered by overlays (none: the panels sit beside the map)
    this.ground = document.createElement('canvas');
    this.setGeometry(MAP_R);
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
    return { x: (this.M * wx - this.cam.x) * this.cam.zoom + this.vw / 2, y: (wy - this.cam.y) * this.cam.zoom + this.vh / 2 }; // (M: -1 on a level shown mirrored)
  }
  screenToWorld(sx, sy) {
    return { x: this.M * ((sx - this.vw / 2) / this.cam.zoom + this.cam.x), y: (sy - this.vh / 2) / this.cam.zoom + this.cam.y };
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
    // centre it in the open part of the screen, between the top bar and the command panel
    this.cam.x = this.M * p.x; this.cam.y = p.y - (this.insets.top - this.insets.bottom) / 2 / this.cam.zoom;
    this.clampCam();
  }
  /**
   * Keep the view on the battlefield: never zoomed out past it, never scrolled off its edge. Only the part
   * of the screen between the top bar and the command panel counts, so every edge of the map can be
   * scrolled into the open (what lies under the panels beyond the edge is hidden by them anyway).
   */
  clampCam() {
    const V = this.view, { top, bottom } = this.insets;
    const visH = Math.max(100, this.vh - top - bottom);
    const minZoom = Math.max(0.3, this.vw / (V.x1 - V.x0), visH / (V.y1 - V.y0));
    this.cam.zoom = Math.max(minZoom, Math.min(3, this.cam.zoom));
    const z = this.cam.zoom, hw = this.vw / 2 / z;
    const fit = (v, a, b) => (a > b ? (a + b) / 2 : Math.max(a, Math.min(b, v)));
    this.cam.x = fit(this.cam.x, V.x0 + hw, V.x1 - hw);
    // screen row sy shows world row (sy - vh/2) / z + cam.y: keep row `top` below the map's top edge and
    // row `vh - bottom` above its bottom edge
    this.cam.y = fit(this.cam.y, V.y0 + (this.vh / 2 - top) / z, V.y1 - (this.vh / 2 - bottom) / z);
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
    // the frame list is always revalidated, and the sheets are fetched by content version, so an update
    // never pairs a cached old sheet with new frames
    const p = retry(() => fetch(base + group + '.json', { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }))
      .then((meta) => Promise.all(Array.from({ length: meta.sheets }, (_, i) => retry((n) => loadImage(`${base}${group}-${i}.webp?v=${meta.v || 0}${n ? '&r=' + n : ''}`))))
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

  /**
   * The geometry for a battlefield of radius R: a diamond of radius R + 0.5 tiles around the map centre, a
   * 2:1 rectangle on screen. The ground canvas covers exactly that rectangle (plus a margin above for tall
   * props). Called again when a battle on a field of another size is drawn.
   */
  setGeometry(R) {
    if (this.M === undefined) this.M = 1;
    this.R = R; this._gustExt = null;
    const RR = R + 0.5, C = (2 * R + 1) / 2;
    // the camera may go right to the battlefield's edge and no further: nothing beyond it ever shows
    const E = RR - 0.05;
    this.view = this.baseView = { x0: -E * TW / 2, x1: E * TW / 2, y0: (2 * C - E) * TH / 2, y1: (2 * C + E) * TH / 2 };
    this.OX = (RR * TW) / 2;
    this.OY = TH * 6 - ((2 * C - RR) * TH) / 2; // (room above the map for a strip of ground beyond its top edge: map.extraTop)
    this.gw = RR * TW;
    this.gh = RR * TH + TH * 8;
    this.ground.width = Math.round(this.gw * GS);
    this.ground.height = Math.round(this.gh * GS);
  }

  /** Size the ground and the camera's limits for this battle's field (a level may have a larger one). */
  fitMap(map) {
    this.M = map.mirror ? -1 : 1; // a level may be shown mirrored left to right (the battle is the same; only the picture flips)
    if ((map.r ?? MAP_R) === this.R) return;
    this.setGeometry(map.r ?? MAP_R);
    this.relief = null; this.rcv = null; this.groundDrawn = false; this._rocks = null;
  }

  /** Text drawn in the world: reads the right way round even on a level shown mirrored. */
  wtext(ctx, str, x, y) {
    if (this.M > 0) { ctx.fillText(str, x, y); return; }
    ctx.save(); ctx.translate(x, y); ctx.scale(-1, 1); ctx.fillText(str, 0, 0); ctx.restore();
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
    const fillMap = (ctx, wide = false) => (tb ? ctx.fillRect(tb.x0 / K, tb.y0 / K, (tb.x1 - tb.x0 + 1) / K, (tb.y1 - tb.y0 + 1) / K) : wide ? ctx.fillRect(-12 / K, -12 / K, (map.w + 24) / K, (map.h + 24) / K) : ctx.fillRect(0, 0, map.w / K, map.h / K));
    const K = 1 / 96; // texture pixels per tile = 96
    const isoT = (ctx, s) => ctx.setTransform((TW / 2) * s, (TH / 2) * s, (-TW / 2) * s, (TH / 2) * s, this.OX, this.OY);

    // relief: full build once per map/season, then only around changed tiles
    const ch = map.changes || [];
    if (!this.relief || this.reliefMap !== map || this.reliefS !== S || ch.length > 80) {
      this.relief = new Relief(map, map.w > 80 ? 11 : 16); this.reliefMap = map; this.reliefS = S; // (a coarser relief on a large battlefield: it builds in half the time)
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
    fillMap(g, true); // (on beyond the grid too: the strip of ground above the map's top edge)

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
    const RR = rf.R;
    layer('earth', this.rcv.earth.cv, RR);
    if (S > 0) layer('snow', this.rcv.snow.cv, RR);
    layer(S > 0.3 ? 'ice' : 'water', this.rcv.water.cv, RR);

    // sculpt everything with the relief light: soft-light for form, a gentler overlay for contrast
    g.save();
    isoT(g, 1 / RR);
    g.imageSmoothingEnabled = true;
    g.globalCompositeOperation = 'soft-light';
    this.drawTileImage(g, this.rcv.shade.cv, RR, tb, this.rcv.shade.img);
    g.globalAlpha = 0.18;
    g.globalCompositeOperation = 'overlay';
    this.drawTileImage(g, this.rcv.shade.cv, RR, tb, this.rcv.shade.img);
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
      if (t.ground === 1) { const gr = 1 - cover[t.y * map.w + t.x]; img.data[i] = v * (1 - 0.14 * gr); img.data[i + 2] = v * (1 - 0.24 * gr); } // grass: olive-green
    }
    fc.putImageData(img, 0, 0);
    if (map.summer) this.drawSummer(g, map, tb, cover);
    if (map.tiles.some((t) => t.pond)) this.drawPonds(g, map, tb);
    g.save();
    g.globalCompositeOperation = 'multiply';
    isoT(g, 1);
    g.imageSmoothingEnabled = true;
    this.drawTileImage(g, field, 1, tb);
    g.restore();
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  /**
   * Early summer (a level with map.summer): the meadows green and the wheat gold behind the lines, the
   * churned mud and shell holes of the battle zone left as they are. A per-tile colour field, smoothed,
   * laid over the textured ground: first lightening it, then giving it its hue.
   */
  drawSummer(g, map, tb, cover) {
    const W = map.w, H = map.h;
    const cv = this._summer || (this._summer = document.createElement('canvas'));
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d'), img = c.createImageData(W, H), d = img.data;
    for (const t of map.tiles) {
      const i = (t.y * W + t.x) * 4;
      const torn = !t.sea && (t.mud || t.crater || t.trench) ? 1 : 0; // churned earth keeps its own colour
      const v = hash(t.x * 0.61, t.y * 0.37) * 0.25;
      let col = [0, 0, 0], a = 0;
      if (t.sea) { const sh = map.tiles[t.y * W + t.x - 1]; const shallow = sh && !sh.sea ? 1 : 0; col = shallow ? [150, 170, 165] : [52 + v * 30, 92 + v * 30, 110 + v * 20]; a = 1; } // the sea: deep blue-green, paler in the surf
      else if (t.ground === 5) { col = [196 + v * 40, 178 + v * 34, 132]; a = 0.85; } // sand
      else if (t.ground === 4) { col = [186 + v * 50, 156 + v * 40, 84]; a = 0.72; } // ripening wheat
      else if (t.ground === 1) { // meadow: olive green, drying to straw in patches, never the same twice
        const dry = Math.max(0, Math.sin(t.x * 0.31 + 1.3) * Math.cos(t.y * 0.27 - 0.8) + (hash(t.y * 0.9, t.x * 1.7) - 0.5) * 0.9);
        col = [100 + v * 30 + dry * 46, 112 + v * 24 + dry * 22, 64 + dry * 18]; a = 0.5;
      }
      else { col = [110, 112, 70]; a = 0.35; } // rough grass
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = Math.round(255 * a * (1 - torn * 0.85));
    }
    c.putImageData(img, 0, 0);
    const TWh = TW / 2, THh = TH / 2;
    g.save();
    g.setTransform(TWh, THh, -TWh, THh, this.OX, this.OY);
    g.imageSmoothingEnabled = true;
    if (tb) { g.beginPath(); g.rect(tb.x0, tb.y0, tb.x1 - tb.x0 + 1, tb.y1 - tb.y0 + 1); g.clip(); }
    g.globalCompositeOperation = 'soft-light'; g.globalAlpha = 0.9; g.drawImage(cv, 0, 0); // lighten
    g.globalCompositeOperation = 'color'; g.globalAlpha = 0.34; g.drawImage(cv, 0, 0); // and colour
    g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.35; g.drawImage(cv, 0, 0);
    g.restore();
  }

  /** Standing water (a broken river's pools): muddy brown, over the water lying in their basins (relief). */
  drawPonds(g, map, tb) {
    const W = map.w, H = map.h;
    const cv = this._ponds || (this._ponds = document.createElement('canvas'));
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d'), img = c.createImageData(W, H), d = img.data;
    for (const t of map.tiles) {
      if (!t.pond) continue;
      const i = (t.y * W + t.x) * 4, v = hash(t.x * 0.61, t.y * 0.37) * 18;
      d[i] = 70 + v * 0.7; d[i + 1] = 60 + v * 0.6; d[i + 2] = 44 + v * 0.4; d[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    const TWh = TW / 2, THh = TH / 2;
    g.save();
    g.setTransform(TWh, THh, -TWh, THh, this.OX, this.OY);
    if (tb) { g.beginPath(); g.rect(tb.x0, tb.y0, tb.x1 - tb.x0 + 1, tb.y1 - tb.y0 + 1); g.clip(); }
    g.imageSmoothingEnabled = true;
    g.globalCompositeOperation = 'color'; g.globalAlpha = 0.7; g.drawImage(cv, 0, 0); // (the water's reflection of the sky taken out: brown)
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 0.55; g.drawImage(cv, 0, 0);
    g.restore();
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
    this.fitMap(map);
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
    if (this.tex) {
      g.save();
      if (map.band) { g.setTransform(1, 0, 0, 1, this.OX, this.OY); this.bandPath(g, map); g.clip(); } // the valley only
      this.drawTexturedBase(g, map, S, cover);
      g.restore();
    }
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
    const C = map.w / 2, RR = this.R + 0.5;
    const c0 = iso(C - RR, C), c1 = iso(C, C - RR), c2 = iso(C + RR, C), c3 = iso(C, C + RR);
    const xt = map.extraTop || 0; // a strip of ground beyond the map's top edge (scenery: a town's towers rise against it)
    g.beginPath(); g.moveTo(c0.x, c0.y - xt); g.lineTo(c1.x, c1.y - xt); g.lineTo(c2.x, c2.y); g.lineTo(c3.x, c3.y); g.closePath();
    g.clip();
    if (map.band) { this.bandPath(g, map); g.clip(); } // the valley only

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
      if (t.off || t.rock || t.trench || t.wire || t.decor || !this.inClip(t.x, t.y, 1)) continue; // nothing off the battlefield
      const h = hash(t.x * 9.7, t.y * 4.3);
      if (!t.splinters && !((t.mud && h > 0.86) || h > 0.975)) continue; // splinters: a tree blown apart
      const p = iso(t.x + 0.3 + h * 0.4, t.y + 0.3 + t.shade * 0.4);
      this.drawProp(g, `debris${Math.floor(h * 97) % 3}${snow}`, p.x, p.y);
    }
    // scree: loose stones lying on the open ground
    for (const t of map.tiles) {
      if (t.ground !== 3 || t.off || t.trench || !this.inClip(t.x, t.y, 1)) continue;
      const h = hash(t.x * 4.1, t.y * 2.7), p = iso(t.x + 0.5 + (h - 0.5) * 0.3, t.y + 0.5 + (t.shade - 0.5) * 0.3);
      this.drawProp(g, `scree${Math.floor(h * 4) % 4}${snow}`, p.x, p.y, h > 0.5);
    }
    // trench tiles by connectivity, back to front
    const trenches = map.tiles.filter((t) => t.trench && this.inClip(t.x, t.y, 2)).sort((a, b) => a.x + a.y - (b.x + b.y) || a.x - b.x);
    for (const t of trenches) {
      const has = (dx, dy) => { const n = T(t.x + dx, t.y + dy); return n && n.trench ? 1 : 0; };
      const mask = has(0, -1) | (has(1, 0) << 1) | (has(0, 1) << 2) | (has(-1, 0) << 3);
      const p = iso(t.x + 0.5, t.y + 0.5);
      const v = Math.floor(hash(t.x * 3.3, t.y * 7.1) * 3) % 3;
      // shell damage: pre-rendered damaged (d1) and wrecked (d2) versions of the same 3D tile
      const dmg = t.dmg || 0, lvl = Math.max(1, Math.min(3, t.trench));
      const stage = dmg >= 65 ? 2 : dmg >= 25 ? 1 : 0;
      if (!(stage && this.drawProp(g, `trench_m${mask}_l${lvl}_d${stage}${snow}`, p.x, p.y))) this.drawProp(g, `trench_m${mask}_l${lvl}_v${v}${snow}`, p.x, p.y);
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
    this.fitMap(state.map);
    this.map = state.map;
    // the low sun at dawn and dusk: shadows point away from it, longer the lower it is
    // rain clouds hide the sun: a shower dims the shadows, heavy rain removes them
    const tw = this.atmo.twilight(state), overcast = Math.min(1, this.atmo.rain(state) * 1.6);
    this.sunShadow = tw.lowness > 0.02 && overcast < 0.98
      ? { angle: Math.atan2(-tw.dir[1], -tw.dir[0]), len: 30 + 140 * tw.lowness, alpha: 0.68 * tw.lowness * (1 - this.atmo.darkness(state)) * (1 - overcast) }
      : null;
    const now = performance.now();
    // craters are batched: they appear under the shell smoke, so ~0.7 s of latency is invisible
    if (!this.groundDrawn || (state.map.dirty && now - this.lastGround > 1000)) {
      this.drawGround(state.map, state.season);
      state.map.dirty = false;
      this.groundDrawn = true;
      this.lastGround = now;
    }
    const bds = [state.backdrop, ...(state.buildings || [])].filter(Boolean); // the town, and buildings standing alone
    const bd = bds[0];
    this.view = this.baseView;
    if (state.map.extraTop) this.view = { ...this.view, y0: this.view.y0 - state.map.extraTop + 2 }; // up over the strip of ground beyond the top edge
    // a level cut down to a band across the screen (a valley): the camera keeps to it
    const band = state.map.band;
    if (band) {
      this.view = this.bandRect(state.map); // exactly the map's own rectangle, so nothing beyond it ever shows
    }
    const z = this.cam.zoom, d = this.dpr;
    const sh = this.atmo.shake;
    const shx = (Math.random() - 0.5) * sh, shy = (Math.random() - 0.5) * sh;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.fillStyle = '#101215';
    ctx.fillRect(0, 0, this.vw, this.vh);
    ctx.setTransform(d * z * this.M, 0, 0, d * z, d * (this.vw / 2 - this.cam.x * z + shx), d * (this.vh / 2 - this.cam.y * z + shy));
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.ground, -this.OX, -this.OY, this.gw, this.gh);
    this.drawSurf(ctx, state.map);
    this.drawBridges(ctx, state.map, state.units);

    this.updateTracks(state);
    this.drawTracks(ctx, state);
    this.drawDecals(ctx, state);
    this.drawBuildSites(ctx, state);
    this.drawHover(ctx, state, ui);

    // depth-sorted objects
    const objs = [];
    // the long shadows of trees at dawn and dusk lie on the ground: drawn under every tree, never over one
    if (this.props && this.sunShadow && this.sunShadow.alpha >= 0.01) for (const t of state.map.tiles) {
      if (t.decor !== 'tree' && t.decor !== 'stump' && t.decor !== 'birch') continue;
      const h = hash(t.x * 2.3, t.y * 5.1), c = iso(t.x + 0.3 + t.shade * 0.4, t.y + 0.3 + h * 0.4);
      this.longShadow(ctx, c.x, c.y, t.decor === 'stump' ? 0.8 : t.decor === 'birch' ? 1.4 + (0.5 + hash(t.y * 1.7, t.x * 0.9) ** 1.5 * 0.95) * 1.2 : 2.6);
    }
    for (const t of state.map.tiles) if (t.decor) objs.push({ k: t.x + t.y + 1, kind: 'decor', t });
    for (const r of this.rockBlocks(state.map)) objs.push({ k: r.x + r.y + 2 * r.size - 1, kind: 'rock', r });
    if (state.map.giants) for (const gi of state.map.giants) objs.push({ k: gi.x + gi.y - 1, kind: 'giant', gi });
    // a town on the battlefield: sorted by its front corner, so men behind it are hidden and men in front are not
    for (const b of bds) objs.push({ k: b.x + b.y + (b.hx || 0) + (b.hy || 0) - 1, kind: 'town', bd: b });
    for (const team of [PLAYER, ENEMY]) {
      const q = state.map.hq[team];
      if (!q.hidden) objs.push({ k: q.x + q.y + 1, kind: 'hq', q, team });
      if (q.posts) for (const p of q.posts) objs.push({ k: p.x + p.y + 1, kind: 'hq', q: p, team });
      if (q.allies) for (const p of q.allies) objs.push({ k: p.x + p.y + 1, kind: 'hq', q: p, team }); // (an ally's own HQ)
    }
    // concrete MG bunkers: always drawn (their places are known); the gun and crew inside are not
    if (state.bunkers) for (const b of state.bunkers) objs.push({ k: b.x + b.y + 0.3, kind: 'bunker', b, u: state.units.find((u) => u.id === b.id) });
    for (const u of state.units) if (u.visible && !u.nest) objs.push({ k: u.onShip ? 1e6 : u.x + u.y, kind: 'unit', u }); // (a gun on a ship's deck stands on top of her)
    if (state.wrecks) for (const w of state.wrecks) objs.push({ k: w.x + w.y - 0.5, kind: 'wreck', w });
    if (state.hulks) for (const h of state.hulks) objs.push({ k: h.x + h.y, kind: 'hulk', h });
    if (state.returning) for (const b of state.returning) objs.push({ k: b.x + b.y, kind: 'back', b });
    if (state.floaters) for (const f of state.floaters) objs.push({ k: f.x + f.y - 0.8, kind: 'float', f });
    objs.sort((a, b) => a.k - b.k);
    for (const o of objs) {
      if (o.kind === 'decor') this.drawDecor(ctx, o.t);
      else if (o.kind === 'hq') this.drawHQ(ctx, state, o.q, o.team);
      else if (o.kind === 'rock') this.drawRock(ctx, o.r);
      else if (o.kind === 'giant') { const c = iso(o.gi.x, o.gi.y); this.drawFrame(ctx, this.propGroup(), `giant${o.gi.v}${(this.S ?? 1) > 0.7 ? '_s' : ''}`, c.x, c.y, 1, o.gi.m); }
      else if (o.kind === 'town') this.drawBackdrop(ctx, o.bd);
      else if (o.kind === 'float') { // floating in the sea, bobbing, sinking from sight at the end
        const f = o.f, c = iso(f.x, f.y), age = state.time - f.t, a = Math.min(1, age / 0.6) * Math.min(1, (f.life - age) / 6);
        ctx.globalAlpha = Math.max(0, a);
        const bob = Math.sin(state.time * 1.3 + f.t) * 1.1;
        if (f.kind === 'body') this.drawFrame(ctx, 'soldiers-uk', `float_v${f.v}_d${f.d}`, c.x, c.y + bob, 1.35, f.m);
        else this.drawFrame(ctx, this.propGroup(), `boat_piece${f.v}`, c.x, c.y + bob, 1, f.m);
        ctx.globalAlpha = 1;
      }
      else if (o.kind === 'back') { const c = iso(o.b.x, o.b.y), f = Math.floor((state.time * 1.6 + o.b.t) % 4); this.drawFrame(ctx, this.propGroup(), `boat_back_r${f}`, c.x, c.y + Math.sin(state.time * 1.7 + o.b.t) * 1.2, 1); }
      else if (o.kind === 'hulk') this.drawHulk(ctx, o.h, state.time);
      else if (o.kind === 'wreck') { const c = iso(o.w.x, o.w.y); this.drawFrame(ctx, this.propGroup(), o.w.v === 'empty' ? 'boat_empty' : `boat${o.w.v}`, c.x, c.y, 1, o.w.v === 'empty'); }
      else if (o.kind === 'bunker') this.drawBunker(ctx, o.b, o.u, state.time, ui.selected.has(o.b.id));
      else if (o.u.deck) { ctx.save(); ctx.translate(0, -o.u.deck); this.drawUnit(ctx, o.u, ui.selected.has(o.u.id), state.time); ctx.restore(); } // up on a ship's deck
      else this.drawUnit(ctx, o.u, ui.selected.has(o.u.id), state.time);
    }

    this.drawBarrageMarkers(ctx, state);
    if (state.marker && state.marker.x !== undefined) this.drawStoryMarker(ctx, state.marker, performance.now() / 1000);
    if (state.markers) for (const m of state.markers) this.drawStoryMarker(ctx, m, performance.now() / 1000);
    this.drawHqHold(ctx, state);
    this.drawShells(ctx, state);
    this.drawThrownBodies(ctx, state, false); // jolted bodies stay low, under the smoke
    this.drawEffects(ctx, state);
    this.drawThrownBodies(ctx, state, true); // pieces fly out of it
    this.atmo.drawWorld(ctx, state);

    // screen-space overlays
    ctx.setTransform(d, 0, 0, d, 0, 0);
    this.atmo.drawScreen(ctx, state, this);
    this.drawBarks(ctx, state);
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

  /** Speech bubbles over units that just answered the player (screen space, so they stay legible at any zoom). */
  drawBarks(ctx, state) {
    const v = this.voices;
    if (!v || !v.barks.length) return;
    const now = performance.now() / 1000, LIFE = 2.4;
    v.barks = v.barks.filter((b) => now - b.t < LIFE);
    ctx.font = 'italic 13px Georgia, "Times New Roman", serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (const b of v.barks) {
      const u = state.units.find((x) => x.id === b.id);
      if (!u || u.dead) continue;
      const age = now - b.t;
      const a = Math.min(1, age / 0.12) * Math.min(1, (LIFE - age) / 0.5);
      const p = this.mapToScreen(u.x, u.y, 26 + age * 3);
      const w = ctx.measureText(b.text).width + 14, h = 22;
      const x = Math.round(Math.max(4, Math.min(this.vw - w - 4, p.x - w / 2))), y = Math.round(p.y - h - 8);
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(236, 228, 206, 0.93)';
      ctx.strokeStyle = 'rgba(40, 34, 24, 0.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x + 0.5, y + 0.5, w, h, 6); else ctx.rect(x + 0.5, y + 0.5, w, h);
      ctx.fill(); ctx.stroke();
      // tail pointing at the unit
      const tx = Math.max(x + 8, Math.min(x + w - 8, p.x));
      ctx.beginPath();
      ctx.moveTo(tx - 5, y + h); ctx.lineTo(tx, y + h + 7); ctx.lineTo(tx + 5, y + h);
      ctx.fill();
      ctx.beginPath(); ctx.moveTo(tx - 5, y + h + 0.5); ctx.lineTo(tx, y + h + 7); ctx.lineTo(tx + 5, y + h + 0.5); ctx.stroke();
      ctx.fillStyle = '#2a241a';
      ctx.fillText(b.text, x + 7, y + h / 2 + 1);
    }
    ctx.globalAlpha = 1;
  }

  /** The fallen: 3D-rendered bodies in 6 poses x 8 directions (older saves: the 2-view dead pose). */
  /** The tutorial's target marker: a pulsing ring on the ground with a short label. */
  /**
   * The marker over whatever is pointed out (a target, a place in the opening tour): a glowing amber chevron
   * pointing down at it, bobbing gently (as assets/ui/marker.svg). y: the chevron's point; s: its size.
   */
  drawChevron(ctx, x, y, s, time) {
    const b = Math.sin(time * 3.2) * 3 * s;
    const pts = [[-22, -26], [0, 0], [22, -26], [13, -26], [0, -12], [-13, -26]].map(([px, py]) => [x + px * s, y + b + py * s]);
    const path = () => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const q of pts.slice(1)) ctx.lineTo(q[0], q[1]); ctx.closePath(); };
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(255, 150, 30, 0.95)'; ctx.shadowBlur = 14 * s;
    path(); ctx.fillStyle = 'rgba(255, 170, 40, 0.22)'; ctx.fill();
    ctx.strokeStyle = '#ffae2a'; ctx.lineWidth = 3.4 * s; ctx.stroke();
    ctx.shadowBlur = 0; ctx.strokeStyle = '#fff0a0'; ctx.lineWidth = 1.2 * s; ctx.stroke();
    ctx.restore();
  }

  drawStoryMarker(ctx, m, time) {
    const p = iso(m.x, m.y), k = (time * 1.2) % 1;
    this.drawChevron(ctx, p.x, p.y - (m.strong ? 58 : 26), m.strong ? 1.1 : 0.7, time);
    ctx.save();
    if (m.strong) { // a place being pointed out (the chevron marks it): its name above
      ctx.font = 'italic 17px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(0,0,0,0.8)'; this.wtext(ctx, m.label || '', p.x + 1, p.y - 97);
      ctx.fillStyle = '#ffe9b8'; this.wtext(ctx, m.label || '', p.x, p.y - 98);
      ctx.restore();
      return;
    }
    if (m.label) {
      ctx.font = 'italic 12px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; this.wtext(ctx, m.label, p.x + 1, p.y - 51);
      ctx.fillStyle = '#fff3d6'; this.wtext(ctx, m.label, p.x, p.y - 52);
    }
    ctx.restore();
  }

  drawDecals(ctx, state) {
    for (const b of state.decals) {
      const age = state.time - b.t;
      if (b.fly && age < b.fly.dur) continue; // still in the air: drawn by drawThrownBodies
      const a = age < 100 ? 1 : Math.max(0, 1 - (age - 100) / 40);
      if (a <= 0) continue;
      const p = iso(b.x, b.y);
      ctx.globalAlpha = a * 0.92;
      const nat = b.nation || (this.nations && this.nations[b.team]);
      if (!b.part) this.drawBloodPool(ctx, b, age, a);
      if (b.fall && age < b.fall.dur && age >= 0 && this.drawFalling(ctx, nat, b, p.x, p.y, age)) continue;
      if (this.drawCorpse(ctx, nat, b, p.x, p.y)) {
        // a puff of dirt where a thrown body lands
        const since = b.fly ? age - b.fly.dur : 9;
        if (since < 0.6) {
          const k = since / 0.6;
          ctx.globalAlpha = (1 - k) * 0.45;
          ctx.fillStyle = '#5b5148';
          const r = b.part ? 0.45 : 1;
          ctx.beginPath(); ctx.ellipse(p.x, p.y - 2 - k * 4, (8 + k * 14) * r, (3 + k * 5) * r, 0, 0, TAU); ctx.fill();
        }
        continue;
      }
      if (b.part) continue; // pieces without sprites aren't worth a placeholder
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(((b.dir ?? b.view ?? 0) - 3.5) * 0.3);
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

  /**
   * A man shot down: 5 pre-rendered frames from standing to lying, ending on his corpse sprite.
   * Machine-gun hits jerk him as the burst strikes, before he goes down.
   */
  drawFalling(ctx, nat, b, x, y, age) {
    if (!this.hasArmy(nat)) return false;
    const FRAMES = 6, k = age / b.fall.dur;
    // the fall speeds up as he goes over
    const f = Math.min(FRAMES - 1, Math.floor(Math.pow(k, 0.8) * FRAMES));
    let jx = 0;
    if (b.fall.mg && k < 0.45) jx = Math.sin(age * 90) * 1.6 * (1 - k / 0.45); // struck by the burst
    return this.drawFrame(ctx, 'soldiers-' + nat, `fall_v${b.fall.k ?? b.v}_d${b.dir}_f${f}`, x + jx, y, 1.35);
  }

  /** Blood under a body: a small pool that spreads for a few seconds, red at first, soon dried brown. */
  drawBloodPool(ctx, b, age, alpha) {
    const start = b.fall ? b.fall.dur * 0.7 : 0.3;
    const g = Math.min(1, Math.max(0, (age - start) / 6));
    if (g <= 0) return;
    const r = (b.bleed || 1) * (0.2 + 0.5 * Math.sqrt(g));
    const hd = ((b.dir ?? 0) * Math.PI) / 4; // centred on his chest: a little towards the head
    const c = iso(b.x + Math.cos(hd) * 0.22, b.y + Math.sin(hd) * 0.22);
    const sh = hash(b.x * 3.1, b.y * 7.7);
    const col = bloodColour(age - start);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = `rgba(${col}, 0.38)`;
    ctx.beginPath(); ctx.ellipse(c.x, c.y, 10 * r, 4.5 * r, (sh - 0.5) * 0.8, 0, TAU); ctx.fill();
    ctx.fillStyle = `rgba(${col}, 0.42)`;
    ctx.beginPath(); ctx.ellipse(c.x + (sh - 0.5) * 5 * r, c.y + 1, 5.5 * r, 2.5 * r, (0.5 - sh) * 0.6, 0, TAU); ctx.fill();
    ctx.restore();
  }

  /** One body sprite (anchored on the ground at x, y). */
  drawCorpse(ctx, nat, b, x, y) {
    if (!this.hasArmy(nat)) return false;
    if (b.part) return this.drawFrame(ctx, 'soldiers-' + nat, `part_${b.part}_d${b.part === 'helmet' ? 0 : b.dir}`, x, y, 1.35);
    if (b.v != null && this.drawFrame(ctx, 'soldiers-' + nat, `corpse_v${b.v}_d${b.dir}`, x, y, 1.35)) return true;
    const v = b.view ?? (b.dir ?? 0) % 4; // older saves / sprite sheets without corpses
    return this.drawSoldier(ctx, nat, 'dead', 0, [1, 0, -1, 0][v], [0, -1, 0, 1][v], x, y);
  }

  /** Shell bursts: bodies jolted a short way, and torn pieces thrown high, tumbling, to where they land. */
  drawThrownBodies(ctx, state, pieces) {
    const UP = 39.2; // screen px per tile of height
    for (const b of state.decals) {
      if (!b.fly || !!b.part !== pieces) continue;
      const age = state.time - b.t, f = b.fly;
      if (age >= f.dur || age < 0) continue;
      const u = age / f.dur;
      const x = f.x0 + (b.x - f.x0) * u, y = f.y0 + (b.y - f.y0) * u, z = 4 * f.h * u * (1 - u);
      const p = iso(x, y);
      // shadow on the ground, smaller and fainter the higher the body is
      ctx.globalAlpha = 0.32 * (1 - 0.5 * z / Math.max(0.01, f.h));
      ctx.fillStyle = '#000';
      const sw = b.part ? 4 : 9; // a piece casts a smaller shadow than a body
      ctx.beginPath(); ctx.ellipse(p.x, p.y, Math.max(1.5, sw - z * 1.5), Math.max(0.8, sw * 0.38 - z * 0.5), 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.translate(p.x, p.y - z * UP - 6);
      ctx.rotate(f.spin * age);
      const nat = b.nation || (this.nations && this.nations[b.team]);
      if (!this.drawCorpse(ctx, nat, b, 0, 6)) {
        ctx.fillStyle = UNIFORM_DARK[b.team];
        ctx.beginPath(); ctx.ellipse(0, 0, b.part ? 3 : 6, b.part ? 1.2 : 2.2, 0, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
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
    if (x < 0 || y < 0 || x >= state.map.w || y >= state.map.h) return;
    const ht = state.map.tiles[Math.floor(y) * state.map.w + Math.floor(x)];
    if (ht && ht.off) return; // no cursor off the battlefield
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
      const name = t.decor === 'stump' ? `stump${Math.floor(h * 4) % 4}` : t.decor === 'tree' ? `tree${Math.floor(h * 2) % 2}` : t.decor === 'birch' ? `birch${Math.floor(h * 6) % 6}` : `log${Math.floor(h * 3) % 3}`;
      if (t.decor === 'birch') { // birches of every size, from saplings to old trees
        const k = 0.5 + hash(t.y * 1.7, t.x * 0.9) ** 1.5 * 0.95;
        // swaying in the wind: each tree bends from its foot in its own rhythm, gusts rolling across the
        // field (a shear of the sprite about its ground anchor, larger for the slender young ones)
        const now = performance.now() / 1000, ph = hash(t.x * 0.7, t.y * 1.3) * TAU;
        const E = this.R + 0.5, C2 = 2 * this.R + 1, ext = this._gustExt || (this._gustExt = { q0: -E * TW / 2 - 0.5 * (C2 + E) * TH / 2, q1: E * TW / 2 - 0.5 * (C2 - E) * TH / 2 }); // (screen x - y/2 over the battlefield: left .. right)
        const gust = this.atmo ? this.atmo.gustAt(c.x, c.y, ext) : 0; // a gust rolling across, or calm
        const young = 1.25 - k * 0.35; // slender young trees move more
        const sway = (0.005 + 0.05 * gust) * young;
        const lean = gust * (0.06 + 0.075 * (k - 0.5)); // in a gust the tree bends over with it: the big ones most (their crowns catch the wind)
        // a slow, gentle sway (about one swing every five seconds), the same pace in a gust, only wider; the
        // tree leans over with the gust and the leaves stir a little
        const shear = lean + sway * Math.sin(now * (1.1 + hash(t.y, t.x) * 0.35) + ph) + 0.004 * gust * Math.sin(now * 2.3 + ph * 2);
        ctx.save(); ctx.translate(c.x, c.y); ctx.transform(1, 0, -shear, 1, 0, 0);
        const ok = this.drawFrame(ctx, this.propGroup(), name + snow, 0, 0, k, hash(t.x, t.y * 2.3) > 0.5);
        ctx.restore();
        if (ok) return;
      } else if (this.drawProp(ctx, name + snow, c.x, c.y)) return;
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

  /**
   * Planks a gun crew has laid over a trench so its battery can cross: boards spanning the trench along
   * the way the guns cross (axis 1: along x, 2: along y), side by side, with a pair of bearers under them.
   */
  drawBridges(ctx, map, units = []) {
    if (!map.bridges) map.bridges = map.tiles.filter((t) => t.bridge).map((t) => ({ x: t.x, y: t.y, axis: t.bridge }));
    const snow = (this.S ?? 1) > 0.7 ? '_s' : '';
    // planks a crew is laying now: they appear board by board as the work goes on
    for (const u of units) {
      if (u.dead || !u.bridging || u.bridging.t < 0.5) continue;
      const b = u.bridging, c = iso(b.x + 0.5, b.y + 0.5);
      ctx.globalAlpha = Math.min(1, (b.t - 0.5) / (b.dur - 0.5));
      this.drawFrame(ctx, this.propGroup(), `bridge_${b.axis === 1 ? 'x' : 'y'}${snow}`, c.x, c.y, 1);
      ctx.globalAlpha = 1;
    }
    for (const b of map.bridges) {
      const cx = b.x + 0.5, cy = b.y + 0.5, along = b.axis === 1, Lh = 0.42, n = 7, w = 0.075, Z = 1.5;
      // the pre-rendered planks (as the trenches); the drawing below only until the sprite sheet has loaded
      const c0 = iso(cx, cy);
      if (this.drawFrame(ctx, this.propGroup(), `bridge_${along ? 'x' : 'y'}${snow}`, c0.x, c0.y, 1)) continue;
      const P = (a, c) => { const p = along ? iso(cx + a, cy + c) : iso(cx + c, cy + a); return { x: p.x, y: p.y - Z }; };
      // bearers: two beams under the ends of the boards, resting on the ground either side
      ctx.fillStyle = '#3b2a1c';
      for (const a of [-Lh + 0.04, Lh - 0.04]) { const p0 = P(a, -0.3), p1 = P(a, 0.3); ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.lineTo(p1.x, p1.y + 2); ctx.lineTo(p0.x, p0.y + 2); ctx.closePath(); ctx.fill(); }
      for (let i = 0; i < n; i++) {
        const c = -0.27 + (i * 0.54) / (n - 1), j = (Math.sin(b.x * 7.1 + b.y * 3.3 + i * 2.7) * 0.5 + 0.5);
        const q = [P(-Lh - j * 0.04, c - w / 2), P(Lh + (1 - j) * 0.04, c - w / 2), P(Lh + (1 - j) * 0.04, c + w / 2), P(-Lh - j * 0.04, c + w / 2)];
        ctx.fillStyle = ['#54473a', '#5e4f3f', '#4d4135', '#625444'][i % 4]; // weathered, muddy boards
        ctx.beginPath(); q.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(25,18,12,0.55)'; ctx.lineWidth = 0.6; ctx.stroke();
      }
    }
  }

  /** Load a backdrop's picture (a pre-rendered town seen through the game's camera). */
  loadBackdrop(bd) {
    if (!bd || bd.prop) return Promise.resolve(); // (a prop is in the atlas)
    this.backdrops = this.backdrops || {};
    if (!this.backdrops[bd.img]) this.backdrops[bd.img] = retry(() => loadImage(bd.img)).then((im) => { this.backdrops[bd.img].img = im; return im; }).catch(() => null);
    return this.backdrops[bd.img];
  }

  /** The outline of a valley level's ground: the band, out to the back of its rock wall. */
  bandPath(g, map) {
    const y0 = (map.w - (map.bandBack || map.band)) * TH / 2, y1 = (map.w + map.band) * TH / 2;
    g.beginPath(); g.rect(-1e4, y0, 2e4, y1 - y0);
  }

  /** A town standing on the battlefield (pre-rendered through the game's camera and light). */
  drawBackdrop(ctx, bd) {
    if (bd.prop) { const c = iso(bd.x, bd.y); this.drawFrame(ctx, this.propGroup(), bd.prop, c.x, c.y, 1); return; } // pre-rendered with the props (a ship)
    const e = this.backdrops && this.backdrops[bd.img], im = e && e.img;
    if (!im) { this.loadBackdrop(bd); return; }
    const c = iso(bd.x, bd.y);
    ctx.drawImage(im, c.x - bd.ax * bd.k, c.y - bd.ay * bd.k, im.width * bd.k, im.height * bd.k);
  }

  /**
   * The rock tiles gathered into boulders: wherever a 3x3 or 2x2 block of tiles is all rock it becomes one
   * great boulder, the rest single ones. Worked out once per map (rock is never destroyed).
   */
  rockBlocks(map) {
    const n = map.tiles.reduce((c, t) => c + (t.rock ? 1 : 0), 0);
    if (this._rocks && this._rocks.map === map && this._rocks.n === n) return this._rocks.list;
    const W = map.w, used = new Uint8Array(W * map.h), list = [];
    const free = (x, y, k) => x < W && y < map.h && map.tiles[y * W + x].rock && !map.tiles[y * W + x].hidden && !used[y * W + x] && (k === undefined || !!map.tiles[y * W + x].knoll === k);
    const block = (x, y, z) => { const k = !!map.tiles[y * W + x].knoll; for (let j = 0; j < z; j++) for (let i = 0; i < z; i++) if (!free(x + i, y + j, k)) return false; return true; };
    const take = (x, y, z) => { for (let j = 0; j < z; j++) for (let i = 0; i < z; i++) used[(y + j) * W + x + i] = 1; list.push({ x, y, size: z, v: Math.floor(hash(x * 1.3, y * 2.1) * 3), knoll: !!map.tiles[y * W + x].knoll }); };
    // the big ones first, at scattered places, then the middling ones, then whatever is left
    for (const [z, p] of [[3, 0.9], [2, 0.95]]) for (let y = 0; y < map.h; y++) for (let x = 0; x < W; x++) if (hash(x * 0.7 + z, y * 1.9) < p && block(x, y, z)) take(x, y, z);
    for (let y = 0; y < map.h; y++) for (let x = 0; x < W; x++) if (free(x, y)) take(x, y, 1);
    this._rocks = { map, n, list };
    return list;
  }

  /** A snow-capped Alpine boulder (pre-rendered) over its block of rock tiles. */
  drawRock(ctx, r) {
    const h = hash(r.x * 3.7, r.y * 1.9), c = iso(r.x + r.size / 2 + (h - 0.5) * 0.15, r.y + r.size / 2 + (hash(r.y, r.x) - 0.5) * 0.15);
    const snow = (this.S ?? 1) > 0.7 ? '_s' : '';
    // jagged crags and rounded boulders mixed, as they fall in the mountains; or a knoll of dwarf pine
    const kind = r.knoll ? 'knoll' : hash(r.x * 2.9 + 1.7, r.y * 5.3) < 0.42 ? 'round' : 'boulder';
    const dry = this.map && this.map.dry && kind !== 'knoll' ? '_d' : ''; // (a dry, snowless country: Gallipoli)
    if (this.drawFrame(ctx, this.propGroup(), `${kind}${r.size}_${r.v}${dry || snow}`, c.x, c.y, 1.22 + h * 0.2, h > 0.5)) return;
    if (this.drawFrame(ctx, this.propGroup(), `boulder${r.size}_${r.v}${snow}`, c.x, c.y, 1.22 + h * 0.2, h > 0.5)) return;
    if (this.drawFrame(ctx, this.propGroup(), `rock${r.v}${snow}`, c.x, c.y, (1.4 + h * 0.35) * r.size, h > 0.5)) return;
    ctx.fillStyle = '#77736b'; // fallback: a plain grey boulder
    ctx.beginPath(); ctx.ellipse(c.x, c.y - 10 * r.size, 22 * r.size, 16 * r.size, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e6eaf0'; ctx.beginPath(); ctx.ellipse(c.x - 3, c.y - 20 * r.size, 12 * r.size, 6 * r.size, 0, 0, TAU); ctx.fill();
  }

  /**
   * A concrete machine-gun pillbox: an octagonal blockhouse with a slab roof, firing slits all round
   * and a ring of sandbags at its foot. Wrecked once its gun is silenced: blackened, the roof cracked
   * and slumped, rubble about it, smoke curling out of the slits.
   */
  drawBunker(ctx, b, u, time, selected) {
    const live = u && !u.dead;
    // the pre-rendered pillbox (intact or wrecked), as the trenches are
    const c = iso(b.x, b.y), snow = (this.S ?? 1) > 0.7 ? '_s' : '';
    const K = 1.4; // drawn larger than life so it reads as the objective (as the HQ)
    if (this.drawFrame(ctx, this.propGroup(), 'bunker' + (live ? '' : '_x') + snow, c.x, c.y, K)) {
      const UP = 39.2 * K; // screen px per world unit of height
      if (live && u.visible && u.firing > 0) { // a flash at a slit when the gun fires
        const f = iso(b.x + (-0.36 + Math.random() * 0.1) * K, b.y + 0.1 * K);
        ctx.fillStyle = 'rgba(255,220,120,0.95)';
        ctx.beginPath(); ctx.arc(f.x, f.y - 0.17 * UP, 2.5 + Math.random() * 2.5, 0, TAU); ctx.fill();
      }
      if (live && selected) { ctx.strokeStyle = 'rgba(220,230,150,0.9)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(c.x, c.y, 60, 29, 0, 0, TAU); ctx.stroke(); }
      if (!live) { // smoke still curling out of the breach
        for (let i = 0; i < 4; i++) {
          const k = (time * 0.2 + i / 4) % 1, m = iso(b.x + 0.25 * K, b.y + 0.1 * K);
          ctx.fillStyle = `rgba(60,58,54,${0.35 * (1 - k)})`;
          ctx.beginPath(); ctx.arc(m.x + k * 12 + Math.sin(k * 5 + i) * 3, m.y - 0.3 * UP - k * 34, 3 + k * 9, 0, TAU); ctx.fill();
        }
      }
      return;
    }
    const R = 0.66, H = 22, RR = R * 1.1, T = 4;
    const P = (dx, dy, z = 0) => { const p = iso(b.x + dx, b.y + dy); return { x: p.x, y: p.y - z }; };
    const ring = (r, n = 8, rot = Math.PI / 8) => Array.from({ length: n }, (_, k) => { const a = rot + (k * TAU) / n; return [Math.cos(a) * r, Math.sin(a) * r]; });
    const poly = (pts) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); };
    const shade = (nx, ny, base) => { const k = 0.78 - 0.28 * ((nx - ny) / Math.SQRT2); return `rgb(${Math.round(base[0] * k)},${Math.round(base[1] * k)},${Math.round(base[2] * k)})`; };
    const conc = live ? [148, 144, 134] : [88, 82, 74];
    ctx.save();
    // shadow and the sandbag ring at the foot
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    const c0 = P(0.1, 0.1);
    ctx.beginPath(); ctx.ellipse(c0.x, c0.y, 40, 19, 0, 0, TAU); ctx.fill();
    const bags = ring(R * 1.28, 18, 0);
    const drawBags = (front) => bags.forEach(([x, y], i) => {
      if ((x + y > 0) !== front) return;
      const p = P(x, y, 2);
      ctx.fillStyle = live ? (i % 2 ? '#7d6e55' : '#6f614a') : (i % 2 ? '#4f4739' : '#463f33');
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 8, 4, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(30,24,16,0.5)'; ctx.lineWidth = 0.8; ctx.stroke();
    });
    drawBags(false);
    // walls: the faces turned towards the viewer, far ones first
    const base = ring(R), slump = live ? 0 : 1;
    const faces = base.map((a, i) => { const c = base[(i + 1) % 8]; const nx = (a[0] + c[0]) / 2, ny = (a[1] + c[1]) / 2; return { a, c, nx, ny }; })
      .filter((f) => f.nx + f.ny > 0.01).sort((p, q) => (p.nx + p.ny) - (q.nx + q.ny));
    const zTop = (x, y) => H - slump * Math.max(0, (x - y)) * 5; // a wrecked roof sags to one side
    for (const f of faces) {
      const pa = P(f.a[0], f.a[1]), pc = P(f.c[0], f.c[1]);
      const ta = P(f.a[0], f.a[1], zTop(f.a[0], f.a[1])), tc = P(f.c[0], f.c[1], zTop(f.c[0], f.c[1]));
      poly([pa, pc, tc, ta]); ctx.fillStyle = shade(f.nx, f.ny, conc); ctx.fill();
      ctx.strokeStyle = 'rgba(40,38,34,0.55)'; ctx.lineWidth = 0.7; ctx.stroke();
      // the firing slit
      const s1 = (k, z) => P(f.a[0] + (f.c[0] - f.a[0]) * k, f.a[1] + (f.c[1] - f.a[1]) * k, z);
      poly([s1(0.22, H - 7), s1(0.78, H - 7), s1(0.78, H - 4), s1(0.22, H - 4)]);
      ctx.fillStyle = '#16130f'; ctx.fill();
      // weathering streaks below it
      ctx.strokeStyle = 'rgba(60,56,48,0.25)'; ctx.lineWidth = 1;
      for (const k of [0.3, 0.55, 0.7]) { const t1 = s1(k, H - 4), t2 = s1(k, 3); ctx.beginPath(); ctx.moveTo(t1.x, t1.y); ctx.lineTo(t2.x, t2.y); ctx.stroke(); }
    }
    drawBags(true);
    // the roof slab: its edge, then its top
    const top = ring(RR);
    const zR = (x, y) => zTop(x * R / RR, y * R / RR);
    for (let i = 0; i < 8; i++) {
      const a = top[i], c = top[(i + 1) % 8], nx = (a[0] + c[0]) / 2, ny = (a[1] + c[1]) / 2;
      if (nx + ny <= 0.01) continue;
      poly([P(a[0], a[1], zR(a[0], a[1])), P(c[0], c[1], zR(c[0], c[1])), P(c[0], c[1], zR(c[0], c[1]) + T), P(a[0], a[1], zR(a[0], a[1]) + T)]);
      ctx.fillStyle = shade(nx, ny, conc.map((v) => v * 0.92)); ctx.fill();
    }
    poly(top.map(([x, y]) => P(x, y, zR(x, y) + T)));
    const g = ctx.createLinearGradient(P(-RR, -RR, H).x, P(-RR, -RR, H).y, P(RR, RR, H).x, P(RR, RR, H).y);
    g.addColorStop(0, live ? '#ada99e' : '#6e665c'); g.addColorStop(1, live ? '#85817a' : '#4a443d');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(40,38,34,0.6)'; ctx.lineWidth = 0.8; ctx.stroke();
    // earth and turf thrown over the roof as camouflage
    const mid = P(0, 0, H + T);
    ctx.fillStyle = live ? 'rgba(96,84,60,0.55)' : 'rgba(40,34,28,0.6)';
    ctx.beginPath(); ctx.ellipse(mid.x - 3, mid.y + 1, 17, 7, 0, 0, TAU); ctx.fill();
    if (live) {
      // the gun's muzzle flash at a slit when it fires
      if (u.visible && u.firing > 0) {
        const fl = P(-0.2 + Math.random() * 0.4, R * 0.95, H - 5.5);
        ctx.fillStyle = 'rgba(255,220,120,0.95)';
        ctx.beginPath(); ctx.arc(fl.x, fl.y, 2.5 + Math.random() * 2.5, 0, TAU); ctx.fill();
      }
      if (selected) { ctx.strokeStyle = 'rgba(220,230,150,0.9)'; ctx.lineWidth = 1.5; const p = P(0, 0); ctx.beginPath(); ctx.ellipse(p.x, p.y, 46, 22, 0, 0, TAU); ctx.stroke(); }
    } else {
      // cracks, rubble, and smoke from the slits
      ctx.strokeStyle = 'rgba(20,16,12,0.85)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(mid.x - 20, mid.y - 2); ctx.lineTo(mid.x - 6, mid.y + 3); ctx.lineTo(mid.x + 4, mid.y - 3); ctx.lineTo(mid.x + 18, mid.y + 4); ctx.stroke();
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4 + b.x, r = R * (1.1 + (i % 3) * 0.18), p = P(Math.cos(a) * r, Math.sin(a) * r, 1);
        ctx.fillStyle = i % 2 ? '#5d564d' : '#77706a';
        ctx.beginPath(); ctx.ellipse(p.x, p.y, 3 + (i % 3), 2, a, 0, TAU); ctx.fill();
      }
      for (let i = 0; i < 4; i++) {
        const k = (time * 0.2 + i / 4) % 1;
        ctx.fillStyle = `rgba(60,58,54,${0.35 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(mid.x + k * 12 + Math.sin(k * 5 + i) * 3, mid.y - 6 - k * 34, 3 + k * 9, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }

  /**
   * A headquarters being held for the victory (state.hqHold: since when, per side; hqHoldFor: how long it must be
   * held): the headquarters picked out by a pulsing ring, and above it a meter filling up with the seconds to go -
   * gold when it is the enemy's we hold, red when he holds ours.
   */
  drawHqHold(ctx, state) {
    const hold = state.hqHold;
    if (!hold) return;
    const now = performance.now() / 1000;
    for (const team of [PLAYER, ENEMY]) {
      if (hold[team] === null || hold[team] === undefined) continue;
      const need = (state.hqHoldFor && state.hqHoldFor[team]) || 5, k = Math.max(0, Math.min(1, (state.time - hold[team]) / need));
      const hq = state.map.hq[1 - team], col = team === PLAYER ? [240, 200, 96] : [235, 80, 60];
      const rgba = (a) => `rgba(${col[0]},${col[1]},${col[2]},${a})`;
      for (const q of [hq, ...(hq.posts || [])]) {
        if (q.hidden) continue;
        const c = iso(q.x + 0.5, q.y + 0.5), pulse = 0.5 + 0.5 * Math.sin(now * 6);
        // the ring on the ground round it
        ctx.lineWidth = 3; ctx.strokeStyle = rgba(0.55 + 0.35 * pulse);
        ctx.beginPath(); ctx.ellipse(c.x, c.y, 62 + pulse * 6, 31 + pulse * 3, 0, 0, TAU); ctx.stroke();
        ctx.lineWidth = 1.2; ctx.strokeStyle = rgba(0.3);
        ctx.beginPath(); ctx.ellipse(c.x, c.y, 74, 37, 0, 0, TAU); ctx.stroke();
        // the meter above it: a dial filling clockwise, the seconds left in the middle
        const mx = c.x, my = c.y - 96, R = 17;
        ctx.fillStyle = 'rgba(12,10,8,0.78)'; ctx.beginPath(); ctx.arc(mx, my, R + 5, 0, TAU); ctx.fill();
        ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.beginPath(); ctx.arc(mx, my, R, 0, TAU); ctx.stroke();
        ctx.strokeStyle = rgba(0.95); ctx.beginPath(); ctx.arc(mx, my, R, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
        ctx.font = 'bold 15px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f4ead2';
        this.wtext(ctx, String(Math.max(0, Math.ceil(need * (1 - k)))), mx, my + 1);
        ctx.font = 'bold 9px sans-serif'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = rgba(1);
        this.wtext(ctx, team === PLAYER ? 'HOLD THE HQ' : 'RETAKE OUR HQ', mx, my - R - 9);
      }
    }
  }

  drawHQ(ctx, state, q, team) {
    const S = this.S ?? 1;
    const c = iso(q.x + 0.5, q.y + 0.5);
    const owner = tileAt(state.map, q.x, q.y).owner;
    const f = teamDir(team);
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
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; this.wtext(ctx, q.label || 'HQ', c.x + 0.5, c.y + 34.5);
      ctx.fillStyle = '#e8e8e0'; this.wtext(ctx, q.label || 'HQ', c.x, c.y + 34);
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
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; this.wtext(ctx, 'HQ', c.x + 12.5, c.y + 0.5);
    ctx.fillStyle = '#e8e8e0'; this.wtext(ctx, 'HQ', c.x + 12, c.y);
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
      if (u.type === 'tank') { // a tank's tracks: a segment of both treads for every quarter tile it rolls
        if (d < 0.25) continue;
        (this.tankTracks || (this.tankTracks = [])).push({ x0: p.x, y0: p.y, x1: u.x, y1: u.y, t: state.time });
        if (this.tankTracks.length > 2400) this.tankTracks.splice(0, this.tankTracks.length - 2400);
        p.x = u.x; p.y = u.y;
        continue;
      }
      if (d < 0.45) continue;
      tr.push({ x: u.x, y: u.y, ang: Math.atan2(u.y - p.y, u.x - p.x), t: state.time, w: u.type === 'artillery' ? 2 : 1 });
      p.x = u.x; p.y = u.y;
    }
    if (tr.length > 1600) tr.splice(0, tr.length - 1600);
  }
  drawTracks(ctx, state) {
    this.drawTankTracks(ctx, state);
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

  /**
   * The ruts a tank leaves: two bands of churned earth, the imprint of each tread plate across them, laid flat
   * on the ground (in map space) along its path; they fade slowly over some minutes.
   */
  drawTankTracks(ctx, state) {
    const T = this.tankTracks;
    if (!T || !T.length) return;
    const snow = (this.S ?? 1) > 0.2, LIFE = 360, GAUGE = 0.36, W = 0.24;
    const map = state.map, trench = (x, y) => { const q = tileAt(map, x, y); return !!(q && q.trench); };
    const base = ctx.getTransform();
    ctx.transform(TW / 2, TH / 2, -TW / 2, TH / 2, 0, 0); // map tiles
    for (const k of T) {
      const age = state.time - k.t;
      if (age > LIFE || age < 0) continue;
      const a = (1 - age / LIFE) ** 0.7;
      const dx = k.x1 - k.x0, dy = k.y1 - k.y0, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
      for (const side of [-1, 1]) {
        const cx = k.x0 + nx * GAUGE * side, cy = k.y0 + ny * GAUGE * side;
        // no ruts across a trench: there the tread spans the gap in the air (nor in one dug since)
        if (trench(cx, cy) || trench(cx + dx / 2, cy + dy / 2) || trench(cx + dx, cy + dy)) continue;
        // the band, a little darker at its edges
        // a ridge of churned earth thrown up along each side, catching the light
        ctx.strokeStyle = snow ? `rgba(236,240,246,${0.22 * a})` : `rgba(150,130,100,${0.16 * a})`; ctx.lineWidth = 0.05;
        ctx.beginPath();
        for (const e of [-1, 1]) { const ex = cx + nx * e * W * 0.62, ey = cy + ny * e * W * 0.62; ctx.moveTo(ex, ey); ctx.lineTo(ex + dx, ey + dy); }
        ctx.stroke();
        ctx.fillStyle = snow ? `rgba(60,66,78,${0.24 * a})` : `rgba(14,9,5,${0.28 * a})`;
        ctx.beginPath();
        ctx.moveTo(cx + nx * W / 2, cy + ny * W / 2); ctx.lineTo(cx + nx * W / 2 + dx, cy + ny * W / 2 + dy);
        ctx.lineTo(cx - nx * W / 2 + dx, cy - ny * W / 2 + dy); ctx.lineTo(cx - nx * W / 2, cy - ny * W / 2); ctx.closePath(); ctx.fill();
        // the imprints of the tread plates, across the band
        ctx.strokeStyle = snow ? `rgba(30,34,44,${0.3 * a})` : `rgba(4,2,1,${0.34 * a})`; ctx.lineWidth = 0.04;
        ctx.beginPath();
        for (let s2 = 0.04; s2 < L; s2 += 0.09) { const px = cx + ux * s2, py = cy + uy * s2; ctx.moveTo(px + nx * W * 0.45, py + ny * W * 0.45); ctx.lineTo(px - nx * W * 0.45, py - ny * W * 0.45); }
        ctx.stroke();
      }
    }
    ctx.setTransform(base);
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

  drawSoldier(ctx, nation, poseName, frame, hx, hy, x, y, at, variant = 0) {
    const { view, mirror } = Renderer.viewFor(hx, hy);
    // a man in a trench is drawn whole, standing down in it: the trench's near edge hides his lower body
    const clipped = at && poseName[0] === 't' && this.trenchMask(ctx, at.x, at.y);
    // units are drawn slightly larger than life for legibility; a colour variant where the pose has one
    const name = `${poseName}${frame}_${view}`;
    const ok = (variant && this.drawFrame(ctx, 'soldiers-' + nation, `${name}_v${variant}`, x, y, 1.35, mirror)) || this.drawFrame(ctx, 'soldiers-' + nation, name, x, y, 1.35, mirror);
    if (clipped) ctx.restore();
    return ok;
  }

  /** The nearest point to (mx, my) inside the trench channel (the trench tile nearest it, or the unit's own). */
  inChannel(mx, my, ux, uy) {
    const map = this.map, tr = (x, y) => { const q = tileAt(map, x, y); return q && q.trench ? q : null; };
    let t = tr(mx, my);
    if (!t) {
      let bd = Infinity;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const q = tr(mx + dx, my + dy);
        if (q) { const d = Math.hypot(q.x + 0.5 - mx, q.y + 0.5 - my); if (d < bd) { bd = d; t = q; } }
      }
      t = t || tr(ux, uy);
      if (!t) return { x: mx, y: my };
    }
    // the channel: the middle of the tile, running on to whichever sides the trench continues
    const H = 0.14, cx = t.x + 0.5, cy = t.y + 0.5, o = (dx, dy) => !!tr(t.x + dx + 0.5, t.y + dy + 0.5);
    let x = Math.min(cx + (o(1, 0) ? 0.5 : H), Math.max(cx - (o(-1, 0) ? 0.5 : H), mx));
    let y = Math.min(cy + (o(0, 1) ? 0.5 : H), Math.max(cy - (o(0, -1) ? 0.5 : H), my));
    // and not out in the corners of the tile beside a bend: in an arm, keep to that arm's middle
    if (Math.abs(x - cx) > H && Math.abs(y - cy) > H) { if (Math.abs(x - cx) > Math.abs(y - cy)) y = cy + Math.sign(y - cy) * H; else x = cx + Math.sign(x - cx) * H; }
    return { x, y };
  }

  /**
   * Clip away what lies below a trench edge (as the camera sees it): the edge runs along a tile side at
   * `dist` tiles from the man at map (mx, my) in the axis direction (dx, dy), which must face the camera
   * (+x or +y). Raised by the parapet. Returns true having saved the context (the caller restores it).
   */
  edgeMask(ctx, mx, my, dx, dy, dist) {
    const px = mx + dx * dist, py = my + dy * dist, ex = -dy * 6, ey = dx * 6, LIFT = 1.8;
    const a = iso(px - ex, py - ey), b = iso(px + ex, py + ey);
    ctx.save();
    ctx.beginPath(); ctx.moveTo(a.x, a.y - LIFT); ctx.lineTo(b.x, b.y - LIFT); ctx.lineTo(b.x, b.y - 2000); ctx.lineTo(a.x, a.y - 2000); ctx.closePath(); ctx.clip();
    return true;
  }

  /**
   * Clip to what can be seen of a man standing in the trench at map (mx, my): everything below the
   * trench's near rims (its sides facing the camera, at +x and +y, where the trench does not run on)
   * is hidden behind the parapet. Returns true if it saved the context (the caller restores it).
   */
  trenchMask(ctx, mx, my) {
    const map = this.map, t = map && tileAt(map, mx, my);
    if (!t || !t.trench) return false;
    const open = (dx, dy) => { const n = tileAt(map, t.x + dx, t.y + dy); return !!(n && n.trench); };
    // the trench's top edge, as the trench tiles model it: 0.22 each side of the centre line at the floor, the
    // walls sloping out to the rim (hasty works most); the spoil of the parapet rises ~2 px above the rim
    const W = 0.22 + ([0, 0.08, 0.015, 0][t.trench] || 0), LIFT = t.trench === 3 ? 0.8 : 1.8;
    const rims = [];
    if (!open(0, 1)) rims.push([iso(t.x - 5, t.y + 0.5 + W), iso(t.x + 6, t.y + 0.5 + W)]); // the +y side
    if (!open(1, 0)) rims.push([iso(t.x + 0.5 + W, t.y + 6), iso(t.x + 0.5 + W, t.y - 5)]); // the +x side
    // the trench turns or branches towards the camera on both sides (+x and +y) but not between them: the
    // block of ground inside the bend stands between the man and the camera, hiding him below its corner
    const corner = open(1, 0) && open(0, 1) && !open(1, 1);
    if (!rims.length && !corner) return false;
    ctx.save();
    for (const [a, b] of rims) { // keep the half-plane above each rim line (raised to the parapet's top)
      a.y -= LIFT; b.y -= LIFT;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(b.x, b.y - 2000); ctx.lineTo(a.x, a.y - 2000); ctx.closePath(); ctx.clip();
    }
    if (corner) { // keep everything but the wedge below the block's near corner: its two edges run down-left and down-right
      const c = iso(t.x + 0.5 + W, t.y + 0.5 + W), L = 400;
      c.y -= LIFT;
      ctx.beginPath(); ctx.moveTo(c.x - L, c.y - 4000); ctx.lineTo(c.x + L, c.y - 4000); ctx.lineTo(c.x + L, c.y + L / 2); ctx.lineTo(c.x, c.y); ctx.lineTo(c.x - L, c.y + L / 2); ctx.closePath(); ctx.clip();
    }
    return true;
  }

  /** A tank (pre-rendered from its 3D model, 8 headings), rocking a little on the move; nose-down when ditched. */
  /**
   * A tank knocked out: its hull left where it died, scorched dark, smoke rising from it (thick at first, a thin
   * wisp after a few minutes), and DESTROYED over it.
   */
  /** A soft, ragged billow of smoke (made once): mid-grey, its edges broken up with noise, for tinting and stacking. */
  smokePuff() {
    if (this._puff) return this._puff;
    // a billow: a cluster of soft lumps (each a radial gradient), lit from above so it has some body
    const N = 128, c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d');
    for (let k = 0; k < 14; k++) {
      const a = hash(k * 1.3, 4.1) * Math.PI * 2, r = hash(k * 2.7, 1.9) * N * 0.22;
      const x = N / 2 + Math.cos(a) * r, y = N / 2 + Math.sin(a) * r * 0.8, rr = N * (0.13 + hash(k * 0.9, 7.7) * 0.13);
      const lit = 0.75 + 0.25 * Math.max(0, -Math.sin(a)); // (the upper lumps catch the light)
      const gr = g.createRadialGradient(x - rr * 0.25, y - rr * 0.3, rr * 0.1, x, y, rr);
      const v = Math.round(150 * lit);
      gr.addColorStop(0, `rgba(${v},${v - 4},${v - 10},0.55)`); gr.addColorStop(0.6, `rgba(${v - 25},${v - 28},${v - 32},0.32)`); gr.addColorStop(1, `rgba(${v - 40},${v - 42},${v - 45},0)`);
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
    }
    return (this._puff = c);
  }

  drawHulk(ctx, h, time) {
    const p = iso(h.x, h.y), dir = ((Math.round(Math.atan2(h.hy, h.hx) / (Math.PI / 4)) % 8) + 8) % 8;
    ctx.save();
    // its shadow on the ground, as when it was running
    ctx.save(); ctx.translate(p.x, p.y + (h.ditched ? 7 : 0)); ctx.transform(TW / 2, TH / 2, -TW / 2, TH / 2, 0, 0); ctx.rotate(dir * Math.PI / 4); ctx.scale(1.25, 0.72);
    ctx.fillStyle = 'rgba(8,6,4,0.5)'; ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill(); ctx.restore();
    if (h.ditched) { ctx.translate(p.x, p.y); ctx.rotate(0.1 * (dir < 4 ? 1 : -1)); ctx.translate(-p.x, -p.y); }
    ctx.filter = 'brightness(0.42) sepia(0.5) saturate(0.6) contrast(1.1)'; // (burnt out)
    const ok = this.drawFrame(ctx, 'units', `tank_d${dir}_f0`, p.x, p.y + 3 + (h.ditched ? 7 : 0), 1);
    ctx.filter = 'none';
    if (!ok) { ctx.fillStyle = '#2a2620'; ctx.beginPath(); ctx.ellipse(p.x, p.y - 12, 40, 20, 0, 0, TAU); ctx.fill(); }
    ctx.restore();
    // smoke: a column of soft, ragged billows - oily black at the hull, greying and spreading as it rises and leans
    // with the wind, thinning over the minutes
    const age = Math.max(0, time - h.t), thick = Math.max(0.3, 1 - age / 240), wind = (this.atmo.wind && this.atmo.wind.x) || 0.3;
    const puff = this.smokePuff(), seed = h.x * 7.31 + h.y * 3.17;
    ctx.save();
    for (let i = 0; i < 30; i++) {
      const r1 = hash(seed + i * 1.7, i * 3.9), r2 = hash(i * 5.3, seed + 2.1), life = 5.5 + r1 * 3;
      const k = ((time + r2 * life) / life) % 1; // 0 at the hull, 1 dissipated
      const rise = k * (85 + r1 * 30), drift = (wind * 1.4 + 0.25) * k * k * 70;
      const curl = Math.sin(k * 6 + r2 * 9 + time * 0.35) * (3 + k * 10);
      const x = p.x + 2 + (r2 - 0.5) * 10 + drift + curl, y = p.y - 24 - rise;
      const size = (7 + k * 34) * (0.75 + r1 * 0.5);
      const a = thick * (k < 0.1 ? k / 0.1 : 1) * (1 - k) ** 1.6 * 0.8;
      const g = Math.round(30 + k * 80 + r1 * 16); // (from near-black to a dirty grey)
      if (a < 0.01) continue;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.filter = `brightness(${(g / 128).toFixed(2)})`;
      ctx.translate(x, y); ctx.rotate(r2 * 6.28 + k * (r1 - 0.5) * 2);
      ctx.drawImage(puff, -size, -size * 0.85, size * 2, size * 1.7);
      ctx.restore();
    }
    ctx.restore();
    if (age < 25) { // still burning: a soft, flickering glow in the hull, under the smoke
      const f = (1 - age / 25) * (0.55 + 0.45 * hash(Math.floor(time * 12), seed));
      const fg = ctx.createRadialGradient(p.x + 2, p.y - 24, 0, p.x + 2, p.y - 24, 16);
      fg.addColorStop(0, `rgba(255,190,90,${0.7 * f})`); fg.addColorStop(0.45, `rgba(240,110,30,${0.35 * f})`); fg.addColorStop(1, 'rgba(200,60,10,0)');
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = fg; ctx.beginPath(); ctx.ellipse(p.x + 2, p.y - 24, 16, 10, 0, 0, TAU); ctx.fill(); ctx.restore();
    }
    ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(0,0,0,0.75)'; this.wtext(ctx, 'DESTROYED', p.x + 0.5, p.y - 59.5);
    ctx.fillStyle = h.team === PLAYER ? '#ff8a6a' : '#d9ccb2'; this.wtext(ctx, 'DESTROYED', p.x, p.y - 60);
  }

  drawTank(ctx, p, u, t, selected, time) {
    // its weight on the ground: a dark soft shadow right under the hull, the shape of its footprint (laid flat
    // in map space along its heading), so it sits on the earth rather than hovering over it
    {
      const dir8 = ((Math.round(Math.atan2(u.hy, u.hx) / (Math.PI / 4)) % 8) + 8) % 8;
      ctx.save();
      ctx.translate(p.x, p.y + (u.stuck === 'ditched' ? 7 : 0));
      ctx.transform(TW / 2, TH / 2, -TW / 2, TH / 2, 0, 0); // map tiles
      ctx.rotate(dir8 * Math.PI / 4);
      ctx.scale(1.25, 0.72); // half its length, half its width (tiles)
      const g = ctx.createRadialGradient(0, 0, 0.2, 0, 0, 1);
      g.addColorStop(0, 'rgba(8,6,4,0.62)'); g.addColorStop(0.7, 'rgba(8,6,4,0.42)'); g.addColorStop(1, 'rgba(8,6,4,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill();
      ctx.restore();
    }
    if (selected) { ctx.strokeStyle = 'rgba(160,255,110,0.95)'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.ellipse(p.x, p.y, 52, 26, 0, 0, TAU); ctx.stroke(); }
    const dir = ((Math.round(Math.atan2(u.hy, u.hx) / (Math.PI / 4)) % 8) + 8) % 8;
    // the tracks run while it moves (4 pre-rendered positions of the tread links), still when it stops
    const frame = (4 - (Math.floor((u.roll || 0) * 36) % 4)) % 4; // (stepping back through the phases: the belts run the way it drives)
    const rock = 0;
    const sink = (u.stuck === 'ditched' ? 7 : 0) + 3; // (settled a little into the earth)
    ctx.save();
    if (u.stuck === 'ditched') { ctx.translate(p.x, p.y); ctx.rotate(0.1 * (dir < 4 ? 1 : -1)); ctx.translate(-p.x, -p.y); }
    const ok = this.drawFrame(ctx, 'units', `tank_d${dir}_f${frame}`, p.x, p.y + rock + sink, 1);
    ctx.restore();
    if (!ok) { ctx.fillStyle = '#4a4436'; ctx.beginPath(); ctx.ellipse(p.x, p.y - 12, 40, 20, 0, 0, TAU); ctx.fill(); }
    if (u.stuck === 'broken' && Math.floor(time * 2 + u.seed * 5) % 3 === 0) { ctx.fillStyle = 'rgba(70,70,72,0.35)'; ctx.beginPath(); ctx.arc(p.x + 6, p.y - 44 - (time * 12 % 14), 7, 0, TAU); ctx.fill(); } // smoke from the engine
    // strength (it is a direct hit or nothing), shells and machine-gun rounds, and what is wrong with it
    const by = p.y - 58;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(p.x - 18, by, 36, 7);
    ctx.fillStyle = '#e8c35a'; ctx.fillRect(p.x - 17, by + 1, 34 * Math.max(0, (u.shells || 0) / t.shells), 2);
    ctx.fillStyle = '#c9c4b2'; ctx.fillRect(p.x - 17, by + 4, 34 * Math.max(0, (u.mgRounds || 0) / t.mgRounds), 2);
    const label = u.stuck === 'ditched' ? 'DITCHED' : u.stuck === 'broken' ? 'BROKEN DOWN' : !(u.shells > 0) && !(u.mgRounds > 0) ? 'NO AMMUNITION' : '';
    if (label) { ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffb060'; this.wtext(ctx, label, p.x, by - 2); }
  }

  /** Howitzer from the supplied art: a faces -x, b faces +y; mirrored for -y / +x. */
  /** Heading a gun is drawn with: trail-first while being moved, otherwise laid on its target. */
  static gunHeading(u) { return Renderer.travelling(u) ? [-u.hx, -u.hy] : [u.aimX ?? u.hx, u.aimY ?? u.hy]; }
  /** A battery on the move (limbered: trail lifted, barrel down), from limbering up until it stops. */
  static travelling(u) { return !!u.order && !(u.packing > 0); }

  /** Pre-rendered 3D howitzer: 8 directions, wheels turning while it moves. */
  drawGun3D(ctx, p, u, time) {
    const [hx, hy] = Renderer.gunHeading(u);
    const dir = ((Math.round(Math.atan2(hy, hx) / (Math.PI / 4)) % 8) + 8) % 8;
    // 2 spoke-passes per second while moving: smooth rolling without wagon-wheel strobing
    const frame = u.moving ? Math.floor(time * 16 + u.seed * 8) % 8 : 0;
    const recoil = u.firing > 0 && !u.moving ? u.firing * 0.08 : 0;
    const q = iso(u.x - hx * recoil, u.y - hy * recoil);
    const travel = Renderer.travelling(u);
    return (travel && this.drawFrame(ctx, 'units', `gun_t_d${dir}_f${frame}`, q.x, q.y, 1.5)) || this.drawFrame(ctx, 'units', `gun_d${dir}_f${frame}`, q.x, q.y, 1.5);
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

  /** A thin wisp of cigarette smoke rising and drifting from a smoking man (k: his seed). */
  drawSmokeWisp(ctx, x, y, age, k) {
    for (let i = 0; i < 3; i++) {
      const t = age - i * 0.45;
      if (t < 0 || t > 2.2) continue;
      const a = 0.22 * (1 - t / 2.2);
      ctx.fillStyle = `rgba(205, 205, 200, ${a})`;
      ctx.beginPath();
      ctx.arc(x + 2 + t * 4 + Math.sin(t * 3 + k * 9) * 1.5, y - 3 - t * 7, 1.2 + t * 1.6, 0, TAU);
      ctx.fill();
    }
  }

  /**
   * A long shadow cast by the low dawn / dusk sun, away from it, from a ground point (world px).
   * height: the caster's height (a tree about 2.6). Only trees and stumps cast them.
   */
  longShadow(ctx, x, y, height = 1) {
    const sh = this.sunShadow;
    if (!sh || sh.alpha < 0.01) return;
    const len = sh.len * height, w = 4 + height * 2;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(sh.angle);
    const g = ctx.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, `rgba(20,14,30,${sh.alpha})`);
    g.addColorStop(1, 'rgba(20,14,30,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(len * 0.48, 0, len * 0.52, w, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }

  drawUnit(ctx, u, selected, time) {
    const t = UNIT_TYPES[u.type];
    const p = iso(u.x, u.y);
    if (u.afloat) { // rowed in to the beach: the men in their boat
      if (selected) { ctx.strokeStyle = 'rgba(160,255,110,0.95)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.ellipse(p.x, p.y, 30, 14, 0, 0, TAU); ctx.stroke(); }
      const bob = Math.sin(time * 1.7 + u.id) * 1.2;
      const stroke = Math.floor((time * 2.2 + u.id * 0.37) % 4); // all hands at the oars
      if (this.drawFrame(ctx, this.propGroup(), `boat${u.id % 3}_r${stroke}`, p.x, p.y + bob, 1) || this.drawFrame(ctx, this.propGroup(), `boat${u.id % 3}`, p.x, p.y + bob, 1)) return;
    }
    if (u.type === 'tank') { this.drawTank(ctx, p, u, t, selected, time); return; }
    if (selected) {
      ctx.strokeStyle = 'rgba(160,255,110,0.95)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 22, 11, 0, 0, TAU); ctx.stroke();
    }
    const dir = teamDir(u.team);
    const charging = !!(u.order && u.order.kind === 'charge');
    // pinned men keep moving by crawling; otherwise walk, or run when charging
    const climbing = !!u.climb;
    const pose = climbing ? 'tclimb' : u.inTrench && !u.overTop ? (u.moving ? 'twalk' : 'trench') : u.pinned ? (u.moving ? 'crawl' : 'prone') : charging ? 'charge' : u.order ? 'walk' : 'stand';
    const moving = u.moving && pose !== 'trench';
    const hsh = (k, j) => { const v = Math.sin(u.seed * 1000 + k * 12.9898 + j * 78.233) * 43758.5453; return v - Math.floor(v); };
    const men = [];
    const count = u.type === 'artillery' ? u.men : u.men;
    // a squad opens out on the move (wider still at the charge) and closes up again when it halts, smoothly
    const spreadTo = moving && u.type === 'rifle' && pose !== 'twalk' ? (pose === 'charge' ? 1.9 : 1.7) : 1; // in a trench they keep close
    const sdt = Math.min(0.5, Math.max(0, time - (u._spT ?? time)));
    u._spT = time;
    if (!u.climb) u._sp = (u._sp ?? spreadTo) + (spreadTo - (u._sp ?? spreadTo)) * Math.min(1, sdt * 1.5); // held while climbing
    else u._sp = u._sp ?? spreadTo;
    const SP = u._sp;
    // the squad's lines stand square to where it is going (towards the enemy at rest); while it climbs in
    // or out of a trench they square up to the edge being crossed, so both lines run along the trench.
    // The formation turns smoothly, not in a jump.
    // on the move the lines square up to the map axis nearest the heading (trench edges run along the axes),
    // so a climb needs no last-moment turn; during a climb the formation is held still
    const axis = (hx, hy) => (Math.abs(hx) >= Math.abs(hy) ? (hx >= 0 ? 0 : Math.PI) : (hy >= 0 ? Math.PI / 2 : -Math.PI / 2));
    const want = u.climb ? axis(u.climb.hx ?? u.hx, u.climb.hy ?? u.hy) : u.order ? axis(u.hx || dir, u.hy || 0) : (dir > 0 ? 0 : Math.PI);
    if (u._fa === undefined) u._fa = want;
    let da = want - u._fa; da = Math.atan2(Math.sin(da), Math.cos(da));
    if (!u.climb) u._fa += da * Math.min(1, sdt * 4);
    const fx = Math.cos(u._fa), fy = Math.sin(u._fa);
    for (let i = 0; i < count; i++) {
      const col = i % 3, row = Math.floor(i / 3); // rifle squads: two ranks of three
      const jx = Math.sin(u.seed * 100 + i * 7.3) * 0.06, jy = Math.cos(u.seed * 77 + i * 3.1) * 0.06;
      let ox, oy;
      if (u.type === 'artillery') {
        const [gx, gy] = Renderer.gunHeading(u);
        const CREW = [[-0.25, 0.42], [-0.25, -0.42], [-0.6, 0.34], [-0.6, -0.34], [-0.95, 0.24], [-0.95, -0.24]];
        const [cf, cs] = CREW[i % CREW.length];
        ox = gx * cf - gy * cs; oy = gy * cf + gx * cs;
        if (u.bridging) { // laying planks: the crew lines the trench edge on the gun's side, facing the trench
          const b = u.bridging, cx = b.x + 0.5, cy = b.y + 0.5, along = b.axis === 1;
          const side = along ? Math.sign(u.x - cx) || 1 : Math.sign(u.y - cy) || 1;
          const back = 0.42 + Math.floor(i / 3) * 0.18, lat = ((i % 3) - 1) * 0.24;
          const tx = along ? cx + side * back : cx + lat, ty = along ? cy + lat : cy + side * back;
          ox = tx - u.x; oy = ty - u.y;
        }
      }
      else if (u.type === 'mg') { ox = -dir * (0.1 + (i % 2) * 0.12); oy = (Math.floor(i / 2) - 0.5) * 0.22 + 0.15; }
      else { const a = (0.5 - row) * 0.24 * SP, b = (col - 1) * 0.2 * SP; ox = fx * a - fy * b; oy = fy * a + fx * b; }
      // climbing: each man's footing stays put (where the climb began; where it ends, getting in) and his
      // climbing animation alone carries him over the parapet, while the unit itself moves on
      const cb = u.climb && u.climb.x0 !== undefined ? u.climb : null;
      const bx = cb ? cb.x0 + (cb.out ? 0 : cb.hx * CLIMB_D) : u.x, by = cb ? cb.y0 + (cb.out ? 0 : cb.hy * CLIMB_D) : u.y;
      let mx = bx + ox + jx, my = by + oy + jy;
      // in a trench every man stands in the trench itself: a place in the formation that falls outside the
      // channel (beside a bend, or beyond its walls) is brought to the nearest point inside it
      if ((pose === 'trench' || pose === 'twalk') && this.map) ({ x: mx, y: my } = this.inChannel(mx, my, u.x, u.y));
      if (moving && u.type !== 'artillery' && !cb) {
        // loose order on the move: each man weaves a little and keeps his own place in the file;
        // a charge turns into a ragged rush with men surging ahead and falling behind
        const run = pose === 'charge', crawl = pose === 'crawl';
        const lat = Math.sin(time * (run ? 1.5 : 0.9) + i * 1.7 + u.seed * 9) * (run ? 0.07 : 0.045);
        const lag = (hsh(i, 1) - 0.5) * (run ? 0.42 : crawl ? 0.2 : 0.12) + Math.sin(time * (run ? 1.1 : 0.6) + i * 2.3) * (run ? 0.06 : 0.025);
        mx += -u.hy * lat + u.hx * lag; my += u.hx * lat + u.hy * lag;
      }
      // gun and MG crews walk to where their work puts them (round the gun, at a trench edge, on the march),
      // rather than jumping there
      let walkTo = null;
      if (u.type === 'artillery' || u.type === 'mg') {
        const crew = u._crew || (u._crew = []);
        let c = crew[i];
        if (!c || Math.hypot(c.x - mx, c.y - my) > 3) c = crew[i] = { x: mx, y: my, roll: 0 };
        const dx = mx - c.x, dy = my - c.y, dd = Math.hypot(dx, dy), stepLen = Math.min(dd, 1.1 * sdt);
        if (dd > 1e-4) { c.x += (dx / dd) * stepLen; c.y += (dy / dd) * stepLen; c.roll += stepLen; }
        if (dd > 0.05) walkTo = { hx: dx / dd, hy: dy / dd, roll: c.roll };
        mx = c.x; my = c.y;
      }
      const s = iso(mx, my);
      s.k = i; s.fx = ox; s.fy = oy; s.mx = mx; s.my = my; s.walkTo = walkTo;
      men.push(s);
    }
    men.sort((a, b) => a.y - b.y);
    // which turn each group has in a climb: the group furthest along the way the unit is going goes first
    const climbOrder = (u, men, g) => {
      if (!u._order || u._order.t !== u.climb) {
        const sums = {};
        for (const m of men) {
          const gg = u.type === 'rifle' ? Math.floor(m.k / 3) : u.type === 'mg' ? m.k % 2 : Math.floor(m.k / 2);
          (sums[gg] ||= []).push(m.fx * u.hx + m.fy * u.hy);
        }
        const ranked = Object.keys(sums).map(Number).sort((a, b) => (sums[b].reduce((x, y) => x + y, 0) / sums[b].length) - (sums[a].reduce((x, y) => x + y, 0) / sums[a].length) || a - b);
        u._order = { t: u.climb, at: Object.fromEntries(ranked.map((gg, i) => [gg, i])) };
      }
      return u._order.at[g] ?? 0;
    };
    const phase = time * (charging ? 14 : 9) + u.seed * 10;
    const nation = u.nation || (this.nations && this.nations[u.team]);
    const useSpr = this.hasArmy(nation);
    let gunDrawn = u.type !== 'artillery';
    const drawGunNow = () => { if (!gunDrawn) { gunDrawn = true; if (!this.drawGun3D(ctx, p, u, time) && !this.drawGunArt(ctx, p, u)) this.drawGun(ctx, p, u, time); } };
    if (!useSpr) drawGunNow();
    const carried = u.type === 'mg' && u.order && !(u.packing > 0); // on the move the gun and tripod are on the men's shoulders
    if (u.type === 'mg' && !carried) {
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
      // Steps advance with ground actually covered (so men slow their stride in wire and mud) rather than
      // on a clock; each man has his own phase and a slightly different stride, so a squad never marches in lockstep.
      const GAIT = { walk: [8, 0.55], twalk: [8, 0.55], charge: [8, 1.0], crawl: [6, 0.3] };
      // idle moments only when nothing is happening: no target, not digging, not shot at, guns at rest
      const quiet = (u.type === 'rifle' || u.type === 'artillery') && !u.target && !u.digging && !u.order && !(u.firing > 0)
        && (u.suppression || 0) < 15 && !(u.type === 'artillery' && (u.barrage || u.cooldown > 0));
      men.forEach((s, i) => {
        // under planks laid over the trench a man is hidden by the boards; firing he shows himself, and
        // goes out of sight again over a second or so after the last shot
        ctx.globalAlpha = 1;
        if (u.inTrench && this.map) {
          const bt = tileAt(this.map, s.mx, s.my);
          if (bt && bt.bridge) {
            const since = time - (u.lastShot ?? -1e9), seen = u.firing > 0 ? 1 : Math.max(0, Math.min(1, 1 - (since - 0.25) / 1.3));
            if (seen <= 0.02) return;
            ctx.globalAlpha = seen;
          }
        }
        if (s.y >= p.y) drawGunNow(); // crew behind the gun first, the rest in front
        let pn = pose, fr = 0;
        // every man his own: a worn or faded uniform (helmet and all), and his own way of carrying his rifle on the march
        const cv = hsh(s.k, 21), vr = cv < 0.4 ? 0 : cv < 0.7 ? 1 : 2;
        if (climbing) {
          // over the parapet (frames forwards) or down into the trench (backwards), rank by rank: the rank
          // nearer where the squad is going first, the other after it; each man a little apart from his mates
          // the groups that climb in turn: a rifle squad's ranks, an MG team's pairs, a battery crew's pairs
          const group = u.type === 'rifle' ? Math.floor(s.k / 3) : u.type === 'mg' ? s.k % 2 : Math.floor(s.k / 2);
          const R = u.climb.rank || u.climb.dur, start = R * 0.8 * climbOrder(u, men, group);
          const k = Math.max(0, Math.min(0.999, (u.climb.t - start) / R + (hsh(s.k, 5) - 0.5) * 0.15));
          const f = Math.floor((u.climb.out ? k : 1 - k) * 8);
          // the trench edge he is crossing lies along a tile side: w points from him to it (ahead of him
          // climbing out; behind him climbing in, when he lowers himself down facing the wall he came over)
          let wx = u.climb.hx, wy = u.climb.hy;
          if (wx === undefined) { const ax = Math.abs(u.hx) >= Math.abs(u.hy); wx = ax ? Math.sign(u.hx) || 1 : 0; wy = ax ? 0 : Math.sign(u.hy) || 1; }
          if (!u.climb.out) { wx = -wx; wy = -wy; }
          // down in the trench (the first frames) a wall hides his legs: the edge he is climbing if it is the one
          // nearer the camera (+x / +y), otherwise the trench's other wall, behind him; on top, nothing does
          let clipped = false;
          if (f <= 4) {
            const ct = { x: u.climb.tx + 0.5, y: u.climb.ty + 0.5 }, tt = this.map && tileAt(this.map, ct.x, ct.y);
            if (wx + wy > 0) { // climbing the camera-side edge: the trench's real rim there, or just ahead of a man already at it
              const W = 0.22 + ((tt && [0, 0.08, 0.015, 0][tt.trench]) || 0);
              const rim = wx ? ct.x + W : ct.y + W, me = wx ? s.mx : s.my;
              clipped = this.edgeMask(ctx, s.mx, s.my, wx, wy, Math.max(0.1, rim - me));
            } else clipped = this.trenchMask(ctx, ct.x, ct.y); // climbing the far edge: the near wall behind him, as when standing in it
          }
          const ok = this.drawSoldier(ctx, nation, 'tclimb', f, wx, wy, s.x, s.y, null, vr);
          if (clipped) ctx.restore();
          if (ok) return;
        }
        const g = GAIT[pose];
        if (g) {
          const k = s.k, cyc = (u.roll || 0) / (g[1] * (0.92 + 0.16 * hsh(k, 2))) + hsh(k, 3);
          fr = Math.floor((cyc - Math.floor(cyc)) * g[0]) % g[0];
          if (carried && pose === 'walk') pn = s.k === 0 ? 'carrymg' : s.k === 1 ? 'carrytri' : 'walk'; // the gun and its tripod carried
          if (pn === 'walk') { const st = hsh(s.k, 23); pn = st < 0.5 ? 'walk' : st < 0.75 ? 'walks' : 'walkt'; }
        }
        // a crewman still on his way to his place walks there (unless the whole unit is on the move anyway)
        if (s.walkTo && !u.moving && !u.inTrench) {
          const cyc = s.walkTo.roll / 0.55 + hsh(s.k, 3);
          if (this.drawSoldier(ctx, nation, 'walk', Math.floor((cyc - Math.floor(cyc)) * 8) % 8, s.walkTo.hx, s.walkTo.hy, s.x, s.y, null, vr)) return;
        }
        if (u.type === 'artillery' && u.bridging) { // at the trench edge, laying the planks
          const b = u.bridging, along = b.axis === 1, fx2 = along ? Math.sign(b.x + 0.5 - s.mx) : 0, fy2 = along ? 0 : Math.sign(b.y + 0.5 - s.my);
          if (this.drawSoldier(ctx, nation, 'mgwork', Math.floor(time * 3 + s.k * 1.3) % 4, fx2 || 1, fy2, s.x, s.y, null, vr)) return;
        }
        // setting the gun up, or taking it down: the team kneels round it, hands busy at the mounting
        if ((u.type === 'mg' || u.type === 'artillery') && !u.inTrench && (u.packing > 0 || u.bridging || (u.setup > 0 && !u.order))) {
          const l = Math.hypot(s.fx, s.fy) || 1;
          if (this.drawSoldier(ctx, nation, 'mgwork', Math.floor(time * 3 + s.k * 1.3) % 4, -s.fx / l, -s.fy / l, s.x, s.y)) return;
        }
        else if (pose === 'stand') {
          if (u.digging && i % 2 === 0) { pn = 'dig'; fr = Math.floor(phase / 2 + i) % 2; }
          else if (u.type === 'mg') pn = 'prone';
          else if (u.target && (u.firing > 0 || u.type === 'rifle')) {
            pn = 'fire';
            // the shot and the bolt: 1 the kick, 2 bolt drawn back, 3 bolt home, 0 aiming (each man a little apart)
            const ph = (u.fireTimer || 0) / (t.fireInterval || 1) + (hsh(s.k, 9) - 0.5) * 0.12;
            fr = u.firing > 0 ? 1 : ph > 0.72 ? 2 : ph > 0.5 ? 3 : 0;
          }
        }
        // a battery in action: the loader stoops for a shell, lifts it and rams it home; an ammunition number
        // brings up the next; as the gun fires the whole crew crouches with their hands over their ears
        if (u.type === 'artillery' && u.barrage && !u.order && !(u.setup > 0) && pn !== 'trench') {
          const bt = u.barrage.timer;
          let gp = null, gf = 0;
          if (u.firing > 0 || bt < 0.5) gp = 'ears';
          else if (s.k === 0) { gp = 'gunload'; gf = bt > 4 ? 0 : bt > 3 ? 1 : bt > 1.8 ? 2 : 3; }
          else if (s.k === 2) { gp = 'gunload'; gf = bt > 3.5 ? 1 : 0; }
          if (gp) {
            const l = Math.hypot(s.fx, s.fy) || 1, toGun = gp === 'gunload';
            if (this.drawSoldier(ctx, nation, gp, gf, toGun ? -s.fx / l : u.hx, toGun ? -s.fy / l : u.hy, s.x, s.y)) return;
          }
        }
        // a quiet moment: now and then a man smokes, cleans his rifle or wipes his helmet
        const idle = (pn === 'stand' || pn === 'trench') && quiet ? idleAt(s.k, time) : null;
        // at rest each man faces his own way (mostly towards the enemy, some to the sides, the odd one
        // behind), turning now and then; anything to shoot at turns them all back to the front
        let hx = u.hx, hy = u.hy;
        // closing up after a halt: each man walks (not glides) in to his place in the ranks
        const closing = u.type === 'rifle' && pn === 'stand' && !moving && SP > 1.03;
        if (closing && Math.hypot(s.fx, s.fy) > 0.08) {
          const l = Math.hypot(s.fx, s.fy);
          const cyc = time * 1.1 + hsh(s.k, 3);
          if (!this.drawSoldier(ctx, nation, 'walk', Math.floor((cyc - Math.floor(cyc)) * 8) % 8, -s.fx / l, -s.fy / l, s.x, s.y)) drawMan(ctx, s.x, s.y, u.team, 'walk', u.facing, phase + i * 1.7, false);
          return;
        }
        if (quiet && (pn === 'stand' || pn === 'trench') && u.type === 'rifle') {
          const slot = Math.floor(time / 25 + hsh(s.k, 7) * 4), r = hsh(s.k, 11 + slot);
          if (r > 0.4 && r <= 0.68) { hx = -u.hy; hy = u.hx; } else if (r > 0.68 && r <= 0.94) { hx = u.hy; hy = -u.hx; } else if (r > 0.94) { hx = -u.hx; hy = -u.hy; }
        }
        if (idle && this.drawSoldier(ctx, nation, (pn === 'trench' ? 't' : '') + idle.anim, idle.frame, hx, hy, s.x, s.y, { x: s.mx, y: s.my }, vr)) {
          if (idle.anim === 'smoke' && idle.puff > 0) this.drawSmokeWisp(ctx, s.x, s.y - (pn === 'trench' ? 7 : 20), idle.puff, s.k);
          return;
        }
        if (!this.drawSoldier(ctx, nation, pn, fr, hx, hy, s.x, s.y, { x: s.mx, y: s.my }, vr)
          && !((pn === 'walks' || pn === 'walkt') && this.drawSoldier(ctx, nation, 'walk', fr, hx, hy, s.x, s.y, null, vr))) drawMan(ctx, s.x, s.y, u.team, pose === 'crawl' ? 'prone' : pose, u.facing, phase + i * 1.7, false);
      });
      ctx.globalAlpha = 1;
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

    // setting up / packing up: a ring fills above the team, with what it is doing
    if ((u.type === 'mg' || u.type === 'artillery') && u.visible !== false && (u.packing > 0 || u.bridging || (u.setup > 0 && !u.order))) {
      const packing = u.packing > 0, gun = u.type === 'artillery', bridging = !packing && !!u.bridging;
      const k = bridging ? u.bridging.t / u.bridging.dur : packing ? 1 - u.packing / (gun ? GUN_LIMBER : MG_PACK) : 1 - u.setup / (t.setup || 1);
      const cx = p.x, cy = p.y - 44;
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(cx, cy, 6, 0, TAU); ctx.stroke();
      ctx.strokeStyle = packing ? '#c9b98f' : '#e8c35a';
      ctx.beginPath(); ctx.arc(cx, cy, 6, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0.02, Math.min(1, k))); ctx.stroke();
      ctx.font = '9px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      const label = bridging ? 'Laying planks' : gun ? (packing ? 'Limbering up' : 'Unlimbering') : (packing ? 'Packing up' : 'Setting up');
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; this.wtext(ctx, label, cx + 0.5, cy - 8.5);
      ctx.fillStyle = '#f0e6cc'; this.wtext(ctx, label, cx, cy - 9);
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
    if (u.type === 'rifle' && (u.stamina ?? 100) < 99) { // its wind, under the others (blue; pale when blown)
      const yy = by + (u.suppression > 5 ? 7 : 4), st = u.stamina ?? 100;
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(p.x - 13, yy, 26, 3);
      ctx.fillStyle = st < 35 ? '#9ab8d8' : '#5aa0e6';
      ctx.fillRect(p.x - 12, yy + 1, 24 * (st / 100), 1.5);
    }
    if (u.type === 'artillery' && u.team === PLAYER && u.cooldown > 0) {
      ctx.fillStyle = '#ddd'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
      this.wtext(ctx, `reload ${Math.ceil(u.cooldown)}s`, p.x, by - 2);
    }
    if (u.pinned) {
      ctx.fillStyle = '#ffb060'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center';
      this.wtext(ctx, 'PINNED', p.x, by - 2);
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
    if (anim) { const base = ctx.getTransform(); for (const e of state.effects.filter((q) => q.type === 'impact').sort((a, b) => a.x + a.y - (b.x + b.y))) { if (e.mud) { ctx.save(); ctx.filter = MUDDY; } this.drawImpact(ctx, e, base); if (e.mud) ctx.restore(); } }
    const wind = this.atmo.wind;
    for (const e of state.effects) {
      const k = e.age / e.life;
      const seed = (e.x * 13.37 + e.y * 7.77) % 1;
      if (e.type === 'tracer') {
        const a = iso(e.x, e.y), b = iso(e.tx, e.ty);
        if (e.deck) a.y -= e.deck; // fired from a ship's deck
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
      } else if (e.type === 'debris') { // smashed planks thrown up and tumbling down
        const c = iso(e.x, e.y);
        for (let i = 0; i < 9; i++) {
          const a = i * 0.7 + seed * 6, r = (8 + (i % 4) * 7) * k, up = 46 * k * (1 - k) * (0.6 + (i % 3) * 0.3);
          const x = c.x + Math.cos(a) * r, y = c.y + Math.sin(a) * r * 0.5 - up, rot = a + e.age * (6 + i);
          ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.globalAlpha = Math.min(1, (1 - k) * 2.5);
          ctx.fillStyle = i % 2 ? '#5e4f3f' : '#4d4135'; ctx.fillRect(-5, -1.2, 10, 2.4);
          ctx.restore();
        }
        ctx.globalAlpha = 1;
      } else if (e.type === 'splash') {
        if (e.mud) { ctx.save(); ctx.filter = MUDDY; }
        this.drawSplash(ctx, e, k, anim && !!this.fxWater); // (with the water frames: only the rings and foam on the surface)
        if (e.mud) ctx.restore();
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
      } else if (e.type === 'blood') {
        // a spray of blood away from the shooter, falling onto the ground as dark spots
        const p = iso(e.x, e.y), tt = e.age;
        for (const q of e.drops) {
          const zz = 14 + q.vz * tt - 150 * tt * tt;
          const gx = p.x + q.vx * tt, gy = p.y + q.vy * tt;
          if (zz > 0) {
            ctx.fillStyle = `rgba(120, 14, 12, ${0.9 * (1 - k * 0.5)})`;
            ctx.fillRect(gx - q.s / 2, gy - zz - q.s / 2, q.s, q.s);
          } else {
            ctx.fillStyle = `rgba(${bloodColour(tt - 0.25)}, ${0.7 * (1 - k)})`;
            ctx.fillRect(gx - q.s * 0.7, gy - q.s * 0.35, q.s * 1.4, q.s * 0.7);
          }
        }
        // a faint red mist where the bullet struck
        if (k < 0.5) {
          ctx.fillStyle = `rgba(110, 20, 18, ${0.28 * (1 - k * 2)})`;
          ctx.beginPath(); ctx.ellipse(p.x, p.y - 14, 4 + k * 10, 3 + k * 6, 0, 0, TAU); ctx.fill();
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
      // a shell in the sea: the same column graded into water (optional)
      Promise.all([fetch('assets/fx/water-impact.json').then((r) => r.json()), loadImage('assets/fx/water-impact.webp')])
        .then(([wm, wi]) => { this.fxWater = { ...this.fx, meta: wm, img: wi }; }).catch(() => {});
      Promise.all([fetch('assets/fx/surf.json').then((r) => r.json()), loadImage('assets/fx/surf.webp')])
        .then(([sm, si]) => { this.fxSurf = { meta: sm, img: si }; }).catch(() => {});
      Promise.all([fetch('assets/fx/ripple.json').then((r) => r.json()), loadImage('assets/fx/ripple.webp')])
        .then(([rm, ri]) => { this.fxRipple = { meta: rm, img: ri }; }).catch(() => {});
    }).catch((e) => { this.fxLoading = null; console.warn('Impact animation unavailable:', e.message); });
    return this.fxLoading;
  }

  /**
   * One shell impact from the hand-drawn frames: neighbouring frames are crossfaded (premultiplied, in a
   * buffer), and the whole cloud keeps rising, swelling and drifting downwind between drawn frames so the
   * slow late frames read as continuous motion. A soft shadow on the ground anchors it to the terrain.
   */
  /**
   * The surf along the water's edge (a level with sea): at every row of shore a pre-rendered strip running
   * from the sea up the sand plays its looping wave - rolling in, breaking into foam, running up the
   * sand and sliding back - each row a little out of step with the next, so the waves roll along the beach.
   */
  drawSurf(ctx, map) {
    const F = this.fxSurf;
    if (!F || !map.tiles.some((t) => t.sea)) return;
    if (!this._shore || this._shore.map !== map) {
      const W = map.w, rows = [];
      for (const t of map.tiles) {
        if (t.sea || t.off || t.block) continue; // (the beach and the rocks of the headlands alike)
        for (const s of [1, -1]) {
          const nx = map.tiles[t.y * W + t.x + s], ny = map.tiles[(t.y + s) * W + t.x];
          const ph = hash(t.y * 0.7, t.x * 0.3) * 0.25 + (t.y - t.x * 0.4) * 0.085;
          if (nx && nx.sea && !nx.block) rows.push({ x: t.x, y: t.y, s, ax: 'x', ph, rock: !!t.rock });
          if (ny && ny.sea && !ny.block) rows.push({ x: t.x, y: t.y, s, ax: 'y', ph, rock: !!t.rock });
        }
      }
      this._shore = { map, rows };
    }
    const M = F.meta, now = performance.now() / 1000, base = ctx.getTransform();
    for (const r of this._shore.rows) {
      const u = ((now / M.period + r.ph) % 1 + 1) % 1, i0 = Math.floor(u * M.frameCount), f = u * M.frameCount - i0;
      ctx.setTransform(base);
      // (map tiles, the strip's length along the map axis the water lies across, its sea end at the water)
      if (r.ax === 'x') { ctx.transform(TW / 2, TH / 2, -TW / 2, TH / 2, 0, 0); ctx.translate(r.s > 0 ? r.x + 2 : r.x - 1, r.y); }
      else { ctx.transform(-TW / 2, TH / 2, TW / 2, TH / 2, 0, 0); ctx.translate(r.s > 0 ? r.y + 2 : r.y - 1, r.x); }
      if (r.s > 0) ctx.scale(-1, 1);
      for (const [j, a] of [[i0 % M.frameCount, 1 - f], [(i0 + 1) % M.frameCount, f]]) {
        if (a < 0.02) continue;
        ctx.globalAlpha = a;
        ctx.drawImage(F.img, (j % M.columns) * M.frameW, Math.floor(j / M.columns) * M.frameH, M.frameW, M.frameH, 0, 0, M.tiles, 1);
      }
    }
    ctx.globalAlpha = 1; ctx.setTransform(base);
  }

  /**
   * A shell bursting in the sea: a white column of water thrown up and falling back, spray drifting
   * downwind, a flash of foam on the surface and rings spreading out across it.
   */
  drawSplash(ctx, e, k, framed = false) {
    const p = iso(e.x, e.y), S = e.scale || 1, t = e.age, wind = this.atmo.wind.x;
    ctx.save();
    if (this.fxRipple) { // the foam spreading on the surface, from its pre-rendered frames (crossfaded)
      const R = this.fxRipple, M = R.meta, u = Math.min(0.999, t / M.duration) * (M.frameCount - 1), i0 = Math.floor(u), f = u - i0;
      const w = 210 * S, h = w / 2, fade = Math.min(1, t / 0.12);
      for (const [j, a] of [[i0, 1 - f], [Math.min(M.frameCount - 1, i0 + 1), f]]) {
        if (a < 0.01) continue;
        ctx.globalAlpha = a * fade;
        ctx.drawImage(R.img, (j % M.columns) * M.frameW, Math.floor(j / M.columns) * M.frameH, M.frameW, M.frameH, p.x - w / 2, p.y - h / 2, w, h);
      }
      ctx.globalAlpha = 1;
      if (framed) { ctx.restore(); return; }
    }
    // rings spreading on the water
    for (const lag of [0, 0.5, 1.1]) {
      const q = (t - lag) / 2.6;
      if (q <= 0 || q >= 1) continue;
      const r = (12 + q * 80) * S;
      ctx.strokeStyle = `rgba(225,238,240,${0.5 * (1 - q)})`; ctx.lineWidth = 2.2 * (1 - q) + 0.4;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * 0.5, 0, 0, TAU); ctx.stroke();
    }
    // the foam where it came down
    const foam = Math.max(0, 1 - t / 3.2);
    const fg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 30 * S);
    fg.addColorStop(0, `rgba(240,246,246,${0.75 * foam})`); fg.addColorStop(1, 'rgba(240,246,246,0)');
    ctx.fillStyle = fg; ctx.beginPath(); ctx.ellipse(p.x, p.y, 34 * S, 17 * S, 0, 0, TAU); ctx.fill();
    if (framed) { ctx.restore(); return; }
    // the column: it shoots up in a fraction of a second, hangs, and collapses back under its own weight
    const up = Math.min(1, t / 0.28), fall = Math.max(0, (t - 0.55) / 1.6);
    const H = 115 * S * up * (1 - fall * fall * 0.85), alpha = Math.max(0, 1 - Math.max(0, t - 0.8) / 1.1) * (1 - fall * 0.4);
    if (H > 2 && alpha > 0) {
      for (let i = 0; i < 9; i++) { // overlapping plumes of white water, the outer ones lower and spreading
        const a = (i / 8 - 0.5) * 2, hh = H * (1 - Math.abs(a) * 0.45) * (0.85 + 0.3 * Math.sin(i * 2.3 + e.seed * 9));
        const x0 = p.x + a * (6 + fall * 26) * S, x1 = x0 + a * (10 + fall * 30) * S + wind * fall * 14;
        const w = (7 - Math.abs(a) * 2.5) * S * (1 + fall * 1.4);
        const g = ctx.createLinearGradient(0, p.y, 0, p.y - hh);
        g.addColorStop(0, `rgba(205,222,226,${0.85 * alpha})`); g.addColorStop(0.6, `rgba(244,248,248,${0.8 * alpha})`); g.addColorStop(1, `rgba(255,255,255,${0.15 * alpha})`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x0 - w, p.y);
        ctx.quadraticCurveTo(x0 - w * 0.6, p.y - hh * 0.6, x1 - w * 0.4, p.y - hh);
        ctx.quadraticCurveTo(x1, p.y - hh - w * 1.4, x1 + w * 0.4, p.y - hh);
        ctx.quadraticCurveTo(x0 + w * 0.6, p.y - hh * 0.6, x0 + w, p.y);
        ctx.closePath(); ctx.fill();
      }
      // a dark flash of the burst at the foot, in the first instant
      if (t < 0.15) { ctx.fillStyle = `rgba(255,220,160,${0.7 * (1 - t / 0.15)})`; ctx.beginPath(); ctx.ellipse(p.x, p.y - 6 * S, 16 * S, 9 * S, 0, 0, TAU); ctx.fill(); }
    }
    // spray: droplets thrown out and falling, a mist drifting downwind
    for (let i = 0; i < 26; i++) {
      const r1 = hash(e.seed * 97 + i, i * 1.7), r2 = hash(i * 3.1, e.seed * 41 + 2);
      const tt = t - r1 * 0.3;
      if (tt <= 0 || tt > 1.9) continue;
      const vx = (r2 - 0.5) * 90 * S, vy = -(70 + r1 * 120) * S;
      const x = p.x + vx * tt + wind * tt * 10, y = p.y + vy * tt + 140 * tt * tt;
      if (y > p.y + 4) continue;
      ctx.fillStyle = `rgba(240,246,248,${0.8 * (1 - tt / 1.9)})`;
      ctx.beginPath(); ctx.arc(x, y, 1.4 + r1 * 1.8, 0, TAU); ctx.fill();
    }
    if (t > 0.6) {
      const m = Math.min(1, (t - 0.6) / 0.6) * Math.max(0, 1 - (t - 1.2) / 2.2);
      const mg = ctx.createRadialGradient(p.x + wind * (t - 0.6) * 22, p.y - 40 * S, 0, p.x + wind * (t - 0.6) * 22, p.y - 40 * S, 55 * S);
      mg.addColorStop(0, `rgba(235,242,244,${0.35 * m})`); mg.addColorStop(1, 'rgba(235,242,244,0)');
      ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(p.x + wind * (t - 0.6) * 22, p.y - 40 * S, 55 * S, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  drawImpact(ctx, e, base) {
    const F = e.water && this.fxWater ? this.fxWater : this.fx, M = F.meta, T = M.frameTimes, N = M.frameCount;
    // at sea only the rising column of the sheet is played (its later frames are a billowing cloud, which
    // water does not make), slowed down, and fading out as the water falls back
    const t = e.water ? e.age * 0.3 : e.age, end = e.water ? T[Math.min(N - 1, 19)] : Math.min(M.duration, e.life || M.duration);
    if (t >= end) return;
    const opacity = Math.min(1, t / 0.035) * (e.water ? Math.min(1, (end - t) / (end * 0.55)) : Math.min(1, (end - t) / 1.2));
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
    ctx.globalAlpha = (e.water ? 0.3 : 0.85) * dense; // (on water only a faint shade)
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

  /** A valley level's own rectangle in world coordinates (its ends, the back of its rock wall, its front edge). */
  bandRect(map) {
    const hw = (this.R + 0.5) * TW / 2 - 2;
    return { x0: -hw, x1: hw, y0: (map.w - (map.bandBack || map.band)) * TH / 2 + 2, y1: (map.w + map.band) * TH / 2 - 2 };
  }

  // ------------------------------------------------------------ minimap

  drawMinimap(mctx, state, w, h) {
    this.mmCanvas = mctx.canvas;
    if (!state.map.band && this.mmBase && mctx.canvas.height !== this.mmBase) { mctx.canvas.height = this.mmBase; mctx.canvas.style.height = ''; return; }
    if (!this.mmBase) this.mmBase = mctx.canvas.height;
    mctx.setTransform(this.M, 0, 0, 1, this.M < 0 ? w : 0, 0); // (a level shown mirrored: its minimap too)
    mctx.fillStyle = '#121309'; mctx.fillRect(0, 0, w, h);
    // the part of the world shown: a valley level's own rectangle, stretched to fill the box; otherwise the
    // whole battlefield, at its own proportions
    let m;
    if (state.map.band) {
      const r = this.bandRect(state.map), sc = Math.min(w / (r.x1 - r.x0), h / (r.y1 - r.y0));
      m = { x0: r.x0, y0: r.y0, sx: sc, sy: sc, ox: 0, oy: 0 };
      // the minimap box takes the valley's own proportions (long and low), so there is no empty margin
      const want = Math.round((r.y1 - r.y0) * (w / (r.x1 - r.x0)));
      if (this.mmCanvas && Math.abs(this.mmCanvas.height - want) > 1) { this.mmCanvas.height = want; this.mmCanvas.style.height = (this.mmCanvas.clientWidth * want / w) + 'px'; return; }
      m.sx = m.sy = w / (r.x1 - r.x0);
    } else {
      const s = Math.min(w / this.gw, h / this.gh);
      m = { x0: -this.OX, y0: -this.OY, sx: s, sy: s, ox: (w - this.gw * s) / 2, oy: (h - this.gh * s) / 2 };
    }
    this.mini = m;
    const k = this.ground.width / this.gw; // the ground image's pixels per world unit
    const vw = w / m.sx, vh = h / m.sy; // the world area that fits the box
    if (state.map.band) mctx.drawImage(this.ground, (m.x0 + this.OX) * k, (m.y0 + this.OY) * k, vw * k, vh * k, 0, 0, w, h);
    else mctx.drawImage(this.ground, m.ox, m.oy, this.gw * m.sx, this.gh * m.sy);
    const P = (x, y) => [m.ox + (x - m.x0) * m.sx, m.oy + (y - m.y0) * m.sy];
    for (const u of state.units) {
      if (!u.visible) continue;
      const p = iso(u.x, u.y), [x, y] = P(p.x, p.y);
      mctx.fillStyle = u.team === PLAYER ? '#e8d27a' : '#ff6a5a';
      mctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    // viewport
    const tl = this.screenToWorld(0, this.insets.top), br = this.screenToWorld(this.vw, this.vh - this.insets.bottom);
    const [ax, ay] = P(tl.x, tl.y), [bx, by] = P(br.x, br.y);
    mctx.strokeStyle = 'rgba(255,255,255,0.8)'; mctx.lineWidth = 1;
    mctx.strokeRect(ax, ay, bx - ax, by - ay);
  }
  minimapToWorld(mx, my) {
    const m = this.mini;
    if (!m) return null;
    if (this.M < 0) mx = (this.mmCanvas ? this.mmCanvas.width : 0) - mx;
    return { x: (mx - m.ox) / m.sx + m.x0, y: (my - m.oy) / m.sy + m.y0 };
  }
}

/** Blood colour (r,g,b) by age in seconds: bright red when fresh, dark brown within about 2.5 s. */
function bloodColour(age) {
  const k = Math.min(1, Math.max(0, age / 2.5));
  const e = 1 - (1 - k) * (1 - k); // fast at first
  const mixc = (a, b) => Math.round(a + (b - a) * e);
  return `${mixc(105, 52)}, ${mixc(14, 36)}, ${mixc(12, 24)}`;
}

/**
 * A man's idle moment at this time (k: his seed), or null. Each man runs his own schedule in 9 s slots:
 * in about 45% of them he smokes, cleans his rifle or wipes his helmet for a few seconds.
 * Returns the animation, its frame (0-3) and, for smoking, how long since the last draw (puff age).
 */
const IDLE_ANIMS = ['smoke', 'clean', 'helmet'];
function idleAt(k, time) {
  const SLOT = 9, off = hash(k, 51) * SLOT, slot = Math.floor((time + off) / SLOT), t = time + off - slot * SLOT;
  const r = hash(k * 13.7 + slot, 77);
  if (r > 0.45) return null;
  const start = 0.6 + hash(k, slot + 3) * 1.5, end = SLOT - 0.4 - hash(slot, k + 9) * 2;
  if (t < start || t > end) return null;
  const anim = IDLE_ANIMS[Math.floor(r / 0.15) % 3], at = t - start;
  if (anim === 'smoke') {
    // hand down, up, a long draw at the lips, down again; then smoke drifts from the cigarette
    const c = at % 3.6, frame = c < 0.8 ? 0 : c < 1.2 ? 1 : c < 2.4 ? 2 : c < 2.8 ? 3 : 0;
    return { anim, frame, puff: c >= 2.0 ? c - 2.0 : c + 1.6 };
  }
  // working back and forth with a rag
  const seq = anim === 'clean' ? [0, 1, 2, 3] : [0, 1, 2, 3];
  return { anim, frame: seq[Math.floor(at / (anim === 'clean' ? 0.35 : 0.3)) % 4], puff: 0 };
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
