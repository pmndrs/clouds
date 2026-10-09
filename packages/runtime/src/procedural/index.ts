// X1 procedural density model (a parallel `densityModel`, a stopgap next to the NVDF path; see work/reports/X1.md).
//
//   const proc = createProceduralClouds(device, { shaper: 'takram' });   // or 'skypro'
//   await proc.load({ skyproNoise: url });                         // or { takram: { shape, shapeDetail, localWeather, turbulence } }
//   runtime.setProceduralModel(proc); runtime.settings.densityModel = 'procedural';
//   runtime.setVolume(proceduralPlaceholderVolume(), { position });  // the runtime still wants a (tiny, empty) volume bound
//
// Not exported from the core entry (the core stays under its bundle budget): pages import it from here.
import type { CloudVolumeAsset } from '../assets';
import { COMMON_WGSL } from '../shaders/common.wgsl';
import { volumeWgsl } from '../shaders/volume.wgsl';
import { defaultProceduralSettings, packProceduralParams, PROC_PARAM_BYTES, PROC_PARAM_FLOATS, type ProceduralSettings, type ProceduralShaper } from './settings';
import { bakeSkyProWeather, loadSkyProNoise, loadTakramTextures, skyProWeatherKey, type SkyProWeather, type TakramTextures, type TakramTextureUrls } from './textures';
import { PROC_BINDINGS, proceduralTraceWgsl } from './trace.wgsl';
import type { ProceduralDensityModel } from './types';

export * from './settings';
export type { ProceduralDensityModel } from './types';
export { PROC_BINDINGS, proceduralTraceWgsl } from './trace.wgsl';

export interface ProceduralClouds extends ProceduralDensityModel {
  readonly settings: ProceduralSettings;
  /** Load the textures of one or both shapers. */
  load(urls: { skyproNoise?: string; takram?: TakramTextureUrls }): Promise<void>;
}

