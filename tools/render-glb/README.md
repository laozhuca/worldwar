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
| `ship-river-clyde.webp` | Harbor Steamship (the River Clyde) | `--yaw 1.5708 --scale 10.6 --cut '[[[-1,-1,-1],[-0.79,-0.185,1]]]'` (without the slab of ground stuck under her bow) |

## Brusilov's Storm (battle 3)

| sprite | model | command options |
| --- | --- | --- |
| `church-galicia.webp` | Autumn Sanctuary (wooden church with onion domes) | `--yaw 1.5708 --scale 3` |

## The Black Day (battle 5)

`tank_d{0-7}_f{0-3}` (in `assets/props`, packed into the units atlas): Rustclad Landship, for each of the 8
headings d at yaw π/4 + (5 - d)·π/4, scale 1.3, px 3, saturation 0.85 (manifest scale 3), in 4 positions of the
tracks: the model is one mesh, so `renderTown` takes a `tread` option that paints moving tread links on the
track belts (surfaces facing out of the side profile, between 20% and 62% of the half-width) - band [0.2, 0.62],
hw 0.677, ax 0.95, ay 0.42, r 0.68, period 0.15, phase f/4 (links darkened to 0.18 / lit to 1.35); only the
belts themselves: band [0.22, 0.56], below ymax 0.35 (not the roof rails), and between x ±0.62 only the top run
(y 0.17-0.27) and bottom run (y < -0.3) facing up or down (not the sponsons or roof boxes):
`TREAD='{"band":[0.22,0.56],"ymax":0.35,"xin":0.62,"ytop":0.17,"ytopmax":0.27,"ybot":-0.3}'`. The game steps
through f backwards as it rolls forward.

## Skirmish battlefields

`bld-<name>-<side>.webp` and `bld-<name>-<side>-ruin.webp` (in `assets/art`): each building seen from its four
sides (side 0-3: `--yaw 0`, `1.5708`, `3.1416`, `-1.5708`), intact and shelled to a ruin (`--ruin <seed>`: the
walls clipped in the shader along a ragged line of noise - low at a blown-in corner - so the breaks keep the
model's own brick and plaster, both faces drawn and the shadow clipped to match; soot in patches, worst along
the breaks; a mound of rubble over the floor and spilling from the breach, and loose lumps, painted with a
generated texture of broken stone, brick and char). Names and scales: `dawn`, `home`, `cottage` (Ashes of Dawn /
of Home / Beyond the Cottage, `--scale 1.6`), `station` (Dixmude Station, `--scale 2.4`), `church` (Autumn
Sanctuary, `--scale 3`). The anchors and footprints printed go into `BUILDINGS` in `src/battlefields.js`.

`bld-<name>-<side>-half.webp`: the stage between, half-destroyed (`--ruin <seed> --half`, the same seed as the
side's ruin): the walls broken off high, the roof mostly gone, one corner torn down part way, lighter soot and
less rubble. A building falls to it at half strength in battle, and to its ruin at none.

`bld-<name>-<side>[-half|-ruin]-snow.webp`: the houses (`dawn`, `home`, `cottage`) under snow, for the winter
battlefields (`--snow`, with the same `--ruin` seeds): snow lying on whatever faces up - roof slopes, wall tops,
sills, the rubble - in drifts, after the soot. The same anchors as the snowless images.
