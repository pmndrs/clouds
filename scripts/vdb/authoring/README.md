# Hero-cloud authoring in Houdini (Cloud SOP + Cloud Noise SOP)

`build_heroes.py` builds `tower`, `valley-fog` and `fairweather` the way an artist would, then converts them with
`scripts/vdb/vdb_to_nvdf.py --mode fog` (default PACK_FIT mapping, 8 m voxels) into `assets/clouds/heroes/<name>/`.

```bash
HYTHON=/Applications/Houdini/Houdini21.0.671/Frameworks/Houdini.framework/Versions/Current/Resources/bin/hython
$HYTHON scripts/vdb/authoring/build_heroes.py                  # all three, about 30 s
$HYTHON scripts/vdb/authoring/build_heroes.py tower --voxel 8 --no-convert --tag _t   # fast experiment + preview PNG
$HYTHON scripts/vdb/authoring/build_heroes.py tower --hip tower.hip                   # open the network in Houdini
```
VDBs and preview PNGs (side view, centre slice, top view) go to `work/captures/scratch/p4e/` (`--work-dir`).
Render with the flagship: `?cloud=heroes/tower` (needs `'heroes/<name>'` in its `CLOUDS` list).

## Network (all metres, y up, base at y = 0)

`sphere SOPs (merge, polygons)` -> **cloud** -> **cloudnoise** (big) -> **cloudnoise** (medium) -> [**cloudnoise** (fine)]
-> **vdbsmooth** (mean, 1 iteration, radius 1) -> optional `volumewrangle` flat base -> save `.vdb` (grid `density`).
Edit the `RECIPES` dict at the top of the script; every value is a real parm name of the node (find them with
`hou.sopNodeTypeCategory().nodeTypes()['cloud'].parmTemplates()`). `--set cloud.densitymultiplier=3` or
`--set noise1.noiseamount=0.5` override one value from the command line.

## Knobs that matter

| Node / parm | Effect | Used here |
| --- | --- | --- |
| Source shapes | Overall silhouette. Ellipsoids (rx, ry, rz) give a fog bank; a single stacked column of spheres gives a smoke plume, not a cumulus. A cumulus tower is a broad flat foot plus rings of domed cells (6 per layer, 6 layers, radius about 100 m, ring radius 190-225 m, so mid-height is as wide as the base), a slim core, and a +x drift of 0.13 m per m of height for shear. Overlap them generously. | 8 to 30 spheres |
| cloud `uniformsamples=By Size`, `divsize` | Authoring voxel size (m). 4 m then area-averaged to 8 m keeps the fine noise clean. | 4 |
| cloud `exteriorband` / `interiorband` (with `useworldspaceunits`) | Width in metres of the soft density shoulder. **The noise only erodes where density has a gradient**, so a narrow band (the 0.1 default, or 50 m) leaves the spheres smooth. 120-200 m is what made the erosion visible. | 60 to 200 |
| cloud `densitymultiplier` | Steepness of the shoulder. With wide bands keep it low (2); high values re-saturate to 1 and hide the noise. | 2 |
| cloud `addsecondary`, `scatterpoints`, `secondaryshapesize`, `secondaryiterations` | Procedural small bumps stuck on the surface (cauliflower lobes). Keep `secondaryiterations` at 1 and points at 100-160: the default 2 iterations x 150 points never finished cooking. Size is in metres (about 1/12 of the cloud). | 1 / 110-160 / 28-55 |
| cloud `spatialscale` | Does not scale the output VDB; author in metres instead. | not used |
| cloud `flatten*` | Did not give a flat floor on a polygon model here; use the `volumewrangle` below. | off |
| cloudnoise `noiseelementsize` | Feature size of the noise in metres. Pass 1 about 1/4 of the cloud (big billows), pass 2 about 1/12, optional pass 3 about 25-30 m (the smallest the 8 m runtime grid can show). | 210 / 70 / 28 |
| cloudnoise `noiseamount` | Erosion depth. Needs to be large (0.5-1.5) relative to the density gradient above. | 0.45 to 1.5 |
| cloudnoise `noiseoctaves`, `noiserough` | Fractal detail and roughness of each pass. | 3-4, 0.5-0.6 |
| cloudnoise `advectnoise`, `advectamp`, `advectelemsize` | Domain warp: swirls the lumps so they look sheared and rolled instead of uniform. | on for big passes |
| vdbsmooth | One light mean filter before resampling, so no voxel stair-steps remain. | 1 x r1 |
| flat base `volumewrangle` | `@density *= smooth(base, base+fade, @P.y)`: flat bottom for fair-weather cumulus and ground fog. | tower 15 m, fairweather 40 m, fog 0 m |
| `--iso` (converter) | Density level that counts as the cloud surface. 0.3 for towers and cumulus; 0.15 for thin fog so it stays connected. | see recipes |
| `scale` (recipe) | Scales the layout and every length parm together. Needed when over the size budget below. | 1 (all) |

