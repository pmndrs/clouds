# PF1: clean timing of the HZD sky, and empty-space skipping from the weather map

Branch `worktree-agent-a4c8c7cfc0e6d3edc`. Review switch **PF1** (skip off / exact / free).

## Verdict
- **The skip is exact and safe, and it is neutral on the default weather map.** `exact` gives the same image as `off`, pixel for pixel (max difference 0, in 6 views and 13 stress variants, see below). On the default map it does not save time: that map has some coverage in 97 % of its cells, so only 105 of 4096 cells can be skipped. On a map with real clear lanes (ndf gate raised) it saves 10-20 % of the sky pass from the ground and the high view.
- **`exact` is the new default** (it cannot change the look and was never slower beyond noise). `off` stays selectable.
- **The big costs are elsewhere** (table 1): the veil, the detail noise and the light taps, not clear air. See "Where the time is".

## 1. Timing breakdown (HZD sky, ultra, 1920x1080, one change at a time)
Headless Chrome 155 on Apple Metal, vsync and frame limit off. "Frame ms" = GPU-bound frame time from requestAnimationFrame (3 reps x 3 windows of 100 frames, median; **best window in brackets**). "Sky ms" = the sky-layer pass from the GPU timer (median; min in brackets). The machine was shared with other agents (load average 5-20 during this run; it was 30-160 in my first attempts, which I threw away), so read differences under about 10 % as noise, and the best-window figure as the cleaner one. Raw: `work/captures/PF1/timing2.json`, configs in `configs.json`, script `scripts/gpu/bench-sweep.mjs`.

Frame ms (best window):

| config | gp7 | ground | horizon | high |
|---|---|---|---|---|
| base (skip off) | 25.4 (19.7) | 25.1 (20.8) | 20.7 (18.4) | 24.4 (18.3) |
| veil off | 25.7 (17.1) | 16.8 (14.0) | 13.8 (12.7) | 21.1 (12.8) |
| detail noise off (stage 2) | 21.1 (16.5) | 15.1 (13.2) | 13.2 (12.1) | 20.6 (12.4) |
| cirrus on | 25.9 (20.7) | 25.6 (21.6) | 21.9 (19.9) | 25.1 (20.1) |
| light taps 3 (default 6) | 26.7 (22.3) | 24.0 (19.8) | 20.3 (18.3) | 24.0 (18.5) |
| light taps 1 | 24.9 (20.5) | 20.8 (16.8) | 16.8 (15.7) | 22.1 (15.0) |
| mid altocumulus on | 28.5 (22.7) | 28.7 (23.4) | 23.6 (21.4) | 27.8 (21.1) |
| deck stratus on | 30.1 (9.5) | 8.0 (7.5) | 5.6 (5.4) | 28.1 (27.6) |
| base again | 28.3 (24.8) | 25.1 (20.8) | 21.1 (19.8) | 24.3 (16.5) |

Sky-layer ms (median, min):

| config | gp7 | ground | horizon | high |
|---|---|---|---|---|
| base (skip off) | 23.5 (21.5) | 20.9 (18.4) | 18.6 (17.5) | 23.2 (17.2) |
| veil off | 23.5 (15.9) | 16.2 (12.2) | 12.1 (10.8) | 11.8 (10.6) |
| detail noise off (stage 2) | 19.0 (14.8) | 14.8 (11.9) | 11.3 (10.4) | 19.2 (10.5) |
| cirrus on | 18.8 (18.3) | 24.1 (19.5) | 20.4 (18.6) | 24.4 (17.8) |
| light taps 3 | 24.4 (23.3) | 19.6 (17.8) | 18.7 (16.4) | 23.3 (16.4) |
| light taps 1 | 23.2 (18.2) | 18.6 (15.5) | 15.1 (13.8) | 20.9 (13.9) |
| mid altocumulus on | 21.9 (20.5) | 26.9 (20.7) | 21.7 (19.2) | 20.4 (19.1) |
| deck stratus on | 27.9 (9.0) | 6.9 (6.4) | 6.1 (3.8) | 25.9 (3.8) |
| base again | 26.7 (24.0) | 23.4 (17.9) | 19.3 (17.9) | 18.5 (17.7) |

