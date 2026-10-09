# Topic guides: map and combined try-next

RS-5, 2026-10-10. The topic guides gather every source's version of a method in one place, with exact numbers, local code pointers, our runtime status (file:line) and a recommendation. They replace re-reading the decks; the per-source detail stays in `../sources/`. Older overlapping notes (`../procedural-shape.md`, `../hzd-nubis-evolved.md`, `../nubis-sources.md`) get "superseded by" lines in RS-6.

**Direction (owner, 2026-10-10).** Master the procedural clouds first (shapes, flows, noise, rendering). Horizon Zero Dawn is the floor and the target, judged with the owner's photos. Takram and Sky Pro are simplified single-type takes on HZD; `packages/runtime/src/procedural/` is ported from them, so it is "where we are", not "what is right". Voxel/Houdini authoring runs in parallel and meets the procedural path later.

## Map: topics → guides → source notes
| Topic | Guide | Main sources (notes in `../sources/`) | Supporting notes |
| --- | --- | --- | --- |
| Density chain: profiles, type tables, coverage, erosion laws, base and detail noise, curl, anvils, per-cloud height, density shaping | [shape.md](shape.md) | gp7, nut, n17, hzd15, ne22, n3 (s17-25, s89-109), hag, noise, tvn, psrd, web18, bou08, syn | `../procedural-shape.md`, `../photo-species-specs.md` |
| Many types and layers in one sky: channel schemes, type blending, altitude bands, cirrus, far-field ring, envelope layers, voxel heroes in a procedural sky, multi-body scenes | [layering.md](layering.md) | hzd15, gp7, n17, nut, ne22, n3 (s14, s46, s162-173), hfw, web18, hag | `../deck-scenes.md`, `../native-implementations.md`, `../photo-species-specs.md`, `../frostbite-yusov-hogfeldt.md` |
| Weather maps: generation, painting, states and scheduler, wind and skew, map advection, evolution | [weather.md](weather.md) | n17, hzd15, nut, ne22, hfw, hag, web18, gp7 | `../cloud-motion-ideas.md`, `../survey.md` |
| Surface detail: voxel up-rez, wispy/billowy composites in depth, HHF fold, near-camera soften, step size and sampling, metre-scale rim, directional detail | [surface-detail.md](surface-detail.md) (written in parallel by another agent; its try-next list is **not yet merged** into the top 15 below) | n3 s75-109 and s135-160, syn, bou08, noise, psrd | `../cloud-motion-ideas.md`; shape.md §6 and S5/S10 hand over to it |
| Authoring: Houdini sims, the noise generator, the voxel pack, EmberGen pack, Atlas-style compositing, stamps, hero layout | `authoring.md` (**placeholder, not written yet**; another agent) | n3 s61-74 and s161-186, noise, ne22 p.107-109 | `../cloudpack-embergen.md`, `../volume-assets.md`; layering.md §7 / L8 hand over to it |
| Lighting, performance | later (`lighting.md`, `perf.md`) | | |

Runtime paths used in every guide (`packages/runtime/src/`): **P** `procedural/` (Takram and Sky Pro shapers), **G** generator + sky layer (our species level set into the N3 up-rez), **V** voxel up-rez (N3 s109 port). None of them runs the HZD chain today.

## Reference frames
The A/B targets every try-next item is judged against. Paths are local (`artifacts/research/extracted/<id>/` or the source PDF/pptx); photos are under `artifacts/research/cloud-photos/` with picks in `../photo-species-specs.md` §13.
- **HZD 2015 build steps and maps:** hzd15 p037-p039 (shape → base fade → erosion), p042-p048 (minimap R/G/B with the matching sky), p047 (15/35 km ring), p049 (painted cutscene gradient), p089 (cirrus textures).
- **GPU Pro 7 stages:** Fig 4.13 → 4.14 → 4.16 [p.106-109] (base, with coverage, with detail); Fig 4.10-4.11 (gradients and the clouds they give).
- **Nubis 2017:** p.30-32 (type strips with in-game renders), p.37-39 (noise stages), p.41-44 (coverage inflation), p.46-50 (anvil), p.54-58 (map construction), p.64-68 (authored maps).
- **Nutshell:** s8, s12 (gradient × coverage, no noise), s14 (with noise), s16-20 (maps with matching skies).
- **NE 2022:** p.22, 26, 28 (type tables), p.23-25, 27, 30 (type renders), p.35-36 (final), p.64-68 (2.5D cirrus), p.109, 114 (valley caps).
- **Nubis Cubed:** s17/s21/s24 posters `image28`-`31` (before/after erosion, both 2.5D methods), s25 video 2, s29, s31, s37 `image55`/`56` (in-game HFW cumulus: the HZD floor), s96/s99/s101 (noise composites), s162-167 (hero layout).
- **Häggström:** fig 9 vs 11 (shape only vs with detail), fig 12-13 (anvil with and without the density fix), fig 69 (coverage 0.3 / 0.65 / 1).
- **Owner photos:** humilis (w:h 2.3, base wobble 0.09, 5:1 sizes), mediocris (w:h 1.7, 2-4 domes, satellites), congestus (cone 0.5-1.1 w:h, 3-6 domes per flank, 5-25° lean, pedestal 1.5-3x), cumulonimbus (anvil 2-4x the column), altocumulus (spacing CV 0.5-0.8, 1.5:1 elongation), cirrus (streaks 1-5 % wide, 15-60 % long).

