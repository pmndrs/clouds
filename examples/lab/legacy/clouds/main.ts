import '../../style.css';
import {
  WebGPURenderer, ACESFilmicToneMapping, Scene, PerspectiveCamera, Color,
  Mesh, PlaneGeometry, BoxGeometry, MeshStandardNodeMaterial, DirectionalLight,
  HemisphereLight, Vector3, WebGPUCoordinateSystem, Vector2,
} from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createDensityField, type DensityPreset } from '../../../../packages/three/src/sources/index';
import { createReferenceCloud, referenceGroundReceiver } from '../../../../packages/three/src/volumetric/index';
import { MeasurementCollector, downloadCanvasCapture } from '../../harness';
import { runCloudChecks, type CloudCheck } from './checks';
import compatibility from '../../../../fixtures/compatibility.json';

document.querySelector('#app')!.innerHTML = `
<div class="shell"><aside class="sidebar"><header><span class="eyebrow">pmndrs / clouds</span><h1>First voxel</h1><span class="badge">P1 · Reference renderer</span><p>A generated density field, lit and integrated in world space. Drag to orbit; scroll to move closer.</p></header>
<section class="section"><h2>CLOUD FORM</h2><select id="preset" class="full"><option value="cumulus">01 · Cumulus</option><option value="tower">02 · Tower</option><option value="wisps">03 · Wisps</option><option value="authored">Synthetic authored volume</option></select><label>Density <span id="density-value">1.00</span><input id="density" type="range" min="0" max="3" step="0.01" value="1"></label><label>Cloud size <input id="cloud-size" type="range" min="0.5" max="1.5" step="0.01" value="1"></label><label>Sun elevation <input id="sun" type="range" min="10" max="80" value="45"></label></section>
<section class="section"><h2>EXPLORE</h2><div class="row"><button id="ground">Ground</button><button id="side">Side</button><button id="inside">Inside</button></div><label>Fly through<input id="flight" type="range" min="0" max="1" step="0.001" value="0"></label><div class="row"><label for="scale">Render scale</label><select id="scale"><option value="0.5">Half</option><option value="0.75">Three-quarter</option><option value="1">Native</option></select></div><div class="row"><label for="steps">View / light samples</label><select id="steps"><option value="64">64 / 8</option><option value="96" selected>96 / 12</option><option value="160">160 / 20</option></select></div></section>
<section class="section"><h2>REFERENCE SWITCHES</h2><div class="row"><label for="skip">Conservative occupancy</label><input id="skip" type="checkbox"></div><div class="row"><label for="cast">Cloud → ground shadow</label><input id="cast" type="checkbox" checked></div><div class="row"><label for="receive">Object → cloud shadow</label><input id="receive" type="checkbox" checked></div><div class="row"><label for="object">Show opaque object</label><input id="object" type="checkbox" checked></div></section>
<section class="section"><div id="status" class="result" role="status">Initializing WebGPU…</div><div class="stack" style="margin-top:10px"><button id="verify">Run cloud checks</button><button id="benchmark">Measure GPU presets</button><button id="capture">Save image</button><button id="report">Export evidence</button></div><details><summary>Evidence</summary><pre id="evidence"></pre></details></section>
<div class="footer"><a href="/legacy/cloudscape/">P2 cloudscape</a> · <a href="/">P0 integration lab</a> · <a href="/legacy/layer-only/">Independent 2D layer</a><br>Dense 64³ · linear HDR · no temporal history<br>Reference lighting; broad sky integration follows in P3.</div></aside>
<main class="main"><header class="topbar"><div><h2>Voxel cloud study</h2><p>Generated source → shared-device WGSL → Three.js composition</p></div><span class="badge" id="device">Connecting</span></header><div id="stage" class="stage"><div class="caption">Choose a form, inspect its silhouette, then move inside. Shadows use a reference ground receiver and a matching opaque box.</div></div><footer class="statusbar"><span>Resolution <strong id="resolution">—</strong></span><span>CPU submit <strong id="timing">—</strong></span><span>Density <strong>64³ / 256 KiB</strong></span></footer></main></div>`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const errors: string[] = [];
const fail = (e: unknown) => { const message = e instanceof Error ? e.message : String(e); errors.push(message); $('status').textContent = message; $('status').classList.add('error'); console.error(e); };

