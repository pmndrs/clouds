# Plan: cloud variety, ground shadows and deck-scene replicas (2026-10-09)

Follows `docs/AUDIT-2026-10.md`, where Phases 0–8 are recorded. Source research: `docs/research/deck-scenes.md`,
which catalogues both of Schneider's decks with slide references.

## Problem

1. **Every generated cloud is the same blob.** The generator has one recipe:
   - a dome from coverage;
   - cells of about the same size;
   - the same billow noise and height profile everywhere;
   - bases that vary per cloud, where real cumulus share one condensation level.

   The sky reads as cloned copies. The decks get their variety from **composition**:
   - separate authored sources "frankenclouded" together [N3 s3, s63–65];
   - three altitude layers;
   - per-cloud wispy and billowy channels;
   - re-posed instances [N3 s169];
   - silhouettes hand-composed against the sun arc [N3 s162].
2. **Ground shadows are partial.** The composite pass shadows opaque pixels only where the sun ray crosses the voxel
   box, by reading the coarse light grid. Clouds in the 2.5D sky layer, which is most of what you see, cast nothing.
   The decks describe no ground-shadow technique. Their only statement is "Terrain-Cast Shadows: vertical profile No,
   envelope Yes, voxel Yes" [N3 s173, s190], so we design our own.
3. **We can't yet show the scenes from the talks.** We lack these cloud types:
   - stratocumulus and altocumulus bands;
   - cirrus;
   - valley cloud seas;
   - towers with caps and skirts.

## Never acceptable (all phases)

- One shape recipe stamped across the sky.
- A frame stall when weather, sun or presets change.
- Quality judged only by numbers: every phase ends with captures the orchestrator reads.
- Work left uncommitted.
- Committing slide images. They stay in `work/captures/scratch/` (gitignored).

## Phase 9: shape library and variety

**Goal:** a sky of clouds that differ in size, species, height and silhouette, with flat shared bases and layering.

| Task | What | Success measures | Acceptable to defer |
| --- | --- | --- | --- |
| 9-A Variety metrics | `scripts/variety.mjs` scores a cloudscape from the harness. **Footprint statistics:** top-down coverage, connected components, the size distribution and its coefficient of variation (CV). **Base flatness:** the base altitude spread per layer. **Clone score:** median normalised cross-correlation between silhouette crops of different clouds from a side view. | Runs on any page via the capture contract. It scores today's cumulus as failing, as a sanity check. | Automated species classification |
| 9-B Weather v2 | Multi-scale weather. Cluster scale (2–8 km) sets where clouds are; cell scale sets individual clouds; a sub-cell term splits lobes. A species channel varies by region. One condensation base per layer (±15 m jitter). A wind-shear vector. Fractus bits near larger cells. | Cumulus preset: footprint CV ≥ 0.7. Largest-to-smallest footprint ratio ≥ 10 (ignoring < 2 voxels). Base spread within a layer ≤ 30 m. No peak at the cell spacing in the coverage autocorrelation. | Per-region authored maps (procedural first) |
| 9-C Species profiles | Height and shape profiles per species, selected by the type channel. Cumulus humilis, mediocris and congestus. Stratocumulus as sheared, elongated bands. Altocumulus as a higher layer of small cells. Stratus and valley sea: terrain-aware with a flat top. The cumulonimbus already exists (P6-C). | Each species is recognisable in an isolated capture; the orchestrator reviews the contact sheet. Three or more species coexist in one sky with distinct silhouettes. Clone score ≤ 0.6. | Lenticular, mammatus, shelf (not in the decks) |
| 9-D Shape detail | Multi-scale lobes: turrets, then billows, then small cauliflower. A per-cloud growth state sets whether a cloud is rising (crisp billows) or decaying (wispy). Detail type driven by edge and age, not only height. | A close view of three neighbouring clouds shows different lobe scales and edge character. Cost stays within +0.3 ms. | Animated growth per cloud (P6-A covers time) |
| 9-E High layer | Cirrus and cirrostratus in the 2.5D sky as a thin fibrous layer with its own altitude and wind. | Cirrus streaks read from the ground at midday and sunset. Cost ≤ +0.3 ms amortized. | Contrails, halos |
| 9-F Authored library | Batch Pyro-sim recipe (P4-F) with seeds and parameters giving 12–20 hero clouds of varied species and sizes. Stamped with random transforms, scale and yaw, as frankenclouds. | Library builds unattended in Houdini. A stamped field of 30+ library clouds shows no visible repeats from three bookmarks. Each cloud under 4 MB. | Hand-sculpted heroes |

**Phase 9 passes** when the cumulus, stratocumulus and mixed presets pass 9-A's numbers and the orchestrator's contact
sheet review finds no "cloned wall". The high tier must stay ≤ 3.5 ms at 2560×1440 on desktop.

## Phase 10: ground shadows for every cloud

| Task | What | Success measures | Acceptable to defer |
| --- | --- | --- | --- |
| 10-A Cloud shadow map | A sun-space 2D texture of optical depth along the sun, covering the voxel region and the sky layer out to the horizon. Two cascades: near (≈ 8 km at 8 m texels) and far (≈ 60 km). Refresh is amortized over frames and invalidated on sun or weather change. | Shadows from sky-layer clouds appear on ground and water. A projected-outline overlay matches the cloud silhouettes within 2 texels. Cost ≤ 0.3 ms amortized and ≤ 1 ms on a refresh frame. No swimming when the camera moves. | Coloured transmittance; cascade blending polish |
| 10-B Renderer integration | `cloudShadow(worldPos)` as a three TSL node for lit materials, so it dims direct sun only and keeps ambient. Plus a raw-WGSL sampler for other renderers. The composite-alpha path stays as the fallback. | Terrain, ocean and onsen scenes show moving cloud shadows that dim sunlight but not sky light. The plains flight shows shadows racing over fields. | Shadowing transparent objects |

