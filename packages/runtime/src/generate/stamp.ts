// GPU stamping of authored cloud assets into a generated (or empty) cloudscape region, in the spirit of Guerrilla's Atlas
// compositing (nubis-sources.md section 2): authored voxel clouds are placed into one dense world grid with a transform, merged,
// and carved by cutouts; the SDF is then rebuilt for the result. No three imports.
//
//   stampCloud(device, encoder, target, asset, { position, yaw, scale, mode })   NVDF of the target only (cheap, bounded to the stamp's box)
//   createSdfRebuilder(device, target, { sliceDepth }).generate(encoder, maxJobs)  the target's SDF from its NVDF (whole volume, amortizable)
//
// Stamp any number of assets, then rebuild the SDF once. The target must be a generator output (createVolumeGenerator(...).volume)
// or createEmptyCloudVolume(...): its NVDF needs STORAGE_BINDING | COPY_SRC and its SDF COPY_DST.
import type { GpuCloudVolume } from '../resources';
import { JFA_WGSL, SDF_WGSL } from './shaders';
import { createGeneratorScratch, jfaStepSequence, type GeneratorScratch } from './volume-generator';

export type StampMode = 'max' | 'replace' | 'cutout';

export interface StampOptions {
  /** Where the asset volume's centre goes, in the target volume's own metres along world axes (x, y-up, z): 0..extentMeters. */
  position: [number, number, number];
  /** Rotation about the vertical axis in radians, three.js sense (positive turns +x toward -z). Default 0. */
  yaw?: number;
  /** Uniform size multiplier of the asset. Default 1. */
  scale?: number;
  /**
   * max: where the asset is denser than the target it takes over all channels (a union of clouds).
   * replace: the asset overwrites the target wherever it has density and within `clearMargin` metres of its surface (clears the target there).
   * cutout: wherever the asset has density the target is emptied (carves a hole in the shape of the asset).
   * Default 'max'.
   */
  mode?: StampMode;
  /** replace only: metres around the asset's surface (its SDF, scaled) in which the target is emptied. Default 48; use a huge value to clear the asset's whole box. */
  clearMargin?: number;
  /** Multiplies the asset's density scale (NVDF B) before writing, clamped to 1. max/replace only. Default 1. */
  densityScale?: number;
  /** Overrides the asset's detail type (NVDF G, 0 wispy .. 1 billowy). max/replace only. Default: keep the asset's. */
  detailType?: number;
  /** Attach a GPU timestamp query to the stamp's compute pass. */
  timestamps?: (label: string) => GPUComputePassTimestampWrites | undefined;
}

export interface StampResult {
  /** Target voxels touched (inclusive min, exclusive max), clamped to the volume. Empty when the stamp misses the volume. */
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
  voxels: number;
}

