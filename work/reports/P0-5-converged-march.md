# P0.5: converged march (ground truth for the image)
Branch `worktree-agent-a63dc59bce438d9d1`, not merged. Plan step: docs/AUDIT-2026-11.md 0.5. Gate: **pass**, with two notes: `above` still moves a little from 4x16 to 8x32 (term 2), and the HZD normal-vs-converged brightness shift is explained by step-size terms, not a changed integrand.

## What it is, how to switch it on
- `CloudSettings.converged` 0/1, `convergedStepScale` 4, `convergedSamples` 16 (+ diagnostics `convergedBands`, `convergedSeed`, `convergedKeep`). Off = pixel-identical: HZD gp7 at a frozen phase (`sky_temporal=0&sky_freezeCycle=0`), 0 of 921,600 pixels differ on the final code.
- On: the voxel passes, the procedural trace and the NVDF sky trace trace every pixel every frame at output size (no 1/k or 1/16, no history, level cinematic: no upscaler); every step / stepScale, budget x stepScale x 4; light taps fresh at every lit step; cutoff 1e-4; 16 samples, each with its own jitter (blue noise + golden ratio of the sample index) and sub-pixel offset (Halton 2,3, a 1-px box), summed in rgba32float on the composite's linear output, then the page's blend and ACES. Wind and clock stop; the sum restarts on any view, sun or setting change, light-grid swap or shadow-map write. A sample is traced in row bands over several frames (a whole 8x sample in one submission hung the page under load). Roughly 1.5 s per sample on gp7, 3-4 s on above, under 1 s on the flagship (loaded machine).
- HZD: sidebar Review **P05** on/off, **P05b** step divisor, **P05c** samples; tune group "Converged march (P0.5)"; URL `c_converged=1`; HUD counts samples. Flagship: panel checkbox "converged", `?converged=1` (`s.convergedStepScale=8`, ...).
- `__clouds.settle(n)` waits n frames, then until the sum is done (new `busy()` in the harness contract): `capture.mjs --settle 4 --eval-timeout 1800`.

## Gate (1280x720, PNG after tone mapping, |d| on 0..255 per channel, `scripts/gpu/converged-diff.py`)
| view | stability: 2 runs; seed 0 vs 16 mean (p99) | 4x16 vs 8x32: mean, p99, signed luma | normal vs converged: mean, p99, signed luma |
|---|---|---|---|
| HZD gp7 | identical; 0.13 (2) | 0.17, 2, +0.11 | 1.83, 18, +0.80 |
| HZD above | identical; 0.23 (3) | 0.48, 5, +0.27 | 2.91, 31, +2.20 |
| flagship Parkouring ground (cloud crop) | identical; 0.09 (1) | 0.05, 1, +0.00 | 1.16, 16, -0.56 |

No fixed pattern in the seed difference (grain and sub-pixel edge lines). For scale, two normal gp7 captures differ by 1.15 mean, p99 14. Normal vs converged: the foam (one-pixel speckle on lit faces) is gone in converged (sampling: it is gone at step/1 too); the flagship's upsampled near/far passes put a bright rim outside the true silhouette; the rest is the terms below (mostly step size: table and term 2), which also brighten shaded bases and distant tops. Converged mode itself changes no integrand.
Sheets, work/captures/P0-5/: `gp7-normal-vs-converged`, `gp7-crop-normal-vs-converged` (1:1), `above-normal-vs-converged`, `flagship-ground-normal-vs-converged` (1:1), `*-convergence-4x16-vs-8x32` (x32), `above-step1-vs-step4`, `gp7-stability-seed0-vs-seed16`.

## Attribution: converged 4x16 with one normal shortcut put back (signed luma, p99)
| put back | gp7 | above | flagship crop |
|---|---|---|---|
| thin-segment light skip (`convergedKeep=1`) | -0.79 (10) | -0.72 (10) | -1.60 (20) |
| light-tap reuse (`=2`) | +0.19 (4) | +0.12 (2) | +0.00 (3) |
| cutoff with mean-colour continuation (`=4`) | -0.41 (6) | -0.13 (6) | -0.00 (1) |
| no step division (`convergedStepScale=1`) | -0.52 (12) | -1.76 (20) | +0.00 (1) |
| normal frame, `proc.maxSteps` 1024 not 256 | +0.18 (normal noise) | +0.43 (11, horizon band) | n/a |

