# P5-A Generator and streaming memory diet
Status: ready for review
Changed: `packages/runtime/src/generate/{shaders,volume-generator,stamp,streaming,index,cpu-edt}.ts`; `examples/lab/runtime-tests/generate/main.ts` (raw-EDT checks, wording). Nothing outside the owned files.
What changed:
- The 3D jump flood is replaced by an exact separable EDT (Felzenszwalb-Huttenlocher) run in place in ONE u16-per-voxel buffer (two voxels per u32, rows padded to 256 B, so it is also the SDF staging buffer for copyBufferToTexture). Bit 15 = inside, bits 0..14 = distance in 1/64 voxel (saturates at 511.98 voxels). One signed volume carries both classes: every voxel has exactly one non-zero partial distance, so the y and z passes run two lower envelopes per line (one per class) and write only the matching targets.
- Jobs: nvdf, edt-x (two-sweep), edt-y, edt-z (FH, one thread per line, private arrays), profile, sdf. Chunked and amortized as before (x/y passes chunk over z, the z pass over y with the same chunk count); sliced output is bit-identical to one-shot.
- Every store floors, so the result is never above the exact EDT. Also fixed an old bias bug: the f16 "one ulp down" bias moved negative (inside) values further from zero; it now shrinks |d| (`d * (1 - 2^-10)`).
- Shared by generator and `createSdfRebuilder` (stamp). `refinePasses` / `rounds` options are kept but ignored. `jfaStepSequence` kept (unused, tests import it). `GeneratorScratch` is now `{ dims, field, bytes, destroy }` (was `seeds[]` + `staging`); `createGeneratorScratch(device, dims, label)` is unchanged. The 2047/1023 packed-seed dim limit is gone.
- `memoryBytes`: `VolumeGenerator.memoryBytes {nvdf, sdf, scratch, params, total}`, `SdfRebuilder.memoryBytes {scratch, params, total}` (scratch 0 when shared), `StreamingCloudscape.memoryBytes {windows, scratch, other, total}`; `scratchBytes(dims)` exported.
Verified:
- `pnpm check` green (typecheck, tests, build).
- `node scripts/gpu/capture.mjs --serve --page runtime-tests/generate/` OK, 0 failures: all 2.1 M voxels of 256x256x32 and each preset, margin-1 SDF never overshoots the CPU EDT (max -4 m, i.e. one voxel under), no sign flips; raw (margin 0) max overshoot -0.004 m (never over), max undershoot 0.62 m. Odd dims (101x67x19, 130x40x33, sliced) vs CPU: over -0.004 m, 0 flips (one-off page, removed).
- `runtime-tests/stamp/` OK, 0 failures: whole region 14.2 M voxels, stamped boxes, and the empty target + 4 stamps: maxOver -4 m, 0 overshoot voxels; sliced rebuild bit-identical to one shot.
- `plains-flight` swap: `work/captures/P5-A/swap/{swapA,swapB}.jpg` show the same clouds across the swap (no pop); generation 48 frames (was 56) at 2 jobs/frame, worst encode+submit 0.2 ms.
Measures (512x512x64, M-series, timestamp queries):
- Peak scratch: 302 MB (4 x 67.1 MB seeds + 33.5 MB staging) -> 33.6 MB (9.0x less; limit 40 MB). Params 1.5 KB.
- Generator steady memory: 403 MB -> 134 MB (nvdf 67.1 + sdf 33.6 + scratch 33.6). Streaming (2 windows + shared scratch + 2 weather maps + params): 506 MB -> 237 MB (windows 201.3, scratch 33.6, other 2.1).
- Generation GPU time: 46.8 ms -> 17.3 ms median of 4 (the generate page measures 12 ms in its own best-of-2 run; 256x256x32: 5.2 -> 2.4 ms). Sliced (112 -> 96 jobs of 4 z): 0.34 ms/job avg. Stages at 512x512x64: nvdf 3.2, edt-x 1.6, edt-y 8.3, edt-z 2.7, profile 0.3, sdf 0.2 ms. Stamp SDF rebuild 384x384x96: 7.7 ms one-shot (the jump flood was most of the old cost).
- Output vs old path (same weather, per preset, 512x512x64, cumulus/congestus/strato): SDF |new| <= |old| everywhere (new-old max 0), max |delta| 4.5 / 10.1 / 1.0 m (far field, where the old JFA overshoot and the f16 bias act); mean |delta| near the surface (< 100 m) 0.09 / 0.09 / 0.03 m. NVDF: 0.74 M / 0.49 M / 0.10 M of 67 M bytes differ, max 14 / 8 / 2 of 255 (profile follows depth; the old depth carried JFA error). At 256x256x32 the max SDF deltas are 2.2 / 2.8 / 0.25 m.
Open issues:
- Distances saturate at 511.98 voxels (4096 m at 8 m voxels, the old default clamp); an empty volume now reads about -/+4084 m instead of exactly maxDistance.
- Private line arrays are 12 B x line length per thread (6 KB for 512): untested on mobile GPUs; if register spill hurts there, the y pass (the slowest, 8.3 ms) is the one to restructure into workgroup memory.
- Per-job cost is lumpier than the old uniform jobs: worst single job at 512x512x64 with 8 z per chunk is 1.3 ms (edt-y), 0.39 ms (edt-z); with sliceDepth 4 (streaming) jobs are half that.
