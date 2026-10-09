// Our pane: @clouds/three with the generator's cumulus (open-water's cloudscape, same seed and sky layer) over a diffuse ground plane. Three WebGPU renderer + @pmndrs/sky.
import { ACESFilmicToneMapping, PerspectiveCamera, Scene } from 'three';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { pass } from 'three/tsl';
import { Sky } from '@pmndrs/sky';
import { Clouds, sharedBackend, type CloudQuality } from '@clouds/three';
import { CLOUD_PRESETS, type NvdfParams, createVolumeGenerator, encodeProceduralWeatherMap, loadCloudNoise, type VolumeGenerator } from '@clouds/runtime';
import { GROUND_HEX, forwardOf, mapCoverage, type Pane, type PaneStats, type ViewState } from '../shared';

// Cloudscape: 512 x 512 x 64 voxels at 8 m = 4.1 km square, 512 m tall, base 150 m, centred 2.3 km north of the origin (as open-water).
const FIELD = { dims: [512, 512, 64] as [number, number, number], voxel: 8, base: 150, centre: [0, -2300] as const };
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
    post = new RenderPipeline(renderer);
    const scenePass = pass(scene, camera);
    post.outputNode = state.cloudsOn ? clouds.node(scenePass.getTextureNode(), scenePass) : scenePass.getTextureNode();
    await clouds.setNoise(await loadCloudNoise('/clouds/noise/'));
    if (state.cloudsOn) beginGeneration(Number(query.get('coverage') ?? 0.5)); else state.ready = true; // ?clouds=0: clear sky, nothing to generate
  };
  const beginGeneration = (coverage: number) => {
    const device = sharedBackend(renderer).device;
    const preset = CLOUD_PRESETS.cumulus;
    const seed = Number(query.get('seed') ?? 7);
    const cov = mapCoverage.ours(coverage);
    const encoder = device.createCommandEncoder();
    weatherOpts = { ...preset.weather, coverageLo: cov.lo, coverageHi: cov.hi, size: [FIELD.dims[0], FIELD.dims[1]] as [number, number], seed, ...(SKY_LAYER ? { border: 0 } : {}) };
    params = { ...preset.params, seed };
    const weather = encodeProceduralWeatherMap(device, encoder, weatherOpts);
    device.queue.submit([encoder.finish()]);
    gen = createVolumeGenerator(device, { dims: FIELD.dims, voxelSize: FIELD.voxel, weather, sliceDepth: 4, params: { ...preset.params, seed } });
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
        void clouds.setVolume(volume, { position: [FIELD.centre[0], FIELD.base, FIELD.centre[1]] }).then(() => {
          if (SKY_LAYER && weatherOpts) { const l = clouds.core.skyLayer; l.configure({ weather: weatherOpts, shape: params, voxelSize: FIELD.voxel, rimWidth: 0 }); l.settings.enabled = true; }
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
    label: 'ours: @clouds/three (WebGPU, TSL)',
    canvas,
    init: start,
    resize(w, h) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); },
    ready: () => state.ready,
    render(view: ViewState) {
      const t0 = performance.now();
      if (view.coverage !== appliedCoverage && !gen && state.generated) { clearTimeout(coverageTimer); const c = view.coverage; coverageTimer = window.setTimeout(() => { if (!gen) beginGeneration(c); }, 400); }
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
    detail: () => ({ cloudsReady: clouds?.isReady, generated: state.generated, exposure: renderer?.toneMappingExposure, coverageLo: state.weatherKey }),
  };
}

