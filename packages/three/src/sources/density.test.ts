import { describe, expect, it } from 'vitest';
import { buildConservativeOccupancy } from './occupancy';
import { createDensityField } from './density';

describe('deterministic density sources', () => {
  it('keeps descriptor bounds and payload layout stable', () => {
    const field = createDensityField('cumulus', 9, 12);
    expect(field.descriptor).toMatchObject({
      dimensions: [9, 9, 9],
      bounds: { min: [-300, 100, -250], max: [300, 600, 250] },
      extinctionScale: 0.025,
      encoding: 'r8unorm',
    });
    expect(field.data).toHaveLength(9 ** 3);
    expect(field.descriptor.id).toBe('generated-cumulus-r9-s12');
  });

  it('is deterministic per preset and seed while changing with the seed', () => {
    const first = createDensityField('tower', 16, 99);
    const second = createDensityField('tower', 16, 99);
    const changed = createDensityField('tower', 16, 100);
    expect(Array.from(first.data)).toEqual(Array.from(second.data));
    expect(Array.from(first.data)).not.toEqual(Array.from(changed.data));
  });

  it('provides useful visible distributions plus exact references', () => {
    for (const preset of ['cumulus', 'tower', 'wisps', 'authored'] as const) {
      const data = createDensityField(preset, 16, 7).data;
      expect(data.some(value => value > 0)).toBe(true);
      expect(data.some(value => value < 255)).toBe(true);
    }
    expect(createDensityField('homogeneous', 4).data.every(value => value === 255)).toBe(true);
    expect(createDensityField('empty', 4).data.every(value => value === 0)).toBe(true);
  });

  it('keeps a smoothly tapered empty layer on all six faces of shaped fields', () => {
    const size = 24;
    for (const preset of ['cumulus', 'tower', 'wisps', 'authored'] as const) {
      const data = createDensityField(preset, size, 7).data;
      const at = (x: number, y: number, z: number) => data[x + y * size + z * size * size];
      for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) {
        expect(at(0, y, z)).toBe(0);
        expect(at(size - 1, y, z)).toBe(0);
      }
      for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
        expect(at(x, 0, z)).toBe(0);
        expect(at(x, size - 1, z)).toBe(0);
      }
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        expect(at(x, y, 0)).toBe(0);
        expect(at(x, y, size - 1)).toBe(0);
      }
    }
  });

  it('marks trilinear one-voxel halos conservatively at brick boundaries', () => {
    const data = new Uint8Array(4 * 4 * 4);
    data[1 + 1 * 4 + 1 * 16] = 1;
    const field = createDensityField('empty', 4);
    const occupancy = buildConservativeOccupancy({ descriptor: field.descriptor, data }, 2);
    expect(occupancy.dimensions).toEqual([2, 2, 2]);
    expect(occupancy.data.every(value => value > 0)).toBe(true);

    const boundary = new Uint8Array(4 * 4 * 4);
    boundary[2 + 1 * 4 + 1 * 16] = 1;
    const boundaryMask = buildConservativeOccupancy({ descriptor: field.descriptor, data: boundary }, 2);
    expect(boundaryMask.data[0]).toBeGreaterThan(0);
    expect(boundaryMask.data[1]).toBeGreaterThan(0);
  });

  it('rejects malformed source and occupancy parameters', () => {
    expect(() => createDensityField('cumulus', 0)).toThrow(/resolution/i);
    expect(() => createDensityField('cumulus', 2.5)).toThrow(/resolution/i);
    const field = createDensityField('empty', 4);
    expect(() => buildConservativeOccupancy(field, 0)).toThrow(/brickSize/i);
    expect(() => buildConservativeOccupancy({ descriptor: field.descriptor, data: new Uint8Array(1) }, 2)).toThrow(/length/i);
  });
});
