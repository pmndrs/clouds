# P4 reconstruction contract

Started 2026-09-17 at the user's request. P3 atmosphere refinement and P2 coverage defects remain open; progressing to P4 does not declare those stages visually complete.

## One history owner

The user's `@pmndrs/upscaler` 0.2.0 snapshot owns final-scene temporal jitter and history. All scene and cloud samples in that input use the same jittered projection. The scene velocity node and cloud projection guides use unjittered current/previous matrices. Jitter is removed before returning control to the host. Native and spatial modes have no temporal history.

The evaluation modes are native rendering, reduced-resolution bilinear, final-scene FSR1, final-scene FSR3 temporal, and cloud-only spatial reconstruction over a full-resolution opaque scene. The cloud-only spatial path filters radiance and transmittance with identical weights and composes `L + T × background` once; it does not pass cloud transmittance through an opaque FSR pipeline or assume generic alpha support proves optical correctness. Cloud-only temporal reconstruction and double temporal reconstruction are not enabled by this first contract.

## Temporal inputs

- Linear HDR scene-plus-cloud color, before final tone mapping.
- Packed guide texture: current-minus-previous **NDC** motion in RG, conventional WebGPU device depth in B, reactivity in A. Native compute unpacks motion/reactivity; a depth-only raster pass writes the depth32float input required by the upscaler.
- Cloud depth is an extinction-contribution-weighted distance along the view ray. When cloud opacity exceeds 0.5, the guide uses that cloud depth/motion. Otherwise it uses the opaque scene depth/velocity (or rotation-dominated sky motion).
- Moving opaque objects use Three's velocity output. Stationary world-space cloud density uses camera reprojection. One representative depth cannot describe every transparent layer; mixed cloud/background pixels receive high reactivity `4 × opacity × transmittance` so history contributes less there.
- Sun/density/source edits, camera cuts, resize and mode/scale changes reset history. Ordinary camera travel does not. Geometry lighting changes also rely on the upscaler's shading-change rejection.
- No advection motion is claimed: the current source has no full-cloud wind simulation. This remains an explicit missing dynamic-source test, not a silently passed P4 exit criterion.

## Baselines and judgment

Native means native pixel resolution with the same current density source, marching and lighting. It is a reconstruction reference, not ground truth for physical cloud shape, LOD, atmosphere or spatial sampling. The wipe compares the same camera pose and lighting. Its additional native rendering is excluded from timed comparisons.

Cloud-only spatial filtering uses opaque depth to reduce leakage across foreground silhouettes. A rejected or undersampled edge may lose cloud contribution; this must be judged against the native view and remains a failure if objectionable. Sharp opaque geometry in this mode does not prove cloud edge quality.

## Measurement

Measure a whole submitted scene → clouds → reconstruction → presentation span, alongside CPU submission. Diagnostic timestamp boundaries on the shared GPU queue include intervening queue-idle gaps and are labeled a GPU queue span, not the sum of shader execution times or display latency. Warm-up and readback wall time are excluded from the reported sample distribution; environment rebakes and native comparison rendering are excluded explicitly. The lab is serialized during measurement.

No preset is accepted merely because its cloud march is faster. Report settings, output/input dimensions, device/browser, warm-up/sample counts, p50/p95, quality findings and whether net frame cost improves. Windows/RTX evidence remains separate. The review guide records missing evidence and unresolved defects before any P4 acceptance claim.


The first lab runtime generates guides in every comparison mode. Its measured
baseline is therefore diagnostic: native/spatial paths include unused guide
work. Remove that work from non-temporal paths before accepting net savings.
Resolve each timestamp boundary into its own buffer offset immediately; the
initial cross-submission query approach returned invalid zero spans on Metal.
