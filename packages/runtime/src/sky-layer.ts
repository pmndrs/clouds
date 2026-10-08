// Distant sky layer (P3-C1, P3-C2): Nubis vertical-profile (2.5D) clouds from the voxel region out to the horizon. No three imports.
// See shaders/sky-layer.wgsl.ts for the method. This file owns the weather bake, the pipelines, the temporal history and the
// per-frame uniforms (including the reset logic of the 16-frame amortization).
import { encodeProceduralWeatherMap, type ProceduralWeatherOptions } from './generate/weather';
import { NVDF_DEFAULTS, type NvdfParams } from './generate/volume-generator';
import type { GpuTimer } from './gpu-timer';
import { COMMON_WGSL } from './shaders/common.wgsl';
import { DENSITY_WGSL } from './shaders/density.wgsl';
import { MARCH_ATMOSPHERE_GROUP } from './shaders/march.wgsl';
import {
  SKY_BACK_BINDING, SKY_COLOR_BINDING, SKY_DEPTH_BINDING, SKY_LIGHT_STORAGE_BINDING, SKY_PARAMS_BINDING, SKY_PARAM_BYTES, SKY_PARAM_FLOATS, SKY_RESOLVE_BINDINGS,
  SKY_RESOLVE_WGSL, SKY_SAMPLER_BINDING, SKY_TEMPORAL_PERIOD, SKY_WEATHER_BINDING, skyLayerWgsl,
} from './shaders/sky-layer.wgsl';
import { volumeWgsl } from './shaders/volume.wgsl';

/** Live knobs. Safe to change every frame (a change resets the temporal history), except `resolutionScale` (re-allocates the targets). */
export interface SkyLayerSettings {
  /** Master switch. Off by default; with it off the voxel pipeline is untouched. */
  enabled: boolean;
  /** Multiplier on the extinction (CloudSettings.densityScale) for the distant clouds. */
  densityScale: number;
  /** Ray length cap in metres; the layer fades out over its last quarter. */
  maxDistance: number;
  maxSteps: number;
  /** Rays stop once transmittance falls below this. */
  transmittanceCutoff: number;
  /** Adaptive step (Nubis 2.5D): stepMin + stepRel * distance, metres. */
  stepMin: number;
  stepRel: number;
  /** Scales the distances at which the finer billow octaves fade out (1 = octave 2 over 5-10 km, octave 1 over 12-24 km). */
  lodScale: number;
  /** Planet curvature 1/(2R) in 1/m, applied about the volume centre. 0 = flat (the default; 1/(2*6371000) for Earth). */
  curvature: number;
  /** Render resolution relative to the output (linear). */
  resolutionScale: number;
  /** 16-frame temporal amortization (one pixel per 4x4 block per frame, reprojected history). Off = every pixel every frame. */
  temporal: boolean;
  /** Weight of a fresh trace sample against the reprojected history (the jitter changes each cycle, so < 1 supersamples). */
  temporalBlend: number;
  /** Debug view (0 = off): 1 first-hit distance, 2 step count, 3 depthMax, 4 no billow, 5 profile at first hit, 6 no jitter, 7 depth at first hit. */
  debug: number;
}

export interface SkyLayerOptions {
  /** The weather options the voxel generator was given (seed, scale, cellular, ...). `size` and `border` are ignored for the bake. */
  weather: Partial<ProceduralWeatherOptions>;
  /** The generator's shaping parameters (topFraction, domeExponent, baseDefault, baseLift, coverageThreshold, scaleBase/Top, detailBias, billow, seed, profileSigma). */
  shape?: Partial<NvdfParams>;
  /** The generator's voxel size in metres (the profile noise is correlated over 3 voxels). Default 8. */
  voxelSize?: number;
  /** Extent of the baked world-anchored weather window, centred on the volume. Defaults: 51200 m at 2048^2 (25 m texels). */
  window?: { size?: number; resolution?: number };
  /**
   * Box handoff. 0 (the default when the weather `border` is 0): one continuous field, hard partition at the box wall (the voxel
   * march renders the inside). > 0: the P3-C1 cross-fade over this many metres, the complement of the generator's border fade
   * (default when `border` > 0: border times the box size). < 0: no mask, the layer also covers the box (debug).
   */
  rimWidth?: number;
}

