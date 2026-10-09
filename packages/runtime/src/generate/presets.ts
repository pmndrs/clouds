// Weather presets: a procedural weather map recipe plus the NVDF shaping parameters, for a 512 x 512 x 64 field at 8 m voxels (4.1 km, 512 m tall)
// unless the preset names a taller `volume`.
// P9-B: `scale` is the cluster fBm (cells across the map: 2 = features of about 2 km), `coverageLo/Hi` the window of it that is cloud (see
// shaders.ts clusterAt: at 0.56 / 0.9 about a quarter of the map is gap), `cellScale` the mid cell layer (big cells at half of it, small at twice, scraps at four times).
// P9-C: every preset but `storm` uses the species profile table (`profiles`): `speciesRange` picks the rows the regional species field spans
// (0 stratus, 0.25 stratocumulus, 0.5 humilis, 0.75 mediocris, 1 congestus; generate/shaders.ts the SP_* species rows and the H_* rows), and the rows set each
// cloud's base, height law, billow and detail. `baseDefault` is the condensation level. `wind` (weather) and `shearX/Y` (shape) point the same way.
import type { NvdfParams } from './volume-generator';
import type { ProceduralWeatherOptions } from './weather';

export type CloudPresetName = 'cumulus' | 'humilis' | 'mediocris' | 'congestus' | 'stratocumulus' | 'altocumulus' | 'stratus' | 'mixed' | 'storm';
export interface CloudPreset {
  weather: Partial<ProceduralWeatherOptions>;
  params: Partial<NvdfParams>;
  /**
   * The volume the preset is shaped for, when it is not the default 512 x 512 x 64 at 8 m. The tall species (mediocris 0.8 km, congestus 1.8 km,
   * an altocumulus layer at 1.4 km) are clipped to the volume's height in a 512 m one. Informational: the caller sizes the generator.
   */
  volume?: { dims: [number, number, number]; voxelSize: number };
}

/** 6.1 x 6.1 km, 2 km tall, 16 m voxels (the storm scene's height): room for congestus towers and an altocumulus layer above the cumulus. */
const TALL: CloudPreset['volume'] = { dims: [384, 384, 128], voxelSize: 16 };
// baseLift is a fraction of the volume height: the tall presets use 0.008 (16 m of rim curl, as 0.03 of a 512 m volume), so the base stays one level.
// Their lean is half the low presets' (0.05 m/m: a 1.6 km tower leans 80 m), else the overhang of the towers reads as a ragged base from below.

