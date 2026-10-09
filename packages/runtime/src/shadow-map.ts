// Cloud shadow map (P10-A): a world-anchored, two-cascade map of the cloud optical depth along the sun ray, refreshed a slice per frame.
// See shaders/shadow-map.wgsl.ts for the method. This file owns the textures, the refresh schedule and the invalidation. No three imports.
import type { GpuTimer } from './gpu-timer';
import { COMMON_WGSL } from './shaders/common.wgsl';
import { SHADOW_MAP_BINDINGS, SHADOW_MAP_PARAM_BYTES, SHADOW_MAP_WGSL, cloudShadowMapWgsl } from './shaders/shadow-map.wgsl';
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
  /** Height of the ground the cascades centre on (the camera's foot point), metres. Default 0. */
  groundHeight: number;
  /** Debug view (0 off). 1: outline the shadow map's tau contour on the ground. 2: the same outline on the cloud shell's base plane (seen from below, it should trace the cloud silhouettes when the sun is high). */
  debug: 0 | 1 | 2;
  /** Tau of the debug contour. Default 0.3. */
  debugThreshold: number;
  /** Radiance of the debug outline (output units; the scene's own exposure). Default 8. */
  debugGain: number;
}

export const SHADOW_MAP_DEFAULTS: CloudShadowMapSettings = {
  enabled: true, nearExtent: 8192, farExtent: 65536, refreshFrames: 24, steps: 48, groundHeight: 0, debug: 0, debugThreshold: 0.3, debugGain: 8,
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
  timer?: GpuTimer;
}

export interface CloudShadowMap {
  readonly settings: CloudShadowMapSettings;
  /** Cascade textures (r32float, resolution x resolution, texel = tau). Bind them with `bindGroupEntries` and sample with cloudShadowMapWgsl(). */
  readonly resolution: number;
  readonly textures: readonly [GPUTexture, GPUTexture];
  readonly paramsBuffer: GPUBuffer;
  /** CPU mirror of the uniform written by the last `encode` (6 vec4, see CloudShadowMap in shadow-map.wgsl.ts). For adapters that sample the map outside WGSL bindings. */
  readonly params: Readonly<Float32Array>;
  /** Layout entries / bind group entries for cloudShadowMapWgsl(group, binding): uniform at `binding`, near cascade at +1, far at +2. */
  bindGroupLayoutEntries(binding: number, visibility: number): GPUBindGroupLayoutEntry[];
  bindGroupEntries(binding: number): GPUBindGroupEntry[];
  /** State for tooling. `valid`: a complete refresh has landed, so the composite reads the map. */
  readonly info: { valid: boolean; remainingRows: number; refreshes: number; sweeps: number; nearOrigin: [number, number]; farOrigin: [number, number]; bytes: number };
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
  const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC;
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

  const layout = device.createBindGroupLayout({ label: 'cloud shadow map refresh', entries: [
    { binding: SHADOW_MAP_BINDINGS.params, visibility: C, buffer: { type: 'uniform' } },
    { binding: SHADOW_MAP_BINDINGS.outNear, visibility: C, storageTexture: { access: 'write-only', format: 'r32float' } },
    { binding: SHADOW_MAP_BINDINGS.outFar, visibility: C, storageTexture: { access: 'write-only', format: 'r32float' } },
    { binding: SHADOW_MAP_BINDINGS.lightGrid, visibility: C, texture: { sampleType: 'float', viewDimension: '3d' } },
    { binding: SHADOW_MAP_BINDINGS.lightGrid + 1, visibility: C, sampler: { type: 'filtering' } },
    { binding: SHADOW_MAP_BINDINGS.skyWeather, visibility: C, texture: { sampleType: 'float' } },
    { binding: SHADOW_MAP_BINDINGS.skySampler, visibility: C, sampler: { type: 'filtering' } },
    { binding: SHADOW_MAP_BINDINGS.skyParams, visibility: C, buffer: { type: 'uniform' } },
  ] });
  let pipeline: GPUComputePipeline | null = null;
  void device.createComputePipelineAsync({
    label: 'cloud shadow map refresh',
    layout: device.createPipelineLayout({ bindGroupLayouts: [volumeLayout, layout] }),
    compute: { module: device.createShaderModule({ label: 'cloud shadow map refresh', code: COMMON_WGSL + volumeWgsl(0) + SHADOW_MAP_WGSL }), entryPoint: 'main' },
  }).then(pl => { pipeline = pl; }, e => { console.error('cloud shadow map pipeline failed', e); });

