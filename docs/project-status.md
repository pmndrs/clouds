# Project status

Updated 2026-09-17 (Japan time).

## Current position

- **P0:** locally accepted for the local WebGPU backend. The diagnostic lab is available at [`http://127.0.0.1:5173/`](http://127.0.0.1:5173/).
- **P1:** technical baseline accepted locally. The first-cloud viewer is available at [`http://127.0.0.1:5173/clouds/`](http://127.0.0.1:5173/clouds/). The reported voxel floor-shadow dropout has been fixed and passes its regression; human retest and R1 shape preference remain open.
- **L1:** independent 2D layer preview is available at [`http://127.0.0.1:5173/layer-only/`](http://127.0.0.1:5173/layer-only/); it is not a final cloudscape acceptance.
- **P2:** next stage; not started. The next concrete work is stable world-space coverage, distance representations and transition measurements.
- **P3–P6:** planned and not runnable yet. Asset work begins with the A track after the P1 source contract; release validation remains P6.

## Capability table

| Ready now | Next | Later |
| --- | --- | --- |
| P0 interop/sky diagnostic at `/` | P2 world-space coverage, distance representations and transitions | P3 production lighting, sky/environment and cache invalidation |
| P1 dense voxel viewer at `/clouds/` | Human shadow retest; P2 coverage can proceed | P4 reconstruction and measured presets |
| L1 independent 2D preview at `/layer-only/` | R1 shape review and L1 follow-up in P2/P3 | P5 packaged Three/R3F v10 APIs; P6 validation/release and the asset extension |

## Latest review context

The user reports that the views seem to work and the stylized forms are acceptable for this provisional stage. They also reported apparent floor-shadow z-fighting, which is not intentional.

**Fixed locally:** the P1 renderer was identifying the floor using a depth-derived world position. Precision loss caused shadow pixels to drop out at distance. An explicit material receiver marker and analytical floor intersection now replace that guess. The new continuity regression changed from 0.75 error to zero; all **14 GPU checks, 21 unit tests and the production build pass**.

**Still open for the human review:** retest the affected view and identify whether the original report referred to the voxel cloud or P0 spheres. No separate P0 shadow defect has been reproduced. A preferred P2 silhouette mix is also unselected. These observations are recorded in the [review guide](human-review.md#current-human-review-record--2026-09-17).

## Evidence and limits

See [P0 evidence](p0-evidence.md), [P1 evidence](p1-evidence.md), the [implementation plan](implementation-plan.md), and the [work queue](implementation-work-queue.md). Local technical checks and the M5 Pro development environment do not establish RTX 3060/Windows results, injected device-loss recovery, production cloudscape coverage, final shadow caching, reconstruction, packaged APIs, R3F v10 bindings or release readiness.

Human observations and automated technical results should be recorded independently using the [human review guide](human-review.md).
