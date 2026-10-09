import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeFineNvdb } from '../hero/nvdb';
import { convertVdb } from './convert';
import { exportFineNvdb, splitFineLattice } from './fine';
import { PACK_FIT } from './pack-fit';

const repo = new URL('../../../../', import.meta.url).pathname;
const roots = [process.env.CLOUDS_VDB_DIR, join(repo, 'artifacts/research'), '/Users/dex/Developer/WebGPUClouds/artifacts/research'].filter((p): p is string => !!p);
const DISNEY = roots.map(r => join(r, 'disney-cloud/wdas_cloud_eighth.vdb')).find(existsSync);
const load = (p: string): ArrayBuffer => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const bytesEqual = (a: ArrayBuffer, b: ArrayBuffer) => a.byteLength === b.byteLength && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

describe('fine hero import (P13-H4)', () => {
  it('keeps the noise correlation in metres (3 voxels at 8 m, as before)', () => {
    expect(PACK_FIT.profile.corrMeters / 8).toBe(PACK_FIT.profile.corrVox);
  });

  it('splits a fine lattice into the P8 reduction and a nested, padded fine profile', () => {
    const dims: [number, number, number] = [7, 5, 3];
    const rgba = new Uint8Array(7 * 5 * 3 * 4);
    const set = (x: number, y: number, z: number, r: number, g: number, b: number) => rgba.set([r, g, b, 255], ((z * 5 + y) * 7 + x) * 4);
    set(0, 0, 0, 3, 200, 100);     // one faint voxel: the floor
    set(6, 4, 2, 255, 40, 60);     // the last voxel: padding
    set(2, 0, 0, 200, 10, 20); set(3, 1, 1, 100, 30, 40);
    const { coarse, fine } = splitFineLattice(rgba, dims, 4, 2);
    expect(coarse.dims).toEqual([4, 3, 2]);
    expect(fine.dims).toEqual([8, 6, 4]);
    const c = (x: number, y: number, z: number) => Array.from(coarse.nvdf.subarray(((z * 3 + y) * 4 + x) * 4, ((z * 3 + y) * 4 + x) * 4 + 3));
    expect(c(0, 0, 0)).toEqual([1, 200, 100]);                      // round(3 / 8) = 0 -> floored to 1; G/B of the set voxel only
    expect(c(1, 0, 0)).toEqual([38, 20, 30]);                       // (200 + 100) / 8 = 37.5; G/B means of the two set voxels
    expect(c(3, 2, 1)).toEqual([32, 40, 60]);
    expect(c(2, 1, 0)[0]).toBe(0);
    // Coarse occupancy covers the fine one; the fine profile is the R channel, zero-padded.
    for (let z = 0; z < 4; z++) for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) {
      const p = fine.profile[(z * 6 + y) * 8 + x];
      expect(p).toBe(x < 7 && y < 5 && z < 3 ? rgba[((z * 5 + y) * 7 + x) * 4] : 0);
      if (p) expect(c(x >> 1, y >> 1, z >> 1)[0]).toBeGreaterThan(0);
    }
  });

  it('exports fine.nvdb that decodes to the lattice and re-exports byte-equal (disney-fine)', () => {
    const asset = new URL('../../../../assets/clouds/disney-fine/', import.meta.url);
    const meta = JSON.parse(readFileSync(new URL('cloud.json', asset), 'utf8')) as { fine: { dims: [number, number, number]; leaves: number; activeVoxels: number } };
    const shipped = decodeFineNvdb(load(new URL('fine.nvdb', asset).pathname), meta.fine.dims).profile;
    const a = exportFineNvdb({ profile: shipped, dims: meta.fine.dims, voxelSize: 4 });
    expect(a.leaves).toBe(meta.fine.leaves);
    expect(a.activeVoxels).toBe(meta.fine.activeVoxels);
    const back = decodeFineNvdb(a.buffer, meta.fine.dims).profile;
    expect(Buffer.compare(Buffer.from(back), Buffer.from(shipped))).toBe(0);
    const b = exportFineNvdb({ profile: back, dims: meta.fine.dims, voxelSize: 4 });
    expect(bytesEqual(a.buffer, b.buffer)).toBe(true);
    console.log(`disney-fine export: ${a.buffer.byteLength} bytes, shipped (converter, Houdini fine.vdb route) ${load(new URL('fine.nvdb', asset).pathname).byteLength} bytes, byte-equal ${bytesEqual(a.buffer, load(new URL('fine.nvdb', asset).pathname))}`);
  });

  it.skipIf(!DISNEY)('converts the Disney eighth at 4 m, reduces to 8 m and round-trips fine.nvdb byte-equal', () => {
    const t0 = performance.now();
    const conv = convertVdb(load(DISNEY!), { voxelSize: 4, targetWidthMeters: 1500, margin: 16 });
    const t1 = performance.now();
    const { coarse, fine } = splitFineLattice(conv.nvdf, conv.dims, 4, 2);
    const t2 = performance.now();
    let set = 0, outside = 0;
    for (let z = 0; z < fine.dims[2]; z++) for (let y = 0; y < fine.dims[1]; y++) for (let x = 0; x < fine.dims[0]; x++) {
      if (!fine.profile[(z * fine.dims[1] + y) * fine.dims[0] + x]) continue;
      set++;
      if (!coarse.nvdf[(((z >> 1) * coarse.dims[1] + (y >> 1)) * coarse.dims[0] + (x >> 1)) * 4]) outside++;
    }
    expect(set).toBeGreaterThan(100_000);
    expect(outside).toBe(0);
    const a = exportFineNvdb(fine);
    const back = decodeFineNvdb(a.buffer, fine.dims).profile;
    expect(Buffer.compare(Buffer.from(back), Buffer.from(fine.profile))).toBe(0);
    expect(bytesEqual(exportFineNvdb({ ...fine, profile: back }).buffer, a.buffer)).toBe(true);
    console.log(`disney eighth at 4 m: fine ${fine.dims.join('x')} (${set} set), coarse ${coarse.dims.join('x')}, convert ${(t1 - t0).toFixed(0)} ms (parse ${conv.info.timings.parseMs.toFixed(0)}, resample ${conv.info.timings.resampleMs.toFixed(0)}, channels ${conv.info.timings.channelsMs.toFixed(0)}), split ${(t2 - t1).toFixed(0)} ms, fine.nvdb ${(a.buffer.byteLength / 1048576).toFixed(2)} MB, ${a.leaves} leaves`);
  });
});
