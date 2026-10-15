# STORM1: authored storm area, anvil + cirrus, storm lighting

Branch `worktree-agent-a72617b7c27e6cdfe`. Sheet: `work/captures/STORM1/STORM1-sheet.jpg` (columns: no storm / F1 placed cell / new; row 1 ground,
row 2 horizon, row 3 from 9 km back; last column: lightning glow held on, then the painted-map tests with and without a mask).
Steps 1-3 done. Step 4 (rotation rings) NOT done (see Left).

## What changed

**1. Storm area as a map channel (NE22 p.138-146: authored storm NDF).** The NDF's layer 1 B (unused until now) is a sixth field, `storm`
(0 none .. 1 core).
- Generated map: a default ragged blob (`ndf.stormBlob`, `ndf.stormX/Z/Radius`, default 1 at (-4.5 km, -10.5 km), r 3 km; wobble from a 2-octave fBM). It does
  nothing until `hzd.stormStrength` > 0.
- Authored: `heightImage`'s B channel (replace path), `maskImage` blends it with the heights (influence path), compose pass carries it through weather lerps.
- Painter: new **storm** channel (own tick/value, recipes "storm" / "no storm"), saved in the height PNG's B, loaded back, read back from the sky, uploaded
  through `setNdf` (`HzdNdfFields.storm`). Strokes stamp influence as the other channels do (so a painted storm leaves the generated sky only under the brush).
- Shader (`hzd/shaper.wgsl.ts`): with `stormSource: 'map'` the column is a storm where the channel is. The core is thresholded higher with height
  (a cone), with a wide fall-off so the shape noise draws the wall; the top goes to `stormTop`; the F1 cumulonimbus gradient, glaciated top erosion and hag terms
  all apply unchanged (they key off the storm weight).
- The placed cell is kept: `stormSource: 'cell'` is exactly F1.
- The map tiles, so a storm would repeat every 32 km. `stormSingle` (default true) windows the channel to the one tile around the world origin (fades over the
  outer 12 %). This also means a storm painted near the map edge is faded.

**2. Anvil.** The footprint is the storm area seen from upwind: a soft union of 8 taps of the channel shifted downwind (`anvilShear`, growing with height from h 0.6)
and sideways (`anvilSpread` x blob radius), used in n17's anvil band (h 0.7-0.8). So any painted storm grows a sheared plate downwind. Extra cost only in the
top 40 % of a storm column when `stormStrength` > 0.
**Anvil cirrus** (`anvilCirrus` = extinction, 0 = off): a thin slab around the storm top continuing the footprint `anvilCirrusLength` further downwind, the
Perlin-Worley read stretched `anvilCirrusFiber` : 1 along the wind plus a finer octave (`hzdAnvilCirrus`, merged in `procSample`; works for both sources).

**3. Storm lighting.** `stormDensity` (extinction in the storm), `stormDark` (dims the light, up to 0.85x, most below h 0.8: column and anvil underside; in the trace),
`stormGlow` x `stormFlashRate` (internal lightning: a flash envelope with flicker, random place inside the blob per flash, radius 1.5 km; rate 0 holds one flash on
for captures). `ProcSample` gained `glow` and `storm`; ProcParams gained three vec4 (`hzStorm3..5`, offsets `PROC_HZD_STORM_OFFSET`).

## Settings (tune panel group "Storms and anvils"; URL `hz_<key>` / `hzn_<key>`; one-line docs are the settings.ts doc comments)

