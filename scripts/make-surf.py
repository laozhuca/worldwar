#!/usr/bin/env python3
"""Pre-renders the surf at the water's edge: a strip three tiles long running from the sea up the sand (map
x: 0 = sea end, 1 = land end; map y across one tile). A wave rolls in, breaks into a ragged line of white
foam, runs up the sand as a thin sheet of water and slides back, leaving the sand dark and wet; then the
next. 24 frames looping (one wave), noise-textured; drawn in the game through the map's own projection, one
strip per row of shore, each row a little out of step with its neighbours. Writes assets/fx/surf.webp
(6 x 4 sheet) + surf.json. Needs numpy and Pillow.   python3 scripts/make-surf.py"""
import json, os
import numpy as np
from PIL import Image

W, H, N, COLS = 192, 64, 24, 6 # pixels along the strip (3 tiles) and across it (1 tile)

def noise(sx, sy, octaves, seed):
    r = np.random.default_rng(seed); out = np.zeros((H, W)); amp = 1; tot = 0
    for o in range(octaves):
        gw, gh = int(sx * 2 ** o) + 2, int(sy * 2 ** o) + 2
        # wrap across the strip (y) so neighbouring rows join without a seam
        g = r.random((gh, gw)); g[-1, :] = g[0, :]
        img = Image.fromarray((g * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)
        out += amp * np.asarray(img) / 255.0; tot += amp; amp *= 0.5
    return out / tot

u = np.linspace(0, 1, W)[None, :].repeat(H, 0) # 0 sea .. 1 land
n1, n2, n3 = noise(6, 2, 4, 1), noise(14, 4, 3, 2), noise(30, 8, 2, 3)
sheet = Image.new('RGBA', (W * COLS, H * (N // COLS)))
for i in range(N):
    t = i / N
    # the edge of the water: comes in fast and slides back slowly (a little asymmetric, like a real swash)
    run = np.sin(np.pi * min(1, t / 0.45)) if t < 0.45 else np.sin(np.pi * 0.5 * (1 + (t - 0.45) / 0.55)) ** 0.8
    edge = 0.36 + 0.36 * run + (n1 - 0.5) * 0.08 # how far up the sand the water reaches (wobbling)
    sheet_water = np.clip((edge - u) / 0.04, 0, 1) # 1 where the water covers the sand
    foam_line = np.exp(-((u - edge) / (0.025 + 0.02 * run)) ** 2) * np.clip((n2 - 0.25) * 2.2, 0, 1) # the ragged leading edge
    breaking = np.exp(-((u - (edge - 0.16)) / 0.05) ** 2) * (0.35 + 0.65 * run) * np.clip((n3 - 0.3) * 2.4, 0, 1) # the broken wave behind it
    lace = sheet_water * np.clip((n3 * 0.6 + n2 * 0.6 - 0.62) * 3, 0, 1) * 0.6 # lacy foam on the backwash
    wet = np.clip((0.36 + 0.36 * max(run, 0.55) - u) / 0.12, 0, 1) * (1 - sheet_water) * 0.35 # dark wet sand it has left
    a_foam = np.clip(np.maximum.reduce([foam_line, breaking, lace]), 0, 1)
    a_water = sheet_water * 0.28 * np.clip((u - 0.3) / 0.08, 0, 1) # a thin sheet of sea over the sand (not over the sea itself)
    # composite: sea-green sheet, white foam over it, dark wet sand under
    rgb = np.zeros((H, W, 3)); a = np.zeros((H, W))
    def over(col, al):
        global rgb, a
        al = al[..., None]; rgb = rgb * (1 - al) + np.array(col) * al; a[:] = a + al[..., 0] * (1 - a)
    over([0.18, 0.15, 0.11], wet)
    over([0.45, 0.6, 0.62], a_water)
    over([0.95, 0.97, 0.97], a_foam * 0.95)
    # (un-premultiply for storage)
    col = np.where(a[..., None] > 1e-4, rgb / np.maximum(a[..., None], 1e-4), 0)
    img = np.dstack([np.clip(col, 0, 1) * 255, np.clip(a, 0, 1) * 255]).astype(np.uint8)
    sheet.paste(Image.fromarray(img, 'RGBA'), ((i % COLS) * W, (i // COLS) * H))
out = os.path.join(os.path.dirname(__file__), '..', 'assets', 'fx')
sheet.save(os.path.join(out, 'surf.webp'), quality=88)
json.dump({'columns': COLS, 'frameW': W, 'frameH': H, 'frameCount': N, 'tiles': 3, 'period': 5.2}, open(os.path.join(out, 'surf.json'), 'w'))
print('wrote assets/fx/surf.webp')
