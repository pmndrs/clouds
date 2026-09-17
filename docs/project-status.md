# Project status

Updated 2026-09-17 (Japan time).

## Current position

- **P0:** technical work is complete and locally accepted for the local WebGPU backend. The diagnostic lab is available at [`http://127.0.0.1:5173/`](http://127.0.0.1:5173/).
- **P1:** technical baseline is complete and accepted locally. The first-cloud viewer is available at [`http://127.0.0.1:5173/clouds/`](http://127.0.0.1:5173/clouds/). User review remains open for the R1 shape preference and the reported floor-shadow view.
- **L1:** independent 2D layer preview is available at [`http://127.0.0.1:5173/layer-only/`](http://127.0.0.1:5173/layer-only/); it is not a final cloudscape acceptance.
- **P2:** implementation is ready for R2 review at [`http://127.0.0.1:5173/cloudscape/`](http://127.0.0.1:5173/cloudscape/). The local technical suite passes (42 unit tests, 19 GPU checks); human coverage, repetition and motion judgment remain open. This is a prototype checkpoint, not final cloudscape acceptance.
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

**P2 now available for R2 review:** [`/cloudscape/`](http://127.0.0.1:5173/cloudscape/)
has the fixed flight and free-camera path. The conservative lookup and density-rebase checks pass. Matched 960 × 540 cloud-pass measurements are 0.98–1.38 ms p50, with cache work reported separately. A five-view review sheet is available via **Save flight sheet**. P2 now pauses at R2 because finite horizon coverage and repeated forms need visual judgment before selecting further treatment.

## Evidence and limits

See [P0 evidence](p0-evidence.md), [P1 evidence](p1-evidence.md), the [P2 evidence](p2-evidence.md), the [implementation plan](implementation-plan.md), and the [work queue](implementation-work-queue.md). Local technical checks and the M5 Pro development environment do not establish RTX 3060/Windows results, injected device-loss recovery, final cloudscape coverage, final shadow caching, reconstruction, packaged APIs, R3F v10 bindings or release readiness.

Human observations and automated technical results should be recorded independently using the [human review guide](human-review.md).
