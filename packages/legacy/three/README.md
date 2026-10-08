# @clouds/legacy-three — WebGPU preview

Plain Three.js cloud runtimes. Requires Three.js **0.186.0** and an initialized
WebGPURenderer. Current appearance is a prototype: banding, finite far coverage,
coarse shadows and approximate atmosphere remain open.

```ts
import { createCloudscape, createCloudWorld, createCloudscapeAtlas } from '@clouds/legacy-three';

await renderer.init();
const world = createCloudWorld({ seed: 17 });
const clouds = createCloudscape(renderer, createCloudscapeAtlas(), world.snapshot);
clouds.resize(width, height); // physical pixels
renderer.setAnimationLoop(() => {
  clouds.setWorld(world.update(camera.position.toArray()));
  clouds.render(scene, camera); // scene, clouds and presentation once
});
// On removal: clouds.dispose(); caller retains renderer, scene and camera.
```

Sources use metres and dimensionless density mapped to inverse-metre extinction.
CPU atlases can be reused; each runtime owns its own GPU copy. Sources remain
caller-owned. Each camera/view needs a separate runtime. The renderer supports
conventional WebGPU depth and perspective cameras. Explicit `render(..., false)`
leaves linear HDR output for host composition; tone map once at presentation.

Separate entries:

- `@clouds/legacy-three/layers`: lightweight `createCloudLayer`, no voxel/FSR/React import.
- `@clouds/legacy-three/environment`: independent fixed-probe capture and environment attachment.
- `@clouds/legacy-three/optical-resolve`: paired cloud radiance/transmittance reconstruction.
- `@clouds/legacy-three/reconstruction`: optional FSR adapter; currently requires the exact
  author's upscaler snapshot at commit `4a79229c82b84246582fb8ca3b8d31aa8f391e88`,
  included with local preview artifacts. Registry version 0.2.0 alone does not
  identify that build. The package is not needed for the other entries.

The package is an unpublished local preview; the API is not frozen.
