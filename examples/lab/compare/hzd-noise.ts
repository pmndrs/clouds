// H1 debug page: the baked HZD noise set (packages/runtime/src/procedural/hzd/noise.ts) as slices, 2 x 2 tiled to show the seams, with channel
// statistics and an exact-tiling test read back from the GPU. ?fmt=rgba16float bakes the 16-bit variant; ?z=<slice> picks the shape slice.
// The harness report carries the numbers (work/captures/H1/noise/capture.json).
import { installCloudsHarness } from '../harness/clouds-contract';
import { bakeHzdNoise } from '../../../packages/runtime/src/procedural/hzd/noise';

const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);
const out = document.getElementById('stats')!;

function half(h: number): number {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023;
  return e === 0 ? s * 2 ** -14 * (f / 1024) : e === 31 ? (f ? NaN : s * Infinity) : s * 2 ** (e - 15) * (1 + f / 1024);
}
/** Read one mip level of a 2D/3D rgba8unorm or rgba16float texture into Float32 RGBA (x fastest). */
async function readTexture(device: GPUDevice, tex: GPUTexture, mip = 0): Promise<{ data: Float32Array; n: [number, number, number] }> {
  const w = Math.max(1, tex.width >> mip), h = Math.max(1, tex.height >> mip), d = tex.dimension === '3d' ? Math.max(1, tex.depthOrArrayLayers >> mip) : tex.depthOrArrayLayers;
  const bpp = tex.format === 'rgba16float' ? 8 : 4;
  const bytesPerRow = Math.ceil((w * bpp) / 256) * 256;
  const buffer = device.createBuffer({ size: bytesPerRow * h * d, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex, mipLevel: mip }, { buffer, bytesPerRow, rowsPerImage: h }, [w, h, d]);
  device.queue.submit([enc.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const raw = buffer.getMappedRange();
  const u8 = new Uint8Array(raw), dv = new DataView(raw);
  const data = new Float32Array(w * h * d * 4);
  for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) {
    const row = (z * h + y) * bytesPerRow;
    for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
      const i = ((z * h + y) * w + x) * 4 + c;
      data[i] = bpp === 8 ? half(dv.getUint16(row + x * 8 + c * 2, true)) : u8[row + x * 4 + c] / 255;
    }
  }
  buffer.unmap(); buffer.destroy();
  return { data, n: [w, h, d] };
}

interface Stats { mean: number; std: number; min: number; max: number; p1: number; p99: number }
function stats(v: Float32Array, c: number): Stats {
  const a: number[] = [];
  for (let i = c; i < v.length; i += 4) a.push(v[i]);
  a.sort((x, y) => x - y);
  const mean = a.reduce((s, x) => s + x, 0) / a.length;
  const std = Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / a.length);
  const q = (p: number) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
  return { mean, std, min: a[0], max: a[a.length - 1], p1: q(0.01), p99: q(0.99) };
}
/** Exact tiling: the mean |difference| across the wrap seam (index N-1 to 0) over the mean |difference| between interior neighbours, per axis. 1 = seamless. */
function seam(v: Float32Array, n: [number, number, number], c: number): number[] {
  const at = (x: number, y: number, z: number) => v[((z * n[1] + y) * n[0] + x) * 4 + c];
  const ratios: number[] = [];
  for (let axis = 0; axis < (n[2] > 1 ? 3 : 2); axis++) {
    const N = n[axis];
    let wrap = 0, inner = 0, count = 0;
    for (let z = 0; z < n[2]; z++) for (let y = 0; y < n[1]; y++) for (let x = 0; x < n[0]; x++) {
      const p = [x, y, z];
      if (p[axis] !== N - 1) continue;
      const q = [...p]; q[axis] = 0;
      const m = [...p]; m[axis] = N - 2;
      wrap += Math.abs(at(p[0], p[1], p[2]) - at(q[0], q[1], q[2]));
      inner += Math.abs(at(p[0], p[1], p[2]) - at(m[0], m[1], m[2]));
      count++;
    }
    ratios.push(inner > 0 ? wrap / inner : 0);
  }
  return ratios;
}

