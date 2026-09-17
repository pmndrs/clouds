import '../style.css';
import {
  WebGPURenderer, ACESFilmicToneMapping, Scene, PerspectiveCamera, Color, FogExp2,
  Mesh, PlaneGeometry, BoxGeometry, MeshStandardNodeMaterial, DirectionalLight,
  HemisphereLight, WebGPUCoordinateSystem, Vector3,
} from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createCloudWorld } from '../../../packages/three/src/world';
import { createCloudscapeAtlas } from '../../../packages/three/src/sources/cloudscape-atlas';
import { createCloudscape } from '../../../packages/three/src/cloudscape';
import { referenceGroundReceiver } from '../../../packages/three/src/volumetric';
import { createCloudLayer } from '../../../packages/three/src/layers';
import { sampleCameraPath, type CameraPath } from '../../../bench/camera';
import { downloadCanvasCapture, MeasurementCollector } from '../harness';
import { runCloudscapeChecks } from './checks';
import { createFlightClock } from './playback';

document.querySelector('#app')!.innerHTML = `<div class="shell"><aside class="sidebar"><header><span class="eyebrow">pmndrs / clouds</span><h1>Cloudscape</h1><span class="badge">P2 · Coverage study</span><p>Travel from the ground into a resident world of voxel clouds. Drag to orbit; scroll to explore.</p></header>
<section class="section"><h2>WEATHER</h2><label>Cloud population <input id="coverage" type="range" min="0" max="1" step="0.05" value="0.75"></label><label>Density <input id="density" type="range" min="0" max="2" step="0.005" value="1"></label><label>Sun elevation <input id="sun" type="range" min="15" max="80" value="45"></label><div class="row"><label for="layer">High thin-cloud layer</label><input type="checkbox" id="layer" checked></div></section>
<section class="section"><h2>FLIGHT</h2><div class="row"><button id="ground">Ground</button><button id="horizon">Horizon</button><button id="inside">Inside</button></div><label>Ground → cloud → beyond<input id="flight" type="range" min="0" max="40" step="0.02" value="0"></label><button id="play" class="full">Play 40-second flight</button><p id="position">—</p></section>
<section class="section"><h2>QUALITY & REFERENCE</h2><div class="row"><label for="scale">Render scale</label><select id="scale"><option value="0.5">Half</option><option value="0.75">Three-quarter</option><option value="1">Native</option></select></div><div class="row"><label for="samples">Max view samples</label><select id="samples"><option value="192">192</option><option value="320" selected>320</option><option value="512">512</option></select></div><div class="row"><label for="detail">Projected fine detail</label><input type="checkbox" id="detail" checked></div><div class="row"><label for="opaque">Stop fully opaque rays</label><input type="checkbox" id="opaque" checked></div><div class="row"><label for="skip">Conservative cloud lookup</label><input type="checkbox" id="skip" checked></div><div class="row"><label for="shadows">Reference shadows</label><input type="checkbox" id="shadows" checked></div><div class="row"><label for="cache">Cached cloud lighting</label><input type="checkbox" id="cache" checked></div></section>
<section class="section"><div id="status" role="status" class="result">Generating eight voxel forms…</div><div class="stack" style="margin-top:10px"><button id="verify">Run P2 checks</button><button id="benchmark">Measure flight views</button><button id="report">Export evidence</button><button id="capture">Save image</button><button id="sheet">Save flight sheet</button></div><details><summary>Evidence</summary><pre id="evidence"></pre></details></section>
<div class="footer">Review R2: horizon coverage, repetition and transitions.<br>R2 accepted for progression; distance / LOD remains open.<br><a href="/lighting/">P3 lighting</a> · <a href="/clouds/">P1 correctness reference</a> · <a href="/layer-only/">2D layer</a> · <a href="/">P0 lab</a></div></aside>
<main class="main"><header class="topbar"><div><h2>Ground to cloudscape</h2><p>Stable world cells · shared voxel atlas · one volume integration</p></div><span id="device" class="badge">Connecting</span></header><div id="stage" class="stage"><div class="caption">Near and distant formations remain volumetric. The optional high layer is separate thin coverage. P2 prototype: stylized forms; 4.4–7.7 km distance fade. Distant coverage and shadow matching need revision.</div></div><footer class="statusbar"><span>Grid <strong id="grid">—</strong></span><span>GPU data <strong id="memory">—</strong></span><span>CPU submit <strong id="timing">—</strong></span></footer></main></div>`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const errors: string[] = [];
function fail(error: unknown) { const message = error instanceof Error ? error.message : String(error); errors.push(message); $('status').textContent = message; $('status').classList.add('error'); console.error(error); }

