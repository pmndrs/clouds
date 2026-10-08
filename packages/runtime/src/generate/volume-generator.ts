// GPU generation of a Nubis voxel field (NVDF + SDF) from a 2D weather map. No three imports.
//
// Pipeline (all jobs are separate dispatches/passes so they can be spread over frames):
//   nvdf     occupancy f > 0 of the smooth 3D cloud field (domed envelope + billow erosion, see shaders.ts SHAPE) -> initial 3D seeds
//   jfa3d    3D jump flood on occupancy, two seed sets (nearest inside / outside)
//   profile  NVDF channels from the finished flood: Guerrilla's profile-vs-depth / detail / density-scale fit -> rgba8unorm 3D
//   sdf      signed distance in metres, minus a conservative margin -> f16 staging buffer -> copied into the r16float 3D texture
import type { GpuCloudVolume } from '../resources';
import { JFA_WGSL, NVDF_WGSL, PROFILE_WGSL, SDF_WGSL } from './shaders';

export interface NvdfParams {
  /** Coverage below this is empty; above it, s = (coverage - t) / (1 - t) is the smooth mass field. Default 0.12. */
  coverageThreshold: number;
  /** Read base/top height (fractions of the volume height) from the weather map B/A instead of baseDefault/topFraction. */
  useMapHeights: boolean;
  /** Flat cloud base as a fraction of the volume height. Default 0.08. */
  baseDefault: number;
  /** Height (fraction of the volume) a column of full mass reaches; lower-mass columns top out lower. Default 0.6. */
  topFraction: number;
  /** Dome law: cloud top height ~ mass^(1/p). 2 = hemispherical lobes, larger = flatter and wider, smaller = towers. Default 2. */
  domeExponent: number;
  /** Billow erosion amplitude (0 off; about 0.2 subtle, 0.45 strong). Default 0.35. */
  billowAmp: number;
  /** Largest billow cell in metres (octaves halve it). Default 320. */
  billowCellMeters: number;
  /** Rim lift of the base (fraction of the volume height): base rises by lift * (1 - mass)^1.5 toward a lobe's edge. Default 0.1. */
  baseLift: number;
  /** Noise seed. Default 1. */
  seed: number;
  /** Density scale (NVDF B) at the cloud base and top. Defaults 0.25 / 0.85 (the fit says 0.04 / 0.75; the base is lifted, see report). */
  scaleBase: number;
  scaleTop: number;
  /** Spread of the profile around its mean depth law (PACK_FIT sigma). Default 0.64. */
  profileSigma: number;
  /** How strongly the weather map's cloud type pushes the detail type (0..1). Default 0.3. */
  detailBias: number;
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
  /** World position (metres) of voxel (0, 0) along x and the map row. Multiples of `voxelSize` keep windows on one lattice. Default [0, 0]. */
  origin?: [number, number];
  /** Shared seed/staging buffers (see `createGeneratorScratch`). Generators that share one must not generate at the same time; the caller owns it. */
  scratch?: GeneratorScratch;
}

/** The big temporary buffers of a generator (4 jump-flood seed buffers and the SDF staging buffer, about 300 MB at 512 x 512 x 64). */
export interface GeneratorScratch { dims: [number, number, number]; seeds: GPUBuffer[]; staging: GPUBuffer; destroy(): void }

