# Implementation plan — pmndrs/clouds

Prepared 2026-09-16 from the [specification](library-spec.md) and the author's [decisions](questions.md). Status: implementation authorized; P0 and the P1 technical reference are accepted locally, R1 shape review is pending. Track actual acceptance in the work queue. This document does not launch a background run or authorize publication.

## Working approach

Build a visible result in each phase. Use objective engineering gates to establish correctness and short human reviews to choose appearance and tradeoffs. The orchestrator owns interfaces, the integrated renderer and acceptance; lower-cost agents implement bounded modules and verification tasks. See [agent orchestration](agent-orchestration.md) and the [work queue](implementation-work-queue.md).

Public delivery remains plain Three.js first, packaged Three.js APIs next, R3F v10 bindings afterward. Investigate sky, shadow and scheduler integration early so they can influence contracts. TSL, embedded WGSL and direct WebGPU all remain available.

## Phases at a glance

| Phase | Visible result | Main acceptance evidence | Human contribution |
| --- | --- | --- | --- |
| P0 — Foundation | Diagnostic scene and repeatable capture/benchmark controls | Mixed GPU sharing, lifecycle and version evidence | Review proposed performance targets after calibration |
| P1 — First cloud | Fly around and through one generated voxel cloud | Reference integration, opaque depth, generated/imported source parity | Choose cloud shape/scale direction |
| P2 — Cloudscape | Fly from ground/horizon into a field of clouds | Coverage, representation transitions, memory and generation costs | Judge horizon coverage, repetition and motion |
| P3 — Light and sky | Moving cloud shadows; geometry shadows inside clouds; sky/environment contribution | Cast/receive shadows, atmosphere and lighting composition | Tune sunlight, softness and atmosphere balance |
| P4 — Reconstruction | Side-by-side native, cloud-only and final-scene upscale | Motion/ghosting tests and measured net benefit | Choose quality/performance presets on both GPUs |
| P5 — Reusable library | Equivalent plain Three.js and R3F v10 examples | Lifecycle, package boundaries, packed-consumer tests | Review API ergonomics and sky/R3F hooks |
| P6 — Assets and release | Import an authored cloud and turn a mesh into cloud density | Conversion semantics, two-device evidence, docs and release artifacts | Test Windows build; decide final asset/release scope |

Two supporting tracks run alongside the main sequence: **L (independent 2D layer)** after P0, and **A (asset tools)** after P1's source contract. VDB parsing/export does not hold up the voxel cloudscape. See release scope below.

## P0 — Foundation and integration proof

**Deliver:** a small monorepo, plain Three.js diagnostic app, fixed camera paths and a capture/metrics harness. Suggested tooling is a pnpm workspace, TypeScript, Vite for examples and a lightweight unit-test runner; validate versions during setup. Avoid adding a monorepo build service before it is needed. Reserve npm names until packaging.

Pin tested Three, R3F v10, sky and upscaler revisions in a compatibility record. Inspect the v10 scheduler for optional vanilla reuse. Keep React out of the vanilla entry point regardless of scheduler choice. Reuse the upscaler bridge pattern with attribution where code is copied; centralize internal renderer access.

Prove Three → native GPU access → direct compute → Three consumption for a 3D texture and storage buffer. Include a 2D output texture, producer/consumer ordering, format/usage constraints, resize, multiple consumers and disposal. Establish a minimal directional-shadow and sky-hook feasibility probe now; full lighting comes in P3. No second device and no CPU readback in the rendering connection.

**Exit:** visible known-pattern output; WebGPU validation clean; fixture values match a CPU reference where applicable; resources are replaced/disposed correctly; benchmark exports identify revisions, device, resolution and scene. If an API is insufficient, change the bridge or use raw WGSL within scope.

**Budget calibration:** initial profiling sweep at 1080p and 1440p output, native/0.75/0.5 internal linear resolution, using the M5 Pro and RTX 3060 when available. These are test configurations, not promised performance. Report cloud, generation, shadows, environment, reconstruction and total frame costs separately, including p50/p95 after warm-up, working-set memory and allocation/update spikes. CPU submission time must not be labeled GPU time when timestamps are unavailable. Propose numeric budgets after the first real P1 measurements; no repeated architecture tuning without a measurable target.

## P1 — First voxel cloud, correctness before reconstruction

**Deliver:** a deterministic generated voxel density field, bounded ray integration, directional light/self-shadow reference and plain Three.js controls for shape, density, scale and sun. Fly inside the cloud and behind an opaque test object. Initially use dense 3D storage; this is a correctness baseline, not the final cloudscape residency architecture.

