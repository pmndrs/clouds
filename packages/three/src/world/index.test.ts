import { describe, expect, it } from 'vitest';
import { createCloudWorld } from './index';

function cellAt(world: ReturnType<typeof createCloudWorld>, cellX: number, cellZ: number) {
  return world.snapshot.cells.find(cell => cell.cellX === cellX && cell.cellZ === cellZ);
}

function horizontalOverlap(a: ReturnType<typeof cellAt>, b: ReturnType<typeof cellAt>): boolean {
  if (!a || !b) return false;
  return a.bounds.min[0] <= b.bounds.max[0] && a.bounds.max[0] >= b.bounds.min[0]
    && a.bounds.min[2] <= b.bounds.max[2] && a.bounds.max[2] >= b.bounds.min[2];
}

describe('deterministic cloud world residency', () => {
  it('returns the exact same snapshot while the camera remains in its cell', () => {
    const world = createCloudWorld({ radius: 2 });
    const initial = world.snapshot;
    expect(world.update([2_199, 900, 2_199])).toBe(initial);
    expect(world.snapshot).toBe(initial);
    expect(initial.side).toBe(5);
    expect(initial.cells).toHaveLength(25);
  });

  it('retains overlapping cell objects and data through signed crossings and revisit', () => {
    const size = 2_200;
    const world = createCloudWorld({ radius: 1, seed: 31 });
    const initial = world.snapshot;
    const originCell = initial.cells.find(cell => cell.cellX === 0 && cell.cellZ === 0)!;
    const originalBounds = originCell.bounds;

    world.update([size, 0, 0]);
    expect(cellAt(world, 0, 0)).toBe(originCell);
    expect(cellAt(world, 0, 0)!.bounds).toBe(originalBounds);

    world.update([-size, 0, 0]);
    expect(cellAt(world, 0, 0)).toBe(originCell);
    expect(cellAt(world, 0, 0)!.bounds).toBe(originalBounds);

    world.update([0, 0, 0]);
    expect(cellAt(world, 0, 0)).toBe(originCell);
    expect(cellAt(world, 0, 0)!.bounds).toBe(originalBounds);
    expect(world.snapshot.revision).toBe(3);
  });

  it('supports exact coverage endpoints and deterministic seeded cells', () => {
    const empty = createCloudWorld({ radius: 2, coverage: 0 }).snapshot;
    const full = createCloudWorld({ radius: 2, coverage: 1 }).snapshot;
    expect(empty.cells.every(cell => !cell.active)).toBe(true);
    expect(full.cells.every(cell => cell.active)).toBe(true);

    const first = createCloudWorld({ radius: 3, seed: 91 }).snapshot;
    const same = createCloudWorld({ radius: 3, seed: 91 }).snapshot;
    const changed = createCloudWorld({ radius: 3, seed: 92 }).snapshot;
    expect(same.cells).toEqual(first.cells);
    expect(changed.cells).not.toEqual(first.cells);
  });

  it('keeps every resident cell inside conservative bounds, including inactive cells', () => {
    const world = createCloudWorld({ radius: 2, coverage: 0 });
    const snapshot = world.update([-4_401, 0, 4_401]);
    const epsilon = snapshot.cellSize * 1e-12;
    for (const cell of snapshot.cells) {
      expect(cell.bounds.min[0]).toBeGreaterThanOrEqual(snapshot.bounds.min[0] - epsilon);
      expect(cell.bounds.min[1]).toBeGreaterThanOrEqual(snapshot.bounds.min[1] - epsilon);
      expect(cell.bounds.min[2]).toBeGreaterThanOrEqual(snapshot.bounds.min[2] - epsilon);
      expect(cell.bounds.max[0]).toBeLessThanOrEqual(snapshot.bounds.max[0] + epsilon);
      expect(cell.bounds.max[1]).toBeLessThanOrEqual(snapshot.bounds.max[1] + epsilon);
      expect(cell.bounds.max[2]).toBeLessThanOrEqual(snapshot.bounds.max[2] + epsilon);
    }
  });

  it('limits horizontal overlap to the 3 × 3 neighbor stencil', () => {
    const world = createCloudWorld({ radius: 2, cellSize: 100 });
    const snapshot = world.snapshot;
    const center = cellAt(world, 0, 0)!;
    const overlapping = snapshot.cells.filter(cell => horizontalOverlap(center, cell));
    expect(overlapping.length).toBeGreaterThan(0);
    expect(overlapping.every(cell => Math.abs(cell.cellX) <= 1 && Math.abs(cell.cellZ) <= 1)).toBe(true);
    for (let z = -1; z <= 1; z++) for (let x = -1; x <= 1; x++) {
      expect(snapshot.cells.some(cell => cell.cellX === x && cell.cellZ === z)).toBe(true);
    }
  });

  it('guards world and camera parameters and keeps residency counts fixed', () => {
    expect(() => createCloudWorld({ radius: -1 })).toThrow(/radius/i);
    expect(() => createCloudWorld({ radius: 9 })).toThrow(/radius/i);
    expect(() => createCloudWorld({ radius: 1.5 })).toThrow(/radius/i);
    expect(() => createCloudWorld({ cellSize: 0 })).toThrow(/cellSize/i);
    expect(() => createCloudWorld({ cellSize: Number.NaN })).toThrow(/cellSize/i);
    expect(() => createCloudWorld({ coverage: -0.01 })).toThrow(/coverage/i);
    expect(() => createCloudWorld({ coverage: 1.01 })).toThrow(/coverage/i);
    expect(() => createCloudWorld({ seed: 1.5 })).toThrow(/seed/i);

    const world = createCloudWorld({ radius: 3, cellSize: 100 });
    expect(() => world.update([Number.NaN, 0, 0])).toThrow(/camera/i);
    expect(() => world.update([0, 0, Number.POSITIVE_INFINITY])).toThrow(/camera/i);
    expect(() => world.update([Number.MAX_VALUE, 0, 0])).toThrow(/safe/i);
    for (let step = -32; step <= 32; step++) {
      const snapshot = world.update([step * 100 + 1, 0, -step * 100 - 1]);
      expect(snapshot.cells).toHaveLength(49);
      expect(snapshot.side).toBe(7);
    }
  });
});
