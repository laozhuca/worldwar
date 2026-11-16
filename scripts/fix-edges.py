#!/usr/bin/env python3
"""Repair sprites rendered before the renderer's grazing-ray fix: a faint dark line traced the outline of
each sprite's ground footprint (rays entering the render volume just below ground level). Clears the
faint, dark ground-shading pixels within a few pixels of that outline, leaving figures and real shadows.
  node scripts/render-props.mjs --footprints fp.json && python3 scripts/fix-edges.py fp.json
(needs Pillow and numpy)"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw

def hull(pts):
    pts = sorted(set(map(tuple, pts)))
    if len(pts) < 3: return pts
    cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]

fp = json.load(open(sys.argv[1]))
mans = {}
fixed = 0
for key, pts in fp.items():
    d, name = os.path.split(key)
    mp = os.path.join('assets', d, 'manifest.json')
    if mp not in mans: mans[mp] = json.load(open(mp)) if os.path.exists(mp) else {}
    m = mans[mp].get(name)
    path = os.path.join('assets', d, name + '.png')
    if not m or not os.path.exists(path): continue
    im = Image.open(path).convert('RGBA')
    a = np.array(im)
    band = Image.new('L', im.size, 0)
    poly = [(m['ax'] + x, m['ay'] + y) for x, y in hull(pts)]
    ImageDraw.Draw(band).line(poly + [poly[0]], fill=255, width=7)
    b = np.array(band) > 0
    rgb, al = a[:, :, :3].astype(int), a[:, :, 3]
    faint = b & (al > 0) & (al <= 200) & (rgb.max(axis=2) <= 45)
    if faint.any():
        a[faint, 3] = 0
        Image.fromarray(a).save(path, optimize=True)
        fixed += 1
print('repaired', fixed, 'of', len(fp))
