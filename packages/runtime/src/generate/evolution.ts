// Realtime cloud evolution: a cumulus field that forms, drifts, merges and dissipates over minutes at a small, steady cost.
// Renderer-agnostic (no three imports): the caller shows `volume` with its own swapVolume/setVolume and keeps the box at `position + offset`.
//
// How it works
//   - The weather map is a function of time (weather.ts `evolve`): every Worley cell has a life cycle (grow, mature, dissipate, restart elsewhere),
//     the pattern is advected by the wind, the fBm layer drifts.
//   - The NVDF + exact SDF are regenerated from that map every `cadence` seconds of real time, amortized over `cadence * generationShare`
//     seconds in small jobs (the same ~0.3 ms jobs as the streaming window), into the back one of two volumes. The renderer reads the front
//     volume, which is always a complete field; the back one is swapped in when all its jobs are done.
//   - No pop at a swap: (1) a generation differs from the previous one by only `cadence * timeScale` seconds of life cycle (a few percent of a
//     cell's growth); (2) advection is not baked into the swap: the pattern is generated at a voxel-snapped wind offset A (the billow noise is
//     anchored to it too), and the box is translated by the remainder `wind * t - A` every frame (`offset`), so the clouds move smoothly and the
//     swap never jumps them; (3) the content is generated for the time the swap is expected to happen, not the time it started.
import type { GpuCloudVolume } from '../resources';
import { CLOUD_PRESETS, type CloudPreset, type CloudPresetName } from './presets';
import { createGeneratorScratch, createVolumeGenerator, type GeneratorScratch, type StormCellState, type VolumeGenerator } from './generator';
import { NVDF_DEFAULTS, type NvdfParams } from './volume-generator';
import { encodeProceduralWeatherMap, type ProceduralWeatherOptions, type StormCellOptions } from './weather';

export interface EvolvingCloudscapeOptions {
  /** A preset name or a preset object. Default 'cumulus'. */
  preset?: CloudPresetName | CloudPreset;
  /** Volume dims (x, map row, up). Default [512, 512, 64]. */
  dims?: [number, number, number];
  /** Metres per voxel. Default 8. */
  voxelSize?: number;
  seed?: number;
  /** World extent (metres) that the weather presets' uv [0, 1] spans. Default 4096. */
  weatherExtent?: number;
  /** Fade of coverage to zero at the box border (fraction of the box). Default 0.06. */
  border?: number;
  /** Mean cumulus life cycle in simulated seconds (cells vary 0.6x..1.4x). Default 600 (10 min); realistic range 300..1200. */
  lifeSeconds?: number;
  /** Wind in metres per simulated second along world x and z. Default [2, 1]. */
  wind?: [number, number];
  /** Drift of the fBm layer, fBm-domain units per simulated second (the domain spans `scale` units across the box). Default [0.0012, -0.0008]. */
  drift?: [number, number];
  /** Real seconds between the starts of two generations. The change per swap is `cadence * timeScale` seconds of life cycle, so shorter is smoother; the generation GPU cost per frame is about 20 ms / (cadence * fps). Default 1.5. */
  cadence?: number;
  /** Fraction of `cadence` over which the jobs of one generation are spread. Default 0.8. */
  generationShare?: number;
  /** z slices per job. Default 4. */
  sliceDepth?: number;
  weather?: Partial<ProceduralWeatherOptions>;
  /**
   * A cumulonimbus life cycle on top of the field (P6-B timing, P6-C shape): one cell grows from cumulus through congestus to a tall tower with a spreading
   * anvil over `storm.growSeconds` (default 120 s of simulated time) while the surrounding field keeps evolving. The cell is a 3D field in the generator
   * (overhanging anvil, turrets); its centre is in the pattern frame, in map uv, and it is carried by the wind. The NVDF stage then reads base/top from the
   * weather map (`useMapHeights`) for the whole field; use the 'storm' preset and a taller volume (about 2 km, e.g. dims [256, 256, 128] at 16 m). Its time
   * is `start`-relative: pass a negative `start` to begin with a young cell.
   */
  storm?: StormCellOptions;
  params?: Partial<NvdfParams>;
  /** Called once per generation job pass with the stage name, to attach timestamp queries (measuring the generation's GPU cost). */
  timestamps?: (label: string) => GPUComputePassTimestampWrites | undefined;
}

