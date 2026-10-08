import type { CloudNoiseAsset, CloudVolumeAsset } from './assets';
import type { GpuTimer } from './gpu-timer';
import { createLightGrid, type LightGrid } from './light-grid';
import { createAtmosphereBindGroupLayout } from './shaders/atmosphere.wgsl';
import { uploadCloudNoise, uploadCloudVolume, type GpuCloudVolume } from './resources';
import { COMMON_WGSL } from './shaders/common.wgsl';
import { COMPOSITE_LIGHT_GRID_BINDING, COMPOSITE_WGSL } from './shaders/composite.wgsl';
import { DENSITY_WGSL } from './shaders/density.wgsl';
import { FRAME_UNIFORM_BYTES } from './shaders/frame.wgsl';
import { MARCH_ATMOSPHERE_GROUP, MARCH_LIGHT_GRID_BINDING, MARCH_NEAR_BINDING, MARCH_SKY_LIGHT_BINDING, MARCH_WGSL, SKY_LIGHT_BINDING, SKY_LIGHT_WGSL } from './shaders/march.wgsl';
import { createVolumeBindGroup, createVolumeBindGroupLayout, createVolumeSamplers, volumeUniformData, volumeWgsl, VOLUME_UNIFORM_BYTES } from './shaders/volume.wgsl';

export type CloudQuality = 'high' | 'medium' | 'low';
/**
 * Quality presets (Nubis near/far split, s157-160): the march runs twice. Near covers [0, splitDistance) at nearScale of the
 * output resolution (linear), far covers the rest at farScale. maxSteps and the transmittance cutoff are per pass.
 */
export interface CloudQualityPreset {
  nearScale: number;
  farScale: number;
  splitDistance: number;
  maxSteps: number;
  /** Rays stop once transmittance falls below this. */
  transmittanceCutoff: number;
}
export const CLOUD_QUALITY_PRESETS: Record<CloudQuality, CloudQualityPreset> = {
  high: { nearScale: 0.33, farScale: 0.5, splitDistance: 200, maxSteps: 768, transmittanceCutoff: 0.01 },
  medium: { nearScale: 0.25, farScale: 0.4, splitDistance: 200, maxSteps: 512, transmittanceCutoff: 0.02 },
  low: { nearScale: 0.2, farScale: 0.3, splitDistance: 160, maxSteps: 320, transmittanceCutoff: 0.03 },
};

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
  /** 0..1: front-lit (sun behind the viewer) darkening of low in-scatter-probability regions (the edges): the direct light is modulated by the profile. 0 = off. */
  edgeDarkening: number;
  /** Extra inner glow when looking toward the sun: multiplies the multiple-scattering term by 1 + glowBoost * sunRelax. 0 = off. */
  glowBoost: number;
  /** 0..1: floor of the sky-above weight in the ambient blend (cloud base uses ambientSkyBias of the sky, the rest ground light). Nubis reference: 0.3. */
  ambientSkyBias: number;
  /** 0..1: how much of the sun-facing inner-glow relaxation also applies when the sun is behind the viewer (bright interior bulges). 0 = Nubis. */
  glowFront: number;
  /** 0..1: bias of the detail type toward wispy at low height fraction. 0 = unchanged Nubis density. */
  wispyBias: number;
  /** Noise scroll position in metres (integrated from windVelocity). */
  windOffset: [number, number, number];
  windVelocity: [number, number, number];
  animSpeed: number;
  mipDistanceScale: number;
  baseMip: number;
  maxSteps: number;
  /** Rays stop once transmittance falls below this (the quality presets set it). */
  transmittanceCutoff: number;
  /** Near/far boundary along the ray, metres. */
  splitDistance: number;
  /** 0..1: how dark the full cloud shadow makes opaque scene pixels (folded into the composite alpha). 0 disables. */
  shadowStrength: number;
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
  /** Far-pass (half-res) size; `nearRenderSize` is the near pass. */
  readonly renderSize: [number, number];
  readonly nearRenderSize: [number, number];
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

function createLightGridLayoutEntries(binding: number): GPUBindGroupLayoutEntry[] {
  return [
    { binding, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '3d' } },
    { binding: binding + 1, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
  ];
}

