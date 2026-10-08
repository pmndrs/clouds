import type { CloudNoiseAsset, CloudVolumeAsset } from './assets';
import type { GpuTimer } from './gpu-timer';
import { uploadCloudNoise, uploadCloudVolume, type GpuCloudVolume } from './resources';
import { COMMON_WGSL } from './shaders/common.wgsl';
import { COMPOSITE_WGSL } from './shaders/composite.wgsl';
import { DENSITY_WGSL } from './shaders/density.wgsl';
import { FRAME_UNIFORM_BYTES } from './shaders/frame.wgsl';
import { MARCH_WGSL } from './shaders/march.wgsl';
import { createVolumeBindGroup, createVolumeBindGroupLayout, createVolumeSamplers, volumeUniformData, volumeWgsl, VOLUME_UNIFORM_BYTES } from './shaders/volume.wgsl';

export type CloudQuality = 'high' | 'medium' | 'low';
const RENDER_SCALE: Record<CloudQuality, number> = { high: 0.5, medium: 0.35, low: 0.25 };

/** Live knobs. Safe to change every frame. */
export interface CloudSettings {
  /** Extinction coefficient (1/m) at density 1. */
  densityScale: number;
  /** Multiplier on the optical depth of the sun-direction samples. */
  lightDensityScale: number;
  /** Strength of the inner-glow (multiple scattering) term. */
  msStrength: number;
  /** Noise scroll position in metres (integrated from windVelocity). */
  windOffset: [number, number, number];
  windVelocity: [number, number, number];
  animSpeed: number;
  mipDistanceScale: number;
  baseMip: number;
  maxSteps: number;
}

export interface CloudFrame {
  /** Column-major 4x4. Only inverseViewProjection is read in P1; the rest are for later passes. */
  view: Float32Array;
  projection: Float32Array;
  viewProjection: Float32Array;
  inverseViewProjection: Float32Array;
  previousViewProjection: Float32Array;
  cameraPosition: ArrayLike<number>;
  /** Scene depth at output resolution, conventional 0..1 (depth-only aspect). */
  depth: GPUTextureView;
  depthKind: 'depth32float' | 'depth24plus';
  sunDirection: ArrayLike<number>;
  /** rgb, already scaled by the sky's exposure. */
  sunRadiance: ArrayLike<number>;
  ambientTop: ArrayLike<number>;
  ambientBottom: ArrayLike<number>;
  time: number;
  frameIndex: number;
}

export interface CloudRuntime {
  readonly settings: CloudSettings;
  /** Texture to blend: scene * a + rgb. Owned by the runtime unless one was passed to resize(). */
  readonly output: GPUTexture | null;
  readonly renderSize: [number, number];
  readonly ready: boolean;
  setVolume(asset: CloudVolumeAsset, options: { position: [number, number, number] }): Promise<void>;
  setNoise(asset: CloudNoiseAsset): Promise<void>;
  setQuality(quality: CloudQuality): void;
  /** `output` may be supplied by the caller (rgba16float, STORAGE_BINDING | TEXTURE_BINDING, exactly width x height). */
  resize(width: number, height: number, output?: GPUTexture): void;
  /** World-space extent of the volume once set, metres (x, y-up, z). */
  readonly extent: [number, number, number] | null;
  encode(encoder: GPUCommandEncoder, frame: CloudFrame, timer?: GpuTimer): void;
  dispose(): void;
}

