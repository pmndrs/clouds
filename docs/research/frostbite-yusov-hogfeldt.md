# Frostbite clouds and Bouthors 2008: Hillaire 2016, Yusov 2014, Högfeldt 2016, Bouthors et al. 2008

Sources (local only, `artifacts/research/`): `s2016-pbs-frostbite-sky-clouds-new.pdf` (H16, 62 pp, course notes; printed page = PDF page), `Yusov-Clouds.pdf` (Y14, **44 slides, not the paper**), `hogfelt.pdf` (Hö, 52 pp thesis; printed page = PDF page). Fourth source added later: `bouthors08.pdf` (B08, 10 pp, Bouthors et al., "Interactive multiple anisotropic scattering in clouds"; section 1b). Citations are `[H16 p.N]`, `[Y14 sN]`, `[Hö p.N]`. Numbers marked "calc" are mine (Python), not from the sources. Read after `approximate-mie.md` and `rdr2-atmosphere.md`; what they already cover is not repeated.

## Read this first

- **None of the three gives a sunset colour recipe.** Frostbite's cloud colour at dusk comes out of (a) a physically derived, very red and dim sun, (b) a sky-probe ambient, (c) the aerial-perspective composite. There is no mauve-body trick, no coloured multiple scattering and no per-sample sun transmittance in the text.
- **Frostbite's multiple scattering is the same family as ours** (Wrenninge octaves, sun-tinted, no separate colour). So our `ms` term being sun-tinted is **not** by itself the bug. The likelier cause is **elevation-independent sun feeding of the isotropic body terms**: Bouthors 2008 (section 1b) shows the deep-body light scales with the cosine of the sun to the surface and is replaced by environment light at low sun. Frostbite's own sun is already red and dim, and so is ours (`sunRadianceAt`).
- Y14 is a deck for a particle method; it has nothing on ambient, aerial perspective, cirrus or shadow. Its sunset frame is a useful **negative example** (section 1.4).
- Hö has the most compact statement of the Frostbite cloud shader and a dusk render; he lists aerial perspective and cloud shadows on the ground as **future work** (p.41, p.43).

## 1. Sunset and low-sun cloud colour (question 1)

### 1.1 Multiple scattering [H16 p.41, eq. 19-20]

- Wrenninge octaves: `L_ms = sum_{n=0..N-1} L_scat(sigma_s * a^n, sigma_e * b^n, p(theta * c^n))`. The text constrains **a <= b** for energy conservation. **No numeric a, b, c are given.** They are artist knobs.
- Shipped setting: **N = 2** for the performance numbers [H16 p.45], and N = 3 "with exaggerated multi scattering" appears only in the comparison figure (p.42). The sun luminance enters every octave the same way, so every octave is sun-tinted.
- Stated drawback, which is our symptom: it "does not represent well" side or backward scattering (p.41). Nothing in the notes fixes colour.
- Our `cloudInScatterMicro` does the same with DEEP_B = 0.5, DEEP_C = 0.5, `deepAttenuation` 0.35 (a), N = 4. Compared with Frostbite we have **two extra glow terms**: `ms` (phase-less, scaled by `glowBoost` 12 and `msStrength` 1.4, MS_NORMALISATION 3/(4 pi)) and the deep octaves (`deepScatter` 1.2). Frostbite has only the octave sum. So the wrong-colour candidate stays our extra phase-less `ms` term, but the reason is that it ignores sun elevation (B08, section 1b), not that Frostbite avoids tinting.

### 1.2 Sun colour and transmittance [H16 p.25-27, p.18-20]

