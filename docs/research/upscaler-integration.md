# Mixed WebGPU/TSL rendering and upscaler integration

Inspected 2026-09-16: local `/Users/dex/Developer/upscaler`, clean checkout at `4a79229`, package `@pmndrs/upscaler` 0.2.0. This is source inspection, not a GPU execution or an independent validation of FSR parity/performance. The project was read only; its documentation is reference material, not instructions for the clouds project.

## What the implementation demonstrates

| Mechanism | Evidence in the local checkout |
| --- | --- |
| Obtain Three's initialized WebGPU device and native texture handles | [threeWebGPU.ts](/Users/dex/Developer/upscaler/src/internal/threeWebGPU.ts:33) accesses `backend.device` and `backend.get(texture).texture`, with explicit errors for unavailable resources |
| Compile raw WGSL compute pipelines | [ComputePass.ts](/Users/dex/Developer/upscaler/src/internal/ComputePass.ts:34) creates shader modules, pipelines and bind groups, then dispatches directly |
| Submit work on the same device queue | [Upscaler.ts](/Users/dex/Developer/upscaler/src/Upscaler.ts:491) creates a command encoder, encodes passes and submits its command buffer |
| Return outputs to Three without a CPU texture round trip | [Upscaler.ts](/Users/dex/Developer/upscaler/src/Upscaler.ts:1057) creates Three `StorageTexture` objects, initializes them, and binds their native handles for compute writes |
| Schedule raw compute as part of a node graph | [UpscalerNode.ts](/Users/dex/Developer/upscaler/src/UpscalerNode.ts:203) registers input dependencies, dispatches in `updateBefore`, and exposes output through `passTexture` |
| Expose intermediate results between stages | [TemporalGuidesNode.ts](/Users/dex/Developer/upscaler/src/TemporalGuidesNode.ts:25) supports geometry-guide production before effects and a linked late upscale stage |

The verified sharing path uses textures allocated through Three. Arbitrary external texture registration, shared storage buffers, 3D textures and 3D dispatch are extensions to verify, not capabilities established by this 2D upscaler inspection. Its compute wrapper dispatches a 2D grid; voxel generation needs appropriate 3D layouts/workgroups.

## Revised shader policy

Prefer TSL for composition, scene materials and shader logic where it is useful. Use embedded WGSL functions/nodes where they fit the node graph. Use direct WGSL compute or render passes for generation, traversal, acceleration structures, lighting caches or integration whenever clearer or more capable. Do not defer a required feature merely because it cannot be expressed through public TSL nodes.

All paths use the host Three renderer's device. Put internal Three access in a small compatibility bridge with explicit version checks and integration tests. Keep encode/dispatch logic separate from node wrappers so vanilla and R3F can schedule the same system. Evaluate the v10 scheduler for vanilla reuse; inspect its actual API and dependency cost before committing that dependency.

Resource contracts must record ownership, dimensions, formats, usage flags, initialization and lifetime. Three owns resources allocated through its wrappers; our system owns its private resources. Rebuild views/bind groups when allocations change. Declare pass dependencies and submit producers before consumers; sharing a device alone does not establish ordering. Avoid CPU readback or a per-frame wait for GPU completion to connect passes. Dispose only owned resources and reset/rebuild on resize or device loss.

The upscaler installs render-pipeline callbacks for camera jitter. A cloud system must coordinate through one jitter/frame owner and compose hooks rather than overwrite another effect's callback. Histories also need per-camera/per-view state: a main view, an environment capture and a second camera cannot accidentally share the same temporal frame.

## Where FSR-style reconstruction can fit

### A. Upscale the composed scene

Proposed initial integration baseline: render scene and clouds at an agreed internal resolution, compose linear HDR color, supply scene depth/velocity plus cloud reactivity, then run the upscaler before display tone mapping. This saves scene rendering work as well as cloud pixels. The inspected node preserves linear HDR output.

Scene depth/velocity do not describe evolving cloud density. Reactive masks can reduce history use where cloud appearance changes, but they do not replace cloud motion information. Camera cuts, wind, lighting changes and voxel updates must be tested. This is an integration candidate, not a promise that the existing scene upscaler requires no cloud-specific work.

### B. Reconstruct the cloud layer before composition

Render cloud radiance and transmittance at reduced resolution; reconstruct them to the composition resolution while leaving scene geometry at higher resolution. This can save ray-march work without reducing geometry quality.

Investigate adapting the upscaler's lower-level passes and guides. A volume contributes over a depth interval, so a representative cloud depth/motion is approximate. Preserve transmittance in `[0,1]`, empty-cloud output and the `L_cloud + T_cloud * L_scene` composition contract. The package's alpha support alone does not prove correct reconstruction of cloud transmittance; validate the chosen packing/filtering. Geometry guides can inform occlusion and disocclusion, but cannot supply volumetric wind/deformation motion.

The inspected high-level UpscalerNode sizes its output from the drawing buffer. Arbitrary intermediate resolutions may need the imperative API or a wrapper extension. Use spatial reconstruction as a reference and for cases without reliable temporal guides.

### C. Two reconstruction stages

Cloud-layer reconstruction followed by final-scene reconstruction remains an experiment. Coordinate jitter, reactive signals and reset events, avoid redundant sharpening, and measure the combined history's ghosting and detail loss. Start with one temporal reconstruction owner; enable two only when the comparison justifies it.

Upscaling reduces screen-space sampling work. It does not solve voxel residency, large-world coverage, volume generation, shadow-map cost or missing cloud structure. Keep these budgets separate. This integration concerns reconstruction/upscaling; frame generation is not assumed.

## Acceptance comparisons

On the author's M5 Pro and RTX 3060, compare native-resolution reference, cloud-only reconstruction, final-scene reconstruction, and an optional combined path. Record internal/output resolutions, total GPU time and per-stage costs, memory and history settings. Include ground-to-cloud flight, horizon silhouettes, moving cloud shadows, changing density, camera cuts and geometry crossing cloud edges.

Validate Three → raw WGSL → Three texture use and the reverse producer/consumer order, resource replacement and disposal, plus multiple graph consumers. Pin the actual Three, upscaler and R3F revisions for each run. No performance thresholds are invented before the budget decision.