export interface EvolveUpdate {
  /** True on the frame the front volume changed: call swapVolume(volume, ...) (or setVolume the first time). */
  swapped: boolean;
  /** The complete volume to show. Owned by the cloudscape: do not destroy. */
  volume: GpuCloudVolume;
  /** Add to the box's base position (x, z, metres) every frame: the remainder of the wind advection since the shown generation's snapped offset. */
  offset: [number, number];
  /** The voxel-snapped wind advection (metres) baked into the shown volume; `offset` = wind * simTime - advection. Recompute `offset` yourself on frames where you do not call update(). */
  advection: [number, number];
  /** Simulated time (s) the shown volume was generated for. */
  contentTime: number;
  generating: boolean;
}

export interface EvolveStats {
  swaps: number;
  /** Per completed generation: frames it spanned, CPU ms encoding + submitting it, jobs, simulated time it was generated for. */
  generations: { frames: number; encodeMs: number; jobs: number; contentTime: number }[];
  worstEncodeMs: number;
}

export interface EvolvingCloudscape {
  readonly stats: EvolveStats;
  readonly generating: boolean;
  readonly dims: [number, number, number];
  readonly voxelSize: number;
  /** Total GPU memory: two volumes, the shared scratch, weather maps. */
  readonly memoryBytes: number;
  /** Generate for `simTime` completely and show it (a one-time stall of about 20 ms GPU). Await before update(). Also usable to jump in time. */
  start(simTime: number): Promise<EvolveUpdate>;
  /** Call once per frame: `simTime` is the simulated clock, `dt` the real frame time in seconds. Encodes this frame's jobs and swaps when due. */
  update(simTime: number, dt: number): EvolveUpdate;
  destroy(): void;
}

