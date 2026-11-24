// N5.6: parity page for the hand-written HaloRT engine (experiments/neural/engine/), first layer only.
// Loads halo_dir.tza + halo_env.tza and the fixture's packed `condition` frame ([1,17,S,S] planar f32) from
// artifacts/research/neural/ (local, not committed), runs init_conv for a batch of 6 (items 0-2 dir passes 0-2,
// 3-5 env passes 0-2) in one pass and one submit, reads it back, and compares:
//   - items 0 and 3 with the NumPy dumps dir.init_conv / env.init_conv (scripts/neural/halonet_ref.py, pass 0);
//   - all six items with a plain JS conv3x3 on the CPU (the dumps only hold pass 0; this covers the gather of passes 1-2).
// N5.7: the graph is now init_conv + stage 0's two ResnetBlocks (kernels A/B: conv3x3 + RMSNorm + SiLU, identity
// skip, x2 fused in the last op); items 0 and 3 are also compared with dumps downs.0.block1 / downs.0.post_attn_add.
// N5.8: a second graph of independent pieces (Down as 2x2 s2, 32/64-channel ResnetBlocks, up stages with concat
// + res_conv skip and nearest-up conv, final_res_block, final_conv), each fed its reference INPUT from the
// --dump-all dumps in dumps/<size>-all/ (items 0-2 get the dir dump, 3-5 the env dump) and compared on items 0 and 3.
// Query: ?size=256|512 (default 256), ?precision=fp32|fp16 (default fp32). Report: window.__clouds.report().
import { Engine } from '../../../experiments/neural/engine/runtime';
import { HALO_GATHER_B6, n58Graph, stage0Graph } from '../../../experiments/neural/engine/graph';
import { parseTZA, type TensorMap } from '../../../experiments/neural/engine/tza';

declare const __REPO_ROOT__: string;
const q = new URLSearchParams(location.search);
const SIZE = Number(q.get('size') ?? 256);
const F16 = q.get('precision') === 'fp16';
const ITEMS = ['dir pass 0', 'dir pass 1', 'dir pass 2', 'env pass 0', 'env pass 1', 'env pass 2'];
const status = (s: string) => { document.getElementById('s')!.textContent = s; };
const clouds: Record<string, unknown> = { ready: false };
(window as unknown as Record<string, unknown>).__clouds = clouds;

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

/** CPU reference: zero-padded 3x3 cross-correlation + bias on gathered planes of cond [17,S,S]. Returns [16,S,S]. */
function cpuInitConv(W: TensorMap, cond: Float32Array, gather: number[], S: number): Float32Array {
  const w = W.get('init_conv.weight')!.data, b = W.get('init_conv.bias')!.data;
  const cout = 16, cin = 8, plane = S * S;
  const out = new Float32Array(cout * plane);
  for (let o = 0; o < cout; o++) {
    const dst = out.subarray(o * plane, (o + 1) * plane);
    dst.fill(b[o]);
    for (let i = 0; i < cin; i++) {
      const src = cond.subarray(gather[i] * plane, (gather[i] + 1) * plane);
      for (let ky = 0; ky < 3; ky++) for (let kx = 0; kx < 3; kx++) {
        const k = w[((o * cin + i) * 3 + ky) * 3 + kx];
        for (let y = 0; y < S; y++) {
          const sy = y + ky - 1;
          if (sy < 0 || sy >= S) continue;
          const x0 = Math.max(0, 1 - kx), x1 = Math.min(S, S + 1 - kx);
          const so = sy * S + kx - 1, dO = y * S;
          for (let x = x0; x < x1; x++) dst[dO + x] += k * src[so + x];
        }
      }
    }
  }
  return out;
}

function diff(a: Float32Array, b: Float32Array) {
  let max = 0, sum = 0, ref = 0, nonFinite = 0, at = -1, d2 = 0, r2 = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (!Number.isFinite(d)) { nonFinite++; continue; }
    if (d > max) { max = d; at = i; }
    sum += d; ref += Math.abs(b[i]); d2 += d * d; r2 += b[i] * b[i];
  }
  // relL2 = ||a - b|| / ||b||: ENGINE.md §7's per-layer measure (fp16 threshold 5e-3)
  return { maxAbs: max, meanAbs: sum / a.length, meanAbsRef: ref / a.length, relL2: Math.sqrt(d2 / r2), nonFinite, maxAt: at };
}

