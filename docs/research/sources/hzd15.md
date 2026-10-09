# The Real-time Volumetric Cloudscapes of Horizon Zero Dawn (Schneider and Vos, SIGGRAPH 2015 Advances)
Local: `artifacts/research/papers/The Real-time Volumetric Cloudscapes of Horizon - Zero Dawn - ARTR.pdf` · dump `artifacts/research/extracted/hzd15/` · Tags: shape layering detail weather perf storm(no) · Status: 🟦 note written (no code in the source; 6 formula slides transcribed, see below)

Citations: **[sNN]** = printed slide number (what `hzd-nubis-evolved.md` and `procedural-shape.md` use); **(pNNN)** = PDF page of the ARTR file. Mapping: page = slide + 1 for slides 3 to 20; slides 2 and 21 each take two pages (p002/p003, p022/p023); page = slide + 2 for slides 22 to 97. Slide image for page N is the jpeg in the PDF (1199 x 674); the notes text is under it.

This is the **talk**, not the chapter. GPU Pro 7 (`gp7`, the written version with the code) now has its own note (`gp7.md`); this note was written before it and does not repeat it. The PDF has **no code and no numeric constants for the gradients or noise frequencies**; every number below is either printed on a slide, in the notes, or measured from a slide image (and marked as measured). Lighting and the 1/16 reprojection are already well covered in `hzd-nubis-evolved.md` (sections 3 and 4), so they get a short pointer here only.

## In one paragraph
A 30-minute talk by Andrew Schneider (FX) with Nathan Vos (tech): the first public look at Guerrilla's ray-marched sky for Horizon Zero Dawn. The claim: **2 ms on PS4, 20 MB of RAM [s1]**, replacing all asset-based skies (billboards, domes) from Killzone. What the deck adds that the later decks and the chapter do not: the **R&D history of rejected approaches** [s8 to s18], the **cloud-type taxonomy figure and the 1961 meteorology rules** the shape model is derived from [s20, s21], the **explicit critique of fBm-over-a-gradient** with photo comparisons [s24 to s27], the **noise slices** for the three textures [s29 to s33], the **three drawn height gradients** [s34], the **in-game weather minimaps and the artist override panel** [s38 to s46], the **painted weather for cutscenes** [s47], and the **spherical-shell diagrams** [s71 to s74].

## Key ideas (the shape and layering reasoning, with where it is shown)

### R&D history: why a procedural volume (all new relative to our notes)
- Killzone skies were hand-placed billboards and Photoshop domes built by one artist from stock photos, lighting pre-baked because time of day was static [s2, s3]. Horizon has an open world, a time-of-day cycle, weather, and skies that are "half of the screen" [s5]. Goals: art-directable, realistic, multiple cloud types, integrated with weather, **evolving over time**, "epic" [s7].
- **Attempt 1: custom fluid solver to grow clouds** [s9, p010 to p011]. Good results, but unusable by artists without fluid-sim experience. **Attempt 1b:** model clouds from simple polygon shapes, voxelise, run the fluid solver on them until they look like a cloud [s10, p012: a Houdini viewport cumulus]. This is the same family as Nubis Cubed's fluid-sim sources, so it is the root of that pipeline.
- **A lighting model for those assets**: primary and secondary scattering precomputed, "computed on the cpu in Houdini in 10 seconds" [s11, p013].
- **Three ways to put assets in game** [s12 to s14]: (1) polygons from the sim with spherical-harmonic baked lighting: works for thick clouds only, not wispy ones; (2) billboards with multiple orientations and times of day: no inter-cloud shadowing; (3) all voxel clouds rendered as one set to produce skydomes that blend into atmosphere with depth: "sort of worked". Verdict [s14]: none evolve over time, none let clouds pass overhead, all cost memory and overdraw.
- **Voxel clouds, "not popular with the programmers"** [s15, p016]: concerns were texture reads, ray marches, nested loops. Counter: proven volume-lighting methods and PVR-course noise-modelled clouds exist.
- **Prototype 1**: a stack of polygons in front of the camera sampling 3D Perlin: slow but promising, only bandy clouds [s16]. **Prototype 2**: tiling 3D textures out of the sim shapes, a Houdini GL shader for the cloud and lighting model [s17, p019 shows photograph vs shader side by side for a cumulus field]. With "a LOT of hacks" it matched the reference, **but fell apart once in motion**, and took **1 second per frame** [s18]. Conclusion that defines the system: instead of predetermined shapes, make **good low-resolution noises with the right character and blend between them by rules**.
- Take-away for us: the deck's whole premise is that **shape comes from rules over generic noises, and motion/evolution is the test**. Static similarity to a photo was achieved first and thrown away because it did not survive animation.

