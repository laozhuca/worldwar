// Path finding: the quickest way across the battlefield, not the straight line. A* over the tile grid
// (8 neighbours), each step costing the time to cross it: open ground is quickest, mud and shell holes
// slower, barbed wire very slow, rocks and town buildings impassable. Climbing into or out of a trench
// costs the time the men take to get over the parapet, so units keep to the trench system when that is
// quicker, go round the wire through its gaps, and do not climb out and back in for nothing.
// DOM-free (used by game.js and the tests).

const SQ2 = Math.SQRT2;

/**
 * The quickest route from (sx, sy) to (tx, ty), as waypoints [[x, y], ...] ending at the target, or null
 * when the straight line will do (or no route exists).
 *  speedAt(tile): relative speed on a tile (1 = open ground; 0 or less = impassable)
 *  climb(out): extra cost, in tile-lengths of open ground, of climbing out of (out) or into a trench
 */
export function findPath(map, sx, sy, tx, ty, speedAt, climb, enter = null) {
  const W = map.w, H = map.h, tiles = map.tiles;
  const fx = Math.floor(sx), fy = Math.floor(sy), gx = Math.floor(tx), gy = Math.floor(ty);
  if (fx === gx && fy === gy) return null;
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? null : tiles[y * W + x]);
  const start = at(fx, fy), goal = at(gx, gy);
  if (!start || !goal || goal.off) return null;
  // the straight line, when it crosses nothing that slows or stops the unit and changes no level, is best
  if (!enter && clearLine(map, sx, sy, tx, ty, speedAt)) return null;
  if (enter && clearLine(map, sx, sy, tx, ty, speedAt) && !crosses(map, sx, sy, tx, ty, enter)) return null;

  const N = W * H, g = new Float64Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const heap = new Heap();
  const s0 = fy * W + fx, goalI = gy * W + gx;
  g[s0] = 0; heap.push(s0, Math.hypot(gx - fx, gy - fy));
  const cost = new Float64Array(N); // per-tile crossing cost (1 / speed), computed once
  for (let i = 0; i < N; i++) { const t = tiles[i]; const v = t.off ? 0 : speedAt(t); cost[i] = v > 0 ? 1 / v : Infinity; }
  cost[s0] = Math.min(cost[s0], 4); // a unit standing in wire can still get out of it
  const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQ2], [1, -1, SQ2], [-1, 1, SQ2], [-1, -1, SQ2]];
  let found = false, guard = 0;
  while (heap.size && guard++ < N * 4) {
    const i = heap.pop();
    if (closed[i]) continue;
    closed[i] = 1;
    if (i === goalI) { found = true; break; }
    const x = i % W, y = (i - x) / W, ti = tiles[i];
    for (const [dx, dy, len] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (closed[j] || cost[j] === Infinity) continue;
      const tj = tiles[j];
      // no cutting corners diagonally past an obstacle, or between trench and open ground (a climb happens on a tile side)
      if (dx && dy) {
        const a = tiles[y * W + nx], b = tiles[ny * W + x];
        if (cost[y * W + nx] === Infinity || cost[ny * W + x] === Infinity) continue;
        if (!!a.trench !== !!ti.trench || !!b.trench !== !!ti.trench || !!tj.trench !== !!ti.trench) continue;
      }
      let c = len * 0.5 * (cost[i] + cost[j]);
      if (!!ti.trench !== !!tj.trench) c += climb(!!ti.trench);
      if (enter) c += enter(tj);
      const ng = g[i] + c;
      if (ng < g[j]) { g[j] = ng; from[j] = i; heap.push(j, ng + Math.hypot(gx - nx, gy - ny)); }
    }
  }
  if (!found) return null;
  // the tiles of the route, start to goal
  const route = [];
  for (let i = goalI; i !== -1; i = from[i]) route.push(i);
  route.reverse();
  // waypoints at tile centres, then pulled straight wherever a direct line crosses nothing different
  const pts = route.map((i) => [(i % W) + 0.5, Math.floor(i / W) + 0.5]);
  pts[0] = [sx, sy];
  pts[pts.length - 1] = [tx, ty];
  const out = [];
  let k = 0;
  while (k < pts.length - 1) {
    let j = pts.length - 1;
    while (j > k + 1 && !sameGround(map, pts[k][0], pts[k][1], pts[j][0], pts[j][1], speedAt)) j--;
    out.push(pts[j]);
    k = j;
  }
  return out;
}

/** True if a straight line enters any tile with an extra entry cost (an unbridged trench, for a battery). */
function crosses(map, ax, ay, bx, by, enter) {
  const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) * 4));
  for (let i = 1; i <= n; i++) { const t = map.tiles[Math.floor(ay + ((by - ay) * i) / n) * map.w + Math.floor(ax + ((bx - ax) * i) / n)]; if (t && enter(t) > 0) return true; }
  return false;
}

/** True if the straight line crosses only open going (nothing slower than the start, no change of level, nothing impassable). */
function clearLine(map, ax, ay, bx, by, speedAt) {
  return sameGround(map, ax, ay, bx, by, speedAt, true);
}

/** True if a straight segment stays on ground of one kind: the same level (trench or not), nothing impassable, no wire. */
function sameGround(map, ax, ay, bx, by, speedAt, strict = false) {
  const W = map.w, d = Math.hypot(bx - ax, by - ay), n = Math.max(2, Math.ceil(d * 4));
  const t0 = map.tiles[Math.floor(ay) * W + Math.floor(ax)];
  if (!t0) return false;
  const lvl = !!t0.trench, v0 = speedAt(t0);
  for (let i = 1; i <= n; i++) {
    const x = ax + ((bx - ax) * i) / n, y = ay + ((by - ay) * i) / n;
    const fx = Math.floor(x), fy = Math.floor(y);
    if (fx < 0 || fy < 0 || fx >= map.w || fy >= map.h) return false;
    const t = map.tiles[fy * W + fx];
    if (!t || t.off) return false;
    const v = speedAt(t);
    if (v <= 0 || !!t.trench !== lvl || t.wire > 0) return false;
    if (strict && v < Math.min(v0, 0.86) - 1e-9) return false; // the straight line must not run into slower going
  }
  return true;
}

/** A small binary min-heap of (index, priority). */
class Heap {
  constructor() { this.i = []; this.p = []; }
  get size() { return this.i.length; }
  push(i, p) {
    const I = this.i, P = this.p;
    let k = I.length; I.push(i); P.push(p);
    while (k > 0) { const q = (k - 1) >> 1; if (P[q] <= p) break; I[k] = I[q]; P[k] = P[q]; k = q; }
    I[k] = i; P[k] = p;
  }
  pop() {
    const I = this.i, P = this.p, top = I[0], li = I.pop(), lp = P.pop();
    if (I.length) {
      let k = 0;
      const n = I.length;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && P[c + 1] < P[c]) c++;
        if (P[c] >= lp) break;
        I[k] = I[c]; P[k] = P[c]; k = c;
      }
      I[k] = li; P[k] = lp;
    }
    return top;
  }
}
