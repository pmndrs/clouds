# SkyPro demo cloud renderer reference

Scope: read-only inspection of the commercial demo bundle
`/Users/dex/Developer/threejsskypro.com/threejsskypro.com/assets/index-RPaHe5I5.js`.
This is an architecture and math reference only; no bundle code or implementation is copied.
Line numbers below are from the inspected bundle and are useful anchors for manual reading.

## Highest-impact lessons

1. The cloud field is a weather-controlled layered density, not a single noise lookup. A 64^3 mipmapped base shape is combined with a 2D weather map and a second, smaller erosion sample. Coverage and height remapping happen before extinction, which gives stable large forms and controllable edges.
2. Marching is adaptive and two-stage: conservative/base density takes coarse steps through empty space, then erosion refines occupied regions. Step size grows with distance/pixel cone angle; per-sample light uses a small cone of offsets and a four-term multi-scattering approximation.
3. The expensive cloud pass is deliberately decoupled from display resolution. It renders at a reduced source rate, uses a temporal lattice/history reprojection pass with hit-distance MRT, and separately bakes a low-resolution sun shadow map. This is likely the strongest realism/performance gap versus our current direct full-resolution path.

## Verified parameter hierarchy and density construction

`uQ` (bundle ~33456) is the shape parameter group: altitude 1400, thickness 2800, density .048, coverage 1, horizon coverage start/ramp/amount, edge softness/falloff, weather scale 40000, base scale 8000, erosion scale multiplier .5, base/erosion strengths, erosion shape, and base-weather strength/height range. `hQ` (~33501) carries scattering albedo, powder, ambient, ground bounce and base-shadow controls. `dQ` (~33595) advances wind offset and evolution offset; `pQ` is cirrus scale/strength; `fQ` is haze scale/density. `AQ` (~33604) groups these as `shape`, `lighting`, `wind`, `cirrus`, `haze`, `fade`.

`yQ` (~33640) defines Worley pyramid presets: low/mid/high cells `[4,8,16]`, `[8,16,32]`, `[16,32,64]`, all weighted `[.625,.25,.125]`. `_Q` defines generated-noise defaults (`mainMass` frequency 5, six octaves, seed 0, amplitude 3; `detail` frequency 7, six octaves, seed 1, strength .5; coverage .55). These are verified configuration values, though the bundle does not expose the original generator source.

`s_` (~34396) is the key density function. It samples weather at `position.xz / weatherScale`, samples base 3D shape at a wind/evolution-adjusted position divided by `baseScale`, combines base channels with weights `[.7,.41,.23]`, then derives coverage from weather red plus `(coverage-1)` and base mass. A shell height fraction `s` is remapped through thickness; coverage is subtracted from height to form a soft vertical density. Erosion samples the same 3D texture at `erosionScale`, inverts/interpolates its channels using `[.113,.04,.02]`, and applies height-dependent erosion strength between `erosionStrengthBase` and `erosionStrengthPeak`. `fB` (~34488) is full density with erosion; `ez` is a conservative/base-only candidate. `tz` (~34498) adds planet curvature (`horizontal distance² / (2*planetRadius)`) to shell height and applies horizon coverage ramping.

The density callback is returned as `primary`, `primaryCandidate`, `full`, and `cheap` (~34505). This split is directly useful for our density path: use conservative density to skip empty regions, then refine only likely cloud samples.

## Ray marching, lighting, shadows

`rB` (~33660) sets max steps 128, six light taps, light step 400, light cone spread .05, base step 150, step cone factor 1, max optical depth per step .5, early exit transmittance .001, base shape resolution 64, and dither strength 1. `hz` (~34548) intersects inner/outer spherical shells via `Az`, builds the sampler, then calls `dz`.

`dz` (~34612) starts at a dithered entry point, iterates max steps, grows effective step size with distance (`stepConeFactor * stepConeAngle * t`), and switches between coarse `fz` and fine `gz`. Coarse mode uses `primaryCandidate`; on positive candidate it evaluates erosion and switches to fine mode. Fine samples use `primary`; four consecutive empty runs return to coarse mode. `mz` (~34687) clamps per-step optical depth, computes segment transmittance, accumulates premultiplied luminance/front-to-back transmittance, tracks weighted/nearest/farthest hit distance, and exits when transmittance is below the early-exit threshold.