export interface SkyLayer {
  readonly settings: SkyLayerSettings;
  /** Provide the weather and shaping the voxel field was generated from. Triggers a (one-off) bake of the weather window. */
  configure(options: SkyLayerOptions): void;
  readonly configured: boolean;
  /** Resolved parameters actually in use (after defaults): for reports and tests. */
  readonly info: { rimWidth: number; windowSize: number; windowResolution: number; shell: [number, number]; resets: number; frames: number } | null;
  /** Bake / compile what is missing. True when the layer can render this frame. Call before `encode`. */
  prepare(encoder: GPUCommandEncoder, box: SkyBox, uniformLighting: boolean): boolean;
  encode(encoder: GPUCommandEncoder, args: SkyEncodeArgs): void;
  /** Drop the temporal history: the next frame traces every pixel. Call on a cut the layer cannot detect itself. */
  reset(): void;
  dispose(): void;
}
export interface SkyBox { minCorner: ArrayLike<number>; extent: ArrayLike<number> }
export interface SkyEncodeArgs {
  volumeGroup: GPUBindGroup;
  frameBuffer: GPUBuffer;
  depth: GPUTextureView;
  /** The resolved layer the composite reads: the part in front of the box, the mean distance / scene end, the part behind the box. */
  color: GPUTexture;
  depthOut: GPUTexture;
  back: GPUTexture;
  atmosphere?: GPUBindGroup;
  skyLightBuffer: GPUBuffer;
  box: SkyBox;
  /** Column-major, as in the frame uniforms; used to reproject the history. */
  inverseViewProjection: ArrayLike<number>;
  cameraPosition: ArrayLike<number>;
  sunDirection: ArrayLike<number>;
  timer?: GpuTimer;
}

export const SKY_LAYER_DEFAULTS: SkyLayerSettings = {
  enabled: false, densityScale: 1, maxDistance: 30000, maxSteps: 256, transmittanceCutoff: 0.05, stepMin: 8, stepRel: 0.006, lodScale: 0.7, curvature: 0,
  resolutionScale: 0.25, temporal: true, temporalBlend: 0.3, debug: 0,
};

