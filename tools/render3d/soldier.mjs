// Posable WW1 infantryman for the offline renderer, with per-nation uniforms taken from the reference art.
// Built in metres in a local frame (f = forward, s = left, z = up) and scaled to world units (1 = tile).
import { sdCapsule, sdRoundBox, vnoise, fbm, hash, clamp, mix3 } from './core.mjs';

export const K = 0.195; // metres -> world units (a 1.75 m man is ~0.34 tile tall)

export const NATIONS = {
  uk:      { name: 'Britain',         alliance: 'allied',  uni: [0.38, 0.31, 0.2],  putt: [0.5, 0.41, 0.26],  web: [0.62, 0.53, 0.35], hat: [0.36, 0.33, 0.21], hat2: [0.3, 0.27, 0.18], head: 'brodie', fine: true },
  france:  { name: 'France',          alliance: 'allied',  uni: [0.36, 0.42, 0.53], putt: [0.33, 0.37, 0.45], web: [0.36, 0.23, 0.14], hat: [0.3, 0.35, 0.44], hat2: [0.6, 0.48, 0.25], head: 'adrian', coat: true },
  usa:     { name: 'United States',   alliance: 'allied',  uni: [0.37, 0.3, 0.19],  putt: [0.43, 0.36, 0.24], web: [0.58, 0.5, 0.34],  hat: [0.31, 0.29, 0.2],  hat2: [0.25, 0.23, 0.16], head: 'brodie' },
  italy:   { name: 'Italy',           alliance: 'allied',  uni: [0.3, 0.32, 0.27],  putt: [0.31, 0.33, 0.28], web: [0.36, 0.23, 0.14], hat: [0.34, 0.36, 0.31], hat2: [0.5, 0.42, 0.25], head: 'adrian' },
  russia:  { name: 'Russia',          alliance: 'allied',  uni: [0.39, 0.34, 0.25], putt: [0.38, 0.33, 0.25], web: [0.55, 0.48, 0.33], hat: [0.41, 0.38, 0.25], hat2: [0.06, 0.06, 0.06], head: 'peaked', coat: true },
  germany: { name: 'Germany',         alliance: 'central', uni: [0.31, 0.32, 0.28], putt: [0.3, 0.31, 0.27],  web: [0.34, 0.21, 0.13], hat: [0.07, 0.07, 0.07], hat2: [0.72, 0.56, 0.25], head: 'pickelhaube' },
  austria: { name: 'Austria-Hungary', alliance: 'central', uni: [0.38, 0.39, 0.4],  putt: [0.37, 0.38, 0.39], web: [0.36, 0.22, 0.13], hat: [0.39, 0.4, 0.41], hat2: [0.66, 0.54, 0.26], head: 'kepi' },
  // the Fusiliers Marins (French naval infantry, Dixmude 1914): navy greatcoat, dark trousers, black
  // leggings, white crossed straps over a black leather belt, the sailor's cap with its red pompom
  marins:  { name: 'France',          alliance: 'allied',  uni: [0.14, 0.17, 0.3],  putt: [0.07, 0.07, 0.08], web: [0.22, 0.17, 0.12],  hat: [0.1, 0.12, 0.22],  hat2: [0.78, 0.12, 0.08], head: 'bachi', coat: true, trou: [0.09, 0.09, 0.13], strap: [0.8, 0.76, 0.64], cross: true },
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

/**
 * Climbing out of a trench (frames 0..7; played backwards it is getting in). Local metres, x towards the
 * parapet: the man starts on the fire step (feet at z = 0, the ground at z = 1.12), reaches up and grips
 * the parapet, hauls himself up with a knee over the edge, kneels on top and stands up on the ground.
 * The rifle is slung across his back throughout.
 */
const GROUND = 1.12;
function climbPose(frame) {
  const G = GROUND;
  // keyframes: pelvis, lean, hands, and each leg as hip offsets -> knee, ankle, toe (absolute)
  const KEYS = [
    { P: [0, 0, 0.94], lean: 0.25, hL: [0.52, 0.2, G + 0.06], hR: [0.52, -0.2, G + 0.06],
      L: [[0.1, 0.1, 0.5], [0.08, 0.1, 0.05], [0.24, 0.1, 0.01]], R: [[0.05, -0.1, 0.5], [0, -0.1, 0.05], [0.16, -0.1, 0.01]] },
    { P: [0.12, 0, 1.18], lean: 0.55, hL: [0.5, 0.21, G + 0.05], hR: [0.5, -0.21, G + 0.05],
      L: [[0.42, 0.1, 1.05], [0.2, 0.1, 0.7], [0.32, 0.1, 0.66]], R: [[0.12, -0.1, 0.72], [0.06, -0.1, 0.3], [0.2, -0.1, 0.28]] },
    { P: [0.3, 0, G + 0.38], lean: 0.75, hL: [0.62, 0.2, G + 0.04], hR: [0.6, -0.2, G + 0.04],
      L: [[0.55, 0.1, G + 0.12], [0.42, 0.1, G + 0.02], [0.56, 0.1, G + 0.01]], R: [[0.3, -0.1, G + 0.06], [0.0, -0.1, G + 0.12], [-0.12, -0.1, G + 0.08]] },
    { P: [0.42, 0, G + 0.62], lean: 0.35, hL: [0.72, 0.18, G + 0.6], hR: [0.66, -0.18, G + 0.5],
      L: [[0.72, 0.1, G + 0.42], [0.66, 0.1, G + 0.03], [0.82, 0.1, G + 0.01]], R: [[0.36, -0.1, G + 0.12], [0.08, -0.1, G + 0.06], [-0.04, -0.1, G + 0.02]] },
    { P: [0.55, 0, G + 0.93], lean: 0.08, hL: [0.72, 0.2, G + 0.86], hR: [0.66, -0.22, G + 0.78],
      L: [[0.62, 0.1, G + 0.48], [0.6, 0.1, G + 0.05], [0.76, 0.1, G + 0.01]], R: [[0.52, -0.1, G + 0.48], [0.48, -0.1, G + 0.05], [0.64, -0.1, G + 0.01]] },
  ];
  const k = (frame / 7) * (KEYS.length - 1), i = Math.min(KEYS.length - 2, Math.floor(k)), f = k - i;
  const A = KEYS[i], B = KEYS[i + 1], s = f * f * (3 - 2 * f); // eased between keys
  const L3 = (a, b) => add(a, mul(sub(b, a), s)), L1 = (a, b) => a + (b - a) * s;
  const P = L3(A.P, B.P), lean = L1(A.lean, B.lean);
  const up = [Math.sin(lean), 0, Math.cos(lean)];
  const chest = add(P, mul(up, 0.42)), neck = add(P, mul(up, 0.56)), head = add(P, mul(up, 0.71));
  const shL = add(add(P, mul(up, 0.5)), [0, 0.2, 0]), shR = add(add(P, mul(up, 0.5)), [0, -0.2, 0]);
  const hL = L3(A.hL, B.hL), hR = L3(A.hR, B.hR);
  const legOf = (side) => {
    const [k0, a0, t0] = A[side], [k1, a1, t1] = B[side];
    return { hip: add(P, [0, side === 'L' ? 0.1 : -0.1, 0]), knee: L3(k0, k1), ankle: L3(a0, a1), toe: L3(t0, t1) };
  };
  // the rifle slung diagonally across his back, muzzle up behind the left shoulder
  const back = mul(up, 1), bw = [-Math.cos(lean), 0, Math.sin(lean)];
  const rifle = { butt: add(add(P, mul(bw, 0.17)), [0, -0.18, 0.12]), muzzle: add(add(add(P, mul(back, 0.95)), mul(bw, 0.2)), [0, 0.2, 0]) };
  return { P, up, chest, neck, head, shL, shR, elL: elbow(shL, hL, 1), elR: elbow(shR, hR, -1), hL, hR, legs: [legOf('L'), legOf('R')], rifle, tool: null, cut: GROUND, climb: true };
}

/** Returns joints for a named pose and animation frame. */
export function pose(name, frame = 0) {
  if (name === 'tclimb') return climbPose(frame);
  if (IDLE.includes(name.replace(/^t/, ''))) return idlePose(name, frame);
  let P = [0, 0, 0.94], lean = 0.04, legs, hands, rifleMode = 'port', head = null, tool = null;
  const hipL = (p) => add(p, [0, 0.1, 0]), hipR = (p) => add(p, [0, -0.1, 0]);
  let sway = 0, carry = [0, 0, 0];
  const load = name === 'carrymg' ? 'mg' : name === 'carrytri' ? 'tri' : null; // walking with the MG or its tripod on the shoulder
  if (name === 'walk' || name === 'charge' || load) {
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
  let extras = null;
  if (load) {
    // the right hand steadies the load on the right shoulder; the left arm swings with the stride
    rifleMode = 'carry';
    const sh = add(shR, [0, -0.02, 0.07]);
    hR = add(sh, [0.16, 0.03, 0.02]);
    hL = add(P, [0.1 + 0.12 * Math.sin((frame / 8) * Math.PI * 2), 0.2, 0.0]);
    if (load === 'mg') extras = [ // the water-cooled gun: jacket, barrel, breech and spade grips, ammunition box in the left hand
      { a: add(sh, [-0.32, 0.01, 0.0]), b: add(sh, [0.4, 0.0, 0.05]), ra: 0.05, rb: 0.048, mat: 'metal' },
      { a: add(sh, [0.4, 0.0, 0.05]), b: add(sh, [0.62, 0.0, 0.07]), ra: 0.018, rb: 0.016, mat: 'metal' },
      { a: add(sh, [-0.5, 0.0, -0.01]), b: add(sh, [-0.32, 0.0, 0.0]), ra: 0.045, rb: 0.045, mat: 'metal' },
      { a: add(sh, [-0.56, -0.04, -0.03]), b: add(sh, [-0.56, 0.04, -0.03]), ra: 0.012, rb: 0.012, mat: 'metal' },
      { a: add(hL, [0, 0, -0.04]), b: add(hL, [0, 0, -0.14]), ra: 0.05, rb: 0.05, mat: 'box' },
    ];
    else extras = [ // the folded tripod: three legs bundled together, the crosshead at the back
      { a: add(sh, [-0.3, 0.0, 0.03]), b: add(sh, [0.55, 0.03, -0.12]), ra: 0.022, rb: 0.018, mat: 'metal2' },
      { a: add(sh, [-0.3, 0.02, 0.0]), b: add(sh, [0.5, -0.03, -0.16]), ra: 0.02, rb: 0.016, mat: 'metal2' },
      { a: add(sh, [-0.28, -0.02, 0.05]), b: add(sh, [0.45, 0.0, -0.06]), ra: 0.02, rb: 0.016, mat: 'metal2' },
      { a: add(sh, [-0.36, -0.05, 0.02]), b: add(sh, [-0.36, 0.05, 0.02]), ra: 0.04, rb: 0.04, mat: 'metal' },
    ];
  } else if (rifleMode === 'port') { hR = add(add(P, [0.22, -0.16, 0.08]), carry); hL = add(add(P, [0.38, 0.06, 0.26]), carry); }
  else if (rifleMode === 'charge') { hR = add(add(P, [0.3 + lean * 0.3, -0.14, 0.05 + lean * 0.15]), carry); hL = add(add(P, [0.66 + lean * 0.4, -0.06, 0.13 + lean * 0.2]), carry); }
  else if (rifleMode === 'aim') { hR = add(neck, [0.16, -0.14, -0.12]); hL = add(neck, [0.52, -0.06, -0.15]); head = add(head, [0.05, -0.03, -0.03]); }
  else { hR = tool.a; hL = add(tool.a, mul(norm(sub(tool.b, tool.a)), 0.35)); }
  if (rifleMode !== 'none' && rifleMode !== 'carry') {
    const dir = norm(sub(hL, hR));
    rifle = { butt: add(hR, mul(dir, rifleMode === 'aim' ? -0.18 : -0.32)), muzzle: add(hR, mul(dir, 0.95)), bayonet: rifleMode === 'charge' };
  }
  return { P, up, chest, neck, head, shL, shR, elL: elbow(shL, hL, 1), elR: elbow(shR, hR, -1), hL, hR, legs, rifle, tool, cut: name === 'trench' ? 1.12 : null, extras };
}

/**
 * Idle moments (4 frames each), standing or, with a 't' prefix, in a trench (cut at the parapet):
 *   smoke  - rifle slung, a cigarette brought up to the mouth and down again
 *   clean  - rifle held across the body, a rag worked along the barrel
 *   helmet - helmet off, held in one hand and wiped with the other
 */
export const IDLE = ['smoke', 'clean', 'helmet'];
function idlePose(name, frame) {
  const inTrench = name.startsWith('t'), what = inTrench ? name.slice(1) : name;
  const S = pose('stand', 0);
  const J = { ...S, tool: null, extras: [], cut: inTrench ? 1.12 : null };
  const slung = { butt: [-0.14, 0.13, 0.78], muzzle: [-0.2, -0.16, 1.78], bayonet: false }; // across the back
  if (what === 'smoke') {
    J.rifle = slung;
    J.hL = [0.1, 0.17, 1.0]; // thumb in the belt
    J.hR = [[0.12, -0.22, 0.98], [0.24, -0.15, 1.3], [0.17, -0.05, 1.57], [0.22, -0.14, 1.4]][frame];
    const tip = add(J.hR, frame === 2 ? [0.02, 0.05, 0.02] : [0.06, 0.01, 0.0]);
    J.extras.push({ a: J.hR, b: tip, ra: 0.007, rb: 0.007, mat: 'paper' }, { a: tip, b: tip, ra: 0.009, rb: 0.009, mat: 'ember' });
  } else if (what === 'clean') {
    J.rifle = { butt: [0.24, 0.32, 1.04], muzzle: [0.32, -0.62, 1.12], bayonet: false };
    J.hL = [0.26, 0.2, 1.06];
    const t = [0.45, 0.6, 0.76, 0.6][frame];
    J.hR = add(add(J.rifle.butt, mul(sub(J.rifle.muzzle, J.rifle.butt), t)), [0.0, 0, 0.03]);
    J.extras.push({ a: add(J.hR, [-0.02, 0.03, -0.02]), b: add(J.hR, [0.02, -0.03, 0.0]), ra: 0.028, rb: 0.022, mat: 'rag' });
    J.head = add(S.head, [0.04, -0.03, -0.04]); // looking down at the work
  } else {
    J.rifle = slung;
    J.hatAt = [0.3, 0.06, 1.2];
    J.hL = [0.27, 0.13, 1.1];
    J.hR = [[0.25, -0.06, 1.33], [0.34, 0.0, 1.35], [0.3, 0.11, 1.33], [0.23, 0.03, 1.34]][frame];
    J.extras.push({ a: add(J.hR, [-0.02, 0, -0.01]), b: add(J.hR, [0.02, 0, 0.01]), ra: 0.026, rb: 0.022, mat: 'rag' });
    J.head = add(S.head, [0.03, 0, -0.03]);
  }
  J.elL = elbow(J.shL, J.hL, 1);
  J.elR = elbow(J.shR, J.hR, -1);
  return J;
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

// ------------------------------------------------------------------ corpses
/**
 * Six fallen-soldier poses. Bodies lie along +x (head at +x). Some are torn by shellfire:
 * `cut` on a leg ('knee' or 'thigh') or `armCut` ('L'/'R' at the elbow) ends the limb in a stump,
 * `pool` is a blood stain on the ground and `hatAt` puts the helmet on the ground beside the body.
 */
export const CORPSES = ['back', 'face', 'side', 'noleg', 'noarm', 'nolegs'];
export function corpse(variant) {
  const z = 0.13;
  const base = { P: [0, 0, z], up: [1, 0, 0.06], chest: [0.42, 0, z + 0.03], neck: [0.56, 0, z + 0.04], shL: [0.5, 0.2, z + 0.04], shR: [0.5, -0.2, z + 0.04], tool: null, cut: null, lying: true };
  const elbowMid = (sh, h, dy) => add(mul(add(sh, h), 0.5), [0, dy, -0.04]);
  const J = { ...base };
  switch (CORPSES[variant]) {
    case 'back': case 'noleg': case 'nolegs': {
      J.belly = 'up';
      J.head = [0.72, 0.05, z];
      J.legs = [
        { hip: [0, 0.1, z], knee: [-0.45, 0.24, 0.1], ankle: [-0.88, 0.3, 0.08], toe: [-0.95, 0.36, 0.16] },
        { hip: [0, -0.1, z], knee: [-0.45, -0.14, 0.1], ankle: [-0.88, -0.2, 0.08], toe: [-0.95, -0.24, 0.16] },
      ];
      J.hL = [0.35, 0.55, 0.06]; J.hR = [0.75, -0.45, 0.06];
      J.rifle = { butt: [0.1, -0.6, 0.04], muzzle: [1.15, -0.85, 0.04], bayonet: false };
      J.pool = [[0.3, 0, 0.28, 0.19]];
      if (CORPSES[variant] === 'noleg') { J.legs[1].cut = 'knee'; J.legs[0].knee = [-0.4, 0.3, 0.1]; J.pool = [[0.1, -0.05, 0.6, 0.38], [-0.55, -0.15, 0.3, 0.22]]; }
      if (CORPSES[variant] === 'nolegs') { J.legs[0].cut = 'thigh'; J.legs[1].cut = 'thigh'; J.rifle = null; J.pool = [[-0.15, 0, 0.62, 0.45], [0.35, 0.1, 0.4, 0.3]]; }
      break;
    }
    case 'face': case 'noarm': {
      J.belly = 'down';
      J.head = [0.71, 0.04, z + 0.02];
      J.legs = [
        { hip: [0, 0.1, z], knee: [-0.45, 0.14, 0.08], ankle: [-0.88, 0.18, 0.07], toe: [-0.98, 0.2, 0.03] },
        { hip: [0, -0.1, z], knee: [-0.3, -0.3, 0.08], ankle: [-0.7, -0.42, 0.07], toe: [-0.8, -0.46, 0.03] },
      ];
      J.hL = [0.86, 0.32, 0.05]; J.hR = [0.02, -0.3, 0.05];
      J.elL = [0.62, 0.36, 0.06]; J.elR = [0.25, -0.3, 0.06];
      J.rifle = { butt: [0.2, 0.62, 0.03], muzzle: [1.1, 0.78, 0.03], bayonet: false };
      J.pool = [[0.55, 0.05, 0.19, 0.14]];
      if (CORPSES[variant] === 'noarm') { J.armCut = 'L'; J.hatAt = [1.05, -0.45, 0.0]; J.rifle = null; J.pool = [[0.6, 0.3, 0.5, 0.34], [0.2, 0.1, 0.3, 0.25]]; }
      break;
    }
    case 'side': {
      J.belly = 'side';
      J.P = [0, 0, 0.17]; J.up = [1, 0, 0.05];
      J.chest = [0.4, -0.05, 0.19]; J.neck = [0.54, -0.08, 0.2]; J.head = [0.68, -0.12, 0.17];
      J.shL = [0.48, 0, 0.32]; J.shR = [0.48, 0, 0.08];
      J.legs = [
        { hip: [0, 0, 0.26], knee: [0.25, -0.38, 0.22], ankle: [-0.15, -0.55, 0.2], toe: [-0.18, -0.64, 0.24] },
        { hip: [0, 0, 0.09], knee: [0.18, -0.4, 0.08], ankle: [-0.2, -0.55, 0.07], toe: [-0.23, -0.64, 0.1] },
      ];
      J.hL = [0.5, -0.45, 0.2]; J.hR = [0.75, -0.42, 0.06];
      J.elL = [0.62, -0.25, 0.28]; J.elR = [0.6, -0.25, 0.08];
      J.rifle = { butt: [-0.4, 0.42, 0.03], muzzle: [0.5, 0.62, 0.03], bayonet: false };
      J.pool = [[0.45, -0.2, 0.19, 0.13]];
      break;
    }
  }
  J.elL = J.elL || elbowMid(J.shL, J.hL, 0.06);
  J.elR = J.elR || elbowMid(J.shR, J.hR, -0.06);
  J.dead = J.belly === 'up';
  return J;
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
    case 'bachi': { // the sailor's cap: a band, a flat round crown tipped back, the red pompom on top
      const band = Math.max(r2 - 0.11, Math.abs(z - 0.05) - 0.03);
      const zc = z - 0.088 - x * 0.08;
      const crown = Math.max(Math.hypot(x + 0.01, y) - 0.145, Math.abs(zc) - 0.018) - 0.006;
      const pom = Math.hypot(x + 0.01, y, z - 0.128) - 0.032 + (fbm(x * 90, y * 90, z * 90, 2) - 0.5) * 0.012;
      return pom < Math.min(band, crown) ? [pom, 'hat2'] : [Math.min(band, crown), 'hat'];
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
  const has = (k) => !J.only || J.only.includes(k);
  for (const g of J.gore || []) prims.push({ k: 's', c: g, r: 0.06, mat: 'gore' });
  for (const e of J.extras || []) prims.push({ k: 'c', ...e }); // cigarettes, rags
  for (const L of has('legs') ? J.legs : []) {
    if (L.cut === 'thigh') { // torn off at mid-thigh: a ragged stump
      const m = add(L.hip, mul(sub(L.knee, L.hip), 0.5));
      cap(L.hip, m, 0.085, 0.08, 'trou');
      prims.push({ k: 's', c: m, r: 0.075, mat: 'gore' });
      continue;
    }
    cap(L.hip, L.knee, nat.fine ? 0.092 : 0.085, nat.fine ? 0.068 : 0.07, 'trou');
    if (L.cut === 'knee') { prims.push({ k: 's', c: L.knee, r: 0.068, mat: 'gore' }); continue; }
    cap(L.knee, L.ankle, 0.062, 0.05, 'putt');
    cap(L.ankle, L.toe, 0.055, 0.045, 'boot');
    if (nat.fine) cap(add(L.ankle, [0, 0, -0.03]), add(L.toe, [0.02, 0, -0.012]), 0.05, 0.04, 'boot'); // the sole and welt of the ammunition boot
  }
  for (const [cx, cy, rx, ry] of J.pool || []) prims.push({ k: 'pool', c: [cx, cy, 0], rx, ry, mat: 'blood' });
  // torso (two overlapping capsules for a broad chest), arms, head
  if (has('torso')) {
  cap(J.P, J.chest, 0.15, 0.16, 'uni');
  cap(add(J.chest, [0, 0.1, 0]), add(J.chest, [0, -0.1, 0]), 0.12, 0.12, 'uni');
  cap(J.chest, J.neck, 0.1, 0.06, 'uni');
  if (nat.fine) cap(add(J.neck, mul(sub(J.chest, J.neck), 0.25)), add(J.neck, mul(sub(J.neck, J.chest), 0.12)), 0.072, 0.07, 'uni'); // stand-and-fall collar
  }
  for (const [side, sh, el, h] of has('arms') ? [['L', J.shL, J.elL, J.hL], ['R', J.shR, J.elR, J.hR]] : has('arm') ? [['L', J.shL, J.elL, J.hL]] : []) {
    cap(sh, el, nat.fine ? 0.066 : 0.058, nat.fine ? 0.054 : 0.05, 'uni');
    if (J.armCut === side) { prims.push({ k: 's', c: el, r: 0.055, mat: 'gore' }); continue; } // torn off at the elbow
    cap(el, h, 0.05, 0.042, 'uni');
    if (nat.fine) { const w = add(h, mul(norm(sub(el, h)), 0.06)); cap(w, add(w, mul(norm(sub(el, h)), 0.035)), 0.05, 0.05, 'uni'); } // turned-back cuff
    prims.push({ k: 's', c: h, r: 0.042, mat: 'skin' });
  }
  if (has('head')) prims.push({ k: 's', c: J.head, r: 0.105, mat: 'skin' });
  if (has('head') && nat.fine) { // nose and ears, so the face reads under the helmet brim
    const hf = J.fwd || (J.belly === 'side' ? [0, -1, 0] : J.lying ? [0, 0, J.dead ? 1 : -1] : [1, 0, 0]);
    const hs = norm([-hf[1], hf[0], 0.0001]), hu = norm([hf[1] * hs[2] - hf[2] * hs[1], hf[2] * hs[0] - hf[0] * hs[2], hf[0] * hs[1] - hf[1] * hs[0]]);
    const upv = J.lying ? J.up : hu[2] < 0 ? mul(hu, -1) : hu;
    prims.push({ k: 's', c: add(add(J.head, mul(hf, 0.1)), mul(upv, -0.01)), r: 0.022, mat: 'skin' });
    for (const sd of [1, -1]) prims.push({ k: 's', c: add(J.head, mul(hs, 0.1 * sd)), r: 0.024, mat: 'skin' });
  }
  // equipment: belt with pouches, pack + bedroll, canteen
  if (has('torso')) {
  const fwd = J.fwd || (J.belly === 'side' ? [0, -1, 0] : J.lying ? [0, 0, J.dead ? 1 : -1] : [1, 0, 0]); // belly direction
  const belt = add(J.P, mul(J.up, 0.12));
  const back = mul(fwd, -1), packC = add(add(J.P, mul(J.up, 0.38)), mul(back, 0.2));
  if (nat.fine) {
    // 1908 pattern webbing: a belt round the tunic (not a bolster), five-pocket ammunition pouches on each
    // side of the chest, haversack and entrenching tool on the left hip, the water bottle on the right
    const up = J.up, side = norm([up[1] * fwd[2] - up[2] * fwd[1], up[2] * fwd[0] - up[0] * fwd[2], up[0] * fwd[1] - up[1] * fwd[0]]);
    prims.push({ k: 'band', c: belt, u: up, f: fwd, s: side, R: 0.158, w: 0.032, t: 0.016, mat: 'web' });
    prims.push({ k: 'b', c: add(belt, mul(fwd, 0.165)), h: [0.012, 0.03, 0.026], r: 0.006, mat: 'brass' });
    if (!J.lying) cap(belt, add(belt, mul(up, -0.17)), 0.158, 0.172, 'uni'); // the tunic skirt below the belt
    for (const sd of [1, -1]) {
      for (const [dz, dy] of [[0.05, 0.045], [0.05, 0.1], [0.115, 0.045], [0.115, 0.1]]) // two rows of pockets, outboard of the buckle
        prims.push({ k: 'b', c: add(add(add(belt, mul(up, dz)), mul(fwd, 0.155)), mul(side, dy * sd)), h: [0.022, 0.026, 0.03], r: 0.008, mat: 'web' });
      prims.push({ k: 'b', c: add(add(add(J.chest, mul(up, 0.04)), mul(fwd, 0.12)), mul(side, 0.075 * sd)), h: [0.01, 0.04, 0.04], r: 0.008, mat: 'uni' }); // breast pocket
      // shoulder straps down the back to the pack
      cap(add(J[sd > 0 ? 'shL' : 'shR'], mul(back, 0.06)), add(packC, add(mul(side, 0.09 * sd), mul(up, 0.1))), 0.02, 0.02, 'web');
    }
    prims.push({ k: 'b', c: add(add(add(belt, mul(side, 0.15)), mul(back, 0.1)), mul(up, -0.08)), h: [0.04, 0.09, 0.08], r: 0.02, mat: 'web' }); // haversack
    cap(add(add(add(belt, mul(side, 0.12)), mul(back, 0.16)), mul(up, 0.02)), add(add(add(belt, mul(side, 0.06)), mul(back, 0.17)), mul(up, -0.2)), 0.016, 0.016, 'wood'); // entrenching-tool helve
    prims.push({ k: 'c', a: add(add(add(belt, mul(side, -0.16)), mul(back, 0.07)), mul(up, -0.02)), b: add(add(add(belt, mul(side, -0.16)), mul(back, 0.07)), mul(up, -0.13)), ra: 0.045, rb: 0.045, mat: 'webT' }); // covered water bottle
  } else {
  cap(add(belt, [0, 0.16, 0]), add(belt, [0, -0.16, 0]), 0.165, 0.165, 'webT');
  for (const s of [-0.1, 0.1]) prims.push({ k: 'b', c: add(belt, add(mul(fwd, 0.15), [0, s, 0.02])), h: [0.03, 0.055, 0.045], r: 0.012, mat: 'web' });
  }
  prims.push({ k: 'b', c: packC, h: [0.07, 0.15, 0.14], r: 0.04, mat: 'pack' });
  cap(add(add(packC, mul(J.up, 0.16)), [0, 0.17, 0]), add(add(packC, mul(J.up, 0.16)), [0, -0.17, 0]), 0.06, 0.06, 'pack');
  if (!nat.fine) prims.push({ k: 's', c: add(add(belt, mul(back, 0.08)), [0, 0.2, -0.06]), r: 0.055, mat: 'metal2' });
  // webbing straps over the shoulders
  if (nat.cross) { // straps crossed over the chest, each from one shoulder to the other hip
    cap(add(J.shL, mul(fwd, 0.08)), add(belt, add(mul(fwd, 0.14), [0, -0.1, 0.01])), 0.022, 0.022, 'strap');
    cap(add(J.shR, mul(fwd, 0.08)), add(belt, add(mul(fwd, 0.15), [0, 0.1, 0.01])), 0.022, 0.022, 'strap');
  } else {
    cap(add(J.shL, mul(fwd, 0.08)), add(belt, add(mul(fwd, 0.14), [0, 0.08, 0])), 0.022, 0.022, 'web');
    cap(add(J.shR, mul(fwd, 0.08)), add(belt, add(mul(fwd, 0.14), [0, -0.08, 0])), 0.022, 0.022, 'web');
  }
  if (nat.coat && !J.lying) prims.push({ k: 'skirt', top: add(J.P, mul(J.up, 0.05)), mat: 'uni' });
  }
  // rifle / shovel
  if (J.rifle && has('rifle')) {
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
      case 'band': { // a belt: a flat ring round the body, in the plane across the body's up axis
        const d = [p[0] - q.c[0], p[1] - q.c[1], p[2] - q.c[2]];
        const a = d[0] * q.f[0] + d[1] * q.f[1] + d[2] * q.f[2], b = d[0] * q.s[0] + d[1] * q.s[1] + d[2] * q.s[2], h = d[0] * q.u[0] + d[1] * q.u[1] + d[2] * q.u[2];
        return Math.max(Math.abs(Math.hypot(a, b * 0.93) - q.R) - q.t, Math.abs(h) - q.w) - 0.004;
      }
      case 'b': return sdRoundBox(p[0] - q.c[0], p[1] - q.c[1], p[2] - q.c[2], q.h[0], q.h[1], q.h[2], q.r);
      case 'pool': { // a thin, slightly irregular stain lying on the ground
        const ex = (p[0] - q.c[0]) / q.rx, ey = (p[1] - q.c[1]) / q.ry;
        const wob = 0.12 * Math.sin(ex * 5.1 + ey * 3.3) + 0.08 * Math.sin(ey * 7.7 - ex * 2.1);
        return Math.max((Math.hypot(ex, ey) - 1 - wob) * Math.min(q.rx, q.ry), p[2] - 0.035);
      }
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
      const [hd, hm] = has('hat') ? headgear(nat, p, J.hatAt || J.head) : [1e9, 'hat']; // a knocked-off helmet lies on the ground
      if (hd < d) { d = hd; mat = hm; }
    }
    if (J.cut != null && !J.pit) d = Math.max(d, J.cut - p[2]);
    return [d, mat];
  };
  const colour = (mat, p) => {
    const n = fbm(p[0] * 40 + seed, p[1] * 40, p[2] * 40, 3);
    const grime = clamp((0.5 - p[2]) * 1.4, 0, 0.6) * (fbm(p[0] * 12, p[1] * 12, p[2] * 12, 2) + 0.3);
    let c;
    switch (mat) {
      case 'uni': case 'trou': {
        const t = mat === 'trou' && nat.trou ? nat.trou : nat.uni;
        c = mix3(mul(t, 0.82), mul(t, 1.1), n);
        if (nat.fine) { // folds and creases in the serge, and wear lighter on the edges
          const fold = fbm(p[0] * 9 + 3, p[1] * 9, p[2] * 18, 3);
          c = mix3(c, mul(t, 0.6), clamp((0.42 - fold) * 2.2, 0, 0.55));
          c = mix3(c, mul(t, 1.22), clamp((fold - 0.68) * 2.5, 0, 0.35));
        }
        break;
      }
      case 'strap': c = mix3(mul(nat.strap || nat.web, 0.85), nat.strap || nat.web, n); break;
      case 'putt': c = ((p[2] * 60) % 1) < 0.25 ? mul(nat.putt, 0.75) : nat.putt; break;
      case 'boot': return BOOT;
      case 'skin': return mix3(SKIN, [0.55, 0.4, 0.32], n * 0.5);
      case 'hat': c = mix3(mul(nat.hat, 0.85), mul(nat.hat, 1.15), n); break;
      case 'hat2': return nat.hat2;
      case 'web': case 'webT': c = mix3(mul(nat.web, 0.85), nat.web, n); break;
      case 'pack': c = mix3(mul(nat.web[0] > 0.5 ? nat.web : [0.5, 0.44, 0.32], 0.85), nat.web[0] > 0.5 ? nat.web : [0.5, 0.44, 0.32], n); break;
      case 'metal2': return [0.3, 0.3, 0.28];
      case 'brass': return [0.62, 0.48, 0.22];
      case 'box': return [0.25, 0.26, 0.17]; // an ammunition box
      case 'blood': return mix3([0.16, 0.1, 0.07], [0.22, 0.14, 0.1], n); // dried brown, half soaked into the mud
      case 'gore': return mix3([0.24, 0.09, 0.06], [0.32, 0.14, 0.09], n);
      case 'wood': return mix3(mul(WOOD, 0.8), WOOD, n);
      case 'metal': return METAL;
      case 'paper': return [0.86, 0.84, 0.78];
      case 'ember': return [1, 0.5, 0.15];
      case 'rag': return mix3([0.5, 0.48, 0.42], [0.66, 0.63, 0.56], n);
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
  // in a trench the man is rendered whole, standing on the fire step below ground level (z = 0 is the
  // ground); the game hides whatever the trench's near edge covers when it draws him (render.js)
  const pit = J.cut != null && !portrait;
  if (pit) J.pit = true;
  const fig = figure(nat, J, hash(nationKey.length, frame) * 10);
  const th = view === 'a' ? 0 : -Math.PI / 2, c = Math.cos(th), s = Math.sin(th);
  const zoff = J.cut != null ? J.cut : 0; // trench pose: parapet line (the ground) at z = 0
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
  return { bounds: [-E, -E, pit ? -0.27 : -0.01, E + 0.25, E + 0.2, ((J.climb ? 3.0 : 2.0) - zoff) * K], sdf, shade, supersample: 3 };
}

/** A fallen soldier: CORPSES[variant], turned to one of 8 directions (dir x 45 degrees). */
export function corpseScene(nationKey, variant, dir) {
  const nat = NATIONS[nationKey];
  const J = corpse(variant);
  const fig = figure(nat, J, hash(nationKey.length, variant + dir) * 10);
  const th = (dir * Math.PI) / 4, c = Math.cos(th), s = Math.sin(th);
  const toLocal = (x, y, z) => [(x * c + y * s) / K, (-x * s + y * c) / K, z / K];
  const sdf = (x, y, z) => Math.min(fig.eval(toLocal(x, y, z))[0] * K, z);
  const shade = (x, y, z) => {
    const p = toLocal(x, y, z);
    const [d, mat] = fig.eval(p);
    if (z < d * K) return { kind: 'catcher' };
    const col = fig.colour(mat, p);
    const spec = mat === 'blood' ? 0.25 : mat === 'hat' && (nat.head === 'brodie' || nat.head === 'adrian' || nat.head === 'pickelhaube') ? 0.35 : mat === 'metal' || mat === 'steel' || mat === 'hat2' ? 0.6 : 0.03;
    return { kind: 'solid', col, spec, shin: mat === 'blood' ? 60 : 30 };
  };
  const E = 1.3 * K;
  return { bounds: [-E, -E, -0.01, E, E, 0.7 * K], sdf, shade, supersample: 3 };
}

/**
 * A man shot down (rifle or machine-gun fire): FALL_FRAMES frames from standing to his corpse pose.
 *   0 back    - topples backward onto his back (corpse 'back')
 *   1 face    - pitches forward onto his face (corpse 'face')
 *   2 side    - twists round and falls onto his side (corpse 'side')
 *   3 knees   - drops to his knees, then falls forward onto his face (corpse 'face')
 *   4 stagger - staggers back a step, hunched, then collapses backward (corpse 'back')
 * The standing figure tips over about his feet while his knees give way and his limbs go slack into
 * the corpse pose; the corpse sprite is the last frame.
 */
export const FALL_FRAMES = 6;
export const FALLS = [
  { name: 'back', corpse: 0 }, { name: 'face', corpse: 1 }, { name: 'side', corpse: 2 },
  { name: 'knees', corpse: 1 }, { name: 'stagger', corpse: 0 },
];
export function fallPose(kind, frame) {
  const F = FALLS[kind], t = (frame + 1) / (FALL_FRAMES + 1);
  const S = pose('stand', 0), C = corpse(F.corpse);
  // facing before the fall: backward falls face -x (towards the shooter) and end with the head at +x
  const back = F.corpse === 0, side = F.name === 'side';
  const yaw = side ? Math.PI / 2 * (1 - 0.6 * t) : back ? Math.PI : 0; // the side fall twists round as he goes
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  // the schedule of each fall: tip angle, how far the knees give way, how slack the limbs are
  let tipT = t, sink = 0.25 * Math.sin(Math.PI * t), slack = Math.pow(t, 1.8), shiftX = 0;
  if (F.name === 'knees') {
    // first half: down onto his knees (the body sinks, upright); second half: over onto his face
    const k = Math.min(1, t / 0.5);
    sink = 0.42 * Math.sin((Math.PI / 2) * k) * (1 - Math.max(0, (t - 0.5) / 0.5));
    tipT = t < 0.5 ? 0.06 * k : 0.06 + 0.94 * Math.pow((t - 0.5) / 0.5, 0.9);
    slack = t < 0.5 ? 0.15 * k : 0.15 + 0.85 * Math.pow((t - 0.5) / 0.5, 1.6);
  } else if (F.name === 'stagger') {
    // a step back, hunched over the wound, then down
    const k = Math.min(1, t / 0.45);
    shiftX = 0.22 * Math.sin((Math.PI / 2) * k);
    tipT = t < 0.45 ? -0.12 * k : -0.12 + 1.12 * Math.pow((t - 0.45) / 0.55, 1.1);
    slack = t < 0.45 ? 0.1 * k : 0.1 + 0.9 * Math.pow((t - 0.45) / 0.55, 1.7);
  }
  const A = (Math.PI / 2) * Math.sign(tipT) * Math.pow(Math.abs(tipT), 1.25);
  const ca = Math.cos(A), sa = Math.sin(A);
  const tipS = (q) => {
    const x = q[0] * cy - q[1] * sy, y = q[0] * sy + q[1] * cy, z = q[2];
    return [x * ca + z * sa + shiftX, y, -x * sa + z * ca];
  };
  const w = slack, drop = sink;
  const mix = (a, b) => { const q = tipS(a); return [q[0] + (b[0] - q[0]) * w, q[1] + (b[1] - q[1]) * w, Math.max(0.04, q[2] - drop * (1 - w)) + (b[2] - Math.max(0.04, q[2] - drop * (1 - w))) * w]; };
  // a man hit in the stagger clutches at his chest
  const hand = (h, side2) => F.name === 'stagger' && t < 0.6 ? add(S.chest, [0.12, side2 * 0.08, 0.02]) : h;
  const legs = S.legs.map((L, i) => {
    let knee = L.knee, ankle = L.ankle, toe = L.toe;
    if (F.name === 'knees' && t < 0.5) { // kneeling: knees forward and down, shins along the ground
      const k = t / 0.5;
      knee = add(L.knee, [0.25 * k, 0, -0.3 * k]); ankle = add(L.ankle, [-0.2 * k, 0, 0.0]); toe = add(L.toe, [-0.25 * k, 0, 0]);
    }
    return { hip: mix(L.hip, C.legs[i].hip), knee: mix(knee, C.legs[i].knee), ankle: mix(ankle, C.legs[i].ankle), toe: mix(toe, C.legs[i].toe) };
  });
  const f = tipS([1, 0, 0]), endF = C.belly === 'side' ? [0, -1, 0] : [0, 0, C.belly === 'up' ? 1 : -1];
  return {
    P: mix(S.P, C.P), up: norm(mix(S.up, C.up)), chest: mix(S.chest, C.chest), neck: mix(S.neck, C.neck), head: mix(S.head, C.head),
    shL: mix(S.shL, C.shL), shR: mix(S.shR, C.shR), elL: mix(S.elL, C.elL), elR: mix(S.elR, C.elR),
    hL: mix(hand(S.hL, 1), C.hL), hR: mix(hand(S.hR, -1), C.hR),
    legs, rifle: S.rifle && C.rifle ? { butt: mix(S.rifle.butt, C.rifle.butt), muzzle: mix(S.rifle.muzzle, C.rifle.muzzle), bayonet: false } : null,
    tool: null, cut: null, lying: t > 0.25, dead: C.belly === 'up',
    fwd: norm([f[0] * (1 - w) + endF[0] * w + 1e-6, f[1] * (1 - w) + endF[1] * w, f[2] * (1 - w) + endF[2] * w]),
    // blood soaks through as he falls
    pool: t > 0.55 ? (C.pool || []).map(([x, y, rx, ry]) => [x, y, rx * (t - 0.55) / 0.45, ry * (t - 0.55) / 0.45]) : [],
  };
}
export function fallScene(nationKey, variant, dir, frame) {
  const nat = NATIONS[nationKey];
  const J = fallPose(variant, frame);
  // a hit man bleeds: a dark wound patch on the chest of the falling figure
  J.gore = [add(J.chest, mul(J.fwd, 0.13))];
  const fig = figure(nat, J, hash(nationKey.length, variant + dir) * 10);
  const th = (dir * Math.PI) / 4, c = Math.cos(th), s = Math.sin(th);
  const toLocal = (x, y, z) => [(x * c + y * s) / K, (-x * s + y * c) / K, z / K];
  const sdf = (x, y, z) => Math.min(fig.eval(toLocal(x, y, z))[0] * K, z);
  const shade = (x, y, z) => {
    const p = toLocal(x, y, z);
    const [d, mat] = fig.eval(p);
    if (z < d * K) return { kind: 'catcher' };
    const spec = mat === 'blood' ? 0.25 : mat === 'hat' && (nat.head === 'brodie' || nat.head === 'adrian' || nat.head === 'pickelhaube') ? 0.35 : mat === 'metal' || mat === 'steel' || mat === 'hat2' ? 0.6 : 0.03;
    return { kind: 'solid', col: fig.colour(mat, p), spec, shin: mat === 'blood' ? 60 : 30 };
  };
  const E = 1.9 * K;
  // the frames are on screen for a fraction of a second: lighter anti-aliasing keeps the render time sane
  return { bounds: [-E, -E, -0.01, E, E, 2.0 * K], sdf, shade, supersample: 2 };
}

/** Pieces thrown by a shell burst: a torn leg or arm, the helmet, the rifle (lying along x, centred). */
export const PARTS = { leg: 4, arm: 4, rifle: 4, helmet: 1 };
function part(name) {
  const base = { P: [0, 0, 0], up: [1, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0], shL: [0, 0, 0], shR: [0, 0, 0], elL: [0, 0, 0], elR: [0, 0, 0], hL: [0, 0, 0], hR: [0, 0, 0], legs: [], rifle: null, tool: null, cut: null, lying: true, belly: 'up' };
  switch (name) {
    case 'leg': return { ...base, only: ['legs'], legs: [{ hip: [0.42, 0, 0.08], knee: [0, 0.02, 0.07], ankle: [-0.4, 0, 0.06], toe: [-0.48, 0, 0.13] }], gore: [[0.47, 0, 0.08]] };
    case 'arm': return { ...base, only: ['arm'], shL: [0.28, 0, 0.06], elL: [0, 0.04, 0.05], hL: [-0.24, 0.02, 0.05], gore: [[0.32, 0, 0.06]] };
    case 'rifle': return { ...base, only: ['rifle'], rifle: { butt: [-0.55, 0, 0.035], muzzle: [0.55, 0, 0.035], bayonet: false } };
    case 'helmet': return { ...base, only: ['hat'], hatAt: [0, 0, -0.02] };
  }
}
export function partScene(nationKey, name, dir) {
  const nat = NATIONS[nationKey];
  const J = part(name);
  const fig = figure(nat, J, hash(nationKey.length, dir + name.length) * 10);
  const th = (dir * Math.PI) / 2 + 0.4, c = Math.cos(th), s = Math.sin(th);
  const toLocal = (x, y, z) => [(x * c + y * s) / K, (-x * s + y * c) / K, z / K];
  const sdf = (x, y, z) => Math.min(fig.eval(toLocal(x, y, z))[0] * K, z);
  const shade = (x, y, z) => {
    const p = toLocal(x, y, z);
    const [d, mat] = fig.eval(p);
    if (z < d * K) return { kind: 'catcher' };
    const spec = mat === 'hat' && (nat.head === 'brodie' || nat.head === 'adrian' || nat.head === 'pickelhaube') ? 0.35 : mat === 'metal' || mat === 'steel' || mat === 'hat2' ? 0.6 : 0.03;
    return { kind: 'solid', col: fig.colour(mat, p), spec, shin: 30 };
  };
  const E = 0.75 * K;
  return { bounds: [-E, -E, -0.01, E, E, 0.45 * K], sdf, shade, supersample: 3 };
}

/** All sprite jobs: [name, args]. */
export const SOLDIER_POSES = [['stand', 1], ['walk', 8], ['carrymg', 8], ['carrytri', 8], ['charge', 8], ['crawl', 6], ['fire', 1], ['trench', 1], ['tclimb', 8], ['prone', 1], ['dig', 2], ['dead', 1]];
/** Idle animations: standing and in-trench versions, 4 frames each. */
export const IDLE_POSES = IDLE.flatMap((n) => [[n, 4], ['t' + n, 4]]);

void vnoise;
