// GPU generation of a Nubis voxel field (NVDF + SDF) from a 2D weather map. No three imports.
//
// Pipeline (all jobs are separate dispatches/passes so they can be spread over frames):
//   nvdf     occupancy f > 0 of the smooth 3D cloud field (domed envelope + billow erosion, see shaders.ts SHAPE) -> class bit of the field buffer
//   edt-x/y/z  exact separable Euclidean distance transform (Felzenszwalb-Huttenlocher) in place in one u16-per-voxel buffer, one signed
//            volume for both the inside and the outside distance (see shaders.ts EDT_COMMON). Replaces the 3D jump flood and its 268 MB of seeds.
//   profile  NVDF channels from the finished transform: Guerrilla's profile-vs-depth / detail / density-scale fit -> rgba8unorm 3D
//   sdf      signed distance in metres, minus a conservative margin -> f16, in place in the same buffer -> copied into the r16float 3D texture
import type { GpuCloudVolume } from '../resources';
import { NVDF_DEFAULTS, PARAM_BYTES, altoFractions, type NvdfParams } from './volume-generator';
import { EDT_X_WGSL, NVDF_WGSL, PROFILE_WGSL, SDF_WGSL, edtLineWGSL } from './passes';


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
  /** Conservative margin subtracted from |SDF| in voxels. Default 1. 0 gives the raw (exact, floored to 1/64 voxel) EDT. */
  marginVoxels?: number;
  /** Ignored: kept for API compatibility (the distance transform is exact, no jump-flood refinement). */
  refinePasses?: 0 | 1 | 2;
  /** SDF clamp in metres (r16float handles 65504, the shipped assets use 4096). Default 4096. */
  maxDistance?: number;
  /** Called once per job pass with the stage name, to attach timestamp queries. */
  timestamps?: (label: string) => GPUComputePassTimestampWrites | undefined;
  label?: string;
  /** World position (metres) of voxel (0, 0) along x and the map row. Multiples of `voxelSize` keep windows on one lattice. Default [0, 0]. */
  origin?: [number, number];
  /** Shared scratch buffer (see `createGeneratorScratch`). Generators that share one must not generate at the same time; the caller owns it. */
  scratch?: GeneratorScratch;
  /** A cumulonimbus (P6-C): a 3D cell unioned with the field in the shape stage. `restart({ storm })` moves it along its life cycle. */
  storm?: StormCellState;
  /**
   * P9-C terrain stub (for T3 valley seas): ground height in metres above the volume base over the volume footprint (uv as the weather map),
   * a filterable float texture (r16float), red channel. Clouds stand on it where it is above their base and thin out where it rises to within
   * 48 m of their top, so a stratus layer pools in the valleys under a flat top. The sky layer has no terrain (the far field is unchanged).
   */
  terrain?: GPUTexture;
}

/** One storm cell for the generator, in its own metres (voxel * voxelSize + origin along x and the map row; heights above the volume base). */
export interface StormCellState {
  /** Centre of the cell (x, map row), generator metres. */
  center: [number, number];
  /** Life phase: age / seconds to grow (tower rises over 0..0.75, anvil 0.42..1.05, tower gone by 2.6, anvil by 3.6). */
  phase: number;
  /** Mature tower radius and top height (m, above `baseHeight`), mature anvil radius (m). */
  towerRadius: number;
  towerHeight: number;
  anvilRadius: number;
  /** Base of the cell above the volume base, m. Default 60. */
  baseHeight?: number;
  /** Direction the anvil is carried (x, map row). Default [1, 0.35]. */
  shear?: [number, number];
}

/**
 * The temporary buffer of a generator: one u16-per-voxel distance field that doubles as the SDF staging buffer
 * (33.6 MB at 512 x 512 x 64; the old 3D jump flood needed 4 seed buffers and a staging buffer, 302 MB).
 */
export interface GeneratorScratch { dims: [number, number, number]; field: GPUBuffer; /** Size of `field` in bytes. */ bytes: number; destroy(): void }

/** Bytes of the scratch field for a volume (rows padded to 256 B so it is also the copyBufferToTexture source). */
export function scratchBytes(dims: readonly [number, number, number]): number { return Math.ceil(dims[0] * 2 / 256) * 256 * dims[1] * dims[2]; }

