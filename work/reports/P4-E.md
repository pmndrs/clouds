# P4-E Houdini hero clouds with Cloud / Cloud Noise SOPs
Status: ready for review
Changed: scripts/vdb/authoring/{build_heroes.py,README.md} (new), assets/clouds/heroes/{tower,valley-fog,fairweather}/ (new), work/captures/P4-E/ (new).
Verified:
- `hython scripts/vdb/authoring/build_heroes.py` -> 3 VDBs (4 m, density grid) cooked in 1-5 s each, converted with `--mode fog` (PACK_FIT default), 8 m voxels. Whole run about 30 s.
- Rendered in the flagship through a scratch copy of the repo (outside the worktree) whose `CLOUDS` list had the three names added; the real flagship was not edited. Captures ground/edge/backlit for each: work/captures/P4-E/<name>-<shot>.jpg, preview PNGs of the VDBs, and side-by-side.jpg (rows ground/edge/backlit; columns P4-A houdini-test, tower, valley-fog, fairweather).
Measures:
- tower: dims 74x69x117 voxels (592 x 552 x 936 m), 3.42 MiB (3.59 MB). Authored at scale 0.77 of the 1.2 km / 900 m spec: dense storage makes the full size 7.5 MB (over the 4 MB cap). Converter `--iso 0.3 --margin 1`.
- valley-fog: 273x49x21 (2184 x 392 x 168 m), 1.61 MiB. `--iso 0.15`.
- fairweather: 82x68x44 (656 x 544 x 352 m, about 700 m), 1.41 MiB, flat base by wrangle.
- Look: the tower shows a sheared trunk, lobed cauliflower head and wispy foot, clearly more structured than the displaced-sphere houdini-test; fairweather has a lobed top and flat soft base; the fog bank is a continuous lumpy ribbon. Detail finer than about 25 m is not representable at 8 m. Not as busy as Parkouring; the head still reads somewhat smooth.
Flagship change (orchestrator): `examples/lab/flagship/main.ts` line 17 whitelist must accept nested names, e.g.
`const CLOUDS = ['parkouring', 'stormbird', 'houdini-test', 'heroes/tower', 'heroes/valley-fog', 'heroes/fairweather'] as const;`
then `node scripts/gpu/capture.mjs --serve --page flagship/ --query cloud=heroes/tower --shots ground,edge,backlit --out work/captures/P4-E` (loader is generic, `/clouds/heroes/<name>/` works, verified).
Open issues:
- Findings that cost time (all in the README): Cloud SOP default Secondary Shapes (2 iterations x 150 points) never finishes at metre scale, use 1 iteration; noise is invisible unless the density shoulder (bands) is 100+ m wide; `spatialscale` does not scale output; Cloud SOP Flatten did not flatten, so a one-line volume wrangle makes the base.
- The flagship bookmarks do not frame the elongated fog bank or put it on the ground; it floats at cloud altitude and looks small in the ground shot.
- Tower trunk is dark in the edge view (deep, thin column); `--scale-gain` or a wider trunk would help.
- I did not run pnpm typecheck/test (no TypeScript touched).

## Orchestrator review
Accepted as the authoring recipe and pipeline proof. The orchestrator applied the flagship `CLOUDS` whitelist change.
- `fairweather`: reads as a convincing fair-weather cumulus.
- `valley-fog`: a plausible low bank; scale and placement belong to the onsen demo.
- `tower`: reads as a smoke or explosion column (narrow stalk plus lobed head), not towering cumulus.
  Rebuild it with a broad base and stacked domed turrets that widen with height before the
  onsen demo uses it.
