import { WEATHER_WGSL } from './shaders';

export interface ProceduralWeatherOptions {
  /** Map size in pixels. Match the volume's (x, map row) dims for 1:1 sampling. */
  size: [number, number];
  seed?: number;
  /** fBm frequency across the whole map. Default 4. */
  scale?: number;
  /** Coverage ramps from 0 at `coverageLo` to 1 at `coverageHi` of the fBm value. Defaults 0.42 / 0.8 (a wide ramp: coverage stays a smooth, peaked field). */
  coverageLo?: number;
  coverageHi?: number;
  /** Width (fraction of the map) of the fade to zero at the borders. Default 0.08. */
  border?: number;
  /** 0..1: blend from plain fBm (0) to one dome per Worley cell (1). Default 0. */
  cellular?: number;
  /** Worley cells across the map when `cellular` > 0. Default 6. */
  cellScale?: number;
  /**
   * Evaluate this window of the map's uv space (origin and size in uv units; default [0,0] / [1,1]) into the texture. The fields are
   * procedural in uv, so a window beyond [0,1] continues the same world-anchored weather outside the volume (the distant sky layer
   * uses this). Set `border: 0` there, or the fade to zero at uv 0..1 would be evaluated outside the map.
   */
  window?: { origin: [number, number]; size: [number, number] };
  /**
   * Time evolution (cumulus life cycles). Off by default (the map is then static and identical to before). With it, the pattern is a function of
   * `time`: every Worley cell grows, matures and dissipates over `lifeSeconds` (about 0.6x..1.4x per cell, random phase), restarting with a new
   * position and strength each cycle; the pattern is shifted by `advection` (uv units, positive = the clouds moved towards +uv) and the fBm
   * layer drifts by `drift` uv units per second. `border` stays attached to the window.
   */
  evolve?: { time: number; lifeSeconds?: number; advection?: [number, number]; drift?: [number, number] };
  /**
   * Storm scene (P6-B/C): write the field's base/top as fractions of `heightMeters` (for a taller volume than the presets' 512 m) with gentler tops.
   * The cumulonimbus itself is no longer in the map: it is a 3D field in the generator (`VolumeGeneratorOptions.storm`, see `stormCellState`).
   */
  storm?: boolean;
  /** Metres spanned by the map's uv 0..1 (storm geometry is in metres). Default 4096. */
  extentMeters?: number;
  /** Height of the volume the map's base/top fractions refer to, metres. Only the storm cell path uses it (it writes both fields as fractions of this). Default 512. */
  heightMeters?: number;
  /** Allocate this many mip levels (the pass writes level 0 only; the sky layer fills the rest with coverage maxima). Default 1. */
  mipLevels?: number;
}

/** A cumulonimbus life cycle (P6-B API, P6-C 3D shape): the evolving cloudscape turns it into the generator's `StormCellState` per generation. */
export interface StormCellOptions {
  /** Cell centre at time 0 in the pattern frame, map uv (0..1 spans `extentMeters`). Default [0.5, 0.5]. */
  center?: [number, number];
  /** `evolve.time` (s) at which the cell's age is 0. Negative: it is already a young cell at time 0. Default 0. */
  start?: number;
  /** Seconds from age 0 until the cell is mature (tower at full height, anvil spreading). Default 120. */
  growSeconds?: number;
  /** Mature tower radius, metres. Default 520. */
  towerRadius?: number;
  /** Mature tower top above the volume base, metres. Default 0.9 of the volume height. */
  towerHeight?: number;
  /** Anvil radius at full spread, metres. Default 1500. */
  anvilRadius?: number;
  /** Direction the anvil is carried (wind shear), map uv axes. Default [1, 0.35]. */
  shear?: [number, number];
  /** Height of the cell's base above the volume base, metres. Default 60. */
  baseHeight?: number;
}

/** The storm cell's life cycle at phase `ph` = age / growSeconds (the WGSL `stormField` uses the same curves). Sizes are fractions of the mature ones. */
export function stormCellState(ph: number): { rise: number; towerEnvelope: number; anvilSpread: number; anvilEnvelope: number; radiusScale: number; heightScale: number } {
  const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const rise = smooth(0, 0.75, ph);
  const towerEnvelope = smooth(0, 0.06, ph) * (1 - smooth(1.7, 2.6, ph));
  return {
    rise, towerEnvelope, anvilSpread: smooth(0.42, 1.05, ph), anvilEnvelope: smooth(0.42, 0.56, ph) * (1 - smooth(2.6, 3.6, ph)),
    radiusScale: 0.4 + 0.6 * rise, heightScale: (0.2 + 0.8 * Math.pow(rise, 0.85)) * towerEnvelope,
  };
}

const WEATHER_PARAM_BYTES = 128;
const pipelines = new WeakMap<GPUDevice, GPUComputePipeline>();

/**
 * Encode a procedural weather map: rgba8unorm, R coverage, G cloud type (0 wispy/stratiform .. 1 billowy/cumuliform),
 * B base height, A top height (both fractions of the volume height). fBm for coverage and heights, Worley for type.
 * The caller submits the encoder. The result is usable as `weather` for createVolumeGenerator.
 */
export function encodeProceduralWeatherMap(device: GPUDevice, encoder: GPUCommandEncoder, options: ProceduralWeatherOptions): GPUTexture {
  const [w, h] = options.size;
  let pipeline = pipelines.get(device);
  if (!pipeline) {
    pipeline = device.createComputePipeline({
      label: 'weather map', layout: 'auto',
      compute: { module: device.createShaderModule({ label: 'weather map', code: WEATHER_WGSL }), entryPoint: 'weatherMain' },
    });
    pipelines.set(device, pipeline);
  }
  const texture = device.createTexture({
    label: 'weather map', size: { width: w, height: h }, format: 'rgba8unorm', mipLevelCount: Math.max(1, options.mipLevels ?? 1),
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
  });
  const data = new ArrayBuffer(WEATHER_PARAM_BYTES);
  const u = new Uint32Array(data), f = new Float32Array(data);
  u[0] = w; u[1] = h;
  f[2] = options.seed ?? 1; f[3] = options.scale ?? 4;
  f[4] = options.coverageLo ?? 0.42; f[5] = options.coverageHi ?? 0.8; f[6] = options.border ?? 0.08; f[7] = options.cellular ?? 0; f[8] = options.cellScale ?? 6;
  const win = options.window ?? { origin: [0, 0], size: [1, 1] };
  f[12] = win.origin[0]; f[13] = win.origin[1]; f[14] = win.size[0]; f[15] = win.size[1];
  if (options.evolve) {
    const e = options.evolve;
    f[9] = 1;
    f[16] = e.time; f[17] = e.lifeSeconds ?? 600; f[18] = e.advection?.[0] ?? 0; f[19] = e.advection?.[1] ?? 0;
    f[20] = e.drift?.[0] ?? 0; f[21] = e.drift?.[1] ?? 0;
  }
  f[24] = options.storm ? 1 : 0;
  f[28] = options.extentMeters ?? 4096; f[29] = options.heightMeters ?? 512;
  const uniforms = device.createBuffer({ label: 'weather params', size: WEATHER_PARAM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uniforms, 0, data);
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniforms } }, { binding: 1, resource: texture.createView({ baseMipLevel: 0, mipLevelCount: 1 }) }],
  });
  const pass = encoder.beginComputePass({ label: 'weather map' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
  pass.end();
  // The uniform buffer is only read by this pass; destroy after submission completes.
  device.queue.onSubmittedWorkDone().then(() => uniforms.destroy(), () => {});
  return texture;
}