export function createProceduralClouds(device: GPUDevice, options: { shaper?: ProceduralShaper } = {}): ProceduralClouds {
  const settings = defaultProceduralSettings(options.shaper ?? 'takram');
  const params = new Float32Array(PROC_PARAM_FLOATS);
  const prev = new Float32Array(PROC_PARAM_FLOATS);
  const buffer = device.createBuffer({ label: 'proc params', size: PROC_PARAM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const sampler = device.createSampler({ label: 'proc repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat' });
  const usage = GPUTextureUsage.TEXTURE_BINDING;
  const dummy3d = device.createTexture({ label: 'proc dummy 3d', dimension: '3d', size: [1, 1, 1], format: 'rgba8unorm', usage });
  let skyproNoise: GPUTexture | null = null;
  let skyproWeather: SkyProWeather | null = null;
  let takram: TakramTextures | null = null;
  let version = 0, resourceKey: object = {}, lastShaper: ProceduralShaper | null = null;
  const C = GPUShaderStage.COMPUTE;
  const B = PROC_BINDINGS;
  const layoutEntries: GPUBindGroupLayoutEntry[] = [
    { binding: B.params, visibility: C, buffer: { type: 'uniform' } },
    { binding: B.noiseA, visibility: C, texture: { sampleType: 'float', viewDimension: '3d' } },
    { binding: B.noiseB, visibility: C, texture: { sampleType: 'float', viewDimension: '3d' } },
    { binding: B.weather, visibility: C, texture: { sampleType: 'float' } },
    { binding: B.aux, visibility: C, texture: { sampleType: 'float' } },
    { binding: B.sampler, visibility: C, sampler: { type: 'filtering' } },
  ];
  const haveShaper = () => (settings.shaper === 'skypro' ? !!skyproNoise : !!takram);

  return {
    settings,
    get ready() { return haveShaper(); },
    get pipelineKey() { return settings.shaper; },
    traceCode: mode => COMMON_WGSL + volumeWgsl(0) + proceduralTraceWgsl(mode, settings.shaper),
    layoutEntries,
    get resourceKey() { return resourceKey; },
    async load(urls) {
      const jobs: Promise<void>[] = [];
      if (urls.skyproNoise) jobs.push(loadSkyProNoise(device, urls.skyproNoise).then(t => { skyproNoise?.destroy(); skyproNoise = t; }));
      if (urls.takram) jobs.push(loadTakramTextures(device, urls.takram).then(t => { takram = t; }));
      await Promise.all(jobs);
      resourceKey = {};
    },
    bindGroupEntries() {
      if (settings.shaper === 'skypro') {
        if (!skyproWeather || skyproWeather.key !== skyProWeatherKey(settings.skypro)) {
          const old = skyproWeather;
          skyproWeather = bakeSkyProWeather(device, settings.skypro);
          if (old) setTimeout(() => { old.map.destroy(); old.bounds.destroy(); }, 1000);
        }
        return [
          { binding: B.params, resource: { buffer } },
          { binding: B.noiseA, resource: skyproNoise!.createView() },
          { binding: B.noiseB, resource: dummy3d.createView() },
          { binding: B.weather, resource: skyproWeather.map.createView() },
          { binding: B.aux, resource: skyproWeather.bounds.createView() },
          { binding: B.sampler, resource: sampler },
        ];
      }
      const t = takram!;
      return [
        { binding: B.params, resource: { buffer } },
        { binding: B.noiseA, resource: t.shape.createView() },
        { binding: B.noiseB, resource: t.shapeDetail.createView() },
        { binding: B.weather, resource: t.localWeather.createView() },
        { binding: B.aux, resource: t.turbulence.createView() },
        { binding: B.sampler, resource: sampler },
      ];
    },
    update(time) {
      // A shaper switch or a new weather bake changes the resources.
      if (settings.shaper !== lastShaper || (settings.shaper === 'skypro' && skyproWeather && skyproWeather.key !== skyProWeatherKey(settings.skypro))) { lastShaper = settings.shaper; resourceKey = {}; }
      const shell = packProceduralParams(settings, params);
      let changed = false;
      for (let i = 0; i < PROC_PARAM_FLOATS; i++) if (params[i] !== prev[i]) { changed = true; break; }
      if (changed) { version++; prev.set(params); }
      // Sky Pro's evolution: the shape noise slides along the wind relative to the weather (PRESET.wind.evolutionSpeed at Tidewater's 12 m/s).
      params[10] = time * 60.8 * 12 / 89;
      device.queue.writeBuffer(buffer, 0, params);
      return { shell, version };
    },
    dispose() {
      buffer.destroy(); dummy3d.destroy(); skyproNoise?.destroy(); skyproWeather?.map.destroy(); skyproWeather?.bounds.destroy();
      if (takram) for (const t of Object.values(takram)) t.destroy();
    },
  };
}

/**
 * Opt a page in (open-water, plains-flight, sunset, species, ...: `if (query.get('model') === 'procedural') await attachProceduralClouds(...)`):
 * creates and loads the model, binds the placeholder volume when the runtime has none yet, and switches `densityModel`. The page passes the
 * texture URLs (vite: `import url from '.../node_modules/@takram/three-clouds/assets/shape.bin?url'`, see examples/lab/compare/panes/ours.ts).
 */
export async function attachProceduralClouds(
  runtime: { setProceduralModel(m: ProceduralDensityModel | null): void; settings: { densityModel: 'nvdf' | 'procedural' }; readonly extent: unknown; setVolume(asset: CloudVolumeAsset, o: { position: [number, number, number] }): Promise<void> },
  device: GPUDevice,
  options: { shaper?: ProceduralShaper; urls: { skyproNoise?: string; takram?: TakramTextureUrls } },
): Promise<ProceduralClouds> {
  const proc = createProceduralClouds(device, { shaper: options.shaper });
  await proc.load(options.urls);
  if (!runtime.extent) await runtime.setVolume(proceduralPlaceholderVolume(), { position: [0, -500, 0] });
  runtime.setProceduralModel(proc);
  runtime.settings.densityModel = 'procedural';
  return proc;
}

/**
 * A tiny empty volume for pages that render only the procedural model: the runtime binds a volume in every pass. Place it anywhere (its box is
 * empty; the voxel march is skipped in the procedural mode).
 */
export function proceduralPlaceholderVolume(): CloudVolumeAsset {
  const n = 8;
  return { name: 'procedural placeholder', dims: [n, n, n], voxelSizeMeters: 4, nvdf: new Uint8Array(n * n * n * 4), sdfMeters: new Float32Array(n * n * n).fill(1000) };
}
