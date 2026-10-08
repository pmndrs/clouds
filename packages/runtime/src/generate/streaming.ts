// Camera-centred streaming cloudscape window. Renderer-agnostic (no three imports): the caller shows `current` with its own setVolume.
//
// Two generators (A, B) alternate: one is displayed while the other regenerates, amortized over frames (`jobsPerFrame` small jobs
// each frame), at a new world origin chosen where the camera is heading. Both are on the same lattice (origins are multiples of
// the voxel size) and the weather and the shape noise are procedural in world coordinates, so the part of the new window that
// overlaps the old one is the same field: swapping moves the box without changing what is inside it. They share one scratch
// (the u16 distance field, 33.6 MB at 512 x 512 x 64; the old jump-flood seeds took about 300 MB); only one generator runs at a time.
import type { GpuCloudVolume } from '../resources';
import { CLOUD_PRESETS, type CloudPreset, type CloudPresetName } from './presets';
import { createGeneratorScratch, createVolumeGenerator, type GeneratorScratch, type NvdfParams, type VolumeGenerator } from './volume-generator';
import { encodeProceduralWeatherMap, type ProceduralWeatherOptions } from './weather';

export interface StreamingCloudscapeOptions {
  /** A preset name or a preset object. Default 'cumulus'. */
  preset?: CloudPresetName | CloudPreset;
  /** Volume dims (x, map row, up). Default [512, 512, 64]. */
  dims?: [number, number, number];
  /** Metres per voxel. Default 8. */
  voxelSize?: number;
  /** Regenerate when the camera is further than this (metres, horizontal) from the displayed window's centre. Default a quarter of the window. */
  threshold?: number;
  /** Generation jobs encoded per frame. Each job is small (about 0.4 ms GPU on average, 0.8 ms worst at 512 x 512 x 64). Default 2. */
  jobsPerFrame?: number;
  /** z slices per job. Default 4. */
  sliceDepth?: number;
  seed?: number;
  /** World extent (metres) that the weather presets' uv [0, 1] spans. The presets are tuned for 4096 m (512 voxels of 8 m). Default 4096. */
  weatherExtent?: number;
  /** Fade of coverage to zero at the window border (fraction of the window); 0 gives an exactly seamless overlap but clouds are cut at the window edge. Default 0. */
  border?: number;
  /** Extra overrides for the weather map and the NVDF params. */
  weather?: Partial<ProceduralWeatherOptions>;
  params?: Partial<NvdfParams>;
  /** Aim the next window this many seconds ahead of the camera along its velocity. Default: the measured duration of the previous generation, clamped to 0..4 s. */
  lookahead?: number;
}

export interface StreamingUpdate {
  /** True on the frame the displayed window changed; call your renderer's setVolume(volume, { position }) when this is set. */
  swapped: boolean;
  /** The window to show. Caller-owned view: do not destroy it; the streamer keeps it alive until a later swap replaces it. */
  volume: GpuCloudVolume;
  /** World position of the window's base centre (x, base y = 0, z). The caller adds its base height. */
  centre: [number, number];
  /** True while the other window is being generated. */
  generating: boolean;
}

export interface StreamingStats {
  windows: number;
  /** Per completed generation: frames it took, CPU ms spent encoding and submitting it (sum), wall ms from start to done. */
  generations: { frames: number; encodeMs: number; wallMs: number; origin: [number, number]; centre: [number, number] }[];
  worstEncodeMs: number;
}

export interface StreamingMemory {
  /** The two windows' nvdf + sdf textures (steady, shown and being built). */
  windows: number;
  /** The shared generation scratch (the peak scratch, allocated for the whole session). */
  scratch: number;
  /** Weather maps (rgba8unorm, one per window) and generator parameter buffers. */
  other: number;
  total: number;
}

