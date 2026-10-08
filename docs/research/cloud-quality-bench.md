# Cloud rendering quality bench

Research and implementation snapshot: **2026-09-18**.

This bench isolates the moving arcs, bands, crosshatch and shimmer seen during orbit and zoom. It is deliberately independent of the cloudscape renderer: it shares no shader code, cache, reconstruction, or camera controller with the production path. Voxel mode imports the production density generator's output as test data. The page is `examples/lab/quality-bench/index.html`.

## What the bench establishes

The current cloudscape march uses a regular lattice in distance from the camera. The lattice is physically correct about segment opacity: each clipped segment uses `exp(-sigma * segmentLength)`. It is not stationary in world or volume space. When the camera moves, its sample planes move through the cloud. That can turn density or lighting quadrature error into coherent moving contours. Filtering only the procedural detail term cannot remove error caused by under-sampling the broad density field, the voxel field, or the secondary light march.

The bench renders one cloud into three panels:

1. **Candidate** — a selected low-cost method.
2. **Dense spatial reference** — 640 midpoint view segments and 64 direct-light samples at every occupied view sample.
3. **Error** — absolute display-space RGB error magnified four times.

Both renders use the same deterministic orbit/zoom camera, bounds, Beer–Lambert segment opacity, single-scattering approximation, sun, and source. The two source choices separate sampling from representation:

- **Analytic smooth field:** a continuous sum of smooth lobes, so voxel-grid artifacts are impossible.
- **64³ voxel field:** the repository's deterministic `authored` density generator at seed 7, uploaded as `r8unorm`, trilinearly filtered, with a complete CPU-built box-filtered mip chain.

The reference is expensive on purpose and runs at 240 × 135 per view. It is a spatial baseline, not a claim of ground truth for multiple scattering or atmospheric composition. The page contains no temporal accumulation and no post blur.

## Candidate experiments

| Candidate | Question answered | Interpretation |
| --- | --- | --- |
| Current distance lattice | Does the camera-relative regular lattice reproduce moving contour error? | If it fails on the analytic source, the voxel generator and atlas are not the root cause. |
| 4× segment quadrature | Does resolving each nominal segment with four physical subsegments converge toward the reference? | This is the expensive quality candidate. It raises actual density and lighting evaluation rate rather than blurring the image. |
| Distance lattice + voxel mips | Does source prefiltering help grid interference without fixing the view quadrature? | Improvement only on the voxel source implicates density bandwidth. Remaining analytic-source bands implicate integration. |
| Per-frame jitter diagnostic | Does decorrelating the lattice exchange bands for temporal noise? | It has explicit temporal ownership. Without a temporal estimator it is expected to shimmer and is not a final solution. |

The 24-frame audit samples a deterministic 270-degree orbit with radial zoom and vertical movement. For each frame it reads both images and reports:

- spatial mean, 95th-percentile and maximum RGB error;
- a motion residual, `abs((candidate[t]-candidate[t-1]) - (reference[t]-reference[t-1]))`;
- the worst frame and total audit time.

This residual subtracts camera-driven change already present in the moving reference. It is still an image-space diagnostic, not optical flow: disoccluded pixels and large projected motion contribute. Compare methods on the same path and source rather than treating one scalar as a universal pass threshold.

## Measured results

Measured on the Metal WebGPU adapter on 2026-09-18. Values are fractions of display range; multiply by 100 for percent. Every row covers the same 24-frame deterministic motion path at 240 × 135 per image against the 640-view × 64-light reference.

| Source and candidate | Effective view evaluations | Light samples | Spatial MAE | Motion residual MAE | Motion p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Voxel, current-like distance lattice, 24 m desired step | about 42–55 along a box crossing | 48 | 0.00032381 | 0.00046868 | 0.00146484 |
| Voxel, reduced 4× quadrature, 48 segments | 192 | 64 | 0.00005150 | 0.00008425 | 0.00048828 |
| Voxel, quality baseline, 160 segments | 640 | 64 | 0.000000147 | 0.000000244 | 0 |
| Analytic, coarse distance lattice, 48 m desired step | about 21–28 | 64 | 0.00015081 | 0.00021569 | 0.00048828 |
| Analytic, reduced 4× quadrature, 48 segments | 192 | 64 | 0.00000261 | 0.00000459 | 0 |

The reduced 192-evaluation candidate lowers voxel spatial error by about 6.3× and motion residual by about 5.6× relative to the current-like preset. Against the deliberately coarse 48 m lattice used to make the reported vertical/arcing structure obvious in the error view, it lowers voxel spatial error by about 21.8× and motion residual by about 18.7×. The 640-evaluation quality preset matches the reference to half-float rounding over the audited path. During live review its candidate/reference panels remain visually coincident and the 4× error panel loses the structured vertical bands visible with the coarse regular lattice.

