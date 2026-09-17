# P4 critical review guide — reconstruction and presets

Status: review plan for the runnable P4 lab at
[`/reconstruction/`](http://127.0.0.1:5173/reconstruction/). **Verified status
is pending recorded human evidence and a validated preset.** This guide
defines what to inspect and how to report it; it does not pre-accept a preset
or waive a known defect.

P4 asks whether reconstruction preserves useful cloud detail and scene
composition while reducing the cost of rendering. It is a visual and
measurement gate. A clean technical check, a fast isolated cloud pass, or a
good still image is not enough to pass a motion reconstruction path.

Expected appearance is a coherent field of stylized, lit cloud forms with
readable opacity/thickness and the same scene composition at Native resolution.
Reduced modes may soften fine detail. Banding, angular voxel silhouettes, and
coarse cloud shadows remain known debt. The first frame after a reset may have
less detail and converge, but old geometry must never persist.

## Earlier gates still matter

P4 does not replace the earlier phase bars. Use the existing P0–P3 viewers and
evidence when a P4 finding depends on their contracts:

* **P0:** the diagnostic result and controls are legible; resize and resource
  lifecycle remain stable.
* **P1:** one cloud has readable scale and depth, an inside view, and
  continuous cloud/scene shadow behavior. Stylized form remains provisional.
* **P2:** the cloudscape has usable horizon coverage and near/far transitions;
  density/population semantics are clear and shadows do not lead visible
  clouds. Repetition may remain provisional.
* **P3:** sun, sky, cloud shadows, receivers, and environment agree, with
  explicit refresh behavior understood. Coarse shadow filtering and
  atmosphere limits remain tracked quality issues.
* **P4:** reconstruction preserves these scene relationships through motion,
  cuts, disocclusion, foreground edges, and resize, with net performance
  evidence.

If an earlier-stage defect is exposed while testing P4, classify it as a
known unresolved defect or a new regression and link the relevant stage
evidence. Do not relabel it as a reconstruction pass.

## Scope and review vocabulary

At the P4 lab, use the **Method** control at
[`/reconstruction/`](http://127.0.0.1:5173/reconstruction/) to compare the same
deterministic scene and recorded camera path in these five modes:

* **Native reference:** full-resolution reference rendering without
  reconstruction.
* **Reduced + bilinear:** reduced input with bilinear reconstruction.
* **Cloud-only spatial:** reconstruct cloud radiance/transmittance before
  final scene composition; opaque geometry remains full resolution.
* **Final FSR1:** final-scene FSR1 reconstruction.
* **Final FSR3 temporal:** final-scene temporal FSR3 reconstruction.

Native is the reference for comparison, not proof of physical correctness or
finished art. It is valid to find a defect in native, in a reconstruction
variant, or in their interaction. Record which image produced it.

The terms below keep review findings precise:

* **Objective defect:** a required behavior fails or a comparison introduces a
  visible error: a reset leaves stale history, an opaque foreground edge is
  lost, a cloud doubles, or reconstruction ghosts a moving feature.
* **Known unresolved defect:** an already recorded limitation remains present.
  It is still a defect and is **not** a pass or an exemption. It should be
  checked for regression and reported when P4 makes it worse.
* **Provisional art:** an accepted-for-progress appearance choice such as
  stylized/repeated forms. It can remain visually unfinished while the stage
  is judged, unless it breaks a required behavior.
* **Future feature:** outside the current P4 contract. Do not claim it works;
  do not turn its absence into a P4 pass.

## Quick core route (about 20 minutes)

Use one fixed seed, one fixed flight, and identical output resolution/settings
for every mode. Keep the browser and device visible in the review record. The
actual controls are **Method**, **Input scale**, **Native comparison wipe**,
**Sharpness**, **Guide view**, **Reset history**, **Overview**, **Foreground
edges**, **Inside cloud**, **Camera cut**, **Fixed flight**, **Play flight**,
**Moving geometry**, **Density**, **Sun elevation**, **Change world seed**,
**Max cloud samples**, **Run P4 checks**, **Benchmark output**, **Measure all
five methods**, **Save image**, and **Export evidence**.

1. **Establish the reference.** Open
   [`/reconstruction/`](http://127.0.0.1:5173/reconstruction/), select **Native
   reference**,
   run **Fixed flight** with **Play flight**, and use **Save image** at the
   overview, horizon, cloud entry, inside, and foreground-object portions of
   the path. Note the seed, camera path, resolution, internal scale, density,
   sun, and all reconstruction toggles.
2. **Run each reconstruction path.** Replay the identical path in **Reduced +
   bilinear**, **Cloud-only spatial**, **Final FSR1**, and **Final FSR3
   temporal**. Compare each to the
   corresponding Native frame at rest, during motion, and immediately after
   motion stops. Look at cloud edges, thin wisps, high-contrast foreground
   edges, ground/shadow boundaries, and the sky/cloud horizon.
3. **Exercise history invalidation.** During playback make a camera cut, edit
   density, change sun, change world seed, change a reconstruction mode,
   and resize the browser. After each event, inspect the first frame and the
   next few stable frames for trails, doubled clouds, stale brightness, or a
   delayed reset.
4. **Check disocclusion and edges.** Turn or translate so a previously hidden
   cloud, cloud gap, tower edge, thin wisp, or opaque object becomes visible.
   Repeat with a fast move and a stop. Inspect newly revealed pixels and the
   depth boundary for holes, stale history, halos, and geometry loss.
5. **Run objective checks and measurements.** Use **Run P4 checks** for the
   GPU/guide checks, then use **Measure all five methods** at the selected
   **Benchmark output** resolution. The lab measures three clips beginning at
   flight times 0, 12, and 20 seconds; it reports a GPU queue span including
   scene, clouds, reconstruction, and presentation, excluding the wipe and
   environment capture. Export the JSON with **Export evidence**.
6. **Record the decision.** A mode can be called usable only if it preserves
   the required behavior through this route and its measured cost is reported
   with the correct scope. Mark the P4 gate pending if any required case has no
   evidence.

**Control scope:** Sharpness applies to the FSR paths; Guide view is for FSR3.
Use Final image for quality/performance comparisons. In the in-app browser, if
file export does not download, use standalone Chrome; Live evidence remains
readable in either viewer.

## Deeper critical cases

### Motion, temporal history, and cuts

Test slow orbit, rapid flight, reverse motion, stop-and-hold, and repeated
passes through the same cloud. Inspect both the leading and trailing edges of
moving density. Fail a mode for persistent ghost trails, double reconstruction,
history that follows the old camera, or detail that only returns after a long
settling interval. A soft or noisy image by itself is a quality observation;
tie it to the Native comparison and the exact motion case.

Make hard cuts between overview, horizon, inside-cloud, and an empty-sky or
low-density view. The first post-cut frame must not contain the prior view's
clouds, brightness, depth, or motion vectors. Repeat after changing density,
sun, world seed, internal scale, and reconstruction mode.

### Disocclusion and thin features

Reveal cloud volume by panning behind a foreground object, moving around a
formation, and entering/exiting a cloud boundary. Test thin wisps, narrow
gaps, tower silhouettes, and cloud/sky edges. Fail for holes, copied pixels,
stale background, doubled silhouettes, or a thin feature that systematically
vanishes in a reconstruction mode while it is present in Native. Record
whether the loss is cloud detail, opaque geometry, or both.

### Brightness, transmittance, and lighting

Compare sun-facing and shadow-facing cloud regions, cloud interiors, the
ground receiver, and sky transitions. Change sun and density during motion and
after a cut. Look for history-dependent brightness, dark/bright trails,
transmittance jumps, halos around cloud borders, and reconstruction changing
the apparent cloud shadow independently of the cloud.

The current project records approximate exponential cloud haze, coarse cloud
shadow filtering, and incomplete calibrated atmosphere as known quality
limits. They remain review findings when visible; reconstruction must not
hide or worsen them. A change that occurs only because the environment refresh
is intentionally manual should be recorded as refresh state, not silently
called a temporal reconstruction defect.

The cloud guide currently provides a single representative depth for a cloud
pixel and marks mixed pixels as reactive. These are useful integration guides,
not a complete volumetric motion/depth solution. Full cloud wind/advection is
not implemented, so moving-geometry coverage is testable but wind-driven cloud
motion remains unverified. Record this limitation whenever interpreting a
temporal result.

### Geometry and composition

Check opaque foreground objects crossing the volume, object/cloud depth order,
ground contact, the inside view, and the unchanged sky-only background. Fail
for geometry loss, incorrect depth ordering, cloud pixels leaking through
opaque edges, halos, or a scene/background mismatch between modes. Test both
near and distant formations and look downward as well as toward the horizon.

## Required controls and reset matrix

The integrated viewer makes it possible to repeat the following matrix. Record
the exact control label and value in evidence.

| Change | What to inspect immediately | Pass condition |
| --- | --- | --- |
| Native reference ↔ Reduced + bilinear ↔ Cloud-only spatial ↔ Final FSR1/FSR3 temporal | mode transition and first frame | no stale history or double reconstruction |
| Fixed flight play/seek/restart | moving and settled frames | same path is repeatable; restart has no old trail |
| Camera cut | first frames after cut | old view does not bleed into new view |
| Density / world seed | cloud edges, gaps, shadows | no stale density or brightness history |
| Sun | lit/shadow boundary and sky | no stale lighting trail or unexplained flash |
| Internal scale / quality preset | fine edges and reset | settings take effect and history is reset when required |
| Browser resize / output resolution | edges, depth and composition | no stretched, clipped, stale, or corrupted image |
| Method, Input scale, Sharpness, or Guide view | comparison to Native | control is legible and changes only its claimed path |

“Pass” in this table means the behavior for that row is clean. It does not
mean the whole P4 stage passes; all required rows, motion cases, comparisons,
and measurements must be evidenced.

## Known issues that must stay visible in review

Carry these forward from P2/P3 and distinguish them from newly introduced P4
defects:

* The volumetric view fade currently covers approximately 4.4–7.7 km. Cached
  shadow density remains unfaded, so shadows can persist after visible clouds
  fade. There is no far LOD or mass handoff. This remains a defect, including
  in a Native reference; reconstruction does not resolve it.
* Cloud population is a diagnostic population control, not coherent weather
  coverage. It can hide whole forms and does not supply spatial weather
  patches.
* Angular voxel silhouettes and sampling bands remain spatial-reference
  quality debt. Do not promise that FSR fixes them; compare against Native and
  identify whether a reconstruction path amplifies them.
* Cloud-shadow filtering is coarse. The P3 3×3 filter applies to geometry
  shadow depth, not the broad cloud transmittance cache.
* Sky haze is an approximation and full atmosphere transmittance/in-scattering
  remains incomplete. The environment capture contains sky and clouds only;
  local terrain and opaque objects are excluded, and the fixed probe has
  limited parallax.
* Environment refresh is manual/on-demand in the current slice. A stale
  reflection before the explicit refresh is expected behavior of that control,
  but a failed refresh or incorrect ownership is a defect.

These items are neither visual sign-off nor waivers. Report a regression,
especially if a reconstruction mode makes a known limitation more prominent.

## Performance evidence and gate

The current lab is a **guide-enabled diagnostic baseline**: native/spatial paths
also generate temporal guides. Their production costs could be lower with that
unused work removed. This prevents accepting presets from these timings alone.
See [P4 evidence](p4-evidence.md) for the actual run and measurement limits.


In **Benchmark output**, use each available output resolution and **Measure all
five methods**. Measure the complete user-visible frame path for each method:
Native reference, Reduced + bilinear, Cloud-only spatial, Final FSR1, and Final
FSR3 temporal.
Report net frame time with warm-up excluded and include p50 and p95. Keep GPU
cloud, generation, shadows, environment, reconstruction, and total costs
separate when the instrumentation supports it. Record output resolution,
internal scale, scene/coverage, density, seed, browser, OS, device, driver,
refresh rate, and whether the run was moving or static.

The performance gate is based on **net frame cost**, not an isolated
reconstruction pass. An isolated pass can look cheap while the combined path
adds history copies, synchronization, composition, or other costs. A mode
must also retain acceptable image behavior in the critical cases above.
The lab's method sweep reports p50/p95 distributions after warm-up; preserve
those values in the evidence. The live status line's CPU submit value is useful
context but is not GPU timing.
Do not invent numeric targets, tolerances, or benchmark results. The M5 Pro is
the currently evidenced local device; RTX 3060/Windows evidence remains
required for a Windows claim. Half-resolution is a quality/performance tradeoff
and the current whole-scene scaling preview must not be described as cloud-only
reconstruction or FSR.

## Issue report template

Copy this block for every new failure or meaningful regression:

```text
Stage/review: P4
Scene/path and mode:
Issue type: objective defect / known unresolved defect / provisional art / future feature
Reproducible pose or playback time:
Seed:
Settings: output resolution, internal scale/preset, density, sun,
          cut/reset/resize/reconstruction toggles
Device/browser/OS/driver:
Expected:
Observed:
Comparison: Native reference / Reduced + bilinear / Cloud-only spatial / Final FSR1 / Final FSR3 temporal
Static or motion (speed and settle time):
Screenshot/video or capture:
Impact: Blocker / Major / Minor / Observation
Related phase: P0 / P1 / P2 / P3 / P4
Pass/fail impact:
Notes and likely follow-up:
```

Use **Impact** for issue severity, and **Related phase** only to identify the
contract or gate involved. A **Blocker** prevents the required review path or
invalidates the comparison; **Major** is a substantial required behavior or
quality failure; **Minor** is a reproducible localized defect; **Observation**
records a preference or informational result. A known defect can still be Major or Blocker; familiarity does not lower its severity. Impact does
not identify implementation ownership. Link the screenshot or capture and
preserve the exact pose/settings so a reviewer can replay it.

## Acceptance record

P4 status: **pending**.

The integrated viewer and [technical evidence](p4-evidence.md) are available. Fill this section after your review:

```text
Review date:
Viewer URL and actual control labels:
Seed/path:
Modes exercised: Native reference / Reduced + bilinear / Cloud-only spatial /
                 Final FSR1 / Final FSR3 temporal
Devices/browsers:
Motion/cut/disocclusion/edge cases:
Known issues observed or regressed:
Performance evidence (net p50/p95 and scope):
Open P4 defects:
Human judgment: pass / fail / conditional
Technical evidence link:
```

A P4 pass requires the required modes and cases to be runnable, clean reset
behavior through cuts/edits/resize, preserved detail at disocclusion and thin
edges, no unacceptable ghosting/halos/geometry loss, and documented net frame
measurements. Mark an affected mode failed when a required defect is reproduced. Mark missing evidence unverified, and keep the overall gate pending until the review record and performance requirements are satisfied.
