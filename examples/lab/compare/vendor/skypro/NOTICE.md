# Sky Pro (vendored for the comparison page)

The code in this folder is **Sky Pro**, the volumetric cloud and atmosphere renderer by DRG Software Solutions LLC
(threejsskypro.com), as it runs inside the Tidewater project (`/Users/dex/Developer/tidewater`, commit 4811ba4), and is
used here with the author's permission. Tidewater and this copy are MIT licensed, see `LICENSE` (Copyright (c) 2026 DRG
Software Solutions LLC). Keep that licence file with the code.

Only the comparison page imports it (`examples/lab/compare/`); no `@clouds/*` package depends on it.

## What is here

| Path | Source in Tidewater | Notes |
| --- | --- | --- |
| `sky/Atmosphere.js`, `sky/Sky.js`, `sky/SkyProClouds.js` | `src/sky/` | `Sky.js`: the two constants from `SceneRenderer.js` are inlined. `SkyProClouds.js`: imports re-pointed at the trimmed engine, and the noise assets come from URLs passed to the constructor instead of `import.meta.env.BASE_URL`. |
| `engine/gpu/*`, `engine/math/*`, `engine/scene/{Camera,Object3D,Layers}.js`, `engine/core/EventDispatcher.js`, `engine/constants.js` | `src/engine/` | Unmodified. Tidewater's small raw-WebGPU engine: device singleton, WGSL module composer, compute kernels, uniform blocks, textures, maths. |
| `engine/render/{Frame,FullscreenPass,Material}.js`, `engine/render/wgsl/common.js` | `src/engine/render/` | Unmodified (`Material.js` only for `blendState`). |
| `engine/webgpu.js` | new | A barrel of the modules above (Tidewater's own barrel also exports the mesh renderer, shadows, skinning and loaders, which are not needed). |
| `clouds/baseShape64.bin`, `clouds/blueNoise.bin` | `public/clouds/` | The baked 64^3 Perlin-Worley shape noise and the blue noise texture. |
| `skypro-pane.js`, `skypro-pane.d.ts` | new (comparison page) | Driver: builds the atmosphere, sky and clouds on its own WebGPU device and canvas, sets the sun and camera, draws sky + clouds + a ground plane, tone maps with ACES, and times the cloud passes with timestamp queries. |

## Differences to running Sky Pro inside Tidewater

- No ocean, terrain, TAA or scene renderer: the final pass draws the sky (with the temporally reconstructed half-resolution cloud view) and a Lambertian ground plane at y = 0, lit by Tidewater's key light and sky irradiance (read back from the GPU as in `App.applyAtmosphereReadback`).
- Aerial perspective on the ground is a plain exponential haze toward the clear horizon colour (Tidewater's atmosphere has no aerial perspective volume).
- Night, moon and stars are off.
- The preset is Tidewater's "Partly cloudy" with its 12 m/s wind; the quality tier is its "high" (see `SkyProClouds.js`).

- X2: the driver applies Tidewater's PostFX grading (saturation, contrast, warmth, vignette; no bloom, grain or sharpen) and an exposure of 0.55 times an auto exposure interpolated from values measured in the real demo over sun elevation (`?skypro_ae=` overrides). See `work/reports/X2.md`.
