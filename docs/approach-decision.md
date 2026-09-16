# Cloudscape direction: classic procedural versus voxel-first

Status: voxel-first hybrid approved by the author, 2026-09-16. No performance result is claimed. Representation, coverage and reconstruction details remain to be validated.

## Frame the actual choice

Procedural generation and voxels are compatible. The choice is whether the flagship cloudscape represents its broad structure primarily through weather maps/height profiles evaluated along rays, or through full 3D fields that we generate, author or combine. Both can use procedural noise, textures, ray marching and the same lighting principles.

VDB import/export is a separate feature. A voxel-first system can use ordinary 3D textures or custom bricks internally. A classic procedural system can also bake an exportable volume. Neither requires VDB traversal at runtime.

## Comparison

The following tradeoffs are engineering judgments to test, not measured results.

| Question | Classic procedural cloudscape | Voxel-first cloudscape |
| --- | --- | --- |
| Broad structure | Weather/type maps, altitude profiles, procedural shape/detail | Generated or authored 3D density/profile fields, with procedural detail |
| Natural strength | Broad sky coverage and continuously varying weather | Overhangs, cavities, isolated structures and fly-through composition |
| Main scaling cost | Density evaluations and light samples over long paths | Volume generation/loading, memory, traversal and lighting data |
| Animation | Advect fields/noise and change profiles | Move/deform fields, regenerate regions or add procedural motion; topology changes cost work |
| World coverage | Extend maps and repeating noise over a region | Distribute bounded volumes or manage spatial tiles/bricks; avoid a single world-sized dense texture |
| Existing foundations | Classic Nubis ports and layered-cloud renderers | Same integration mathematics plus voxel-specific acceleration and data management |
| Main project risk | Good broad skies but a constrained path to arbitrary 3D structure | An impressive local volume that does not scale to the larger cloudscape |

Guerrilla's [Nubis³ description](https://www.guerrilla-games.com/read/nubis-cubed) explicitly describes voxel clouds used for both ground-view skies and exploration, and identifies distance-field traversal, modeling, up-resolution and lighting acceleration as important work. This supports the direction; it does not establish that a browser port will meet our budgets.

## Selected direction: voxel-first with procedural generation

Use a voxel-first cloudscape as the flagship direction. Generate low/mid-frequency structure into 3D fields, add detail during sampling, and reuse the volumetric integration foundation for imported assets. Generation may happen on the GPU, in optional WASM workers, or offline according to update frequency and workload. Do not assume a real-time fluid simulation is required to produce physically informed cloud shapes.

Keep a small classic procedural reference for comparison and useful reusable pieces. Do not require shipping the complete classic system before trying the voxel approach. Existing permissive WebGL/native code can supply a starting framework, but a port still needs explicit changes to data layout, Three.js composition, lighting caches and temporal updates. See the [port inventory](research/volumetric.md) for licensing and implementation limits.

Keep two independently usable runtime families:

- Volumetric cloudscapes and bounded cloud objects, with generated/imported/hybrid sources.
- Simple 2D or other lower-cost clouds, with their own renderer and optional shared weather/lighting controls.

Do not promise seamless automatic switching between these representations until visual continuity is demonstrated.

## Evidence needed to validate the selected architecture

Compare both approaches under the same camera paths, lighting, output resolution and approximate cloud coverage. Record generation time separately from rendering time, along with upload bytes, peak CPU/GPU memory and steady-state costs.

The voxel experiment must show a broad horizon and multiple spatial cloud regions as well as an interior fly-through. Include regeneration or movement of a region, empty-space traversal, one imported-density fixture and sky/environment composition. A bounded dense texture is a useful correctness fixture; it cannot alone validate the world-scale architecture.

Use the M5 Pro and RTX 3060 for initial measurements. If residency, generation, traversal or lighting is limiting, adjust the representation or far-field strategy within the selected voxel-first hybrid design. Numerical budgets remain open, so no pass/fail numbers are invented here.

## WASM and interchange

WASM is welcome for loaders, generators, mesh conversion and volume writers. Existing PicoVDB work includes a TypeScript loader, WGSL sampling, modeling and converters; this makes it a useful candidate, but does not by itself establish browser OpenVDB export. Verify the writer and supported grid types before choosing dependencies. [PicoVDB](https://github.com/emcfarlane/picovdb)

A round-trip export should preserve density, world transform, voxel spacing and scale in a DCC. Exporting a procedural source also requires chosen bounds, resolution and time; an unbounded animated cloudscape cannot be captured as one finite static grid without those choices.

## Sky integration and public write-up

Prioritize a cloud contribution to sky/environment generation, with camera rendering handled separately when parallax matters. The author maintains sky and R3F, so coordinated integration hooks can be designed rather than treating the present API as immutable.

A useful public story would be the design and measured results of voxel cloudscapes in Three.js/WebGPU: generation, memory, traversal, lighting, atmosphere and authoring. Existing native experiments are already in the research inventory; a claim that nobody has done voxel clouds, or that this is the first web implementation, is not established. Demonstrable results provide a stronger basis for the post than a priority claim.


## Coverage from inside clouds to the horizon

Voxels are not restricted to close views. Nubis³ explicitly targets both ground-view volumetric skies and flight through clouds ([official description](https://www.guerrilla-games.com/read/nubis-cubed)). The close-up emphasis in the comparison describes an advantage, not a distance limitation.

Proposed coverage policy, to validate:

| Region/use | Representation | Main controls |
| --- | --- | --- |
| Inside/near a formation | Detailed voxel field + generated detail | Accurate bounds, conservative skipping, self/scene shadows, responsive history |
| Medium and distant formations | Same spatial cloud structure at lower detail | Projected voxel size, filtered density/detail, adaptive steps, cheaper lighting |
| Very far or thin high coverage | Optional independent 2D procedural layer; retain voxels where shape needs them | Weather continuity, horizon projection, atmosphere and sun response |

Use screen-space error/projected size rather than hardcoded distance bands alone. A large distant storm may need more detail than a small nearby wisp. Candidate residency schemes include distributed bounded volumes, sparse bricks and camera-centered levels of detail; selection follows profiling. Sparse layout is not automatically faster for broadly occupied cloud fields.

Density mipmapping and representation transitions must preserve apparent extinction and silhouettes; naive averaging can change optical thickness. Transition the density representation or use a consistent optical composition strategy rather than overlaying two copies. Show stable horizon coverage while flying toward a previously distant formation. A procedural volumetric far field remains optional; the independent 2D layer is an accepted useful system, not a mandatory replacement for all distant voxels.