async function main() {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('no WebGPU adapter');
  const device = await adapter.requestDevice({ requiredFeatures: adapter.features.has('shader-f16') ? ['shader-f16'] : [] });
  let gpuError: string | undefined;
  device.addEventListener('uncapturederror', (e) => { gpuError = (e as GPUUncapturedErrorEvent).error.message; });

  status('loading weights and fixture');
  const [dirBuf, envBuf, condBuf, idxBuf] = await Promise.all([
    fetchBuf('neural/weights/halo_dir.tza'), fetchBuf('neural/weights/halo_env.tza'),
    fetchBuf(`neural/fixture/cond_${SIZE}.f32`), fetchBuf(`neural/fixture/dumps/${SIZE}/index.json`),
  ]);
  const Wd = parseTZA(dirBuf), We = parseTZA(envBuf);
  const cond = new Float32Array(condBuf);
  if (cond.length !== 17 * SIZE * SIZE) throw new Error(`cond_${SIZE}: ${cond.length} floats`);
  const index = JSON.parse(new TextDecoder().decode(idxBuf)) as Record<string, { file: string; shape: number[] }>;
  const dumps = {
    dir: new Float32Array(await fetchBuf(`neural/fixture/dumps/${SIZE}/${index['dir.init_conv'].file}`)),
    env: new Float32Array(await fetchBuf(`neural/fixture/dumps/${SIZE}/${index['env.init_conv'].file}`)),
  };
  // N5.7: stage 0 dumps (tensor 2 = first ResnetBlock out, tensor 4 = second ResnetBlock out x2)
  const STAGE0 = [{ id: 2, ref: 'downs.0.block1' }, { id: 4, ref: 'downs.0.post_attn_add' }];
  const stageDumps = new Map<string, Float32Array>();
  for (const set of ['dir', 'env']) for (const { ref } of STAGE0) {
    stageDumps.set(`${set}.${ref}`, new Float32Array(await fetchBuf(`neural/fixture/dumps/${SIZE}/${index[`${set}.${ref}`].file}`)));
  }

  status('building engine');
  const graph = stage0Graph(HALO_GATHER_B6);
  const engine = await Engine.create(device, graph, [Wd, We], { f16: F16, batch: 6, setSplit: 3, keep: [0, 2, 4] });
  const input = device.createBuffer({ size: cond.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, label: 'cond' });
  device.queue.writeBuffer(input, 0, cond);
  const binding = engine.bind(SIZE, input);
  binding.run();
  const out = await binding.readTensor(0);
  const per = 16 * SIZE * SIZE;
  const item = (b: number) => out.subarray(b * per, (b + 1) * per);

  status('comparing');
  const vsNumpy = [
    { item: 0, name: ITEMS[0], ref: 'dir.init_conv', ...diff(item(0), dumps.dir) },
    { item: 3, name: ITEMS[3], ref: 'env.init_conv', ...diff(item(3), dumps.env) },
  ];
  for (const { id, ref } of STAGE0) {
    const t = await binding.readTensor(id);
    for (const b of [0, 3]) {
      const key = `${b < 3 ? 'dir' : 'env'}.${ref}`;
      vsNumpy.push({ item: b, name: ITEMS[b], ref: key, ...diff(t.subarray(b * per, (b + 1) * per), stageDumps.get(key)!) });
    }
  }
  const vsCpu = ITEMS.map((name, b) => {
    const ref = cpuInitConv(b < 3 ? Wd : We, cond, HALO_GATHER_B6[b], SIZE);
    return { item: b, name, ...diff(item(b), ref) };
  });
  const cpuVsNumpy = [diff(cpuInitConv(Wd, cond, HALO_GATHER_B6[0], SIZE), dumps.dir).maxAbs, diff(cpuInitConv(We, cond, HALO_GATHER_B6[3], SIZE), dumps.env).maxAbs];
  // fp32: max abs <= 1e-4 (N5.6 brief). fp16: relative L2 <= 5e-3 (ENGINE.md §7); max abs is then at f16 output rounding.
  const threshold = F16 ? 5e-3 : 1e-4;
  const ok = (r: { maxAbs: number; relL2: number; nonFinite: number }) => !r.nonFinite && (F16 ? r.relL2 : r.maxAbs) <= threshold;
  // ---- N5.8 pieces ----
  status('N5.8: loading dumps');
  const allDir = `neural/fixture/dumps/${SIZE}-all`;
  const allIndex = JSON.parse(new TextDecoder().decode(await fetchBuf(`${allDir}/index.json`))) as Record<string, { file: string; shape: number[] }>;
  const dumpCache = new Map<string, Float32Array>();
  const dump = async (key: string) => {
    if (!dumpCache.has(key)) {
      if (!allIndex[key]) throw new Error(`dump ${key} missing in ${allDir} (run halonet_ref.py --dump-all)`);
      dumpCache.set(key, new Float32Array(await fetchBuf(`${allDir}/${allIndex[key].file}`)));
    }
    return dumpCache.get(key)!;
  };
  const { graph: g58, pieces } = n58Graph();
  const outIds = pieces.flatMap((pc) => Object.keys(pc.outputs).map(Number));
  status('N5.8: building engine');
  const e58 = await Engine.create(device, g58, [Wd, We], { f16: F16, batch: 6, setSplit: 3, keep: outIds });
  const b58 = e58.bind(SIZE, input);
  for (const pc of pieces) for (const [id, name] of Object.entries(pc.inputs)) {
    const [dd, de] = [await dump(`dir.${name}`), await dump(`env.${name}`)];
    const all = new Float32Array(dd.length * 6);
    for (let b = 0; b < 6; b++) all.set(b < 3 ? dd : de, b * dd.length);
    b58.writeTensor(Number(id), all);
  }
  b58.run();
  status('N5.8: comparing');
  const n58: { piece: string; tensor: number; item: number; ref: string; maxAbs: number; meanAbs: number; meanAbsRef: number; relL2: number; nonFinite: number }[] = [];
  for (const pc of pieces) for (const [id, name] of Object.entries(pc.outputs)) {
    const t = await b58.readTensor(Number(id));
    const per58 = t.length / 6;
    for (const b of [0, 3]) {
      const key = `${b < 3 ? 'dir' : 'env'}.${name}`;
      n58.push({ piece: pc.name, tensor: Number(id), item: b, ref: key, ...diff(t.subarray(b * per58, (b + 1) * per58), await dump(key)) });
    }
  }
  b58.release(); e58.release();

  const pass = vsNumpy.every(ok) && vsCpu.every(ok) && n58.every(ok);
  const report = {
    n58, n58Dispatches: g58.ops.length,
    task: 'N5.7 + N5.8', op: 'init_conv 3x3 8->16 + downs.0.0, downs.0.1 (conv3x3+RMSNorm+SiLU, identity skip, x2)', size: SIZE, precision: F16 ? 'fp16' : 'fp32', batch: 6, setSplit: 3,
    dispatches: graph.ops.length, measure: F16 ? 'relL2' : 'maxAbs', threshold, pass, gpuError, vsNumpy, vsCpu, cpuVsNumpyMaxAbs: cpuVsNumpy,
    adapter: { vendor: adapter.info?.vendor, architecture: adapter.info?.architecture },
  };
  const f = (x: number) => x.toExponential(2);
  status([
    `${SIZE}², ${report.precision}, batch 6 (0-2 dir, 3-5 env), ${report.dispatches} dispatch, ${report.measure} <= ${f(threshold)}: ${pass ? 'PASS' : 'FAIL'}`,
    gpuError ? `GPU error: ${gpuError}` : '',
    '', 'vs NumPy dump (pass 0 of each set)            max abs     mean abs    mean |ref|  rel L2',
    ...vsNumpy.map((r) => `  item ${r.item} ${r.name.padEnd(12)} ${r.ref.padEnd(16)} ${f(r.maxAbs).padStart(10)}  ${f(r.meanAbs).padStart(10)}  ${f(r.meanAbsRef).padStart(10)}  ${f(r.relL2)}`),
    '', 'vs CPU conv3x3 (JS, all six items)             max abs     mean abs    mean |ref|  rel L2',
    ...vsCpu.map((r) => `  item ${r.item} ${r.name.padEnd(29)} ${f(r.maxAbs).padStart(10)}  ${f(r.meanAbs).padStart(10)}  ${f(r.meanAbsRef).padStart(10)}  ${f(r.relL2)}`),
    '', `CPU reference vs NumPy (items 0, 3): ${cpuVsNumpy.map(f).join(', ')}`,
    '', `N5.8 pieces (${g58.ops.length} dispatches, one pass; inputs from dumps)       max abs     mean abs    mean |ref|  rel L2`,
    ...n58.map((r) => `  item ${r.item} ${r.ref.padEnd(26)} ${f(r.maxAbs).padStart(10)}  ${f(r.meanAbs).padStart(10)}  ${f(r.meanAbsRef).padStart(10)}  ${f(r.relL2)}${ok(r) ? '' : '  FAIL'}`),
  ].filter((l, i) => l || i > 1).join('\n'));
  clouds.report = () => report;
  clouds.ready = true;
}
main().catch((e) => { clouds.error = String(e?.stack ?? e); status(String(e?.stack ?? e)); });
