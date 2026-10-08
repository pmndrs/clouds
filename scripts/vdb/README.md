# VDB to NVDF (Houdini to runtime clouds)

`vdb_to_nvdf.py` turns a VDB into the runtime cloud format used by `loadCloudVolume()` (identical to what
`scripts/nubis/convert.mjs` writes, see `assets/clouds/README.md`): `cloud.json`, `nvdf.bin` (rgba8: profile,
detail type, density scale), `sdf.bin` (r16 unorm, -256..4096 m, rounded down). It runs under Houdini's
`hython` (Indie is fine) and needs nothing else. Houdini's numpy is used.

```bash
HYTHON=/Applications/Houdini/Houdini21.0.671/Frameworks/Houdini.framework/Versions/Current/Resources/bin/hython
$HYTHON scripts/vdb/vdb_to_nvdf.py --mode pack IN.vdb --out assets/clouds/NAME   # Nubis pack NVDF VDB
$HYTHON scripts/vdb/vdb_to_nvdf.py --mode fog  IN.vdb --out assets/clouds/NAME   # artist fog (density) VDB
$HYTHON scripts/vdb/vdb_to_nvdf.py --mode sdf  IN.vdb --out assets/clouds/NAME   # level-set VDB (e.g. mesh -> VDB)
```

hython takes about 3 s to start; the conversion itself is 0.5 to 15 s. A JSON report (grids, dims, timings) is printed.

## Modes

| Mode | Input grids | How the three channels and the SDF are made |
| --- | --- | --- |
| `pack` | `dimensional_profile`, `detail_type`, `density_scale`, (`sdf`) | Read as is, quantised to 8 bit (round to nearest). SDF recomputed from `profile > 0` (default `--sdf-source edt`, matches the TGA converter exactly) or resampled from the pack `sdf` grid (`--sdf-source vdb`). |
| `fog` | one density grid (`--density-grid`, default `density`) | Surface = `density >= --iso` (default 0.05). SDF = exact EDT of that mask. **Profile = saturate(-sdf / depth)^gamma** (`--depth` 96 m, `--gamma` 1), so it is 0 outside, a small positive value at the surface and 1 at `depth` metres inside; the SDF is lightly smoothed (`--smooth` 1 voxel) first. Inside voxels never drop below 1/255 so `profile > 0` stays equal to the occupancy mask the SDF was built from. **Detail type** from `--detail-grid` if given, else a height heuristic: `--detail-bottom` 0.15 (wispy) rising smoothly to `--detail-top` 0.85 (billowy) over the cloud's height. **Density scale** = density / `--density-ref` (default the 99th percentile), optionally lifted by `--scale-floor`; or `--scale-grid`. |
| `sdf` | a level-set grid (`--sdf-grid`, default the first level set) | Surface = `sdf == --sdf-offset` (default 0). Mask = sdf < offset. Profile from the VDB's own (sub-voxel) SDF with the same `depth`/`gamma` mapping; SDF output is the EDT of the mask. Detail/scale as in fog (constant `--density-scale` 1 when no scale grid). |

Common options: `--voxel-size` (target metres; default 8, or the VDB's own in pack mode), `--world-scale` (VDB
world units to metres), `--margin` (crop margin in target voxels, default 8), `--name`.
Resampling to a different voxel size uses an area-average (down) / linear (up) filter per axis.

## Axes, placement and units

- VDB (Houdini) axes are y-up. Output uses the repo's source axes: texture x = VDB X, texture y (map row) =
  VDB Z, texture z (slice, up) = VDB Y. `nvdf.bin`/`sdf.bin` index = `(z*dims[1] + y)*dims[0] + x`.
- The VDB transform must be axis-aligned with cubic voxels (the script stops with a message otherwise).
- `cloud.json` `cropOffset`/`boundsMeters` are in target-lattice voxels from the VDB's index-space origin (voxel
  index 0, 0, 0 corner), exactly like the pack converter. The `houdini` block keeps the world position (Houdini
  axes, metres) of the crop's min corner (`cropMinWorld`) and of the source origin corner. The runtime ignores
  both and centres the cloud itself.
- Expected values: density-like grids in 0..1 (clamped); the SDF in world units times `--world-scale`.
- The Nubis runtime assumes 8 m voxels; other sizes work in the loader but were only verified at 8 m.

## Files

- `vdb_to_nvdf.py` the converter. `nvdf_math.py` pure numpy helpers (vectorised exact EDT, resampling, profile
  mapping, encoding).
- `make_test_cloud.py` builds a noise-displaced sphere-cluster fog VDB (and optionally a level-set VDB) with a
  Houdini SOP network: `python` points, `vdbfromparticles`, `volumewrangle`.
  `hython scripts/vdb/make_test_cloud.py out.vdb --width 800 --count 16 --sdf-out sdf.vdb`
- `check_parity.py A B` compares two converted directories (board thresholds).
- Tests: `python3 scripts/vdb/test_nvdf_math.py` (plain python, needs numpy) and `hython scripts/vdb/test_hython.py`
  (end to end, small).

## Pack parity (done once, recorded in work/reports/P4-A.md)

```bash
$HYTHON scripts/vdb/vdb_to_nvdf.py --mode pack ".../NVDFs/Examples/ParkouringCloud/VDB/ParkouringCloud.vdb" --out work/captures/scratch/pack-parkouring
python3 scripts/vdb/check_parity.py work/captures/scratch/pack-parkouring assets/clouds/parkouring
```
