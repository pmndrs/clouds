// Cloud shadow map (P10-A): a world-anchored, two-cascade map of the cloud optical depth along the sun ray, refreshed a slice per frame.
// See shaders/shadow-map.wgsl.ts for the method. This file owns the textures, the refresh schedule and the invalidation. No three imports.
import type { GpuTimer } from './gpu-timer';
import { COMMON_WGSL } from './shaders/common.wgsl';
import type { ProceduralDensityModel } from './procedural/types';
import { SHADOW_BLEND_BINDINGS, SHADOW_BLEND_PARAM_BYTES, SHADOW_MAP_BINDINGS, SHADOW_MAP_PARAM_BYTES, cloudShadowMapWgsl, shadowBlendWgsl, shadowMapWgsl } from './shaders/shadow-map.wgsl';
import { SKY_PARAM_BYTES } from './shaders/sky-layer.wgsl';
import { volumeWgsl } from './shaders/volume.wgsl';

export { cloudShadowMapWgsl };

/** Live knobs. Safe to change every frame (a change invalidates the map; it refreshes over `refreshFrames`). */
export interface CloudShadowMapSettings {
  /** Master switch. Off: the composite falls back to the light-grid shadow (voxel region only). Default true. */
  enabled: boolean;
  /** World extent covered by the near and far cascades, metres. Cell size = extent / resolution (8 km at 1024 = 8 m texels; 64 km = 64 m). */
  nearExtent: number;
  farExtent: number;
  /** Frames one full refresh of both cascades takes (rows are refreshed in turn). Default 24. */
  refreshFrames: number;
  /** Samples along each sun ray through the shell. Default 48. */
  steps: number;
  /** X3: samples along each sun ray through a procedural model's shell. Default 64. */
  proceduralSteps: number;
  /** Height of the ground the cascades centre on (the camera's foot point), metres. Default 0. */
  groundHeight: number;
  /** Debug view (0 off). 1: outline the shadow map's tau contour on the ground. 2: the same outline on the cloud shell's base plane (seen from below, it should trace the cloud silhouettes when the sun is high). */
  debug: 0 | 1 | 2;
  /**
   * SH1: keep the clouds' ground shadow steady while they move (procedural model only). The map is built in a back buffer from one frozen
   * moment (every row of a sweep at the same cloud position), copied to the map when the sweep completes, and every lookup is shifted by how far
   * the wind has carried the clouds since: the shadow slides smoothly each frame instead of stepping with each refreshed slice. false = the old
   * behaviour: rows are written into the map as they are refreshed, each at its own moment. Default true.
   */
  advect: boolean;
  /** SH1: with `advect`, multiplier on how fast the stored shadow slides (1 = the clouds' own speed, the model's motionSpeed times the wind). Default 1. */
  advectSpeed: number;
  /** SH1: with `advect`, frames one sweep takes (replaces `refreshFrames`; shorter = a fresher snapshot = less to ease, at proportionally more GPU time). Default 12. */
  advectRefreshFrames: number;
  /** SH1: with `advect`, frames over which the map eases from the old snapshot to a landed sweep (0 = switch at once, which pops where the clouds have changed shape). The next sweep starts after it. Default 6. */
  advectBlendFrames: number;
  /** SH1: with `advect`, a new sweep starts once the clouds have moved this far (m) from the snapshot in the map. Default 16. */
  advectRefreshMeters: number;
  /** Tau of the debug contour. Default 0.3. */
  debugThreshold: number;
  /** Radiance of the debug outline (output units; the scene's own exposure). Default 8. */
  debugGain: number;
}

export const SHADOW_MAP_DEFAULTS: CloudShadowMapSettings = {
  enabled: true, nearExtent: 8192, farExtent: 65536, refreshFrames: 24, steps: 48, proceduralSteps: 64, groundHeight: 0, advect: true, advectSpeed: 1, advectRefreshFrames: 12, advectBlendFrames: 6, advectRefreshMeters: 16, debug: 0, debugThreshold: 0.3, debugGain: 8,
};

export interface ShadowMapSky {
  /** The sky layer's baked weather window, its sampler and params (SkyLayer.domeResources). */
  weather: GPUTexture;
  sampler: GPUSampler;
  params: GPUBuffer;
  /** Anything else that changes the layer's field (SkyLayerSettings.densityScale, curvature, ...): a change invalidates the map. */
  key: readonly number[];
}