- Artists give sun **illuminance at zenith after the atmosphere**, `E_zenith = 120000 lux`; sun solid angle `omega = 2 pi (1 - cos(theta/2))` = 7.11e-5 sr at 0.545 deg; `L_zenith = E/omega = 1.69e9 cd/m2` (eq. 14-16).
- Outer-space luminance `L_outer = L_zenith / Tr_zenith`, then `L_sun = Tr_sun(LUT) * L_outer` (p.26). Tr_zenith is given: **(0.925, 0.861, 0.755)**; with the sun at the horizon **(0.0499, 0.004, 4.10e-5)** (p.27). The horizon sun is therefore about 20x dimmer in R, 230x in G, 23000x in B: **normalised to red it is (1, 0.08, 0.0008)**, i.e. a strongly saturated orange-red, and very dim.
- Atmosphere constants (Table 2, p.19): Rayleigh `sigma_s = (5.8e-6, 1.35e-5, 3.31e-5) /m`, scale height 8 km; Mie `sigma_s >= 2e-6`, extinction `1.11 * sigma_s`, scale height 1.2 km; ozone absorption `(3.426, 8.298, 0.356) * 0.06e-5 = (2.06e-6, 4.98e-6, 2.1e-7) /m` (p.20), **distributed like Rayleigh** (8 km), not at 32 km. Wavelengths 680, 550, 440 nm. "Without ozone, the sky can appear too yellow" (p.20), which matters for the mauve and indigo bands of our photos.
- **Is the sun transmittance evaluated per sample, per altitude? Not stated.** The shading listing calls `sunLuminance(coord, sunDir, viewDir)` (p.37) without a body. The only documented transmittance lookup is the 2D LUT indexed by view height and angle (p.18), used for the sun disc. The cloud-layer text never mentions it, and the sun's `E_zenith` knob suggests one colour per frame.
- **Why it matters for us (calc):** sun transmittance for a ray from altitude h to the top of the atmosphere, spherical Earth R = 6360 km, Frostbite coefficients above, 400 steps. Rows are sun elevation, columns are sea level, 2 km, 6 km:

| elev | 0 m | 2 km | 6 km |
| --- | --- | --- | --- |
| 20 deg | .83 .65 .46 | .87 .72 .55 | .92 .82 .70 |
| 5 deg | .51 .22 .065 | .61 .31 .12 | .74 .49 .28 |
| 2 deg | .29 .059 .0065 | .40 .12 .021 | .58 .27 .096 |
| 0 deg | .085 .0042 6e-5 | .17 .016 6e-4 | .35 .085 .012 |

  At 2 deg the sun reaching a 6 km cloud is about 2.5x brighter than at 2 km, and its blue is 15x higher, so **less saturated and pinker-white**. That is the physical origin of "high cloud stays pink after low cloud goes dark" (our photo spec). It needs sun transmittance **as a function of sample altitude** (cheap: one value per cloud layer, or per height slice) **and** an earth-shadow term for the lowest layers. Frostbite's 3D LUT drops azimuth, so it "cannot represent the shadow of the earth" [H16 p.21]; RDR2 added it (see rdr2-atmosphere).
- Sun disc: limb darkening via a gradient (p.28) and Appendix B. Not a cloud issue.

### 1.3 Ambient colour [H16 p.35-36; Hö p.30, p.28, p.52]

- H16: ambient comes from the **global light probe, first (non-directional) SH term only**, no occlusion. It "can often be too bright", so artists get a scale in [0, 1] and a **desaturate** control, because "slightly blue cloud" results when no multi-scattering solution is used (p.35). The sky-derived colour is the ambient; no sun weighting.
- Hö: the shader adds `ambient = gradient * precipitation * globalAmbientColor` and the source term is `S = (EvaluateLight(dirToSun, pos) * phase + ambient) * sigmaS` (Alg. 5.4, p.28). Artist controls: `AmbientMultiplicator`, `AmbientDesaturate` (p.52).
- So the ambient is **sky colour, scaled and desaturated**. At dusk the probe is the blue/violet twilight sky, so shadowed bodies come out cool grey-blue-mauve. That is the same mechanism the RDR2 notes found, and the two sources agree. No weighting toward the sun. RDR2's sun-weighted reduced sky is the more specific recipe.
- The rendered dusk in H16 is neutral: **Fig. 47** (p.47) dusk cumulonimbus is slate with a pale lit patch, **Fig. 48** (stratocumulus) is grey-beige bodies on blue-grey sky with a pale grey horizon. Neither has warm fringes. Hö **Fig. 7.4** (p.39) is a backlit sunset: **dark brown-grey bodies with golden rims**, warm haze at the sun. That is the closest of the three to our photo targets.

