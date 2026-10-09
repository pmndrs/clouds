# Procedural shape, layering and surface detail: methods to implement

Scope: the shape, layering and surface-noise recipes in the papers, with the formulas, so implementers copy instead of inventing. Lighting is out of scope. Read `hzd-nubis-evolved.md` (profile tables, weather channels, NE 65 cirrus) and `nubis-sources.md` (N3/SY sampler) first; this note does not repeat them, it adds the chain between them and what we run in `packages/runtime/src/procedural/`.

Source tags: **HZD** = Horizon 2015 ARTR deck (printed slide numbers). **N17** = Nubis 2017 deck (printed slide number follows its notes). **NE** = Nubis Evolved 2022 (PDF page). **FB** = Hillaire, Frostbite 2016 course notes (section). **HF** = Högfeldt 2016 thesis (section). **B08** = Bouthors et al. 2008 (section). **SV** = Goswami 2021 survey (section 2, "Modeling").
**Trust levels.** *Sourced* = in a local source, cited. *Recalled* = the GPU Pro 7 listing (Schneider 2016) as widely reproduced, **not in any local source**; treat constants as starting values until we fetch the chapter (see section 5). The survey (SV) names techniques but gives no formulas.

## 1. What we already run

| Piece | Where | Matches |
| --- | --- | --- |
| Per-layer coverage remap `factor = 1 - cov * grad; remap(weather, factor, factor + width)` | `procWeatherSample` (takram) | HZD s35-36, N17 s40 |
| Semicircle height gradient `1 - (2 pow(h, bias) - 1)^2`, bias 0.35 | `procShapeAltering` | HZD s34 (one fixed type per layer) |
| Shape erosion `remap(d, (1 - shape) * amount, 1)`, 128^3 R channel only | `procSample` | HZD s35, NE 34 |
| Detail erosion, inverted at the base (`pow(detail, 6)` below hf 0.2 to `1 - detail` above 0.4), only inside 60 km | `procSample` | HZD s37 note |
| 2D turbulence offset of the lookup, 350 m, scaled by `remap(hf, 0.3, 0)` | `procSample` | HZD s33/37 (curl) |
| Layer density profile `a exp(b h) + c h + d` | `procLayerDensity` | HF 4.5 linear base gradient |
| Four layers, one weather channel each, densities summed | `tkChannel`, `procSample` | HZD s73, FB 5.3 "multiple layers" |
| Sky Pro: top = weather + cov - 1 + noise dilation; flat base mask; erosion strength rising base to top; wind lean of tops | `procCandidate`, `procErodedDensity` | N17 s45 (skew), N17 s40 |

Not present at all: **anvil bias, per-sample cloud type, base-height and cloud-height channels, multi-octave channel weights, curl strength by height, type-driven wispy/billowy switch, a painted type-profile LUT, 2D alto/cirro layers in this path, blob/metaball hero modelling.**

## 2. Methods (HZD chain first)

### M1. HZD / GPU Pro density chain (the reference order)
- **Shapes:** everything below cirrus: base/top profile, billow structure, edge wisps.
- **Sourced (HZD s29-38, N17 s33-40):** shape = 128^3 RGBA, R = Perlin-Worley, G/B/A = Worley at increasing frequency; detail = 32^3 RGB Worley, increasing frequency; curl = 128^2 RGB. Order: `shape * heightGradient`, then coverage and a base-density reduction ("bottoms will be whispy", s36 note), then erode with the detail noise "at the edges", detail lookup distorted by curl (s37). Detail is always an erosion (s76). Remap, not multiply, "prevents a loss of too much density at the core" (N17 s36).
- **Perlin-Worley (N17 s34):** `pw = remap(perlin, 1 - worley, 1, 0, 1)`. Worley is inverted so it makes billows, used as a lower bound that dilates Perlin (HZD s29).
- **Recalled (GPU Pro 7):**
  ```
  lfFbm = g*0.625 + b*0.25 + a*0.125                      // shape G,B,A
  base  = remap(r, -(1 - lfFbm), 1, 0, 1)                 // Worley fbm dilates Perlin-Worley
  base *= heightGradient(type, h)
  base  = remap(base, cov, 1, 0, 1) * cov                 // N17 s40 form
  p    += curl.xy * (1 - h) * curlStrength                 // detail lookup only; strength by height
  hfFbm = r*0.625 + g*0.25 + b*0.125                      // detail RGB
  mod   = mix(hfFbm, 1 - hfFbm, saturate(h * 10))         // wispy at the base, billowy above 0.1 of height
  d     = remap(base, mod * 0.2, 1, 0, 1)
  ```
