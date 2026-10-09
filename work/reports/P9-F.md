# P9-F Authored cloud library (Houdini Pyro batch)
Status: ready for review
Changed: scripts/vdb/authoring/sim/{sim_clouds.py (generalised: seed, multi-emitter, wind, inversion lid, shear/flatten warp, pileus, island prune, per-cloud voxel), library.py (new), contact_sheet.py (new), README.md}; assets/clouds/library/** (new, 17 clouds + index.json, 23.9 MiB); examples/lab/library/{index.html,main.ts} (new); vite.config.ts (input line); examples/lab/gallery/cards.json (card). P4-F recipes and CLI unchanged in behaviour.
Verified:
- `hython scripts/vdb/authoring/sim/library.py --log work/captures/P9-F/library.log`: one command, unattended, 17/17 ok in 340 s (sims 3-38 s each, Indie, 8 m sim voxels like P4-F). Re-running gives byte-identical NVDFs.
- Contact sheet: work/captures/P9-F/contact-sheet.jpg (library page `?sheet=1`, one cloud at a time, sun from the side at 22°, camera looking north).
- Scape: work/captures/P9-F/scape/{ground,horizon,above}.jpg (36 instances, seeded yaw/scale/position, bases on one level, partial overlaps = frankenclouds). Exit 0.
- `node scripts/variety.mjs --serve --name library --page library/ --query clean=1 --shots horizon,above --out work/captures/P9-F/variety` → clone **0.47** (seeds 3/11: 0.48/0.47). Coverage + silhouette sheet in variety/library-coverage.png.
- 2560x1440 high, all three bookmarks: frame p50 16.70 / p95 16.80 ms (60 fps, vsync), clouds GPU 4.74 / 2.87 / 2.59 ms; stamping + SDF rebuild 115 ms once at load.
- `pnpm check` → exit 0 (43 files, 213 tests, build ok).

| cloud | species | size x·row·up (m) | base / top (m) | seed | frame | sim s | MiB | deal weight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| humilis-a | cumulus humilis | 472x336x144 | 16 / 136 | 11 | 110 | 3.6 | 0.26 | 1 |
| humilis-b | cumulus humilis (pair) | 368x368x136 | 8 / 128 | 12 | 120 | 3.2 | 0.21 | 1 |
| mediocris-a | cumulus mediocris | 608x584x384 | 8 / 376 | 21 | 150 | 6.8 | 1.53 | 1 |
| mediocris-oblong | mediocris (ridge) | 744x496x392 | 8 / 384 | 22 | 150 | 7.7 | 1.62 | 1 |
| mediocris-cluster | mediocris (3 cells, staggered ages) | 632x488x376 | 8 / 368 | 23 | 170 | 7.8 | 1.30 | 1 |
| congestus-a | congestus | 568x560x792 | 8 / 784 | 31 | 240 | 9.3 | 2.82 | 3 |
| congestus-turrets | congestus (turrets) | 648x528x584 | 8 / 576 | 32 | 250 | 10.4 | 2.24 | 1 |
| congestus-broad | congestus (broad base + tower) | 810x770x720 | 10 / 710 | 33 | 260 | 30.7 | 2.57 | 2 |
| congestus-lean | congestus (wind + shear) | 744x552x560 | 8 / 552 | 41 | 240 | 14.8 | 2.57 | 2 |
| mediocris-sheared | mediocris (wind + shear) | 712x520x400 | 8 / 392 | 42 | 170 | 15.4 | 1.66 | 1 |
| cumulus-flattop | cumulus under an inversion | 608x688x288 | 8 / 280 | 51 | 240 | 33.8 | 1.35 | 1 |
| stratocumulus-slab | stratocumulus slab (12 m) | 876x660x252 | 12 / 240 | 61 | 150 | 37.8 | 0.49 | 1 |
| stratocumulus-band | stratocumulus band (12 m) | 1104x516x216 | 12 / 204 | 62 | 150 | 17.5 | 0.41 | 1 |
| decaying-wisp | decaying (emission stopped, smeared) | 432x440x192 | 8 / 184 | 71 | 200 | 23 | 0.41 | 1 |
| fractus | cumulus fractus (broken pieces) | 520x320x112 | 8 / 104 | 72 | 120 | 6.4 | 0.21 | 1 |
| pileus-tower | congestus with pileus (T6) | 584x600x840 | 8 / 832 | 81 | 250 | 18 | 3.29 | 1 |
| rising-young | young towering cumulus | 368x408x552 | 8 / 544 | 91 | 140 | 9.6 | 0.93 | 2 |

Measures: 17 clouds (12-20) pass; each < 4 MB (max 3.29 MiB) pass; distinct silhouettes on the contact sheet pass (flat puffs, ridges, towers, two leaning, slabs, broken fractus, hazy decaying, capped tower); clone 0.47 ≤ 0.5 pass; 60 fps at 2560x1440 pass; pnpm check pass.
Process notes:
- The first render showed rounded bottoms (the P4-F 100 m base fade): the library templates use a 20 m fade. Detached blobs are pruned. Six "mound" clouds had silhouettes with NCC around 0.8 against each other (offline silhouette matrix), so I re-simmed them as a ridge, staggered cells, a stronger lean, a squashed lid and a smeared decaying cloud. Deal weights were then picked from that matrix (more of the towers, which differ the most). Copies of the same cloud are kept at least 1.8 km apart (`?repeat=`).
- Pileus: a scripted smooth dome shell on the tower top, not simulated. It reads as a hood or cap and is fused to the top, not a separate veil.
Open issues:
- The other P9-A measures are informational here: footprint CV 0.56 (min 0.7) and baseSpread 108 m. The base number comes from overhangs (flat-top shelf, pileus, leaning towers) inside clouds. The between-cloud base spread is 24 m, so the bases sit on one condensation level.
- From `above`, tower tops look alike (all round crowns). Ground and horizon show no visible repeats.
- No gallery thumbnail (`gallery/thumbs/library.webp` is outside my files): run `node scripts/gallery-thumbs.mjs library`.
- While P9-B2's runtime edit was half done (PARAM_BYTES 144 against a 160-byte struct), the stamp SDF rebuild failed for a while. Final captures and check ran on the current tree and pass.
- `?gen=1` (generated cumulus underneath the stamps) is wired up but was not tuned or measured.

## Orchestrator review
Accepted. The contact sheet shows 17 distinct silhouettes: humilis pairs, mediocris, an oblong cluster, four congestus variants, sheared clouds, a flat top, stratocumulus slab and band, a wispy decayer, fractus, pileus and a young tower. The `scape/horizon` view reads as a natural mixed sky with no visible repeats. Clone score 0.47. Caveats: the pileus is a fused hood, not a veil; tower crowns look alike from above; footprint CV 0.56. Committed without P9-C's `species` vite line, which lands with P9-C.
