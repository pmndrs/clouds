# Topic guide: authoring cloud volumes

RS-5, 2026-10-10. How to make the volumes that Nubis³ and our voxel path render: what the runtime needs from an authored cloud, how Guerrilla made theirs, what EmberGen's pack does, what Houdini 21 offers beyond Pyro, our own pipeline and its failures, a recipe plan for the two target studies, and the Houdini rigs the owner should be able to open. Map of all guides: [README.md](README.md). Surface detail (what the runtime adds on top of an authored shape) is in [surface-detail.md](surface-detail.md); the procedural density chain in [shape.md](shape.md); placement in the sky in [layering.md](layering.md) and [weather.md](weather.md).

**Owner direction (2026-10-10).** Procedural first, with HZD and the owner's photos as the target; in parallel, use Houdini to make the clouds Nubis³ needs. Agents have so far struggled to match real cloud shapes, so the goal here is **recipes built from the owner's photos**, as Houdini rigs the owner can open and fix.

## Conventions
Same as surface-detail.md. `X/` = `/Users/dex/Developer/WebGPUClouds/artifacts/research/extracted/` (local). Authoring scripts are under `scripts/vdb/authoring/`. Houdini is 21.0.671, licence category **Indie** (checked with hython), so every saved `.hip` is an Indie file.

## 0. In five lines
1. **Author the form, not the fuzz.** The runtime turns an 8 m profile into 20 m billows and 5–10 m creases (surface-detail §2). An authored cloud must get the silhouette, the 300 m and 70 m lobe rungs, flat vs hanging bases, and the per-voxel **detail type** and **density scale**. Baking 28 m noise into an 8 m grid (what `build_heroes.py` does) is wasted [n3 s66, s77].
2. **Guerrilla grew clouds** with a cloud-only fluid solver from a **thin flat lens seed**, simulated small, scaled up, and composited many of them ("frankenclouding") with cutouts, erosion and squashing, rotated sub-volumes, a wispy skirt and mesh-path tunnels [n3 s63–65, s163, s179–181].
3. **Our Pyro sims failed for two reasons we now understand**: buoyancy was silently off (T0 = 0) in every P4-F/P9-F recipe, and with buoyancy on, hot-spot emitters make 330–530 m chimneys (L1, L2). EmberGen's pack shows the fix: one filled lens, one short burst, strong heat diffusion and cooling (`cloudpack-embergen.md`).
4. **Houdini 21 has a full cloud-modelling kit we have not used**: Cloud Shape Generate/Replicate/from Line/from Intersection (sphere hierarchies with species presets, flat bottoms, bend, directional scaling), Cloud Billowy Noise (Alligator, iterations with per-iteration attenuation, up-vector falloff), Cloud Wispy Noise (curl/flow, wind, surface-distance masks), Cloud Clip, Cloud Adjust Density Profile, and GPU Copernicus Pyro (§4). They map directly onto the photo detail list.
5. **Plan:** sculpt the Santa's Sleigh bodies and the Frog with the Cloud Shape nodes (deterministic rungs, editable), grow only the sheared arm and ragged fragments with a lens-seeded Pyro, author type/scale grids from the normal, and save every builder's network as a `.hip` the owner can open (§8).

## 1. What the runtime needs from an authored cloud (the contract)
| Field | What it controls | How we make it today | Source |
| --- | --- | --- | --- |
| Silhouette at 8 m (the SDF) | where the cloud is; sphere-tracing; rung 1 (~300 m) and rung 2 (~70 m) lobes | iso of the authored density (`vdb_to_nvdf.py --iso`) → EDT | n3 s79, s140–145 |
| Dimensional profile | the 0→1 ramp the noise erodes (~66 m wide in our mapping) | rebuilt from the SDF (`nvdf_math.py:213-214`, `pack_profile`) | n3 s79 |
| Detail type (0 wispy … 1 billowy) | where billows vs wisps appear | height heuristic (`--detail-bottom/--detail-top`, `nvdf_math.py:252-257`), or a VDB grid (`--detail-grid`, `vdb_to_nvdf.py:527`) | n3 s80; syn s37 |
| Density scale | thinner, softer, more see-through after the up-rez (S⁴) | height ramp or p99-normalised density (`--scale-grid`, `vdb_to_nvdf.py:528`) | n3 s80, s107–109; syn s40 |
| Optional 4 m fine lattice | crisp lobes within the hero range | `--fine-voxel-size 4` (P13 overlay, `hero/bricks.ts`) | plan Phase D |

