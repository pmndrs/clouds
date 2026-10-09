# nut: Schneider, "Nubis: Realtime Volumetric Cloudscapes In A Nutshell" (Eurographics 2018, 36 slides)

Status: note written, code transcribed (4 short text listings + the measured gradient stops + the s35 loop; no code in images). Updated after the PDF export (`extracted/nut/deck.pdf`, page N = slide N) was read page by page.
Dump: `artifacts/research/extracted/nut/pptx/` (local). Code: `extracted/nut/code/nut-s11.hlsl`, `nut-s13.hlsl`, `nut-s15.hlsl`, `nut-s22-29.hlsl`, `nut-s7-8-gradients.hlsl`, `nut-s35.hlsl`.

## What this source is (and is not)
A teaching distillation of HZD 2015, GPU Pro 7 and N17 (the author says so at [s3] and calls it "NOT a step by step implementation guide"
or "exactly what we shipped"). It contains **no code and no channel layouts**, but the **height-gradient numbers are recoverable** (see the next section): they are gradient fills in the slide XML. Its value
for us is (a) the clean statement of the density chain as three remaps and (b) a few facts not stated this plainly elsewhere: the two
probabilities model, the coverage-as-erosion rationale, the "noise erodes, so cheap steps cannot miss" argument, the weather-map authoring
anecdotes, and the performance ladder. Almost everything else is **identical to** HZD 2015 / N17 (`hzd-nubis-evolved.md`, `procedural-shape.md`).

Correction to the first version: the 27 `.wdp` files are PowerPoint "HD Photo" artistic-effect sidecars of the PNG/JPEG next to them (slide rels pair
each `imageN.png` with a `hdphotoN.wdp`), not separate pictures. Nothing was lost; the PNGs were the real images. The slide 7-8 curves were
not images at all but **rectangles with gradient fills**, which the PDF render shows and the slide XML gives exactly (below).

## Height gradients [s7-8], measured (the headline new content)
Source: the `gradFill` stops of the three rectangles in `slide8.xml` (and the same stops in `slide7.xml`), cross-checked against the PDF render
(pixel columns in p008 agree within 1% of layer height). **Exact to the percent**, not read off a curve. Heights are normalised, layer bottom 0, top 1;
the box is the whole layer (the slide-7 "height" axis spans the same box). Density is the gradient's grey level, interpolated **linearly** between stops
(a piecewise-linear trapezoid: no smoothstep). Entries are `(rise start, full, fall start, zero)` in the N17 `remap(h,a,b,0,1)*remap(h,c,d,1,0)` form.

| Type | rise start | full | fall start | zero | Reading |
|---|---|---|---|---|---|
| stratus | 0.02 | 0.07 | 0.11 | 0.18 | thin low slab, full-density core only 0.07-0.11 (4% of the layer) |
| stratocumulus | 0.04 | 0.16 | 0.32 | 0.48 | lower half of the layer; ramps are wide (0.12 up, 0.16 down) |
| cumulus | 0.01 | 0.09 | 0.65 | 0.80 | near-flat base (0.08 ramp), long plateau, soft top that stops at 0.80 (not 1.0) |

Notes: slide 7's stratus rectangle has no 98% stop, so there it is `(0.00, 0.07, 0.11, 0.18)`; slide 8's is the table value (a tiny base lift-off). Type
blends between the three left to right on slide 7 (stratus at type 0, cumulus at type 1, in that left-to-right order). The blend law (linear between
neighbours, 0.5 for stratocumulus?) is **not stated**; the slide only orders them. Precision: stop values are given to 1% of the layer, so +-0.005; the
`type` mapping of the middle one to 0.5 is an inference.

