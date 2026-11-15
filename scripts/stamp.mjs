// Cache-busting: stamp every script module and the stylesheet in index.html with a hash of its
// contents, so after a deploy the browser fetches exactly the files that changed and never mixes an
// old cached module with new ones. Run before committing: node scripts/stamp.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const hash = (f) => createHash('sha1').update(readFileSync(f)).digest('hex').slice(0, 8);
const mods = readdirSync('src').filter((f) => f.endsWith('.js')).sort();
const map = Object.fromEntries(mods.map((f) => [`./src/${f}`, `./src/${f}?v=${hash(`src/${f}`)}`]));
const block = `<!-- stamp:begin (scripts/stamp.mjs) -->\n  <script type="importmap">\n  ${JSON.stringify({ imports: map }, null, 2).replace(/\n/g, '\n  ')}\n  </script>\n  <!-- stamp:end -->`;

let html = readFileSync('index.html', 'utf8');
html = /<!-- stamp:begin[\s\S]*?<!-- stamp:end -->/.test(html)
  ? html.replace(/<!-- stamp:begin[\s\S]*?<!-- stamp:end -->/, block)
  : html.replace('</head>', `  ${block}\n</head>`);
html = html.replace(/href="style\.css(\?v=[^"]*)?"/, `href="style.css?v=${hash('style.css')}"`);
html = html.replace(/src="src\/main\.js(\?v=[^"]*)?"/, `src="src/main.js?v=${hash('src/main.js')}"`);
writeFileSync('index.html', html);
console.log(`stamped ${mods.length} modules + style.css`);
