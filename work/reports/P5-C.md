# P5-C Tiers that scale, auto tier, dynamic resolution, composite and memory
Status: ready for review (composite, memory, auto pass; low passes on average, mobile is 25-33% of high, not a clean 25%)
Changed: `packages/runtime/src/{runtime.ts,index.ts,shaders/{composite,temporal,march,frame}.wgsl.ts}`; new `auto-quality.ts` (+ tests), `runtime-presets.test.ts`; `packages/three/src/{clouds,index}.ts`; `examples/lab/flagship/{main,three-bridge}.ts`. (`runtime/src/index.ts` was not on my list; it only gained exports.)
Verified:
- `pnpm check` green (205 tests, 19 new); density parity page `pass: true` (`captures/P5-C/density`).
- A/B high (2560x1440, HUD masked, mean |d| 0..255): before-a vs before-b noise ground 0.00 / edge 0.02 / inside 0.24. before vs after: **0.19 / 0.06 / 0.29** (`after-a`, `after-b`; difference only on cloud edges, p99 4.7). That is with `high` retuned to near 0.28 / far 0.41 (was 0.33 / 0.5) to reach the memory target; with the old scales the diff was 0.04 / 0.02 / 0.28 (= noise) but memory was 35.7 MB.
- adapter page `three-adapter` with quality high/low/mobile/auto: no GPU errors, composite upsample path OK.
- captures `work/captures/P5-C/`: `before-{a,b}`, `after-{a,b}` (flagship 1440p), `tier-{ultra,medium,low,mobile}` (1080p ground+inside), `auto-<bookmark>-b<budget>` (convergence traces in `capture.json` `trace`).
Method (read first): the standard harness is vsync-locked, so the GPU idles at low clocks and small passes read 2-4x slower and 30% noisy (the same code gave 1.46-2.1 ms in 4 runs). Tier tables are therefore from Chrome with `--disable-gpu-vsync --disable-frame-rate-limit` (my copy of capture.mjs, not committed), 1500-2500 frames settle (the camera rig is time-based), per-pass median of 150 frames, min of 2 interleaved runs, spread under 5%. Sum = march + resolve + composite + dome (light grid excluded: sun-driven, amortized). Idle-clock numbers for flagship high are in "Composite".

## Composite (target <= 0.5 ms at 1440p high): PASS
0.77 / 0.66 / 0.87 ms (ground / edge / inside) before; now 0.40 / 0.52 / 0.44 idle-clock (min of 3), 0.12 / 0.15 / 0.19 full-clock. Cause: 8-16 dependent loads per pixel. Now the depth words are log-coded (below) and compared as codes; one `textureGather` of the four taps' words, and when none is skipped or replaced (nearly every pixel) one hardware bilinear sample of the colour; the old per-tap loop only for the rest. Near upsample is skipped when the near pass is off, depth reads follow the composite scale. Not done: merging resolve into composite (separate passes stay, 0.03-0.06 each).

## Memory (target <= 25 MB history at 1440p high): PASS with a preset change
History = 2 x (rgba16f colour + one r32uint word holding mean distance 11 bit, march end 11 bit, scene distance 10 bit, log-coded) per pass; the trace is compact (k=4: 1/4 size, k=2: 1/2) and r32float; cut frames march straight into the history (no full-size trace, no resolve). 63.5 MB -> 35.7 MB (same scales) -> **24.5 MB** with high = 0.28 / 0.41. A fixed 12 B/px x 2 is the floor of this design (no core 2-byte storage format). Totals, MB (from `estimateCloudMemory`, light grid for a 512x512x64 volume at the default, divisor 2 = 6.3 MB; sky layer targets are allocated while off):

| 2560x1440 | history+trace | sky | output | dome | light grid | total |
| --- | --- | --- | --- | --- | --- | --- |
| ultra | 71.9 | 5.5 | 29.5 | 0.5 | 50.3 | 157.8 |
| high | 24.5 | 5.5 | 29.5 | 0.5 | 50.3 | 110.4 |
| medium | 22.1 | 5.5 | 29.5 | 0.5 | 50.3 | 108.0 |
| low | 10.0 | 3.5 | 7.4 | 0.1 | 6.3 | 27.3 |
| mobile | 2.2 | 1.4 | 7.4 | 0 | 6.3 | 17.3 |

At 1280x720: history+trace ultra 18.0, high 6.1, medium 5.5, low 2.5, mobile 0.6 MB (totals 77.6 / 65.7 / 65.1 / 11.6 / 9.1). `runtime.memory` reports live numbers. The light grid (50 MB for generated 512x512x64) is now the biggest item above low; not changed at medium/high.

## Tiers and cost (full-clock GPU ms, 2560x1440)
New levers (presets): near/far scale, near pass off (mobile: split 0), far limit (mobile 6 km), step scale, micro-shadow, detail distance, composite scale (0.5 at low/mobile, shown to need integer ratios), light-grid divisor, dome size/steps/enabled, sky-layer scale. `settings.renderScale` is the dynamic scale (sub-rectangle of the tier-sized textures: no realloc, no history cut; history is reprojected across the size change).

