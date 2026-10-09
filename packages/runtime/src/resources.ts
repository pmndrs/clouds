import type { CloudNoiseAsset, CloudVolumeAsset } from './assets';
import { toHalfBitsRoundDown } from './half';
import { uploadFineProfile, type GpuFineOverlay } from './hero/overlay';

/** A cloud volume on the GPU. Texture axes are source axes (x, map row, up); see work/specs/P1-runtime.md. */
export interface GpuCloudVolume {
  nvdf: GPUTexture;      // rgba8unorm 3D
  sdf: GPUTexture;       // r16float 3D, metres, rounded down
  dims: [number, number, number];
  voxelSize: number;
  /** World-space extent in metres, world axes (x, y-up, z) = (dims.x, dims.z, dims.y) * voxelSize. */
  extentMeters: [number, number, number];
  /**
   * P13-H1: the fine hero overlay (brick pool + indirection over this volume's box), read by the march within
   * `CloudSettings.fineDistance`. Its lattice must be nested in this one (same min corner, fine voxel = voxelSize / 2 or / 4).
   * `destroy()` releases it only when the code that attached it says so (uploadFineBricks results are caller-owned).
   */
  fine?: GpuFineOverlay;
  destroy(): void;
}

export function uploadCloudVolume(device: GPUDevice, asset: CloudVolumeAsset): GpuCloudVolume {
  const [w, h, d] = asset.dims;
  const size: GPUExtent3D = { width: w, height: h, depthOrArrayLayers: d };
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;
  const nvdf = device.createTexture({ label: `${asset.name} nvdf`, dimension: '3d', format: 'rgba8unorm', size, usage });
  device.queue.writeTexture({ texture: nvdf }, asset.nvdf, { bytesPerRow: w * 4, rowsPerImage: h }, size);
  const halfs = new Uint16Array(asset.sdfMeters.length);
  for (let i = 0; i < halfs.length; i++) halfs[i] = toHalfBitsRoundDown(asset.sdfMeters[i]);
  const sdf = device.createTexture({ label: `${asset.name} sdf`, dimension: '3d', format: 'r16float', size, usage });
  device.queue.writeTexture({ texture: sdf }, halfs, { bytesPerRow: w * 2, rowsPerImage: h }, size);
  const v = asset.voxelSizeMeters;
  // P13-H3: the fine hero profile (owned by this volume): bricks plus the coarse G/B, filled on the GPU.
  const fine = asset.fine && uploadFineProfile(device, asset.fine.bricks, nvdf, asset.dims, asset.name);
  return {
    nvdf, sdf, dims: [w, h, d], voxelSize: v,
    extentMeters: [w * v, d * v, h * v],
    ...(fine ? { fine } : {}),
    destroy() { nvdf.destroy(); sdf.destroy(); fine?.destroy(); },
  };
}

export function uploadCloudNoise(device: GPUDevice, asset: CloudNoiseAsset): GPUTexture {
  const n = asset.size;
  const texture = device.createTexture({
    label: 'cloud noise', dimension: '3d', format: 'rgba8unorm', mipLevelCount: asset.mips.length,
    size: { width: n, height: n, depthOrArrayLayers: n }, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  asset.mips.forEach((data, level) => {
    const s = Math.max(1, n >> level);
    device.queue.writeTexture({ texture, mipLevel: level }, data, { bytesPerRow: s * 4, rowsPerImage: s }, { width: s, height: s, depthOrArrayLayers: s });
  });
  return texture;
}
