#!/usr/bin/env python3
"""R1 variants of the fog-mode NVDF derivation, numpy only (no hython).

Input: the .npz written by `vdb_to_nvdf_r1.py --dump-npy` (cropped 8 m density + iso mask, texture order) and the
reference asset folder written by the same run (its cloud.json is copied, dims and placement unchanged).

  python3 scripts/vdb/experiments/r1_nvdf.py IN.npz REF_DIR OUT_DIR [options]

Pipeline (defaults reproduce the shipped converter's pack mapping bit for bit):
  1. envelope (phase 3, the Nubis way: a low-frequency envelope before the SDF / profile):
       --close R      morphological closing of the mask with a ball of R metres (fills gaps and concavities narrower than 2R,
                      keeps convex silhouette bumps)
       --env-blur S   gaussian sigma (m) on the density, re-thresholded so the occupied volume matches the input mask
       --sdf-blur S   gaussian sigma (m) on the SDF that drives the profile depth (the converter uses 1 voxel)
  2. profile (phase 2): pack fit sat((d_eff - d0)/D)^g with --ramp D (default 66 m), --gamma g (1.05), --profile-noise (1)
  3. density scale (phase 2): --scale pack (height trend x (0.5 + 0.5 density/p99), default) | const:<S> | gain:<k> (pack x k)
     | dens:<lo>,<hi> (lerp lo..hi by density/p99, no height trend)
  4. --fill <v>  labelled comparison only (not Nubis): profile floor v inside the closed envelope where the input mask is empty.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nvdf_math as nm  # noqa: E402  (the R1 copy)


def closing(mask: np.ndarray, voxel: float, r: float) -> np.ndarray:
    d_out = np.sqrt(nm.squared_distance_to_mask(mask, voxel, True))
    dil = d_out <= r
    d_in = np.sqrt(nm.squared_distance_to_mask(dil, voxel, False))
    return dil & (d_in > r)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('npz'); ap.add_argument('ref'); ap.add_argument('out')
    ap.add_argument('--close', type=float, default=0.0)
    ap.add_argument('--env-blur', type=float, default=0.0)
    ap.add_argument('--sdf-blur', type=float, default=None, help='metres (default 1 voxel, as the converter)')
    ap.add_argument('--ramp', type=float, default=nm.PACK_FIT['profile']['D'])
    ap.add_argument('--gamma', type=float, default=nm.PACK_FIT['profile']['g'])
    ap.add_argument('--profile-noise', type=float, default=1.0)
    ap.add_argument('--scale', default='pack')
    ap.add_argument('--fill', type=float, default=0.0)
    ap.add_argument('--seed', type=int, default=1)
    a = ap.parse_args()

    z = np.load(a.npz)
    density, mask0, tv = z['density'].astype(np.float32), z['mask'].astype(bool), float(z['voxel'])
    mask = mask0.copy()
    if a.env_blur > 0:
        b = nm.gaussian_blur(density, a.env_blur / tv)
        thr = np.quantile(b, 1.0 - mask0.mean())   # same occupied volume as the input mask
        mask = b >= thr
    if a.close > 0:
        mask = closing(mask, tv, a.close)
    # keep the crop: anything outside the reference lattice margin is cut (the runtime centres the cloud by dims)
    sdf = nm.signed_distance(mask, tv)
    sigma_vox = (a.sdf_blur / tv) if a.sdf_blur is not None else 1.0
    driver = nm.gaussian_blur(sdf, sigma_vox)
    depth = np.where(mask, np.maximum(-driver, 0.0), 0.0)
    hfrac = nm.height_fraction(mask)
    prm = json.loads(json.dumps(nm.PACK_FIT))
    prm['profile']['D'] = a.ramp
    prm['profile']['g'] = a.gamma
    noise = nm.smooth_noise(mask.shape, nm.corr_voxels(tv), a.seed)
    prof = np.where(mask, nm.pack_profile(depth, hfrac, noise * a.profile_noise, prm), 0.0)
    if a.fill > 0:
        prof = np.where(mask & ~mask0, np.maximum(prof, a.fill), prof)
    prof = np.clip(prof, 0.0, 1.0)
    r8 = nm.quantize_unorm8(prof)
    r8 = np.where(mask, np.maximum(r8, 1), 0).astype(np.uint8)
    detail = nm.pack_detail(depth, hfrac)
    dn, ref = nm.scale_from_density(density, None)
    if a.env_blur > 0 or a.close > 0:
        # density / p99 inside the new envelope: blurred so the filled gaps take the neighbourhood's value
        dn = np.clip(nm.gaussian_blur(dn, 2.0), 0.0, 1.0)
    kind, _, arg = a.scale.partition(':')
    if kind == 'pack':
        scale = np.clip(nm.pack_scale(hfrac) * (0.5 + 0.5 * dn), 0.0, 1.0)
    elif kind == 'gain':
        scale = np.clip(nm.pack_scale(hfrac) * (0.5 + 0.5 * dn) * float(arg), 0.0, 1.0)
    elif kind == 'const':
        scale = np.full(mask.shape, float(arg), np.float32)
    elif kind == 'dens':
        lo, hi = (float(v) for v in arg.split(','))
        scale = lo + (hi - lo) * dn
    elif kind == 'hconst':
        # pack height trend shape, but rescaled so the top is arg
        q = nm.PACK_FIT['scale']
        scale = float(arg) * (q['s0'] + (q['s1'] - q['s0']) * nm.smoothstep(0.0, q['h1'], hfrac)) / q['s1']
    else:
        raise SystemExit(f'unknown --scale {a.scale}')
    g8 = nm.quantize_unorm8(np.where(mask, detail, 0.0))
    b8 = nm.quantize_unorm8(np.where(mask, scale, 0.0))
    nvdf = nm.pack_rgba8(r8, g8, b8)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'nvdf.bin').write_bytes(nvdf.tobytes())
    (out / 'sdf.bin').write_bytes(nm.encode_sdf_r16(sdf).astype('<u2').tobytes())
    meta = json.loads((Path(a.ref) / 'cloud.json').read_text())
    meta['name'] = out.name
    meta['nvdf']['bytes'] = int(nvdf.nbytes)
    meta['converter']['r1'] = {k: v for k, v in vars(a).items() if k not in ('npz', 'ref', 'out')}
    meta['converter']['r1']['occupiedFraction'] = float(mask.mean())
    meta['converter']['r1']['inputOccupiedFraction'] = float(mask0.mean())
    (out / 'cloud.json').write_text(json.dumps(meta, indent=2) + '\n')
    print(json.dumps({'out': str(out), 'occ': round(float(mask.mean()), 4), 'occ0': round(float(mask0.mean()), 4),
                      'profileMean': round(float(prof[mask].mean()), 3), 'scaleMean': round(float(scale[mask].mean()), 3)}))


if __name__ == '__main__':
    main()
