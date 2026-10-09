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

### [x] P1-06 Performance: near/far split and in-cloud cost · Sonnet
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

### [x] P1-07 Cloud shadows on scene geometry · Sonnet
- **Owns:**
  - `packages/runtime/src/{runtime.ts,shaders/composite.wgsl.ts,shaders/frame.wgsl.ts}`
  - `examples/lab/flagship/{main.ts,three-bridge.ts,bookmarks.ts}`
- **Does:** screen-space cloud shadowing, renderer-agnostic, in the composite.
  - **Shadow factor:** for pixels with opaque scene depth, reconstruct the world
    position, intersect the sun ray with the cloud volume, and read the light
    grid's summed sun density at the entry point (slightly inside), which is the
    total optical depth to the sun.
  - **Formula:** `shadow = mix(1, 0.8·exp(−σ·τ) + 0.2·exp(−σ·τ/4), strength)`,
    following Tidewater's soft term.
  - **Output:** composite alpha becomes `T_cloud · shadow`, so the caller's
    `scene · a + rgb` shades the scene with no API change. Sky pixels are never
    shadowed.
  - Add a `shadowStrength` setting.
  - Shadows need a full light grid even when the camera can't see the cloud.
    Note any frame-order issue.
  - Fix the horizon seam visible at the left of `work/captures/P1-05/edge.jpg`
    if it comes from the flagship ground setup.
  - Add a `shadow` bookmark: a camera on the ground in the cloud's shadow,
    looking along it so the shadow edge on the ground is visible.
- **Acceptance:**
  - `pnpm check` green.
  - A capture of `ground,edge,shadow,above` on both clouds shows a visible,
    soft-edged shadow consistent with the sun direction.
  - Composite cost delta ≤ 0.2 ms at 2560×1440.
  - Totals still meet the P1-06 budgets.

- [x] P1-08 Phase 1 acceptance by the orchestrator: technical measures pass, look measures partial → P1-09 ([report](reports/P1-08.md)).

### [x] P1-09 Art pass: inner glow, dark edges and undersides · Sonnet
- **Owns:**
  - `packages/runtime/src/{shaders/march.wgsl.ts,runtime.ts}`: lighting terms and default settings only
  - `examples/lab/flagship/bookmarks.ts`: add `frontlit`, with the sun behind the camera
- **Does:**
  - Tune the Nubis terms so the three signature looks read clearly on **both**
    clouds:
    - **Dark edges when front-lit:** low in-scatter at the edges. Rebalance the
      ambient `pow(1 − P, 0.5)` and the ms term, or modulate HG by the profile
      (Schneider SY s60).
    - **Inner glow when backlit:** Parkouring is currently weak.
    - **Blue-grey sky-lit undersides** like Tidewater.
    - **Wispier undersides:** bias detail type toward wispy at low height
      fraction (Nubis SY s37) as a runtime setting. Don't change the assets.
  - Keep everything art-directable through settings, with no literal colours.
- **Acceptance:**
  - Side-by-side images (ours vs `work/captures/P0-04/` Tidewater, and the
    P1-07 baseline) for `ground`, `frontlit`, `backlit` and `edge` on both
    clouds, saved as composite jpgs in `work/captures/P1-09/`.
  - The report says plainly whether each signature look reads.
  - Cost unchanged within 0.3 ms.
  - The parity page still passes. Density changes are allowed only through new
    settings that default to the Nubis values.



## Phase 2 — Drop-in API v0 and the open-water scene

Spec: [specs/P2-api.md](specs/P2-api.md).

### [x] P2-00 Move the legacy packages aside · Haiku
- **Owns:**
  - `packages/three` → `packages/legacy/three`, renamed `@clouds/legacy-three`
  - `packages/react` → `packages/legacy/react`, renamed `@clouds/legacy-react`
    (`git mv`)
  - every import, alias and path that references them: `vite.config.ts`
    aliases, `tsconfig.json` paths, legacy labs, `examples/lab/flagship/main.ts`
    (**only** its `sharedBackend` import line), `examples/lab/runtime-tests/**`,
    `scripts/*.mjs`, `packages/legacy/**`, docs links
- **Must not touch:**
  - `packages/runtime/**` or `scripts/vdb/**`
  - `examples/lab/flagship/{bookmarks.ts,three-bridge.ts}`
  - any line of `examples/lab/flagship/main.ts` other than that import
- **Acceptance:**
  - `pnpm check` green, with every legacy page still in the build.
  - `grep` shows no remaining `packages/three/` or `packages/react/` paths
    outside `packages/legacy`.
  - `@clouds/three` and `@clouds/react` are free names.

### [x] P2-02 `@clouds/three` adapter: `Clouds` and the TSL node · Sonnet
- **Owns:** `packages/three/**` (new adapter; `package.json` and stub exist) and
  `examples/lab/three-adapter/**`.
- **Read-only:**
  - `packages/runtime` (P1-09 edits lighting there in parallel; consume its
    public API only)
  - the flagship's `three-bridge.ts` and `sky-bridge.ts` (port their logic into
    the adapter)
  - `~/Developer/upscaler/src` (pattern: `UpscalerNode` `updateBefore`,
    `internal/threeWebGPU.ts`, `internal/renderPipelineHooks.ts`)
- **Does:** implement [specs/P2-api.md](specs/P2-api.md) "Target usage".
  - `new Clouds(renderer, { sky?, quality })`
  - `load({ volume, position })` and `setVolume(GpuCloudVolume, …)`
  - `clouds.node(colorNode, scenePass)` → a TSL vec4 node that runs the runtime
    in `updateBefore` after `scenePass` renders. It reads `scenePass` depth,
    uses the camera from `scenePass`, and composites `color · a + rgb`.
  - sky integration through the ported bridge; without a sky, the uniform
    lighting mode
  - settings passthrough, `dispose`
  - Own interop helpers; no import from `packages/legacy`.
- **Test page:** `three-adapter/` is a minimal scene written exactly like the
  spec's target usage (count the integration lines), with bookmarks shared from
  the flagship via import and the capture contract.
- **Acceptance:**
  - Integration is ≤ 20 lines.
  - A capture of `ground,edge,backlit` matches the flagship's images for the same
    bookmarks within a small tolerance. Report the mean |Δ|.
  - The cost equals the flagship's ±0.3 ms.
  - Works with `sky.applyHaze` before the clouds node.
  - `pnpm check` green.

### [x] P4-B Fit Guerrilla's profile-from-SDF mapping for authored clouds · Sonnet
- **Owns:** `scripts/vdb/**`, `assets/clouds/houdini-test/**`, `work/captures/P4-B/`, report.
- **Does:**
  - Measure, from the pack (`assets/clouds/{parkouring,stormbird}` NVDF + SDF,
    or the full pack), the empirical relation between SDF depth and dimensional
    profile (percentiles of profile per depth bin), and how detail type and
    density scale vary with height fraction and depth.
  - Fit a compact mapping (piecewise or parametric) and make it the default for
    fog and SDF modes, with the old mapping still selectable.
  - Regenerate `houdini-test`.
  - Ask the orchestrator for a flagship capture: write the exact command in
    your report. You may run
    `node scripts/gpu/capture.mjs --serve --page flagship/ --query cloud=houdini-test --shots ground,edge,above,backlit --out work/captures/P4-B`
    yourself.
- **Acceptance:**
  - Plots or tables of the fitted relation versus the pack data, as an image in
    `work/captures/P4-B/`.
  - The `houdini-test` cloud visibly gains Nubis-style eroded detail versus
    `work/captures/P4-A/` (side-by-side image).
  - Pack parity (P4-A `check_parity.py`) still passes for mode `pack`.

### [x] P2-04 Reflection dome: clouds in reflections · Sonnet
- **Owns:**
  - `packages/runtime/src/{runtime.ts,dome.ts,shaders/dome.wgsl.ts}`
  - export lines in `index.ts`
  - `examples/lab/runtime-tests/dome/**` (new; add its vite input line)
- **Does:** per Nubis (`cRenderDome`: no up-rez, `P·S` density) and spec
  [P2-api.md](specs/P2-api.md) "Cloud reflections".
  - The runtime keeps an octahedral rgba16f dome, 256² by default, with
    radiance and T, seen from a reference point (default: the camera's x/z at
    ground height).
  - Each frame it refreshes 1/16 of the texels in an interleaved pattern, so a
    full refresh takes 16 frames. Use the same lighting as the march, with
    cheap density, larger steps and a capped step count.
  - Expose `runtime.dome` (texture plus parameters), and a WGSL helper
    `cloudDomeSample(dir) -> vec4` that the adapter can wrap as a TSL function.
  - P2-02 may need a runtime-side uniform lighting mode (no sky). If its report
    asks for one, the orchestrator will forward the request to you.
- **Acceptance:**
  - Test page: the dome rendered as a panorama next to the main view, with the
    clouds in the right directions.
  - Per-frame dome cost ≤ 0.15 ms at 256².
  - A sun change refreshes within 16 frames with no stall.
  - Main-view captures and parity are unchanged.
  - `pnpm check` green.

### [x] P2-03 Open-water demo scene · Sonnet
- **Owns:** `examples/lab/open-water/**` (page wired into vite).
- **Read-only:** `packages/three` (the adapter), `packages/runtime`,
  `examples/lab/scenes/ocean` (P2-A).
- **Does:** the Phase 2 demo, open water and sky with clouds, using
  **`@clouds/three` exactly like a user would**.
  - sky, ocean (`createOcean`), clouds composited by `clouds.node`, and cloud
    shadows on the water (automatic through the composite alpha)
  - **Clouds:** a generated cloudscape over the sea, using
    `createVolumeGenerator` with a procedural weather map at 512×512×64 (8 m),
    centred on the camera's area and amortized at startup. Needs
    `setVolume(GpuCloudVolume)`, which P2-04 is adding; poll for it.
    `?cloud=parkouring` falls back to an asset.
  - **Reflections:** once P2-04 lands the dome and the adapter exposes a
    reflection helper, feed `clouds.reflection(dir)` into the ocean's
    reflection. If the adapter lacks the helper, report the exact API you need.
  - Bookmarks: `shore` (2 m above the water), `horizon`, `sunset` (backlit
    clouds over a glitter path) and `flight` (300 m, among clouds).
  - Capture contract; the HUD shows GPU ms per pass.