Separate density generation from integration. Add a synthetic authored-density fixture using the same source interface, without waiting for a VDB loader. Compute cloud radiance/transmittance in linear HDR and compose before tone mapping. Specify camera/depth convention, world units, bounds and overlap policy. Begin a conservative occupancy/skipping path with a brute-force comparison; unbounded skipping or density loss is a failure.

Prove minimal cloud-to-plane and opaque-object-to-cloud shadows here using P0's light contracts. The production shadow cache and broad material integration remain P3 work. This prevents required shadow support from arriving after incompatible rendering assumptions have hardened.

**Exit:** homogeneous density matches Beer–Lambert reference within a recorded tolerance; empty density yields zero cloud radiance and unit transmittance; scale/transform tests behave consistently; foreground geometry stops the march correctly; camera entry/exit has no boundary clipping; minimal directional shadows work in both directions; results stay valid without temporal history. Compare GPU images numerically and inspect them visually.

**Review R1:** a working viewer with three seeded shape choices and ground/side/inside views. Ask for preference on silhouette, scale and softness. Continue correctness work and the 2D track while feedback is pending; keep appearance provisional rather than blocking all work.

## P2 — Coverage, generation and distance

**Deliver:** a cloud field seen from the ground, at medium distance, near the horizon and from within. Start with distributed bounded fields and stable world-space generation. Add projected-size detail selection, conservative acceleration and an update policy. Resolve overlapping volume density in the shared integration path; do not simply alpha-sort overlapping cloud boxes.

Profile generation, upload, ray integration and lighting separately. Compare the bounded-field baseline with one targeted brick/atlas or clipmap experiment only if residency, coverage or update cost motivates it. Record the tradeoff in an architecture decision. Fine detail may remain procedural. Lower-resolution representations must preserve cloud mass/optical appearance well enough to avoid popping.

Integrate track L's thin/far layer as an option. Maintain volumetric distant formations when silhouette/parallax matters. Use a classic procedural volumetric far field only if measured coverage/quality requires it. Prevent rendering the same cloud twice during transitions.

**Exit:** a continuous ground-to-cloud flight has stable horizon coverage, no obvious holes at region/LOD boundaries, bounded working-set memory, and acceptable update spikes under the current budget proposal. Compare acceleration against a reference, including thin wisps. A beautiful isolated volume does not pass P2.

**Review R2:** fixed fly-through plus free camera; representation/coverage and memory overlays. Human review targets repetition, transition visibility and whether distant coverage feels convincing. If art feedback is unavailable, retain alternate presets and proceed with compatible lighting work; do not claim visual acceptance.

## P3 — Required shadows, atmosphere and environment

**Deliver:** cloud self-shadowing, cloud shadows cast on opaque scene geometry, and scene occluders casting into clouds, initially for a directional sun. Demonstrate ground terrain and an object crossing the lit cloud. Select shadow/light-density caching based on P2 profiles; update it when sun or density changes.

Define explicit shadow hooks/material support for the first release. Do not claim arbitrary material/light support. Complete sky composition with cloud radiance/transmittance, atmosphere ordering, and separate environment-capture state. Supply a directional cloud contribution for sky/environment capture rather than baking only the current camera's cloud image. Include diffuse and specular test objects, with a configurable environment refresh policy and no duplicate tone mapping/haze.

**Exit:** moving sun, density and geometry invalidate the right caches; both shadow directions visibly work; the environment is free of main-camera temporal state; caller-owned background/environment resources survive detach. Opaque composition is correct. Document the initial limitation for arbitrary interleaved transparency/refraction.

**Review R3:** time-of-day slider, moving occluder, diffuse sphere and reflective sphere, cloud-only/sky-only/composite views. This is the best point for your sky integration judgment. Continue tests and reconstruction inputs while art/API feedback is pending.

## P4 — Reconstruction and performance presets

**Deliver:** a comparison viewer using the author's upscaler. First preserve a native-resolution/spatial reference. Compare final-scene upscaling against reduced-resolution cloud reconstruction before composition. Introduce one temporal reconstruction owner initially.

Define jitter ownership, cloud depth/motion approximation, reactivity for changing density/lighting, exposure, disocclusion and reset events. Validate radiance/transmittance reconstruction independently; alpha support does not prove cloud optical correctness. Reuse early guides where useful. Investigate double reconstruction only after a single-stage baseline passes.

**Exit:** reproducible still and motion captures covering camera cuts, rapid fly-through, wind, sun changes, voxel edits, resize and foreground edges. No history reuse across cameras/captures. Selected presets demonstrate a measured net frame-time benefit at an explicitly assessed image-quality cost on supported devices. Reject an optimization that only improves its isolated pass while making the whole frame worse.

