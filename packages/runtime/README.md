# @clouds/runtime

The renderer-agnostic core of the WebGPU voxel clouds: Nubis³-style density, an SDF sphere-trace march, a voxel light
grid, a near/far resolution split with temporal amortization, a distant sky layer, a reflection dome, a GPU cloud generator,
stamping of authored clouds and an in-browser `.vdb` importer. It talks to WebGPU only (a test forbids importing three.js), so
it can sit behind any renderer. For three.js use [`@clouds/three`](../three/README.md); for React Three Fiber
[`@clouds/react`](../react/README.md).

> Workspace package, `private` for now. The npm name is not decided. Source-only: `exports` point at `src/*.ts` until a build step exists.

## Use it

You give it a `GPUDevice`, a scene depth texture and the camera matrices each frame; it hands back a texture to blend as
`scene * a + rgb`.

```ts
import { createCloudRuntime, GpuTimer, loadCloudNoise, loadCloudVolume, type CloudFrame } from '@clouds/runtime';

declare const device: GPUDevice;
declare const depth: GPUTextureView; // depth-only view of the scene's depth, at scene resolution
declare const camera: {
  view: Float32Array; projection: Float32Array; viewProjection: Float32Array;
  inverseViewProjection: Float32Array; previousViewProjection: Float32Array;
  position: [number, number, number];
};

const runtime = createCloudRuntime(device, { quality: 'high' }); // or 'auto'
const timer = new GpuTimer(device);
await runtime.setNoise(await loadCloudNoise('/clouds/noise/'));
const asset = await loadCloudVolume('/clouds/parkouring/');
await runtime.setVolume(asset, { position: [-432, 500, -432] }); // the volume's minimum corner, metres
runtime.resize(1920, 1080);

export function drawClouds(time: number, frameIndex: number): GPUTexture | null {
  const frame: CloudFrame = {
    view: camera.view, projection: camera.projection, viewProjection: camera.viewProjection,
    inverseViewProjection: camera.inverseViewProjection, previousViewProjection: camera.previousViewProjection,
    cameraPosition: camera.position, depth, depthKind: 'depth32float', sunDirection: [0.3, 0.8, 0.5],
    lighting: { kind: 'uniform', sunRadiance: [40, 38, 34], ambientTop: [6, 8, 12], ambientBottom: [2, 2.4, 1.6] },
    time, frameIndex,
  };
  timer.beginFrame();
  const encoder = device.createCommandEncoder();
  runtime.encode(encoder, frame, timer);
  timer.endFrame(encoder);
  device.queue.submit([encoder.finish()]);
  return runtime.output;
}
```

With a physical sky, pass `atmosphere` (a bind group over the sky LUTs; see `createAtmosphereBindGroup`) instead of `lighting`.

## What is in it

| Area | Exports |
| --- | --- |
| Runtime | `createCloudRuntime`, `CLOUD_QUALITY_PRESETS`, `CLOUD_QUALITY_ORDER`, `estimateCloudMemory`, `CloudSettings`, `CloudFrame`, `CloudRuntime` |
| Assets | `loadCloudVolume`, `loadCloudNoise`, `uploadCloudVolume`, `uploadCloudNoise`, `decodeSdf` |
| Auto quality | `selectTier`, `describeDevice`, `DynamicScale`, `AUTO_QUALITY_DEFAULTS`, `controlledCost` |
| Generate | `createVolumeGenerator`, `encodeProceduralWeatherMap`, `CLOUD_PRESETS`, `createStreamingCloudscape`, `createGeneratorScratch` |
| Authored clouds | `stampCloud`, `createSdfRebuilder`, `createEmptyCloudVolume`, `importVdb`, `convertVdb`, `inspectVdb` |
| Sky and lighting | `createSkyLayer`, `atmosphereWgsl`, `createAtmosphereBindGroup*`, `createLightGrid`, the reflection dome helpers |
| Tooling | `GpuTimer` (timestamp queries), the WGSL strings (`MARCH_WGSL`, `DENSITY_WGSL`, ...) |

Full signatures and defaults: [API reference](../../docs/guide/api.md#cloudsruntime). Tiers, budgets and memory:
[quality and performance](../../docs/guide/quality-and-performance.md). Making clouds: [authoring](../../docs/guide/authoring.md).

## Facts

- Needs WebGPU; `timestamp-query` is optional but required for `quality: 'auto'` to measure and for `GpuTimer`.
- Axes: world is y-up; volume textures are `(x, map row, up)`. Voxel size 8 m is the verified size.
- A `GpuCloudVolume` you pass to `setVolume` stays yours; a `CloudVolumeAsset` is uploaded and owned by the runtime.
- Size: the whole entry is 209.8 KB minified, 70.8 KB gzip. A consumer that uses only the render path (as `@clouds/three` does) bundles to about 51 KB gzip with the adapter. `node scripts/check-bundle.mjs` prints the current numbers.
- The `.vdb` importer bundles a vendored parser under the Apache License 2.0 (`vendor/vdb-web-tools`); see [credits](../../docs/guide/credits.md#webvdb-the-vdb-parser). That path is outside this package directory: publishing needs a bundled build, not `src`.
- `peerDependencies`: `@webgpu/types` (optional; for the `GPU*` types in your own type check).
