// N5.10: the whole HaloRT network on our engine (experiments/neural/engine/), end to end.
// haloNetGraph() (init_conv -> 7 down stages -> mid -> 7 up stages -> final) for a batch of 6 (items 0-2 `dir`
// passes 0-2 with halo_dir.tza, 3-5 `env` passes 0-2 with halo_env.tza), all ops in one compute pass and one
// submit; then the blend on the CPU (halonet_ref.py `compose`):
//   img[k] = (dir_k * li[k] + es[k] * env_k) * S + B[k] * es[k] * (1 - S),  S = cond[13], B = cond[14:17]
// compared with the authors' ORT-wasm output `out_wasm_<size>.f32` ([1,3,S,S], rdv pixel order like cond) and
// the six per-pass outputs with the NumPy dumps dumps/<size>/{dir,env}.pass{0,1,2}.
// Query: ?size=256|512, ?precision=fp32|fp16|both (default both: fp32 first, fp16 after, same tonemap),
// ?bisect=1 keeps every tapped tensor and compares items 0 / 3 with dumps/<size>-all (256 only),
// ?timing=0 skips the timing (median of 20 runs after 5 warm-ups, encode -> onSubmittedWorkDone).
// Report: window.__clouds.report(); the sheet as JPEG data URL: window.__clouds.sheetJpeg().
import { Engine } from '../../../experiments/neural/engine/runtime';
import { HALO_GATHER_B6, haloNetGraph } from '../../../experiments/neural/engine/graph';
import { parseTZA } from '../../../experiments/neural/engine/tza';

declare const __REPO_ROOT__: string;
const q = new URLSearchParams(location.search);
const SIZE = Number(q.get('size') ?? 256);
const PREC = q.get('precision') ?? 'both';
const BISECT = q.get('bisect') === '1';
const TIMING = q.get('timing') !== '0';
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
const fetchF32 = async (file: string) => new Float32Array(await fetchBuf(file));

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

/** halonet_ref.py `compose`: out [6][1][S][S] (items 0-2 dir, 3-5 env) -> [3][S][S]. */
function blend(out: Float32Array, cond: Float32Array, li: Float32Array, es: Float32Array, S: number): Float32Array {
  const plane = S * S, img = new Float32Array(3 * plane);
  for (let k = 0; k < 3; k++) for (let i = 0; i < plane; i++) {
    const s = cond[13 * plane + i], bg = cond[(14 + k) * plane + i];
    const dir = out[k * plane + i], env = out[(3 + k) * plane + i];
    img[k * plane + i] = (dir * li[k] + es[k] * env) * s + bg * es[k] * (1 - s);
  }
  return img;
}

