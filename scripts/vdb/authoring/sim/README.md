# Fluid-sim hero clouds (Houdini Pyro)

`sim_clouds.py` grows `sim-cumulus` and `sim-congestus` with Houdini 21's SOP-level **Pyro Solver**, then converts the
chosen frame with `scripts/vdb/vdb_to_nvdf.py --mode fog --voxel-size 8` into `assets/clouds/heroes/sim-<name>/`.
This is the "grown" route of Nubis3 slides 63-64. Whole run is under 30 s per cloud on an 18-core Mac (Houdini Indie is fine).

```bash
HYTHON=/Applications/Houdini/Houdini21.0.671/Frameworks/Houdini.framework/Versions/Current/Resources/bin/hython
$HYTHON scripts/vdb/authoring/sim/sim_clouds.py cumulus                 # sim + cache checkpoints + convert
$HYTHON scripts/vdb/authoring/sim/sim_clouds.py congestus
$HYTHON scripts/vdb/authoring/sim/sim_clouds.py cumulus --no-convert --tag _t --set solver.turbulence=1.0   # experiment
$HYTHON scripts/vdb/authoring/sim/sim_clouds.py cumulus --convert-only work/captures/scratch/p4f/cumulus_t_f180.vdb
$HYTHON scripts/vdb/authoring/sim/sim_clouds.py cumulus --hip cumulus.hip      # open the network in Houdini
```
Checkpoint VDBs and PNG previews (side view, centre slice, top view) go to `work/captures/scratch/p4f/` as
`<name><tag>_fNNN.vdb`. `--set section.parm=value` overrides any recipe value (`source.`, `solver.`, `remap.`).
Render with the flagship: `?cloud=heroes/sim-cumulus` / `heroes/sim-congestus`.

## Network (one geo, SOP level)

`volume x2 (density, temperature)` -> `merge` -> **volumewrangle `source_noise`** (the emitter) -> **pyrosolver** ->
`blast` (keep density) -> `convertvdb` -> **volumewrangle `remap`** -> [`vdbactivate` + **volumewrangle `stretch_y`**] -> `vdbsmooth`.

* **Sim scale.** The sim runs at 1 sim unit = 100 m (`world_scale`), the sim voxel is 0.08 units (= 8 m). Pyro's defaults
  are tuned for metre-size smoke; the converter's `--world-scale 100` restores real metres. Clouds are scale-invariant, so
  do not fight the solver at 700 m scale.
* **Emitter** (`source_noise`, VEX): a flat disc of radius R (units) and slab height H at y = 0. Its edge is wobbled by
  noise (`noiseamp`), and emission is multiplied by a thresholded noise field (`cellfreq`, `cell0`, `cell1`, `floor`) so
  only a few hot spots fire. Those hot spots become the separate thermals that make turrets. Density and temperature are
  emitted together; emission stops at `emit_frames`.
* **Solver** (real `pyrosolver` parm names): `buoyancylift` (rise speed), `tempcooling` and `dissipation` (how long a
  thermal keeps rising and how long the smoke lives), `turbulence`, `turbulence_swirlsize`, `disturbance`
  (billow and breakup). Temperature range is set to 0..1 (smoke style, not the fire default 300..3000).
* **Remap**: smoothstep of sim density `lo..hi` -> 0..1 (a soft shoulder for the cloud), then a fade-in above the base
  height (`base`, `basefade`, sim units) for the flat cloud floor.
* **Stretch**: `remap.stretch` k stretches the finished density vertically by k. A free plume is a cone, roughly as tall as
  it is wide; real towering cumulus is taller than wide. k = 1.7 for cumulus, 2.8 for congestus.

## Knobs that matter

| Knob | Effect |
| --- | --- |
| `source.radius` | Foot width. Wide (2.0) = cumulus humilis/mediocris; narrow (1.0) = tower. A wide slab alone will not rise as a column (pressure), hence the hot-spot noise. |
| `source.cellfreq`, `cell0/cell1` | Size and number of thermals. Higher freq = more, smaller. Higher thresholds = fewer. |
| `source.rate`, `source.emit_frames` | Mass supplied. More rate = denser, bigger cloud; stop emission earlier for a decaying cloud. |
| `solver.buoyancylift` | 6 (cumulus), 12 (congestus). Below ~4 the smoke stalls as a pancake. |
| `solver.turbulence`, `swirlsize`, `disturbance` | Higher = ragged, wispy, wider; lower = tight, smooth, narrower and taller. Cumulus 0.6/0.6/0.5; congestus 0.4/0.4/0.15. |
| `solver.dissipation`, `tempcooling` | Low values (0.005-0.03) keep the plume alive. High values (0.1/0.5, the Pyro defaults) killed it. |
| `remap.lo/hi` | Lower `lo` = fluffier and larger; narrower `hi-lo` = crisper edge. |
| `remap.stretch` | Aspect ratio of the cloud. Above ~3 the billows turn into vertical streaks. |
| frame | `--convert-frame N` picks a cached checkpoint; later = taller and more developed. |
| `divsize` | 0.08 (= 8 m). Finer (0.05) changed the dynamics (smaller, wispier cloud for the same params) and is not tuned. |

## Gotchas found

* Volume SOP `uniformsamples` menu index 5 is **By Size** (the same parm on the Cloud SOP uses 1).
* VEX `smooth(a, b, x)` with a > b returned 0, not the inverted ramp: write `1 - smooth(lo, hi, x)`.
* `@Frame` is undefined in volumewrangle; use the backtick expression `` `$FF` ``.
* `mix` does not exist in VEX, use `lerp`.
* Pyro Solver SOP needs no quick-setup: its default source multiparm (density Add, temperature Pull) already binds to volumes named `density` and `temperature` on input 1.
* Pyro's default dissipation and cooling kill the plume; defaults give a pancake, not a thermal.

