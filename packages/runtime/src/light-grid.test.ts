import { describe, expect, it } from 'vitest';
import { LightGridScheduler, lightGridDims } from './light-grid';
import { LIGHT_GRID_BUILD_WGSL, LIGHT_GRID_PROC_STUB_WGSL, LIGHT_GRID_PROC_WGSL, lightGridWgsl } from './shaders/light-grid.wgsl';

const sunA: [number, number, number] = [0.3, 0.8, 0.2];
const rot = (deg: number): [number, number, number] => { const a = deg * Math.PI / 180; return [Math.sin(a) * 0.8 + 0.3, 0.8, 0.2]; };

describe('lightGridDims', () => {
  it('halves, rounds up, and clamps to 16', () => {
    expect(lightGridDims([108, 108, 51])).toEqual([54, 54, 26]);
    expect(lightGridDims([10, 33, 200])).toEqual([16, 17, 100]);
  });
});

describe('LightGridScheduler', () => {
  it('builds everything in the first step', () => {
    const s = new LightGridScheduler(26);
    const r = s.step(sunA, 1, 0);
    expect(r.dispatch).toMatchObject({ z0: 0, z1: 26, target: 1 });
    expect(r.swapped).toBe(true);
    expect(s.front).toBe(1);
    expect(s.step(sunA, 1, 1).dispatch).toBeNull(); // idle while the sun is unchanged
  });

  it('a sun change takes exactly 8 steps and covers every slice once', () => {
    const s = new LightGridScheduler(26);
    s.step(sunA, 1, 0);
    const sunB: [number, number, number] = [-0.5, 0.6, 0.1];
    const covered = new Array(26).fill(0);
    const swaps: boolean[] = [];
    const frontBefore = s.front;
    for (let f = 1; f <= 8; f++) {
      const r = s.step(sunB, 1, f);
      expect(r.dispatch).not.toBeNull();
      expect(r.dispatch!.target).toBe(1 - frontBefore);
      for (let z = r.dispatch!.z0; z < r.dispatch!.z1; z++) covered[z]++;
      swaps.push(r.swapped);
      if (f < 8) expect(r.front).toBe(frontBefore); // front unchanged until the last slice
    }
    expect(swaps).toEqual([false, false, false, false, false, false, false, true]);
    expect(covered.every(c => c === 1)).toBe(true);
    expect(s.front).toBe(1 - frontBefore);
    expect(s.step(sunB, 1, 9).dispatch).toBeNull();
  });

  it('ignores sun moves under 0.5 degrees', () => {
    const s = new LightGridScheduler(16);
    s.step(sunA, 1, 0);
    expect(s.step(rot(0.2), 1, 1).dispatch).toBeNull();
  });

  it('restarts at slice 0 when the sun moves mid-build', () => {
    const s = new LightGridScheduler(16);
    s.step(sunA, 1, 0);
    const sunB: [number, number, number] = [-0.5, 0.6, 0.1], sunC: [number, number, number] = [0.9, 0.2, 0.1];
    for (let f = 1; f <= 4; f++) s.step(sunB, 1, f);
    const r = s.step(sunC, 1, 5);
    expect(r.restarted).toBe(true);
    expect(r.dispatch).toMatchObject({ z0: 0, z1: 2, sun: expect.any(Array) });
    let swappedAt = 0;
    for (let f = 6; f <= 12; f++) if (s.step(sunC, 1, f).swapped) swappedAt = f;
    expect(swappedAt).toBe(12); // 5 + 7: eight steps after the restart, counting step 5
  });

  it('rebuilds on a density-scale change and on invalidate, and does not advance twice per frame', () => {
    const s = new LightGridScheduler(16);
    s.step(sunA, 1, 0);
    expect(s.step(sunA, 2, 1).dispatch).not.toBeNull();
    expect(s.step(sunA, 2, 1).dispatch).toBeNull(); // same frameIndex
    for (let f = 2; f <= 8; f++) s.step(sunA, 2, f);
    expect(s.step(sunA, 2, 9).dispatch).toBeNull();
    s.invalidate();
    expect(s.step(sunA, 2, 10).dispatch).not.toBeNull();
  });
});

describe('lightGridWgsl', () => {
  it('declares texture, sampler and the sample function at the requested bindings', () => {
    const w = lightGridWgsl(2, 5);
    expect(w).toContain('@group(2) @binding(5) var lightGridTex');
    expect(w).toContain('@group(2) @binding(6) var lightGridSampler');
    expect(w).toContain('fn lightGridSample(p: vec3<f32>) -> vec2<f32>');
  });
});

describe('light grid build: procedural clouds (X4)', () => {
  it('calls lgProcedural behind procScale, which both the stub and the model variant define with one signature', () => {
    expect(LIGHT_GRID_BUILD_WGSL).toContain('procScale: f32');
    expect(LIGHT_GRID_BUILD_WGSL).toContain('if (lgParams.procScale > 0.0) { outside += lgProcedural(p, d, minStep) * lgParams.procScale; }');
    const sig = 'fn lgProcedural(p: vec3<f32>, d: vec3<f32>, minStep: f32) -> f32';
    expect(LIGHT_GRID_PROC_STUB_WGSL).toContain(sig);
    expect(LIGHT_GRID_PROC_WGSL).toContain(sig);
    expect(LIGHT_GRID_PROC_WGSL).toContain('procSample(');   // needs the model's densityWgsl before it
  });
});
