import { describe, expect, it } from 'vitest';
import { createPersistentCloudWorld } from './persistent';

describe('createPersistentCloudWorld', () => {
  it('keeps one deterministic snapshot regardless of camera path', () => {
    const a = createPersistentCloudWorld({ seed: 9 });
    const b = createPersistentCloudWorld({ seed: 9 });
    const first = a.snapshot;
    a.update([1000, 400, 1000]);
    a.update([-50000, 100, 50000]);
    expect(a.snapshot).toBe(first);
    expect(a.snapshot).toEqual(b.snapshot);
    expect(first.side).toBe(33);
    first.cells.forEach((cell, i) => {
      expect(cell.cellX).toBe(-16 + i % 33); expect(cell.cellZ).toBe(-16 + Math.floor(i / 33));
      for (const axis of [0, 2]) {
        const owner = axis === 0 ? cell.cellX : cell.cellZ;
        expect(cell.bounds.min[axis]).toBeGreaterThanOrEqual((owner - .25) * first.cellSize);
        expect(cell.bounds.max[axis]).toBeLessThanOrEqual((owner + 1.25) * first.cellSize);
      }
    });
  });
  it('scales coherent coverage continuously and has an exact empty endpoint', () => {
    const empty = createPersistentCloudWorld({ coverage: 0 }).snapshot;
    const partial = createPersistentCloudWorld({ coverage: 0.5 }).snapshot;
    const full = createPersistentCloudWorld({ coverage: 1 }).snapshot;
    expect(empty.cells.every((cell) => !cell.active && cell.extinctionScale === 0)).toBe(true);
    expect(partial.cells.some(cell => cell.active)).toBe(true);
    expect(partial.cells.some(cell => !cell.active)).toBe(true);
    expect(full.cells.every((cell, i) => cell.extinctionScale >= partial.cells[i].extinctionScale)).toBe(true);
    const masks = partial.cells.map((cell, i) => cell.extinctionScale / full.cells[i].extinctionScale);
    const partialMasks = masks.filter(n => n > 0 && n < 1);
    expect(partialMasks.length).toBeGreaterThan(100);
    // Neighboring coverage correlates more strongly than remote coverage.
    const difference = (offset: number) => masks.slice(0, -offset).reduce((sum, n, i) => sum + Math.abs(n - masks[i + offset]), 0) / (masks.length - offset);
    expect(difference(1)).toBeLessThan(difference(10));
    const incremented = createPersistentCloudWorld({ coverage: .50001 }).snapshot;
    expect(Math.max(...incremented.cells.map((cell, i) => Math.abs(cell.extinctionScale - partial.cells[i].extinctionScale)))).toBeLessThan(.00001);
    expect(partial.cells.every((cell, i) => JSON.stringify(cell.bounds) === JSON.stringify(full.cells[i].bounds) && cell.atlasIndex === full.cells[i].atlasIndex)).toBe(true);
  });
  it('bounds options and camera coordinates', () => {
    expect(() => createPersistentCloudWorld({ radius: 17 })).toThrow(/radius/i);
    expect(() => createPersistentCloudWorld({ radius: -1 })).toThrow(/radius/i);
    expect(() => createPersistentCloudWorld().update([0, Number.NaN, 0])).toThrow(/finite/i);
  });
});
