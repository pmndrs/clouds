import { describe, expect, it } from 'vitest';
import { fromHalfBits, toHalfBits, toHalfBitsRoundDown } from './half';

describe('half conversion', () => {
  it('round-trips representable values', () => {
    for (const v of [0, 1, -1, 0.5, 2048, -256, 4096, 65504]) expect(fromHalfBits(toHalfBits(v))).toBe(v);
  });
  it('rounds down for conservative distances', () => {
    for (const v of [-255.7, -3.3, -0.01, 0.01, 3.3, 1000.6, 4095.9, 2049.5]) {
      const h = fromHalfBits(toHalfBitsRoundDown(v));
      expect(h).toBeLessThanOrEqual(v);
      expect(v - h).toBeLessThan(Math.max(Math.abs(v) * 2 ** -9, 2 ** -20));
    }
  });
});