- **Acceptance:**
  - 60 fps for the whole frame at 2560×1440: report the whole-frame GPU total
    and `frameMs` p95.
  - Clouds visible in the water reflection, or a clear report of the blocking
    API.
  - Shadows visible on the water.
  - Captures at all bookmarks in `work/captures/P2-03/`.
  - The integration-line count is ≤ 20.

### [x] P2-05 Reflections, depth sorting and presets: closing Phase 2 · Sonnet
- **Owns:**
  - `packages/three/**`
  - `examples/lab/scenes/ocean/**` (add an optional reflection hook)
  - `examples/lab/open-water/**`
  - `examples/lab/three-adapter/**`
- **Does:**
  - **`clouds.reflection(dirNode)`:** a TSL function returning vec4 (rgb, T)
    from `runtime.dome` (`cloudDomeWgsl` / octahedral decode, P2-04).
    Reflective materials blend `env · T + rgb`.
  - **`createOcean`:** accepts an optional `reflection: (dir) => vec4` and
    blends it into the Fresnel reflection. The open-water page wires it.
  - **`Clouds.setVolume`:** accept `GpuCloudVolume`, now that the runtime
    supports it, and drop the page's `clouds.core` workaround.
  - Add the `'ultra'` quality to the adapter types.
  - **Depth-sorting test:** add `?objects=1` to the three-adapter page. It
    places a tall tower or mesh that pierces the cloud, one object fully in
    front of the cloud, and one fully behind it. Capture with bookmarks that
    show each case. Clouds must occlude and be occluded correctly, with no halo
    on silhouettes.
  - **Preset cost table:** low/medium/high/ultra at 2560×1440 on the
    three-adapter page and the open-water page (`ground`/`edge`/`inside` and
    `shore`/`horizon`/`flight`).
- **Acceptance:**
  - Clouds are visible in the water reflection
    (`work/captures/P2-05/open-water-*`).
  - Depth captures pass a visual check; describe each.
  - The preset table is in the report.
  - The open-water page keeps 60 fps at 2560×1440 on high.
  - The integration-line count stays ≤ 20.
  - `pnpm check` green.

- [x] P2-06 Phase 2 acceptance by the orchestrator: all measures pass ([report](reports/P2-06.md)).

## Phase 3 — Whole sky and generated cloudscapes

### [x] P3-B Generator quality: natural cumulus fields · Sonnet (Fable on failure)
- **Owns:**
  - `packages/runtime/src/generate/**`
  - `examples/lab/runtime-tests/generate/**`
  - a new preview page `examples/lab/cloudscape-gen/**` (vite input added by
    the orchestrator)
- **Problem:** P2-03 shows generated clouds as boxy, flat-topped masses with
  vertical walls and stacked shelves (`work/captures/P2-03/{horizon,sunset}.jpg`).
  - The NVDF profile comes from a 2D coverage edge gradient times height
    gradients, which gives vertical walls.
  - Nothing provides mid-scale structure (100–500 m lobes and billows). In
    Nubis that comes from fluid-sim profiles. The runtime up-rez noise only adds
    detail at roughly 100 m and below, so it can't fix silhouettes.
- **Does:** bake natural cumulus structure into the NVDF at generation time
  (free at runtime):
  - **Rounded, height-varying envelopes:** the coverage boundary shrinks toward
    the top for domes and slightly at the base. Bases are flat-ish but soft, and
    cloud height varies with local coverage (towering where coverage is high).
  - **3D mid-frequency billow structure:** an inverted-Worley / Perlin-Worley
    fBm at about 60–400 m, applied as profile erosion, weighted to the tops and
    sides. This gives cauliflower lobes.
  - **Profile gradient:** match the fitted pack statistics from P4-B
    (`scripts/vdb/nvdf_math.py` `PACK_FIT`): profile vs SDF depth, detail type
    by height (wispy bases, billowy tops), density scale.
  - **Find and fix the shelves/terraces cause:** quantization? Slice
    amortization? SDF conservativeness? Name it in the report.
  - Weather presets: `cumulus` (scattered fair weather), `congestus`
    (towering), `stratocumulus` (broken deck).
- **Acceptance:**
  - The `cloudscape-gen` preview page renders a 4 km field (512×512×64) with
    the runtime at ground, horizon and above-layer bookmarks for each preset.
    Side-by-side against the P2-03 captures, Tidewater P0-04 and Parkouring.
    Silhouettes must read as cumulus: domed lobes, no vertical walls, no
    terraces.
  - Generation cost is still amortizable (report per-job ms).
  - The SDF stays conservative (test page).
  - `pnpm check` green.

### [x] P3-C1 Distant sky layer (Nubis vertical-profile 2.5D) · Sonnet (Fable on failure)
- **Owns:**
  - `packages/runtime/src/{sky-layer.ts,shaders/sky-layer.wgsl.ts}` (new)
  - runtime integration in `packages/runtime/src/runtime.ts` and
    `shaders/composite.wgsl.ts`; keep existing behaviour identical when the
    layer is disabled
  - `examples/lab/cloudscape-gen/**` (add `?sky=1`)
- **Does:** the Nubis vertical-profile method ([nubis-sources.md §1](../docs/research/nubis-sources.md)).
  - **Geometry:** a cloud shell from `minHeight` to `maxHeight`, with an
    optional planet-curvature approximation, out to about 30–50 km.
  - **Weather:** the **same world-anchored weather map** as the generator
    (`encodeProceduralWeatherMap` parameters), so distant and near clouds
    agree.
  - **Profile:** coverage times vertical-profile LUTs (bottom type / top type),
    giving the dimensional profile. Then the **same up-rez density function**,
    with noise at far mips, and the **same lighting chunk**
    (`shaders/lighting.wgsl.ts`). Sun light comes from a short cheap march or
    a vertical-profile approximation, since there is no light grid out there.
  - **March:** rays outside the voxel box use adaptive steps (Nubis 2.5D:
    `3 + 60·d/16384`). Render at reduced resolution (start at ¼ res; P3-C2
    adds 16-frame temporal amortization).
  - **Composite:** merge front to back with the voxel result.
  - **Seamless handoff:** inside the voxel box, the voxel field wins. Fade the
    layer in over a band outside the box so no seam shows when the box
    boundary is on screen.
  - Setting `skyLayer.enabled`, off by default for now.
- **Acceptance:**
  - With `cloudscape-gen?sky=1&preset=cumulus`, the horizon and ground
    bookmarks show cumulus continuing to the horizon, with matching
    look/density near the box edge (show a capture looking across the
    boundary) and no seam.
  - Layer cost at 2560×1440 is reported; target ≤ 1.5 ms before temporal.
  - Flagship captures are unchanged with the layer off.
  - `pnpm check` green.

### [x] P3-D Streaming cloudscape window and the plains flight demo · Sonnet
- **Owns:**
  - `packages/runtime/src/generate/**`
  - `examples/lab/plains-flight/**` (new page, wired)
  - `packages/three/**` only for small additions the page needs (report them)
- **Read-only:** `packages/runtime/src/{runtime.ts,shaders/**}`. P3-C1 is
  editing them now; if you need a runtime change, report it.
- **Does:**
  - **World-anchored generation:** the generator takes a world-space origin,
    and the weather map is sampled in world coordinates, so two windows at
    different origins agree exactly where they overlap. Test this on the test
    page.
  - **Streaming window:** keep two generator volumes. When the camera moves
    more than a threshold (for example ¼ of the window) from the current
    centre, generate the next window at the new centre, amortized over frames,
    then swap with `setVolume(nextVolume, { position })`. No visible pop at the
    swap, because the overlap is identical. Report how the light grid behaves
    across a swap.
  - **Plains flight demo:** a 40 s scripted flight at about 120 m/s over plains
    (ground plane, sky, cumulus preset):
    - start on the ground looking up
    - climb through the cloud layer
    - cruise above the tops
    - descend through a gap

    Use `?t=<seconds>` and bookmarks along the path so the capture harness can
    sample it, plus `?play=1` for real-time playback. The HUD shows GPU ms per
    pass.
- **Acceptance:**
  - Captures at t = 0, 5, 10 … 40 s at 2560×1440 show a continuous cloudscape
    through at least one window swap, with no pop. Sample frames either side of
    the swap and report the mean |Δ|.
  - 60 fps, with frame p95 ≤ 1.5× p50 measured during `?play=1`, including
    across swaps.
  - Generation never stalls a frame.
  - `pnpm check` green.

### [x] P3-C2 Sky layer quality and temporal amortization · Fable (escalated)
- **Owns:**
  - `packages/runtime/src/{sky-layer.ts,shaders/sky-layer.wgsl.ts,shaders/composite.wgsl.ts}`
  - `packages/runtime/src/generate/weather.ts`, only for shaping that must stay
    in sync with the generator
  - `examples/lab/cloudscape-gen/**`
  - minimal, re-read-before-edit changes to `runtime.ts`; P3-E edits it too
- **Problem:** `work/captures/P3-C1/*`, `work/reports/P3-C1.md`. The layer
  works but shows:
  - peaked or conical tops instead of domes
  - static ¼-res hatching
  - unexplained vertical "cliff" edges, which are real geometry
  - a blocky horizon band
  - shading darker than the voxel clouds
  - a faintly visible box boundary
- **Does:**
  - Fix the shape and shading so near-far continuity holds: same silhouettes
    and brightness as voxel clouds at the boundary.
  - Add the Nubis 16-frame temporal amortization for this layer: render 1/16
    of the pixels per frame at ¼ res, reproject with the cloud mean depth
    (and wind), use a neighbourhood clamp, and reset on cuts or sun jumps. This
    removes the hatching and pays for higher quality.
  - Root-cause the cliffs.
- **Acceptance:**
  - `cloudscape-gen?sky=1` at the `horizon`, `ground`, `seamNorth` and `above`
    bookmarks reads as one continuous cumulus field to the horizon: domed tops,
    no hatching, no cliffs, no visible box edge. Side-by-side with the P3-C1
    captures.
  - Layer cost ≤ 1.0 ms at 2560×1440 (amortized).
  - Camera motion shows no ghosting trails. Verify with a 5-frame capture
    sequence while the camera moves.
  - `pnpm check` green; the flagship is unchanged with the layer off.

