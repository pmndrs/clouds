import { describe, expect, it } from 'vitest';
import { convertMeshToDensity } from './mesh';

const cube = {
  positions: new Float32Array([
    0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
    0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
  ]),
  indices: new Uint16Array([
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7,
    0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2,
  ]),
};

describe('mesh density reference converter', () => {
  it('fills a watertight indexed cube with empty padded space', () => {
    const result = convertMeshToDensity(cube, { dimensions: [9, 9, 9], padding: 0.25, softness: 0 });
    expect(result.triangleCount).toBe(12);
    expect(result.descriptor.bounds.min).toEqual([-0.25, -0.25, -0.25]);
    expect(result.data.some(value => value === 255)).toBe(true);
    expect(result.data.some(value => value === 0)).toBe(true);
  });

  it('accepts non-indexed tetrahedra and produces a softened interior', () => {
    const tetra = { positions: new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      0, 0, 0, 1, 0, 0, 0, 0, 1,
      0, 0, 0, 0, 0, 1, 0, 1, 0,
      1, 0, 0, 0, 0, 1, 0, 1, 0,
    ]) };
    const result = convertMeshToDensity(tetra, { resolution: 12, padding: 0.1, softness: 0.08 });
    expect(result.triangleCount).toBe(4);
    expect(result.data.some(value => value > 0 && value < 255)).toBe(true);
    expect(result.data.some(value => value === 0)).toBe(true);
  });

  it('applies an explicit column-major scale before bounds and sampling', () => {
    const result = convertMeshToDensity(cube, {
      dimensions: [8, 8, 8], padding: 0, softness: 0,
      transform: [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1],
    });
    expect(result.descriptor.bounds.max).toEqual([2, 3, 4]);
  });

  it('rejects malformed mesh data and non-finite options', () => {
    expect(() => convertMeshToDensity({ positions: [0, 0] }, { padding: 0, softness: 0 })).toThrow(/positions/i);
    expect(() => convertMeshToDensity(cube, { padding: -1, softness: 0 })).toThrow(/nonnegative/i);
    expect(() => convertMeshToDensity(cube, { padding: 0, softness: Number.NaN })).toThrow(/finite/i);
    expect(() => convertMeshToDensity(cube, { padding: 0, softness: 0, transform: [1,0,0,1,0,1,0,0,0,0,1,0,0,0,0,1] })).toThrow(/affine/i);
    expect(() => convertMeshToDensity({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] }, { padding: 0, softness: 0 })).toThrow(/watertight/i);
    expect(() => convertMeshToDensity(cube, { padding: 0, softness: 0, maxVertices: 3 })).toThrow(/vertex count/i);
    expect(() => convertMeshToDensity(cube, { padding: 0, softness: 0, revision: 2 ** 32 })).toThrow(/uint32/i);
    expect(() => convertMeshToDensity(cube, undefined as never)).toThrow(/options/i);
  });
});