## Size budget

`nvdf.bin` (4 bytes) + `sdf.bin` (2 bytes) are dense over the bounding box, so size = 6 x dims. The 4 MB cap is about
650 k voxels at 8 m. The P4-E column tower (1.2 km x 800 m wide) was 7.5 MB and had to be built at scale 0.77. The P4-E2 congestus tower is about 690 x 930 x 580 m and is 3.58 MiB at scale 1. The
fog bank is thin and long, so it fits full size. To author a bigger cloud, raise `--voxel-size` in `convert` to 12
(the loader accepts it, only 8 m is verified), or accept a bigger file.

## Make your own

1. Copy a recipe and a `*_spheres` function (or replace the sources by a curve + sweep, or any closed polygon / point-with-pscale model; for points set the Cloud SOP `input` to 1).
2. Start with a wide band and low `densitymultiplier`, look at the preview PNG, then add noise passes coarse to fine.
3. Convert and render in the flagship; judge the edge and backlit views. If the base is too dark use the converter's `--scale-gain` (P4-B), not the VDB.

## Tower (P4-E2 rebuild)

The first tower (one stacked column of spheres) read as a smoke plume. The congestus recipe: 5 flattened foot ellipsoids (y centre 125, ry 125, wide in x/z), then 6 layers of 4-6 domed cells (ry = 1.2 rx) on rings, a slim core, 2 crowning domes at different heights, everything leaning +x with height. Cloud SOP bands 200 m, secondary shapes 160 points at 42 m, 3 Cloud Noise passes (210 / 70 / 28 m), flat base wrangle at 15 m. The cells keep notches between them because the core is narrow; if you widen the core the silhouette fills in to a column again.

## Opening the rigs in Houdini (for the owner)

Every network the agents build is saved as a small `.hip` in `houdini/rigs/`. Open one with Houdini 21 (Indie is fine), go to `/obj/<rig name>`, and the whole network is there with notes.

| Rig | From | What it is |
| --- | --- | --- |
| `hero_tower`, `hero_fairweather`, `hero_valleyfog` | `build_heroes.py` | sphere sources, Cloud SOP, Cloud Noise passes, smooth, flat base. Cooks in about a second at 8 m. |
| `sim_cumulus`, `sim_congestus` | `sim_clouds.py` | Pyro emitter, solver, remap, warp. These two keep the old `temperature0 = 0` (buoyancy off, see sim README); the solver note says so. |
| `library_congestus-a`, `library_mediocris-a` | `library.py` (L2 buoyant templates) | open these to fix the chimney failure |
| `texas_tower` | `targets.py` (base recipe v00) | multi-emitter plus inversion lid; the L1 target |

What is inside every rig:
- **`CONTROLS`** null (orange). Open its parameter pane: tabs for each stage hold the key values. The real nodes read them with `ch("../CONTROLS/...")`, including inside the VEX, so change them here, not on the nodes.
- **Network boxes and sticky notes** per stage (source, solver, post, export), each saying what the stage does and why, with the source docs.
- **`export`** ROP Geometry Output. It writes `houdini/cache/<rig>.vdb` (the folder is gitignored). Sim rigs write the current frame only; set a range if you want more.
- **Run converter** button on `CONTROLS` (`convert_args` holds the options). It runs `vdb_to_nvdf.py` on the exported VDB into `houdini/cache/nvdf/<rig>/`. Copy that into `assets/clouds/...` to use it.

Sim rigs are saved **without simulating**: scrub the timeline from frame 1 to run the Pyro solver (about 30 s for 180 frames). Changing any control restarts it. The `grow_region` box in the post stage is a generous estimate here (the builder sets it per checkpoint from cooked bounds); widen it if the cloud is clipped.

Rigs are copies, not a live link. When you find better numbers, copy them back into `RECIPES` / `LIBRARY` / `TEMPLATES` and rerun the generator, or tell the agents.

Regenerate all rigs (about 30 s; waits on nothing, but needs a Houdini license seat, retry if busy):
```bash
$HYTHON scripts/vdb/authoring/rigs.py            # all   (--list shows the names, give names to do some)
$HYTHON scripts/vdb/authoring/rigs.py --verify   # open each .hip, cook its first stage, print nodes and file sizes
```
`rigs.py` never touches `lens_seed.hip` or `frog.hip` (other tasks). Not in the rigs yet: review camera with photo plate, `cloudlight` preview, harvest back into the recipe dicts (plan in `docs/research/topics/authoring.md` section 8).
