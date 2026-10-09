# Topic guides: map and combined try-next

RS-5, 2026-10-10. The topic guides gather every source's version of a method in one place, with exact numbers, local code pointers, our runtime status (file:line) and a recommendation. They replace re-reading the decks; the per-source detail stays in `../sources/`. Older overlapping notes (`../procedural-shape.md`, `../hzd-nubis-evolved.md`, `../nubis-sources.md`, and others) carry "superseded by" lines (RS-6, done).

**Direction (owner, 2026-10-10).** Master the procedural clouds first (shapes, flows, noise, rendering). Horizon Zero Dawn is the floor and the target, judged with the owner's photos. Takram and Sky Pro are simplified single-type takes on HZD; `packages/runtime/src/procedural/` is ported from them, so it is "where we are", not "what is right". Voxel/Houdini authoring runs in parallel and meets the procedural path later.

## Map: topics → guides → source notes
| Topic | Guide | Main sources (notes in `../sources/`) | Supporting notes |
| --- | --- | --- | --- |
| Density chain: profiles, type tables, coverage, erosion laws, base and detail noise, curl, anvils, per-cloud height, density shaping | [shape.md](shape.md) | gp7, nut, n17, hzd15, ne22, n3 (s17-25, s89-109), hag, noise, tvn, psrd, web18, bou08, syn | `../procedural-shape.md`, `../photo-species-specs.md` |
| Many types and layers in one sky: channel schemes, type blending, altitude bands, cirrus, far-field ring, envelope layers, voxel heroes in a procedural sky, multi-body scenes | [layering.md](layering.md) | hzd15, gp7, n17, nut, ne22, n3 (s14, s46, s162-173), hfw, web18, hag | `../deck-scenes.md`, `../native-implementations.md`, `../photo-species-specs.md`, `../frostbite-yusov-hogfeldt.md` |
| Weather maps: generation, painting, states and scheduler, wind and skew, map advection, evolution | [weather.md](weather.md) | n17, hzd15, nut, ne22, hfw, hag, web18, gp7 | `../cloud-motion-ideas.md`, `../survey.md` |
| Surface detail: voxel up-rez, wispy/billowy composites in depth, HHF fold, near-camera soften, step size and sampling, metre-scale rim, directional detail | [surface-detail.md](surface-detail.md) (its SD1-SD10 are merged into the top 20 below) | n3 s75-109 and s135-160, syn, bou08, noise, psrd | `../cloud-motion-ideas.md`; shape.md §6 and S5/S10 hand over to it |
| Authoring: Houdini sims, the noise generator, the voxel pack, EmberGen pack, Atlas-style compositing, stamps, hero layout | [authoring.md](authoring.md) (its AU1-AU9 are merged into the top 20 below) | n3 s61-74 and s161-186, noise, ne22 p.107-109 | `../cloudpack-embergen.md`, `../volume-assets.md`; layering.md §7 / L8 hand over to it |
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

## Combined top 20 (shape, layering, weather, detail, authoring)
Ranking principle (owner, 2026-10-10): **procedural mastery to the HZD level first** (the noise set, the HZD shaper, profiles, erosion) together with the **detail-visibility fixes** that make everything else judgeable (noise blur constant, step size, the near-detail gate bug); authoring runs **in parallel** from rank 15, and its first items depend on SD1/SD2. Ids are the guides' own (S = shape, L = layering, W = weather, SD = surface-detail, AU = authoring). Acceptance and detail are in each guide's table. Risk L/M/H. "Owner" = needs an owner answer or judgement (see the questions below).

