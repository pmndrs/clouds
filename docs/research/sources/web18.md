# Procedural Cloudscapes (Webanck, Cortial, Guérin, Galin; Eurographics / CGF 37(2), 2018)
Local: `artifacts/research/papers/Procedural-Cloudscapes-EG2018-article.pdf` (HAL copy, 13 pdf pages; pdf page = paper page - 429, so pdf p.5 = paper p.433). Dump: `artifacts/research/extracted/web18/`. Citations below use **pdf page** `[p.N]`. · Tags: shape layering weather authoring · Status: 🟦 note written (no code listings exist; one pseudocode transcription, see below)

## In one paragraph
An offline (10 s/frame at 720p on a GTX 970, ray-marched single scattering [p.9]) cloudscape model in which **each cloud type is its own closed-form density function** with a base elevation and altitude range (Table 2), a shape field phi (low-frequency noise: where the cloud is) minus a details field delta (higher-frequency noise: erosion), and a large-scale **control field** c (sum of smooth spherical primitives, from a painted cover map) that decides where the type exists and whether it fades or shrinks. Layers add and are squashed with `x/sqrt(1+x^2)`. Most of the paper (Sections 5, Figs 8-13) is about morphing key-framed cover maps with Optimal Transport and anisotropic shortest paths under wind and terrain; that part is irrelevant to our shape/layering problem and is only summarised at the end. **Only two of the ten type functions (Altostratus, Altocumulus) are printed**; the rest are "in the supplementary material", which is not in our PDF (see gaps).

## Key ideas
- **Type table with altitude bands** (Table 2, [p.5]): ten tropospheric types, each with base elevation `e_i` and range (thickness) `r_i` in km. The pair bounds the support of the type's density `a_i`. Fig. 3 [p.4] draws the same layers: low < 2 km, medium 2-7 km, high 7-12 km, with Cumulonimbus spanning 1-12 km. Layers may overlap; overlap blends smoothly because densities are summed.
- **Shape = phi - delta, clamped** `s_i = max(phi_i - delta_i, 0)` [p.5]. phi is the overall density distribution (low frequency). delta is high-frequency detail that is *subtracted*, so the cloud's compact support gets a complex, eroded border (Fig. 5 [p.5] shows phi alone vs phi - delta for Altocumulus and Cumulus: phi alone is smooth wispy blobs, subtracting delta gives crisp cauliflower / popcorn). This is the same "erode the base shape with a finer noise" idea as HZD, but expressed as a plain subtraction on a continuous field, not a remap.
- **Control field and two lifecycle behaviours** [p.5-6]: `a_i = (1 - cbar_i*alpha_i) s_i - (1 - alpha_i) cbar_i`, `cbar_i = 1 - c_i`. alpha = 1: `a = c*s`, a pure fade (support unchanged as c falls), used for stratiform / high clouds. alpha = 0: `a = s - cbar`, a **shrink**: a constant is subtracted, so the support contracts toward the densest cores as cover falls, which is how cumuliform clouds die. They used alpha = 0.1 for Cumulus and 1 for vanishing Cirrostratus; alpha is a per-type constant, not interpolated [p.6]. Fig. 6 [p.6] shows the four combinations.
- **Layer combination**: `a(p,t) = sum_i a_i`, then `sigma(x) = x/sqrt(1+x^2)` so the sum stays in [0,1) [p.5]; the paper also applies sigma to each `a_i` to keep it in the unit interval (end of p.5). No explicit vertical blending between layers; they just add where bands overlap.
- **Control primitives** [p.6]: the user paints a greyscale cover image per layer; it is sampled on a coarse regular grid into overlapping spheres `C_j` (centre `b_j`, radius `R_j`, max density `x_j` from the grey value; radius and altitude set by cloud type). Falloff `g_j(r) = x_j (1 - r^2)^3` on r = distance/R in [0,1] (called the "cubic falloff" on p.6, where the text layer drops the exponent; App. A [p.13] prints `(1 - r^2/R^2)^3` explicitly, confirmed on a 200 dpi render), `c = sum_j c_j`, normalised by sigma. Examples (Fig. 7 [p.6]): heart-shaped cover carved in Stratocumulus, aircraft contrails in Cirrus, letters carved in Stratus, a hole in Cumulus cover over a mountain peak.
- **Animation without simulation** [p.6]: 4D simplex noise and cellular (Worley 96) noise; c drives cover evolution, phi drives global shape change, delta drives small-scale animation. Each layer has its own wind (Fig. 14: Stratus W to E at low altitude, Cirrus NE to SW up high).
- **Terrain interaction** [p.7-8, Fig. 10]: the layer's elevation range is warped by a smoothed terrain height (`kappa_e = clamp((z~ - a)/(b - a), 0, 1)` is the terrain-intersects-layer cost term), so low layers (fog, Stratus) hug valleys.
- **Fog in valleys** (Fig. 17 [p.10]): 460 primitives; a low "fog-rise" layer and a high Cumulus layer; fog winds are a small updraft, Cumulus winds strong horizontal.

