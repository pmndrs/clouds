# Getting started

Realtime Nubis³-style voxel clouds for WebGPU. Three packages, one idea each:

| Package | Imports | Use it when |
| --- | --- | --- |
| [`@clouds/runtime`](../../packages/runtime/README.md) | WebGPU only | You own the renderer, or you are building an adapter. Volumes, generator, light grid, march, composite, reflection dome, `.vdb` import. |
| [`@clouds/three`](../../packages/three/README.md) | `three/webgpu`, `three/tsl` | You have a three.js `WebGPURenderer`. Gives you `Clouds` and one TSL node. |
| [`@clouds/react`](../../packages/react/README.md) | React Three Fiber v10 | You have an R3F v10 `<Canvas>` (WebGPU). Gives you `<Clouds>` and `<Cloudscape>`. |

These are the workspace names. The npm names are not decided yet (the packages are `private` in this
repository), so for now you use them from a checkout of this repo.

## Requirements

- A WebGPU browser on desktop. Mobile tiers exist (`'low'`, `'mobile'`), but have only been measured on a desktop GPU.
- three.js **0.186** or newer, using `WebGPURenderer` from `three/webgpu` and a `RenderPipeline` with a `pass(scene, camera)`.
- For lighting from a physical sky: [`@pmndrs/sky`](https://github.com/pmndrs/sky) **0.5** or newer. It is optional; without it the clouds use plain sun and ambient values.
- For R3F: React 19 and `@react-three/fiber` 10 (alpha), plus `@pmndrs/sky` (the component reads the sky from its context).
- To run this repository: Node.js 22 and pnpm 10.33.0 (`pnpm install --frozen-lockfile`, then `pnpm dev`).

## Cloud assets

The clouds are data. The loader fetches `<base>/cloud.json` plus the two binary files next to it, and
`<noise>/noise.json` plus `noise.bin`. In this repository `assets/` is the dev server's static directory, so
`assets/clouds/parkouring/` is served at `/clouds/parkouring/`. In your own project, copy what you use
into your static folder at the same paths (or pass other URLs).

| Folder | What | Size |
| --- | --- | --- |
| `assets/clouds/noise/` | The 128³ Nubis noise with its mip chain. Always needed. | 9.1 MB |
| `assets/clouds/parkouring/`, `stormbird/` | Guerrilla's two example clouds (from the Nubis pack). | 3.4 MB each |
| `assets/clouds/disney/` | The Disney WDAS cloud, converted from VDB. CC BY-SA, see [credits](credits.md). | 3.6 MB |
| `assets/clouds/heroes/*` | Houdini-authored clouds: `tower`, `valley-fog`, `fairweather`, `sim-cumulus`, `sim-congestus`. | 1.4 to 3.6 MB each |
| `assets/clouds/houdini-test/` | First converter proof (a noise-displaced sphere cluster). | 4.0 MB |

You can also skip files entirely: [generate](api.md#generate-a-cloudscape) a field on the GPU, or
[import a `.vdb`](authoring.md#in-browser-vdb-import) in the browser.

## Clouds in a three.js scene

The clouds-specific lines are tagged `// CLOUDS`. The rest is the scene, the sky and its per-frame calls,
which you need anyway. This is the same structure as `examples/lab/three-adapter/main.ts`.

```ts
import { ACESFilmicToneMapping, PerspectiveCamera, Scene } from 'three';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { pass } from 'three/tsl';
import { Sky } from '@pmndrs/sky';
import { Clouds } from '@clouds/three'; // CLOUDS

const renderer = new WebGPURenderer({ antialias: false, trackTimestamp: true });
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.35;
document.body.appendChild(renderer.domElement);
await renderer.init();
renderer.setSize(innerWidth, innerHeight);

const scene = new Scene();
const camera = new PerspectiveCamera(70, innerWidth / innerHeight, 1, 1500000);
camera.position.set(0, 2, -150);

const sky = new Sky(renderer, { preset: 'earth', timeOfDay: 14, latitude: 40, north: '-Z' });
sky.attach(scene);
sky.createGround({ mode: 'plane', size: 8000000, color: 0x34461f, roughness: 1 }).attach(scene);
sky.createSun({ physical: true }).attach(scene);
await sky.compileAsync();

const clouds = new Clouds(renderer, { sky, quality: 'high' }); // CLOUDS
await clouds.load({ volume: '/clouds/parkouring/', position: [0, 500, 0] }); // CLOUDS
const post = new RenderPipeline(renderer);
const scenePass = pass(scene, camera); // CLOUDS
post.outputNode = clouds.node(scenePass.getTextureNode(), scenePass); // CLOUDS

renderer.setAnimationLoop(() => {
  sky.update(camera); // CLOUDS (the sky needs this anyway)
  void sky.updateAerialPerspective(); // CLOUDS (the sky needs this anyway)
  post.render();
});
```

Things that matter:

- `await renderer.init()` first, and `await sky.compileAsync()` before `load()`. The `Clouds` constructor throws on an uninitialised renderer.
- The scene pass **must not be multisampled**. `clouds.node()` sets `scenePass.options.samples ??= 0`; use `antialias: false` on the renderer. A multisampled depth logs one warning and the clouds are skipped.
- `trackTimestamp: true` makes three request the `timestamp-query` feature. Without it `clouds.timings` stays empty and `quality: 'auto'` cannot measure (it keeps its first tier at full scale).
- `position` is the **base centre** of the volume in world metres: x/z are the centre, y is the height of the volume's floor. The packs' cloud bases sit a little above their floor.
- Use an altitude-proportional near plane if the camera climbs through the clouds (the demos use `min(200, max(0.5, y * 0.002))`). The depth buffer has to separate a nearby wall of cloud from the ground.
- The order is scene haze first, then clouds: `clouds.node(sky.applyHaze(scenePass.getTextureNode(), { scenePass }), scenePass)`. The clouds carry their own aerial perspective, so they are never hazed twice.

### Without a sky library

Leave `sky` out and give the clouds sun and ambient values instead. They are plain RGB radiances, in the
units of your scene lights, and you can change them every frame through `clouds.lighting`.

```ts
import type { WebGPURenderer } from 'three/webgpu';
import { Clouds } from '@clouds/three';

declare const renderer: WebGPURenderer; // initialised, as above

const clouds = new Clouds(renderer, {
  lighting: { sunDirection: [0.3, 0.8, 0.5], sunRadiance: [40, 38, 34], ambientTop: [6, 8, 12], ambientBottom: [2, 2.4, 1.6] },
});
clouds.lighting!.sunDirection = [0.1, 0.5, 0.2]; // live; there is no atmosphere, so no aerial perspective
```

`sunDirection` should be a unit vector toward the sun. With no sky the clouds have no aerial perspective,
and the defaults (`sunRadiance` [40, 38, 34], ambient [6, 8, 12] / [2, 2.4, 1.6]) are placeholders to tune to your scene's exposure.

## Clouds in React Three Fiber

`<Clouds>` goes inside `<Sky>` (from `@pmndrs/sky/react`) because it reads the sky from React context. It
suspends while the volume and noise load, so it needs a `Suspense` boundary; the R3F `<Canvas>` provides one.

```tsx
import { Canvas } from '@react-three/fiber/webgpu';
import { Sky } from '@pmndrs/sky/react';
import { Clouds } from '@clouds/react'; // CLOUDS

export function App() {
  return (
    <Canvas camera={{ fov: 70, near: 1, far: 1500000 }} renderer={{ antialias: false, trackTimestamp: true }}>
      <Sky preset="earth" timeOfDay={14} latitude={40} north="-Z">
        <Clouds volume="/clouds/parkouring/" position={[0, 500, 0]} quality="high" /> {/* CLOUDS */}
      </Sky>
    </Canvas>
  );
}
```

Any prop that is not one of `<Clouds>`'s own is a [`CloudSettings`](api.md#cloudsettings) value:
`<Clouds densityScale={0.1} msStrength={1.2} />`. See the [API reference](api.md#cloudsreact) for the rest,
including `<Cloudscape>` (a generated field that follows the camera) and `useClouds()`.

## Generated clouds instead of files

A weather map and a few parameters make a cloud field on the GPU in about 17 ms for 512x512x64 (or amortized over
about 96 jobs of 0.34 ms), with presets for cumulus, congestus and stratocumulus.

```ts
import type { WebGPURenderer } from 'three/webgpu';
import { Clouds, sharedBackend } from '@clouds/three';
import { loadCloudNoise } from '@clouds/runtime';
import { CLOUD_PRESETS, createVolumeGenerator, encodeProceduralWeatherMap } from '@clouds/runtime/generate';

declare const renderer: WebGPURenderer; // initialised
declare const clouds: Clouds;

const device = sharedBackend(renderer).device;
const preset = CLOUD_PRESETS.cumulus;
const dims: [number, number, number] = [512, 512, 64]; // x, map row, up: a 4.1 km field, 512 m tall, at 8 m voxels

const encoder = device.createCommandEncoder();
const weather = encodeProceduralWeatherMap(device, encoder, { ...preset.weather, size: [dims[0], dims[1]], seed: 7 });
device.queue.submit([encoder.finish()]);

const generator = createVolumeGenerator(device, { dims, voxelSize: 8, weather, sliceDepth: 4, params: { ...preset.params, seed: 7 } });
await clouds.setNoise(await loadCloudNoise('/clouds/noise/'));

// Spread the jobs over frames so nothing stalls; call this once per frame until it reports done.
function step(): void {
  const encoder = device.createCommandEncoder({ label: 'cloud generation' });
  const progress = generator.generate(encoder, 2); // 2 jobs per frame
  device.queue.submit([encoder.finish()]);
  if (progress.done) void clouds.setVolume(generator.volume, { position: [0, 500, 0] }); // the volume stays yours
  else requestAnimationFrame(step);
}
step();
```

The generated volume is **caller-owned**: keep the generator alive while it is shown and `destroy()` it
yourself. For a field that follows the camera, use `createStreamingCloudscape` (or `<Cloudscape>` in React);
see [Generate a cloudscape](api.md#generate-a-cloudscape).

## What to read next

- [API reference](api.md): every export with signatures and defaults.
- [Quality and performance](quality-and-performance.md): tiers, `'auto'`, budgets, memory.
- [Authoring](authoring.md): Houdini, Blender and `.vdb` drop.
- [Demos](demos.md): the lab pages and what each proves.
- [Credits](credits.md): sources and licences.
