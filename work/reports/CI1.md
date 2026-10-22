# CI1: cirrus coverage and type from the weather map

## What changed
- NE22 reads thin-cloud coverage and type per column from the map; ours were global settings plus a 50 km noise. The HZD map now carries **two thin-cloud fields in its spare alpha channels**: layer 0 A = cirrus type (stored 0.1 + 0.9 x type, so 0 means "no data"), layer 1 A = cirrus coverage. The generator (`procedural/hzd/ndf.wgsl.ts`) writes them as independent low-frequency fBMs (3 and 2 octaves); `packHzdNdfGen` has a 9th vec4; `hzdNdfKey` includes the new settings. The weather compose pass passes the alphas through (they were zeroed before), so weather transitions and painted influence keep them.
- Setting `cirrus.source: 'global' | 'map'` (**default `map`**; `global` is the old behaviour, kept). In `map` mode `render.wgsl.ts` `localLook` reads the fields at the layer's own wind (not the low clouds' drift), `cirrus.mapScale` = 8 tiles wide (a 32 km map would otherwise repeat every 32 km at 9 km up; the fields repeat every 256 km). Coverage = `coverage` + `mapCoverageGain` (0.8) x (field - 0.5); type = `type` + `mapTypeRange` (0.35) x 2 x (field - 0.5). The global value stays the **mean**, so the weather states (which set `cirrus.coverage` / `veil` from `bench/weather.ts`) keep working unchanged; veil stays global. In map mode the 50 km `coverageVariation` is not used.
- Fallbacks: no map (other shapers, non-procedural pages), or a map whose type alpha is 0 (authored `uploadHzdNdf` maps, image-overlaid maps; `HZD_NDF_IMAGE_WGSL` overwrites layer alphas with 0) read the global look with its 50 km variation, per pixel.
- Plumbing: `ProceduralDensityModel.ndfMap` (the served map, weather-composed, own cached view) passed to `cirrus.encode`. The mid-level layer instance is forced to `source = 'global'` each frame (L3 unchanged; checked in `mid-layer-check`).
- New map settings (tune group "Weather map (NDF)"): `ndf.cirrusCells` 4 (cells per 256 km cirrus tile, so ~64 km features), `ndf.cirrusTypeCells` 3, `ndf.cirrusContrast` 1.6. Cirrus group: `cirrus.source`, `mapScale`, `mapCoverageGain`, `mapTypeRange`. URL: `cirrus_source=global`, `hzn_cirrusCells=...`.
- Cirrus is **off in the bench by default** (`cirrus.enabled` false, as in CIRRUS_DEFAULTS; not changed). The Review section's **CI1** switch has old global / new map plus a "turn cirrus on" button (the show-switch).
- Left alone: the cov^2 vs NE22 cov^3 fade (`cirrus.coverageFadeNe22`).

## What I saw (work/captures/CI1/sheet.jpg: rows ground, gp7, sky = gp7 at pitch 50 fov 75, horizon; columns cirrus off, global, map; frozen, `cirrus_coverage=0.5`)
- Same noise tile and wind offset in both columns, so the streaks sit in the same places; map changes how much cover each area gets and which noise type shows (gp7: streaks thicken in the top-left and thin out lower; sky: a rounder, cirrocumulus-like patch top centre next to streaks). Just different, not clearly better in a single frame; the point is that cover and type now differ across the sky from the map instead of one slider plus noise. From the ground and horizon views cirrus covers little sky, so the difference is small there.
- Weather (sheet-weather.jpg, `wx=clear` / `overcast`, source global vs map): clear gives sparse cirrus in both, with the map version showing more distinct patches and clean gaps; overcast is dominated by the veil (global), the two are indistinguishable. States work with the map source.
- `mapCoverageGain` was lowered from 1.2 to 0.8 after the first look: the map's field spreads about +-0.4 against the old noise's +-0.2, and 1.2 gave visibly more wisps than global at the same coverage.
- Possible issue: a coverage field is correlated with nothing (independent of the low-cloud map, as NE22's thin-cloud NDF is a separate one); no link to the storm cell's cirrus patch.

## Cost
Cirrus pass 0.4-1.4 ms in both modes at machine load ~35 (global 1.11 / 1.36 / 0.51 / 0.69, map 0.94 / 0.99 / 0.65 / 0.39 for ground / gp7 / sky / horizon): no measurable difference (two extra texture reads per pixel; the map gen adds two fBMs to a sub-ms one-off dispatch). Absolute numbers are inflated by load.

## Checks
`pnpm typecheck` clean; `pnpm test` 320 passed (the ndf test now expects a 9-vec4 generator uniform and has a CI1 case). Commits are on the worktree branch.

## Left
- Authored / image maps carry no cirrus fields (fall back to global); the paint tool has no cirrus channel yet.
- The fields repeat every 256 km at 8x; a bigger `mapScale` trades repetition for feature size at the same `ndf.resolution`.