### Where the time is (best-window reading)
- **Veil: the biggest single item.** Off saves about 6-8 ms of 18-21 from the ground, horizon and high views (30-40 %); gp7 shows it only in the best window (noisy).
- **Detail noise (stage 2 = no erosion): similar, 4-8 ms** (about 25-35 %).
- **Light taps:** 6 to 3 saves 0-1 ms, 6 to 1 saves 2-4 ms. Lighting is not the cost, as the audit found.
- **Cirrus (the 2.5D layer) on:** within noise, about +0.5 ms.
- **Mid altocumulus (volume, hybrid) on:** about +2-3 ms.
- **Deck stratus on is faster, not a saving:** the low deck turns rays opaque at once, so they stop early (frame 8 ms vs 25 from the ground). Ignore as a cost figure.
- Sky layer is about 85-95 % of the frame in every row (frame ms vs sky ms), so the sky pass is the frame.
- The table does not split shape noise from lighting inside a sample; that needs a debug build (not done).

## 2. Weather-map empty-space skipping
**What it does.** A compute pass (`procedural/hzd/bounds.ts`, about 0.05 ms: one read of the map; not timed separately) turns the served NDF (generated, painted, uploaded or a weather-state lerp) into a 64x64 grid over the map tile: per cell the largest coverage and the lowest base and highest top height of the cell's texels plus their bilinear neighbours plus one texel of slack, plus the fractus trail when fractus is on. The grid lives in the profile-table storage buffer after the tables (no new binding; the trace pass is already at the 16-texture limit). The model remakes it when the map changes (generation, setNdf, paint images, every weather recompose) and when emptySkip or the fractus trail changes.

