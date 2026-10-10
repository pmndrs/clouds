// X1 procedural density model: settings and defaults. Two shapers share one trace (procedural/trace.wgsl.ts) and our lighting:
//   'skypro'  Sky Pro (DRG Software Solutions, MIT, used with the author's permission): a coverage weather map and a 64^3 Perlin-Worley
//             noise dilating a height field (cloud top = weather + coverage - 1 + noise * coverage), eroded by the same noise at a smaller
//             scale. Defaults are Tidewater's "Partly cloudy" preset (tidewater/src/sky/SkyProClouds.js PRESET), not the compare pane's.
//   'takram'  The HZD 2015 per-sample model as Takram's three-clouds implements it (MIT): a weather map with one coverage channel per
//             layer, per-layer height gradients, a 128^3 Perlin-Worley shape and a 32^3 Worley detail texture, a 2D turbulence offset.
//             Defaults are Takram's CloudLayers.DEFAULT and CloudsEffect defaults (@takram/three-clouds 0.7.6).
//   'hzd'     H1: the Horizon Zero Dawn reference path. GPU Pro 7's density chain (gp7 p.103-110) on our own bake of the HZD noise set
//             (procedural/hzd/noise.ts, Nubis noise-generator recipe) and the Nubis-era five-field NDF (work/specs/ndf.md). Values no source
//             publishes are marked "ours" below and in work/reports/H1.md.
// See procedural/NOTICE.md for the credits.

export type ProceduralShaper = 'skypro' | 'takram' | 'hzd';

/** Sky Pro's shape settings (SkyProClouds.js PRESET.shape / wind / weather). Metres unless noted. */
export interface SkyProShape {
  /** Shell base altitude and thickness. */
  altitude: number;
  thickness: number;
  /** Extinction (1/m) at density 1. */
  density: number;
  /** 0..1. The compare page maps its common coverage to this (mapCoverage.skypro). */
  coverage: number;
  /** Coverage rises by `horizonCoverageAmount` from `horizonCoverageStart` over `horizonCoverageRamp` metres along the ray. */
  horizonCoverageStart: number;
  horizonCoverageRamp: number;
  horizonCoverageAmount: number;
  /** Width of the soft surface in shell fractions, and its falloff per km of height (1 = none). */
  edgeSoftness: number;
  edgeSoftnessFalloff: number;
  /** Tile of the weather map, of the base noise, the base noise's dilation and the erosion noise's scale relative to the base. */
  weatherScale: number;
  baseScale: number;
  baseStrength: number;
  erosionScaleBaseMultiplier: number;
  /** Erosion strength at the base and at the top of a column, and its shape (0 = 1 - noise: billows, 1 = noise). */
  erosionStrengthBase: number;
  erosionStrengthPeak: number;
  erosionShape: number;
  /** Below `baseWeatherHeightEnd` (shell fraction) a column needs weather >= baseWeatherStrength: flat bases. */
  baseWeatherStrength: number;
  baseWeatherHeightStart: number;
  baseWeatherHeightEnd: number;
  /** Tops lean downwind by `windSkew` metres per shell height; `windDirection` (x, z) is normalised. */
  windSkew: number;
  windDirection: [number, number];
  /** Weather fbm (frequency, octaves, seed, contrast) of the main mass and the detail, and the weather bias. */
  weatherMass: [number, number, number, number];
  weatherDetail: [number, number, number, number];
  weatherCoverage: number;
  weatherResolution: number;
}

/** One Takram cloud layer (CloudLayer.ts). `channel` is the weather channel index (0 = r .. 3 = a). */
export interface TakramLayer {
  channel: 0 | 1 | 2 | 3;
  altitude: number;
  height: number;
  densityScale: number;
  shapeAmount: number;
  shapeDetailAmount: number;
  weatherExponent: number;
  shapeAlteringBias: number;
  coverageFilterWidth: number;
  /** densityProfile: expTerm * exp(exponent * h) + linearTerm * h + constantTerm. */
  densityProfile: [number, number, number, number];
}