### 1.4 Yusov 2014 as a negative example [Y14 s24-s25]

- Pre-computed multiple scattering is tabulated per light orientation (s22-24: 3D table, orders summed, s23). The sunset sphere frames (s24-25) are **uniformly yellow-orange** from top to bottom. That is exactly our "uniform warm cream" failure, and it arises because the light is the sun colour only: the sky ambient is not in the table. Takeaway: whatever the multiple-scattering model, a single-colour source gives a single-colour body. Contrast needs a separate ambient of the *sky* colour.

### 1.5 Answer from the Frostbite side, and what to try (inference, not from the sources)

Our code already has what H16 lists as the physical baseline: `sunRadianceAt(c)` = atmosphere transmittance to the sun x `luminanceScale` x `sunColor` (atmosphere.wgsl.ts:86), and `skyAmbient(c)` upper/lower, both computed **once per frame at the volume centre** (march.wgsl.ts:268-274). So the sun is already red-and-dim at low elevation, and the ambient is already sky-derived. The remaining Frostbite-side suspects are therefore:

1. **One sun colour for the whole volume.** The 6 km cloud and the 2 km cloud get the same `sunRadiance`. Per-altitude values (calc table in 1.2) are 2-15x less saturated at height. Cheap: evaluate `sunRadianceAt` at the cloud base and top (two samples) and mix by `h` in the shader. This is the lever for "high cloud stays pink, low goes dark".
2. **Size of the phase-less glow.** `ms * glowBoost(12) * msStrength(1.4)` and `deepScatter(1.2) * deep` all multiply `sunRadiance` and carry most of the lit radiance, with **no dependence on sun elevation** (only the `exp(-tau)` direct term and `sunRadiance` itself change). B08 (section 1b) says this is the physical error: deep-body light scales with the cosine of the sun to the surface, so it should collapse at low sun.
3. **Ambient**: desaturate knob, scale in [0, 1], bottom-to-top bias (section 3).
4. **Dual-lobe HG** [H16 p.40-41, eq. 18, `lerp(HG(g0), HG(g1), w)`] is what we already have (`cloudPhase`). No numeric g0, g1, w are given in H16. Hö uses a single HG with `Phase` as an artist g (p.52).

## 1b. Bouthors et al. 2008 (B08): why low-sun bodies go mauve (questions 1 and 3)

Source: `bouthors08.pdf`, 10 pp, SIGGRAPH 2008. It is a mesh-plus-hypertexture cloud renderer on a Pentium 4 and an 8800 GTS (10 fps for stratocumulus, 2 fps for a 5K-triangle cumulus; 80% of the cost is the noise, p.7-8). The renderer is not portable to our march (depth-map collectors, 5D tables). **The value is the physical analysis of light transport by scattering order**, which explains the colour split. It has **no wavelength-dependent cloud colour**: "water cloud albedo can be considered as 1" [B08 p.2], so every colour in a B08 cloud comes from the colour of the light sources.

### What the paper says about order and colour

- Constants [B08 p.2, p.8]: **mean free path about 20 m**; the Mie phase has a narrow forward peak (**51% of the energy**, within about 5 deg), a wide forward lobe (**48%**), and a complex backward lobe; "99% of the light is scattered in the forward direction". Cumulus droplets: **r_e = 6 um, gamma = 2, N0 = 4e8 /m3**, `kappa = rho * N0 * pi * r_e^2` (calc: 0.045 /m at rho = 1, which is a 22 m free path, consistent with the 20 m quoted). They use the "modified Mie" trick: the 5 deg peak is removed from the phase and folded into a **50% lowered density** [B08 p.8, Lenoble 1985], so only half the scattering events are tracked.
- **Orders split into three regimes** (Fig. 4 and Fig. 3, p.2-3):
  - **order 1** is the most anisotropic and depends on the finest detail: silhouette, silver lining, thin parts;
  - **orders 2-30** are still anisotropic ("Even high orders (up to 30 scattering events) show an anisotropic behavior"), giving the glory, backscatter and the spread near the edge;
  - **orders above 30** behave as if the phase were isotropic and "begin to appear at thicknesses > 100 m" [B08 p.3, Fig. 3 right]. They carry the **diffuse body**. Anisotropic orders (1-30) still "contribute to 30%-100% of the reflectance" and matter for transmittance up to 1000 m of slab.
