// Flagship shell: three WebGPURenderer + @pmndrs/sky + ground, orbit/free-fly camera, HUD, bookmarks and the window.__clouds contract.
// Frame: scene -> render target (+depth); runtime encodes march + composite; a QuadMesh blends scene * a + rgb and tone-maps.
import { ACESFilmicToneMapping, PerspectiveCamera, Scene } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { Sky } from '@pmndrs/sky';
import { createCloudRuntime, GpuTimer, loadCloudNoise, loadCloudVolume, type CloudFrame, type CloudQuality } from '@clouds/runtime';
import { sharedBackend } from '../../../packages/three/src/gpu/backend';
import { installCloudsHarness } from '../harness/clouds-contract';
import { BOOKMARK_NAMES, bookmarkTime, isBookmarkName, placeCloud, resolveBookmark, type BookmarkName } from './bookmarks';
import { createCloudBridge } from './three-bridge';
import { CameraRig } from './controls';

const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);
const QUALITIES = ['low', 'medium', 'high'] as const;
const CLOUDS = ['parkouring', 'stormbird'] as const;
const cloudName = CLOUDS.includes(query.get('cloud') as never) ? (query.get('cloud') as string) : 'parkouring';
const state = {
  bookmark: (isBookmarkName(query.get('bookmark') ?? '') ? query.get('bookmark') : 'ground') as BookmarkName,
  time: query.has('time') ? Number(query.get('time')) : bookmarkTime('ground'),
  scale: Math.min(2, Math.max(0.25, Number(query.get('scale') ?? 1) || 1)),
  quality: QUALITIES.includes(query.get('quality') as never) ? (query.get('quality') as string) : 'high',
  animateTime: query.get('animateTime') === '1',
  timeRate: 0.5, // hours of sky time per real second when animating
};
const ANIMATE_WARMUP_FRAMES = 30;