export interface ShadowMapEncodeArgs {
  volumeGroup: GPUBindGroup;
  /** The runtime's light grid and the index of its finished texture; `gridSwapped` is true on the frame a rebuild completed. */
  lightGrid: { bindGroupEntries(binding: number, textureIndex: 0 | 1): GPUBindGroupEntry[] };
  gridFront: 0 | 1;
  gridSwapped: boolean;
  /** Unit vector toward the sun. */
  sunDirection: ArrayLike<number>;
  cameraPosition: ArrayLike<number>;
  /** The volume box (also the cloud shell: [min.y, min.y + extent.y]). */
  box: { minCorner: ArrayLike<number>; extent: ArrayLike<number> };
  /** CloudSettings.densityScale and lightDensityScale. */
  extinction: number;
  lightDensityScale: number;
  shadowStrength: number;
  /** The sky layer's resources while it renders this frame, else null (the map then covers the voxel box only). */
  sky: ShadowMapSky | null;
  /**
   * X3: the procedural density model while it renders this frame (densityModel 'procedural' or 'hybrid'), else null. Its clouds are integrated
   * over its shell; the map plane drops to the lower of the box's and the shell's base. `procKey` (its version and the wind offset, rounded) invalidates.
   */
  procedural?: ProceduralDensityModel | null;
  procKey?: readonly number[];
  /** SH1: the model's version (a change of its settings rebuilds the map; `procKey` also carries the wind, which `advect` handles itself). */
  procVersion?: number;
  /** SH1: CloudSettings.windOffset and the fraction of it the visible clouds follow (ProceduralDensityModel.motionSpeed, absent = 1). Needed by `advect`. */
  wind?: ArrayLike<number>;
  windSpeed?: number;
  timer?: GpuTimer;
}

export interface CloudShadowMap {
  readonly settings: CloudShadowMapSettings;
  /** Cascade textures (r32float, resolution x resolution, texel = tau). Bind them with `bindGroupEntries` and sample with cloudShadowMapWgsl(). */
  readonly resolution: number;
  readonly textures: readonly [GPUTexture, GPUTexture];
  readonly paramsBuffer: GPUBuffer;
  /** CPU mirror of the uniform written by the last `encode` (12 vec4, see CloudShadowMap in shadow-map.wgsl.ts). For adapters that sample the map outside WGSL bindings. */
  readonly params: Readonly<Float32Array>;
  /** Layout entries / bind group entries for cloudShadowMapWgsl(group, binding): uniform at `binding`, near cascade at +1, far at +2. */
  bindGroupLayoutEntries(binding: number, visibility: number): GPUBindGroupLayoutEntry[];
  bindGroupEntries(binding: number): GPUBindGroupEntry[];
  /** State for tooling. `valid`: a complete refresh has landed, so the composite reads the map. */
  readonly info: { valid: boolean; remainingRows: number; refreshes: number; sweeps: number; nearOrigin: [number, number]; farOrigin: [number, number]; bytes: number; advect: boolean; shiftMeters: number };
  /** Mark the map stale: it refreshes over the next `refreshFrames` frames. `hard` also withholds it from the composite until that refresh completes. */
  invalidate(hard?: boolean): void;
  /** Update the uniform and record the next refresh slice. Returns true when the map is complete enough to sample. */
  encode(encoder: GPUCommandEncoder, args: ShadowMapEncodeArgs): boolean;
  dispose(): void;
}

/** Plane displacement (metres at the shell's top) between two sun directions beyond which the map is refreshed / refreshed at double rate. */
const SUN_STALE_M = 4;
const SUN_JUMP_M = 120;
const MIN_SUN_Y = 0.02;
const BLEND_CELLS = 16;

