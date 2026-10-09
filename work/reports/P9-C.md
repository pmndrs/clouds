# P9-C Species profiles (vertical-profile tables)
Status: ready for review (one acceptance item fails: render cost, see Measures)
Changed: `packages/runtime/src/generate/` (shaders.ts, weather.ts, presets.ts, volume-generator.ts, index.ts, new species.test.ts), `sky-layer.ts`, `shaders/sky-layer.wgsl.ts`, `runtime.ts` (one line: the timer to `skyLayer.prepare`), new `examples/lab/species/`, and my line in `vite.config.ts`.
Verified:
- `pnpm check` exits 0 (44 files, 224 tests). `node scripts/check-packed-consumer.mjs` exits 0.
- `runtime-tests/generate/` passes all 42 checks. `sky-bake/` passed 3 runs. Smoke captures of evolve, plains-flight, storm, open-water, compare, stamp and library exit 0.
- Captures are in `work/captures/P9-C/`:
  - `species-sheet.jpg`: the labelled contact sheet, 8 species by ground, side and above.
  - `species/<species>-<view>.jpg` and `-capture.json`.
  - `parity.jpg`: the voxel field alone and the sky layer alone over the box, from the ground and from above.
  - `walls.jpg`, `horizon-rule.jpg`, `variety/` and `timing.txt`.
What it does (NE pp. 20–29, mapped onto our level set `f = s − g(h)`):
- **Vertical table** (`SP_*` rows in `SPECIES_WGSL`, shared by the generator, the weather pass and the sky layer; selected by G: 0 stratus, .25 Sc, .5 humilis, .75 mediocris, 1 congestus; interpolated):
  - **top type:** the exponent p, with column top = mass^(1/p);
  - **bottom type:** the metres the base sags under a full-mass column;
  - **min height:** `baseDefault` plus an offset;
  - **max height:** a depth in metres. The per-cloud max height is the cell's peak mass through that depth.
  - The row also sets the billow amplitude and cell size, the NE p.99 flip height (wispy below flip−0.1, billowy above flip+0.1) and the density scale.
  - At the rim p falls to 2 (`edgeExp`), so flat-topped species get rounded shoulders instead of walls.
- **Horizontal table** (`H_*` rows, weather pass), read per cell from its species: presence by size class, size, growth push, turrets, elongation and wind alignment (Sc rolls), and the sheet weight.
  - Stratus is a sheet. Stratocumulus is a sheet banded along the wind (`windFrame`) with varying thickness, with lumps only on the sheet.
  - Species taller than the volume are narrowed by √(height lost), so congestus in a 512 m box stays a tower instead of a clipped dome.
- **Upper layer** (altocumulus, weather A, which replaces the unused top-height channel): small cells on a near-regular lattice, in patches along the wind. It has its own base and depth (`NvdfParams.altoBase/altoDepth`; `altoFractions` moves it down to fit a short box). The voxel takes the union with the low layer, and the sky layer evaluates both.
- **Cheap items:**
  - NE p.102 thin-cloud noise offset, in both the generator and the sky layer.
  - HZD s45 horizon rule in the sky layer's bake. It is scaled to our 30 km range, 12.9–30 km toward mid-coverage mediocris.
  - Terrain stub (`VolumeGeneratorOptions.terrain`, r16float metres): clouds stand on the ground and thin out within 48 m of their top. The species page's `valley` shows a valley sea.
  - `createWeatherBake` is exported. The timer is passed to `prepare`.
- **Presets:** humilis, mediocris, congestus, stratocumulus, altocumulus, stratus and mixed, plus the existing cumulus and storm (storm is unchanged and uses the old law). The tall presets set `volume` (384×384×128 at 16 m).
- **Species page:** `?species=…`. Views are ground, side, above, horizon and wall; a species-name bookmark regenerates that species. `?timegen=1` reports generator timing.
Measures:
- **Species read as different** in `species-sheet.jpg`:
  - humilis: small, flat puffs, wider than tall;
  - mediocris: domes about as tall as wide;
  - congestus: 1.6 km towers with cauliflower heads;
  - Sc: a lumpy sheet in bands with gaps, sheared;
  - Ac: regular small cells in patches, high;
  - stratus: a featureless grey lid;
  - valley: a sea pooled between the hills;
  - mixed: Ac over humilis, mediocris and towers, all in one sky.
- **Variety, default runs:** all pass. Clone scores: cumulus 0.44 (cover 31%), congestus 0.53, stratocumulus 0.55, open-water 0.46. Cumulus at seeds 3 and 11: 0.42 and 0.41, all pass.
- **Variety, species page** (tall volumes with `--min-lobe-area 13`):
  - mixed 0.32, congestus 0.42, mediocris 0.41, humilis 0.57 and cumulus 0.43 (cover 37%) pass all measures; base spread is 8–16 m everywhere.
  - species-stratocumulus (no border, sky on) fails at clone 0.60, CV 0.69. The acceptance run (cloudscape-gen) passes.
  - The mixed sky is scored on the columns below the Ac layer (`?fields=low`).
- **Box wall:** `parity.jpg` shows the same clouds in the same places, at the same heights and in the same shapes, from the voxel field alone and from the layer alone. There are no straight cuts at the wall in `walls.jpg`, apart from the bright column noted below.
- **Generation per job** (HEAD vs now, same machine): cumulus 0.363 → 0.421 ms (+16%), congestus 0.402 → 0.348, Sc 0.312 → 0.343 (+10%). Worst job 1.26 → 1.40 ms. This needed `billowSigned`, which stops billow octaves once the sign is decided; occupancy is exact.
- **Bake:** worst frame 0.93 ms over 9 changes. The 32-row tiles reached 0.92 ms, so the default is now 24 rows (87 frames to swap). The tiled bake is identical to one-shot.
- **Render cost FAIL:** cumulus with the sky layer at 2560×1440 on high is 4.5–5.3 ms; HEAD was 3.4–4.1 ms, already over on ground. The mixed scene is 4.9–5.1 ms.
  - The profile code costs nothing measurable: humilis with profiles on vs off is 3.74 vs 3.72 ms.
  - The increase is content: the required 30–40% cover and taller clouds. The march goes 0.56 → 0.96 ms, the dome 0.39 → 0.74 ms and the sky layer 1.3 → 1.6–1.9 ms.
Open issues:
- **Cost:** it needs a step or LOD budget in the sky layer and dome; `dome.wgsl.ts` is not mine.
- **Wall column:** there is still a bright column on the voxel side of the wall (P9-B2's light-grid edge). It is wider in `walls.jpg` because that camera stands on the wall plane.
- **Stratus streaks:** thin bright streaks at the horizon on stratus, from the far, thin layer at grazing angles (as P7-E).
- **Horizon rule:** the effect is small (rows 556–574 change by up to 6–10 grey levels; `horizon-rule.jpg`), because aerial perspective hides that range.
- **Altocumulus resolution:** at 16 m, cells smaller than ~230 m spacing go dusty in the voxel field, so the default is 18 cells per 4 km.
- **Terrain stub:** generator-only. The sky layer has no terrain.

## Orchestrator review
Accepted as a large step; follow-ups opened. The species sheet shows distinct species, and variety passes on every preset. `pnpm check` was re-run independently. Not accepted as finished: altocumulus reads as a polka-dot lattice; congestus towers have cylinder walls; stratus shows the box outline from above; near clouds in side views have streaky textures (all → P9-C2). The high tier is 4.5–5.3 ms against a 3.5 ms budget (→ P9-C3). The bright wall column is carried to P9-C3.
