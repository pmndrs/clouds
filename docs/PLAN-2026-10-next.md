# Roadmap from here (2026-10-09, evening)

Supersedes the ordering in `docs/PLAN-2026-10-variety.md`. That plan's task definitions still hold. Research inputs:
- `docs/research/deck-scenes.md`
- `docs/research/hzd-nubis-evolved.md`
- `docs/research/photo-species-specs.md` and `docs/research/legacy-and-survey.md`, both in progress
- the owner's photo set at `artifacts/research/cloud-photos/` (local only, never committed)

## Where we are

| Area | State |
| --- | --- |
| Comparison page (ours, Sky Pro, Takram) | ✅ P8-A. Ours was a row of identical domes; that drove everything below |
| Variety yardstick | ✅ P9-A: footprint CV, base spread, clone score, read from the GPU field |
| Weather v2 (clusters, size classes, shared bases, shear, fractus) | ✅ P9-B, P9-B2 (no-stall tiled bake) |
| Species profiles (Nubis Evolved tables) | ✅ P9-C: 7 species, an altocumulus layer, a valley sea. Clone 0.32–0.55 |
| Species look fixes | 🔄 P9-C2: altocumulus lattice, cylinder towers, stratus box edge |
| Authored library (17 Pyro sims, frankenclouds) | ✅ P9-F: clone 0.47 |
| Ground shadows from every cloud | ✅ P10-A (cascaded shadow map), P10-B (`applyShadow(light)`) |
| Docs site (pmndrs/docs MDX), gallery, WebKit error overlay | ✅ P8-B/C/D |
| Sparse hero storage spec (WebVDB) | ✅ P8-E spec; implementation not started |
| Cloud cost on high | ❌ 4.5–5.3 ms at 2560×1440 after P9-C (budget 3.5) |

## Priority (owner, 2026-10-09): quality first, performance later

Our clouds still don't match the WebGL work we are building on (Takram, Sky Pro) or the photos. Until they do, **visual quality comes first.**
- Performance budgets are guards against regressions, not goals. Keep demos at interactive rates on the owner's laptop, and don't let any change more than double a pass without a reason.
- The budget model below and the scheduler work (S1) still stand. They come after look parity.
- Order: look parity and the species, then scenes, then hero detail, then performance (9-C3 follow-ups, S1, ray reconstruction).

## Never acceptable (all phases)

- A pattern a person can see: clones, lattices, cylinders or box outlines.
- A frame stall: background work (bake, regeneration, light grid, shadow map) over **10% of the frame budget** at the app's target rate in any single frame. That is 1.7 ms at 60 fps and 3.3 ms at 30 fps. (Before 2026-10-09 this was a flat 1 ms; the owner asked for it to be relative.)

**Budget model (owner, 2026-10-09):** steady cloud cost on high is about **20% of the frame at the app's target rate**: about 3.3–3.5 ms at 60 fps on 1440p, about 6.7 ms at 30 fps. A showcase tier may use more, as an opt-in. Never trade visible quality to hit the number; report the honest cost instead.
- Judging by numbers alone. Every task ends with captures the orchestrator looks at, and species work is also compared with photos.
- Committing slide images or the owner's photos. They stay local; only our renders are committed.
- Work left uncommitted.

## Phase A: finish the species (Phase 9 remainder)

