# @clouds/runtime

The renderer-agnostic core of the WebGPU voxel clouds: Nubis³-style density, an SDF sphere-trace march, a voxel light
grid, a near/far resolution split with temporal amortization, a distant sky layer, a reflection dome, a GPU cloud generator,
stamping of authored clouds and an in-browser `.vdb` importer. It talks to WebGPU only (a test forbids importing three.js), so
it can sit behind any renderer. For three.js use [`@clouds/three`](../three/README.md); for React Three Fiber
[`@clouds/react`](../react/README.md).

> Workspace package, `private` for now; the npm name is not decided. `exports` point at the built `dist/` (`node scripts/build-release.mjs`); the repo's lab aliases the source.
>
> Entries: `@clouds/runtime` (the render path), `@clouds/runtime/generate` (generator, presets, stamping, streaming, evolution) and `@clouds/runtime/import` (the `.vdb` importer, with its vendored parser).

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
| Generate (`/generate`) | `createVolumeGenerator`, `encodeProceduralWeatherMap`, `CLOUD_PRESETS`, `createStreamingCloudscape`, `createGeneratorScratch` |
| Authored clouds | `stampCloud`, `createSdfRebuilder`, `createEmptyCloudVolume` (`/generate`); `importVdb`, `convertVdb`, `inspectVdb` (`/import`) |
| Sky and lighting | `createSkyLayer`, `atmosphereWgsl`, `createAtmosphereBindGroup*`, `createLightGrid`, the reflection dome helpers |
| Tooling | `GpuTimer` (timestamp queries), the WGSL strings (`MARCH_WGSL`, `DENSITY_WGSL`, ...) |

Full signatures and defaults: [API reference](../../docs/guide/api.mdx#@clouds/runtime). Tiers, budgets and memory:
[quality and performance](../../docs/guide/quality-and-performance.mdx). Making clouds: [authoring](../../docs/guide/authoring.mdx).

## Facts

- Needs WebGPU; `timestamp-query` is optional but required for `quality: 'auto'` to measure and for `GpuTimer`.
- Axes: world is y-up; volume textures are `(x, map row, up)`. Voxel size 8 m is the verified size.
- A `GpuCloudVolume` you pass to `setVolume` stays yours; a `CloudVolumeAsset` is uploaded and owned by the runtime.
- Size: the core entry is 153 KB minified, 48.7 KB gzip; `@clouds/three` with the runtime parts it uses is 51.3 KB gzip. `/generate` adds up to 14 KB gzip and `/import` up to 19 KB (shared code counted in each). `node scripts/check-bundle.mjs` prints the current numbers.
- The `.vdb` importer (`/import`) bundles a vendored parser under the Apache License 2.0 (`vendor/vdb-web-tools` in this package; its LICENSE and NOTICE ship in the tarball); see [credits](../../docs/guide/credits.mdx#webvdb:-the-.vdb-parser).
- `peerDependencies`: `@webgpu/types` (optional; for the `GPU*` types in your own type check).
