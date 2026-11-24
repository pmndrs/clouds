// N2a lab page: HaloRT's primary-ray features (experiments/neural/feature-pass.ts) on the Disney cloud, as six grayscale 512² panels.
// Drag to orbit, wheel to zoom. Query: ?scale=<densityScale> (default 10), ?step=<step> (default 0.004), ?vdb=sixteenth|eighth.
import { installCloudsHarness } from '../harness/clouds-contract';
import { loadDenseVdb, vdbLimits } from './density';
import { FEATURE, FEATURE_STRIDE, FeaturePass, type FeatureCamera } from '../../../experiments/neural/feature-pass';

declare const __REPO_ROOT__: string;
const harness = installCloudsHarness();
const statusEl = document.getElementById('status')!;
const status = (s: string) => { statusEl.textContent = s; };

const SIZE = 512;
const q = new URLSearchParams(location.search);
const densityScale = Number(q.get('scale') ?? 10);
const stepSize = Number(q.get('step') ?? 0.004);
const vdbFile = `disney-cloud/wdas_cloud_${q.get('vdb') ?? 'eighth'}.vdb`;

/** Panels, left to right then top to bottom: [channel, label]. Values shown raw, clamped to [0, 1]. */
const PANELS: [number, string][] = [
  [FEATURE.tr, 'tr = 1 - exp(-0.2 tau)'],
  [FEATURE.S, 'S = 1 - exp(-tau)'],
  [FEATURE.depth, 'depth = log(1 + 0.2 t1)   (crossing x4)'],
  [FEATURE.c1, 'crossing 2 (x1): (t2 - t1)^0.25'],
  [FEATURE.c2, 'crossing 3 (x0.25): (t3 - t2)^0.25'],
  [FEATURE.c3, 'crossing 4 (x0.125): (t4 - t3)^0.25'],
];

const RESEARCH_CANDIDATES = [`${__REPO_ROOT__}artifacts/research/`, `${__REPO_ROOT__}../../../artifacts/research/`];
async function researchUrl(file: string): Promise<string> {
  for (const base of RESEARCH_CANDIDATES) {
    try { const r = await fetch(`/@fs${base}disney-cloud/README.txt`, { method: 'HEAD' }); if (r.ok && !(r.headers.get('content-type') ?? '').includes('html')) return `/@fs${base}${file}`; } catch { /* next */ }
  }
  throw new Error(`artifacts/research not found (tried ${RESEARCH_CANDIDATES.join(', ')})`);
}

const DISPLAY_WGSL = /* wgsl */ `
struct D { size: u32, stride: u32, cols: u32, _p: u32, channels: array<vec4u, 2> }
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
  let ch = U.channels[panel / 4u][panel % 4u];
  let v = F[(local.y * U.size + local.x) * U.stride + ch];
  let g = clamp(v, 0.0, 1.0);
  return vec4f(g, g, g, 1.0);
}`;

async function main() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error('no WebGPU adapter');
  const device = await adapter.requestDevice({ requiredLimits: vdbLimits(adapter) });
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
  const dispU = new Uint32Array(4 + 8);
  dispU.set([SIZE, FEATURE_STRIDE, cols, 0]);
  PANELS.forEach(([ch], i) => { dispU[4 + i] = ch; });
  const dispBuf = device.createBuffer({ size: dispU.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(dispBuf, 0, dispU);
  const dispModule = device.createShaderModule({ label: 'n2a display', code: DISPLAY_WGSL });
  const dispPipe = device.createRenderPipeline({ layout: 'auto', vertex: { module: dispModule, entryPoint: 'vs' }, fragment: { module: dispModule, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
  const dispGroup = device.createBindGroup({ layout: dispPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: dispBuf } }, { binding: 1, resource: { buffer: pass.output } }] });

  const wrap = document.getElementById('wrap')!;
  PANELS.forEach(([, label], i) => {
    const el = document.createElement('div');
    el.className = 'label';
    el.textContent = label;
    el.style.left = `${(i % cols) * SIZE + 4}px`;
    el.style.top = `${Math.floor(i / cols) * SIZE + 4}px`;
    wrap.appendChild(el);
  });

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

  const info = { vdb: vdbFile, gridName: dense.gridName, dims: dense.dims, nativeVoxel: dense.voxel, densityRef: dense.densityRef, boxHalf, densityScale, stepSize, loadMs: Math.round(loadMs) };
  status(`${vdbFile.split('/').pop()}  ${nx}x${nRow}x${nUp}  densityScale ${densityScale}  step ${stepSize}  (drag to orbit)`);

  const frame = () => {
    const enc = device.createCommandEncoder();
    if (dirty) { pass.encode(enc, { density: densityTex, boxHalf, camera: camera(), densityScale, stepSize }); dirty = false; }
    const rp = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    rp.setPipeline(dispPipe);
    rp.setBindGroup(0, dispGroup);
    rp.draw(3);
    rp.end();
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
    return { ...info, orbit: { ...orbit }, pixels: SIZE * SIZE, pixelsWithTau: anyTau, pixelsWithCrossing: hit, stats };
  };
  harness.ready({ report });
}

main().catch(e => harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e)));
