# Research summary and recommended direction

Checked 2026-09-15. This is the first research pass, with three lower-cost research agents covering rendering, volume assets, and integrations. No candidate was built or benchmarked in this phase. Port effort is qualitative, not an estimate of elapsed development time.

## Direction confirmed with the author

- Desktop WebGPU quality with scalable presets.
- Vanilla means plain JavaScript using Three.js, followed by R3F v10 bindings.
- Volumetric clouds and distant clouds are both primary. Distant clouds may be volumetric or simple 2D.
- Procedural generation and authored VDB are density sources feeding one volumetric renderer. Authored sources include Houdini, Blender, Maya and our mesh-to-volume tooling.

## What the research changes

**Your memory of Decima's voxel direction is right.** Nubis³, presented in 2023, describes voxel-authored clouds for both sky and explorable environments. Earlier Nubis work provides the procedural weather/noise lineage. This supports a renderer with multiple density sources, including authored shape plus procedural detail. It does not imply that VDB itself is the required GPU format. Nubis³ is the latest detailed public Decima cloud presentation found in this pass, not a claim about all current internal engine work. [Guerrilla's Nubis³ abstract](https://www.guerrilla-games.com/read/nubis-cubed)

**Takram is a strong reference, with an important backend distinction.** Its existing cloud package is GLSL/WebGL; the repository lists its WebGPU cloud rewrite as work in progress. Study its integration, reconstruction and shadows, while tracking the rewrite rather than assuming the published package meets our WebGPU target. [Takram status](https://github.com/takram-design-engineering/three-geospatial)

**Three.js already supplies both useful starting points.** `SkyMesh` is a TSL dome with lightweight 2D cloud controls; the volume-cloud example demonstrates a ray-marched 3D texture. The sky example is scene geometry, not inherently a patch to an environment map. Neither example alone is the intended full cloud library. [SkyMesh](https://threejs.org/docs/pages/SkyMesh.html), [volume-cloud example](https://github.com/mrdoob/three.js/blob/dev/examples/webgpu_volume_cloud.html)

**PicoVDB is worth a bounded experiment.** It has TypeScript/WGSL support and conversion tooling, but its mesh converter produces a level set. Density semantics, filtering and TSL integration need proof before selecting it as the runtime dependency. Compare it with dense textures using the same authored cloud. [PicoVDB](https://github.com/emcfarlane/picovdb)

**Sky integration is plausible, but composition needs an explicit owner.** `@pmndrs/sky` supplies atmosphere and environment/background integration; clouds can complement it. Its attachment behavior means the two libraries must agree how cloud radiance, sky, haze and environment capture compose. R3F v10 is currently an alpha target, so pin a tested version rather than claiming stable v10 support. [pmndrs/sky](https://github.com/pmndrs/sky), [R3F releases](https://github.com/pmndrs/react-three-fiber/releases)

## Recommended library shape

Updated 2026-09-16: [voxel-first with procedural generation](approach-decision.md) is approved. Prefer TSL where useful and use embedded WGSL/direct WebGPU freely; the [local upscaler source inspection](research/upscaler-integration.md) establishes the integration pattern. M5 Pro/RTX 3060 are the initial hardware, R3F v10 is required, and MIT under pmndrs/clouds is selected. The volumetric and 2D/lower-cost runtimes may be independent systems. VDB is optional interchange, WASM is allowed for loading/generation/export, and sky integration should prioritize environment composition with coordinated sky/R3F changes available.

One Three.js WebGPU/TSL volumetric integrator; interchangeable procedural and authored-volume sources; a lightweight distant 2D layer; optional background/environment and sky integration; thin React bindings. Use monorepo boundaries for shared descriptions, Three.js rendering, React, asset loading, and offline tooling. Begin usage modes as exports rather than multiplying packages for every source/presentation combination.

The first technical gate should prove voxel coverage from horizon to inside-cloud, opaque scene-depth composition, shadow casting/receiving and mixed GPU resource lifecycle in plain Three.js. Develop volumetric and simple distant-cloud slices as the two primary experiences. Keep a dense-volume fixture to prove that authored and procedural sources use the same rendering contract. Set frame/memory budgets on the selected hardware before specifying production quality targets.

## Port shortlist

| Candidate | Best role | Reuse position |
| --- | --- | --- |
| Official Three.js volume and sky examples | TSL implementation starting points | MIT; limited feature scope |
| Takram clouds | Mature cloud integration reference | MIT; existing cloud renderer needs WebGPU work |
| Meteoros | Native classic Nubis reference | MIT Vulkan project; substantial adaptation |
| Frostnova | Native Nubis³ voxel experiment | Missing clear license/asset permission in reviewed material; study methods, do not assume copy rights |
| PicoVDB / WGSL NanoVDB | Sparse storage and traversal experiment | Apache-2.0; verify density and host integration |
| Decima talks / Unreal documentation | Production technique references | Public descriptions are not permissive engine source |

Exact repository links, source evidence and caveats are in [volumetric research](research/volumetric.md), [asset research](research/volume-assets.md), and [integration research](research/integrations.md).

Remaining discussion: numerical budgets/browser versions, authored asset scope and environment refresh policy. See the [questions and decisions](archive/questions.md). Detailed execution/orchestration plans follow these decisions.