export function createGeneratorScratch(device: GPUDevice, dims: [number, number, number], label = 'generator scratch'): GeneratorScratch {
  const [w, h, d] = dims;
  const n = w * h * d;
  const seeds = ['A0', 'B0', 'A1', 'B1'].map(name => device.createBuffer({ label: `${label} seeds3d ${name}`, size: n * 4, usage: GPUBufferUsage.STORAGE }));
  const staging = device.createBuffer({ label: `${label} sdf staging`, size: Math.ceil(w * 2 / 256) * 256 * h * d, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  return { dims: [w, h, d], seeds, staging, destroy() { seeds.forEach(b => b.destroy()); staging.destroy(); } };
}

export interface GenerateProgress { done: boolean; jobsEncoded: number; jobsDone: number; jobsTotal: number }

export interface VolumeGenerator {
  /** The output. Valid when `done`; while generating it holds the previous (or empty) result. */
  volume: GpuCloudVolume;
  readonly jobsTotal: number;
  readonly jobsDone: number;
  readonly done: boolean;
  /**
   * Restart from the first job. With `next`, regenerate for a new window: a new weather map (the caller owns it and must keep it alive
   * until the generation is done) and/or a new world origin. The volume is overwritten in place, so do not render it until `done`.
   */
  restart(next?: { weather?: GPUTexture; origin?: [number, number] }): void;
  /** World origin (metres) of the volume's voxel (0, 0) along x and the map row. */
  readonly origin: readonly [number, number];
  /** Encode up to `maxJobs` further jobs (default all remaining) into `encoder`. The caller submits. */
  generate(encoder: GPUCommandEncoder, maxJobs?: number): GenerateProgress;
  /** Stage name of each job, in order. */
  readonly jobLabels: readonly string[];
  destroy(): void;
}

export const NVDF_DEFAULTS: NvdfParams = {
  coverageThreshold: 0.12, useMapHeights: false, baseDefault: 0.08, topFraction: 0.6, domeExponent: 2, billowAmp: 0.35, billowCellMeters: 320,
  baseLift: 0.1, seed: 1, scaleBase: 0.25, scaleTop: 0.85, profileSigma: 0.64, detailBias: 0.3,
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

const PARAM_BYTES = 96, PARAM_STRIDE = 256;
type Job = { label: string; pipeline: GPUComputePipeline; bindGroup: GPUBindGroup | 'nvdf' | 'profile'; slot: number; groups: [number, number, number]; copy?: { z0: number; n: number } };

export function createVolumeGenerator(device: GPUDevice, options: VolumeGeneratorOptions): VolumeGenerator {
  const [w, h, d] = options.dims;
  if (w >= 2048 || h >= 2048 || d >= 1024) throw new Error('volume dims exceed the packed seed range (2047, 2047, 1023)');
  const voxelSize = options.voxelSize ?? 8;
  const margin = options.marginVoxels ?? 1;
  const maxDist = options.maxDistance ?? 4096;
  const sliceDepth = Math.max(1, Math.min(d, options.sliceDepth ?? d));
  const p: NvdfParams = { ...NVDF_DEFAULTS, ...options.params };
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
  const jfa = compute('jfa', JFA_WGSL, 'jfa', [uniformEntry(C), storage(1, 'read-only-storage'), storage(2, 'read-only-storage'), storage(3, 'storage'), storage(4, 'storage')]);
  const nvdfK = compute('nvdf', NVDF_WGSL, 'nvdfMain', [uniformEntry(C), ...weatherEntries, storage(3, 'storage'), storage(4, 'storage')]);
  const profileK = compute('profile', PROFILE_WGSL, 'profileMain', [
    uniformEntry(C), ...weatherEntries, storage(3, 'read-only-storage'), storage(4, 'read-only-storage'),
    { binding: 5, visibility: C, storageTexture: { access: 'write-only', format: 'rgba8unorm', viewDimension: '3d' } },
  ]);
  const sdfK = compute('sdf', SDF_WGSL, 'sdfMain', [uniformEntry(C), storage(1, 'read-only-storage'), storage(2, 'read-only-storage'), storage(3, 'storage')]);

  // ---- resources ----
  const size3: GPUExtent3D = { width: w, height: h, depthOrArrayLayers: d };
  const nvdf = device.createTexture({ label: `${label} nvdf`, dimension: '3d', format: 'rgba8unorm', size: size3, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC });
  const sdf = device.createTexture({ label: `${label} sdf`, dimension: '3d', format: 'r16float', size: size3, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC });
  const scratch = options.scratch ?? createGeneratorScratch(device, [w, h, d], label);
  if (scratch.dims[0] !== w || scratch.dims[1] !== h || scratch.dims[2] !== d) throw new Error('scratch dims differ from the volume dims');
  const ownsScratch = !options.scratch;
  const seeds3 = scratch.seeds;
  const rowBytes = Math.ceil(w * 2 / 256) * 256; // copyBufferToTexture rows are 256-byte aligned
  const sdfStaging = scratch.staging;
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  let weatherView = options.weather.createView();
  let origin: [number, number] = [...(options.origin ?? [0, 0])];

  // ---- plan ----
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
    f[6] = margin; f[7] = maxDist; f[8] = voxelSize; f[9] = p.coverageThreshold; f[10] = p.useMapHeights ? 1 : 0; f[11] = p.baseDefault;
    f[12] = p.topFraction; f[13] = p.domeExponent; f[14] = p.billowAmp; f[15] = p.billowCellMeters;
    f[16] = p.seed; f[17] = p.scaleBase; f[18] = p.scaleTop; f[19] = p.profileSigma; f[20] = p.detailBias; f[21] = p.baseLift; f[22] = origin[0]; f[23] = origin[1];
  };
  const bgl = (x: { pipeline: GPUComputePipeline }) => x.pipeline.getBindGroupLayout(0);
  // One 256-byte-aligned parameter slot per dispatch (dynamic offsets): per z chunk, nvdf + profile + sdf + one per jump-flood step.
  const maxSlots = Math.ceil(d / sliceDepth) * (3 + steps3.length);
  const params = device.createBuffer({ label: `${label} params`, size: maxSlots * PARAM_STRIDE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const uni = { buffer: params, size: PARAM_BYTES } as GPUBufferBinding;
  const jfaBG = (set: GPUBuffer[], from: 0 | 1) => device.createBindGroup({
    label: `jfa ${from}`, layout: bgl(jfa),
    entries: [{ binding: 0, resource: uni }, { binding: 1, resource: { buffer: set[from * 2] } }, { binding: 2, resource: { buffer: set[from * 2 + 1] } }, { binding: 3, resource: { buffer: set[(1 - from) * 2] } }, { binding: 4, resource: { buffer: set[(1 - from) * 2 + 1] } }],
  });
  const jfa3BG = [jfaBG(seeds3, 0), jfaBG(seeds3, 1)];
  const final3 = steps3.length % 2; // seed set holding the last result
  const makeNvdfBG = () => device.createBindGroup({
    label: 'nvdf', layout: bgl(nvdfK),
    entries: [{ binding: 0, resource: uni }, { binding: 1, resource: weatherView }, { binding: 2, resource: sampler }, { binding: 3, resource: { buffer: seeds3[0] } }, { binding: 4, resource: { buffer: seeds3[1] } }],
  });
  const makeProfileBG = () => device.createBindGroup({
    label: 'profile', layout: bgl(profileK),
    entries: [{ binding: 0, resource: uni }, { binding: 1, resource: weatherView }, { binding: 2, resource: sampler }, { binding: 3, resource: { buffer: seeds3[final3 * 2] } }, { binding: 4, resource: { buffer: seeds3[final3 * 2 + 1] } }, { binding: 5, resource: nvdf.createView() }],
  });
  const sdfBG = device.createBindGroup({ label: 'sdf', layout: bgl(sdfK), entries: [{ binding: 0, resource: uni }, { binding: 1, resource: { buffer: seeds3[final3 * 2] } }, { binding: 2, resource: { buffer: seeds3[final3 * 2 + 1] } }, { binding: 3, resource: { buffer: sdfStaging } }] });

  const bindings = { nvdf: makeNvdfBG(), profile: makeProfileBG() };
  const jobs: Job[] = [];
  const push = (j: Job) => jobs.push(j);
  // 3D stages, chunked in z
  const chunks: [number, number][] = [];
  for (let z = 0; z < d; z += sliceDepth) chunks.push([z, Math.min(sliceDepth, d - z)]);
  for (const [z0, n] of chunks) push({ label: 'nvdf', pipeline: nvdfK.pipeline, bindGroup: 'nvdf', groups: [Math.ceil(w / 8), Math.ceil(h / 8), Math.ceil(n / 4)],
    slot: addSlot((u, _i, f) => common(u, f, [w, h, d], z0, n)) });
  steps3.forEach((step, k) => {
    for (const [z0, n] of chunks) push({ label: 'jfa3d', pipeline: jfa.pipeline, bindGroup: jfa3BG[k % 2], groups: [Math.ceil(w / 8), Math.ceil(h / 8), Math.ceil(n / 4)],
      slot: addSlot((u, i, f) => { common(u, f, [w, h, d], z0, n); i[3] = step; }) });
  });
  for (const [z0, n] of chunks) push({ label: 'profile', pipeline: profileK.pipeline, bindGroup: 'profile', groups: [Math.ceil(w / 8), Math.ceil(h / 8), Math.ceil(n / 4)],
    slot: addSlot((u, _i, f) => common(u, f, [w, h, d], z0, n)) });
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
    pass.setBindGroup(0, typeof j.bindGroup === 'string' ? bindings[j.bindGroup] : j.bindGroup, [j.slot * PARAM_STRIDE]);
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
    nvdf.destroy(); sdf.destroy(); params.destroy();
    if (ownsScratch) scratch.destroy();
  };
  const v = voxelSize;
  return {
    volume: { nvdf, sdf, dims: [w, h, d], voxelSize: v, extentMeters: [w * v, d * v, h * v], destroy },
    get jobsTotal() { return groupedJobs.length; },
    get jobsDone() { return cursor; },
    get done() { return cursor >= groupedJobs.length; },
    jobLabels,
    get origin() { return origin; },
    restart(next) {
      if (next?.weather) { weatherView = next.weather.createView(); bindings.nvdf = makeNvdfBG(); bindings.profile = makeProfileBG(); }
      if (next?.origin) {
        origin = [...next.origin];
        const f = new Float32Array(all.buffer);
        for (let i = 0; i < slots.length; i++) { f[i * (PARAM_STRIDE / 4) + 22] = origin[0]; f[i * (PARAM_STRIDE / 4) + 23] = origin[1]; }
        device.queue.writeBuffer(params, 0, all);
      }
      cursor = 0;
    },
    generate(encoder, maxJobs = Infinity) {
      let n = 0;
      while (cursor < groupedJobs.length && n < maxJobs) { for (const j of groupedJobs[cursor]) run(encoder, j); cursor++; n++; }
      return { done: cursor >= groupedJobs.length, jobsEncoded: n, jobsDone: cursor, jobsTotal: groupedJobs.length };
    },
    destroy,
  };
}
