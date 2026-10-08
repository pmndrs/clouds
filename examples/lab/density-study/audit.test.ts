import { describe, expect, it } from 'vitest';
import { createCloudscapeAtlas } from '../../../packages/three/src/sources/cloudscape-atlas';
import type { DenseDensityField } from '../../../packages/three/src/sources/density';
import { coarsenDensityField, extractAtlasField } from './audit';

describe('density audit field preparation', () => {
  it('extracts every packed atlas tile without changing voxel order', () => {
    const atlas = createCloudscapeAtlas(48);
    for (let tile = 0; tile < 8; tile++) {
      const field = extractAtlasField(tile);
      const tileX = tile & 1, tileY = (tile >> 1) & 1, tileZ = (tile >> 2) & 1;
      for (const z of [0, 1, 23, 47]) for (const y of [0, 17, 47]) for (const x of [0, 9, 47]) {
        const local = x + y * 48 + z * 48 * 48;
        const packed = (tileX * 48 + x) + (tileY * 48 + y) * 96 + (tileZ * 48 + z) * 96 * 96;
        expect(field.data[local]).toBe(atlas.data[packed]);
      }
    }
  });

  it('averages X/Z pairs while preserving Y', () => {
    const dimensions: [number, number, number] = [4, 2, 4];
    const data = new Uint8Array(dimensions[0] * dimensions[1] * dimensions[2]);
    for (let z = 0; z < dimensions[2]; z++) for (let y = 0; y < dimensions[1]; y++) for (let x = 0; x < dimensions[0]; x++) {
      data[x + y * 4 + z * 8] = x + 10 * y + 40 * z;
    }
    const source: DenseDensityField = { descriptor: { id: 'test', revision: 1, dimensions, bounds: { min: [0, 0, 0], max: [4, 2, 4] }, extinctionScale: 0.003, encoding: 'r8unorm' }, data };
    const result = coarsenDensityField(source);
    expect(result.descriptor.dimensions).toEqual([2, 2, 2]);
    expect([...result.data]).toEqual([20.5, 22.5, 30.5, 32.5, 100.5, 102.5, 110.5, 112.5].map(Math.round));
  });

  it('rejects malformed or unsupported payloads', () => {
    const base: DenseDensityField = { descriptor: { id: 'bad', revision: 1, dimensions: [4, 2, 4], bounds: { min: [0, 0, 0], max: [1, 1, 1] }, extinctionScale: 1, encoding: 'r8unorm' }, data: new Uint8Array(32) };
    expect(() => coarsenDensityField({ ...base, data: new Uint8Array(31) })).toThrow();
    expect(() => coarsenDensityField({ ...base, descriptor: { ...base.descriptor, dimensions: [3, 2, 4] } })).toThrow();
    expect(() => coarsenDensityField({ ...base, descriptor: { ...base.descriptor, encoding: 'r16float' } })).toThrow();
  });
});
