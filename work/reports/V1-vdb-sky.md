# V1: an artist VDB in our sky through @pmndrs/vdb (Compass G4, decision d3)

Branch `worktree-agent-afe06a42296da4189` (not merged). Page **`examples/lab/vdb-sky/`** (gallery card "VDB in the sky (V1)"). Every
review item has a control in the page's panel ("V1 vdb-sky (Review)"): route, asset, sky on/off, water/ground, sun elevation and azimuth,
density, sky shadow on the VDB, quality, bookmarks (near, far, sunset, above), and a file picker for any `.vdb` / `.nvdb`.

## Verdict
- **Route A works and is the one to adopt.** `@pmndrs/vdb` reads the file (`parseVdb` + `buildFromVdbDetailed`, or `NvdbFile` for `.nvdb`) into a
  `VDBGridPool` on our device; one compute pass written against `vdbModuleWgsl` (sample profile) resamples the sparse grid into our runtime's
  *direct* volume (the M1 path: density marched as-is). The cloud is then lit by our own lighting with the sky's sun, ambient and aerial
  perspective, casts and receives shadows with the procedural HZD sky around it (hybrid), and shows in the water reflection. At sunset it takes
  the same warm tone as the sky's own clouds. Load to first frame for the WDAS 1/8 `.vdb`: about 1.3 s of work (parse 0.25 s, NanoVDB build
  0.15 s, GPU resample 0.1 s, pack 0.4 s, SDF 0.3-0.8 s), against 48 s for the same file through our old in-browser NVDF importer (fog mode,
  CPU channels; `fine.test.ts`, not the same output, but the same "drop a VDB" job).
- **Route B works but does not belong in our sky.** `VDBFrameRenderer` (demo 11's setup) draws the same pool grid at full resolution, but it is a
  second renderer beside ours: flat and over-bright next to our clouds, blind to the sky's shadows, stair-stepped silhouettes at the default
  froxel size, and it must be composited *over* our clouds (it writes no depth), so a procedural cloud in front of it is drawn behind it. Its
  cost on this machine is about 10x route A's (below). Kept on the page as the comparison.
- **Honest look:** route A's WDAS cloud is softer and greyer than the procedural clouds around it. Resolution is not the reason at these
  distances: the 1/4 file (Fp8 `.nvdb`, resampled at 4.7 m with 2^3 taps under the 48 M texel cap) looks the same as the 1/8 at 6 m from 4.5 km
  (`sheet-near-eighth-quarter.jpg`; the 2^3 box even softens it a touch). The reasons are the light: in the `near` view it sits in the shadow
  of the HZD sky's overhead deck (heroShadow) and is lit mostly by the sky, so it has no crisp lit rims; with the sky shadow switched off it is
  white and lit like `sky=off`. That shadow is correct behaviour, but it makes the hero look dull under a heavy sky: the bookmark's sun is at
  60 deg to keep it partly lit. Its silhouette has a faint blue fringe at sunset (thin edge lit by ambient only).

## Captures (`work/captures/V1/`, loaded machine, 1920x1080, settle 300)
- Route A (default): `near.jpg`, `far.jpg`, `sunset.jpg` (the requested `capture.mjs ... --out work/captures/V1/` run).
- Route B: `route-b/{near,far,sunset}.jpg`.
- A/B sheets (same crop): `sheet-near-AB.jpg`, `sheet-sunset-AB.jpg`.
- Variants (`variants/<name>/`): sky off for both routes (timing), ultra, the Fp8 `.nvdb` files, the WDAS 1/4, the JangaFX CloudPack 02 and 10
  (EmberGen, Z-up), sky shadow off. Early debugging shots in `dev/`.
- CloudPack 02 (`variants/a-cloudpack-02/sunset.jpg`) is the best-looking result: cauliflower tops lit warm, the same tone as the sky's clouds.

## Timings (GPU ms from the page's timers; the machine is heavily loaded, so read ratios, not budgets)
| | route A (runtime direct) | route B (vdb froxel, 256x256x32, neural MS) |
|---|---|---|
| WDAS 1/8, `near`, sky off | cloud passes 6-11 ms (march 0.8-1.6, the rest light grid / shadow / resolve; ultra: 6.1, march 3.3); scene 14-17 ms | scene 105-121 ms (the froxel volume renders in it; our passes 3-5 ms on an empty box) |
| WDAS 1/8, `far`, sky off | cloud passes 4.2; scene 12.3 | scene 39.5; ours 3.6 |
| ratio | **1x** | **about 10x near, 7x far** for the VDB itself |
| with the HZD sky (hybrid) | the procedural trace (skyLayer) is 45-52 ms in both routes and dominates; the VDB adds no measurable march time | the same, plus the froxel volume (scene 53-186 ms) |

Load (CPU on the main thread unless noted; `variants/*/capture.json` `report.load` / `report.direct`):
| file | fetch | parse | NanoVDB build | pool | GPU resample + readback | pack (CPU) | upload + SDF | lattice |
|---|---|---|---|---|---|---|---|---|
| WDAS 1/8 `.vdb` 9.6 MB | 180-450 | 210-270 | 125-160 | 16.5 MB float | 92-127 | 330-420 | 260-810 | 253x308x175 @ 6 m |
| WDAS 1/8 Fp8 `.nvdb` 6.5 MB | 204 | **1** | 0 | 6.5 MB fp8 | 92 | 408 | 266 | same |
| WDAS 1/4 `.vdb` 65 MB | 524 | 467 | 523 | 88 MB float | 642 | 600 | 1058 | 320x392x220 @ 4.7 m (2^3 taps, capped) |
| WDAS 1/4 Fp8 `.nvdb` 27.7 MB | 332 | **1** | 0 | 27.7 MB fp8 | 671 | 553 | 849 | same |
| CloudPack 02 `.vdb` 19 MB | 418 | 356 | 329 | 36 MB float | 206 | 910 | 1058 | 336x484x180 @ 4 m |
The first `setVolume` on a page costs about 2.5 s (pipeline compiles); later ones 45-180 ms. Route A's dense copy is 8 B per texel on the GPU
(104-230 MB here) next to the pool. `.nvdb` is the format to ship: zero-copy load and a 2.5-3x smaller pool.

## What landed
- `examples/lab/vdb-sky/vdb-direct.ts`: `readVdbSource` (`.vdb` or `.nvdb` to a NanoVDB image, picks the `density` grid) and `DirectResampler`
  (the pool, one compute pipeline for every scalar grid type, `lattice()` for dims and placement, `build()` for a caller-owned
  `GpuCloudVolume` with `direct`). The lattice keeps the source's own voxel size times the world scale (capped at 48 M texels by growing the
  voxel), each texel is the mean of n^3 trilinear taps (n = texel / source voxel, up to 4), Y-up and Z-up (EmberGen: row = -Y, as
  `vdb_to_direct.py --up z`). densityRef is the p99 of the occupied texels; NVDF R is at least 1/255 wherever there is material so the SDF keeps
  thin wisps. `setVolume` then applies `DIRECT_VOLUME_SETTINGS` (M1) as for any direct asset.