export function createGeneratorScratch(device: GPUDevice, dims: [number, number, number], label = 'generator scratch'): GeneratorScratch {
  const bytes = scratchBytes(dims);
  const field = device.createBuffer({ label: `${label} edt field`, size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  return { dims: [...dims], field, bytes, destroy() { field.destroy(); } };
}

/** GPU memory held by a generator, in bytes. `scratch` is shared when the generator was given one (count it once). */
export interface GeneratorMemory { nvdf: number; sdf: number; scratch: number; params: number; total: number }

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
  restart(next?: { weather?: GPUTexture; origin?: [number, number]; storm?: StormCellState | null }): void;
  /** World origin (metres) of the volume's voxel (0, 0) along x and the map row. */
  readonly origin: readonly [number, number];
  /** Encode up to `maxJobs` further jobs (default all remaining) into `encoder`. The caller submits. */
  generate(encoder: GPUCommandEncoder, maxJobs?: number): GenerateProgress;
  /** Stage name of each job, in order. */
  readonly jobLabels: readonly string[];
  /** GPU memory this generator holds (the weather map is the caller's and not counted). */
  readonly memoryBytes: GeneratorMemory;
  destroy(): void;
}




const PARAM_STRIDE = 256;
const STORM_WORD = 24;

/** Split [0, total) into at most `count` contiguous [start, length] ranges of equal size (the last may be shorter). */
export function rangeChunks(total: number, count: number): [number, number][] {
  const per = Math.ceil(total / Math.max(1, count));
  const out: [number, number][] = [];
  for (let s = 0; s < total; s += per) out.push([s, Math.min(per, total - s)]);
  return out;
}
type Job = { label: string; pipeline: GPUComputePipeline; bindGroup: GPUBindGroup | 'nvdf' | 'profile'; slot: number; groups: [number, number, number]; copy?: { z0: number; n: number } };

export function createVolumeGenerator(device: GPUDevice, options: VolumeGeneratorOptions): VolumeGenerator {
  const [w, h, d] = options.dims;
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
    { binding: 6, visibility: C, texture: { sampleType: 'float', viewDimension: '2d' } },
  ];
  const compute = (name: string, code: string, entryPoint: string, entries: GPUBindGroupLayoutEntry[]) => {
    const layout = layoutOf(name, entries);
    return {
      layout,
      pipeline: device.createComputePipeline({ label: `${label} ${name}`, layout, compute: { module: device.createShaderModule({ label: name, code }), entryPoint } }),
    };
  };
  const edtX = compute('edt-x', EDT_X_WGSL, 'edtX', [uniformEntry(C), storage(1, 'storage')]);
  const edtY = compute('edt-y', edtLineWGSL('y', h), 'edtLine', [uniformEntry(C), storage(1, 'storage')]);
  const edtZ = compute('edt-z', edtLineWGSL('z', d), 'edtLine', [uniformEntry(C), storage(1, 'storage')]);
  const nvdfK = compute('nvdf', NVDF_WGSL, 'nvdfMain', [uniformEntry(C), ...weatherEntries, storage(3, 'storage')]);
  const profileK = compute('profile', PROFILE_WGSL, 'profileMain', [
    uniformEntry(C), ...weatherEntries, storage(3, 'read-only-storage'),
    { binding: 5, visibility: C, storageTexture: { access: 'write-only', format: 'rgba8unorm', viewDimension: '3d' } },
  ]);
  const sdfK = compute('sdf', SDF_WGSL, 'sdfMain', [uniformEntry(C), storage(1, 'storage')]);

  // ---- resources ----
  const size3: GPUExtent3D = { width: w, height: h, depthOrArrayLayers: d };
  const nvdf = device.createTexture({ label: `${label} nvdf`, dimension: '3d', format: 'rgba8unorm', size: size3, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC });
  const sdf = device.createTexture({ label: `${label} sdf`, dimension: '3d', format: 'r16float', size: size3, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC });
  const scratch = options.scratch ?? createGeneratorScratch(device, [w, h, d], label);
  if (scratch.dims[0] !== w || scratch.dims[1] !== h || scratch.dims[2] !== d) throw new Error('scratch dims differ from the volume dims');
  const ownsScratch = !options.scratch;
  const field = scratch.field;
  const rowBytes = Math.ceil(w * 2 / 256) * 256; // copyBufferToTexture rows are 256-byte aligned
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  let weatherView = options.weather.createView();
  let origin: [number, number] = [...(options.origin ?? [0, 0])];
  let storm: StormCellState | null = options.storm ?? null;
  const stormWords = (f: Float32Array, at: number) => {
    const st = storm;
    f[at] = st ? 1 : 0;
    if (!st) return;
    f[at + 1] = st.center[0]; f[at + 2] = st.center[1]; f[at + 3] = st.baseHeight ?? 60;
    f[at + 4] = st.towerRadius; f[at + 5] = st.towerHeight; f[at + 6] = st.anvilRadius; f[at + 7] = st.phase;
    f[at + 8] = st.shear?.[0] ?? 1; f[at + 9] = st.shear?.[1] ?? 0.35;
  };
  const LEAN_WORD = STORM_WORD + 10;
  const PROFILE_WORD = LEAN_WORD + 2;
  const volH = d * voxelSize;
  const alto = altoFractions(p, volH);
  // Terrain stub: the caller's texture, or a 1x1 zero ground.
  const terrainTex = options.terrain ?? device.createTexture({ label: `${label} no terrain`, size: [1, 1], format: 'r16float', usage: GPUTextureUsage.TEXTURE_BINDING });
  const terrainView = terrainTex.createView();

  // ---- plan ----
  const slots: ArrayBuffer[] = [];
  const addSlot = (fill: (u: Uint32Array, i: Int32Array, f: Float32Array) => void): number => {
    const a = new ArrayBuffer(PARAM_BYTES);
    const u = new Uint32Array(a), i = new Int32Array(a), f = new Float32Array(a);
    fill(u, i, f);
    slots.push(a);
    return slots.length - 1;
  };
  const common = (u: Uint32Array, f: Float32Array, dims: [number, number, number], zStart: number, zCount: number) => {
    u[0] = dims[0]; u[1] = dims[1]; u[2] = dims[2]; f[3] = p.edgeFade; u[4] = zStart; u[5] = zCount;
    f[6] = margin; f[7] = maxDist; f[8] = voxelSize; f[9] = p.coverageThreshold; f[10] = p.useMapHeights ? 1 : 0; f[11] = p.baseDefault;
    f[12] = p.topFraction; f[13] = p.domeExponent; f[14] = p.billowAmp; f[15] = p.billowCellMeters;
    f[16] = p.seed; f[17] = p.scaleBase; f[18] = p.scaleTop; f[19] = p.profileSigma; f[20] = p.detailBias; f[21] = p.baseLift; f[22] = origin[0]; f[23] = origin[1];
    stormWords(f, STORM_WORD);
    f[LEAN_WORD] = p.shearX; f[LEAN_WORD + 1] = p.shearY;
    f[PROFILE_WORD] = p.profiles ? 1 : 0; f[PROFILE_WORD + 1] = alto[0]; f[PROFILE_WORD + 2] = alto[1]; f[PROFILE_WORD + 3] = options.terrain ? 1 : 0;
  };
  const bgl = (x: { pipeline: GPUComputePipeline }) => x.pipeline.getBindGroupLayout(0);
  // One 256-byte-aligned parameter slot per dispatch (dynamic offsets): per chunk, nvdf + edt x/y/z + profile + sdf.
  const maxSlots = Math.ceil(d / sliceDepth) * 6;
  const params = device.createBuffer({ label: `${label} params`, size: maxSlots * PARAM_STRIDE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const uni = { buffer: params, size: PARAM_BYTES } as GPUBufferBinding;
  const fieldBG = (k: { pipeline: GPUComputePipeline }) => device.createBindGroup({ label: 'edt', layout: bgl(k), entries: [{ binding: 0, resource: uni }, { binding: 1, resource: { buffer: field } }] });
  const makeNvdfBG = () => device.createBindGroup({
    label: 'nvdf', layout: bgl(nvdfK),
    entries: [{ binding: 0, resource: uni }, { binding: 1, resource: weatherView }, { binding: 2, resource: sampler }, { binding: 3, resource: { buffer: field } }, { binding: 6, resource: terrainView }],
  });
  const makeProfileBG = () => device.createBindGroup({
    label: 'profile', layout: bgl(profileK),
    entries: [{ binding: 0, resource: uni }, { binding: 1, resource: weatherView }, { binding: 2, resource: sampler }, { binding: 3, resource: { buffer: field } }, { binding: 5, resource: nvdf.createView() }, { binding: 6, resource: terrainView }],
  });

  const bindings = { nvdf: makeNvdfBG(), profile: makeProfileBG() };
  const edtBG = { x: fieldBG(edtX), y: fieldBG(edtY), z: fieldBG(edtZ), sdf: fieldBG(sdfK) };
  const jobs: Job[] = [];
  const push = (j: Job) => jobs.push(j);
  // 3D stages, chunked in z
  const chunks: [number, number][] = [];
  for (let z = 0; z < d; z += sliceDepth) chunks.push([z, Math.min(sliceDepth, d - z)]);
  for (const [z0, n] of chunks) push({ label: 'nvdf', pipeline: nvdfK.pipeline, bindGroup: 'nvdf', groups: [Math.ceil(w / 16), Math.ceil(h / 8), Math.ceil(n / 4)],
    slot: addSlot((u, _i, f) => common(u, f, [w, h, d], z0, n)) });
  // Exact EDT: x rows and y columns chunk over z; z columns chunk over y (the same number of chunks).
  const ychunks = rangeChunks(h, chunks.length);
  const line = (rows: number) => Math.ceil(rows / 64);
  for (const [z0, n] of chunks) push({ label: 'edt-x', pipeline: edtX.pipeline, bindGroup: edtBG.x, groups: [line(h * n), 1, 1], slot: addSlot((u, _i, f) => common(u, f, [w, h, d], z0, n)) });
  for (const [z0, n] of chunks) push({ label: 'edt-y', pipeline: edtY.pipeline, bindGroup: edtBG.y, groups: [line(w * n), 1, 1], slot: addSlot((u, _i, f) => common(u, f, [w, h, d], z0, n)) });
  for (const [y0, n] of ychunks) push({ label: 'edt-z', pipeline: edtZ.pipeline, bindGroup: edtBG.z, groups: [line(w * n), 1, 1], slot: addSlot((u, _i, f) => common(u, f, [w, h, d], y0, n)) });
  for (const [z0, n] of chunks) push({ label: 'profile', pipeline: profileK.pipeline, bindGroup: 'profile', groups: [Math.ceil(w / 8), Math.ceil(h / 8), Math.ceil(n / 4)],
    slot: addSlot((u, _i, f) => common(u, f, [w, h, d], z0, n)) });
  for (const [z0, n] of chunks) push({ label: 'sdf', pipeline: sdfK.pipeline, bindGroup: edtBG.sdf, groups: [Math.ceil(w / 16), Math.ceil(h / 8), Math.ceil(n / 4)], copy: { z0, n },
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
      encoder.copyBufferToTexture({ buffer: field, offset: j.copy.z0 * rowBytes * h, bytesPerRow: rowBytes, rowsPerImage: h },
        { texture: sdf, origin: { x: 0, y: 0, z: j.copy.z0 } }, { width: w, height: h, depthOrArrayLayers: j.copy.n });
    }
  };

  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    nvdf.destroy(); sdf.destroy(); params.destroy();
    if (!options.terrain) terrainTex.destroy();
    if (ownsScratch) scratch.destroy();
  };
  const v = voxelSize;
  const texBytes = (bpp: number) => w * h * d * bpp;
  const memoryBytes: GeneratorMemory = { nvdf: texBytes(4), sdf: texBytes(2), scratch: scratch.bytes, params: maxSlots * PARAM_STRIDE, total: 0 };
  memoryBytes.total = memoryBytes.nvdf + memoryBytes.sdf + memoryBytes.scratch + memoryBytes.params;
  return {
    memoryBytes,
    volume: { nvdf, sdf, dims: [w, h, d], voxelSize: v, extentMeters: [w * v, d * v, h * v], destroy },
    get jobsTotal() { return groupedJobs.length; },
    get jobsDone() { return cursor; },
    get done() { return cursor >= groupedJobs.length; },
    jobLabels,
    get origin() { return origin; },
    restart(next) {
      if (next?.weather) { weatherView = next.weather.createView(); bindings.nvdf = makeNvdfBG(); bindings.profile = makeProfileBG(); }
      if (next?.origin) origin = [...next.origin];
      if (next?.storm !== undefined) storm = next.storm;
      if (next?.origin || next?.storm !== undefined) {
        const f = new Float32Array(all.buffer);
        for (let i = 0; i < slots.length; i++) { const at = i * (PARAM_STRIDE / 4); f[at + 22] = origin[0]; f[at + 23] = origin[1]; stormWords(f, at + STORM_WORD); }
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
