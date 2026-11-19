# S2: the hatch on hard lit faces, and desktop quality

Status: ready for review. Branch `worktree-agent-a1f8315a98f82ba50` (not merged).

## Verdict
- **Defect 1 (fine diagonal hatch on hard lit faces): cause found and fixed.** The procedural march takes one point sample per step. Where a ray enters a cloud from an empty sample, the per-pixel step jitter (interleaved gradient noise, IGN) decided how deep under the surface the first sample inside landed: anywhere in a fine step (25 m and more). On a hard surface the ray is nearly opaque within that step, so the pixel took the colour of a point up to 25 m deep, and the depth followed IGN's diagonal lattice. The sky layer's history keeps 0.3 of every newest sample (one per pixel per 16 frames), so it never averages that out: the hatch. Fix (`proc.surfaceRefine`, default 3): at every entry from an empty sample, halve the last empty step 3 times and start integrating at the surface found (with the first inside sample's density), growing the step from 0.15 of a fine step. Old march: `surfaceRefine 0` (Review **S2a**).
- **Defect 2 (desktop softer, grain gone, hatch): mostly fixed, partly explained differently from U2's diagnosis.**
  - The hatch at desktop is the same hatch as defect 1 at twice the pixel size, sharpened by the upscaler's RCAS. The S2a fix takes most of it out; a fainter one is left on the foamy horizon tops seen from `above`.
  - The softness was the layer's own sub-pixel jitter: the trace offsets each ray by a Halton point spanning **2 layer pixels**, and the history averages over it, i.e. a 2x2 layer-pixel box = 4x4 output pixels at desktop (8x8 at laptop) before the upscaler sees anything. New `c.levelSubPixelSpan` (default **1** at desktop/laptop, Review **S2b**): lit ridges at desktop are now as crisp as cinematic by eye and by the edge measure.
  - Rendering the layer under the upscaler's Halton jitter (or tying the amortisation phase to it) is not workable as such: each frame only 1/16 of the layer is fresh, the rest is history traced under older offsets, so telling the upscaler "this frame is offset by J" misregisters 15/16 of it; the only consistent version is a full fresh trace every frame (U2 measured that path at about 16x the trace cost). Not done.
- **Laptop:** see "Laptop 0.25 vs 0.33" below.
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

RESULTS_PLACEHOLDER
