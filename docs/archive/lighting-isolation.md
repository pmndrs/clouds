# Lighting isolation bench

Open [the lighting bench](http://127.0.0.1:5173/lighting-bench/).

This is a diagnostic, not a new quality preset. It uses the **production atlas
and cloudscape renderer**, with one frozen seed-17, 9×9 resident world. No
reconstruction, history accumulation, post blur, scene geometry shadows or
camera-relative density fade is active. The small standalone analytic bench
remains useful, but it is not the renderer being tested here.

## What to inspect

- Drag the candidate to orbit; scroll to zoom. Both images use the same camera.
- Choose **Direct · 48**, then **Direct · 256** at the same pose. Look for arcs
  and changes during small movements, not simply differences in brightness.
- **Cached · 48 / 256** isolates cache representation from the light sample
  budget used to build it. It does not change the cache's spatial resolution.
- **Unshadowed control** should remove sunlight attenuation. Its large radiance
  difference from the lit reference is intentional, not a failed approximation.
- **World-anchored** is an experiment, not the recommended choice. It anchors
  light-segment boundaries to absolute world coordinates along the sun axis.
- References use **1024 or 2048 direct light samples**. A higher count is not by
  itself proof of convergence or physically accurate multiple scattering.
- Raise pixels per view for visual inspection; **Stack large views** gives each
  image more space. Vertical dividers separate side-by-side images. Exposure
  affects display only, and both sides use the same display mapping.
- **Play orbit + zoom** advances a fixed camera path one completed pair at a
  time. Its speed depends on GPU cost; it is not a frame-rate benchmark.

The display composites linear optical radiance and transmittance over a constant
background, with a simple shared exposure/Reinhard/gamma mapping. The error panel
shows 4× absolute linear radiance error with that display mapping. Numeric errors
are measured before mapping and are not percentages of display brightness.

## Automated sweep

**Run isolated light sweep** captures twelve fixed orbit/zoom poses in three groups of four nearby views at 96×54 per
view. Primary sampling remains at four substeps, max 320 nominal steps, detail
0.16 and density 1. It compares each candidate against direct 2048, including
direct 1024 to measure reference sensitivity. **Save evidence** exports the
current results. **Stop after current pose** retains partial results, explicitly
marked incomplete.

Checks require all poses, populated and partially transparent cloud pixels,
finite outputs, no WebGPU validation errors, identical transmittance for all
lighting variants, and a meaningful lit/unshadowed difference. These validate
the experiment's isolation; they do **not** grant visual acceptance.

Spatial error is the mean of maximum RGB-channel errors over cloud support.
Motion error compares candidate frame differences with reference frame
differences. Each group moves one degree per step with a small zoom change;
jumps between groups are excluded from motion metrics. This is not optical
flow, and twelve poses do not replace continuous small-motion review. GPU output is half-float; small reference
differences include output quantization. The recorded elapsed time is total
audit wall time, not the cost of each method or a usable performance estimate.

## First measured results — 2026-09-18

Chrome, Metal 3, twelve poses, 96×54, all isolation checks passed. Cloud support
27.83%, partial opacity 11.77%, maximum transmittance difference **0**. No GPU
validation errors. Values below are linear radiance errors against direct 2048.
The [full recorded results](research-results/lighting-isolation-results.json) include
reference sensitivity, support counts, configuration and all error statistics.

| Candidate | Spatial MAE | Motion residual MAE |
| --- | ---: | ---: |
| Direct 48 | 0.00126239 | 0.00100707 |
| Direct 256 | 0.00008476 | 0.00012285 |
| Direct 1024 | 0.00001314 | 0.00002409 |
| World-anchored budget 256 | 0.00357830 | 0.00251659 |
| World-anchored budget 1024 | 0.00027662 | 0.00025540 |
| Cached, built with 48 | 0.06898540 | 0.03002347 |
| Cached, built with 256 | 0.06862374 | 0.03001822 |
| Unshadowed control (intentional difference) | 0.44458095 | 0.06403790 |

Direct 256 reduces spatial error about **14.9×** and motion residual about
**8.2×** versus direct 48 in this test. This supports investigating secondary
light undersampling. Increasing only cache-build samples barely improves the
cache error, so cache spatial representation/mapping needs a separate audit.
This does not yet distinguish resolution, interpolation and implementation
errors in the cache, nor establish a production-quality fix.

World-anchored spacing is the full box's projected span divided by its budget;
normalized sampling divides each individual ray's remaining length. Therefore
equal budget labels do **not** imply equal spacing, evaluations or cost. These
results cannot isolate the benefit of stationary sample phase alone. A fair
phase comparison must match spacing or measure actual work. The current
world-anchored implementation is not a winning replacement.

## Implementation and limits

The runtime now accepts experimental `settings.lightSampling` values
`'normalized'` (default) and `'world-stationary'`, and `lightSteps` up to 2048.
Defaults remain normalized/48. Stationary segments use their actual clipped
first/last lengths and at most budget + 1 evaluations. Cache invalidation
includes sampling mode. Dense settings are for diagnostics only.

The tower/cloud overlap artifact is excluded because this scene has no opaque
geometry. Distant LOD, changing residency, sun animation, wind, real-time cost,
Windows/RTX behavior and dense-cache resolution sweeps remain untested here.
The older production audit's invalid lighting-convergence claim remains
withdrawn; these are new measurements from a different, explicitly lit test.

Validation for this addition: TypeScript, all 66 existing unit tests and the
production lab build passed. The 12-pose GPU sweep passed the isolation checks;
384×216 interactive orbit/zoom playback advanced in Chrome, with matching
transmittance and no reported browser/GPU errors. These are local Metal checks,
not a full-resolution visual sign-off or a performance-preset acceptance.