export const CLOUD_PRESETS: Record<CloudPresetName, CloudPreset> = {
  // Fair-weather cumulus in clusters with clear gaps: humilis puffs and mediocris of 0.5-1.3 km with several turrets (the species field spans
  // humilis to mediocris), scraps at their rims, one flat base, a slight lean downwind. Cover 30-40 percent (P9-C; P9-B left it at 22).
  cumulus: {
    weather: { scale: 2, cellular: 1, cellScale: 10, coverageLo: 0.42, coverageHi: 0.82, fractus: 0.6, lobeSplit: 0.8, speciesRange: [0.55, 0.78], wind: [2, 1] },
    params: { profiles: true, baseDefault: 0.08, billowAmp: 0.4, billowCellMeters: 450, coverageThreshold: 0.15, baseLift: 0.03, shearX: 0.08, shearY: 0.04 },
  },
  // Cumulus humilis only: small, flat puffs, wider than tall, many of them.
  humilis: {
    weather: { scale: 2.5, cellular: 1, cellScale: 12, coverageLo: 0.48, coverageHi: 0.84, fractus: 0.5, lobeSplit: 0.4, speciesRange: [0.5, 0.5], wind: [2, 1] },
    params: { profiles: true, baseDefault: 0.08, billowAmp: 0.4, billowCellMeters: 450, coverageThreshold: 0.15, baseLift: 0.03, shearX: 0.06, shearY: 0.03 },
  },
  // Cumulus mediocris only: domes about as tall as they are wide.
  mediocris: {
    weather: { scale: 1.6, cellular: 1, cellScale: 9, coverageLo: 0.5, coverageHi: 0.86, fractus: 0.5, lobeSplit: 0.7, speciesRange: [0.75, 0.75], wind: [2, 1] },
    params: { profiles: true, baseDefault: 0.08, billowAmp: 0.4, billowCellMeters: 450, coverageThreshold: 0.15, baseLift: 0.008, shearX: 0.045, shearY: 0.022 },
    volume: TALL,
  },
  // Towering cumulus: fewer, narrower, much taller towers with turrets (each mass bump of a cell is its own turret under the tower law).
  congestus: {
    weather: { scale: 1.4, cellular: 1, cellScale: 6, coverageLo: 0.56, coverageHi: 0.9, fractus: 0.5, lobeSplit: 0.9, speciesRange: [0.88, 1], wind: [2, 1] },
    params: { profiles: true, baseDefault: 0.06, billowAmp: 0.4, billowCellMeters: 400, coverageThreshold: 0.1, baseLift: 0.008, shearX: 0.045, shearY: 0.022 },
    volume: TALL,
  },
  // Fair-weather cumulus around a storm cell (P6-B/C): for a ~2 km tall volume read through the weather map's base/top (EvolvingCloudscapeOptions.storm
  // sets useMapHeights), scattered smaller cells; billow lobes of 160-650 m for the cell's cauliflower tower. No profile table (the map carries the heights).
  storm: {
    weather: { scale: 2, cellular: 1, cellScale: 8, coverageLo: 0.56, coverageHi: 0.9, fractus: 0.5, lobeSplit: 0.6 },
    params: { topFraction: 0.65, domeExponent: 1.6, billowAmp: 0.5, billowCellMeters: 650, coverageThreshold: 0.15, baseLift: 0.03 },
  },
  // Stratocumulus: a lumpy sheet broken into long bands along the wind with gaps between them, flat-topped lumps stretched 3:1 along the wind,
  // sheared (the lean is the strongest of the presets).
  stratocumulus: {
    weather: { scale: 3, cellular: 1, cellScale: 9, coverageLo: 0.56, coverageHi: 0.68, border: 0.25, fractus: 0.3, lobeSplit: 0.4, speciesRange: [0.25, 0.25], wind: [1, 0.25] },
    params: { profiles: true, baseDefault: 0.1, billowAmp: 0.4, billowCellMeters: 400, coverageThreshold: 0.1, baseLift: 0.03, scaleBase: 0.35, shearX: 0.14, shearY: 0.035 },
  },
  // Altocumulus: no low cloud; a high layer of small, regularly spaced cells in patches and bands (the weather's upper layer at 1.4 km).
  altocumulus: {
    weather: { scale: 2, cellular: 1, cellScale: 9, coverageLo: 2, coverageHi: 3, fractus: 0, speciesRange: [0.5, 0.5], wind: [2, 1], alto: { cover: 1, cells: 18, patches: 1.2, jitter: 0.3 } },
    params: { profiles: true, baseDefault: 0.08, billowAmp: 0.4, billowCellMeters: 450, coverageThreshold: 0.15, baseLift: 0.008, shearX: 0.045, shearY: 0.022, altoBase: 1400, altoDepth: 180 },
    volume: TALL,
  },
  // Stratus: one flat, featureless grey layer with a soft base (a valley sea with the generator's `terrain`).
  stratus: {
    weather: { scale: 1.5, cellular: 1, cellScale: 6, coverageLo: 0.2, coverageHi: 0.45, border: 0.2, fractus: 0, lobeSplit: 0, speciesRange: [0, 0], wind: [2, 1] },
    params: { profiles: true, baseDefault: 0.25, billowAmp: 0.4, billowCellMeters: 450, coverageThreshold: 0.1, baseLift: 0.01, scaleBase: 0.5, shearX: 0.02, shearY: 0.01 },
  },
  // A mixed sky (T1/T4): stratocumulus, humilis, mediocris and congestus regions in one cumulus layer, under altocumulus patches at 1.4 km.
  mixed: {
    weather: { scale: 1.6, cellular: 1, cellScale: 8, coverageLo: 0.52, coverageHi: 0.88, fractus: 0.5, lobeSplit: 0.8, speciesRange: [0.2, 1], wind: [2, 1], alto: { cover: 0.7, cells: 18, patches: 1.4, jitter: 0.35 } },
    params: { profiles: true, baseDefault: 0.08, billowAmp: 0.4, billowCellMeters: 450, coverageThreshold: 0.15, baseLift: 0.008, shearX: 0.045, shearY: 0.022, altoBase: 1400, altoDepth: 180 },
    volume: TALL,
  },
};