async function boot() {
  if (!navigator.gpu) throw new Error('A desktop WebGPU browser is required.');
  const renderer = new WebGPURenderer({ antialias: false }); await renderer.init();
  renderer.setPixelRatio(1); renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 0.85;
  $('stage').prepend(renderer.domElement);
  const device = (renderer.backend as unknown as { device: GPUDevice }).device;
  device.addEventListener('uncapturederror', e => fail((e as GPUUncapturedErrorEvent).error.message));
  const info = device.adapterInfo; $('device').textContent = info.description || info.architecture || 'WebGPU';
  const start = performance.now(), atlas = createCloudscapeAtlas(); const generationMs = performance.now() - start;
  let world = createCloudWorld();
  const camera = new PerspectiveCamera(58, 1, 1, 80000); camera.coordinateSystem = WebGPUCoordinateSystem; camera.updateProjectionMatrix();
  const scene = new Scene(); scene.background = new Color(0.36, 0.56, 0.81); scene.fog = new FogExp2(new Color(0.36, 0.56, 0.81), 0.000055);
  const controls = new OrbitControls(camera, renderer.domElement); controls.maxDistance = 50000; controls.minDistance = 1; controls.maxPolarAngle = Math.PI - 0.01;
  const groundMaterial = new MeshStandardNodeMaterial({ color: 0x567c69, roughness: 1 }); groundMaterial.mrtNode = referenceGroundReceiver();
  const ground = new Mesh(new PlaneGeometry(160000, 160000), groundMaterial); ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const boxMaterial = new MeshStandardNodeMaterial({ color: 0xb98761, roughness: 0.9 });
  const box = new Mesh(new BoxGeometry(300, 1800, 300), boxMaterial); box.position.set(1100, 900, 1000); scene.add(box);
  const sun = new DirectionalLight(0xffeedb, 2); scene.add(sun, new HemisphereLight(0xc2d8ff, 0x506046, 1.2));
  const thin = createCloudLayer({ radius: 150000, height: 9000, cloudScale: 0.00035, wind: [8, 2], coverage: 0.53, density: 0.35 }); scene.add(thin.mesh);
  const cloud = createCloudscape(renderer, atlas, world.snapshot);
  const central = world.snapshot.cells.filter(c => c.active).sort((a, b) => Math.hypot(a.cellX, a.cellZ) - Math.hypot(b.cellX, b.cellZ))[0];
  const center = new Vector3().fromArray(central.bounds.min).add(new Vector3().fromArray(central.bounds.max)).multiplyScalar(0.5);
  const path: CameraPath = { name: 'cloudscape-ground-to-inside', durationSeconds: 40, keyframes: [
    { timeSeconds: 0, position: [center.x, 80, center.z + 7500], target: [center.x, 1500, center.z], up: [0, 1, 0], fovDegrees: 58 },
    { timeSeconds: 12, position: [center.x + 600, 1100, center.z + 2500], target: [center.x, center.y, center.z], up: [0, 1, 0], fovDegrees: 58 },
    { timeSeconds: 20, position: [center.x, center.y, center.z], target: [center.x, center.y + 50, center.z - 2000], up: [0, 1, 0], fovDegrees: 58 },
    { timeSeconds: 30, position: [center.x - 1500, 2600, center.z - 6500], target: [center.x - 1800, 2000, center.z - 9000], up: [0, 1, 0], fovDegrees: 58 },
    { timeSeconds: 40, position: [center.x - 2500, 1500, center.z - 15000], target: [center.x - 3000, 1400, center.z - 18000], up: [0, 1, 0], fovDegrees: 58 },
  ] };
  const flightClock = createFlightClock(path.durationSeconds);
  let alive = true, checking = false, playing = false, raf = 0, lastFrame = 0, lastUi = 0;
  let measurements = new MeasurementCollector(30), tests: Awaited<ReturnType<typeof runCloudscapeChecks>> = [], calibration: unknown[] = [];
  const reset = () => { measurements = new MeasurementCollector(30); };
  function applyFlight(t: number, resetMetrics = true) { const pose = sampleCameraPath(path, t); camera.position.fromArray(pose.position); controls.target.fromArray(pose.target); camera.lookAt(controls.target); controls.update(); cloud.setWorld(world.update(camera.position.toArray())); if (resetMetrics) reset(); }
  applyFlight(0);
  function setSun() { const a = Number($<HTMLInputElement>('sun').value) * Math.PI / 180; cloud.settings.sunDirection.set(-Math.cos(a), Math.sin(a), 0.25).normalize(); sun.position.copy(cloud.settings.sunDirection).multiplyScalar(10000); thin.setSunDirection(cloud.settings.sunDirection); reset(); }
  setSun();
  function resize() { const w = Math.max(1, $('stage').clientWidth), h = Math.max(1, $('stage').clientHeight); renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); const s = Number($<HTMLSelectElement>('scale').value); cloud.resize(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))); reset(); }
  const observer = new ResizeObserver(resize); observer.observe($('stage')); resize();
  const draw = () => { cloud.setWorld(world.update(camera.position.toArray())); cloud.render(scene, camera); };
  const evidence = () => ({ phase: 'P2', generatedAt: new Date().toISOString(), device: { vendor: info.vendor, architecture: info.architecture }, browser: navigator.userAgent, generationCpuMs: generationMs, cloud: cloud.evidence, cpuSubmit: measurements.count > 30 ? measurements.summarize() : null, tests, calibration, errors: [...errors], camera: camera.position.toArray(), pathTime: flightClock.time, thinLayer: thin.mesh.visible });
  function frame(t: number) {
    if (!alive) return;
    if (!checking) {
      try {
        if (playing) { const next = flightClock.advance(lastFrame ? t - lastFrame : 0); $<HTMLInputElement>('flight').value = String(next); applyFlight(next, false); if (next >= 40) { playing = false; $('play').textContent = 'Play 40-second flight'; } }
        thin.update(t / 1000); const start = performance.now(); draw(); const ms = performance.now() - start;
        if (measurements.count < 630) measurements.add({ frameIndex: measurements.count, timeSeconds: t / 1000, cpuSubmitMs: ms });
        if (t - lastUi > 700) { const e = cloud.evidence; $('grid').textContent = `${e.activeCells} / ${e.residentCells}`; $('memory').textContent = `${((e.candidateBytes + e.atlasBytes + e.lightCacheBytes + e.cellBufferBytes + e.frameTargetBytes) / 1048576).toFixed(1)} MiB`; $('timing').textContent = `${ms.toFixed(2)} ms`; $('position').textContent = `${(camera.position.x / 1000).toFixed(1)}, ${(camera.position.y / 1000).toFixed(1)}, ${(camera.position.z / 1000).toFixed(1)} km`; $('evidence').textContent = JSON.stringify(evidence(), null, 2); lastUi = t; }
      } catch (e) { fail(e); alive = false; return; }
    }
    lastFrame = t; raf = requestAnimationFrame(frame);
  }
  async function verify() {
    if (checking) return; checking = true; $('status').textContent = 'Checking world overlap, empty traversal and residency…'; device.pushErrorScope('validation');
    try { tests = await runCloudscapeChecks(renderer); $('status').textContent = tests.every(t => t.passed) ? `Passed ${tests.length} P2 GPU checks. R2 coverage issues remain open.` : 'P2 checks need attention. Open Evidence.'; }
    catch (e) { fail(e); } finally { const error = await device.popErrorScope(); if (error) fail(error.message); checking = false; reset(); }
  }
  $('verify').onclick = () => void verify();
  $('coverage').onchange = () => { world = createCloudWorld({ coverage: Number($<HTMLInputElement>('coverage').value) }); cloud.setWorld(world.update(camera.position.toArray())); reset(); };
  $('density').oninput = () => { cloud.settings.density = Number($<HTMLInputElement>('density').value); reset(); };
  $('sun').oninput = setSun; $('layer').onchange = () => { thin.mesh.visible = $<HTMLInputElement>('layer').checked; reset(); };
  $('ground').onclick = () => { playing = false; $('play').textContent = 'Play 40-second flight'; flightClock.seek(0); applyFlight(0); $<HTMLInputElement>('flight').value = '0'; };
  $('horizon').onclick = () => { playing = false; $('play').textContent = 'Play 40-second flight'; flightClock.seek(12); applyFlight(12); $<HTMLInputElement>('flight').value = '12'; };
  $('inside').onclick = () => { playing = false; $('play').textContent = 'Play 40-second flight'; flightClock.seek(20); applyFlight(20); $<HTMLInputElement>('flight').value = '20'; };
  $('flight').oninput = () => { playing = false; $('play').textContent = 'Play 40-second flight'; flightClock.seek(Number($<HTMLInputElement>('flight').value)); applyFlight(flightClock.time); };
  $('play').onclick = () => { if (flightClock.time >= 40) { flightClock.seek(0); $<HTMLInputElement>('flight').value = '0'; } playing = !playing; lastFrame = 0; $('play').textContent = playing ? 'Pause flight' : 'Play 40-second flight'; };
  $('scale').onchange = resize; $('samples').onchange = () => { cloud.settings.maxSteps = Number($<HTMLSelectElement>('samples').value); reset(); };
  $('detail').onchange = () => { cloud.settings.detail = $<HTMLInputElement>('detail').checked ? 0.16 : 0; reset(); };
  for (const [id, key] of [['opaque', 'earlyTermination'], ['skip', 'skipEmpty'], ['cache', 'cachedLighting'], ['shadows', 'shadows']] as const) $(id).onchange = () => { cloud.settings[key] = $<HTMLInputElement>(id).checked; reset(); };
  $('benchmark').onclick = async () => {
    if (checking) return; checking = true; playing = false; $('play').textContent = 'Play 40-second flight'; calibration = [];
    const originalPosition = camera.position.clone(), originalTarget = controls.target.clone(), originalAspect = camera.aspect;
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('button,input,select')); inputs.forEach(i => { i.disabled = true; });
    try {
      for (const time of [0, 12, 20, 30, 40]) {
        applyFlight(time); cloud.resize(960, 540); camera.aspect = 16 / 9; camera.updateProjectionMatrix();
        $('status').textContent = `Measuring flight at ${time} seconds…`;
        const rebuilt = await cloud.measureGpu(scene, camera, true), samples: number[] = [];
        if (!rebuilt) throw new Error('GPU timestamps are unavailable.');
        for (let i = 0; i < 20; i++) { const sample = await cloud.measureGpu(scene, camera); if (i >= 4 && sample) samples.push(sample.cloudMs); }
        samples.sort((a, b) => a - b); calibration.push({ time, internal: [960, 540], samples: samples.length, cloudP50Ms: (samples[7] + samples[8]) / 2, cloudP95Ms: samples[14] * 0.75 + samples[15] * 0.25, cacheRebuildMs: rebuilt.cacheMs, candidateRebuildMs: rebuilt.candidateMs, world: cloud.evidence });
      }
      $('status').textContent = 'Flight timings recorded. Cloud march and cache rebuild are measured separately.';
    } catch (e) { fail(e); } finally { camera.position.copy(originalPosition); controls.target.copy(originalTarget); camera.aspect = originalAspect; controls.update(); resize(); checking = false; inputs.forEach(i => { i.disabled = false; }); }
  };
  $('report').onclick = () => { const a = document.createElement('a'), url = URL.createObjectURL(new Blob([JSON.stringify(evidence(), null, 2)], { type: 'application/json' })); a.href = url; a.download = 'clouds-p2-report.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  $('capture').onclick = () => { draw(); void downloadCanvasCapture(renderer.domElement, 'clouds-p2.png').catch(fail); };
  $('sheet').onclick = async () => {
    if (checking) return; checking = true; playing = false; $('play').textContent = 'Play 40-second flight';
    const oldPosition = camera.position.clone(), oldTarget = controls.target.clone();
    const sheet = document.createElement('canvas'); sheet.width = 1920; sheet.height = 1800;
    const ctx = sheet.getContext('2d')!; ctx.fillStyle = '#12202a'; ctx.fillRect(0, 0, sheet.width, sheet.height);
    const labels = ['Ground · 0 seconds', 'Approach · 12 seconds', 'Inside · 20 seconds', 'Above / across · 30 seconds', 'Beyond first region · 40 seconds'];
    try {
      for (const [i, time] of [0, 12, 20, 30, 40].entries()) {
        applyFlight(time); renderer.setSize(960, 540, false); cloud.resize(960, 540); camera.aspect = 16 / 9; camera.updateProjectionMatrix(); thin.update(time); draw();
        const x = i % 2 * 960, y = Math.floor(i / 2) * 600;
        ctx.fillStyle = '#d9e7ee'; ctx.font = '22px sans-serif'; ctx.fillText(labels[i], x + 20, y + 36);
        ctx.drawImage(renderer.domElement, x, y + 50, 960, 540);
      }
      ctx.fillStyle = '#d9e7ee'; ctx.font = '26px sans-serif'; ctx.fillText('P2 · Cloudscape review', 985, 1260);
      ctx.font = '21px sans-serif';
      ['Eight shared voxel forms · bounded world', 'Look for repeated silhouettes, coverage gaps,', 'region transitions, thin edges and shadow stability.', 'Lighting / atmosphere are provisional.', 'R2 coverage issues open. Stills do not test motion.'].forEach((line, i) => ctx.fillText(line, 985, 1310 + i * 42));
      await downloadCanvasCapture(sheet, 'clouds-p2-flight-sheet.png');
    } catch (e) { fail(e); } finally { camera.position.copy(oldPosition); controls.target.copy(oldTarget); controls.update(); resize(); checking = false; }
  };
  controls.addEventListener('change' , () => { if (!playing && !checking) reset(); });
  void device.lost.then(info => { if (alive) { alive = false; cancelAnimationFrame(raf); fail(`Device lost: ${info.reason}. Reload to rebuild.`); } });
  window.addEventListener('pagehide', () => { alive = false; cancelAnimationFrame(raf); observer.disconnect(); controls.dispose(); cloud.dispose(); thin.dispose(); ground.geometry.dispose(); groundMaterial.dispose(); box.geometry.dispose(); boxMaterial.dispose(); renderer.dispose(); }, { once: true });
  await verify(); raf = requestAnimationFrame(frame);
}
void boot().catch(fail);