## Size budget

`nvdf.bin` + `sdf.bin` are dense, 6 bytes per 8 m voxel; 4 MB is about 650 k voxels. sim-cumulus 85x92x62 = 2.7 MiB;
sim-congestus 82x76x101 = 3.6 MiB. A taller or wider cloud needs `--voxel-size 12` or a lower `world_scale`.

## The library (P9-F): `library.py`

One unattended run grows the whole authored library into `assets/clouds/library/<name>/` (cloud.json, nvdf.bin, sdf.bin,
manifest.json) plus `index.json`, about 6 min for 17 clouds, logged to `work/captures/scratch/p9f/library.log` (or `--log`).
The run is deterministic (same seeds, byte-identical output).

```bash
$HYTHON scripts/vdb/authoring/sim/library.py                     # everything
$HYTHON scripts/vdb/authoring/sim/library.py fractus pileus-tower   # some
$HYTHON scripts/vdb/authoring/sim/library.py --list | --reindex     # list entries | refresh stamp hints + index.json, no sims
python3 scripts/vdb/authoring/sim/contact_sheet.py DIR OUT.jpg     # tile the library page's sheet-mode captures
```

Each `LIBRARY` entry names a template (`cumulus`/`congestus`: the P4-F recipes with a 20 m base fade; `strato`: wide, low,
capped) and overrides it per section. Levers added to `sim_clouds.py` for it:

| Key | Effect |
| --- | --- |
| `seed` | shifts every emitter noise lookup and Pyro's `turbulence_seed` |
| `source.emitters` | list of `[x, z, rx, rz, weight, start_frame]` noisy elliptical discs (count, shape, size, age) |
| `solver.enable_wind`, `wind_strength`, `wind_directionx` | Pyro wind during the sim: the plume bends downwind (lean) |
| `cap` (`height`, `thick`, `strength`, `reach`) | inversion lid: a cold slab added to temperature (Pyro source 3, Add) so thermals stall and spread; flat tops, stratocumulus |
| `remap.shear` | post lean: x shifts by `shear` per unit height |
| `remap.flat`, `flatk` | post flattening: everything above `flat` is squashed by `flatk` |
| `pileus` (`gap`, `rx`, `ry`, `thick`, `density`) | a smooth dome shell placed over the tower top (T6 cap) |
| `prune` | drop detached blobs smaller than this fraction of the main body (numpy labelling, default 0.04 in the library) |
| `voxel` | converter voxel size (12 m for the wide slabs) |
| `stamp` | page hints: `detailType`, `densityScale`, `scale` range, deal `weight` |

The manifest records species, size, base/top (metres above the asset box floor), seed, frame, sim seconds, bytes and the full
recipe. `examples/lab/library/` stamps the library (see its header for query options; `?sheet=1` is the isolated contact-sheet mode).

## Target-driven recipes (L1): `targets.py`

**Buoyancy was off in every recipe above (found in L1).** Inside the Pyro Solver SOP the gasbuoyancy lift is
`-buoyancylift * (temperature1 - temperature0) / temperature0 * gravaccel`, and the P4-F/P9-F recipes set `temperature0 = 0`: a
division by zero, so buoyancy did nothing (identical sims at `buoyancylift` 12 and 60, and with buoyancy disabled; with turbulence and
disturbance off nothing moves at all). Those plumes spread by turbulence alone, and their height came from `remap.stretch`, hence the
flame streaks and mounds. `targets.py` uses `temperature0 = 1, temperature1 = 2`: then `buoyancylift` 0.3-0.8 grows a real rising
tower with round domes in 150-210 frames, no stretch needed. The "Knobs that matter" table above describes the old, buoyancy-less
behaviour; regrowing the library with working buoyancy is a follow-up.

Also: the inversion lid (`cap`) is *added* to temperature every frame, so it settles near `-strength / tempcooling` (0.15 gave about
-11, a hard ceiling). Useful values are 0.005-0.025.

```bash
$HYTHON scripts/vdb/authoring/sim/targets.py texas-tower                      # 20-variant sweep -> assets/clouds/local/texas-tower/ (gitignored)
$HYTHON scripts/vdb/authoring/sim/targets.py texas-tower --refine v05,v11 --n 10 --round r2    # children of the best-ranked
$HYTHON scripts/vdb/authoring/sim/targets.py texas-tower --only v00 --tag _t --set emit.1.heat=0.4 --set cap.strength=0.01
python3 scripts/targets/match.py texas-tower      # render every candidate x 4 yaws on examples/lab/target/, score, rank, top-5 sheet
python3 scripts/targets/promote.py texas-tower v05 r2_03 ...    # copy picks to assets/clouds/targets/texas-tower/
```

New levers in `sim_clouds.py`:

| Key | Effect |
| --- | --- |
| emitter `heat` (7th element) | scales the emitter's temperature only (weight scales density and temperature): a hot core tower on a warm, lazier pedestal |
| `remap.stretch_from` | no vertical stretch below this output height, so a pedestal keeps its aspect while the tower above is stretched |
| `remap.taper`, `taper_y0/y1`, `taper_x/z` | horizontal scale `1 - taper * smooth(y0, y1, y)` about the axis: a tower narrowing toward its crown |
| `--set emit.I.FIELD=V` (targets.py) | edit one emitter (x z rx rz weight start heat) from the command line |
