# P2 cloudscape evidence

Local development record, 2026-09-17. **R2 feedback is received; P2 is returned for coverage revision.** This is a coverage and residency prototype; it is not a final appearance or release claim.

## What is implemented

Open [`/cloudscape/`](http://127.0.0.1:5173/cloudscape/). The scene has a repeatable 40-second flight, ground/approach/inside views, orbit controls, coverage/density/sun controls, a separate optional thin-cloud layer, GPU checks, timing export, and a five-view contact sheet.

- Eight generated 48³ forms share a 96³ r8 atlas with empty border texels. Generation occurs once on the CPU; a region change does not regenerate it.
- A deterministic 9 × 9 resident grid follows the camera. Retained cells keep their world placement and density metadata. The default working set is 81 descriptors; coverage controls which are active.
- One ray march sums overlapping extinction. Distant formations within the supported window remain volumetric. Projected fine modulation fades with distance; there is no representation swap into the thin layer.
- A GPU-generated 88 × 32 × 88 integer field records conservative cloud candidates. Empty voxels can be skipped while retaining the reference sample lattice. Nonempty voxels usually reference one cloud instead of testing nine neighbors.
- A preliminary 132 × 32 × 132 light cache amortizes cloud self-shadow evaluation. Density, sun direction and region changes invalidate it. Camera motion inside a cell reuses the resource. Fixed-size region changes do not reallocate the 3D textures.
- Direct WGSL uses Three's device and textures; TSL presents the result and provides the material receiver marker. Normal rendering performs no CPU readback.

## Continuity and distance limits

Density sampling uses a camera-anchored lattice whose spacing does not change when the resident window rebases. A continuous camera-relative fade removes view density before cells leave the resident window. The default view fade starts at **4.4 km** and volumetric support ends at **7.7 km horizontal distance**. This is a finite coverage policy, not infinite cloud streaming; assessing that horizon is a central R2 question.

The view fade does not alter the cached physical shadow density. This deliberately keeps cache updates independent of camera motion, but distant visible density and shadow strength can differ. Cache interpolation, low-angle sun behavior, atmosphere composition and broad opaque-material support remain P3 work. The current scene uses a marked plane receiver and one analytical box caster.

## Automated checks

**42 unit tests, 19 P2 GPU checks, type checking and all four production pages pass.** Final validation reports contain no GPU errors. Checks separate analytic optical correctness, conservative lookup equivalence, GPU/CPU candidate-mask agreement, cache invalidation, lifecycle and region continuity. Numerical density continuity does not establish subjective motion quality or lighting continuity.

## Memory accounting

Default resource payloads, excluding driver overhead, staging and Three's scene resources:

| Resource | Payload |
| --- | ---: |
| Eight-form density atlas | 884,736 bytes / 0.84 MiB |
| Candidate field | 991,232 bytes / 0.95 MiB |
| Preliminary light cache | 4,460,544 bytes / 4.25 MiB |
| Cell buffer capacity (up to 17 × 17 descriptors) | 9,248 bytes |
| Frame targets | 32 bytes × internal pixel count |

At 960 × 540, these payloads total approximately **21.87 MiB**. Actual GPU allocation is larger. Atlas and world data remain bounded during the flight; there is no accumulating set of generated cloud textures.

## Timing method

Use **Measure flight views**. It records five fixed poses at 960 × 540 internal resolution, discards four warm-up samples and records 16 measured samples per pose. GPU timestamps measure the cloud integration/composition pass, light-cache rebuild and candidate-field rebuild separately. Scene rendering, presentation, readback and total frame cost are excluded. CPU submission and atlas generation are separately labeled.

The first full-march implementation measured roughly 10–14 ms per cloud pass on the local Apple/Metal backend. That historical baseline preceded the final lattice and support fade, so it is not an exact image-matched speedup comparison. Final lookup-on/off measurements use identical settings and are the valid acceleration comparison. A zero candidate timestamp reflects timer quantization, not free work.

## Local measurements

Apple / Metal 3 in the development browser (Chrome 152 user agent); user-reported host is M5 Pro. This does not identify or validate the RTX host. Atlas generation took **200.6 ms** in the recorded accelerated session (one-time synchronous CPU startup; worker/WASM generation remains future work).

Same final shader, 320 maximum full view steps plus clipped boundary segments, detail 0.16, density 1, cached lighting and early termination enabled:

| Flight time | Lookup p50 / p95 (ms) | Full march p50 / p95 (ms) |
| --- | ---: | ---: |
| 0 s, ground | 0.98 / 1.38 | 3.87 / 4.82 |
| 12 s, approach | 1.38 / 1.47 | 4.82 / 5.73 |
| 20 s, inside | 1.38 / 1.65 | 5.73 / 7.08 |
| 30 s, above/across | 1.38 / 1.70 | 5.96 / 7.23 |
| 40 s, beyond | 1.11 / 1.54 | 5.54 / 6.68 |

The lookup is **3.5–5.0× faster** in these matched cloud-pass measurements. It is the default. With lookup enabled, light-cache rebuilds measured 0.39 ms after the first pose's 1.64 ms; candidate rebuilds measured 0–0.066 ms at coarse timestamp precision. Both rebuild passes are extra work on region changes. These numbers are below the provisional 4 ms cloud-pass investigation threshold at this internal resolution; they are not a 1080p/1440p preset or a total-frame performance claim.

GPU/CPU candidate masks match exactly in the fixture. Lookup-on/off optical outputs match exactly in the sparse and shaped comparisons (tolerance 0.00001). Same-camera region rebasing has zero optical difference (tolerance 0.00001). Moving 0.2 m across a real cell boundary changes the worst optical component by 0.00342 (tolerance 0.04); that includes ordinary camera parallax. These tests use shadows off to isolate density continuity. Early termination differs by at most 0.00049 from the full opaque reference (tolerance 0.001).

Local raw evidence: `artifacts/p2/2026-09-17/accelerated.json`, `reference.json`, and `flight-sheet.png`. Artifacts are intentionally excluded from Git; the method and measured summary are retained here. The contact sheet shows stylized/repeated forms, flat provisional lighting and coarse ground shadows. Those are visible review limitations, not evidence of finished cloud art.

## Review boundary

Use the [R2 checklist](human-review.md#p2--cloudscape-coverage-and-distance). Inspect repetition, horizon coverage, camera transitions, thin edges and shadows in motion. The contact sheet helps compare poses but cannot establish temporal stability.

P3 and P4 remain unstarted. P2 is substantial enough to make this a useful human checkpoint before choosing further horizon/lighting treatment. The user's authorization permits continuing through P4; nothing beyond P4 is authorized for this unattended implementation run. R1 feedback and the earlier floor-shadow retest remain open. RTX 3060/Windows performance is unverified.

## R2 feedback and viewer fixes

The user confirms all checks pass, close flight/entry/scale feel good, and repeated forms are acceptable provisionally. The review exposes missing distant coverage, late reveal, shadows before clouds, whole-form population changes instead of weather coverage, and sampling/voxel artifacts. Therefore the earlier numerical checks and timings do not establish P2 visual acceptance. See the updated human review guide for the quality rubric and follow-up priorities.

The viewer clock formerly accumulated time through an HTML slider with 0.02-second steps; sub-step frame advances could round to zero. It now owns full-precision time independently of the displayed slider. Five playback regressions cover 60/120/144/240 Hz, seek/end behavior and background pauses. Chrome playback was observed advancing beyond 30 seconds with camera motion and no application errors. Density now allows zero and 0.005 increments; Chrome rendered no volumetric clouds or their ground shadows at zero (the independent thin layer remains separate). The old Coverage control is relabeled Cloud population and allows zero. These are viewer fixes, not a weather system or distant-LOD fix. Current validation: 47 unit tests, 19 GPU checks in Chrome, type checking and build pass.
