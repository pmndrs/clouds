import { describe, expect, it } from 'vitest';
import { convertVdbFogGridToDensity } from './vdb';

const fog = {
  gridClass: 'Fog Volume',
  dimensions: [2, 2, 2] as const,
  values: new Float32Array([0, 0.25, 0.5, 0.75, 0.125, 0.375, 0.625, 1]),
  background: 0,
  bounds: { min: [-2, 4, 8] as const, max: [2, 8, 12] as const },
  voxelSize: [2, 2, 2] as const,
  indexToWorld: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, -2, 4, 8, 1] as const,
};

describe('OpenVDB fog adapter', () => {
  it('maps an expanded fog grid into the dense contract and preserves provenance', () => {
    const result = convertVdbFogGridToDensity(fog, { id: 'real-cloud', dimensions: [4, 3, 2] });
    expect(result.source).toBe('vdb-fog');
    expect(result.gridClass).toBe('fog');
    expect(result.descriptor.id).toBe('real-cloud');
    expect(result.descriptor.dimensions).toEqual([4, 3, 2]);
    expect(result.descriptor.bounds).toEqual(fog.bounds);
    expect(result.sourceVoxelSize).toEqual([2, 2, 2]);
    expect(result.sourceBackground).toBe(0);
    expect(result.sourceIndexToWorld).toEqual(fog.indexToWorld);
    expect(result.resampled).toBe(true);
    expect(result.data.some(value => value > 0)).toBe(true);
    expect(result.data.some(value => value < 255)).toBe(true);
  });

  it('resamples destination voxel centers within the same world bounds', () => {
    const one = convertVdbFogGridToDensity(fog, { resolution: 1, encoding: 'r32float' });
    expect(new Float32Array(one.data.buffer)[0]).toBeCloseTo(.453125, 6);
    const line = { ...fog, dimensions: [2,1,1] as const, values: new Float32Array([0,1]) };
    const up = convertVdbFogGridToDensity(line, { dimensions: [4,1,1], encoding: 'r32float' });
    expect([...new Float32Array(up.data.buffer)]).toEqual([0,.25,.75,1]);
  });
  it('supports a float output without 8-bit quantization', () => {
    const result = convertVdbFogGridToDensity(fog, { encoding: 'r32float' });
    expect(result.data.byteLength).toBe(8 * 4);
    expect(Array.from(new Float32Array(result.data.buffer, result.data.byteOffset, 8))).toEqual(Array.from(fog.values));
  });

  it('rejects level sets, out-of-range values and oversized destinations before allocation', () => {
    expect(() => convertVdbFogGridToDensity({ ...fog, gridClass: 'Level Set' })).toThrow(/level-set/i);
    expect(() => convertVdbFogGridToDensity({ ...fog, values: new Float32Array([0, 0.25, 0.5, 0.75, 0.125, 0.375, 0.625, 2]) })).toThrow(/valueRange/i);
    expect(() => convertVdbFogGridToDensity(fog, { resolution: 10, maxVoxels: 999 })).toThrow(/maxVoxels/i);
    expect(() => convertVdbFogGridToDensity(fog, { dimensions: [4, 4, 4], maxPayloadBytes: 10 })).toThrow(/payload/i);
    expect(() => convertVdbFogGridToDensity({ ...fog, indexToWorld: [0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] })).toThrow(/rotation\/shear/i);
    expect(() => convertVdbFogGridToDensity({ ...fog, values: new Float64Array([Number.MAX_VALUE, 0, 0, 0, 0, 0, 0, 0]) }, { encoding: 'r32float' })).toThrow(/r32float/i);
  });
});