`OQ` (~34170) samples density at packed cone offsets and evaluates a four-term polynomial in optical depth and `msScatter`; `qb` (~34780) chooses cheap or full density based on whether the light cone is frozen. `HQ` (~34220) builds sun and optional moon phase terms. `VQ` (~34197) interpolates zenith, horizon, and ground-bounce radiance by cloud height. In `mz`, direct light is multiplied by sun tint/intensity, cone-light estimate, a powder term, and a height-varying base-shadow factor; ambient sky is added before Beer-Lambert attenuation. This is an approximation of multiple scattering, not a full path tracer.

`Kz` (~35785) is a separate projected cloud shadow bake. It marches from each shadow-map texel toward the active sun/moon through the cloud shell and stores `exp(-integratedDensity)`. It invalidates when camera, light, density revision, textures, extent, mip, or light-step settings change. The generated map is later used by ground lighting/god rays.

## Resources, LUTs, and temporal reconstruction

`R5`/`M5` (~37223) load `./data/baseShape${size}.bin` beside the bundle, gzip-decompress it, and `D5` creates a `Data3DTexture` (`RGBA`, mip levels, clamp wrapping, no generated mipmaps). `F5` therefore resolves `data/baseShape64.bin` for the default/high/ultra profiles. The inspected asset directory contains `data/baseShape32.bin`; the bundle's high profile requests 64, so the exact 64 file is not present in the inspected directory. Weather is generated at runtime by `T5` (`weatherMapResolution` 1024; initialized in `r_` ~37405), then passed as `noiseTextures.weather`. No separate cirrus file path was found; cirrus uses a texture supplied through `setCirrusTexture`.

Atmosphere resources are baked as `transmittanceLUT` (256x64) and `multiScatterLUT` (32x32) in `e5` (~37490 onward), with sky-view and aerial perspective LUTs owned by pipeline `p5` (~36700). Cloud material `mB` (~34869) requires base-shape and weather textures before `init`; it optionally consumes blue noise, cirrus, sky-view, aerial inscatter, and aerial transmittance LUTs. WebGPU TSL emits 3D texture bindings and mip-level sampling through the generic texture code (~30644), while cloud-specific shader assembly is the node graph around `mB._buildColorNode` (~34924).

`wz` (~35237) renders the cloud ray march at `1/sourceDiv` resolution and writes color plus `rayHitDist` MRT. `Gz`/`Dz`/`Nz` (pipeline setup ~36700 and temporal material ~35290) distribute samples on a lattice, jitter NDC rays, reproject history with previous view projection/camera position, and blend near/far history using hit distance. History is invalidated when shape/lighting/layer/wind/quality/texture revisions change (`p5._cloudHistoryInputsChanged`, ~36780). `kz` then composites the reconstructed cloud texture against scene depth and atmospheric perspective. These mechanisms are directly relevant to our `realistic-shader.ts`, whose current comments indicate no temporal history.

## Relevance to this repository

The most actionable upgrades are: add a conservative density candidate and erosion refinement split; add distance/pixel-cone adaptive stepping plus early transmittance exit; use six light-cone taps with a cheap/full density choice; expose weather scale/coverage/height profiles rather than only one 3D field; add a reduced-resolution cloud pass with temporal hit-distance reprojection; and add a projected cloud shadow bake. Our current `experiments/cloudscape-density/source.ts` already has deterministic fractal/Worley ingredients, while `packages/legacy/three/src/volumetric/realistic-shader.ts` already has an optical-depth cache and jitter. The missing pieces are the hierarchy, temporal reconstruction, and resource-backed 3D mip strategy.

## Evidence and limits

Verified facts are limited to symbols, constants, control flow, and asset paths visible in the minified bundle. Names such as `uQ`, `s_`, `hz`, and `mB` are minifier-local. Any statement about visual quality or likely benefit is an engineering inference. The commercial bundle remains reference material only; do not copy its code or ship its assets.
