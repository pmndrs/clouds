# Local release preview and remaining gates

The 2026-09-18 instruction authorizes implementation through P6 while a dedicated
agent investigates volume quality. These are **unpublished preview packages**,
not a production release or an accepted performance preset.

See the [local evidence](p5-p6-evidence.md), [preview changelog](preview-changelog.md) and [attribution](attribution.md).

## Reproduce

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build:packages
pnpm pack:preview
pnpm check:consumer
```

The last command installs the tarballs into an independent consumer, builds all
public entry points without workspace aliases, checks declarations (NodeNext for ordinary entries, Bundler for the optional
upscaler whose upstream declarations omit file extensions),
and audits the vanilla/layer dependency boundaries. It uses cached dependencies
(`--offline`) and does not publish or run dependency lifecycle scripts.
If a pinned package is absent from the local pnpm store, use
`pnpm check:consumer -- --online`; this keeps lifecycle scripts disabled while
allowing the exact pinned registry dependencies to be fetched.

Archives and SHA-256 inventory are in `artifacts/release/`. The matching upscaler
snapshot and provenance note are included for optional FSR evaluation. The
root override is important: upstream and the user's port share version 0.2.0,
but they have different constructors. Ordinary clouds and layers need no FSR
installation or import.

## Supported preview contract

- WebGPU desktop, Three.js 0.186.0, conventional zero-to-one perspective depth.
- Framework-free Three.js first; React 19.2.3 with R3F 10.0.0-alpha.5 wrappers.
- ESM packages with TypeScript declarations; names are unreserved local placeholders.
- Explicit frame ownership, resize and disposal; one runtime per camera/view.
- Independent lightweight layer, volumetric cloudscape/object, fixed environment
  capture, and opt-in reconstruction entries.
- Dense asset transport and CPU mesh conversion are separate from rendering.

## Release gates still open

| Gate | Required evidence |
| --- | --- |
| Volume quality | Dedicated analytic/voxel reference, orbit/zoom and motion audit; original user artifact retest; integrate only a validated correction |
| Distance and shadows | Persistent distant cloud/weather identity, continuous near/far handoff and matched shadow contribution |
| Atmosphere | Calibrated sky/cloud lighting and physical aerial-perspective composition |
| Temporal/performance presets | Cloud wind, real motion/disocclusion scenes and net frame benefit versus a fair native baseline |
| Compatibility | Windows/RTX 3060 run; unavailable local hardware is not a pass |
| Assets expansion | Blender 5.1.1 static mesh → dense proof is available; no VDB/sparse/export claim without an actual supported reader/writer round trip |
| API freeze | Human R5 ergonomics review and stable rendering contracts |
| Publication | Separate explicit release decision; nothing has been published |

The implementation reaching this preview checkpoint does not close earlier
visual gates. Record technical checks and human observations separately in
[project status](project-status.md) and the [human review guide](human-review.md).
