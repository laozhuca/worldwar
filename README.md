# WorldWar

A 2D isometric (45°) real-time strategy game about trench warfare in World War 1, on every front where the armies dug in: from Flanders to the Alps, from Galicia to Gallipoli.
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
| **Men** | Recruit rifle squads, MG teams and field batteries at HQ (not while enemy troops are within 6 tiles of it). Squads are not refilled: casualties are permanent, so worn-down squads are replaced by new ones. |
| **Ammunition** | Every rifle volley, MG burst and shell uses ammo. Without it fire drops to a trickle. |
| **Supplies** | Recruiting, digging trenches, reinforcing trenches (levels 1–3), laying barbed wire. |
| **Trenches** | Cut small-arms damage to 40% / 28% / 18% (by level), and shell damage less so. A shell bursting outside a man's trench (on the parapet beside the narrow cut, in the open, or in a different trench) does only 35% of its blast to him (and suppresses him less); only a burst inside his own trench cut (his section or one joined to it) hits in full, so it takes direct hits to clear a trench. Shells slowly wreck them (sandbagged and concrete works resist longer): a wrecked section keeps only a quarter of its protection; damage shows on 3D-rendered damaged and wrecked versions of every trench tile (slumped walls, burst sandbags, missing boards, wreckage on the floor, a crater blown into the parapet, snow churned into the mud), until it is dug out again with **T** (Dig Trench on a damaged trench). |
| **Trees** | Shellfire brings trees down to shattered stumps and logs, then blows those to splinters. |
| **Machine guns** | Short setup time, then murderous fire on troops in the open. Fire pins walking troops. |
| **Barbed wire** | Slows anyone crossing it to a quarter speed. Shellfire cuts it. |
| **Artillery** | Range 10 to 36 tiles (nothing closer than 10). 8-shell barrages: kill, suppress, cut wire, collapse trench works, churn the ground. Friendly fire is real. |
| **Charge** | Rifle squads only (MG teams and batteries can't go over the top). Fast, can't be pinned, no firing. Ends in a bayonet fight: rifle squads are deadly at close quarters, and the shock of the charge doubles their bayonet damage for the first seconds. |
| **Capture** | Occupy trench tiles with no enemy nearby. Take the enemy HQ (far east) to win. |

**Textures & relief**: the ground is built from tileable PNG textures (palette sampled from the concept art), sculpted by a 16 px-per-tile height field of the whole battlefield: crater bowls with raised lips, trench spoil ridges, wheel ruts and rolling ground, lit by a soft low light with ambient occlusion and wet glints on the mud. Snow settles on crests and flats, earth shows on steep blasted faces, water and ice collect in the hollows. Shell impacts update the relief locally; trench planks, sandbags and duckboards run along each trench. Replace any PNG in `assets/textures/` with your own art (same name, seamless) and it is used automatically.

**Props & trenches**: trenches, barbed wire, stumps, dead trees, logs and debris are 3D models pre-rendered to PNG from the game's exact isometric camera, with the terrain's sun, soft shadows and ambient occlusion (the classic isometric-game pipeline). Trenches are tiles chosen by which neighbours connect (16 shapes x 3 levels x 3 random variants: hasty with sloping clay walls and a flooded floor, revetted with duckboards and double sandbags, concrete), each with a snow variant. Every variant is deliberately untidy: wobbly wall lines, slumped earth, lumpy spoil heaps, jittered/burst/missing sandbags, missing boards and slats, cracked concrete, mud stains, and clutter such as ammo crates, shell casings, leaning planks and fallen sandbags; randomness fades out at tile edges so neighbours always join. Wire is concertina coil on knife-rest frames, intact or shell-cut, for both belt directions. Replace any PNG in `assets/props/` with your own render of the same name and it is used automatically.

**Sides & nations**: on the start screen choose to fight for the Entente (Britain, France, Russia, Italy, and the United States as an associated power) or the Central Powers (Germany, Austria-Hungary, the Ottoman Empire), then your nation and the enemy's, or pick Random to be assigned a side and both nations when the battle starts (each restart draws again). In quiet moments (no target, not moving, digging or under fire) riflemen and gun crews now and then smoke a cigarette (with a wisp of smoke), clean their rifles or wipe their helmets, each man on his own random schedule, standing or in the trench. Each army's soldiers are 3D-rendered in their own uniform and headgear (Brodie and Adrian helmets, Pickelhaube, fez, peaked cap, Austrian field cap, greatcoats), modelled on the reference art in `art-src/`, with poses for standing, walking, charging with bayonets, firing, aiming over the parapet, lying prone, digging and falling. Batteries are a 3D model of the supplied howitzer art, rendered in 8 directions with turning wheels (towed trail-first when moving, laid on the target when firing); machine guns are a rendered water-cooled gun on a tripod.

**Battlefield**: a diamond in map coordinates (radius 34 tiles, about 2,400 tiles), which the 45° camera shows as a 2:1 rectangle, so the view never runs off into empty black space: the camera stays on the battlefield and zooms from a whole-front overview to 3x close-up. The trench lines run corner to corner across it; rear lines and HQs sit in the narrowing corners.

**Starting position**: start in the upper left or lower right of the map, or at random. Fortifications go with the army, not the position: your side always holds the lighter works with sally ports in its wire, the enemy the heavier ones.

**Loading**: the game opens on a loading screen (photographs, soldier models, portraits, music) that ends with **Click to enter**: that click (browsers only allow sound after one) starts the music and opens the main menu. Entering a battle (New game, Continue, Load, Fight again) shows a loading screen over one of the four photographs (machine gun, infantry, artillery, horseman) at random, with a progress bar and a battle tip, until the ground textures, the season's trenches and scenery, guns, both armies' soldiers, shell bursts, sound effects and our army's voices are in and the battlefield ground is built. Each item has a 25-second limit, so a slow download never keeps you waiting forever.

**Tutorial: 1 July 1916** (main menu): a short story that teaches the controls. 07:20 on the first day of the Somme: two privates of your section, Tom Hale and Will Archer, talk in the trench (captions; click or Space moves on). You select them, the whistle blows and the whole company goes over the top with them; you call down your battery on the enemy trench and order the charge, and the machine guns the barrage missed cut the company down in the wire, Hale and Archer with them. Every step is spelled out and highlighted (a ring on the unit or ground to click, a glow on the button to press), and the battle waits while it waits for you. An epitaph over the poppy field rolls up like closing credits, telling what became of them and why, while the four lessons of how to win ground are dealt below as flash cards. The scene runs in the ordinary engine (`src/tutorial.js`), with recruiting, building and saving switched off.

**Victory and defeat**: a battle ends over a painting for the player's side. Victory: *Triumphant Soldiers at Dawn* for the Entente, *Triumph on the Trench Ridge* for the Central Powers. Defeat, for either side: a field of red poppies in the grey mud of the battlefield (`assets/art/victory-*.webp`, `defeat-poppies.webp`).

**New Game screen**: your army on the left and the enemy on the right, each under its alliance ribbon (blue Entente, red Central Powers) with a full-length soldier, ◀ ▶ arrows to change nation (the new nation's soldier answers in his language) and a name plate; in the centre **Swap sides**, **Random side** and the difficulty; beside the weather, the starting position; weather cards (Winter, Thaw, Mud) rendered from the game's own battlefield; Back and **To the front**. Where a 3D model of the army's soldier exists (`assets/models/<nation>.glb`, shrunk from the supplied models in `art-src/models/` by `python3 scripts/process-models.py`), he is shown in 3D on a round stand, and turns while the pointer is over him.

**Menus**: the game opens on the main menu, set over a worn photo card of the Christmas truce, soldiers of both sides exchanging a gift in the snow beside a Christmas tree while others play football in no man's land (`assets/art/menu-truce-clear.webp`, from `art-src/menu-truce-clear.webp`, greyed for legibility); the New Game and Saved battles screens use, at random, one of four photo cards: a siege mortar and its crew, a lone rider watching a triplane, infantry advancing through the wire with fixed bayonets, or a Vickers gun crew in gas masks (`assets/art/menu-*-grey.webp`), the loading screen the trench painting: **New game** (choose side, nations, starting position and season), **Load game** (the saved-battles panel), **Instructions**, **Credits** and **Exit game** (saves the battle automatically and leaves the front; the tab can then be closed). During a battle, ☰ opens the menu with **Resume battle**; ? or F1 shows the instructions over the battle. When a save exists and no battle is running, the menu offers **Continue saved battle**. Starting a new game during a battle keeps that battle in the automatic save.

**Saving**: 💾 opens the saved-battles panel: five save slots (save, overwrite, load, delete) plus an automatic save, made every minute of play and whenever you switch away from or close the page. The start screen offers **Continue saved battle** (the newest save) and **Load…** (the panel). A won or lost battle clears the automatic save; the slots stay until you delete them. Saves stay in this browser on this device.

**Seasons**: Winter (snow, frozen shell holes), Thaw (patchy snow over mud, no precipitation) and Mud (black mud, flooded craters, rain showers that start and stop at random), chosen on the start screen. Shellfire and digging churn the snow into black earth.

**Atmosphere** (purely visual): a day/night cycle (battles begin at 09:00 in plain daylight) with star-shell flares and dynamic light from gunfire and explosions; dawn and dusk in gentle twilight colours (dusky grey-mauve before sunrise and after sunset, soft peach at the horizon, warm orange as the sun clears it, then pale gold), lit from the low sun's side (east at dawn, west at dusk) with the far side in soft shade, tinted mist, and long soft shadows from the trees on the 45-degree diagonal that shorten as the sun climbs; rain showers in the Mud season; drifting ground mist; screen shake; hand-drawn shell-impact animation (the supplied 36-frame artwork, colour-graded into the battlefield palette, with continuous drift, swelling and wind between frames, a ground shadow and an impact flash); men shot down fall in one of five pre-rendered ways (toppling backward, pitching forward, twisting onto the side, dropping to the knees then falling forward, staggering back then collapsing; machine-gun hits jerk them first), with blood spraying away from the shot and a small pool under every body, red for a moment and dried brown within a few seconds; fallen soldiers left on the field (3D-rendered in six poses, on the back, face down, curled on the side, and three torn by shellfire with a leg, an arm or both legs gone, each in eight directions; a shell burst jolts the bodies a short way and throws the pieces high into the air, tumbling: torn-off legs and arms, helmets and rifles, each landing in a puff of dirt and staying on the field); and a 🎞 film-look toggle (colour / sepia / black and white).

**Voices**: units answer when you select them (rifle squads, MG teams and batteries each have their own lines, mixed with general replies) or give an order (move, charge, bombard, halt); new units report for duty, and squads call out when pinned down in the open, in their army's own language ("Over the top, lads!", "En avant ! À la baïonnette !", "Sturm! Hurra!", "Ура! В атаку!", "Allah Allah! Hücum!"), spoken by recorded voice actors (`assets/voice/`, 190 clips for all eight armies; Austria-Hungary speaks Hungarian, as its Honvéd regiments did) and shown in a speech bubble over the unit. Each squad plays the recordings at a slightly different pitch. Where no recording exists, the browser's speech synthesis stands in. All voices are male: speech synthesis doesn't report a voice's sex, so only voices known to be male (by name: Windows/Edge, macOS/iOS, Chrome's "UK English Male") are used. With no male voice for the language a male English voice speaks the English line (the bubble keeps the original); with no male voice at all the soldiers stay silent and only the bubble shows. 🗣 toggles voices; 🔊 mutes everything.

The enemy commander garrisons its line, uses defensive and harassing barrages, counter-attacks lost
trenches, repairs its wire and trenches, and launches real offensives: it picks the weakest point of
your line (fewest defenders, least wire, towards your HQ), gathers 4–8 squads, bombards the objective
and the machine guns covering it with every battery in range, times the charge to arrive as the last
shells fall and lifts the barrage, then pushes on trench line by trench line towards your HQ, leaving
a squad to hold each objective, bringing up reserves, moving its guns forward, and digging in where
it stands when the attack is spent. It raises more infantry when it can afford to.

**Difficulty** (New Game screen, remembered): **Easy**: the enemy attacks rarely (first after about 6 minutes), with up to 5 squads and one battery, no reinforcement of a failing attack, two objectives per offensive, a smaller army and 75% of the supply. **Medium**: steadier offensives (first after about 4 minutes) with up to 6 squads and two batteries. **Hard**: frequent offensives (first after about 3 minutes) with up to 8 squads and every gun, pushing on objective after objective, a bigger army and 125% of the supply. Your own army is the same at every level. `node scripts/ai-bench.mjs 20 5 hard` measures a level against a passive defender.

## Controls

| Input | Action |
|---|---|
| Left-click / drag | Select units (Shift adds to the selection) |
| Double-click a unit | Select every unit of that type on screen |
| Right-click | Move (Ctrl + right-click: rifle squads charge) |
| `C`, then click | Charge |
| `B`, then click | Bombard: uses the selected batteries, or the next ready battery (Shift keeps the mode on) |
| `T` / `U` / `X` | Dig trench / reinforce trench / lay wire. Click or drag to paint; Alt-click cancels a site |
| `H` | Halt |
| `1` `2` `3` | Recruit rifle squad / MG team / field battery |
| `Q` | Select all rifle squads |
| WASD, arrows, screen edges, middle-drag | Scroll; mouse wheel zooms (up to 3x) |
| `Space` / `P` / `Esc` / `F1` | Jump to front / pause / cancel / instructions |
| ☰ | Main menu (resume, new game, load, instructions, credits, exit) |

**Touch screens** (phones and tablets):

| Touch | Action |
|---|---|
| Tap a unit | Select it (double-tap: every unit of that type on screen) |
| Tap the ground | Move the selected units there |
| Press and hold, then drag | Box-select |
| Drag one finger | Scroll the map |
| Pinch / two fingers | Zoom and scroll |
| Charge or Bombard, then tap | Choose the target (press the button again to cancel) |
| Build button, then tap or drag | Dig / reinforce trench / lay wire |
| Tap or drag the minimap | Move the camera |

The Orders panel shows only the orders the selected units can carry out; Recruit and Engineering buttons show the unit or work they make. **Deselect** and **All infantry** buttons sit under Orders. On phones the commands become one scrollable strip and the top bar wraps.

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
src/voice.js            soldier voice lines (speech synthesis per nation) and speech bubbles
assets/voice/           soldier voice clips per army + manifest (`node scripts/process-voices.mjs` builds them from art-src/voice/: matches each file to its line by the text in its name, trims silence, evens loudness; needs ffmpeg)
src/audio.js            WebAudio: recorded artillery samples + procedural fallbacks
assets/sfx/             artillery fire (first 3.5 s) and three full-length 8 s shell-explosion recordings, five rifle-volley recordings, four machine-gun bursts, a morning trumpet call as each new battle begins, a duck or a bird calling once when the battlefield has been quiet for 20 s, the whistle of a shell coming in (one in five shells, 2 s before it lands), marching boots (the first 4 s, faded; boots in snow in Winter) answering about a third of move orders in place of the soldier's voice, four death cries (one at random for about a third of the men shot down by rifles and machine guns, none for shell victims, at most three at once), and an officer's whistle and, 1.5 s later, a battle cry (3 s each) played with every charge order (sources in art-src/sfx/)
assets/music/           background music (Ombra di guerra), looped with a fade; victory (Preußens Gloria) and defeat music, 28 s each, faded out, played once on the result screen; 🎵 toggles all music
src/main.js             game loop, saving (browser storage)
src/save.js             battle save format: serialize / deserialize the simulation state
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

The tests cover saving and loading, male-only voice selection, barrages, MG lethality, digging, recruiting and reinforcing, plus a 10-minute AI-vs-AI battle.

## Adding art

Drop transparent-background PNG/WebP files into `art-src/` and run `node scripts/process-art.mjs` (needs Playwright).
Nation portraits use `art-src/soldier-<nation>.webp` when present (`uk`, `france`, `usa`, `italy`, `russia`, `germany`, `austria`, `ottoman`); otherwise the rendered 3D portrait is shown.

After re-rendering props or soldiers (`npm run props`), rebuild the sprite sheets with `npm run atlas` (needs Playwright). The game downloads only the sheets for the current season and the two nations in play, each with retries, so one slow download never leaves the battlefield on the fallback drawings.
