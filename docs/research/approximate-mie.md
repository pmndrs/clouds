# Approximate Mie phase function (Jendersie and d'Eon 2023, HG+Draine)

Sources: `artifacts/research/jendersie/` (`approximate-mie.pdf`, `approximate-mie-supplemental.pdf`, `draine.hlsl`, MIT, NVIDIA).
Numbers below marked "calc" were computed by me from the paper's formulas (Python, f64), not copied from the paper.
Droplet-size ranges marked "general knowledge" are not from the paper.

## 1. The model

Two normalised lobes mixed by a weight (paper eq. 3, 2):

```
phi(u) = (1 - wD) * HG(u, gHG) + wD * Draine(u, gD, alpha)        u = cos(theta)
HG(u, g)          = (1 - g^2) / (4 pi (1 + g^2 - 2 g u)^1.5)
Draine(u, g, a)   = (1 - g^2)(1 + a u^2) / (4 pi (1 + a (1 + 2 g^2)/3) (1 + g^2 - 2 g u)^1.5)
```

Draine reduces to HG at a = 0, Rayleigh at g = 0 and a = 1, and Cornette-Shanks at a = 1. The HG lobe carries the very narrow forward peak and the Draine lobe carries the bulk. They fit a log-space loss weighted by |cos| sin, over Mie Sim tables (eta 1.333, log-normal diameters with sigma 0.25, averaged over 400-700 nm). It matches about 95% of the energy (the forward half) and is at most about 5 error units out to d = 50 um (paper Fig. 3), versus about 12 for 2x or 3x HG.

Four parameters as functions of the mean droplet diameter d in um (large-particle fit, eq. 4-7, valid **5 <= d <= 50**):

```
gHG(d)   = exp(-0.0990567 / (d - 1.67154))
gD(d)    = exp(-2.20679   / (d + 3.91029)) - 0.428934
alpha(d) = exp( 3.62489 - 8.29288 / (d + 5.52825))
wD(d)    = exp(-0.599085  / (d - 0.641583)) - 0.665888
```

Other ranges (supplemental sec. 3), only if we want fog below 5 um: d <= 0.1 (eq. 11-14, alpha = 250), 0.1 < d < 1.5 (eq. 15-18, with log, cos, nested), 1.5 <= d < 5 (eq. 19-22: gHG = 0.0604931 ln(ln d) + 0.940256, gD = 0.500411 - 0.081287 / (-2 ln d + tan(ln d) + 1.27551), alpha = 7.30354 ln d + 6.31675, wD = 0.026914 (ln d - cos(5.68947 (ln(ln d) - 0.0292149))) + 0.376475). The large fit is singular at d = 1.67 (gHG) and d = 0.64 (wD) and gives garbage below about 3 um, so clamp d to >= 5 or switch fits. These small-range fits are weird (tan, nested log); I did not port or check them.

Not reproduced: the weak back-scatter features (glory, fogbow ripples at about 140-180 degrees; the paper says they are unobservable in most scenes). The paper also gives analytic CDF inversion for sampling; we are not path tracing, so ignore it.

## 2. Diameter choice and what it looks like (calc)

Typical effective droplet diameters (general knowledge, not in the paper): stratus and stratocumulus 8-12 um, fair-weather and continental cumulus 10-15 um, maritime or towering cumulus 15-25 um, radiation fog 5-10 um, advection fog 10-20 um. The paper's own "plausible fog sizes" band is 5-20 um. **Default d = 10 um** for cumulus and stratus; d = 5-8 for fog and haze; d = 20 only for towers.

Fitted parameters (calc):

| d (um) | gHG | gD | alpha | wD |
|---|---|---|---|---|
| 5 | 0.971 | 0.352 | 17.1 | 0.206 |
| 10 | 0.988 | 0.424 | 22.0 | 0.272 |
| 20 | 0.995 | 0.483 | 27.1 | 0.304 |

Phase times 4 pi (so 1.0 = isotropic), against our default `0.6*HG(0.2) + 0.4*HG(0.85)` (calc):