The isolated light-sample sweep keeps view sampling exactly equal to the reference (640 evaluations) and changes only direct-light samples:

| Light samples | Spatial MAE | Motion residual MAE | Motion p95 |
| ---: | ---: | ---: | ---: |
| 8 | 0.00059455 | 0.00066103 | 0.00292969 |
| 16 | 0.00017084 | 0.00024213 | 0.00073242 |
| 32 | 0.00006675 | 0.00010273 | 0.00048828 |
| 64 | 0.000000147 | 0.000000244 | 0 |

This establishes two independent contributors. Primary-ray under-sampling explains structured error on both the continuous and voxel fields; the voxel field amplifies it. A short secondary-light march can dominate the remaining interior error even when the view integral is dense. The simple footprint-selected mip experiment was not a solution: in the initial 320 × 32 comparison it increased voxel spatial MAE from 0.000794 to 0.002690 and motion residual from 0.001252 to 0.003309. It changed the represented density faster than it reduced lattice aliasing.

These isolated results establish a clean baseline and a lower-cost candidate. The production audit below tests the integrated runtime; full-resolution live motion review remains a separate acceptance step.

### Production atlas/world audit — lighting evidence withdrawn

**Correction following code inspection:** the original audit set `shadows: false`.
In the cloudscape shader that makes `lightAt()` return 1 before either direct
integration or cache lookup. Turning `cachedLighting` off did not override that
flag. The earlier description of these measurements as direct-light results was
incorrect. The 4×/192 and 4×/256 equality compared the same primary quadrature
with self-shadowing disabled; it provides **no evidence** that 192 light samples
converge or that production shadow banding is fixed.

The old 12-pose, 96×54 results remain useful only for primary sampling under
unattenuated sunlight: current versus 4× spatial MAE 0.0039293 and motion MAE
0.0050552, with cloud support 34.35% and partial opacity 18.72%. Both 4× variants
were identical because their effective shading and primary samples were the same.
The separate single-cloud light-sample sweep above is unaffected by this error.

The production audit now enables cloud self-shadowing, disables geometry shadows
and uses direct lighting during motion comparisons. Results explicitly record
that configuration. **Corrected production lighting measurements are pending a
rerun; no replacement numbers or cost claim are accepted.** Cached lighting must
also be compared separately at the user's full-size problem view.

Four-substep skip/full parity and light-cache invalidation checks remain valid
for their narrower contracts. The correctness change evaluates the full local
3×3 owner stencil, including the default one-substep path; its throughput risk
still needs measurement. Earlier cost results were already rejected for shared
GPU contention and cannot establish a performance preset.

## Primary-source findings

### Production shadow isolation — user observation, 2026-09-18

**Follow-up implemented:** the [lighting isolation bench](../archive/lighting-isolation.md)
uses the production renderer with lit secondary-only comparisons, fixed view
sampling, transmittance invariance checks and a 1024/2048 reference-sensitivity
comparison. New results are recorded there, separately from the withdrawn audit.