/** Draw one channel of a z slice, tiled 2 x 2, at `scale` pixels per texel. `signed` maps -1..1 to 0..1. */
function drawSlice(ctx: CanvasRenderingContext2D, x0: number, y0: number, v: Float32Array, n: [number, number, number], z: number, c: number, scale: number, signed = false) {
  const w = n[0] * 2 * scale, h = n[1] * 2 * scale;
  const img = ctx.createImageData(w, h);
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const tx = Math.floor(px / scale) % n[0], ty = Math.floor(py / scale) % n[1];
    let val = v[((z * n[1] + ty) * n[0] + tx) * 4 + c];
    if (signed) val = val * 0.5 + 0.5;
    const g = Math.max(0, Math.min(255, Math.round(val * 255)));
    const i = (py * w + px) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = g; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, x0, y0);
}

try {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error('no WebGPU adapter');
  const device = await adapter.requestDevice();
  const format = query.get('fmt') === 'rgba16float' ? 'rgba16float' : 'rgba8unorm';
  const t0 = performance.now();
  const noise = bakeHzdNoise(device, { format, usage: GPUTextureUsage.COPY_SRC });
  await device.queue.onSubmittedWorkDone();
  const bakeMs = performance.now() - t0;
  const shape = await readTexture(device, noise.shape);
  const shape1 = await readTexture(device, noise.shape, 1);
  const detail = await readTexture(device, noise.detail);
  const curl = await readTexture(device, noise.curl);
  const names = ['R', 'G', 'B', 'A'];
  const report: Record<string, unknown> = { format, bakeMs };
  const lines: string[] = [`HZD noise set (${format}), bake + sync ${bakeMs.toFixed(1)} ms`, ''];
  const block = (label: string, t: { data: Float32Array; n: [number, number, number] }, chans: number, ref?: string[]) => {
    const r: Record<string, unknown> = {};
    lines.push(`${label} ${t.n.join('x')}`);
    for (let c = 0; c < chans; c++) {
      const s = stats(t.data, c), sm = seam(t.data, t.n, c);
      r[names[c]] = { ...s, seam: sm };
      lines.push(`  ${names[c]} mean ${s.mean.toFixed(3)} std ${s.std.toFixed(3)} min ${s.min.toFixed(3)} max ${s.max.toFixed(3)} p1/p99 ${s.p1.toFixed(3)}/${s.p99.toFixed(3)}  seam ${sm.map(x => x.toFixed(2)).join(' ')}${ref?.[c] ? `   tool: ${ref[c]}` : ''}`);
    }
    report[label] = r;
  };
  block('shape', shape, 4, ['mean 0.504 std 0.105 min 0.083 max 0.900 p1/p99 0.252/0.749', 'mean 0.686 std 0.104 min 0.057 max 0.974', 'mean 0.687 std 0.102', 'mean 0.687 std 0.102']);
  block('shape mip1', shape1, 4);
  block('detail', detail, 3);
  block('curl', curl, 3);
  lines.push('', 'seam = mean |v(N-1) - v(0)| / mean |v(N-1) - v(N-2)| per axis (1 = exact tiling)');
  out.textContent = lines.join('\n');

  // Layout: row 1 shape R G B A (z slice, 2x2 tiles at 1 px/texel), row 2 detail R G B (4 px/texel) and curl x y z (1 px/texel).
  const z = Number(query.get('z') ?? 64);
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  canvas.width = 4 * 256 + 3 * 8; canvas.height = 256 * 2 + 8;
  const ctx = canvas.getContext('2d')!;
  for (let c = 0; c < 4; c++) drawSlice(ctx, c * 264, 0, shape.data, shape.n, z, c, 1);
  for (let c = 0; c < 3; c++) drawSlice(ctx, c * 132, 264, detail.data, detail.n, Math.floor(z / 4), c, 2);
  for (let c = 0; c < 3; c++) drawSlice(ctx, 400 + c * 264, 264, curl.data, curl.n, 0, c, 1, true);
  harness.ready({ report: () => ({ gpuMs: { bake: bakeMs }, frameMs: { p50: 0 }, renderSize: [canvas.width, canvas.height], noise: report }) });
  const tick = () => { harness.frame(); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
} catch (e) {
  out.textContent = 'failed: ' + (e instanceof Error ? e.message : String(e));
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
}