| angle | ours | d=5 | d=10 | d=20 |
|---|---|---|---|---|
| 0 | 34 | 1822 | 10355 | 47814 |
| 2 | 32 | 499 | 350 | 175 |
| 5 | 24 | 63 | 28 | 15 |
| 10 | 11.6 | 10.1 | 5.5 | 4.4 |
| 20 | 3.6 | 2.3 | 2.2 | 2.4 |
| 40 | 1.3 | 0.70 | 0.79 | 0.82 |
| 90 | 0.59 | 0.036 | 0.022 | 0.015 |
| 140 | 0.39 | 0.12 | 0.12 | 0.10 |
| 180 | 0.35 | 0.17 | 0.16 | 0.14 |

Mean cosine g: ours 0.46, Mie fit 0.88 (all three d). Observations:
- **Forward peak:** a sub-degree spike (3 orders of magnitude over isotropic), within about 5 degrees of the sun. Ours is a broad 20-30 degree bump. Peak width in 1-u is about (1-g)^2/(2g), for d = 10 that is under 1 degree, similar to the sun disc (0.53 degrees).
- **Side scatter:** our HG lobes put 25-40x more energy at 90 degrees than real droplets do. Single-scatter side-lit light is almost nothing; real clouds look bright side-on only through multiple scattering.
- **Back scatter:** ours is about 2-3x too bright at 140-180 degrees. The real glory ripples are missing from the fit, so the fit is monotone there (slightly dark versus the ripple crests).
- **Size dependence:** d barely moves the bulk (10 to 20 um changes 20-180 degrees by less than 25%); it changes the 0-10 degree peak by 5-10x. So the choice of d is mostly the glare and silver-lining width.
- Both lobes integrate to 1 (calc check, d = 5 and 10 integrate to 0.99999, d = 20 gives 0.991 only because my quadrature misses the sub-0.1 degree peak).

## 3. Cost and LUT

Cost: one phase evaluation is two pow-1.5 terms (x * sqrt(x)), about 25 flops. Our `cloudPhase` is already two HG evaluations, so **the cost is the same**. And `phase` is evaluated once per pixel at march.wgsl.ts:139 (`cloudPhase(cosSun)`), not per sample. So a LUT is not needed for speed. A CPU-baked or per-pixel parameter set (`gHG`, `gD`, `alpha`, `wD`, four floats from `d`) is the right plumbing.

A LUT is only worth it for (a) convolving with the sun disc, and (b) the Nubis talk's suggested 2D (phase x something) LUT. If baked:
- 1D, `rgba` not needed, store `r32float` (fp16 overflows: the peak is 1e4/(4 pi), and real use wants a clamp anyway).
- Index by `x = sqrt(sin(theta/2))`, where sin(theta/2) = sqrt((1-u)/2). Linear in theta near 0, and the peak at 0.5 degrees lands at x = 0.066, i.e. 68 texels of 1024. Store log(phase) and interpolate in log space (the dynamic range is 5-6 orders). 1024 texels in x resolves the peak; plain linear in u would need more than 100k texels.
- Bake with the sun disc convolved (angular radius 0.265 degrees). That also removes the aliased 1e4 glare at pixel granularity.

Without a LUT, clamp the analytic phase to about 300/(4 pi) (about 25) to emulate the disc average. Tune the clamp by eye.

Numerical care: `1 + g^2 - 2 g u` cancels catastrophically in f32 near u = 1 with g = 0.995 (answer about 2.5e-5 from terms about 2). Compute it as `(1-g)^2 + 2 g (1-u)`; at the sun, 1-u should come from `1 - cosSun` which is itself rounded, so also clamp as above.

## 4. WGSL port

