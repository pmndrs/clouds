# P8-A Side-by-side comparison page
Status: ready for review
Changed: `examples/lab/compare/**` (new: `index.html`, `main.ts`, `shared.ts`, `rig.ts`, `assets.d.ts`, `panes/{ours,takram}.ts`, `vendor/skypro/**` with `NOTICE.md` + `LICENSE`), `vite.config.ts` (`compare` input), `package.json` + `pnpm-lock.yaml` (devDependencies `@takram/three-clouds@0.7.6`, `@takram/three-atmosphere@0.19.1`, `@takram/three-geospatial@0.9.1`, `postprocessing@6.39.5`; none are dependencies of `packages/*`).
Verified:
- `pnpm check` -> exit 0 (typecheck, 210 tests, build). `node scripts/check-packed-consumer.mjs` -> `PACKED CONSUMER OK`.
- `capture.mjs --page compare/ --shots ground,horizon,sunset,above` runs for 3 panes in rows and cols, and 2 panes (default `ours,takram`) in rows and cols; no console errors.
- captures: `work/captures/P8-A/three-rows/` (all four bookmarks), `two-rows/`, `two-cols/` (all four), `three-cols/` (ground, sunset); each has `capture.json` with per-pane `gpuMs`, `cpuMs`, `renderSize` and `detail`.
Measures:
- Same view in every pane: pass. Horizon row, sun glow and bookmark framing match in all captures (one `ViewState`; every pane has the same size, vertical fov 50).
- Exposure: clear-sky luminance of the upper sky and the horizon band matched to ours at all four bookmarks within about 5 % in display-linear (`?clouds=0` captures). Constants: Sky Pro x1.35, Takram x7.5 (on top of the shared slider). Ground albedo gain x1.45 for Sky Pro and Takram, because their Lambertian ground read 1.2-1.6x darker than ours at `ground`/`horizon`; at `sunset` all three grounds are near black, ours slightly warmer (it picks up a sun glare lobe the others lack).
- GPU ms (three-rows, 1920x359 panes, all three renderers on one GPU, so noisy): ours 7-14 (clouds 6-13), Sky Pro 11-15 (cloud passes 5-7, the sky/ground/tonemap pass 3-6), Takram 12-14. CPU ms per frame: ours 0.4, Takram 0.2, Sky Pro 0.1.
Open issues: see "Limits" below. Also: `?coverage=` / the slider regenerates ours' volume (about 1 s, amortised over frames), the old volume is not freed (fine for a lab page).

