// Undo and redo for the painter as patches: only the rectangle a stroke touched, per channel it changed. The vanilla painter kept whole
// channels per step (4 MB each at 1024², up to ~640 MB over 40 steps with four channels); a stroke of a 1.5 km brush keeps ~0.2 MB.
// Regions are in unwrapped map pixels (a stroke can cross the edge; the map tiles), clamped to one tile. Pure: tested in history.test.ts.
import type { Channel, MapFields } from '../../hzd/paint/fields';

export interface Region { x: number; y: number; w: number; h: number }
export interface Patch { channels: Channel[]; region: Region; values: Float32Array[] }

const wrap = (i: number, n: number) => ((i % n) + n) % n;

/** The rectangle a dab of radius r at (cx, cy) writes (the same box `dab` loops over). */
export function dabRegion(cx: number, cy: number, r: number): Region {
  const x0 = Math.floor(cx - r), y0 = Math.floor(cy - r);
  return { x: x0, y: y0, w: Math.ceil(cx + r) - x0 + 1, h: Math.ceil(cy + r) - y0 + 1 };
}

export const fullRegion = (n: number): Region => ({ x: 0, y: 0, w: n, h: n });

/** The smallest rectangle holding both, clamped to one tile per axis (a region of n or more covers the whole axis). */
export function union(a: Region | null, b: Region, n: number): Region {
  const clamp = (r: Region): Region => ({ x: r.w >= n ? 0 : r.x, y: r.h >= n ? 0 : r.y, w: Math.min(r.w, n), h: Math.min(r.h, n) });
  if (!a) return clamp(b);
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x + a.w, b.x + b.w), y1 = Math.max(a.y + a.h, b.y + b.h);
  return clamp({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
}

/** The region's values from `from` (a channel's array, or the map's own), for `channels`. */
export function capture(n: number, from: Record<Channel, Float32Array> | Partial<Record<Channel, Float32Array>>, channels: Channel[], region: Region): Patch {
  const values = channels.map(c => {
    const src = from[c]!, out = new Float32Array(region.w * region.h);
    for (let y = 0; y < region.h; y++) {
      const row = wrap(region.y + y, n) * n;
      for (let x = 0; x < region.w; x++) out[y * region.w + x] = src[row + wrap(region.x + x, n)];
    }
    return out;
  });
  return { channels: [...channels], region: { ...region }, values };
}

/** Writes the patch into the map and returns its inverse (the values it replaced). */
export function apply(f: MapFields, p: Patch): Patch {
  const inverse = capture(f.n, f.data, p.channels, p.region);
  const { x: rx, y: ry, w, h } = p.region, n = f.n;
  p.channels.forEach((c, k) => {
    const dst = f.data[c], src = p.values[k];
    for (let y = 0; y < h; y++) {
      const row = wrap(ry + y, n) * n;
      for (let x = 0; x < w; x++) dst[row + wrap(rx + x, n)] = src[y * w + x];
    }
  });
  return inverse;
}

export const patchBytes = (p: Patch) => p.values.reduce((s, v) => s + v.byteLength, 0);

/** Undo and redo stacks of patches, `limit` steps deep. */
export class History {
  undo: Patch[] = [];
  redo: Patch[] = [];
  constructor(readonly limit = 40) {}
  push(p: Patch): void {
    this.undo.push(p);
    if (this.undo.length > this.limit) this.undo.shift();
    this.redo.length = 0;
  }
  /** Undo (back) or redo (forward) one step on `f`; false when there is nothing to do. */
  step(f: MapFields, back: boolean): boolean {
    const p = (back ? this.undo : this.redo).pop();
    if (!p) return false;
    (back ? this.redo : this.undo).push(apply(f, p));
    return true;
  }
  clear(): void { this.undo.length = 0; this.redo.length = 0; }
  get bytes(): number { return [...this.undo, ...this.redo].reduce((s, p) => s + patchBytes(p), 0); }
}
