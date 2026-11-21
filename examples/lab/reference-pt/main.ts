// PT1 reference lab: the same cloud density lit by an unbiased multiple-scattering path tracer (the owner's @pmndrs/pathtracer, P5 volumes)
// and by our realtime runtime (Nubis lighting, octave lighting), same camera, same sun, same sky, same tone mapping.
//
// P0.4: the page is the scene card. ?cloud=parkouring|embergen02|wdas|sky|stratus picks one of five densities (cards.ts CARD_DEFS: source,
// box, voxel, extinction scale, camera ring, how the runtime renders it) and four suns (noon, low, backlit, sunset).
//  - parkouring: the Nubis pack hero, placed as on the flagship. The PT reads a dense bake of the runtime's own up-rezzed density
//    (DENSITY_WGSL on the runtime's device, each voxel at its distance to the camera so the noise mip matches the march) times the runtime's
//    view extinction (settings.densityScale). The runtime renders the NVDF itself, as always (PT1 / P0.3, unchanged).
//  - the others: one f32 field on the runtime's lattice reaches both sides (direct.ts): the runtime marches it as a direct volume (vdb-sky's
//    route A), the PT reads the same r16f texels. VDBs are resampled by vdb-direct.ts; the procedural patches are baked by proc-bake.ts.
// Sky: @pmndrs/sky with aerial perspective off and our horizon haze off (the PT has no atmosphere between camera and cloud); the PT's
// environment is the runtime's own sky-view LUT as an equirect, its sun the runtime's sun at the cloud centre (a delta light).
// Wind frozen (the bake is a still).
//
// Views (bookmarks, also the panel): <renderer>-<sun>, renderer pt | nubis | octave | alpha | rtalpha, sun noon | low | backlit | sunset.
// URL: ?cloud=parkouring &view=pt-noon &spp=1024 &ptScale=1 &albedo=0.99 &g=0.8 &voxel=2 &maxDepth=512 &quality=ultra &exposure=0.35 &seed=1
//      &distance= &height= (override the cloud's camera ring)
// P0.6 (Review section of the panel; each also a URL parameter): &ptTest=furnace|absorber (the PT medium checks: no sun, a uniform sky of
//      radiance 1; furnace = albedo 1, so every pixel must read 1; absorber = albedo 0, so each pixel reads the transmittance),
//      &majorant=brick|global (the PT's delta-tracking majorant), &extScale=1 (multiplies the card's extinction), &alphaFilter=nearest|trilinear.
//      window.__clouds.exportManifest() writes the current frame as a scripts/reference/ manifest (capture.mjs --export <dir> saves it).
// P0.3: window.__clouds.readLinear() reads the current view back as linear scene radiance (float32 RGBA, before exposure and ACES):
// the PT accumulator / samples, the runtime's composite (scene HDR target * transmittance + cloud), or the opacity masks. See linear.ts and
// scripts/gpu/capture.mjs --linear (saves PFM next to each screenshot).
// P0.4: window.__clouds.frameScene() is the one place a card frame's scene can be dumped from (grid, sky equirect, sun, camera, medium);
// report().card carries its parameters for the manifest.
import { ACESFilmicToneMapping, PerspectiveCamera, Scene } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { Sky } from '@pmndrs/sky';
import { createCloudRuntime, loadCloudNoise, type CloudFrame } from '@clouds/runtime';
import { sharedBackend } from '../../../packages/legacy/three/src/gpu/backend';
import { installCloudsHarness } from '../harness/clouds-contract';
import { sunVector } from '../flagship/bookmarks';
import { createCloudBridge } from '../flagship/three-bridge';
import { createSkyBridge } from '../flagship/sky-bridge';
import { vdbDeviceLimits } from '../vdb-sky/vdb-direct';
import { bakeSky, type DensityGrid, type SkyBake, type V3 } from './bake';
import { CARD_CLOUDS, CARD_DEFS, SUNS, loadCard, type CardCloudKey, type CardScene, type SunName } from './cards';
import { PtReference } from './pt';
import { chunk, composite, describe, readRgba16f, type LinearFrame } from './linear';

