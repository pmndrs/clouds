// H1 (L1): the NDF texture (procedural/hzd/ndf.wgsl.ts): generated on the GPU from HzdNdfSettings, or uploaded from authored field data.
import type { HzdNdfSettings } from '../settings';
import { hzdNdfKey } from '../settings';
import { HZD_NDF_COMPOSE_WGSL, HZD_NDF_GEN_WGSL, HZD_NDF_IMAGE_WGSL, HZD_NDF_PAINT_IMAGE_WGSL } from './ndf.wgsl';

export interface HzdNdf {
  /** rgba8unorm 2D array, 2 layers: 0 = (coverage, topType, bottomType, cirrusType), 1 = (minHeight, maxHeight, storm, cirrusCoverage). CI1: the alphas are the thin-cloud fields (cirrusType stored 0.1 + 0.9 x type; 0 = no data, as in authored and image-overlaid maps). */
  texture: GPUTexture;
  /** hzdNdfKey of the settings it was generated from ('' for uploaded data). */
  key: string;
}

const usage = () => GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;

/** The generator's uniform (NdfGen in ndf.wgsl.ts). */
export function packHzdNdfGen(n: HzdNdfSettings): Float32Array<ArrayBuffer> {
  return new Float32Array([
    n.coverageCells, n.islandCells, n.typeCells, n.heightCells,
    n.islandWeight, n.coverageLo, n.coverageHi, n.seed,
    n.typeMin, n.typeMax, n.bottomType, n.bottomTypeRange,
    n.minHeight, n.maxHeight, n.heightVariation, n.bottomTypeCells,
    n.footprint, n.worleyCells, n.bottomTypeCorrelation, 0,
    n.recipe === 'n17' ? 1 : 0, n.gateCells, n.gateLo, Math.max(n.gateHi, n.gateLo + 1e-3),
    n.footLo, Math.max(n.footHi, n.footLo + 1e-3), n.typeContrast, n.islandGain,
    // STORM1: the default storm blob in uv units (the generator's uv * tile = world metres)
    n.stormX / n.tileMeters, n.stormZ / n.tileMeters, Math.max(n.stormRadius, 1) / n.tileMeters, Math.max(n.stormBlob, 0),
    // CI1: the thin-cloud fields
    n.cirrusCells, n.cirrusTypeCells, n.cirrusContrast, 0,
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
export function uploadHzdNdf(device: GPUDevice, size: number, fields: HzdNdfFields): HzdNdf {
  const texture = device.createTexture({ label: 'hzd ndf (uploaded)', size: [size, size, 2], format: 'rgba8unorm', usage: usage() });
  writeHzdNdf(device, texture, fields);
  return { texture, key: '' };
}

export interface HzdNdfFields { coverage: Uint8Array; topType: Uint8Array; bottomType?: Uint8Array; minHeight?: Uint8Array; maxHeight?: Uint8Array;
  /** W2: the influence mask (size^2 bytes, 255 = painted). Only written into a paint texture (3 layers, see createHzdPaintTexture). */
  influence?: Uint8Array;
  /** STORM1: the storm area (size^2 bytes, 255 = a storm core), layer 1's B. Missing = 0 (no painted storm). */
  storm?: Uint8Array }

/** Write authored fields into an existing NDF texture of the same size, in place (the bench's map painter, one write per stroke update). */
export function writeHzdNdf(device: GPUDevice, texture: GPUTexture, fields: HzdNdfFields): void {
  const size = texture.width;
  const a = new Uint8Array(size * size * 4), b = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    a[i * 4] = fields.coverage[i]; a[i * 4 + 1] = fields.topType[i]; a[i * 4 + 2] = fields.bottomType?.[i] ?? 0;
    b[i * 4] = fields.minHeight?.[i] ?? 0; b[i * 4 + 1] = fields.maxHeight?.[i] ?? 255; b[i * 4 + 2] = fields.storm?.[i] ?? 0;
  }
  device.queue.writeTexture({ texture, origin: [0, 0, 0] }, a, { bytesPerRow: size * 4, rowsPerImage: size }, [size, size, 1]);
  device.queue.writeTexture({ texture, origin: [0, 0, 1] }, b, { bytesPerRow: size * 4, rowsPerImage: size }, [size, size, 1]);
  if (fields.influence && texture.depthOrArrayLayers >= 3) {
    const c = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) c[i * 4] = fields.influence[i];
    device.queue.writeTexture({ texture, origin: [0, 0, 2] }, c, { bytesPerRow: size * 4, rowsPerImage: size }, [size, size, 1]);
  }
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
export const hzdNdfImageKey = (key: string, n: Pick<HzdNdfSettings, 'image' | 'heightImage'> & Partial<Pick<HzdNdfSettings, 'maskImage' | 'paintBlend'>>) =>
  (n.image || n.heightImage ? `${key}|${n.image}|${n.heightImage}|${n.maskImage ?? ''}|${n.paintBlend ?? ''}` : key);

// ---- W2: the paint texture, the influence mask, and the compose pass (weather transitions + painted influence) ----

/** A 3-layer rgba8 texture: 0 = painted (coverage, topType, bottomType), 1 = painted (minHeight, maxHeight), 2 = the influence mask (R). */
export function createHzdPaintTexture(device: GPUDevice, size: number): GPUTexture {
  return device.createTexture({ label: 'hzd ndf paint', size: [size, size, 3], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST });
}

/** W2: resample `image` / `heightImage` / `maskImage` into a paint texture (centred on the world origin, as applyHzdNdfImages). No mask image = mask 1 everywhere. */
export async function applyHzdPaintImages(device: GPUDevice, paint: GPUTexture, n: Pick<HzdNdfSettings, 'image' | 'heightImage' | 'maskImage'>): Promise<void> {
  const [a, b, m] = await Promise.all([n.image ? loadImageTexture(device, n.image) : null, n.heightImage ? loadImageTexture(device, n.heightImage) : null, n.maskImage ? loadImageTexture(device, n.maskImage) : null]);
  const dummy = device.createTexture({ label: 'hzd ndf paint dummy', size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
  const flags = device.createBuffer({ label: 'hzd ndf paint flags', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(flags, 0, new Float32Array([a ? 1 : 0, b ? 1 : 0, m ? 1 : 0, 0]));
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat' });
  const pipeline = device.createComputePipeline({ label: 'hzd ndf paint image', layout: 'auto', compute: { module: device.createShaderModule({ label: 'hzd ndf paint image', code: HZD_NDF_PAINT_IMAGE_WGSL }), entryPoint: 'paintImages' } });
  const enc = device.createCommandEncoder({ label: 'hzd ndf paint image' });
  const pass = enc.beginComputePass({ label: 'hzd ndf paint image' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: flags } }, { binding: 1, resource: (a ?? dummy).createView() }, { binding: 2, resource: (b ?? dummy).createView() },
    { binding: 3, resource: (m ?? dummy).createView() }, { binding: 4, resource: sampler }, { binding: 5, resource: paint.createView({ dimension: '2d-array' }) },
  ] }));
  pass.dispatchWorkgroups(Math.ceil(paint.width / 8), Math.ceil(paint.width / 8));
  pass.end();
  device.queue.submit([enc.finish()]);
  void device.queue.onSubmittedWorkDone().then(() => { a?.destroy(); b?.destroy(); m?.destroy(); dummy.destroy(); flags.destroy(); });
}

export interface HzdNdfComposeInput {
  a: GPUTexture;
  b: GPUTexture;
  /** 0..1, the eased transition position (0 = all A). */
  t: number;
  /** Additive coverage and type biases of A and B. */
  biasA: [number, number];
  biasB: [number, number];
  paint: GPUTexture | null;
  paintHeights: boolean;
  blend: 'replace' | 'influence';
  gains: [number, number, number];
  out: GPUTexture;
}

const composeCache = new WeakMap<GPUDevice, { pipeline: GPUComputePipeline; sampler: GPUSampler; dummy: GPUTexture; uniform: GPUBuffer }>();

/** W2: write the served NDF (see HZD_NDF_COMPOSE_WGSL). One dispatch over `out` (about 0.1 ms at 1024^2, run on a change, not per frame). */
export function composeHzdNdf(device: GPUDevice, c: HzdNdfComposeInput): void {
  let r = composeCache.get(device);
  if (!r) {
    r = {
      pipeline: device.createComputePipeline({ label: 'hzd ndf compose', layout: 'auto', compute: { module: device.createShaderModule({ label: 'hzd ndf compose', code: HZD_NDF_COMPOSE_WGSL }), entryPoint: 'compose' } }),
      sampler: device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat' }),
      dummy: device.createTexture({ label: 'hzd ndf compose dummy', size: [1, 1, 3], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING }),
      uniform: device.createBuffer({ label: 'hzd ndf compose', size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
    };
    composeCache.set(device, r);
  }
  device.queue.writeBuffer(r.uniform, 0, new Float32Array([c.t, c.paint ? 1 : 0, c.blend === 'replace' ? 1 : 0, c.paintHeights ? 1 : 0, c.biasA[0], c.biasA[1], c.biasB[0], c.biasB[1], c.gains[0], c.gains[1], c.gains[2], 0]));
  const view = (t: GPUTexture) => t.createView({ dimension: '2d-array' });
  const enc = device.createCommandEncoder({ label: 'hzd ndf compose' });
  const pass = enc.beginComputePass({ label: 'hzd ndf compose' });
  pass.setPipeline(r.pipeline);
  pass.setBindGroup(0, device.createBindGroup({ layout: r.pipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: r.uniform } }, { binding: 1, resource: view(c.a) }, { binding: 2, resource: view(c.b) },
    { binding: 3, resource: view(c.paint ?? r.dummy) }, { binding: 4, resource: r.sampler }, { binding: 5, resource: view(c.out) },
  ] }));
  pass.dispatchWorkgroups(Math.ceil(c.out.width / 8), Math.ceil(c.out.width / 8));
  pass.end();
  device.queue.submit([enc.finish()]);
}

/** The served texture's storage: same layout as a generated NDF (2 layers) but written by the compose pass. */
export function createHzdComposedTexture(device: GPUDevice, size: number): GPUTexture {
  return device.createTexture({ label: 'hzd ndf composed', size: [size, size, 2], format: 'rgba8unorm', usage: usage() });
}
