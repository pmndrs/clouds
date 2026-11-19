import { describe, expect, it } from 'vitest';
import { applySettingOverrides, isSettingKey, paneQuery, readStart, writeQuery, type Sources } from './url';

const q = (s: string) => new URLSearchParams(s);
const sources = (): Sources => ({
  proc: { lightingModel: 'octave' }, hzd: { ndfMotion: 'drift', coverageBias: 0 }, ndf: { seed: 3, tileMeters: 32000 },
  c: { animSpeed: 1, phaseModel: 'hg', windDirection: [1, 0] }, sky: { temporalBlend: true }, cirrus: { enabled: false, coverage: 0.3 }, shadow: { advect: true },
});

describe('the React bench URL', () => {
  it('opens a named view with overrides', () => {
    const s = readStart(q('view=gp7&sunel=12.5&pos=10,200,-30&fov=35&coverage=0.62&quality=high&clean=1'));
    expect(s.viewName).toBe('gp7');
    expect(s.view.pitch).toBe(25);
    expect(s.view.sunEl).toBe(12.5);
    expect(s.view.position).toEqual([10, 200, -30]);
    expect(s.view.fov).toBe(35);
    expect(s.quality).toBe('high');
    expect(s.clean).toBe(true);
  });

  it('falls back to ground and ultra for unknown values', () => {
    const s = readStart(q('view=nope&quality=extreme&refmode=sideways&pip=x'));
    expect(s.viewName).toBe('ground');
    expect(s.quality).toBe('ultra');
    expect(s.ref.mode).toBe('off');
    expect(s.ref.pip).toBe('m');
  });

  it('writes only what differs from the view, and reads it back the same', () => {
    const s = readStart(q('view=horizon'));
    s.view.sunEl = 7.3; s.view.position = [120, 40, -5]; s.view.coverage = 0.71;
    const out = writeQuery({ viewName: s.viewName, view: s.view, ref: { ...s.ref, mode: 'pip', pip: 'l', corner: 'br' }, quality: 'ultra', clean: false, changes: { 'hzd.ndfMotion': 'static', 'c.windDirection': [0.5, 1], 'sky.temporalBlend': false, 'sky.resolutionScale': 0.19999999999999998 } });
    expect(out.get('view')).toBe('horizon');
    expect(out.has('pitch')).toBe(false);
    expect(out.has('quality')).toBe(false);
    expect(out.has('refmode')).toBe(false);   // no reference: the mode is not written
    expect(out.get('pip')).toBe('l');
    expect(out.get('hz_ndfMotion')).toBe('static');
    expect(out.get('c_windDirection')).toBe('0.5,1');
    expect(out.get('sky_temporalBlend')).toBe('0');
    expect(out.get('sky_resolutionScale')).toBe('0.2');
    const back = readStart(out);
    expect(back.view).toEqual(s.view);
  });

  it('keeps settings out of the pane query and applies them to the live settings', () => {
    const query = q('view=ground&hz_ndfMotion=static&hzn_seed=9&c_windDirection=2,1&cirrus=1&phase=mie&motion=0&sky_temporalBlend=0&hzn_nope=1');
    expect([...paneQuery(query, 'ultra').keys()]).toEqual(['view', 'motion', 'quality']);   // motion is the page's own key, as in the vanilla bench
    expect(isSettingKey('cirrus_coverage')).toBe(true);
    const src = sources();
    applySettingOverrides(query, src);
    expect(src.hzd.ndfMotion).toBe('static');
    expect(src.ndf.seed).toBe(9);
    expect(src.c.windDirection).toEqual([2, 1]);
    expect(src.c.animSpeed).toBe(0);
    expect(src.c.phaseModel).toBe('mie');
    expect(src.cirrus.enabled).toBe(true);
    expect(src.sky.temporalBlend).toBe(false);
    expect('nope' in src.ndf).toBe(false);
  });

  it('S1: reads and writes the style (horizon is the default and is not written)', () => {
    expect(readStart(q('view=gp7')).style).toBe('horizon');
    expect(readStart(q('view=gp7&style=nope')).style).toBe('horizon');
    const s = readStart(q('view=gp7&style=early'));
    expect(s.style).toBe('early');
    const w = writeQuery({ viewName: s.viewName, view: s.view, ref: s.ref, quality: s.quality, clean: s.clean, changes: {}, style: s.style });
    expect(w.get('style')).toBe('early');
    expect(writeQuery({ viewName: s.viewName, view: s.view, ref: s.ref, quality: s.quality, clean: s.clean, changes: {}, style: 'horizon' }).has('style')).toBe(false);
  });
});
