// P2-04 test page: flagship-like setup (main view) plus the reflection dome unwrapped as an equirect panorama overlay.
// Panorama: x = compass azimuth -180..180 (0 = north = -Z, +90 = east = +X), y = elevation 80 (top) .. -10 (bottom).
// Markers: S sun, C cloud centre as seen from the dome's reference point, V the main camera's view direction.
// Before reporting ready the page runs two checks (sun-change refresh and frame stall), see report().sunTest.
import { ACESFilmicToneMapping, PerspectiveCamera, Scene, Vector3 } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { Sky } from '@pmndrs/sky';
import { cloudDomeWgsl, createCloudRuntime, uploadCloudVolume, domeTexelDirection, GpuTimer, loadCloudNoise, loadCloudVolume, type CloudFrame, type CloudQuality } from '@clouds/runtime';
import { sharedBackend } from '../../../../packages/legacy/three/src/gpu/backend';
import { installCloudsHarness } from '../../harness/clouds-contract';
import { BOOKMARK_NAMES, FOCUS_BOX, bookmarkTime, isBookmarkName, placeCloud, resolveBookmark, sunVector, type BookmarkName } from '../../flagship/bookmarks';
import { createCloudBridge } from '../../flagship/three-bridge';
import { createSkyBridge } from '../../flagship/sky-bridge';

const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);
const state = {
  bookmark: (isBookmarkName(query.get('bookmark') ?? '') ? query.get('bookmark') : 'ground') as BookmarkName,
  time: 14,
  quality: (query.get('quality') ?? 'high') as CloudQuality,
};
const EL_TOP = 80, EL_BOTTOM = -10;

