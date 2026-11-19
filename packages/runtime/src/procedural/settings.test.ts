import { describe, expect, it } from 'vitest';
import { defaultProceduralSettings, packProceduralParams, PROC_PARAM_FLOATS } from './settings';

describe('procedural settings (X1)', () => {
  it('packs the Takram layers lane by lane and spans the shell over the used layers', () => {
    const s = defaultProceduralSettings('takram');
    const out = new Float32Array(PROC_PARAM_FLOATS);
    const shell = packProceduralParams(s, out);
    expect(shell).toEqual([750, 8000]);   // 750 m (layer 0) to 7500 + 500 m (the cirrus layer); the unused 4th lane is ignored
    expect(Array.from(out.subarray(40, 44))).toEqual([750, 1000, 7500, 0]);
    expect(out[48 + 3]).toBe(0);           // no density in the unused lane
    expect(out[3]).toBeCloseTo(0.3);       // Takram's coverage
  });
  it('spans the Sky Pro shell to 1.3 thicknesses (its shape reads up to h = 1.3)', () => {
    const s = defaultProceduralSettings('skypro');
    const out = new Float32Array(PROC_PARAM_FLOATS);
    expect(packProceduralParams(s, out)).toEqual([4000, 4000 + 5200 * 1.3]);
    expect(out[16 + 2]).toBeCloseTo(0.019);
  });
  it('packs the hybrid words: box carve, voxel shadow, hero shadow (X4, P.hybrid.z)', () => {
    const s = defaultProceduralSettings('takram');
    const out = new Float32Array(PROC_PARAM_FLOATS);
    packProceduralParams(s, out);
    expect(Array.from(out.subarray(116, 120))).toEqual([0, 1, 1, 3]);   // defaults: union, voxels in the light taps, full hero shadow; S2 surface bisection 3
    Object.assign(s, { boxCarve: 400, voxelShadow: false, heroShadow: 0.5, surfaceRefine: 0 });
    packProceduralParams(s, out);
    expect(Array.from(out.subarray(116, 120))).toEqual([400, 0, 0.5, 0]);
  });
  it('packs the S2 surface bisection words in their lanes (refine steps, growth, sample mode, hard-entry gate)', () => {
    const s = defaultProceduralSettings('hzd');
    const out = new Float32Array(PROC_PARAM_FLOATS);
    packProceduralParams(s, out);
    expect([out[119], out[99], out[35], out[39]]).toEqual([3, 1, 1, 0]);
    Object.assign(s, { surfaceRefine: 20, surfaceGrow: false, surfaceRefineMode: 0, surfaceRefineTau: 0.5 });
    packProceduralParams(s, out);
    expect([out[119], out[99], out[35], out[39]]).toEqual([8, 0, 0, 0.5]);   // refine steps clamped to 8
  });
});
