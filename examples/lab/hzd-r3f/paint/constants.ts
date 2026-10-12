// The painter's tools, channel labels and recipes (as the vanilla painter, ../../hzd/paint/editor.ts).
import type { BrushOp, Channel, Targets } from '../../hzd/paint/fields';

export type Tool = BrushOp | 'gradient';
export const TOOLS: [Tool, string, string][] = [
  ['paint', 'paint', 'toward each ticked channel\'s value'], ['raise', 'raise', 'add to the ticked channels'], ['lower', 'lower', 'subtract from the ticked channels'],
  ['smooth', 'smooth', 'blur under the brush'], ['smudge', 'smudge', 'drag the values along the stroke'],
  ['noise', 'noise', 'toward value x fBM: breaks up plateaus (painted plateaus turn into flat-sided slabs)'], ['restore', 'restore', 'back toward the source map'],
  ['gradient', 'gradient', 'drag a line: the values at its start, fading out at its end'],
];
export const LABEL: Record<Channel, string> = { coverage: 'coverage', topType: 'top type', bottomType: 'bottom type', minHeight: 'min height', maxHeight: 'max height' };
export const ABOUT: Record<Channel, string> = {
  coverage: 'how much cloud in the column (a mean base shape survives above about 0.38 at the default coverage; the generated map\'s p50 / p90 / p99 are 0.30 / 0.52 / 0.67)',
  topType: '0 flat stratiform top, 0.5 stratocumulus, 1 tall tiered cumulus top',
  bottomType: '0 sharp crisp base, 1 slow ragged base (read by the tables profile, the default since F2; nutshell ignores it)',
  minHeight: 'base of the column, as a fraction of the cloud layer',
  maxHeight: 'top of the column, as a fraction of the cloud layer (kept above the base)',
};
/** Brush recipes: which channels a stroke paints, and to what. Starting points by eye, not measured. */
export const RECIPES: [string, string, Targets][] = [
  ['clear', 'clear sky: coverage 0', { coverage: 0 }],
  ['stratus', 'a low flat deck: coverage 0.5, top type 0, the lowest quarter of the layer', { coverage: 0.5, topType: 0, minHeight: 0, maxHeight: 0.25 }],
  ['strato-cu', 'stratocumulus: coverage 0.5, top type 0.5, up to half the layer', { coverage: 0.5, topType: 0.5, minHeight: 0, maxHeight: 0.5 }],
  ['cumulus', 'fair-weather cumulus: coverage 0.55, top type 1, up to 0.6 of the layer', { coverage: 0.55, topType: 1, minHeight: 0, maxHeight: 0.6 }],
  ['congestus', 'towering cumulus: coverage 0.65, top type 1, the whole layer', { coverage: 0.65, topType: 1, minHeight: 0, maxHeight: 1 }],
];
export const AUTOSAVE = 'hzd-paint-autosave';
export const UI_STORE = 'hzd-paint-ui';
/** localStorage's usual quota is 5 MB per origin (UTF-16 strings count double in some browsers): the autosave stays under this. */
export const AUTOSAVE_MAX_CHARS = 2_400_000;
