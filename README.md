# WorldWar — Trench Command

A 2D isometric (45°) real-time strategy game about the Western Front in World War 1.
Trenches, machine guns, barbed wire and artillery decide everything. Walk into no man's
land unprepared and the machine guns will cut you down. To gain ground you must
**bombard** (cut the wire, suppress the defenders) and then **charge** as the barrage lifts.
Then dig in, reinforce and wire the new line before the counter-attack comes.

Runs in any modern browser. Plain JavaScript modules with no build step and no dependencies.

## Play

```bash
npm start
```

Then open http://localhost:8000. Or play online at **https://laozhuca.github.io/worldwar/** (deployed automatically from `main` by `.github/workflows/pages.yml`).

Any static file server works too. The page must be served over HTTP rather than opened
as `file://`, because it uses ES modules.

## Core loop

| System | What it does |
|---|---|
| **Supply convoys** | Every 20s you receive men, ammunition and supplies. Each captured enemy trench section increases the flow. |
| **Men** | Recruit rifle squads, MG teams and field batteries, and replace casualties (Reinforce). |
| **Ammunition** | Every rifle volley, MG burst and shell uses ammo. Without it fire drops to a trickle. |
| **Supplies** | Recruiting, digging trenches, reinforcing trenches (levels 1–3), laying barbed wire, replacements. |
| **Trenches** | Cut small-arms damage to 40% / 28% / 18% (by level), and shell damage less so. |
| **Machine guns** | Short setup time, then murderous fire on troops in the open. Fire pins walking troops. |
| **Barbed wire** | Slows anyone crossing it to a quarter speed. Shellfire cuts it. |
| **Artillery** | 8-shell barrages: kill, suppress, cut wire, collapse trench works, churn the ground. Friendly fire is real. |
| **Charge** | Fast, can't be pinned, no firing. Ends in a bayonet fight. |
| **Capture** | Occupy trench tiles with no enemy nearby. Take the enemy HQ (far east) to win. |

**Textures & relief**: the ground is built from tileable PNG textures (palette sampled from the concept art), sculpted by a 16 px-per-tile height field of the whole battlefield: crater bowls with raised lips, trench spoil ridges, wheel ruts and rolling ground, lit by a soft low light with ambient occlusion and wet glints on the mud. Snow settles on crests and flats, earth shows on steep blasted faces, water and ice collect in the hollows. Shell impacts update the relief locally; trench planks, sandbags and duckboards run along each trench. Replace any PNG in `assets/textures/` with your own art (same name, seamless) and it is used automatically.

**Props & trenches**: trenches, barbed wire, stumps, dead trees, logs and debris are 3D models pre-rendered to PNG from the game's exact isometric camera, with the terrain's sun, soft shadows and ambient occlusion (the classic isometric-game pipeline). Trenches are tiles chosen by which neighbours connect (16 shapes x 3 levels x 3 random variants: hasty with sloping clay walls and a flooded floor, revetted with duckboards and double sandbags, concrete), each with a snow variant. Every variant is deliberately untidy: wobbly wall lines, slumped earth, lumpy spoil heaps, jittered/burst/missing sandbags, missing boards and slats, cracked concrete, mud stains, and clutter such as ammo crates, shell casings, leaning planks and fallen sandbags; randomness fades out at tile edges so neighbours always join. Wire is concertina coil on knife-rest frames, intact or shell-cut, for both belt directions. Replace any PNG in `assets/props/` with your own render of the same name and it is used automatically.

**Sides & nations**: on the start screen choose to fight for the Allies (Britain, France, the United States, Italy, Russia) or the Central Powers (Germany, Austria-Hungary, the Ottoman Empire), then your nation and the enemy's, or pick Random to be assigned a side and both nations when the battle starts (each restart draws again). Each army's soldiers are 3D-rendered in their own uniform and headgear (Brodie and Adrian helmets, Pickelhaube, fez, peaked cap, Austrian field cap, greatcoats), modelled on the reference art in `art-src/`, with poses for standing, walking, charging with bayonets, firing, aiming over the parapet, lying prone, digging and falling. Batteries are a 3D model of the supplied howitzer art, rendered in 8 directions with turning wheels (towed trail-first when moving, laid on the target when firing); machine guns are a rendered water-cooled gun on a tripod.

