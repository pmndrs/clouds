// Weather presets: a procedural weather map recipe plus the NVDF shaping parameters, for a 512 x 512 x 64 field at 8 m voxels (4.1 km, 512 m tall).
// P9-B: `scale` is the cluster fBm (cells across the map: 2 = features of about 2 km), `coverageLo/Hi` the window of it that is cloud (see
// shaders.ts clusterAt: at 0.56 / 0.9 about a quarter of the map is gap), `cellScale` the mid cell layer (big cells at half of it, small at twice, scraps at four times).
import type { NvdfParams } from './volume-generator';
import type { ProceduralWeatherOptions } from './weather';

export type CloudPresetName = 'cumulus' | 'congestus' | 'stratocumulus' | 'storm';
export interface CloudPreset { weather: Partial<ProceduralWeatherOptions>; params: Partial<NvdfParams> }

export const CLOUD_PRESETS: Record<CloudPresetName, CloudPreset> = {
  // Fair-weather cumulus in clusters with clear gaps: humilis puffs of 100-300 m, mediocris of 0.5-1.3 km with several turrets, scraps at their rims,
  // one flat base, a slight lean downwind.
  cumulus: {
    weather: { scale: 2, cellular: 1, cellScale: 9, coverageLo: 0.56, coverageHi: 0.9, fractus: 0.6, lobeSplit: 0.8 },
    params: { topFraction: 0.65, domeExponent: 1.6, billowAmp: 0.4, billowCellMeters: 450, coverageThreshold: 0.15, baseLift: 0.03, shearX: 0.08, shearY: 0.04 },
  },
  // Towering cumulus: fewer, narrower, taller towers (height grows faster with mass), strong billows, congestus species everywhere.
  congestus: {
    weather: { scale: 1.4, cellular: 1, cellScale: 5, coverageLo: 0.56, coverageHi: 0.9, fractus: 0.5, lobeSplit: 0.9, species: 0.35 },
    params: { topFraction: 0.92, domeExponent: 1.35, billowAmp: 0.4, billowCellMeters: 400, baseDefault: 0.06, coverageThreshold: 0.1, baseLift: 0.03, shearX: 0.1, shearY: 0.05 },
  },
  // Fair-weather cumulus around a storm cell (P6-B/C): for a ~2 km tall volume read through the weather map's base/top (EvolvingCloudscapeOptions.storm
  // sets useMapHeights), scattered smaller cells; billow lobes of 160-650 m for the cell's cauliflower tower.
  storm: {
    weather: { scale: 2, cellular: 1, cellScale: 8, coverageLo: 0.56, coverageHi: 0.9, fractus: 0.5, lobeSplit: 0.6 },
    params: { topFraction: 0.65, domeExponent: 1.6, billowAmp: 0.5, billowCellMeters: 650, coverageThreshold: 0.15, baseLift: 0.03 },
  },
  // Broken stratocumulus deck: a solid carpet (0.85 of a steep cluster ramp, so the sheet is dense with gaps of about 1 km) that wide, flat-topped, low cells stand on.
  stratocumulus: {
    weather: { scale: 4, cellular: 0.15, cellScale: 9, coverageLo: 0.42, coverageHi: 0.5, border: 0.25, fractus: 0.3, lobeSplit: 0.4 },
    params: { topFraction: 0.3, domeExponent: 3.2, billowAmp: 0.22, billowCellMeters: 200, baseDefault: 0.1, coverageThreshold: 0.1, scaleBase: 0.35, shearX: 0.12, shearY: 0.03 },
  },
};
