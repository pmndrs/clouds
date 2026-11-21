import type { CloudNoiseAsset, CloudVolumeAsset } from './assets';
import type { GpuTimer } from './gpu-timer';
import { createLightGrid, type LightGrid } from './light-grid';
import { createAtmosphereBindGroupLayout } from './shaders/atmosphere.wgsl';
import { defaultDomeSettings, type CloudDome } from './dome';
import { DOME_DEPTH_BINDING, DOME_FRAME_BINDING, DOME_LIGHT_GRID_BINDING, DOME_OUT_BINDING, DOME_PARAMS_BINDING, DOME_PARAM_BYTES, DOME_REFRESH_FRAMES, DOME_SKY_LIGHT_BINDING, DOME_SKY_PARAMS_BINDING, DOME_SKY_SAMPLER_BINDING, DOME_SKY_WEATHER_BINDING, DOME_WGSL, DOME_PROCEDURAL_BINDING, domeWgsl } from './shaders/dome.wgsl';
import { uploadCloudNoise, uploadCloudVolume, type GpuCloudVolume } from './resources';
import { COMMON_WGSL } from './shaders/common.wgsl';
import { COMPOSITE_CIRRUS_BINDING, COMPOSITE_MID_BINDING, COMPOSITE_LIGHT_GRID_BINDING, COMPOSITE_SAMPLER_BINDING, COMPOSITE_SHADOW_BINDING, COMPOSITE_SKY_BINDING, COMPOSITE_WGSL } from './shaders/composite.wgsl';
import { createCloudShadowMap, type CloudShadowMap } from './shadow-map';
import { controlledCost, describeDevice, DynamicScale, selectTier, type AutoQualityInfo, type AutoQualityOptions } from './auto-quality';
import { DENSITY_WGSL } from './shaders/density.wgsl';
import { DIRECT_DENSITY_WGSL } from './shaders/direct.wgsl';
import { TEMPORAL_BINDINGS, TEMPORAL_PARAM_BYTES, TEMPORAL_WGSL } from './shaders/temporal.wgsl';
import { FRAME_UNIFORM_BYTES } from './shaders/frame.wgsl';
import { createLightning, type FlashOptions, type LightningSettings } from './lightning';
import { blueNoiseBytes, BLUE_NOISE_SIZE } from './blue-noise';
import { MARCH_ATMOSPHERE_GROUP, MARCH_BLUE_NOISE_BINDING, MARCH_LIGHT_GRID_BINDING, MARCH_NEAR_BINDING, MARCH_SKY_LIGHT_BINDING, marchWgsl, SKY_LIGHT_BINDING, SKY_LIGHT_BYTES, SKY_LIGHT_ENTRIES, SKY_LIGHT_WGSL } from './shaders/march.wgsl';
import { convergedRows, createSkyLayer, type SkyLayer } from './sky-layer';
import { createCirrusLayer, type CirrusLayer } from './cirrus';
import { createSkyUpscale, type CloudRenderLevel, type SkyUpscale } from './upscale';
import type { ProceduralDensityModel } from './procedural/types';
import { SKY_PARAM_BYTES } from './shaders/sky-layer.wgsl';
import { CONVERGED_PARAM_BYTES, CONVERGED_WGSL, convergedSubPixel } from './shaders/converged.wgsl';
import { createVolumeBindGroup, createVolumeBindGroupLayout, createVolumeSamplers, heroUniformData, volumeUniformData, volumeWgsl, HERO_UNIFORM_BYTES, VOLUME_UNIFORM_BYTES } from './shaders/volume.wgsl';

export type CloudQuality = 'ultra' | 'high' | 'medium' | 'low' | 'mobile';
/** A tier, or 'auto': the tier is picked from the adapter (auto-quality.ts) and the render scale follows a GPU time budget. */
export type CloudQualityOption = CloudQuality | 'auto';
/** The tiers from the cheapest up. */
export const CLOUD_QUALITY_ORDER: readonly CloudQuality[] = ['mobile', 'low', 'medium', 'high', 'ultra'];
/**
 * Quality presets (Nubis near/far split, s157-160): the march runs twice. Near covers [0, splitDistance) at nearScale of the
 * output resolution (linear), far covers the rest at farScale. maxSteps and the transmittance cutoff are per pass.
 * P5-C: the tiers also trade the march step size, the billow micro-shadow, the detail octave range, the far range, the light grid, the
 * reflection dome and the sky layer resolution (see the table in work/reports/P5-C.md).
 */
export interface CloudQualityPreset {
  nearScale: number;
  farScale: number;
  splitDistance: number;
  maxSteps: number;
  /** Rays stop once transmittance falls below this. */
  transmittanceCutoff: number;
  /** P5-B: the near / far pass traces 1/k of its pixels per frame (k = 1, 2 or 4) and resolves the rest from reprojected history. */
  temporalNear: TemporalRate;
  temporalFar: TemporalRate;
  /** Multiplies the march step floor (CloudSettings.stepScale): above 1 takes coarser steps. */
  stepScale: number;
  /** Length (m) of the billow micro-shadow sample (CloudSettings.microDist); 0 drops one density fetch per lit step. */
  microDist: number;
  /** Distance (m) within which the high-frequency detail octave is evaluated (CloudSettings.detailDistance). */
  detailDistance: number;
  /** The far pass stops here (CloudSettings.farLimit, m; the distant sky layer can take over beyond it). */
  farLimit: number;
  /** The light grid is built at 1/divisor of its usual size per axis (1 = the default half of the voxel dims, 2 = a quarter). */
  lightGridDivisor: number;
  /** Reflection dome size (square) and step cap. The size is fixed when the runtime is created; `setQuality` only changes the step cap. */
  domeSize: number;
  domeMaxSteps: number;
  /** Render resolution of the distant sky layer relative to the output (SkyLayerSettings.resolutionScale). */
  skyScale: number;
  /** The composite runs at this fraction of the scene's size (per axis) and the consumer upsamples its output bilinearly; 1 = full size. See `outputSize`. */
  outputScale: number;
  /** Whether the reflection dome is refreshed (CloudDomeSettings.enabled). Turn it on when something reflects the clouds. */
  domeEnabled: boolean;
  /** P13-H1: the march reads a volume's fine hero overlay within this distance (m, CloudSettings.fineDistance); 0 = fine off. */
  fineDistance: number;
}
/** Fraction of a march pass's pixels traced per frame is 1/k. 1 = every pixel every frame (no history). */
export type TemporalRate = 1 | 2 | 4;
const NO_LIMIT = 1.0e6;
export const CLOUD_QUALITY_PRESETS: Record<CloudQuality, CloudQualityPreset> = {
  ultra: { nearScale: 0.5, farScale: 0.75, splitDistance: 240, maxSteps: 1024, transmittanceCutoff: 0.005, temporalNear: 1, temporalFar: 1, stepScale: 1, microDist: 4, detailDistance: 150, farLimit: NO_LIMIT, lightGridDivisor: 1, domeSize: 256, domeMaxSteps: 96, skyScale: 0.75, outputScale: 1, domeEnabled: true, fineDistance: 3000 },
  high: { nearScale: 0.28, farScale: 0.41, splitDistance: 200, maxSteps: 768, transmittanceCutoff: 0.01, temporalNear: 4, temporalFar: 4, stepScale: 1, microDist: 4, detailDistance: 150, farLimit: NO_LIMIT, lightGridDivisor: 1, domeSize: 256, domeMaxSteps: 96, skyScale: 0.5, outputScale: 1, domeEnabled: true, fineDistance: 3000 },
  medium: { nearScale: 0.25, farScale: 0.4, splitDistance: 200, maxSteps: 512, transmittanceCutoff: 0.03, temporalNear: 4, temporalFar: 4, stepScale: 1.5, microDist: 4, detailDistance: 150, farLimit: NO_LIMIT, lightGridDivisor: 1, domeSize: 256, domeMaxSteps: 64, skyScale: 0.25, outputScale: 1, domeEnabled: true, fineDistance: 1500 },
  low: { nearScale: 0.18, farScale: 0.26, splitDistance: 160, maxSteps: 320, transmittanceCutoff: 0.05, temporalNear: 4, temporalFar: 4, stepScale: 2, microDist: 0, detailDistance: 100, farLimit: NO_LIMIT, lightGridDivisor: 2, domeSize: 128, domeMaxSteps: 48, skyScale: 0.2, outputScale: 0.5, domeEnabled: true, fineDistance: 600 },
  mobile: { nearScale: 0, farScale: 0.15, splitDistance: 0, maxSteps: 160, transmittanceCutoff: 0.08, temporalNear: 4, temporalFar: 4, stepScale: 2, microDist: 0, detailDistance: 60, farLimit: 6000, lightGridDivisor: 2, domeSize: 64, domeMaxSteps: 32, skyScale: 0.125, outputScale: 0.5, domeEnabled: false, fineDistance: 0 },
};