## Sampling shortcuts (V voxel march `shaders/march.wgsl.ts`, P procedural `procedural/trace.wgsl.ts`, S NVDF sky `shaders/sky-layer.wgsl.ts`)
| shortcut | converged |
|---|---|
| 1/k (V) or 1/16 (P, S) pixels per frame + history resolve (blend, reprojection, clamp, history filter) | off |
| passes below output size (V near/far scale, renderScale; P/S resolutionScale; render levels + upscaler) | output size, no upscaler |
| per-frame jitter (V blue/IGN, static past 250 m; P/S IGN per 16-frame cycle), sub-pixel (V none; P/S Halton over 2 px, mod 16) | sample-index sequences, 1-px box |
| fixed step phase (V `stepJitter` 0) | random phase at the entry |
| step lengths (V 0.08 sqrt t; P fine 1.5 px cone, coarse 4x, surface 0.5/sigma, 3x past depth 1-3; S 8 m + 0.6 % t) | all / stepScale |
| step widening in thin / dark-deep media, growth past 256 steps (V) | off |
| step budget (V maxSteps, "T < 0.3 at the cap = opaque"; P 256 steps, far rays end early) | x stepScale x 4 |
| coarse search, back to coarse after 4 empty fine steps (P) | kept, / stepScale, after 4 x stepScale |
| transmittance cutoff (V 0.005-0.08, P/S 0.05) + mean-colour continuation | 1e-4 |
| thin segments (sigma ds < 0.002) attenuate but add no light (V, P, S) | off |
| light taps reused along the ray (V 4 m; P min(3 fine steps, 20 m+) and 8 % density; S 24 m + 3 %) | off |
| far pass skips pixels behind opaque near cloud (V) | off |
| kept as part of what is integrated: tap geometry and counts (V 0-16-48 m + grid + micro taps; P 6 cone + 4 far + 2 up: more taps move the cone), P's cheap tap density past half opacity, light grid (waited for), noise LOD at the output pixel, detail/fine distances, S2 bisection, PF1 exact skip, one aerial perspective per ray, cirrus/mid layers (not supersampled) | kept |

## Step-size or sample-placement dependence that is not noise
1. **Thin-segment light skip** (`march.wgsl.ts:140, 265`; `trace.wgsl.ts:287`; `sky-layer.wgsl.ts:714, 870`): the segment is attenuated (`T *= stepT`) but adds no light, so smaller steps lose more energy (at /4: -0.79 luma gp7, -0.72 above, -1.60 on the flagship cloud). Should skip the lighting, not the light (reuse the last lit value) before Phase 3 compares step sizes.
2. **First-order segment quadrature** (P: density and light at the step's start for the whole step, `trace.wgsl.ts:285-286, 343`; V/S: one jittered sample for the segment, `march.wgsl.ts:255-264, 343`, `sky-layer.wgsl.ts:856`): at a cloud entry the density ramps up within the first steps, so the lit skin is under-weighted at coarse steps, and step-period contour arcs show once the noise is averaged (`above-step1-vs-step4`). Step 1 to 4: +0.52 gp7, +1.76 above; 4 to 8: +0.11, +0.27 (about first order; the same with edge darkening off: +0.10, +0.26). The voxel march (flagship) is already step-converged at step/1 (0.06 mean). So converged 4x16 is still about 0.1 (gp7) / 0.3 (above) luma below the limit; 8x32 halves that.
3. **Edge darkening reads the deepest sample** (`trace.wgsl.ts:344, 356`; `march.wgsl.ts:341, 364`, there the stepping bound, not the true distance; `sky-layer.wgsl.ts:927`): fewer samples find a shallower maximum, so thin edges darken more at coarse steps. Not measured alone; small next to 2 (the 4-vs-8 change is the same with it off).
4. **Cutoff continuation** (`trace.wgsl.ts:353-354`, `march.wgsl.ts:360`): continuing the last 5 % as the front's mean colour is not neutral (deeper cloud glows brighter here): -0.41 gp7.
5. **Light-tap reuse** (`trace.wgsl.ts:290`, `march.wgsl.ts:267`): taps from nearer the surface reused deeper in light the normal frame slightly too much: +0.19 gp7.
6. **Step budget** (P `proc.maxSteps` 256): far rays on `above` end before the far clouds; 1024 steps add +0.43 luma in the horizon band (p99 11). Truncation, not noise.

## Open problems
- The converged frame has no foam: under the current light and density, the foam is sampling. Whether a look wants some of it back is an owner call.
- Contour lines on gp7's shaded bases are in every converged frame (both seeds): density or light, not sampling.
- vitest (packages/runtime, examples/lab/hzd): 184 of 184 pass (2 new); two "Timeout calling onTaskUpdate" worker errors come from the 95 s P13-H4 fine-hero import test blocking its worker, not from this change. Typecheck clean.
