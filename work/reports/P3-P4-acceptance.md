# Phase 3 and Phase 4 acceptance (orchestrator)

## Phase 3: whole sky and generated cloudscapes. Measures pass.

| Measure (AUDIT §4) | Result |
| --- | --- |
| 2.5D vertical-profile layer for the horizon, sharing up-rez and lighting, 16-frame temporal, no seam with the voxel region | ✅ P3-C1 + P3-C2 (Fable): one continuous field, no cones, cliffs, hatching or box edge; about 1.0 ms amortized at 2560×1440 (quiet re-measure pending; contended runs read up to 1.8) |
| GPU NVDF generation from weather/type maps, with presets | ✅ P3-A + P3-B: cumulus, congestus and stratocumulus read as cumulus fields; 512²×64 at 0.40 ms/job amortized |
| Camera-centred streaming window | ✅ P3-D: overlap byte-identical, swaps invisible (0.20/255) |
| 40 s plains flight, ground → through clouds → above, 60 fps, no popping | ✅ P3-D + P3-E: clouds 2.7–5.5 ms along the path at 2560×1440; no slow frames under the base after P3-E |
| Full day cycle with correct sky tint | ✅ P3-F strips (`work/captures/P3-F/day*`) |
| Sliders never stall | ✅ generation and light grid amortized; the light-grid swap frame spikes about 1 ms once |

**Deferred (allowed by the plan):** realtime evolution, planet curvature beyond the shell
approximation, storms/lightning.

**Carried:**
- the generator's single-round JFA overshoot risk (P4-C) → P5-A exact EDT
- the voxel light grid stops at the box wall, so a voxel cloud on the sunward wall is lit unshadowed (P3-C2 note)
- the cumulus preset looks columnar in 96-slice volumes

## Phase 4: authored clouds. Measures pass.

| Measure | Result |
| --- | --- |
| VDB/mesh → NVDF converter (profile from SDF, detail type, density scale) | ✅ hython converter (P4-A, exact parity with Guerrilla's VDBs), fitted mapping (P4-B), and **in-browser `.vdb` import** (P4-H, byte-exact with the pack in about 64 ms) |
| Atlas-lite authoring in Houdini | ✅ as scripted recipes rather than an HDA: Cloud SOP recipe (P4-E) and **Pyro-sim recipe** (P4-F, about 20 s per cloud, natural cauliflower) |
| Composite authored clouds into the region with a transform; movable heroes | ✅ GPU stamping with max/replace/cutout, yaw and scale (P4-C). Movable per-frame instances are deferred (stamping costs nothing at render time) |
| Houdini → browser in < 2 min, no code changes | ✅ sim about 20 s, then drop the `.vdb` on `/vdb-drop/` |
| Authored clouds match Parkouring's style | ✅ for sim clouds; SOP recipes top out at "soft spheres" |
| Onsen valley demo | ✅ P4-D |
| Real-world assets | ✅ Disney WDAS cloud (CC BY-SA, NOTICE) and OpenVDB bunny (local) |

**Quality track:** Q-1 added billow-scale self-shadowing. Versus Disney's Hyperion render, we match
silhouette and shading direction and now show relief. Crisp 5–20 m lobes remain out of reach at 8 m
voxels; sparse higher-resolution hero storage (NanoVDB, the user's WebVDB) is the path if that matters.
