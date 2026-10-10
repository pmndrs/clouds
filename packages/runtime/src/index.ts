// @clouds/runtime core entry: the render path (runtime, shaders, assets, quality, sky layer). Content tools are subpaths:
//   @clouds/runtime/generate  procedural volumes, presets, stamping, streaming, evolution
//   @clouds/runtime/import    .vdb import (bundles the vendored Apache-2.0 parser)
export { GpuTimer } from './gpu-timer';
export type { GpuTimerOptions } from './gpu-timer';
export { loadCloudVolume, loadCloudNoise, decodeSdf, type CloudVolumeAsset, type CloudNoiseAsset, type CloudDirectAsset } from './assets';
export { uploadCloudVolume, uploadCloudNoise, type GpuCloudVolume } from './resources';
export { uploadFineBricks, type GpuFineOverlay } from './hero/overlay';
export type { FineBricks } from './hero/bricks';
export { COMMON_WGSL } from './shaders/common.wgsl';
export { volumeWgsl, volumeUniformData, createVolumeBindGroupLayout, createVolumeBindGroup, createVolumeSamplers, heroUniformData, VOLUME_UNIFORM_BYTES, HERO_UNIFORM_BYTES, type VolumeBindingResources, type HeroBindingResources } from './shaders/volume.wgsl';
export { createLightGrid, lightGridDims, lightGridWgsl, LightGridScheduler, type LightGrid, type LightGridFrameParams } from './light-grid';
export { createCloudRuntime, estimateCloudMemory, DIRECT_VOLUME_SETTINGS, MATERIAL_SETTINGS, CLOUD_QUALITY_PRESETS, CLOUD_QUALITY_ORDER, type CloudQualityPreset, type CloudRuntime, type CloudFrame, type CloudSettings, type CloudQuality, type CloudQualityOption, type CloudMemory, type CloudUniformLighting, type CloudRuntimeOptions } from './runtime';
export { selectTier, describeDevice, controlledCost, DynamicScale, AUTO_QUALITY_DEFAULTS, AUTO_QUALITY_PASSES, type AutoQualityInfo, type AutoQualityOptions, type TierInputs, type TierPick } from './auto-quality';
export { DENSITY_WGSL } from './shaders/density.wgsl';
export { MARCH_WGSL, marchWgsl, type MarchLightingMode } from './shaders/march.wgsl';
export { LIGHTING_WGSL } from './shaders/lighting.wgsl';
export { cloudDomeWgsl, defaultDomeSettings, domeDirectionToUv, domeUvToDirection, domeTexelDirection, domeDirectionToTexel, DOME_OCT_WGSL, DOME_REFRESH_FRAMES, type CloudDome, type CloudDomeSettings } from './dome';
export { COMPOSITE_WGSL } from './shaders/composite.wgsl';
export { FRAME_WGSL, FRAME_UNIFORM_BYTES } from './shaders/frame.wgsl';
export * from './shaders/atmosphere.wgsl';
export { createSkyLayer, SKY_LAYER_DEFAULTS, type SkyLayer, type SkyLayerSettings, type SkyLayerOptions, type SkyBox } from './sky-layer';
export { skyLayerWgsl } from './shaders/sky-layer.wgsl';
export { createLightning, flashEnvelope, strokeProfile, LIGHTNING_DEFAULTS, type Lightning, type FlashOptions, type FlashState, type LightningSettings } from './lightning';
export { createCloudShadowMap, cloudShadowMapWgsl, SHADOW_MAP_DEFAULTS, type CloudShadowMap, type CloudShadowMapSettings, type ShadowMapEncodeArgs, type ShadowMapSky } from './shadow-map';
export { createCirrusLayer, CIRRUS_DEFAULTS, type CirrusLayer, type CirrusSettings, type CirrusEncodeArgs } from './cirrus';
