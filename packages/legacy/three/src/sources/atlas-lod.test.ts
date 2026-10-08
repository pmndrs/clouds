import { describe, expect, it } from 'vitest';
import { createCoarseCloudscapeAtlas } from './atlas-lod';

describe('createCoarseCloudscapeAtlas', () => {
  it('averages each tile in X/Z without crossing packed boundaries', () => {
    const tile = 4, size = tile * 2, data = new Uint8Array(size * size * size);
    const at = (x: number, y: number, z: number) => x + y * size + z * size * size;
    for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) data[at(x, y, z)] = (x >= tile ? 200 : 20) + (z >= tile ? 30 : 0);
    const out = createCoarseCloudscapeAtlas({ data, dimensions: [size, size, size], tileSize: tile, tilesPerAxis: 2, tileCount: 8, occupiedFraction: 1 });
    expect(out.dimensions).toEqual([tile, size, tile]);
    expect(out.tileDimensions).toEqual([2, 4, 2]);
    const oi = (x: number, y: number, z: number) => x + y * tile + z * tile * size;
    expect(out.data[oi(0, 0, 0)]).toBe(20);
    expect(out.data[oi(2, 0, 0)]).toBe(200);
    expect(out.data[oi(0, 0, 2)]).toBe(50);
    expect(out.data[oi(2, 0, 2)]).toBe(230);
  });
  it('averages actual variation and preserves Y slices in every tile', () => {
    const size = 8, data = new Uint8Array(size ** 3);
    for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) data[x + y * size + z * size ** 2] = x * 4 + y * 8 + z * 16;
    const out = createCoarseCloudscapeAtlas({ data, dimensions: [8, 8, 8], tileSize: 4, tilesPerAxis: 2, tileCount: 8, occupiedFraction: 1 });
    for (let z = 0; z < 4; z++) for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) expect(out.data[x + y * 4 + z * 32]).toBe((x * 2 + .5) * 4 + y * 8 + (z * 2 + .5) * 16);
  });
  it('rejects malformed payloads', () => {
    expect(() => createCoarseCloudscapeAtlas({ data: new Uint8Array(1), dimensions: [8, 8, 8], tileSize: 4, tilesPerAxis: 2, tileCount: 8, occupiedFraction: 0 })).toThrow(/payload|dimensions/i);
  });
});