### Cloud taxonomy and the physical rules the model abstracts [s20, s21]
- **Figure (p021):** a silhouette chart of ten genera on an altitude scale with 1500 m, 4000 m, 8000 m (Everest marked at its summit, just above 8000 m). Left to right, bottom to top: **stratus, stratocumulus, cumulus** (all with bases at the 1500 m line or below, low and flat to domed), **altostratus, altocumulus** (between 1500 and 4000 m, a thin sheet and a row of small puffs), **cirrostratus, cirrus, cirrocumulus** (above 4000 m: a thin sheet, a hooked wisp, a line of speckles). **Cumulonimbus** is drawn as one tall column from 1500 m to above 8000 m with an anvil plate at the top; it dwarfs everything else. The grouping on the slide is "strato" (stratus, cumulus, stratocumulus), "alto", "cirro", plus cumulonimbus; it **defines where each is drawn** [s20 notes].
- **Eight rules from *The Clouds* (Clausse and Facy, 1961)** [s21, p022 book cover], listed as abstractions for modelling: density increases at lower temperature; temperature falls with altitude; high densities precipitate as rain or snow; wind direction varies with altitude; clouds rise with heat from the earth; dense regions make round shapes as they rise; light regions diffuse like fog; atmospheric turbulence distorts them. The mapping onto the system, spelled out nowhere but implied: wind varies with altitude gives the height skew (and the per-layer wind of the 2D layers); round dense tops and wispy diffusing bases give the billowy-top / wispy-bottom noise split; turbulence gives the curl distortion; precipitation gives the dark rain-cloud rule and the cumulonimbus override.

### Why fBm over a gradient looks procedural, and what the replacement must supply [s24 to s28]
- The "standard" approach (ShaderToy-style): layered Perlin fBm in a height zone above the camera, times one gradient [s24, p026 diagram, p027 and p029 are ShaderToy viewport captures]. Critique, in the notes [s25]: **"no larger governing shapes or visual cues as to what is actually going on"**, so the evolution of the cloud is not implied by its shape.
- Contrast photograph [s26, p028]: cumulus rising "like puffs of steam from a factory", **round shapes at the tops, wispy shapes at the bottoms**. [s27, p029] adds "Nice whispy shapes" as the one good thing fBm gives. What fBm lacks are the **bulges and billows** [s28 note, p030 aerial photograph of packed cauliflower cumulus]. This is the visual target statement for shape: packed, cauliflower, bulging tops.
- Fix: layered **Worley, inverted** gives "tightly packed billow shapes" [s29, p031 shows a Worley slice: packed rounded cells with dark gaps]; used as a dilation offset of Perlin to keep Perlin's connectedness: "Perlin-Worley". Formula source in `procedural-shape.md` M1 (N17 s34).

