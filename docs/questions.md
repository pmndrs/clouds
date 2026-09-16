# Questions and decision log

Status: open unless explicitly answered. Defaults below are proposals, not author decisions.

## Confirmed in conversation

- First release: desktop WebGPU quality, with scalable presets.
- Vanilla: framework-free JavaScript using Three.js; no standalone raw WebGPU backend required.
- Source model: physically informed procedural generation and DCC/mesh-authored VDB are density inputs to one volumetric renderer.
- Primary experiences: procedural volumetric clouds and distant clouds. Distant clouds can use either full volumetrics or a simple 2D layer.

- Runtime systems: the volumetric integrator and independently usable 2D/lower-cost layer may be separate systems/packages.
- VDB is optional interchange/import/render/export support, not the mandatory internal representation.
- WASM is welcome for loading, generation and conversion/export when useful.
- Sky integration should prioritize environment-map composition. Coordinated sky/R3F integration changes are possible; current APIs are not fixed constraints.
- Large cloudscapes are the main focus; objects turned into clouds are a valuable additional use.

## Central decision — approved

The voxel-first hybrid is approved. See [approach discussion][1]. The author’s answers below are preserved; unresolved items remain pending.  
ANSWER: I approve the hybrid approach.   
We should also consider a 2d distant/far approach where useful. Thin clouds/coverage is often easy to do as a smoke layer. 

## Consolidated decisions from answers (2026-09-16)

- Voxel-first hybrid approved, with an independently useful 2D far/thin-cloud layer.
- Initial development/test devices: Mac M5 Pro and Windows RTX 3060. High-end desktop first; mobile later. Numerical frame/memory budgets and browser versions remain open.
- R3F v10 is required. Investigate using its scheduler in vanilla; no dependency decision yet.
- Prefer TSL/embedded WGSL where useful; direct WGSL passes on Three’s device are allowed. Do not defer features because public nodes cannot express them. Use the local upscaler as a concrete integration reference.
- Local-world ground, sky and inside-cloud views first; planetary rendering is secondary.
- Clouds must cast and receive shadows. Proposed first scope: directional sun + opaque scene geometry; arbitrary interleaved transparency remains an explicit limitation to revisit.
- MIT; repository target `pmndrs/clouds`. Exact npm package names remain open.
- Use current sky/R3F development as needed and pin the versions tested together.
- Environment contribution is intended to affect lighting when fed into the lighting environment. Proposed integration default: opt-in visible background + filtered diffuse/specular environment contribution, with a separate refresh policy. A standalone dome affects lighting only if included in an explicit environment capture or another lighting path. Exact modes/cadence remain open.
- Evaluate cloud-only and final-scene reconstruction using the author’s upscaler; see [integration evidence](research/upscaler-integration.md).

Still unanswered: static versus animated authored assets and fixture licenses (6), initial conversion formats/runtime split (7), numerical performance and memory targets (1), and exact environment update policy (10). Provisional implementation scope can begin with static fixtures and optional offline conversion without claiming those choices were approved.

## Before implementation planning

1. Which browser/OS/GPU combinations must work? What cloud GPU-time budget and target canvas resolution should we use on each?  
	ANSWER: We are developing on Mac M5 Pro. I would say Mac/windows at high end first, then work down systems. A Fantasy would be mobile at latest but less critical. (Fortnight uses a lightweight version of Unreals Clouds) Windows wise I have a 3060 I can test on, Mac a M5 Pro. 
2. Is R3F v10 a strict release requirement, or should the adapter support a current stable line while v10 matures? Pin exact tested versions after the compatibility research.  
	ANSWER: For r3f we absolutely  use v10. The scheduler alone is amazing, we might even use it in vanilla. 
3. Is limited private Three.js integration acceptable for an experimental release if public node interfaces cannot cover a required feature? Proposed default: prefer public APIs and defer the feature.  
	ANSWER: If public nodes won’t work and we can’t make them, it’s totally fine to do it in pure wgsl etc. Avoid deferring, if we have to do it in pure wgsl that’s totally fine. 
