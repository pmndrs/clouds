// Weather presets: a procedural weather map recipe plus the NVDF shaping parameters, for a 512 x 512 x 64 field at 8 m voxels (4.1 km, 512 m tall).
import type { NvdfParams } from './volume-generator';
import type { ProceduralWeatherOptions } from './weather';

export type CloudPresetName = 'cumulus' | 'congestus' | 'stratocumulus';
export interface CloudPreset { weather: Partial<ProceduralWeatherOptions>; params: Partial<NvdfParams> }

export const CLOUD_PRESETS: Record<CloudPresetName, CloudPreset> = {
  // Scattered fair-weather cumulus: domed lobes 400-900 m wide, tops 150-300 m above a flat base.
  cumulus: {
    weather: { scale: 5, cellular: 0.75, cellScale: 9, coverageLo: 0.42, coverageHi: 0.8 },
    params: { topFraction: 0.65, domeExponent: 1.6, billowAmp: 0.4, billowCellMeters: 450, coverageThreshold: 0.15 },
  },
  // Towering cumulus: fewer, narrower, taller towers (height grows faster with mass), strong billows.
  congestus: {
    weather: { scale: 4, cellular: 0.8, cellScale: 4.5, coverageLo: 0.5, coverageHi: 0.85 },
    params: { topFraction: 0.92, domeExponent: 1.35, billowAmp: 0.4, billowCellMeters: 400, baseDefault: 0.06, coverageThreshold: 0.1 },
  },
  // Broken stratocumulus deck: wide, flat-topped, low cells with gaps.
  stratocumulus: {
    weather: { scale: 7, cellular: 0.65, cellScale: 9, coverageLo: 0.3, coverageHi: 0.62, border: 0.25 },
    params: { topFraction: 0.3, domeExponent: 3.2, billowAmp: 0.28, billowCellMeters: 200, baseDefault: 0.1, coverageThreshold: 0.1, scaleBase: 0.35 },
  },
};