### Noise set and what each texture's slices look like (figures, not code) [s30 to s33]
- Rationale: "keep texture reads to a minimum and resolutions as small as possible" [s30, p032]. Result: **2 x 3D + 1 x 2D**.
- **3D texture 1** [s31, p033]: 4 channels, 128^3. Slice figure: one soft, blotchy Perlin-Worley tile plus **three Worley tiles with visibly rising cell frequency** (large cells, medium, fine). Role: base shape.
- **3D texture 2** [s32, p034]: 3 channels, **32^3**, "3 Worley" at increasing frequency. The slice tiles are visibly **chunky** (each texel is a large square in the slide), which tells you the detail noise is deliberately low-res and relies on bilinear filtering plus a high tiling rate (the tile repeat is not given). Role: edge erosion.
- **2D texture** [s33, p035]: 3 channels, 128^2, "3 curl noise dims": three high-contrast turbulent greyscale tiles, dark/light swirl structure. Role: distort the detail lookup (fake turbulence).
- Memory: this set is ~8 MB as RGBA8 (128^3 x 4) plus ~0.1 MB for the detail and ~0.05 MB for the curl, so the **"20 MB RAM" [s1] is not the noise alone**; it is noise plus buffers (the reprojection history and quarter-res targets). The deck does not break it down.

### Height gradients: the three drawn presets [s34, p036]
- Slide text: "3x Mathematical", "Blends based on cloud type", and a separate **"Coverage Signal"** drawn as a 0-to-1 linear ramp. The three swatches are labelled stratus, cumulus, cumulonimbus, drawn as vertical strips (top of strip = top of the layer).
- **Measured from the slide image** (300 dpi crop, sampled down the centre of each strip, height fraction h from the base; accurate to about +-0.05, not source numbers):
  - **Stratus**: a thin band only, rising from h 0 to a peak at about 0.07 and gone by about 0.09 (review re-measure on the embedded 1199x674 jpeg; the first draft said 0.05 to 0.15), empty above.
  - **Cumulus**: ramps 0 to 1 over h ~0.05 to 0.20, plateau to ~0.40, falls to 0 by ~0.60. So the top 40% is empty and the fall is soft.
  - **Cumulonimbus**: ramps 0 to 1 over h 0 to ~0.10, plateau to ~0.75, falls to 0 at ~0.98. Dense nearly the whole height with a soft top.
  - All three have **soft, smooth ends at both sides (smoothstep-like), not hard cuts**.
- They are blended at the sample point by the cloud-type value [s34 note]; no constants in the talk. The three swatches are **the same images as GPU Pro 7 Fig 4.10** (`gp7.md`, measured independently to the same stops within 0.01-0.02), and the chapter has no constants either. The shipped HZD curves differ: see the cross-note comparison in the review section.

### The density build, with the exact slide formulas [s35 to s37, p037 to p039]
- [s35, p037] the slide draws: `SetRange( noiseTexture1 x heightGradient ) x coverage x baseFadeGradient`, where the last gradient is a vertical ramp from dark at the bottom to bright at the top (so it **suppresses density at the bottom**, the "reduce density at the base" in the bullet). The notes: this "ensures that the bottoms will be whispy and increases the presence of clouds in a more natural way", and "density increases over altitude" [s36 note].
- [s37, p039] erosion line: `base cloud shape (edges) - ( detail noise x curl noise )`: the curl tile is drawn **multiplying the detail slice** in the slide; the notes say the curl **distorts** the detail lookup. (Read the figure as distort-by-lookup, as `procedural-shape.md` M5 does; the slide's multiply sign is the artist's notation, not a literal shader line.)
- Tip repeated for emphasis: invert the Worley at the base for wisps [s37 note].
- [s38 note] Demonstration: coverage is raised to thicken clouds, then the height gradient is moved from cumulus to stratus, in game.

