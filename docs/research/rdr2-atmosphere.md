# RDR2 atmosphere: what it gives us (Bauer, SIGGRAPH 2019)

Source: `artifacts/research/slides_public_release.pptx`, "Creating the Atmospheric World of Red Dead Redemption 2" (Fabian Bauer, Rockstar; Advances in Real-Time Rendering 2019). 78 slides, of which about 50 carry content. Local only; no slide images are committed. Slide numbers are the deck's own (S#). Contact sheet reviewed at `work/captures/scratch/rdr2/sheet.jpg` (gitignored).

## Read this first: what the talk is and is not

- It is a **unified volumetrics system** (clouds, fog, rain fog, god rays, sky scattering) running at 30 fps on PS4. Clouds are one material among many (S9: "Unified volumetric rendering system").
- It is **not** an art-direction talk about cloud shape. The cloud representation is a coarse 2.5D map, so it gives us little for species and scenes (9-C, T1-T7).
- It has **no sunset colour recipe**. There are no sunset sRGB ranges, no tinted ambient and no mauve-body trick. The sunset frames (S65) show the result of the pipeline below. The value for C1 is in the light-transport shortcuts, not in colours.
- Its strongest content is for **C2 (horizon haze), 10 (cloud shadows and god rays), and performance** (S57, S51-S56).
- The HZD/Nubis material is not repeated here. The talk cites Schneider15 for the march refinement and detail erosion.

## 1. Clouds

### Representation (S14-S18)

- **2.5D, not a volume.** A top-down cloud map covers the world: "Cloud dome covers world map (32x32 km2)" (S14).
- The map is **512x512 R16G16**, so two channels hold two cloud layers. It is built each frame by modulating mask and noise textures with weather and time-of-day parameters.
- **Altitude shape comes from a height LUT.** "LUT defines altitude-based shape" (S16). It is a 1x128 RGBA8 strip copied from an atlas, with the slice chosen by weather.
- Weather transitions blend the LUT slices (S16 notes). Types named: "(Alto)Cumulus and stratus". Only the two broad families are mentioned.
- **How density is formed (S18):**
  - A Hermite smoothstep of the map value between two LUT-driven bounds gives the base shape.
  - Noise is then carved with a linstep, `rescale(noise, CloudLut.z, density)`. The LUT's z channel sets how soft the noise is.
- **Detail (S17):** two 2D displacement samples at the xy and xz positions give a quasi-3D vector. That vector, plus wind, offsets a single 3D Perlin/Worley lookup. S18 compares "No noise", "1x3D noise" and "+2x2D displacement".
- There is no per-cloud authoring, no simulation volumes and no species list. Variety comes from the 2D map, the weather-selected LUT and the noise.

### Variation between cloud types

- Only through the **LUT slice per weather**, plus the map. This is a data-driven version of our species profiles, with one height gradient per weather state. Our 9-C tables already go further.
- Idea to take: LUT channel z (noise softness per height) is a neat way to get crisp rising tops and wispy bases. It maps onto 9-D (rising crisp, decaying wispy).

### High cirrus (S64-S65)

- "Cirrus cloud layer 8 km altitude. Single 2D texture lookup for density, but still implements the same lighting model." (S64)
- It is a flat layer composited in the deferred pass, after volumes, raymarch and sky scattering. S65 steps through the order: cirrus, then raymarch, then volume, then sky scattering and transmittance.
- The cirrus is lit by the **same shading model** as the clouds (phase octaves, ambient). It is not a painted sky texture, so it takes the sunset colour and forward scattering for free.
- The S65 frames show fibrous streaks fanning from the sun. They are well matched to our cirrus photo sheet. The sun side is brightened by phase, which is the cue that makes it read as lit.

### Near and below the horizon (S50-S51)

- The ray length is clamped by "screen depth, ground plane and cloud dome" (S50). The cloud dome is an analytical intersection, so a ray toward the horizon exits the shell and stops. There is no special horizon code.
- Step refinement is Schneider15's: halve the step on hitting the base shape, with a fixed `i_max = 3`. Warning: "Can potentially jump over thin cloud" (S50).
- The march starts "where voxels end" (S51), with the ray origin offset by blue noise.
- **Near clouds below the camera (mountain flights):** the froxel volume (<160 m) handles them. Beyond that the march continues. Both use the same lighting.
- There is no flat-earth versus planet curvature discussion in the deck.

## 2. Sky and atmosphere coupling (our horizon is worse than Takram's)

### Aerial perspective on clouds (S61-S63, S65)