| key | default | meaning |
|---|---|---|
| `hz.stormStrength` | 0 | 0 = off; gain of the map storm (or the cell's strength) |
| `hz.stormSource` | `map` | `map` = the NDF storm channel, `cell` = F1's placed cell (kept) |
| `ndf.stormBlob`, `ndf.stormX/Z`, `ndf.stormRadius` | 1, -4500, -10500, 3000 | the generated default blob (also places the anvil spread and the lightning) |
| `hz.stormSingle` | true | storm only in the one map tile at the origin |
| `hz.anvilCirrus`, `anvilCirrusLength`, `anvilCirrusDepth`, `anvilCirrusFiber` | 0, 8000, 700, 6 | the anvil cirrus |
| `hz.stormDensity`, `stormDark`, `stormGlow`, `stormFlashRate` | 1, 0, 0, 0.7 | lighting (all neutral/off) |

Bench: view `storm` (`view=storm`: ground, looking at the blob, sun to the side) and URL `storm=1` (preset: strength 1, map, hag flatten 1, density fix 0.5, cirrus 0.008,
density 1.6, dark 0.7; explicit `hz_` keys in the link still win). Defaults of everything else are unchanged (storm off), so existing links look the same.

## Bench links (adjust the port; coverage 0.2 so the storm is not hidden behind the cumulus in front, the default map has a cloud mass there)

- Old (F1 cell, same place and size): `http://localhost:5180/hzd/?view=storm&fov=70&pitch=14&lookaz=338&coverage=0.2&hz_stormStrength=1&hz_stormSource=cell&hz_stormX=-4500&hz_stormZ=-10500&hz_stormRadius=3000&hz_anvilFlatten=1&hz_anvilDensityFix=1`
- New: `http://localhost:5180/hzd/?view=storm&fov=70&pitch=14&lookaz=338&coverage=0.2&storm=1`
- From a distance: add `&pos=0,2,9000&pitch=22&fov=75`. Horizon: `view=horizon&pitch=10`. Lightning: add `&hz_stormGlow=2&hz_stormFlashRate=0` (or leave the rate).
- Painted test (storm in the height PNG's B, plus a mask): `...&view=storm&lookaz=5&fov=100&pitch=20&hz_ndfMotion=static&storm=1&hzn_image=/clouds/ndf/painted/storm1-east.png&hzn_heightImage=/clouds/ndf/painted/storm1-east-height.png&hzn_maskImage=/clouds/ndf/painted/storm1-east-mask.png`
  (add `&hzn_paintBlend=replace` for the old behaviour). Both storms show with the mask (default blob west, painted east); replace shows only the painted one.

## Versus NE22 and F1: just different, partly worse

- Better than F1: the area is authored and paintable (any shape, any number of storms, in the painter), the anvil follows it, there is a downwind cirrus patch (NE p.161),
  storm lighting exists (dark, dense, internal flash; F1's "left" list).
- Worse than F1's cell in the look of the plate: the old cell gives a clean round mushroom; the map anvil is an irregular sheared plate (a soft union of taps, still
  a little angular), flat blue and translucent from the side (the shaded body takes sky colour: D1's lighting problem, unchanged), with a thin bright outline.
- The column is a smoother, lower-detail cone than I would like; its detail is the same erosion as F1.
- The cirrus patch reads as bright torn streaks (stretched noise, one slab) not NE's fibrous formation; it is detached from the plate where the footprint tapers.
- Dark/dense lighting is visible within ~6 km; at 10-20 km aerial perspective washes it out (as any cloud).
- The lightning glow is a soft sphere inside the column, not channels or flicker structure.
- Not NE: no storm NDF layers (one channel), no rotation, no mammatus.

## Cost (ultra, 1920x1080, headless on the shared GPU; sky layer ms, ground view, two repeats)

| | skyLayer | frame total (noisy) |
|---|---|---|
| no storm in view (`stormStrength` 0) | 21.5-22.7 | 50-65 |
| F1 cell | 41 | 88 |
| map, bare (strength 1, no cirrus / lighting) | 37 | 133 (noise) |
| map, preset (cirrus + lighting) | 36.4-38.3 | 80-134 |
| map + glow | 37.3 | 120 |

A storm in view costs about +14-18 ms of sky layer at this size, the same as F1's cell (the shell to 10 km and the tall column are the cost, not the new terms: the anvil taps,
the cirrus slab and the lighting are inside the noise, under about 1-2 ms). The earlier estimate (+0.5 to +1.5 ms) did not hold for a storm filling a quarter of the view at ultra.
A storm outside the view costs nothing measured (the other views' off numbers are the same as before). The storm-on shell stays at 10 km whenever `stormStrength` > 0 even when no storm is in
view (as F1); not measured separately.

## Verified / not verified

- `pnpm typecheck`, `pnpm test` pass (new tests: NdfGen pack, storm channel in fields, offsets).
- Browser: all captures above, no console errors. The painted-map path was tested through PNGs + mask. The painter UI itself (the storm channel row, saving) was NOT driven by hand;
  it is covered by the fields unit test and typecheck only.

## Left

- Step 4, rotation rings (NE p.147-158): not started.
- Anvil edge fibres, mammatus, a dark base that survives aerial perspective, the flash as a real branching/localized term.
- Anvil cirrus tied to the NDF's own cirrus layer; smoother footprint (a blurred dilation baked in the compose pass instead of taps).
- Cost: the storm shell/column cost (a 10 km shell march) is the thing to fix, with the main perf pass.
- Dev note: the capture script's vite runs with CLOUDS_NO_WATCH=1, which also stops module invalidation: restart it after every shader edit or you capture the old code.