**Starting position**: start in the upper left or lower right of the map, or at random. Fortifications go with the army, not the position: your side always holds the lighter works with sally ports in its wire, the enemy the heavier ones.

**Seasons**: Winter (snow, frozen shell holes), Thaw (patchy snow over mud) and Mud (rain, flooded craters), chosen on the start screen. Shellfire and digging churn the snow into black earth.

**Atmosphere** (purely visual): a day/night cycle with star-shell flares and dynamic light from gunfire and explosions; passing rain showers; drifting ground mist; screen shake; hand-drawn shell-impact animation (the supplied 36-frame artwork, colour-graded into the battlefield palette, with continuous drift, swelling and wind between frames, a ground shadow and an impact flash); fallen soldiers left on the field; and a 🎞 film-look toggle (colour / sepia / black and white).

The enemy commander garrisons its line, uses defensive and harassing barrages,
counter-attacks lost trenches, repairs its wire and launches its own offensives.

## Controls

| Input | Action |
|---|---|
| Left-click / drag | Select units (Shift adds to the selection) |
| Right-click | Move (Ctrl + right-click to charge) |
| `C`, then click | Charge |
| `B`, then click | Bombard: uses the selected batteries, or the next ready battery (Shift keeps the mode on) |
| `T` / `U` / `X` | Dig trench / reinforce trench / lay wire. Click or drag to paint; Alt-click cancels a site |
| `R` / `H` | Reinforce selected units / halt |
| `1` `2` `3` | Recruit rifle squad / MG team / field battery |
| `Q` | Select all rifle squads |
| WASD, arrows, screen edges, middle-drag | Scroll; mouse wheel zooms |
| `Space` / `P` / `Esc` / `F1` | Jump to front / pause / cancel / help |

## Project layout

```
index.html, style.css   UI shell and HUD
src/config.js           all tuning numbers (units, costs, cover, income)
src/map.js              battlefield generation (trench lines, wire, craters)
src/game.js             simulation: movement, fire, suppression, artillery, digging, capture, supply
src/ai.js               computer commander (works for either side)
src/render.js           isometric canvas renderer
src/ui.js               input + HUD
src/relief.js           battlefield height field: lighting, occlusion, snow/earth/water placement
src/atmosphere.js       day/night, lighting, flares, rain, fog, grain, screen shake
src/audio.js            WebAudio: recorded artillery samples + procedural fallbacks
assets/sfx/             artillery fire and 2 explosion samples (first 3.5 s of the supplied recordings in art-src/sfx/)
src/main.js             game loop
assets/textures/        generated seamless PNG textures (mud, earth, snow, grass, ice, water, planks, sandbags, duckboards)
scripts/make-textures.mjs  texture generator: `npm run textures` (no dependencies)
assets/soldiers/<nation>/ pre-rendered soldier sprites (8 poses, 2 views, mirrored in game) + portrait
assets/art/             cut-out howitzer art and soldier portraits (from art-src/ via `node scripts/process-art.mjs`)
assets/atlas/           WebP sprite sheets the game actually loads (built by `npm run atlas` from assets/props + assets/soldiers)
assets/fx/              graded shell-impact frames (`npm run impact` builds them from art-src/fx/ with Playwright)
assets/props/           pre-rendered 3D props: 144 trench tiles x snow, wire belts, stumps, trees, logs, debris
tools/render3d/         offline ray-marching renderer + 3D models; `npm run props` re-renders assets/props (no dependencies)
tests/                  headless simulation tests (node --test)
```

The simulation has no DOM dependencies, so it is tested headlessly:

```bash
npm test
```

The tests cover barrages, MG lethality, digging, recruiting and reinforcing, plus a 10-minute AI-vs-AI battle.

## Adding art

Drop transparent-background PNG/WebP files into `art-src/` and run `node scripts/process-art.mjs` (needs Playwright).
Nation portraits use `art-src/soldier-<nation>.webp` when present (`uk`, `france`, `usa`, `italy`, `russia`, `germany`, `austria`, `ottoman`); otherwise the rendered 3D portrait is shown.

After re-rendering props or soldiers (`npm run props`), rebuild the sprite sheets with `npm run atlas` (needs Playwright). The game downloads only the sheets for the current season and the two nations in play, each with retries, so one slow download never leaves the battlefield on the fallback drawings.