- The renderer sums **8 sets of orders: 2, 3-4, 5-6, 7-8, 9-12, 13-18, 19-30, 31-inf** plus an analytic order 1, each with its own transport function and its own "collector" on the lit surface [B08 p.4].
- **The sun dependence is in the transport function** [B08 p.5]: `T = P * A * X * mu_L * (log(d + D) / log(B + D)) * exp(-(d - B)^2 / (2 C^2))`, with `mu_L = cos(phi_L)` and `phi_L` the lighting angle from the slab normal, `X(t, mu_L)` a Chandrasekhar-style correction, and `P(theta)` = 1 for the isotropic orders (31+). So the light that enters the cloud and ends up in the body is **proportional to the cosine of the sun against the local surface**, and its depth profile is a skewed Gaussian in depth `d` with 5 fitted parameters (A, B1, B2, C, D) read from 2D tables that are not printed in the PDF. The collector (where the light entered) shifts along the surface with `phi_L`: `c_x = A_x log(1 + E d) + B_x`, `A_x = F sin(psi_V) sin(G phi_L)` (p.5). At grazing sun the entry area slides far toward the sun, so for a deep point in a lit flank very little light arrives from the sun side.
- **Environment light is handled by the same machinery** [B08 p.7]: "A blue source is added above the cloud and a brown one below the cloud", each pushed through the full multiple-scattering algorithm. The colours are artist-chosen; no values are given.

### Reading this for sunset (inference)

- The three regimes give you the colour map of a low-sun cloud:
  - **fringes and thin parts are low order**: they keep the sun's colour and its phase function, so they are warm and bright (silver and gold rims). This matches the photos' warm fringes and Hö Fig. 7.4.
  - **the deep body is high order and isotropic**: its sun-fed part scales with `mu_L`, so at a sun elevation of a few degrees it is nearly gone on horizontal tops and on sun-facing flanks it enters only through a sliver. What remains is the **environment term** (sky above, ground and low cloud below), diffused through the same orders. That is the **slate and mauve** body, and its undersides pick up the warm "brown" ground and low-sun glow from below, matching the photo notes (orange-pink lit undersides, grey-blue tops).
  - Our `ms` and `deep` terms are the isotropic body, but they take the full `sunRadiance` at any elevation. That is the likely reason for "uniform warm cream": in B08 terms we feed the high orders with a sun flux that should have been multiplied by roughly `sin(elevation)` (for a horizontal surface) and replaced by the environment term.
- Also from B08: the isotropic orders only start above about 100 m thickness. Our `relax` uses `valueRemap(sdf, -128, 0, ...)`, a 128 m depth scale, which is consistent.

### Cheap port for the march (ours, calibrated on B08's structure; constants are starting values to tune against the photos)

Keep the direct term and the first octave as they are (low orders, sun-tinted, phase-driven). For the glow and the deep octaves (orders above about 2), change the light source, not the geometry:

```
muS     = max(sunDir.y, 0.0)                       // sun against a horizontal surface; use dot(N, sunDir) if a gradient normal is at hand
sunBody = sunRadiance * mix(MU_FLOOR, 1.0, saturate(muS / MU_KNEE))      // MU_FLOOR 0.05, MU_KNEE 0.5 (starting values)
envBody = mix(ambientDown, ambientUp, h) * ENV_GAIN                      // the "blue above, brown below" pair we already have
glowLight = sunBody + envBody * (1.0 - saturate(muS / MU_KNEE)) * K_ENV  // env takes over as the sun drops; K_ENV about 1
return sunRadiance * (exp(-tau) * phase) + msStrength * ms * glowLight * MS_NORMALISATION + deepScatter * deep * microOcc * glowLight + ambient
```

