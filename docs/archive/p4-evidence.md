# P4 evidence — reconstruction review preview

> **Evidence correction:** the earlier small production orbit audit disabled cloud
> self-shadowing. Its 4×/192 versus 4×/256 equality does not validate lighting
> convergence or a banding fix. The audit setting is corrected; a lit rerun and
> full-size cached/direct-light comparison remain pending. See the
> [corrected research note](../research/cloud-quality-bench.md#production-atlasworld-audit--lighting-evidence-withdrawn).


Updated 2026-09-18. Viewer: [`/reconstruction/`](http://127.0.0.1:5173/reconstruction/).
Status: **technical preview; prominent banding remains an active failure**.
The user rejected the detail-filter retest and authorized independent quality
research alongside P5/P6 implementation. Reconstruction controls are reported
stable, but image quality and presets are not accepted.

## Latest quality continuation

The [independent bench](../research/cloud-quality-bench.md) provides analytic and
voxel sources, an expensive reference and motion-error measurement. Its lower-cost
192-view-evaluation candidate reduced isolated voxel spatial error about 6.3×
and motion residual about 5.6×. Those are bench results, not proof that the user's
full scene is fixed. Production 4× view / 192 or 256 light budgets are opt-in.
Strict four-substep skip/full parity exposed a defect during integration; a
conservative density path replaces candidate-mask density pruning pending a
provably conservative optimized mask. Rebenchmark default throughput after this
change; historical timing tables below do not describe its cost.

## Earlier 2026-09-18 detail-filter packet — user retest failed

The cloudscape now enables **detail filtering** by default. It suppresses
unresolved periodic fine-density modulation using both ray-step and pixel
footprint information while preserving the nominal modulation mean (density multiplier 1 − detail/2). It does
not add jitter or blue noise, increase the default 320 samples, or change the
ray lattice, LOD, or lighting cache. The P4 viewer exposes **Fine density
detail** and **Filter unresolved detail**; turning the filter off reproduces
the older pixel-only filtering. Native and reconstructed sides share the
setting. **Show comparison divider** is default-on and toggleable.

This preserves the periodic term's nominal mean, not exact integrated mass of
an arbitrary finite voxel lobe. The old pixel fade removed the whole term at
large footprints; the corrected path retains a 0.92 multiplier at default
strength. Distant/coarse-pixel extinction can therefore be about 8% lower than
that old limit, deliberately avoiding a resolution-dependent density increase.
The coarse-pixel GPU check covers this mean retention. The underlying source
sampling, direction-dependent ray lattice, and view/light density mismatch
remain limitations; this is not exact density preintegration or a complete
sampling solution.

Native foreground crosshatching was reduced or removed in spot observations at
502×608 and 1265×880. This was the basis of the retest that the user subsequently rejected. The Major image-quality gate remains open
until the reported angles and camera motion are retested. Coarse voxels,
shadows, LOD, wind, and performance remain open.

Seven new P4 GPU regressions pass: coarse-pixel mean error 0.0000287562 (tolerance 0.001), mean T error 0.0000287562 (tolerance 0.001),
translation difference 0 (0.001), skip/full parity 0 (1e-5), L+T error
0.00048828125 (0.001), resolved detail versus dense CPU quadrature 0.0003232871
(0.002), and resolved detail remains present. All 29 P4, 19 P2, and 23 P3
GPU checks pass in the in-app browser. FSR3 flight reached 40 seconds with no
errors; this establishes functional progression only, not temporal-quality
sign-off. `pnpm check` passes with 53 tests, type checking, and build.

## Delivered

- Native, reduced bilinear, final-scene FSR1 and FSR3, plus cloud-only spatial
  reconstruction over full-resolution opaque geometry.
- The author's actual `@pmndrs/upscaler` 0.2.0 at source commit
  `4a79229c82b84246582fb8ca3b8d31aa8f391e88`. Local MIT snapshot is pinned in
  `vendor/`; the external upscaler checkout was not edited.
- Cloud contribution-weighted depth, jitter-free camera motion, moving opaque
  object motion and mixed-pixel reactivity. One final-scene history owner.
- Independent paired radiance/transmittance filtering, depth-guided foreground
  rejection and one `L + T × background` composition.
- Matching native wipe, 40-second flight, overview/foreground/inside poses,
  moving geometry, cuts, density/sun/source changes, reset and resize controls.
- Critical [human review guide](p4-review.md) and [ownership/input contract](../decisions/reconstruction.md).

## Automated evidence — historical 2026-09-17 baseline

Local Apple M5 Pro / Metal 3, Chromium 152 in the Codex in-app browser:
**22 P4 GPU checks passed**, with no reported application/GPU validation errors
in the corrected run. These read actual GPU results rather than CPU copies of
shader math.

| Contract | Evidence |
| --- | --- |
| Homogeneous Beer transmittance | absolute error 0.000285; tolerance 0.002 |
| Contribution-weighted cloud device depth | error 0.000000259; tolerance 0.000002 |
| Static cloud / empty sky motion | near-zero motion; empty far depth and zero reactivity |
| Camera translation | NDC current-minus-previous error 0.0000113; tolerance 0.00005 |
| Moving opaque geometry | object motion error 0.00000448; tolerance 0.00005 |
| Opaque scene device depth | error 0.000000055; tolerance 0.000001 |
| Guide/scene resize | independent dimensions, finite output |
| Optical HDR conservation | max error 0.001563; tolerance 0.02; values above 1 preserved |
| Empty optical identity | exact scene preservation in fixture |
| Foreground depth rejection / clear fallback | exact fixture output |
| Recreated input resource | same Three wrapper correctly rebinds new native texture |
| FSR1 constant HDR | exact fixture output |
| FSR3 constant HDR | max error 0.001953; tolerance 0.03 |
| FSR3 reset | matches fresh-history output exactly; new HDR input error 0.005859 |
| Camera jitter and FSR resize | projection jitter removed; finite resized output |

`pnpm check`: **53 unit tests passed**, type checking passed and all six lab pages
built. Vite's existing large-chunk advisory remains; it is not a failed build.

## Visual inspection and limits

Inspected the native/FSR3 wipe at the foreground bars, moving-camera flight,
inside-cloud cut, and native/cloud-only foreground composition at 1265×780
output and approximately 67% input. All rendered successfully; the inside view
shows continuous pale fog, and the known stylized shapes and coarse shadow
patterns remain visible. This spot inspection does **not** establish temporal
quality over all motion cases. Human motion review is still required.

The native reference is spatially unfinished: voxel silhouettes, bands,
repetition, coarse cloud shadows and missing persistent far coverage remain.
These are not fixed by reconstruction. Thin geometry, newly revealed regions,
mixed transparent layers and moving-object lighting need critical review.
Cloud-only rejected taps deliberately fall back to clear optical identity;
that prevents leakage but can lose cloud contribution at undersampled edges.

No full-cloud wind/advection exists yet. The single representative depth and
opacity-0.5 dominant-layer selection approximate a layered transparent scene.
Windows/RTX 3060 evidence, sustained visual approval, fair production-mode
performance comparisons and accepted presets remain missing.

## Measurement status

The lab compares three moving clips starting at flight 0, 12 and 20 seconds,
32 warm-up frames plus 32 measured frames each, at the selected output size.
Native comparison rendering and environment refresh are excluded. CPU submission
and complete queue-span GPU timestamps have separate labels. Timestamp markers
are tiny real dispatches; their overhead and intervening GPU queue-idle gaps are
included. This is not display latency or an isolated shader execution sum.

**Baseline caveat:** all five methods currently use the guide-enabled diagnostic
integrator. Native and spatial modes therefore also pay velocity MRT and guide
write costs that a production non-temporal mode need not pay. These measurements
cannot establish fair net savings or select a production preset. A later fair
comparison must omit unused guides from the non-temporal paths.

An initial cross-submission query attempt returned zero durations and was
rejected. Zero timings are invalid evidence and must not be reported as speedups.

### 1080p diagnostic run (67% input)

These tables are historical pre-filter diagnostic runs. The detail-filter
change has no new performance claim; do not use these results to accept a
preset or infer RTX/Windows behavior.

Corrected timestamps produced the following GPU queue spans, in milliseconds.
Each cell is **p50 / p95**, from 32 measured frames after 32 warm-up frames.
Seed 17, density 0.7, sun elevation 40°, 320 samples, sharpness 0.2, auto exposure
and moving geometry off. Output 1920×1080; reduced cloud input 1280×720.
Cloud-only keeps the scene at 1920×1080. Native uses 1920×1080 throughout.

| Method | Ground clip (0s) | Foreground clip (12s) | Inside clip (20s) |
| --- | --- | --- | --- |
| Native | 1.311 / 1.894 | 1.180 / 3.572 | 1.212 / 1.982 |
| Reduced bilinear | 4.784 / 7.370 | 5.046 / 6.124 | 5.046 / 5.702 |
| Cloud-only spatial | 1.769 / 4.879 | 4.588 / 5.141 | 4.391 / 5.040 |
| Final FSR1 | 5.472 / 6.134 | 5.177 / 5.915 | 4.653 / 5.636 |
| Final FSR3 | 5.439 / 6.124 | 5.407 / 5.833 | 5.276 / 5.826 |

**No speedup is demonstrated by this run.** The whole submitted path and queue
gaps cost more than native in this diagnostic. Investigate scheduling/transfer
costs and the extra guide baseline before any performance recommendation;
small isolated upscaler pass timings cannot overturn this result. These are
short local diagnostic clips, not sustained frame-rate or supported-device
claims. Keep the performance/preset gate open.

### 1440p diagnostic run (67% input)

Same settings and sample counts; output 2560×1440, reduced input 1707×960.
Each cell is GPU queue-span **p50 / p95** milliseconds.

| Method | Ground clip (0s) | Foreground clip (12s) | Inside clip (20s) |
| --- | --- | --- | --- |
| Native | 1.311 / 4.332 | 1.311 / 9.598 | 1.180 / 1.625 |
| Reduced bilinear | 4.293 / 5.318 | 4.981 / 5.462 | 5.112 / 5.374 |
| Cloud-only spatial | 0.721 / 4.617 | 0.754 / 5.105 | 0.721 / 5.112 |
| Final FSR1 | 4.719 / 5.010 | 5.308 / 5.600 | 5.505 / 5.731 |
| Final FSR3 | 4.981 / 5.243 | 6.160 / 6.423 | 6.291 / 6.619 |

Cloud-only shows lower median spans in this run, but large tails and reversal
relative to the 1080p run make it unsuitable for a general speedup claim. FSR
paths again do not show a net gain. Repeat under controlled scheduling, remove
unused guides, collect longer/reordered runs and complete visual review before
selecting any preset. No failure is hidden by quoting isolated shader timings.

## Regression and standalone-browser check

After the shared runtime changes, standalone Chrome also reported **19/19 P2**,
**23/23 P3** and **22/22 P4** GPU checks passing. This is the historical
2026-09-17 baseline; the 2026-09-18 in-app-browser update above reports 29 P4
checks after the detail-filter changes. These technical results do not close
the earlier visual defects.


Chrome playback progressed from 12 seconds to the 40-second endpoint. The
foreground comparison capture and full 22-check Chrome report are saved locally
at `artifacts/p4/2026-09-17/foreground-native-fsr3.png` and
`chrome-technical-report.json` (artifacts are excluded from Git). The timing tables
above record the separate in-app-browser diagnostic runs; the Chrome technical
report is not a benchmark report. Image/report downloads were verified in Chrome.

## Guide-allocation correction — 2026-10-08

The reconstruction viewer now measures separate runtime arms. Native, reduced
bilinear, cloud-only spatial, and FSR1 use a plain cloudscape with no temporal
guide allocation; FSR3 alone uses the guide-enabled cloudscape and receives the
packed motion/depth/reactivity input. The native comparison remains a separate
plain cloudscape. The viewer records the selected runtime and guide allocation
for every benchmark clip, and hands the shared scene materials between the two
cloud shadow receivers so only one receiver owns them at a time.

This removes the earlier all-guided benchmark bias. Existing timing tables above
remain historical diagnostic evidence and are not reinterpreted as a preset or
speedup claim; a fresh browser run is required for fair arm-to-arm timings.
