# Persistent coverage and distance refinement

2026-09-19. P2.4/P2.5 working design, separate from lighting acceptance.
This is our proposed architecture; it is not a claim to reproduce Decima's
implementation. Source findings are in the [Nubis distance research](../research/nubis-lod.md).

## Problem and intended behavior

Today the resident voxel window also determines which clouds can be seen.
Camera-distance fading removes formations while their shadow density remains.
Increasing the window or hiding those shadows cannot supply a persistent
formation that is visible from far away and can later be entered.

The revised source should describe weather and broad formations independently
of the camera. A camera determines which detail to prepare, not whether the
formation exists. A selected formation should remain identifiable on approach
at 20, 12, 8, 4 and 1 km, then during entry. These are test positions, not LOD
thresholds or a promise of infinite draw distance.

## Boundaries

| Responsibility | Owns | Does not own |
| --- | --- | --- |
| Global weather/profile source | Stable world-space coverage, density control, base/top height, type and revision | Camera, residency, view opacity fade |
| Broad shape generator | Canonical formation/tile identity and density from weather or authored fields | Separate random identities for different detail levels |
| Representation builder | Coarse/fine voxel data, conservative occupancy, generation and upload revisions | Sun integration, temporal history |
| Residency/detail policy | Preparation priority, projected-error estimates, retained data and fallback readiness | World definition or cloud existence |
| Volumetric integrator | One density contribution per world location, light and view sampling | Independent full cloud copies alpha-stacked during transitions |

The independent thin-cloud layer remains a distinct atmospheric layer; it is
not a replacement image for a volumetric formation the camera will enter.
Authored bounded fields keep their own source identity. Weather must not
silently deform an imported authored object.

## First source experiment (implemented separately)

`experiments/coverage/weather.ts` is a CPU reference for deterministic regional
weather in XZ. It has no camera input and produces a smooth coverage mask,
density response, height envelope and type parameter. Coverage changes the mask
continuously; density scales extinction intent without relocating the pattern.
Coverage zero/one and density zero have exact endpoint behavior.

The sample's `density` is a potential-density coefficient independent of its
coverage mask. The preview's density response is `coverage * density`;
a future 3D shape/profile supplies the remaining spatial density factor and
physical extinction scale. Keeping these controls separate must not turn a
zero-coverage region into visible density.

