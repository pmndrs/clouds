# Topic guide: shape (the procedural density chain)

RS-5, 2026-10-10. One place for every source's version of each step of the density chain, with the numbers side by side, so nobody re-reads six decks to find a constant. Map of all guides: [README.md](README.md). Layering and weather are in [layering.md](layering.md) and [weather.md](weather.md); surface detail (voxel up-rez, HHF fold, step size) belongs to `surface-detail.md` (not written yet).

**Owner direction (2026-10-10).** Master the procedural chain first. **Horizon Zero Dawn is the floor and the target, judged with the owner's photos.** Takram and Sky Pro are simplified single-type takes on HZD: `packages/runtime/src/procedural/` is ported from them, so it is "where we are", not "what is right".

## Conventions
- Source ids link to the reviewed notes in `../sources/`: [hzd15](../sources/hzd15.md), [gp7](../sources/gp7.md), [n17](../sources/n17.md), [nut](../sources/nut.md), [hfw](../sources/hfw.md), [ne22](../sources/ne22.md), [n3](../sources/n3.md), [syn](../sources/syn.md), [hag](../sources/hag.md), [web18](../sources/web18.md), [bou08](../sources/bou08.md), [noise](../sources/noise.md), [tvn](../sources/tvn.md), [psrd](../sources/psrd.md), [survey](../sources/survey.md). Citation forms follow each note: hzd15 `sNN` printed slide; gp7 `p.N` book page; n17 and ne22 PDF page; nut and n3 `sNN` pptx order; hag printed page; web18 PDF page.
- **Code** = local transcription under `X/` = `/Users/dex/Developer/WebGPUClouds/artifacts/research/extracted/` (not committed).
- **Ours** = `packages/runtime/src/`. Three density paths exist today:
  - **P** `procedural/density.wgsl.ts`: the per-sample Takram shaper (`PROC_TAKRAM_WGSL`, :175-241) and Sky Pro shaper (`PROC_SKYPRO_WGSL`, :85-172). The only fully procedural march.
  - **G** the generator plus the distant sky layer: our own species level set `f = s - g(h)` (`generate/shaders.ts:6-74`, `shaders/sky-layer.wgsl.ts:137-166`), turned into a (profile, detail type, density scale) triple and fed to the N3 up-rez.
  - **V** the voxel up-rez, a port of N3 s109 (`shaders/density.wgsl.ts:39-76`).
  - **None of the three runs the HZD chain.** That is the headline gap.
- Notation: `h` = height fraction in the layer (0 base, 1 top); `P` = dimensional profile; `remap(v,a,b,c,d) = c + (v-a)/(b-a)*(d-c)`, unclamped unless noted; `sat` = clamp 0..1.

## 0. The chain at a glance (HZD order, and who defines each step)
| # | Step | HZD-era definition (the floor) | Later replacement (the target) | Ours |
| --- | --- | --- | --- | --- |
| 1 | Base shape noise | 128^3 RGBA: R Perlin-Worley, GBA Worley fBMs; dilate R by `.625G+.25B+.125A` [gp7 p.106] | voxel era: Alligator / Curly-Alligator channels [n3 s89-90] | P: R8 single channel; G/V: N3 pack noise |
| 2 | Height profile | 3 trapezoids blended by type [nut s7-8, n17 p.28-32] | top LUT × bottom LUT [ne22 p.21-28, n3 s18] | P: one semicircle per layer; G: `h^p` per species row |
| 3 | Coverage | `remap(base*grad, 1-cov, 1, 0, 1)` [hfw p.17] (+ `*cov` [gp7 p.107]) | `P = profile * cov` [ne22 p.29] | P: threshold `1 - cov*grad` on the 2D weather |
| 4 | Detail erosion | 32^3 Worley fBM, wispy→billowy by height, `*0.2` [gp7 p.108-109] | wispy/billowy composites by type [n3 s23, ne22 p.99] | P: R8 single channel; G/V: N3 |
| 5 | Erosion law | remap with noise as the lower bound [n17 p.36] | additive `sat(n - (1-P))` [n3 s24, ne22 p.34] | P: remap; G/V: ValueErosion |
| 6 | Curl | on the detail lookup only, `(1-h)` [gp7 p.108] | baked into Curly-Alligator [n3 s90] | P: on shape and detail |
| 7 | Anvil | coverage pow near the top [n17 p.46] | flipped profile + storm cirrus [hfw p.72-73] | P: none; G: hand-built storm cell |
| 8 | Density shaping | base fade before erosion [hzd15 s35] | `pow(.., 0.27)`, `S^4` sharpen [ne22 p.105, n3 s109] | P: linear layer profile after erosion |

