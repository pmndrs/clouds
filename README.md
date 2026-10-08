# WebGPU Clouds

Realtime Nubis³-style voxel clouds for WebGPU. A renderer-agnostic core
(density, SDF sphere-trace march, voxel light grid, near/far resolution split)
with a three.js adapter first. The method is built from Andrew Schneider's
Nubis talks and Guerrilla's official Nubis Voxel Cloud Pack, which is the
development asset set.

**Current phase: Phase 0, reset and data.** The old demos are being archived
and the cloud assets are converted from the pack. See the phase plan in
[`docs/AUDIT-2026-10.md`](docs/AUDIT-2026-10.md).

## Run it

Requires Node.js 22 and pnpm 10.33.0.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open a WebGPU-enabled desktop browser at
<http://127.0.0.1:5173/flagship/>. Legacy labs from earlier phases live under
`/legacy/<name>/` (for example `/legacy/clouds/`) and are kept for reference.

Other checks: `pnpm check` runs typecheck, unit tests and the production build.

## GPU capture harness

```sh
node scripts/gpu/capture.mjs --serve --page flagship/ --shots ground,inside --out work/captures/<task-id>
```

This runs headless Chrome on the real GPU, waits for the page to report ready,
writes one JPEG per shot plus `capture.json`, and exits non-zero on page
errors. Use `--help` for options. Scratch runs go to `work/captures/scratch/`,
which is git-ignored.

## Documentation

- [`docs/AUDIT-2026-10.md`](docs/AUDIT-2026-10.md): the plan, phases and success measures.
- [`work/README.md`](work/README.md) and [`work/BOARD.md`](work/BOARD.md): how work is split, reviewed and reported, and the task list.
- [`docs/research/nubis-sources.md`](docs/research/nubis-sources.md): formulas and constants, with slide references.
- [`assets/nubis-voxel-clouds/NOTICE.md`](assets/nubis-voxel-clouds/NOTICE.md): credits and licence notice for the Nubis pack.

Earlier plans, phase evidence and research results are in
[`docs/archive/`](docs/archive/). They are kept for history only.
