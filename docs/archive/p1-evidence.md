# P1 — first voxel cloud evidence

Local checkpoint: 2026-09-17 (Japan time). **P1 technical prototype accepted locally; R1 visual preference is pending.** This does not claim cloudscape coverage, final art quality, production shadow support or Windows validation.

## Runnable results

- `/clouds/`: dense 64³ generated voxel cloud, Cumulus/Tower/Wisps and synthetic authored form, orbit/ground/side/inside/fly-through controls, density/physical-size/sun settings, full-march/occupancy toggle, both directional reference shadow directions, capture/report controls.
- `/layer-only/`: independent animated TSL hemisphere layer, coverage/density controls, transparent gaps preserving the host background, opaque depth occlusion. No voxel, asset or React module is imported by this runtime.
- `/`: P0 interop and sky/environment fixtures remain available.

Shared Three-owned textures are passed to raw WGSL on Three's device. The optical output is linear HDR radiance plus transmittance, composed with opaque scene color before final tone mapping. See the [reference renderer contract](../../packages/three/src/volumetric/README.md).

## Technical evidence

`pnpm check`: TypeScript, 21 unit tests in 8 files, and a three-page production build passed. The existing large Three bundle advisory remains; it is not a build failure.

Fourteen checks execute the actual GPU shader on small offscreen targets (11 initial cases plus 3 shadow-fix regressions). Optical comparisons use a tolerance fixed at 0.001 before measurement, including half-float storage error.

| GPU case | Observed result |
| --- | --- |
| Homogeneous 500 m Beer–Lambert transmittance | Absolute error 0.000204 |
| Unit-light radiance + transmittance conservation | Error 0.000488 |
| Foreground object stops march at 100 m | Error 0.000371 |
| Camera inside volume, near plane to exit | Error 0.000207 |
| Double world scale / halve extinction | Error 0.000204 |
| Empty density | Exactly zero radiance / unit transmittance |
| Conservative occupancy vs full march | Identical stored optical pixels; tolerance 0.00001 |
| Opaque box casts into cloud | Maximum radiance reduction 0.118; minimum required 0.001 |
| Cloud casts onto opaque ground | Maximum radiance reduction 0.75; minimum required 0.01 |
| Distant ground under small camera translations | Zero error after fix; tolerance 0.002 |
| Unmarked opaque surface above floor | Zero unintended ground-shadow contribution |
| Host render target and MRT state | Restored after cloud render |
| Resize | 23×17 readback shape and all finite values |
| Repeated dispose | Safe; subsequent rendering rejected |

Unit coverage includes seeded sources, empty boundary guards, trilinear occupancy halos, ray/box boundary and parallel-axis cases, plus the existing P0 contracts/harness. The occupancy path only avoids density reads for certainly empty bricks at the same sample positions; spatial brick traversal comes later. It matches the full march numerically but is not yet assumed faster.

Browser inspection confirmed generated forms, visible ground shadow, inside-camera behavior, the independent layer, and zero layer coverage preserving the original background. Final captured cloud evidence has no GPU/runtime errors. During integration, a warm-up metrics exception and a layer demo route were fixed. An independent Luna reviewer identified a validation-scope cleanup issue; it was fixed before final acceptance.

### Human-reported floor-shadow flicker follow-up

The user reports that views work and stylized forms are acceptable provisionally, but the floor shadow appears to z-fight. This is not intended. A voxel-renderer regression reproduced discontinuous shadow application: the previous `abs(reconstructedWorldY) < 0.5` receiver test failed as perspective-depth precision degraded with distance, producing an error of 0.75 against a uniformly shadowed floor. The old test only verified that *some* ground pixels darkened and missed this discontinuity.

The fix writes an explicit ground-receiver material mask alongside opaque color/depth and computes its Y=0 shading position from an analytical ray/plane intersection. The continuity test uses a large floor under a homogeneous overhead slab, a camera 6 km away and small translations; it now measures zero error. Additional GPU checks verify that unmarked surfaces are unaffected and host render/MRT state is restored. All 14 GPU checks, 21 unit tests and the production build pass. Local follow-up evidence is in `artifacts/p1/2026-09-17/shadow-fix/`.

This fixes the reproduced voxel-scene defect. The exact scene/settings of the user's report and their visual confirmation remain open; no separate P0 sphere-scene defect has been reproduced. Track that human retest in [the review guide](human-review.md).

## First GPU timing calibration