---

## 1. Height profiles: every number in one table
`(a, b, c, d)` = rise start, full, fall start, zero, in the N17 form `grad = remap(h,a,b,0,1) * remap(h,c,d,1,0)` (clamp each factor).

| Source | Stratus | Stratocumulus / middle | Cumulus / tall | Exactness | Use |
| --- | --- | --- | --- | --- | --- |
| **nut s7-8** (slide-XML gradient stops, linear) | 0.02 / 0.07 / 0.11 / 0.18 (s7: rise from 0.00) | 0.04 / 0.16 / 0.32 / 0.48 | 0.01 / 0.09 / 0.65 / 0.80 | exact to ±0.005 | **adopt** (the shipped curves) |
| n17 p.30-32 (in-game strips, measured) | 0.01 / 0.07 / 0.10 / 0.18 | 0.03 / 0.16 / 0.32 / 0.47 | 0.00 / 0.09 / 0.65 / 0.79 | ±0.02 | confirms nut |
| n17 p.28 (printed example) | 0 / 0.1 / 0.2 / 0.3 | | | exact, but an example | do not port |
| hzd15 s34 = gp7 Fig 4.10 (same image; captions stratus, cumulus, cumulonimbus) | full 0.077, zero 0.097 | 5 % at 0.03, full 0.20, to 0.41, half 0.50, zero 0.59 | full 0.08, to 0.74, half 0.85, zero 0.96 | measured ±0.03 | 2015 illustration only |
| `procedural-shape.md` M2 "recalled" | | 0 / 0.2 / 0.48 / 0.625 | 0 / 0.1 / 0.8 / 1 or 0.01 / 0.3 / 0.6 / 0.95 | unsourced | do not port |
| hag eq 5-7 (`SA`, code B.2) | one law for all: rise 0..0.07, fall from `0.2·wh` to `wh`, `wh = sat(B + 0.12)` | | | exact | per-cloud height (§9) |
| hag eq 8-10 (`DA`, code B.3; applied **after** the threshold) | `ph · sat(remap(ph,0,0.2,0,1)) · sat(remap(ph,0.9,1,1,0)) · wd · 2` | | | exact | density ramp (§10) |
| ne22 p.97 / n3 s20 envelope | `h^2 · (1-h)^1.5 · edge(0..35 m)`; peaks at h = 0.571, value 0.091 (needs rescale) | | | exact | orographic only (layering.md) |
| ne22 p.21-28 / n3 s18 tables | see §2 | | | sampled CSV | **target** |
| web18 | no vertical profile; a hard band `e_i .. e_i + r_i` | | | | — |
| Ours P (Takram) `procShapeAltering` `1 - (2h^0.35 - 1)^2` (`procedural/density.wgsl.ts:178-181`, bias `settings.ts:144`) | one dome for every layer: peak at h 0.14, 0.67 at h 0.5, 0.14 at h 0.9 | | | | replace |
| Ours G `g = h^p` above the base, linear sag below (`generate/shaders.ts:22-28, 49`) | p 12, 170 m | p 3, 360 m | humilis p 2.8 / 220 m; mediocris 2.1 / 750 m; congestus 1.6 / 1650 m | | keep for G, A/B against §2 |

**Readings.**
- The shipped HZD curves are **trapezoids with flat cores**. Cumulus is full from 0.09 to 0.65 and empty above 0.80, which leaves the top fifth for the anvil band [n17 p.35, p.46]. A semicircle has no flat core and no flat base, so it cannot produce either.
- Type blend: the law is **not printed anywhere** [n17 p.29, nut s7]. gp7 p.103 says "weighted sum of the three"; n17 says type "moves the in and out points". Use a piecewise-linear lerp of `(a,b,c,d)` across type 0 / 0.5 / 1, as n17.md infers. Lerping the points (not the curves) keeps one flat core instead of a double hump.
- The cumulus rise (0.01 to 0.09) is the same in every source; only the tops differ. Trust the base ramp.

**Recommendation.** For the HZD floor shaper (try-next S1), use the nut stops, linear, lerped by type. For the target, move the sky layer to the §2 LUTs (try-next S3). Tune either against the photo silhouettes, not the numbers: humilis w:h median 2.3 with base wobble 0.09 of height; mediocris w:h 1.7, 2-4 stacked domes; congestus a cone of w:h 0.5-1.1 on a 1.5-3x wider pedestal [`photo-species-specs.md` §1-3].