### Weather: what the maps look like and how they are driven [s38 to s47]
- **The artist override panel [s38, p040]** lists the weather system's **inputs**: wind direction, wind speed, **precipitation**, wetness, temperature (shown 20.00), humidity, **cloud density** (being dragged, 0.10), **cloud type** (1.00), **cirrus density** (0.70), plus a "PBD MaxDistance tweak". So the sky consumes three cloud controls from the sim (coverage = "cloud density", type, precipitation) and **cirrus density is a fourth, separate control for the 2D layer**. (Not in any other note.)
- **Bias ranges [s40 to s42, p042 to p044]**: "Coverage +-.5, Type +-1, Precipitation +-1" (and 0 for precipitation on [s41, p043]). These are the artist **offsets** applied over the sim's output.
- **Weather minimap [s40 to s46, p042 to p048]** (lower-left inset, a square region map centred on the player, white arrow = player/wind). Colours: red coverage, green precipitation, blue type. Appearance:
  - The default map is **magenta/pink** (R and B high, G low: coverage with cumulus type), broken by **blobby irregular patches**: red-only patches (coverage with low type = **stratus**), white patches (all three high = **precipitation, cumulonimbus at 70% coverage** [s42 note]), and yellow/orange edges (R+G, low type, some precipitation). The patches are **cell-like clusters at a mix of sizes**, with ragged boundaries, not smooth noise; large smooth magenta regions between them. [s45, p047] shows the same map with the inset's status text: "DefaultWeatherSetup, Time of day 13.67, Wind 4.83 m/s, Precipitation 0.04".
  - [s43, p045]: the same sky with precipitation 0 shows an almost all-magenta map with a few red lumps: that is the "default combination of cumulus and stratus" [s41 note].
  - [s44 and s45 videos] show a storm rolling in: wind raised, precipitation chance raised, white regions grow from the upwind side.
- **Horizon ring [s45, p047 diagram]**: black disc, "Player" at the centre, a **15,000 m** mark, a **20,000 m** span marking the transition band (15 to 35 km), and **35,000 m** radius. Beyond 15 km, coverage is pulled toward about 50% and type toward cumulus: horizon clouds "poke above mountains" [s43 note]. Only the number list is in `hzd-nubis-evolved.md`; the diagram adds that the disc shades from dark at the centre to light grey at the rim, which I read as the override weight rising toward 35 km (interpretation; the slide has no legend).
- **Painted weather for the E3 trailer [s47, p049]**: the inset is a **smooth, hand-painted two-colour gradient** (purple on the left blending to red on the right, soft S-shaped boundary). So cutscene skies are not noisy weather maps; they are art-directed **gradients of coverage versus type** across the view. This is the 2015 form of "paint your own NDF".

### Rendering geometry and layering [s71 to s74, s77 to s83, p075 to p083]
- Earth is round: "clouds exist in different layers of the atmosphere" [s71 note, p073 diagram: a ringed Earth]. [s72, p074] photograph of a sunset sea horizon with dark layered cumulonimbus and thin altocumulus bands descending into the horizon.
- [s73, p075] diagram: **volumetric (stratus, cumulus) 1500 m to 4000 m, and 2D (alto, cirrus) above 4000 m**; "The Earth" below. [s74, p076] the sky as a **curved shell of cloud blobs seen in section, with a horizon line cutting through the ring** (clouds descend into the horizon, scale is controllable by shrinking the planet radius).
- **Layering decision**: only **two** layers: one volumetric layer (all three low types in the same 1500 to 4000 m shell, distinguished by type gradient) and one flat 2D layer for alto and cirro. Cumulonimbus is **not** a separate layer; it is the precipitation-driven override of the volumetric shell [s42]. No separate stratus layer, no mid layer.
- **Iso-surface diagrams [s77 to s82, p079 to p083]**: a cloud with an inner contour: "Density != 0" inside the contour of the low-detail noise and "Density = 0" outside; detail is only computed inside it; the ray steps back one coarse step on entering; empty-run counter drops back to cheap steps. [s81, p083] shows 64 samples straight up and 128 toward the horizon (the sample budget grows with the ray length).
- **Light-cone diagram [s83, p085]**: six taps in a cone toward the sun, the last far away; a second tiny cloud on the right marks the "shadow from a distant cloud".

