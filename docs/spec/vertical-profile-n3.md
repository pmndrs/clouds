# Vertical-profile (2.5D) cloud model, as recapped in Nubis Cubed slides 1 to 46

Spec for the rebuilt procedural sky shaper. Written 2026-11-21 from the local notes only. Where a number is not in the local sources, this file says so.

Source tags: **n3 sNN** = Nubis Cubed (SIGGRAPH 2023) slide NN, pptx order. **ne22 pNN** = Nubis Evolved (SIGGRAPH 2022) page NN. **gp7**, **hzd15**, **n17**, **nut**, **hfw**, **hag** = older talks and chapters, used only where marked "older generation". **notes** = what the local research notes inferred (`docs/research/sources/n3.md`, `n3/slides-001-046.md`, `ne22.md`). **code** = what our repo does. Local code listings are quoted from `artifacts/research/extracted/n3/code/` and `.../ne22/code/` (not in git; main checkout only).

Three kinds of statement are kept apart throughout: PUBLISHED (a slide or page says it), INFERRED (notes or this file derive it, with the method), CODE (ours, not Guerrilla's).

## 1. Scope

This is the **Vertical Profile Method** of n3 s14 to s46: the 2.5D sky model that shipped in Horizon Zero Dawn and Forbidden West, recapped in n3 s9 to s46 from ne22 p19 to p61. It renders the tropospheric sky at large: a flat slab of cloud above the player, built per ray sample from five 2D fields, one height profile, one 3D noise composite and one subtraction. n3 adds no new maths for this model (notes). What n3 adds over ne22: the two profile tables at full resolution (s18), eroded and un-eroded posters (s17/s21/s24), one consolidated lighting equation (s26 to s28), and timings (s37, s44).

Out of scope: the voxel system (n3 s47 to s194: NVDF, SDF, Curly-Alligator and Alligator noise, 256x256x32 light grid); the Envelope Method (s19, s20, s38 to s42, s45; orographic, terrain-hugging); superstorms and lightning volumes (s32 to s34, ne22 p133 to p185); the 2.5D thin-cloud / cirrus model (ne22 p62 to p68); authoring tools, Influence NDFs and weather states (ne22 p69 to p80). Where a quantity the vertical-profile model needs is published only inside an out-of-scope part, this file says so.

## 2. Data fields (the NDFs)

PUBLISHED. The model reads five 2D fields, called Nubis Data Fields (NDFs), mapped over the world. n3 s15 to s16: "NDFs = 2D textures the compute shader uses to decompress 3D clouds", mapped over **16 km x 16 km** (s16; ne22 p17 to p18, N/W/E/S diagram). n3 s18 lists the five.

| Field | Range | Meaning | Source |
| --- | --- | --- | --- |
| cloud min height | not published (0..1 assumed) | Lower bound of the column's vertical range. | n3 s18 notes: "min and max height defined the vertical range"; ne22 p20 marks the layer 256 m to 2048 m on the height axis |
| cloud max height | not published | Upper bound of the column's vertical range. | n3 s18; ne22 p20 |
| cloud coverage | not published (0..1 assumed) | Scales the vertical profile "to control where clouds formed". | n3 s18 notes, s18 code |
| cloud bottom type | 0..1 (indexes the table; both axes drawn 0..1) | Row selector of the bottom table. 0 = crisp flat base, 1 = long soft underside (INFERRED from the s18 table data; notes n3.md section 7a, resolving ne22.md:31). | n3 s18 images |
| cloud top type | 0..1 | Column selector of the top table. 0 = stratus, then stratocumulus, then cumulus (ne22 p21). | n3 s18, ne22 p21 |

World extent: 16 km x 16 km (n3 s16). Texel resolution: **not found in the local sources**. Storage format and value encoding: **not found**. Map tiling beyond 16 km: **not found**. (hag uses 512^2 hand-painted maps; gp7 p103 a 60 km map; different generations, no bearing here.)

Per-sample cost (PUBLISHED, ne22 p91 code): 1 texture read for coverage, 2 for the profile tables, 1 multiply. An empty sample exits early: `if (dimensional_profile < density_threshold) return 0.0;` The threshold value is not published.

```hlsl
// ne22 p91 (older page, same model)
float cloud_coverage = GetCloudCoverageSample(sample_position); (1 Texture Read)
float vertical_profile = GetVerticalProfile(sample_position); (2 Texture Reads)
float dimensional_profile = vertical_profile * cloud_coverage; (1 Multiply)
if ( dimensional_profile < density_threshold)
        return 0.0;
```

Animation of the fields: PUBLISHED that the NDF is **not advected**; only the noise scrolls (ne22 p37; n3 s25 "Pseudomotion"; n3 s46 table: evolution "Yes" for the vertical-profile method, achieved by the authored fields changing, not by this model).

The generator that produces the fields is NOT PUBLISHED. See section 8.

## 3. Vertical profile

### 3.1 Construction (PUBLISHED, n3 s18, ne22 p20 to p29)

Per column: `vertical_profile = top_table(top_type, h) * bottom_table(bottom_type, h)`, then `dimensional_profile = vertical_profile * cloud_coverage`.

The multiplication of the two lookups is stated in the speaker notes only (n3 s18, ne22 p28 shows the two images multiplied). The coverage line is on the slide, quoted exactly:

```hlsl
// n3 s18 (pdf p.19); n3-s018.hlsl
float dimensional_profile = vertical_profile * cloud_coverage;
```

Assembled reading (the `[notes]` lines are restated notes, not Guerrilla code; `/*?*/` marks a gap), from `n3-sampler-hzd.hlsl`:

```hlsl
float height_fraction_vp = /*?*/ remap(height, cloud_min_height, cloud_max_height, 0.0, 1.0);  // [notes]
float vertical_profile = TopTypeLUT(cloud_top_type, height_fraction_vp)                          // [notes]
                       * BottomTypeLUT(cloud_bottom_type, height_fraction_vp);
float dimensional_profile = vertical_profile * cloud_coverage;                                   // [slide s18]
```

The height-fraction `remap` is INFERRED, not shown. The `dimensional_profile` is the 0..1 base density envelope: 0 outside the cloud, 1 inside, the gradient between is where noise erodes (s17, s21, s24).

### 3.2 The tables (PUBLISHED as images, s18; data INFERRED by sampling)

Two lookup textures, **64 x 64**, height up, type across, shown on n3 s18 (`media/image32.png` top, `image33.png` bottom) flipped vertically on the slide. The notes sampled them numerically at cell centres into `n3-s018-lut-top-type.csv` and `...-bottom-type.csv` (row 0 = bottom of the column, column 0 = type 0). The top image is exact to 8 bits; the bottom image is a 15-colour palette PNG, so its values are good to about +-0.04 (notes). An `hdphoto3.wdp` original exists and was not decoded.

What the sampled data show (notes, n3.md and slides-001-046.md):

| Property | Value |
| --- | --- |
| Shared floor | Both tables have a floor at row 16 to 18 (h about 0.27). Below it top = 1 and bottom = 0, so the product is 0. The cloud occupies h 0.27..1 of the table. |
| Top type, h 0.29 | 0, .90, .97, .98, .98 at types 0, .25, .5, .75, 1 |
| Top type, h 0.38 | 0, .64, .89, .93, .94 |
| Top type, h 0.48 | 0, .37, .84, .85, .75 |
| Top type, h 0.57 | 0, 0, .65, .67, .76 |
| Top type, h 0.67 | 0, 0, .58, .76, .80 |
| Top type, h 0.76 | 0, 0, .63, .69, .62 |
| Top type, h 0.86 | 0, 0, .39, .51, .53 |
| Top type, h 0.95 | 0, 0, 0, .35, .40 |
| Top extent (last row above 0.05) | type 0 to 0.27 (one-row sheet), 0.13 to 0.41, 0.25 to 0.54, 0.38 to 0.63, 0.5 to 0.87, 0.63 to 0.91, 0.76 to 0.96, 0.89 and up to 0.98 |
| Top shape | Column top rises in steps with type. High types are not monotone: dip at h 0.5..0.6, second shoulder at 0.65..0.7 (tiered tops), taper to about 0.4 near the top. |
| Bottom type 0 | ramps 0.33, 0.67, 0.80 within 0.1 of the floor (crisp base), then 0.8..0.91 |
| Bottom type 1 | ramps 0.2 at floor+0.06, 0.4 at +0.16, 0.5 at +0.28, 0.8 at +0.54 (long soft underside) |
| Maximum | about 0.91 anywhere in the bottom table, so `vertical_profile` never reaches 1 |

Type axis labels are not printed on the slide; ne22 p21 to p25 give top type insets at about 0.07 (stratus), 0.27 (stratocumulus), 0.40 (cumulus) (as read by `generate/profile-tables.ts:25-27`, not re-checked here).

Bottom-type orientation: ne22.md:31 reads ne22 p27 as "bottom type 0: ragged underside". The n3 table data say the opposite (type 0 crisp). The lead resolved it as type 0 = crisp (n3.md section 7a). This spec follows the resolved reading and flags it as open question Q7.

### 3.3 Where our copy of the tables lives, and how it was made (CODE)

| Item | Where | How |
| --- | --- | --- |
| Raw 64x64 top and bottom tables | `packages/runtime/src/generate/profile-tables.ts:32-108` (`DATA`, base64) decoded by `profileTables()` at :112 | Bytes of the notes' CSVs (sampled from the s18 images, 8-bit, row 0 = bottom). |
| Smoothed copy used at render time | `profile-tables.ts:130` `profileTablesSmoothed()` | Triangular filter in height above the floor, radius 2 rows (bottom), 1 row (top), clamped at the floor. Ours: the 15-colour bottom image terraced flanks. |
| Floor constant | `profile-tables.ts:23` `PROFILE_TABLE_FLOOR = 17/64` | Read from the data. |
| Bilinear read | `profile-tables.ts:153` `sampleProfileTable`; GPU `shaper.wgsl.ts:142` `hzdLut` | Type: i/63; height: (i+0.5)/64. Ours. |
| Peak normalisation | `profile-tables.ts:189` `profilePeaks()`; `shaper.wgsl.ts:166` `hzdTableProfile` divides by the per-pair peak (min 0.05) | Ours. n3 does not normalise (the product peaks near 0.91). |
| Species-to-top-type map | `profile-tables.ts:29` `SPECIES_TOP_TYPES` | Ours, tuned. |

Not derived from a formula anywhere: no analytic form of either table is published.

### 3.4 Height mapping

PUBLISHED: min and max height set the vertical range (n3 s18 notes). NOT PUBLISHED: whether min height maps to table row 0 or to the floor (row 17), how the 0.27 floor relates to the column, the table interpolation filter. INFERRED and CODE: our code maps the column base to the table floor (`v = floor + h*(1 - floor)`, `shaper.wgsl.ts:166-170`, rationale `profile-tables.ts:14-19`). See Q1.

### 3.5 Bottom versus top type

PUBLISHED (images only): the two axes are independent and are combined only by multiplication. A column with top type 1 and bottom type 0 is a tall cumulus with a flat base; bottom type 1 gives a ragged or soft underside (INFERRED from table data plus the s24 erosion: a slow ramp lets only noise peaks survive low down; notes). The tables are not formulas; the type blend is done by bilinear interpolation of the 64-column images, not by a stated blending law.

## 4. Noise and erosion

### 4.1 Noise textures (PUBLISHED, n3 s22; recipe NOT PUBLISHED)

n3 s22 (HZD-era "Nubis noise"): **4 channels, 128 x 128 x 128 voxels, uncompressed, 2 bytes per texel, 4.194 MB**.

| Channel | Content (s22 labels) |
| --- | --- |
| R | Low-frequency "Perlin-Worley" |
| G | Low-frequency Worley |
| B | Medium-frequency Worley |
| A | High-frequency Worley |

s22 notes: Perlin-Worley "simulates a mix of wispy and billowy details"; Worley "simulates the billowy details". The channels are "combined in various ways per model to create ... noise composites for potential wispy and billowy details" (s22 notes). ne22 p32 labels the R channel "Perlin 1-Worley"; ne22 p33 shows the 4-channel "Noise Composite". The composite recipe, the channel frequencies, the tiling size in metres, and the Perlin-Worley recipe are **not found in the local sources** for n3 or ne22 (ne22.md: "Frequencies not stated").

Size contradiction: 128^3 x 2 B = 4.194 MB means 16 bits per texel for four channels (about 4 bits per channel). Our bake uses RGBA8 (8.4 MB), justified in `noise.ts` by notes n3.md section 7b. See Q8.

Gap fill, OLDER GENERATION (not Guerrilla's n3/ne22 text): the Nubis Noise Generator network (Schneider 2017, `docs/research/sources/noise.md`) read into `procedural/hzd/noise.wgsl.ts:4-30`: R = fit chain over 5-octave Perlin turbulence with four Worley remaps; G/B/A = fit(1 - (W(10g) + W(19g)/3 + W(25g)/6 + W(37g)/8 + W(5g)/3)/5, 0.75, 1) with g = 1, 1.7, 2.3. gp7 p106 gives the combination `fbm = .625 G + .25 B + .125 A`, `base = Remap(R, -(1 - fbm), 1, 0, 1)`; that is the 2015 base-shape recipe, not the n3 composite.

### 4.2 Composite by type and height

PUBLISHED (n3 s23, quoted exactly; the code comment is the slide's, and is flagged):

```hlsl
// n3 s23 (pdf p.24); n3-s023.hlsl
// Define Noise composite - blend to wispy as the density scale decreases.
float noise_composite = lerp(wispy_noise, billowy_noise, detail_type);
```

SLIDE TYPO FLAG: the comment says "density scale" but the weight is `detail_type`; the speaker notes say "Type data at the sample position". Trust the code (notes n3.md "Contradictions"). The gradient bar on s23 runs type 0 = wispy to 1 = billowy.

NOT PUBLISHED for the vertical-profile model: where `detail_type` comes from. The five NDFs (s18) include no detail-type channel. In the envelope model the type is a field (ne22 p99: `Remap(h, type+0.1, type-0.1)`, billowy above, wispy below; envelope-only). See Q2. Also not published: `wispy_noise` and `billowy_noise` formulas (s22 notes, "various ways per model").

### 4.3 Erosion and density (PUBLISHED, n3 s24 and ne22 p34)

n3 s24, as transcribed (the slide names the variable `noise`):

```hlsl
// n3 s24 (pdf p.25-26); n3-s024.hlsl
// Define Cloud Density
cloud_density = saturate(noise - (1.0 - dimensional_profile));
```

ne22 p34, as transcribed (the variable is `cloud_noise_composite`, and it is a declaration):

```hlsl
float cloud_density = saturate(cloud_noise_composite - (1.0 - dimensional_profile));
```

The two agree. The only difference is the variable name. s24 notes: "The erosion was modeled as the subtraction of the inverse of the dimensional profile from the noise composite."

Consequences (INFERRED, notes): polarity is **high noise = more cloud**; noise is added to the profile and the sum is thresholded at 1. At profile 1 density = noise (texture stays visible in the core). At profile 0, density is 0 for any noise <= 1. Coverage lowers the threshold and fattens the cloud; there is no separate coverage remap. This is the opposite polarity of the voxel-era `ValueErosion(profile, noise) = saturate((profile - noise)/(1 - noise))` (n3 s107, out of scope).

There is **no other constant, exponent or remap** in the n3 recap of this model. The pieces below appear only in the envelope model (ne22 p105) and are NOT part of this one:

```hlsl
// ne22 p105 (ENVELOPE model only, not the vertical-profile model)
height_fraction * pow(saturate(noise - (1 - profile)), 0.27)
```

How `cloud_density` becomes an extinction coefficient is not published (no scale, no unit). The noise range (whether the composite spans 0..1 or is shifted) is not published; section 4.4 gives what the images and notes imply.

### 4.4 What the recap shows about noise range

Not found in the local sources. The thumbnails (s22, image34 to image40) are 256 px png and 128 px jpg overlaid at the same positions; which set is the composite is unclear (notes). An implementer must choose the composite's mean and spread so that `noise - (1 - profile)` behaves: with profile 1 the whole composite is the density, so its mean sets the core density. See Q3.

## 5. Wind and animation

PUBLISHED, n3 s25 (quoted exactly; the slide uses an en dash for minus):

```hlsl
// n3 s25 (pdf p.27); ne22 p37 is identical
// Animate noise using a wind offset
float3 noise_sample_pos = sample_pos - wind_direction * scroll_offset;
```

- Applied to "both models" (s25 notes) and called "pseudomotion".
- Only the noise position moves. The NDFs are not advected (ne22 p37 listing; n3 s46: no real evolution without authored data changes).
- NOT PUBLISHED: the value or unit of `scroll_offset` (time x speed), `wind_direction` encoding, whether the noise scrolls at one speed or per channel, any vertical component, any wind variation by height.
- OLDER GENERATION (gp7 p109 to p110, `docs/research/sources/gp7.md`): wind direction (1,0,0), `cloud_speed = 10`, tops skewed by `p += height_fraction * wind_direction * 500` before the texture reads, plus an upward bias `(0, 0.1, 0)` on drift, each texture at its own speed (text says; the listing shows one). Not in n3. Use only if the owner asks for cloud-top lean.

## 6. Lighting equation as recapped in n3 s26 to s46

Reference only; the project fits its lighting to a path tracer. This section records what the consolidated equation is and which inputs the density model must supply.

### 6.1 Consolidated equation (PUBLISHED, n3 s26 to s28; no code on the slides)

```
Light Energy = Direct Scattering + Ambient Scattering + Secondary Scattering          (s26-27)
Direct Scattering = (Transmittance * Primary Scattering Phase) + (Multiple Scattering * Secondary Scattering Phase)   (s28)
```

Note: ne22 p42 prints only two terms, `Light Energy = Direct Scattering + Ambient Scattering` (and p43 the same Direct line). The third term, Secondary, is new in n3 s26 and applies to lightning (s32 to s34).

| Term | Definition (slide / notes) | Constants | Slide |
| --- | --- | --- | --- |
| Sun, direct | "sun" (s26-27) | none | s26 |
| Ambient | "sky and neighbouring clouds" (s26-27) | see 6.3 | s26 |
| Secondary | "sources such as lightning" (s26-27) | none | s26 |
| Transmittance | Beer-Lambert on optical depth gathered by a second, expensive light ray march toward the sun (s28 notes) | graph on s28 plots T = exp(-5 d) for d in 0..1 (notes: measured k 4.94 to 5.04; illustrative only). ne22 p46 plots T = e^-d. | s28 |
| Primary scattering phase | "several" Henyey-Greenstein lobes, for an art-directable, somewhat physical forward bias (s28 notes) | g values not published. Normalised HG form, ne22 p48 (below). | s28 |
| Multiple scattering | The dimensional profile as a probability field (deeper = more scattered photons), attenuated by a second Beer-Lambert curve (MS light is absorbed), attenuated over height (less light enters from below), then scaled by its own phase so it stays directional (s28 notes) | none on the slide. ne22 p54 formula below; its two powers are not given anywhere. | s28 |
| Secondary scattering phase | The phase applied to the MS term | not published | s28 |

```hlsl
// ne22 p48 (older page): normalised Henyey-Greenstein, rsqrt form
float HenyeyGreenstein(float inCosAngle, float inG)
{
    float num = 1.0 – inG * inG;
    float denom = 1.0 + inG * inG - 2.0 * inG * inCosAngle;
    float rsqrt_denom = rsqrt(denom);
    return num * rsqrt_denom * rsqrt_denom * rsqrt_denom * (1.0 / (4.0 * M_PI));
}
// ne22 p54 (older page): multiple-scattering volume
float ms_volume = Remap(dimensional_profile* step_size, 0.1, 1.0, 0.0, 1.0) * pow(cloud_coverage * cloud_type, 0.25);
ms_volume *= pow(attenuated_light, cMultipleScatteringDepthPower);
ms_volume *= pow(height_fraction, cMultipleScatteringHeightPower);
```

Slide typos in these listings: en dash for minus (`1.0 – inG * inG`); `cMultipleScatteringDepthPower` and `cMultipleScatteringHeightPower` are never given; `cloud_type` is used here although the five-NDF list has no type (see Q2). s29 shows the same field without and with the MS approximation (image44, image45; by appearance image45 is the darker, no-MS one; unverified).

### 6.2 Slide 28 versus slide 30, ordering note

s28 states direct light; s30 states ambient; s31 shows ambient only (image48 by appearance), direct only (image47) and both (image46) (notes, unverified labelling).

### 6.3 Ambient (PUBLISHED, n3 s30)

```hlsl
// n3 s30 (pdf p.34); ne22 p59 is identical. The slide uses an en dash for minus.
float ambient_scattering = pow(1.0 – dimensional_profile, 0.5);
```

Reasoning (s30 notes): sky light comes from above and around and penetrates only the surface; the profile already runs from outside (0) to inside (1), so its inverse is the probability that ambient light reaches the point and scatters to the eye. No height term on this slide (the envelope version, ne22 p113, has one).

### 6.4 Secondary (lightning), s32 to s33

A third march per sample would be needed; instead a modelled volume of light around the source gives the energy at each primary-march sample (diagram: red sphere with falloff). Details deferred to the voxel section (s130). Out of scope here.

### 6.5 What the density model must output for lighting

| Output | Definition | Used by |
| --- | --- | --- |
| `dimensional_profile` (coarse density) | `vertical_profile * cloud_coverage`, before noise erosion | MS probability field (s28), ambient (s30), ne22 p54 `ms_volume` |
| `cloud_density` | eroded density (4.3) | optical depth in the sun march and the view march, transmittance |
| `height_fraction` | `remap(height, min, max, 0, 1)` | MS height attenuation (s28 notes), ne22 p54 |
| `cloud_coverage` | NDF value | ne22 p54 |
| `cloud_type` | not defined for this model | ne22 p54 only; see Q2 |

Accumulation (ne22 p61, older page; the n3 recap does not repeat it). The listing uses the **updated** absorption in the energy line, and `float3 color = float4(...)` is a source typo:

```hlsl
light_absorption += sampled_density * (1.0 - light_absorption);
light_intensity += (light_energy * sampled_density * (1.0 - light_absorption));
float3 color = float4(direct_intensity * sun_color + amb_intensity * amb_color);
float alpha = light_absorption;
```

## 7. Ray-march parameters as published

| Quantity | Published value | Slide | Note |
| --- | --- | --- | --- |
| Procedure | For each pixel, march between the layer bottom and top; per step: sample density, sample light energy (a second march toward the sun), integrate, choose the next step; stop at full opacity | s12, s13, s50 | Generic. "Stop at full opacity" is from the s12 to s13 notes. |
| Step size | `step_size = near_step_size + ((far_step_size_offset * distance_from_camera) / step_adjustment_distance)` with `near_step_size = 3.0`, `far_step_size_offset = 60.0`, `step_adjustment_distance = 16384.0` | s36 (ne22 p39 identical) | Metres. 3 m at the camera, 63 m at 16.4 km (+3.66 m per km). Vertical-profile method only. |
| Step purpose | "fewer samples farther from camera where less precision was needed" | s36 notes | |
| Cone step mapping, distance step mapping | Envelope method only | s38, s39 | Out of scope. 4.2 ms to 1.3 ms is the envelope scene (s41, s42). |
| Temporal amortisation | Amortised over **16 frames**: a 20 ms render becomes 2 ms; good for distant clouds, fails near the camera under fast motion | s43, s44 | The pattern (4x4 block, one pixel per frame) is from hzd15 s92 to s93 (older generation); the s44 diagram shows a 4x4 dot grid (notes). |
| Cost | 0.5 ms (partial sky) to 2.2 ms (full sky) | s37 | Platform not stated on the slide. Overall 2.5D system 0.2 to 5 ms (far view vs flying through) on s11. |
| Near/far split at 200 m, 480x270 and 960x540 | Envelope clouds only | s45 | Out of scope. |
| Light sample count, light march length, cone | Not found in the local sources for n3 or ne22 vertical-profile | | ne22 p41 shows a "256m" marker (meaning not stated). Older generation: hzd15 s83 six light samples in a cone, last sample placed far away; hzd15 s81, s90 "64 initial potential samples, 128 at the horizon". |
| Early-out threshold | `density_threshold` | ne22 p91 | Value not published. |
| Layer extent | 256 m to 2048 m | ne22 p20 | Axis labels on a diagram, not text. |

Comparison table (n3 s46, PUBLISHED): vertical profile versus envelope. Evolution: yes / pseudomotion only. Time of day: yes / yes. Lightning: yes / no. High frame rates: yes / yes. Flight-capable: **no** / yes. Freeform modelling: no / no. Neither method is "visually intuitive to author" (s46 notes). The vertical-profile method cannot be flown through.

## 8. Published / Not published

P = published (slide). I = inferable (how). N = not published (what ours uses). Code refs are in `packages/runtime/src/`.

| Quantity | Status | Detail |
| --- | --- | --- |
| Five field names | P | n3 s18 |
| NDF world extent | P | 16 km x 16 km, n3 s16 |
| NDF texel resolution | N | Ours: 1024^2 over 32 km, 31.25 m texel (`procedural/settings.ts:612-615`) |
| NDF storage format, value ranges | N | Ours: two rgba8unorm layers (`procedural/hzd/ndf.ts:7`) |
| NDF map tiling | N | Ours: repeats; storm channel windowed (`hzd/ndf.wgsl.ts:26`) |
| **NDF generator** (how the five fields are made) | N | The slides show only generator output and editor screenshots (ne22 p70 to p80: green/black mottle, clusters, regional sets, weather states). No noise recipe, no remap, no thresholds in n3 or ne22. Ours: `hzd/ndf.wgsl.ts:70` `generate`, recipes 'n17' / 'h6' (settings `recipe`, `HZD_NDF_DEFAULTS` at `settings.ts:612`), derived from n17 p53 to p58, not from n3/ne22. |
| Layer altitude range | I | ne22 p20 axis shows 256 m and 2048 m. Ours: 1500 m to 5000 m (`settings.ts:730`) |
| Height fraction formula | I | `remap(height, min, max, 0, 1)` ([notes] line, n3-sampler-hzd.hlsl) |
| `vertical_profile = top * bottom` | P | n3 s18 notes, ne22 p28 |
| `dimensional_profile = vertical_profile * coverage` | P | n3 s18 code |
| Table size and orientation | P | 64 x 64, height up, type across (s18) |
| Table values | I | Sampled from the s18 images (bottom image +-0.04). Ours: `generate/profile-tables.ts:32-108` |
| Table floor mapping, interpolation | N | Ours: column base to floor, bilinear, smoothed (`profile-tables.ts:23, 130, 153`; `shaper.wgsl.ts:166`) |
| Table peak normalisation | N | Not in n3. Ours divides by peak (`shaper.wgsl.ts:166`) |
| Noise: channel contents, size, bytes | P | s22 (4 ch, 128^3, 2 B/texel) |
| Noise: Perlin-Worley recipe, channel frequencies | N | Ours: noise tool network (`hzd/noise.wgsl.ts:4-30, 125`) |
| Noise tile size in metres | N | Ours: 6000 m shape, 300 m detail (`settings.ts:731`), 600 m for the voxel-era noise (`n3Tile`, `settings.ts:689`) |
| wispy_noise, billowy_noise formulas | N | s22 notes "various ways per model". Ours: the voxel recipe (`shaper.wgsl.ts:264-282`) |
| `detail_type` source in this model | N | See Q2. Ours: `hzdN3Type` (`shaper.wgsl.ts:285`) |
| Composite blend | P | `lerp(wispy_noise, billowy_noise, detail_type)`, s23 |
| Erosion / density law | P | `saturate(noise - (1.0 - dimensional_profile))`, s24 |
| Density to extinction scale | N | Ours: `extinction` 0.8 per metre (`settings.ts:730`) |
| Wind scroll formula | P | s25 |
| scroll_offset value, wind speed | N | Ours: `P.drift` and speed settings (`shaper.wgsl.ts:557-561`) |
| Ambient | P | `pow(1 - dimensional_profile, 0.5)`, s30 |
| Direct scattering structure | P | s28 equation |
| Beer constant | I | s28 graph plots exp(-5d) (notes: measured); ne22 p46 plots e^-d |
| HG g values, number of lobes | N | "several" (s28 notes). gp7 uses one lobe, g = 0.2 (older) |
| MS constants | N | ne22 p54 formula given; `cMultipleScatteringDepthPower`, `...HeightPower` not given anywhere |
| Light sample count and distances | N | Not found for this model. hzd15 s83 six cone samples (older). Ours: `lightTaps: 6` (`settings.ts:746`) |
| Step law | P | s36 |
| Max steps | N | Ours: 256 (`settings.ts:746`) |
| Temporal amortisation | P | 16 frames, s44 |
| Cost | P | 0.5 to 2.2 ms (s37) |
| Coverage early-out threshold | N | ne22 p91 names `density_threshold`, no value |
| Min/max height meaning (absolute m or fraction of layer) | N | See Q6 |

## 9. Map to existing code

All lines are in `packages/runtime/src/procedural/` unless a path is given. Status: **matches** (the spec), **differs** (how), **other gen** (which generation it comes from).

### 9.1 By spec part

| Part | Code | Status |
| --- | --- | --- |
| 2 Five NDFs | `hzd/ndf.wgsl.ts:21` `NdfSample` (coverage, topType, bottomType, minHeight, maxHeight, plus storm); `ndfSample` :31; storage `hzd/ndf.ts:7` | **Matches** for the five fields; the sixth (storm) and the alpha channels (cirrus) are other gens (n3 s34 / ne22 p139; ne22 p64). Map is 32 km at 1024^2 (`settings.ts:612-615`): differs from 16 km. Map moves with `ndfDrift` by default (`ndfOffset` `hzd/ndf.wgsl.ts:23`; `HZD_DEFAULTS` `settings.ts:732`): **differs** (spec: NDF is not advected; owner decision 2026-10-10 per settings comment). |
| 2 Generator | `hzd/ndf.wgsl.ts:70` `generate`, `hzd/ndf.ts:33` `generateHzdNdf` | **Other gen** (n17 p53 to p58 recipe, plus ours). Not in n3. |
| 3 Tables | `generate/profile-tables.ts:32-153`; `shaper.wgsl.ts:132-170` `hzdLutTexel`, `hzdLut`, `hzdTableProfile` | **Matches** in structure (top * bottom, 64x64, bilinear). **Differs**: smoothing, peak division, floor mapping (3.3, 3.4). |
| 3 Type to table | `shaper.wgsl.ts:157` `hzdTableType` maps an HZD type 0 / 0.5 / 1 through anchors 0.14 / 0.27 / 0.40 (`HZD_FORM_DEFAULTS`, `settings.ts:633`) | **Differs**. Spec indexes the top table with the NDF top type directly. The anchors bridge the 2015 three-type model. |
| 3 Nutshell gradients | `shaper.wgsl.ts:21-26` `HZD_GRADIENTS`, :122-129, :190 `hzdTypeGradient` ('points', 'curves', 'hybrid') | **Other gen**: 2015 HZD (nut s7 to s8, gp7 p103, n17). Used when `profileMode` is not 'tables'. |
| 3 Height fraction | `shaper.wgsl.ts:480-481, 548` (`bottom`, `top` from min/max NDF, `h = (alt - bottom)/(top - bottom)`) | **Matches** the inferred remap. Column top then lowered by coverage (:543-545, `heightFromCoverage`): **ours** (hag p13, constants ours). |
| 3 `dimensional_profile` | Not formed in the default density path. Coverage enters as a remap threshold at :593 `hzdRemap(baseCloud, 1.0 - cov, 1.0, 0.0, 1.0)`. The exact `cov * gradient` is computed only for lighting at :755-760 (`o.prof = cov * g0`), when `lightProfile` is 'exact' (default 'standin', `settings.ts:732`) | **Differs** (GP7/HFW remap law, other gen). |
| 4 Noise textures | `hzd/noise.ts` (`bakeHzdNoise`, shape 128^3, detail 32^3, curl 128^2); `hzd/noise.wgsl.ts` | **Matches** s22 channel layout for the shape texture (R Perlin-Worley, G/B/A Worley); format RGBA8 differs from "2 B/texel" (Q8). Detail 32^3 and curl 128^2 are **other gen** (gp7 p102 to p108, hzd15 s32 to s33). |
| 4 Composite by type | `shaper.wgsl.ts:264` `hzdN3Noise`, :285 `hzdN3Type`; uses `cloudNoise` (the Nubis Cubed voxel noise: R/G Curly-Alligator, B/A Alligator) | **Other gen**: n3 s95 to s109 voxel up-rez (wispy `lerp(R, G, P)`, billowy `lerp(0.3 B, 0.3 A, P^0.25)`, per-voxel type). Not the 2.5D recap. |
| 4 Erosion | Default (`noiseSet: 'nubis3'`): `shaper.wgsl.ts:659-672` `hzdValueErosion(prof, comp)` = `saturate((P - n)/(1 - n))` (:289), then n3 s107/s109 sharpen at :674-679. Alternative: gp7 branch :681-730 `remap(d, modifier*strength, 1, 0, 1)` ('gp7' / 'hag' laws, `erosionLaw`, `erosionOrder`) | **Differs**. Spec is `saturate(noise - (1 - P))`. Neither branch implements it. ValueErosion is n3 s107 (voxel era, opposite noise polarity). gp7 branch is 2015. |
| 4 Sharpening | `shaper.wgsl.ts:740-742` `densityPow` (default 1) | **Other gen**: ne22 p105 (envelope only). |
| 5 Wind | `shaper.wgsl.ts:557-561`: `qShape = q - scroll * speed`; `q` is first skewed by `h * cloudTopOffset` | Scroll sign **matches** s25. Top skew and upward bias are **other gen** (gp7 p109 to p110). Per-noise speeds are ours (`ndfMotion` options). |
| 6 Lighting | `shaders/lighting.wgsl.ts:73` (`ms = profile * exp(-tau*relax) * ...`), :83 (`occlusion = mix(ambientFloor, 1, sqrt(1 - profile))`), :102 (`direct = ... exp(-tau) * phase`) | Ambient **matches** s30 (plus a floor 0.15 and height terms, ours). Direct **matches** structure; MS **differs** (no height attenuation; proxies for profile and depth in `standin` mode: `trace.wgsl.ts:330`). Not specified further here. |
| 7 Step | `trace.wgsl.ts:237` `fineStep0 = max(P.steps.x, t * stepConeAngle * 1.5)`, coarse x4 at :259; `stepMeters: 25`, `maxSteps: 256` (`settings.ts:746`) | **Differs**: pixel-cone law, 25 m floor, coarse stride; spec is `3 + 60 d/16384`. |
| 7 Temporal | `shaders/sky-layer.wgsl.ts:93` (4x4 Bayer, 16 frames) | **Matches** s44 in kind. |

### 9.2 What the rebuild leaves behind

Not part of this one-generation model at all. Counted from the `HzdShape` interface (`settings.ts:184-508`): 146 settings, of which **19 stay** and **127 do not**.

Stay (19): `layerBottom`, `layerTop`, `extinction`, `coverageBias`, `typeBias`, `windDirection`, `ndfMotion`, `ndfDrift`, `shapeSpeed`, `detailSpeed`, `mipBias`, `noiseFormat`, `lightProfile`, `tableSource`, `bottomTypeBias`, `tableFloor`, `n3Tile`, `emptySkip`, `emptySkipCoverage`. Several need rename or semantic change (for example `n3Tile` becomes the one noise tile).

Left behind (127), by group:

| Group | Count | Settings | Origin |
| --- | --- | --- | --- |
| 2015 HZD density chain and its variants | 22 | `typeBlend`, `coverageMultiply`, `baseFadeMin`, `baseFadeHeight`, `erosionLaw`, `erosionOrder`, `erosionStrength`, `wispyHeight`, `topRound`, `profileSmooth`, `stage`, `shapeContrast`, `cloudTopOffset`, `upwardBias`, `curlTile`, `curlStrength`, `detailTile`, `detailDistance`, `detailRecipe`, `detailCubicDistance`, `shapeCubicDistance`, `shapeTile` | gp7, hzd15, hag |
| HZD noise bake knobs | 4 | `noiseCarve`, `noiseFine`, `noiseSmooth`, `noiseSupersample` | ours, on the 2017 tool |
| Horizon ring | 5 | `ringStart`, `ringEnd`, `ringCoverage`, `ringType`, `ringFadeStart` | hzd15 s45 |
| Our look-fix passes (H6/H7) | 28 | `heightFromCoverage`, `heightCoverageRef`, `coverageDensityPow`, `coverageDensityRef`, six `veil*`, seven `skirt*`, `bottomCurl`, `bottomErosion`, `bottomCurlDown`, five `lobe*`, `baseLump`, `wispyStrength`, `densityPow` | ours |
| Storm, anvil, cirrus, lightning | 24 | `anvilBias`, `anvilClamp`, `anvilFlatten`, `anvilDensityFix`, `stormX/Z/Radius/Strength/Top/TypeStart/Source/Density/Dark/Glow/FlashRate/Single/AnvilShape/Rotation`, `anvilSpread`, `anvilShear`, four `anvilCirrus*` | n17, hag, hfw, ne22 p133 to p185 |
| Extra forms and mid-layer mixing | 30 | eight `mid*` form settings, eight `midLayer*`/mix settings, eight `deck*`, eight `fractus*` | ours (n3 s162 skirt idea, hzd15 s26) |
| Table bridge to the 2015 type | 6 | `profileMode`, `tableTypeStratus`, `tableTypeStratocumulus`, `tableTypeCumulus`, `bottomTypeVariation`, `bottomTypeTile` | ours |
| Voxel-era noise knobs | 8 | `noiseSet`, `n3Strength`, `n3StratusType`, `n3HhfDistance`, `n3Sharpen`, `n3Curl`, `shapeNoise`, `n3ShapeTile` | n3 s89 to s109 |

The NDF block (`HzdNdfSettings`, `settings.ts:89-181`, 43 settings) is a separate group: generator recipe, painting, storm blob and cirrus settings. It is the not-published generator (section 8), so it is outside this spec either way.

Code paths in `hzd/shaper.wgsl.ts` outside the model (about 570 of 977 lines):

| Group | Lines | What |
| --- | --- | --- |
| Nutshell gradients and type blends | 21-26, 118-129, 190-206 | 2015 height gradients |
| Storm, anvil, swirl, flash | 171-182, 207-216, 291-452, 497-541 | superstorm and anvil machinery |
| Cubic reads, curl detail | 217-262 | H5/H7, gp7 detail |
| Veil, skirt, lobes, lumps, wispy bottoms | 593-653, 693-738 | our look-fix passes |
| Sheets, fractus, merge | 774-900 | mid, deck, fractus forms |
| Horizon ring | 463-474, 952-960 | hzd15 s45 |
| gp7 and hag erosion branch | 681-730 | 2015 |
| Voxel-era noise and ValueErosion | 264-289, 659-679 | n3 second half |
| Bounds and empty-skip helpers | 922-967 | perf, keep in a perf module |

## 10. Open questions

| # | Ambiguity | Options | Recommendation |
| --- | --- | --- | --- |
| Q1 | Height mapping: does min height map to table row 0 (h=0) or to the floor (row 17, h=0.266)? Both tables are 0 / 1 below row 17. | (a) literal `v = h` (bottom 27 % of the column empty); (b) `v = floor + h*(1 - floor)` (our current choice, `shaper.wgsl.ts:166`). | (b). Under (a) min height would not be where the base is, contradicting the NDF name. Keep a setting for (a). |
| Q2 | `detail_type` and `cloud_type` have no source in the five-field list (s18). s23 uses `detail_type`; ne22 p54 uses `cloud_type`. | (a) derive from top type; (b) derive from height as in the envelope model (ne22 p99, `Remap(h, type-0.1, type+0.1)`, argument order flipped to match its diagram; ne22.md review); (c) a constant 0.5. | (a) with a height term: `T = saturate(h/0.2) * f(top_type)`. Record it as ours. |
| Q3 | Composite polarity and range. Our `cloudNoise` is tuned for ValueErosion (billowy x0.3); the additive law needs high = more cloud (topics/shape.md notes `n' = 1 - composite`). | (a) feed `1 - composite`; (b) bake a composite with mean about 0.5 and spread to taste; (c) clamp. | (b), judged on A/B sheets against Tidewater, since the core density equals the composite mean at profile 1. |
| Q4 | Noise tile sizes and scroll speed not published. | gp7 6 km shape / ours 600 m voxel tile. | Start at one tile, 600 m, scroll speed a setting; tune to photos. |
| Q5 | Profile normalisation: the raw product peaks at about 0.91 and varies per (top, bottom) pair. | (a) literal; (b) divide by peak (ours). | (a) first, since the additive law uses `1 - P` as a threshold and coverage is the intended control; keep (b) as a switch if low bottom types vanish. |
| Q6 | NDF min/max height: absolute metres, fraction of a fixed layer, or fraction of 256..2048 m? | fraction of layer (our reading); absolute. | Fraction of layer, with layer 256 m..2048 m as in ne22 p20, as a setting. Our layer is 1500..5000 m, an owner/scene decision. |
| Q7 | Bottom type orientation: ne22.md:31 reads type 0 ragged, n3 table data and notes say type 0 crisp. | follow n3 data (resolved reading). | Follow n3 data; re-verify against ne22 p27 renders when sheets exist. |
| Q8 | s22 says 2 bytes per texel for 4 channels (4.194 MB); our bake is RGBA8 (8.4 MB). | match 16 bpt (about 4 bits per channel, visible banding); keep RGBA8; rgba16float option exists (`noise.ts`). | Keep RGBA8; it is not a model requirement. |
| Q9 | Beer constant: n3 s28 graph exp(-5 d), ne22 p46 e^-d. | pick per renderer. | Irrelevant if lighting is fitted to a path tracer; the density's extinction scale is the real free parameter (not published). |
| Q10 | MS height attenuation and the two exponents are unpublished. | fit to the path tracer. | Fit; do not guess constants. |
| Q11 | Whether the NDF is sampled per step or once per column. ne22 p91 shows per-sample reads (3 reads). | per-sample; column cache. | Per-sample; the bounds grid (`hzd/bounds.ts`) already skips empty cells. |
| Q12 | Drift: spec says NDFs are not advected; our default drifts the map. | follow spec ('static'); keep 'drift'. | Default 'static' for parity runs; keep 'drift' as the owner's visual setting. |

### Contradictions with the plan's assumption that the recap is complete and implementable

1. No noise composite recipe: s22 says "combined in various ways per model" and s23 shows only the lerp. The core of the surface detail is not in n3 or ne22.
2. No `detail_type` source in the vertical-profile model (Q2).
3. The profile tables exist only as images; the bottom table is a 15-colour palette (+-0.04); no floor mapping, filter or normalisation is stated.
4. No light sample counts, no MS powers, no HG values; the equation is structural.
5. No NDF generator, resolution or encoding.
6. Two small internal contradictions: s22 byte count versus RGBA8; s28 graph k about 5 versus ne22 p46 k = 1.
