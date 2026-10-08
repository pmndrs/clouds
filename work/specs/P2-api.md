# P2 spec: drop-in API v0

Goal: clouds in any three WebGPU app in ≤ 20 lines, with a renderer-agnostic
core underneath. The API is driven by the open-water scene, not by packaging.
Final npm names (for example `@pmndrs/clouds`) are a P7 decision; the
workspace names below are internal.

## Layers

| Package | Imports | Role |
| --- | --- | --- |
| `@clouds/runtime` (`packages/runtime`) | WebGPU only | Core: volumes, generator, light grid, march, composite, reflection dome. `encode(encoder, frame)`. No three. Enforced by a test that scans for `from 'three'`. |
| `@clouds/three` (new `packages/three`) | three/webgpu, three/tsl | Adapter: `Clouds` class plus TSL nodes. Owns three interop (device, GPUTexture access, render-pipeline hooks), following `@pmndrs/upscaler`'s pattern (`~/Developer/upscaler/src/{UpscalerNode.ts,internal/threeWebGPU.ts,internal/renderPipelineHooks.ts}`). |
| `@clouds/sky` bridge (inside `@clouds/three`, optional) | @pmndrs/sky | Feeds the atmosphere LUTs into the runtime. Without a sky, the runtime takes plain sun and ambient uniforms. |

The legacy `packages/three` and `packages/react` move to `packages/legacy/*` in P2-00.

## Target usage (the demo must look like this)

```ts
import { Clouds } from '@clouds/three'
const clouds = new Clouds(renderer, { sky, quality: 'high' })            // sky optional
await clouds.load({ volume: '/clouds/parkouring/', position: [0, 500, 0] })  // or clouds.setVolume(generated.volume, …)
const scenePass = pass(scene, camera)
const hazed = sky.applyHaze(scenePass.getTextureNode(), { scenePass })    // optional: haze the scene first
post.outputNode = clouds.node(hazed, scenePass)                           // clouds composite; they carry their own AP
renderer.setAnimationLoop(() => { sky.update(camera); sky.updateAerialPerspective(); post.render() })
```

- The cloud passes run in the node's `updateBefore` (`NodeUpdateType.FRAME`)
  after `scenePass` has rendered. They use the shared device and three's
  encoder timing.
- Clouds composite onto the colour input as `color · a + rgb`. Shadows are
  already folded into `a` (P1-07). The result goes through the pipeline's
  output transform (tone mapping) as usual.
- The order is scene haze, then clouds, so clouds are never double-hazed.

## Core API (`@clouds/runtime`) v0

```ts
const clouds = createCloudRuntime(device, { quality })
clouds.setVolume(volume: GpuCloudVolume | CloudVolumeAsset, { position })  // one volume in v0; many in P3
clouds.setNoise(asset)
clouds.resize(w, h)
clouds.encode(encoder, frame: CloudFrame, timer?)
clouds.output                    // rgba16f premultiplied radiance + (T · shadow)
clouds.dome?                     // P2-04 reflection dome texture (rgba16f, octahedral/equirect)
clouds.settings                  // typed, documented knobs (see P1-05/09)
clouds.dispose()
```

`CloudFrame.lighting` is one of:
- `{ kind: 'atmosphere', bindGroup }`, from the sky bridge
- `{ kind: 'uniform', sunRadiance, ambientTop, ambientBottom }`, with no sky
  library

## Cloud reflections (P2-04)

- Nubis renders a reflection dome without up-rez: `cRenderDome` uses `P·S`
  density.
- The runtime keeps a low-res dome (octahedral, about 256², rgba16f with
  radiance and T). It refreshes 1/16 of its texels per frame, from a reference
  point such as the camera's ground position.
- The adapter exposes `clouds.reflection(dirNode): vec4`. Reflective materials
  blend `env · T + L`, and the ocean uses it.

## Measures (from the AUDIT plan)

- Core has no three imports (test).
- Clouds in a new three scene in ≤ 20 lines; the demo is the proof.
- The open-water scene runs at 60 fps for the whole frame at 2560×1440, with
  cloud reflections and shadows on the water.
- Clouds sort correctly against scene depth: in front of, behind and inside
  objects.
- Ultra/high/medium/low presets, each with a measured cost table.
