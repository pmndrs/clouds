# Credits and licences

This project stands on other people's work. In order of how much of it they carry:

## Nubis and Guerrilla Games

- **The method.** Andrew Schneider's Nubis talks: *Nubis Cubed* (SIGGRAPH 2023, Advances in Real-Time Rendering, Horizon Forbidden West: Burning Shores), *Synthesizing Realistic Clouds for Video Games* (2024), and the earlier *Nubis Evolved* (2022) and the Horizon Zero Dawn talks (2015, 2017). The dimensional profile, detail type and density scale (NVDF), the SDF sphere-trace march, the voxel light grid, the near/far resolution split, the up-rez noise erosion and the lighting model are theirs. Formulas and constants with slide numbers are in [`docs/research/nubis-sources.md`](../research/nubis-sources.md).
- **The data.** The Nubis Voxel Cloud Pack by Andrew Schneider / Guerrilla Games, released with the talk (slide 191, 2023-08-10). The development assets (`assets/clouds/parkouring/`, `stormbird/`, and the noise) are converted from it, and the density function follows the pack's `VoxelCloudSampler.cg`. The pack ships without a licence file; the project owner treats it as MIT, as published with the talk, for this non-commercial project. Credit the author when you use it. Details: [`assets/nubis-voxel-clouds/NOTICE.md`](../../assets/nubis-voxel-clouds/NOTICE.md).

## Disney Animation: the WDAS cloud

`assets/clouds/disney/` is converted from `wdas_cloud_quarter.vdb`, part of the Walt Disney Animation Studios Cloud Data Set.

- Copyright 2017 Disney Enterprises, Inc., licensed **Creative Commons Attribution-ShareAlike 3.0 Unported (CC BY-SA 3.0)**. The volumetric cloud model was built from a reference photograph by Kevin Udy (Colorado Clouds Blog), also CC BY-SA 3.0. Source: <https://www.disneyanimation.com/resources/clouds/>.
- The converted files are a **derivative work distributed under the same licence**; the repository's MIT licence does not apply to them. If you ship them, ship the attribution and keep them under CC BY-SA 3.0. Simplest for a commercial or closed project: leave them out (they are optional).
- Changes made: resampled from 1.46 m source voxels to 8 m, cropped and rotated (`--rotate-y 270`), converted to profile, detail type, density scale and SDF with `scripts/vdb/vdb_to_nvdf.py --mode fog --world-scale 1.75 --margin 1`. Full text: [`assets/clouds/disney/NOTICE.md`](../../assets/clouds/disney/NOTICE.md).
- The OpenVDB `bunny_cloud.vdb` and `cloud.0001.vdb` test clouds are used only locally (`assets/clouds/local/`, git-ignored).

## WebVDB: the `.vdb` parser

`vendor/vdb-web-tools/` is the `.vdb` parser from the author's own WebVDB project (<https://github.com/DennisSmolek/WebVDB>), **Apache License 2.0**, vendored at commit
`9a8c1a5aa5c8242722904e91780224570aac7064`. The in-browser importer ([`importVdb`](api.md#import-a-vdb)) uses it. Changes from upstream (a `select` option,
constant-tile support, the pre-222 leaf layout, OpenVDB inactive-value defaults and a new Blosc lz4 decoder) are listed in
[`vendor/vdb-web-tools/NOTICE`](../../vendor/vdb-web-tools/NOTICE); the licence is [`vendor/vdb-web-tools/LICENSE`](../../vendor/vdb-web-tools/LICENSE).
**A distribution that includes the importer must carry that LICENSE and NOTICE.** The importer is a dependency-free import of those files, so a bundle that tree-shakes `importVdb` away does not include them.

## pmndrs

- **[`@pmndrs/sky`](https://github.com/pmndrs/sky)** (MIT) provides the atmosphere: the transmittance, sky-view and aerial-perspective LUTs, the sun, and `applyHaze`. All sun and ambient light in the clouds comes from its LUTs; there are no hard-coded light colours.
- **[`@pmndrs/upscaler`](https://github.com/pmndrs/upscaler)** (MIT) is the pattern for the three-WebGPU interop: obtaining three's initialised `GPUDevice` and native texture handles, compiling raw WGSL compute pipelines, submitting on the same queue, and returning outputs as three `StorageTexture`s ([`docs/research/upscaler-integration.md`](../research/upscaler-integration.md)). It is a development dependency of this repository, not of `@clouds/runtime` or `@clouds/three`.
- **three.js** (MIT), **React** and **React Three Fiber** (MIT) are peer dependencies of the adapters.

## References (read, not copied)

- **Tidewater** and **Sky Pro** (the Sky Pro author has given permission, project decision log, 2026-10-08) are the visual and performance bar, built on the decade-old Horizon Zero Dawn recipe. They were inspected as references (architecture, math, screenshots); no code or assets were copied: [`docs/research/tidewater-density-reference.md`](../research/tidewater-density-reference.md), [`docs/research/tidewater-transport-reference.md`](../research/tidewater-transport-reference.md), [`docs/research/skypro-demo-reference.md`](../research/skypro-demo-reference.md).
- Hillaire's physically based sky and multiple-scattering work, Wrenninge's multiple-scattering octaves, and the other primary sources in [`docs/research/cloud-quality-bench.md`](../research/cloud-quality-bench.md) are implemented as local concepts. No Shadertoy shader was copied.

## Our own

The repository code is MIT ([`LICENSE`](../../LICENSE)). The hero clouds in `assets/clouds/heroes/` and `assets/clouds/houdini-test/` are original work generated by the scripts in
[`scripts/vdb/`](../../scripts/vdb/README.md) (Houdini Indie was used to run them; Houdini is not redistributed). Blender is an external tool and is not redistributed.
