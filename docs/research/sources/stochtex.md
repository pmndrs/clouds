# Filtering After Shading With Stochastic Texture Filtering (Pharr, Wronski, Salvi, Fajardo; NVIDIA; ACM CGIT 7(1), May 2024)
Local: `artifacts/research/stochtex.pdf` (29 pp: 20 main, 9 supplement), text dump and equation/listing transcription in `artifacts/research/extracted/stochtex/` (`stochtex.txt`, `algorithms.md`) · Tags: texture filtering stochastic volume cloud magnification nonlinearity · Status: note written, full text read, all figures on the cloud and volume pages viewed as images, listings transcribed

## In one paragraph
The usual rule is "filter the texture, then shade": a filtered lookup of a parameter (normal, metalness, temperature, density) is fed into the lighting. The paper argues that is wrong whenever the parameter enters the shading non-linearly, because the average of the inputs is not the same as the average of the outputs. Filter-after-shading means computing the shade at each texel (or at many sample points) and averaging the shaded results. Doing that naively costs 4 (bilinear), 8 (trilinear), 16 (bicubic 2D) or 64 (tricubic 3D) texel reads plus as many shading evaluations. Stochastic texture filtering (STF) does it with one read: for each sample, pick a single texel at random with probability equal to its filter weight, shade that texel, and let the sample average do the rest. The result is unbiased, but each pixel is noisy; the paper removes the noise with a temporal accumulator (NVIDIA DLSS) or with many samples per pixel offline. For a cloud, the example is this: a 3D density grid, a ray march that asks for density at each step, and a tricubic filter that wants 64 voxel reads per step; STF asks for one voxel per step, and the random choice of voxel is smoothed out over the frame. The paper says a path-traced cloud converges to the same image with either order, because density enters the estimator linearly; the paper does not analyse the `exp(-sigma dt)` form that a ray marcher uses.

## Key claims and results
- Filtering after shading is "more accurate" for non-affine shading terms: normal maps (Fig 2, p.6), discrete metalness (p.7), Planck emission from a temperature grid (Fig 4, p.8). Affine terms (diffuse albedo, linear terms) give the same answer either way (p.5-6).
- Stochastic filtering gives an unbiased estimate of the filter-after-shading integral with one texel read per sample (Eq 13, p.8). Weighted sums of texels are sampled with probability equal to the weight (Eq 5, p.5).
- Real-time (Falcor, RTX 4090, 4K, DLSS with a 32-sample Halton jitter, STBN masks as random source, Disney BRDF, one directional light). Stochastic bilinear and bicubic at 1 spp plus DLSS, compared against 1024 spp (Figs 9, 10, 12). DLSS resolves STF noise; "no objectionable noise or flicker" for Mitchell and Gaussian (p.13).
- Compressed textures: a DCT block format (16x for 8-bit data, 6 coefficients per channel) decoded per texel. Stochastic trilinear 1.66 ms to 0.57 ms, 2.9x; combined with stochastic triplanar, 7.9x overall (p.15-16, Fig 14).
- Offline (pbrt-v4, RTX 4090, 1080p, 256 spp): Disney Cloud (Fig 1). Times: trilinear 43.30 s, stochastic trilinear 27.13 s (1.60x), tricubic 87.28 s, stochastic tricubic 31.51 s (2.77x) (p.2).
- Error: "less than a 5% increase in mean squared error" from the stochastic filters on the cloud (p.16). The paper says this is "far less than the error from Monte Carlo path tracing" (p.16).
- Noise ablation (Fig 15, p.16): white noise is visibly distracting, STBN is much less so, DLSS removes most of either, and DLSS + STBN is "almost imperceptible." Ablation is done at extreme zoom on high contrast.
- Limits the paper names itself: DLSS was not trained on STF inputs (p.17); flicker and ghosting remain in high-contrast checkerboards (p.13-14); STF plus MIP maps is a hybrid, not pure filter-after-shading (p.11).

