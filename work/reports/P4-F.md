# P4-F Scripted fluid-sim hero clouds (Houdini Pyro)
Status: ready for review
Changed: scripts/vdb/authoring/sim/{sim_clouds.py,README.md} (new), assets/clouds/heroes/sim-cumulus/, assets/clouds/heroes/sim-congestus/ (new), work/captures/P4-F/ (new), this report. Nothing else touched (scratch output is in the git-ignored work/captures/scratch/p4f/).
Verified:
- `hython scripts/vdb/authoring/sim/sim_clouds.py cumulus` and `... congestus` sim, cache, and convert (`--mode fog --voxel-size 8 --world-scale 100 --iso 0.3 --margin 1`). Houdini 21 Indie works (SOP Pyro Solver, no limits hit).
- Sim time: cumulus 180 frames 12 s (whole run, incl. convert, about 20 s); congestus 260 frames 10 s (about 17 s). Far under the 10 min budget, so many iterations were possible (about 40 sim variants).
- Sizes: sim-cumulus 2.78 MiB (85x92x62 voxels, 680 x 736 x 496 m); sim-congestus 3.60 MiB (82x76x101 voxels, 656 x 608 x 808 m). Both under 4 MB.
- Captures (exit 0): work/captures/P4-F/sim-cumulus/{ground,edge,backlit}.jpg, sim-congestus/{...}, and side-by-side.jpg (columns: P4-E2 tower, sim-cumulus, sim-congestus; rows ground/edge/backlit). Flagship already whitelisted both names.
Look:
- sim-cumulus: broad, flat-based, lobed cauliflower mound with turrets of different heights and a shaded interior in backlit. No sphere-pile look; edges are billowed, not round.
- sim-congestus: taller mound with deep internal cells (dark blue cavities in backlit), irregular crown and a cauliflower flank. Clearly more organic than the tower. It is a mound with a narrow top, not a thin tall column.
Recipe summary: flat noisy disc emitter (thresholded noise hot spots = separate thermals) -> Pyro Solver (buoyancy 6/12, very low dissipation and cooling, turbulence + disturbance) -> smoothstep density remap with soft flat base -> vertical stretch (1.7 / 2.8) -> smooth. Full knobs and gotchas in scripts/vdb/authoring/sim/README.md.
Open issues:
- Height: congestus is 808 m tall in the bounds, a little under the 1 km target. A free plume is a cone about as tall as wide, so the aspect comes from a post vertical stretch (2.8); above about 3 the billows streak. A 1 km tall cloud at 8 m voxels exceeds 4 MB (needs 10-12 m voxels).
- Detail finer than about 25 m is not representable at 8 m voxels. Sim at divsize 0.05 gave a smaller, wispier cloud with the same parameters and was not tuned.
- Both clouds have a small detached blob or a thin chimney wisp near the top in some views; raise `remap.lo` or prune islands if unwanted.
- Cumulus sits at the 700 m size target; placement scale in demos is unchanged from the paths' bounds in cloud.json.
- No light Cloud Noise pass was added; the sim detail alone was enough.