- **We have:** the chain, but each noise contributes **one channel** (`noiseA.r`, `noiseB.r`); Sky Pro uses three channels as octave weights (`dot(rgb, (0.7, 0.41, 0.23))` for dilation, `(0.113, 0.04, 0.02)` for erosion), the same idea.
- **Suggest:** make Takram's shape lookup a weighted sum (`r` Perlin-Worley dilated by `0.625 g + 0.25 b + 0.125 a`) and the detail a 0.625/0.25/0.125 sum of its three channels, before the erosion remap. Cost: the same fetch (RGBA already stored, we read one lane). Expect richer billow hierarchy (large, medium, small lobes in one fetch) which is the "shape" complaint. Also scale curl by `(1 - h)`; ours is scaled by density, not height.

### M2. Type-blended height gradients (silhouette, base/top profile)
- **Sourced (N17 s28-29):** `gradient(type) = remap(h, a, b, 0, 1) * remap(h, c, d, 1, 0)`, e.g. stratus `(0, 0.1, 0.2, 0.3)`; type moves the in/out points; type 0 stratus, 0.5 stratocumulus, 1 cumulus; cloud map blue channel is type (N17 s59). HZD s34 shows three gradients blended by type, constants not given.
- **Recalled:** stratocumulus `(0, 0.2, 0.48, 0.625)`, cumulus roughly `(0, 0.1, 0.8, 1)` or `(0.01, 0.3, 0.6, 0.95)`; blend `type < 0.5 ? mix(stratus, strato, 2t) : mix(strato, cumulus, 2t - 1)`. Treat cumulus/strato as tunable; measure against `photo-species-specs.md`.
- **We have:** one fixed semicircle per layer; type is implicit in which of 4 channels you paint. No continuous type, so a layer cannot go stratus to cumulus across the map.
- **Suggest:** replace `procShapeAltering` with a 4-point trapezoid whose points are `mix`ed from a per-layer type (weather blue, or a hash of cluster). One `vec4` per type, three types, no texture. Smooth the trapezoid ends with smoothstep, not linear, to keep the dome top.

### M3. Coverage as inflation and the base-density reduction
- **Sourced (N17 s40, HZD s36):** `d = remap(noise, coverage, 1, 0, 1)`. Raising coverage "inflates" clouds; raising the threshold deflates them into isolated cores. This is the single control that turns a sheet into separate cumuli.
- **We have:** the same, with the coverage multiplied by the height gradient (Takram), and Sky Pro's `weather + coverage - 1`.
- **Suggest (shape, not new code):** the thing missing for "flat bases, domed tops" is HF 4.5's last step: a **linear rise of density with height applied after the erosion** (`d *= mix(0.1, 1, h)`-like). Our `densityProfile` default `[0, 0, 0.75, 0.25]` is that, so it is present; the knob to tune is the 0.25 constant (a cumulus base at 0.25 reads as soft, 0 reads as cut).