| Rank | Item | Id | Visual failure it fixes | Sources | Files | Owner |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Bake the HZD noise set**: Nubis-recipe 128^3 RGBA (periodic), 32^3 Worley-fBM detail, 128^2 curl. Fold in the RGBA16 / periodic re-bake of the pack noise (SD8, AU7) as a variant | [S2](shape.md#try-next-ranked-for-the-board) (+ [SD8](surface-detail.md#try-next-ranked-for-the-board), [AU7](authoring.md#try-next-ranked-for-the-board)) | Prerequisite for S1: Takram's texture is one 8-bit channel of unknown recipe; 8-bit banding in the HHF fold | noise, tvn, psrd, n3 s90, s103 | new `procedural/noise-bake.wgsl.ts`, `procedural/textures.ts:35`, `resources.ts:45-48` | no |
| 2 | **Noise MIP constant** k 0.01 → 0.0015 (A/B 0.001/0.002/0.005) | [SD1](surface-detail.md#try-next-ranked-for-the-board) | Far clouds look plastic: billow noise filtered to grey beyond ~1.2 km (one number) | n3 s92 | `runtime.ts:427`, check `shaders/sky-layer.wgsl.ts:564` | no |
| 3 | **Fix the near-detail gate** (low/mobile cuts the 50-150 m ramps) | [SD4](surface-detail.md#try-next-ranked-for-the-board) | A dithered density shell around the camera (bug, not research) | n3 s104, s109; n3 §7d | `shaders/march.wgsl.ts:218`, `runtime.ts:73-74` | no |
| 4 | **`hzd` reference shaper** in `procedural/`: gp7 chain, nut trapezoids lerped by type, HFW coverage sign, base fade before erosion, `h*10` switch, curl on detail only. Absorbs SD10 (sky-wide HZD detail) | [S1](shape.md#try-next-ranked-for-the-board) (+ SD10) | We cannot show HZD today: one-dome profile, `.r`-only mush, torn silhouettes, 2D-envelope blobs | gp7 p.103-110, nut s7-13, n17 p.28-40, hfw p.15-17, hzd15 s34-37, hag eq 11-16 | `procedural/density.wgsl.ts`, `settings.ts`, `textures.ts`, `index.ts` | no |
| 5 | **Nubis defaults** for the up-rez art biases: `wispyBias` 0, `detailBias` 0 | [S5](shape.md#try-next-ranked-for-the-board) | Bases forced wispy twice; billows cut 1.5x too deep | n3 s98, s100 | `runtime.ts:425, 432` | no |
| 6 | **Deck step** `max(1, 0.08√t)` inside clouds on high/ultra | [SD2](surface-detail.md#try-next-ranked-for-the-board) | Interior lobes and nested billows undersampled; 20 m features alias past 2.5 km | n3 s150, s108 | `shaders/march.wgsl.ts:110-111` | no |
| 7 | **Curl on detail only** in the existing Takram baseline (until rank 4 lands) | [S6](shape.md#try-next-ranked-for-the-board) | Torn silhouettes under turbulence | hzd15 s37, gp7 p.108 | `procedural/density.wgsl.ts:212-219` | no |
| 8 | **Erosion-law A/B**: HZD additive (inverted N3 noise) vs ValueErosion; optional wisp LF/HF direction A/B (SD9) | [S4](shape.md#try-next-ranked-for-the-board) (+ [SD9](surface-detail.md#try-next-ranked-for-the-board)) | Distant bodies have flat textureless cores; wisp edges possibly too coarse at 100-300 m | n3 s24, s93, s95, ne22 p.34 | `shaders/sky-layer.wgsl.ts:582`, `shaders/density.wgsl.ts:51, 65` | **owner judges** |
| 9 | **Top × bottom LUT mode** in the sky layer (s18 CSVs), independent bottom type | [S3](shape.md#try-next-ranked-for-the-board) | No tiered tops; base raggedness tied to species | n3 s18, ne22 p.21-28, hfw p.53 | `shaders/sky-layer.wgsl.ts:137-166`, `generate/shaders.ts:22-49`, `generate/weather.ts` | no |
| 10 | **Decide the weather layout** (NDF A: coverage, top type, bottom type, rain; NDF B: min/max height) | [L1](layering.md#try-next-ranked-for-the-board) | Every later weather/layer item reads these channels; sources disagree on G | hzd15 s40, gp7 p.103, n17 p.53-56, nut s16, hag eq 4, ne22 p.20 | spec in `work/specs/`; `generate/shaders.ts:229-265`, `procedural/settings.ts` | **owner** |
| 11 | **A real map for P**: N17 gate × footprints + type, and G's weather v2 as the second arm | [W2](weather.md#try-next-ranked-for-the-board) | Sky Pro's Perlin continent: no islands, clusters, types | n17 p.53-58, hzd15 s40-46, ne22 p.70-74 | `procedural/textures.ts:85-104`, `generate/weather.ts` | needs 10 |
| 12 | **One volumetric shell with continuous type** (+ 2D high layer) instead of four summed layers | [L2](layering.md#try-next-ranked-for-the-board) | Overlap smear; no stratus-to-cumulus across the map | hzd15 s73, gp7 p.98-104 | `procedural/settings.ts:150-155`, `density.wgsl.ts:182-200, 227` | no (needs 4) |
| 13 | **Type and density scale from the surface normal** in the converter and Houdini (`nvdf_channels.hip`); applies to the whole library | [SD3](surface-detail.md#try-next-ranked-for-the-board) (+ [AU5](authoring.md#try-next-ranked-for-the-board)) | Undersides and overhangs as crisp as tops; no lacy undercut or skirt; bases forced wispy | santa D2, D8; frog F3, F5, F6; syn s28; bou08 p.2 | `scripts/vdb/nvdf_math.py:252-262`, `scripts/vdb/vdb_to_nvdf.py`, `runtime.ts:425` | **owner** (lead direction per asset) |
| 14 | **Anvil**: N17 exponent with clamp switch + Häggström density fix | [S7](shape.md#try-next-ranked-for-the-board) | No anvils outside the hand-built storm cell | n17 p.46-50, hag eq 17-18 | rank-4 shader | no |
| 15 | **Frog with the 20.0 cloud nodes** (3-level sphere hierarchy, no baked fine noise, type/scale from normal; save `frog.hip`); includes SD5 | [AU1](authoring.md#try-next-ranked-for-the-board) (+ [SD5](surface-detail.md#try-next-ranked-for-the-board)) | Heroes lack a 3.5× lobe ladder; flat bases everywhere; baked noise the 8 m grid cannot hold | frog §1-5; n3 s66, s77-79 | `scripts/vdb/authoring/` (`sculpt.py` or `build_heroes.py`), `vdb_to_nvdf.py` | **owner** (Frog scale, head) |
| 16 | **Lens-seed Pyro test** (flat lens, burst, raised temp diffusion/cooling, shredding) | [AU3](authoring.md#try-next-ranked-for-the-board) | L2 chimneys; no flat-based grown heap | n3 s64, s179; cloudpack-embergen.md | `sim/sim_clouds.py`, `sim/library.py` | no |
| 17 | **Rigs the owner can open**: `rigs.py` writes builders as `.hip` with a `CONTROLS` null | [AU2](authoring.md#try-next-ranked-for-the-board) | The owner cannot inspect or fix what agents built | owner request | `scripts/vdb/authoring/rigs.py`, `houdini/rigs/` | **owner** (location, commit .hip?) |
| 18 | **Metre-scale rim pass** `S((−sdf + A(n−0.5))/w)` within ~2 km (G/V) | [SD6](surface-detail.md#try-next-ranked-for-the-board) (= S10) | No cotton fuzz on lit edges; bump size not tied to cloud size | bou08 p.7; frog F1-F2 | `shaders/density.wgsl.ts` after `:65`, `shaders/volume.wgsl.ts` | no |
| 19 | **Weather states + scheduler + HZD bias panel** (10-30 s lerps; coverage ±0.5, type ±1, rain ±1, cirrus density) | [W3 + W4](weather.md#try-next-ranked-for-the-board) | No weather change, no art direction | n17 p.59-72, nut s20, hzd15 s38-45 | new `procedural/weather-state.ts`, `procedural/settings.ts` | no (needs 11) |
| 20 | **Map-advection policy as a setting** (Nubis static / rigid / split) | [W1](weather.md#try-next-ranked-for-the-board) (+ [SD7](surface-detail.md#try-next-ranked-for-the-board) volume-local anchor) | Motion reads wrong either way: rigid stamps slide, Nubis detail streams through still forms | n17 p.45, nut s15, ne22 p.37, hag p.34, `cloud-motion-ideas.md` | `procedural/density.wgsl.ts:90, 98, 191, 213`, `procedural/index.ts:139` | **owner** (time-lapses) |

**Just below the line** (in rough order): precipitation → cumulonimbus override with rain absorption (L3, needs 10); far-field ring with the type half in P (L4, cheap); Santa's Sleigh sculpted scene (AU4, H risk, needs owner answers and 13/15/16); grown arm and ragged stage (AU8); composite-time stamp edits (AU6 = L8); Z-up converter option (AU9); altocumulus mid layer (L5); paint/influence layer (W5, owner tool UX); skew and per-texture speeds (W6); per-cloud height/density (S8, needs 10); finer 2.5D steps (S9); lifecycle α (W7); cirrus to NE p.65 (L6); σ squash (L9); envelope layer for valley fog (L7, owner photos); superstorm stencil (W8).

Dedup notes: SD10 is S1 + S2 + S6; SD5 is the rung-1/2 part of AU1; SD6 is S10; AU5 is the library-wide form of SD3; AU6 is L8's authoring half; AU7 is SD8.

## Questions for the owner (from the five guides, deduplicated: 12)
Grouped by what they unblock. Source ids in brackets.
1. **Weather channel layout.** Which meaning for G (precipitation as in HZD/GP7, a second coverage footprint as in N17/Nutshell, fill coverage as in Häggström, or our species row)? Accept the proposal NDF A = coverage, top type, bottom type, precipitation; NDF B = min/max height? Unblocks ranks 10, 11, 12, 19 and L3, S8 [L1; layering §1; old conflict 1].
2. **Does the weather map move?** Nubis keeps it still and scrolls noise through it; ours moves it rigidly; your observation is that detail is carried with the cloud. Can you supply 2-3 time-lapses (a cumulus crossing, a dissipating one) to judge static / rigid / split? [W1; old conflict 2].
3. **Which erosion reads as HZD?** HZD remap, NE additive, or ValueErosion cores; and which wisp LF/HF direction at 100-300 m. You judge the A/B stills [S4, SD9; old conflict 3].
4. **Lead / shear direction per asset** for the normal-based type and scale: from the weather wind, the asset's own lean, or painted? [SD3, AU5].
5. **Distance of interest for surface detail:** judge at the photos' 4-12 km (SD1/SD2 matter most) or close fly-bys under 1 km (4 m overlay, HHF)? Both are planned; the order changes [surface-detail Q1].
6. **How crisp is crisp?** Lit edges are 3-12 m, only 1-3 pixels at 5-10 km. Is a slightly soft far edge acceptable if 1 km views are crisp? [surface-detail Q3].
7. **Frog scale:** was the pano merged at native scale (no reduction)? Every metre figure and the SD5/AU1 sculpt depend on it [SD5, AU1; frog Q4].
8. **Santa domain:** one dense grid at 16 m (~200 MB, authored at 8 m) or per-body volumes (runtime work, one volume bound today)? Is the main body's H about 1.5 km, or scale the scene to a known base height? [AU4; authoring Q1].
9. **Sculpted first or grown first?** The plan sculpts the bodies (deterministic, editable) and grows only the arm. Grow the main in a sim instead, accepting less control? [authoring Q2].
10. **Rigs in git?** Commit `.hip` networks under `houdini/rigs/` (small, Indie-flagged) or keep them local and commit only the builders? [AU2; authoring Q3].
11. **Paint tool UX** for the weather override and sphere-stamp brush: a small page in the repo, or inside an existing tool? [W5].
12. **Valley-fog / envelope layer:** do you want it, at what priority, and can you supply valley-fog photos (we have none)? [L7].

## Questions from the target studies (12)
Santa's Sleigh (`../targets/santa-sleigh.md` §7):
1. Sketch orientation: where were you standing and which way does slide 4 face? (Head nearest, main about 1.5x farther, line receding right at about 34 degrees; fits the sketch only if the camera is at its right edge.)
2. Direction of travel: all loose turrets lean up and toward the head (30-48 degrees). Was the formation drifting image-left and away? (Angular size shrank 15% in 5 minutes.)
3. The catch-up: the main's left edge did not move relative to the line (within about 1 degree). Did the main overtake, or the pieces grow into it? Any video?
4. Are `congestus/A_20220729-173330_DSC00669` and `-173342_DSC00678` this formation 5 minutes after `end`?
5. Is `end.jpg` cropped? It is a 2048 px export dated 2022-08-02; the original `DSC00629` would confirm the 40 mm scale.
6. The early boxes: is the unboxed ragged right third (x 677-885 of 1600) of the left cloud what became the link, or the arm?
7. Is the slide-4 "trail of small blobs" the arm plus the free puffs between the link and the main?
8. Roughly where were you, which way facing, and is the base height known? That turns every distance into metres.

Frog (`../targets/frog.md` §6):
9. What makes it a "frog", and which part is the head? That sets which silhouette features matter most.
10. Are the satellites breaking off the main or growing toward it? (Satellite 1's frayed edge suggests decay; any video?)
11. Is satellite 2 a separate cloud farther away, or attached and lower?
12. Was the pano merged at native scale (no reduction)? Same as question 7 above.

## Source conflicts, settled and open
Settled in the notes (no owner input): the shipped height gradients are the Nutshell stops and the 2015 swatches are an illustration (nut.md, n17.md); bottom type 0 is the crisp base (n3.md §7a); the coverage remap sign is `1 - coverage` (hfw p.17); NE p.99's type switch follows its diagram, billowy above (ne22.md review); the HZD noise is RGBA8, not 2 B/texel (n3.md §7b); the anvil exponent is N17's, not GP7's (gp7.md §4).

Open, not owner: whether NE's min height maps to h = 0 or to the s18 tables' 0.27 floor (top type 0 alone gives no cloud; shape.md §2); whether N17's anvil exponent is clamped (shape.md §8); the type-blend law and GP7's gradient function body (never published).
