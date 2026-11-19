// S1: the sky's look (procedural/styles.ts) on the bench. The page's own values of every key a style sets are taken once, when the sky starts
// (before the URL's overrides); a switch puts them back and applies the style's, then makes them the tuner's starting values, so the tune
// panel's amber names and resets and the URL's setting keys are relative to the style (the URL carries `style=` instead of every key).
import { PROCEDURAL_STYLES, applyProceduralStyle, captureStyleBase, styleKeys, type ProceduralStyle, type StyleTargets } from '../../../../packages/runtime/src/procedural/styles';
import type { Sources } from './url';
import { bench, settingsChanged, type Tuner } from './store';

let base: Record<string, unknown> | null = null;

const targets = (s: Sources): StyleTargets => ({ proc: s.proc, hzd: s.hzd, ndf: s.ndf, cloud: s.c });
/** The tuner's key for a style key (the renderer's settings are `c.` there). */
const tunerKeys = () => styleKeys().map(([s, k]) => `${s === 'cloud' ? 'c' : s}.${k}`);

function apply(sources: Sources, tuner: Tuner, style: ProceduralStyle): void {
  if (!base) base = captureStyleBase(targets(sources));
  applyProceduralStyle(targets(sources), style, base);
  tuner.rebase(tunerKeys());
}

/** At start, after the tuner has its starting values and before the URL's setting overrides (so `hz_...` keys in a link win over the style). */
export function startStyle(sources: Sources, tuner: Tuner, style: ProceduralStyle): void {
  base = null;
  apply(sources, tuner, style);
}

/** The sidebar's switch. */
export function setStyle(style: ProceduralStyle): void {
  const rt = bench.getState().rt;
  if (!rt || !PROCEDURAL_STYLES[style]) return;
  apply(rt.sources, rt.tuner, style);
  bench.setState({ style });
  settingsChanged({ refreshTuner: true });
}
