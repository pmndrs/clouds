// PT1 reference lab: the same cloud density lit by an unbiased multiple-scattering path tracer (the owner's @pmndrs/pathtracer, P5 volumes)
// and by our realtime runtime (Nubis lighting, octave lighting), same camera, same sun, same sky, same tone mapping.
//
// Cloud: the Nubis pack hero Parkouring, placed as on the flagship. The PT reads a dense bake of the runtime's own up-rezzed density
// (DENSITY_WGSL on the runtime's device, each voxel at its distance to the camera so the noise mip matches the march) times the runtime's
// view extinction (settings.densityScale). The runtime renders the NVDF itself, as always.
// Sky: @pmndrs/sky with aerial perspective off and our horizon haze off (the PT has no atmosphere between camera and cloud); the PT's
// environment is the runtime's own sky-view LUT as an equirect, its sun the runtime's sun at the cloud centre (a delta light).
// Wind frozen (the bake is a still).
//
// Views (bookmarks, also the panel): <renderer>-<sun>, renderer pt | nubis | octave, sun noon | low.
// URL: ?view=pt-noon &spp=1024 &ptScale=1 &albedo=0.99 &g=0.8 &voxel=2 &maxDepth=512 &quality=ultra &exposure=0.35
import { ACESFilmicToneMapping, PerspectiveCamera, Scene } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { Sky } from '@pmndrs/sky';
import { createCloudRuntime, loadCloudNoise, loadCloudVolume, type CloudFrame } from '@clouds/runtime';
import { sharedBackend } from '../../../packages/legacy/three/src/gpu/backend';
import { installCloudsHarness } from '../harness/clouds-contract';
import { FOCUS_BOX, placeCloud, sunVector } from '../flagship/bookmarks';
import { createCloudBridge } from '../flagship/three-bridge';
import { createSkyBridge } from '../flagship/sky-bridge';
import { bakeDensity, bakeSky, type DensityGrid, type SkyBake, type V3 } from './bake';
import { PtReference } from './pt';

const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);
const num = (k: string, d: number) => (query.has(k) && Number.isFinite(Number(query.get(k))) ? Number(query.get(k)) : d);

// alpha: the PT side's opacity mask of the baked grid (1 - exp(-optical depth)), for the sheet's statistics.
// rtalpha: the runtime's own opacity (1 - the march's transmittance, read back from its output after the settle): checks the bake against the march.
const RENDERERS = ['pt', 'nubis', 'octave', 'alpha', 'rtalpha'] as const;
type RendererName = (typeof RENDERERS)[number];
// Sun setups: time of day (lat 40, as the flagship) and the camera's ring angle from the sun's azimuth (0 = sun behind the camera).
const SUNS = { noon: { time: 13, ring: 70 }, low: { time: 17.6, ring: 70 }, backlit: { time: 17.6, ring: 140 } } as const;
type SunName = keyof typeof SUNS;
const CAMERA_DISTANCE = num('distance', 1150);   // m, horizontal, from the cloud centre
const CAMERA_HEIGHT = num('height', 120);        // m above the ground
const FOV_Y = num('fov', 30);                    // vertical, degrees

const settings = {
  spp: num('spp', 1024),
  ptScale: Math.min(1, Math.max(0.125, num('ptScale', 1))),
  albedo: num('albedo', 0.99),
  g: num('g', 0.8),
  voxel: num('voxel', 2),
  maxDepth: num('maxDepth', 512),
  exposure: num('exposure', 0.35),
};
const state: { renderer: RendererName; sun: SunName } = { renderer: 'pt', sun: 'noon' };
{
  const [r, s] = (query.get('view') ?? 'pt-noon').split('-');
  if (RENDERERS.includes(r as RendererName)) state.renderer = r as RendererName;
  if (s in SUNS) state.sun = s as SunName;
}

const app = document.getElementById('app')!;
const hud = document.getElementById('hud')!;
const panel = document.getElementById('panel')!;
const ptCanvas = document.getElementById('pt') as HTMLCanvasElement;
if (query.get('clean') === '1') { hud.style.display = 'none'; panel.style.display = 'none'; }

