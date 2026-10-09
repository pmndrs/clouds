#!/usr/bin/env python3
"""VDB -> Nubis voxel data field (NVDF) converter. Run with Houdini's hython:

  HYTHON=/Applications/Houdini/Houdini21.0.671/Frameworks/Houdini.framework/Versions/Current/Resources/bin/hython
  $HYTHON scripts/vdb/vdb_to_nvdf.py --mode pack IN.vdb --out assets/clouds/NAME
  $HYTHON scripts/vdb/vdb_to_nvdf.py --mode fog  IN.vdb --out assets/clouds/NAME [--density-grid density]
  $HYTHON scripts/vdb/vdb_to_nvdf.py --mode sdf  IN.vdb --out assets/clouds/NAME [--sdf-grid sdf]

Hero clouds (P8): add --fine-voxel-size 4 [--fine-shell 40] to also write fine.vdb + fine.nvdb (see scripts/vdb/README.md).

Writes the same runtime format as scripts/nubis/convert.mjs (cloud.json, nvdf.bin rgba8, sdf.bin r16
unorm -256..4096 m rounded down). See scripts/vdb/README.md and assets/clouds/README.md.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import tempfile
import math
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np  # noqa: E402

import nvdf_math as nm  # noqa: E402

MAX_VOXELS = 400_000_000  # refuse absurd dense reads (about 1.6 GB per float grid)


def fail(msg):
    raise SystemExit(f'vdb_to_nvdf: error: {msg}')


class Timer:
    def __init__(self):
        self.t0 = self.last = time.perf_counter()
        self.stages = {}

    def lap(self, name):
        now = time.perf_counter()
        self.stages[name] = round(now - self.last, 3)
        self.last = now

    @property
    def total(self):
        return time.perf_counter() - self.t0


# ---------------------------------------------------------------- Houdini side

def load_vdbs(path):
    import hou
    geo = hou.Geometry()
    geo.loadFromFile(str(path))
    grids = {}
    for prim in geo.prims():
        if isinstance(prim, hou.VDB):
            grids[prim.stringAttribValue('name') or f'prim{prim.number()}'] = prim
    if not grids:
        fail(f'{path} contains no VDB primitives')
    return grids


def grid_info(prim):
    """Describe a grid for the report: name is added by the caller."""
    bb = prim.activeVoxelBoundingBox()
    vs = [float(x) for x in prim.voxelSize()]
    return {
        'valueType': str(prim.intrinsicValue('vdb_value_type')),
        'class': str(prim.intrinsicValue('vdb_class')),
        'isSDF': bool(prim.isSDF()),
        'voxelSize': vs,
        'activeVoxels': int(prim.activeVoxelCount()),
        'activeIndexMin': [int(round(c)) for c in bb.minvec()],
        'activeIndexMaxExclusive': [int(round(c)) for c in bb.maxvec()],
        'background': float(prim.intrinsicValue('background')),
        'voxelZeroCentre': [float(c) for c in prim.indexToPos([0, 0, 0])],
        'transform3x3': [float(c) for c in prim.transform().asTuple()],
    }


def check_axis_aligned(prim, name):
    m = [float(c) for c in prim.transform().asTuple()]
    off = [abs(m[i]) for i in (1, 2, 3, 5, 6, 7)]
    d = [m[0], m[4], m[8]]
    if max(off) > 1e-6 * max(abs(x) for x in d) or min(d) <= 0:
        fail(f'grid {name!r} has a rotated/sheared/negative transform; only axis-aligned positive spacing is supported')
    if not (abs(d[0] - d[1]) < 1e-6 * d[0] and abs(d[0] - d[2]) < 1e-6 * d[0]):
        fail(f'grid {name!r} has anisotropic voxels {d}; resample it to cubic voxels in Houdini first')


def read_dense(prim, lo, hi):
    """Dense float32 read of hou index range [lo, hi) -> texture order (h=y, row=z, x)."""
    import hou
    n = [hi[i] - lo[i] for i in range(3)]
    if n[0] * n[1] * n[2] > MAX_VOXELS:
        fail(f'dense read of {n} exceeds {MAX_VOXELS} voxels; use a larger --voxel-size or crop the VDB first')
    bb = hou.BoundingBox(lo[0], lo[1], lo[2], hi[0], hi[1], hi[2])
    flat = np.asarray(prim.voxelRangeAsFloat(bb), dtype=np.float32)
    if flat.size != n[0] * n[1] * n[2]:
        fail(f'voxelRangeAsFloat returned {flat.size} values for {n}')
    # Houdini order: x fastest, then y (height), then z (map row) -> arr[z, y, x] -> texture [y, z, x]
    return np.ascontiguousarray(flat.reshape(n[2], n[1], n[0]).transpose(1, 0, 2))


# ---------------------------------------------------------------- resampling to the target lattice

def resample_to_target(arr, lo, sv, tv):
    """arr: texture-order float32 covering hou index [lo..lo+shape). Returns (arr', t0) on the target lattice
    anchored at the source corner (index 0); t0 = global target index of arr'[0,0,0] in hou (x,y,z)."""
    if abs(sv - tv) < 1e-9 * tv:
        return arr, list(lo)
    ax_hou = [1, 2, 0]  # texture axis -> hou axis
    t0 = [0, 0, 0]
    for tex_axis, ha in enumerate(ax_hou):
        n_in = arr.shape[tex_axis]
        a = int(math.floor(lo[ha] * sv / tv))
        b = int(math.ceil((lo[ha] + n_in) * sv / tv))
        w = nm.resample_matrix(n_in, lo[ha], sv, (a, b), tv)
        arr = nm.apply_axis(arr, tex_axis, w)
        t0[ha] = a
    return np.ascontiguousarray(arr, dtype=np.float32), t0



# ---------------------------------------------------------------- fine (hero) lattice

def fine_profile(mask_f, fv, args):
    """Profile at the fine voxel size: same PACK_FIT mapping as the coarse path, with the noise correlation length in metres.
    Returns (uint8 profile, true depth in metres below the surface)."""
    if args.mapping != 'pack':
        fail('--fine-voxel-size needs --mapping pack')
    sdf = nm.signed_distance(mask_f, fv)
    depth_true = np.where(mask_f, np.maximum(-sdf, 0.0), 0.0).astype(np.float32)
    driver = nm.gaussian_blur(sdf, args.fine_smooth)
    del sdf
    depth = np.where(mask_f, np.maximum(-driver, 0.0), 0.0).astype(np.float32)
    del driver
    hfrac = nm.height_fraction(mask_f)
    noise = nm.smooth_noise(mask_f.shape, nm.corr_voxels(fv), args.seed)
    prof = np.where(mask_f, nm.pack_profile(depth, hfrac, noise * args.profile_noise), 0.0)
    prof = np.clip(prof * args.profile_gain, 0.0, 1.0)
    r8 = nm.quantize_unorm8(prof)
    return np.where(mask_f, np.maximum(r8, 1), 0).astype(np.uint8), depth_true


def write_fine_vdb(fine_u8_tex, out_path, min_corner_world, fv):
    """Write the fine profile lattice (uint8, texture order [up, row, x]) as a float fog VDB grid 'profile' with values k/255.

    VDB index (i, j, k) = (x, up, row) of the lattice, voxel (0, 0, 0) is the lattice corner voxel: index 0 has its centre at
    min_corner_world + fv/2 and the voxel size is fv. Houdini may store uniform 8^3 blocks as constant tiles; vdb-to-nvdb.mjs expands them to leaves.
    Returns {'activeVoxels': n, 'dimsHou': [nx, ny, nz]}."""
    import hou
    import __main__
    hou_arr = np.ascontiguousarray(fine_u8_tex.transpose(1, 0, 2))      # [row, up, x] = hou flat order z, y, x
    nz, ny, nx = hou_arr.shape
    geo = hou.Geometry()
    geo.addAttrib(hou.attribType.Prim, 'name', '')
    bb = hou.BoundingBox(*[float(c) for c in min_corner_world], *[float(min_corner_world[i] + n * fv) for i, n in enumerate((nx, ny, nz))])
    vol = geo.createVolume(nx, ny, nz, bb)
    vol.setAttribValue('name', 'profile')
    vol.setAllVoxels((hou_arr.astype(np.float32) / 255.0).ravel().tolist())
    __main__._FINE_GEO = geo
    net = hou.node('/obj').createNode('geo')
    src = net.createNode('python')
    src.parm('python').set('import __main__\nhou.pwd().geometry().merge(__main__._FINE_GEO)')
    cv = net.createNode('convertvdb')
    cv.setInput(0, src)
    cv.parm('conversion').set('vdb')
    cv.parm('vdbclass').set('fog')
    cv.parm('vdbtype').set('float')
    cv.parm('prune').set(0)   # (Houdini still writes uniform 8^3 blocks as tiles; vdb-to-nvdb.mjs handles both)
    cv.cook(force=True)
    out = cv.geometry()
    prims = [p for p in out.prims() if isinstance(p, hou.VDB)]
    if len(prims) != 1:
        fail(f'convertvdb produced {len(prims)} VDB primitives')
    v = prims[0]
    c0 = [float(c) for c in v.indexToPos([0, 0, 0])]
    want = [min_corner_world[i] + 0.5 * fv for i in range(3)]
    if max(abs(c0[i] - want[i]) for i in range(3)) > 1e-4 or abs(float(v.voxelSize()[0]) - fv) > 1e-6 * fv:
        fail(f'fine VDB lattice is off: index 0 at {c0}, want {want}; voxel {list(v.voxelSize())}, want {fv}')
    n_active = int(v.activeVoxelCount())
    if n_active != int((hou_arr > 0).sum()):
        fail(f'fine VDB has {n_active} active voxels, lattice has {int((hou_arr > 0).sum())} non-zero')
    out.saveToFile(str(out_path))
    net.destroy()
    del __main__._FINE_GEO
    return {'activeVoxels': n_active, 'dimsHou': [nx, ny, nz]}


def write_fine_nvdb(fine_vdb, fine_nvdb, fine_u8_tex, fine_dims_hou):
    """fine.vdb -> fine.nvdb through scripts/vdb/vdb-to-nvdb.mjs (WebVDB), checking the result against the exact lattice.
    Returns the script's JSON, or None when node is not on the path (then prints the command)."""
    node = shutil.which('node')
    script = Path(__file__).with_name('vdb-to-nvdb.mjs')
    if node is None:
        print(f'vdb_to_nvdf: node not found; run: node {script} {fine_vdb} {fine_nvdb} --fp8', file=sys.stderr)
        return None
    with tempfile.TemporaryDirectory() as td:
        u8 = Path(td) / 'fine.u8'
        u8.write_bytes(np.ascontiguousarray(fine_u8_tex.transpose(1, 0, 2)).tobytes())   # hou flat order (z, y, x)
        cmd = [node, str(script), str(fine_vdb), str(fine_nvdb), '--grid', 'profile', '--fp8', '--check-u8', str(u8), '--dims', *map(str, fine_dims_hou)]
        res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        fail(f'vdb-to-nvdb failed ({res.returncode}): {res.stderr.strip() or res.stdout.strip()}')
    return json.loads(res.stdout.strip().splitlines()[-1])



def write_fine(out, r8_fine, depth_fine, cmin, cdims, ratio, fv, tv, corner0, t0, args):
    """Crop the fine lattice to the coarse crop (x ratio), apply the shell, write fine.vdb + fine.nvdb. Returns cloud.json block and report."""
    fcmin = [c * ratio for c in cmin]
    fdims = [d * ratio for d in cdims]
    fine = nm.crop(r8_fine, fcmin, fdims)
    if args.fine_shell:
        deep = nm.crop(depth_fine, fcmin, fdims) > args.fine_shell
        fine = np.where(deep, 0, fine).astype(np.uint8)
    # world position (hou axes, metres) of the fine lattice corner = the coarse crop min corner
    crop_offset = [t0[0] + cmin[0], t0[2] + cmin[1], t0[1] + cmin[2]]
    min_world = [corner0[0] + crop_offset[0] * tv, corner0[1] + crop_offset[2] * tv, corner0[2] + crop_offset[1] * tv]
    vdb_path, nvdb_path = out / 'fine.vdb', out / 'fine.nvdb'
    vinfo = write_fine_vdb(fine, vdb_path, min_world, fv)
    ninfo = write_fine_nvdb(vdb_path, nvdb_path, fine, vinfo['dimsHou'])
    if args.drop_fine_vdb and ninfo:
        vdb_bytes = vdb_path.stat().st_size
        vdb_path.unlink()
    else:
        vdb_bytes = vdb_path.stat().st_size
    occupied = int((fine > 0).sum())
    cj = {'file': 'fine.nvdb', 'voxelSizeMeters': fv, 'grid': 'profile', 'ratio': ratio, 'shellMeters': args.fine_shell or None,
          'offsetFineVoxels': [0, 0, 0], 'dims': fdims,
          'indexAxes': 'fine.nvdb index (i, j, k) = lattice (x, up, map row); index (0, 0, 0) is the lattice corner voxel at the coarse crop min corner; value = profile / 255 (Fp8, exact for k/255)',
          'activeVoxels': vinfo['activeVoxels'], 'occupiedFraction': round(occupied / float(fine.size), 4)}
    if ninfo:
        cj.update({'bytes': ninfo['fileBytes'], 'leaves': None})
        if 'nodeCounts' in ninfo:
            cj['leaves'] = ninfo['nodeCounts']['leaf']
    rep = {'vdbBytes': vdb_bytes, 'nvdb': ninfo, 'fineDims': fdims}
    return {'cloudJson': cj, 'report': rep}


# ---------------------------------------------------------------- conversion

def convert(args):
    timer = Timer()
    grids = load_vdbs(args.input)
    report = {'input': str(Path(args.input).resolve()), 'grids': {n: grid_info(p) for n, p in grids.items()}}
    timer.lap('load')

    mode = args.mode
    if mode == 'pack':
        base_name = args.profile_grid
    elif mode == 'fog':
        base_name = args.density_grid
    else:
        base_name = args.sdf_grid or next((n for n, p in grids.items() if p.isSDF()), None)
        if base_name is None:
            fail('no level-set grid found; pass --sdf-grid')
    if base_name not in grids:
        fail(f'grid {base_name!r} not found; available: {", ".join(grids)}')
    base = grids[base_name]
    if mode == 'sdf' and not base.isSDF():
        fail(f'grid {base_name!r} is not a level set; use --mode fog for density grids')
    if mode == 'fog' and base.isSDF():
        fail(f'grid {base_name!r} is a level set; use --mode sdf')
    check_axis_aligned(base, base_name)

    sv = float(base.voxelSize()[0]) * args.world_scale   # source voxel size in metres
    tv = float(args.voxel_size) if args.voxel_size else (sv if mode == 'pack' else 8.0)
    fv = float(args.fine_voxel_size) if args.fine_voxel_size else None
    ratio = None
    if fv:
        if mode != 'fog':
            fail('--fine-voxel-size is only supported with --mode fog')
        ratio = int(round(tv / fv))
        if ratio < 2 or abs(ratio * fv - tv) > 1e-6 * tv:
            fail(f'--fine-voxel-size {fv} must divide the coarse voxel size {tv} into an integer ratio >= 2 (nested lattices)')
    rtv = fv if fv else tv   # voxel size the source is resampled to (fine lattice for heroes)
    centre0 = [float(c) * args.world_scale for c in base.indexToPos([0, 0, 0])]
    corner0 = [c - 0.5 * sv for c in centre0]            # world position (hou axes, metres) of the corner of source voxel (0,0,0)

    bb = base.activeVoxelBoundingBox()
    alo = [int(round(c)) for c in bb.minvec()]
    ahi = [int(round(c)) for c in bb.maxvec()]
    if any(ahi[i] <= alo[i] for i in range(3)):
        fail(f'grid {base_name!r} has no active voxels')
    pad = int(math.ceil(args.margin * tv / sv)) + 2
    lo = [alo[i] - pad for i in range(3)]
    hi = [ahi[i] + pad for i in range(3)]
    clamped = False
    if mode == 'pack':
        # The pack grids are dense 512x64x512; its extent is the SDF/detail grid's active box. Clamp to it so
        # the crop is cut at the grid faces exactly like the TGA converter.
        ref = grids.get(args.sdf_grid or 'sdf') or grids.get(args.detail_grid)
        if ref is not None:
            rb = ref.activeVoxelBoundingBox()
            rlo = [int(round(c)) for c in rb.minvec()]
            rhi = [int(round(c)) for c in rb.maxvec()]
            lo = [max(lo[i], rlo[i]) for i in range(3)]
            hi = [min(hi[i], rhi[i]) for i in range(3)]
            clamped = True

    def fetch(name):
        arr = read_dense(grids[name], lo, hi)
        if name != base_name:
            check_axis_aligned(grids[name], name)
        return arr

    def fetch_resampled(name, scale_to_metres=False):
        arr = fetch(name)
        if scale_to_metres:
            arr = arr * (args.world_scale)
        arr, t0 = resample_to_target(arr, lo, sv, rtv)
        return arr, t0

    # --- gather resampled fields (texture order), target lattice origin t0 (hou x,y,z)
    given_sdf = None
    if mode == 'pack':
        prof, t0 = fetch_resampled(args.profile_grid)
        detail = fetch_resampled(args.detail_grid)[0] if args.detail_grid in grids else None
        scale = fetch_resampled(args.scale_grid)[0] if args.scale_grid in grids else None
        if args.sdf_source == 'vdb':
            sname = args.sdf_grid or 'sdf'
            if sname not in grids:
                fail(f'--sdf-source vdb needs grid {sname!r}')
            given_sdf = fetch_resampled(sname, True)[0]
        r8 = nm.quantize_unorm8(prof)
        mask = r8 > 0
        density = None
    elif mode == 'fog':
        density, t0 = fetch_resampled(args.density_grid)
        mask = density >= args.iso
        detail = fetch_resampled(args.detail_grid)[0] if args.detail_grid else None
        scale = fetch_resampled(args.scale_grid)[0] if args.scale_grid else None
    else:
        given_sdf, t0 = fetch_resampled(base_name, True)
        mask = given_sdf < args.sdf_offset
        detail = fetch_resampled(args.detail_grid)[0] if args.detail_grid else None
        scale = fetch_resampled(args.scale_grid)[0] if args.scale_grid else None
        density = None
    if fv:
        # Nested lattices: pad the fine field with zeros so its origin and extents are multiples of the ratio. Each coarse voxel is then
        # exactly one ratio^3 block of fine voxels (global index // ratio), and the coarse field is derived from the fine one.
        pads, t0n = [], list(t0)
        for tex_axis, ha in enumerate([1, 2, 0]):
            lo_pad = t0[ha] % ratio
            hi_pad = (-(density.shape[tex_axis] + lo_pad)) % ratio
            pads.append((lo_pad, hi_pad))
            t0n[ha] = t0[ha] - lo_pad
        padf = lambda a: None if a is None else np.pad(a, pads)
        density, detail, scale = padf(density), padf(detail), padf(scale)
        mask = density >= args.iso
        t0 = t0n
    if args.rotate_y:
        # Quarter turns about the up axis (texture arrays are [up, row, x]); lets an elongated cloud face the flagship's side-on bookmarks.
        k = (args.rotate_y // 90) % 4
        rot = lambda a: None if a is None else np.ascontiguousarray(np.rot90(a, k, axes=(1, 2)))
        mask = rot(mask)
        density, detail, scale, given_sdf = rot(density), rot(detail), rot(scale), rot(given_sdf)
        if mode == 'pack':
            r8 = rot(r8)
        t0 = [0, 0, 0]   # placement metadata is not tracked through the rotation (the runtime centres the cloud itself)
    timer.lap('read+resample')

    # --- fine hero lattice: profile at the fine voxel size, coarse field by reduction (P8 spec 4.3)
    r8_fine = depth_fine = r8_coarse_pre = None
    if fv:
        r8_fine, depth_fine = fine_profile(mask, fv, args)
        r8_coarse_pre = nm.reduce_profile_u8(r8_fine, ratio)
        mask = r8_coarse_pre > 0                      # coarse occupancy = any fine voxel of the block (superset)
        density = nm.block_mean(density, ratio)
        detail = None if detail is None else nm.block_mean(detail, ratio)
        scale = None if scale is None else nm.block_mean(scale, ratio)
        t0 = [t0[0] // ratio, t0[1] // ratio, t0[2] // ratio]
        timer.lap('fine profile')

    # --- crop (on the occupancy mask)
    b = nm.occupied_bounds(mask.astype(np.uint8), args.margin)
    cmin, cdims = b['cropMin'], b['cropDims']
    mask_c = nm.crop(mask, cmin, cdims)
    cropf = lambda a: None if a is None else nm.crop(a, cmin, cdims)
    detail_c, scale_c, density_c, given_c = cropf(detail), cropf(scale), cropf(density), cropf(given_sdf)
    if mode == 'pack':
        r8_c = nm.crop(r8, cmin, cdims)
    timer.lap('crop')

    # --- SDF
    if mode == 'pack' and args.sdf_source == 'vdb':
        sdf_c = np.clip(given_c, nm.SDF_MIN, nm.SDF_MAX)
    else:
        sdf_c = nm.signed_distance(mask_c, tv)
    timer.lap('sdf')

    # --- NVDF channels
    extra = {}
    if mode == 'pack':
        g8 = nm.quantize_unorm8(detail_c) if detail_c is not None else np.full(r8_c.shape, 128, np.uint8)
        b8 = nm.quantize_unorm8(scale_c) if scale_c is not None else np.full(r8_c.shape, 255, np.uint8)
        extra['channels'] = {'r': args.profile_grid, 'g': args.detail_grid if detail_c is not None else 'constant 0.5', 'b': args.scale_grid if scale_c is not None else 'constant 1.0'}
    else:
        driver = given_c if (mode == 'sdf' and given_c is not None) else nm.gaussian_blur(sdf_c, args.smooth)
        legacy = args.mapping == 'legacy'
        depth_c = np.where(mask_c, np.maximum(-driver, 0.0), 0.0)
        hfrac = nm.height_fraction(mask_c)
        if r8_coarse_pre is not None:
            r8_c = nm.crop(r8_coarse_pre, cmin, cdims)      # hero: the coarse profile is the reduction of the fine one
        else:
            if legacy:
                prof_c = nm.profile_from_sdf(driver, mask_c, args.depth, args.gamma)
            else:
                noise = nm.smooth_noise(mask_c.shape, nm.corr_voxels(tv), args.seed)
                prof_c = np.where(mask_c, nm.pack_profile(depth_c, hfrac, noise * args.profile_noise), 0.0)
                prof_c = prof_c * args.profile_gain
                prof_c = np.clip(prof_c, 0.0, 1.0)
            r8_c = nm.quantize_unorm8(prof_c)
            r8_c = np.where(mask_c, np.maximum(r8_c, 1), 0).astype(np.uint8)
        if detail_c is None:
            detail_c = (nm.detail_from_height(mask_c, args.detail_bottom, args.detail_top) if legacy
                        else nm.pack_detail(depth_c, hfrac))
        if scale_c is None:
            if density_c is not None:
                dn, ref = nm.scale_from_density(density_c, args.density_ref)
                extra['densityRef'] = ref
                if legacy:
                    scale_c = args.scale_floor + (1.0 - args.scale_floor) * dn
                else:
                    # pack height trend, modulated by the artist's density (half weight so a thin density does not zero it)
                    scale_c = np.clip(nm.pack_scale(hfrac) * (0.5 + 0.5 * dn) * args.scale_gain, 0.0, 1.0)
                    scale_c = np.maximum(scale_c, args.scale_floor)
            else:
                scale_c = (np.full(mask_c.shape, args.density_scale, np.float32) if legacy
                           else np.clip(nm.pack_scale(hfrac) * args.scale_gain, 0.0, 1.0))
        g8 = nm.quantize_unorm8(np.where(mask_c, detail_c, 0.0))
        b8 = nm.quantize_unorm8(np.where(mask_c, scale_c, 0.0))
        extra['profileMapping'] = {'mapping': args.mapping, 'packFit': (nm.PACK_FIT if args.mapping == 'pack' else None), 'depthMeters': args.depth, 'gamma': args.gamma, 'smoothVoxels': args.smooth if mode == 'fog' else 0,
                                   'detail': args.detail_grid or f'height heuristic {args.detail_bottom}->{args.detail_top}',
                                   'densityScale': args.scale_grid or ('density / p99' if density_c is not None else args.density_scale)}
    nvdf = nm.pack_rgba8(r8_c, g8, b8)
    sdf16 = nm.encode_sdf_r16(sdf_c)
    timer.lap('channels')

    # --- write
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'nvdf.bin').write_bytes(nvdf.tobytes())
    (out / 'sdf.bin').write_bytes(sdf16.astype('<u2').tobytes())
    fine_meta = None
    if fv:
        fine_meta = write_fine(out, r8_fine, depth_fine, cmin, cdims, ratio, fv, tv, corner0, t0, args)
        timer.lap('fine write')
    name = args.name or out.name
    # target-lattice origin in "source axes" (x, map row, up) = (hou x, hou z, hou y)
    t0_src = [t0[0], t0[2], t0[1]]
    crop_offset = [t0_src[i] + cmin[i] for i in range(3)]
    min_m = [crop_offset[i] * tv for i in range(3)]
    size_m = [cdims[i] * tv for i in range(3)]
    hou_min = [corner0[0] + crop_offset[0] * tv, corner0[1] + crop_offset[2] * tv, corner0[2] + crop_offset[1] * tv]
    meta = {
        'name': name,
        'source': f'{Path(args.input).name} ({mode} mode, via scripts/vdb/vdb_to_nvdf.py)',
        'dims': cdims,
        'voxelSizeMeters': tv,
        'layout': 'x fastest, then y (map row, +Y = up in the source image), then z (slice, up); texel (x,y,z) at ((z*dims[1]+y)*dims[0]+x)',
        'cropOffset': crop_offset,
        'occupiedMin': [t0_src[i] + b['occupiedMin'][i] for i in range(3)],
        'occupiedMax': [t0_src[i] + b['occupiedMax'][i] for i in range(3)],
        'margin': args.margin,
        'boundsMeters': {
            'note': 'source axes: x = map column, y = map row, z = up; origin = corner of source-lattice voxel (0,0,0). VDB mapping: x = hou X, row = hou Z, up = hou Y.',
            'min': min_m,
            'max': [min_m[i] + size_m[i] for i in range(3)],
            'size': size_m,
        },
        'houdini': {
            'note': 'world position (hou axes x, y-up, z, metres after --world-scale) of the crop min corner and of source voxel (0,0,0) corner',
            'cropMinWorld': hou_min,
            'sourceOriginCornerWorld': corner0,
            'sourceVoxelSizeMeters': sv,
            'worldScale': args.world_scale,
        },
        'nvdf': {
            'file': 'nvdf.bin', 'format': 'rgba8unorm', 'bytes': int(nvdf.nbytes),
            'channels': {'r': 'dimensional profile (0 none, 1 full cloud)', 'g': 'detail type (0 wispy, 1 billowy)', 'b': 'density scale', 'a': 'unused'},
        },
        'sdf': {
            'file': 'sdf.bin', 'format': 'r16unorm little-endian', 'bytes': int(sdf16.nbytes),
            'encoding': {'minMeters': nm.SDF_MIN, 'maxMeters': nm.SDF_MAX, 'decode': 'meters = minMeters + v * (maxMeters - minMeters)', 'rounding': 'down'},
            'source': ('VDB level-set grid, resampled' if (mode == 'pack' and args.sdf_source == 'vdb') else
                       'exact 3D EDT of (profile > 0) on the cropped lattice, signed (negative inside), surface at half a voxel from the nearest centres'),
            'outsideCrop': 'treat as far / empty (distance >= margin*voxel from the occupied bounds, except where the crop is clamped to the grid)',
        },
        'converter': {'script': 'scripts/vdb/vdb_to_nvdf.py', 'mode': mode, 'grid': base_name, 'clampedToGrid': clamped, **extra},
    }
    if fine_meta:
        meta['fine'] = fine_meta['cloudJson']
        meta['converter']['fine'] = {'voxelSizeMeters': fv, 'ratio': ratio, 'coarseFromFine': 'mean of the ratio^3 fine profiles, floored at 1/255 where any is > 0',
                                     'fineSmoothVoxels': args.fine_smooth, 'corrMeters': nm.PACK_FIT['profile']['corrMeters']}
    (out / 'cloud.json').write_text(json.dumps(meta, indent=2) + '\n')
    timer.lap('write')
    if fine_meta:
        report['fine'] = fine_meta['report']
    report.update({'out': str(out), 'dims': cdims, 'cropOffset': crop_offset, 'voxelSizeMeters': tv, 'sourceVoxelSizeMeters': sv,
                   'bytes': int(nvdf.nbytes + sdf16.nbytes), 'occupiedFraction': float(mask_c.mean()), 'seconds': round(timer.total, 3), 'stages': timer.stages})
    print(json.dumps(report, indent=2))
    return report


def parser():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('input', help='input .vdb (or any Houdini geometry file holding VDB primitives)')
    p.add_argument('--mode', choices=['pack', 'fog', 'sdf'], required=True, help='pack: Nubis NVDF VDB; fog: artist density VDB; sdf: level-set VDB')
    p.add_argument('--out', required=True, help='output directory (cloud.json, nvdf.bin, sdf.bin)')
    p.add_argument('--name', help='cloud name for cloud.json (default: output dir name)')
    p.add_argument('--voxel-size', type=float, help='target voxel size in metres (default 8; pack mode: the VDB voxel size)')
    p.add_argument('--world-scale', type=float, default=1.0, help='multiply VDB world units by this to get metres (default 1)')
    p.add_argument('--rotate-y', type=int, default=0, choices=[0, 90, 180, 270],
                   help='rotate the field about the up axis by a quarter-turn multiple (default 0)')
    p.add_argument('--margin', type=int, default=8, help='crop margin in target voxels around profile > 0 (default 8 = 64 m)')
    p.add_argument('--profile-grid', default='dimensional_profile')
    p.add_argument('--detail-grid', help='detail-type grid (0 wispy .. 1 billowy). pack default: detail_type; fog/sdf: optional')
    p.add_argument('--scale-grid', help='density-scale grid (0..1). pack default: density_scale; fog/sdf: optional')
    p.add_argument('--sdf-grid', help='level-set grid. pack default: sdf; sdf mode default: first level set')
    p.add_argument('--sdf-source', choices=['edt', 'vdb'], default='edt', help='pack mode: recompute the SDF from profile > 0 (edt, matches convert.mjs) or resample the VDB sdf grid (vdb)')
    f = p.add_argument_group('hero clouds (fog mode): fine lattice -> fine.vdb / fine.nvdb, coarse field by reduction')
    f.add_argument('--fine-voxel-size', type=float, help='fine voxel size in metres (4 or 2); must divide --voxel-size (default 8) into an integer ratio. Writes fine.vdb and fine.nvdb next to nvdf.bin')
    f.add_argument('--fine-shell', type=float, help='keep fine voxels only within this many metres of the surface (e.g. 40); the coarse field is unaffected')
    f.add_argument('--drop-fine-vdb', action='store_true', help='delete fine.vdb after fine.nvdb is built and verified (the shipped assets keep only the .nvdb; fine.vdb is reproducible)')
    f.add_argument('--fine-smooth', type=float, default=1.0, help='gaussian sigma (fine voxels) applied to the fine SDF that drives the profile (default 1)')
    g = p.add_argument_group('fog / sdf modes: deriving the Nubis fields')
    g.add_argument('--density-grid', default='density')
    g.add_argument('--iso', type=float, default=0.05, help='fog: density threshold that defines the cloud surface (default 0.05)')
    g.add_argument('--sdf-offset', type=float, default=0.0, help='sdf: surface is at sdf == offset metres (default 0; positive grows the cloud)')
    g.add_argument('--mapping', choices=['pack', 'legacy'], default='pack', help='pack (default): mapping fitted to the Nubis pack (nvdf_math.PACK_FIT, scripts/vdb/fit_pack_mapping.py); legacy: P4-A saturate(-sdf/depth)^gamma, height-ramp detail, density/p99 scale')
    g.add_argument('--seed', type=int, default=1, help='pack mapping: seed of the low-frequency profile variation')
    g.add_argument('--profile-noise', type=float, default=1.0, help='pack mapping: scale of the profile spread (0 = smooth depth-only profile)')
    g.add_argument('--profile-gain', type=float, default=1.0, help='pack mapping: multiply the profile (then clamp to 1)')
    g.add_argument('--scale-gain', type=float, default=1.0, help='pack mapping: multiply the density scale (then clamp to 1)')
    g.add_argument('--depth', type=float, default=96.0, help='metres from the surface at which profile reaches 1 (default 96)')
    g.add_argument('--gamma', type=float, default=1.0, help='profile = saturate(-sdf/depth)^gamma (default 1)')
    g.add_argument('--smooth', type=float, default=1.0, help='fog: gaussian sigma (voxels) applied to the SDF that drives the profile (default 1)')
    g.add_argument('--detail-bottom', type=float, default=0.15, help='height heuristic detail type at the cloud base (default 0.15, wispy)')
    g.add_argument('--detail-top', type=float, default=0.85, help='height heuristic detail type at the cloud top (default 0.85, billowy)')
    g.add_argument('--density-ref', type=float, help='fog: density that maps to density scale 1 (default: 99th percentile of positive density)')
    g.add_argument('--scale-floor', type=float, default=0.0, help='fog: minimum density scale inside the cloud, 0..1 (default 0)')
    g.add_argument('--density-scale', type=float, default=1.0, help='sdf: constant density scale when no scale grid is given (default 1)')
    return p


def main():
    args = parser().parse_args()
    if args.mode == 'pack':
        args.detail_grid = args.detail_grid or 'detail_type'
        args.scale_grid = args.scale_grid or 'density_scale'
    try:
        import hou  # noqa: F401
    except ImportError:
        fail('import hou failed: run this script with Houdini hython')
    convert(args)


if __name__ == '__main__':
    main()
