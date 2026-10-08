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