Consequences:
- In fog mode only the **silhouette and the density scale** survive conversion; the converter rebuilds the profile from the SDF (`cloudpack-embergen.md`, finding 6). Interior density shaping in Houdini is for the Houdini preview only.
- **Type and scale grids are the authoring lever we do not use.** Every authored asset so far gets height-only type. The photo details that depend on orientation (surface-detail §6) are authored here.
- Voxel size: 8 m is the deck's [s71–73]. Our 36 m L1 sims (11–28 voxels tall) cannot hold rung 2.

## 2. Guerrilla's pipeline (what to copy)
From [n3/slides-047-074.md](../sources/n3/slides-047-074.md) and [n3/slides-156-194.md](../sources/n3/slides-156-194.md); no solver parameters or node names are published.
- **Grow with a cloud-only solver.** The 2014 "Aero" solver is a Houdini microsolver network (buoyancy, advect density, advect velocity, non-divergence, sourcing), streamlined to simulate only cloud growth [s6–7, s63–64].
- **Seed with a thin flat lens at the base height.** Frames of the s64 clip: a flat slab becomes a flat-based humilis by ~1 s and a mediocris/congestus by ~4 s; the base stays at the seed height and about the seed's width; growth goes up into turrets (frame reading, not narration).
- **Atlas** (Houdini) composites voxel data. Sources: voxels, point clouds, meshes, 2.5D data. Edits: cutouts, erosion, squashing [s65]. A plainly voxelized Tallneck mesh reads as a billowy cloud, because the up-rez carries the surface [s66].
- **Hero-first layout.** Sketch the E–W and N–S skyline against the sun arc [s162]; place one big cloud and check it from the ground at every time of day; it is built from 4–5 overlapping, individually rotated boxes; add a flat, ragged, wider **skirt** as connective tissue; cut tunnels with mesh paths [s163, frames]. Repeat per formation (coastline chain, inland heaps, an isolated cloud) [s167].
- **Sim small, then scale up and frankencloud.** The Stormbird plume was too small as simulated; it was scaled up and composited [s179–181]. Clouds are close to scale-invariant, so this is legitimate.
- **Dynamics are scripted, not simulated at runtime**: pseudomotion, whole-grid translation per shot, a scripted fade [s169, s173, s176].

## 3. EmberGen CloudPack vs our Pyro
Full analysis: [cloudpack-embergen.md](../cloudpack-embergen.md). What transfers:

| | EmberGen pack | Our Pyro (`sim_clouds.py`, `library.py`, `targets.py`) | Do |
| --- | --- | --- | --- |
| Seed | one flat lens, radii 5 : 11.5 : 1, noise-edged | hot-spot discs, floor 0 (P9-F); L1 added a warm pedestal | lens seed (a `cloudshapegenerate` → `vdbfromparticles` slab works as the source) |
| Emission | one 0.5 s burst | continuous (`emit_frames` 200–300) | single burst; per-emitter `end` exists (L2) |
| Buoyancy | works (10.8 vs gravity 100) | **off** in P4-F/P9-F: `temperature0 = 0` divides by zero (`sim_clouds.py:39,47`); fixed to T0 = 1 in L1/L2 (`library.py:31`, `targets.py:36`) | keep T0 > 0 (the SOP default is 300 K) |
| Self-limit | temperature diffusion 79, cooling 56, heavy smoke | `tempcooling 0.03`, no diffusion; a lid or stretch | raise `tempdiffusion` and `tempcooling` until the plume stalls at ~3× lens thickness |
| Lobes | vorticity confinement 60, advected noise multiply, sharpening | turbulence + disturbance only | try `enable_shredding`, disturbance octaves; `gaslocalsharpen` (DOP) if we move to DOPs |
| Resolution | 134–169 voxels tall | 36 m voxels (L1), 11–28 tall | 4–8 m final (pack: ~150 voxels per cloud) |
| Post | erode + sharpen, flat floor | remap, stretch, taper | flat base via `cloudclip`; no stretch |

## 4. Houdini 21's cloud toolset (beyond Pyro)
Listed with hython from this install (`hou.sopNodeTypeCategory().nodeTypes()` etc., help summaries from `$HFS/houdini/help/nodes.zip`). Names are the internal type names. "Since 20.0/21.0" is from the help files.