**Comparison with the other sources:**
| Type | Nutshell (this) | GPU Pro 7 Fig 4.10 (`gp7.md`, +-0.03) | N17 s28-29 / recalled (`procedural-shape.md`) |
|---|---|---|---|
| stratus | 0.02 / 0.07 / 0.11 / 0.18 | peak ~0.08, gone by ~0.105 (thinner, no plateau) | `(0, .1, .2, .3)`: thicker and higher |
| stratocumulus | 0.04 / 0.16 / 0.32 / 0.48 | 0.03-0.20 rise, plateau to 0.42, fall 0.42-0.60 (**higher**) | `(0, .2, .48, .625)` recalled: top ~0.15 higher |
| cumulus | 0.01 / 0.09 / 0.65 / 0.80 | right panel (cumulonimbus-captioned): rise 0-0.07, fall 0.75-1.0 | `(0, .1, .8, 1)` or `(.01, .3, .6, .95)` recalled |
Reading: the Nutshell is the cleanest, most precise statement, and it is **lower and thinner than GPU Pro 7 and N17 for the two lower types**. Stratus
sits between GP7 (thinner) and N17 (thicker), nearer GP7. The N17 stratus `(0,.1,.2,.3)` ends at 0.30; here it ends at 0.18. Cumulus matches GP7's
right panel in shape (near-flat base, long plateau) but the soft top is at 0.65-0.80, whereas GP7 and our recalled `(0,.1,.8,1)` go to 1.0. So three
different "official" sets exist (GP7 book figure, N17, Nutshell) and none is a spec: treat the Nutshell numbers as the best-documented starting point
and the others as tuning range. The recalled `(.01, .3, .6, .95)` cumulus matches nothing here. The **`(0.01, 0.09, 0.65, 0.80)` cumulus base ramp
(0.01 to 0.09) looks like the same ramp as GP7's 0 to 0.07**, which is some evidence that the rise values are stable and the top is what differs.
Layer heights differ per type in the game (cumulus layers are taller), so the normalised heights above are fractions of **that type's own layer**, not
of a shared slab; this is not stated and is an assumption.

## The density chain (as stated, in order)
Two probabilities drive everything [s6]: **cloud coverage** (is there cloud) and **cloud type** (height profile and billowy vs wispy).
Both live in one 2D "Cloud Map" [s16]. Stated sequence:

1. **Type gradient** [s7-8]: three height-probability gradients ordered stratus (type 0), stratocumulus, cumulus (type 1); "type" blends
   between them. No formula on the slides; the constants are in the table above (from the slide XML).
2. **Base shape** [s10-11]: `base_cloud_density = remap(low_freq_noise, high_freq_noise, 1.0, 0.0, 1.0)`. The low-frequency noise is
   Perlin-Worley ("Perlin and Worley noise" in the note, i.e. the 128^3 shape texture); the "high frequency noise" is the Worley detail,
   used as the **lower bound** of the remap, so detail erodes the shape. Argument of the `remap(value, old_min, old_max, new_min, new_max)`
   signature: the value is the low-frequency noise, the old minimum is the high-frequency noise.
3. **Coverage** [s13]: `cloud_with_coverage = remap(base_cloud_density * height_gradient, cloud_coverage, 1.0, 0.0, 1.0)`.
   Coverage is applied as a threshold (erosion) on the **product of noise and height gradient**; raising it "inflates" clouds [s14]
   and is the recommended tool for weather transitions.
4. **Wind** [s15]: `sample_pos += wind_direction * time_offset` on the 3D noise lookups only. The cloud map is **not** animated.
5. Lighting is then `Energy = Attenuation * Phase * InScattering` [s22, s29] with `exp(-density_along_light_ray)`, a Henyey-Greenstein
   phase (several eccentricities summed for sunset silver-lining control [s26]), and the in-scattering probability `1 - exp(-density_sample)` [s27].

### What differs from the other talks (the useful part)
| Item | This talk | Other talks / our notes |
|---|---|---|
| Order of ops | noise remap (2), then `* height_gradient`, then coverage remap (3) | HZD s35-36: gradient multiplied in, then coverage remap; N17 s40 adds a trailing `* coverage` (`procedural-shape.md` line 34). **The nutshell omits the `* coverage` multiplier.** Treat it as a simplification, not a correction. |
| Detail erosion | only the one remap against a single "high frequency noise" | HZD/GPU Pro 7: three-octave Worley FBM detail, curl distortion, height-inverted detail (wispy at the base), `pow` softening. None of that appears here. |
| Curl / turbulence, flow | absent | present in HZD s33/37 |
| Wind skew with height, anvil, cloud-top shaping | absent | N17 s45, HZD s31/38 |
| Cloud map channels | R and G coverage, B type [s16] | HZD 2015: R coverage, G precipitation, B type; GPU Pro 7 has the same R/G/B plus extra. **The note says "Red and green represent coverage"**: two coverage channels (the N17 version, where G is a second, island-style coverage; see `procedural-shape.md` line 72), and no precipitation channel. |
| Dimensional profile / vertical-profile model | absent | NE (2022) only |

