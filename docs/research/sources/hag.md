# Real-time rendering of volumetric clouds (Häggström, Umeå University MSc thesis, 2018)
Local: `/Users/dex/Developer/WebGPUClouds/artifacts/research/papers/Haggstrom.pdf` · dump `artifacts/research/extracted/hag/` · Tags: shape weather detail light perf · Status: 🟩 note written, code transcribed (equations and listings read from page renders)

**Page refs.** `[p.N]` is the **printed** thesis page ("N(81)" in the header); PDF page = N + 12. Equation numbers are the thesis's own (1 to 36 in the body, 37 to 61 repeat the model in appendix A). Notation: `R` = remap (eq 1), `SAT` = saturate, `Li` = lerp, `gc` global coverage, `gd` global density, `ph` height fraction in the layer (0..1), `WM` the weather map RGBA = `(wc0, wc1, wh, wd)`.

## In one paragraph
A 30 hp master's thesis (Arrowhead Game Studios, Stingray engine, GTX 980 Ti) that re-derives the Horizon / GPU Pro 7 cloud model as **closed-form, fully specified maths**: a 512^2 RGBA weather map, a 128^3 RGBA shape texture, a 32^3 RGB detail texture, two analytic height functions (one for shape, one for density), a remap-based coverage threshold, an anvil modification, a Beer/HG lighting chain with several non-physical corrections, and a ray march with five step-length optimisations plus 1/16 reprojection. Every constant is printed, every equation numbered, and Appendix B has the HLSL. It is a **single low cloud layer (400 to 1000 m)**, not a general cloudscape: no curl, no type LUT, no multiple scattering, no high clouds [p.64]. Its value to us is the exact shape chain (it differs from GPU Pro 7 in several constants and in *where* the height gradient is applied), the anvil and storm-height handling, the coverage-aware step logic, and a measured cost table.

## Key ideas (with page)
- **Height is two analytic functions, not a type gradient.** `SA` (shape, multiplies the noise **before** the coverage threshold) rounds the bottom over ph 0..0.07 and the top from `0.2*wh` to `wh`; `DA` (density, multiplies **after**) is linear in ph with a base fade and a top fade [p.12-13]. Per-cloud height `wh` and density `wd` come from the weather map's blue and alpha channels, so **height and density are painted per cloud**, replacing GPU Pro's 3-gradient type blend [p.11-12].
- **Two coverage channels and one global scalar.** R = sparse (low-coverage) clouds, G = fill (high-coverage); the green only fades in once `gc > 0.5`. One slider takes the sky from isolated cumuli to overcast [p.11, eq 4].
- **Coverage is a threshold on `noise * SA`, scaled by `gc * WMc`** (eq 12). Not multiplied back by coverage as GPU Pro 7 does [p.14].
- **Shape noise uses all four channels of the 128^3 texture**: Worley FBM (G,B,A at 0.625/0.25/0.125) sets the *lower bound* of a remap of the Perlin-Worley R channel, so detail is only carved at edges and the core stays solid [p.14, eq 11].
- **Detail strength falls with coverage** (`0.35 * exp(-0.75 gc)`) and switches from "wispy" (raw FBM) at the base to "billowy" (`1 - FBM`) by ph = 0.2 [p.16, eq 14].
- **Anvil** by raising `SA` to a power that falls from 1 to `1 - aa*gc` between ph 0.65 and 0.95, plus a density correction (`sqrt(ph)` remap to 0.2) because the naive density model fails once the top widens [p.17, eq 17-18, fig 12-13].
- **Lighting is heavily hacked for 4 sun steps**: Beer with a *clamped* floor, HG plus an extra "silver" lobe taken with `max`, a non-physical "out-scatter ambient" to restore contours, a density-minimum ambient, and blue-noise dither [p.27-32, code p.80-81].
- **Marching**: shell intersection, step length grows linearly with start distance (eq 20/33), long steps in empty space sampling only the base shape, shorter steps at low coverage (eq 34), longer at low density (eq 36), blue-noise start offset, 4 sun steps over half the layer thickness at rising mip level [p.19-26].
- **Reprojection**: 1 pixel of each 4x4 block per frame in a cross pattern, motion-vector re-projection, about 1/10 of the full cost [p.22-25].
- **Honest limits** [p.62-65]: swirling storms and per-part motion impossible with texture-offset animation; inside clouds the reprojection fails; only one layer; weather maps are hand-drawn (generator listed as future work).

## Formulas and constants

