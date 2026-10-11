// X1 procedural density model (a parallel `densityModel`, a stopgap next to the NVDF path; see work/reports/X1.md).
//
//   const proc = createProceduralClouds(device, { shaper: 'takram' });   // or 'skypro', or 'hzd' (H1: the HZD reference path)
//   await proc.load({ skyproNoise: url });                         // or { takram: { shape, shapeDetail, localWeather, turbulence } }, or { hzd: true }
//   runtime.setProceduralModel(proc); runtime.settings.densityModel = 'procedural';
//   runtime.setVolume(proceduralPlaceholderVolume(), { position });  // the runtime still wants a (tiny, empty) volume bound
//
// Not exported from the core entry (the core stays under its bundle budget): pages import it from here.
import type { CloudVolumeAsset } from '../assets';
import { COMMON_WGSL } from '../shaders/common.wgsl';
import { volumeWgsl } from '../shaders/volume.wgsl';
import { SKY_WEATHER_BINDING } from '../shaders/sky-layer.wgsl';
import { defaultProceduralSettings, packProceduralParams, packProceduralView, PROC_PARAM_BYTES, PROC_PARAM_FLOATS, PROC_VIEW_FLOATS, type ProceduralSettings, type ProceduralShaper } from './settings';
import { PROC_BINDING_OFFSETS, PROC_PARAMS_WGSL } from './density.wgsl';
import { procShaperBindingsWgsl, procShaperWgsl } from './hzd/shaper.wgsl';
import { bakeHzdNoise, hzdNoiseKey, type HzdNoise } from './hzd/noise';
import { applyHzdNdfImages, generateHzdNdf, hzdNdfImageKey, uploadHzdNdf, type HzdNdf } from './hzd/ndf';
import { hzdNdfKey } from './settings';
import { bakeSkyProWeather, loadSkyProNoise, loadTakramTextures, skyProWeatherKey, type SkyProWeather, type TakramTextures, type TakramTextureUrls } from './textures';
import { PROC_BINDINGS, proceduralTraceWgsl } from './trace.wgsl';
import type { ProceduralDensityModel } from './types';

export * from './settings';
export type { ProceduralDensityModel } from './types';
export { bakeHzdNoise, type HzdNoise, type HzdNoiseOptions } from './hzd/noise';
export { applyHzdNdfImages, generateHzdNdf, uploadHzdNdf, type HzdNdf } from './hzd/ndf';
export { HZD_GRADIENTS, hzdHeightGradient } from './hzd/shaper.wgsl';
export { PROC_BINDINGS, proceduralTraceWgsl } from './trace.wgsl';