export interface TakramShape {
  layers: TakramLayer[];
  /** CloudsEffect.coverage. The compare page maps its common coverage to this (mapCoverage.takram). */
  coverage: number;
  /** Metres per weather tile (Takram: localWeatherRepeat 100 over a cube-sphere face, about 100 km). */
  weatherTileMeters: number;
  /** Per-metre repeats (Takram: shapeRepeat 3e-4, shapeDetailRepeat 6e-3) and turbulence tiles per weather tile (20) and its displacement (m). */
  shapeRepeat: number;
  detailRepeat: number;
  turbulenceRepeat: number;
  turbulenceDisplacement: number;
  /** The detail erosion fades out beyond this distance (Takram gates it by a texel-footprint mip, which reaches about 100 km). */
  detailDistance: number;
  /** S6 (H1): false (default) = the turbulence displaces only the detail lookup (hzd15 s37, gp7 p.108); true = Takram's original, shape and detail. */
  turbulenceOnShape: boolean;
}

/** H1: the generated NDF (work/specs/ndf.md "Generation (until W2 lands)"): fBM coverage with islands, a very-low-frequency top type, mild height variation. */
export interface HzdNdfSettings {
  seed: number;
  /** Texels per tile edge, and metres per tile (NE p.20 uses 16 km x 16 km). */
  resolution: number;
  tileMeters: number;
  /** Coverage: a 4-octave periodic fBM from `coverageCells` cells per tile (H5: 6 -> 9, more separate bodies), plus a 2-octave island gate from `islandCells` (weight `islandWeight`),
   *  mapped linearly from coverageLo..coverageHi onto 0..1 (a gradual field: the coverage remap of noise x gradient shapes the clouds). */
  coverageCells: number;
  islandCells: number;
  islandWeight: number;
  coverageLo: number;
  coverageHi: number;
  /** Top type: a 2-octave fBM from `typeCells` cells per tile, mapped onto typeMin..typeMax. */
  typeCells: number;
  typeMin: number;
  typeMax: number;
  /** Bottom type (constant; the HZD shaper ignores it, NE table mode will read it). 0 = sharp-onset crisp base. */
  bottomType: number;
  /** Column base and top as fractions of the layer, each varied by +- heightVariation (a 2-octave fBM from 3 cells per tile). */
  minHeight: number;
  maxHeight: number;
  heightVariation: number;
}