### M4. Erosion by detail, wispy bottoms and billowy tops
- **Sourced:** HZD s37 note (invert Worley at the base); HF 4.5.2 ("lower densities are eroded more"; strength is a threshold that only erodes densities **below** it); NE 99-100 (billowy/wispy switch height from type: `blend = remap(h, type + 0.1, type - 0.1)`, composite `mix(wispy, billowy, blend)`; type 0.25 flips low, 1.0 all billowy); NE 102 (thin clouds sample a different slice: offset `(1 - saturate(thickness * 0.0125)) * 40` m); N3/SY sampler (`nubis-sources.md`: wispy = `mix(n.r, n.g, D)`, billowy = `mix(n.b, n.a, D^0.25) * 0.3`, noise blend by detail type, billowy scaled 0.3 so it erodes less).
- **We have:** fixed switch at hf 0.2-0.4, no erosion threshold by density, no slice offset.
- **Suggest, all cheap:**
  1. Make the switch height an input: `remap(hf, sw - 0.1, sw + 0.1, 0, 1)` with `sw` from cloud type or a per-cell hash (0.25 rising cumulus with wispy base, 0.75 decaying with billows deep).
  2. Weight erosion by density as HF does: `erodeAmount = saturate(1 - d / T)` with T about 0.5, so cores keep mass and edges lose it. Our remap already does this implicitly at the core; add the explicit threshold for Sky Pro's `erosion = dot(...) * strength * coverage`, which is not density-aware.
  3. Add the NE 102 slice offset to the detail/shape y coordinate.
  4. Sky Pro's `erosionShape` (1 - noise, billows, vs noise) is the same wispy/billowy switch, a global scalar; drive it by height (billowy top, wispy base).

### M5. Curl distortion
- **Sourced (HZD s33, s37):** 128^2 RGB curl noise (non-divergent, "fake fluid motion"); it distorts the **detail** lookup only. N17 s107 lists "adding more distortion behaviors" as future work. Strength by height is **recalled**, not sourced. N3 bakes the curl into the "Curly-Alligator" channels, so the voxel path needs none at runtime (`hzd-nubis-evolved.md` 2.2).
- **We have:** `turb` offset, 350 m displacement, applied to **both** shape and detail lookups (`(wp + turb)`), which can tear the shape's silhouette.
- **Suggest:** apply the turbulence to detail only (as HZD) or use a smaller displacement (about 0.1 of the shape repeat) for shape. Add a second octave of curl at 3x frequency, weighted 0.35, scaled by `(1 - h)`, for the roll-up near bases. Source for scale: none, tune by eye.

### M6. Weather-map channels and what each drives
| Scheme | R | G | B | A | Source |
| --- | --- | --- | --- | --- | --- |
| HZD | coverage | precipitation | cloud type | | HZD s40; precip pushes to cumulonimbus at 70% cov (s42), biases at s38 |
| Nubis 2017 cloud map | coverage (Perlin) | coverage (Perlin-Worley) | type | | N17 s54-59: R gives connected formations, G gives isolated islands with connective tissue; low-frequency noise gates both; type from another low-frequency noise |
| Högfeldt | coverage (also density) | cloud **height** | cloud **altitude** (base) | | HF 4.4: height 0 = invisible, 1 = max; altitude 0 = atmosphere start; example map gives five altitudes from one texture |
| Frostbite | density | type index into a profile LUT | | | FB 5.3: LUT x = type, y = height; LUT R = density along height, G = **erosion amount** |
| NE profile model | min height, max height, coverage, bottom type, top type | | | | NE 20, 28 (in `hzd-nubis-evolved.md` 1.2) |
| Weather state | skew, anvil bias, wind, density scale | | | | N17 s60: constant per sample, not stored in the map |

- **We have:** Takram: four coverage channels, one per layer; Sky Pro: one coverage channel.
- **Missing and cheap:** HF's height and altitude channels. Per-cloud height (cell hash or a second channel) varies tower height, which is the "all clouds are the same height" problem. Per-cloud base altitude gives layered clouds in one layer (HF fig. 4.6).
- **Missing, best value:** FB's **type LUT**: a small texture, x = type, y = height fraction, storing density and **erosion amount** at each height. It encodes the base/top profile **and** where the surface is smooth versus eroded (smooth tops are cauliflower, eroded bases are ragged) in one painted image, and it can hold an anvil or two layers (FB 5.3 says so). It is a 2015-16 form of NE's top/bottom type tables. Implement as `textureSampleLevel(typeLut, vec2(type, hf))`, replacing M2's trapezoids; author the LUT with the species curves from `photo-species-specs.md`.