Why this form: it changes **only** the term B08 says should depend on `mu_L`, leaves the silhouette and silver lining alone, and costs two multiplies and one `saturate`. With `muS = sin(3 deg) = 0.05` the glow sun share falls to about the floor and the body colour becomes `envBody`, which at dusk is the violet-blue reduced sky. At noon (`muS >= MU_KNEE`) nothing changes, so existing tuning holds. Check: the lit-to-shadow ratio at 3 deg should land at 4-6:1; if it is higher, raise `MU_FLOOR`; if the body is too blue, lower `K_ENV` or desaturate per H16 p.35.

A heavier option (not recommended now): the 8-set order split with a per-set `mu_L` and depth Gaussian. It needs the 2D tables A, B1, B2, C, D, X, P that are in the paper's figures/appendix, not in the text, and a per-set collector search (10 iterations per pixel, p.7). Out of budget.

### Ambient and ground bounce in B08 (question 3)

- Only the "blue above, brown below" pair (p.7), pushed through the full multiple-scattering transport like the sun. No numbers, no sky integration.
- In their discussion, shadowed parts of non-convex clouds are where "environment (i.e., sky and ground) illumination is predominant" (p.8), and they flag **cloud-ground interreflections as "of visual importance"** and future work (p.8, citing Bouthors 2006).
- Together with H16's [a, 1] gradient bias (section 3) this supports a three-term ambient: sky from above, a **ground/low-cloud term from below that is warm at sunset**, and a bias so the underside never drops to zero. Our `ambientDown` already has this slot; check its colour at dusk (it should be a warm brown-pink glow, not the sky blue).

## 2. Horizon and aerial perspective on clouds (question 2)

H16 is the **origin** of the "weighted depth" trick that RDR2 reuses; the rdr2 notes already cover the application. New here:

- **Eq. 21** [H16 p.43]: `Depth_cloud = sum_n Tr(x_n) * Depth(x_n) / sum_n Tr(x_n)`, the transmittance-to-camera weighted mean of the **front** depth. Samples are skipped while no cloud particle has been hit (transmittance still 1). The result is a smooth depth buffer (Fig. 42).
- Aerial perspective is **sampled once** from the 32x32x16 camera-frustum 3D texture (p.21, 0.05 ms on Xbox One, p.22) at that depth, and applied to the integrated cloud luminance and transmittance. Per-sample lookups were rejected for cost (p.43).
- **The reverse coupling, new to us** [H16 p.43-44, eq. 22]: `L_AP = L_AP * Tr_cloud + L_cloud`. Clouds are first rendered over black to give a per-pixel (luminance, mean transmittance); these then **attenuate the sky-scattering of the aerial perspective texture** below the layer and add the cloud's own scattered light. Fig. 41: without it a heavy layer "simply composited over a bright day sky" looks wrong; with it the haze under the cloud goes dark blue. This answers how sunset horizon haze should respond to a cloud deck: the layer **cuts the sun term of the air in front of it**.
- Distant fade: H16 has no extra fade. Distance is a march-length cap by atmosphere depth [Hö p.24]: step length = (min(atmosphere depth, artist cut-off)) / steps, so step size grows toward the horizon while the step count stays constant. Hö also lets coverage be modified by distance "to either increase or decrease clouds presence at the horizon" (p.20). Cut-off distance is the `CutOffDistance` control (p.52).
- Horizon in the atmosphere LUT: Yusov 2013's parametrisation avoids horizon artefacts [H16 p.21]; height fog is coloured from the LUT's **horizon luminance** so fog and sky match (p.22).
- Hö: "clouds should also be affected by aerial perspective and fog" is explicitly left as future work (p.43).
- Y14: nothing (its atmospheric scattering is the Bruneton-style pass, s42-43 "Atm. Scattering", about 1.5 ms of the total).

## 3. Ambient lighting of clouds (question 3)

