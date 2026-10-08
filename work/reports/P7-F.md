# P7-F Slab-sided generated clouds
Status: ready for review
Changed: packages/runtime/src/generate/shaders.ts (weatherMain coverage profile), packages/runtime/src/generate/presets.ts (cumulus topFraction 0.8 -> 0.65), examples/lab/open-water/main.ts (demo uses the preset `cellular`; `?cellular=` still overrides), work/BOARD.md.
Verified:
- `pnpm check` -> exit 0 (checked directly, not piped); `node scripts/check-packed-consumer.mjs` -> PACKED CONSUMER OK.
- captures: work/captures/P7-F/{ow,cg,pf}-{before,after}/ and `*-before-after.jpg` (top = before, bottom = after). Before = old code, open-water at `?cellular=0.75` (preset).
Root cause (not the Voronoi creases): the weather coverage was `smoothstep(lo, hi, n)` of a cone-like field and the shape stage builds the cloud as `f = cov - h^p`.
1. cov is used as the *height profile* (h = s^(1/p)). The smoothstep saturates in the middle of every cell, so the core is a plateau (top clipped flat) and the rim ramps over ~200 m while the cloud is ~410 m tall: a column with near-vertical sides (a hemisphere's equator is vertical; here it spans most of the height). Seen from 300 m, saturated and flat-lit, that reads as a slab. A debug top-down view (sky_debug=1) shows round footprints, so the creases were not the main cause; the vertical silhouettes are.
2. Height-to-width aspect ~2:1 (topFraction 0.8 of a 512 m shell over a ~200 m lobe radius); the preset comment itself says tops 150-300 m.
Fix:
- weatherMain: `u` = linear ramp (remapped to start at 0.2 so the footprint stays where the presets tuned it), `cov = (1 - (1-u)^1.7)^1.6`. With p = 1.6 this makes the level set a mound `r = R (1-h)^(1/1.7)`: finite slope at the base (tapered, no vertical wall), horizontal tangent at the top, no saturation plateau, smooth at the rim. It is in the weather map, so the sky layer and the reflection dome (which bake the same weatherMain) change with it; no shader outside generate/ touched.
- cumulus topFraction 0.65 (aspect closer to 1:1; 0.55 looked squat).
Measures:
- No flat vertical faces or straight creases: open-water cruise/horizon, cloudscape-gen ground/horizon/above all show rounded, tapered lumps (read the side-by-sides). pass
- Generation cost: weatherMain gained two pow() per texel on a 512^2 one-off map; NVDF/EDT/profile/SDF passes unchanged. Cloud GPU unchanged within noise (open-water cruise cloudsTotal 4.11 -> see ow-after/capture.json). pass (well under 10%)
- Plains-flight swapA vs swapB mean |d|: 0.52/255 before, 0.60/255 after (<= 1/255). pass
- `pnpm check` green, packed consumer OK. pass
Open issues:
- Clouds are a little smaller in footprint and lower than before in all cumulus scenes (visible in the cg-above pair); other presets (congestus 1.35, stratocumulus 3.2) get the same profile (baked for p = 1.6) and were not re-tuned or captured.
- Weather-map change shifts every generated field, so any golden image of generated clouds moves.
- The demo keeps its own lo/hi/cellScale (0.56/0.9); with the preset lo/hi 0.42/0.8 the open-water cruise camera sits inside overcast, unrelated to this task.

## Orchestrator review
Accepted. `pnpm check` exit 0, re-run independently. Open-water `cruise` at the preset `cellular` 0.75: the slabs and flat faces are gone and the clouds read as rounded mounds. I also captured the congestus and stratocumulus presets before and after (`cg-other-presets-before-after.jpg`, `cg-{congestus,stratocumulus}-{before,after}/`): no regression, and edges are slightly rounder. On cost, I accepted the reasoning without a timing: two `pow` per texel on a one-off 512² weather pass is negligible next to the 3D generation passes.
