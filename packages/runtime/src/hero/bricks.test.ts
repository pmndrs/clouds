import { describe, expect, it } from 'vitest';
import { BRICK_TEXELS, HERO_EMPTY, packFineBricks, POOL_XY, reduceFineLattice } from './bricks';

const lattice = (dims: [number, number, number], f: (x: number, y: number, z: number) => number) => {
  const out = new Uint8Array(dims[0] * dims[1] * dims[2] * 4);
  for (let z = 0; z < dims[2]; z++) for (let y = 0; y < dims[1]; y++) for (let x = 0; x < dims[0]; x++) {
    const o = ((z * dims[1] + y) * dims[0] + x) * 4;
    out[o] = f(x, y, z); out[o + 1] = x; out[o + 2] = y; out[o + 3] = z;
  }
  return out;
};
/** Pool texel (slot, local t) -> rgba. */
const texel = (b: ReturnType<typeof packFineBricks>, slot: number, t: [number, number, number]) => {
  const slab = b.slabs[Math.floor(slot / 1024)];
  const x = (slot % 32) * BRICK_TEXELS + t[0], y = (Math.floor(slot / 32) % 32) * BRICK_TEXELS + t[1];
  const o = ((t[2] * POOL_XY + y) * POOL_XY + x) * 4;
  return Array.from(slab.subarray(o, o + 4));
};

describe('packFineBricks', () => {
  it('fills payload and apron from the lattice, clamped at its faces', () => {
    const dims: [number, number, number] = [20, 9, 8];
    const b = packFineBricks(lattice(dims, () => 1), dims, 4, { all: true });
    expect(b.cells).toEqual([3, 2, 1]);
    expect(b.count).toBe(6);
    // Cell (1, 0, 0): texel t reads voxel clamp(8 - 1 + t).
    const slot = b.indir[1];
    expect(texel(b, slot, [0, 0, 0])).toEqual([1, 7, 0, 0]);
    expect(texel(b, slot, [9, 9, 9])).toEqual([1, 16, 8, 7]);   // y = 8 is the last row, z clamped to 7
    // Cell (2, 1, 0): x payload past the lattice (20 voxels) clamps to 19.
    expect(texel(b, b.indir[5], [9, 1, 1])).toEqual([1, 19, 8, 0]);
  });
  it('gives a brick only to cells within the margin of a set voxel', () => {
    const dims: [number, number, number] = [32, 8, 8];
    const set = lattice(dims, x => (x === 8 ? 200 : 0));
    const m1 = packFineBricks(set, dims, 4);
    expect(Array.from(m1.indir).map(s => s !== HERO_EMPTY)).toEqual([true, true, false, false]);   // voxel 8 is cell 0's apron
    const m3 = packFineBricks(set, dims, 4, { margin: 3 });
    expect(m3.count).toBe(2);
    const far = lattice(dims, x => (x === 20 ? 200 : 0));
    expect(Array.from(packFineBricks(far, dims, 4, { margin: 3 }).indir).map(s => s !== HERO_EMPTY)).toEqual([false, false, true, false]);
  });
});

describe('reduceFineLattice', () => {
  it('takes the mean and floors set blocks at 1/255', () => {
    const dims: [number, number, number] = [4, 2, 2];
    const r = reduceFineLattice(lattice(dims, (x, y, z) => (x + y + z === 0 ? 3 : x === 2 ? 255 : 0)), dims, 2);
    expect(r.dims).toEqual([2, 1, 1]);
    expect(r.rgba[0]).toBe(1);     // round(3 / 8) = 0, floored to 1 because a fine voxel is set
    expect(r.rgba[4]).toBe(128);   // 4 * 255 / 8
  });
});
