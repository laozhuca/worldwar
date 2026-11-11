// Posable WW1 infantryman for the offline renderer, with per-nation uniforms taken from the reference art.
// Built in metres in a local frame (f = forward, s = left, z = up) and scaled to world units (1 = tile).
import { sdCapsule, sdRoundBox, vnoise, fbm, hash, clamp, mix3 } from './core.mjs';

export const K = 0.195; // metres -> world units (a 1.75 m man is ~0.34 tile tall)

export const NATIONS = {
  uk:      { name: 'Britain',         alliance: 'allied',  uni: [0.42, 0.33, 0.2],  putt: [0.5, 0.41, 0.26],  web: [0.62, 0.53, 0.35], hat: [0.36, 0.33, 0.21], hat2: [0.3, 0.27, 0.18], head: 'brodie' },
  france:  { name: 'France',          alliance: 'allied',  uni: [0.36, 0.42, 0.53], putt: [0.33, 0.37, 0.45], web: [0.36, 0.23, 0.14], hat: [0.3, 0.35, 0.44], hat2: [0.6, 0.48, 0.25], head: 'adrian', coat: true },
  usa:     { name: 'United States',   alliance: 'allied',  uni: [0.37, 0.3, 0.19],  putt: [0.43, 0.36, 0.24], web: [0.58, 0.5, 0.34],  hat: [0.31, 0.29, 0.2],  hat2: [0.25, 0.23, 0.16], head: 'brodie' },
  italy:   { name: 'Italy',           alliance: 'allied',  uni: [0.3, 0.32, 0.27],  putt: [0.31, 0.33, 0.28], web: [0.36, 0.23, 0.14], hat: [0.34, 0.36, 0.31], hat2: [0.5, 0.42, 0.25], head: 'adrian' },
  russia:  { name: 'Russia',          alliance: 'allied',  uni: [0.39, 0.34, 0.25], putt: [0.38, 0.33, 0.25], web: [0.55, 0.48, 0.33], hat: [0.41, 0.38, 0.25], hat2: [0.06, 0.06, 0.06], head: 'peaked', coat: true },
  germany: { name: 'Germany',         alliance: 'central', uni: [0.31, 0.32, 0.28], putt: [0.3, 0.31, 0.27],  web: [0.34, 0.21, 0.13], hat: [0.07, 0.07, 0.07], hat2: [0.72, 0.56, 0.25], head: 'pickelhaube' },
  austria: { name: 'Austria-Hungary', alliance: 'central', uni: [0.38, 0.39, 0.4],  putt: [0.37, 0.38, 0.39], web: [0.36, 0.22, 0.13], hat: [0.39, 0.4, 0.41], hat2: [0.66, 0.54, 0.26], head: 'kepi' },
  ottoman: { name: 'Ottoman Empire',  alliance: 'central', uni: [0.41, 0.34, 0.24], putt: [0.4, 0.34, 0.25],  web: [0.38, 0.23, 0.13], hat: [0.52, 0.1, 0.08], hat2: [0.05, 0.05, 0.05], head: 'fez' },
};
const SKIN = [0.72, 0.55, 0.43], BOOT = [0.22, 0.17, 0.12], WOOD = [0.38, 0.21, 0.12], METAL = [0.18, 0.18, 0.19], STEEL = [0.55, 0.56, 0.58];

// ------------------------------------------------------------------ poses
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => mul(a, 1 / (len(a) || 1));

function leg(hip, thigh, knee) {
  const k = add(hip, [Math.sin(thigh) * 0.45, 0, -Math.cos(thigh) * 0.45]);
  const sh = thigh - knee;
  const a = add(k, [Math.sin(sh) * 0.44, 0, -Math.cos(sh) * 0.44]);
  return { hip, knee: k, ankle: a, toe: add(a, [0.16, 0, -0.04]) };
}
/** Elbow from shoulder + hand by two-bone IK, bending down/outward. */
function elbow(sh, hand, side) {
  const d = sub(hand, sh), L = len(d), a = 0.3, b = 0.28;
  const m = add(sh, mul(d, 0.5));
  const h = Math.sqrt(Math.max(0, a * a - (Math.min(L, a + b - 0.001) / 2) ** 2)) * 1.05;
  const bend = norm(add([0, side * 0.6, -1], mul(norm(d), 0.2)));
  return add(m, mul(bend, h));
}

