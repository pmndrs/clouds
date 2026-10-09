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
  /**
   * 0..1: how much of the coverage is cells and how much the carpet under them. 1: separate clouds (cumulus); below it, (1 - cellular) of the
   * cluster field is a deck the cells stand on (stratocumulus). Default 1.
   */
  cellular?: number;
  /** Cells across the map of the mid layer; the big layer has half as many, the small one twice, fractus scraps four times. Default 6. */
  cellScale?: number;
  /** 0..1: how much of the fractus scraps (the finest layer, around the rims of larger clouds) to show. Default 0.6. */
  fractus?: number;
  /** 0..1: sub-lobe split of the big and mid cells (turrets of different heights on one cloud instead of one dome). Default 0.5. */
  lobeSplit?: number;
  /** 0..1: width of the per-cell radius and peak distributions (0: every cell of a layer the same size; 1: the full range). Default 1. */
  sizeSpread?: number;
  /** -1..1: shifts the regional species field toward the low (negative) or high (positive) end of `speciesRange`. Default 0. */
  species?: number;
  /**
   * P9-C: the rows of the species profile table (generate/shaders.ts the SP_* species rows) the regional species field spans, low and high end:
   * 0 stratus, 0.25 stratocumulus, 0.5 cumulus humilis, 0.75 mediocris, 1 congestus. Default [0.5, 1] (humilis to congestus regions, as P9-B).
   * Equal ends give one species everywhere.
   */
  speciesRange?: [number, number];
  /** Wind direction in map uv axes (normalised here): stratocumulus bands and rolls and the altocumulus patches align with it. Default [1, 0.5]. */
  wind?: [number, number];
  /**
   * P9-C upper layer (altocumulus), written to A: small near-regular cells in patches. Off by default. The generator places it with
   * NvdfParams.altoBase / altoDepth (and needs `profiles`).
   */
  alto?: {
    /** 0..1: how much of the sky the patches cover and how solid they are. */
    cover: number;
    /** Cells across the map (uv 0..1). Default 18 (about 230 m at the default 4096 m extent; under 10 voxels a cell is too small for the voxel field). */
    cells?: number;
    /** Patches across the map. Default 1.5. */
    patches?: number;
    /** 0 a lattice .. 1 fully jittered. Default 1 (P9-C2: lower reads as a polka-dot grid; the photos measure a spacing CV of 0.57-0.81). */
    jitter?: number;
  };
  /**
   * HZD s45 horizon rule: beyond `start` metres from the map centre (uv 0.5, 0.5) the species and the cluster field blend toward a mid-coverage
   * cumulus sky (`species` row, `cluster` value), fully at `end`. Only the sky layer's window reaches that far; it sets 15000 / 35000 by default.
   */
  horizon?: { start: number; end: number; species?: number; cluster?: number };
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

const WEATHER_PARAM_BYTES = 192;
/** Uniform slots of a tiled bake are 256-byte aligned (minUniformBufferOffsetAlignment). */
const WEATHER_PARAM_STRIDE = 256;
const pipelines = new WeakMap<GPUDevice, GPUComputePipeline>();

function weatherPipeline(device: GPUDevice): GPUComputePipeline {
  let pipeline = pipelines.get(device);
  if (!pipeline) {
    pipeline = device.createComputePipeline({
      label: 'weather map', layout: 'auto',
      compute: { module: device.createShaderModule({ label: 'weather map', code: WEATHER_WGSL }), entryPoint: 'weatherMain' },
    });
    pipelines.set(device, pipeline);
  }
  return pipeline;
}

