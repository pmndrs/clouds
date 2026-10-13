# Culling, distance and LOD in the procedural sky: what we have (2026-10-13)

A read of the code and the research notes, for the performance pass after parity. Nothing was changed or measured for this note.

## What we skip today (procedural sky, `packages/runtime/src/procedural/trace.wgsl.ts`)
- **Rays clip to the cloud shell and the ground** (`procCloudInterval`), and to scene depth. A ray that hits terrain or a near object stops there.
- **Far cutoff:** `maxDistance` 120 km. Density fades over its last 20 %.
- **The ray stops once the cloud is opaque:** transmittance below `transmittanceCutoff` 0.05; the remaining light is renormalised.
- **Long steps through empty air:** 4× steps, a step back on a hit, and back to long steps after 4 empty samples.
- **Cheaper light taps** once a pixel is half opaque (`fullLightingAlpha` 0.5); taps are reused.
- **Horizon ring:** HZD returns nothing beyond `ringEnd` 35 km at ground level.
- **Frustum culling isn't a separate step.** The sky is traced per pixel, so only pixels on screen are ever traced. What matters is skipping empty air along each ray, covered next.

## What's missing
- **No empty-space skipping from the weather map for HZD.** Sky Pro has it: a 64² map of maxima lets the ray jump over clear areas. HZD has it off (`PROC_HAS_BOUNDS = false`, `hzd/shaper.wgsl.ts`). HZD's clear lanes are therefore marched step by step. This is probably the biggest cheap win.
- **No map LOD.** One 32 km map at 1024², per the F2 note.
- **Lighting is not cheaper with distance**, apart from the 4 cheap far taps.
- **Pixels hidden by the near voxel pass aren't skipped** in the procedural trace. The voxel far pass does skip them.

## Distance and detail (procedural)
- **Step size:** `max(25 m, distance × cone)`, with 256 steps at most.
- **Noise mip:** chosen from the pixel's footprint (`mipBias` 0).
- **Detail fades out** around `detailDistance` 40 km.
- **Cubic reads within 30 km.** The veil and fractus stop at 15 km. The Nubis Cubed fine noise stops at 900 m.
- **Rendered at the sky layer's resolution** (ultra 0.75, high 0.5), with 1/16 of the pixels traced each frame (the HZD 4×4 reprojection).

## What the papers say about distant clouds (the "distant clouds need more" point)
1. **Rays toward the horizon need more samples, not fewer.** HZD 2015 and GPU Pro 7 use 64 steps straight up and 128 toward the horizon. NE22 / Nubis Cubed step at `3 + 60·dist/16384` m. The horizon is the most expensive part of the sky (`docs/research/sources/hzd15.md`, `gp7.md`, `ne22.md`, `n3.md`). Our P9-C3 profile agrees: the horizon band, up to 256 steps, is the cost.
2. **Distant clouds lose their surface detail if the noise is filtered too hard.** At the distances in your photos (4–12 km), our noise mip filters the detail away, and those clouds read "soft, plastic" (`docs/research/topics/surface-detail.md`). Detail at distance has to be kept on purpose, not dropped to save time.
3. **Other points from the papers:**
   - Small far clouds go noisy at low coverage (`sources/hag.md`).
   - Distant clouds still need to cast shadows: the last light sample is placed far away (`hzd-nubis-evolved.md`).
   - Far and high layers can be 2D / 2.5D, and work can be spread over frames (`docs/research/cloud-perf-tricks.md`).

## Measurements so far (no dedicated perf report exists yet)
- **NVDF sky layer, P9-C3:** about 3.3–3.7 ms in total at 1440p high. It is latency-bound in the horizon band, and lighting is not the cost.
- **HZD sky:**
  - The veil is about half the sky-layer time (F2, H6).
  - The tables lookup costs about 1.5 ms (F2).
  - At ultra the sky layer took 15–44 ms on a loaded GPU, and the pack shape noise adds 6–10 ms (N1).
  - These numbers need a clean rerun.

## For the performance pass (after parity)
These are candidates, not decisions.
1. Weather-map empty-space skipping for HZD.
2. A clean timing breakdown: shape, detail, veil, lighting, horizon band.
3. Keep detail at 4–12 km, and pay for it with the savings from item 1.
4. Mid and high layers as 2.5D (L3).
5. Map LOD past 32 km.
6. A lower-resolution trace plus your FSR3 upscaler (U1).
