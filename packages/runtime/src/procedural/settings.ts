// X1 procedural density model: settings and defaults. Two shapers share one trace (procedural/trace.wgsl.ts) and our lighting:
//   'skypro'  Sky Pro (DRG Software Solutions, MIT, used with the author's permission): a coverage weather map and a 64^3 Perlin-Worley
//             noise dilating a height field (cloud top = weather + coverage - 1 + noise * coverage), eroded by the same noise at a smaller
//             scale. Defaults are Tidewater's "Partly cloudy" preset (tidewater/src/sky/SkyProClouds.js PRESET), not the compare pane's.
//   'takram'  The HZD 2015 per-sample model as Takram's three-clouds implements it (MIT): a weather map with one coverage channel per
//             layer, per-layer height gradients, a 128^3 Perlin-Worley shape and a 32^3 Worley detail texture, a 2D turbulence offset.
//             Defaults are Takram's CloudLayers.DEFAULT and CloudsEffect defaults (@takram/three-clouds 0.7.6).
// See procedural/NOTICE.md for the credits.

export type ProceduralShaper = 'skypro' | 'takram';

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
   * Lighting A/B: 0 = ours (LIGHTING_WGSL cloudInScatterMicro, the default), 1 = Takram's per-sample model (clouds.frag: 8 multiple-scattering
   * octaves with a two-lobe HG, a sky term of irradiance / 4 pi along a height gradient, powder), fed by the same sun and sky radiance and the
   * same optical depths. For the X1 question "shape or lighting"; not a product setting.
   */
  lighting: number;
  /** Takram's powder (lighting 1): radiance *= 1 - powderScale * exp(-extinction * 150 m). Takram default 0.8. */
  powderScale: number;
  skypro: SkyProShape;
  takram: TakramShape;
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
  coverage: 0.3, weatherTileMeters: 100000, shapeRepeat: 3e-4, detailRepeat: 6e-3, turbulenceRepeat: 20, turbulenceDisplacement: 350, detailDistance: 60000,
};

export function defaultProceduralSettings(shaper: ProceduralShaper = 'takram'): ProceduralSettings {
  return {
    shaper, stepMeters: 25, maxSteps: 256, lightTaps: 6, fullLightingAlpha: 0.5, maxDistance: 120000, densityScale: 1, lightScale: 1, profileDepth: 120, debug: 0, lighting: 0, powderScale: 0.8,
    skypro: { ...SKYPRO_DEFAULTS, windDirection: [...SKYPRO_DEFAULTS.windDirection], weatherMass: [...SKYPRO_DEFAULTS.weatherMass], weatherDetail: [...SKYPRO_DEFAULTS.weatherDetail] },
    takram: { ...TAKRAM_DEFAULTS, layers: TAKRAM_DEFAULTS.layers.map(l => ({ ...l, densityProfile: [...l.densityProfile] })) },
  };
}

/** ProcParams uniform: 32 vec4. */
export const PROC_PARAM_FLOATS = 128;
export const PROC_PARAM_BYTES = PROC_PARAM_FLOATS * 4;

/** Pack the settings into the ProcParams uniform (layout in procedural/density.wgsl.ts). Returns the shell [minY, maxY] in metres. */
export function packProceduralParams(s: ProceduralSettings, out: Float32Array): [number, number] {
  out.fill(0);
  const sp = s.skypro, tk = s.takram;
  let minY: number, maxY: number;
  if (s.shaper === 'skypro') {
    minY = sp.altitude; maxY = sp.altitude + sp.thickness * 1.3;   // the shape reads up to 1.3 shell heights (scCandidate)
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
  out.set([tk.turbulenceDisplacement, tk.detailDistance, 0, 0], 96);
  out.set([s.lighting, s.powderScale, 0, 0], 100);
  return [minY, maxY];
}
