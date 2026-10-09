# Real-Time Volumetric Cloudscapes (Schneider, GPU Pro 7, ch. 4, 2016)
Local: `artifacts/research/papers/GPU_PRO_7-clouds.pdf` (31 PDF pages = book pp.97-127; **book page = PDF page + 96**) · Tags: shape layering detail weather light perf · Status: 🟩 note written, code transcribed (dump: `artifacts/research/extracted/gp7/`, code in `.../code/`)

Cited here as `[p.N]` = **book page** (what the PDF prints). PDF page = N - 96.

## In one paragraph
The written HZD chapter, early version of the 2015 talk. Its unique value is the **density sampler as HLSL**: one function that builds a cloud from (a) a 128^3 RGBA Perlin-Worley + 3 Worley texture, (b) a height gradient chosen by weather "type", (c) a coverage remap, (d) a 32^3 RGB Worley erosion distorted by curl at the cloud bottoms, with a wispy-to-billowy switch over the first 10% of height, then wind shear and upward drift. It also gives the cheap/full ray-march switch, six-tap cone light march, Beer-powder-HG lighting with rain absorption. **What it does not contain** (important, see section 4): no height-gradient constants (`GetDensityHeightGradientForPoint` is called but never shown), no anvil bias, no curl texture spec or sampling code, no noise frequencies.

## Key ideas (with pages)
- Budget: 20 MB memory, 2 ms GPU target [p.98]; 20 ms raw, 2 ms with temporal reprojection (Schneider 2015 s91-93) [p.125].
- Two volumetric layers: stratus-class 1.5-4 km, cumulonimbus 1-8 km; alto/cirro done as 2D textures [p.98]. In the render the ray march is a **3.5 km thick spherical shell starting 1.5 km up**; 64 steps at zenith to 128 at the horizon, much lower on average [p.119].
- Perlin alone gives fog-like stratus, not billows. Worley, inverted and put in an fBm, gives the packed cauliflower; use it as a **lower bound that dilates Perlin** (Perlin-Worley) so low-density regions gain billow detail [p.101, Fig 4.5-4.7].
- FBM is **precompiled into textures** so only two texture reads are needed: tex A = Perlin-Worley (R) + three Worley fBMs of increasing frequency (G,B,A), **128^3**; tex B = three more Worley octaves (RGB), **32^3** [p.102, Fig 4.8-4.9].
- Tex A defines the base shape; tex B only **erodes the edges** [p.102].
- Cloud type is a **weighted sum of three height-density functions** (stratus, stratocumulus, cumulus), weight from the weather map [p.103]. Previous work used one function, so max height never changed [p.102].
- Weather map, 60,000 x 60,000 m: R coverage, G precipitation, B type (0 stratus, 0.5 stratocumulus, 1 cumulus) [p.103-104, Fig 4.12]. Where rain chance is 100%, bias type to cumulonimbus and **coverage to at least 70%** [p.104]. Artists may override the map for cutscenes.
- Coverage is applied as a remap (inflation: clouds grow as coverage rises) then a multiply (small clouds lighter) [p.106-107].
- Detail: curl-distort the sample coordinate **at the bottoms**, build a 3-octave Worley fBM, **contract** (erode) the base shape; Worley is **un-inverted at the base (wispy) and inverted above (billowy)** [p.107-109].
- Wind: shear by height fraction, plus time offset in the wind direction with a small upward bias, **each 3D texture at its own speed** (the text says this; the listing shows one speed) [p.109-110].
- Marching: cheap samples (tex A only) until nonzero, then full samples; **six** consecutive zero full samples return to cheap [p.120]. Light taps only when the step is inside cloud [p.122].
- High altitude: scrolling 512^2 three-channel textures sampled once at the ray end, wind direction different from the weather system's [p.125].

## Formulas and constants (exact)
Pages are book pages. HLSL uses `float3 p` with **height in `.z`** [p.104], and `mix` for lerp.