Historical measurements from before the receiver-mask fix; rerun the viewer's timing sweep for current costs. These figures should not be presented as measurements of the updated renderer.

Local browser reports Apple / `metal-3`, Chrome 152. Hardware model is not exposed by this browser report. The user identifies their local machine as M5 Pro; RTX 3060/Windows remains untested.

Fixed side camera, Cumulus seed 0, 64³ density, 96 view samples / 12 light samples, both shadows enabled, occupancy enabled. Each configuration discards 8 warm-up samples and reports 30 GPU timestamp samples; p50/p95 use linear percentile interpolation. Serialized diagnostic submissions are a calibration, not a steady-state frame-rate benchmark.

**The measured pass includes cloud integration, self/object lighting, ground shadows and compute composition. It excludes opaque scene rendering, the final display quad, generation/upload, environment updates and reconstruction.** Live viewer timings remain CPU submission measurements. The initial report’s `generationCpuMs` includes renderer setup as well as source preparation; current code separates initial renderer setup and pure CPU generation.

| Requested output | Internal scale | Internal size | GPU p50 | GPU p95 |
| --- | --- | --- | ---: | ---: |
| 1920×1080 | 0.5 | 960×540 | 1.25 ms | 1.48 ms |
| 1920×1080 | 0.75 | 1440×810 | 2.23 ms | 3.19 ms |
| 1920×1080 | 1 | 1920×1080 | 3.70 ms | 5.12 ms |
| 2560×1440 | 0.5 | 1280×720 | 1.84 ms | 2.79 ms |
| 2560×1440 | 0.75 | 1920×1080 | 3.67 ms | 5.02 ms |
| 2560×1440 | 1 | 2560×1440 | 6.62 ms | 7.91 ms |

Density payload is 256 KiB plus 512 bytes of occupancy. The original three RGBA16F color targets and depth32float target accounted for 28 bytes per internal pixel; the receiver-mask fix adds RGBA8, bringing the current total to **32 bytes per internal pixel**. These are payload estimates, not total driver memory or all host-renderer allocations. The current scale control spatially scales the whole reference scene, so opaque edges also lose resolution. It does not demonstrate cloud-only reconstruction or FSR.

A second sweep with identical scene settings and occupancy **disabled** measured native 1080p at **1.44 / 2.72 ms** p50/p95 and native 1440p at **2.49 / 3.24 ms**. Half-resolution 1080p was 0.72 / 1.40 ms. The extra occupancy texture lookups/branches cost more than they save in this small field, so the full march is now the default. The exact-image-equivalent occupancy switch remains available for P2 experiments. These are separate serialized runs, not a randomized performance study.

Recommendation: retain half-resolution preview and native reference controls for P2. Use 4 ms p50 at 1080p-equivalent internal resolution as a **provisional compute-pass investigation threshold on this machine**, not a release target. First test dense inside views and broader coverage, split shadow cost, and collect Windows results before committing a quality budget. Keep procedural fine detail and residency experiments driven by those measurements.

Raw local outputs (ignored by Git) are under `artifacts/p1/2026-09-17/`: `report.json` (occupancy on), `full-march-report.json` (occupancy off), `cumulus.png`, `tower.png`, `wisps.png`. Captures and reports can be regenerated from the viewer.

## Boundaries and next phase

- Forms are simple CPU-generated lobes/noise with soft boundaries. This is a reference implementation, not a Nubis³ port or final cloud appearance.
- The synthetic authored choice exercises the same density payload interface. It is not an actual DCC/VDB import; that extension remains A/P6.
- The box caster is analytical and axis-aligned. Cloud shadows target the reference Y=0 ground plane. Arbitrary casters/materials, robust shadow caching and atmosphere/environment contribution remain P3.
- P1 has no temporal history, FSR, cloud motion, sparse storage, multiple volume overlap solution or broad horizon coverage. R3F v10 bindings remain P5.
- P2 should establish a stable world-space field, ground-to-cloud coverage and medium/far representations before expanding renderer features. R1 asks which provisional silhouette direction to favor; lack of art feedback does not block correctness work.

## Delegation record

Three bounded workers used `gpt-5.6-luna` with high reasoning and fresh task context: density sources/occupancy, independent TSL layer, and box-shadow math plus focused integration review. Density and layer each received one focused correction. The orchestrator owned shared GPU integration, viewer/build routing, real GPU tests, timing calibration and acceptance. No measured dollar/token-savings claim is made.
