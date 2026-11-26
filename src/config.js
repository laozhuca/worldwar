// Global tuning constants for WorldWar.
// Map coordinates are in tiles; x runs west (player) -> east (enemy).

export const TILE_W = 64;
export const TILE_H = 32;
// The battlefield is a diamond in map coordinates, which the 45° camera shows as a 2:1 rectangle on screen.
// It sits in a MAP_W x MAP_H grid: tiles whose centre is more than MAP_R tiles (|dx| + |dy|) from the middle
// are outside the battlefield.
export const MAP_R = 34;
export const MAP_W = 2 * MAP_R + 1;
export const MAP_H = 2 * MAP_R + 1;

export const PLAYER = 0;
export const ENEMY = 1;
export const TEAM_NAMES = ['Entente', 'Central'];

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
    melee: 3.2, // fixed bayonets: rifle squads are deadly at close quarters
    canDig: true,
    cost: { men: 6, ammo: 0, supplies: 6 },
    hotkey: '1',
    desc: 'Riflemen. Hold trenches, dig works, and go over the top with fixed bayonets.',
  },
  mg: {
    key: 'mg',
    name: 'Machine Gun Team',
    short: 'MG Team', // on the narrow unit cards
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
    artyMinRange: 10, // the guns can't drop shells closer than this
    barrageShells: 8,
    setup: 4, // the guns must be unlimbered before they can fire again after moving
    shellInterval: 6, // a gun fires every ~6 s (was 1.2)
    cooldown: 14,
    shellAmmo: 4,
    cost: { men: 6, ammo: 0, supplies: 60 },
    hotkey: '3',
    desc: 'Field guns. Bombard a target area: kills, suppresses, cuts wire and wrecks trenches.',
  },
  tank: {
    key: 'tank',
    name: 'Tank',
    short: 'Tank',
    men: 8,
    hpPerMan: 40,
    range: 8, // its machine guns, firing every way
    sight: 9,
    speed: 0.44,
    melee: 0,
    fireInterval: 0.6,
    burst: 6,
    hitChance: 0.22,
    damage: 6,
    suppressPerShot: 2.6,
    ammoPerShot: 0, // (its own ammunition, aboard)
    mgRounds: 150, // bursts of machine-gun fire it carries
    shells: 20, // rounds for its side guns
    cannonRange: 11,
    cannonInterval: 4.5,
    cost: { men: 24, ammo: 500, supplies: 500 },
    hotkey: '4',
    special: true, // (only where a level provides it)
    desc: 'A landship: rolls over wire and trenches, its machine guns fire every way and its side guns hit what lies abeam. Bullets glance off and it is never pinned; a direct shell hit costs it a third of its strength, a near miss less. It may ditch in a trench or break down, and its ammunition runs out.',
  },
};

// Damage multipliers by trench level (index 0 = open ground).
export const TRENCH_COVER = [1, 0.4, 0.28, 0.18]; // small-arms fire
export const TRENCH_ARTY = [1, 0.55, 0.42, 0.3]; // shellfire
// Shell damage to trench works (0-100 per tile). Trenches are hard to damage: a direct hit does
// TRENCH_HIT, a near miss TRENCH_NEAR, divided by the works' toughness (hasty, sandbagged, concrete).
// A fully wrecked section keeps only a quarter of its protection until it is dug out again (T).
export const TRENCH_HIT = 16, TRENCH_NEAR = 5;
export const TRENCH_TOUGH = [1, 1, 1.6, 2.6];
export const TRENCH_WRECK_LOSS = 0.75;
// A shell bursting outside the trench (on the parapet, in the open) mostly spends itself on the earth
// walls: men in the trench take only this share of its blast, on top of the trench's cover. A direct
// hit in the trench gets no such help. Wrecked works lose most of it (as their cover).
export const TRENCH_NEAR_MISS = 0.35;
/** Protection factor (damage multiplier) of a trench tile, given its damage. */
export function trenchCover(table, tile) {
  const base = table[tile.trench];
  return base + (1 - base) * TRENCH_WRECK_LOSS * Math.min(1, (tile.dmg || 0) / 100);
}

export const BUILD = {
  trench: { key: 'trench', name: 'Dig Trench', supplies: 12, work: 10, hotkey: 'T',
    desc: 'Dig a new trench section, or dig out a shell-damaged one. Needs a rifle squad nearby to dig.' },
  upgrade: { key: 'upgrade', name: 'Reinforce Trench', supplies: 25, work: 14, hotkey: 'U',
    desc: 'Sandbag / revet an existing trench (max level 3). Better cover.' },
  wire: { key: 'wire', name: 'Barbed Wire', supplies: 10, work: 6, hotkey: 'X',
    desc: 'Lay barbed wire. Slows everyone who crosses it to a crawl.' },
};

export const HQ_THREAT_RADIUS = 6; // enemy troops this close to an HQ stop it raising new units
export const BUILD_RADIUS_FRIENDLY = 5; // must be this close to a friendly unit
export const BUILD_RADIUS_ENEMY = 4; // and no enemy this close
export const DIG_RADIUS = 3.5;
export const DIG_RATE = 0.1; // work per man per second

