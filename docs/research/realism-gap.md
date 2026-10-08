# Cloud-layer realism gap

**Research snapshot:** 2026-10-08  
**Scope:** the `experiments/cloudscape-density` source and the current volumetric rendering plan.

## Why the earlier candidate falls short

The existing cumulus candidate is built from a fixed table of overlapping ellipsoids. Value noise only perturbs the union's boundary. That makes the silhouette a recognizable collection of lobes: the formation's topology, footprint, base, and tops are decided before noise is evaluated. It is useful as a renderer smoke test, but it cannot represent a broad weather field whose connected billows and cloud boundaries emerge from spatial signals.

The new cloud-layer source uses a different hierarchy: a low-frequency 2D weather field determines where cloud mass is likely, a low-frequency cellular band separates substantial cloud bodies, a coherent 3D field supplies connected shape, and a higher-frequency Worley field removes material around the rim and opens pockets. A height envelope varies the base and top by weather and cloud type. This is still a compact procedural approximation, not an authored fluid volume, but it has the right controls for a layer source and does not contain ellipsoid primitives.

## Takram as the quality reference

Takram's repository is MIT licensed ([repository license](https://raw.githubusercontent.com/takram-design-engineering/three-geospatial/main/LICENSE)), so its implementation can be studied and attributed. This experiment does not copy its shader code. The relevant primary sources are the [cloud package README](https://raw.githubusercontent.com/takram-design-engineering/three-geospatial/main/packages/clouds/README.md), [CloudLayer parameters](https://raw.githubusercontent.com/takram-design-engineering/three-geospatial/main/packages/clouds/src/CloudLayer.ts), and the shipped [cloud shader](https://raw.githubusercontent.com/takram-design-engineering/three-geospatial/main/packages/clouds/src/shaders/clouds.frag).

The README describes a real layer model with altitude and height, density scaling, shape and shape-detail textures, weather controls, Beer shadow maps, temporal filtering/upscaling, light shafts, and aerial perspective. Its documented layer parameters include a weather exponent, a shape-altering bias, coverage filtering, and a vertical density profile. The README also calls out practical failure modes: a shared cloud base can look artificial, excessive erosion wastes ray-march samples, temporal reconstruction can ghost, and local weather must tile cleanly. Those are a materially higher bar than a lobe union with value-noise decoration.

The shader shows the corresponding lighting work: it samples rough weather before detailed media, skips empty intervals, marches optical depth toward the sun, combines that with Beer shadow-map optical depth, applies an approximate multiple-scattering series, integrates radiance analytically with Beer-Lambert transmittance, and terminates when transmittance is low. This density source only supplies the scalar field; the renderer work described below still needs to implement those lighting and reconstruction pieces.

## Density and lighting steps for this repository

The current [volumetric research plan](volumetric.md) recommends a regular `Data3DTexture` first, then a shared density-source contract and progressively more expensive lighting. The cloud-layer field follows that seam:

1. Generate a bounded `r8unorm` field over `[-5000, 900, -5000]` to `[5000, 3100, 5000]`. Keep the horizontal faces natural so a later world layer can repeat or stream the source. Reserve only the first and last Y slices as empty guard voxels.
2. In the renderer, intersect the camera ray with the volume bounds. Use the scalar value times the descriptor extinction scale (`0.004 m⁻¹`) to accumulate Beer-Lambert transmittance. Increase the step in empty regions and shorten it after entering dense media.
3. Add a short secondary march toward the sun for local self-shadowing. A lower-resolution Beer optical-depth map can later cover long cloud-shadow distances, following Takram's separate shadow pass and resolve path.
4. Add an anisotropic phase function and a bounded multiple-scattering approximation. Takram's shader uses Henyey-Greenstein terms plus an approximate scattering series; the exact choice belongs to the renderer and must be benchmarked with the source field.
5. Add aerial perspective and temporal reconstruction only after the non-temporal result is correct. Takram documents ghosting and mean-depth approximations as known limitations, so history must not be required for the baseline to look valid.

## What this does and does not establish

The generator is deterministic, bounded to 64³ or 96³, and exposes coverage, density, and erosion as monotonic controls. Its shape is a low-cost cloud-layer approximation suitable for the source/renderer benchmark. Density statistics and endpoint tests are evidence of a useful field, not evidence that the image matches Takram or real clouds. Visual acceptance still depends on the root renderer's ray marching, lighting, atmospheric composition, and comparison renders.