export function createCloudRuntime(device: GPUDevice, options: CloudRuntimeOptions = {}): CloudRuntime {
  let quality: CloudQuality = options.quality ?? 'high';
  const settings: CloudSettings = {
    densityScale: 0.2, lightDensityScale: 1.5, msStrength: 1.4, ambientStrength: 1, // P1-09 art defaults (Nubis neutral: 1, 1)
    silverStrength: 0.4, phaseG: 0.2, silverG: 0.85, ambientExtinction: 0.08, // 0.3 left bases charcoal; tuned by orchestrator sweep (P1-09)
    edgeDarkening: 0.5, glowBoost: 12, ambientSkyBias: 0.9, wispyBias: 1, glowFront: 1,
    windOffset: [0, 0, 0], windVelocity: [3, 0, 1.5], animSpeed: 1,
    mipDistanceScale: 0.01, baseMip: 0, maxSteps: CLOUD_QUALITY_PRESETS[quality].maxSteps,
    transmittanceCutoff: CLOUD_QUALITY_PRESETS[quality].transmittanceCutoff, splitDistance: CLOUD_QUALITY_PRESETS[quality].splitDistance,
    shadowStrength: 0.6, // shadowed ground keeps sky ambient; 0.85+ reads near-black (orchestrator review)
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
    { binding: MARCH_NEAR_BINDING, visibility: C, texture: { sampleType: 'unfilterable-float' } },
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
    { binding: 5, visibility: C, texture: { sampleType: 'unfilterable-float' } },
    { binding: 6, visibility: C, texture: { sampleType: 'unfilterable-float' } },
    ...createLightGridLayoutEntries(COMPOSITE_LIGHT_GRID_BINDING),
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
  // One frame uniform per march pass (render size and pass mode differ); the composite reads the near one.
  const frameUniforms = [0, 1].map(i => device.createBuffer({ label: `cloud frame uniforms ${i ? 'far' : 'near'}`, size: FRAME_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
  const dummyNear = device.createTexture({ label: 'cloud dummy near', size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING });
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
  let nearW = 0, nearH = 0, farW = 0, farH = 0;
  let output: GPUTexture | null = null, ownsOutput = false;
  let targets: { color: GPUTexture; depth: GPUTexture }[] | null = null;   // [near, far]
  let marchGroups: GPUBindGroup[] | null = null, compositeGroups: GPUBindGroup[] | null = null;
  let boundDepth: GPUTextureView | null = null;
  let lastTime = -1;

  const rebuildVolumeGroup = () => {
    volumeGroup = volume && noise
      ? createVolumeBindGroup(device, volumeLayout, { uniforms: volumeUniforms, nvdf: volume.nvdf, sdf: volume.sdf, noise, ...samplers })
      : null;
  };
  const releaseTargets = () => {
    for (const t of targets ?? []) { t.color.destroy(); t.depth.destroy(); }
    if (ownsOutput) output?.destroy();
    targets = null; output = null; marchGroups = null; compositeGroups = null; boundDepth = null;
  };
  const allocate = (externalOutput?: GPUTexture) => {
    releaseTargets();
    if (!outW) return;
    const preset = CLOUD_QUALITY_PRESETS[quality];
    const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
    const make = (name: string, scale: number) => {
      const w = Math.max(1, Math.round(outW * scale)), h = Math.max(1, Math.round(outH * scale));
      return { w, h, color: device.createTexture({ label: `cloud ${name} colour`, size: [w, h], format: 'rgba16float', usage }), depth: device.createTexture({ label: `cloud ${name} depth`, size: [w, h], format: 'rg32float', usage }) };
    };
    const near = make('near', preset.nearScale), far = make('far', preset.farScale);
    nearW = near.w; nearH = near.h; farW = far.w; farH = far.h;
    targets = [near, far];
    ownsOutput = !externalOutput;
    output = externalOutput ?? device.createTexture({ label: 'cloud composite', size: [outW, outH], format: 'rgba16float', usage });
  };
  let externalOutput: GPUTexture | undefined;

  return {
    settings,
    get output() { return output; },
    get renderSize(): [number, number] { return [farW, farH]; },
    get nearRenderSize(): [number, number] { return [nearW, nearH]; },
    get ready() { return !disposed && !!volumeGroup && !!output && !!targets && !!lightGrid; },
    get extent() { return volume ? volume.extentMeters : null; },
    async setVolume(asset, opts) {
      if (disposed) return;
      volume?.destroy(); lightGrid?.destroy();
      volume = uploadCloudVolume(device, asset);
      lightGrid = createLightGrid(device, volumeLayout, { dims: asset.dims, voxelSize: asset.voxelSizeMeters, extentMeters: volume.extentMeters });
      marchGroups = null; compositeGroups = null; boundDepth = null;
      device.queue.writeBuffer(volumeUniforms, 0, new Float32Array(volumeUniformData(opts.position, volume.extentMeters, volume.voxelSize)));
      rebuildVolumeGroup();
    },
    async setNoise(asset) {
      noise?.destroy();
      noise = uploadCloudNoise(device, asset);
      rebuildVolumeGroup();
    },
    setQuality(q) {
      if (q === quality) return;
      quality = q;
      const p = CLOUD_QUALITY_PRESETS[q];
      settings.maxSteps = p.maxSteps; settings.transmittanceCutoff = p.transmittanceCutoff; settings.splitDistance = p.splitDistance;
      if (outW) allocate(externalOutput);
    },
    resize(width, height, out) {
      if (width === outW && height === outH && out === externalOutput && output) return;
      outW = width; outH = height; externalOutput = out;
      allocate(out);
    },
    encode(encoder, frame, timer) {
      if (disposed || !volumeGroup || !output || !targets || !lightGrid) return;
      if (frame.depth !== boundDepth || !marchGroups || !compositeGroups) {
        boundDepth = frame.depth;
        const grid = lightGrid;
        const [near, far] = targets;
        // march groups: index = pass * 2 + light-grid slot
        marchGroups = [0, 1, 2, 3].map(i => {
          const pass = i >> 1, slot = (i & 1) as 0 | 1;
          return device.createBindGroup({ label: `cloud march ${pass ? 'far' : 'near'} ${slot}`, layout: marchLayout, entries: [
            { binding: 0, resource: { buffer: frameUniforms[pass] } },
            { binding: 1, resource: frame.depth },
            { binding: 2, resource: targets![pass].color.createView() },
            { binding: 3, resource: targets![pass].depth.createView() },
            ...grid.bindGroupEntries(MARCH_LIGHT_GRID_BINDING, slot),
            { binding: MARCH_SKY_LIGHT_BINDING, resource: { buffer: skyLightBuffer } },
            { binding: MARCH_NEAR_BINDING, resource: pass ? near.color.createView() : dummyNear.createView() },
          ] });
        });
        compositeGroups = [0, 1].map(slot => device.createBindGroup({ label: `cloud composite ${slot}`, layout: compositeLayout, entries: [
          { binding: 0, resource: { buffer: frameUniforms[0] } },
          { binding: 1, resource: frame.depth },
          { binding: 2, resource: near.color.createView() },
          { binding: 3, resource: near.depth.createView() },
          { binding: 4, resource: output!.createView() },
          { binding: 5, resource: far.color.createView() },
          { binding: 6, resource: far.depth.createView() },
          ...grid.bindGroupEntries(COMPOSITE_LIGHT_GRID_BINDING, slot as 0 | 1),
        ] }));
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
      f[30] = outW; f[31] = outH;
      f[32] = settings.baseMip; frameU32[33] = settings.maxSteps >>> 0; frameU32[34] = frame.frameIndex >>> 0; f[35] = settings.lightDensityScale;
      f[36] = settings.msStrength; f[37] = settings.ambientStrength; f[38] = settings.silverStrength; f[39] = settings.ambientExtinction;
      f[40] = settings.phaseG; f[41] = settings.silverG; f[42] = settings.shadowStrength; f[43] = 0;
      f[44] = settings.splitDistance; f[45] = settings.transmittanceCutoff;
      f[48] = settings.edgeDarkening; f[49] = settings.glowBoost; f[50] = settings.ambientSkyBias; f[51] = settings.wispyBias;
      f[52] = settings.glowFront;
      for (let pass = 0; pass < 2; pass++) {
        f[28] = pass ? farW : nearW; f[29] = pass ? farH : nearH; frameU32[46] = pass;
        device.queue.writeBuffer(frameUniforms[pass], 0, f);
      }

      // The grid holds extinction-scaled optical depth; it re-slices over 8 frames when the sun or the scale moves.
      const gridStep = lightGrid.encode(encoder, volumeGroup, { sunDirection: [frame.sunDirection[0], frame.sunDirection[1], frame.sunDirection[2]], densityScale: settings.densityScale, frameIndex: frame.frameIndex }, timer);

      const sky = encoder.beginComputePass({ label: 'cloud sky light' });
      sky.setPipeline(skyLightPipeline);
      sky.setBindGroup(0, volumeGroup);
      sky.setBindGroup(1, skyLightGroup);
      sky.setBindGroup(MARCH_ATMOSPHERE_GROUP, frame.atmosphere);
      sky.dispatchWorkgroups(1);
      sky.end();

      for (let pass = 0; pass < 2; pass++) {
        const march = encoder.beginComputePass({ label: pass ? 'cloud march far' : 'cloud march near', timestampWrites: timer?.passTimestampWrites(pass ? 'marchFar' : 'marchNear') });
        march.setPipeline(marchPipeline);
        march.setBindGroup(0, volumeGroup);
        march.setBindGroup(1, marchGroups[pass * 2 + gridStep.front]);
        march.setBindGroup(MARCH_ATMOSPHERE_GROUP, frame.atmosphere);
        march.dispatchWorkgroups(Math.ceil((pass ? farW : nearW) / 8), Math.ceil((pass ? farH : nearH) / 8));
        march.end();
      }

      const composite = encoder.beginComputePass({ label: 'cloud composite', timestampWrites: timer?.passTimestampWrites('composite') });
      composite.setPipeline(compositePipeline);
      composite.setBindGroup(0, volumeGroup);
      composite.setBindGroup(1, compositeGroups![gridStep.front]);
      composite.dispatchWorkgroups(Math.ceil(outW / 8), Math.ceil(outH / 8));
      composite.end();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseTargets(); volume?.destroy(); noise?.destroy(); lightGrid?.destroy();
      volumeGroup = null; marchGroups = null; compositeGroups = null; lightGrid = null;
      volumeUniforms.destroy(); frameUniforms.forEach(b => b.destroy()); dummyNear.destroy(); skyLightBuffer.destroy();
    },
  };
}
