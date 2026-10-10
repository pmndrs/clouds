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
| `fog` | one density grid (`--density-grid`, default `density`) | Surface = `density >= --iso` (default 0.05), closed by `--close` (see Sim imports below). SDF = exact EDT of that mask. **Profile = saturate(-sdf / depth)^gamma** (`--depth` 96 m, `--gamma` 1), so it is 0 outside, a small positive value at the surface and 1 at `depth` metres inside; the SDF is lightly smoothed (`--smooth` 1 voxel) first. Inside voxels never drop below 1/255 so `profile > 0` stays equal to the occupancy mask the SDF was built from. **Detail type** from `--detail-grid` if given, else a height heuristic: `--detail-bottom` 0.15 (wispy) rising smoothly to `--detail-top` 0.85 (billowy) over the cloud's height. **Density scale** = density / `--density-ref` (default the 99th percentile), optionally lifted by `--scale-floor`; or `--scale-grid`. |
| `sdf` | a level-set grid (`--sdf-grid`, default the first level set) | Surface = `sdf == --sdf-offset` (default 0). Mask = sdf < offset. Profile from the VDB's own (sub-voxel) SDF with the same `depth`/`gamma` mapping; SDF output is the EDT of the mask. Detail/scale as in fog (constant `--density-scale` 1 when no scale grid). |

### Sim imports (fog mode defaults, C2) and fields outside the profile

Fog mode is the import path for simulated clouds (EmberGen, Pyro). Those fields are puffy at 8-20 m; mapping each puff through its own
66 m pack-fit ramp gives a spatter of blobs with blue crevices ("shaving foam", `work/reports/R1-foam.md`). So fog mode now defaults to:

| Default | Option | What it does |
| --- | --- | --- |
| `--close 32` | `--close METRES` (0 = off) | Morphological closing of the `density >= iso` mask with a ball of this radius before the SDF and profile. Fills gaps and concavities narrower than 2 R, keeps the silhouette; R 64+ loses satellites. Done on the lattice the mask lives on (the fine lattice for heroes). |
| `--scale-top 1` | `--scale-top T` (0 = old) | Density scale = the pack height trend rescaled to top T, no density modulation (the old `pack_scale x (0.5 + 0.5 density/p99)` tops out near 0.75 and lifts eroded fringes into haze). Only without `--scale-grid`. |
| `--depth-shift 0` | `--depth-shift S` | Detail type from height only; the pack fit (0.25) makes deep voxels wispy and a closed body is deep everywhere (round pits). |

`--no-sim-defaults` restores the pre-C2 fog behaviour (no closing, old scale, depth shift 0.25); an explicit option still wins. Pack and sdf
modes keep their old defaults (`--close` is refused there). For an already smooth artist fog (Parkouring-style) use `--no-sim-defaults`.

