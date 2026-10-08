# Procedural morphology packet

2026-10-08. Original implementation informed by the Tidewater audit; no source
or noise assets were copied. VDB work remains parked.

## What changed

- `createMorphologyNoise` builds periodic gradient/Perlin-Worley shape and
  multiband Worley erosion volumes independently of a 2D weather map. Signed
  32-bit seeds, texel-center sampling and complete box-filtered mip chains.
- The renderer evaluates weather columns, a billowy base boundary, a height
  profile and fine erosion before converting that boundary to density. Shape
  and erosion have independent scales in metres. View and sunlight use the
  same evaluator, with noise LOD derived from their sampling footprint.
- Mipmapped textures are uploaded directly to the host Three renderer's GPU
  device. The existing scene/depth integration, radiance/transmittance output
  and sunlight optical-depth cache are retained.
- This is an **experimental procedural evaluator**, not a replacement of the
  persistent voxel world. Its field payload is conservative domain support;
  it is not a baked copy of the final density. The imported-voxel evaluator
  remains available without applying procedural morphology to its data.
- The new mode avoids allocating the unused refined-density texture, saving
  37,748,736 bytes for the lab domain. The sunlight cache still occupies that
  much GPU texture storage. Weather/shape/detail mip textures total 2,484,124
  bytes. These are resource sizes, not peak memory or performance results.
- Initialization now validates the field before allocating morphology
  textures and cleans up failed density/occupancy initialization. Runtime
  disposal owns and releases its raw GPU textures.

## Viewer

[`/realism/`](http://127.0.0.1:5173/realism/) defaults to the new procedural
source. The prior procedural source remains selectable at the same camera
pose and domain bounds. The two sources have different generation models and
extinction defaults, so this is an appearance comparison, not numerical parity.

Controls expose coverage, erosion, seed and independent weather/shape/detail
scales. Full scattering, direct light plus ambient, unshadowed density and sky
isolation are available. The approximate higher-order scattering energy ratio
defaults to 0.5 rather than the earlier experiment's 0.7. This is a configurable
heuristic, not a calibrated physical multiple-scattering solver.

## Verified evidence

- 129 unit tests pass, including seven periodic-noise/mip-chain tests.
- Typecheck, production build, package build/pack and independent packed
  consumer pass. An inferred declaration that leaked a workspace React alias
  was corrected with an explicit public return type.
- [GPU evidence](../archive/research-results/morphology-gpu-2026-10-08.json): 21 checks pass with no captured
  GPU errors on Apple/Metal. The set includes the 12 authored transport/cache
  checks and nine procedural domain/resource checks. Zero coverage clears
  both view extinction and sunlight optical depth. Constant-light L+T error
  is 0.00048828125, below the 0.001 tolerance. Camera movement reuses the cache;
  erosion changes rebuild it once; resize preserves mip resource bindings.
- The final source was inspected in an isolated in-app browser at native
  resolution, from ground and above. Seed replacement and an interior-domain
  camera were exercised without captured errors. This is not a multi-seed
  transport convergence audit or a guaranteed in-cloud pose for every setting.
- Native default noise generation measured roughly 0.7–0.8 seconds in Chrome
  and 1.5–1.7 seconds in the worker's Node/Vitest environment. Generation is
  synchronous in this prototype; no frame-rate claim follows from that timing.

Local screenshots: `artifacts/realism/morphology-ground-final.jpg` and
`morphology-tops-final.jpg`. Earlier captures in that folder are intermediate
states, not the final source's evidence.

## Current visual assessment and limits

The source now has eroded outlines, fragments and billowy tops rather than the
sphere-derived import fixtures. Compared with the prior baked procedural field,
its boundaries have more definition. Root's visual assessment remains below
the Takram/Tidewater target: tall or flat-sided formations, uneven lighting and
some overly soft regions remain. No appearance acceptance is inferred from
the analytic tests. No new minor human checkpoint is requested.

Noise mip averaging happens before the nonlinear density remap; it does not
prove conserved mean extinction or accepted LOD transitions. The sunlight
cache filters its inputs to the light-step footprint, but lighting convergence
and dynamic banding still need measured comparisons. Fixed per-pixel ray jitter
has no temporal accumulation. Ground shadows are disabled in this viewer.
The domains are finite (4 km or 9 km), with a fixed world-space edge fade. This
does not close persistent world coverage, horizon continuity or streaming.

## Next bounded packet

1. Make matched camera/source/light comparisons at increasing light samples
   and cache resolution to separate density profile artifacts from transport
   aliasing. Include direct versus full lighting and controlled motion.
2. Calibrate ambient and direct cloud lighting against the sky's actual
   radiance, then assess the height profile and fine billow shading. Avoid
   adding more unrelated sources or regenerating Houdini fixtures.
3. Once this source reaches convincing quality, feed it into resident voxel
   generation and coarse/fine distance representations with explicit optical
   and silhouette gates. Preserve the same source parameters across all levels.
4. Optimize and connect temporal reconstruction after establishing the
   reference. The new evaluator currently has no FSR3 motion/depth guides and
   makes no reconstruction parity claim.

One bounded Luna worker owned noise generation/tests and reviewed resource and
binding correctness; root owned WGSL transport integration, viewer and GPU
verification. Token savings were not measured.