### 2D high layer [s84 to s87, p088 to p089]
- Last step of the march [s85]. [s87, p089] three tiling greyscale textures, left to right: **fibrous streaky cirrus** (long horizontal fibres), **patchy altostratus-like** sheet with soft dark lanes, **fine speckled altocumulus** cells. They are scrolled at different speeds and directions. Same three classes as NE's `cr_streaky / cr_wispy / cr_round` (`hzd-nubis-evolved.md` 1.2).

### Timings and budget figures stated in the talk
| Item | Figure | Where |
| --- | --- | --- |
| Final cost | ~2 ms, 20 MB RAM, PS4 | [s1], [s93] |
| Unoptimised ray-march sky | ~20 ms | [s91 note] |
| Houdini prototype | 1 s per frame | [s18 note] |
| Precomputed cloud lighting (early asset pipeline) | 10 s on CPU in Houdini | [s11 note] |
| Reprojection (1 of 16 pixels per 4x4 block, quarter-res) | "10x faster or more" at half-res + upscale filters | [s92, s93 notes] |
| Light samples cheap after alpha 0.3 | 2x faster | [s84 note] |
| March samples | 64 straight up to 128 at horizon, 6 light taps | [s81], [s83] |
| Cloud range / layers | 35,000 m radius; volumetric 1500 to 4000 m; 2D above 4000 m | [s45], [s73] |

## Formulas and constants (exact, as printed; no code)
| Slide (page) | Content |
| --- | --- |
| [s35] (p037) | `SetRange(shape3D x heightGradient) x coverage x baseFadeGradient` (thumbnail form) |
| [s37] (p039) | `base shape(edges) - (detail x curl)` (thumbnail form) |
| [s52] (p054) | Beer: `T = e^-t` |
| [s55] (p057) | `Energy = e^-d * HG` (no `g` given) |
| [s61 to s62] (p063, p064) | Beer `E = e^-d`; Powder `E = 1.0 - e^(-d*2)`; the "Beer's-Powder" curve is their product (plot: starts at 0 at the surface, peaks at a shallow depth, decays) |
| [s69] (p071), [s85] (p087) | `Energy = e^(-d*r) * HG * P`; **r** raises absorption for rain clouds, **P** is powder |
| [s34] | height gradients: 3 presets blended by type; swatches measured above |
| [s38 to s42] | override ranges: coverage +-0.5, type +-1, precipitation +-1 |
| [s45] | 15,000 m start, 35,000 m radius, 50% coverage target of the horizon override; [s73] 1500 and 4000 m |
| [s77 to s83] | 64 to 128 march samples; 6 light taps (5 near + 1 far); cheap light at alpha 0.3 |

Not given anywhere in the deck: noise frequencies, Perlin-Worley remap, FBM weights, curl strength, the gradient constants, `g` for HG, the powder view-dependence formula, weather-sim equations, any coverage exponent. (Several of these are in the chapter; see "Superseded by".)

## Code listings (slide/page to local file in `extracted/hzd15/code/`)
There are **no code listings** in this source (the slides carry formulas as images; the notes carry prose). The six formula slides above are transcribed so the formulas are reachable:
- p037 (s35) to `hzd15-p037.hlsl`: density build line.
- p039 (s37) to `hzd15-p039.hlsl`: erosion line.
- p054 (s52) to `hzd15-p054.hlsl`: Beer.
- p057 (s55) to `hzd15-p057.hlsl`: Beer times HG.
- p063/p064 (s61, s62) to `hzd15-p064.hlsl`: Beer, Powder, Beer's-Powder.
- p071/p087 (s69, s85) to `hzd15-p071.hlsl`: final energy with rain absorption.