/** H1: the HZD reference shaper (GPU Pro 7 chain). Metres unless noted. */
export interface HzdShape {
  /** The cloud layer: NDF min/max height map into it. GP7 p.119 renders a shell 1.5 km up and 3.5 km thick. */
  layerBottom: number;
  layerTop: number;
  /** Extinction (1/m) at density 1 (ours, tuned). */
  extinction: number;
  /** HZD 2015's artist override (hzd15 s38-42): coverage +-0.5 and type +-1, added to the NDF. The compare page drives coverageBias. */
  coverageBias: number;
  typeBias: number;
  /** gp7 p.107: multiply by coverage after the remap ("small clouds lighter"). The remap itself uses HFW p.17's sign (threshold 1 - coverage).
   *  H5: off by default, as HFW p.17 and hag eq 12 print the remap without it. With the multiply the density is base + coverage - 1, under 0.15
   *  at our NDF's coverage (p99 0.57), so gp7's fixed 0.2 erosion cap ate small clouds and thinned bodies to popcorn (H1's stage 2 -> 3). */
  coverageMultiply: boolean;
  /** How the three Nutshell gradients (nut s7-8) blend by type; the law is unpublished. 'points' lerps the four stops (n17.md's reading, one
   *  flat core); 'curves' is GP7 p.103's "weighted sum" with tent weights. H5: 'curves' by default (it is what GP7 p.103 writes): between the
   *  types the profile is a sum of two humps, which separates the bodies and rounds their tops (H5 step 2 captures). */
  typeBlend: 'points' | 'curves';
  /** World size of one tile of the shape (128^3), detail (32^3) and curl (128^2) textures, and the curl displacement (none published; ours).
   *  H5: shape tile 4 -> 6 km: lobes 1.5x larger and rounder (lobe/body band energy 0.21 -> 0.15; GP7 Fig 4.16 0.09); needs the cubic read. */
  shapeTile: number;
  detailTile: number;
  curlTile: number;
  curlStrength: number;
  /** The detail erosion fades out from 0.75x to 1.25x this distance (cheap-then-expensive, hzd15 s77-80). */
  detailDistance: number;
  /** Texture LOD bias (0: one output pixel's footprint per texel). */
  mipBias: number;
  /** hzd15 s35-36 base fade before erosion: density x remap(h, 0, baseFadeHeight, baseFadeMin, 1) (constants unpublished; ours). */
  baseFadeMin: number;
  baseFadeHeight: number;
  /** 'gp7': mix(fbm, 1-fbm, sat(h*10)) * 0.2 (p.108-109). 'hag': Häggström's sat(h*5) and 0.35 exp(-0.75 coverage) (hag eq 13-16). */
  erosionLaw: 'gp7' | 'hag';
  /** GP7 p.109-110 wind: tops lean `cloudTopOffset` metres along `windDirection` (x, z; normalised), and the noise rises by `upwardBias` per metre of drift. */
  windDirection: [number, number];
  cloudTopOffset: number;
  upwardBias: number;
  /** W1 (owner 2026-10-10): 'drift' (default) moves the NDF with the wind offset times `ndfDrift`, 'static' keeps it fixed (Nubis/HZD: noise-only
   *  scroll). The shape and detail noise scroll at their own speeds (gp7 p.109: "each noise its own speed"; values ours). */
  ndfMotion: 'drift' | 'static';
  ndfDrift: number;
  shapeSpeed: number;
  detailSpeed: number;
  /** Build stage, to compare with gp7 Fig 4.13 -> 4.14 -> 4.16: 1 base shape x gradient with the coverage remap; 2 + coverage multiply and base
   *  fade; 3 + detail erosion (the full chain). */
  stage: 1 | 2 | 3;
  /** Noise texture format (procedural/hzd/noise.ts): RGBA8 as HZD, or rgba16float (SD8). Changing it re-bakes the noise. */
  noiseFormat: 'rgba8unorm' | 'rgba16float';
  /** H5 (ours, not in the Nubis tool): the R channel's coarse carving remaps (10 and 20 cells per tile, 0.5 F1 / 0.2 F1) and fine dilating
   *  remaps (85 and 165 cells) scaled by these factors (1 = the tool), and the smooth-min width of R's Worley terms (0 = the tool's hard F1;
   *  > 0 rounds the creases along the Voronoi faces). Changing any re-bakes the noise. */
  noiseCarve: number;
  noiseFine: number;
  noiseSmooth: number;
  /** H5 (ours): sub-samples per texel edge of the shape bake: 1 point-samples as the tool, 2 box-filters 2x2x2 (the tool's finest terms alias). */
  noiseSupersample: number;
  /** H5: the 32^3 detail texture's recipe (procedural/hzd/noise.ts): 'nubis' = H1's multi-octave Worley (ours), 'gp7' = one inverted Worley
   *  octave per channel at 4 / 8 / 16 cells per tile (gp7 p.102 "three more Worley octaves", Fig 4.9). Changing it re-bakes. H5 default 'gp7':
   *  its channels have std 0.17 (nubis 0.10) and coarser cells, so the 0.2 erosion cuts visible billows at the edges (GP7 Fig 4.14 -> 4.16). */
  detailRecipe: 'nubis' | 'gp7';
  /** H5 (ours): the same B-spline read for the 32^3 detail texture, nearer than this (m); 0 = trilinear. */
  detailCubicDistance: number;
  /** H5 (ours; default 30 km, +0.25 ms at ultra): the shape (and, see detailCubicDistance, detail) textures are read with a tricubic B-spline (8 trilinear taps) on full samples nearer than this (m) while
   *  magnified; trilinear beyond, and everywhere at 0. Removes the terraces trilinear filtering leaves on flanks and bases (H1 "faceted flanks"). */
  shapeCubicDistance: number;
  /** H5: exponent on the final density (1 = GP7: none; ne22 p.105 sharpens its envelope with 0.27). Below 1 lifts the edge ramp: crisper rims. */
  densityPow: number;
  /** H5 (ours): contrast of the Perlin-Worley (R) about 0.5 before the dilation, R' = 0.5 + (R - 0.5) * shapeContrast (1 = the Nubis tool's
   *  R, std 0.105). The tool keeps R in [0.083, 0.917] "because of Nubis' density model" (noise.md); HZD's own range is not published. */
  shapeContrast: number;
  /** H5, hzd15 s45 (p047 diagram, s43 note): the horizon ring. From `ringStart` to `ringEnd` metres (horizontal distance from the camera) the
   *  NDF's coverage is pulled toward `ringCoverage` and its type toward `ringType` ("about 50 %", "toward cumulus": horizon clouds poke above the
   *  mountains), and nothing is drawn beyond `ringEnd` (HZD's 35 km radius). ringStart 0 = off. The pull is linear over the band (the slide
   *  shades the disc dark to light; ours). Default on (15 / 35 km); ringCoverage 0.4 is "about 50 % cover" on our NDF scale (no *cov, base mean
   *  0.62: cloud where base x gradient > 1 - coverage), ours. The last 20 % of the band fades the coverage to 0 (ours, no hard line at 35 km),
   *  and the whole ring fades out as the camera climbs from half the layer base to the base (ours: HZD is a ground-level view). */
  ringStart: number;
  ringEnd: number;
  ringCoverage: number;
  ringType: number;
  ndf: HzdNdfSettings;
}

