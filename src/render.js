// Isometric (2:1, "45 degree") canvas renderer.
import { TILE_W as TW, TILE_H as TH, MAP_W, MAP_H, PLAYER, ENEMY, UNIT_TYPES } from './config.js';
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
function tileRGB(t) {
  let c;
  if (t.mud) c = hslRGB(26 + t.shade * 10, 20 + t.shade * 8, 21 + t.shade * 6);
  else c = hslRGB(64 + t.shade * 20, 24 + t.shade * 10, 26 + t.shade * 7);
  if (t.crater) c = c.map((v) => v * 0.82);
  return c;
}
const frac = (v) => v - Math.floor(v);
const hash = (x, y) => frac(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);

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

  drawGround(map) {
    const g = this.ground.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.ground.width, this.ground.height);

    // 1. smooth colour field: one pixel per tile, bilinearly stretched into the isometric diamond
    const field = this.field || (this.field = document.createElement('canvas'));
    field.width = map.w; field.height = map.h;
    const fc = field.getContext('2d');
    const img = fc.createImageData(map.w, map.h);
    for (const t of map.tiles) {
      const [r, gg, b] = tileRGB(t);
      const i = (t.y * map.w + t.x) * 4;
      img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = 255;
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

    // 3. per-tile detail: grass tufts, mud clods, puddles
    for (const t of map.tiles) {
      if (t.trench) continue;
      const h = hash(t.x, t.y);
      if (!t.mud) {
        g.lineWidth = 1;
        for (let i = 0; i < 4; i++) {
          const q = iso(t.x + frac(h * (i + 1) * 7.1), t.y + frac(h * (i + 1) * 3.7));
          g.strokeStyle = `hsla(${70 + frac(h * i * 5.3) * 25},${30 + t.shade * 15}%,${18 + frac(h * (i + 2)) * 22}%,0.75)`;
          g.beginPath();
          g.moveTo(q.x - 2, q.y - 3); g.lineTo(q.x, q.y); g.lineTo(q.x + 2, q.y - 3.5);
          g.moveTo(q.x, q.y); g.lineTo(q.x + 0.5, q.y - 4.5);
          g.stroke();
        }
      } else {
        g.fillStyle = 'rgba(25,17,10,0.35)';
        for (let i = 0; i < 3; i++) {
          const q = iso(t.x + frac(h * (i + 1) * 5.9), t.y + frac(h * (i + 1) * 9.3));
          g.beginPath(); g.ellipse(q.x, q.y, 2 + frac(h * i) * 2, 1, 0, 0, TAU); g.fill();
        }
        if (h > 0.955 && !t.crater) {
          const q = iso(t.x + 0.5, t.y + 0.5);
          g.fillStyle = 'rgba(30,22,14,0.5)';
          g.beginPath(); g.ellipse(q.x, q.y, 11, 4.5, 0, 0, TAU); g.fill();
          g.fillStyle = 'rgba(78,88,92,0.5)';
          g.beginPath(); g.ellipse(q.x, q.y + 0.5, 9, 3.4, 0, 0, TAU); g.fill();
          g.strokeStyle = 'rgba(190,200,205,0.22)'; g.lineWidth = 0.8;
          g.beginPath(); g.moveTo(q.x - 5, q.y - 0.5); g.lineTo(q.x + 2, q.y - 1.2); g.stroke();
        }
      }
    }

    // 4. shell craters: scorch, broken rim, shaded bowl, sometimes standing water
    for (const t of map.tiles) {
      if (!t.crater) continue;
      const h = hash(t.x * 3.1, t.y * 1.7);
      const c = iso(t.x + 0.25 + t.shade * 0.5, t.y + 0.25 + h * 0.5);
      const r = (5 + t.crater * 4) * (0.8 + h * 0.45);
      g.save();
      g.translate(c.x, c.y); g.scale(1, 0.5);
      let gr = g.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 2.1);
      gr.addColorStop(0, 'rgba(20,13,7,0.35)'); gr.addColorStop(1, 'rgba(20,13,7,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r * 2.1, 0, TAU); g.fill();
      // thrown-up spoil: irregular clumps around the lip
      const lumps = 6;
      for (let i = 0; i < lumps; i++) {
        const ang = (i / lumps) * TAU + h * 6;
        const lr = r * (0.95 + frac(h * (i + 3) * 7.7) * 0.25);
        g.fillStyle = i % 2 ? 'rgba(98,80,56,0.45)' : 'rgba(78,63,44,0.45)';
        g.beginPath(); g.arc(Math.cos(ang) * lr * 0.55, Math.sin(ang) * lr * 0.55, r * (0.5 + frac(h * i * 3.3) * 0.25), 0, TAU); g.fill();
      }
      // bowl, offset a little so it is never a perfect ring
      gr = g.createRadialGradient(r * 0.1, r * 0.3, 0, 0, 0, r * 0.85);
      gr.addColorStop(0, '#24180e'); gr.addColorStop(0.7, '#2a1d12'); gr.addColorStop(1, 'rgba(58,42,27,0.6)');
      g.fillStyle = gr;
      g.beginPath(); g.ellipse(0, 0, r * 0.85, r * (0.7 + h * 0.25), h * 2, 0, TAU); g.fill();
      if (t.crater >= 3 || (t.crater === 2 && h > 0.55)) {
        gr = g.createLinearGradient(0, -r * 0.3, 0, r * 0.5);
        gr.addColorStop(0, 'rgba(105,118,120,0.7)'); gr.addColorStop(1, 'rgba(45,55,58,0.7)');
        g.fillStyle = gr; g.beginPath(); g.ellipse(r * 0.05, r * 0.2, r * 0.45, r * 0.35, h, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(210,215,220,0.25)'; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(-r * 0.25, 0); g.lineTo(r * 0.1, -r * 0.05); g.stroke();
      }
      g.restore();
    }
    g.restore(); // clip

    // 5. trenches: drop shadow, sandbag band, parapet, walls, floor, duckboards
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
    g.lineCap = 'round';
    for (const t of trenches) strokeTrench(t, 26, 'rgba(0,0,0,0.22)', 2, 3);
    for (const t of trenches) if (t.trench >= 2) strokeTrench(t, 23, t.trench >= 3 ? '#8f8d85' : '#b9a576');
    for (const t of trenches) strokeTrench(t, 17, PARAPET[t.owner < 0 ? 2 : t.owner]);
    for (const t of trenches) strokeTrench(t, 12, '#4a3620');
    for (const t of trenches) strokeTrench(t, 8, '#1f160d', 0, 1.8);
    g.setLineDash([2.5, 2]);
    for (const t of trenches) strokeTrench(t, 2.6, t.trench >= 3 ? '#8a6a42' : '#5b4429', 0, 1.8);
    g.setLineDash([]);
    // sandbag rows on reinforced works
    for (const t of trenches) {
      if (t.trench < 2) continue;
      const c = iso(t.x + 0.5, t.y + 0.5);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + t.shade;
        const bx = c.x + Math.cos(a) * 10, by = c.y + Math.sin(a) * 5.2;
        g.fillStyle = t.trench >= 3 ? '#aaa79b' : (i % 2 ? '#d2bf8e' : '#c2ad7c');
        g.beginPath(); g.ellipse(bx, by, 2.6, 1.5, 0, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(60,45,25,0.5)'; g.lineWidth = 0.5; g.stroke();
      }
    }

    // 6. barbed wire with shadow
    for (const t of map.tiles) {
      if (t.wire <= 0) continue;
      const a = iso(t.x + 0.5, t.y + 0.05), b = iso(t.x + 0.5, t.y + 0.95);
      const loops = t.wire > 50 ? 7 : 3;
      for (const pass of [0, 1]) {
        const ox = pass ? 0 : 2.5, oy = pass ? 0 : 1.5;
        if (!pass) { g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1.2; }
        // stakes
        if (pass) { g.strokeStyle = '#3a3128'; g.lineWidth = 1.6; }
        for (let i = 0; i < 3; i++) {
          if (t.wire < 50 && i === 1) continue;
          const f = (i + 0.5) / 3;
          const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
          g.beginPath();
          if (pass) { g.moveTo(x, y); g.lineTo(x + (t.shade - 0.5) * 2, y - 9); }
          else { g.moveTo(x, y); g.lineTo(x + 7, y + 2); }
          g.stroke();
        }
        g.strokeStyle = pass ? (t.wire > 50 ? 'rgba(175,175,170,0.9)' : 'rgba(150,150,145,0.6)') : 'rgba(0,0,0,0.22)';
        g.lineWidth = 0.9;
        for (let i = 0; i < loops; i++) {
          const f = (i + 0.5) / loops;
          const x = a.x + (b.x - a.x) * f + ox * 2, y = a.y + (b.y - a.y) * f + (pass ? -4 : oy);
          g.beginPath(); g.ellipse(x, y, 3.2, pass ? 4 : 1.8, 0.4, 0, TAU); g.stroke();
        }
        if (pass) { g.beginPath(); g.moveTo(a.x, a.y - 7); g.lineTo(b.x, b.y - 7); g.stroke(); }
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
      this.drawGround(state.map);
      state.map.dirty = false;
      this.groundDrawn = true;
      this.lastGround = now;
    }
    const z = this.cam.zoom, d = this.dpr;
    const sh = this.atmo.shake;
    const shx = (Math.random() - 0.5) * sh, shy = (Math.random() - 0.5) * sh;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.fillStyle = '#16180f';
    ctx.fillRect(0, 0, this.vw, this.vh);
    ctx.setTransform(d * z, 0, 0, d * z, d * (this.vw / 2 - this.cam.x * z + shx), d * (this.vh / 2 - this.cam.y * z + shy));
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.ground, -this.OX, -this.OY);

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
    const c = iso(t.x + 0.3 + t.shade * 0.4, t.y + 0.5);
    if (t.decor === 'tree') {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(c.x + 4, c.y, 12, 5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3b2c1c'; ctx.fillRect(c.x - 1.5, c.y - 18, 3, 18);
      ctx.fillStyle = `hsl(${85 + t.shade * 20},30%,${20 + t.shade * 6}%)`;
      ctx.beginPath(); ctx.arc(c.x, c.y - 24, 10, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(c.x - 6, c.y - 19, 7, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(c.x + 6, c.y - 20, 7, 0, TAU); ctx.fill();
    } else if (t.decor === 'stump') {
      ctx.strokeStyle = '#2b2118'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + 1, c.y - 12 - t.shade * 8); ctx.stroke();
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(c.x + 1, c.y - 9); ctx.lineTo(c.x + 6, c.y - 14); ctx.stroke();
    } else if (t.decor === 'ruin') {
      ctx.fillStyle = '#6f6a60';
      ctx.fillRect(c.x - 10, c.y - 12, 6, 12);
      ctx.fillRect(c.x - 4, c.y - 7, 10, 7);
      ctx.fillStyle = '#56524a';
      ctx.fillRect(c.x + 6, c.y - 4, 5, 4);
      ctx.fillStyle = '#7d776b';
      ctx.fillRect(c.x - 10, c.y - 12, 6, 2);
    }
  }

  drawHQ(ctx, state, q, team) {
    const c = iso(q.x + 0.5, q.y + 0.5);
    const owner = tileAt(state.map, q.x, q.y).owner;
    // concrete bunker
    ctx.fillStyle = '#5f5d56';
    ctx.beginPath();
    ctx.moveTo(c.x - 22, c.y - 6); ctx.lineTo(c.x, c.y - 17); ctx.lineTo(c.x + 22, c.y - 6);
    ctx.lineTo(c.x + 22, c.y + 2); ctx.lineTo(c.x, c.y + 13); ctx.lineTo(c.x - 22, c.y + 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#7a776e';
    ctx.beginPath();
    ctx.moveTo(c.x - 22, c.y - 6); ctx.lineTo(c.x, c.y - 17); ctx.lineTo(c.x + 22, c.y - 6); ctx.lineTo(c.x, c.y + 5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1d1c19';
    ctx.fillRect(c.x - 9, c.y + 1, 7, 3);
    ctx.fillRect(c.x + 3, c.y + 1, 7, 3);
    // flag
    ctx.strokeStyle = '#2a2620'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(c.x, c.y - 12); ctx.lineTo(c.x, c.y - 42); ctx.stroke();
    ctx.fillStyle = owner < 0 ? '#999' : TEAM_COLOR[owner];
    const wave = Math.sin(state.time * 3 + team) * 2;
    ctx.beginPath(); ctx.moveTo(c.x, c.y - 42); ctx.lineTo(c.x + 16, c.y - 38 + wave); ctx.lineTo(c.x, c.y - 33); ctx.closePath(); ctx.fill();
    ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText('HQ', c.x + 0.5, c.y - 3.5);
    ctx.fillStyle = '#eee'; ctx.fillText('HQ', c.x, c.y - 4);
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