The user compared cached lighting, unshadowed rendering and direct lighting in
the cloudscape viewer. Cached lighting has prominent bands; disabling shadows
removes the visible bands; direct lighting makes them substantially worse.
See the [review record](../archive/human-review.md#user-results-received--2026-09-18).

Both the cache builder and direct view shading call the same `directLight()`.
That function spreads a fixed sample count (48 by default) uniformly over the
remaining ray interval through the entire resident world bounds. Consequently,
sample spacing and phase depend on the shading point and distance to the world
exit, rather than the local cloud's resolved density scale. This is a concrete
undersampling risk and a leading explanation, not yet a demonstrated sole cause.
The cache's interpolation can soften this error without resolving it.

Next isolate cloud self-shadowing from geometry attenuation, hold primary view
quadrature fixed, and sweep secondary sampling against a converged spatial
reference. A physical-distance light-step experiment must cover the entire
relevant ray, correctly weight the final clipped segment, and explicitly report
any budget exhaustion rather than silently truncating the shadow integral.
Test the central tower overlap separately because a visible artifact remains
there in the unshadowed screenshot. No new lighting fix or convergence claim is
made from these captures.

### Physical segment integration

Sébastien Hillaire's Frostbite material derives per-step transmittance from Beer–Lambert extinction and analytically integrates a constant source over the segment. This removes the direct dependence of brightness on arbitrary step length. The bench uses the equivalent normalized-source form: `segmentT = exp(-sigma * ds)`, `L += T * (1 - segmentT) * lighting`, then `T *= segmentT`. Physical segment length is used for the clipped entry/exit segments too.

This fixes energy scaling; it does not make a coarse density or lighting sample representative of the whole segment. Dense reference sampling is therefore still required when diagnosing contouring.

Sources: [Hillaire, *Physically Based Sky, Atmosphere and Cloud Rendering in Frostbite* (SIGGRAPH 2016 course notes)](https://blog.selfshadow.com/publications/s2016-shading-course/s2016_pbs_course_summary_v2.pdf), [Hillaire publication index](https://sebh.github.io/publications/).

### Sampling stability

Bowles and Zimmermann describe the exact failure mode relevant here: few, widely separated volume samples cause severe aliasing under camera motion. Their 2015 method holds samples stationary in the volume and extends that construction to a `1/z` distribution. Their later paper instead demonstrates random ray-start jitter plus temporal antialiasing. These have different ownership: stationary volume samples aim at motion stability directly; randomized samples intentionally create noise that a temporal estimator must resolve.

The bench includes the current camera-distance lattice and an intentionally unstable per-frame jitter option. It does not yet implement the published stationary-plane construction; that is the next high-value candidate if dense quadrature proves the issue.

Sources: [SIGGRAPH 2015 course page, *A Novel Sampling Algorithm for Fast and Stable Real-Time Volume Rendering*](https://advances.realtimerendering.com/s2015/), [Toft, Bowles and Zimmermann, *Optimisations for Real-Time Volumetric Cloudscapes*](https://arxiv.org/abs/1609.05344), [MIT-licensed `volsample` research repository](https://github.com/huwb/volsample).

### Nubis / Decima

The 2015 Nubis material uses separate base-shape and detail sampling, adaptive stepping and randomized offsets. Nubis³ adds authored voxel clouds, distance-selected source mip levels, compressed distance-field skipping, adaptive stepping and jitter. Those optimizations do not remove the need for a converged reference; each changes a different error source. In particular, source mip selection controls density bandwidth while view-step placement controls integration aliasing.

Sources: [Schneider and Vos, *The Real-Time Volumetric Cloudscapes of Horizon Zero Dawn*](https://advances.realtimerendering.com/s2015/The%20Real-time%20Volumetric%20Cloudscapes%20of%20Horizon%20-%20Zero%20Dawn%20-%20ARTR.pdf), [Schneider, *Nubis: Authoring Real-Time Volumetric Cloudscapes with the Decima Engine*](https://www.guerrilla-games.com/read/nubis-authoring-real-time-volumetric-cloudscapes-with-the-decima-engine), [Schneider, *Nubis³*](https://www.guerrilla-games.com/read/nubis-cubed), [SIGGRAPH 2023 course page and official PDF](https://www.advances.realtimerendering.com/s2023/index.html).

### Shadertoy examples and provenance

Two useful public shader examples connect the production research to compact code:

- Reinder Nijhoff's *Himalayas* cites Hillaire's improved integration and Nubis density construction, uses detail lookup data and temporal reprojection, and declares **CC BY-NC-SA 4.0** in the source.
- `volsample` contains an MIT license for the research implementation, but its cloud scene also credits cloud code by iq and nimitz. Treat those embedded/adapted portions as separate provenance until audited.

No Shadertoy or external shader code was copied into this bench. Its math and WGSL are a clean implementation of the cited concepts. This avoids importing noncommercial/share-alike terms into the MIT repository.

Sources: [Nijhoff, *Himalayas* source and license](https://github.com/reindernijhoff/shadertoy/blob/master/himalayas/Image.glsl), [`volsample` cloud shader and inline MIT notice/credits](https://github.com/huwb/volsample/blob/master/src/shadertoy/clouds.shader).

## How to read the evidence

Run the analytic source first. If the current lattice shows arcs or a large motion residual while 4× quadrature approaches the reference, integration under-sampling is sufficient to explain the defect. Then switch to the voxel source. Any new structured residual points to voxel resolution/filtering or an interaction between the voxel grid and the ray lattice.

Vary light samples independently. If silhouette/transmittance is stable but interior bands move or change with light samples, the secondary light march is under-resolved. If raising view segments changes both silhouette and opacity contours, the primary density integral is under-resolved.

The mip candidate is only evidence for band-limiting the voxel source. A lower error can justify footprint-aware density filtering, but a visually softer image by itself is not proof. Compare opacity, boundary position, spatial error and motion residual together.

## Limits and next integration step

- A 640 × 64 reference is finite and should be convergence-tested again if the production source gains materially finer density bandwidth.
- `rgba16float` readback measures final display-space color and opacity. A later optical audit should retain un-tonemapped radiance/transmittance and measure those separately.
- The analytic source is intentionally smooth. It isolates the integrator but does not represent the bandwidth of production detail noise.
- The audit has no perceptual threshold yet. Human review of the live path remains required for prominent arcs, crosshatch and strobing.
- Stationary-in-volume sampling is researched but not implemented in this first bench. It should be compared against dense quadrature before modifying the shared runtime.

The production runtime should change only after the bench reproduces the reported defect and one candidate is quantitatively and visually closer to the dense reference through the full moving path.
