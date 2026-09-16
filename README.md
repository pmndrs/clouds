# WebGPU Clouds

Voxel-first cloud library for Three.js WebGPU, with independent lightweight clouds and later R3F v10 bindings. Development is at P0: the integration lab runs; the volumetric cloud renderer is next.

## Implementation planning

- [Phases and visual review points](docs/implementation-plan.md)
- [Agent orchestration and cost controls](docs/agent-orchestration.md)
- [Work packets, dependencies and execution queue](docs/implementation-work-queue.md)

P0 is accepted on the local WebGPU backend. See [integration decisions](docs/decisions/integration.md) and [stage evidence](docs/p0-evidence.md).

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

Open http://127.0.0.1:5173 in a WebGPU-enabled desktop browser. The lab contains known-pattern GPU sharing checks and a sky/environment fixture, not cloud rendering yet. `pnpm check` runs type checking, unit tests and a production build. Use **Export report** for settings/results and **Save image** for the current view. CPU submission measurements are explicitly separate from GPU time.
