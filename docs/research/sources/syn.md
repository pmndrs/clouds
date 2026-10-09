# Synthesizing Realistic Clouds for Video Games (Schneider, Decima/Guerrilla; slide footer "Light and Color in Nature and Art, 2024")
Local: `artifacts/research/nubis/Schneider - Synthesizing Realistic Clouds for Video Games.pptx` (83 slides) · Dump: `artifacts/research/extracted/syn/pptx/` · Code: `extracted/syn/code/` · Tags: shape detail light perf · Status: 🟦 note written, 🟩 code transcribed (6 listings, all slide text; no code is inside an image)

Older partial notes this replaces as the reference: `artifacts/research/nubis-src/notes-synthesizing.md` (local), `docs/research/nubis-sources.md` (cites this deck as SY). Those got the maths right; I re-checked every formula against the slide text and found no transcription errors. What they lacked, and this note adds: the physical argument spelled out as design rules, what each noise-mix term does numerically, the figure index, and a runtime cross-check by line.

## In one paragraph
A general-audience talk (83 slides, 8 embedded videos) on the Nubis system as shipped in Horizon Forbidden West. It carries three things nothing else gives in one place. (1) A short physical-behaviour argument for why detail is billowy where density grows and wispy where it shrinks, which becomes a single noise blend. (2) The **exact shipped up-rez function** `GetUprezzedVoxelCloudDensity` [s12], whose every line our voxel path already ports. (3) The light-volume formulas (inner glow, ambient, lightning) as one-liners, plus the SDF-march cost ladder. There is no authoring workflow, no noise recipe, no weather map and no height-gradient content; for those see N3 and the older decks.

## The physical rules and how each becomes code (the part to reuse)
Method the author uses everywhere [s16]: observe, thought-experiment, define a behaviour as a rule of "no more than two variables", encode as maths. Applied to shape:

| Observation / rule [slide] | Encoded as | Where |
| --- | --- | --- |
| Vapour rising into colder air is pushed back; the billows are vapour punching through weak spots in that squeezing force [s25]. Looking at the time-lapse upside down (like milk poured into water) makes the pressure fight visible [s24]. | Where density is **increasing** (growth fronts, tops): layered **billows**, round cells | Billowy noise channels B, A of the 3D noise [s31, s12] |
| Invert it: surrounding air billows into the vapour as it evaporates, giving a scalloped, curly, layered wisp [s26]. | Where density is **decreasing** (undersides, evaporating edges): **curly layered wisps** | Wispy noise channels R, G ("Curly-Alligator") [s31, s12] |
| Turbulence adds web-like distortion on top of either [s27] | Curl is baked into the Curly-Alligator channels (see `nubis-sources.md` sec. 2); no runtime warp in this talk | noise texture |
| Summary rule [s28]: "Decreasing Density = Curly Layered Wisps; Increasing Density = Layered Billows" | `Noise = Interpolate(Wispy, Billowy, DetailType)` [s38] | NVDF `detail type` field, painted wispy toward undersides (red channel) [s37] |
| Wispy is literally the inverted billowy noise ("yin-yang") [s31] | Two textures of the same family, one inverted | noise generator (not described here) |
| The cloud body is a smooth density gradient, high inside, zero at the boundary; detail is "mapped" onto that gradient [s33] | **Erosion**: shift where the gradient ends with a remap, per-voxel using the noise as the lower bound [s34-35] | `Remap(P, noise, 1, 0, 1)` |
| Undersides should be soft [s40] | A third field, `density scale`, multiplies the result | NVDF `density scale` |

The whole chain in one line [s41]: `Density = Remap(DimensionalProfile, Interpolate(Wispy, Billowy, DetailType), 1.0, 0.0, DensityScale)`.

