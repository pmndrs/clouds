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
import { packFineProfile } from '../hero/bricks';
import { uploadFineProfile } from '../hero/overlay';
import { convertVdb, VdbImportError, type ConvertedVdb, type VdbImportInfo, type VdbImportOptions } from './convert';
import { splitFineLattice, type FineProfile } from './fine';

export { convertVdb, inspectVdb, VdbImportError, BLOSC_HELP } from './convert';
export type { ConvertedVdb, VdbGridSummary, VdbImportErrorCode, VdbImportInfo, VdbImportMode, VdbImportOptions, VdbImportTimings } from './convert';
export { PACK_FIT } from './pack-fit';
export { exportFineNvdb, splitFineLattice, type ExportFineNvdbOptions, type FineProfile } from './fine';
// The fine hero tools (P13-H3): the fine.nvdb reader and the brick packers, for loaders and tools that build their own volumes.
export { decodeFineNvdb, packFineProfile, packFineBricks, reduceFineLattice, uploadFineProfile, type FineProfileBricks, type PackFineOptions } from '../hero';

export interface ImportedVdb {
  volume: GpuCloudVolume;
  info: VdbImportInfo;
  /** With `fineVoxelSize`: the fine profile lattice (for `exportFineNvdb`); the volume's `fine` overlay holds its bricks. */
  fine?: FineProfile;
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
  const fv = options.fineVoxelSize;
  if (!fv) {
    const converted = convertVdb(arrayBuffer, options);
    const { volume, uploadMs, sdfGpuMs } = await uploadConvertedVdb(device, converted);
    const info = converted.info;
    info.timings.uploadMs = uploadMs;
    info.timings.sdfGpuMs = sdfGpuMs; // pipeline creation, 2 jump-flood rounds and the copy, to GPU completion
    info.timings.totalMs = performance.now() - t0;
    return { volume, info };
  }
  // Fine hero: convert once at the fine voxel size, the coarse volume is the P8 reduction of that lattice.
  const v = options.voxelSize ?? 8, ratio = v / fv;
  if (!(Number.isInteger(ratio) && ratio >= 2)) throw new VdbImportError('format', `fineVoxelSize must divide voxelSize by an integer >= 2 (got ${fv} under ${v} m)`);
  const converted = convertVdb(arrayBuffer, { ...options, voxelSize: fv, margin: (options.margin ?? 8) * ratio });
  const tf = performance.now();
  const split = splitFineLattice(converted.nvdf, converted.dims, fv, ratio);
  const fi = converted.info, cd = split.coarse.dims;
  let occ = 0, fineOcc = 0;
  for (let i = 0; i < cd[0] * cd[1] * cd[2]; i++) if (split.coarse.nvdf[i * 4]) occ++;
  for (let i = 0; i < split.fine.profile.length; i++) if (split.fine.profile[i]) fineOcc++;
  const info: VdbImportInfo = {
    ...fi, voxelSizeMeters: v, dims: cd, cropOffset: fi.cropOffset.map(c => c / ratio) as [number, number, number],
    occupiedMin: fi.occupiedMin.map(c => Math.floor(c / ratio)) as [number, number, number], occupiedMax: fi.occupiedMax.map(c => Math.floor(c / ratio)) as [number, number, number],
    occupiedFraction: occ / (cd[0] * cd[1] * cd[2]), sizeMeters: [cd[0] * v, cd[2] * v, cd[1] * v],
  };
  const { volume, uploadMs, sdfGpuMs } = await uploadConvertedVdb(device, { nvdf: split.coarse.nvdf, dims: cd, voxelSize: v, info });
  const bricks = packFineProfile(split.fine.profile, split.fine.dims, fv, Math.ceil(1.5 * ratio));
  const fine = uploadFineProfile(device, bricks, volume.nvdf, cd, 'vdb import fine');
  await device.queue.onSubmittedWorkDone();
  volume.fine = fine;
  const destroy = volume.destroy;
  volume.destroy = () => { fine.destroy(); destroy.call(volume); };
  info.fine = { voxelSizeMeters: fv, dims: split.fine.dims, occupiedFraction: fineOcc / split.fine.profile.length, bricks: fine.bricks, gpuBytes: fine.bytes };
  info.timings.uploadMs = uploadMs;
  info.timings.sdfGpuMs = sdfGpuMs;
  info.timings.fineMs = performance.now() - tf - uploadMs - sdfGpuMs;
  info.timings.totalMs = performance.now() - t0;
  return { volume, info, fine: split.fine };
}