## Best shape figures (for the topic-guide author)
Slide image = the jpeg embedded in the PDF page (extract with `pdfimages -j -p`); pages with no embedded image (p003, p005, p010, p011, p014, p016, p023, p024, p026, p036, p037, p054, p057, p063, p071, p073, p083, p087, p088, p094) are vector slides: render the page.
| Page (slide) | What it shows | Use |
| --- | --- | --- |
| p021 (s20) | **Cloud genera silhouette chart on a 1500/4000/8000 m axis** | species to altitude map; the canonical type diagram |
| p028 (s26), p030 (s28) | Photos: cumulus rising like steam, round tops / wispy bases; aerial packed cauliflower cumulus | target look for tops and billows |
| p027/p029 (s25, s27) | ShaderToy fBm clouds | what "procedural-looking" means (negative reference) |
| p031 (s29) | Worley slice (inverted: packed bulbous cells) | billow source |
| p033 (s31) | **3D texture 1 slices: Perlin-Worley + 3 Worley at rising frequency** | hierarchy of lobe sizes in one texture |
| p034 (s32) | **3D texture 2 (32^3) slices, chunky** | detail resolution |
| p035 (s33) | Curl 128^2 tiles | distortion field |
| p036 (s34) | **Stratus / cumulus / cumulonimbus height gradient swatches + 0..1 ramp** | profile shapes (measured above) |
| p037, p038, p039 (s35 to s37) | Build steps with in-game result, shape then base fade then erosion | step-by-step density build |
| p042 to p048 (s40 to s46) | **Weather minimaps (R cov, G precip, B type) with the matching sky** | map structure vs result |
| p040 (s38) | Weather override panel (wind, precipitation, wetness, temperature, humidity, cloud density, cloud type, cirrus density) | authoring parameters |
| p047 (s45) | 15/20/35 km ring | far-field variety |
| p049 (s47) | Painted cutscene weather gradient | art-directed skies |
| p075, p076 (s73, s74) | Layer section and curved ring with horizon line | layering and curvature |
| p079 to p083 (s77 to s81) | Iso-surface and cheap-march diagrams, 64/128 samples | march structure |
| p089 (s87) | Three 2D cirrus/alto textures | high-layer set |
| p062 (s60), p066 (s64), p067 (s65) | Photos of dark crevices vs bright bulges; Houdini Beer vs Beer-Powder cumulus | dark-edge look on billows |
| p012, p013, p018, p019 (s10, s11, s16, s17) | Houdini/GL fluid-sim cumulus, voxel cloud box, shader vs photo | reference look for the simulated cumulus |