In the trace (`procedural/trace.wgsl.ts`, `hzd/shaper.wgsl.ts procCellIsEmpty`), during the coarse march only, a stretch of ray inside a cell is skipped when the main layer cannot be there: the cell has no coverage (with the horizon ring's coverage target counted from ringStart out, and the coverage bias), or the stretch's altitudes (with the planet's curvature) are all above the cell's highest top or below its lowest base; and no other contributor can be: the mid and deck sheets (by altitude band and the mid slot's volume share), fractus (band and trail), storms (any placed or painted storm turns the skip off for that frame; type storms raise the top bound). Any doubt returns "not empty".

**Skipping mode 'exact'** walks the same coarse strides without sampling them and charges them to the step budget, so the samples after the cell and the budget are exactly the unskipped march's. That is why the image is identical. Sky Pro's existing bounds path keeps its old jump (the hooks `procBoundsCell` / `procBoundsMode` / `procCellIsEmpty(…, data)` are shared; Sky Pro behaves as before).

**Settings** (tune panel group "Ray march"):
- `hzd.emptySkip`: `off` | `exact` (new default) | `free`.
- `hzd.emptySkipCoverage` (default 0): cells with largest coverage at or below this count as empty. 0 = exact; above 0 is lossy.
- Test hook `sky.freezeCycle` (default -1, tune group "Debug"): fixes the temporal frame phase so two renders can be compared pixel for pixel.

**Mode 'free'** does not charge the skipped strides to `maxSteps`. It is faster than exact where there are long clear stretches, and it **reveals far cloud the old march never reached**: from the "above" view on the sparse map a band of horizon clouds appears that the 256-step budget cut off (`sheet.jpg`, bottom row). On the default map it changes 1365 pixels in "high" and 550 in "above". That is a look change (more distant cloud, in line with the papers' "the horizon needs more samples"), not an equality, so it is not the default.

### Exactness check (max pixel difference, off vs exact)
Deterministic renders (sky.temporal off, clouds frozen, `sky.freezeCycle` 5), 1920x1080 PNG, picture area without the sidebar and HUD. Full numbers: `work/captures/PF1/diff-stats.txt`; sheet: `work/captures/PF1/sheet.jpg`.
- Default map, views gp7, ground, horizon, high, above, sunset: **max difference 0** in every view.
- Default map plus fractus on, mid altocumulus (volume) plus deck stratus on, ring off, storm on (map), coverage bias -0.1 / type bias 0.2, coverage bias 0.15: **0** in gp7, horizon, high, above.
- A **sparse map** (ndf gateLo 0.05, gateHi 0.25: many cells skippable) with the same variants and type storms: **0**.
- The determinism floor: the first shot of a page can differ from later ones by up to 11 levels on the ground (cloud-shadow slices still converging); I compared later shots only.
- Lossy `emptySkipCoverage` on the sparse map: 0.1 gives 0 (no visible difference); 0.2 gives at most 3 levels in 13-17 pixels per view.

### Timing after (skip off vs exact vs free), three independent runs, frame ms (best window)
Default map (`timing2.json`, and again in `timing-lossy.json`): off 25.4 (19.7) / 26.3 (18.0) at gp7, exact 26.0 (24.9) / 26.8 (22.2): **no change** in any of the four views (ground 25.1 vs 24.9, horizon 20.7 vs 21.2, high 24.4 vs 24.4). Free: 26.5, 26.3, 22.5, 24.9 (gp7, ground, horizon, high): not faster, since it also marches further. emptySkipCoverage 0.1, 0.2, 0.3 on the default map: also within noise (24.9-25.2 vs 26.3 at gp7; ground 23.5-24.7 vs 22.9).

Sparse map (`timing-sparse.json`), frame ms median (best window):

| config | gp7 | ground | horizon | high |
|---|---|---|---|---|
| skip off | 22.2 (20.1) | 21.8 (18.6) | 17.1 (15.7) | 20.9 (17.8) |
| skip exact | 22.1 (16.4) | 19.4 (17.1) | 16.8 (16.2) | 16.6 (16.1) |
| skip free | 19.7 (15.5) | 19.4 (17.0) | 17.2 (16.4) | 17.3 (16.4) |
| skip off again | 21.8 (17.2) | 21.7 (18.2) | 18.3 (16.7) | 20.7 (16.9) |

Exact saves about 11 % from the ground and 20 % from the high view on the sparse map, nothing at gp7 and horizon (rays there run through the ring's far field, coverage 0.3 from 15 km, which cannot be skipped).

## Why it is neutral on the default map, and what would help
The grid can only skip air where the map has no coverage (or the height is out of range). The default map has coverage in 97 % of its cells (largest per-cell coverage: 10 % of cells under 0.1, 18 % under 0.2, most between 0.3 and 0.6), and the horizon ring puts 0.3 coverage everywhere beyond 15 km. The air inside cloudy cells (coverage above 0 but no cloud at the sample) is where the coarse march still pays: each such sample reads the shape noise (tricubic, 8 taps within 30 km). A conservative bound for it needs the noise's own maximum: a 3D max-mip of the base shape (Perlin-Worley dilated by the Worley fBM) combined with the height gradient, so `base_max x gradient_max < 1 - coverage` skips it. The shape noise scrolls with the wind but is a fixed volume, so that bound is a one-time bake per noise set. This is the next skipping step (not done; larger than this task). Other candidates from the audit (far-cell cheap read, 2.5D far layers) are unchanged.

## Files
- `packages/runtime/src/procedural/hzd/bounds.ts` (+ `bounds.test.ts`): the pass and a CPU mirror for tests.
- `packages/runtime/src/procedural/hzd/shaper.wgsl.ts`: bounds grid in the table buffer (COPY_SRC added for the debug readback), `procBoundsCell`, `procCellIsEmpty`.
- `packages/runtime/src/procedural/trace.wgsl.ts`, `density.wgsl.ts`: shared hooks, exact walk; Sky Pro keeps its jump.
- `packages/runtime/src/procedural/index.ts`: when to remake the grid, `readHzdBounds()` debug readback.
- `packages/runtime/src/procedural/settings.ts`: `emptySkip`, `emptySkipCoverage` (packed in hzMix.w, hzStorm5.z).
- `packages/runtime/src/sky-layer.ts`: `freezeCycle`.
- Bench: `examples/lab/hzd/app/Review.tsx` (PF1 item), `tune.ts` (Ray march and Debug groups), `sky/SkyHost.tsx` (`gpuLast` in the capture report, `window.__proc` debug hook).
- Scripts: `scripts/gpu/bench-sweep.mjs` (timing), `bench-shots.mjs` (deterministic screenshots from one page load, waits for the sky pipeline), `diff-pngs.py`.

## Notes for the next person
- The bench's GPU-timer rolling mean (HUD, capture.json) lags and mixes configs; for A/B work use `bench-sweep.mjs` (frame windows) and compare interleaved runs. Under heavy load (other agents' Chromes) the same pass read 20-50 ms; I discarded those runs.
- `apply()` of the tuner resets tuned settings to the code defaults, so URL overrides (motion, sky_temporal) are lost; pass them with `--base`.
- A dev server started with `CLOUDS_NO_WATCH=1` does not pick up file edits: restart it after editing.
- `pnpm typecheck` and `pnpm test` pass (323 tests; the Disney VDB test passed when the machine was quiet).
