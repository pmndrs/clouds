// H1 (L1): the NDF texture (procedural/hzd/ndf.wgsl.ts): generated on the GPU from HzdNdfSettings, or uploaded from authored field data.
import type { HzdNdfSettings } from '../settings';
import { hzdNdfKey } from '../settings';
import { HZD_NDF_GEN_WGSL, HZD_NDF_IMAGE_WGSL } from './ndf.wgsl';

export interface HzdNdf {
  /** rgba8unorm 2D array, 2 layers: 0 = (coverage, topType, bottomType, 0), 1 = (minHeight, maxHeight, 0, 0). */
  texture: GPUTexture;
  /** hzdNdfKey of the settings it was generated from ('' for uploaded data). */
  key: string;
}

const usage = () => GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;

/** The generator's uniform (NdfGen in ndf.wgsl.ts). */
export function packHzdNdfGen(n: HzdNdfSettings): Float32Array<ArrayBuffer> {
  return new Float32Array([
    n.coverageCells, n.islandCells, n.typeCells, 3,
    n.islandWeight, n.coverageLo, n.coverageHi, n.seed,
    n.typeMin, n.typeMax, n.bottomType, n.bottomTypeRange,
    n.minHeight, n.maxHeight, n.heightVariation, n.bottomTypeCells,
    n.footprint, n.worleyCells, n.bottomTypeCorrelation, 0,
    n.recipe === 'n17' ? 1 : 0, n.gateCells, n.gateLo, Math.max(n.gateHi, n.gateLo + 1e-3),
    n.footLo, Math.max(n.footHi, n.footLo + 1e-3), n.typeContrast, n.islandGain,
  ]);
}

/** Generate the procedural NDF (one compute dispatch, well under a millisecond at 512^2). */
export function generateHzdNdf(device: GPUDevice, n: HzdNdfSettings): HzdNdf {
  const size = Math.max(8, Math.round(n.resolution));
  const texture = device.createTexture({ label: 'hzd ndf', size: [size, size, 2], format: 'rgba8unorm', usage: usage() });
  const data = packHzdNdfGen(n);
  const buffer = device.createBuffer({ label: 'hzd ndf gen', size: data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(buffer, 0, data);
  const pipeline = device.createComputePipeline({ label: 'hzd ndf gen', layout: 'auto', compute: { module: device.createShaderModule({ label: 'hzd ndf gen', code: HZD_NDF_GEN_WGSL }), entryPoint: 'generate' } });
  const enc = device.createCommandEncoder({ label: 'hzd ndf gen' });
  const pass = enc.beginComputePass({ label: 'hzd ndf gen' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer } }, { binding: 1, resource: texture.createView({ dimension: '2d-array' }) }] }));
  pass.dispatchWorkgroups(Math.ceil(size / 8), Math.ceil(size / 8));
  pass.end();
  device.queue.submit([enc.finish()]);
  void device.queue.onSubmittedWorkDone().then(() => buffer.destroy());
  return { texture, key: hzdNdfKey(n) };
}

/**
 * Upload an authored NDF (W2 maps, a paint layer): `fields` holds size^2 bytes per field, row-major with x fastest, in the spec's order.
 * Missing fields default to bottomType 0, minHeight 0, maxHeight 255.
 */
export function uploadHzdNdf(device: GPUDevice, size: number, fields: { coverage: Uint8Array; topType: Uint8Array; bottomType?: Uint8Array; minHeight?: Uint8Array; maxHeight?: Uint8Array }): HzdNdf {
  const texture = device.createTexture({ label: 'hzd ndf (uploaded)', size: [size, size, 2], format: 'rgba8unorm', usage: usage() });
  const a = new Uint8Array(size * size * 4), b = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    a[i * 4] = fields.coverage[i]; a[i * 4 + 1] = fields.topType[i]; a[i * 4 + 2] = fields.bottomType?.[i] ?? 0;
    b[i * 4] = fields.minHeight?.[i] ?? 0; b[i * 4 + 1] = fields.maxHeight?.[i] ?? 255;
  }
  device.queue.writeTexture({ texture, origin: [0, 0, 0] }, a, { bytesPerRow: size * 4, rowsPerImage: size }, [size, size, 1]);
  device.queue.writeTexture({ texture, origin: [0, 0, 1] }, b, { bytesPerRow: size * 4, rowsPerImage: size }, [size, size, 1]);
  return { texture, key: '' };
}

/** Fetch and decode an image as stored bytes (no colour conversion, no premultiplication: the channels are data). */
async function loadImageTexture(device: GPUDevice, url: string): Promise<GPUTexture> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NDF image ${url}: HTTP ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const texture = device.createTexture({ label: `hzd ndf image ${url}`, size: [bitmap.width, bitmap.height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
  device.queue.copyExternalImageToTexture({ source: bitmap }, { texture, premultipliedAlpha: false }, [bitmap.width, bitmap.height]);
  bitmap.close();
  return texture;
}

/**
 * W1 authored map: write `n.image` (layer 0: R coverage, G top type, B bottom type) and `n.heightImage` (layer 1: R min, G max height) into
 * `ndf`'s texture, in place, resampled to its resolution with the image centre at the world origin (HZD_NDF_IMAGE_WGSL). Layers without an
 * image keep the generated fields. Resolves once the GPU work is queued; the returned key adds the image URLs to the generator's.
 */
export async function applyHzdNdfImages(device: GPUDevice, ndf: HzdNdf, n: Pick<HzdNdfSettings, 'image' | 'heightImage'>): Promise<HzdNdf> {
  const [a, b] = await Promise.all([n.image ? loadImageTexture(device, n.image) : null, n.heightImage ? loadImageTexture(device, n.heightImage) : null]);
  const dummy = device.createTexture({ label: 'hzd ndf image dummy', size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
  const flags = device.createBuffer({ label: 'hzd ndf image flags', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(flags, 0, new Float32Array([a ? 1 : 0, b ? 1 : 0, 0, 0]));
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat' });
  const pipeline = device.createComputePipeline({ label: 'hzd ndf image', layout: 'auto', compute: { module: device.createShaderModule({ label: 'hzd ndf image', code: HZD_NDF_IMAGE_WGSL }), entryPoint: 'overlay' } });
  const enc = device.createCommandEncoder({ label: 'hzd ndf image' });
  const pass = enc.beginComputePass({ label: 'hzd ndf image' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: flags } }, { binding: 1, resource: (a ?? dummy).createView() }, { binding: 2, resource: (b ?? dummy).createView() },
    { binding: 3, resource: sampler }, { binding: 4, resource: ndf.texture.createView({ dimension: '2d-array' }) },
  ] }));
  const size = ndf.texture.width;
  pass.dispatchWorkgroups(Math.ceil(size / 8), Math.ceil(size / 8));
  pass.end();
  device.queue.submit([enc.finish()]);
  void device.queue.onSubmittedWorkDone().then(() => { a?.destroy(); b?.destroy(); dummy.destroy(); flags.destroy(); });
  return { texture: ndf.texture, key: hzdNdfImageKey(ndf.key, n) };
}

/** The key of a generated map with images applied. */
export const hzdNdfImageKey = (key: string, n: Pick<HzdNdfSettings, 'image' | 'heightImage'>) => (n.image || n.heightImage ? `${key}|${n.image}|${n.heightImage}` : key);