/** Weather window mip levels: level 0 the bake, levels 1.. the 2x2 maxima (the trace's empty-space skip reads up to level 6). */
const WEATHER_MIPS = 7;
const MAX_MIP_WGSL = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba8unorm, write>;
@compute @workgroup_size(8, 8)
fn maxMip(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(dst);
  if (any(gid.xy >= dims)) { return; }
  let b = vec2<i32>(gid.xy) * 2;
  let sd = vec2<i32>(textureDimensions(src)) - vec2<i32>(1);
  var m = vec4(0.0);
  for (var y = 0; y < 2; y++) { for (var x = 0; x < 2; x++) { m = max(m, textureLoad(src, min(b + vec2<i32>(x, y), sd), 0)); } }
  textureStore(dst, vec2<i32>(gid.xy), m);
}
`;

const CUT_POSITION_M = 25;            // camera jump per frame that resets the history
const CUT_TURN_COS = Math.cos((15 * Math.PI) / 180);
const SUN_JUMP_COS = Math.cos((0.5 * Math.PI) / 180);
const MODEL_PARAM_FLOATS = 36;        // params[0..36) describe the cloud model; a change resets the history

/** Invert a column-major 4x4 (gl-matrix style). Returns false when singular. */
function invert4(m: ArrayLike<number>, out: Float32Array): boolean {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det || !Number.isFinite(det)) return false;
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return true;
}
/** World-space forward direction of a column-major inverse view-projection (centre of the screen, near to far). */
function forwardOf(inv: ArrayLike<number>, out: Float32Array): void {
  const pt = (z: number) => {
    const x = inv[8] * z + inv[12], y = inv[9] * z + inv[13], w = inv[10] * z + inv[14], ww = inv[11] * z + inv[15];
    return [x / ww, y / ww, w / ww];
  };
  const a = pt(0), b = pt(1);
  let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const l = Math.hypot(dx, dy, dz) || 1;
  dx /= l; dy /= l; dz /= l;
  out[0] = dx; out[1] = dy; out[2] = dz;
}

export function createSkyLayer(device: GPUDevice, volumeLayout: GPUBindGroupLayout, atmosphereLayout: GPUBindGroupLayout): SkyLayer {
  const settings: SkyLayerSettings = { ...SKY_LAYER_DEFAULTS };
  const C = GPUShaderStage.COMPUTE;
  const layout = device.createBindGroupLayout({ label: 'cloud sky trace', entries: [
    { binding: 0, visibility: C, buffer: { type: 'uniform' } },
    { binding: 1, visibility: C, texture: { sampleType: 'depth' } },
    { binding: SKY_COLOR_BINDING, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
    { binding: SKY_DEPTH_BINDING, visibility: C, storageTexture: { access: 'write-only', format: 'rg32float' } },
    { binding: SKY_WEATHER_BINDING, visibility: C, texture: { sampleType: 'float' } },
    { binding: SKY_SAMPLER_BINDING, visibility: C, sampler: { type: 'filtering' } },
    { binding: SKY_LIGHT_STORAGE_BINDING, visibility: C, buffer: { type: 'read-only-storage' } },
    { binding: SKY_PARAMS_BINDING, visibility: C, buffer: { type: 'uniform' } },
    { binding: SKY_BACK_BINDING, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
  ] });
  const R = SKY_RESOLVE_BINDINGS;
  const resolveLayout = device.createBindGroupLayout({ label: 'cloud sky resolve', entries: [
    { binding: 0, visibility: C, buffer: { type: 'uniform' } },
    { binding: 1, visibility: C, texture: { sampleType: 'depth' } },
    { binding: R.trace, visibility: C, texture: { sampleType: 'unfilterable-float' } },
    { binding: R.traceDepth, visibility: C, texture: { sampleType: 'unfilterable-float' } },
    { binding: R.hist, visibility: C, texture: { sampleType: 'float' } },
    { binding: R.histDepth, visibility: C, texture: { sampleType: 'unfilterable-float' } },
    { binding: R.histOut, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
    { binding: R.histDepthOut, visibility: C, storageTexture: { access: 'write-only', format: 'rg32float' } },
    { binding: R.params, visibility: C, buffer: { type: 'uniform' } },
    { binding: R.sampler, visibility: C, sampler: { type: 'filtering' } },
    { binding: R.traceBack, visibility: C, texture: { sampleType: 'unfilterable-float' } },
    { binding: R.histBack, visibility: C, texture: { sampleType: 'float' } },
    { binding: R.histBackOut, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
  ] });
  const sampler = device.createSampler({ label: 'sky weather', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const maxMipPipeline = device.createComputePipeline({ label: 'cloud sky weather max mip', layout: 'auto', compute: { module: device.createShaderModule({ label: 'cloud sky weather max mip', code: MAX_MIP_WGSL }), entryPoint: 'maxMip' } });
  const encodeMaxMips = (encoder: GPUCommandEncoder, tex: GPUTexture) => {
    for (let k = 1; k < tex.mipLevelCount; k++) {
      const bg = device.createBindGroup({ layout: maxMipPipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: tex.createView({ baseMipLevel: k - 1, mipLevelCount: 1 }) },
        { binding: 1, resource: tex.createView({ baseMipLevel: k, mipLevelCount: 1 }) },
      ] });
      const pass = encoder.beginComputePass({ label: `cloud sky weather max mip ${k}` });
      pass.setPipeline(maxMipPipeline);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(Math.ceil((tex.width >> k) / 8), Math.ceil((tex.height >> k) / 8));
      pass.end();
    }
  };
  const paramBuffer = device.createBuffer({ label: 'cloud sky params', size: SKY_PARAM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const params = new Float32Array(SKY_PARAM_FLOATS);
  const prevModel = new Float32Array(MODEL_PARAM_FLOATS);

  let options: SkyLayerOptions | null = null;
  let weather: GPUTexture | null = null;
  let dirty = false;
  const bakedBox = new Float64Array(6);
  let baked = false;
  let resolved: NvdfParams = { ...NVDF_DEFAULTS };
  let rimWidth = 0, windowSize = 0, windowRes = 0, voxelSize = 8;
  let shell: [number, number] = [0, 0];
  const pipelines: Record<'atmosphere' | 'uniform', GPUComputePipeline | null | 'pending'> = { atmosphere: null, uniform: null };
  let resolvePipeline: GPUComputePipeline | null | 'pending' = null;
  let group: GPUBindGroup | null = null;
  const groupKey: unknown[] = [null, null, null, null, null];
  const resolveGroups: (GPUBindGroup | null)[] = [null, null];
  const resolveKey: unknown[] = [null, null, null, null];
  let disposed = false;

  // Temporal state: the sparse trace target and two history buffers (ping-pong), all at the layer's resolution.
  let temporal: { w: number; h: number; trace: GPUTexture; traceBack: GPUTexture; traceDepth: GPUTexture; hist: GPUTexture[]; histBack: GPUTexture[]; histDepth: GPUTexture[] } | null = null;
  let histIndex = 0;
  let needReset = true;
  let frames = 0, resets = 0;
  const prevViewProj = new Float32Array(16);
  const prevCam = new Float32Array(3), prevFwd = new Float32Array(3), prevSun = new Float32Array(3), fwd = new Float32Array(3);
  let prevValid = false;

  const compile = (mode: 'atmosphere' | 'uniform') => {
    pipelines[mode] = 'pending';
    const code = COMMON_WGSL + volumeWgsl(0) + DENSITY_WGSL + skyLayerWgsl(mode);
    const bgls = mode === 'atmosphere' ? [volumeLayout, layout, atmosphereLayout] : [volumeLayout, layout];
    void device.createComputePipelineAsync({
      label: `cloud sky trace ${mode}`,
      layout: device.createPipelineLayout({ bindGroupLayouts: bgls }),
      compute: { module: device.createShaderModule({ label: `cloud sky trace ${mode}`, code }), entryPoint: 'trace' },
    }).then(p => { if (!disposed) pipelines[mode] = p; }, e => { console.error('sky layer pipeline failed', e); });
    if (resolvePipeline === null) {
      resolvePipeline = 'pending';
      void device.createComputePipelineAsync({
        label: 'cloud sky resolve',
        layout: device.createPipelineLayout({ bindGroupLayouts: [volumeLayout, resolveLayout] }),
        compute: { module: device.createShaderModule({ label: 'cloud sky resolve', code: SKY_RESOLVE_WGSL }), entryPoint: 'resolve' },
      }).then(p => { if (!disposed) resolvePipeline = p; }, e => { console.error('sky resolve pipeline failed', e); });
    }
  };

  const releaseTemporal = () => {
    if (!temporal) return;
    temporal.trace.destroy(); temporal.traceBack.destroy(); temporal.traceDepth.destroy();
    temporal.hist.forEach(t => t.destroy()); temporal.histBack.forEach(t => t.destroy()); temporal.histDepth.forEach(t => t.destroy());
    temporal = null; resolveGroups[0] = resolveGroups[1] = null; group = null;
  };
  const ensureTemporal = (w: number, h: number) => {
    if (temporal && temporal.w === w && temporal.h === h) return;
    releaseTemporal();
    const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC;
    const color = (label: string) => device.createTexture({ label, size: [w, h], format: 'rgba16float', usage });
    const depth = (label: string) => device.createTexture({ label, size: [w, h], format: 'rg32float', usage });
    temporal = {
      w, h, trace: color('cloud sky trace colour'), traceBack: color('cloud sky trace back'), traceDepth: depth('cloud sky trace depth'),
      hist: [color('cloud sky history 0'), color('cloud sky history 1')], histBack: [color('cloud sky history back 0'), color('cloud sky history back 1')],
      histDepth: [depth('cloud sky history depth 0'), depth('cloud sky history depth 1')],
    };
    needReset = true;
  };

  const sameBox = (box: SkyBox) => {
    if (!baked) return false;
    for (let i = 0; i < 3; i++) if (bakedBox[i] !== box.minCorner[i] || bakedBox[3 + i] !== box.extent[i]) return false;
    return true;
  };

  return {
    settings,
    get configured() { return !!options; },
    get info() { return options ? { rimWidth, windowSize, windowResolution: windowRes, shell, resets, frames } : null; },
    configure(o) {
      options = o;
      resolved = { ...NVDF_DEFAULTS, ...o.shape };
      voxelSize = o.voxelSize ?? 8;
      dirty = true;
    },
    reset() { needReset = true; },
    prepare(encoder, box, uniformLighting) {
      if (disposed || !options) return false;
      const mode = uniformLighting ? 'uniform' : 'atmosphere';
      if (pipelines[mode] === null) compile(mode);
      if (dirty || !weather || !sameBox(box)) {
        // Bake the weather window once (static, world-anchored): uv = (xz - boxMin) / boxExtent continues the generator's map outward.
        const minX = box.minCorner[0], minZ = box.minCorner[2], sx = box.extent[0], sz = box.extent[2];
        windowSize = options.window?.size ?? 51200;
        windowRes = options.window?.resolution ?? 2048;
        const cx = minX + sx / 2, cz = minZ + sz / 2;
        const origin: [number, number] = [(cx - windowSize / 2 - minX) / sx, (cz - windowSize / 2 - minZ) / sz];
        const size: [number, number] = [windowSize / sx, windowSize / sz];
        weather?.destroy();
        weather = encodeProceduralWeatherMap(device, encoder, { ...options.weather, size: [windowRes, windowRes], border: 0, window: { origin, size }, mipLevels: WEATHER_MIPS });
        encodeMaxMips(encoder, weather);
        const border = options.weather.border ?? 0.08;
        rimWidth = options.rimWidth ?? border * Math.min(sx, sz);   // the generator fades coverage over `border` of the map (uv) at every edge
        shell = [box.minCorner[1], box.minCorner[1] + box.extent[1]];
        for (let i = 0; i < 3; i++) { bakedBox[i] = box.minCorner[i]; bakedBox[3 + i] = box.extent[i]; }
        baked = true; dirty = false; group = null; needReset = true;
      }
      return typeof pipelines[mode] === 'object' && pipelines[mode] !== null && typeof resolvePipeline === 'object' && resolvePipeline !== null;
    },
    encode(encoder, a) {
      const s = settings;
      const mode = a.atmosphere ? 'atmosphere' : 'uniform';
      const pipeline = pipelines[mode];
      if (!weather || !pipeline || pipeline === 'pending' || !resolvePipeline || resolvePipeline === 'pending') return;
      const w = a.color.width, h = a.color.height;
      ensureTemporal(w, h);
      const tmp = temporal!;
      const minX = a.box.minCorner[0], minZ = a.box.minCorner[2], sx = a.box.extent[0], sz = a.box.extent[2];
      const cx = minX + sx / 2, cz = minZ + sz / 2;
      const p = params;
      p[0] = cx - windowSize / 2; p[1] = cz - windowSize / 2; p[2] = windowSize; p[3] = windowSize;
      p[4] = minX; p[5] = minZ; p[6] = sx; p[7] = sz;
      p[8] = shell[0]; p[9] = shell[1]; p[10] = s.maxDistance; p[11] = s.curvature;
      p[12] = resolved.topFraction; p[13] = resolved.domeExponent; p[14] = resolved.baseDefault; p[15] = resolved.baseLift;
      p[16] = resolved.coverageThreshold; p[17] = 0; p[18] = resolved.scaleBase; p[19] = resolved.scaleTop;
      p[20] = resolved.detailBias; p[21] = rimWidth; p[22] = s.densityScale; p[23] = 0.04;
      p[24] = s.stepMin; p[25] = s.stepRel; p[26] = s.maxSteps; p[27] = s.transmittanceCutoff;
      p[28] = resolved.billowAmp; p[29] = resolved.billowCellMeters; p[30] = resolved.seed; p[31] = s.debug;
      p[32] = voxelSize; p[33] = resolved.profileSigma; p[34] = s.lodScale; p[35] = s.temporalBlend;
      // Cuts: a camera jump or turn, a sun jump, or any model change invalidates the history (the next frame traces every pixel).
      const cam = a.cameraPosition, sun = a.sunDirection;
      forwardOf(a.inverseViewProjection, fwd);
      let cut = needReset || !prevValid || !s.temporal;
      if (!cut) {
        const d = Math.hypot(cam[0] - prevCam[0], cam[1] - prevCam[1], cam[2] - prevCam[2]);
        const turn = fwd[0] * prevFwd[0] + fwd[1] * prevFwd[1] + fwd[2] * prevFwd[2];
        const sunDot = sun[0] * prevSun[0] + sun[1] * prevSun[1] + sun[2] * prevSun[2];
        if (d > CUT_POSITION_M || turn < CUT_TURN_COS || sunDot < SUN_JUMP_COS) cut = true;
        for (let i = 0; i < MODEL_PARAM_FLOATS && !cut; i++) if (p[i] !== prevModel[i]) cut = true;
      }
      if (cut && s.temporal) resets++;
      const period = SKY_TEMPORAL_PERIOD;
      p[36] = frames % period; p[37] = Math.floor(frames / period); p[38] = cut ? 1 : 0; p[39] = 0;
      p.set(prevViewProj, 40);
      p[56] = prevCam[0]; p[57] = prevCam[1]; p[58] = prevCam[2]; p[59] = prevValid && !cut ? 1 : 0;
      device.queue.writeBuffer(paramBuffer, 0, p);
      prevModel.set(p.subarray(0, MODEL_PARAM_FLOATS));
      // Remember this frame's view for the next frame's reprojection.
      prevValid = invert4(a.inverseViewProjection, prevViewProj);
      prevCam[0] = cam[0]; prevCam[1] = cam[1]; prevCam[2] = cam[2];
      prevFwd.set(fwd); prevSun[0] = sun[0]; prevSun[1] = sun[1]; prevSun[2] = sun[2];
      needReset = false;
      frames++;

      const gk = groupKey;
      if (!group || gk[0] !== weather || gk[1] !== a.frameBuffer || gk[2] !== a.depth || gk[3] !== tmp.trace || gk[4] !== a.skyLightBuffer) {
        gk[0] = weather; gk[1] = a.frameBuffer; gk[2] = a.depth; gk[3] = tmp.trace; gk[4] = a.skyLightBuffer;
        group = device.createBindGroup({ label: 'cloud sky trace', layout, entries: [
          { binding: 0, resource: { buffer: a.frameBuffer } },
          { binding: 1, resource: a.depth },
          { binding: SKY_COLOR_BINDING, resource: tmp.trace.createView() },
          { binding: SKY_DEPTH_BINDING, resource: tmp.traceDepth.createView() },
          { binding: SKY_WEATHER_BINDING, resource: weather.createView() },
          { binding: SKY_SAMPLER_BINDING, resource: sampler },
          { binding: SKY_LIGHT_STORAGE_BINDING, resource: { buffer: a.skyLightBuffer } },
          { binding: SKY_PARAMS_BINDING, resource: { buffer: paramBuffer } },
          { binding: SKY_BACK_BINDING, resource: tmp.traceBack.createView() },
        ] });
      }
      if (!resolveGroups[0] || resolveKey[0] !== a.frameBuffer || resolveKey[1] !== a.depth) {
        resolveKey[0] = a.frameBuffer; resolveKey[1] = a.depth;
        for (let i = 0; i < 2; i++) {
          resolveGroups[i] = device.createBindGroup({ label: `cloud sky resolve ${i}`, layout: resolveLayout, entries: [
            { binding: 0, resource: { buffer: a.frameBuffer } },
            { binding: 1, resource: a.depth },
            { binding: R.trace, resource: tmp.trace.createView() },
            { binding: R.traceDepth, resource: tmp.traceDepth.createView() },
            { binding: R.hist, resource: tmp.hist[i].createView() },
            { binding: R.histDepth, resource: tmp.histDepth[i].createView() },
            { binding: R.histOut, resource: tmp.hist[1 - i].createView() },
            { binding: R.histDepthOut, resource: tmp.histDepth[1 - i].createView() },
            { binding: R.params, resource: { buffer: paramBuffer } },
            { binding: R.sampler, resource: sampler },
            { binding: R.traceBack, resource: tmp.traceBack.createView() },
            { binding: R.histBack, resource: tmp.histBack[i].createView() },
            { binding: R.histBackOut, resource: tmp.histBack[1 - i].createView() },
          ] });
        }
      }
      const trace = encoder.beginComputePass({ label: 'cloud sky trace', timestampWrites: a.timer?.passTimestampWrites('skyLayer') });
      trace.setPipeline(pipeline);
      trace.setBindGroup(0, a.volumeGroup);
      trace.setBindGroup(1, group);
      if (a.atmosphere) trace.setBindGroup(MARCH_ATMOSPHERE_GROUP, a.atmosphere);
      if (cut) trace.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
      else trace.dispatchWorkgroups(Math.ceil(w / 4 / 8), Math.ceil(h / 4 / 8));
      trace.end();
      const resolve = encoder.beginComputePass({ label: 'cloud sky resolve', timestampWrites: a.timer?.passTimestampWrites('skyResolve') });
      resolve.setPipeline(resolvePipeline);
      resolve.setBindGroup(0, a.volumeGroup);
      resolve.setBindGroup(1, resolveGroups[histIndex]!);
      resolve.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
      resolve.end();
      // The new history is the resolved layer: copy it to the composite's targets (they need COPY_DST).
      const next = 1 - histIndex;
      const size = { width: w, height: h };
      encoder.copyTextureToTexture({ texture: tmp.hist[next] }, { texture: a.color }, size);
      encoder.copyTextureToTexture({ texture: tmp.histBack[next] }, { texture: a.back }, size);
      encoder.copyTextureToTexture({ texture: tmp.histDepth[next] }, { texture: a.depthOut }, size);
      histIndex = next;
    },
    dispose() {
      disposed = true;
      weather?.destroy(); weather = null; paramBuffer.destroy(); group = null; releaseTemporal();
    },
  };
}