**Review R4:** matching recorded paths with modes switchable, including motion playback. Present a small set of quality/performance choices with measurements; human review sets the acceptable ghosting/detail tradeoff. Missing RTX evidence means Windows performance is unverified, not implicitly passed.

## P5 — Package APIs and R3F v10

**Deliver:** stable lifecycle/update/render contracts, minimal plain Three.js examples, then equivalent R3F v10 components/hooks. Keep frame scheduling and GPU logic outside React bindings. Include an independent 2D-only consumer, an environment integration consumer and a voxel consumer.

Test repeated mount/unmount, shared assets, async loading cancellation, resize, camera replacement, multiple views and scheduling with the upscaler. Make mutation/update costs explicit. Coordinate sky/R3F changes in narrowly scoped patches when needed; the baseline should remain runnable at pinned revisions while upstream work is reviewed.

**Exit:** packaged consumers build/run without workspace aliases; the 2D entry does not pull voxel/VDB/WASM payloads; vanilla does not pull React; disposal and resource sharing behave correctly; examples produce equivalent results. Asset loader contract and public API changes are reviewed centrally before parallel migration.

**Review R5:** two short usage examples and a live React scene. Ask for API/scheduler feedback with concrete alternatives. Routine fixes do not require approval. Public API freeze waits on unresolved material API choices, while unrelated tests/docs continue.

## Track L — Independent lightweight clouds

Starts after P0 establishes app and composition conventions. Own runtime directory, optional shared weather/sun settings, standalone smoke/thin-cloud layer, and background-preserving demo. It must load without the voxel runtime. Prototype an environment contribution in parallel with P3 once that contract exists. Do not require VDB, FSR or React to use it. Check horizon projection, animation, alpha behavior and overlap with the volumetric system.

This track can reach a usable preview before the volumetric renderer is finished. Its visual review joins R2/R3 rather than creating another approval ceremony.

## Track A / P6 — Asset tools and authored cloud objects

Start A after P1's density contract. First implement metadata validation and dense loading using generated fixtures. Next prove one static DCC-authored density import through an existing converter (native CLI or optional WASM) into the runtime payload; then support a mesh → SDF/occupancy → shaped density preview. Preserve voxel spacing, transforms, background and density semantics. Keep fixtures redistributable and record conversion commands/versions.

Compare PicoVDB/sparse storage only on the same representative cloud asset; inspect actual supported grid classes and filtering. VDB import does not mandate direct sparse rendering. Before promising VDB export, prove a writer and a DCC round trip; finite bounds/resolution/time must be chosen for generated cloud exports. Browser WASM is welcome but needs startup/peak-memory measurements. Animated imported sequences, generalized streaming and broad DCC UI plugins remain later scope unless prioritized.

**Exit for the initial asset extension:** one authored density volume and one mesh-derived cloud render through the existing integrator with equivalent transforms/density; malformed inputs fail before large allocations; cancellation/disposal works; supported source formats and conversion requirements are documented. Direct sparse playback and VDB export each have separate evidence gates and can ship later without holding up the main renderer.

## P6 — Validation and release boundary

Consolidate P0–P5 evidence and any completed asset track. Run the reference paths on the M5 Pro and RTX 3060 with recorded OS/browser versions. Cover package installation, limitations, API examples, attribution, MIT notices, device loss/recovery policy and capability errors. Prepare a concise technical write-up from actual results.

**Renderer release gate:** volumetric ground-to-inside coverage, independent 2D system, required cast/receive shadows, sky/environment integration, selected scalable reconstruction path, plain Three.js and R3F v10 APIs, and documented hardware results. Missing required items are not silently moved to a later release. A technical preview can be earlier if clearly labeled incomplete.

**Asset extension gate:** static import + mesh-derived density as above. Sparse runtime and `.vdb` export are separate optional deliverables. Final scope is revisited using the unanswered asset questions; full-cloud-library completion must enumerate which capabilities shipped and which remain.

Prepare local packages and a reviewable changelog before any publishing decision. Do not publish npm packages, deploy a demo or merge upstream changes just because a phase is complete; those external actions need the corresponding user instruction.

## Checkpoint behavior and evidence

Every phase ends with a runnable scene, short capture, measurements with exact settings, known limitations and a short recommendation. The human should judge a concrete result. The orchestrator performs technical acceptance and continues independent work while optional feedback is pending. Pause only the dependent decision when a requested choice is necessary; no silence-as-approval and no repeated permission requests for ordinary implementation.

Keep stage state in the work queue. Record technical acceptance and human feedback separately. Numeric quality tolerances are set from reference cases before judging a change, not retrofitted to make it pass. No estimate of calendar duration or token savings is promised before the first phase establishes actual throughput.
