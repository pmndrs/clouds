# ST2: smooth anvil for the map storm, map is the default source, rotation rings

Branch `worktree-agent-aeaece9e4ab7f523b`. Sheet: `work/captures/ST2/ST2-sheet.jpg` (columns: F1 cell / STORM1 map storm / ST2 map storm; rows: storm view,
horizon, from 9 km, from 18 km). Rotation: `work/captures/ST2/ST2-rotation.jpg`. Singles in `final/` and `rotation/`.

## 1. Anvil shape (new default `hzd.stormAnvilShape 'smooth'`, old kept as `'taps'`)

- Footprint = a blurred dilation: the mean of the storm channel over an elliptical kernel (centre and 3 rings of 6/12/18 taps, 37 reads) centred downwind
  and growing with `anvilShear` / `anvilSpread`, normalised so a plate interior reads 1 and the rim is a soft ramp. The first version (a Vogel disc, then 2 rings)
  showed each tap as its own lobe; 3 rings of 8/16/24 (49 taps) gave the same outline as 6/12/18, so 37 it is. It only runs above h 0.77 (the plate band).
- The plate is a lens: its underside rises toward the footprint edge (an overhanging, thinning rim, not a wall); the shape noise is suppressed more on it.
- The default blob's outline wobble is gentler (0.45 at 24 cells to 0.2 at 12: `ndf.wgsl.ts`), the plate dilates that outline.
- Anvil cirrus (`hzdAnvilCirrus`): the gate is the same smooth dilation reaching `anvilCirrusLength` further downwind; the noise is lower frequency (3.6 km tile,
  fibres stretched `anvilCirrusFiber`:1 along the wind, plus a fine octave) and modulates a continuous sheet (30 to 100 %) instead of a threshold that tore it into
  patches. Reads as fibrous sheets fanning downwind. Extinction is very sensitive: the preset is now `anvilCirrus 0.00006` (was 0.008, which is solid white).

## 2. Default

`hzd.stormSource` is now `'map'` (cell kept). Judged from the storm view, horizon and 9/18 km: better than STORM1's map storm (clean smooth plate, a fibrous cirrus, no lumps),
**just different from the F1 cell, not clearly better**: the cell is a flatter, wider ellipse with a bright cauliflower rim; the ST2 plate is rounder and more cumulus-shaped
(a few large scallops at the outline), its top is smoother with less rim texture, and with the preset lighting (dark 0.7, density 1.6) it reads flat blue. The cirrus makes it read more
as an anvil. Storms are still off by default (`stormStrength 0`), so no existing sky changes; links that set only `hz_stormStrength` now get the map storm (A9 flips it back).

## 3. Rotation (`hzd.stormRotation`, deg/s of the inner ring, 0 = off, default off)

Six nested rings about the storm centre out to 1.6 x the storm radius, a static seventh outside; ring speed x0.6 per ring, a per-ring skew (0.12 rad), ring overlap (the last 22 % of a ring) reads the
detail noise at both rotations and lerps. Applies to the detail noise (HZD and Nubis Cubed branches). The phase is `time x stormRotation`, written per frame into `hzStorm5.w` (not part of the model version).

**Off by default.** It works (a swirled, banded column), but (a) cost about +3.6 ms over the smooth storm (min of 3, 1280x720: off 12.2, storm 20.9, storm + rotation 24.5), and (b) the sky's temporal
blend smears the moving detail: even 1 deg/s (26 m/s at the middle ring) turns the column's crisp detail soft, 25 deg/s is smoother still. NE fixes this with per-pixel motion vectors (reproject
with the same rotation, HFW p.63-70); the sky layer has none. Needs that before it can be on.

## Settings / Review

- New: `hzd.stormAnvilShape` (`smooth` default, `taps`), `hzd.stormRotation` (0). Both in the tune panel group "Storms and anvils". `hzd.stormSource` default now `map`.
- Review: A9 updated (map is the new default), `ST2a` anvil plate (taps/smooth), `ST2` rotation (off / 1 / 10 deg/s). Storm preset (`storm=1`): `anvilCirrus` 0.00006.

## Cost (sky layer ms, ultra 1920x1080, storm view, min of 3, shared GPU so noisy)

storm off 22.6 / F1 cell 36.8 / map `taps` 35.3 / map `smooth` 40.7 (about +5 over taps, +18 over no storm; measured before the h 0.77 gate, whose re-measure was lost in GPU noise from other agents: 52, 62, 67 vs off 26, 47, 36). At 1280x720: off 12.2, taps 18.2, smooth 20.9, smooth + rotation 24.5.
Dominant cost is still the 10 km storm shell; the smooth footprint's 37 reads are the new part. Fix for the perf pass: bake the footprint (and the cirrus gate) into a coarse map texture
once per weather/wind change instead of per sample.

## Verified / left

- `pnpm typecheck` passes; `pnpm test`: 318 pass, the Disney VDB test (`import/fine.test.ts`) times out under shared load, also alone (unrelated code).
- Not done: motion vectors for rotation (above); the cell's textured bright rim has no equivalent on the plate; plate outline still has large scallops; storm darkness/flat lighting is D1's problem;
  the painter UI was not driven. Dev note: CLOUDS_NO_WATCH means restart vite after every shader edit; the first headless load compiles slowly, wait for `skyLayer` in the report before judging a capture.
- A stray untracked `work/captures/CI1/` appeared in this worktree (another agent's script shared `/private/tmp/claude-502/`); not committed, safe to delete.