### [x] P3-E Performance on large generated volumes · Sonnet
- **Owns:**
  - `packages/runtime/src/{light-grid.ts,shaders/light-grid.wgsl.ts,shaders/march.wgsl.ts,shaders/lighting.wgsl.ts}`
  - `shaders/density.wgsl.ts`, algebraic changes only, parity must pass
  - minimal, re-read-before-edit changes to `runtime.ts`; P3-C2 edits it too
  - `examples/lab/plains-flight/**` for measurement
- **Problem** (`work/reports/P3-D.md`, `work/captures/P3-D/capture.json`):
  - The light grid costs about 3 ms every frame on the 512×512×64 generated
    volume (256×256×32 grid; Parkouring was 0.07 ms). Nubis: 0.1–0.2 ms every
    8 frames.
  - Climbing under a thick base costs 8–24 ms in the march: `t15`, and frames
    at 33 ms during `?play=1`.
- **Does:**
  - **Light grid:** make the cost scale. For example, march a pre-downsampled
    `profile·scale` volume at grid resolution with step growth and a cap; get
    upward τ from a prefix sum along z; spread the update over more frames for
    large grids. Target ≤ 0.3 ms per frame at 512²×64 with the same lighting.
    Verify the P1-03 test page still passes, or update its tolerance with
    justification.
  - **March under and inside thick bases:** find where the time goes
    (step counts, light samples per step, the T cutoff, rays grazing along the
    base) and fix it without visible change. Target clouds total ≤ 6 ms
    anywhere on the flight path at 2560×1440 high.
- **Acceptance:**
  - Light grid ≤ 0.3 ms per frame on the flight page.
  - The flight path t0–t40 is under 6 ms clouds total in every capture.
  - `?play=1` at 2560×1440 gives frame p95 ≤ 1.5× p50 with 0 frames over
    33 ms across 3 runs, using a private vite without watch if needed (see the
    P3-D note).
  - Before/after captures show no visible change.
  - Parity passes; `pnpm check` green.

## Phase 4 — Authored clouds

### [x] P4-C GPU stamping of authored clouds into a cloudscape · Sonnet
- **Owns:**
  - `packages/runtime/src/generate/stamp.ts` and its shader (new)
  - one export line in `packages/runtime/src/generate/index.ts`
  - `examples/lab/runtime-tests/stamp/**` (wired)
- **Read-only:** the rest of `generate/**`; P3-C2 edits `weather.ts` and
  `shaders.ts`.
- **Does:** Atlas-style compositing (Nubis s65–67) on the GPU, renderer-agnostic.
  - `stampCloud(encoder, target: GpuCloudVolume/generator, asset: GpuCloudVolume, { position, yaw, scale, mode: 'max'|'replace'|'cutout', densityScale?, detailType? })`
    resamples the authored NVDF into the region's NVDF with the transform.
  - Then the SDF is regenerated for the touched region: a JFA over the
    affected bounds plus margin, or the whole volume. Amortizable.
  - Cutout carves (for example a tunnel or hole). Multiple stamps per region.
  - It works on generated regions (`createVolumeGenerator` output) and on an
    empty region.
- **Acceptance:**
  - The test page stamps Parkouring, Stormbird and `houdini-test` into a
    generated cumulus region at chosen transforms, plus one cutout, and
    renders it.
  - Captures show each stamped cloud in place with correct orientation and
    scale, and the cutout hole.
  - SDF conservativeness holds after stamping (compare with a CPU EDT on the
    stamped region).
  - Cost per stamp is reported.
  - `pnpm check` green.

### [x] P4-E Houdini hero-cloud authoring with Cloud SOPs · Sonnet
- **Owns:** `scripts/vdb/authoring/**` (new) and `assets/clouds/heroes/**`
  (new; each cloud under 4 MB).
- **Does:** a hython script that builds hero clouds the way a Houdini artist
  would, using Houdini's built-in **Cloud SOP** and **Cloud Noise SOP** (and
  optionally VDB Reshape or Smooth), not displaced spheres.
  - Shapes come from simple source geometry: a towering cumulus from stacked
    spheres or a curve, a long low fog bank for a valley, and a
    flat-bottomed fair-weather cumulus.
  - Each exports a fog VDB and converts with `scripts/vdb/vdb_to_nvdf.py`
    `--mode fog` (the P4-B PACK_FIT mapping).
  - Document the recipe in `scripts/vdb/authoring/README.md`: the knobs that
    matter and how to author your own.
- **Acceptance:**
  - Three hero clouds in `assets/clouds/heroes/`.
  - Each renders in the flagship (`?cloud=heroes/<name>` if the loader allows
    nested names; otherwise report the one-line change needed). Captures
    `ground,edge,backlit` in `work/captures/P4-E/`.
  - The clouds show Nubis-like eroded detail comparable to Parkouring. Include
    a side-by-side with `houdini-test`.

### [x] P4-D Onsen valley demo · Sonnet
- **Owns:** `examples/lab/onsen/**` (wired) and `examples/lab/scenes/terrain/**` (new reusable module).
- **Read-only:** `packages/**`, `assets/clouds/**`, the ocean module (for reuse
  patterns).
- **Does:** the Phase 4 showcase, inspired by a Ghost of Tsushima vantage: you
  sit by a hot spring on a mountainside at golden hour, overlooking a valley.
  - **Terrain:** a procedural heightfield with mountain ridges and a valley
    5–10 km across. Distance-dependent detail, a stylized natural material
    (grass, rock and forest tint by slope and height), receiving cloud shadows
    through the composite. Keep it cheap: ≤ 2 ms at 2560×1440.
  - **Foreground:** a small onsen pool (water plane reflecting the sky and
    clouds through `clouds.reflection` if practical) and rocks or simple
    shapes. Rising steam is optional; don't spend long on it.
  - **Clouds (authored):** stamp `heroes/valley-fog` into the valley floor
    (several instances, a slow drift), a hero cumulus or tower beyond the
    valley, and fair-weather clouds above, all composed into one generated
    region with `stampCloud` (P4-C).
  - **Clouds (procedural):** a generated cumulus background, plus the sky
    layer if it is enabled by then (P3-C2 may still be in progress; make it
    optional).
  - **Lighting:** golden hour by default, plus a `?time=` override. The camera
    sits at a fixed vantage with a gentle drift, with bookmarks `vantage`,
    `valley` (looking down at the fog) and `sunset`.
  - Capture contract and HUD.
- **Acceptance:**
  - Captures at all bookmarks at 2560×1440 read as a convincing mountain
    valley vista with authored valley fog and clouds composited correctly
    against the terrain (fog between ridges, ridges occluding clouds).
  - 60 fps; report whole-frame GPU.
  - Integration lines ≤ 20 for clouds (content lines separate).
  - `pnpm check` green.

### [x] P4-E2 Rebuild the tower hero cloud · Sonnet
- **Owns:** `scripts/vdb/authoring/**` and `assets/clouds/heroes/tower/**`.
- **Does:** the P4-E tower reads as a smoke or explosion column (a narrow stalk
  with a lobed head; `work/captures/P4-E/tower-*.jpg`). Rebuild it as towering
  cumulus (congestus): a broad flat-ish base, stacked domed turrets that keep
  their width or widen with height, cauliflower lobes, and a slight shear.
  Same pipeline (Cloud SOP → Cloud Noise → convert), under 4 MB.
- **Acceptance:** flagship captures `?cloud=heroes/tower` at `ground`, `edge`
  and `backlit` read as towering cumulus. Include a side-by-side with the old
  tower.

### [x] P4-F Scripted fluid-sim hero clouds (Houdini Pyro) · Sonnet
- **Owns:** `scripts/vdb/authoring/sim/**` (new) and `assets/clouds/heroes/sim-*/**` (new; each under 4 MB).
- **Why:** scripted Cloud SOP recipes top out at "pile of soft spheres"
  (`work/captures/P4-E2/`). Guerrilla grew their clouds with fluid simulation
  (Nubis³ s63–64, Aero solver).
- **Does:** a hython script that grows clouds with Houdini 21's SOP-level Pyro
  (Pyro Source → Pyro Solver SOP, or the DOP pyro network if SOP Pyro isn't
  suitable):
  - **Source:** a broad flat disc or ellipse emitting density and temperature
    near the ground of the sim domain.
  - **Physics:** buoyancy plus turbulence and disturbance, so rising thermals
    form billowing turrets. Run for a few hundred frames at a voxel size that
    keeps the run under about 10 minutes.
  - **Output:** cache one late frame as a VDB, optionally add a light Cloud
    Noise pass, then convert with `vdb_to_nvdf.py --mode fog` at 8 m.
  - Make two clouds: `sim-cumulus` (fair-weather, about 700 m) and
    `sim-congestus` (towering, about 1 km).
  - Document the recipe and its knobs in the README, so a human artist could
    take it over.
- **Acceptance:**
  - Flagship captures (`?cloud=heroes/sim-cumulus` and `heroes/sim-congestus`;
    the orchestrator adds the whitelist entries) at `ground`, `edge` and
    `backlit` read as cauliflower cumulus with internal structure, not
    spheres. Include a side-by-side with `heroes/tower`.
  - Sim time and file sizes are reported.
  - If Houdini Indie limits or performance block it, report exactly what and
    why.

### [x] P3-F Lighting at scale: thick-cloud undersides and the day cycle · Sonnet
- **Owns:**
  - `packages/runtime/src/shaders/{lighting.wgsl.ts,march.wgsl.ts}`
  - default values in `runtime.ts` settings, with minimal re-read-before-edit
    changes, because P3-C2 also edits `runtime.ts`
- **Problem:** thick generated clouds have charcoal-black cores and undersides
  from the ground (`work/captures/P3-B/cumulus/ground.jpg`,
  `work/captures/P3-D/t15`, `work/captures/P4-D/*`). Tidewater's bases
  (`work/captures/P0-04/`) are lighter blue-grey. Nubis bases are also lit by
  sky ambient and multiple scattering.
  - The ambient term uses `exp(−σ_amb·τ_up)` through hundreds of metres of
    cloud, so it hits 0.
  - The ms term relies on the profile, and the direct sun is fully extinct.
- **Does:**
  - Add a physically motivated floor for deep multiple scattering. Options:
    - a multi-octave scattering approximation (Wrenninge/Hillaire: sum of
      octaves with attenuated extinction a^n, scattering b^n and phase
      eccentricity c^n)
    - ambient that uses a capped or soft-saturating `τ_up`
    - ground-bounce light from below, using the sky's ground albedo
  - Pick what looks right and keeps cost unchanged.
  - Then verify a **full day cycle** (times 7, 9, 12, 15, 18 and 19.5) on the
    cloudscape: sky tint consistent with the clouds, no clipping at noon, a
    believable sunset, and no black clouds at dusk.
