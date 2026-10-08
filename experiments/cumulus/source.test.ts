import { describe, expect, it } from 'vitest';
import { CUMULUS_BOUNDS, createCumulusField } from './source';

function voxel(data: Uint8Array, size: number, x: number, y: number, z: number): number {
  return data[x + y * size + z * size * size];
}

function stats(data: Uint8Array, size: number) {
  let mass = 0;
  let weightedX = 0;
  let weightedY = 0;
  let weightedZ = 0;
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const value = data[x + y * size + z * size * size] / 255;
    mass += value;
    weightedX += value * ((x + 0.5) / size * 2 - 1);
    weightedY += value * ((y + 0.5) / size);
    weightedZ += value * ((z + 0.5) / size * 2 - 1);
  }
  return { mass, centroid: [weightedX / mass, weightedY / mass, weightedZ / mass] as const };
}

function largestComponent(data: Uint8Array, size: number, threshold: number): number {
  const seen = new Uint8Array(data.length);
  let largest = 0;
  const neighbours = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
  for (let z = 1; z < size - 1; z++) for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
    const start = x + y * size + z * size * size;
    if (seen[start] || data[start] < threshold) continue;
    seen[start] = 1;
    const queue = [start];
    let count = 0;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor];
      count++;
      const iz = Math.floor(index / (size * size));
      const rem = index - iz * size * size;
      const iy = Math.floor(rem / size);
      const ix = rem - iy * size;
      for (const [dx, dy, dz] of neighbours) {
        const nx = ix + dx, ny = iy + dy, nz = iz + dz;
        if (nx < 1 || nx >= size - 1 || ny < 1 || ny >= size - 1 || nz < 1 || nz >= size - 1) continue;
        const next = nx + ny * size + nz * size * size;
        if (!seen[next] && data[next] >= threshold) {
          seen[next] = 1;
          queue.push(next);
        }
      }
    }
    largest = Math.max(largest, count);
  }
  return largest;
}

describe('cumulus source candidate', () => {
  it('is deterministic and changes with a signed 32-bit seed', () => {
    const first = createCumulusField({ resolution: 64, seed: -2147483648, erosion: 0.55 });
    const second = createCumulusField({ resolution: 64, seed: -2147483648, erosion: 0.55 });
    const changed = createCumulusField({ resolution: 64, seed: 2147483647, erosion: 0.55 });
    expect(first.descriptor).toMatchObject({
      dimensions: [64, 64, 64],
      bounds: CUMULUS_BOUNDS,
      extinctionScale: 0.003,
      encoding: 'r8unorm',
    });
    expect(first.data).toEqual(second.data);
    expect(first.data).not.toEqual(changed.data);
  });

  it('rejects malformed options and bounds allocations to the supported sizes', () => {
    expect(() => createCumulusField({ resolution: 65 as 64 })).toThrow(/resolution/i);
    expect(() => createCumulusField({ resolution: 64, seed: 1.25 })).toThrow(/seed/i);
    expect(() => createCumulusField({ resolution: 64, seed: 2147483648 })).toThrow(/seed/i);
    expect(() => createCumulusField({ resolution: 64, erosion: -0.01 })).toThrow(/erosion/i);
    expect(() => createCumulusField({ resolution: 64, erosion: 1.01 })).toThrow(/erosion/i);
    expect(() => createCumulusField(null as never)).toThrow(/options/i);
  });

  it('leaves an exact empty one-voxel guard on all six faces', () => {
    const size = 64;
    const data = createCumulusField({ resolution: size, seed: 17, erosion: 0.55 }).data;
    for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) {
      expect(voxel(data, size, 0, y, z)).toBe(0);
      expect(voxel(data, size, size - 1, y, z)).toBe(0);
    }
    for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
      expect(voxel(data, size, x, 0, z)).toBe(0);
      expect(voxel(data, size, x, size - 1, z)).toBe(0);
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      expect(voxel(data, size, x, y, 0)).toBe(0);
      expect(voxel(data, size, x, y, size - 1)).toBe(0);
    }
  });

  it('keeps the layer just inside each face negligibly dense', () => {
    const size = 64;
    const data = createCumulusField({ resolution: size, seed: 17, erosion: 0.55 }).data;
    let nearFaceMaximum = 0;
    for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) {
      nearFaceMaximum = Math.max(nearFaceMaximum, voxel(data, size, 1, y, z), voxel(data, size, size - 2, y, z));
    }
    for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
      nearFaceMaximum = Math.max(nearFaceMaximum, voxel(data, size, x, 1, z), voxel(data, size, x, size - 2, z));
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      nearFaceMaximum = Math.max(nearFaceMaximum, voxel(data, size, x, y, 1), voxel(data, size, x, y, size - 2));
    }
    expect(nearFaceMaximum).toBeLessThanOrEqual(4);
  });

  it('contains a substantial connected body with useful intermediate density', () => {
    const size = 64;
    const data = createCumulusField({ resolution: size, seed: 17, erosion: 0.55 }).data;
    const nonzero = data.filter(value => value > 0).length;
    const intermediate = data.filter(value => value > 8 && value < 247).length;
    expect(nonzero).toBeGreaterThan(size ** 3 * 0.08);
    expect(intermediate).toBeGreaterThan(size ** 3 * 0.03);
    expect(largestComponent(data, size, 32)).toBeGreaterThan(size ** 3 * 0.035);
  });

  it('makes erosion monotonic at every voxel', () => {
    const light = createCumulusField({ resolution: 64, seed: 17, erosion: 0 });
    const heavy = createCumulusField({ resolution: 64, seed: 17, erosion: 1 });
    let violations = 0;
    for (let i = 0; i < light.data.length; i++) if (heavy.data[i] > light.data[i]) violations++;
    expect(violations).toBe(0);
  });

  it('keeps normalized geometry stable when resolution changes', () => {
    const low = stats(createCumulusField({ resolution: 64, seed: 17, erosion: 0.55 }).data, 64);
    const high = stats(createCumulusField({ resolution: 96, seed: 17, erosion: 0.55 }).data, 96);
    expect(high.mass / (96 ** 3)).toBeCloseTo(low.mass / (64 ** 3), 1);
    expect(high.centroid[0]).toBeCloseTo(low.centroid[0], 1);
    expect(high.centroid[1]).toBeCloseTo(low.centroid[1], 1);
    expect(high.centroid[2]).toBeCloseTo(low.centroid[2], 1);
  });
});
