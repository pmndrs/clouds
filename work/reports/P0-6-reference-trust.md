# P0.6: can the card's path traces be trusted? (furnace, absorber, Cycles, direct-volume material)
**Verdict: the path-traced references on the card are trustworthy to within 0.3 % for clouds up to extinction 0.5 per metre** (the densest card grid, the sky patch at 0.498/m; EmberGen 0.384, Parkouring 0.30). They do not gain energy with density. So the card's pattern (EmberGen, sky and stratus thick bodies at 0.4-0.6x, Parkouring at 1.26x) is **our realtime lighting**, not the reference. Path tracer = `../pathtracer` at its last commit `ad9c01e` (the volume code the card used; the uncommitted `clouds/volume-reference` edits were left out by serving a `git archive` copy through `PATHTRACER_DIR`).

Page: `examples/lab/reference-pt/`, panel row **Review: PT test** (each also a URL parameter): `ptTest=furnace|absorber` (no sun, uniform sky of 1; albedo 1 or 0), `majorant=brick|global`, `extScale=1|0.333`, `maxDepth=512|4096`, and `alphaFilter=`. `window.__clouds.exportManifest()` + `capture.mjs --export <dir>` write a `scripts/reference/` manifest, `density.f32` and `sky.pfm`. Numbers: `work/captures/P0-6/results.txt`; sheets `furnace-absorber.jpg`, `cycles-vs-pt.jpg`. All at 640x360.

## 1. Furnace (albedo 1, sky 1, HG 0.8, 256 spp; every pixel must read 1)
| cloud (sigma_t max) | majorant, depth | mean α>0.5 | mean α>0.995 | p1-p99 α>0.995 | frame |
|---|---|---|---|---|---|
| EmberGen 02 (0.384/m, card) | brick 512 / seed 2 | 1.0001 / 0.9998 | 1.0001 / 0.9998 | 0.941-1.058 | 1.0000 |
| | global 512 | 1.0001 | 1.0002 | 0.943-1.057 | 1.0000 |
| | brick 4096 | 1.0001 | 1.0001 | 0.941-1.058 | 1.0000 |
| EmberGen x1/3 (0.128/m) | brick / global | 1.0000 / 1.0000 | 1.0000 / 0.9999 | 0.941-1.057 | 1.0000 |
| sky patch (0.498/m, card) | brick 512 / seed 2 | 0.9745 / 0.9744 | 0.9721 / 0.9721 | 0.865-1.045 | 0.9980 |
| | global 512 | 0.9745 | 0.9719 | 0.866-1.043 | 0.9980 |
| | **brick 4096** | **0.9997** | **0.9997** | 0.941-1.056 | 1.0000 |
| sky x1/3 (0.166/m) | brick / global | 0.9987 / 0.9990 | 0.9986 / 0.9988 | 0.941-1.057 | 0.9999 |
| Parkouring (0.30/m, card) | brick 512 / seed 2 | 0.9999 / 0.9998 | 1.0001 / 1.0000 | 0.941-1.061 | 1.0000 |
| | global 512 / brick 4096 | 0.9998 / 0.9999 | 1.0000 / 1.0001 | 0.941-1.056 | 1.0000 |
| Parkouring x1/3 (0.10/m) | brick / global | 1.0000 / 1.0004 | 1.0003 / 1.0003 | 0.944-1.059 | 1.0000 |

- **No reading above 1** beyond noise (seed-to-seed spread of the means 0.01-0.03 %; per-pixel noise about 2.3 % at 256 spp). Brick and global agree to 0.04 %.
- **The depth cap can only lose energy** (a path still inside at bounce 512 is dropped). It does on the sky patch: -2.6 % (cloud) / -2.8 % (thick), concentrated in the two dense cores (sheet), and **4096 bounces recovers it to 0.9997**, so it is the cap, not a bug. The loss falls to 0.13 % at a third of the extinction: it grows with density as diffusion predicts, not faster.
- **On the card itself (albedo 0.99, sun) the cap costs nothing measurable**: sky and EmberGen at noon, 512 vs 4096 bounces, read 0.9999-1.0000 (cloud and thick). 0.99^512 = 0.6 % of a path's weight survives to the cap anyway.
- **Majorants checked in code and on the real grid.** `brickMajorants` (volume.ts:198) takes the max over voxels 8c-1..8c+7 per axis, which is exactly what a trilinear lookup in coarse cell c (u = (index + 1) / 8) can read. The PT's grid texture is r32float holding the same f32 values the majorants are built from (the card's half-float decode happens on the CPU before both, in `direct.ts`), so no texel/majorant mismatch. Fuzz on EmberGen's grid (`majfuzz.py`, 8 M points, half within 1e-3 voxel of brick borders): max density / majorant 0.99994, no violations.

