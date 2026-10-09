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

## Direction change (owner, 2026-10-09 evening): hybrid, experiment first

The owner judged that after Q2 we are still far behind Takram, Sky Pro and the photos.

**Diagnosis:** the weak link is our invented procedural NVDF generator for sky-wide clouds. Nubis³ assumes artist- or sim-made fields; we had none, so agents improvised the shapes. Takram and Sky Pro use the mature HZD-style per-sample procedural density: weather/coverage map, height profiles, and tiling Perlin-Worley shape and detail noise.

**Decision: a hybrid.**
- Sky-wide clouds move to a proven procedural density model in our runtime. It follows Takram (MIT) and Sky Pro (MIT, author's permission) rather than our own invention.
- Our architecture stays: API, shadows, sunset lighting, haze, temporal resolve, tooling.
- The Nubis³ voxel path stays for authored heroes, storms, VDB import and 4 m fine detail.

**Owner clarification:**
- Build the procedural model from our papers (HZD 2015, Nubis 2017, Nubis Evolved 2022, Frostbite 2016 and the rest in `docs/research/`). Takram and Sky Pro are implementation examples.
- It is a **stopgap** for sky-wide quality while the owner works through our authoring issues in the newer Nubis³ methods.
- Nothing built so far is removed: the NVDF path, generator, species, library and heroes all stay, and the procedural model is a parallel, switchable `densityModel`.

**Sky Pro code is usable (owner, 2026-10-09):** Sky Pro's noise and shaping code (MIT, the author's permission) may be ported directly into the procedural model, with a licence header and a NOTICE. That replaces the earlier "visual reference only" caution.

**Our generator is paused, pending framing.** The owner noted it "doesn't have the direction it needs", so it will keep producing bad results until the problem is framed better. Before more generator work, hold a framing session with the owner to settle:
- what the generator is for: sky-wide fields, hero and authored fields, or weather-to-NVDF for Nubis³;
- what its inputs are: painted or derived weather and type maps, a library, sims;
- how success is judged: photo-matched targets per species and scene.

**Experiment first:**
- **X1:** the procedural model in our runtime, A/B against our generated field and Takram.
- **X2:** make the Sky Pro reference pane faithful to the real Tidewater demo.
- Phase 9 generator work (9-D, species tuning) pauses until X1 reports.

## Authoring loop: target-driven (owner, 2026-10-09)

**Scene goal (pass/fail by the owner):** recreate the owner's photo "Texas afternoon". It has:
- a cirrus/cirrostratus veil;
- a dark shaded cumulus mass at top right;
- a connected mediocris band from the left;
- a congestus hero tower with a cauliflower crown and flat base;
- a field of humilis at the horizon;
- fractus scraps.

The photo is local only; its path is held by the owner. It is shared in session as `images/1.jpg`; copy it into `artifacts/research/cloud-photos/` as the canonical target.

**Stretch goals:**
- `cloud-photos/altocumulus/A_20230101-085048_7620B8FE.jpg`: a sheared, fibrous sunset wisp, lit from below.
- `.../A_20211022-122749_D057D7E4.jpg`: a moonlit altocumulus/stratocumulus mesh with a corona. Needs moonlight.

**Loop:**
1. **Target cards** from photo crops: silhouette, aspect, base flatness, lobe spectrum, edge sharpness, lit:shadow, connectedness.
2. **Optional extra views and a 3D seed** via fal.ai (owner-funded): nano-banana edit, FLUX Kontext, image-to-3D. Pilot first.
3. **Houdini sim recipe** built from the card or seed. About 20 variants.
4. **Auto-match:** render with a matching camera and sun, score against the card, show the top 5 to the owner.
5. **Owner picks** and adds notes; the recipe is refined.
6. **The tools grow** whenever a target needs a missing parameter or stage.
7. **Compose the scene;** compare against the photo in the compare-page photo pane.

**Two parallel tracks:**
- A surface-detail track: renderer erosion and noise tuned against close-up photo and slide crops.
- Deck slides used as judgement references for T1–T7.

**Distance tiers:**

| Distance | Technique |
| --- | --- |
| Near / fly-through | Voxel (authored, composed) |
| Mid and far, most of what is seen from the ground | Procedural 2.5D |
| High clouds | 2D cirrus layer |
| Very far | Impostors/billboards of library clouds (Sea of Thieves-style), a new item |

## Priority (owner, 2026-10-09): quality first, performance later

**What quality means now (owner, 2026-10-09 night):** our biggest issues are **shape, layering, and surface noise/detail**. Lighting is adjustable later and is not the current focus. Takram is the benchmark for shape only, **not for lighting**: don't tune or judge our lighting against Takram's. The papers (HZD 2015, Nubis 2017, Nubis Evolved, the 2021 survey and others) describe many procedural shaping methods, some with code; mine them for shape and layering before inventing.

Our clouds still don't match the WebGL work we are building on (Takram, Sky Pro) or the photos. Until they do, **visual quality comes first.**
- Performance budgets are guards against regressions, not goals. Keep demos at interactive rates on the owner's laptop, and don't let any change more than double a pass without a reason.
- The budget model below and the scheduler work (S1) still stand. They come after look parity.
- Order: look parity and the species, then scenes, then hero detail, then performance (9-C3 follow-ups, S1, ray reconstruction).

## Never acceptable (all phases)

- A pattern a person can see: clones, lattices, cylinders or box outlines.
- A frame stall: background work (bake, regeneration, light grid, shadow map) over **10% of the frame budget** at the app's target rate in any single frame. That is 1.7 ms at 60 fps and 3.3 ms at 30 fps. (Before 2026-10-09 this was a flat 1 ms; the owner asked for it to be relative.)

**No package size cap (owner, 2026-10-09):** "do whatever you need for the packages, it's ok to be big." `check-bundle` is a report only; never cut features or quality for bundle size.

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
