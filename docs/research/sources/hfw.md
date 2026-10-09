# The Real-time Volumetric Superstorms of Horizon Forbidden West (Schneider, GDC 2022)
Local: `artifacts/research/papers/TheReal-timeVolumetricSuperstormsOfHorizonForbiddenWest_Schneider_Andrew.pdf` (117 pp, one slide per page, speaker notes under each) · Dump: `artifacts/research/extracted/hfw/` · Tags: shape layering storm weather light perf · Status: 🟩 (note written, code transcribed)

## In one paragraph
A 54-minute talk. Slides 1-41 recap the Horizon Zero Dawn (HZD) Nubis model; slides 42-116 add **localized superstorms** by extending the same coverage/type data model rather than adding a separate system. The new content is small but specific: a split top/bottom vertical profile, a new "bottom type" field, a superstorm coverage field and variable min/max height field, nested counter-rotating noise rings for the mesocyclone, a flipped profile plus offset cirrus for the anvil, and local lighting hacks (optical-thickness scale, ambient blend, a ray-march-free internal glow). It does **not** reveal new density formulas, noise recipes, or the dimensional profile (that is Nubis Evolved). All "code in images" are in fact vector text on the slide, so they were transcribed from the text layer and spot-checked on 200 dpi renders (p.67, p.78).

