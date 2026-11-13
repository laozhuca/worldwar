// A small WebGL2 viewer for the soldier models on the New Game screen (no libraries).
// Loads one GLB (one mesh, a base-colour and a normal texture, as written by scripts/process-models.py),
// lights it like the battlefield (cold key light, warm rim from behind, soft ambient), and turns the
// figure while the pointer is over it, easing back to a three-quarter view when it leaves.

const BASE_R = 0.5, BASE_H = 0.08; // the round stand under each soldier
const cache = new Map(); // url -> Promise<{ gl-independent parsed data }>

function parseGLB(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  const jl = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl)));
  const bin = 20 + jl + 8;
  const view = (i) => { const v = json.bufferViews[i]; return new Uint8Array(buf, bin + (v.byteOffset || 0), v.byteLength); };
  const acc = (i) => {
    const a = json.accessors[i], v = view(a.bufferView);
    const T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array }[a.componentType];
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type] * a.count;
    return { data: new T(v.slice(a.byteOffset || 0, (a.byteOffset || 0) + n * T.BYTES_PER_ELEMENT).buffer), min: a.min, max: a.max };
  };
  const prim = json.meshes[0].primitives[0], mat = json.materials[prim.material || 0];
  const img = (texIndex) => { const im = json.images[json.textures[texIndex].source]; return new Blob([view(im.bufferView)], { type: im.mimeType }); };
  return {
    pos: acc(prim.attributes.POSITION), nrm: acc(prim.attributes.NORMAL), uv: acc(prim.attributes.TEXCOORD_0), idx: acc(prim.indices),
    color: img(mat.pbrMetallicRoughness.baseColorTexture.index),
    normal: mat.normalTexture ? img(mat.normalTexture.index) : null,
  };
}

export function loadModel(url) {
  if (!cache.has(url)) {
    cache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then(async (b) => {
      const m = parseGLB(b);
      m.colorImg = await createImageBitmap(m.color); // glTF UVs have v = 0 at the image's top row, as WebGL uploads it
      m.normalImg = m.normal ? await createImageBitmap(m.normal) : null;
      return m;
    }));
    cache.get(url).catch(() => cache.delete(url));
  }
  return cache.get(url);
}

const VS = `#version 300 es
in vec3 aPos; in vec3 aNrm; in vec2 aUv;
uniform mat4 uMVP; uniform mat3 uRot;
out vec3 vN; out vec3 vP; out vec2 vUv;
void main() { vN = uRot * aNrm; vP = uRot * aPos; vUv = aUv; gl_Position = uMVP * vec4(aPos, 1.0); }`;
const FS = `#version 300 es
precision highp float;
in vec3 vN; in vec3 vP; in vec2 vUv;
uniform sampler2D uColor; uniform sampler2D uNormal; uniform bool uHasNormal; uniform bool uBase;
out vec4 o;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  if (uHasNormal && !uBase) { // normal map in a tangent frame from screen-space derivatives
    vec3 dp1 = dFdx(vP), dp2 = dFdy(vP); vec2 du1 = dFdx(vUv), du2 = dFdy(vUv);
    vec3 t = dp2 * du1.y - dp1 * du2.y; vec3 b = dp1 * du2.x - dp2 * du1.x;
    float s = inversesqrt(max(dot(t, t), dot(b, b)) + 1e-12);
    vec3 m = texture(uNormal, vUv).xyz * 2.0 - 1.0;
    n = normalize(mat3(t * s, b * s, n) * vec3(m.xy * 0.8, m.z));
  }
  vec3 base = pow(texture(uColor, vUv).rgb, vec3(2.2));
  if (uBase) { // the round stand: weathered dark stone on top, a lighter worn edge
    float g = fract(sin(dot(floor(vP.xz * 90.0), vec2(12.9898, 78.233))) * 43758.5453);
    base = mix(vec3(0.05, 0.048, 0.045), vec3(0.11, 0.1, 0.09), vUv.x) * (0.85 + 0.3 * g);
  }
  vec3 key = normalize(vec3(-0.5, 0.75, 0.6)), rim = normalize(vec3(0.7, 0.35, -0.8));
  float d = max(dot(n, key), 0.0), r = pow(max(dot(n, rim), 0.0), 2.0);
  float hemi = 0.5 + 0.5 * n.y;
  vec3 c = base * (vec3(0.16, 0.17, 0.2) * (0.6 + 0.6 * hemi) + vec3(1.0, 0.96, 0.9) * d * 1.05) + vec3(1.0, 0.72, 0.45) * r * 0.32 * (0.4 + base);
  o = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
}`;