- Source: first SH term of the global probe, no occlusion [H16 p.35]. Not the sky hemisphere sampled per direction.
- **Top versus bottom**: "linear gradient in [0, 1] from the bottom to the top of the cloud layer", assuming the sky is the only ambient [H16 p.35]. Two improvements, p.36:
  - bias the gradient to **[a, 1]**, with a% of the ambient attributed to ground bounce;
  - or sample the probe **separately for the top and bottom hemispheres**, which also picks up the ground tint (needs the probe to integrate the earth's colour).
- Hö: the same linear gradient, strength and colour controlled by the module (p.30); a **precipitation** gradient darkens rain clouds, multiplied into the light, because with one droplet size the base would otherwise be lighter than the top (p.21-22).
- Our `cloudInScatterMicro` already has an ambientUp/ambientDown blend with `ambientSkyBias` 0.9 and `ambientFloor`, so we are ahead of H16 on this. The missing piece is the **colour source** (sky reduced, not constant) and the desaturate knob.
- Y14: ambient is not addressed in the deck. Sky lighting appears only via the pre-computed table (s22) and the sun orientation.

## 4. Shadows (question 4)

- **Cloud shadows on the world** [H16 p.42]: baked into a **2D texture of transmittance** (single texture, format not specified), projected assuming a **flat planet around the camera**, applied to all opaque and transparent surfaces and to particles (emitters), and **sampled when updating the input to dynamic GI** (Enlighten). No resolution, bit depth or update rate is given. RDR2's ESM R16F 768x768 (see rdr2-atmosphere) is the only concrete format we have.
- **In-cloud sun shadow** [H16 p.36, Hö p.29]: march toward the sun, **four samples** at a base distance multiplied by a constant factor each step (Hö: "exponentially increasing"), jittered per frame, giving soft shadows. Constant factor and base distance are not given. Ours: two in-line samples at 0..16 m and 16..48 m plus a light grid, which is richer.
- Hö's untested idea [p.41]: because the sun is parallel, **precompute the shadow LUT and update it only when the sun moves**. This is the idea behind our grid. Hö states the technique "does not cast shadows on the environment" (p.41).
- **God rays**: listed as missing in Hö (p.41). H16 has none. Use RDR2's.
- Y14: occlusion is computed from the light direction by rasterising the particles into a tile grid and traversing per-tile lists, early out at transmittance 0.01 (s27-29). Not applicable to a marched volume, except the 0.01 cut-off value.

## 5. Performance (question 5)

New numbers and ideas not in nubis-sources, hzd-nubis-evolved or rdr2-atmosphere:

| Item | Value | Where |
| --- | --- | --- |
| Frostbite clouds, Xbox One, worst case (horizon, 3/5 of screen cloud, 16 samples, N = 2 multi-scatter) | 720p 0.91 ms, 1080p 1.60 ms main; planar reflection 0.14 / 0.20 ms | H16 p.45 |
| Resolution | Main view half-res, planar reflection quarter-res | H16 p.45 |
| Sky | 0.42 ms at 720p; AP volume 32x32x16 0.05 ms; LUT rebuild 3.5 ms once, **spread over 19 frames = 0.22 ms/frame**, lerping between the last two valid LUTs | H16 p.22 |
| Temporal | EMA of the scattered light, **alpha 5%**, jittered sample offset per frame, reprojected history; if off-screen alpha = 1 and the step count is raised for that pixel | H16 p.36; Hö p.32 |
| Jitter sequence | Van der Corput | Hö p.32 |
| Early exit, low | stop at transmittance **< 0.01** | Hö p.33 |
| Early exit, high | if last frame's transmittance was exactly 1.0, skip the march and **force a march next frame**; a checkerboard of tiles avoids one frame being much dearer | Hö p.34-35 |
| Distance field to nearest cloud | tried, "got worse" in some cases, removed | Hö p.41 |
| Memory | Weather RGB8 1024x1024 3.1 MB, shape RGBA8 128x32x128 2.1 MB (y at quarter resolution), detail RGB8 32^3 0.1 MB, two half-res RGBA16 targets 4.1 MB each; 13.5 MB total | Hö p.36 |
| Y14 particles | Iris Pro 5200 720p: 16 / 25 / 36 ms (low/med/high, 104^2x4x2 .. 184^2x4x4 cells); GTX 680 1080p: 5.5 / 9.5 / 15.5 ms; atmosphere 1.5-4 ms | Y14 s42-43 |

- **Improved scattering integration** [H16 p.38-39, Listing 2]: `S_int = (L - L * T) / sigma_e` per step, then `scatt += T_so_far * S_int; T_so_far *= T`. With it **21 samples** match a 512-sample reference (Fig. 37). Hö uses it (Alg. 5.4). We already use the equivalent for the ray; check that the **ms/deep terms use the same energy-conserving form** so dense bodies do not blow out.
- Early-out idea worth trying for 9-C3: Hö's "previous-frame transmittance = 1, skip" test is a free empty-sky skip, if we have history.
- Y14 has no technique we can use for cost: its pre-computation needs spherical particles.

## 6. Cirrus and high clouds (question 6)

- **None of the three has a cirrus method.** H16 clouds are one slab of constant height (p.33). Hö says cirrus is "high altitude" in the nomenclature (p.9) and, in his module, "the old cloud layer system" still handles flat texture layers with a per-layer wind direction (p.22). He renders volumetric clouds at five altitudes by the weather texture's B channel (p.21), so a thin high stratum is possible but he does not discuss it.
- Weather texture channels (H16 p.33): R = 2D projected density, G = type index; type texture X = type, Y = normalised layer height, with R = density-in-height and G = erosion amount. Anvils are drawn with the type texture (p.33). Nothing on fibre.
- So cirrus stays on NE p.65, RDR2 S64-65 and the Witcher fallback (see README).

## 7. Other items worth keeping

- Cloud physical constants [H16 p.32]: Hess et al. report single-scatter albedo about 1 and `sigma_t` 0.04-0.06 /m for stratus, **0.05-0.12 /m for cumulus** (550 nm). `sigma_s = sigma_t`. Our `densityScale`/`lightDensityScale` can be sanity-checked against these.
- Coloured media: H16 p.14-16 shows that coloured scattering with density gives blue-edge, red-core behaviour in dense media (the same as sunset sky colour). Our clouds have a white albedo-1 medium, which is right, but the wavelength-dependent transmittance in the sun path is what supplies the redness.
- Hö's `Absorption` and `Scattering` are colours (p.52), but his clouds are grey-white in practice.
- Hö found a tabulated Mie phase produced banding in the forward direction and oscillation from back-scatter, and reverted to HG (p.28-29, p.42). Consistent with the Jendersie advice to use a smooth fit.
- Precipitation: darken the base with a gradient on the light contribution, one droplet size (Hö p.21-22). A cheap T5 storm option.

## 8. Actionable list (cheap = hours, medium = a day or two, large = structural)

| Task | Item | Source | Size |
| --- | --- | --- | --- |
| **C1 sunset** | Check the **sun:ambient luminance ratio** at 2-5 deg against the 4-6:1 photo target, before changing any term | photo spec; H16 p.27 | cheap |
| C1 | **Elevation-dependent body light (the main fix)**: scale the sun share of `ms` and `deep` by `mix(0.05, 1, saturate(sin(elev)/0.5))` and feed the env pair instead as the sun drops (code in section 1b) | B08 p.5, p.7; ours | cheap |
| C1 | Sun colour is already physical (`sunRadianceAt`). Reference values to check it against: Tr_horizon (0.05, 0.004, 4e-5), Tr_zenith (0.925, 0.861, 0.755) | H16 p.27 | cheap |
| C1 | **Evaluate the sun transmittance per altitude**: today one value at the volume centre. Sample `sunRadianceAt` at cloud base and top, mix by `h`. Gives pink high cloud and dark low cloud (calc table in 1.2) | calc; march.wgsl.ts:270 | cheap |
| C1 | Desaturate and size-limit the phase-less `ms` glow: `mix(sunRadiance, lum * skyTint, 1 - exp(-tau))`, and re-check `glowBoost` 12 against ambient | our code; H16 p.35 idea | cheap |
| C1 | Ambient = sky colour, desaturate knob, scale in [0, 1], gradient bias [a, 1] or separate top/bottom probe samples. Combine with the RDR2 sun-weighted reduced sky | H16 p.35-36; rdr2 S36 | medium |
| C1 | Check `ambientDown` colour at dusk: warm brown-pink from ground and low glow, not sky blue (B08 "brown one below"). Ground-cloud interreflection is future work there | B08 p.7-8 | cheap |
| C1 | Add the **ozone term** to any analytic sky so dusk goes indigo, not yellow | H16 p.20 | cheap |
| C1 | Earth shadow so low layers go dark before high ones (H16 does not have it) | H16 p.21; rdr2 S61 | medium |
| C1 | Targets for eyeballing: Hö Fig. 7.4 (backlit golden rims, dark brown-grey bodies); H16 Figs. 47-48 (slate and neutral). Not for colour numbers | Hö p.39; H16 p.47 | n/a |
| **C2 horizon** | Eq. 21 transmittance-weighted front depth, one AP lookup applied to the cloud result (rdr2 and H16 agree) | H16 p.43 | medium |
| C2 | **Eq. 22**: render clouds over black, then `L_AP = L_AP * Tr_cloud + L_cloud` so the haze under a deck darkens. Needs a cloud-coverage buffer the sky pass can read | H16 p.43-44 | medium |
| C2 | Colour height fog from the LUT's horizon luminance so fog matches sky | H16 p.22 | cheap |
| C2 | Constant step count with step = min(atmosphere depth, cut-off) / steps; near clouds are finer automatically | Hö p.24 | cheap (check ours) |
| **9-E cirrus** | Nothing new. Use NE p.65 and RDR2 S64 | none | n/a |
| **10 shadows** | Cloud shadow map as a **2D transmittance texture projected flat** around the camera, also fed to GI | H16 p.42 | medium |
| 10 | Four sun samples at exponentially growing step: nothing to add, ours is richer | H16 p.36 | n/a |
| 10 | Precompute the in-cloud shadow only when the sun moves (our light grid does) | Hö p.41 | n/a |
| **9-C3 cost** | Energy-conserving per-step integral also on the ms/deep terms; 21 samples suffice (reference 512) | H16 p.38-39 | cheap |
| 9-C3 | History-based empty-sky skip: previous transmittance = 1 skips the march, forced re-march next frame, checkerboard tiles | Hö p.34-35 | medium |
| 9-C3 | EMA alpha 5% with a raised step count where history is invalid | Hö p.32 | cheap |
| 9-C3 | Rebuild any sky/AP LUT over about 19 frames, lerping the last two | H16 p.22 | cheap |
| 9-C3 | Quarter-res secondary views (reflection, 0.14-0.2 ms vs 0.9-1.6) | H16 p.45 | cheap |
| **T1** (cumulus under veil) | Nothing here | none | n/a |
| **T3** (valley sea) | Nothing here | none | n/a |
| **T4** (sunset bands) | C1 items above, especially per-altitude sun transmittance (bands at different heights get different colours) | calc | medium |
| **T5** (storm) | Precipitation base darkening gradient; dense cloud over black with Eq. 22 for the dark haze under it (H16 Fig. 41) | Hö p.21; H16 p.44 | cheap |
| **T7** (time of day) | The transmittance table and the ozone term give a time-of-day colour sweep from one physical function | H16 p.27 | medium |
| T2, T6 | Nothing | none | n/a |

## Caveats

- H16 does not say the sun colour reaching cloud samples is altitude-dependent. The per-altitude proposal is **ours**, supported by the calc table.
- B08 has no sunset images and no colour values; the `mu_L` argument is derived from its transport function, not tested by the authors at low sun. The MU_FLOOR/MU_KNEE/K_ENV constants are **ours**.
- B08 tables A, B1, B2, C, D, X, P are not in the text; do not promise a port of the full model.
- No numeric a, b, c, g0, g1, w values are in the course notes.
- Y14 here is the deck (44 slides). The paper's sky-light and ambient terms are not in it.
- Calc table: Rayleigh + ozone with 8 km scale height, Mie with 1.2 km and sigma_s = 2e-6 (extinction 1.11x), spherical Earth. Its sea-level horizon value is (0.085, 0.0042, 6e-5) versus Frostbite's (0.0499, 0.004, 4.1e-5) because their Mie coefficient is higher; zenith matches within 1.5%.