async function boot() {
  if (!navigator.gpu) throw new Error('This preview needs a desktop browser with WebGPU enabled.');
  const renderer = new WebGPURenderer({ antialias: false }); await renderer.init();
  renderer.setPixelRatio(1); renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  $('stage').prepend(renderer.domElement);
  const device = (renderer.backend as unknown as { device: GPUDevice }).device;
  device.addEventListener('uncapturederror', e => fail((e as GPUUncapturedErrorEvent).error.message));
  const info = device.adapterInfo;
  $('device').textContent = info.description || info.architecture || info.vendor || 'WebGPU';
  const scene = new Scene(); scene.background = new Color(0.22, 0.40, 0.66);
  const camera = new PerspectiveCamera(48, 1, 0.1, 20000);
  camera.coordinateSystem = WebGPUCoordinateSystem; camera.updateProjectionMatrix();
  const controls = new OrbitControls(camera, renderer.domElement); controls.maxDistance = 6000; controls.minDistance = 1; controls.enableDamping = false;
  const groundMaterial = new MeshStandardNodeMaterial({ color: 0x66816c, roughness: 1 });
  groundMaterial.mrtNode = referenceGroundReceiver();
  const ground = new Mesh(new PlaneGeometry(6000, 6000), groundMaterial); ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const boxBounds = { min: [25, 200, -35] as const, max: [95, 380, 35] as const };
  const boxMaterial = new MeshStandardNodeMaterial({ color: 0xd67e53, roughness: 0.8 });
  const box = new Mesh(new BoxGeometry(70, 180, 70), boxMaterial); box.position.set(60, 290, 0); scene.add(box);
  const sun = new DirectionalLight(0xffefdb, 2.2); scene.add(sun); scene.add(new HemisphereLight(0xbad7ff, 0x455139, 1.5));
  const generationStart = performance.now();
  const initialField = createDensityField('cumulus');
  const initialGenerationMs = performance.now() - generationStart;
  const setupStart = performance.now();
  const cloud = createReferenceCloud(renderer, initialField, boxBounds);
  const initialSetupMs = performance.now() - setupStart;
  let alive = true, checking = false, raf = 0, lastUi = 0;
  let checks: CloudCheck[] = [], measurements = new MeasurementCollector(30), generationMs = initialGenerationMs;
  let calibration: { output: number[]; internal: number[]; scale: number; occupancy: boolean; sampleCount: number; gpuMs: { p50: number; p95: number } }[] = [];
  let calibrationSettings: unknown = null;
  const resetMetrics = () => { measurements = new MeasurementCollector(30); };
  function setSun() {
    const a = Number($<HTMLInputElement>('sun').value) * Math.PI / 180;
    cloud.settings.sunDirection.set(-Math.cos(a), Math.sin(a), 0.35).normalize();
    sun.position.copy(cloud.settings.sunDirection).multiplyScalar(1000); resetMetrics();
  }
  function pose(name: 'ground' | 'side' | 'inside') {
    camera.position.fromArray(name === 'ground' ? [850, 65, 1100] : name === 'inside' ? [0, 310, 30] : [850, 390, 1000]);
    controls.target.set(0, 300, name === 'inside' ? -400 : 0); controls.update(); resetMetrics();
  }
  pose('side'); setSun();
  function resize() {
    const stage = $('stage'), w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    const scale = Number($<HTMLSelectElement>('scale').value);
    const rw = Math.max(1, Math.round(w * scale)), rh = Math.max(1, Math.round(h * scale)); cloud.resize(rw, rh);
    $('resolution').textContent = `${rw} × ${rh} → ${w} × ${h}`; resetMetrics();
  }
  const observer = new ResizeObserver(resize); observer.observe($('stage')); resize();
  const draw = () => cloud.render(scene, camera);
  function evidence() { return { phase: 'P1', generatedAt: new Date().toISOString(), compatibility, device: { vendor: info.vendor, architecture: info.architecture, description: info.description }, browser: navigator.userAgent, cloud: cloud.evidence, generationCpuMs: generationMs, initialRendererSetupCpuMs: initialSetupMs, measurements: measurements.count > 30 ? measurements.summarize() : null, measurementNote: 'Live samples are CPU submission. Calibration uses GPU timestamps for cloud integration, reference shadows and compute composition together; excludes opaque rendering and final display. Whole-scene spatial upscale; no FSR yet.', tests: checks, calibration, calibrationSettings, errors: [...errors], camera: { position: camera.position.toArray(), target: controls.target.toArray() }, output: renderer.getDrawingBufferSize(new Vector2()).toArray() }; }
  function frame(t: number) {
    if (!alive) return;
    if (!checking) {
      try {
        const start = performance.now(); draw(); const cpuSubmitMs = performance.now() - start;
        if (measurements.count < 630) measurements.add({ frameIndex: measurements.count, timeSeconds: t / 1000, cpuSubmitMs });
        if (t - lastUi > 750) { $('timing').textContent = `${cpuSubmitMs.toFixed(2)} ms`; $('evidence').textContent = JSON.stringify(evidence(), null, 2); lastUi = t; }
      } catch (e) { fail(e); alive = false; return; }
    }
    raf = requestAnimationFrame(frame);
  }
  async function verify() {
    if (checking) return;
    checking = true; $('verify').setAttribute('disabled', ''); $('status').textContent = 'Checking the production GPU shader against optical references…';
    device.pushErrorScope('validation');
    let scopeOpen = true;
    try {
      checks = await runCloudChecks(renderer);
      const error = await device.popErrorScope(); scopeOpen = false; if (error) throw new Error(error.message);
      const passed = checks.every(c => c.passed);
      $('status').textContent = passed ? `Passed ${checks.length} GPU reference checks. Ready for shape review.` : 'Reference checks need attention. See Evidence.';
      $('status').classList.toggle('error', !passed);
    } catch (e) { fail(e); } finally { if (scopeOpen) { const error = await device.popErrorScope(); if (error) fail(error.message); } checking = false; $('verify').removeAttribute('disabled'); resetMetrics(); }
  }
  let currentField = initialField;
  function applyCloudSize() {
    const scale = Number($<HTMLInputElement>('cloud-size').value);
    cloud.setField({ ...currentField, descriptor: { ...currentField.descriptor, bounds: { min: [-300 * scale, 100, -250 * scale], max: [300 * scale, 100 + 500 * scale, 250 * scale] } } });
    resetMetrics();
  }
  $('cloud-size').oninput = applyCloudSize;
  $('preset').onchange = () => { const start = performance.now(); currentField = createDensityField($<HTMLSelectElement>('preset').value as DensityPreset); generationMs = performance.now() - start; applyCloudSize(); };
  $('density').oninput = () => { cloud.settings.densityMultiplier = Number($<HTMLInputElement>('density').value); $('density-value').textContent = cloud.settings.densityMultiplier.toFixed(2); resetMetrics(); };
  $('sun').oninput = setSun;
  for (const name of ['ground', 'side', 'inside'] as const) $(name).onclick = () => pose(name);
  $('flight').oninput = () => { const t = Number($<HTMLInputElement>('flight').value); camera.position.lerpVectors(new Vector3(850, 160, 1100), new Vector3(-180, 340, -350), t); controls.target.copy(camera.position).add(new Vector3(-0.55, 0.04, -1).normalize().multiplyScalar(400)); controls.update(); resetMetrics(); };
  $('scale').onchange = resize;
  $('steps').onchange = () => { cloud.settings.viewSteps = Number($<HTMLSelectElement>('steps').value); cloud.settings.lightSteps = cloud.settings.viewSteps / 8; resetMetrics(); };
  for (const [id, key] of [['skip', 'occupancy'], ['cast', 'castShadow'], ['receive', 'receiveShadow']] as const) $(id).onchange = () => { cloud.settings[key] = $<HTMLInputElement>(id).checked && (key !== 'receiveShadow' || box.visible); resetMetrics(); };
  $('object').onchange = () => { box.visible = $<HTMLInputElement>('object').checked; cloud.settings.receiveShadow = box.visible && $<HTMLInputElement>('receive').checked; resetMetrics(); };
  async function benchmark() {
    if (checking) return;
    checking = true;
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input,select,button'));
    inputs.forEach(input => { input.disabled = true; });
    const originalAspect = camera.aspect, originalOccupancy = cloud.settings.occupancy;
    calibration = []; calibrationSettings = { cloud: cloud.evidence, camera: { position: camera.position.toArray(), target: controls.target.toArray() }, warmupFrames: 8 };
    try {
      for (const output of [[1920, 1080], [2560, 1440]]) for (const scale of [0.5, 0.75, 1]) {
        const internal = output.map(n => Math.round(n * scale));
        cloud.resize(internal[0], internal[1]); camera.aspect = output[0] / output[1]; camera.updateProjectionMatrix();
        const samples: number[] = [];
        $('status').textContent = `Measuring GPU: ${output.join(' × ')} at ${scale * 100}%…`;
        for (let i = 0; i < 38; i++) {
          const ms = await cloud.measureGpu(scene, camera);
          if (ms === null) throw new Error('GPU timestamps are unavailable on this device. Live CPU measurements remain available.');
          if (i >= 8) samples.push(ms);
        }
        samples.sort((a, b) => a - b);
        const quantile = (p: number) => { const i = (samples.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return samples[lo] + (samples[hi] - samples[lo]) * (i - lo); };
        calibration.push({ output, internal, scale, occupancy: cloud.settings.occupancy, sampleCount: samples.length, gpuMs: { p50: quantile(0.5), p95: quantile(0.95) } });
      }
      $('status').textContent = 'GPU sweep complete. Export evidence for per-resolution p50/p95. These are reference costs, not final budgets.';
    } catch (e) { fail(e); } finally {
      cloud.settings.occupancy = originalOccupancy; camera.aspect = originalAspect; camera.updateProjectionMatrix(); resize();
      checking = false; inputs.forEach(input => { input.disabled = false; });
    }
  }
  $('benchmark').onclick = () => void benchmark();
  $('verify').onclick = () => void verify();
  $('capture').onclick = () => { draw(); void downloadCanvasCapture(renderer.domElement, 'clouds-p1.png').catch(fail); };
  $('report').onclick = () => { const a = document.createElement('a'); const url = URL.createObjectURL(new Blob([JSON.stringify(evidence(), null, 2)], { type: 'application/json' })); a.href = url; a.download = 'clouds-p1-report.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  controls.addEventListener('change', resetMetrics);
  void device.lost.then(info => { if (alive) { alive = false; cancelAnimationFrame(raf); fail(`GPU device lost: ${info.reason}. Reload to rebuild.`); } });
  window.addEventListener('pagehide', () => { alive = false; cancelAnimationFrame(raf); observer.disconnect(); controls.dispose(); cloud.dispose(); ground.geometry.dispose(); box.geometry.dispose(); groundMaterial.dispose(); boxMaterial.dispose(); renderer.dispose(); }, { once: true });
  $('status').textContent = 'Ready. Checking reference cases…';
  await verify(); raf = requestAnimationFrame(frame);
}
void boot().catch(fail);
