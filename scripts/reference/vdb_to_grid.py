"""Convert an OpenVDB float grid into the manifest's raw grid (scripts/reference/README.md). Runs in Blender's Python (openvdb):

  Blender -b --factory-startup -P scripts/reference/vdb_to_grid.py -- in.vdb --out dir [--grid density] [--voxel 4]
      [--up z|y] [--base-y 1500] [--margin 1]

No resampling: one source voxel becomes one manifest voxel of --voxel metres (the source's own voxel size is ignored). The active
bounding box is copied, with --margin zero voxels on every side (the pathtracer clips its medium at the grid box, so the boundary
voxels must be empty for both renderers to see the same cloud). --up z converts a Z-up source with the proper rotation
(x, y, z)_src -> (x, z, -y)_ours. The box is centred on x = z = 0 with its bottom face at --base-y.
Writes <out>/density.f32 and <out>/grid.json (the manifest's "grid" block, extinctionScale left at 1).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import openvdb

sys.path.insert(0, str(Path(__file__).resolve().parent))
import refio  # noqa: E402


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("vdb", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--grid", default="density")
    ap.add_argument("--voxel", type=float, default=4.0)
    ap.add_argument("--up", default="z", choices=["z", "y"])
    ap.add_argument("--base-y", type=float, default=1500.0)
    ap.add_argument("--margin", type=int, default=1)
    a = ap.parse_args(argv)
    grids, _ = openvdb.readAll(str(a.vdb))
    g = next(x for x in grids if x.name == a.grid)
    (i0, j0, k0), (i1, j1, k1) = g.evalActiveVoxelBoundingBox()
    src = np.zeros((i1 - i0 + 1, j1 - j0 + 1, k1 - k0 + 1), np.float32)   # [i, j, k]
    g.copyToArray(src, ijk=(i0, j0, k0))
    src = np.maximum(src, 0)
    if a.up == "z":
        zyx = src.transpose(1, 2, 0)[::-1]   # ours [kz, jy, ix] = src[i, j1 - j, k]: X = i, Y = k, Z = -j
    else:
        zyx = src.transpose(2, 1, 0)         # ours [k, j, i] = src[i, j, k]
    m = a.margin
    zyx = np.pad(zyx, m)
    nz, ny, nx = zyx.shape
    v = a.voxel
    origin = [-nx * v / 2, a.base_y - m * v, -nz * v / 2]
    a.out.mkdir(parents=True, exist_ok=True)
    refio.write_grid(a.out / "density.f32", zyx)
    block = {"file": "density.f32", "dims": [nx, ny, nz], "order": "x-fastest", "voxel": v, "origin": origin, "extinctionScale": 1.0,
             "source": {"vdb": str(a.vdb), "grid": a.grid, "activeBox": [[i0, j0, k0], [i1, j1, k1]], "up": a.up},
             "densityMax": float(zyx.max())}
    (a.out / "grid.json").write_text(json.dumps(block, indent=2) + "\n")
    print("VDB_TO_GRID", json.dumps({k: block[k] for k in ("dims", "origin", "voxel", "densityMax")}),
          "box m", [nx * v, ny * v, nz * v])


if __name__ == "__main__":
    main()
