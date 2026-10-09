# nut: Schneider, "Nubis: Realtime Volumetric Cloudscapes In A Nutshell" (Eurographics 2018, 36 slides)

Status: note written, code transcribed (4 short text listings, no code in images).
Dump: `artifacts/research/extracted/nut/pptx/` (local). Code: `extracted/nut/code/nut-s11.hlsl`, `nut-s13.hlsl`, `nut-s15.hlsl`, `nut-s22-29.hlsl`.

## What this source is (and is not)
A teaching distillation of HZD 2015, GPU Pro 7 and N17 (the author says so at [s3] and calls it "NOT a step by step implementation guide"
or "exactly what we shipped"). It contains **no code, no constants, no texture channel layouts, no height-gradient numbers**. Its value
for us is (a) the clean statement of the density chain as three remaps and (b) a few facts not stated this plainly elsewhere: the two
probabilities model, the coverage-as-erosion rationale, the "noise erodes, so cheap steps cannot miss" argument, the weather-map authoring
anecdotes, and the performance ladder. Almost everything else is **identical to** HZD 2015 / N17 (`hzd-nubis-evolved.md`, `procedural-shape.md`).

Unreadable: all 27 `.wdp` (JPEG XR) images; `sips` and `ffmpeg` both fail to decode them (sips reports an output path but writes nothing).
Most are the template background (hdphoto3/4/5) but the in-game
renders of 8, 12, 14, 24, 26, 28, 31, 34, are probably `.wdp`. So **the three height-gradient curves of [s7-8] could not be read** (slide 7 lists only template images, so the curves are likely vector shapes that the dump dropped; slide 8's gradient overlays may be `.wdp`);
the notes give only their order and names. Readable PNG/JPEG figures are listed at the end.

## The density chain (as stated, in order)
Two probabilities drive everything [s6]: **cloud coverage** (is there cloud) and **cloud type** (height profile and billowy vs wispy).
Both live in one 2D "Cloud Map" [s16]. Stated sequence:

1. **Type gradient** [s7-8]: three height-probability gradients ordered stratus (type 0), stratocumulus, cumulus (type 1); "type" blends
   between them. No formula or constants on the slides (see N17 s28-29 in `procedural-shape.md` for the remap-pair form).
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
  scenes. Reference figure: the colour cloud map [s16, image35.png, 960x961, tileable; black = clear, blue = type 1 (cumulus)
  with R/G zero, yellow/red = coverage with type 0].
- Type semantics by weather [s17-18]: cold desert morning means stratus, so the map's **B channel is zero** (no blue); afternoon cumulus
  maps have **higher blue**. The note says "type zero for this cloud map as you can see by the lack of Blue", which is consistent with
  type 0 = stratus.
- Boss-fight custom map [s19]: a **hand-composed "Frankencloudscape"** blended from several weather systems; a low-coverage blue region
  makes the opening around the sun; an art-director "hole right here" is painted black on the map. The comparison to our weather bake:
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
All are one-line text formulas (no code in images):
| Slide | File | What |
|---|---|---|
| s11 | `code/nut-s11.hlsl` | `base_cloud_density = remap(low, high, 1, 0, 1)` (noise erosion) |
| s13 | `code/nut-s13.hlsl` | `cloud_with_coverage = remap(base * height_gradient, coverage, 1, 0, 1)` |
| s15 | `code/nut-s15.hlsl` | `sample_pos += wind_direction * time_offset` |
| s22/23/25/27/29 | `code/nut-s22-29.hlsl` | lighting: energy product, Beer-Lambert, HG, `1 - exp(-d)` |

## Figures that explain shape (readable ones)
- [s16] image35.png: the cloud map (R/G coverage, B type), tileable, 960 px. Best single reference for authoring layout.
- [s10] image19.png (408x408): the Perlin-Worley tile used to illustrate the base shape. [s10] image20/21 and [s11] image22-25 (128x128 each):
  128x128 noise tiles illustrating the remap erosion; which is which was not checked beyond a glance (two look like Worley-style cell noise).
- [s4-5, s9] image8/10/11/15 (photographs, 1802 Howard drawings and cumulus/stratus photos) for billows vs wisps: billows are where density
  rises and pushes vapour outward; wisps are where density falls and vapour curls into a turbulent wake [s9 note]. Matches the two
  categories of detail the shape erosion has to produce.
- [s8, s12, s14, s17-19, s31, s34] in-game renders (image12-14, 17/18 for the framing, others `.wdp`). image12.png: scattered cumulus
  and stratocumulus at an oblique angle with a flat-based low-contrast horizon fade; the useful reference is the **flat bases and soft
  tops at distance**, not detail.
- [s7-8] the three gradient plots: **not readable** (`.wdp`).

## Comparison with `packages/runtime/src/procedural/`
- Base remap (`remap(low, high, 1, 0, 1)`): Takram path `density = procRemap4(density, vec4(1 - shape) * P.tkShape, vec4(1))`
  at `density.wgsl.ts:216`. Same form, but with a tunable amount `P.tkShape` (0 to 1) that the talk does not have. Sky Pro path: no remap;
  the noise acts as dilation (`dot(baseSample, vec3(0.7, 0.41, 0.23)) * spShape.z`, `:111-112`), i.e. a different construction from this talk's
  erosion remap.
- Coverage remap: `factor = 1 - P.shell.w * heightScale; procRemap4(local, factor, factor+filter)` (`:193-195`). This is `remap(x, cov', 1, 0, 1)`
  of [s13] with the coverage *scaled by the gradient* (inflation, N17 s40), **not** the nutshell form where coverage is the lower bound itself. The
  two behave differently: at coverage 0.5, the nutshell removes noise below 0.5 everywhere and so a base/top gradient only scales the product,
  whereas ours shifts the threshold lower where the gradient is high. Ours is the N17/Takram variant; both give "inflation with coverage".
- Height gradient: semicircle on `pow(h, bias)` (`:178-181`), not the three type-blended gradients of [s7-8] (constants unavailable in this deck).
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
1. **Cloud-type channel** [s7-8, s16-18]: add a type value (B) to the weather map and blend three gradients by it, giving stratus to cumulus
   continuity in one layer. Needs the gradient shape from N17 s28-29 since this deck lacks constants.
2. **Weather map that does not advect** [s15 note]: wind offsets only the 3D noise, the map stays fixed. Prevents formations from sliding and matches
   the artist-directed look. Cheap change in `procWeatherAt` / `procWeatherSample` (`density.wgsl.ts:90-92, :189`).
3. **Noise-free cheap pre-pass as a conservative bound** [s32]: mirror Sky Pro's bound on the Takram path (`procCellIsEmpty`, `:238`): skip
   noise in empty cells and use the large step there. Perf only but frees budget for more detail octaves.
4. **Hand-paint / art override mask on the weather map** [s19]: a "paint black = hole" layer and a map-to-map blend over 10-30 s [s20] for
   weather transitions that morph by coverage rather than crossfade density.
5. **Two-coverage (R/G) maps** [s16]: R connected formations, G isolated islands (N17 s54-59); weights per scene. This deck confirms the two-coverage
   channel layout but not the generation; see N17 note for the procedure.
