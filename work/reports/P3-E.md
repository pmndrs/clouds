# P3-E Performance on large generated volumes
Status: ready for review
Changed: `packages/runtime/src/{light-grid.ts,shaders/light-grid.wgsl.ts,shaders/march.wgsl.ts}`, `examples/lab/runtime-tests/light-grid/main.ts` (tolerances), `examples/lab/plains-flight/main.ts` (`?sunDrift=`, `cloudsMarch` in the report). `runtime.ts` and `density.wgsl.ts` end with no net change (temporary debug hooks removed).
Verified:
- `pnpm check` green; density parity page exits 0; light-grid page 18 checks, 0 failures.
- captures: `work/captures/P3-E/` (t0..t40 at 2560x1440 after; `flagship/` ground/edge/inside after; `play/capture.json`; `light-grid/`). Before = `work/captures/P3-D/` and scratch.
Light grid (256x256x32 grid, 512x512x64 volume):
- New build: a sun-independent *reduced* volume (r = profile*scale at grid texel centres, g = exact upward optical depth by a column prefix sum, integral of the trilinear field), built once per volume (0.1 ms) in the first encode. The sun channel marches that small texture with a step that starts at one cell and grows 12% of the distance: ~35 samples instead of up to 128 NVDF samples x2 channels. Rebuilds spread over 16 frames above 1 M voxels (`lightGridPasses`), still 8 for Parkouring; double buffer untouched.
- Full build (volume swap, first frame): 2.9 ms -> 0.83 ms + 0.11 ms reduce. Steady update with a drifting sun (`?sunDrift=3`): 0.11 ms/frame (was ~0.36 = 2.9/8). Static sun: 0. Parkouring slice 0.068 -> 0.021 ms.
- Note: before, `lightGrid` 2.9 in the captures was the stale last build, not per-frame cost (a static sun never rebuilds); `cloudsTotal` includes it. `cloudsMarch` (new) leaves the grid out.
- P1-03 tolerance changed (grid now filters 2x2x2): was 2% relative on every voxel >1% of max; now worst |err| <= 4% of channel max and <= 5% relative over voxels >10% of max. Measured on the sharp synthetic cone: sun 3.0% abs / 4.2% rel, up 0.4% / 3.9%. Zero check relaxed to 1% of max (one cell of leakage).
March (t15, inside a thick base; instrumented with a temporary step/density/light counter readback):
- Cost is per step, not divergence: near mean 107 steps/ray (96% density samples, 38 lit), far mean 65 (p90 171, p99 241). Rays sit in SDF-inside but thin/eroded haze at the 1.5 m minimum step.
- Fixes (all in march.wgsl.ts, every widening is capped at half the depth below the surface so a step cannot skip a skin): step floor 1.5 m + 0.12 sqrt(t) -> 3.0 + 0.2 sqrt(t); step x (1 + run of thin samples, up to 6; thin = sigma*step < 0.1); step x (1 + 3 (1-T)^2); the two in-line sun samples reused for steps < 4 m. Counts at t15: near 107 -> ~45, far 65 -> ~30.
- A first version without the depth cap changed t15 by 5.8 mean |d| (p99 111): rejected.
Measures (2560x1440, high, GPU ms; before -> after; marches = near+far):
- t0 6.7->3.0, t5 7.0->3.0, t10 6.2->2.7, **t15 10.7->5.5** (marches 7.3 -> 5.0), t20 5.7->2.7, t25 6.2->2.7, t30 6.5->3.0, t35 6.8->3.1, t40 6.5->2.8 (after = `cloudsMarch`; including the idle grid's last build 0.9 ms, t15 is 6.4 and the rest <= 4.2).
- `?play=1` x3: p50 16.7, p95 16.7-16.8, max 16.8 / 33.3 / 33.4; the only >20 ms frame is frame 1 (page start, before the flight), none in the climb (t13.5-16 had 38 such frames before). Swaps t=15.4/24.9/35.3 cost nothing visible.
- No visible change: mean |d| vs P3-D scratch before: flight 0.6-1.4 (p99 5-9), flagship ground 0.58, edge 0.51, inside 2.0 incl. HUD text (rerun-to-rerun 0.4); the light grid alone accounts for 0.6-0.8. Images read the same.
Open issues:
- Swap frame still has a ~0.95 ms grid + reduce spike (one-shot first build; can't bind a partial grid).
- The dome shader marches on its own and was not changed; sky layer unaffected.
- Step widening is tuned by eye on the flight path and flagship; the P3 art pass should recheck very thin wisps.
