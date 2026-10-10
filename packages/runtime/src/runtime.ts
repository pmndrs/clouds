import type { CloudNoiseAsset, CloudVolumeAsset } from './assets';
import type { GpuTimer } from './gpu-timer';
import { createLightGrid, type LightGrid } from './light-grid';
import { createAtmosphereBindGroupLayout } from './shaders/atmosphere.wgsl';
import { defaultDomeSettings, type CloudDome } from './dome';
import { DOME_DEPTH_BINDING, DOME_FRAME_BINDING, DOME_LIGHT_GRID_BINDING, DOME_OUT_BINDING, DOME_PARAMS_BINDING, DOME_PARAM_BYTES, DOME_REFRESH_FRAMES, DOME_SKY_LIGHT_BINDING, DOME_SKY_PARAMS_BINDING, DOME_SKY_SAMPLER_BINDING, DOME_SKY_WEATHER_BINDING, DOME_WGSL, DOME_PROCEDURAL_BINDING, domeWgsl } from './shaders/dome.wgsl';
import { uploadCloudNoise, uploadCloudVolume, type GpuCloudVolume } from './resources';
import { COMMON_WGSL } from './shaders/common.wgsl';
import { COMPOSITE_CIRRUS_BINDING, COMPOSITE_LIGHT_GRID_BINDING, COMPOSITE_SAMPLER_BINDING, COMPOSITE_SHADOW_BINDING, COMPOSITE_SKY_BINDING, COMPOSITE_WGSL } from './shaders/composite.wgsl';
import { createCloudShadowMap, type CloudShadowMap } from './shadow-map';
import { controlledCost, describeDevice, DynamicScale, selectTier, type AutoQualityInfo, type AutoQualityOptions } from './auto-quality';
import { DENSITY_WGSL } from './shaders/density.wgsl';
import { DIRECT_DENSITY_WGSL } from './shaders/direct.wgsl';
import { TEMPORAL_BINDINGS, TEMPORAL_PARAM_BYTES, TEMPORAL_WGSL } from './shaders/temporal.wgsl';
import { FRAME_UNIFORM_BYTES } from './shaders/frame.wgsl';
import { createLightning, type FlashOptions, type LightningSettings } from './lightning';
import { MARCH_ATMOSPHERE_GROUP, MARCH_LIGHT_GRID_BINDING, MARCH_NEAR_BINDING, MARCH_SKY_LIGHT_BINDING, marchWgsl, SKY_LIGHT_BINDING, SKY_LIGHT_BYTES, SKY_LIGHT_ENTRIES, SKY_LIGHT_WGSL } from './shaders/march.wgsl';
import { createSkyLayer, type SkyLayer } from './sky-layer';
import { createCirrusLayer, type CirrusLayer } from './cirrus';
import type { ProceduralDensityModel } from './procedural/types';
import { SKY_PARAM_BYTES } from './shaders/sky-layer.wgsl';
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
   * X3: the lighting model of the voxel march and the NVDF sky layer. 'nubis' (default): the N3 model (SDF depth, in-scatter profile, glow,
   * deep octaves, C1 low-sun handoff). 'octave': the per-sample Frostbite / Takram model (Wrenninge octaves, two-lobe HG, sky irradiance
   * along a height gradient, powder; LIGHTING_WGSL cloudOctaveLight). The procedural model has its own (ProceduralSettings.lightingModel).
   */
  lightingModel: 'nubis' | 'octave';
  /**
   * V2: extinction (1/m) per unit of VDB density for a direct volume (GpuCloudVolume.direct, scripts/vdb/vdb_to_direct.py), which is marched
   * as-is (native resolution, trilinear, no profile / erosion / up-rez) with the same lighting; it replaces `densityScale` while such a volume
   * is set (the light grid, shadow map and dome follow). VDB density units are arbitrary: 0.6 matches the V1 Karma reference rig. The grid's
   * fudge `lightDensityScale` (for the up-rez the grid does not see) should be 1 for a direct volume, which the grid sees exactly.
   */
  directDensity: number;
}

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
  setVolume(asset: CloudVolumeAsset | GpuCloudVolume, options: { position: [number, number, number] }): Promise<void>;
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
  /** Drop the temporal history: the next frame traces every pixel of both march passes. Call on a cut the runtime cannot see (a sky or lighting jump). */
  resetTemporal(): void;
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
  /** P9-E: the high cloud layer (cirrus, cirrostratus) at 8-10 km with its own wind, drawn behind the low clouds. Off by default; see `cirrus.settings`. */
  readonly cirrus: CirrusLayer;
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
const TEMPORAL_MODEL_INDICES = [23, 27, 32, 33, 35, 36, 37, 38, 39, 40, 41, 43, 44, 45, 47, 48, 49, 50, 51, 52, 54, 55, 56, 57, 58, 59, 72, 73, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95];
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

