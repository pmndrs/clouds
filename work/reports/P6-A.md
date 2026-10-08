# P6-A Realtime cloud evolution
Status: ready for review
Changed: `packages/runtime/src/generate/{evolution.ts (new),weather.ts,shaders.ts (WEATHER_WGSL only),index.ts}`, `packages/runtime/src/runtime.ts` (two additive hooks), `examples/lab/evolve/main.ts`.
Verified:
- `pnpm check` green. Captures: `work/captures/P6-A/t{0,30,60,90,120}/{above,ground}.jpg` (time-lapse, x10), `play/capture.json`, `swap/` (frames 159-165 around a swap + capture.json with diff numbers).
- Time-lapse read: cells appear, grow, merge and vanish between t=0/30/60/90/120 (ground and above); field stays populated.
Design:
- Weather is a function of time (`encodeProceduralWeatherMap({evolve:{time,lifeSeconds,advection,drift}})`): each Worley cell has its own life cycle (0.6-1.4x of `lifeSeconds`, default 600 s; grow 22%, mature to 66%, dissipate), restarting with new jitter/strength/radius while its envelope is 0 (no pop); pattern advected by wind; fBm layer drifts. Without `evolve` the map is unchanged.
- `createEvolvingCloudscape` (`generate/evolution.ts`): two volumes + shared scratch (226 MB at 512x512x64), regenerates every `cadence` s (default 1.5) amortized over `cadence*0.8` s (~1.3 jobs/frame), back volume swapped when complete. Weather is generated for the predicted swap time.
- Wind advection is not baked per swap: pattern and billow noise are generated at a voxel-snapped offset A, and the box is translated by `wind*t - A` every frame, so clouds move smoothly across swaps.
- Runtime hooks (additive, `runtime.ts`): `swapVolume(volume,{position})` (same-shape caller-owned volume: rebinds, keeps temporal history and light grid, invalidates grid into its amortized slices; returns false otherwise) and `setVolumePosition(pos)` (uniform write). Positions are min-corner (the three adapter's setVolume takes the centre). No sampler blend was needed.
Measures (1920x1080, Apple Metal, timeScale 10, sim 1 min = 6 s):
- No pop: mean |d| per frame (320x180, 0-255). Noise floor median 0.18, p95 0.42 (includes wind drift). Swap frame 0.8-1.4, next frames 0.6,0.6,0.4 (temporal 1/4 catch-up; slight edge stipple for ~4 frames at x10). Same page, cadence 3: 1.3-2.5. x1: swap 0.24 vs floor 0.03; x3: 0.47. Old path (`?inplace=0`, setVolume per swap): 10-15 (temporal reset). Pop scales with cadence*timeScale; use cadence 1 for faster time-lapses (swap 0.7-0.96 at x10).
- Cost: generation GPU one-shot ~17-20 ms (P5-A) = ~0.2 ms/frame average at 60 fps; worst frame one 0.65 ms job. In-frame timestamp sum of generation passes (inflated by overlap with rendering) averages 0.82 ms per active frame, p95 2.9 ms; CPU encode+submit worst 0.3 ms. Light grid at swap frame 0.94 ms mean (max 3.8) vs 0.72 other frames (old setVolume path: 3.4 ms, plus temporal reset). Total added <= ~1 ms by the conservative sum: PASS (borderline by that measure, ~0.3 ms by the isolated one).
- Play mode (2374 frames, 26 swaps): p50 16.7, p95 16.7, max 16.8 ms, 0 frames > 25 ms: PASS (vsync-bound; headless cannot show sub-vsync headroom).
Open issues:
- Swap changes are not cross-faded: pop depends on cadence*timeScale (negligible at <=x3). A generator-side morph (lerp NVDF/SDF into a third volume in sub-steps; lerp of SDFs stays 1-Lipschitz) would reduce it further for x10+, at +100 MB and ~1.5 ms spikes per sub-step.
- Weather of the evolving field is a different recipe than the static preset (cell strength tuned to similar coverage); box border fades coverage 6%.
- Pages: `?timeScale= ?t= ?step=1 ?play=1 ?cadence= ?share= ?diff=1 ?dumpFrames=1 ?evolve=0 ?inplace=0 ?bookmark=ground|above|horizon|top`.
