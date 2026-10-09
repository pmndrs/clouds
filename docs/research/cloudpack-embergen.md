# EmberGen CloudPack (RS-V): inventory, shape read, loader test

Owner-supplied pack: `artifacts/research/vdbs/CloudPack/` (not copied here). Ten density VDBs (`cloud_NN_variant_0000.vdb`),
the EmberGen project `cloud_generator.ember`, `cloud_pack_seeding.png`, `cloud_pack_thumbnails.png`, `cloud_pack_evolve.mp4`.
Scripts and outputs: `artifacts/research/extracted/cloudpack/` (`scripts/`, `thumbs/`, `inspect.json`, `shape_metrics.json`,
`ember_params.json`). Local only.

## Findings first

1. **The pack is ten seeds of one recipe.** `cloud_pack_seeding.png` is just Project Settings > General > "Randomize All Seeds".
   There is no per-cloud design; shape variety comes from the noise seeds (force noise, shape noise, emitter divergence noise,
   volume modulation noise). All ten share domain, emitter, solver values and export frame (161, single frame).
2. **What seeds them: a thin, flat, noise-edged lens.** One Ellipsoid primitive, radii (20.3, 46.0, 4.0) units
   (= 81 x 184 x 16 sim voxels at 0.25 units, i.e. x:y:z about 5 : 11.5 : 1, thickness 1/10 of the long axis), smooth-intersected (smoothness 10) with a Noise shape (scale 28).
   The emitter fills that shape (temperature/fuel tightness 100) for a short burst. This is the Guerrilla "thin, flat lens" seed
   (`docs/research/sources/n3/slides-047-074.md`, s64) reproduced independently in a different solver. `cloud_pack_evolve.mp4` shows it:
   a flat wisp grows into the flat-based cumulus (the export is frame 161; at the project's timestep 60 that is probably about 2.7 s of sim time).
3. **That is what L2 was missing.** L2 found that hot-spot emitters with working buoyancy make 330-530 m chimneys and listed "filled, wider
   sources" as the next step. EmberGen's answer is exactly that, plus a one-shot burst (`burst_duration` 0.5, `burst_interval` 0), strong heat
   diffusion and cooling (so the plume cannot run away), heavy smoke, and high vorticity confinement. No lid, no stretch, no post warp.
4. **Resolution is the other big difference.** The sim domain is 416 x 640 x 224 voxels; the clouds are 134-169 voxels tall. Our L1 sims are
   36 m voxels, so a 400-1000 m cloud is 11-28 voxels tall. The cauliflower lobes here are 20-40 voxels across; ours cannot have them.
5. **Looks:** flat base, free tops, 20-40 turrets per cloud, all "congestus-lite" blocks 2.7-3.5x longer than tall.
   Good silhouette/layering references for cumulus mediocris and humilis-to-congestus. Not towers, no anvils, no stratocumulus sheets.
6. **Density is a plateau, not a depth ramp.** Mean density rises from 0 to about 0.1 within 2 voxels of the 0.05 surface and then stays at
   0.11-0.15 to the core (measured on 01, 02, 03, 10; `edge_depth.json`). Max 0.58-0.79, median 0.065-0.086, p99 0.30-0.38. 19-26 % of the
   bbox is active. This differs from the Nubis profile (rises with depth) and from our Pyro output; the converter's fog mapping rebuilds the
   profile from the SDF anyway, so only the silhouette and the density scale survive.
7. **Loader: it converts, but with one trap.** The VDBs are **Z-up** (`coordinate_system Z_Up_Right_Handed`); `vdb_to_nvdf.py` assumes Y-up and
   has only `--rotate-y`. Converted as-is, cloud 01 stands on end (dims 143 x 96 x 272, 2.2 km tall). Pre-rotated (script below) it is correct.
   Voxel size is 1.0 (unitless, "Centimeters" in the export), so `--world-scale` is a free choice; this pack needs about 4 (1 voxel = 4 m
   gives clouds 540-680 m tall, 1.0-1.5 km wide, 1.8-2.1 km long).

## Per-cloud inventory

All ten: one grid, `density`, float, class "unknown" (fog), background 0, transform identity with voxel size 1.0 (cubic, axis-aligned,
no rotation), no temperature / velocity / flame / fuel grids (export flags: density only). Index 0 is at world -207.5 / -319.5 / -111.5 (x / y / z),
so the grid is the whole 416 x 640 x 224 sim domain centred in x, y; world coordinates are negative. Active bbox z always starts at index 11
(cloud base is cut flat: all ten). Files are uncompressed (`use_compression False`), 16-22 MB, load in 0.1-0.3 s in `hou`.

| cloud | file MB | bbox dims x,y,z (vox) | active vox (fill of bbox) | active idx x / y / z | density max / p50 / p99 | wisp (<0.05) | height | len:h | base area at 2% / 10% h | turrets (spacing vox) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | 17.5 | 270x522x172 | 4.59M (19%) | 49-319 / 91-613 / 11-183 | 0.67 / 0.072 / 0.32 | 34% | 162 | 3.19 | 0.03 / 0.94 | 20 (60) |
| 02 | 20.2 | 327x474x171 | 5.70M (22%) | 18-345 / 103-577 / 11-182 | 0.73 / 0.085 / 0.36 | 27% | 161 | 2.93 | 0.03 / 0.85 | 22 (61) |
| 03 | 17.7 | 325x478x167 | 4.69M (18%) | 22-347 / 94-572 / 11-178 | 0.79 / 0.078 / 0.32 | 32% | 158 | 2.97 | 0.01 / 0.58 | 20 (56) |
| 04 | 16.2 | 307x460x143 | 4.15M (21%) | 46-353 / 102-562 / 11-154 | 0.66 / 0.076 / 0.35 | 32% | 134 | 3.37 | 0.01 / 0.60 | 32 (48) |
| 05 | 21.4 | 328x463x162 | 6.30M (26%) | 33-361 / 88-551 / 11-173 | 0.77 / 0.086 / 0.33 | 25% | 151 | 2.94 | 0.02 / 0.90 | 32 (51) |
| 06 | 18.8 | 310x455x153 | 4.99M (23%) | 47-357 / 117-572 / 11-164 | 0.66 / 0.074 / 0.33 | 31% | 144 | 3.14 | 0.01 / 0.78 | 36 (47) |
| 07 | 21.6 | 307x475x179 | 6.19M (24%) | 61-368 / 114-589 / 11-190 | 0.61 / 0.081 / 0.32 | 29% | 169 | 2.77 | 0.03 / 0.87 | 39 (46) |
| 08 | 16.4 | 238x435x160 | 4.37M (26%) | 98-336 / 126-561 / 11-171 | 0.60 / 0.079 / 0.38 | 31% | 151 | 2.85 | 0.07 / 0.96 | 22 (53) |
| 09 | 17.2 | 276x454x176 | 4.56M (21%) | 72-348 / 110-564 / 11-187 | 0.79 / 0.069 / 0.34 | 37% | 165 | 2.74 | 0.07 / 0.93 | 25 (53) |
| 10 | 17.2 | 288x512x156 | 4.34M (19%) | 39-327 / 82-594 / 11-167 | 0.58 / 0.065 / 0.30 | 39% | 146 | 3.47 | 0.05 / 0.87 | 22 (60) |

Columns: wisp = share of active voxels with density < 0.05. height = voxels above the base. "base area" = footprint area (density > 0.05) at
2 % and 10 % of height relative to the widest layer: the base is flat and sharp, filling out within about 10 voxels. turrets = local maxima of the
blurred top-height map above half height (spacing = sqrt(footprint area / count), a coarse proxy). Density histogram per cloud is in `inspect.json`
(cloud 01: 10 % of active voxels < 0.01, 34 % < 0.05, 73 % < 0.1, 97 % < 0.25, 0.005 % > 0.5; others similar).

## Shape read and usefulness

Views: `thumbs/contact_side.png` (all ten, side projection) and `thumbs/cloud_NN.png` (side / end / top). The top views are 1.3-2.2:1 blobs
with lobed, cauliflower outlines. These are my own quick lit projections (light from above, no multiple scattering), darker than the pack's
renders in `cloud_pack_thumbnails.png`.

| cloud | type read | tower vs flat | turrets / base / wisps | shape-reference use | loader-test use |
| --- | --- | --- | --- | --- | --- |
| 01 | cumulus mediocris, two groups (tall left mass, lower right group) | long, medium height | big left dome with turrets on top; ragged flat base; wisps at the right end | good for a two-centre cluster | longest (522) of the set; small wisps at ends |
| 02 | congestus-lite, tallest dense core with shoulders | tower-ish, broad | massive centre dome flanked by lower domes; solid dark base | best "single dominant dome plus shoulders" | high mass (517k); big file |
| 03 | congestus with fractus fragments | tallest single tower, wide foot | one broad central tower, flat dark base, detached wisps left and right (footprint only 41 %) | best for tower-on-pedestal (cf. L1 target) | detached islands and low-density debris: tests crop and occupancy mask |
| 04 | cumulus mediocris with fractus tail | flat, low | low broad bank, central dome, ragged tail right | good for humilis-to-mediocris | lowest height (134) |
| 05 | cumulus mediocris, heaviest block | broad wall | rows of domes, most massive (576k), 26 % fill | dense "wall" of cells | worst-case size (6.3M active, 21 MB) |
| 06 | cumulus mediocris, ragged | flat | many small turrets (36), irregular, several side lobes | good for lumpy tops | many small features |
| 07 | cumulus mediocris, small turrets | broad | most turrets (39), smallest scale, taller centre | fine cauliflower texture reference | tallest (169) |
| 08 | cumulus fractus / shaggy mediocris | compact | smallest footprint, wispy left edge, ragged right base | best for ragged edge / fractus | smallest bbox, offset in domain (x 98-336) |
| 09 | congestus-lite, single tall centre | tower-ish | central tall tower, lower flanks; highest wisp share after 10 | tower with wings | 37 % wisp voxels; reaches z index 187 |
| 10 | stratocumulus-like twin lobes with a thin bridge | flat | two separate lobes joined by a wispy bridge; lowest mass (306k) | only one that reads as two cells joined | thinnest connecting structure; lowest density (max 0.58) |

None of the ten is a true tower or cumulonimbus, and none is a stratocumulus sheet. Turret scale (lobe size, by eye) is about 1/6 to 1/4 of height,
with the larger domes about 1/2 of height. Flat-base area is nearly constant over the lowest 10 % of height (base is clipped, see below).

### As a shape reference for our Houdini recipes

- Treat it as a silhouette/layering bench for cumulus mediocris and low congestus, exactly the range our L2 species (mediocris, humilis, congestus)
  need and which our chimney sims fail at. Compare outlines and top-view lobe structure, not density.
- Use against L1/L2 outputs by projecting our sim the same way (`scripts/thumbs.py` accepts any `[z,y,x]` array).
- Not useful for tower, anvil, cumulonimbus, or surface-fidelity work (density is a plateau; our target is HZD/photos).

## EmberGen setup (from `cloud_generator.ember`)

Binary file (magic `EmberGen`, 79 KB), not JSON. I parsed its node table (offset 112, 56 B per node) and property table (offset 1816, 72 B per
property) with `scripts/parse_ember.py` (best effort: doubles, vec3, bool, enum strings decode cleanly; a few "t10" range types do not). Full dump:
`ember_params.json`. Values below are decoded and coherent (voxel count x size matches the VDB), but treat unlabelled ranges as unverified.

- **Seed shape (Node_Shape_Primitive + Node_Shape_Blend + Node_Shape_Noise):** Ellipsoid radius (20.33, 46.0, 4.0); blend `Smooth_Intersection`,
  smoothness 10; noise scale 28, seed 43123.2, 1 octave, lacunarity 2, gain 0.5, amplitude 1. Together: a flat lens with a noisy outline.
- **Emitter (Node_Emitter):** position z = 12.05 units; temperature `Replace` 4100 (max 6000), fuel `Add` 30 (rate 75, max 60), smoke `Add` 100 (rate 10,
  max 500); temperature and fuel tightness 100 (emit only within the shape), smoke tightness 0; divergence rate 3.67 with random divergence
  (scale 0.1, intensity 75); emission smoothness 0.5; **burst_duration 0.5, burst_interval 0** (one pulse).
- **Force noise:** scale 28, 1 octave, gain 0.5, amplitude 4 (a large, weak random velocity field; no animation).
- **Simulation (Node_Simulation):** domain 416 x 640 x 224 voxels, voxel 0.25 units, origin centre/centre/min; `Combustion` mode, BFECC advection (first order),
  timestep 60; master smoke 30, dissipation 30, flame 40, expansion 20.
  Combustion: ignition temperature 2600, temperature gain 4800, fuel loss 44, gas release 90, extinction smoke temperature 2160, extinction smoke gain 22,
  temperature cooling 55.7, force dissipation 44.7, smoke dissipation rate 2.7.
  Fluid: **buoyancy 10.8, smoke weight 48.3, overall gravity 100**, **vorticity 59.7** (velocity 100, smoke 100, large vorticity 2.3),
  **temperature diffusion 79.4** (all other diffusion 0), turbulence (advection 1.7, smoke 8.7, size 5.8, speed 4), wind speed 0.05 along +y with 0.2 randomisation,
  chaos 0.45. No blocking faces.
- **Volume post (Node_Volume):** smoke sharpening 135, `volume_post_process` Dilate with smoke dilate -202.5 (negative = erode) and softness 222.5; modulation 0
  (noise, size 2.02, 4 octaves, lacunarity 0.37, advected by the flow at 100 %, multiply on all components, large target range) and modulation 1
  (source Height, target Smoke, operator Min: a height-dependent smoke limit); z-minus border width 13.7 (likely the soft flat floor).
- **Export (Node_Export_VDB):** density only, Z_Up_Right_Handed, Centimeters, threshold 0.002, one frame (first_frame 161), no compression.
- **Render:** the pack thumbnails use EmberGen's own volumetric renderer with a sky and a ground plane (Node_Skybox, Node_Ground), not our scattering.

## What EmberGen's seeding does differently from our Pyro sims

| | EmberGen pack | Our Pyro (L1 / L2, `scripts/vdb/authoring/sim/`) |
| --- | --- | --- |
| Seed | one flat lens (5 : 11.5 : 1) with noisy outline, filled, wide | hot-spot emitters, slab 0.35-0.4 floor 0 (P9-F); L1 added a pedestal emitter, weak lid |
| Emission | single 0.5 s burst of temperature + fuel + smoke inside the lens only | continuous emitters (L1 per-emitter `end` frame added in L2) |
| Buoyancy | works (10.8 vs gravity 100, smoke weight 48): rises only so far | was off in all P4-F/P9-F recipes (T0 = 0); with real lift L2 got 330-530 m chimneys up to 1.4 km |
| Self-limiting rise | strong heat diffusion (79) and cooling (56) plus heavy smoke: the heat dies and the plume stalls at about 3 x lens thickness | tempcooling 0.03, dissipation 0.006; no diffusion control; relied on a lid / stretch |
| Lobes | vorticity confinement 60 plus advected 4-octave noise multiply and smoke sharpening: puffs, not chimneys | turbulence plus `remap.stretch`; no vorticity confinement tried (L2 listed it as open) |
| Fuel/combustion | combustion supplies the heat and smoke (fuel 30 burns, gas release 90) | plain temperature/density sources |
| Resolution | 134-169 voxels tall; lobes 20-40 voxels | 36 m voxels, 11-28 voxels tall; heroes 4 m but grown separately |
| Cut and flat base | domain floor cut plus a soft z border (about 10 voxels) | flat base wrangle only in `build_heroes.py`, sims grow wherever |
| Edges | erode + sharpen: 2-voxel edge, uniform plateau interior | soft profile |

Suggested follow-ups for the Pyro recipes (research only, nothing changed here): (a) one filled lens seed (here 5 : 11.5 : 1, thickness about a tenth of the long axis) with a single burst and no continuous emitter; (b) set diffusion/cooling so the plume self-limits instead of using a lid; (c) turn vorticity
confinement and smoke sharpening on in the Pyro solver; (d) grow at 4 m for the final cloud (the pack's 150-voxel height suggests a 4-8 m voxel for a 600-1200 m cloud).
All of these need the L2 buoyancy fix (T0 > 0) first.

## Loader test (scratch output only)

Commands (hython 21.0.671, M-series Mac, scratch dir outside the repo). Pre-rotation script: `extracted/cloudpack/scripts/rotate_zup_to_yup.py` (new y = old z, new z = -old y, ~5 s).

| run | command | result |
| --- | --- | --- |
| as shipped, Z-up | `vdb_to_nvdf.py --mode fog cloud_01.vdb --world-scale 4` | succeeds in 15.0 s, dims 143 x 96 x 272 (clouds on end: up axis wrong), 22 MB |
| rotated, 4 m source -> 8 m | `... c01_yup.vdb --world-scale 4` | 12.3 s (resample 6.4, SDF 4.0, channels 1.9), dims 141 x 273 x 96, 22 MB (nvdf 14.8 + sdf 7.4), bounds 1128 x 2184 x 768 m |
| rotated, native 8 m (scale 8) | `... --world-scale 8` | 123 s (resample 0.8, **SDF 85**, channels 37), dims 274 x 533 x 178, **156 MB** (3.6 km x 4.3 km x 1.4 km) |
| rotated, hero fine lattice | `... --world-scale 4 --margin 1 --fine-voxel-size 4` | 125 s (fine profile 118 s, coarse SDF 2.4), coarse dims 131 x 261 x 83 at 8 m, 17 MB total incl. `fine.nvdb`; works (node present) |

Edge cases and notes for the loader:
- **Up axis:** add an `--up z` (or `--rotate-x`) option to the converter, or document the pre-rotation; EmberGen, Blender and many sims export Z-up.
- **World scale:** unitless voxel 1.0; the converter's `--world-scale` and the default 8 m target are a free choice. 1 voxel = 4 m is a plausible cumulus size.
- **Negative world coordinates / large offsets:** idx 0 at about (-208, -320, -112): handled (cropOffset from the active bbox).
- **Size:** 4-6 M active voxels each, dense 6 B/voxel in the NVDF: 22 MB at 8 m for a 4 m source (too big for the old 4 MB shipping cap, which the owner has since lifted),
  156 MB at native scale 8. The exact EDT is the cost at scale (85 s of 123 s).
- **Density range:** 0.06-0.8, never reaches 1; the default `--density-ref` (p99 = 0.30-0.38) normalises it.
- **Wisps and islands:** 25-39 % of active voxels are below 0.05 and cloud 03 has detached fragments; `--iso` 0.05 drops the thin ones from the occupancy mask.
- **Not run:** the other nine clouds through the converter; behaviour should match (same grid layout).

## Files

- `extracted/cloudpack/scripts/`: `inspect_vdb.py` (hython: grids, bbox, histograms, saves density `.npy`), `thumbs.py`, `shape_metrics.py`,
  `edge_depth.py`, `parse_ember.py`, `rotate_zup_to_yup.py`.
- `extracted/cloudpack/`: `inspect.json`, `shape_metrics.json`, `ember_params.json`, `edge_depth.json`, `thumbs/` (per-cloud PNG, `contact_side.png`,
  `evolve/evolve_sheet.png` 16 frames of the pack video; `old_wrong_axis_contact.png` is a discarded Y-up attempt).
- `_cloud_NN_density.npy` (dense float32 arrays, `[z,y,x]`, about 100 MB each) live in `extracted/cloudpack/` too; delete them to reclaim about 1 GB.