| Task | Pass | Fail | Can defer |
| --- | --- | --- | --- |
| **9-C2 Look fixes** (running) | Species sheet shows no lattice, cylinders or box outline; it reads like the photo sheet of each species | Any species still reads as a primitive or a pattern | Lenticular, mammatus |
| **9-C3 Cost** | High ≤ 3.5 ms on cumulus and mixed at ground, horizon and above; A/B shows no visible loss; the box-wall bright column is gone | Over budget, or quality visibly drops | Low/mobile re-tuning (Phase F) |
| **9-D Shape detail** | Neighbouring clouds differ in lobe scale and edge character up close: rising clouds crisp, decaying ones wispy. **Directional detail:** the leading face (into the wind or shear) is sharper and more compact, the trailing edge softer with wisps trailing downwind, tops crisp and ridged, bases smooth (from the owner's observations, `docs/research/cloud-motion-ideas.md`). ≤ +0.3 ms | Same cauliflower everywhere | Per-cloud animated growth |
| **9-E High layer** (cirrus, cirrostratus; NE p.65 recipe) | Fibrous streaks and veils from the ground at midday and sunset, matching the cirrus photo sheet. ≤ +0.3 ms | Reads as noise or fog | Contrails, halos |

**Phase A passes** when the species sheet and photo sheets are judged side by side and match in silhouette, spacing and edges, with variety thresholds and cost met.

## Phase B: first scenes from the talks (Phase 11)

The order is changed so each target arrives as soon as its pieces exist:
1. T1 fair-weather cumulus under a cirrus veil (needs 9-E)
2. T4 layered sunset bands (needs Phase C colour)
3. T2 dusk congestus sea in flight (needs 9-D and the library)
4. T3 valley sea (needs the terrain hook in the sky layer)
5. T7 time of day
6. T6 pileus tunnel hero (needs Phase D)
7. T5 storm polish: rain shaft and darker base

| Pass (per target) | Fail | Can defer |
| --- | --- | --- |
| Side by side against the slide and 3–5 owner photos, kept local. The review names three or more matching features and the remaining gaps. 60 fps at 1440p on high. **You sign off T1 and T4** to set the bar | Reads as "CG clouds" next to the photo, or needs per-scene shader hacks rather than presets and data | T5, T6 |

## Phase C: light and colour from photos and the comparison page (Phase 12 plus photo calibration)

| Task | Pass | Fail | Can defer |
| --- | --- | --- | --- |
| **C1 Sunset and low-sun colour.** Targets come from photo-sampled sRGB ranges for bases, tops and sky near and away from the sun | Our sunset bookmark falls inside the photo ranges. On the comparison page, ours no longer reads weakest at sunset | Grey or cyan undersides at low sun | Night and moonlight |
| **C2 Distance haze and horizon** | Far clouds fade into aerial perspective like the photos and Takram, with no hard band or speckle at the horizon | A visible band, speckle or hard edge | Planet curvature |
| **C3 Photo comparison mode.** The compare page gets a "photo" pane that loads a local reference image, never committed | Usable for every species and scene review | n/a | n/a |

## Phase D: sharper hero clouds (Phase 13, WebVDB)

These are tasks H1–H7 from `work/specs/P8-hero-vdb.md`: a 4 m sparse profile layer, NanoVDB on disk, a brick pool at runtime.

| Pass | Fail | Can defer |
| --- | --- | --- |
| A library hero at 4 m shows crisp 5–20 m lobes close up, next to the 8 m version. The march costs ≤ 5% more inside heroes and ≤ 3% with no hero on the ray. About 2–3 MB per hero on disk | Soft at close range, or a visible seam between fine and coarse | Movable instanced heroes (H5), 2 m |

## Phase E: devices and release

| Task | Pass | Fail | Can defer |
| --- | --- | --- | --- |
| **E1 Devices.** The owner's laptop (this Mac) is the device target; all desktop numbers are measured on it. Phones are deferred by the owner (2026-10-09); the iOS Simulator has no WebGPU adapter | Laptop budgets above | n/a | Phones (deferred) |
| **E2 Publish.** npm names and scope, repo URL, docs site live, gallery and thumbnails refreshed | `npm publish --dry-run` green; docs site deployed; gallery current | n/a | n/a |

E1 and E2 **need you**: the devices, the names and the repo URL.

## Order and parallelism

- Now: 9-C2, then 9-C3. 9-E can start in parallel; it needs only the sky layer once C2 releases it.
- Phase C1 and C2 (colour, haze) run in parallel with 9-D: different files (lighting and atmosphere versus generate).
- T1 starts when 9-E lands. Phase D runs alongside from the start on its own files (`runtime/hero/*`, scripts).
- Models: Opus for engine and visual work, Sonnet for research and scoped tasks, Haiku for mechanical work, and Fable only when Opus struggles.
