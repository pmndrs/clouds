// N5.9: parity page for the block attention layer (experiments/neural/engine/attention.ts).
// For each attention layer, feeds the NumPy reference's INPUT (`<set>.<layer>.attn_in` / `mid_attn_in`, pass 0)
// as a batch of 6 (items 0-2 = dir input with weight set 0, items 3-5 = env input with set 1), runs the layer
// (qkv + attn dispatches) twice in one pass and one submit: without residual (compared with the reference's
// `.attn` / `mid_attn` dump, all six items) and with the fused residual (compared with attn + input, items 0 and 3).
// Dumps: artifacts/research/neural/fixture/dumps_all/<size>/ (halonet_ref.py --dump-all, local, not committed).
// Query: ?size=256|512 (default 256), ?precision=fp32|fp16 (default fp32). Report: window.__clouds.report().
import { AttentionLayer } from '../../../experiments/neural/engine/attention';
import { parseTZA } from '../../../experiments/neural/engine/tza';

declare const __REPO_ROOT__: string;
const q = new URLSearchParams(location.search);
const SIZE = Number(q.get('size') ?? 256);
const F16 = q.get('precision') === 'fp16';
const status = (s: string) => { document.getElementById('s')!.textContent = s; };
const clouds: Record<string, unknown> = { ready: false };
(window as unknown as Record<string, unknown>).__clouds = clouds;
const F16A = (globalThis as unknown as { Float16Array?: Float32ArrayConstructor }).Float16Array;

const CANDIDATES = [`${__REPO_ROOT__}artifacts/research/`, `${__REPO_ROOT__}../../../artifacts/research/`];
async function researchUrl(file: string): Promise<string> {
  for (const base of CANDIDATES) {
    try {
      const r = await fetch(`/@fs${base}${file}`, { method: 'HEAD' });
      if (r.ok && !(r.headers.get('content-type') ?? '').includes('html')) return `/@fs${base}${file}`;
    } catch { /* next */ }
  }
  throw new Error(`artifacts/research/${file} not found`);
}
const fetchBuf = async (file: string) => {
  const r = await fetch(await researchUrl(file));
  if (!r.ok) throw new Error(`${file}: ${r.status}`);
  return r.arrayBuffer();
};

// layer prefix in the weights, dump name stem, block size
const LAYERS: { prefix: string; dump: string; bs: number }[] = [
  { prefix: 'downs.3.2', dump: 'downs.3.attn', bs: 8 },
  { prefix: 'downs.5.2', dump: 'downs.5.attn', bs: 8 },
  { prefix: 'mid_attn', dump: 'mid_attn', bs: 4 },
  { prefix: 'ups.1.2', dump: 'ups.1.attn', bs: 8 },
  { prefix: 'ups.3.2', dump: 'ups.3.attn', bs: 8 },
];

/** CHW items -> NC4HW4 with batch (C multiple of 4). */
function toPacked(items: Float32Array[], C: number, HW: number): Float32Array {
  const C4 = C / 4, out = new Float32Array(items.length * C * HW);
  items.forEach((a, b) => {
    for (let c = 0; c < C; c++) for (let p = 0; p < HW; p++) out[((b * C4 + (c >> 2)) * HW + p) * 4 + (c & 3)] = a[c * HW + p];
  });
  return out;
}
function fromPacked(buf: Float32Array, b: number, C: number, HW: number): Float32Array {
  const C4 = C / 4, out = new Float32Array(C * HW);
  for (let c = 0; c < C; c++) for (let p = 0; p < HW; p++) out[c * HW + p] = buf[((b * C4 + (c >> 2)) * HW + p) * 4 + (c & 3)];
  return out;
}

function diff(a: Float32Array, b: Float32Array) {
  let max = 0, sum = 0, ref = 0, nonFinite = 0, d2 = 0, r2 = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (!Number.isFinite(d)) { nonFinite++; continue; }
    if (d > max) max = d;
    sum += d; ref += Math.abs(b[i]); d2 += d * d; r2 += b[i] * b[i];
  }
  return { maxAbs: max, meanAbs: sum / a.length, meanAbsRef: ref / a.length, relL2: Math.sqrt(d2 / r2), nonFinite };
}