## What we already do / what we don't / what to try
Citations are to `packages/runtime/src/procedural/` (the Takram and Sky Pro ports) unless noted; the HZD-faithful chain is still **not** what we run.
- **Height gradients [s34]**: we use one fixed semicircle per layer (`density.wgsl.ts:178-181`, `procShapeAltering`, `bias` from `P.tkBias`); HZD blends **three separate profiles by type at the sample point**, where the measured cumulus profile is a **plateau with a soft top (top ~40% empty)** and cumulonimbus is almost full-height. A semicircle peaks and falls on both sides, so it cannot give cumulus its flat full-density band or cumulonimbus its full column. Replace with the type-blended trapezoid (see `procedural-shape.md` M2).
- **Base fade [s35, s36]**: HZD multiplies coverage by an explicit base-fade gradient. We have `procLayerDensity` (`density.wgsl.ts:201-203`, `a exp(b h) + c h + d`) after erosion, which is a similar effect but applied to the eroded density, whereas HZD applies it **before** erosion so the base also gets eroded harder (the "whispy bottom" mechanism). Reordering is cheap.
- **Coverage as input [s34, s40]**: our coverage multiplies the gradient inside the remap threshold (`density.wgsl.ts:194-196`; `factor` at 195), Takram's inflation form; HZD's slide form is a direct multiply. Not a contradiction (N17 s40 gives the remap form), just note that the slide only shows the multiply.
- **Detail [s37 and note]**: base-inverted detail exists (`density.wgsl.ts:218-223`, `pow(detail, 6)` below hf 0.2, `1 - detail` above 0.4) and is distorted by turbulence, but our turbulence is applied to **both shape and detail** (`density.wgsl.ts:212, 214, 219`, `(wp + turb)`), whereas the slide applies the curl only to the **detail** lookup. This is the likely cause of torn silhouettes under strong turbulence.
- **Noise channels [s31 to s33]**: HZD uses 4 shape channels and 3 detail channels; we read only `.r` of each (`density.wgsl.ts:214, 219`). The slice figures show the other channels are the **hierarchy of lobe sizes**, which is exactly the missing multi-scale billow structure.
- **Weather map [s38 to s47]**: we have four coverage channels, one per layer (`procWeatherChannels`, `density.wgsl.ts:182-187`), and no **type** or **precipitation** channel, no **far-field override ring** (`15 to 35 km` toward 50% cumulus), no **painted-gradient** mode for cutscenes, and no separate **cirrus density** control. Sky Pro's horizon coverage ramp (`spHorizon`, `density.wgsl.ts:52`) is the same idea as the ring but one-sided.
- **Marching [s77 to s83]**: our march already follows this structure (`trace.wgsl.ts:24-29`, coarse 4x steps, a step back, fine steps, back to coarse after four empty steps, cone light taps, cheap density for taps; far taps at `trace.wgsl.ts:253-262` follow the "last sample far away" idea). Nothing to add here.
- **Layering [s73]**: HZD has exactly two layers (volumetric low, 2D high) and expresses cumulonimbus as a precipitation override of type and coverage. We have four independent layers, one weather channel each, no continuous type. The HZD structure is the simpler one to match first.

**Top 5 "try next" (shape, layering, detail):**
1. **Type-blended profile replacing the semicircle** [s34]: three trapezoids (stratus thin base band 0 to ~0.09, cumulus plateau 0.2 to 0.4 with soft fall to 0.6, cumulonimbus 0.1 to 0.75 with soft top to ~0.98, all with smooth ends), blended by a type value from the weather map's blue channel.
2. **Use all shape and detail channels** [s31, s32]: Perlin-Worley dilated by weighted Worley octaves, and the 3-channel detail sum, in place of `.r` only (`density.wgsl.ts:214, 219`).
3. **Apply the base-fade gradient before erosion** [s35 to s37], and **curl only on the detail lookup** [s37], so the base gets ragged and the silhouette stays intact.
4. **Add a type channel and the precipitation-to-cumulonimbus override** [s40 to s42, s39]: R coverage, G precipitation, B type; precipitation above a threshold pushes type to cumulonimbus and coverage to ~0.7. One more weather lane, no new layer.
5. **Far-field variety ring** [s45]: from 15 km to 35 km fade the weather toward ~50% coverage and cumulus type so the horizon never empties; plus a **painted-gradient weather mode** [s47] for hero shots, modelled on the smooth two-colour image shown.

## Contradictions and corrections to our existing notes
- `hzd-nubis-evolved.md` section 1.1 says "The slide-38 controls show the ranges: Coverage +-0.5, Type +-1, Precipitation +-1". Those overlays are on [s40 to s42] (p042 to p044). Slide 38 (p040) is the **override panel** listing the weather inputs (above). Minor.
- The same note says the three height gradients are "images only" and describes stratus, cumulus and cumulonimbus loosely. The measured values above are consistent with its description (cumulus about 15 to 60%) but sharpen it: **cumulus has a soft ramp-in at 5 to 20% and a plateau to 40%, empty above 60%**, and **cumulonimbus is nearly full to 75% and fades only in the top quarter**.
- `procedural-shape.md` M1 describes the weather map blue as type and green as precipitation: confirmed by [s40 note].
- Nothing in the deck contradicts the "recalled" GPU Pro constants; the deck simply does not contain them. `gp7.md` now confirms M1 (shape/detail chain) from the chapter's code and finds M2's gradient constants absent from the chapter.

