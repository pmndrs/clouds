import type { CloudNoiseAsset, CloudVolumeAsset } from './assets';
import type { GpuTimer } from './gpu-timer';
import { createLightGrid, type LightGrid } from './light-grid';
import { createAtmosphereBindGroupLayout } from './shaders/atmosphere.wgsl';
import { uploadCloudNoise, uploadCloudVolume, type GpuCloudVolume } from './resources';
import { COMMON_WGSL } from './shaders/common.wgsl';
import { COMPOSITE_WGSL } from './shaders/composite.wgsl';
import { DENSITY_WGSL } from './shaders/density.wgsl';
import { FRAME_UNIFORM_BYTES } from './shaders/frame.wgsl';
import { MARCH_ATMOSPHERE_GROUP, MARCH_LIGHT_GRID_BINDING, MARCH_SKY_LIGHT_BINDING, MARCH_WGSL, SKY_LIGHT_BINDING, SKY_LIGHT_WGSL } from './shaders/march.wgsl';
import { createVolumeBindGroup, createVolumeBindGroupLayout, createVolumeSamplers, volumeUniformData, volumeWgsl, VOLUME_UNIFORM_BYTES } from './shaders/volume.wgsl';

export type CloudQuality = 'high' | 'medium' | 'low';
const RENDER_SCALE: Record<CloudQuality, number> = { high: 0.5, medium: 0.35, low: 0.25 };

/** Live knobs. Safe to change every frame. */
export interface CloudSettings {
  /** Extinction coefficient (1/m) at density 1. */
  densityScale: number;
  /** Multiplier on the light grid's optical depth (the grid sums the cheap profile term, which underestimates the up-rezzed density). */
  lightDensityScale: number;
  /** Strength of the inner-glow (multiple scattering) term. Art knob, default 1. */
  msStrength: number;
  /** Strength of the sky-ambient term. Art knob, default 1. */
  ambientStrength: number;
  /** Weight of the forward (silver lining) HG lobe in the phase function, 0..1. */
  silverStrength: number;
  /** Anisotropy of the base lobe (Nubis: about 0.2) and of the forward lobe. */
  phaseG: number;
  silverG: number;
  /** Scales the optical depth the ambient light sees on its way down (exp(-k * tauUp)). */
  ambientExtinction: number;
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
  /** Bind group for atmosphereWgsl(2) (sky LUTs + uniform), e.g. the sky bridge's. Sun radiance, ambient and aerial perspective come from it. */
  atmosphere: GPUBindGroup;
  time: number;
  frameIndex: number;
}

