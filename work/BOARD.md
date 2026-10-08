# Board

Status key: `[ ]` open · `[~]` claimed · `[r]` in review · `[x]` done · `[!]` blocked.
The protocol is in [README.md](README.md). Phase goals and measures are in
[docs/AUDIT-2026-10.md §4](../docs/AUDIT-2026-10.md).

## Done by the orchestrator

- [x] P0-00 Bump @pmndrs/sky 0.5.0, @pmndrs/upscaler 0.5.0 and three 0.186.1. Fix the adapter for the upscaler's RGBA change. Vitest resolves workspace packages from source.
- [x] P0-00b Headless GPU capture harness (`scripts/gpu/capture.mjs`), page contract (`examples/lab/harness/clouds-contract.ts`) and self-test page (`examples/lab/gpu-smoke/`).

## Phase 0 — Reset and data

These tasks run in parallel. File ownership is disjoint; respect it.

### [ ] P0-01 Move the old labs under `examples/lab/legacy/` · Haiku
- **Owns:**
  - `examples/lab/{authored,clouds,cloudscape,coverage-study,density-study,layer-only,lighting,lighting-bench,lod-study,quality-bench,react,react-density,realism,reconstruction,scenes,three}/`, moved to `examples/lab/legacy/<same name>/`
  - `examples/lab/index.html` and `examples/lab/main.ts`, which become a short index linking the new pages and the legacy ones
  - the `build.rollupOptions.input` block of `vite.config.ts`. Keep the `flagship` and `gpu-smoke` entries exactly as they are.
- **Does:**
  - Fix relative imports after the move (one more `../`).
  - Update the lab links.
  - Leave `examples/lab/harness/`, `examples/lab/style.css`, `examples/lab/flagship/` and `examples/lab/gpu-smoke/` in place.
- **Acceptance:**
  - `pnpm check` passes (typecheck, 129+ tests, build including every legacy page).
  - `node scripts/gpu/capture.mjs --serve --page legacy/realism/ --size 1280x720 --timeout 90 --out work/captures/scratch/legacy-realism` loads with no page errors. A ready timeout is acceptable here, because legacy pages lack the contract; report what happened.

### [ ] P0-02 Nubis pack converter · Sonnet
- **Owns:** `scripts/nubis/**` and `assets/clouds/**` (generated output plus a `README.md`).
- **Input:**
  - `assets/nubis-voxel-clouds/` (committed modeling slices and noise)
  - the full pack at `/Users/dex/Developer/WebGPUClouds/artifacts/research/nubis-pack/extracted/Nubis Voxel Clouds Pack/`. You need its `field_data` SDF slices for validation only.
