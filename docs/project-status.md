# Project status

Updated 2026-09-17 (Japan time).

## Current position

- **P0:** technical work is complete and locally accepted for the local WebGPU backend. The diagnostic lab is available at [`http://127.0.0.1:5173/`](http://127.0.0.1:5173/).
- **P1:** technical baseline is complete and accepted locally. The first-cloud viewer is available at [`http://127.0.0.1:5173/clouds/`](http://127.0.0.1:5173/clouds/). User review remains open for the R1 shape preference and the reported floor-shadow view.
- **L1:** independent 2D layer preview is available at [`http://127.0.0.1:5173/layer-only/`](http://127.0.0.1:5173/layer-only/); it is not a final cloudscape acceptance.
- **P2:** R2 feedback is received and returned for coverage work at [`http://127.0.0.1:5173/cloudscape/`](http://127.0.0.1:5173/cloudscape/). The user reports that all GPU checks pass, that the fixed flight is substantial, and that scale, spacing, entry and provisional repetition are good. The current P2 stage is accepted as sufficient to continue provisionally; distant-cloud pop-in, distance/LOD continuity, shadows beyond view-faded clouds, finite coverage and weather semantics remain open quality debt.
- **P3:** the first lighting/environment slice is runnable at [`http://127.0.0.1:5173/lighting/`](http://127.0.0.1:5173/lighting/). P3.1 and P3.2 bounded prototypes are integrated; P3.3 is partially running. P3 is not complete and R3 human review is pending. P4 now has a reconstruction comparison preview at [`/reconstruction/`](http://127.0.0.1:5173/reconstruction/). R4 visual review and preset acceptance remain pending; P4 remains the maximum authorized phase. See the [critical review guide](p4-review.md) and [P4 evidence](p4-evidence.md). P2.4–P2.6 future coverage/weather packets remain tracked and are not blockers to compatible P3 lighting work. P5–P6 remain planned and not runnable yet.

The current P2 slice uses an eight-form 96³ r8 atlas, 81 resident world-cell
descriptors, near/medium volumetric formations and a separate thin high/far
layer. The lighting cache is still a provisional P2 resource; production
shadow and environment cache behavior belongs to P3. The user has authorized
autonomous progression through P4 at most; that authorization does not change
the phase acceptance gates.

## Capability table

| Ready now | Next | Later |
| --- | --- | --- |
| P0 interop/sky diagnostic at `/` | R3 lighting review | P5 packaged APIs (not authorized yet) |
| P1 voxel, P2 cloudscape and P3 lighting viewers | Open distance/LOD, atmosphere and shadow quality work | R3F v10 and asset tooling |
| L1 layer and P4 reconstruction preview | R4 critical comparison and measured preset selection | Windows/RTX validation; release preparation |

## Latest review context

The user reports that the views seem to work and the stylized forms are acceptable for this provisional stage. They also reported apparent floor-shadow z-fighting, which is not intentional.

**Fixed locally:** the P1 renderer was identifying the floor using a depth-derived world position. Precision loss caused shadow pixels to drop out at distance. An explicit material receiver marker and analytical floor intersection now replace that guess. The new continuity regression changed from 0.75 error to zero; the P1 checkpoint passed **14 GPU checks, 21 unit tests and the production build**. The later P2 checkpoint reached 47 unit tests; current P3 counts are maintained in [P3 evidence](p3-evidence.md).

**Still open for the human review:** retest the affected view and identify whether the original report referred to the voxel cloud or P0 spheres. No separate P0 shadow defect has been reproduced. A preferred P2 silhouette mix is also unselected. These observations are recorded in the [review guide](human-review.md#current-human-review-record--2026-09-17).

**R2 review received:** [`/cloudscape/`](http://127.0.0.1:5173/cloudscape/)
has the fixed flight and free-camera path. The conservative lookup and density-rebase checks pass, and the user reports all GPU checks pass. Scale, spacing, entry and provisional repetition are acceptable. The review returned the work to P2 coverage: distant clouds pop in harshly and too late, shadows can lead their clouds, coverage hides whole clouds, and density cannot reach zero or a wispy value. Sun and shadows move but shadows remain boxy; lookup produces no visible appearance change. The original report found animation working in IAB but not Chrome; the clock fix below now progresses in Chrome. A five-view review sheet is available via **Save flight sheet**. The user subsequently accepted the current P2 stage as fine for continuing provisionally; this does not erase the open P2 quality debt or constitute an all-visuals-passed result.

The latest observation adds that, when the camera turns or looks down, shadows can remain visible beyond clouds that have already faded from view. The current fade is based on horizontal camera distance, while the tower formation is not centered on the camera; shadows also include view-hidden clouds. Carry distance/LOD representation and view/shadow agreement forward as an issue to resolve during progress. P2.4–P2.6 remain future coverage/weather packets and do not block compatible P3 lighting work.

The playback clock now retains full precision independently of the slider. Tests cover 60, 120, 144 and 240 Hz; Chrome camera movement beyond 30 seconds was observed with no application errors. Density now reaches zero with 0.005 increments, and zero-density rendering was verified in Chrome. The old Coverage control is now labeled Cloud population and reaches zero; a weather-coverage driver remains pending. The prior P2 checkpoint passed 47 unit tests and 19 P2 GPU checks in Chrome; current P3 counts and captures are recorded in [P3 evidence](p3-evidence.md).

The first P3 lighting/environment slice is runnable at `/lighting/`. P3.1 and
P3.2 bounded prototypes are integrated and P3.3 is partial. It provides Three
directional scene-depth shadows into the volume, explicit `receivedShadowNode`
receivers, cache-before-material-draw, and geometry movement without cloud-cache
rebuild. A fixed separate six-face linear-HDR cloud+sky cube and PMREM support
explicit asynchronous environment refresh; the main background stays sky-only
and the scene environment is preserved across attach/detach. Controls cover sun,
density, moving occluder, cloud/geometric-shadow toggles, sky-only/cloud-on-black/
composite views, overview/lighting objects/cloud occluder, and manual refresh.

P3 remains incomplete and R3 review is pending. Environment captures sky and
clouds only, so local terrain and objects do not appear in reflections; the fixed
probe has limited parallax; manual refresh intentionally remains stale until
clicked. Full atmosphere aerial-perspective LUT integration and calibrated sky/cloud lighting
remain open P3 work; the current pmndrs/sky aerial perspective is off and exponential cloud haze
is an approximation. Coarse cloud-shadow cache, stylized voxel/banding and
distance/LOD behavior remain known quality concerns to distinguish from an
integration bug.

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

The next P2 direction is informed by a direct [Nubis 2022/2023 LOD review](research/nubis-lod.md): persistent broad formations and near refinement from a shared source, with screen-resolution choices kept separate. This is planned, not implemented.

## Evidence and limits

See [P0 evidence](p0-evidence.md), [P1 evidence](p1-evidence.md), the [P2 evidence](p2-evidence.md), the [implementation plan](implementation-plan.md), and the [work queue](implementation-work-queue.md). Local technical checks and the M5 Pro development environment do not establish RTX 3060/Windows results, injected device-loss recovery, final cloudscape coverage, final shadow caching, accepted reconstruction presets, packaged APIs, R3F v10 bindings or release readiness.

Human observations and automated technical results should be recorded independently using the [human review guide](human-review.md). Questions already answered in the latest R2 review—provisional stylized forms, repetition, scale, spacing and entry—should remain logged rather than asked again.

## P4 review checkpoint

The comparison preview now includes native, reduced bilinear, cloud-only spatial,
final FSR1 and final FSR3 temporal reconstruction using the author's pinned local
upscaler snapshot. It exposes paired native comparison, fixed flight, foreground
bars, moving geometry, cuts, source/density/sun edits and benchmarks. Follow the
[P4 critical review](p4-review.md) and [technical evidence](p4-evidence.md).

P4 is **ready for critical review, not accepted**. Single-depth transparent
motion is approximate. Full cloud wind/advection is not implemented. Spatial
source quality, long-distance coverage, physical atmosphere, sustained motion
quality, supported-device results and validated presets remain open. Stop at P4.
