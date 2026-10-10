// H1 (L1): the NDF texture (procedural/hzd/ndf.wgsl.ts): generated on the GPU from HzdNdfSettings, or uploaded from authored field data.
import type { HzdNdfSettings } from '../settings';
import { hzdNdfKey } from '../settings';
import { HZD_NDF_GEN_WGSL } from './ndf.wgsl';

export interface HzdNdf {
  /** rgba8unorm 2D array, 2 layers: 0 = (coverage, topType, bottomType, 0), 1 = (minHeight, maxHeight, 0, 0). */
  texture: GPUTexture;
  /** hzdNdfKey of the settings it was generated from ('' for uploaded data). */
  key: string;
}

const USAGE = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;

/** Generate the procedural NDF (one compute dispatch, well under a millisecond at 512^2). */
export function generateHzdNdf(device: GPUDevice, n: HzdNdfSettings): HzdNdf {
  const size = Math.max(8, Math.round(n.resolution));
  const texture = device.createTexture({ label: 'hzd ndf', size: [size, size, 2], format: 'rgba8unorm', usage: USAGE });
  const buffer = device.createBuffer({ label: 'hzd ndf gen', size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(buffer, 0, new Float32Array([
    n.coverageCells, n.islandCells, n.typeCells, 3,
    n.islandWeight, n.coverageLo, n.coverageHi, n.seed,
    n.typeMin, n.typeMax, n.bottomType, 0,
    n.minHeight, n.maxHeight, n.heightVariation, 0,
    n.footprint, n.worleyCells, 0, 0,
  ]));
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
  const texture = device.createTexture({ label: 'hzd ndf (uploaded)', size: [size, size, 2], format: 'rgba8unorm', usage: USAGE });
  const a = new Uint8Array(size * size * 4), b = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    a[i * 4] = fields.coverage[i]; a[i * 4 + 1] = fields.topType[i]; a[i * 4 + 2] = fields.bottomType?.[i] ?? 0;
    b[i * 4] = fields.minHeight?.[i] ?? 0; b[i * 4 + 1] = fields.maxHeight?.[i] ?? 255;
  }
  device.queue.writeTexture({ texture, origin: [0, 0, 0] }, a, { bytesPerRow: size * 4, rowsPerImage: size }, [size, size, 1]);
  device.queue.writeTexture({ texture, origin: [0, 0, 1] }, b, { bytesPerRow: size * 4, rowsPerImage: size }, [size, size, 1]);
  return { texture, key: '' };
}
