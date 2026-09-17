# P3 first lighting/environment slice — 2026-09-17

**State:** runnable prototype at [`/lighting/`](http://127.0.0.1:5173/lighting/). P3.1/P3.2 have local technical evidence; full P3 remains in progress, including atmosphere integration and visual review. At this checkpoint P4 had not started; see [P4 evidence](p4-evidence.md) for the subsequent reconstruction preview. The user accepted P2 for continued development with distance/LOD and view/shadow consistency tracked as open work.

## What changed

- Explicit Three node-material receivers sample the cloud transmittance cache before direct lighting is evaluated. Cloud shadows affect opaque materials, including curved surfaces, without multiplying ambient illumination or the final scene color.
- The volume samples the current Three directional depth shadow map with a 3×3 comparison filter. Moving opaque geometry changes cloud lighting without rebuilding cloud-only density/light data.
- The reference plane/box path remains available for P1/P2 comparisons. The P3 scene uses real mesh casters and material receivers.
- A separate fixed-probe renderer captures six linear HDR faces, then PMREM filters them for diffuse/specular environment lighting. Capture is explicit, awaited, and independent of the main view; the main background stays sky-only.
- Sun, density, moving occluder and composition controls expose the integration. Diffuse and reflective spheres show its lighting effects. **Refresh environment** deliberately controls when reflection lighting catches up to changed parameters.

Contract and ordering: [lighting/environment decision](decisions/lighting-and-environment.md).

## Validation

Local desktop in-app WebGPU browser reports `metal-3`, Chromium 152. Windows/RTX 3060 and the standalone Chrome profile were not newly validated for P3.

- `pnpm check`: type checking, **51 unit tests**, and all five lab page builds pass.
- **23 P3 GPU checks pass**, with no reported application/GPU validation errors in the final run.
- **19 P2 GPU checks still pass** after the shared renderer changes.
- Visual inspection: the diffuse/reflective spheres render; cloud shapes appear in the environment reflection; sun changes mark capture stale and the refresh button updates it. This is implementer inspection, not human R3 acceptance.

The P3 GPU checks cover current-frame geometry shadow changes, invariant cloud optical depth, cache reuse during geometry movement, restoration when the caster returns, density-triggered rebuild, a real material receiver at the floor boundary, ambient-light preservation, fresh receiver data with the direct-march reference, render-state restoration, and hook removal.

Capture checks verify all six raw cube face center colors against known HDR values (component tolerance 0.005), distinct face writes, PMREM resource creation, explicit refresh state, disabled view fade/reference geometry in capture, preserved host target/MRT, untouched background, environment installation/refresh propagation, and ownership restoration on detach/dispose. They do not prove seam-free directional cloud imagery, final probe parallax quality, or spectral/physical atmosphere correctness.

### Defects found while validating

A rotated Y=0 floor can interpolate to a microscopic negative height. Strict cache bounds rejected those points and removed shadow pixels. The receiver now allows a 1 cm tolerance at the vertical boundaries and clamps the sample coordinate; the GPU regression uses the original zero-height floor.

Three updates a camera's directional shadow map once per animation frame. Diagnostic renders now advance actual frames between caster changes. Scene precompilation uses the cloud target/MRT layout, and capture awaits it before each face, so asynchronous shader setup cannot silently omit initial geometry.

## Artifacts

Local, ignored evidence files:

- `artifacts/p3/2026-09-17/report.json` — settings, device/browser, 23 checks, errors and capture/main resource counts.
- `artifacts/p3/2026-09-17/lighting-objects.png` — default 40° sun, diffuse and reflective objects.

The environment refresh duration is wall-clock time including compilation/submission. It is not a GPU timing or performance preset. This slice has no new frame-time claim; P2's isolated cloud-march timings do not establish P3 total performance.

## Remaining work and quality bar

- Full atmosphere transmittance/in-scattering and calibrated sky/cloud lighting remain P3 work. pmndrs/sky supplies the sky, aerial perspective is disabled, and clouds retain a configurable exponential haze approximation.
- Cloud-shadow cache resolution/filtering remains coarse. The new 3×3 filter applies to **geometry shadow depth**, not to the broad cloud transmittance cache.
- Camera-relative distance fading, missing far LOD, mismatched view/shadow support, weather semantics, voxel silhouettes and spatial banding remain tracked. This slice does not fix them.
- Supported receiver setup: explicit node materials, receiving meshes, shadows enabled, one shadowed directional sun, conventional WebGPU perspective depth. Shadow camera coverage is the host's responsibility. Transparent/refractive interleaving, cascades and multiple shadowed lights are unclaimed.
- Environment contains sky/clouds only, excluding local terrain and opaque objects. A fixed probe has parallax limitations, and capture currently uses unfaded resident clouds while the view retains the P2 fade; exact horizon agreement is part of the open LOD work.
- Async compile/capture temporarily owns renderer state. The application must suspend other rendering with that renderer during the awaited operation; the P3 viewer does so.

Human steps and questions: [R3 review checklist](human-review.md#p3--light-sky-and-environment-r3).