/** The WeatherParams uniform for a `w` x `h` texture showing `win` of the map's uv space. */
function weatherParams(options: ProceduralWeatherOptions, w: number, h: number, win: { origin: [number, number]; size: [number, number] }): ArrayBuffer {
  const data = new ArrayBuffer(WEATHER_PARAM_BYTES);
  const u = new Uint32Array(data), f = new Float32Array(data);
  u[0] = w; u[1] = h;
  f[2] = options.seed ?? 1; f[3] = options.scale ?? 4;
  f[4] = options.coverageLo ?? 0.42; f[5] = options.coverageHi ?? 0.8; f[6] = options.border ?? 0.08; f[7] = options.cellular ?? 1; f[8] = options.cellScale ?? 6;
  f[10] = options.fractus ?? 0.6; f[11] = options.species ?? 0;
  f[12] = win.origin[0]; f[13] = win.origin[1]; f[14] = win.size[0]; f[15] = win.size[1];
  if (options.evolve) {
    const e = options.evolve;
    f[9] = 1;
    f[16] = e.time; f[17] = e.lifeSeconds ?? 600; f[18] = e.advection?.[0] ?? 0; f[19] = e.advection?.[1] ?? 0;
    f[20] = e.drift?.[0] ?? 0; f[21] = e.drift?.[1] ?? 0;
  }
  f[24] = options.storm ? 1 : 0; f[25] = options.lobeSplit ?? 0.5; f[26] = options.sizeSpread ?? 1;
  f[28] = options.extentMeters ?? 4096; f[29] = options.heightMeters ?? 512;
  const range = options.speciesRange ?? [0.5, 1];
  const wind = options.wind ?? [1, 0.5], wl = Math.hypot(wind[0], wind[1]) || 1;
  f[32] = range[0]; f[33] = range[1]; f[34] = wind[0] / wl; f[35] = wind[1] / wl;
  if (options.alto && options.alto.cover > 0) {
    f[36] = options.alto.cover; f[37] = options.alto.cells ?? 18; f[38] = options.alto.patches ?? 1.5; f[39] = options.alto.jitter ?? 1;
  }
  if (options.horizon) {
    f[40] = options.horizon.start; f[41] = options.horizon.end; f[42] = options.horizon.species ?? 0.75; f[43] = options.horizon.cluster ?? 0.55;
  }
  return data;
}

/**
 * Encode a procedural weather map: rgba8unorm, R coverage, G species (the profile table row, P9-C: 0 stratus .. 0.25 stratocumulus .. 0.5 humilis
 * .. 0.75 mediocris .. 1 congestus), B the billow weight of the column's cloud (with `storm`: the base height), A the upper (altocumulus) layer's
 * mass, 0 without `alto` (with `storm`: the top height; fractions of the volume height, read with useMapHeights). P9-B: an fBm cluster field (where clouds gather, with clear gaps) gates four
 * sparse layers of cells of different sizes, each cell with its own radius, peak, profile and sub-lobe split (shaders.ts WEATHER_WGSL).
 * The caller submits the encoder. The result is usable as `weather` for createVolumeGenerator.
 * One dispatch: about 1.4 ms at 512^2 and 13 ms at 2048^2 (M-series, P9-B). For a large map that must not stall a frame, use
 * `createWeatherBake` and spread the rows over frames.
 */