4. Planet-scale curved atmosphere, local worlds, or both? Must the first version work inside/above clouds and at the horizon?  
	ANSWER: I think the ground, sky versions are first. The point of voxels is to work inside, so that should be our tests/showcases. I’m less concerned about planets but that’s a nice demo. Mostly about local worlds or doing work like the geospatial library for example. 
5. Must first-release clouds cast shadows on scene geometry? Must they receive scene shadows or interleave with transparent objects?  
	ANSWER: Yes to cast/recieve shadows. Not sure on transparency. I defer to your judgment. 
6. For authored volumes, are static assets enough initially, or are animated sequences/streaming required? Which sample meshes/VDBs can be used as licensed fixtures?
7. Which operations should run in-browser with optional WASM, and which can begin as native tooling? Which source mesh formats and VDB import/export operations matter first?
8. What package namespace and license do you want? Should all default assets and noise sources be redistributable under the same license?  
	ANSWER: I prefer MIT. Im planning on doing it under pmndrs/clouds for the monorepo. 
9. Which sky/R3F branches should coordinated integration target? Define the environment composition hook and its update policy; changes to these systems are available.  
	ANSWER: There’s active dev there. Use the latest when needed. We can update that package together. 
10. Should clouds in the environment affect reflections only, diffuse lighting too, or just the visible background? What refresh latency is acceptable?  
	ANSWER: I’m not totally sure. If its rendering in the generated envmap it would effect lighting. If it’s a dome on its own it wouldn’t. 

## Later decisions

- Authoring controls: weather maps, sculpted voxel volumes, mesh-derived shapes, presets, or combinations.
- Layer count and overlapping volume policy; wind and animation controls.
- XR/multiple cameras, large-world precision, offline cubemap baking.
- Monorepo/release tooling and whether usages graduate from subpath exports into packages.
- Debug views, editor integration and asset caching/streaming.

## Decision record

| ID  | Status    | Decision                                                                                                |
| --- | --------- | ------------------------------------------------------------------------------------------------------- |
| D01 | Requested | Research/spec first; detailed execution and agent orchestration plans follow                            |
| D02 | Confirmed | Vanilla means plain JavaScript with Three.js; package this API, then add React Three Fiber v10 bindings |
| D03 | Proposed  | Monorepo with shared core, rendering adapters and isolated asset tooling                                |
| D04 | Proposed  | Treat density source and presentation as separate axes                                                  |
| D05 | Proposed  | Dense texture reference path before selecting sparse runtime storage                                    |
| D06 | Proposed  | Prove Three.js scene integration before freezing render interfaces                                      |
| D07 | Confirmed | Desktop WebGPU quality with scalable presets                                                            |
| D08 | Confirmed | Volumetric and distant cloud experiences are primary; distant clouds can be volumetric or 2D            |
| D09 | Confirmed | Procedural and authored VDB differ by density source; share volumetric rendering                        |
| D10 | Confirmed | Independent 2D/lower-cost and volumetric runtime systems are allowed                                    |
| D11 | Confirmed | VDB is optional interchange; WASM loading/generation/export is allowed                                  |
| D12 | Confirmed | Prioritize sky environment-map integration; coordinated sky/R3F changes are possible                    |
| D13 | Confirmed | Voxel-first hybrid cloudscapes with procedural generation/detail |
| D14 | Confirmed | M5 Pro and RTX 3060 first; mandatory R3F v10; MIT under pmndrs/clouds |
| D15 | Confirmed | Mixed TSL/embedded WGSL/direct WebGPU allowed; use upscaler integration reference |
| D16 | Confirmed | Local ground/sky/inside views and cloud shadow casting/receiving required |
| D17 | Investigate | Cloud-only versus final-scene upscaling; optional v10 scheduler reuse in vanilla |

[1]:	approach-decision.md