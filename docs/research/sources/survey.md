# A survey of modeling, rendering and animation of clouds in computer graphics (Goswami, The Visual Computer 37, 2021): taxonomy and fetch list
Local: `artifacts/research/papers/COMPREHENSIVE SURVEY OF CLOUDS 2021.pdf` (18 pp; journal page = PDF page + 1930) · Dump: `artifacts/research/extracted/survey/` · Tags: survey shape layering detail animation · Status: 🟦 note written (taxonomy and fetch list; 0 code listings, the paper has no code and, in its modelling section, no formulas)

Already covered, not repeated: the five narrow questions (ground shadows, species shape, post-process, lighting, cirrus) in `legacy-and-survey.md`, and the per-method table M13 in `procedural-shape.md`. This note re-cuts the survey **by method**, ties each method to our four needs, and ranks what to fetch. Page numbers are PDF pages; `[nn]` is the survey's own reference number.

## What the survey is and is not
- A literature index, 1980 to 2019, with a bias to the Dobashi/Nishita group (Japan) and Neyret's group (Grenoble). Section 2 "Modeling" is only about 3 PDF pages (p.2-4); Section 4 "Animation" is p.9-13. Rendering (p.4-9) is mostly lighting history and is out of scope here.
- It names **no** equation for any shape method, no parameter value and no performance number for modelling. Its single hard numbers are in the physics (saturated mixing ratio, buoyancy) and the performance table (p.13-14). So every row below is "who did it and the one-line idea"; the value is the bibliography.
- It stops at 2019. Nothing on Guerrilla's NVDF, Schneider's talks (except [86], HZD 2015), Hillaire 2020 or the volumetric-neural-field work after 2020.

## Taxonomy of modelling methods (p.2-4, Table 1 p.5)
The author sorts by representation: Texture, Noise, Geometric, Shapes, Image-based, Satellite-images. Re-grouped below into the five families you asked about, with the animation methods (p.9-13) attached to the family they belong to.