try {
  const app = document.getElementById('app')!;
  const renderer = new WebGPURenderer({ antialias: true, trackTimestamp: true });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  app.appendChild(renderer.domElement);
  await renderer.init();
  const { device } = sharedBackend(renderer);
  const timer = new GpuTimer(device);
  const runtime = createCloudRuntime(device, { quality: state.quality as CloudQuality });
  const bridge = createCloudBridge(renderer, runtime);
  const [volumeAsset, noiseAsset] = await Promise.all([loadCloudVolume(`/clouds/${cloudName}/`), loadCloudNoise('/clouds/noise/')]);
  await runtime.setVolume(volumeAsset, { position: placeCloud(volumeAsset) });
  await runtime.setNoise(noiseAsset);
  for (const [key, value] of query) if (key.startsWith('s.') && key.slice(2) in runtime.settings) (runtime.settings as unknown as Record<string, number>)[key.slice(2)] = Number(value);

  const scene = new Scene();
  const camera = new PerspectiveCamera(70, 1, 1, 1500000);
  const rig = new CameraRig(camera, renderer.domElement);

  const sky = new Sky(renderer, { preset: 'earth', timeOfDay: state.time, latitude: 40, north: '-Z' });
  sky.attach(scene);
  const ground = sky.createGround({ mode: 'plane', size: 2000000, color: 0x34461f, roughness: 1 });
  ground.attach(scene);
  if (query.get('noground') === '1') ground.mesh.visible = false;
  const sun = sky.createSun({ physical: true }); // sun light colour/intensity come from the sky LUTs, not hard-coded
  sun.attach(scene);
  await sky.compileAsync();

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
  const sunHorizontal = (): [number, number] => {
    // compass azimuth, clockwise from north; north = -Z so east = +X. Library reports degrees.
    const az = (sky.sunAzimuth * Math.PI) / 180;
    return [Math.sin(az), -Math.cos(az)];
  };
  const applyBookmark = (name: string) => {
    if (!isBookmarkName(name)) throw new Error(`unknown bookmark: ${name}`);
    state.bookmark = name;
    setTime(query.has('time') && !state.animateTime ? Number(query.get('time')) : bookmarkTime(name));
    const b = resolveBookmark(name, sunHorizontal());
    rig.set(b.position, b.target);
    syncPanel();
  };

  // ---- HUD + panel ----
  const hud = document.getElementById('hud')!;
  const panel = document.getElementById('panel')!;
  const frameTimes: number[] = [];
  const sceneGpu: number[] = [];
  const extraGpu: Record<string, number> = {};
  let timestampBusy = false;
  const pct = (p: number) => { if (!frameTimes.length) return 0; const s = [...frameTimes].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
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
  qualitySel.onchange = () => { state.quality = qualitySel.value; runtime.setQuality(state.quality as CloudQuality); };
  const animateBox = el('input', { type: 'checkbox' }, label('animate'));
  animateBox.onchange = () => { state.animateTime = animateBox.checked; };
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
  const updateHud = () => {
    const g = gpuMs(), fs = frameStats();
    const fps = fs.p50 > 0 ? 1000 / fs.p50 : 0;
    hud.textContent = [
      `fps ${f(fps, 0)}   frame ${f(fs.last)} ms  (p50 ${f(fs.p50)}  p95 ${f(fs.p95)})`,
      `render ${renderSize.width}x${renderSize.height} (x${state.scale})  q:${state.quality}  t:${f(state.time)}h`,
      `gpu ms${timer.enabled || sceneGpu.length ? '' : ' (no timestamp-query)'}`,
      ...Object.entries(g).map(([k, v]) => `  ${k.padEnd(12)} ${f(v)}`),
      `cam ${camera.position.toArray().map(v => f(v, 0)).join(', ')}  [${rig.mode}${rig.mode === 'fly' ? ` ${f(rig.speed, 0)} m/s` : ''}]`,
    ].join('\n');
  };

  // Sun and ambient come from the sky: the physical sun light carries luminanceScale x T(sun) as colour x intensity.
  // TEMPORARY ambient (P1-02 replaces it with sky-view LUT lookups): sky irradiance ~ the sun's scattered-away share,
  // tinted by what the atmosphere removed from the sun (1 - T), ground bounce from the sun colour.
  const frameData: CloudFrame = {
    view: new Float32Array(16), projection: new Float32Array(16), viewProjection: new Float32Array(16), inverseViewProjection: new Float32Array(16), previousViewProjection: new Float32Array(16),
    cameraPosition: [0, 0, 0], depth: undefined as unknown as GPUTextureView, depthKind: 'depth32float',
    sunDirection: [0, 1, 0], sunRadiance: [0, 0, 0], ambientTop: [0, 0, 0], ambientBottom: [0, 0, 0], time: 0, frameIndex: 0,
  };
  const SKY_AMBIENT_FRACTION = 0.035, GROUND_BOUNCE_FRACTION = 0.03;
  const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const updateSkyLighting = () => {
    const l = sun.light;
    const dir = frameData.sunDirection as number[];
    dir[0] = l.position.x - sun.target.position.x; dir[1] = l.position.y - sun.target.position.y; dir[2] = l.position.z - sun.target.position.z;
    const n = Math.hypot(dir[0], dir[1], dir[2]) || 1; dir[0] /= n; dir[1] /= n; dir[2] /= n;
    const E = [l.color.r * l.intensity, l.color.g * l.intensity, l.color.b * l.intensity];
    const e0 = sky.baker.sky.luminanceScale.value as number; // sun illuminance above the atmosphere, sky units
    const lumE = luma(E[0], E[1], E[2]);
    const removed = E.map(v => Math.max(0.02, 1 - v / e0));
    const tintNorm = luma(removed[0], removed[1], removed[2]) || 1;
    const rad = frameData.sunRadiance as number[], top = frameData.ambientTop as number[], bottom = frameData.ambientBottom as number[];
    for (let i = 0; i < 3; i++) {
      rad[i] = E[i];
      top[i] = (removed[i] / tintNorm) * lumE * SKY_AMBIENT_FRACTION;
      bottom[i] = E[i] * GROUND_BOUNCE_FRACTION * Math.max(0, dir[1]);
    }
  };

  // ---- frame loop ----
  const t0 = performance.now();
  let last = t0, frame = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (frame > ANIMATE_WARMUP_FRAMES) { frameTimes.push(dt * 1000); if (frameTimes.length > 240) frameTimes.shift(); }
    if (state.animateTime) { setTime(state.time + dt * state.timeRate); timeInput.value = String(state.time); }
    rig.update(dt);
    // keep the near plane proportional to altitude so depth precision holds from 2 m to tens of km
    camera.near = Math.min(200, Math.max(0.5, camera.position.y * 0.002));
    camera.updateProjectionMatrix();
    ground.mesh.position.set(camera.position.x, 0, camera.position.z);
    sky.update(camera);

    bridge.renderScene(scene, camera);
    bridge.fillFrame(camera, frameData);
    updateSkyLighting();
    frameData.time = (now - t0) / 1000; frameData.frameIndex = frame;
    timer.beginFrame();
    const encoder = device.createCommandEncoder({ label: 'flagship cloud encoder' });
    runtime.encode(encoder, frameData, timer);
    timer.endFrame(encoder);
    device.queue.submit([encoder.finish()]);
    bridge.present();

    // three timestamps: resolve asynchronously, one request in flight, never awaited by the loop
    if (!timestampBusy) {
      timestampBusy = true;
      renderer.resolveTimestampsAsync('render').then(ms => {
        if (typeof ms === 'number' && ms > 0) { sceneGpu.push(ms); if (sceneGpu.length > 60) sceneGpu.shift(); }
        return renderer.resolveTimestampsAsync('compute');
      }).then(ms => { if (typeof ms === 'number' && ms > 0) extraGpu.skyCompute = ms; }).catch(() => {}).finally(() => { timestampBusy = false; });
    }
    if (frame++ % 10 === 0) updateHud();
    harness.frame();
  };
  renderer.setAnimationLoop(loop);

  applyBookmark(state.bookmark);
  if (query.has('time')) setTime(Number(query.get('time')));
  harness.ready({
    bookmark: name => applyBookmark(name),
    report: () => ({ gpuMs: gpuMs(), frameMs: frameStats(), renderSize: [renderSize.width, renderSize.height], bookmark: state.bookmark, timeOfDay: state.time, animateTime: state.animateTime, quality: state.quality, cloud: cloudName, frames: frame }),
  });
} catch (e) {
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