### 4.1 Shape generation (rungs 1–2, hanging lobes, bubbles, arms)
| Node | What it does | Key parms (defaults) | Good for |
| --- | --- | --- | --- |
| `cloudshapegenerate` (20.0) | Sphere-primitive cumulus from points, per species | `cloudtype` Cumulus/Cumulonimbus; `cuspecies` Humilis (wider than tall) / Mediocris / Congestus (taller than wide); `length`, `width`, `shapedistort`, **`doflatten`/`flatten`** (flat bottom), **`dobend`/`bend`** (lean), `scattersecshapes` with `secniter` 3, `secscalemin/max` 0.75/1.25; per-element randomisation by `cloudid` | rung 1 of every body; species per body; lean for shear |
| `cloudshapereplicate` (20.0) | More spheres around existing spheres | `surfacescatter`, `pointsep` (sets child size), **Directional Influence**: `dodirpull`, **`dodirscale` with `dirscalemin/max`** (bigger lobes on faces toward a direction), **`donjitter`** normal jitter on a `njitterpercent` share | rung 2 (~0.25–0.3 of parent); big lobes on up/lead faces, small under; F4 lit bubbles via normal jitter |
| `cloudshapefromline` (20.0) | Spheres along a curve | `pointsep`, **`dolengthscale`** + ramp (taper), `doprofilescale`, `dogoalvector`, `doupvector`, secondary shapes, `flatten` | D5 arm (taper to the tail along a sheared curve), D11 dome rows on a ridge curve, link body |
| `cloudshapefrompolygon` (20.0) | Fills a mesh with adaptive spheres | | the Tallneck route: any blocking mesh → cloud [n3 s66] |
| `cloudshapefromintersection` (20.0) | Fills intersections of sphere sets with smaller spheres | | D10 neck domes, merge seams, F4-like bulges where bodies meet |
| `vdbtospheres` | Fills a VDB with adaptive spheres | `radiusmin/max`, `spheresmax` | turn a sim or a pack cloud into editable spheres |
| `vdbfromparticles` | Spheres (pscale) → fog/SDF VDB | | the step after every Cloud Shape node |
| `cloud` (legacy Cloud SOP) | Mesh/points → fog | bands, secondary shapes | what `build_heroes.py:205` uses today |

### 4.2 Cloud noise and editing (rung 2–3 shaping, bases, masks)
| Node | What it does | Key parms | Good for |
| --- | --- | --- | --- |
| `cloudbillowynoise` (20.0) | Billowy **displacement** of a fog volume | `basis` **Alligator** (default) / Perlin / Simplex; `amplitude` 0.25, `elementsize`; **`doiter` + `niters` 3 with per-iteration attenuation** (`elementsize_atten` 0.35, `amplitude_atten` 0.35); **`doupvectorfalloff`/`upvectorbias`** (less displacement on down faces); `deepenvalleys`; warping `distort`, `stretch` (per axis), **`dodroop`/`droop`** (sag); Worley details; `restposbias` | rung 2 lobes on an 8 m body; set `elementsize_atten` ≈ 0.28 for the photos' 3.5× ladder; `stretch (1,3,1)` in a merge mask for D7 fluting |
| `cloudwispynoise` (20.0) | Feathery displacement (curl of a noise) | `noisetype` Anti-Aliased Flow (default), Alligator, …; `amplitude`, `elementsize`, `oct` 8; **wind** (`addwind`, `winddir`, `windstrength`); **scale by surface distance**, by bounding box; masks | frayed tails (D5, D6, F7), skirts (F6), downwind trailing wisps; mask to down/lee faces |
| `cloudclip` (20.0) | Splits a fog volume with a plane | `origin`, `dir`; **`donoise`** (cloud-like displacement of the cut); `createclipmask` (fade range) | flat laminar bases (D4); a clip mask to drive wispy noise or low density scale in the base band (F6) |
| `cloudadjustdensityprofile` (20.0) | Density from an SDF of the volume | `edge_thickness`, `edge_density`, `edge_falloff`, `internal_density` | preview only for us (the converter rebuilds the profile) |
| `cloudnoise` (legacy Cloud Noise SOP) | Noise erosion of fog | `noiseelementsize`, `noiseamount`, octaves, advect | what `build_heroes.py:214` uses (210/70/28 m passes) |
| `volumenoisesdf`, `volumenoisefog` | Unified Noise on SDF/fog (incl. Alligator, Worley F1/F2-F1) | displacement along normal | a metre-scale displacement on the SDF |
| `cloudlight` | Diffuse light fill for preview | | judging shape in the viewport |

