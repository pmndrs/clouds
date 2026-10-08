# Board

Status key: `[ ]` open · `[~]` claimed · `[r]` in review · `[x]` done · `[!]` blocked.
The protocol is in [README.md](README.md). Phase goals and measures are in
[docs/AUDIT-2026-10.md §4](../docs/AUDIT-2026-10.md).

## Done by the orchestrator

- [x] P0-00 Bump @pmndrs/sky 0.5.0, @pmndrs/upscaler 0.5.0 and three 0.186.1. Fix the adapter for the upscaler's RGBA change. Vitest resolves workspace packages from source.
- [x] P0-00b Headless GPU capture harness (`scripts/gpu/capture.mjs`), page contract (`examples/lab/harness/clouds-contract.ts`) and self-test page (`examples/lab/gpu-smoke/`).

## Phase 0 — Reset and data

These tasks run in parallel. File ownership is disjoint; respect it.

### [x] P0-01 Move the old labs under `examples/lab/legacy/` · Haiku
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

### [x] P0-02 Nubis pack converter · Sonnet
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

### [x] P0-03 Flagship shell page and GPU timer · Sonnet
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

### [x] P0-04 Tidewater reference captures · Sonnet
- **Owns:** `work/captures/P0-04/` and `work/reports/P0-04.md`. Read-only access to `/Users/dex/Developer/tidewater` (MIT; do not modify it).
- **Does:**
  - Run Tidewater's dev server and capture its clouds at 4 views comparable to our bookmarks: ground looking up at cumulus, distant horizon, low sun with backlit clouds, and the highest viewpoint reachable (boat or hill).
  - Use `scripts/gpu/capture.mjs --url ... --headed` if needed, or drive it through CDP.
  - Find how to set the time of day and camera: URL params, debug UI, or `window` globals.
- **Acceptance:** ≥ 3 captures at 1920×1080, with a report giving the sun elevation, camera height, FOV and exact steps to reproduce each. If a view is impossible, say why. This is the visual bar for P1–P3.

### [x] P0-05 Archive the old plan docs · Haiku
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

Spec: [specs/P1-runtime.md](specs/P1-runtime.md). The phase goals and measures are in the AUDIT plan.

- [x] P1-00 Foundation (orchestrator): `assets.ts`, `half.ts`, `resources.ts`, `shaders/common.wgsl.ts`,
  `shaders/volume.wgsl.ts`, and placeholder test pages wired into vite.

### Wave A (parallel)

### [x] P1-01 First image: density, SDF march, composite and the flagship frame · Sonnet
- **Owns:**
  - `packages/runtime/src/{runtime.ts,shaders/density.wgsl.ts,shaders/march.wgsl.ts,shaders/composite.wgsl.ts}`
  - export lines added to `packages/runtime/src/index.ts`
  - `examples/lab/flagship/**`
- **Does:**
  - `createCloudRuntime(device, options)` per the spec. `setVolume` places the volume:
    `position` is the world min corner, and the flagship centres Parkouring at
    x = z = 0 with its base about 1500 m above the ground.
  - `cloudDensity` is the exact port, with the fixed signature from the spec.
  - The SDF march follows spec §Passes 2, with **temporary lighting**: 6 in-line sun
    samples with Beer, HG (g = 0.2, 0.7 / 0.3 mixed with g = 0.8), ambient
    `pow(1 − profile, 0.5)`, and energy-conserving integration. The light grid and
    the full model land in P1-05.
  - Single render-res march at half the output resolution, then the depth-aware
    composite.
  - Restructure the flagship frame order per the spec.
  - Sun radiance and ambient come from the sky (for example its physical sun light's
    color and intensity, and a sky-derived ambient), not literals. P1-02 replaces
    this with LUT lookups.
  - Bookmarks use the real cloud bounds. Add a `cloud` query param:
    `parkouring | stormbird`.
- **Acceptance:**
  - `pnpm check` green.
  - `node scripts/gpu/capture.mjs --serve --page flagship/ --shots ground,edge,inside,above,backlit --out work/captures/P1-01`
    exits 0.
  - Each shot shows the cloud with visible wispy/billowy detail. No black, NaN or
    solid boxes; nothing cut off at the box edge.
  - `report.gpuMs` lists `march` and `composite`. Report the numbers at 1920×1080.
  - Also capture `--query cloud=stormbird` with the `ground` and `inside` shots.
  - Look at every capture yourself and describe what you see.