export interface StreamingCloudscape {
  readonly extent: [number, number];
  readonly stats: StreamingStats;
  readonly generating: boolean;
  readonly current: StreamingUpdate;
  /** GPU memory held by the streamer in bytes: the two windows' volumes, the shared scratch (peak extra while generating), per-window weather maps and parameter buffers. */
  readonly memoryBytes: StreamingMemory;
  /**
   * Generate a window completely and show it (a one-time stall of about 50 ms GPU) around the camera. Await before the first update;
   * also usable to jump (teleport), it drops any generation in flight. Show the result with your renderer's setVolume.
   */
  start(cameraX: number, cameraZ: number): Promise<StreamingUpdate>;
  /**
   * Call once per frame with the camera's world x/z: encodes and submits this frame's generation jobs, starts a new window when due.
   * `dt` (seconds) defaults to wall time since the previous call; pass it when stepping a simulation faster or slower than real time.
   */
  update(cameraX: number, cameraZ: number, dt?: number): StreamingUpdate;
  /** Start generating a window around (x, z) now, regardless of the threshold (ignored while a generation is in flight). */
  requestWindow(x: number, z: number): void;
  destroy(): void;
}

export function createStreamingCloudscape(device: GPUDevice, options: StreamingCloudscapeOptions = {}): StreamingCloudscape {
  const dims = options.dims ?? [512, 512, 64];
  const voxel = options.voxelSize ?? 8;
  const preset: CloudPreset = typeof options.preset === 'object' ? options.preset : CLOUD_PRESETS[options.preset ?? 'cumulus'];
  const extent: [number, number] = [dims[0] * voxel, dims[1] * voxel];
  const threshold = options.threshold ?? Math.min(extent[0], extent[1]) / 4;
  const jobsPerFrame = options.jobsPerFrame ?? 2;
  const seed = options.seed ?? 1;
  const refExtent = options.weatherExtent ?? 4096;
  const scratch: GeneratorScratch = createGeneratorScratch(device, dims, 'streaming scratch');
  const stats: StreamingStats = { windows: 0, generations: [], worstEncodeMs: 0 };

  // Window origin for a centre: snapped onto the voxel lattice so every window samples the same world grid.
  const originFor = (cx: number, cz: number): [number, number] => [Math.round((cx - extent[0] / 2) / voxel) * voxel, Math.round((cz - extent[1] / 2) / voxel) * voxel];
  const centreOf = (o: [number, number]): [number, number] => [o[0] + extent[0] / 2, o[1] + extent[1] / 2];
  const weatherFor = (origin: [number, number]) => {
    const encoder = device.createCommandEncoder({ label: 'streaming weather' });
    const tex = encodeProceduralWeatherMap(device, encoder, {
      ...preset.weather, border: options.border ?? 0, ...options.weather, size: [dims[0], dims[1]], seed,
      window: { origin: [origin[0] / refExtent, origin[1] / refExtent], size: [extent[0] / refExtent, extent[1] / refExtent] },
    });
    device.queue.submit([encoder.finish()]);
    return tex;
  };

  interface Slot { gen: VolumeGenerator | null; weather: GPUTexture | null }
  const slots: [Slot, Slot] = [{ gen: null, weather: null }, { gen: null, weather: null }];
  let shown = -1;                       // index of the displayed slot
  let building = -1;                    // index of the slot being generated, or -1
  let buildStart = 0, buildFrames = 0, buildEncodeMs = 0, buildWall = 0;
  let lastGenSeconds = 1;
  let clock = 0;                        // seconds, advanced by update()'s dt
  let lastWall = 0;
  let prev: { x: number; z: number } | null = null;
  let vx = 0, vz = 0;
  let destroyed = false;

  const ensureGen = (i: number, origin: [number, number]) => {
    const slot = slots[i];
    const weather = weatherFor(origin);
    if (!slot.gen) {
      slot.gen = createVolumeGenerator(device, {
        dims, voxelSize: voxel, weather, origin, scratch, sliceDepth: options.sliceDepth ?? 4,
        params: { ...preset.params, seed, ...options.params }, label: `streaming window ${i}`,
      });
    } else {
      slot.gen.restart({ weather, origin });
    }
    slot.weather?.destroy();            // the previous map is no longer read (that generation finished)
    slot.weather = weather;
  };
  const snapshot = (swapped: boolean): StreamingUpdate => {
    const g = slots[shown].gen!;
    return { swapped, volume: g.volume, centre: centreOf([g.origin[0], g.origin[1]]), generating: building >= 0 };
  };

  const encodeJobs = (maxJobs: number) => {
    const g = slots[building].gen!;
    const t0 = performance.now();
    const encoder = device.createCommandEncoder({ label: 'cloud generation' });
    g.generate(encoder, maxJobs);
    device.queue.submit([encoder.finish()]);
    const ms = performance.now() - t0;
    buildEncodeMs += ms; buildFrames++;
    stats.worstEncodeMs = Math.max(stats.worstEncodeMs, ms);
    return g.done;
  };

  const api: StreamingCloudscape = {
    extent, stats,
    get generating() { return building >= 0; },
    get current() { return snapshot(false); },
    get memoryBytes() {
      const ms = slots.map(s => s.gen?.memoryBytes);
      const windows = ms.reduce((a, m) => a + (m ? m.nvdf + m.sdf : 0), 0);
      const other = ms.reduce((a, m) => a + (m ? m.params : 0), 0) + slots.reduce((a, s) => a + (s.weather ? dims[0] * dims[1] * 4 : 0), 0);
      return { windows, scratch: scratch.bytes, other, total: windows + scratch.bytes + other };
    },
    async start(cx, cz) {
      building = -1;                                    // drop any generation in flight
      const i = shown < 0 ? 0 : 1 - shown;
      ensureGen(i, originFor(cx, cz));
      building = i;
      encodeJobs(Infinity);
      await device.queue.onSubmittedWorkDone();
      shown = i; building = -1; stats.windows++;
      buildFrames = 0; buildEncodeMs = 0;
      prev = { x: cx, z: cz }; vx = 0; vz = 0;
      return snapshot(true);
    },
    requestWindow(x, z) {
      if (building >= 0 || shown < 0) return;
      building = 1 - shown;
      ensureGen(building, originFor(x, z));
      buildStart = clock; buildWall = performance.now(); buildFrames = 0; buildEncodeMs = 0;
      encodeJobs(jobsPerFrame);
    },
    update(cx, cz, dtSeconds) {
      if (destroyed || shown < 0) throw new Error('call start() first');
      const wall = performance.now();
      const dt = dtSeconds ?? Math.min(0.25, (wall - lastWall) / 1000);
      lastWall = wall;
      clock += dt;
      if (prev && dt > 1e-4) {
        const k = Math.min(1, dt / 0.25);               // smooth the velocity over about a quarter second
        vx += ((cx - prev.x) / dt - vx) * k; vz += ((cz - prev.z) / dt - vz) * k;
      }
      prev = { x: cx, z: cz };
      let swapped = false;
      if (building >= 0) {
        if (encodeJobs(jobsPerFrame)) {
          lastGenSeconds = clock - buildStart;
          const g = slots[building].gen!;
          stats.generations.push({ frames: buildFrames, encodeMs: buildEncodeMs, wallMs: wall - buildWall, origin: [g.origin[0], g.origin[1]], centre: centreOf([g.origin[0], g.origin[1]]) });
          shown = building; building = -1; stats.windows++; swapped = true;
        }
      } else {
        const c = centreOf([slots[shown].gen!.origin[0], slots[shown].gen!.origin[1]]);
        if (Math.hypot(cx - c[0], cz - c[1]) > threshold) {
          const lead = options.lookahead ?? Math.min(4, Math.max(0, lastGenSeconds));
          // Aim where the camera will be when this generation finishes, but never so far that the camera would leave the new window.
          let ax = vx * lead, az = vz * lead;
          const reach = Math.min(extent[0], extent[1]) * 0.3, m = Math.hypot(ax, az);
          if (m > reach) { ax *= reach / m; az *= reach / m; }
          api.requestWindow(cx + ax, cz + az);
        }
      }
      return snapshot(swapped);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const s of slots) { s.gen?.destroy(); s.weather?.destroy(); }
      scratch.destroy();
    },
  };
  return api;
}