export interface ProceduralClouds extends ProceduralDensityModel {
  readonly settings: ProceduralSettings;
  /** Load the textures of one or more shapers. `hzd: true` bakes the HZD noise set and the generated NDF (no files; they are also baked on first use). */
  load(urls: { skyproNoise?: string; takram?: TakramTextureUrls; hzd?: boolean }): Promise<void>;
  /** H1: replace the generated NDF with authored fields (size^2 bytes each; see uploadHzdNdf), or null to go back to the generated map. */
  setNdf(ndf: { size: number; fields: Parameters<typeof uploadHzdNdf>[2] } | null): void;
  /** H1: the HZD shaper's textures (debug views), null until baked. */
  readonly hzdTextures: { noise: HzdNoise; ndf: HzdNdf } | null;
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
  let hzdNoise: HzdNoise | null = null;
  let hzdNdf: HzdNdf | null = null;
  let hzdUploaded = false;
  // W1 authored map: the image load for the current NDF settings (load() awaits it; the generated map shows until it lands).
  let ndfImageJob: Promise<void> | null = null;
  let ndfWant = '';   // the key (generator settings + image URLs) the current NDF was made for
  const retire = (t: { destroy(): void } | null) => { if (t) setTimeout(() => t.destroy(), 1000); };
  // H1: bake the noise set (once, or again when the format setting changes) and generate the NDF when its settings change.
  const hzdSync = (): boolean => {
    const h = settings.hzd;
    let changed = false;
    // H5: the bake options (format, R-chain carve/fine/smooth) are a key; a new key re-bakes.
    const noiseOpts = { format: h.noiseFormat, carve: h.noiseCarve, fine: h.noiseFine, smooth: h.noiseSmooth, supersample: h.noiseSupersample, detailRecipe: h.detailRecipe };
    if (!hzdNoise || hzdNoise.key !== hzdNoiseKey(noiseOpts)) { retire(hzdNoise); hzdNoise = bakeHzdNoise(device, noiseOpts); changed = true; }
    const want = hzdNdfImageKey(hzdNdfKey(h.ndf), h.ndf);
    if (!hzdUploaded && (!hzdNdf || ndfWant !== want)) {
      const old = hzdNdf?.texture ?? null; hzdNdf = generateHzdNdf(device, h.ndf); retire(old); changed = true; ndfWant = want;
      // W1: ndf.image / ndf.heightImage paint over the generated layers once loaded (in place; the generated map shows meanwhile).
      if (h.ndf.image || h.ndf.heightImage) {
        const target = hzdNdf;
        ndfImageJob = applyHzdNdfImages(device, target, { image: h.ndf.image, heightImage: h.ndf.heightImage }).then(done => {
          if (hzdNdf !== target) return;
          target.key = done.key; resourceKey = {}; version++;
        }, e => console.error('procedural NDF image failed', e));
      } else ndfImageJob = null;
    }
    if (changed) version++;   // W1: a new map is a history cut (the map is not in ProcParams)
    return changed;
  };
  let version = 0, resourceKey: object = {}, lastShaper: ProceduralShaper | null = null;
  let shell: [number, number] = [0, 1];
  // Trace pipelines by shaper and lighting mode (compiled asynchronously), the pass layout they share, and the cached bind groups (the pass
  // entries ping-pong with the voxel march's history, so a few are kept).
  const pipelines = new Map<string, GPUComputePipeline | 'pending'>();
  let passLayout: { entries: GPUBindGroupLayoutEntry[]; shaper: ProceduralShaper; layout: GPUBindGroupLayout } | null = null;
  let groups: { key: unknown[]; group: GPUBindGroup }[] = [];
  const dummyWeather = device.createTexture({ label: 'proc dummy weather', size: [1, 1], format: 'rgba8unorm', usage });
  const C = GPUShaderStage.COMPUTE;
  const O = PROC_BINDING_OFFSETS;
  const layoutEntries = (base: number, visibility: number): GPUBindGroupLayoutEntry[] => [
    { binding: base + O.params, visibility, buffer: { type: 'uniform' } },
    { binding: base + O.noiseA, visibility, texture: { sampleType: 'float', viewDimension: '3d' } },
    { binding: base + O.noiseB, visibility, texture: { sampleType: 'float', viewDimension: '3d' } },
    // H1: the HZD shaper's weather slot is the NDF (a 2-layer 2D array, procedural/hzd/ndf.wgsl.ts).
    { binding: base + O.weather, visibility, texture: { sampleType: 'float', viewDimension: settings.shaper === 'hzd' ? '2d-array' : '2d' } },
    { binding: base + O.aux, visibility, texture: { sampleType: 'float' } },
    { binding: base + O.sampler, visibility, sampler: { type: 'filtering' } },
  ];
  const haveShaper = () => (settings.shaper === 'skypro' ? !!skyproNoise : settings.shaper === 'hzd' ? !!hzdNoise && !!hzdNdf : !!takram);