### 4.3 VDB operations (frankenclouding, Atlas-like edits)
`vdbcombine` and `vdbmerge` (max/union of bodies), `volumemerge`, `volumestamp` (instance volumes on points), `vdbclip` (cutouts by box or mask), `vdbsmoothsdf` and `vdbreshapesdf` (dilate/erode the SDF: "erosion" in Atlas terms), `vdbresample` (voxel size; non-uniform scale = "squashing"), `vdbmorphsdf` (blend two shapes: life-cycle stages, merge), `vdbadvectsdf` (move a shape by a velocity field), `vdbactivatesdf`, `volumefeather`, `vdbsegmentbyconnectivity` (split islands; our `prune` does this in numpy), `vdbpotentialflow` (steady air flow around obstacles: a cheap shear/updraft field).

### 4.4 Simulation
- **SOP `pyrosolver`** (what we use): buoyancy (`temperature0` ambient defaults to **300 K**, `temperature1` 3000 K), `tempdiffusion`, `tempcooling`, dissipation, wind, disturbance (octaves, lacunarity), turbulence, **shredding** (default field `flame`; point it at temperature). No vorticity-confinement parm is exposed on the SOP (checked by name); that lives in the DOP smoke/pyro solvers.
- **DOP** `pyrosolver::2.0`, `pyrosolver_sparse`, `smokesolver_sparse` with microsolvers `gasbuoyancy`, `gasdisturb::2.0`, `gasturbulence`, `gasshred`, `gaslocalsharpen` (adaptive contrast that keeps small blobs: the EmberGen "smoke sharpening" equivalent), `gasdissipate`. This is the Aero-like route: a custom cloud-growth network [n3 s6].
- **Copernicus (COP) Pyro, new in 21.0**: `pyro_configure`, `pyro_block_begin/end`, `pyro_buoyancy`, `pyro_disturbance`, `pyro_turbulence`, `pyro_dissipate`, `pyro_advect`, `pyro_sourcefrompoints`, plus `pyro_lightscatter`/`pyro_lightambient` for preview. GPU (OpenCL) VDB sims; the help notes it needs DOP-level licensing, which Indie has. Fast iteration for the lens-seed sweeps; untested by us.
- `filament_advect_pos`, `popadvectbyfilaments`: vortex filaments, a candidate for roll-back / ring motion (parked).

### 4.5 Sky fields, noise generation, ML
- **Sky field family** (20.0): `skyfield`, `skyfieldpattern` (presets built on the VOPs `cloudnoise`, `fibratus`, `undulatus`, `floccus`, `fractus`), `skyfieldnoise`, `skyfieldfrommap`, `skybox` (2D field → 3D clouds). Useful for weather/coverage maps and the cirrus layer (D13 fibres: `fibratus`). Hand-off to weather.md and layering.md.
- **Noise generation**: COP `cloudnoise3d` (21.0, billowy 3D noise, non-periodic), `worleynoise3d`, `fractalnoise3d`, `crystalnoise3d`; VOP `anoise` (Alligator, inside `turbnoise`/`unifiednoise`), `curlnoise`, `flownoise`/`aaflownoise`, `pworleynoise` (periodic Worley). These are what the Nubis generators are built from (§5).
- **`ml_volumeupres`**: ONNX upres of a volume (needs a trained model; DOP licensing). Not a fit for runtime, but a possible offline 8 m → 4 m step for heroes. Parked.

## 5. The Nubis noise generators
Two different HDAs:
| HDA | Where | Makes | Notes |
| --- | --- | --- | --- |
| HZD-era (2017, COP2 + VOP) | `artifacts/research/nubis/nubis_noise_generator/` | 128³ Perlin-Worley + 3 Worley fBMs | fully read in [noise.md](../sources/noise.md); TGA output is premultiplied, use EXR |
| **Nubis³** (SOP `nubis_noise_generator`) | `assets/nubis-voxel-clouds/Noise/NubisNoiseGenerator.hda` (in our repo, from the pack) | 128³ LF/HF Curly-Alligator, LF/HF Alligator; exports slices or one VDB; border-blend tiling 0.125 | recipe read for RS-5 (surface-detail §2.3); it is the texture our runtime loads |

Use: the Nubis³ HDA is the base for any noise variant (16-bit, periodic tiling, different billow base frequency). Cook headless with hython (set `path`/`vdb_path`, press `execute`/`execute2`), export VDB (float), convert to our `rgba8`/`rgba16` blob. Do not ship the HDA; ship our bakes (pack licence, see `assets/nubis-voxel-clouds/NOTICE.md`).

