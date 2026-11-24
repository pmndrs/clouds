// N2a/N2b lab page: HaloRT's per-pixel features (experiments/neural/feature-pass.ts) on the Disney cloud, nine 512² panels (3 x 3).
// Drag to orbit, wheel to zoom. Query: ?scale=<densityScale> (default 10; neural view 200 x densityRef = 179), ?step=<step> (default 0.004), ?vdb=sixteenth|eighth,
// ?g= (0.3), ?env= (8), ?sunAz= ?sunEl= (degrees). The same are sliders in the Review box.
// N3a: ?view=neural|features (default neural): the authors' HaloRT ONNX network on this page's device, fed by the packed features;
// ?sun= ?sky= ?exposure= (EV, as the demo's sliders: light_intensity x 2^sun, environment_scale x 2^sky), ?precision=fp32|fp16, ?spp= (16).
import { installCloudsHarness } from '../harness/clouds-contract';
import { loadDenseVdb, vdbLimits } from './density';
import { FEATURE, FEATURE_STRIDE, FeaturePass, PACKED_CHANNELS, type FeatureCamera } from '../../../experiments/neural/feature-pass';
import { HaloNet, ortDeviceRequest, type HaloPrecision } from '../../../experiments/neural/halort-net';

declare const __REPO_ROOT__: string;
const harness = installCloudsHarness();
const statusEl = document.getElementById('status')!;
const status = (s: string) => { statusEl.textContent = s; };

const SIZE = 512;
const q = new URLSearchParams(location.search);
const settings = {
  // Neural view without ?scale=: the authors' units, 200 x raw density (set after load: 200 x densityRef, as our grid is raw / p99).
  densityScale: Number(q.get('scale') ?? 10),
  g: Number(q.get('g') ?? 0.3),
  envSamples: Number(q.get('env') ?? 8),
  sunAz: Number(q.get('sunAz') ?? 120),
  sunEl: Number(q.get('sunEl') ?? 30),
  sun: Number(q.get('sun') ?? 2),
  sky: Number(q.get('sky') ?? 0),
  exposure: Number(q.get('exposure') ?? 1),
};
/** The demo's exported sun colour (scene.json light_intensity); the sun slider scales it by 2^sun. */
const SUN_RGB = [0.4418720602989197, 0.42135560512542725, 0.3813745379447937];
const maxSpp = Number(q.get('spp') ?? 16);
let view: 'neural' | 'features' = q.get('view') === 'features' ? 'features' : 'neural';
const NEURAL_PX = 1024;
const sunDirection = (): [number, number, number] => {
  const az = (settings.sunAz * Math.PI) / 180, el = (settings.sunEl * Math.PI) / 180;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
};
const stepSize = Number(q.get('step') ?? 0.004);
const vdbFile = `disney-cloud/wdas_cloud_${q.get('vdb') ?? 'eighth'}.vdb`;

/** Panels, left to right then top to bottom: [channel, label]. Values shown raw, clamped to [0, 1]. RGB | channel = three channels as colour. */
const RGB = 0x100;
const PANELS: [number, string][] = [
  [FEATURE.tr, 'tr = 1 - exp(-0.2 tau)'],
  [FEATURE.S, 'S = 1 - exp(-tau)'],
  [FEATURE.depth, 'depth = log(1 + 0.2 t1)   (crossing x4)'],
  [FEATURE.c1, 'crossing 2 (x1): (t2 - t1)^0.25'],
  [FEATURE.c2, 'crossing 3 (x0.25): (t3 - t2)^0.25'],
  [FEATURE.c3, 'crossing 4 (x0.125): (t4 - t3)^0.25'],
  [FEATURE.nee, 'nee (6): sun transmittance at x(t1)'],
  [RGB | FEATURE.envR, 'env rgb (7-9): mean T * HG * L / pdf'],
  [FEATURE.saR, 'albedo (10): sa ^ (2 tau (1 - sa g))'],
];

const RESEARCH_CANDIDATES = [`${__REPO_ROOT__}artifacts/research/`, `${__REPO_ROOT__}../../../artifacts/research/`];
async function researchUrl(file: string): Promise<string> {
  for (const base of RESEARCH_CANDIDATES) {
    try { const r = await fetch(`/@fs${base}disney-cloud/README.txt`, { method: 'HEAD' }); if (r.ok && !(r.headers.get('content-type') ?? '').includes('html')) return `/@fs${base}${file}`; } catch { /* next */ }
  }
  throw new Error(`artifacts/research not found (tried ${RESEARCH_CANDIDATES.join(', ')})`);
}

