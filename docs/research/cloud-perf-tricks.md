# Cloud performance tricks — experiment backlog

Research date: 2026-10-10. Status: **backlog for the later performance pass.** Nothing here is implemented or scheduled; quality comes first (dev runs at ultra). This note records what shipped systems do to avoid paying a full ray march per pixel per frame, and which of those we want to try. Page and slide numbers are one-based PDF pages; see [nubis-lod.md](nubis-lod.md) and [nubis-classic-lod-notes.md](nubis-classic-lod-notes.md) for the source links. Items marked *recalled* come from general knowledge of the talks/engines and still need a primary-source check before we cite them in a decision.

The common rule: don't pay for a full-quality march, at full resolution, every frame, for content that is not changing.

## Published Decima / Nubis techniques

| Technique | Source | Notes |
| --- | --- | --- |
| Temporal amortisation: update 1 of 16 pixels per frame (4×4 pattern) at reduced resolution, reproject the rest | 2015 slides 91–92 | Each march stays full quality; only 1/16 of pixels pay for it. Largest single win historically. |
| Cheap march until density is found, step back, switch to detailed erosion; drop back after consecutive empty samples | 2015 slides 75–80; 2017 slide 96 | Also early exit when transmittance ≈ 0. |
| SDF empty-space skipping, adaptive steps, jitter | Nubis³ pp. 157–164 | Compressed distance field stored with voxel clouds. |
| Distance-selected noise mip | Nubis³ p. 96 | Less detail where it cannot be resolved. |
| Cheap light march: ~6 cone samples, last one far; lower noise detail per light sample | 2017 slide 96 | Multiple scattering approximated (beer-powder / octave tricks), not simulated. |
| Near/far pass split at 200 m — near **480×270**, far **960×540** | Nubis³ pp. 171–174 | Near is *lower* resolution: it fills the screen and is soft; far detail lives in pixels. Do not copy the threshold or resolutions without measurement. |
| Altitude/type layers: cirrus/alto as scrolling 2D textures | 2015 slide 73; 2017 slide 50 | Volumetric only for low clouds. |
| Separate regimes composited with opacity-weighted distance | 2022 pp. 186–187 | Near orographic, far orographic, tropospheric/superstorm. |

## Techniques from other engines (*recalled*)

- **Time-sliced distant sky cache** (Frostbite, Unreal sky capture): far sky + clouds rendered into a low-res cubemap/panorama, refreshed a face or fraction per frame; only nearer content marched each frame.
- **Lighting cache volume** (UE5 Heterogeneous Volumes): lighting computed into a coarse 3D grid at a slower cadence; the view march reads it instead of casting shadow rays.
- **Low-res cloud pass + upscaler.** Clouds are low-frequency and upscale well. Ours: the P4 FSR path ([reconstruction contract](../decisions/reconstruction.md)).
- **Cloud shadows** from a slowly updated low-res shadow map, never per-pixel marched.

## Impostors and billboards

Pre-volumetric flight sims used dynamically regenerated cloud impostors, re-rendered only when view angle or lighting drifted past an error threshold (Harris & Lastra 2001; Microsoft Flight Simulator 2004 era, *recalled*). Temporal reprojection largely replaced them as a per-pixel cache without parallax or sorting problems. They remain worth testing for distant content.

Failure modes to test for:

| Problem | Mitigation to try |
| --- | --- |
| View-dependent scattering (silver lining, forward scattering) smears when blending octahedral frames | Finer frame grid, or re-render on angular error threshold |
| Interpenetrating translucent clouds cannot be sorted | Store per-texel depth + transmittance; depth-aware compositing |
| Aerial perspective baked at capture distance goes wrong as the camera moves | Store un-hazed radiance, transmittance and depth; apply atmosphere live |
| Sun movement invalidates baked lighting | Re-bake on sun-angle threshold, matching the slower lighting cadence |
| Pop at the hand-off to volumetric | Match silhouette and integrated opacity against the march at the transition |

## Proposed experiments (in rough priority order)

1. **Octahedral panorama shell.** Render everything beyond R km into a camera-centred octahedral panorama with radiance, transmittance and depth. Time-slice its refresh and reproject by camera translation. The near march terminates at R and composites `L_near + T_near × L_far`. Cost is independent of cloud count and handles groups/overlap/sorting. Parallax beyond ~10–20 km is small at normal speeds; faster flight raises refresh rate.
2. **Baked light volume per formation**, updated at a slower cadence than the view march, replacing shadow rays in the view march. Especially suited to authored VDB clouds.
3. **Temporal pixel amortisation** (1/N pixels per frame + reprojection) on top of the low-res pass, measured against the P4 FSR3 path rather than stacked blindly with it.
4. **Cheap-until-hit march and SDF skipping** if not already covered by the P2 voxel path.
5. **High cirrus as 2D / few-step 2.5D layers** updated every frame.
6. **Per-object octahedral impostors** only if needed: many independently moving distant artist clouds, or a hero formation (e.g. Santa's Sleigh) seen from far.

Target layer stack: cirrus layers → far panorama shell → low-res near/mid march with reprojection + FSR → baked lighting → full march for fly-through.

## Constraints carried from existing decisions

- All tiers composite through **one transmittance chain**; never alpha-stack two complete copies of the same cloud ([nubis-lod.md](nubis-lod.md), P2 point 4).
- Each experiment reports whole-frame p50/p95 at stated output/internal resolutions and a quality comparison against the native reference. An optimisation that only speeds up its own pass while worsening the frame is rejected (P4 exit rule).
- Looks before performance: do not start these until the visual targets are settled.