### Utility functions [p.9, App. A.2-A.4]
```
(1)  R(v, lo, ho, ln, hn) = ln + (v - lo) * (hn - ln) / (ho - lo)       // unclamped
(2)  SAT(v) = clamp(v, 0, 1)
(3)  Li(v0, v1, t) = (1 - t) * v0 + t * v1
```

### Scalars and layer [p.10]
- Layer base `ch_start = 400 m`, top `ch_stop = 1000 m` (called an artistic choice: smaller and lower, for variety while moving; the comparison with Horizon's 1.5 to 5 km shell is ours, from GPU Pro 7 p.119, not the thesis's). `ph = (altitude - 400) / 600`.
- `gc in [0,1]` global coverage, `gd in [0, inf)` global density (typical 0.2 to 1).

### Weather map [p.10-11, eq 4 = eq 40]
512 x 512, RGBA, hand-painted (fig 6, 56, 59, 61, 63). **R** = `wc0` low-coverage map, **G** = `wc1` high-coverage map, **B** = `wh` maximum cloud height (0..1, white = full height), **A** = `wd` density. Movement offsets this texture [p.34].
```
(4)  WMc = max(wc0, SAT(gc - 0.5) * wc1 * 2)
     gc <= 0.5: WMc = wc0 only. gc = 1: WMc = max(wc0, wc1). In between G fades in linearly.
```

