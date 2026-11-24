// N5.4: fixed test case for the neural engine. Produces, at 256 and 512: the packed `condition` input (float32 [1,17,S,S], exactly the bytes
// given to the model), light_intensity, environment_scale, and the authors' network output from ORT Web on the WebGPU EP (fp32 model) and on the
// wasm (CPU) EP (the reference). Driven by scripts/neural/make-fixture.mjs through window.__fx; nothing is drawn.
// Fixed: camera yaw 0.6 pitch 0.15 dist 3.2 fov 40, sun az 120 el 30, g 0.3, 8 env samples, step 0.004, density scale 200 x densityRef,
// sun 2 EV, sky 0 EV, feature-pass `frame` seed 0 (the PCG hash seed, so the env samples are the same on every run).
import { loadDenseVdb, vdbLimits } from '../neural/density';
import { FeaturePass, type FeatureCamera } from '../../../experiments/neural/feature-pass';
import { HaloNet, ortDeviceRequest } from '../../../experiments/neural/halort-net';

declare const __REPO_ROOT__: string;
const ORT_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.webgpu.min.mjs';
const SUN_RGB = [0.4418720602989197, 0.42135560512542725, 0.3813745379447937];
const SETTINGS = { yaw: 0.6, pitch: 0.15, distance: 3.2, fovDeg: 40, sunAz: 120, sunEl: 30, g: 0.3, envSamples: 8, stepSize: 0.004, sunEV: 2, skyEV: 0, frameSeed: 0, vdb: 'disney-cloud/wdas_cloud_eighth.vdb' };
const status = (s: string) => { document.getElementById('s')!.textContent = s; };