- **Sky scattering is applied once, not per sample.** "Applied once at weighted depth" (S62). After the march, they sample the sky scattering and transmittance at the transmittance-weighted depth and apply that to the whole ray result. It is "not physically correct but gives plausible results for very little added cost".
- The scattering is a Bruneton07 precomputed model with Hillaire16 improvements and an ozone term (S61).
- It is cached in a **32x16x32 frustum volume**, and "LUT for forward and deferred lighting" reads it. One 3D lookup at the weighted depth gives in-scatter and transmittance.
- **Applied after all opaque and volume work** (S64). That makes the aerial perspective a final composite that treats clouds, fog and terrain with one function of distance.
- **Earth shadow is supported** (S61, "+ earth shadow"). It is important for plausible dusk: the lower atmosphere goes dark while upper clouds stay lit.

### Horizon haze and fog

- Fog and clouds share one data model and one lighting model. Global height fog, the 8x8 km fog map (start height, falloff, density; S20-S21) and artist volumes all feed the same froxel and raymarch result. Low fog therefore takes the same sunset colour as the clouds.
- Fog Map: "morning mist over water bodies dissipates over time" (S20 notes).
- **Why their horizon holds together:** distance falloff is not a separate gradient bolted to the sky. Weighted-depth sky scattering is applied to the combined cloud, fog and terrain result. The S65 sunset frames show no band at the horizon, and the haze is brightest toward the sun.
- For C2, copy the structure, not the numbers: **one scattering and transmittance lookup by transmittance-weighted cloud distance, multiplied into the cloud colour and added as in-scatter**. Apply it to clouds and terrain with the same function.

### Rain fog (S19)

- "Rain fog below rain clouds. Derived from cloud map. Height based falloff." It is a cheap skirt under dark clouds. It is a candidate for T5 (storm), where we want a rain shaft.

## 3. Sunset and low-sun lighting of clouds

What the talk actually specifies:

- **Multiple scattering by octaves.** "Two direct light octaves to approximate multi scattering [Wrenninge13]" (S28). The phase is a sum of HG lobes with the anisotropy g reduced each iteration. "We settled for 2 iterations" (S29).
- **Artist and extinction weights** blend the octaves (S29). Example g values (S31): cloud 0.8, smoke 0.1, fog 0.9.
- **Back scattering is faked.** `max(phase, v)`, where v = 1/PI * rescale(BACK_SCATTER_MIN, BACK_SCATTER_MAX, extinction), a clamp to the Lambertian BRDF (S30). "Not physically based. Based on perceptual tuning." Dense cloud therefore never goes below a floor term in the sun's anti-direction, which stops dark undersides going black while the sun is low and behind.
- **Ambient (S36).** For the march, the ambient is "average sky ambient without clouds". Sky scattering is rendered into a low-res paraboloid and parallel-reduced, with samples weighted toward the sun or moon. This ambient is **tinted by the sky, so it changes with time of day**.
- **Ambient visibility reuses the sun secondary ray** (S36): one extinction lookup toward the sun serves both direct and ambient, so a cloud body's ambient is darkened where it is self-shadowed.
- **Cloud indirect to the ground (S66-S67):** sky irradiance probes (SH3) include cloud in-scatter. "Blue sky area lighting on clear weather, and indirect light from cloud bodies on overcast" (S66 notes).
- **Wavelength-independent transmittance** (S28), and the "Future Outlook" lists "Wavelength dependent transmittance" (S74). They did not have coloured extinction, so the sunset reds on clouds come from the sky scattering, not from colour-dependent attenuation in the cloud.

What it means for us (our clouds are "uniformly warm cream"):

- The **colour variation in RDR2 comes from three places**: sun colour after atmosphere, a *sky-derived ambient* (blue/violet at dusk) and the *aerial perspective composite*. In the S65 frames the cloud bodies are cool and grey-blue with warm edges. That matches the photos' mauve bodies with warm fringes.
- This points at our ambient term. If ours is a constant or sun-tinted cream, it is the culprit. The fix is an ambient from sky scattering (reduced from a low-res sky map, weighted toward the sun), which at sunset is blue/mauve, so bodies come out mauve, while the direct octave stays warm.

## 4. Cloud shadows, fog shadows, god rays

### Cloud shadow map (S35)

