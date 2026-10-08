# P5 preview API contract

2026-09-18. The user authorized progression through the remaining phases while
a separate quality bench addresses unresolved volume banding. Packaging can
advance; rendering quality, performance presets, and a stable API freeze remain
separate gates. No publication is authorized by this checkpoint.

## Packages and entry points

- `@clouds/core`: density metadata, units and validation. No renderer.
- `@clouds/three`: `createCloudscape`, `createCloudWorld`, `createCloudscapeAtlas`,
  `createReferenceCloud`, `createDensityField` and their types.
- `@clouds/three/layers`: independent `createCloudLayer` (no voxel/React/FSR import).
- `@clouds/three/environment`: explicit fixed-probe cloud capture integration.
- `@clouds/three/optical-resolve`: optional separate cloud L/T spatial resolve.
- `@clouds/three/reconstruction`: optional adapter for the author's FSR package.
- `@clouds/react`: R3F v10 lifecycle/scheduling wrappers over the same runtime.
- `@clouds/react/layers`: independent lightweight layer wrapper.
- `@clouds/assets`: portable validated dense asset transport and abortable loading.
- `@clouds/tools`: mesh conversion reference, separate from render delivery.

The package names remain local placeholders. ESM and declarations are built and
packed for clean-consumer validation; no npm scope ownership is assumed.

## Ownership and ordering

The caller initializes one Three WebGPURenderer and owns it, the scene, camera,
frame loop and CPU source data. Each runtime owns its GPU allocations and must
be disposed when removed. CPU fields/atlases can be shared: runtime upload makes
independent GPU resources. Do not mutate a source silently after upload; call
`setField` / `setWorld` with updated data/revision. GPU allocations are not
implicitly shared between runtime instances.

For a cloudscape frame, update world residency from the active camera, call
`setWorld`, set settings, then `render(scene, camera)`. This renders the opaque
scene, integrates clouds and presents once. `render(scene, camera, false)` leaves
linear HDR `output` and paired radiance/transmittance `optical` for explicit host
composition. It does not own tone mapping, exposure or the host's next pass.
Resize explicitly in physical pixels. Cloud-only reconstruction can keep the
scene target at a different resolution through `resize(w,h,sceneW,sceneH)`.

Independent cameras/views require independent runtimes and temporal histories.
Render shared-renderer views sequentially. Await compilation/environment capture
before another job uses that renderer; overlapping asynchronous jobs are not
supported. Both volume runtimes preserve the caller's render target, cubemap
face, mip level and MRT selection when rendering without presentation.
Only one adapter owns jitter and history for an FSR path. Environment capture
owns a separate runtime and refreshes explicitly. Receiver hooks attach only
to the supported node materials and restore them on detach/dispose.
Each receiving material has one live cloud receiver owner. A second attachment
is rejected before modifying the material. Use separate materials per view, or
detach the first owner before attaching the next; receiver caches are not
implicitly composited. Later caller changes to material hooks are preserved.

## Limits

Conventional WebGPU zero-to-one perspective depth only; no WebGL promise.
Three.js 0.186.0 and R3F 10.0.0-alpha.5 are the tested pins. Public wrappers
inherit the renderer's known banding, finite coverage/LOD, coarse shadow and
approximate-atmosphere limits. Packaging does not make those production-ready.
No implicit VDB parsing/export, arbitrary transparent-object interleaving,
automatic device-loss recovery or camera-independent temporal history sharing.
