# Human review guide

This is the short review checklist for each stage. Human review records appearance, usability and product judgment; the orchestrator records technical acceptance separately. A stage marked **future** is not runnable yet and must not be treated as visually accepted.

Start with the stage you are reviewing; future checklists are previews, not requests to test unfinished work. A short note with the scene and what you saw is enough. The fuller record below helps reproduce a bug. At each checkpoint, update the [status summary](project-status.md), record new feedback here, and link the technical evidence.

## Reusable review record

Copy this block for a review:

```text
Stage/review:
Scene or URL:
Preset/seed:
Camera/path:
Settings (resolution, scale, density, sun, toggles):
Device/browser:
Expected:
Observed:
Screenshot or capture (optional):
Severity: blocking visual bug / preference / informational
Human judgment:
Technical check to follow up:
```

Use **blocking visual bug** for broken composition, missing required behavior, severe artifacts or an unusable control. Use **preference** for silhouette, scale, softness, repetition or tuning. Keep the human observation and the technical follow-up in separate fields. A preference does not imply technical failure, and a passing automated check does not imply visual approval.

## P0 — Foundation and integration proof

**Availability:** Runnable now at [`/`](http://127.0.0.1:5173/). Local checkpoint accepted. This is a diagnostic fixture, not a cloud review.

Human checklist:

- [ ] Click **Run GPU checks**; expect the lab to report a pass (resize and lifecycle are exercised automatically).
- [ ] Resize the browser window; the view should resize without corruption. Open **Direct GPU sharing** and change **Volume slice**; the right-hand volume view should change smoothly.
- [ ] Toggle the cyan capture object and sun controls; inspect the reflective sphere, plane shadows and environment update.
- [ ] Export a report/capture if a result needs recording.

Questions: Is the diagnostic result legible? Are the controls clear enough for a repeatable review? Technical acceptance: known-pattern values, producer/consumer directions, resize, disposal, build/tests and local GPU validation. Performance, RTX/Windows and injected device recovery remain unverified.

## P1 — First voxel cloud (R1)

**Availability:** Runnable now at [`/clouds/`](http://127.0.0.1:5173/clouds/). Technical baseline accepted locally; R1 shape review is pending.

Human checklist:

- [ ] View Cumulus, Tower and Wisps from ground, side and inside cameras, then use the fly-through.
- [ ] Repeat with the synthetic authored form; change density, physical size, sun and full-march/occupancy controls.
- [ ] Use the Show opaque object checkbox, cloud→ground and object→cloud switches, sun and camera controls to inspect depth and both shadow directions.
- [ ] Move slowly through the cloud boundary; expect continuous fog with no rectangular cut. Orbit at a low angle and change render scale; the floor shadow should stay continuous, without flashing holes.

Questions: Which silhouette, scale and softness direction should lead? Does the inside view feel useful and readable? Are the controls understandable without explanation? Technical acceptance: Beer–Lambert, empty density, scale, depth, inside views, occupancy equivalence, disposal and reference shadows. Stylized shapes are acceptable provisionally. The reproduced distant-ground dropout is fixed locally: the regression error fell from 0.75 to zero (tolerance 0.002). Please retest the view where you saw flicker; your visual confirmation is still pending. This result does not imply a fix for an unconfirmed P0 sphere-scene issue. Final art, cloudscape coverage, production shadows, reconstruction, VDB import and Windows validation are outside this stage.

## P2 — Cloudscape coverage and distance

**Availability:** Future; no runnable P2 scene yet. [`/clouds/`](http://127.0.0.1:5173/clouds/) is a P1 viewer and cannot substitute for this gate.

When available:

- [ ] Run the fixed ground-to-horizon-to-inside flight, then inspect with a free camera.
- [ ] Compare medium/far representations and L1 transitions with coverage and memory/update overlays.
- [ ] Check thin wisps, region/LOD boundaries and overlap for holes, popping or duplicate extinction.

Questions: Is horizon coverage convincing? Is repetition acceptable? Are transitions visible enough to be distracting? Technical acceptance measures coverage, transitions, memory, generation/upload and acceleration against a reference. Alternate presets may remain while R2 feedback is pending; no P2 visual acceptance exists before the scene is runnable.

## P3 — Light, sky and environment (R3)

**Availability:** Future; no runnable P3 scene yet. P0's sky/shadow fixture proves integration points only.

When available:

- [ ] Use the time-of-day slider and move an opaque occluder through the cloud.
- [ ] Compare cloud-only, sky-only and composite views with diffuse and reflective test objects.
- [ ] Change sun and density; confirm lighting, shadows and environment respond without stale state.

Questions: Is shadow softness believable? Is the atmosphere balance pleasing? Do diffuse lighting and reflections match the visible clouds, and is their refresh rate acceptable? Technical acceptance covers cache invalidation, both shadow directions, capture state, resource ownership and one-time atmosphere/tone mapping. Arbitrary transparency/refraction remains limited.

## P4 — Reconstruction and performance presets (R4)

**Availability:** Future; no reconstruction viewer or accepted preset yet.

When available:

- [ ] Compare native, spatial/final-scene and cloud-only reconstruction on identical recorded paths.
- [ ] Exercise camera cuts, rapid flight, wind, sun changes, voxel edits, resize and foreground edges.
- [ ] Review motion playback and guides for ghosting, disocclusion and double reconstruction.

Questions: What ghosting/detail tradeoff is acceptable? Which quality/performance preset should be the default? Are resets visibly clean after cuts and edits? Technical acceptance captures timing and image comparisons on M5 Pro and RTX 3060 where available. Missing RTX evidence leaves Windows performance unverified.

## P5 — Reusable library and R3F v10 (R5)

**Availability:** Future; no packaged consumer or R3F review scene yet.

When available:

- [ ] Install from the packed artifact and run plain Three.js and equivalent R3F v10 examples.
- [ ] Repeat mount/unmount, async cancellation, resize, camera replacement, multiple views and shared assets.
- [ ] Try the independent 2D layer and environment consumer and compare output/setup effort.

Questions: Are API names and setup intuitive? Does scheduler behavior feel predictable? Do the examples explain the important choices? Technical acceptance covers package boundaries, build, disposal and output equivalence; public API freeze waits on unresolved material/API decisions.

## P6 — Validation, assets and release (R6)

**Availability:** Future; no release candidate or asset review is runnable.

When available:

- [ ] Run required paths on recorded M5 Pro and RTX 3060 environments; install packed packages and inspect the changelog.
- [ ] Check limitations, attribution, capability errors and device behavior against the documented claims.
- [ ] Load one static authored density and one mesh-derived cloud, then try malformed input and cancellation; record converter, bounds, spacing, transforms and density semantics.

Questions: Is final scope clear and credible? Are fixtures/licenses acceptable? Is Windows usage ready, and is the asset extension worth shipping now? Technical acceptance covers install/build, compatibility, two-device evidence, malformed inputs, cancellation and license/attribution. Animated assets, generalized streaming, sparse playback and VDB export remain optional until separate gates pass.

## Track L — Independent 2D layer

L1 is available now at [`/layer-only/`](http://127.0.0.1:5173/layer-only/) as a preview and joins the P2/P3 review. Human checklist:

- [ ] Check animation, coverage and density controls.
- [ ] Set zero coverage and confirm transparent gaps preserve the host background; check opaque depth occlusion.
- [ ] At high coverage, check that the foreground sphere remains visible. Later, compare overlap with volumetrics for doubled or dark bands.

Questions: Is the thin-cloud appearance convincing at the horizon? Is animation comfortable? When combined later, does the layer add coverage without visible duplication? Technical acceptance covers independence/build and zero-coverage behavior. It is a preview, not final distant-cloud acceptance.

## Current human review record — 2026-09-17

| Observation / question | Human feedback | Technical follow-up / status |
| --- | --- | --- |
| Do the views work? | Views seem to be working | Recorded; not a blanket visual sign-off |
| Are stylized forms acceptable at this stage? | Acceptable as provisional | Keep the correctness baseline; finer detail comes later |
| Floor shadow appears to z-fight | Reported defect; not intentional | P1 depth-based receiver dropout reproduced and fixed; 14 GPU checks pass. Human retest and exact reported scene remain open |
| Which silhouettes should lead P2? | No preference selected yet | Keep the three alternatives available; this does not block coverage work |
