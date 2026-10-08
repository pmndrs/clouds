# Demos

The lab pages are the proof of every claim in these docs. Start the dev server and open them:

```sh
pnpm install --frozen-lockfile
pnpm dev            # http://127.0.0.1:5173/  (a WebGPU desktop browser)
```

Each page installs the capture contract (`window.__clouds`), so it can be shot headlessly on the real GPU:

```sh
node scripts/gpu/capture.mjs --serve --page three-adapter/ --shots ground,edge,backlit --out work/captures/scratch/mine
```

`--help` lists the options. The harness waits for `ready`, settles 90 frames per shot and writes a JPEG plus a `capture.json` with the
page's report (GPU ms per pass, frame times, console errors). Evidence from the phases is committed under `work/captures/`.

Lines in the pages tagged `// INTEGRATION` (or `// CLOUDS`) are what clouds cost the scene. Lines tagged `// CONTENT` build the cloud data.

| Page | Package | What it proves |
| --- | --- | --- |
| [`/three-adapter/`](#three-adapter) | `@clouds/three` | The 9-line integration; depth sorting. |
| [`/r3f/`](#r3f) | `@clouds/react` | The 2-line React integration; lifecycle under stress. |
| [`/open-water/`](#open-water) | `@clouds/three` | Sea to the horizon with cloud reflections, shadows, depth sorting, presets. |
| [`/plains-flight/`](#plains-flight) | `@clouds/three` | A streaming cloudscape: ground, through the clouds, above, at 60 fps with no popping. |
| [`/onsen/`](#onsen) | `@clouds/three` | Authored hero clouds stamped into a generated region, in a real scene. |
| [`/vdb-drop/`](#vdb-drop) | `@clouds/runtime` | Houdini to browser in under two minutes, no code changes. |
| [`/flagship/`](#flagship) | `@clouds/runtime` | The reference page: every cloud asset, every bookmark, a HUD for tiers and memory. |
| [`/cloudscape-gen/`](#cloudscape-gen) | `@clouds/three` | The GPU generator, its presets and the distant sky layer. |
| [`/evolve/`](#evolve) | `@clouds/three` | Realtime evolution (P6-A, in progress). |
| [`/ocean/`](#ocean) | none | The reusable water scene on its own. |
| [`/runtime-tests/*`](#runtime-tests) | `@clouds/runtime` | GPU-versus-CPU checks that back the numbers. |

## three-adapter

[`examples/lab/three-adapter/main.ts`](../../examples/lab/three-adapter/main.ts). The smallest `@clouds/three` scene: a ground plane, the sky and the Parkouring cloud.
Eight lines are tagged `// INTEGRATION`, one of them the optional haze. Matches the flagship to a mean 0.11 to 0.38 of 255 per channel on the same bookmarks [P2-02].

Query: `?quality=low|medium|high|ultra|mobile|auto`, `?uniform=1` (no sky: uniform lighting), `?haze=1` (`sky.applyHaze` before the node),
`?objects=1` (adds bookmarks `objects`, `pierce`, `front`, `behind`), `?s.<setting>=N` (any `CloudSettings` value), `?exposure=`.
Bookmarks: `ground`, `edge`, `inside`, `above`, `backlit`, `shadow`, `frontlit`.

**Depth sorting.** With `?objects=1` a 1300 m tower pierces the cloud, a sphere floats in front of it and one sits 650 m behind: the cloud hides the tower where it is in front,
the tower shows above and below, and a 3x zoom shows no halo at the silhouettes [P2-05].

## r3f

[`examples/lab/r3f/main.tsx`](../../examples/lab/r3f/main.tsx). The same scene with `<Canvas>`, `<Sky>` and `<Clouds>`; the clouds themselves are one line. It matches
the three-adapter page to a mean 0.03 to 0.07 of 255 [P7-A]. `?haze=1|late|own` puts `<AutoHaze />` before, after, or `<Clouds haze>` (all three compose and the haze is applied once),
`?uniform=1`, `?bookmark=`, `?quality=`, `?s.<setting>=N`.
`?stress=1` runs a 16-step stress script (it also covers `<Cloudscape>` standalone and nested): volume swap, settings set and removed, quality changes, three remounts, `<Cloudscape>` standalone, nested and a preset change.
Result: 0 GPU errors, 0 device lost, and live GPU objects return to baseline (53 textures, 85 buffers after 292 and 364 created along the way). Use `--settle 1500` in the capture for it to finish.

## open-water

[`examples/lab/open-water/main.ts`](../../examples/lab/open-water/main.ts) with the reusable water in [`examples/lab/scenes/ocean/`](../../examples/lab/scenes/ocean/). Open sea to the horizon
(layered Gerstner-style waves in TSL, Fresnel reflection of the sky, a sun glint from the sky's sun, a camera-following grid with distance LOD) under a generated cumulus field.

- **Reflections.** `clouds.reflection(dir)` is hooked into the ocean material's environment node (`radiance = radiance * T + rgb`; 11 lines in the ocean module). Subtle on the rough default sea, clear on calm water (`?wave=0.05`): mean luma of the lower 590 px with and without reflections 42.3 vs 62.4 at sunset, 120.6 vs 117.4 at the horizon [P2-05].
- **Shadows.** Cloud shadows fall on the water through the composite alpha.
- **Cost.** 60 fps at 2560x1440 `high` with a p95 frame of 16.7 ms and 5 to 6 ms of whole-frame GPU in steady state [P2-06].
- Query: `?preset=cumulus|congestus|stratocumulus`, `?seed=`, `?reflect=0`, `?refgain=N` (debug gain on the cloud rgb), `?wave=`, `?cloud=<pack>` (a pack instead of the generator), `?quality=`.
- Bookmarks: `shore`, `horizon`, `sunset`, `flight`.

## plains-flight

[`examples/lab/plains-flight/main.ts`](../../examples/lab/plains-flight/main.ts). A scripted 40 s flight over plains through a **streaming** GPU-generated cumulus field: ground, up through the base,
through the clouds, above. One `setVolume` call per window swap; the volume belongs to the streamer.

- Window swaps are invisible: weather and shape noise are world-anchored, so two overlapping windows are byte-identical in the interior of the overlap (0 occupancy mismatches in 1.57 M voxels) and the swap changes the image by 0.2/255 [P3-D].
- Generation of a window takes 48 frames at 2 jobs a frame, with a worst encode and submit of 0.2 ms; the swap frame spikes about 1 ms (light grid) [P5-A].
- Cloud passes along the path (2560x1440, `high`): 2.1 to 3.4 ms with k = 4 temporal amortization, 2.4 to 6.1 ms without [P5-B].
- Query: `?t=<s>` jump to a time, `?play=1` real-time playback, `?bookmark=t0..t40|swapA|swapB`, `?preset=`, `?seed=`, `?quality=`, `?jobs=`, `?border=`, `?k=<near>,<far>` (temporal rates), `?sunDrift=<deg/s>`.

## onsen

[`examples/lab/onsen/main.ts`](../../examples/lab/onsen/main.ts) with the terrain in [`examples/lab/scenes/terrain/`](../../examples/lab/scenes/terrain/). An onsen on a mountainside at golden hour over a misty valley.
A 512x512x96 generated cumulus region at 12 m voxels is stamped with 10 valley-fog banks, 5 fair-weather clouds and one tower, the SDF is rebuilt once, and the whole thing is one `setVolume`.
Haze comes from `sky.applyHaze`; cloud shadows come from the composite alpha; the heightfield's sun shadow is baked into per-tile textures and refreshed when the sun moves.

Whole frame 9.2 to 14.3 ms at 2560x1440 (60 fps vsync, p50 16.7 ms), of which terrain, pool and rocks are about 4 ms of scene and the clouds 5 to 10 ms before the P5 optimisations [P4-D]. Ten `// INTEGRATION` lines.
Query: `?time=<hours>` (default 18.6), `?bookmark=vantage|valley|sunset`, `?fogd=` (valley-fog density), `?skylayer=1` (the distant layer), `?clouds=0`, `?terrain=0`, `?pool=0`, `?shadow=0`, `?haze=`, `?pos=x,y,z&az=&pitch=`.

## vdb-drop

[`examples/lab/vdb-drop/main.ts`](../../examples/lab/vdb-drop/main.ts). Drag a `.vdb` onto the page, or pick one, or `?url=<path>` for a file the dev server can reach (`/@fs/<abs path>.vdb`; `fs.allow` is `../..` relative to the checkout that serves it).
It overlays the grid table, the mode picked, dims, timings, and frame/GPU ms, and builds `ground`, `edge`, `backlit`, `above` bookmarks from the imported bounds. Errors are shown in the page (for example
the Blosc codec hint), not thrown.

- The Nubis pack Parkouring VDB imports byte-exact against the pack conversion in 64 ms (`?compare=parkouring` reads the NVDF back and diffs it).
- The Disney WDAS cloud and the OpenVDB bunny cloud import as fog volumes and render.
- Query: `?mode=auto|pack|fog|sdf`, `?voxel=8`, `?scale=<world scale>`, `?width=<metres>`, `?iso=0.05`, `?grid=<name>`, `?seed=1`, `?quality=`, `?haze=1`.
- Without `?width` or `?scale`, a cloud narrower than 600 m is scaled to 1500 m wide (artist VDBs are in real-world units). The library itself never auto-scales.

## flagship

[`examples/lab/flagship/main.ts`](../../examples/lab/flagship/main.ts). The reference page, built on the **raw runtime** with its own bridge to three
([`three-bridge.ts`](../../examples/lab/flagship/three-bridge.ts)), so it is the worked example of using `@clouds/runtime` without the adapter. Orbit and free-fly camera, a time slider,
sliders for `CloudSettings`, and a HUD with tier, scale, cost versus budget and memory.

- `?cloud=` any of `parkouring` (default), `stormbird`, `houdini-test`, `heroes/tower`, `heroes/valley-fog`, `heroes/fairweather`, `heroes/sim-cumulus`, `heroes/sim-congestus`, `disney`, `local/bunny-cloud`, `local/cloud-0001`. The `local/*` assets are git-ignored.
- `?quality=ultra|high|medium|low|mobile|auto` and `?budget=<ms>` (`'auto'`), `?trace=<frames>` to record the auto-quality convergence in the report, `?time=<hours>`, `?s.<setting>=N`, `?pan=<deg/frame>` (a motion test for the temporal history).
- Bookmarks `ground`, `edge`, `inside`, `above`, `backlit`, `shadow`, `frontlit`.

## cloudscape-gen

[`examples/lab/cloudscape-gen/main.ts`](../../examples/lab/cloudscape-gen/main.ts). A GPU-generated 4 km cloudscape (512x512x64 at 8 m) over a ground plane. `?preset=cumulus|congestus|stratocumulus`, `?seed=`, `?jobs=`,
`?bookmark=ground|horizon|above|seamEast|seamSouth|seamNorth|seamHigh`, `?sky=1` for the distant sky layer (and `sky_<setting>=N` for its `SkyLayerSettings`), and any `NvdfParams` field as a query parameter.
It showed the presets read as domed, cauliflower-lobed clouds with flat bases (no vertical walls or stacked shelves) and the sky layer continues the same field to the horizon with no visible seam, for about 1.0 ms amortized at 2560x1440 [P3-B, P3-C1, P3-P4-acceptance].

## evolve

[`examples/lab/evolve/main.ts`](../../examples/lab/evolve/main.ts). Realtime cloud evolution: cumulus that form, drift, merge and dissipate over minutes at a small steady cost. This is the P6-A work, still in progress while this guide was written.

## ocean

[`examples/lab/ocean/`](../../examples/lab/ocean/). The water scene alone, with `@pmndrs/sky`, bookmarks, and an ocean-versus-no-ocean GPU measure. Useful for tuning the sea apart from the clouds.

## runtime-tests

Each is a page plus a report that the capture harness exits non-zero on if a check fails.

| Page | Checks |
| --- | --- |
| `/runtime-tests/density/` | GPU density against the CPU port of Guerrilla's `VoxelCloudSampler.cg`: formula max error 2.8e-7, end to end 4.3e-3. |
| `/runtime-tests/atmosphere/` | The atmosphere WGSL against the sky's own sun radiance and ambient (5 percent per channel). |
| `/runtime-tests/light-grid/` | CPU-march parity on a synthetic sphere; the 8-frame sun-change behaviour; update cost. |
| `/runtime-tests/dome/` | The reflection dome as an equirect panorama, the sun-change refresh and a frame-stall check. |
| `/runtime-tests/generate/` | Generated SDF against an exact CPU EDT over every voxel of 256x256x32 and each preset (never over, no sign flips); overlap byte-identity of two windows; timings. |
| `/runtime-tests/stamp/` | Stamp resampling against a CPU reference; the SDF after stamping against a CPU EDT over 14.2 M voxels (never over: max -4 m, 0 sign flips); per-stamp cost. |
