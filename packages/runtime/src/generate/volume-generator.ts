// The NVDF generator parameters and their defaults. Deliberately free of the GPU generator (generator.ts) and its passes, so the core runtime (sky layer) reads them without pulling the generator WGSL (B2).

export interface NvdfParams {
  /** Coverage below this is empty; above it, s = (coverage - t) / (1 - t) is the smooth mass field. Default 0.12. */
  coverageThreshold: number;
  /** Read base/top height (fractions of the volume height) from the weather map B/A instead of baseDefault/topFraction. */
  useMapHeights: boolean;
  /** Flat cloud base as a fraction of the volume height. Default 0.08. */
  baseDefault: number;
  /** Height (fraction of the volume) a column of full mass reaches; lower-mass columns top out lower. Default 0.6. */
  topFraction: number;
  /** Dome law: cloud top height ~ mass^(1/p). 2 = hemispherical lobes, larger = flatter and wider, smaller = towers. Default 2. */
  domeExponent: number;
  /** Billow erosion amplitude (0 off; about 0.2 subtle, 0.45 strong). Default 0.35. */
  billowAmp: number;
  /** Largest billow cell in metres (octaves halve it). Default 320. */
  billowCellMeters: number;
  /** Rim lift of the base (fraction of the volume height): the base rises by up to this in the outermost rim of a cloud (mass < 0.12), which trims the thin skirt; under the cloud it is flat. Default 0.1. */
  baseLift: number;
  /** Wind-shear lean along x and the map row: metres the column is displaced downwind per metre above the volume base (0.1 = a 300 m cloud leans 30 m). Default 0. */
  shearX: number;
  shearY: number;
  /** Noise seed. Default 1. */
  seed: number;
  /** Density scale (NVDF B) at the cloud base and top. Defaults 0.25 / 0.85 (the fit says 0.04 / 0.75; the base is lifted, see report). */
  scaleBase: number;
  scaleTop: number;
  /** Spread of the profile around its mean depth law (PACK_FIT sigma). Default 0.64. */
  profileSigma: number;
  /** How strongly the weather map's cloud type pushes the detail type (0..1). Default 0.3. Unused with `profiles` (the species' flip height sets it). */
  detailBias: number;
  /**
   * P9-C species profiles: each column's vertical shape comes from the profile table row its weather species (G) selects (generate/shaders.ts
   * the SP_* species rows: base offset, full-mass depth in metres, top and bottom type, billow, detail flip height, density scale) instead of the global
   * topFraction / domeExponent. `baseDefault` stays the condensation level; billowAmp / billowCellMeters scale the rows' own. Default false
   * (the presets turn it on). Ignored with useMapHeights.
   */
  profiles: boolean;
  /** P9-C upper layer (altocumulus, the weather map's A with `alto`): its base and depth, metres above the volume base. 0 = off. Needs `profiles`. Moved down to fit a short volume (altoFractions). */
  altoBase: number;
  altoDepth: number;
  /**
   * P9-C2 density hand-off to the sky layer (sheets: stratus, stratocumulus): metres over which the density scale fades in from the box's side
   * walls, the complement of the sky layer's `densityFade` (pass the same value to both). 0 = off (the default; separate clouds use the hard partition).
   */
  edgeFade: number;
}

export const NVDF_DEFAULTS: NvdfParams = {
  coverageThreshold: 0.12, useMapHeights: false, baseDefault: 0.08, topFraction: 0.6, domeExponent: 2, billowAmp: 0.35, billowCellMeters: 320,
  baseLift: 0.1, shearX: 0, shearY: 0, seed: 1, scaleBase: 0.25, scaleTop: 0.85, profileSigma: 0.64, detailBias: 0.3,
  profiles: false, altoBase: 0, altoDepth: 0, edgeFade: 0,
};

/**
 * The upper layer's base and depth as fractions of a volume `heightMeters` tall (0, 0 when off). A layer that does not fit is moved down so its
 * top is at 0.95 of the volume (the tall species are clipped the same way in a short volume). The sky layer uses the same fractions.
 */
export function altoFractions(p: Pick<NvdfParams, 'altoBase' | 'altoDepth' | 'profiles'>, heightMeters: number): [number, number] {
  if (!p.profiles || !(p.altoBase > 0) || !(p.altoDepth > 0)) return [0, 0];
  const depth = Math.min(p.altoDepth, 0.4 * heightMeters);
  const base = Math.max(0.3 * heightMeters, Math.min(p.altoBase, 0.95 * heightMeters - depth));
  return [base / heightMeters, depth / heightMeters];
}

/** Jump-flood step sizes (legacy helper, not used by the exact EDT any more): n/2 .. 1 (n the next power of two >= maxDim), then `refine` extra steps (JFA+1: [1], JFA+2: [2, 1]). */
export function jfaStepSequence(maxDim: number, refine: 0 | 1 | 2 = 0): number[] {
  let n = 1;
  while (n < maxDim) n <<= 1;
  const steps: number[] = [];
  for (let s = Math.max(1, n >> 1); s >= 1; s >>= 1) steps.push(s);
  if (refine >= 2) steps.push(2);
  if (refine >= 1) steps.push(1);
  return steps;
}

/** Size of the generator's params block (shaders.ts PARAMS); the stamp rebuilder binds the same block. */
export const PARAM_BYTES = 160;