/** Returns joints for a named pose and animation frame. */
export function pose(name, frame = 0) {
  let P = [0, 0, 0.94], lean = 0.04, legs, hands, rifleMode = 'port', head = null, tool = null;
  const hipL = (p) => add(p, [0, 0.1, 0]), hipR = (p) => add(p, [0, -0.1, 0]);
  let sway = 0, carry = [0, 0, 0];
  if (name === 'walk' || name === 'charge') {
    // Gait cycle (8 frames). Per leg: thigh swings sinusoidally; the knee is nearly straight through
    // stance and flexes during swing (peaking just after toe-off). Pelvis is highest at mid-stance and
    // lowest at heel strike (walk); a run is highest in the flight phase, with a deeper knee bend.
    const run = name === 'charge', ph = (frame / 8) * Math.PI * 2;
    const amp = run ? 0.72 : 0.36, kSwing = run ? 1.45 : 0.62, kStance = run ? 0.32 : 0.1;
    const legAt = (q) => {
      const thigh = Math.sin(q) * amp;
      const swing = Math.max(0, Math.sin(q - 0.9)); // swing phase follows toe-off
      return [thigh, kStance + kSwing * swing * swing];
    };
    const [tL, kL] = legAt(ph), [tR, kR] = legAt(ph + Math.PI);
    lean = run ? 0.4 + 0.04 * Math.cos(2 * ph) : 0.07;
    const bob = run ? 0.05 * Math.max(0, Math.cos(2 * ph)) - 0.1 : 0.022 * Math.abs(Math.cos(ph)) - 0.025;
    sway = (run ? 0.018 : 0.028) * Math.sin(ph); // weight shifts over the stance leg
    P = [0, sway, 0.94 + bob];
    legs = [leg(hipL(P), tL, kL), leg(hipR(P), tR, kR)];
    carry = run ? [0.05 * Math.sin(ph), 0.02 * Math.sin(ph), 0.02 * Math.cos(2 * ph)] : [0.015 * Math.sin(ph), 0.015 * Math.sin(ph), 0.01 * Math.cos(2 * ph)];
    if (run) rifleMode = 'charge';
  } else if (name === 'stand' || name === 'fire') {
    legs = [leg(hipL(P), 0.12, 0.05), leg(hipR(P), -0.1, 0.04)];
    if (name === 'fire') { rifleMode = 'aim'; lean = 0.1; }
  } else if (name === 'trench') {
    legs = [leg(hipL(P), 0.12, 0.05), leg(hipR(P), -0.1, 0.04)];
    rifleMode = 'aim'; lean = 0.15;
  } else if (name === 'dig') {
    lean = 0.75; P = [-0.05, 0, 0.86];
    legs = [leg(hipL(P), 0.35, 0.35), leg(hipR(P), -0.25, 0.25)];
    rifleMode = 'none';
    const up = frame % 2;
    tool = { a: [0.25, -0.12, up ? 1.0 : 0.82], b: [up ? 0.7 : 0.85, -0.02, up ? 0.35 : 0.04] };
  } else if (name === 'prone' || name === 'dead') {
    return lying(name);
  } else if (name === 'crawl') {
    return crawling(frame);
  }
  const up = [Math.sin(lean), 0, Math.cos(lean)];
  const chest = add(P, mul(up, 0.42)), neck = add(P, mul(up, 0.56));
  head = head || add(P, mul(up, 0.71));
  const shL = add(add(P, mul(up, 0.5)), [0, 0.2, 0]), shR = add(add(P, mul(up, 0.5)), [0, -0.2, 0]);
  let hR, hL, rifle = null;
  if (rifleMode === 'port') { hR = add(add(P, [0.22, -0.16, 0.08]), carry); hL = add(add(P, [0.38, 0.06, 0.26]), carry); }
  else if (rifleMode === 'charge') { hR = add(add(P, [0.3 + lean * 0.3, -0.14, 0.05 + lean * 0.15]), carry); hL = add(add(P, [0.66 + lean * 0.4, -0.06, 0.13 + lean * 0.2]), carry); }
  else if (rifleMode === 'aim') { hR = add(neck, [0.16, -0.14, -0.12]); hL = add(neck, [0.52, -0.06, -0.15]); head = add(head, [0.05, -0.03, -0.03]); }
  else { hR = tool.a; hL = add(tool.a, mul(norm(sub(tool.b, tool.a)), 0.35)); }
  if (rifleMode !== 'none') {
    const dir = norm(sub(hL, hR));
    rifle = { butt: add(hR, mul(dir, rifleMode === 'aim' ? -0.18 : -0.32)), muzzle: add(hR, mul(dir, 0.95)), bayonet: rifleMode === 'charge' };
  }
  return { P, up, chest, neck, head, shL, shR, elL: elbow(shL, hL, 1), elR: elbow(shR, hR, -1), hL, hR, legs, rifle, tool, cut: name === 'trench' ? 1.12 : null };
}