export function createEvolvingCloudscape(device: GPUDevice, options: EvolvingCloudscapeOptions = {}): EvolvingCloudscape {
  const dims = options.dims ?? [512, 512, 64];
  const voxel = options.voxelSize ?? 8;
  const preset: CloudPreset = typeof options.preset === 'object' ? options.preset : CLOUD_PRESETS[options.preset ?? 'cumulus'];
  const seed = options.seed ?? 1;
  const ref = options.weatherExtent ?? 4096;
  const life = options.lifeSeconds ?? 600;
  const wind = options.wind ?? [2, 1];
  const drift = options.drift ?? [0.0012, -0.0008];
  const cadence = Math.max(0.2, options.cadence ?? 1.5);
  const genSeconds = cadence * Math.min(0.95, Math.max(0.05, options.generationShare ?? 0.8));
  const nvdfParams: Partial<NvdfParams> & { coverageThreshold: number } = {
    ...preset.params, seed, ...(options.storm ? { useMapHeights: true } : {}), ...options.params,
    coverageThreshold: options.params?.coverageThreshold ?? preset.params.coverageThreshold ?? NVDF_DEFAULTS.coverageThreshold,
  };
  const scratch: GeneratorScratch = createGeneratorScratch(device, dims, 'evolution scratch');
  const stats: EvolveStats = { swaps: 0, generations: [], worstEncodeMs: 0 };

  interface Slot { gen: VolumeGenerator | null; weather: GPUTexture | null; adv: [number, number]; time: number }
  const slots: [Slot, Slot] = [{ gen: null, weather: null, adv: [0, 0], time: 0 }, { gen: null, weather: null, adv: [0, 0], time: 0 }];
  let shown = -1, building = -1;
  let clock = 0, lastStart = 0, budget = 0, frames = 0, encodeMs = 0;
  let lastSim = NaN, simRate = 0;
  let destroyed = false;

  const snapped = (t: number): [number, number] => [Math.round(wind[0] * t / voxel) * voxel, Math.round(wind[1] * t / voxel) * voxel];
  // The cell in the generator's metres: the pattern frame (uv * extent) is the generator's pm space, so the wind carries it with the field.
  const stormAt = (time: number): StormCellState | null => {
    const st = options.storm;
    if (!st) return null;
    const c = st.center ?? [0.5, 0.5], volH = dims[2] * voxel;
    return {
      center: [c[0] * ref, c[1] * ref], phase: (time - (st.start ?? 0)) / Math.max(1, st.growSeconds ?? 120),
      towerRadius: st.towerRadius ?? 520, towerHeight: st.towerHeight ?? 0.85 * volH, anvilRadius: st.anvilRadius ?? 1500, baseHeight: st.baseHeight, shear: st.shear,
    };
  };
  const prepare = (i: number, time: number) => {
    const slot = slots[i];
    const adv = snapped(time);
    const storm = stormAt(time);
    const encoder = device.createCommandEncoder({ label: 'evolution weather' });
    const weather = encodeProceduralWeatherMap(device, encoder, {
      ...preset.weather, border: options.border ?? 0.06, ...options.weather, size: [dims[0], dims[1]], seed,
      evolve: { time, lifeSeconds: life, advection: [adv[0] / ref, adv[1] / ref], drift },
      extentMeters: ref, heightMeters: dims[2] * voxel, storm: !!options.storm,
      window: { origin: [0, 0], size: [dims[0] * voxel / ref, dims[1] * voxel / ref] },
    });
    device.queue.submit([encoder.finish()]);
    const origin: [number, number] = [-adv[0], -adv[1]];
    if (!slot.gen) {
      slot.gen = createVolumeGenerator(device, {
        dims, voxelSize: voxel, weather, origin, scratch, sliceDepth: options.sliceDepth ?? 4, storm: storm ?? undefined,
        params: nvdfParams, label: `evolution volume ${i}`, timestamps: options.timestamps,
      });
    } else slot.gen.restart({ weather, origin, storm });
    slot.weather?.destroy();
    slot.weather = weather;
    slot.adv = adv; slot.time = time;
  };
  const encodeJobs = (maxJobs: number) => {
    const g = slots[building].gen!;
    const t0 = performance.now();
    const encoder = device.createCommandEncoder({ label: 'cloud evolution' });
    const r = g.generate(encoder, maxJobs);
    device.queue.submit([encoder.finish()]);
    const ms = performance.now() - t0;
    encodeMs += ms; frames++;
    stats.worstEncodeMs = Math.max(stats.worstEncodeMs, ms);
    return r;
  };
  const snapshot = (simTime: number, swapped: boolean): EvolveUpdate => {
    const s = slots[shown];
    return {
      swapped, volume: s.gen!.volume, contentTime: s.time, generating: building >= 0,
      offset: [wind[0] * simTime - s.adv[0], wind[1] * simTime - s.adv[1]], advection: [s.adv[0], s.adv[1]],
    };
  };

  return {
    stats, dims, voxelSize: voxel,
    get generating() { return building >= 0; },
    get memoryBytes() {
      const g = slots.map(s => s.gen?.memoryBytes);
      return g.reduce((a, m) => a + (m ? m.nvdf + m.sdf + m.params : 0), 0) + scratch.bytes + slots.reduce((a, s) => a + (s.weather ? dims[0] * dims[1] * 4 : 0), 0);
    },
    async start(simTime) {
      building = -1;
      const i = shown < 0 ? 0 : 1 - shown;
      prepare(i, simTime);
      building = i;
      encodeJobs(Infinity);
      await device.queue.onSubmittedWorkDone();
      shown = i; building = -1; stats.swaps++;
      lastStart = clock; budget = 0; frames = 0; encodeMs = 0; lastSim = simTime;
      return snapshot(simTime, true);
    },
    update(simTime, dt) {
      if (destroyed || shown < 0) throw new Error('call start() first');
      clock += dt;
      if (dt > 1e-5 && Number.isFinite(lastSim)) simRate += ((simTime - lastSim) / dt - simRate) * Math.min(1, dt / 0.5);
      lastSim = simTime;
      let swapped = false;
      if (building < 0 && clock - lastStart >= cadence) {
        building = 1 - shown;
        prepare(building, simTime + simRate * genSeconds);   // the field as it will be when the swap happens
        lastStart = clock; budget = 0; frames = 0; encodeMs = 0;
      }
      if (building >= 0) {
        const g = slots[building].gen!;
        budget += dt / genSeconds * g.jobsTotal;
        const n = Math.floor(budget);
        if (n > 0) {
          budget -= n;
          const r = encodeJobs(n);
          if (r.done) {
            stats.generations.push({ frames, encodeMs, jobs: g.jobsTotal, contentTime: slots[building].time });
            shown = building; building = -1; stats.swaps++; swapped = true;
          }
        }
      }
      return snapshot(simTime, swapped);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const s of slots) { s.gen?.destroy(); s.weather?.destroy(); }
      scratch.destroy();
    },
  };
}
