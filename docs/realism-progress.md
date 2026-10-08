# Realism progress

## Latest procedural source — 2026-10-08

The new weather/base-boundary/erosion evaluator is implemented, mipmapped and
is the `/realism/` default. Its detail scale is independent of the domain's
voxel support resolution. [Packet evidence](research/morphology-study.md):
129 unit tests, 21 GPU checks, builds/packs and an independent consumer pass.
The renderer still needs lighting calibration, temporal stability and world
coverage work before meeting the visual target. The conservative domain is
not the persistent voxel-world generation solution. VDB work stays parked.


Updated 2026-10-08. This is a technical progress handoff for the autonomous
platform-through-P6 directive. It records source and integration evidence; it
does not accept visual quality or a production preset.

## Current focus — revised 2026-10-08

The user confirms the self-authored VDB fixture is fine as an import test and
parks further VDB work. The current image is not a known authored cloud being
rendered incorrectly. Next quality effort targets the procedural source's
weather/base-shape/detail hierarchy, informed by Tidewater's readable source.
No more Houdini fixture generation or VDB-specific visual chase is scheduled.

## Source honesty correction — 2026-10-08

All four bundled Houdini VDBs originate from overlapping spherical particle
footprints (`scripts/generate-houdini-cloud.py:167`) followed by native noise.
They are genuine fog VDB files and useful import/transport fixtures, but their
morphology remains a stand-in. Do not treat native file provenance, successful
conversion, or a Cycles render of the same poor source as cloud-quality progress.
The viewer now labels these as VDB import fixtures and states this limitation.

The readable Tidewater reference is now audited. Its independent weather,
shape and erosion scales expose a missing quality capability in our procedural
source. See [density findings](research/tidewater-density-reference.md) and
[transport findings](research/tidewater-transport-reference.md). Preserve the
voxel/VDB integrator; develop a better source and filtered detail path rather
than regenerating more sphere-based fixtures.

## Source and asset foundations

- Houdini 21 works with the current `houdini_setup` source path. Earlier
  license and Qt probe failures are obsolete.
- Real fog VDB input and four CLDA variants have fixture/provenance evidence.
  Representative native readback samples have zero error; full-field density
  quantization error is at or below 0.5/255.
- The offline VDB converter and Houdini bridge are available. Curved and
  concave mesh conversion checks are finite across five GPU loader checks.
- Native Blender reference artifacts are in `artifacts/realism/` and are
  labeled **OFFLINE REFERENCE — NOT WEBGPU**.

## Rendering and bindings

The platform now contains realistic reference appearance, GPU density bake,
optical-depth cache, ray jitter, a multiple-scattering approximation, and the
CPU density source. Three exports include the realistic reference option, and
React exports `DensityCloud`/`useDensityCloud` with field replacement and
lifecycle handling.

The P4 smoke record has 29 GPU checks and 15 timing rows at 320×180 across five
modes. Native, bilinear, cloud-only and FSR1 use guide-free rendering; FSR3
uses guides. Both comparison runtimes remain allocated. The React
dense adapter matched its vanilla runtime with exact zero optical error after
field replacement, camera replacement, and remount.

## Current visual limit

The native-VDB viewer translates its source to Y=1700, but the current algorithm
is below the target visual quality. No user review checkpoint is requested for
this interim result. Chrome successfully rendered the detailed and lower-density
native candidates after the earlier in-app-browser/CDP failure. All 12 analytic
transport/cache checks passed with no captured GPU errors; this does not measure
visual banding or establish Takram parity.

Evidence: [detailed field GPU report](research/realism-gpu-2026-10-08.json),
[lower-density field GPU report](research/realism-soft-gpu-2026-10-08.json),
and local captures in `artifacts/realism/webgpu-*.png` / `webgpu-soft-viewer.jpg`.
The lower-density candidate uses one native Cloud Noise stage, smaller source
radii and explicit density multiplication by 0.4. It is thinner, but still too
smooth. About 43.6% of active source voxels remain at the authored peak after
scaling, so lowering density alone has not recovered interior shape variation.
The native noise investigation confirmed additive, absolute-positive noise in
the first three candidates. A fourth candidate uses native Cloud Billowy Noise
with Worley erosion and advection, preserving prior fixtures. Active-voxel peak
saturation drops to 28.1%, but the WebGPU image is still too smooth to accept.
Its [GPU report](research/realism-billowy-gpu-2026-10-08.json) also records 12
passing analytic checks and no captured GPU errors. A separate Cycles render of
this same VDB completed (`artifacts/realism/native-billowy-reference.png`,
explicitly offline). It also shows a smooth, rounded mass. This qualitative
comparison implicates source authoring as part of the gap; lighting/camera
conditions are not matched well enough to validate renderer radiance. Do not
infer visual convergence or a banding fix from the transport tests.

Viewer orbit now follows the active field bounds. Initialization failure and
live-reload cleanup destroy owned devices; successful Chrome live reload was
observed, but long-duration/device-loss recovery is still untested.

Broad visual quality, atmosphere, temporal motion, accepted performance presets,
RTX/Windows compatibility, streaming, and publication remain open. The current
directive permits autonomous progress through these foundations while keeping
the release decision separate.