## Key ideas (with page)
- **Recap, identical to HZD (say "same as hzd15")**: coverage + type probabilities [p.9]; type blends height gradients stratus/stratocumulus/cumulus into one "Vertical Profile Gradient" lookup [p.10-12]; billows vs wisps, Perlin-Worley (Worley subtracted from Perlin's high-density regions) [p.13-14]; LF 128^3 + HF 32^3 and remap erosion rather than multiply, because remap "prevents a loss of too much density at the core" [p.15-16]; coverage as erosion of (noise * profile) so clouds inflate as coverage rises [p.17-18]; cirrus = 3 tiling cloudscapes blended by type, eroded by inverse coverage [p.19]; wind = offset on the noise sample only, coverage/type fields are static so shapes persist while detail evolves [p.21]; NDF generator = noises + remaps + composites over world XY [p.22-23]; coarse/fine march, light march, temporal 16-pixel blocks, 480x270 -> 1920x1080 (16 ms -> 2 ms) [p.24-40]; perf ladder 60+ -> 22 -> 3.34 -> 1.2-2.0 ms [p.41].
- **Superstorm = stencil on the data fields** [p.50]. Position, radius, coverage; only the region inside is overridden, for both the tropospheric and cirrus layers. Everything is "a function of the cloud system itself" for lower code and cost [p.49]; the transition to ordinary clouds is therefore seamless [p.75].
- **Mesocyclone body** [p.51]: composite several noises, blended to maximum at the centre, giving a cylindrical foot (the speaker's "sombrero" before the anvil). Increase coverage and type radially toward a point.
- **New "bottom type" field** [p.52-54]: a second cloud type controlling only the underside. Vertical profile gradient is split into a **top-type lookup and a bottom-type lookup, multiplied** [p.53]. As bottom type rises, the bottom curve relaxes and noise types blend to wispier shapes: the ragged torn underside. Page 53 figure: three 2D LUTs (Cloud Top Type, Cloud Type, Cloud Bottom Type; x = type, y = height). Top LUT has a staircase upper edge growing taller with type; bottom LUT is a smooth ramp from a hard cut to soft.
- **Superstorm coverage** added as a data field purely to blend lighting and modelling behaviour [p.52].
- **Twisted noise for vortex tendrils** at the base, driven in the modeling map [p.55]. Underside is deliberately not flat.
- **Variable height** [p.56-57]: min and max cloud height encoded in a new data field; the NDF generator makes distorted noises and radial gradients as height-adjust signals to define the underside.
- **Animation without fluid sim** [p.59]: the vortex is faked by rotating the detail-noise sample position about the storm centre: `SampleNoise(GetRotatedPosition(pos, center, time))` [p.60]. A single rotation fails because real vortices spin faster in the centre. So: **6 nested rings (0-5)** each with its own speed, decreasing outward [p.61]; adjacent rings overlap, noise sampled at both speeds and lerped (two noise samples in overlap); **RingSkew[n]** adds a twist offset so outer rings seem to interact with inner faster ones [p.62]. They chose explicit rings over flow maps for art control [p.61].
- **Motion vectors for temporal upscale** [p.63-70]: the 16-frame reconstruction makes a fast vortex "pixel soup". Fix: compute a per-pixel previous position by applying the same rotation to the cloud's world position, blended by a mask (code p.67). This let them raise rotation speed to a realistic value. Reused for scrolling clouds: blend scroll vector vs. storm vector (code p.69), allowing far faster cloud scroll.
- **Anvil, tropospheric** [p.72]: where superstorm coverage > 0, **flip the vertical profile gradient and combine it with the normal one** to spread the top horizontally; noises rotated and skewed for a wind-swept look. Figure: normal LUT "+" its vertical flip; in-engine render is a dome with a flat top and flat base skirt.
- **Anvil, cirrus** [p.73]: NDF generator uses storm position, radius and wind vector to put a cirrus formation above the mesocyclone, offset downwind. Links the storm to the high layer.
- **Lighting**: (a) optical thickness scale near the storm (formula below) [p.77-79]; (b) ambient settings lerped inside a cylindrical field that falls with height [p.80-81]; (c) internal glow without second light march [p.82-85]; (d) lightning intra-cloud = glow with a moving position and an intensity curve from Uman's timing; ground discharge = particle bolt + internal flash + "external flash" that highlights underside features [p.86-90]; (e) a **stable mask** generated before each flash so the 16-frame reconstruction does not smear a 4-8 frame flash [p.92-95]: the mask builds to a full image by flash time, the animated intensity multiplies it.
- **Environment/control** [p.96-106]: storm shadow on the world, dust/snow/rain by biome, 5 spawn locations, 2 min ramp up, a few minutes persist, 2 min dissipate; a local weather event = position, radius, blend factor, driven by Effect Graph, feeding renderer, NDF generator and lightning.
- **Perf** [p.107-111]: PS4 960x540, 6 light samples, 60-90 view samples, 2x blur, noise MIP 1; PS5 1920x1080, 10 light, 96-180 view, 1x blur, MIP 0. Normal budget 2 ms. Storm: <=4 ms full frame, 2-3 ms half frame. PS4 storm: ring overlap replaced by **jittered boundary** (one noise sample), anvil top reduced to a non-distorted billowing shape.
- **Reference** [p.45-48]: supercell time lapses and Orf's El Reno simulation; four key features: mesocyclone, anvil, internal/ambient light, lightning.

## Formulas and constants (as printed)
- Remap erosion: `base_cloud_density = remap(lf, 1 - hf, 1, 0, 1)` [p.15]; `cloud_density = remap(base * vert_profile, 1 - coverage, 1, 0, 1)` [p.17].
- HG: standard, eccentricity 0.2 [p.31]; several HGs with different g mixed for art-directed silver lining [p.32].
- In-scatter probability `T * (1 - e^-d)`, T = e^-d [p.34]; ambient `pow(1 - coarse_density, 0.5)` [p.37]. Accumulation `light_absorption += d * (1 - sat(abs))` etc. [p.39].
- Superstorm optical thickness: `density_scale = pow(min(1 - dist/radius, 0) + 1, 0.5)`; `summed_density += d(n) * density_scale`; `T = exp(-summed)` [p.78]. Illustrated exponents e^-5d, e^-10d, e^-20d [p.77]. **Caution: the printed min() is a typo.** As printed, `min(1 - dist/radius, 0) + 1` is exactly 1 **inside** the radius (no effect where the storm is) and falls below 1 outside it (0 at 2x radius, negative and NaN under `pow` beyond). With `max()` the scale is `sqrt(1 + max(1 - dist/radius, 0))`: 1.41 at the centre falling to 1 at the radius, i.e. up to about 1.4x optical depth, which **does** match the stated intent (darker, thicker storm). Read it as `max`; the 0.5 exponent and the +1 are as printed, any further strength factor is not shown. Applied per light-march sample inside the density sampler [p.78].
- Ambient blend: `amb_blend = min(1 - dist1/radius, 0) * (dist2/height)`; `lerp(cloud_amb, storm_amb, blend)` [p.80]. Same min() typo: as printed the blend is 0 inside the radius and negative outside; with `max()` it is `(1 - dist1/radius) * (dist2/height)` in 0..1. dist1 = horizontal distance from the storm centre; dist2 is drawn as a vertical arrow at the cloud base and the notes say the probability **decreases** over height, so the sign of the height term is not settled by the slide (dist2/height as printed rises with height).
- Internal glow: `potential = pow(1 - d1/radius, 12)`, `height_gradient = d2/height`, `pseudo_attenuation = 1 - sat(fine_density * 5)`, `glow = potential * height_gradient * pseudo_attenuation`, `light_energy = direct + ambient + glow` [p.85]. d1 = sample to light distance, d2 = (as figure) height of sample above cloud bottom.
- Motion-vector blend mask: `pow(sat(1 - length(xy - center)/radius), 0.1)` [p.67] (a very flat mask: ~1 almost to the edge).
- Ring count 6, speeds decreasing outward; no numeric speeds, radii, overlap widths or skew values given.

## Code listings (all vector text; transcribed in `extracted/hfw/code/`)
| Page | File | What |
| --- | --- | --- |
| 15 | hfw-p015.hlsl | LF/HF remap erosion |
| 17 | hfw-p017.hlsl | coverage remap |
| 21, 22 | hfw-p021/p022.hlsl | wind offset line; NDF remap label |
| 31 | hfw-p031.hlsl | Henyey-Greenstein, rsqrt form |
| 34, 37 | hfw-p034/p037.hlsl | in-scatter probability; ambient |
| 39 | hfw-p039.hlsl | march accumulation |
| 60, 61, 62 | hfw-p060/061/062.hlsl | rotated noise sampling, rings, skew (pseudocode) |
| 67 | hfw-p067.hlsl | superstorm motion vector (full) |
| 69 | hfw-p069.hlsl | same with scroll blend (diff only; full text on page) |
| 78, 80, 85 | hfw-p078/080/085.hlsl | optical thickness, ambient blend, internal glow |
Not given anywhere: `GetRotatedPosition`, `GetSuperstormRotationSpeed`, the NDF generator, the LUTs, noise textures, ring boundaries.

## Figures worth pulling
p.10-11 type height gradients and combined LUT; p.14-16 noise and remap erosion; p.18 coverage inflation; p.19-20 cirrus type blend; p.50-51 stencil and "sombrero"; **p.53 top/bottom/type LUTs**; p.54 bottom-type ragged underside; p.55, 57 twisted modeling map and height map; **p.61 ring diagram**; p.62 skew; p.65-66 pixel soup vs motion vectors; **p.72 flipped profile anvil**; p.73 cirrus data field; p.77-81 attenuation/ambient; p.84-85 glow geometry; p.94 flash mask; p.103 world map and spawn sites; p.108 PS4/PS5 table.

## What we already do / don't / try
Compared with `packages/runtime/src/`:
- Remap erosion `remap(density, (1-shape)*amount, 1)`, coverage as inflation, inverted-Worley base wisps: present (`procedural/density.wgsl.ts:21-25`, `:215-223`). Consistent with p.15-17.
- **Split top/bottom profile with a bottom-type field: not present.** Our profile is one height-gradient/type model (`density.wgsl.ts:190-226`, `procLayerDensity`). This is the single biggest new shape lever here: a multiplicative bottom LUT driving ragged, wispier undersides (also in Nubis Evolved; see `hzd-nubis-evolved.md` NE 26-27).
- **Variable min/max height per cloud (height field)**: our shell is fixed min y/max y (`density.wgsl.ts:44` `shell`). Missing.
- **Flipped-profile anvil, downwind cirrus offset**: not present; `cirrus/` has no storm coupling and nothing in runtime references storm/anvil/mesocyclone. Wind lean exists as `spWind.z` skew (`density.wgsl.ts:98`).
- **Nested rotating rings / vortex**: not present. Needs per-ring rotated noise sample positions plus overlap lerp; cheap to prototype on detail noise only.
- **Motion vectors for fast-moving cloud in the upscaler**: our temporal pass reprojects through the cloud's mean distance with camera matrices only (`shaders/temporal.wgsl.ts:15, 88`), so a rotating or fast-scrolling field would smear; p.67/69 is the fix.
- **Local darkening / ambient blend**: we have global density/light scale (`misc`), no radial local control (`density.wgsl.ts:47`).
- **Internal glow**: present as `flashGlow` (`shaders/march.wgsl.ts:51`) with the `pow(1-d/r, 12)` shape (`lightning.ts:10`); the `pseudo_attenuation` and height-gradient factors should be checked there. No stable pre-flash mask, but ours is not temporally reconstructed over 16 frames so likely unnecessary.
- Contradictions with existing notes: none in substance. `hzd-nubis-evolved.md` line ~249 quotes `pow(min(1 - dist/radius, 0)+1, 0.5)`; that is faithful to the slide, but see the caution above: read `max`, giving 1 to 1.41x inside the radius. `ne22` prints the same line on its p.165 (see that note). Its "NE 149-150" ring parameters match this talk (RingRotationSpeed/RingSkew).

Try next (ranked): 1) bottom-type LUT x top-type LUT multiply (p.53); 2) per-cloud min/max height field; 3) flipped profile for anvil spread plus downwind cirrus patch (p.72-73); 4) six overlapping rings of rotating detail noise with skew, jitter instead of double sample for cheap mode (p.61-62, 109); 5) motion vectors from the same rotation in the temporal pass (p.67, 69).

