# render-glb

Renders a building's 3D model (`.glb`, e.g. from Meshy AI) to a game sprite through the game's exact
isometric camera and sun, with a soft shadow on the ground, cropped and toned to the battlefield's light.

```
cd tools/render-glb && npm install
node render.cjs <model.glb> <out.webp> [--yaw 3.1416] [--scale 1.6] [--px 2] [--sat 0.75]
```

It prints the sprite's ground anchor (`ax`, `ay`), its draw scale (`k`) and its footprint (`hx`, `hy`,
half-widths in tiles along the map's x and y): the values a level's `setup` gives the building (see
battle 1 in `src/campaign.js`), whose tiles inside the footprint are then made impassable.

## Dixmude (battle 1)

| sprite | model | command options |
| --- | --- | --- |
| `town-dixmude.webp` | Dixmude church quarter | `--yaw 3.1416 --scale 5` |
| `town-dixmude-dawn.webp` | Ashes of Dawn (burnt-out house) | `--yaw 3.1416 --scale 1.6` |
| `town-dixmude-home.webp` | Ashes of Home (shelled gabled house) | `--yaw 3.1416 --scale 1.6` |
| `town-dixmude-dawn-b.webp`, `-dawn-c.webp` | Ashes of Dawn, turned | `--yaw 1.5708` / `--yaw 0`, `--scale 1.6` |
| `town-dixmude-home-b.webp`, `-home-c.webp` | Ashes of Home, turned | `--yaw -1.5708` / `--yaw 0`, `--scale 1.6` |
| `town-dixmude-cottage.webp` | Ashes Beyond the Cottage | `--yaw 1.5708 --scale 1.6` |
| `town-dixmude-station.webp` | Dixmude Station | `--yaw 1.5708 --scale 2.4` |

(The church quarter was cropped by hand when it was first made; the tool now crops automatically.)

## V Beach (battle 4)

| sprite | model | command options |
| --- | --- | --- |
| `ship-river-clyde.webp` | Harbor Steamship (the River Clyde) | `--yaw 1.5708 --scale 10.6` |

## Brusilov's Storm (battle 3)

| sprite | model | command options |
| --- | --- | --- |
| `church-galicia.webp` | Autumn Sanctuary (wooden church with onion domes) | `--yaw 1.5708 --scale 3` |

## The Black Day (battle 5)

`tank_d{0-7}_f{0-3}` (in `assets/props`, packed into the units atlas): Rustclad Landship, for each of the 8
headings d at yaw π/4 + (5 - d)·π/4, scale 1.3, px 3, saturation 0.85 (manifest scale 3), in 4 positions of the
tracks: the model is one mesh, so `renderTown` takes a `tread` option that paints moving tread links on the
track belts (surfaces facing out of the side profile, between 20% and 62% of the half-width) - band [0.2, 0.62],
hw 0.677, ax 0.95, ay 0.42, r 0.68, period 0.15, phase f/4 (links darkened to 0.18 / lit to 1.35).