export interface CloudRuntime {
  readonly settings: CloudSettings;
  /** Texture to blend: scene * a + rgb. Owned by the runtime unless one was passed to resize(). */
  readonly output: GPUTexture | null;
  readonly renderSize: [number, number];
  /** True once the volume, noise and output exist, so `encode` writes `output`. Present the plain scene until then. */
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

export interface CloudRuntimeOptions {
  quality?: CloudQuality;
  /** Layout the atmosphere bind group was created with. Omit to use the runtime's own (group-equivalent) layout. */
  atmosphereLayout?: GPUBindGroupLayout;
}

export function createCloudRuntime(device: GPUDevice, options: CloudRuntimeOptions = {}): CloudRuntime {
  let quality: CloudQuality = options.quality ?? 'high';
  const settings: CloudSettings = {
    densityScale: 0.2, lightDensityScale: 1.5, msStrength: 1, ambientStrength: 1,
    silverStrength: 0.4, phaseG: 0.2, silverG: 0.85, ambientExtinction: 1,
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
    { binding: MARCH_LIGHT_GRID_BINDING, visibility: C, texture: { sampleType: 'float', viewDimension: '3d' } },
    { binding: MARCH_LIGHT_GRID_BINDING + 1, visibility: C, sampler: { type: 'filtering' } },
    { binding: MARCH_SKY_LIGHT_BINDING, visibility: C, buffer: { type: 'read-only-storage' } },
  ] });
  const atmosphereLayout = options.atmosphereLayout ?? createAtmosphereBindGroupLayout(device);
  const skyLightLayout = device.createBindGroupLayout({ label: 'cloud sky light', entries: [
    { binding: SKY_LIGHT_BINDING, visibility: C, buffer: { type: 'storage' } },
  ] });
  const compositeLayout = device.createBindGroupLayout({ label: 'cloud composite', entries: [
    { binding: 0, visibility: C, buffer: { type: 'uniform' } },
    { binding: 1, visibility: C, texture: { sampleType: 'depth' } },
    { binding: 2, visibility: C, texture: { sampleType: 'unfilterable-float' } },
    { binding: 3, visibility: C, texture: { sampleType: 'unfilterable-float' } },
    { binding: 4, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
  ] });
  const pipeline = (label: string, code: string, group1: GPUBindGroupLayout, group2?: GPUBindGroupLayout) => device.createComputePipeline({
    label,
    layout: device.createPipelineLayout({ bindGroupLayouts: group2 ? [volumeLayout, group1, group2] : [volumeLayout, group1] }),
    compute: { module: device.createShaderModule({ label, code }), entryPoint: 'main' },
  });
  const marchPipeline = pipeline('cloud march', COMMON_WGSL + volumeWgsl(0) + DENSITY_WGSL + MARCH_WGSL, marchLayout, atmosphereLayout);
  const skyLightPipeline = pipeline('cloud sky light', COMMON_WGSL + volumeWgsl(0) + SKY_LIGHT_WGSL, skyLightLayout, atmosphereLayout);
  const compositePipeline = pipeline('cloud composite', COMMON_WGSL + volumeWgsl(0) + COMPOSITE_WGSL, compositeLayout);

  const samplers = createVolumeSamplers(device);
  const volumeUniforms = device.createBuffer({ label: 'cloud volume uniforms', size: VOLUME_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const frameUniforms = device.createBuffer({ label: 'cloud frame uniforms', size: FRAME_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const frameF32: Float32Array<ArrayBuffer> = new Float32Array(new ArrayBuffer(FRAME_UNIFORM_BYTES));
  const frameU32 = new Uint32Array(frameF32.buffer);

  const skyLightBuffer = device.createBuffer({ label: 'cloud sky light', size: 48, usage: GPUBufferUsage.STORAGE });
  const skyLightGroup = device.createBindGroup({ label: 'cloud sky light', layout: skyLightLayout, entries: [{ binding: SKY_LIGHT_BINDING, resource: { buffer: skyLightBuffer } }] });
  let lightGrid: LightGrid | null = null;
  let disposed = false;
  let volume: GpuCloudVolume | null = null;
  let noise: GPUTexture | null = null;
  let volumeGroup: GPUBindGroup | null = null;
  let outW = 0, outH = 0;
  let renderW = 0, renderH = 0;
  let output: GPUTexture | null = null, ownsOutput = false;
  let marchColor: GPUTexture | null = null, marchDepth: GPUTexture | null = null;
  let marchGroups: [GPUBindGroup, GPUBindGroup] | null = null, compositeGroup: GPUBindGroup | null = null;
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
    marchColor = marchDepth = output = null; marchGroups = null; compositeGroup = null; boundDepth = null;
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
    get ready() { return !disposed && !!volumeGroup && !!output && !!marchColor && !!lightGrid; },
    get extent() { return volume ? volume.extentMeters : null; },
    async setVolume(asset, opts) {
      if (disposed) return;
      volume?.destroy(); lightGrid?.destroy();
      volume = uploadCloudVolume(device, asset);
      lightGrid = createLightGrid(device, volumeLayout, { dims: asset.dims, voxelSize: asset.voxelSizeMeters, extentMeters: volume.extentMeters });
      marchGroups = null; boundDepth = null;
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
      if (disposed || !volumeGroup || !output || !marchColor || !marchDepth || !lightGrid) return;
      if (frame.depth !== boundDepth || !marchGroups || !compositeGroup) {
        boundDepth = frame.depth;
        const grid = lightGrid;
        marchGroups = [0, 1].map(i => device.createBindGroup({ label: `cloud march ${i}`, layout: marchLayout, entries: [
          { binding: 0, resource: { buffer: frameUniforms } },
          { binding: 1, resource: frame.depth },
          { binding: 2, resource: marchColor!.createView() },
          { binding: 3, resource: marchDepth!.createView() },
          ...grid.bindGroupEntries(MARCH_LIGHT_GRID_BINDING, i as 0 | 1),
          { binding: MARCH_SKY_LIGHT_BINDING, resource: { buffer: skyLightBuffer } },
        ] })) as [GPUBindGroup, GPUBindGroup];
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
      // Wind integrates velocity * animSpeed, so changing animSpeed changes the rate and never teleports the noise.
      for (let i = 0; i < 3; i++) settings.windOffset[i] += settings.windVelocity[i] * settings.animSpeed * dt;

      const f = frameF32;
      f.set(frame.inverseViewProjection, 0);
      f[16] = frame.cameraPosition[0]; f[17] = frame.cameraPosition[1]; f[18] = frame.cameraPosition[2]; f[19] = frame.time;
      f[20] = frame.sunDirection[0]; f[21] = frame.sunDirection[1]; f[22] = frame.sunDirection[2]; f[23] = settings.densityScale;
      f[24] = settings.windOffset[0]; f[25] = settings.windOffset[1]; f[26] = settings.windOffset[2]; f[27] = settings.mipDistanceScale;
      f[28] = renderW; f[29] = renderH; f[30] = outW; f[31] = outH;
      f[32] = settings.baseMip; frameU32[33] = settings.maxSteps >>> 0; frameU32[34] = frame.frameIndex >>> 0; f[35] = settings.lightDensityScale;
      f[36] = settings.msStrength; f[37] = settings.ambientStrength; f[38] = settings.silverStrength; f[39] = settings.ambientExtinction;
      f[40] = settings.phaseG; f[41] = settings.silverG; f[42] = 0; f[43] = 0;
      device.queue.writeBuffer(frameUniforms, 0, f);

      // The grid holds extinction-scaled optical depth; it re-slices over 8 frames when the sun or the scale moves.
      const gridStep = lightGrid.encode(encoder, volumeGroup, { sunDirection: [frame.sunDirection[0], frame.sunDirection[1], frame.sunDirection[2]], densityScale: settings.densityScale, frameIndex: frame.frameIndex }, timer);

      const sky = encoder.beginComputePass({ label: 'cloud sky light' });
      sky.setPipeline(skyLightPipeline);
      sky.setBindGroup(0, volumeGroup);
      sky.setBindGroup(1, skyLightGroup);
      sky.setBindGroup(MARCH_ATMOSPHERE_GROUP, frame.atmosphere);
      sky.dispatchWorkgroups(1);
      sky.end();

      const march = encoder.beginComputePass({ label: 'cloud march', timestampWrites: timer?.passTimestampWrites('march') });
      march.setPipeline(marchPipeline);
      march.setBindGroup(0, volumeGroup);
      march.setBindGroup(1, marchGroups[gridStep.front]);
      march.setBindGroup(MARCH_ATMOSPHERE_GROUP, frame.atmosphere);
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
      if (disposed) return;
      disposed = true;
      releaseTargets(); volume?.destroy(); noise?.destroy(); lightGrid?.destroy();
      volumeGroup = null; marchGroups = null; compositeGroup = null; lightGrid = null;
      volumeUniforms.destroy(); frameUniforms.destroy(); skyLightBuffer.destroy();
    },
  };
}