/** Leopard crawl (6 frames): one knee drawn up and the opposite elbow reaching forward, alternating;
 *  the rifle is cradled across the forearms and the body rocks slightly. */
function crawling(frame) {
  const ph = (frame / 6) * Math.PI * 2, z = 0.12, a = Math.sin(ph);
  const surge = 0.04 * Math.cos(ph), roll = 0.02 * a;
  const P = [surge, 0, z], up = [1, 0, 0.05];
  const chest = [0.42 + surge, roll, z + 0.035], neck = [0.56 + surge, roll, z + 0.05], head = [0.72 + surge, roll, z + 0.12];
  const shL = [0.5 + surge, 0.2, z + 0.05], shR = [0.5 + surge, -0.2, z + 0.05];
  const kn = (s, side) => { const d = Math.max(0, s); return { knee: [-0.42 + 0.22 * d, side * (0.15 + 0.16 * d), 0.09], ankle: [-0.85 + 0.12 * d, side * (0.2 + 0.06 * d), 0.08], toe: [-0.93 + 0.12 * d, side * (0.24 + 0.06 * d), 0.15] }; };
  const legs = [{ hip: [surge, 0.1, z], ...kn(a, 1) }, { hip: [surge, -0.1, z], ...kn(-a, -1) }];
  const reachL = 0.12 * Math.max(0, -a), reachR = 0.12 * Math.max(0, a);
  const hL = [0.92 + surge + reachL, 0.08, 0.13], hR = [0.74 + surge + reachR, -0.1, 0.12];
  const dir = norm(sub(hL, hR));
  const rifle = { butt: add(hR, mul(dir, -0.25)), muzzle: add(hR, mul(dir, 0.9)), bayonet: false };
  const elL = [0.66 + surge + reachL * 0.6, 0.27, 0.05], elR = [0.6 + surge + reachR * 0.6, -0.27, 0.05];
  return { P, up, chest, neck, head, shL, shR, elL, elR, hL, hR, legs, rifle, tool: null, cut: null, lying: true, dead: false };
}

function lying(name) {
  const dead = name === 'dead', z = 0.13;
  const P = [0, 0, z], up = [1, 0, 0.06];
  const chest = [0.42, 0, z + 0.03], neck = [0.56, 0, z + 0.04], head = [0.72, dead ? 0.05 : 0, z + (dead ? 0.0 : 0.1)];
  const shL = [0.5, 0.2, z + 0.04], shR = [0.5, -0.2, z + 0.04];
  const legs = [
    { hip: [0, 0.1, z], knee: [-0.45, dead ? 0.24 : 0.14, 0.1], ankle: [-0.88, dead ? 0.3 : 0.2, 0.08], toe: [-0.95, dead ? 0.36 : 0.24, 0.16] },
    { hip: [0, -0.1, z], knee: [-0.45, -0.14, 0.1], ankle: [-0.88, -0.2, 0.08], toe: [-0.95, -0.24, 0.16] },
  ];
  let hL, hR, rifle;
  if (dead) {
    hL = [0.35, 0.55, 0.06]; hR = [0.75, -0.45, 0.06];
    rifle = { butt: [0.1, -0.6, 0.04], muzzle: [1.15, -0.85, 0.04], bayonet: false };
  } else {
    hR = [0.68, -0.12, 0.2]; hL = [0.98, -0.02, 0.16];
    const dir = norm(sub(hL, hR));
    rifle = { butt: add(hR, mul(dir, -0.2)), muzzle: add(hR, mul(dir, 0.95)), bayonet: false };
  }
  return { P, up, chest, neck, head, shL, shR, elL: add(mul(add(shL, hL), 0.5), [0, 0.06, -0.04]), elR: add(mul(add(shR, hR), 0.5), [0, -0.06, -0.04]), hL, hR, legs, rifle, tool: null, cut: null, lying: true, dead };
}

