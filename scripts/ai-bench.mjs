// node scripts/ai-bench.mjs [minutes] [battles] [easy|medium|hard]
// AI benchmark: (a) the enemy AI against a passive player army (holds its trenches, no commander);
// (b) AI vs AI. Reports how deep the attacks get and who wins.
import { createGame, update } from '../src/game.js';
import { PLAYER, ENEMY } from '../src/config.js';
import { teamDir } from '../src/map.js';
const MIN = +(process.argv[2] || 20), N = +(process.argv[3] || 6), LEVEL = process.argv[4] || 'medium';
function run(aiTeams, seed) {
  const s = createGame({ seed, aiTeams, difficulty: LEVEL });
  let deepest = 0; // furthest enemy-captured player trench, in tiles from the player's front towards its HQ
  const hq = s.map.hq[PLAYER];
  const startFront = s.map.tiles.filter((t) => t.trench && t.owner === PLAYER).reduce((m, t) => Math.max(m, t.x * teamDir(PLAYER)), -1e9);
  let t = 0;
  for (; t < MIN * 60 && s.winner < 0; t += 0.1) {
    update(s, 0.1);
    if (Math.round(t * 10) % 50 === 0) for (const tile of s.map.tiles) if (tile.trench && tile.origOwner === PLAYER && tile.owner === ENEMY) deepest = Math.max(deepest, startFront - tile.x * teamDir(PLAYER));
  }
  const taken = [PLAYER, ENEMY].map((team) => s.map.tiles.filter((x) => x.trench && x.origOwner === 1 - team && x.owner === team).length);
  return { winner: s.winner, time: Math.round(t), deepest, taken, lost: s.stats.lost.slice() };
}
for (const [label, ai] of [['enemy AI vs passive player', [ENEMY]], ['AI vs AI', [PLAYER, ENEMY]]]) {
  const rs = []; for (let i = 0; i < N; i++) rs.push(run(ai, 100 + i));
  console.log(label, '| enemy wins', rs.filter((r) => r.winner === ENEMY).length, 'player wins', rs.filter((r) => r.winner === PLAYER).length, 'of', N);
  for (const r of rs) console.log('   ', JSON.stringify(r));
}
