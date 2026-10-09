// Our pane: @clouds/three with the generator's cumulus (open-water's cloudscape, same seed and sky layer) over a diffuse ground plane. Three WebGPU renderer + @pmndrs/sky.
import { ACESFilmicToneMapping, PerspectiveCamera, Scene } from 'three';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { pass } from 'three/tsl';
import { Sky } from '@pmndrs/sky';
import { Clouds, sharedBackend, type CloudQuality } from '@clouds/three';
import { CLOUD_PRESETS, type NvdfParams, createVolumeGenerator, encodeProceduralWeatherMap, loadCloudNoise, type VolumeGenerator } from '@clouds/runtime';
import { GROUND_HEX, forwardOf, mapCoverage, type Pane, type PaneStats, type ViewState } from '../shared';
// X1: the procedural density model (not in the core entry; imported from source). ?model=procedural [&shaper=skypro|takram].
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

export function createOursPane(canvas: HTMLCanvasElement, query: URLSearchParams): Pane {
  let renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera, sky: Sky, clouds: Clouds, post: RenderPipeline;
  const state = { ready: false, cpuMs: 0, sceneGpu: [] as number[], busy: false, frames: 0, generated: false, skyWait: false, weatherKey: '', cloudsOn: query.get('clouds') !== '0' };
  const cpu: number[] = [];
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const SKY_LAYER = query.get('sky') !== '0';
  const JOBS = Number(query.get('jobs') ?? 4);
  let gen: VolumeGenerator | undefined;
  let weatherOpts: Parameters<typeof encodeProceduralWeatherMap>[2] | undefined, params: Partial<NvdfParams> | undefined;
  let currentSun = '';
  const PROCEDURAL = query.get('model') === 'procedural';
  let proc: ProceduralClouds | undefined;
  let procFrames = 0;

  const start = async () => {
    renderer = new WebGPURenderer({ canvas, antialias: false, trackTimestamp: true });
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = OURS_EXPOSURE;
    await renderer.init();
    renderer.setPixelRatio(1);
    scene = new Scene();
    camera = new PerspectiveCamera(50, 1, 0.5, 600000);
    sky = new Sky(renderer, { preset: 'earth', timeOfDay: 14, latitude: 40, north: '-Z' });
    sky.attach(scene);
    sky.createGround({ mode: 'plane', size: 8000000, color: GROUND_HEX, roughness: 1 }).attach(scene);
    sky.createSun({ physical: true }).attach(scene);
    await sky.compileAsync();
    clouds = new Clouds(renderer, { sky, quality: (query.get('quality') ?? 'high') as CloudQuality });
    // ?c_<setting>=<number> overrides a runtime setting (as on the species page), e.g. c_lightDebug=2 shows only the ms term.
    if (query.get('phase') === 'mie') clouds.core.settings.phaseModel = 'mie';
    for (const key of Object.keys(clouds.core.settings)) { const v = query.get('c_' + key); if (v !== null && typeof (clouds.core.settings as unknown as Record<string, unknown>)[key] === 'number') (clouds.core.settings as unknown as Record<string, number>)[key] = Number(v); }
    post = new RenderPipeline(renderer);
    const scenePass = pass(scene, camera);
    post.outputNode = state.cloudsOn ? clouds.node(scenePass.getTextureNode(), scenePass) : scenePass.getTextureNode();
    await clouds.setNoise(await loadCloudNoise('/clouds/noise/'));
    if (state.cloudsOn && PROCEDURAL) await beginProcedural();
    else if (state.cloudsOn) beginGeneration(Number(query.get('coverage') ?? 0.5)); else state.ready = true; // ?clouds=0: clear sky, nothing to generate
  };
  // X1: ?model=procedural renders the procedural model instead of the generated field. ?shaper=skypro (default) | takram picks the shaper;
  // ?proc_<key>=N, ?sp_<key>=N, ?tk_<key>=N override a top-level, Sky Pro or Takram setting (numbers only).
  const beginProcedural = async () => {
    const device = sharedBackend(renderer).device;
    const shaper = (query.get('shaper') ?? 'skypro') as ProceduralShaper;
    proc = createProceduralClouds(device, { shaper });
    await proc.load(shaper === 'skypro' ? { skyproNoise: skyproNoiseUrl } : { takram: { shape: tkShapeUrl, shapeDetail: tkShapeDetailUrl, localWeather: tkLocalWeatherUrl, turbulence: tkTurbulenceUrl } });
    const num = (o: object, k: string, v: string) => { if (typeof (o as Record<string, unknown>)[k] === 'number') (o as Record<string, number>)[k] = Number(v); };
    for (const [k, v] of query) {
      if (k.startsWith('proc_')) num(proc.settings, k.slice(5), v);
      if (k.startsWith('sp_')) num(proc.settings.skypro, k.slice(3), v);
      if (k.startsWith('tk_')) num(proc.settings.takram, k.slice(3), v);
    }
    await clouds.setVolume(proceduralPlaceholderVolume(), { position: [0, -500, 0] });
    clouds.core.setProceduralModel(proc);
    clouds.core.settings.densityModel = 'procedural';
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
        void clouds.setVolume(volume, { position: [FIELD.centre[0], Number(query.get('base') ?? FIELD.base), FIELD.centre[1]] }).then(() => {
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

  return {
    id: 'ours',
    label: PROCEDURAL ? `ours: @clouds/three, procedural density (${query.get('shaper') ?? 'skypro'} shaper)` : 'ours: @clouds/three (WebGPU, TSL)',
    canvas,
    init: start,
    resize(w, h) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); },
    ready: () => state.ready,
    render(view: ViewState) {
      const t0 = performance.now();
      if (proc) {
        if (!query.has('sp_coverage')) proc.settings.skypro.coverage = mapCoverage.skypro(view.coverage);
        if (!query.has('tk_coverage')) proc.settings.takram.coverage = mapCoverage.takram(view.coverage);
        if (!state.ready && ++procFrames > 40) state.ready = true;
      } else if (view.coverage !== appliedCoverage && !gen && state.generated) { clearTimeout(coverageTimer); const c = view.coverage; coverageTimer = window.setTimeout(() => { if (!gen) beginGeneration(c); }, 400); }
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
      post.render();
      if (!state.busy) {
        state.busy = true;
        renderer.resolveTimestampsAsync('render').then(ms => { if (typeof ms === 'number' && ms > 0) { state.sceneGpu.push(ms); if (state.sceneGpu.length > 60) state.sceneGpu.shift(); } }).catch(() => {}).finally(() => { state.busy = false; });
      }
      if (state.skyWait && !state.ready && (clouds.core.skyLayer.info?.frames ?? 0) >= 20) state.ready = true;
      cpu.push(performance.now() - t0); if (cpu.length > 60) cpu.shift();
      state.frames++;
    },
    stats(): PaneStats {
      const c = clouds?.timings ?? {};
      const cloudSum = Object.values(c).reduce((x, y) => x + y, 0);
      return { gpuMs: { scene: mean(state.sceneGpu), ...c, cloudsTotal: cloudSum, total: mean(state.sceneGpu) + cloudSum }, cpuMs: mean(cpu) };
    },
    detail: () => ({ cloudsReady: clouds?.isReady, generated: state.generated, exposure: renderer?.toneMappingExposure, coverageLo: state.weatherKey, model: proc ? `procedural/${proc.settings.shaper}` : 'nvdf' }),
  };
}

