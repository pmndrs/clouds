#!/usr/bin/env hython
"""D1 round 4: the Nubis pack's noise as a 16-bit texture, from the pack's float VDB (NubisVoxelCloudNoise.vdb; grids lf_curly_worley,
hf_curly_worley, lf_alligator, hf_alligator = R, G, B, A, as the 8-bit noise.bin from the TGAs).

Why: the wispy channels are near zero over most of the volume (0.005-0.06). At 8 bits a 1/255 step there becomes a 20 percent density step
after the sampler's sharpening pow wherever the profile minus the noise is small, i.e. isolines of the quantised noise print into the fringe as
contour / wood-grain bands once the view extinction is high enough to show the lumps (D1 report section 8). The VDB has 1.7-1.9 million
distinct values per grid.

Writes assets/clouds/noise/noise16.bin (rgba16float, mip chain of 2x2x2 means, mips concatenated) and adds `mips16` / `file16` to noise.json.
The axis order is found by matching mip 0 against the committed 8-bit noise.bin (correlation 1.0), so the layout is the same as noise.bin.

  $HYTHON scripts/vdb/noise_vdb_to_16.py "<pack>/Noise/Examples/VDB/NubisVoxelCloudNoise.vdb" assets/clouds/noise
"""
import json, sys, itertools
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parent))
import vdb_to_nvdf as v

src, out = sys.argv[1], Path(sys.argv[2])
meta = json.loads((out / 'noise.json').read_text())
n = meta['dims'][0]
ref = np.fromfile(out / 'noise.bin', dtype=np.uint8, count=n * n * n * 4).reshape(n, n, n, 4).astype(np.float32) / 255.0   # [z, y, x, c]
grids = v.load_vdbs(src)
names = ['lf_curly_worley', 'hf_curly_worley', 'lf_alligator', 'hf_alligator']
raw = []
for name in names:
    prim = grids[name]
    bb = prim.activeVoxelBoundingBox(); lo = [int(round(c)) for c in bb.minvec()]; hi = [int(round(c)) for c in bb.maxvec()]
    assert [hi[i] - lo[i] for i in range(3)] == [n, n, n], (name, lo, hi)
    import hou
    flat = np.asarray(prim.voxelRangeAsFloat(hou.BoundingBox(*lo, *hi)), dtype=np.float32)
    raw.append(flat.reshape(n, n, n))   # hou order: [z, y, x] (x fastest)
raw = np.stack(raw, -1)
best = None
for perm in itertools.permutations(range(3)):
    for flips in itertools.product([False, True], repeat=3):
        a = raw.transpose(*perm, 3)
        for ax, f in enumerate(flips):
            if f: a = np.flip(a, ax)
        c = float(np.corrcoef(a[..., 0].ravel(), ref[..., 0].ravel())[0, 1])
        if best is None or c > best[0]: best = (c, perm, flips, a)
corr, perm, flips, vol = best
print(f'axis match: perm {perm} flips {flips} corr {corr:.6f}; max |8-bit - float| {np.abs(ref - vol).max():.4f}')
assert corr > 0.999, 'could not match the VDB axes to noise.bin'
vol = np.ascontiguousarray(vol, dtype=np.float32)
mips, level = [], vol
while True:
    mips.append(level)
    if level.shape[0] == 1: break
    s = level.shape[0] // 2
    level = level.reshape(s, 2, s, 2, s, 2, 4).mean(axis=(1, 3, 5))
chunks, offs, off = [], [], 0
for m in mips:
    b = m.astype('<f2').tobytes(); chunks.append(b)
    offs.append({'dims': list(m.shape[:3][::-1]) if False else [m.shape[2], m.shape[1], m.shape[0]], 'byteOffset': off, 'bytes': len(b)}); off += len(b)
(out / 'noise16.bin').write_bytes(b''.join(chunks))
meta['file16'] = 'noise16.bin'; meta['format16'] = 'rgba16float'; meta['mips16'] = offs; meta['bytes16'] = off
meta['source16'] = 'NubisVoxelCloudNoise.vdb (pack), scripts/vdb/noise_vdb_to_16.py; same layout as noise.bin, mips are 2x2x2 means'
(out / 'noise.json').write_text(json.dumps(meta, indent=2) + '\n')
print('wrote', out / 'noise16.bin', off, 'bytes,', len(mips), 'mips')
