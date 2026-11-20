#!/usr/bin/env python3
"""Pre-renders the foam that spreads on the water where a shell falls into the sea: a ring of broken
white water running outward and thinning, round a patch of churned foam that slowly dies away. 16 frames,
seen through the game's camera (a 2:1 ellipse), noise-textured; packed into assets/fx/ripple.webp
(4 x 4 sheet) + ripple.json. Needs numpy and Pillow.   python3 scripts/make-ripples.py"""
import json, os
import numpy as np
from PIL import Image

W, H, N, COLS = 320, 160, 16, 4
rng = np.random.default_rng(1915)

def noise(scale, octaves=4, seed=0):
    """Tileless value noise in [0,1] over the frame (fractal sum of smoothly interpolated grids)."""
    r = np.random.default_rng(seed)
    out = np.zeros((H, W)); amp = 1.0; tot = 0
    for o in range(octaves):
        gw, gh = int(scale * 2 ** o) + 2, int(scale * 2 ** o / 2) + 2
        g = r.random((gh, gw))
        img = Image.fromarray((g * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)
        out += amp * np.asarray(img) / 255.0; tot += amp; amp *= 0.5
    return out / tot

yy, xx = np.mgrid[0:H, 0:W]
dx = (xx - W / 2) / (W / 2); dy = (yy - H / 2) / (H / 2)
r = np.hypot(dx, dy) # 1 at the frame's edge (the ellipse's semi-axes are W/2, H/2)
ang = np.arctan2(dy, dx)
n1, n2, n3 = noise(5, 5, 1), noise(12, 4, 2), noise(28, 3, 3)
sheet = Image.new('RGBA', (W * COLS, H * (N // COLS)))
for i in range(N):
    t = i / (N - 1) # 0 .. 1 over the life of the foam
    # the ring: running out, widening and breaking up as it goes
    R = 0.18 + 0.72 * (1 - (1 - t) ** 1.6)
    w = 0.05 + 0.12 * t
    ring = np.exp(-((r - R) / w) ** 2)
    broken = np.clip((n2 + 0.35 * np.sin(ang * 7 + t * 3) * 0.3 - 0.35 - 0.4 * t) * 2.2, 0, 1)
    ring = ring * (0.35 + 0.65 * broken) * (1 - t) ** 1.2
    # a second, fainter ring behind it
    R2 = 0.08 + 0.5 * (1 - (1 - max(0, t - 0.15)) ** 1.6)
    ring2 = np.exp(-((r - R2) / (0.04 + 0.08 * t)) ** 2) * np.clip((n3 - 0.4) * 2.5, 0, 1) * max(0, 1 - t * 1.3) * 0.6
    # the churned foam where it fell: bright at first, streaky, fading to a pale stain
    patch = np.clip(1 - r / (0.3 + 0.25 * t), 0, 1) ** 1.5 * np.clip((n1 * 0.7 + n3 * 0.5 - 0.25 - 0.3 * t) * 1.8, 0, 1) * (1 - t) ** 0.8
    a = np.clip(np.maximum(np.maximum(ring, ring2), patch) * 1.25, 0, 1)
    # colour: white foam, its thinner parts taking the sea's blue-green
    c = 0.62 + 0.38 * np.clip(a * 1.4, 0, 1)
    rgb = np.stack([c * 0.93, c * 0.98, c], -1)
    img = np.dstack([rgb * 255, a * 230]).clip(0, 255).astype(np.uint8)
    sheet.paste(Image.fromarray(img, 'RGBA'), ((i % COLS) * W, (i // COLS) * H))
out = os.path.join(os.path.dirname(__file__), '..', 'assets', 'fx')
sheet.save(os.path.join(out, 'ripple.webp'), quality=88)
json.dump({'columns': COLS, 'frameW': W, 'frameH': H, 'frameCount': N, 'duration': 3.4}, open(os.path.join(out, 'ripple.json'), 'w'))
print('wrote assets/fx/ripple.webp')