[Coverage study](http://127.0.0.1:5173/coverage-study/) displays a 96 km square
source map and an illustrative resident window. Moving the camera overlay must
not regenerate or modify the map. Clear, scattered and broadly covered source
patterns can be inspected without involving ray marching or lighting.

This is not a physical weather simulation. The coverage slider does not promise
an exact fraction of visible sky. The map reports its measured mean mask and
area above a stated threshold. The prototype has a documented bounded coordinate
domain; floating-point precision and periodic hashing need separate work before
planet-scale support. It is not exported by any public package.

## Representation experiment to run next

1. Select a fixed region and generate one canonical high-resolution broad
   voxel field from a weather/profile source. Retain cavities/overhangs where the
   full 3D source supplies them; a height envelope alone is not the final shape.
2. Derive coarse levels from the same field with volume-aware filtering.
   Compare coarse sampling with the canonical field over complete rays. Matching
   mean density or complementary transition weights alone does not guarantee
   matching transmittance after exponentiation.
3. Keep the coarse level resident throughout the test. Make fine data available
   asynchronously and in deliberately shuffled order. The fine representation
   must not become visible until its density, addressing metadata and required
   lighting data belong to a compatible revision.
4. Select refinement using projected voxel size/error, with hysteresis and
   preparation margin. A distant large cloud can require more detail than a
   nearby small cloud. Exact pixel thresholds follow measurements; they are not
   public defaults yet.
5. During overlap, sample one effective extinction field:
   `sigma = (1 - w) * sigmaCoarse + w * sigmaFine`, with `w` in [0,1]. Apply the
   same source ownership to view and shadow queries. Missing fine data means
   `w = 0`, not an invisible cloud. Reject negative/non-finite densities.
6. Preserve a stable coarse representation when fine data is evicted. Test a
   camera cut and rapid reverse motion before choosing a streaming policy.

Use a bounded single-region experiment first. No new sparse format, full-world
3D texture, procedural fallback or fixed number of tiers is selected by this
decision. Any later procedural coarse path must preserve the canonical shape
identity and pass the same optical comparisons.

## Falsifiable acceptance tests

| Gate | Test | Fail |
| --- | --- | --- |
| Source identity (P2.4) | Sample fixed world points before/after camera moves and regeneration | Any source change caused only by the camera |
| Coherent coverage (P2.4) | Clear-to-full mask sweep, adjacent and separated sample comparisons | Random full formations disappear; coverage decreases anywhere when control increases |
| Density independence (P2.4) | Density 0→1→2 at identical weather/source coordinates | Zero cannot clear density, or shape/type/height relocates |
| Representation identity (P2.5) | Same canonical field downsampled and restored across tiers | Seed, position, broad silhouette or revision changes between tiers |
| Ready fallback (P2.5) | Delay/cancel/reorder fine loads during approach and camera cuts | Missing data creates a hole or stale fine data replaces a newer source |
| Single density ownership (P2.5) | Homogeneous fixture while sweeping overlap weight | Optical depth doubles, endpoints disagree, or empty input gains density |
| Optical agreement (P2.5/P2.6) | Fixed rays against canonical reference; report L/T errors and silhouette changes | Unreported error or claimed pass based only on similar still images |
| Shadow agreement (held for lighting review) | Known-sun cloud/receiver path through the same transition | Arbitrary camera fade suppresses only visible density |
| Cost (held for quality convergence) | Resident bytes, generation/upload spikes, frame and shadow timings | Any performance preset accepted before image quality passes |

Physical offscreen clouds may legitimately cast visible shadows. The test is
agreement with the actual world-space density, not requiring every shadow's
source to be inside the camera frustum.

## Handoff to agents

**Distance audit decision:** [measured image comparisons](../archive/p2-lod-evidence.md#distance-quality-continuation--2026-09-19)
select 32×64×32 over cubic 32³ for the bounded profile-driven fixture. Keep
per-axis resolution in the representation contract; do not assume all coarse
levels halve every axis. This is not a universal size/default. The production
atlas and weather-connected formation set must receive equivalent comparisons
before adopting detail thresholds. Do not use the candidate's passing distance
samples as evidence that the current finite world has persistent far support.

**2026-09-19 bounded proof:** one worker owns `experiments/lod/` and
`examples/lab/lod-study/`; root owns integration and acceptance. The diagnostic
may resample coarse/fine into one full-size dense field on the CPU and upload it
to the existing bounded reference renderer. That is a correctness experiment,
not sparse residency or production GPU LOD. Report the extra reference storage
and uploads explicitly. Shared lighting queries then consume the same effective
field; no cached-lighting revision or production banding fix is implied.

Production integration still requires replacing the atlas's single tile lookup
inside `extinctionAt` with canonical broad/fine ownership, extending support
beyond the current resident window, and making both candidate traversal and
light-cache invalidation reflect that support. Simply uploading the diagnostic
blend into the current atlas leaves world coverage and view-only fade unresolved.

P2.4 owns source evaluation and source diagnostics. P2.5 starts as an isolated
coarse/fine density experiment with a frozen source, without changing the
production cloudscape. Root owns eventual source contracts, shader composition,
lighting-cache revisions and integration. Lighting investigation remains
independent; no default rendering or performance preset changes in this packet.

## Source checkpoint evidence

- Nine source unit tests pass: repeatability, distinct seeds, local coherence,
  monotonic continuous coverage, independent density, valid height envelope,
  signed lattice-boundary continuity and input validation.
- The browser's five source checks pass over 121 fixed world points.
- At seed 17 / 18 km scale / coverage 0.55, the 192² map has mean mask 59.2%
  and area above 0.5 of 59.8%. Coverage 0/1 yields measured 0%/100% endpoints.
- Density 0 visibly clears the density-response map while preserving coverage,
  height and type. Moving from 20 km to entry changes the illustrated resident
  origin from [0,9] to [0,0], with source-map generation unchanged at 1 and the
  selected sample identical. No renderer or shadow behavior is measured here.
- TypeScript, the full 77-test suite and the lab build pass. The experiment is
  not part of published or packed runtime APIs.
