# @clouds/react

React Three Fiber **v10** (WebGPU) bindings for [`@clouds/three`](../three/README.md): `<Clouds>` for a cloud pack or any volume, `<Cloudscape>` for a
generated, camera-following cloud field, and `useClouds()` for the live instance.

> Workspace package, `private` for now. The npm name is not decided. Source-only: `exports` point at `src/*.tsx` until a build step exists.

```tsx
import { Canvas } from '@react-three/fiber/webgpu';
import { Sky } from '@pmndrs/sky/react';
import { Clouds } from '@clouds/react';

export function App() {
  return (
    <Canvas camera={{ fov: 70, near: 1, far: 1500000 }} renderer={{ antialias: false, trackTimestamp: true }}>
      <Sky preset="earth" timeOfDay={14} latitude={40} north="-Z">
        <Clouds volume="/clouds/parkouring/" position={[0, 500, 0]} quality="high" />
      </Sky>
    </Canvas>
  );
}
```

The clouds cost two lines: the import and the element.

## Props

`<Clouds volume noise position quality settings sky haze lighting planetCenter onLoad>`. Any other prop is a `CloudSettings` value
(`<Clouds densityScale={0.1} />`) and wins over `settings`. `<Clouds>` must be inside `<Sky>` unless you pass `sky={false}` (uniform lighting) or a `Sky`.
It suspends while the volume and noise load (the R3F `<Canvas>` supplies a `Suspense` boundary); `preloadClouds(url)` starts the fetch early.

`<Cloudscape preset seed dims voxelSize baseHeight follow jobsPerFrame>` generates a cloud field on the GPU and follows the camera. Standalone it creates its own `<Clouds>`;
inside one it drives that instance.

```tsx
import { Canvas } from '@react-three/fiber/webgpu';
import { Sky } from '@pmndrs/sky/react';
import { Cloudscape } from '@clouds/react';

export function Scape() {
  return (
    <Canvas renderer={{ antialias: false, trackTimestamp: true }}>
      <Sky preset="earth" timeOfDay={14}>
        <Cloudscape preset="congestus" seed={7} baseHeight={600} quality="auto" />
      </Sky>
    </Canvas>
  );
}
```

Reference: [API](../../docs/guide/api.md#cloudsreact) · [getting started](../../docs/guide/getting-started.md) · [demos](../../docs/guide/demos.md#r3f).

## Behaviour worth knowing

- One `Clouds` instance per renderer and sky, created after `renderer.init()`, disposed with the component. StrictMode safe: 16 mount, swap and remount steps leave no leaked GPU objects (53 textures and 85 buffers before and after).
- The clouds node wraps whatever the render pipeline outputs, so `<AutoHaze />` before or after `<Clouds>` both work. Put them in the same `<Sky>`.
- Changing `position` re-uploads a URL volume; changing `sky` or `planetCenter` recreates the instance. Swapping the `volume` URL suspends the nearest boundary (wrap it in `startTransition` to keep the old frame).
- If another `useRenderPipeline` user replaces `outputNode` after `<Clouds>` mounted, the clouds are dropped (R3F gives no composition order).

## Packaging

`peerDependencies`: `three >= 0.186.0`, `react >= 19`, `@react-three/fiber >= 10.0.0-0`, `@pmndrs/sky >= 0.5.0` (required: `<Clouds>` reads the sky from its React context), `@webgpu/types` (optional).
`dependencies`: `@clouds/runtime`, `@clouds/three`. `sideEffects: false`. 2.3 KB gzip alone, 57.7 KB with its dependencies (`node scripts/check-bundle.mjs`).
