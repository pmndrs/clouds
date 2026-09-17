# Implementation work queue

Prepared 2026-09-16. **P0.1–P0.4 are accepted locally as of 2026-09-16.** P1.1–P1.3 and the L1 preview are technically accepted locally as of 2026-09-17; R1 views were reported working and stylized forms accepted provisionally; silhouette choice and shadow retest remain open. P2 implementation is now available at [`/cloudscape/`](http://127.0.0.1:5173/cloudscape/) with local technical evidence recorded and R2 feedback received. The user accepts the current P2 stage as sufficient to continue provisionally; distance/LOD, coverage/weather and view/shadow quality debt remain tracked. The first P3 lighting/environment slice is runnable at [`/lighting/`](http://127.0.0.1:5173/lighting/): P3.1 and P3.2 bounded prototypes are integrated, P3.3 is partial, and P3 is not complete. R3 human review is pending; P4 has not started and remains the maximum authorized phase. See the [human review guide](human-review.md), [overall status](project-status.md), [P1 evidence](p1-evidence.md), [P2 evidence](p2-evidence.md), and [P3 evidence](p3-evidence.md). Dependencies mean accepted output, not merely a running producer. Phase details: [implementation plan](implementation-plan.md). Dispatch rules: [orchestration](agent-orchestration.md).

## First dispatch wave

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

State vocabulary: `ready`, `running`, `needs-decision`, `ready-for-review`, `accepted`, `accepted provisionally`, `returned`. Keep failures and unavailable hardware visible in evidence. Only the orchestrator records technical acceptance; provisional progression does not close a visual gate, and child completion notifications do not close gates.

## R2 follow-up (2026-09-17)

Viewer playback now uses a precise clock rather than accumulating through a stepped slider; Chrome playback and zero density were verified. The user accepts the current P2 stage as fine for continuing provisionally. Remaining P2 work: persistent distant representation with shared weather identity, consistent view/shadow transition, coherent weather coverage, and spatial sampling quality diagnosis. The latest camera turn/down observation shows shadows beyond view-faded clouds because view density fades with horizontal camera distance while shadow density remains unfaded; the tower does not control the fade. Preserve the existing lookup/reference tests, but add approach-distance and shadow-agreement checks: same-camera region continuity alone did not catch the reported horizon problem. P2.4–P2.6 remain future tracked packets and do not block compatible P3 lighting work. P3.1 and P3.2 bounded prototypes are integrated and ready for review; P3.3 is running partially. The `/lighting/` scene is runnable, but P3 is not complete and R3 is pending. P4 remains the maximum authorized phase.

### Next bounded P2 packets

| Packet | Owner | Output | Gate |
| --- | --- | --- | --- |
| P2.4 | O contract + W world/weather source | Persistent coherent weather/profile source, deterministic global identity, density/coverage separated | Clear-to-covered progression; camera-independent formation identity |
| P2.5 | O integration + focused W representation experiment | Broad coarse representation and near refinement from the same source, explicit overlap ownership, matched shadow density | Long-distance approach/reference comparisons, no missing far formation or duplicate optical depth |
| P2.6 | W capture/metrics + O acceptance | Banding diagnostics, transition and shadow agreement captures, generation/update/frame measurements | Revised R2 review with stated quality limits |

These packets remain future tracked work and are not blockers to compatible P3
lighting. Source basis and open design choices: [Nubis LOD research](research/nubis-lod.md).
