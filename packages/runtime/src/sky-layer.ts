// Distant sky layer (P3-C1, P3-C2): Nubis vertical-profile (2.5D) clouds from the voxel region out to the horizon. No three imports.
// See shaders/sky-layer.wgsl.ts for the method. This file owns the weather bake, the pipelines, the temporal history and the
// per-frame uniforms (including the reset logic of the 16-frame amortization).
// P9-B2: the weather window is baked in row tiles over frames (`bakeRows` per frame, then one frame for the max mips) while the previous
// window keeps rendering; the new window, with the shaping it was configured with, replaces it in one frame once it is complete, and the
// temporal history dissolves to it over one 16-frame cycle (no full-resolution reset trace).
import { createWeatherBake, type ProceduralWeatherOptions, type WeatherBake } from './generate/weather';
import { PROFILE_TABLE_FLOOR, packProfileTables, profileTopEnds } from './generate/profile-tables';
import type { ProceduralDensityModel } from './procedural/types';
import { NVDF_DEFAULTS, altoFractions, type NvdfParams } from './generate/volume-generator';
import type { GpuTimer } from './gpu-timer';
import { COMMON_WGSL } from './shaders/common.wgsl';
import { DENSITY_WGSL } from './shaders/density.wgsl';
import { MARCH_ATMOSPHERE_GROUP } from './shaders/march.wgsl';
import {
  SKY_BACK_BINDING, SKY_COLOR_BINDING, SKY_DEPTH_BINDING, SKY_LIGHT_STORAGE_BINDING, SKY_PARAMS_BINDING, SKY_PARAM_BYTES, SKY_PARAM_FLOATS, SKY_RESOLVE_BINDINGS,
  SKY_RESOLVE_WGSL, SKY_SAMPLER_BINDING, SKY_TEMPORAL_PERIOD, SKY_VOXEL_DEPTH_BINDING, SKY_WEATHER_BINDING, SKY_LUT_OFFSET, SKY_TABLE_TOP_OFFSET, skyLayerWgsl,
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
  /**
   * Rows of the weather window baked per frame after a weather change or box move (P9-B2). The previous window renders until the new one is
   * complete. Default 24: 86 frames for the default 2048^2 window, then one frame of max mips (about 0.07 ms). P9-C: the species weather (denser
   * cumulus cover, the species tables) made a 32-row tile 0.26 ms alone (worst 0.35) and up to 0.92 ms timed inside a full frame on an M-series
   * GPU, too close to the 1 ms bound; 24 rows keep it about 0.7 (P9-B2's 32 rows were 0.18 / 0.3-0.65 ms). Read when a bake starts.
   */
  bakeRows: number;
  /**
   * H4 (S3): how a column's vertical shape is made. 0 (default): the species height law (generate/shaders.ts SP_* rows, f = s - h^p). 1: the
   * Nubis Evolved / N3 s18 top x bottom tables (generate/profile-tables.ts) with an independent top and bottom type per column. Needs the species
   * rows (NvdfParams.profiles); the upper (altocumulus) layer and the voxel box keep the species law.
   */
  profileMode: number;
  /** Table mode: the top type everywhere (0..1), or -1 (default) for each column's species row (profile-tables.ts SPECIES_TOP_TYPES). */
  topType: number;
  /** Table mode: the bottom type everywhere (0 crisp flat base .. 1 slow ragged base), or -1 (default) for the world field below. */
  bottomType: number;
  /** Table mode: the bottom-type field's range (a world-anchored very-low-frequency noise, independent of the top type). Defaults 0 / 0.7. */
  bottomTypeLo: number;
  bottomTypeHi: number;
  /** Table mode: the bottom-type field's feature size, metres. Default 6000. */
  bottomTypeCell: number;
  /** Table mode: 1 (default) the column's min height sits at the tables' floor (h 0.266, where both tables start); 0 the literal mapping (min height at h 0). */
  tableFloor: number;
  /** Table mode: the threshold tau on coverage * top * bottom / its column peak (plus the billow) where the cloud surface is. Default 0.1. */
  tableThreshold: number;
  /**
   * H4 (S4): the up-rez erosion law of the layer (shaders/sky-layer.wgsl.ts skyDensityShaped). 0 (default) ValueErosion, the voxel march's N3 law;
   * 1 HZD additive sat(n' - (1 - P)) with the N3 noise inverted; 2 Nubis Evolved (1 with NE's pow 0.27 sharpening); 3 additive with the raw noise
   * (sign check). The owner judges the A/B (work/captures/H4/); the default stays ValueErosion until then.
   */
  erosionLaw: number;
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
  /**
   * P9-C2 density hand-off for sheets (stratus, stratocumulus): with the hard partition (rimWidth 0), the layer also draws this many metres into the
   * box with its density fading out while the voxel field's fades in (generate it with NvdfParams.edgeFade the same), so a continuous sheet does not
   * show the box outline where the two renderings meet. Default 0 (off).
   */
  densityFade?: number;
  /**
   * World position (x, z, metres) of the weather map's uv origin, i.e. the world point the generator's map pixel (0, 0) corner sits at.
   * Default: the volume box's min corner, which is right for a static volume (the layer's weather is then box-relative, like the generator's).
   * A streaming cloudscape moves the box and keeps its weather anchored in the world (generate/streaming.ts: uv = xz / weatherExtent), so
   * pass `[0, 0]` there: the baked window and the billow noise then stay on the streamer's world field when the box is swapped, and the layer
   * (which is re-baked for the new box) continues the voxel clouds instead of shifting by the window step.
   */
  weatherOrigin?: [number, number];
  /** World extent (x, z, metres) that the weather map's uv [0, 1] spans. Default: the volume box's extent (the streamer's `weatherExtent`, 4096 m, when the box is 4096 m). */
  weatherExtent?: [number, number];
  /**
   * HZD s45 horizon rule (P9-C): from `start` to `end` metres from the box centre the far field's species and clusters blend toward a mid-coverage
   * cumulus sky, so the horizon is never empty or one uniform species. Default: HZD's 15 / 35 km scaled to the layer's range, { start: 15/35 of
   * settings.maxDistance, end: maxDistance } (12.9 / 30 km; mediocris, cluster 0.55), unless the weather options set their own `horizon`; false turns it off.
   */
  horizon?: false | { start: number; end: number; species?: number; cluster?: number };
}