**Noise textures** [p.102]
| Texture | Size | R | G | B | A | Use |
| --- | --- | --- | --- | --- | --- | --- |
| A "low frequency" | 128^3 | Perlin-Worley (dilated Perlin) | Worley fBM, freq 1 | Worley fBM, freq 2 | Worley fBM, freq 3 | base shape |
| B "high frequency" | 32^3 | Worley | Worley, higher | Worley, higher | none | edge erosion |
| Cirrus/alto | 512^2, 3 ch | | | | | 2D layer at the ray end [p.125] |
Frequencies per channel are **not stated** (only "increasing"); the figure shows G/B/A visibly finer each step. Curl texture size is **not stated** (the 128^2 RGB comes from HZD s33). `[p.101]`: the Perlin-Worley remap is written `PerlinWorley = NewMin + ((Perlin - OldMin)/(OldMax - OldMin)) * (NewMax - NewMin)` with `OldMin = Worley_FBM`; the code on [p.106] realises it as below (note it is in fBM-of-Worley, not a single Worley).

**Sampler chain** [p.105-109]
```
height_fraction = saturate((p.z - min) / (max - min))                 // p.104
Remap(v, a, b, c, d) = c + (v - a) / (b - a) * (d - c)                // p.105 (no clamp)
low_freq_FBM   = A.g*0.625 + A.b*0.25 + A.a*0.125                      // p.106
base_cloud     = Remap(A.r, -(1.0 - low_freq_FBM), 1.0, 0.0, 1.0)      // p.106  lower bound is NEGATIVE
base_cloud    *= GetDensityHeightGradientForPoint(p, weather_data)     // p.106  (body not given)
cov            = weather_data.r                                        // p.107
base_cov       = Remap(base_cloud, cov, 1.0, 0.0, 1.0) * cov           // p.107
p.xy          += curl_noise.xy * (1.0 - height_fraction)               // p.108  bottoms only; no strength scalar
hf_noise       = tex3Dlod(B, p * 0.1, mip).rgb                          // p.108  the only stated scale between A and B
high_freq_FBM  = hf.r*0.625 + hf.g*0.25 + hf.b*0.125                    // p.108
modifier       = mix(high_freq_FBM, 1.0 - high_freq_FBM, saturate(height_fraction * 10.0))  // p.108
final_cloud    = Remap(base_cov, modifier * 0.2, 1.0, 0.0, 1.0)        // p.109
```
Reading the base remap: with a high Worley fBM the lower bound is near 0 and the Perlin-Worley passes unchanged; with a low fBM the bound drops towards -1, so the same R is lifted to (R+1)/2, i.e. the Worley fBM **dilates** the base wherever it is dark. Erosion by 0.2 * modifier caps removal at 20% of the density scale; because `final = remap(base, e, 1)`, small clouds lose proportionally more.

**Wind/animation** [p.109-110]: `wind_direction = (1,0,0)`, `cloud_speed = 10.0`, `cloud_top_offset = 500.0`;
`p += height_fraction * wind_direction * cloud_top_offset;` then `p += (wind_direction + float3(0,0.1,0)) * time * cloud_speed;` Both **before any texture read**. Note the "upward" bias is added to **`.y`**, while this chapter's own height is `.z` (`GetHeightFractionForPoint`, p.104): as printed it is a sideways drift, not upward; read it as `float3(0, 0, 0.1)` in this chapter's convention (or the listing comes from a y-up engine). Time unit and p unit are not stated, so 10 and 500 are in the engine's units (500 m in N17 s45, same constant).

**Ray march** [p.119-124]: shell 1.5 km start, 3.5 km thick; 64-128 steps; cheap-to-full switch, **6** zero samples to return; light march **6 taps max** in a cone, kernel of six noise vectors in (-1,-1,-1)..(1,1,1) with magnitude growing with step index; density sampled at `mip_level + 1`; cheap density in the light march once view-ray accumulated density exceeds **0.3**; one extra long tap at **3x the cone length** for distant-cloud shadow.

**Lighting** (parked, kept exact) [p.111-119]: Beer `E = exp(-d)`; HG `p = 1/(4pi) * (1-g^2)/(1+g^2-2g cos(theta))^1.5` with **g = 0.2**; powder `1 - exp(-2d)`; combined `E = 2 * exp(-d*p) * (1 - exp(-2d)) * HG`, `p` = rain absorption multiplier from the precipitation channel (Fig 4.30 plots 3, 6, 9) [p.118-119]. Book code for HG ends `/ 4.0 * 3.1415` which is **not** 1/(4pi) (a printed bug; the equation above it is right).