- **Format:** an exponential shadow map (Annen08), stored as 768x768 R16F with 6 mips.
- **Contents:** the "transmittance weighted depth", with the loop `depth = lerp(depth, t, pow(transmittance, 4))` while marching from the sun. It is "blurred + mip chain to reduce aliasing/crawling".
- **Cost trick:** update "1 ray in a 4x4 tile" per frame (S57 notes) and time-slice terrain and cloud shadows. Shadows change slowly, so this is cheap.
- It is consumed by (a) the shadow volume for fog (S43), (b) the main-viewport march, and (c) opaque surfaces via the directional-light path (S69: "not tracing any additional rays").
- **Compared with ours:** we have a cascaded sun-space shadow map. RDR2's is one map over the cloud dome with soft ESM filtering and mips.
- Worth borrowing: the mip chain and blur against crawling, the 1-in-16 temporal update, and sampling the same map in fog and in cloud self-shadowing so terrain and haze agree.

### High-frequency self shadow on clouds (S33)

- Cloud material alone takes one extra "single transmittance lookup towards sun/moon", with a distance "controlled by weather parameters to allow tuning for large, small or flat cloud shapes". That is one secondary ray, with the length set per weather state.

### Terrain shadow map (S34)

- 128x128 RG16F, raymarched over the heightmap. The R channel is the intersection height and G is the ray length, and the ray length widens the comparison threshold for soft shadows. A cheap soft-shadow trick.

### God rays (S62-S63)

- **Visibility is separated from the sky scattering integral.** Each march step's directional visibility is accumulated, "weighted by the area covered by the sample and the transmittance along the ray" (S62).
- After the ray ends, it is normalised over the ray length and **modulates the sky scattering term**. It is "not physically correct but gives plausible results for very little added cost".
- S63 shows the "Shadow Area" image beside the final. The shafts come out of the cloud gaps and are visible over the terrain.
- This costs nothing extra, since the visibility lookups are already done in the march for lighting. It is a strong candidate for 10 and T5.

## 5. Performance (S57, PS4, 30 fps)

Measured per pass (S57):

| Pass | ms |
| --- | --- |
| Cloud/Fog map | 0.04 |
| Cloud ESM | 0.156 |
| Shadow volume | 0.204 |
| Material volume | 0.33 |
| Scattering volume | 0.34 |
| Raymarch | 1.31 |
| Raymarch reconstruction | 0.232 |

The probe passes add 0.22 ms (S68) for sky irradiance, 0.15 ms (S70) for reflection probes and 0.19 ms (S72) for water reflections. The raymarch is the dominant cost, and the talk says it is "the most expensive component".

How they amortize:

- **Half resolution + 1 ray in 4 (S51-S52).** Cast one ray per 2x2 half-res tile, which is 1/16 of full-res pixels per frame. The skipped pixels are reprojected from history.
- **History validation (S52):** colour AABB clamp from the 3x3 neighbourhood, dropping neighbours with a large depth distance. With no history, use the nearest ray's result.
- **Ray placement matters (S53-S55).** Uniform placement fails, since it flickers when no ray covers a tile's depth range. They use checkerboard offset plus a neighbourhood depth min/max analysis, and place the ray on the under-represented depth. Min/max checkerboard depth downsample.
- **Upscale (S56):** a dithered four-tap upscale with blue noise, picking the closest depth at discontinuities. "Kernel width based on weighted ray depth" so far clouds stay sharp, then TAA.
- **Temporal filtering of density/material but not of scattered light** (S46-S48): temporal blending on the scattered volume causes "light ghosting" and trailing. They use dithered lookups and TAA.
- **Compute, async overlap (S57).** They overlap the march and froxel dispatches.
- **Artists are responsible too (S57):** performance depends on cloud cover and long rays. The worst case is "long rays".
- **Probe cost control (S68):** classify probes by main-view visibility. 32 rays if visible, 16 otherwise.
- **Features cut from the march (S49):** fog volumes, irradiance probes and local lights. The march keeps only clouds, sun and sky ambient.

Our budget problem (4.5-5.3 ms at 1440p vs 3.5 ms) comes from per-pixel marching. Their 1-in-16 rays per frame, plus cheaper reconstruction, is the main structural difference, and only works with a decent reprojection validity test.

## 6. Actionable list mapped to our tasks

Size: cheap (hours), medium (a day or two), large (several days or structural).

