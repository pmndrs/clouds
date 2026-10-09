import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NanoVDBFile } from '../../vendor/nanovdb-wgsl/src/nvdb-file';
import { readValue } from '../../vendor/nanovdb-wgsl/src/cpu/read-value';
import { defineNumber, gridTypeConstantsFor, gridTypeIds } from '../../vendor/nanovdb-wgsl/src/cpu/stride-tables';
import { BRICK_TEXELS, HERO_EMPTY, packFineBricks, packFineProfile, POOL_XY, reduceFineLattice } from './bricks';
import { decodeFineNvdb } from './nvdb';

const ASSET = new URL('../../../../assets/clouds/disney-fine/', import.meta.url);
const read = (f: string) => { const b = readFileSync(new URL(f, ASSET)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };

describe('decodeFineNvdb', () => {
  it('uses the PNanoVDB ABI 32.9 offsets of WebVDB stride tables', () => {
    const fp8 = gridTypeConstantsFor('FP8');
    expect(gridTypeIds.FP8).toBe(14);
    expect(defineNumber('PNANOVDB_GRID_SIZE')).toBe(672);
    expect(defineNumber('PNANOVDB_TREE_OFF_NODE_OFFSET_LEAF')).toBe(0);
    expect(defineNumber('PNANOVDB_TREE_OFF_NODE_COUNT_LEAF')).toBe(32);
    expect(defineNumber('PNANOVDB_LEAF_OFF_BBOX_MIN')).toBe(0);
    expect(fp8.leaf_size).toBe(608);
    expect(fp8.leaf_off_table).toBe(96);
    expect(fp8.leaf_off_table - defineNumber('PNANOVDB_LEAF_TABLE_NEG_OFF_MINIMUM')).toBe(80);
    expect(fp8.leaf_off_table - defineNumber('PNANOVDB_LEAF_TABLE_NEG_OFF_QUANTUM')).toBe(84);
  });

  const meta = JSON.parse(new TextDecoder().decode(read('cloud.json'))) as { dims: [number, number, number]; fine: { dims: [number, number, number]; leaves: number; activeVoxels: number } };
  const buffer = read('fine.nvdb');
  const t0 = performance.now();
  const { profile, leaves } = decodeFineNvdb(buffer, meta.fine.dims);
  const decodeMs = performance.now() - t0;
  const [nx, ny, nz] = meta.fine.dims;

  it('decodes disney-fine: leaves, active voxels and WebVDB readValue agree', () => {
    expect(leaves).toBe(meta.fine.leaves);
    let set = 0;
    for (let i = 0; i < profile.length; i++) if (profile[i]) set++;
    expect(set).toBe(meta.fine.activeVoxels);
    // Every 7th voxel of the box through the reference tree descent (index (i, j, k) = lattice (x, up, row)).
    const img = NanoVDBFile.fromArrayBuffer(buffer).gridImage(0);
    let bad = 0, n = 0;
    for (let i = 0; i < nx * ny * nz; i += 7) {
      const x = i % nx, row = Math.floor(i / nx) % ny, up = Math.floor(i / (nx * ny));
      if (Math.round(readValue(img, [x, up, row]).value * 255) !== profile[i]) bad++;
      n++;
    }
    expect(n).toBeGreaterThan(700_000);
    expect(bad).toBe(0);
  });

  it('reduces to the shipped coarse profile exactly (P8 rule: axes and nesting are right)', () => {
    const rgba = new Uint8Array(profile.length * 4);
    for (let i = 0; i < profile.length; i++) rgba[i * 4] = profile[i];
    const coarse = reduceFineLattice(rgba, meta.fine.dims, 2);
    expect(coarse.dims).toEqual(meta.dims);
    const nvdf = new Uint8Array(read('nvdf.bin'));
    let bad = 0;
    for (let i = 0; i < nvdf.length / 4; i++) if (coarse.rgba[i * 4] !== nvdf[i * 4]) bad++;
    expect(bad).toBe(0);
  });

  it('packs R-only bricks like packFineBricks, with the loader margin; loader cost logged', () => {
    const t1 = performance.now();
    const b = packFineProfile(profile, meta.fine.dims, 4, 3);
    const packMs = performance.now() - t1;
    console.log(`disney-fine loader: decode ${decodeMs.toFixed(1)} ms, pack ${packMs.toFixed(1)} ms, ${b.count} bricks (${leaves} leaves), cells ${b.cells.join('x')}`);
    const rgba = new Uint8Array(profile.length * 4);
    for (let i = 0; i < profile.length; i++) rgba[i * 4] = profile[i];
    const ref = packFineBricks(rgba, meta.fine.dims, 4, { margin: 3 });
    expect(Array.from(b.indir)).toEqual(Array.from(ref.indir));
    for (let s = 0; s < b.count; s += 97) {
      expect(b.indir[b.cellOf[s]]).toBe(s);
      const slab = ref.slabs[Math.floor(s / 1024)];
      for (let t = 0; t < 1000; t += 37) {
        const tx = t % 10, ty = Math.floor(t / 10) % 10, tz = Math.floor(t / 100);
        const x = (s % 32) * BRICK_TEXELS + tx, y = (Math.floor(s / 32) % 32) * BRICK_TEXELS + ty;
        expect(b.profile[s * 1000 + t]).toBe(slab[((tz * POOL_XY + y) * POOL_XY + x) * 4]);
      }
    }
    expect(b.indir.some(s => s === HERO_EMPTY)).toBe(true);
  });
});
