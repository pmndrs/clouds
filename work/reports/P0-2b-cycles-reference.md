# P0-2b: Cycles as the independent volumetric reference
**Status:** works and is validated, with one finding. In Blender 5.1, Cycles' default heterogeneous volume method (null scattering)
**gains energy on a dense real cloud**. The script therefore defaults to Cycles' ray-marching mode at voxel/4, which passes every
closed-form check, the real-cloud furnace included. Manifest and conventions: `scripts/reference/README.md`. Tables:
`work/captures/P0-2b/tests/results*`. Commands are in the README: `cycles_render.py`, `make_test_manifests.py`, `validate.py` and `vdb_to_grid.py`.

## (a) Closed-form validation (CPU)
Ray march: voxel/8 (`results-march-voxel8.txt`) / voxel/4, the default (`results-subset.md`). Null is Blender's default
(`results-null.md`). Errors are the largest over RGB.

| test | expected | ray march | null |
|---|---|---|---|
| Furnace: sphere of optical radius 10, albedo 1, HG 0.8 and isotropic | L | <0.01 % | <0.01 % |
| **Furnace: EmberGen cloud, σt 0.6/m, mean through the medium** | 1 | **1.0000, every pixel** | **1.131** (pixels up to 2.9) |
| … σt 0.2 and 0.06 per unit density | 1 | 1.0000 / 1.0000 | 1.047 / 1.002 |
| Absorber slab τ 1, exp(−1)·L | 0.1839, 0.3679, 0.7358 | 0.10 / 0.17 % (noise 0.03 %) | 0.12 % (noise 0.27 %) |
| Real-cloud transmittance vs numpy trilinear march | 0.3193 | +0.09 / +0.11 % | +0.24 % |
| Alpha AOV, slab at albedo 0 and 0.5, 1 − exp(−1) | 0.6321 | 0.06–0.13 / 0.09–0.28 % | 0.07 % |
| Sun on Lambert ground, 30° and 70°, a·E·cos z/π | 0.3820, 0.1592, 0.0398 | 0.01 % | 0.01 % |
| Single scatter, τ 0.05, maxBounces 1: HG 0.8 at 10° / isotropic / HG 0.8 at 90° with albedo 0.5 | 0.2935 / 0.01473 / 0.00126 | 0.05–0.08 / 0.11 % | 0.01–0.02 % |
| … mix 0.6·HG 0.2 + 0.4·HG 0.85 / Draine g 0.7, α 1 / Mie 20 µm | 0.03648 / 0.07849 / 0.04665 | 0.07–0.08 / 0.11 % | 0.02 % |
| Volume Direct pass at maxBounces 512 equals single scatter | same | 0.05–0.08 % | 0.01–0.02 % |
| Equirect sky, cameras along ±Z, +X, +Y, vs numpy bilinear lookup | 0 | RMS 0.0003 of peak | same |
| Asymmetric L-grid from +X, +Y, +Z vs numpy march (mirrored grids score 0.04–0.16) | 0 | RMS 0.001 | RMS 0.003 |

## (b) Cycles' default volume method gains energy
- **Null scattering, furnace on the EmberGen cloud** (4 m voxels, density ≤ 0.73, albedo 1, sky 1): +4.1 % over the image and
  **+13 % through the medium** at 0.6/m; +1.4 % and +4.7 % at 0.2/m; +0.05 % and +0.2 % at 0.06/m.
- **Null scattering, sunlit at 0.6/m:** pixels go negative (samples with negative weight, so the majorant sits below the trilinear
  density somewhere), and the thick body is **10.5 % brighter** than the converged ray march (red 0.669 vs 0.605).
- `volume_step_rate` does not change it and Metal agrees with CPU, so it looks like Blender's majorant, not my setup. The synthetic
  scenes cannot see it, because their interiors are homogeneous; only the heterogeneous furnace does.
- **Ray marching** reads exactly 1 at all three extinctions. Its stepping bias is ≤ 0.1 % at voxel/8 and ≤ 0.2 % at voxel/4, and voxel/2 vs voxel/4 differ by 0.08 %
  on the sunlit cloud. It costs 2× null scattering at voxel/2 and 3.5× at voxel/4.

## (c) Time per frame (real cloud, 512 bounces, ray march at voxel/4, Apple M5 Pro)
- **Measured:** CPU 320×180 at 64 spp, alone: 19.3 s. CPU 640×360 at 1024 spp: about 88 min wall while other agents captured
  (about 21 min alone). Metal 640×360 at 128 spp: 149 s, against about 154 s extrapolated for CPU. **GPU ≈ CPU on this Mac.**
- **1280×720, extrapolated, either device alone:** about 80 min at 1024 spp, about 20 min at 256 spp. Contention multiplies this by
  3–4, step voxel/2 halves it, and density and box size move it by about 2×.
- **So for the card:** all 20 frames is one idle night at 1024 spp, or about 7 h at 256 spp. Cross-checking 3–5 frames is cheap.

## Conventions that needed care, and limits
- Sun strength is exactly W/m² irradiance (no hidden π), and `angle` is the angular diameter. Cycles bounces = `maxBounces` − 1.
- Y-up to Z-up is one rotation, (x, y, z) → (x, −z, y). The sky's u and v are computed in the shader, so the map is not resampled.
- Blender 5 writes multipart EXR. The pathtracer clips the medium at the grid box and Cycles does not, so keep an empty border voxel.
- Defaults overridden: clipping 0.001, HALF precision, indirect clamp 10, light threshold, adaptive sampling, denoiser,
  Blackman-Harris filter (now a 1 px box), AgX view.
- **Cycles cannot give** a same-pass transmittance (`volume_majorant` is the majorant's; `--alpha` renders again, capped at 128 spp)
  or any split beyond Volume Direct (single) vs Indirect. A sun/sky split needs two renders. Rayleigh and Fournier-Forand are not validated.

## Smoke test, exporter, open problems
- **Smoke test:** EmberGen cloud_02 at 4 m (329×173×476), σt 0.6/m, albedo 0.99, HG 0.8, sun at 40°. Previews in `smoke/`:
  `preview-1024spp-march.jpg`, `preview-128spp-march-gpu.jpg` (thick body within 0.25 % of the CPU frame) and
  `preview-1024spp-nullscattering.jpg` (bright, speckled).
- **Exporter:** `density.f32` = `DensityGrid.density` as is (origin = min, extinctionScale = densityScale, empty margin);
  `sky.pfm` = `SkyBake.env` as RGB, bottom row first; `sun` = sunDirection (toward the sun) and `SkyBake.sun`; camera = `PtLookAtCamera`; `maxBounces` = maxDepth.
- **Open:** the owner's pathtracer also uses delta and ratio tracking against brick majorants, so run `hetero-furnace-e0.6` on it
  before Phase 1 trusts it. The Blender bias is not reported upstream yet.