Line-by-line check against `evalDraine` in draine.hlsl: (1 - g*g)*(1 + a*u*u) in the numerator; denominator 4*(1 + a*(1 + 2*g*g)/3)*pi*pow(1 + g*g - 2*g*u, 1.5). Matches paper eq. 5. `c_pi` is an undefined constant in the HLSL snippet (define as PI). HG is eq. 2 of the supplemental, from `henyeyGreenstein` in lighting.wgsl.ts (same formula).

```wgsl
const PI = 3.14159265358979;

// Mie fit parameters from mean droplet diameter d in um (paper eq. 4-7). Valid 5..50. Call once per frame on the CPU
// or once per pixel; clamp is mandatory (gHG is singular at d = 1.67, wD at d = 0.64).
fn mieParams(dIn: f32) -> vec4<f32> {   // x = gHG, y = gD, z = alpha, w = wD
  let d = clamp(dIn, 5.0, 50.0);
  let gHG = exp(-0.0990567 / (d - 1.67154));
  let gD = exp(-2.20679 / (d + 3.91029)) - 0.428934;
  let alpha = exp(3.62489 - 8.29288 / (d + 5.52825));
  let wD = exp(-0.599085 / (d - 0.641583)) - 0.665888;
  return vec4<f32>(gHG, gD, alpha, wD);
}

// 1 + g^2 - 2 g u without the cancellation near u = 1; omu = 1 - u.
fn mieDenom(g: f32, omu: f32) -> f32 {
  let om = 1.0 - g;
  let q = max(om * om + 2.0 * g * omu, 1e-9);
  return q * sqrt(q);                    // q^1.5, avoids pow() of a possibly negative or zero base
}

// evalDraine from draine.hlsl. u = cos(theta).
fn evalDraine(u: f32, g: f32, a: f32) -> f32 {
  let omu = 1.0 - u;
  let num = (1.0 - g * g) * (1.0 + a * u * u);
  let den = 4.0 * PI * (1.0 + a * (1.0 + 2.0 * g * g) / 3.0) * mieDenom(g, omu);
  return num / den;
}

fn evalHG(u: f32, g: f32) -> f32 {
  return (1.0 - g * g) / (4.0 * PI * mieDenom(g, 1.0 - u));
}

// HG + Draine blend (paper eq. 3). p = mieParams(d). Optional clamp stands in for sun-disc convolution.
fn miePhase(u: f32, p: vec4<f32>) -> f32 {
  let ph = (1.0 - p.w) * evalHG(u, p.x) + p.w * evalDraine(u, p.y, p.z);
  return min(ph, 25.0);
}
```

Pitfalls:
- **pow of a negative or zero base** is undefined in WGSL (it is not a NaN-safe `pow` like some HLSL compilers). The base `1+g^2-2gu` is >= (1-g)^2 in exact maths but can round to 0 or negative in f32 for g near 1. The port uses `q*sqrt(q)` with a floor.
- **Integer literals**: HLSL `1 - g*g` and `4.` mix int and double literals; WGSL abstract ints coerce to f32 in these expressions, but write `1.0` explicitly (`let x = 2 * g` with a typed `g` is fine, but `array` indices and `u32` mixes are not).
- **saturate** exists in WGSL, and the port does not need it; `clamp` is used for d. WGSL `exp`, `sqrt` are fine. `log` of the small-range fits needs d > 0.
- Do not copy the sampling function: it uses `pow(T4, 1.0/3.0)` with potentially negative T4 and `sqrt` of negatives, which are NaN in WGSL.
- The `alpha` exponent for tiny d (the d <= 0.1 case sets alpha = 250) is irrelevant at 5 um and above.

## 5. Does it fix sunset? Honest answer: partly, and not the main part

Phase alone does not make bodies mauve. Where the colour comes from in our shader (`cloudInScatterMicro`, lighting.wgsl.ts:38-57):
`sunRadiance * (exp(-tau)*phase + msStrength*ms*MS_NORMALISATION + deepScatter*deep*microOcc) + ambient`.
Only the first term (and `deep`, via `mix(ISO, phase, c^n)`) depends on phase. The **`ms` term has no phase and is multiplied by the warm `sunRadiance`**, and its extinction is relaxed (0.25 of tau, 0.05 deep inside), so it carries sun colour deep into shadowed regions. My hypothesis (not yet measured) is that this term is what makes the whole body warm cream, and ambient is only a small additive.

