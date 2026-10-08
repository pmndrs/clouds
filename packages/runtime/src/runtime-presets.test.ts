import { describe, expect, it } from 'vitest';
import { CLOUD_QUALITY_ORDER, CLOUD_QUALITY_PRESETS, estimateCloudMemory } from './runtime';

describe('quality tiers', () => {
  it('are ordered from the cheapest: resolution, steps and cost levers only rise', () => {
    const p = CLOUD_QUALITY_ORDER.map(q => CLOUD_QUALITY_PRESETS[q]);
    for (let i = 1; i < p.length; i++) {
      expect(p[i].nearScale).toBeGreaterThanOrEqual(p[i - 1].nearScale);
      expect(p[i].farScale).toBeGreaterThan(p[i - 1].farScale);
      expect(p[i].maxSteps).toBeGreaterThan(p[i - 1].maxSteps);
      expect(p[i].outputScale).toBeGreaterThanOrEqual(p[i - 1].outputScale);
      expect(p[i].stepScale).toBeLessThanOrEqual(p[i - 1].stepScale);
      expect(p[i].transmittanceCutoff).toBeLessThanOrEqual(p[i - 1].transmittanceCutoff);
    }
  });
  it('keep a composite scale the shaders can use: 1 or 1/2 (integer scene-to-output ratios)', () => {
    for (const q of CLOUD_QUALITY_ORDER) expect([1, 0.5]).toContain(CLOUD_QUALITY_PRESETS[q].outputScale);
  });
  it('turn the near pass off (split 0, near scale 0) together or not at all', () => {
    for (const q of CLOUD_QUALITY_ORDER) {
      const p = CLOUD_QUALITY_PRESETS[q];
      expect(p.nearScale === 0).toBe(p.splitDistance === 0);
    }
  });
});

describe('estimateCloudMemory', () => {
  it('matches the history and trace bytes the runtime reports at 2560x1440 high (24,531,540) and stays within 25 MB', () => {
    const m = estimateCloudMemory(2560, 1440, 'high');
    expect(m.history + m.trace).toBe(24_531_540);
    expect(m.history + m.trace).toBeLessThanOrEqual(25_000_000);
  });
  it('shrinks with each tier and is far below the P5-B total (63.5 MB) at high', () => {
    const totals = CLOUD_QUALITY_ORDER.map(q => { const m = estimateCloudMemory(2560, 1440, q); return m.history + m.trace; });
    for (let i = 1; i < totals.length - 1; i++) expect(totals[i]).toBeGreaterThan(totals[i - 1]);
    expect(totals[3]).toBeLessThan(63_502_800 * 0.4);
  });
  it('counts the light grid from the volume dims', () => {
    const m = estimateCloudMemory(1920, 1080, 'high', { volumeDims: [256, 256, 32] });
    expect(m.lightGrid).toBe(3 * 128 * 128 * 16 * 8);
    expect(estimateCloudMemory(1920, 1080, 'low', { volumeDims: [256, 256, 32] }).lightGrid).toBeLessThan(m.lightGrid);
  });
});