export interface ProceduralSettings {
  shaper: ProceduralShaper;
  /** March (Sky Pro "high"): fine step floor (m; it grows with the pixel cone), step cap, light taps (1..7), and the opacity after which light taps use the cheap density. */
  stepMeters: number;
  maxSteps: number;
  lightTaps: number;
  fullLightingAlpha: number;
  /** Ray length cap (m); the density fades out over the last 20 percent. */
  maxDistance: number;
  /** Multiplier on the shaper's extinction (art knob, 1 = the source's). */
  densityScale: number;
  /** Multiplier on the optical depth the light taps see beyond the first 25 m (CloudSettings.lightDensityScale plays this role for the voxel march). */
  lightScale: number;
  /** Depth below the surface (m) over which the in-scatter probability ('profile' of our lighting) ramps from 0 to 1. */
  profileDepth: number;
  /** Debug view: 0 off, 1 step count, 2 first-hit distance, 3 profile at the first hit. */
  debug: number;
  /**
   * X3 lighting model. 'octave' (default for this model): the per-sample Frostbite / Takram model (LIGHTING_WGSL cloudOctaveLight: 8 Wrenninge
   * octaves with a two-lobe HG, the sky irradiance / 4 pi along a height gradient, powder, C1's low-sun handoff on the body octaves).
   * 'nubis': our N3 model (cloudInScatterMicro), with the depth below the surface and the in-scatter profile from proxies (`profileDepth`).
   * Both get the same sun (per altitude, with the earth's shadow), sky and optical depths.
   */
  lightingModel: 'nubis' | 'octave';
  /** Octave model: powder, radiance *= 1 - powderScale * exp(-extinction * 150 m) (Takram 0.8). */
  powderScale: number;
  /** Octave model: the two-lobe HG (forward g, back g, back-lobe weight; Takram 0.7, -0.2, 0.5) and the gain of the sky ambient (Takram 1). */
  octavePhase: [number, number, number];
  ambientGain: number;
  /**
   * Octave model: weight of the diffusion tail, an isotropic sun term falling as 1 / (1 + 0.11 tau) (two-stream diffuse transmittance), so a
   * cloud in another's shadow keeps the light that diffuses through it instead of the octaves' 5 percent (X1's "drip"). 0 = Takram's model.
   */
  octaveDiffuse: number;
  /**
   * X3 hybrid (CloudSettings.densityModel 'hybrid'): 0 (default) = density union, the procedural field continues through the voxel box and the
   * two add where they overlap. > 0: the procedural density fades out over this many metres inside the box walls, so a generated voxel field
   * replaces the procedural one there (the NVDF sky layer's hard partition, softened).
   */
  boxCarve: number;
  /** X3 hybrid: the light taps toward the sun also integrate the voxel field (heroes shade the procedural cloud beside and below them). */
  voxelShadow: boolean;
  /**
   * X4 hybrid: strength of the procedural clouds' shadow on the voxel field (0 = none, 1 = their own extinction). The voxel light grid's sun channel
   * integrates the model's density toward the sun, so a hero under a procedural cloud is shadowed by it. A number so pages can A/B it (?proc_heroShadow=0).
   */
  heroShadow: number;
  skypro: SkyProShape;
  takram: TakramShape;
  hzd: HzdShape;
}

