# Platform completion preview

Updated 2026-10-08. This note records the P5/P6 implementation boundary and
the checks run for the local, unpublished preview. It is a readiness handoff,
not a release decision.

## Integration status

- `@clouds/three/environment` owns a separate cloud runtime and restores the
  caller's render target, cube face, mip level, MRT and XR state after a
  refresh. Settings copied from a source runtime include view/light sampling,
  detail filtering and the coarse/fine refinement state. Capture-specific
  camera-distance fading and reference geometry shadows remain disabled.
- An environment refresh is explicit. Settings or sun changes mark the
  capture stale; attached scenes follow the new PMREM texture on the next
  successful refresh. A capture is an independent fixed-probe pass and does
  not claim persistent-world coarse-atlas parity, local-object reflections,
  automatic refresh scheduling or temporal capture history.
- `@clouds/react` uses the caller's R3F WebGPU renderer and frame loop. Frame
  driving options are committed through refs, so an interrupted React render
  cannot change an already-running view. Partial settings skip `undefined`
  values, and vector settings are copied into runtime-owned vectors.
- `CloudLayer` is an independent mesh runtime. Its update callback observes
  committed enabled state, and manual disposal detaches the mesh and stops
  subsequent updates. The layer does not import the volumetric, asset or FSR
  runtimes.

## Reproduction checks

From the repository root:

```sh
pnpm check
pnpm build:packages
pnpm pack:preview
pnpm check:consumer
```

`check:consumer` installs the packed archives into an independent, offline
consumer with lifecycle scripts disabled. It bundles each public entry point,
checks declarations with Bundler and NodeNext resolution where supported, and
checks that vanilla and layer entries do not pull React, FSR, or workspace
sources. The optional reconstruction entry retains its documented Bundler
resolution limitation from the upstream declarations.

If the host pnpm store does not contain one of the pinned registry tarballs,
run `pnpm check:consumer -- --online`. This keeps dependency lifecycle scripts
disabled while allowing pnpm to fetch the exact pinned versions; offline mode
remains the default for repeatable local checks.

## Verified handoff — 2026-10-08

The current platform packet has 122 unit tests passing, with aggregate voxel
assertions retained after reducing test concurrency to avoid CPU contention.
TypeScript, the production build, and the online packed consumer check pass.
P4 has 29 GPU checks and 15 timing smoke rows at 320×180 in
[`reconstruction-smoke-2026-10-08.json`](research/reconstruction-smoke-2026-10-08.json):
five modes: native, bilinear, cloud-only and FSR1 are guide-free; FSR3 uses
guides. Both comparison runtimes remain allocated.
The React dense adapter reached exact zero optical parity after field, camera,
and remount operations.

The platform packet includes realistic reference appearance, GPU density bake
and optical-depth cache, ray jitter and multiple-scattering approximation,
`DensityCloud`/`useDensityCloud`, and the CPU density source route. These are
technical integrations and preview evidence, not accepted visual presets.

## Remaining limits

The preview does not establish visual cloud-quality acceptance, persistent
coarse/fine transition quality, atmosphere correctness, temporal wind,
long-duration multi-view or device-loss recovery, Windows/RTX compatibility,
or publication readiness. Persistent-world/coarse-atlas rendering remains an
experimental implementation path; the environment adapter intentionally
captures with its own standalone runtime and must not be read as evidence that
the persistent distance/shadow gates are closed.

Chrome verification subsequently succeeded for the detailed and lower-density
Houdini candidates. All 12 analytic transport/cache checks pass with no captured
GPU errors; visual realism and dynamic banding acceptance remain open. See
[realism progress](realism-progress.md) for evidence and the current source limits.
