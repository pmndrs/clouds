import { compareFrames, compareTemporalResidual, summarizeMotion, type MotionMetrics } from './metrics';
import { CLOUD_QUALITY_WGSL, PRESENT_WGSL } from './shaders';
import { createDensityField } from '../../../../packages/legacy/three/src/sources/density';
import { CANDIDATE_WGSL, LIGHT_CACHE_WGSL, cloudscapeShader } from '../../../../packages/legacy/three/src/cloudscape/shaders';
import { runProductionCloudAudit } from './runtime-checks';
import './style.css';

const BOUNDS_MIN = [-650, 0, -500] as const;
const BOUNDS_MAX = [650, 900, 500] as const;
const VOXEL_RESOLUTION = 64;
const INTERNAL_WIDTH = 240;
const INTERNAL_HEIGHT = 135;
const REFERENCE_VIEW_STEPS = 640;
const REFERENCE_LIGHT_STEPS = 64;

type CandidateMethod = 0 | 1 | 2 | 3;
type SourceMode = 0 | 1;

document.querySelector('#app')!.innerHTML = `
<div class="shell">
  <aside class="sidebar">
    <header><span class="eyebrow">pmndrs / clouds</span><h1>Quality bench</h1><span class="badge">Spatial reference · motion audit</span>
      <p>A single bounded cloud rendered twice from the same deterministic camera. The right panel magnifies display-space error by 4×.</p></header>
    <section class="section"><h2>SOURCE</h2>
      <div class="row"><label for="source">Density</label><select id="source"><option value="0">Analytic smooth field</option><option value="1">64³ voxel field</option></select></div>
      <p class="muted">Voxel mode uses the runtime's deterministic authored density generator (seed 7), plus a complete box-filtered mip chain.</p>
    </section>
    <section class="section"><h2>CANDIDATE</h2>
      <div class="row"><label for="method">March</label><select id="method">
        <option value="0">Current distance lattice</option><option value="1" selected>4× segment quadrature</option><option value="2">Distance lattice + voxel mips</option><option value="3">Per-frame jitter diagnostic</option>
      </select></div>
      <label>View segments <output id="stepsValue">160</output><input id="steps" type="range" min="24" max="320" step="8" value="160"></label>
      <label>Desired step <output id="stepValue">24 m</output><input id="step" type="range" min="4" max="64" step="2" value="24"></label>
      <label>Light samples <output id="lightValue">64</output><input id="light" type="range" min="2" max="64" step="2" value="64"></label>
      <div class="buttonRow"><button id="currentPreset">Current-like</button><button id="qualityPreset">Quality baseline</button></div>
    </section>
    <section class="section"><h2>REFERENCE</h2>
      <div class="readout"><span>View integration</span><strong>${REFERENCE_VIEW_STEPS} midpoint segments</strong><span>Light integration</span><strong>${REFERENCE_LIGHT_STEPS} midpoint segments</strong><span>Segment opacity</span><strong>Beer–Lambert, physical ds</strong></div>
    </section>
    <section class="section"><h2>CAMERA</h2>
      <label>Orbit + zoom path <output id="timeValue">0.00 s</output><input id="time" type="range" min="0" max="12" step="0.01" value="0"></label>
      <div class="buttonRow"><button id="play">Pause</button><button id="audit">Run 24-frame audit</button></div>
      <button id="productionAudit" class="full">Audit production atlas/world</button>
    </section>
    <section class="section"><h2>EVIDENCE</h2><div id="status" class="result">Starting WebGPU…</div><pre id="evidence"></pre></section>
    <div class="footer">The audit compares motion against a moving dense reference. A still image cannot pass the temporal check. No history accumulation or post blur is used.</div>
  </aside>
  <main class="main">
    <header class="topbar"><div><h2>Candidate / dense reference / 4× error</h2><p>Same camera · same source · same direct-light model</p></div><span id="device" class="badge">Connecting</span></header>
    <div class="stage"><canvas id="canvas"></canvas><canvas id="productionCanvas" hidden></canvas><div class="labels"><span>Candidate</span><span>Reference</span><span>Error ×4</span></div></div>
    <footer class="statusbar"><span>Internal <strong>${INTERNAL_WIDTH} × ${INTERNAL_HEIGHT} each</strong></span><span>Source <strong id="sourceStatus">analytic</strong></span><span>Last audit <strong id="auditStatus">not run</strong></span></footer>
  </main>
</div>`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('canvas');
const productionCanvas = $<HTMLCanvasElement>('productionCanvas');

