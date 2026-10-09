# Nubis distance rendering and the P2 coverage revision

> **Superseded by / see also:** [sources/ne22.md](sources/ne22.md), [sources/n3.md](sources/n3.md) (§7 contradictions, §9 try-next), [sources/hfw.md](sources/hfw.md); [topics/surface-detail.md](topics/surface-detail.md) (steps, near-detail gate) and [topics/layering.md](topics/layering.md).

Research date: 2026-09-17. Read the official 2022 and 2023 PDF slides, including the rendered diagrams. Page numbers below are one-based PDF pages, not video timestamps. This note distinguishes published mechanisms from our proposed adaptation.

## Verified source points

### Nubis, Evolved (2022)

[Official slides](https://advances.realtimerendering.com/s2022/SIGGRAPH2022-Advances-NubisEvolved-NoVideos.pdf)

- Pages 75–78: regional influence fields and weather-state composition.
- Page 186: integration diagram combining near orographic, far orographic and tropospheric/superstorm clouds. This closely matches the user's recollection of layered rendering.
- Page 187: opacity-weighted distance for atmosphere integration.

These are different modeling/rendering regimes; the diagram alone does not establish three interchangeable resolutions of one density volume.

### Nubis³ (2023)

[Official slides](https://advances.realtimerendering.com/s2023/Nubis%20Cubed%20%28Advances%202023%29.pdf)

- Pages 79, 82–86: authored cloudscapes, coarse dimensional profiles, detail-type and density-scale fields, with procedural up-resolving.
- Page 96: distance-selected noise mip level.
- Pages 157–164: compressed distance field, adaptive stepping and jitter.
- Pages 171–174: a two-pass split at 200 m; the near pass is **480 × 270**, the far pass **960 × 540**, for the described 40/60 Hz approach. Near is lower screen resolution here.

This is not evidence of an obligatory procedural far fallback or a three-ring streamed voxel hierarchy. Voxel clouds serve both sky and flight-through use cases; see [Guerrilla's abstract](https://www.guerrilla-games.com/read/nubis-cubed).

## What we should separate in our design

These are our engineering distinctions, informed by the sources:

| Decision | What it controls | Current P2 gap |
| --- | --- | --- |
| World/weather definition | Where formations exist, their type, extent and evolution | Independent cell population is not coherent weather coverage |
| Density representation/detail | Broad shape plus progressively finer structure | Eight density tiles plus weak modulation; no persistent far continuation |
| Sampling quality | Step length, filtering, source mip selection | Fixed budget can expose bands and coarse silhouettes |
| Render resolution | Number of screen pixels evaluated | Whole-scene scaling only; no near/far pass split |
| Residency | Which data is present and updated | A small moving window is also the visual horizon |

A render-resolution split cannot recover clouds absent from the world representation. More near detail cannot repair the finite horizon. Conversely, a distant representation does not by itself solve ray-march banding or cache filtering. We should measure these independently.

## Proposed P2 revision — our adaptation, not a Decima port claim

**Persistent broad weather and cloud shapes, refined as the camera approaches.**

1. Define a world-space weather source with coherent coverage, cloud type, base/top height and density controls. It may generate voxel profiles, accept authored profiles, or combine both. Camera movement must not generate a different weather pattern.
2. Render distant formations from a broad, cheap representation before their near-detail data becomes resident. First compare a coarse voxel-profile field derived from the same source against the current bounded tiles. Keep a procedural far path possible, but do not select it just because it appears in earlier Nubis systems.
3. Refine that same formation at medium and near distances. Preserve silhouette and integrated opacity while adding voxel/profile resolution and procedural erosion/detail. A fixed number of tiers is an experiment, not yet a public API promise.
4. Keep one density ownership policy through transitions. If two representations overlap, blend their density/profile contributions with complementary weights before integration, or partition the ray intervals explicitly. Do not alpha-stack two complete copies of the same cloud. Different approximations still require measured optical agreement; complementary weights alone do not prove it.
5. Derive cloud visibility and shadowing from the same world definition. A physically displaced or offscreen cloud can legitimately cast a visible shadow; the defect is a shadow surviving while its corresponding visible formation is suppressed by our arbitrary camera fade.
6. Keep the independent thin-cloud layer for distinct high clouds. It does not substitute for the distant continuation of a formation the user will fly into.

Start with one spatial reference integrator and a near/far quality policy. Add an intermediate tier only when image comparisons or measured cost justify it. Different screen resolutions and FSR are separate later choices; retain the P4 reconstruction boundary. Do not copy the published 200 m threshold or console resolutions as our desktop preset without measurement.

### Acceptance before leaving P2

- A selected formation remains identifiable at 20, 12, 8, 4 and 1 km, then during entry. These are test distances, not promised LOD thresholds. Maintain a fixed weather seed and sun.
- Record optical and silhouette differences against a higher-quality spatial reference throughout each transition. Include slow approach, retreat, lateral travel and residency changes.
- Show coherent weather progression from clear through scattered to broad coverage; keep density separate from shape coverage and population count.
- Test cloud/ground shadow agreement with known sun projection while approaching; do not use only same-camera rebase tests.
- Diagnose the user's banding views by varying view samples, density resolution and lighting resolution independently. Do not assume temporal reconstruction will repair an under-resolved field.
- Measure generation, residency changes, march, shadow updates and total frame cost at stated output/internal resolutions. Previous timing wins remain valid for their old fixture, not evidence that expanded coverage is free.

## Source artifacts and limits

Local read-only copies are under `artifacts/research/nubis/` (excluded from Git). Source algorithms were studied; no slide code or cloud assets were imported into the runtime. This note does not establish a production streaming policy, licensing for sample assets, or a completed weather simulation. See the [2015/2017 primary-source follow-up](nubis-classic-lod-notes.md): it distinguishes altitude layers and in-march detail levels from separate distance passes. The 2022 diagram is the closest verified match to the recalled layered solver structure.