### A. Procedural noise and texture (shape from a function)
| Paper [ref], year | One-line idea | Page |
| --- | --- | --- |
| Gardner [31], 1985 | Ellipsoids carrying a Fourier-series texture for detail, shading and translucency; flat textured planes for layers; animate by varying texture parameters in time | p.2, p.9 |
| Ebert and Parent [26], 1990; Ebert [25], 1997 | Solid texturing of surfaces/planes for gas; "A cloud is born": a procedural **implicit function** as cumulus density (the survey names no recipe; sphere union plus turbulence is from Ebert's book); evolve by varying the function with time | p.2, p.10 |
| Sakas [82], 1993 | Spectral synthesis in the frequency domain, turbulence theory; mean flow plus fluctuating part `u = Ū + u'` (Ū general translative velocity, u' random fluctuation), both animated spectrally | p.2, p.9-10 |
| Neyret [69], 2000 (RR-3947) | "Phenomenological shader": **Perlin noise added on the surface representation** of a cumulus; cloud corona lit as Lambertian, core as scattered, concave faces as light traps | p.2, p.5 |
| Schpok et al. [87], 2003 | **Two-level**: user outlines ellipsoids, picks preset noise filters; noise split into octaves stored as GPU textures, one matrix per octave; macro animation by keyframes, micro by pre-computed volumetric noise (wisps straying, parts appearing and vanishing at edges) | p.2, p.8, p.10 |
| Hasan et al. [40], 2005; Xu et al. [102], 2009 | Static procedural GPU clouds; modified cellular automata with Brownian-motion probability fields | p.2 |
| Webanck et al. [99], 2018 | **Cloud-type** density and shape functions, a control function for large-scale cover, altitude parameters per type; **morphing** between two cloudscapes by optimal-transport pairing of primitives (we have this as `web18`) | p.2, p.10, Fig 12 |
| Goswami and Neyret [34], 2017; Goswami [32], 2019 | **Hypertexture inside large spherical parcels** driven by parcel physics; later a precomputed **cloud map** noise texture governs cloud shape and cover, so physics only runs on a few parcels (200 fps landscape scale, Fig 16; the 200 fps figure is p.15) | p.2, p.13, p.15 |

### B. Physically based simulation (shape from dynamics; animation too)
| Paper [ref], year | One-line idea | Page |
| --- | --- | --- |
| Stam [90], 1999 | Stable fluids; semi-Lagrangian advection; base of all later grid clouds | p.11 |
| Dobashi, Kaneda et al. [15], 2000 | **Cellular automaton**: boolean humidity, cloud and phase-transition cells; ellipsoids steer shape and size; rendered as metaball billboards | p.10-11 |
| Harris et al. [38], 2003 | Full physical cloud sim (vorticity confinement) on GPU slices of 2D textures | p.12 |
| Miyazaki et al. [67], 2001; [64], 2002 | **Coupled map lattice** (CA plus Navier-Stokes), cloud type by initial conditions, Benard convection for some types; heat advection and phase transition added in 2002 | p.12 |
| Dobashi et al. [14], 2008 | **Feedback control**: user draws a target cumuliform contour; the difference plus a geometric potential force feeds back into the sim's growth | p.12, Fig 15 |
| Neyret [68], 1997 | **Bubbles** as buoyant parcels: attracted to neighbours, mix with the air, created and destroyed; vortices attached to each bubble add small-scale shape and motion | p.12-13 |
| Barbosa et al. [2], 2015 | Position-based fluids with **adaptive particles** that merge or split where cloud disappears or detail appears | p.13 |
| Elhaddad et al. [28], 2016 | Particles with Lennard-Jones forces | p.13 |
| Duarte and Gomes [24], 2017 | Parcels from **SkewT/LogP sounding data** (no PDEs); mesh from particles, rasterised to a **distance field plus noise parameters**, then raymarched | p.8, p.13 |
| Kusumoto et al. [54], 2012 | Keyframe target fields; controlled ground heat sources for buoyancy | p.10 |
| Stam and Fiume [91], 1995 | Diffusion of warped **blobs** each with temperature, density, velocity | p.6, p.12 |

### C. Particle, metaball and blob (shape from primitives; this is the multi-body family)
| Paper [ref], year | One-line idea | Page |
| --- | --- | --- |
| Elinas and Stuerzlinger [29], 2000 (after Gardner) | Ellipsoid primitives with controlled transparency | p.2 |
| Dobashi [17,18], 1998-99 | **Metaballs** fit to a single satellite image until the synthetic image matches within an error | p.3 |
| Bouthors and Neyret [6], 2004 | **Blob hierarchy**: child blobs placed on a parent; **field functions control size, overlap and bottom flatness** (Fig 2a) | p.3 |
| Hufnagel et al. [44], 2007 | Place flattened and textured metaballs per classified cloud type from weather forecast volumes | p.3 |
| Grudzinski and Debowski [36], 2009 | Particles with velocity, lifespan and max height give type-specific trajectories (stratus vs cumulus) | p.10 |
| Wang [98], 2003 | Particles textured per cloud type for about a dozen types | p.8 |
| Trembilski and Brossler [95], 2002 | Marching-cubes isosurface, refine, smooth sharp edges, displace vertices | p.2 |
| Miller, Museth et al. [62], 2012 | "Puss in Boots": **meshes plus procedural noise converted to sparse VDB** volumes | p.3, p.9 |

### D. Image-based, sketch-based
| Paper [ref], year | One-line idea | Page |
| --- | --- | --- |
| Wither, Bouthors, Cani [101], 2008 | **Sketched 2D silhouette**; infer a skeleton; spheres along it become the cloud (Fig 2b) | p.3 |
| Stiver et al. [92], 2010 | Sketch to a cloud mesh, fill with particles | p.3 |
| Dobashi, Shinzo, Yamamoto [19], 2010 | **Single photograph** to density; cirrus as 2D texture, altocumulus as 3D metaballs, cumulus as a **thickness map** (Fig 4) | p.4 |
| Yuan et al. [107], 2014 | Cumulus shape from one image assuming symmetry; height field from labelled pixels; front refined, back simplified; fill with particles | p.3 |
| Alldieck et al. [1], 2014 | Hemispherical sky image to a cloud mesh | p.3 |
| Yu and Wang [106], 2011 | 2D shapes to particles, 3D to tetrahedra, **morph** between source and target by medial axis correspondence | p.3 |
| Dobashi et al. [20,22], 2006-09; Yuan [108], 2013 | Satellite-image cloud modelling and earth-scale animation from user pressure maps | p.4, p.11 |
| Jhou and Cheng [47], 2016; Dobashi [17] | Animate from image cues: content-aware wind field (limited frame-to-frame variation); metaballs advected by flow curves read from satellite sequences | p.10 |

### E. Data-driven and data-assimilation
| Paper [ref], year | One-line idea | Page |
| --- | --- | --- |
| Iwasaki et al. [46], 2011 | **Endless cloud animation from limited volume data**: stochastically pick two similar volumes and cross-dissolve (video-texture idea in 3D) | p.12 |
| Kallweit et al. [49], 2017 | **Radiance-predicting neural networks** trained on exemplars for light transport only | p.9 |
| Hufnagel [44], 2007; Wenke [100], 2012; Griffith [35], 2010 | Real weather-forecast or LES data to cloud geometry | p.3, p.4 |
| Duarte and Gomes [24], 2017 | Sounding data in place of hand-set initial conditions | p.13 |
| (the survey's own pointer) | "artificial intelligence to animate clouds ... a promising direction" | p.15-16 |

## Method vs our four needs
Rating: **H** high value to us, **M** some, **L** little, **-** none. Basis is the one-line idea plus the existing notes; the survey itself gives no quality evidence for any method.

| Family | Cumulus shape realism | Multi-body / cluster scenes | Surface detail | Animated / evolving |
| --- | --- | --- | --- | --- |
| A. Procedural noise | M (Webanck types; Gardner lobes) | M (Webanck control function and morph) | **H** (Neyret 2000 surface Perlin; Schpok octave stack; Goswami hypertexture) | M (Schpok micro-level; Neyret advected textures) |
| B. Physical sim | M (Miyazaki, Dobashi 2008 give real cauliflower flanks, offline-grade) | **H** (bubbles attract and merge: Neyret 1997; adaptive particles merge and split: Barbosa) | L (small scale from vortices, Neyret 1997) | **H** (Neyret 1997, Goswami and Neyret 2017) |
| C. Blob/metaball | **H** (Bouthors and Neyret 2004: child blobs on parent, bottom flatness) | **H** (primitives union naturally; overlap field) | L (needs A on top) | M (blobs are advected cheaply) |
| D. Image/sketch | M (Dobashi 2010 cumulus thickness) | L | L | L (limited variation) |
| E. Data-driven | L (Iwasaki dissolve is a look-alike, not new shape) | - | - | M (Iwasaki endless evolution) |

Findings, from the above:
- **Surface detail** has exactly one detailed answer in this survey: noise added to a surface representation (Neyret 2000, Gardner, Schpok, Goswami hypertexture, and Bouthors 2008 which is cited only for lighting here). That is the Perlin/hypertexture lineage; see `bou08.md` for what Bouthors 2008 actually specifies.
- **Multi-body** has two ideas: (i) blobs/primitives with overlap and bottom-flatness fields (Bouthors and Neyret 2004); (ii) bubbles/parcels that attract, merge and split (Neyret 1997, Goswami and Neyret 2017, Barbosa 2015). The survey shows no paper that renders several already-formed cloud bodies **touching** and sharing detail; "cumulus clusters merging to stratocumulus" is only in the Nubis 2017 deck [N17 p.18], not here.
- **Evolving** has: parcel physics with a noise amplifier (Goswami and Neyret), bubble sim (Neyret 1997), cellular automata (Dobashi 2000), morph (Webanck), cross-dissolve (Iwasaki), and advected textures (Neyret 2003). The last is the one that fixes "detail slides through the cloud instead of moving with it".

## Our runtime against these families (cite file:line)
- **A. Procedural noise:** the whole `packages/runtime/src/procedural/` path is family A (weather map plus noise erosion; erosion pass `density.wgsl.ts:117-127`, detail near camera `:216-225`). The voxel path is family A baked offline (`shaders/density.wgsl.ts:47-65`).
- **B/E evolving:** `generate/evolution.ts:1-12` is a **cellular, weather-map-driven life cycle** (cells grow, mature, dissipate, restart elsewhere; wind advects the map; double-buffered NVDF regeneration every `cadence`). That is closest to Dobashi 2000 (CA) and Webanck-style morphing, **not** a buoyancy/bubble model. No interaction between cells (no merging forces); "merges" in the header is the overlap of Worley cells on the map.
- **C. Blobs:** `generate/passes.ts:195` builds a tower as "a cluster of eight turrets (updraft pulses) around a core, each a column that widens toward its own rounded top". That is a small blob hierarchy (parent core, child turrets). There is **no field-function control for size/overlap/bottom flatness** as in Bouthors and Neyret 2004, and no second level of children on the turrets (billows are noise, not blobs).
- **Clusters:** `generate/shaders.ts:234-238` has a cluster fbm saying where clouds gather and scaling cell size by it ("big cells only in cluster cores, small ones out to the rims"). That is a multi-body *placement* rule (useful, and what Webanck's control function is for) but gives no interaction between bodies.
- **D/E:** nothing (no sketch, no photo-to-shape; the cloud-photo library is used as a reference set only).

## Ranked fetch list (papers we do not have; checked against `README.md`, `TRACKING.md`, `procedural-shape.md` section 5)
Nothing downloaded. Order = value to **shape, layering, surface detail** first, then multi-body and evolving. `Have` = already local.

| Rank | Paper | Why it matters | Likely access |
| --- | --- | --- | --- |
| 1 | **Bouthors and Neyret [6]**, "Modeling Clouds Shape", Eurographics short papers 2004 | The only shape **grammar** in the survey: blobs on blobs with field functions for size, overlap and bottom flatness. Directly addresses cumulus realism (lobes on lobes, flat base) and multi-body (overlap field). Already #4 in `procedural-shape.md`; I rank it first for the owner's "shape and layering" weakness | HAL / Eurographics digital library; short paper, a few pages |
| 2 | **Neyret [69]**, "A phenomenological shader for the rendering of cumulus clouds", INRIA RR-3947, 2000 | Surface-detail recipe for cumulus: noise on the surface, Lambertian corona versus scattered core, light-trap concavities. A rare description of why the **rim looks the way it does**; not in any note | INRIA HAL tech report (free) |
| 3 | **Goswami and Neyret [34]**, "Real-time landscape-size convective clouds simulation and rendering", VRIPHYS 2017, plus **Goswami [32]**, "Interactive animation of single-layer cumulus clouds using cloud map", Smart Tools and Apps for Graphics 2019 | Evolving cumulus on a landscape: macro parcels, hypertexture amplifier, and a **cloud map that replaces direct volume amplification** (200 fps). Covers shape, evolution and horizon cost in one line of work. `procedural-shape.md` calls the 2019 paper "2018, A novel approach ..."; the survey cites it as 2019 with the title above, so verify the title when fetching | Authors' pages, Eurographics DL |
| 4 | **Ebert**, "Volumetric modeling with implicit functions: a cloud is born", SIGGRAPH Visual Proceedings 1997 (and the cloud chapter of *Texturing and Modeling*, 3rd ed.) | The procedural implicit-sphere-plus-turbulence recipe that has real code in the book; the ancestor of ours | Book; the 1997 abstract is on Ebert's site |
| 5 | **Perlin and Hoffert**, "Hypertexture", SIGGRAPH 1989 | The origin of `S(D + noise)`; short; defines the density-shaping functions that Bouthors names but does not specify (the sigmoid, the "bias/gain" style operators) | ACM DL (paywalled), widely mirrored |
| 6 | **Neyret [70]**, "Advected textures", SCA 2003 | Detail that **moves with the flow** without stretching (layers, mip-like blend by deformation). Our weakest animation point is detail sliding through the cloud (`cloud-motion-ideas.md`) | HAL (free) |
| 7 | **Schpok et al. [87]**, "A real-time cloud modeling, rendering, and animation system", SCA 2003 | Octave-stack noise as GPU textures; macro/micro animation with "wisps straying away" and edge appearance/disappearance; user-facing noise filter presets (authoring) | ACM DL |
| 8 | **Neyret [68]**, "Qualitative simulation of cloud formation and evolution", EG Workshop on Computer Animation and Simulation 1997 | Bubbles that attract, mix and spawn vortices for small-scale shape; the cheapest published **multi-body interaction and evolution** model, 2D | HAL (free) |
| 9 | **Duarte and Gomes [24]**, "Real-time simulation of cumulus clouds through skewT/LogP diagrams", Computers and Graphics 2017 | Particles to mesh to **voxelised distance field with noise parameters**, then raymarch: the pipeline closest to our voxel SDF path, and a way to make several bodies from one parcel set | Journal (paywalled) |
| 10 | **Miller, Museth, Penney, Zafar [62]**, "Cloud modeling and rendering for Puss In Boots", SIGGRAPH Talks 2012 | Production recipe: modelled meshes plus procedural noise into sparse VDB; relevant to the VDB artist-cloud path (`vdbs/`). A talk, so only a short abstract | ACM DL |
| 11 | **Barbosa et al. [2]**, "Adaptive cloud simulation using position based fluids", CAVW 2015 | Particles that **merge and split** with detail demand; model for body-merge and LOD in one rule | Journal |
| 12 | **Webanck et al. [99]** | `Have` as `web18` (RS-3 note); the morph section (optimal-transport primitive pairing) is the only evolving-shape method that fits a procedural system; make sure `web18.md` covers it | local |
| 13 | **Dobashi et al. [19]**, "Modeling of clouds from a single photograph", CGF 2010 | Photo to cirrus 2D / altocumulus metaballs / cumulus thickness; fits our photo library as an authoring-from-reference idea | Journal |
| 14 | **Wither, Bouthors, Cani [101]**, "Rapid sketch modeling of clouds", SBIM 2008 | Sketch silhouette to skeleton to spheres: a fast authoring input for a hero body | EG DL |
| 15 | **Iwasaki et al. [46]**, "Real-time rendering of endless cloud animation", Pacific Graphics short 2011 | Cross-dissolving similar volumes is the data-driven answer to evolving clouds from a finite capture; could drive our 512x512x64 NVDF swaps | PG proceedings |
| 16 | **Dobashi et al. [14]**, "Feedback control of cumuliform cloud formation based on CFD", TOG 2008 | Offline CFD steered to a target shape; reference for what "physically grown cauliflower" looks like; low runtime value | ACM DL |
| 17 | **Kallweit et al. [49]**, "Deep scattering", TOG 2017 | Lighting only; lowest value now (lighting is parked) | ACM DL |

Not in the survey but obvious gaps for the same list: Hillaire's TileableVolumeNoise (code) and Crassin and Neyret 2007 (French master's thesis cited by Bouthors for the distance-field voxelisation; likely unobtainable and superseded by GigaVoxels).

**Top 5:** (1) Bouthors and Neyret 2004, (2) Neyret 2000 phenomenological shader, (3) Goswami and Neyret 2017 with Goswami 2019, (4) Neyret 2003 advected textures, (5) Neyret 1997 bubbles. Four of five are Neyret's group, which is the one lineage in the survey that treats cumulus shape as a grammar rather than a noise recipe.

## What we already do / don't / try
- **Do:** noise-eroded weather-map shapes (A), cluster-gated cell sizes, a tower of turret columns (C, partial), a life-cycle evolving map with double-buffered regeneration (CA-like).
- **Don't:** blob hierarchy with size/overlap/bottom-flatness fields; any interaction between bodies; detail advected with flow; any photo/sketch shape input; surface noise in metres on the SDF (see `bou08.md`).
- **Try next:**
  1. Add a second child level to the tower pass (billows as sub-blobs on each turret) with a bottom-flatness term; source: Bouthors and Neyret 2004 once fetched, idea already at survey p.3 (`generate/passes.ts:195`).
  2. Give overlapping turrets/bodies a shared smooth-union density so two bodies fuse at the seam (family C overlap field), instead of independent densities. (Where our voxel and procedural layers overlap, `procedural/trace.wgsl.ts:18` adds them as a plain union; I did not check how same-layer bodies combine.)
  3. Advect the billow noise anchor with the cloud's own motion (Neyret 2003 idea); the evolution code already anchors noise to a voxel-snapped wind offset (`generate/evolution.ts:8-12`), so the remaining gap is per-body motion, not global wind.
  4. Port Neyret's rim rule (corona Lambertian, concave light traps) as a rim-lighting term only after the shape work; lighting is parked.
  5. Write the Webanck morph into the evolution scheduler as an alternative to restart-elsewhere; check `web18.md` first.

## Superseded by / supersedes
Adds to `legacy-and-survey.md` (GS section, which answers five narrow questions) and the fetch table in `procedural-shape.md` section 5 (items 3-6, 9-11 of that table are re-ranked here; new entries: Neyret 2000, Neyret 1997, Duarte and Gomes 2017, Barbosa 2015, Miller/Museth 2012, Wither 2008, Iwasaki 2011, Dobashi 2008). Corrects one detail there: Goswami's cloud-map paper is [32], 2019, titled "Interactive animation of single-layer cumulus clouds using cloud map".

## Review (Opus spot-check, 2026-10-10)
- Sakas turbulence split `u = U + u'` [p.9] → ✘ fixed (render shows `u = Ū + u'`, Ū the general translative velocity; formula and symbol meanings now given; modelling mention is p.2, not p.3)
- Neyret [69] RR-3947 2000: Perlin noise on the surface, Lambertian corona, light-trap concavities [p.2, p.5] → ✔ content; ✘ fixed page (p.3 → p.2)
- Bouthors and Neyret [6] 2004 blob hierarchy, field functions for size, overlap, bottom flatness [p.3, Fig 2a] → ✔
- Goswami [32] 2019 "Interactive animation of single-layer cumulus clouds using cloud map" and [34] VRIPHYS 2017; 200 fps [p.13 Fig 16, p.15, ref list p.16-17] → ✔ titles/years; ✘ fixed page (p.3 → p.2; 200 fps also stated on p.15)
- Family A/B/C/E page refs → ✘ fixed: Hasan/Xu, Webanck, Schpok, Ebert, Trembilski p.3 → p.2; Dobashi 2008 and Iwasaki 2011 p.13 → p.12; Neyret 1997 p.13 → p.12-13; Stam and Fiume p.8, p.13 → p.6, p.12; Duarte and Gomes p.9 → p.8
- Ebert [25] "sphere union plus turbulence" [p.2] → ✘ fixed (survey only says procedural volumetric implicit function; recipe now attributed to Ebert's book)
- [29] attribution [p.2] → ✘ fixed ("Gardner/Elinas" → Elinas and Stuerzlinger, after Gardner)
- Fetch-list refs [6], [24], [32], [34], [46], [62], [68], [69], [70], [87], [99], [101] titles, venues, years [ref list] → ✔
- Journal page = PDF page + 1930 [p.2 header 1932, p.18 header 1948] → ✔
- Runtime `generate/passes.ts:195` tower of eight turrets around a core → ✔ (line 195 is that comment)
- Runtime `procedural/trace.wgsl.ts:18` voxel and procedural densities add as a union → ✔
- Runtime `generate/evolution.ts:1-3, 8-12` life cycle and voxel-snapped wind anchor → ✘ fixed (grow/mature/dissipate is lines 4-6; cited as `:1-12`; `:8-12` for the wind anchor in try-next 3 is ✔)
- Runtime `generate/shaders.ts:234-238` cluster fbm gating cell sizes, and `procedural/density.wgsl.ts:117-127` erosion → ✔
- Try-next items framed against Takram/Sky Pro → ✔ none; all cite the papers
