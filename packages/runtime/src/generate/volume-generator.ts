// GPU generation of a Nubis voxel field (NVDF + SDF) from a 2D weather map. No three imports.
//
// Pipeline (all jobs are separate dispatches/passes so they can be spread over frames):
//   seed2d  weather coverage > threshold -> 2D seeds
//   jfa2d   2D jump flood: distance from each cloud pixel to the nearest non-cloud pixel (edge gradient input)
//   nvdf    envelope profile * edge gradient, detail type, density scale -> rgba8unorm 3D; initial 3D seeds
//   jfa3d   3D jump flood on occupancy (profile quantised to 8 bits > 0), two seed sets (nearest inside / outside)
//   sdf     signed distance in metres, minus a conservative margin -> f16 staging buffer -> copied into the r16float 3D texture
import type { GpuCloudVolume } from '../resources';
import { JFA_WGSL, NVDF_WGSL, SDF_WGSL, SEED2D_WGSL } from './shaders';

export interface NvdfParams {
  /** Coverage above this makes a cloud column. Default 0.15. */
  coverageThreshold: number;
  /** Voxels over which the 2D edge gradient ramps from 0 to 1. Default 6. */
  edgeWidthVoxels: number;
  /** Read base/top height (fractions of the volume height) from the weather map B/A. Otherwise derived from coverage. */
  useMapHeights: boolean;
  /** Without map heights: base fraction. Default 0.1. */
  baseDefault: number;
  /** Without map heights: top fraction ramps from topMin (low coverage) to topMax (full coverage). Defaults 0.3 / 0.95. */
  topMin: number;
  topMax: number;
  /** Density scale at the coverage threshold, ramping to 1 at full coverage. Default 0.6. */
  densityMin: number;
}

export interface VolumeGeneratorOptions {
  /** Output dims: (x, map row, up). */
  dims: [number, number, number];
  /** Metres per voxel on every axis. Default 8. */
  voxelSize?: number;
  /** Weather map, rgba8unorm or rgba16float, bilinearly sampled over the whole volume footprint. R coverage, G cloud type, B base, A top. */
  weather: GPUTexture;
  params?: Partial<NvdfParams>;
  /** z slices per job. Default dims.z (one job per stage and step). Smaller values give finer amortization. */
  sliceDepth?: number;
  /** Conservative margin subtracted from |SDF| in voxels. Default 1. 0 gives the raw jump-flood result. */
  marginVoxels?: number;
  /** Extra jump-flood steps at the end: 0 plain JFA, 1 JFA+1, 2 JFA+2 (steps 2,1). Default 2. */
  refinePasses?: 0 | 1 | 2;
  /** SDF clamp in metres (r16float handles 65504, the shipped assets use 4096). Default 4096. */
  maxDistance?: number;
  /** Called once per job pass with the stage name, to attach timestamp queries. */
  timestamps?: (label: string) => GPUComputePassTimestampWrites | undefined;
  label?: string;
}

export interface GenerateProgress { done: boolean; jobsEncoded: number; jobsDone: number; jobsTotal: number }

export interface VolumeGenerator {
  /** The output. Valid when `done`; while generating it holds the previous (or empty) result. */
  volume: GpuCloudVolume;
  readonly jobsTotal: number;
  readonly jobsDone: number;
  readonly done: boolean;
  /** Restart from the first job (e.g. after the weather map changed). */
  restart(): void;
  /** Encode up to `maxJobs` further jobs (default all remaining) into `encoder`. The caller submits. */
  generate(encoder: GPUCommandEncoder, maxJobs?: number): GenerateProgress;
  /** Stage name of each job, in order. */
  readonly jobLabels: readonly string[];
  destroy(): void;
}

const DEFAULTS: NvdfParams = {
  coverageThreshold: 0.15, edgeWidthVoxels: 6, useMapHeights: true, baseDefault: 0.1, topMin: 0.3, topMax: 0.95, densityMin: 0.6,
};

/** Jump-flood step sizes: n/2 .. 1 (n the next power of two >= maxDim), then `refine` extra steps (JFA+1: [1], JFA+2: [2, 1]). */
export function jfaStepSequence(maxDim: number, refine: 0 | 1 | 2 = 0): number[] {
  let n = 1;
  while (n < maxDim) n <<= 1;
  const steps: number[] = [];
  for (let s = Math.max(1, n >> 1); s >= 1; s >>= 1) steps.push(s);
  if (refine >= 2) steps.push(2);
  if (refine >= 1) steps.push(1);
  return steps;
}

