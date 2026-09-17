# Classic Nubis / Decima LOD research (2015 and 2017)

Primary materials

- 2015, Andrew Schneider, “The Real-time Volumetric Cloudscapes of Horizon: Zero Dawn,” SIGGRAPH Advances in Real-Time Rendering course. Official course page: https://advances.realtimerendering.com/s2015/ . Direct PDF: https://advances.realtimerendering.com/s2015/The%20Real-time%20Volumetric%20Cloudscapes%20of%20Horizon%20-%20Zero%20Dawn%20-%20ARTR.pdf
- 2017, Andrew Schneider and Nathan Vos, “Nubis: Authoring Real-Time Volumetric Cloudscapes with the Decima Engine,” SIGGRAPH Advances in Real-Time Rendering course. Guerrilla landing page: https://www.guerrilla-games.com/read/nubis-authoring-real-time-volumetric-cloudscapes-with-the-decima-engine . PDF linked by Guerrilla: https://d3d3g8mu99pzk9.cloudfront.net/AndrewSchneider/Nubis-Authoring-Realtime-Volumetric-Cloudscapes-with-the-Decima-Engine-Final.pdf

## 2015 findings

- Slides 39–40: spatial weather channels control coverage, precipitation and cloud type.
- Slide 45: a 35 km radius with a horizon/type transition beginning at 15 km. This is not proof of a separate far renderer.
- Slide 73: low volumetric strato clouds at 1.5–4 km; higher alto/cirro clouds use scrolling 2D textures. These are altitude/type layers.
- Slides 75–80: cheap base-shape sampling and detailed noise erosion are selected within the ray march, with adaptive steps.
- Slides 91–92: reduced/interleaved rendering and temporal reprojection are additional optimizations.

## 2017 findings

- Slides 53–60: cloud maps and weather-state parameters control coverage, type, density and movement.
- Slides 67–72: procedural maps, authored overrides, and region/encounter weather scheduling.
- Slide 50: low clouds are volumetric; cirrus uses a 2D lookup. Slide 108 lists closer high-detail clouds and remaining layers as future work.
- Slide 96: adaptive ray steps and low/high noise detail within one march, with decreasing detail in light-cone samples.

## Interpretation

The classic sources establish weather control, altitude/type layers, sampling detail and reconstruction. They do not establish the specific global-far-plus-multiple-near-solver structure. The [2022 integration diagram](nubis-lod.md) is the closer match to the user's recollection. Avoid calling every one of these mechanisms a distance LOD or a separate solver.