const STAMP_WGSL = /* wgsl */ `
struct S {
  bmin: vec4<i32>,    // xyz bounds min (target voxel), w mode (0 max, 1 replace, 2 cutout)
  bsize: vec4<u32>,   // xyz bounds size
  adims: vec4<f32>,   // asset dims (x, row, up), w density scale
  pos: vec4<f32>,     // stamp centre (x, y-up, z) metres, w detail override (-1 none)
  rot: vec4<f32>,     // cos(yaw), sin(yaw), 1 / scale, asset voxel size
  tvox: vec4<f32>,    // target voxel size, replace clear margin (m), scale
}
@group(0) @binding(0) var<uniform> S0: S;
@group(0) @binding(1) var assetTex: texture_3d<f32>;
@group(0) @binding(2) var assetSampler: sampler;
@group(0) @binding(3) var prevTex: texture_3d<f32>;     // copy of the target NVDF over the stamp's bounds, at origin 0
@group(0) @binding(4) var outTex: texture_storage_3d<rgba8unorm, write>;
@group(0) @binding(5) var assetSdf: texture_3d<f32>;      // asset SDF in metres, positive outside

@compute @workgroup_size(8, 8, 4)
fn stampMain(@builtin(global_invocation_id) g: vec3<u32>) {
  if (any(g >= S0.bsize.xyz)) { return; }
  let tv = S0.bmin.xyz + vec3<i32>(g);
  // Target voxel centre, world axes (x, y-up, z) relative to the target volume: texture (x, row, up) -> (x, up, row).
  let c = (vec3<f32>(tv) + 0.5) * S0.tvox.x;
  let rel = vec3<f32>(c.x, c.z, c.y) - S0.pos.xyz;
  // Inverse yaw (three.js rotation.y: x' = x cos + z sin, z' = -x sin + z cos).
  let co = S0.rot.x; let si = S0.rot.y;
  let u = vec3<f32>(co * rel.x - si * rel.z, rel.y, si * rel.x + co * rel.z) * S0.rot.z;
  let a = vec3<f32>(u.x, u.z, u.y) / S0.rot.w + S0.adims.xyz * 0.5;   // asset texel coordinates (x, row, up)
  let mode = S0.bmin.w;
  let inside = all(a >= vec3<f32>(0.0)) && all(a <= S0.adims.xyz);
  if (!inside) { return; }
  let s = textureSampleLevel(assetTex, assetSampler, a / S0.adims.xyz, 0.0);
  let prev = textureLoad(prevTex, vec3<i32>(g), 0);
  let sp = round(s.r * 255.0) / 255.0;
  if (mode == 2) {
    if (sp > 0.0) { textureStore(outTex, tv, vec4<f32>(0.0, 1.0, 1.0, 1.0)); }
    return;
  }
  let detail = select(s.g, S0.pos.w, S0.pos.w >= 0.0);
  let scale = min(s.b * S0.adims.w, 1.0);
  if (mode == 1) {
    if (sp > 0.0) { textureStore(outTex, tv, vec4<f32>(sp, detail, scale, 1.0)); return; }
    let dist = textureSampleLevel(assetSdf, assetSampler, a / S0.adims.xyz, 0.0).r * S0.tvox.z;
    if (dist < S0.tvox.y) { textureStore(outTex, tv, vec4<f32>(0.0, 1.0, 1.0, 1.0)); }
    return;
  }
  if (sp > prev.r) { textureStore(outTex, tv, vec4<f32>(sp, detail, scale, 1.0)); }
}
`;

/** The occupancy seeds of the SDF rebuild: NVDF profile > 0 is inside. Params block shares the first 8 words with the generator's. */
const SEED_WGSL = /* wgsl */ `
struct Params { dims: vec3<u32>, step: i32, zStart: u32, zCount: u32, margin: f32, maxDist: f32 }
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var nvdf: texture_3d<f32>;
@group(0) @binding(2) var<storage, read_write> seedsA: array<u32>;
@group(0) @binding(3) var<storage, read_write> seedsB: array<u32>;
@compute @workgroup_size(8, 8, 4)
fn seedMain(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= P.dims.x || g.y >= P.dims.y || g.z >= P.zCount) { return; }
  let p = vec3<i32>(i32(g.x), i32(g.y), i32(P.zStart + g.z));
  let i = (u32(p.z) * P.dims.y + u32(p.y)) * P.dims.x + u32(p.x);
  let me = u32(p.x) | (u32(p.y) << 11u) | (u32(p.z) << 22u);
  let occupied = textureLoad(nvdf, p, 0).r > 0.0;
  seedsA[i] = select(0xffffffffu, me, occupied);
  seedsB[i] = select(me, 0xffffffffu, occupied);
}
`;

const STAMP_SLOT = 256, STAMP_SLOTS = 256;
interface StampKit { layout: GPUBindGroupLayout; pipeline: GPUComputePipeline; sampler: GPUSampler }
interface TargetKit { params: GPUBuffer; prev: GPUTexture | null; slot: number; assetViews: WeakMap<GPUTexture, GPUTextureView>; sdfViews: WeakMap<GPUTexture, GPUTextureView> }
const kits = new WeakMap<GPUDevice, StampKit>();
const targets = new WeakMap<GPUTexture, TargetKit>();

function stampKit(device: GPUDevice): StampKit {
  let kit = kits.get(device);
  if (kit) return kit;
  const C = GPUShaderStage.COMPUTE;
  const layout = device.createBindGroupLayout({
    label: 'stamp', entries: [
      { binding: 0, visibility: C, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 96 } },
      { binding: 1, visibility: C, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 2, visibility: C, sampler: { type: 'filtering' } },
      { binding: 3, visibility: C, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 4, visibility: C, storageTexture: { access: 'write-only', format: 'rgba8unorm', viewDimension: '3d' } },
      { binding: 5, visibility: C, texture: { sampleType: 'float', viewDimension: '3d' } },
    ],
  });
  const pipeline = device.createComputePipeline({
    label: 'stamp', layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module: device.createShaderModule({ label: 'stamp', code: STAMP_WGSL }), entryPoint: 'stampMain' },
  });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
  kit = { layout, pipeline, sampler };
  kits.set(device, kit);
  return kit;
}