## 2. Pure absorber (albedo 0, sky 1): PT image L against the page's trilinear transmittance march T (quarter-voxel midpoint), pixels α > 0.02
| cloud | mean L | mean T | L - T, brick / global | mean abs pixel diff (noise) |
|---|---|---|---|---|
| EmberGen 02 | 0.0678 | 0.0678 | +0.00005 / +0.00003 | 0.0019 / 0.0013 |
| sky patch | 0.2412 | 0.2412 | -0.00001 / +0.00003 | 0.0043 / 0.0024 |
| Parkouring | 0.3008 | 0.3007 | +0.00004 / +0.00007 | 0.0062 / 0.0021 |

At albedo 0 the free flight's null-collision weights reduce to ratio tracking, so this tests the majorant and the transmittance estimator directly (a density above its majorant would make a factor negative and pull L below T). Free-flight error: under 0.1 %. Sheet row 3: only edge grain, no bias.

## 3. Cycles cross-check: EmberGen 02 noon, 640x360 (manifest `embergen02-noon-manifest.json`, no padding needed: no density on the grid's faces)
Cycles 5.1 ray march (voxel/4), 128 spp, Metal, 511 Cycles bounces = 512, 46 s. Our PT: two seeds x 1024 spp, averaged (noise row = half the seed difference). Both HG g 0.8, albedo 0.99, sigma_t = 0.1799 x texel /m.

| Cycles / PT | cloud | thick | fringe | fringe B/R (C / PT) | base | dark20 | 16-64 px | 64-256 px | 4-16 px | clear sky |
|---|---|---|---|---|---|---|---|---|---|---|
| ratio | 0.999 | 0.999 | 0.998 | 2.739 / 2.729 | 0.998 | 1.021 | 1.014 | 1.007 | 1.64 (grain) | 1.00000 |
| PT noise | ±0.000 | ±0.000 | ±0.000 | ±0.002 | ±0.001 | ±0.045 | ±0.001 | ±0.002 | ±0.003 | |

The 4-16 band is Cycles' grain at 128 spp, not a measurement; the 16-64 band also carries some of it. The ratio map is grain with no structure (`cycles-vs-pt.jpg`). Cycles' null-scattering default (+10 % on this cloud, P0.2b) was not used.

## 4. The direct-volume material (realtime side only; nothing retuned)
`setVolume` copies `DIRECT_VOLUME_SETTINGS` (runtime.ts:449, M1, "Karma-fitted", agent-chosen) over the settings for a direct volume (runtime.ts:1224); Parkouring keeps the defaults. Same on both: nubis model, phaseG 0.2, silverG 0.85, silverStrength 0.4, inlineLightScale 1.
| setting | Parkouring | direct (EmberGen, sky, stratus, Disney) |
|---|---|---|
| msStrength / deepScatter / glowBoost / microShadow | 1.4 / 1.2 / 12 / 1 | 0.2 / 0.2 / 0 / 0 |
| ambientStrength / Saturation / Warmth | 1 / 1 / 0 | 0.5 / 0.5 / 0.7 |
| diffuseSun (falloff) | 0 | 0.5 (0.06) |
| lightDensityScale | 1.2 (makes up for the up-rez the grid lacks) | 1 |
| directInScatterFlat | 0 | 1 (only `d.y`; nubis barely reads it) |
| view extinction | densityScale 0.3 x bake | directDensity x densityRef x r16f texel: **identical to the PT's sigma_t** |

**Does either side see a different medium?** The view ray: no. The sun: the first 48 m use the exact r16f density; beyond that the light grid reads NVDF R = min(density/p99, 1) in 8 bits (vdb-direct.ts:216). EmberGen's texels reach 2.13x p99, so the densest 1 % saturate and the grid's sun optical depth is **shallower** there (brighter, not darker); fringes below 1/255 of p99 are lifted to 1/255 (slightly deeper, tiny). The lighting "profile" for a direct volume is that same saturated density, so ambient occlusion goes to its 0.15 floor in every dense core. So nothing in the medium makes the realtime sun shadow too deep. **The 0.4-0.6x is the M1 material**: multiple scattering about 7x and deep scattering 6x weaker than Parkouring's, half the ambient (greyed and warmed), and the saturated-profile occlusion. Only diffuseSun 0.5 adds light back. Owner flag: M1 is an agent-chosen default.

## For the pathtracer repo
No bug found. Furnace, absorber and majorant checks pass on real cloud grids up to sigma_t 0.5/m with both majorants. Two notes: (1) at 512 bounces a dense cloud loses 2.6 % in an albedo-1 furnace (expected; immaterial at albedo 0.99). (2) Costs at 640x360, 256 spp: the global majorant is 2-3x slower than brick (sky 315 vs 104 ms per pass).