/** Tidewater "Partly cloudy" (SkyProClouds.js PRESET, commit 4811ba4). */
export const SKYPRO_DEFAULTS: SkyProShape = {
  altitude: 4000, thickness: 5200, density: 0.019, coverage: 0.49,
  horizonCoverageStart: 20000, horizonCoverageRamp: 45000, horizonCoverageAmount: 0.12,
  edgeSoftness: 0.095, edgeSoftnessFalloff: 1, weatherScale: 29000, baseScale: 7500, baseStrength: 0.69,
  erosionScaleBaseMultiplier: 0.13, erosionStrengthBase: 0.24, erosionStrengthPeak: 2.15, erosionShape: 1,
  baseWeatherStrength: 0.54, baseWeatherHeightStart: 0, baseWeatherHeightEnd: 0.13,
  windSkew: 1750, windDirection: [0, 1],
  weatherMass: [4, 5, 0, 1.32], weatherDetail: [6, 6, 1, 0.13], weatherCoverage: 0.26, weatherResolution: 1024,
};

const takramLayer = (o: Partial<TakramLayer> & Pick<TakramLayer, 'channel'>): TakramLayer => ({
  altitude: 0, height: 0, densityScale: 0.2, shapeAmount: 1, shapeDetailAmount: 1, weatherExponent: 1, shapeAlteringBias: 0.35, coverageFilterWidth: 0.6,
  densityProfile: [0, 0, 0.75, 0.25], ...o,
});

/** Takram CloudLayers.DEFAULT and the CloudsEffect / uniforms.ts defaults. */
export const TAKRAM_DEFAULTS: TakramShape = {
  layers: [
    takramLayer({ channel: 0, altitude: 750, height: 650 }),
    takramLayer({ channel: 1, altitude: 1000, height: 1200 }),
    takramLayer({ channel: 2, altitude: 7500, height: 500, densityScale: 0.003, shapeAmount: 0.4, shapeDetailAmount: 0, coverageFilterWidth: 0.5 }),
    takramLayer({ channel: 3, densityScale: 0 }),
  ],
  coverage: 0.3, weatherTileMeters: 100000, shapeRepeat: 3e-4, detailRepeat: 6e-3, turbulenceRepeat: 20, turbulenceDisplacement: 350, detailDistance: 60000, turbulenceOnShape: false,
};

export const HZD_NDF_DEFAULTS: HzdNdfSettings = {
  seed: 3, resolution: 512, tileMeters: 16000, coverageCells: 9, islandCells: 2, islandWeight: 0.8, coverageLo: -0.47, coverageHi: 0.83,
  typeCells: 2, typeMin: 0.4, typeMax: 1, bottomType: 0, minHeight: 0, maxHeight: 0.8, heightVariation: 0.1,
};
export const HZD_DEFAULTS: HzdShape = {
  layerBottom: 1500, layerTop: 5000, extinction: 0.5, coverageBias: 0, typeBias: 0, coverageMultiply: false, typeBlend: 'curves',
  shapeTile: 6000, detailTile: 400, curlTile: 3000, curlStrength: 150, detailDistance: 40000, mipBias: 0, baseFadeMin: 0.3, baseFadeHeight: 0.2,
  erosionLaw: 'gp7', windDirection: [2, 1], cloudTopOffset: 500, upwardBias: 0.1, ndfMotion: 'drift', ndfDrift: 0.5, shapeSpeed: 1, detailSpeed: 1,
  stage: 3, noiseFormat: 'rgba8unorm', noiseCarve: 1, noiseFine: 1, noiseSmooth: 0, noiseSupersample: 1, detailRecipe: 'gp7', shapeCubicDistance: 30000, detailCubicDistance: 30000, densityPow: 1, shapeContrast: 1, ringStart: 15000, ringEnd: 35000, ringCoverage: 0.4, ringType: 1, ndf: HZD_NDF_DEFAULTS,
};
/** A deep copy of the HZD defaults. */
export const hzdDefaults = (): HzdShape => ({ ...HZD_DEFAULTS, windDirection: [...HZD_DEFAULTS.windDirection], ndf: { ...HZD_NDF_DEFAULTS } });
/** The NDF generator's inputs as a cache key: a new key re-generates the map. */
export const hzdNdfKey = (n: HzdNdfSettings) => [n.seed, n.resolution, n.coverageCells, n.islandCells, n.islandWeight, n.coverageLo, n.coverageHi, n.typeCells, n.typeMin, n.typeMax, n.bottomType, n.minHeight, n.maxHeight, n.heightVariation].join(',');

