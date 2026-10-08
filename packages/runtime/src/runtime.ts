import type { CloudNoiseAsset, CloudVolumeAsset } from './assets';
import type { GpuTimer } from './gpu-timer';
import { createLightGrid, type LightGrid } from './light-grid';
import { createAtmosphereBindGroupLayout } from './shaders/atmosphere.wgsl';
import { defaultDomeSettings, type CloudDome } from './dome';
import { DOME_DEPTH_BINDING, DOME_FRAME_BINDING, DOME_LIGHT_GRID_BINDING, DOME_OUT_BINDING, DOME_PARAMS_BINDING, DOME_PARAM_BYTES, DOME_REFRESH_FRAMES, DOME_SKY_LIGHT_BINDING, DOME_WGSL } from './shaders/dome.wgsl';
import { uploadCloudNoise, uploadCloudVolume, type GpuCloudVolume } from './resources';
import { COMMON_WGSL } from './shaders/common.wgsl';
import { COMPOSITE_LIGHT_GRID_BINDING, COMPOSITE_SKY_BINDING, COMPOSITE_WGSL } from './shaders/composite.wgsl';
import { DENSITY_WGSL } from './shaders/density.wgsl';
import { FRAME_UNIFORM_BYTES } from './shaders/frame.wgsl';
import { MARCH_ATMOSPHERE_GROUP, MARCH_LIGHT_GRID_BINDING, MARCH_NEAR_BINDING, MARCH_SKY_LIGHT_BINDING, marchWgsl, SKY_LIGHT_BINDING, SKY_LIGHT_WGSL } from './shaders/march.wgsl';
import { createSkyLayer, type SkyLayer } from './sky-layer';
import { createVolumeBindGroup, createVolumeBindGroupLayout, createVolumeSamplers, volumeUniformData, volumeWgsl, VOLUME_UNIFORM_BYTES } from './shaders/volume.wgsl';

export type CloudQuality = 'ultra' | 'high' | 'medium' | 'low';
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
  ultra: { nearScale: 0.5, farScale: 0.75, splitDistance: 240, maxSteps: 1024, transmittanceCutoff: 0.005 },
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
  /** P3-F: strength of the deep multiple-scattering octaves (Wrenninge/Hillaire): thick cores keep a blue-grey floor. 0 = off. */
  deepScatter: number;
  /** P3-F: extinction falloff a per octave (exp(-a^n tau)); larger = the floor dies sooner with depth. */
  deepAttenuation: number;
  /** P3-F: 0..1 share of the sky ambient that survives any depth of cloud (soft-saturating exp(-tauUp) and profile occlusion). 0 = old behaviour. */
  ambientFloor: number;
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

export interface CloudUniformLighting {
  kind: 'uniform';
  /** Sun illuminance (RGB). */
  sunRadiance: ArrayLike<number>;
  /** Mean sky radiance from above and from below (RGB). */
  ambientTop: ArrayLike<number>;
  ambientBottom: ArrayLike<number>;
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
  /** Bind group for atmosphereWgsl(2) (sky LUTs + uniform), e.g. the sky bridge's. Sun radiance, ambient and aerial perspective come from it. Required unless `lighting` is given. */
  atmosphere?: GPUBindGroup;
  /** Uniform lighting for users without a sky library: no aerial perspective, `atmosphere` is ignored. Radiances in the same exposure units as the scene lights. */
  lighting?: CloudUniformLighting;
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
  /**
   * A CloudVolumeAsset is uploaded (and owned) by the runtime. A GpuCloudVolume (e.g. from the generator) is used as is and is
   * never destroyed by the runtime.
   */
  setVolume(asset: CloudVolumeAsset | GpuCloudVolume, options: { position: [number, number, number] }): Promise<void>;
  setNoise(asset: CloudNoiseAsset): Promise<void>;
  setQuality(quality: CloudQuality): void;
  /** `output` may be supplied by the caller (rgba16float, STORAGE_BINDING | TEXTURE_BINDING, exactly width x height). */
  resize(width: number, height: number, output?: GPUTexture): void;
  /** World-space extent of the volume once set, metres (x, y-up, z). */
  readonly extent: [number, number, number] | null;
  /** Reflection dome (P2-04): octahedral radiance + transmittance seen from the reference point, refreshed 1/16 per frame. */
  readonly dome: CloudDome;
  /** Distant sky layer (P3-C1, Nubis vertical-profile 2.5D): cloud cover from the voxel region to the horizon. Off by default; see `skyLayer.configure`. */
  readonly skyLayer: SkyLayer;
  encode(encoder: GPUCommandEncoder, frame: CloudFrame, timer?: GpuTimer): void;
  dispose(): void;
}