export function createCloudShadowMap(device: GPUDevice, volumeLayout: GPUBindGroupLayout, options: { resolution?: number } = {}): CloudShadowMap {
  const N = Math.max(64, 1 << Math.round(Math.log2(options.resolution ?? 1024)));
  const settings: CloudShadowMapSettings = { ...SHADOW_MAP_DEFAULTS };
  const C = GPUShaderStage.COMPUTE;
  const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;
  const textures: [GPUTexture, GPUTexture] = [
    device.createTexture({ label: 'cloud shadow map near', size: [N, N], format: 'r32float', usage }),
    device.createTexture({ label: 'cloud shadow map far', size: [N, N], format: 'r32float', usage }),
  ];
  const views = [textures[0].createView(), textures[1].createView()];
  const paramsBuffer = device.createBuffer({ label: 'cloud shadow map params', size: SHADOW_MAP_PARAM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const p = new Float32Array(SHADOW_MAP_PARAM_BYTES / 4);
  // Stand-ins for the sky layer's weather window and params while the layer is off (work2.x = 0 skips the field).
  const dummyWeather = device.createTexture({ label: 'cloud shadow map dummy weather', size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
  const dummyParams = device.createBuffer({ label: 'cloud shadow map dummy sky params', size: SKY_PARAM_BYTES, usage: GPUBufferUsage.UNIFORM });
  const dummySampler = device.createSampler({ label: 'cloud shadow map dummy sampler', magFilter: 'linear', minFilter: 'linear' });

  const layoutEntries: GPUBindGroupLayoutEntry[] = [
    { binding: SHADOW_MAP_BINDINGS.params, visibility: C, buffer: { type: 'uniform' } },
    { binding: SHADOW_MAP_BINDINGS.outNear, visibility: C, storageTexture: { access: 'write-only', format: 'r32float' } },
    { binding: SHADOW_MAP_BINDINGS.outFar, visibility: C, storageTexture: { access: 'write-only', format: 'r32float' } },
    { binding: SHADOW_MAP_BINDINGS.lightGrid, visibility: C, texture: { sampleType: 'float', viewDimension: '3d' } },
    { binding: SHADOW_MAP_BINDINGS.lightGrid + 1, visibility: C, sampler: { type: 'filtering' } },
    { binding: SHADOW_MAP_BINDINGS.skyWeather, visibility: C, texture: { sampleType: 'float' } },
    { binding: SHADOW_MAP_BINDINGS.skySampler, visibility: C, sampler: { type: 'filtering' } },
    { binding: SHADOW_MAP_BINDINGS.skyParams, visibility: C, buffer: { type: 'uniform' } },
  ];
  const layout = device.createBindGroupLayout({ label: 'cloud shadow map refresh', entries: layoutEntries });
  let pipeline: GPUComputePipeline | null = null;
  void device.createComputePipelineAsync({
    label: 'cloud shadow map refresh',
    layout: device.createPipelineLayout({ bindGroupLayouts: [volumeLayout, layout] }),
    compute: { module: device.createShaderModule({ label: 'cloud shadow map refresh', code: COMMON_WGSL + volumeWgsl(0) + shadowMapWgsl() }), entryPoint: 'main' },
  }).then(pl => { pipeline = pl; }, e => { console.error('cloud shadow map pipeline failed', e); });
  // SH1: the blend pass (old snapshot -> new snapshot).
  const blendLayout = device.createBindGroupLayout({ label: 'cloud shadow map blend', entries: [
    { binding: SHADOW_BLEND_BINDINGS.params, visibility: C, buffer: { type: 'uniform' } },
    { binding: SHADOW_BLEND_BINDINGS.prevNear, visibility: C, texture: { sampleType: 'unfilterable-float' } },
    { binding: SHADOW_BLEND_BINDINGS.prevFar, visibility: C, texture: { sampleType: 'unfilterable-float' } },
    { binding: SHADOW_BLEND_BINDINGS.freshNear, visibility: C, texture: { sampleType: 'unfilterable-float' } },
    { binding: SHADOW_BLEND_BINDINGS.freshFar, visibility: C, texture: { sampleType: 'unfilterable-float' } },
    { binding: SHADOW_BLEND_BINDINGS.outNear, visibility: C, storageTexture: { access: 'write-only', format: 'r32float' } },
    { binding: SHADOW_BLEND_BINDINGS.outFar, visibility: C, storageTexture: { access: 'write-only', format: 'r32float' } },
  ] });
  let blendPipe: GPUComputePipeline | null = null;
  void device.createComputePipelineAsync({
    label: 'cloud shadow map blend',
    layout: device.createPipelineLayout({ bindGroupLayouts: [blendLayout] }),
    compute: { module: device.createShaderModule({ label: 'cloud shadow map blend', code: shadowBlendWgsl() }), entryPoint: 'main' },
  }).then(pl => { blendPipe = pl; }, e => { console.error('cloud shadow map blend pipeline failed', e); });
  const blendParams = device.createBuffer({ label: 'cloud shadow map blend params', size: SHADOW_BLEND_PARAM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bp = new Float32Array(SHADOW_BLEND_PARAM_BYTES / 4);
  // X3: one pipeline per procedural shaper (the model's density WGSL), compiled on first use.
  const procPipelines = new Map<string, { layout: GPUBindGroupLayout; pipeline: GPUComputePipeline | null }>();
  const procPipeline = (m: ProceduralDensityModel) => {
    let e = procPipelines.get(m.wgslKey);
    if (!e) {
      const pl = device.createBindGroupLayout({ label: 'cloud shadow map refresh (procedural)', entries: [...layoutEntries, ...m.layoutEntries(SHADOW_MAP_BINDINGS.procedural, C)] });
      const entry: { layout: GPUBindGroupLayout; pipeline: GPUComputePipeline | null } = { layout: pl, pipeline: null };
      e = entry;
      procPipelines.set(m.wgslKey, entry);
      void device.createComputePipelineAsync({
        label: `cloud shadow map refresh (procedural ${m.wgslKey})`,
        layout: device.createPipelineLayout({ bindGroupLayouts: [volumeLayout, pl] }),
        compute: { module: device.createShaderModule({ label: 'cloud shadow map refresh (procedural)', code: COMMON_WGSL + volumeWgsl(0) + shadowMapWgsl(m.densityWgsl(1, SHADOW_MAP_BINDINGS.procedural)) }), entryPoint: 'main' },
      }).then(p => { entry.pipeline = p; }, err => { console.error('cloud shadow map procedural pipeline failed', err); });
    }
    return e;
  };

  let disposed = false;
  let valid = false;          // a complete refresh has landed
  let remaining = N;          // rows left in the current sweep; 0 = idle
  let cursor = 0;             // next row
  let hardPending = true;     // the current sweep must finish before the map is offered
  let refreshes = 0, sweeps = 0;
  // The windows the lookups read (the map's own), and their cell sizes. Without `advect` they are also the windows being refreshed.
  const origin = { near: [0, 0] as [number, number], far: [0, 0] as [number, number], placed: false };
  const mapSun = new Float64Array([0, 1, 0]);   // the sun the rows are built with (lookups use it too)
  let frontNearCell = SHADOW_MAP_DEFAULTS.nearExtent / N, frontFarCell = SHADOW_MAP_DEFAULTS.farExtent / N, frontFarOn = false;
  let lastGrid: unknown = null, lastWeather: GPUTexture | null = null, lastSkyKey: readonly number[] = [];
  let lastBox = new Float64Array(6);
  let lastScalars = [NaN, NaN, NaN, NaN, NaN];
  const groups: (GPUBindGroup | undefined)[] = [undefined, undefined];
  let groupGrid: unknown = null, groupWeather: GPUTexture | null = null, groupParams: GPUBuffer | null = null, groupProc: object | null = null;
  let lastProc: object | null = null, lastProcKey: readonly number[] = [], lastProcVersion = NaN;

  // SH1 (advect): a sweep is built into a back buffer from one frozen moment and copied over the map when it completes; lookups are shifted by
  // how far the clouds have moved since that moment.
  let back: [GPUTexture, GPUTexture] | null = null;
  let backViews: GPUTextureView[] = [];
  const ensureBack = () => {
    if (!back) {
      const u = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC;
      back = [device.createTexture({ label: 'cloud shadow map near (back)', size: [N, N], format: 'r32float', usage: u }), device.createTexture({ label: 'cloud shadow map far (back)', size: [N, N], format: 'r32float', usage: u })];
      backViews = [back[0].createView(), back[1].createView()];
    }
    return backViews;
  };
  // The old snapshot while the map eases to a landed sweep (a copy of the map as it was), and where that stands.
  let prev: [GPUTexture, GPUTexture] | null = null;
  const blend = { active: false, k: 0, frames: 0, prevWind: [0, 0], near: [0, 0] as [number, number], far: [0, 0] as [number, number], nearCell: 0, farCell: 0, farOn: false };
  let blendGroup: GPUBindGroup | null = null;
  const ensurePrev = () => {
    if (!prev) {
      const u = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;
      prev = [device.createTexture({ label: 'cloud shadow map near (prev)', size: [N, N], format: 'r32float', usage: u }), device.createTexture({ label: 'cloud shadow map far (prev)', size: [N, N], format: 'r32float', usage: u })];
    }
    return prev;
  };
  let advectOn = false;       // the last encode ran with advect
  let pendingStale = false;   // advect: start another sweep as soon as the running one ends
  const sweepWind = [0, 0];   // the clouds' displacement (m) when the running sweep began: the moment its rows show
  const frontWind = [0, 0];   // the same for the snapshot now in the map
  const sweepSun = new Float64Array([0, 1, 0]);
  const ref = { near: [0, 0] as [number, number], far: [0, 0] as [number, number], nearCell: SHADOW_MAP_DEFAULTS.nearExtent / N, farCell: SHADOW_MAP_DEFAULTS.farExtent / N, farOn: false };
  let advShift = 0;

  const projected = (s: ArrayLike<number>) => [s[0] / s[1], s[2] / s[1]];

  return {
    settings, resolution: N, textures, paramsBuffer, params: p,
    bindGroupLayoutEntries(binding, visibility) {
      return [
        { binding, visibility, buffer: { type: 'uniform' } },
        { binding: binding + 1, visibility, texture: { sampleType: 'unfilterable-float' } },
        { binding: binding + 2, visibility, texture: { sampleType: 'unfilterable-float' } },
      ];
    },
    bindGroupEntries(binding) {
      return [{ binding, resource: { buffer: paramsBuffer } }, { binding: binding + 1, resource: views[0] }, { binding: binding + 2, resource: views[1] }];
    },
    get info() {
      return { valid, remainingRows: remaining, refreshes, sweeps, nearOrigin: [origin.near[0], origin.near[1]] as [number, number], farOrigin: [origin.far[0], origin.far[1]] as [number, number], bytes: (2 + (back ? 2 : 0) + (prev ? 2 : 0)) * N * N * 4, advect: advectOn, shiftMeters: advShift };
    },
    invalidate(hard = false) {
      if (advectOn) {
        pendingStale = true;
        if (hard) { hardPending = true; valid = false; origin.placed = false; blend.active = false; }   // an unplaced map restarts the sweep at the next encode
      } else {
        remaining = N;
        if (hard) { hardPending = true; valid = false; }
      }
    },
    encode(encoder, a) {
      const s = settings;
      const sun = a.sunDirection;
      const proc = a.procedural ?? null;
      const procEntry = proc ? procPipeline(proc) : null;
      const pipe = procEntry ? procEntry.pipeline : pipeline;
      const off = !s.enabled || disposed || a.shadowStrength <= 0 || sun[1] <= MIN_SUN_Y || !pipe;
      // X3: with a procedural model the plane is the lower of the box's base and the model's shell base, and the shell reaches the higher top.
      const boxTop = a.box.minCorner[1] + a.box.extent[1];
      const planeY = proc ? Math.min(a.box.minCorner[1], proc.shell[0]) : a.box.minCorner[1];
      const H = (proc ? Math.max(boxTop, proc.shell[1]) : boxTop) - planeY;
      if (off) {
        // Offered nothing; when it comes back on, the whole map is rebuilt first.
        valid = false; hardPending = true; remaining = N; lastGrid = null; origin.placed = false; pendingStale = false;
        p[12] = 0;
        device.queue.writeBuffer(paramsBuffer, 0, p);
        return false;
      }

      // SH1: the clouds' displacement (m) this frame; only the procedural model's clouds are advected (the voxel box and the analytic layer have no model speed).
      const advectActive = !!(s.advect && proc && a.wind);
      const sp = (a.windSpeed ?? 1) * s.advectSpeed;
      const W0 = advectActive ? a.wind![0] * sp : 0, W1 = advectActive ? a.wind![2] * sp : 0;
      // A switch of mode rebuilds the map from nothing.
      if (advectActive !== advectOn) { advectOn = advectActive; origin.placed = false; groups[0] = groups[1] = undefined; pendingStale = false; blend.active = false; }

      const skyOn = !!a.sky || !!proc;
      // ---- invalidation ----
      const grid = a.lightGrid;
      let hard = false, stale = false;
      if (grid !== lastGrid) { hard = true; lastGrid = grid; }
      if ((a.sky ? 1 : 0) !== (lastWeather ? 1 : 0)) { hard = true; }
      // X3: a model switch is hard; a model change or the wind moving its clouds by a texel is a refresh (it restarts a sweep only when none is running,
      // so a steady wind never starves the first fill). With advect the wind is handled by the shift; only a model change counts.
      const procRes = proc ? proc.resourceKey : null;
      if (procRes !== lastProc) { hard = true; lastProc = procRes; }
      const pk = a.procKey ?? [];
      let procDrift = false, procChanged = false;
      const keyChanged = pk.length !== lastProcKey.length || pk.some((v, i) => v !== lastProcKey[i]);
      if (keyChanged) lastProcKey = pk;
      if (advectActive) {
        const v = a.procVersion ?? pk[0] ?? 0;
        if (v !== lastProcVersion) procChanged = true;
        lastProcVersion = v;
      } else if (keyChanged) procDrift = true;
      if ((a.sky?.weather ?? null) !== lastWeather) { stale = true; lastWeather = a.sky?.weather ?? null; }
      const sk = a.sky?.key ?? [];
      if (sk.length !== lastSkyKey.length || sk.some((v, i) => v !== lastSkyKey[i])) { stale = true; lastSkyKey = sk; }
      const scalars = [a.extinction, a.lightDensityScale, s.steps, s.nearExtent, s.farExtent];
      if (scalars.some((v, i) => v !== lastScalars[i])) { stale = true; lastScalars = scalars; }
      const bx = [a.box.minCorner[0], a.box.minCorner[1], a.box.minCorner[2], a.box.extent[0], a.box.extent[1], a.box.extent[2]];
      for (let i = 0; i < 6; i++) if (bx[i] !== lastBox[i]) { stale = true; if (i === 1 || i >= 3) hard = true; lastBox[i] = bx[i]; }
      if (a.gridSwapped) stale = true;
      // Sun: the plane displacement at the shell top between the sun the rows were built with and the current one.
      const sunRows = advectActive ? sweepSun : mapSun;
      const [ax, az] = projected(sun), [bxx, bz] = projected(sunRows);
      const move = Math.hypot(ax - bxx, az - bz) * H;
      let rate = 1;
      if (move > SUN_STALE_M) { stale = true; if (!advectActive) { mapSun[0] = sun[0]; mapSun[1] = sun[1]; mapSun[2] = sun[2]; } }
      if (move > SUN_JUMP_M) rate = 2;
      if (!origin.placed) { hard = true; stale = true; if (!advectActive) { mapSun[0] = sun[0]; mapSun[1] = sun[1]; mapSun[2] = sun[2]; } rate = 2; }
      if (hard) { hardPending = true; valid = false; rate = 2; blend.active = false; }

      // ---- placement: the cascades follow the camera's foot point, projected onto the map plane along the sun ----
      const footOf = (sv: ArrayLike<number>) => {
        const sy = Math.max(sv[1], MIN_SUN_Y);
        const dy = planeY - s.groundHeight;
        return [a.cameraPosition[0] + (sv[0] / sy) * dy, a.cameraPosition[2] + (sv[2] / sy) * dy];
      };
      // Where a window should sit for foot point (fx, fz); `apply` moves `cur`. Returns whether it had to move.
      const place = (extent: number, cur: [number, number], fx: number, fz: number, apply: boolean) => {
        const cell = extent / N, snap = N / 16;
        const cx = fx / cell, cz = fz / cell;
        const keep = origin.placed && Math.abs(cx - (cur[0] + N / 2)) < N / 8 && Math.abs(cz - (cur[1] + N / 2)) < N / 8;
        if (keep) return { cell, moved: false };
        if (apply) { cur[0] = Math.round((cx - N / 2) / snap) * snap; cur[1] = Math.round((cz - N / 2) / snap) * snap; }
        return { cell, moved: true };
      };
      if (!advectActive) {
        const [fx, fz] = footOf(mapSun);
        const near = place(s.nearExtent, origin.near, fx, fz, true);
        const far = skyOn ? place(s.farExtent, origin.far, fx, fz, true) : { cell: s.farExtent / N, moved: false };
        origin.placed = true;
        if (near.moved || far.moved) stale = true;
        if (stale) remaining = N;
        else if (procDrift && remaining === 0) remaining = N;
        frontNearCell = near.cell; frontFarCell = far.cell; frontFarOn = skyOn;
        ref.near[0] = origin.near[0]; ref.near[1] = origin.near[1]; ref.far[0] = origin.far[0]; ref.far[1] = origin.far[1];
        ref.nearCell = near.cell; ref.farCell = far.cell; ref.farOn = skyOn;
      } else {
        // The sweep builds its own windows (placed once, when it starts) so every row of it belongs to one map; the map's windows change when it lands.
        if (stale || procChanged) pendingStale = true;
        if (origin.placed && !hard) {
          const [fx, fz] = footOf(sun);
          if (place(s.nearExtent, ref.near, fx, fz, false).moved || (skyOn && place(s.farExtent, ref.far, fx, fz, false).moved)) pendingStale = true;
        }
        const drift = Math.hypot(W0 - frontWind[0], W1 - frontWind[1]);
        if (hard || (remaining === 0 && !blend.active && (pendingStale || drift > s.advectRefreshMeters))) {
          pendingStale = false;
          sweepSun[0] = sun[0]; sweepSun[1] = sun[1]; sweepSun[2] = sun[2];
          sweepWind[0] = W0; sweepWind[1] = W1;
          const [fx, fz] = footOf(sweepSun);
          ref.nearCell = place(s.nearExtent, ref.near, fx, fz, true).cell;
          ref.farCell = skyOn ? place(s.farExtent, ref.far, fx, fz, true).cell : s.farExtent / N;
          ref.farOn = skyOn;
          origin.placed = true;
          remaining = N; cursor = 0;
        }
      }

      // ---- the refresh slice ----
      let rows = 0, landed = false, softLanding = false;
      p[18] = 0; p[19] = 0;
      if (remaining > 0) {
        const per = Math.ceil(N / Math.max(1, advectActive ? s.advectRefreshFrames : s.refreshFrames)) * rate;
        rows = Math.min(per, N - cursor, remaining);
        p[18] = cursor; p[19] = rows;
        remaining -= rows; cursor = (cursor + rows) % N;
        if (remaining <= 0) {
          remaining = 0; sweeps++; landed = true;
          const first = hardPending;
          if (hardPending) { hardPending = false; valid = true; }
          if (advectActive) {
            // The sweep is the map now: its windows, sun and moment (the copy is recorded after the pass, below). With a map already showing, the old one
            // is kept (copied, below) and the new one eased in over `advectBlendFrames` (the blend pass).
            softLanding = !first && s.advectBlendFrames > 0 && !!blendPipe;
            if (softLanding) {
              blend.prevWind[0] = frontWind[0]; blend.prevWind[1] = frontWind[1];
              blend.near[0] = origin.near[0]; blend.near[1] = origin.near[1]; blend.far[0] = origin.far[0]; blend.far[1] = origin.far[1];
              blend.nearCell = frontNearCell; blend.farCell = frontFarCell; blend.farOn = frontFarOn;
              blend.active = true; blend.k = 0; blend.frames = Math.max(1, Math.round(s.advectBlendFrames));
            }
            origin.near[0] = ref.near[0]; origin.near[1] = ref.near[1]; origin.far[0] = ref.far[0]; origin.far[1] = ref.far[1];
            frontNearCell = ref.nearCell; frontFarCell = ref.farCell; frontFarOn = ref.farOn;
            mapSun[0] = sweepSun[0]; mapSun[1] = sweepSun[1]; mapSun[2] = sweepSun[2];
            frontWind[0] = sweepWind[0]; frontWind[1] = sweepWind[1];
          }
        }
      }
      advShift = advectActive ? Math.hypot(W0 - frontWind[0], W1 - frontWind[1]) : 0;

      // ---- uniform ----
      // The lookup half: the map's own windows and sun, and how far the clouds have moved since its moment.
      p[0] = mapSun[0]; p[1] = mapSun[1]; p[2] = mapSun[2]; p[3] = planeY;
      p[4] = origin.near[0]; p[5] = origin.near[1]; p[6] = frontNearCell; p[7] = N;
      p[8] = origin.far[0]; p[9] = origin.far[1]; p[10] = frontFarCell; p[11] = frontFarOn ? N : 0;
      p[12] = valid ? 1 : 0;   // the last slice of a sweep runs in this submission, before the composite reads
      p[13] = BLEND_CELLS; p[14] = s.debug; p[15] = s.debugThreshold;
      p[16] = a.extinction; p[17] = a.lightDensityScale;
      p[20] = a.sky ? 1 : 0; p[21] = H; p[22] = Math.max(8, s.steps); p[23] = s.debugGain;
      p[24] = proc ? proc.shell[0] : 0; p[25] = proc ? proc.shell[1] : 0; p[26] = proc ? Math.max(8, s.proceduralSteps) : 0; p[27] = 0;
      p[28] = advectActive ? W0 - frontWind[0] : 0; p[29] = advectActive ? W1 - frontWind[1] : 0; p[30] = 0; p[31] = 0;
      // The refresh half: the sweep's windows and sun, and the clouds' move since its moment (the rows show that moment).
      const rs = advectActive ? sweepSun : mapSun;
      p[32] = rs[0]; p[33] = rs[1]; p[34] = rs[2]; p[35] = planeY;
      p[36] = ref.near[0]; p[37] = ref.near[1]; p[38] = ref.nearCell; p[39] = N;
      p[40] = ref.far[0]; p[41] = ref.far[1]; p[42] = ref.farCell; p[43] = ref.farOn ? N : 0;
      p[44] = advectActive ? W0 - sweepWind[0] : 0; p[45] = advectActive ? W1 - sweepWind[1] : 0; p[46] = 0; p[47] = 0;
      device.queue.writeBuffer(paramsBuffer, 0, p);
      if (rows > 0) {
        const sky = a.sky;
        if (groupGrid !== grid || groupWeather !== (sky?.weather ?? null) || groupParams !== (sky?.params ?? null) || groupProc !== (proc ? proc.resourceKey : null)) {
          groups[0] = groups[1] = undefined; groupGrid = grid; groupWeather = sky?.weather ?? null; groupParams = sky?.params ?? null; groupProc = proc ? proc.resourceKey : null;
        }
        const target = advectActive ? ensureBack() : views;
        const group = groups[a.gridFront] ??= device.createBindGroup({ label: `cloud shadow map refresh ${a.gridFront}`, layout: procEntry ? procEntry.layout : layout, entries: [
          { binding: SHADOW_MAP_BINDINGS.params, resource: { buffer: paramsBuffer } },
          { binding: SHADOW_MAP_BINDINGS.outNear, resource: target[0] },
          { binding: SHADOW_MAP_BINDINGS.outFar, resource: target[1] },
          ...grid.bindGroupEntries(SHADOW_MAP_BINDINGS.lightGrid, a.gridFront),
          { binding: SHADOW_MAP_BINDINGS.skyWeather, resource: (sky?.weather ?? dummyWeather).createView() },
          { binding: SHADOW_MAP_BINDINGS.skySampler, resource: sky?.sampler ?? dummySampler },
          { binding: SHADOW_MAP_BINDINGS.skyParams, resource: { buffer: sky?.params ?? dummyParams } },
          ...(proc ? proc.resourceEntries(SHADOW_MAP_BINDINGS.procedural) : []),
        ] });
        const pass = encoder.beginComputePass({ label: 'cloud shadow map', timestampWrites: a.timer?.passTimestampWrites('shadowMap') });
        pass.setPipeline(pipe!);
        pass.setBindGroup(0, a.volumeGroup);
        pass.setBindGroup(1, group);
        pass.dispatchWorkgroups(N / 8, Math.ceil(rows / 8), skyOn ? 2 : 1);
        pass.end();
        refreshes++;
        if (advectActive && landed && back) {
          if (softLanding) {
            // Keep the old map; the blend pass below writes the map from it and the new sweep.
            const pv = ensurePrev();
            encoder.copyTextureToTexture({ texture: textures[0] }, { texture: pv[0] }, [N, N]);
            encoder.copyTextureToTexture({ texture: textures[1] }, { texture: pv[1] }, [N, N]);
          } else {
            encoder.copyTextureToTexture({ texture: back[0] }, { texture: textures[0] }, [N, N]);
            encoder.copyTextureToTexture({ texture: back[1] }, { texture: textures[1] }, [N, N]);
          }
        }
      }
      if (advectActive && blend.active && back && prev && blendPipe) {
        const t = Math.min(1, blend.k / blend.frames);
        const w = (o: [number, number], cell: number, on: boolean, i: number) => { bp[i] = o[0]; bp[i + 1] = o[1]; bp[i + 2] = cell; bp[i + 3] = on ? N : 0; };
        w(blend.near, blend.nearCell, true, 0); w(origin.near, frontNearCell, true, 4);
        w(blend.far, blend.farCell, blend.farOn, 8); w(origin.far, frontFarCell, frontFarOn, 12);
        bp[16] = frontWind[0] - blend.prevWind[0]; bp[17] = frontWind[1] - blend.prevWind[1]; bp[18] = t; bp[19] = 0;
        device.queue.writeBuffer(blendParams, 0, bp);
        blendGroup ??= device.createBindGroup({ label: 'cloud shadow map blend', layout: blendLayout, entries: [
          { binding: SHADOW_BLEND_BINDINGS.params, resource: { buffer: blendParams } },
          { binding: SHADOW_BLEND_BINDINGS.prevNear, resource: prev[0].createView() }, { binding: SHADOW_BLEND_BINDINGS.prevFar, resource: prev[1].createView() },
          { binding: SHADOW_BLEND_BINDINGS.freshNear, resource: back[0].createView() }, { binding: SHADOW_BLEND_BINDINGS.freshFar, resource: back[1].createView() },
          { binding: SHADOW_BLEND_BINDINGS.outNear, resource: views[0] }, { binding: SHADOW_BLEND_BINDINGS.outFar, resource: views[1] },
        ] });
        const bpass = encoder.beginComputePass({ label: 'cloud shadow map blend' });
        bpass.setPipeline(blendPipe);
        bpass.setBindGroup(0, blendGroup);
        bpass.dispatchWorkgroups(N / 8, N / 8, 2);
        bpass.end();
        if (t >= 1) blend.active = false; else blend.k++;
      }
      return valid;
    },
    dispose() {
      disposed = true;
      textures[0].destroy(); textures[1].destroy(); paramsBuffer.destroy(); dummyWeather.destroy(); dummyParams.destroy();
      if (back) { back[0].destroy(); back[1].destroy(); }
      if (prev) { prev[0].destroy(); prev[1].destroy(); }
      blendParams.destroy();
    },
  };
}
