import { describe, expect, it } from 'vitest';
import { createCloudscapeAtlas } from './cloudscape-atlas';

function tileVoxel(
  atlas: ReturnType<typeof createCloudscapeAtlas>,
  tileX: number,
  tileY: number,
  tileZ: number,
  localX: number,
  localY: number,
  localZ: number,
): number {
  const [width] = atlas.dimensions;
  const x = tileX * atlas.tileSize + localX;
  const y = tileY * atlas.tileSize + localY;
  const z = tileZ * atlas.tileSize + localZ;
  return atlas.data[x + y * width + z * width * width];
}

describe('deterministic cloudscape atlas', () => {
  it('packs eight r8 volumes with the expected layout', () => {
    const atlas = createCloudscapeAtlas(12, 17);
    expect(atlas.dimensions).toEqual([24, 24, 24]);
    expect(atlas.data).toHaveLength(24 ** 3);
    expect(atlas.tileSize).toBe(12);
    expect(atlas.tilesPerAxis).toBe(2);
    expect(atlas.tileCount).toBe(8);
    expect(Number.isFinite(atlas.occupiedFraction)).toBe(true);
    expect(atlas.occupiedFraction).toBeGreaterThan(0.01);
    expect(atlas.occupiedFraction).toBeLessThan(0.9);
  });

  it('is deterministic for a seed and changes when the seed changes', () => {
    const first = createCloudscapeAtlas(10, 17);
    const second = createCloudscapeAtlas(10, 17);
    const changed = createCloudscapeAtlas(10, 18);
    expect(Array.from(first.data)).toEqual(Array.from(second.data));
    expect(Array.from(first.data)).not.toEqual(Array.from(changed.data));
  });

  it('keeps every packed tile isolated with an empty guard on all faces', () => {
    const tileSize = 14;
    const atlas = createCloudscapeAtlas(tileSize, 31);
    for (let tileZ = 0; tileZ < 2; tileZ++) for (let tileY = 0; tileY < 2; tileY++) for (let tileX = 0; tileX < 2; tileX++) {
      for (let z = 0; z < tileSize; z++) for (let y = 0; y < tileSize; y++) {
        expect(tileVoxel(atlas, tileX, tileY, tileZ, 0, y, z)).toBe(0);
        expect(tileVoxel(atlas, tileX, tileY, tileZ, tileSize - 1, y, z)).toBe(0);
      }
      for (let z = 0; z < tileSize; z++) for (let x = 0; x < tileSize; x++) {
        expect(tileVoxel(atlas, tileX, tileY, tileZ, x, 0, z)).toBe(0);
        expect(tileVoxel(atlas, tileX, tileY, tileZ, x, tileSize - 1, z)).toBe(0);
      }
      for (let y = 0; y < tileSize; y++) for (let x = 0; x < tileSize; x++) {
        expect(tileVoxel(atlas, tileX, tileY, tileZ, x, y, 0)).toBe(0);
        expect(tileVoxel(atlas, tileX, tileY, tileZ, x, y, tileSize - 1)).toBe(0);
      }
    }
  });

  it('provides varied, volumetric silhouettes with finite values', () => {
    const tileSize = 16;
    const atlas = createCloudscapeAtlas(tileSize, 17);
    const tilePayloads: number[][] = [];
    for (let tileZ = 0; tileZ < 2; tileZ++) for (let tileY = 0; tileY < 2; tileY++) for (let tileX = 0; tileX < 2; tileX++) {
      const values: number[] = [];
      for (let z = 1; z < tileSize - 1; z++) for (let y = 1; y < tileSize - 1; y++) for (let x = 1; x < tileSize - 1; x++) {
        values.push(tileVoxel(atlas, tileX, tileY, tileZ, x, y, z));
      }
      expect(values.some(value => value > 0)).toBe(true);
      expect(values.some(value => value > 0 && value < 255)).toBe(true);
      expect(values.every(value => Number.isFinite(value) && value >= 0 && value <= 255)).toBe(true);
      tilePayloads.push(values);
    }
    expect(new Set(tilePayloads.map(values => values.join(','))).size).toBe(8);
  });

  it('rejects unsafe atlas sizes before allocating an oversized field', () => {
    expect(() => createCloudscapeAtlas(1)).toThrow(/tileSize/i);
    expect(() => createCloudscapeAtlas(96.5)).toThrow(/tileSize/i);
    expect(() => createCloudscapeAtlas(97)).toThrow(/tileSize/i);
    expect(() => createCloudscapeAtlas(8, 1.5)).toThrow(/seed/i);
  });
});