function showRawBench() {
  canvas.style.display = 'block'; productionCanvas.style.display = 'none';
  const source = document.getElementById('source') as HTMLSelectElement | null;
  if (source) $('sourceStatus').textContent = Number(source.value) ? '64³ voxel + trilinear' : 'analytic continuous';
}

function showProductionPreview(preview: { current: Float32Array; dense: Float32Array; width: number; height: number }) {
  const { current, dense, width, height } = preview;
  productionCanvas.width = width * 3; productionCanvas.height = height;
  const context = productionCanvas.getContext('2d');
  if (!context) return;
  const image = context.createImageData(width * 3, height);
  const background = [0.36, 0.56, 0.81];
  const display = (value: number) => Math.round(255 * Math.min(1, Math.max(0, value)) ** (1 / 2.2));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const source = (y * width + x) * 4;
    for (let panel = 0; panel < 3; panel++) {
      const target = (y * width * 3 + panel * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const currentComposite = current[source + channel] + (1 - current[source + 3]) * background[channel];
        const denseComposite = dense[source + channel] + (1 - dense[source + 3]) * background[channel];
        const value = panel === 0 ? currentComposite : panel === 1 ? denseComposite : 4 * Math.abs(currentComposite - denseComposite);
        image.data[target + channel] = display(value);
      }
      image.data[target + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  canvas.style.display = 'none'; productionCanvas.style.display = 'block';
  $('sourceStatus').textContent = 'production atlas/world';
}

function buildVolumeMips(resolution: number) {
  const levels: { size: number; data: Uint8Array }[] = [];
  let size = resolution;
  let data = createDensityField('authored', resolution, 7).data.slice();
  levels.push({ size, data });
  while (size > 1) {
    const previous = data, previousSize = size;
    size = Math.max(1, size >> 1); data = new Uint8Array(size ** 3);
    for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        sum += previous[(x * 2 + dx) + (y * 2 + dy) * previousSize + (z * 2 + dz) * previousSize ** 2];
      }
      data[x + y * size + z * size * size] = Math.round(sum / 8);
    }
    levels.push({ size, data });
  }
  return levels;
}

function normalize(v: readonly number[]) {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length] as const;
}

function cross(a: readonly number[], b: readonly number[]) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] as const;
}

function cameraAt(time: number) {
  const phase = time / 12;
  const angle = -0.9 + phase * Math.PI * 1.5;
  const zoom = 0.5 + 0.5 * Math.cos(phase * Math.PI * 2);
  const radius = 1120 + 1250 * zoom;
  const camera = [Math.sin(angle) * radius, 490 + Math.sin(phase * Math.PI * 2) * 180, Math.cos(angle) * radius] as const;
  const target = [0, 470, 0] as const;
  const forward = normalize([target[0] - camera[0], target[1] - camera[1], target[2] - camera[2]]);
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = normalize(cross(right, forward));
  return { camera, forward, right, up };
}

function setMessage(message: string, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}

