# WebGPU Clouds

Realtime Nubis³-style voxel clouds for WebGPU. A renderer-agnostic core
(density, SDF sphere-trace march, voxel light grid, near/far resolution split)
with a three.js adapter first. The method is built from Andrew Schneider's
Nubis talks and Guerrilla's official Nubis Voxel Cloud Pack, which is the
development asset set.

Three packages: [`@clouds/runtime`](packages/runtime/README.md) (the core, WebGPU only),
[`@clouds/three`](packages/three/README.md) (three.js adapter) and
[`@clouds/react`](packages/react/README.md) (React Three Fiber v10). They are workspace
packages for now; the npm names are not decided. The plan is the living Compass page
(https://claude.ai/artifact/CnMaoMGzR6LxnZAgbQ28M1, source [`work/compass/index.html`](work/compass/index.html)).

<!-- doc-preamble
import type { WebGPURenderer, RenderPipeline } from 'three/webgpu';
import type { Sky } from '@pmndrs/sky';
import { Clouds } from '@clouds/three';
declare const renderer: WebGPURenderer;
declare const sky: Sky;
declare const post: RenderPipeline;
declare const scenePass: { getTextureNode(): never };
-->
```ts
const clouds = new Clouds(renderer, { sky, quality: 'high' });
await clouds.load({ volume: '/clouds/parkouring/', position: [0, 500, 0] });
post.outputNode = clouds.node(scenePass.getTextureNode(), scenePass);
```

<!-- doc-preamble
import { Clouds } from '@clouds/react';
-->
```tsx
<Clouds volume="/clouds/parkouring/" position={[0, 500, 0]} quality="high" />
```

## Run it

Requires Node.js 22 and pnpm 10.33.0.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open a WebGPU-enabled desktop browser at
<http://127.0.0.1:5173/flagship/>. Legacy labs from earlier phases live under
`/legacy/<name>/` (for example `/legacy/clouds/`) and are kept for reference.

Other checks: `pnpm check` runs typecheck, unit tests and the production build. `node scripts/check-bundle.mjs` reports bundle sizes; `node scripts/check-docs.mjs` checks the docs' links and typechecks their code samples.

## GPU capture harness

```sh
node scripts/gpu/capture.mjs --serve --page flagship/ --shots ground,inside --out work/captures/<task-id>
```

This runs headless Chrome on the real GPU, waits for the page to report ready,
writes one JPEG per shot plus `capture.json`, and exits non-zero on page
errors. Use `--help` for options. Scratch runs go to `work/captures/scratch/`,
which is git-ignored.

## Documentation

- [`docs/guide/`](docs/guide/getting-started.mdx): the guide.
  [Getting started](docs/guide/getting-started.mdx) ·
  [API reference](docs/guide/api.mdx) ·
  [Quality and performance](docs/guide/quality-and-performance.mdx) ·
  [Authoring clouds](docs/guide/authoring.mdx) ·
  [Demos](docs/guide/demos.mdx) ·
  [Credits](docs/guide/credits.mdx).
- The Compass (https://claude.ai/artifact/CnMaoMGzR6LxnZAgbQ28M1, source [`work/compass/index.html`](work/compass/index.html)): goals, phases, decisions. October plans are in [`docs/archive/`](docs/archive/).
- [`work/README.md`](work/README.md) and [`work/STATUS.md`](work/STATUS.md): how work is done, and what landed.
- [`docs/research/nubis-sources.md`](docs/research/nubis-sources.md): formulas and constants, with slide references.
- [`assets/nubis-voxel-clouds/NOTICE.md`](assets/nubis-voxel-clouds/NOTICE.md): credits and licence notice for the Nubis pack.

Earlier plans, phase evidence and research results are in
[`docs/archive/`](docs/archive/). They are kept for history only.
