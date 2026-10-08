# @clouds/three

Drop-in volumetric clouds for a three.js `WebGPURenderer` (three r186 or newer). `Clouds` owns a
[`@clouds/runtime`](../runtime/README.md) on three's own GPU device and gives you one TSL node that composites the clouds
over your scene with depth sorting, cloud shadows on opaque surfaces and, optionally, reflections.

> Workspace package, `private` for now. The npm name is not decided. `exports` point at the built `dist/` (`node scripts/build-release.mjs`); the repo lab aliases the source. Runtime imports: core from `@clouds/runtime`, content tools from `@clouds/runtime/generate` and `/import`.

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

Seven lines are clouds-specific (the last two are the sky's own per-frame calls). No sky? `new Clouds(renderer, { lighting: { sunDirection, sunRadiance, ambientTop, ambientBottom } })`.

## What you get

- `new Clouds(renderer, { sky?, quality?, budgetMs?, lighting?, planetCenter?, ... })`, `load`, `setVolume`, `setNoise`, `node`, `reflection`, `settings`, `lighting`, `setQuality`, `auto`, `setBudget`, `memory`, `timings`, `isReady`, `core`, `dispose`.
- `quality`: `'ultra' | 'high' | 'medium' | 'low' | 'mobile' | 'auto'`. `'auto'` picks a tier from the adapter and moves the render scale toward a GPU budget.
- `clouds.reflection(dir)`: a TSL `vec4(rgb, T)` of the clouds toward a world direction, for water and other reflectors.
- Also exported: `createSkyBridge`, `createUniformLighting`, `DEFAULT_UNIFORM_LIGHTING`, `sharedBackend` (the raw `GPUDevice` and `GPUTexture` behind three objects), `toHalfBits`, `CLOUD_QUALITIES`.

Reference: [API](../../docs/guide/api.md#cloudsthree) · [getting started](../../docs/guide/getting-started.md) · [quality and performance](../../docs/guide/quality-and-performance.md) · [demos](../../docs/guide/demos.md).

## Rules

- `await renderer.init()` before constructing `Clouds`, and `await sky.compileAsync()` before `load()`.
- The scene pass must not be multisampled (depth is read as a plain texture). Use `antialias: false`.
- Pass `trackTimestamp: true` to the renderer for `timings` and for `'auto'` to measure.
- Generated volumes (`createVolumeGenerator`, `createStreamingCloudscape`, `importVdb` from `@clouds/runtime`) stay owned by you.

## Packaging

`peerDependencies`: `three >= 0.186.0`; `@pmndrs/sky >= 0.5.0` (optional: only its types and, with a sky, its LUTs are used); `@webgpu/types` (optional).
`dependencies`: `@clouds/runtime`. `sideEffects: false`. About 4.2 KB gzip alone, 51.2 KB gzip with the runtime parts it uses (`node scripts/check-bundle.mjs`).
