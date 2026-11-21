// Flagship shell: three WebGPURenderer + @pmndrs/sky + ground, orbit/free-fly camera, HUD, bookmarks and the window.__clouds contract.
// Frame: scene -> render target (+depth); runtime encodes march + composite; a QuadMesh blends scene * a + rgb and tone-maps.
import { ACESFilmicToneMapping, PerspectiveCamera, Scene } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { Sky } from '@pmndrs/sky';
import { CLOUD_QUALITY_PRESETS, MATERIAL_SETTINGS, controlledCost, createCloudRuntime, GpuTimer, loadCloudNoise, loadCloudVolume, type CloudFrame, type CloudQualityOption } from '@clouds/runtime';
import { sharedBackend } from '../../../packages/legacy/three/src/gpu/backend';
import { installCloudsHarness } from '../harness/clouds-contract';
import { BOOKMARK_HFOV, BOOKMARK_NAMES, FOCUS_BOX, INSIDE_POINT, bookmarkTime, isBookmarkName, placeCloud, resolveBookmark, sunVector, type BookmarkName } from './bookmarks';
import { createCloudBridge } from './three-bridge';
import { CameraRig } from './controls';
import { createSkyBridge } from './sky-bridge';

const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);
const QUALITIES = ['auto', 'mobile', 'low', 'medium', 'high', 'ultra'] as const;   // ?quality=auto&budget=2: tier from the adapter, render scale from the GPU timer toward a 2 ms budget
const CLOUDS = ['parkouring', 'stormbird', 'houdini-test', 'heroes/tower', 'heroes/valley-fog', 'heroes/fairweather', 'heroes/sim-cumulus', 'heroes/sim-congestus', 'disney', 'disney-fine', 'heroes/sim-cumulus-fine', 'heroes/sim-congestus-fine', 'local/bunny-cloud', 'local/cloud-0001', 'local/cloudpack-02', 'local/cloudpack-03', 'local/cloudpack-08', 'local/cloudpack-09', 'local/cloudpack-10', 'local/a2/base', 'local/a2/wide'] as const;
const R1_LOCAL = /^local\/(r1|direct)\/[\w-]+$/; // R1: local experiment assets; V2: direct assets (scripts/vdb/vdb_to_direct.py); both gitignored
const requestedCloud = CLOUDS.includes(query.get('cloud') as never) || R1_LOCAL.test(query.get('cloud') ?? '') ? (query.get('cloud') as string) : 'parkouring';
// M1: imported VDBs (EmberGen, Pyro, artist VDBs) render directly by default: `local/<name>` loads `local/direct/<name>` (scripts/vdb/vdb_to_direct.py)
// when that asset exists. `?chain=nubis` keeps the Nubis NVDF chain (scripts/vdb/vdb_to_nvdf.py --mode fog, with C2's closing).
const CHAIN = query.get('chain') === 'nubis' ? 'nubis' : 'direct';
async function resolveCloud(name: string): Promise<string> {
  if (CHAIN !== 'direct' || !/^local\/(?!direct\/|r1\/)/.test(name)) return name;
  const direct = name.replace(/^local\//, 'local/direct/');
  try {
    const r = await fetch(`/clouds/${direct}/cloud.json`);
    if (r.ok && (await r.json()).direct) return direct;
  } catch { /* no direct asset: the NVDF chain */ }
  return name;
}
const cloudName = await resolveCloud(requestedCloud);
const state = {
  bookmark: (isBookmarkName(query.get('bookmark') ?? '') ? query.get('bookmark') : 'ground') as BookmarkName,
  time: query.has('time') ? Number(query.get('time')) : bookmarkTime('ground'),
  scale: Math.min(2, Math.max(0.25, Number(query.get('scale') ?? 1) || 1)),
  quality: QUALITIES.includes(query.get('quality') as never) ? (query.get('quality') as string) : 'high',
  animateTime: query.get('animateTime') === '1',
  timeRate: 0.5, // hours of sky time per real second when animating
};
const ANIMATE_WARMUP_FRAMES = 30;
const BUDGET_MS = Number(query.get('budget') ?? 3);
const TRACE_FRAMES = Number(query.get('trace') ?? 0);   // ?trace=N records the first N frames' render scale and cloud ms (the auto-quality convergence trace, in the report)
const PAN_PER_FRAME = Number(query.get('pan') ?? 0) * Math.PI / 180;   // ?pan=D yaws the camera D degrees per frame (a motion test for the temporal resolve)

try {
  const app = document.getElementById('app')!;
  const renderer = new WebGPURenderer({ antialias: true, trackTimestamp: true });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = query.has('exposure') ? Number(query.get('exposure')) : 0.35; // sky luminanceScale is 40; exposure is the only global brightness control
  app.appendChild(renderer.domElement);
  await renderer.init();
  const { device } = sharedBackend(renderer);
  const timer = new GpuTimer(device);

  const scene = new Scene();
  const camera = new PerspectiveCamera(70, 1, 1, 1500000);
  const rig = new CameraRig(camera, renderer.domElement);

  const sky = new Sky(renderer, { preset: 'earth', timeOfDay: state.time, latitude: 40, north: '-Z' });
  sky.attach(scene);
  const ground = sky.createGround({ mode: 'plane', size: 8000000, color: 0x34461f, roughness: 1 });
  ground.attach(scene);
  if (query.get('noground') === '1') ground.mesh.visible = false;
  const sun = sky.createSun({ physical: true }); // sun light colour/intensity come from the sky LUTs, not hard-coded
  sun.attach(scene);
  await sky.compileAsync();
  // Sun, ambient and aerial perspective for the clouds come from the sky's LUTs through this bridge.
  const skyBridge = createSkyBridge(renderer, sky);
  // ?p.<field>=<value> edits the chosen tier's preset before the runtime is created (tuning aid: ?quality=low&p.farScale=0.25)
  for (const [key, value] of query) if (key.startsWith('p.') && state.quality in CLOUD_QUALITY_PRESETS && key.slice(2) in CLOUD_QUALITY_PRESETS[state.quality as 'high']) (CLOUD_QUALITY_PRESETS[state.quality as 'high'] as unknown as Record<string, number | boolean>)[key.slice(2)] = value === 'true' ? true : value === 'false' ? false : Number(value);
  const runtime = createCloudRuntime(device, { quality: state.quality as CloudQualityOption, atmosphereLayout: skyBridge.layout, budgetMs: BUDGET_MS, expectedPixels: innerWidth * innerHeight * state.scale * state.scale });
  const bridge = createCloudBridge(renderer, runtime);
  const assetStart = performance.now();
  const [volumeAsset, noiseAsset] = await Promise.all([loadCloudVolume(`/clouds/${cloudName}/`), loadCloudNoise('/clouds/noise/')]);
  const assetsLoadedAt = performance.now();
  let firstCloudFrameMs = -1; // ms from assets loaded to the first frame the runtime encoded clouds
  await runtime.setVolume(volumeAsset, { position: placeCloud(volumeAsset, query.has('base') ? Number(query.get('base')) : undefined) });
  await runtime.setNoise(noiseAsset);
  // M1: ?material=m1 puts the Karma-fitted material balance on an NVDF (Nubis chain) volume too; a direct volume gets it from setVolume.
  if (query.get('material') === 'm1' && !volumeAsset.direct) Object.assign(runtime.settings, MATERIAL_SETTINGS);
  for (const [key, value] of query) if (key.startsWith('s.') && key.slice(2) in runtime.settings) (runtime.settings as unknown as Record<string, number | string>)[key.slice(2)] = Number.isNaN(Number(value)) ? value : Number(value);
  // P0.5: ?converged=1 the converged march (ground truth of the image; ?s.convergedStepScale / ?s.convergedSamples tune it); the panel has the switch.
  if (query.get('converged') === '1') runtime.settings.converged = 1;

  // Render size follows the window times the render-scale control. Canvas CSS stays 100%.
  const renderSize = { width: 1, height: 1 };
  const resize = () => {
    renderer.setPixelRatio(1);
    renderSize.width = Math.max(1, Math.round(innerWidth * state.scale));
    renderSize.height = Math.max(1, Math.round(innerHeight * state.scale));
    renderer.setSize(renderSize.width, renderSize.height, false);
    bridge.resize(renderSize.width, renderSize.height);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  resize();

  const setTime = (hours: number) => { state.time = ((hours % 24) + 24) % 24; sky.setTimeOfDay(state.time); };
  // compass azimuth / elevation in degrees (the library reports degrees)
  const sunNow = () => sunVector(sky.sunAzimuth, sky.sunElevation);
  const applyBookmark = (name: string) => {
    // `path:<t>` flies from the edge bookmark (t = 0) to the inside point (t = 1), looking at the edge target:
    // sampled by the capture harness to check for popping across the near/far split.
    const path = /^path:([0-9.]+)$/.exec(name);
    if (path) {
      const t = Math.min(1, Math.max(0, Number(path[1])));
      setTime(bookmarkTime('edge'));
      const a = resolveBookmark('edge', sunNow());
      const pos = a.position.map((v, i) => v + (INSIDE_POINT[i] - v) * t) as [number, number, number];
      const dir = a.target.map((v, i) => v - a.position[i]);
      rig.set(pos, pos.map((v, i) => v + dir[i]) as [number, number, number]);
      return;
    }
    if (!isBookmarkName(name)) throw new Error(`unknown bookmark: ${name}`);
    state.bookmark = name;
    // calibration framings use a photographic lens (horizontal FOV); everything else the default 70 degree vertical
    { const h = BOOKMARK_HFOV[name]; camera.fov = h ? (2 * Math.atan(Math.tan((h * Math.PI) / 360) / camera.aspect) * 180) / Math.PI : 70; camera.updateProjectionMatrix(); }
    setTime(query.has('time') && !state.animateTime ? Number(query.get('time')) : bookmarkTime(name));
    const b = resolveBookmark(name, sunNow());
    rig.set(b.position, b.target);
    syncPanel();
  };

  // ---- HUD + panel ----
  const hud = document.getElementById('hud')!;
  const panel = document.getElementById('panel')!;
  if (query.get('clean') === '1') { hud.style.display = 'none'; panel.style.display = 'none'; }   // ?clean=1: no HUD or panel (calibration captures)
  const frameTimes: number[] = [];
  const sceneGpu: number[] = [];
  const extraGpu: Record<string, number> = {};
  let timestampBusy = false;
  const pct = (p: number) => { if (!frameTimes.length) return 0; const s = [...frameTimes].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const passSamples: Record<string, number>[] = [];   // per frame, the latest readback of every pass (duplicates when no new one arrived): medians resist the idle-GPU clock ramp and spikes
  const gpuMedian = () => { const out: Record<string, number> = {}; const names = new Set(passSamples.flatMap(s => Object.keys(s))); for (const n of names) { const v = passSamples.map(s => s[n]).filter(x => x !== undefined).sort((a, b) => a - b); if (v.length) out[n] = v[v.length >> 1]; } return out; };
  const gpuMs = () => ({ scene: mean(sceneGpu), ...extraGpu, ...timer.averages() });
  const frameStats = () => ({ p50: pct(0.5), p95: pct(0.95), last: frameTimes[frameTimes.length - 1] ?? 0 });

  const controls: Record<string, HTMLElement> = {};
  function el(tag: 'input', props?: Partial<HTMLInputElement>, parent?: HTMLElement): HTMLInputElement;
  function el(tag: 'select', props?: Partial<HTMLSelectElement>, parent?: HTMLElement): HTMLSelectElement;
  function el(tag: 'option', props?: Partial<HTMLOptionElement>, parent?: HTMLElement): HTMLOptionElement;
  function el(tag: 'button', props?: Partial<HTMLButtonElement>, parent?: HTMLElement): HTMLButtonElement;
  function el(tag: 'label' | 'div', props?: Partial<HTMLElement>, parent?: HTMLElement): HTMLElement;
  function el(tag: string, props: object = {}, parent: HTMLElement = panel): HTMLElement { const e = Object.assign(document.createElement(tag), props); parent.appendChild(e); return e; }
  const label = (text: string) => { const l = el('label'); l.append(text); return l; };
  const timeInput = el('input', { type: 'range', min: '0', max: '24', step: '0.05' }, label('time'));
  timeInput.oninput = () => { state.animateTime = false; animateBox.checked = false; setTime(Number(timeInput.value)); };
  const scaleInput = el('input', { type: 'range', min: '0.25', max: '2', step: '0.05' }, label('scale'));
  scaleInput.oninput = () => { state.scale = Number(scaleInput.value); resize(); };
  const qualitySel = el('select', {}, label('quality'));
  for (const q of QUALITIES) el('option', { value: q, textContent: q }, qualitySel);
  qualitySel.onchange = () => { state.quality = qualitySel.value; if (state.quality !== 'auto') runtime.setQuality(state.quality as never); };   // (switching to auto needs a reload: ?quality=auto)
  const animateBox = el('input', { type: 'checkbox' }, label('animate'));
  animateBox.onchange = () => { state.animateTime = animateBox.checked; };
  const shadowInput = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(runtime.settings.shadowStrength) }, label('shadow'));
  shadowInput.oninput = () => { runtime.settings.shadowStrength = Number(shadowInput.value); };
  // P0.5: the converged march (slow: seconds per frame; the HUD counts the samples).
  const convergedBox = el('input', { type: 'checkbox', checked: runtime.settings.converged > 0.5, title: 'P0.5 converged march: every pixel every frame at full resolution, no history, steps / convergedStepScale, convergedSamples frames averaged with their own jitter. Ground truth for the image (stepping, jitter, temporal, upscaling); slow.' }, label('converged'));
  convergedBox.onchange = () => { runtime.settings.converged = convergedBox.checked ? 1 : 0; };
  const modeBtn = el('button', { textContent: 'mode: orbit (F)' });
  const toggleMode = () => { rig.setMode(rig.mode === 'orbit' ? 'fly' : 'orbit'); modeBtn.textContent = `mode: ${rig.mode} (F)`; };
  modeBtn.onclick = toggleMode;
  addEventListener('keydown', e => { if (e.code === 'KeyF' && !(e.target instanceof HTMLInputElement)) toggleMode(); });
  const row = el('div', { className: 'row' });
  for (const name of BOOKMARK_NAMES) { const b = el('button', { textContent: name }, row); b.onclick = () => applyBookmark(name); controls[name] = b; }
  function syncPanel() {
    timeInput.value = String(state.time); scaleInput.value = String(state.scale); qualitySel.value = state.quality; animateBox.checked = state.animateTime;
    for (const name of BOOKMARK_NAMES) controls[name].classList.toggle('on', name === state.bookmark);
  }
  const f = (n: number, d = 2) => n.toFixed(d);
  const tierText = () => (runtime.auto ? `auto > ${runtime.quality}` : runtime.quality);
  const updateHud = () => {
    const g = gpuMs(), fs = frameStats();
    const fps = fs.p50 > 0 ? 1000 / fs.p50 : 0;
    hud.textContent = [
      `fps ${f(fps, 0)}   frame ${f(fs.last)} ms  (p50 ${f(fs.p50)}  p95 ${f(fs.p95)})`,
      `render ${renderSize.width}x${renderSize.height} (x${state.scale})  q:${tierText()}  t:${f(state.time)}h`,
      ...(runtime.auto ? [`auto  tier ${runtime.auto.tier}  scale ${f(runtime.settings.renderScale)}  cloud ${f(runtime.auto.costMs)} / ${f(runtime.auto.budgetMs)} ms  changes ${runtime.auto.changes}`] : []),
      `mem ${f(runtime.memory.total / 1048576, 1)} MB (history ${f(runtime.temporalInfo.bytes / 1048576, 1)})`,
      ...(runtime.convergedInfo.active ? [`converged march ${runtime.convergedInfo.samples} / ${runtime.convergedInfo.target}${runtime.convergedInfo.done ? ' (done)' : ''}  steps / ${runtime.settings.convergedStepScale}`] : []),
      `gpu ms${timer.enabled || sceneGpu.length ? '' : ' (no timestamp-query)'}`,
      ...Object.entries(g).map(([k, v]) => `  ${k.padEnd(12)} ${f(v)}`),
      `cam ${camera.position.toArray().map(v => f(v, 0)).join(', ')}  [${rig.mode}${rig.mode === 'fly' ? ` ${f(rig.speed, 0)} m/s` : ''}]`,
    ].join('\n');
  };

  const trace: number[][] = [];   // [frame, render scale, cloud ms (last readback), smoothed ms]
  const frameData: CloudFrame = {
    view: new Float32Array(16), projection: new Float32Array(16), viewProjection: new Float32Array(16), inverseViewProjection: new Float32Array(16), previousViewProjection: new Float32Array(16),
    cameraPosition: [0, 0, 0], depth: undefined as unknown as GPUTextureView, depthKind: 'depth32float',
    sunDirection: skyBridge.values.sunDirection, atmosphere: skyBridge.bindGroup, time: 0, frameIndex: 0,
  };

  // ---- frame loop ----
  const t0 = performance.now();
  let last = t0, frame = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (frame > ANIMATE_WARMUP_FRAMES) { frameTimes.push(dt * 1000); if (frameTimes.length > 240) frameTimes.shift(); }
    if (state.animateTime) { setTime(state.time + dt * state.timeRate); timeInput.value = String(state.time); }
    if (PAN_PER_FRAME !== 0) { const p = camera.position, t = rig.orbit.target, dx = t.x - p.x, dz = t.z - p.z, c = Math.cos(PAN_PER_FRAME), sn = Math.sin(PAN_PER_FRAME); rig.set([p.x, p.y, p.z], [p.x + dx * c - dz * sn, t.y, p.z + dx * sn + dz * c]); }
    rig.update(dt);
    // keep the near plane proportional to altitude so depth precision holds from 2 m to tens of km
    camera.near = Math.min(200, Math.max(0.5, camera.position.y * 0.002));
    camera.updateProjectionMatrix();
    ground.mesh.position.set(camera.position.x, 0, camera.position.z);
    sky.update(camera);
    void sky.updateAerialPerspective(); // per-frame AP LUT, queued before the cloud passes
    skyBridge.update(camera);

    bridge.syncOutput();
    bridge.renderScene(scene, camera);
    bridge.fillFrame(camera, frameData);
    frameData.time = (now - t0) / 1000; frameData.frameIndex = frame;
    timer.beginFrame();
    const encoder = device.createCommandEncoder({ label: 'flagship cloud encoder' });
    runtime.encode(encoder, frameData, timer);
    timer.endFrame(encoder);
    device.queue.submit([encoder.finish()]);
    bridge.present();
    passSamples.push({ ...timer.last() }); if (passSamples.length > 150) passSamples.shift();
    if (frame < TRACE_FRAMES) trace.push([frame, +runtime.settings.renderScale.toFixed(3), +controlledCost(timer.last()).toFixed(3), +(runtime.auto?.costMs ?? 0).toFixed(3)]);

    // three timestamps: resolve asynchronously, one request in flight, never awaited by the loop
    if (!timestampBusy) {
      timestampBusy = true;
      renderer.resolveTimestampsAsync('render').then(ms => {
        if (typeof ms === 'number' && ms > 0) { sceneGpu.push(ms); if (sceneGpu.length > 60) sceneGpu.shift(); }
        return renderer.resolveTimestampsAsync('compute');
      }).then(ms => { if (typeof ms === 'number' && ms > 0) extraGpu.skyCompute = ms; }).catch(() => {}).finally(() => { timestampBusy = false; });
    }
    if (frame++ % 10 === 0) updateHud();
    if (firstCloudFrameMs < 0 && runtime.ready) firstCloudFrameMs = performance.now() - assetsLoadedAt;
    harness.frame();
  };
  renderer.setAnimationLoop(loop);

  applyBookmark(state.bookmark);
  if (query.has('time')) setTime(Number(query.get('time')));
  harness.ready({
    bookmark: name => applyBookmark(name),
    busy: () => runtime.convergedInfo.active && !runtime.convergedInfo.done,   // P0.5: settle waits for the converged sum
    report: () => ({ converged: runtime.convergedInfo, camera: camera.position.toArray(), hfovDeg: (2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect) * 180) / Math.PI, focusBox: FOCUS_BOX, gpuMs: gpuMs(), gpuMedian: gpuMedian(), frameMs: frameStats(), renderSize: [renderSize.width, renderSize.height], bookmark: state.bookmark, timeOfDay: state.time, sunElevation: sky.sunElevation, sunAzimuth: sky.sunAzimuth, animateTime: state.animateTime, quality: runtime.quality, qualityOption: state.quality, auto: runtime.auto, renderScale: runtime.settings.renderScale, memory: runtime.memory, cloud: cloudName, frames: frame, temporal: runtime.temporalInfo, trace: TRACE_FRAMES ? trace : undefined, assetLoadMs: assetsLoadedAt - assetStart, firstCloudFrameMs }),
  });
} catch (e) {
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