### M7. Anvil bias
- **Sourced (N17 s46-49), exact:**
  ```
  coverage = pow(coverage, remap(h, 0.7, 0.8, 1.0, lerp(1.0, 0.5, anvil_bias)))
  ```
  Above h = 0.7 the exponent falls toward 0.5 (at bias 1), so `coverage^0.5 > coverage` raises coverage near the top: the plume widens into a plate. A direction-skewed wind added for "dramatic effect" bends the anvil off the natural axis (s49).
- NE 159-163 supersedes it for storms: the anvil is a separate high plate from a **cirrus map centred on the storm** (data, not a shader term). FB 5.3 reaches the same through a painted type LUT.
- **We have:** nothing. Takram `factor = 1 - cov * heightScale`; Sky Pro `top = weather + cov - 1 + ...`.
- **Suggest (WGSL):** in `procWeatherSample`, before `factor`:
  ```wgsl
  let ex = mix(vec4(1.0), vec4(mix(1.0, 0.5, P.anvil)), saturate((o.hf - 0.7) / 0.1));
  let cov = pow(vec4(P.shell.w), ex);   // then use cov in place of P.shell.w
  ```
  For Sky Pro apply the same to `coverage` at `h`. Pair it with the wind lean (M9) so tops shear in one direction, as real anvils do. For a hero cumulonimbus add the NE plate: a second high layer (Takram channel 2, 7500 m is already there) whose weather channel is a radial falloff around the tower. Add `P.anvil` to `ProcParams`.

### M8. Wind skew and tower lean
- **Sourced (N17 s45):** `p += wind_direction * time_offset; p += height_fraction * wind_direction * 500.0;` The coverage signal is not animated, so shapes keep their layout while the detail evolves.
- **We have:** Sky Pro (`windSkew` 1750 m per shell). **Takram has no skew.**
- **Suggest:** one line in `procSample`: `wp.x/z -= hf * windDir * skewMeters` before the shape lookup. Skew about 500 m per layer height for 1-2 km clouds (HZD); scale with layer thickness for deep towers.

### M9. Layer stacking and blending (stratus, cumulus, altocumulus, cirrus)
- **Sourced:** HZD s73, s86-87: volumetric ≤ 4000 m; above, 2D scrolling alto/cirro textures at different speeds and directions. NE 15-16: stratus/stratocumulus/cumulus 0-1500 m class bases, alto 1500-4000, cirro 4000-8000; cumulonimbus spans all. NE 65: the 2.5D cirrus recipe (`hzd-nubis-evolved.md`). HF 4.4.2: wind per layer, cloud layer textures plus volumetric. FB 5.3: one slab, multi-layer via the LUT. N17 s61 (Constable): arrange depth layers across the frame ("curtains"). NE 186-187: composite by opacity-weighted hit distance.
- **Transitions between layers:** not described by any source. HZD blends types by height gradient at the sample; NE separates layers by solver (tropospheric, far orographic, near orographic) and blends colour, not density.
- **We have:** four weather channels summed in one march. Sum means two layers whose heights overlap add density (a smear), and each layer is its own coverage.
- **Suggest:**
  1. Keep layers **vertically disjoint** except by design: clamp each layer's `hf` to 0..1 (already) and give a 5-10% gap or an explicit overlap fade so alto sits above cumulus.
  2. Altocumulus/altostratus (1500-4000 m) as a thin Takram layer (`height` 500-800, `shapeAmount` 0.4, low `shapeDetailAmount`, large `weatherExponent`) with its **own repeat scale** (cell size 2-4x smaller than cumulus, from `photo-species-specs.md` spacing CV) and own wind, as HZD s87 does.
  3. Cirrus via the NE 65 formula, as a 2D layer (no march), composited behind the volumetric result by transmittance.
  4. Cross-layer transition: use the type LUT (M6) across the map so one painted type crosses stratus to strato to cumulus; no layer switch needed. Blend colour by opacity-weighted depth (NE 187; already in `legacy-and-survey.md`).

