# P3 lighting and environment contract

Implementation begins 2026-09-17. P2 is accepted provisionally for continued development. Distance/LOD, weather coverage and view/shadow agreement remain tracked separately.

## Frame ordering and ownership

1. Upload the current world and light parameters.
2. Rebuild candidate data and cloud-only light transmittance when dirty.
3. Render opaque Three objects. Explicit receiving node materials sample the cloud cache in their directional-shadow hook. Three renders its scene shadow map during this step.
4. Integrate clouds using scene depth, cloud self-shadow transmittance, and the current directional geometry shadow map.
5. Compose linear HDR as `cloud radiance + cloud transmittance × scene radiance`; tone mapping belongs to final presentation.

There is one Three renderer/device. Native GPU submissions and Three texture consumption are ordered on its queue; normal frames require no readback or CPU wait. Renderer target, cube face, mip level and MRT state are restored. The async `compile()` helper prewarms scene pipelines using the cloud render-target layout; the host suspends other uses of this renderer while compilation or environment refresh is in progress. The application owns the sun and geometry; clouds do not dispose the sun's shadow texture.

## Explicit material and light support

The initial receiver uses `NodeMaterial.receivedShadowNode`, composes with an existing material hook and restores it on detach when still owned. The P3 fixture uses this hook without the P1/P2 reference ground MRT marker, avoiding duplicate shadow application. It attenuates direct shadowed lighting; it does not multiply the already-composited image or ambient/environment light. A material must be on a receiving mesh, with renderer shadows enabled and a shadow-casting directional sun. This first hook applies to receiving shadow nodes, so the supported setup has one shadowed directional sun. Multiple shadowed lights need a light-specific hook before being claimed supported.

Geometry-to-cloud shadows sample Three's conventional WebGPU directional depth map with the same matrix, Y flip and depth-bias convention. They use a small depth comparison filter, not a physical area-light penumbra. Points outside the map are unoccluded. Applications must cover their cloud receivers with the shadow camera. No cascaded, point-light, transparent or refractive shadow support is claimed.

Cloud density/world/sun changes rebuild the cloud-only cache. Moving an opaque object updates the Three shadow map and is sampled in that animation frame (Three updates each camera’s map once per frame); it does not force regeneration of the cloud cache. Changing sun radiance/color does not invalidate density transmittance. Receiver materials still require a current cache when the volume uses its uncached diagnostic lighting path.

## Environment capture

Capture uses an independent cloud runtime and a fixed probe position. It integrates six directions into a linear HDR cube, then produces a filtered environment texture. It does not reuse the main camera image or any main-view temporal state. Refresh is explicit in the P3 study; density/sun/mode changes mark it stale. Camera orbit alone does not refresh it. Capture contains sky/clouds only, so local ground and objects are not included in reflections; parallax near a probe is approximate. This makes capture cost visible and allows a later budgeted scheduler.

The normal main-view background is the sky-only cube: view clouds are integrated once over it. The environment may contain sky plus clouds for diffuse/specular lighting. Assigning the combined environment cube as the main-view background while also integrating those clouds would duplicate them and is not the study's default.

## Atmosphere and open quality work

The sky is supplied by pmndrs/sky. Cloud radiance uses explicit sun/ambient colors and an exponential distance-haze approximation. Sky aerial perspective is disabled in this study so it cannot be applied twice. Full per-segment atmosphere transmittance/in-scattering, calibrated sky irradiance and multiple-scattering cloud lighting remain open P3 work; this study must not be described as complete physical atmosphere integration.

The current cloud-shadow cache remains coarse. Ground shadows from clouds hidden by the camera-relative P2 fade remain a known distance/LOD defect, not a reason to suppress all offscreen cloud shadows (offscreen clouds can correctly cast visible shadows). Improving the source hierarchy and matching its view/shadow representations belongs to the tracked coverage work.
