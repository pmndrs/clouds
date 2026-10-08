# P3-A GPU NVDF generator prototype
Status: ready for review
Changed: `packages/runtime/src/generate/{index,volume-generator,weather,shaders,cpu-edt}.ts`, `cpu-edt.test.ts`; `examples/lab/runtime-tests/generate/{index.html,main.ts}`. No other files touched.
Verified:
- `pnpm typecheck` clean; `pnpm test` 167/167 (2 new: CPU EDT vs brute force, JFA step sequence).
- `node scripts/gpu/capture.mjs --serve --page runtime-tests/generate/ --out work/captures/P3-A` exits 0 (Apple Metal, timestamp-query on).
- captures: work/captures/P3-A/view.jpg (top-down max profile, SDF slice, detail type, x-up sections of profile/SDF/detail, raw-JFA error map) and capture.json (numbers below).
Measures (256x256x32, 8 m voxels, 16% occupied):
- SDF vs exact EDT (Felzenszwalb, ported to TS), 2000 samples (half near the surface) and all 2.1 M voxels:
  - raw JFA+2 (margin 0): max overshoot 0.10 m samples / 1.65 m all (0.21 voxel); median |err| 0.03 / 0.07 m; no sign flips. PASS (<= 1 voxel).
  - default (margin 1 voxel): max overshoot -4.0 m (never over; the floor is half a voxel at the surface), max undershoot -8.5 m, median |err| 8.07 m (about one voxel, by construction). PASS.
- Generation GPU ms (timestamps summed over passes, best of 2 after warm-up; wall includes submit):
  - 256x256x32: 4.49 ms one-shot; 4.69 ms as 59 jobs of 8 z (0.08 ms/job avg, 0.14 ms worst); wall 6.4 ms.
  - 512x512x64: 42.1 ms one-shot; 41.9 ms as 116 jobs (0.36 ms/job avg, 0.85 ms worst); wall 55 ms.
  - 3D jump flood is ~95% of the cost (40.2 of 42.1 ms at 512^2x64: 11 steps x 26 neighbours x 2 seed sets).
- Amortized (sliceDepth 4, 6 jobs/frame): 107 jobs over 18 frames, output bit-identical to one-shot. PASS.
- No three imports. PASS.
Design notes:
- Weather map: any rgba8unorm/rgba16float 2D texture, bilinear over the footprint. R coverage, G cloud type, B base, A top (fractions of height; `useMapHeights:false` derives them from coverage). `encodeProceduralWeatherMap` writes one (fBm coverage/heights, Worley type, faded at the border so every cloud has an outside pixel).
- NVDF: `pow(h,2)*pow(1-h,1.5)/0.0916 * edge`; edge = smoothstep over `edgeWidthVoxels` (6) of the 2D JFA distance to the coverage boundary; G = mix(h, type, 0.5) (wispy base to billowy top); B = density scale from coverage; outside G=B=1 as in the shipped assets. Occupancy is the 8-bit-quantised profile > 0, so the SDF matches what the texture holds.
- SDF: two seed sets (nearest inside / nearest outside), JFA with refine steps (2,1), distance minus 0.5 voxel (same convention as assets/clouds/README.md) minus `marginVoxels` (default 1), clamped to +/-4096 m. JFA only ever finds real seeds, so its error is overestimate-only (observed <= 0.21 voxel); the margin covers it. It is not a proven bound for adversarial inputs; raise `marginVoxels` if needed. f16 packing is biased by 2^-10 relative so rounding cannot overshoot.
- r16float is not a core storage format: SDF is written as packed f16 into a 256 B row-padded buffer and copied with copyBufferToTexture (a render-pass version measured wrong on Metal: render-pass timestamps included upstream waits, 110 ms vs 7 ms wall).
- Memory: 4 u32 seed buffers of w*h*d (268 MB at 512^2x64) plus a 33 MB staging buffer; free with `destroy()` after completion if generating once. Seed packing limits dims to 2047x2047x1023.
Exports to add to packages/runtime/src/index.ts (I did not touch it): `export * from './generate';` i.e. `createVolumeGenerator, jfaStepSequence, encodeProceduralWeatherMap, signedDistanceCpu, squaredDistanceToMask` and types `NvdfParams, VolumeGenerator, VolumeGeneratorOptions, GenerateProgress, ProceduralWeatherOptions`.
Usage: `const g = createVolumeGenerator(device, { dims, weather }); g.generate(encoder, jobsThisFrame)` each frame until `g.done`; then use `g.volume` (a `GpuCloudVolume`) where `uploadCloudVolume`'s result is used. `g.restart()` regenerates in place (volume holds old data until the new pass overwrites stages; double-buffer by creating a second generator if tearing matters).
Open issues:
- Generation in place is not double-buffered: while a restart is in flight the nvdf (written first) and sdf are briefly inconsistent. Callers should render the previous volume until `done`, then swap.
- Procedural weather is blobby (plateau profiles); art quality was not a goal.
- The page-level `failures` array is the pass/fail source; capture exits non-zero via harness.fail.
