import { describe, expect, it } from 'vitest';
import { nextCellSampleIndex, TRAVERSAL_WGSL, U32_MAX } from './index';

const cellOf = (value: number, cellSize: number) => Math.floor(value / cellSize);

describe('bounded world traversal', () => {
  it('exposes the fixed-lattice WGSL helper', () => {
    expect(TRAVERSAL_WGSL).toContain('fn nextCellSampleIndex(');
    expect(TRAVERSAL_WGSL).toContain('samplePosition: vec3f');
    expect(TRAVERSAL_WGSL).toContain('currentIndex: u32');
  });

  it('keeps every skipped midpoint in the starting cell', () => {
    const cellSize = 1;
    const ds = 0.125;
    const cases = [
      { position: [0.2, 4, 0.7] as const, ray: [1, 0, 0.2] as const },
      { position: [0.2, 4, 0.7] as const, ray: [-1, 0, -0.2] as const },
      { position: [-0.2, 4, -0.7] as const, ray: [1, 0, -0.2] as const },
      { position: [-0.2, 4, -0.7] as const, ray: [-1, 0, 0.2] as const },
      { position: [0.2, 4, 0.7] as const, ray: [0, 1, 0] as const },
    ];

    for (const { position, ray } of cases) {
      const current = 17;
      const next = nextCellSampleIndex(position, ray, cellSize, ds, current);
      const startCell = [cellOf(position[0], cellSize), cellOf(position[2], cellSize)];
      for (let offset = 1; current + offset < next; offset++) {
        const skipped = [position[0] + ray[0] * ds * offset, position[2] + ray[2] * ds * offset];
        expect([cellOf(skipped[0], cellSize), cellOf(skipped[1], cellSize)]).toEqual(startCell);
      }
      expect(next).toBeGreaterThan(current);
    }
  });

  it('does not skip the first sample after a lower-face boundary', () => {
    // floor(1) belongs to cell 1, while the negative ray immediately enters
    // cell 0. A zero-distance face must therefore advance by one only.
    expect(nextCellSampleIndex([1, 0, 0.25], [-1, 0, 0], 1, 0.1, 3)).toBe(4);
    // At the same boundary, a positive ray travels into the cell on the
    // floor-selected side and may continue to the upper face.
    expect(nextCellSampleIndex([-1, 0, -0.25], [1, 0, 0], 1, 0.1, 3)).toBe(13);
  });

  it('remains conservative for tiny and huge step sizes', () => {
    expect(nextCellSampleIndex([0.25, 0, 0.25], [1, 0, 0], 1, 1e-9, 0)).toBeLessThanOrEqual(750000000);
    expect(nextCellSampleIndex([0.25, 0, 0.25], [1, 0, 0], 1, 1e9, 0)).toBe(1);
    expect(nextCellSampleIndex([0.25, 0, 0.25], [0, 0, 0], 1, 0.1, 10)).toBe(11);
  });

  it('clamps advancement at the u32 limit', () => {
    expect(nextCellSampleIndex([0.25, 0, 0.25], [1, 0, 0], 1, 0.1, U32_MAX)).toBe(U32_MAX);
    expect(nextCellSampleIndex([0.25, 0, 0.25], [0, 0, 0], 1, 0.1, U32_MAX - 1)).toBe(U32_MAX);
  });
});