- **Acceptance:**
  - Side-by-side composites (before | after | Tidewater) for:
    - `cloudscape-gen` cumulus `ground`
    - `plains-flight` `t15`
    - `onsen` `vantage`
    - flagship Stormbird `frontlit` and `backlit`
  - Undersides read blue-grey with structure, not charcoal. The P1-09 looks
    still read (inner glow, silver lining, dark clefts).
  - A day-cycle strip image (6 times).
  - March cost within +0.3 ms.
  - Parity passes; `pnpm check` green.

### [x] P4-G Real-world VDBs: Disney cloud, OpenVDB bunny and the user's samples · Sonnet
- **Owns:**
  - `assets/clouds/disney/**` (committed, with `NOTICE.md`: CC BY-SA 3.0,
    © 2017 Disney Enterprises, plus the Kevin Udy photo reference attribution)
  - `assets/clouds/local/**` (gitignored; for inputs whose licence is unknown)
  - `work/captures/P4-G/`
  - small additions to `scripts/vdb/**` if the converter needs them
- **Inputs:**
  - `/Users/dex/Developer/WebGPUClouds/artifacts/research/disney-cloud/`
    (`wdas_cloud_{sixteenth,eighth,quarter}.vdb`,
    `wdas_cloud_hyperion_render.png` reference, `README.txt`)
  - `/Users/dex/Developer/WebGPUClouds/artifacts/research/vdbs/`
    (`bunny_cloud.vdb`, `cloud.0001.vdb`, `bunny.vdb` level set, others)
- **Does:**
  - Inspect each VDB's grids, units, transform and value ranges.
  - Convert with `vdb_to_nvdf.py` (`--mode fog`, or `sdf` for a level set) at
    8 m runtime voxels with a sensible world scale. The Disney cloud is a real
    cumulus: scale it to about 1.0–1.5 km wide. The bunny is a "Sea of
    Thieves shaped cloud" test: about 600–800 m.
  - Pick the Disney resolution with the best quality at 8 m (probably quarter
    or eighth), keeping the asset under 4 MB.
  - Outputs: `assets/clouds/disney/`, `assets/clouds/local/bunny-cloud/` and
    `assets/clouds/local/cloud-0001/`. The flagship whitelist already has
    `disney`, `local/bunny-cloud` and `local/cloud-0001`.
- **Acceptance:**
  - Flagship captures (`ground`, `edge`, `backlit`, `frontlit`) for each.
  - For Disney, a side-by-side against the Hyperion render from an
    approximately matching camera and sun. Describe honestly how close our
    realtime Nubis rendering gets to the offline reference.
  - For the bunny, the shape stays recognizable while reading as cloud.
  - Report the conversion parameters and timings.

### [x] P4-H In-browser `.vdb` import: drop a VDB, get a Nubis cloud · Sonnet
- **Owns:**
  - `packages/runtime/src/import/**` (new; renderer-agnostic)
  - `vendor/vdb-web-tools/**` (vendored copy plus its Apache-2.0 LICENSE and
    NOTICE)
  - `examples/lab/vdb-drop/**` (wired)
  - one export line in `packages/runtime/src/index.ts`
- **Source:** the user's WebVDB project at `/Users/dex/Developer/WebVDB`
  (Apache-2.0, read-only). Its `packages/vdb-web-tools` is a pure-TS `.vdb`
  parser (FloatGrid 5-4-3, uncompressed or zlib; no Blosc) with a NanoVDB
  builder. Vendor only what the import needs, and record the source commit.
- **Does:** `importVdb(device, arrayBuffer, options) → GpuCloudVolume` in the
  browser, with no Houdini or Python.
  - Parse the grid and pick the density grid (or SDF/level set) by name or
    class.
  - Resample to the runtime voxel size (8 m, or `worldScale` options) on the
    CPU or GPU.
  - Build the NVDF channels with the **P4-B PACK_FIT mapping**, ported from
    `scripts/vdb/nvdf_math.py` to TS or WGSL.
  - Generate the SDF with the existing GPU jump flood (2 rounds; see P4-C
    `createSdfRebuilder`).
  - Report a clear error for Blosc-compressed files, with the exact Houdini
    export setting to change.
- **Demo page:** drag and drop a `.vdb` onto the page, or use `?url=` for a
  file served under `/clouds/...` or `/@fs/` (dev). Show grid info, conversion
  time and the render, with `ground`/`edge`/`backlit` bookmarks around the
  imported cloud.
- **Acceptance:**
  - `?url=` imports of the Nubis pack VDBs (`ParkouringCloud.vdb` via
    `/@fs/` from `artifacts/research/nubis-pack/...`) match the
    hython-converted asset: NVDF within 2/255 at ≥ 99% of voxels if the pack
    mode is used, or visually equivalent.
  - The user's `bunny_cloud.vdb` (`artifacts/research/vdbs/`) and the Disney
    `wdas_cloud_eighth.vdb` (`artifacts/research/disney-cloud/`) import and
    render, or fail with a clear Blosc message.
  - Conversion times are reported.
  - `pnpm check` green.

## Quality track

### [x] Q-1 Billow-scale self-shadowing and detail: closing on offline quality · Fable
- **Owns:**
  - `packages/runtime/src/shaders/{march.wgsl.ts,lighting.wgsl.ts,density.wgsl.ts}`;
    density changes must keep the P1-04 parity page passing at Nubis defaults,
    or get documented new defaults with a parity variant
  - settings defaults in `runtime.ts` (minimal edits)
- **Evidence:** `work/captures/P4-G/disney-vs-hyperion.jpg`. Our version
  matches silhouette and shading direction, but the body is a smooth white mass
  where Hyperion shows crisp, self-shadowed cauliflower billows. Every cloud we
  render shares this (Parkouring, generated cumulus, heroes).
- **Hypotheses** (verify; don't assume):
  1. **Missing billow-scale self-shadowing.** The in-line sun samples sit about
     8 and 32 m out with 4 m reuse; billows need 2–10 m occlusion, using full
     up-rezzed density.
  2. **Noise frequency and amplitude** at hero scale: tile 100 m, billowy ×0.3
     erosion. Check against Nubis s91–109; detail may be too weak or too
     coarse.
  3. **Ambient and ms terms flatten contrast.**
  4. **Half/third-res march plus upsample** softens micro-detail.
- **Does:** find the dominant causes with A/B captures, then fix within budget:
  - micro self-shadowing (for example 1–2 extra short full-density samples, or
    a gradient-based occlusion trick)
  - detail strength and scale tuned per Nubis, art-directable
  - edge contrast
- **Acceptance:**
  - The Disney cloud (`?cloud=disney`, `edge` at `time=15`) shows visibly
    self-shadowed billow structure in a side-by-side with Hyperion and the
    P4-G baseline.
  - Parkouring, cumulus `ground` and onsen `vantage` also improve, with
    before/after composites.
  - Cost: march within +0.6 ms at 2560×1440 high on the flagship's `edge` and
    `inside`.
  - Parity passes (or a documented variant); `pnpm check` green.
  - Be honest about what remains versus offline.

- [x] Phase 3 and Phase 4 accepted by the orchestrator ([report](reports/P3-P4-acceptance.md)).

## Phase 5 — Scale down to laptops and phones

### [x] P5-A Generator and streaming memory diet · Sonnet
- **Owns:**
  - `packages/runtime/src/generate/**`
  - `examples/lab/runtime-tests/{generate,stamp}/**`
  - `examples/lab/plains-flight/**`, measurement only
- **Problem:**
  - The 3D jump flood allocates about 268 MB of seed buffers at 512²×64.
  - Streaming shares a scratch of about 300 MB.
  - Phones can't afford this, and it's wasteful on desktop.
- **Does:** cut peak memory by 8× or more with identical SDF guarantees. Options:
  - packed seeds (for example u32 voxel index, or 3×10-bit coordinates)
  - a single ping-pong pair instead of four buffers
  - tiled or banded JFA with halo
  - an exact separable EDT on the GPU (Felzenszwalb in 3 passes) instead of
    JFA; often cheaper and exact
  Also report and reduce the generator's total footprint (weather maps,
  intermediates). Add a `memoryBytes` report to the generator and streaming
  APIs.
- **Acceptance:**
  - Peak scratch ≤ 40 MB at 512²×64.
  - The SDF never overshoots the CPU EDT (test pages).
  - Output is identical or better (report the max |Δ| SDF vs the old path).
  - Generation time no worse than +20%.
  - Plains flight still has no pop.
  - `pnpm check` green.

### [x] P5-B Temporal amortization of the voxel clouds (partial-rate tracing) · Sonnet (Fable on failure)
- **Owns:**
  - `packages/runtime/src/{runtime.ts,shaders/march.wgsl.ts,shaders/composite.wgsl.ts,shaders/frame.wgsl.ts}`
  - a new `shaders/temporal.wgsl.ts`
  - presets in `runtime.ts`
- **Reference:** P3-C2's temporal resolve for the sky layer
  (`sky-layer.ts`/`.wgsl.ts`, `work/reports/P3-C2.md`): a sparse Bayer trace,
  reprojection through the cloud mean distance, variance clip and cut resets.
  Also Tidewater's resolve (`work/reports/` Tidewater notes in
  `docs/research/tidewater-*`).
- **Does:** an optional mode where each march pass (near and far) traces
  1/k of its pixels per frame (k = 1, 2 or 4; Bayer pattern) and resolves to
  full render resolution through reprojection.
  - Reproject with the previous view-projection at the cloud mean distance.
    Wind-compensate by the noise scroll. Clamp to the neighbourhood (variance
    clip).
  - Reject history on disocclusion against scene depth, camera cuts, sun
    jumps and setting changes.
  - Keep near clouds responsive: for example k=1 near, k=4 far by default on
    high, more aggressive on low.
  - This is the main budget lever for P5 tiers.