The one conceptual rationale unique here: **remap beats multiply for combining noise** [s11 note]. Multiplying two noises loses density
in the core; a remap keeps the core ("carving a block of clay where all the detail is already stored"). Together with: noise is a
*probability* base, so coverage can erode the noise*gradient product and the cloud can "expand or contract over a gradient of coverage
values in space" [s13 note]. This is the justification for our inflate-style coverage (see comparison below).

## Authoring / weather (slides 16-20) — the most useful content for us
- Cloud map: one 2D texture mapped to world xz, **R and G coverage, B type** [s16 note]. "Procedural or manual"; used for set-piece
  scenes. Reference figure: the colour cloud map [s16, image35.png, 960x961, tileable]. All three channels carry
  independent fractal (domain-warped, billowy-edge) fields: red and green blobs (coverage), blue blobs (type), with black voids where all are zero,
  and cyan/magenta/yellow/white where channels overlap. Features are large (a handful across the whole tile) with ragged fractal edges, i.e. a
  multi-octave noise at low base frequency. The compass (N top, W left) fixes the map orientation to world axes.
- Type semantics by weather [s17-18]: cold desert morning means stratus, so the map's **B channel is zero** (no blue); afternoon cumulus
  maps have **higher blue**. The note says "type zero for this cloud map as you can see by the lack of Blue", which is consistent with
  type 0 = stratus. The in-game debug insets confirm it: [s17] desert-morning map is **yellow-green/black (R+G, no blue)**; [s18] afternoon cumulus map is
  **blue/purple (high B)**; [s20] clear-calm map is blue with black holes. All insets show the map **visibly tiled** (the same ~250-px pattern repeats
  about 4 x 5 times across the in-game map window), so the working cloud map is a small tile repeated over the world, not one big unique texture.
- Boss-fight custom map [s19]: a **hand-composed "Frankencloudscape"** blended from several weather systems; a low-coverage blue region
  makes the opening around the sun; an art-director "hole right here" is painted black on the map. [s19] inset shows it: a blue/purple map with a red polygon and a green polygon drawn over it (the two weather systems), yellow arrows at hand-painted black patches (the holes), and a white arrow at a pale-blue streak by the sun opening. The comparison to our weather bake:
  we have no hand-paint override. A paint-over mask is a cheap authoring win (see try-next).
- Weather transitions [s20]: a **linear blend between two cloud maps over 10 to 30 seconds**, "depending on the situation"; the
  structure morphs (coverage inflation) while the wind-driven noise keeps moving. The cloud map itself is never advected [s15 note]:
  "only want them to appear to be changing without altering the larger structure". Our notes: nothing records the 10-30 s figure.
- Procedural cloud map generation is mentioned but not described here (see N17 s54-59 and `procedural-shape.md` line 72).

## Renderer recipe (slides 30-35) — brief, mostly identical to HZD/N17
- Same cheap-step / expensive-step march as HZD s77-80 (ours: `procSample`'s `full` path, `density.wgsl.ts:204-238`).
- **Cheap samples sample only coverage and height gradient, no noise** [s32]. This is valid because "our noise erodes the base cloud
  shape created by the coverage and height gradient", so the cheap field is a **conservative upper bound** (noise can only remove
  density). Our Sky Pro path does this explicitly (`procCandidate` bound at `density.wgsl.ts:92-123`, `maximumTop` at :102) and the
  takram path does not (`procCellIsEmpty` returns false, `:238`). This is a real gap for Takram; for Sky Pro it is already there.
- Large steps are 2x the fine step ("Step * 2, Sample Cheap" [s35]); on the first non-zero cheap sample, step back one and switch to
  full samples; leave when "the result is zero for several samples" [s35].
- Only if the expensive sample is non-zero: **6 light samples with reducing noise resolution each step, the last one cheap** [s32 note].
  Maximum **128 primary samples** plus 6 light samples each. Ours: `P.steps.y` max steps, `P.steps.z` light taps.
- Performance ladder [s34]: 60+ ms (naive) -> 22 ms (16-way parallel split) -> 3.34 ms (march optimisations) -> **1.2 ms**
  (skip hidden pixels and below-horizon). These are PS4 numbers; "2 ms" is the stated budget for the final system [s2 note].
  The render is split into 16 pieces built into one image [s33 note]; the slide does not say how (the common reading is a 4x4 interleaved or temporal tiling; unverified).
- Early outs [s31, s35]: do not march pixels occluded by geometry (trees, mountains) and stop at alpha >= 1.

