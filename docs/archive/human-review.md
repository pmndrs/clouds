# Human review guide

**Review policy updated 2026-10-08:** the user requests no minor check-ins until
the output is a convincing realistic cloud. P2.7 shape-direction approval is
withdrawn as a prerequisite. Root should judge intermediate images, correct
obvious flaws, and carry quality failures forward without asking the user to
approve prototypes. Existing checklists remain useful internal QA references.
The next human review targets a complete lit cloud result comparable to the
provided references. A real authored VDB file/path may be requested as missing
input; it is not an appearance approval gate.


This is the short review checklist for each stage. Human review records appearance, usability and product judgment; the orchestrator records technical acceptance separately. A stage marked **future** is not runnable yet and must not be treated as visually accepted.

Start with the stage you are reviewing; future checklists are previews, not requests to test unfinished work. A short note with the scene and what you saw is enough. The fuller record below helps reproduce a bug. At each checkpoint, update the [status summary](project-status.md), record new feedback here, and link the technical evidence.

## Current decision — P2.7 cloud shape

The [density comparison](http://127.0.0.1:5173/density-study/) is ready for a
shape-direction review. Use the [five-minute guide](p2-density-review.md).
This is a candidate, still soft/simplified; realism is not accepted. Decide
whether the broad form is worth developing before it replaces the world atlas.
Lighting bands remain a separate P3 defect.

The source LOD sweep exceeded provisional error gates. **Full-detail density is
now the default in Cloudscape**; coarse remains explicitly experimental. The
older single-formation LOD pass does not certify these sources.

## Current P2.6 review — persistent region

Open [Cloudscape](http://127.0.0.1:5173/cloudscape/) in **Persistent region · full detail**.
This pass judges coverage and transitions. Expect the existing stylized eight
forms, coarse/blocky shadows and unresolved lighting bands. Realistic density
is P2.7; stable lighting is P3. Known defects remain release failures.

- [ ] Start at **Ground**, then play the flight and scrub backward. Clouds should
  already occupy the distance and retain their positions as you approach.
  **Fail:** an in-view formation suddenly appears/disappears at the old distance
  boundary. **Open limitation:** the fixed region ends about 73 km across.
- [ ] Pause at **Horizon** and toggle **Full detail (coarse is experimental)**. Nearby forms may
  become slightly softer with refinement off; they should remain present.
  **Fail:** duplicated opacity, large silhouette jumps or a disappearing cloud.
  The automatic refinement policy remains unaccepted; the default now holds fine detail at every distance.
- [ ] Lower **Coverage** toward 0.5 and 0.25. Clear areas should open regionally;
  surviving formations should keep their positions. At zero, volumetric clouds
  and their shadows must vanish. Disable **High thin-cloud layer** for an entirely
  clear cloud test; that layer is independent. **Density = 0** should also clear
  the volume without changing its source layout.
- [ ] Compare with **Reference shadows** off, then on. Report density/transition
  problems separately from shading bands. A formation visible in the view should
  not vanish while its shadow persists. Offscreen clouds can legitimately cast
  visible shadows. Blocky shadows/banding remain acknowledged P3 defects.
- [ ] **Check persistent coverage** should pass 18 checks; **Run P2 checks** should
  pass 19. Export evidence with camera/settings when reporting a failure.

Questions for review: Does the longer approach remove the previous “clouds in a
pool” feeling? Are transitions noticeable at a normal viewing size? Does coverage
now make coherent clear areas? Is any new motion hitch severe enough to prevent
review? No frame-rate target or realistic appearance is accepted at this step.

[Technical evidence and constraints](p2-lod-evidence.md#persistent-world-integration--2026-09-20).

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

**Availability:** Runnable now at [`/cloudscape/`](http://127.0.0.1:5173/cloudscape/). R2 feedback is received and the current P2 stage is accepted provisionally for progression while coverage debt remains; local technical checks and measurements are recorded in [P2 evidence](p2-evidence.md). [`/clouds/`](http://127.0.0.1:5173/clouds/) is the P1 viewer and cannot substitute for this gate.

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

**Availability:** Runnable first slice at [`/lighting/`](http://127.0.0.1:5173/lighting/). P3.1 and P3.2 bounded prototypes are integrated and P3.3 is partial; P3 is not complete and R3 review is pending.

Review steps:

- [ ] **Pass/fail — directional shadows:** change sun, toggle cloud/geometric shadows, and move the occluder through the cloud. Pass if scene-depth shadows enter the volume and cloud shadows reach scene receivers without errors or stale geometry; record coarse-cache softness separately from an integration failure.
- [ ] **Pass/fail — cache invalidation:** move geometry, then change sun and density. Pass if geometry movement does not rebuild the cloud cache unnecessarily, while sun/density changes refresh the relevant lighting state.
- [ ] **Pass/fail — composition modes:** compare sky-only, cloud-on-black and composite views with overview, lighting objects and cloud occluder. Pass if the modes remain legible and the main background stays sky-only.
- [ ] **Pass/fail — environment refresh:** click the explicit environment refresh after changing sun/density. Pass if the fixed six-face cloud+sky environment updates; leave it unchanged before the click and record that intentional staleness separately.
- [ ] **Pass/fail — reflections:** choose **Lighting objects** and inspect both spheres after **Refresh environment**. Pass if sky/cloud contribution appears without black or stale capture faces. Local terrain and objects are intentionally absent; exact near-cloud parallax is not expected. Ownership restoration is covered by automated checks.

Expected quality: the lighting should be coherent and usable for this partial
slice, with directional cast/receive behavior and explicit refresh visible. Coarse
cloud-shadow cache filtering, stylized voxel/banding and inherited distance/LOD
artifacts are known quality limits; judge them separately from integration bugs.
Full aerial-perspective LUT integration and calibrated sky/cloud lighting remain open.
The current pmndrs/sky aerial perspective is off and exponential cloud haze is an approximation.
Environment captures sky/clouds only; local terrain and objects are excluded from
reflections, and the fixed probe has limited parallax. Arbitrary
transparency/refraction remains limited. This review does not accept P3 by itself.

## P4 — Reconstruction and performance presets (R4)

**Feedback received 2026-09-18:** symmetric V-shaped internal bands and distant
crosshatching are visible in the user's screenshots; strobing during camera
motion is reported. Recorded as Major, requiring spatial-baseline diagnosis and
correction before P4 quality acceptance. The exact cause and affected methods
have not yet been isolated. Local screenshots are archived under
`artifacts/p4/2026-09-18/review/` as `user-v-banding.png` and
`user-crosshatching.png`. See the active failure in the [P4 guide](p4-review.md).

**Follow-up 2026-09-18:** the default-on fine-density detail filter reduced or
removed native foreground crosshatching in spot observations at 502×608 and
1265×880. This does not establish acceptance of the reported orbit or motion.
Retest the reported angles and motion; the Major gate remains open. The viewer
now exposes **Fine density detail** and **Filter unresolved detail** (off
reproduces the older pixel-only filtering), shared by native and reconstructed
sides. The filter uses ray-step and pixel-footprint information, preserves the nominal modulation mean
(density multiplier 1 − detail/2), adds no jitter/blue noise, and leaves the default 320
samples, ray lattice, LOD, and lighting cache unchanged. The comparison
divider is default-on and can be toggled off.

The seven new P4 GPU regressions pass: coarse-pixel mean error 0.0000287562 (tolerance 0.001), mean T error 0.0000287562 (tolerance
0.001), translation difference 0 (0.001), skip/full parity 0 (1e-5), L+T error
0.00048828125 (0.001), resolved-detail versus dense CPU quadrature 0.0003232871
(0.002), and resolved detail remains present. All 29 P4 checks pass in IAB and
the 19 P2 checks still pass. `pnpm check` passes with 53 tests, type checking,
and build; the rerun also reports 23 P3 GPU checks passing. FSR3 flight reached
40 seconds with no reported errors, which confirms functional progression only,
not full temporal-quality sign-off. These technical results do not close the
visual retest, coarse voxel/shadow/LOD/wind issues, performance gate, or
RTX/Windows proof.

**Availability:** Comparison preview at [`/reconstruction/`](http://127.0.0.1:5173/reconstruction/). Use the comprehensive [P4 critical review guide](p4-review.md) for exact controls, expected appearance, pass/fail cases, known issues and a report template. [P4 evidence](p4-evidence.md) separates automated results from visual acceptance.

The user reports that the five reconstruction methods seem stable beyond the
volume artifacts and authorizes continued work within P4. This is permission
to continue review and correction, not P4 visual or preset acceptance.

Start with **Native reference**, then compare **Reduced + bilinear**, **Cloud-only spatial**, **Final FSR1** and **Final FSR3 temporal** using the wipe and fixed flight. Test foreground bars, moving geometry, cloud entry, camera cuts, sun/density/source edits and scale changes. Report new trails, holes, lost edges, brightness changes and stale history against native at the same pose. Cloud-only keeps the opaque scene at full resolution.

P4 does not upgrade the source art: stylized repeated forms remain provisional; distance/LOD, mismatched distant shadows, angular voxels, spatial bands and approximate atmosphere remain unresolved. Missing wind/advection and Windows/RTX results are unverified. No quality/performance preset is accepted yet. A technical pass is not visual sign-off.

## Independent coverage study — optional, after lighting review

The [weather source map](http://127.0.0.1:5173/coverage-study/) is a P2.4 source
experiment, not a cloud renderer. It can be reviewed without judging lighting.

- **Expected:** coverage expands/shrinks coherent world-space regions rather
  than toggling unrelated whole cloud instances. Density changes the intensity
  of the **Density response** map without relocating those regions.
- **Pass:** coverage 0/1 produces empty/full mask maps; density 0 clears the
  density response; approaching at 20/12/8/4/1 km and entry moves the yellow
  residency overlay but preserves the selected world's weather values and the
  source-map generation counter.
- **Fail:** camera movement regenerates/repositions the source, abrupt changes
  at clear/full endpoints, or density changes alter the coverage layout.
- **Known limits:** 2D CPU regional noise, no physical weather evolution, no
  3D formation identity or coarse/fine voxel rendering yet. Coverage is a shape
  parameter, not a promised sky-area percentage. The old viewer's pop-in and
  shadow mismatch remain open.

Optional later feedback: whether these regional patterns and coverage changes
are a useful starting point for broad cloud organization. No additional review
is required while the user focuses on lighting.

## P2.5 bounded LOD study — checkpoint review

Route: [`/lod-study/`](http://127.0.0.1:5173/lod-study/). Review after its
technical checkpoint is recorded in the work queue; the implementation alone
does not establish acceptance.

**Expected appearance:** one simple, unshadowed formation in two explicitly
labeled panes, canonical and candidate. A flat white appearance is intentional
to isolate density/LOD from the existing lighting defect. This is not the P2.7
realistic-density review, and the old cloudscape is not connected to this bench.

The default coarse field is now **32×64×32**, selected by the distance audit.
Use **Measure distance quality** for the automated 15-pose sweep; its proposed
numeric gates are engineering checks, not a request for visual sign-off. The
320² and 640² reports are saved in [LOD evidence](p2-lod-evidence.md). The older
cubic choices remain available to demonstrate their larger optical errors.

1. Approach through 20, 12, 8, 4 and 1 km; orbit at fixed distance. The formation
   should persist in both panes. Small coarse-level silhouette/opacity differences
   are measured, not automatically accepted as production quality.
2. Delay fine detail, then approach. The candidate should remain visible using
   coarse data. When fine becomes ready, detail should transition without a
   one-frame switch or an extra cloud overlaid on the first.
3. Evict fine data during a pending request. Coarse must persist and a cancelled
   completion must not restore fine. Forced eviction may show a coarse shape
   change; smooth eviction remains a separate policy decision.
4. Compare the finest endpoint with the canonical pane at the same pose. A
   persistent difference in that endpoint needs investigation; differences at
   intermediate weights must be reported alongside optical error measurements.

**Fail:** disappearance while pending, stale data replacing current data,
doubled density during transition, mismatched source identity or camera poses,
or a blank/error pane. **Not proven here:** world/horizon coverage, efficient
GPU streaming, cache-lighting transitions, production shadow agreement, or
realistic cloud morphology. CPU blended uploads are explicitly diagnostic.

## Focused banding review — isolate shadowing

Current sequencing is recorded in [next milestones](next-milestones.md): P2
LOD/density is active; this lighting bench remains available for diagnosis and
P3 acceptance. No need to review every existing phase viewer simultaneously.

### User results received — 2026-09-18

- **A, cached shadows:** prominent banding and an additional artifact around the
  central cloud/tower overlap.
- **B, shadows disabled:** user reports no visible banding; cloud shading/detail
  is absent as expected when sun attenuation is bypassed.
- **C, direct lighting:** user reports significantly worse banding than A.

The three supplied captures are saved under `artifacts/p4/2026-09-18/review/`
as `shadow-isolation-cached.png`, `shadow-isolation-unshadowed.png`, and
`shadow-isolation-direct.png`. These are human observations, not automated
convergence measurements. They localize the visible bands to the shadow-enabled
rendering path and rule out the lighting cache as the sole cause. The shared
secondary light march is the leading suspect; cache interpolation may soften
its error. Geometry attenuation and view/light sampling interaction still need
controlled separation. The tower-overlap artifact is visible in the unshadowed
capture too and must be tracked separately until isolated.

**Disposition:** rendering quality remains failed. A controlled
[lighting bench](lighting-isolation.md) is now available with fixed view
sampling and geometry attenuation disabled. Its first GPU sweep passed the
isolation checks, with identical transmittance and a material reduction in
direct-light error at 256 samples. Cached lighting still has substantial error;
the measured improvement is not visual acceptance. No broad phase retest is
requested yet.

### Reproduction procedure

Use [Cloudscape](http://127.0.0.1:5173/cloudscape/) at a pose where the bands are
obvious. Pause the flight, keep sun/density/sample settings fixed, then repeat
the same small orbit and zoom for each row. Record **gone / reduced / unchanged**
and whether the bands move or strobe. Judge structured bands separately from
expected overall brightness changes.

| Test | Reference shadows | Cached cloud lighting | What a change suggests |
| --- | --- | --- | --- |
| A: baseline | On | On | Reproduce the reported pattern |
| B: unshadowed | Off | On | Disappearance implicates sunlight attenuation (self/scene shadows or cache); remaining bands implicate another contributor |
| C: direct lighting | On | Off | Improvement over A implicates cache resolution/filtering; remaining bands can still come from the direct light march |

The **Reference shadows** label is broad: it disables cloud self-shadowing too,
not merely shadows on the floor. Direct lighting is deliberately slower.
If bands persist in B, turn **Projected fine detail** off while shadows stay off;
report whether that removes the pattern. This is a density-detail isolation test.

Finally, in [Reconstruction](http://127.0.0.1:5173/reconstruction/), choose
**Native reference**, hide the comparison wipe, and compare **Current** with
**Quality experiment** under Volume integration at the same pose. That combined
budget change tests improvement, but cannot by itself separate view from light
sampling. Pass means no obvious coherent arcs/crosshatch or strobing during the
small orbit/zoom. Blur, brightness changes or slower motion alone are not a pass.

The authored viewer uses a different bounded-volume marcher, 256 view samples
and 64 direct light samples. It still self-shadows; it has no cloudscape lighting
cache and its samples span one object rather than the large resident world.
Its clean appearance is useful evidence, not proof that voxel sources are the
cause or that shadowing has been ruled out.

## P5 — Reusable library and R3F v10 (R5)

**2026-09-19 independent engineering checks:** the plain Three.js example now
has **Run shared-renderer lifecycle checks**. It runs three cycles with two
cloud views on one renderer, changes/resizes/removes the second view, and checks
the surviving view's exact optical output plus host target/face restoration.
All 28 local GPU checks passed. The React example additionally exposes
**Dispose layer handle** to exercise explicit disposal while its component
remains mounted; toggle **Distant layer** off/on to recreate it.
These checks do not require another full visual review from the user while
lighting is under investigation.

**Availability:** Local preview at [plain Three.js](http://127.0.0.1:5173/three/), [React WebGPU](http://127.0.0.1:5173/react/), and the [packed consumer](http://127.0.0.1:5173/@fs/Users/dex/Developer/WebGPUClouds/artifacts/packed-consumer/index.html). Build/install instructions and remaining gates are in [release preview](release-preview.md). These demonstrate integration and ownership; they do not raise the volume-art quality bar.

### Expected appearance and pass/fail

- [ ] Plain Three.js: switch between cloudscape, single object and distant layer. Each mode should render immediately after setup, with the same provisional shapes as the diagnostic viewers. Black output, missing background or stale content from the previous mode fails.
- [ ] Mount/unmount repeatedly. The host scene should remain visible when clouds are removed; remount should restore them without accumulating duplicate clouds or errors.
- [ ] Replace the camera, resize the window and orbit. Output should follow the new camera and dimensions without stretching, freezing or retaining old history.
- [ ] Capture the environment in the Three.js world mode. Reflections should update after completion while the background stays intact. Staleness before an explicit capture is expected.
- [ ] React: toggle cloudscape and layer independently. The layer should work with the volume unmounted; disabling both should preserve the host scene.
- [ ] React: run **Run vanilla parity check**. Expect PASS with finite visible clouds and maximum optical L/T error at or below 1e-5; blank output must fail.
- [ ] Packed consumer: expect all listed GPU lifecycle checks to pass. This tests installed archives rather than workspace aliases.

**Fail now:** renderer ownership conflicts, React-only rendering defects, crashes, failed resize/disposal, accidental FSR/React imports into plain Three.js, or a layer that requires the volume package internals. Known source banding and distant-cloud gaps remain quality failures tracked separately, not new React regressions. Static optical parity and sequential two-view isolation pass locally; concurrent asynchronous scheduling, long-duration stress and broader device coverage remain unverified.

**Questions:** Are the public imports and lifecycle calls comfortable to use? Should environment capture remain explicit? Are the independent layer and volume controls clear? API names remain provisional until this review.

## P6 — Validation, assets and release (R6)

**Availability:** Local package archives and a bounded dense-asset pipeline are runnable at [authored density](http://127.0.0.1:5173/authored/). See [asset contract](../assets.md) and [release preview](release-preview.md); nothing is published.

### Expected appearance and pass/fail

- [ ] Load the authored fixture at [/authored/](http://127.0.0.1:5173/authored/). Use both fixture options: the cube should match the converted mesh with softened interior density; the Blender density bake should show soft lobes. These are pipeline fixtures, not realistic weather structure.
- [ ] Inspect bounds, dimensions, voxel spacing, transform, extinction scale and authoring provenance. Wrong scale, orientation, clipping or unexplained density changes fail.
- [ ] Exercise malformed input and cancellation. Expect a clear error/cancelled status, no partial replacement of the active cloud and no unbounded allocation.
- [ ] Reproduce the packed consumer build from the documented commands and inspect its checks, archive inventory and attribution.
- [ ] Record the same acceptance matrix on M5 Pro and RTX 3060. Missing Windows hardware evidence stays open; a local pass does not imply compatibility.

**Known limits:** dense static r8 rendering; r16/r32 container bytes alone do not establish float rendering. No sparse/VDB reader, animated playback or VDB export is advertised. These remain conditional experiments. Local archives are a development preview, not a release candidate while visual quality and device gates remain open.

**Questions:** Is mesh-to-density shaping useful in its current bounded form? Which real DCC volume should anchor the next import experiment? Is the preview contract clear enough to use without assuming production cloud quality?

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
| Is repetition acceptable now? | Fine provisionally | P2 progression accepted provisionally; revisit after coverage work; no full visual sign-off |
| Horizon and transition | Distant clouds appear too late with harsh pop-in; shadows appear before clouds; the world feels like a pool | P2 coverage/transition/shadow-order quality debt; current 4.4–7.7 km view fade has no far LOD or mass handoff |
| Coverage and density controls | Coverage just hides whole clouds; density cannot reach zero or a wispy value | Density now reaches zero with finer increments; Cloud population label clarifies the current behavior. Coherent weather coverage remains P2 work. |
| Lookup and lighting | Lookup causes no appearance change; sun/shadows move but shadows are boxy | Lookup result recorded; shadow filtering is tracked P3 quality debt |
| Image quality | Bands and angular voxel visibility observed; screenshots supplied | Track spatial-reference improvement before P4; do not promise an FSR fix |
| Animation/browser | Animation works in IAB but not Chrome | Full-precision playback clock added; 60/120/144/240 Hz tests pass, and Chrome camera progression was verified. |
| Camera turn/down and shadows | Shadows remain visible beyond clouds that have faded from view; the tower is not centered on the camera, and shadows include view-hidden clouds | Carry distance/LOD representation and view/shadow agreement into ongoing P2/P3 work; no claim of a fix yet |

**R2 disposition:** feedback received and returned for coverage work. The user
accepts the current P2 stage as fine for continuing provisionally. This keeps
the distance/LOD, coverage/weather and view/shadow quality debt open and is not
an all-visuals-passed result. P3.1 and P3.2 are running; P3.3 remains for
orchestrator integration. No runnable P3 scene or P3 human acceptance exists
yet. The 2026-09-18 follow-up authorizes progression through P6 while rendering quality is investigated independently; publication is separate.

### R2 follow-up priorities

1. Persistent distant volumetric formations driven by the same world/weather identity as nearby clouds; select a coarse representation and transition without duplicated extinction. Increasing the fade radius alone is not the acceptance criterion.
2. Make view density and cloud-shadow representation agree through the transition; shadows should not announce clouds that abruptly appear later.
3. Add a spatial weather/coverage driver that produces coherent patches and changing cloud extent. Retain the population control as a diagnostic if useful.
4. Compare ray-step count, density resolution and light-cache resolution separately at the photographed angles. Identify the sources of bands and angular silhouettes before adding reconstruction.
5. Recheck approach sequences starting beyond the current fade range, including a fixed cloud at several distances; region-rebase parity alone is insufficient. Include camera turns/downward views where view-faded clouds can still contribute shadows.

P2.4–P2.6 remain future coverage/weather packets and are tracked for later
resolution; they do not block compatible P3 lighting work.

Known artifacts need not be reported repeatedly. Report new behavior, a particularly bad view, or a regression after a fix. Native render scale and 512 samples are useful comparisons when diagnosing an artifact, not conditions for dismissing a default-view defect.