## 2. Top and bottom type tables (NE / N3 s18 data)
- **Sources:** ne22 p.21-22 (top table), p.26-27 (bottom table), p.28 (product); n3 s18 (both tables as 64×64 images, the only full-resolution copy); hfw p.53 (three LUTs: top, type, bottom).
- **Code:** `X/n3/code/n3-s018.hlsl`, `X/n3/code/n3-sampler-hzd.hlsl`; data `X/n3/data/n3-s018-lut-top-type.csv`, `...-bottom-type.csv` (row 0 = bottom, column = type 0..1).
- **Formula:** `vertical_profile = topLUT(top_type, h) * bottomLUT(bottom_type, h)`; `P = vertical_profile * coverage` [n3 s18, ne22 p.29].
- **What the data say** (re-sampled here from the CSVs; `n3/slides-001-046.md` "Profile tables"):
  - Both tables share a **floor at h ≈ 0.27**: below it top = 1 and bottom = 0, so the product is 0. The cloud lives in h 0.27..1 of the table.
  - **Top type:** the last height where the value is still 0.5 rises in steps with type: type 0 → 0.25, 0.06 → 0.27, 0.13 → 0.33, 0.19-0.25 → 0.41, 0.31 → 0.43, 0.38 → 0.49, then a jump to 0.78-0.87 from type 0.44 up. High types are **not monotone**: a dip at h 0.5-0.6 and a second shoulder at 0.65-0.7 (tiered tops), then a taper to about 0.4 at the top (soft, erodible heads).
  - **Bottom type** (max 0.91, so the product never reaches 1): type 0 rises from 0.33 to 0.80 within 0.1 of the floor (**crisp, flat base**); type 1 rises slowly, 0.2 at +0.06, 0.5 at +0.28, 0.8 at +0.54 (**long, ragged underside**). The half-rise height moves from 0.30 (type 0) to 0.46 (type 1).
  - Bottom type 0 is the **crisp** base: settled in n3.md §7a against ne22 p.26-27 and our generator. Older notes that say "ragged" are wrong.
- **Open (not owner):** top type 0 × any bottom type gives almost nothing (product max 0.02 at h 0.27): top type 0 is a one-row sheet sitting exactly on the floor. Whether NE's `min height` maps to h = 0 or to the floor is not stated. Measure it from ne22 p.25 (stratus render) before porting, or treat top type below about 0.1 as "no cloud".
- **Ours:** G has one axis (species row `g`) that sets both top exponent and bottom sag together (`generate/shaders.ts:22-28`); no independent bottom type channel; no tiered or non-monotone tops. P has nothing.
- **Recommendation:** add a LUT mode to the sky layer that samples the two CSVs as `r8unorm` 64×64 textures, with independent top/bottom type read from the weather (try-next S3). Judge against the s17/s21/s24 posters (`image28`-`31`, before/after erosion) and ne22 p.23-25, 27.

## 3. Coverage: remap forms and sign conventions
| Source | Printed form | Literal reading | Consistent reading |
| --- | --- | --- | --- |
| hzd15 s35 | `SetRange(shape × grad) × coverage × baseFade` | multiply | — |
| gp7 p.107 | `Remap(base, cov, 1, 0, 1) * cov` | higher cov = higher threshold = fewer clouds, then a multiply | threshold `1 - cov`, keep `* cov` (small clouds lighter) |
| n17 p.40, nut s13 | `remap(noise[*grad], coverage, 1, 0, 1)` | same sign problem; the slides say coverage inflates | `1 - coverage` |
| **hfw p.17** | `remap(base * vert_profile, 1 - coverage, 1, 0, 1)` | consistent as printed | **adopt** |
| hag eq 12 | `sat(R(SN·SA, 1 - gc·WMc, 1, 0, 1)) · DA` | consistent; no `* cov` | low coverage gives a near-binary edge (divides by `gc·WMc`; guard → 0) |
| ne22 p.29 + p.34 | `P = profile * cov`, then `sat(n - (1 - P))` | consistent; coverage lowers the threshold and fattens | target |
| web18 p.5 | `a = (1 - c̄α) s - (1 - α) c̄`, `c̄ = 1 - c` | α = 1 fade (multiply), α = 0 shrink (subtract) | per-type lifecycle (weather.md) |
| Ours P Takram (`procedural/density.wgsl.ts:195-196`) | `factor = 1 - cov * grad; remap(weather, factor, factor + width)` | consistent; gradient inside the threshold, applied to the **2D weather value**, not to the 3D noise | — |
| Ours P Sky Pro (`:109`) | `top = weather + cov - 1 + dilation * cov` | height-field shift (α = 0 shrink) | — |