### [x] P1-02 Sky coupling: LUT-driven sun, ambient and aerial perspective · Sonnet
- **Owns:**
  - `packages/runtime/src/shaders/atmosphere.wgsl.ts`
  - `examples/lab/flagship/sky-bridge.ts` (new file; P1-01 owns the rest of flagship)
  - `examples/lab/runtime-tests/atmosphere/**`
  - report
- **Read-only:** `/Users/dex/Developer/SebH-TSL-Sky` (the @pmndrs/sky source at 0.5.x),
  `node_modules/@pmndrs/sky`.
- **Does:**
  - Find the exact parameterization of sky's transmittance LUT, sky-view LUT and
    aerial-perspective 3D LUT, plus its units: the LUTs are per unit sun
    illuminance, and `luminanceScale` is the exposure.
  - Write WGSL that samples them:
    - `sunRadianceAt(worldPos)`: sun illuminance through the transmittance LUT at
      that altitude, times exposure
    - `skyAmbient(worldPos)`: upper and lower hemisphere irradiance from a few
      sky-view LUT taps
    - `applyAerialPerspective(color, transmittance, viewDir, distance)`
  - Handle any world-to-planet frame difference.
  - `sky-bridge.ts`: from a `Sky` instance and renderer, return the `GPUTextureView`s,
    samplers and the uniform values (exposure, planet radius, camera altitude
    offset, sun direction) the WGSL needs, with no per-frame allocation.
  - **Test page:** compute `sunRadianceAt` at ground level and compare it with
    sky's own sun light color times intensity (within 5% per channel), and
    `skyAmbient` against a brute-force average of sky's environment or sky-view
    texture. Report through the contract.
  - **Investigate only:** why animating time of day costs about 10–11 ms of GPU
    (P0-03 finding), and which sky options cut it (PMREM throttling, cube size,
    bake cadence). Put the measurements in the report.
- **Acceptance:**
  - Test page passes under the capture harness.
  - The report documents the LUT mappings with file:line references into the sky
    source.

### [x] P1-03 Voxel light grid · Sonnet
- **Owns:**
  - `packages/runtime/src/{light-grid.ts,shaders/light-grid.wgsl.ts,light-grid.test.ts}`
  - `examples/lab/runtime-tests/light-grid/**`
  - an export line in `index.ts`
- **Does:**
  - `createLightGrid(device, volumeLayout, volume)`: a storage texture, rg16float 3D,
    dims = ceil(volume dims / 2), min 16. A storage-to-sampled copy or ping-pong is
    allowed if rg16float storage isn't filterable. Check what WebGPU allows and
    document it.
  - `encode(encoder, volumeBindGroup, { sunDirection, densityScale, frameIndex }, timer?)`
    updates 1/8 of the z-slices per frame.
  - Restart from slice 0 when the sun moves more than 0.5°. The grid must never
    hold mixed-sun data that gets sampled. Double-buffer it: build into a back
    texture and swap after 8 frames, so the front texture is always complete.
  - For each voxel, accumulate `profile * densityScale` (the cheap `y` term)
    toward the sun to the grid bounds, then straight up. The output is summed
    density in "density·metres" units, for `exp(-σ · sum)` later.
  - **WGSL sampling helper:** `lightGridSample(p) -> vec2<f32>`, which returns 0
    outside.
- **Acceptance:**
  - The test page builds a synthetic sphere volume in memory (hand-built
    `CloudVolumeAsset`) and checks GPU values at ≥ 20 voxels against a CPU march
    within 2%.
  - It shows that a sun change completes in exactly 8 frames, with no partial
    grid ever bound.
  - It reports per-frame GPU ms for the update slice on Parkouring's real dims.

### [x] P1-04 Density parity test · Sonnet
- **Owns:**
  - `packages/runtime/src/reference/density.ts` and its test
  - `examples/lab/runtime-tests/density/**`
- **Does:**
  - A CPU port of `VoxelCloudSampler.cg`, plus trilinear CPU sampling of the
    NVDF and noise that matches WebGPU linear filtering. Include mip selection:
    the GPU test may force `baseMip = 0` and `mipDistanceScale = 0` to avoid
    LOD-derivative differences.
  - The GPU test page loads Parkouring and the noise through the foundation,
    evaluates `cloudDensity` at ≥ 1000 points (inside, edge and outside, and
    within the near HF range) in a compute shader built from
    `COMMON_WGSL + volumeWgsl(0) + DENSITY_WGSL`, reads back, and compares with
    the CPU reference.
  - P1-01 writes `DENSITY_WGSL`. Until it lands, develop against the signature in
    the spec with a local stub, and re-run once it exists.
