// W2: the NDF blend math, in plain TypeScript. The GPU does the same per texel in HZD_NDF_COMPOSE_WGSL (hzd/ndf.wgsl.ts); this is the
// reference the unit test checks and the bench's CPU previews can share. All values 0..1 (the NDF's normalised bytes).
const sat = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const mixf = (a: number, b: number, t: number) => a + (b - a) * t;

/** One NDF column (the five fields). */
export interface NdfColumn { coverage: number; topType: number; bottomType: number; minHeight: number; maxHeight: number }

/** The influence mask's effect on one field: the painted value over the generated one, `mask` x `gain` clamped to 0..1 (0 = generated, 1 = painted). */
export const influence = (generated: number, painted: number, mask: number, gain = 1): number => mixf(generated, painted, sat(mask * gain));

/** W2 weather: a state's additive art biases on a generated column (HZD 2015's coverage +-0.5 and type +-1, hzd15 s38-42, as NDF-level offsets). */
export function biasColumn(c: NdfColumn, coverageBias: number, typeBias: number): NdfColumn {
  return { ...c, coverage: sat(c.coverage + coverageBias), topType: sat(c.topType + typeBias) };
}

/** Lerp two columns (the two-state transition, per texel). The heights keep the top at least 1/255 above the base. */
export function lerpColumn(a: NdfColumn, b: NdfColumn, t: number): NdfColumn {
  const minHeight = mixf(a.minHeight, b.minHeight, t);
  return { coverage: mixf(a.coverage, b.coverage, t), topType: mixf(a.topType, b.topType, t), bottomType: mixf(a.bottomType, b.bottomType, t), minHeight, maxHeight: Math.max(mixf(a.maxHeight, b.maxHeight, t), Math.min(minHeight + 1 / 255, 1)) };
}

export interface PaintGains { coverage: number; types: number; heights: number }

/**
 * The served column: the generated column (a state, or the lerp of two) with the painted column blended over it by `mask`.
 * `replace` ignores the mask (mask 1 everywhere: W1's behaviour). `paintedHeights` false leaves the heights generated (no height image).
 */
export function composeColumn(gen: NdfColumn, painted: NdfColumn | null, mask: number, mode: 'replace' | 'influence', gains: PaintGains, paintedHeights = true): NdfColumn {
  if (!painted) return gen;
  const m = mode === 'replace' ? 1 : mask;
  const minHeight = influence(gen.minHeight, painted.minHeight, paintedHeights ? m : 0, gains.heights);
  return {
    coverage: influence(gen.coverage, painted.coverage, m, gains.coverage),
    topType: influence(gen.topType, painted.topType, m, gains.types),
    bottomType: influence(gen.bottomType, painted.bottomType, m, gains.types),
    minHeight,
    maxHeight: Math.max(influence(gen.maxHeight, painted.maxHeight, paintedHeights ? m : 0, gains.heights), Math.min(minHeight + 1 / 255, 1)),
  };
}
