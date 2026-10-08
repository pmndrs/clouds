// Distant sky layer (P3-C1): Nubis vertical-profile (2.5D) clouds from the voxel region out to the horizon. No three imports.
// See shaders/sky-layer.wgsl.ts for the method. This file owns the weather bake, the pipeline and the per-frame uniforms.
import { encodeProceduralWeatherMap, type ProceduralWeatherOptions } from './generate/weather';
import { NVDF_DEFAULTS, type NvdfParams } from './generate/volume-generator';
import type { GpuTimer } from './gpu-timer';
import { COMMON_WGSL } from './shaders/common.wgsl';
import { DENSITY_WGSL } from './shaders/density.wgsl';
import { MARCH_ATMOSPHERE_GROUP } from './shaders/march.wgsl';
import {
  SKY_COLOR_BINDING, SKY_DEPTH_BINDING, SKY_LIGHT_STORAGE_BINDING, SKY_PARAMS_BINDING, SKY_PARAM_BYTES, SKY_PARAM_FLOATS, SKY_SAMPLER_BINDING,
  SKY_WEATHER_BINDING, skyLayerWgsl,
} from './shaders/sky-layer.wgsl';
import { volumeWgsl } from './shaders/volume.wgsl';

/** Live knobs. Safe to change every frame, except `resolutionScale` (re-allocates the targets). */
export interface SkyLayerSettings {
  /** Master switch. Off by default; with it off the voxel pipeline is untouched. */
  enabled: boolean;
  /** Multiplier on the extinction (CloudSettings.densityScale) for the distant clouds. */
  densityScale: number;
  /** Ray length cap in metres; the layer fades out over its last quarter. */
  maxDistance: number;
  maxSteps: number;
  /** Rays stop once transmittance falls below this (looser than the voxel march: this layer is far and soft). */
  transmittanceCutoff: number;
  /** Adaptive step (Nubis 2.5D): stepMin + stepRel * distance, metres. */
  stepMin: number;
  stepRel: number;
  /** Metres below the surface per unit of the generator's shape field (turns its smooth field into a depth for the profile). */
  depthScale: number;
  /** Planet curvature 1/(2R) in 1/m, applied about the volume centre. 0 = flat (the default; 1/(2*6371000) for Earth). */
  curvature: number;
  /** Render resolution relative to the output (linear). */
  resolutionScale: number;
}

export interface SkyLayerOptions {
  /** The weather options the voxel generator was given (seed, scale, cellular, ...). `size` and `border` are ignored for the bake. */
  weather: Partial<ProceduralWeatherOptions>;
  /** The generator's shaping parameters (topFraction, domeExponent, baseDefault, baseLift, coverageThreshold, scaleBase/Top, detailBias). */
  shape?: Partial<NvdfParams>;
  /** Extent of the baked world-anchored weather window, centred on the volume. Defaults: 51200 m at 2048^2 (25 m texels). */
  window?: { size?: number; resolution?: number };
  /** Width of the box-rim cross-fade in metres (default: the weather `border` times the box size). Negative disables the rim: the layer then also covers the box (debug). */
  rimWidth?: number;
}

export interface SkyLayer {
  readonly settings: SkyLayerSettings;
  /** Provide the weather and shaping the voxel field was generated from. Triggers a (one-off) bake of the weather window. */
  configure(options: SkyLayerOptions): void;
  readonly configured: boolean;
  /** Resolved parameters actually in use (after defaults): for reports and tests. */
  readonly info: { rimWidth: number; windowSize: number; windowResolution: number; shell: [number, number] } | null;
  /** Bake / compile what is missing. True when the layer can render this frame. Call before `encode`. */
  prepare(encoder: GPUCommandEncoder, box: SkyBox, uniformLighting: boolean): boolean;
  encode(encoder: GPUCommandEncoder, args: SkyEncodeArgs): void;
  dispose(): void;
}
export interface SkyBox { minCorner: ArrayLike<number>; extent: ArrayLike<number> }
export interface SkyEncodeArgs {
  volumeGroup: GPUBindGroup;
  frameBuffer: GPUBuffer;
  depth: GPUTextureView;
  color: GPUTexture;
  depthOut: GPUTexture;
  atmosphere?: GPUBindGroup;
  skyLightBuffer: GPUBuffer;
  box: SkyBox;
  timer?: GpuTimer;
}