### M10. Horizon and far-field shape
- **Sourced (HZD s45-46):** within 35 km, from 15 km transition to cumulus at about 50% coverage: "always some variety and epicness". Sky Pro: `horizonCoverage` ramp (20 km start, 45 km ramp, +0.12). **We have both.** Add the type half: also push **type** toward cumulus at the horizon.

### M11. Cloud-map generation (clusters and islands)
- **Sourced (N17 s53-59):** map ≈ 100 km^2; low-frequency noise gates where clouds may exist; higher-frequency Perlin (R) gives connected formations, Perlin-Worley (G) gives isolated islands; blend by artist choice. NE 75-78: regional influence NDFs per weather state.
- **We have:** Sky Pro: fbm "mass" (4 freq, 5 octaves, contrast 1.32) plus "detail" fbm (6 freq, 6 octaves, 0.13).
- **Suggest:** add a Worley-islands term to the weather bake: `w = mix(perlinFbm, remap(perlin, 1 - worley, 1, 0, 1), islands)`. That alone gives separated cumuli with connective haze instead of a Perlin continent.

### M12. Bouthors surface hypertexture
- **Sourced (B08 section 5, p.5-6):** `rho(p) = S(D(p) + noise(p))`, S a sigmoid, D distance to the cloud surface (0 on it, rising inside; baked to a volume texture), noise a scalar 3D Perlin evaluated live. Applied only in a thin layer below the surface; the mesh carries the large shape, the hypertexture "handles all the frequencies of details not handled by the mesh". Noise dominates the cost (10 fps to 2 fps at 512^3, mesh only to mesh plus noise).
- **Why it matters:** displacing the distance, not the density, makes silhouette roughness a **length** (metres) regardless of density, and the sigmoid width is the soft-edge width.
- **We have:** Sky Pro is already a hypertexture with `S = smoothstep(-edge, edge, .)`, `D = top - h` (vertical distance, a height-field), `noise = erosion` (`procErodedDensity`: `smoothstep(-edge, edge, top - erosion - h)`). The voxel path has a real SDF (`GetVoxelCloudDistance`).
- **Suggest:** for the voxel/N3 path add `density = S((-sdf + A * (n - 0.5)) / w)` as a **second silhouette pass**, not instead of the N3 erosion: `A` 2-6 m near the camera fading to 0 by 150 m (matches the HHF band), `w` 1-3 m. This gives crisp surface roughness in metres. For the height-field shapers, keep `erosion` in shell fractions but cap it in metres so tall layers do not get larger bumps.