## Formulas and constants (all exact unless noted)
Table 2 [p.5] (km; temperate latitudes; elevation = base, range = thickness):

| Class | Type | Elevation | Range |
| --- | --- | --- | --- |
| High | Cirrus | 8.6-13.0 | 1.0-2.0 |
| High | Cirrostratus | 6.0-8.0 | 0.1-3.0 |
| High | Cirrocumulus | 6.0-8.0 | 0.2-0.4 |
| Medium | Altostratus | 3.0-5.0 | 1.0 |
| Medium | Altocumulus | 2.0-6.0 | 0.2-0.7 |
| Medium | Stratus | 0.1-0.7 | 0.2-0.8 |
| Medium | Stratocumulus | 0.5-1.5 | 0.2-1.2 |
| Low | Nimbostratus | 0.1-1 | 2.0-5.0 |
| Low | Cumulus | 0.8-1.5 | 0.1-5.0 |
| Low | Cumulonimbus | 0.8-1.0 | 7.0-12.0 |

The paper does not say how a value inside the elevation interval is chosen (per cloud, per region, from the control primitive's altitude, or from terrain); the intervals read as "base can sit anywhere in this band". Stratus and Stratocumulus are grouped under "Medium" in the table though their bases are low; that is the paper's grouping.

Appendix B [p.13], units: **one modeling unit = 100 m**. k in [0,1] morphs Altostratus (k=1) to Altocumulus (k=0), "any value in between gives a continuous blend":
```
phi(p)   = k + (1-k) * h(0.43, 1, n_phi( (p.x*0.35, p.y, p.z) / 1000 ))
delta(p) = (1-k) * ( 0.75 * n_delta(p/1000) + 0.25 * (1 - w_delta(p/1000)) )
```
`h(a,b,x)` is the Hermite smoothstep from 0 at a to 1 at b.

| turbulence | octaves | persistence | lacunarity | frequency |
| --- | --- | --- | --- | --- |
| n_phi | 8 | 0.52 | 2.02 | 36 |
| n_delta | 8 | 0.52 | 2.02 | 96 |
| w_delta | 4 | 0.33 | 3.00 | 400 |
n and w are "a sum of scaled cellular noise and simplex noise"; the mix weights, noise ranges and how "frequency" combines with the `/1000` are not specified. My reading (inferred, not stated): with p in 100 m units, `p/1000` is a 100 km domain and "frequency" multiplies it, giving a base feature period of about 100 km/36 = 2.8 km for phi, about 1 km for n_delta, and about 250 m for w_delta.

What this means shape-wise (inference from the formulas):
- **Altostratus (k=1)**: phi = 1 everywhere, delta = 0, so s = 1: a *featureless slab* inside its 1 km altitude band, all the visible structure coming from the control field c and the band edges. That is the whole recipe for a stratiform sheet.
- **Altocumulus (k=0)**: phi = a Hermite threshold of an 8-octave noise at 0.43..1 (so noise values below 0.43 give no cloud: the *coverage cut-off is baked into h*; how much of space that clears depends on the noise's value distribution, which is not given); the x coordinate is multiplied by 0.35 before the noise, which **stretches features along x by 1/0.35 = 2.86x**: the elongated banded patches visible in Fig. 5 top-left. delta mixes 75 percent of a mid-frequency fbm (96) with 25 percent of an inverted 4-octave, lacunarity-3 cellular-flavoured term at frequency 400, which is a "cell wall"/pebble signature; subtracting it gives the puffy, separated cloudlets of Fig. 5 top-right.
- Only a morph parameter between two very similar types is shown; no formula for Cumulus, Cirrus, Cumulonimbus, Nimbostratus etc. (Fig. 4/5 renders exist for Cumulus, Stratocumulus, Cirrocumulus, Nimbostratus).
- **No vertical density profile is given.** The paper never defines a height gradient inside a layer. The vertical structure is the 3D noise (p.y enters both n functions) cut by the band `e_i .. e_i + r_i`; hard-vs-soft cut is not stated. Compare HZD/Nubis, which define explicit per-type height gradients.

Primitive mass (for morphing only) [p.13 App A]: sphere of radius R with falloff `(1 - r^2/R^2)^3` has mass `4*16/(105*5) * pi R^3`; falloff `-2(1-r/R)^3 + 3(1-r/R)^2` has mass `4/(3*5) * pi R^3`.

Stats: cross-winds 2 layers 56x56 km, 110 primitives; cold front 8 layers 588x120 km, 8 control primitives per layer; fog-rise 2 layers 126x126 km, 460 primitives; morph solve "a few seconds" per key-frame pair [p.9]; 10 s per 1280x720 frame [p.9] (not real time; "ongoing research" to speed up by optimising the primitive hierarchy). User study: 15 participants; plausibility significant for Altostratus and Cumulus, Cirrus "not perceived as sufficiently convincing" (wind direction mismatch suspected) [p.10-11].

## Code listings
None in the paper. `extracted/web18/code/web18-p13.hlsl`: pseudocode transcription of Appendix B (phi, delta, a_i, sigma, control falloff). Marked "verify"; note the paper's falloff glyph on p.6 is the cube of `1 - r^2`.

## Figures that explain shape (pdf pages)
- p.4 Fig. 3: the altitude-band diagram with all types; the best single "layering map". Fig. 2: pipeline (control + shape -> density).
- p.5 Fig. 4: Cumulus / Stratocumulus / Cirrocumulus / Nimbostratus reference renders from the model. Fig. 5: **phi vs phi - delta** for Altocumulus and Cumulus (the detail-subtraction effect; the clearest shape figure).
- p.6 Fig. 6: alpha fade vs shrink (c = 1 / 0.5, alpha = 1 / 0 / 0.5). Fig. 7: control-field authoring: heart, contrails, logo, hole.
- p.8 Fig. 10: layer elevation range warped by smoothed terrain.
- p.10-11 Fig. 14 (two crossing layers), Fig. 15 (8-layer cold front: Cirrus, Cirrostratus, Altostratus, Altocumulus, Cumulus humilis, Stratocumulus, Cumulus congestus, Cumulonimbus capillatus), Fig. 17 (valley fog + Cumulus).

## What we already do / don't / what to try
Our procedural model: `packages/runtime/src/procedural/density.wgsl.ts` (two shapers, `PROC_SKYPRO_WGSL` lines 85-172, `PROC_TAKRAM_WGSL` 175-241), settings in `settings.ts` (Takram layer fields, `TakramLayer` interface lines 52-64), noise in `textures.ts`.

| Webanck type | Our closest | Verdict |
| --- | --- | --- |
| Altostratus / Stratus / Nimbostratus / Cirrostratus (alpha=1 slab, k=1) | Takram layer with `coverageFilterWidth` wide and `shapeAmount` 0 so the noise stage is bypassed (`density.wgsl.ts:196,215`; `settings.ts:52-64`) | **Existing channel, preset change.** A layer with flat gradient and no shape erosion is a slab; the uniform sheet needs only the weather channel as the control field. The type table gives altitude/thickness values to seed presets (Altostratus 3-5 km base, 1 km thick). |
| Altocumulus / Stratocumulus / Cirrocumulus (patchy, stretched, k=0) | Takram layer: shape erosion `density.wgsl.ts:214-215`, detail 219-223 | **Noise change.** We have no **anisotropic coordinate scale** in the shape lookup: `wp * tkRepeat.y` is isotropic (`:214`). Webanck's `px*0.35` gives streaky bands; try per-layer `(sx, sy, sz)` or wind-aligned stretch. Also our shape noise is one 128^3 Perlin-Worley texture read once; Webanck's phi is an 8-octave fbm with a **baked coverage threshold `h(0.43, 1, n)`**, which our `procRemap4(.., factor, factor+width)` (`:196`) already generalises. |
| Cumulus (alpha ~ 0.1 shrink) | Sky Pro shell (`:92-115`): top = weather + coverage - 1 + dilation*coverage, which already behaves as a coverage-driven shrink | **Same idea, different parametrisation.** Our coverage subtracts a constant from the height field `(coverage - 1)`, i.e. alpha = 0. We lack an alpha blend between fade-by-multiply and shrink-by-subtract per layer. Cheap to add in Takram's path: `density = mix(local*s, s - (1-local), alpha)`. Worth testing for stratiform vs cumuliform lifecycles when coverage animates. |
| Cumulonimbus 7-12 km thick, Nimbostratus 2-5 km thick | Shell thickness is user-set (`SkyProShape.thickness`, `settings.ts:12-16`) | **Can't do well yet**: a single anvil/tower with a height-dependent footprint is not a type channel; needs the anvil/gradient work in `procedural-shape.md` (N17 s46-49). Webanck gives only the altitude range. |
| Cirrus (8.6-13 km, 1-2 km thick) | Takram layer at that altitude with shape disabled | **Noise change**: needs a streak/curl noise (not in Webanck either; Cirrus phi/delta are in the missing supplementary). |
| Control field c (spheres, painted cover) | Our weather map (`procWeather` 2D texture, `density.wgsl.ts:90,192`) | **Same role.** Their cover is a sum of radial-basis spheres normalised by `x/sqrt(1+x^2)` rather than a texture; no new capability for us beyond painting (a "stamp spheres into the weather map" authoring tool would give heart/contrail/hole carving). |
| Layer sum + sigma | Takram sums four layer densities (`:227-228`), no squash | We sum without normalising; sigma is an optional soft clip if overlaps oversaturate. |
| phi - delta subtraction | Sky Pro erosion `:119-125`: subtracts `erosion` from the top and base heights (`top - erosion`), smoothstepped | **Same family.** Both subtract detail from a smooth shape; theirs is a straight density subtraction in 3D, ours is a height-field offset. Theirs gives true 3D holes and overhangs; ours is a column model and cannot (flag for Sky Pro shaper). |

### Multi-body cumulus scenes (clusters, lines, size distributions)
The paper does **not** model individual cumulus; it places *cover* with spheres and lets 3D noise (phi) decide the actual cloudlets. Useful for us:
- A **cover sphere** of radius R and peak x makes one cumulus field patch; sphere radius is "defined according to the cloud type" [p.6] but no size distribution is given. The 8 primitives per layer in Fig. 15 span a 588 km front, so these are cloud-field scale (tens of km), not single clouds.
- **Lines of cumulus (streets)**: not covered; the closest tool is the anisotropic `px*0.35` stretch (one axis longer) in phi, which gives rows when aligned to wind. That is a one-line change for us.
- **Cluster/gap statistics** come from the noise threshold: `h(0.43, 1, n)` clears every point whose noise is below 0.43 before the control field acts (the cleared fraction depends on the noise distribution), so coverage = shifting that threshold. Our `coverage` plays the same role.
- **Size distribution**: not specified; it falls out of the octave chain (frequency 36, lacunarity 2.02, 8 octaves, persistence 0.52): features spanning roughly 2.8 km down to 20 m, with amplitude falling by 0.52 per octave. A rough approach to try: use these persistence/lacunarity numbers as the target spectrum when authoring our shape noise.
- Shrinking (alpha=0) means small clouds vanish first and big cores last, which is the realistic dissipation order; our coverage ramp already does this in Sky Pro.

## Gaps and cautions
- Supplementary material (the other eight types' phi/delta and the 3D cloud renderer details) is not in our copy; the paper's own note says so [p.13]. Webanck 2018 therefore settles **layer table, combination rule, fade/shrink, and two shape functions**, not a full type library.
- The paper's rendering is single scattering ray march only; no lighting content to take.
- `procedural-shape.md` L134/L167 calls it "per-type density and shape functions with a control function"; that is accurate, but "closest to a type table like M2/M6" over-reads it: the table is only altitude/thickness, and there is no per-type vertical gradient.
- The authors line in `procedural-shape.md` (Peytavie, Benes) differs from the HAL cover (Webanck, Cortial, Guérin, Galin); the HAL copy is the source here.

## Top ideas to try (shape / layering / detail)
1. Per-layer anisotropic noise scale (Webanck `px*0.35`, [p.13]) in the Takram shape lookup (`density.wgsl.ts:214`): streaky altocumulus, cumulus streets.
2. Fade-vs-shrink alpha per layer (`a = (1 - cbar*alpha) s - (1-alpha) cbar`, [p.5]): stratiform fades, cumuliform shrinks when coverage animates.
3. Seed layer presets from Table 2 altitudes/thickness [p.5] (Altocumulus 2-6 km / 0.2-0.7; Stratocumulus 0.5-1.5 / 0.2-1.2; Cirrocumulus 6-8 / 0.2-0.4; Altostratus 3-5 / 1).
4. Noise spectrum reference: 8 octaves, persistence 0.52, lacunarity 2.02; detail as 0.75 fbm + 0.25 inverted cellular fbm (lacunarity 3, 4 octaves) [p.13] for the delta (erosion) channel.
5. Sphere-stamped control map authoring with `(1-r^2)^3` falloff and sigma squash [p.6] for carving holes/lines in the weather texture.

## Superseded by / supersedes
Complements HZD/Nubis (explicit height gradients per type, which this paper lacks). Cited by the Comprehensive Survey as [99]. The morphing half (Sections 5, OT, ghosting) has no counterpart in our runtime and no near-term use; note if we ever key-frame weather states, interpolating primitive sets with OT and ghost primitives for births/deaths is the method.

## Review (Opus spot-check, 2026-10-10)
- Table 2 elevations/ranges and the High/Medium/Low grouping (Stratus, Stratocumulus under Medium; Nimbostratus under Low) [p.5] → ✔ (render)
- `s_i = max(phi - delta, 0)`; `a_i = (1 - cbar*alpha) s - (1 - alpha) cbar` [p.5] → ✔
- alpha 0.1 Cumulus, 1 vanishing Cirrostratus, per-type constant [p.6] → ✔
- falloff `(1 - r^2)^3` "confirm on p.6" [p.6, 13] → ✔ confirmed via App. A on a 200 dpi render; caveat removed
- App. B phi/delta, `px*0.35`, `/1000`, 100 m unit, Table 4 octaves/persistence/lacunarity/frequency [p.13] → ✔ (200 dpi render)
- primitive masses `4/(3*5) pi R^3` and `4*16/(105*5) pi R^3` [p.13] → ✔
- sigma applied only to the sum [p.5] → ✘ fixed: the paper also clamps each `a_i` with sigma
- "about 43 percent of noise values / space clear" (inference) → ✘ fixed: the cut is at noise value 0.43; the cleared fraction depends on the unstated noise distribution
- runtime `settings.ts:12-16` `SkyProShape.thickness` → ✔; `settings.ts:52-64` "layer list" → ✘ fixed: it is the `TakramLayer` interface (fields), not a preset list

