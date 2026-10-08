import type { Vec3 } from '@clouds/core';
import type { WorldSnapshot } from '../world';

/** CPU reference for the conservative horizontal 3 × 3 candidate mask. */
export interface CandidateMasks {
  /** One uint32 per coarse voxel; X is fastest, then Y, then Z. */
  readonly data: Uint32Array;
  readonly dimensions: readonly [number, number, number];
  readonly min: Vec3;
  readonly max: Vec3;
}

const COARSE_AXIS = 8;
const COARSE_HEIGHT = 32;
const INTERSECTION_EPSILON = 1e-4;

function voxelIndex(x: number, y: number, z: number, dimensions: readonly [number, number, number]): number {
  return x + y * dimensions[0] + z * dimensions[0] * dimensions[1];
}

function candidateBit(cellX: number, cellZ: number, ownerX: number, ownerZ: number): number {
  const dx = cellX - ownerX;
  const dz = cellZ - ownerZ;
  if (dx < -1 || dx > 1 || dz < -1 || dz > 1) return -1;
  // X is the fastest neighbor coordinate: (-1,-1), (0,-1), (1,-1), ...
  return (dx + 1) + (dz + 1) * 3;
}

function intersectsInclusive(minA: number, maxA: number, minB: number, maxB: number): boolean {
  return minA <= maxB + INTERSECTION_EPSILON && maxA >= minB - INTERSECTION_EPSILON;
}

function validateWorld(world: WorldSnapshot): void {
  if (!world || !Number.isSafeInteger(world.side) || world.side < 1 || world.side > 17) {
    throw new Error('Candidate mask world side must be a safe integer between 1 and 17.');
  }
  if (!Array.isArray(world.gridMin) || world.gridMin.length !== 2 || !world.gridMin.every(Number.isSafeInteger)) {
    throw new Error('Candidate mask world gridMin must contain two safe integers.');
  }
  if (!Number.isFinite(world.cellSize) || world.cellSize <= 0) {
    throw new Error('Candidate mask world cellSize must be finite and positive.');
  }
  if (!world.cells || world.cells.length !== world.side ** 2) {
    throw new Error('Candidate mask world cells must match side squared.');
  }
  for (const cell of world.cells) {
    if (!Number.isSafeInteger(cell.cellX) || !Number.isSafeInteger(cell.cellZ)) {
      throw new Error('Candidate mask cell coordinates must be safe integers.');
    }
    if (!cell.bounds || cell.bounds.min.length !== 3 || cell.bounds.max.length !== 3
      || !cell.bounds.min.every(Number.isFinite) || !cell.bounds.max.every(Number.isFinite)) {
      throw new Error('Candidate mask cell bounds must contain finite vectors.');
    }
    if (cell.bounds.min.some((value, index) => value > cell.bounds.max[index])) {
      throw new Error('Candidate mask cell bounds must be ordered.');
    }
  }
}

/**
 * Build a conservative coarse candidate mask for a bounded world snapshot.
 *
 * The mask covers one-cell margins around the resident grid. Each coarse voxel
 * stores nine bits for active owners at `(dx, dz)` in the 3 × 3 stencil around
 * the owner cell found by `floor(voxelCenter.xz / cellSize)`. It is intentionally
 * a CPU reference for matching GPU generation and tests; production updates
 * should not rebuild this mask per flight frame.
 */
export function buildCandidateMasks(world: WorldSnapshot): CandidateMasks {
  validateWorld(world);

  const [gridMinX, gridMinZ] = world.gridMin;
  const sideWithMargin = world.side + 2;
  const dimensions: [number, number, number] = [
    sideWithMargin * COARSE_AXIS,
    COARSE_HEIGHT,
    sideWithMargin * COARSE_AXIS,
  ];
  const min: Vec3 = [
    (gridMinX - 1) * world.cellSize,
    700,
    (gridMinZ - 1) * world.cellSize,
  ];
  const max: Vec3 = [
    (gridMinX + world.side + 1) * world.cellSize,
    3500,
    (gridMinZ + world.side + 1) * world.cellSize,
  ];
  const data = new Uint32Array(dimensions[0] * dimensions[1] * dimensions[2]);
  const coarseSizeX = world.cellSize / COARSE_AXIS;
  const coarseSizeY = (max[1] - min[1]) / COARSE_HEIGHT;
  const coarseSizeZ = coarseSizeX;

  for (const cell of world.cells) {
    if (!cell.active || cell.extinctionScale <= 0) continue;
    const cellMin = cell.bounds.min;
    const cellMax = cell.bounds.max;
    // The ±1 range catches a box exactly on a coarse voxel face before the
    // inclusive epsilon check below, while the checks keep writes conservative.
    const firstX = Math.max(0, Math.floor((cellMin[0] - min[0]) / coarseSizeX) - 1);
    const lastX = Math.min(dimensions[0] - 1, Math.floor((cellMax[0] - min[0]) / coarseSizeX) + 1);
    const firstY = Math.max(0, Math.floor((cellMin[1] - min[1]) / coarseSizeY) - 1);
    const lastY = Math.min(dimensions[1] - 1, Math.floor((cellMax[1] - min[1]) / coarseSizeY) + 1);
    const firstZ = Math.max(0, Math.floor((cellMin[2] - min[2]) / coarseSizeZ) - 1);
    const lastZ = Math.min(dimensions[2] - 1, Math.floor((cellMax[2] - min[2]) / coarseSizeZ) + 1);

    for (let z = firstZ; z <= lastZ; z++) {
      const voxelMinZ = min[2] + z * coarseSizeZ;
      const voxelMaxZ = voxelMinZ + coarseSizeZ;
      if (!intersectsInclusive(cellMin[2], cellMax[2], voxelMinZ, voxelMaxZ)) continue;
      const centerZ = voxelMinZ + coarseSizeZ * 0.5;
      const ownerZ = Math.floor(centerZ / world.cellSize);
      for (let y = firstY; y <= lastY; y++) {
        const voxelMinY = min[1] + y * coarseSizeY;
        const voxelMaxY = voxelMinY + coarseSizeY;
        if (!intersectsInclusive(cellMin[1], cellMax[1], voxelMinY, voxelMaxY)) continue;
        for (let x = firstX; x <= lastX; x++) {
          const voxelMinX = min[0] + x * coarseSizeX;
          const voxelMaxX = voxelMinX + coarseSizeX;
          if (!intersectsInclusive(cellMin[0], cellMax[0], voxelMinX, voxelMaxX)) continue;
          const ownerX = Math.floor((voxelMinX + coarseSizeX * 0.5) / world.cellSize);
          const bit = candidateBit(cell.cellX, cell.cellZ, ownerX, ownerZ);
          if (bit >= 0) data[voxelIndex(x, y, z, dimensions)] |= 1 << bit;
        }
      }
    }
  }

  return { data, dimensions, min, max };
}