### M13. Shape grammar, blobs, metaballs, implicits (survey)
Techniques (SV section 2 "Modeling"); none give formulas, so these are **ideas, not recipes**:
| Method | What it models | Takeaway for us |
| --- | --- | --- |
| Gardner 1985: textured ellipsoids, Fourier-series texture | coarse cumulus lobes, plus thin planes for layers | Ellipsoid plus a texture is the cheapest hero lobe; same as inverted Worley |
| Ebert: procedural implicit spheres, fractal displacement | cumulus built as sphere union with turbulence | Same pattern as M12; fractal displacement of an implicit surface |
| Bouthors & Neyret 2004: **blob hierarchy** | child blobs placed on a parent; field functions control size, overlap and **bottom flatness** | The grammar we lack: towers = parent blob with child billows on its surface at smaller radii; flat base = clip by a plane field |
| Schpok 2003: ellipsoid implicits plus preset noise filters, two-level animation | interactive authoring; macro keyframes plus micro "wisps straying" | Maps to our hero (blobs) plus procedural (noise) split |
| Webanck 2018: density functions by type | per-type density and shape functions, a control function for large-scale cover, elevation and altitude range as inputs | Closest to a "type table" like M2/M6 |
| Wither 2008, Stiver: sketch to skeleton, spheres on the skeleton | cumulus from a silhouette outline | Authoring front end for hero clouds |
| Dobashi 2000s: metaballs from photos, 2D texture for cirrus, 3D metaballs for altocumulus | altocumulus as metaball sheets, cirrus as 2D | Confirms cirrus 2D, alto as thin 3D |
| Goswami & Neyret 2017: hypertexture inside physics-driven parcels; Goswami 2018 cloud map | macro physics, noise amplification, painted map | Cloud map plus noise amplification is HZD with parcels |
- **Suggest (one new recipe, cheap):** a **billow-sphere field** for hero shapes: `n = 1 - F1` of Worley at cell size ≈ the lobe radius (what inverted Worley already is: a union of spheres), then a hierarchy by octave: `lobes = max(billow(p/R), 0.6 * billow(p/(R/2)), 0.35 * billow(p/(R/4)))` clipped by `heightGradient`. Using `max` (union) in place of a sum keeps lobes distinct instead of averaging them into mush. This is the "billow structure" gap, and matches `generate/shaders.ts` `worleyLobes`; port it to the procedural path as an optional replacement for `noiseA.r`.

### M14. Cirrus and 2D layers (pointer only)
`hzd-nubis-evolved.md` section 1.2 has the NE 65 formula (streaky/wispy/round textures by `cloud_type`; `pow(d, 1 - remap(cov, 0, 1, -0.9, 0.9))`; `* remap(cov^3, 0, 0.5, 0, 1)`). Nothing new in HZD s86-87, HF 3, FB beyond it. HF 4.3 (old "cloud layer textures" for far alto/cirrus) confirms the layered design.

## 3. Gap list (shape, layering, detail), ordered

1. **Anvil bias** (M7): one `pow` line, N17 s46-49, exact. Missing today.
2. **Multi-octave channel weights** for shape and detail (M1, 0.625/0.25/0.125 recalled; Sky Pro already weights). Same fetch, richer billows.
3. **Type-driven gradient / type LUT** (M2, M6): species continuity across the map and an erosion-by-height channel (FB 5.3). Biggest structural gain.
4. **Per-cloud height and base altitude** (M6, HF 4.4): kills "all clouds the same size".
5. **Wind skew in Takram** (M8): one line, N17 s45.
6. **Type-driven wispy/billowy switch height + thin-cloud slice offset** (M4, NE 99/102).
7. **Turbulence on detail only, curl scaled by height** (M5).
8. **Worley islands in the weather bake** (M11, N17 s54-58).
9. **Layer separation and a thin alto layer with its own scale and wind** (M9).
10. **Hypertexture silhouette pass in metres** (M12, B08) and **billow-sphere union field** (M13).

## 4. Not worth doing
- Cellular-automata and fluid cloud simulation (SV section 4): not a shape tool at our cost; `cloud-motion-ideas.md` owns motion.
- Mesh and marching-cube cloud shapes (Trembilski, Puss in Boots VDB meshes): we have the VDB path already.
- Spectral/Fourier synthesis (Sakas): superseded by the noise textures.

## 5. Fetch list (nothing downloaded)