export function defaultProceduralSettings(shaper: ProceduralShaper = 'takram'): ProceduralSettings {
  return {
    shaper, stepMeters: 25, maxSteps: 256, lightTaps: 6, fullLightingAlpha: 0.5, maxDistance: 120000, densityScale: 1, lightScale: 1, profileDepth: 120, debug: 0,
    lightingModel: 'octave', powderScale: 0.8, octavePhase: [0.7, -0.2, 0.5], ambientGain: 1, octaveDiffuse: 0.5, boxCarve: 0, voxelShadow: true, heroShadow: 1,
    skypro: { ...SKYPRO_DEFAULTS, windDirection: [...SKYPRO_DEFAULTS.windDirection], weatherMass: [...SKYPRO_DEFAULTS.weatherMass], weatherDetail: [...SKYPRO_DEFAULTS.weatherDetail] },
    takram: { ...TAKRAM_DEFAULTS, layers: TAKRAM_DEFAULTS.layers.map(l => ({ ...l, densityProfile: [...l.densityProfile] })) },
    hzd: hzdDefaults(),
  };
}

/** ProcParams uniform: 37 vec4 (the last seven are the HZD shaper's). */
export const PROC_PARAM_FLOATS = 156;
/** Floats [PROC_VIEW_FLOATS[0], [1]) are written every frame (camera, wind offset): not part of the model version. */
export const PROC_VIEW_FLOATS = [108, 116] as const;
export const PROC_PARAM_BYTES = PROC_PARAM_FLOATS * 4;