try {
  const renderer = new WebGPURenderer({ antialias: true, trackTimestamp: true });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = query.has('exposure') ? Number(query.get('exposure')) : 0.35;
  document.getElementById('app')!.appendChild(renderer.domElement);
  await renderer.init();
  const { device } = sharedBackend(renderer);
  const timer = new GpuTimer(device);

  const scene = new Scene();
  const camera = new PerspectiveCamera(70, 1, 1, 1500000);
  const sky = new Sky(renderer, { preset: 'earth', timeOfDay: state.time, latitude: 40, north: '-Z' });
  sky.attach(scene);
  const ground = sky.createGround({ mode: 'plane', size: 8000000, color: 0x34461f, roughness: 1 });
  ground.attach(scene);
  const sun = sky.createSun({ physical: true });
  sun.attach(scene);
  await sky.compileAsync();
  const skyBridge = createSkyBridge(renderer, sky);
  const runtime = createCloudRuntime(device, { quality: state.quality, atmosphereLayout: skyBridge.layout });
  const bridge = createCloudBridge(renderer, runtime);
  const [volumeAsset, noiseAsset] = await Promise.all([loadCloudVolume('/clouds/parkouring/'), loadCloudNoise('/clouds/noise/')]);
  // ?volume=gpu exercises setVolume(GpuCloudVolume); ?lighting=uniform exercises CloudFrame.lighting (no atmosphere bind group).
  await runtime.setVolume(query.get('volume') === 'gpu' ? uploadCloudVolume(device, volumeAsset) : volumeAsset, { position: placeCloud(volumeAsset) });
  await runtime.setNoise(noiseAsset);

  const W = Math.max(1, innerWidth), H = Math.max(1, innerHeight);
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  bridge.resize(W, H);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();

  const setTime = (hours: number) => { state.time = ((hours % 24) + 24) % 24; sky.setTimeOfDay(state.time); };
  const sunNow = () => sunVector(sky.sunAzimuth, sky.sunElevation);
  const applyBookmark = (name: string) => {
    if (!isBookmarkName(name)) throw new Error(`unknown bookmark: ${name}`);
    state.bookmark = name;
    setTime(bookmarkTime(name));
    const b = resolveBookmark(name, sunNow());
    camera.position.set(b.position[0], b.position[1], b.position[2]);
    camera.lookAt(b.target[0], b.target[1], b.target[2]);
    camera.near = Math.min(200, Math.max(0.5, camera.position.y * 0.002));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    placeMarkers();
  };

  // ---- panorama overlay (equirect unwrap of the dome through cloudDomeSample) ----
  const panoCanvas = document.getElementById('panoCanvas') as HTMLCanvasElement;
  const ctx = panoCanvas.getContext('webgpu')!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });
  const panoModule = device.createShaderModule({ label: 'dome panorama', code: /* wgsl */ `
${cloudDomeWgsl(0, 0)}
struct V { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
  let p = vec2(f32((i << 1u) & 2u), f32(i & 2u));
  return V(vec4(p * 2.0 - 1.0, 0.0, 1.0), vec2(p.x, 1.0 - p.y));
}
@fragment fn fs(v: V) -> @location(0) vec4<f32> {
  let az = (v.uv.x * 2.0 - 1.0) * PI_;
  let el = radians(${EL_TOP}.0 + v.uv.y * (${EL_BOTTOM}.0 - ${EL_TOP}.0));
  let dir = vec3(sin(az) * cos(el), sin(el), -cos(az) * cos(el));
  let c = cloudDomeSample(dir);
  // neutral grey checker behind the clouds (debug only); radiance is in the sky's exposure units, tone-mapped like the main view
  let g = 10.0 * f32(i32(floor(degrees(az) / 30.0)) + i32(floor(degrees(el) / 30.0)));
  let bg = vec3(select(0.10, 0.16, (i32(g / 10.0) & 1) == 0));
  let x = c.rgb * 0.35 + bg * c.a;
  let mapped = x / (1.0 + x);
  return vec4(pow(mapped, vec3(1.0 / 2.2)), 1.0);
}
const PI_ = 3.14159265358979;
` });
  const panoPipeline = device.createRenderPipeline({ label: 'dome panorama', layout: 'auto',
    vertex: { module: panoModule, entryPoint: 'vs' }, fragment: { module: panoModule, entryPoint: 'fs', targets: [{ format }] } });
  const panoGroup = device.createBindGroup({ layout: panoPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: runtime.dome.view }] });
  const drawPanorama = () => {
    const encoder = device.createCommandEncoder({ label: 'dome panorama' });
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
    pass.setPipeline(panoPipeline); pass.setBindGroup(0, panoGroup); pass.draw(3); pass.end();
    device.queue.submit([encoder.finish()]);
  };
  const labels = document.getElementById('panoLabels')!;
  const addLabel = (text: string, az: number) => { const e = document.createElement('div'); e.className = 'l'; e.style.left = `${((az + 180) / 360) * 100}%`; e.textContent = text; labels.appendChild(e); };
  for (const [t, a] of [['W', -90], ['N', 0], ['E', 90], ['S', 180], ['S', -180]] as const) addLabel(t, a);
  const title = document.createElement('div'); title.className = 't'; title.textContent = `dome ${runtime.dome.size}^2 octahedral, equirect unwrap, el ${EL_BOTTOM}..${EL_TOP}`; labels.appendChild(title);
  const markers: Record<string, HTMLDivElement> = {};
  for (const [k, color] of [['S', '#ff0'], ['C', '#0ff'], ['V', '#f0f']] as const) { const e = document.createElement('div'); e.className = 'm'; e.style.color = color; e.textContent = k; labels.appendChild(e); markers[k] = e; }
  const azEl = (d: ArrayLike<number>) => {
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    return { az: (Math.atan2(d[0], -d[2]) * 180) / Math.PI, el: (Math.asin(d[1] / l) * 180) / Math.PI };
  };
  const cloudCentre = () => FOCUS_BOX.min.map((v, i) => (v + FOCUS_BOX.max[i]) / 2);
  let expected = { az: 0, el: 0 };
  function placeMarkers() {
    const put = (k: string, d: ArrayLike<number>) => {
      const { az, el } = azEl(d);
      markers[k].style.left = `${((az + 180) / 360) * 100}%`;
      markers[k].style.top = `${((EL_TOP - el) / (EL_TOP - EL_BOTTOM)) * 100}%`;
      return { az, el };
    };
    const c = cloudCentre(), r = runtime.dome.referencePoint;
    const ref = [camera.position.x, runtime.dome.settings.groundHeight, camera.position.z];
    void r;
    expected = put('C', [c[0] - ref[0], c[1] - ref[1], c[2] - ref[2]]);
    put('S', sunNow());
    put('V', camera.getWorldDirection(new Vector3()).toArray());
  }

  // ---- dome readback (test only) ----
  const bytesPerRow = runtime.dome.size * 8;
  const readBuffer = device.createBuffer({ label: 'dome readback', size: bytesPerRow * runtime.dome.size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const half = (h: number) => { const e = (h >> 10) & 31, m = h & 1023, s = h & 0x8000 ? -1 : 1; return e === 0 ? s * m * 2 ** -24 : e === 31 ? s * 65504 : s * (1 + m / 1024) * 2 ** (e - 15); };
  const readDome = async (): Promise<Float32Array> => {
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: runtime.dome.texture }, { buffer: readBuffer, bytesPerRow }, [runtime.dome.size, runtime.dome.size]);
    device.queue.submit([encoder.finish()]);
    await readBuffer.mapAsync(GPUMapMode.READ);
    const raw = new Uint16Array(readBuffer.getMappedRange().slice(0));
    readBuffer.unmap();
    return Float32Array.from(raw, half);
  };
  /** Mean |difference| of radiance (relative to the reference mean radiance) and of transmittance. */
  const domeDiff = (a: Float32Array, b: Float32Array) => {
    let dl = 0, ml = 0, dt = 0;
    const n = a.length / 4;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) { dl += Math.abs(a[i * 4 + c] - b[i * 4 + c]); ml += Math.abs(b[i * 4 + c]); }
      dt += Math.abs(a[i * 4 + 3] - b[i * 4 + 3]);
    }
    return { radianceRel: dl / Math.max(ml, 1e-9), transmittance: dt / n };
  };
  /** Mass-weighted direction of the cloud in the dome (weight 1 - T over the upper hemisphere) and its coverage. */
  const domeCentroid = (d: Float32Array) => {
    const size = runtime.dome.size;
    let sx = 0, sy = 0, sz = 0, w = 0, covered = 0, upper = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dir = domeTexelDirection(x, y, size);
      if (dir[1] < 0) continue;
      upper++;
      const a = 1 - d[(y * size + x) * 4 + 3];
      if (a > 0.01) covered++;
      sx += dir[0] * a; sy += dir[1] * a; sz += dir[2] * a; w += a;
    }
    return { ...azEl([sx, sy, sz]), coverage: covered / upper, mass: w };
  };

  /** Azimuth/elevation extent of the texels with transmittance < 0.9, and of the cloud volume's focus box seen from the reference point. */
  const maskBounds = (d: Float32Array) => {
    const size = runtime.dome.size;
    const b = { azMin: 1e9, azMax: -1e9, elMin: 1e9, elMax: -1e9 };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (d[(y * size + x) * 4 + 3] > 0.9) continue;
      const { az, el } = azEl(domeTexelDirection(x, y, size));
      b.azMin = Math.min(b.azMin, az); b.azMax = Math.max(b.azMax, az); b.elMin = Math.min(b.elMin, el); b.elMax = Math.max(b.elMax, el);
    }
    return b;
  };
  const boxBounds = () => {
    const ref = [camera.position.x, runtime.dome.settings.groundHeight, camera.position.z];
    const b = { azMin: 1e9, azMax: -1e9, elMin: 1e9, elMax: -1e9 };
    for (let i = 0; i < 8; i++) {
      const c = [i & 1 ? FOCUS_BOX.max[0] : FOCUS_BOX.min[0], i & 2 ? FOCUS_BOX.max[1] : FOCUS_BOX.min[1], i & 4 ? FOCUS_BOX.max[2] : FOCUS_BOX.min[2]];
      const { az, el } = azEl([c[0] - ref[0], c[1] - ref[1], c[2] - ref[2]]);
      b.azMin = Math.min(b.azMin, az); b.azMax = Math.max(b.azMax, az); b.elMin = Math.min(b.elMin, el); b.elMax = Math.max(b.elMax, el);
    }
    return b;
  };

  // ---- frame loop ----
  const hud = document.getElementById('hud')!;
  const frameTimes: number[] = [];
  const f = (n: number, d = 2) => n.toFixed(d);
  const frameData: CloudFrame = {
    view: new Float32Array(16), projection: new Float32Array(16), viewProjection: new Float32Array(16), inverseViewProjection: new Float32Array(16), previousViewProjection: new Float32Array(16),
    cameraPosition: [0, 0, 0], depth: undefined as unknown as GPUTextureView, depthKind: 'depth32float',
    sunDirection: skyBridge.values.sunDirection, atmosphere: skyBridge.bindGroup, time: 0, frameIndex: 0,
  };
  if (query.get('lighting') === 'uniform') { delete frameData.atmosphere; frameData.lighting = { kind: 'uniform', sunRadiance: [30, 28, 25], ambientTop: [8, 10, 14], ambientBottom: [3, 3, 2.5] }; }
  const t0 = performance.now();
  let last = t0, frame = 0;
  const frameWaiters: (() => void)[] = [];
  const nextFrame = () => new Promise<void>(r => frameWaiters.push(r));
  const loop = (now: number) => {
    const dt = now - last; last = now;
    if (frame > 30) { frameTimes.push(dt); if (frameTimes.length > 240) frameTimes.shift(); }
    sky.update(camera);
    void sky.updateAerialPerspective();
    skyBridge.update(camera);
    bridge.renderScene(scene, camera);
    bridge.fillFrame(camera, frameData);
    frameData.time = (now - t0) / 1000; frameData.frameIndex = frame;
    timer.beginFrame();
    const encoder = device.createCommandEncoder({ label: 'dome test cloud encoder' });
    runtime.encode(encoder, frameData, timer);
    timer.endFrame(encoder);
    device.queue.submit([encoder.finish()]);
    bridge.present();
    drawPanorama();
    if (frame++ % 10 === 0) {
      const g = timer.averages();
      hud.textContent = [`frame ${f(frameTimes[frameTimes.length - 1] ?? 0)} ms`, `gpu ms`, ...Object.entries(g).map(([k, v]) => `  ${k.padEnd(10)} ${f(v, 3)}`),
        `dome ${runtime.dome.size}^2  ref ${runtime.dome.referencePoint.map(v => f(v, 0)).join(', ')}  fresh ${runtime.dome.refreshFrames}/16`].join('\n');
    }
    for (const w of frameWaiters.splice(0)) w();
    harness.frame();
  };
  renderer.setAnimationLoop(loop);
  const frames = async (n: number) => { for (let i = 0; i < n; i++) await nextFrame(); };

  applyBookmark(state.bookmark);
  await frames(60);

  // ---- sun change test ----
  // Phase 1 (no readbacks): frame times across a sun change vs the steady state.
  const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const steady: number[] = [], change: number[] = [];
  for (let i = 0; i < 40; i++) { await nextFrame(); steady.push(frameTimes[frameTimes.length - 1]); }
  const timeA = state.time, timeB = state.time + 2.5;
  setTime(timeB);
  for (let i = 0; i < 40; i++) { await nextFrame(); change.push(frameTimes[frameTimes.length - 1]); }
  // Phase 2 (readbacks): dome error against the converged result as the sun moves A -> B.
  await frames(40);
  const refB = await readDome();
  const sunAtRefB = Array.from(frameData.sunDirection);
  await frames(17);
  const noise = domeDiff(await readDome(), refB);   // jitter floor: two full refreshes at a settled sun
  setTime(timeA);
  await frames(60);
  const refA = await readDome();
  setTime(timeB);
  const trace: { frame: number; radianceRel: number; transmittance: number }[] = [];
  for (let i = 1; i <= 28; i++) {
    await nextFrame();
    const d = domeDiff(await readDome(), refB);
    trace.push({ frame: i, ...d });
  }
  await frames(60);
  const settledDiff = domeDiff(await readDome(), refB);
  const sunAtEnd = Array.from(frameData.sunDirection);
  const startError = domeDiff(refA, refB);
  const sunTest = {
    timeA, timeB,
    frameMs: { steadyMedian: median(steady), steadyMax: Math.max(...steady), changeMedian: median(change), changeMax: Math.max(...change) },
    noiseFloor: noise, startError, settledDiff, sunAtRefB, sunAtEnd, trace,
  };
  const centroid = domeCentroid(refA);
  // restore the bookmark's sun and settle
  setTime(timeA);
  await frames(60);
  const finalDome = await readDome();
  const final = domeCentroid(finalDome);
  placeMarkers();
  let bounds = { dome: maskBounds(finalDome), box: boxBounds() };
  const refresh = async () => { bounds = { dome: maskBounds(await readDome()), box: boxBounds() }; };

  const gpu = () => timer.averages();
  harness.ready({
    bookmark: async name => { applyBookmark(name); await frames(60); await refresh(); },
    report: () => ({
      gpuMs: gpu(), domeMs: gpu().dome, frameMs: { p50: median(frameTimes) }, renderSize: [W, H], bookmark: state.bookmark, domeSize: runtime.dome.size,
      referencePoint: runtime.dome.referencePoint, expectedCloud: expected, domeCentroid: final, domeCentroidAtRefA: centroid, bounds, sunTest, frames: frame,
    }),
  });
} catch (e) {
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
