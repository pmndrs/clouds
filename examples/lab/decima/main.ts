// D0 Decima parity page: one pack cloud (Parkouring or Stormbird) under the camera, sun and lens reconstructed for each of Guerrilla's
// own frames of it (refs.ts), rendered with the D1 parity settings ('decima' look, default), the deck's settings (?look=deck) or our art
// defaults (?look=art). Flagship shell (three WebGPURenderer + @pmndrs/sky, the window.__clouds contract); no ground, as the deck frames show only sky.
//   ?cloud=parkouring|stormbird   ?bookmark=<ref>   ?look=decima|deck|art   ?quality=ultra   ?exposure=0.35
//   bookmark variants (D1): @sun:el:az  @turb:t  @exp:e  @skyf:r:g:b  @sunc:r:g:b  @matte  @look:x  @s.<setting>:v
//   ?matte=1 (opacity only)   ?cam=ex,ey,ez,tx,ty,tz,vfov (relative to the cloud base, overrides the bookmark)   ?sun=elevation,azimuth   ?s.<setting>=<value>
import { ACESFilmicToneMapping, NoToneMapping, PerspectiveCamera, Scene } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { Sky } from '@pmndrs/sky';
import { cloudLookSettings, createCloudRuntime, GpuTimer, loadCloudNoise, loadCloudVolume, type CloudFrame, type CloudLook, type CloudQuality } from '@clouds/runtime';
import { sharedBackend } from '../../../packages/legacy/three/src/gpu/backend';
import { installCloudsHarness } from '../harness/clouds-contract';
import { CLOUD_BASE_HEIGHT, placeCloud } from '../flagship/bookmarks';
import { createCloudBridge } from './bridge';
import { CameraRig } from '../flagship/controls';
import { createSkyBridge } from '../flagship/sky-bridge';
import { DECIMA_REFS, DECIMA_REF_NAMES, type DecimaRef } from './refs';

const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);
const QUALITIES = ['mobile', 'low', 'medium', 'high', 'ultra'] as const;
const quality = (QUALITIES.includes(query.get('quality') as never) ? query.get('quality') : 'ultra') as CloudQuality;
const LOOKS: CloudLook[] = ['decima', 'deck', 'art'];
const asLook = (v: string | null | undefined, fallback: CloudLook): CloudLook => (LOOKS.includes(v as CloudLook) ? (v as CloudLook) : fallback);
const pageLook: CloudLook = asLook(query.get('look'), 'decima');
let look: CloudLook = pageLook;
const firstRef = DECIMA_REFS[query.get('bookmark') ?? ''] ?? Object.values(DECIMA_REFS).find(r => r.cloud === query.get('cloud')) ?? DECIMA_REFS[DECIMA_REF_NAMES[0]];
const cloudName = (query.get('cloud') === 'stormbird' || query.get('cloud') === 'parkouring') ? query.get('cloud')! : firstRef.cloud;
const nums = (key: string) => (query.get(key) ?? '').split(',').filter(Boolean).map(Number);