  let disposed = false;
  let valid = false;          // a complete refresh has landed
  let remaining = N;          // rows left in the current sweep; 0 = idle
  let cursor = 0;             // next row
  let hardPending = true;     // the current sweep must finish before the map is offered
  let refreshes = 0, sweeps = 0;
  const origin = { near: [0, 0] as [number, number], far: [0, 0] as [number, number], placed: false };
  const mapSun = new Float64Array([0, 1, 0]);   // the sun the rows are built with (lookups use it too)
  let lastGrid: unknown = null, lastWeather: GPUTexture | null = null, lastSkyKey: readonly number[] = [];
  let lastBox = new Float64Array(6);
  let lastScalars = [NaN, NaN, NaN, NaN, NaN];
  const groups: (GPUBindGroup | undefined)[] = [undefined, undefined];
  let groupGrid: unknown = null, groupWeather: GPUTexture | null = null, groupParams: GPUBuffer | null = null;

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
      return { valid, remainingRows: remaining, refreshes, sweeps, nearOrigin: [origin.near[0], origin.near[1]] as [number, number], farOrigin: [origin.far[0], origin.far[1]] as [number, number], bytes: 2 * N * N * 4 };
    },
    invalidate(hard = false) {
      remaining = N;
      if (hard) { hardPending = true; valid = false; }
    },
    encode(encoder, a) {
      const s = settings;
      const sun = a.sunDirection;
      const off = !s.enabled || disposed || a.shadowStrength <= 0 || sun[1] <= MIN_SUN_Y || !pipeline;
      const planeY = a.box.minCorner[1], H = a.box.extent[1];
      if (off) {
        // Offered nothing; when it comes back on, the whole map is rebuilt first.
        valid = false; hardPending = true; remaining = N; lastGrid = null; origin.placed = false;
        p[12] = 0;
        device.queue.writeBuffer(paramsBuffer, 0, p);
        return false;
      }

      const skyOn = !!a.sky;
      // ---- invalidation ----
      const grid = a.lightGrid;
      let hard = false, stale = false;
      if (grid !== lastGrid) { hard = true; lastGrid = grid; }
      if ((skyOn ? 1 : 0) !== (lastWeather ? 1 : 0)) { hard = true; }
      if ((a.sky?.weather ?? null) !== lastWeather) { stale = true; lastWeather = a.sky?.weather ?? null; }
      const sk = a.sky?.key ?? [];
      if (sk.length !== lastSkyKey.length || sk.some((v, i) => v !== lastSkyKey[i])) { stale = true; lastSkyKey = sk; }
      const scalars = [a.extinction, a.lightDensityScale, s.steps, s.nearExtent, s.farExtent];
      if (scalars.some((v, i) => v !== lastScalars[i])) { stale = true; lastScalars = scalars; }
      const bx = [a.box.minCorner[0], a.box.minCorner[1], a.box.minCorner[2], a.box.extent[0], a.box.extent[1], a.box.extent[2]];
      for (let i = 0; i < 6; i++) if (bx[i] !== lastBox[i]) { stale = true; if (i === 1 || i >= 3) hard = true; lastBox[i] = bx[i]; }
      if (a.gridSwapped) stale = true;
      // Sun: the plane displacement at the shell top between the sun the rows were built with and the current one.
      const [ax, az] = projected(sun), [bxx, bz] = projected(mapSun);
      const move = Math.hypot(ax - bxx, az - bz) * H;
      let rate = 1;
      if (move > SUN_STALE_M) { stale = true; mapSun[0] = sun[0]; mapSun[1] = sun[1]; mapSun[2] = sun[2]; }
      if (move > SUN_JUMP_M) rate = 2;
      if (!origin.placed) { hard = true; stale = true; mapSun[0] = sun[0]; mapSun[1] = sun[1]; mapSun[2] = sun[2]; rate = 2; }
      if (hard) { hardPending = true; valid = false; rate = 2; }

      // ---- placement: the cascades follow the camera's foot point, projected onto the map plane along the sun ----
      const sy = Math.max(mapSun[1], MIN_SUN_Y);
      const dy = planeY - s.groundHeight;
      const fx = a.cameraPosition[0] + (mapSun[0] / sy) * dy, fz = a.cameraPosition[2] + (mapSun[2] / sy) * dy;
      const place = (extent: number, cur: [number, number]) => {
        const cell = extent / N, snap = N / 16;
        const cx = fx / cell, cz = fz / cell;
        const keep = origin.placed && Math.abs(cx - (cur[0] + N / 2)) < N / 8 && Math.abs(cz - (cur[1] + N / 2)) < N / 8;
        if (keep) return { cell, moved: false };
        cur[0] = Math.round((cx - N / 2) / snap) * snap; cur[1] = Math.round((cz - N / 2) / snap) * snap;
        return { cell, moved: true };
      };
      const near = place(s.nearExtent, origin.near);
      const far = skyOn ? place(s.farExtent, origin.far) : { cell: s.farExtent / N, moved: false };
      origin.placed = true;
      if (near.moved || far.moved) stale = true;
      if (stale) remaining = N;

      // ---- uniform ----
      p[0] = mapSun[0]; p[1] = mapSun[1]; p[2] = mapSun[2]; p[3] = planeY;
      p[4] = origin.near[0]; p[5] = origin.near[1]; p[6] = near.cell; p[7] = N;
      p[8] = origin.far[0]; p[9] = origin.far[1]; p[10] = far.cell; p[11] = skyOn ? N : 0;
      p[13] = BLEND_CELLS; p[14] = s.debug; p[15] = s.debugThreshold;
      p[16] = a.extinction; p[17] = a.lightDensityScale;
      p[20] = skyOn ? 1 : 0; p[21] = H; p[22] = Math.max(8, s.steps); p[23] = s.debugGain;

      // ---- the refresh slice ----
      let rows = 0;
      if (remaining > 0) {
        const per = Math.ceil(N / Math.max(1, s.refreshFrames)) * rate;
        rows = Math.min(per, N - cursor, remaining);
        p[18] = cursor; p[19] = rows;
        remaining -= rows; cursor = (cursor + rows) % N;
        if (remaining <= 0) { remaining = 0; sweeps++; if (hardPending) { hardPending = false; valid = true; } }
      } else { p[18] = 0; p[19] = 0; }
      p[12] = valid ? 1 : 0;   // the last slice of a sweep runs in this submission, before the composite reads
      device.queue.writeBuffer(paramsBuffer, 0, p);
      if (rows > 0) {
        const sky = a.sky;
        if (groupGrid !== grid || groupWeather !== (sky?.weather ?? null) || groupParams !== (sky?.params ?? null)) {
          groups[0] = groups[1] = undefined; groupGrid = grid; groupWeather = sky?.weather ?? null; groupParams = sky?.params ?? null;
        }
        const group = groups[a.gridFront] ??= device.createBindGroup({ label: `cloud shadow map refresh ${a.gridFront}`, layout, entries: [
          { binding: SHADOW_MAP_BINDINGS.params, resource: { buffer: paramsBuffer } },
          { binding: SHADOW_MAP_BINDINGS.outNear, resource: views[0] },
          { binding: SHADOW_MAP_BINDINGS.outFar, resource: views[1] },
          ...grid.bindGroupEntries(SHADOW_MAP_BINDINGS.lightGrid, a.gridFront),
          { binding: SHADOW_MAP_BINDINGS.skyWeather, resource: (sky?.weather ?? dummyWeather).createView() },
          { binding: SHADOW_MAP_BINDINGS.skySampler, resource: sky?.sampler ?? dummySampler },
          { binding: SHADOW_MAP_BINDINGS.skyParams, resource: { buffer: sky?.params ?? dummyParams } },
        ] });
        const pass = encoder.beginComputePass({ label: 'cloud shadow map', timestampWrites: a.timer?.passTimestampWrites('shadowMap') });
        pass.setPipeline(pipeline!);
        pass.setBindGroup(0, a.volumeGroup);
        pass.setBindGroup(1, group);
        pass.dispatchWorkgroups(N / 8, Math.ceil(rows / 8), skyOn ? 2 : 1);
        pass.end();
        refreshes++;
      }
      return valid;
    },
    dispose() {
      disposed = true;
      textures[0].destroy(); textures[1].destroy(); paramsBuffer.destroy(); dummyWeather.destroy(); dummyParams.destroy();
    },
  };
}