For fog and sdf modes (all of them, not only sims) `--fields-outside N` (default 2) carries the detail type and density scale N voxels
past the profile edge with the nearest inside value, as the Guerrilla pack does (Parkouring's shell has T 0.645, S 0.628). Writing 0
there pulled trilinear fetches in the erosion band toward wispy and thin and made pits (`work/reports/P1.md`). The profile stays 0 outside,
so occupancy and the SDF are unchanged. Pack mode copies the pack's own grids and is unaffected. `0` writes zeros as before.
`cloud.json` records `converter.shaping`.

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
- `vdb-to-nvdb.mjs` fine.vdb -> fine.nvdb (WebVDB, vendored in `vendor/webvdb/`, see its NOTICE); `vdb-to-nvdb.test.mjs` runs under `pnpm test`.
- Tests: `python3 scripts/vdb/test_nvdf_math.py` (plain python, needs numpy) and `hython scripts/vdb/test_hython.py`
  (end to end, small).

## Hero clouds: fine lattice, `fine.vdb`, `fine.nvdb` (P8 spec, task H2)

`--fine-voxel-size 4` (fog mode) resamples the source to a 4 m lattice and derives everything from it:

```bash
$HYTHON scripts/vdb/vdb_to_nvdf.py --mode fog IN.vdb --out assets/clouds/NAME --world-scale S --margin 1 --fine-voxel-size 4 [--fine-shell 40]
python3 scripts/vdb/check_parity.py --fine assets/clouds/NAME        # needs node
```

- Fine profile: mask, exact EDT at 4 m, PACK_FIT (`--fine-smooth` sigma 1 fine voxel). The profile-spread noise length is
  now `PACK_FIT.profile.corrMeters` = 24 m (was `corrVox` 3 voxels), so 8 m output is bit-identical to before and 4 / 2 m
  keep the fitted statistics.
- Coarse field by reduction: R = mean of the ratio^3 fine profiles, floored at 1/255 where any is > 0, so coarse occupancy is a
  superset of the fine one. SDF = exact EDT of the coarse mask, G/B as before from the coarse mask and the block-mean density.
  Both lattices are nested: the fine array is padded so each coarse voxel is exactly one block, and the fine crop is the coarse crop x ratio.
- `fine.vdb`: a float fog grid `profile` (values k/255, written by Houdini via a volume and `convertvdb`), index (i, j, k) = lattice
  (x, up, map row), index 0 = the crop min corner voxel, voxel size = fine size, world translation = `houdini.cropMinWorld`.
  Houdini writes uniform 8^3 blocks as constant tiles; `vdb-to-nvdb.mjs` expands them.
- `fine.nvdb`: `node scripts/vdb/vdb-to-nvdb.mjs fine.vdb fine.nvdb --fp8` (WebVDB `parseVdb` -> `buildFromVdb` -> `quantize('fp8')` ->
  `writeNvdb`, vendored in `vendor/webvdb/`; `node scripts/vdb/vendor/webvdb/build.mjs` rebuilds the bundle). The converter runs it for you
  when `node` is on the path, and with `--check-u8` compares every voxel of the written file (read back through `NanoVDBFile` + the CPU
  `readValue`) with the exact uint8 lattice; the run fails unless the match is exact. `--decode` turns a `.nvdb` back into the dense lattice.
- `--drop-fine-vdb` deletes `fine.vdb` once `fine.nvdb` is verified (the shipped assets keep only the `.nvdb`).
- `--fine-shell M` zeroes fine voxels deeper than M metres (default off; 32-40 m recommended at 2 m). The coarse field keeps the interior.
- `cloud.json` gains `fine` (file, voxelSizeMeters, ratio, shellMeters, offsetFineVoxels, dims, leaves, bytes, indexAxes).
- Sim heroes: `authoring/sim/sim_clouds_p4f.py <name> --divsize 0.04 --tag _4m` grows the sim at 4 m, then
  `--convert-only <vdb> --fine-voxel-size 4` writes the asset. (`sim_clouds.py` after the P9-F rewrite no longer reproduces the shipped
  sim-cumulus / sim-congestus, `sim_clouds_p4f.py` is the P4-F script and does, byte for byte at 8 m.)

## Pack parity (done once, recorded in work/reports/P4-A.md)

```bash
$HYTHON scripts/vdb/vdb_to_nvdf.py --mode pack ".../NVDFs/Examples/ParkouringCloud/VDB/ParkouringCloud.vdb" --out work/captures/scratch/pack-parkouring
python3 scripts/vdb/check_parity.py work/captures/scratch/pack-parkouring assets/clouds/parkouring
```

## Fitted mapping (P4-B, default for `fog` and `sdf`)

`--mapping pack` (default) derives profile, detail type and density scale from the SDF depth and the height
fraction with the compact relation in `nvdf_math.PACK_FIT`, fitted to the pack's parkouring and stormbird
(`python3 -I scripts/vdb/fit_pack_mapping.py plot|fit`, plots in `work/captures/P4-B/fit-vs-pack.png`):
profile = `sat((d_eff - 1.4) / 66)^1.05 * baseLift(h)`, `d_eff = depth * exp(0.64 * lowFreqNoise)` (3 voxel
correlation, `--seed`, `--profile-noise` 0 disables, `--profile-gain`), detail type = smoothstep of height lowered by
depth, density scale = height ramp (times `0.5 + 0.5 * density/p99` in fog mode, `--scale-gain`, `--scale-floor`).
`--mapping legacy` restores the P4-A behaviour (`--depth`, `--gamma`, `--detail-bottom/top`).
Explicit `--detail-grid` / `--scale-grid` still override either mapping.
