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

**Availability:** Runnable now at [`/clouds/`](http://127.0.0.1:5173/clouds/). Technical baseline accepted locally; R1 user review remains pending.

Human checklist:

- [ ] View Cumulus, Tower and Wisps from ground, side and inside cameras, then use the fly-through.
- [ ] Repeat with the synthetic authored form; change density, physical size, sun and full-march/occupancy controls.
- [ ] Use the Show opaque object checkbox, cloud→ground and object→cloud switches, sun and camera controls to inspect depth and both shadow directions.
- [ ] Move slowly through the cloud boundary; expect continuous fog with no rectangular cut. Orbit at a low angle and change render scale; the floor shadow should stay continuous, without flashing holes.

Questions: Which silhouette, scale and softness direction should lead? Does the inside view feel useful and readable? Are the controls understandable without explanation? Technical acceptance: Beer–Lambert, empty density, scale, depth, inside views, occupancy equivalence, disposal and reference shadows. Stylized shapes are acceptable provisionally. The reproduced distant-ground dropout is fixed locally: the regression error fell from 0.75 to zero (tolerance 0.002). Please retest the view where you saw flicker; your visual confirmation is still pending. This result does not imply a fix for an unconfirmed P0 sphere-scene issue. Final art, cloudscape coverage, production shadows, reconstruction, VDB import and Windows validation are outside this stage.

## P2 — Cloudscape coverage and distance

**Availability:** Runnable now at [`/cloudscape/`](http://127.0.0.1:5173/cloudscape/). R2 feedback is received and P2 is returned for coverage revision; local technical checks and measurements are recorded in [P2 evidence](p2-evidence.md). [`/clouds/`](http://127.0.0.1:5173/clouds/) is the P1 viewer and cannot substitute for this gate.

Current slice: an eight-form 96³ r8 atlas drives 81 resident world-cell
descriptors. Near and medium formations stay volumetric; a separate thin
high/far layer supplies inexpensive distant coverage. The lighting cache and
GPU candidate lookup are provisional P2 work, and production shadow/environment
cache behavior remains P3.

Review path:

- [ ] Use **Save flight sheet** for five matching still views. Run the fixed 40-second ground-to-horizon-to-inside flight, then inspect the same scene with a free camera.
- [ ] Change coverage, sun and density, and toggle the thin high/far layer; inspect ground, horizon and inside views after each change.
- [ ] Check horizon richness and repeated forms. Decide whether repetition is acceptable for this stage.
- [ ] Move across camera-cell boundaries and watch for image instability, popping or changed retained silhouettes.
- [ ] Inspect cloud shadows and the reference lookup toggle; with lookup on and off, appearance should remain equivalent within the expected performance-only difference.
- [ ] Check overlap and the near/far transition for holes, popping or duplicate extinction.

Questions: Is the horizon rich enough? Are repeated forms acceptable? Are
cell-crossing transitions visible or distracting? Technical acceptance measures
coverage, transitions, memory, generation/upload and acceleration against a
reference. The local 47-unit / 19-GPU check suite passes, including conservative lookup and density rebase comparisons. Review the finite 7.7 km volumetric support, stylized/repeated forms, and provisional coarse shadows; P2 visual acceptance remains open.

R2 review interpretation: the user reports that the GPU checks all pass. The
fixed flight is substantial, and scale, spacing and entry feel good. Repetition
is acceptable provisionally. The review is **received and returned for coverage
work**; it is not P2 acceptance. Distant clouds arrive too late with a harsh
pop-in, shadows are visible before their clouds, and the world can feel like a
pool. Coverage currently tends to hide whole clouds; the density control does
not reach true zero or a wispy setting. Lookup on/off produces no visible
appearance change. Sun and shadows move, but the shadows look boxy. The supplied screenshots are preserved locally as `artifacts/p2/2026-09-17/review/user-banding-and-shadow.png` and `user-angular-voxel-silhouette.png` (artifacts are excluded from Git).

Follow-up: the flight clock now retains sub-frame precision separately from the range input, which rounded away increments at high refresh rates. Regression tests cover 60/120/144/240 Hz, and Chrome playback was observed progressing beyond 30 seconds with camera movement and no application errors. Density now reaches zero in 0.005 increments; zero-density rendering was verified in Chrome. The population control also reaches zero and is labeled **Cloud population**, because it does not yet implement weather coverage. These viewer fixes do not complete the coverage work. Current limits explain some of the
observations: volumetric view fade is approximately 4.4–7.7 km, cached shadow
density is not faded with the view, and there is no far LOD or mass handoff.

Questions answered by this review: stylized forms and
repetition are acceptable provisionally; scale, spacing and cloud entry are
acceptable for this slice. Keep those answers in the record and do not ask for
them again. Remaining P2 questions are horizon coverage, near/far transition,
shadow ordering/shape, and weather coverage semantics. Retest Chrome playback if the updated page still stalls; the original browser symptom was reported by the user and the repaired clock was verified locally.

### Phase quality expectations

| Phase | Quality bar for human review |
| --- | --- |
| P0 | Diagnostic controls and GPU result are legible; resize and lifecycle remain stable. |
| P1 | A single cloud has readable scale, depth and shadow continuity; stylized form is acceptable provisionally. |
| P2 | Cloudscape has useful horizon coverage, continuous near/far transitions, sensible controls, and shadows do not lead clouds. Track sampling bands/angular voxel visibility against a higher-quality spatial reference. Repeated forms may remain provisional. |
| P3 | Sky, sun, shadows and environment agree with visible clouds; softness and cache refresh are credible. Boxy shadow filtering is tracked P3 quality debt. |
| P4 | Reconstruction and presets hold detail through motion, cuts, disocclusion and foreground edges; view banding and angular voxel steps need spatial-reference improvement before this gate. |

Do not promise an FSR fix for the banding or voxel-step observations. They are
tracked quality debt pending spatial-reference work.

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

## Latest R2 review record — 2026-09-17

| Observation / question | Human feedback | Technical follow-up / status |
| --- | --- | --- |
| Do the GPU checks pass? | All pass | Recorded as human feedback; technical evidence remains in [P2 evidence](p2-evidence.md) |
| How does the fixed flight feel? | Substantial; scale, spacing and cloud entry are good | Keep the path for repeatable review |
| Is repetition acceptable now? | Fine provisionally | No P2 sign-off; revisit after coverage work |
| Horizon and transition | Distant clouds appear too late with harsh pop-in; shadows appear before clouds; the world feels like a pool | P2 coverage/transition/shadow-order defect; current 4.4–7.7 km view fade has no far LOD or mass handoff |
| Coverage and density controls | Coverage just hides whole clouds; density cannot reach zero or a wispy value | Density now reaches zero with finer increments; Cloud population label clarifies the current behavior. Coherent weather coverage remains P2 work. |
| Lookup and lighting | Lookup causes no appearance change; sun/shadows move but shadows are boxy | Lookup result recorded; shadow filtering is tracked P3 quality debt |
| Image quality | Bands and angular voxel visibility observed; screenshots supplied | Track spatial-reference improvement before P4; do not promise an FSR fix |
| Animation/browser | Animation works in IAB but not Chrome | Full-precision playback clock added; 60/120/144/240 Hz tests pass, and Chrome camera progression was verified. |

**R2 disposition:** feedback received; returned for coverage work. No P2
acceptance. P3 and P4 have not started.

### R2 follow-up priorities

1. Persistent distant volumetric formations driven by the same world/weather identity as nearby clouds; select a coarse representation and transition without duplicated extinction. Increasing the fade radius alone is not the acceptance criterion.
2. Make view density and cloud-shadow representation agree through the transition; shadows should not announce clouds that abruptly appear later.
3. Add a spatial weather/coverage driver that produces coherent patches and changing cloud extent. Retain the population control as a diagnostic if useful.
4. Compare ray-step count, density resolution and light-cache resolution separately at the photographed angles. Identify the sources of bands and angular silhouettes before adding reconstruction.
5. Recheck approach sequences starting beyond the current fade range, including a fixed cloud at several distances; region-rebase parity alone is insufficient.

Known artifacts need not be reported repeatedly. Report new behavior, a particularly bad view, or a regression after a fix. Native render scale and 512 samples are useful comparisons when diagnosing an artifact, not conditions for dismissing a default-view defect.