- **Acceptance:**
  - At 2560×1440 high, clouds total ≤ 3 ms in steady state on the flagship
    bookmarks and the plains flight t0–t40, with k chosen per preset.
  - No visible ghosting in motion: 5-frame sequences during camera pans and
    during the plains flight `?play=1`, Read and described.
  - Static views converge to the same image as k=1 (mean |Δ| reported).
  - Frame p95 ≤ 1.5× p50.
  - Parity passes; `pnpm check` green.

## Phase 6 — Beyond Nubis³

### [x] P6-A Realtime cloud evolution · Sonnet (Fable on failure)
- **Owns:**
  - `packages/runtime/src/generate/**`
  - `examples/lab/evolve/**` (wired)
  - minimal, additive `runtime.ts` hooks if needed, re-read before editing
- **Does:** clouds that grow, merge and dissipate over minutes at stable cost.
  Nubis³ lists "realtime voxel cloud evolution + on-the-fly SDF generation" as
  future work.
  - The weather/coverage field evolves over time: advected and noise-driven
    growth and decay, cumulus life cycles of about 5–20 minutes, with a
    `timeScale` knob for demos.
  - The NVDF and SDF regenerate incrementally in amortized jobs, double-buffered
    so the renderer always reads a complete field, and crossfade between
    generations so updates don't pop. For example, keep two volumes and blend
    their density by t in the sampler, or regenerate slices continuously.
  - Measure cost per frame at 512²×64 and choose an update cadence (for
    example a full regeneration every N seconds, amortized).
- **Demo:** the `evolve` page shows a time-lapse of a cumulus field forming and
  dissipating from the ground and from above, with `?timeScale=` and the
  capture contract.
- **Acceptance:**
  - Captures at t = 0, 30, 60, 90, 120 s (time-lapse) show visibly changing
    clouds: growth and dissipation of individual cells.
  - Consecutive frames show no pop (mean |Δ| per frame small).
  - Added cost ≤ +1 ms per frame (report it).
  - Frame p95 ≤ 1.5× p50 during evolution.
  - `pnpm check` green.

## Phase 7 — Release

### [x] P7-A React Three Fiber v10 bindings · Sonnet
- **Owns:** `packages/react/**` (new `@clouds/react`; stub exists) and `examples/lab/r3f/**` (wired).
- **Read-only:** `packages/three` (the adapter; consume its public API), `packages/runtime`, `node_modules/@react-three/fiber` (v10 alpha) and `node_modules/@pmndrs/sky` (its `react` entry, `<Sky>`, `useSky`, `<AutoHaze>`, and how it hooks the R3F v10 render pipeline: `useRenderPipeline`).
- **Does:** idiomatic R3F v10 bindings.
  - `<Clouds volume="/clouds/parkouring/" position={[0, 500, 0]} quality="high" {...settings} />` and `useClouds()` for the instance.
  - Generated cloudscapes: `<Cloudscape preset="cumulus" />`, using the generator and streaming helpers.
  - Integrates with the R3F v10 render pipeline (`useRenderPipeline` or equivalent) so the clouds node composites after the scene pass and haze, and works with `@pmndrs/sky/react`'s `<Sky>` and `useSky()` for lighting.
  - Lifecycle: mount/unmount, prop changes (volume swap, settings), Suspense for asset loading, dispose.
- **Demo page:** `r3f/` is a minimal R3F app with `<Canvas>` (WebGPU), `<Sky>`, ground and `<Clouds>`, plus bookmarks and the capture contract.
- **Acceptance:**
  - A capture of the demo matches the three-adapter page's image for the same bookmark (report the mean |Δ|).
  - Remount and prop-change tests: unit tests where possible, plus a page mode that swaps volume and settings and remounts, with no GPU errors and no leaks (report the `device.destroy` and texture counts if available).
  - The user-facing code in the demo is ≤ 20 lines for clouds.
  - `pnpm check` green.

### [x] P5-C Tiers that scale, auto tier, dynamic resolution, composite and memory · Sonnet
- **Owns:**
  - `packages/runtime/src/{runtime.ts,shaders/composite.wgsl.ts,shaders/temporal.wgsl.ts}` and presets
  - `packages/three/src/**`, for auto-tier and dynamic-resolution wiring
  - `examples/lab/flagship/**`, `examples/lab/open-water/**` and `examples/lab/plains-flight/**`, for measurement
- **Problems:**
  - Low and medium barely save time (P2-05).
  - The composite costs about 1 ms at 1440p and is now the largest pass.
  - The temporal history uses about 63 MB at 1440p, too much for phones.
  - There is no automatic scaling.
- **Does:**
  - **Composite:** reduce cost, for example by merging the resolve and
    composite, cheaper depth-aware taps, skipping sky-only tiles, or running at
    a lower resolution for transparent areas. Target ≤ 0.5 ms at 1440p with no
    visual change.
  - **Memory:** pack the history (for example rgba16f colour plus r16f depth,
    or history at march resolution only). Target ≤ 25 MB at 1440p, and report
    the totals per preset.
  - **Tiers:** `ultra`/`high`/`medium`/`low`/`mobile` with real levers: render
    scales, near/far k, step budgets, light-grid size, dome size, sky-layer
    resolution, and the sky layer only on mobile beyond N km. Each tier gets a
    measured cost table on flagship, open-water and plains-flight at 2560×1440
    and 1280×720. Target low ≈ 50% and mobile ≈ 25% of high's cost.
  - **Auto:** `quality: 'auto'` picks a tier from adapter info and limits, then
    adjusts dynamic resolution (render scale) from the GpuTimer feedback toward
    a configurable cloud budget in ms, with hysteresis and no oscillation.
    Wire it into `@clouds/three` and show it in the flagship HUD.
- **Acceptance:**
  - The tables above.
  - Composite ≤ 0.5 ms and history ≤ 25 MB at 1440p high.
  - Low and mobile hit their ratios.
  - Auto converges to the budget (for example 2 ms) within 2 s and holds
    steady. Show a trace in the report.
  - No visual regressions on high (A/B mean |Δ| ≈ noise).
  - Parity passes; `pnpm check` green.

