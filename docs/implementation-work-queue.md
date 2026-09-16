# Implementation work queue

Prepared 2026-09-16. **P0.1–P0.4 are accepted locally as of 2026-09-16.** P1 and later packets are not started. See [P0 evidence](p0-evidence.md) for actual execution and remaining platform limits. Dependencies mean accepted output, not merely a running producer. Phase details: [implementation plan](implementation-plan.md). Dispatch rules: [orchestration](agent-orchestration.md).

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
| P2.2 | O + focused W experiment | P2.1, P0.3 | `packages/three/src/volumetric/` by O; separate candidate under `experiments/residency/` by W; accepted coverage/traversal decision based on measurements |
| P2.3 | O | P2.2, L1 | `examples/lab/scenes/cloudscape/`; horizon-to-interior path, independent layer combination, no duplicated cloud extinction |
| P3.1 | W + O review | P1.3, P2.2 | `packages/three/src/lighting/`; production directional cast/receive shadows and cache invalidation; O alone changes integrator hooks |
| P3.2 | W + O review | P0.4, P2.2 | `packages/three/src/environment/`, `examples/lab/scenes/sky/`; sky contribution/capture and lighting test objects, separate view state |
| P3.3 | O | P3.1, P3.2, P2.3 | Integrated lit cloudscape and atmosphere ordering; R3 evidence |
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
| P1.1 | ready | Unassigned | P0.2 accepted | — | Pending | R1 later |
| L1 | ready | Unassigned | P0.1 accepted | — | Pending | R2 later |

State vocabulary: `ready`, `running`, `needs-decision`, `ready-for-review`, `accepted`, `returned`. Keep failures and unavailable hardware visible in evidence. Only the orchestrator records acceptance; child completion notifications do not close gates.