- **Acceptance:** the max abs error is ≤ 1e-3 (report max, p99 and mean) and the
  page passes under the capture harness against the real `DENSITY_WGSL`. Any
  mismatch is a bug in one of the two; say which.

### Wave B (after wave A lands; the orchestrator assigns)

### [x] P1-05 Full Nubis lighting, sky-driven · Sonnet
- **Owns:**
  - `packages/runtime/src/{runtime.ts,shaders/march.wgsl.ts,shaders/frame.wgsl.ts}`
  - `examples/lab/flagship/{main.ts,three-bridge.ts,bookmarks.ts}`
  - fixes from `work/reports/P1-01-review.md` that land in these files:
    - **#1 maxSteps truncation.** Grow the step after N iterations, or run a
      terminal coarse segment, so cloud is never silently dropped.
    - **#2 HDR overflow.** Clamp or pre-scale radiance so `scene * a + rgb` can't
      produce Inf or NaN.
    - **#5 robustness:**
      - the bridge must present the plain scene, not black, before the runtime
        is ready
      - use the camera's world position
      - integrate wind so changing `animSpeed` scales velocity and doesn't
        teleport the noise
      - `encode` after `dispose` is a no-op
    - Composite tap rejection (#3) and the in-cloud cost items (#4) belong to
      P1-06; leave them.
    - #4's SDF half-voxel margin and the `valueErosion` guard are already fixed
      by the orchestrator.
- **Does:**
  - **Light grid:** the march takes 2 in-line sun samples near the sample
    (preserving surface detail, Nubis s113), then the remainder from
    `lightGridSample(p)`. The runtime owns a `createLightGrid` instance and
    encodes it each frame before the march. Bind it in group 1 and pick
    `grid.frontIndex`.
  - **Sky:** sun radiance and ambient come from `atmosphereWgsl` (P1-02):
    - `sunRadianceAt(p)` for the sun
    - `skyAmbient` for top and bottom, with ambient
      `pow(1 − P, 0.5) * exp(−σ_amb · τ_up)` (Nubis s128)
    - aerial perspective on the cloud result at the mean cloud distance
      (`applyAerialPerspective`)
    - the flagship wires `createSkyBridge`, `sky.updateAerialPerspective()` and
      `bridge.update(camera)`

    Remove the temporary sky-derived stand-ins and the 6-tap sun march.
  - **ms inner glow:** keep the Nubis formula. Expose `msStrength` and
    `ambientStrength` knobs; they default to 1 and are art-directable.
  - **Phase:** HG g = 0.2 with a forward lobe mix, and art-directable silver lining.
  - **Bookmarks:** reframe so the cloud fills about 30–50% of the frame from
    `ground`, `edge` and `above`, with a believable distance (Parkouring core is
    about 300 m). `backlit` puts the sun 10–20° behind the cloud from the camera.
  - **Exposure:** match P0-04 Tidewater's look. Tops bright and white in sun,
    undersides blue-grey from sky ambient, sky blue and not washed out. Use
    sky/renderer exposure, never literal colours.
- **Acceptance:**
  - `pnpm check` green.
  - The flagship capture of 5 bookmarks on both clouds exits 0.
  - A side-by-side with `work/captures/P0-04/` is described honestly in the report.
  - Measures: inner glow visible when backlit, dark edges with the sun behind
    the camera, silver lining, sky-tinted ambient.
  - March GPU ms at 1920×1080 for every shot. It must be lower than P1-01 for
    `edge` and `inside` thanks to the light grid; report the drop.
  - The light grid update stays at or under 0.1 ms per frame.

### [~] P1-06 Performance: near/far split and in-cloud cost · Sonnet
- **Owns:**
  - `packages/runtime/src/{runtime.ts,shaders/march.wgsl.ts,shaders/frame.wgsl.ts,shaders/composite.wgsl.ts}`
  - `examples/lab/flagship/{main.ts,three-bridge.ts}`
  - you may also touch `shaders/density.wgsl.ts`, but only for pure algebraic
    speed-ups that keep the P1-04 parity page passing
- **Does:**
  - **Nubis near/far split** (s157–160): the march runs as two passes.
    - **Near:** t ∈ [0, 200 m) at ¼ output res.
    - **Far:** t ≥ 200 m at ½ output res.
    - Composite upsamples both depth-aware and merges front to back:
      `rgb = near.rgb + near.a * far.rgb`, `a = near.a * far.a`.
    - The split distance and both scales are quality-preset settings.
  - **In-cloud cost** (review #4):
    - Skip `cloudDistance` re-fetches while deep inside, using a Lipschitz bound.
    - Cut `pow` calls in the near-camera HF branch.
    - Hoist ray-constant remaps.
    - Skip lighting when `σ·ds` is negligible.
    - Raise the transmittance cutoff to about 0.03 if it is invisible.
  - **Composite tap rejection** (review #3): compare taps against the march's
    actual end distance, min(volume exit, scene), not scene distance alone.
  - **Quality presets:** define `low`, `medium` and `high`, each with near/far
    scales, maxSteps and the transmittance cutoff.
- **Acceptance (P1 measures, at `--size 2560x1440`):**
  - clouds total (lightGrid + march + composite) ≤ 4 ms from `ground`, `edge`,
    `above` and `backlit`, and ≤ 6 ms `inside`, on high, for both clouds
  - report a table for all 3 presets
  - captures compared with P1-05 show no visible quality loss far away, and only
    acceptable softening near; describe it honestly
  - `pnpm check` green; the parity page still passes
  - **Frame stability:** with `?animateTime=1`, p95 ≤ 1.5× p50

- P1-07 Cloud shadow on the ground (from the light grid or a projected map).
- P1-08 Visual acceptance and timing: all bookmarks on both clouds, side by side with Tidewater (`work/captures/P0-04/`), and a timing table against the P1 measures.


## Ahead of phase (parallel, no file overlap with P1)

### [~] P2-A Open-water scene module · Sonnet
- **Owns:** `examples/lab/scenes/ocean/**` (new; reusable scene module) and `examples/lab/ocean/**` (preview page).
- **Does:** `createOcean(renderer, scene, sky, options)`:
  - three WebGPU water to the horizon with layered waves (Gerstner or FFT, in TSL)
  - Fresnel reflection of `scene.environment` (the sky)
  - a sun glint driven by the sky's sun
  - a camera-following grid with distance LOD
  - `update(dt, camera)` per frame

  No literal sky colours. P2 composites clouds over it and reflects them.
- **Acceptance:**
  - The preview page meets the capture contract.
  - `--shots shore,horizon,sunset` captures exit 0 and look like open ocean
    under the sky at 1920×1080.
  - Ocean GPU ≤ 2 ms at 1920×1080 (report it).
  - 60 fps steady.

### [x] P3-A GPU NVDF generator prototype · Sonnet
- **Owns:** `packages/runtime/src/generate/**` (new) and `examples/lab/runtime-tests/generate/**`.
- **Does:** compute passes that turn a 2D weather map into a Nubis voxel field in
  the same formats as `uploadCloudVolume` (rgba8 NVDF, r16float SDF in metres),
  so the existing runtime can render the result unchanged.
  - **Weather map:** RG(B) for coverage, cloud type and base/top height.
  - **Output:**
    - **profile:** Nubis envelope method, `pow(h, 2) * pow(1 − h, 1.5)` times an
      edge gradient from the coverage SDF
    - **detail type:** wispy at the bases, billowy at the tops
    - **density scale**
  - **SDF:** a 3D jump flood over `profile > 0`, signed, with the same
    conservative convention.
  - **Amortization:** the work can be sliced across frames, for example by
    z-slices or tiles.
- **Acceptance:**
  - The test page generates a 256×256×32 field from a procedural weather map.
  - The SDF agrees with a CPU exact EDT within one voxel on ≥ 1000 samples.
  - Full generation GPU ms is reported for 256² and 512² × 64, plus per-slice cost.
  - A capture shows a slice visualization.
  - No three imports.

## Decisions and escalations

- 2026-10-08: the Nubis pack is treated as MIT (owner's call). The Sky Pro author has given permission. Upgraded to sky and upscaler 0.5.0.
- 2026-10-08: the SDF is uploaded as `r16float` metres, rounded down, because `r16unorm` is not a core WebGPU format. The 8 m voxel size is verified against the pack's SDF (P0-02).
- 2026-10-08: P3-A generator note for Phase 3: the jump flood allocates about 268 MB of seed buffers at 512²×64. Packed seeds or a tiled flood are needed before phones (P5). Not double-buffered, so render the old volume until `done`.
- 2026-10-08: density parity gate: formula ≤ 1e-3 (measured 2.8e-7) and end to end ≤ 5e-3. Hardware trilinear filtering quantizes weights to 1/256, and the Nubis sharpen `pow` amplifies that at cloud edges (P1-04).
- 2026-10-08: resolved. The 10–11 ms for animating the sky's time of day was a timestamp attribution artefact. The real cost is about 1.8 ms per frame (mostly the PMREM prefilter), or 1.2 ms if the sun updates every 4th frame (P1-02). A no-bake option would need a sky-side change; not required now.