export const SUPPLY_INTERVAL = 20; // seconds between supply convoys
export const BASE_INCOME = { men: 14, ammo: 70, supplies: 45 };
export const CAPTURE_BONUS = { men: 0.5, ammo: 2, supplies: 1.5 }; // per captured enemy trench tile
export const START_RES = { men: 30, ammo: 350, supplies: 200 };

// Difficulty: how the computer commander fights (your own army and supplies are the same at every level).
//   income      share of the normal supply convoys it receives
//   firstAttack seconds before its first offensive; attackGap: seconds between offensives [min, max]
//   force       most squads it commits to an offensive; guns: batteries that prepare each objective
//   topUp       whether it feeds reserves into a weakening attack; steps: objectives per offensive
//   rifleCap    the infantry it keeps; defensiveGap: seconds between its defensive barrages
// The computer's commander at each level. Not only how much he has and how often he comes, but how well he fights:
// how fast he reacts, how well his men shoot, how he moves them, how he uses his guns and how he copes with failure.
//   income / start: his share of the supply convoys, and of the starting stock
//   think: seconds between his decisions          aim: his men's marksmanship (x their hit chance)
//   routes: keeps to the trenches and goes round wire (else straight across, wire and all)
//   double: his riflemen cross open ground at the double
//   rested: waits for the men's wind before a charge
//   prep: 'full' - every battery on the objective and the machine guns covering it, the men going in as the last
//         shells fall; 'light' - one battery on the objective, then go
//   counterBattery: his idle guns hunt our batteries and machine guns (in pairs, with concentrate)
//   concentrate: two batteries together on one machine gun or battery; support: covering fire on the machine
//         guns firing on his attack while it goes in
//   fallBack: mauled squads, stalled or failed attacks go back to a trench; repair: re-wires and re-digs his works
//   force / firstAttack / attackGap / steps / rifleCap / topUp / defensiveGap: the size, rhythm and depth of his attacks
export const DIFFICULTY = {
  easy: { name: 'Easy', income: 0.75, start: 0.8, think: 2, aim: 0.85, routes: false, double: false, rested: false, prep: 'light', counterBattery: false, concentrate: false, support: false, fallBack: false, repair: false,
    firstAttack: 360, attackGap: [300, 380], force: 5, guns: 1, topUp: false, steps: 2, rifleCap: 13, defensiveGap: 20 },
  medium: { name: 'Medium', income: 1, start: 1, think: 1, aim: 1, routes: true, double: false, rested: true, prep: 'full', counterBattery: true, concentrate: false, support: false, fallBack: true, repair: true,
    firstAttack: 240, attackGap: [190, 260], force: 6, guns: 3, topUp: true, steps: 4, rifleCap: 18, defensiveGap: 12 },
  hard: { name: 'Hard', income: 1.25, start: 1.25, think: 0.5, aim: 1.12, routes: true, double: true, rested: true, prep: 'full', counterBattery: true, concentrate: true, support: true, fallBack: true, repair: true,
    firstAttack: 170, attackGap: [120, 180], force: 8, guns: 9, topUp: true, steps: 7, rifleCap: 22, defensiveGap: 9 },
};

export const SUPPRESSION_DECAY = 12; // per second
export const CHARGE_SPEED = 2.0; // a run is much faster than the walk
// A rifle squad's wind (0-100): a charge uses it up (about 11 s of running flat out); it comes back standing or
// lying still, and slowly on the walk. Below WINDED the run slows towards a walk and the bayonet fight weakens.
export const STAMINA = { charge: 9, melee: 4.5, rest: 12, walk: 4, winded: 35 };
export const MELEE_RANGE = 0.9;
export const WIRE_SLOW = 0.25;

// Visual seasons (art direction from the concept art: snow / thaw / mud).
export const SEASONS = {
  winter: { key: 'winter', name: 'Winter', snow: 1, precip: 'snow', desc: 'Snow-covered fields, frozen shell holes.' },
  thaw: { key: 'thaw', name: 'Thaw', snow: 0.5, precip: 'none', desc: 'Patchy snow over churned mud.' },
  mud: { key: 'mud', name: 'Mud', snow: 0, precip: 'showers', desc: 'Black mud, flooded craters, passing rain showers.' },
  summer: { key: 'summer', name: 'Summer', snow: 0, precip: 'none', desc: 'Early summer: meadows and ripening wheat behind the lines.' }, // (campaign only)
};

// Playable nations (uniform art: assets/soldiers/<key>/, portraits: assets/art/soldier-<key>.png when supplied).
export const NATIONS = {
  uk: { name: 'Britain', alliance: 'entente' },
  france: { name: 'France', alliance: 'entente' },
  usa: { name: 'United States', alliance: 'entente' },
  italy: { name: 'Italy', alliance: 'entente' },
  russia: { name: 'Russia', alliance: 'entente' },
  germany: { name: 'Germany', alliance: 'central' },
  austria: { name: 'Austria-Hungary', alliance: 'central' },
  ottoman: { name: 'Ottoman Empire', alliance: 'central' },
  // campaign-only uniforms (not offered in a new game): the French naval infantry at Dixmude
  marins: { name: 'France', alliance: 'entente', campaign: true, voice: 'france' },
};