## How it is built
- Panes: `ours` (@clouds/three on three WebGPU, open-water's cloudscape and sky layer, seed 7, @pmndrs/sky ground plane), `skypro`, `takram`. `?impls=a,b,c`, `?layout=rows|cols`, `?bookmark=`, `?coverage=`, `?exposure=`, `?fov=`, `?hud=0`, `?clean=1`, `?clouds=0` (clear sky), `?shadows=1` (cloud shadows on the ground in Sky Pro and Takram), `?takram_quality=`, `?quality=` (ours), `?stbn=<url>`.
- Shared state: one camera, drag to look, WASD/QE to fly (wheel = speed), or an orbit mode (button), driven from an overlay, not any canvas. Sun azimuth/elevation (the time of day), FOV, coverage and exposure are sliders.
- Sky Pro: vendored from Tidewater (`vendor/skypro/NOTICE.md`): its atmosphere, clouds and a trimmed copy of Tidewater's raw-WebGPU engine (~3k lines), because Sky Pro there is WGSL on that engine, not a three module. Own `GPUDevice` and canvas. The driver draws sky + clouds + a ground plane and tone maps with three's ACES formula. Cloud passes are timed with timestamp queries.
- Takram: `WebGLRenderer` + postprocessing `EffectComposer`: `RenderPass` -> `EffectPass(CloudsEffect, AerialPerspectiveEffect{sky, sunLight, skyLight}, exposure, ACES)`. Its atmosphere is ECEF-only (no local frame option), so the scene sits on the WGS84 ellipsoid at lat 35, lon 139.7 and `worldToECEFMatrix` maps our world (x east, y up, -z north) onto the local east-north-up frame; the sun direction is rotated into ECEF. Camera near/far 0.5-50 / 1.2e6.
- Takram assets come from the npm packages through vite `?url` imports into `node_modules` (atmosphere LUTs: transmittance, scattering, irradiance, higher-order scattering = 17 MB; weather, shape, shape detail, turbulence). The packages do not export `assets/`, so the paths are relative into `node_modules/@takram/*`. **The STBN texture is not in the package** (only on GitHub via Git LFS, `DEFAULT_STBN_URL`). Nothing was downloaded: the page builds a stand-in (high-pass filtered white noise per slice, rank-transformed). Takram's temporal upscaling therefore shows a little more 4x4 lattice grain than with the real file; `?stbn=<url to stbn.bin>` swaps it in.
- Coverage mapping (`shared.ts`, common 0..1, 0.5 = each one's fair-weather default): ours weather window `lo = 0.56 + (0.5 - c) * 0.6`, `hi = 0.9 + (0.5 - c) * 0.3`; Sky Pro `shell.coverage = 0.98 c` (preset 0.49); Takram `coverage = 0.1 + 0.5 c` (0.35). All three respond monotonically (checked at 0.2 / 0.5 / 0.8). The scales are not equal in apparent cover: at 0.5 Takram's default layers cover most of the sky, ours covers the lower sky, Sky Pro is sparse; at 0.8 Sky Pro is a thin overcast veil.

## Per-bookmark write-up (what each does better, where we adjust)
Layers differ by design: ours base 150 m / top ~660 m (field 2.3 km north + a sky layer to the horizon); Takram default layers 750-1400 m, 1000-2200 m, plus a 7500 m high layer; Sky Pro 4000-9200 m. Altitude sets apparent cloud size and perspective, so "bigger in ours" is largely this.

**ground** (eye 2 m, sun 40 deg behind the camera)
- Shape: ours has the best cumulus *form*: distinct towers with flat bases, billowy detail, readable cauliflower edges. Takram is the most natural at distance: layered cumulus that thins and flattens toward the horizon, with a wispy high layer; edges slightly grainy. Sky Pro: small, soft, smooth clouds, little internal detail at this scale.
- Lighting: ours has strong self-shadowing and blue-grey undersides; Takram softer and more uniform (milky, a bit flat, pinkish tint); Sky Pro bright and clean, almost no shading.
- Horizon and distance: ours is a dense low band of cloud that hits the horizon abruptly, with visible cell structure and no haze toward it (we lack the aerial perspective that fades Takram's far clouds into sky colour); this is where we most need work: add distance haze/fade and thin the far field. Takram and Sky Pro fade smoothly to a clean horizon.
- Coverage: ours (sky layer) is the heaviest at the horizon, but sparse overhead; Takram covers most of the dome; Sky Pro sparse. Sunset colour: n/a.
- Cost (ms): ours 14 (clouds 13, light grid 4.6 here), Sky Pro 11 (clouds 5), Takram 12.

**horizon** (40 m, sun 25 deg from the side)
- Ours shows cloud shadows moving across the ground (nothing else here does: Takram and Sky Pro can, with `?shadows=1`, where they are a full-ground cover in Takram), and the clearest sun-lit/shaded cloud faces. Takram has the best sense of depth: far layers hazed, aerial-perspective blue under distant bases. Sky Pro is very clean but sparse; its ground fades into a bright haze.
- Adjust: our far field reads as a flat white carpet; Takram's shows how much the horizon benefits from atmospheric extinction and from gaps.
- Cost: ours 11 (clouds 10), Sky Pro 14 (5.6), Takram 13.

**sunset** (4 m, sun 4 deg ahead, behind the clouds)
- Colour: Takram wins: the whole sky and the cloud undersides pick up warm orange/magenta from its multi-scattered atmosphere, deep contrast, silver lining on the cloud edges, a physically plausible dim sky. Ours has good rim light and a bright backlit horizon band (the best sun-behind-cloud glow), but the clouds stay a neutral blue-grey, the sky above is a flat blue-grey and the band at the horizon is white, not orange: sky/cloud tint at low sun is the largest colour gap. Sky Pro has the cleanest warm sky gradient and a visible sun glow, with uniformly cream clouds, but little cloud-body shading.
- Ground: ours picks up a sun glare lobe; Takram and Sky Pro are dark.
- Cost: ours 11, Sky Pro 14 (6), Takram 14.

**above** (3000 m, looking 9 deg down)
- Ours is the only one that can show a field of cumulus from above, but at this range it reads as bumpy white blobs ("popcorn") with strong aliasing and a hard edge to the field; there are no layers below to hide the end of it. Takram: broad white layer patches with ground showing between, correct perspective, fine grain, good distant haze; the best result. Sky Pro has nothing below its 4 km base, so the view is empty haze (expected, not a defect).
- Adjust: LOD/blur of our distant cells from above, and a transition from the field to the sky layer.
- Cost: ours 7 (clouds 6), Sky Pro 15 (7; the sky pass is 3-5), Takram 12.

Summary of where to adjust (ours): (1) aerial perspective / haze on far clouds and a cleaner horizon; (2) warm-light colouring of cloud and sky near the sun at low elevation (compare Takram); (3) a second, higher/thinner layer or wispy cirrus like Takram's (cheap, large visual gain); (4) cloud shadows on the ground are a strength to keep; (5) from above, the field needs distance LOD.

## Limits of the comparison
- Cloud layer heights, scales and the sun path are each implementation's native ones; only the view, sun, exposure and ground albedo are shared. Coverage is matched by feel, not by measured cover.
- Ground: the same albedo, but each lights it differently (ours: three standard material under the physical sun with sky haze; Sky Pro: Lambertian with Tidewater's key light + exponential haze; Takram: post-process Lambertian + aerial perspective). Cloud shadows on the ground are off everywhere except ours.
- Timings: all panes render at the same time on one GPU (plus parallel agents), so each number is inflated; ours is the pass sum from `clouds.timings`, Sky Pro is the sum of its compute kernels and final pass, Takram is a WebGL `EXT_disjoint_timer_query` over the whole composer (clouds, aerial perspective, tone map, ground). Measure one pane alone with `?impls=` for a clean figure.
- The Takram STBN stand-in (above); Takram quality `high`; Sky Pro quality "high" and preset "Partly cloudy".

## Orchestrator review
Accepted. The three-row horizon and sunset captures share the horizon line and sun position. They make the owner's point: our pane is a row of near-identical domes with varying bases, while Takram shows a varied stratocumulus/cumulus field with a high wispy layer and better sunset tint. This feeds Phase 9 (variety) and Phase 12 (haze, sunset tint, high layer). Takram's STBN stand-in adds grain; `?stbn=` loads the real one.