### What the erosion actually does (derived, not stated on the slides)
- The shipped `ValueErosion(P, n)` is `sat((P - n) / (1 - n))` (our `common.wgsl.ts:11-13`; the slide only names the function, the maths is confirmed by the pack's `VoxelCloudSampler.cg`, per `nubis-sources.md`). It is `Remap(P, n, 1, 0, 1)` of [s35]. The cloud surface sits where `P = n`: a noise value of 0.12 pulls the visible edge in to the P = 0.12 contour; the slope there is `1/(1-n)`, so a higher n both moves the edge inward and steepens it.
- The profile in the author's own cross-section is a **plateau, not a peak** [s35 image35, s60]: roughly flat interior (screen grey about 0.8, not calibrated), a feathered rim, and a sharper vertical ramp at the base. So all visible shape comes from the rim band and from noise values that exceed the plateau only in dips. This is why the rim width of the profile (the SDF/gradient thickness of the NVDF) sets billow depth.
- **Frequency is chosen by depth in the profile**: wispy = `lerp(noise.r, noise.g, P)` and billowy = `lerp(noise.b*0.3, noise.a*0.3, P^0.25)` [s12]. R and B are the low-frequency channels, G and A the high-frequency ones (`nubis-sources.md`). So at the very rim (P near 0) erosion uses the **large-scale** channel and deeper in it uses the **fine** channel; `P^0.25` makes the billowy switch happen very early (P = 0.1 already gives 0.56 of the way to the fine channel). Reading: coarse scalloping on the outermost skin, fine pitting inside. This is a depth-dependent octave choice with a single texture fetch.
- The **0.3 factor** on billowy noise (mean B/A about 100/255 per the pack, so effective mean about 0.12) puts its erosion threshold near the wispy mean (R/G mean about 32/255 = 0.125) but with about a third of the contrast: billowy dents are shallow and round, wispy ones deep and ragged. The type blend therefore changes *roughness*, not average thickness. (Inference from the channel means in `nubis-sources.md`.)
- **Density scale is `pow(sat(scale), 4)`**, then the result is sharpened with `pow(d, lerp(0.3, 0.6, powered_scale))` [s12]. Example: d = 0.5 at scale 1 gives 0.5^0.6 = 0.66; at scale^4 = 0.1 the density is 0.05 and goes through exponent about 0.33, giving about 0.37. Thin regions are therefore lifted toward mid-density instead of vanishing (a soft translucent fringe), and the exponent below 1 flattens contrast overall. The comment on that line says "lower Density close to camera"; the lowering is the second `pow` below, not this one.
- **Near the camera (under 150 m, `inHFDetails`)** [s12]: no extra texture fetch. The highest-frequency channels are *folded*: `f(x) = abs(abs(2x-1)*2-1)` is a double triangle wave, so it creates sharp creases and doubles the apparent frequency. Wispy side `1 - f(n.g)^4`, billowy side `f(n.a)^2`, blended by type, replaces the composite with weight 90% at 50 m, falling to 0% at 150 m (`lerp(hhf, composite, remap(dist, 50, 150, 0.9, 1.0))`). Then `pow(d, lerp(0.5, 1.0, f)) * lerp(0.666, 1.0, f)` with `f = (dist - 50) / 100` clamped: **closer clouds get a lower exponent** (denser, softer) and a lower multiplier, "to add details and reduce undersampling noise" per the comment.
- Noise is sampled at `position * 0.01` after a **horizontal-only** wind offset [s12]: one noise tile = 100 world units; pseudo-motion by scrolling the noise, not the profile. The mip is chosen by ray distance (`GetVoxelCloudMipLevel`, formula not shown).
- The slide comment "blend to wispy as the density scale decreases" does not match the code (`inType` is used, not the density scale). Trust the code.

## Key ideas (bullets with slides)
- Bake math into textures, but balance against texture bandwidth [s13-14]. Their example: `y = 1 - y` and `x = exp(-x)` combine into one 2D LUT; a 4-channel 3D texture can hold up to about 12 dimensions of function [s13]. The HG phase is a 2-variable function the author wishes they had baked [s51].
- Physical correctness is not the goal; approximate the **signature features** [s15]. For lighting the signatures are: bright crevasses and dark edges with the sun behind the viewer [s43], inner glow when backlit and silver lining at the edge [s44], blue and grey ambient from the sky and neighbouring clouds, pastel gradients at sunset [s67].
- Film origin: the dimensional profile comes from the author's Blue Sky fluid solver (Rio, SIGGRAPH 2011), stored as a stack of height slices; one film frame took hours on the CPU [s18-19]. The real-time answer is a **low-resolution profile plus per-voxel detail descriptors**: "compressing clouds down to their presence and a few descriptors" [s20-21].
- NVDF stack as shown: Dimensional Profile, Detail Type, Density Scale; annotation "512 x 512 x 64, BC6, 1 Byte / Texel, 16.777 Mb" [s21, 37, 40]. 512*512*64 = 16,777,216, so one byte per texel is one 16.8 MB texture's worth; whether the three fields are separate or packed into one BC6H RGB texture is not stated.
- A distance field `GetVoxelCloudDistance` is used for the in-scatter relaxation and for the ray march [s64, s78]; it is not one of the three NVDFs on [s21].
- Sample placement: sphere trace on the SDF through empty space, then widen steps with distance once inside; "hundreds" of samples where uniform stepping needs thousands [s78].

## Formulas and constants (exact)
| What | Value | Slide |
| --- | --- | --- |
| Transmittance | `T = exp(-d)`, d = density summed along the ray | s48-49 |
| HG | `(1-g^2) * rsqrt(1+g^2-2g cos)^3 / (4 pi)`; cloud eccentricity "of .2" (notes; no value on the slide); several lobes of different g are combined for an art-directed silver lining, weights not given | s51-52 |
| Light energy | direct (attenuation + multiple scatter + phase) + ambient + secondary | s46, s73 |
| In-scatter light volume | `light_volume = P * exp(-sunSummedDensity * Remap(sun_dot, 0, 0.9, 0.25, Remap(cloud_distance, -128, 0, 0.05, 0.25)))` | s64 |
| Ambient | `(1 - P) * exp(-summed_ambient_density)`; density summed from above ("how much of the cloud is visible from above") | s68 |
| Lightning | `pow(1 - d1/radius, 12) * (1 - saturate(density*5))` | s71 |
| Accumulation | front to back, density used directly as opacity | s79 |
| Cost (ms): ground | cloud 10 / 6.1 / 2.2 for base / + voxel lighting / + adaptive SDF march; geometry 7 | s80 |
| Cost (ms): flying through | cloud 10 / 8.0 / 4.0; geometry 4. Cloud + geometry under 10 ms for any view | s81 |
| Noise tile and scroll | `pos * 0.01`; wind `float3(wind.xy, 0) * voxel_cloud_animation_speed` | s12 |

Lighting reading of [s64] (exact, brief): the Beer exponent multiplier is 0.25 when `sun_dot <= 0` (sun behind or beside the viewer: dark edges and crevasses), relaxing toward `Remap(cloud_distance, -128, 0, 0.05, 0.25)` as `sun_dot` goes 0 to 0.9 (looking toward the sun): at the surface it stays 0.25, 128 or more deep it drops to 0.05, giving the inner glow. `sun_dot` is not defined on the slide (view vs sun direction; sign convention open). The author says the more correct form would modulate HG by the profile field, under development [s60]. There is **no powder term** in this talk.

## Code listings (slide → local file in `extracted/syn/code/`)
| Slide | File | What it does |
| --- | --- | --- |
| s12 | `syn-s12.hlsl` | `GetUprezzedVoxelCloudDensity`: wind offset, noise fetch, wispy/billowy composite by profile and type, near-camera folded HF noise, `ValueErosion`, density-scale power 4, sharpen and near-camera softening. The full shipped up-rez. 43 lines. |
| s51 | `syn-s51.hlsl` | `HenyeyGreenstein(cos, g)` with `rsqrt`. |
| s64 | `syn-s64.hlsl` | The inner-glow light volume (3 lines). |
| s68 | `syn-s68.hlsl` | Ambient scattering from the inverted profile (1 line). |
| s71 | `syn-s71.hlsl` | Lightning potential energy, pseudo attenuation, glow energy (3 lines). Slide labels: d1 = sample-to-light distance, radius. |
| s79 | `syn-s79.hlsl` | Front-to-back accumulation of light intensity and absorption, and the colour/alpha output. Slide quirk: `float3 color = float4(...)` does not compile; pseudo-code. |

Slide-image check: nothing here is code-in-image. Images on code slides are logos or the template (image3), and the diagram slides [s13, s34, s35, s41, s48, s60] are vector text. Unreadable: the 10 `.wdp` (JPEG XR) images (hdphoto1-10; `sips` writes nothing). They sit on s3, 5, 6, 21, 30, 33, 37, 40, 54, 58, 59, 60 and are template backgrounds or photographs; the matching PNG/JPEG figures listed below carry the same content. The 8 videos are not extracted: s7 (HFW montage), s18 (film sim), s23-24 (time-lapse), s27 (time-lapse), s32 (sim of the profile), s72 (lightning), s74 (cloudscape time-lapse), s82 (storm flight).

## Figures that explain shape (for the topic-guide author)
Pull from `extracted/syn/pptx/media/`; image numbers in parentheses.
- **s31** (image32.jpg, image33.jpg): one slice of the baked noise. image32 = billowy ("Alligator"): bright round cells, thin dark seams. image33 = wispy ("Curly-Alligator"): crumpled, curly ridges with dark pits. The clearest statement of the two regimes.
- **s29-30** (image30.png, image31.png): "Perlin-Worley" 3D noise slice and the baked cube (a soft cloud blob in a bounding box).
- **s21, 37, 40** (image22.jpg render; image38.png blue = dimensional profile; image25.jpg red = detail type; image24.jpg green = density scale): the NVDF channels over one cumulus. Detail type and density scale are both concentrated in the flat **base** of the cloud and fade up the body; the profile is a soft halo around a flat core.
- **s33, 60** (image35.png): a cross-section of the profile: grey plateau, feathered rim, abrupt base. Best figure for "what is being eroded".
- **s22** (image26.png vs image27.png): the profile rendered (soft) versus the up-rezzed result: same cloud, with and without detail.
- **s36** (image36.png, image37.png): erosion with wispy noise (small ragged clouds, sky photo look) versus billowy (a dense lumpy cumulus close-up). I matched them by appearance; file order was not verified.
- **s39** (image39/40/41.png): one cloud with wispy only, billowy only, and the interpolation over detail type. The order in the pptx rels is not verified; image41 shows the raggedest fringe at the lower right and is probably the interpolated result.
- **s23-28** (image28.png, image29.png and videos): cumulus time-lapse photographs; observation material for billow cells, upside-down pressure reading and web-like turbulence.
- **s34-35, 41** are vector diagrams of a 1D profile edge being remapped (constant 0.5 versus noise): no file; recreate from the slide text.
- Lighting, if wanted: s43-44 (image43/44), s54-59 (crystal growths and bubbles as in-scatter analogies), s65-66 (images 70-73: with and without the in-scatter approximation, sun in front and behind), s69-70 (images 75-78: ambient on/off, directional ambient).

## What we already do / what we don't / what to try
Our voxel path is a line-for-line port of [s12] from the shipped Decima source (`packages/runtime/src/shaders/density.wgsl.ts`; its own header says so). Cross-check against the slide:
- Wind offset (horizontal only), noise at `pos * 0.01`, distance mip: `density.wgsl.ts:48-49`, `volume.wgsl.ts:85-86` (`noiseScale = 0.01`). The mip is `log2(1 + |d k|) + baseMip`, which is where the slide's `GetVoxelCloudMipLevel` hides.
- Wispy/billowy mix, 0.3 and `P^0.25`: `density.wgsl.ts:51-53`; test-side copy `reference/density.ts:124-126`.
- Folded HF noise, the 0.9..1.0 blend over 50..150 m: `density.wgsl.ts:55-61` (`tg2*tg2` = the `^4`, `ta*ta` = the `^2`).
- `ValueErosion`, `ValueRemap`, `GetFractionFromValue`: `common.wgsl.ts:7-16`.
- Density scale to the 4th, sharpening exponent 0.3..0.6, near-camera `pow`/multiplier: `density.wgsl.ts:66-73`. **We add** `valueRemap(rayDistance, 10, 120, 0.25, 1)` at `:75`, which is in the shipped sampler per `nubis-sources.md` but not on this slide, and two art knobs not in the talk: `wispyBias` (`:42`, type pushed wispy toward the base, after [s37]) and `detailBias` (`:64`, deeper erosion).
- In-scatter relax `Remap(sdf, -128, 0, 0.05, 0.25)` and 0.25 away from the sun: `lighting.wgsl.ts:58`; the profile as probability with `exp(-tau relax)`: `:59` (we also multiply by `1 + glowBoost * sunRelax` and a micro occlusion, which the talk does not have); ambient `(1 - P)`: `:65` (square-root form with a floor, an N3/P3-F variant); HG: `:21-24`; lightning `pow(1 - d/r, 12) * (1 - sat(rho*5))`: `shaders/march.wgsl.ts:55, 64`; dark edges: `lighting.wgsl.ts:136-138` (our own device; the talk gets edge darkening from the relax term alone). The slide has no powder term; ours exists only in the octave model (`:122`).
- Accumulation [s79] is linear-opacity; ours uses transmittance per step (`march.wgsl.ts:250`), the physically cleaner form, so this slide is a simplification, not something to port.
- Type field: `import/pack-fit.ts:29-33` (wispy at the base, billowy above, a little more wispy deeper) and `generate/passes.ts:496` (species flip height from NE p.99) feed the type; consistent with [s37].

**Not in our procedural path (`procedural/density.wgsl.ts`), which is where the shape gap is:**
- Takram shaper `:218-224`: one detail erosion from a single channel, with the wispy/billowy switch a fixed function of height (`remap(hf, 0.2, 0.4)`). [s28] says the switch should follow *growth versus decay*, not just height; a cloud's undersides and its evaporating lee edges are wispy, its updraft fronts billowy. Height is a proxy.
- Neither procedural shaper picks the noise **octave by depth in the profile** the way [s12] does (`lerp(low, high, P)`); Takram's coarse density `coarse` (`:216`, "the dimensional profile") is exactly the quantity to drive it.
- No folded near-camera detail (`:218-224` fetches a second 3D texture for detail instead; [s12] gets it from one fetch).
- No `density scale` field or the `pow(d, 0.3..0.6)` compression; Takram just multiplies `tkDensity * profile` (`:226`).

### Try next (shape, layering, detail; ranked)
1. **Depth-dependent noise octave in the procedural erosion.** Replace the single-channel erosion by `lerp(lowFreq, highFreq, coarse^0.25)` for the billowy side and `lerp(lowFreq, highFreq, coarse)` for the wispy side [s12], with `coarse` already available as `o.coarse` (`procedural/density.wgsl.ts:216`). Cheap (same fetch if the shape texture's four channels are used) and attacks "flat, uniform detail" directly.
2. **Drive wispy versus billowy from growth/decay, not height.** A procedural proxy for `dDensity/dt`: the sign of the coarse-density gradient along the wind or updraft, or coverage tendency from the weather map, blended into the `remap(hf, 0.2, 0.4)` switch at `procedural/density.wgsl.ts:221`. Rule: growing, rising, upwind face = billowy; decaying, under-side, lee = wispy [s28].
3. **Folded high-frequency detail for the near field, from one fetch.** Use `abs(abs(2x-1)*2-1)` of the finest channel with the `^4`/`^2` exponents and the 50..150 m blend [s12] instead of the second detail texture at `procedural/density.wgsl.ts:218-224`; crisp creases at the price of ALU only.
4. **Scale the billowy channel to about 0.3 of the wispy erosion and keep them separate.** Our single erosion amount makes billows as deep as wisps. The 0.3 asymmetry [s12] is what makes cumulus cells shallow and round while wisps cut deep; tune `tkShape` per type rather than per layer.
5. **A density-scale field with the `pow(scale, 4)` and `pow(d, 0.3..0.6)` pair.** Gives soft translucent undersides and fringes without lowering the core [s12, s40]. In the procedural path this could be a function of height-from-base and of the erosion depth, replacing the linear `tkLinear`/`tkExpTerm` profile as the only softening.

### Open questions
- Whether `detail type` red in the NVDF figures [s37] means type = 0 (wispy) or is displayed inverted: the talk says red marks the wispy undersides, but the shader's `lerp(wispy, billowy, type)` makes type 1 billowy, so either the image shows `1 - type` or the field is packed inverted. Our packer assumes low = wispy (`pack-fit.ts:29`), consistent with the shader.
- `sun_dot` sign convention and clamping in [s64]; whether `inSunLightSummedDensitySamples` comes from a march or the voxel light volume (the cost ladder [s80] suggests the volume).
- BC6H packing of the three NVDFs; HG lobe weights; ambient directionality [s70] (not shown).

## Superseded by / supersedes
- Same up-rez as N3 s91-109 (the 2023 talk); this deck is the short public form and adds the light-volume one-liners and the cost ladder. For anything noise-generation or authoring see N3 and `nubis_noise_generator` (`noise`). The in-scatter model here is the one N3 s116-125 explains at length.
- No contradiction with `nubis-sources.md`, `hzd-nubis-evolved.md` or `procedural-shape.md` on any number I checked. One correction to `notes-synthesizing.md` (local): its sec. 4 says "billowy erodes less" for the 0.3 scale, which holds, but the effective mean thresholds of the two families are about equal (about 0.12 each); the difference is contrast.
