// V1 route A: a .vdb / .nvdb read by @pmndrs/vdb, resampled on the GPU from its sparse NanoVDB pool into a runtime *direct* volume
// (V2 / M1: the VDB's density marched as-is, lit by the runtime's Nubis / octave lighting and the sky). This is vdb_to_direct.py's
// output built in the browser:
//
//   file bytes --(CPU: NvdbFile, or parseVdb + buildFromVdbDetailed)--> NanoVDB grid image --(VDBGridPool.add)--> sparse pool on our device
//   --(one compute pass: vdbModuleWgsl 'sample' profile, an n^3 box of trilinear taps per texel)--> f32 density on the runtime lattice
//   --(readback; CPU: p99 densityRef, r16f density / densityRef, rgba8 NVDF R = saturate(density / densityRef))--> GpuCloudVolume.direct
//   --(createSdfRebuilder, 2 jump-flood rounds)--> empty-space SDF.
//
// The runtime still marches a dense lattice: the pool is sparse, the march is not (see work/reports/V1-vdb-sky.md "gaps").
import { VDB_ALL_SCALAR_TYPES, VDBGridPool, vdbModuleEntries, vdbModuleWgsl, type VDBSlot } from '@pmndrs/vdb';
import { NvdbFile, buildFromVdbDetailed, parseVdb } from '@pmndrs/vdb/tools';
import { createEmptyCloudVolume, createSdfRebuilder, type GpuCloudVolume } from '@clouds/runtime';
import { toHalfBits } from '../../../packages/runtime/src/half';

export type UpAxis = 'y' | 'z';

/** A grid read from a file, on the CPU (the NanoVDB image the pool takes). */
export interface VdbSource {
  name: string;
  image: Uint32Array;
  gridName: string;
  voxels: number;
  fileBytes: number;
  kind: 'vdb' | 'nvdb';
  /** CPU ms: parse (.vdb container or .nvdb header) and the NanoVDB build (.vdb only). */
  parseMs: number;
  buildMs: number;
}

/** Read a .vdb (parseVdb + buildFromVdbDetailed, leaf-streamed) or .nvdb (NvdbFile, zero-copy when it can) and pick the density grid. */
export function readVdbSource(name: string, bytes: ArrayBuffer, grid = 'density'): VdbSource {
  const t0 = performance.now();
  if (/\.nvdb$/i.test(name) || new TextDecoder().decode(new Uint8Array(bytes, 0, 4)) === 'NVDB') {
    const file = NvdbFile.fromArrayBuffer(bytes);
    const i = Math.max(0, file.grids.findIndex(g => g.name === grid));
    const image = file.gridImage(i);
    const t1 = performance.now();
    return { name, image, gridName: file.grids[i]!.name, voxels: Number(file.grids[i]!.voxelCount ?? 0), fileBytes: bytes.byteLength, kind: 'nvdb', parseMs: t1 - t0, buildMs: 0 };
  }
  const vdb = parseVdb(bytes);
  const g = vdb.grids.find(x => x.name === grid) ?? vdb.grids.find(x => x.valueType === 'float' || /float/i.test(String(x.gridType))) ?? vdb.grids[0];
  if (!g) throw new Error(`${name}: no grid`);
  const t1 = performance.now();
  const built = buildFromVdbDetailed(g);
  return { name, image: built.image, gridName: g.name, voxels: built.voxelCount, fileBytes: bytes.byteLength, kind: 'vdb', parseMs: t1 - t0, buildMs: performance.now() - t1 };
}

export interface DirectPlacement {
  /** Metres per VDB world unit. */
  worldScale: number;
  /** Runtime voxel size (m). */
  voxelSize: number;
  up: UpAxis;
  /** Empty texels around the grid's box. Default 4. */
  margin?: number;
}

export interface DirectInfo {
  dims: [number, number, number];
  voxelSize: number;
  /** Box taps per axis (n^3 trilinear samples per texel). */
  taps: number;
  densityRef: number;
  max: number;
  occupied: number;
  /** World-axis size of the box (x, y-up, z), metres. */
  sizeMeters: [number, number, number];
  /** ms: the GPU resample to readback, the CPU pack (densityRef, half floats, NVDF), the texture upload and SDF jump flood. */
  timings: { resampleGpuMs: number; packMs: number; uploadSdfMs: number };
  gpuBytes: number;
}

const WGSL = /* wgsl */ `
struct Params {
  dims: vec3u, taps: u32,
  origin: vec3f, grid: f32,
  ax: vec3f, _a: f32,
  ay: vec3f, _b: f32,
  az: vec3f, _c: f32,
}
@group(0) @binding(1) var<uniform> P: Params;
@group(0) @binding(2) var<storage, read_write> outDensity: array<f32>;

// One texel of the runtime lattice (x, map row, up): the mean of taps^3 trilinear samples spread over the texel's box in the VDB's world.
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= P.dims)) { return; }
  let g = u32(P.grid);
  var acc = vdbAccessorInit(g);
  let n = P.taps;
  var sum = 0.0;
  for (var k = 0u; k < n; k++) {
    for (var j = 0u; j < n; j++) {
      for (var i = 0u; i < n; i++) {
        let f = (vec3f(f32(i), f32(j), f32(k)) + 0.5) / f32(n) + vec3f(id);
        let w = P.origin + P.ax * f.x + P.ay * f.y + P.az * f.z;
        sum += max(vdbSample(&acc, vdbWorldToIndex(g, w)), 0.0);
      }
    }
  }
  outDensity[(id.z * P.dims.y + id.y) * P.dims.x + id.x] = sum / f32(n * n * n);
}
`;

