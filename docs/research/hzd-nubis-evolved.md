# HZD (2015) and Nubis Evolved (2022): variety, noise, lighting, shadows

> **Superseded by / see also:** [sources/hzd15.md](sources/hzd15.md), [sources/ne22.md](sources/ne22.md), [sources/nut.md](sources/nut.md), [sources/n17.md](sources/n17.md), [sources/hfw.md](sources/hfw.md), [sources/gp7.md](sources/gp7.md); topic guides [topics/shape.md](topics/shape.md), [topics/layering.md](topics/layering.md), [topics/weather.md](topics/weather.md). The source notes are exact (page-level, reviewed); this note stays as the earlier overview.

Scope: what the two earlier Schneider talks add to `nubis-sources.md` (N3/SY formulas) and `deck-scenes.md`
(scene catalog). Nothing here repeats those. Targets are the tasks in `docs/PLAN-2026-10-variety.md`.

| Tag | Source |
| --- | --- |
| **HZD** | *The Real-time Volumetric Cloudscapes of Horizon: Zero Dawn*, SIGGRAPH 2015 Advances (the ARTR PDF: 97 slides with speaker notes). Cited by the printed slide number. |
| **NE** | *Nubis Evolved*, SIGGRAPH 2022 Advances (207 pages, little speaker text, code on slides). Cited by PDF page, which equals the slide number. |
| **N3 / SY** | As in `nubis-sources.md`. |

Source limits, so nobody over-trusts this note:
- The HZD ARTR PDF has **no code and no numeric gradient constants**. The three height gradients are images only.
  The exact smoothstep constants were in the GPU Pro 7 chapter, which we do not have. Anything below marked
  *(GPU Pro, unverified)* is recalled from memory and must not be treated as sourced. *(Update 2026-10-10: GPU Pro 7 is now read, see `sources/gp7.md`, and the Nutshell gradient stops are exact in `sources/nut.md`; the 2015 swatches are an illustration, not the shipped curves.)*
- Slide images are in `work/captures/scratch/hzd/` (gitignored): `hi/h-NN.png` (PDF page NN), `evs/*.png` contact sheets.
  HZD printed slide number = PDF page minus 1 or 2 (the notes pages repeat the slide number); use `sheets/`.

## 1. Cloud types and variety

### 1.1 What HZD actually does

- **Three low-altitude types are three height gradients, blended at the sample point by a type value.**
  - Slide 34: "3x Mathematical" gradients, "Blends based on cloud type", plus a 0..1 "Coverage Signal".
  - Image shape, bottom to top (as drawn): **stratus** = a thin bright band hugging the bottom (a few percent of the
    layer); **cumulus** = a band from about 15% to 60% of the height, soft at both ends, dark above; **cumulonimbus**
    = filled from the bottom to nearly the top, fading only at the very top.
  - The notes call them "presets that represent the major low altitude cloud types" (slide 34).
  - Exact formula: not in the deck. *(GPU Pro, unverified)*: each is a pair of `smoothstep` ramps (rise, fall)
    on height fraction, lerped stratus to cumulus for type 0 to 0.5 and cumulus to cumulonimbus for 0.5 to 1.
