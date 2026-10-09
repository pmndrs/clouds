# Topic guide: weather (map generation, authoring, animation, evolution)

RS-5, 2026-10-10. How the sources build, paint, schedule and animate the 2D fields that say where clouds are and what type they are. Conventions, source ids and runtime paths (**P** `procedural/`, **G** generator + sky layer, **V** voxel) are as in [shape.md](shape.md#conventions); channel layouts are compared in [layering.md §1](layering.md#1-weather-map-channel-schemes). `X/` = `/Users/dex/Developer/WebGPUClouds/artifacts/research/extracted/`.

**The HZD floor in one line.** A low-frequency 2D map (coverage, type, rain) from a weather-simulation shader, with artist biases and painted overrides; weather states blended over 10-30 s by a scheduler; the map stays still while the 3D noise scrolls with the wind and shears with height [hzd15 s38-47; n17 p.45, p.53-72; nut s15-20]. **Ours (P)** bakes one Perlin fBM channel (Sky Pro) or loads a PNG (Takram), translates map and noise together with the wind, and has no states, scheduler, biases or paint layer.

## 1. What goes in the map, and what does not
- Two inputs drive almost everything: **coverage** and **type** [n17 p.27, nut s6, hfw p.9].
- Anything constant across a weather state stays out of the map and goes into the state: skew, anvil bias, movement speed, movement direction, cloud density [n17 p.59-60].
- HZD adds **precipitation** (rain absorption and the cumulonimbus override) and a separate **cirrus density** for the 2D layer [hzd15 s38-42]. NE adds min/max height and bottom type [ne22 p.20]. See layering L1 for the layout decision.

## 2. Generating the map
| Source | Recipe | Look |
| --- | --- | --- |
| **n17 p.53-58** | `gate` = one low-frequency noise ("large regions where air masses overlap", about 3-4 blobs per map side on p.55); **R** = gate × several higher-frequency **Perlin** octaves (connected formations); **G** = gate × higher-frequency **Perlin-Worley** (isolated islands with connective tissue); **B** = type from another low-frequency noise (0 stratus, 0.5 stratocumulus, 1 cumulus). The artist picks R or G for the sampler [p.56]. Octaves and frequencies not given | p.54 flat yellow at 100 %; p.55 gate alone; p.56-57 footprints and the sky each gives; p.58 with type |
| hzd15 s40-46 | a weather-simulation shader modulates R/G/B during gameplay, with bias controls; no recipe | minimap: magenta (coverage + cumulus) broken by blobby, cell-like patches at mixed sizes with ragged edges: red lumps = stratus, white = rain / cumulonimbus, orange edges |
| nut s16-20 | "procedural or manual"; three independent fractal fields with domain-warped, billowy edges, a handful of features per tile | the working map is a **small tile repeated** (about 4 × 5 repeats in the in-game inset) |
| ne22 p.69-74, hfw p.22-23 | NDF generator = noises + remaps + composites over world XY; regional sets per area (p.77) | minimap is green/black mottle: clusters of cells, not one-scale noise |
| hfw p.56-57 | min/max height field from distorted noises and radial gradients | underside defined by height-adjust signals |
| web18 p.6 | painted greyscale cover per layer → spheres on a coarse grid, falloff `x_j (1 - r^2/R^2)^3`, summed and squashed by `σ(x) = x/sqrt(1+x^2)` | Fig 7: heart, contrails, letters, hole |
| hag p.11-12 | hand-painted 512^2 (a generator is listed as future work); fig 56-63 maps per type (cumulonimbus: big dots in R, G reduced around them) | |
| Map size | gp7 p.103 60 × 60 km; n17 p.54 "about 100 square kilometres" (ambiguous); ne22 p.17 / n3 s16 16 × 16 km; hag 512^2 texels, scale not given | |
| **Ours P Sky Pro** | periodic Perlin fBM: mass (freq 4, 5 octaves, contrast 1.32) + detail (6, 6, 0.13) + bias 0.26, R only (`procedural/textures.ts:85-104`, `settings.ts:140`) | a Perlin continent: no islands, no clusters |
| **Ours P Takram** | a loaded 512^2 PNG (`procedural/textures.ts:50-57`) | static art |
| **Ours G** | weather v2: an fBM cluster field gates four jittered Worley cell layers (big, mid, small, fractus) with per-cell radius, peak, profile and sub-lobes; a deck carpet; regional species fBM; alto cells; horizon ring; optional evolution (`generate/shaders.ts:229-247, 306-400`; `generate/weather.ts`) | the richest map we have |

- **Code:** none printed (n17's density sampler and weather slides are missing from the PDF; n17.md "Code listings"). `X/n17/code/n17-p034.hlsl` has the Perlin-Worley used for G.
- **Recommendation.** Give P a real map. Two routes, both useful: (a) the N17 recipe verbatim in `procedural/textures.ts`, as the HZD-faithful baseline; (b) G's weather v2 baked for the P path, as our richer version. A/B them on the same view (try-next W2). Keep the map tileable but large enough that repeats are not seen; nut shows HZD lived with visible repeats in the minimap, which we should not copy.

## 3. Painting and overrides
- **Artist bias panel** [hzd15 s38-42]: inputs listed on the override panel are wind direction, wind speed, precipitation, wetness, temperature, humidity, cloud density (coverage), cloud type and **cirrus density**. Bias ranges drawn on the minimap: coverage ±0.5, type ±1, precipitation ±1 (s40-42; s41 shows precipitation at 0).
- **Painted maps** [n17 p.67-68, nut s19]: the pipeline is editor controls → weather-simulation shader → RGB texture → optional paint-over in an image editor → cloud map. Several maps blended into a "Frankencloudscape"; an art-director hole is painted black; a low-coverage blue region opens the sky around the sun.
- **Cutscene weather** [hzd15 s47]: a smooth, hand-painted two-colour gradient of coverage versus type across the view, not a noisy map.
- **Influence NDFs** [ne22 p.69-78]: generator and editor (Houdini) both write Influence NDFs: the same layers as the profile NDF plus a red influence mask that blends a regional or hand-made field over the procedural one; regional sets (cumulus here, stratocumulus there); weather states are each a cloudscape of NDFs blended into the current weather.
- **Superstorm stencil** [hfw p.50]: a storm is a position, radius and coverage that overrides the data fields inside its circle for both tropospheric and cirrus layers, so the transition to ordinary clouds is seamless [p.75].
- **Control spheres** [web18 p.6, Fig 7]: stamp spheres into the cover to carve hearts, contrails, letters and holes.
- **Ours:** P Takram accepts any PNG; no bias uniforms, no mask, no paint tool anywhere; G has no override layer.
- **Recommendation.** Three cheap layers, in order: (1) bias uniforms (coverage, type, precipitation, cirrus density) applied after the map read (try-next W4); (2) one painted RGBA override plus an influence mask, blended over the procedural map (try-next W5); (3) a sphere-stamp brush with web18's falloff for holes and lines, writing into the override (W5). The painted cutscene gradient is just (2) with a gradient.

## 4. Weather states, scheduler and transitions
- **State** [n17 p.59-60]: a map plus the per-state constants (skew, anvil bias, speed, direction, density).
- **Scheduler** [n17 p.70-72]: states ("Cloudy", "Clear", "Storm") are grouped into a **weather cycle** per zone; the scheduler picks the next state at random from those allowed at this time of day (no cumulus in the morning); special cycles (a boss fight) override regional ones; on entering a zone, the next state is replaced by a random state of the new zone and the blend starts at once. HZD had **10 regional zones and 70 small zones** [p.72].
- **Transition** [n17 p.71, nut s20]: a plain lerp of the whole state over **10-30 s**. Because coverage is an erosion threshold, the lerp reads as clouds inflating or deflating, not a crossfade; the wind-driven noise keeps moving through it.
- **Storm arrival** [hzd15 s44-45 videos]: raising wind and rain chance grows the white (rain) regions from the upwind side.
- **Local weather event** [hfw p.96-106]: position, radius and blend factor driven by an effect graph, feeding the renderer, the NDF generator and lightning; 5 spawn locations; about 2 min ramp up, a few minutes at full, 2 min dissipation.
- **Key-framed morphing** [web18 §5]: cover maps key-framed and morphed by optimal transport between sphere sets (ghost primitives for births and deaths). Offline, a few seconds per key pair; keep as a reference only.
- **Ours:** nothing in P. G has time-driven cell life cycles (§6) but no named states.
- **Recommendation.** A small state module: a state = map parameters + biases + per-state constants; a scheduler with time-of-day gating; a 10-30 s lerp of every parameter, including coverage, so transitions inflate (try-next W3). Zones come later.

## 5. Animation: wind, skew, and the weather-map advection question
| Source | Motion | Weather map |
| --- | --- | --- |
| gp7 p.109-110 | `p += h · wind · 500` (skew), then `p += (wind + (0, 0.1, 0)) · t · 10`, both before any texture read; the text says each 3D texture moves at its own speed (the listing shows one). The 0.1 "upward" bias is on `.y` while gp7's height is `.z` (gp7.md review): read it as up | not stated |
| n17 p.45, nut s15 | `p += wind · t; p += h · wind · 500`; detail only | **not animated**: the large shapes stay, the details change |
| ne22 p.37, n3 s25 / s91, syn s12 | noise scroll `p - wind · offset`; voxel: horizontal only, `float3(wind.xy, 0)` | NDFs not advected [n3 s173: pseudomotion only] |
| hfw p.21, p.59-70 | same scroll; storms rotate the noise lookup in **6 nested rings** with speeds falling outward, overlap sampled twice and lerped, per-ring skew; reprojection uses the same rotation | static; storm is a stencil |
| ne22 p.155-157 | sky clouds: 2D scroll plus storm rotation in the motion vectors, allowing far faster scroll | |
| hag p.34 | texture offsets only: moving the weather map moves the clouds, the shape offset changes shape, the detail offset adds turbulence; moving all three in similar directions gives drift plus evolution (fig 68: map and shape moved 200 m and 400 m) | **advected** |
| web18 p.6, Fig 14 | 4D noise; each layer its own wind (stratus W→E low, cirrus NE→SW high) | control field drifts per layer |
| hzd15 s21 | rule: wind direction varies with altitude | |
| **Ours P** | Sky Pro: weather and shape both offset by `P.drift` (`procedural/density.wgsl.ts:90, 98`), skew 1750 m per shell height (`settings.ts:139`), evolution offset `P.wind.z` (`:98`). Takram: weather and shape offset by `P.drift` (`:191, :213`), **no skew** | **advected** (rigid translation) |
| Ours V / G | voxel noise scroll (`shaders/density.wgsl.ts:49`; velocity in `runtime.ts:426`); the box can translate (`runtime.ts:252`); G evolution advects the pattern, anchors the billow noise to a voxel-snapped wind offset and translates the box by the remainder (`generate/evolution.ts:1-12`) | advected |
| Cirrus | own wind, fine fibres 1.12x faster and slightly sideways (`cirrus/index.ts:223-228`) | own layer |

**The conflict that needs the owner.** Every Nubis talk keeps the map still and scrolls the noise through it, so formations stay put while their detail flows through them. The owner's observation (`cloud-motion-ideas.md` §1-5) is the opposite: real detail is **carried** with the cloud, not regenerated; uniformly scrolling or animated noise reads as boiling or sliding. Our P path does rigid translation (Häggström's choice), which carries detail but freezes it. Three options, all cheap to switch:
1. **Nubis**: static map, noise scrolls (the HZD floor; formations persist, detail slides).
2. **Rigid**: map and noise move together (ours today; detail is carried, nothing evolves).
3. **Split**: map moves with the wind, the shape noise with it, the detail noise slightly faster (gp7's per-texture speeds), plus the 10-30 s state lerp for evolution.
Make the policy a setting and judge it against the owner's time-lapses (try-next W1). The HZD frames are stills, so they cannot settle this.

**Skew.** N17/gp7: 500 per layer of height (gp7's units are the engine's; n17 uses the same constant). Missing in Takram; Sky Pro has 1750 m per 5.2 km shell (about 340 per km). Photo congestus lean 5-25° with height (`photo-species-specs.md` §3). Add to the HZD shaper (try-next W6).

## 6. Evolution
- **HZD's own goals** [hzd15 s7]: evolving over time is a stated goal; the 2015 Houdini prototype matched a photo but fell apart in motion [s18], which is why the system became rules over generic noise. In game the weather simulation progresses during play [s40].
- **N17** [p.45, p.63]: evolve details, not formations; behaviour changes with weather.
- **N3** [s173, s176]: realtime evolution of voxel clouds is future work; Stormbird dissipates by an unexplained scripted method.
- **Lifecycle shapes** [web18 p.5-6]: per type, α = 1 fades (support constant, stratiform and high clouds), α ≈ 0 shrinks toward the densest cores (cumuliform; α = 0.1 for cumulus): small clouds vanish first, big cores last. Formula `a = (1 - c̄α)s - (1 - α)c̄` with `c̄ = 1 - c`.
- **Limits** [hag p.62-65]: offset animation cannot make swirling storms or per-part motion.
- **Owner life cycle** [`cloud-motion-ideas.md` §5]: billow forward from inside, skin rolls back, pieces are ejected and absorbed by neighbours, then the cloud turns to wisps and vanishes or re-forms.
- **Surveyed methods** [survey]: advected textures (Neyret 2003), endless cross-dissolve (Iwasaki 2011), bubbles (Neyret 1997), parcels plus a cloud map (Goswami 2017/2019); none fetched.
- **Ours:** G `generate/evolution.ts`: every cell grows (22 %), matures (66 %), dissipates and restarts elsewhere; NVDF and SDF regenerated every 1.5 s, double-buffered (n3 §5 row 35 calls this "ahead" of N3). P: none.
- **Recommendation.** For P, web18's α per type inside the coverage remap (cheap, makes coverage changes read as growth and decay) plus the state lerp (W3). The owner's carried-detail model is a separate project (`cloud-motion-ideas.md`), not part of the HZD floor.

---

## Try next (ranked, for the board)
Acceptance on the compare page against [README.md §Reference frames](README.md#reference-frames), the owner's photos, and (for motion) the owner's time-lapses.

| # | What | Why (visual failure it fixes) | Sources | Files | A/B acceptance | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| **W1** | **Map-advection policy as a setting** (Nubis static / rigid / split, §5) | Clouds either slide as rigid stamps (ours) or let detail stream through still forms (Nubis); the owner sees both as wrong motion | n17 p.45, nut s15, ne22 p.37, hag p.34, gp7 p.109-110, `cloud-motion-ideas.md` | `procedural/density.wgsl.ts:90, 98, 191, 213`; `procedural/index.ts:139` (wind offset written per frame) | Side-by-side 60 s clips against 2-3 owner time-lapses (a cumulus crossing, a dissipating one) | L, **owner input** |
| **W2** | **A real map for P**: N17 gate × Perlin (R) / gate × Perlin-Worley (G) / type noise (B), and G's weather v2 as the second arm | Sky Pro's one Perlin continent: no islands, no clusters, no types | n17 p.53-58, hzd15 s40-46, ne22 p.70-74 | `procedural/textures.ts:85-104` (new bake), `generate/weather.ts` reuse | Minimap-to-sky pairs: n17 p.56-57, hzd15 p042-p048; photo §1-2 statistics (cover 10-40 %, sizes 5:1, satellites, gaps 0.5-2 widths) | M |
| **W3** | **Weather states + scheduler**: state = map params + biases + constants; time-of-day gated random pick; 10-30 s lerp of everything | No weather change at all; transitions would crossfade instead of inflating | n17 p.59-72, nut s20, hzd15 s44-45 | new `procedural/weather-state.ts` (or `generate/`), `runtime.ts` | A 30 s clear → cloudy transition reads as clouds inflating (compare n17 p.41-44 stills); no pop | L |
| **W4** | **HZD bias panel**: coverage ±0.5, type ±1, precipitation ±1, cirrus density, as uniforms after the map read | No art direction over a procedural map | hzd15 s38-42 | `procedural/settings.ts`, density read sites; cirrus params | Reproduce hzd15 s38 → s43: drag coverage up, then type cumulus → stratus, on the same view | L |
| **W5** | **Paint / influence layer**: one RGBA override + influence mask blended over the procedural map; sphere-stamp brush (web18 falloff) for holes and lines; painted-gradient cutscene mode | Cannot place a hole by the sun or compose a hero sky | n17 p.67-68, nut s19, ne22 p.69-78, hzd15 s47, web18 p.6 | new override texture binding in P and G; a small paint tool page | Recreate the nut s19 boss-fight map (blue sky with painted black holes) and hzd15 p049 gradient; owner composes one sky | M, **owner input** (tool UX) |
| **W6** | **Skew and per-texture speeds** in the HZD shaper: `p += h · wind · skew`, shape and detail at different speeds, up-drift on the up axis | Takram towers stand vertical; real towers lean 5-25° | n17 p.45, gp7 p.109-110, photos §3 | S1 shader (`procedural/density.wgsl.ts`) | Congestus photos (lean, offset top domes); n17 p.49-50 anvil skew | L |
| **W7** | **Lifecycle α per type** in the coverage remap (fade vs shrink) | Animated coverage dissolves cumulus uniformly instead of shrinking to cores | web18 p.5-6 | S1 shader | Coverage ramp 0.6 → 0.2: cumulus shrink to cores, stratus thin out (web18 Fig 6) | L |
| **W8** | **Local weather event / superstorm stencil** (position, radius, blend; rotating detail rings later) | No local storms in the procedural sky | hfw p.50-62, p.96-106; ne22 p.139-157 | new event module; S1 shader | hfw p.50-51, p.72; cumulonimbus photo set | H |