What HG+Draine would do:
- **Helps** the "warm light only on the lit edge and the side facing the sun" look: direct warm light concentrates in a tight peak within about 20-30 degrees of the sun, and falls to about 1/30 of ours at 90 degrees. So flanks that today get direct warm light at 90 degrees stop getting it, and the rim near the sun gets a stronger, whiter-warm silver lining. It also raises lit/shadow contrast, which targets the 4-6:1 ratio (photo-species-specs.md sec. 11).
- **Helps** backlit silver edges and forward glare (strong, physically sized peak, converges with `edgeDarkening`).
- **Does not** make bodies mauve. The body colour is `ambient` (sky colour) plus whatever `ms` and `deep` give. If those stay sun-coloured, bodies stay cream. A phase swap also **darkens** side-lit and anti-solar views by up to 30x in the direct term, so `msStrength` and `deepScatter` will need re-tuning and the bodies will look flatter and greyer without the colour fix. Mean cosine 0.88 also means `deep` (which blends phase toward ISO by c^n = 0.5, 0.25, ...) becomes strongly forward.

## 6. Recommendation for C1

**Adopt as an optional model, but do not make it the C1 colour fix.** It costs nothing, is physically defensible (replaces two arbitrary HG lobes and `silverG`), and improves forward and backlit behaviour. The mauve bodies need these separate C1 changes first:
1. Make the `ms` and `deep` terms colour-aware: blend their tint from `sunRadiance` toward `ambientUp` / a desaturated sky colour with depth (`sdf`) and with low sun elevation, so the bulk reads cool and only the sun-facing sdf shell stays warm. Gate the 0.25 extinction relaxation by sun elevation so shadowed bulk at sunset is lit by sky.
2. Lower `ambientFloor` or raise `ambientStrength` at low sun, and make ambient sky-coloured purple (near-sun versus away-from-sun split from photo sampling).
3. Then try the phase.

Where it plugs in: `cloudPhase()` in lighting.wgsl.ts. Add a `phaseModel` setting (0 = current HG mix, 1 = Mie) and a `dropletDiameter` setting (default 10). Compute `mieParams(d)` on the CPU in runtime.ts (where `phaseG`/`silverG` are written at f[40], f[41]); that needs four floats, so either two new uniform slots or repurpose f[40], f[41] plus two more (check the frame struct padding). Keep `phase` per pixel at march.wgsl.ts:139, no other call-site changes since `phase` is passed down.

A/B with the capture harness (same seed, same camera, sunset bookmark and the three-rows comparison page):
- A = current HG mix, B = Mie d = 10, C = Mie d = 10 plus `msStrength` x 1.5 and `deepScatter` re-tuned to match mean luminance. Judge B at equal mean luminance, otherwise B simply looks darker.
- Capture at three sun-view angles (looking at the sun about 10 degrees, 90 degrees, anti-solar) because that is where the models differ 1x, 30x, 3x.
- Add a debug output that splits direct / ms / deep / ambient and sample body hue (HSV) and the lit/shadow ratio against the photo targets (mauve #5F6482-ish bodies, ratio 4-6:1). Expect the phase swap to move the ratio but not the hue; the ms/ambient tint changes (1, 2 above) move the hue.
- Check the sun glare for aliasing (flicker with motion) and tune the 25.0 clamp.

## Summary
HG+Draine is a drop-in, same-cost phase function with a closed-form fit from droplet diameter (5-50 um); default d = 10 um. It has a far narrower forward peak and far less side scatter (30x less at 90 degrees) than our HG mix. It helps the silver lining and the warm-fringe confinement, but it will not by itself make sunset bodies mauve: that needs the phase-free `ms` term and ambient to be recoloured. A WGSL port is included. No LUT needed for speed.
