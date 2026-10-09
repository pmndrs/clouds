# Research index

**Start here.** Every agent working on clouds reads this before searching for sources. It lists what we have, what each source is good for, what has already been extracted, and what is still unread. Update it whenever you add or scan a source.

Rules:
- Slide images, the owner's photos and paper PDFs are **never committed**. Local sources live in the main checkout at `/Users/dex/Developer/WebGPUClouds/artifacts/research/`. Extracted pixels go to `work/captures/scratch/<topic>/`, which is gitignored. Only our text notes and our own renders are committed.
- Cite sources as `[deck slide]` or `[paper p.N]` and keep quotes under 15 words.
- If a source has nothing new on a question, write that down. It saves the next agent a read.

Tags: `shape` cloud shape and species · `weather` weather and type maps · `light` lighting, phase, multiple scattering · `sunset` low-sun colour · `horizon` distance, haze, aerial perspective · `shadow` ground and volumetric shadows · `cirrus` high clouds · `perf` budgets and amortization · `authoring` Houdini, VDB, tools · `scene` reference scenes · `api` integration and packaging.

## Our notes (`docs/research/`)

### Current (written 2026-10-08/09, after the reset)

| Doc | Tags | What it gives you |
| --- | --- | --- |
| [nubis-sources.md](nubis-sources.md) | light shape perf | **The formula reference.** Nubis Cubed and Synthesizing constants, the NVDF layout, the sampler, the lighting model, with slide citations |
| [deck-scenes.md](deck-scenes.md) | scene shape shadow | Catalog of every cloud scene in the N3 and SY decks, the shape vocabulary (why theirs vary), and targets T1–T7 |
| [hzd-nubis-evolved.md](hzd-nubis-evolved.md) | shape weather cirrus light perf | HZD 2015 and Nubis Evolved 2022: **vertical-profile tables** (species), weather channels, the **cirrus recipe (NE p.65)**, the horizon rule, the superstorm |
| [legacy-and-survey.md](legacy-and-survey.md) | horizon sunset shadow cirrus | Nubis 2017 and the 2021 survey, answered against five targeted questions. Also notes on the Witcher 3 cirrus layer and a Unity shadow video |
| [photo-species-specs.md](photo-species-specs.md) | shape sunset scene | **Measured from the owner's photos:** per-species silhouettes and ratios, altocumulus spacing CV, congestus taper, **sunset sRGB ranges**, picks for T1–T7, and the misfiled-photo list |
| [approximate-mie.md](approximate-mie.md) | light sunset | Jendersie & d'Eon 2023 HG+Draine: fits valid for d of 5–50 µm, a WGSL port (read-checked only, not yet compiled), and a comparison with our HG lobes (ours is 25–40× too bright at 90°). **Not the sunset fix by itself**: the culprit is probably the phase-less, sun-tinted `ms` term in `cloudInScatterMicro`. Adopt as an optional `phaseModel` in C1, after re-tuning colour |
| [rdr2-atmosphere.md](rdr2-atmosphere.md) | horizon sunset cirrus shadow perf | RDR2 (Bauer, SIGGRAPH 2019). The 2.5D map is coarse and gives little on shape. **Strongest ideas:** aerial perspective applied once at the transmittance-weighted depth with one shared frustum LUT (C2); a sun-weighted reduced-sky ambient and a back-scatter floor (C1); ESM cloud shadows with 1/16 texel updates and free god rays from the march (10); 1 ray per 2×2 half-res tile with reprojection (perf) |
| [frostbite-yusov-hogfeldt.md](frostbite-yusov-hogfeldt.md) | sunset light horizon perf shadow | Hillaire 2016 (Frostbite), Yusov 2014 deck, Högfeldt 2016 thesis, Bouthors 2008. **Sunset fix candidate (from Bouthors' order analysis, our port):** the isotropic body terms (`ms`, deep octaves) must scale with sun elevation (about `mu_L`) and hand over to the sky/ground environment pair at low sun, keeping the low-order edges warm. Also: eq. 21-22 weighted-depth aerial perspective plus the cloud-attenuates-haze coupling, per-altitude sun transmittance table, ambient controls (scale, desaturate, [a,1] bias), energy-conserving integral, history-based empty-sky skip. No cirrus, no shadow-map format |

| [cloud-motion-ideas.md](cloud-motion-ideas.md) | shape motion | **Parked idea doc.** The owner's observations from real cloud recordings: engines boil their detail; real detail travels with the cloud; the leading face is sharp, the trailing edge soft, tops crisp, bases smooth; skin rolls back and is reabsorbed; the life cycle of ejecting and absorbing. Includes their grid/tube and billow-sphere brainstorm, candidate techniques (advected textures, flow noise, Lagrangian advection, curl noise) and a first step (optical flow on their clips). Pick up in a session with the owner |

| [image-gen-pilot.md](image-gen-pilot.md) | shape authoring | fal.ai pilot on the hero tower: Qwen multi-angle and nano-banana-2 give plausible but non-consistent side views; FLUX 3 edit doesn't re-pose; back views mirror. Better use: new targets, gap types, isolation |

### Pre-reset (2026-09 and earlier; may be stale; read critically)

| Doc | Status |
| --- | --- |
| volumetric.md, realism-gap.md, cloud-quality-bench.md, morphology-study.md | Earlier agents' renderer research. Superseded by the Nubis³ rebuild; kept for history |
| nubis-lod.md, nubis-classic-lod-notes.md | Older LOD notes; `hzd-nubis-evolved.md` covers the same sources in more depth |
| skypro-demo-reference.md, tidewater-density-reference.md, tidewater-transport-reference.md | How Sky Pro and Tidewater work: the visual bar, not our code base. Still useful for comparison |
| integrations.md, upscaler-integration.md | three.js and `@pmndrs/upscaler` integration notes. Partly superseded by `packages/three` |
| volume-assets.md, native-reference.md | VDB and Blender asset notes from before the P4 pipeline |

## Source library (local, `artifacts/research/` in the main checkout)

| Source | Tags | Scanned? | Notes |
| --- | --- | --- | --- |
| `~/Downloads/Nubis Cubed - 1080.pptx` (N3, SIGGRAPH 2023) | all | ✅ nubis-sources, deck-scenes | The method we implement |
| `~/Downloads/Schneider - Synthesizing Realistic Clouds for Video Games.pptx` (SY, 2024) | light shape | ✅ same | Physical rules behind the noise, lighting |
| `The Real-time Volumetric Cloudscapes of Horizon - Zero Dawn - ARTR.pdf` (2015) | weather shape perf | ✅ hzd-nubis-evolved | Height gradients, weather map, reprojection |
| `nubis/nubis-evolved-2022.pdf` | shape weather cirrus | ✅ hzd-nubis-evolved | Profile tables, cirrus p.65, envelope, superstorm |
| `nubis/nubis-cubed-2023.pdf` | all | ✅ (same as the pptx) | |
| `Nubis - Authoring Realtime Volumetric Cloudscapes ... Final .pdf` (2017) | authoring horizon | ✅ legacy-and-survey | Weather scheduler, the half-opaque haze depth, silver lobe |
| `COMPREHENSIVE SURVEY OF CLOUDS 2021.pdf` | survey | ✅ legacy-and-survey | Nothing new on our five questions |
| `s2016-pbs-frostbite-sky-clouds-new.pdf` (Hillaire 2016, Frostbite course notes) | sunset horizon light shadow perf | ✅ frostbite-yusov-hogfeldt | Octave MS with no numeric a/b/c, sun and atmosphere constants, eq. 21-22 aerial perspective, ambient controls |
| `Yusov-Clouds.pdf` (HPG 2014, **slides only**) | perf light | ✅ same | Precomputed particle lighting; its sunset frames are uniformly orange (a counter-example). Nothing on ambient, cirrus, shadow |
| `hogfelt.pdf` (Högfeldt 2016 thesis) | perf light | ✅ same | Compact Frostbite shader, early exits, temporal alpha 5%, dusk render p.39. AP and ground shadows are future work |
| `bouthors08.pdf` (Bouthors et al. 2008) | sunset light | ✅ same | Scattering-order regimes and the `mu_L` dependence of the diffuse body; "blue above, brown below" environment pair. Full model not portable |
| `jendersie/` (approximate Mie paper, supplemental, `draine.hlsl`) | light sunset | ✅ approximate-mie | Phase function for droplets |
| `slides_public_release.pptx` (238 MB): RDR2, Bauer, SIGGRAPH 2019 | horizon sunset shadow perf | ✅ rdr2-atmosphere | 78 slides |
| `cloud-photos/` (about 500 photos, 15 types, `manifest.json`) | shape sunset scene | ✅ photo-species-specs | Many misfiles (see that doc). Empty: stratus/fog valley, lenticular, mammatus, shelf, nimbostratus, cirrocumulus |
| `nubis-pack/`, `nubis-src/` | authoring | ✅ (P0) | Guerrilla's voxel cloud pack, MIT per the owner; assets in `assets/nubis-voxel-clouds/` |
| `disney-cloud/` | authoring | ✅ (P4-G) | WDAS cloud, CC BY-SA 3.0 |
| `vdbs/` (bunny, cloud.0001, ...) | authoring | ✅ (P4-H) | Import test assets |
| `node_modules/@takram/three-clouds` 0.7.6 and `@pmndrs/sky` 0.5.0 source (installed) | horizon sunset | ✅ (C2, `work/reports/C2.md`) | Takram: H16 eq. 21 front depth, per-pixel Bruneton AP, plus an extra exponential **haze** (3e-5/m, 1 km scale height) mixed over clouds and sky: the reason its horizon fades. pmndrs/sky: ozone (Chappuis) and multiple scattering are in the LUTs; its twilight ramp at -1 to -4 deg already goes orange, pink, lilac, purple, indigo (dark only at a fixed exposure). AP LUT 32^3 at 8 km/slice (256 km) |
| Takram `three-clouds` density and lighting (`src/shaders/clouds.glsl`, `clouds.frag`, `CloudLayers.ts`); Sky Pro `tidewater/src/sky/SkyProClouds.js` density, weather and march | shape lighting | ✅ (X1, `work/reports/X1.md`) | Ported into `packages/runtime/src/procedural/` (NOTICE there). Takram: HZD layer model (per-layer weather channel, semicircle height gradient, coverage remap, 128^3 shape / 32^3 detail erosion, turbulence), 8-octave Wrenninge lighting. Sky Pro: height-field top = weather + coverage - 1 + noise dilation, flat-base floor mask, 64^3 noise erosion, coarse/fine march with weather-cell skips, 7-tap light cone |

## External links

| Link | Tags | Status / use |
| --- | --- | --- |
| [zenglb sky/cloud reading list (gist)](https://gist.github.com/zenglb/7e285db54d3e193398d7914a87dcabd2) | all | Index of about 40 classic papers and talks. Hillaire 2016, Bouthors 2008, Yusov 2014 and Högfeldt 2016 are now scanned (see the source table). The rest are pre-2010 sky models or covered elsewhere |
| [Ghost of Yōtei tech deep dive (PS Blog, 2025-10)](https://blog.playstation.com/2025/10/23/ghost-of-yotei-tech-deep-dive/) | horizon shadow | A 2.5D cloud map storing **mean and mean-squared depth** per texel, giving parallax while scrolling and an opacity distribution for occluding mountains. Clouds in front of terrain. A light-space cloud shadow map drives **god rays in volumetric fog**. Artist "god ray targets". Ideas for our sky-layer depth (add variance) and P10 (fog shafts). No slides yet; talks promised in 2026 |
| [Witcher 3 B&W cirrus (astralcode blog)](https://astralcode.blogspot.com/2019/05/reverse-engineering-rendering-of.html) | cirrus | A cheap textured dome cirrus with a normal map, sun-proximity front/back colour and a horizon bias. Our **low-tier cirrus fallback** (see legacy-and-survey) |
| [Unity cloud shadows video (YouTube kMiilElp3Js)](https://www.youtube.com/watch?v=kMiilElp3Js) | shadow | Not reviewable (no transcript). From the title, a projected mobile cookie. P10 already covers it |

## Where we are weakest, and which sources to read

| Gap | Read |
| --- | --- |
| Sunset colour (bodies should be mauve/slate with warm fringes) | **frostbite-yusov-hogfeldt sec. 1b (Bouthors order analysis: elevation-dependent body light, cheap port with constants)**, photo-species-specs (targets), rdr2-atmosphere (sun-weighted ambient, S36), approximate-mie. Still unread: nothing, but no source gives colour numbers; photos remain the target |
| Horizon haze and distance | frostbite-yusov-hogfeldt (eq. 21-22: weighted depth, and clouds attenuate the haze under them), rdr2-atmosphere (transmittance-weighted depth, S62), legacy-and-survey (half-opaque depth), Ghost of Yōtei (depth variance) |
| Cirrus | hzd-nubis-evolved (NE p.65), legacy-and-survey (Witcher fallback) |
| Species shapes | hzd-nubis-evolved (profile tables), photo-species-specs (numbers), deck-scenes (vocabulary) |
| Ground shadows and god rays | P10 reports; rdr2-atmosphere (ESM, free god rays, S35/S62); Ghost of Yōtei (fog shafts) |
| Cost (high tier over budget) | rdr2-atmosphere (1 ray per 2×2 tile, S51–57); frostbite-yusov-hogfeldt (empty-sky skip from history, half-res, 5% EMA) |