## 6. Our pipeline today and its known failures
| Piece | What it does | Known failures |
| --- | --- | --- |
| `build_heroes.py` (Cloud SOP + 3 Cloud Noise passes, flat-base wrangle; `--hip` saves the network, `:245-246`) | sculpted heroes: tower, valley fog, fair-weather | bakes 210/70/28 m noise into an 8 m grid; tower first read as a smoke plume (stacked spheres); no type/scale grids; uses none of the 20.0 cloud nodes |
| `sim/sim_clouds.py` (SOP Pyro; `--hip`, `:424-425`) | grown cumulus/congestus | T0 = 0 in its recipes (`:39`, `:47`), so buoyancy is off; height came from `remap.stretch` (flame streaks) |
| `sim/library.py` (17 entries, P9-F) | the authored library | built buoyancy-less; L2 retune in progress, `L2_RETUNED` empty, writes refused; no `--hip` |
| `sim/targets.py` + `scripts/targets/*` (L1) | target sweeps scored against a photo card | best total 0.576; renders softer (edge 0.14–0.22 vs 0.35), flatter (lit:shadow 1.7–2.0 vs 2.8), shallower notches; 36 m voxels; camera FOV guessed; no `--hip` |
| L2 regrow | buoyant templates | hot-spot emitters with real lift make 330–530 m chimneys up to 1.4 km; stem cut and pulses did not help; lids untested |
| `vdb_to_nvdf.py` | VDB → NVDF + SDF | Y-up only (EmberGen and many tools are Z-up); exact EDT dominates time at scale (85 s of 123 s) |
| Runtime composite (`generate/stamp.ts`) | stamp assets into one dense volume | yaw-only rotation (`:29`), uniform scale (`:31`), no erode/squash op, no mesh-path cutouts, no skirt piece (n3 §5 row 31); one bound volume |

Two lessons: (1) the shapes failed at the **source** (seed and buoyancy), not in the solver's details; (2) the "plastic" read L1 blamed on the render side is largely the noise MIP and step (surface-detail SD1, SD2), so fix those before judging any new asset.

## 7. Recipe plans from the owner's photos
### 7.1 Santa's Sleigh (several bodies at staggered life-cycle stages)
Numbers from [targets/santa-sleigh.md](../targets/santa-sleigh.md) §2–6 at H = 1.5 km (±30 %). One template family, offset in time: the head at `end` is the main at `early` (h/w 0.50 vs 0.48).

**Bodies.**
| Body | Shape spec | Houdini route (sculpted, primary) | Type / scale grids |
| --- | --- | --- | --- |
| **Main** (congestus) | core width ~2.7 km (4 km with flank); tower 2.5–3 km tall over the head-side 55 % of the core, summit leaning ~3° to the head; knob 0.17–0.2 of core width (~450 m) with a notch; right shoulder 0.2 of core width, translucent underside; right shelf 0.3 of tower height reaching 0.42 core width; merge flank of 3–5 small turrets; flat base with 2–3 faint lamina ~100 m apart | `cloudshapegenerate` (Congestus) for the tower over a wide Mediocris foot; `bend` a few degrees toward the head; `cloudshapereplicate` for rung 2 with `dodirscale` toward up + head; one extra sphere for the knob, a `vdbclip`/subtract sphere for the notch; `cloudshapefromline` along the shelf top for its terrace of lumps; `cloudclip` at base height | billowy on the tower and the head-facing side; wispy, lower scale on the shoulder underside (D8) and the trailing shelf; vertical stretch noise in the merge mask (D7) |
| **Link** | L:H 3.2, flat base dipping toward the main; a row of 4 domes 160–260 m, spacing ≈ dome width, sharp V notches; neck with 2–3 small domes at the head joint; fine fibres at the joint top | `cloudshapefromline` on a low curve (body), a second `cloudshapefromline` on the ridge curve for the dome row (`pointsep` ≈ dome radius × 2); `cloudshapefromintersection` at the head joint | billowy at the top only; type 0.2–0.4 below |
| **Head** (the main 5 min earlier) | L:H 2.1, two tiers: crest of 6–8 domes (0.08–0.15 of length) over a smooth dark belly (no structure below ~300 m); a lit chin lobe under the right half, 0.3–0.5 of length, 0.25 of thickness, hanging 63 px below the left base | `cloudshapegenerate` (Mediocris) with `flatten` on; crest via `cloudshapefromline` on the top ridge; chin as a separate lower sphere group with `flatten` off | billowy crust only above height fraction ~0.65 (D1); belly type mid, scale 1 (no erosion, D2); fibrous fringe on the chin's lower-left (wispy, curl) |
| **Arm** (ejecta) | 3–4 lumps of ~300 m shrinking to 60–140 m at the tail, ~1 km long, 3:1, leaning 48° from vertical toward the head, lifted 130 px clear of the link; dense crisp tip, fraying translucent tail with 2 free puffs | `cloudshapefromline` on a sheared rising curve rooted on the merge flank, `dolengthscale` ramp tapering to the tail; `cloudwispynoise` with `winddir` downshear masked to the tail; or a small lens-seeded Pyro puff in a sheared wind (§7.3) | type and scale painted along the chain: tip type 1 / scale 1, tail type 0 / scale ~0.5 (D5) |