// ------------------------------------------------------------------ geometry
function headgear(nat, p, h) {
  // returns [dist, mat] relative to head centre h (head radius 0.105)
  const x = p[0] - h[0], y = p[1] - h[1], z = p[2] - h[2];
  const r2 = Math.hypot(x, y);
  switch (nat.head) {
    case 'brodie': {
      const dome = Math.max(Math.hypot(x, y, (z - 0.03) * 1.25) - 0.125, -(z - 0.035));
      const brim = Math.max(r2 - 0.19, Math.abs(z - 0.04) - 0.007);
      return [Math.min(dome, brim), 'hat'];
    }
    case 'adrian': {
      const dome = Math.max(Math.hypot(x, y, (z - 0.03) * 0.95) - 0.122, -(z - 0.03));
      const brim = Math.max(Math.hypot(x * 0.82, y * 1.15) - 0.15, Math.abs(z - 0.032 + x * 0.12) - 0.006);
      const crest = sdRoundBox(x + 0.01, y, z - 0.15, 0.11, 0.008, 0.02, 0.006);
      return [Math.min(dome, brim, crest), 'hat'];
    }
    case 'fez': {
      const t = clamp((z - 0.04) / 0.16, 0, 1);
      const cone = Math.max(r2 - (0.105 - 0.022 * t), Math.abs(z - 0.12) - 0.08);
      const tassel = sdCapsule(x, y, z, 0, 0, 0.2, -0.1, 0.02, 0.08, 0.014, 0.022);
      return tassel < cone ? [tassel, 'hat2'] : [cone, 'hat'];
    }
    case 'peaked': {
      const band = Math.max(r2 - 0.112, Math.abs(z - 0.06) - 0.035);
      const crown = Math.max(Math.hypot(x * 0.95, y) - 0.135, Math.abs(z - 0.1) - 0.02);
      const visor = Math.max(Math.hypot(x - 0.05, y) - 0.13, Math.max(Math.abs(z - 0.035 + (x - 0.1) * 0.25) - 0.006, -x + 0.06));
      return visor < Math.min(band, crown) ? [visor, 'hat2'] : [Math.min(band, crown), 'hat'];
    }
    case 'pickelhaube': {
      const dome = Math.max(Math.hypot(x, y, (z - 0.02) * 0.85) - 0.125, -(z - 0.02));
      const visor = Math.max(Math.hypot(x * 0.8, y * 1.2) - 0.14, Math.abs(z - 0.025 + x * 0.15) - 0.006);
      const spike = sdCapsule(x, y, z, 0, 0, 0.14, 0, 0, 0.25, 0.022, 0.006);
      const plate = Math.hypot(x - 0.115, y, z - 0.08) - 0.03;
      const brass = Math.min(spike, plate);
      return brass < Math.min(dome, visor) ? [brass, 'hat2'] : [Math.min(dome, visor), 'hat'];
    }
    case 'kepi': {
      const cap = sdRoundBox(x - 0.005, y, z - 0.09, 0.115, 0.105, 0.065, 0.03);
      const visor = Math.max(Math.hypot(x - 0.06, y) - 0.11, Math.max(Math.abs(z - 0.035 + (x - 0.1) * 0.3) - 0.006, -x + 0.07));
      const badge = Math.hypot(x - 0.118, y, z - 0.1) - 0.017;
      if (badge < Math.min(cap, visor)) return [badge, 'hat2'];
      return [Math.min(cap, visor), 'hat'];
    }
  }
  return [1, 'hat'];
}

