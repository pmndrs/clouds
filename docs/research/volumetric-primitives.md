# Volumetric primitives and cloud shadows

A camera ray needs fine density to draw a wisp against the sky. At a point inside the cloud, a second ray asks how much sunlight reaches that point. Could a smoother, cheaper density field answer that second question well enough? We explored the primitive math in a CPU lesson and found an earlier WebGPUClouds visual test. The open experiment measures the GPU cost of skipping detail in the sun lookup. [Benchmark issue #1](https://github.com/pmndrs/clouds/issues/1)

## What we tried in the lesson

We built a small browser renderer with overlapping Gaussian and Epanechnikov ellipsoids. It clips each ray to each ellipsoid, integrates extinction over those intervals, and adds the results to obtain optical depth. The light lab samples scattering locations and traces rays toward the sun through the same field. It uses 16 hand-placed shapes, isotropic scattering, and a user-selected bounce limit. This exercises the forward rendering math. The authors’ full renderer also fits primitives to assets and accelerates traversal. [Condor et al., §§4–6](https://arxiv.org/abs/2405.15425) · [Reference implementation](https://github.com/facebookresearch/volumetric_primitives)

For a numerical check, we sent one ray through three overlapping Gaussians. Each row below estimates the fraction of background light that crosses the same cloud untouched.

| Optical-depth calculation | Transmitted light |
| --- | ---: |
| 5 midpoint samples | 1.93616% |
| 6 midpoint samples | 9.09434% |
| 64 midpoint samples | 4.39967% |
| 100,000 midpoint samples | 4.38922% |
| Analytic Gaussian integrals | 4.38923% |

Moving from five to six samples moves every midpoint. The new points catch a different part of the narrow peaks and the estimate overshoots. At 100,000 samples the two methods agree to within 0.00001 percentage points. This checks transmission along one ray. GPU frame time and the visual error of coarse sun shadows need their own measurements.

<details>
<summary>Reproduce the ray check</summary>

Trace from the origin along +X for 7 scene units. All centers have Z = 0. The following parameters describe the slice traversed by the ray.

| Center X | Center Y | Width X (σ) | Width Y (σ) | Peak extinction |
| ---: | ---: | ---: | ---: | ---: |
| 2.40 | 0 | 0.30 | 0.48 | 1.50 |
| 4.15 | 0.10 | 0.78 | 0.58 | 0.78 |
| 4.90 | −0.25 | 0.24 | 0.28 | 1.25 |

At distance `t`, compute `q = ((t - centerX) / widthX)² + (centerY / widthY)²` per puff. Its extinction is `peak * exp(-q / 2)` for `q < 9` and zero outside. Sum the three values. For N midpoint samples, evaluate at `t = (i + 0.5) * 7 / N` for i from 0 through N−1. Multiply the sum of samples by `7 / N` to get optical depth τ. The percentage in the table is `100 * exp(-τ)`.

</details>

## What Gabor Fields measured

Gabor Fields adds oriented waves of fine density detail to a smooth Gaussian base. Each wave has a known scale, so the renderer can omit selected detail for particular rays. The real-time cloud-authoring preview shows transmission through the field. The authors render the sunlit, multiply scattering cloud with a path tracer. [Gabor Fields, §§6.2 and 7.3](https://arxiv.org/html/2602.05081v1) · [Viewer modes](https://github.com/Arcanous98/gabor_fields#visualize)

For the Disney cloud on an RTX 4090, the authors report **977 s** for the reference, **623 s** after approximating the primary paths, and **522 s** after also tracing rays to the light through the Gaussian base alone. The last change saves **101 s**, about **16%** of the 623 s configuration, and introduces lighting error. The larger 977-to-522 s improvement combines both changes. These are times for completed path-traced images. [Figure 10 and timings](https://arcanous98.github.io/projectPages/gaborVolumes.html)

## What WebGPUClouds already tried

The voxel marcher already uses a light grid for the far part of the sun path. It also has two controls for inline sun samples. `lightMipBias` requests coarser texture levels. `inlineProfile` selects the profile output of the density function. In the D1 tower study, profile-only and mip-biased taps left the pitting and grain visible. Biases of +2 and +4 slightly softened the lit lobes. [D1 report, rounds 1 and 5](../../work/reports/D1.md) · [March shader](../../packages/runtime/src/shaders/march.wgsl.ts)

The remaining question is whether the renderer can avoid enough work to justify that visual trade-off. In the NVDF path, the shader calls the density function before choosing between its detailed and profile outputs. A dedicated profile lookup could skip the erosion texture work. Issue #1 compares both implementations at matching shadow values, then compares the cheaper version with the detailed baseline. [NVDF density code](../../packages/runtime/src/shaders/density.wgsl.ts) · [GPU benchmark plan](https://github.com/pmndrs/clouds/issues/1)