const CANDIDATES = [`${__REPO_ROOT__}artifacts/research/`, `${__REPO_ROOT__}../../../artifacts/research/`];
async function researchUrl(file: string): Promise<string> {
  for (const base of CANDIDATES) {
    try { const r = await fetch(`/@fs${base}disney-cloud/README.txt`, { method: 'HEAD' }); if (r.ok && !(r.headers.get('content-type') ?? '').includes('html')) return `/@fs${base}${file}`; } catch { /* next */ }
  }
  throw new Error('artifacts/research not found');
}
const camera = (): FeatureCamera => {
  const o = SETTINGS, cp = Math.cos(o.pitch);
  const pos: [number, number, number] = [Math.sin(o.yaw) * cp * o.distance, Math.sin(o.pitch) * o.distance, Math.cos(o.yaw) * cp * o.distance];
  const len = Math.hypot(...pos);
  const fwd: [number, number, number] = [-pos[0] / len, -pos[1] / len, -pos[2] / len];
  const rl = Math.hypot(fwd[2], fwd[0]);
  const right: [number, number, number] = [-fwd[2] / rl, 0, fwd[0] / rl];
  const up: [number, number, number] = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
  return { position: pos, forward: fwd, right, up, fovY: (o.fovDeg * Math.PI) / 180 };
};
async function readBuffer(device: GPUDevice, src: GPUBuffer, bytes: number): Promise<Float32Array> {
  const staging = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyBufferToBuffer(src, 0, staging, 0, bytes);
  device.queue.submit([enc.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const out = new Float32Array(staging.getMappedRange().slice(0));
  staging.destroy();
  return out;
}
const same = (a: Float32Array, b: Float32Array) => { for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false; return true; };
function diff(a: Float32Array, b: Float32Array) {
  let max = 0, sum = 0, n = 0, nan = 0, ref = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (!Number.isFinite(d)) { nan++; continue; } max = Math.max(max, d); sum += d; ref += Math.abs(b[i]); n++; }
  return { maxAbs: max, meanAbs: sum / n, meanAbsRef: ref / n, nonFinite: nan };
}

const store: Record<string, Float32Array> = {};
const results: Record<string, unknown> = {};

async function main() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error('no WebGPU adapter');
  const req = ortDeviceRequest(adapter);
  const limits: Record<string, number> = { ...req.requiredLimits };
  for (const [k, v] of Object.entries(vdbLimits(adapter))) limits[k] = k.startsWith('min') ? Math.min(limits[k] ?? v, v) : Math.max(limits[k] ?? v, v);
  const device = await adapter.requestDevice({ requiredFeatures: req.requiredFeatures, requiredLimits: limits });
  device.addEventListener('uncapturederror', e => { results.gpuError = (e as GPUUncapturedErrorEvent).error.message; });
  status('loading cloud');
  const res = await fetch(await researchUrl(SETTINGS.vdb));
  const dense = await loadDenseVdb(device, SETTINGS.vdb.split('/').pop()!, await res.arrayBuffer());
  const [nx, nRow, nUp] = dense.dims, longest = Math.max(nx, nRow, nUp);
  const boxHalf: [number, number, number] = [nx / longest, nUp / longest, nRow / longest];
  const densityScale = Math.round(200 * dense.densityRef);
  const az = (SETTINGS.sunAz * Math.PI) / 180, el = (SETTINGS.sunEl * Math.PI) / 180;
  const sunDirection: [number, number, number] = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
  const ort = await import(/* @vite-ignore */ ORT_URL) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  results.ortVersion = ort.env.versions?.common ?? '1.30.0 (CDN)';
  results.crossOriginIsolated = crossOriginIsolated;

  const fx = {
    settings: { ...SETTINGS, densityScale, densityRef: dense.densityRef },
    async run(size: number, wasmRuns: number) {
      const t = (label: string) => { status(`${size}: ${label}`); };
      const base = `neural/rdv_on_the_web/halort/halort_${size}.onnx`;
      const modelUrl = await researchUrl(base);
      const model = await (await fetch(modelUrl)).arrayBuffer();
      const out: Record<string, unknown> = { size, model: { file: `halort_${size}.onnx`, bytes: model.byteLength } };
      // Features twice (new FeaturePass each time): is the packed input reproducible?
      const pack = async () => {
        const pass = new FeaturePass(device, size, size);
        const enc = device.createCommandEncoder();
        pass.encode(enc, { density: dense.texture, boxHalf, camera: camera(), densityScale, stepSize: SETTINGS.stepSize, g: SETTINGS.g, envSamples: SETTINGS.envSamples, sunDirection, frame: SETTINGS.frameSeed });
        device.queue.submit([enc.finish()]);
        return { pass, data: await readBuffer(device, pass.packed, pass.packed.size) };
      };
      t('features');
      const a = await pack(), b = await pack();
      out.conditionRerunIdentical = same(a.data, b.data);
      const cond = a.data;
      const light = Float32Array.from(SUN_RGB.map(x => x * Math.pow(2, SETTINGS.sunEV)));
      const env = Float32Array.from(a.pass.envScale.map((x: number) => x * Math.pow(2, SETTINGS.skyEV)));
      store[`cond_${size}`] = cond; store[`light_${size}`] = light; store[`env_${size}`] = env;
      out.conditionFinite = cond.every(Number.isFinite);
      // WebGPU EP, as the lab page runs it.
      t('webgpu');
      const net = await HaloNet.create(device, size, modelUrl, navigator.gpu.getPreferredCanvasFormat());
      const tw = performance.now();
      await net.run(a.pass.packed, Array.from(light), Array.from(env));
      out.webgpuMs = Math.round(performance.now() - tw);
      const wg = await readBuffer(device, net.output, 3 * size * size * 4);
      await net.run(a.pass.packed, Array.from(light), Array.from(env));
      out.webgpuRerunIdentical = same(wg, await readBuffer(device, net.output, 3 * size * size * 4));
      store[`out_webgpu_${size}`] = wg;
      // wasm (CPU) EP: the reference.
      t('wasm session');
      const sess = await ort.InferenceSession.create(modelUrl, { executionProviders: ['wasm'] });
      out.inputNames = sess.inputNames; out.outputNames = sess.outputNames;
      const feeds = { condition: new ort.Tensor('float32', cond, [1, 17, size, size]), light_intensity: new ort.Tensor('float32', light, [3]), environment_scale: new ort.Tensor('float32', env, [3]) };
      const runs: Float32Array[] = [];
      const wasmMs: number[] = [];
      for (let i = 0; i < wasmRuns; i++) {
        t(`wasm run ${i + 1}/${wasmRuns}`);
        const t0 = performance.now();
        const r = await sess.run(feeds);
        wasmMs.push(Math.round(performance.now() - t0));
        const o = r[sess.outputNames[0]];
        out.outputDims = o.dims;
        runs.push(new Float32Array(o.data as Float32Array));
      }
      out.wasmMs = wasmMs;
      out.wasmRerunIdentical = runs.length > 1 ? same(runs[0], runs[1]) : null;
      store[`out_wasm_${size}`] = runs[0];
      out.webgpuVsWasm = diff(wg, runs[0]);
      out.outputFinite = runs[0].every(Number.isFinite);
      await sess.release();
      results[String(size)] = out;
      status(`${size} done`);
      return out;
    },
    meta: () => ({ ...results }),
    byteLength: (name: string) => store[name].byteLength,
    chunk(name: string, off: number, len: number) {
      const u8 = new Uint8Array(store[name].buffer, off, Math.min(len, store[name].byteLength - off));
      let bin = ''; for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
      return btoa(bin);
    },
    names: () => Object.keys(store),
    /** Tonemapped preview (as the lab page: v * 2^EV, 1 - exp(-v), gamma 2.2, turned back 180 degrees) as a JPEG data URL at 2x. */
    previewJpeg(name: string, size: number, ev = 1) {
      const a = store[name], plane = size * size, c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d')!, img = ctx.createImageData(size, size);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const rdv = (size - 1 - y) * size + (size - 1 - x), o = (y * size + x) * 4;
        for (let k = 0; k < 3; k++) { const v = Math.max(0, a[rdv + k * plane]) * Math.pow(2, ev); img.data[o + k] = Math.round(255 * Math.pow(Math.min(1, 1 - Math.exp(-v)), 1 / 2.2)); }
        img.data[o + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      const big = document.createElement('canvas'); big.width = big.height = Math.min(1024, size * 2);
      const bctx = big.getContext('2d')!; bctx.imageSmoothingEnabled = false; bctx.drawImage(c, 0, 0, big.width, big.height);
      return big.toDataURL('image/jpeg', 0.9);
    },
  };
  (window as unknown as Record<string, unknown>).__fx = fx;
  status('ready');
}
main().catch(e => { (window as unknown as Record<string, unknown>).__fxError = String(e?.stack ?? e); status(String(e)); });
