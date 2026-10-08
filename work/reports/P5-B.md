# P5-B Temporal amortization of the voxel clouds
Status: ready for review (timing target met except two thick-cloud views at 3.2-3.4 ms; see Measures)
Changed: `packages/runtime/src/{runtime.ts,shaders/{march,composite,frame}.wgsl.ts}`, new `shaders/temporal.wgsl.ts`; measurement pages `examples/lab/flagship/main.ts` (`?pan=D`, `temporal` in report; `?s.temporalNear=` already worked) and `examples/lab/plains-flight/main.ts` (`?k=near,far`, `temporal` in report).
Method:
- Each march pass traces 1/k of its pixels per frame (k = 2: checkerboard, k = 4: Bayer 2x2) into a trace target. The dispatch covers only traced pixels (full lanes), so cost scales with k.
- A resolve pass per pass (k > 1) writes the full-res history: reprojection with the previous VP through the pixel's cloud mean distance, rejection on disocclusion (history texel's scene distance seen from the previous camera vs now, 25 percent + 3 m), clip to mean +- 1.75 sigma of the fresh neighbours in proportion to pixel motion (static pixels keep the converged history), fresh blend 0.3 (0.6 in motion), rejected pixels take the nearest fresh sample.
- Cuts (every pixel traced that frame): setVolume/setNoise/setQuality/resize, camera jump > 25 m or turn > 15 deg, sun > 0.5 deg, any march/lighting setting change, k change; `resetTemporal()` for the rest. Jitter index is the pass's own sweep count, so a sweep shares one IGN slice (a frame-index jitter gave a lattice hatch).
- k = 1 marches straight into the history texture (no extra pass, no trace). Trace textures are allocated only while k > 1. No per-frame allocation; bind groups cached by (pass, grid slot, parity).
- API: `CloudQualityPreset.temporalNear/Far`, `settings.temporalNear/Far/temporalBlend` (override; presets copy them on `setQuality`), `resetTemporal()`, `temporalInfo`. Presets: ultra 1/1, high 4/4, medium 4/4, low 4/4 (2/4 on high is the quality-leaning alternative).
- Side changes: march/resolve depth targets are rgba16float holding distance/32 (x mean distance, y march end, z scene distance); composite skips both upsamples for rays that miss the voxel box (saved about 0.4-0.5 ms at 2560x1440; at box silhouettes the old bilinear leak of neighbour taps is gone).
Verified:
- `pnpm check` green (186 tests). Density parity page `pass: true`, formula max 2.8e-7, e2e 4.3e-3 (`work/captures/P5-B/density/capture.json`).
- captures `work/captures/P5-B/`: `flagship-run{1..3}`, `flagship-k1` (7 bookmarks), `plains-run{1..3}`, `plains-k1` (t0..t40), all 2560x1440 high; `motion-flagship-k{11,24,44}` (5 shots 3 frames apart, 0.4 deg/frame pan from `edge`), `motion-plains-t{14.5,27}` (`play=1`, 5 shots 2 frames apart).
Measures (GPU ms, min of 3 runs, GPU shared; flagship = all cloud passes, plains = `cloudsMarch`, i.e. without the idle light grid's stale last build, +0.9 if counted):
- flagship k1 -> high: ground 2.69 -> 2.15, edge 2.92 -> 2.02, inside 3.97 -> 3.16, above 2.17 -> 2.02, backlit 2.72 -> 2.14, shadow 1.85 -> 1.43, frontlit 2.44 -> 2.11.
- plains t0..t40: 2.11, 2.38, 2.09, **3.39**, 2.83, 2.39, 2.71, 2.54, 2.41 (k1: 3.30, 3.40, 2.43, 6.09, 2.75, 3.17, 3.46, 3.65, 3.10). Target <= 3 ms: pass except flagship `inside` (3.16) and plains t15 (3.39, thick base; was 6.1). Run-to-run noise is about +-0.3, individual passes more (a pass under 0.3 ms is dominated by clock ramp).
- Why k = 4 is not 4x: the in-cloud rays are latency-bound (long ray chains), so near marching in `inside` goes 2.8 -> 1.4 ms, far 1.0 -> 0.5. Resolves cost 0.05-0.2 ms each, composite 0.4-0.9.
- Static convergence vs k = 1 (mean |d|, rows below the HUD): flagship 0.40-0.49, inside 1.18 (fog, k = 1 jitter noise); plains 0.14-0.45. The k = 1 image is a single jittered frame; the temporal one is the jitter average, visibly smoother on wisps (`g3` comparison: no bias, no blocks).
- Motion (read): flagship pan edge k 2/4 and 4/4, plains climb through the base (t14.5) and cruise over the field (t27): no ghost trails, edges stay sharp, no stepped silhouettes; the horizon seam inside the shadowed core exists at k = 1 too. Slight softness at cloud/ground contact edges.
- Frames: `play=1` x2 (before the final 4/4 preset, k 2/4): p50 16.7, p95 16.7-16.8, max 16.8, 0 frames over 20 ms across the 3 swaps (headless is vsync capped, so this shows no spikes, not the GPU margin). Final preset: flagship frame p50 16.7 / p95 16.8.
Open issues:
- Wind is not compensated (noise scroll is centimetres per frame); a very fast `windVelocity` would smear billow detail by up to k frames.
- History lags slow lighting changes by about 1/blend sweeps (day cycle sun drift 0.1 deg/frame is invisible); sky/atmosphere jumps not seen by the runtime need `resetTemporal()`. Disocclusion test is loose (25 percent) because it compares against scene distance, not cloud distance.
- A cut frame traces everything (near+far about 2x a k = 1 frame): the plains window swaps (3) and bookmark jumps pay it once. `setVolume` always cuts.
- Memory: 2 history pairs + trace (16 B/px each) per pass = 63 MB at 2560x1440 high (`temporalInfo.bytes`).
- GPU timing was shared with other agents; the 3.16 / 3.39 ms views may pass or fail by +-0.3.
