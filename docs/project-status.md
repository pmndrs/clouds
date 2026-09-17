# Project status

Updated 2026-09-17 (Japan time).

## Current position

- **P0:** technical work is complete and locally accepted for the local WebGPU backend. The diagnostic lab is available at [`http://127.0.0.1:5173/`](http://127.0.0.1:5173/).
- **P1:** technical baseline is complete and accepted locally. The first-cloud viewer is available at [`http://127.0.0.1:5173/clouds/`](http://127.0.0.1:5173/clouds/). User review remains open for the R1 shape preference and the reported floor-shadow view.
- **L1:** independent 2D layer preview is available at [`http://127.0.0.1:5173/layer-only/`](http://127.0.0.1:5173/layer-only/); it is not a final cloudscape acceptance.
- **P2:** R2 feedback is received and returned for coverage work at [`http://127.0.0.1:5173/cloudscape/`](http://127.0.0.1:5173/cloudscape/). The user reports that all GPU checks pass, that the fixed flight is substantial, and that scale, spacing, entry and provisional repetition are good. Distant-cloud pop-in, shadows ahead of clouds, finite coverage and weather semantics remain open; viewer playback and the density range have follow-up fixes. P2 is not accepted.
- **P3–P4:** not started. P5–P6 remain planned and not runnable yet. Asset work begins with the A track after the P1 source contract; release validation remains P6.

The current P2 slice uses an eight-form 96³ r8 atlas, 81 resident world-cell
descriptors, near/medium volumetric formations and a separate thin high/far
layer. The lighting cache is still a provisional P2 resource; production
shadow and environment cache behavior belongs to P3. The user has authorized
autonomous progression through P4 at most; that authorization does not change
the phase acceptance gates.

## Capability table

| Ready now | Next | Later |
| --- | --- | --- |
| P0 interop/sky diagnostic at `/` | P2 cloudscape at `/cloudscape/`; R2 coverage review and evidence | P3 production lighting, sky/environment and cache invalidation |
| P1 dense voxel viewer at `/clouds/` | R1 shape/shadow retest; P2 coverage can proceed | P4 reconstruction and measured presets |
| L1 independent 2D preview at `/layer-only/` | R1 shape review and L1 follow-up in P2/P3 | P5 packaged Three/R3F v10 APIs; P6 validation/release and the asset extension |

## Latest review context

The user reports that the views seem to work and the stylized forms are acceptable for this provisional stage. They also reported apparent floor-shadow z-fighting, which is not intentional.

**Fixed locally:** the P1 renderer was identifying the floor using a depth-derived world position. Precision loss caused shadow pixels to drop out at distance. An explicit material receiver marker and analytical floor intersection now replace that guess. The new continuity regression changed from 0.75 error to zero; the P1 checkpoint passed **14 GPU checks, 21 unit tests and the production build** (the current workspace has 42 unit tests).

**Still open for the human review:** retest the affected view and identify whether the original report referred to the voxel cloud or P0 spheres. No separate P0 shadow defect has been reproduced. A preferred P2 silhouette mix is also unselected. These observations are recorded in the [review guide](human-review.md#current-human-review-record--2026-09-17).

**R2 review received:** [`/cloudscape/`](http://127.0.0.1:5173/cloudscape/)
has the fixed flight and free-camera path. The conservative lookup and density-rebase checks pass, and the user reports all GPU checks pass. Scale, spacing, entry and provisional repetition are acceptable. The review returned the work to P2 coverage: distant clouds pop in harshly and too late, shadows can lead their clouds, coverage hides whole clouds, and density cannot reach zero or a wispy value. Sun and shadows move but shadows remain boxy; lookup produces no visible appearance change. The original report found animation working in IAB but not Chrome; the clock fix below now progresses in Chrome. A five-view review sheet is available via **Save flight sheet**. There is no P2 acceptance, and P3/P4 have not started.

The playback clock now retains full precision independently of the slider. Tests cover 60, 120, 144 and 240 Hz; Chrome camera movement beyond 30 seconds was observed with no application errors. Density now reaches zero with 0.005 increments, and zero-density rendering was verified in Chrome. The old Coverage control is now labeled Cloud population and reaches zero; a weather-coverage driver remains pending. The current workspace passes 47 unit tests, 19 P2 GPU checks in Chrome, type checking and all builds.

The current
slice fades volumetric view over approximately 4.4–7.7 km, leaves cached shadow
density unfaded, and has no far LOD or mass handoff. Treat bands and angular
voxel visibility as tracked spatial-reference quality debt before P4; treat
boxy shadow filtering as P3 quality debt. Do not promise an FSR fix.

## Phase quality expectations

| Phase | Quality bar |
| --- | --- |
| P0 | Diagnostic result and controls are legible; resize and lifecycle are stable. |
| P1 | A single cloud has readable scale, depth and continuous shadow behavior; stylized form is provisional. |
| P2 | Horizon coverage, near/far transitions, coverage/density semantics and shadow ordering are usable; repetition may remain provisional. |
| P3 | Sky, sun, shadows and environment agree with visible clouds, with credible softness and cache refresh. |
| P4 | Reconstruction and presets preserve detail through motion, cuts, disocclusion and foreground edges; spatial-reference image quality is ready for measurement. |

## Evidence and limits

See [P0 evidence](p0-evidence.md), [P1 evidence](p1-evidence.md), the [P2 evidence](p2-evidence.md), the [implementation plan](implementation-plan.md), and the [work queue](implementation-work-queue.md). Local technical checks and the M5 Pro development environment do not establish RTX 3060/Windows results, injected device-loss recovery, final cloudscape coverage, final shadow caching, reconstruction, packaged APIs, R3F v10 bindings or release readiness.

Human observations and automated technical results should be recorded independently using the [human review guide](human-review.md). Questions already answered in the latest R2 review—provisional stylized forms, simple atmosphere, repetition, scale, spacing and entry—should remain logged rather than asked again.
