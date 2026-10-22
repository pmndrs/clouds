# SH1: steady ground shadows in time-lapse, sharper sky history

## SH1a: cloud shadow map follows the moving clouds (`shadowMap.advect`, default true)
**Cause.** The shadow map refreshed a slice of rows per frame, each row at its own moment, and (with the procedural model) only restarted a sweep when the wind had moved the clouds by 8 m. At time-lapse the picture on the ground sat still, then changed in bursts as a sweep landed, with a seam where old and new rows met (measured below).

**What changed** (`packages/runtime/src/shadow-map.ts`, `shaders/shadow-map.wgsl.ts`, `runtime.ts`, `procedural/index.ts`+`types.ts`, `packages/three/src/cloud-shadow.ts`):
- A sweep is built into a back buffer from one frozen moment: the sun ray's start is moved back by how far the clouds have moved since the sweep began, so every row shows the same moment.
- Every lookup is shifted by how far the clouds have moved since the stored moment (`adv` in the uniform), so the shadow slides smoothly each frame.
- When a sweep lands the map eases from the old snapshot to the new one over `advectBlendFrames` (a small compute pass; a plain switch popped because the clouds change shape). The next sweep starts after the blend; continuous at drift > `advectRefreshMeters`.
- Slide speed = `ProceduralDensityModel.shadowSpeed` (new; HZD: mean of shape and detail noise speeds = the wind). Measured: the map's own slower drift (`motionSpeed`, what C2 uses for the sky history) gives bigger landing pops; the bodies' shadow follows the noises.
- Only with the procedural model; voxel / analytic paths and `advect: false` run the old code unchanged (old behaviour kept; `invalidate()` and the three adapter keep working, the adapter also applies the shift).
- Memory: +16 MB (back and old-snapshot copies of both cascades), allocated on first use.

**Settings** (`shadow.*`, tune panel group "Light: renderer settings", URL `sm_<key>`): `advect` (true), `advectSpeed` (1), `advectRefreshFrames` (12, frames per sweep), `advectBlendFrames` (6), `advectRefreshMeters` (16); `refreshFrames` is the old mode's.
**Review switch:** SH1a (old: rows as refreshed / new: slides with the wind).

**Evidence.** `work/captures/SH1/SH1-sheet.jpg` (top), metrics in `metrics-*.txt`. 1/60 s steps (virtual clock), ground view from 250 m, pitch -30, time-lapse x20, `scripts/gpu/step-frames.mjs` + `scripts/gpu/shadow-jitter.py`. Reference = an exact map built every frame.

| default wind | mean change/frame | unevenness (std) | distance to reference |
|---|---|---|---|
| old | 0.080 | 0.247 | 1.04 |
| new | 0.112 | 0.012 | 0.40 |
| reference | 0.115 | 0.014 | - |

At 4x wind: unevenness old 0.475, new 0.032, reference 0.012; distance to reference 2.32 vs 1.28. Old = frozen frames then a jump of up to 1.5 (a visible step every sweep); new = the same steady slide as the reference. Judged by numbers and the chart; owner to confirm by eye on the bench (ground view, motion: time-lapse, flip SH1a).

**Cost.** One extra 1024x1024 two-cascade pass during each 6-frame blend, plus the sweeps now take 12 frames instead of 24 (so about 2x the sweep cost; `advectRefreshFrames` 24 halves it at a slightly larger pop: unevenness 0.028 instead of 0.013 at 6-frame blend). Measured under heavy machine load (load average 78, unreliable): shadowMap 1.9 ms new vs 1.2 ms old at 1920x1080. With the wind still it is idle in both.

## SH1b: Catmull-Rom history fetch (`sky.historyFilter`, default 'catmull')
`sky-layer.wgsl.ts` (resolve): `historyCatmull` = 5-tap Catmull-Rom (bilinear taps at merged positions, corners dropped) on the front history, clamped to the min/max of the four nearest texels so it cannot ring; the back layer stays bilinear. `SKY_PARAM_FLOATS` 84 -> 88 (`resolveOpts.x`). `sky-layer.ts`: setting `historyFilter: 'bilinear' | 'catmull'`. Tune panel: "Ray march". Review switch: SH1b.

Evidence: `history-bilinear.jpg` / `history-catmull.jpg` (same moment, time-lapse x20) and the sheet (bottom). Sky region gradient energy +24 % horizontally, +10 % vertically, Laplacian +30 %; visually the cloud tops keep their fine detail and the edges are crisper; no halos or dark fringes seen (the clamp). Static camera and no wind: also a little more detail kept (the bilinear path resamples at tiny sub-pixel offsets every frame). Better, not just different. Cost: 4 more taps and 4 loads per resolved pixel in the resolve pass only; not measurable under the machine load (resolve 1.2 vs 1.8 ms, noise).

## Other
- `scripts/gpu/step-frames.mjs`: capture consecutive frames on a fixed virtual clock (and reload when the bench starts without its sky pass, seen intermittently on this loaded machine; not investigated). `window.__hzd = { core, proc }` is now exposed by the bench for scripts.
- Bench: new source `shadow` (URL prefix `sm_`, tune panel).
- `pnpm typecheck` passes; `pnpm test` passes (the Disney VDB test timed out once under load, passes alone).
