import { LIGHT_GRID_BUILD_WGSL, LIGHT_GRID_MAX_STEPS, LIGHT_GRID_PARAM_BYTES } from './shaders/light-grid.wgsl';
import { volumeWgsl } from './shaders/volume.wgsl';
import type { GpuTimer } from './gpu-timer';

export { lightGridWgsl, LIGHT_GRID_MAX_STEPS } from './shaders/light-grid.wgsl';

export const LIGHT_GRID_SLICE_PASSES = 8;
/** Grids above this many voxels spread a rebuild over proportionally more frames (one more 8-frame block per ~1 M voxels). */
const PASS_BLOCK_VOXELS = 1 << 20;

/** Number of frames a sun-driven rebuild is spread over: 8 for small grids (Parkouring), 16 at 256x256x32, never more than the slice count. */
export function lightGridPasses(dims: readonly [number, number, number]): number {
  const voxels = dims[0] * dims[1] * dims[2];
  return Math.max(1, Math.min(dims[2], LIGHT_GRID_SLICE_PASSES * Math.max(1, Math.round(voxels / PASS_BLOCK_VOXELS))));
}
export const LIGHT_GRID_RESTART_DEGREES = 0.5;
const MIN_AXIS = 16;
const PARAM_RING = 8;

// Numeric flags so the module loads where the GPU* globals do not exist (unit tests).
const TEXTURE_BINDING = 0x04, STORAGE_BINDING = 0x08, COPY_SRC = 0x01, COMPUTE = 0x4, BUF_UNIFORM = 0x40, BUF_COPY_DST = 0x08;

/** Grid dims in texture axes (x, map row, up): ceil(volume dims / 2), at least 16 per axis. */
export function lightGridDims(volumeDims: readonly [number, number, number]): [number, number, number] {
  return volumeDims.map(d => Math.max(MIN_AXIS, Math.ceil(d / 2))) as [number, number, number];
}

export interface LightGridFrameParams {
  /** Unit vector toward the sun, world y-up. */
  sunDirection: readonly [number, number, number];
  /** Multiplier on the summed profile*density (raw 0..1 units). */
  densityScale: number;
  frameIndex: number;
}

export interface SliceDispatch { z0: number; z1: number; sun: [number, number, number]; densityScale: number; target: 0 | 1 }
export interface SchedulerStep {
  /** Slice range to build this frame into texture `target`, or null when idle. */
  dispatch: SliceDispatch | null;
  /** True when this step completed a build and `front` now points at the finished texture. */
  swapped: boolean;
  /** True when an in-progress build was thrown away because the sun (or density scale) moved. */
  restarted: boolean;
  front: 0 | 1;
}