/** A viewer in a canvas. show(url) swaps the model; it turns while the pointer is over it. */
export class ModelView {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    this.prog = p;
    this.loc = { mvp: gl.getUniformLocation(p, 'uMVP'), rot: gl.getUniformLocation(p, 'uRot'), color: gl.getUniformLocation(p, 'uColor'), normal: gl.getUniformLocation(p, 'uNormal'), hasN: gl.getUniformLocation(p, 'uHasNormal'), base: gl.getUniformLocation(p, 'uBase') };
    this.stand = this.makeStand();
    this.rest = -0.45; // three-quarter view at rest
    this.yaw = this.rest; this.spin = false; this.mesh = null; this.want = null;
    const on = () => { this.spin = true; this.kick(); }, off = () => { this.spin = false; this.kick(); };
    canvas.addEventListener('pointerenter', on); canvas.addEventListener('pointerleave', off);
    canvas.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') { this.spin = !this.spin; this.kick(); } });
    this.last = 0;
    // drawn at zero size while the screen is hidden: redraw whenever the canvas gets (or changes) its size
    if (window.ResizeObserver) new ResizeObserver(() => this.kick()).observe(canvas);
  }

  async show(url) {
    this.want = url;
    let m;
    try { m = await loadModel(url); } catch (e) { this.onError && this.onError(e); return false; }
    if (this.want !== url) return false;
    this.upload(m);
    this.kick();
    return true;
  }

  upload(m) {
    const gl = this.gl;
    if (this.mesh) { for (const b of this.mesh.bufs) gl.deleteBuffer(b); for (const t of this.mesh.texs) gl.deleteTexture(t); gl.deleteVertexArray(this.mesh.vao); }
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const bufs = [];
    const attr = (name, data, n) => {
      const b = gl.createBuffer(); bufs.push(b); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const l = gl.getAttribLocation(this.prog, name); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, 0, 0);
    };
    attr('aPos', m.pos.data, 3); attr('aNrm', m.nrm.data, 3); attr('aUv', m.uv.data, 2);
    const ib = gl.createBuffer(); bufs.push(ib); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx.data, gl.STATIC_DRAW);
    const tex = (img) => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      return t;
    };
    const texs = [tex(m.colorImg)];
    if (m.normalImg) texs.push(tex(m.normalImg));
    gl.bindVertexArray(null);
    this.mesh = { vao, bufs, texs, count: m.idx.data.length, type: m.idx.data instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, min: m.pos.min, max: m.pos.max };
  }

  /**
   * The round stand under the soldier's feet: a disc of radius BASE_R from y = 0 down to -BASE_H, with
   * a bevelled top edge. uv.x carries the shade (0 top, 1 edge).
   */
  makeStand() {
    const gl = this.gl, N = 72, R = BASE_R, B = 0.018, Hh = BASE_H;
    const P = [], Nn = [], U = [], I = [];
    const ring = (r, y, ny, nr, shade) => {
      const start = P.length / 3;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        P.push(r * c, y, r * s); Nn.push(nr * c, ny, nr * s); U.push(shade, 0);
      }
      return start;
    };
    const strip = (a, b) => { for (let i = 0; i < N; i++) I.push(a + i, b + i, a + i + 1, a + i + 1, b + i, b + i + 1); };
    const centre = P.length / 3; P.push(0, 0, 0); Nn.push(0, 1, 0); U.push(0, 0);
    const top = ring(R - B, 0, 1, 0, 0);
    for (let i = 0; i < N; i++) I.push(centre, top + i + 1, top + i);
    const bev0 = ring(R - B, 0, 0.7, 0.7, 0.6), bev1 = ring(R, -B, 0.7, 0.7, 0.8);
    strip(bev0, bev1);
    const side0 = ring(R, -B, 0, 1, 1), side1 = ring(R, -Hh, 0, 1, 0.75);
    strip(side0, side1);
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const attr = (name, data, n) => {
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      const l = gl.getAttribLocation(this.prog, name); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, 0, 0);
    };
    attr('aPos', P, 3); attr('aNrm', Nn, 3); attr('aUv', U, 2);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(I), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: I.length };
  }

  /** Keep animating while turning or easing back to rest. */
  kick() { if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t)); }

  frame(t) {
    this.raf = 0;
    const dt = this.last ? Math.min(0.05, (t - this.last) / 1000) : 0.016;
    this.last = t;
    let moving = false;
    if (this.spin) { this.yaw += dt * 1.6; moving = true; } else {
      // ease back to the rest angle by the shortest way round
      let d = ((this.rest - this.yaw) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
      if (Math.abs(d) > 0.002) { this.yaw += d * Math.min(1, dt * 5); moving = true; } else this.yaw = this.rest;
    }
    this.draw();
    if (moving) this.kick(); else this.last = 0;
  }

  draw() {
    const gl = this.gl, c = this.canvas, M = this.mesh;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (!w || !h) return;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!M) return;
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.prog);
    // orthographic camera, slightly from above, fitting the figure's height (and its turning width)
    const y0 = Math.min(M.min[1], -BASE_H), H = M.max[1] - y0, R = Math.max(BASE_R, Math.hypot(M.max[0], M.max[2]), Math.hypot(M.min[0], M.min[2]));
    // one framing for every soldier (the widest kit, 0.8), so all armies show at the same size
    const aspect = w / h, half = Math.max(H * 0.53, (Math.max(0.8, R) * 1.05) / aspect);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), tilt = 0.2, ct = Math.cos(tilt), st = Math.sin(tilt);
    // rows of R = Rx(tilt) * Ry(yaw)
    const r00 = cy, r01 = 0, r02 = sy, r10 = st * sy, r11 = ct, r12 = -st * cy, r20 = -ct * sy, r21 = st, r22 = ct * cy;
    const sx = 1 / (half * aspect), sY = 1 / half, sz = -1 / (R * 4 + H);
    const yc = H * 0.5 + y0;
    // MVP = Scale * R * Translate(0, -yc, 0), column-major
    const mvp = new Float32Array([
      sx * r00, sY * r10, sz * r20, 0,
      sx * r01, sY * r11, sz * r21, 0,
      sx * r02, sY * r12, sz * r22, 0,
      sx * (-yc * r01), sY * (-yc * r11), sz * (-yc * r21), 1,
    ]);
    gl.uniformMatrix4fv(this.loc.mvp, false, mvp);
    gl.uniformMatrix3fv(this.loc.rot, false, new Float32Array([r00, r10, r20, r01, r11, r21, r02, r12, r22]));
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, M.texs[0]); gl.uniform1i(this.loc.color, 0);
    gl.uniform1i(this.loc.hasN, M.texs.length > 1 ? 1 : 0);
    if (M.texs[1]) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, M.texs[1]); gl.uniform1i(this.loc.normal, 1); }
    gl.uniform1i(this.loc.base, 0);
    gl.bindVertexArray(M.vao);
    gl.drawElements(gl.TRIANGLES, M.count, M.type, 0);
    gl.uniform1i(this.loc.base, 1);
    gl.bindVertexArray(this.stand.vao);
    gl.drawElements(gl.TRIANGLES, this.stand.count, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  }
}
