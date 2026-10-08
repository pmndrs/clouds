# P3-B Generator quality: natural cumulus fields
Status: ready for review
Changed: `packages/runtime/src/generate/{shaders,volume-generator,weather,index}.ts`, new `generate/presets.ts`; `examples/lab/cloudscape-gen/main.ts` (page); `examples/lab/runtime-tests/generate/main.ts` (preset SDF checks). No runtime/three/open-water/vite files touched.
Verified:
- `pnpm check` (typecheck + 167 tests + build) green.
- `node scripts/gpu/capture.mjs --serve --page runtime-tests/generate/` exits 0, 0 failures. SDF vs exact EDT of the NVDF mask, all 2.1 M voxels, never over: default weather max overshoot -4 m (floor), presets cumulus -0.73, congestus -4, stratocumulus -4 m; 0 sign flips.
- captures: `work/captures/P3-B/{cumulus,congestus,stratocumulus}/{ground,horizon,above}.jpg` (+ capture.json), `work/captures/P3-B/side-by-side-horizon.jpg` (left P2-03 horizon, right P3-B cumulus horizon).
Measures:
- Silhouettes: all three presets read as domed, cauliflower-lobed clouds with flat bases; no vertical walls, no stacked shelves (see captures). Honest caveats below.
- Generation 512x512x64, GPU timestamps, quiet run: 45.0 ms one-shot; 45.0 ms as 112 jobs of 4 z (avg 0.40 ms/job, worst 0.76). Stages: nvdf 2.95, jfa3d 41.1 (91%), profile 0.45, sdf 0.49 ms. (A later run with other GPU load read 70 ms; same ratios.) 256x256x32: 4.7 ms. The 2D seed/JFA stage is gone (saves ~1 ms at 512^2).
Terrace/shelf cause (diagnosis by reading the old shader plus the capture; no isolated bisect run):
- The old occupancy was `envelope(h) * edge2D > 0`, so a cloud was a stack of per-column [base, top] intervals. `edge` (2D distance gradient) only scaled the profile and never moved the boundary, so every column was full-height right up to the coverage boundary = vertical walls.
- Top/base came from a steep, saturating coverage ramp (0.5..0.64 of fBm, 8-bit weather texture, sampled 1:1), so the silhouette was a heightfield of a stepwise, plateauing function = terraces and flat tops.
- The soft vertical profile `pow(h,2)*pow(1-h,1.5)` falls under 1/255 near top and base, which lops the extremes into per-column slabs. Not quantization of the SDF or slice amortization: sliced and one-shot output are bit-identical, and the SDF only reads the mask.
- Second shelf source (found while iterating): a gentle base ramp (the first version of the new field) made the lowest ~8 voxel slices each a different footprint contour, i.e. stacked dark shelves under the cloud. Fixed with a ~1-2 voxel base ramp plus a rim lift that curls the base up toward the lobe edge.
What was built (inside the generator, free at runtime):
- Cloud = level set f > 0 of a smooth 3D field: f = s - h^p + billow. s = smoothed coverage mass (peaked, wide ramp, no plateau; weather map now blends fBm with one Worley dome per cell), h = height above a flat base over topFraction, p = domeExponent (2 hemispheres; lower = towers; higher = flat decks). Height therefore follows local mass (taller where coverage is high).
- Billow: 3-octave inverted-Worley (cell 450 m, 225, 112 m for cumulus), amplitude 0.4, applied only near the surface, stronger toward tops, zero near the volume ceiling.
- Profile/detail/scale from the finished jump flood (new `profile` job): PACK_FIT profile = sat((d*exp(0.64 n)-1.4)/66)^1.05 * base lift; detail = smoothstep(0.1,0.75,h - 0.25 sat(d/32)) (+ weather cloud type nudge); scale rises with column height. Non-zero set of the texture == SDF mask (profile floored at 1/255).
- Presets (`CLOUD_PRESETS`, `?preset=`): cumulus, congestus, stratocumulus. Any NvdfParams field is overridable via the page query (also `w_scale`, `w_cellular`, ...).
Deviations / open issues:
- Density scale base is 0.25 (fit: 0.04) so bases do not vanish; top 0.85. Tunable (`scaleBase`, `scaleTop`).
- Congestus is only modestly more towering than cumulus (bigger, taller masses, p=1.35); the 512 m volume cap limits tower height. Stratocumulus reads as a bumpy low deck; from above it is a near-continuous carpet with holes, and its map border is a visible rectangle edge.
- Page ground is a flat plane (dark green), so the "ground" shot looks up at the clouds from 2 m; the cloud underside is dark by design of the profile lift.
- NvdfParams changed (removed edgeWidthVoxels/topMin/topMax/densityMin; added topFraction, domeExponent, billowAmp, billowCellMeters, baseLift, seed, scaleBase/Top, profileSigma, detailBias; useMapHeights now defaults false). Procedural weather defaults changed (wide ramp). Generation is still not double-buffered (as in P3-A).
- The orchestrator's open-water page passes the removed params (tmin/tmax); update it to `CLOUD_PRESETS`.