## Code listings
No code in images (checked every page of the PDF). All are one-line text formulas, plus two reconstructed listings:
| Slide | File | What |
|---|---|---|
| s7-8 | `code/nut-s7-8-gradients.hlsl` | the three gradient stops (from slide XML gradient fills) as `float4(rise, full, fall, zero)` |
| s11 | `code/nut-s11.hlsl` | `base_cloud_density = remap(low, high, 1, 0, 1)` (noise erosion) |
| s13 | `code/nut-s13.hlsl` | `cloud_with_coverage = remap(base * height_gradient, coverage, 1, 0, 1)` |
| s15 | `code/nut-s15.hlsl` | `sample_pos += wind_direction * time_offset` |
| s22/23/25/27/29 | `code/nut-s22-29.hlsl` | lighting: energy product, Beer-Lambert, HG, `1 - exp(-d)` |
| s35 | `code/nut-s35.hlsl` | the march loop as indented pseudocode (cheap step x2, expensive on hit, 6 light samples, stop at alpha 1) |

## Figures that explain shape
- [s7] the three gradient strips and the 0 to 1 `type` arrow: the clearest statement of the profile family (values above). [s8] the three gradient boxes
  (cumulus visible, the other two stacked behind, revealed by click) over an in-game cumulus field.
- [s16] cloud map (R/G coverage, B type), 960 px, tileable; [s17, s18, s19, s20] in-game debug insets of the weather map with matching sky (desert morning
  stratus-ish map yellow/green, afternoon cumulus map blue, boss-fight composed map, clear calm map). Best set for "what map gives what sky".
- [s10] Perlin / 1-Worley / Perlin-Worley tiles side by side: Perlin is blotchy and dark with no bubbles; 1-Worley is a field of round bubbles with dark
  seams (bright = inside a cell); Perlin-Worley is the Perlin blotches with round bubble texture filled into the low-density parts. Illustrates "subtract
  the web-like shapes of Worley from the low-density region of Perlin to add round shapes".
- [s11] noise-scale progression: top row four tiles (a Perlin-Worley then three Worley at rising frequency, ~231 px each), bottom row three smaller
  Worley tiles at higher frequencies (~88 px each): seven tiles, bubbles shrinking each step. This is the "low-frequency shape then erode with
  higher-frequency Worley" ladder; no channel layout given.
- [s12] **in-game render of the height gradient x coverage field with no noise**: smooth flat-based slabs with vertical, slightly fluted sides and no billows
  at all. This is exactly the "cheap sample" field of [s32] (the conservative bound), and a useful picture of what the gradient and coverage alone give
  before erosion. [s14] the same sky with noise eroded in: the same large forms (cf s8) with billows, ragged edges and bright cauliflower tops. [s8] is the
  coarser cousin of [s14] (same scene at a different coverage/time).
- [s9] two B/W cumulonimbus/storm photographs with arrows: billow arrows (rising, curling outward) on the left, wisp arrows on the right (dissipating,
  curling into a wake). [s4-5] Howard's drawings and photographs.
- [s21, s22-29] lighting figures: s24 compares a render lit by `exp(-density along ray)` (left, shaded, volumetric) with `Energy = 1` (right, flat white
  silhouettes, no shading); s27 shows the in-scattering probability diagram with a cloud-texture crop (points p1, p2 at the edges: more light is scattered
  from the surface where fewer out-scatter paths exist, "dark edges"); s26 sunset in-game render for the silver lining; s28 in-game cumulus render, s29 the full product with the three labelled factors (absorption/out-scatter, scattering phase, in-scatter "dark edges"); s21 photograph of a sunlit cumulus edge with a dark core.
- [s30-33] march diagrams: s30 the naive 6-light-sample fan (red dots; s31 is an in-game desert render) vs s32 the cheap/expensive colouring (green = cheap sample outside the cloud ellipse,
  yellow/orange = reduced-noise light samples, red = expensive); s33 a regular lattice of small square dots tinted by sky colour (blue up, near-white at
  the horizon), animated through 15 overlays: a **sparse regular pixel lattice**, consistent with the 16-way split being a 4 x 4 interleave of pixels
  (the lattice spacing in the render is about one dot per 4 px in each axis; the pattern is a render of the sample grid, not a proof of the scheme).
