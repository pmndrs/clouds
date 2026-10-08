# Project status

## Latest quality packet — 2026-10-08

The [procedural morphology packet](../research/morphology-study.md) is integrated
and is the default in `/realism/`: periodic weather, Perlin-Worley base boundary,
independent Worley erosion, explicit noise mips and shared view/light evaluation.
129 unit tests and 21 GPU checks pass; package build/pack and the independent
consumer pass. This is an isolated procedural source over the existing
integrator, not completed persistent voxel-world generation or visual parity.
VDB authoring remains parked. Next: matched lighting/sampling convergence and
sky-radiance calibration, then resident voxel integration and distance gates.
No minor appearance review is requested.


**Current execution directive — 2026-10-08:** the user withdraws the small
shape-review stops and authorizes completing the platform through P6, then
advancing realism autonomously toward three-geospatial's visual quality. Earlier
sequential/checkpoint text below is historical and no longer blocks compatible
platform/asset work. Do not request another appearance review of orb/placeholder
clouds. Use bounded lower-cost workers for platform, assets and source work; root
owns GPU integration and visual acceptance. Technical preview readiness does
not imply realistic appearance, final presets, hardware coverage or publication.

## Current platform and realism handoff — 2026-10-08

P5/P6 foundations are ready for the local preview: 122 unit tests pass with
full aggregate voxel assertions, TypeScript and production build pass, and the
packed online consumer passes. The P4 smoke record contains 29 GPU checks and
15 timing rows at 320×180 across five modes. Native, bilinear, cloud-only and FSR1 are guide-free;
FSR3 uses guides. Both comparison runtimes remain allocated. React dense-field parity is exactly zero after
field replacement, camera replacement and remount.

The implementation now includes realistic reference appearance, GPU density
bake and optical-depth cache, ray jitter and multiple-scattering approximation,
CPU density generation, `DensityCloud`/`useDensityCloud`, an offline VDB
converter with Houdini 21 bridge, and finite curved/concave mesh conversion
checks. These establish platform foundations and transport paths; they do not
accept final appearance, performance presets, RTX/Windows compatibility,
streaming, or publication.

Houdini 21 source setup works; the old license and Qt probe are obsolete. Real
fog VDB and four CLDA variants have native-parity evidence with quantization
error at or below 0.5/255. Native Blender reference artifacts are available in
`artifacts/realism/`, explicitly labeled **OFFLINE REFERENCE — NOT WEBGPU**.
The translated native-VDB viewer places the source at Y=1700; its current
algorithm remains below target visual quality and has no requested user review
checkpoint.

Chrome now renders the detailed and lower-density native candidates; all 12
analytic transport/cache checks pass with no captured GPU errors. The earlier
in-app-browser/CDP failure is not a current blocker to Chrome verification.
The candidates remain too smooth, and appearance has not reached Takram quality.
See [realism progress](realism-progress.md) for actual GPU reports and captures.


