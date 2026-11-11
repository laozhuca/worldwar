// Soldier voice recordings: art-src/voice/*.mp3 (named "<nation>-<n>-<date>-<spoken text>.mp3") ->
// assets/voice/<nation>/<kind>-<n>.mp3 (silence trimmed, loudness-matched, mono) + assets/voice/manifest.json.
// Each recording is named "<nation>-<speaker number>-<date>-<spoken text>.mp3" and matched to its line in src/voice.js by its text.
// Usage: node scripts/process-voices.mjs   (needs ffmpeg)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { LINES } from '../src/voice.js';

const SRC = 'art-src/voice', OUT = 'assets/voice';
// armies without recordings of their own borrow another's
const BORROW = { austria: 'germany' };

const decode = (s) => s.replace(/#U([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).normalize('NFC');
const norm = (s) => s.toLowerCase().replace(/’/g, "'").replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const manifest = {};
const unmatched = [];
fs.rmSync(OUT, { recursive: true, force: true });
for (const f of fs.readdirSync(SRC).filter((x) => x.endsWith('.mp3')).sort()) {
  const name = decode(f).replace(/ \(\d+\)\.mp3$|\.mp3$/, '');
  const m = name.match(/^(.*?)-(\d{4}-\d\d-\d\d-\d\d-\d\d)-(.*)$/);
  const nation = m && m[1].replace(/-\d+$/, '');
  if (!nation || !LINES[nation]) { unmatched.push(f + ' (army)'); continue; }
  const said = norm(m[3].replace(/\[[^\]]*\]?/g, ' ').replace(/·/g, ' ').replace(/-/g, ' '));
  // kinds whose lines this recording says: exact text, or (for names cut short) the start of a line;
  // a recording of two lines ("Ready. Sir?") belongs with their kind too
  const L = LINES[nation], kinds = new Map();
  for (const [kind, lines] of Object.entries(L)) {
    if (kind === 'lang') continue;
    for (const line of lines) {
      const n = norm(line);
      const score = n === said ? 3 : (said.length >= 4 && n.startsWith(said)) ? 2 : (said.startsWith(n + ' ') && lines.some((o) => o !== line && said.endsWith(norm(o)))) ? 1 : 0;
      if (score && score >= (kinds.get(kind)?.score || 0)) kinds.set(kind, { score, line: score === 1 ? null : line });
    }
  }
  const best = Math.max(0, ...[...kinds.values()].map((k) => k.score));
  const use = [...kinds].filter(([, k]) => k.score === best);
  if (!use.length) { unmatched.push(f + ' -> "' + said + '"'); continue; }
  const text = use[0][1].line || m[3].replace(/-/g, ' ').replace(/ · /g, ' ').replace(/\s+/g, ' ').trim();
  const dir = path.join(OUT, nation);
  fs.mkdirSync(dir, { recursive: true });
  const N = (manifest[nation] ||= {});
  const id = Object.values(N).flat().length;
  const out = `${nation}/${id}.mp3`;
  // trim leading/trailing silence, even out loudness, mono 64 kbps
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(SRC, f), '-af',
    'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.12,areverse,loudnorm=I=-16:TP=-1.5:LRA=11',
    '-ar', '44100', '-ac', '1', '-b:a', '64k', path.join(OUT, out)]);
  for (const [kind] of use) (N[kind] ||= []).push({ file: out, text });
}
for (const [n, from] of Object.entries(BORROW)) if (!manifest[n] && manifest[from]) manifest[n] = manifest[from];
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
for (const [n, kinds] of Object.entries(manifest)) console.log(n.padEnd(8), Object.entries(kinds).map(([k, v]) => `${k}:${v.length}`).join(' '));
if (unmatched.length) console.log('UNMATCHED\n' + unmatched.join('\n'));