/** Live knobs. Safe to change every frame. */
export interface CloudSettings {
  /** Extinction coefficient (1/m) at density 1. */
  densityScale: number;
  /** Multiplier on the light grid's optical depth (the grid sums the cheap profile term, which underestimates the up-rezzed density). */
  lightDensityScale: number;
  /** Strength of the inner-glow (multiple scattering) term. Art knob, default 1. */
  msStrength: number;
  /** Strength of the sky-ambient term. Art knob, default 1. */
  ambientStrength: number;
  /** Weight of the forward (silver lining) HG lobe in the phase function, 0..1. */
  silverStrength: number;
  /** Anisotropy of the base lobe (Nubis: about 0.2) and of the forward lobe. */
  phaseG: number;
  silverG: number;
  /** Scales the optical depth the ambient light sees on its way down (diffuse falloff 1 / (1 + k * tauUp), H3). */
  ambientExtinction: number;
  /** 0..1: front-lit (sun behind the viewer) darkening of low in-scatter-probability regions (the edges): the direct light is modulated by the profile. 0 = off. */
  edgeDarkening: number;
  /** Extra inner glow when looking toward the sun: multiplies the multiple-scattering term by 1 + glowBoost * sunRelax. 0 = off. */
  glowBoost: number;
  /** 0..1: floor of the sky-above weight in the ambient blend (cloud base uses ambientSkyBias of the sky, the rest ground light). Nubis reference: 0.3. */
  ambientSkyBias: number;
  /** 0..1: how much of the sun-facing inner-glow relaxation also applies when the sun is behind the viewer (bright interior bulges). 0 = Nubis. */
  glowFront: number;
  /** 0..1: bias of the detail type toward wispy at low height fraction. 0 = unchanged Nubis density. */
  wispyBias: number;
  /** P3-F: strength of the deep multiple-scattering octaves (Wrenninge/Hillaire): thick cores keep a blue-grey floor. 0 = off. */
  deepScatter: number;
  /** P3-F: extinction falloff a per octave (exp(-a^n tau)); larger = the floor dies sooner with depth. */
  deepAttenuation: number;
  /** P3-F: 0..1 share of the sky ambient that survives any depth of cloud (soft-saturating exp(-tauUp) and profile occlusion). 0 = old behaviour. */
  ambientFloor: number;
  /** Q-1: length (m) of the short full-density sun sample taken from every lit march step (billow-scale self-shadowing). 0 = off. */
  microDist: number;
  /** Q-1: 0..1 weight of the billow occlusion (from the micro sample) on the glow terms (ms, deep octaves). 0 = glow ignores it. */
  microShadow: number;
  /** Q-1: erosion amplitude bias, noise * (1 + detailBias) before the erosion. 0 = Nubis. */
  detailBias: number;
  /** Q-1: scales the march step floor (3 m + 0.2 sqrt(t)). 1 = P3-E tuning. */
  stepScale: number;
  /** P13-H1: distance (m) within which the march reads the volume's fine hero overlay (GpuCloudVolume.fine); the tiers set it, 0 = off. */
  fineDistance: number;
  /** C1 debug: 0 = normal; 1, 2, 3, 4, 5 = render only the direct, multiple-scattering (ms), deep-octave, ambient or environment-body term, without aerial perspective; C2: 6 = all terms, without aerial perspective and haze. */
  lightDebug: number;
  /**
   * C1 low-sun handoff (Bouthors 2008): the sun's share of the multiple-scattering body terms (ms, deep octaves) is
   * mix(bodySunFloor, 1, saturate(sin(sun elevation) / bodySunKnee)); 1 at and above the knee (default 0.4, about 24 degrees), so higher suns are unchanged.
   */
  bodySunFloor: number;
  bodySunKnee: number;
  /** C1: gain of the environment-lit body that takes over what the sun's share loses (sky above, ground bounce below). 0 = off. */
  bodyEnv: number;
  /**
   * C1: dense cloud scatters the sun away before it reaches the body: the sun's share is also multiplied by exp(-tau * bodyDepth * (1 - sunUp)),
   * tau = the optical depth toward the sun, sunUp = saturate(sin(elevation) / bodySunKnee). So thick regions go sky-lit at low sun; unchanged above the knee.
   */
  bodyDepth: number;
  /** C1: weight toward the sun when the sky is reduced to the body's environment light (RDR2 S36). 0 = plain cosine-weighted mean. */
  envSunWeight: number;
  /** C1: 0..1, how far the cloud ambient leans from the plain sky hemispheres to the environment pair (sun-weighted sky, ground bounce) at low sun. 0 = off; unchanged above the knee. */
  ambientLowSun: number;
  /** C1: albedo of the ground whose bounce lights the body from below at low sun. */
  groundAlbedo: number;
  /** C1: phase function: 'hg' = the two-lobe HG mix (phaseG, silverG, silverStrength), 'mie' = the HG + Draine fit of droplets (Jendersie & d'Eon 2023). */
  phaseModel: 'hg' | 'mie';
  /** C1: mean droplet diameter (um, 5..50) of the 'mie' phase model. */
  dropletDiameter: number;
  /**
   * C2 horizon haze: extinction (per km) of a boundary-layer haze at `hazeBase`, falling off exponentially with height over `hazeHeight` metres. It is applied
   * once per ray at the cloud's transmittance-weighted distance, with the analytic optical depth of the camera-to-cloud segment, and fades the cloud toward
   * the sky's own radiance in that direction (sky-view LUT): a far cloud dissolves into the horizon sky behind it and clear sky is unchanged. On top of the
   * sky's aerial perspective, whose default air is very clean (about 200 km visibility). 0 = off; needs the sky (no effect with uniform lighting).
   */
  hazeDensity: number;
  hazeHeight: number;
  /** C2: altitude (m) of the haze's densest level (flat world: world y). */
  hazeBase: number;
  /** P13-H1: scales the erosion noise inside fine bricks (1 = Nubis; 0.6-1 if fine heroes read double-detailed). */
  fineErosion: number;
  /**
   * P1 (pits vs billows) up-rez noise convention. Bit flags: 1 = billowy channels (B/A, Alligator) read as 1 - n, 2 = wispy channels
   * (R/G, Curly-Alligator) read as 1 - n. 0 = the pack's texture as shipped (assets/nubis-voxel-clouds/Noise), the source-correct default.
   */
  noiseInvert: number;
  /** P1 diagnostic: < 0 = the NVDF's detail type (default); 0..1 = that constant type everywhere (0 wispy, 1 billowy). */
  detailTypeOverride: number;
  /**
   * P1: 0..1, how far the detail type is lifted to the density scale, type = mix(T, max(T, S), typeFromScale). 0 = Nubis (raw NVDF type).
   * Reading of the s98/s100 comment "blend to wispy as the density scale decreases": dense regions stay billowy, so the wispy
   * Curly-Alligator channels (isolated bright blobs that erode into round holes) cannot pit an opaque surface.
   */
  typeFromScale: number;
  /**
   * D0: how the sky ambient falls off with the summed density above a sample (tauUp). 0 (default) = the H3 diffuse law 1 / (1 + tauUp);
   * 1 = the deck's exp(-tauUp) (N3 s128). Both are mixed with ambientFloor.
   */
  ambientLaw: number;
  /** Noise scroll position in metres (integrated from windVelocity). */
  windOffset: [number, number, number];
  windVelocity: [number, number, number];
  animSpeed: number;
  mipDistanceScale: number;
  baseMip: number;
  maxSteps: number;
  /** Rays stop once transmittance falls below this (the quality presets set it). */
  transmittanceCutoff: number;
  /** Near/far boundary along the ray, metres. */
  splitDistance: number;
  /** P5-B: pixels traced per frame in the near / far march = 1/k, k in {1, 2, 4} (other values snap down). The quality presets set them; changing one resets that pass's history. */
  temporalNear: number;
  temporalFar: number;
  /** P5-B: weight of a freshly traced sample against the history (a pixel is traced every k-th frame; more when it moved). Lower = smoother and slower to converge. */
  temporalBlend: number;
  /** P5-C dynamic resolution: multiplies both march passes' resolution (0.25..1). The textures keep their tier size, so changing it is free (no reallocation, no history cut); 'auto' quality drives it. */
  renderScale: number;
  /** P5-C: distance (m) within which the high-frequency detail octave is evaluated (the tiers set it; Nubis: 150, where the octave has faded out anyway). */
  detailDistance: number;
  /** P5-C: the far pass stops marching here, metres (1e6 = no limit). The tiers set it; the distant sky layer can cover what lies beyond. */
  farLimit: number;
  /** 0..1: how dark the full cloud shadow makes opaque scene pixels (folded into the composite alpha). 0 disables. */
  shadowStrength: number;
  /** 1 (default): the composite darkens opaque scene pixels with the cloud shadow. 0: it does not (the shadow map still runs); set by `Clouds.applyShadow` when materials take the shadow through their sun light instead. */
  compositeShadow: number;
  /** P6-B: automatic lightning (`rate` flashes per second inside `region`, see LightningSettings). Off by default (rate 0). Flashes from `flash()` work regardless. */
  lightning: LightningSettings;
  /**
   * X1: 'nvdf' (default) renders the voxel field (and the sky layer when enabled). 'procedural' renders the model given to `setProceduralModel`
   * (procedural/index.ts: a per-sample HZD / Sky Pro style density) from the camera to the horizon through the sky layer's targets, resolve and
   * composite, with the same lighting, haze and aerial perspective; the voxel march is skipped. Without a ready model it falls back to 'nvdf'.
   * X3: 'hybrid' renders both in one frame: the voxel field (heroes, stamps, a generated field) through the march, and the procedural model in
   * place of the NVDF sky layer, split per pixel at the voxel cloud's distance into the part in front of it and the part behind, so the composite
   * orders them (front over voxel over back). Where the two overlap their densities add; the procedural light taps also see the voxel field.
   */
  densityModel: 'nvdf' | 'procedural' | 'hybrid';
  /**
   * U2 render levels (work/compass "Render levels"): 'cinematic' (default) is the path before U2, unchanged: the sky layer at its own
   * resolutionScale, upsampled bilinearly by the composite. 'desktop' renders the sky layer at levelScaleDesktop (0.5) of the output and
   * 'laptop' at levelScaleLaptop (0.25), and @pmndrs/upscaler (upscale.ts; upscalePath, default its temporal path) brings it to the output
   * size, where the composite merges it over the scene with the full-size scene depth. Needs densityModel 'procedural' (the layer is then
   * the whole cloud); with a voxel box ('nvdf', 'hybrid') the levels only change the layer's size. Until the upscaler's pipelines are
   * compiled (a few frames) the reduced layer is composited the old way.
   */
  renderLevel: CloudRenderLevel;
  /** U2: the sky layer's size at the 'desktop' level, relative to the output (linear). Default 0.5. */
  levelScaleDesktop: number;
  /** U2: the sky layer's size at the 'laptop' level, relative to the output (linear). Default 0.25 (1/3 is the softer alternative). */
  levelScaleLaptop: number;
  /** U2: the upscaler's path at the desktop and laptop levels: 'temporal' (FSR2/3-style, default), 'spatial' (FSR1 EASU + RCAS) or 'bilinear' (a plain blit, for comparison). */
  upscalePath: 'temporal' | 'spatial' | 'bilinear';
  /** U2: the upscaler's RCAS sharpening, 0..1 (its own default is 0.8). Default 0.5. */
  upscaleSharpness: number;
  /**
   * U2: a fixed conditioning exposure for the upscaler (it divides it back out, so the brightness does not change), passed as its exposure
   * texture; 0 (default) = its auto exposure with upscaleColorScale. Its auto exposure alone, on the mostly black premultiplied cloud colour,
   * sits at its 8x cap and makes its tonemap non-linear: dark rims and stair-stepped cloud edges. A fixed value lost the device on start-up
   * in some runs (see upscale.ts), so it is the option, not the default.
   */
  upscaleExposure: number;
  /**
   * U2: the colour going into the upscaler is multiplied by this and divided back out in the composite (upscaleExposure 0 only). The upscaler's
   * auto exposure tops out at 8x on the mostly black cloud colour, so 1/64 conditions it at an effective 1/8: its invertible tonemap stays near
   * linear across cloud edges (no dark rims or stair steps) while its auto-exposure path, the stable one, stays in use. Default 1/64.
   */
  upscaleColorScale: number;
  /** U2: the depth the upscaler sees: 'cloud' (default) the opacity-weighted mean distance of the cloud (far plane where clear), 'flat' the far plane everywhere (no depth edges, so its disocclusion test never fires; colour clipping alone guards the history). */
  upscaleDepth: 'cloud' | 'flat';
  /**
   * S2: the sky trace's sub-pixel ray span (layer pixels, as sky.subPixelSpan) at the desktop and laptop levels; < 0 = sky.subPixelSpan. A layer pixel
   * there is 2-4 output pixels, so the pre-S2 span of 2 averages a 4-8 output-pixel box into the layer's history before the upscaler sees it.
   */
  levelSubPixelSpan: number;
  /**
   * S2: the procedural trace's noise LOD at the desktop and laptop levels (sky.lodLayerPixel there): 0 the output pixel's LOD (pre-S2), 1 the layer
   * pixel's; < 0 = sky.lodLayerPixel. The upscaler runs without jitter, so it cannot resolve noise finer than the layer pixel: it aliases instead.
   */
  levelLodLayerPixel: number;
  /**
   * X3: the lighting model of the voxel march and the NVDF sky layer. 'nubis' (default): the N3 model (SDF depth, in-scatter profile, glow,
   * deep octaves, C1 low-sun handoff). 'octave': the per-sample Frostbite / Takram model (Wrenninge octaves, two-lobe HG, sky irradiance
   * along a height gradient, powder; LIGHTING_WGSL cloudOctaveLight). P1.2a 'fit': a tiny physical model (direct HG exp(-tau), an isotropic
   * multiple-scattering term with diffusion falloff, an ambient split by the open-sky share; LIGHTING_WGSL cloudFitLight, fit* settings), voxel
   * march only. The procedural model has its own (ProceduralSettings.lightingModel).
   */
  lightingModel: 'nubis' | 'octave' | 'fit';
  /**
   * V2: extinction (1/m) per unit of VDB density for a direct volume (GpuCloudVolume.direct, scripts/vdb/vdb_to_direct.py), which is marched
   * as-is (native resolution, trilinear, no profile / erosion / up-rez) with the same lighting; it replaces `densityScale` while such a volume
   * is set (the light grid, shadow map and dome follow). VDB density units are arbitrary: 0.6 matches the V1 Karma reference rig. The grid's
   * fudge `lightDensityScale` (for the up-rez the grid does not see) should be 1 for a direct volume, which the grid sees exactly.
   */
  directDensity: number;
  /**
   * M1 (Nubis lighting): weight of the diffuse sun term, the high scattering orders as an isotropic diffusion with the two-stream falloff
   * 1 / (1 + 0.11 tau) in the optical depth toward the sun. Fills shaded creases with warm diffused sunlight instead of leaving them to the sky
   * ambient (Karma, V1). 0 = off (the N3 model).
   */
  diffuseSun: number;
  /** M1: k of the diffuse sun's falloff 1 / (1 + k tau). Two-stream theory along the straight sun ray: 0.75 (1 - g) = 0.11 at g 0.85; light also diffuses around a lobe, so the effective k is lower. */
  diffuseFalloff: number;
  /** M1 tone shift of the sky light the cloud sees (Nubis lighting): 1 = the sky's own colour, 0 = grey at the same luminance. */
  ambientSaturation: number;
  /** M1 hue shift of the sky light the cloud sees (Nubis lighting): 0..1 toward the sun's chromaticity at the same luminance. 0 = off. */
  ambientWarmth: number;
  /** M1 direct volumes: in-scatter weight ('profile' of the Nubis lighting) = mix(saturate(density / densityRef), 1, directInScatterFlat). */
  directInScatterFlat: number;
  /**
   * D1: scale of the optical depth of the in-line sun taps (the micro sample and the two in-line samples, 0-48 m toward the sun) relative to
   * the view ray's extinction. 1 = the taps use the full view extinction (densityScale per unit density per metre). The deck's light sums are
   * sums of density *samples* (s113/s123: 'inSunLightSummedDensitySamples'), so one unit of summed density is one sample, not one metre at the
   * view extinction; with a sample spacing of about 16 m that is 1/16 of the metre-integrated depth. The light grid already has its own scale
   * (`lightDensityScale`); this one brings the in-line part to the same units (at 1 the two parts are 10x apart on the deck look).
   */
  inlineLightScale: number;
  /**
   * D1 (N3 s150): 1 = the march jitter is static (one fixed hash per pixel) beyond 250 m and animated within, as Decima ships it;
   * 0 = animated at every distance (Q2: the static hash printed IGN's hatch into dense distant cloud under the temporal resolve).
   */
  jitterStatic: number;
  /**
   * D1: 1 = the two in-line sun samples (0-48 m toward the sun) read the cheap profile P * S (s82 `mProfile`, what the light grid is built from)
   * instead of the up-rezzed density. The up-rezzed field has 8-20 m erosion holes (P1: the wispy noise); one sample standing for 16-48 m of
   * it prints a 10-25 m mottle into the shading that Decima's frames do not show. 0 = the up-rezzed density (D0 and before).
   */
  inlineProfile: number;
  /** D1: mip level added to the field and noise fetches of the in-line sun samples (0 = the view sample's mip). Smooths what the taps see. */
  lightMipBias: number;
  /**
   * D1 round 2: 1 = at temporal rate 1 (every pixel every frame: ultra) the march writes a full-size trace and the resolve blends it into the
   * history at `temporalBlend`, so a still or slow view averages its jitter over frames (the TAA Decima's frames have). 0 = the march writes the
   * history directly and every frame is one jittered sample set: the interleaved-gradient jitter prints a fixed fingerprint-like whorl texture into
   * every surface (the judges' 'fibre') and changes it frame to frame (the owner's instability). Costs the resolve pass (~0.3-0.6 ms at 1080p
   * ultra) and a full-size trace target per pass.
   */
  temporalAccumulate: number;
  /**
   * D1 round 3: length (m) of one upward sample of the up-rezzed density taken from every lit step; its optical depth (in the in-line light units)
   * occludes the ambient, exp(-d_up * ambientTap * extinction * inlineLightScale). A lobe-scale ambient occlusion: a crease has cloud above it
   * within a few tens of metres, a lobe tip has not. The deck's ambient (s128) reads the light grid's up sum of the smooth profile, which has no
   * lobes, so its shadow side is flat; Decima's frames show nested lobe pockets on the shadow side too. 0 = off (one density fetch saved).
   */
  ambientTap: number;
  /**
   * D1 round 3: 0..1, how far the lower-hemisphere ambient (what lights undersides, `ambientSkyBias` shares it in) follows the upper one. The
   * deck frames have no ground: their sky gradient continues below the horizon near white, so Decima's undersides are lit from below; our lower
   * hemisphere is the dark sea / ground. 1 = the sky mirrored below the horizon for the cloud's ambient. 0 = the scene's own lower hemisphere.
   */
  ambientBelowMirror: number;
  /**
   * D1 round 9: now an exponent, the lighting profile is P x S^(1 - inScatterProfile): 0.5 = P sqrt(S) (between the two below).
   * D1 round 3: which profile the Nubis lighting's in-scatter probability and ambient occlusion read. 0 = `mProfile` = profile x density scale
   * (what the light grid is built from; P1 and before). 1 = the deck's `dimensional_profile` alone (s123 `ms_volume = dimensional_profile`,
   * s126 `pow(1 - dimensional_profile, 0.5)`): where the density scale is low (most of Parkouring, S about 0.24) the ms glow is 4x stronger and
   * the ambient occlusion deeper than with P x S, and the two S = 1 cores no longer stand apart (one 8-bit NVDF fetch per lit step).
   */
  inScatterProfile: number;
  /**
   * D1 round 5: 1 = the march jitter is a blue-noise mask per pixel plus the golden-ratio sequence per frame; 0 = interleaved gradient noise
   * (Jimenez 2014). Under the temporal resolve the residual of IGN is its diagonal whorl structure (contour / fingerprint rings on every smooth
   * face); the residual of blue noise is a fine grain below the eye's contrast threshold.
   */
  jitterNoise: number;
  /**
   * D1 round 5: 1 = the march's step sequence starts at a random phase (per pixel and frame) where the ray enters the cloud. With the sample
   * jitter alone the segment boundaries are fixed per ray and the one-density-per-segment estimator is biased by the segment's phase against
   * the surface, so rays with different entry phases shade differently: arcs at the step period along the entry-depth contours.
   */
  stepJitter: number;
  /** D1 round 5: 1 = tricubic B-spline reads of the light grid's sun sum in the march (C2 across the 16 m cells; 8 trilinear taps), 0 = trilinear. */
  lightGridFilter: number;
  /** D1 round 5: distance (m) within which the two in-line sun samples are reused by the following steps (P3-E; 4 before). 0 = fresh taps at every lit step. */
  inlineReuse: number;
  /**
   * D1 round 8: metres along the view ray past the sample at which the glow's in-scatter profile P is read (0 = at the sample). The deck's
   * glow is light scattered deeper inside shining through the surface (s116-119); read at the sample, a profile lobe protruding toward the
   * camera has a small P at its front and prints a dark disc on the shade side (round 7's finding). `glowDepthMode` 1 takes the max of both reads.
   */
  glowDepth: number;
  /** 0 = along the view ray, 1 = the max of the sample's and the deeper read, 2 (D1 round 9) = inward along the SDF gradient (the lobe's own core). */
  glowDepthMode: number;
  /**
   * D1 round 9 (the floret investigation, H1): the micro sun tap's (`microDist` m) optical depth as a fraction of the view extinction, so the
   * first metres toward the sun occlude at the density the view sees (the florets' own self-shadow) while the two in-line taps keep the grid's
   * units (`inlineLightScale`). 0 = the micro tap in the in-line taps' units (before round 9).
   */
  microLightScale: number;
  /**
   * D1 round 10 (the floret investigation's H2): how `microShadow` occludes the glow terms. 0 = by the micro tap's whole optical depth (Q-1), which
   * also darkens every shaded and deep part (the mean occlusion is already in the relaxed tau). 1 = by the residual of the up-rezzed density over
   * the profile density along the same tap (max(full - profile, 0), the florets' own relief toward the sun): the gap beside a dome darkens
   * where the tap runs into the next dome, the faces keep their mean (no brightening: a negative residual printed glints).
   */
  microShadowMode: number;
  /** D1 round 11: a second micro sun tap from `microDist` to this distance (m; 0 = off) with its own occlusion weight `microShadow2`: two floret scales. */
  microDist2: number;
  microShadow2: number;
  /** D1 round 11: the direct term weighted by the in-scatter probability (0 = none, 1 = fully; the deck's dark edges on thin material). */
  directProfile: number;
  /** D1 round 12: `directProfile` applies within this depth (m) of the SDF surface only (an edge term); 0 = everywhere. */
  directRimDepth: number;
  /**
   * D1 round 8: 1 = the temporal resolve reprojects the history through the wind's displacement of the up-rez noise since the previous frame
   * (the noise scrolls at windVelocity; uncompensated, the exponential resolve smeared the florets along the wind by 2-4 px at 4k and halved
   * the lit crests' 4-12 px energy). Measured: the bilinear history read at a sub-pixel wind shift blurs as much as the drift did, so this
   * needs a sharper history filter (Catmull-Rom) before it helps; off until then. The parity page stops the wind instead (refs.ts settings).
   */
  windCompensate: number;
  /** D1 round 9: 1 = Catmull-Rom history read in the temporal resolve (keeps sub-pixel detail under the wind compensation), 0 = bilinear. */
  historyFilter: number;
  /** D1 round 8: the up-rez noise's world scale (1 / tiling period in metres; the pack's sampler uses 0.01 = 100 m). Investigation knob for the floret scale. */
  noiseScale: number;
  /**
   * D1 round 7: 1 = stochastic rounding of the temporal history (rgba16float): at `temporalBlend` 0.1 the exponential update stalls below
   * 5 ulp, which on bright faces is over half an 8-bit step, so converged gradients print concentric contour rings (the judges' whorls on
   * the lit faces). 0 = round to nearest (before round 7).
   */
  historyDither: number;
  /**
   * D1 round 6: bit flags, 1 = the lighting's profile read (inScatterProfile) is tricubic, 2 = its SDF read (the glow relaxation) is tricubic.
   * Trilinear reads are C0 across the 8 m voxel planes; the lighting prints the kink as a straight seam where a plane is seen edge-on.
   */
  profileFilter: number;
  /**
   * P0.5 converged march (docs/AUDIT-2026-11.md step 0.5): 1 = a slow ground truth of our own lighting and density with the sampling shortcuts
   * removed, for judging stepping, jitter, temporal blending, amortised updates and upscaling. It does not change what is integrated, only how
   * finely. Every pixel of both march passes and of the sky layer is traced every frame at the output's resolution (no 1/k or 1/16 amortisation,
   * no history blend, render level 'cinematic': no upscaler, render scale 1), the march steps are divided by `convergedStepScale` with the step
   * budget raised to match, light taps are recomputed at every lit step, and `convergedSamples` frames are accumulated (linear radiance, float)
   * with a different march jitter (blue noise + golden ratio) and sub-pixel offset (Halton 2, 3: a one-pixel box) per sample, then shown through
   * the normal composite and tone map. The wind and the clock stand still while it is on; the sum restarts when the camera, the sun or any setting
   * changes. Seconds per frame; `convergedInfo` reports progress. 0 (default) = the normal renderer, untouched.
   */
  converged: number;
  /** P0.5: the converged march's step divisor (default 4). */
  convergedStepScale: number;
  /** P0.5: frames accumulated by the converged march (default 16). */
  convergedSamples: number;
  /**
   * P0.5: each sample is traced over this many frames, one band of rows per frame (0 = auto: the step divisor, so a frame costs about one full
   * normal-resolution trace). Keeps every GPU submission short: a whole converged sample in one submission can trip the GPU watchdog.
   */
  convergedBands: number;
  /** P0.5: offset of the converged march's sample sequence (0 = samples 0..n-1); a different value gives an independent sample set of the same image (the stability test). */
  convergedSeed: number;
  /**
   * P0.5 diagnostics (default 0): bit flags of normal-march shortcuts the converged march keeps, to attribute a converged-vs-normal difference:
   * 1 = the thin-segment light skip (segments under 0.002 optical depth attenuate but add no light), 2 = the light-tap reuse along the ray,
   * 4 = the normal transmittance cutoffs (else 1e-4).
   */
  convergedKeep: number;
  /**
   * P1.1 light probe (debug, default 0 = off; docs/AUDIT-2026-11.md step 1.1): > 0 = the march writes, instead of radiance, the lighting inputs of
   * the first lit sample at which the view ray's optical depth reaches this value (pixel-centre ray, no sub-pixel offset; use with converged on
   * and convergedSamples 1). `lightProbeMode` 0: rgb = (sun optical depth tau as the direct term uses it, floor(t / 8), t - 8 floor(t / 8)) with
   * t the sample's distance along the ray (m); 1: rgb = (in-line + micro part of tau, light-grid part of tau, view optical depth at the sample).
   * Pixels whose ray never reaches the depth write 0. Normal rendering is untouched while it is 0.
   */
  lightProbe: number;
  /** P1.1: what the light probe writes (see `lightProbe`). */
  lightProbeMode: number;
  /**
   * P1.1 debug (default 0): 1 = the march lights every sample with the sun at the volume centre (skyLight[0], what the reference path tracer
   * uses) instead of the per-height sun (sunRadianceAtHeight). Isolates the height variation of the sun's colour as a factor; not a look setting.
   */
  sunAtCentre: number;
  /**
   * P1.1 diagnostic (default 0): 1 = for a direct volume, the light grid integrates the march's own density (the r16f direct texture: unclamped,
   * no 8-bit step, no 1/255 floor) instead of the NVDF R channel. Isolates the grid's input as a factor in the sun's optical depth; ignored for an
   * NVDF volume.
   */
  lightGridSource: number;
  /**
   * P1.1 diagnostic (default 0): 1 = the light grid at the volume's own resolution instead of half (8x the memory: about 24 bytes per volume
   * voxel; only for small volumes). Isolates the grid's resolution as a factor. A change rebuilds the grid.
   */
  lightGridFull: number;
  // ---- sunShadow block (P1.1b, docs/AUDIT-2026-11.md step 1.1; work/reports/P1-1b-sun-shadow.md) ----
  // How the optical depth from a lit sample to the sun is estimated. Every key defaults to the behaviour before P1.1b (the frame is bit-identical);
  // each non-default value is a more accurate estimate of the same quantity (the optical depth through the density the view ray renders), never a
  // gain. `lightDensityScale` (above) belongs to the same estimate: 1 is the physical value. The reference-pt card's "accurate sun shadow" preset
  // turns on the recommended combination.
  /**
   * What the light grid integrates. 0 = the NVDF R channel's profile x density scale (before P1.1b: on a direct volume that channel is an 8-bit copy
   * of the density, clamped at p99, with a 1/255 floor wherever there is any density); 1 = the density the march renders: a direct volume's r16f
   * texels (unclamped, no floor), an NVDF volume's up-rezzed density (DENSITY_WGSL, the noise mip and high-frequency fold at each texel's distance
   * to the camera, as the march sees it) averaged over 4x4x4 points per grid cell. The grid's up sum (ambient, ms) stays on the old source, so only
   * the sun's optical depth changes. A change, and for NVDF volumes a camera move over 1 m, rebuilds the grid (one reduce pass + the sliced build).
   */
  sunShadowGridSource: number;
  /** 1 = the light grid at the volume's own resolution instead of half: 8x the grid memory (3 rgba16float textures, 24 bytes per volume voxel). */
  sunShadowGridFull: number;
  /**
   * Metres toward the sun the in-line taps cover before the grid takes over (48 = before P1.1b; the grid is read this far toward the sun). The taps
   * read the march's own density function. With more than 48 m, `sunShadowInlineSamples` taps share reach - 16 m in a geometric ladder.
   */
  sunShadowInlineReach: number;
  /** In-line taps beyond the first 16 m (1 = the single 16-48 m tap before P1.1b). Each is one more density evaluation per lit step. */
  sunShadowInlineSamples: number;
  /** 1 = the ladder's taps at a per-pixel, per-frame jittered position in their segments; 0 = the midpoints (measured: the jitter brightens, see the WGSL). */
  sunShadowInlineJitter: number;
  /** Single-scattering albedo on the direct (sun) term: 1 = none (before P1.1b); clouds 0.99+ (the path tracer's medium is 0.99). */
  directAlbedo: number;
  /** P1.2a 'fit' model: single-scattering albedo on every term. */
  fitAlbedo: number;
  /** P1.2a 'fit' model: Henyey-Greenstein g of the direct term. */
  fitG: number;
  /** P1.2a 'fit' model: weight of the isotropic multiple-scattering term (sun albedo fitMs / 4 pi / (1 + fitK tau)). */
  fitMs: number;
  /** P1.2a 'fit' model: the diffusion falloff per unit optical depth (ms term and the open-sky share of the ambient). */
  fitK: number;
  /** P1.2a 'fit' model: gain on the ambient term. */
  fitAmbient: number;
}

