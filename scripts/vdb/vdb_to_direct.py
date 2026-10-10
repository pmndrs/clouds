#!/usr/bin/env python3
"""V2: VDB density -> a *direct* cloud asset (the VDB's density as-is, no Nubis profile / erosion / up-rez). Run with hython:

  HYTHON=/Applications/Houdini/Houdini21.0.671/Frameworks/Houdini.framework/Versions/Current/Resources/bin/hython
  $HYTHON scripts/vdb/vdb_to_direct.py IN.vdb --out assets/clouds/local/direct/NAME --up z --world-scale 4 [--like assets/clouds/local/NAME]

Native resolution: the target voxel is the source voxel (x --world-scale), never resampled. Writes the usual runtime files plus one:
  density.bin  r16float (half, little-endian), texture order: density / densityRef (raw VDB density, normalised; unclamped)
  sdf.bin      r16 unorm SDF (same encoding as vdb_to_nvdf.py) of density > --empty: only for empty-space skipping in the march
  nvdf.bin     rgba8: R = saturate(density / densityRef) (the cheap density the light grid, shadow map and dome integrate, and the
               in-scatter weight the Nubis lighting reads), G = 0, B = 1, A = the framing mask (255 = occupied; see --like)
  cloud.json   as vdb_to_nvdf.py, plus `direct: { file, format, densityRef, ... }`; the runtime renders such an asset directly.

--like DIR aligns the crop to a vdb_to_nvdf.py fog conversion of the same VDB (C1: --mode fog --up z --world-scale 4, 8 m voxels, margin 8):
the direct asset then covers exactly that asset's world box (the flagship places both at the same spot), and A is that asset's occupancy
(profile > 0, upsampled) so the flagship's photo/detail framings put the camera at the same place. Without --like the crop is the
occupied box (density > --empty) plus --margin voxels and A = density >= --iso.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np  # noqa: E402

import nvdf_math as nm  # noqa: E402


def fail(msg):
    raise SystemExit(f'vdb_to_direct: error: {msg}')


def load_grid(path, name):
    import hou
    geo = hou.Geometry()
    geo.loadFromFile(str(path))
    for prim in geo.prims():
        if isinstance(prim, hou.VDB) and (prim.stringAttribValue('name') or '') == name:
            return geo, prim
    fail(f'{path}: no VDB grid named {name!r}')


def read_range(prim, lo, hi, up_z):
    """Dense float32 of hou index range [lo, hi) in texture order [up, row, x]; Z-up sources are rotated to Y-up (row = -y)."""
    import hou
    n = [hi[i] - lo[i] for i in range(3)]
    bb = hou.BoundingBox(lo[0], lo[1], lo[2], hi[0], hi[1], hi[2])
    flat = np.asarray(prim.voxelRangeAsFloat(bb), dtype=np.float32)
    if flat.size != n[0] * n[1] * n[2]:
        fail(f'voxelRangeAsFloat returned {flat.size} values for {n}')
    a = flat.reshape(n[2], n[1], n[0])          # [hou z, hou y, hou x]
    if up_z:
        return np.ascontiguousarray(a[:, ::-1, :])   # up = hou z, row = -hou y (rotation about X, as vdb_to_nvdf.py --up z)
    return np.ascontiguousarray(a.transpose(1, 0, 2))   # up = hou y, row = hou z


def like_range(meta, alo, ahi, sv, up_z):
    """Source index range (hou x, y, z) covering the world box of a vdb_to_nvdf.py fog conversion, and the voxel ratio."""
    tv = float(meta['voxelSizeMeters'])
    r = tv / sv
    if abs(r - round(r)) > 1e-5 or round(r) < 1:
        fail(f'--like asset voxel {tv} m is not an integer multiple of the source voxel {sv} m')
    r = int(round(r))
    w, h, d = meta['dims']                               # texture (x, row, up)
    if not up_z:
        # Y-up conversions keep the global target index in cropOffset (source axes x, row = hou z, up = hou y); target voxel g covers source [g r, (g + 1) r).
        cx, cr, cu = meta['cropOffset']
        lo = [cx * r, cu * r, cr * r]
        return lo, [lo[0] + w * r, lo[1] + d * r, lo[2] + h * r], r
    margin = int(meta['margin'])
    pad = int(math.ceil(margin * tv / sv)) + 2           # vdb_to_nvdf.py convert(): lo/hi around the active box
    lo = [alo[i] - pad for i in range(3)]
    hi = [ahi[i] + pad for i in range(3)]
    a = [math.floor(lo[i] * sv / tv) for i in range(3)]  # resample_to_target: first target index per hou axis
    b = [math.ceil(hi[i] * sv / tv) for i in range(3)]
    cx, cr, cu = meta['cropOffset']                      # crop min, texture order (t0 is reset to 0 for --up z)
    x0 = (a[0] + cx) * r
    z0 = (a[2] + cu) * r
    y1 = (b[1] - cr) * r                                 # row is flipped: the crop's first row is the highest hou y
    return [x0, y1 - h * r, z0], [x0 + w * r, y1, z0 + d * r], r


def convert(args):
    t0 = time.perf_counter()
    _, prim = load_grid(args.input, args.density_grid)
    vs = [float(x) for x in prim.voxelSize()]
    if max(vs) - min(vs) > 1e-6 * vs[0]:
        fail(f'anisotropic voxels {vs}')
    sv = vs[0] * args.world_scale
    bb = prim.activeVoxelBoundingBox()
    alo = [int(round(c)) for c in bb.minvec()]
    ahi = [int(round(c)) for c in bb.maxvec()]
    like = None
    if args.like:
        like = json.loads((Path(args.like) / 'cloud.json').read_text())
        if like.get('converter', {}).get('rotateY') or 'rotate' in like.get('source', ''):
            fail('--like does not follow --rotate-y conversions')
        lo, hi, ratio = like_range(like, alo, ahi, sv, args.up == 'z')
    else:
        pad = args.margin
        lo = [alo[i] - pad for i in range(3)]
        hi = [ahi[i] + pad for i in range(3)]
    dens = read_range(prim, lo, hi, args.up == 'z')
    dens = np.maximum(dens * args.scale, 0.0).astype(np.float32)
    if not like:
        b = nm.occupied_bounds((dens > args.empty).astype(np.uint8), args.margin)
        dens = nm.crop(dens, b['cropMin'], b['cropDims'])
    t_read = time.perf_counter() - t0
    dims = [dens.shape[2], dens.shape[1], dens.shape[0]]   # texture (x, row, up)

    pos = dens[dens > args.empty]
    if pos.size == 0:
        fail('no voxel above --empty')
    ref = float(args.density_ref) if args.density_ref else float(np.percentile(pos, 99))
    occ = dens > args.empty
    sdf = nm.signed_distance(occ, sv)
    t_sdf = time.perf_counter() - t0 - t_read

    norm = dens / ref
    r8 = nm.quantize_unorm8(np.clip(norm, 0.0, 1.0))
    if like:
        # The fog asset's occupancy (profile > 0), each 8 m voxel upsampled to its ratio^3 native block: the flagship frames from it.
        lw, lh, ld = like['dims']
        raw = np.fromfile(Path(args.like) / like['nvdf']['file'], dtype=np.uint8).reshape(ld, lh, lw, 4)[..., 0] > 0
        a8 = np.repeat(np.repeat(np.repeat(raw, ratio, 0), ratio, 1), ratio, 2)
    else:
        a8 = dens >= args.iso
    a8 = np.where(a8, 255, 0).astype(np.uint8)
    rgba = np.stack([r8, np.zeros_like(r8), np.full_like(r8, 255), a8], axis=-1)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'nvdf.bin').write_bytes(np.ascontiguousarray(rgba).tobytes())
    sdf16 = nm.encode_sdf_r16(sdf)
    (out / 'sdf.bin').write_bytes(sdf16.astype('<u2').tobytes())
    half = norm.astype('<f2')
    (out / 'density.bin').write_bytes(half.tobytes())
    if like:
        # Check: block mean of the native density on the fog lattice >= 0.05 should be (close to) the fog asset's occupancy.
        lw, lh, ld = like['dims']
        bm = dens.reshape(ld, ratio, lh, ratio, lw, ratio).mean(axis=(1, 3, 5)) >= 0.05
        inter = float((bm & raw).sum()); union = float((bm | raw).sum())
        align_iou = round(inter / max(union, 1.0), 4)
    else:
        align_iou = None

    name = args.name or out.name
    size = [d * sv for d in dims]
    meta = {
        'name': name,
        'source': f'{Path(args.input).name} (direct density, via scripts/vdb/vdb_to_direct.py)',
        'dims': dims,
        'voxelSizeMeters': sv,
        'layout': 'x fastest, then y (map row), then z (up); texel (x,y,z) at ((z*dims[1]+y)*dims[0]+x)',
        'boundsMeters': {'size': size},
        'like': str(args.like) if args.like else None,
        'sourceIndexRange': {'lo': lo, 'hi': hi, 'axes': 'hou x, y, z (EmberGen x, y, z)'},
        'nvdf': {'file': 'nvdf.bin', 'format': 'rgba8unorm', 'bytes': int(rgba.nbytes),
                 'channels': {'r': 'saturate(density / densityRef): cheap density (light grid, shadow map, dome) and in-scatter weight',
                              'g': '0', 'b': '1 (density scale)', 'a': 'framing mask (255 occupied)'}},
        'sdf': {'file': 'sdf.bin', 'format': 'r16unorm little-endian', 'bytes': int(sdf16.nbytes),
                'encoding': {'minMeters': nm.SDF_MIN, 'maxMeters': nm.SDF_MAX, 'decode': 'meters = minMeters + v * (maxMeters - minMeters)', 'rounding': 'down'},
                'source': f'exact 3D EDT of density > {args.empty} at the native voxel (empty-space skipping only)'},
        'direct': {'file': 'density.bin', 'format': 'r16float little-endian', 'bytes': int(half.nbytes), 'densityRef': ref,
                   'encoding': 'value = VDB density * scale / densityRef (unclamped); extinction = value * densityRef * CloudSettings.directDensity',
                   'scale': args.scale, 'empty': args.empty,
                   'stats': {'max': float(pos.max()), 'p50': float(np.percentile(pos, 50)), 'p99': float(np.percentile(pos, 99)), 'occupied': int(pos.size)}},
        'converter': {'script': 'scripts/vdb/vdb_to_direct.py', 'up': args.up, 'worldScale': args.world_scale, 'grid': args.density_grid, 'alignIoU': align_iou},
    }
    (out / 'cloud.json').write_text(json.dumps(meta, indent=2) + '\n')
    report = {'out': str(out), 'dims': dims, 'voxelSizeMeters': sv, 'densityRef': ref, 'alignIoU': align_iou,
              'bytes': int(rgba.nbytes + sdf16.nbytes + half.nbytes), 'seconds': {'read': round(t_read, 2), 'sdf': round(t_sdf, 2), 'total': round(time.perf_counter() - t0, 2)}}
    print(json.dumps(report, indent=2))
    return report


def parser():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('input', help='input .vdb with a fog density grid')
    p.add_argument('--out', required=True, help='output directory (cloud.json, density.bin, nvdf.bin, sdf.bin)')
    p.add_argument('--name')
    p.add_argument('--density-grid', default='density')
    p.add_argument('--world-scale', type=float, default=1.0, help='metres per VDB unit (CloudPack: 4)')
    p.add_argument('--up', choices=['y', 'z'], default='y', help='source up axis (EmberGen: z)')
    p.add_argument('--like', help='a vdb_to_nvdf.py fog asset of the same VDB: crop to its world box and frame from its occupancy')
    p.add_argument('--margin', type=int, default=16, help='without --like: crop margin in native voxels (default 16)')
    p.add_argument('--scale', type=float, default=1.0, help='multiply the VDB density (default 1)')
    p.add_argument('--density-ref', type=float, help='density that maps to 1 in nvdf R (default: 99th percentile of density > --empty)')
    p.add_argument('--empty', type=float, default=1e-4, help='density at or below this is empty space for the SDF (default 1e-4)')
    p.add_argument('--iso', type=float, default=0.05, help='without --like: framing mask threshold (default 0.05)')
    return p


def main():
    args = parser().parse_args()
    try:
        import hou  # noqa: F401
    except ImportError:
        fail('import hou failed: run this script with Houdini hython')
    convert(args)


if __name__ == '__main__':
    main()
