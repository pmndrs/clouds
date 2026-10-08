# P2.5 bounded LOD checkpoint

2026-09-19. Scope: one diagnostic formation, not the production cloudscape.

## Delivery

[`/lod-study/`](http://127.0.0.1:5173/lod-study/) compares a canonical 64³ r8
weather/profile-derived field with volume-averaged 16³ or 32³ fields. The
candidate combines density before integration; the two panes are comparisons,
not alpha-stacked representations. Coarse data remains available while a
manually simulated fine request is pending or cancelled. Request tokens and
source revisions prevent stale results from becoming active.

Projected voxel footprint uses the viewport/FOV and an experimental 2.5/1.5 px
request hysteresis. Fine readiness ramps over 0.45 seconds, with CPU blend/upload
updates throttled to roughly 120 ms. This is intentionally not a fluid or
efficient streaming implementation. Forced eviction returns immediately to
coarse data and can visibly change shape. The request-intent flag does not yet
drive automatic loading or memory eviction.

The diagnostic uses two independent WebGPU renderers. During a blend, it keeps
the canonical source, coarse source and another 64³ CPU upload field. These
allocations and full-size uploads do not demonstrate memory savings. No lighting
cache is used; self-shadowing is bypassed for density comparison.

## Verification

- One Luna high worker implemented the experiment in isolated paths; root
  reviewed it, corrected cancellation/semantics and strengthened verification.
- Six focused tests cover actual box averages, shared bounds/identity, empty
  source faces, analytic homogeneous transmittance, blend endpoints, optical
  measurements, cancelled/stale loads and projected detail behavior.
- Full workspace: **83 tests pass**, typecheck and lab build pass.
- Chrome: **five browser/GPU checks passed for each coarse resolution** at a
  fixed 128×128 pose: canonical visibility/finiteness, reordered-load rejection,
  visible pending coarse fallback, cancelled-load rejection, and blended fine
  endpoint transmittance equivalence. Endpoint maximum absolute T difference
  was **0**. The audit suspends ordinary rendering/control updates during
  readbacks and restores the viewer to coarse fallback afterward.
- Canonical/candidate panes were visually inspected at 1 and 4 km. A cancelled
  delayed request was exercised through the controls. This is not a complete
  motion/silhouette acceptance sweep.

Six fixed world-space rays (including empty and oblique rays), 128 midpoint
samples, extinction scale 0.0024/m:

| Coarse level | Maximum absolute transmittance error | Error at half blend |
| --- | --- | --- |
| 16³ | 0.160348371 | 0.084226077 |
| 32³ | 0.052094898 | 0.026446948 |

These are measured differences from the canonical field, **not accepted visual
tolerances**. The unit smoke bounds (0.25 coarse / 0.13 half blend) only guard
large regressions on this fixture. Six rays do not cover the image. The viewer
also reports sampled r8 quantization error at voxel centers; that is distinct
from continuous-field resampling and complete-ray error.

## Distance-quality continuation — 2026-09-19

The bench now includes a cancellable **Measure distance quality** sweep and JSON
export. One Luna medium worker supplied optical image metrics and focused tests;
root implemented the GPU sweep, per-axis filtering and viewer integration.
Completed raw evidence: [320² report](research/lod-distance-results.json) and
[640² report](research/lod-distance-results-640.json).

Each run measures 15 poses: 20/12/8/4/1 km at 20/90/150° azimuth, 42° FOV,
with self-shadowing and history off. It compares direct 16³, 32³ and 32×64×32
representations and two half-blend candidates. The latter preserve the source's
vertical samples while reducing horizontal samples. Both runs check the
canonical field at 256 versus 512 integration samples before judging LOD.

Provisional gates were declared before the sweep: maximum absolute T error
≤0.02, mean T error over the union of cloud pixels ≤0.005, silhouette mismatch
≤5% of that union, integrated opacity difference ≤3%, and at least 16 reference
cloud pixels. Cloud support means opacity >0.01. Empty or too-small references
are inconclusive, not quality passes. Reference sampling convergence requires
max T error ≤0.002 and support mean ≤0.0005.

**640² results, worst value across the 15 poses:**

| Representation | Poses passing all provisional gates | Max T error | Cloud-pixel mean error | Silhouette mismatch | Integrated opacity difference |
| --- | --- | --- | --- | --- | --- |
| 16³ | 0/15 | 0.16553 | 0.02838 | 15.48% | 2.294% |
| 32³ | 0/15 | 0.04932 | 0.00658 | 5.11% | 0.615% |
| **32×64×32** | **15/15** | **0.01660** | **0.00187** | **2.10%** | **0.281%** |
| 32×64×32 at half blend | 15/15 | 0.01074 | 0.00118 | 1.29% | 0.143% |

The same direct candidate passed 15/15 at 320². Reference convergence passed
all 30 poses, worst max T difference 0.00048828125; all same-field candidate
endpoint checks were exactly zero. The bench now defaults to 32×64×32 as the
selected **fixture candidate**. Its r8 density payload is 65,536 bytes versus
262,144 bytes for the canonical field. This is a fourfold reduction in that
payload only; the diagnostic keeps extra fields and has no demonstrated total
memory or frame-time saving.

The result supports preserving detail independently by axis for this tall,
profile-driven fixture. It does not establish one texture shape or distance
threshold for all clouds. This sweep is discrete, unshadowed and limited to one
source; inside-cloud motion, new morphology, lighting, mixed-revision caches and
world continuity still require evidence. The six-ray table above is historical
and is not the selection criterion for this new candidate.

Validation after integration: **93 workspace tests**, typecheck and lab build
pass. The rectangular texture sampling/averaging regression covers correct row
and slice strides. Cancellation was exercised in Chrome and a complete sweep
subsequently finished. RGB lighting quality is outside these T-only metrics.

## Decision and next work

The bounded experiment now has a measured coarse candidate. P2.5 and P2 remain
open. Carry per-axis resolution into the world representation design, retain a
canonical fallback and validate the actual formation set before choosing world
LOD thresholds. Integrate persistent support into the world renderer. The existing camera fade, finite
world window, distant shadows, production lighting bands and provisional shapes
have not changed. P2.7 density realism follows; full lighting acceptance remains
P3. Existing P4–P6 previews are retained without expanding those phases now.


## Persistent world integration — 2026-09-20

The default [`/cloudscape/`](http://127.0.0.1:5173/cloudscape/) now uses a fixed
33×33 region with 2.2 km cells (72.6 km nominal width). The old resident-window
mode remains selectable for comparison. This is P2.6's first integration, not
completion of P2 or infinite-world streaming.

### What changed

- Global cell identities, geometry and atlas variants remain fixed during camera
  motion. Coverage thresholds a smooth regional field; clear areas open
  coherently, extinction changes continuously, and coverage zero is exactly empty.
  Cell geometry remains the eight provisional forms. This samples weather per
  formation, not a continuous weather texture inside each formation; coverage is
  not a calibrated percentage of visible sky. The earlier coverage-study source
  remains a separate experiment.
- Each fine 48³ tile has a box-filtered 24×48×24 coarse tile with the same bounds
  and identity. View rays and sun rays call the same density blend. The legacy
  view-only distance fade and view-only sinusoidal detail are disabled in this mode.
- An experimental per-formation weight uses projected coarse voxel size: coarse
  below 1 px, fine above 3 px, smoothstep between. It uses distance to the nearest
  point of the formation bounds and the current render height/FOV. It is not
  frustum culling: offscreen clouds remain valid shadow casters. Changing output
  resolution can change the weight. The 1–3 px policy is not visually accepted.
- Endpoints sample one texture; transitions mix extinction before integrating.
  Light cache invalidation follows weight changes. This corrects density ownership;
  it does not prove converged or artifact-free shadow integration.

### Evidence and limits

Raw Chrome/Metal report: [persistent-world-results.json](research/persistent-world-results.json).
Eighteen new GPU checks and the existing nineteen P2 checks pass with no recorded
WebGPU validation errors. Checks include a shaped coarse cloud visible at 20 km,
no world upload/rebase after camera travel, exact repeatability on return, empty
coverage, partial density blending, unavailable-fine fallback, candidate/full
quadrature equivalence, and cache refresh/reuse. The homogeneous 20 km fixture's
absolute transmittance error is 0.00453 against a predeclared 0.015 tolerance.
The partial blend test uses deliberately different constant endpoint densities
and checks analytic optical depth. Optical checks bypass self-shadowing; cache
checks verify invalidation, not lighting appearance. These small fixtures are
not a full-resolution, moving cloudscape image-quality pass.

Regression checks also pass: 23 P3 and 29 P4 GPU checks in Chrome. The workspace
has 99 passing tests; typecheck and lab build pass. Clear coverage with the thin
layer off and partial coverage were visually inspected at Ground/Horizon. This
is still a spot check, not a motion approval.

Six source tests cover spatial coverage correlation, smooth/monotonic coverage,
fixed metadata, neighbor bounds, atlas averages and packed tile isolation, plus
input rejection. One Luna medium worker implemented source/filter modules; root
reviewed, corrected the regional mask and strengthened tests, and implemented the
shared GPU path, integration viewer and optical checks.

Known constraints:

- Finite outer boundary remains; travelling beyond the region eventually empties
  the world. No rolling clipmap, background streaming or automatic residency.
- Fine and coarse atlases are both resident. The coarse payload is 221,184 bytes
  versus 884,736 fine bytes; total density storage increases to 1,105,920 bytes.
  No total-memory or frame-time saving has been demonstrated. The diagnostic
  `fineReady` fallback is immediate; delayed readiness/ramping remains isolated
  in the LOD study and is not yet integrated into the world.
- The light cache is capped at 132×32×132 over the region. Its coarse spacing and
  48-step sun integration can produce broad/blocky shadows and bands. Camera
  motion can rebuild it every frame as weights change. This is a correctness
  prototype, not an accepted scalable preset.
- Density remains stylized and repetitive. The previous 640² single-formation
  audit does not certify these eight atlas forms or their transitions.
- Full lit motion, matched shadow appearance, region boundaries, RTX/Windows,
  and performance acceptance remain open. A shadow without a visible cloud can
  legitimately come from an offscreen caster; an in-view formation disappearing
  while its shadow remains must still be reported.

Next: review approach/retreat and partial refinement in this fixed region,
measure production-atlas transition error, then proceed to P2.7 realistic density.
P3 lighting convergence follows; later previews remain unchanged.

## Expanded source audit — 2026-09-20

The [density study](p2-density-review.md#recorded-technical-evidence) now tests
the eight actual atlas forms and the new cumulus candidate at common physical
bounds/extinction. All 36 reference poses converge, but all coarse and half-blend
comparisons fail at least one existing provisional gate. This is evidence against
generalizing the earlier single-profile result. It does not certify varying
world bounds, stronger extinction or the production GPU blend.

**Default changed:** persistent Cloudscape now uses fine density at every
distance. Turning off **Full detail (coarse is experimental)** exposes the
coarse candidate. The shared density path and fixed coverage remain; automatic
projected refinement is available internally but not visually accepted. The
previous integration section records the initial prototype, not the current
default quality policy. Shape review is the next checkpoint before expanding
new source variants and retuning representation/filtering.