**Interactions.**
- **Merge** (main ↔ link): a merge mask where the two SDFs are within ~200 m; inside it, `cloudshapefromintersection` neck domes (D10), stretched billow noise `stretch (1, 3, 1)` for fluting 100–140 m wide (D7), and raised type.
- **Shear**: all detached pieces lean 30–48° toward the head; the bend angle per body and the arm curve take it; the type/scale bake uses the same lead vector (surface-detail SD3).
- **Life-cycle staging**: keep each body's rig parameters as a function of one `stage` value (loose → two-tier → towering). The head is the main's template at the earlier stage; `vdbmorphsdf` between two stages gives in-between frames if we ever animate.
- **Placement**: head at (−1.45, 5.31)H, link at (0.04, 7.33)H, main at (2.12, 7.68)H, all on one base height, a line at ~34° to the picture plane (santa §3). A matching camera (40 mm on full frame, 48.5° HFOV for `end`) for review.

**Domain and voxel size (runtime constraint).** The bodies span roughly 8 × 6 km in plan and up to ~3 km of cloud depth. That is ~280 M voxels at 8 m (≈1.7 GB as NVDF+SDF), too large for one dense grid; at 16 m it is ~35 M voxels (~200 MB). At 8–12 km distance a 16 m profile plus a correct up-rez (surface-detail SD1) is adequate. Options: author at 8 m, ship at 16 m; or per-body volumes, which needs multi-volume support in the runtime (it binds one volume, `runtime.ts:244`). **Owner input needed** (open question 1).

**Acceptance.** Matched camera on the compare page vs `end.jpg` and the 105 mm crops: body h/w (main 0.76, head 0.50), base ordering by elevation, edge widths lit 3–12 m vs shaded 20–40 m equivalent, smoothness by band (head 25/36/77/70/38 %), arm lean 35–50°; plus `early.jpg` for the earlier stage (main h/w 0.48).

### 7.2 Frog (single cumulus with a satellite trail)
From [targets/frog.md](../targets/frog.md) §1–5. Main body W:H 1.23, ~2.5 km wide; satellites 0.67 / 0.32 / 0.05 of its width, receding down-right.
- **Body**: `cloudshapegenerate` (Mediocris→Congestus) shaped into a lopsided dome: summit at 0.48 of width; upper-left shoulder 0.13–0.28 below the summit; a sharp step down at ~0.7 of width to a right terrace 0.44–0.56 below the summit.
- **Rungs**: `cloudshapereplicate` twice with child/parent ≈ 0.28 (lobes ~180 → 50 m); stop there, the runtime adds 9 m and below. Bump spacing target: one per 0.077 of width.
- **Base**: flat right half (`cloudclip`); **chin lobes** under the left half (x 0.15–0.4 of width) hanging 0.2 of height below the base, as separate spheres with `flatten` off (F10).
- **Lit bubbles** on the shaded right flank: `cloudshapereplicate` with `donjitter` on ~10 % of points, restricted to that flank (F4), ~150–200 m.
- **Lacy undercut** under the upper-left overhang: down-facing type 0 and scale ~0.4 so the runtime wisps open holes (F5); a `cloudwispynoise` pass masked by n̂.y < −0.3 if the 8 m shape needs pre-fraying.
- **Satellites**: separate small bodies with lower density scale (0.5–0.7) so the same erosion frays them (F7); a hooked cap puff on satellite 2 (F9).
- **Acceptance**: `pano_1600` silhouette IoU and top profile (summit, shoulder and terrace heights), base flatness ±8 px on the right half, chin depth 0.2 H, 2:1 lit-to-belly luminance front-lit.

