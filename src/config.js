// Global tuning constants for WorldWar.
// Map coordinates are in tiles; x runs west (player) -> east (enemy).

export const TILE_W = 64;
export const TILE_H = 32;
export const MAP_W = 64;
export const MAP_H = 40;

export const PLAYER = 0;
export const ENEMY = 1;
export const TEAM_NAMES = ['Allied', 'Central'];

export const UNIT_TYPES = {
  rifle: {
    key: 'rifle',
    name: 'Rifle Squad',
    men: 6,
    hpPerMan: 10,
    range: 6,
    sight: 9,
    fireInterval: 2.0,
    hitChance: 0.28,
    damage: 6,
    suppressPerShot: 1.2,
    ammoPerShot: 0.05,
    speed: 0.85,
    melee: 1.6,
    canDig: true,
    cost: { men: 6, ammo: 0, supplies: 6 },
    hotkey: '1',
    desc: 'Riflemen. Hold trenches, dig works, and go over the top with fixed bayonets.',
  },
  mg: {
    key: 'mg',
    name: 'Machine Gun Team',
    men: 4,
    hpPerMan: 12,
    range: 9,
    sight: 10,
    fireInterval: 0.5,
    burst: 6,
    hitChance: 0.2,
    damage: 6,
    suppressPerShot: 2.2,
    ammoPerShot: 0.07,
    speed: 0.6,
    setup: 3,
    melee: 0.8,
    cost: { men: 4, ammo: 30, supplies: 25 },
    hotkey: '2',
    desc: 'Heavy machine gun. Murderous against troops in the open. Needs 3s to set up.',
  },
  artillery: {
    key: 'artillery',
    name: 'Field Battery',
    men: 6,
    hpPerMan: 10,
    range: 0,
    sight: 6,
    speed: 0.35,
    melee: 0.5,
    artyRange: 36,
    barrageShells: 8,
    shellInterval: 6, // a gun fires every ~6 s (was 1.2)
    cooldown: 14,
    shellAmmo: 4,
    cost: { men: 6, ammo: 0, supplies: 60 },
    hotkey: '3',
    desc: 'Field guns. Bombard a target area: kills, suppresses, cuts wire and wrecks trenches.',
  },
};

// Damage multipliers by trench level (index 0 = open ground).
export const TRENCH_COVER = [1, 0.4, 0.28, 0.18]; // small-arms fire
export const TRENCH_ARTY = [1, 0.55, 0.42, 0.3]; // shellfire

export const BUILD = {
  trench: { key: 'trench', name: 'Dig Trench', supplies: 12, work: 10, hotkey: 'T',
    desc: 'Dig a new trench section. Needs a rifle squad nearby to dig.' },
  upgrade: { key: 'upgrade', name: 'Reinforce Trench', supplies: 25, work: 14, hotkey: 'U',
    desc: 'Sandbag / revet an existing trench (max level 3). Better cover.' },
  wire: { key: 'wire', name: 'Barbed Wire', supplies: 10, work: 6, hotkey: 'X',
    desc: 'Lay barbed wire. Slows everyone who crosses it to a crawl.' },
};

export const BUILD_RADIUS_FRIENDLY = 5; // must be this close to a friendly unit
export const BUILD_RADIUS_ENEMY = 4; // and no enemy this close
export const DIG_RADIUS = 3.5;
export const DIG_RATE = 0.1; // work per man per second

export const SUPPLY_INTERVAL = 20; // seconds between supply convoys
export const BASE_INCOME = { men: 14, ammo: 70, supplies: 45 };
export const CAPTURE_BONUS = { men: 0.5, ammo: 2, supplies: 1.5 }; // per captured enemy trench tile
export const START_RES = { men: 30, ammo: 350, supplies: 200 };

export const SUPPRESSION_DECAY = 12; // per second
export const CHARGE_SPEED = 2.0; // a run is much faster than the walk
export const MELEE_RANGE = 0.9;
export const WIRE_SLOW = 0.25;

// Visual seasons (art direction from the concept art: snow / thaw / mud).
export const SEASONS = {
  winter: { key: 'winter', name: 'Winter', snow: 1, precip: 'snow', desc: 'Snow-covered fields, frozen shell holes.' },
  thaw: { key: 'thaw', name: 'Thaw', snow: 0.5, precip: 'sleet', desc: 'Patchy snow over churned mud.' },
  mud: { key: 'mud', name: 'Mud', snow: 0, precip: 'rain', desc: 'Rain, black mud and flooded craters.' },
};

// Playable nations (uniform art: assets/soldiers/<key>/, portraits: assets/art/soldier-<key>.png when supplied).
export const NATIONS = {
  uk: { name: 'Britain', alliance: 'allied' },
  france: { name: 'France', alliance: 'allied' },
  usa: { name: 'United States', alliance: 'allied' },
  italy: { name: 'Italy', alliance: 'allied' },
  russia: { name: 'Russia', alliance: 'allied' },
  germany: { name: 'Germany', alliance: 'central' },
  austria: { name: 'Austria-Hungary', alliance: 'central' },
  ottoman: { name: 'Ottoman Empire', alliance: 'central' },
};
