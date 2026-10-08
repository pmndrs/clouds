import { describe, expect, it } from 'vitest';
import { createCloudWorld } from '../world';
import { buildCandidateMasks } from './index';

function maskAt(mask: ReturnType<typeof buildCandidateMasks>, x: number, y: number, z: number): number {
  const [width, height] = mask.dimensions;
  return mask.data[x + y * width + z * width * height];
}

function bitForSample(
  mask: ReturnType<typeof buildCandidateMasks>,
  cellX: number,
  cellZ: number,
  point: readonly [number, number, number],
  cellSize: number,
): number {
  const [width, height, depth] = mask.dimensions;
  const coarseX = Math.max(0, Math.min(width - 1, Math.floor((point[0] - mask.min[0]) / (cellSize / 8))));
  const coarseY = Math.max(0, Math.min(height - 1, Math.floor((point[1] - mask.min[1]) / ((mask.max[1] - mask.min[1]) / height))));
  const coarseZ = Math.max(0, Math.min(depth - 1, Math.floor((point[2] - mask.min[2]) / (cellSize / 8))));
  const centerX = mask.min[0] + (coarseX + 0.5) * cellSize / 8;
  const centerZ = mask.min[2] + (coarseZ + 0.5) * cellSize / 8;
  const ownerX = Math.floor(centerX / cellSize);
  const ownerZ = Math.floor(centerZ / cellSize);
  const dx = cellX - ownerX;
  const dz = cellZ - ownerZ;
  if (Math.abs(dx) > 1 || Math.abs(dz) > 1) return 0;
  return maskAt(mask, coarseX, coarseY, coarseZ) & (1 << ((dx + 1) + (dz + 1) * 3));
}

describe('coarse cloud candidate masks', () => {
  it('uses the fixed 8 × 32 × 8 coarse resolution per resident cell', () => {
    const snapshot = createCloudWorld({ radius: 2, cellSize: 100 }).snapshot;
    const mask = buildCandidateMasks(snapshot);
    expect(mask.dimensions).toEqual([56, 32, 56]);
    expect(mask.data).toHaveLength(56 * 32 * 56);
    expect(mask.min).toEqual([-300, 700, -300]);
    expect(mask.max).toEqual([400, 3500, 400]);
  });

  it('keeps an empty world fully empty', () => {
    const snapshot = createCloudWorld({ radius: 3, coverage: 0 }).snapshot;
    const mask = buildCandidateMasks(snapshot);
    expect(mask.data.every(value => value === 0)).toBe(true);

    const noExtinction = {
      ...snapshot,
      cells: snapshot.cells.map(cell => ({ ...cell, active: true, extinctionScale: 0 })),
    };
    expect(buildCandidateMasks(noExtinction).data.every(value => value === 0)).toBe(true);
  });

  it('sets the owner bit for samples throughout every active cell', () => {
    const snapshot = createCloudWorld({ radius: 2, cellSize: 100, coverage: 1, seed: 91 }).snapshot;
    const mask = buildCandidateMasks(snapshot);
    for (const cell of snapshot.cells) {
      const min = cell.bounds.min;
      const max = cell.bounds.max;
      const points: readonly (readonly [number, number, number])[] = [
        [min[0], min[1], min[2]],
        [max[0], max[1], max[2]],
        [min[0], (min[1] + max[1]) * 0.5, max[2]],
        [(min[0] + max[0]) * 0.5, max[1], (min[2] + max[2]) * 0.5],
        [(min[0] + max[0]) * 0.5, (min[1] + max[1]) * 0.5, (min[2] + max[2]) * 0.5],
      ];
      for (const point of points) {
        expect(bitForSample(mask, cell.cellX, cell.cellZ, point, snapshot.cellSize)).toBeGreaterThan(0);
      }
    }
  });

  it('is conservative at coarse brick faces and distinguishes inactive owners', () => {
    const activeSnapshot = createCloudWorld({ radius: 1, cellSize: 120, coverage: 1, seed: 4 }).snapshot;
    const emptySnapshot = createCloudWorld({ radius: 1, cellSize: 120, coverage: 0, seed: 4 }).snapshot;
    const activeMask = buildCandidateMasks(activeSnapshot);
    const emptyMask = buildCandidateMasks(emptySnapshot);
    for (const cell of activeSnapshot.cells) {
      const x = cell.bounds.min[0];
      const z = (cell.bounds.min[2] + cell.bounds.max[2]) * 0.5;
      const y = 700 + 87.5 * 8;
      expect(bitForSample(activeMask, cell.cellX, cell.cellZ, [x, y, z], activeSnapshot.cellSize)).toBeGreaterThan(0);
    }
    expect(emptyMask.data.every(value => value === 0)).toBe(true);
  });

  it('rejects malformed snapshots before allocation', () => {
    const snapshot = createCloudWorld({ radius: 1 }).snapshot;
    expect(() => buildCandidateMasks({ ...snapshot, side: 0 })).toThrow(/side/i);
    expect(() => buildCandidateMasks({ ...snapshot, cells: [] })).toThrow(/cells/i);
    expect(() => buildCandidateMasks({ ...snapshot, cellSize: 0 })).toThrow(/cellSize/i);
    expect(() => buildCandidateMasks({ ...snapshot, gridMin: [0] as unknown as readonly [number, number] })).toThrow(/gridMin/i);
    const first = snapshot.cells[0];
    const reversed = {
      ...snapshot,
      cells: snapshot.cells.map((cell, index) => index === 0
        ? { ...cell, bounds: { min: first.bounds.max, max: first.bounds.min } }
        : cell),
    };
    expect(() => buildCandidateMasks(reversed)).toThrow(/ordered/i);
  });
});