### 7.3 Grown variant: a lens-seeded Pyro for the arm and the ragged stage
Use only after the lens test passes (try-next AU3):
- Source: a flat lens (`cloudshapegenerate` Humilis, `flatten` on → `vdbfromparticles`), thickness ~1/10 of its length, noise-edged; one burst of density + temperature.
- Solver: T0 = 1, T1 = 2 (or SOP defaults 300/3000 K), `buoyancylift` 0.3–0.8 (L1 range), `tempdiffusion` and `tempcooling` raised until the top stalls at ~3× the lens thickness, disturbance on, shredding on temperature; **sheared wind** as a velocity source that grows with height toward the head (a `volumewrangle` velocity field, or `vdbpotentialflow` around the main body).
- Arm: a second small hot burst on the main's head-side flank, started late; take the frame where it leans 35–50°.
- Staging: one sim, three exported frames for early / middle / end (main h/w 0.48 / 0.68 / 0.76).
- Iterate in Copernicus Pyro if the SOP solver is too slow at 8 m.

## 8. Rigs the owner can open (plan, not built)
Goal: every cloud we ship can be opened in Houdini 21 (Indie), inspected, edited and re-exported, with the hython builder as the reproducible source.

**Where.** Committed rigs in `houdini/rigs/<name>.hip` at the repo root (small: networks only, no caches). Caches and exported VDBs go to `$HIP/../cache/` and `work/captures/scratch/` (both gitignored, add `houdini/cache/`). Photos are referenced by absolute path to `artifacts/research/cloud-photos/` and never copied.

**How they are made.** One `scripts/vdb/authoring/rigs.py` (hython) calls the existing builders with `--hip` and writes all rigs; `build_heroes.py` and `sim_clouds.py` already support `--hip` (`build_heroes.py:245-246`, `sim_clouds.py:424-425`); `library.py` and `targets.py` need the flag passed through to `sim_clouds.simulate`.

**What every rig contains.**
- Network boxes by stage (layout → rung 1 → rung 2 → noise → base → type/scale → export), each with a sticky note saying what the stage is for and which photo detail (D/F number) it serves.
- A top-level `CONTROLS` null with promoted parameters (body sizes, lobe ratio, stage, lean, voxel size) so the owner edits one panel.
- A review camera matching the photo (Sony A7S III, 35.6 mm sensor width; focal length from the study) with the photo as a background plate (local path).
- A `cloudlight` preview so shapes read in the viewport.
- A `rop_geometry` that writes `density`, `detail_type` and `density_scale` VDBs, and a Python button that runs `vdb_to_nvdf.py` with the rig's options.
- Round trip: the rig is the source of truth once the owner edits it (a `harvest.py` dumps changed parameters back into the recipe dict, so the builder stays reproducible).

**Rigs to save first.**
| Rig | From | Why |
| --- | --- | --- |
| `santa_main.hip`, `santa_link.hip`, `santa_head.hip`, `santa_arm.hip`, `santa_scene.hip` (composite and camera) | new sculpted builder (§7.1) | the owner's hero scene |
| `frog.hip` | new sculpted builder (§7.2) | single-cloud benchmark |
| `lens_seed_pyro.hip` | `sim_clouds.py` with a lens source | the AU3 test; open to tune buoyancy, diffusion, shear |
| `texas_tower_<pick>.hip` | `targets.py` (L1 picks) | the existing target; inspect why it plateaued |
| `hero_tower.hip`, `hero_fairweather.hip`, `hero_valleyfog.hip` | `build_heroes.py --hip` (works today) | today's heroes |
| `library_<entry>.hip` for the L2 templates (`congestus-a`, `mediocris-a`) | `library.py` (add `--hip`) | the chimney failure, open to fix |
| `noise_n3.hip` | the Nubis³ noise HDA instance with export paths | re-bake noise variants (surface-detail SD8) |
| `nvdf_channels.hip` | new: loads any VDB, computes normal-based type and scale, previews them as colours | the SD3 bake, editable |

## Try next (ranked, for the board)
Acceptance uses the target studies' measures on our renders with a matched camera (edge widths, smoothness by band, lobe/bump spacing, body ratios), the deck figures n3 s59 `image92`, s64 frames, s66, s78, and the EmberGen silhouettes. **Fix surface-detail SD1 and SD2 first**, or every authored asset will be judged through blurred noise.

