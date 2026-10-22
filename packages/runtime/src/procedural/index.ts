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
import { defaultProceduralSettings, PROC_HZD_STORM_OFFSET, packProceduralParams, packProceduralView, PROC_PARAM_BYTES, PROC_PARAM_FLOATS, PROC_VIEW_FLOATS, type ProceduralSettings, type ProceduralShaper } from './settings';
import { PROC_BINDING_OFFSETS, PROC_PARAMS_WGSL } from './density.wgsl';
import { createHzdLutBuffer, procShaperBindingsWgsl, procShaperWgsl } from './hzd/shaper.wgsl';
import { bakeHzdNoise, hzdNoiseKey, type HzdNoise } from './hzd/noise';
import { applyHzdNdfImages, applyHzdPaintImages, composeHzdNdf, createHzdComposedTexture, createHzdPaintTexture, generateHzdNdf, hzdNdfImageKey, uploadHzdNdf, writeHzdNdf, type HzdNdf } from './hzd/ndf';
import type { HzdNdfSettings } from './settings';
import { hzdNdfKey } from './settings';
import { bakeSkyProWeather, loadSkyProNoise, loadTakramTextures, skyProWeatherKey, type SkyProWeather, type TakramTextures, type TakramTextureUrls } from './textures';
import { PROC_BINDINGS, proceduralTraceWgsl } from './trace.wgsl';
import type { MidLayerState, ProceduralDensityModel } from './types';

export * from './settings';
export type { MidLayerState, ProceduralDensityModel } from './types';
export { bakeHzdNoise, type HzdNoise, type HzdNoiseOptions } from './hzd/noise';
export { applyHzdNdfImages, generateHzdNdf, uploadHzdNdf, writeHzdNdf, type HzdNdf, type HzdNdfFields } from './hzd/ndf';
export * from './weather/blend';
export * from './weather/states';
export { HZD_GRADIENTS, hzdHeightGradient } from './hzd/shaper.wgsl';
export { PROC_BINDINGS, proceduralTraceWgsl } from './trace.wgsl';

/** One end of a weather transition: generator overrides and additive art biases (see setWeather). */
export interface WeatherNdf { ndf?: Partial<HzdNdfSettings>; coverageBias: number; typeBias: number }

