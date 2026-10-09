/**
 * Minimal `.nvdb` reader for hero `fine.nvdb` files (work/specs/P8-hero-vdb.md section 5): one Fp8 grid, codec NONE, NanoVDB ABI 32.x.
 * It does not descend the tree: NanoVDB stores its leaves contiguously (breadth-first layout), so the decoder walks the leaf array
 * the tree header points at and writes each leaf's 512 codes into a dense uint8 lattice. That is the whole loader cost (a few ms per
 * 4 m hero). The general reader (any grid type, ZIP, the tree descent) is WebVDB's NanoVDBFile + readValue; the byte offsets below are
 * the PNanoVDB.h defines for ABI 32.9 (checked against WebVDB's stride tables in nvdb.test.ts).
 *
 * Axes: index (i, j, k) of a hero grid is lattice (x, up, map row), so voxel (i, j, k) lands at texture (x = i, row = k, up = j).
 */

const FP8 = 14, LEAF_SIZE = 608;

/**
 * Decode an Fp8 `.nvdb` (hero fine profile) into a dense uint8 lattice, texture axes (x, map row, up), x fastest. Values are
 * round(255 * value); voxels outside `dims` are dropped (the converter writes none). Returns the lattice and the leaf count.
 */
export function decodeFineNvdb(buffer: ArrayBuffer, dims: readonly [number, number, number]): { profile: Uint8Array<ArrayBuffer>; leaves: number } {
  const v = new DataView(buffer), bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(...bytes.subarray(0, 8));
  // A segment file: 16-byte header (version at 8, codec at 14), 176-byte metadata (name size at 136), the name, then the grid. NanoVDB1: a raw grid.
  const g = magic === 'NanoVDB1' ? 0 : 192 + v.getUint32(152, true);
  // GridData is 672 bytes (grid type at 636), then TreeData (first leaf offset at 0, leaf count at 32).
  const tree = g + 672, first = tree + Number(v.getBigUint64(tree, true)), count = v.getUint32(tree + 32, true);
  if (!/^NanoVDB[012]$/.test(magic) || (g && (v.getUint32(8, true) >>> 21 !== 32 || v.getUint16(14, true))) || v.getUint32(g + 636, true) !== FP8 || first + count * LEAF_SIZE > buffer.byteLength) {
    throw new Error('fine.nvdb: need an uncompressed Fp8 grid, NanoVDB 32.x');
  }
  const [nx, ny, nz] = dims;
  const profile = new Uint8Array(nx * ny * nz);
  for (let l = 0; l < count; l++) {
    const a = first + l * LEAF_SIZE;
    // The leaf origin is its bbox min with the low three bits cleared (NanoVDB LeafData::origin()).
    const i0 = v.getInt32(a, true) & ~7, j0 = v.getInt32(a + 4, true) & ~7, k0 = v.getInt32(a + 8, true) & ~7;
    // Leaf minimum and quantum at 80 and 84, the 512 codes at 96; voxel n = (i << 6) | (j << 3) | k.
    const s = 255 * v.getFloat32(a + 84, true), o = 255 * v.getFloat32(a + 80, true);
    for (let n = 0; n < 512; n++) {
      const x = i0 + (n >> 6), up = j0 + ((n >> 3) & 7), row = k0 + (n & 7);
      if (x >= 0 && up >= 0 && row >= 0 && x < nx && row < ny && up < nz) profile[(up * ny + row) * nx + x] = Math.round(bytes[a + 96 + n] * s + o);
    }
  }
  return { profile, leaves: count };
}