  return {
    settings,
    // H1: the HZD shaper needs no files, so selecting it is enough: its textures are baked here on first use.
    get ready() { if (settings.shaper === 'hzd' && !haveShaper() && hzdSync()) resourceKey = {}; return haveShaper(); },
    get shell() { return shell; },
    get version() { return version; },
    get lightingModel() { return settings.lightingModel; },
    get wgslKey() { return settings.shaper; },
    get resourceKey() { return resourceKey; },
    get hzdTextures() { return hzdNoise && hzdNdf ? { noise: hzdNoise, ndf: hzdNdf } : null; },
    densityWgsl(group, base) {
      return PROC_PARAMS_WGSL + procShaperBindingsWgsl(settings.shaper, group, base) + procShaperWgsl(settings.shaper);
    },
    layoutEntries,
    pipeline(mode, layouts) {
      if (passLayout?.entries !== layouts.pass || passLayout.shaper !== settings.shaper) {
        passLayout = { entries: layouts.pass, shaper: settings.shaper, layout: device.createBindGroupLayout({ label: 'proc trace', entries: [...layouts.pass, ...layoutEntries(PROC_BINDINGS.params, C)] }) };
        pipelines.clear(); groups = [];
      }
      const key = `${settings.shaper}:${mode}`;
      const p = pipelines.get(key);
      if (p === undefined) {
        pipelines.set(key, 'pending');
        const bgls = mode === 'atmosphere' ? [layouts.volume, passLayout.layout, layouts.atmosphere] : [layouts.volume, passLayout.layout];
        const code = COMMON_WGSL + volumeWgsl(0) + proceduralTraceWgsl(mode, settings.shaper);
        void device.createComputePipelineAsync({ label: `proc trace ${key}`, layout: device.createPipelineLayout({ bindGroupLayouts: bgls }), compute: { module: device.createShaderModule({ label: `proc trace ${key}`, code }), entryPoint: 'trace' } })
          .then(pl => { if (pipelines.get(key) === 'pending') pipelines.set(key, pl); }, e => console.error('procedural trace pipeline failed', e));
        return null;
      }
      return p === 'pending' ? null : p;
    },
    bindGroup(entries, key) {
      const k = [...key, resourceKey, passLayout];
      const hit = groups.find(g => g.key.length === k.length && g.key.every((v, i) => v === k[i]));
      if (hit) return hit.group;
      const group = device.createBindGroup({ label: 'proc trace', layout: passLayout!.layout, entries: [...entries, { binding: SKY_WEATHER_BINDING, resource: dummyWeather.createView() }, ...this.resourceEntries(PROC_BINDINGS.params)] });
      groups.unshift({ key: k, group });
      if (groups.length > 4) groups.length = 4;
      return group;
    },
    async load(urls) {
      const jobs: Promise<void>[] = [];
      if (urls.skyproNoise) jobs.push(loadSkyProNoise(device, urls.skyproNoise).then(t => { skyproNoise?.destroy(); skyproNoise = t; }));
      if (urls.takram) jobs.push(loadTakramTextures(device, urls.takram).then(t => { takram = t; }));
      if (urls.hzd) { hzdSync(); if (ndfImageJob) jobs.push(ndfImageJob); jobs.push(device.queue.onSubmittedWorkDone()); }
      await Promise.all(jobs);
      resourceKey = {};
    },
    setNdf(ndf) {
      const old = hzdNdf?.texture ?? null;
      hzdUploaded = !!ndf; ndfWant = '';
      hzdNdf = ndf ? uploadHzdNdf(device, ndf.size, ndf.fields) : null;
      retire(old);
      if (!ndf) hzdSync();
      resourceKey = {};
    },
    resourceEntries(base) {
      const B = { params: base + O.params, noiseA: base + O.noiseA, noiseB: base + O.noiseB, weather: base + O.weather, aux: base + O.aux, sampler: base + O.sampler };
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
      if (settings.shaper === 'hzd') {
        return [
          { binding: B.params, resource: { buffer } },
          { binding: B.noiseA, resource: hzdNoise!.shape.createView() },
          { binding: B.noiseB, resource: hzdNoise!.detail.createView() },
          { binding: B.weather, resource: hzdNdf!.texture.createView({ dimension: '2d-array' }) },
          { binding: B.aux, resource: hzdNoise!.curl.createView() },
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
    update(time, view) {
      // A shaper switch or a new weather bake changes the resources.
      if (settings.shaper !== lastShaper || (settings.shaper === 'skypro' && skyproWeather && skyproWeather.key !== skyProWeatherKey(settings.skypro))) { lastShaper = settings.shaper; resourceKey = {}; }
      if (settings.shaper === 'hzd' && hzdSync()) resourceKey = {};
      shell = packProceduralParams(settings, params);
      let changed = false;
      for (let i = 0; i < PROC_PARAM_FLOATS; i++) if ((i < PROC_VIEW_FLOATS[0] || i >= PROC_VIEW_FLOATS[1]) && params[i] !== prev[i]) { changed = true; break; }
      if (changed) { version++; prev.set(params); }
      packProceduralView(view.camera, view.wind, params);
      // Sky Pro's evolution: the shape noise slides along the wind relative to the weather (PRESET.wind.evolutionSpeed at Tidewater's 12 m/s).
      params[10] = time * 60.8 * 12 / 89;
      device.queue.writeBuffer(buffer, 0, params);
      return { version };
    },
    dispose() {
      buffer.destroy(); dummy3d.destroy(); dummyWeather.destroy(); skyproNoise?.destroy(); skyproWeather?.map.destroy(); skyproWeather?.bounds.destroy();
      if (takram) for (const t of Object.values(takram)) t.destroy();
      hzdNoise?.destroy(); hzdNdf?.texture.destroy();
    },
  };
}

/**
 * Opt a page in (open-water, onsen, plains-flight, sunset, species, ...: `if (query.get('model')) await attachProceduralClouds(...)`): creates and loads
 * the model and switches `densityModel`. 'procedural' (default) binds the placeholder volume when the runtime has none yet; X3 'hybrid' keeps the
 * page's voxel volume (heroes, stamps, a generated field) inside the procedural sky. The page passes the texture URLs (vite:
 * `import url from '.../node_modules/@takram/three-clouds/assets/shape.bin?url'`, see examples/lab/scenes/procedural-sky.ts).
 */
export async function attachProceduralClouds(
  runtime: { setProceduralModel(m: ProceduralDensityModel | null): void; settings: { densityModel: 'nvdf' | 'procedural' | 'hybrid' }; readonly extent: unknown; setVolume(asset: CloudVolumeAsset, o: { position: [number, number, number] }): Promise<void> },
  device: GPUDevice,
  options: { shaper?: ProceduralShaper; urls: { skyproNoise?: string; takram?: TakramTextureUrls }; model?: 'procedural' | 'hybrid'; settings?: Partial<Omit<ProceduralSettings, 'skypro' | 'takram'>> },
): Promise<ProceduralClouds> {
  const proc = createProceduralClouds(device, { shaper: options.shaper });
  Object.assign(proc.settings, options.settings ?? {});
  await proc.load(options.urls);
  const model = options.model ?? 'procedural';
  if (model === 'procedural' && !runtime.extent) await runtime.setVolume(proceduralPlaceholderVolume(), { position: [0, -500, 0] });
  runtime.setProceduralModel(proc);
  runtime.settings.densityModel = model;
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