const PARAM_BYTES = 64, PARAM_STRIDE = 256;
type Job = { label: string; pipeline: GPUComputePipeline; bindGroup: GPUBindGroup; slot: number; groups: [number, number, number]; copy?: { z0: number; n: number } };

export function createVolumeGenerator(device: GPUDevice, options: VolumeGeneratorOptions): VolumeGenerator {
  const [w, h, d] = options.dims;
  if (w >= 2048 || h >= 2048 || d >= 1024) throw new Error('volume dims exceed the packed seed range (2047, 2047, 1023)');
  const voxelSize = options.voxelSize ?? 8;
  const margin = options.marginVoxels ?? 1;
  const maxDist = options.maxDistance ?? 4096;
  const sliceDepth = Math.max(1, Math.min(d, options.sliceDepth ?? d));
  const p: NvdfParams = { ...DEFAULTS, ...options.params };
  const label = options.label ?? 'generated cloud';
  const C = GPUShaderStage.COMPUTE, F = GPUShaderStage.FRAGMENT;

  // ---- layouts and pipelines ----
  const uniformEntry = (visibility: number): GPUBindGroupLayoutEntry => ({ binding: 0, visibility, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: PARAM_BYTES } });
  const storage = (binding: number, type: GPUBufferBindingType, visibility = C): GPUBindGroupLayoutEntry => ({ binding, visibility, buffer: { type } });
  const layoutOf = (name: string, entries: GPUBindGroupLayoutEntry[]) => device.createPipelineLayout({ label: name, bindGroupLayouts: [device.createBindGroupLayout({ label: name, entries })] });
  const weatherEntries: GPUBindGroupLayoutEntry[] = [
    { binding: 1, visibility: C, texture: { sampleType: 'float', viewDimension: '2d' } },
    { binding: 2, visibility: C, sampler: { type: 'filtering' } },
  ];
  const compute = (name: string, code: string, entryPoint: string, entries: GPUBindGroupLayoutEntry[]) => {
    const layout = layoutOf(name, entries);
    return {
      layout,
      pipeline: device.createComputePipeline({ label: `${label} ${name}`, layout, compute: { module: device.createShaderModule({ label: name, code }), entryPoint } }),
    };
  };
  const seed2d = compute('seed2d', SEED2D_WGSL, 'seed2d', [uniformEntry(C), ...weatherEntries, storage(3, 'storage'), storage(4, 'storage')]);
  const jfa = compute('jfa', JFA_WGSL, 'jfa', [uniformEntry(C), storage(1, 'read-only-storage'), storage(2, 'read-only-storage'), storage(3, 'storage'), storage(4, 'storage')]);
  const nvdfK = compute('nvdf', NVDF_WGSL, 'nvdfMain', [
    uniformEntry(C), ...weatherEntries, storage(3, 'read-only-storage'),
    { binding: 4, visibility: C, storageTexture: { access: 'write-only', format: 'rgba8unorm', viewDimension: '3d' } },
    storage(5, 'storage'), storage(6, 'storage'),
  ]);
  const sdfK = compute('sdf', SDF_WGSL, 'sdfMain', [uniformEntry(C), storage(1, 'read-only-storage'), storage(2, 'read-only-storage'), storage(3, 'storage')]);

  // ---- resources ----
  const size3: GPUExtent3D = { width: w, height: h, depthOrArrayLayers: d };
  const nvdf = device.createTexture({ label: `${label} nvdf`, dimension: '3d', format: 'rgba8unorm', size: size3, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC });
  const sdf = device.createTexture({ label: `${label} sdf`, dimension: '3d', format: 'r16float', size: size3, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC });
  const seedBuffer = (n: number, name: string) => device.createBuffer({ label: `${label} ${name}`, size: n * 4, usage: GPUBufferUsage.STORAGE });
  const n2 = w * h, n3 = w * h * d;
  const seeds2 = [seedBuffer(n2, 'seeds2d A0'), seedBuffer(n2, 'seeds2d B0'), seedBuffer(n2, 'seeds2d A1'), seedBuffer(n2, 'seeds2d B1')];
  const seeds3 = [seedBuffer(n3, 'seeds3d A0'), seedBuffer(n3, 'seeds3d B0'), seedBuffer(n3, 'seeds3d A1'), seedBuffer(n3, 'seeds3d B1')];
  const rowBytes = Math.ceil(w * 2 / 256) * 256; // copyBufferToTexture rows are 256-byte aligned
  const sdfStaging = device.createBuffer({ label: `${label} sdf staging`, size: rowBytes * h * d, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const weatherView = options.weather.createView();

  // ---- plan ----
  const steps2 = jfaStepSequence(Math.max(w, h), options.refinePasses ?? 2);
  const steps3 = jfaStepSequence(Math.max(w, h, d), options.refinePasses ?? 2);
  const slots: ArrayBuffer[] = [];
  const addSlot = (fill: (u: Uint32Array, i: Int32Array, f: Float32Array) => void): number => {
    const a = new ArrayBuffer(PARAM_BYTES);
    const u = new Uint32Array(a), i = new Int32Array(a), f = new Float32Array(a);
    fill(u, i, f);
    slots.push(a);
    return slots.length - 1;
  };
  const common = (u: Uint32Array, f: Float32Array, dims: [number, number, number], zStart: number, zCount: number) => {
    u[0] = dims[0]; u[1] = dims[1]; u[2] = dims[2]; u[4] = zStart; u[5] = zCount;
    f[6] = margin; f[7] = maxDist; f[8] = voxelSize; f[9] = p.edgeWidthVoxels; f[10] = p.coverageThreshold; f[11] = p.useMapHeights ? 1 : 0;
    f[12] = p.baseDefault; f[13] = p.topMin; f[14] = p.topMax; f[15] = p.densityMin;
  };
  const bgl = (x: { pipeline: GPUComputePipeline }) => x.pipeline.getBindGroupLayout(0);
  // One 256-byte-aligned parameter slot per dispatch (dynamic offsets): 2D stage + 3D stages + one per SDF slice.
  const maxSlots = 1 + steps2.length + Math.ceil(d / sliceDepth) * (2 + steps3.length);
  const params = device.createBuffer({ label: `${label} params`, size: maxSlots * PARAM_STRIDE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const uni = { buffer: params, size: PARAM_BYTES } as GPUBufferBinding;
  const weatherEntriesBG: GPUBindGroupEntry[] = [{ binding: 1, resource: weatherView }, { binding: 2, resource: sampler }];
  const seed2dBG = device.createBindGroup({ label: 'seed2d', layout: bgl(seed2d), entries: [{ binding: 0, resource: uni }, ...weatherEntriesBG, { binding: 3, resource: { buffer: seeds2[0] } }, { binding: 4, resource: { buffer: seeds2[1] } }] });
  const jfaBG = (set: GPUBuffer[], from: 0 | 1) => device.createBindGroup({
    label: `jfa ${from}`, layout: bgl(jfa),
    entries: [{ binding: 0, resource: uni }, { binding: 1, resource: { buffer: set[from * 2] } }, { binding: 2, resource: { buffer: set[from * 2 + 1] } }, { binding: 3, resource: { buffer: set[(1 - from) * 2] } }, { binding: 4, resource: { buffer: set[(1 - from) * 2 + 1] } }],
  });
  const jfa2BG = [jfaBG(seeds2, 0), jfaBG(seeds2, 1)], jfa3BG = [jfaBG(seeds3, 0), jfaBG(seeds3, 1)];
  const final2 = steps2.length % 2, final3 = steps3.length % 2; // seed set holding the last result
  const nvdfBG = device.createBindGroup({
    label: 'nvdf', layout: bgl(nvdfK),
    entries: [{ binding: 0, resource: uni }, ...weatherEntriesBG, { binding: 3, resource: { buffer: seeds2[final2 * 2 + 1] } }, { binding: 4, resource: nvdf.createView() },
      { binding: 5, resource: { buffer: seeds3[0] } }, { binding: 6, resource: { buffer: seeds3[1] } }],
  });
  const sdfBG = device.createBindGroup({ label: 'sdf', layout: bgl(sdfK), entries: [{ binding: 0, resource: uni }, { binding: 1, resource: { buffer: seeds3[final3 * 2] } }, { binding: 2, resource: { buffer: seeds3[final3 * 2 + 1] } }, { binding: 3, resource: { buffer: sdfStaging } }] });

  const jobs: Job[] = [];
  const push = (j: Job) => jobs.push(j);
  // 2D stage
  push({ label: 'seed2d', pipeline: seed2d.pipeline, bindGroup: seed2dBG, groups: [Math.ceil(w / 8), Math.ceil(h / 8), 1],
    slot: addSlot((u, _i, f) => common(u, f, [w, h, 1], 0, 1)) });
  steps2.forEach((step, k) => push({ label: 'jfa2d', pipeline: jfa.pipeline, bindGroup: jfa2BG[k % 2], groups: [Math.ceil(w / 8), Math.ceil(h / 8), 1],
    slot: addSlot((u, i, f) => { common(u, f, [w, h, 1], 0, 1); i[3] = step; }) }));
  // 3D stages, chunked in z
  const chunks: [number, number][] = [];
  for (let z = 0; z < d; z += sliceDepth) chunks.push([z, Math.min(sliceDepth, d - z)]);
  for (const [z0, n] of chunks) push({ label: 'nvdf', pipeline: nvdfK.pipeline, bindGroup: nvdfBG, groups: [Math.ceil(w / 8), Math.ceil(h / 8), Math.ceil(n / 4)],
    slot: addSlot((u, _i, f) => common(u, f, [w, h, d], z0, n)) });
  steps3.forEach((step, k) => {
    for (const [z0, n] of chunks) push({ label: 'jfa3d', pipeline: jfa.pipeline, bindGroup: jfa3BG[k % 2], groups: [Math.ceil(w / 8), Math.ceil(h / 8), Math.ceil(n / 4)],
      slot: addSlot((u, i, f) => { common(u, f, [w, h, d], z0, n); i[3] = step; }) });
  });
  for (const [z0, n] of chunks) push({ label: 'sdf', pipeline: sdfK.pipeline, bindGroup: sdfBG, groups: [Math.ceil(w / 16), Math.ceil(h / 8), Math.ceil(n / 4)], copy: { z0, n },
    slot: addSlot((u, _i, f) => common(u, f, [w, h, d], z0, n)) });
  if (slots.length > maxSlots) throw new Error('internal: parameter slot overflow');
  const all = new Uint8Array(slots.length * PARAM_STRIDE);
  slots.forEach((s, i) => all.set(new Uint8Array(s), i * PARAM_STRIDE));
  device.queue.writeBuffer(params, 0, all);

  const groupedJobs: Job[][] = jobs.map(j => [j]);
  const jobLabels = jobs.map(j => j.label);

  let cursor = 0;
  const run = (encoder: GPUCommandEncoder, j: Job) => {
    const pass = encoder.beginComputePass({ label: `${label} ${j.label}`, timestampWrites: options.timestamps?.(j.label) });
    pass.setPipeline(j.pipeline);
    pass.setBindGroup(0, j.bindGroup, [j.slot * PARAM_STRIDE]);
    pass.dispatchWorkgroups(...j.groups);
    pass.end();
    if (j.copy) {
      encoder.copyBufferToTexture({ buffer: sdfStaging, offset: j.copy.z0 * rowBytes * h, bytesPerRow: rowBytes, rowsPerImage: h },
        { texture: sdf, origin: { x: 0, y: 0, z: j.copy.z0 } }, { width: w, height: h, depthOrArrayLayers: j.copy.n });
    }
  };

  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    nvdf.destroy(); sdf.destroy(); params.destroy(); sdfStaging.destroy();
    for (const b of [...seeds2, ...seeds3]) b.destroy();
  };
  const v = voxelSize;
  return {
    volume: { nvdf, sdf, dims: [w, h, d], voxelSize: v, extentMeters: [w * v, d * v, h * v], destroy },
    get jobsTotal() { return groupedJobs.length; },
    get jobsDone() { return cursor; },
    get done() { return cursor >= groupedJobs.length; },
    jobLabels,
    restart() { cursor = 0; },
    generate(encoder, maxJobs = Infinity) {
      let n = 0;
      while (cursor < groupedJobs.length && n < maxJobs) { for (const j of groupedJobs[cursor]) run(encoder, j); cursor++; n++; }
      return { done: cursor >= groupedJobs.length, jobsEncoded: n, jobsDone: cursor, jobsTotal: groupedJobs.length };
    },
    destroy,
  };
}