/**
 * Resample `asset` (an uploaded authored cloud, texture axes (x, map row, up)) into `target`'s NVDF with the given transform.
 * Each target voxel in the transformed box is mapped back into the asset and sampled trilinearly. Encoded into `encoder`; the
 * caller submits. The target's SDF is stale afterwards: run a `createSdfRebuilder` once after the last stamp.
 * Stamps are applied in encoding order. Up to 256 stamps per target may be encoded between submits.
 */
export function stampCloud(device: GPUDevice, encoder: GPUCommandEncoder, target: GpuCloudVolume, asset: GpuCloudVolume, options: StampOptions): StampResult {
  const needs = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC;
  if ((target.nvdf.usage & needs) !== needs) throw new Error('stampCloud: target NVDF needs STORAGE_BINDING | COPY_SRC (use a generator volume or createEmptyCloudVolume)');
  const kit = stampKit(device);
  let tk = targets.get(target.nvdf);
  if (!tk) {
    tk = { params: device.createBuffer({ label: 'stamp params', size: STAMP_SLOT * STAMP_SLOTS, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), prev: null, slot: 0, assetViews: new WeakMap(), sdfViews: new WeakMap() };
    targets.set(target.nvdf, tk);
    // Freed with the target (the volume's destroy is the caller's; the helper textures follow its NVDF texture's lifetime loosely).
    const destroy = target.destroy;
    target.destroy = () => { tk!.params.destroy(); tk!.prev?.destroy(); targets.delete(target.nvdf); destroy.call(target); };
  }
  const [tw, th, td] = target.dims;
  const [aw, ah, ad] = asset.dims;
  const scale = options.scale ?? 1, yaw = options.yaw ?? 0;
  const co = Math.cos(yaw), si = Math.sin(yaw);
  const mode = options.mode ?? 'max';

  // Bounds: the asset box (centred on `position`, scaled, yawed) as a target-voxel AABB.
  const half = [aw * asset.voxelSize * 0.5 * scale, ad * asset.voxelSize * 0.5 * scale, ah * asset.voxelSize * 0.5 * scale]; // world x, y-up, z
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < 8; k++) {
    const x = k & 1 ? half[0] : -half[0], y = k & 2 ? half[1] : -half[1], z = k & 4 ? half[2] : -half[2];
    // forward yaw: x' = x cos + z sin, z' = -x sin + z cos
    const w = [options.position[0] + x * co + z * si, options.position[1] + y, options.position[2] - x * si + z * co];
    for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], w[i]); hi[i] = Math.max(hi[i], w[i]); }
  }
  const vs = target.voxelSize;
  // World (x, y, z) -> texture (x, row = z, up = y).
  const tmin = [lo[0], lo[2], lo[1]].map(v => Math.max(0, Math.floor(v / vs) - 1));
  const tmax = [hi[0], hi[2], hi[1]].map((v, i) => Math.min([tw, th, td][i], Math.ceil(v / vs) + 1));
  const size = [0, 1, 2].map(i => Math.max(0, tmax[i] - tmin[i]));
  const voxels = size[0] * size[1] * size[2];
  const result: StampResult = { boundsMin: tmin as [number, number, number], boundsMax: tmax as [number, number, number], voxels };
  if (voxels === 0) return result;

  if (!tk.prev) tk.prev = device.createTexture({ label: 'stamp prev', dimension: '3d', format: 'rgba8unorm', size: { width: tw, height: th, depthOrArrayLayers: td }, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  let assetView = tk.assetViews.get(asset.nvdf);
  if (!assetView) { assetView = asset.nvdf.createView({ dimension: '3d' }); tk.assetViews.set(asset.nvdf, assetView); }

  let sdfView = tk.sdfViews.get(asset.sdf);
  if (!sdfView) { sdfView = asset.sdf.createView({ dimension: '3d' }); tk.sdfViews.set(asset.sdf, sdfView); }

  const slot = tk.slot++ % STAMP_SLOTS;
  const data = new ArrayBuffer(96);
  const i32 = new Int32Array(data), u32 = new Uint32Array(data), f32 = new Float32Array(data);
  i32.set([tmin[0], tmin[1], tmin[2], mode === 'max' ? 0 : mode === 'replace' ? 1 : 2], 0);
  u32.set(size, 4);
  f32.set([aw, ah, ad, options.densityScale ?? 1], 8);
  f32.set([options.position[0], options.position[1], options.position[2], options.detailType ?? -1], 12);
  f32.set([co, si, 1 / scale, asset.voxelSize], 16);
  f32.set([vs, Math.min(options.clearMargin ?? 48, 1e9), scale, 0], 20);
  device.queue.writeBuffer(tk.params, slot * STAMP_SLOT, data);

  encoder.copyTextureToTexture({ texture: target.nvdf, origin: { x: tmin[0], y: tmin[1], z: tmin[2] } }, { texture: tk.prev }, { width: size[0], height: size[1], depthOrArrayLayers: size[2] });
  const bind = device.createBindGroup({
    label: 'stamp', layout: kit.layout,
    entries: [
      { binding: 0, resource: { buffer: tk.params, size: 96 } }, { binding: 1, resource: assetView }, { binding: 2, resource: kit.sampler },
      { binding: 3, resource: tk.prev.createView() }, { binding: 4, resource: target.nvdf.createView() }, { binding: 5, resource: sdfView },
    ],
  });
  const pass = encoder.beginComputePass({ label: `stamp ${mode}`, timestampWrites: options.timestamps?.('stamp') });
  pass.setPipeline(kit.pipeline);
  pass.setBindGroup(0, bind, [slot * STAMP_SLOT]);
  pass.dispatchWorkgroups(Math.ceil(size[0] / 8), Math.ceil(size[1] / 8), Math.ceil(size[2] / 4));
  pass.end();
  return result;
}

/** An empty region: no cloud, SDF = +maxDistance everywhere. A valid stamp target. Axes (x, map row, up). */
export function createEmptyCloudVolume(device: GPUDevice, dims: [number, number, number], voxelSize = 8, label = 'empty cloud region', maxDistance = 4096): GpuCloudVolume {
  const [w, h, d] = dims;
  const size: GPUExtent3D = { width: w, height: h, depthOrArrayLayers: d };
  const nvdf = device.createTexture({ label: `${label} nvdf`, dimension: '3d', format: 'rgba8unorm', size, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });
  const sdf = device.createTexture({ label: `${label} sdf`, dimension: '3d', format: 'r16float', size, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC });
  // Outside a cloud the shipped assets hold G = B = 1.
  const nv = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { nv[i * 4 + 1] = 255; nv[i * 4 + 2] = 255; nv[i * 4 + 3] = 255; }
  // Largest finite half <= maxDistance (4096 m is exactly 0x6c00); values above 65504 are not representable.
  const far = Math.min(maxDistance, 65504);
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  f32[0] = far;
  const bits = u32[0];
  const e = ((bits >>> 23) & 0xff) - 127 + 15;
  const halfBits = (e << 10) | ((bits & 0x7fffff) >>> 13); // truncation never rounds up
  const sv = new Uint16Array(w * h).fill(halfBits);
  for (let z = 0; z < d; z++) {
    device.queue.writeTexture({ texture: nvdf, origin: { x: 0, y: 0, z } }, nv, { bytesPerRow: w * 4, rowsPerImage: h }, { width: w, height: h, depthOrArrayLayers: 1 });
    device.queue.writeTexture({ texture: sdf, origin: { x: 0, y: 0, z } }, sv, { bytesPerRow: w * 2, rowsPerImage: h }, { width: w, height: h, depthOrArrayLayers: 1 });
  }
  return { nvdf, sdf, dims: [w, h, d], voxelSize, extentMeters: [w * voxelSize, d * voxelSize, h * voxelSize], destroy() { nvdf.destroy(); sdf.destroy(); } };
}

export interface SdfRebuilderOptions {
  /** z slices per job. Default dims.z (one job per stage and step). */
  sliceDepth?: number;
  /** Conservative margin in voxels subtracted from |SDF|. Default 1 (as the generator). */
  marginVoxels?: number;
  /** Extra jump-flood steps at the end. Default 2. */
  refinePasses?: 0 | 1 | 2;
  /** Full jump-flood rounds (n/2 .. 1) before the refine steps. 2 ("JFA squared") is the default: stamped regions are sparse and a single round overshoots by ~2 voxels far from a cloud. */
  rounds?: number;
  maxDistance?: number;
  /** Share the generator's big seed/staging buffers (the caller must not run both at once). */
  scratch?: GeneratorScratch;
  timestamps?: (label: string) => GPUComputePassTimestampWrites | undefined;
  label?: string;
}

export interface SdfRebuilder {
  readonly jobsTotal: number;
  readonly jobsDone: number;
  readonly done: boolean;
  readonly jobLabels: readonly string[];
  /** Start over (call after more stamps). */
  restart(): void;
  /** Encode up to `maxJobs` further jobs (default all). The target's SDF holds the old result until the last job's copy. */
  generate(encoder: GPUCommandEncoder, maxJobs?: number): { done: boolean; jobsEncoded: number; jobsDone: number; jobsTotal: number };
  destroy(): void;
}

const PARAM_BYTES = 96, PARAM_STRIDE = 256;

/**
 * Rebuild `target.sdf` from `target.nvdf` (voxel is inside where profile > 0): occupancy seeds, 3D jump flood on two seed sets,
 * signed distance minus a conservative margin, the same passes as the generator (so it is conservative the same way). Whole volume.
 * Jobs are independent dispatches so they can be spread over frames; the SDF texture is only written by the final copies.
 */
export function createSdfRebuilder(device: GPUDevice, target: GpuCloudVolume, options: SdfRebuilderOptions = {}): SdfRebuilder {
  const [w, h, d] = target.dims;
  if (w >= 2048 || h >= 2048 || d >= 1024) throw new Error('volume dims exceed the packed seed range (2047, 2047, 1023)');
  const label = options.label ?? 'stamp sdf';
  const margin = options.marginVoxels ?? 1, maxDist = options.maxDistance ?? 4096;
  const sliceDepth = Math.max(1, Math.min(d, options.sliceDepth ?? d));
  const C = GPUShaderStage.COMPUTE;
  const uniformEntry: GPUBindGroupLayoutEntry = { binding: 0, visibility: C, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 32 } };
  const storage = (binding: number, type: GPUBufferBindingType): GPUBindGroupLayoutEntry => ({ binding, visibility: C, buffer: { type } });
  const make = (name: string, code: string, entryPoint: string, entries: GPUBindGroupLayoutEntry[]) => {
    const bgl = device.createBindGroupLayout({ label: name, entries });
    return { bgl, pipeline: device.createComputePipeline({ label: `${label} ${name}`, layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }), compute: { module: device.createShaderModule({ label: name, code }), entryPoint } }) };
  };
  const seedK = make('seed', SEED_WGSL, 'seedMain', [uniformEntry, { binding: 1, visibility: C, texture: { sampleType: 'float', viewDimension: '3d' } }, storage(2, 'storage'), storage(3, 'storage')]);
  const jfaK = make('jfa', JFA_WGSL, 'jfa', [{ ...uniformEntry, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: PARAM_BYTES } }, storage(1, 'read-only-storage'), storage(2, 'read-only-storage'), storage(3, 'storage'), storage(4, 'storage')]);
  const sdfK = make('sdf', SDF_WGSL, 'sdfMain', [{ ...uniformEntry, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: PARAM_BYTES } }, storage(1, 'read-only-storage'), storage(2, 'read-only-storage'), storage(3, 'storage')]);

  const scratch = options.scratch ?? createGeneratorScratch(device, [w, h, d], label);
  if (scratch.dims[0] !== w || scratch.dims[1] !== h || scratch.dims[2] !== d) throw new Error('scratch dims differ from the volume dims');
  const ownsScratch = !options.scratch;
  const seeds = scratch.seeds, staging = scratch.staging;
  const rowBytes = Math.ceil(w * 2 / 256) * 256;
  const one = jfaStepSequence(Math.max(w, h, d), 0), refine = jfaStepSequence(Math.max(w, h, d), options.refinePasses ?? 2).slice(one.length);
  const steps: number[] = [];
  for (let r = 0; r < Math.max(1, options.rounds ?? 2); r++) steps.push(...one);
  steps.push(...refine);
  const chunks: [number, number][] = [];
  for (let z = 0; z < d; z += sliceDepth) chunks.push([z, Math.min(sliceDepth, d - z)]);

  const maxSlots = chunks.length * (2 + steps.length);
  const params = device.createBuffer({ label: `${label} params`, size: maxSlots * PARAM_STRIDE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const uni: GPUBufferBinding = { buffer: params, size: PARAM_BYTES };
  const slots = new Uint8Array(maxSlots * PARAM_STRIDE);
  let nSlots = 0;
  const addSlot = (zStart: number, zCount: number, step: number): number => {
    const dv = new DataView(slots.buffer, nSlots * PARAM_STRIDE, PARAM_BYTES);
    dv.setUint32(0, w, true); dv.setUint32(4, h, true); dv.setUint32(8, d, true); dv.setInt32(12, step, true);
    dv.setUint32(16, zStart, true); dv.setUint32(20, zCount, true);
    dv.setFloat32(24, margin, true); dv.setFloat32(28, maxDist, true); dv.setFloat32(32, target.voxelSize, true);
    return nSlots++;
  };
  const jfaBG = (from: 0 | 1) => device.createBindGroup({
    label: `jfa ${from}`, layout: jfaK.bgl,
    entries: [{ binding: 0, resource: uni }, { binding: 1, resource: { buffer: seeds[from * 2] } }, { binding: 2, resource: { buffer: seeds[from * 2 + 1] } }, { binding: 3, resource: { buffer: seeds[(1 - from) * 2] } }, { binding: 4, resource: { buffer: seeds[(1 - from) * 2 + 1] } }],
  });
  const final = steps.length % 2;
  const seedBG = device.createBindGroup({ label: 'seed', layout: seedK.bgl, entries: [{ binding: 0, resource: { buffer: params, size: 32 } }, { binding: 1, resource: target.nvdf.createView({ dimension: '3d' }) }, { binding: 2, resource: { buffer: seeds[0] } }, { binding: 3, resource: { buffer: seeds[1] } }] });
  const sdfBG = device.createBindGroup({ label: 'sdf', layout: sdfK.bgl, entries: [{ binding: 0, resource: uni }, { binding: 1, resource: { buffer: seeds[final * 2] } }, { binding: 2, resource: { buffer: seeds[final * 2 + 1] } }, { binding: 3, resource: { buffer: staging } }] });
  const jfaBGs = [jfaBG(0), jfaBG(1)];

  type Job = { label: string; pipeline: GPUComputePipeline; bind: GPUBindGroup; slot: number; groups: [number, number, number]; copy?: { z0: number; n: number } };
  const jobs: Job[] = [];
  const g8 = (n: number): [number, number, number] => [Math.ceil(w / 8), Math.ceil(h / 8), Math.ceil(n / 4)];
  for (const [z0, n] of chunks) jobs.push({ label: 'seed', pipeline: seedK.pipeline, bind: seedBG, slot: addSlot(z0, n, 0), groups: g8(n) });
  steps.forEach((step, k) => { for (const [z0, n] of chunks) jobs.push({ label: 'jfa3d', pipeline: jfaK.pipeline, bind: jfaBGs[k % 2], slot: addSlot(z0, n, step), groups: g8(n) }); });
  for (const [z0, n] of chunks) jobs.push({ label: 'sdf', pipeline: sdfK.pipeline, bind: sdfBG, slot: addSlot(z0, n, 0), groups: [Math.ceil(w / 16), Math.ceil(h / 8), Math.ceil(n / 4)], copy: { z0, n } });
  device.queue.writeBuffer(params, 0, slots.subarray(0, nSlots * PARAM_STRIDE));

  let cursor = 0, destroyed = false;
  return {
    get jobsTotal() { return jobs.length; },
    get jobsDone() { return cursor; },
    get done() { return cursor >= jobs.length; },
    jobLabels: jobs.map(j => j.label),
    restart() { cursor = 0; },
    generate(encoder, maxJobs = Infinity) {
      let n = 0;
      while (cursor < jobs.length && n < maxJobs) {
        const j = jobs[cursor++]; n++;
        const pass = encoder.beginComputePass({ label: `${label} ${j.label}`, timestampWrites: options.timestamps?.(j.label) });
        pass.setPipeline(j.pipeline);
        pass.setBindGroup(0, j.bind, [j.slot * PARAM_STRIDE]);
        pass.dispatchWorkgroups(...j.groups);
        pass.end();
        if (j.copy) encoder.copyBufferToTexture({ buffer: staging, offset: j.copy.z0 * rowBytes * h, bytesPerRow: rowBytes, rowsPerImage: h }, { texture: target.sdf, origin: { x: 0, y: 0, z: j.copy.z0 } }, { width: w, height: h, depthOrArrayLayers: j.copy.n });
      }
      return { done: cursor >= jobs.length, jobsEncoded: n, jobsDone: cursor, jobsTotal: jobs.length };
    },
    destroy() { if (destroyed) return; destroyed = true; params.destroy(); if (ownsScratch) scratch.destroy(); },
  };
}