### Shape-altering height function SA [p.12-13, eq 5-7 = 41-43; code B.2 p.78]
```
(5)  SRb = SAT(R(ph, 0, 0.07, 0, 1))              // round the bottom: 0 -> 1 over the first 7 %
(6)  SRt = SAT(R(ph, wh*0.2, wh, 1, 0))           // round the top: 1 -> 0 from 0.2*wh to wh
(7)  SA  = SRb * SRt
```
Profile values, `wh = 1`: ph 0.02 → 0.29, 0.05 → 0.71, 0.1 to 0.2 → 1 (plateau), 0.4 → 0.75, 0.6 → 0.5, 0.8 → 0.25, 0.95 → 0.06. With `wh = 0.5`: plateau only to 0.1, 0.4 → 0.25, zero from 0.5. So the top is a **linear ramp**, not a dome; the dome comes from the noise product and the weather-map falloff (high `wh` toward a cloud's centre gives rounded clouds, p.13).
**Code differs from eq 6 (B.2 line 7): `stop_height = saturate(weather_map.b + 0.12)`**, then `R(ph, stop_height*0.2, stop_height, 1, 0)`. Blue 0.88 and above gives full height. Use the code form.

### Density-altering height function DA [p.13, eq 8-10 = 44-46; code B.3 p.78]
```
(8)  DRb = ph * SAT(R(ph, 0, 0.15, 0, 1))         // density rises with height, quadratic in the first 15 %
(9)  DRt = SAT(R(ph, 0.9, 1.0, 1, 0))             // fade out over the last 10 %
(10) DA  = gd * DRb * DRt * wd * 2                // wd > 0.5 gives denser than neutral
```
**Code differs from eq 8:** B.3 uses `0.2` (not 0.15) as the base-fade end, and has no `gd` (applied elsewhere). Values (code): ph 0.1 → 0.05, 0.2 → 0.20, 0.5 → 0.5, 0.9 → 0.9, 0.95 → 0.475. Density is essentially `ph` (0 at base, 0.9 near the top). This is the "fluffy base, defined top" of the thesis; the *dense top, thin bottom* is the opposite of a real cumulus gradient and is balanced by SA and the detail erosion.

### Shape noise [p.14, eq 11 = 47; code B.4 p.79]
Texture: 128^3 RGBA, mip-mapped. R = low-frequency Perlin-Worley, G/B/A = Worley at increasing frequency (fig 8). Frequencies and generation recipe are **not given** (cites Schneider 2016/2017).
```
(11) SNsample = R(snr, (sng*0.625 + snb*0.25 + sna*0.125) - 1, 1, 0, 1)
```
Same as GPU Pro 7 `Remap(r, -(1 - lowFreqFBM), 1, 0, 1)` (identical, since `fbm - 1 = -(1 - fbm)`).

### Coverage threshold, shape combination [p.14, eq 12, 15, 48]
```
(12) SN  = SAT(R(SNsample * SA, 1 - gc*WMc, 1, 0, 1)) * DA        // first version, no detail
(15) SNnd = SAT(R(SNsample * SA, 1 - gc*WMc, 1, 0, 1))            // DA left out, applied last (eq 16)
```
`SNsample * SA` is formed **before** the remap (shape), `DA` **after** (density) [p.14]. Equivalent: `(x - (1 - gc*WMc)) / (gc*WMc)`; a guard against `gc*WMc → 0` is needed. Because the threshold is divided by `gc*WMc`, low coverage gives a steep, nearly binary edge; there is no `* coverage` multiplier as in GPU Pro 7.

### Detail noise [p.15-16, eq 13-14, 16 = 49-51; code B.5 p.79]
Texture: 32^3 RGB Worley, increasing frequency (fig 10), mip-mapped.
```
(13) DNfbm = dnr*0.625 + dng*0.25 + dnb*0.125
(14) DNmod = 0.35 * exp(-gc * 0.75) * Li(DNfbm, 1 - DNfbm, SAT(ph * 5))
(16) d = SAT(R(SNnd, DNmod, 1, 0, 1)) * DA                       // final density
```
- Maximum erosion 0.35 at `gc = 0` (decays to 0.165 at `gc = 1`): **detail matters less as coverage rises** (so big overcast layers keep their mass).
- `Li(..., SAT(ph*5))`: raw FBM below ph 0.2 ("wispy"), `1 - FBM` above ("round"). GPU Pro 7 uses `saturate(h * 10)` (switch by 0.1) and a constant `* 0.2`.
- **No curl noise, no distortion of the detail lookup** (curl dropped "in favor of performance", justified because the clouds drift with wind rather than hover in place) [p.63].
- The detail only erodes, so the full cloud is always inside the base shape; this is what allows the base-only march (fig 18) [p.20].

### Anvil [p.16-17, eq 17-18 = 52-53; code B.2, B.3]
```
(17) SAanvil = SA ^ SAT(R(ph, 0.65, 0.95, 1, 1 - aa*gc))
(18) DAanvil = DA * Li(1, SAT(R(sqrt(ph), 0.4, 0.95, 1, 0.2)), aa)
```
`aa` = anvil amount, 0..1. At `aa*gc = 1` the exponent falls from 1 (ph 0.65) to 0 (ph 0.95), so `SA^x → 1` where `SA < 1`: the top ramp is **flattened to full strength**, widening the top into a plate. `sqrt(ph)` remap multiplies density by 1 (at `sqrt(ph) = 0.4`, ph 0.16) down to 0.2 at ph 0.9 (target "going towards 0.2 as `sqrt(ph) → 0.95`", p.17). In code (B.3) the lerp is `lerp(1, SAT(R(pow(ph, 0.5), 0.4, 0.95, 1, 0.2)), cloud_anvil_amount)` applied to the running product. Without the density fix the plate becomes opaque and blotchy (fig 12b); with it, fig 13.
For `aa = 0` the clouds are plain (fig 12a). Note this acts on the **shape function**, not on coverage as Nubis 2017 (`pow(coverage, remap(h, 0.7, 0.8, 1, lerp(1, 0.5, anvil_bias)))`, N17 s46-49).

### Movement [p.34]
All motion is texture offsets: weather map offset moves the clouds; shape offset changes shape; detail offset adds turbulence. Offsetting all three in similar directions gives drift plus evolution. Example: weather map and shape moved 200 m, 400 m (fig 68). Speeds per texture are **not** given.

### Lighting chain [p.27-32, eq 24-31 = 54-61; code B.6, B.7 p.80-81]
```
(24) E(b, ds)   = exp(-b * ds)                          // Beer; ds = accumulated density to the sun, b artistic
(25) HG(c, g)   = (1/4pi) (1 - g^2) / (1 + g^2 - 2 g c)^1.5      // c = dot(light dir, ray dir)
(26) ISextra(c) = csi * SAT(c)^cse                      // extra "silver" lobe
(27) IOS(c)     = Li( max(HG(c, ins), ISextra(c)), HG(c, -outs), ivo )
(28) OSamb      = 1 - SAT( osa * d^R(ph,0.3,0.9,0.5,1) * SAT(R(ph, 0, 0.3, 0.8, 1))^0.8 )   // code form, B.6
(29) Aclamp     = max(E(b, ds), E(b, ac))               // eq as printed; code differs, see below
(30) Aalter     = max(d * amin, Aclamp)                 // as printed; code differs
(31) Lfinal(c)  = Aalter * IOS(c) * OSamb
```
Printed eq 28 puts `SAT` only around the first factor; the **code (B.6) saturates the product** and that is what the images in fig 31 correspond to. Use the code.

**Defaults** [p.58, "settings used for most cases"]: `b = 6`, `ins = 0.2`, `outs = 0.1`, `ivo = 0.5`, `csi = 2.5`, `cse = 2`, `osa = 0.9`, `ac = 0.2`, `amin = 0.2`. Sunset [p.59-60]: `ins = 0.5`, `csi = 8`, `cse = 15` (sun intensity lowered, colour orange). Night: same settings, moon colour and intensity. Fig 30b demonstrates `csi = 10, cse = 20`; fig 31b `osa = 0.9`; fig 32b `b = 12, ac = 0.2`; fig 33b `amin = 0.2`. (The summary list p.32 says csi/cse ∈ [0,1], contradicting the 2.5 to 10 values used; ignore the stated range.)

**Code (B.6/B.7) differs from the equations:**
- `Attenuation`: `prim = exp(-b*ds)`; `scnd = exp(-b*ac) * 0.7`; `checkval = R(cos, 0, 1, scnd, scnd*0.5)` (clamp floor relaxed to half when facing the sun, **not clamped** for cos < 0 so it rises to 1.5x scnd when looking away); `return max(checkval, prim)`. With defaults: floor 0.211 away from the sun, 0.105 at cos = 1 (eq 29 would give 0.301 flat).
- `CalculateLight`: `att = Attenuation * InOutScatter * OutScatterAmbient`; then `att = max(density * amin * (1 - SAT(dist/4000)^2), att)` (the minimum-ambient is applied to the **whole product**, with a quadratic fade to 0 at 4 km along the ray so huge far steps don't glow); then `att += bluenoise * 0.003`; `colour = att * sun_color`. Eq 30/31 as printed do not show these.
- `HG` in code: `((1-g2)/pow(1+g2-2*g*cos, 1.5)) / 4 * 3.1415`, i.e. multiplied by pi/4 = 0.785, **not** divided by 4pi = 0.0796 (the same line is printed in GPU Pro 7, p.113). The constants `csi`, `cse` were tuned against this scale: forward `HG(1, 0.2)` is 1.47 as coded but 0.149 if normalised, versus the 2.5 silver term. If you port the constants, either keep the printed scale or multiply `csi` by about 0.1.
- No powder term (GPU Pro 7's `1 - exp(-2d)`): the thesis replaces it with `OSamb` and the minimum ambient.
- `ds` is "accumulated density towards the sun" with no step length factor given; with `b = 6` and 4 samples of `d` (0..~1) over 300 m, treat it as a plain sum of sampled densities, not an optical depth in 1/m.

### Sun march [p.22, eq 21-22]
```
(21) step_sun = 0.5 * (ch_stop - ch_start) / sn                 // always marches half the layer thickness = 300 m; sn = 4 -> 75 m
(22) miplevel = Integer(i * 0.5)                                // i = 1..sn: mips 0,1,1,2 for sn = 4; trunc
```
No sun-march is started when the view sample has zero density. Every texture (weather, shape, detail) is read at that mip level in the sun march. `sn = 4` chosen (see results).

### Step-length functions [p.19-22, 26; eq 19-23, 32-36]
```
(19)=(32) t_tot = p * (n * td0 + n * sn * td1)                 // pixels * (view steps * density cost + view*sun steps * light cost)
(20)=(33) step_new = step_orig + dist_start * inc_rate         // dist_start: distance to the ray's start on the shell
(34)  step_new = step_orig * max(mult_min, min(1, R(gc, 0.2, 0.7, mult_min, 1)))     // shorter when coverage is low
(35)  step_new = step_orig * mult_min                          // eq 34 for gc <= 0.2
(36)  step_new = step_orig / max(gd, div_min)^0.8              // longer when density is low
(23)  dist_start += (bn - 0.5) * 2 * step_new                  // blue-noise start offset, one step back to one forward
```
Chosen values: `step_orig = 14 m` in the experiments [p.40], `inc_rate = 0.04` [p.44], `mult_min = 0.4` [p.47], `div_min = 0.4` [p.51], `sn = 4` [p.39]. Experiments 2 and 3 are run with `inc_rate = 0.04`. How the three modifiers combine when all apply is **not stated** (they are presumably multiplied). Whether `dist_start` in eq 20 is the ray's entry distance (a per-ray constant) or the running distance is ambiguous in the text; "1 m more per 10 m between camera and sphere" at 0.1 reads as the entry distance [p.40]. We use the running ray distance in our own code (see below).

### Other march logic [p.19-22]
- March interval = ray vs two spheres (inner = layer base, outer = layer top), planet curvature included (fig 15).
- Long steps until non-zero density is sampled, then **back up one step** and take short steps; revert to long steps after a minimum short-step distance has been covered without cloud (the distance and the long-step factor are **not given**). During long steps **only the base shape** (no detail) is sampled.
- Stop when full opacity is reached (threshold not given).
- Blue noise tiled in screen space; the pixel value offsets the start (eq 23). Tile size and generation not given. Lighting adds `bluenoise * 0.003` (B.7).

### Reprojection [p.22-25, 33]
- Marched at **1 pixel per 4x4 block per frame** (quarter resolution each axis, 1/16 of the pixels), updated in a **cross pattern** (fig 20b) not scan order.
- Motion vectors (RG render target, screen-space shift) are computed from a depth that is the **alpha-weighted depth sampled during the march** (the depth at which the cloud actually is), using current and previous camera. The re-projection **gathers** from the previous frame (inverse of the figure's forward arrows).
- If the vector points off-screen, use the newly marched pixel only (more pixelated at edges in fast rotation).
- Result: render time about 1/10 of full, not 1/16, because the reprojection pass costs.
- Failure modes: moving **through** clouds (relative movement too large; disable reprojection then, giving a pixelated result); clouds behind scene objects can pop up when the object moves (so clouds are marched even behind geometry); fast rotation at screen edges.
- Future work: graded reprojection (use the 4 newest pixels, or 2, when movement is slightly too large) and 1/32 [p.65].

### Render pipeline [p.33-34]
1. March into a quarter-res target (colour, alpha) with the motion vector and the cloud depth. 2. Reproject the previous frame, update 1/16 of it. 3. Composite with the scene depth map (cloud depth vs scene depth). Atmospheric blend: cloud colour mixes with the sky colour toward the horizon, fully sky at the bottom [p.32]; the blend function is not given. **Shadows**: a separate quarter-res pass, one ray per scene fragment toward the sun accumulating density with large steps [p.34].

## Measured results (GTX 980 Ti, Win10, Stingray) [p.35-61]
**Sun steps** (table 1, p.39; full-screen render, `sn` only): 100 steps (reference, mips off) 60 ms; 1 → 1.90 ms; 2 → 2.80; 3 → 3.35; 4 → 3.85; 5 → 4.40. Four chosen as the knee (4 to 5 adds little).
**Distance step growth** (table 2, p.43; `step_orig = 14`): constant step 15.00 ms; `inc_rate` 0.1 → 1.30 ms (clear noise, banding); 0.0667 → 1.70; 0.05 → 2.10; 0.04 → 2.45 (acceptable; atmospheric blend hides far-cloud brightening, fig 46).
**Coverage-aware step** (table 3, p.47; `gc = 0.2`): unaltered 2.00 ms (noisy small far clouds); `mult_min` 0.1 → 8.00 ms (clean); 0.3 → 3.30 (no visible loss vs 0.1); 0.5 → 2.30 (visible impact); **0.4 chosen** (most even cost for `gc` 0 to 1).
**Density-aware step** (table 4, p.51; `gd = 0.1`): unaltered 5.00 ms (about 2x the `gd = 1` cost, whole interval marched); `div_min` 0.1 → 0.90 ms (heavy noise); 0.2 → 1.50; 0.3 → 2.00; 0.4 → 2.50 (most noise gone). 0.4 chosen.
**Final** (table 5, p.61), layer 400 to 1000 m, re-projected, rounded to 0.05 ms: 1920x1080: cumulus 2.05, stratocumulus 2.20, stratus 1.90, cumulonimbus 2.00 ms; 960x540: 0.85, 0.90, 0.80, 0.85 ms. (Marched pixels: 240 x 135 at 960x540.) Goal was under 2 ms.
**Cloud-type recipes** (all one weather map family; p.53-57): cumulus `gc 0.6, gd 1`; stratocumulus `gc 0.8, gd 0.5`; stratus (thin sheet, height channel lowered in the centre) `gc 1.0, gd 0.35`; thicker continuous stratus (both coverage channels maximal, uniform) `gc 1.0, gd 0.2`; cumulonimbus (large dots in R, G probability *reduced* around them so the sheet doesn't fill) `gc 1, gd 1` with anvil on. Coverage build-up fig 69: `gc` 0.3, 0.65, 1.

## Code listings (local transcriptions in `artifacts/research/extracted/hag/code/`)
| Page (printed) | File | What it does |
| --- | --- | --- |
| 77 (B.1) | `hag-p077.hlsl` | `ReMap` |
| 78 (B.2, B.3) | `hag-p078.hlsl` | `HeightAlter` (SA with `weather.b + 0.12`, bottom/top rounding, anvil exponent); `DensityAlter` (ph, base fade 0.2, `weather.a*2`, anvil density lerp, top fade) |
| 79 (B.4, B.5) | `hag-p079.hlsl` | shape-noise lower-bound remap; detail FBM, `lerp(detail, 1-detail, sat(ph*5))`, `0.35*exp(-gc*0.75)`, final remap |
| 80 (B.6) | `hag-p080.hlsl` | `HG` (with the pi/4 quirk), `InOutScatter`, `Attenuation` (0.7 clamp relaxed by cos), `OutScatterAmbient` |
| 81 (B.7) | `hag-p081.hlsl` | `CalculateLight` (product, distance-faded minimum ambient, blue-noise 0.003) |
Eq 17, 18, 28 were checked against the page render (p.17, p.29); the listings were read in text and compared with the renders (B.2 to B.7).

## Figures worth pulling (printed page; PDF = +12)
- p.11 fig 6 and p.12 fig 7: the four weather-map channels (R low coverage, G high coverage, B height, A density) and the resulting layout; p.53, 55-57 fig 56, 59, 61, 63: maps for cumulus, stratus, thick stratus, cumulonimbus (G reduced around towers).
- p.14 fig 8, p.15 fig 10: slices of the 128^3 shape and 32^3 detail channels (frequency ladder).
- p.15 fig 9 and p.16 fig 11: **shape-only vs shape plus detail** on the same weather map (the best before/after of erosion in the corpus for this model).
- p.17 fig 12-13: **anvil**: no anvil, anvil with unaltered density (fails), anvil with density fix.
- p.20-22 fig 16-19: marching diagrams (distance step growth, long steps outside clouds, base shape encloses final shape, stop at full opacity).
- p.23-25 fig 20-25: reprojection cross pattern, ghosting, motion vectors.
- p.27-31 fig 28-33: lighting term by term (Beer only, plus HG, plus silver lobe, plus out-scatter ambient seen from the sun, plus clamping, plus min ambient). **p.30 fig 31 and p.31 fig 32-33 are the clearest demonstrations** of what each correction does.
- p.36-39 fig 35-40: sun steps 1 to 5 vs a 100-step reference; p.41-45 fig 41-46: step growth; p.45-47 fig 47-50: coverage steps; p.49-51 fig 52-55: density steps.
- p.58-60 fig 65-67: midday, sunset, night; p.60 fig 68: movement; p.61 fig 69: coverage build-up 0.3 / 0.65 / 1.

## How Häggström differs from GPU Pro 7, HZD 2015 and Nubis
GPU Pro 7 numbers below are from the local text dump (`extracted/gp7/full.txt`, ch. 4 pp. 103-111).
| Aspect | GPU Pro 7 / HZD 2015 | Häggström | Consequence |
| --- | --- | --- | --- |
| Weather map | R coverage, G precipitation, B cloud type (60 km square) | R sparse coverage, G fill coverage, B **max height**, A **density**; 512^2 | Height and density per cloud instead of type per cloud; no precipitation/rain darkening |
| Height gradient | three density-height gradients (stratus, strato, cumulus) blended by type; applied to the base cloud | analytic `SA` (bottom 7 %, top `0.2wh` to `wh`) applied to the noise **before** threshold, `DA` after | Tops are noisy and cut by the noise, not a fixed gradient; `wh` gives continuous variation of cloud height |
| Coverage | `remap(base, cov, 1, 0, 1)` then `* cov` | `remap(noise*SA, 1 - gc*WMc, 1, 0, 1)`, no `* cov`; two channels split at `gc = 0.5` | Different density at low coverage; smoother transition to overcast |
| Shape noise | `Remap(r, -(1 - fbm), 1, 0, 1)`, fbm weights 0.625/0.25/0.125 | identical (eq 11) | Confirms the "recalled" GPU Pro weights used in `procedural-shape.md` M1 |
| Detail modifier | `lerp(fbm, 1 - fbm, saturate(h*10)) * 0.2`, detail lookup distorted by curl scaled `(1 - h)`, detail sampled at `p * 0.1` | `lerp(fbm, 1 - fbm, saturate(h*5)) * 0.35 * exp(-0.75 gc)`, **no curl** | Switch height 0.2 vs 0.1; coverage-dependent strength is new |
| Height of layer | spherical shell 1.5 km to 5 km, 64 to 128 steps | shell 400 m to 1000 m | Much shorter paths, so far fewer steps |
| Anvil | N17 s46-49: `pow(coverage, remap(h, 0.7, 0.8, 1, lerp(1, 0.5, anvil_bias)))` | on `SA` as an exponent (0.65 to 0.95), plus density correction | Häggström also fixes the density; Nubis acts on coverage |
| Sun march | 6 cone samples growing in size plus 1 far sample | 4 straight samples over half the layer, mip `i*0.5` | Far tap for distant shadows is missing |
| Lighting | Beer, HG g=0.2, powder `2 e^-d (1 - e^-2d)`, rain gain | Beer clamped to a floor, HG plus `max` with silver lobe, non-physical ambient, minimum ambient, blue noise | No powder; contours come from `OSamb` |
| Reprojection | 1/16 per frame, camera reprojection | same plus motion vectors from alpha-weighted depth, cross pattern | |
| Nubis 2017/2022 | dimensional profile, type-driven profile tables, curl baked, hero modelling, cirrus 2D layer, NDF | none of these; one volumetric layer | A pure per-sample HZD chain; not a competitor to NE, but the cleanest closed-form of the HZD chain |

## What we already do / what we don't / what to try
**Our code** (`packages/runtime/src/procedural/`):
- Takram shaper (the HZD-2015 lineage): `procWeatherSample` `density.wgsl.ts:188-200`: threshold `factor = 1 - cov * gradient` (`:195`) applied to the **weather channel** (2D), `remap(local, factor, factor + width)` (`:196`). Shape noise `:214` reads **only `.r`**; `density = remap(density, (1 - shape) * amount, 1)` (`:215`). Detail `:219-223`: single channel, `mix(pow(detail, 6), 1 - detail, remap(hf, 0.2, 0.4))`, erosion bound `modifier * 0.5`, near camera only (`:218`). Height: `procShapeAltering` semicircle on `pow(h, bias)` (`:178-181`) and `procLayerDensity` exp/linear/const (`:201-203`). Turbulence offset on both lookups (`:212-214, 219`).
- Sky Pro: `procCandidate`/`procErodedDensity` `:92-127`: `top = weather + coverage - 1 + dilation*coverage` (`:109`), erosion weights `(0.113, 0.04, 0.02)` (`:124`).
- March: `trace.wgsl.ts`: jitter 0..1 step `:161, :189`; cone-scaled fine step `:209`; coarse stage samples **fully** (`:212`); density-dependent step `:234-236`; 6 light taps with cone LOD `:247` (`lightTaps: 6`, `settings.ts:161`), far taps `:254-268`; `stepMeters: 25, maxSteps: 256` (`settings.ts:161`). Lighting is our own (`cloudInScatterMicro`, `cloudOctaveLight`, powder 0.8; `settings.ts:162`).

**Differences that matter for shape/layering/detail:**
1. **Where height enters.** Takram puts the height gradient inside the *weather threshold* (2D gating), then erodes with noise afterwards; Häggström multiplies the gradient into the 3D noise *before* a single threshold, so noise breaks the tops and bottoms, per-cloud `wh` sets the height and the same texture sets `wd`. We have no per-cloud height or per-cloud density channel (M6 in `procedural-shape.md`).
2. **Four shape channels used here, one in ours** (`:214` reads `.r`). The 0.625/0.25/0.125 Worley FBM as the remap lower bound is the missing billow hierarchy (M1).
3. **Detail amount is coverage-aware here** (`0.35 e^(-0.75 gc)`); ours is a fixed `tkDetail` per layer. Low coverage = crisper, more eroded small cumuli; high = solid sheets. Cheap.
4. **Anvil** exists here and not in ours (M7). Häggström's version applies to `SA` plus a density fix; combine with N17's coverage-pow rather than choose.
5. **Two coverage channels with a `gc = 0.5` split**: continuous sparse → overcast with one scalar.
6. **Coverage- and density-aware step logic** (eq 34, 36): ours has neither. Small far clouds go noisy at low coverage (the thesis's measured symptom) and low-density skies march the whole interval.
7. **Base-shape-only march in empty space** (fig 18): our coarse stage calls the full sample (`trace.wgsl.ts:212`); with detail confined to 60 km the saving is partial, but for the Takram path a shape-only coarse sample is valid because detail only erodes.
8. **Lighting hacks worth knowing** (we are acceptable, so low priority): clamped Beer floor relaxed toward the sun, distance-faded minimum ambient, `OSamb` darkening of dense upper regions seen from the sun. Our microshadow and octave model cover the same ground; the minimum-ambient distance fade is the only item we lack for huge steps.

**Top "try next" for shape / layering / detail** (details in the report):
1. Per-cloud height and density from weather B/A, with `SA` multiplied into the 3D noise before the threshold (eq 5-7, 12; B.2). [p.12-14]
2. Four-channel shape lower bound `(g*0.625 + b*0.25 + a*0.125) - 1` (eq 11). [p.14]
3. Coverage-dependent detail strength `0.35 e^(-0.75 gc)` and a switch height set by `ph*5` (eq 14), together with the density correction idea. [p.16]
4. Anvil as `SA^exponent` plus density `sqrt(ph)` remap (eq 17-18); pair with N17's coverage-pow. [p.17]
5. Two-channel coverage split `max(wc0, SAT(gc - 0.5) * wc1 * 2)` (eq 4) and coverage/density-aware steps (eq 34, 36). [p.11, 44-51]

## Superseded by / supersedes
- Supersedes the "recalled" detail in `procedural-shape.md` M1 only partly: the **0.625/0.25/0.125 weights and the base remap** are now confirmed by GP7 text and by this thesis; the **detail modifier constants differ** (GP7 `h*10`, `*0.2`; here `h*5`, `0.35 e^(-0.75 gc)`), so cite which one you use. Fetch-list item #8 ("check Häggström before fetching") is done: it is a full re-derivation, with the code, not a restatement.
- `hzd-nubis-evolved.md` / Nubis 2022 supersede it for profile modelling, type tables and cirrus; GPU Pro 7 (`gp7`) supersedes it for the HZD original, rain absorption, powder and the cone sun march.
- Not the same as `hogfelt.pdf` (Högfeldt 2016, Frostbite).

## Review (Opus spot-check, 2026-10-10)
- eq 4 `WMc = max(wc0, SAT(gc - 0.5) * wc1 * 2)` [p.11] → ✔
- eq 11 `R(snr, (g*0.625 + b*0.25 + a*0.125) - 1, 1, 0, 1)` and eq 12 `SAT(R(SN * SA, 1 - gc*WMc, 1, 0, 1)) * DA` [p.14] → ✔
- B.2 `stop_height = saturate(b + 0.12)`, bottom 0..0.07, top `0.2*stop..stop`, anvil exponent `R(ph, 0.65, 0.95, 1, 1 - aa*gc)` [p.78] → ✔; SA profile values (0.29 at 0.02, 0.75 at 0.4, 0.06 at 0.95) recomputed → ✔
- B.3 base fade to 0.2 (eq 8 says 0.15), `wd * 2`, anvil `lerp(1, SAT(R(ph^0.5, 0.4, 0.95, 1, 0.2)), aa)`, top fade 0.9..1; DA values 0.05 at 0.1, 0.475 at 0.95 → ✔
- B.5 `lerp(fbm, 1 - fbm, sat(ph * 5)) * 0.35 * exp(-gc * 0.75)` [p.79] → ✔ (0.165 at gc = 1)
- B.6 HG `/ 4 * 3.1415`; HG(1, 0.2) = 1.47 coded vs 0.149 normalised; Attenuation floor `exp(-6*0.2)*0.7` = 0.211 [p.80] → ✔
- layer 400-1000 m "smaller and lower than Horizon's 1.5 to 5 km" [p.10] → ✘ fixed: the thesis gives only the artistic reason; the Horizon comparison is ours (GP7 p.119), now marked as such
- step constants `inc_rate 0.04` [p.44], `mult_min 0.4` [p.47], `div_min 0.4` [p.51] → ✔
- runtime `procedural/settings.ts:161` (`stepMeters 25, maxSteps 256, lightTaps 6`) → ✔; `trace.wgsl.ts:212` coarse stage calls `procSample(..., true, ...)` (full sample) → ✔
- cross-note: the detail switch `ph*5`/`0.35 e^(-0.75 gc)` here vs GP7 `h*10`/`0.2` are both as printed in their sources (not a transcription error in either); the `/4*3.1415` HG line is shared with GP7 p.113 and N17 p.77, while HFW/NE22/Synthesizing print the correct `1/(4π)` (see `gp7.md` review)