| # | Paper | Have? | Why it matters | Code? |
| --- | --- | --- | --- | --- |
| 1 | Schneider, "Real-Time Volumetric Cloudscapes", **GPU Pro 7** ch. 4, pp. 97-128 (2016) | **No** (cited in N17 refs) | Source of the exact gradient constants, the fbm weights (M1), curl strength, anvil, and the density sampler listing. Clears every "recalled" tag above | **Yes**, HLSL |
| 2 | Hillaire, **TileableVolumeNoise** (github.com/sebh/TileableVolumeNoise), cited by FB App. D and N17 s34 | **No** (we hold the Frostbite text only) | The Perlin-Worley recipe and octave layout of the shape and erosion textures; reproduces the HZD set | **Yes**, C++ |
| 3 | Webanck, Cortial, Guérin, Galin, Peytavie, Benes, **"Procedural Cloudscapes"**, Eurographics 2018 | **No** (SV cites it as [99]) | Per-type density and shape functions with a control function and altitude range, plus morphing between cloudscapes; the only paper aimed at cloud **types** as procedures. Closest to M2/M6 | Partial, equations; no shader |
| 4 | Bouthors & Neyret, **"Modeling Clouds Shape"**, Eurographics short 2004 | **No** (SV cites [6]) | The blob hierarchy with field functions for size, overlap and bottom flatness: the grammar behind M13 | No |
| 5 | Goswami & Neyret, **"Real-time landscape-size convective clouds simulation and rendering"** (VRIPHYS 2017), and Goswami, "A novel approach to model cumulus cloud shapes with a cloud map" (2018) | **No** (SV [32-34]) | Hypertexture in parcels plus a cloud map; GPU shader description for 200 fps; macro-physics to noise amplification | Partial, shader pseudocode |
| 6 | Schpok, Simons, Ebert, Hansen, **"A real-time cloud modeling, rendering, and animation system"**, SCA 2003 | **No** (SV [87]) | Ellipsoid implicit modelling plus preset noise filters; two-level (macro and micro) animation | No |
| 7 | Ebert et al., **Texturing & Modeling: A Procedural Approach**, cloud chapter (3rd ed.) | **No** | Original implicit-sphere plus fractal displacement code (M12/M13 lineage) | **Yes**, C |
| 8 | Häggström, **real-time volumetric cloud thesis** (2018) | **No**. Not the same as Högfeldt 2016 (`hogfelt.pdf`, which we have, cited as HF) | A second thesis-level implementation walk-through; check it before fetching, its content overlaps GPU Pro | Likely implementation detail |
| 9 | Perlin & Hoffert, **"Hypertexture"**, SIGGRAPH 1989 | **No** (B08 cites it) | Origin of `S(D + noise)`; short; the density-shaping functions | Pseudocode |
| 10 | Neyret, **"Advected textures"**, SCA 2003 | **No** (SV [70]) | Moves detail with the flow; ties to the owner's observation in `cloud-motion-ideas.md` | No |
| 11 | Dobashi et al., **"Modeling of clouds from a single photograph"** (2010) | **No** (SV [19]) | Cirrus as 2D, altocumulus as metaballs, cumulus by thickness; a photo-to-density method for our cloud-photo library | No |
| 12 | Schneider, Nubis 2017, 2022, 2023, "Synthesizing" 2024; Hillaire 2016; Högfeldt 2016; Bouthors 2008; the 2021 survey | **Have** | Cited above | Slide code only |

**Top 5 to fetch:** GPU Pro 7 (#1, closes every recalled constant), TileableVolumeNoise (#2, reproduces the noise set), Webanck 2018 (#3, type procedures), Bouthors & Neyret 2004 (#4, blob grammar), Goswami & Neyret 2017 with the 2018 cloud map (#5).

## 6. Notes for implementers
- Everything sourced here was read from the local copies in `artifacts/research/` (HZD ARTR, Nubis 2017, the survey, Frostbite 2016, Högfeldt, Bouthors 08, `nubis-src/` notes) on 2026-10-09. The survey has no formulas in its modelling section; every formula under "Sourced" is from a slide, a thesis or the Bouthors paper.
- The recalled GPU Pro constants (M1, M2) are widely reproduced in community ports but are not verified by us. Do not cite them as sourced in code comments; cite them as "GPU Pro 7, from memory" until #1 is fetched.
- Any change to `procedural/density.wgsl.ts` lands behind the compare page and gets a capture of the hero tower and the cumulus field; judge shape by the target photos, not by numbers.
