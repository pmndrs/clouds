# Implementation work queue

## Completed local source packet — 2026-10-08

Weather/base-boundary/erosion source and mip resources are implemented. See
[the packet evidence and next steps](../research/morphology-study.md). A bounded
Luna worker owned original noise generation and checks; root integrated raw
WebGPU resources, the shared evaluator and the viewer. 129 unit tests, 21 GPU
checks, build/pack and independent-consumer validation pass. Appearance remains
below target; these checks do not close dynamic banding or world LOD quality.

Next dispatch: lighting convergence and sky-radiance calibration using this
same source; then integrate the source with resident voxels and distance
representations. VDB authoring remains parked; do not request a minor review.


**Current execution directive — 2026-10-08:** the user withdraws the small
shape-review stops and authorizes completing the platform through P6, then
advancing realism autonomously toward three-geospatial's visual quality. Earlier
sequential/checkpoint text below is historical and no longer blocks compatible
platform/asset work. Do not request another appearance review of orb/placeholder
clouds. Use bounded lower-cost workers for platform, assets and source work; root
owns GPU integration and visual acceptance. Technical preview readiness does
not imply realistic appearance, final presets, hardware coverage or publication.


Prepared 2026-09-16. **P0.1–P0.4 are accepted locally as of 2026-09-16.** P1.1–P1.3 and the L1 preview are technically accepted locally as of 2026-09-17; R1 views were reported working and stylized forms accepted provisionally; silhouette choice and shadow retest remain open. P2 implementation is now available at [`/cloudscape/`](http://127.0.0.1:5173/cloudscape/) with local technical evidence recorded and R2 feedback received. The user accepts the current P2 stage as sufficient to continue provisionally; distance/LOD, coverage/weather and view/shadow quality debt remain tracked. The first P3 lighting/environment slice is runnable at [`/lighting/`](http://127.0.0.1:5173/lighting/): P3.1 and P3.2 bounded prototypes are integrated, P3.3 is partial, and P3 is not complete. R3 human review is pending; P4 now has a reconstruction comparison preview at [`/reconstruction/`](http://127.0.0.1:5173/reconstruction/). R4 visual review and preset acceptance remain pending; The 2026-09-18 follow-up authorizes progression through P6 while rendering quality is investigated independently; publication is separate. See the [critical review guide](p4-review.md) and [P4 evidence](p4-evidence.md). See the [human review guide](human-review.md), [overall status](project-status.md), [P1 evidence](p1-evidence.md), [P2 evidence](p2-evidence.md), and [P3 evidence](p3-evidence.md). Dependencies mean accepted output, not merely a running producer. Phase details: [implementation plan](implementation-plan.md). Dispatch rules: [orchestration](agent-orchestration.md).

## Active quality packet — revised 2026-10-08

The user parks VDB authoring/import work: the bundled asset is an understood
self-authored test fixture, not a known external cloud rendered incorrectly.
No further Houdini/VDB candidate generation is scheduled. Authored VDB sources
can be supplied later; this does not block procedural rendering work.

The readable Tidewater audit is complete. Next: one bounded procedural
weather/base-boundary/erosion source packet, integrated with the existing
voxel transport and shared view/light density. Establish convincing formation
and rim detail before more source variants or performance tuning. Then evaluate
footprint filtering and lighting/temporal convergence without treating analytic
transport checks as visual approval. Root owns integration/visual judgment;
lower-cost workers can own noise generation and focused source checks.

Reference notes: [density hierarchy](../research/tidewater-density-reference.md),
[transport/lighting](../research/tidewater-transport-reference.md). No Tidewater
source or assets have been copied, and its full game has not been executed.

## Current platform handoff — 2026-10-08

The user directive remains: skip minor human checkpoints, complete platform
foundations through P6, and keep publication separate. The current packet has
122 unit tests, typecheck/build, and packed online-consumer validation passing.
P4 smoke evidence records 29 GPU checks and 15 timing rows at 320×180 across
five modes. Native, bilinear, cloud-only and FSR1 are guide-free; FSR3 uses
guides. Both comparison runtimes remain allocated.
Dense React parity is exactly zero after field/camera replacement and remount.

Platform and asset foundations now cover realistic reference appearance, GPU
density bake and optical-depth cache, ray jitter and multiple-scattering
approximation, CPU density generation, React density bindings, Houdini 21 fog
VDB conversion, four CLDA variants with representative native readback parity, and finite curved/concave
mesh checks. Broad visual quality, presets, RTX/Windows, streaming, and
publication remain open. Chrome now renders the detailed and lower-density
native candidates; 12 analytic transport/cache checks pass with no captured GPU
errors. Shapes remain too smooth. VDB authoring is parked; next is the procedural
source packet above, then lighting comparison. See [realism progress](realism-progress.md).

## Current handoff — 2026-09-20

P2.7 now has a runnable [density comparison](http://127.0.0.1:5173/density-study/).
Two narrow workers: Luna high for the source and Luna medium for extraction/
optical audit; each received one focused correction. Root built the viewer,
reviewed/tuned the source, ran GPU evidence, and retained failed LOD gates.
109 unit tests and build/type checks pass; five new GPU checks pass. Costs/token
savings were not measured.

**Needs human shape-direction review** before replacing the world atlas:
[p2-density-review.md](p2-density-review.md). The new density is still simplified;
P2/P3 realism is not approved. Coarsening fails current normalized-source gates,
so Cloudscape defaults to full detail. Automatic LOD remains open. Resume from
shape feedback, then iterate density/LOD and proceed to P3 lighting in sequence.
No new P4–P6 feature work was started.

## First dispatch wave

**Current scheduling update, 2026-09-19:** use the
[sequential order](next-milestones.md#sequential-dispatch-order--revised-2026-09-19).
One active phase: P2 LOD/coverage and density, then P3 lighting/atmosphere,
P4 presets, and P5/P6 acceptance/assets. Existing later previews are retained.
P2.5 bounded proof is delivered by one Luna worker and reviewed by root; world
integration now exists as a finite-region prototype (2026-09-20); production-atlas transition quality and lighting agreement remain open. Actual VDB import A2.1 and
expanded mesh bench A2.2 stay queued. The earlier parallel wave is superseded.

When implementation begins, the orchestrator performs P0.1 first: workspace setup, package/tool choices, initial shared contracts and exact reference pins. After that is accepted:

- Worker A: P0.2 GPU bridge, with orchestrator review of native resource ownership and ordering.
- Worker B: P0.3 deterministic camera/capture/metrics harness, using the agreed interface and diagnostic placeholder scene.
- Orchestrator: P0.4 shadow/sky/scheduler contract probes and review of A/B. No overlapping edits.

The next wave is P1.1 density generation alongside L1's independent lightweight layer. The orchestrator builds/integrates P1.2's reference integrator, then P1.3's minimal shadow reference. Do not dispatch the full backlog at once.

## Packet dependency table

Paths below assign implementation ownership. P0 paths now exist; later paths remain planned. `O` means orchestrator; `W` means a bounded lower-cost worker, selected under the routing policy.

| ID | Owner | Depends on | Owned output / acceptance |
| --- | --- | --- | --- |
| P0.1 | O | — | Root workspace and `packages/core/`; selected versions, test commands, source/frame/resource contracts and fixture index recorded |
| P0.2 | W + O review | P0.1 | `packages/three/src/gpu/`, `examples/lab/scenes/interop/`; 2D/3D texture and buffer sharing, ordering, resize/dispose proof |
| P0.3 | W | P0.1 | `bench/`, `examples/lab/harness/`; deterministic paths/captures and device/settings-aware measurement export |
| P0.4 | O | P0.1 | `docs/decisions/integration.md`, isolated `examples/lab/scenes/integration-probes/`; shadow, sky and R3F v10 scheduler feasibility; no production React wrapper yet |
| P1.1 | W | P0.2 | `packages/three/src/sources/`, `fixtures/generated/`; deterministic voxel field plus synthetic authored field conforming to the accepted contract |
| P1.2 | O | P0.2, P0.3, P1.1 | `packages/three/src/volumetric/`, `examples/lab/scenes/first-cloud/`; reference ray integration, self-shadow, optical/depth correctness, conservative skipping comparison |
| P1.3 | W + O review | P1.2, P0.4 | `packages/three/src/lighting/reference/`, `examples/lab/scenes/shadow-reference/`; simple cloud→plane and opaque object→cloud directional shadow proof |
| L1 | W | P0.1 | `packages/three/src/layers/`, `examples/layer-only/`; usable independent 2D clouds with no voxel dependency |
| P2.1 | W + O review | P1.2 | `packages/three/src/world/`; stable region distribution/update and projected-detail policy, bounded memory; requests integrator changes from O |
| P2.2 | O + focused W experiment | P2.1, P0.3 | `packages/three/src/cloudscape/` by O; atlas, `world-candidates/` and `world-traversal/` by W; accepted coverage/traversal decision based on measurements |
| P2.3 | O | P2.2, L1 | `examples/lab/cloudscape/`; horizon-to-interior path, independent layer combination, no duplicated cloud extinction |
| P3.1 | ready-for-review (bounded prototype) | P1.3, P2.2 | `packages/three/src/lighting/`; production directional cast/receive shadows and cache invalidation; O alone changes integrator hooks |
| P3.2 | ready-for-review (bounded prototype) | P0.4, P2.2 | `packages/three/src/environment/`, `examples/lab/scenes/sky/`; sky contribution/capture and lighting test objects, separate view state |
| P3.3 | running (partial) | P3.1, P3.2, P2.3 | Integrated lit cloudscape and atmosphere ordering; R3 evidence |
| P4.1 | O | P3.3 | `docs/decisions/reconstruction.md` and shared contract revision; choose cloud depth/motion/reactivity and jitter ownership |
| P4.2 | W + O review | P4.1 | `packages/three/src/reconstruction/`; upscaler integration and native/spatial/temporal comparison; no edits to external upscaler without explicit ownership |
| P4.3 | W + O acceptance | P4.2 | `bench/scenarios/reconstruction/`; fixed-path captures/timings, preset proposals, M5/RTX status distinguished |
| P5.1 | O | P3.3, P4.3, L1 | Public Three API/exports and versioned lifecycle contract; pure consumers install from packed artifact |
| P5.2 | W | P5.1 | `packages/react/`, `examples/react/`; mandatory v10 bindings and lifecycle/output equivalence |
| P5.3 | W + O integration | P5.2 | `examples/three/`, consumer tests and usage docs; no root exports/lockfile edits by W |
| A1 | W | P1.1, P1.2 | `packages/assets/`, `fixtures/authored/`; metadata validation, dense loader, cancellation and semantic parity |
| A2 | W | A1 | `packages/tools/`, `examples/lab/scenes/authored/`; one static DCC density import and mesh-to-density route with provenance |
| A3 | W, conditional | A2, P2.2 | `experiments/sparse/`; PicoVDB/dense comparison on same cloud and a recommendation, no automatic public-format change |
| A4 | W, conditional | A2 | `experiments/vdb-export/`; actual VDB writer/DCC round trip including export bounds/scale; optional WASM report |
| P6.1 | W + O acceptance | P5.3 | `bench/release/`, compatibility/limitations docs; two-device required-scene evidence and release issue list |
| P6.2 | O | P6.1; A2 for asset extension | Packed release artifacts, changelog, license/attribution and release-scope review; publishing is a separate action |

P2 can proceed while the simple shadow proof is being completed, but required shadow architecture cannot be ignored until P3. P5 production packaging waits for stable rendering contracts; scheduler exploration happens in P0. Asset work gets a worker slot only when it does not starve the main coverage/shadow/reconstruction path.

## Contract checkpoints

| Contract | First owner/checkpoint | Must settle before dependents implement |
| --- | --- | --- |
| Source + units | O / P0.1, validated P1 | Bounds/transforms, density/extinction semantics, revision/update signal, optional acceleration data |
| GPU resource | O / P0.1–P0.2 | Device, format/usage, initialization, lifetime and producer/consumer ordering |
| Frame + light | O / P0.4–P1.3 | Camera/depth convention, directional shadows, update order, multiple views |
| Environment | O / P0.4, finalized P3 | Directional radiance/transmittance, atmosphere composition and capture refresh |
| Temporal | O / P4.1 | Jitter owner, cloud guides/reactivity, history/reset and exposure semantics |
| Public API | O / P5.1 | Lifecycle, callbacks, async cancellation, shared assets and version compatibility |

## Execution ledger

Update one row per dispatched packet. Local P0 acceptance does not claim RTX/Windows validation or production cloud behavior.

| Packet | State | Agent/model | Base/contract revision | Evidence | Technical acceptance | Human feedback |
| --- | --- | --- | --- | --- | --- | --- |
| P0.1 | accepted | Orchestrator | Contract v0 / Three 0.186.0 | pnpm check; fixtures/compatibility.json | Core tests, workspace/build passed | Not required |
| P0.2 | accepted | gpt-5.6-luna high + orchestrator GPU review | Contract v0 / Three 0.186.0 | P0 evidence; local report and image | Raw↔TSL 2D/3D/buffer at 16→8→16; disposal; no final GPU errors | Lab available |
| P0.3 | accepted | gpt-5.6-luna medium + orchestrator integration | Contract v0 | Bench tests; exported JSON/PNG verified | Deterministic paths, metrics/report/capture integrated | Not required |
| P0.4 | accepted | Orchestrator | Sky 0.3.0 / scheduler 0.2.0 | Integration decision; browser lighting fixture | Standalone order test, shadow texture and environment contribution demonstrated; cloud hooks still P1/P3 | Lab available |
| P1.1 | accepted | gpt-5.6-luna high + O review | Contract v0 | 6 source tests; GPU source replacement and form viewer | Seeded fields, six-face guards, conservative occupancy; one correction | Views working / style provisional; shape choice and shadow retest open |
| P1.2 | accepted | Orchestrator + focused Luna review | Three 0.186.0 / contract v0 | P1 evidence; 14 GPU checks including floor continuity; historical timing reports | Optical/depth/scale/inside equivalence; no final runtime errors; full march selected by measurement | Views working / style provisional; shape choice and shadow retest open |
| P1.3 | accepted (reference) | gpt-5.6-luna high math + O rendering | P1 bounded volume | 5 shadow math tests; both GPU shadow-direction checks | Matching box caster and explicit Y=0 receiver mask; depth-precision dropout fixed; production hooks remain P3 | Views working / style provisional; shape choice and shadow retest open |
| L1 | accepted (preview) | gpt-5.6-luna high + O browser review | Three 0.186.0 | Independent page/build; zero coverage/background visual check | TSL layer independent of voxel runtime; coverage/normal correction accepted | R2 later |
| P2.1 | accepted (prototype) | gpt-5.6-luna high + O review | P1.2 accepted | 6 world tests; shared atlas and candidate tests; residency decision | Stable distribution, fixed working set, retained-cell metadata; world contract validated | R2 review pending; R1 preference and shadow retest remain open |
| P2.2 | accepted (prototype) | O + gpt-5.6-luna high atlas/candidate/traversal work and review | P2.1, P0.3 | P2 evidence; 19 GPU checks; matched timing reports | Exact lookup/reference fixture parity, density rebase continuity, 0.98–1.38 ms p50 at 960 × 540; finite support and provisional cache recorded | R2 review pending |
| P2.3 | accepted provisionally / quality debt open | O | P2.2, L1 | `/cloudscape/`, five-view flight sheet, R2 checklist | Local checks pass; R2 found late reveal, shadows before clouds and insufficient horizon/weather coverage | Close flight, scale, entry and repeats accepted provisionally; distance/LOD, coverage/weather and view/shadow agreement remain open |
| P3.1 | ready-for-review | gpt-5.6-luna high + O GPU review | P1.3, P2.2 | `/lighting/`; [P3 evidence](p3-evidence.md) | Bounded prototype integrated; final P3 acceptance pending | R3 pending |
| P3.2 | ready-for-review | gpt-5.6-luna high + O integration | P0.4, P2.2 | `/lighting/`; [P3 evidence](p3-evidence.md) | Bounded prototype integrated; final P3 acceptance pending | R3 pending |
| P3.3 | running (partial) | Orchestrator | P3.1, P3.2, P2.3 | `/lighting/`; [P3 evidence](p3-evidence.md) | Not accepted; integrated slice incomplete | R3 pending |

### P4 checkpoint

2026-09-18: the user reports the reconstruction methods are stable apart from
volume artifacts. A default-on, mean-preserving detail filter is ready for
retesting the reported arcs/crosshatching/strobing; see [P4 review](p4-review.md).
Blue-noise/jitter remains a possible follow-up if residual sampling aliasing
warrants it. This historical checkpoint did not accept a preset. The later 2026-09-18 instruction authorizes P5/P6 progression alongside the quality bench.

| Packet | State | Delivery / remaining gate |
| --- | --- | --- |
| P4.1 | ready-for-review | [Reconstruction contract](../decisions/reconstruction.md); weighted cloud depth, opaque motion, reactivity, one jitter/history owner |
| P4.2 | ready-for-review | Actual FSR1/FSR3 adapter plus separate L/T cloud-only spatial resolve; GPU integration checks |
| P4.3 | running (partial) | Fixed comparison lab, critical review guide and timing harness; preset acceptance, wind and RTX/Windows evidence still open |

Three bounded `gpt-5.6-luna` workers supplied the adapter (high), optical resolve
(high) and review guide (medium). Root owns guide integration, viewer, GPU
verification, measurements and acceptance. Worker completion is not a gate pass.
P3 remains partial; user-authorized progression to P4 does not accept P2/P3 debt.

State vocabulary: `ready`, `running`, `needs-decision`, `ready-for-review`, `accepted`, `accepted provisionally`, `returned`. Keep failures and unavailable hardware visible in evidence. Only the orchestrator records technical acceptance; provisional progression does not close a visual gate, and child completion notifications do not close gates.

## R2 follow-up (2026-09-17)

Viewer playback now uses a precise clock rather than accumulating through a stepped slider; Chrome playback and zero density were verified. The user accepts the current P2 stage as fine for continuing provisionally. Remaining P2 work: persistent distant representation with shared weather identity, consistent view/shadow transition, coherent weather coverage, and spatial sampling quality diagnosis. The latest camera turn/down observation shows shadows beyond view-faded clouds because view density fades with horizontal camera distance while shadow density remains unfaded; the tower does not control the fade. Preserve the existing lookup/reference tests, but add approach-distance and shadow-agreement checks: same-camera region continuity alone did not catch the reported horizon problem. This was the pre-integration state; the 2026-09-20 P2.6 checkpoint below supersedes its distance-support status. P3.1 and P3.2 bounded prototypes are integrated and ready for review; P3.3 is running partially. The `/lighting/` scene is runnable, but P3 is not complete and R3 is pending. The 2026-09-18 follow-up authorizes progression through P6 while rendering quality is investigated independently; publication is separate.

### Next bounded P2 packets

| Packet | Owner | Output | Gate |
| --- | --- | --- | --- |
| P2.4 | running — O design/viewer + Luna source | Experimental coherent CPU weather/profile source and source-map viewer; production generation not connected | Source continuity/coverage checks; formation and optical acceptance still open |
| P2.5 | bounded candidate measured; finite world prototype integrated | [LOD study/evidence](p2-lod-evidence.md): per-axis coarse filtering, 30 distance/angle/image-size poses, stale-load rejection, single-density transitions; finite cloudscape support now shares density with sun rays | 32×64×32 passes provisional fixture gates at both image sizes; human/full-world/lighting acceptance remains open |
| P2.6 | active — Luna source + O integration/acceptance | Fixed 72.6 km cloudscape, regional coverage, GPU coarse/fine blend; 18 new GPU checks | Approach/retreat review and production-atlas transition error remain; lighting appearance follows in P3 |

P2.4 remains an isolated source experiment; P2.5/P2.6 now have a finite-region
integration checkpoint. P2 remains the single active phase. Source basis and open design choices:
[Nubis LOD research](../research/nubis-lod.md).

**2026-09-19 continuation:** P2.4 now has a bounded CPU source experiment and
[coverage map](http://127.0.0.1:5173/coverage-study/). The
[distance/refinement decision](../decisions/distance-coverage.md) defines ownership,
fallback readiness and test gates for P2.5. Moving the camera overlay changes
only residency illustration; it never changes the weather source. This is
source-level progress and does not close distant rendering or shadow continuity.


## Parallel continuation — 2026-09-18

The user rejected the banding retest and explicitly requested a dedicated
unconstrained-cost quality reference bench while remaining phases proceed.

| Packet | Owner | State / scope |
| --- | --- | --- |
| Quality reference | `cloud_quality_bench`, Sol high | Independent `quality-bench/` source, orbit/zoom and dense reference; research Hillaire/Nubis and sample patterns; optimize only after quality evidence |
| P5.1 / P5.3 / P6.1–2 preview | Root | Public entry points, ESM/declarations, independent packed consumers, vanilla/layer/environment examples, compatibility/release artifacts |
| P5.2 | `react_bindings`, Luna high | Pinned R3F v10 wrappers and lifecycle example using the same vanilla runtime |
| A1 / A2 | `asset_pipeline`, Luna high | Validated dense transport, cancellation, mesh-to-density reference, authored fixture and preview |

Root integrates the quality result only after inspection. Production acceptance
still needs rendering, performance, distant coverage and RTX evidence. A3/A4
sparse and VDB round-trip experiments remain conditional, not advertised APIs.

## Local preview handoff — 2026-09-18

- Quality bench delivered and frozen; isolated and small production motion audits
  plus opt-in production sampling are integrated. Full-size cached-lighting
  acceptance and optimization remain open.
- P5.1/P5.2/P5.3: local preview implemented; public packages, vanilla/R3F scenes,
  lifecycle controls, measured optical parity and packed consumers pass. R5 API
  feedback and multi-view stress remain open.
- A1/A2: bounded dense loader and mesh conversion delivered; a Blender-authored
  float density and separate mesh-derived fixture render in the same viewer.
- P6.1/P6.2: local package archives, checksums, changelog, attribution and review
  guides delivered. Two-device validation, rendering gates and publication are
  explicitly unaccepted. This is not a completed production release.

See [P5/P6 evidence](p5-p6-evidence.md).

## Independent continuation — 2026-09-19

The user authorized continuing library work while they review lighting.
Rendering presets, integrator optimization, final reconstruction comparisons
and visual/release acceptance remain open.

| Packet | Delivery | Gate |
| --- | --- | --- |
| Shared-renderer lifecycle | Two independent cloud views, three create/resize/dispose cycles, caller source retention and host cubemap-face restoration | 28 local GPU checks passed; no asynchronous render-job concurrency, device-loss or memory-leak claim |
| Receiver ownership | Reject overlapping receiver ownership before mutating a material; allow explicit handoff and preserve later caller hooks | Focused unit regressions passed |
| React lifecycle hardening | Commit-time frame refs; manual layer disposal clears its frame registration and removes its owned mesh | Browser disposal/remount/camera checks; parity recorded in current evidence |
| Asset input hardening | Strict CLDA length/header validation; mesh vertex/triangle limits checked before copying; portable revision and transformed-coordinate validation | Asset/tools regressions passed |
| Consumer refresh | Rebuild archives and independent installed consumer from the hardened sources | See current P5/P6 evidence; nothing published |