## Volumes and clouds (everything the paper says)
- **Dataset.** Disney Cloud (Walt Disney Animation Studios 2017 data set). OpenVDB was converted to NanoVDB for GPU use, and the **8x down-sampled** version was used "in order to make the visual difference between filters more apparent" (p.16). The paper does not give the grid dimensions or voxel size.
- **Renderer.** pbrt-v4 volumetric path tracer, delta tracking with null scattering (Kutz et al. 2017; Miller et al. 2019), ratio tracking for transmittance (Novak et al. 2014) (p.15-16). Samples per pixel = 256 for Fig 1.
- **Filters compared.** Trilinear (8 reads), tricubic (cubic B-spline, Eq 21, 64 reads), and their stochastic one-read counterparts. Tricubic is the reference "much better" result.
- **Figure 1 (p.2).** Caption: "Trilinear filtering leads to blocky artifacts... Tricubic filtering gives a much better result, but requires 64 voxel lookups..." Layout: a 4-panel render (Trilinear, Stochastic Trilinear, Tricubic, Stochastic Tricubic) of a cumulus-like cloud against blue sky, with red-boxed insets on the right. At the resolution I viewed (110 dpi page render) the blockiness is not resolvable; the difference is stated in the text, not visible in my render. The text (p.16) reports "block- and diamond-shaped artifacts" for trilinear and "not present with tricubic"; "Stochastic filtering gives images that are visually indistinguishable from traditional filtering."
- **Cost.** Tricubic "doubles rendering time since it requires 8x more texel lookups in the NanoVDB multilevel grid" (p.16). Stochastic tricubic renders faster than trilinear "with 1/8 as many texel lookups" (1 read vs 8). The text is consistent on lookup counts, but a doubled render time from 8x reads says lookups are only part of the cost (see open questions).
- **Interaction with delta/ratio tracking.** The paper says density scales the absorption and scattering coefficients; "since those make affine contributions to the estimated radiance values, both filtering approaches converge to the same result" (p.15-16). That is the paper's whole volume argument: in a path tracer's estimator, density enters linearly, so filter order does not change the expectation. The stochastic filter's variance is then the only difference.
- **Volume non-linearity (Fig 4, p.8).** A flame/smoke volume where the grid stores temperature and emission comes from Planck's law. (a) filter then Planck, (b) Planck then filter, (c) minification with MIP maps and filter-before-shading (visibly wrong), (d) minification with filter-after-shading and no MIP maps (preserved). This is the only volume non-linearity in the paper. It is emission, not density.
- **Magnification evidence.** The volume test is a magnification test by construction: the 8x down-sampled grid means one voxel covers many pixels, and that is exactly where trilinear's blockiness shows. The paper does not say so explicitly. Its magnification evidence in 2D is Fig 10 (bilinear vs stochastic Mitchell vs Gaussian) and Fig 12 (checkerboard, magnified and minified insets). There is no 3D magnification figure beyond Fig 1.
- **Related volume work in the paper.** Hofmann et al. 2021 (sparse volumes; stochastic trilinear, jitter + nearest, p.9 footnote 2) and Museth 2013 (VDB, multi-level sparse grids as a case where one-read filtering helps; p.2). Yu and Turk 2013 (anisotropic kernels for particle fluids; "volumes" in the future-work list, p.17).

## Nonlinearity section (what it argues, and what it does not cover)
Paper, Sec 3.1 (p.6-7) and Sec 3.2 (p.7-8), S-1:2 to S-1:4:
- Normal maps: linear filtering of normals gives wrong shading at grazing angles (Olano and Baker 2010 LEAN mapping, Fig 2).
- Metalness: discrete 0/1 values; filtering gives unphysical in-between values. Filter-after-shading only evaluates 0 or 1 (p.7).
- sRGB / encoded values: must be linearised before filtering (Microsoft D3D11.3 spec, cited p.6).
- Shadow maps: PCF filters the visibility, not the depth (Reeves et al. 1987; p.6).
- Planck emission from temperature (Fig 4; the volume example above).
- Tone mapping, post-AA, and the nonlinearity-introduced aliasing (S-1:2-4, Eq 22-24): a nonlinearity creates harmonics; sampling below 2x the new bandwidth aliases. Magnification moves the nonlinearity to lower resolution, so aliasing increases; minification reduces aliasing.