export function createCloudRuntime(device: GPUDevice, options: { quality?: CloudQuality } = {}): CloudRuntime {
  let quality: CloudQuality = options.quality ?? 'high';
  const settings: CloudSettings = {
    densityScale: 0.3, lightDensityScale: 3, msStrength: 1,
    windOffset: [0, 0, 0], windVelocity: [3, 0, 1.5], animSpeed: 1,
    mipDistanceScale: 0.01, baseMip: 0, maxSteps: 768,
  };

  const volumeLayout = createVolumeBindGroupLayout(device);
  const C = GPUShaderStage.COMPUTE;
  const marchLayout = device.createBindGroupLayout({ label: 'cloud march', entries: [
    { binding: 0, visibility: C, buffer: { type: 'uniform' } },
    { binding: 1, visibility: C, texture: { sampleType: 'depth' } },
    { binding: 2, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
    { binding: 3, visibility: C, storageTexture: { access: 'write-only', format: 'rg32float' } },
  ] });
  const compositeLayout = device.createBindGroupLayout({ label: 'cloud composite', entries: [
    { binding: 0, visibility: C, buffer: { type: 'uniform' } },
    { binding: 1, visibility: C, texture: { sampleType: 'depth' } },
    { binding: 2, visibility: C, texture: { sampleType: 'unfilterable-float' } },
    { binding: 3, visibility: C, texture: { sampleType: 'unfilterable-float' } },
    { binding: 4, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
  ] });
  const pipeline = (label: string, code: string, group1: GPUBindGroupLayout) => device.createComputePipeline({
    label,
    layout: device.createPipelineLayout({ bindGroupLayouts: [volumeLayout, group1] }),
    compute: { module: device.createShaderModule({ label, code }), entryPoint: 'main' },
  });
  const marchPipeline = pipeline('cloud march', COMMON_WGSL + volumeWgsl(0) + DENSITY_WGSL + MARCH_WGSL, marchLayout);
  const compositePipeline = pipeline('cloud composite', COMMON_WGSL + volumeWgsl(0) + COMPOSITE_WGSL, compositeLayout);

  const samplers = createVolumeSamplers(device);
  const volumeUniforms = device.createBuffer({ label: 'cloud volume uniforms', size: VOLUME_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const frameUniforms = device.createBuffer({ label: 'cloud frame uniforms', size: FRAME_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const frameF32: Float32Array<ArrayBuffer> = new Float32Array(new ArrayBuffer(FRAME_UNIFORM_BYTES));
  const frameU32 = new Uint32Array(frameF32.buffer);

  let volume: GpuCloudVolume | null = null;
  let noise: GPUTexture | null = null;
  let volumeGroup: GPUBindGroup | null = null;
  let outW = 0, outH = 0;
  let renderW = 0, renderH = 0;
  let output: GPUTexture | null = null, ownsOutput = false;
  let marchColor: GPUTexture | null = null, marchDepth: GPUTexture | null = null;
  let marchGroup: GPUBindGroup | null = null, compositeGroup: GPUBindGroup | null = null;
  let boundDepth: GPUTextureView | null = null;
  let lastTime = -1;

  const rebuildVolumeGroup = () => {
    volumeGroup = volume && noise
      ? createVolumeBindGroup(device, volumeLayout, { uniforms: volumeUniforms, nvdf: volume.nvdf, sdf: volume.sdf, noise, ...samplers })
      : null;
  };
  const releaseTargets = () => {
    marchColor?.destroy(); marchDepth?.destroy();
    if (ownsOutput) output?.destroy();
    marchColor = marchDepth = output = null; marchGroup = compositeGroup = null; boundDepth = null;
  };
  const allocate = (externalOutput?: GPUTexture) => {
    releaseTargets();
    if (!outW) return;
    renderW = Math.max(1, Math.round(outW * RENDER_SCALE[quality]));
    renderH = Math.max(1, Math.round(outH * RENDER_SCALE[quality]));
    const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
    marchColor = device.createTexture({ label: 'cloud march colour', size: [renderW, renderH], format: 'rgba16float', usage });
    marchDepth = device.createTexture({ label: 'cloud march depth', size: [renderW, renderH], format: 'rg32float', usage });
    ownsOutput = !externalOutput;
    output = externalOutput ?? device.createTexture({ label: 'cloud composite', size: [outW, outH], format: 'rgba16float', usage });
  };
  let externalOutput: GPUTexture | undefined;

  return {
    settings,
    get output() { return output; },
    get renderSize(): [number, number] { return [renderW, renderH]; },
    get ready() { return !!volumeGroup && !!output; },
    get extent() { return volume ? volume.extentMeters : null; },
    async setVolume(asset, opts) {
      volume?.destroy();
      volume = uploadCloudVolume(device, asset);
      device.queue.writeBuffer(volumeUniforms, 0, new Float32Array(volumeUniformData(opts.position, volume.extentMeters, volume.voxelSize)));
      rebuildVolumeGroup();
    },
    async setNoise(asset) {
      noise?.destroy();
      noise = uploadCloudNoise(device, asset);
      rebuildVolumeGroup();
    },
    setQuality(q) { if (q !== quality) { quality = q; if (outW) allocate(externalOutput); } },
    resize(width, height, out) {
      if (width === outW && height === outH && out === externalOutput && output) return;
      outW = width; outH = height; externalOutput = out;
      allocate(out);
    },
    encode(encoder, frame, timer) {
      if (!volumeGroup || !output || !marchColor || !marchDepth) return;
      if (frame.depth !== boundDepth || !marchGroup) {
        boundDepth = frame.depth;
        marchGroup = device.createBindGroup({ label: 'cloud march', layout: marchLayout, entries: [
          { binding: 0, resource: { buffer: frameUniforms } },
          { binding: 1, resource: frame.depth },
          { binding: 2, resource: marchColor.createView() },
          { binding: 3, resource: marchDepth.createView() },
        ] });
        compositeGroup = device.createBindGroup({ label: 'cloud composite', layout: compositeLayout, entries: [
          { binding: 0, resource: { buffer: frameUniforms } },
          { binding: 1, resource: frame.depth },
          { binding: 2, resource: marchColor.createView() },
          { binding: 3, resource: marchDepth.createView() },
          { binding: 4, resource: output.createView() },
        ] });
      }
      const dt = lastTime < 0 ? 0 : Math.min(0.1, Math.max(0, frame.time - lastTime));
      lastTime = frame.time;
      for (let i = 0; i < 3; i++) settings.windOffset[i] += settings.windVelocity[i] * dt;

      const f = frameF32;
      f.set(frame.inverseViewProjection, 0);
      f.set([frame.cameraPosition[0], frame.cameraPosition[1], frame.cameraPosition[2], frame.time], 16);
      f.set([frame.sunDirection[0], frame.sunDirection[1], frame.sunDirection[2], settings.densityScale], 20);
      f.set([frame.sunRadiance[0], frame.sunRadiance[1], frame.sunRadiance[2]], 24);
      frameU32[27] = frame.frameIndex >>> 0;
      f.set([frame.ambientTop[0], frame.ambientTop[1], frame.ambientTop[2], settings.lightDensityScale], 28);
      f.set([frame.ambientBottom[0], frame.ambientBottom[1], frame.ambientBottom[2], settings.msStrength], 32);
      const k = settings.animSpeed;
      f.set([settings.windOffset[0] * k, settings.windOffset[1] * k, settings.windOffset[2] * k, settings.mipDistanceScale], 36);
      f.set([renderW, renderH, outW, outH, settings.baseMip], 40);
      frameU32[45] = settings.maxSteps >>> 0;
      device.queue.writeBuffer(frameUniforms, 0, f);

      const march = encoder.beginComputePass({ label: 'cloud march', timestampWrites: timer?.passTimestampWrites('march') });
      march.setPipeline(marchPipeline);
      march.setBindGroup(0, volumeGroup);
      march.setBindGroup(1, marchGroup);
      march.dispatchWorkgroups(Math.ceil(renderW / 8), Math.ceil(renderH / 8));
      march.end();

      const composite = encoder.beginComputePass({ label: 'cloud composite', timestampWrites: timer?.passTimestampWrites('composite') });
      composite.setPipeline(compositePipeline);
      composite.setBindGroup(0, volumeGroup);
      composite.setBindGroup(1, compositeGroup!);
      composite.dispatchWorkgroups(Math.ceil(outW / 8), Math.ceil(outH / 8));
      composite.end();
    },
    dispose() {
      releaseTargets(); volume?.destroy(); noise?.destroy();
      volumeUniforms.destroy(); frameUniforms.destroy();
    },
  };
}