/** Fixture preview tonemap (neural-fixture page): v * 2^EV, 1 - exp(-v), gamma 2.2, turned back 180 degrees. */
function toCanvas(img: Float32Array, S: number, mode: 'tone' | 'diff100', ref?: Float32Array, ev = 1): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!, id = ctx.createImageData(S, S), plane = S * S;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const rdv = (S - 1 - y) * S + (S - 1 - x), o = (y * S + x) * 4;
    for (let k = 0; k < 3; k++) {
      const v = img[rdv + k * plane];
      // diff100: |ours - ref| x 100, linear radiance, 1.0 -> white (no tonemap)
      const u = mode === 'tone' ? Math.pow(Math.min(1, 1 - Math.exp(-Math.max(0, v) * Math.pow(2, ev))), 1 / 2.2) : Math.min(1, Math.abs(v - ref![rdv + k * plane]) * 100);
      id.data[o + k] = Math.round(255 * u);
    }
    id.data[o + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

interface PrecisionResult {
  precision: string; ops: number; dispatches: number; slots?: number;
  endToEnd: ReturnType<typeof diff>; perPass: ({ pass: string } & ReturnType<typeof diff>)[];
  bisect?: ({ tap: string; item: number } & ReturnType<typeof diff>)[];
  timing?: { medianMs: number; minMs: number; maxMs: number; runs: number; warmups: number };
  gpuError?: string;
}

async function main() {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('no WebGPU adapter');
  const hasF16 = adapter.features.has('shader-f16');
  const device = await adapter.requestDevice({
    requiredFeatures: hasF16 ? ['shader-f16'] : [],
    requiredLimits: { maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize },
  });
  let gpuError: string | undefined;
  device.addEventListener('uncapturederror', (e) => { gpuError = (e as GPUUncapturedErrorEvent).error.message; });

  status('loading weights and fixture');
  const fx = 'neural/fixture';
  const [dirBuf, envBuf, cond, li, es, wasm, idxBuf] = await Promise.all([
    fetchBuf('neural/weights/halo_dir.tza'), fetchBuf('neural/weights/halo_env.tza'),
    fetchF32(`${fx}/cond_${SIZE}.f32`), fetchF32(`${fx}/light_intensity_${SIZE}.f32`), fetchF32(`${fx}/environment_scale_${SIZE}.f32`),
    fetchF32(`${fx}/out_wasm_${SIZE}.f32`), fetchBuf(`${fx}/dumps/${SIZE}/index.json`),
  ]);
  const Wd = parseTZA(dirBuf), We = parseTZA(envBuf);
  const index = JSON.parse(new TextDecoder().decode(idxBuf)) as Record<string, { file: string }>;
  const passNames = ['dir.pass0', 'dir.pass1', 'dir.pass2', 'env.pass0', 'env.pass1', 'env.pass2'];
  const passRefs = await Promise.all(passNames.map((n) => (index[n] ? fetchF32(`${fx}/dumps/${SIZE}/${index[n].file}`) : Promise.resolve(undefined))));
  const blendedRef = index.blended ? await fetchF32(`${fx}/dumps/${SIZE}/${index.blended.file}`) : undefined;
  let allIndex: Record<string, { file: string }> | undefined;
  if (BISECT) allIndex = JSON.parse(new TextDecoder().decode(await fetchBuf(`${fx}/dumps/${SIZE}-all/index.json`)));

  const input = device.createBuffer({ size: cond.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, label: 'cond' });
  device.queue.writeBuffer(input, 0, cond);
  const { graph, output, taps } = haloNetGraph(HALO_GATHER_B6);
  const plane = SIZE * SIZE;
  const images: Record<string, Float32Array> = {};
  const results: PrecisionResult[] = [];
  const precisions = PREC === 'both' ? (hasF16 ? ['fp32', 'fp16'] : ['fp32']) : [PREC];

  for (const prec of precisions) {
    status(`${prec}: building engine (${graph.ops.length} ops)`);
    gpuError = undefined;
    const keep = BISECT ? Object.values(taps) : [output];
    const engine = await Engine.create(device, graph, [Wd, We], { f16: prec === 'fp16', batch: 6, setSplit: 3, keep });
    const binding = engine.bind(SIZE, input);
    binding.run();
    const out = await binding.readTensor(output);
    const img = blend(out, cond, li, es, SIZE);
    images[prec] = img;
    const perPass = passNames.flatMap((n, b) => (passRefs[b] ? [{ pass: n, ...diff(out.subarray(b * plane, (b + 1) * plane), passRefs[b]!) }] : []));
    const r: PrecisionResult = { precision: prec, ops: graph.ops.length, dispatches: engine.dispatches, endToEnd: diff(img, wasm), perPass };
    if (blendedRef) (r as unknown as Record<string, unknown>).vsNumpyBlended = diff(img, blendedRef);
    if (BISECT && allIndex) {
      r.bisect = [];
      for (const [tap, id] of Object.entries(taps)) for (const b of [0, 3]) {
        const key = `${b < 3 ? 'dir' : 'env'}.${tap}`;
        if (!allIndex[key]) continue;
        const t = await binding.readTensor(id);
        const per = t.length / 6;
        r.bisect.push({ tap: key, item: b, ...diff(t.subarray(b * per, (b + 1) * per), await fetchF32(`${fx}/dumps/${SIZE}-all/${allIndex[key].file}`)) });
      }
    }
    if (TIMING) {
      status(`${prec}: timing`);
      const times: number[] = [];
      for (let i = 0; i < 25; i++) {
        const t0 = performance.now();
        binding.run();
        await device.queue.onSubmittedWorkDone();
        if (i >= 5) times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      r.timing = { medianMs: (times[9] + times[10]) / 2, minMs: times[0], maxMs: times[times.length - 1], runs: times.length, warmups: 5 };
    }
    r.gpuError = gpuError;
    results.push(r);
    binding.release();
    engine.release();
  }

  // Sheet: ours fp32 | authors' wasm | x100 |ours fp32 - wasm| | ours fp16 | x100 |ours fp16 - wasm|, 384 px panels (1920 wide)
  const panels: [string, HTMLCanvasElement][] = [];
  if (images.fp32) panels.push(['ours fp32', toCanvas(images.fp32, SIZE, 'tone')]);
  panels.push(['authors (ORT wasm)', toCanvas(wasm, SIZE, 'tone')]);
  if (images.fp32) panels.push(['x100 |fp32 - wasm|', toCanvas(images.fp32, SIZE, 'diff100', wasm)]);
  if (images.fp16) panels.push(['ours fp16', toCanvas(images.fp16, SIZE, 'tone')]);
  if (images.fp16) panels.push(['x100 |fp16 - wasm|', toCanvas(images.fp16, SIZE, 'diff100', wasm)]);
  const P = Math.min(384, Math.floor(1920 / panels.length)), LH = 22;
  const sheet = document.getElementById('sheet') as HTMLCanvasElement;
  sheet.width = P * panels.length; sheet.height = P + LH;
  const sctx = sheet.getContext('2d')!;
  sctx.fillStyle = '#000'; sctx.fillRect(0, 0, sheet.width, sheet.height);
  sctx.imageSmoothingQuality = 'high';
  panels.forEach(([label, c], i) => {
    sctx.drawImage(c, i * P, LH, P, P);
    sctx.fillStyle = '#ddd'; sctx.font = '13px system-ui'; sctx.fillText(`${label} (${SIZE}²)`, i * P + 6, 15);
  });
  clouds.sheetJpeg = () => sheet.toDataURL('image/jpeg', 0.92);

  const f = (x: number) => x.toExponential(2);
  const fp32 = results.find((r) => r.precision === 'fp32');
  const pass = !!fp32 && !fp32.endToEnd.nonFinite && fp32.endToEnd.maxAbs <= 1e-3 && !fp32.gpuError;
  const report = {
    task: 'N5.10', size: SIZE, batch: 6, setSplit: 3, check: 'fp32 end-to-end max abs <= 1e-3 vs out_wasm', pass, results,
    adapter: { vendor: adapter.info?.vendor, architecture: adapter.info?.architecture },
  };
  status([
    `${SIZE}², batch 6 (0-2 dir, 3-5 env), ${graph.ops.length} ops, ${results[0]?.dispatches} dispatches, one pass, one submit — fp32 check: ${pass ? 'PASS' : 'FAIL'}`,
    ...results.flatMap((r) => [
      '', `${r.precision}${r.gpuError ? `  GPU error: ${r.gpuError}` : ''}`,
      `  end to end vs out_wasm   max abs ${f(r.endToEnd.maxAbs)}  mean abs ${f(r.endToEnd.meanAbs)}  mean |ref| ${f(r.endToEnd.meanAbsRef)}  rel L2 ${f(r.endToEnd.relL2)}${r.endToEnd.nonFinite ? `  non-finite ${r.endToEnd.nonFinite}` : ''}`,
      ...r.perPass.map((p) => `  ${p.pass.padEnd(10)} vs NumPy  max abs ${f(p.maxAbs)}  mean abs ${f(p.meanAbs)}  rel L2 ${f(p.relL2)}`),
      r.timing ? `  timing: median ${r.timing.medianMs.toFixed(2)} ms (min ${r.timing.minMs.toFixed(2)}, max ${r.timing.maxMs.toFixed(2)}), ${r.timing.runs} runs after ${r.timing.warmups} warm-ups` : '',
      ...(r.bisect ?? []).map((b) => `  bisect ${b.tap.padEnd(28)} max abs ${f(b.maxAbs)}  rel L2 ${f(b.relL2)}`),
    ]),
  ].join('\n'));
  clouds.report = () => report;
  clouds.ready = true;
}
main().catch((e) => { clouds.error = String(e?.stack ?? e); status(String(e?.stack ?? e)); });
