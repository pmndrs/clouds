// In-browser .vdb import: drop a VDB, get a Nubis cloud volume. Renderer-agnostic (WebGPU device only, no three).
//
//   const { volume, info } = await importVdb(device, await file.arrayBuffer(), { voxelSize: 8, targetWidthMeters: 1500 });
//   await clouds.setVolume(volume, { position: [0, 500, 0] });   // caller owns `volume` (volume.destroy())
//
// CPU: parse (packages/runtime/vendor/vdb-web-tools: FloatGrid 5-4-3; uncompressed, ZIP and lz4-Blosc), pick the grids, resample to the runtime
// voxel size, derive the NVDF channels (the Nubis pack VDBs carry them; artist fog / level-set VDBs get the P4-B PACK_FIT mapping).
// GPU: the SDF by the jump flood of createSdfRebuilder (2 rounds), as for stamped clouds.
import type { GpuCloudVolume } from '../resources';
import { createEmptyCloudVolume, createSdfRebuilder } from '../generate/stamp';
import { convertVdb, type ConvertedVdb, type VdbImportInfo, type VdbImportOptions } from './convert';

export { convertVdb, inspectVdb, VdbImportError, BLOSC_HELP } from './convert';
export type { ConvertedVdb, VdbGridSummary, VdbImportErrorCode, VdbImportInfo, VdbImportMode, VdbImportOptions, VdbImportTimings } from './convert';
export { PACK_FIT } from './pack-fit';

export interface ImportedVdb {
  volume: GpuCloudVolume;
  info: VdbImportInfo;
}

/** Write an already converted VDB into a GPU volume (NVDF upload, then the SDF jump flood). Resolves when the GPU has finished. */
export async function uploadConvertedVdb(device: GPUDevice, converted: ConvertedVdb, label = 'vdb import'): Promise<{ volume: GpuCloudVolume; uploadMs: number; sdfGpuMs: number }> {
  const [w, h, d] = converted.dims;
  const t0 = performance.now();
  const volume = createEmptyCloudVolume(device, converted.dims, converted.voxelSize, label);
  device.queue.writeTexture({ texture: volume.nvdf }, converted.nvdf, { bytesPerRow: w * 4, rowsPerImage: h }, { width: w, height: h, depthOrArrayLayers: d });
  await device.queue.onSubmittedWorkDone();
  const t1 = performance.now();
  const rebuilder = createSdfRebuilder(device, volume, { rounds: 2, label: `${label} sdf` });
  const encoder = device.createCommandEncoder({ label: `${label} sdf` });
  rebuilder.generate(encoder);
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  rebuilder.destroy();
  return { volume, uploadMs: t1 - t0, sdfGpuMs: performance.now() - t1 };
}

/**
 * Import a .vdb file: `arrayBuffer` is the file. Throws VdbImportError (code 'blosc' | 'unsupported-codec' | 'unsupported-grid' | ...)
 * with a message that says what to change in Houdini where that helps. The returned volume is caller-owned.
 */
export async function importVdb(device: GPUDevice, arrayBuffer: ArrayBuffer, options: VdbImportOptions = {}): Promise<ImportedVdb> {
  const t0 = performance.now();
  const converted = convertVdb(arrayBuffer, options);
  const { volume, uploadMs, sdfGpuMs } = await uploadConvertedVdb(device, converted);
  const info = converted.info;
  info.timings.uploadMs = uploadMs;
  info.timings.sdfGpuMs = sdfGpuMs; // pipeline creation, 2 jump-flood rounds and the copy, to GPU completion
  info.timings.totalMs = performance.now() - t0;
  return { volume, info };
}