async function boot() {
  showRawBench();
  if (!navigator.gpu) throw new Error('This bench requires a desktop browser with WebGPU.');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No WebGPU adapter is available.');
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('Unable to create the WebGPU canvas context.');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  $('device').textContent = adapter.info.description || adapter.info.architecture || adapter.info.vendor || 'WebGPU';

  const levels = buildVolumeMips(VOXEL_RESOLUTION);
  const volume = device.createTexture({
    label: 'quality-bench-density-mips', size: [VOXEL_RESOLUTION, VOXEL_RESOLUTION, VOXEL_RESOLUTION],
    dimension: '3d', mipLevelCount: levels.length, format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  for (const [mipLevel, level] of levels.entries()) {
    const bytesPerRow = Math.ceil(level.size / 256) * 256;
    const padded = new Uint8Array(bytesPerRow * level.size * level.size);
    for (let z = 0; z < level.size; z++) for (let y = 0; y < level.size; y++) {
      padded.set(level.data.subarray((z * level.size + y) * level.size, (z * level.size + y + 1) * level.size), (z * level.size + y) * bytesPerRow);
    }
    device.queue.writeTexture({ texture: volume, mipLevel }, padded, { bytesPerRow, rowsPerImage: level.size }, [level.size, level.size, level.size]);
  }
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' });
  const makeOutput = (label: string) => device.createTexture({ label, size: [INTERNAL_WIDTH, INTERNAL_HEIGHT], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
  const reference = makeOutput('quality-reference');
  const candidate = makeOutput('quality-candidate');
  const computeModule = device.createShaderModule({ label: 'quality-integrator-wgsl', code: CLOUD_QUALITY_WGSL });
  const presentModule = device.createShaderModule({ label: 'quality-present-wgsl', code: PRESENT_WGSL });
  const productionModules = [
    device.createShaderModule({ label: 'production-cloudscape-wgsl', code: cloudscapeShader() }),
    device.createShaderModule({ label: 'production-light-cache-wgsl', code: LIGHT_CACHE_WGSL }),
    device.createShaderModule({ label: 'production-candidates-wgsl', code: CANDIDATE_WGSL }),
  ];
  for (const module of [computeModule, presentModule, ...productionModules]) {
    const info = await module.getCompilationInfo();
    const failures = info.messages.filter(message => message.type === 'error');
    if (failures.length) throw new Error(failures.map(message => `WGSL ${message.lineNum}:${message.linePos} ${message.message}`).join('\n'));
  }
  const computePipeline = device.createComputePipeline({ label: 'quality-integrator', layout: 'auto', compute: { module: computeModule, entryPoint: 'main' } });
  const presentPipeline = device.createRenderPipeline({
    label: 'quality-present', layout: 'auto', vertex: { module: presentModule, entryPoint: 'vertexMain' },
    fragment: { module: presentModule, entryPoint: 'fragmentMain', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  const referenceParams = device.createBuffer({ label: 'reference-params', size: 160, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const candidateParams = device.createBuffer({ label: 'candidate-params', size: 160, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const makeComputeBinding = (params: GPUBuffer, output: GPUTexture) => device.createBindGroup({ layout: computePipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: params } }, { binding: 1, resource: volume.createView() }, { binding: 2, resource: sampler }, { binding: 3, resource: output.createView() },
  ] });
  const referenceBinding = makeComputeBinding(referenceParams, reference);
  const candidateBinding = makeComputeBinding(candidateParams, candidate);
  const presentBinding = device.createBindGroup({ layout: presentPipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: candidate.createView() }, { binding: 1, resource: reference.createView() }, { binding: 2, resource: device.createSampler({ minFilter: 'nearest', magFilter: 'nearest' }) },
  ] });

  let time = 0, playing = true, auditing = false, frameIndex = 0, lastTimestamp = 0;
  let lastAudit: MotionMetrics | null = null;
  const paramData = (referencePass: boolean) => {
    const pose = cameraAt(time), values = new Float32Array(40);
    values.set([...pose.camera, time], 0);
    values.set([...pose.forward, Math.tan(48 * Math.PI / 360)], 4);
    values.set([...pose.right, INTERNAL_WIDTH / INTERNAL_HEIGHT], 8);
    values.set([...pose.up, 0], 12);
    values.set([...normalize([-0.62, 0.74, 0.26]), 0], 16);
    values.set([...BOUNDS_MIN, 0], 20); values.set([...BOUNDS_MAX, 0], 24);
    const source = Number($<HTMLSelectElement>('source').value) as SourceMode;
    values.set([0.006, referencePass ? REFERENCE_VIEW_STEPS : Number($<HTMLInputElement>('steps').value), referencePass ? REFERENCE_LIGHT_STEPS : Number($<HTMLInputElement>('light').value), source], 28);
    values.set([referencePass ? 0 : 1, referencePass ? 0 : Number($<HTMLSelectElement>('method').value), Number($<HTMLInputElement>('step').value), frameIndex], 32);
    values.set([INTERNAL_WIDTH, INTERNAL_HEIGHT, VOXEL_RESOLUTION, levels.length - 1], 36);
    return values;
  };
  const encodeFrame = (present: boolean) => {
    device.queue.writeBuffer(referenceParams, 0, paramData(true));
    device.queue.writeBuffer(candidateParams, 0, paramData(false));
    const encoder = device.createCommandEncoder({ label: 'quality-frame' });
    const compute = encoder.beginComputePass();
    compute.setPipeline(computePipeline);
    compute.setBindGroup(0, referenceBinding); compute.dispatchWorkgroups(Math.ceil(INTERNAL_WIDTH / 8), Math.ceil(INTERNAL_HEIGHT / 8));
    compute.setBindGroup(0, candidateBinding); compute.dispatchWorkgroups(Math.ceil(INTERNAL_WIDTH / 8), Math.ceil(INTERNAL_HEIGHT / 8));
    compute.end();
    if (present) {
      const render = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0.04, 0.06, 0.08, 1] }] });
      render.setPipeline(presentPipeline); render.setBindGroup(0, presentBinding); render.draw(3); render.end();
    }
    device.queue.submit([encoder.finish()]);
  };
  const readTexture = async (texture: GPUTexture) => {
    const bytesPerRow = Math.ceil(INTERNAL_WIDTH * 8 / 256) * 256;
    const buffer = device.createBuffer({ size: bytesPerRow * INTERNAL_HEIGHT, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [INTERNAL_WIDTH, INTERNAL_HEIGHT]);
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = new Uint16Array(buffer.getMappedRange());
    const packed = new Float32Array(INTERNAL_WIDTH * INTERNAL_HEIGHT * 4);
    const decodeFloat16 = (value: number) => {
      const sign = value & 0x8000 ? -1 : 1;
      const exponent = (value >> 10) & 31, mantissa = value & 1023;
      return sign * (exponent === 0 ? mantissa * 2 ** -24 : exponent === 31 ? (mantissa ? NaN : Infinity) : (1 + mantissa / 1024) * 2 ** (exponent - 15));
    };
    for (let y = 0; y < INTERNAL_HEIGHT; y++) for (let x = 0; x < INTERNAL_WIDTH * 4; x++) packed[y * INTERNAL_WIDTH * 4 + x] = decodeFloat16(mapped[y * bytesPerRow / 2 + x]);
    buffer.unmap(); buffer.destroy(); return packed;
  };
  const resize = () => {
    const ratio = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  };
  const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
  const refreshLabels = () => {
    $<HTMLOutputElement>('stepsValue').value = $<HTMLInputElement>('steps').value;
    $<HTMLOutputElement>('stepValue').value = `${$<HTMLInputElement>('step').value} m`;
    $<HTMLOutputElement>('lightValue').value = $<HTMLInputElement>('light').value;
    $<HTMLOutputElement>('timeValue').value = `${time.toFixed(2)} s`;
    $('sourceStatus').textContent = Number($<HTMLSelectElement>('source').value) ? '64³ voxel + trilinear' : 'analytic continuous';
  };
  for (const id of ['steps', 'step', 'light', 'source', 'method']) $(id).addEventListener('input', () => { showRawBench(); refreshLabels(); lastAudit = null; $('auditStatus').textContent = 'settings changed'; });
  const applyPreset = (method: CandidateMethod, steps: number, stepMetres: number, lightSteps: number) => {
    $<HTMLSelectElement>('method').value = String(method);
    $<HTMLInputElement>('steps').value = String(steps);
    $<HTMLInputElement>('step').value = String(stepMetres);
    $<HTMLInputElement>('light').value = String(lightSteps);
    lastAudit = null; $('auditStatus').textContent = 'preset selected'; refreshLabels();
  };
  $('currentPreset').onclick = () => applyPreset(0, 320, 24, 48);
  $('qualityPreset').onclick = () => applyPreset(1, 160, 24, 64);
  $('time').addEventListener('input', () => { showRawBench(); playing = false; $('play').textContent = 'Play'; time = Number($<HTMLInputElement>('time').value); refreshLabels(); });
  $('play').onclick = () => { showRawBench(); playing = !playing; $('play').textContent = playing ? 'Pause' : 'Play'; lastTimestamp = 0; };
  $('productionAudit').onclick = async () => {
    if (auditing) return;
    auditing = true; playing = false; $('play').textContent = 'Play';
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('button,input,select'));
    inputs.forEach(element => { element.disabled = true; });
    try {
      const result = await runProductionCloudAudit(message => setMessage(message), showProductionPreview);
      $('evidence').textContent = JSON.stringify(result, null, 2);
      const passed = result.denseSkipParityPassed && result.lightBudgetCacheRefreshPassed;
      $('auditStatus').textContent = passed ? 'production checks passed' : 'production checks failed';
      setMessage(passed
        ? `Production audit complete. Current/dense motion residual ${(result.currentVersusDense.temporalMae * 100).toFixed(4)}%; quality/dense ${(result.qualityVersusDense.temporalMae * 100).toFixed(4)}%.`
        : 'Production audit found a failed parity or cache invalidation check.', !passed);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error), true); }
    finally { auditing = false; inputs.forEach(element => { element.disabled = false; }); }
  };
  $('audit').onclick = async () => {
    if (auditing) return;
    showRawBench();
    auditing = true; playing = false; $('play').textContent = 'Play'; $<HTMLButtonElement>('audit').disabled = true;
    const previousTime = time, start = performance.now(), frames = [], temporal = [];
    let previousCandidate: Float32Array | undefined, previousReference: Float32Array | undefined;
    try {
      for (let i = 0; i < 24; i++) {
        time = i * 12 / 23; frameIndex = i; refreshLabels();
        setMessage(`Motion audit ${i + 1} / 24 — dense reference is intentionally expensive.`);
        encodeFrame(false); await device.queue.onSubmittedWorkDone();
        const [candidatePixels, referencePixels] = await Promise.all([readTexture(candidate), readTexture(reference)]);
        await device.queue.onSubmittedWorkDone();
        frames.push(compareFrames(candidatePixels, referencePixels));
        if (previousCandidate && previousReference) temporal.push(compareTemporalResidual(candidatePixels, previousCandidate, referencePixels, previousReference));
        previousCandidate = candidatePixels; previousReference = referencePixels;
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
      lastAudit = summarizeMotion(frames, temporal, performance.now() - start);
      const percent = (value: number) => value * 100 < 0.0001 ? '<0.0001%' : `${(value * 100).toFixed(4)}%`;
      $('auditStatus').textContent = `MAE ${percent(lastAudit.mae)} · motion ${percent(lastAudit.temporalMae)}`;
      $('evidence').textContent = JSON.stringify({
        source: Number($<HTMLSelectElement>('source').value) ? 'voxel-64-linear' : 'analytic-continuous',
        candidate: { method: $<HTMLSelectElement>('method').selectedOptions[0].textContent, viewSegments: Number($<HTMLInputElement>('steps').value), lightSamples: Number($<HTMLInputElement>('light').value), desiredStepMetres: Number($<HTMLInputElement>('step').value) },
        reference: { viewSegments: REFERENCE_VIEW_STEPS, lightSamples: REFERENCE_LIGHT_STEPS, integration: 'midpoint Beer-Lambert using physical segment length' },
        path: { durationSeconds: 12, samples: 24, motion: 'deterministic 270-degree orbit with radial zoom and vertical travel' },
        metrics: lastAudit,
        temporalDefinition: 'mean/p95 of abs((candidate_t-candidate_t-1)-(reference_t-reference_t-1)) in display RGB',
        historyAccumulation: false, postBlur: false, internalResolutionPerView: [INTERNAL_WIDTH, INTERNAL_HEIGHT],
      }, null, 2);
      setMessage(`Audit complete. Spatial MAE ${percent(lastAudit.mae)}; motion residual ${percent(lastAudit.temporalMae)}. Compare methods before drawing a quality conclusion.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error), true); }
    finally { time = previousTime; auditing = false; $<HTMLButtonElement>('audit').disabled = false; refreshLabels(); }
  };
  device.addEventListener('uncapturederror', event => setMessage((event as GPUUncapturedErrorEvent).error.message, true));
  void device.lost.then(info => setMessage(`WebGPU device lost: ${info.message || info.reason}`, true));
  refreshLabels(); setMessage('Ready. The animation is live; run the audit to measure camera-motion error.');
  const frame = (timestamp: number) => {
    if (!auditing) {
      if (playing) {
        const delta = lastTimestamp ? Math.min(0.1, (timestamp - lastTimestamp) / 1000) : 0;
        time = (time + delta) % 12; $<HTMLInputElement>('time').value = String(time); refreshLabels();
      }
      frameIndex++; encodeFrame(true);
    }
    lastTimestamp = timestamp; requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void boot().catch(error => setMessage(error instanceof Error ? error.message : String(error), true));