export interface ProceduralClouds extends ProceduralDensityModel {
  readonly settings: ProceduralSettings;
  /** Load the textures of one or more shapers. `hzd: true` bakes the HZD noise set and the generated NDF (no files; they are also baked on first use). */
  load(urls: { skyproNoise?: string; takram?: TakramTextureUrls; hzd?: boolean }): Promise<void>;
  /** H1: replace the generated NDF with authored fields (size^2 bytes each; see uploadHzdNdf), or null to go back to the generated map. */
  setNdf(ndf: { size: number; fields: Parameters<typeof uploadHzdNdf>[2] } | null): void;
  /**
   * W2 weather: serve the NDF as a lerp between two generated maps (each the base settings with `ndf` overrides, plus additive coverage / type
   * biases), `t` 0..1 (already eased). null = off (the base map is served again). Cheap enough to call every frame: it only works when `t` or a
   * state changes (a generation of at most two new maps per state change, about 4 ms each at 1024^2, then one 0.1 ms compose pass per `t` step).
   * It does NOT cut the temporal history (the served map just changes a little each call), so a transition has no pop. Painted influence (below)
   * blends over the result.
   */
  setWeather(w: { from: WeatherNdf; to: WeatherNdf; t: number } | null): void;
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
  // W2: the painted map + influence mask (3-layer paint texture), the weather transition, and the composed texture the trace reads when either is on.
  let hzdPaint: GPUTexture | null = null;
  let paintHeights = true;
  let weather: { from: WeatherNdf; to: WeatherNdf; t: number } | null = null;
  const wxGens = new Map<string, HzdNdf>();
  let comp: GPUTexture | null = null;
  const composing = () => !!weather || !!hzdPaint;
  /** The texture the trace samples. */
  const served = (): HzdNdf | null => (hzdNdf && composing() && comp ? { texture: comp, key: 'composed' } : hzdNdf);
  const wxGen = (o?: Partial<HzdNdfSettings>): HzdNdf => {
    const n = { ...settings.hzd.ndf, ...o }, key = hzdNdfKey(n);
    let g = wxGens.get(key);
    if (g) wxGens.delete(key); else g = generateHzdNdf(device, n);
    wxGens.set(key, g);
    return g;
  };
  const wxTrim = (keep: HzdNdf[]) => { for (const [k, g] of wxGens) { if (wxGens.size <= 4) break; if (!keep.includes(g)) { wxGens.delete(k); retire(g.texture); } } };
  /** Write the composed texture: the base map (or the weather pair) with the painted influence over it. */
  const recompose = (): void => {
    if (!hzdNdf || !composing()) return;
    const h = settings.hzd.ndf;
    const a = weather ? wxGen(weather.from.ndf) : hzdNdf, b = weather ? wxGen(weather.to.ndf) : a;
    if (weather) wxTrim([a, b]);
    const size = a.texture.width;
    if (!comp || comp.width !== size) { if (comp) retire(comp); comp = createHzdComposedTexture(device, size); resourceKey = {}; }
    composeHzdNdf(device, { a: a.texture, b: b.texture, t: weather?.t ?? 0, biasA: [weather?.from.coverageBias ?? 0, weather?.from.typeBias ?? 0], biasB: [weather?.to.coverageBias ?? 0, weather?.to.typeBias ?? 0],
      paint: hzdPaint, paintHeights, blend: h.paintBlend, gains: [h.paintCoverage, h.paintTypes, h.paintHeights], out: comp });
  };
  // F2: the profile tables (constant; made on first use by the HZD shaper).
  let hzdLut: GPUBuffer | null = null;
  // W1 authored map: the image load for the current NDF settings (load() awaits it; the generated map shows until it lands).
  let ndfImageJob: Promise<void> | null = null;
  let paintSource: 'none' | 'images' | 'painter' = 'none';   // W2: what the paint texture holds (ndf.image + maskImage, or the bench painter's live map)
  const dropPaint = () => { if (hzdPaint) retire(hzdPaint); hzdPaint = null; paintSource = 'none'; resourceKey = {}; };
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
      // W2: image + mask under 'influence': the painted images go into the paint texture and blend over the generated map by the mask (the
      // generated layers stay as generated). Without a mask image, or with paintBlend 'replace', the W1 path below overwrites them.
      const influenceImages = h.ndf.paintBlend === 'influence' && !!h.ndf.maskImage && !!h.ndf.image;
      if (influenceImages) {
        const target = hzdNdf;
        if (!hzdPaint || hzdPaint.width !== target.texture.width) { if (hzdPaint) retire(hzdPaint); hzdPaint = createHzdPaintTexture(device, target.texture.width); }
        const paintTex = hzdPaint;
        paintHeights = !!h.ndf.heightImage; paintSource = 'images';
        ndfImageJob = applyHzdPaintImages(device, paintTex, { image: h.ndf.image, heightImage: h.ndf.heightImage, maskImage: h.ndf.maskImage }).then(() => {
          if (hzdNdf !== target || hzdPaint !== paintTex) return;
          recompose(); resourceKey = {}; version++;
        }, e => console.error('procedural NDF paint image failed', e));
      } else if (h.ndf.image || h.ndf.heightImage) {
        if (paintSource === 'images') dropPaint();
        const target = hzdNdf;
        ndfImageJob = applyHzdNdfImages(device, target, { image: h.ndf.image, heightImage: h.ndf.heightImage }).then(done => {
          if (hzdNdf !== target) return;
          target.key = done.key; resourceKey = {}; version++;
        }, e => console.error('procedural NDF image failed', e));
      } else {
        ndfImageJob = null;
        if (paintSource === 'images') dropPaint();
      }
      if (composing() && !influenceImages) recompose();
    }
    if (changed) version++;   // W1: a new map is a history cut (the map is not in ProcParams)
    return changed;
  };
  let version = 0, resourceKey: object = {}, lastShaper: ProceduralShaper | null = null;
  let shell: [number, number] = [0, 1];
  let midView: { tex: GPUTexture; view: GPUTextureView } | null = null;
  const midNdfView = (tex: GPUTexture) => (midView?.tex === tex ? midView : (midView = { tex, view: tex.createView({ dimension: '2d-array' }) })).view;
  const mapViews = new WeakMap<GPUTexture, GPUTextureView>();   // CI1: ndfMap's views (the mid layer's single-entry cache above would thrash against a different texture)
  const mapView = (tex: GPUTexture) => { let v = mapViews.get(tex); if (!v) { v = tex.createView({ dimension: '2d-array' }); mapViews.set(tex, v); } return v; };
  let lastWind: [number, number, number] = [0, 0, 0];   // L3: the wind offset of the last update, for the mid-level layer
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
    // F2: the HZD shaper's profile tables (a read-only storage buffer).
    ...(settings.shaper === 'hzd' ? [{ binding: base + O.lut, visibility, buffer: { type: 'read-only-storage' } } satisfies GPUBindGroupLayoutEntry] : []),
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
    get hzdTextures() { const n = served(); return hzdNoise && n ? { noise: hzdNoise, ndf: n } : null; },
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
    setWeather(w) {
      const was = composing();
      weather = w;
      if (!hzdNdf) return;   // before the first bake: the next hzdSync / load makes the base map, setWeather is called again every frame
      if (w === null && !was) return;
      // The first compose / the last one swaps the served texture: new bind groups, but no history cut (the content is the same on both sides).
      recompose();
      if (composing() !== was) resourceKey = {};
    },
    setNdf(ndf) {
      // An uploaded map of the same size is written in place (the bench's painter sends one per stroke update): no new texture or bind group,
      // and the version bump cuts the temporal history and refreshes the shadow map as a regenerated map does.
      // W2: with an influence mask (and paintBlend 'influence') the painter's map goes into the paint texture and blends over the generated map;
      // the generated map stays (re-made by hzdSync if the settings change). Without one, the W1 replace path below.
      if (ndf?.fields.influence && settings.hzd.ndf.paintBlend === 'influence') {
        if (hzdUploaded) { retire(hzdNdf?.texture ?? null); hzdNdf = null; hzdUploaded = false; ndfWant = ''; }
        hzdSync();
        if (!hzdPaint || hzdPaint.width !== ndf.size) { if (hzdPaint) retire(hzdPaint); hzdPaint = createHzdPaintTexture(device, ndf.size); resourceKey = {}; }
        paintSource = 'painter'; paintHeights = true;
        writeHzdNdf(device, hzdPaint, ndf.fields);
        recompose(); version++;
        return;
      }
      if (paintSource === 'painter') dropPaint();
      if (ndf && hzdUploaded && hzdNdf && hzdNdf.texture.width === ndf.size) { writeHzdNdf(device, hzdNdf.texture, ndf.fields); version++; return; }
      const old = hzdNdf?.texture ?? null;
      hzdUploaded = !!ndf; ndfWant = '';
      hzdNdf = ndf ? uploadHzdNdf(device, ndf.size, ndf.fields) : null;
      retire(old);
      if (!ndf) hzdSync();
      resourceKey = {}; version++;
      if (composing()) recompose();
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
          { binding: B.weather, resource: served()!.texture.createView({ dimension: '2d-array' }) },
          { binding: B.aux, resource: hzdNoise!.curl.createView() },
          { binding: B.sampler, resource: sampler },
          { binding: base + O.lut, resource: { buffer: (hzdLut ??= createHzdLutBuffer(device)) } },
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
    get ndfMap() {
      // CI1: the served map (weather transitions included), cached view.
      const n = settings.shaper === 'hzd' ? served() : null;
      return n ? { view: mapView(n.texture), tileMeters: settings.hzd.ndf.tileMeters, offset: [lastWind[0] * params[140], lastWind[2] * params[140]] as [number, number] } : null;
    },
    get midLayer(): MidLayerState | null {
      // L3: the HZD mid slot's altocumulus / altostratus as the 2.5D layer (layer or hybrid mode).
      if (settings.shaper !== 'hzd' || !hzdNdf) return null;
      const hz = settings.hzd;
      if ((hz.midLayerMode !== 'layer' && hz.midLayerMode !== 'hybrid') || (hz.midForm !== 'altocumulus' && hz.midForm !== 'altostratus')) return null;
      const cu = hz.midForm === 'altocumulus';
      const hl = Math.hypot(hz.windDirection[0], hz.windDirection[1]) || 1;
      const drift = lastWind;
      return {
        mode: hz.midLayerMode, form: hz.midForm, altitude: hz.midBottom + 0.5 * Math.max(hz.midThickness, 1), thickness: Math.max(hz.midThickness, 1),
        // The volume's coverage is a threshold on cells (c = 0.5 fills about a third); the layer's is an exponent and fade-in, so it reads higher.
        coverage: Math.min(1, Math.max(0, hz.midCoverage + hz.midLayerCoverageBoost)),
        type: cu ? 1 : 0.5, veil: cu ? 0 : 1, opticalDepth: hz.midLayerOpticalDepth,
        // The round noise has about 280 cells per tile: one cell is the slot's cell size.
        scale: cu ? Math.min(Math.max(hz.midCellSize * 280, 20000), 250000) : 40000, detail: cu ? 0.35 : 0.2,
        windOffset: [drift[0] * params[141], drift[2] * params[141]],
        streakAngle: Math.atan2(hz.windDirection[1] / hl, hz.windDirection[0] / hl) * 180 / Math.PI,
        ndfInfluence: Math.min(1, Math.max(0, hz.midLayerNdf)),
        // Where the map is stratiform the altocumulus layer goes toward cell clumps joined up (type 0.8, still round) and the altostratus one toward a plain sheet (0.4); cumuliform: cells (1) / wispy (0.75).
        typeStratiform: cu ? 0.8 : 0.4, typeCumuliform: cu ? 1 : 0.75,
        ndf: { view: midNdfView(hzdNdf.texture), tileMeters: hz.ndf.tileMeters, offset: [drift[0] * params[140], drift[2] * params[140]] },
        fadeStart: hz.midLayerMode === 'hybrid' ? hz.midLayerFadeStart : 0, fadeEnd: hz.midLayerMode === 'hybrid' ? Math.max(hz.midLayerFadeEnd, hz.midLayerFadeStart + 1) : 0,
      };
    },
    get motionSpeed() {
      // C2: the weather map's speed (the silhouettes), else the mean of the two noises' speeds; Sky Pro's shape follows the wind fully.
      if (settings.shaper !== 'hzd') return 1;
      return params[140] > 0 ? params[140] : (params[141] + params[142]) * 0.5;
    },
    get shadowSpeed() {
      // SH1: measured on the bench (landing pops of a rigidly slid shadow map are smallest there): the bodies' shadow follows the noises, not the slower map.
      if (settings.shaper !== 'hzd') return 1;
      return (params[141] + params[142]) * 0.5 || (params[140] > 0 ? params[140] : 1);
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
      lastWind = [view.wind[0], view.wind[1], view.wind[2]];
      // Sky Pro's evolution: the shape noise slides along the wind relative to the weather (PRESET.wind.evolutionSpeed at Tidewater's 12 m/s).
      params[10] = time * 60.8 * 12 / 89;
      // ST2 storm rotation: the inner ring's phase (radians) in hzStorm5.w; written after the change check (it is not part of the model version), then restored so the next frame's check sees the packed flag.
      const rotAt = PROC_HZD_STORM_OFFSET + 11, rotFlag = params[rotAt];
      if (rotFlag > 0) params[rotAt] = 1e-4 + time * settings.hzd.stormRotation * (Math.PI / 180);
      device.queue.writeBuffer(buffer, 0, params);
      params[rotAt] = rotFlag;
      return { version };
    },
    dispose() {
      buffer.destroy(); dummy3d.destroy(); dummyWeather.destroy(); skyproNoise?.destroy(); skyproWeather?.map.destroy(); skyproWeather?.bounds.destroy();
      if (takram) for (const t of Object.values(takram)) t.destroy();
      hzdNoise?.destroy(); hzdNdf?.texture.destroy(); hzdLut?.destroy();
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