| view | ultra | high | medium | low | mobile | low/high | mobile/high |
| --- | --- | --- | --- | --- | --- | --- | --- |
| flagship ground | 0.88 | 0.45 | 0.40 | 0.25 | 0.15 | 56% | 33% |
| flagship edge | 0.95 | 0.59 | 0.48 | 0.31 | 0.19 | 53% | 32% |
| flagship inside | 6.04 | 1.12 | 0.91 | 0.48 | 0.28 | 43% | 25% |
| open-water horizon | 3.37 | 1.39 | 1.07 | 0.59 | 0.40 | 42% | 29% |
| open-water flight | 4.25 | 1.33 | 1.05 | 0.59 | 0.42 | 44% | 32% |
| plains t0 | 3.56 | 0.94 | 0.77 | 0.44 | 0.24 | 47% | 26% |
| plains t15 | 5.62 | 1.40 | 1.08 | 0.54 | 0.28 | 39% | 20% |
| plains t30 | 6.25 | 1.53 | 1.21 | 0.61 | 0.32 | 40% | 21% |

1280x720:

| view | ultra | high | medium | low | mobile | low/high | mobile/high |
| --- | --- | --- | --- | --- | --- | --- | --- |
| flagship ground | 0.27 | 0.21 | 0.18 | 0.13 | 0.09 | 62% | 43% |
| flagship edge | 0.40 | 0.27 | 0.23 | 0.18 | 0.12 | 67% | 44% |
| flagship inside | 1.97 | 0.43 | 0.37 | 0.23 | 0.16 | 53% | 37% |
| open-water horizon | 1.39 | 0.63 | 0.48 | 0.32 | 0.23 | 51% | 37% |
| open-water flight | 1.50 | 0.58 | 0.43 | 0.29 | 0.21 | 50% | 36% |
| plains t0 | 1.14 | 0.47 | 0.36 | 0.23 | 0.13 | 49% | 28% |
| plains t15 | 1.96 | 0.58 | 0.44 | 0.27 | 0.16 | 47% | 28% |
| plains t30 | 2.29 | 0.64 | 0.47 | 0.29 | 0.17 | 45% | 27% |

Result: low is about 50% at 1440p (39-56%) and 45-67% at 720p; mobile is 20-33% at 1440p, 27-44% at 720p, i.e. 25% only on the dense views. Why not lower: the cheap views are bound by per-pass floors (about 0.02 ms per pass, composite 0.05, far march 0.07-0.1 even at 20-37k threads), not by pixels, on this large GPU; a phone GPU has far fewer cores, so pixel-proportional cost dominates there and the ratios should be better, but I could not measure that. Idle-clock (vsync) flagship 1440p, min of 3: high 1.57 / 1.87 / 2.66, low 1.18 / 1.06 / 1.19, mobile 0.62 / 0.63 / 1.00 ms. Visual: low and mobile are softer but keep the shapes (`tier-*`).

## Auto quality
`quality: 'auto'` (runtime option and `new Clouds(renderer, { quality: 'auto', budgetMs })`): `selectTier` from `device.adapterInfo` (vendor/architecture), a mobile hint (navigator), output pixels, and the adapter's limits only if `options.adapter` is passed (a device's limits are just what it requested, so they are ignored; three keeps no adapter). Never picks ultra; Apple desktop -> high, Apple phone -> low, Adreno/Mali -> mobile, Intel iGPU -> medium, software -> mobile, 4K -> one tier down. Then `DynamicScale` moves `renderScale` (0.5..1) toward `budgetMs` of the controlled passes (all but the light grid) from `GpuTimer.last()`: median of the samples since the last change, shrink when above 1.08 x budget (area model, at most 30% per step), grow only after two consecutive decisions below 0.8 x budget and when the predicted cost fits, a grow that is soon undone caps the scale. API: `clouds.auto`, `.quality`, `.memory`, `.setBudget(ms)`, `runtime.outputScale/outputSize`. Flagship HUD shows tier, scale, cost/budget, memory (`?quality=auto&budget=2&trace=420`).

Convergence (vsync harness, 2560x1440; frame, scale, median cost ms):
- inside, budget 2: 1.0 (f20) -> 0.82 (f60) -> 0.66 (f100) -> 0.61 (f140) -> 0.52 (f260) -> 0.5 (f320). Cost 3.0 -> about 2.0; the budget is only reachable at the floor (cost vs scale is much flatter than area: scale 1 -> 0.5 only takes 3.0 -> 2.1 ms). 61% of the way in 2 s, at the floor after about 5 s.
- inside, budget 2.5: 1.0 -> 0.91 (f60) -> 0.83 (f120) -> 0.64 (f180) -> 0.6 (f220) -> 0.55 (f280-400), cost 2.4-2.6, no changes after f280.
- ground, budget 2: stays 1.0, 0 changes (cost about 2.0). Ground, budget 1.2: 1.0 -> 0.5 by f80, holds (cost 1.65, infeasible).
It does not reach the budget "within 2 s and hold steady" on every view: single-frame pass times jump 2x on an idle GPU and clocks drift with load, so it settles in 2-5 s with a few 0.03-0.05 steps afterwards. Unit tests (simulated cost model, noise, load steps): no oscillation, converges in about 120 frames.
Open issues:
- Without `timestamp-query` auto keeps the picked tier at scale 1. Switching a running Clouds to auto is not supported.
- `setQuality` across composite scales drops an external output texture until the caller resizes (the adapter and flagship bridge do it). Composite scale 0.75 / 0.33 were slower than 0.5 (non-integer depth footprint loop), so presets allow only 1 or 0.5.
- `high` now has near 0.28 / far 0.41; if the reviewer prefers exact A/B, revert to 0.33 / 0.5 (35.7 MB, diff = noise).
- `@clouds/react` still types quality as `CloudQuality` (now includes 'mobile', no 'auto'); owner may widen it to `CloudQualityOption`.
- Dome: mobile has it off until `clouds.reflection()` is called (the adapter turns it on).