| Task | Item | Source | Size |
| --- | --- | --- | --- |
| **C1 sunset** | Take the cloud ambient from reduced sky scattering weighted toward the sun, not a constant or sun-tinted value, so bodies go mauve/blue at dusk | S36, S65 | medium |
| C1 | Two direct-light octaves (second octave: lower g, lower weight) for multi scatter. We likely have this; verify the second octave is *not* sun-coloured at the same strength | S28-S29 | cheap |
| C1 | Back-scatter floor `max(phase, 1/PI * rescale(ext))` so low-sun undersides never go grey or cyan; tune by photo | S30 | cheap |
| C1 | Earth shadow term on the sun, so the lower atmosphere darkens before high clouds | S61 | medium |
| C1 | Photo-sampled colour ranges are still needed. The talk gives none | none | n/a |
| **C2 haze/horizon** | Apply sky scattering and transmittance once, at transmittance-weighted cloud depth, to the combined cloud result. It replaces any per-sample or separate horizon gradient | S62 | medium |
| C2 | Use the same aerial function on clouds, terrain and fog, so there is no band where they meet | S61, S64 | medium |
| C2 | Cache scattering as a small frustum 3D LUT (32x16x32), time-sliced | S61 | medium |
| C2 | Clip the ray analytically at the cloud shell, ground plane and depth. No special horizon branch | S50 | cheap |
| C2 | Height-fog and fog-map as a low layer sharing the cloud lighting, so sunset fog is the same colour as the clouds | S20-S21, S45 | large |
| **9-E cirrus** | Cirrus as one 2D texture lookup at about 8 km, lit by the full cloud shading model (phase, ambient). Composite after everything else | S64-S65 | cheap to medium (we already plan the NE p.65 recipe; this is the same thing) |
| 9-E | Check the S65 look: streaks fan from the sun; phase brightens the sun side | S65 | cheap |
| **9-C species** | A height LUT per weather/species with a z channel for noise softness (crisp rising, wispy decaying), as a complement to Nubis tables | S16, S18 | medium (also feeds 9-D) |
| 9-C | 2D displacement of the noise lookup (two 2D samples give a quasi-3D warp) as a cheap alternative to curl noise | S17 | cheap |
| **10 shadows** | Mip chain and blur on the cloud shadow map against crawling | S35 | cheap |
| 10 | Update 1 texel in each 4x4 tile per frame, as the shadow changes slowly | S57 | cheap |
| 10 | Store transmittance-weighted depth (ESM) instead of a binary or hard depth, so shadows are soft and fog can read the same map | S35 | medium |
| 10 | God rays: accumulate directional visibility during the march, then normalise and modulate the sky scattering term. No extra rays | S62-S63 | medium |
| 10 | Per-weather length for the sun secondary ray | S33 | cheap |
| 10 | Terrain shadow ray-length soft threshold | S34 | cheap |
| **Cost (9-C3)** | Cast 1 ray per 2x2 half-res tile, reproject the rest with AABB clamp and depth-rejecting neighbours | S51-S52 | large (structural; check what our upscaler already does) |
| Cost | Ray placement by neighbourhood depth min/max, not uniform | S53-S55 | medium |
| Cost | Kernel width of the temporal blur from weighted ray depth, so far clouds stay sharp | S56 | cheap |
| Cost | Do not temporally blend the scattered light (ghosting), and dither the lookups and use TAA | S48 | cheap |
| **T1** (cumulus under veil) | Cirrus as above, plus shared lighting | S64 | cheap once 9-E exists |
| **T4** (sunset bands) | C1 ambient and earth shadow. Check S65 frames as the reference for how stratified bands go dark | S65 | medium |
| **T3** (valley sea) | Fog map (start height, falloff, density) for mist in valleys, dissipating with time of day | S20-S21 | medium |
| **T5** (storm) | Rain fog skirt under dark cloud, with height falloff; god rays through gaps | S19, S62 | medium |
| **T7** (time of day) | Weather and time of day drive the map, the LUT slice and the fog map. Keep all parameters as data | S14, S20 | medium |
| T2, T6 | Nothing specific. The 2.5D map does not give pileus or congestus | none | n/a |

## Priorities

1. **C2:** adopt weighted-depth sky scattering, with one aerial function for clouds and terrain. This is the item most likely to fix the horizon.
2. **C1:** change the cloud ambient to a sky-derived average, add the back-scatter floor and check the second octave. That is the likeliest fix for the cream colour.
3. **9-E:** cirrus with the same lighting.
4. **10:** god rays from existing visibility lookups, and the mip chain and update scheme on the shadow map.
5. Cost: the 1-in-4 ray scheme and ray placement analysis, only after the quality work.

## Caveats

- Their clouds are low-detail by our standards (2.5D map, one 3D noise texture), so don't use the talk as a quality bar for shape. The S65 frames are a useful bar for **lighting and atmosphere** only.
- Numbers in S57 are PS4 at 30 fps and not comparable with our desktop GPU numbers.
- The slides carry no colour values. Any sunset colour target still has to come from the owner's photos.
