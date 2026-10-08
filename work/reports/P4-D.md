# P4-D Onsen valley demo
Status: ready for review (composition is decent, not final art)
Changed: new `examples/lab/scenes/terrain/{index,heightfield,pool}.ts`; `examples/lab/onsen/main.ts`. Nothing else.
Verified:
- `node scripts/gpu/capture.mjs --serve --page onsen/ --size 2560x1440 --shots vantage,valley,sunset --out work/captures/P4-D` -> exit 0. `pnpm check` green.
- Captures read: layered forested ridges and a far wall, valley-floor fields, low fog banks (stamped valley-fog) in the valley, fair-weather and generated cumulus overhead, a pool reflecting sky/clouds, rocks. `sunset` is the strongest (sun 1 deg, glowing mist and ridges). `vantage`/`valley` are plainer: foreground ground is soft grass noise, fog still reads somewhat like thin cloud bars.
Measures (2560x1440, GPU ms from the report): whole frame total 13.7 / 14.3 / 9.2 ms (vantage/valley/sunset): scene 4.0 / 4.7 / 4.2 (sky, haze, terrain, pool, rocks), clouds 9.7 / 9.6 / 5.0 (lightGrid is a one-off 4.4 early on). Terrain alone: scene 2.2 ms with terrain vs about the same without in an earlier A/B (noise-level); before baking the sun shadow into textures the terrain cost ~26 ms, now well under 2 ms. Frame p50 16.7 ms (60 fps vsync).
Integration lines: 10 tagged `// INTEGRATION` (<= 20).
How it works:
- Terrain: one heightfield function (CPU) baked into 3 nested half-float tiles (47/10/1.8 m texels, hi+lo height + slopes); a static polar grid (526k verts) samples them in the vertex shader; pool basin and the viewing rise are added analytically. Material: slope/height tint (meadow, fields, forest, rock) from a tileable noise texture. Sun shadow from the heightfield is marched into a per-tile shadow texture when the sun moves (installed as the sun light's custom `shadow.shadowNode`, so rocks and pool receive it; needs `renderer.shadowMap.enabled`). Cloud shadows come from the composite alpha, untouched.
- Clouds: one 512x512x96 @12 m generated cumulus region (floor y=0), stamped with 10 valley-fog banks along the valley axis (found by scanning the heightfield), 5 fairweather, 1 tower; SDF rebuilt once at startup (~1 s build). Haze via `sky.applyHaze`. Optional `?skylayer=1`.
- Params: `?time= ?bookmark= ?drift=0 ?terrain=0 ?pool=0 ?clouds=0 ?shadow=0 ?fogd= ?haze= ?hazestrength= ?exposure= ?pos=x,y,z&az=&pitch=` (free camera).
Open issues:
- Valley fog is static (no re-stamp drift); fog is bright vs the dark valley; tune `?fogd=`.
- The terrain heights far away are alpine and a bit spiky; foreground ground lacks trees/steam/props. The tower asset is the pre-rebuild one (loaded by name).
- Shadow bake renders 3 fullscreen quads on sun change (bookmark swap), a small hitch.
- Pool uses its own `pool.ts` (the ocean module follows the camera and its ripples are too choppy for a spring); it duplicates ocean's `ReflectionLighting` hook (could be exported from there).
- `lightGrid` 4.4 ms appears in the first seconds and in the report average; steady state is lower.