> **Evidence correction:** the earlier small production orbit audit disabled cloud
> self-shadowing. Its 4×/192 versus 4×/256 equality does not validate lighting
> convergence or a banding fix. The audit setting is corrected; the original
> audit has not been rerun. New lit comparisons are recorded separately in the
> [lighting isolation bench](lighting-isolation.md). The user's
> full-size A/B/C review found no bands with shadows off and worse bands with
> direct lighting; the shadow-enabled rendering path is now the focus. See the
> [corrected research note](../research/cloud-quality-bench.md#production-atlasworld-audit--lighting-evidence-withdrawn).


Updated 2026-09-20 (Japan time).

**Current checkpoint — P2.7 shape direction:** [Density study](http://127.0.0.1:5173/density-study/)
compares a new cumulus candidate with the provisional atlas and its own coarse
representation. 109 tests, build/type checks and five new GPU checks pass.
The candidate remains soft/simplified; shape review is required before world
replacement. [Review guide](p2-density-review.md).

**LOD quality correction:** all 36 normalized-source reference poses converged,
but none of the 36 coarse or half-blend comparisons met all provisional gates.
This does not reverse the earlier single-fixture result; it prevents generalizing
it to the eight atlas forms or new source. Cloudscape now defaults to **full
fine density**; reduced detail remains experimental. Fixed world coverage stays
available, but automatic LOD appearance is unaccepted.

**Latest P2 integration:** [Cloudscape](http://127.0.0.1:5173/cloudscape/) now has
fixed 72.6 km coverage, coherent regional coverage control, and coarse/fine
voxel density shared by view and sun rays. Eighteen new GPU checks plus nineteen
existing P2 checks pass. This removes the legacy view-only distance fade in the
new mode. Finite region edges, transition quality, stylized density, lighting
bands and expensive/coarse cache updates remain open. No performance or final
appearance acceptance is implied. [Evidence and limits](p2-lod-evidence.md#persistent-world-integration--2026-09-20).

The entries below record earlier checkpoints, not the current integration state.

**Latest P2 result:** the distance audit selects a 32×64×32 coarse field for the
bounded fixture. It passed provisional optical/silhouette gates at all 15 poses
at both 320² and 640²; cubic 16³ and 32³ failed every pose. Preserving vertical
detail reduced worst 640² transmittance error from 0.0493 (32³) to 0.0166.
93 workspace tests and build pass. This is a measured source candidate, not
world integration or accepted final appearance. [Results and limits](p2-lod-evidence.md#distance-quality-continuation--2026-09-19).

**Current P2.5 checkpoint:** the isolated [LOD study](http://127.0.0.1:5173/lod-study/)
has coarse fallback, revision-safe fine loading and single-density transitions.
83 workspace tests and five browser/GPU checks at each of two coarse resolutions
pass. Optical errors remain significant; this does not close P2 or change the
production cloudscape. See [bounded LOD evidence](p2-lod-evidence.md). One Luna
worker delivered the bounded implementation; root reviewed and verified it.

**P2.4 source experiment:** the new [coverage study](http://127.0.0.1:5173/coverage-study/)
shows a camera-independent regional weather map with separate coverage and
density controls. Nine source unit tests and five browser source checks pass;
the workspace now has 77 passing unit tests. Clear/full coverage and zero
density were verified in Chrome. The [distance/refinement contract](../decisions/distance-coverage.md)
sets the next experiment's identity, fallback and optical ownership gates.
This source-only prototype is not connected to the cloudscape renderer; distant
LOD, shadow agreement and the current pop-in remain unresolved.

**Independent library continuation:** shared-renderer ownership, React lifecycle
and asset input hardening are complete for this pass. There are 28 new local
GPU lifecycle checks, zero React/vanilla optical difference after remount and
camera replacement, 68 passing unit tests, and 9 passing refreshed packed-
consumer GPU checks. See [current P5/P6 evidence](p5-p6-evidence.md). Sequential
multi-view isolation is verified; long-duration stress, concurrent async jobs,
device-loss recovery and broader hardware remain separate limits.

**New diagnostic:** [lighting isolation bench](lighting-isolation.md) runs the
production renderer with self-shadowing enabled and fixed primary sampling.
Twelve GPU poses passed isolation checks (zero transmittance difference, zero
validation errors). Direct 256 reduced measured spatial/motion lighting error
about 15×/8× against direct 48; cached lighting remains substantially different
from the dense reference. This is new diagnostic evidence, not a default preset
change or a completed banding fix.

## Current position

**Sequencing update, 2026-09-19:** one active phase, P2, with a bounded LOD
experiment now running. Finish coverage/density, then P3 lighting/atmosphere and
P4 presets. Asset expansion stays queued. Existing P4–P6 previews are retained.
See the [sequential order](next-milestones.md#sequential-dispatch-order--revised-2026-09-19).

**Roadmap clarification, 2026-09-19:** current visual work is P2/P3; P4–P6
deliveries are previews. [Next milestones](next-milestones.md) explicitly schedule
the transition from provisional forms to realistic density and lighting, actual
VDB import, and expansion of the existing `/authored/` mesh baseline. Basic VDB
import is scheduled; sparse GPU rendering and VDB export remain later gates.

**Latest instruction, 2026-09-19:** continue independent library work while the
user reviews lighting. Rendering presets, final reconstruction comparisons and
visual/release acceptance remain on hold.

**Rendering review, 2026-09-18:** the user retested and the prominent banding
persists. The detail filter did not solve the reported defect. A dedicated
quality bench/agent is establishing a clean orbit/zoom reference independently,
while library, React and asset/release-preview phases continue. The previous
P4-only scope cap is superseded. No visual quality, preset or public release
acceptance is implied.


**Rendering acceptance:** the earlier detail filter improved some spot views but failed the user's retest. Prominent arcs, crosshatching and motion strobing remain a Major defect. The independent [quality bench](../research/cloud-quality-bench.md) now separates view-ray and light-ray sampling error and supplies a dense reference. Production sampling candidates are opt-in; no default preset or visual sign-off is inferred.

- **P0:** technical work is complete and locally accepted for the local WebGPU backend. The diagnostic lab is available at [`http://127.0.0.1:5173/`](http://127.0.0.1:5173/).
- **P1:** technical baseline is complete and accepted locally. The first-cloud viewer is available at [`http://127.0.0.1:5173/clouds/`](http://127.0.0.1:5173/clouds/). User review remains open for the R1 shape preference and the reported floor-shadow view.
- **L1:** independent 2D layer preview is available at [`http://127.0.0.1:5173/layer-only/`](http://127.0.0.1:5173/layer-only/); it is not a final cloudscape acceptance.
- **P2:** R2 feedback is received and returned for coverage work at [`http://127.0.0.1:5173/cloudscape/`](http://127.0.0.1:5173/cloudscape/). The user reports that all GPU checks pass, that the fixed flight is substantial, and that scale, spacing, entry and provisional repetition are good. The current P2 stage is accepted as sufficient to continue provisionally; distant-cloud pop-in, distance/LOD continuity, shadows beyond view-faded clouds, finite coverage and weather semantics remain open quality debt.
- **P3:** the first lighting/environment slice is runnable at [`http://127.0.0.1:5173/lighting/`](http://127.0.0.1:5173/lighting/). P3.1 and P3.2 bounded prototypes are integrated; P3.3 is partially running. All 23 local P3 GPU checks pass, but R3 human review remains pending. P4 now has a reconstruction comparison preview at [`/reconstruction/`](http://127.0.0.1:5173/reconstruction/). R4 visual retest and preset acceptance remain pending; The 2026-09-18 follow-up authorizes progression through P6 while rendering quality is investigated independently; publication is separate. See the [critical review guide](p4-review.md) and [P4 evidence](p4-evidence.md). P2.4–P2.6 future coverage/weather packets remain tracked and are not blockers to compatible P3 lighting work. P5–P6 have runnable local preview deliveries; rendering and release acceptance remain separate.

- **P5:** public Three.js and R3F v10 preview APIs, package archives, independent consumer and lifecycle scenes are implemented. React/vanilla optical parity measured zero error; human API review remains open.
- **P6:** local release-preview artifacts, bounded dense transport and mesh conversion are implemented. Blender 5.1.1 produced the fixture mesh. Full release acceptance still needs the open rendering/device gates. See [P5/P6 evidence](p5-p6-evidence.md).

The current P2 slice uses an eight-form 96³ r8 atlas, 81 resident world-cell
descriptors, near/medium volumetric formations and a separate thin high/far
layer. The lighting cache is still a provisional P2 resource; production
shadow and environment cache behavior belongs to P3. The user has authorized
autonomous progression through the remaining phases on 2026-09-18; that authorization does not change
the phase acceptance gates.

## Capability table

| Ready now | Next | Later |
| --- | --- | --- |
| P0 interop/sky diagnostic at `/` | R3 lighting review | Windows/RTX validation |
| P1 voxel, P2 cloudscape and P3 lighting viewers | Open distance/LOD, atmosphere and shadow quality work | Sparse/VDB experiments |
| L1 layer and P4 reconstruction preview | Dedicated quality bench and production candidate retest | Accepted performance presets |
| P5 Three.js / React local previews and package builds | R5 lifecycle/API review; P6 authored and packed-consumer validation | API freeze and publication decision |

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

The next P2 direction is informed by a direct [Nubis 2022/2023 LOD review](../research/nubis-lod.md): persistent broad formations and near refinement from a shared source, with screen-resolution choices kept separate. This is planned, not implemented.

## Evidence and limits

See [P0 evidence](p0-evidence.md), [P1 evidence](p1-evidence.md), the [P2 evidence](p2-evidence.md), the [implementation plan](implementation-plan.md), and the [work queue](implementation-work-queue.md). Local technical checks and the M5 Pro development environment do not establish RTX 3060/Windows results, injected device-loss recovery, final cloudscape coverage, final shadow caching, accepted reconstruction presets or release readiness. Local packaged APIs and R3F v10 bindings now have separate P5 review scenes.

Human observations and automated technical results should be recorded independently using the [human review guide](human-review.md). Questions already answered in the latest R2 review—provisional stylized forms, repetition, scale, spacing and entry—should remain logged rather than asked again.

## P4 review checkpoint

The comparison preview now includes native, reduced bilinear, cloud-only spatial,
final FSR1 and final FSR3 temporal reconstruction using the author's pinned local
upscaler snapshot. It exposes paired native comparison, fixed flight, foreground
bars, moving geometry, cuts, source/density/sun edits and benchmarks. Follow the
[P4 critical review](p4-review.md) and [technical evidence](p4-evidence.md).

The user reports the five reconstruction methods are stable apart from the
volume artifacts and subsequently authorizes progression through P6. P4 is **ready for
critical review, not accepted**. Single-depth transparent
motion is approximate. Full cloud wind/advection is not implemented. Spatial
source quality, long-distance coverage, physical atmosphere, sustained motion
quality, supported-device results and validated presets remain open.

**2026-09-18 P4 technical update:** the cloudscape now enables detail filtering
by default. It suppresses unresolved periodic fine-density modulation using
ray-step and pixel-footprint information while preserving the nominal modulation mean (density multiplier 1 − detail/2). The viewer exposes **Fine density detail** and **Filter unresolved
detail**; disabling the latter reproduces the older pixel-only filtering, and
native/reconstructed sides share the setting. No jitter or blue noise was
added; the default 320 samples, ray lattice, LOD and lighting cache are
unchanged. The comparison divider is default-on and toggleable.

All 29 P4, 19 P2 and 23 P3 GPU checks pass in the in-app browser. `pnpm check`
passes with 53 tests, type checking and build. FSR3 flight reached 40 seconds
with no errors, confirming functional progression only. The seven new sampling regressions pass; values and tolerances are in
[P4 evidence](p4-evidence.md).

## Previous local preview evidence — 2026-09-18

The independent quality bench and opt-in 4× view / 192-light candidate are
available. The earlier 96×54 production comparison accidentally disabled
self-shadowing; its exact-match result cannot establish light-sampling quality.
The corrected lit audit, full-size cached-lighting review and performance
acceptance remain pending. The default sample budget
is unchanged, but conservative density evaluation may cost more and must be
rebenchmarked.

All 66 unit tests and the complete lab build pass. Fresh local GPU runs pass
19 P2, 23 P3 and 29 P4 checks with no application errors. Installed archives
pass nine GPU checks; React optical parity is zero error at 1280×647. Both
Blender-produced fixtures render and rejection/cancellation checks pass.
See [P5/P6 evidence](p5-p6-evidence.md), [release preview](release-preview.md)
and the expanded [R5/R6 checklist](human-review.md#p5--reusable-library-and-r3f-v10-r5).
