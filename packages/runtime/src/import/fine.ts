// Fine hero layers from the in-browser importer (P13-H4, work/specs/P8-hero-vdb.md section 5.3): the coarse lattice by the P8 reduction of the
// fine one, and `fine.nvdb` export through WebVDB's dense builder, Fp8 quantizer and writer (vendored, packages/runtime/vendor/vdb-web-tools).
import { reduceFineLattice } from '../hero/bricks';
import { buildFromDenseDetailed, quantize, writeNvdb } from '../../vendor/vdb-web-tools/src/nanovdb/index';

/** A fine profile lattice: uint8, texture axes (x, map row, up), x fastest. Nested in a coarse lattice `ratio` times coarser, same min corner. */
export interface FineProfile {
  profile: Uint8Array<ArrayBuffer>;
  dims: [number, number, number];
  voxelSize: number;
}

/**
 * Split a fine NVDF (rgba, texture axes) into the coarse NVDF by the P8 reduction (R mean floored at 1/255 where any fine voxel is set,
 * G/B means over the set voxels) and the fine profile padded to `ratio` x the coarse dims, so the lattices nest exactly.
 */
export function splitFineLattice(rgba: Uint8Array, dims: readonly [number, number, number], fineVoxel: number, ratio: number): { coarse: { nvdf: Uint8Array<ArrayBuffer>; dims: [number, number, number] }; fine: FineProfile } {
  const coarse = reduceFineLattice(rgba, dims, ratio);
  const fd = coarse.dims.map(d => d * ratio) as [number, number, number];
  const profile = new Uint8Array(fd[0] * fd[1] * fd[2]);
  for (let z = 0; z < dims[2]; z++) for (let y = 0; y < dims[1]; y++) {
    const src = (z * dims[1] + y) * dims[0], dst = (z * fd[1] + y) * fd[0];
    for (let x = 0; x < dims[0]; x++) profile[dst + x] = rgba[(src + x) * 4];
  }
  return { coarse: { nvdf: coarse.rgba, dims: coarse.dims }, fine: { profile, dims: fd, voxelSize: fineVoxel } };
}

export interface ExportFineNvdbOptions {
  /** World position (metres) of the lattice's min corner, NanoVDB axes (x, y-up, z); the Map carries it with the voxel size. Default 0. */
  originMeters?: [number, number, number];
  /** Grid name. Default 'profile' (what loadCloudVolume and the converter use). */
  gridName?: string;
}

/**
 * Write a fine profile as `fine.nvdb`: one Fp8 fog-volume grid, codec NONE, index (i, j, k) = lattice (x, up, map row), value = profile / 255
 * (Fp8 is exact for k/255 values, so `decodeFineNvdb` of the result returns the lattice and a second export is byte-equal).
 * Returns the file and the NanoVDB leaf count.
 */
export function exportFineNvdb(fine: FineProfile, options: ExportFineNvdbOptions = {}): { buffer: ArrayBuffer; leaves: number; activeVoxels: number } {
  const [nx, ny, nz] = fine.dims;   // texture axes: x, row, up
  // WebVDB's dense builder indexes values[(i * nj + j) * nk + k] with dims [ni, nj, nk] = [x, up, row].
  const values = new Float32Array(nx * ny * nz);
  for (let up = 0; up < nz; up++) for (let row = 0; row < ny; row++) {
    const src = (up * ny + row) * nx;
    for (let x = 0; x < nx; x++) { const p = fine.profile[src + x]; if (p) values[(x * nz + up) * ny + row] = p / 255; }
  }
  const o = options.originMeters ?? [0, 0, 0];
  // worldOrigin is the world position of index (0, 0, 0)'s centre in NanoVDB's cell-centred Map.
  const built = buildFromDenseDetailed(values, [nx, nz, ny], {
    voxelSize: fine.voxelSize, worldOrigin: [o[0] + fine.voxelSize / 2, o[1] + fine.voxelSize / 2, o[2] + fine.voxelSize / 2],
    gridName: options.gridName ?? 'profile', gridClass: 'FogVolume',
  });
  const image = quantize(built, 'fp8');
  return { buffer: writeNvdb([image]), leaves: built.nodeCounts.leaf, activeVoxels: built.voxelCount };
}