try {
  const renderer = new WebGPURenderer({ antialias: true });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = settings.exposure;
  app.appendChild(renderer.domElement);
  await renderer.init();
  const { device } = sharedBackend(renderer);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV_Y, innerWidth / innerHeight, 1, 1500000);
  // No aerial perspective: the PT has no atmosphere between the camera and the cloud, so neither side gets one.
  const sky = new Sky(renderer, { preset: 'earth', timeOfDay: SUNS[state.sun].time, latitude: 40, north: '-Z', enableAerialPerspective: false });
  sky.attach(scene);
  await sky.compileAsync();
  const skyBridge = createSkyBridge(renderer, sky);
  const quality = (query.get('quality') ?? 'ultra') as 'ultra';
  const runtime = createCloudRuntime(device, { quality, atmosphereLayout: skyBridge.layout });
  const bridge = createCloudBridge(renderer, runtime);
  const [volumeAsset, noiseAsset] = await Promise.all([loadCloudVolume('/clouds/parkouring/'), loadCloudNoise('/clouds/noise/')]);
  const volumeMin = placeCloud(volumeAsset) as V3;
  await runtime.setVolume(volumeAsset, { position: volumeMin });
  await runtime.setNoise(noiseAsset);
  // A still: no wind (the bake is one instant), no horizon haze (no atmosphere on the PT side either).
  runtime.settings.windVelocity = [0, 0, 0];
  runtime.settings.windOffset = [0, 0, 0];
  runtime.settings.hazeDensity = 0;
  for (const [key, value] of query) if (key.startsWith('s.') && key.slice(2) in runtime.settings) (runtime.settings as unknown as Record<string, number | string>)[key.slice(2)] = Number.isNaN(Number(value)) ? value : Number(value);

  const pt = new PtReference();
  await pt.init(ptCanvas);
  pt.maxDepth = settings.maxDepth;

  const resize = () => {
    renderer.setPixelRatio(1);
    renderer.setSize(innerWidth, innerHeight, false);
    bridge.resize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    ptCanvas.width = innerWidth; ptCanvas.height = innerHeight;
  };
  addEventListener('resize', resize);
  resize();

  const centre = (): V3 => [0, 1, 2].map(i => (FOCUS_BOX.min[i] + FOCUS_BOX.max[i]) / 2) as V3;
  const sunNow = (): V3 => sunVector(sky.sunAzimuth, sky.sunElevation) as V3;
  const cameraFor = (sun: SunName): { position: V3; target: V3 } => {
    const s = sunNow(), c = centre();
    const hl = Math.hypot(s[0], s[2]) || 1;
    const a = (SUNS[sun].ring * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
    const h: [number, number] = [s[0] / hl, s[2] / hl];
    const d: [number, number] = [h[0] * cs + h[1] * sn, -h[0] * sn + h[1] * cs];   // flagship bookmarks' rotate()
    return { position: [c[0] + d[0] * CAMERA_DISTANCE, CAMERA_HEIGHT, c[2] + d[1] * CAMERA_DISTANCE], target: c };
  };

  // ---- frame loop (the flagship's, minus HUD/auto quality) ----
  let frame = 0;
  const t0 = performance.now();
  const frameData: CloudFrame = {
    view: new Float32Array(16), projection: new Float32Array(16), viewProjection: new Float32Array(16), inverseViewProjection: new Float32Array(16), previousViewProjection: new Float32Array(16),
    cameraPosition: [0, 0, 0], depth: undefined as unknown as GPUTextureView, depthKind: 'depth32float',
    sunDirection: skyBridge.values.sunDirection, atmosphere: skyBridge.bindGroup, time: 0, frameIndex: 0,
  };
  const frameWaiters: { target: number; resolve: () => void }[] = [];
  const frames = (n: number) => new Promise<void>(resolve => frameWaiters.push({ target: frame + n, resolve }));
  renderer.setAnimationLoop((now: number) => {
    camera.near = 1; camera.updateProjectionMatrix();
    sky.update(camera);
    skyBridge.update(camera);
    frameData.atmosphere = skyBridge.bindGroup;
    bridge.syncOutput();
    bridge.renderScene(scene, camera);
    if (state.renderer === 'nubis' || state.renderer === 'octave' || state.renderer === 'rtalpha') {
      bridge.fillFrame(camera, frameData);
      frameData.time = (now - t0) / 1000; frameData.frameIndex = frame;
      const encoder = device.createCommandEncoder({ label: 'pt1 runtime' });
      runtime.encode(encoder, frameData);
      device.queue.submit([encoder.finish()]);
    }
    bridge.present();
    frame++;
    for (let i = frameWaiters.length - 1; i >= 0; i--) if (frame >= frameWaiters[i].target) { frameWaiters[i].resolve(); frameWaiters.splice(i, 1); }
    harness.frame();
    if (frame % 10 === 0) updateHud();
  });

  // ---- scene setup: sun (time of day) -> camera -> sky bake -> density bake (per camera) -> PT scene ----
  const grids = new Map<string, DensityGrid>();
  let sceneKey = '';
  let skyNow: SkyBake | null = null;
  let gridNow: DensityGrid | null = null;
  let camNow: { position: V3; target: V3 } | null = null;
  let status = 'starting';
  let busy: Promise<void> = Promise.resolve();

  async function applyScene(sun: SunName): Promise<void> {
    if (sceneKey === sun) return;
    status = `sun ${sun}: sky`;
    sky.setTimeOfDay(SUNS[sun].time);
    camNow = cameraFor(sun);
    camera.position.set(...camNow.position); camera.up.set(0, 1, 0); camera.lookAt(...camNow.target); camera.updateMatrixWorld();
    await frames(12);   // the sky's LUTs follow the new sun over a frame or two
    skyNow = await bakeSky(device, skyBridge.layout, skyBridge.bindGroup, centre());
    const key = camNow.position.map(v => v.toFixed(1)).join(',');
    let grid = grids.get(key);
    if (!grid) {
      status = `sun ${sun}: density bake`;
      const m = 8;   // metres of empty margin around the occupied box
      grid = await bakeDensity(device, volumeAsset, noiseAsset, volumeMin, runtime.settings, camNow.position,
        { min: FOCUS_BOX.min.map(v => v - m) as V3, max: FOCUS_BOX.max.map(v => v + m) as V3 }, settings.voxel);
      grids.set(key, grid);
    }
    const sd = skyBridge.values.sunDirection;
    const sceneParams = { sunDir: [sd[0], sd[1], sd[2]] as V3, sky: skyNow };
    const medium = { extinction: runtime.settings.densityScale, albedo: settings.albedo, g: settings.g };
    if (grid !== gridNow || !pt.kernel || pt.medium.extinction !== medium.extinction) {
      status = `sun ${sun}: PT kernel`;
      await pt.setMedium(grid, medium, sceneParams);
      gridNow = grid;
    } else {
      pt.uploadScene(sceneParams);
    }
    pt.setView({ position: camNow.position, target: camNow.target, up: [0, 1, 0], yFovDeg: FOV_Y }, Math.round(innerWidth * settings.ptScale), Math.round(innerHeight * settings.ptScale));
    pt.reset();
    sceneKey = sun;
    status = `sun ${sun}: ready`;
  }

  // PT progress: runs while the PT view is shown and the target is not reached. Each submit is sized to ~250 ms of GPU work.
  let ptLoopOn = false;
  async function ptLoop(): Promise<void> {
    if (ptLoopOn) return;
    ptLoopOn = true;
    try {
      let passes = 1;
      while (state.renderer === 'pt' && pt.kernel && pt.samples < settings.spp) {
        const epoch = pt.epoch;
        await pt.step(Math.min(passes, settings.spp - pt.samples));
        if (epoch !== pt.epoch) continue;
        pt.present(settings.exposure);
        passes = Math.max(1, Math.min(16, Math.round(250 / Math.max(pt.passMs, 1))));
      }
      if (state.renderer === 'pt') pt.present(settings.exposure);
    } finally { ptLoopOn = false; }
  }

  function showView(): void {
    const isPt = state.renderer === 'pt' || state.renderer === 'alpha';
    ptCanvas.style.display = isPt ? 'block' : 'none';
    renderer.domElement.style.display = isPt ? 'none' : 'block';
    if (state.renderer === 'nubis' || state.renderer === 'octave') runtime.settings.lightingModel = state.renderer;
    if (state.renderer === 'rtalpha') runtime.settings.lightingModel = 'nubis';
  }

  async function setView(name: string): Promise<void> {
    const [r, s] = name.split('-');
    if (!RENDERERS.includes(r as RendererName) || !(s in SUNS)) throw new Error(`unknown view ${name}: <pt|nubis|octave|alpha>-<${Object.keys(SUNS).join('|')}>`);
    state.renderer = r as RendererName;
    showView();
    busy = busy.then(() => applyScene(s as SunName));
    await busy;
    state.sun = s as SunName;
    syncPanel();
    if (state.renderer === 'pt') void ptLoop();
    if (state.renderer === 'alpha' && camNow) await pt.presentAlpha({ position: camNow.position, target: camNow.target, up: [0, 1, 0], yFovDeg: FOV_Y });
  }

  // ---- panel ----
  const buttons = new Map<string, HTMLButtonElement>();
  for (const sun of Object.keys(SUNS) as SunName[]) {
    const row = document.createElement('div'); row.className = 'row';
    for (const r of RENDERERS) {
      const b = document.createElement('button'); b.textContent = `${r} ${sun}`;
      b.onclick = () => { void setView(`${r}-${sun}`); };
      buttons.set(`${r}-${sun}`, b); row.appendChild(b);
    }
    panel.appendChild(row);
  }
  const sppLabel = document.createElement('label'); sppLabel.append('PT spp ');
  const sppInput = Object.assign(document.createElement('input'), { type: 'number', min: '1', max: '65536', value: String(settings.spp) });
  sppInput.onchange = () => { settings.spp = Math.max(1, Number(sppInput.value) || 1); void ptLoop(); };
  sppLabel.appendChild(sppInput); panel.appendChild(sppLabel);
  function syncPanel() { for (const [k, b] of buttons) b.classList.toggle('on', k === `${state.renderer}-${state.sun}`); }
  function updateHud() {
    const s = sunNow();
    hud.textContent = [
      `PT1 reference  view ${state.renderer}-${state.sun}  [${status}]`,
      `sun el ${sky.sunElevation.toFixed(1)} az ${sky.sunAzimuth.toFixed(1)}  dir ${s.map(v => v.toFixed(2)).join(', ')}`,
      `PT ${pt.samples}/${settings.spp} spp  ${pt.width}x${pt.height}  ${pt.passMs.toFixed(0)} ms/pass  albedo ${settings.albedo} g ${settings.g} ext ${runtime.settings.densityScale}/m  maxDepth ${settings.maxDepth}`,
      gridNow ? `grid ${gridNow.resolution.join('x')} @ ${gridNow.voxel} m  max ${gridNow.densityMax.toFixed(3)}  occ ${(gridNow.occupancy * 100).toFixed(1)}%  bake ${gridNow.ms.toFixed(0)} ms` : 'grid -',
      skyNow ? `sun E ${skyNow.sun.map(v => v.toFixed(2)).join(' ')}  sky up ${skyNow.ambientUp.map(v => v.toFixed(3)).join(' ')} (map ${skyNow.envUp.map(v => v.toFixed(3)).join(' ')})` : '',
    ].join('\n');
  }

  await setView(`${state.renderer}-${state.sun}`);

  const round = (v: readonly number[], d = 4) => v.map(x => +x.toFixed(d));
  harness.ready({
    bookmark: name => setView(name),
    report: () => ({
      view: `${state.renderer}-${state.sun}`, status,
      camera: camNow, fovY: FOV_Y, viewport: [innerWidth, innerHeight],
      sun: { elevationDeg: sky.sunElevation, azimuthDeg: sky.sunAzimuth, direction: round(sunNow()), timeOfDay: SUNS[state.sun].time },
      sky: skyNow && { sunIrradiance: round(skyNow.sun), ambientUp: round(skyNow.ambientUp), ambientDown: round(skyNow.ambientDown), envMapUp: round(skyNow.envUp), envMapDown: round(skyNow.envDown) },
      grid: gridNow && { resolution: gridNow.resolution, voxel: gridNow.voxel, min: gridNow.min, max: gridNow.max, densityMax: gridNow.densityMax, occupancy: gridNow.occupancy, bakeMs: gridNow.ms },
      pt: { samples: pt.samples, target: settings.spp, film: [pt.width, pt.height], msPerPass: pt.passMs, compileMs: pt.compileMs, kernelBytes: pt.kernelBytes, maxDepth: pt.maxDepth, medium: pt.medium },
      runtime: { quality: runtime.quality, lightingModel: runtime.settings.lightingModel, densityScale: runtime.settings.densityScale, lightDensityScale: runtime.settings.lightDensityScale, phaseG: runtime.settings.phaseG, silverG: runtime.settings.silverG, silverStrength: runtime.settings.silverStrength, msStrength: runtime.settings.msStrength, ambientStrength: runtime.settings.ambientStrength },
      exposure: settings.exposure, frames: frame,
    }),
  });
  // The runtime output (rgba16float premultiplied radiance, a = transmittance) read back from its device, shown raw on the PT canvas as 1 - a.
  async function showRuntimeAlpha(): Promise<void> {
    const tex = runtime.output!;
    const w = tex.width, h = tex.height, bpr = Math.ceil((w * 8) / 256) * 256;
    const buf = device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder(); enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr }, [w, h]); device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const halves = new Uint16Array(buf.getMappedRange());
    const out = new Float32Array(w * h * 4);
    const half = (b: number) => { const e = (b >> 10) & 31, m = b & 1023, s = b >> 15 ? -1 : 1; return e === 0 ? s * m * 2 ** -24 : e === 31 ? NaN : s * (1 + m / 1024) * 2 ** (e - 15); };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const a = 1 - half(halves[(y * bpr) / 2 + x * 4 + 3]); const o = (y * w + x) * 4; out[o] = out[o + 1] = out[o + 2] = a; out[o + 3] = 1; }
    buf.unmap(); buf.destroy();
    pt.presentRaw(out, w, h);
    ptCanvas.style.display = "block"; renderer.domElement.style.display = "none";
    await frames(2);
  }
  // settle(n): the PT view waits for its sample target (n is ignored), the runtime views for n frames.
  (window.__clouds as Record<string, unknown>).settle = async (n: number) => {
    await busy;
    if (state.renderer === 'pt') {
      void ptLoop();
      while (pt.samples < settings.spp) await new Promise(r => setTimeout(r, 200));
      pt.present(settings.exposure);
      await frames(2);
    } else {
      await frames(state.renderer === "alpha" ? 2 : n);
      if (state.renderer === "rtalpha") await showRuntimeAlpha();
    }
  };
} catch (e) {
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
