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
| approximate-mie.md (in progress) | light sunset | Jendersie & d'Eon 2023 HG+Draine phase, a WGSL port, a C1 recommendation |
| rdr2-atmosphere.md (in progress) | horizon sunset cirrus shadow | RDR2 atmosphere talk (SIGGRAPH 2019), if that is what the pptx is |

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
| `jendersie/` (approximate Mie paper, supplemental, `draine.hlsl`) | light sunset | 🔄 | Phase function for droplets |
| `slides_public_release.pptx` (238 MB, likely RDR2 2019) | horizon sunset | 🔄 | |
| `cloud-photos/` (about 500 photos, 15 types, `manifest.json`) | shape sunset scene | ✅ photo-species-specs | Many misfiles (see that doc). Empty: stratus/fog valley, lenticular, mammatus, shelf, nimbostratus, cirrocumulus |
| `nubis-pack/`, `nubis-src/` | authoring | ✅ (P0) | Guerrilla's voxel cloud pack, MIT per the owner; assets in `assets/nubis-voxel-clouds/` |
| `disney-cloud/` | authoring | ✅ (P4-G) | WDAS cloud, CC BY-SA 3.0 |
| `vdbs/` (bunny, cloud.0001, ...) | authoring | ✅ (P4-H) | Import test assets |

## External links

| Link | Tags | Status / use |
| --- | --- | --- |
| [zenglb sky/cloud reading list (gist)](https://gist.github.com/zenglb/7e285db54d3e193398d7914a87dcabd2) | all | Index of about 40 classic papers and talks. **Worth reading next:** Hillaire 2016 "Physically Based Sky, Atmosphere and Cloud Rendering in Frostbite" (course notes PDF): sunset multi-scatter, cloud/atmosphere coupling. Bouthors 2008 "Interactive multiple anisotropic scattering in clouds": what gives low-sun bodies their colour. Yusov 2014 "High-Performance Rendering of Realistic Cumulus Clouds Using Pre-Computed Lighting". Högfeldt 2016 thesis (Frostbite clouds). The rest are pre-2010 sky models or covered elsewhere |
| [Ghost of Yōtei tech deep dive (PS Blog, 2025-10)](https://blog.playstation.com/2025/10/23/ghost-of-yotei-tech-deep-dive/) | horizon shadow | A 2.5D cloud map storing **mean and mean-squared depth** per texel, giving parallax while scrolling and an opacity distribution for occluding mountains. Clouds in front of terrain. A light-space cloud shadow map drives **god rays in volumetric fog**. Artist "god ray targets". Ideas for our sky-layer depth (add variance) and P10 (fog shafts). No slides yet; talks promised in 2026 |
| [Witcher 3 B&W cirrus (astralcode blog)](https://astralcode.blogspot.com/2019/05/reverse-engineering-rendering-of.html) | cirrus | A cheap textured dome cirrus with a normal map, sun-proximity front/back colour and a horizon bias. Our **low-tier cirrus fallback** (see legacy-and-survey) |
| [Unity cloud shadows video (YouTube kMiilElp3Js)](https://www.youtube.com/watch?v=kMiilElp3Js) | shadow | Not reviewable (no transcript). From the title, a projected mobile cookie. P10 already covers it |

## Where we are weakest, and which sources to read

| Gap | Read |
| --- | --- |
| Sunset colour (bodies should be mauve/slate with warm fringes) | photo-species-specs (targets), approximate-mie, rdr2-atmosphere, Hillaire 2016, Bouthors 2008 |
| Horizon haze and distance | legacy-and-survey (half-opaque depth), rdr2-atmosphere, Ghost of Yōtei (depth variance) |
| Cirrus | hzd-nubis-evolved (NE p.65), legacy-and-survey (Witcher fallback) |
| Species shapes | hzd-nubis-evolved (profile tables), photo-species-specs (numbers), deck-scenes (vocabulary) |
| Ground shadows and god rays | P10 reports; Ghost of Yōtei (fog shafts) |
