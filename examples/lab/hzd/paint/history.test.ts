import { describe, expect, it } from 'vitest';
import { dab, MapFields, type Brush } from './fields';
import { History, capture, dabRegion, fullRegion, patchBytes, union } from './history';

const brush: Brush = { op: 'paint', radius: 3, hardness: 0, strength: 1, noiseCells: 4, noiseSeed: 1 };

describe('painter undo patches', () => {
  it('covers exactly what a dab writes', () => {
    const f = new MapFields(32), before = f.clone();
    dab(f, brush, 10.5, 12.5, ['coverage'], { coverage: 1 });
    const r = dabRegion(10.5, 12.5, 3);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const inside = x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
      if (!inside) expect(f.at('coverage', x, y)).toBe(before.at('coverage', x, y));
    }
  });

  it('unions regions and clamps to one tile', () => {
    expect(union(null, { x: 2, y: 3, w: 4, h: 4 }, 16)).toEqual({ x: 2, y: 3, w: 4, h: 4 });
    expect(union({ x: 2, y: 3, w: 4, h: 4 }, { x: 10, y: 1, w: 2, h: 2 }, 16)).toEqual({ x: 2, y: 1, w: 10, h: 6 });
    expect(union({ x: -5, y: 0, w: 4, h: 4 }, { x: 14, y: 0, w: 4, h: 4 }, 16)).toEqual({ x: 0, y: 0, w: 16, h: 4 });
  });

  it('undoes and redoes a stroke across the edge, keeping only its rectangle', () => {
    const f = new MapFields(64, { coverage: 0.3 }), start = f.clone();
    const snapshot = { coverage: f.data.coverage.slice() };
    let region = null;
    for (const x of [-2, 0, 2]) { dab(f, brush, x, 20, ['coverage'], { coverage: 1 }); region = union(region, dabRegion(x, 20, 3), 64); }
    const after = f.clone();
    const h = new History();
    h.push(capture(64, snapshot, ['coverage'], region!));
    expect(patchBytes(h.undo[0])).toBeLessThan(64 * 64 * 4 / 10);
    expect(f.at('coverage', 63, 20)).toBeGreaterThan(0.9);       // the stroke crossed onto the right edge
    expect(h.step(f, true)).toBe(true);
    expect(Array.from(f.data.coverage)).toEqual(Array.from(start.data.coverage));
    expect(h.step(f, false)).toBe(true);
    expect(Array.from(f.data.coverage)).toEqual(Array.from(after.data.coverage));
    expect(h.step(f, false)).toBe(false);
  });

  it('keeps at most `limit` steps and clears redo on a new step', () => {
    const f = new MapFields(8), h = new History(3);
    for (let i = 0; i < 5; i++) h.push(capture(8, f.data, ['coverage'], fullRegion(8)));
    expect(h.undo.length).toBe(3);
    h.step(f, true);
    expect(h.redo.length).toBe(1);
    h.push(capture(8, f.data, ['coverage'], fullRegion(8)));
    expect(h.redo.length).toBe(0);
  });
});