- **Where the gradient goes matters.** HZD/N17/hag threshold the **3D product** `noise × grad`, so noise breaks the tops and bases. Takram thresholds the **2D weather × grad**, then erodes by noise afterwards, so the silhouette envelope is a smooth surface of revolution under the noise. This is a likely cause of our "blob" read.
- **Recommendation:** HZD shaper uses `remap(base * grad, 1 - cov, 1, 0, 1)` [hfw p.17], with gp7's `* cov` as an A/B switch. Add the hag guard (`max(gc·WMc, 1e-3)`).

## 4. Erosion laws side by side
| Law | Formula | Core (P = 1) | Edge | Noise sign | Sources |
| --- | --- | --- | --- | --- | --- |
| Additive (HZD floor / NE) | `sat(n - (1 - P))` | `d = n`: the noise stays visible **inside** at full strength | only noise above `1 - P` survives | high n = **more** cloud | n3 s24, ne22 p.34, `X/n3/code/n3-s024.hlsl`, `X/ne22/code/ne22-p034.hlsl` |
| Remap / ValueErosion | `sat((P - n) / (1 - n))` | 1: flat, textureless core | P must exceed n; slope `1/(1-n)` | high n = **more** erosion | n17 p.36, nut s11, hfw p.15 (lower bound `1 - hf`), gp7 p.109 (bound `mod*0.2`), n3 s107, syn s34-35 |
| Dilation remap | `remap(R, -(1 - fbm), 1, 0, 1)` | R passes | a dark fBM lifts R toward `(R+1)/2` | grows, never erodes | gp7 p.106, hag eq 11 |
| Subtraction | `max(phi - delta, 0)` | `phi - delta` | — | — | web18 p.5 |
| Hypertexture | `S(D + n)`, D and n in metres | homogeneous core | rim width = sigmoid width | signed (bulge or bite) | bou08 p.7 |
| Ours P Takram | shape `remap(d, (1-shape)*amount, 1)` then detail `remap(2d, mod*0.5, 1)` (`:215, :223`) | flat | | | |
| Ours P Sky Pro | `smoothstep(-e, e, top - erosion - h)` (`:125`) | height field: no overhangs | | | |
| Ours G/V | `valueErosion(P, n)` (`shaders/density.wgsl.ts:65`; sky layer calls it at `shaders/sky-layer.wgsl.ts:582`) | flat | | | |

