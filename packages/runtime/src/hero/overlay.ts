import { BRICK_TEXELS, POOL_SLAB_BRICKS, POOL_SLAB_BYTES, POOL_XY, type FineBricks } from './bricks';

/** A fine hero overlay on the GPU (work/specs/P8-hero-vdb.md section 4.1), bound with its volume as `GpuCloudVolume.fine`. */
export interface GpuFineOverlay {
  /** r32uint 3D, one texel per 8^3 fine voxels (texture axes x, map row, up): brick slot or 0xffffffff. */
  indir: GPUTexture;
  /** rgba8unorm 3D, [320, 320, 10 * slabs]: bricks of 10^3 texels (8^3 payload + apron). */
  pool: GPUTexture;
  /** Fine voxel size in metres. */
  fineVoxel: number;
  cells: [number, number, number];
  /** Pool texture size in texels. */
  poolSize: [number, number, number];
  bricks: number;
  /** GPU bytes of the pool and the indirection. */
  bytes: number;
  /** P13-H3: a CPU copy of the indirection (cell -> slot), read by the fine stamp to find the hero's bricks. */
  indirData?: Uint32Array;
  destroy(): void;
}

const USAGE = () => GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;

function createOverlay(device: GPUDevice, cells: [number, number, number], indirData: Uint32Array<ArrayBuffer>, count: number, fineVoxel: number, label: string): GpuFineOverlay {
  const [cx, cy, cz] = cells;
  const indir = device.createTexture({ label: `${label} indirection`, dimension: '3d', format: 'r32uint', size: cells, usage: USAGE() });
  device.queue.writeTexture({ texture: indir }, indirData, { bytesPerRow: cx * 4, rowsPerImage: cy }, cells);
  const slabs = Math.max(1, Math.ceil(count / POOL_SLAB_BRICKS));
  const poolSize: [number, number, number] = [POOL_XY, POOL_XY, BRICK_TEXELS * slabs];
  const pool = device.createTexture({ label: `${label} brick pool`, dimension: '3d', format: 'rgba8unorm', size: poolSize, usage: USAGE() });
  return {
    indir, pool, fineVoxel, cells: [cx, cy, cz], poolSize, bricks: count, indirData,
    bytes: cx * cy * cz * 4 + slabs * POOL_SLAB_BYTES,
    destroy() { indir.destroy(); pool.destroy(); },
  };
}

/** Upload packed bricks: one writeTexture per 4 MB slab plus the indirection grid. The caller owns the result. */
export function uploadFineBricks(device: GPUDevice, b: FineBricks, label = 'hero'): GpuFineOverlay {
  const o = createOverlay(device, b.cells, b.indir, b.count, b.fineVoxel, label);
  b.slabs.forEach((slab, i) => device.queue.writeTexture({ texture: o.pool, origin: [0, 0, i * BRICK_TEXELS] }, slab, { bytesPerRow: POOL_XY * 4, rowsPerImage: POOL_XY }, [POOL_XY, POOL_XY, BRICK_TEXELS]));
  return o;
}
