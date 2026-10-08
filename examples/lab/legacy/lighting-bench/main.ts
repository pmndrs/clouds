import { Color, PerspectiveCamera, Scene, Vector3, WebGPUCoordinateSystem, WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createCloudscape } from '../../../../packages/three/src/cloudscape';
import { createCloudscapeAtlas } from '../../../../packages/three/src/sources/cloudscape-atlas';
import { createCloudWorld } from '../../../../packages/three/src/world';
import { compareFrames, compareTemporalResidual, summarizeMotion, type FrameMetrics } from '../quality-bench/metrics';
import './style.css';

document.querySelector('#app')!.innerHTML = `
<header><h1>Cloud lighting isolation</h1><p>Production cloud atlas and renderer · fixed view integration · no temporal history or blur</p></header>
<section class="controls">
<label>Candidate<select id="method"><option value="direct48">Direct · 48</option><option value="direct256">Direct · 256</option><option value="direct1024">Direct · 1024</option><option value="stationary256">World-anchored · 256 budget</option><option value="stationary1024">World-anchored · 1024 budget</option><option value="cached48" selected>Cached · 48</option><option value="cached256">Cached · 256</option><option value="unshadowed">Unshadowed control</option></select></label>
<label>Reference<select id="reference"><option value="1024">Direct · 1024</option><option value="2048">Direct · 2048</option></select></label>
<label>Pixels per view<select id="size"><option value="96">96 × 54 · quick audit</option><option value="192" selected>192 × 108</option><option value="384">384 × 216 · slow</option><option value="768">768 × 432 · very slow</option></select></label>
<label>Exposure<input id="exposure" type="range" min="0.1" max="3" step="0.1" value="1"></label>
<button id="home">Reset camera</button><button id="play">Play orbit + zoom</button><button id="layout">Stack large views</button>
<button id="audit">Run isolated light sweep</button><button id="stop" disabled>Stop after current pose</button><button id="save" disabled>Save evidence</button>
</section>
<section><div id="status">Starting WebGPU…</div><p class="note">Drag the candidate to orbit; scroll to zoom. Both views use exactly the same camera. Reference labels describe sample counts, not proven convergence. The audit also compares 1024 against 2048. Geometry shadows are disabled; the tower-overlap defect is outside this test.</p></section>
<div class="panels"><div class="panel"><h2 id="candidateLabel">Candidate</h2><canvas id="candidate"></canvas></div><div class="panel"><h2 id="referenceLabel">Dense reference</h2><canvas id="dense"></canvas></div><div class="panel"><h2>Radiance error ×4 · display mapped</h2><canvas id="error"></canvas></div></div>
<section><pre id="evidence"></pre></section><footer>Look for coherent arcs and changing bands during movement. Lower error alone does not pass visual review. <a href="/legacy/cloudscape/">Cloudscape</a> · <a href="/legacy/quality-bench/">Single-cloud bench</a></footer>`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
type Method = 'direct48' | 'direct256' | 'stationary256' | 'cached48' | 'unshadowed' | 'direct1024' | 'direct2048' | 'stationary1024' | 'cached256';
const labels: Record<Method, string> = { direct48: 'Direct · 48', direct256: 'Direct · 256', stationary256: 'World-anchored · 256 budget', cached48: 'Cached · 48', unshadowed: 'Unshadowed control', direct1024: 'Direct · 1024', direct2048: 'Direct · 2048', stationary1024: 'World-anchored · 1024 budget', cached256: 'Cached · 256' };
let latest: unknown;
let stopped = false, playing = false, busy = false, dirty = true, failed = false;
let pair: { a: Float32Array; b: Float32Array; width: number; height: number } | undefined;