## Phase 11: deck-scene replicas

Each target is a lab page with a matching camera, time of day and composition. It is judged side by side against its
slides; the reference crops stay local. Targets come from `docs/research/deck-scenes.md` §4.

| Target | Slides | Exercises | Pass |
| --- | --- | --- | --- |
| T1 Fair-weather cumulus field with a cirrus veil | N3 s25, s29, s31, s168 | 9-B, 9-C, 9-E, 10 | Size variety and flat bases match. Shadows move over the terrain. Cirrus present. |
| T2 Dusk congestus sea, flight view | N3 s52, s67, s158 | 9-D, 9-F, lighting | Towers at several heights; backlit inner glow and silver lining. Reads like s158 at a glance. |
| T3 Orographic cloud sea in valleys | N3 s40–42, s57 | 9-C stratus, terrain | Flat-topped sea pooled between peaks, with soft edges at the cliffs. |
| T4 Layered sunset bands | SY s67, N3 s37, s110 | 9-C stratocumulus/altocumulus, 9-E | Two or more layers, sheared bands with gaps, warm underlight. |
| T5 Cumulonimbus with lightning | N3 s130, s156 | P6-C, rain shafts | Exists. Add a rain shaft and a darker base. |
| T6 Tall-neck hero with cap and tunnel | N3 s66, s77–81, s163–166 | 9-F, SDF cutout, P8-E heroes | Pileus cap and a fly-through tunnel with no popping. |
| T7 Time of day on one cloudscape | N3 s131–133, s168, s169 | everything | Midday, sunset, dusk and night with no flicker; consistent shapes. |

**Pass for each target:** the orchestrator writes a side-by-side review naming three or more matching features and the
remaining gaps. The owner signs off on the first two targets to calibrate the bar. 60 fps at 2560×1440 on high.

**Fail:** a target that still reads as "cloned blobs", or needs per-scene shader hacks rather than presets and data.

Order: T1 → T4 → T2 → T3 → T7 → T6 → T5 (T5 mostly exists).

## Phase 12: comparison-driven tuning

The P8-A comparison page (ours, Sky Pro and Takram at four bookmarks) produces a gap list. Each gap becomes a task with a
before/after on the same page. **Pass:** for each bookmark, the write-up no longer names our pane weakest on shape
variety, horizon coverage or sunset colour.

## Phase 13: sparse hero storage (spec: `work/specs/P8-hero-vdb.md`)

**Recommendation:** keep the regional 8 m field. Add a sparse layer that carries only the dimensional profile:
- **Resolution:** 4 m by default, 2 m opt-in for one showcase hero.
- **Wire format:** a NanoVDB Fp8 file `fine.nvdb` next to `nvdf.bin`/`sdf.bin`.
- **Runtime format:** a brick pool (10³ bricks with an apron) plus an indirection grid over the regional volume.
- **Sampling:** read in `cloudDensity` only, with one load and one trilinear fetch: 1.16–1.20× a plain fetch, measured. The NanoVDB tree is never marched on the GPU, which would cost 2.2–2.7×.
- **Kept at 8 m:** detail type, density scale, SDF and the light grid. Q-1 self-shadowing already reads the fine field.
- **Size:** about 2.3 MB on disk per 700 m hero at 4 m, against 22–29 MB dense. The core bundle grows by about 1.5 KB gzip.
- **WebVDB:** we use its CPU reader and its `buildFromVdb`/`quantize('fp8')`/`writeNvdb`. It is vendored with a NOTICE until it is published; our parser additions go upstream.

| Task | What | Size |
| --- | --- | --- |
| H1 | Runtime overlay (brick pool, indirection, `sampleModelingHero`) and a test page | M |
| H2 | Converter `.vdb → fine.nvdb` (`vdb-to-nvdb.mjs`, hython path) | M |
| H3 | Loader and static stamping with snapped transform | M |
| H4 | In-browser importer export | S–M |
| H5 | Instanced movable heroes (≤ 4): instance atlas, per-hero transform, SDF min | L (Fable) |
| H6 | Tiers (off on mobile and low), art, captures, docs | S–M |
| H7 | Upstream parser additions to WebVDB | S |

Order: H1 ∥ H2 → H3 → H4 ∥ H6 → H5. Acceptance measures are in spec §7 and risks in §8.

**Defaults taken, pending the owner:**
- 4 m everywhere, with 2 m for one hero.
- rgba8 pool now, r8 later.
- Vendor WebVDB until it is published.
- H5 deferred until the static heroes land.

## Order and parallelism

- 9-A first; it is the yardstick.
- 9-B and 10-A in parallel: different files.
- Then 9-C, 9-D and 9-E.
- 9-F runs in Houdini in parallel throughout.
- Phase 11 targets start as soon as their dependencies land: T1 after 9-B, 9-C and 10-A.
- Phases 12 and 13 run alongside.
