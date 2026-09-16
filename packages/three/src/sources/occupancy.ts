import { validateDensityDescriptor } from '@clouds/core';
import type { DenseDensityField } from './density';

export interface ConservativeOccupancy {
  /** One byte per brick; zero means the corresponding brick is certainly empty. */
  readonly data: Uint8Array;
  /** Brick counts in x, y and z order (x is fastest in data). */
  readonly dimensions: readonly [number, number, number];
  readonly brickSize: number;
}

function product(dimensions: readonly [number, number, number]): number {
  return dimensions[0] * dimensions[1] * dimensions[2];
}

function brickIndex(x: number, y: number, z: number, dimensions: readonly [number, number, number]): number {
  return x + y * dimensions[0] + z * dimensions[0] * dimensions[1];
}

/**
 * Build a conservative brick occupancy mask for a dense field.
 *
 * A trilinear sample can use a neighboring voxel on each axis. Consequently a
 * nonzero voxel marks its containing brick and every brick touched by a one-voxel
 * halo. The mask is an acceleration hint only: callers may skip a brick when its
 * byte is zero, but must retain the source sampling path for occupied bricks.
 */
export function buildConservativeOccupancy(field: DenseDensityField, brickSize: number = 8): ConservativeOccupancy {
  validateDensityDescriptor(field.descriptor);
  if (field.descriptor.encoding !== 'r8unorm') throw new Error('Occupancy requires an r8unorm density field.');
  if (!(field.data instanceof Uint8Array)) throw new Error('Density field data must be a Uint8Array.');
  if (!Number.isSafeInteger(brickSize) || brickSize < 1) {
    throw new Error('Occupancy brickSize must be a positive safe integer.');
  }

  const [width, height, depth] = field.descriptor.dimensions;
  const dimensions: readonly [number, number, number] = [
    Math.ceil(width / brickSize),
    Math.ceil(height / brickSize),
    Math.ceil(depth / brickSize),
  ];
  const expectedLength = width * height * depth;
  if (field.data.length !== expectedLength) {
    throw new Error(`Density data length ${field.data.length} does not match ${expectedLength} voxels.`);
  }
  const data = new Uint8Array(product(dimensions));

  for (let z = 0; z < depth; z++) {
    for (let y = 0; y < height; y++) {
      const rowOffset = y * width + z * width * height;
      for (let x = 0; x < width; x++) {
        if (field.data[rowOffset + x] === 0) continue;
        const minBrickX = Math.max(0, Math.floor((x - 1) / brickSize));
        const maxBrickX = Math.min(dimensions[0] - 1, Math.floor((x + 1) / brickSize));
        const minBrickY = Math.max(0, Math.floor((y - 1) / brickSize));
        const maxBrickY = Math.min(dimensions[1] - 1, Math.floor((y + 1) / brickSize));
        const minBrickZ = Math.max(0, Math.floor((z - 1) / brickSize));
        const maxBrickZ = Math.min(dimensions[2] - 1, Math.floor((z + 1) / brickSize));
        for (let bz = minBrickZ; bz <= maxBrickZ; bz++) {
          for (let by = minBrickY; by <= maxBrickY; by++) {
            for (let bx = minBrickX; bx <= maxBrickX; bx++) {
              data[brickIndex(bx, by, bz, dimensions)] = 255;
            }
          }
        }
      }
    }
  }

  return { data, dimensions, brickSize };
}