**Density -> transmittance (exp).** Not discussed. The only density argument is the affine one above, which concerns the path tracer's estimator. There is no statement about `exp(-sigma dt)`, about a ray marcher integrating density analytically, or about remapping functions (the Nubis-style density shaping, smoothstep, or coverage remaps). The paper's general principle applies in principle: any non-affine function of the filtered parameter is a candidate for filter-before-shading error. Our reading, not the paper's: a single fixed affine remap of density is safe; a nonlinearity applied to density before the tap (exp, smoothstep, power, cubic shaping) is not covered by the paper's argument.

## Magnification (what matters for an 8 m voxel grid viewed up close)
- The paper's position (Sec 3.2, p.7-8; Sec 6, p.16-17): filter-after-shading "reduces aliasing" under minification, and under magnification it can make things worse. "If the magnification factors are large, rendering is highly nonlinear, and textures contain high-frequency content, stochastic magnification can yield subjectively poorer results." The recommended fix is "maintaining a close 1-to-1 texel-to-pixel ratio and limiting magnification factors."
- The paper's magnification figure, 2D: bilinear shows "diamond-like artifacts and over-blurring" (p.13); stochastic Mitchell is "much sharper than the bilinear and does not produce diamond-like artifacts"; stochastic Gaussian "tends to blur textures, it gives the best results for reconstruction of diagonal lines" (Fig 10 caption, p.13).
- Single-tap cost: the stochastic filter in one fetch gives a sharp-looking result at 1 spp only after temporal accumulation. Without it, each pixel is a single voxel value (blocky per sample, noisy per pixel).
- Negative-lobed filters (the Mitchell-type cubic, Eq 19 with a = -0.5) need positivization, which costs 2 reads per sample (Listing 5, p.13). The cubic B-spline (Eq 21) is non-negative and needs no positivization.
- The paper's own volume case is a delta-tracked path tracer with 256 spp. It does not test a deterministic fixed-step ray marcher with one stochastic tap per step. That is the case we would hit.

