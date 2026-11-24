// Render a building's 3D model (.glb) to a game sprite through the game's isometric camera and sun, as the
// town of Dixmude and its buildings were made. The page (render.html, three.js) is served from this folder.
//
//   cd tools/render-glb && npm install
//   node render.cjs <model.glb> <out.webp> [--yaw 3.1416] [--scale 1.6] [--px 2] [--sat 0.75]
//
//   --yaw    turn about the vertical (radians; 3.1416 faces the town's front to the camera)
//   --scale  tiles per model unit (a Meshy model is about 1.9 units long: 1.6 makes a 3-tile house)
//   --px     pixels per tile at the game's 1x scale (drawn in the game with k = 1 / px)
//   --sat    colour saturation, toned to the battlefield's grey light (1 = as rendered)
//   --cut    boxes in the model's own coordinates to leave out (JSON: [[[x0,y0,z0],[x1,y1,z1]], ...])
//
// Prints the sprite's ground anchor (ax, ay: where the model's centre on the ground falls in the cropped
// image) and its footprint in tiles (hx, hy: half-widths along the map's x and y), for the level's setup.
// Needs Playwright with Chromium (software WebGL).
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? Number(args[i + 1]) : d; };
const [glb, out] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!glb || !out) { console.error('usage: node render.cjs <model.glb> <out.webp> [--yaw r] [--scale s] [--px p] [--sat k]'); process.exit(1); }
const job = { yaw: opt('yaw', Math.PI), S: opt('scale', 1.6), P: opt('px', 2) }, sat = opt('sat', 0.75);
{ const i = args.indexOf('--cut'); if (i >= 0) job.cut = JSON.parse(args[i + 1]); } // boxes of the model to leave out: '[[[x0,y0,z0],[x1,y1,z1]], ...]'

const types = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = url === '/model.glb' ? path.resolve(glb) : path.join(__dirname, path.normalize(url).replace(/^([/\\])+/, ''));
  if (url !== '/model.glb' && !file.startsWith(__dirname)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => { if (err) { res.writeHead(404).end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }).end(data); });
});

server.listen(0, async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const p = await b.newPage();
    p.on('pageerror', (e) => console.error('page error:', e.message));
    await p.goto(`http://localhost:${server.address().port}/render.html`);
    await p.waitForFunction(() => window.load);
    await p.evaluate(() => window.load('model.glb'));
    const r = await p.evaluate(async ({ job, sat }) => {
      const r = window.renderTown(job);
      const im = new Image(); im.src = r.url; await im.decode();
      // crop to what was drawn (the model and its shadow), toned to the battlefield's light
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      const g = c.getContext('2d'); g.drawImage(im, 0, 0);
      const a = g.getImageData(0, 0, c.width, c.height).data;
      let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (a[(y * c.width + x) * 4 + 3] > 6) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
      const og = o.getContext('2d'); og.filter = `saturate(${sat})`; og.drawImage(c, -x0, -y0);
      return { data: o.toDataURL('image/webp', 0.9), ax: r.ax - x0, ay: r.ay - y0, w: o.width, h: o.height, size: r.size };
    }, { job, sat });
    fs.writeFileSync(out, Buffer.from(r.data.split(',')[1], 'base64'));
    // three.js x and y are the map's y and x (the game's map is the mirror image of three's world)
    console.log(JSON.stringify({ out, w: r.w, h: r.h, ax: r.ax, ay: r.ay, k: 1 / job.P, hx: +(r.size[1] / 2).toFixed(2), hy: +(r.size[0] / 2).toFixed(2), height: +r.size[2].toFixed(2) }));
  } finally { await b.close(); server.close(); }
});
