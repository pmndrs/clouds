/** Preview API. Three r186 / conventional WebGPU depth; the host owns the frame loop. */
export const CLOUDS_THREE_REVISION = '0.186.0';
export { createCloudscape } from './cloudscape';
export type Cloudscape = ReturnType<typeof import('./cloudscape').createCloudscape>;
export type CloudscapeSettings = Cloudscape['settings'];
export { createCloudWorld, CLOUD_WORLD_DEFAULTS } from './world';
export type { CloudWorld, WorldOptions, WorldSnapshot, WorldCell } from './world';
export { createCloudscapeAtlas } from './sources/cloudscape-atlas';
export type { CloudscapeAtlas } from './sources/cloudscape-atlas';
export { createDensityField, DEFAULT_DENSITY_BOUNDS, DEFAULT_DENSITY_RESOLUTION, DEFAULT_EXTINCTION_SCALE } from './sources';
export type { DenseDensityField, DensityPreset } from './sources';
export { createReferenceCloud, referenceGroundReceiver } from './volumetric';
export type { ReferenceCloudSettings } from './volumetric';
export type ReferenceCloud = ReturnType<typeof import('./volumetric').createReferenceCloud>;

export { createCloudLayerField, CLOUD_LAYER_BOUNDS, summarizeCloudLayerField, type CloudLayerFieldOptions, type CloudLayerFieldStatistics } from './sources/cloud-layer';
export { createMorphologyNoise, type MorphologyNoiseOptions, type MorphologyNoiseResources } from './sources/morphology-noise';
export { createMorphologyCloud, MORPHOLOGY_BOUNDS } from './volumetric/morphology';