export interface SkyLayer {
  readonly settings: SkyLayerSettings;
  /**
   * Provide the weather and shaping the voxel field was generated from. Starts a tiled bake of the weather window (`settings.bakeRows` per frame);
   * the previous configuration keeps rendering until it completes, then the new weather and shaping switch together.
   */
  configure(options: SkyLayerOptions): void;
  readonly configured: boolean;
  /** Resolved parameters actually in use (after defaults): for reports and tests. */
  readonly info: {
    rimWidth: number; windowSize: number; windowResolution: number; shell: [number, number]; weatherOrigin: [number, number]; resets: number; frames: number;
    /** Weather bakes: completed (swapped in), abandoned (superseded before completion), and the one in progress (tiles done / total), if any. */
    bakes: number; bakesAbandoned: number; baking: { tilesDone: number; tiles: number; tileRows: number } | null;
  } | null;
  /**
   * Bake / compile what is missing: encodes at most one tile of a pending weather bake (or its max mips). True when the layer can render this
   * frame (a window is live). Call before `encode`. `timer` times the bake passes ('skyWeather', 'skyWeatherMips'); without it the timer
   * last given to `encode` is used.
   */
  prepare(encoder: GPUCommandEncoder, box: SkyBox, uniformLighting: boolean, timer?: GpuTimer, procedural?: ProceduralDensityModel | null): boolean;
  encode(encoder: GPUCommandEncoder, args: SkyEncodeArgs): void;
  /**
   * The live weather window, its sampler and the params buffer while the layer is enabled and baked (the reflection dome and the cloud shadow map
   * sample the same field outside the box), else null. `weather` changes identity only when a bake completes.
   */
  readonly domeResources: { weather: GPUTexture; sampler: GPUSampler; params: GPUBuffer } | null;
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
  /**
   * X1: trace this procedural density model instead of the layer's own field (CloudSettings.densityModel 'procedural'). It covers the whole view
   * (no box partition) and writes the same targets, so the resolve, the composite and the haze are shared. Needs `prepare(..., procedural)` first.
   */
  procedural?: ProceduralDensityModel | null;
  /** Seconds (CloudFrame.time): drives the procedural model's evolution. */
  time?: number;
  /** X3: the procedural model's view: the camera (curvature reference) and CloudSettings.windOffset. */
  wind?: ArrayLike<number>;
  /** X3 (procedural trace only): the voxel march's near and far history depth textures (r32uint words) this frame, for the hybrid split. */
  voxelDepth?: { near: GPUTexture; far: GPUTexture };
}

