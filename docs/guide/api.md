# API reference

Signatures and defaults here are read from the code. The source files carry the full doc comments:
[`packages/three/src/clouds.ts`](../../packages/three/src/clouds.ts),
[`packages/react/src/index.tsx`](../../packages/react/src/index.tsx),
[`packages/runtime/src/runtime.ts`](../../packages/runtime/src/runtime.ts).

Conventions used everywhere:

- **Axes.** World is y-up. Volume textures use the source axes `(x, map row, up)`: texture x is world x, texture y (the map row) is world z, texture z (the slice) is world y. `dims` is in these axes.
- **Units.** Metres. The packs and presets are built for 8 m voxels.
- **Volume position.** `@clouds/three` and `@clouds/react` take the **base centre** of the volume (x/z centre, y = floor). `@clouds/runtime` takes its **minimum corner**. The adapter converts.
- **Ownership.** A `CloudVolumeAsset` passed to `setVolume` is uploaded and owned by the runtime. A `GpuCloudVolume` (generator, stamp or import output) stays **yours**: the runtime never destroys it, and you must not destroy it while it is shown.

Contents: [`@clouds/three`](#cloudsthree) · [`@clouds/react`](#cloudsreact) · [`@clouds/runtime`](#cloudsruntime)

## @clouds/three

### `Clouds`

<!-- doc-preamble
import type { WebGPURenderer } from 'three/webgpu';
import type { CloudsOptions } from '@clouds/three';
declare const renderer: WebGPURenderer;
declare const options: CloudsOptions;
-->
```ts
import { Clouds } from '@clouds/three';
const clouds = new Clouds(renderer, options);
```

`renderer` is an initialised `WebGPURenderer` (`await renderer.init()`); the constructor throws otherwise.

#### `CloudsOptions`

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `sky` | `Sky` (`@pmndrs/sky`) | none | Sun, ambient and aerial perspective come from its LUTs. Compile it (`await sky.compileAsync()`) before `load()`. Omit for uniform lighting. |
| `quality` | `'ultra' \| 'high' \| 'medium' \| 'low' \| 'mobile' \| 'auto'` | `'high'` | See [quality and performance](quality-and-performance.md). `'auto'` never picks `'ultra'`. |
| `budgetMs` | `number` | `3` | `'auto'` only. GPU ms the cloud passes may take per frame. |
| `expectedPixels` | `number` | 1920 x 1080 | `'auto'` only. Output size the first tier is picked for. |
| `auto` | `Partial<AutoQualityOptions>` | see below | `'auto'` only. Controller tuning. |
| `adapter` | `GPUAdapter` | none | `'auto'` only. three does not keep the adapter; pass yours so its limits take part in the tier pick. |
| `lighting` | `Partial<UniformLightingValues>` | `DEFAULT_UNIFORM_LIGHTING` | Initial values for the sky-less lighting. |
| `planetCenter` | `Vector3 \| null` | none | World-space planet centre for the sky's planet mode (`sky.update(camera, { planetCenter })`). |

#### Members

| Member | Description |
| --- | --- |
| `load({ volume, noise?, position })` | Loads a pack (`<volume>/cloud.json`) and the noise (default `'/clouds/noise/'`), places it, resolves to the `CloudVolumeAsset`. `position: [x, y, z]` is the base centre. |
| `setNoise(noise: CloudNoiseAsset)` | Use your own loaded noise. |
| `setVolume(volume, { position })` | Show a `GpuCloudVolume` or a `CloudVolumeAsset`. `position` is the base centre in world metres. Always a history cut; a pack is re-uploaded. |
| `node(colorNode, scenePass)` | The TSL node `color * cloud.a + cloud.rgb`. Sets `scenePass.options.samples ??= 0`. Assign it to `RenderPipeline.outputNode`. |
| `reflection(dirNode)` | TSL `vec4(rgb, T)`: premultiplied cloud radiance and transmittance toward a world-space direction. Blend as `env * T + rgb`. Below the horizon it gives `(0, 0, 0, 1)`. Turns the reflection dome on (it is off on the `'mobile'` tier). One reference point, the camera's x/z at ground level, so it suits large flat reflectors like water. About one frame of lag. |
| `settings` | Live [`CloudSettings`](#cloudsettings), safe to change every frame. |
| `lighting` | Live `UniformLightingValues` (`sunDirection`, `sunRadiance`, `ambientTop`, `ambientBottom`) when there is no sky; `undefined` with a sky. |
| `setQuality(tier)`, `quality` | Switch tier; the tier in effect. Under `'auto'` the dynamic scale keeps running on top. |
| `auto` | `AutoQualityInfo \| null`: `{ tier, reasons, scale, costMs, budgetMs, measured, changes }`. `null` for a fixed tier. |
| `setBudget(ms)` | `'auto'`: change the GPU budget at run time. `setBudget(Infinity)` pins scale 1. |
| `memory` | `CloudMemory` in bytes: `history`, `trace`, `sky`, `output`, `dome`, `lightGrid`, `total`. |
| `timings`, `lastTimings` | Rolling-average and most-recent GPU ms per pass (`lightGrid`, `marchNear`, `resolveNear`, `marchFar`, `resolveFar`, `composite`, `dome`, `skyLayer`, `skyResolve`). Empty without `timestamp-query`. The last lags the frame by 2 or 3. |
| `isReady` | True once volume and noise are loaded and the first frame sized the output. Until then the node shows the plain scene. |
| `core` | The `CloudRuntime` underneath (settings, `dome`, `skyLayer`, `resetTemporal()`, ...). |
| `renderer`, `sky` | What you passed. |
| `dispose()` | Frees the runtime, timer, lighting and nodes. Idempotent. |

Other exports: `CLOUD_QUALITIES` (`['mobile', 'low', 'medium', 'high', 'ultra']`, cheapest first),
`createSkyBridge(renderer, sky, { planetCenter?, layout? })` (the glue between a `Sky` and the runtime's atmosphere
bind group), `createUniformLighting(device, layout, initial?)`, `DEFAULT_UNIFORM_LIGHTING`, `sharedBackend(renderer)`
(`{ device, texture(t), tryTexture(t) }`: the raw `GPUDevice` and `GPUTexture` behind three objects), `toHalfBits(x)`,
and the types `CloudsOptions`, `CloudsLoadOptions`, `SetVolumeOptions`, `SkyBridge`, `SkyBridgeOptions`,
`UniformLighting`, `UniformLightingValues`, `SharedBackend`, `AutoQualityInfo`, `AutoQualityOptions`,
`CloudMemory`, `CloudQuality`, `CloudQualityOption`, `CloudSettings`, `CloudVolumeAsset`, `GpuCloudVolume`.

```ts
import { Fn, positionWorld, cameraPosition, normalWorld, vec3, vec4 } from 'three/tsl';
import type { Clouds } from '@clouds/three';

declare const clouds: Clouds;

// Mirror the clouds in a flat reflector: env * T + rgb, for the world-space reflection vector.
const reflectedClouds = Fn(([env]: [ReturnType<typeof vec3>]) => {
  const view = positionWorld.sub(cameraPosition).normalize();
  const dir = view.reflect(normalWorld);
  const r = clouds.reflection(dir); // vec4(rgb, T)
  return vec4(env.mul(r.a).add(r.rgb), 1);
});
void reflectedClouds;
```

`examples/lab/scenes/ocean` hooks the same value into three's own environment node for the water; see the
[open-water demo](demos.md#open-water).

#### Frame order

`clouds.node()` registers the scene colour and depth as graph dependencies, so three renders the scene pass first.
In the node's `updateBefore` the adapter writes the uniforms, encodes the runtime's compute passes into its own
command encoder on three's device and submits it; the fragment shader then blends. All of the cloud compute work
is therefore queued after the scene pass and before the final output, with no readback.

## @clouds/react

```tsx
import { Clouds, Cloudscape, useClouds, preloadClouds, clearCloudsCache } from '@clouds/react';
```

### `<Clouds>`

Own props (every other prop is a [`CloudSettings`](#cloudsettings) key and wins over `settings`):

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `volume` | `string \| GpuCloudVolume \| CloudVolumeAsset` | none | A pack URL (loaded with Suspense) or a volume you already have. Generator output stays yours to destroy. |
| `noise` | `string` | `'/clouds/noise/'` | Noise pack URL. |
| `position` | `[x, y, z]` | `[0, 500, 0]` | Base centre. Changing it re-places the volume (a re-upload for packs). |
| `quality` | `CloudQualityOption` | `'high'` | Switching to `'auto'` later keeps the current tier. |
| `settings` | `Partial<CloudSettings>` | none | Settings as an object. Removing a prop restores the value the instance was created with. |
| `sky` | `Sky \| false` | the enclosing `<Sky>` | `false` forces uniform lighting. Changing it recreates the instance. |
| `haze` | `boolean` | `false` | Apply the sky's aerial-perspective haze under the clouds. Leave it off when you use `<AutoHaze />`. Read at mount. |
| `lighting` | `Partial<UniformLightingValues>` | none | Sky-less lighting values. |
| `planetCenter` | `Vector3 \| null` | none | Changing it recreates the instance. |
| `onLoad` | `(volume) => void` | none | Called after the volume is placed (for framing a camera). |
| `children` | `ReactNode` | none | Mounted once the instance exists, so `useClouds()` is never null inside. |

How it behaves:

- One `Clouds` instance per renderer and sky, created after `renderer.init()` and disposed with the component (StrictMode safe).
- The clouds node is installed into R3F's render pipeline around whatever the pipeline outputs at that moment (the scene pass, or the colour `<AutoHaze />` built), and the pipeline is handed back as found on unmount. `<AutoHaze />` and `<Clouds>` compose in either order. Put both in the same `<Sky>`.
- Volume and noise work is serialised in a promise queue, so a fast prop change cannot interleave two `setVolume` calls.
- URL volumes and the noise are cached per URL in a module cache. A failed load is evicted so a remount retries.

```tsx
import { Suspense } from 'react';
import { AutoHaze } from '@pmndrs/sky/react/auto-haze';
import { Sky } from '@pmndrs/sky/react';
import { Canvas } from '@react-three/fiber/webgpu';
import { Clouds, preloadClouds } from '@clouds/react';

preloadClouds('/clouds/stormbird/'); // start the fetch before the Canvas mounts

export function Scene() {
  return (
    <Canvas renderer={{ antialias: false, trackTimestamp: true }}>
      <Sky preset="earth" timeOfDay={16}>
        <AutoHaze />
        <Suspense fallback={null}>
          <Clouds volume="/clouds/stormbird/" position={[0, 600, 0]} quality="auto" densityScale={0.15} settings={{ msStrength: 1.2 }} />
        </Suspense>
      </Sky>
    </Canvas>
  );
}
```

### `<Cloudscape>`

A generated cloud field that follows the camera (`createStreamingCloudscape` driven by `useFrame`). Standalone it
creates its own `<Clouds>` (so it also accepts the `<Clouds>` props except `volume`, `position` and `onLoad`);
nested inside a `<Clouds>` it drives that instance.

| Prop | Default | Notes |
| --- | --- | --- |
| `preset` | `'cumulus'` | `'cumulus' \| 'congestus' \| 'stratocumulus'` or a `CloudPreset` object. A change regenerates from scratch. |
| `seed` | `1` | |
| `dims` | `[512, 512, 64]` | Volume dims (x, map row, up). |
| `voxelSize` | `8` | Metres per voxel. |
| `baseHeight` | `500` | Base height of the field in world metres. |
| `follow` | `true` | Re-centre the window as the camera moves. `false` keeps the window generated around the camera at mount. |
| `jobsPerFrame` | `2` | Generation jobs per frame. |

### `useClouds()`

Returns the `@clouds/three` `Clouds` of the enclosing `<Clouds>` / `<Cloudscape>`; throws outside one.

```tsx
import { useFrame } from '@react-three/fiber/webgpu';
import { useClouds } from '@clouds/react';

export function CloudsHud() {
  const clouds = useClouds();
  useFrame(() => {
    if (!clouds.isReady) return;
    clouds.settings.windVelocity[0] = 6; // live knobs are plain mutable values
  });
  return null;
}
```

Other exports: `preloadClouds(volume?, noise = '/clouds/noise/')`, `clearCloudsCache()` (drops CPU copies of packs; the
GPU copies belong to mounted components), `CLOUD_QUALITIES`, `CLOUD_PRESETS`, and the types `CloudsProps`,
`CloudsOwnProps`, `CloudscapeProps`, `CloudscapeOwnProps`, `CloudsInstance`, `CloudQuality`, `CloudQualityOption`,
`CloudSettings`, `CloudPresetName`.

## @clouds/runtime

WebGPU only, no three.js (a test, `renderer-agnostic.test.ts`, enforces it). Everything below is exported from
the package root.

### `createCloudRuntime(device, options?)`

| Option | Default | Notes |
| --- | --- | --- |
| `quality` | `'high'` | A tier or `'auto'`. |
| `atmosphereLayout` | the runtime's own | Layout the atmosphere bind group was created with (`createAtmosphereBindGroupLayout`). |
| `domeSize` | the tier's (256 down to 64) | Reflection dome, square, multiple of 4. |
| `budgetMs`, `auto`, `expectedPixels`, `mobile`, `adapter` | 3, none, 1920x1080, from `navigator`, none | `'auto'` only. |

A `CloudRuntime` has:

| Member | Description |
| --- | --- |
| `settings` | Live [`CloudSettings`](#cloudsettings). |
| `setNoise(asset)`, `setVolume(asset \| gpuVolume, { position })` | Required before anything draws. `position` is the minimum corner. |
| `resize(width, height, output?)` | `width` x `height` is the scene (depth) size. The runtime owns the `output` texture unless you pass one (`rgba16float`, `STORAGE_BINDING \| TEXTURE_BINDING`, exactly `outputSize`). |
| `encode(encoder, frame, timer?)` | Records all passes. Does nothing until `ready`. |
| `output`, `outputSize`, `outputScale` | The composite: `rgba16float`, rgb premultiplied radiance, a = transmittance times shadow. Blend as `scene * a + rgb`. The composite is `round(scene size * outputScale)`; upsample it bilinearly (1 on `'ultra'`, `'high'`, `'medium'`; 0.5 on `'low'`, `'mobile'`). |
| `ready` | True once volume, noise and output exist. |
| `setQuality(tier)`, `quality`, `auto`, `setBudget(ms)`, `memory` | As on `Clouds`. |
| `resetTemporal()`, `temporalInfo` | Drop the history (call on a cut the runtime cannot see, such as a sky jump); rates in effect, resets, frames, bytes. |
| `extent` | World size of the volume `[x, y, z]` once set. |
| `dome` | The octahedral reflection dome (`texture`, `view`, `size`, `settings`: `enabled`, `referencePoint`, `groundHeight`, ...). |
| `skyLayer` | The distant 2.5D layer; off by default. See [Distant sky layer](#distant-sky-layer). |
| `swapVolume(volume, { position })`, `setVolumePosition(position)` | In-flight with the realtime-evolution work (P6-A): swap in a caller-owned volume of the same shape without cutting history, and move the box with a uniform write. |
| `dispose()` | |

#### `CloudFrame`

Everything the runtime needs for one frame. Matrices are column-major `Float32Array(16)`.

| Field | Notes |
| --- | --- |
| `view`, `projection`, `viewProjection`, `inverseViewProjection`, `previousViewProjection` | Camera matrices; the previous frame's view-projection drives the temporal reprojection. |
| `cameraPosition` | World position. |
| `depth`, `depthKind` | Scene depth at scene resolution, conventional 0..1, a depth-only `GPUTextureView`; `'depth32float'` or `'depth24plus'`. |
| `sunDirection` | Unit vector toward the sun. |
| `atmosphere` | A `GPUBindGroup` for the sky LUTs + uniform (what `createSkyBridge` produces). Required unless `lighting` is set. |
| `lighting` | `{ kind: 'uniform', sunRadiance, ambientTop, ambientBottom }` for users without a sky library; no aerial perspective, `atmosphere` is ignored. |
| `time`, `frameIndex` | Seconds and a frame counter (used for jitter and noise animation). |

```ts
import { createCloudRuntime, GpuTimer, loadCloudNoise, loadCloudVolume, type CloudFrame } from '@clouds/runtime';

declare const device: GPUDevice;
declare const depth: GPUTextureView; // depth-only view of the scene's depth, at scene resolution
declare const camera: {
  view: Float32Array; projection: Float32Array; viewProjection: Float32Array;
  inverseViewProjection: Float32Array; previousViewProjection: Float32Array;
  position: [number, number, number];
};

const runtime = createCloudRuntime(device, { quality: 'high' });
const timer = new GpuTimer(device); // a no-op unless the device has `timestamp-query`
await runtime.setNoise(await loadCloudNoise('/clouds/noise/'));
const asset = await loadCloudVolume('/clouds/parkouring/');
const [w, h] = asset.dims;
const v = asset.voxelSizeMeters;
await runtime.setVolume(asset, { position: [-(w * v) / 2, 500, -(h * v) / 2] }); // minimum corner
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
  return runtime.output; // blend scene * a + rgb; timer.averages() has the GPU ms per pass
}
```

`examples/lab/flagship/three-bridge.ts` is a worked non-adapter integration.

### `CloudSettings`

Live knobs. They are plain numbers (and three-number arrays) and safe to change every frame. Changing a setting
that affects the march or lighting cuts the temporal history for one frame. "tier" means the quality preset sets
the default; the others are art defaults.

| Setting | Default | Meaning |
| --- | --- | --- |
| `densityScale` | 0.2 | Extinction (1/m) at density 1. The main thickness knob. |
| `lightDensityScale` | 1.5 | Multiplier on the light grid's optical depth. |
| `msStrength` | 1.4 | Inner-glow (multiple scattering) strength. |
| `ambientStrength` | 1 | Sky-ambient strength. |
| `silverStrength` | 0.4 | Weight of the forward (silver lining) Henyey-Greenstein lobe, 0..1. |
| `phaseG`, `silverG` | 0.2, 0.85 | Anisotropy of the base and forward lobes. |
| `ambientExtinction` | 0.08 | Optical-depth scale for light arriving from above, `exp(-k * tauUp)`. |
| `edgeDarkening` | 0.5 | 0..1: darkens low in-scatter-probability edges when front-lit. |
| `glowBoost` | 12 | Extra inner glow toward the sun. |
| `ambientSkyBias` | 0.9 | 0..1 floor of the sky-above weight in the ambient blend. |
| `glowFront` | 1 | 0..1: sun-facing glow relaxation also when the sun is behind the viewer (0 = Nubis). |
| `wispyBias` | 1 | 0..1 bias of the detail type toward wispy at low height (0 = unchanged Nubis density). |
| `deepScatter`, `deepAttenuation`, `ambientFloor` | 1.2, 0.35, 0.15 | Deep multiple-scattering octaves: strength, per-octave extinction falloff, and the share of sky ambient that survives any cloud depth. |
| `microDist` | tier (4; 0 on low, mobile) | Length (m) of the short full-density sun sample from every lit step (billow-scale self-shadowing). 0 = off. |
| `microShadow` | 1 | 0..1 weight of that occlusion on the glow terms. |
| `detailBias` | 0.5 | Erosion amplitude bias, `noise * (1 + detailBias)` (0 = Nubis). |
| `stepScale` | tier (1, 1.5 medium, 2 low and mobile) | Multiplies the march step floor; above 1 is coarser. |
| `windVelocity` | `[3, 0, 1.5]` | Noise scroll in m/s. |
| `windOffset` | `[0, 0, 0]` | Noise scroll position in metres (integrated from the velocity; set it to drive time yourself). |
| `animSpeed` | 1 | Noise animation speed. |
| `mipDistanceScale`, `baseMip` | 0.01, 0 | Noise mip selection. |
| `maxSteps`, `transmittanceCutoff`, `splitDistance` | tier | Per-pass step cap, ray termination, near/far boundary (m). |
| `temporalNear`, `temporalFar` | tier (4 / 4; 1 / 1 on ultra) | The pass traces `1/k` of its pixels per frame, `k` in 1, 2, 4 (other values snap down). |
| `temporalBlend` | 0.3 | Weight of a fresh sample against history. |
| `renderScale` | 1 | Dynamic resolution, 0.25..1, multiplies both march passes' resolution without reallocating. `'auto'` drives it. |
| `detailDistance` | tier (150; 100 low; 60 mobile) | Distance (m) within which the high-frequency detail octave is evaluated. |
| `farLimit` | tier (unlimited; 6000 on mobile) | The far pass stops here (m). |
| `shadowStrength` | 0.6 | 0..1 darkening of opaque scene pixels by cloud shadow. 0 disables. |

The Nubis-neutral values (`msStrength` 1, `deepScatter` 0, ...) are noted in
[`CloudSettings`' doc comments](../../packages/runtime/src/runtime.ts) and the formulas in
[`docs/research/nubis-sources.md`](../research/nubis-sources.md).

### Quality presets

`CLOUD_QUALITY_PRESETS` (`Record<CloudQuality, CloudQualityPreset>`) and `CLOUD_QUALITY_ORDER`
(`['mobile', 'low', 'medium', 'high', 'ultra']`). The table is in
[quality and performance](quality-and-performance.md#what-a-tier-changes).

### Assets and GPU upload

| Export | Description |
| --- | --- |
| `loadCloudVolume(baseUrl)` | Fetches `cloud.json` + the NVDF and SDF. Returns a `CloudVolumeAsset` `{ name, dims, voxelSizeMeters, nvdf, sdfMeters }`. Checks the payload sizes against `dims`. |
| `loadCloudNoise(baseUrl)` | Fetches `noise.json` + `noise.bin`. Returns a `CloudNoiseAsset` `{ size, mips, tilingMeters }`. |
| `decodeSdf(raw, minMeters, maxMeters)` | r16 unorm to metres. |
| `uploadCloudVolume(device, asset)` | `GpuCloudVolume` `{ nvdf, sdf, dims, voxelSize, extentMeters, destroy() }`. `nvdf` is `rgba8unorm` 3D, `sdf` is `r16float` 3D in metres rounded down. |
| `uploadCloudNoise(device, asset)` | The 3D noise texture with its mips. |

The NVDF channels are R dimensional profile, G detail type (0 wispy, 1 billowy), B density scale. The SDF is signed
distance in metres, negative inside, never larger than the true distance (the march relies on that). File layout:
[`assets/clouds/README.md`](../../assets/clouds/README.md).

### Generate a cloudscape

All of it is GPU compute and runs in small jobs you spread over frames. P6-A (realtime evolution, in progress) adds
`createEvolvingCloudscape` beside these; it is exported from the same module but not documented here until it settles.

| Export | Description |
| --- | --- |
| `encodeProceduralWeatherMap(device, encoder, options)` | A `rgba8unorm` weather map: R coverage, G cloud type, B base height, A top height. Options: `size` (required), `seed`, `scale` 4, `coverageLo` 0.42, `coverageHi` 0.8, `border` 0.08, `cellular` 0, `cellScale` 6, `window`, `evolve`, `mipLevels`. The caller submits the encoder and owns the texture. |
| `createVolumeGenerator(device, options)` | `{ dims, voxelSize = 8, weather, params?, sliceDepth?, marginVoxels = 1, maxDistance = 4096, origin = [0, 0], scratch? }`. Returns a `VolumeGenerator`: `volume`, `generate(encoder, maxJobs?)` (returns `{ done, jobsEncoded, jobsDone, jobsTotal }`), `restart(next?)`, `done`, `jobsTotal`, `memoryBytes`, `destroy()`. |
| `NvdfParams` / `NVDF_DEFAULTS` | The shaping parameters: `coverageThreshold` 0.12, `useMapHeights` false, `baseDefault` 0.08, `topFraction` 0.6, `domeExponent` 2, `billowAmp` 0.35, `billowCellMeters` 320, `baseLift` 0.1, `seed` 1, `scaleBase` 0.25, `scaleTop` 0.85, `profileSigma` 0.64, `detailBias` 0.3. |
| `CLOUD_PRESETS` | `cumulus`, `congestus`, `stratocumulus`: each `{ weather, params }` for a 512 x 512 x 64 field at 8 m (4.1 km, 512 m tall). Spread them into the two calls above. |
| `createGeneratorScratch(device, dims, label?)`, `scratchBytes(dims)` | The one u16-per-voxel work buffer (33.6 MB at 512 x 512 x 64). Generators and SDF rebuilders can share one if they never run at the same time. |
| `createStreamingCloudscape(device, options)` | A camera-centred window that regenerates before the camera leaves it. See below. |
| `signedDistanceCpu`, `squaredDistanceToMask` | CPU exact distance transforms (tests, tooling). |

```ts
import { createStreamingCloudscape } from '@clouds/runtime/generate';
import type { Clouds } from '@clouds/three';

declare const device: GPUDevice;
declare const clouds: Clouds;
declare const camera: { position: { x: number; z: number } };

const stream = createStreamingCloudscape(device, { preset: 'cumulus', seed: 7, jobsPerFrame: 2 });
const first = await stream.start(camera.position.x, camera.position.z); // one ~50 ms stall at startup
await clouds.setVolume(first.volume, { position: [first.centre[0], 600, first.centre[1]] });

export function onFrame(): void {
  const u = stream.update(camera.position.x, camera.position.z); // encodes and submits this frame's jobs
  if (u.swapped) void clouds.setVolume(u.volume, { position: [u.centre[0], 600, u.centre[1]] });
}
```

`StreamingCloudscapeOptions`: `preset` (`'cumulus'`), `dims` (`[512, 512, 64]`), `voxelSize` (8), `threshold` (a
quarter of the window: regenerate when the camera is that far from the window centre), `jobsPerFrame` (2),
`sliceDepth` (4), `seed` (1), `weatherExtent` (4096), `border` (0), `weather`, `params`, `lookahead` (measured
generation time, clamped to 0..4 s). The window is world-anchored: weather and shape noise are functions of
world position, so two overlapping windows are byte-identical in the overlap except within about 100 m of a window
edge. Update results carry `volume` (streamer-owned, do not destroy), `centre`, `swapped`, `generating`. Also
`stream.memoryBytes` (237 MB for the defaults: two windows 201 MB, scratch 34 MB, 2 MB other), `stream.stats`,
`requestWindow(x, z)`, `destroy()`.

### Stamp authored clouds

```ts
import { loadCloudVolume, uploadCloudVolume } from '@clouds/runtime';
import { createEmptyCloudVolume, createSdfRebuilder, stampCloud } from '@clouds/runtime/generate';

declare const device: GPUDevice;

const region = createEmptyCloudVolume(device, [256, 256, 64], 8); // dims (x, map row, up), voxel size
const asset = uploadCloudVolume(device, await loadCloudVolume('/clouds/parkouring/'));

const encoder = device.createCommandEncoder();
// position: the asset box centre, in the region's own metres (x, y-up, z)
stampCloud(device, encoder, region, asset, { position: [1000, 300, 1000], yaw: 0.8, scale: 1.2, mode: 'max' });
stampCloud(device, encoder, region, asset, { position: [600, 300, 1400], mode: 'cutout' }); // carve a hole in its shape
device.queue.submit([encoder.finish()]);

// The SDF is stale after stamping: rebuild it once (the whole volume), preferably spread over frames with `generate(encoder, maxJobs)`.
const rebuilder = createSdfRebuilder(device, region);
const rebuild = device.createCommandEncoder();
rebuilder.generate(rebuild);
device.queue.submit([rebuild.finish()]);
await device.queue.onSubmittedWorkDone();
rebuilder.destroy();
```

`StampOptions`: `position` (required), `yaw` (radians, three.js sense, 0), `scale` (1), `mode`
(`'max' | 'replace' | 'cutout'`, default `'max'`), `clearMargin` (replace only, metres around the asset's surface
that are emptied, 48), `densityScale` (multiplies the asset's density scale, 1), `detailType` (overrides the
asset's, default keep), `timestamps`. `max` unions, `replace` overwrites and clears around the asset, `cutout`
empties wherever the asset has density. Up to 256 stamps per target may be encoded between submits; they apply
in encoding order. A stamp costs 0.02 to 0.08 ms of GPU; the SDF rebuild of a 384 x 384 x 96 region is about 8 ms
in one shot (P5-A). `stampCloud` returns `{ boundsMin, boundsMax, voxels }`.

### Import a `.vdb`

See [Authoring](authoring.md#in-browser-vdb-import) for the workflow and the modes.

| Export | Description |
| --- | --- |
| `importVdb(device, arrayBuffer, options?)` | `{ volume: GpuCloudVolume, info: VdbImportInfo }`. The volume is caller-owned. Throws `VdbImportError`. |
| `convertVdb(buffer, options?)`, `uploadConvertedVdb(device, converted)` | The two halves: CPU conversion (works in Node) and GPU upload with the SDF build. |
| `inspectVdb(buffer, options?)` | Grid descriptors only, without decoding the trees. |
| `VdbImportError`, `BLOSC_HELP`, `PACK_FIT` | Error class (`code`: `'blosc' \| 'unsupported-codec' \| 'unsupported-grid' \| 'no-grid' \| 'grid-not-found' \| 'wrong-class' \| 'empty' \| 'too-large' \| 'format'`), the Houdini hint text, the fitted mapping constants. |

`VdbImportOptions`: `voxelSize` 8, `worldScale` 1, `mode` (`'auto' | 'fog' | 'sdf' | 'pack'`, default `'auto'`),
`targetWidthMeters`, `grid`, `iso` 0.05, `sdfOffset` 0, `margin` 8, and the fog/sdf mapping knobs `seed`,
`profileNoise`, `profileGain`, `scaleGain`, `smooth`, `densityRef`, `scaleFloor`, `cpuSdf`.

### Distant sky layer

The 2.5D vertical-profile layer that carries cloud cover from the edge of the voxel box to the horizon. Off by
default. It re-evaluates the same weather the generator used, so you configure it with the same options.

```ts
import type { CloudRuntime } from '@clouds/runtime';
import { CLOUD_PRESETS } from '@clouds/runtime/generate';

declare const runtime: CloudRuntime; // clouds.core with @clouds/three

const preset = CLOUD_PRESETS.cumulus;
runtime.skyLayer.configure({
  weather: { ...preset.weather, seed: 7 },   // the options the generator's weather map was made with
  shape: { ...preset.params, seed: 7 },      // and the generator's shaping parameters
  voxelSize: 8,
});
runtime.skyLayer.settings.enabled = true;
```

`SkyLayerSettings` (defaults in `SKY_LAYER_DEFAULTS`): `enabled` false, `densityScale` 1, `maxDistance` 30000,
`maxSteps` 256, `transmittanceCutoff` 0.05, `stepMin` 8, `stepRel` 0.006, `lodScale` 0.7, `curvature` 0 (1/(2R);
`1 / (2 * 6371000)` for Earth), `resolutionScale` 0.25, `temporal` true, `temporalBlend` 0.3, `debug` 0.
`configure` options also take `window` (`{ size, resolution }`, default 51200 m at 2048^2) and `rimWidth`.

### Other exports

| Export | Description |
| --- | --- |
| `GpuTimer(device, { maxPasses = 16, ringSize = 3, window = 60 })` | Timestamp queries with a readback ring. `enabled`, `beginFrame()`, `endFrame(encoder)`, `passTimestampWrites(name)`, `averages()`, `last()`, `dispose()`. |
| `estimateCloudMemory(width, height, quality, { volumeDims?, ownsOutput? })` | Pure arithmetic: the `CloudMemory` a runtime would hold. |
| `selectTier(inputs)`, `describeDevice(device, extra?)` | The `'auto'` tier picker (vendor, architecture, limits, pixels, mobile hint) and its input builder. Returns `{ tier, reasons, timestampQuery }`. |
| `DynamicScale`, `AUTO_QUALITY_DEFAULTS`, `AUTO_QUALITY_PASSES`, `controlledCost(timings)` | The render-scale controller and the passes it controls. |
| `createAtmosphereBindGroupLayout`, `createAtmosphereSampler`, `createAtmosphereBindGroup`, `writeAtmosphereUniforms`, `atmosphereWgsl(group)`, `ATMOSPHERE_UNIFORM_FLOATS`, `ATMOSPHERE_UNIFORM_BYTES` | The atmosphere interface a sky feeds (transmittance, sky-view, aerial-perspective LUTs and a 36-float uniform). |
| `createLightGrid`, `lightGridDims`, `LightGridScheduler`, `lightGridWgsl` | The sun-driven voxel light grid (half the volume's dims per axis, at least 16). |
| `cloudDomeWgsl`, `defaultDomeSettings`, `domeDirectionToUv`, `domeUvToDirection`, `domeTexelDirection`, `domeDirectionToTexel`, `DOME_REFRESH_FRAMES` | Reflection dome helpers (CPU side and WGSL). |
| `COMMON_WGSL`, `DENSITY_WGSL`, `MARCH_WGSL`, `marchWgsl`, `LIGHTING_WGSL`, `COMPOSITE_WGSL`, `FRAME_WGSL`, `volumeWgsl`, `skyLayerWgsl`, ... | The shader sources, for people writing their own passes. |
| `createVolumeBindGroupLayout`, `createVolumeBindGroup`, `createVolumeSamplers`, `volumeUniformData` | Volume bindings for custom passes. |
