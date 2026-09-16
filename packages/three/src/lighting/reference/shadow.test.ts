import { describe, expect, it } from 'vitest';
import { boxOccludes, intersectBox, REFERENCE_SHADOW_WGSL } from './index';

const bounds = { min: [0, 0, 0] as const, max: [1, 1, 1] as const };

describe('bounded directional shadow reference', () => {
  it('keeps parallel rays inside a slab and rejects parallel misses', () => {
    expect(intersectBox([0.5, -1, 0.5], [0, 1, 0], bounds)).toEqual([1, 2]);
    expect(intersectBox([1.5, -1, 0.5], [0, 1, 0], bounds)).toBeNull();
  });

  it('returns the line interval for an interior origin', () => {
    expect(intersectBox([0.5, 0.5, 0.5], [1, 0, 0], bounds)).toEqual([-0.5, 0.5]);
  });

  it('preserves forward and behind intervals at a box boundary', () => {
    expect(intersectBox([0, 0.5, 0.5], [1, 0, 0], bounds)).toEqual([0, 1]);
    expect(intersectBox([0, 0.5, 0.5], [-1, 0, 0], bounds)).toEqual([-1, 0]);
  });

  it('only occludes a positive-length forward ray segment', () => {
    expect(boxOccludes([-1, 0.5, 0.5], [1, 0, 0], bounds)).toBe(true);
    expect(boxOccludes([2, 0.5, 0.5], [1, 0, 0], bounds)).toBe(false);
    expect(boxOccludes([0.5, 0.5, 0.5], [1, 0, 0], bounds)).toBe(true);
    expect(boxOccludes([0, 0.5, 0.5], [1, 0, 0], bounds)).toBe(true);
    expect(boxOccludes([0, 0.5, 0.5], [-1, 0, 0], bounds)).toBe(false);
    expect(boxOccludes([1.5, -1, 0.5], [0, 1, 0], bounds)).toBe(false);
    expect(boxOccludes([0.5, 0.5, 0.5], [0, 0, 0], bounds)).toBe(false);
  });

  it('exposes matching WGSL helper names and miss sentinel', () => {
    expect(REFERENCE_SHADOW_WGSL).toContain('fn boxInterval(');
    expect(REFERENCE_SHADOW_WGSL).toContain('fn boxOccludes(');
    expect(REFERENCE_SHADOW_WGSL).toContain('vec2<f32>(1.0, -1.0)');
  });
});