try {
  const app = document.getElementById('app')!;
  const renderer = new WebGPURenderer({ antialias: true, trackTimestamp: true });
  renderer.toneMapping = ACESFilmicToneMapping;
  const baseExposure = query.has('exposure') ? Number(query.get('exposure')) : 0.35;
  renderer.toneMappingExposure = baseExposure;
  app.appendChild(renderer.domElement);
  await renderer.init();
  const { device } = sharedBackend(renderer);
  const timer = new GpuTimer(device);

  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 1, 1500000);
  const rig = new CameraRig(camera, renderer.domElement);
  const sky = new Sky(renderer, { preset: 'earth', timeOfDay: 12, latitude: 40, north: '-Z' });
  sky.attach(scene);
  const sun = sky.createSun({ physical: true });
  sun.attach(scene);
  await sky.compileAsync();
  const skyBridge = createSkyBridge(renderer, sky);
  const runtime = createCloudRuntime(device, { quality, atmosphereLayout: skyBridge.layout });
  const matte = query.get('matte') === '1';   // ?matte=1: present the cloud opacity (no tone mapping) for the parity masks
  if (matte) renderer.toneMapping = NoToneMapping;
  const bridge = createCloudBridge(renderer, runtime, { matte });
  const [volumeAsset, noiseAsset] = await Promise.all([loadCloudVolume(`/clouds/${cloudName}/`), loadCloudNoise('/clouds/noise/')]);
  await runtime.setVolume(volumeAsset, { position: placeCloud(volumeAsset, CLOUD_BASE_HEIGHT) });
  await runtime.setNoise(noiseAsset);
  // D1: every bookmark starts from the runtime's own defaults, so a variant that is not a look knob (lightDebug, mipDistanceScale, temporal*,
  // inlineLightScale...) cannot leak from one shot into the next of a capture run.
  const baseSettings = JSON.parse(JSON.stringify({ ...runtime.settings, lightning: undefined }));
  const applyLook = () => {
    for (const [k, val] of Object.entries(baseSettings)) if (val !== undefined && k !== 'lightning') (runtime.settings as unknown as Record<string, unknown>)[k] = Array.isArray(val) ? [...val] : val;
    Object.assign(runtime.settings, cloudLookSettings(look, quality));
    for (const [key, value] of query) if (key.startsWith('s.') && key.slice(2) in runtime.settings) (runtime.settings as unknown as Record<string, number | string>)[key.slice(2)] = Number.isNaN(Number(value)) ? value : Number(value);
  };
  applyLook();

  const resize = () => {
    renderer.setPixelRatio(1);
    renderer.setSize(innerWidth, innerHeight, false);
    bridge.resize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  resize();

  let current = '';
  let turbidityNow = 1;
  let skyFactorNow = '1,1,1';
  let sunColorNow = '1,1,1';
  const base = (p: readonly number[]) => [p[0], p[1] + CLOUD_BASE_HEIGHT, p[2]] as [number, number, number];
  // A bookmark is a ref name with optional variants for sweeps in one capture run, '@'-separated, ':' between key and values:
  //   p101@sun:45:335@look:art@exp:0.3@turb:4@matte@s.densityScale:0.2@cam:ex:ey:ez:tx:ty:tz:vfov
  const applyRef = (bookmark: string) => {
    const [name, ...variants] = bookmark.split('@');
    const ref: DecimaRef | undefined = DECIMA_REFS[name];
    if (!ref) throw new Error(`unknown bookmark: ${name}`);
    if (ref.cloud !== cloudName) throw new Error(`${name} shows ${ref.cloud}; load the page with ?cloud=${ref.cloud}`);
    current = bookmark;
    const v = new Map(variants.map(x => { const [k, ...rest] = x.split(':'); return [k, rest] as const; }));
    look = v.has('look') ? asLook(v.get('look')![0], pageLook) : pageLook;   // each bookmark starts from the page's look
    applyLook();
    for (const [k, val] of v) if (k.startsWith('s.') && k.slice(2) in runtime.settings) (runtime.settings as unknown as Record<string, number | string>)[k.slice(2)] = Number.isNaN(Number(val[0])) ? val[0] : Number(val[0]);
    const cam = v.has('cam') ? v.get('cam')!.map(Number) : nums('cam');
    const eye = cam.length === 7 ? base(cam.slice(0, 3)) : base(ref.eye);
    const target = cam.length === 7 ? base(cam.slice(3, 6)) : base(ref.target);
    camera.fov = cam.length === 7 ? cam[6] : ref.vfov;
    camera.updateProjectionMatrix();
    rig.set(eye, target);
    const s = v.has('sun') ? v.get('sun')!.map(Number) : nums('sun');
    sky.setSunDirection(s.length === 2 ? { elevation: s[0], azimuth: s[1] } : ref.sun);
    const turbidity = v.has('turb') ? Number(v.get('turb')![0]) : (ref.turbidity ?? 1);
    if (turbidity !== turbidityNow) { sky.setTurbidity(turbidity); turbidityNow = turbidity; }
    // D1 sky colour variants: skyf:r:g:b = per-channel sky tint (Unreal SkyLuminanceFactor; the cloud's ambient follows through the LUTs),
    // sunc:r:g:b = sun colour (linear). Both reset to 1 when a bookmark lacks them.
    const skyf = v.has('skyf') ? v.get('skyf')!.map(Number) : (ref.skyFactor ?? [1, 1, 1]);
    if (skyf.join() !== skyFactorNow) { sky.setSkyLuminanceFactor(skyf); skyFactorNow = skyf.join(); }
    const sunc = v.has('sunc') ? v.get('sunc')!.map(Number) : (ref.sunColor ?? [1, 1, 1]);
    if (sunc.join() !== sunColorNow) { sky.setSunColor(sunc); sunColorNow = sunc.join(); }
    bridge.matte = matte || v.has('matte');
    renderer.toneMapping = bridge.matte ? NoToneMapping : ACESFilmicToneMapping;
    renderer.toneMappingExposure = v.has('exp') ? Number(v.get('exp')![0]) : query.has('exposure') ? baseExposure : (ref.exposure ?? baseExposure);
    runtime.resetTemporal();
    syncLook();
  };

  const hud = document.getElementById('hud')!;
  const panel = document.getElementById('panel')!;
  if (query.get('clean') === '1') { hud.style.display = 'none'; panel.style.display = 'none'; }
  for (const name of DECIMA_REF_NAMES.filter(n => DECIMA_REFS[n].cloud === cloudName)) {
    const b = document.createElement('button'); b.textContent = name; b.title = DECIMA_REFS[name].source; b.onclick = () => applyRef(name); panel.appendChild(b);
  }
  const lookBtn = document.createElement('button');
  const syncLook = () => { lookBtn.textContent = `look: ${look}`; };
  lookBtn.onclick = () => { look = LOOKS[(LOOKS.indexOf(look) + 1) % LOOKS.length]; applyLook(); syncLook(); };
  syncLook(); panel.appendChild(lookBtn);

  const frameData: CloudFrame = {
    view: new Float32Array(16), projection: new Float32Array(16), viewProjection: new Float32Array(16), inverseViewProjection: new Float32Array(16), previousViewProjection: new Float32Array(16),
    cameraPosition: [0, 0, 0], depth: undefined as unknown as GPUTextureView, depthKind: 'depth32float',
    sunDirection: skyBridge.values.sunDirection, atmosphere: skyBridge.bindGroup, time: 0, frameIndex: 0,
  };
  const t0 = performance.now();
  let last = t0, frame = 0;
  renderer.setAnimationLoop((now: number) => {
    const dt = Math.min(0.25, (now - last) / 1000); last = now;
    rig.update(dt);
    camera.near = Math.min(200, Math.max(0.5, camera.position.y * 0.002));
    camera.updateProjectionMatrix();
    sky.update(camera);
    void sky.updateAerialPerspective();
    skyBridge.update(camera);
    bridge.syncOutput();
    bridge.renderScene(scene, camera);
    bridge.fillFrame(camera, frameData);
    frameData.time = (now - t0) / 1000; frameData.frameIndex = frame;
    timer.beginFrame();
    const encoder = device.createCommandEncoder({ label: 'decima cloud encoder' });
    runtime.encode(encoder, frameData, timer);
    timer.endFrame(encoder);
    device.queue.submit([encoder.finish()]);
    bridge.present();
    if (frame++ % 15 === 0) hud.textContent = `${current} (${DECIMA_REFS[current]?.source ?? ''})  look ${look}  q ${runtime.quality}\ncam ${camera.position.toArray().map(v => v.toFixed(0)).join(', ')}  vfov ${camera.fov.toFixed(1)}\nsun el ${sky.sunElevation.toFixed(1)} az ${sky.sunAzimuth.toFixed(1)}`;
    harness.frame();
  });

  applyRef(DECIMA_REFS[query.get('bookmark') ?? ''] ? query.get('bookmark')! : DECIMA_REF_NAMES.find(n => DECIMA_REFS[n].cloud === cloudName)!);
  harness.ready({
    bookmark: name => applyRef(name),
    report: () => ({ bookmark: current, look, cloud: cloudName, camera: camera.position.toArray(), vfov: camera.fov, sunElevation: sky.sunElevation, sunAzimuth: sky.sunAzimuth, quality: runtime.quality, gpuMs: timer.averages(), frameMs: {}, renderSize: runtime.renderSize, settings: runtime.settings }),
  });
} catch (e) {
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
