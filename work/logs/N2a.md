# N2a — HaloRT primary-ray features in WGSL (first half of the feature pass)

Date 2026-11-24. Agent: Opus. Check: passed on the first picture.

## What exists

- `experiments/neural/feature-pass.ts` — `FeaturePass`: one WGSL compute dispatch, a port of the first half of
  `halort/volume_deep_profile.h` (HaloRT, MIT). Inputs: dense density 3D texture (r16float), box half-extents
  (object `[-1, 1]^3` scaled per axis, the source's `transform` without rotation), camera, `densityScale`, `stepSize`
  (uniforms). Output: storage buffer, 12 floats per pixel: `tau`, `S = 1 - exp(-tau)`, `tr = 1 - exp(-0.2 tau)`,
  crossing count, raw crossing depths `t0..t3` (scales 4, 1, 0.25, 0.125), encoded `depth = log(1 + 0.2 t0)` and
  `(t_i - t_{i-1})^0.25` for i = 1..3. Offsets in `FEATURE`.
  Follows the code: two passes (tau; then crossings from the first non-empty sample, stop at tau > 20), the source's
  `tau_crossing` formula, `sample_index = 0`, `tr` and the encodings written only when at least one crossing was found
  (as the source does), `t` measured from the camera along the unit world ray.
- `examples/lab/neural/` — lab page: the Disney cloud (`wdas_cloud_eighth.vdb`, 254x311x174 at native voxel, / p99),
  six grayscale 512² panels (tr, S, depth, crossing 2, 3, 4), values raw and clamped to [0, 1], orbit camera (drag,
  wheel), `window.__clouds` with `report()` (per-channel min / mean / max over pixels with a crossing).
  `density.ts` is a lean copy of vdb-sky's route A resample: importing `vdb-sky/vdb-direct.ts` pulls `@clouds/runtime`,
  whose `upscale.ts` imports `@pmndrs/upscaler/core`, which does not resolve in this worktree (vite 500s the page).

## How to run

    npx vite --port <free port>          # from the worktree root
    open http://localhost:<port>/neural/  # ?scale=10 ?step=0.004 ?vdb=eighth|sixteenth|quarter
    node scripts/gpu/capture.mjs --url http://localhost:<port>/neural/ --size 1536x1024 --settle 10 --out work/captures/N2a

## What I saw

`work/captures/N2a/view.jpg` (report in `capture.json`). densityScale 10, step 0.004, camera 3.2 units out.

- Silhouette is the Disney cloud. S is ~1 across the core and falls off in the wispy base and the edges; tr shows
  the internal structure (tau 0..7.7, mean 3.3 over covered pixels).
- Depth (`log(1 + 0.2 t1)`) is a flat mid-grey, 0.40..0.58: t1 runs 2.46..3.95 and the log squeezes it. It does
  increase away from the camera (the far right lobe is lighter). The authors' pictures use a colour map with an
  auto range, so theirs shows more contrast; same field.
- Crossings 2-4 are non-zero inside the cloud (all 69 511 covered pixels found all four crossings). Crossing 2 has
  bright thin rims on the lit-side creases, the same look as the authors' `noon_grass_crossing2.png`; crossings 3
  and 4 get softer and pick up the big-lobe structure, as theirs do.
- Pixel counts: 71 404 with tau > 0, 69 511 with a crossing (the rest have tau < 1e-4).

## Skipped (by the brief or on purpose)

- Empty-space skipping: plain fixed-step march over the ray/box interval (N-F1 stays open; the next task adds it).
- Step 0.004, not the source's 0.001 (N-F3 stays open; a uniform, `?step=`).
- No colour map, no auto range, no timing, no tuning of densityScale.
- Second half of the pass: sun NEE, environment NEE, albedo, g.
- `pnpm typecheck`: my files are clean; the two errors left are the pre-existing `packages/runtime/src/upscale.ts`
  (`@pmndrs/upscaler/core` unresolved in this worktree).