/** One resampler per device + pool (the pipeline is compiled once, for every scalar grid type). */
export class DirectResampler {
  private readonly slot: VDBSlot = { group: 0, firstBinding: 0 };
  private readonly layout: GPUBindGroupLayout;
  private readonly pipeline: GPUComputePipeline;
  constructor(private readonly device: GPUDevice, readonly pool: VDBGridPool) {
    const C = GPUShaderStage.COMPUTE;
    this.layout = device.createBindGroupLayout({ label: 'vdb direct resample', entries: [
      ...vdbModuleEntries({ slot: this.slot, visibility: C }),
      { binding: 1, visibility: C, buffer: { type: 'uniform' } },
      { binding: 2, visibility: C, buffer: { type: 'storage' } },
    ] });
    const code = vdbModuleWgsl({ slot: this.slot, types: VDB_ALL_SCALAR_TYPES, profile: 'sample', outside: 'zero' }) + WGSL;
    this.pipeline = device.createComputePipeline({ label: 'vdb direct resample', layout: device.createPipelineLayout({ bindGroupLayouts: [this.layout] }), compute: { module: device.createShaderModule({ label: 'vdb direct resample', code }), entryPoint: 'main' } });
  }

  /** The texel lattice for grid `id` under `placement`: dims and the texel-to-VDB-world vectors. */
  lattice(id: number, p: DirectPlacement) {
    const info = this.pool.info(id);
    const m = p.margin ?? 4;
    const k = p.voxelSize / p.worldScale; // VDB world units per texel
    const lo = info.worldBBox.min, hi = info.worldBBox.max;
    const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    // Texture axes (x, map row, up). Y-up: row = +Z, up = +Y. Z-up (EmberGen, Houdini Z-up exports): row = -Y, up = +Z (vdb_to_direct.py --up z).
    const nx = Math.ceil(ext[0] / k) + 2 * m;
    const nRow = Math.ceil((p.up === 'y' ? ext[2] : ext[1]) / k) + 2 * m;
    const nUp = Math.ceil((p.up === 'y' ? ext[1] : ext[2]) / k) + 2 * m;
    const ax: [number, number, number] = [k, 0, 0];
    const ay: [number, number, number] = p.up === 'y' ? [0, 0, k] : [0, -k, 0];
    const az: [number, number, number] = p.up === 'y' ? [0, k, 0] : [0, 0, k];
    const origin: [number, number, number] = p.up === 'y'
      ? [lo[0] - m * k, lo[1] - m * k, lo[2] - m * k]
      : [lo[0] - m * k, hi[1] + m * k, lo[2] - m * k];
    const voxelWorld = Math.max(info.voxelSize[0], info.voxelSize[1], info.voxelSize[2]);
    const taps = Math.max(1, Math.min(4, Math.round(k / voxelWorld)));
    return { dims: [nx, nRow, nUp] as [number, number, number], origin, ax, ay, az, taps, info };
  }

  /** Resample grid `id` onto the runtime lattice and build a direct GpuCloudVolume (caller-owned). */
  async build(id: number, p: DirectPlacement, label = 'vdb direct'): Promise<{ volume: GpuCloudVolume; info: DirectInfo }> {
    const t0 = performance.now();
    const { density, dims, taps } = await this.resample(id, p, label);
    const t1 = performance.now();
    const packed = await packDirectVolume(this.device, density, dims, p.voxelSize, label);
    return { volume: packed.volume, info: { ...packed.info, taps, timings: { ...packed.info.timings, resampleGpuMs: t1 - t0 } } };
  }

