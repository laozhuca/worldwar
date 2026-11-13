// Saving and loading a battle. The whole simulation state goes into one JSON document: the map's tiles are
// stored as compact arrays, and the links between objects (a unit's target, its nearest enemy, the works it
// is digging) as ids or tile coordinates, then rebuilt on load. No DOM: the storage is the caller's business.
import { MAP_W, MAP_H } from './config.js';
import { setWestTeam } from './map.js';
import { setNextId } from './game.js';

export const SAVE_VERSION = 1;
const TILE_KEYS = ['mud', 'shade', 'crater', 'trench', 'owner', 'origOwner', 'wire', 'origWire', 'build', 'decor', 'dmg', 'decorHp', 'splinters'];

/** The battle as a JSON string. */
export function serialize(state) {
  const { map } = state;
  const units = state.units.map((u) => ({
    ...u,
    target: u.target ? u.target.id : null,
    closest: u.closest ? u.closest.id : null,
    digSite: u.digSite ? [u.digSite.x, u.digSite.y] : null,
  }));
  const data = {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    map: { w: map.w, h: map.h, west: map.west, hq: map.hq, tiles: map.tiles.map((t) => TILE_KEYS.map((k) => t[k])) },
    units,
    rest: { ...state, map: undefined, units: undefined, effects: [], events: [] },
  };
  return JSON.stringify(data, (k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e4) / 1e4 : v));
}

/** A short description of a save (for the "continue" button), or null if it can't be loaded. */
export function describe(json) {
  try {
    const d = JSON.parse(json);
    if (d.version !== SAVE_VERSION || d.map.w !== MAP_W || d.map.h !== MAP_H) return null;
    return { savedAt: d.savedAt, time: d.rest.time, nations: d.rest.nations, season: d.rest.season, start: d.rest.start, difficulty: d.rest.difficulty || 'medium' };
  } catch { return null; }
}

/** Rebuild a battle from serialize()'s output (throws if it isn't a usable save). */
export function deserialize(json) {
  const d = JSON.parse(json);
  if (d.version !== SAVE_VERSION) throw new Error('Saved with an older version of the game');
  if (d.map.w !== MAP_W || d.map.h !== MAP_H) throw new Error('Saved on a different map');
  const R = MAP_W / 2 - 0.5;
  const tiles = d.map.tiles.map((a, i) => {
    const t = { x: i % d.map.w, y: Math.floor(i / d.map.w) };
    TILE_KEYS.forEach((k, j) => { t[k] = a[j]; });
    t.off = Math.abs(t.x + 0.5 - MAP_W / 2) + Math.abs(t.y + 0.5 - MAP_H / 2) > R + 0.5;
    return t;
  });
  const map = { w: d.map.w, h: d.map.h, tiles, dirty: true, hq: d.map.hq, changes: [], west: d.map.west };
  setWestTeam(map.west);
  const byId = new Map(d.units.map((u) => [u.id, u]));
  for (const u of d.units) {
    u.target = u.target != null ? byId.get(u.target) || null : null;
    u.closest = u.closest != null ? byId.get(u.closest) || null : null;
    u.digSite = u.digSite ? tiles[u.digSite[1] * map.w + u.digSite[0]] : null;
  }
  setNextId(d.units.reduce((m, u) => Math.max(m, u.id), 0) + 1);
  return { ...d.rest, map, units: d.units, effects: [], events: [] };
}
