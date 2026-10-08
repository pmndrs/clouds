# WebGPU Clouds — draft library specification

Status: proposal for discussion, not an implementation commitment. Research started 2026-09-15; decisions updated 2026-09-16.

## Purpose

A composable cloud library that starts with framework-free JavaScript using Three.js WebGPU, then adds React Three Fiber bindings. Support both procedural cloudscapes and authored cloud volumes, with inexpensive distant-cloud presentation available separately. Repository target: `pmndrs/clouds`; license: MIT. Individual npm package names below remain placeholders.

Confirmed direction: desktop WebGPU quality with scalable presets; vanilla means plain JavaScript using Three.js. Large-scale cloudscapes and distant clouds are the primary focus; cloud-shaped objects and imported volumes are complementary capabilities. Distant clouds may use full volumetrics or a simpler 2D layer. Initial reference hardware is the author’s Mac M5 Pro and Windows RTX 3060. Target high-end desktop first; mobile is a later stretch target. R3F v10 is required. Local-world ground, sky and inside-cloud views take priority over planetary rendering.

## Independent runtime systems, shared volumetric sources

Confirmed source model: procedural and VDB describe where density comes from, not different cloud renderers. Our procedural source generates cloud structure informed by real cloud formation and systems such as Decima. Authored volumes arrive from Houdini, Blender, Maya, or our mesh-to-volume process. Both feed the same volumetric lighting/integration pipeline. VDB is an interchange/input option; GPU storage is a separate implementation choice. A hybrid source may combine authored macro-shape with generated detail.

| User experience | Density/content | Presentation | Scope |
| --- | --- | --- | --- |
| Fly through a cloudscape | Procedural weather, base shape, detail | Depth-aware volumetric integration | Primary renderer |
| Place an authored cloud | Dense grid or sparse volume, optionally procedural detail | Same integrator over bounded volumes | Asset loader + tooling |
| Wrap a world with clouds | Distant layer, initially procedural 2D | Transparent dome/shell | Separate low-cost material |
| Clouds in background/reflections | Distant layer or captured volumetric result | Background composition / environment capture | Separate outputs and update policy |
| Integrate with pmndrs/sky | Cloud radiance/transmittance from either runtime | Environment-map composition and atmosphere integration | First-class integration design |

The volumetric renderer and simple 2D/lower-cost layer may be independent runtime systems, usable and loadable in isolation. Share only useful contracts such as lighting, weather controls and composition outputs; do not force all systems through one integrator. These are capabilities, not five mandatory npm packages. A dome does not imply a fly-through volume; a background image does not imply scene lighting. Environment capture has its own cost and refresh policy.

## Proposed monorepo boundaries

| Package | Responsibility | Dependencies |
| --- | --- | --- |
| `@scope/clouds-core` | Settings, units, transforms, asset descriptors, quality definitions, shared math | No Three.js/React or browser initialization |
| `@scope/clouds-three` | Three.js WebGPU/TSL rendering, temporal integration, camera/depth mapping, dome and environment helpers | core, Three.js peer |
| `@scope/clouds-react` | R3F lifecycle, declarative components, updates and disposal | three adapter, React/R3F peers |
| `@scope/clouds-assets` | Versioned asset decoding, validation, loading and cancellation | core; optional decoder imports |
| `@scope/clouds-tools` | Offline mesh/volume conversion, inspection and reproducible asset builds | Build-time dependencies only |

Start with folders and narrow exports; publish only when an independently useful surface exists. Procedural/data/layer/environment can be subpath exports before becoming separate packages. The lightweight runtime must be independently importable without volumetric shaders/assets. Separate runtime packages are appropriate if their dependency or release needs diverge. Sky integration may include coordinated changes to sky/R3F: the author maintains both, so current APIs are an implementation starting point rather than a fixed boundary.

Suggested workspace: `packages/`, `examples/vanilla`, `examples/three`, `examples/react`, `fixtures/`, `docs/`. Package manager and release tooling are deliberately undecided. Keep heavyweight converters out of default runtime bundles; offer optional WASM modules/workers and native CLI tooling where useful.

## The architectural gate: integration with the host scene

Use runtime implementations shared between vanilla JavaScript and React. TSL and embedded WGSL nodes are preferred where suitable; direct WGSL compute/render passes on Three’s device are fully supported architectural choices. A separate renderer/device is not required. The first feasibility experiment should prove scene depth access, render-pass ordering, temporal buffers and background composition against a pinned Three.js release.

