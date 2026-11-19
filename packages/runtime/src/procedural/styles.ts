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
    // Step e1 (work/captures/S1/early-r2): the legacy pages eroded a smooth base boundary lightly at a large scale (realism: erosion 0.7 x
    // 0.2-1.1 over a 600 m cellular noise, then a smoothstep edge; cloudscape: smooth voxel forms and a 0.16 sine). Here: the HZD Worley
    // detail (A1 'old') at a third of gp7's strength. The Nubis Cubed Alligator at 0.4 (early-r1) left a march hatch on the bared surfaces.
    hzd: { noiseSet: 'hzd', erosionStrength: 0.1 },
    // Step e6 (early-r3): the legacy march lit every sample with a constant sky ambient (cloudscape 0.28/0.34/0.43 against a 10.5 sun x HG
    // 0.45: shaded sides about 40 % of the lit ones), so its bodies read bright and cohesive. The Nubis ambient dies with the summed density
    // above to ambientFloor (0.15); 0.35 lifts the shaded body toward that. Tried and not kept: 0.6 (flat grey, shows the shape's contour
    // lines), msStrength 0.7 (no visible gain), extinction 0.4 (blurry everywhere and 2-3x the sky cost).
    cloud: { ambientFloor: 0.35 },
  },
  real: {
    label: 'photo weight',
    about: 'Aimed at the owner\'s photos: denser cores, darker greyer bases, heavier bodies, less fine surface foam; lit ridges stay crisp. First draft.',
    // Steps r3 + r3x (work/captures/S1/real-r2): the photos' cumulus have dome-scale cauliflower lobes and crisp white rims, not a fine foam.
    // HZD Worley detail at half of gp7's strength plus H7's lobe rung (one billowy octave between body and grain, 1050 m tile) gives the
    // domes; extinction 0.8 -> 1.3 gives the denser cores and the crisp rim. Tried first and not kept: the Nubis Cubed noise at 0.6
    // (real-r1: less foam but a torn, hatched surface).
    hzd: { noiseSet: 'hzd', erosionStrength: 0.15, lobeStrength: 0.6, extinction: 1.3 },
    // Step r4 (real-r3): less sky light in the shade (ambientStrength 1 -> 0.6): darker bases and shaded flanks against the same lit rims.
    // Tried and not kept: deepScatter 0.6 (darker but bluer, no clear gain), ambientSaturation 0 (no visible change: the shade's blue is the
    // atmosphere's aerial perspective, B/R 1.9 with it and 1.1 without), diffuseSun 0.3 (greyer but lighter: the opposite of heavier),
    // hazeDensity 0 (B/R 1.94 -> 1.90).
    // Steps p1, p2, p4 (work/captures/S1/real-pt), after PT1's path-traced reference (work/reports/PT1-pathtraced-reference.md): our lit faces
    // carry 1.6-1.9x the physical 4-16 px texture (multiple scattering fills the pits our sun-shadow taps shade), backlit bodies are too dark
    // (phase too weak forward) and Nubis shade too blue. p1 microShadow 1 -> 0.5: lit-face detail 0.0170 -> 0.0155 (gp7; horizon 0.0206).
    // p2 silverStrength 0.4 -> 0.65 (silver g 0.85): brighter backlit rims (sunset view), no change front-lit. p4 diffuseSun 0 -> 0.3: shade
    // B/R 1.93 -> 1.58 (greyer) and lifted 0.38 -> 0.45 luma, lit-face detail -> 0.0142. Not kept: p3 glowBoost 12 -> 0 (as a global it darkens
    // the backlit body, the opposite of PT1's finding 4; PT1 asks for no boost on thin material only, which needs a shader option).
    cloud: { ambientStrength: 0.6, microShadow: 0.5, silverStrength: 0.65, diffuseSun: 0.3 },
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