/** Build {sdf, shade} in local metres for a pose. */
function figure(nat, J, seed) {
  const prims = [];
  const cap = (a, b, ra, rb, mat) => prims.push({ k: 'c', a, b, ra, rb, mat });
  // legs: trousers to knee, puttees, boots
  for (const L of J.legs) {
    cap(L.hip, L.knee, 0.085, 0.07, 'trou');
    cap(L.knee, L.ankle, 0.062, 0.05, 'putt');
    cap(L.ankle, L.toe, 0.055, 0.045, 'boot');
  }
  // torso (two overlapping capsules for a broad chest), arms, head
  cap(J.P, J.chest, 0.15, 0.16, 'uni');
  cap(add(J.chest, [0, 0.1, 0]), add(J.chest, [0, -0.1, 0]), 0.12, 0.12, 'uni');
  cap(J.chest, J.neck, 0.1, 0.06, 'uni');
  cap(J.shL, J.elL, 0.058, 0.05, 'uni'); cap(J.elL, J.hL, 0.05, 0.042, 'uni');
  cap(J.shR, J.elR, 0.058, 0.05, 'uni'); cap(J.elR, J.hR, 0.05, 0.042, 'uni');
  prims.push({ k: 's', c: J.hL, r: 0.042, mat: 'skin' }, { k: 's', c: J.hR, r: 0.042, mat: 'skin' });
  prims.push({ k: 's', c: J.head, r: 0.105, mat: 'skin' });
  // equipment: belt with pouches, pack + bedroll, canteen
  const fwd = J.lying ? [0, 0, J.dead ? 1 : -1] : [1, 0, 0]; // belly direction
  const belt = add(J.P, mul(J.up, 0.12));
  cap(add(belt, [0, 0.16, 0]), add(belt, [0, -0.16, 0]), 0.165, 0.165, 'webT');
  for (const s of [-0.1, 0.1]) prims.push({ k: 'b', c: add(belt, add(mul(fwd, 0.15), [0, s, 0.02])), h: [0.03, 0.055, 0.045], r: 0.012, mat: 'web' });
  const back = mul(fwd, -1), packC = add(add(J.P, mul(J.up, 0.38)), mul(back, 0.2));
  prims.push({ k: 'b', c: packC, h: [0.07, 0.15, 0.14], r: 0.04, mat: 'pack' });
  cap(add(add(packC, mul(J.up, 0.16)), [0, 0.17, 0]), add(add(packC, mul(J.up, 0.16)), [0, -0.17, 0]), 0.06, 0.06, 'pack');
  prims.push({ k: 's', c: add(add(belt, mul(back, 0.08)), [0, 0.2, -0.06]), r: 0.055, mat: 'metal2' });
  // webbing straps over the shoulders
  cap(add(J.shL, mul(fwd, 0.08)), add(belt, add(mul(fwd, 0.14), [0, 0.08, 0])), 0.022, 0.022, 'web');
  cap(add(J.shR, mul(fwd, 0.08)), add(belt, add(mul(fwd, 0.14), [0, -0.08, 0])), 0.022, 0.022, 'web');
  if (nat.coat && !J.lying) prims.push({ k: 'skirt', top: add(J.P, mul(J.up, 0.05)), mat: 'uni' });
  // rifle / shovel
  if (J.rifle) {
    const R = J.rifle, d = norm(sub(R.muzzle, R.butt));
    const stockEnd = add(R.butt, mul(d, 0.85));
    cap(R.butt, add(R.butt, mul(d, 0.3)), 0.032, 0.024, 'wood');
    cap(add(R.butt, mul(d, 0.3)), stockEnd, 0.022, 0.018, 'wood');
    cap(add(R.butt, mul(d, 0.4)), R.muzzle, 0.012, 0.01, 'metal');
    if (R.bayonet) cap(R.muzzle, add(R.muzzle, mul(d, 0.3)), 0.008, 0.003, 'steel');
  }
  if (J.tool) {
    cap(J.tool.a, J.tool.b, 0.018, 0.018, 'wood');
    const d = norm(sub(J.tool.b, J.tool.a));
    prims.push({ k: 'b', c: add(J.tool.b, mul(d, 0.08)), h: [0.09, 0.08, 0.012], r: 0.006, mat: 'steel' });
  }

  const dPrim = (q, p) => {
    switch (q.k) {
      case 'c': return sdCapsule(p[0], p[1], p[2], q.a[0], q.a[1], q.a[2], q.b[0], q.b[1], q.b[2], q.ra, q.rb);
      case 's': return Math.hypot(p[0] - q.c[0], p[1] - q.c[1], p[2] - q.c[2]) - q.r;
      case 'b': return sdRoundBox(p[0] - q.c[0], p[1] - q.c[1], p[2] - q.c[2], q.h[0], q.h[1], q.h[2], q.r);
      case 'skirt': {
        const zz = q.top[2] - p[2];
        if (zz < -0.02) return -zz - 0.02 + 0.2;
        const t = clamp(zz / 0.5, 0, 1);
        return Math.max(Math.hypot(p[0] - q.top[0] + 0.02, (p[1] - q.top[1]) * 0.95) - (0.17 + 0.1 * t), Math.abs(zz - 0.25) - 0.25);
      }
    }
    return 1;
  };
  const eval_ = (p) => {
    let d = 1e9, mat = 'uni';
    for (const q of prims) { const v = dPrim(q, p); if (v < d) { d = v; mat = q.mat; } }
    if (!J.lying || true) {
      const [hd, hm] = headgear(nat, p, J.head);
      if (hd < d) { d = hd; mat = hm; }
    }
    if (J.cut != null) d = Math.max(d, J.cut - p[2]);
    return [d, mat];
  };
  const colour = (mat, p) => {
    const n = fbm(p[0] * 40 + seed, p[1] * 40, p[2] * 40, 3);
    const grime = clamp((0.5 - p[2]) * 1.4, 0, 0.6) * (fbm(p[0] * 12, p[1] * 12, p[2] * 12, 2) + 0.3);
    let c;
    switch (mat) {
      case 'uni': case 'trou': c = mix3(mul(nat.uni, 0.82), mul(nat.uni, 1.1), n); break;
      case 'putt': c = ((p[2] * 60) % 1) < 0.25 ? mul(nat.putt, 0.75) : nat.putt; break;
      case 'boot': return BOOT;
      case 'skin': return mix3(SKIN, [0.55, 0.4, 0.32], n * 0.5);
      case 'hat': c = mix3(mul(nat.hat, 0.85), mul(nat.hat, 1.15), n); break;
      case 'hat2': return nat.hat2;
      case 'web': case 'webT': c = mix3(mul(nat.web, 0.85), nat.web, n); break;
      case 'pack': c = mix3(mul(nat.web[0] > 0.5 ? nat.web : [0.5, 0.44, 0.32], 0.85), nat.web[0] > 0.5 ? nat.web : [0.5, 0.44, 0.32], n); break;
      case 'metal2': return [0.3, 0.3, 0.28];
      case 'wood': return mix3(mul(WOOD, 0.8), WOOD, n);
      case 'metal': return METAL;
      case 'steel': return STEEL;
      default: c = nat.uni;
    }
    return mix3(c, [0.12, 0.1, 0.08], grime * 0.6);
  };
  return { eval: eval_, colour };
}

