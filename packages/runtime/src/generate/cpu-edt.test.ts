import { describe, expect, it } from 'vitest';
import { signedDistanceCpu } from './cpu-edt';
import { jfaStepSequence } from './volume-generator';

describe('signedDistanceCpu', () => {
  it('matches a brute-force distance on a random mask', () => {
    const dims: [number, number, number] = [9, 7, 5];
    const n = dims[0] * dims[1] * dims[2];
    const mask = new Uint8Array(n);
    let s = 12345;
    for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; mask[i] = (s >>> 28) < 3 ? 1 : 0; }
    mask[0] = 1; mask[n - 1] = 0;
    const sdf = signedDistanceCpu(mask, dims, 8);
    const at = (i: number) => [i % 9, Math.floor(i / 9) % 7, Math.floor(i / 63)];
    for (let i = 0; i < n; i++) {
      let best = Infinity;
      for (let j = 0; j < n; j++) if (mask[j] !== mask[i]) { const a = at(i), b = at(j); best = Math.min(best, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])); }
      const expected = (mask[i] ? -1 : 1) * Math.max(0, best - 0.5) * 8;
      expect(sdf[i]).toBeCloseTo(expected, 3);
    }
  });
});

describe('jfaStepSequence', () => {
  it('halves from half the largest power of two, then refines', () => {
    expect(jfaStepSequence(256, 0)).toEqual([128, 64, 32, 16, 8, 4, 2, 1]);
    expect(jfaStepSequence(300, 2)).toEqual([256, 128, 64, 32, 16, 8, 4, 2, 1, 2, 1]);
    expect(jfaStepSequence(1, 0)).toEqual([1]);
  });
});
