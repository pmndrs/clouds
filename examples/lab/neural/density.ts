// N2a density source: a Y-up .vdb resampled onto a dense lattice at its native voxel, / p99, as an r16float 3D texture.
// A lean copy of vdb-sky's route A (vdb-direct.ts: readVdbSource, DirectResampler.resample, directDensityRef) without its
// @clouds/runtime import (which pulls the upscaler package this worktree cannot resolve). Lattice axes (x, map row = +Z, up = +Y).
import { VDB_ALL_SCALAR_TYPES, VDBGridPool, vdbModuleEntries, vdbModuleWgsl, type VDBSlot } from '@pmndrs/vdb';
import { buildFromVdbDetailed, parseVdb } from '@pmndrs/vdb/tools';
import { toHalfBits } from '../../../packages/runtime/src/half';

const WGSL = /* wgsl */ `
struct Params { dims: vec3u, grid: u32, origin: vec3f, k: f32 }
@group(0) @binding(1) var<uniform> P: Params;
@group(0) @binding(2) var<storage, read_write> outDensity: array<f32>;
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= P.dims)) { return; }
  var acc = vdbAccessorInit(P.grid);
  let f = vec3f(id) + 0.5;
  let w = P.origin + vec3f(f.x, f.z, f.y) * P.k; // texel (x, row, up) -> VDB world (x, y = up, z = row)
  outDensity[(id.z * P.dims.y + id.y) * P.dims.x + id.x] = max(vdbSample(&acc, vdbWorldToIndex(P.grid, w)), 0.0);
}`;

export interface DenseDensity {
  texture: GPUTexture;
  /** Lattice dims (x, row = +Z, up = +Y). */
  dims: [number, number, number];
  gridName: string;
  voxel: number;
  densityRef: number;
}

/** p99 of occupied texels (vdb-direct.ts directDensityRef). */
function p99(density: Float32Array): number {
  let max = 0;
  for (let i = 0; i < density.length; i++) if (density[i] > max) max = density[i];
  const empty = Math.max(1e-7, max * 1e-4), BINS = 4096, hist = new Uint32Array(BINS);
  let occupied = 0;
  for (let i = 0; i < density.length; i++) { const v = density[i]; if (v > empty) { occupied++; hist[Math.min(BINS - 1, Math.floor((v / max) * BINS))]++; } }
  let seen = 0;
  for (let b = 0; b < BINS; b++) { seen += hist[b]; if (seen >= occupied * 0.99) return Math.max(((b + 1) / BINS) * max, 1e-6); }
  return Math.max(max, 1e-6);
}

export async function loadDenseVdb(device: GPUDevice, name: string, bytes: ArrayBuffer, margin = 2): Promise<DenseDensity> {
  const vdb = parseVdb(bytes);
  const g = vdb.grids.find(x => x.name === 'density') ?? vdb.grids[0];
  if (!g) throw new Error(`${name}: no grid`);
  const built = buildFromVdbDetailed(g);
  const pool = await VDBGridPool.create(device, { label: 'n2a' });
  const id = pool.add(built.image, { label: name });
  pool.flush(); await pool.settled();
  const info = pool.info(id);
  const k = Math.max(...info.voxelSize);
  const lo = info.worldBBox.min, hi = info.worldBBox.max;
  const dims: [number, number, number] = [
    Math.ceil((hi[0] - lo[0]) / k) + 2 * margin, Math.ceil((hi[2] - lo[2]) / k) + 2 * margin, Math.ceil((hi[1] - lo[1]) / k) + 2 * margin,
  ];
  const origin = [lo[0] - margin * k, lo[1] - margin * k, lo[2] - margin * k];

  const slot: VDBSlot = { group: 0, firstBinding: 0 };
  const C = GPUShaderStage.COMPUTE;
  const layout = device.createBindGroupLayout({ entries: [...vdbModuleEntries({ slot, visibility: C }), { binding: 1, visibility: C, buffer: { type: 'uniform' } }, { binding: 2, visibility: C, buffer: { type: 'storage' } }] });
  const code = vdbModuleWgsl({ slot, types: VDB_ALL_SCALAR_TYPES, profile: 'sample', outside: 'zero' }) + WGSL;
  const pipeline = device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), compute: { module: device.createShaderModule({ code }), entryPoint: 'main' } });
  const params = new ArrayBuffer(32);
  new Uint32Array(params).set([...dims, id], 0);
  new Float32Array(params).set([origin[0], origin[1], origin[2], k], 4);
  const ubo = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(ubo, 0, params);
  const count = dims[0] * dims[1] * dims[2];
  const out = device.createBuffer({ size: count * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const read = device.createBuffer({ size: count * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  pool.update(enc);
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, device.createBindGroup({ layout, entries: [pool.bindGroupEntry(slot), { binding: 1, resource: { buffer: ubo } }, { binding: 2, resource: { buffer: out } }] }));
  pass.dispatchWorkgroups(Math.ceil(dims[0] / 4), Math.ceil(dims[1] / 4), Math.ceil(dims[2] / 4));
  pass.end();
  enc.copyBufferToBuffer(out, 0, read, 0, count * 4);
  device.queue.submit([enc.finish()]);
  await read.mapAsync(GPUMapMode.READ);
  const density = new Float32Array(read.getMappedRange().slice(0));
  read.unmap(); read.destroy(); out.destroy(); ubo.destroy(); pool.dispose();

  const ref = p99(density);
  const half = new Uint16Array(count);
  for (let i = 0; i < count; i++) half[i] = toHalfBits(density[i] / ref);
  const texture = device.createTexture({ label: `n2a ${name}`, dimension: '3d', format: 'r16float', size: dims, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture }, half, { bytesPerRow: dims[0] * 2, rowsPerImage: dims[1] }, dims);
  return { texture, dims, gridName: g.name, voxel: k, densityRef: ref };
}

/** Device limits for a VDBGridPool (vdb-direct.ts vdbDeviceLimits without the runtime import). */
export function vdbLimits(adapter: GPUAdapter): Record<string, number> {
  const limits = VDBGridPool.requiredLimits(adapter);
  return { ...limits, maxBufferSize: Math.max(limits.maxBufferSize ?? 0, Math.min(adapter.limits.maxBufferSize, 2 ** 31)), maxStorageBufferBindingSize: Math.max(limits.maxStorageBufferBindingSize ?? 0, Math.min(adapter.limits.maxStorageBufferBindingSize, 2 ** 31 - 4)) };
}