export const SKY_LAYER_DEFAULTS: SkyLayerSettings = {
  enabled: false, densityScale: 1, maxDistance: 30000, maxSteps: 256, transmittanceCutoff: 0.05, stepMin: 8, stepRel: 0.006, lodScale: 0.7, curvature: 0,
  resolutionScale: 0.25, temporal: true, temporalBlend: 0.3, debug: 0, bakeRows: 24,
  profileMode: 0, topType: -1, bottomType: -1, bottomTypeLo: 0, bottomTypeHi: 0.7, bottomTypeCell: 6000, tableFloor: 1, tableThreshold: 0.1, erosionLaw: 0,
};

/** Weather window mip levels: level 0 the bake, levels 1.. the 2x2 maxima (the trace's empty-space skip reads up to level 6). */
const WEATHER_MIPS = 7;
// All levels in one pass: each dispatch is its own usage scope, so level k sees level k - 1 written by the dispatch before it.
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
const MODEL_PARAM_FLOATS = 36;        // params[0..36) describe the cloud model; a change resets the history (except 35, the temporal blend)
const BLEND_PARAM = 35;
const SPECIES_PARAM = 64;             // params[64..80): the species profiles (P9-C) and H4's profile table and erosion law, part of the model too
const SPECIES_PARAMS = 16;

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
  const layoutEntries: GPUBindGroupLayoutEntry[] = [
    { binding: 0, visibility: C, buffer: { type: 'uniform' } },
    { binding: 1, visibility: C, texture: { sampleType: 'depth' } },
    { binding: SKY_COLOR_BINDING, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
    { binding: SKY_DEPTH_BINDING, visibility: C, storageTexture: { access: 'write-only', format: 'rgba32float' } },
    { binding: SKY_WEATHER_BINDING, visibility: C, texture: { sampleType: 'float' } },
    { binding: SKY_SAMPLER_BINDING, visibility: C, sampler: { type: 'filtering' } },
    { binding: SKY_LIGHT_STORAGE_BINDING, visibility: C, buffer: { type: 'read-only-storage' } },
    { binding: SKY_PARAMS_BINDING, visibility: C, buffer: { type: 'uniform' } },
    { binding: SKY_BACK_BINDING, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
  ];
  const layout = device.createBindGroupLayout({ label: 'cloud sky trace', entries: layoutEntries });
  // X3: the procedural trace's pass entries also carry the voxel march's depth words (the hybrid split).
  const procLayoutEntries: GPUBindGroupLayoutEntry[] = [
    ...layoutEntries,
    { binding: SKY_VOXEL_DEPTH_BINDING, visibility: C, texture: { sampleType: 'uint' } },
    { binding: SKY_VOXEL_DEPTH_BINDING + 1, visibility: C, texture: { sampleType: 'uint' } },
  ];
  const R = SKY_RESOLVE_BINDINGS;
  const resolveLayout = device.createBindGroupLayout({ label: 'cloud sky resolve', entries: [
    { binding: 0, visibility: C, buffer: { type: 'uniform' } },
    { binding: 1, visibility: C, texture: { sampleType: 'depth' } },
    { binding: R.trace, visibility: C, texture: { sampleType: 'unfilterable-float' } },
    { binding: R.traceDepth, visibility: C, texture: { sampleType: 'unfilterable-float' } },
    { binding: R.hist, visibility: C, texture: { sampleType: 'float' } },
    { binding: R.histDepth, visibility: C, texture: { sampleType: 'unfilterable-float' } },
    { binding: R.histOut, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
    { binding: R.histDepthOut, visibility: C, storageTexture: { access: 'write-only', format: 'rgba32float' } },
    { binding: R.params, visibility: C, buffer: { type: 'uniform' } },
    { binding: R.sampler, visibility: C, sampler: { type: 'filtering' } },
    { binding: R.traceBack, visibility: C, texture: { sampleType: 'unfilterable-float' } },
    { binding: R.histBack, visibility: C, texture: { sampleType: 'float' } },
    { binding: R.histBackOut, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
  ] });
  const sampler = device.createSampler({ label: 'sky weather', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const maxMipPipeline = device.createComputePipeline({ label: 'cloud sky weather max mip', layout: 'auto', compute: { module: device.createShaderModule({ label: 'cloud sky weather max mip', code: MAX_MIP_WGSL }), entryPoint: 'maxMip' } });
  const encodeMaxMips = (encoder: GPUCommandEncoder, tex: GPUTexture, timestampWrites?: GPUComputePassTimestampWrites) => {
    const pass = encoder.beginComputePass({ label: 'cloud sky weather max mips', timestampWrites });
    pass.setPipeline(maxMipPipeline);
    for (let k = 1; k < tex.mipLevelCount; k++) {
      const bg = device.createBindGroup({ layout: maxMipPipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: tex.createView({ baseMipLevel: k - 1, mipLevelCount: 1 }) },
        { binding: 1, resource: tex.createView({ baseMipLevel: k, mipLevelCount: 1 }) },
      ] });
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(Math.ceil(Math.max(1, tex.width >> k) / 8), Math.ceil(Math.max(1, tex.height >> k) / 8));
    }
    pass.end();
  };
  const paramBuffer = device.createBuffer({ label: 'cloud sky params', size: SKY_PARAM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const params = new Float32Array(SKY_PARAM_FLOATS);
  const prevModel = new Float32Array(MODEL_PARAM_FLOATS);
  const prevSpecies = new Float32Array(SPECIES_PARAMS);
  // H4: the static part of the params buffer (the tables' top ends and the packed N3 s18 tables), written once; the per-frame writes stop before it.
  {
    const ends = profileTopEnds(), lut = packProfileTables();
    const words = new Uint32Array(SKY_LUT_OFFSET - SKY_TABLE_TOP_OFFSET + lut.length);
    new Float32Array(words.buffer, 0, ends.length).set(ends);
    words.set(lut, SKY_LUT_OFFSET - SKY_TABLE_TOP_OFFSET);
    device.queue.writeBuffer(paramBuffer, SKY_TABLE_TOP_OFFSET * 4, words);
  }

  let options: SkyLayerOptions | null = null;
  let dirty = false;
  /** A baked weather window and everything that was configured with it (they switch together). */
  interface SkyWindow {
    texture: GPUTexture;
    resolved: NvdfParams; voxelSize: number; rimWidth: number; densityFade: number; storm: boolean;
    /** World min corner (x, z) and size (m) of the window; its resolution (texels). */
    min: [number, number]; size: number; res: number;
    /** World position of the weather map's uv origin (x, z), and the box the window was baked for (min xyz, extent xyz). */
    wOrigin: [number, number]; box: Float64Array;
  }
  let live: SkyWindow | null = null;
  let pending: (SkyWindow & { bake: WeatherBake }) | null = null;
  /** Resources to destroy at the next `prepare`, after the encoder that last used them was submitted. */
  let retired: (() => void)[] = [];
  let bakes = 0, bakesAbandoned = 0, dissolve = 0;
  let lastTimer: GpuTimer | undefined;
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
    ensureResolve();
  };
  const ensureResolve = () => {
    if (resolvePipeline === null) {
      resolvePipeline = 'pending';
      void device.createComputePipelineAsync({
        label: 'cloud sky resolve',
        layout: device.createPipelineLayout({ bindGroupLayouts: [volumeLayout, resolveLayout] }),
        compute: { module: device.createShaderModule({ label: 'cloud sky resolve', code: SKY_RESOLVE_WGSL }), entryPoint: 'resolve' },
      }).then(p => { if (!disposed) resolvePipeline = p; }, e => { console.error('sky resolve pipeline failed', e); });
    }
  };

  let procActive = false, procWasActive = false, procVersion = -1;
  /** The temporal resolve of this frame's trace into the history, and the copy to the composite's targets (both trace kinds). */
  const resolveAndCopy = (encoder: GPUCommandEncoder, a: SkyEncodeArgs, w: number, h: number) => {
    const tmp = temporal!;
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
    const resolve = encoder.beginComputePass({ label: 'cloud sky resolve', timestampWrites: a.timer?.passTimestampWrites('skyResolve') });
    resolve.setPipeline(resolvePipeline as GPUComputePipeline);
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
    const depth = (label: string) => device.createTexture({ label, size: [w, h], format: 'rgba32float', usage });   // C2: mean distance, scene end, opacity-weighted mean and spread
    temporal = {
      w, h, trace: color('cloud sky trace colour'), traceBack: color('cloud sky trace back'), traceDepth: depth('cloud sky trace depth'),
      hist: [color('cloud sky history 0'), color('cloud sky history 1')], histBack: [color('cloud sky history back 0'), color('cloud sky history back 1')],
      histDepth: [depth('cloud sky history depth 0'), depth('cloud sky history depth 1')],
    };
    needReset = true;
  };

  const sameBox = (a: Float64Array, box: SkyBox) => {
    for (let i = 0; i < 3; i++) if (a[i] !== box.minCorner[i] || a[3 + i] !== box.extent[i]) return false;
    return true;
  };
  /** Start baking the window for `box` with the current options; a bake still in progress is abandoned (its window is out of date). */
  const startBake = (o: SkyLayerOptions, box: SkyBox) => {
    if (pending) { const old = pending.bake; retired.push(() => old.destroy()); pending = null; bakesAbandoned++; }
    // The window is world-anchored and static: uv = (xz - weatherOrigin) / weatherExtent continues the generator's map outward.
    const minX = box.minCorner[0], minZ = box.minCorner[2], sx = box.extent[0], sz = box.extent[2];
    const size = o.window?.size ?? 51200, res = o.window?.resolution ?? 2048;
    const cx = minX + sx / 2, cz = minZ + sz / 2;
    const wOrigin: [number, number] = [o.weatherOrigin?.[0] ?? minX, o.weatherOrigin?.[1] ?? minZ];
    const wExtent: [number, number] = [o.weatherExtent?.[0] ?? sx, o.weatherExtent?.[1] ?? sz];
    const min: [number, number] = [cx - size / 2, cz - size / 2];
    const origin: [number, number] = [(min[0] - wOrigin[0]) / wExtent[0], (min[1] - wOrigin[1]) / wExtent[1]];
    // HZD s45 (P9-C): the far field blends to a mid-coverage cumulus sky, measured from the box centre (uv 0.5 of the generator's map).
    // HZD draws to 35 km and starts at 15 km; the layer draws to settings.maxDistance (30 km), so the default keeps HZD's ratio over our range.
    const horizon = o.horizon === false ? undefined : (o.weather.horizon ?? o.horizon ?? { start: (15 / 35) * settings.maxDistance, end: settings.maxDistance });
    const bake = createWeatherBake(device, {
      ...o.weather, size: [res, res], border: 0, window: { origin, size: [size / wExtent[0], size / wExtent[1]] }, mipLevels: WEATHER_MIPS,
      extentMeters: o.weather.extentMeters ?? wExtent[0], horizon,
    }, { tileRows: settings.bakeRows });
    const border = o.weather.border ?? 0.08;
    const boxCopy = new Float64Array(6);
    for (let i = 0; i < 3; i++) { boxCopy[i] = box.minCorner[i]; boxCopy[3 + i] = box.extent[i]; }
    pending = {
      texture: bake.texture, bake, resolved: { ...NVDF_DEFAULTS, ...o.shape }, voxelSize: o.voxelSize ?? 8,
      rimWidth: o.rimWidth ?? border * Math.min(sx, sz),   // the generator fades coverage over `border` of the map (uv) at every edge
      densityFade: Math.max(0, o.densityFade ?? 0),
      storm: !!o.weather.storm, min, size, res, wOrigin, box: boxCopy,
    };
  };
  /** One frame of the pending bake: the next tile, or (all tiles written) the max mips and the switch to the new window. */
  const stepBake = (encoder: GPUCommandEncoder, timer: GpuTimer | undefined) => {
    const p = pending!;
    if (!p.bake.done) { p.bake.step(encoder, timer?.passTimestampWrites('skyWeather')); return; }
    encodeMaxMips(encoder, p.texture, timer?.passTimestampWrites('skyWeatherMips'));
    const old = live, bake = p.bake;
    retired.push(() => { bake.destroy(true); old?.texture.destroy(); });
    live = { texture: p.texture, resolved: p.resolved, voxelSize: p.voxelSize, rimWidth: p.rimWidth, densityFade: p.densityFade, storm: p.storm, min: p.min, size: p.size, res: p.res, wOrigin: p.wOrigin, box: p.box };
    pending = null; bakes++;
    // No history reset (a full-resolution trace in one frame, about +2 ms): the new weather replaces the history one Bayer phase per frame instead,
    // a 16-frame dissolve at the normal trace cost. A swap that also changes the model (shaping, a moved window) still cuts (encode's model check).
    group = null; dissolve = SKY_TEMPORAL_PERIOD;
  };


  return {
    settings,
    get configured() { return !!options; },
    get info() {
      if (!options) return null;
      const w = live ?? pending;
      return {
        rimWidth: w?.rimWidth ?? 0, windowSize: w?.size ?? 0, windowResolution: w?.res ?? 0,
        shell: w ? [w.box[1], w.box[1] + w.box[4]] as [number, number] : [0, 0] as [number, number], weatherOrigin: w ? [w.wOrigin[0], w.wOrigin[1]] as [number, number] : [0, 0] as [number, number],
        resets, frames, bakes, bakesAbandoned, baking: pending ? { tilesDone: pending.bake.tilesDone, tiles: pending.bake.tiles, tileRows: pending.bake.tileRows } : null,
      };
    },
    configure(o) {
      options = o;
      dirty = true;
    },
    get domeResources() { return live && settings.enabled && options && !disposed && !procActive ? { weather: live.texture, sampler, params: paramBuffer } : null; },
    reset() { needReset = true; },
    prepare(encoder, box, uniformLighting, timer, procedural) {
      procActive = !!procedural;
      if (procedural && !disposed) {
        if (retired.length) { for (const r of retired) r(); retired = []; }
        ensureResolve();
        return procedural.ready && !!procedural.pipeline(uniformLighting ? 'uniform' : 'atmosphere', { volume: volumeLayout, pass: procLayoutEntries, atmosphere: atmosphereLayout })
          && typeof resolvePipeline === 'object' && resolvePipeline !== null;
      }
      if (disposed || !options) return false;
      // The previous frame's encoder has been submitted: what it last used can go now.
      if (retired.length) { for (const r of retired) r(); retired = []; }
      const mode = uniformLighting ? 'uniform' : 'atmosphere';
      if (pipelines[mode] === null) compile(mode);
      const target = pending ?? live;
      if (dirty || !target || !sameBox(target.box, box)) { startBake(options, box); dirty = false; }
      if (pending) stepBake(encoder, timer ?? lastTimer);
      return !!live && typeof pipelines[mode] === 'object' && pipelines[mode] !== null && typeof resolvePipeline === 'object' && resolvePipeline !== null;
    },
    encode(encoder, a) {
      const s = settings;
      const mode = a.atmosphere ? 'atmosphere' : 'uniform';
      lastTimer = a.timer;
      // X1: a procedural model is traced with its own pipeline and bindings into the same targets, with the same temporal bookkeeping.
      const proc = a.procedural ?? null;
      const pipeline = proc ? proc.pipeline(mode, { volume: volumeLayout, pass: procLayoutEntries, atmosphere: atmosphereLayout }) : pipelines[mode];
      const win = live;
      if ((!proc && !win) || !pipeline || pipeline === 'pending' || !resolvePipeline || resolvePipeline === 'pending') return;
      const w = a.color.width, h = a.color.height;
      ensureTemporal(w, h);
      const tmp = temporal!;
      const p = params;
      let procCut = procWasActive;   // switching models cuts the history
      if (proc) {
        // The procedural trace reads only the cutoff and the temporal fields of these params (and the resolve its blend); a model change cuts.
        p.fill(0);
        p[24] = s.stepMin; p[25] = s.stepRel; p[26] = s.maxSteps; p[27] = s.transmittanceCutoff; p[35] = s.temporalBlend;
        const v = proc.update(a.time ?? 0, { camera: a.cameraPosition, wind: a.wind ?? [0, 0, 0] }).version;
        procCut = v !== procVersion || !procWasActive;
        procVersion = v;
      } else {
      const win = live!, resolved = win.resolved;
      // The window and the shaping are the live window's (a bake in progress does not change them); the box partition is the current box.
      p[0] = win.min[0]; p[1] = win.min[1]; p[2] = win.size; p[3] = win.size;
      p[4] = a.box.minCorner[0]; p[5] = a.box.minCorner[2]; p[6] = a.box.extent[0]; p[7] = a.box.extent[2];
      p[8] = win.box[1]; p[9] = win.box[1] + win.box[4]; p[10] = s.maxDistance; p[11] = s.curvature;
      p[12] = resolved.topFraction; p[13] = resolved.domeExponent; p[14] = resolved.baseDefault; p[15] = resolved.baseLift;
      // shapeB.y: B is the owning cloud's billow weight (P9-B; with `storm` it is the base height, so the weight is 1).
      p[16] = resolved.coverageThreshold; p[17] = win.storm ? 0 : 1; p[18] = resolved.scaleBase; p[19] = resolved.scaleTop;
      p[20] = resolved.detailBias; p[21] = win.rimWidth; p[22] = s.densityScale; p[23] = 0.04;
      p[24] = s.stepMin; p[25] = s.stepRel; p[26] = s.maxSteps; p[27] = s.transmittanceCutoff;
      p[28] = resolved.billowAmp; p[29] = resolved.billowCellMeters; p[30] = resolved.seed; p[31] = s.debug;
      // During a weather dissolve a fresh sample replaces the history outright, so every pixel shows the new window after one 16-frame cycle.
      p[32] = win.voxelSize; p[33] = resolved.profileSigma; p[34] = s.lodScale; p[35] = dissolve > 0 ? 1 : s.temporalBlend;
      // P9-C: the species profile table and the upper (altocumulus) layer, as fractions of the shell (= the generator's volume height).
      const shellH = Math.max(win.box[4], 1);
      const alto = altoFractions(resolved, shellH);
      p[64] = resolved.profiles ? 1 : 0; p[65] = alto[0]; p[66] = alto[1]; p[67] = win.rimWidth === 0 ? win.densityFade : 0;
      // wOrigin.zw: the generator's wind-shear lean (metres per metre of height, x and z), P9-B NvdfParams.shearX/Y.
      p[60] = win.wOrigin[0]; p[61] = win.wOrigin[1]; p[62] = resolved.shearX; p[63] = resolved.shearY;
      // H4: profile table (S3) and erosion law (S4).
      p[68] = s.profileMode; p[69] = s.tableFloor > 0.5 ? PROFILE_TABLE_FLOOR : 0; p[70] = s.tableThreshold; p[71] = s.topType;
      p[72] = s.bottomType; p[73] = s.bottomTypeLo; p[74] = s.bottomTypeHi; p[75] = s.bottomTypeCell;
      p[76] = s.erosionLaw; p[77] = 0; p[78] = 0; p[79] = 0;
      }
      procWasActive = !!proc;
      // Cuts: a camera jump or turn, a sun jump, or any model change invalidates the history (the next frame traces every pixel).
      const cam = a.cameraPosition, sun = a.sunDirection;
      forwardOf(a.inverseViewProjection, fwd);
      let cut = needReset || procCut || !prevValid || !s.temporal;
      if (!cut) {
        const d = Math.hypot(cam[0] - prevCam[0], cam[1] - prevCam[1], cam[2] - prevCam[2]);
        const turn = fwd[0] * prevFwd[0] + fwd[1] * prevFwd[1] + fwd[2] * prevFwd[2];
        const sunDot = sun[0] * prevSun[0] + sun[1] * prevSun[1] + sun[2] * prevSun[2];
        if (d > CUT_POSITION_M || turn < CUT_TURN_COS || sunDot < SUN_JUMP_COS) cut = true;
        for (let i = 0; i < MODEL_PARAM_FLOATS && !cut; i++) if (i !== BLEND_PARAM && p[i] !== prevModel[i]) cut = true;
        for (let i = 0; i < SPECIES_PARAMS && !cut; i++) if (p[SPECIES_PARAM + i] !== prevSpecies[i]) cut = true;
      }
      if (cut && s.temporal) resets++;
      const period = SKY_TEMPORAL_PERIOD;
      p[36] = frames % period; p[37] = Math.floor(frames / period); p[38] = cut ? 1 : 0; p[39] = 0;
      p.set(prevViewProj, 40);
      p[56] = prevCam[0]; p[57] = prevCam[1]; p[58] = prevCam[2]; p[59] = prevValid && !cut ? 1 : 0;
      device.queue.writeBuffer(paramBuffer, 0, p);
      prevModel.set(p.subarray(0, MODEL_PARAM_FLOATS));
      prevSpecies.set(p.subarray(SPECIES_PARAM, SPECIES_PARAM + SPECIES_PARAMS));
      // Remember this frame's view for the next frame's reprojection.
      prevValid = invert4(a.inverseViewProjection, prevViewProj);
      prevCam[0] = cam[0]; prevCam[1] = cam[1]; prevCam[2] = cam[2];
      prevFwd.set(fwd); prevSun[0] = sun[0]; prevSun[1] = sun[1]; prevSun[2] = sun[2];
      needReset = false;
      frames++;
      if (dissolve > 0) dissolve = cut ? 0 : dissolve - 1;

      const base = (): GPUBindGroupEntry[] => [
        { binding: 0, resource: { buffer: a.frameBuffer } },
        { binding: 1, resource: a.depth },
        { binding: SKY_COLOR_BINDING, resource: tmp.trace.createView() },
        { binding: SKY_DEPTH_BINDING, resource: tmp.traceDepth.createView() },
        { binding: SKY_SAMPLER_BINDING, resource: sampler },
        { binding: SKY_LIGHT_STORAGE_BINDING, resource: { buffer: a.skyLightBuffer } },
        { binding: SKY_PARAMS_BINDING, resource: { buffer: paramBuffer } },
        { binding: SKY_BACK_BINDING, resource: tmp.traceBack.createView() },
      ];
      const gk = groupKey;
      if (proc) {
        const vd = a.voxelDepth!;
        const entries = [...base(), { binding: SKY_VOXEL_DEPTH_BINDING, resource: vd.near.createView() }, { binding: SKY_VOXEL_DEPTH_BINDING + 1, resource: vd.far.createView() }];
        group = proc.bindGroup(entries, [a.frameBuffer, a.depth, tmp.trace, a.skyLightBuffer, vd.near, vd.far]); gk[0] = null;
      }
      else if (!group || gk[0] !== win!.texture || gk[1] !== a.frameBuffer || gk[2] !== a.depth || gk[3] !== tmp.trace || gk[4] !== a.skyLightBuffer) {
        gk[0] = win!.texture; gk[1] = a.frameBuffer; gk[2] = a.depth; gk[3] = tmp.trace; gk[4] = a.skyLightBuffer;
        group = device.createBindGroup({ label: 'cloud sky trace', layout, entries: [...base(), { binding: SKY_WEATHER_BINDING, resource: win!.texture.createView() }] });
      }
      const trace = encoder.beginComputePass({ label: 'cloud sky trace', timestampWrites: a.timer?.passTimestampWrites('skyLayer') });
      trace.setPipeline(pipeline);
      trace.setBindGroup(0, a.volumeGroup);
      trace.setBindGroup(1, group!);
      if (a.atmosphere) trace.setBindGroup(MARCH_ATMOSPHERE_GROUP, a.atmosphere);
      if (cut) trace.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
      else trace.dispatchWorkgroups(Math.ceil(w / 4 / 8), Math.ceil(h / 4 / 8));
      trace.end();
      resolveAndCopy(encoder, a, w, h);
    },
    dispose() {
      disposed = true;
      for (const r of retired) r();
      retired = [];
      pending?.bake.destroy(); pending = null;
      live?.texture.destroy(); live = null; paramBuffer.destroy(); group = null; releaseTemporal();
    },
  };
}
