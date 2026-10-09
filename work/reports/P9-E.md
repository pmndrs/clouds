# P9-E High layer: cirrus and cirrostratus
Status: ready for review
Changed:
- New: `packages/runtime/src/cirrus/{index.ts,bake.wgsl.ts,render.wgsl.ts}`.
- Hooks: `runtime.ts` (create, `runtime.cirrus`, encode before the composite, composite entries); `shaders/composite.wgsl.ts` (binding 17/18, merge after the sky layer); `compare/panes/ours.ts` (query keys). Outside my list: one export line in `packages/runtime/src/index.ts` (public types).
- Commits: 6907e2c, af18e76, 5cb572c, and the one with this report.

What it is:
- A 2.5D slab on a planet-curved shell (default 9 km, 600 m thick), its own wind, one compute pass at the composite's size. The composite merges it behind everything (in front when the camera is above it). It works the same under `nvdf`, `procedural` and `hybrid`: it only needs the scene depth.
- Density: Nubis Evolved p.65. `type` picks among baked streaky, wispy and round noises; `coverage` is an exponent plus a fade-in; a non-tiling ~50 km coverage field breaks up the tile; a fine fibre channel is read at 4x. `veil` adds the cirrostratus sheet; it follows the coverage field, so it covers part of the sky.
- Noise tile: 2048² rgba8, 80 km by default, baked on the GPU over 64 frames in row slices, then mip-mapped. Streaky = fibratus bundles (8:1 anisotropic, warped, ridged fibres that fade in and out) plus a few uncinus hooks. Wispy = feathery patches combed by warped fibres. Round = small cells in patches.
- Light: thin ice, no march. The view optical depth uses the exact chord through the shell, so it thickens toward the horizon. The sun optical depth uses two taps toward the sun, with a path factor capped at 3 (patchy layer). Sun = the atmosphere transmittance at the layer's height along the point's own curved up, with the earth's shadow softened by the sun disc. So it stays lit, orange then red, after the ground and low clouds go dark, and goes grey at about -3°. The ice phase is a two-lobe HG plus an optional 22° halo. A low-order ms term. Ambient = the low clouds' sky light pair (C1's low-sun lean included). Then aerial perspective and the C2 haze at the hit distance.
- Optional faint ground shadow (`shadowStrength`, default 0). Uniform lighting (no sky library) has its own pipeline (sun and ambient from the sky light buffer, no AP).

Public settings (`runtime.cirrus.settings`, docs comments in `cirrus/index.ts`): enabled (off), altitude, thickness, coverage, type, veil, opticalDepth, scale, detail, coverageVariation, windVelocity, windOffset, animSpeed, streakAngle (null = along the wind), shadowStrength, halo, phaseForward/phaseBroad/phaseForwardWeight, multipleScattering, sunGain, ambientGain.
Compare: `?cirrus=1`, `?cirrus_cov=`, `?cirrus_alt=`, `?cirrus_<setting>=N`.

Verified:
- `pnpm check` → exit 0 (typecheck, 245/245 tests, build). `pnpm check:packed` → PACKED CONSUMER OK. `check-bundle` (report only): core 61.6 KB gzip, `@clouds/three` +deps 65.0 KB.
- Default limits: the composite stays at 16 sampled textures; the layer reaches it as a read-only storage buffer. The dome runtime-test page runs with no errors (`scratch/p9e/dome-test`). No console errors in any capture.
- Off = unchanged: with the layer off the composite branch is skipped. Ground pixels with it on vs off differ by a mean |Δ| of 0.02/255 (`nvdf` vs `nvdf-off`), so it adds no shadow by default.
- Captures in `work/captures/P9-E/` (compare page, ours only; the layer on with defaults unless noted):
  - `nvdf/`: ground, sunset, dusk, afterglow, above. `nvdf-off/`: ground and afterglow without the layer.
  - `texas-veil/`: the T1 view, `cirrus_veil=0.35`.
  - `cirrostratus-halo/`: `veil=0.8 cov=0.7 halo=1`, looking at the sun.
  - `types-0`, `types-0.5`, `types-1`: streaky, wispy, round at pitch 55.
  - `sweep-1`, `sweep--1`, `sweep--2`, `sweep--3.5`: the afterglow view at sun elevations of +1, -1, -2 and -3.5°.
  - `procedural/` and `hybrid/`: ground, dusk, afterglow, above.
  - `cost-1440/` and `cost-1440-off/`.
- Photo side-by-sides (scratch only, they contain the owner's photos): `work/captures/scratch/p9e/sbs-photos.jpg` sets texas-veil, ground, cirrostratus, -1° and dusk against the T1 target, DSC00139, the halo photo and two sunset cirrus photos.

Measures:
- Reads as fibrous cirrus from the ground, not noise or fog: pass on my look. `texas-veil` shows long streaks with fibres inside and a regional milky sheet, close to the target's veil. Cirrostratus gives a milky sheet with a 22° ring.
- Holds colour after sunset: pass. The low clouds go dark at -1°, while the layer is orange at -1°, red at -2° and grey at -3.5° (the earth's shadow at 9 km). At +1° to +4° it is white-lilac. The photos' orange cirrus matches our -1/-2°.
- All three density models: pass (`nvdf`, `procedural`, `hybrid`; behind the low clouds, and visible from 3 km in `above`).
- Cost (GPU timer, `cirrus` pass, full composite size): 1080p 0.3–0.6 ms with half the frame sky, 0.6–1.2 ms looking up (pitch 55); 1440p 0.7 ms (ground view). The composite hook adds about 0.05 ms. The guide was about 0.3 ms: over. The bake is one-time, 64 slices of about 0.5–1.2 ms each (`cirrusBake` stays in the rolling averages after it finishes, so `cloudsTotal` overstates by that much).
- Uniform lighting (no sky library): it renders (checked by a temporary local default flip on open-water `?uniform=1`, not committed). It is bright there, as the clouds are.

Open issues:
- **Cost over the guide.** Levers: half resolution with a bilateral upsample in the composite; sun taps only above a density threshold; skip the fine channel beyond a distance.
- **Haze hides the layer behind faded low clouds.** A distant low cloud faded into the C2 haze (and the sky layer's far clouds) shows the clear-sky colour, not sky plus cirrus. Under a thick veil near the horizon this reads as pale blue slabs (`cirrostratus-halo`, just above the low clouds). The fix belongs in the haze (`applyHorizonHaze` target radiance) of the march and sky layer, which are not my files.
- No reflection: the dome does not contain the layer, so water does not reflect it. It does not dim the low clouds' sun either (τ 0.1–0.5 would be 10–40 %).
- The few uncinus hooks still read as soft S-curves rather than true hooked commas. The round type has no photo reference (the library has no cirrocumulus).
- Not exposed through `@clouds/three` options (use `clouds.core.cirrus.settings`). No research-index row added (I don't own `docs/`); sources were NE p.65, RDR2 S64, Dobashi and Witcher, all already indexed.
