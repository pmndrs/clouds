import { describe, expect, it } from 'vitest';
import { defaultProceduralSettings } from './settings';
import { PROCEDURAL_STYLES, PROCEDURAL_STYLE_NAMES, applyProceduralStyle, captureStyleBase, styleKeys, type StyleTargets } from './styles';

const targets = (): StyleTargets => {
  const p = defaultProceduralSettings('hzd');
  // A stand-in for the renderer's CloudSettings: every cloud key a style sets, at a recognisable value.
  const cloud: Record<string, unknown> = {};
  for (const [s, k] of styleKeys()) if (s === 'cloud') cloud[k] = -1;
  return { proc: p as unknown as Record<string, unknown>, hzd: p.hzd as unknown as Record<string, unknown>, ndf: p.hzd.ndf as unknown as Record<string, unknown>, cloud };
};
const snap = (t: StyleTargets) => JSON.parse(JSON.stringify(t));

describe('procedural styles', () => {
  it('horizon is the page as it is (no key changes)', () => {
    expect(PROCEDURAL_STYLES.horizon.proc ?? {}).toEqual({});
    expect(PROCEDURAL_STYLES.horizon.hzd ?? {}).toEqual({});
    expect(PROCEDURAL_STYLES.horizon.ndf ?? {}).toEqual({});
    expect(PROCEDURAL_STYLES.horizon.cloud ?? {}).toEqual({});
    const t = targets(), before = snap(t);
    const base = captureStyleBase(t);
    expect(applyProceduralStyle(t, 'horizon', base)).toEqual([]);
    expect(snap(t)).toEqual(before);
  });

  it('every style key exists in the settings it targets', () => {
    const p = defaultProceduralSettings('hzd');
    const known = { proc: p, hzd: p.hzd, ndf: p.hzd.ndf } as Record<string, object>;
    for (const [s, k] of styleKeys()) if (s !== 'cloud') expect(k in known[s], `${s}.${k}`).toBe(true);
  });

  it('switching styles and back restores the page values exactly', () => {
    const t = targets(), before = snap(t);
    const base = captureStyleBase(t);
    for (const s of PROCEDURAL_STYLE_NAMES) applyProceduralStyle(t, s, base);
    applyProceduralStyle(t, 'early', base);
    applyProceduralStyle(t, 'horizon', base);
    expect(snap(t)).toEqual(before);
  });
});