async function main() {
  if (F16 && !F16A) throw new Error('fp16 needs Float16Array');
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('no WebGPU adapter');
  const device = await adapter.requestDevice({ requiredFeatures: adapter.features.has('shader-f16') ? ['shader-f16'] : [] });
  let gpuError: string | undefined;
  device.addEventListener('uncapturederror', (e) => { gpuError = (e as GPUUncapturedErrorEvent).error.message; });

  status('loading weights and dumps');
  const dir = `neural/fixture/dumps_all/${SIZE}`;
  const [dirBuf, envBuf, idxBuf] = await Promise.all([
    fetchBuf('neural/weights/halo_dir.tza'), fetchBuf('neural/weights/halo_env.tza'), fetchBuf(`${dir}/index.json`),
  ]);
  const sets: [ReturnType<typeof parseTZA>, ReturnType<typeof parseTZA>] = [parseTZA(dirBuf), parseTZA(envBuf)];
  const index = JSON.parse(new TextDecoder().decode(idxBuf)) as Record<string, { file: string; shape: number[] }>;
  const dump = async (n: string) => {
    if (!index[n]) throw new Error(`dump ${n} missing (run halonet_ref.py --dump-all)`);
    return { data: new Float32Array(await fetchBuf(`${dir}/${index[n].file}`)), shape: index[n].shape };
  };

  const rows: Record<string, unknown>[] = [];
  const results = [];
  for (const L of LAYERS) {
    status(`running ${L.prefix}`);
    const inName = L.dump === 'mid_attn' ? 'mid_attn_in' : `${L.dump}_in`;
    const [inD, inE, outD, outE] = await Promise.all([dump(`dir.${inName}`), dump(`env.${inName}`), dump(`dir.${L.dump}`), dump(`env.${L.dump}`)]);
    const [C, H, W] = inD.shape, HW = H * W;
    const layer = await AttentionLayer.create(device, L.prefix, L.bs, sets, { f16: F16, batch: 6, setSplit: 3 });
    const items = [inD.data, inD.data, inD.data, inE.data, inE.data, inE.data];
    const packed = toPacked(items, C, HW);
    const host = F16 ? new F16A!(packed) : packed;
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    const src = device.createBuffer({ size: host.byteLength, usage, label: `${L.prefix} src` });
    device.queue.writeBuffer(src, 0, host.buffer as ArrayBuffer, host.byteOffset, host.byteLength);
    const dstA = device.createBuffer({ size: host.byteLength, usage, label: `${L.prefix} out` });
    const dstB = device.createBuffer({ size: host.byteLength, usage, label: `${L.prefix} out+x` });
    const bA = layer.bind(H, W, src, dstA), bB = layer.bind(H, W, src, dstB, { residual: true });
    const rbA = device.createBuffer({ size: host.byteLength, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const rbB = device.createBuffer({ size: host.byteLength, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    bA.encode(pass); bB.encode(pass);
    pass.end();
    enc.copyBufferToBuffer(dstA, 0, rbA, 0, host.byteLength);
    enc.copyBufferToBuffer(dstB, 0, rbB, 0, host.byteLength);
    device.queue.submit([enc.finish()]);
    await Promise.all([rbA.mapAsync(GPUMapMode.READ), rbB.mapAsync(GPUMapMode.READ)]);
    const read = (b: GPUBuffer) => (F16 ? Float32Array.from(new F16A!(b.getMappedRange().slice(0))) : new Float32Array(b.getMappedRange().slice(0)));
    const A = read(rbA), B = read(rbB);
    const refs = [outD.data, outD.data, outD.data, outE.data, outE.data, outE.data];
    const noRes = refs.map((r, b) => ({ item: b, ...diff(fromPacked(A, b, C, HW), r) }));
    const withRes = [0, 3].map((b) => {
      const ref = refs[b].map((v, i) => v + items[b][i]);
      return { item: b, ...diff(fromPacked(B, b, C, HW), ref) };
    });
    results.push({ layer: L.prefix, C, H, W, bs: L.bs, noRes, withRes });
    for (const r of noRes) rows.push({ layer: L.prefix, kind: 'attn', ...r });
    for (const r of withRes) rows.push({ layer: L.prefix, kind: 'attn+x', ...r });
    bA.release(); bB.release(); layer.release();
    for (const b of [src, dstA, dstB, rbA, rbB]) b.destroy();
  }

  const threshold = F16 ? 5e-3 : 1e-4;
  const ok = (r: { maxAbs: number; relL2: number; nonFinite: number }) => !r.nonFinite && (F16 ? r.relL2 : r.maxAbs) <= threshold;
  // the brief's check: downs.3 attention and mid_attn, items 0 and 3; all others reported too
  const required = results.filter((r) => r.layer === 'downs.3.2' || r.layer === 'mid_attn')
    .flatMap((r) => r.noRes.filter((x) => x.item === 0 || x.item === 3));
  const pass = !gpuError && required.every(ok);
  const passAll = !gpuError && results.every((r) => r.noRes.every(ok) && r.withRes.every(ok));
  const report = {
    task: 'N5.9', size: SIZE, precision: F16 ? 'fp16' : 'fp32', batch: 6, setSplit: 3, measure: F16 ? 'relL2' : 'maxAbs', threshold,
    pass, passAll, gpuError, results, adapter: { vendor: adapter.info?.vendor, architecture: adapter.info?.architecture },
  };
  const f = (x: number) => x.toExponential(2);
  status([
    `${SIZE}², ${report.precision}, batch 6 (0-2 dir, 3-5 env), ${report.measure} <= ${f(threshold)}: required (downs.3, mid_attn items 0/3) ${pass ? 'PASS' : 'FAIL'}, all ${passAll ? 'PASS' : 'FAIL'}`,
    gpuError ? `GPU error: ${gpuError}` : '',
    '', 'layer       C   HxW     kind    item   max abs     mean abs    mean |ref|  rel L2',
    ...results.flatMap((r) => [...r.noRes.map((x) => ['attn', x] as const), ...r.withRes.map((x) => ['attn+x', x] as const)].map(([k, x]) =>
      `${r.layer.padEnd(11)} ${String(r.C).padEnd(3)} ${`${r.H}x${r.W}`.padEnd(7)} ${k.padEnd(7)} ${String(x.item).padEnd(4)} ${f(x.maxAbs).padStart(10)}  ${f(x.meanAbs).padStart(10)}  ${f(x.meanAbsRef).padStart(10)}  ${f(x.relL2)}`)),
  ].join('\n'));
  clouds.report = () => report;
  clouds.ready = true;
}
main().catch((e) => { clouds.error = String(e?.stack ?? e); status(String(e?.stack ?? e)); });
