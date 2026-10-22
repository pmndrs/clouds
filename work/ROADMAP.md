# Roadmap: everything left, in one list

The whole picture on one page. STATUS says what's running and what's waiting on you; this page lists all the work left, by track. "Worse" means we fall short of the paper or game on that point; "missing" means we don't have it at all. Detail lives in the linked notes. Updated 2026-10-15.

Tracks: **P** the procedural sky (the main web path, target Nubis Evolved 2022), **D** Decima parity (our render of Guerrilla's clouds against their frames), **V** voxel hero clouds (Nubis Cubed), **F** performance, **T** tools.

## Where we are, in one paragraph
The procedural sky now has every big Nubis Evolved piece except the terrain-hugging "envelope" clouds and storm rotation: the five-field map, profile tables, Nubis Cubed noise, Nubis lighting from the exact profile, 2.5D mid layers, influence painting, weather states, and a first storm package. Most of it is first-version quality and none of the new defaults has been judged by you yet (STATUS A1–A9). The biggest gaps are cost (our sky is 13–22 ms, theirs 2–4 ms), storms, and cirrus. Decima parity is paused at round 12, unjudged.

## P: procedural sky (against Nubis Evolved 2022)
| # | Item | Where we are | Size |
| --- | --- | --- | --- |
| P1 | Review the new defaults (STATUS A1–A9, B1) | Waiting on you | You |
| P2 | Storm anvil shape | Better (ST2 smooth plate) but the old cell still reads cleaner far away; **worse.** STORM1's anvil plate is lumpy and its cirrus torn; F1's older mushroom is still the default | M |
| P3 | Storm rotation rings (NE22 p.147–158) | Built (ST2), off: needs motion vectors (U1) to stop smearing | M |
| P4 | Storm lighting tuning (absorption curves, ambient blend; NE22 p.164–172) | First version (STORM1: darker, denser, glow) | S |
| P5 | Cirrus read from the map (type and coverage per area) | Done (CI1); authored/painted maps have no cirrus fields yet | S |
| P6 | Cirrus fade cov² vs NE22's cov³ | Different; NE22's is an option (`cirrus.coverageFadeNe22`) | XS, you choose |
| P7 | Sharper history in the temporal blend (bicubic) | Done (SH1b); shadow jitter fixed (SH1a) | S |
| P8 | Density formula: HZD remap vs NE22's subtract-the-profile | Different, not known to be worse; A/B with the new lighting | S |
| P9 | NDF generator closer to NE's output (regional sets: cumulus here, stratocumulus there) | Partial: two recipes (H6, N17) + weather states (whole sky) | M |
| P10 | One shell with continuous type (stratus ↔ cumulus) instead of summed layers (board L2) | Missing | L |
| P11 | Envelope clouds: terrain-hugging valley and mountain clouds (NE22 solver 3, p.84–127) | **Missing.** Needs a terrain input | L, later |
| P12 | Lightning in the procedural sky | Missing here (exists in the voxel path) | S, low priority |
| P13 | Metre-scale rim pass on lit edges (board R2) | Held until D1 settles edges | M |
| P15 | Nubis shade hue | Fixed (LH1); fine-tune with `diffuseSun` |
| P14 | Weather-state numbers and storm settings tuned by eye → by you | Agent-set | You |

Notes: `docs/research/ne22-coverage.md` (the audit), STATUS "Where we differ".

## D: Decima parity (paused since 2026-10-11)
| # | Item | Where we are |
| --- | --- | --- |
| D1 | Judge round 12 (blind set `d1l`, local) | Not judged |
| D2 | Primary targets p213 / s214 (the pack-published renders) | Agreed; not yet the focus of a round |
| D3 | Camera match (Houdini rig, or Karma render of the pack VDB) | Parked; cameras are fitted from silhouettes, distance and FOV confounded |
| D4 | Near-sunset sun as the cause of the pink (your hypothesis) | Not tested |
| D5 | Fable's list: shade range, Stormbird lit level, cauliflower hierarchy, base fringe and thin material, shade artefacts | Open (`work/reports/D1.md` "Resume here") |
| D6 | Wind smears florets (temporal) | C2 may help; re-check |

Notes: `work/HANDOFF.md`, `work/D1-TOOLS.md`, `work/reports/D1.md`.

## V: voxel hero clouds (Nubis Cubed)
| # | Item | Where we are |
| --- | --- | --- |
| V1 | Detail type and density scale from the surface normal, for non-Guerrilla VDBs (board A4) | Queued |
| V2 | Hybrid: voxel heroes inside the procedural sky (Santa's Sleigh line, Frog) | Pieces exist (M1 imports, sky layer); not composed as a scene |
| V3 | Stochastic texture filtering for bricks and coarse sims | Read, parked (`docs/research/sources/stochtex.md`) |

## F: performance (after parity)
| # | Item | Where we are |
| --- | --- | --- |
| F1 | Clean timing breakdown | First pass (PF1, loaded machine): veil 30–40 %, detail 25–35 % of the sky pass |
| F2 | Weather-map empty-space skipping for the HZD sky | Done (PF1, exact); only helps sparse maps |
| F3 | Keep detail at 4–12 km (it's filtered away now) | Worse: far clouds read soft |
| F4 | Map and sky LOD beyond 32 km (board LOD1) | Missing |
| F5 | Upscaler integration: your FSR3 port, with cloud motion vectors (U1) | C2 prepared the motion; not integrated |
| F6 | Job scheduler: subsystems at their own rates (board S1) | Deferred |
| F7 | Budget | **Worse:** sky 13–22 ms at ultra vs NE22's 2–4 ms |

Notes: `work/reports/PERF-LOD-audit.md`, `docs/research/cloud-perf-tricks.md`.

## T: tools
| # | Item | Where we are |
| --- | --- | --- |
| T1 | Painter storm brush tried by hand | Unit-tested only |
| T2 | Capture script times out on a cold dev server (`--serve`) | Agents pre-warm vite and use `--url` |
