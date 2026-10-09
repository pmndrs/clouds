# P9-A Variety metrics
Status: ready for review
Changed: `scripts/variety.mjs` (new), `scripts/variety.test.mjs` (new), `examples/lab/harness/clouds-contract.ts` (additive `fields` hook + `readCloudColumns`), `examples/lab/cloudscape-gen/main.ts` and `examples/lab/open-water/main.ts` (pass `fields`, 3 lines each).
Verified:
- `pnpm check`: vitest 43 files / 213 tests pass, build passes. `pnpm typecheck` exits 2 only on `packages/runtime/src/shadow-map.ts(153)` (P10-A's file, tuple type), twice. My files are clean.
- `node scripts/variety.mjs --serve` runs the four pages in ~25 s total: `work/captures/P9-A/variety.json`, `variety.txt`, per run `<name>-coverage.png` (lobes coloured, base height as brightness; right: silhouette contact sheet used for the clone score), `<name>-horizon.jpg`, `-above.jpg`. Raw field dumps go to `work/captures/scratch/P9-A/` for `--file` re-scoring.
- `calibration.txt` there: single overrides move the right metric the right way.
Source of each measure (no image heuristics): the generated NVDF volume is read back from the GPU through `__clouds.fields()` and reduced per column (thickness, lowest and highest occupied voxel). That column map is an orthographic top-down view. Screenshots are for humans only.
Measures (today's presets, 4 km box, thresholds from plan 9-B/9-C):
| run | footprint CV (>=0.7) | ratio (>=10) | base spread (<=30 m) | cell-spacing peak (<0.05) | clone (<=0.6) |
| --- | --- | --- | --- | --- | --- |
| cumulus | 0.47 FAIL | 20 | 48 m FAIL | 0.022 | 0.73 FAIL |
| congestus | 0.59 FAIL | 28 | 64 m FAIL | 0.005 | 0.72 FAIL |
| stratocumulus | 0.96 | 265 | 24 m | 0.012 | 0.77 FAIL |
| open-water (sky=0) | 0.64 FAIL | 29 | 56 m FAIL | 0.011 | 0.61 FAIL |
Today's cumulus fails 3 of 5 (CV, base spread, clone). All four presets fail overall (stratocumulus on clone alone).
Open issues:
- Footprint CV and ratio are gated on lobes, not plan-literal connected components. At 45% coverage the components are merged clusters (30 footprints, 202 to 35184 columns, CV 1.62, ratio 174) so the literal measure passes today's cumulus; it is kept as `connectedFootprint` in the JSON. Lobes = blur thickness, climb to local maximum. Needs the orchestrator's OK.
- The ratio passes everywhere and is mostly noise; CV and clone are the useful signals. Lobes under 50 columns (about 64 m) and edge-touching lobes are ignored.
- The cell-spacing peak is weak: today's weather has jittered cells, so it only rises on a true lattice (`w_cellular=1`: 0.069). The 0.05 threshold is my calibration, not the plan's ("no peak").
- Clone score is biased low for very small lobes (`w_cellScale=24`: 0.54 on voxel-quantised silhouettes). Lobes narrower than 10 voxels are skipped.
- Box only: with the sky layer the 2.5D clouds beyond the 4 km box are not measured. `open-water` is scored with `sky=0`. open-water has no `above` bookmark, so it has no top-down shot (coverage png covers that).
- Plan 9-B's "base spread within a layer" is taken as P95-P5 of base height over core columns (>= 8 voxels thick); quantised at one voxel (8 m).

## Orchestrator review
Accepted. Variety tests pass (3/3), re-run independently. The failing `pnpm check` is P10-A's in-progress `shadow-map.ts`, not this task. Judgement call 1 is accepted: footprints are measured as lobes split at thickness peaks, and the plan is updated to match. Connected components merge clusters at 45% coverage and pass today's cumulus, so the literal measure was meaningless. Baseline: cumulus fails CV (0.47), base spread (48 m) and clone score (0.73). The `fields` hooks in the cloudscape-gen and open-water pages share files with P10-A's edits, so they are committed with P10-A.
