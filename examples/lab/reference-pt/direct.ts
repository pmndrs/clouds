// P0.4 scene card: one density field, two renderers. Every card cloud but Parkouring reaches both sides from ONE f32 field on the runtime's
// lattice (texture axes x, map row = +z, up = +y; x fastest, as vdb-direct.ts resamples a VDB onto it):
//   runtime: packDirectVolume (vdb-sky's route A pack: r16f density / densityRef marched as-is, NVDF R for the light grid and shadow map, SDF)
//            with CloudSettings.directDensity = the cloud's extinction scale, so sigma = directDensity * densityRef * texel;
//   path tracer: the SAME r16f texels, decoded back to f32 and reordered to world axes (x, y, z; x fastest), with sigma_t = the same
//            directDensity * densityRef per unit. Same lattice, same box, same values, both trilinear: the only difference left is the GPU's
//            filtering precision and the march's stepping (checked by alpha vs rtalpha).
import type { GpuCloudVolume } from '@clouds/runtime';
import { fromHalfBits, toHalfBits } from '../../../packages/runtime/src/half';
import { directDensityRef, packDirectVolume, type DirectInfo } from '../vdb-sky/vdb-direct';
import type { DensityGrid, V3 } from './bake';

/** World grid (x, y, z) -> runtime lattice (x, row = z, up = y). */
export function worldToLattice(g: DensityGrid): { density: Float32Array; dims: V3 } {
  const [nx, ny, nz] = g.resolution;
  const out = new Float32Array(nx * ny * nz);
  for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) {
    const src = nx * (y + ny * z), dst = nx * (z + nz * y);
    out.set(g.density.subarray(src, src + nx), dst);
  }
  return { density: out, dims: [nx, nz, ny] };
}

export interface DirectCloud {
  volume: GpuCloudVolume;
  info: DirectInfo;
  /** World-axis grid of the r16f texels the runtime marches (density / densityRef), for the path tracer. */
  ptGrid: DensityGrid;
  /** sigma_t per unit of ptGrid (1/m): the runtime's extinction() for this volume. */
  ptExtinction: number;
  /** CloudSettings.directDensity to set (the cloud's extinction scale per source unit). */
  directDensity: number;
}

/**
 * Build both sides from lattice density (`dims` = texture w, h (row), d (up)) at `voxel` metres with world min corner `min`. `scale` is sigma per
 * source unit (1/m): 0.6 for a VDB at vdb-sky's presentation, 1 for a procedural bake (its values are already 1/m).
 */
export async function buildDirectCloud(device: GPUDevice, lattice: Float32Array, dims: V3, voxel: number, min: V3, scale: number, label: string): Promise<DirectCloud> {
  const t0 = performance.now();
  const packed = await packDirectVolume(device, lattice, dims, voxel, label);
  const { ref } = directDensityRef(lattice);
  if (Math.abs(ref - packed.info.densityRef) > 1e-9 * Math.max(1, ref)) throw new Error('direct cloud: densityRef mismatch');
  const [w, h, d] = dims;   // x, row (z), up (y)
  const density = new Float32Array(w * h * d);
  let densityMax = 0, occupied = 0;
  for (let y = 0; y < d; y++) for (let z = 0; z < h; z++) {
    const src = w * (z + h * y), dst = w * (y + d * z);
    for (let x = 0; x < w; x++) {
      const v = fromHalfBits(toHalfBits(lattice[src + x] / ref));
      density[dst + x] = v;
      if (v > densityMax) densityMax = v;
      if (v > 0) occupied++;
    }
  }
  const ptGrid: DensityGrid = { resolution: [w, d, h], min: [...min], max: [min[0] + w * voxel, min[1] + d * voxel, min[2] + h * voxel], voxel, density, densityMax, occupancy: occupied / density.length, ms: performance.now() - t0 };
  return { volume: packed.volume, info: packed.info, ptGrid, ptExtinction: scale * ref, directDensity: scale };
}

/** The occupied box of a world grid (voxels above `threshold` of its max), in metres. */
export function occupiedBox(g: DensityGrid, threshold = 1e-4): { min: V3; max: V3 } {
  const [nx, ny, nz] = g.resolution;
  const lo = [nx, ny, nz], hi = [-1, -1, -1];
  const cut = g.densityMax * threshold;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
    const row = nx * (y + ny * z);
    for (let x = 0; x < nx; x++) {
      if (g.density[row + x] <= cut) continue;
      if (x < lo[0]) lo[0] = x; if (y < lo[1]) lo[1] = y; if (z < lo[2]) lo[2] = z;
      if (x > hi[0]) hi[0] = x; if (y > hi[1]) hi[1] = y; if (z > hi[2]) hi[2] = z;
    }
  }
  return { min: [0, 1, 2].map(a => g.min[a] + lo[a] * g.voxel) as V3, max: [0, 1, 2].map(a => g.min[a] + (hi[a] + 1) * g.voxel) as V3 };
}