## Superseded by / supersedes
Repeats hzd15 for slides 1-41 (nothing new). Superstorm slides overlap Nubis Evolved NE 135-182 (`hzd-nubis-evolved.md`); NE has the extra NDF detail (influence NDFs, solver integration), this talk has the code and the motion-vector and stable-mask material.

## Review (Opus spot-check, 2026-10-10)
- remap erosion `remap(lf, 1 - hf, 1, 0, 1)` and coverage `remap(base * vert_profile, 1 - coverage, 1, 0, 1)` [p.15, 17] → ✔
- HG rsqrt form, `* (1/(4 pi))`, g = 0.2 [p.31] → ✔ (normalised; GP7 p.113 and Häggström B.6 print `/4*3.1415` instead, see `gp7.md`)
- superstorm `density_scale` "min() makes the scale exactly 1 everywhere; max() would thin" [p.78] → ✘ fixed: as printed it is 1 **inside** the radius and below 1 outside; the `max` reading is `sqrt(1 + max(1 - d/r, 0))`, 1 to 1.41, which thickens as the notes say. Same correction applied to `ne22.md` (p.165).
- ambient blend min() [p.80] → ✘ fixed: wording made exact (0 inside, negative outside as printed); `dist2` direction left open
- internal glow `pow(1 - d1/r, 12) * d2/height * (1 - sat(fine*5))` [p.85] → ✔
- motion-vector mask `pow(sat(1 - len/r), 0.1)` and the rotate-then-lerp construction [p.67] → ✔
- 6 nested rings, overlap sampled twice and lerped; PS4 uses a jittered boundary [p.61, 109] → ✔
- PS4/PS5 table 960x540/1080p, 6/10 light, 60-90/96-180 view, blur 2x/1x, MIP 1/0, 2 ms budget [p.108] → ✔
- runtime `shaders/march.wgsl.ts:51` `flashGlow` and `lightning.ts:10` `pow(1 - d/r, 12)` → ✔; `procedural/density.wgsl.ts:44` `shell` min/max y → ✔