- `examples/lab/vdb-sky/main.ts`: the page (water from `scenes/ocean`, `@pmndrs/sky`, `@clouds/three` `Clouds`, the HZD procedural model in
  `hybrid` with `boxCarve` 300 m and the S1 'real' style). Route B: `VDBGridNode` + `vdbSparseSource` (coarse pyramid) + `VDBFrameVolume` in
  its own scene, lit by a copy of the sky's sun light and its environment, rendered in its own pass (cleared transparent, `srgbBlending` off,
  premultiplied) and laid over our composite. An empty 32 m runtime box over the grid carves the procedural sky there.
- `vite.config.ts`: `vdbDir()` / `vdbAliases()` (walk up to `WebVDB/packages/vdb`, `VDB_DIR` overrides; aliases to its `dist/`, subpaths first),
  `fs.allow` for it, `resolve.dedupe: ['three']` (its dist imports three from its own `node_modules`: without dedupe the page would run two
  three copies, one without our r187 patch), build input `vdbSky` when the checkout is there. Works from the main checkout and a worktree.
  `pnpm typecheck` already resolved `@pmndrs/vdb` from a worktree through the main checkout's `node_modules` (walk-up), unchanged.
- Local assets (never committed): Fp8 `.nvdb` bakes in `artifacts/research/v1-vdb/` (WDAS 1/8 6.5 MB, 1/4 27.7 MB, CloudPack 02 10.9 MB, 10 9.5 MB;
  `writeNvdb(vdbQuantize(buildFromVdbDetailed(grid), 'fp8'))`, 2.8-7.9 s each in node). The page reads research files from the main checkout
  (`/@fs`), so it runs from a worktree.

## Findings on the way
- **The hybrid sky shadows the hero (X4 heroShadow).** First renders had the WDAS uniformly grey: the light grid integrates the procedural
  clouds toward the sun and the HZD sky had a deck over it. `?proc_heroShadow=0` (panel: "sky shadow on VDB") restores the sky-off look.