/**
 * M1: the material balance fitted against the Karma references (V1: brute-force bounces, albedo 0.99, sigma = 0.6 / m per unit of EmberGen
 * density; work/reports/M1.md). Lighting only, so it also applies to an NVDF (Nubis chain) volume: the Frog page opts in with it.
 * - microShadow 0, glowBoost 0: no per-billow shadowing of the glow and no forward glow boost; both printed the 4 m texture of a sim into the
 *   shading and made the body glow white ('foam').
 * - diffuseSun 0.5 / diffuseFalloff 0.06 with msStrength / deepScatter 0.2: the shaded body is lit by sunlight diffused through the cloud
 *   (a warm grey) rather than by the sky alone (blue).
 * - ambientStrength 0.5, ambientSaturation 0.5, ambientWarmth 0.7: less and greyer sky light (the tone/hue shift toward Karma's neutral shade).
 */
export const MATERIAL_SETTINGS = {
  microShadow: 0, glowBoost: 0, msStrength: 0.2, deepScatter: 0.2,
  diffuseSun: 0.5, diffuseFalloff: 0.06, ambientStrength: 0.5, ambientSaturation: 0.5, ambientWarmth: 0.7,
} satisfies Partial<CloudSettings>;
/**
 * M1: what setVolume applies for a direct volume (an imported VDB marched as-is, V2) with option material 'auto' (the default), restoring the
 * previous values when a non-direct asset is set again; 'keep' leaves the settings alone. MATERIAL_SETTINGS plus:
 * - lightDensityScale 1: the grid integrates the exact density (the 1.2 compensates the NVDF up-rez the grid does not see).
 * - directInScatterFlat 1: in-scatter weight 1 instead of saturate(density / p99); radiance is a property of the light field, not of the voxel.
 */
export const DIRECT_VOLUME_SETTINGS = { ...MATERIAL_SETTINGS, lightDensityScale: 1, directInScatterFlat: 1 } satisfies Partial<CloudSettings>;
type MaterialKey = keyof typeof DIRECT_VOLUME_SETTINGS;

export interface CloudUniformLighting {
  kind: 'uniform';
  /** Sun illuminance (RGB). */
  sunRadiance: ArrayLike<number>;
  /** Mean sky radiance from above and from below (RGB). */
  ambientTop: ArrayLike<number>;
  ambientBottom: ArrayLike<number>;
}

export interface CloudFrame {
  /** Column-major 4x4. Only inverseViewProjection is read in P1; the rest are for later passes. */
  view: Float32Array;
  projection: Float32Array;
  viewProjection: Float32Array;
  inverseViewProjection: Float32Array;
  previousViewProjection: Float32Array;
  cameraPosition: ArrayLike<number>;
  /** Scene depth at output resolution, conventional 0..1 (depth-only aspect). */
  depth: GPUTextureView;
  depthKind: 'depth32float' | 'depth24plus';
  sunDirection: ArrayLike<number>;
  /** Bind group for atmosphereWgsl(2) (sky LUTs + uniform), e.g. the sky bridge's. Sun radiance, ambient and aerial perspective come from it. Required unless `lighting` is given. */
  atmosphere?: GPUBindGroup;
  /** Uniform lighting for users without a sky library: no aerial perspective, `atmosphere` is ignored. Radiances in the same exposure units as the scene lights. */
  lighting?: CloudUniformLighting;
  time: number;
  frameIndex: number;
}

export interface CloudRuntime {
  readonly settings: CloudSettings;
  /** Texture to blend: scene * a + rgb. Owned by the runtime unless one was passed to resize(). */
  readonly output: GPUTexture | null;
  /** Far-pass (half-res) size; `nearRenderSize` is the near pass. */
  readonly renderSize: [number, number];
  readonly nearRenderSize: [number, number];
  /** True once the volume, noise and output exist, so `encode` writes `output`. Present the plain scene until then. */
  readonly ready: boolean;
  /**
   * A CloudVolumeAsset is uploaded (and owned) by the runtime. A GpuCloudVolume (e.g. from the generator) is used as is and is
   * never destroyed by the runtime.
   */
  setVolume(asset: CloudVolumeAsset | GpuCloudVolume, options: { position: [number, number, number]; material?: 'auto' | 'keep' }): Promise<void>;
  /**
   * Replace the volume by another caller-owned GpuCloudVolume of the same dims, voxel size and extent without touching anything else
   * (P6-A, for time-evolving fields): the temporal history is kept, the light grid is kept and rebuilt in its amortized slices from the new
   * volume (instead of being recreated and built in one frame), the bind group is rebuilt. Returns false, doing nothing, if that is not possible
   * (no volume yet, the current volume is runtime-owned, or the shape differs): call `setVolume` then.
   */
  swapVolume(volume: GpuCloudVolume, options: { position: [number, number, number] }): boolean;
  /** Move the volume box without rebuilding anything (a uniform write). For fields that drift with the wind; sub-voxel to few-voxel moves keep the light grid valid. */
  setVolumePosition(position: [number, number, number]): void;
  /**
   * P6-B: a lightning flash, a transient point light inside the cloud (Nubis³ glow term in the march). `position` is in world metres, `radius` the
   * reach of the glow, `intensity` a multiple of the scene's own light (sun + sky ambient, so it follows exposure), `duration` seconds (default 0.3,
   * with 2-4 return strokes). One flash is rendered at a time (the brightest). Costs nothing while no flash is active. The temporal history is
   * not cut; the resolve favours fresh samples while a flash is up so it does not smear.
   */
  flash(options: FlashOptions): void;
  /** Envelope 0..1 of the flash rendered by the last `encode` (0 = none active). For tooling. */
  readonly flashLevel: number;
  setNoise(asset: CloudNoiseAsset): Promise<void>;
  setQuality(quality: CloudQuality): void;
  /** The tier in effect (for 'auto', the one it picked). */
  readonly quality: CloudQuality;
  /** The tier's composite scale (CloudQualityPreset.outputScale). When it is below 1 the `output` texture is `round(scene size * outputScale)`: pass a texture of that size to `resize`, or none to let the runtime own it, and upsample it bilinearly when blending. */
  readonly outputScale: number;
  /** Size of `output` (the scene size times `outputScale`); [0, 0] before the first `resize`. */
  readonly outputSize: [number, number];
  /** 'auto' quality state (tier, render scale, measured cost, budget), or null for a fixed tier. */
  readonly auto: AutoQualityInfo | null;
  /** Change the 'auto' GPU budget (ms of cloud passes per frame) at run time. No effect on fixed tiers. */
  setBudget(ms: number): void;
  /** GPU memory this runtime holds, bytes (history and trace targets, sky targets, output if owned, dome, light grid). The volume and noise assets are not counted. */
  readonly memory: CloudMemory;
  /** Drop the temporal history: the next frame traces every pixel of both march passes and the sky layer. Call on a cut the runtime cannot see (a sky or lighting jump, a setting change). */
  resetTemporal(): void;
  /**
   * P0.5: the converged march's state: `active` (settings.converged on), samples in the sum and wanted, `done` (the output holds the converged mean
   * and nothing is traced until the view or a setting changes), restarts so far, and `busy` (what restarted it last: 'view', 'shadow', 'grid', '').
   */
  readonly convergedInfo: { active: boolean; samples: number; target: number; done: boolean; restarts: number; reason: string; band: number };
  /** P1.1b: the light grid's texel dims, its memory (two ping-pong textures + the reduced volume, rgba16float) and the volume's dims; null before a volume. */
  readonly lightGridInfo: { dims: [number, number, number]; bytes: number; volumeDims: [number, number, number]; building: boolean; progress: number; passes: number; swaps: number; restarts: number } | null;
  /** Temporal amortization state, for tooling: the rates in effect, history resets so far and the memory the history costs. */
  readonly temporalInfo: { near: TemporalRate; far: TemporalRate; resets: number; frames: number; bytes: number };
  /** `width` x `height` is the scene (depth) size. `output` may be supplied by the caller (rgba16float, STORAGE_BINDING | TEXTURE_BINDING, exactly `outputSize`). */
  resize(width: number, height: number, output?: GPUTexture): void;
  /** World-space extent of the volume once set, metres (x, y-up, z). */
  readonly extent: [number, number, number] | null;
  /** Reflection dome (P2-04): octahedral radiance + transmittance seen from the reference point, refreshed 1/16 per frame. */
  readonly dome: CloudDome;
  /** Distant sky layer (P3-C1, Nubis vertical-profile 2.5D): cloud cover from the voxel region to the horizon. Off by default; see `skyLayer.configure`. */
  readonly skyLayer: SkyLayer;
  /** U2: the render level's upscaler state (null until a level below cinematic was used): ready, and the upscaler's own settings. */
  readonly upscale: { ready: boolean; renderSize: [number, number]; displaySize: [number, number]; settings: SkyUpscale['core']['settings'] } | null;
  /** P9-E: the high cloud layer (cirrus, cirrostratus) at 8-10 km with its own wind, drawn behind the low clouds. Off by default; see `cirrus.settings`. */
  readonly cirrus: CirrusLayer;
  /** L3: the mid-level (altocumulus / altostratus) 2.5D layer, driven by the procedural model's `midLayer` (HZD `midLayerMode` 'layer' | 'hybrid'). Its settings are rewritten from the model each frame. */
  readonly midLayer: CirrusLayer;
  /**
   * Cloud shadow map (P10-A): optical depth along the sun ray over the voxel box and the sky layer's clouds, in two world-anchored cascades
   * (near 8 km at 8 m texels, far 64 km), refreshed a slice per frame. The composite shadows opaque scene pixels with it; adapters read it
   * through `cloudShadowMapWgsl()` (`shadowMap.textures`, `shadowMap.paramsBuffer`).
   */
  readonly shadowMap: CloudShadowMap;
  /** X1: the procedural density model used while `settings.densityModel` is 'procedural' (null: none). The caller owns it. */
  setProceduralModel(model: ProceduralDensityModel | null): void;
  readonly proceduralModel: ProceduralDensityModel | null;
  encode(encoder: GPUCommandEncoder, frame: CloudFrame, timer?: GpuTimer): void;
  dispose(): void;
}

export interface CloudRuntimeOptions {
  /**
   * D1 round 7: multiplies the tier's near / far pass render scales (each clamped to 1). The parity page uses 4/3 so the ultra far pass renders at
   * the output resolution: the depth-aware upsample of a 0.75-scale pass prints stair steps on opaque silhouettes (the judges' serrated edge).
   */
  passScale?: number;
  /** A tier, or 'auto' (tier from the adapter, render scale from the GPU timer). Default 'high'. */
  quality?: CloudQualityOption;
  /** Layout the atmosphere bind group was created with. Omit to use the runtime's own (group-equivalent) layout. */
  atmosphereLayout?: GPUBindGroupLayout;
  /** Reflection dome texture size (square, multiple of 4). Default: the tier's (256 down to 64). */
  domeSize?: number;
  /** 'auto' only: GPU ms the cloud passes should stay within (default 3). Change later with `setBudget`. */
  budgetMs?: number;
  /** 'auto' only: controller tuning (scale range, hysteresis); see AutoQualityOptions. */
  auto?: Partial<AutoQualityOptions>;
  /** 'auto' only: the output size in pixels the tier is picked for (default 1920 x 1080). */
  expectedPixels?: number;
  /** 'auto' only: the device is a phone or tablet. Detected from `navigator` when omitted. */
  mobile?: boolean;
  /** 'auto' only: the GPUAdapter the device came from. Its limits (maxTextureDimension2D, maxBufferSize, ...) then take part in the tier pick; a device's own limits are only what it asked for, so they never do. */
  adapter?: GPUAdapter;
}

/** GPU memory the runtime holds, bytes. The cloud volume and noise assets are the caller's and are not counted. */
export interface CloudMemory {
  /** Resolved history pairs of both march passes (rgba16float colour + r32uint packed distances, two each). */
  history: number;
  /** Fresh-sample targets of the passes that trace 1/k of their pixels (compact). */
  trace: number;
  /** The distant sky layer's targets (allocated even while the layer is off). */
  sky: number;
  /** The composite output, when the runtime owns it (otherwise the caller's texture). */
  output: number;
  dome: number;
  lightGrid: number;
  /** The cloud shadow map's two cascades. */
  shadow: number;
  total: number;
}

