# P7-C Publish-ready packages
Status: ready for review
Changed:
- `packages/runtime/package.json`, `packages/{three,react}/package.json`: `exports`/`main`/`types` point at `dist/`; runtime has subpaths `.`, `./generate`, `./import` (plus `typesVersions` for old resolvers); `files` = dist + LICENSE/README (runtime also `vendor/vdb-web-tools/{LICENSE,NOTICE}`).
- `packages/runtime/src/index.ts`: now the core entry (no `generate`, no `import` re-exports). New `packages/runtime/src/full.ts` (core + generate + import; source-only barrel, not exported).
- `git mv vendor/vdb-web-tools packages/runtime/vendor/vdb-web-tools` (LICENSE + NOTICE kept); import paths in `src/import/{convert,grid-read,index,convert.test}.ts` now `../../vendor/...`.
- `packages/react/src/index.tsx`: generate symbols from `@clouds/runtime/generate`. `@clouds/three` needed no change (core only).
- New: `scripts/build-release.mjs`, `scripts/check-packed-consumer.mjs`, `tsconfig.release.json`, `packages/{runtime,three,react}/tsconfig.build.json`, `LICENSE` copies in the three packages.
- `scripts/check-bundle.mjs` rewritten to measure built dist. Root `package.json`: scripts `build:release`, `check:packed` (not on the owned list; two lines). `tsconfig.json` paths and `vite.config.ts` aliases (also not owned; needed so the lab keeps working): `@clouds/runtime` -> `src/full.ts`, plus `/generate`, `/import` -> source.
- Docs: import paths in `docs/guide/{api,authoring,getting-started}.md`; vendor paths in `credits.md`; bundle table in `quality-and-performance.md`; the three READMEs (source-only note replaced, runtime subpath list and sizes).

## Subpaths
- `@clouds/runtime` core: runtime, assets, shaders, light grid, auto-quality, dome, atmosphere, sky layer, `GpuTimer`. The sky layer imports the generator's weather/params, so the core keeps those few modules; the public generator API is not in core.
- `@clouds/runtime/generate`: volume generator, weather map, presets (`CLOUD_PRESETS`), stamping, SDF rebuilder, streaming, evolution, CPU EDT.
- `@clouds/runtime/import`: `.vdb` import (+ vendored parser).
- No `/assets` or `/dome` subpaths: both are imported by `runtime.ts`, so they cannot be separate from the core.

## Build
`node scripts/build-release.mjs [--pack] [--no-list]`: esbuild ESM per package (runtime with code splitting so subpaths share `dist/chunks/`), `tsc -p tsconfig.build.json` declaration emit in order runtime -> three -> react (three/react resolve runtime's emitted `.d.ts`), then `npm pack --dry-run` lists. `--pack` writes tarballs via `pnpm pack` (rewrites `workspace:*`) to `artifacts/release-pkgs/`.
`npm pack --dry-run` content: runtime 60 files (dist/index.js, generate.js, import.js, 3 chunks, dist/types/**, vendor LICENSE+NOTICE, LICENSE, README, package.json); three 9 files; react 6 files. No src, no tests, no vendor source.

## Bundle report (`node scripts/check-bundle.mjs`, minified, gzip)
| entry | raw | gzip | brotli |
| --- | --- | --- | --- |
| runtime core entry | 153.3 KB | **48.7 KB** (budget ok) | 41.5 KB |
| runtime/generate | 42.0 KB | 14.3 KB | 12.7 KB |
| runtime/import | 48.3 KB | 18.8 KB | 16.9 KB |
| runtime core+generate+import | 210.3 KB | 70.1 KB | 59.6 KB |
| three alone / **three-user path (+runtime)** | 11.2 / 160.8 KB | 4.1 / **51.3 KB** (budget ok) | 3.8 / 43.5 KB |
| react alone / +deps | 5.3 / 177.9 KB | 2.3 / 57.8 KB | 2.1 / 48.8 KB |
`--strict` exits 1 when the core entry or the three-user path is over 60 KB.

## Verified
- `node scripts/check-packed-consumer.mjs` -> PACKED CONSUMER OK: builds, packs, installs the three tarballs plus peers into `artifacts/packed-release-consumer/` (own pnpm workspace, `pnpm install --offline` worked from the store), `tsc` strict passes for a three example (Clouds, sharedBackend, runtime core, runtime/generate), a react example (`<Clouds>`, `<Cloudscape>`, Sky, AutoHaze) and a runtime/import example; Node imports all three runtime entries (52 core / 14 generate / 7 import exports; core does not leak subpath exports); esbuild bundles all three: no `/packages/` source leaked, three example has no react and no VDB parser, react example no VDB parser, import example has it; runtime tarball contains the vendored LICENSE/NOTICE.
- `pnpm check` exit 0 (205 tests, build); `node scripts/check-docs.mjs` 119 links 0 broken, 22 samples typecheck.

## For P7-D / the lead
- The lab still imports generate/import symbols from `@clouds/runtime` and works only through the `full.ts` alias. To use the real subpaths, change: `examples/lab/open-water/main.ts:8`, `examples/lab/plains-flight/main.ts:16`, `examples/lab/onsen/main.ts:15-17` (split: `loadCloudNoise`, `loadCloudVolume`, `uploadCloudVolume`, types `CloudVolumeAsset` stay on `@clouds/runtime`; `CLOUD_PRESETS`, `create*`, `encodeProceduralWeatherMap`, `stampCloud`, `CloudPresetName`, `StampOptions`, `StreamingUpdate`, `VolumeGenerator` move to `@clouds/runtime/generate`). Also not owned by P7-D and not changed: `evolve/main.ts:18`, `cloudscape-gen/main.ts:12`, `runtime-tests/stamp/main.ts:10`, `vdb-drop/main.ts:12` (`inspectVdb`, `importVdb`, `VdbImportError`, import types -> `/import`).
- Doc samples are typechecked through the `full.ts` alias, so a wrong subpath in a doc would not be caught by check-docs; I fixed the existing ones by hand.
- Still open: names/`private: true` (user's P7 decision; `npm publish` is blocked until removed); `pnpm-lock.yaml` out of date (P7-B note); declarations use extensionless relative imports, so strict NodeNext consumers should rely on `skipLibCheck` or Bundler resolution (same as before); `dist/` is git-ignored, run `build:release` before `check-bundle`/publish (check-bundle auto-builds when dist is missing but does not rebuild stale dist).