- **`DIRECT_VOLUME_SETTINGS` is global.** In route A the M1 direct material balance (ambient saturation 0.5, warmth 0.7, diffuse sun ...) also
  lights the procedural sky, so the sky looks a little different from route B or the HZD bench (sunset: browner clouds). The VDB and the sky
  then share one material (consistent), but the sky has left its S1 look. A per-field material (voxel vs procedural) is the fix.
- **Route B ordering.** Inside the main scene the froxel volume was invisible: our composite blends every procedural cloud over the scene
  colour, those behind the VDB included (the proxy writes no depth). Rendering it in its own pass over the composite fixes the common case and
  breaks the rarer one (a procedural cloud in front of it).
- **Route B resolution is the froxel grid, not the data.** The full-resolution sparse WDAS 1/4 (24 M voxels) looks as soft and flat as the 1/8
  (`variants/b-quarter-nvdb/near.jpg`); the silhouette steps are froxel-sized. Demo 11's 'high' (512x512x32) would cost more again.
- **Route B lighting.** At sunset the VDB stays near-white and bluish: its SH environment and the copied sun light are not the sky model our
  clouds use, and no aerial perspective reaches it.
- **Dev server:** a missing `/@fs` file answers 200 with `index.html`, so the asset probe checks the content type.

## Gaps for upstream @pmndrs/vdb
1. **A resample-to-lattice tool.** What `DirectResampler` does (arbitrary world transform and axis permutation, box filter, a texture or
   buffer in the host's layout) is the step every engine adopting the pool will write. `vdbDecodeToAtlasGpu` is close but works in index space,
   normalises to the root range and has no transform or filter.
2. **Multi-channel grids (NVDF).** The pool takes scalar grids only. A Nubis NVDF (profile, detail type, density scale, plus SDF) or the Frog's
   `density` / `detail_type` / `density_scale` would be 3-4 trees (3-4 descents per tap). One tree with several value channels (a Vec4/rgba8
   leaf, or an index grid with blind-data channels) is what our NVDF path needs.
3. **Majorants.** The `majorant` WGSL profile is reserved and throws in 0.1. Marching the pool directly (no dense lattice) needs a cheap
   per-brick majorant / empty-space query for delta tracking and our step control; today we rebuild an SDF from the dense copy.
4. **A brick export.** The runtime already has a sparse brick overlay (P13-H1 fine bricks). `vdbDecodeToBricks` (leaf bricks into a 3D atlas
   texture + indirection) would let the runtime keep the sparse layout and hardware filtering, instead of a dense lattice (the 48 M cap).
5. **Workers.** `parseVdb` / `buildFromVdbDetailed` / `vdbQuantize` are synchronous on the main thread (WDAS 1/4 `.vdb`: parse + build 1 s, plus our pack 0.6 s; larger artist files will freeze the page for seconds).
   A worker entry (or transferable stream reader for `.vdb` like `NvdbStreamReader`) is needed for drop-anything.
6. **Froxel renderer as a guest renderer:** no depth or transmittance output, no external shadow input (our clouds cannot shadow it, it cannot
   shadow ours or the water), no aerial-perspective hook. It is a renderer of its own, not a component.
7. **Packaging:** dist imports `three` from its own checkout; consumers on `link:` need `dedupe`. The peer range `>=0.187.0 <0.188.0` will block
   our r188 move (planned to drop our three patch).

## What G4 still needs ("drop any .vdb in the browser, lit like the sky, inside the sky")
- Move `vdb-direct.ts` into `@clouds/runtime/import` as `importVdbDirect(device, bytes, options)` (pool on the runtime's device), and make the
  direct path the default of `importVdb` (vdb-drop), replacing the vendored `vdb-web-tools` parse for density grids. Keep the NVDF path for
  Nubis-pack VDBs (multi-grid) until gap 2 is solved.
- Parse in a worker; progress UI.
- Placement on the drop: up axis guess (Z-up when the grid is flat in Y), world scale (units guess from voxel size and extent, override),
  base height, position in the sky, and a gizmo; carve the procedural sky around it (hybrid, as here).
- Density calibration across sources (EmberGen vs WDAS vs Houdini units): a target optical depth from the p99 density and the box size, with the
  density slider as the override.
- Per-field material settings (gap above) so a dropped VDB can take the M1 direct balance while the sky keeps its style.
- Large files: the brick path (gap 4) or a coarser lattice with a fine overlay for > 48 M texels.
