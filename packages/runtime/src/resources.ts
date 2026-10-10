import type { CloudNoiseAsset, CloudVolumeAsset } from './assets';
import { toHalfBitsRoundDown } from './half';
import { uploadFineBricks, type GpuFineOverlay } from './hero/overlay';

/** A cloud volume on the GPU. Texture axes are source axes (x, map row, up); see work/specs/P1-runtime.md. */
export interface GpuCloudVolume {
  nvdf: GPUTexture;      // rgba8unorm 3D (rgba16float when the asset carries nvdf16)
  sdf: GPUTexture;       // r16float 3D, metres, rounded down
  dims: [number, number, number];
  voxelSize: number;
  /** World-space extent in metres, world axes (x, y-up, z) = (dims.x, dims.z, dims.y) * voxelSize. */
  extentMeters: [number, number, number];
  /**
   * P13-H1: the fine hero overlay (brick pool + indirection over this volume's box), read by the march within
   * `CloudSettings.fineDistance`. Its lattice must be nested in this one (same min corner, fine voxel = voxelSize / 2 or / 4).
   * Who owns it: uploadCloudVolume (an asset with `fine`), importVdb (fineVoxelSize) and stampCloud (fine heroes stamped into the volume)
   * attach overlays the volume's `destroy()` releases; an overlay from uploadFineBricks attached by hand stays the caller's.
   */
  fine?: GpuFineOverlay;
  /** V2: the direct density (r16float 3D, density / densityRef, same lattice as `nvdf`); present = the runtime marches it as-is (no up-rez). Released by `destroy()`. */
  direct?: { density: GPUTexture; densityRef: number };
  destroy(): void;
}

export function uploadCloudVolume(device: GPUDevice, asset: CloudVolumeAsset): GpuCloudVolume {
  const [w, h, d] = asset.dims;
  const size: GPUExtent3D = { width: w, height: h, depthOrArrayLayers: d };
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;
  // D1: a 16-bit NVDF (the profile un-quantised) when the asset carries one; the shaders read texture_3d<f32> either way.
  const nvdf = device.createTexture({ label: `${asset.name} nvdf`, dimension: '3d', format: asset.nvdf16 ? 'rgba16float' : 'rgba8unorm', size, usage });
  if (asset.nvdf16) device.queue.writeTexture({ texture: nvdf }, asset.nvdf16, { bytesPerRow: w * 8, rowsPerImage: h }, size);
  else device.queue.writeTexture({ texture: nvdf }, asset.nvdf, { bytesPerRow: w * 4, rowsPerImage: h }, size);
  const halfs = new Uint16Array(asset.sdfMeters.length);
  for (let i = 0; i < halfs.length; i++) halfs[i] = toHalfBitsRoundDown(asset.sdfMeters[i]);
  const sdf = device.createTexture({ label: `${asset.name} sdf`, dimension: '3d', format: 'r16float', size, usage });
  device.queue.writeTexture({ texture: sdf }, halfs, { bytesPerRow: w * 2, rowsPerImage: h }, size);
  const v = asset.voxelSizeMeters;
  // P13-H3: the fine hero layer's bricks (owned by this volume).
  const fine = asset.fine && uploadFineBricks(device, asset.fine.bricks, asset.name);
  let direct: GpuCloudVolume['direct'];
  if (asset.direct) {
    const density = device.createTexture({ label: `${asset.name} direct density`, dimension: '3d', format: 'r16float', size, usage });
    device.queue.writeTexture({ texture: density }, asset.direct.density, { bytesPerRow: w * 2, rowsPerImage: h }, size);
    direct = { density, densityRef: asset.direct.densityRef };
  }
  return {
    nvdf, sdf, dims: [w, h, d], voxelSize: v,
    extentMeters: [w * v, d * v, h * v],
    ...(fine ? { fine } : {}),
    ...(direct ? { direct } : {}),
    destroy() { nvdf.destroy(); sdf.destroy(); fine?.destroy(); direct?.density.destroy(); },
  };
}

export function uploadCloudNoise(device: GPUDevice, asset: CloudNoiseAsset): GPUTexture {
  const n = asset.size;
  // D1: the 16-bit noise when the asset carries it (the 8-bit one's 1/255 steps print contour bands into the fringe at a high view extinction).
  const wide = asset.mips16 && asset.mips16.length === asset.mips.length ? asset.mips16 : null;
  const texture = device.createTexture({
    label: 'cloud noise', dimension: '3d', format: wide ? 'rgba16float' : 'rgba8unorm', mipLevelCount: asset.mips.length,
    size: { width: n, height: n, depthOrArrayLayers: n }, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  (wide ?? asset.mips).forEach((data, level) => {
    const s = Math.max(1, n >> level);
    device.queue.writeTexture({ texture, mipLevel: level }, data, { bytesPerRow: s * (wide ? 8 : 4), rowsPerImage: s }, { width: s, height: s, depthOrArrayLayers: s });
  });
  return texture;
}