## Limitations, and when it is worse
- Noise: STF adds per-sample variance. Real-time needs spatiotemporal reconstruction (DLSS in the paper; the paper does not test TAA or other denoisers). Offline needs "moderate" spp (p.1, p.17).
- Temporal artefacts: sporadic ghosting and flicker, mostly in motion and high-contrast patterns (p.13-14, p.17).
- MIP maps: stochastic filtering with MIP maps is a hybrid because the MIP levels are prefiltered (p.11). The paper's fix is a negative LOD bias, higher anisotropy, appearance-driven MIPs (Hasselgren et al. 2021), or no MIP at all (the latter costs memory bandwidth).
- Derivatives: the screen-space jitter model needs a footprint estimate (ellipse from UV gradients, Listing 8). Anisotropy capped at 64 (the paper's choice; hardware caps at 16). Any derivative error goes straight into the LOD.
- Magnification with high-frequency content and strong nonlinearity: the paper says this is subjectively worse (p.16-17).
- No hardware benefit on standard formats when magnifying: "We do not expect stochastic texture filtering to provide performance benefits with those formats when magnifying textures" (p.12-13). Its benefit is for custom formats (compressed blocks, sparse grids, neural representations) where hardware filtering is not available.
- Texture change: changing filter order changes the look of existing assets, so "an art review" may be needed (p.16).
- Filter negative lobes: positivization doubles cost.

## Implementation details
- **Random source.** Real-time: spatio-temporal blue noise (STBN, Wolfe et al. 2022) for the filter's random number, DLSS's 32-sample Halton jitter for screen-space. The paper does not give the per-pixel, per-frame indexing scheme. Offline: not stated (pbrt's sampler presumably).
- **Sample reuse.** Eq 6 (p.5): after one decision, the leftover `xi'` drives the next. Blue noise is preserved across dimensions this way (Georgiev and Fajardo 2016, p.5).
- **One-fetch trilinear, the "uv jitter" trick.** The paper's Sec 4.2, footnote 2 (p.9-10): independent uniform jitter per axis, then nearest-neighbour lookup, is FIS of a box convolved with a box, which gives the tent (linear) interpolant. In code, per axis: `i = floor(p + xi)` with `xi` uniform in [0,1), and the second and third axes reuse the rescaled `xi` (Listing 1 and S.1 Eq 16; `algorithms.md` section 10 and 7). Equivalent: jitter by `xi - 1/2` and round.
- **Tricubic in one fetch.** Listing 3 (S-1:5-6): weighted reservoir sampling per axis with the four cubic B-spline weights `(1/6)(-t^3+3t^2-3t+1)`, `(1/6)(3t^3-6t^2+4)`, `(1/6)(-3t^3+3t^2+3t+1)`, `t^3/6`, one shared `u`, one voxel index out.
- **Positivized Mitchell-type 2D** (Listing 5, S-1:7): two reservoirs, one fetch each, output `W+ * f(pos) - W- * f(neg)`.
- **Gaussian FIS** (Listing 6, S-1:8): Box-Muller, add `sigma * gauss / dims` to UV, point sample. Two random numbers per sample. Chosen over discrete sampling for small or large sigma (Fig 11, p.14).
- **Anisotropic LOD** (Listing 8, S-1:9): from UV gradients, a MIP level from the minor axis length, anisotropy capped at 64 (rescaling the minor axis), plus `(u - 0.5)` to make the level stochastic in a one-octave band.
- **Code** is transcribed in full in `artifacts/research/extracted/stochtex/algorithms.md`. Listings 1-3 and 5 are C++-like; 6-8 are HLSL. Listings 2, 6, 7 have printed typos (noted in `algorithms.md`).

## Open questions (not resolved from the paper)
1. Cost: tricubic is 8x the reads of trilinear, yet only "doubles rendering time" (p.16). What is the other half? Is it the NanoVDB multilevel traversal (the paper says lookups are in the multilevel grid), the shading, or the ray march? The paper does not break it down.
2. Stochastic tricubic in NanoVDB: is the one-read claim per voxel access, or does the multilevel grid still traverse several levels per fetch?
3. Dataset: the Disney Cloud dimensions and voxel size are not given; the 8x down-sampling factor is relative to an unstated base.
4. Density -> `exp(-sigma dt)`: no treatment. Does one stochastic tap per march step, before the exponential, add bias or only variance? Our own question; the paper's affine argument does not answer it.
5. Denoising: the paper uses DLSS only. We have no data on TAA-only or other denoisers with STF noise.
6. Mitchell kernel: the paper cites Mitchell and Netravali for `a = -0.5`, which is the Keys / Catmull-Rom cubic, not the B = C = 1/3 Mitchell filter. Which one is meant? (Listing 5 calls `MitchellCubic`, undefined.)
7. Lanczos formula: the dump garbled Eq 20's denominator. The standard `sinc(t) sinc(t/n)` is the intended form, but it is not verbatim. Check page 1:2 of the PDF before relying on it.
8. Listing 7 has undefined names and a `dist_sq`/`offset_sq` mismatch. The intent is clear, the code is not usable as printed.
9. Sec 4.1 cost: "4^n to 4n" is the reading verified on the page image (p.9).
10. The 3D magnification case, and 3D MIP-level stochastic selection, are not tested.

## What it means for us (orchestrator verdict, 2026-10-11)
Checked against our code (`packages/runtime/src/shaders/volume.wgsl.ts`, `density.wgsl.ts`, `march.wgsl.ts`) and the D1 reports. **Short answer: nothing to change for D1 parity. Keep it for the VDB / hero-brick path and the performance pass.**

How our renderer samples today:
- The NVDF (`rgba8unorm`, 8 m voxels, no mips) and the SDF use hardware trilinear, 1 tap per call.
- The noise uses hardware trilinear with a distance mip.
- The light grid (16 m cells) uses hardware trilinear.
- A tricubic B-spline option already exists for the lighting's profile and SDF reads (`profileFilter` 1/2/3) and for the light grid (`lightGridFilter`). It is the 8-tap Sigg-Hadwiger version (`cubicTaps`, `volume.wgsl.ts:67`) and is off by default. The density path (`cloudDensity` → `sampleModeling`) is always trilinear.
- Every nonlinear step runs after the filter: the erosion `valueErosion(profile, noise)`, the `pow` sharpen, `exp(-sigma ds)`, the light `exp(-tau)` and `pow(S, …)`. So we are a "filter before shading" renderer, like Decima.

Why it does not help D1:
1. **The two levers it offers were already tested in D1 and changed nothing visible.**
   - Better reconstruction of the 8 m grid: tricubic profile, SDF and light grid (`profileFilter` 3, `lightGridFilter` 1; D1.md round 5 §1c, round 6 slit, §345 ring). Unchanged.
   - Less prefiltering before the nonlinear erosion: noise mip 0, `mipDistanceScale` 0.0005 (D1.md §11/§17/§293, D1-florets §188). Unchanged.
2. **Parity means matching Decima, and Decima filters before shading with hardware trilinear** (the sampler is a line-for-line port). Filtering after the erosion would move us away from their look, not toward it.
3. **No speed gain with hardware formats when magnifying** [paper p.12-13]. Stochastic trilinear on `rgba8unorm` saves nothing. Only stochastic *tricubic* (1 tap against our 8) is cheaper, and tricubic showed no visible win.
4. **Noise risk.** The paper hides the noise with DLSS plus spatio-temporal blue noise at 1 spp. Our resolve is a mean ± σ clip that tightens under motion and wind (`temporal.wgsl.ts`). Both judges already marked a "stochastic stipple" look down (`work/calibration/d1c-judge-fable.md` Look G).
5. **Unanswered for our march.** The paper's volume argument is that density enters a *path tracer* linearly (delta/ratio tracking). We ray-march with `exp(-sigma ds)` and remap density nonlinearly first, so we have no stated error bound. Ours to measure.

Where it does fit (park for later):
- **Hero bricks and imported VDBs** (`heroPool`, `heroIndir`, direct-VDB density):
  - It removes the need for filter borders: 10³ slots per 8³ brick today, about 2× the memory.
  - It allows sparse or compressed custom formats (their DCT block format: 2.9× faster trilinear [p.15-16]).
  - It allows tricubic magnification of coarse sims at one tap. This is exactly their Disney Cloud case (Fig 1), and we ship that asset.
  - Try it when the VDB / artist-cloud work resumes.
- **Performance pass:** if a cubic read is ever wanted in the march, use stochastic tricubic (Listing 3, per-axis reservoir over the 4 B-spline weights), not 8 taps. Seed it from the existing per-pixel per-frame blue noise (`marchJitter`, `march.wgsl.ts:115`) decorrelated per step with `pcg`. Keep `cloudDistance` deterministic: it is the step bound.
- **Upscaler (FSR3 later):** works with it in principle; the upscaler is the temporal integrator. Test under wind and camera motion before trusting it.
- **Follow-up paper:** Wronski, Pharr, Akenine-Möller 2025, "STF sample reuse" (https://research.nvidia.com/labs/rtr/publication/wronski2025stfreuse/stf_sample_reuse.pdf). It shares texels between neighbouring pixels under magnification and claims more than 10 dB over 1-sample STF there. Read it before any magnification work.

**Not yet read:** the two Shadertoys the owner pointed at (https://www.shadertoy.com/view/clXXDs, https://www.shadertoy.com/view/MfyXzV). The built-in browser hit a Cloudflare check. Add their notes here once the code is in hand.
