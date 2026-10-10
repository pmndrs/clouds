import { describe, expect, it } from 'vitest';
import { defaultProceduralSettings, packProceduralParams, PROC_PARAM_FLOATS, hzdNdfKey } from '../settings';
import { PROC_PARAMS_WGSL } from '../density.wgsl';
import { HZD_GRADIENTS, hzdHeightGradient, PROC_HZD_WGSL, procShaperWgsl, procShaperBindingsWgsl } from './shaper.wgsl';
import { HZD_DETAIL_GAINS, HZD_SHAPE_GAINS, hzdNoiseBakeWgsl, worleyLadder } from './noise.wgsl';
import { HZD_NDF_SAMPLE_WGSL } from './ndf.wgsl';

describe('HZD shaper (H1)', () => {
  it('uses the shipped Nutshell gradient stops (nut s7-8) and the GP7 constants', () => {
    expect(HZD_GRADIENTS.cumulus).toEqual([0.01, 0.09, 0.65, 0.8]);
    expect(PROC_HZD_WGSL).toContain('vec4(0.04, 0.16, 0.32, 0.48)');
    expect(PROC_HZD_WGSL).toContain('A.g * 0.625 + A.b * 0.25 + A.a * 0.125');          // gp7 p.106
    expect(PROC_HZD_WGSL).toContain('hzdRemap(pw, -(1.0 - lowFbm), 1.0, 0.0, 1.0)');    // gp7 p.106 dilation (pw = R, H5 contrast off by default)
    expect(PROC_HZD_WGSL).toContain('hzdRemap(baseCloud, 1.0 - cov, 1.0, 0.0, 1.0)');   // hfw p.17 coverage sign
    expect(PROC_HZD_WGSL).toContain('saturate(h / select(P.hzExtra.z, 0.2, hag))');      // gp7 p.108 h*10 switch (wispyHeight 0.1; hag: h*5)
    expect(PROC_HZD_WGSL).toContain('select(mix(P.hzSkirt.w, P.hzExtra.y, saturate(h / P.hzExtra.z)), 0.35 * exp(-0.75 * cov), hag)'); // gp7 p.109 *0.2 = erosionStrength (hag eq 16)
  });
  it('evaluates the gradients as linear trapezoids, lerping the stops by type', () => {
    // Pure types: stratus is full only between 0.07 and 0.11, cumulus between 0.09 and 0.65 and gone at 0.80.
    expect(hzdHeightGradient(0, 0.09)).toBeCloseTo(1);
    expect(hzdHeightGradient(0, 0.2)).toBe(0);
    expect(hzdHeightGradient(1, 0.5)).toBeCloseTo(1);
    expect(hzdHeightGradient(1, 0.725)).toBeCloseTo(0.5);
    expect(hzdHeightGradient(1, 0.8)).toBe(0);
    expect(hzdHeightGradient(0.5, 0.25)).toBeCloseTo(1);               // stratocumulus plateau 0.16..0.32
    // 'points' keeps one flat core between the types; 'curves' sums two humps.
    expect(hzdHeightGradient(0.75, 0.45, 'points')).toBeCloseTo(1);    // stops (0.025, 0.125, 0.485, 0.64)
    expect(hzdHeightGradient(0.75, 0.45, 'curves')).toBeLessThan(0.8);
  });
  it('H6: topRound widens the top fall and smooth ramps keep the stops', () => {
    // Cumulus falls over 0.65..0.80 (Nutshell); topRound 0.7 starts the fall at 0.65 + (0.09 - 0.65) * 0.7 = 0.258.
    expect(hzdHeightGradient(1, 0.5)).toBeCloseTo(1);
    expect(hzdHeightGradient(1, 0.5, 'points', { topRound: 0.7 })).toBeCloseTo((0.8 - 0.5) / (0.8 - 0.258), 3);
    expect(hzdHeightGradient(1, 0.725, 'points', { smooth: true })).toBeCloseTo(0.5);
    expect(hzdHeightGradient(1, 0.8, 'curves', { topRound: 0.7, smooth: true })).toBe(0);
    expect(PROC_HZD_WGSL).toContain('let c = mix(s.z, s.y, P.hzProf.x);');
  });
  it('H6: packs the new words (defaults) and keeps every H6 term switchable', () => {
    const s = defaultProceduralSettings('hzd');
    const out = new Float32Array(PROC_PARAM_FLOATS);
    packProceduralParams(s, out);
    expect(Array.from(out.subarray(152, 156))).toEqual([1, 0.3, 0.2, 1].map(Math.fround));           // contrast, erosion 0.3, wispy 0.2, 'hfw'
    expect(Array.from(out.subarray(156, 160))).toEqual([0.7, 1, 0.4, 0.4].map(Math.fround));         // topRound, smooth, height from coverage
    expect(Array.from(out.subarray(160, 164))).toEqual([0, 0.5, 0.07, 0.08].map(Math.fround));       // density from coverage off, skirt width/density
    expect(Array.from(out.subarray(164, 168))).toEqual([0.18, 0.5, 3, 15000].map(Math.fround));
    s.hzd.erosionOrder = 'gp7'; s.hzd.veilNoise = 'shape';
    packProceduralParams(s, out);
    expect(out[155]).toBe(0);
    expect(out[168]).toBe(1);
    expect(PROC_HZD_WGSL).toContain('let be = hzdRemap(base, modifier * strength * fade, 1.0, 0.0, 1.0);');   // HFW p.15 order
  });
  it('H7: packs the skirt and wispy-bottom words; the H6 veil is one switch away', () => {
    const s = defaultProceduralSettings('hzd');
    const out = new Float32Array(PROC_PARAM_FLOATS);
    packProceduralParams(s, out);
    expect(Array.from(out.subarray(168, 172))).toEqual([0, 1, 500, 2.5].map(Math.fround));      // veil noise, skirt mode, trail (m), stretch
    expect(Array.from(out.subarray(172, 176))).toEqual([0.08, 2.5, 0.5, 0.3].map(Math.fround));  // peak, bottom curl, its downward share, wispy strength
    expect(Array.from(out.subarray(176, 180))).toEqual([3, 2, 0.5, 0.25].map(Math.fround));      // skirt scale, trail width, bottom erosion, gap
    s.hzd.skirtMode = 'veil';
    packProceduralParams(s, out);
    expect(out[169]).toBe(0);
    expect(PROC_HZD_WGSL).toContain('let skirtOn = P.hzVeil.y > 0.5;');
  });
  it('packs the HZD words and spans the shell over the layer', () => {
    const s = defaultProceduralSettings('hzd');
    const out = new Float32Array(PROC_PARAM_FLOATS);
    expect(packProceduralParams(s, out)).toEqual([1500, 5000]);
    expect(Array.from(out.subarray(120, 124))).toEqual([1500, 5000, 16000, s.hzd.extinction].map(Math.fround));
    expect(out[140]).toBeCloseTo(0.5);                 // drift: the map moves at half the wind offset
    s.hzd.ndfMotion = 'static';
    packProceduralParams(s, out);
    expect(out[140]).toBe(0);                          // static: Nubis / HZD, noise-only scroll
    expect(PROC_PARAMS_WGSL.match(/: vec4<f32>/g)!.length).toBe(PROC_PARAM_FLOATS / 4);   // the struct matches the packer
  });
  it('reads the NDF through ndfSample from a 2-layer array, and binds it as such', () => {
    expect(HZD_NDF_SAMPLE_WGSL).toContain('fn ndfSample(xz: vec2<f32>) -> NdfSample');
    expect(procShaperBindingsWgsl('hzd', 1, 9)).toContain('var procWeather: texture_2d_array<f32>');
    expect(procShaperBindingsWgsl('takram', 1, 9)).toContain('var procWeather: texture_2d<f32>');
    expect(procShaperWgsl('hzd')).toBe(PROC_HZD_WGSL);
  });
  it('re-generates the NDF only when its inputs change', () => {
    const a = defaultProceduralSettings('hzd').hzd.ndf;
    expect(hzdNdfKey({ ...a })).toBe(hzdNdfKey(a));
    expect(hzdNdfKey({ ...a, seed: a.seed + 1 })).not.toBe(hzdNdfKey(a));
    expect(hzdNdfKey({ ...a, tileMeters: 1 })).toBe(hzdNdfKey(a));   // the tile is a sampling scale, not a generator input
  });
});

describe('HZD noise bake recipe (H1)', () => {
  it('rounds the Nubis Worley ladder to integer cells per tile so every octave tiles', () => {
    expect(worleyLadder(HZD_SHAPE_GAINS[0])).toEqual([10, 19, 25, 37, 5]);
    expect(worleyLadder(HZD_SHAPE_GAINS[1])).toEqual([17, 32, 43, 63, 9]);
    expect(worleyLadder(HZD_SHAPE_GAINS[2])).toEqual([23, 44, 57, 85, 12]);
    // The detail ladder's finest octave sits at the 32^3 Nyquist limit (16 cells).
    expect(Math.max(...worleyLadder(HZD_DETAIL_GAINS[2]))).toBe(16);
  });
  it('builds the shape kernel for either texture format', () => {
    expect(hzdNoiseBakeWgsl('rgba16float')).toContain('texture_storage_3d<rgba16float, write>');
  });
});
