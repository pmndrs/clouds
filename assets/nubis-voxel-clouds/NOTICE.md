# Nubis Voxel Clouds Pack (subset)

- **Author:** Andrew Schneider / Guerrilla Games.
- **Released with:** the *Nubis, Cubed* talk (SIGGRAPH 2023 Advances in Real-Time
  Rendering), slide 191.
- **Original download:** <http://bit.ly/NubisVoxelCloudPack>
  (`NubisVoxelCloudsPack.zip`, release 2023-08-10).
- **License:** the pack ships without a license file. The project owner treats
  it as MIT, as published with the talk, for this non-commercial project.
  Credit the author when using it.

## Included here

- `Code Fragments/VoxelCloudSampler.cg`: the shipping sampler and up-rez helpers.
- `Noise/`
  - `NubisNoiseGenerator.hda`: Houdini 19.5+ noise generator.
  - `Examples/TGA/`: 128 z-up RGBA8 slices of the 128³ voxel cloud noise.
- `NVDFs/Examples/{ParkouringCloud,StormbirdCloud}/TGA/modeling_data.*.tga`:
  64 z-up 512×512 RGBA8 slices each.
  - R: dimensional profile
  - G: detail type (0 = wispy, 1 = billowy)
  - B: density scale
  - A: unused

## Left out

- The 8-bit SDF slices (`field_data.*.tga`, about 51 MB).
- The VDB copies (about 126 MB).

The full pack is extracted locally at `artifacts/research/nubis-pack/`.
Runtime assets (cropped NVDF and higher-precision SDF) are generated from it by
the Phase 0 converter.