## Superseded by / supersedes
- **Superseded in detail by `gp7`** (the chapter: remaps, FBM weights, the `(1 - h)` curl factor, HG with g = 0.2, Beer-powder `2 e^-d (1 - e^-2d)`; it has **no** curl strength, no view-dependent powder and no gradient constants or type-lerp formula), by `n17` (Nubis 2017: remap form, cloud map R and G Perlin/Perlin-Worley, anvil bias) and by `n3`/`ne22` (the shape model with min/max height, top and bottom type, authoring NDFs).
- **Supersedes nothing**; it is the earliest public statement of the model. Its unique, still-useful content is the **R&D history, the taxonomy and rules figure, the explicit target images for billows and tops, the noise slice figures, the measured gradient shapes, the weather inputs panel, the in-game weather minimaps and the painted-weather cutscene mode**.
- Lighting/optimisation details (Beer, HG, powder, 1/16 reprojection, six-tap cone) are already analysed in `hzd-nubis-evolved.md` sections 3 and 4; Nubis Cubed replaced powder with its multiple-scattering term (`nubis-sources.md`).

## Review (Opus spot-check, 2026-10-10)
- [s34] swatch measurements → stratus ✘ fixed (0 to ~0.09, peak 0.07, not 0.05-0.15); cumulus (5% at 0.01, half 0.09, full 0.19, plateau to 0.41, half 0.51, zero 0.59) and cumulonimbus (full 0.07, plateau to 0.75, half 0.86, zero 0.97) ✔ within the stated +-0.05
- [s40-s42] overlays "Coverage +- .5, Type +- 1, Precipitation +- 1" (p042 jpeg) → ✔
- [s42 note] precipitation transitions to cumulonimbus at 70% coverage → ✔
- [s45 notes] 35,000 m radius, from 15,000 m toward cumulus at ~50% coverage → ✔
- [s73 notes] volumetric strato class 1500-4000 m, 2D alto/cirro above 4000 m → ✔
- [s81, s83, s84 notes] 64 to 128 samples; 6 cone taps, last far; cheap shader once alpha 0.3, "2x faster" → ✔
- "gp7.md does not exist" and "superseded by gp7 (curl strength, view-dependent powder, type lerp)" → ✘ fixed: gp7 exists and has none of those three
- runtime `procedural/density.wgsl.ts:52` `spHorizon` (start, ramp, amount) → ✔; `trace.wgsl.ts:253-262` far taps after the cone → ✔ (block runs to :268)

**Height-gradient numbers across sources** (h = fraction of layer, 0 = base; "full" = density 1):
| Source | Stratus | Stratocumulus / middle | Cumulus / tall | Status |
| --- | --- | --- | --- | --- |
| hzd15 s34 / gp7 Fig 4.10 (same image; captions stratus, cumulus, cumulonimbus) | 0 -> peak 0.07 -> 0 by 0.09 | 0.0 -> full 0.19, plateau to 0.41, 0 by 0.59 | full by 0.07, plateau to 0.75, 0 by 0.97 | measured, 2015/2016 illustration |
| `nut` slides 7-8 gradient fills (exact XML stops) | see `nut.md` | see `nut.md` | see `nut.md` | exact, 2018 |
| `n17` measured in-game strips | ~0.01 / 0.07 / 0.10 / 0.18 | 0.03 / 0.16 / 0.32 / 0.47 | 0 / 0.09 / 0.65 / 0.79 | measured; agree with `nut` |
| `n17` printed stratus pair `(0, 0.1, 0.2, 0.3)` | example only | | | not the shipped curve |
The 2015/2016 swatches are **not** the shipped curves: the middle swatch here is labelled cumulus but matches no shipped cumulus, and the tall swatch is cumulonimbus. Port the `nut`/`n17` stops for the HZD target; keep this figure only as the talk's illustration.

