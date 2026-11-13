#!/usr/bin/env python3
"""Shrink soldier models for the game: art-src/models/<name>.glb -> assets/models/<nation>.glb.

Keeps the mesh (positions, normals, uvs, indices), the base colour and normal textures resized to
1024 px JPEG, and drops the metallic/roughness texture (the viewer uses constant values).
The model is recentred: feet at y = 0, turning axis through the centre of the feet.  Usage: python3 scripts/process-models.py
(needs Pillow).  The nation each source model is for is listed in MODELS below.
"""
import io, json, struct, os
from PIL import Image

SRC, OUT = 'art-src/models', 'assets/models'
MODELS = {  # source file -> nation
    'British_Tommy_WWI_Sol': 'uk', 'Doughboy_on_Watch': 'usa', 'The_Poilu_s_Vigil': 'france',
    'Alpine_Sentry': 'italy', 'Ottoman_Sentinel': 'ottoman', 'Imperial_Sentry': 'germany',
    'The_Watchful_Infantry': 'russia', 'Frontline_Sentinel': 'austria',
}
TEX = 1024

def read(path):
    d = open(path, 'rb').read()
    jl = struct.unpack('<I', d[12:16])[0]
    j = json.loads(d[20:20 + jl])
    b0 = 20 + jl + 8
    def view(i):
        bv = j['bufferViews'][i]; o = b0 + bv.get('byteOffset', 0)
        return d[o:o + bv['byteLength']]
    return j, view

def acc_bytes(j, view, i):
    a = j['accessors'][i]; raw = view(a['bufferView'])
    size = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']] * {5126: 4, 5125: 4, 5123: 2}[a['componentType']]
    o = a.get('byteOffset', 0)
    stride = j['bufferViews'][a['bufferView']].get('byteStride', size)
    if stride == size: return raw[o:o + size * a['count']], a
    return b''.join(raw[o + k * stride:o + k * stride + size] for k in range(a['count'])), a

def convert(src, dst):
    j, view = read(src)
    prim = j['meshes'][0]['primitives'][0]
    mat = j['materials'][prim.get('material', 0)]
    pos, pa = acc_bytes(j, view, prim['attributes']['POSITION'])
    nrm, _ = acc_bytes(j, view, prim['attributes']['NORMAL'])
    uv, _ = acc_bytes(j, view, prim['attributes']['TEXCOORD_0'])
    idx, ia = acc_bytes(j, view, prim['indices'])
    # recentre: feet on y = 0, centred on x and z
    p = list(struct.unpack('<%df' % (pa['count'] * 3), pos))
    xs, ys, zs = p[0::3], p[1::3], p[2::3]
    # turn about the man, not his kit: centre on his feet (the lowest tenth of the model), so a rifle or
    # a pack sticking out to one side doesn't throw the turning axis off him
    y0, H = min(ys), max(ys) - min(ys)
    feet = [(x, z) for x, y, z in zip(xs, ys, zs) if y < y0 + 0.1 * H]
    cx = (min(f[0] for f in feet) + max(f[0] for f in feet)) / 2
    cz = (min(f[1] for f in feet) + max(f[1] for f in feet)) / 2
    for k in range(pa['count']): p[3 * k] -= cx; p[3 * k + 1] -= y0; p[3 * k + 2] -= cz
    pos = struct.pack('<%df' % len(p), *p)
    lo = [min(p[0::3]), min(p[1::3]), min(p[2::3])]; hi = [max(p[0::3]), max(p[1::3]), max(p[2::3])]
    def tex(info, q):
        img = j['images'][j['textures'][info['index']]['source']]
        im = Image.open(io.BytesIO(view(img['bufferView']))).convert('RGB').resize((TEX, TEX), Image.LANCZOS)
        b = io.BytesIO(); im.save(b, 'JPEG', quality=q, optimize=True); return b.getvalue()
    color = tex(mat['pbrMetallicRoughness']['baseColorTexture'], 86)
    normal = tex(mat['normalTexture'], 90)
    chunks, views = [], []
    def add(b):
        off = sum(len(c) for c in chunks); pad = (-len(b)) % 4
        chunks.append(b + b'\0' * pad); views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(b)}); return len(views) - 1
    vp, vn, vu, vi, vc, vnm = add(pos), add(nrm), add(uv), add(idx), add(color), add(normal)
    n = pa['count']
    g = {
        'asset': {'version': '2.0', 'generator': 'worldwar process-models'},
        'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0}],
        'meshes': [{'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1, 'TEXCOORD_0': 2}, 'indices': 3, 'material': 0}]}],
        'materials': [{'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0, 'roughnessFactor': 0.85}, 'normalTexture': {'index': 1}, 'doubleSided': True}],
        'textures': [{'source': 0}, {'source': 1}],
        'images': [{'bufferView': vc, 'mimeType': 'image/jpeg'}, {'bufferView': vnm, 'mimeType': 'image/jpeg'}],
        'accessors': [
            {'bufferView': vp, 'componentType': 5126, 'count': n, 'type': 'VEC3', 'min': lo, 'max': hi},
            {'bufferView': vn, 'componentType': 5126, 'count': n, 'type': 'VEC3'},
            {'bufferView': vu, 'componentType': 5126, 'count': n, 'type': 'VEC2'},
            {'bufferView': vi, 'componentType': ia['componentType'], 'count': ia['count'], 'type': 'SCALAR'},
        ],
        'bufferViews': views,
        'buffers': [{'byteLength': sum(len(c) for c in chunks)}],
    }
    js = json.dumps(g, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4)
    binb = b''.join(chunks)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binb)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(binb), 0x004E4942) + binb
    open(dst, 'wb').write(out)
    return len(out), hi[1] - lo[1]

os.makedirs(OUT, exist_ok=True)
manifest = {}
for f in sorted(os.listdir(SRC)):
    name = f[:-4]
    if name not in MODELS: print('skipped (no nation):', f); continue
    nation = MODELS[name]
    size, h = convert(os.path.join(SRC, f), os.path.join(OUT, nation + '.glb'))
    manifest[nation] = nation + '.glb'
    print(f'{nation:8} {size / 1e6:.2f} MB  height {h:.2f}  <- {f}')
json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)