- **The one fact people miss:** the two laws use **opposite noise signs**. N3's channels are tuned for ValueErosion (billowy B/A scaled 0.3, so low values mean shallow dents). Porting the additive law onto the N3 noise needs `n' = 1 - composite`, or the core reads as negative space. Test both signs.
- **Why it matters for HZD:** the additive law keeps texture inside distant bodies and turns a slow profile ramp into ragged bases (only noise peaks survive). ValueErosion flattens the core to 1 and puts all detail in the rim band. n3.md §5 row 4 already flags our sky layer as "mismatch vs HZD".
- **Recommendation:** A/B in the sky layer (try-next S4); the HZD shaper uses the remap chain as GP7 printed it (it is the floor), and gets the additive law as its "NE mode".

## 5. Base shape noise (channels, dilation, generators)
| Source | Texture | R | G, B, A | Combine |
| --- | --- | --- | --- | --- |
| hzd15 s31, gp7 p.102 | 128^3 RGBA | Perlin-Worley | Worley fBMs, rising frequency (no numbers) | `fbm = .625G + .25B + .125A`; `base = remap(R, -(1-fbm), 1, 0, 1)` [gp7 p.106] |
| **noise** (Guerrilla Houdini HDA, the author's own tool) | 128^3 RGBA, 8-corner cross-blend tiling (25 % border, 58 % of voxels blended, std 16 % lower) | 5-octave Perlin at 5 cells/tile (rough 0.54) through four Worley black-point remaps: `0.5·W(2f)`, `0.2·W(4f)` raise; `-0.1·(1-W(17f))`, `-0.1·(1-W(33f))` lower; final `(r+0.1)/1.2` → [0.083, 0.917], mean 0.50, std 0.105 | one recipe at gain g = 1, 1.7, 2.3: `a = (W(10g) + W(19g)/3 + W(25g)/6 + W(37g)/8 + W(5g)/3)/5`, `out = fit(1-a, 0.75, 1)`; mean 0.69, std 0.10 | (gp7 weights apply) |
| tvn (Hillaire, MIT) | 128^3 + 32^3 RGBA8, exact periodic | `wfbm + perlin·(1-wfbm)`, Perlin f8 ×3 octaves (weights square: .5/.25/.0625) | doubling: G 8/16/32, B 16/32/64, A 32/64 cells | packed option bakes gp7's combine (loses runtime control). Defects: diagonal feature points, sin hash, Nyquist at A |
| hag eq 11 | 128^3 RGBA | PW | Worley | identical to gp7 |
| n17 p.34 | — | `pw = remap(perlin, 1 - worley, 1, 0, 1)` | | |
| n3 s89-90 (voxel) | 128^3 RGBA8 (the "2 B/texel" label is wrong, n3 §7b) | Curly-Alligator LF/HF (R/G), Alligator LF/HF (B/A) | | replaces PW and inverted Worley |
| web18 p.13 | analytic | `phi = k + (1-k)·h(0.43, 1, n(px·0.35, py, pz)/1000)`, n: 8 oct, persistence 0.52, lacunarity 2.02, freq 36 (unit 100 m) | | the `px·0.35` stretch gives streets/bands (layering.md) |
| Ours P Takram | `shape.bin` 128^3 **R8** (`procedural/textures.ts:4, 35`), read `.r` only (`density.wgsl.ts:214`) | unknown recipe | **not stored** | `remap(d, (1-shape)·amount, 1)` |
| Ours P Sky Pro | `baseShape64.bin` 64^3 RGBA8 (`textures.ts:2`) | | | dilation `dot(rgb, (0.7, 0.41, 0.23))` (`:108`) |
| Ours G | Worley lobes (`generate/shaders.ts:107`), billow octaves (`:122`) | | | added to the level set |

- **Code:** `X/gp7/code/gp7-p09-10-sample-base.hlsl`, `X/hag/code/hag-p079.hlsl`, `X/noise/code/noise-recipe.hlsl`, `X/n17/code/n17-p034.hlsl`, `X/web18/code/web18-p13.hlsl`; cooked slices `X/noise/out/` (EXR float32; the default TGA output is premultiplied and wrong for G/B, see noise.md).
- **Frequency ladder conflict:** Nubis tool 1 : 1.7 : 2.3 between channels; TVN doubling. Neither is proven to be what shipped; the Nubis tool is the author's own and the closer claim. **Adopt the Nubis recipe; keep TVN as the tiling reference.**
- **Tiling:** replace the 8-corner blend with exact periodic noise (psrdnoise periodic simplex for the Perlin part, periods up to 289; periodic Worley by wrapping the cell index with three independent hashes) [psrd, tvn]. The blended band is visibly softer.
- **Recommendation:** bake our own RGBA 128^3 in a WGSL compute pass at init from the Nubis recipe, plus a 32^3 detail and a curl texture (try-next S2). Keep channels separate (no packing) so the combine stays a runtime control.

## 6. Detail noise and the wispy/billowy switch: every rule side by side
| Source | Detail texture / scale | Switch rule | Strength | Applied by | Curl |
| --- | --- | --- | --- | --- | --- |
| hzd15 s37 (+ note) | 32^3, 3 Worley | invert the Worley at the base (no constant) | — | `base - detail × curl` | distorts detail |
| **gp7 p.108-109** | 32^3 RGB fBM `.625/.25/.125`, read at `p * 0.1` | `mix(f, 1-f, sat(h*10))`: wispy below h 0.1 | `* 0.2` | `Remap(base_cov, mod*0.2, 1, 0, 1)` | `p.xy += curl.xy*(1-h)` |
| hag eq 13-16 | same fBM | `lerp(f, 1-f, sat(ph*5))`: wispy below 0.2 | `0.35·exp(-0.75·gc)` (0.35 at gc 0, 0.165 at gc 1) | `sat(R(SNnd, mod, 1, 0, 1)) · DA` | none |
| nut s11 | one HF Worley | none | none | `remap(lf, hf, 1, 0, 1)` | none |
| ne22 p.99 (envelope) | wispy / billowy composites | `blend = Remap(h, type-0.1, type+0.1)` (argument order flipped from the slide to match its diagram: billowy above); flips at type 0.25 / 0.5 / 0.75 | — | additive | baked |
| ne22 p.102 | same, other slice | thin clouds read a different slice: `z += (1 - sat(thickness·0.0125))·40` m | | | |
| n3 s95-100, syn s12 (voxel) | 128^3 R/G wispy, B/A billowy, `p·0.01` (100 m tile) | per-voxel detail type T; wispy `lerp(r, g, P)`, billowy `lerp(.3b, .3a, P^0.25)`, `lerp(wispy, billowy, T)` | billowy ×0.3 (shallow, round dents) | ValueErosion | baked |
| syn s25-28 | — | the physical rule: billows where density grows, curly wisps where it decays | | | |
| web18 p.13 | `n_delta` 8 oct f96; `w_delta` 4 oct f400 lacunarity 3 | by type k: `(1-k)·(0.75 n + 0.25 (1 - w))` | | `phi - delta` | none |
| Ours P Takram (`density.wgsl.ts:218-223`) | 32^3 **R8** `.r`, within 60 km | `mix(pow(d,6), 1-d, remap(hf, 0.2, 0.4))` | `remap(2d, mod*0.5, 1)` | remap | on shape and detail (`:212-219`) |
| Ours P Sky Pro (`:119-125`) | 64^3 RGB at 0.13 of the base scale | global `erosionShape` | 0.24 → 2.15 base to top, × coverage, weights `.113/.04/.02` | height-field subtraction | none |
| Ours G/V | N3 noise | species flip ±0.1 (NE p.99) moved ±0.2 by a 240 m patch (`generate/shaders.ts:172-175`) plus directional lean (`:185-196`); then `T·(1 - wispyBias·(1-h)^2)` (`shaders/density.wgsl.ts:42`) | `noise·(1 + detailBias)` (`:64`) | ValueErosion (`:65`) | baked |

- **Four rules, cite the one you port** (gp7.md review). For the floor: gp7 (`h*10`, `0.2`). Häggström's coverage-dependent strength is a cheap extra (overcast keeps its mass) and can be a switch.
- **Ours G/V double-applies wispy bases.** The generator already flips the type by species (`generate/passes.ts:497`), and the up-rez then pushes every base wispy again with `wispyBias = 1` (`runtime.ts:425`). `detailBias = 0.5` (`runtime.ts:432`) raises the billow cap from 0.3 to 0.45 and cuts wisps 1.5x deeper. Both should default to 0 (Nubis) and be judged against n3 s96/s99/s101 (try-next S5; n3 §9 #3).
- **Edge frequency:** the n3 s93/s97 notes say high frequency at thin edges, the shipped code says low frequency at P = 0. The code wins (n3 §7c); swapping the wisp direction is a cheap A/B for surface-detail.md.

## 7. Curl
- **Sources:** hzd15 s33 (128^2 RGB, "3 curl noise dims"), s37 (distorts the detail lookup); gp7 p.108 `p.xy += curl.xy * (1 - h)`, no strength scalar, `curl_noise` never defined; hag p.63 (dropped for cost, clouds drift so it is not missed); n3 s90 (baked into Curly-Alligator, none at runtime); psrd (analytic gradient → divergence-free curl; periodic).
- **Code:** `X/gp7/code/gp7-p11-13-detail.hlsl`.
- **Ours:** P Takram applies a 2D turbulence offset of 350 m (`settings.ts:156`) to **both** shape and detail lookups, scaled by `remap(hf, 0.3, 0)` and density (`density.wgsl.ts:212-219`). Moving the shape lookup tears the silhouette (hzd15.md, gp7.md). G/V: baked only.
- **Recommendation:** curl on the detail lookup only, `(1-h)` falloff, strength a tuned scalar (start about 0.1 of the shape tile); bake a 128^2 curl from psrdnoise for the HZD shaper. "Strength by height" beyond `(1-h)` and a second curl octave are our ideas, not sourced.

## 8. Anvils
| Source | Mechanism | Numbers |
| --- | --- | --- |
| n17 p.46-50 | `cov = pow(cov, remap(h, 0.7, 0.8, 1, lerp(1, 0.5, anvil_bias)))`; extra wind skew "that looks cool" [p.49-50] | unclamped exponent at bias 1: h 0 → 4.5, 0.5 → 2.0, 0.7 → 1.0, 0.8 → 0.5, 0.9 → 0, 1.0 → -0.5. **Clamp unknown**: unclamped also thins the lower body and over-fills above 0.9; clamped `[0.5, 1]` only inflates the top. Test both |
| hag eq 17-18 | `SA^sat(R(ph, 0.65, 0.95, 1, 1 - aa·gc))` flattens the top ramp into a plate; density fix `DA · lerp(1, sat(R(sqrt(ph), 0.4, 0.95, 1, 0.2)), aa)` | without the fix the plate goes opaque and blotchy [hag fig 12b vs 13] |
| hfw p.72 | where storm coverage > 0, **flip the vertical profile and combine it with the normal one** (dome plus flat top and base skirt) | figure only |
| hfw p.73, ne22 p.159-163 | a cirrus formation placed downwind of the storm centre by the NDF generator | data, not a shader term |
| H16 p.33 (`frostbite-yusov-hogfeldt.md`) | anvils drawn in the type LUT | |
| gp7 | **no anvil** (older notes misattribute it) | |
| Photos (`photo-species-specs.md` §4) | anvil 2-4x the column width, flat-bottomed, wispy edge, sheared one way; top 40 % fibrous, lower 60 % cauliflower | target |
| Ours | P: none. G: a hand-built storm cell with a downwind anvil plume and life cycle (`generate/passes.ts:155-200`, params `:20-21`) | |

- **Code:** `X/n17/code/n17-p046.hlsl`, `X/hag/code/hag-p078.hlsl`.
- **Recommendation:** in the HZD shaper, N17's exponent with a clamp switch plus Häggström's density fix (try-next S7). The NE/HFW flipped-profile anvil needs the LUT model (§2) and a storm field (weather.md).

## 9. Per-cloud height and density
| Source | Channel | Law |
| --- | --- | --- |
| hag p.11-13 | weather B = max height, A = density | `wh = sat(B + 0.12)` (code, not eq 6); `DA ∝ wd · 2` (> 0.5 denser than neutral) |
| ne22 p.20 | min height, max height NDFs (layer 256-2048 m) | profile stretched per column |
| hfw p.56-57 | min/max height field from the NDF generator: distorted noises and radial gradients define the underside | |
| H16 / Högfeldt (via `procedural-shape.md` M6) | G cloud height, B base altitude (five altitudes from one texture) | |
| Unity HDRP (`native-implementations.md` #2) | cloud map w = max height | |
| Ours G | implicit: column top = `m^(1/p)` × row depth from the R peak mass (`generate/shaders.ts:6-21`), small clouds kept low by `tallMass` (`:68`); storm preset reads base/top from B/A | |
| Ours P | none: fixed per-layer altitude and height (`procedural/settings.ts:150-155`) | |

- **Why it matters:** "every cloud the same height" is the procedural path's most visible failure next to the dome profile. HZD gets height variety from type only; NE and Häggström give it per cloud.
- **Recommendation:** HZD shaper gets type first (it is the floor); per-cloud height comes with the weather layout decision (layering.md L1, owner input). Then Häggström's B/A is a two-line addition (try-next S8).

## 10. Density shaping: base fade, density scale, sharpen
| Source | Term | Where in the chain |
| --- | --- | --- |
| hzd15 s35-36 | `baseFadeGradient`: dark at the bottom, bright at the top; "bottoms will be whispy" | **before** erosion, so bases erode harder |
| gp7 p.107 | `* cov` | after the coverage remap |
| hag eq 8-10 | `DA = ph · sat(remap(ph, 0, 0.2, 0, 1)) · sat(remap(ph, 0.9, 1, 1, 0)) · wd · 2` (code: 0.2, eq: 0.15) | after |
| ne22 p.105 (envelope) | `height_fraction · pow(sat(n - (1 - profile)), 0.27)`; coarse `pow(ValueErosion(profile, 0.04), 0.5) · inv_edge^3 · 5` | after |
| n3 s107/s109, syn s12 | `S' = sat(S)^4; ρ *= S'; ρ = pow(ρ, lerp(0.3, 0.6, S'))` (s107 shows linear S: use s109) | after; lifts thin regions into a translucent fringe |
| web18 p.5 | `σ(x) = x / sqrt(1 + x^2)` per type and on the sum | soft clip of overlaps |
| Ours P Takram | `0.75·h + 0.25` (`settings.ts:145`, `density.wgsl.ts:201-203, 225-226`) | after |
| Ours V | s109 verbatim (`shaders/density.wgsl.ts:66-73`) | |

- **Recommendation:** HZD shaper: base fade **before** erosion as hzd15 draws it (try a `remap(h, 0, 0.2, 0.3, 1)` ramp; no constant is published), then the `pow(.., 0.27)` sharpen as an NE-mode switch. Keep Takram's linear profile only in the Takram baseline.

## 11. Things no source gives (do not invent silently)
GP7's `GetDensityHeightGradientForPoint` body; the type-blend law; HZD noise frequencies (only the Nubis tool's defaults); curl texture spec and strength; the base-fade constant; N3's `cVoxelFineDetailMipMapDistanceScale`; the s18 floor mapping; NE's `cMultipleScattering*` powers. Mark any value we pick as "ours, tuned" in code comments.

---

## Try next (ranked, for the board)
Acceptance runs on the compare page (`work/HANDOFF.md`: `/compare/?impls=ours,takram,photo&vibe=1`) against the reference frames in [README.md §Reference frames](README.md#reference-frames) and the owner's photos (`photo-species-specs.md` §13 picks). Risk: L low, M medium, H high.

| # | What | Why (visual failure it fixes) | Sources | Files | A/B acceptance | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| **S1** | **`hzd` shaper in `procedural/`**: the gp7 chain exactly (4-channel dilation, nut trapezoids lerped by type, `remap(base·grad, 1-cov, 1, 0, 1)` with an optional `* cov`, base fade before erosion, 32^3 fBM detail with the `h*10` switch and `*0.2`, curl on detail only with `(1-h)`), plus hag's `0.35·exp(-0.75gc)` strength as a switch | We cannot show what HZD looks like today. Fixes the one-dome profile, the `.r`-only mush, torn silhouettes, and the 2D-envelope "blob" read (§3) | gp7 p.103-110, nut s7-13, n17 p.28-40, hfw p.15-17, hzd15 s34-37, hag eq 11-16 | `procedural/density.wgsl.ts` (new `PROC_HZD_WGSL` next to :85, :175), `settings.ts`, `textures.ts`, `index.ts` | Same view as nut s8/s14 and n17 p.30-32 at type 0 / 0.5 / 1, staged like gp7 Fig 4.13 → 4.14 → 4.16 and hzd15 p037-039; humilis/mediocris photo w:h (2.3 / 1.7) and flat bases (wobble ≤ 0.12) | M |
| **S2** | **Bake the HZD noise set** at init in WGSL: Nubis-recipe 128^3 RGBA (exact periodic, not cross-blended), a 32^3 Worley-fBM detail at higher gains, a 128^2 curl from psrdnoise | S1 needs four channels; Takram's texture is R8 of unknown recipe | noise (recipe, measured stats), tvn (periodic Worley, Nyquist rule), psrd (periodic simplex, curl) | new `procedural/noise-bake.wgsl.ts`; `procedural/textures.ts:35` | Slice images and stats match `X/noise/out/` (R mean 0.50 std 0.105; G/B/A mean 0.69 std 0.10) and hzd15 p033/p034 slices; 2x2 tile shows no seam | L-M |
| **S3** | **Top × bottom LUT mode** in the sky layer from the s18 CSVs, with independent top and bottom type in the weather | No tiered tops, no ragged-vs-flat bases independent of species | n3 s18, ne22 p.21-28, hfw p.53 | `shaders/sky-layer.wgsl.ts:137-166`, `generate/shaders.ts:22-49`, `generate/weather.ts` | ne22 p.23-25, 27 and n3 s17/s21/s24 posters; congestus photos (cone 0.5-1.1 w:h, stacked domes) | M |
| **S4** | **Erosion-law A/B** in the sky layer: additive `sat(n' - (1-P))` with `n' = 1 - composite` vs ValueErosion | Distant bodies have flat, textureless cores | n3 s24, ne22 p.34 | `shaders/sky-layer.wgsl.ts:582` → `shaders/density.wgsl.ts:65` | n3 s24 posters (`image30/31`), HZD in-game n3 s37 `image55/56`; owner judges which reads as HZD | L |
| **S5** | **Nubis defaults for the up-rez art biases**: `wispyBias` 0, `detailBias` 0 | Every base forced wispy on top of the species flip; billows cut 1.5x too deep | n3 s98, s100; n3 §5 rows 8, 10 | `runtime.ts:425, 432` (read at `shaders/density.wgsl.ts:42, 64`) | n3 s96/s99/s101 triplets; mediocris photos (crisp domes, soft bases) | L |
| **S6** | **Curl on detail only** in the existing Takram baseline (until S1 lands) | Torn silhouettes under turbulence | hzd15 s37, gp7 p.108 | `procedural/density.wgsl.ts:212-219` | Same seed with and without: silhouette stays intact, base wisps remain | L |
| **S7** | **Anvil**: N17 exponent with a clamp switch, plus hag's density fix | No anvils outside the hand-built storm cell | n17 p.46-50, hag eq 17-18 | S1 shader; generator rows later | n17 p.46-50 sequence, hag fig 12-13; cumulonimbus photos (anvil 2-4x column) | L |
| **S8** | **Per-cloud height and density** from weather B/A (hag) in the HZD shaper | All procedural clouds share one height per layer | hag p.11-13, ne22 p.20, hfw p.56-57 | S1 shader, weather bake | Humilis field: 5:1 size range, a few leaders [photo §1]; needs the channel decision (layering L1) | M, **owner input** (channel layout) |
| **S9** | **Finer 2.5D steps** `3 + 0.00366·t` in the sky layer | Distant detail undersampled (2.7x coarser near) | n3 s36, ne22 p.39 | `sky-layer.ts:155` | Far field against N3 s25 video 2 / s29; cost on the GPU timer | L |
| **S10** | **Metre-scale rim pass** `S((-sdf + A(n-0.5))/w)` near the camera (G/V) | Bump size scales with cloud thickness, so tall clouds get oversize bumps | bou08 p.7, `procedural-shape.md` M12 | `shaders/density.wgsl.ts` | Close fly-by vs n3 s105; hand to surface-detail.md if that guide owns it | M |