- **Does:** a Node script (`node scripts/nubis/convert.mjs`, no new dependencies) that decodes the RLE TGA slices and writes:
  - `assets/clouds/<parkouring|stormbird>/`
    - `nvdf.bin`: rgba8, cropped to the occupied bounds plus an 8-voxel margin, x fastest, then y (the map's second axis), then z (slice, up)
    - `sdf.bin`: r16 unorm signed distance in metres, regenerated at full precision from `profile > 0` with an exact 3D Euclidean distance transform. Encode with the pack's convention, −256…4096 m mapped to 0…1.
    - `cloud.json`: dims, voxel size (assume 8 m on every axis; see the check below), crop offset within the 512×512×64 grid, world-space bounds in metres with z-up source axes, channel semantics, SDF encoding
  - `assets/clouds/noise/`
    - `noise.bin`: rgba8 128³ with a full mip chain, box filtered with wrap
    - `noise.json`
- **Acceptance:**
  - Unit tests (`scripts/nubis/*.test.mjs`, run by vitest) cover TGA decoding (RLE and raw) and the EDT on a sphere and a box against analytic distances.
  - **Voxel-size check:** sample 10k voxels near the surface (|d| < 200 m). Your SDF must agree in sign with the pack's 8-bit `field_data` everywhere except within one quantum (17 m) of the surface. The median absolute difference must be ≤ 17 m. Report the numbers. If 8 m doesn't fit, find the voxel size that does and report it; this is the real test of the assumption.
  - Each cloud's output is under 4 MB. The script is deterministic: running it twice gives identical bytes.
- **Note:** the runtime maps world (x, y-up, z) to texture (x, z, y). Write the axis convention into `assets/clouds/README.md`.

### [ ] P0-03 Flagship shell page and GPU timer · Sonnet
- **Owns:**
  - `examples/lab/flagship/**`
  - `packages/runtime/**`, a new renderer-agnostic package `@clouds/runtime`: `package.json`, `src/index.ts`, `src/gpu-timer.ts` plus test
  - the `@clouds/runtime` alias line in `vite.config.ts` and the path in `tsconfig.json`, adding only those lines
- **Does:**
  - `examples/lab/flagship/`: three `WebGPURenderer` with `@pmndrs/sky` 0.5 (`Sky`, `attach`, `compileAsync`, `update`; read `node_modules/@pmndrs/sky/README.md`), a large ground plane, a continuous animation loop, and orbit plus free-fly camera (WASD + mouse). Controls (small DOM panel, no framework): time of day, render scale, quality.
  - **HUD:** fps, frame ms, and GPU ms per named pass. Three's own scene render goes through `renderer` timestamp tracking; cloud passes go through `GpuTimer`.
  - **`GpuTimer`** (`packages/runtime/src/gpu-timer.ts`): takes only a `GPUDevice`, no three imports.
    - `beginFrame()`, `passTimestampWrites(name)` → `GPUComputePassTimestampWrites | undefined`, `endFrame(encoder)`
    - non-blocking readback through a ring of buffers, rolling averages
    - degrades to no-ops without `timestamp-query`
  - **Bookmarks** in `examples/lab/flagship/bookmarks.ts`: `ground`, `edge`, `inside`, `above`, `backlit`, each a camera position, target and time of day. Define them relative to a cloud volume placeholder whose bounds are a constant, so P1 can swap in the real cloud bounds.
  - **URL query:** `bookmark`, `time`, `scale`, `quality`.
  - **Contract:** implement it through `installCloudsHarness`; `report()` returns `{ gpuMs, frameMs, renderSize, bookmark }`.
  - A clearly marked hook where P1's cloud pass goes, a function the frame loop calls with renderer, camera, sky and timer. It must not block the frame loop.
- **Acceptance:**
  - `pnpm typecheck` and `pnpm test` pass, including a `gpu-timer` unit test with a mocked device.
  - `node scripts/gpu/capture.mjs --serve --page flagship/ --shots ground,edge,inside,above,backlit --out work/captures/P0-03` exits 0 with 5 captures, each showing sky and ground from that bookmark.
  - `report.gpuMs` has a non-zero scene entry.
  - Frame-time stability: time of day animates during capture, and no frame exceeds 1.5× the median after warm-up. Add a `?animateTime=1` mode and record `frameMs` p50/p95 in the report.

### [ ] P0-04 Tidewater reference captures · Sonnet
- **Owns:** `work/captures/P0-04/` and `work/reports/P0-04.md`. Read-only access to `/Users/dex/Developer/tidewater` (MIT; do not modify it).
- **Does:**
  - Run Tidewater's dev server and capture its clouds at 4 views comparable to our bookmarks: ground looking up at cumulus, distant horizon, low sun with backlit clouds, and the highest viewpoint reachable (boat or hill).
  - Use `scripts/gpu/capture.mjs --url ... --headed` if needed, or drive it through CDP.
  - Find how to set the time of day and camera: URL params, debug UI, or `window` globals.
- **Acceptance:** ≥ 3 captures at 1920×1080, with a report giving the sun elevation, camera height, FOV and exact steps to reproduce each. If a view is impossible, say why. This is the visual bar for P1–P3.

### [ ] P0-05 Archive the old plan docs · Haiku
- **Owns:** `docs/` (except `docs/AUDIT-2026-10.md` and `docs/research/`), and `README.md`.
- **Does:**
  - Move these to `docs/archive/`, fixing any links that break:
    - `agent-orchestration`, `human-review`, `implementation-plan`, `implementation-work-queue`, `next-milestones`
    - `p0-evidence` through `p5-p6-evidence`, `p2-density-review`, `p2-lod-evidence`, `p4-review`
    - `platform-completion`, `project-status`, `realism-progress`, `release-preview`, `preview-changelog`, `lighting-isolation`, `questions`
  - Move `docs/research/*.json` to `docs/archive/research-results/`.
  - Rewrite `README.md` as a short page: what this is, the current phase, how to run the flagship page and the capture harness, and links to the AUDIT plan, `work/README.md` and `nubis-sources.md`. Under 60 lines.
- **Acceptance:** no broken relative links in `README.md` or `docs/**/*.md`. Check with a small grep/node script and paste its output into the report.

## Phase 1 — Voxel cloud core

These open once P0-02 and P0-03 land. The orchestrator will break them down
further with acceptance numbers from the AUDIT plan.

- P1-01 Upload the NVDF, SDF and noise to GPU textures in `@clouds/runtime`, with world placement and axis mapping.
- P1-02 Density: a WGSL port of the up-rez sampler, plus a CPU reference port and a parity test within 1e-3.
- P1-03 SDF sphere-trace march, with jitter animated near and static far, and depth-aware compositing.
- P1-04 Voxel light grid, 256×256×32 summed density for sun and sky, updated in slices over 8 frames.
- P1-05 Lighting terms: direct with HG lobes, ms inner glow, ambient. Sun and sky radiance from the `@pmndrs/sky` LUTs.
- P1-06 Near/far resolution split at 200 m, upsample and composite, with aerial perspective from the sky.
- P1-07 Cloud shadow on the ground.
- P1-08 Visual acceptance: flagship bookmarks on Parkouring and Stormbird, Tidewater side by side, timing table.

## Decisions and escalations

- 2026-10-08: the Nubis pack is treated as MIT (owner's call). The Sky Pro author has given permission. Upgraded to sky and upscaler 0.5.0.