### [x] P7-B Docs and package readiness · Sonnet
- **Owns:**
  - `packages/{runtime,three,react}/README.md` (new or rewritten)
  - `docs/guide/**` (new: getting started, API reference, presets and
    performance, authoring clouds from Houdini/Blender/VDB, demos tour)
  - the package `exports`/`files`/`peerDependencies` fields in
    `packages/{runtime,three,react}/package.json` (not versions or names; P7
    publish names are the user's call)
  - `scripts/check-bundle.mjs` (new)
- **Read-only:** all source; the work reports for facts and numbers.
- **Does:**
  - Accurate, concise docs drawn from the actual code: real signatures, real
    defaults, real numbers from the reports. Show the 9-line three.js and
    2-line React integrations, the VDB drop and Houdini recipes, tiers and
    auto quality, and memory and cost tables.
  - A bundle-size script that esbuild-bundles each package entry (three and
    react external) and reports gzipped sizes.
- **Acceptance:**
  - Docs build-free markdown with links that resolve (run a link check).
  - Every code sample in the docs typechecks (extract it into a scratch `.ts`
    and run `tsc`).
  - The core bundle size is reported against the < 60 KB gzip target.
  - `pnpm check` green.

### [x] P7-D Demo polish for the showcase scenes · Sonnet
- **Owns:**
  - `examples/lab/{open-water,onsen,plains-flight,three-adapter}/**`
  - `examples/lab/scenes/{ocean,terrain}/**`
- **Read-only:** `packages/**` (consume APIs).
- **Does:**
  - **Ocean** (`work/captures/P2-A/sunset.jpg`, `work/captures/P2-03/*`): fix
    the darker LOD band 1–3 km out at grazing angles and the tile crosshatch
    near 300 m.
  - **Open water and plains flight:** enable the sky layer (P3-C2) so cloud
    cover continues to the horizon; use the `high` preset with
    `quality=auto` as an option; re-check that the 60 fps measures still hold.
  - **Onsen:** swap the stamped tower for `heroes/sim-congestus`, add a slow
    drift to the valley fog (re-stamp periodically or move instances,
    amortized, with no pops), and frame `vantage` so the hero cloud reads.
  - **Every showcase page:** a minimal, tasteful HUD toggle (`?hud=0` hides
    debug text) for clean screenshots, plus a `?clean=1` bookmark mode with no
    UI panel.
- **Acceptance:**
  - Clean captures (`?hud=0&clean=1`) at 2560×1440 of open-water
    `horizon`/`sunset`, plains-flight `t0`/`t25`, onsen `vantage`/`sunset`, in
    `work/captures/P7-D/`, plus before/after where fixed.
  - The ocean band and crosshatch are gone or clearly reduced (side-by-side).
  - 60 fps holds.
  - `pnpm check` green.

### [x] P7-C Publish-ready packages: dist builds, subpath exports, bundle target · Sonnet
- **Owns:**
  - `packages/{runtime,three,react}/package.json`
  - `packages/runtime/src/index.ts` and new subpath entry files only (no
    algorithm changes)
  - `scripts/build-release.mjs` (new), `scripts/check-bundle.mjs`
  - `packages/runtime/vendor/**`: move or copy `vendor/vdb-web-tools` inside
    the package, with its LICENSE and NOTICE
  - import path updates required by these moves
- **Does:**
  - Split `@clouds/runtime` into subpath exports: the core runtime as the main
    entry, plus `/generate`, `/import`, `/dome` (if separable), `/assets`, and
    so on, so a typical three.js user's bundle is under 60 KB gzipped.
  - Build ESM `dist/` with `.d.ts` for each package (esbuild plus
    `tsc --emitDeclarationOnly`), with `exports` pointing at `dist`.
  - The vendored VDB code ships inside the runtime package with its Apache
    LICENSE and NOTICE.
  - `npm pack --dry-run` for each package lists exactly the intended files.
  - Write a consumer smoke test: a temp directory installs the packed
    tarballs, then imports and typechecks both a three example and a react
    example. Reuse ideas from `scripts/check-consumer.mjs` (legacy).
  - Keep the lab working, through vite aliases to source or dist, whichever
    is simpler.
- **Acceptance:**
  - Bundle report: the three-user path is under 60 KB gzipped, and the full
    runtime with subpaths is listed separately.
  - The packed-consumer smoke test passes: install, typecheck and bundle.
  - `pnpm check` green, and `node scripts/check-docs.mjs` still passes. Update
    the docs import paths if subpaths changed. You may edit `docs/guide/*.md`
    and package READMEs only for import paths.

### [x] P7-E Sky-layer and handoff fixes at cloud altitude · Sonnet (Fable on failure)
- **Owns:**
  - `packages/runtime/src/{sky-layer.ts,shaders/sky-layer.wgsl.ts,shaders/composite.wgsl.ts,dome.ts,shaders/dome.wgsl.ts}`
  - minimal `runtime.ts`
  - `examples/lab/open-water/**` and `examples/lab/plains-flight/**`, for wiring and measurement
- **Bugs:**
  1. **Open-water `cruise`** (`work/captures/P7-D/ow/cruise.jpg`, camera at
     300 m among the clouds): clouds read as vertical-sided blocks, and a tall
     white column shows in the water reflection. Root-cause it: voxel-box wall,
     sky-layer near field, temporal resolve or the dome reflection.
  2. **Sky layer has no `weatherOrigin`:** after a streaming swap the far
     field no longer matches the streamer's weather. Add the option and wire
     it in plains-flight.
  3. **Open-water sunset** (`work/captures/P7-D/ow/sunset.jpg`): blocky bricks
     at the very horizon in the sky layer.
- **Acceptance:**
  - Clean before/after captures for each bug, with root causes named.
  - No regression on the P3-C2 bookmarks or the flagship (A/B).
  - 60 fps holds.
  - `pnpm check` green; `node scripts/check-packed-consumer.mjs` passes.

### [x] P7-F Slab-sided generated clouds · Sonnet (Fable on failure)
- **Owns:** `packages/runtime/src/generate/{weather.ts,shaders.ts,presets.ts,generator.ts}` and its tests; `examples/lab/open-water/**` and `examples/lab/cloudscape-gen/**` for measurement only.
- **Problem:** at the cumulus preset's `cellular` 0.75, generated clouds seen from cloud altitude read as extruded slabs with flat vertical faces and straight creases (`work/captures/P7-E/ow-after-preset-cells/cruise.jpg`). P7-E worked around it in the demo (`cellular` 0.55); the engine still does it. The P3 note "the cumulus preset looks columnar" is the same issue.
- **Does:** root-cause it in the generator (suspects: Worley F1 gradient creases at cell borders, coverage → profile mapping that extrudes a 2D mask vertically, a height profile that doesn't round tops and taper sides). Fix it in the engine so the presets give rounded, tapered cumulus at their defaults, then restore the open-water demo to the preset value.
- **Acceptance:**
  - Before/after captures from open-water `cruise` and `horizon` at preset defaults, plus cloudscape-gen `ground`, `horizon` and `above` bookmarks: no flat vertical faces or straight creases.
  - Generation cost per job is not more than 10% higher.
  - Plains-flight streaming swaps stay invisible (mean |d| ≤ 1/255).
  - `pnpm check` green; `node scripts/check-packed-consumer.mjs` passes.

### [x] P6-B Storm cell and lightning · Sonnet (Fable on failure)
- **Owns:**
  - `packages/runtime/src/generate/{evolution.ts,weather.ts,shaders.ts,presets.ts}`, for the storm cell
  - `packages/runtime/src/shaders/march.wgsl.ts`, `packages/runtime/src/shaders/frame.wgsl.ts` and minimal `runtime.ts`, for lightning
  - a new `packages/runtime/src/lightning.ts`
  - the three adapter's settings pass-through only if needed
  - a new `examples/lab/storm/` page and its `vite.config.ts` input line
- **Does:**
  1. **Storm cell:** a cumulonimbus life cycle on top of P6-A evolution. One cell grows from cumulus through congestus to a tall cell with a flattened, spreading anvil top over about 2 minutes of sim time, then the surrounding field keeps evolving. Weather map `type`/`top` drive it. No new volume format.
  2. **Lightning:** flashes are transient point lights inside the cloud.
     - Use the Nubis³ glow term `pow(1 - d/r, 12) * (1 - sat(rho*5))` from `docs/research/nubis-sources.md` §4 [N3 s130, SY s71] as secondary light energy, added to the march.
     - An API on the runtime: `runtime.flash({ position, radius, intensity, duration })`, and/or an automatic `lightning: { rate }` setting.
     - It costs nothing when no flash is active: branch on a uniform.
     - Flicker profile: 2–4 strokes over about 0.3 s.
     - The temporal resolve must not smear the flash for many frames. Handle it, for example by resetting or weighting history during a flash, and document the choice.
  3. **Demo page `storm/`:** a time-lapse storm build with periodic lightning, bookmarks `ground`, `distant` and `inside`, and `?hud=0&clean=1`, using the capture harness contract.
- **Acceptance:**
  - Captures of the storm at t = 0, 30, 60, 90 and 120 s sim time, showing the build-up and anvil.
  - Flash frames lit from inside: the glow is soft and volumetric, not a sprite.
  - Cost: ≤ +1 ms over the same static cloudscape at 2560×1440 high, both outside and during flashes.
  - Flagship and open-water A/B unchanged with no flash.
  - `pnpm check` green; `node scripts/check-packed-consumer.mjs` passes.

### [x] P6-C Cumulonimbus that reads as one · Fable
- **Owns:**
  - `packages/runtime/src/generate/**` (including `volume-generator.ts` and `stamp.ts`) and its tests
  - `examples/lab/storm/**`
  - `packages/runtime/src/shaders/march.wgsl.ts`, for lightning glow tuning only
- **Problem:** P6-B's storm (`work/captures/P6-B/timelapse-distant.jpg`, `flash-vs-noflash.jpg`) has four faults:
  - The tower is a bucket with vertical flanks and a flat base.
  - The anvil is a thin flat plate.
  - A regular dimple lattice covers the flanks; the volume is 16 m voxels.
  - The lightning glow is a uniform blue-white wash.

  The weather map is 2.5D (base and top per column), so tall cells come out as extrusions.
- **Does:** give the storm cell a real 3D shape. The P6-B evolution timing and API stay.
  - A tower that tapers and bulges into turrets, with cauliflower flanks, and gets wider with height under the anvil.
  - An anvil with a thick, curved, sheared underside that overhangs the tower. Mammatus is a bonus.
  - A rain-free base that is darker and flat-ish but not a cut.
  - Approach is your choice. One option is a parametric 3D cell (profile as a function of height and radius, plus displacement noise) stamped into the evolving volume via the P4-C stamp path. Another is a sequence of Houdini Pyro-sim keyframes (`scripts/vdb/authoring/sim/`, P4-F); hython is available. Pick what looks best within the cost budget.
  - Root-cause and fix the dimple lattice.
  - Tune the lightning glow so it reads as light inside the cloud: a warm-to-cool falloff, brightest near the strike, and occlusion by density.
- **Acceptance:**
  - Time-lapse at 0/30/60/90/120 s and a flash pair. A non-expert should read it as a thunderstorm: a towering cauliflower with an overhanging anvil.
  - Side-by-side against a real cumulonimbus reference. Describe the reference; don't commit copyrighted photos.
  - Cost: ≤ +1 ms over a static cloudscape at 2560×1440 high.
  - No regression to the cumulus presets (cloudscape-gen bookmarks, A/B).
  - `pnpm check` green; `node scripts/check-packed-consumer.mjs` passes.

## Phase 8: comparison, docs site, gallery, mobile, sparse heroes (owner request, 2026-10-09)

### [x] P8-A Side-by-side comparison page · Sonnet (Fable on failure)
- **Owns:**
  - `examples/lab/compare/**` (new), including any vendored code under `examples/lab/compare/vendor/` with a NOTICE
  - the root `package.json` devDependencies and `pnpm-lock.yaml`, for the Takram packages
  - the `compare` input line in `vite.config.ts`
- **Does:** one page renders the same wide scene with two or three cloud implementations, split top/bottom or left/right (`?layout=rows|cols`, `?impls=ours,skypro,takram`, default `ours,takram`).
  - **Implementations:**
    - ours: `@clouds/three` with the generator's cumulus.
    - Sky Pro: from `/Users/dex/Developer/tidewater/src/sky/` (MIT, author's permission). Vendor only what's needed and keep its licence header.
    - Takram: `@takram/three-clouds` with `@takram/three-atmosphere`, from npm. It is WebGL plus postprocessing, so give it its own canvas and WebGLRenderer.
  - **Each pane:** its own canvas and renderer.
  - **Synced across panes:** the camera (orbit and free-fly, driven from one pane), sun azimuth and elevation, time of day, and FOV.
  - **Comparable inputs:**
    - Coverage is mapped per implementation, with each mapping documented.
    - Wide scene: ground plane or ocean, with bookmarks `ground`, `horizon`, `sunset` and `above`.
  - **Labels and timings:**
    - Each pane is labelled with its implementation.
    - Per-pane timing: GPU timestamp where the renderer allows it, otherwise CPU frame time, shown in the label.
  - **Harness:** implement the capture contract so `capture.mjs --page compare/ --shots ground,horizon,sunset,above` works. Report per-pane timings in the report object.
- **Acceptance:**
  - Captures of all four bookmarks with three panes, plus two-pane rows and columns. All panes use the same view: the horizon at the same height and the sun in the same place.
  - A short write-up in `work/reports/P8-A.md` of visible differences per bookmark, to guide what we adjust.
  - `pnpm check` green; the packed consumer still passes (the core packages must not depend on Takram).

### [x] P8-B Docs site compatible with pmndrs/docs · Sonnet
- **Owns:**
  - `docs/guide/**`, moving to `.mdx`
  - `.github/workflows/docs.yml` (new)
  - `scripts/check-docs.mjs`
  - package README pointers
- **Does:** make `docs/guide` buildable by `pmndrs/docs` (`.github/workflows/build.yml@v3`, `mdx: 'docs/guide'`), the same setup as react-three-fiber and drei.
  - **Reference:** `~/Developer/r3f-docs-port/docs` and its `.github/workflows/docs.yml`.
  - **Pages:** each page becomes `.mdx` with frontmatter `title`, `description` and `nav`, with subfolders for sections if useful.
  - **Links:** relative links to source files become absolute GitHub URLs (`https://github.com/pmndrs/clouds/blob/main/...`; repo name TBD, keep it in one constant in `check-docs`). Images go next to the mdx.
  - **Checks:** update `scripts/check-docs.mjs` for `.mdx` and frontmatter, keeping the link check and the sample type-check.
  - **Local build:** if feasible, build locally with a clone of `pmndrs/docs` in the scratchpad (not committed) and record the result. Otherwise validate the frontmatter schema against pmndrs/docs' source.
- **Acceptance:** `node scripts/check-docs.mjs` green; `pnpm check` green; a local pmndrs/docs build or a schema check is recorded in the report.

### [x] P8-C Examples gallery · Sonnet
- **Owns:**
  - `examples/lab/{index.html,main.ts,style.css}`
  - a new `examples/lab/gallery/thumbs/`
  - `scripts/gallery-thumbs.mjs` (new)
- **Does:** replace the stale lab index with a gallery.
  - **Cards:** one per current page: open-water, plains-flight, onsen, storm, evolve, cloudscape-gen, vdb-drop, r3f, three-adapter, flagship, and compare once P8-A lands. Link compare even if the page isn't built yet.
  - **Card contents:** a thumbnail, title, one-line description, the packages used, and the capture bookmark links.
  - **Thumbnails:** `scripts/gallery-thumbs.mjs` regenerates them with the capture harness (`?hud=0&clean=1`) as small webp or jpg files.
  - **Legacy and test pages:** a collapsed section.
  - **Layout:** works at phone width.
  - **Fallback:** a WebGPU-unavailable banner on the gallery.
- **Acceptance:** a capture of the gallery at desktop and phone width; thumbnails regenerate with one command; `pnpm check` green.

### [~] P8-D iOS Safari / WebKit bring-up · Sonnet (Fable on failure)
- **Owns:**
  - `examples/lab/gpu-smoke/**` and `examples/lab/harness/**`
  - fixes in `packages/runtime/src/**` or `packages/three/src/**` that WebKit needs, kept minimal and reported
- **Problem:** in the iOS 26.4 simulator (iPhone 17 Pro, Safari), even `/gpu-smoke/` renders a black page with no text. It is served by `vite --host 127.0.0.1 --port 5199` and opened with `xcrun simctl openurl booted <url>`.
- **Does:** root-cause it.
  - **Getting logs:** Playwright WebKit on macOS gives console logs; check whether it exposes WebGPU. You can also run Safari on the Mac with WebGPU, using `simctl` screenshots (`xcrun simctl io booted screenshot`) and the simulator's logs (`xcrun simctl spawn booted log show --last 2m --predicate 'process == "MobileSafari"'`).
  - **Fallback:** every page shows a visible error overlay (`navigator.gpu` missing, adapter or device failure, shader compile errors) instead of black. Put it in the harness so all pages get it.
  - Fix WebKit-specific WGSL or API issues (timestamp-query absence, format support, limits). Then get open-water, plains-flight and onsen rendering in the simulator, with `quality: 'auto'` picking the phone tier.
- **Acceptance:**
  - Simulator screenshots of gpu-smoke, open-water, plains-flight and onsen rendering, or a clear root cause if WebGPU is unavailable in the simulator.
  - Chrome captures unchanged (A/B the flagship).
  - `pnpm check` green.

### [x] P8-E Sparse hero storage from WebVDB: design spike · Fable
- **Owns:** `work/specs/P8-hero-vdb.md` (new) and `work/reports/P8-E.md`. Read-only everywhere else, including `/Users/dex/Developer/WebVDB`.
- **Does:** design how hero clouds get 2–4 m effective voxels without dense textures, building on the owner's WebVDB repo. That repo ships `nanovdb-wgsl`, `three-nanovdb` and `vdb-web-tools` at 0.1.0; per its STATUS it is "WIP" in places.
  - Decide the format: a sparse NVDF (profile, type, scale) plus SDF in NanoVDB trees, or a brick atlas with an indirection grid.
  - Decide how the march samples it alongside the regional 8 m field: union in the density function, SDF min.
  - Cover the light grid's interaction and the cost on desktop and phone.
  - Say what in WebVDB must be finished or extended.
  - Cover the conversion path from the existing hython/in-browser importer.
  - Include prototype numbers if a quick measurement is cheap.
- **Acceptance:** a spec the orchestrator can split into implementation tasks, with risks and an explicit recommendation.

## Phase 9–13: variety, shadows, deck scenes (plan: `docs/PLAN-2026-10-variety.md`)

### [x] P9-A Variety metrics · Sonnet
- **Owns:** `scripts/variety.mjs` (new) and its tests; a small read-only hook in `examples/lab/harness/clouds-contract.ts` if a page must expose data (additive).
- **Does:** score a cloudscape's variety from the capture harness. Measures are defined in the plan's 9-A row:
  - footprint statistics from a top-down coverage view (connected components, size CV, largest/smallest ratio);
  - base-altitude spread per layer;
  - a clone score: median normalised cross-correlation of silhouette crops of different clouds from a side view;
  - autocorrelation peak at the cell spacing.
  - Prefer reading the generator's weather map or NVDF back from the GPU through the page contract over image heuristics where that is more robust. Document which source each metric uses.
- **Acceptance:**
  - Runs on cloudscape-gen (cumulus, congestus, stratocumulus) and open-water.
  - It scores today's cumulus as failing the plan thresholds, as a sanity check.
  - Results are written to `work/captures/P9-A/variety.json` and a readable summary.
  - `pnpm check` green.

### [x] P9-B Weather v2: multi-scale, shared bases, shear · Fable (in flight; new tasks: Haiku/Sonnet/Opus, Fable only if Opus struggles)
- **Owns:** `packages/runtime/src/generate/{weather.ts,shaders.ts,presets.ts,volume-generator.ts,evolution.ts}` and tests.
- **Pages, read-only until P10-A lands:** do not edit `examples/lab/cloudscape-gen/main.ts` or `open-water/main.ts`, since P10-A has uncommitted edits there. Use the existing `?preset=`, `?w_*` and `?p_*` overrides, or add a new preset name.
- **Does:** the plan's 9-B row (`docs/PLAN-2026-10-variety.md`).
  - **Weather scales:** cluster scale (2–8 km) for where clouds gather and where the gaps are; cell scale for individual clouds with a wide size distribution; a sub-cell lobe split.
  - **Bases:** one condensation base per layer (±15 m).
  - **Shear:** a wind-shear lean.
  - **Fractus** near large cells.
  - **Species channel:** a regional field. 9-C will consume it; for now it only varies size and height.
- **Acceptance:**
  - `node scripts/variety.mjs --serve` passes the cumulus thresholds: lobe-footprint CV ≥ 0.7, base spread ≤ 30 m, clone score ≤ 0.6, no cell-spacing peak.
  - Congestus and stratocumulus don't regress.
  - Ground, horizon and above captures read as a varied sky, not a cloned wall. Side-by-side vs `work/captures/P9-A/*`, plus the compare page against Takram.
  - Generation cost per job ≤ +20%. Plains-flight swaps still invisible.
  - `pnpm check` green; packed consumer OK.

### [x] P10-A Cloud shadow map · Sonnet (Fable on failure)
- **Owns:**
  - a new `packages/runtime/src/shadow-map.ts` and `packages/runtime/src/shaders/shadow-map.wgsl.ts`
  - minimal hooks in `runtime.ts`
  - `packages/runtime/src/shaders/composite.wgsl.ts`: switch the composite shadow to the map
  - the sky-layer shader, read-only, for the shared field functions
- **Does:** a texture seen from the sun that holds cloud optical depth along the sun ray.
  - **Coverage:** the voxel region, plus the sky layer's field out to the horizon. Two cascades: near ≈ 8 km at 8 m texels, far ≈ 60 km.
  - **Refresh:** amortized over frames, and invalidated on sun, weather or volume change.
  - **Interface:** expose it on the runtime (texture, view-projection, sampling WGSL) for adapters. 10-B adds the three node; this task only switches the composite path to it.
- **Acceptance:**
  - Sky-layer clouds shadow ground and water in open-water and cloudscape-gen.
  - A debug overlay projecting the shadow map onto the ground matches cloud silhouettes within 2 texels.
  - No swimming as the camera moves (A/B frames).
  - Cost ≤ 0.3 ms amortized, ≤ 1 ms on a refresh frame, at 2560×1440 high.
  - Flagship A/B shows no regression except the intended shadow change.
  - `pnpm check` green; the packed consumer passes.

### [x] P10-B Cloud shadows in three materials · Sonnet
- **Owns:**
  - `packages/three/src/**` and `packages/react/src/**`: shadow node and prop pass-through
  - `examples/lab/scenes/{terrain,ocean}/**`
  - `examples/lab/{onsen,plains-flight,three-adapter}/main.ts`
  - `docs/guide/api.mdx` (the shadow API, and the CloudMemory `shadow` field P10-A added)
- **Does:** `clouds.shadowNode` or `cloudShadow(positionWorld)` as a TSL node built on `runtime.shadowMap` via `cloudShadowMapWgsl`. Scene materials use it to dim **direct sun only**, keeping sky and ambient light. Wire it into a three DirectionalLight's shadow or color node, or document the material hook. Provide a simple opt-in for users, e.g. `clouds.applyShadow(light)` or a node to multiply into `material.colorNode`/lighting.
  - When a scene uses the node, the composite-alpha shadow is turned off for it (no double shadow). The composite path stays the default for scenes that don't opt in.
  - Wire it into the terrain scene (onsen, plains-flight), the ocean (open-water) and the three-adapter ground.
- **Acceptance:**
  - Captures of onsen, plains-flight and open-water with moving cloud shadows that darken sunlit areas but leave shadowed and ambient areas at sky light. Compare with the composite path.
  - The plains-flight `t0` and `t25` frames show shadows racing over the fields.
  - Cost ≤ 0.1 ms.
  - The renderer-agnostic test still passes.
  - `pnpm check` green; the packed consumer passes; `node scripts/check-docs.mjs` green.

### [~] P9-B2 Weather v2 follow-ups: no-stall bake, sky-layer parity, test relax · Opus
- **Owns:**
  - `packages/runtime/src/sky-layer.ts` and `shaders/sky-layer.wgsl.ts`
  - `packages/runtime/src/generate/weather.ts` (encode API for tiled bakes)
  - `examples/lab/runtime-tests/generate/**`
- **Does:**
  1. **Stall:** P9-B's richer weather shader makes the sky layer's one-off 2048² weather bake take **12.8 ms** in one frame (was 1.5). That is a stall on every weather change, which the plan rules out. Tile the bake (rows or blocks) over frames, keeping the old window until the new one is complete, or otherwise get every frame ≤ 1 ms. The 512² generator bake (1.4 ms) is inside the amortized generator job budget; check it.
  2. **Sky-layer parity:** in `work/reports/P9-B.md` open issue 1, the sky layer has no shear lean and ignores channel B (the owning cloud's peak scale), so distant small cells keep the full billow and clouds straddling the box wall step by up to about 25 m. Apply the two changes the report lists and verify seams with cloudscape-gen `sky=1` `seamNorth`/`seamEast`.
  3. **Tests:** `runtime-tests/generate` fails two checks that assume a dense field (P9-B open issue 2). Relax them properly: test the invariant (SDF is conservative, f16 tolerance scaled with distance), not the old density.
- **Acceptance:**
  - No frame over 1 ms of weather or bake work when changing weather (GPU timestamps; quote the frame series).
  - Seam captures with no visible step.
  - The `runtime-tests/generate` page passes.
  - `pnpm check` green; the packed consumer passes.

### [~] P9-F Authored cloud library (Houdini Pyro batch) · Opus
- **Owns:**
  - `scripts/vdb/authoring/sim/**`
  - `assets/clouds/library/**` (new; each cloud < 4 MB, committed)
  - `examples/lab/library/**` (new page)
  - its `vite.config.ts` input line and an entry in `examples/lab/gallery/cards.json`
- **Read-only:** `packages/runtime/src/generate/stamp.ts` and the importer. Don't edit runtime or generate files; P9-B2 owns those right now.
- **Does:** extend the P4-F Pyro-sim recipe into an unattended batch with seeds and parameters.
  - **Library size:** 12–20 hero clouds with real variety, matching the species in `docs/research/deck-scenes.md` §2 and `docs/research/hzd-nubis-evolved.md`:
    - small humilis, mediocris, tall congestus with turrets;
    - leaning, sheared ones;
    - a flat-topped stratocumulus slab;
    - a decaying wispy one;
    - a cap/pileus tower for T6, if feasible.
  - **Per cloud:** a JSON manifest (species, size, base and top, seed, sim params).
  - **Conversion:** to NVDF and SDF with the existing converter.
  - **Library page:** stamps 30+ instances with random yaw, scale and position into a generated field (P4-C stamping, Atlas-style frankenclouds), with bookmarks `ground`, `horizon` and `above`.
- **Acceptance:**
  - The batch runs unattended (one command, logged).
  - A contact sheet of all library clouds, isolated and side-lit, shows distinct silhouettes.
  - The library page shows no visible repeats from three bookmarks.
  - `node scripts/variety.mjs` on the library page reports clone score ≤ 0.5 (extend the page with the `fields` hook).
  - 60 fps at 2560×1440 high. `pnpm check` green.

## Ahead of phase (parallel, no file overlap with P1)

### [x] P2-A Open-water scene module · Sonnet
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

### [x] P4-A VDB → NVDF converter (Houdini) · Sonnet
- **Owns:** `scripts/vdb/**` (new), `assets/clouds/README.md` (append a section only), `work/captures/P4-A/`, report.
- **Does:** a hython converter
  (`/Applications/Houdini/Houdini21.0.671/Frameworks/Houdini.framework/Versions/Current/Resources/bin/hython`,
  Indie licence) that writes the **same runtime format** as `scripts/nubis/convert.mjs`
  (`cloud.json`, `nvdf.bin` rgba8, `sdf.bin` r16 unorm −256…4096 m, rounded down).
  - **Mode 1, NVDF VDB:** the Nubis pack VDBs, which already hold profile, detail
    type, density scale and SDF fields. Read them and write our format.
  - **Mode 2, artist fog VDB:**
    - SDF from a density iso threshold
    - profile from the SDF, the Nubis way: 0 at the surface rising inward over a
      configurable depth
    - detail type from an optional VDB attribute, else a height heuristic
      (wispy bottoms, billowy tops)
    - density scale from the normalized density
  - **Mode 3, SDF or level-set VDB** (e.g. a mesh converted in Houdini): treat
    it like mode 2 from the SDF.
  - **Common to all modes:**
    - resample to a target voxel size (default 8 m, with world-scale
      overrides)
    - crop with margin
    - keep the transform translation in `cloud.json`
  - Reuse what helps from the legacy `scripts/convert-vdb-houdini.py`.
- **Acceptance:**
  - **Pack VDB parity:** converting `ParkouringCloud.vdb` and `StormbirdCloud.vdb`
    from the full pack (`/Users/dex/Developer/WebGPUClouds/artifacts/research/nubis-pack/extracted/Nubis Voxel Clouds Pack/NVDFs/Examples/*/VDB/`)
    matches the TGA-derived `assets/clouds/{parkouring,stormbird}`: NVDF channels
    within 2/255 at ≥ 99% of voxels, SDF median |diff| ≤ 4 m. Report what the
    VDB grids contain (names, value types, transform, voxel size).
  - **Mode 2:** convert a fog VDB generated in Houdini by a small script (a
    cloud-like noise-displaced sphere cluster) and render it in the flagship with
    `?cloud=<name>`, adding only a loader branch if needed. Report what
    `flagship/main.ts` needs if you can't touch it. Captures in
    `work/captures/P4-A/`.
  - Conversion time for each file is reported.

## Decisions and escalations

- 2026-10-08: the Nubis pack is treated as MIT (owner's call). The Sky Pro author has given permission. Upgraded to sky and upscaler 0.5.0.
- 2026-10-08: the SDF is uploaded as `r16float` metres, rounded down, because `r16unorm` is not a core WebGPU format. The 8 m voxel size is verified against the pack's SDF (P0-02).
- 2026-10-09: Open follow-ups from P7-D:
  - open-water `cruise` blocky columns plus a reflection column at cloud altitude
  - the sky layer needs a `weatherOrigin` for streaming swaps
  - blocky bricks at the horizon at open-water sunset
- 2026-10-09: The phone check in the iOS Simulator is blocked: the Simulator app and the iOS platform aren't installed (`open -a Simulator` reports "Unable to find application"; `simctl list` hangs). The user can install it from Xcode → Settings → Components → iOS, or run `xcodebuild -downloadPlatform iOS`. Real-device testing (iPhone, Android, an iGPU laptop) needs the user's hardware.
- 2026-10-09: P7-B: the full `@clouds/runtime` entry is 70.8 KB gzipped, over the 60 KB target; the `@clouds/three`-used subset is 51 KB. → split subpath exports (`/generate`, `/import`, `/dome`) before publish. Packages export source only (no dist build yet), and the importer reaches `vendor/` from outside the package; fix both in the publish task. Lockfile resynced by the orchestrator.
- 2026-10-09: P5-B is accepted with an orchestrator re-measure at 2560×1440 high: ground 1.94, edge 1.86, inside 2.97 ms (≤ 3 ms). Next levers: the composite (about 1 ms, now the largest pass) and the temporal history memory (about 63 MB at 1440p; phones).
- 2026-10-09: P5-A replaces the 3D JFA with an exact separable EDT. The P4-C overshoot risk is gone; scratch 302→34 MB, generation 47→17 ms. Mobile risk: the y-pass uses large per-thread private arrays, so validate on mobile GPUs in P5. Re-verify the stamp page after P5-B lands (it failed during P5-B's in-progress runtime edits).
- 2026-10-08: P4-C finding: the generator's single jump-flood round can overshoot the true distance by up to 6.7 m on sparse fields; stamping uses 2 rounds and never overshoots. → verify the generator's SDF on sparse presets and default to 2 rounds or a larger margin (P3 follow-up). Also, `createSdfRebuilder` reads the generator's params layout in `shaders.ts`, so keep them in sync. The cumulus preset looks columnar in taller (96-slice) volumes.
- 2026-10-08: P3-C1 is committed as experimental, off by default. It works (clouds to the horizon, 1.35 ms) but fails visually: peaked cones, static ¼-res hatching, cliff edges, a blocky horizon band, darker shading than voxels. → escalated to Fable as P3-C2.
- 2026-10-08: P3-D accepted: world-anchored generation (overlap byte-identical), streaming swaps with no pop (0.20/255), and the flight demo. It exposed performance problems on large generated volumes: the light grid costs about 3 ms/frame (vs 0.07 on Parkouring) and the march under thick bases 8–24 ms → P3-E. Streaming scratch is about 300 MB → P5.
- 2026-10-08: P3-B accepted: generated cumulus fields read as real cumulus. Follow-up for the P3 art pass: thick generated undersides go charcoal-black in their cores, seen from the ground (`work/captures/P3-B/cumulus/ground.jpg`), and need lighter blue-grey bases. Congestus height is capped by the 512 m volume.
- 2026-10-08: P2-03 accepted as the working demo: 60 fps at 2560×1440, whole-frame GPU about 4.3 ms, shadows on the water. Known gaps: boxy generated clouds (P3-B), cloud reflections need `clouds.reflection()` in the adapter plus an ocean hook (P2-05), and ocean tile crosshatch at 300 m.
- 2026-10-08: P4-A follow-up: the mode-2 profile mapping (`saturate(−sdf/depth)^γ`) saturates too fast, so authored clouds read as soft sphere clusters (`work/captures/P4-A/edge.jpg`). Fit Guerrilla's profile-vs-SDF relation from the pack data (it ships both) in P4-B.
- 2026-10-08: P2-A ocean polish for Phase 2: a darker LOD band about 1–3 km out at grazing angles (see `work/captures/P2-A/sunset.jpg`), faint tile repetition, no foam. The page calibrates for about 6 s before ready (`?nocal=1` skips it).
- 2026-10-08: P3-A generator note for Phase 3: the jump flood allocates about 268 MB of seed buffers at 512²×64. Packed seeds or a tiled flood are needed before phones (P5). Not double-buffered, so render the old volume until `done`.
- 2026-10-08: density parity gate: formula ≤ 1e-3 (measured 2.8e-7) and end to end ≤ 5e-3. Hardware trilinear filtering quantizes weights to 1/256, and the Nubis sharpen `pow` amplifies that at cloud edges (P1-04).
- 2026-10-08: resolved. The 10–11 ms for animating the sky's time of day was a timestamp attribution artefact. The real cost is about 1.8 ms per frame (mostly the PMREM prefilter), or 1.2 ms if the sun updates every 4th frame (P1-02). A no-bake option would need a sky-side change; not required now.
