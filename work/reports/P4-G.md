# P4-G Real-world VDBs: Disney cloud, OpenVDB bunny cloud, cloud.0001
Status: ready for review
Changed: assets/clouds/disney/{cloud.json,nvdf.bin,sdf.bin,NOTICE.md} (committed); assets/clouds/local/{bunny-cloud,cloud-0001}/ (gitignored); scripts/vdb/vdb_to_nvdf.py (new `--rotate-y {90,180,270}`: np.rot90 of the resampled fields about the up axis; placement metadata is not tracked through it); work/captures/P4-G/.
Grids (all one float `density` fog grid, axis-aligned, cubic):
- wdas_cloud_{sixteenth,eighth,quarter}: voxel 3.33 / 1.67 / 0.83 units (quarter active 2.1 M+); eighth active index X -131..119, Y -41..129, Z -179..128 (units about 417 x 283 x 512, Y up).
- bunny_cloud.vdb: voxel 0.08, 577 x 572 x 438 active voxels, 19.2 M active (46 x 46 x 35 units).
- cloud.0001.vdb: voxel 0.02, 61 x 62 x 63 voxels, 0.16 M active (1.2 units across).
Conversions (all `--mode fog`, default pack-fit mapping, 8 m target):
- Disney: quarter VDB, `--world-scale 1.75 --margin 1 --rotate-y 270` -> 91x109x63 voxels (728 x 872 x 504 m crop, cloud about 870 m long, 300 m tall), 3.75 MB (3.58 MiB), 9.3 s. Quarter vs eighth at 8 m: same dims, eighth only 2 s; I used quarter (area-averages from the finer source). The 1.0-1.5 km width was not reachable under 4 MB (1.9 scale = 1 km = 5.0 MB); 1.75 is the cap, so about 0.9 km.
- bunny-cloud: `--world-scale 15 --margin 2` -> 85x67x85 (680 x 536 x 680 m), 2.9 MB, 17 s (1.2 m source voxels).
- cloud-0001: `--world-scale 400 --margin 2` -> 65x67x66 (520 x 536 x 528 m), 1.7 MB, 0.3 s (source voxels land exactly on 8 m).
- Rotation: the Disney cloud's long axis is VDB Z; the flagship `edge` bookmark views along it, giving an end-on triangle. `--rotate-y 270` puts it side-on (edge shows the profile, tail to the right, sun from the left).
Verified: capture.mjs ground/edge/backlit/frontlit for each, in work/captures/P4-G/{disney,bunny-cloud,cloud-0001}/ (no console errors, 60 fps, scene about 1-1.5 ms GPU). Side-by-side: work/captures/P4-G/disney-vs-hyperion.jpg (left Hyperion, right ours; source shot work/captures/P4-G/match/edge.jpg, `cloud=disney&time=15&noground=1`, edge bookmark, 1998x1080). The flagship has no `cam=` param, so the matched view is the edge bookmark plus time 15 h (sun elevation about 50 deg, from left/front), not a hand-fit camera.
How close to Hyperion (honest):
- Gets: cumulus silhouette and scale, a tall left turret with a lower right shoulder, a soft bright sun-facing side and a blue-grey shadow side, sky-driven lighting and aerial perspective.
- Misses: the cauliflower detail. Hyperion shows billow lobes of 5-20 m and wispy rags at the tail; at 8 m voxels, with an SDF-derived profile and generic detail noise, ours is a smooth, soft-edged blob. The flat dark base is missing (ours is round, with no strong underside shading). The tail is a hollow dark-blue arm instead of thin wisps. Multiple-scattering brightness (silver, high-albedo interior) is lower contrast; the reference sky is a deeper blue and our shot has a flat grey fill under the horizon (noground). Camera and sun differ, so the profile only roughly matches. Nubis is a realtime approximation here and it reads as a plausible cumulus, not the reference.
- Not a fair comparison for the 8 m limit: the source is a 0.2 m production cloud.
Bunny: ears, back and haunch are recognizable in the edge view and it reads as a lumpy cloud with soft edges; in the ground view the form is looser. Some dithering/speckle shows inside the thin parts.
cloud-0001: a dense blocky chunk (the VDB is a coarse 61^3 chunk, most voxels occupied); the flagship framing fills the whole frame at `edge`.
Open issues: Disney asset is below the requested 1.0-1.5 km because of the 4 MB cap; `--rotate-y` is in the shipped asset's parameters; `scripts/vdb/README.md` not updated for the new flag. Not committed; BOARD untouched. pnpm typecheck/test not run (only Python touched).

## Orchestrator review
Accepted. The Disney comparison is the most useful quality signal so far: silhouette and shading direction
match, but our body is smooth where Hyperion shows crisp self-shadowed billows. Diagnosis: (1) 8 m voxels drop
Disney's explicit detail (by design: Nubis regenerates detail with noise); (2) our in-line sun samples sit about 8 and
32 m out and are reused across 4 m, so billow-scale (2–10 m) self-shadowing is missing for every cloud. → Q-1.