| # | What | Why (visual failure fixed) | Sources | Files | A/B acceptance | Risk | Owner input? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **AU1** | **Frog with the 20.0 cloud nodes**: `cloudshapegenerate` → 2× `cloudshapereplicate` (ratio ~0.28) → `vdbfromparticles` → `cloudclip`; no baked fine noise; type/scale from the normal; save `frog.hip` | Our heroes have no 3.5× lobe ladder, flat bases everywhere, no hanging lobes or bubbles | frog §1–5; n3 s66, s77–79; §4.1 | new `scripts/vdb/authoring/sculpt.py` (or extend `build_heroes.py`), `vdb_to_nvdf.py --detail-grid/--scale-grid` | `pano_1600` silhouette, top profile, bump spacing 0.077 W, chin 0.2 H, 2:1 lit:belly | M | yes: Frog questions (scale, which part is the head) |
| **AU2** | **Rigs**: `rigs.py` writes the existing builders' networks as `.hip` (heroes, sim templates, Texas picks) with the §8 conventions | The owner cannot inspect or fix what agents built | owner request | `scripts/vdb/authoring/rigs.py`, `--hip` in `library.py`/`targets.py`, `houdini/rigs/` | Owner opens each rig in Houdini 21 Indie, changes one control, re-exports, and the asset reloads in the runtime | L | yes: rig location and whether to commit `.hip` |
| **AU3** | **Lens-seed Pyro test**: one flat lens, one burst, T0 > 0, raised `tempdiffusion`/`tempcooling`, disturbance + shredding; compare frames with the s64 Aero clip and the EmberGen pack | L2 chimneys; no flat-based grown heap yet | n3 s64, s179; cloudpack-embergen.md | `sim/sim_clouds.py` (lens source option), `sim/library.py` templates | Flat base at seed height, base width ≈ seed width, top stalls at ~3× lens thickness, 20–40 turrets; side contact sheet next to EmberGen 01–10 | M | no |
| **AU4** | **Santa's Sleigh bodies (sculpted)** per §7.1, composited, at 16 m (8 m authoring) | The hero scene does not exist | santa §2–6 | `sculpt.py`, `santa_*.hip`, `generate/stamp.ts` for placement | `end.jpg` ratios (main h/w 0.76, head 0.50, link L:H 3.2), base ordering, edge ratio 3–6×, arm lean 35–50° | H (size, many parts) | yes: domain/voxel size, sketch orientation, travel direction |
| **AU5** | **Type/scale grids from the normal** in Houdini (`nvdf_channels.hip`) and the converter, applied to the whole library | Height-only type everywhere | surface-detail SD3 | `vdb_to_nvdf.py`, `nvdf_math.py:252-262` | as SD3 | L-M | lead vector source |
| **AU6** | **Composite-time edits** like Atlas: pitch/roll, xyz squash, erode/dilate, a skirt piece, mesh-path cutouts | Can't tilt sub-volumes, squash a sim, or add a skirt | n3 s65, s163 | `generate/stamp.ts:23-41` | Rebuild the s163 hero (4–5 rotated boxes + skirt) from library pieces; compare with s59 `image92` | M | no |
| **AU7** | **Re-bake the noise** from the Nubis³ HDA (RGBA16, periodic) via `noise_n3.hip` | 8-bit fold banding; tile softness | surface-detail §2.3, SD8 | new bake script, `resources.ts:45-48` | as SD8 | L | no |
| **AU8** | **Grown arm and ragged stage** (§7.3) once AU3 passes, swapped into the sculpted scene | The sculpted arm may read too regular | santa D5–D6 | `sim_clouds.py`, `santa_arm.hip` | `c636`/`c637` crops: lump sizes 300 → 60–140 m, tip edge ~9 m vs tail ~36 m | M | no |
| **AU9** | **Z-up option** in the converter (`--up z`) | EmberGen and many tools export Z-up; clouds load on end | cloudpack-embergen.md | `scripts/vdb/vdb_to_nvdf.py` | Pack cloud 01 converts upright without pre-rotation | L | no |

## Open questions for the owner
1. **Santa domain.** One dense grid at 16 m (~200 MB), or per-body volumes (runtime work)? And is H ≈ 1.5 km right, or should the scene be scaled to a known base height?
2. **Sculpted first or grown first?** The plan sculpts the bodies (deterministic, editable) and grows only the arm. Do you want the main grown in a sim instead, accepting less control?
3. **Rigs in git?** Commit `.hip` networks under `houdini/rigs/` (small, Indie-flagged), or keep them local and commit only the builders?
4. **Santa questions** (santa §7): sketch orientation, travel direction, whether the gap closed by overtaking or by growth, and whether `DSC00669/00678` are the same line 5 minutes later.
5. **Frog questions** (frog §6): which part is the frog's head; satellites breaking off or feeding in; was the pano merged at native scale.

## Scratch files (local, not committed)
Node lists and help/parm dumps for §4: session scratchpad `.../scratchpad/houdini/` (`nodes.md`, `details/*.txt`, `pyro_parms.py`, `n3_hda.txt`). Writing them into `artifacts/research/extracted/houdini/` from this worktree was blocked by the session's file hook; copy if wanted.
