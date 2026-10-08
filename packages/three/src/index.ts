// @clouds/three — three.js (WebGPU) adapter for @clouds/runtime. See work/specs/P2-api.md.
export { Clouds, type CloudsOptions, type CloudsLoadOptions, type SetVolumeOptions } from './clouds';
export { createSkyBridge, type SkyBridge, type SkyBridgeOptions } from './sky-bridge';
export { createUniformLighting, DEFAULT_UNIFORM_LIGHTING, type UniformLighting, type UniformLightingValues } from './uniform-lighting';
export { sharedBackend, toHalfBits, type SharedBackend } from './interop';
import type { CloudQuality } from '@clouds/runtime';
export type { AutoQualityInfo, AutoQualityOptions, CloudMemory, CloudQuality, CloudQualityOption, CloudSettings, CloudVolumeAsset, GpuCloudVolume } from '@clouds/runtime';
/** Every quality tier, cheapest first (`'ultra'` is the 0.5x / 1024-step reference preset). The `quality` option also takes `'auto'`. */
export const CLOUD_QUALITIES = ['mobile', 'low', 'medium', 'high', 'ultra'] as const satisfies readonly CloudQuality[];