  /** P0.4: the resample alone: f32 density on the runtime lattice (x, map row, up; x fastest), before any normalisation. */
  async resample(id: number, p: DirectPlacement, label = 'vdb direct'): Promise<{ density: Float32Array; dims: [number, number, number]; taps: number; origin: [number, number, number] }> {
    const { device } = this;
    const L = this.lattice(id, p);
    const [w, h, d] = L.dims;
    const count = w * h * d;
    const params = new ArrayBuffer(80);
    const u32 = new Uint32Array(params), f32 = new Float32Array(params);
    u32.set([w, h, d, L.taps], 0);
    f32.set([...L.origin, id], 4);
    f32.set([...L.ax, 0, ...L.ay, 0, ...L.az, 0], 8);
    const ubo = device.createBuffer({ label: `${label} params`, size: params.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(ubo, 0, params);
    const out = device.createBuffer({ label: `${label} density`, size: count * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const read = device.createBuffer({ label: `${label} readback`, size: count * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = device.createCommandEncoder({ label });
    this.pool.update(encoder);
    const group = device.createBindGroup({ layout: this.layout, entries: [this.pool.bindGroupEntry(this.slot), { binding: 1, resource: { buffer: ubo } }, { binding: 2, resource: { buffer: out } }] });
    const pass = encoder.beginComputePass({ label });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(Math.ceil(w / 4), Math.ceil(h / 4), Math.ceil(d / 4));
    pass.end();
    encoder.copyBufferToBuffer(out, 0, read, 0, count * 4);
    device.queue.submit([encoder.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const density = new Float32Array(read.getMappedRange().slice(0));
    read.unmap(); read.destroy(); out.destroy(); ubo.destroy();
    return { density, dims: L.dims, taps: L.taps, origin: L.origin };
  }
}

/** p99 of the occupied texels (vdb_to_direct.py); empty below 1e-4 of the max (EmberGen's absolute 1e-4 at max ~1). */
export function directDensityRef(density: Float32Array): { ref: number; max: number; empty: number; occupied: number } {
  const count = density.length;
  let max = 0;
  for (let i = 0; i < count; i++) if (density[i] > max) max = density[i];
  const empty = Math.max(1e-7, max * 1e-4);
  const BINS = 4096, hist = new Uint32Array(BINS);
  let occupied = 0;
  for (let i = 0; i < count; i++) { const v = density[i]; if (v > empty) { occupied++; hist[Math.min(BINS - 1, Math.floor((v / max) * BINS))]++; } }
  let seen = 0, ref = max;
  for (let b = 0; b < BINS; b++) { seen += hist[b]; if (seen >= occupied * 0.99) { ref = ((b + 1) / BINS) * max; break; } }
  ref = Math.max(ref, 1e-6);
  return { ref, max, empty, occupied };
}

/**
 * The CPU pack, upload and SDF of a direct volume from f32 density on the runtime lattice (x, map row, up; x fastest): r16f density / densityRef
 * (the march), rgba8 NVDF R = saturate(density / densityRef) (light grid, shadow map, dome; at least 1/255 wherever there is material), and a
 * 2-round jump-flood SDF. P0.4 (reference-pt scene card) packs its baked procedural patches through this too, so every direct volume is built alike.
 */
export async function packDirectVolume(device: GPUDevice, density: Float32Array, dims: [number, number, number], voxelSize: number, label = 'vdb direct'): Promise<{ volume: GpuCloudVolume; info: DirectInfo }> {
  const [w, h, d] = dims;
  const count = w * h * d;
  const t1 = performance.now();
  const { ref, max, empty, occupied } = directDensityRef(density);
  const half = new Uint16Array(count);
  const nvdf = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    const v = density[i];
    half[i] = toHalfBits(v / ref);
    // R: the cheap density (light grid, shadow map, dome) and the SDF seed: at least 1/255 wherever there is material, so thin wisps keep their SDF.
    nvdf[i * 4] = v > empty ? Math.max(1, Math.min(255, Math.round((v / ref) * 255))) : 0;
    nvdf[i * 4 + 2] = 255;
    nvdf[i * 4 + 3] = v > empty ? 255 : 0;
  }
  const t2 = performance.now();

  const volume = createEmptyCloudVolume(device, dims, voxelSize, label);
  const size: GPUExtent3D = { width: w, height: h, depthOrArrayLayers: d };
  device.queue.writeTexture({ texture: volume.nvdf }, nvdf, { bytesPerRow: w * 4, rowsPerImage: h }, size);
  const densityTex = device.createTexture({ label: `${label} direct density`, dimension: '3d', format: 'r16float', size, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: densityTex }, half, { bytesPerRow: w * 2, rowsPerImage: h }, size);
  const rebuilder = createSdfRebuilder(device, volume, { rounds: 2, label: `${label} sdf` });
  const enc = device.createCommandEncoder({ label: `${label} sdf` });
  rebuilder.generate(enc);
  device.queue.submit([enc.finish()]);
  await device.queue.onSubmittedWorkDone();
  rebuilder.destroy();
  volume.direct = { density: densityTex, densityRef: ref };
  const destroy = volume.destroy;
  volume.destroy = () => { densityTex.destroy(); destroy.call(volume); };
  const v = voxelSize;
  return {
    volume,
    info: {
      dims, voxelSize: v, taps: 1, densityRef: ref, max, occupied,
      sizeMeters: [w * v, d * v, h * v],
      timings: { resampleGpuMs: 0, packMs: t2 - t1, uploadSdfMs: performance.now() - t2 },
      gpuBytes: count * 8,
    },
  };
}

/** Device limits for a renderer that hosts a VDBGridPool and large direct volumes. */
export function vdbDeviceLimits(adapter: GPUAdapter): Record<string, number> {
  const limits = VDBGridPool.requiredLimits(adapter);
  return { ...limits, maxBufferSize: Math.max(limits.maxBufferSize ?? 0, Math.min(adapter.limits.maxBufferSize, 2 ** 31)), maxStorageBufferBindingSize: Math.max(limits.maxStorageBufferBindingSize ?? 0, Math.min(adapter.limits.maxStorageBufferBindingSize, 2 ** 31 - 4)) };
}