The author’s [upscaler integration](research/upscaler-integration.md) provides a concrete pattern: obtain Three’s device/native handles, dispatch raw compute into Three-owned storage textures, and expose results as nodes. Isolate internal access in a tested compatibility bridge; do not defer features because TSL cannot express them. Specify pass ordering, resource ownership and usage flags. Validate shared buffers and 3D textures separately from the demonstrated 2D texture path.

## Rendering contract (proposed, not shipping API)

### Density-source boundary

Every volumetric source provides world bounds, a world-to-density transform, a density sampling implementation, a content revision and optional conservative occupancy/majorant data for skipping empty space. Dynamic sources also declare time-dependent updates. The integrator consumes nonnegative extinction derived from that density, independent of its authoring origin. Treat density normalization and the extinction scale as explicit metadata so the same asset does not silently change optical thickness between hosts.

Source implementations may use TSL, embedded WGSL or raw WGSL passes and provide textures/buffers; this is a GPU-side contract, not a JavaScript callback invoked for every ray sample. A procedural source owns weather/type profiles, macro-shape and detail generation. An asset source owns decoding, transforms and density semantics. The shared integrator owns lighting, ray stepping, transmittance and reconstruction. Optional source acceleration data must never skip nonempty regions incorrectly.

The simple 2D distant layer shares lighting/weather controls where meaningful, but does not have to pretend to implement a 3D density source.

### Host inputs, outputs and lifecycle

Require cloud shadows on scene geometry and opaque scene shadows received by clouds for the initial volumetric release. Scope the first implementation to a directional sun, including self-shadowing and explicit scene-shadow access. Other light types can follow. Proposed transparency scope: correct opaque-depth composition and normal final alpha composition, with arbitrary interleaved translucent/refractive surfaces deferred; document and test the supported cases.

- Inputs: camera and previous-camera state, viewport, time/seed, density source + transform, sun direction/radiance, ambient lighting, optional scene depth, quality settings.
- Coordinates: document handedness and matrix conventions; physical distances in metres; explicit volume-to-world transforms. Separate local bounded coordinates from future planet-scale support.
- Outputs: linear HDR cloud radiance and transmittance, plus representative cloud depth/history metadata where required. Compose as `cloudRadiance + transmittance * sceneRadiance` before tone mapping. This assumes the selected cloud ray segment precedes the sampled scene surface.
- Depth integration: stop integration at opaque scene geometry; define reverse-Z, clear-depth and projection conventions per adapter. A first version may require one documented projection mode.
- Scheduling: host controls update/render order; no hidden animation loop. Plain JavaScript examples may own a loop. Explicit resize, dispose, cancellation and device-loss behavior.
- History: per-camera/per-view resources; reset on camera cuts, incompatible density/settings changes, resolution changes and resource replacement. Test rapid movement and disocclusion, not only stationary beauty shots.
- Transparent/transmissive geometry, overlapping volumes, atmosphere aerial perspective and multi-view/XR require explicit support levels. Do not promise correct arbitrary transparency ordering in the initial release.
- Environment output: capture linear HDR radiance separately from camera history; provide manual/on-change/throttled refresh. Filtering for reflections belongs to the host adapter. Preserve the caller's background and restore only resources the adapter still owns.

## Selected direction: voxel-first hybrid cloudscapes

Confirmed by the author: voxel-first cloud structure with procedural generation/detail. The classic Nubis lineage and existing WebGL/native versions are foundations and comparison references, not a competing product that must ship first. See [approach and coverage](approach-decision.md).

Support ground, medium/distant and inside-cloud views. Use spatially distributed cloud regions and progressively coarser representation as projected detail shrinks. Evaluate bounded volume instances first, then bricks/clipmaps if coverage and update measurements justify them; avoid a single dense texture spanning the world. Skipping/lighting acceleration is part of the feasibility work.

Medium/distant formations remain volumetric where silhouette, parallax or lighting needs it. An independent procedural 2D layer can provide thin high clouds and far coverage. A classic procedural volumetric far field is an optional solution if measurements justify it, not a requirement caused by using voxels. Transitions must preserve world-space weather and optical thickness; do not double-count the same cloud in two representations.

## Reconstruction and FSR integration

Use the author’s upscaler as both a reconstruction candidate and a Three/WebGPU integration reference. Compare final-scene upscaling with cloud-only reconstruction before composition. Keep one jitter owner, explicit cloud reactivity/motion, and consistent depth, exposure, history reset and radiance/transmittance semantics. A combined path needs evidence that two temporal stages do not add unacceptable ghosting or blur. Upscaling does not replace volume residency or generation work. See [source inspection and proposed pipelines](research/upscaler-integration.md).

