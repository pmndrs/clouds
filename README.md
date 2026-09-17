# WebGPU Clouds

Voxel-first cloud library for Three.js WebGPU, with independent lightweight clouds and later R3F v10 bindings. P2 adds a cloudscape viewer with a bounded world of voxel formations, alongside the first-cloud reference and independent 2D layer. These are correctness prototypes with provisional appearance and APIs.

## Implementation planning

- [Overall status: what works now and what comes next](docs/project-status.md)
- [Human review checklists and questions for every stage](docs/human-review.md)
- [Phases and visual review points](docs/implementation-plan.md)
- [Agent orchestration and cost controls](docs/agent-orchestration.md)
- [Work packets, dependencies and execution queue](docs/implementation-work-queue.md)

P0 is accepted on the local WebGPU backend. See [integration decisions](docs/decisions/integration.md) and [stage evidence](docs/p0-evidence.md).

P1 technical evidence, timing scope and remaining limitations are recorded in [first-cloud evidence](docs/p1-evidence.md). Human shape review is separate from technical acceptance.

P2 implementation and current review limits are recorded in [cloudscape evidence](docs/p2-evidence.md).

## Specification and research

Start with the [research summary](docs/research-summary.md), [draft library specification](docs/library-spec.md), and [questions / decision log](docs/questions.md).

Selected direction: [voxel-first hybrid cloudscapes and distance coverage](docs/approach-decision.md).

New reference: [mixed TSL/direct WebGPU and upscaler integration](docs/research/upscaler-integration.md).

Research tracks:

- [Volumetric rendering, Decima, Unreal and port candidates](docs/research/volumetric.md)
- [VDB, textures and mesh conversion](docs/research/volume-assets.md)
- [Three.js, R3F and sky integration](docs/research/integrations.md)

Research was gathered on 2026-09-15. Upstream development branches are moving targets; exact releases and source revisions must be pinned before implementation. Recommendations and unverified claims are marked separately from source-backed findings.

## Run the lab

Requires Node.js 22 and pnpm 10.33.0.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open a WebGPU-enabled desktop browser:

- [Cloudscape](http://127.0.0.1:5173/cloudscape/): a 40-second ground-to-cloud flight, world coverage controls, a shared voxel atlas, conservative GPU lookup, and flight-view timing comparisons.
- [First voxel cloud](http://127.0.0.1:5173/clouds/): three generated forms, synthetic authored form, ground/side/inside cameras, fly-through slider, density/size/sun controls, both reference shadow directions, GPU correctness checks and optional timing sweep.
- [Independent 2D layer](http://127.0.0.1:5173/layer-only/): animated thin clouds, coverage/density controls, preserved background and opaque depth.
- [P0 integration lab](http://127.0.0.1:5173/): known-pattern GPU sharing checks and sky/environment fixture.

`pnpm check` runs type checking, unit tests and a production build of all four pages. Use **Export evidence** and **Save image** in the voxel viewer. **Measure GPU presets** measures the cloud compute pass at 1080p/1440p and three internal scales. Live CPU submission measurements are separate from GPU timing. The half-resolution preview currently scales the entire reference scene spatially; FSR integration is planned for P4.