function createLightGridLayoutEntries(binding: number): GPUBindGroupLayoutEntry[] {
  return [
    { binding, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
    { binding: binding + 1, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
  ];
}

/**
 * A march pass keeps its textures at the full tier size (w x h) and renders into the top-left rw x rh of them (dynamic resolution), so
 * changing the render scale never reallocates or cuts the history. hist[cur] is the resolved frame: colour rgba16float (premultiplied
 * radiance, a = transmittance) and r32uint packed distances (frame.wgsl.ts packDepth). trace is the compact set of this frame's fresh
 * samples (k = 2: every second pixel of a row; k = 4: one per 2x2 block), allocated only while the pass runs at k > 1.
 */
interface PassTarget {
  name: string; w: number; h: number;
  rw: number; rh: number; prw: number; prh: number;
  hist: { color: GPUTexture; depth: GPUTexture }[];
  trace: { color: GPUTexture; depth: GPUTexture; w: number; h: number } | null;
}

/** Temporal history cuts: the camera jumps or turns more than this in one frame, or the sun does (cosines). */
const TEMPORAL_CUT_POSITION_M = 25;
const TEMPORAL_CUT_TURN_COS = Math.cos(15 * Math.PI / 180);
const TEMPORAL_SUN_JUMP_COS = Math.cos(0.5 * Math.PI / 180);
/** Neighbourhood clip of the history: mean +- gamma sigma of the fresh samples, plus this fraction of the mean. */
/** P6-B: weight of a fresh sample in the resolve while a lightning flash is up (and the frame after). */
const FLASH_BLEND = 0.85;
const TEMPORAL_CLIP_SIGMA = 1.75;
const TEMPORAL_CLIP_MARGIN = 0.03;
/** Frame uniform floats whose change invalidates the history: the cloud model, lighting and march settings (not camera, time, wind, jitter or composite-only knobs). */
const TEMPORAL_MODEL_INDICES = [23, 27, 32, 33, 35, 36, 37, 38, 39, 40, 41, 43, 44, 45, 47, 48, 49, 50, 51, 52, 54, 55, 56, 57, 58, 59, 72, 73, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99];
/** U2: frames the procedural layer runs before the upscaler is created (see encode). */
const UPSCALE_WARM_FRAMES = 240;
/** P0.5 converged march: the step budget's multiplier on top of the step divisor (the normal march's step growth past 256 steps is off), and the transmittance cutoff. */
const CV_BUDGET = 4;
const CV_CUTOFF = 1e-4;
/** Bytes per texel of the history colour (rgba16float) and distance (r32uint) targets, and of the trace's (rgba16float + r32float). */
const SHADOW_MAP_RESOLUTION = 1024;
const HIST_TEXEL_BYTES = 8 + 4;
const TRACE_TEXEL_BYTES = 8 + 4;

/** C1: the HG + Draine fit (Jendersie & d'Eon 2023, eq. 4-7) for a mean droplet diameter d in um, valid for 5..50: (gHG, gD, alpha, wD). */
export function mieParams(diameter: number): [number, number, number, number] {
  const d = Math.min(50, Math.max(5, Number.isFinite(diameter) ? diameter : 10));
  return [
    Math.exp(-0.0990567 / (d - 1.67154)),
    Math.exp(-2.20679 / (d + 3.91029)) - 0.428934,
    Math.exp(3.62489 - 8.29288 / (d + 5.52825)),
    Math.exp(-0.599085 / (d - 0.641583)) - 0.665888,
  ];
}

/**
 * GPU memory a runtime holds for a scene of `width` x `height` at a tier, without creating one (pure arithmetic mirroring the allocations;
 * `CloudRuntime.memory` reports the live numbers). `volumeDims` is the cloud volume's voxel size, which sets the light grid.
 * `ownsOutput` counts the composite output (the three adapter's StorageTexture counts too).
 */
export function estimateCloudMemory(width: number, height: number, quality: CloudQuality, options: { volumeDims?: readonly [number, number, number]; ownsOutput?: boolean } = {}): CloudMemory {
  const p = CLOUD_QUALITY_PRESETS[quality];
  let history = 0, trace = 0;
  for (const [scale, k] of [[p.nearScale, p.temporalNear], [p.farScale, p.temporalFar]] as const) {
    const w = Math.max(2, Math.round(width * scale)), h = Math.max(2, Math.round(height * scale));
    history += 2 * w * h * HIST_TEXEL_BYTES;
    if (k > 1) trace += Math.ceil(w / 2) * (k === 4 ? Math.ceil(h / 2) : h) * TRACE_TEXEL_BYTES;
  }
  const sky = Math.max(1, Math.round(width * p.skyScale)) * Math.max(1, Math.round(height * p.skyScale)) * (8 + 8 + 8);
  const output = options.ownsOutput === false ? 0 : Math.max(1, Math.round(width * p.outputScale)) * Math.max(1, Math.round(height * p.outputScale)) * 8;
  const dome = Math.max(4, p.domeSize & ~3) ** 2 * 8;
  let lightGrid = 0;
  if (options.volumeDims) {
    const g = options.volumeDims.map(d => Math.max(16, Math.ceil((p.lightGridDivisor > 1 ? Math.max(1, Math.round(d / p.lightGridDivisor)) : d) / 2)));
    lightGrid = 3 * g[0] * g[1] * g[2] * 8;
  }
  const shadow = 2 * SHADOW_MAP_RESOLUTION ** 2 * 4;
  return { history, trace, sky, output, dome, lightGrid, shadow, total: history + trace + sky + output + dome + lightGrid + shadow };
}

/** The look knobs of `CloudSettings` that the 'art' and 'deck' looks set (see `cloudLookSettings`). */
export type CloudLookSettings = Pick<CloudSettings, 'densityScale' | 'lightDensityScale' | 'msStrength' | 'ambientStrength' | 'silverStrength' | 'phaseG' | 'silverG'
  | 'ambientExtinction' | 'edgeDarkening' | 'glowBoost' | 'ambientSkyBias' | 'wispyBias' | 'glowFront' | 'deepScatter' | 'deepAttenuation' | 'ambientFloor'
  | 'microShadow' | 'detailBias' | 'noiseInvert' | 'detailTypeOverride' | 'typeFromScale' | 'ambientLaw' | 'bodySunFloor' | 'bodySunKnee' | 'bodyEnv'
  | 'bodyDepth' | 'envSunWeight' | 'ambientLowSun' | 'groundAlbedo' | 'phaseModel' | 'dropletDiameter' | 'hazeDensity' | 'hazeHeight' | 'hazeBase' | 'fineErosion'
  | 'inlineLightScale' | 'inlineProfile' | 'lightMipBias' | 'diffuseSun' | 'diffuseFalloff' | 'ambientSaturation' | 'ambientWarmth'
  | 'inScatterProfile' | 'ambientBelowMirror'>;

/** Our art-directed defaults (what `createCloudRuntime` starts with). */
export const CLOUD_ART_SETTINGS: Readonly<CloudLookSettings> = {
  // Q2: extinction 0.2 -> 0.3 with the sun's optical-depth scale 1.5 -> 1.2: next to Takram and the photos the clouds read as soft, translucent
  // 'potatoes' with little self-shadow between lobes. Denser view rays give crisper edges and sculpted lobes; the lower light scale keeps bodies bright.
  densityScale: 0.3, lightDensityScale: 1.2, msStrength: 1.4, ambientStrength: 1, // P1-09 art defaults (Nubis neutral: 1, 1)
  silverStrength: 0.4, phaseG: 0.2, silverG: 0.85, ambientExtinction: 0.08, // 0.3 left bases charcoal; tuned by orchestrator sweep (P1-09)
  edgeDarkening: 0.5, glowBoost: 12, ambientSkyBias: 0.9, wispyBias: 0, glowFront: 1, deepScatter: 1.2, deepAttenuation: 0.35, ambientFloor: 0.15,
  noiseInvert: 0, detailTypeOverride: -1, typeFromScale: 1, // P1, judged 2026-10-10 (Opus + Fable prefer it in 5 of 6 pairs): dense regions never go wispy; 0 = shipped Nubis sampler
  microShadow: 1, detailBias: 0, // Q-1 billow self-shadowing defaults (Nubis neutral: 0, 0)
  ambientLaw: 0, // H3 diffuse ambient falloff
  bodySunFloor: 0.05, bodySunKnee: 0.4, bodyEnv: 1, bodyDepth: 0.1, envSunWeight: 4, ambientLowSun: 1, groundAlbedo: 0.2, phaseModel: 'hg', dropletDiameter: 10, // C1 low-sun lighting
  hazeDensity: 0.05, hazeHeight: 1000, hazeBase: 0, // C2 horizon haze
  fineErosion: 1,
  inlineLightScale: 1, inlineProfile: 0, lightMipBias: 0, // D1: in-line sun taps at the view extinction (the pre-D1 behaviour)
  diffuseSun: 0, diffuseFalloff: 0.11, ambientSaturation: 1, ambientWarmth: 0, // M1 material balance: neutral
  inScatterProfile: 0, ambientBelowMirror: 0, // D1 round 3: P x S as the lighting profile, the scene's own lower hemisphere
};

/**
 * D0 'deck' look: the Nubis Cubed (SIGGRAPH 2023) model with every term the deck states and nothing it does not (work/reports/D0.md):
 * raw NVDF detail type (s100/s109, typeFromScale 0), no erosion bias; inner glow relaxed only toward the sun (s123: glowFront 0, no glowBoost),
 * ambient sqrt(1 - P) * exp(-tauUp) with no floor and no ground term (s126/s128), the sky ambient only (no ground light), none of our
 * additions (edge darkening, deep octaves, billow micro-shadow, C1 low-sun handoff, C2 haze). The march step is the deck's on high/ultra
 * already (s150). Not in the deck, so fitted to Guerrilla's own frames of Parkouring and Stormbird (s78, s129, s181, s191; D0.md):
 * - densityScale 0.6: view-ray extinction (the s78 silhouette fits 0.3-0.6; 0.6 gives the frames' edge sharpness);
 * - lightDensityScale 0.1: the light grid's optical depth. The deck's light sums are of density *samples* (s123
 *   'inSunLightSummedDensitySamples', s128 'summed_ambient_density'), not density * metres * extinction; at 1 the shaded body goes
 *   blue-black where every deck frame is lit through. The two in-line taps keep the full extinction (surface relief, s113);
 * - ambientExtinction 0.2: the up sum's scale (s129's pair does not pin it: see the report);
 * - the phase lobes (s28: 'several HG', g about 0.2 [SY s51]; weights unpublished) and the ms / ambient gains are ours.
 */
export const CLOUD_DECK_SETTINGS: Readonly<CloudLookSettings> = {
  densityScale: 0.6, lightDensityScale: 0.1, msStrength: 1, ambientStrength: 1,
  silverStrength: 0.4, phaseG: 0.2, silverG: 0.85, ambientExtinction: 0.2,
  edgeDarkening: 0, glowBoost: 0, ambientSkyBias: 1, wispyBias: 0, glowFront: 0, deepScatter: 0, deepAttenuation: 0.35, ambientFloor: 0,
  noiseInvert: 0, detailTypeOverride: -1, typeFromScale: 0,
  microShadow: 0, detailBias: 0,
  ambientLaw: 1,
  bodySunFloor: 1, bodySunKnee: 0.4, bodyEnv: 0, bodyDepth: 0, envSunWeight: 0, ambientLowSun: 0, groundAlbedo: 0.2, phaseModel: 'hg', dropletDiameter: 10,
  hazeDensity: 0, hazeHeight: 1000, hazeBase: 0,
  fineErosion: 1,
  inlineLightScale: 1, inlineProfile: 0, lightMipBias: 0, // D0 kept the in-line taps at the full view extinction (D1 finds this is the pitting)
  diffuseSun: 0, diffuseFalloff: 0.11, ambientSaturation: 1, ambientWarmth: 0,
  inScatterProfile: 0, ambientBelowMirror: 0,
};

/**
 * D1 'decima' look (work/reports/D1.md, round 2): the art look with the deck's light units and Decima's colour, fitted to Guerrilla's own frames
 * of Parkouring and Stormbird (s78, s181, s191, the media33 turntable) under the sun, haze and exposure reconstructed per frame (refs.ts).
 * Round 1 built the look from the deck preset and reached the colour and the lobe contrast, but the blind judges found dirt: brown smudges and
 * sepia sparkle in the shadow mass. Round 2 starts from the art look (clean, judged closest in 7 of 8 verdicts) and adds only what helps:
 * - inlineLightScale 0.086 and lightDensityScale 0.13 with densityScale 0.7: the two in-line sun taps and the light grid in the same units, the
 *   deck's sums of density *samples* at the grid's 16 m spacing (s113/s114/s123; 0.086 x 0.7 = 0.06 and 0.13 x 0.7 = 0.09 per density-metre).
 *   The art look had the taps at the view extinction and the grid at 1.2 x 0.3 = 0.36: every 8-20 m erosion hole of the up-rezzed field cast a hard
 *   shadow (the pitting) and the sun-fed terms died within a lobe. In these units a lobe's own 30-60 m casts the soft shading the frames show.
 * - glowBoost 0, deepScatter 0, microShadow 0 (microDist 0), msStrength 1: the art's glow and deep octaves lit the body white and flat, and every
 *   sun-fed term sampled at jittered positions sparkles once the taps are soft (round 1's flecks came from msStrength 2.5 and diffuseSun fill
 *   dying under the dense cores). The body is lit by the ambient; the glow stays at the deck's weight with the art's depth relaxation (glowFront 1).
 * - ambientLaw 1 (the deck's exp(-summed density), s128) with the art's ambientFloor 0.15: the directional ambient gives the undersides and the lobe
 *   pockets; the floor bounds it so Parkouring's two S = 1 cores (H3) cannot print the dark columns round 1 had with floor 0. ambientExtinction 0.5.
 * - ambientStrength 0.7, ambientSaturation 0.4, diffuseSun 0.15 under a pink sun ((1, 0.95, 0.93) clear, (1, 0.92, 0.88) hazy; the frames' lit faces
 *   have G = B): the shade becomes Decima's mauve-grey (R = B > G: s206 ours 0.54/0.53/0.54 vs 0.53/0.51/0.53) where the art's was sky-blue
 *   (B/R 1.5) and round 1's, desaturated under a yellow sun, brown.
 * - temporalAccumulate 1 (applied by cloudLookSettings): at rate 1 the resolve averages the jitter over frames. Without it every ultra frame is one
 *   jittered sample set: the interleaved-gradient jitter prints a fingerprint-like whorl texture into every surface at 2-3x (the judges' 'fibre')
 *   and the surface changes frame to frame (flicker std 0.0029 -> 0.0018).
 * - The sky is per frame (refs.ts): turbidity 3 (s78), 6 (pack renders), 10 (s129), 20 with miePhaseG 0.5 (s181: a near-white hazy sky without
 *   the Mie halo), the suns re-fitted (s78 from in front and high, s181 from behind-right and high).
 * Round 3 (after blind judging round 2: clean but waxy, Parkouring's shadow too dark, undersides smudged):
 * - densityScale 2 with the light units held (lightDensityScale 0.045, inlineLightScale 0.03: still 0.09 / 0.06 per density-metre): the up-rezzed
 *   lumps are 12-24 m and at extinction 0.7 their e-folding length was 8-14 m, so they were semi-transparent at their own scale and washed out.
 *   At 2 the 4-32 px band-pass spectrum of the s78 tower at native 4k matches the frame (b4/b8/b16 0.0038/0.0070/0.0117 vs 0.0040/0.0076/0.0132);
 *   no sampling variable (noise mip 0, half step, HHF everywhere, accumulation off, far-pass scale) moved it. At 4 fibre returns on the hard surface.
 * - inScatterProfile 1: the deck's in-scatter probability and ambient occlusion read the dimensional profile P (s123, s126), not mProfile = P x S
 *   that the light grid is built from. With P x S the glow was 4x too weak wherever S is low (most of Parkouring) and the two S = 1 cores stood
 *   apart under the base (the smudges); with P Parkouring's shadow side lands on the frame (p10 0.575 vs 0.568, RGB .57/.57/.60 vs .56/.56/.60)
 *   while the thick, back-lit Stormbird keeps its dark mauve mass (its glow dies in the optical depth). msStrength 0.5 with it.
 * - ambientBelowMirror 1 with ambientSkyBias 0.7: the deck frames have no ground, their sky gradient continues below the horizon near white, so
 *   undersides are lit from below; the scene mirrors the sky below the horizon for the camera too (refs.ts mirrorBelowHorizon).
 * - Tested and rejected: a density cutoff for the skirt (cut-paper edges), noise mips 0.005-0.02 (soften the silhouette, do not touch the fibre),
 *   profile / mip-biased sun taps, an upward ambient occlusion tap (`ambientTap`, +15 percent at 4-8 px only; kept as a setting, off).
 * Round 4 (after blind judging round 3: first look preferred at both scales; new hard artefacts: glitter, flat lit sheets, contour / wood-grain
 * banding, a seam, a plateau):
 * - temporalBlend 0.1 (applied with the look): the contour / wood-grain and the fibre were the interleaved-gradient jitter's diagonal structure
 *   surviving the exponential resolve, whose newest frame always keeps `temporalBlend` of the pattern (30 percent at 0.3); at 4x the direct
 *   term's penumbra showed it at every step size, with the grid off and with smooth sun taps, and it is gone at 0.1 (band energy unchanged).
 * - The glow's depth relaxation reads the true SDF at the sample, not the stepping bound (speckle wherever the relaxation is steep).
 * - 16-bit data: the pack VDB stores the dimensional profile continuously (48k distinct values; the TGAs have 256) and the noise at full float
 *   (1.7-1.9 M distinct values); `nvdf16.bin` / `noise16.bin` (rgba16float, vdb_to_nvdf.py --nvdf16 and noise_vdb_to_16.py) replace the
 *   8-bit textures when present. Decima shipped these as BC6H / 2 B per texel. The density scale is 8-bit in the pack VDB itself (exact k/255).
 * - ambientSaturation 0.5 (from 0.4): the shaded flanks read brown under the pink sun with the stronger glow; 0.5 keeps them mauve
 *   (p213 shade B/R 1.09 vs the frame's 1.07, s33t3 1.03 vs 0.99).
 * - Remaining, post chain: the flat lit sheets at the sun-side silhouette and the blown tops are the lit thin lobes at the tonemapper's
 *   shoulder (lit RGB .92/.90/.89 where the frames keep .92/.85/.82); lowering exposure darkens the body below the frames' instead.
 * Kept from art: typeFromScale 1, the C1 low-sun handoff, the C2 haze, the phase lobes.
 * Kept from deck: everything it states and nothing it does not (no glow boost, no deep octaves, no edge darkening, no micro-shadow, exp ambient).
 * Recommended as the default look for Guerrilla-style NVDF clouds; the per-frame sky belongs to the scene.
 */
export const CLOUD_DECIMA_SETTINGS: Readonly<CloudLookSettings> = {
  densityScale: 2, lightDensityScale: 0.031, msStrength: 0.7, ambientStrength: 0.7,
  silverStrength: 0.4, phaseG: 0.2, silverG: 0.85, ambientExtinction: 0.5,
  edgeDarkening: 0, glowBoost: 0, ambientSkyBias: 0.7, wispyBias: 0, glowFront: 1, deepScatter: 0, deepAttenuation: 0.35, ambientFloor: 0.15,
  noiseInvert: 0, detailTypeOverride: -1, typeFromScale: 0,   // D1 round 7: the shipped sampler's type (the NVDF's); typeFromScale 1 printed wispy fibre whorls on the lit faces
  microShadow: 0, detailBias: 0,
  ambientLaw: 1,
  bodySunFloor: 0.05, bodySunKnee: 0.4, bodyEnv: 1, bodyDepth: 0.1, envSunWeight: 4, ambientLowSun: 1, groundAlbedo: 0.2, phaseModel: 'hg', dropletDiameter: 10,
  hazeDensity: 0.05, hazeHeight: 1000, hazeBase: 0,
  fineErosion: 1,
  inlineLightScale: 0.03, inlineProfile: 0, lightMipBias: 0,
  diffuseSun: 0.15, diffuseFalloff: 0.11, ambientSaturation: 0.5, ambientWarmth: 0,
  inScatterProfile: 0.5, ambientBelowMirror: 1,   // D1 round 9: P sqrt(S): the deck's P alone carved the thin Stormbird trunk (ring, slit, chip); P x S lost Parkouring's shadow value (round 3)
};

export type CloudLook = 'art' | 'deck' | 'decima';
/**
 * Settings for a look: assign the result to `runtime.settings` (Object.assign). 'deck' also turns the billow micro-shadow sample off
 * (microDist 0; not in the deck); 'art' restores the tier's. Switching looks resets nothing else (quality, wind, temporal knobs).
 */
export function cloudLookSettings(look: CloudLook, quality: CloudQuality): Partial<CloudSettings> {
  if (look === 'deck') return { ...CLOUD_DECK_SETTINGS, microDist: 0 };
  // D1 round 5: the step phase randomised at the cloud entry goes with the look (the blue-noise jitter mask is the runtime default; the tricubic
  // light grid read made no visible difference at 16 m cells and stays off).
  // D1 round 8: glowDepth 12 (the glow's profile read 12 m past the sample along the view ray: the profile's lobes no longer print discs on the shade side).
  // D1 round 9 (the floret investigation's T2): a 4 m sun tap at a quarter of the view extinction shades the florets (the deck's first in-line sample
  // 'preserves detail near the surfaces', s113); microShadow stays 0, so it joins the direct term's optical depth only.
  // D1 round 10: microShadowMode 1 at microShadow 2: the glow occluded by the florets' own relief toward the sun (the up-rez residual over the profile
  // along the 4 m tap), the floret-scale shading the glow lacked (H2; the s78 tower's lit-half 4-12 px energy 0.72 -> 1.01 of the frame's 1.46 at round 9's sky).
  // D1 round 11: a second tap 4-8 m at weight 1 (two floret scales; the s191 tower's lit-half 4-12 px band 0.59 -> 0.87 of the frame's 1.36, blobs 2.33 / 2.08).
  // D1 round 12: detailBias 0.1 (the up-rez noise's amplitude before the erosion): the hollows between the domes come from the erosion, not the
  // occlusion (the s191 tower's pits 0.65 -> 0.84 of the frame's 1.00, the dome share 0.68 -> 0.62 of the frame's 0.52).
  if (look === 'decima') return { ...CLOUD_DECIMA_SETTINGS, microDist: 4, microLightScale: 0.25, microShadow: 2, microShadowMode: 1, microDist2: 8, microShadow2: 1, detailBias: 0.1, temporalAccumulate: 1, temporalBlend: 0.1, stepJitter: 1, glowDepth: 12 };
  return { ...CLOUD_ART_SETTINGS, microDist: CLOUD_QUALITY_PRESETS[quality].microDist };
}

export function createCloudRuntime(device: GPUDevice, options: CloudRuntimeOptions = {}): CloudRuntime {
  const wantAuto = options.quality === 'auto';
  const autoPick = wantAuto ? selectTier(describeDevice(device as never, { adapter: options.adapter as never, pixels: options.expectedPixels ?? 1920 * 1080, mobile: options.mobile })) : null;
  let quality: CloudQuality = autoPick ? autoPick.tier : ((options.quality as CloudQuality | undefined) ?? 'high');
  const startPreset = CLOUD_QUALITY_PRESETS[quality];
  const dynamic = wantAuto ? new DynamicScale({ ...options.auto, budgetMs: options.auto?.budgetMs ?? options.budgetMs ?? 3 }) : null;
  const lightning = createLightning();
  const settings: CloudSettings = {
    lightning: lightning.settings,
    ...CLOUD_ART_SETTINGS,   // the look knobs (art defaults; CLOUD_DECK_SETTINGS / cloudLookSettings for the deck's)
    windOffset: [0, 0, 0], windVelocity: [3, 0, 1.5], animSpeed: 1,
    mipDistanceScale: 0.002, baseMip: 0, maxSteps: startPreset.maxSteps,
    transmittanceCutoff: startPreset.transmittanceCutoff, splitDistance: startPreset.splitDistance,
    temporalNear: startPreset.temporalNear, temporalFar: startPreset.temporalFar, temporalBlend: 0.3,
    renderScale: dynamic ? dynamic.scale : 1, detailDistance: startPreset.detailDistance, farLimit: startPreset.farLimit,
    shadowStrength: 0.6, compositeShadow: 1, // shadowed ground keeps sky ambient; 0.85+ reads near-black (orchestrator review)
    microDist: startPreset.microDist, stepScale: startPreset.stepScale, // Q-1 (Nubis neutral: microDist 0, stepScale 1)
    fineDistance: startPreset.fineDistance, lightDebug: 0,
    densityModel: 'nvdf', lightingModel: 'nubis',
    renderLevel: 'cinematic', levelScaleDesktop: 0.5, levelScaleLaptop: 0.25, upscalePath: 'temporal', upscaleSharpness: 0.5, upscaleDepth: 'cloud', upscaleExposure: 0, upscaleColorScale: 1 / 64, levelSubPixelSpan: 1, levelLodLayerPixel: -1,   // U2 (agent-chosen: sharpness 0.5); S2 (agent-chosen): levelSubPixelSpan 1, a one-pixel sub-pixel box at desktop/laptop (-1 = sky.subPixelSpan 2, the pre-S2 box)
    directDensity: 0.6,   // V2: matches the V1 Karma rig's density_mult
    diffuseSun: 0, diffuseFalloff: 0.11, ambientSaturation: 1, ambientWarmth: 0, directInScatterFlat: 0,   // M1 material balance: neutral; a direct volume gets DIRECT_VOLUME_SETTINGS
    inlineLightScale: 1, jitterStatic: 0, inlineProfile: 0, lightMipBias: 0,   // D1: in-line sun taps at the view extinction on the up-rezzed density; jitter animated everywhere
    temporalAccumulate: 0,   // D1 round 2: k = 1 passes write the history directly (no accumulation); the 'decima' look turns it on
    ambientTap: 0, ambientBelowMirror: 0, inScatterProfile: 0,   // D1 round 3: no upward ambient occlusion tap; the scene's own lower hemisphere; P x S as the lighting profile
    jitterNoise: 1, stepJitter: 0, lightGridFilter: 0, inlineReuse: 4, profileFilter: 0, historyDither: 0, glowDepth: 0, glowDepthMode: 0, microLightScale: 0, microShadowMode: 0, microDist2: 0, microShadow2: 0, directProfile: 0, directRimDepth: 0, noiseScale: 0.01, windCompensate: 0, historyFilter: 0,   // D1 round 5: blue-noise jitter for every look (IGN printed its lattice into every lit surface); fixed step phase, trilinear grid, taps reused within 4 m
    converged: 0, convergedStepScale: 4, convergedSamples: 16, convergedBands: 0, convergedSeed: 0, convergedKeep: 0,   // P0.5: the converged march, off
    lightProbe: 0, lightProbeMode: 0, sunAtCentre: 0, lightGridSource: 0, lightGridFull: 0,   // P1.1 debug: off
    sunShadowGridSource: 0, sunShadowGridFull: 0, sunShadowInlineReach: 48, sunShadowInlineSamples: 1, sunShadowInlineJitter: 0, directAlbedo: 1,   // P1.1b sunShadow block: before P1.1b
    fitAlbedo: 0.99, fitG: 0.8, fitMs: 3.0, fitK: 0.15, fitAmbient: 1.0,   // P1.2a 'fit' model constants (used only with lightingModel 'fit')
  };
  let materialStash: Partial<Record<MaterialKey, number>> | null = null;   // M1: the settings DIRECT_VOLUME_SETTINGS replaced
  let procModel: ProceduralDensityModel | null = null;
  let procWas: CloudSettings['densityModel'] = 'nvdf';

  const volumeLayout = createVolumeBindGroupLayout(device);
  const C = GPUShaderStage.COMPUTE;
  // The march writes either straight into a history pair (k = 1 and cut frames: colour rgba16float, packed distances r32uint) or into the compact trace (colour, mean distance r32float).
  const marchLayout = (direct: boolean) => device.createBindGroupLayout({ label: direct ? 'cloud march direct' : 'cloud march trace', entries: [
    { binding: 0, visibility: C, buffer: { type: 'uniform' } },
    { binding: 1, visibility: C, texture: { sampleType: 'depth' } },
    { binding: 2, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
    { binding: 3, visibility: C, storageTexture: { access: 'write-only', format: direct ? 'r32uint' : 'r32float' } },
    { binding: MARCH_LIGHT_GRID_BINDING, visibility: C, texture: { sampleType: 'float', viewDimension: '3d' } },
    { binding: MARCH_LIGHT_GRID_BINDING + 1, visibility: C, sampler: { type: 'filtering' } },
    { binding: MARCH_SKY_LIGHT_BINDING, visibility: C, buffer: { type: 'read-only-storage' } },
    { binding: MARCH_NEAR_BINDING, visibility: C, texture: { sampleType: 'unfilterable-float' } },
    { binding: MARCH_BLUE_NOISE_BINDING, visibility: C, texture: { sampleType: 'float' } },
  ] });
  const marchLayouts = [marchLayout(false), marchLayout(true)];   // [trace, direct]
  const resolveLayout = device.createBindGroupLayout({ label: 'cloud temporal resolve', entries: [
    { binding: 0, visibility: C, buffer: { type: 'uniform' } },
    { binding: 1, visibility: C, texture: { sampleType: 'depth' } },
    { binding: TEMPORAL_BINDINGS.trace, visibility: C, texture: { sampleType: 'unfilterable-float' } },
    { binding: TEMPORAL_BINDINGS.traceDepth, visibility: C, texture: { sampleType: 'unfilterable-float' } },
    { binding: TEMPORAL_BINDINGS.hist, visibility: C, texture: { sampleType: 'float' } },
    { binding: TEMPORAL_BINDINGS.histDepth, visibility: C, texture: { sampleType: 'uint' } },
    { binding: TEMPORAL_BINDINGS.out, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
    { binding: TEMPORAL_BINDINGS.outDepth, visibility: C, storageTexture: { access: 'write-only', format: 'r32uint' } },
    { binding: TEMPORAL_BINDINGS.params, visibility: C, buffer: { type: 'uniform' } },
    { binding: TEMPORAL_BINDINGS.sampler, visibility: C, sampler: { type: 'filtering' } },
  ] });
  const atmosphereLayout = options.atmosphereLayout ?? createAtmosphereBindGroupLayout(device);
  const cirrus = createCirrusLayer(device, atmosphereLayout);
  const midLayer = createCirrusLayer(device, atmosphereLayout, { shareNoise: cirrus, name: 'midLayer' });
  let cirrusKey: object | null = null;
  let midKey: object | null = null;
  const skyLightLayout = device.createBindGroupLayout({ label: 'cloud sky light', entries: [
    { binding: SKY_LIGHT_BINDING, visibility: C, buffer: { type: 'storage' } },
  ] });
  const shadowMap = createCloudShadowMap(device, volumeLayout, { resolution: SHADOW_MAP_RESOLUTION });
  const compositeLayout = device.createBindGroupLayout({ label: 'cloud composite', entries: [
    { binding: 0, visibility: C, buffer: { type: 'uniform' } },
    { binding: 1, visibility: C, texture: { sampleType: 'depth' } },
    { binding: 2, visibility: C, texture: { sampleType: 'float' } },
    { binding: 3, visibility: C, texture: { sampleType: 'uint' } },
    { binding: 4, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
    { binding: 5, visibility: C, texture: { sampleType: 'float' } },
    { binding: 6, visibility: C, texture: { sampleType: 'uint' } },
    ...createLightGridLayoutEntries(COMPOSITE_LIGHT_GRID_BINDING),
    { binding: COMPOSITE_SKY_BINDING, visibility: C, texture: { sampleType: 'unfilterable-float' } },
    { binding: COMPOSITE_SKY_BINDING + 1, visibility: C, texture: { sampleType: 'unfilterable-float' } },
    { binding: COMPOSITE_SKY_BINDING + 2, visibility: C, texture: { sampleType: 'unfilterable-float' } },
    { binding: COMPOSITE_SAMPLER_BINDING, visibility: C, sampler: { type: 'filtering' } },
    { binding: COMPOSITE_SAMPLER_BINDING + 1, visibility: C, sampler: { type: 'non-filtering' } },
    ...shadowMap.bindGroupLayoutEntries(COMPOSITE_SHADOW_BINDING, C),
    ...cirrus.compositeLayoutEntries(COMPOSITE_CIRRUS_BINDING, C),
    ...midLayer.compositeLayoutEntries(COMPOSITE_MID_BINDING, C),
  ] });
  const pipeline = (label: string, code: string, group1: GPUBindGroupLayout, group2?: GPUBindGroupLayout) => device.createComputePipeline({
    label,
    layout: device.createPipelineLayout({ bindGroupLayouts: group2 ? [volumeLayout, group1, group2] : [volumeLayout, group1] }),
    compute: { module: device.createShaderModule({ label, code }), entryPoint: 'main' },
  });
  // V2 `dd`: the direct-density variant (a volume with `direct`: its density marched as-is, DIRECT_DENSITY_WGSL); it never reads a fine overlay.
  const marchCode = (mode: 'atmosphere' | 'uniform', direct: boolean, fine: boolean, dd = false) => COMMON_WGSL + volumeWgsl(0) + DENSITY_WGSL + (dd ? DIRECT_DENSITY_WGSL : '') + marchWgsl(mode, direct, fine && !dd, dd);
  // Pipelines by [direct density][fine][uniform lighting][direct]; the plain atmosphere ones are built now, the fine ones (P13-H1, a volume with a fine overlay)
  // and the direct-density ones (V2) when such a volume is set, the uniform-lighting ones (no sky library) on first use.
  const marchPipelines: (GPUComputePipeline | undefined)[] = new Array(16).fill(undefined);
  const marchDesc = (uniform: boolean, direct: boolean, fine: boolean, dd = false): GPUComputePipelineDescriptor => {
    const label = `cloud march ${dd ? 'direct-density ' : fine ? 'fine ' : ''}${uniform ? 'uniform ' : ''}${direct ? 'direct' : 'trace'}`;
    return {
      label, layout: device.createPipelineLayout({ bindGroupLayouts: uniform ? [volumeLayout, marchLayouts[+direct]] : [volumeLayout, marchLayouts[+direct], atmosphereLayout] }),
      compute: { module: device.createShaderModule({ label, code: marchCode(uniform ? 'uniform' : 'atmosphere', direct, fine, dd) }), entryPoint: 'main' },
    };
  };
  const marchSlot = (uniform: boolean, direct: boolean, fine: boolean, dd = false) => (dd ? 12 : fine ? 4 : 0) + (uniform ? 2 : 0) + (direct ? 1 : 0);
  const getMarchPipeline = (uniform: boolean, direct: boolean, fine: boolean, dd = false) => marchPipelines[marchSlot(uniform, direct, fine, dd)] ??= device.createComputePipeline(marchDesc(uniform, direct, fine, dd));
  getMarchPipeline(false, true, false); getMarchPipeline(false, false, false);
  const skyLightPipeline = pipeline('cloud sky light', COMMON_WGSL + volumeWgsl(0) + SKY_LIGHT_WGSL, skyLightLayout, atmosphereLayout);
  const resolvePipeline = pipeline('cloud temporal resolve', COMMON_WGSL + volumeWgsl(0) + TEMPORAL_WGSL, resolveLayout);
  const compositePipeline = pipeline('cloud composite', COMMON_WGSL + volumeWgsl(0) + COMPOSITE_WGSL, compositeLayout);
  // ---- P0.5 converged march: the composite writes each sample into `cv.sample`, the accumulate pass sums it (rgba32float ping-pong) and writes the mean to the output ----
  const cvLayout = device.createBindGroupLayout({ label: 'cloud converged accumulate', entries: [
    { binding: 0, visibility: C, buffer: { type: 'uniform' } },
    { binding: 1, visibility: C, texture: { sampleType: 'unfilterable-float' } },
    { binding: 2, visibility: C, texture: { sampleType: 'unfilterable-float' } },
    { binding: 3, visibility: C, storageTexture: { access: 'write-only', format: 'rgba32float' } },
    { binding: 4, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
  ] });
  let cvPipeline: GPUComputePipeline | null = null;   // compiled on first use
  const cvParams = device.createBuffer({ label: 'cloud converged params', size: CONVERGED_PARAM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const cvParamU32 = new Uint32Array(CONVERGED_PARAM_BYTES / 4);
  let cvTargets: { sample: GPUTexture; sums: [GPUTexture, GPUTexture] } | null = null;
  const cvGroups: (GPUBindGroup | undefined)[] = [undefined, undefined];
  /** Samples in the sum, restarts, what restarted it last, the inputs it was started for, the frozen clock, the shadow map's write count, whether the targets are full size. */
  let cvCount = 0, cvRestarts = 0, cvReason = '', cvKey = '', cvTime: number | null = null, cvShadowWrites = -1, cvAllocated = false, cvPing = 0, cvBand = 0;
  /** P0.5: everything the converged image depends on that the CPU sees (the view, the sun, the settings, the procedural model's version). The wind offset stands still while it is on. */
  const convergedKey = (frame: CloudFrame) => [
    Array.from(frame.inverseViewProjection).join(), Array.from(frame.cameraPosition).join(), Array.from(frame.sunDirection).join(),
    frame.lighting ? JSON.stringify({ s: Array.from(frame.lighting.sunRadiance), t: Array.from(frame.lighting.ambientTop), b: Array.from(frame.lighting.ambientBottom) }) : 'atmosphere',
    JSON.stringify({ ...settings, windOffset: 0, renderScale: 0 }), JSON.stringify(skyLayer.settings), JSON.stringify(cirrus.settings), JSON.stringify(shadowMap.settings),
    procModel?.version ?? -1, outCW, outCH,
  ].join('|');

  const skyLayer = createSkyLayer(device, volumeLayout, atmosphereLayout);
  skyLayer.settings.resolutionScale = startPreset.skyScale;
  const skyBox = { minCorner: [0, 0, 0], extent: [1, 1, 1] };
  const samplers = createVolumeSamplers(device);
  const volumeUniforms = device.createBuffer({ label: 'cloud volume uniforms', size: VOLUME_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  // P13-H1: HeroParams of the bound volume's fine overlay (unused, and the placeholders bound, when it has none).
  const heroUniforms = device.createBuffer({ label: 'cloud hero params', size: HERO_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  let heroKey = '';
  // D1 round 8: the volume uniform carries the noise scale; rewritten when the setting changes.
  let volumePos: [number, number, number] = [0, 0, 0];
  let noiseScaleNow = 0.01;
  const windDelta: [number, number] = [0, 0];   // D1 round 8: the wind offset's change (x, z) this encode, for the resolve's compensation
  // One frame uniform per march pass (render size and pass mode differ); the composite reads the near one.
  const frameUniforms = [0, 1, 2].map(i => device.createBuffer({ label: `cloud frame uniforms ${['near', 'far', 'sky'][i]}`, size: FRAME_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
  const dummyNear = device.createTexture({ label: 'cloud dummy near', size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING });
  // D1 round 5: the blue-noise mask of the march jitter (jitterNoise).
  const blueNoise = device.createTexture({ label: 'cloud blue noise', size: [BLUE_NOISE_SIZE, BLUE_NOISE_SIZE], format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: blueNoise }, blueNoiseBytes(), { bytesPerRow: BLUE_NOISE_SIZE }, [BLUE_NOISE_SIZE, BLUE_NOISE_SIZE]);
  const resolveParams = [0, 1].map(i => device.createBuffer({ label: `cloud temporal params ${i}`, size: TEMPORAL_PARAM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
  const resolveSampler = device.createSampler({ label: 'cloud temporal history', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const compositeLinear = device.createSampler({ label: 'cloud composite linear', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const compositeNearest = device.createSampler({ label: 'cloud composite gather', magFilter: 'nearest', minFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const resolveF32 = new Float32Array(TEMPORAL_PARAM_BYTES / 4);
  const frameF32: Float32Array<ArrayBuffer> = new Float32Array(new ArrayBuffer(FRAME_UNIFORM_BYTES));
  const frameU32 = new Uint32Array(frameF32.buffer);

  const skyLightBuffer = device.createBuffer({ label: 'cloud sky light', size: SKY_LIGHT_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const skyLightGroup = device.createBindGroup({ label: 'cloud sky light', layout: skyLightLayout, entries: [{ binding: SKY_LIGHT_BINDING, resource: { buffer: skyLightBuffer } }] });
  // ---- reflection dome (P2-04) ----
  const domeSize = Math.max(4, (options.domeSize ?? startPreset.domeSize) & ~3);
  const domeSettings = defaultDomeSettings();
  domeSettings.maxSteps = startPreset.domeMaxSteps; domeSettings.enabled = startPreset.domeEnabled;
  const domeLayoutEntries: GPUBindGroupLayoutEntry[] = [
    { binding: DOME_FRAME_BINDING, visibility: C, buffer: { type: 'uniform' } },
    { binding: DOME_DEPTH_BINDING, visibility: C, texture: { sampleType: 'depth' } },
    { binding: DOME_OUT_BINDING, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
    { binding: DOME_PARAMS_BINDING, visibility: C, buffer: { type: 'uniform' } },
    ...createLightGridLayoutEntries(DOME_LIGHT_GRID_BINDING),
    { binding: DOME_SKY_LIGHT_BINDING, visibility: C, buffer: { type: 'read-only-storage' } },
    { binding: DOME_SKY_WEATHER_BINDING, visibility: C, texture: { sampleType: 'float' } },
    { binding: DOME_SKY_SAMPLER_BINDING, visibility: C, sampler: { type: 'filtering' } },
    { binding: DOME_SKY_PARAMS_BINDING, visibility: C, buffer: { type: 'uniform' } },
  ];
  const domeLayout = device.createBindGroupLayout({ label: 'cloud dome', entries: domeLayoutEntries });
  const domePipeline = pipeline('cloud dome', COMMON_WGSL + volumeWgsl(0) + DOME_WGSL, domeLayout);
  // X3: dome pipelines that march a procedural model's clouds outside the box (one per shaper, compiled asynchronously on first use).
  const domeProc = new Map<string, { layout: GPUBindGroupLayout; pipeline: GPUComputePipeline | null }>();
  const domeProcPipeline = (m: ProceduralDensityModel) => {
    let e = domeProc.get(m.wgslKey);
    if (!e) {
      const layout = device.createBindGroupLayout({ label: 'cloud dome (procedural)', entries: [...domeLayoutEntries, ...m.layoutEntries(DOME_PROCEDURAL_BINDING, C)] });
      const entry: { layout: GPUBindGroupLayout; pipeline: GPUComputePipeline | null } = { layout, pipeline: null };
      e = entry;
      domeProc.set(m.wgslKey, entry);
      void device.createComputePipelineAsync({
        label: `cloud dome (procedural ${m.wgslKey})`, layout: device.createPipelineLayout({ bindGroupLayouts: [volumeLayout, layout] }),
        compute: { module: device.createShaderModule({ label: 'cloud dome (procedural)', code: COMMON_WGSL + volumeWgsl(0) + domeWgsl(m.densityWgsl(1, DOME_PROCEDURAL_BINDING)) }), entryPoint: 'main' },
      }).then(p => { entry.pipeline = p; }, err => console.error('cloud dome procedural pipeline failed', err));
    }
    return e;
  };
  let domeProcKey: object | null = null;
  const domeTexture = device.createTexture({ label: 'cloud reflection dome', size: [domeSize, domeSize], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });
  const domeView = domeTexture.createView();
  {
    // Until a texel is first shaded it reads as clear sky: no radiance, transmittance 1 (half-float 1.0 = 0x3C00).
    const init = new Uint16Array(domeSize * domeSize * 4);
    for (let i = 3; i < init.length; i += 4) init[i] = 0x3c00;
    device.queue.writeTexture({ texture: domeTexture }, init, { bytesPerRow: domeSize * 8 }, [domeSize, domeSize]);
  }
  const domeFrameBuffer = device.createBuffer({ label: 'cloud dome frame', size: FRAME_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const domeParamBuffer = device.createBuffer({ label: 'cloud dome params', size: DOME_PARAM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  // Stand-ins for the sky layer's weather window and params while the layer is off (the dome shader then skips the sky field: DomeParams.skyOn = 0).
  const domeSkyDummy = device.createTexture({ label: 'cloud dome dummy weather', size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
  const domeSkyDummyParams = device.createBuffer({ label: 'cloud dome dummy sky params', size: SKY_PARAM_BYTES, usage: GPUBufferUsage.UNIFORM });
  const domeSkySampler = device.createSampler({ label: 'cloud dome sky', magFilter: 'linear', minFilter: 'linear' });
  let domeSkyKey: GPUTexture | null = null;
  const domeDepth = device.createTexture({ label: 'cloud dome dummy depth', size: [1, 1], format: 'depth32float', usage: GPUTextureUsage.TEXTURE_BINDING });
  const domeParamData = new ArrayBuffer(DOME_PARAM_BYTES);
  const domeParamF32 = new Float32Array(domeParamData), domeParamU32 = new Uint32Array(domeParamData);
  const domeRef: [number, number, number] = [0, 0, 0];
  let domeGroups: GPUBindGroup[] | null = null;
  let domeSlot = 0, domeRefreshFrames = DOME_REFRESH_FRAMES, domeBoost = 0;
  const domeSun = [0, 1, 0];
  let domeScaleSeen = -1;
  const dome: CloudDome = {
    texture: domeTexture, view: domeView, size: domeSize, settings: domeSettings,
    get referencePoint() { return domeRef; },
    get refreshFrames() { return domeRefreshFrames; },
  };
  let lightGrid: LightGrid | null = null;
  let gridSwaps = 0, gridRestarts = 0;   // P1.1b: completed grid builds and builds thrown away (lightGridInfo)
  const lightingData = new Float32Array(SKY_LIGHT_ENTRIES * 4);
  let mieDiameter = NaN;
  let lowSun = 0;   // 1 - saturate(sin(sun elevation) / bodySunKnee), this frame   // the diameter f[88..91] were last written for
  let disposed = false;
  let volume: GpuCloudVolume | null = null;
  let ownsVolume = false;
  let noise: GPUTexture | null = null;
  let volumeGroup: GPUBindGroup | null = null;
  let outW = 0, outH = 0;   // the scene (depth) size
  let outCW = 0, outCH = 0;   // the composite output's size: the scene's times the tier's outputScale
  let nearW = 0, nearH = 0, farW = 0, farH = 0;
  let output: GPUTexture | null = null, ownsOutput = false;
  // [near, far]. hist[cur] is what the composite reads: the march writes it directly at k = 1 and on cuts, the resolve writes it at k > 1 from
  // the trace (the fresh samples) and hist[1 - cur] (last frame's result).
  let targets: PassTarget[] | null = null;
  let cur = 0;   // index of the history texture written this frame (flips every encode)
  // ---- P5-B temporal state ----
  const prevViewProj = new Float32Array(16);
  const prevCam = [0, 0, 0], prevFwd = [0, 0, 1], prevSun = [0, 1, 0];
  const prevModel = new Float32Array(FRAME_UNIFORM_BYTES / 4);
  const lastRate = [0, 0];
  let lastAccumulate = false;
  let prevValid = false, needReset = true, temporalFrames = 0, temporalResets = 0;
  const passFull = [true, true];
  let skyTarget: { w: number; h: number; color: GPUTexture; depth: GPUTexture; back: GPUTexture; scale: number } | null = null;
  /** U2: the sky layer's size relative to the output: its own resolutionScale at the cinematic level, the level's scale otherwise. */
  const skyScale = () => {
    if (settings.converged > 0.5) return 1;   // P0.5: the converged march traces the layer at the output's resolution
    const l = settings.renderLevel;
    const s = l === 'desktop' ? settings.levelScaleDesktop : l === 'laptop' ? settings.levelScaleLaptop : skyLayer.settings.resolutionScale;
    return Math.min(1.5, Math.max(0.0625, s));
  };
  /** U2: the upscaler (created the first time a level below cinematic is used) and the key of the composite groups' sky bindings. */
  let skyUpscale: SkyUpscale | null = null;
  let compositeSkyKey: GPUTexture | null = null;
  let upscaleLastTime = -1, upscaleWarm = 0, upColorScale = 1;
  // Bind groups are cached by (pass, light-grid slot, history parity, direct) and created on first use after any rebuild.
  const marchGroups: (GPUBindGroup | undefined)[] = new Array(16).fill(undefined);
  const resolveGroups: (GPUBindGroup | undefined)[] = new Array(4).fill(undefined);
  const compositeGroups: (GPUBindGroup | undefined)[] = new Array(8).fill(undefined);   // [converged][grid front][history parity]
  const forgetGroups = () => { marchGroups.fill(undefined); resolveGroups.fill(undefined); compositeGroups.fill(undefined); cvGroups.fill(undefined); boundDepth = null; };
  let boundDepth: GPUTextureView | null = null;
  let lastTime = -1, flashPrev = false, flashLevelNow = 0;
  let autoFrames = 0;

  let lightGridFullNow = false;
  const makeLightGrid = () => {
    const v = volume!;
    const div = CLOUD_QUALITY_PRESETS[quality].lightGridDivisor;
    // The grid is sized from the volume dims it is given (ceil(d / 2), at least 16 per axis); a divisor shrinks them. Its shaders read the texture size, not the dims.
    let dims = div > 1 ? v.dims.map(d => Math.max(1, Math.round(d / div))) as [number, number, number] : v.dims;
    lightGridFullNow = settings.lightGridFull > 0.5 || settings.sunShadowGridFull > 0.5;   // P1.1 diagnostic / P1.1b sunShadowGridFull
    if (lightGridFullNow) dims = v.dims.map(d => d * 2) as [number, number, number];   // P1.1 diagnostic: lightGridDims halves them back to the volume's
    return createLightGrid(device, volumeLayout, { dims, voxelSize: v.voxelSize, extentMeters: v.extentMeters });
  };
  const rebuildVolumeGroup = () => {
    const fine = volume?.fine;
    volumeGroup = volume && noise
      ? createVolumeBindGroup(device, volumeLayout, { uniforms: volumeUniforms, nvdf: volume.nvdf, sdf: volume.sdf, noise, ...samplers, hero: fine && { indir: fine.indir, pool: fine.pool, uniforms: heroUniforms }, direct: volume.direct?.density })
      : null;
    heroKey = '';
  };
  /** Extinction (1/m) at stored density 1: CloudSettings.densityScale, or for a direct volume (V2) directDensity * densityRef (the texture holds density / densityRef). */
  const extinction = () => (volume?.direct ? settings.directDensity * volume.direct.densityRef : settings.densityScale);
  const releaseTrace = (t: PassTarget) => { t.trace?.color.destroy(); t.trace?.depth.destroy(); t.trace = null; };
  const releaseTargets = () => {
    for (const t of targets ?? []) { t.hist.forEach(h => { h.color.destroy(); h.depth.destroy(); }); releaseTrace(t); }
    skyTarget?.color.destroy(); skyTarget?.depth.destroy(); skyTarget?.back.destroy(); skyTarget = null;
    cvTargets?.sample.destroy(); cvTargets?.sums.forEach(t => t.destroy()); cvTargets = null;
    if (ownsOutput) output?.destroy();
    targets = null; output = null; forgetGroups();
  };
  const allocate = (externalOutput?: GPUTexture) => {
    releaseTargets();
    if (!outW) return;
    const preset = CLOUD_QUALITY_PRESETS[quality];
    outCW = Math.max(1, Math.round(outW * preset.outputScale)); outCH = Math.max(1, Math.round(outH * preset.outputScale));
    const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;   // COPY_DST: the sky layer resolves into its targets by copy
    const make = (name: string, scale: number) => {
      const w = Math.max(1, Math.round(outW * scale)), h = Math.max(1, Math.round(outH * scale));
      return { w, h, color: device.createTexture({ label: `cloud ${name} colour`, size: [w, h], format: 'rgba16float', usage }), depth: device.createTexture({ label: `cloud ${name} depth`, size: [w, h], format: 'rgba32float', usage }) };
    };
    // The march passes keep a resolved history pair (colour rgba16f, packed distances r32uint: x mean cloud distance, y march end, z scene distance).
    const hUsage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
    const makePass = (name: string, scale: number): PassTarget => {
      const w = Math.max(2, Math.round(outW * scale)), h = Math.max(2, Math.round(outH * scale));
      const pair = (i: number) => ({ color: device.createTexture({ label: `cloud ${name} colour ${i}`, size: [w, h], format: 'rgba16float', usage: hUsage }), depth: device.createTexture({ label: `cloud ${name} depth ${i}`, size: [w, h], format: 'r32uint', usage: hUsage }) });
      return { name, w, h, rw: w, rh: h, prw: w, prh: h, hist: [pair(0), pair(1)], trace: null };
    };
    const passScale = Math.max(0.25, options.passScale ?? 1);
    // P0.5: the converged march renders both passes at the output's resolution (a tier without a near pass keeps it off).
    cvAllocated = settings.converged > 0.5;
    const near = makePass('near', cvAllocated && preset.nearScale > 0 ? 1 : Math.min(1, preset.nearScale * passScale)), far = makePass('far', cvAllocated ? 1 : Math.min(1, preset.farScale * passScale));
    nearW = near.w; nearH = near.h; farW = far.w; farH = far.h;
    targets = [near, far];
    needReset = true;
    const sky = make('sky', skyScale());
    skyTarget = { w: sky.w, h: sky.h, color: sky.color, depth: sky.depth, back: device.createTexture({ label: 'cloud sky back', size: [sky.w, sky.h], format: 'rgba16float', usage }), scale: skyScale() };
    ownsOutput = !externalOutput;
    output = externalOutput ?? device.createTexture({ label: 'cloud composite', size: [outCW, outCH], format: 'rgba16float', usage });
    if (cvAllocated) {
      const sum = (i: number) => device.createTexture({ label: `cloud converged sum ${i}`, size: [outCW, outCH], format: 'rgba32float', usage: hUsage });
      cvTargets = { sample: device.createTexture({ label: 'cloud converged sample', size: [outCW, outCH], format: 'rgba16float', usage: hUsage }), sums: [sum(0), sum(1)] };
    }
  };
  /** The trace target (this frame's fresh samples, compact) exists only while the pass runs at k > 1, sized for the rate. Recreated when the rate changes; the bind groups are rebuilt. */
  const ensureTrace = (pass: number, k: number, accumulate: boolean) => {
    const t = targets![pass];
    // D1 round 2: at k = 1 with temporalAccumulate the trace is full size (every pixel is fresh every frame).
    const w = k === 4 || k === 2 ? Math.ceil(t.w / 2) : accumulate ? t.w : 0, h = k === 4 ? Math.ceil(t.h / 2) : k === 2 || accumulate ? t.h : 0;
    if (t.trace && t.trace.w === w && t.trace.h === h) return;
    if (t.trace) releaseTrace(t);
    if (w) {
      const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
      t.trace = { w, h, color: device.createTexture({ label: `cloud ${t.name} trace colour`, size: [w, h], format: 'rgba16float', usage }), depth: device.createTexture({ label: `cloud ${t.name} trace depth`, size: [w, h], format: 'r32float', usage }) };
    }
    forgetGroups();
  };
  const snapRate = (v: number): TemporalRate => (v >= 3 ? 4 : v >= 1.5 ? 2 : 1);
  let externalOutput: GPUTexture | undefined;
  const bytesOf = (w: number, h: number, bpp: number) => w * h * bpp;
  const memory = (): CloudMemory => {
    let history = 0, trace = 0;
    for (const t of targets ?? []) { history += 2 * bytesOf(t.w, t.h, HIST_TEXEL_BYTES); if (t.trace) trace += bytesOf(t.trace.w, t.trace.h, TRACE_TEXEL_BYTES); }
    const sky = skyTarget ? bytesOf(skyTarget.w, skyTarget.h, 8 + 8 + 8) : 0;
    const out = output && ownsOutput ? bytesOf(outCW, outCH, 8) : 0;
    const dm = bytesOf(domeSize, domeSize, 8);
    const g = lightGrid ? 3 * bytesOf(lightGrid.dims[0] * lightGrid.dims[1], lightGrid.dims[2], 8) : 0;
    const sh = shadowMap.info.bytes;
    return { history, trace, sky, output: out, dome: dm, lightGrid: g, shadow: sh, total: history + trace + sky + out + dm + g + sh };
  };
  /** Apply a tier's levers to the live settings (the ones that are not allocation-bound). */
  const applyPreset = (p: CloudQualityPreset) => {
    settings.maxSteps = p.maxSteps; settings.transmittanceCutoff = p.transmittanceCutoff; settings.splitDistance = p.splitDistance;
    settings.temporalNear = p.temporalNear; settings.temporalFar = p.temporalFar;
    settings.stepScale = p.stepScale; settings.microDist = p.microDist; settings.detailDistance = p.detailDistance; settings.farLimit = p.farLimit;
    settings.fineDistance = p.fineDistance;
    domeSettings.maxSteps = p.domeMaxSteps; domeSettings.enabled = p.domeEnabled;
    skyLayer.settings.resolutionScale = p.skyScale;
  };

  return {
    settings,
    dome,
    get output() { return output; },
    get renderSize(): [number, number] { return [targets ? targets[1].rw : farW, targets ? targets[1].rh : farH]; },
    get nearRenderSize(): [number, number] { return [targets ? targets[0].rw : nearW, targets ? targets[0].rh : nearH]; },
    get skyLayer() { return skyLayer; },
    get upscale() { return skyUpscale ? { ready: skyUpscale.ready, renderSize: [skyUpscale.core.renderWidth, skyUpscale.core.renderHeight] as [number, number], displaySize: [skyUpscale.core.displayWidth, skyUpscale.core.displayHeight] as [number, number], settings: skyUpscale.core.settings } : null; },
    cirrus,
    midLayer,
    shadowMap,
    get ready() { return !disposed && !!volumeGroup && !!output && !!targets && !!lightGrid; },
    get extent() { return volume ? volume.extentMeters : null; },
    get quality() { return quality; },
    get outputScale() { return CLOUD_QUALITY_PRESETS[quality].outputScale; },
    get outputSize(): [number, number] { return [outCW, outCH]; },
    get auto(): AutoQualityInfo | null {
      if (!dynamic) return null;
      return { tier: quality, reasons: autoPick?.reasons ?? [], scale: dynamic.scale, costMs: dynamic.costMs, budgetMs: dynamic.options.budgetMs, measured: dynamic.costMs > 0, changes: dynamic.changes };
    },
    get memory() { return memory(); },
    setBudget(ms) { dynamic?.setBudget(ms); },
    async setVolume(asset, opts) {
      if (disposed) return;
      if ('extentMeters' in asset && asset.fine) {
        // A fine hero overlay: compile the fine march variants off the frame path first (P13-H1).
        await Promise.all([true, false].map(async direct => {
          marchPipelines[marchSlot(false, direct, true)] ??= await device.createComputePipelineAsync(marchDesc(false, direct, true));
        }));
        if (disposed) return;
      }
      if (asset.direct) {
        // V2: a direct volume: compile its march variants off the frame path.
        await Promise.all([true, false].map(async direct => {
          marchPipelines[marchSlot(false, direct, false, true)] ??= await device.createComputePipelineAsync(marchDesc(false, direct, false, true));
        }));
        if (disposed) return;
      }
      if (opts.material !== 'keep') {
        // M1: a direct volume gets the Karma-fitted material balance; the caller's values come back with the next non-direct volume.
        if (asset.direct && !materialStash) {
          materialStash = {};
          for (const k of Object.keys(DIRECT_VOLUME_SETTINGS) as MaterialKey[]) materialStash[k] = settings[k];
          Object.assign(settings, DIRECT_VOLUME_SETTINGS);
        } else if (!asset.direct && materialStash) {
          Object.assign(settings, materialStash);
          materialStash = null;
        }
      }
      if (ownsVolume) volume?.destroy();
      lightGrid?.destroy();
      const external = 'extentMeters' in asset;   // a GpuCloudVolume: caller-owned
      volume = external ? asset : uploadCloudVolume(device, asset);
      ownsVolume = !external;
      lightGrid = makeLightGrid();
      forgetGroups(); domeGroups = null; needReset = true;
      volumePos = [opts.position[0], opts.position[1], opts.position[2]]; noiseScaleNow = settings.noiseScale;
      device.queue.writeBuffer(volumeUniforms, 0, new Float32Array(volumeUniformData(opts.position, volume.extentMeters, volume.voxelSize, settings.noiseScale)));
      for (let i = 0; i < 3; i++) { skyBox.minCorner[i] = opts.position[i]; skyBox.extent[i] = volume.extentMeters[i]; }
      rebuildVolumeGroup();
    },
    swapVolume(next, opts) {
      const cur = volume;
      if (disposed || !cur || ownsVolume || !lightGrid || !('extentMeters' in next) || next.voxelSize !== cur.voxelSize
        || next.dims.some((d, i) => d !== cur.dims[i]) || next.extentMeters.some((e, i) => e !== cur.extentMeters[i])) return false;
      volume = next;
      rebuildVolumeGroup();
      lightGrid.invalidate();
      volumePos = [opts.position[0], opts.position[1], opts.position[2]]; noiseScaleNow = settings.noiseScale;
      device.queue.writeBuffer(volumeUniforms, 0, new Float32Array(volumeUniformData(opts.position, next.extentMeters, next.voxelSize, settings.noiseScale)));
      for (let i = 0; i < 3; i++) skyBox.minCorner[i] = opts.position[i];
      return true;
    },
    setVolumePosition(position) {
      if (disposed || !volume) return;
      volumePos = [position[0], position[1], position[2]]; noiseScaleNow = settings.noiseScale;
      device.queue.writeBuffer(volumeUniforms, 0, new Float32Array(volumeUniformData(position, volume.extentMeters, volume.voxelSize, settings.noiseScale)));
      for (let i = 0; i < 3; i++) skyBox.minCorner[i] = position[i];
    },
    async setNoise(asset) {
      noise?.destroy();
      noise = uploadCloudNoise(device, asset);
      needReset = true;
      rebuildVolumeGroup();
    },
    flash(options) { lightning.flash(options); },
    setProceduralModel(model) { procModel = model; needReset = true; },
    get proceduralModel() { return procModel; },
    get flashLevel() { return flashLevelNow; },
    // FX1: the sky layer's history too. A lighting setting (ambientSaturation, diffuseSun, ...) is not in the layer's model params, so the layer
    // could not see the change and dissolved to it over ~100 frames (blend 0.3 per 16-frame cycle): a live switch looked like it did nothing.
    resetTemporal() { needReset = true; skyLayer.reset(); },
    get convergedInfo() {
      const target = Math.max(1, Math.round(settings.convergedSamples));
      return { active: settings.converged > 0.5, samples: cvCount, target, done: settings.converged > 0.5 && cvCount >= target, restarts: cvRestarts, reason: cvReason, band: cvBand };
    },
    get lightGridInfo() {
      if (!volume) return null;
      const d = lightGrid ? lightGrid.dims : [0, 0, 0];
      return { dims: [d[0], d[1], d[2]] as [number, number, number], bytes: d[0] * d[1] * d[2] * 8 * 3, volumeDims: [volume.dims[0], volume.dims[1], volume.dims[2]] as [number, number, number], building: !!lightGrid?.scheduler.building, progress: lightGrid?.scheduler.progress ?? 0, passes: lightGrid?.scheduler.passes ?? 0, swaps: gridSwaps, restarts: gridRestarts };
    },
    get temporalInfo() {
      const m = memory();
      return { near: snapRate(settings.temporalNear), far: snapRate(settings.temporalFar), resets: temporalResets, frames: temporalFrames, bytes: m.history + m.trace };
    },
    setQuality(q) {
      if (q === quality) return;
      const gridChanged = CLOUD_QUALITY_PRESETS[q].lightGridDivisor !== CLOUD_QUALITY_PRESETS[quality].lightGridDivisor;
      quality = q;
      applyPreset(CLOUD_QUALITY_PRESETS[q]);
      if (gridChanged && volume) { lightGrid?.destroy(); lightGrid = makeLightGrid(); domeGroups = null; }
      if (outW && externalOutput && Math.max(1, Math.round(outW * CLOUD_QUALITY_PRESETS[q].outputScale)) !== externalOutput.width) {
        // The caller's output texture has the old tier's size: drop it. `ready` is false until the caller resizes with a texture of `outputSize`.
        releaseTargets(); outW = 0; outH = 0; outCW = 0; outCH = 0; externalOutput = undefined;
      } else if (outW) allocate(externalOutput);
    },
    resize(width, height, out) {
      if (width === outW && height === outH && out === externalOutput && output) return;
      outW = width; outH = height; externalOutput = out;
      allocate(out);
    },
    encode(encoder, frame, timer) {
      if (disposed || !volumeGroup || !output || !targets || !lightGrid) return;
      // P1.1 diagnostic: the grid at full resolution (lightGridFull) is a different texture size: rebuild it and drop the groups that bind it.
      if ((settings.lightGridFull > 0.5 || settings.sunShadowGridFull > 0.5) !== lightGridFullNow && volume) { lightGrid.destroy(); lightGrid = makeLightGrid(); domeGroups = null; forgetGroups(); }
      const uniformLighting = frame.lighting?.kind === 'uniform' ? frame.lighting : null;
      if (!uniformLighting && !frame.atmosphere) return;
      // P0.5 converged march: full-size targets while it is on (re-allocated when it is switched); the clock and the wind stand still; the sum
      // restarts when anything it depends on changes, and once it holds `convergedSamples` the output keeps the mean and nothing is traced.
      const cv = settings.converged > 0.5;
      if (cv !== cvAllocated) allocate(externalOutput);
      if (!targets || !output) return;
      const cvStep = Math.max(1, settings.convergedStepScale);
      const cvTarget = Math.max(1, Math.round(settings.convergedSamples));
      if (cv) {
        cvTime ??= frame.time;
        // A finished sum: refresh the procedural model's version (the trace that would call `update` does not run), then compare.
        if (cvCount >= cvTarget && procModel?.ready && settings.densityModel !== 'nvdf') procModel.update(cvTime, { camera: frame.cameraPosition, wind: settings.windOffset });
        const key = convergedKey(frame);
        if (key !== cvKey || needReset) { cvKey = key; cvCount = 0; cvBand = 0; cvRestarts++; cvReason = 'view'; }
        if (cvCount >= cvTarget) return;
      } else { cvTime = null; cvKey = ''; cvCount = 0; cvBand = 0; }
      const cvBands = cv ? Math.max(1, Math.round(settings.convergedBands > 0 ? settings.convergedBands : cvStep)) : 1;
      if (cvBand >= cvBands) cvBand = 0;
      const frameTime = cv ? cvTime! : frame.time;
      const level: CloudRenderLevel = cv ? 'cinematic' : settings.renderLevel;   // P0.5: no upscaler
      // 'auto': the controlled passes' GPU time (this frame's readback lags the encode by 2-3 frames) moves the render scale.
      if (dynamic && timer?.enabled && !cv) {
        autoFrames++;
        if (autoFrames > 20) settings.renderScale = dynamic.update(controlledCost(timer.last()));
      }
      if (skyTarget && skyTarget.scale !== skyScale()) {
        // Only the sky targets change; the composite groups reference them.
        skyTarget.color.destroy(); skyTarget.depth.destroy(); skyTarget.back.destroy();
        const sc = skyScale();
        const w = Math.max(1, Math.round(outW * sc)), h = Math.max(1, Math.round(outH * sc));
        const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;
        skyTarget = { w, h, scale: sc, color: device.createTexture({ label: 'cloud sky colour', size: [w, h], format: 'rgba16float', usage }), depth: device.createTexture({ label: 'cloud sky depth', size: [w, h], format: 'rgba32float', usage }), back: device.createTexture({ label: 'cloud sky back', size: [w, h], format: 'rgba16float', usage }) };
        compositeGroups.fill(undefined);
      }
      if (frame.depth !== boundDepth) { forgetGroups(); boundDepth = frame.depth; }
      const fine = volume?.fine;
      if (fine) {
        // The overlay's params; a change of distance or erosion is a model change (history cut).
        const key = `${settings.fineDistance},${settings.fineErosion}`;
        if (key !== heroKey) {
          if (heroKey) needReset = true;
          heroKey = key;
          device.queue.writeBuffer(heroUniforms, 0, heroUniformData(fine.cells, fine.fineVoxel, fine.poolSize, Math.max(0, settings.fineDistance), settings.fineErosion));
        }
      }
      const grid = lightGrid;
      const [near, far] = targets;
      const dt = lastTime < 0 || cv ? 0 : Math.min(0.1, Math.max(0, frame.time - lastTime));
      lastTime = frame.time;
      // Wind integrates velocity * animSpeed, so changing animSpeed changes the rate and never teleports the noise.
      windDelta[0] = settings.windVelocity[0] * settings.animSpeed * dt; windDelta[1] = settings.windVelocity[2] * settings.animSpeed * dt;
      for (let i = 0; i < 3; i++) settings.windOffset[i] += settings.windVelocity[i] * settings.animSpeed * dt;

      // Dynamic resolution: the passes render into the top-left rectangle of their (tier-sized) textures.
      const scale = cv ? 1 : Math.min(1, Math.max(0.25, settings.renderScale));
      for (const t of targets) { t.prw = t.rw; t.prh = t.rh; t.rw = Math.max(2, Math.min(t.w, Math.round(t.w * scale))); t.rh = Math.max(2, Math.min(t.h, Math.round(t.h * scale))); }

      const f = frameF32;
      f.set(frame.inverseViewProjection, 0);
      f[16] = frame.cameraPosition[0]; f[17] = frame.cameraPosition[1]; f[18] = frame.cameraPosition[2]; f[19] = frame.time;
      f[20] = frame.sunDirection[0]; f[21] = frame.sunDirection[1]; f[22] = frame.sunDirection[2]; f[23] = extinction();
      f[24] = settings.windOffset[0]; f[25] = settings.windOffset[1]; f[26] = settings.windOffset[2]; f[27] = settings.mipDistanceScale;
      f[30] = outW; f[31] = outH;
      f[32] = settings.baseMip; frameU32[33] = settings.maxSteps >>> 0; frameU32[34] = frame.frameIndex >>> 0; f[35] = settings.lightDensityScale;
      f[36] = settings.msStrength; f[37] = settings.ambientStrength; f[38] = settings.silverStrength; f[39] = settings.ambientExtinction;
      f[40] = settings.phaseG; f[41] = settings.silverG; f[42] = settings.shadowStrength * (settings.compositeShadow > 0.5 ? 1 : 0); f[43] = settings.deepScatter;
      // A tier without a near pass (nearScale 0) marches the whole ray in the far pass: split 0 turns the near march, its resolve, the far pass's occlusion test and the composite's near upsample off.
      const nearActive = CLOUD_QUALITY_PRESETS[quality].nearScale > 0 && settings.splitDistance > 0;
      f[44] = nearActive ? settings.splitDistance : 0; f[45] = settings.transmittanceCutoff; f[47] = settings.lightDebug;
      f[48] = settings.edgeDarkening; f[49] = settings.glowBoost; f[50] = settings.ambientSkyBias; f[51] = settings.wispyBias;
      f[52] = settings.glowFront; f[54] = settings.deepAttenuation; f[55] = settings.ambientFloor;
      f[56] = settings.microDist; f[57] = settings.microShadow; f[58] = settings.detailBias; f[59] = settings.stepScale;
      f[64] = near.rw; f[65] = near.rh; f[66] = far.rw; f[67] = far.rh;
      f[68] = near.w; f[69] = near.h; f[70] = far.w; f[71] = far.h;
      f[72] = settings.detailDistance; f[73] = Math.max(settings.farLimit, f[44] + 1); f[74] = outCW; f[75] = outCH;
      // P6-B lightning: the flash to render this frame (radius 0 = none; the march skips the glow on a uniform branch).
      const flash = lightning.update(frameTime);
      if (flash) { f[76] = flash.position[0]; f[77] = flash.position[1]; f[78] = flash.position[2]; f[79] = flash.radius; f[80] = flash.color[0]; f[81] = flash.color[1]; f[82] = flash.color[2]; f[83] = flash.level; }
      else { f[79] = 0; f[80] = f[81] = f[82] = f[83] = 0; }
      // C1 low-sun lighting: the body terms' sun share and the environment's (sun elevation from the world-up sun direction), and the phase model.
      const sunUp = Math.max(0, Math.min(1, frame.sunDirection[1] / Math.max(1e-3, settings.bodySunKnee)));
      lowSun = 1 - sunUp;
      f[84] = settings.bodySunFloor + (1 - settings.bodySunFloor) * sunUp; f[85] = settings.bodyEnv;
      f[86] = settings.phaseModel === 'mie' ? 1 : 0; f[87] = settings.bodyDepth * (1 - sunUp);
      f[96] = settings.noiseInvert; f[97] = settings.detailTypeOverride; f[98] = settings.typeFromScale; f[99] = settings.ambientLaw;
      f[100] = settings.diffuseSun; f[101] = settings.ambientSaturation; f[102] = settings.ambientWarmth; f[103] = settings.directInScatterFlat; f[104] = settings.diffuseFalloff;
      f[105] = settings.inlineLightScale; f[106] = settings.jitterStatic; f[107] = settings.profileFilter;
      f[108] = settings.inlineProfile; f[109] = settings.lightMipBias; f[110] = settings.ambientTap; f[111] = settings.inScatterProfile;
      f[112] = settings.jitterNoise; f[113] = settings.stepJitter; f[114] = settings.lightGridFilter; f[115] = Math.max(0, settings.inlineReuse);
      f[116] = Math.max(0, settings.glowDepth); f[117] = settings.glowDepthMode; f[118] = Math.max(0, settings.microLightScale); f[119] = settings.microShadowMode; f[120] = Math.max(0, settings.microDist2); f[121] = Math.max(0, settings.microShadow2); f[122] = Math.min(1, Math.max(0, settings.directProfile)); f[123] = Math.max(0, settings.directRimDepth);
      f[92] = Math.max(0, settings.hazeDensity) * 1e-3; f[93] = 1 / Math.max(1, settings.hazeHeight); f[94] = settings.hazeBase; f[95] = settings.lightingModel === 'octave' ? 1 : 0;
      if (settings.dropletDiameter !== mieDiameter) { mieDiameter = settings.dropletDiameter; const m = mieParams(mieDiameter); f[88] = m[0]; f[89] = m[1]; f[90] = m[2]; f[91] = m[3]; }
      // Temporal handling of a flash: the history is not reset (a cut would trace every pixel at full cost for the whole flash). While a flash is up, and for
      // the frame after it, the resolve takes mostly fresh samples (blend FLASH_BLEND); the neighbourhood clip already pulls the history toward the fresh ones.
      flashLevelNow = flash ? flash.level : 0;
      const flashFrame = flash !== null || flashPrev;
      flashPrev = flash !== null;
      // The distant sky layer: bakes its weather window / compiles its pipeline on first use (async), then renders.
      // X1: the procedural model replaces the voxel field and the layer's own field (the march passes run with no steps: clear).
      // X3: 'hybrid' keeps the voxel march; the procedural model still replaces the layer's own field.
      const proc = settings.densityModel !== 'nvdf' && procModel?.ready ? procModel : null;
      const skyActive = (proc ? true : skyLayer.settings.enabled) && skyLayer.prepare(encoder, skyBox, !!uniformLighting, timer, proc);
      const procOn = !!proc && skyActive;
      const procMode = procOn ? settings.densityModel : 'nvdf';
      if (procMode !== procWas) { procWas = procMode; needReset = true; }
      frameU32[33] = procMode === 'procedural' ? 0 : settings.maxSteps >>> 0;
      f[53] = skyActive ? 1 : 0;
      // P0.5: this sample's jitter index and sub-pixel offset, the step divisor; the step budget raised to match (x CV_BUDGET, the step growth is off),
      // a near-zero transmittance cutoff, fresh in-line sun taps at every step, the blue-noise jitter with a random step phase, no static far jitter.
      const cvIndex = cvCount + Math.max(0, Math.round(settings.convergedSeed));
      const cvKeep = Math.max(0, Math.round(settings.convergedKeep)) | 0;
      const cvSub = cv ? convergedSubPixel(cvIndex) : [0, 0];
      if (cv) {
        f[124] = cvStep; f[125] = cvSub[0]; f[126] = cvSub[1]; f[127] = cvKeep & 1;
        if (frameU32[33] > 0) frameU32[33] = Math.min(1 << 20, Math.ceil(settings.maxSteps * cvStep * CV_BUDGET)) >>> 0;
        if (!(cvKeep & 4)) f[45] = Math.min(settings.transmittanceCutoff, CV_CUTOFF);
        f[106] = 0; f[112] = 1; f[113] = 1; if (!(cvKeep & 2)) f[115] = 0;
      } else { f[124] = 0; f[125] = 0; f[126] = 0; f[127] = 0; }
      // P1.1 debug: the light probe (view optical depth, mode) and the sun at the volume centre (conv2.yzw; conv2.x is the converged band row).
      f[129] = Math.max(0, settings.lightProbe); f[130] = settings.lightProbeMode; f[131] = settings.sunAtCentre;
      // P1.1b sunShadow: in-line reach and taps, the direct term's albedo (Frame.sunShadow).
      f[132] = Math.max(48, settings.sunShadowInlineReach); f[133] = Math.max(1, Math.round(settings.sunShadowInlineSamples)); f[134] = Math.min(1, Math.max(0, settings.directAlbedo)); f[135] = settings.sunShadowInlineJitter;
      // P1.2a 'fit' lighting model (Frame.fit, Frame.fit2).
      f[136] = settings.fitAlbedo; f[137] = settings.fitG; f[138] = settings.fitMs; f[139] = settings.fitK; f[140] = settings.fitAmbient; f[141] = settings.lightingModel === 'fit' ? 1 : 0; f[142] = 0; f[143] = 0;
      // ---- temporal amortization (P5-B): rates, cuts, phases ----
      const rates: TemporalRate[] = cv ? [1, 1] : [snapRate(settings.temporalNear), snapRate(settings.temporalFar)];
      const cam = frame.cameraPosition, sun = frame.sunDirection;
      // Forward direction of the camera from the inverse view-projection (clip (0, 0, 1) is the far plane, straight ahead).
      const inv = frame.inverseViewProjection;
      const wv = inv[11] + inv[15];
      const fdx = (inv[8] + inv[12]) / wv - cam[0], fdy = (inv[9] + inv[13]) / wv - cam[1], fdz = (inv[10] + inv[14]) / wv - cam[2];
      const fl = Math.hypot(fdx, fdy, fdz) || 1;
      let cut = needReset || !prevValid;
      if (!cut) {
        const d = Math.hypot(cam[0] - prevCam[0], cam[1] - prevCam[1], cam[2] - prevCam[2]);
        const turn = (fdx * prevFwd[0] + fdy * prevFwd[1] + fdz * prevFwd[2]) / fl;
        const sunDot = sun[0] * prevSun[0] + sun[1] * prevSun[1] + sun[2] * prevSun[2];
        if (d > TEMPORAL_CUT_POSITION_M || turn < TEMPORAL_CUT_TURN_COS || sunDot < TEMPORAL_SUN_JUMP_COS) cut = true;
        for (const i of TEMPORAL_MODEL_INDICES) if (f[i] !== prevModel[i]) { cut = true; break; }
      }
      if (cut) temporalResets++;
      for (const i of TEMPORAL_MODEL_INDICES) prevModel[i] = f[i];
      const accumulate = !cv && settings.temporalAccumulate > 0.5;
      for (let pass = 0; pass < 2; pass++) {
        const k = rates[pass];
        // k = 1 writes the history directly (every pixel, every frame) unless temporalAccumulate; a cut or a rate change traces every pixel into the history.
        passFull[pass] = (k > 1 || accumulate) && (cut || lastRate[pass] !== k || lastAccumulate !== accumulate);
        lastRate[pass] = k;
        ensureTrace(pass, k, k === 1 && accumulate);
      }
      lastAccumulate = accumulate;
      if (!cv) cur ^= 1;   // P0.5: the converged march traces a sample in bands over frames into the same history texture
      for (let pass = 0; pass < 2; pass++) {
        const t = targets[pass];
        f[28] = t.rw; f[29] = t.rh; frameU32[46] = pass;
        f[128] = cv ? convergedRows(t.rh, cvBand, cvBands)[0] : 0;
        // The jitter index counts this pass's own sweeps (every pixel traced once per k frames), so the pixels of one sweep share one IGN slice instead of a lattice-correlated hatch.
        frameU32[34] = cv ? cvIndex >>> 0 : rates[pass] > 1 ? Math.floor(temporalFrames / rates[pass]) >>> 0 : frame.frameIndex >>> 0;
        f[60] = rates[pass]; f[61] = temporalFrames % rates[pass]; f[62] = passFull[pass] ? 1 : 0; f[63] = 0;
        device.queue.writeBuffer(frameUniforms[pass], 0, f);
        resolveF32.set(prevViewProj, 0);
        resolveF32[16] = prevCam[0]; resolveF32[17] = prevCam[1]; resolveF32[18] = prevCam[2]; resolveF32[19] = prevValid && !cut ? 1 : 0;
        resolveF32[20] = Math.min(1, Math.max(0.02, flashFrame ? Math.max(settings.temporalBlend, FLASH_BLEND) : settings.temporalBlend)); resolveF32[21] = TEMPORAL_CLIP_SIGMA; resolveF32[22] = TEMPORAL_CLIP_MARGIN; resolveF32[23] = settings.historyDither;
        resolveF32[24] = t.prw; resolveF32[25] = t.prh;
        // windCompensate 1 = the per-frame displacement (prevRect.zw), 2 = its opposite sign (diagnostic), 3 = integer-texel snap from the total offsets
        // (prevRect.zw = the previous frame's total, extra.zw = this frame's total).
        const wc = settings.windCompensate;
        if (wc > 2.5) { resolveF32[26] = settings.windOffset[0] - windDelta[0]; resolveF32[27] = settings.windOffset[2] - windDelta[1]; resolveF32[30] = settings.windOffset[0]; resolveF32[31] = settings.windOffset[2]; }
        else { const wsign = wc > 1.5 ? -1 : wc > 0.5 ? 1 : 0; resolveF32[26] = wsign * windDelta[0]; resolveF32[27] = wsign * windDelta[1]; resolveF32[30] = 0; resolveF32[31] = 0; }
        resolveF32[28] = settings.historyFilter; resolveF32[29] = settings.windCompensate;
        device.queue.writeBuffer(resolveParams[pass], 0, resolveF32);
      }
      f[60] = 0; f[61] = 0; f[62] = 0; frameU32[34] = (cv ? cvIndex : frame.frameIndex) >>> 0;
      // Remember this frame's view for the next frame's reprojection.
      prevViewProj.set(frame.viewProjection);
      prevCam[0] = cam[0]; prevCam[1] = cam[1]; prevCam[2] = cam[2];
      prevFwd[0] = fdx / fl; prevFwd[1] = fdy / fl; prevFwd[2] = fdz / fl;
      prevSun[0] = sun[0]; prevSun[1] = sun[1]; prevSun[2] = sun[2];
      prevValid = true; needReset = false; temporalFrames++;
      if (skyActive) {
        f[28] = skyTarget!.w; f[29] = skyTarget!.h; frameU32[46] = 2;
        device.queue.writeBuffer(frameUniforms[2], 0, f);
      }

      // The grid holds extinction-scaled optical depth; it re-slices over 8 frames when the sun or the scale moves.
      // X4: in 'hybrid' it also holds the procedural clouds' sun optical depth (heroes in their shadow); it rebuilds as they or the box move by ~8 m.
      const gridProc = procMode === 'hybrid' ? proc : null;
      if (settings.noiseScale !== noiseScaleNow && volume) {
        noiseScaleNow = settings.noiseScale;
        device.queue.writeBuffer(volumeUniforms, 0, new Float32Array(volumeUniformData(volumePos, volume.extentMeters, volume.voxelSize, settings.noiseScale)));
      }
      const gridStep = lightGrid.encode(encoder, volumeGroup, { sunDirection: [frame.sunDirection[0], frame.sunDirection[1], frame.sunDirection[2]], densityScale: extinction(), frameIndex: frame.frameIndex, sky: skyActive ? skyLayer.domeResources : null,
        procedural: gridProc, lightDensityScale: settings.lightDensityScale, directSource: settings.lightGridSource > 0.5 && !!volume?.direct,
        // P1.1b sunShadowGridSource: the grid's sun channel from the density the march renders (direct texels, or the NVDF's up-rez at the camera's mips).
        sunSource: settings.sunShadowGridSource > 0.5 ? (volume?.direct ? 'direct' : 'uprez') : 'nvdf',
        uprez: settings.sunShadowGridSource > 0.5 && !volume?.direct ? { camera: [frame.cameraPosition[0], frame.cameraPosition[1], frame.cameraPosition[2]], wind: [settings.windOffset[0], settings.windOffset[1], settings.windOffset[2]],
          mipDistanceScale: settings.mipDistanceScale, baseMip: settings.baseMip, hfDistance: Math.max(settings.detailDistance, 150), wispyBias: settings.wispyBias, detailBias: settings.detailBias,
          uprez: [settings.noiseInvert, settings.detailTypeOverride, settings.typeFromScale, settings.ambientLaw] } : undefined,
        procKey: gridProc ? [gridProc.version, Math.round((settings.windOffset[0] - skyBox.minCorner[0]) / 8), Math.round((settings.windOffset[2] - skyBox.minCorner[2]) / 8), Math.round(skyBox.minCorner[1] / 8)] : undefined }, timer);
      if (gridStep.swapped) gridSwaps++; if (gridStep.restarted) gridRestarts++;   // P1.1b: lightGridInfo counters

      if (uniformLighting) {
        // One sun for every height ([3] = [4] = log sun, heights 0 and 1 m, no earth shadow), the environment pair = the ambient pair (see SKY_LIGHT_ENTRIES).
        const sun = uniformLighting.sunRadiance, top = uniformLighting.ambientTop, bottom = uniformLighting.ambientBottom;
        const v3 = (c: ArrayLike<number>, w: number) => [c[0], c[1], c[2], w];
        const logSun = [0, 1, 2].map(i => Math.log(Math.max(sun[i], 1e-12)));
        const rows = [v3(sun, -1e9), v3(top, 0), v3(bottom, 1), v3(logSun, 0), v3(logSun, 1), v3(top, 0), v3(bottom, 0), [settings.groundAlbedo, settings.envSunWeight, 0, 0]];
        for (let i = 0; i < SKY_LIGHT_ENTRIES; i++) for (let j = 0; j < 4; j++) lightingData[i * 4 + j] = rows[i][j];
        device.queue.writeBuffer(skyLightBuffer, 0, lightingData);
      } else {
        // The compute pass reads its parameters from the last entry.
        lightingData[28] = settings.groundAlbedo; lightingData[29] = settings.envSunWeight; lightingData[30] = lowSun * settings.ambientLowSun; lightingData[31] = settings.ambientBelowMirror;
        device.queue.writeBuffer(skyLightBuffer, 28 * 4, lightingData, 28, 4);
        const sky = encoder.beginComputePass({ label: 'cloud sky light' });
        sky.setPipeline(skyLightPipeline);
        sky.setBindGroup(0, volumeGroup);
        sky.setBindGroup(1, skyLightGroup);
        sky.setBindGroup(MARCH_ATMOSPHERE_GROUP, frame.atmosphere!);
        sky.dispatchWorkgroups(1);
        sky.end();
      }

      for (let pass = 0; pass < 2; pass++) {
        if (pass === 0 && !nearActive) continue;
        const k = rates[pass], t = targets[pass];
        // k = 1 and cut frames march straight into the history texture (every pixel); otherwise into the compact trace, which the resolve merges with last frame's result.
        const direct = passFull[pass] || (k === 1 && !accumulate);
        const marchIndex = ((pass * 2 + gridStep.front) * 2 + cur) * 2 + (direct ? 1 : 0);
        const march = encoder.beginComputePass({ label: pass ? 'cloud march far' : 'cloud march near', timestampWrites: timer?.passTimestampWrites(pass ? 'marchFar' : 'marchNear') });
        march.setPipeline(getMarchPipeline(!!uniformLighting, direct, !!fine && settings.fineDistance > 0, !!volume?.direct));
        march.setBindGroup(0, volumeGroup);
        march.setBindGroup(1, marchGroups[marchIndex] ??= device.createBindGroup({ label: `cloud march ${t.name}`, layout: marchLayouts[direct ? 1 : 0], entries: [
          { binding: 0, resource: { buffer: frameUniforms[pass] } },
          { binding: 1, resource: frame.depth },
          { binding: 2, resource: (direct ? t.hist[cur] : t.trace!).color.createView() },
          { binding: 3, resource: (direct ? t.hist[cur] : t.trace!).depth.createView() },
          ...lightGrid.bindGroupEntries(MARCH_LIGHT_GRID_BINDING, gridStep.front),
          { binding: MARCH_SKY_LIGHT_BINDING, resource: { buffer: skyLightBuffer } },
          { binding: MARCH_NEAR_BINDING, resource: pass ? targets[0].hist[cur].color.createView() : dummyNear.createView() },
          { binding: MARCH_BLUE_NOISE_BINDING, resource: blueNoise.createView() },
        ] }));
        if (!uniformLighting) march.setBindGroup(MARCH_ATMOSPHERE_GROUP, frame.atmosphere!);
        const w = t.rw, h = t.rh;
        // Only the traced pixels are dispatched: x halves for k >= 2, y for k = 4.
        const cvRows = cv ? convergedRows(h, cvBand, cvBands) : null;
        const gx = direct || k === 1 ? w : Math.ceil(w / 2), gy = cvRows ? cvRows[1] - cvRows[0] : direct || k <= 2 ? h : Math.ceil(h / 2);
        march.dispatchWorkgroups(Math.ceil(gx / 8), Math.ceil(gy / 8));
        march.end();
        if (!direct) {
          const resolve = encoder.beginComputePass({ label: pass ? 'cloud resolve far' : 'cloud resolve near', timestampWrites: timer?.passTimestampWrites(pass ? 'resolveFar' : 'resolveNear') });
          resolve.setPipeline(resolvePipeline);
          resolve.setBindGroup(0, volumeGroup);
          resolve.setBindGroup(1, resolveGroups[pass * 2 + cur] ??= device.createBindGroup({ label: `cloud resolve ${t.name}`, layout: resolveLayout, entries: [
            { binding: 0, resource: { buffer: frameUniforms[pass] } },
            { binding: 1, resource: frame.depth },
            { binding: TEMPORAL_BINDINGS.trace, resource: t.trace!.color.createView() },
            { binding: TEMPORAL_BINDINGS.traceDepth, resource: t.trace!.depth.createView() },
            { binding: TEMPORAL_BINDINGS.hist, resource: t.hist[1 - cur].color.createView() },
            { binding: TEMPORAL_BINDINGS.histDepth, resource: t.hist[1 - cur].depth.createView() },
            { binding: TEMPORAL_BINDINGS.out, resource: t.hist[cur].color.createView() },
            { binding: TEMPORAL_BINDINGS.outDepth, resource: t.hist[cur].depth.createView() },
            { binding: TEMPORAL_BINDINGS.params, resource: { buffer: resolveParams[pass] } },
            { binding: TEMPORAL_BINDINGS.sampler, resource: resolveSampler },
          ] }));
          resolve.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
          resolve.end();
        }
      }

      if (skyActive) {
        skyLayer.encode(encoder, { volumeGroup, frameBuffer: frameUniforms[2], depth: frame.depth, color: skyTarget!.color, depthOut: skyTarget!.depth, back: skyTarget!.back, atmosphere: uniformLighting ? undefined : frame.atmosphere, skyLightBuffer, box: skyBox, inverseViewProjection: frame.inverseViewProjection, cameraPosition: frame.cameraPosition, sunDirection: frame.sunDirection, timer, procedural: procOn ? proc : null, time: frameTime,
          wind: settings.windOffset, voxelDepth: { near: near.hist[cur].depth, far: far.hist[cur].depth },
          subPixelSpan: level !== 'cinematic' && settings.levelSubPixelSpan >= 0 ? settings.levelSubPixelSpan : undefined,
          lodLayerPixel: level !== 'cinematic' && settings.levelLodLayerPixel >= 0 ? settings.levelLodLayerPixel : undefined,
          converged: cv ? { stepScale: cvStep, budget: CV_BUDGET, index: cvIndex, subPixel: [cvSub[0], cvSub[1]], keep: cvKeep, cutoff: cvKeep & 4 ? undefined : CV_CUTOFF, band: cvBand, bands: cvBands } : null });
      }
      // U2: below the cinematic level the layer (the whole cloud in 'procedural' mode) goes through the upscaler to the composite's size, and the
      // composite reads the upscaled colour per output pixel (frame.skyEnabled 2) with the layer's own depth words for the scene occlusion.
      let skyUp: GPUTexture | null = null;
      upscaleWarm = skyActive && procMode === 'procedural' ? upscaleWarm + 1 : 0;
      // The upscaler is created (its pipelines compiled, its targets allocated) once the layer has run for UPSCALE_WARM_FRAMES, out of the
      // page's start-up compiles; until then the reduced layer is composited the old way (bilinear). U2 open problem: on the shared, heavily
      // loaded test machine Metal lost the device ("Insufficient Memory") within a few frames of the upscaler's start in about half of the
      // runs, at any start frame tried (see the U2 report); runs that got past those frames never failed.
      if (skyActive && level !== 'cinematic' && procMode === 'procedural' && (skyUpscale || upscaleWarm > UPSCALE_WARM_FRAMES)) {
        skyUpscale ??= createSkyUpscale(device);
        // A frame without the upscaler in between (another level, the layer off) leaves its history stale: reset it.
        const resume = upscaleLastTime < 0;
        const dt = resume ? 1 / 60 : Math.min(0.25, Math.max(1e-4, frame.time - upscaleLastTime));
        upscaleLastTime = frame.time;
        const last = skyLayer.lastEncode;
        upColorScale = settings.upscaleExposure > 0 ? 1 : Math.min(1, Math.max(1 / 4096, settings.upscaleColorScale));
        skyUp = skyUpscale.encode(encoder, {
          front: skyTarget!.color, back: skyTarget!.back, dist: skyTarget!.depth, displayWidth: outCW, displayHeight: outCH,
          path: settings.upscalePath, sharpness: settings.upscaleSharpness, depthMode: settings.upscaleDepth, exposure: settings.upscaleExposure, colorScale: upColorScale,
          inverseViewProjection: frame.inverseViewProjection, viewProjection: frame.viewProjection, cameraPosition: frame.cameraPosition,
          cloudMotion: last.motion, reset: last.cut || resume, deltaTime: dt, timer,
        });
      } else upscaleLastTime = -1;
      if (skyUp) {
        // The frame uniforms were written before the layer ran; only the composite reads skyEnabled. Above 1.5 it is 1 + the factor that undoes
        // the colour scale the upscaler input was given.
        f[53] = 1 + 1 / upColorScale;
        device.queue.writeBuffer(frameUniforms[0], 53 * 4, f, 53, 1);
      }
      const skyColorTex = skyUp ?? skyTarget!.color;
      if (skyColorTex !== compositeSkyKey) { compositeSkyKey = skyColorTex; compositeGroups.fill(undefined); }

      // Cloud shadow map: the sun-ray optical depth over the box and (with the layer on) out to the horizon, one slice per frame.
      {
        const skyRes = skyActive ? skyLayer.domeResources : null;
        const ss = skyLayer.settings;
        shadowMap.encode(encoder, {
          volumeGroup, lightGrid: grid, gridFront: gridStep.front, gridSwapped: gridStep.swapped, sunDirection: frame.sunDirection, cameraPosition: frame.cameraPosition,
          box: skyBox, extinction: extinction(), lightDensityScale: settings.lightDensityScale, shadowStrength: settings.shadowStrength,
          sky: skyRes ? { ...skyRes, key: [ss.densityScale, ss.curvature] } : null, timer,
          // X3: the procedural model's clouds move with the wind offset: a refresh once they have moved by about a near-cascade texel.
          procedural: procOn ? proc : null,
          procKey: procOn ? [proc!.version, Math.round(settings.windOffset[0] / 8), Math.round(settings.windOffset[2] / 8)] : undefined,
          // SH1: with `advect` the map is built from one moment and its lookup slides with the clouds (the wind offset times the cloud speed).
          procVersion: procOn ? proc!.version : undefined, wind: settings.windOffset, windSpeed: proc?.shadowSpeed ?? proc?.motionSpeed ?? 1,
        });
      }

      // P9-E: the high cloud layer at the composite's size; the composite merges it behind everything (in front from above it).
      cirrus.encode(encoder, { frameBuffer: frameUniforms[0], depth: frame.depth, skyLightBuffer, atmosphere: uniformLighting ? undefined : frame.atmosphere, width: outCW, height: outCH, cameraPosition: frame.cameraPosition, time: frame.time, timer, ndf: cirrus.settings.source === 'map' && procOn ? proc!.ndfMap ?? null : null });
      if (cirrus.bindKey !== cirrusKey) { cirrusKey = cirrus.bindKey; compositeGroups.fill(undefined); }
      // L3: the mid-level 2.5D layer (the model's altocumulus / altostratus beyond the volume's reach), between the low clouds and the cirrus.
      {
        const m = procOn ? proc!.midLayer ?? null : null;
        const ms = midLayer.settings;
        if (m) {
          if (!cirrus.settings.enabled) cirrus.bakeNoise(encoder, timer);
          ms.enabled = true; ms.altitude = m.altitude; ms.thickness = m.thickness; ms.coverage = m.coverage; ms.type = m.type; ms.veil = m.veil;
          ms.opticalDepth = m.opticalDepth; ms.scale = m.scale; ms.detail = m.detail; ms.coverageVariation = 0.4;
          ms.windVelocity[0] = 0; ms.windVelocity[1] = 0; ms.windOffset[0] = m.windOffset[0]; ms.windOffset[1] = m.windOffset[1]; ms.streakAngle = m.streakAngle;
          ms.source = 'global'; ms.ndfInfluence = m.ndfInfluence; ms.ndfTypeStratiform = m.typeStratiform; ms.ndfTypeCumuliform = m.typeCumuliform; ms.edgeSoftness = 0.08; ms.fadeStart = m.fadeStart; ms.fadeEnd = m.fadeEnd;
          // Water droplets, not ice: a strong forward lobe with a weak backward one, no halo.
          ms.phaseForward = 0.75; ms.phaseBroad = -0.15; ms.phaseForwardWeight = 0.55; ms.halo = 0; ms.multipleScattering = 1.6;
        } else ms.enabled = false;
        midLayer.encode(encoder, { frameBuffer: frameUniforms[0], depth: frame.depth, skyLightBuffer, atmosphere: uniformLighting ? undefined : frame.atmosphere, width: outCW, height: outCH, cameraPosition: frame.cameraPosition, time: frame.time, timer, ndf: m?.ndf ?? null });
        if (midLayer.bindKey !== midKey) { midKey = midLayer.bindKey; compositeGroups.fill(undefined); }
      }
      const composite = encoder.beginComputePass({ label: 'cloud composite', timestampWrites: timer?.passTimestampWrites('composite') });
      composite.setPipeline(compositePipeline);
      composite.setBindGroup(0, volumeGroup);
      const cvOut = cv && cvTargets ? cvTargets : null;
      composite.setBindGroup(1, compositeGroups[(cvOut ? 4 : 0) + gridStep.front * 2 + cur] ??= device.createBindGroup({ label: 'cloud composite', layout: compositeLayout, entries: [
        { binding: 0, resource: { buffer: frameUniforms[0] } },
        { binding: 1, resource: frame.depth },
        { binding: 2, resource: near.hist[cur].color.createView() },
        { binding: 3, resource: near.hist[cur].depth.createView() },
        { binding: 4, resource: (cvOut ? cvOut.sample : output).createView() },
        { binding: 5, resource: far.hist[cur].color.createView() },
        { binding: 6, resource: far.hist[cur].depth.createView() },
        ...grid.bindGroupEntries(COMPOSITE_LIGHT_GRID_BINDING, gridStep.front),
        { binding: COMPOSITE_SKY_BINDING, resource: skyColorTex.createView() },
        { binding: COMPOSITE_SKY_BINDING + 1, resource: skyTarget!.depth.createView() },
        { binding: COMPOSITE_SKY_BINDING + 2, resource: skyTarget!.back.createView() },
        { binding: COMPOSITE_SAMPLER_BINDING, resource: compositeLinear },
        { binding: COMPOSITE_SAMPLER_BINDING + 1, resource: compositeNearest },
        ...shadowMap.bindGroupEntries(COMPOSITE_SHADOW_BINDING),
        ...cirrus.compositeEntries(COMPOSITE_CIRRUS_BINDING),
        ...midLayer.compositeEntries(COMPOSITE_MID_BINDING),
      ] }));
      composite.dispatchWorkgroups(Math.ceil(outCW / 8), Math.ceil(outCH / 8));
      composite.end();
      if (cvOut) {
        // P0.5: a sample is traced over cvBands frames, one band of rows each, and added once its last band is in. The light grid swapping, the shadow
        // map being written (a sweep after the sun or the view moved) or the sky trace not running yet (compiling, baking) drops it and restarts the sum.
        const writes = shadowMap.info.writes;
        const loading = ((settings.densityModel !== 'nvdf' && !!procModel) || skyLayer.settings.enabled) && !skyActive;
        const unstable = gridStep.swapped || writes !== cvShadowWrites || loading;
        cvShadowWrites = writes;
        let add = false;
        if (unstable) {
          if (cvCount > 0 || cvBand > 0) { cvRestarts++; cvReason = loading ? 'loading' : gridStep.swapped ? 'grid' : 'shadow'; }
          cvCount = 0; cvBand = 0;
        } else if (cvBand >= cvBands - 1) { cvBand = 0; cvCount++; add = true; } else cvBand++;
        if (add) {
          cvParamU32[0] = cvCount;
          device.queue.writeBuffer(cvParams, 0, cvParamU32);
          cvPipeline ??= device.createComputePipeline({ label: 'cloud converged accumulate', layout: device.createPipelineLayout({ bindGroupLayouts: [cvLayout] }), compute: { module: device.createShaderModule({ label: 'cloud converged accumulate', code: CONVERGED_WGSL }), entryPoint: 'main' } });
          const acc = encoder.beginComputePass({ label: 'cloud converged accumulate' });
          acc.setPipeline(cvPipeline);
          acc.setBindGroup(0, cvGroups[cvPing] ??= device.createBindGroup({ label: `cloud converged ${cvPing}`, layout: cvLayout, entries: [
            { binding: 0, resource: { buffer: cvParams } },
            { binding: 1, resource: cvOut.sample.createView() },
            { binding: 2, resource: cvOut.sums[cvPing].createView() },
            { binding: 3, resource: cvOut.sums[1 - cvPing].createView() },
            { binding: 4, resource: output.createView() },
          ] }));
          acc.dispatchWorkgroups(Math.ceil(outCW / 8), Math.ceil(outCH / 8));
          acc.end();
          cvPing = 1 - cvPing;
        }
      }

      if (domeSettings.enabled) {
        // Reference point: fixed, or the camera's x/z at ground height.
        const ref = domeSettings.referencePoint;
        domeRef[0] = ref ? ref[0] : frame.cameraPosition[0]; domeRef[1] = ref ? ref[1] : domeSettings.groundHeight; domeRef[2] = ref ? ref[2] : frame.cameraPosition[2];
        // A sun or density change makes the old texels stale until every slot has been redone.
        const sd = frame.sunDirection;
        if (domeSun[0] * sd[0] + domeSun[1] * sd[1] + domeSun[2] * sd[2] < 0.99999 || domeScaleSeen !== extinction() * domeSettings.densityScale) {
          domeSun[0] = sd[0]; domeSun[1] = sd[1]; domeSun[2] = sd[2]; domeScaleSeen = extinction() * domeSettings.densityScale;
          domeRefreshFrames = 0;
        }
        // The grid the dome lights from is replaced when a bake completes (8 frames after a sun change): shade two slots per
        // frame for the next 8 so the whole dome has seen the new grid 16 frames after the change.
        if (gridStep.swapped) { domeBoost = 8; domeRefreshFrames = 0; }
        const slots = domeBoost > 0 ? 2 : 1;
        if (domeBoost > 0) domeBoost--;
        const df = frameF32;   // the march uniform with the dome's own origin and cutoff
        df[16] = domeRef[0]; df[17] = domeRef[1]; df[18] = domeRef[2];
        df[45] = Math.max(settings.transmittanceCutoff, 0.02);
        device.queue.writeBuffer(domeFrameBuffer, 0, df);
        domeParamF32[0] = domeRef[0]; domeParamF32[1] = domeRef[1]; domeParamF32[2] = domeRef[2]; domeParamF32[3] = domeSettings.densityScale;
        domeParamU32[4] = domeSize; domeParamU32[5] = domeSlot; domeParamU32[6] = domeSettings.maxSteps >>> 0; domeParamU32[7] = slots;
        domeParamF32[8] = domeSettings.stepMin; domeParamF32[9] = domeSettings.stepRel; domeParamF32[10] = domeSettings.maxDistance;
        const skyRes = skyLayer.domeResources;
        // X3: with a procedural model on, its clouds replace the layer's field outside the box (once its dome pipeline is compiled).
        const dProc = procOn ? domeProcPipeline(proc!) : null;
        const domeProcOn = !!dProc?.pipeline;
        domeParamF32[11] = skyRes || domeProcOn ? 1 : 0;
        if ((skyRes?.weather ?? null) !== domeSkyKey) { domeSkyKey = skyRes?.weather ?? null; domeGroups = null; }   // the layer re-bakes its window when the box moves
        const pk = domeProcOn ? proc!.resourceKey : null;
        if (pk !== domeProcKey) { domeProcKey = pk; domeGroups = null; domeRefreshFrames = 0; }
        device.queue.writeBuffer(domeParamBuffer, 0, domeParamData);
        domeSlot = (domeSlot + slots) % DOME_REFRESH_FRAMES;
        domeRefreshFrames = Math.min(DOME_REFRESH_FRAMES, domeRefreshFrames + slots);
        domeGroups ??= [0, 1].map(slot => device.createBindGroup({ label: `cloud dome ${slot}`, layout: domeProcOn ? dProc!.layout : domeLayout, entries: [
          { binding: DOME_FRAME_BINDING, resource: { buffer: domeFrameBuffer } },
          { binding: DOME_DEPTH_BINDING, resource: domeDepth.createView() },
          { binding: DOME_OUT_BINDING, resource: domeView },
          { binding: DOME_PARAMS_BINDING, resource: { buffer: domeParamBuffer } },
          ...lightGrid!.bindGroupEntries(DOME_LIGHT_GRID_BINDING, slot as 0 | 1),
          { binding: DOME_SKY_LIGHT_BINDING, resource: { buffer: skyLightBuffer } },
          { binding: DOME_SKY_WEATHER_BINDING, resource: (skyRes?.weather ?? domeSkyDummy).createView() },
          { binding: DOME_SKY_SAMPLER_BINDING, resource: domeSkySampler },
          { binding: DOME_SKY_PARAMS_BINDING, resource: { buffer: skyRes?.params ?? domeSkyDummyParams } },
          ...(domeProcOn ? proc!.resourceEntries(DOME_PROCEDURAL_BINDING) : []),
        ] }));
        const pass = encoder.beginComputePass({ label: 'cloud dome', timestampWrites: timer?.passTimestampWrites('dome') });
        pass.setPipeline(domeProcOn ? dProc!.pipeline! : domePipeline);
        pass.setBindGroup(0, volumeGroup);
        pass.setBindGroup(1, domeGroups[gridStep.front]);
        const blocks = Math.ceil(domeSize / 4 / 8);
        pass.dispatchWorkgroups(blocks, blocks);
        pass.end();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseTargets(); if (ownsVolume) volume?.destroy(); noise?.destroy(); lightGrid?.destroy();
      volumeGroup = null; forgetGroups(); lightGrid = null;
      volumeUniforms.destroy(); heroUniforms.destroy(); resolveParams.forEach(b => b.destroy()); frameUniforms.forEach(b => b.destroy()); dummyNear.destroy(); blueNoise.destroy(); skyLightBuffer.destroy(); cvParams.destroy();
      skyUpscale?.dispose(); skyUpscale = null;
      skyLayer.dispose(); cirrus.dispose(); midLayer.dispose(); shadowMap.dispose(); domeSkyDummy.destroy(); domeSkyDummyParams.destroy(); domeTexture.destroy(); domeFrameBuffer.destroy(); domeParamBuffer.destroy(); domeDepth.destroy(); domeGroups = null;
    },
  };
}