## Combined top 15 (shape, layering, weather)
Ranked by how directly each moves us to the HZD floor. Details, files and acceptance are in each guide's table.

| Rank | Item | Guide | Why | Risk | Needs |
| --- | --- | --- | --- | --- | --- |
| 1 | **Bake the HZD noise set** (Nubis-recipe 128^3 RGBA, periodic; 32^3 detail; 128^2 curl) | [shape S2](shape.md#try-next-ranked-for-the-board) | Prerequisite: our Takram texture is one 8-bit channel of unknown recipe | L-M | — |
| 2 | **`hzd` reference shaper** in `procedural/`: gp7 chain, nut trapezoids by type, HFW coverage sign, base fade before erosion, `h*10` switch, curl on detail only | shape S1 | We cannot show HZD today; fixes the dome profile, mushy billows, torn silhouettes, 2D-envelope blobs | M | 1, 3 |
| 3 | **Weather layout decision** (NDF A: coverage, top type, bottom type, rain; NDF B: min/max height) | [layering L1](layering.md#try-next-ranked-for-the-board) | Sources disagree on G; every later item reads these channels | L | **owner** |
| 4 | **A real map for P**: N17 gate × footprints + type, and G's weather v2 as the second arm | [weather W2](weather.md#try-next-ranked-for-the-board) | Sky Pro's Perlin continent has no islands, clusters or types | M | 3 |
| 5 | **One volumetric shell with continuous type** (+ 2D high layer) instead of four summed layers | layering L2 | Overlap smear; no stratus-to-cumulus across the map | M | 2 |
| 6 | **Map-advection policy** as a setting (Nubis static / rigid / split) | weather W1 | Motion reads wrong either way; the owner's time-lapses decide | L | **owner** |
| 7 | **Top × bottom LUTs** (s18 CSVs) in the sky layer, independent bottom type | shape S3 | No tiered tops; base raggedness tied to species | M | 3 |
| 8 | **Erosion-law A/B**: HZD additive (inverted N3 noise) vs ValueErosion | shape S4 | Flat textureless cores in distant bodies | L | owner judges |
| 9 | **Nubis defaults** for `wispyBias` and `detailBias` (0, 0) | shape S5 | Bases forced wispy twice; billows cut 1.5x deep | L | — |
| 10 | **Anvil**: N17 exponent (clamp switch) + Häggström density fix | shape S7 | No anvils outside the hand-built storm cell | L | 2 |
| 11 | **Precipitation → cumulonimbus override** with rain absorption | layering L3 | No storms or dark rain bases in the procedural sky | M | 3 |
| 12 | **Far-field ring with the type half** in P | layering L4 | Horizon empties or goes uniform | L | 2 |
| 13 | **Weather states + scheduler + bias panel** (10-30 s lerps; coverage ±0.5, type ±1, rain ±1, cirrus density) | weather W3 + W4 | No weather change, no art direction | L | 4 |
| 14 | **Mid layer**: altocumulus / stratocumulus bands with anisotropic stretch and jittered cells | layering L5 | Alto absent in P or a polka-dot lattice | M | 5 |
| 15 | **Paint / influence override** + sphere-stamp brush + painted-gradient mode | weather W5 | Cannot compose a hero sky or place a hole | M | **owner** (tool UX) |

Just below the line: skew and per-texture speeds (weather W6), per-cloud height/density (shape S8), curl on detail in the Takram baseline (shape S6), cirrus `cov^3` and type map (layering L6), finer 2.5D steps (shape S9), lifecycle α (weather W7).

**Fix regardless (bug, not research):** the near-detail gate on low/mobile tiers cuts N3's 50-150 m ramps mid-way, leaving a density discontinuity shell around the camera (`shaders/march.wgsl.ts:218`, `runtime.ts:73-74`; n3.md §7d). Belongs to [surface-detail.md](surface-detail.md).

## Source conflicts that need the owner
1. **What weather G means.** Precipitation (hzd15 s40, gp7 p.103), a second coverage footprint (n17 p.53-56, nut s16), fill coverage (hag eq 4), or our species row. Proposal in layering.md §1; needs a yes before items 2, 4, 7, 11.
2. **Does the weather map move?** Every Nubis talk keeps it still and scrolls the noise (n17 p.45, nut s15, ne22 p.37); Häggström and our P path move it rigidly; the owner's observation says detail is carried with the cloud and should not boil or slide (`../cloud-motion-ideas.md`). HZD stills cannot settle it; time-lapses can.
3. **Which erosion reads as HZD.** The HZD-era remap (n17 p.36, gp7 p.109), the NE additive law (n3 s24, ne22 p.34) and N3's ValueErosion give different cores; the A/B (item 8) needs the owner's eye.

Resolved in the notes (no owner input): the shipped height gradients are the Nutshell stops, the 2015 swatches are an illustration (nut.md, n17.md); bottom type 0 is the crisp base (n3.md §7a); the coverage remap sign is `1 - coverage` (hfw p.17); NE p.99's type switch follows its diagram, billowy above (ne22.md review); the HZD noise is RGBA8, not 2 B/texel (n3.md §7b); the anvil exponent is N17's, not GP7's (gp7.md §4).

Still open, not owner: whether NE's min height maps to h = 0 or to the s18 tables' 0.27 floor (top type 0 alone gives no cloud; shape.md §2); whether N17's anvil exponent is clamped (shape.md §8); the type-blend law and GP7's gradient function body (never published).
