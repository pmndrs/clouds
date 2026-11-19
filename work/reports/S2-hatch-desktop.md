# S2: the hatch on hard lit faces, and desktop quality

Status: ready for review. Branch `worktree-agent-a1f8315a98f82ba50` (not merged).

## Verdict
- **Defect 1 (fine diagonal hatch on hard lit faces): cause found and fixed.** The procedural march takes one point sample per step. Where a ray enters a cloud from an empty sample, the per-pixel step jitter (interleaved gradient noise, IGN) decided how deep under the surface the first sample inside landed: anywhere in a fine step (25 m and more). On a hard surface the ray is nearly opaque within that step, so the pixel took the colour of a point up to 25 m deep, and the depth followed IGN's diagonal lattice. The sky layer's history keeps 0.3 of every newest sample (one per pixel per 16 frames), so it never averages that out: the hatch. Fix (`proc.surfaceRefine`, default 3): at every entry from an empty sample, halve the last empty step 3 times and start integrating at the surface found (with the first inside sample's density), growing the step from 0.15 of a fine step. Old march: `surfaceRefine 0` (Review **S2a**).
- **Defect 2 (desktop softer, grain gone, hatch): mostly fixed, partly explained differently from U2's diagnosis.**
  - The hatch at desktop is the same hatch as defect 1 at twice the pixel size, sharpened by the upscaler's RCAS. The S2a fix takes most of it out; a fainter one is left on the foamy horizon tops seen from `above`.
  - The softness was the layer's own sub-pixel jitter: the trace offsets each ray by a Halton point spanning **2 layer pixels**, and the history averages over it, i.e. a 2x2 layer-pixel box = 4x4 output pixels at desktop (8x8 at laptop) before the upscaler sees anything. New `c.levelSubPixelSpan` (default **1** at desktop/laptop, Review **S2b**): lit ridges at desktop are now as crisp as cinematic by eye and by the edge measure.
  - Rendering the layer under the upscaler's Halton jitter (or tying the amortisation phase to it) is not workable as such: each frame only 1/16 of the layer is fresh, the rest is history traced under older offsets, so telling the upscaler "this frame is offset by J" misregisters 15/16 of it; the only consistent version is a full fresh trace every frame (U2 measured that path at about 16x the trace cost). Not done.
- **Laptop:** with the S2b box, **1/3 is clearly better than 1/4** (lit-ridge edge 0.048 vs 0.040; cinematic 0.049) for about 1.6x the 1/4 trace (26 vs 16 ms, same run). Recommendation: **0.33**. The default stays 0.25 (the compass value; a budget call for the owner).
- **Device loss:** no leak or per-frame allocation found in the upscale path; it is frequent on this machine at desktop/laptop (numbers below), never at cinematic.

## Defect 1: how the cause was found (one change per step, frozen frames, A/B sheets)
Captures: `work/captures/S2/{base,hatch}/`, 1920x1080, `clean=1&motion=0` (frozen, so A/B are the same clouds), PNG. Measures (`scripts/s2/metrics.py`, lit cloud in S1's lit-ridge crop away from the silhouette): **fine** = std of luma minus a 1.2 px blur (1-3 px grain and hatch; lower = calmer), **detail** = PT1's 4-16 px band (surface texture), **edge** = mean gradient on the lit silhouette band (crispness). Specks: pixels > 25 above their 5x5 median.

| step | what | result |
|---|---|---|
| 1 | `sky.jitterNoise` blue (blue-noise mask + golden ratio per cycle, the voxel march's D1 round 5 jitter) instead of IGN | the hatch turns into an irregular grain; gp7 fine 0.0033 → 0.0053 (worse by number, different by eye). **Not kept as default** (selectable). It proved the pattern follows the jitter. |
| 2 | `proc.surfaceRefine` 3: bisect the last empty step at a cloud entry, take the sample found | hatch gone on S1's own case (Nubis Cubed 0.4: fine 0.0076 → 0.0063, edge 0.055 → 0.059), on horizon and on stage 2 (no detail), crisper ridges; but bright one-pixel **specks** on smooth shaded bases (stage 2: 16 → 4987; horizon gp7: 31 → 330). |
| 2b | specks: max steps 512 | no change (not the step budget) |
| 2c | specks: no step growth after the entry | 4987 → 1717 |
| 2d | specks: bisect only hard entries (`surfaceRefineTau` 0.5) | specks 944, but the hatch came back on horizon (fine 0.0066, same as off). Rejected. |
| 2e | specks: keep the first inside sample's density/depth, move only the position to the surface (`surfaceRefineMode` 1) | specks back to normal (stage 2: 25, horizon: 57 vs 31), hatch still gone (S1 case fine 0.0063, edge 0.058; horizon fine 0.0065, edge 0.051). **Kept.** The cause of the specks: the sample at the surface has a density that has only just begun; its weak local optical depth and its light were reused (the march's light cache) for the denser samples right after it. |
| 2f | 5 halvings instead of 3 | same as 3 (S1 case fine 0.0063 both). Kept 3. |

Sheets: `work/captures/S2/sheets/hatch-cinematic-gp7.jpg` (horizon, S1's Nubis Cubed 0.4 case, stage 2: old | new each; full frame, 1:1 lit ridge, 1:1 base, 2x lit ridge), `hatch-cinematic-above-above.jpg`.

## Defect 2: desktop
Captures: `work/captures/S2/{desk,desk2,laptop}/`, same settings, `level=desktop` (layer 0.5 + upscaler, temporal path, sharpness 0.5).

| step (on top of S2a) | result |
|---|---|
| S2a alone at desktop | above fine 0.0110 → 0.0088: most of the hatch goes; a fainter checker is left on the horizon tops from `above`; ridges still softer than cinematic (gp7 edge 0.048 vs 0.049 cinematic, by eye softer). |
| + blue-noise jitter | about the same (above fine 0.0085). Not kept. |
| + sub-pixel rotation per pixel (`sky.subPixelRotate`, to break a Bayer-ordered offset between refreshed and stale pixels) | no change: that hypothesis was wrong. Not kept. |
| + noise LOD from the layer pixel (`c.levelLodLayerPixel` 1) | no clear change (above fine 0.0086). Not kept. |
| upscaler bilinear path instead of temporal | the same diagonal hatch, softer: the pattern is in the layer, RCAS only sharpens it |
| + sharpness 0.2 / 0.3 | a little calmer, a little softer. Not kept (U2's 0.5 stays). |
| **+ sub-pixel span 1 (`c.levelSubPixelSpan` 1)** | **gp7 edge 0.048 → 0.053 (cinematic 0.049), detail kept; real style edge 0.049 → 0.052. By eye the lit ridges and the lobes are as crisp as cinematic. Kept.** It also makes the surviving grain a little more visible (fine 0.0062 → 0.0081 on horizon gp7). |

## Final verification (motion on, as the task's command)
`scripts/s2/cap.sh` with `MOTION=1` (the bench's x1 wind), 1920x1080, settle 450, `clean=1`, views gp7 / above / sunset (ground first as a warm-up), styles horizon and real. **before** = `proc_surfaceRefine=0` (+ `c_levelSubPixelSpan=-1` at desktop/laptop) = the merged main; **after** = this branch's defaults. Captures `work/captures/S2/final/<style>-<level>-<before|after>/` (JPEG q95).

Sheets (columns cinematic before | after | desktop before | after | laptop before | after; full frame, 1:1 lit ridge, 1:1 base, 2x lit ridge):
- `work/captures/S2/sheets/final-horizon-{gp7,above,sunset}.jpg`
- `work/captures/S2/sheets/final-real-{gp7,above,sunset}.jpg`
- frozen A/B of the cause: `work/captures/S2/sheets/hatch-cinematic-gp7.jpg`, `hatch-cinematic-above-above.jpg`; motion: `work/captures/S2/sheets/motion-gp7.jpg`

| (motion on) | horizon gp7 edge | horizon above fine | real gp7 edge |
|---|---|---|---|
| cinematic before / after | 0.0427 / 0.0435 | 0.0072 / 0.0064 | 0.0396 / 0.0403 |
| desktop before / after | 0.0431 / **0.0473** | 0.0072 / 0.0073 | 0.0396 / 0.0408 |
| laptop (1/4) before / after | 0.0335 / 0.0405 | 0.0029 / 0.0032 | 0.0349 / 0.0415 |

By eye:
- **Cinematic:** the hatch is gone from the lit faces at gp7 (S1's Nubis Cubed 0.4 case: gone; horizon: mostly gone, a faint trace on the lower lit face; real: gone). Lit ridges a little crisper. Bases and sunset rims unchanged. **New, flag for the owner:** on the real style the lit faces now show fine streaks that follow the curl-distorted detail noise (the 2x crop of `final-real-gp7.jpg`); the old jitter blurred them. I read them as the noise's own structure now resolved, not a sampling artefact (they are fixed in the cloud, not in the screen), but they can look like wood grain at 1:1.
- **Desktop:** before, the hatch on the `above` tops was a visible diagonal checker at twice the pixel size and the ridges were soft; after, the checker is much fainter and the ridges and lobes read as crisp as cinematic (gp7 edge above cinematic's). The finest 1-2 px grain is still a little less than cinematic. **Not done:** a faint checker remains on the horizon tops from `above` (fine 0.0073 vs cinematic 0.0064).
- **Laptop 1/4:** better than before (ridge edge +20 %) but still soft; 1/3 recommended (above).
- **Sunset:** no change at cinematic; desktop rims a little crisper. Nothing worse.

## Motion (step-frames, fixed clock, 1280x720, gp7 horizon, 6 consecutive frames after 420 warm-up)
`scripts/s2/motion.sh`, frames in `work/captures/S2/motion/<run>/`, numbers from the PNGs before the JPEG conversion (`scripts/s2/motion_metrics.py`, U2's measures on the lit ridge):

| | HF | flicker | speck % |
|---|---|---|---|
| cinematic x1 | 3.46 | 0.20 | 6.1 |
| desktop x1 | 3.88 | 0.09 | 7.5 |
| cinematic x20 | 2.64 | 0.30 | 2.8 |
| desktop x20 | 2.45 | 0.23 | 1.4 |
| desktop x20, pre-S2 settings | 2.44 | 0.23 | 1.4 |

No smear, ghost trails or doubled edges at either level; desktop x1 keeps cinematic's detail and flickers less (the upscaler's accumulation), with slightly more specks (as U2 found). In time-lapse both go soft (the history), desktop a little more; S2 does not change that. U2's x1 cinematic for reference: HF 3.32, flicker 0.24, speck 5.7 %.

## Cost (sky trace, GPU ms, the page's timer)
Cinematic, horizon, 1280x720, frozen, one job alone on the machine (load 8-10), alternating old/new twice (`work/captures/S2/timing/`):

| | ground | gp7 | above |
|---|---|---|---|
| run a: old / new | 45.0 / 52.0 | 49.9 / 55.8 | 61.8 / 68.6 |
| run b: old / new | 38.8 / 42.5 | 46.2 / 48.1 | 54.3 / 56.5 |

**The bisection costs about +4 to +16 %, ~+10 % typical** (3 extra full samples per cloud entry). The sub-pixel box costs nothing. Desktop's trace stays about 0.35x of cinematic's in the same-session captures (horizon gp7 50.7 vs 146.4 ms at 1080p), laptop 1/4 about 0.12x, 1/3 about 0.2x.

## Device loss ("Insufficient Memory") on this machine
- Counted over every S2 capture start: **desktop/laptop lost the device in 38 of 73 page starts (52 %); cinematic in 0 of 38.** Step-frames at desktop: 5 of 9. Losses also happened with `upscalePath bilinear` (the upscaler's blit only, no temporal history), and the runs that lost it had completed shots before the loss (the warm-up shot rendered, the loss came during a later view's settle), so it is not only the upscaler's first frames as U2 saw.
- Looked for a leak or oversized allocation in the upscale path and found none: `upscale.ts` reallocates its three targets only on a size change and its bind group only when the layer's textures change; the upscaler core allocates on `configure` only (output, 2 history, 2 locks at display size, rgba16f: about 83 MB at 1080p; the rest at render size) and `_destroyTextures` frees every texture and buffer it made; per frame it only makes bind groups and views (garbage-collected objects, no GPU memory). The bilinear path, which allocates almost nothing, also loses the device, so the temporal path's memory is not the trigger.
- Not resolved. With swap full on this machine (13 of 14 GB) I cannot tell an environmental Metal out-of-memory from a real driver issue; U2's request stands: the owner should try desktop on a quiet machine. If it reproduces there, the next step is a Chrome GPU-process trace around the loss.

## What landed (all old behaviour selectable)
- `packages/runtime/src/procedural/trace.wgsl.ts`: the surface bisection at a cloud entry (`proc.surfaceRefine`, `surfaceRefineMode`, `surfaceGrow`, `surfaceRefineTau` in `ProceduralSettings`, packed into free lanes: `hybrid.w`, `spHorizon.w`, `tkTurb.w`, `spWind.w`); the noise-LOD pixel (`sky.lodLayerPixel`, off).
- `packages/runtime/src/shaders/sky-layer.wgsl.ts`, `sky-layer.ts`: `sky.jitterNoise` ('ign' default, 'blue' = a blue-noise storage buffer + golden ratio; a texture would have been the procedural trace's 17th sampled texture, over the default limit of 16), `sky.subPixelSpan` (2 = old), `sky.subPixelRotate` (off); both traces share `skyJitter` / `skySubPixel`.
- `packages/runtime/src/runtime.ts`: `levelSubPixelSpan` (default 1) and `levelLodLayerPixel` (off) applied at the desktop/laptop levels only. **Cinematic's only change is S2a.**
- Bench: Review switches **S2a** (surface hatch: off / 3 / 5, slider) and **S2b** (desktop/laptop sub-pixel box: old 2 px / new 1 px); the tune panel's "Ray march" and "Render level" groups have every new setting; the U2 tip updated.
- Scripts: `scripts/s2/` (cap.sh with retries on lost devices, check.py, sheet.py, metrics.py, motion.sh, motion_metrics.py).
- Tests: `settings.test.ts` (the bisection words). `pnpm typecheck` clean; `pnpm test` 330 of 330 passed (fine.test.ts passed this time).

## Defaults (agent-chosen, please flip on the bench)
- **`proc.surfaceRefine` 3** with `surfaceRefineMode` 1, `surfaceGrow` on, `surfaceRefineTau` 0 (Review S2a; 0 = the old march). Affects every procedural sky, all levels.
- **`c.levelSubPixelSpan` 1** at desktop/laptop (Review S2b; -1 = the old 2-pixel box).
- Kept as they were: `sky.jitterNoise` ign, `sky.subPixelSpan` 2 at cinematic, `upscaleSharpness` 0.5, `levelScaleLaptop` 0.25 (I recommend 0.33).

## Open
1. A faint checker is left on foamy tops seen from `above` at desktop (fainter than before, still more than cinematic). The remaining sources I can name: the lighting reuse along the ray (a light evaluation is reused for up to 20 m, which step positions get fresh light depends on the jitter) and exits from thin features (only entries are bisected). Next step: the same bisection at exits, or a light refresh at the first sample past the entry.
2. Real style's lit faces now show the detail noise's curl streaks (see above): owner's eye.
3. Cinematic could also take the 1-pixel sub-pixel box (`sky.subPixelSpan` 1): not tried here (P7-E set 2 for thin stacked layers near the horizon; needs its own round).
4. The upscaler still runs without jitter; true reconstruction needs a fresh full-frame trace under its jitter (16x the trace), or a different amortisation design. Not attempted.
5. Device loss (above).