- **Density build (slides 35 to 38):**
  1. `SetRange( shapeNoise * heightGradient )`: sample 3D texture 1 and multiply by the height signal (slide 35).
  2. Multiply by coverage and by a second gradient that *reduces density at the base* ("bottoms will be whispy",
     slide 36 note). Coverage also pulls the shape up so "the presence of clouds" grows naturally.
  3. Erode with 3D texture 2 at the edges, distorted by 2D curl noise (slide 37).
  4. Notes tip: "invert the Worley noise at the base of the clouds you get some nice whispy shapes".
     This is the origin of height-dependent wispy-to-billowy detail (N3's per-voxel *detail type* generalises it).
- **Weather map = 3 channels, 2D, over the player's region** (slides 39 to 42):
  - R = coverage, G = precipitation, B = cloud type. Slide 40 note: "Red is coverage, Green is precipitation and blue
    is cloud type." *(Sources disagree on G: GPU Pro 7 p.103 agrees; N17 p.53-56 and Nutshell s16 make R and G two coverage footprints; Häggström uses G as high-coverage fill. See `topics/layering.md` §1.)*
  - Slide 41: where red is high and blue low you get stratus; "more red have less of the blue signal, making them stratus".
  - Slide 42: precipitation "transitions the map from whatever it is to cumulonimbus clouds at 70% coverage".
    So cumulonimbus is **not a fourth type channel**; it is a precipitation override on coverage and type.
  - The slide-38 controls show the ranges: Coverage +-0.5, Type +-1, Precipitation +-1 (biases on the weather sim).
- **How the weather map is made:** "The weather system modulates these channels with a simulation that progresses
  during gameplay", with "controls to bias the simulation" for art direction (slide 40). Cutscenes (E3 trailer)
  override it with **painted textures per shot** (slide 47). The deck gives no noise recipe for the sim.
- **Horizon variety trick** (slides 45, 46): clouds drawn within a 35 km radius; "Starting at a distance of 15,000
  meters... we start transitioning to cumulus clouds at around 50% coverage". The slide-45 diagram is a ring from
  15 km to 35 km. Purpose, in the note: "there is always some variety and 'epicness' to the clouds on the horizon".
  Cheap for us: far-field coverage and type are forced toward a mid-coverage cumulus value so the horizon never
  empties or goes uniform.
- **2D alto/cirro layer** (slides 73, 86, 87): volumetric strato clouds 1500 to 4000 m; above 4000 m, "2D alto and
  cirro class clouds", "scrolling textures instead of multiple samples". Slide 87: "various types of cirrus and
  alto clouds that were tiling and scrolling at different speeds and directions". Three greyscale tiling textures
  (streaky, patchy, speckled, per the slide-87 thumbnails), different wind per texture. No lighting model is given.
- **Atmosphere is a spherical shell** (slides 71 to 74): clouds descend into the horizon, and "we can force the scale
  of the scene by shrinking the radius". Ours is a flat sky layer; curvature is a variety tool at the horizon.
- **Anvil and "probability" tricks: not in the 2015 deck.** Searching the text for anvil, probability and ground
  returns nothing relevant ("probabilities" on slides 51 to 53 means light scattering). The anvil bias is a GPU Pro 7
  / 2017 item *(unverified, from memory)*: a coverage exponent that changes with height and with an anvil-bias
  scalar, so cumulonimbus tops spread wide. NE gives the real anvil treatment (section 5).

### 1.2 NE: the type model gets two axes and a 2D profile table

- NE 20 to 28: the "Vertical Profile Model NDFs" are 2D maps of **min height, max height, coverage, bottom type,
  top type** (5 channels). The layer is 256 m to 2048 m (NE 20). So a cloud's vertical shape is no longer one scalar
  type but two: `Top Type` (0 = stratus, then stratocumulus, then cumulus, NE 21) and `Bottom Type` (NE 26), each
  indexing a 2D lookup of profile versus height (NE 22, 26, 28). **`vertical_profile` = top-profile x bottom-profile**
  (NE 28), then `dimensional_profile = vertical_profile * cloud_coverage` (NE 29).
- NE 23 to 25 show the three tops in-engine: cumulus tall with domed tops and flat base, stratocumulus lower and
  elongated, stratus low and sheet-like. NE 27 "Bottom Type = 0.0" was read here as a ragged underside; **corrected 2026-10-10:** the N3 s18 table data show bottom type 0 is the sharp-onset (flat, crisp) base and type 1 the slow, ragged ramp. See `sources/n3.md` §7.
- This is the practical answer to "one blob": independent top and bottom axes, plus per-cloud min and max height
  (so base height and depth vary per cloud).
- NE 15 to 16: the troposphere split: stratus, stratocumulus, cumulus 0 to 1500 m class bases; altostratus and
  altocumulus 1500 to 4000 m; cirrostratus and cirrus 4000 to 8000 m; cumulonimbus spans all. Two sub-layers
  (stratus, cirrus) are used in the sky model.
- NE 65 (the **2.5D model**, for high thin cloud): one `cloud_type` 0..1 selects among three **noise textures**
  (`cr_streaky`, `cr_wispy`, `cr_round`, NE 65 thumbnails: fibrous streaks, wisps, round puffs):
  ```
  density = ValueRemap(cloud_type, 0.5, 1.0, ValueRemap(cloud_type, 0.0, 0.5, cr_streaky, cr_wispy), cr_round)
  density = pow(density, 1.0 - ValueRemap(cloud_coverage, 0.0, 1.0, -0.9, 0.9))
  density *= ValueRemap(pow(cloud_coverage, 3.0), 0.0, 0.5, 0.0, 1.0)
  ```
  This is the cirrus/altostratus recipe we can copy almost verbatim for 9-E: streaky to wispy to round as type rises;
  coverage as an exponent (thin coverage keeps only the density peaks) plus a cubic fade-in. NE 66 to 68 show the
  result (fibrous cirrus, red sunset altocumulus) and the light model for it (NE 67: a few samples toward the sun
  through the sub-layer).
- NE 69 to 80 **authoring and regional variety**: the final NDFs = procedural generator + hand-edited layer
  (NDF Editor, Houdini) + **Influence NDFs** (NE 69 to 75). An influence mask (red in the diagrams, NE 75) blends a
  regional NDF over the procedural one. NE 77: different regions get different procedural NDF sets (cumulus
  procedurals in one area, stratocumulus in another, "+ Regional Influence NDFs"). NE 78: weather states
  (calm-cloudy, stormy, calm-clear) are each a cloudscape of NDFs blended into the "Current Weather". The in-engine
  weather minimap (NE 70, 71, 74) shows the data: a green/black mottled map, i.e. clusters of cells, not noise at
  one scale. This is the Nubis answer to multi-scale weather (our 9-B): **regional layers selected by region and by
  weather state, not one global recipe**.

### 1.3 Mapping to what we have

Our plan's 9-B and 9-C already match the NE structure (cluster scale, species channel, one base per layer). The
deck-sourced additions are in section 6.

## 2. Noise

### 2.1 HZD noise set (slides 29 to 33)

| Texture | Size | Channels | Role |
| --- | --- | --- | --- |
| Shape 3D | 128^3 | R = Perlin-Worley, G/B/A = Worley at **increasing frequencies** | base shape (slide 31) |
| Detail 3D | 32^3 | RGB = Worley at increasing frequencies | edge erosion (slide 32) |
| Curl 2D | 128^2 | RGB = curl noise | distorts the detail lookup (slide 33) |

- **Perlin-Worley (slide 29):** Worley "layered ... like the standard Perlin fBm", inverted so it "makes tightly
  packed billow shapes", then "used as an offset to dilate Perlin noise", keeping "the connectedness of Perlin noise"
  but adding billows. NE 32 labels it `Perlin 1-Worley`, i.e. a remap of Perlin by (1 - Worley), and NE 33 shows the
  4-channel 128^3 "Noise Composite".
- **Frequencies are not given** in either deck; only "increasing frequencies". (GPU Pro: roughly octave doubling.
  Unverified.)
- **Remap and erosion order**, from slides 35 to 38 and NE 34:
  1. base = shape.R (Perlin-Worley) combined with Worley fBm of G/B/A, multiplied by the height gradient and coverage
     (SetRange remap on the shape noise first);
  2. NE 34 simplified form: `density = saturate(noise_composite - (1 - dimensional_profile))`;
  3. detail: `base - detailWorley(distorted by curl) * edgeFactor`, applied only where base > 0 (cheap-then-expensive,
     slides 77 to 80). Detail is **always an erosion from the edge** (slide 76).
  4. Notes: detail is inverted at the base for wisps (slide 37 note).
- NE 105 (envelope model) adds the sharpening: `height_fraction * pow(saturate(noise - (1 - profile)), 0.27)`.
  That 0.27 exponent is the NE equivalent of our `pow(rho*Sp, 0.3..0.6)`.
- NE 99 (envelope model type): `noise_height_blend = Remap(h, type+0.1, type-0.1)`; `composite = lerp(wispy, billowy, blend)`.
  Type sets the **height at which noise flips from billowy (top) to wispy (bottom)**: 0.25 flips low, 0.75 high,
  1.0 all billowy (NE 100). *(Correction 2026-10-10, `sources/ne22.md` review: as printed, `Remap(h, type+0.1, type-0.1)` puts billowy below the switch; the NE diagram has billowy above. Flip the argument order to match the diagram.)* This is a per-cloud, height-driven detail-type rule that we can use for 9-D.
- NE 102: noise sample position is offset vertically by `(1 - saturate((max_h - min_h) * 0.0125)) * 40.0`, so thin
  clouds sample a different slice of the 3D noise than tall ones (thin clouds do not look like slices of tall ones).
  Very cheap variety.

### 2.2 Comparison with our runtime

- `packages/runtime/src/shaders/density.wgsl.ts` is the **Nubis Cubed** sampler (Curly-Alligator, 128^3 RGBA, wispy
  `n.r/n.g`, billowy `n.b/n.a * 0.3`, `valueErosion`, near-camera HHF), plus our `detailBias`. It does not use HZD's
  Perlin-Worley, 32^3 detail or 2D curl lookup. That is intentional: N3 says Perlin-Worley "looked like packed spheres".
- `packages/runtime/src/generate/shaders.ts` builds the **shape field** with our own inverted-Worley **lobes**
  (`worleyLobes`, radii 0.75 to 1.3 cells, heights 0.65 to 1, up to 3 octaves, cell halves per octave) applied near
  the surface of a dome. That is the part HZD and NE replace with **type-indexed 2D profile tables**
  (top-type x bottom-type) times coverage times a Perlin-Worley-style composite.
- Net: our density-up-rez is already at N3 level. What HZD and NE offer is on the **macro** side (profiles, weather
  channels), not the noise stack.
- One HZD idea we do not have: **curl distortion of the detail lookup** (slide 33, 37). Our N3-style noise has the
  curl baked into the Curly-Alligator channels, so we get most of it. A runtime 2D curl warp of the sample position
  costs one fetch but is probably redundant. Low priority.

## 3. Lighting and shadows

### 3.1 HZD lighting (slides 49 to 69)

- Model (slide 69): `Energy = e^(-d*p) * HG * P`, where `p` = absorption (raised for rain clouds, slide 68),
  `HG` = Henyey-Greenstein, `P` = powder.
- **Beer:** `E = e^-d` (slide 61). **Powder:** `E = 1 - e^(-2d)` (slide 62), the "powdered sugar" term for dark
  edges facing the light. Combined "Beer-Powder" is the product (slide 63 compares No Lighting, Beer, Powder,
  Beer-Powder).
- **Powder is view dependent** (slide 66): "we only see it where our view vector approaches the light vector", so the
  effect should be faded as you look toward the sun. Slide 67 pans away from the sun to show it strengthening.
- **HG** (slides 54 to 56): one lobe on the sample, no constants. Brightens clouds around the sun (silver lining).
- **Ambient** (slide 88): "Ambient sky contribution increases over height", direct is "dominated by the sun color",
  "Atmosphere would occlude clouds over depth". Ambient is a height ramp, not a density-based term (NE and N3 replace
  it with `pow(1 - P, 0.5)`, NE 59). Colours are all computed live: "no pre-baking" (slide 89).
- N3 deliberately dropped powder for the `ms` term (`nubis-sources.md` s4). Our `lighting.wgsl.ts` already follows
  N3 (`cloudInScatter`, silver lobe mix). Powder is only worth adding as the cheap dark-edge look for the 2.5D sky
  layer, where there is no SDF.

### 3.2 Light sampling (slides 82 to 86)

- 6 light samples in a **cone** toward the sun (slide 83); the cone "smooths the banding" and "weights our lighting
  function with neighboring density values, which creates a nice ambient effect".
- The last sample is placed far away "to capture shadows cast by distant clouds" (slide 83). That is the only
  inter-cloud-shadow mechanism in HZD.
- Once alpha reaches 0.3 the light samples use the cheap (no detail) shader: 2x faster (slide 84).
- Rain clouds: absorption up, so they darken (slides 68, 69).

### 3.3 Ground shadows

- **HZD: no ground-shadow technique is stated anywhere.** The only "shadow" statements are the distant light sample
  above and the failure note that billboards "couldn't easily re-produce inter cloud shadowing" (slide 13). The
  early-prototype note on spherical harmonics (slide 12) is for baked cloud lighting, not ground shadows.
- **NE gives the first real statement**, for the **envelope (orographic) model only**: NE 112:
  ```
  float transmittance = exp(-inSummedSamples);
  float long_distance_shadow_sample = SampleLongDistanceShadowMap(inSamplePosition);
  float direct_scattering = transmittance * long_distance_shadow_sample;
  ```
  So the envelope clouds do 2 marched sun samples plus a **precomputed 2D "long distance shadow map"** lookup for
  the rest (NE 110 diagram: marked 128 m and 256 m ranges, red sample dots along the sun ray, with the remaining
  ray replaced by the map). The map's construction is not explained on the slides (no text, no code). It is
  an optical-depth-along-the-sun texture, which is the same idea as our 10-A shadow map.
- NE 112's wording is "Long Distance Shadow Sample" (a map *used by cloud lighting*). Whether the same texture
  shadows terrain is not stated in the extracted text. N3's table says envelope and voxel clouds cast terrain
  shadows and the vertical-profile sky does not (`nubis-sources.md` s1). Treat the long-distance shadow map as the
  likely mechanism but unproven.
- **Conclusion for 10-A:** our design (sun-space optical-depth cascades, covering sky-layer clouds too) goes
  **beyond** the decks, since vertical-profile sky clouds never shadow the ground in the game. There is no
  reference to match for sky-layer ground shadows; judge by plausibility.

## 4. Performance

- **HZD cost:** the full approach costs "around 20 milliseconds" (slide 91). Target "around 2 milliseconds" (slide 93).
  Memory: "20 mb of ram" (slide 2) and "2 3D textures and 1 2D texture" (slide 89).
- **Reprojection (slides 92, 93):** quarter-resolution buffer, "update 1 out of 16 pixels for each 4x4 pixel block"
  each frame, reproject the previous frame, and where reprojection fails (screen edge) fill from the low-res
  buffer. "10x faster or more when we render this at half res and use filters to upscale." Reported as "pretty much
  the whole reason" it shipped. N3 later dropped this for voxel clouds under flight (s44), kept it for the sky
  layer (20 ms to 2 ms).
- **Step counts (slide 81, 90):** "initial potential 64 samples ... potential 128 at the horizon"; 6 light samples
  per march sample in a cone; cheap work until potentially in a cloud.
- **Cheap-to-full march (slides 75 to 80):** large step with low-detail (shape only) sampling until a cloud iso-
  surface is hit, step *back* once, switch to full samples; after several consecutive zero-density samples switch
  back. Stop when alpha = 1 (slide 79). The cheap/full split is what our SDF-skip march replaces.
- **NE numbers:**
  - NE 39 step size: `3.0 + (60.0 * dist) / 16384.0` m (3 m near, +60 m at 16 km) for the vertical-profile model.
  - NE 125, 126: envelope-model cone-step march **4.2 ms to 1.3 ms** (before/after on the same frame; this is
    the SDF/cone skip that became N3's SDF march).
  - NE 183, 184 (superstorm VFX): PS4 960x540, 6 light samples, 60 to 90 view samples, blur 2x, noise MIP 1,
    <= 4 ms. PS5 1920x1080, 10 light samples, 96 to 180 view samples, blur 1x, MIP 0, <= 2 to 3 ms.
- Light ray samples at 6 to 10 and view samples at 60 to 180 are the reference budget for the *sky layer* cost.
  Our 9-E target (<= +0.3 ms) is consistent with a 2D sub-layer (NE 67: few samples toward the sun).

## 5. Nubis Evolved additions (between HZD and N3)

1. **Top x bottom type profile tables** and per-cloud min/max height (NE 20 to 29). Section 1.2.
2. **Influence NDFs, regional procedurals, weather states** (NE 69 to 80). Variety by region and by state.
3. **2.5D thin-cloud model** with streaky/wispy/round texture selection (NE 65). Cirrus recipe.
4. **Envelope (orographic) model** (NE 96 to 131): flat `min_height`/`max_height` envelope with
   ```
   h = Remap(height, min_h, max_h, 0, 1)
   top = pow(1 - h, 1.5);  bottom = pow(h, 2.0);  edge = Remap(sample_height, 0, 35, 1, 0)
   profile = bottom * top * edge
   ```
   (NE 97; N3 s20 repeats it.) This is a dome. Type 0 to 1 moves the billowy/wispy switch height (NE 99), the
   noise slice shift on thin clouds (NE 102), terrain-hugging authoring with a Houdini grid and painted density
   (NE 107 to 109). NE 129: extra fields for location: "Cloud Distance, Upper Angle, Lower Angle". The in-engine
   results at NE 109 and 114 show valley-top cloud caps pooled on peaks: the T3 reference.
5. **Long distance shadow map** (NE 112), section 3.3.
6. **Superstorm (NE 135 to 182):**
   - **Anvil** (NE 159 to 163): a vertical-gradient mask at the storm's top plus a **cirrus NDF centred on the
     superstorm centre** (NE 161) spreading outward, with its own "Superstorm Influence NDFs" for min and max height,
     coverage, bottom and top type (NE 139). The anvil is data, not a shader term: a wide high plate fed by the
     2D map, not by the tower's own noise.
   - **Rotation** (NE 147 to 158): "M.D.R. Vortex Field": noise lookups are rotated about the storm centre with a
     **different angular speed per ring** (`ring_rotation_speed[n]`, `ring_skew[n]`, NE 149 to 150), and
     reprojection is rotated too (NE 155) so motion stays stable.
   - **Lighting overrides** by distance to the storm centre (NE 164 to 172): optical thickness scaled by
     `pow(min(1 - dist/radius, 0)+1, 0.5)` *(Correction 2026-10-10, `sources/hfw.md` p.78 and `sources/ne22.md` p.165: as printed this is 1 inside the radius and thins outside; the intended thickening inside is `sqrt(1 + max(1 - d/r, 0))`, 1 to 1.41x)*, ambient settings lerped between normal and superstorm by a radius and
     height weight, and internal glow `pow(1 - d1/radius, 12) * (d2/height) * (1 - saturate(fine_density*5))`.
     N3 reuses the 12th-power glow. A darker rain-cloud absorption `T = e^(-5d..-20d)` is shown at NE 164.
   - **Lightning** (NE 173 to 182): system generates a position, triggers an intra-cloud flash then optionally a
     ground discharge, flash intensity animated; a stable mask is multiplied in (NE 180).
7. **Integration** (NE 186 to 190): three solvers (Tropospheric/Superstorm, Far Orographic, Near Orographic) and
   the cloud colour blends to atmosphere by an **opacity-weighted average of hit distance** (NE 187, `weighted_sum`),
   so haze is applied by where the cloud mass is, not the first hit.
8. NE 192 to 205 introduce the **Volume Data Field** (NVDF with `Cloud Density` and `Cloud Distance`, source-agnostic
   distance step mapping): the precursor of N3's NVDF.
9. NE 41 to 61 (vertical-profile model lighting) already contains the N3 pieces in code:
   `Direct = T * PrimaryPhase + MS * SecondaryPhase` (NE 43),
   `ms_volume = Remap(dimensional_profile*step_size, 0.1, 1, 0, 1) * pow(coverage*type, 0.25)`,
   `*= pow(attenuated_light, cMSDepthPower)`, `*= pow(height_fraction, cMSHeightPower)` (NE 54),
   `ambient = pow(1 - dimensional_profile, 0.5)` (NE 59), and a normalised HG with `rsqrt` (NE 48). The multiple-
   scatter term depends on **coverage*type** and **height fraction**, which are free in a 2.5D model. The powers are
   not given. This gives the ms recipe for the sky layer where there is no SDF (N3's SDF-based `ms` cannot be used there).

## 6. Actionable list for the plan

Marked **[cheap]** if it is a constant, lookup or small shader change, **[medium]**, **[larger]**.

### 9-B Weather v2 (multi-scale weather, one base per layer)
1. **[cheap]** Keep three channels but add the NE ones as *per-cloud* values: `topType`, `bottomType`, `minHeight`,
   `maxHeight` (NE 20). One base per layer = same `minHeight` for the cumulus population, +-15 m jitter. Maps to our
   species channel.
2. **[cheap]** Horizon variety rule (HZD 45): beyond a radius (HZD 15 km of 35 km), blend far-field coverage and
   type toward a fixed cumulus mid-coverage (about 0.5). Prevents empty or uniform horizons for T1.
3. **[medium]** Regional layers (NE 75 to 78): a small set of named regional maps (cumulus field, stratocumulus
   field, clear, storm), each with its own parameters, blended by an influence mask at cluster scale (2 to 8 km).
   This is our cluster-scale layer made explicit, and gives presets that mix species in one sky.
4. **[cheap]** Per-cloud thin-vs-tall noise slice offset (NE 102): shift the noise sample by
   `(1 - saturate(thickness * 0.0125)) * 40 m` so small clouds are not slices of big ones.
5. **[cheap]** Wind-shear from altitude: HZD 22 lists "Wind direction varies over altitude" as a rule, which matches our shear vector.

### 9-C Species profiles
6. **[medium]** Implement the species as **top-type and bottom-type 1D curves** over height (NE 21, 26, 28):
   `vertical_profile = topCurve(topType, h) * bottomCurve(bottomType, h)`. HZD gives the three silhouettes:
   stratus thin base band, cumulus band 15 to 60% with soft ends, cumulonimbus filled bottom to near top.
   Curves we author as lookups (a 2D table texture or analytic smoothsteps); no constants exist to copy.
7. **[cheap]** Cumulonimbus as an override: precipitation channel pushes coverage and type to the cumulonimbus
   profile at 70% coverage (HZD 42), and raises absorption (HZD 68).
8. **[cheap]** Stratocumulus/altocumulus bands: use the NE 65 texture-selected type for the 2.5D layer, with a
   directional stretch (streaky) as shear.

### 9-D Shape detail
9. **[cheap]** Detail type driven by height *relative to type*: switch height `type +- 0.1` (NE 99) instead of a
   fixed wispy-bottom rule. Rising clouds get a higher switch height (billowy deeper), decaying clouds lower.
10. **[cheap]** Invert the detail Worley near the base for wisps (HZD 37 note). Our `billowAmp`, `profileNoise` may already approximate this.
11. **[cheap]** Do not add Perlin-Worley or the 32^3 detail texture: N3's noise is already better (N3 s89).

### 9-E High layer (cirrus/altostratus)
12. **[cheap]** Copy the NE 65 density formula (section 1.2) as the cirrus layer's density. Three tiling noises
    (streaky, wispy, round) with their own wind per texture (HZD 87). Coverage as exponent: `pow(d, 1 - remap(cov, 0, 1, -0.9, 0.9))`.
13. **[cheap]** Altitudes: cirrus 4000 to 8000 m, altocumulus/altostratus 1500 to 4000 m (NE 15). Our layers can sit there.
14. **[medium]** Sky-layer light: 2D sub-layer, few sun samples (NE 67), ms from `coverage*type` and height (NE 54).

### Phase 10 (shadows)
15. **[cheap, design note]** The decks do not describe a ground-shadow technique for sky clouds. NE 112
    (`direct = transmittance * long_distance_shadow_sample`) shows the lighting side of the same idea: the cloud's
    own light march ends with a lookup of a precomputed 2D map. We can use our 10-A shadow map **as that lookup**
    for the voxel clouds' far sun path too, which would reduce the light-grid cost.
16. **[cheap]** HZD's far light sample "to capture shadows cast by distant clouds" (slide 83) is the in-cloud
    equivalent; our light grid already covers it.
17. **[medium]** For T1, rain clouds darker via absorption (HZD 68) give a visible shadow cue, and our shadow map shows only transmittance.

### T-targets
- **T1 (fair-weather cumulus + cirrus):** items 1, 2, 4, 12. HZD slides 37 to 40 and NE 23 to 36 are the closest
  in-engine references for the look.
- **T2 (dusk congestus sea):** NE 77 to 80 sunset skies (the warm underlit stratocumulus) for colour; the
  silver-lining HG (HZD 55, 56).
- **T3 (orographic valley sea):** NE 96 to 131 envelope model and NE 109, 114 caps on peaks. Envelope profile and type switch height, items 9.
- **T4 (layered sunset bands):** items 8, 12, 13; NE 66, 68 (cirrus and altocumulus at sunset).
- **T5 (cumulonimbus):** NE 159 to 172: anvil as a separate high plate from a map centred on the storm,
  the 12th-power glow, absorption by distance to the centre; lightning NE 173 to 182. HZD 42 rain override.
- **T6 (tall-neck hero):** nothing new; N3 covers it.
- **T7 (time of day):** HZD 88, 89: all colours derived at runtime from sun and sky, no baking. Matches our approach.

### Not worth doing
- HZD's spherical atmosphere shell (slides 71 to 74) except at the far horizon.
- 1/16 reprojection for voxel clouds; keep it only for the 2.5D layer if cost requires.
- HZD powder for the voxel path (N3 replaces it).

## 7. Slide images kept as scene references (local, gitignored)

All under `work/captures/scratch/hzd/`. `hi/` = 130 dpi full notes pages (slide in the upper part), `evs/` = contact sheets.

| File | Content | Used for |
| --- | --- | --- |
| `hi/h-36.png` (HZD s34) | Stratus / cumulus / cumulonimbus height gradients, coverage ramp | 9-C profiles |
| `hi/h-37.png` to `h-40.png` (s35 to 38) | density build steps, in-game cumulus fields | T1 |
| `hi/h-42.png` to `h-44.png` (s40 to 42) | weather map R/G/B, coverage/type/precip ranges | 9-B |
| `hi/h-47.png` (s45) | 15 to 35 km horizon ring diagram | 9-B |
| `hi/h-49.png` (s47) | painted weather map overrides | 9-B |
| `sheets/s57.png`, `s65.png` | Beer, powder, HG slides (s55 to 69) | lighting |
| `sheets/s73.png`, `s89.png` | spherical shell, march steps, 2D cirrus textures, reprojection | 9-E, perf |
| `evs/a.png` (NE 15 to 30) | altitude chart, top/bottom type tables, cumulus/stratocumulus/stratus renders | 9-C |
| `evs/c.png` (NE 62 to 81) | 2.5D thin cloud model, cirrus, influence NDFs, regional map, sunset skies | 9-B, 9-E, T4 |
| `evs/d.png` (NE 94 to 113) | envelope model, valley caps, long-distance shadow code | T3, 10 |
| `evs/e.png`, `f.png`, `g.png` | envelope ray march, superstorm anvil and lighting, PS4/PS5 table | T5 |

## 8. Top findings

1. **Species come from vertical profile tables, not noise.** HZD uses 3 height gradients blended by a type channel;
   NE generalises to top-type x bottom-type tables with per-cloud min/max height. This is the 9-C mechanism.
2. **No ground shadows for sky-layer clouds in any deck.** Only NE 112 shows a `SampleLongDistanceShadowMap` in
   the envelope model's lighting. Our 10-A goes beyond the sources.
3. **The cirrus recipe is in NE 65**: type chooses streaky/wispy/round noise, coverage is an exponent. Copy it for 9-E.
4. **Regional variety is data**: NE 75 to 78 blends procedural NDFs with regional influence maps per weather state. Our 9-B cluster scale should be made explicit this way. HZD's own addition is the horizon rule (s45).
5. **Cheap tricks**: noise slice offset for thin clouds (NE 102), billowy/wispy switch height from type (NE 99),
   cumulonimbus as a precipitation override at 70% coverage (HZD 42).
6. **Our noise stack is already better than HZD's**; HZD's Perlin-Worley, 32^3 detail and 2D curl need not be added.
7. **The HZD PDF has no formulas**; exact gradient constants and the anvil/probability tricks are not in either deck.
