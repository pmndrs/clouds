import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VdbFloatGrid } from '@pmndrs/vdb/tools';
import { convertVdb, inspectVdb, VdbImportError } from './convert';
import { planLattice, resampleGrid } from './grid-read';
import { gaussianBlur, heightFractions, packProfile, smoothNoise } from './pack-fit';

const repo = new URL('../../../../', import.meta.url).pathname;
const researchRoots = [process.env.CLOUDS_VDB_DIR, join(repo, 'artifacts/research'), '/Users/dex/Developer/WebGPUClouds/artifacts/research'].filter((p): p is string => !!p);
const find = (...parts: string[]) => researchRoots.map(r => join(r, ...parts)).find(existsSync);
const PACK_VDB = find('nubis-pack/extracted/Nubis Voxel Clouds Pack/NVDFs/Examples/ParkouringCloud/VDB/ParkouringCloud.vdb');
const BUNNY_CLOUD = find('vdbs/bunny_cloud.vdb');
const LS_BUNNY = find('vdbs/bunny.vdb');
const CLOUD0001 = find('vdbs/cloud.0001.vdb');
const DISNEY = find('disney-cloud/wdas_cloud_eighth.vdb');
const load = (p: string): ArrayBuffer => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };

interface FakeTile { origin: [number, number, number]; dim: 8 | 128 | 4096; value: number; active: boolean }
function fakeGrid(background: number, leaves: { origin: [number, number, number]; fill: number }[], tiles: FakeTile[] = []): VdbFloatGrid {
  return {
    background,
    *iterTiles() { for (const t of tiles) if (t.active) yield { origin: t.origin, dim: t.dim, value: t.value }; },
    *iterInactiveTiles() { for (const t of tiles) if (!t.active) yield { origin: t.origin, dim: t.dim, value: t.value }; },
    *iterLeaves() {
      for (const l of leaves) yield { origin: l.origin, values: new Float32Array(512).fill(l.fill), valueMask: new Uint32Array(16).fill(0xffffffff) };
    },
  } as unknown as VdbFloatGrid;
}

// The Blosc and LZ4 block decoders are tested upstream (@pmndrs/vdb test/tools/blosc*.test.ts).

describe('resampleGrid', () => {
  it('keeps constants (tiles and leaves) under 2:1 and 1:1 resampling', () => {
    const grid = fakeGrid(0, [{ origin: [0, 0, 0], fill: 1 }], [{ origin: [8, 0, 0], dim: 8, value: 1, active: true }]);
    const plan2 = planLattice([0, 0, 0], [16, 8, 8], [2, 2, 2]);
    const out2 = resampleGrid(grid, plan2);
    expect(plan2.dims).toEqual([8, 4, 4]);
    for (const v of out2) expect(v).toBeCloseTo(1, 5);
    const plan1 = planLattice([0, 0, 0], [16, 8, 8], [1, 1, 1]);
    for (const v of resampleGrid(grid, plan1)) expect(v).toBeCloseTo(1, 6);
  });
  it('fills unset voxels with the background (level set convention)', () => {
    const grid = fakeGrid(5, [{ origin: [0, 0, 0], fill: -3 }]);
    const out = resampleGrid(grid, planLattice([0, 0, 0], [16, 8, 8], [1, 1, 1]), 2);
    expect(out[0]).toBeCloseTo(-6, 5);
    expect(out[8]).toBeCloseTo(10, 5);
  });
});

describe('pack-fit helpers', () => {
  it('matches the python PACK_FIT profile law at a few points', () => {
    expect(packProfile(0, 1, 0)).toBe(0);
    expect(packProfile(40, 1, 0)).toBeCloseTo(Math.pow((40 - 1.4) / 66, 1.05), 6);
    expect(packProfile(40, 0, 0)).toBeCloseTo(0.1 * Math.pow((40 - 1.4) / 66, 1.05), 6);
  });
  it('noise is unit variance and deterministic; height fractions span the occupied slices', () => {
    const dims: [number, number, number] = [12, 10, 8];
    const n = smoothNoise(dims, 2, 3), m = smoothNoise(dims, 2, 3);
    expect(n).toEqual(m);
    const mean = n.reduce((a, b) => a + b, 0) / n.length;
    expect(Math.abs(mean)).toBeLessThan(1e-4);
    expect(n.reduce((a, b) => a + b * b, 0) / n.length).toBeCloseTo(1, 3);
    const mask = new Uint8Array(12 * 10 * 8); mask[2 * 120 + 5] = 1; mask[5 * 120 + 7] = 1;
    const h = heightFractions(mask, dims);
    expect([h[2], h[5], h[0], h[7]]).toEqual([0, 1, 0, 1]);
    expect(gaussianBlur(new Float32Array(12 * 10 * 8).fill(2), dims, 1)[100]).toBeCloseTo(2, 5);
  });
});

describe('errors', () => {
  it('rejects a non-VDB buffer with a typed error', () => {
    expect(() => convertVdb(new ArrayBuffer(64))).toThrow(VdbImportError);
  });
});

