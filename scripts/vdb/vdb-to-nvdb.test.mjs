// Fp8 .nvdb of a k/255 lattice must decode exactly (the claim behind "fine.nvdb parity exact"), and the parity helpers must catch a flipped voxel.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkAgainstLattice, decodeToU8 } from './vdb-to-nvdb.mjs';
import { vdbBuildFromDense, vdbQuantize, writeNvdb } from '@pmndrs/vdb/tools';

/** Pseudo-random sparse profile lattice (x fastest, then y, then z), values 0 or 1..255, with solid blobs and noisy shells. */
function makeLattice(nx, ny, nz, seed) {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const u8 = new Uint8Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const d = Math.hypot(x - nx / 2, y - ny / 2, z - nz / 2) / (Math.min(nx, ny, nz) / 2);
    if (d < 0.9) u8[x + nx * (y + ny * z)] = d < 0.5 ? 255 : 1 + Math.floor(rnd() * 254);
  }
  return u8;
}

function writeNvdbOf(u8, [nx, ny, nz], path) {
  const f = new Float32Array(nx * ny * nz); // buildFromDense is x-major: (x * ny + y) * nz + z
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) f[(x * ny + y) * nz + z] = u8[x + nx * (y + ny * z)] / 255;
  const img = vdbQuantize(vdbBuildFromDense(f, [nx, ny, nz], { voxelSize: 4, background: 0, gridName: 'profile', collapse: false }), 'fp8');
  writeFileSync(path, new Uint8Array(writeNvdb([img])));
}

describe('vdb-to-nvdb', () => {
  const dims = [37, 29, 41];
  const dir = mkdtempSync(join(tmpdir(), 'nvdb-'));
  const u8 = makeLattice(...dims, 7);
  writeNvdbOf(u8, dims, join(dir, 'a.nvdb'));
  writeFileSync(join(dir, 'a.u8'), u8);

  it('Fp8 codes of a k/255 lattice decode to exactly k', () => {
    const got = decodeToU8(join(dir, 'a.nvdb'), dims);
    expect(Buffer.compare(Buffer.from(got), Buffer.from(u8))).toBe(0);
  });

  it('parity check passes on the exact lattice and fails on a flipped voxel', () => {
    expect(checkAgainstLattice(join(dir, 'a.nvdb'), join(dir, 'a.u8'), dims)).toMatchObject({ mismatches: 0, activeOutside: 0 });
    const bad = Uint8Array.from(readFileSync(join(dir, 'a.u8')));
    bad[1234] = bad[1234] === 0 ? 5 : 0;
    writeFileSync(join(dir, 'b.u8'), bad);
    const r = checkAgainstLattice(join(dir, 'a.nvdb'), join(dir, 'b.u8'), dims);
    expect(r.mismatches).toBe(1);
  });
});