const DISPLAY_WGSL = /* wgsl */ `
struct D { size: u32, stride: u32, cols: u32, _p: u32, channels: array<vec4u, 3> }
@group(0) @binding(0) var<uniform> U: D;
@group(0) @binding(1) var<storage, read> F: array<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let px = vec2u(pos.xy);
  let panel = (px.y / U.size) * U.cols + px.x / U.size;
  let local = px % vec2u(U.size);
  let raw = U.channels[panel / 4u][panel % 4u];
  let ch = raw & 0xffu;
  let o = (local.y * U.size + local.x) * U.stride + ch;
  if ((raw & ${RGB}u) != 0u) { return vec4f(clamp(vec3f(F[o], F[o + 1u], F[o + 2u]), vec3f(0.0), vec3f(1.0)), 1.0); }
  let g = clamp(F[o], 0.0, 1.0);
  return vec4f(g, g, g, 1.0);
}`;

async function main() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error('no WebGPU adapter');
  // One device for the feature pass and ONNX Runtime (the features never leave the GPU): the larger of each limit both want.
  const ortReq = ortDeviceRequest(adapter);
  const limits: Record<string, number> = { ...ortReq.requiredLimits };
  for (const [k, v] of Object.entries(vdbLimits(adapter))) limits[k] = k.startsWith('min') ? Math.min(limits[k] ?? v, v) : Math.max(limits[k] ?? v, v);
  const device = await adapter.requestDevice({ requiredFeatures: ortReq.requiredFeatures, requiredLimits: limits });
  device.addEventListener('uncapturederror', e => harness.fail(`GPU: ${(e as GPUUncapturedErrorEvent).error.message}`));

  // Density: the Disney cloud through vdb-sky's route A resampler at its native voxel (VDB world units), / p99 into r16float.
  status(`fetching ${vdbFile}`);
  const t0 = performance.now();
  const res = await fetch(await researchUrl(vdbFile));
  if (!res.ok) throw new Error(`fetch ${vdbFile}: ${res.status}`);
  status('resampling');
  const dense = await loadDenseVdb(device, vdbFile.split('/').pop()!, await res.arrayBuffer());
  const densityTex = dense.texture;
  const [nx, nRow, nUp] = dense.dims;
  if (!q.has('scale') && view === 'neural') settings.densityScale = Math.round(200 * dense.densityRef);
  const loadMs = performance.now() - t0;
  // Object [-1, 1]^3; world half-extents (x, y up, z) with the longest axis at 1.
  const longest = Math.max(nx, nRow, nUp);
  const boxHalf: [number, number, number] = [nx / longest, nUp / longest, nRow / longest];

  const pass = new FeaturePass(device, SIZE, SIZE);
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const ctx = canvas.getContext('webgpu')!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });
  const cols = 3;
  const dispU = new Uint32Array(4 + 12);
  dispU.set([SIZE, FEATURE_STRIDE, cols, 0]);
  PANELS.forEach(([ch], i) => { dispU[4 + i] = ch; });
  const dispBuf = device.createBuffer({ size: dispU.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(dispBuf, 0, dispU);
  const dispModule = device.createShaderModule({ label: 'n2a display', code: DISPLAY_WGSL });
  const dispPipe = device.createRenderPipeline({ layout: 'auto', vertex: { module: dispModule, entryPoint: 'vs' }, fragment: { module: dispModule, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
  const dispGroup = device.createBindGroup({ layout: dispPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: dispBuf } }, { binding: 1, resource: { buffer: pass.output } }] });

  // HaloRT network (N3a): fp32 by default; fp16 needs shader-f16.
  const precision: HaloPrecision = q.get('precision') === 'fp16' && device.features.has('shader-f16') ? 'fp16' : 'fp32';
  status(`loading HaloRT ${SIZE} ${precision} (ONNX Runtime Web)`);
  const tNet = performance.now();
  const net = await HaloNet.create(device, SIZE, await researchUrl(`neural/rdv_on_the_web/halort/halort_${SIZE}${precision === 'fp16' ? '_fp16' : ''}.onnx`), format);
  const netLoadMs = Math.round(performance.now() - tNet);

  const wrap = document.getElementById('wrap')!;
  const labels: HTMLElement[] = [];
  PANELS.forEach(([, label], i) => {
    const el = document.createElement('div');
    el.className = 'label';
    el.textContent = label;
    el.style.left = `${(i % cols) * SIZE + 4}px`;
    el.style.top = `${Math.floor(i / cols) * SIZE + 4}px`;
    wrap.appendChild(el);
    labels.push(el);
  });
  const showLabels = () => labels.forEach(el => { el.style.display = view === 'features' ? '' : 'none'; });
  showLabels();

  // Orbit camera around the box centre.
  const orbit = { yaw: 0.6, pitch: 0.15, distance: 3.2 };
  const camera = (): FeatureCamera => {
    const cp = Math.cos(orbit.pitch);
    const pos: [number, number, number] = [Math.sin(orbit.yaw) * cp * orbit.distance, Math.sin(orbit.pitch) * orbit.distance, Math.cos(orbit.yaw) * cp * orbit.distance];
    const len = Math.hypot(...pos);
    const fwd: [number, number, number] = [-pos[0] / len, -pos[1] / len, -pos[2] / len];
    const rl = Math.hypot(fwd[2], fwd[0]);
    const right: [number, number, number] = [-fwd[2] / rl, 0, fwd[0] / rl];
    const up: [number, number, number] = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
    return { position: pos, forward: fwd, right, up, fovY: (40 * Math.PI) / 180 };
  };
  let dirty = true;
  let drag: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    orbit.yaw -= (e.clientX - drag.x) * 0.005;
    orbit.pitch = Math.max(-1.4, Math.min(1.4, orbit.pitch + (e.clientY - drag.y) * 0.005));
    drag = { x: e.clientX, y: e.clientY };
    dirty = true;
  });
  canvas.addEventListener('wheel', e => { e.preventDefault(); orbit.distance = Math.max(1.2, Math.min(10, orbit.distance * Math.exp(e.deltaY * 0.001))); dirty = true; }, { passive: false });

  const info = { precision, netLoadMs, vdb: vdbFile, gridName: dense.gridName, dims: dense.dims, nativeVoxel: dense.voxel, densityRef: dense.densityRef, boxHalf, stepSize, envScale: pass.envScale, loadMs: Math.round(loadMs) };
  let frameMs = 0;
  const showStatus = () => status(`${vdbFile.split('/').pop()}  ${nx}x${nRow}x${nUp}  densityScale ${settings.densityScale}  step ${stepSize}  g ${settings.g}  env ${settings.envSamples}  sun az ${settings.sunAz} el ${settings.sunEl}  ${view === 'neural' ? `HaloRT ${precision} spp ${net.spp}  frame ${frameMs.toFixed(0)} ms  ` : ''}(drag to orbit)`);
  showStatus();

  // Review box: sliders for the inputs the second half of the pass reads.
  const review = document.getElementById('review')!;
  const slider = (key: keyof typeof settings, label: string, min: number, max: number, step: number) => {
    const row = document.createElement('label');
    const input = document.createElement('input');
    Object.assign(input, { type: 'range', min: String(min), max: String(max), step: String(step), value: String(settings[key]) });
    const val = document.createElement('span');
    val.textContent = String(settings[key]);
    input.addEventListener('input', () => { settings[key] = Number(input.value); val.textContent = input.value; dirty = true; showStatus(); });
    row.append(`${label} `, input, val);
    review.appendChild(row);
  };
  slider('sunAz', 'sun azimuth', -180, 180, 1);
  slider('sunEl', 'sun elevation', -10, 90, 1);
  slider('g', 'g', -0.9, 0.95, 0.05);
  slider('densityScale', 'density scale', 1, 300, 1);
  slider('envSamples', 'env samples', 0, 64, 1);
  slider('sun', 'sun intensity (EV)', -3, 5, 0.1);
  slider('sky', 'sky intensity (EV)', -3, 3, 0.1);
  slider('exposure', 'exposure (EV)', -3, 5, 0.1);
  const toggle = document.createElement('label');
  const box = document.createElement('input');
  Object.assign(box, { type: 'checkbox', checked: view === 'features' });
  box.addEventListener('change', () => { view = box.checked ? 'features' : 'neural'; showLabels(); dirty = true; showStatus(); });
  toggle.append('feature panels ', box);
  review.appendChild(toggle);

  // Features (when dirty, or every frame while the network accumulates: new env samples per frame), then the network, then display.
  // The network run is async: one step in flight at a time; the display draws whatever has accumulated.
  let busy = false;
  let lastStep = 0, steps = 0;
  const encodeFeatures = (enc: GPUCommandEncoder) => pass.encode(enc, { density: densityTex, boxHalf, camera: camera(), densityScale: settings.densityScale, stepSize, g: settings.g, envSamples: settings.envSamples, sunDirection: sunDirection() });
  const step = async () => {
    if (dirty) { dirty = false; net.restart(); steps = 0; }
    const enc = device.createCommandEncoder();
    encodeFeatures(enc);
    device.queue.submit([enc.finish()]);
    if (view !== 'neural') return;
    await net.run(pass.packed, SUN_RGB.map(x => x * Math.pow(2, settings.sun)), pass.envScale.map(x => x * Math.pow(2, settings.sky)));
    const now = performance.now();
    if (steps++ > 0) frameMs = frameMs ? frameMs * 0.8 + (now - lastStep) * 0.2 : now - lastStep;
    lastStep = now;
    showStatus();
  };
  const needsStep = () => dirty || (view === 'neural' && net.spp < maxSpp);
  const frame = () => {
    if (!busy && needsStep()) {
      busy = true;
      step().catch(e => harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e))).finally(() => { busy = false; });
    }
    const enc = device.createCommandEncoder();
    const target = ctx.getCurrentTexture().createView();
    if (view === 'neural') net.draw(enc, target, settings.exposure, [0, 0], [NEURAL_PX, NEURAL_PX]);
    else {
      const rp = enc.beginRenderPass({ colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
      rp.setPipeline(dispPipe);
      rp.setBindGroup(0, dispGroup);
      rp.draw(3);
      rp.end();
    }
    device.queue.submit([enc.finish()]);
    harness.frame();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  await device.queue.onSubmittedWorkDone();

  /** Per-channel min / mean / max over pixels with at least one crossing, plus coverage. */
  const report = async () => {
    const data = await pass.read();
    const names = Object.entries(FEATURE) as [string, number][];
    const stats: Record<string, { min: number; mean: number; max: number }> = {};
    let hit = 0, anyTau = 0;
    const acc = names.map(() => ({ min: Infinity, sum: 0, max: -Infinity }));
    for (let p = 0; p < SIZE * SIZE; p++) {
      const o = p * FEATURE_STRIDE;
      if (data[o + FEATURE.tau] > 0) anyTau++;
      if (data[o + FEATURE.count] < 1) continue;
      hit++;
      names.forEach(([, ch], i) => { const v = data[o + ch]; acc[i].min = Math.min(acc[i].min, v); acc[i].max = Math.max(acc[i].max, v); acc[i].sum += v; });
    }
    names.forEach(([n], i) => { stats[n] = { min: +acc[i].min.toFixed(4), mean: +(acc[i].sum / Math.max(1, hit)).toFixed(4), max: +acc[i].max.toFixed(4) }; });
    return { ...info, view, neural: view === 'neural' ? { ...(await net.stats()), frameIntervalMs: +frameMs.toFixed(1), sunRgb: SUN_RGB.map(x => x * Math.pow(2, settings.sun)) } : null, settings: { ...settings }, sunDirection: sunDirection(), orbit: { ...orbit }, pixels: SIZE * SIZE, pixelsWithTau: anyTau, pixelsWithCrossing: hit, stats, packed: await packedCheck() };
  };

  /** Reads the packed ONNX input back and checks it against the per-pixel buffer (rdv order: our pixel turned 180 degrees). */
  const packedCheck = async () => {
    const staging = device.createBuffer({ size: pass.packed.size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(pass.packed, 0, staging, 0, pass.packed.size);
    device.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const packed = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap(); staging.destroy();
    const data = await pass.read();
    const plane = SIZE * SIZE;
    let maxDiff = 0;
    for (let y = 0; y < SIZE; y += 7) for (let x = 0; x < SIZE; x += 7) {
      const rdv = (SIZE - 1 - y) * SIZE + (SIZE - 1 - x);
      PACKED_CHANNELS.forEach((ch, c) => { maxDiff = Math.max(maxDiff, Math.abs(packed[c * plane + rdv] - data[(y * SIZE + x) * FEATURE_STRIDE + ch])); });
    }
    return { dims: [1, PACKED_CHANNELS.length, SIZE, SIZE], maxDiffVsFeatures: maxDiff };
  };
  harness.ready({ report, busy: () => busy || needsStep() });
}

main().catch(e => harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e)));
