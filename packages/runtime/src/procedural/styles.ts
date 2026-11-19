// S1: the procedural sky's look as a switchable axis. A style is a bundle of values over settings that already exist (the HZD shaper, the
// procedural lighting, the renderer's light settings), applied on top of the page's own defaults. 'horizon' is the empty bundle: the HZD
// bench as it is (GP7 chain, Nubis Cubed erosion, Nubis lighting). The others are looks the owner asked to keep side by side
// (owner 2026-11-20, decision d1 "both, case by case"): see work/reports/S1-styles.md for what each changes and why.
//
// Applying a style never removes a method: every value here is a setting the tune panel also has, so any style can be taken apart by hand.
import type { CloudSettings } from '../runtime';
import type { HzdNdfSettings, HzdShape, ProceduralSettings } from './settings';

export type ProceduralStyle = 'horizon' | 'early' | 'real';
export const PROCEDURAL_STYLE_NAMES: readonly ProceduralStyle[] = ['horizon', 'early', 'real'];

/** Values per settings object: `proc` ProceduralSettings, `hzd` its HZD shaper, `ndf` the generated weather map, `cloud` the renderer's CloudSettings. */
export interface ProceduralStyleBundle {
  label: string;
  /** One line for a tooltip: what the style is for. */
  about: string;
  proc?: Partial<Pick<ProceduralSettings, 'densityScale' | 'lightScale' | 'profileDepth' | 'lightingModel' | 'powderScale' | 'octavePhase' | 'ambientGain' | 'octaveDiffuse'>>;
  hzd?: Partial<Omit<HzdShape, 'ndf'>>;
  ndf?: Partial<HzdNdfSettings>;
  cloud?: Partial<CloudSettings>;
}

export const PROCEDURAL_STYLES: Readonly<Record<ProceduralStyle, ProceduralStyleBundle>> = {
  horizon: {
    label: 'horizon',
    about: 'The HZD bench as it is: GPU Pro 7 density chain, Nubis Cubed erosion, Nubis lighting from the exact profile (the default).',
  },
  early: {
    label: 'early raymarch',
    about: 'The early September raymarch (legacy cloudscape / realism pages) on the same sky: soft, bright, cohesive bodies with smooth large lobes.',
  },
  real: {
    label: 'photo weight',
    about: 'Aimed at the owner\'s photos: denser cores, darker greyer bases, heavier bodies, less fine surface foam; lit ridges stay crisp. First draft.',
  },
};

export type StyleSourceId = 'proc' | 'hzd' | 'ndf' | 'cloud';
/** Every `<source>.<key>` any style sets: what has to go back to the page's own values before another style applies. */
export function styleKeys(): [StyleSourceId, string][] {
  const out = new Map<string, [StyleSourceId, string]>();
  for (const b of Object.values(PROCEDURAL_STYLES)) {
    for (const src of ['proc', 'hzd', 'ndf', 'cloud'] as const) for (const k of Object.keys(b[src] ?? {})) out.set(`${src}.${k}`, [src, k]);
  }
  return [...out.values()];
}

export type StyleTargets = Record<StyleSourceId, Record<string, unknown>>;
const copy = (v: unknown) => (Array.isArray(v) ? [...v] : v);

/** The page's own values of every key any style sets (take it once, before applying a style; `applyProceduralStyle` restores them). */
export function captureStyleBase(t: StyleTargets): Record<string, unknown> {
  return Object.fromEntries(styleKeys().filter(([s, k]) => k in t[s]).map(([s, k]) => [`${s}.${k}`, copy(t[s][k])]));
}

/** Put the page's own values back for every style key, then the style's. Returns the keys the style set (`<source>.<key>`). */
export function applyProceduralStyle(t: StyleTargets, style: ProceduralStyle, base: Record<string, unknown>): string[] {
  for (const [key, v] of Object.entries(base)) { const i = key.indexOf('.'); t[key.slice(0, i) as StyleSourceId][key.slice(i + 1)] = copy(v); }
  const b = PROCEDURAL_STYLES[style] ?? PROCEDURAL_STYLES.horizon;
  const set: string[] = [];
  for (const src of ['proc', 'hzd', 'ndf', 'cloud'] as const) {
    for (const [k, v] of Object.entries(b[src] ?? {})) {
      if (!(k in t[src])) continue;
      t[src][k] = copy(v);
      set.push(`${src}.${k}`);
    }
  }
  return set;
}

export const isProceduralStyle = (s: string | null | undefined): s is ProceduralStyle => !!s && (PROCEDURAL_STYLE_NAMES as readonly string[]).includes(s);