**Height gradients as drawn, Fig 4.10 [p.103]** (the only information on them; I measured the render's grey levels, so values are +-0.03). Heights are 0 = layer bottom.
| Panel (caption) | Rise | Plateau | Fall | Reading |
| --- | --- | --- | --- | --- |
| left "stratus" | from 0 | thin band, peak about 0.08 | gone by about 0.105 | very thin, soft below, hard above |
| centre "cumulus" (text says stratocumulus) | 0.03 to 0.20 | 0.20 to 0.42 | 0.42 to 0.60 | bottom half of the layer |
| right "cumulonimbus" | 0 to about 0.07 | to 0.75 | 0.75 to 1.00 (half at 0.87) | fills the layer, soft top |
The text names the three as stratus, stratocumulus, cumulus [p.103], the caption as stratus, cumulus, cumulonimbus: a **labelling inconsistency in the source**; the figure shows low-band / mid-band / full-height.

## Code listings (extracted/gp7/code/, PDF page file names)
| Book page | File | What it does |
| --- | --- | --- |
| 104-105 | `gp7-p08.hlsl` | `GetHeightFractionForPoint` (height in `.z`) |
| 105 | `gp7-p09.hlsl` | `Remap` |
| 105-106 | `gp7-p09-10-sample-base.hlsl` | start of `SampleCloudDensity`: 128^3 read, fBM weights, negative-bound remap, height gradient |
| 106-107 | `gp7-p10-11-coverage.hlsl` | coverage remap and multiply |
| 108-109 | `gp7-p11-13-detail.hlsl` | curl distort, 32^3 read at `p*0.1`, fBM, wispy/billowy mix, erosion remap, return |
| 109-110 | `gp7-p13-14-wind.hlsl` | wind constants, skew, drift |
| 112 | `gp7-p16-beer.hlsl` | Beer |
| 113 | `gp7-p17-hg.hlsl` | HG (with printed constant bug) |
| 116 | `gp7-p20-powder.hlsl` | powder / Beer-powder |
| 121-122 | `gp7-p25-27-raymarch.hlsl` | cheap/full march loop, 6-zero reset |
| 122-123 | `gp7-p26-27-lightguard.hlsl` | light march only when density != 0 |
| 124 | `gp7-p28-cone.hlsl` | cone light taps (kernel contents omitted in the book) |
Known printed errors, kept: `if (sampled_density = 0.0)` (assignment), `Remap` has no `;`, `for i<=6` is seven taps, `density_along_view_cone` undeclared, `SampleCloudDensityAlongCone` returns nothing, `cone_spread_multplier` typo, curl_noise and `GetDensityHeightGradientForPoint` are never defined.

## Figures that explain shape (book page, PDF page = -96)
- Fig 4.5 [p.100]: Perlin vs "puffy" Perlin vs cauliflower photo; the case for Worley.
- Fig 4.7 [p.101]: inverted Worley, Worley fBM, Perlin-Worley side by side. Best single picture of the dilation.
- Fig 4.8 [p.102]: the four 128^3 channels (PW then three Worleys); Fig 4.9: 32^3 channels (note the coarse pixel grain).
- **Fig 4.10 [p.103]**: the three height gradients (see table above). Fig 4.11: the clouds each gives.
- Fig 4.12 [p.104]: weather map and its R/G/B signals (60 km).
- Figs 4.13, 4.14, 4.16 [p.106, 107, 109]: the base shape, with coverage, and after detail; the same view at each stage of the chain. Fig 4.15 [p.108]: billowy vs wispy photo reference.
- Fig 4.37 [p.125]: the 2D alto/cirrus textures used above the volume.

## What we already do / what we don't / what to try
Our procedural code: `packages/runtime/src/procedural/density.wgsl.ts` (Takram shaper `procSample` at :207, Sky Pro shaper `procCandidate` at :89), `textures.ts` (128^3 R8 shape, 32^3 R8 detail, 64^3 RGBA Sky Pro), `trace.wgsl.ts` (march). Board tasks not linked here (see `work/`).

| GPU Pro step | Ours | Verdict |
| --- | --- | --- |
| 128^3 RGBA PW + 3 Worley, one read, 3-weight fBM `0.625/0.25/0.125` dilating R | Takram shape is a **single R8 channel** (`textures.ts` loads `shape.bin` as r8unorm; `procSample` reads `.r` at density.wgsl.ts:214); Sky Pro reads RGB with its own weights `(0.7,0.41,0.23)` for dilation and `(0.113,0.04,0.02)` for erosion (:108, :124), 64^3 | **Missing in the Takram path; differs in Sky Pro** (different weights, a sum added to the top height rather than a remap of R) |
| negative-bound remap `Remap(R, -(1-fbm), 1, 0, 1)` | `procRemap4(density, (1-shape)*tkShape, 1)` (:215): erosion threshold from the shape noise, applied after the weather coverage (:196-199) | **Different order and form**: ours is a HZD-2015 s35 style erosion by the shape, theirs a dilation of the shape before coverage |
| 3 weighted height gradients by weather type (B channel) | one semicircle per layer, bias 0.35 (`procShapeAltering` :178-182), no continuous type | **Missing** (section 4 gives the figure-derived targets) |
| Coverage `Remap(base, cov, 1, 0, 1) * cov` | `factor = 1 - cov*gradient; remap(weather, factor, factor+width)` (:195-197), no `* cov` multiply (Sky Pro: `top = weather + cov - 1 + dilation*cov`, :109, which does include a cov factor on the dilation) | **Differs**: the final `* cov` that lightens small clouds is absent in Takram |
| Curl on **detail only**, strength `(1 - h)` | 2D turbulence on **both** shape and detail (`(wp + turb)`, :214, :219), strength from `remap(hf, 0.3, 0)` times density (:212), 350 m | **Differs** (and tears the silhouette, see `procedural-shape.md` M5) |
| 3-weight detail fBM `0.625/0.25/0.125` | detail uses `.r` only (:219) | **Missing** |
| `mix(fbm, 1-fbm, saturate(h*10))`: switch over the first 10% of the layer | `mix(pow(detail,6), 1-detail, remap(hf, 0.2, 0.4))` (:221) | **Differs**: our switch is 2-4x higher up the layer and wispy side uses a power curve |
| erosion `Remap(base, mod*0.2, 1, 0, 1)` | `remap(density*2, mod*0.5, 1)` (:223): stronger | **Differs** (starting point only; both were tuned for different textures) |
| wind: height skew, 500, drift `(wind + (0,0.1,0))*t*10`, per-texture speed | Sky Pro skew `spWind.z * h` and evolution `P.wind.z` (:98); Takram weather drift only | **Partly**: no upward bias, no separate speed per noise |
| cheap (tex A only) then full samples, 6-zero return | `procSample(full)` cheap/full flag; march returns to coarse after **4** empty steps (trace.wgsl.ts:24-26) | **Have**, 4 vs 6 |
| 6 cone taps, 0.3 threshold, long 3x tap | six cone taps, cheap density once ray half opaque (`P.steps.w`, :239), far taps | **Have** (different thresholds) |
| rain: coverage >= 0.7 and type to cumulonimbus where precip = 1 | no precipitation channel | **Missing** |
| shell 1.5-4 km spherical | Earth-curvature altitude `procAltitude`; shell parameters from `spShell` | **Have** |
| 2D cirrus at the ray end | separate cirrus system, not in this path | n/a |

**Top "try next" for shape/layering/detail** (all refer to this source):
1. **Read all four channels of the shape texture** and apply the dilation `Remap(R, -(1 - (0.625G + 0.25B + 0.125A)), 1, 0, 1)` before coverage [p.106]; needs the RGBA shape texture, not the R8 Takram one.
2. **Three-weight detail fBM** `0.625/0.25/0.125` and the `saturate(h*10)` switch (try it as a second mode next to our hf 0.2-0.4) [p.108].
3. **Three type gradients mixed by a weather-B "type"** [p.103]; the chapter gives only the Fig 4.10 picture (stratus 0-0.1, mid band rising 0.03-0.2 falling 0.42-0.6, tall 0-0.07/0.75-1.0). For the shipped HZD curves use the exact Nutshell stops (`nut.md`, slide 7-8 XML: stratus 0.02/0.07/0.11/0.18, stratocumulus 0.04/0.16/0.32/0.48, cumulus 0.01/0.09/0.65/0.80), which N17's measured in-game strips confirm; then tune against the owner's photos.
4. **Curl on detail only, strength `(1 - h)`**; drop the turbulence from the shape lookup [p.108].
5. **Coverage multiply `* cov`** after the remap, and a precipitation channel biasing type and coverage >= 0.7 [p.104, 107].

## Superseded by / supersedes
- Same chain as HZD 2015 ARTR s29-38 (that deck has no code or constants); this chapter supplies the code. N17 (2017) later replaces the density-height trapezoid and adds the anvil exponent; NE 2022 replaces the chain with the profile/NDF model (`hzd-nubis-evolved.md`).
- Constants I could verify: see section 4 (recalled-constant table).

## 4. Recalled constants vs this source (settles `procedural-shape.md` and `hzd-nubis-evolved.md`)
| Recalled item (location) | Sourced value here | Right? |
| --- | --- | --- |
| shape fBM `g*0.625 + b*0.25 + a*0.125` (procedural-shape M1) | identical [p.106] | **Right** |
| `base = remap(r, -(1 - lfFbm), 1, 0, 1)` (M1) | identical [p.106] | **Right** |
| `base *= heightGradient(type, h)` (M1) | identical, but the gradient function body is not in the chapter [p.106] | **Right**, constants still unsourced |
| `base = remap(base, cov, 1, 0, 1) * cov` (M1) | identical [p.107] | **Right** |
| `p += curl.xy * (1 - h) * curlStrength`, "strength by height" (M1, M5) | `p.xy += curl_noise.xy * (1.0 - height_fraction)`; **no separate curlStrength**; `curl_noise` is never defined [p.108] | **Mostly**: the `(1-h)` is right, "curlStrength" does not exist in the chapter |
| detail fBM `r*0.625 + g*0.25 + b*0.125` (M1) | identical [p.108] | **Right** |
| `mod = mix(hfFbm, 1 - hfFbm, saturate(h*10))` (M1) | identical [p.108] | **Right** |
| `d = remap(base, mod*0.2, 1, 0, 1)` (M1) | identical [p.109] | **Right** |
| detail sampled at `p * 0.1` | `p * 0.1` [p.108] (not previously noted) | New fact |
| stratocumulus gradient `(0, 0.2, 0.48, 0.625)` (M2) | **Not in the chapter.** Fig 4.10 centre panel measures rise 0.03-0.20, plateau to 0.42, fall 0.42-0.60 [p.103] | **Not verifiable**; the figure is consistent with it (rise end 0.2, fall 0.48-0.625 centres near 0.55) |
| cumulus `(0, 0.1, 0.8, 1)` or `(0.01, 0.3, 0.6, 0.95)` (M2) | **Not in the chapter.** Fig 4.10 right panel (captioned cumulonimbus) measures rise 0-0.07, fall 0.75-1.00 [p.103] | **Not verifiable**; `(0, 0.1, 0.8, 1)` matches the figure's right panel (which is full-height, so it is the *cumulonimbus* gradient, not a small cumulus); `(0.01, 0.3, 0.6, 0.95)` matches nothing drawn |
| stratus `(0, 0.1, 0.2, 0.3)` (from N17 s28-29) | **Not in the chapter.** Fig 4.10 left panel: thin band peaking about 0.08, gone by 0.105 | Not verifiable; N17's printed pair (peak at 0.1-0.2, gone by 0.3) is **higher and thicker** than this figure, but it is only an example: N17's in-game strip and the Nutshell XML give stratus 0.02/0.07/0.11/0.18, close to this figure's thin band |
| blend `type<0.5 ? mix(stratus,strato,2t) : mix(strato,cumulus,2t-1)` (M2) | **Not in the chapter**: "weighted sum of the three functions" with weights from the weather map [p.103] | **Not verifiable**; the text suggests weights, not a two-segment lerp |
| anvil bias, coverage exponent (hzd-nubis-evolved.md:60-62, "GPU Pro 7 / 2017 item") | **No anvil term anywhere in the chapter.** The exact anvil form is N17's (`legacy-and-survey.md:86`, `pow(coverage, remap(h, 0.7, 0.8, 1, lerp(1, 0.5, anvil_bias)))`) | **Wrong attribution**: it is not GPU Pro 7; fix those notes |
| "Frequencies roughly octave doubling" (hzd-nubis-evolved.md:117) | frequencies not given [p.102] | **Unverified, stays unverified** |
| cheap/full march, six-zero return, six light taps, 0.3 threshold, 3x long tap | as listed [p.120-124] | New (not in recalled list) |
| rain: type to cumulonimbus, coverage >= 70% at precip 100% | stated [p.104] (prose only, no formula) | **Right** in spirit |

## Contradictions with existing notes
- `hzd-nubis-evolved.md:60-62` says the anvil bias is "a GPU Pro 7 / 2017 item": it is **not in GPU Pro 7**.
- `procedural-shape.md` M5 "strength by height is recalled": confirmed as `(1 - h)` only; "second octave of curl" there is our own suggestion, not in the source.
- `procedural-shape.md` Section 1 table says our semicircle matches "HZD s34"; GPU Pro Fig 4.10 shows **trapezoids with different tops and bases**, not one semicircle, so type-dependent profile is the thing we lack.

## Review (Opus spot-check, 2026-10-10)
- shape fBM `0.625/0.25/0.125` and `Remap(r, -(1 - fbm), 1, 0, 1)` [p.106] → ✔ (page text)
- coverage `Remap(base, cov, 1, 0, 1) * cov` [p.107] → ✔
- `p.xy += curl.xy * (1 - h)`, detail read at `p * 0.1`, `mix(fbm, 1 - fbm, saturate(h * 10))`, `Remap(base_cov, mod * 0.2, 1, 0, 1)` [p.108-109] → ✔
- wind `(1,0,0)`, speed 10, top offset 500, `(wind + (0, 0.1, 0)) * time * speed` [p.109-110] → ✔, with a new caveat: the bias is on `.y` while height is `.z` (added above)
- rain: type to cumulonimbus, coverage at least 70% where rain is 100% [p.104] → ✔
- HG g = 0.2 [p.112]; equation `1/(4 pi)`, code `/ 4.0 * 3.1415` [p.113]; Beer-powder `2 e^-d (1 - e^-2d)` [p.116, 119] → ✔
- shell 1.5 km + 3.5 km, 64-128 steps [p.119]; six zero samples [p.120]; six cone taps, kernel in -(1,1,1)..(1,1,1), 0.3 switch, long tap at 3x cone [p.123-124]; 20 MB / 2 ms, 20 ms raw [p.98, 125] → ✔
- Fig 4.10 table [p.103] → ✔ re-measured on the 110 dpi render: stratus full 0.077, half 0.09, zero 0.097; middle 5% at 0.03, full 0.20, full to 0.41, half 0.50, zero 0.59; right full 0.08, full to 0.74, half 0.85, zero 0.96
- runtime `procedural/density.wgsl.ts:214` (shape `.r` only), `:221` (`mix(pow(detail,6), 1 - detail, remap(hf, 0.2, 0.4))`), `:108`/`:124` Sky Pro weights → ✔; `trace.wgsl.ts:24-26` back to coarse after four empty steps → ✔

**Cross-note consistency** (sources that genuinely differ, kept separate):
- **Detail switch and strength**: GPU Pro 7 `saturate(h * 10)` with `* 0.2` [p.108-109]; Häggström `saturate(ph * 5)` with `0.35 * exp(-0.75 gc)` (`hag.md`, B.5 p.79); NE22 envelope model switches at the cloud type ±0.1 (`ne22.md` p.99); Synthesizing picks by type, not height (`syn.md` s12). Four different rules; cite the one you port.
- **HG scale**: `/ 4.0 * 3.1415` (= x π/4, not ÷4π) is printed in GPU Pro 7 p.113, N17 p.77 and Häggström B.6 p.80 (whose `csi`/`cse` were tuned against that scale); the equations in GP7 and the rsqrt listings in HFW p.31, NE22 p.48 and Synthesizing s51 use the correct `1/(4π)`.
- **Height gradients**: this Fig 4.10 is the same image as HZD 2015 s34 (`hzd15.md`, same stops). The Nutshell XML (`nut.md`) and N17's measured in-game strips (`n17.md`) agree with each other and differ from this figure (lower and thinner middle type; cumulus to 0.80 rather than a full-height column). N17's printed stratus `(0, .1, .2, .3)` is an example. NE22 replaces all of them with 2D tables (images only).
- **Weather G channel**: GPU Pro 7 [p.103] and HZD 2015 s40 say G = precipitation; N17 p.53-56 and the Nutshell s16 say R and G are two coverage footprints and there is no precipitation channel; Häggström uses G as high-coverage fill. Record which talk you follow.