/** Pack the settings into the ProcParams uniform (layout in procedural/density.wgsl.ts). Returns the shell [minY, maxY] in metres. */
export function packProceduralParams(s: ProceduralSettings, out: Float32Array): [number, number] {
  out.fill(0);
  const sp = s.skypro, tk = s.takram;
  let minY: number, maxY: number;
  const hz = s.hzd;
  if (s.shaper === 'skypro') {
    minY = sp.altitude; maxY = sp.altitude + sp.thickness * 1.3;   // the shape reads up to 1.3 shell heights (scCandidate)
  } else if (s.shaper === 'hzd') {
    minY = hz.layerBottom; maxY = Math.max(hz.layerTop, hz.layerBottom + 1);
  } else {
    const on = tk.layers.filter(l => l.height > 0 && l.densityScale > 0);
    minY = on.length ? Math.min(...on.map(l => l.altitude)) : 0;
    maxY = on.length ? Math.max(...on.map(l => l.altitude + l.height)) : 1;
  }
  out.set([minY, maxY, s.maxDistance, s.shaper === 'skypro' ? sp.coverage : tk.coverage], 0);
  out.set([s.stepMeters, s.maxSteps, Math.max(1, Math.min(7, Math.round(s.lightTaps))), s.fullLightingAlpha], 4);
  out.set([s.densityScale, s.lightScale, s.debug, s.profileDepth], 12);
  // Sky Pro (SkyProClouds.js settingsBlock): shell, shape, erosion, base, horizon, wind.
  out.set([sp.altitude, sp.thickness, sp.density, sp.coverage], 16);
  out.set([sp.weatherScale, sp.baseScale, sp.baseStrength, sp.erosionScaleBaseMultiplier], 20);
  out.set([sp.erosionStrengthBase, sp.erosionStrengthPeak, sp.erosionShape, sp.baseWeatherHeightEnd], 24);
  out.set([sp.baseWeatherStrength, sp.edgeSoftness, Math.log2(Math.max(sp.edgeSoftnessFalloff, 0.001)) * sp.thickness * 0.001, sp.baseWeatherHeightStart], 28);
  out.set([sp.horizonCoverageStart, sp.horizonCoverageRamp, sp.horizonCoverageAmount, 0], 32);
  const wl = Math.hypot(sp.windDirection[0], sp.windDirection[1]) || 1;
  out.set([sp.windDirection[0] / wl, sp.windDirection[1] / wl, sp.windSkew, 0], 36);
  // Takram (CloudLayers.packValues order, one layer per lane).
  const L = [0, 1, 2, 3].map(i => tk.layers[i] ?? takramLayer({ channel: 3, densityScale: 0 }));
  const lane = (o: number, f: (l: TakramLayer) => number) => { for (let i = 0; i < 4; i++) out[o + i] = f(L[i]); };
  lane(40, l => l.altitude); lane(44, l => l.altitude + l.height);
  lane(48, l => (l.height > 0 ? l.densityScale : 0)); lane(52, l => l.shapeAmount); lane(56, l => l.shapeDetailAmount);
  lane(60, l => l.weatherExponent); lane(64, l => l.shapeAlteringBias); lane(68, l => l.coverageFilterWidth);
  lane(72, l => l.densityProfile[0]); lane(76, l => l.densityProfile[1]); lane(80, l => l.densityProfile[2]); lane(84, l => l.densityProfile[3]);
  lane(88, l => l.channel);
  out.set([tk.weatherTileMeters, tk.shapeRepeat, tk.detailRepeat, tk.turbulenceRepeat], 92);
  out.set([tk.turbulenceDisplacement, tk.detailDistance, tk.turbulenceOnShape ? 1 : 0, 0], 96);
  out.set([s.lightingModel === 'octave' ? 1 : 0, s.powderScale, s.ambientGain, 0], 100);
  out.set([s.octavePhase[0], s.octavePhase[1], s.octavePhase[2], s.octaveDiffuse], 104);
  // 108..115: the camera and the wind offset (packProceduralView).
  out.set([Math.max(0, s.boxCarve), s.voxelShadow ? 1 : 0, Math.max(0, s.heroShadow), 0], 116);
  // H1 HZD shaper (PROC_HZD_WGSL): hzLayer, hzScale, hzCov, hzFade, hzWind, hzSpeed, hzMisc.
  out.set([hz.layerBottom, Math.max(hz.layerTop, hz.layerBottom + 1), hz.ndf.tileMeters, hz.extinction], 120);
  out.set([hz.shapeTile, hz.detailTile, hz.curlTile, hz.curlStrength], 124);
  out.set([hz.coverageBias, hz.typeBias, hz.coverageMultiply ? 1 : 0, hz.erosionLaw === 'hag' ? 1 : 0], 128);
  out.set([hz.baseFadeMin, Math.max(hz.baseFadeHeight, 1e-3), hz.detailDistance, hz.mipBias], 132);
  const hl = Math.hypot(hz.windDirection[0], hz.windDirection[1]) || 1;
  out.set([hz.windDirection[0] / hl, hz.windDirection[1] / hl, hz.cloudTopOffset, hz.upwardBias], 136);
  out.set([hz.ndfMotion === 'static' ? 0 : hz.ndfDrift, hz.shapeSpeed, hz.detailSpeed, hz.typeBlend === 'curves' ? 1 : 0], 140);
  out.set([hz.stage, hz.shapeCubicDistance, hz.densityPow, hz.detailCubicDistance], 144);
  out.set([hz.ringStart, Math.max(hz.ringEnd, hz.ringStart + 1), hz.ringCoverage, hz.ringType], 148);
  out.set([hz.shapeContrast, 0, 0, 0], 152);
  return [minY, maxY];
}

/** The per-frame part of ProcParams: the camera (curvature reference) and the wind offset. */
export function packProceduralView(camera: ArrayLike<number>, wind: ArrayLike<number>, out: Float32Array): void {
  out[108] = camera[0]; out[109] = camera[1]; out[110] = camera[2]; out[111] = 0;
  out[112] = wind[0]; out[113] = wind[1]; out[114] = wind[2]; out[115] = 0;
}