const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);
const num = (k: string, d: number) => (query.has(k) && Number.isFinite(Number(query.get(k))) ? Number(query.get(k)) : d);

// alpha: the PT side's opacity mask of the baked grid (1 - exp(-optical depth)), for the sheet's statistics.
// rtalpha: the runtime's own opacity (1 - the march's transmittance, read back from its output after the settle): checks the bake against the march.
const RENDERERS = ['pt', 'nubis', 'octave', 'alpha', 'rtalpha'] as const;
type RendererName = (typeof RENDERERS)[number];
const CLOUD: CardCloudKey = (CARD_CLOUDS as readonly string[]).includes(query.get('cloud') ?? '') ? (query.get('cloud') as CardCloudKey) : 'parkouring';
const DEF = CARD_DEFS[CLOUD];
const CAMERA_DISTANCE = num('distance', DEF.camera.distance);   // m, horizontal, from the cloud centre
const CAMERA_HEIGHT = num('height', DEF.camera.height);         // m above the ground
const FOV_Y = num('fov', 30);                                    // vertical, degrees

const settings = {
  spp: num('spp', 1024),
  ptScale: Math.min(1, Math.max(0.125, num('ptScale', 1))),
  albedo: num('albedo', 0.99),
  g: num('g', 0.8),
  voxel: num('voxel', 2),
  maxDepth: num('maxDepth', 512),
  exposure: num('exposure', 0.35),
  seed: num('seed', 1),
  extScale: num('extScale', 1),
  majorant: (query.get('majorant') === 'global' ? 'global' : 'brick') as 'brick' | 'global',
};
// P0.6: the PT medium checks (see the header). 'off' is the card.
const PT_TESTS = ['off', 'furnace', 'absorber'] as const;
type PtTest = (typeof PT_TESTS)[number];
const PT_TEST: PtTest = (PT_TESTS as readonly string[]).includes(query.get('ptTest') ?? '') ? (query.get('ptTest') as PtTest) : 'off';
/** A uniform sky of radiance 1 in every channel (the furnace and absorber light). */
const uniformSky = (): SkyBake => ({ env: { width: 64, height: 32, channels: 4, data: new Float32Array(64 * 32 * 4).fill(1) }, sun: [0, 0, 0], ambientUp: [1, 1, 1], ambientDown: [1, 1, 1], envUp: [1, 1, 1], envDown: [1, 1, 1] });
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
  // The VDB clouds need the pool's device limits (and room for large direct volumes); Parkouring keeps the PT1 renderer as it was.
  let requiredLimits: Record<string, number> | undefined;
  if (CLOUD === 'embergen02' || CLOUD === 'wdas') {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('WebGPU: no adapter');
    requiredLimits = vdbDeviceLimits(adapter);
  }
  const renderer = new WebGPURenderer({ antialias: true, ...(requiredLimits ? { requiredLimits } : {}) } as ConstructorParameters<typeof WebGPURenderer>[0]);
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
  const noiseAsset = await loadCloudNoise('/clouds/noise/');
  let status = 'starting';
  const card: CardScene = await loadCard(CLOUD, { device, runtime, noiseAsset, parkouringVoxel: settings.voxel, status: s => { status = s; } });
  await runtime.setNoise(noiseAsset);
  // A still: no wind (the bake is one instant), no horizon haze (no atmosphere on the PT side either).
  runtime.settings.windVelocity = [0, 0, 0];
  runtime.settings.windOffset = [0, 0, 0];
  runtime.settings.hazeDensity = 0;
  for (const [key, value] of query) if (key.startsWith('s.') && key.slice(2) in runtime.settings) (runtime.settings as unknown as Record<string, number | string>)[key.slice(2)] = Number.isNaN(Number(value)) ? value : Number(value);

  const pt = new PtReference();
  await pt.init(ptCanvas);
  pt.maxDepth = settings.maxDepth;
  pt.seed = settings.seed;
  pt.alphaFilter = query.get('alphaFilter') === 'nearest' || query.get('alphaFilter') === 'trilinear' ? (query.get('alphaFilter') as 'nearest' | 'trilinear') : DEF.alphaFilter;
  pt.majorant = settings.majorant;

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

  const centre = (): V3 => [0, 1, 2].map(i => (card.focus.min[i] + card.focus.max[i]) / 2) as V3;
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

  // ---- scene setup: sun (time of day) -> camera -> sky bake -> density grid (per camera for Parkouring) -> PT scene ----
  const grids = new Map<string, DensityGrid>();
  let sceneKey = '';
  let skyNow: SkyBake | null = null;
  let gridNow: DensityGrid | null = null;
  let camNow: { position: V3; target: V3 } | null = null;
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
      status = `sun ${sun}: density grid`;
      grid = await card.grid(camNow.position);
      grids.set(key, grid);
    }
    const sd = skyBridge.values.sunDirection;
    const sceneParams = PT_TEST === 'off' ? { sunDir: [sd[0], sd[1], sd[2]] as V3, sky: skyNow } : { sunDir: [sd[0], sd[1], sd[2]] as V3, sky: uniformSky(), noSun: true };
    const medium = { extinction: card.ptExtinction() * settings.extScale, albedo: PT_TEST === 'furnace' ? 1 : PT_TEST === 'absorber' ? 0 : settings.albedo, g: settings.g };
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
  let ptStarted = 0, ptWallMs = 0;
  async function ptLoop(): Promise<void> {
    if (ptLoopOn) return;
    ptLoopOn = true;
    try {
      let passes = 1;
      if (pt.samples === 0) ptStarted = performance.now();
      while (state.renderer === 'pt' && pt.kernel && pt.samples < settings.spp) {
        const epoch = pt.epoch;
        await pt.step(Math.min(passes, settings.spp - pt.samples));
        if (epoch !== pt.epoch) { ptStarted = performance.now(); continue; }
        pt.present(settings.exposure);
        passes = Math.max(1, Math.min(16, Math.round(250 / Math.max(pt.passMs, 1))));
        ptWallMs = performance.now() - ptStarted;
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
    if (!RENDERERS.includes(r as RendererName) || !(s in SUNS)) throw new Error(`unknown view ${name}: <${RENDERERS.join('|')}>-<${Object.keys(SUNS).join('|')}>`);
    state.renderer = r as RendererName;
    showView();
    busy = busy.then(() => applyScene(s as SunName));
    await busy;
    state.sun = s as SunName;
    syncPanel();
    if (state.renderer === 'pt') void ptLoop();
    if (state.renderer === 'alpha' && camNow) await pt.presentAlpha({ position: camNow.position, target: camNow.target, up: [0, 1, 0], yFovDeg: FOV_Y });
  }

  // ---- panel: every cloud (reloads the page with ?cloud=), every renderer x sun, the PT sample target ----
  const cloudRow = document.createElement('label'); cloudRow.append('cloud ');
  const cloudSel = document.createElement('select');
  for (const k of CARD_CLOUDS) { const o = document.createElement('option'); o.value = k; o.textContent = CARD_DEFS[k].label; cloudSel.append(o); }
  cloudSel.value = CLOUD;
  cloudSel.onchange = () => { const q = new URLSearchParams(location.search); q.set('cloud', cloudSel.value); q.set('view', `${state.renderer}-${state.sun}`); location.search = q.toString(); };
  cloudRow.appendChild(cloudSel); panel.appendChild(cloudRow);
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
  // P0.6 Review: the PT medium checks (each reloads the page with its URL parameter, as the cloud select does).
  const review = document.createElement('div'); review.className = 'row'; review.append('Review: PT test ');
  const reload = (k: string, v: string) => { const q = new URLSearchParams(location.search); q.set(k, v); q.set('view', `${state.renderer}-${state.sun}`); location.search = q.toString(); };
  const select = (key: string, options: readonly string[], value: string) => {
    const el = document.createElement('select');
    for (const v of options) { const o = document.createElement('option'); o.value = o.textContent = v; el.append(o); }
    el.value = value; el.onchange = () => reload(key, el.value); return el;
  };
  review.append(select('ptTest', PT_TESTS, PT_TEST), ' majorant ', select('majorant', ['brick', 'global'], settings.majorant), ' ext x ',
    select('extScale', ['1', '0.3333333'], String(settings.extScale) === '1' ? '1' : '0.3333333'), ' depth ', select('maxDepth', ['512', '4096'], String(settings.maxDepth)));
  panel.appendChild(review);
  function syncPanel() { for (const [k, b] of buttons) b.classList.toggle('on', k === `${state.renderer}-${state.sun}`); }
  function updateHud() {
    const s = sunNow();
    hud.textContent = [
      `PT1 reference  cloud ${CLOUD}  view ${state.renderer}-${state.sun}  [${status}]`,
      `sun el ${sky.sunElevation.toFixed(1)} az ${sky.sunAzimuth.toFixed(1)}  dir ${s.map(v => v.toFixed(2)).join(', ')}`,
      `${PT_TEST === 'off' ? '' : `PT TEST ${PT_TEST} (no sun, sky 1)  `}majorant ${pt.majorant}  PT ${pt.samples}/${settings.spp} spp  ${pt.width}x${pt.height}  ${pt.passMs.toFixed(0)} ms/pass  albedo ${pt.medium.albedo} g ${settings.g} ext ${pt.medium.extinction.toPrecision(4)}/m per unit  maxDepth ${settings.maxDepth}`,
      gridNow ? `grid ${gridNow.resolution.join('x')} @ ${gridNow.voxel} m  max ${gridNow.densityMax.toFixed(3)}  occ ${(gridNow.occupancy * 100).toFixed(1)}%  bake ${gridNow.ms.toFixed(0)} ms` : 'grid -',
      skyNow ? `sun E ${skyNow.sun.map(v => v.toFixed(2)).join(' ')}  sky up ${skyNow.ambientUp.map(v => v.toFixed(3)).join(' ')} (map ${skyNow.envUp.map(v => v.toFixed(3)).join(' ')})` : '',
    ].join('\n');
  }

  await setView(`${state.renderer}-${state.sun}`);

  const round = (v: readonly number[], d = 4) => v.map(x => +x.toFixed(d));
  harness.ready({
    bookmark: name => setView(name),
    report: () => ({
      view: `${state.renderer}-${state.sun}`, status, cloud: CLOUD,
      camera: camNow, fovY: FOV_Y, viewport: [innerWidth, innerHeight],
      sun: { elevationDeg: sky.sunElevation, azimuthDeg: sky.sunAzimuth, direction: round(sunNow()), timeOfDay: SUNS[state.sun].time, ring: SUNS[state.sun].ring },
      sky: skyNow && { sunIrradiance: round(skyNow.sun), ambientUp: round(skyNow.ambientUp), ambientDown: round(skyNow.ambientDown), envMapUp: round(skyNow.envUp), envMapDown: round(skyNow.envDown) },
      grid: gridNow && { resolution: gridNow.resolution, voxel: gridNow.voxel, min: gridNow.min, max: gridNow.max, densityMax: gridNow.densityMax, occupancy: gridNow.occupancy, bakeMs: gridNow.ms },
      ptTest: PT_TEST,
      pt: { majorant: pt.majorant, extScale: settings.extScale, samples: pt.samples, target: settings.spp, seed: pt.seed, film: [pt.width, pt.height], msPerPass: pt.passMs, wallMs: ptWallMs, compileMs: pt.compileMs, kernelBytes: pt.kernelBytes, maxDepth: pt.maxDepth, medium: pt.medium, alphaFilter: pt.alphaFilter },
      runtime: { quality: runtime.quality, lightingModel: runtime.settings.lightingModel, densityScale: runtime.settings.densityScale, directDensity: runtime.settings.directDensity, lightDensityScale: runtime.settings.lightDensityScale, phaseG: runtime.settings.phaseG, silverG: runtime.settings.silverG, silverStrength: runtime.settings.silverStrength, msStrength: runtime.settings.msStrength, ambientStrength: runtime.settings.ambientStrength, ambientSaturation: runtime.settings.ambientSaturation, diffuseSun: runtime.settings.diffuseSun, microShadow: runtime.settings.microShadow },
      card: { def: DEF, cameraRing: { distance: CAMERA_DISTANCE, height: CAMERA_HEIGHT }, ...card.describe() },
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

  // ---- P0.3: linear readback ----
  let lastLinear: LinearFrame | null = null;
  async function readLinear(): Promise<LinearFrame> {
    await busy;
    const view = `${state.renderer}-${state.sun}`;
    const cam = camNow!;
    const ptCam = { position: cam.position, target: cam.target, up: [0, 1, 0] as V3, yFovDeg: FOV_Y };
    if (state.renderer === 'pt') {
      const data = await pt.readLinear();
      return { view, kind: 'radiance', width: pt.width, height: pt.height, data, meta: { samples: pt.samples, seed: pt.seed, units: 'accumulator / samples' } };
    }
    if (state.renderer === 'alpha') {
      return { view, kind: 'alpha', width: pt.width, height: pt.height, data: await pt.readAlpha(ptCam), meta: { source: `bake opacity 1 - exp(-tau), ${pt.alphaFilter}` } };
    }
    // Runtime views: the scene's HDR target (the sky) and the runtime's composite output, both rgba16float, composited as the bridge's quad does.
    const sceneTex = sharedBackend(renderer).texture(bridge.sceneTarget.texture);
    const [sceneLin, cloudLin] = await Promise.all([readRgba16f(device, sceneTex), readRgba16f(device, runtime.output!)]);
    const rgba = composite(sceneLin.data, cloudLin.data);
    if (state.renderer === 'rtalpha') {
      for (let i = 0; i < rgba.length; i += 4) rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3];
      return { view, kind: 'alpha', width: sceneLin.width, height: sceneLin.height, data: rgba, meta: { source: 'runtime 1 - transmittance', frame } };
    }
    return { view, kind: 'radiance', width: sceneLin.width, height: sceneLin.height, data: rgba, meta: { lightingModel: runtime.settings.lightingModel, frame, units: 'scene * transmittance + cloud, before exposure and tone mapping' } };
  }
  const contract = window.__clouds as Record<string, unknown>;
  /** Reads the current view (after settle) into the page; returns its size and mean. Fetch the floats with linearChunk(offset, bytes). */
  contract.readLinear = async () => { lastLinear = null; lastLinear = await readLinear(); return describe(lastLinear); };
  contract.linearChunk = (offset: number, length: number) => { if (!lastLinear) throw new Error('readLinear() first'); return chunk(lastLinear, offset, length); };

  /**
   * P0.4: everything a card frame's scene is made of, from one place (for an external reference renderer: scripts/reference/ reads a per-frame
   * manifest, a raw float32 grid and a PFM sky). `withData` adds the arrays: the grid (world axes x, y, z; x fastest; sigma_t = density *
   * medium.extinction) and the sky equirect (RGBA f32, row 0 = +Y, u = atan2(x, -z) / 2 pi, exposure units). The sun is a delta light of
   * `sun.irradiance` from `sun.direction` (towards the sun).
   */
  function frameScene(withData = false) {
    const grid = gridNow!, sk = skyNow!, cam = camNow!;
    const sd = skyBridge.values.sunDirection;
    return {
      cloud: CLOUD, view: `${state.renderer}-${state.sun}`,
      grid: { resolution: grid.resolution, min: grid.min, max: grid.max, voxel: grid.voxel, densityMax: grid.densityMax, ...(withData ? { density: grid.density } : {}) },
      medium: { ...pt.medium },
      sun: { direction: [sd[0], sd[1], sd[2]], irradiance: sk.sun, elevationDeg: sky.sunElevation, azimuthDeg: sky.sunAzimuth, timeOfDay: SUNS[state.sun].time },
      sky: { width: sk.env.width, height: sk.env.height, ...(withData ? { data: sk.env.data } : {}) },
      camera: { position: cam.position, target: cam.target, up: [0, 1, 0], yFovDeg: FOV_Y, film: [pt.width, pt.height] },
      pt: { maxDepth: pt.maxDepth, spp: settings.spp, seed: pt.seed },
    };
  }
  contract.frameScene = () => frameScene(false);

  /**
   * P0.6: the current frame as a scripts/reference/ manifest (README "What the exporting side must write"): `manifest.json`, the grid as raw
   * float32 (`density.f32`, x fastest, sigma_t = density * extinctionScale) and the sky as an equirect PFM (`sky.pfm`, RGB, bottom row first),
   * or a uniform sky in a PT test. The PT clips its medium at the grid box and Cycles does not, so a grid with density on a face gets a zero
   * margin of one voxel (the origin moves out by one voxel; reported as `padded`). Returns the manifest and the file sizes; capture.mjs
   * --export <dir> pulls each file with exportChunk(name, offset, length) (base64) and writes them next to the manifest.
   */
  const exportFiles = new Map<string, Uint8Array>();
  contract.exportManifest = async () => {
    await busy;
    const grid = gridNow!, cam = camNow!, sd = skyBridge.values.sunDirection;
    const [nx, ny, nz] = grid.resolution;
    let faceVoxels = 0;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (i > 0 && i < nx - 1 && j > 0 && j < ny - 1 && k > 0 && k < nz - 1) { i = nx - 2; continue; }
      if (grid.density[i + nx * (j + ny * k)] > 0) faceVoxels++;
    }
    let density = grid.density, dims: V3 = [nx, ny, nz], origin: V3 = [...grid.min];
    if (faceVoxels > 0) {
      dims = [nx + 2, ny + 2, nz + 2];
      density = new Float32Array(dims[0] * dims[1] * dims[2]);
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) density.set(grid.density.subarray(nx * (j + ny * k), nx * (j + ny * k) + nx), 1 + dims[0] * (j + 1 + dims[1] * (k + 1)));
      origin = [origin[0] - grid.voxel, origin[1] - grid.voxel, origin[2] - grid.voxel];
    }
    exportFiles.clear();
    exportFiles.set('density.f32', new Uint8Array(density.buffer, density.byteOffset, density.byteLength));
    let sky: Record<string, unknown> = { uniform: [1, 1, 1] };
    if (PT_TEST === 'off') {
      const env = skyNow!.env, w = env.width, h = env.height;
      const header = new TextEncoder().encode(`PF\n${w} ${h}\n-1.0\n`);
      const body = new Float32Array(w * h * 3);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) body[((h - 1 - y) * w + x) * 3 + c] = env.data[(y * w + x) * 4 + c];
      const pfm = new Uint8Array(header.length + body.byteLength);
      pfm.set(header, 0); pfm.set(new Uint8Array(body.buffer), header.length);
      exportFiles.set('sky.pfm', pfm);
      sky = { file: 'sky.pfm', mapping: 'equirect-rowtop+Y-u=atan2(x,-z)/2pi', scale: 1 };
    }
    const manifest = {
      notes: `WebGPUClouds reference-pt export: cloud ${CLOUD}, view ${state.renderer}-${state.sun}, ptTest ${PT_TEST}, majorant ${pt.majorant}`,
      source: { cloud: CLOUD, view: `${state.renderer}-${state.sun}`, ptTest: PT_TEST, majorant: pt.majorant, extScale: settings.extScale, padded: faceVoxels > 0, faceVoxels, densityMax: grid.densityMax },
      grid: { file: 'density.f32', dims, order: 'x-fastest', voxel: grid.voxel, origin, extinctionScale: pt.medium.extinction },
      medium: { albedo: pt.medium.albedo, phase: { type: 'hg', g: pt.medium.g } },
      sun: PT_TEST === 'off' ? { direction: [sd[0], sd[1], sd[2]], irradiance: [...skyNow!.sun], angularRadius: 0 } : null,
      sky,
      ground: null,
      camera: { position: cam.position, target: cam.target, up: [0, 1, 0], fovY: FOV_Y, width: pt.width, height: pt.height },
      render: { spp: settings.spp, maxBounces: pt.maxDepth, seed: pt.seed, russianRoulette: false },
    };
    return { manifest, files: Object.fromEntries([...exportFiles].map(([k, v]) => [k, v.byteLength])) };
  };
  contract.exportChunk = async (name: string, offset: number, length: number) => {
    const bytes = exportFiles.get(name);
    if (!bytes) throw new Error(`exportManifest() first (no ${name})`);
    const part = bytes.subarray(offset, Math.min(bytes.byteLength, offset + length));
    const url: string = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result as string); r.onerror = () => reject(r.error); r.readAsDataURL(new Blob([part as Uint8Array<ArrayBuffer>])); });
    return url.slice(url.indexOf(',') + 1);
  };
  (contract as Record<string, unknown>).__frameSceneData = () => frameScene(true);

  /**
   * P0.4 tools for choosing and checking the procedural patches (scripts only): `scanProcedural(kind, box, voxel)` bakes `kind`'s model ('sky' |
   * 'stratus' settings) over `box` and returns per-column optical depth, top and base (row-major, x fastest); `bakeAlpha(kind, box, voxel,
   * camera?)` bakes a box and returns the PT side's opacity mask of it from the current camera (as alpha frames: readLinear after it).
   */
  const bakerFor = async (kind: 'sky' | 'stratus') => {
    const { PROC_PATCHES } = await import('./cards');
    const { createProcBaker } = await import('./proc-bake');
    return createProcBaker(device, noiseAsset, p => { p.settings.lightingModel = 'nubis'; p.settings.hzd.lightProfile = 'exact'; Object.assign(p.settings.hzd, PROC_PATCHES[kind].configure); });
  };
  contract.scanProcedural = async (kind: 'sky' | 'stratus', box: { min: V3; max: V3 }, voxel: number) => {
    const { columnStats } = await import('./proc-bake');
    const baker = await bakerFor(kind);
    const c: V3 = [(box.min[0] + box.max[0]) / 2, 2, (box.min[2] + box.max[2]) / 2];
    const g = await baker.bake(box, voxel, { t: CAMERA_DISTANCE, footprint: voxel, camera: c });
    baker.dispose();
    const s = columnStats(g);
    const r = (a: Float32Array) => Array.from(a, v => Math.round(v * 10) / 10);
    return { nx: s.nx, nz: s.nz, min: g.min, voxel, densityMax: g.densityMax, occupancy: g.occupancy, ms: g.ms, tau: r(s.tau), top: r(s.top), base: r(s.base) };
  };
  contract.bakeAlpha = async (kind: 'sky' | 'stratus', box: { min: V3; max: V3 }, voxel: number) => {
    const baker = await bakerFor(kind);
    const c: V3 = [(box.min[0] + box.max[0]) / 2, 2, (box.min[2] + box.max[2]) / 2];
    const g = await baker.bake(box, voxel, { t: CAMERA_DISTANCE, footprint: voxel, camera: c });
    baker.dispose();
    const cam = camNow!;
    const keep = gridNow;
    // The alpha kernel reads the PT's grid: swap the baked one in for the mask (a sigma grid: extinction 1), then put the card's back.
    await pt.setMedium(g, { extinction: 1, albedo: settings.albedo, g: settings.g }, { sunDir: [0, 1, 0], sky: skyNow! });
    const data = await pt.readAlpha({ position: cam.position, target: cam.target, up: [0, 1, 0], yFovDeg: FOV_Y });
    lastLinear = { view: `bakeAlpha-${kind}-${voxel}`, kind: 'alpha', width: pt.width, height: pt.height, data, meta: { box, voxel, grid: g.resolution } };
    if (keep) { const sd = skyBridge.values.sunDirection; await pt.setMedium(keep, { extinction: card.ptExtinction(), albedo: settings.albedo, g: settings.g }, { sunDir: [sd[0], sd[1], sd[2]], sky: skyNow! }); pt.reset(); }
    return describe(lastLinear);
  };
} catch (e) {
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