/**
 * Scene for one soldier sprite. view 'a': facing world +x (toward camera, screen right-down);
 * view 'b': facing world -y (away, screen right-up). The game mirrors these for the other two.
 */
export function soldierScene(nationKey, poseName, frame, view, portrait = false) {
  const nat = NATIONS[nationKey];
  const J = pose(poseName, frame);
  const fig = figure(nat, J, hash(nationKey.length, frame) * 10);
  const th = view === 'a' ? 0 : -Math.PI / 2, c = Math.cos(th), s = Math.sin(th);
  const zoff = J.cut != null ? J.cut : 0; // trench pose: parapet line at z = 0
  const toLocal = (x, y, z) => [(x * c + y * s) / K, (-x * s + y * c) / K, z / K + zoff];
  const ground = J.cut == null && !portrait;
  const sdf = (x, y, z) => {
    const p = toLocal(x, y, z);
    const d = fig.eval(p)[0] * K;
    return ground ? Math.min(d, z) : d;
  };
  const shade = (x, y, z, nx, ny, nz) => {
    const p = toLocal(x, y, z);
    const [d, mat] = fig.eval(p);
    if (ground && z < d * K) return { kind: 'catcher' };
    const col = fig.colour(mat, p);
    const spec = mat === 'hat' && (nat.head === 'brodie' || nat.head === 'adrian' || nat.head === 'pickelhaube') ? 0.35 : mat === 'metal' || mat === 'steel' || mat === 'hat2' ? 0.6 : 0.03;
    return { kind: 'solid', col, spec, shin: 30 };
  };
  if (portrait) { const P = 0.5 * K; return { bounds: [-P, -P, 0, P + 0.4 * K, P, 1.95 * K], sdf, shade, supersample: 3 }; }
  const E = 1.3 * K;
  return { bounds: [-E, -E, J.cut != null ? -0.01 : -0.01, E + 0.25, E + 0.2, (2.0 - zoff) * K], sdf, shade, supersample: 3 };
}

/** All sprite jobs: [name, args]. */
export const SOLDIER_POSES = [['stand', 1], ['walk', 8], ['charge', 8], ['crawl', 6], ['fire', 1], ['trench', 1], ['prone', 1], ['dig', 2], ['dead', 1]];

void vnoise;