export const SKY_LAYER_DEFAULTS: SkyLayerSettings = {
  enabled: false, densityScale: 1, maxDistance: 30000, maxSteps: 384, transmittanceCutoff: 0.1, stepMin: 16, stepRel: 0.006, depthScale: 200, curvature: 0, resolutionScale: 0.25,
};

export function createSkyLayer(device: GPUDevice, volumeLayout: GPUBindGroupLayout, atmosphereLayout: GPUBindGroupLayout): SkyLayer {
  const settings: SkyLayerSettings = { ...SKY_LAYER_DEFAULTS };
  const C = GPUShaderStage.COMPUTE;
  const layout = device.createBindGroupLayout({ label: 'cloud sky layer', entries: [
    { binding: 0, visibility: C, buffer: { type: 'uniform' } },
    { binding: 1, visibility: C, texture: { sampleType: 'depth' } },
    { binding: SKY_COLOR_BINDING, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
    { binding: SKY_DEPTH_BINDING, visibility: C, storageTexture: { access: 'write-only', format: 'rg32float' } },
    { binding: SKY_WEATHER_BINDING, visibility: C, texture: { sampleType: 'float' } },
    { binding: SKY_SAMPLER_BINDING, visibility: C, sampler: { type: 'filtering' } },
    { binding: SKY_LIGHT_STORAGE_BINDING, visibility: C, buffer: { type: 'read-only-storage' } },
    { binding: SKY_PARAMS_BINDING, visibility: C, buffer: { type: 'uniform' } },
  ] });
  const sampler = device.createSampler({ label: 'sky weather', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const paramBuffer = device.createBuffer({ label: 'cloud sky params', size: SKY_PARAM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const params = new Float32Array(SKY_PARAM_FLOATS);

  let options: SkyLayerOptions | null = null;
  let weather: GPUTexture | null = null;
  let dirty = false;
  const bakedBox = new Float64Array(6);
  let baked = false;
  let resolved: NvdfParams = { ...NVDF_DEFAULTS };
  let rimWidth = 0, windowSize = 0, windowRes = 0;
  let shell: [number, number] = [0, 0];
  const pipelines: Record<'atmosphere' | 'uniform', GPUComputePipeline | null | 'pending'> = { atmosphere: null, uniform: null };
  let group: GPUBindGroup | null = null;
  const groupKey: unknown[] = [null, null, null, null, null, null];
  let disposed = false;

  const compile = (mode: 'atmosphere' | 'uniform') => {
    pipelines[mode] = 'pending';
    const code = COMMON_WGSL + volumeWgsl(0) + DENSITY_WGSL + skyLayerWgsl(mode);
    const bgls = mode === 'atmosphere' ? [volumeLayout, layout, atmosphereLayout] : [volumeLayout, layout];
    void device.createComputePipelineAsync({
      label: `cloud sky layer ${mode}`,
      layout: device.createPipelineLayout({ bindGroupLayouts: bgls }),
      compute: { module: device.createShaderModule({ label: `cloud sky layer ${mode}`, code }), entryPoint: 'main' },
    }).then(p => { if (!disposed) pipelines[mode] = p; }, e => { console.error('sky layer pipeline failed', e); });
  };

  const sameBox = (box: SkyBox) => {
    if (!baked) return false;
    for (let i = 0; i < 3; i++) if (bakedBox[i] !== box.minCorner[i] || bakedBox[3 + i] !== box.extent[i]) return false;
    return true;
  };

  return {
    settings,
    get configured() { return !!options; },
    get info() { return options ? { rimWidth, windowSize, windowResolution: windowRes, shell } : null; },
    configure(o) {
      options = o;
      resolved = { ...NVDF_DEFAULTS, ...o.shape };
      dirty = true;
    },
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
        weather = encodeProceduralWeatherMap(device, encoder, { ...options.weather, size: [windowRes, windowRes], border: 0, window: { origin, size } });
        const border = options.weather.border ?? 0.08;
        rimWidth = options.rimWidth ?? border * Math.min(sx, sz);   // the generator fades coverage over `border` of the map (uv) at every edge
        shell = [box.minCorner[1], box.minCorner[1] + box.extent[1]];
        for (let i = 0; i < 3; i++) { bakedBox[i] = box.minCorner[i]; bakedBox[3 + i] = box.extent[i]; }
        baked = true; dirty = false; group = null;
      }
      return typeof pipelines[mode] === 'object' && pipelines[mode] !== null;
    },
    encode(encoder, a) {
      const s = settings;
      const mode = a.atmosphere ? 'atmosphere' : 'uniform';
      const pipeline = pipelines[mode];
      if (!weather || !pipeline || pipeline === 'pending') return;
      const minX = a.box.minCorner[0], minZ = a.box.minCorner[2], sx = a.box.extent[0], sz = a.box.extent[2];
      const cx = minX + sx / 2, cz = minZ + sz / 2;
      const p = params;
      p[0] = cx - windowSize / 2; p[1] = cz - windowSize / 2; p[2] = windowSize; p[3] = windowSize;
      p[4] = minX; p[5] = minZ; p[6] = sx; p[7] = sz;
      p[8] = shell[0]; p[9] = shell[1]; p[10] = s.maxDistance; p[11] = s.curvature;
      p[12] = resolved.topFraction; p[13] = resolved.domeExponent; p[14] = resolved.baseDefault; p[15] = resolved.baseLift;
      p[16] = resolved.coverageThreshold; p[17] = s.depthScale; p[18] = resolved.scaleBase; p[19] = resolved.scaleTop;
      p[20] = resolved.detailBias; p[21] = rimWidth; p[22] = s.densityScale; p[23] = 0.04;
      p[24] = s.stepMin; p[25] = s.stepRel; p[26] = s.maxSteps; p[27] = s.transmittanceCutoff;
      p[28] = resolved.billowAmp; p[29] = resolved.billowCellMeters; p[30] = resolved.seed; p[31] = 0;
      device.queue.writeBuffer(paramBuffer, 0, p);
      const gk = groupKey;
      if (!group || gk[0] !== weather || gk[1] !== a.frameBuffer || gk[2] !== a.depth || gk[3] !== a.color || gk[4] !== a.depthOut || gk[5] !== a.skyLightBuffer) {
        gk[0] = weather; gk[1] = a.frameBuffer; gk[2] = a.depth; gk[3] = a.color; gk[4] = a.depthOut; gk[5] = a.skyLightBuffer;
        group = device.createBindGroup({ label: 'cloud sky layer', layout, entries: [
          { binding: 0, resource: { buffer: a.frameBuffer } },
          { binding: 1, resource: a.depth },
          { binding: SKY_COLOR_BINDING, resource: a.color.createView() },
          { binding: SKY_DEPTH_BINDING, resource: a.depthOut.createView() },
          { binding: SKY_WEATHER_BINDING, resource: weather.createView() },
          { binding: SKY_SAMPLER_BINDING, resource: sampler },
          { binding: SKY_LIGHT_STORAGE_BINDING, resource: { buffer: a.skyLightBuffer } },
          { binding: SKY_PARAMS_BINDING, resource: { buffer: paramBuffer } },
        ] });
      }
      const pass = encoder.beginComputePass({ label: 'cloud sky layer', timestampWrites: a.timer?.passTimestampWrites('skyLayer') });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, a.volumeGroup);
      pass.setBindGroup(1, group);
      if (a.atmosphere) pass.setBindGroup(MARCH_ATMOSPHERE_GROUP, a.atmosphere);
      pass.dispatchWorkgroups(Math.ceil(a.color.width / 8), Math.ceil(a.color.height / 8));
      pass.end();
    },
    dispose() {
      disposed = true;
      weather?.destroy(); weather = null; paramBuffer.destroy(); group = null;
    },
  };
}
