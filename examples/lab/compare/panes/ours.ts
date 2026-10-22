// Our pane: @clouds/three with the generator's cumulus (open-water's cloudscape, same seed and sky layer) over a diffuse ground plane. Three WebGPU renderer + @pmndrs/sky.
import { ACESFilmicToneMapping, PerspectiveCamera, Scene } from 'three';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { pass } from 'three/tsl';
import { Sky } from '@pmndrs/sky';
import { Clouds, sharedBackend, type CloudQuality } from '@clouds/three';
import { CLOUD_PRESETS, type NvdfParams, createVolumeGenerator, encodeProceduralWeatherMap, loadCloudNoise, type VolumeGenerator } from '@clouds/runtime';
import { GROUND_HEX, forwardOf, mapCoverage, type Pane, type PaneStats, type ViewState } from '../shared';
// X1: the procedural density model (not in the core entry; imported from source). ?model=procedural|hybrid [&shaper=skypro|takram|hzd].
// H1: ?shaper=hzd is the HZD reference path (GPU Pro 7 chain on the baked HZD noise set and the NDF); ?hz_<key>=N|word and ?hzn_<key>=N override
// its settings and its generated NDF's (e.g. hz_stage=1, hz_typeBlend=curves, hz_ndfMotion=static, hzn_seed=5). The 'hzd' pane forces it.
import { createProceduralClouds, proceduralPlaceholderVolume, type ProceduralClouds, type ProceduralShaper } from '../../../../packages/runtime/src/procedural';
import skyproNoiseUrl from '../vendor/skypro/clouds/baseShape64.bin?url';
import tkShapeUrl from '../../../../node_modules/@takram/three-clouds/assets/shape.bin?url';
import tkShapeDetailUrl from '../../../../node_modules/@takram/three-clouds/assets/shape_detail.bin?url';
import tkLocalWeatherUrl from '../../../../node_modules/@takram/three-clouds/assets/local_weather.png?url';
import tkTurbulenceUrl from '../../../../node_modules/@takram/three-clouds/assets/turbulence.png?url';

// Cloudscape: 512 x 512 x 64 voxels at 8 m = 4.1 km square, 512 m tall, centred 2.3 km north of the origin (as open-water).
// Q2: the base is at 750 m, the bottom of Takram's first default layer (750 m / 650 m), so both panes see their fair-weather layer from the same
// height. At 150 m (open-water's) the whole field sat within a few degrees of the horizon as one row of tall blobs, with nothing overhead, while
// Takram's (and every midday photo's) flat bases recede overhead in perspective. ?base=<m> overrides it.
const FIELD: { dims: [number, number, number]; voxel: number; base: number; centre: readonly [number, number] } = { dims: [512, 512, 64], voxel: 8, base: 750, centre: [0, -2300] as const };
// ?vol=WxHxD@voxel overrides the volume (e.g. 512x512x128@8: a 1 km tall field); weather cell sizes keep their metres (as the species page).
const volQuery = new URLSearchParams(location.search).get('vol')?.match(/^(\d+)x(\d+)x(\d+)@(\d+(?:\.\d+)?)$/);
if (volQuery) { FIELD.dims = [Number(volQuery[1]), Number(volQuery[2]), Number(volQuery[3])]; FIELD.voxel = Number(volQuery[4]); }
/** Exposure calibration: our own default (physical sun, ACES at 0.35); the other panes are matched to this one. */
export const OURS_EXPOSURE = 0.35;
/** LH1: the HZD bench's default ambientSaturation under Nubis lighting (the library default stays 1). */
export const HZD_AMBIENT_SATURATION = 0.15;

/** The pane's renderer objects, for pages that drive more than the shared view (the HZD bench's tuning panel). Set once `init` has resolved. */
export interface OursInternals { clouds: Clouds; proc: ProceduralClouds | undefined; sky: Sky; renderer: WebGPURenderer; camera: PerspectiveCamera }
/** A renderer, scene and camera made elsewhere (an R3F <Canvas>, the React HZD bench): the pane sets them up and drives them instead of its own. */
export interface OursHost { renderer: WebGPURenderer; scene: Scene; camera: PerspectiveCamera }
/** `update` (camera, sun, sky, generation) and `present` (the post pipeline, GPU timestamps) are `render`'s two halves, for a host whose own
 *  render job draws the frame (R3F's, through setRenderOverride); `render` = update + present. */
