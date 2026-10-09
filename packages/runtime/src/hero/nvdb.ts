/**
 * Minimal `.nvdb` reader for hero `fine.nvdb` files (work/specs/P8-hero-vdb.md section 5): one Fp8 grid, codec NONE, NanoVDB ABI 32.x.
 * It does not descend the tree: NanoVDB stores its leaves contiguously (breadth-first layout), so the decoder walks the leaf array
 * the tree header points at and writes each leaf's 512 codes into a dense uint8 lattice. That is the whole loader cost (a few ms per
 * 4 m hero). The general reader (any grid type, ZIP, the tree descent) is WebVDB's NanoVDBFile + readValue; the byte offsets below are
 * the PNanoVDB.h defines for ABI 32.9 (checked against WebVDB's stride tables in nvdb.test.ts).
 *
 * Axes: index (i, j, k) of a hero grid is lattice (x, up, map row), so voxel (i, j, k) lands at texture (x = i, row = k, up = j).
 */

const FILE_HEADER = 16, FILE_META = 176, META_GRID_SIZE = 0, META_GRID_TYPE = 32, META_NAME_SIZE = 136;
const GRID_SIZE = 672, GRID_OFF_TYPE = 636, TREE_OFF_LEAF = 0, TREE_OFF_LEAF_COUNT = 32;
const FP8 = 14, LEAF_SIZE = 608, LEAF_MIN = 80, LEAF_QUANTUM = 84, LEAF_CODES = 96;

/** Byte offset of the first (only used) grid image in a `.nvdb` buffer. Throws on anything but an uncompressed Fp8 grid. */
function gridOffset(v: DataView): number {
  const magic = String.fromCharCode(...new Uint8Array(v.buffer, v.byteOffset, 8));
  if (magic === 'NanoVDB1') return 0;   // a raw grid buffer
  if (magic !== 'NanoVDB0' && magic !== 'NanoVDB2') throw new Error(`fine.nvdb: not a NanoVDB file (magic "${magic}")`);
  if (v.getUint32(8, true) >>> 21 !== 32) throw new Error(`fine.nvdb: NanoVDB major version ${v.getUint32(8, true) >>> 21}, expected 32`);
  if (v.getUint16(14, true) !== 0) throw new Error('fine.nvdb: compressed (ZIP/Blosc) files are not supported here; write codec NONE');
  return FILE_HEADER + FILE_META + v.getUint32(FILE_HEADER + META_NAME_SIZE, true);
}

/**
 * Decode an Fp8 `.nvdb` (hero fine profile) into a dense uint8 lattice, texture axes (x, map row, up), x fastest. Values are
 * round(255 * value); voxels outside `dims` are dropped (the converter writes none). Returns the lattice and the leaf count.
 */
export function decodeFineNvdb(buffer: ArrayBuffer, dims: readonly [number, number, number]): { profile: Uint8Array<ArrayBuffer>; leaves: number } {
  const v = new DataView(buffer);
  const g = gridOffset(v);
  const type = v.getUint32(g + GRID_OFF_TYPE, true);
  if (type !== FP8 || (g && v.getUint32(FILE_HEADER + META_GRID_TYPE, true) !== FP8)) throw new Error(`fine.nvdb: grid type ${type}, expected Fp8 (${FP8})`);
  if (g && Number(v.getBigUint64(FILE_HEADER + META_GRID_SIZE, true)) + g > buffer.byteLength) throw new Error('fine.nvdb: truncated');
  const tree = g + GRID_SIZE;
  const first = tree + Number(v.getBigUint64(tree + TREE_OFF_LEAF, true));
  const count = v.getUint32(tree + TREE_OFF_LEAF_COUNT, true);
  if (first + count * LEAF_SIZE > buffer.byteLength) throw new Error('fine.nvdb: leaf array runs past the end of the file');
  const [nx, ny, nz] = dims;
  const profile = new Uint8Array(nx * ny * nz);
  const bytes = new Uint8Array(buffer);
  for (let l = 0; l < count; l++) {
    const a = first + l * LEAF_SIZE;
    // The leaf origin is its bbox min with the low three bits cleared (NanoVDB LeafData::origin()).
    const i0 = v.getInt32(a, true) & ~7, j0 = v.getInt32(a + 4, true) & ~7, k0 = v.getInt32(a + 8, true) & ~7;
    const min = v.getFloat32(a + LEAF_MIN, true), q = v.getFloat32(a + LEAF_QUANTUM, true);
    const s = 255 * q, o = 255 * min, codes = a + LEAF_CODES;
    // Leaf voxel n = (i << 6) | (j << 3) | k.
    if (i0 >= 0 && j0 >= 0 && k0 >= 0 && i0 + 8 <= nx && k0 + 8 <= ny && j0 + 8 <= nz) {
      for (let n = 0, di = 0; di < 8; di++) for (let dj = 0; dj < 8; dj++) {
        let p = ((j0 + dj) * ny + k0) * nx + i0 + di;
        for (let dk = 0; dk < 8; dk++, n++, p += nx) profile[p] = Math.round(bytes[codes + n] * s + o);
      }
      continue;
    }
    for (let n = 0; n < 512; n++) {
      const x = i0 + (n >> 6), up = j0 + ((n >> 3) & 7), row = k0 + (n & 7);
      if (x < 0 || up < 0 || row < 0 || x >= nx || row >= ny || up >= nz) continue;
      profile[(up * ny + row) * nx + x] = Math.round(bytes[codes + n] * s + o);
    }
  }
  return { profile, leaves: count };
}