- [s34] performance table (60+ ms, 22 ms, 3.34 ms, 1.2 ms) on an in-game desert render; [s35] the march pseudocode (see `nut-s35.hlsl`).
- [s36] references; [s2, s3] title and the "what this talk is NOT" list.

## Comparison with `packages/runtime/src/procedural/`
- Base remap (`remap(low, high, 1, 0, 1)`): Takram path `density = procRemap4(density, vec4(1 - shape) * P.tkShape, vec4(1))`
  at `density.wgsl.ts:216`. Same form, but with a tunable amount `P.tkShape` (0 to 1) that the talk does not have. Sky Pro path: no remap;
  the noise acts as dilation (`dot(baseSample, vec3(0.7, 0.41, 0.23)) * spShape.z`, `:111-112`), i.e. a different construction from this talk's
  erosion remap.
- Coverage remap: `factor = 1 - P.shell.w * heightScale; procRemap4(local, factor, factor+filter)` (`:193-195`). This is `remap(x, cov', 1, 0, 1)`
  of [s13] with the coverage *scaled by the gradient* (inflation, N17 s40), **not** the nutshell form where coverage is the lower bound itself. The
  two behave differently: at coverage 0.5, the nutshell removes noise below 0.5 everywhere and so a base/top gradient only scales the product,
  whereas ours shifts the threshold lower where the gradient is high. Ours is the N17/Takram variant; both give "inflation with coverage".
- Height gradient: semicircle on `pow(h, bias)` (`:178-181`), not the three type-blended trapezoids of [s7-8] (constants now in the table above: stratus 0.02/0.07/0.11/0.18, stratocumulus 0.04/0.16/0.32/0.48, cumulus 0.01/0.09/0.65/0.80). Note a semicircle has no flat core and no flat base; the Nutshell profiles do (cumulus is full density from 0.09 to 0.65).
  We have **no cloud-type channel**: the Takram path uses one weather channel per layer (`tkChannel`, `:182-186`) instead of blending three
  gradients by type, so stratus-to-cumulus continuity along the map (the main point of [s7]) does not exist in our model.
- Wind: Takram drift applied as `p.xz - P.drift.xz` to the **weather lookup too** (`:189, :208`); the nutshell advects only the 3D noises and
  keeps the cloud map still. Our Sky Pro path subtracts drift from the shape position but also from the weather (`procWeatherAt`, `:90-92`).
  If the aim is "details move, large structure stays" this is a divergence: we translate the weather map with the wind, so formations travel.
- Weather map: ours is a single-channel periodic Perlin fbm (Sky Pro; `textures.ts:97-103`) or a preset RGBA PNG (Takram). No type
  channel, no R/G coverage pair, no authoring override, no blend between maps.

## Contradictions with existing notes
None material. Two small clarifications:
1. The nutshell cloud-map description ("Red and green represent coverage and blue represents type" [s16 note]) is two coverage channels,
   no precipitation. If `hzd-nubis-evolved.md` states HZD 2015's R/G as coverage/precipitation, that is HZD 2015, not this talk; flag when merging.
2. The coverage formula here lacks the trailing `* coverage` of N17 s40 (`procedural-shape.md:34`); do not read it as evidence that the multiplier is wrong.

## Top 5 try-next (shape / layering / detail)
1. **Cloud-type channel** [s7-8, s16-18]: add a type value (B) to the weather map and blend three trapezoid gradients by it, giving stratus to cumulus
   continuity in one layer. Use the measured Nutshell stops (`nut-s7-8-gradients.hlsl`); compare GP7 and N17 as tuning range (see table).
2. **Weather map that does not advect** [s15 note]: wind offsets only the 3D noise, the map stays fixed. Prevents formations from sliding and matches
   the artist-directed look. Cheap change in `procWeatherAt` / `procWeatherSample` (`density.wgsl.ts:90-92, :189`).
3. **Noise-free cheap pre-pass as a conservative bound** [s32]: mirror Sky Pro's bound on the Takram path (`procCellIsEmpty`, `:238`): skip
   noise in empty cells and use the large step there. Perf only but frees budget for more detail octaves.
4. **Hand-paint / art override mask on the weather map** [s19]: a "paint black = hole" layer and a map-to-map blend over 10-30 s [s20] for
   weather transitions that morph by coverage rather than crossfade density.
5. **Two-coverage (R/G) maps** [s16]: R connected formations, G isolated islands (N17 s54-59); weights per scene. This deck confirms the two-coverage
   channel layout but not the generation; see N17 note for the procedure.