describe.skipIf(!PACK_VDB)('Nubis pack VDB parity (ParkouringCloud.vdb vs assets/clouds/parkouring)', () => {
  it('reproduces the TGA-derived asset: dims, crop offset and NVDF within 2/255 at >= 99% of voxels', { timeout: 180_000 }, () => {
    const meta = JSON.parse(readFileSync(join(repo, 'assets/clouds/parkouring/cloud.json'), 'utf8')) as { dims: number[]; cropOffset: number[] };
    const ref = readFileSync(join(repo, 'assets/clouds/parkouring/nvdf.bin'));
    const buffer = load(PACK_VDB!);
    expect(inspectVdb(buffer).mode).toBe('pack');
    const got = convertVdb(buffer, { voxelSize: 8 });
    expect(got.info.mode).toBe('pack');
    expect(got.dims).toEqual(meta.dims);
    expect(got.info.cropOffset).toEqual(meta.cropOffset);
    expect(got.nvdf.length).toBe(ref.length);
    const n = ref.length / 4;
    for (let c = 0; c < 3; c++) {
      let within = 0, exact = 0, max = 0;
      for (let i = 0; i < n; i++) {
        const d = Math.abs(got.nvdf[i * 4 + c] - ref[i * 4 + c]);
        if (d <= 2) within++;
        if (d === 0) exact++;
        if (d > max) max = d;
      }
      expect(within / n).toBeGreaterThanOrEqual(0.99);
      console.log(`parkouring channel ${'RGB'[c]}: within 2/255 ${(100 * within / n).toFixed(4)}%, exact ${(100 * exact / n).toFixed(4)}%, max diff ${max}`);
    }
    let occMismatch = 0;
    for (let i = 0; i < n; i++) if ((got.nvdf[i * 4] > 0) !== (ref[i * 4] > 0)) occMismatch++;
    expect(occMismatch).toBe(0);
    console.log('parkouring timings', JSON.stringify(got.info.timings));
  });
  it('resamples to a coarser lattice', () => {
    const got = convertVdb(load(PACK_VDB!), { voxelSize: 16 });
    expect(got.dims[0]).toBeLessThan(70);
    expect(got.info.occupiedFraction).toBeGreaterThan(0);
  });
});

describe.skipIf(!DISNEY)('Disney cloud (fog mode, v223, uncompressed with the Blosc flag clear)', () => {
  it('imports as fog with the fitted mapping', { timeout: 180_000 }, () => {
    const got = convertVdb(load(DISNEY!), { voxelSize: 8, targetWidthMeters: 1500 });
    expect(got.info.mode).toBe('fog');
    expect(got.info.sourceWidthMeters).toBeCloseTo(1500, 3);
    expect(got.info.occupiedFraction).toBeGreaterThan(0.01);
    let max = 0;
    for (let i = 0; i < got.dims[0] * got.dims[1] * got.dims[2]; i++) max = Math.max(max, got.nvdf[i * 4]);
    expect(max).toBeGreaterThan(100);
    console.log('disney eighth', got.dims, JSON.stringify(got.info.timings));
  });
});

describe.skipIf(!BUNNY_CLOUD)('bunny_cloud.vdb (2013, file version 220, ZIP)', () => {
  it('imports with a target width', { timeout: 180_000 }, () => {
    const got = convertVdb(load(BUNNY_CLOUD!), { voxelSize: 8, targetWidthMeters: 1500 });
    expect(got.info.mode).toBe('fog');
    expect(got.info.fileVersion).toBe(220);
    expect(got.info.occupiedFraction).toBeGreaterThan(0.01);
    console.log('bunny_cloud', got.dims, JSON.stringify(got.info.timings));
  });
});

describe.skipIf(!CLOUD0001)('cloud.0001.vdb (lz4 Blosc, typesize 4 with byte shuffle)', () => {
  it('decodes the Blosc chunks and imports as fog', { timeout: 180_000 }, () => {
    const got = convertVdb(load(CLOUD0001!), { voxelSize: 8, targetWidthMeters: 1200 });
    expect(got.info.grids[0].compression).toBe('blosc');
    expect(got.info.occupiedFraction).toBeGreaterThan(0.01);
  });
  it('fails with the Houdini setting to change when the chunks use another codec', { timeout: 180_000 }, () => {
    const bytes = new Uint8Array(load(CLOUD0001!).slice(0));
    const view = new DataView(bytes.buffer);
    let patched = 0;
    for (let i = 8; i < bytes.length - 24; i++) {
      const n = Number(view.getBigInt64(i, true));
      // an int64 chunk length followed by a Blosc header (version 2, lz 1, lz4 codec) whose cbytes equals it
      if (n > 16 && n < 100000 && bytes[i + 8] === 2 && bytes[i + 9] === 1 && bytes[i + 10] >> 5 === 1 && view.getUint32(i + 20, true) === n) { bytes[i + 10] = (4 << 5) | (bytes[i + 10] & 0x1f); patched++; }
    }
    expect(patched).toBeGreaterThan(0);
    let error: unknown;
    try { convertVdb(bytes.buffer as ArrayBuffer, { voxelSize: 8 }); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(VdbImportError);
    expect((error as VdbImportError).code).toBe('unsupported-codec');
    expect((error as VdbImportError).message).toMatch(/zstd.*File Compression to ZIP/);
  });
});

describe.skipIf(!LS_BUNNY)('bunny.vdb (level set with a negative interior held in tiles)', () => {
  it('imports as sdf with a solid interior', { timeout: 180_000 }, () => {
    const got = convertVdb(load(LS_BUNNY!), { voxelSize: 8, targetWidthMeters: 1500 });
    expect(got.info.mode).toBe('sdf');
    expect(got.info.grids[0].gridClass).toMatch(/level/i);
    // a solid bunny: the occupied share of its bounding box is large and it has a deep core (profile well above 0)
    let deep = 0;
    for (let i = 0; i < got.dims[0] * got.dims[1] * got.dims[2]; i++) if (got.nvdf[i * 4] > 128) deep++;
    expect(got.info.occupiedFraction).toBeGreaterThan(0.1);
    expect(deep).toBeGreaterThan(1000);
    console.log('ls_bunny', got.dims, JSON.stringify(got.info.timings));
  });
});
