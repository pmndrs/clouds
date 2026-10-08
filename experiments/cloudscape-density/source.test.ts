import { describe, expect, it } from 'vitest';
import {
  CLOUD_LAYER_BOUNDS,
  createCloudLayerField,
  summarizeCloudLayerField,
} from './source';

function voxel(data: Uint8Array, size: number, x: number, y: number, z: number): number {
  return data[x + y * size + z * size * size];
}

describe('cloud-layer density source', () => {
  it('emits deterministic bounded metadata and changes with seed', () => {
    const first = createCloudLayerField({ resolution: 64, seed: 17 });
    const second = createCloudLayerField({ resolution: 64, seed: 17 });
    const changed = createCloudLayerField({ resolution: 64, seed: 18 });
    expect(first.descriptor).toMatchObject({
      dimensions: [64, 64, 64],
      bounds: CLOUD_LAYER_BOUNDS,
      extinctionScale: 0.004,
      encoding: 'r8unorm',
    });
    expect(first.data).toEqual(second.data);
    expect(first.data).not.toEqual(changed.data);
    expect(first.data.length).toBe(64 ** 3);
  });

  it('bounds options and keeps endpoint behavior monotonic', () => {
    expect(() => createCloudLayerField({ resolution: 65 as 64 })).toThrow(/resolution/i);
    expect(() => createCloudLayerField({ seed: 1.5 })).toThrow(/seed/i);
    expect(() => createCloudLayerField({ coverage: -0.01 })).toThrow(/coverage/i);
    expect(() => createCloudLayerField({ density: 1.01 })).toThrow(/density/i);
    expect(() => createCloudLayerField({ erosion: 1.01 })).toThrow(/erosion/i);
    expect(() => createCloudLayerField(null as never)).toThrow(/options/i);

    const emptyCoverage = createCloudLayerField({ resolution: 64, coverage: 0 });
    const fullCoverage = createCloudLayerField({ resolution: 64, coverage: 1 });
    const noErosion = createCloudLayerField({ resolution: 64, erosion: 0 });
    const fullErosion = createCloudLayerField({ resolution: 64, erosion: 1 });
    let monotonicViolations = 0;
    for (let i = 0; i < emptyCoverage.data.length; i++) {
      if (fullCoverage.data[i] < emptyCoverage.data[i] || fullErosion.data[i] > noErosion.data[i]) monotonicViolations++;
    }
    expect(monotonicViolations).toBe(0);
  });

  it('keeps vertical guard slices empty without clipping the horizontal source faces', () => {
    const size = 64;
    const field = createCloudLayerField({ resolution: size, seed: 17 });
    for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
      expect(voxel(field.data, size, x, 0, z)).toBe(0);
      expect(voxel(field.data, size, x, size - 1, z)).toBe(0);
    }
    const horizontalFaceSamples: number[] = [];
    for (let z = 0; z < size; z++) for (let y = 1; y < size - 1; y++) {
      horizontalFaceSamples.push(voxel(field.data, size, 0, y, z), voxel(field.data, size, size - 1, y, z));
    }
    for (let x = 0; x < size; x++) for (let y = 1; y < size - 1; y++) {
      horizontalFaceSamples.push(voxel(field.data, size, x, y, 0), voxel(field.data, size, x, y, size - 1));
    }
    expect(horizontalFaceSamples.some(value => value > 0)).toBe(true);
  });

  it('has a connected, noisy cloud profile with intermediate density', () => {
    const size = 64;
    const field = createCloudLayerField({ resolution: size, seed: 17 });
    const stats = summarizeCloudLayerField(field);
    expect(stats.nonzeroFraction).toBeGreaterThan(0.12);
    expect(stats.nonzeroFraction).toBeLessThan(0.75);
    expect(stats.intermediateFraction).toBeGreaterThan(0.04);
    expect(stats.meanDensity).toBeGreaterThan(0.015);
    expect(stats.peakDensity).toBeGreaterThan(0.7);
    expect(stats.largestClusterFraction).toBeGreaterThan(0.002);
    // A cloud layer may join into one deck; secondary clusters are reported,
    // rather than imposing an arbitrary disconnected-cloud count.
    expect(stats.secondLargestClusterFraction).toBeLessThanOrEqual(stats.largestClusterFraction);

    const unique = new Set(field.data);
    expect(unique.size).toBeGreaterThan(28);
    let adjacentChanges = 0;
    for (let z = 2; z < size - 2; z++) for (let y = 2; y < size - 2; y++) for (let x = 2; x < size - 2; x++) {
      const value = voxel(field.data, size, x, y, z);
      if (Math.abs(value - voxel(field.data, size, x + 1, y, z)) > 5) adjacentChanges++;
    }
    expect(adjacentChanges).toBeGreaterThan(size ** 3 * 0.015);
  });

  it('summarizes rectangular authored fields including boundary voxels', () => {
    const field = createCloudLayerField({resolution:64,coverage:0});
    const rectangular = {...field,descriptor:{...field.descriptor,dimensions:[2,3,4] as const},data:new Uint8Array(24).fill(255)};
    const stats = summarizeCloudLayerField(rectangular);
    expect(stats.meanDensity).toBe(1);
    expect(stats.nonzeroFraction).toBe(1);
    expect(stats.centroid).toEqual([.5,.5,.5]);
    expect(stats.largestClusterFraction).toBe(1);
  });
  it('keeps the vertical profile continuous across resolutions', () => {
    const low = summarizeCloudLayerField(createCloudLayerField({ resolution: 64, seed: 17 }));
    const high = summarizeCloudLayerField(createCloudLayerField({ resolution: 96, seed: 17 }));
    expect(high.nonzeroFraction).toBeCloseTo(low.nonzeroFraction, 1);
    expect(high.meanDensity).toBeCloseTo(low.meanDensity, 1);
    expect(high.centroid[1]).toBeCloseTo(low.centroid[1], 1);
    expect(high.centroid[1]).toBeGreaterThan(0.20);
    expect(high.centroid[1]).toBeLessThan(0.75);
  });
});