export function createCloudRuntime(device: GPUDevice, options: CloudRuntimeOptions = {}): CloudRuntime {
  const wantAuto = options.quality === 'auto';
  const autoPick = wantAuto ? selectTier(describeDevice(device as never, { adapter: options.adapter as never, pixels: options.expectedPixels ?? 1920 * 1080, mobile: options.mobile })) : null;
  let quality: CloudQuality = autoPick ? autoPick.tier : ((options.quality as CloudQuality | undefined) ?? 'high');
  const startPreset = CLOUD_QUALITY_PRESETS[quality];
  const dynamic = wantAuto ? new DynamicScale({ ...options.auto, budgetMs: options.auto?.budgetMs ?? options.budgetMs ?? 3 }) : null;
  const lightning = createLightning();
  const settings: CloudSettings = {
    lightning: lightning.settings,
    // Q2: extinction 0.2 -> 0.3 with the sun's optical-depth scale 1.5 -> 1.2: next to Takram and the photos the clouds read as soft, translucent
    // 'potatoes' with little self-shadow between lobes. Denser view rays give crisper edges and sculpted lobes; the lower light scale keeps bodies bright.
    densityScale: 0.3, lightDensityScale: 1.2, msStrength: 1.4, ambientStrength: 1, // P1-09 art defaults (Nubis neutral: 1, 1)
    silverStrength: 0.4, phaseG: 0.2, silverG: 0.85, ambientExtinction: 0.08, // 0.3 left bases charcoal; tuned by orchestrator sweep (P1-09)
    edgeDarkening: 0.5, glowBoost: 12, ambientSkyBias: 0.9, wispyBias: 0, glowFront: 1, deepScatter: 1.2, deepAttenuation: 0.35, ambientFloor: 0.15,
    windOffset: [0, 0, 0], windVelocity: [3, 0, 1.5], animSpeed: 1,
    mipDistanceScale: 0.002, baseMip: 0, maxSteps: startPreset.maxSteps,
    transmittanceCutoff: startPreset.transmittanceCutoff, splitDistance: startPreset.splitDistance,
    temporalNear: startPreset.temporalNear, temporalFar: startPreset.temporalFar, temporalBlend: 0.3,
    renderScale: dynamic ? dynamic.scale : 1, detailDistance: startPreset.detailDistance, farLimit: startPreset.farLimit,
    shadowStrength: 0.6, compositeShadow: 1, // shadowed ground keeps sky ambient; 0.85+ reads near-black (orchestrator review)
    noiseInvert: 0, detailTypeOverride: -1, typeFromScale: 0, microDist: startPreset.microDist, microShadow: 1, detailBias: 0, stepScale: startPreset.stepScale, // Q-1 billow self-shadowing defaults (Nubis neutral: 0, 0, 0, 1)
    fineDistance: startPreset.fineDistance, fineErosion: 1, lightDebug: 0,
    bodySunFloor: 0.05, bodySunKnee: 0.4, bodyEnv: 1, bodyDepth: 0.1, envSunWeight: 4, ambientLowSun: 1, groundAlbedo: 0.2, phaseModel: 'hg', dropletDiameter: 10, // C1 low-sun lighting
    hazeDensity: 0.05, hazeHeight: 1000, hazeBase: 0, // C2 horizon haze
    densityModel: 'nvdf', lightingModel: 'nubis',
    directDensity: 0.6,   // V2: matches the V1 Karma rig's density_mult
  };
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
  let cirrusKey: object | null = null;
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

  const skyLayer = createSkyLayer(device, volumeLayout, atmosphereLayout);
  skyLayer.settings.resolutionScale = startPreset.skyScale;
  const skyBox = { minCorner: [0, 0, 0], extent: [1, 1, 1] };
  const samplers = createVolumeSamplers(device);
  const volumeUniforms = device.createBuffer({ label: 'cloud volume uniforms', size: VOLUME_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  // P13-H1: HeroParams of the bound volume's fine overlay (unused, and the placeholders bound, when it has none).
  const heroUniforms = device.createBuffer({ label: 'cloud hero params', size: HERO_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  let heroKey = '';
  // One frame uniform per march pass (render size and pass mode differ); the composite reads the near one.
  const frameUniforms = [0, 1, 2].map(i => device.createBuffer({ label: `cloud frame uniforms ${['near', 'far', 'sky'][i]}`, size: FRAME_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
  const dummyNear = device.createTexture({ label: 'cloud dummy near', size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING });
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
  let prevValid = false, needReset = true, temporalFrames = 0, temporalResets = 0;
  const passFull = [true, true];
  let skyTarget: { w: number; h: number; color: GPUTexture; depth: GPUTexture; back: GPUTexture; scale: number } | null = null;
  // Bind groups are cached by (pass, light-grid slot, history parity, direct) and created on first use after any rebuild.
  const marchGroups: (GPUBindGroup | undefined)[] = new Array(16).fill(undefined);
  const resolveGroups: (GPUBindGroup | undefined)[] = new Array(4).fill(undefined);
  const compositeGroups: (GPUBindGroup | undefined)[] = new Array(4).fill(undefined);
  const forgetGroups = () => { marchGroups.fill(undefined); resolveGroups.fill(undefined); compositeGroups.fill(undefined); boundDepth = null; };
  let boundDepth: GPUTextureView | null = null;
  let lastTime = -1, flashPrev = false, flashLevelNow = 0;
  let autoFrames = 0;

  const makeLightGrid = () => {
    const v = volume!;
    const div = CLOUD_QUALITY_PRESETS[quality].lightGridDivisor;
    // The grid is sized from the volume dims it is given (ceil(d / 2), at least 16 per axis); a divisor shrinks them. Its shaders read the texture size, not the dims.
    const dims = div > 1 ? v.dims.map(d => Math.max(1, Math.round(d / div))) as [number, number, number] : v.dims;
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
    const near = makePass('near', preset.nearScale), far = makePass('far', preset.farScale);
    nearW = near.w; nearH = near.h; farW = far.w; farH = far.h;
    targets = [near, far];
    needReset = true;
    const sky = make('sky', skyLayer.settings.resolutionScale);
    skyTarget = { w: sky.w, h: sky.h, color: sky.color, depth: sky.depth, back: device.createTexture({ label: 'cloud sky back', size: [sky.w, sky.h], format: 'rgba16float', usage }), scale: skyLayer.settings.resolutionScale };
    ownsOutput = !externalOutput;
    output = externalOutput ?? device.createTexture({ label: 'cloud composite', size: [outCW, outCH], format: 'rgba16float', usage });
  };
  /** The trace target (this frame's fresh samples, compact) exists only while the pass runs at k > 1, sized for the rate. Recreated when the rate changes; the bind groups are rebuilt. */
  const ensureTrace = (pass: number, k: number) => {
    const t = targets![pass];
    const w = k === 4 || k === 2 ? Math.ceil(t.w / 2) : 0, h = k === 4 ? Math.ceil(t.h / 2) : k === 2 ? t.h : 0;
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
    cirrus,
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
      if (ownsVolume) volume?.destroy();
      lightGrid?.destroy();
      const external = 'extentMeters' in asset;   // a GpuCloudVolume: caller-owned
      volume = external ? asset : uploadCloudVolume(device, asset);
      ownsVolume = !external;
      lightGrid = makeLightGrid();
      forgetGroups(); domeGroups = null; needReset = true;
      device.queue.writeBuffer(volumeUniforms, 0, new Float32Array(volumeUniformData(opts.position, volume.extentMeters, volume.voxelSize)));
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
      device.queue.writeBuffer(volumeUniforms, 0, new Float32Array(volumeUniformData(opts.position, next.extentMeters, next.voxelSize)));
      for (let i = 0; i < 3; i++) skyBox.minCorner[i] = opts.position[i];
      return true;
    },
    setVolumePosition(position) {
      if (disposed || !volume) return;
      device.queue.writeBuffer(volumeUniforms, 0, new Float32Array(volumeUniformData(position, volume.extentMeters, volume.voxelSize)));
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
    resetTemporal() { needReset = true; },
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
      const uniformLighting = frame.lighting?.kind === 'uniform' ? frame.lighting : null;
      if (!uniformLighting && !frame.atmosphere) return;
      // 'auto': the controlled passes' GPU time (this frame's readback lags the encode by 2-3 frames) moves the render scale.
      if (dynamic && timer?.enabled) {
        autoFrames++;
        if (autoFrames > 20) settings.renderScale = dynamic.update(controlledCost(timer.last()));
      }
      if (skyTarget && skyTarget.scale !== skyLayer.settings.resolutionScale) {
        // Only the sky targets change; the composite groups reference them.
        skyTarget.color.destroy(); skyTarget.depth.destroy(); skyTarget.back.destroy();
        const w = Math.max(1, Math.round(outW * skyLayer.settings.resolutionScale)), h = Math.max(1, Math.round(outH * skyLayer.settings.resolutionScale));
        const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;
        skyTarget = { w, h, scale: skyLayer.settings.resolutionScale, color: device.createTexture({ label: 'cloud sky colour', size: [w, h], format: 'rgba16float', usage }), depth: device.createTexture({ label: 'cloud sky depth', size: [w, h], format: 'rgba32float', usage }), back: device.createTexture({ label: 'cloud sky back', size: [w, h], format: 'rgba16float', usage }) };
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
      const dt = lastTime < 0 ? 0 : Math.min(0.1, Math.max(0, frame.time - lastTime));
      lastTime = frame.time;
      // Wind integrates velocity * animSpeed, so changing animSpeed changes the rate and never teleports the noise.
      for (let i = 0; i < 3; i++) settings.windOffset[i] += settings.windVelocity[i] * settings.animSpeed * dt;

      // Dynamic resolution: the passes render into the top-left rectangle of their (tier-sized) textures.
      const scale = Math.min(1, Math.max(0.25, settings.renderScale));
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
      const flash = lightning.update(frame.time);
      if (flash) { f[76] = flash.position[0]; f[77] = flash.position[1]; f[78] = flash.position[2]; f[79] = flash.radius; f[80] = flash.color[0]; f[81] = flash.color[1]; f[82] = flash.color[2]; f[83] = flash.level; }
      else { f[79] = 0; f[80] = f[81] = f[82] = f[83] = 0; }
      // C1 low-sun lighting: the body terms' sun share and the environment's (sun elevation from the world-up sun direction), and the phase model.
      const sunUp = Math.max(0, Math.min(1, frame.sunDirection[1] / Math.max(1e-3, settings.bodySunKnee)));
      lowSun = 1 - sunUp;
      f[84] = settings.bodySunFloor + (1 - settings.bodySunFloor) * sunUp; f[85] = settings.bodyEnv;
      f[86] = settings.phaseModel === 'mie' ? 1 : 0; f[87] = settings.bodyDepth * (1 - sunUp);
      f[96] = settings.noiseInvert; f[97] = settings.detailTypeOverride; f[98] = settings.typeFromScale;
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
      // ---- temporal amortization (P5-B): rates, cuts, phases ----
      const rates = [snapRate(settings.temporalNear), snapRate(settings.temporalFar)];
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
      for (let pass = 0; pass < 2; pass++) {
        const k = rates[pass];
        passFull[pass] = k > 1 && (cut || lastRate[pass] !== k);   // k = 1 writes the history directly: every pixel, every frame
        lastRate[pass] = k;
        ensureTrace(pass, k);
      }
      cur ^= 1;
      for (let pass = 0; pass < 2; pass++) {
        const t = targets[pass];
        f[28] = t.rw; f[29] = t.rh; frameU32[46] = pass;
        // The jitter index counts this pass's own sweeps (every pixel traced once per k frames), so the pixels of one sweep share one IGN slice instead of a lattice-correlated hatch.
        frameU32[34] = rates[pass] > 1 ? Math.floor(temporalFrames / rates[pass]) >>> 0 : frame.frameIndex >>> 0;
        f[60] = rates[pass]; f[61] = temporalFrames % rates[pass]; f[62] = passFull[pass] ? 1 : 0; f[63] = 0;
        device.queue.writeBuffer(frameUniforms[pass], 0, f);
        resolveF32.set(prevViewProj, 0);
        resolveF32[16] = prevCam[0]; resolveF32[17] = prevCam[1]; resolveF32[18] = prevCam[2]; resolveF32[19] = prevValid && !cut ? 1 : 0;
        resolveF32[20] = Math.min(1, Math.max(0.02, flashFrame ? Math.max(settings.temporalBlend, FLASH_BLEND) : settings.temporalBlend)); resolveF32[21] = TEMPORAL_CLIP_SIGMA; resolveF32[22] = TEMPORAL_CLIP_MARGIN; resolveF32[23] = 0;
        resolveF32[24] = t.prw; resolveF32[25] = t.prh; resolveF32[26] = 0; resolveF32[27] = 0;
        device.queue.writeBuffer(resolveParams[pass], 0, resolveF32);
      }
      f[60] = 0; f[61] = 0; f[62] = 0; frameU32[34] = frame.frameIndex >>> 0;
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
      const gridStep = lightGrid.encode(encoder, volumeGroup, { sunDirection: [frame.sunDirection[0], frame.sunDirection[1], frame.sunDirection[2]], densityScale: extinction(), frameIndex: frame.frameIndex, sky: skyActive ? skyLayer.domeResources : null,
        procedural: gridProc, lightDensityScale: settings.lightDensityScale,
        procKey: gridProc ? [gridProc.version, Math.round((settings.windOffset[0] - skyBox.minCorner[0]) / 8), Math.round((settings.windOffset[2] - skyBox.minCorner[2]) / 8), Math.round(skyBox.minCorner[1] / 8)] : undefined }, timer);

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
        lightingData[28] = settings.groundAlbedo; lightingData[29] = settings.envSunWeight; lightingData[30] = lowSun * settings.ambientLowSun; lightingData[31] = 0;
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
        const direct = k === 1 || passFull[pass];
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
        ] }));
        if (!uniformLighting) march.setBindGroup(MARCH_ATMOSPHERE_GROUP, frame.atmosphere!);
        const w = t.rw, h = t.rh;
        // Only the traced pixels are dispatched: x halves for k >= 2, y for k = 4.
        const gx = direct ? w : Math.ceil(w / 2), gy = direct || k === 2 ? h : Math.ceil(h / 2);
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
        skyLayer.encode(encoder, { volumeGroup, frameBuffer: frameUniforms[2], depth: frame.depth, color: skyTarget!.color, depthOut: skyTarget!.depth, back: skyTarget!.back, atmosphere: uniformLighting ? undefined : frame.atmosphere, skyLightBuffer, box: skyBox, inverseViewProjection: frame.inverseViewProjection, cameraPosition: frame.cameraPosition, sunDirection: frame.sunDirection, timer, procedural: procOn ? proc : null, time: frame.time,
          wind: settings.windOffset, voxelDepth: { near: near.hist[cur].depth, far: far.hist[cur].depth } });
      }

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
        });
      }

      // P9-E: the high cloud layer at the composite's size; the composite merges it behind everything (in front from above it).
      cirrus.encode(encoder, { frameBuffer: frameUniforms[0], depth: frame.depth, skyLightBuffer, atmosphere: uniformLighting ? undefined : frame.atmosphere, width: outCW, height: outCH, cameraPosition: frame.cameraPosition, time: frame.time, timer });
      if (cirrus.bindKey !== cirrusKey) { cirrusKey = cirrus.bindKey; compositeGroups.fill(undefined); }
      const composite = encoder.beginComputePass({ label: 'cloud composite', timestampWrites: timer?.passTimestampWrites('composite') });
      composite.setPipeline(compositePipeline);
      composite.setBindGroup(0, volumeGroup);
      composite.setBindGroup(1, compositeGroups[gridStep.front * 2 + cur] ??= device.createBindGroup({ label: 'cloud composite', layout: compositeLayout, entries: [
        { binding: 0, resource: { buffer: frameUniforms[0] } },
        { binding: 1, resource: frame.depth },
        { binding: 2, resource: near.hist[cur].color.createView() },
        { binding: 3, resource: near.hist[cur].depth.createView() },
        { binding: 4, resource: output.createView() },
        { binding: 5, resource: far.hist[cur].color.createView() },
        { binding: 6, resource: far.hist[cur].depth.createView() },
        ...grid.bindGroupEntries(COMPOSITE_LIGHT_GRID_BINDING, gridStep.front),
        { binding: COMPOSITE_SKY_BINDING, resource: skyTarget!.color.createView() },
        { binding: COMPOSITE_SKY_BINDING + 1, resource: skyTarget!.depth.createView() },
        { binding: COMPOSITE_SKY_BINDING + 2, resource: skyTarget!.back.createView() },
        { binding: COMPOSITE_SAMPLER_BINDING, resource: compositeLinear },
        { binding: COMPOSITE_SAMPLER_BINDING + 1, resource: compositeNearest },
        ...shadowMap.bindGroupEntries(COMPOSITE_SHADOW_BINDING),
        ...cirrus.compositeEntries(COMPOSITE_CIRRUS_BINDING),
      ] }));
      composite.dispatchWorkgroups(Math.ceil(outCW / 8), Math.ceil(outCH / 8));
      composite.end();

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
      volumeUniforms.destroy(); heroUniforms.destroy(); resolveParams.forEach(b => b.destroy()); frameUniforms.forEach(b => b.destroy()); dummyNear.destroy(); skyLightBuffer.destroy();
      skyLayer.dispose(); cirrus.dispose(); shadowMap.dispose(); domeSkyDummy.destroy(); domeSkyDummyParams.destroy(); domeTexture.destroy(); domeFrameBuffer.destroy(); domeParamBuffer.destroy(); domeDepth.destroy(); domeGroups = null;
    },
  };
}