export interface CloudRuntimeOptions {
  quality?: CloudQuality;
  /** Layout the atmosphere bind group was created with. Omit to use the runtime's own (group-equivalent) layout. */
  atmosphereLayout?: GPUBindGroupLayout;
  /** Reflection dome texture size (square, multiple of 4). Default 256. */
  domeSize?: number;
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
    edgeDarkening: 0.5, glowBoost: 12, ambientSkyBias: 0.9, wispyBias: 1, glowFront: 1, deepScatter: 1.2, deepAttenuation: 0.35, ambientFloor: 0.15,
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
    { binding: COMPOSITE_SKY_BINDING, visibility: C, texture: { sampleType: 'unfilterable-float' } },
    { binding: COMPOSITE_SKY_BINDING + 1, visibility: C, texture: { sampleType: 'unfilterable-float' } },
    { binding: COMPOSITE_SKY_BINDING + 2, visibility: C, texture: { sampleType: 'unfilterable-float' } },
  ] });
  const pipeline = (label: string, code: string, group1: GPUBindGroupLayout, group2?: GPUBindGroupLayout) => device.createComputePipeline({
    label,
    layout: device.createPipelineLayout({ bindGroupLayouts: group2 ? [volumeLayout, group1, group2] : [volumeLayout, group1] }),
    compute: { module: device.createShaderModule({ label, code }), entryPoint: 'main' },
  });
  const marchPipeline = pipeline('cloud march', COMMON_WGSL + volumeWgsl(0) + DENSITY_WGSL + marchWgsl('atmosphere'), marchLayout, atmosphereLayout);
  // Uniform-lighting variants (no atmosphere group) are built on first use.
  let marchUniformPipeline: GPUComputePipeline | null = null;
  const getMarchUniformPipeline = () => marchUniformPipeline ??= pipeline('cloud march uniform', COMMON_WGSL + volumeWgsl(0) + DENSITY_WGSL + marchWgsl('uniform'), marchLayout);
  const skyLightPipeline = pipeline('cloud sky light', COMMON_WGSL + volumeWgsl(0) + SKY_LIGHT_WGSL, skyLightLayout, atmosphereLayout);
  const compositePipeline = pipeline('cloud composite', COMMON_WGSL + volumeWgsl(0) + COMPOSITE_WGSL, compositeLayout);

  const skyLayer = createSkyLayer(device, volumeLayout, atmosphereLayout);
  const skyBox = { minCorner: [0, 0, 0], extent: [1, 1, 1] };
  const samplers = createVolumeSamplers(device);
  const volumeUniforms = device.createBuffer({ label: 'cloud volume uniforms', size: VOLUME_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  // One frame uniform per march pass (render size and pass mode differ); the composite reads the near one.
  const frameUniforms = [0, 1, 2].map(i => device.createBuffer({ label: `cloud frame uniforms ${['near', 'far', 'sky'][i]}`, size: FRAME_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
  const dummyNear = device.createTexture({ label: 'cloud dummy near', size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING });
  const frameF32: Float32Array<ArrayBuffer> = new Float32Array(new ArrayBuffer(FRAME_UNIFORM_BYTES));
  const frameU32 = new Uint32Array(frameF32.buffer);

  const skyLightBuffer = device.createBuffer({ label: 'cloud sky light', size: 48, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const skyLightGroup = device.createBindGroup({ label: 'cloud sky light', layout: skyLightLayout, entries: [{ binding: SKY_LIGHT_BINDING, resource: { buffer: skyLightBuffer } }] });
  // ---- reflection dome (P2-04) ----
  const domeSize = Math.max(4, (options.domeSize ?? 256) & ~3);
  const domeSettings = defaultDomeSettings();
  const domeLayout = device.createBindGroupLayout({ label: 'cloud dome', entries: [
    { binding: DOME_FRAME_BINDING, visibility: C, buffer: { type: 'uniform' } },
    { binding: DOME_DEPTH_BINDING, visibility: C, texture: { sampleType: 'depth' } },
    { binding: DOME_OUT_BINDING, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
    { binding: DOME_PARAMS_BINDING, visibility: C, buffer: { type: 'uniform' } },
    ...createLightGridLayoutEntries(DOME_LIGHT_GRID_BINDING),
    { binding: DOME_SKY_LIGHT_BINDING, visibility: C, buffer: { type: 'read-only-storage' } },
  ] });
  const domePipeline = pipeline('cloud dome', COMMON_WGSL + volumeWgsl(0) + DOME_WGSL, domeLayout);
  const domeTexture = device.createTexture({ label: 'cloud reflection dome', size: [domeSize, domeSize], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });
  const domeView = domeTexture.createView();
  {
    // Until a texel is first shaded it reads as clear sky: no radiance, transmittance 1 (half-float 1.0 = 0x3C00).
    const init = new Uint16Array(domeSize * domeSize * 4);
    for (let i = 3; i < init.length; i += 4) init[i] = 0x3c00;
    device.queue.writeTexture({ texture: domeTexture }, init, { bytesPerRow: domeSize * 8 }, [domeSize, domeSize]);
  }
  const domeFrameBuffer = device.createBuffer({ label: 'cloud dome frame', size: FRAME_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const domeParamBuffer = device.createBuffer({ label: 'cloud dome params', size: DOME_PARAM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const domeDepth = device.createTexture({ label: 'cloud dome dummy depth', size: [1, 1], format: 'depth32float', usage: GPUTextureUsage.TEXTURE_BINDING });
  const domeParamData = new ArrayBuffer(DOME_PARAM_BYTES);
  const domeParamF32 = new Float32Array(domeParamData), domeParamU32 = new Uint32Array(domeParamData);
  const domeRef: [number, number, number] = [0, 0, 0];
  let domeGroups: GPUBindGroup[] | null = null;
  let domeSlot = 0, domeRefreshFrames = DOME_REFRESH_FRAMES, domeBoost = 0;
  const domeSun = [0, 1, 0];
  let domeScaleSeen = -1;
  const dome: CloudDome = {
    texture: domeTexture, view: domeView, size: domeSize, settings: domeSettings,
    get referencePoint() { return domeRef; },
    get refreshFrames() { return domeRefreshFrames; },
  };
  let lightGrid: LightGrid | null = null;
  const lightingData = new Float32Array(12);
  let disposed = false;
  let volume: GpuCloudVolume | null = null;
  let ownsVolume = false;
  let noise: GPUTexture | null = null;
  let volumeGroup: GPUBindGroup | null = null;
  let outW = 0, outH = 0;
  let nearW = 0, nearH = 0, farW = 0, farH = 0;
  let output: GPUTexture | null = null, ownsOutput = false;
  let targets: { color: GPUTexture; depth: GPUTexture }[] | null = null;   // [near, far]
  let skyTarget: { w: number; h: number; color: GPUTexture; depth: GPUTexture; back: GPUTexture; scale: number } | null = null;
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
    skyTarget?.color.destroy(); skyTarget?.depth.destroy(); skyTarget?.back.destroy(); skyTarget = null;
    if (ownsOutput) output?.destroy();
    targets = null; output = null; marchGroups = null; compositeGroups = null; boundDepth = null;
  };
  const allocate = (externalOutput?: GPUTexture) => {
    releaseTargets();
    if (!outW) return;
    const preset = CLOUD_QUALITY_PRESETS[quality];
    const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;   // COPY_DST: the sky layer resolves into its targets by copy
    const make = (name: string, scale: number) => {
      const w = Math.max(1, Math.round(outW * scale)), h = Math.max(1, Math.round(outH * scale));
      return { w, h, color: device.createTexture({ label: `cloud ${name} colour`, size: [w, h], format: 'rgba16float', usage }), depth: device.createTexture({ label: `cloud ${name} depth`, size: [w, h], format: 'rg32float', usage }) };
    };
    const near = make('near', preset.nearScale), far = make('far', preset.farScale);
    nearW = near.w; nearH = near.h; farW = far.w; farH = far.h;
    targets = [near, far];
    const sky = make('sky', skyLayer.settings.resolutionScale);
    skyTarget = { w: sky.w, h: sky.h, color: sky.color, depth: sky.depth, back: device.createTexture({ label: 'cloud sky back', size: [sky.w, sky.h], format: 'rgba16float', usage }), scale: skyLayer.settings.resolutionScale };
    ownsOutput = !externalOutput;
    output = externalOutput ?? device.createTexture({ label: 'cloud composite', size: [outW, outH], format: 'rgba16float', usage });
  };
  let externalOutput: GPUTexture | undefined;

  return {
    settings,
    dome,
    get output() { return output; },
    get renderSize(): [number, number] { return [farW, farH]; },
    get nearRenderSize(): [number, number] { return [nearW, nearH]; },
    get skyLayer() { return skyLayer; },
    get ready() { return !disposed && !!volumeGroup && !!output && !!targets && !!lightGrid; },
    get extent() { return volume ? volume.extentMeters : null; },
    async setVolume(asset, opts) {
      if (disposed) return;
      if (ownsVolume) volume?.destroy();
      lightGrid?.destroy();
      const external = 'extentMeters' in asset;   // a GpuCloudVolume: caller-owned
      volume = external ? asset : uploadCloudVolume(device, asset);
      ownsVolume = !external;
      lightGrid = createLightGrid(device, volumeLayout, { dims: volume.dims, voxelSize: volume.voxelSize, extentMeters: volume.extentMeters });
      marchGroups = null; compositeGroups = null; boundDepth = null; domeGroups = null;
      device.queue.writeBuffer(volumeUniforms, 0, new Float32Array(volumeUniformData(opts.position, volume.extentMeters, volume.voxelSize)));
      for (let i = 0; i < 3; i++) { skyBox.minCorner[i] = opts.position[i]; skyBox.extent[i] = volume.extentMeters[i]; }
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
      const uniformLighting = frame.lighting?.kind === 'uniform' ? frame.lighting : null;
      if (!uniformLighting && !frame.atmosphere) return;
      if (skyTarget && skyTarget.scale !== skyLayer.settings.resolutionScale) {
        // Only the sky targets change; the composite groups reference them.
        skyTarget.color.destroy(); skyTarget.depth.destroy(); skyTarget.back.destroy();
        const w = Math.max(1, Math.round(outW * skyLayer.settings.resolutionScale)), h = Math.max(1, Math.round(outH * skyLayer.settings.resolutionScale));
        const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;
        skyTarget = { w, h, scale: skyLayer.settings.resolutionScale, color: device.createTexture({ label: 'cloud sky colour', size: [w, h], format: 'rgba16float', usage }), depth: device.createTexture({ label: 'cloud sky depth', size: [w, h], format: 'rg32float', usage }), back: device.createTexture({ label: 'cloud sky back', size: [w, h], format: 'rgba16float', usage }) };
        compositeGroups = null;
      }
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
          { binding: COMPOSITE_SKY_BINDING, resource: skyTarget!.color.createView() },
          { binding: COMPOSITE_SKY_BINDING + 1, resource: skyTarget!.depth.createView() },
          { binding: COMPOSITE_SKY_BINDING + 2, resource: skyTarget!.back.createView() },
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
      f[40] = settings.phaseG; f[41] = settings.silverG; f[42] = settings.shadowStrength; f[43] = settings.deepScatter;
      f[44] = settings.splitDistance; f[45] = settings.transmittanceCutoff;
      f[48] = settings.edgeDarkening; f[49] = settings.glowBoost; f[50] = settings.ambientSkyBias; f[51] = settings.wispyBias;
      f[52] = settings.glowFront; f[54] = settings.deepAttenuation; f[55] = settings.ambientFloor;
      // The distant sky layer: bakes its weather window / compiles its pipeline on first use (async), then renders.
      const skyActive = skyLayer.settings.enabled && skyLayer.prepare(encoder, skyBox, !!uniformLighting);
      f[53] = skyActive ? 1 : 0;
      for (let pass = 0; pass < 2; pass++) {
        f[28] = pass ? farW : nearW; f[29] = pass ? farH : nearH; frameU32[46] = pass;
        device.queue.writeBuffer(frameUniforms[pass], 0, f);
      }
      if (skyActive) {
        f[28] = skyTarget!.w; f[29] = skyTarget!.h; frameU32[46] = 2;
        device.queue.writeBuffer(frameUniforms[2], 0, f);
      }

      // The grid holds extinction-scaled optical depth; it re-slices over 8 frames when the sun or the scale moves.
      const gridStep = lightGrid.encode(encoder, volumeGroup, { sunDirection: [frame.sunDirection[0], frame.sunDirection[1], frame.sunDirection[2]], densityScale: settings.densityScale, frameIndex: frame.frameIndex }, timer);

      if (uniformLighting) {
        for (let i = 0; i < 3; i++) {
          const c = [uniformLighting.sunRadiance, uniformLighting.ambientTop, uniformLighting.ambientBottom][i];
          lightingData[i * 4] = c[0]; lightingData[i * 4 + 1] = c[1]; lightingData[i * 4 + 2] = c[2];
        }
        device.queue.writeBuffer(skyLightBuffer, 0, lightingData);
      } else {
        const sky = encoder.beginComputePass({ label: 'cloud sky light' });
        sky.setPipeline(skyLightPipeline);
        sky.setBindGroup(0, volumeGroup);
        sky.setBindGroup(1, skyLightGroup);
        sky.setBindGroup(MARCH_ATMOSPHERE_GROUP, frame.atmosphere!);
        sky.dispatchWorkgroups(1);
        sky.end();
      }

      for (let pass = 0; pass < 2; pass++) {
        const march = encoder.beginComputePass({ label: pass ? 'cloud march far' : 'cloud march near', timestampWrites: timer?.passTimestampWrites(pass ? 'marchFar' : 'marchNear') });
        march.setPipeline(uniformLighting ? getMarchUniformPipeline() : marchPipeline);
        march.setBindGroup(0, volumeGroup);
        march.setBindGroup(1, marchGroups[pass * 2 + gridStep.front]);
        if (!uniformLighting) march.setBindGroup(MARCH_ATMOSPHERE_GROUP, frame.atmosphere!);
        march.dispatchWorkgroups(Math.ceil((pass ? farW : nearW) / 8), Math.ceil((pass ? farH : nearH) / 8));
        march.end();
      }

      if (skyActive) {
        skyLayer.encode(encoder, { volumeGroup, frameBuffer: frameUniforms[2], depth: frame.depth, color: skyTarget!.color, depthOut: skyTarget!.depth, back: skyTarget!.back, atmosphere: uniformLighting ? undefined : frame.atmosphere, skyLightBuffer, box: skyBox, inverseViewProjection: frame.inverseViewProjection, cameraPosition: frame.cameraPosition, sunDirection: frame.sunDirection, timer });
      }

      const composite = encoder.beginComputePass({ label: 'cloud composite', timestampWrites: timer?.passTimestampWrites('composite') });
      composite.setPipeline(compositePipeline);
      composite.setBindGroup(0, volumeGroup);
      composite.setBindGroup(1, compositeGroups![gridStep.front]);
      composite.dispatchWorkgroups(Math.ceil(outW / 8), Math.ceil(outH / 8));
      composite.end();

      if (domeSettings.enabled) {
        // Reference point: fixed, or the camera's x/z at ground height.
        const ref = domeSettings.referencePoint;
        domeRef[0] = ref ? ref[0] : frame.cameraPosition[0]; domeRef[1] = ref ? ref[1] : domeSettings.groundHeight; domeRef[2] = ref ? ref[2] : frame.cameraPosition[2];
        // A sun or density change makes the old texels stale until every slot has been redone.
        const sd = frame.sunDirection;
        if (domeSun[0] * sd[0] + domeSun[1] * sd[1] + domeSun[2] * sd[2] < 0.99999 || domeScaleSeen !== settings.densityScale * domeSettings.densityScale) {
          domeSun[0] = sd[0]; domeSun[1] = sd[1]; domeSun[2] = sd[2]; domeScaleSeen = settings.densityScale * domeSettings.densityScale;
          domeRefreshFrames = 0;
        }
        // The grid the dome lights from is replaced when a bake completes (8 frames after a sun change): shade two slots per
        // frame for the next 8 so the whole dome has seen the new grid 16 frames after the change.
        if (gridStep.swapped) { domeBoost = 8; domeRefreshFrames = 0; }
        const slots = domeBoost > 0 ? 2 : 1;
        if (domeBoost > 0) domeBoost--;
        const df = frameF32;   // the march uniform with the dome's own origin and cutoff
        df[16] = domeRef[0]; df[17] = domeRef[1]; df[18] = domeRef[2];
        df[45] = Math.max(settings.transmittanceCutoff, 0.02);
        device.queue.writeBuffer(domeFrameBuffer, 0, df);
        domeParamF32[0] = domeRef[0]; domeParamF32[1] = domeRef[1]; domeParamF32[2] = domeRef[2]; domeParamF32[3] = domeSettings.densityScale;
        domeParamU32[4] = domeSize; domeParamU32[5] = domeSlot; domeParamU32[6] = domeSettings.maxSteps >>> 0; domeParamU32[7] = slots;
        domeParamF32[8] = domeSettings.stepMin; domeParamF32[9] = domeSettings.stepRel; domeParamF32[10] = domeSettings.maxDistance; domeParamF32[11] = 0;
        device.queue.writeBuffer(domeParamBuffer, 0, domeParamData);
        domeSlot = (domeSlot + slots) % DOME_REFRESH_FRAMES;
        domeRefreshFrames = Math.min(DOME_REFRESH_FRAMES, domeRefreshFrames + slots);
        domeGroups ??= [0, 1].map(slot => device.createBindGroup({ label: `cloud dome ${slot}`, layout: domeLayout, entries: [
          { binding: DOME_FRAME_BINDING, resource: { buffer: domeFrameBuffer } },
          { binding: DOME_DEPTH_BINDING, resource: domeDepth.createView() },
          { binding: DOME_OUT_BINDING, resource: domeView },
          { binding: DOME_PARAMS_BINDING, resource: { buffer: domeParamBuffer } },
          ...lightGrid!.bindGroupEntries(DOME_LIGHT_GRID_BINDING, slot as 0 | 1),
          { binding: DOME_SKY_LIGHT_BINDING, resource: { buffer: skyLightBuffer } },
        ] }));
        const pass = encoder.beginComputePass({ label: 'cloud dome', timestampWrites: timer?.passTimestampWrites('dome') });
        pass.setPipeline(domePipeline);
        pass.setBindGroup(0, volumeGroup);
        pass.setBindGroup(1, domeGroups[gridStep.front]);
        const blocks = Math.ceil(domeSize / 4 / 8);
        pass.dispatchWorkgroups(blocks, blocks);
        pass.end();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseTargets(); if (ownsVolume) volume?.destroy(); noise?.destroy(); lightGrid?.destroy();
      volumeGroup = null; marchGroups = null; compositeGroups = null; lightGrid = null;
      volumeUniforms.destroy(); frameUniforms.forEach(b => b.destroy()); dummyNear.destroy(); skyLightBuffer.destroy();
      skyLayer.dispose(); domeTexture.destroy(); domeFrameBuffer.destroy(); domeParamBuffer.destroy(); domeDepth.destroy(); domeGroups = null;
    },
  };
}