export function encodeProceduralWeatherMap(device: GPUDevice, encoder: GPUCommandEncoder, options: ProceduralWeatherOptions): GPUTexture {
  const [w, h] = options.size;
  const pipeline = weatherPipeline(device);
  const texture = device.createTexture({
    label: 'weather map', size: { width: w, height: h }, format: 'rgba8unorm', mipLevelCount: Math.max(1, options.mipLevels ?? 1),
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
  });
  const uniforms = device.createBuffer({ label: 'weather params', size: WEATHER_PARAM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uniforms, 0, weatherParams(options, w, h, options.window ?? { origin: [0, 0], size: [1, 1] }));
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

export interface WeatherBakeOptions {
  /** Rows of the map written per `step` (the last tile may be shorter). Default 64. A multiple of 8 keeps the workgroups full. */
  tileRows?: number;
}

/**
 * A weather map baked in horizontal tiles over several frames (P9-B2: the sky layer's 2048^2 window is 13 ms in one dispatch).
 * Each `step` evaluates the next `tileRows` rows as their own window of the map's uv space (the fields are procedural in uv, so a
 * tile is the same pixels as the one-shot map, up to the float rounding of the tile's window) into a scratch strip and copies the
 * strip into level 0. Mip levels beyond 0 are allocated (COPY_DST too) but left to the caller, as with encodeProceduralWeatherMap.
 * The texture is incomplete until `done`: keep sampling the previous map until then.
 */
export interface WeatherBake {
  readonly texture: GPUTexture;
  readonly tileRows: number;
  /** Tiles in the map and tiles encoded so far. */
  readonly tiles: number;
  readonly tilesDone: number;
  readonly done: boolean;
  /** Encode the next tile (a no-op once done). `timestampWrites` times the tile's compute pass. Returns `done` after this tile. */
  step(encoder: GPUCommandEncoder, timestampWrites?: GPUComputePassTimestampWrites): boolean;
  /**
   * Free the scratch strip and uniforms (the texture too unless `keepTexture`). Call once done, or to abandon the bake, but only after the
   * encoder holding the last `step` was submitted (a destroyed resource in an unsubmitted encoder fails the submit).
   */
  destroy(keepTexture?: boolean): void;
}

export function createWeatherBake(device: GPUDevice, options: ProceduralWeatherOptions, bake: WeatherBakeOptions = {}): WeatherBake {
  const [w, h] = options.size;
  const tileRows = Math.max(1, Math.min(h, Math.floor(bake.tileRows ?? 64)));
  const tiles = Math.ceil(h / tileRows);
  const pipeline = weatherPipeline(device);
  const texture = device.createTexture({
    label: 'weather map (tiled)', size: { width: w, height: h }, format: 'rgba8unorm', mipLevelCount: Math.max(1, options.mipLevels ?? 1),
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
  });
  const strip = device.createTexture({
    label: 'weather map tile', size: { width: w, height: tileRows }, format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
  });
  // One uniform slot per tile, written once: two steps in one encoder must not share a slot.
  const uniforms = device.createBuffer({ label: 'weather params (tiled)', size: tiles * WEATHER_PARAM_STRIDE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const win = options.window ?? { origin: [0, 0], size: [1, 1] };
  const all = new Uint8Array(tiles * WEATHER_PARAM_STRIDE);
  for (let t = 0; t < tiles; t++) {
    const y0 = t * tileRows, rows = Math.min(tileRows, h - y0);
    const tileWin = { origin: [win.origin[0], win.origin[1] + (win.size[1] * y0) / h] as [number, number], size: [win.size[0], (win.size[1] * rows) / h] as [number, number] };
    all.set(new Uint8Array(weatherParams(options, w, rows, tileWin)), t * WEATHER_PARAM_STRIDE);
  }
  device.queue.writeBuffer(uniforms, 0, all);
  const stripView = strip.createView();
  let done = 0, destroyed = false;
  return {
    texture, tileRows, tiles,
    get tilesDone() { return done; },
    get done() { return done >= tiles; },
    step(encoder, timestampWrites) {
      if (destroyed || done >= tiles) return done >= tiles;
      const y0 = done * tileRows, rows = Math.min(tileRows, h - y0);
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniforms, offset: done * WEATHER_PARAM_STRIDE, size: WEATHER_PARAM_BYTES } }, { binding: 1, resource: stripView }],
      });
      const pass = encoder.beginComputePass({ label: 'weather map tile', timestampWrites });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(rows / 8));
      pass.end();
      encoder.copyTextureToTexture({ texture: strip }, { texture, origin: { x: 0, y: y0 } }, { width: w, height: rows });
      done++;
      return done >= tiles;
    },
    destroy(keepTexture = false) {
      if (destroyed) return;
      destroyed = true;
      // WebGPU frees them once the submitted work that uses them completes.
      strip.destroy(); uniforms.destroy();
      if (!keepTexture) texture.destroy();
    },
  };
}
