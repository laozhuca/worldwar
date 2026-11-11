// Sprite art for WorldWar: drawn with Canvas 2D at 3x display size, exported to assets/sprites/*.png
// by scripts/make-sprites.mjs (runs this in headless Chromium). Classic script: defines window.makeSprites().
(function () {
  const TAU = Math.PI * 2;
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  const SNOW = '#e3e8ef', SNOW_SH = '#a9b4c6';
  const WOOD_PALE = ['#cdb791', '#b59c76', '#9c835f'];

  // ------------------------------------------------------------------ helpers
  function softShadow(ctx, cx, cy, rx, ry, a = 0.4) {
    ctx.save();
    ctx.filter = `blur(${Math.max(2, ry * 0.6)}px)`;
    ctx.fillStyle = `rgba(0,0,0,${a})`;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }

  /** Bark: dark furrows and lighter ridges running along the trunk, clipped to the current path. */
  function bark(ctx, r, x0, y0, x1, y1, along = 'y') {
    const w = x1 - x0, h = y1 - y0;
    const n = along === 'y' ? Math.floor(w / 2.2) : Math.floor(h / 2.2);
    for (let i = 0; i < n; i++) {
      const dark = r() < 0.6;
      ctx.strokeStyle = dark ? `rgba(8,6,5,${0.35 + r() * 0.35})` : `rgba(160,150,138,${0.12 + r() * 0.15})`;
      ctx.lineWidth = 0.6 + r() * 1.6;
      ctx.beginPath();
      if (along === 'y') {
        let x = x0 + r() * w, y = y1 + 4;
        ctx.moveTo(x, y);
        while (y > y0 - 4) { y -= 6 + r() * 10; x += (r() - 0.5) * 2.4; ctx.lineTo(x, y); }
      } else {
        let y = y0 + r() * h, x = x0 - 4;
        ctx.moveTo(x, y);
        while (x < x1 + 4) { x += 6 + r() * 10; y += (r() - 0.5) * 1.6; ctx.lineTo(x, y); }
      }
      ctx.stroke();
    }
    for (let i = 0; i < (w * h) / 90; i++) { // lichen / grime flecks
      ctx.fillStyle = r() < 0.5 ? 'rgba(120,124,112,0.25)' : 'rgba(10,8,6,0.3)';
      ctx.fillRect(x0 + r() * w, y0 + r() * h, 1 + r() * 2, 1 + r() * 2);
    }
  }

  /** Jagged splintered break: pale shards with dark cracks, pointing in direction (dx,dy). */
  function splinters(ctx, r, pts, dx, dy, len) {
    // pts: points along the break line
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const shards = 2 + Math.floor(r() * 3);
      for (let k = 0; k < shards; k++) {
        const f0 = r() * 0.8, f1 = Math.min(1, f0 + 0.15 + r() * 0.35);
        const p0 = { x: lerp(a.x, b.x, f0), y: lerp(a.y, b.y, f0) }, p1 = { x: lerp(a.x, b.x, f1), y: lerp(a.y, b.y, f1) };
        const L = len * (0.3 + r() * r() * 1.4);
        const tip = { x: (p0.x + p1.x) / 2 + dx * L + (r() - 0.5) * L * 0.3, y: (p0.y + p1.y) / 2 + dy * L + (r() - 0.5) * L * 0.3 };
        const g = ctx.createLinearGradient(p0.x, p0.y, tip.x, tip.y);
        g.addColorStop(0, WOOD_PALE[2]); g.addColorStop(0.6, WOOD_PALE[Math.floor(r() * 2)]); g.addColorStop(1, '#e2cfa8');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(tip.x, tip.y); ctx.lineTo(p1.x, p1.y); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(40,28,18,0.6)'; ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(lerp(p0.x, p1.x, 0.5), lerp(p0.y, p1.y, 0.5)); ctx.lineTo(lerp(lerp(p0.x, p1.x, 0.5), tip.x, 0.8), lerp(lerp(p0.y, p1.y, 0.5), tip.y, 0.8)); ctx.stroke();
      }
    }
  }

  function snowBlob(ctx, r, x, y, w, h) {
    ctx.fillStyle = SNOW_SH;
    ctx.beginPath(); ctx.ellipse(x + 1, y + h * 0.35, w, h, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = SNOW;
    ctx.beginPath(); ctx.ellipse(x, y, w, h, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath(); ctx.ellipse(x - w * 0.3, y - h * 0.3, w * 0.4, h * 0.35, 0, 0, TAU); ctx.fill();
  }

  // ------------------------------------------------------------------ stumps and dead trees
  function trunk(seed, snow, { W, H, minH, maxH, branches }) {
    const r = rng(seed), c = canvas(W, H), ctx = c.getContext('2d');
    const base = H - 14, cx = W / 2;
    const h = lerp(minH, maxH, r());
    const bw = 18 + r() * 9, tw = bw * (0.55 + r() * 0.2);
    softShadow(ctx, cx + 6, base + 2, bw * 1.1, 6, 0.45);
    // root flare + trunk outline
    const lean = (r() - 0.5) * 10;
    const L = [{ x: cx - bw / 2 - 7, y: base + 3 }, { x: cx - bw / 2, y: base - 12 }, { x: cx - tw / 2 + lean, y: base - h }];
    const R = [{ x: cx + tw / 2 + lean, y: base - h }, { x: cx + bw / 2, y: base - 12 }, { x: cx + bw / 2 + 8, y: base + 3 }];
    // jagged broken top
    const top = [];
    const n = 4 + Math.floor(r() * 3);
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      top.push({ x: lerp(L[2].x, R[0].x, f), y: base - h - (i % 2 ? r() * 30 + 6 : r() * 8) * (i === 0 || i === n ? 0.3 : 1) });
    }
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(L[0].x, L[0].y);
      ctx.quadraticCurveTo(L[1].x - 2, L[1].y + 6, L[1].x, L[1].y);
      ctx.lineTo(L[2].x, L[2].y);
      for (const p of top) ctx.lineTo(p.x, p.y);
      ctx.lineTo(R[1].x, R[1].y);
      ctx.quadraticCurveTo(R[1].x + 2, R[1].y + 6, R[2].x, R[2].y);
      ctx.closePath();
    };
    path();
    const g = ctx.createLinearGradient(cx - bw / 2, 0, cx + bw / 2, 0);
    g.addColorStop(0, '#77705f'); g.addColorStop(0.28, '#4d463d'); g.addColorStop(0.7, '#2a2520'); g.addColorStop(1, '#141210');
    ctx.fillStyle = g; ctx.fill();
    ctx.save(); path(); ctx.clip();
    bark(ctx, r, cx - bw, base - h - 40, cx + bw, base + 4, 'y');
    // exposed pale wood where bark has been blasted away
    for (let i = 0; i < 1 + r() * 2; i++) {
      const y = base - (0.3 + r() * 0.6) * h, x = cx + (r() - 0.7) * bw * 0.5;
      ctx.fillStyle = WOOD_PALE[2];
      ctx.beginPath(); ctx.ellipse(x, y, 1 + r() * 1.2, 3 + r() * 6, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(60,44,30,0.6)'; ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x, y + 8); ctx.stroke();
    }
    ctx.restore();
    splinters(ctx, r, top, 0, -1, 26);
    // branches (snags only)
    for (let b = 0; b < branches; b++) {
      const y0 = base - h * (0.45 + b * (0.5 / Math.max(1, branches))) + r() * 10;
      const dir = (b % 2 ? 1 : -1) * (r() < 0.8 ? 1 : -1);
      let x = cx + lean * ((base - y0) / h) + dir * tw * 0.35, y = y0;
      let ang = -Math.PI / 2 + dir * (0.6 + r() * 0.6), wdt = 5 + r() * 3;
      const len = 30 + r() * 45;
      const segs = 6;
      const pts = [{ x, y, w: wdt }];
      for (let s = 0; s < segs; s++) {
        ang += (r() - 0.5) * 0.5;
        x += Math.cos(ang) * (len / segs); y += Math.sin(ang) * (len / segs);
        wdt *= 0.78;
        pts.push({ x, y, w: wdt });
      }
      ctx.lineCap = 'round';
      for (let s = 0; s < pts.length - 1; s++) {
        ctx.strokeStyle = '#2a241f'; ctx.lineWidth = pts[s].w;
        ctx.beginPath(); ctx.moveTo(pts[s].x, pts[s].y); ctx.lineTo(pts[s + 1].x, pts[s + 1].y); ctx.stroke();
        ctx.strokeStyle = 'rgba(130,120,105,0.45)'; ctx.lineWidth = pts[s].w * 0.3;
        ctx.beginPath(); ctx.moveTo(pts[s].x - 1, pts[s].y - 1); ctx.lineTo(pts[s + 1].x - 1, pts[s + 1].y - 1); ctx.stroke();
        if (s === 2 || s === 4) { // twig
          const ta = ang + (r() < 0.5 ? 0.7 : -0.7), tl = 10 + r() * 14;
          ctx.strokeStyle = '#2a241f'; ctx.lineWidth = Math.max(1, pts[s].w * 0.45);
          ctx.beginPath(); ctx.moveTo(pts[s].x, pts[s].y); ctx.lineTo(pts[s].x + Math.cos(ta) * tl, pts[s].y + Math.sin(ta) * tl); ctx.stroke();
        }
      }
      const e = pts[pts.length - 1];
      ctx.fillStyle = WOOD_PALE[0];
      ctx.beginPath(); ctx.arc(e.x, e.y, Math.max(1, e.w * 0.6), 0, TAU); ctx.fill();
      if (snow) {
        ctx.strokeStyle = SNOW; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y - pts[0].w * 0.5);
        for (const p of pts.slice(1, 5)) ctx.lineTo(p.x, p.y - p.w * 0.5 - 0.5);
        ctx.stroke();
      }
    }
    if (snow) {
      // snow lodged in the broken top and drifted against the windward foot
      for (const p of top) if (p.y > base - h - 10) snowBlob(ctx, r, p.x, p.y + 2, 3 + r() * 3, 2);
      ctx.fillStyle = 'rgba(200,208,220,0.5)';
      ctx.beginPath(); ctx.ellipse(cx - 6, base + 2, bw * 0.75, 3.5, 0, 0, TAU); ctx.fill();
    }
    return c;
  }

  // ------------------------------------------------------------------ fallen logs
  function log(seed, snow) {
    const r = rng(seed), W = 240, H = 110, c = canvas(W, H), ctx = c.getContext('2d');
    const p0 = { x: 40, y: 38 + r() * 10 }, p1 = { x: 200, y: 66 + r() * 12 };
    const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x), len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const t0 = 11 + r() * 4, t1 = t0 * (0.75 + r() * 0.15);
    softShadow(ctx, (p0.x + p1.x) / 2 + 5, (p0.y + p1.y) / 2 + t0 + 2, len * 0.55, 7, 0.45);
    ctx.save();
    ctx.translate(p0.x, p0.y); ctx.rotate(ang);
    const body = () => {
      ctx.beginPath();
      ctx.moveTo(0, -t0); ctx.lineTo(len, -t1); ctx.lineTo(len, t1); ctx.lineTo(0, t0);
      ctx.ellipse(0, 0, t0 * 0.38, t0, 0, Math.PI / 2, Math.PI * 1.5);
      ctx.closePath();
    };
    body();
    const g = ctx.createLinearGradient(0, -t0, 0, t0);
    g.addColorStop(0, '#7a7163'); g.addColorStop(0.35, '#4a433a'); g.addColorStop(0.8, '#221e1a'); g.addColorStop(1, '#141210');
    ctx.fillStyle = g; ctx.fill();
    ctx.save(); body(); ctx.clip(); bark(ctx, r, -10, -t0, len + 6, t0, 'x'); ctx.restore();
    // cut / rotted end grain at p0
    ctx.fillStyle = '#8f7b5d';
    ctx.beginPath(); ctx.ellipse(0, 0, t0 * 0.38, t0 * 0.95, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(70,52,34,0.7)'; ctx.lineWidth = 0.7;
    for (let k = 1; k < 4; k++) { ctx.beginPath(); ctx.ellipse(0, 0, t0 * 0.38 * k / 4, t0 * 0.95 * k / 4, 0, 0, TAU); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(30,22,14,0.8)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, -t0 * 0.6); ctx.lineTo(-1, t0 * 0.2); ctx.stroke();
    // broken branch stub on top
    const bx = len * (0.35 + r() * 0.3);
    ctx.strokeStyle = '#2b251f'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(bx, -t0 * 0.6); ctx.lineTo(bx + 8, -t0 - 14); ctx.stroke();
    ctx.fillStyle = WOOD_PALE[0]; ctx.beginPath(); ctx.arc(bx + 8, -t0 - 14, 2, 0, TAU); ctx.fill();
    // splintered break at p1
    const br = [];
    for (let k = 0; k <= 5; k++) br.push({ x: len - 2 + (k % 2 ? 4 : 0), y: lerp(-t1, t1, k / 5) });
    splinters(ctx, r, br, 1, 0, 22);
    if (snow) {
      ctx.fillStyle = SNOW_SH;
      ctx.beginPath(); ctx.moveTo(-2, -t0 * 0.7); ctx.lineTo(len, -t1 * 0.7); ctx.lineTo(len, -t1 - 2); ctx.lineTo(-2, -t0 - 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = SNOW;
      ctx.beginPath(); ctx.moveTo(-2, -t0 * 0.8);
      for (let x = 0; x <= len; x += 10) ctx.lineTo(x, lerp(-t0, -t1, x / len) - 2 - r() * 3);
      ctx.lineTo(len, -t1 * 0.75); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    return c;
  }

  // ------------------------------------------------------------------ barbed wire (one tile run)
  // Sprite plane: x runs along the belt (L px = one tile), y is vertical, ground line at GY.
  const WL = 120, WH = 84, GY = 70;
  function wireStroke(ctx, pts, w = 1.1) {
    ctx.lineWidth = w + 0.8; ctx.strokeStyle = 'rgba(20,12,8,0.75)';
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y + 0.6) : ctx.moveTo(p.x, p.y + 0.6))); ctx.stroke();
    ctx.lineWidth = w; ctx.strokeStyle = '#6e4530';
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
    ctx.lineWidth = w * 0.45; ctx.strokeStyle = 'rgba(176,128,92,0.7)';
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y - 0.4) : ctx.moveTo(p.x, p.y - 0.4))); ctx.stroke();
  }
  function barbs(ctx, r, pts, every = 7) {
    ctx.strokeStyle = '#5a3828'; ctx.lineWidth = 0.9;
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (acc < every) continue;
      acc = 0;
      const p = pts[i];
      ctx.beginPath(); ctx.moveTo(p.x - 1.8, p.y - 1.8); ctx.lineTo(p.x + 1.8, p.y + 1.8); ctx.moveTo(p.x + 1.8, p.y - 1.8); ctx.lineTo(p.x - 1.8, p.y + 1.8); ctx.stroke();
    }
  }
  function post(ctx, x0, y0, x1, y1, w) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#211b16'; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.strokeStyle = 'rgba(120,108,92,0.75)'; ctx.lineWidth = w * 0.35;
    const nx = -(y1 - y0), ny = x1 - x0, nl = Math.hypot(nx, ny) || 1;
    const ox = (nx / nl) * w * 0.25, oy = (ny / nl) * w * 0.25;
    ctx.beginPath(); ctx.moveTo(x0 - Math.abs(ox), y0 - Math.abs(oy)); ctx.lineTo(x1 - Math.abs(ox), y1 - Math.abs(oy)); ctx.stroke();
  }
  function wire(seed, snow, damaged) {
    const r = rng(seed), c = canvas(WL, WH), ctx = c.getContext('2d');
    softShadow(ctx, WL / 2 + 6, GY + 2, WL * 0.55, 5, 0.42);
    const frames = damaged ? [20 + r() * 10] : [18, 102];
    const tops = [];
    // concertina coil: helix along the run, back half dim, front half bright
    const cy = damaged ? GY - 12 : GY - 26, rv = damaged ? 12 : 24, rd = 9, pitch = damaged ? 11 : 12;
    const back = [], front = [];
    for (let t = 0, x0 = -6; x0 + t * pitch / TAU < WL + 6; t += 0.18) {
      if (damaged && r() < 0.012) t += TAU * (0.5 + r()); // gaps where the coil is cut
      const x = x0 + (t * pitch) / TAU + Math.sin(t) * rd, y = cy - Math.cos(t) * rv * (0.9 + 0.2 * Math.sin(t * 0.37)) + (damaged ? Math.max(0, Math.cos(t)) * 6 : 0);
      (Math.sin(t) < 0 ? back : front).push({ x, y, t });
    }
    const runs = (arr) => { const out = []; let cur = []; for (let i = 0; i < arr.length; i++) { if (i && arr[i].t - arr[i - 1].t > 0.25) { out.push(cur); cur = []; } cur.push(arr[i]); } if (cur.length) out.push(cur); return out; };
    ctx.globalAlpha = 0.65;
    for (const seg of runs(back)) wireStroke(ctx, seg, 1.3);
    ctx.globalAlpha = 1;
    // knife-rest X frames
    
    for (const fx of frames) {
      const tilt = damaged ? (r() - 0.5) * 22 : (r() - 0.5) * 3;
      const hgt = damaged ? 22 + r() * 14 : 44 + r() * 4;
      post(ctx, fx - 14, GY + 1, fx + 10 + tilt, GY - hgt, 5);
      post(ctx, fx + 14, GY + 1, fx - 10 + tilt, GY - hgt, 5);
      tops.push({ x: fx + tilt * 0.5, y: GY - hgt * 0.62 });
    }
    // longitudinal bar
    if (!damaged) for (const tp of tops) post(ctx, tp.x - 7, tp.y + 1, tp.x + 7, tp.y - 1, 2.6); // short binding bar at each X
    else post(ctx, tops[0].x - 6, tops[0].y, tops[0].x + 30 + r() * 20, GY - 2, 3.4);
    // barbed strands
    const strands = 1;
    for (let k = 0; k < strands; k++) {
      const y = GY - 10 - k * 14 - r() * 3, sag = 3 + r() * 4;
      const pts = [];
      for (let x = -4; x <= WL + 4; x += 3) pts.push({ x, y: y + Math.sin((x / WL) * Math.PI) * sag });
      if (damaged) { const cut = Math.floor(pts.length * (0.3 + r() * 0.4)); pts.length = cut; pts.push({ x: pts[cut - 1].x + 8, y: GY - 1 }); }
      ctx.globalAlpha = 0.7; wireStroke(ctx, pts, 0.7); barbs(ctx, r, pts, 10); ctx.globalAlpha = 1;
    }
    for (const seg of runs(front)) { wireStroke(ctx, seg, 1.8); barbs(ctx, r, seg, 8); }
    if (snow) {
      ctx.fillStyle = SNOW;
      if (!damaged) for (const tp of tops) ctx.fillRect(tp.x - 7, tp.y - 3, 14, 1.5);
      for (const p of front) if (Math.cos(p.t) > 0.85 && r() < 0.5) { ctx.beginPath(); ctx.ellipse(p.x, p.y - 1, 1.8, 1, 0, 0, TAU); ctx.fill(); }
    }
    return c;
  }

  // ------------------------------------------------------------------ sandbag
  function sandbag(seed, snow) {
    const r = rng(seed), W = 36, H = 24, c = canvas(W, H), ctx = c.getContext('2d');
    softShadow(ctx, W / 2 + 1.5, H - 6, 15, 3.5, 0.5);
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(4, 12);
      ctx.bezierCurveTo(4, 4, 12, 3, 18, 4); ctx.bezierCurveTo(26, 3, 33, 5, 32, 12);
      ctx.bezierCurveTo(33, 18, 26, 19, 18, 18.5); ctx.bezierCurveTo(10, 19, 3, 18, 4, 12);
      ctx.closePath();
    };
    path();
    const g = ctx.createRadialGradient(13, 7, 1, 18, 12, 18);
    g.addColorStop(0, '#a8a090'); g.addColorStop(0.55, '#77705f'); g.addColorStop(1, '#3c372f');
    ctx.fillStyle = g; ctx.fill();
    ctx.save(); path(); ctx.clip();
    for (let i = 0; i < 140; i++) { // burlap weave
      ctx.fillStyle = r() < 0.5 ? 'rgba(30,26,20,0.25)' : 'rgba(200,190,170,0.18)';
      ctx.fillRect(2 + r() * 32, 2 + r() * 18, 1, 1);
    }
    ctx.strokeStyle = 'rgba(40,34,26,0.5)'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(8, 11.5); ctx.quadraticCurveTo(18, 13, 29, 11); ctx.stroke(); // seam
    ctx.restore();
    ctx.strokeStyle = 'rgba(20,16,12,0.7)'; ctx.lineWidth = 0.8; path(); ctx.stroke();
    ctx.fillStyle = '#4a4336'; ctx.beginPath(); ctx.ellipse(31.5, 11, 2.2, 3, 0.3, 0, TAU); ctx.fill(); // tied end
    if (snow) {
      ctx.fillStyle = SNOW_SH; ctx.beginPath(); ctx.ellipse(18, 6.8, 12, 3.2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = SNOW; ctx.beginPath(); ctx.ellipse(17.5, 5.8, 11, 2.7, 0, 0, TAU); ctx.fill();
    }
    return c;
  }

  // ------------------------------------------------------------------ battlefield debris (planks, branches, a helmet)
  function debris(seed, snow) {
    const r = rng(seed), W = 90, H = 54, c = canvas(W, H), ctx = c.getContext('2d');
    for (let i = 0; i < 6; i++) {
      const x = 10 + r() * 70, y = 14 + r() * 30, a = (r() - 0.5) * 1.6, l = 12 + r() * 26;
      const plank = r() < 0.4;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      softShadow(ctx, 2, 3, l * 0.5, 2.5, 0.35);
      if (plank) {
        ctx.fillStyle = '#4b4136'; ctx.fillRect(-l / 2, -2.5, l, 5);
        ctx.fillStyle = 'rgba(150,135,110,0.5)'; ctx.fillRect(-l / 2, -2.5, l, 1.2);
        ctx.fillStyle = WOOD_PALE[0]; ctx.fillRect(l / 2 - 2, -2.5, 2, 5);
      } else {
        ctx.strokeStyle = '#2a241f'; ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-l / 2, 0); ctx.quadraticCurveTo(0, -3, l / 2, 1); ctx.stroke();
        ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, -1.5); ctx.lineTo(5, -7); ctx.stroke();
      }
      if (snow) { ctx.fillStyle = SNOW; ctx.fillRect(-l / 2, -3.2, l, 1.3); }
      ctx.restore();
    }
    return c;
  }

  window.makeSprites = function () {
    const out = {};
    for (const snow of [false, true]) {
      const sfx = snow ? '_snow' : '';
      for (let i = 0; i < 4; i++) out[`stump${i}${sfx}`] = trunk(100 + i, snow, { W: 84, H: 190, minH: 50, maxH: 130, branches: i === 3 ? 1 : 0 });
      for (let i = 0; i < 2; i++) out[`tree${i}${sfx}`] = trunk(200 + i, snow, { W: 180, H: 300, minH: 170, maxH: 250, branches: 4 + i });
      for (let i = 0; i < 3; i++) out[`log${i}${sfx}`] = log(300 + i, snow);
      for (let i = 0; i < 3; i++) out[`wire${i}${sfx}`] = wire(400 + i, snow, false);
      for (let i = 0; i < 2; i++) out[`wiredmg${i}${sfx}`] = wire(500 + i, snow, true);
      for (let i = 0; i < 3; i++) out[`sandbag${i}${sfx}`] = sandbag(600 + i, snow);
      for (let i = 0; i < 3; i++) out[`debris${i}${sfx}`] = debris(700 + i, snow);
    }
    return out;
  };
})();
