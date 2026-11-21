import { describe, expect, it } from 'vitest';
import { convergedSubPixel } from './shaders/converged.wgsl';
import { convergedRows } from './sky-layer';

describe('P0.5 converged march helpers', () => {
  it('bands cover every row once, on multiples of 8', () => {
    for (const [h, n] of [[720, 4], [720, 8], [541, 3], [7, 4], [1080, 1]] as const) {
      const rows = Array.from({ length: n }, (_, b) => convergedRows(h, b, n));
      expect(rows[0][0]).toBe(0);
      expect(rows[n - 1][1]).toBe(h);
      for (let b = 1; b < n; b++) { expect(rows[b][0]).toBe(rows[b - 1][1]); expect(rows[b][0] % 8).toBe(0); }
    }
  });
  it('sub-pixel offsets are a one-pixel box, well spread (Halton 2, 3)', () => {
    const pts = Array.from({ length: 16 }, (_, i) => convergedSubPixel(i));
    for (const [x, y] of pts) { expect(x).toBeGreaterThanOrEqual(-0.5); expect(x).toBeLessThan(0.5); expect(y).toBeGreaterThanOrEqual(-0.5); expect(y).toBeLessThan(0.5); }
    const mean = pts.reduce((m, [x, y]) => [m[0] + x / 16, m[1] + y / 16], [0, 0]);
    expect(Math.abs(mean[0])).toBeLessThan(0.05);
    expect(Math.abs(mean[1])).toBeLessThan(0.05);
    // every quadrant of the pixel gets samples
    for (const [sx, sy] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) expect(pts.some(([x, y]) => Math.sign(x) === sx && Math.sign(y) === sy)).toBe(true);
  });
});