## Authored density source and asset pipeline

First define a density asset independently of any source file format. Proposed metadata: format version, dimensions/topology, scalar encoding, bounds, voxel spacing, grid transform, density scale/units, background value, channel names and payload sizes. Validate dimensions and decoded sizes before allocation.

Use a simple dense density texture as a correctness reference and first transport option. Prototype PicoVDB or another sparse layout against the same fixtures; select it based on measured memory, traversal, filtering and conversion complexity. Keep original VDB as an authoring/interchange option even if runtime payloads differ. VDB import/rendering and optional export are valuable capabilities, not requirements for our internal cloud representation.

Mesh conversion must distinguish a surface/SDF from fog density. Proposed pipeline: validate mesh → voxelize/SDF → choose interior/shell falloff → map to density → optionally erode/add detail → export with metadata and preview. Open or non-manifold meshes need a declared policy. Cloud appearance requires an artistic density mapping, not just file conversion.

WASM is an allowed implementation tool for parsing, generation, voxelization, conversion and export. Prefer existing libraries when they cover the needed semantics. Benchmark initialization, peak memory and transfer/copy costs; run heavier work in optional workers. Before promising `.vdb` export, verify an actual OpenVDB writer and round-trip density values, transforms and scale in a DCC. `.pvdb`, `.nvdb` and `.vdb` are distinct formats, not interchangeable extensions.

## Sky and environment integration

Prioritize feeding cloud results into sky/environment composition rather than adding another sky dome. pmndrs/sky has a dome, but it is not the default integration target here. Coordinated sky/R3F changes are in scope for design; any future upstream publishing follows the agreed execution plan.

Design a cloud contribution interface for linear radiance/transmittance, sky lighting inputs, atmosphere depth information where needed, and environment refresh. Distinguish camera-local cloud rendering from environment capture: nearby volumes have parallax and cannot be represented accurately for every object by one distant map. Keep capture history/view state separate, and decide how to filter and refresh diffuse/specular lighting. Avoid applying atmosphere or tone mapping twice. The exact hook belongs to the implementation feasibility work, not today's fixed API.

## Quality and acceptance framework

Use the M5 Pro and RTX 3060 as initial reference devices; exact browser/OS versions, output resolution, GPU-time and memory budgets remain to be fixed before promising frame rates. Record render resolution, cloud coverage, camera position, step counts, texture memory, history buffers, GPU timing when available and CPU frame time. Preset names alone are not a benchmark.

Required scenes: empty sky; horizon layer; inside cloud; opaque object crossing volume; camera cut; rapid fly-through; resizing; dense and sparse versions of one authored volume; existing background preserved; environment refresh; mount/unmount and device-loss behavior.

Use deterministic seeds and reference images with tolerances. Verify energy/transmittance limits, homogeneous-volume integration, world-space scale, depth intersections and consistency between plain JavaScript and React integrations. Include a fixture asset manifest with source/license and exact conversion command/version. Runtime visual tests are future implementation requirements, not checks claimed by this research phase.

## Proposed staging, before detailed agent execution plans

The detailed [implementation phases](archive/implementation-plan.md), [agent orchestration](archive/agent-orchestration.md), and [work queue](archive/implementation-work-queue.md) now expand this outline. P0 foundation work has started; see the work queue and stage evidence for acceptance status.

1. Record confirmed hardware, MIT licensing, voxel-first direction and v10 requirement; settle remaining numerical budgets.
2. Pin research references and compatibility versions; establish scene integration and representative GPU feasibility experiments.
3. Prove voxel coverage from ground/horizon through inside-cloud views, generation and scene integration; build the independent distant 2D runtime. Include an authored-volume fixture.
4. Stabilize the mixed TSL/WGSL Three.js API; integrate mandatory R3F v10 and evaluate its scheduler for vanilla use. Pin tested revisions from active development.
5. Deliver environment capture and sky integration using the composition contract investigated early.
6. Extend asset import/export, sparse storage and shaping based on profiling. Required sun shadow casting/receiving and voxel acceleration belong to the initial volumetric release.

This outline expresses dependency ordering; the linked implementation plan is the execution reference. Integration experiments occur early even though public delivery proceeds plain Three.js JavaScript → packaged Three.js API → R3F.

## Research companions

- [Volumetric techniques and port candidates](research/volumetric.md)
- [Volume assets and conversion](research/volume-assets.md)
- [Three.js, R3F and sky integration](research/integrations.md)
- [Questions and decision log](archive/questions.md)
