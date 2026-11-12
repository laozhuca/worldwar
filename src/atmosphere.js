// Atmosphere: day/night cycle, dynamic lighting, star-shell flares, rain, fog, film grain, screen shake.
// Purely visual — nothing here affects the simulation.
import { iso } from './render.js';
import { UNIT_TYPES, SEASONS } from './config.js';

const TAU = Math.PI * 2;
const DAY_LENGTH = 420; // seconds of game time per 24h
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

export function hourOf(time) {
  return (6.5 + (time / DAY_LENGTH) * 24) % 24;
}

export class Atmosphere {
  constructor() {
    this.light = document.createElement('canvas');
    this.flares = [];
    this.flareTimer = 3;
    this.drops = [];
    this.flakes = [];
    this.shake = 0;
    // Mud-season showers: rain starts and stops at random; level eases towards 1 while it rains
    this.shower = { raining: false, timer: 30 + Math.random() * 90, level: 0, peak: 1 };
    this.wind = { x: 0.8, y: 0.25 };
    this.fog = [];
    for (let i = 0; i < 16; i++) {
      this.fog.push({ x: Math.random() * 64, y: Math.random() * 40, r: 3 + Math.random() * 4, a: 0.5 + Math.random() * 0.5 });
    }
    const n = document.createElement('canvas');
    n.width = n.height = 160;
    const nc = n.getContext('2d');
    const img = nc.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 40;
    }
    nc.putImageData(img, 0, 0);
    this.noise = n;
    this.grainPattern = null;
  }

  hour(state) { return hourOf(state.time); }

  /** 0 = broad daylight, ~0.6 = night. */
  darkness(state) {
    const h = this.hour(state);
    const dusk = smooth(17.5, 20.5, h);
    const dawn = 1 - smooth(4.5, 7.5, h);
    return 0.62 * Math.max(h >= 12 ? dusk : 0, h < 12 ? dawn : 0);
  }
  /** Warm golden-hour tint strength. */
  golden(state) {
    const h = this.hour(state);
    return Math.max(0, 1 - Math.abs(h - 18.5) / 1.8, 1 - Math.abs(h - 6.2) / 1.5);
  }
  /** How hard it is raining (0-1). Only the Mud season has rain: showers that come and go at random. */
  rain(state) {
    const season = SEASONS[state.season] || SEASONS.winter;
    return season.precip === 'showers' ? this.shower.level : 0;
  }
  /** Winter snowfall strength: heavier and lighter spells. */
  snowfall(state) {
    const t = state.time;
    return smooth(0.55, 1.1, Math.sin(t / 97 + 1.3) + Math.sin(t / 41) * 0.5);
  }

  onEvent(ev, r) {
    if (ev.type !== 'boom' || ev.x === undefined) return;
    const c = r.screenToMap(r.vw / 2, r.vh / 2);
    const d = Math.hypot(ev.x - c.x, ev.y - c.y);
    this.shake = Math.min(9, this.shake + Math.max(0, 5 - d * 0.35) * r.cam.zoom);
  }

  update(dt, simDt, state, r) {
    this.shake *= Math.pow(0.0015, dt);
    if (this.shake < 0.05) this.shake = 0;

    // fog drift
    for (const f of this.fog) {
      f.x += this.wind.x * simDt * 0.15;
      f.y += this.wind.y * simDt * 0.15;
      if (f.x > 70) f.x -= 76;
      if (f.y > 44) f.y -= 48;
    }

    // star shells over no man's land at night
    const dark = this.darkness(state);
    this.flareTimer -= simDt;
    if (dark > 0.2 && this.flareTimer <= 0) {
      this.flareTimer = 2.5 + Math.random() * 4;
      this.flares.push({ x: 21 + Math.random() * 22, y: 2 + Math.random() * 36, age: 0, life: 9 + Math.random() * 3, drift: (Math.random() - 0.5) * 0.3 });
    }
    for (const f of this.flares) { f.age += simDt; f.x += this.wind.x * simDt * 0.12 + f.drift * simDt; }
    this.flares = this.flares.filter((f) => f.age < f.life);

    // precipitation (screen space): rain, sleet or snow by season
    const season = SEASONS[state.season] || SEASONS.winter;
    // showers: a dry spell of 40 s - 3 min, then 25 - 100 s of rain of varying strength
    const sh = this.shower;
    sh.timer -= simDt;
    if (sh.timer <= 0) {
      sh.raining = !sh.raining;
      sh.timer = sh.raining ? 25 + Math.random() * 75 : 40 + Math.random() * 140;
      if (sh.raining) sh.peak = 0.55 + Math.random() * 0.45;
    }
    sh.level += ((sh.raining ? sh.peak : 0) - sh.level) * Math.min(1, simDt / 6); // fades in and out over a few seconds
    if (sh.level < 0.002) sh.level = 0;
    const rainAmt = this.rain(state);
    const snowAmt = season.precip === 'snow' ? 0.3 + this.snowfall(state) * 0.7 : 0;
    const wantFlakes = Math.floor(snowAmt * 360);
    while (this.flakes.length < wantFlakes) this.flakes.push(this.newFlake(r, true));
    if (this.flakes.length > wantFlakes) this.flakes.length = wantFlakes;
    for (const k of this.flakes) {
      k.y += k.v * simDt * 60;
      k.x += (this.wind.x * 0.6 + Math.sin(k.ph + k.y * 0.02) * 0.5) * simDt * 60;
      if (k.y > r.vh + 10 || k.x > r.vw + 10) Object.assign(k, this.newFlake(r, false));
    }
    const want = Math.floor(rainAmt * 420);
    while (this.drops.length < want) this.drops.push(this.newDrop(r, true));
    if (this.drops.length > want) this.drops.length = want;
    for (const d of this.drops) {
      d.y += d.v * simDt * 60;
      d.x += d.v * simDt * 60 * 0.25;
      if (d.y > r.vh + 20 || d.x > r.vw + 20) Object.assign(d, this.newDrop(r, false));
    }
  }

  newFlake(r, anywhere) {
    const near = Math.random() < 0.15;
    return { x: Math.random() * (r.vw + 100) - 100, y: anywhere ? Math.random() * r.vh : -10, v: near ? 1.6 + Math.random() : 0.5 + Math.random() * 0.7, s: near ? 1.8 + Math.random() * 1.2 : 0.7 + Math.random() * 0.8, ph: Math.random() * 6 };
  }

  newDrop(r, anywhere) {
    return { x: Math.random() * (r.vw + 200) - 200, y: anywhere ? Math.random() * r.vh : -20 - Math.random() * 100, v: 14 + Math.random() * 8, l: 8 + Math.random() * 10 };
  }

  flareHeight(f) {
    // rapid climb, then slow descent under a parachute
    if (f.age < 1) return 240 * Math.sin((f.age * Math.PI) / 2);
    return Math.max(0, 240 - (f.age - 1) * 24);
  }

  /** Drawn in world space after units. */
  drawWorld(ctx, state) {
    // drifting ground mist
    const dark = this.darkness(state);
    const mist = 0.08 + dark * 0.1 + this.golden(state) * 0.03 + this.rain(state) * 0.07;
    for (const f of this.fog) {
      const p = iso(f.x, f.y);
      const rx = f.r * 48, ry = f.r * 22;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rx);
      const c = dark > 0.3 ? '140,152,180' : '196,204,214';
      g.addColorStop(0, `rgba(${c},${mist * f.a})`);
      g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(1, ry / rx);
      ctx.translate(-p.x, -p.y);
      ctx.beginPath(); ctx.arc(p.x, p.y, rx, 0, TAU); ctx.fill();
      ctx.restore();
    }
    // flares
    for (const f of this.flares) {
      const p = iso(f.x, f.y);
      const h = this.flareHeight(f);
      const fade = 1 - smooth(0.75, 1, f.age / f.life);
      ctx.strokeStyle = `rgba(200,200,200,${0.25 * fade})`; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(p.x - 6, p.y); ctx.quadraticCurveTo(p.x - 8, p.y - h * 0.6, p.x, p.y - h); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(p.x, p.y - h, 0, p.x, p.y - h, 18);
      g.addColorStop(0, `rgba(255,255,235,${fade})`); g.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y - h, 18, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  collectLights(state, r) {
    const L = [];
    const add = (x, y, z, rad, s, warm = true) => L.push({ x, y, z, rad, s, warm });
    for (const e of state.effects) {
      const k = e.age / e.life;
      if (e.type === 'boom') add(e.x, e.y, 10, 190, 1 - k);
      else if (e.type === 'gunflash') add(e.x, e.y, 16, 110, 1 - k);
      else if (e.type === 'tracer' && k < 0.6) add((e.x + e.tx) / 2, (e.y + e.ty) / 2, 8, 50, 0.35 * (1 - k));
    }
    for (const u of state.units) {
      if (u.visible && u.firing > 0 && UNIT_TYPES[u.type].range) add(u.x, u.y, 10, u.type === 'mg' ? 70 : 45, 0.8);
    }
    for (const f of this.flares) {
      const fade = 1 - smooth(0.75, 1, f.age / f.life);
      const flick = 0.9 + Math.sin(f.age * 31) * 0.05 + Math.sin(f.age * 13) * 0.05;
      add(f.x, f.y, this.flareHeight(f) * 0.25, 330 * flick, 0.95 * fade, false);
    }
    for (const q of state.map.hq) add(q.x + 0.5, q.y + 0.5, 6, 70, 0.7);
    return L;
  }

  /** Drawn in screen space (CSS px transform already set by caller). */
  drawScreen(ctx, state, r) {
    const d = r.dpr, z = r.cam.zoom;
    const dark = this.darkness(state);
    const lights = this.collectLights(state, r);

    // golden hour / rain tint
    const gold = this.golden(state);
    // cold, overcast grade over everything
    ctx.fillStyle = 'rgba(62,80,110,0.10)'; ctx.fillRect(0, 0, r.vw, r.vh);
    if (gold > 0.01) { ctx.fillStyle = `rgba(255,160,90,${0.05 * gold})`; ctx.fillRect(0, 0, r.vw, r.vh); }
    const rain = this.rain(state);
    if (rain > 0.01) { ctx.fillStyle = `rgba(40,48,60,${0.18 * rain})`; ctx.fillRect(0, 0, r.vw, r.vh); }

    // night: darkness layer with light holes cut out
    if (dark > 0.01) {
      const lc = this.light;
      if (lc.width !== r.canvas.width || lc.height !== r.canvas.height) { lc.width = r.canvas.width; lc.height = r.canvas.height; }
      const l = lc.getContext('2d');
      l.setTransform(d, 0, 0, d, 0, 0);
      l.globalCompositeOperation = 'source-over';
      l.clearRect(0, 0, r.vw, r.vh);
      l.fillStyle = `rgba(6,10,26,${dark})`;
      l.fillRect(0, 0, r.vw, r.vh);
      l.globalCompositeOperation = 'destination-out';
      for (const s of lights) {
        const p = r.mapToScreen(s.x, s.y, s.z);
        const rad = s.rad * z;
        const g = l.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
        g.addColorStop(0, `rgba(0,0,0,${Math.min(1, s.s)})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        l.fillStyle = g;
        l.fillRect(p.x - rad, p.y - rad, rad * 2, rad * 2);
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(lc, 0, 0);
      ctx.restore();
    }

    // additive glow from fire and flares (stronger at night)
    ctx.globalCompositeOperation = 'lighter';
    for (const s of lights) {
      const strength = s.s * (0.12 + dark * 0.35);
      if (strength < 0.01) continue;
      const p = r.mapToScreen(s.x, s.y, s.z);
      const rad = s.rad * z * 0.7;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
      g.addColorStop(0, s.warm ? `rgba(255,150,60,${strength})` : `rgba(220,230,255,${strength * 0.7})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(p.x - rad, p.y - rad, rad * 2, rad * 2);
    }
    ctx.globalCompositeOperation = 'source-over';

    // rain streaks
    if (this.drops.length) {
      ctx.strokeStyle = `rgba(185,195,210,${0.25 + 0.2 * rain})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const p of this.drops) { ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.l * 0.25, p.y - p.l); }
      ctx.stroke();
    }

    // snowflakes
    if (this.flakes.length) {
      ctx.fillStyle = 'rgba(235,240,246,0.75)';
      for (const k of this.flakes) { ctx.beginPath(); ctx.arc(k.x, k.y, k.s, 0, TAU); ctx.fill(); }
    }

    // film grain
    if (!this.grainPattern) this.grainPattern = ctx.createPattern(this.noise, 'repeat');
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.translate(Math.random() * 160, Math.random() * 160);
    ctx.fillStyle = this.grainPattern;
    ctx.fillRect(-160, -160, r.vw + 320, r.vh + 320);
    ctx.restore();
  }
}