function angleDegrees(a: readonly number[], b: readonly number[]): number {
  const la = Math.hypot(a[0], a[1], a[2]), lb = Math.hypot(b[0], b[1], b[2]);
  const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb);
  return Math.acos(Math.min(1, Math.max(-1, c))) * 180 / Math.PI;
}
function normalize(v: readonly number[]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * Pure slice scheduler. Builds 1/8 of the z-slices per step into the back texture and swaps when all 8 are done.
 * The first-ever build runs all slices in one step (startup only). The sun used for a build is latched when it starts;
 * a sun move > 0.5 degrees away from the latched sun restarts the build at slice 0. When idle, a build starts as
 * soon as the sun is > 0.5 degrees from the front's sun or the density scale changed.
 */
export class LightGridScheduler {
  front: 0 | 1 = 0;
  /** Sun of the finished front texture, or null before the first build completes. */
  frontSun: [number, number, number] | null = null;
  frontDensityScale = NaN;
  private cursor = 0;
  private buildSun: [number, number, number] = [0, 1, 0];
  private buildDensity = 0;
  private lastFrame = NaN;
  private invalidated = false;

  constructor(readonly depth: number, readonly passes = LIGHT_GRID_SLICE_PASSES, readonly restartDegrees = LIGHT_GRID_RESTART_DEGREES) {}

  get building(): boolean { return this.cursor > 0; }
  get progress(): number { return this.cursor; }
  /** Force a rebuild even if the sun is unchanged (volume edited). */
  invalidate(): void { this.invalidated = true; }

  step(sunDirection: readonly [number, number, number], densityScale: number, frameIndex?: number): SchedulerStep {
    const idle = { dispatch: null, swapped: false, restarted: false, front: this.front } as SchedulerStep;
    if (frameIndex !== undefined) {
      if (frameIndex === this.lastFrame) return idle; // same frame encoded twice: do not advance
      this.lastFrame = frameIndex;
    }
    const sun = normalize(sunDirection);
    let restarted = false;
    if (this.cursor > 0) {
      if (angleDegrees(sun, this.buildSun) > this.restartDegrees || densityScale !== this.buildDensity) {
        this.cursor = 0; restarted = true;
      }
    }
    if (this.cursor === 0) {
      const needs = this.frontSun === null || this.invalidated || densityScale !== this.frontDensityScale
        || angleDegrees(sun, this.frontSun) > this.restartDegrees;
      if (!needs) return { ...idle, restarted };
      this.buildSun = sun; this.buildDensity = densityScale; this.invalidated = false;
    }
    const firstEver = this.frontSun === null;
    const z0 = firstEver ? 0 : Math.floor(this.cursor * this.depth / this.passes);
    const z1 = firstEver ? this.depth : Math.floor((this.cursor + 1) * this.depth / this.passes);
    const target = (1 - this.front) as 0 | 1;
    const dispatch: SliceDispatch = { z0, z1, sun: this.buildSun, densityScale: this.buildDensity, target };
    this.cursor = firstEver ? this.passes : this.cursor + 1;
    let swapped = false;
    if (this.cursor >= this.passes) {
      this.cursor = 0;
      this.front = target;
      this.frontSun = this.buildSun;
      this.frontDensityScale = this.buildDensity;
      swapped = true;
    }
    return { dispatch, swapped, restarted, front: this.front };
  }
}

export interface LightGridVolume {
  dims: readonly [number, number, number];
  voxelSize: number;
  extentMeters: readonly [number, number, number];
}

export interface LightGrid {
  readonly dims: [number, number, number];
  readonly format: 'rgba16float';
  /** The two ping-pong textures. Consumers bind textures[scheduler.front]; a bound texture is always a complete grid. */
  readonly textures: [GPUTexture, GPUTexture];
  readonly views: [GPUTextureView, GPUTextureView];
  readonly sampler: GPUSampler;
  readonly scheduler: LightGridScheduler;
  /** Sun-independent reduced volume (r = profile*scale at grid resolution, g = upward optical depth), built on the first encode and after invalidate(). */
  readonly reduced: GPUTexture;
  /** Index of the finished (sampleable) texture. Changes only on the frame a build completes. */
  readonly frontIndex: 0 | 1;
  readonly frontTexture: GPUTexture;
  readonly frontView: GPUTextureView;
  /**
   * Bind group layout entries for lightGridWgsl(group, binding): texture at `binding`, sampler at `binding + 1`.
   * Build two bind groups (one per texture) and select with frontIndex.
   */
  bindGroupLayoutEntries(binding: number, visibility: number): GPUBindGroupLayoutEntry[];
  bindGroupEntries(binding: number, textureIndex: 0 | 1): GPUBindGroupEntry[];
  /** Records at most one compute pass into `encoder`. No submit, no await. */
  encode(encoder: GPUCommandEncoder, volumeBindGroup: GPUBindGroup, params: LightGridFrameParams, timer?: GpuTimer): SchedulerStep;
  invalidate(): void;
  destroy(): void;
}

export function createLightGrid(device: GPUDevice, volumeLayout: GPUBindGroupLayout, volume: LightGridVolume): LightGrid {
  const dims = lightGridDims(volume.dims);
  const make = (i: number) => device.createTexture({
    label: `light grid ${i}`, dimension: '3d', format: 'rgba16float', size: { width: dims[0], height: dims[1], depthOrArrayLayers: dims[2] },
    usage: TEXTURE_BINDING | STORAGE_BINDING | COPY_SRC,
  });
  const textures: [GPUTexture, GPUTexture] = [make(0), make(1)];
  const views: [GPUTextureView, GPUTextureView] = [textures[0].createView(), textures[1].createView()];
  const reduced = device.createTexture({
    label: 'light grid reduced', dimension: '3d', format: 'rgba16float', size: { width: dims[0], height: dims[1], depthOrArrayLayers: dims[2] },
    usage: TEXTURE_BINDING | STORAGE_BINDING,
  });
  const reducedView = reduced.createView();
  const sampler = device.createSampler({ label: 'light grid', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });

  const passLayout = device.createBindGroupLayout({
    label: 'light grid build',
    entries: [
      { binding: 0, visibility: COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '3d' } },
      { binding: 2, visibility: COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 3, visibility: COMPUTE, sampler: { type: 'filtering' } },
    ],
  });
  // The reduce pass writes the reduced volume, so it cannot share a bind group with the build (which samples it).
  const reduceLayout = device.createBindGroupLayout({
    label: 'light grid reduce',
    entries: [{ binding: 1, visibility: COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '3d' } }],
  });
  const module = device.createShaderModule({ label: 'light grid build', code: volumeWgsl(0) + LIGHT_GRID_BUILD_WGSL });
  const pipeline = device.createComputePipeline({
    label: 'light grid build',
    layout: device.createPipelineLayout({ bindGroupLayouts: [volumeLayout, passLayout] }),
    compute: { module, entryPoint: 'buildLightGrid' },
  });
  const reducePipeline = device.createComputePipeline({
    label: 'light grid reduce',
    layout: device.createPipelineLayout({ bindGroupLayouts: [volumeLayout, reduceLayout] }),
    compute: { module, entryPoint: 'reduceLightGrid' },
  });
  const reduceGroup = device.createBindGroup({ label: 'light grid reduce', layout: reduceLayout, entries: [{ binding: 1, resource: reducedView }] });
  let reducedValid = false;
  const paramBuffers = Array.from({ length: PARAM_RING }, (_, i) => device.createBuffer({ label: `light grid params ${i}`, size: LIGHT_GRID_PARAM_BYTES, usage: BUF_UNIFORM | BUF_COPY_DST }));
  const passBindGroups = [0, 1].map(t => paramBuffers.map((b, i) => device.createBindGroup({
    label: `light grid pass ${t}/${i}`, layout: passLayout,
    entries: [{ binding: 0, resource: { buffer: b } }, { binding: 1, resource: views[t] }, { binding: 2, resource: reducedView }, { binding: 3, resource: sampler }],
  })));
  const scheduler = new LightGridScheduler(dims[2], lightGridPasses(dims));
  const paramData = new ArrayBuffer(LIGHT_GRID_PARAM_BYTES);
  const f32 = new Float32Array(paramData), u32 = new Uint32Array(paramData);
  let ring = 0;

  return {
    dims, format: 'rgba16float', textures, views, sampler, scheduler, reduced,
    get frontIndex() { return scheduler.front; },
    get frontTexture() { return textures[scheduler.front]; },
    get frontView() { return views[scheduler.front]; },
    bindGroupLayoutEntries(binding, visibility) {
      return [
        { binding, visibility, texture: { sampleType: 'float', viewDimension: '3d' } },
        { binding: binding + 1, visibility, sampler: { type: 'filtering' } },
      ];
    },
    bindGroupEntries(binding, textureIndex) {
      return [{ binding, resource: views[textureIndex] }, { binding: binding + 1, resource: sampler }];
    },
    encode(encoder, volumeBindGroup, params, timer) {
      const result = scheduler.step(params.sunDirection, params.densityScale, params.frameIndex);
      const d = result.dispatch;
      if (!d) return result;
      if (!reducedValid) {
        const rp = encoder.beginComputePass({ label: 'light grid reduce', timestampWrites: timer?.passTimestampWrites('lightGridReduce') });
        rp.setPipeline(reducePipeline);
        rp.setBindGroup(0, volumeBindGroup);
        rp.setBindGroup(1, reduceGroup);
        rp.dispatchWorkgroups(Math.ceil(dims[0] / 8), Math.ceil(dims[1] / 8), 1);
        rp.end();
        reducedValid = true;
      }
      const slot = ring++ % PARAM_RING;
      f32[0] = d.sun[0]; f32[1] = d.sun[1]; f32[2] = d.sun[2]; f32[3] = d.densityScale;
      u32[4] = d.z0; u32[5] = LIGHT_GRID_MAX_STEPS; u32[6] = 0; u32[7] = 0;
      device.queue.writeBuffer(paramBuffers[slot], 0, paramData);
      const pass = encoder.beginComputePass({ label: 'light grid', timestampWrites: timer?.passTimestampWrites('lightGrid') });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, volumeBindGroup);
      pass.setBindGroup(1, passBindGroups[d.target][slot]);
      pass.dispatchWorkgroups(Math.ceil(dims[0] / 4), Math.ceil(dims[1] / 4), d.z1 - d.z0);
      pass.end();
      return result;
    },
    invalidate() { reducedValid = false; scheduler.invalidate(); },
    destroy() { textures[0].destroy(); textures[1].destroy(); reduced.destroy(); paramBuffers.forEach(b => b.destroy()); },
  };
}