function display() {
  if (!pair) return;
  const { a, b, width, height } = pair;
  const exposure = Number($<HTMLInputElement>('exposure').value);
  for (const [panel, id] of ['candidate', 'dense', 'error'].entries()) {
    const canvas = $<HTMLCanvasElement>(id); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d')!, image = context.createImageData(width, height);
    for (let i = 0; i < a.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const value = panel === 2 ? Math.abs(a[i + c] - b[i + c]) * 4 : (panel === 0 ? a : b)[i + c] + (panel === 0 ? a : b)[i + 3] * [0.36, 0.56, 0.81][c];
        const mapped = Math.max(0, value * exposure);
        image.data[i + c] = Math.round(255 * (mapped / (1 + mapped)) ** (1 / 2.2));
      }
      image.data[i + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  }
}
function opacity(frame: Float32Array) { const copy = frame.slice(); for (let i = 3; i < copy.length; i += 4) copy[i] = 1 - copy[i]; return copy; }
function transmissionError(a: Float32Array, b: Float32Array) { let max = 0; for (let i = 3; i < a.length; i += 4) max = Math.max(max, Math.abs(a[i] - b[i])); return max; }
function evidence(value: unknown) { latest = value; $('evidence').textContent = JSON.stringify(value, null, 2); $<HTMLButtonElement>('save').disabled = false; }

async function main() {
  const renderer = new WebGPURenderer({ antialias: false }); await renderer.init();
  const device = (renderer.backend as unknown as { device: GPUDevice }).device;
  device.addEventListener('uncapturederror', event => { failed = true; playing = false; $('status').textContent = `GPU error: ${event.error.message}`; });
  void device.lost.then(info => { failed = true; playing = false; $('status').textContent = `Device lost: ${info.message}`; });
  const scene = new Scene(); scene.background = new Color(0.36, 0.56, 0.81);
  const camera = new PerspectiveCamera(48, 16 / 9, 1, 30000); camera.coordinateSystem = WebGPUCoordinateSystem; camera.updateProjectionMatrix();
  const world = createCloudWorld({ seed: 17 }); // Intentionally frozen residency: isolate lighting, not streaming.
  const atlas = createCloudscapeAtlas(); const cloud = createCloudscape(renderer, atlas, world.snapshot);
  Object.assign(cloud.settings, { density: 1, detail: 0.16, detailFiltering: true, stepMetres: 24, maxSteps: 320, viewSubsteps: 4, distanceFade: false, shadows: true, geometryShadows: false, cachedLighting: false, hazeStrength: 0 });
  const active = world.snapshot.cells.filter(cell => cell.active).sort((a, b) => Math.hypot(a.cellX, a.cellZ) - Math.hypot(b.cellX, b.cellZ))[0];
  const center = new Vector3().fromArray(active.bounds.min).add(new Vector3().fromArray(active.bounds.max)).multiplyScalar(0.5);
  const controls = new OrbitControls(camera, $<HTMLCanvasElement>('candidate')); controls.target.copy(center); controls.minDistance = 100; controls.maxDistance = 14000;
  const pose = (phase: number) => { const angle = -0.8 + phase * Math.PI * 1.5; const radius = 4400 + 1500 * Math.cos(phase * Math.PI * 2); camera.position.copy(center).add(new Vector3(Math.sin(angle) * radius, 330 + 700 * Math.sin(phase * Math.PI * 2), Math.cos(angle) * radius)); controls.target.copy(center); controls.update(); camera.updateMatrixWorld(); };
  pose(0); controls.addEventListener('change', () => { dirty = true; });
  function configure(method: Method) {
    cloud.settings.shadows = method !== 'unshadowed'; cloud.settings.cachedLighting = method === 'cached48' || method === 'cached256';
    cloud.settings.lightSampling = method.startsWith('stationary') ? 'world-stationary' : 'normalized';
    cloud.settings.lightSteps = method === 'direct2048' ? 2048 : method === 'direct1024' || method === 'stationary1024' ? 1024 : method === 'direct256' || method === 'stationary256' || method === 'cached256' ? 256 : 48;
  }
  async function render(method: Method) {
    configure(method); cloud.render(scene, camera, false); const pixels = await cloud.readOptical();
    if (!pixels.every(Number.isFinite)) throw new Error(`Non-finite output: ${method}`);
    return pixels;
  }
  function size(width: number) { const height = Math.round(width * 9 / 16); cloud.resize(width, height); return { width, height }; }
  let phase = 0;
  async function preview() {
    const dimensions = size(Number($<HTMLSelectElement>('size').value));
    const method = $<HTMLSelectElement>('method').value as Method, reference = `direct${$<HTMLSelectElement>('reference').value}` as Method;
    $('status').textContent = 'Rendering matched camera views…';
    const a = await render(method), b = await render(reference); pair = { a, b, ...dimensions }; display();
    $('candidateLabel').textContent = labels[method]; $('referenceLabel').textContent = labels[reference];
    evidence({ kind: 'single pose, not a motion acceptance', candidate: method, reference, resolution: [dimensions.width, dimensions.height], geometryShadows: false, viewSubsteps: 4, transmittanceMaxError: transmissionError(a, b), linearRadianceError: compareFrames(opacity(a), opacity(b)), camera: camera.position.toArray() });
    $('status').textContent = playing ? 'Orbiting one matched pair at a time; playback speed depends on rendering cost.' : 'Ready. Drag or scroll the candidate to inspect; run the sweep for motion evidence.';
  }
  async function audit() {
    if (busy) return; busy = true; playing = false; stopped = false; controls.enabled = false; latest = undefined; $<HTMLButtonElement>('save').disabled = true;
    const snapshot = camera.position.clone(), target = controls.target.clone();
    $('play').textContent = 'Play orbit + zoom';
    const buttons = ['audit', 'home', 'play', 'method', 'reference', 'size']; for (const id of buttons) ($<HTMLButtonElement | HTMLSelectElement>(id)).disabled = true;
    $<HTMLButtonElement>('stop').disabled = false; device.pushErrorScope('validation');
    const methods: Method[] = ['direct48', 'direct256', 'stationary256', 'stationary1024', 'cached48', 'cached256', 'unshadowed', 'direct1024'];
    const frames = new Map<Method, Float32Array[]>(), spatial = new Map<Method, FrameMetrics[]>(), motion = new Map<Method, { mean: number; p95: number }[]>();
    for (const method of [...methods, 'direct2048' as Method]) { frames.set(method, []); spatial.set(method, []); motion.set(method, []); }
    let maxT = 0, count = 0, cloudPixels = 0, partialPixels = 0;
    const dimensions = size(96), started = performance.now(); let scopeOpen = true;
    try {
      for (let index = 0; index < 12 && !stopped; index++) {
        pose(Math.floor(index / 4) * 0.35 + (index % 4) / 270);
        $('status').textContent = `Sweep pose ${index + 1}/12: dense 2048 reference…`;
        const reference = await render('direct2048'), ref = opacity(reference); frames.get('direct2048')!.push(ref);
        for (let i = 3; i < reference.length; i += 4) { if (reference[i] < 0.99) cloudPixels++; if (reference[i] > 0.01 && reference[i] < 0.99) partialPixels++; }
        for (const method of methods) {
          $('status').textContent = `Sweep pose ${index + 1}/12: ${labels[method]}…`;
          const raw = await render(method), frame = opacity(raw), history = frames.get(method)!;
          maxT = Math.max(maxT, transmissionError(raw, reference));
          spatial.get(method)!.push(compareFrames(frame, ref));
          if (index % 4 !== 0) motion.get(method)!.push(compareTemporalResidual(frame, history[index - 1], ref, frames.get('direct2048')![index - 1]));
          history.push(frame);
          pair = { a: raw, b: reference, ...dimensions }; display();
          $('candidateLabel').textContent = labels[method]; $('referenceLabel').textContent = labels.direct2048;
        }
        count++;
      }
      const validation = await device.popErrorScope(); scopeOpen = false;
      if (validation) throw new Error(validation.message);
      const result = { kind: 'isolated secondary-light sweep', complete: count === 12, poses: count, renderSize: [96, 54], cameraPath: 'three groups of four nearby poses; 1-degree orbit increments with zoom; motion metrics exclude jumps between groups', source: 'production atlas, frozen 9×9 seed-17 world', adapter: device.adapterInfo.description || device.adapterInfo.architecture || device.adapterInfo.vendor, lighting: { selfShadowing: true, geometryShadows: false, unshadowedControlIsExplicitException: true }, view: { substeps: 4, maxSteps: 320, detail: 0.16, density: 1 }, postBlur: false, temporalHistory: false, metrics: 'max-channel linear radiance error over cloud support; motion is frame-difference residual, not optical flow', transmittanceMaxError: maxT, transmittanceIdentical: maxT === 0, cloudSupportFraction: cloudPixels / Math.max(1, count * 96 * 54), partialOpacityFraction: partialPixels / Math.max(1, count * 96 * 54), samplingCaveat: 'World-anchored budget sets spacing from the full box projection; actual evaluations per ray differ from normalized counts. This is not equal-work phase isolation.', sunDirection: cloud.settings.sunDirection.toArray(), reference: '2048 normalized midpoint; 1024 comparison measures sensitivity, not proof of ground truth', auditElapsedMs: performance.now() - started, methods: Object.fromEntries(methods.map(method => { const { elapsedMs: _elapsed, ...metrics } = summarizeMotion(spatial.get(method)!, motion.get(method)!, 0); return [method, metrics]; })), isolationChecksPassed: count === 12 && maxT === 0 && cloudPixels / (count * 96 * 54) > 0.02 && partialPixels / (count * 96 * 54) > 0.01 && spatial.get('unshadowed')!.some(frame => frame.mae > 0.001), performanceClaim: false, validationErrors: 0 };
      evidence(result); $('status').textContent = count === 12 ? 'Sweep complete. Panels show the final sweep pose (96 × 54). Review reference sensitivity and motion errors; visual acceptance remains separate.' : 'Sweep stopped; partial evidence only.';
    } catch (error) { $('status').textContent = `Sweep failed: ${String(error)}`; }
    finally { if (scopeOpen) await device.popErrorScope(); if (count > 0) { $<HTMLSelectElement>('method').value = 'direct1024'; $<HTMLSelectElement>('reference').value = '2048'; $<HTMLSelectElement>('size').value = '96'; } else { camera.position.copy(snapshot); controls.target.copy(target); } controls.enabled = true; controls.update(); dirty = false; busy = false; for (const id of buttons) $<HTMLButtonElement | HTMLSelectElement>(id).disabled = false; $<HTMLButtonElement>('stop').disabled = true; }
  }
  $('audit').onclick = () => void audit(); $('stop').onclick = () => { stopped = true; };
  $('home').onclick = () => { pose(0); dirty = true; };
  $('play').onclick = () => { playing = !playing; $('play').textContent = playing ? 'Pause orbit' : 'Play orbit + zoom'; };
  $('layout').onclick = () => document.body.classList.toggle('wide');
  for (const id of ['method', 'reference', 'size']) $(id).onchange = () => { dirty = true; };
  $('exposure').oninput = display;
  $('save').onclick = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(latest, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'cloud-lighting-isolation.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  await cloud.compile(scene, camera);
  async function tick() {
    if (!busy && !failed && (dirty || playing)) {
      busy = true; dirty = false; controls.enabled = false;
      try { if (playing) { phase = (phase + 1 / 120) % 1; pose(phase); dirty = false; } await preview(); }
      catch (error) { failed = true; $('status').textContent = String(error); }
      finally { busy = false; controls.enabled = true; }
    }
    requestAnimationFrame(() => void tick());
  }
  window.addEventListener('pagehide', () => { failed = true; controls.dispose(); cloud.dispose(); renderer.dispose(); }, { once: true });
  void tick();
}
void main().catch(error => { $('status').textContent = `Initialization failed: ${String(error)}`; });