export type OursPane = Pane & { internals(): OursInternals; update(view: ViewState): void; present(): void };

export function createOursPane(canvas: HTMLCanvasElement, query: URLSearchParams, force?: { model: 'procedural' | 'hybrid'; shaper: ProceduralShaper }, host?: OursHost): OursPane {
  let renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera, sky: Sky, clouds: Clouds, post: RenderPipeline;
  const state = { ready: false, cpuMs: 0, sceneGpu: [] as number[], busy: false, frames: 0, generated: false, skyWait: false, weatherKey: '', cloudsOn: query.get('clouds') !== '0' };
  const cpu: number[] = [];
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const SKY_LAYER = query.get('sky') !== '0';
  const JOBS = Number(query.get('jobs') ?? 4);
  let gen: VolumeGenerator | undefined;
  let weatherOpts: Parameters<typeof encodeProceduralWeatherMap>[2] | undefined, params: Partial<NvdfParams> | undefined;
  let currentSun = '';
  const MODEL = force?.model ?? (query.get('model') === 'procedural' || query.get('model') === 'hybrid' ? (query.get('model') as 'procedural' | 'hybrid') : 'nvdf');
  const SHAPER = force?.shaper ?? ((query.get('shaper') ?? 'takram') as ProceduralShaper);
  const PROCEDURAL = MODEL === 'procedural';
  // X3 lighting models: ?light=octave|nubis for the procedural model (default octave; X1's ?proc_lighting=0|1 still works), ?vlight=nubis|octave
  // for the voxel field and the NVDF sky layer (default nubis).
  const procLight = query.get('light') ?? (query.get('proc_lighting') === '0' ? 'nubis' : query.get('proc_lighting') === '1' ? 'octave' : force?.shaper === 'hzd' ? 'nubis' : 'octave');
  let proc: ProceduralClouds | undefined;
  let procFrames = 0;

  const start = async () => {
    renderer = host?.renderer ?? new WebGPURenderer({ canvas, antialias: false, trackTimestamp: true });
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = OURS_EXPOSURE;
    if (!renderer.hasInitialized()) await renderer.init();
    if (!host) renderer.setPixelRatio(1);
    scene = host?.scene ?? new Scene();
    camera = host?.camera ?? new PerspectiveCamera(50, 1, 0.5, 600000);
    if (host) { camera.fov = 50; camera.near = 0.5; camera.far = 600000; camera.updateProjectionMatrix(); }
    sky = new Sky(renderer, { preset: 'earth', timeOfDay: 14, latitude: 40, north: '-Z' });
    sky.attach(scene);
    sky.createGround({ mode: 'plane', size: 8000000, color: GROUND_HEX, roughness: 1 }).attach(scene);
    sky.createSun({ physical: true }).attach(scene);
    await sky.compileAsync();
    clouds = new Clouds(renderer, { sky, quality: (query.get('quality') ?? 'high') as CloudQuality });
    // ?c_<setting>=<number> overrides a runtime setting (as on the species page), e.g. c_lightDebug=2 shows only the ms term.
    if (query.get('phase') === 'mie') clouds.core.settings.phaseModel = 'mie';
    if (query.get('vlight') === 'octave') clouds.core.settings.lightingModel = 'octave';
    // LH1: the HZD bench's Nubis lighting reads a bodies' shade as sky ambient alone (the sun terms die in the cloud's own shadow), so a shaded body is
    // the sky's saturated blue (shade B/R about 2.0, photos 1.4-1.55). The M1 ambientSaturation takes the colour out of that ambient (1 = the old look). Before the c_ loop: ?c_ambientSaturation=1 wins.
    if (force?.shaper === 'hzd' && procLight === 'nubis') clouds.core.settings.ambientSaturation = HZD_AMBIENT_SATURATION;
    for (const key of Object.keys(clouds.core.settings)) { const v = query.get('c_' + key); if (v !== null && typeof (clouds.core.settings as unknown as Record<string, unknown>)[key] === 'number') (clouds.core.settings as unknown as Record<string, number>)[key] = Number(v); }
    // P9-E high layer: ?cirrus=1 turns it on, ?cirrus_cov=0..1, ?cirrus_alt=<m>; ?cirrus_<setting>=N sets any other numeric setting (type, veil, opticalDepth, halo, ...).
    const ci = clouds.core.cirrus.settings as unknown as Record<string, unknown>;
    if (query.get('cirrus') === '1') clouds.core.cirrus.settings.enabled = true;
    for (const [k, v] of query) {
      const key = k === 'cirrus_cov' ? 'coverage' : k === 'cirrus_alt' ? 'altitude' : k.startsWith('cirrus_') ? k.slice(7) : '';
      if (key && typeof ci[key] === 'number') ci[key] = Number(v);
    }
    post = new RenderPipeline(renderer);
    const scenePass = pass(scene, camera);
    post.outputNode = state.cloudsOn ? clouds.node(scenePass.getTextureNode(), scenePass) : scenePass.getTextureNode();
    await clouds.setNoise(await loadCloudNoise('/clouds/noise/'));
    if (state.cloudsOn && PROCEDURAL) await beginProcedural();
    else if (state.cloudsOn && MODEL === 'hybrid') beginGeneration(Number(query.get('coverage') ?? 0.5));
    else if (state.cloudsOn) beginGeneration(Number(query.get('coverage') ?? 0.5)); else state.ready = true; // ?clouds=0: clear sky, nothing to generate
  };
  // X1: ?model=procedural renders the procedural model instead of the generated field. ?shaper=takram (default) | skypro picks the shaper,
  // ?light=nubis|octave its lighting model (X3; default octave);
  // ?proc_<key>=N, ?sp_<key>=N, ?tk_<key>=N override a top-level, Sky Pro or Takram setting (numbers only).
  // X3: ?model=hybrid generates the NVDF field as usual and renders the procedural sky around it (densityModel 'hybrid'); the field replaces the
  // procedural clouds inside its box over a 400 m fade (?proc_boxCarve=0 for the density union instead).
  const beginProcedural = async () => {
    const device = sharedBackend(renderer).device;
    const shaper = SHAPER;
    proc = createProceduralClouds(device, { shaper });
    proc.settings.lightingModel = procLight === 'nubis' ? 'nubis' : 'octave';
    if (MODEL === 'hybrid') proc.settings.boxCarve = 400;
    if (force?.shaper === 'hzd') proc.settings.hzd.lightProfile = 'exact';   // C1: the HZD bench lights with Nubis + the exact profile (?light=octave, ?hz_lightProfile=standin for the old)
    const num = (o: object, k: string, v: string) => {
      const r = o as Record<string, unknown>;
      if (typeof r[k] === 'number') r[k] = Number(v);
      else if (typeof r[k] === 'boolean') r[k] = v === '1' || v === 'true';
      else if (typeof r[k] === 'string') r[k] = v;   // H1 enum settings (typeBlend, erosionLaw, ndfMotion, noiseFormat)
    };
    for (const [k, v] of query) {
      if (k.startsWith('hz_')) num(proc.settings.hzd, k.slice(3), v);
      if (k.startsWith('hzn_')) num(proc.settings.hzd.ndf, k.slice(4), v);
    }
    await proc.load(shaper === 'skypro' ? { skyproNoise: skyproNoiseUrl } : shaper === 'hzd' ? { hzd: true } : { takram: { shape: tkShapeUrl, shapeDetail: tkShapeDetailUrl, localWeather: tkLocalWeatherUrl, turbulence: tkTurbulenceUrl } });
    for (const [k, v] of query) {
      if (k.startsWith('proc_')) num(proc.settings, k.slice(5), v);
      if (k.startsWith('sp_')) num(proc.settings.skypro, k.slice(3), v);
      if (k.startsWith('tk_')) num(proc.settings.takram, k.slice(3), v);
      // X3: ?tkl<i>_<key>=N overrides Takram layer i (0..3), e.g. tkl1_densityScale=0 hides the second cumulus layer.
      const m = k.match(/^tkl(\d)_(\w+)$/); if (m && proc.settings.takram.layers[Number(m[1])]) num(proc.settings.takram.layers[Number(m[1])], m[2], v);
    }
    if (MODEL === 'procedural') await clouds.setVolume(proceduralPlaceholderVolume(), { position: [0, -500, 0] });
    clouds.core.setProceduralModel(proc);
    clouds.core.settings.densityModel = MODEL as 'procedural' | 'hybrid';
    // ?sky_<setting>=N overrides a sky-layer setting here too (the procedural trace runs in the layer: resolutionScale, temporalBlend, transmittanceCutoff).
    const l = clouds.core.skyLayer.settings as unknown as Record<string, number | boolean>;
    for (const [k, v] of query) if (k.startsWith('sky_') && k.slice(4) in l) l[k.slice(4)] = typeof l[k.slice(4)] === 'boolean' ? v === '1' : Number(v);
    state.generated = true;
  };
  const beginGeneration = (coverage: number) => {
    const device = sharedBackend(renderer).device;
    const preset = CLOUD_PRESETS.cumulus;
    const seed = Number(query.get('seed') ?? 7);
    const cov = mapCoverage.ours(coverage);
    const encoder = device.createCommandEncoder();
    const k = (FIELD.dims[0] * FIELD.voxel) / 4096;
    const w = preset.weather;
    weatherOpts = {
      ...w, coverageLo: cov.lo, coverageHi: cov.hi, size: [FIELD.dims[0], FIELD.dims[1]] as [number, number], seed, ...(SKY_LAYER ? { border: 0 } : {}),
      extentMeters: FIELD.dims[0] * FIELD.voxel, heightMeters: FIELD.dims[2] * FIELD.voxel,
      ...(w.cellScale ? { cellScale: w.cellScale * k } : {}), ...(w.scale ? { scale: w.scale * k } : {}),
    };
    params = { ...preset.params, seed };
    // ?w_<key>=N / ?p_<key>=N override a weather option / generator parameter of the preset (look experiments, as on the species page).
    for (const [k, v] of query) {
      if (k.startsWith('w_')) (weatherOpts as unknown as Record<string, number>)[k.slice(2)] = Number(v);
      if (k.startsWith('p_')) (params as Record<string, number>)[k.slice(2)] = Number(v);
    }
    const weather = encodeProceduralWeatherMap(device, encoder, weatherOpts);
    device.queue.submit([encoder.finish()]);
    gen = createVolumeGenerator(device, { dims: FIELD.dims, voxelSize: FIELD.voxel, weather, sliceDepth: 4, params });
    state.weatherKey = cov.lo.toFixed(3);
    appliedCoverage = coverage;
    stepGen = () => {
      const g = gen;
      if (!g) return;
      const enc = device.createCommandEncoder({ label: 'cloud generation' });
      g.generate(enc, JOBS);
      device.queue.submit([enc.finish()]);
      if (g.done) {
        const volume = g.volume;
        gen = undefined;
        void clouds.setVolume(volume, { position: [FIELD.centre[0], Number(query.get('base') ?? FIELD.base), FIELD.centre[1]] }).then(async () => {
          if (MODEL === 'hybrid') { if (!proc) await beginProcedural(); state.ready = true; return; }
          if (SKY_LAYER && weatherOpts) { const l = clouds.core.skyLayer; l.configure({ weather: weatherOpts, shape: params, voxelSize: FIELD.voxel, rimWidth: 0 }); l.settings.enabled = true;
            // ?sky_<setting>=N overrides a sky-layer setting (as on the species page).
            for (const [k, v] of query) { if (k.startsWith('sky_') && k.slice(4) in l.settings) (l.settings as unknown as Record<string, number | boolean>)[k.slice(4)] = typeof (l.settings as unknown as Record<string, unknown>)[k.slice(4)] === 'boolean' ? v === '1' : Number(v); }
          }
          state.generated = true;
          state.skyWait = SKY_LAYER && clouds.core.skyLayer.settings.enabled;
          if (!state.skyWait) state.ready = true;
        });
      }
    };
  };
  let appliedCoverage = -1, coverageTimer = 0;
  let stepGen: () => void = () => {};
  let t0 = 0;
  const update = (view: ViewState) => {
    t0 = performance.now();
    if (proc) {
      if (!query.has('sp_coverage')) proc.settings.skypro.coverage = mapCoverage.skypro(view.coverage);
      if (!query.has('tk_coverage')) proc.settings.takram.coverage = mapCoverage.takram(view.coverage);
      if (!query.has('hz_coverageBias')) proc.settings.hzd.coverageBias = mapCoverage.hzd(view.coverage);
      if (PROCEDURAL && !state.ready && ++procFrames > 40) state.ready = true;
    }
    if (!PROCEDURAL && view.coverage !== appliedCoverage && !gen && state.generated) { clearTimeout(coverageTimer); const c = view.coverage; coverageTimer = window.setTimeout(() => { if (!gen) beginGeneration(c); }, 400); }
    stepGen();
    camera.fov = view.fov;
    camera.position.set(...view.position);
    const f = forwardOf(view);
    camera.lookAt(view.position[0] + f[0], view.position[1] + f[1], view.position[2] + f[2]);
    camera.near = Math.min(50, Math.max(0.2, camera.position.y * 0.05));
    camera.updateProjectionMatrix();
    const key = `${view.sunAz},${view.sunEl}`;
    if (key !== currentSun) { currentSun = key; sky.setSunDirection({ elevation: view.sunEl, azimuth: view.sunAz }); }
    renderer.toneMappingExposure = OURS_EXPOSURE * view.exposure;
    sky.update(camera);
    void sky.updateAerialPerspective();
  };
  const present = () => {
    post.render();
    if (!state.busy) {
      state.busy = true;
      renderer.resolveTimestampsAsync('render').then(ms => { if (typeof ms === 'number' && ms > 0) { state.sceneGpu.push(ms); if (state.sceneGpu.length > 60) state.sceneGpu.shift(); } }).catch(() => {}).finally(() => { state.busy = false; });
    }
    if (state.skyWait && !state.ready && (clouds.core.skyLayer.info?.frames ?? 0) >= 20) state.ready = true;
    cpu.push(performance.now() - t0); if (cpu.length > 60) cpu.shift();
    state.frames++;
  };

  return {
    id: force?.shaper === 'hzd' ? 'hzd' : 'ours',
    label: force?.shaper === 'hzd' ? `hzd: HZD reference (GPU Pro 7 chain, Nubis noise, NDF; ${procLight} lighting)` : MODEL !== 'nvdf' ? `ours: @clouds/three, ${MODEL} (${SHAPER} shaper, ${procLight} lighting${MODEL === 'hybrid' ? `, NVDF ${query.get('vlight') ?? 'nubis'}` : ''})` : `ours: @clouds/three (WebGPU, TSL${query.get('vlight') === 'octave' ? ', octave lighting' : ''})`,
    canvas,
    init: start,
    resize(w, h) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); },
    ready: () => state.ready,
    render(view: ViewState) { update(view); present(); },
    update,
    present,
    stats(): PaneStats {
      const c = clouds?.timings ?? {};
      const cloudSum = Object.values(c).reduce((x, y) => x + y, 0);
      return { gpuMs: { scene: mean(state.sceneGpu), ...c, cloudsTotal: cloudSum, total: mean(state.sceneGpu) + cloudSum }, cpuMs: mean(cpu) };
    },
    internals: () => ({ clouds, proc, sky, renderer, camera }),
    detail: () => ({ cloudsReady: clouds?.isReady, generated: state.generated, exposure: renderer?.toneMappingExposure, coverageLo: state.weatherKey, model: proc ? `${MODEL}/${proc.settings.shaper}/${proc.settings.lightingModel}` : 'nvdf', voxelLighting: clouds?.core.settings.lightingModel }),
  };
}

