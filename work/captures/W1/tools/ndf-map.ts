// W1 tool (not a lab page): the HZD NDF as maps, read back from the GPU. Served by vite through /@fs/<this dir>/ndf-map.html.
//   ?hzn_<key>=<v>  overrides an NDF setting (numbers or words: hzn_recipe=n17, hzn_image=/clouds/ndf/boss.png)
//   ?label=<text>   a caption
// Panels: (1) one tile in the N17 slide colours (R = G = coverage, B = top type: yellow = coverage, white = coverage + cumulus, blue = type
// without coverage); (2) coverage, 2x2 tiles; (3) where a mean base shape survives the remap (coverage > 0.38), coloured by type, 2x2 tiles;
// (4) max height. Stats: coverage mean, covered fraction, clusters (4-connected, wrapping) and their size spread.
import { installCloudsHarness } from '../../../../examples/lab/harness/clouds-contract';
import { generateHzdNdf, applyHzdNdfImages } from '../../../../packages/runtime/src/procedural/hzd/ndf';
import { HZD_NDF_DEFAULTS, type HzdNdfSettings } from '../../../../packages/runtime/src/procedural/settings';

const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);
const out = document.getElementById('stats')!;

async function readLayers(device: GPUDevice, tex: GPUTexture): Promise<{ a: Uint8Array; b: Uint8Array; n: number }> {
  const n = tex.width, bytesPerRow = Math.ceil((n * 4) / 256) * 256;
  const buffer = device.createBuffer({ size: bytesPerRow * n * 2, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer, bytesPerRow, rowsPerImage: n }, [n, n, 2]);
  device.queue.submit([enc.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const raw = new Uint8Array(buffer.getMappedRange());
  const a = new Uint8Array(n * n * 4), b = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    a.set(raw.subarray(y * bytesPerRow, y * bytesPerRow + n * 4), y * n * 4);
    b.set(raw.subarray((n + y) * bytesPerRow, (n + y) * bytesPerRow + n * 4), y * n * 4);
  }
  buffer.unmap(); buffer.destroy();
  return { a, b, n };
}

function clusters(mask: Uint8Array, n: number) {
  const label = new Int32Array(n * n).fill(-1), sizes: number[] = [];
  const stack: number[] = [];
  for (let i = 0; i < n * n; i++) {
    if (!mask[i] || label[i] >= 0) continue;
    const id = sizes.length; let size = 0; stack.push(i); label[i] = id;
    while (stack.length) {
      const j = stack.pop()!; size++;
      const x = j % n, y = (j / n) | 0;
      for (const k of [y * n + (x + 1) % n, y * n + (x + n - 1) % n, ((y + 1) % n) * n + x, ((y + n - 1) % n) * n + x]) if (mask[k] && label[k] < 0) { label[k] = id; stack.push(k); }
    }
    sizes.push(size);
  }
  return sizes.sort((p, q) => q - p);
}

try {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error('no WebGPU adapter');
  const device = await adapter.requestDevice();
  const s: HzdNdfSettings = { ...HZD_NDF_DEFAULTS };
  const r = s as unknown as Record<string, unknown>;
  for (const [k, v] of query) if (k.startsWith('hzn_') && k.slice(4) in s) r[k.slice(4)] = typeof r[k.slice(4)] === 'number' ? Number(v) : v;
  let ndf = generateHzdNdf(device, s);
  if (s.image || s.heightImage) ndf = await applyHzdNdfImages(device, ndf, s);
  const { a, b, n } = await readLayers(device, ndf.texture);
  const P = 360, G = 12;
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  canvas.width = 4 * P + 3 * G; canvas.height = P + 28;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ddd'; ctx.font = '13px ui-monospace, Menlo, monospace';
  ['coverage | top type (one tile)', 'coverage (2x2 tiles)', 'coverage > 0.38, by type (2x2)', 'max height (one tile)'].forEach((t, i) => ctx.fillText(t, i * (P + G), 14));
  const panel = (i: number, tiles: number, f: (idx: number) => [number, number, number]) => {
    const img = ctx.createImageData(P, P);
    for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
      const tx = Math.floor((x / P) * tiles * n) % n, ty = Math.floor((y / P) * tiles * n) % n;
      const [R, Gc, B] = f(ty * n + tx), o = (y * P + x) * 4;
      img.data[o] = R; img.data[o + 1] = Gc; img.data[o + 2] = B; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, i * (P + G), 24);
  };
  const T = 0.38 * 255;
  panel(0, 1, i => [a[i * 4], a[i * 4], a[i * 4 + 1]]);
  panel(1, 2, i => [a[i * 4], a[i * 4], a[i * 4]]);
  panel(2, 2, i => (a[i * 4] > T ? [255 - a[i * 4 + 1] * 0.6, 200, 120 + a[i * 4 + 1] * 0.53] : [12, 14, 30]));
  panel(3, 1, i => [b[i * 4 + 1], b[i * 4 + 1], b[i * 4 + 1]]);
  const mask = new Uint8Array(n * n); let cov = 0, covered = 0, typ = 0;
  for (let i = 0; i < n * n; i++) { cov += a[i * 4]; typ += a[i * 4 + 1]; if (a[i * 4] > T) { mask[i] = 1; covered++; } }
  const sz = clusters(mask, n), N = n * n;
  const big = sz.filter(x => x >= N * 0.001);
  const sorted = Array.from({ length: N }, (_, i) => a[i * 4]).sort((p, q) => p - q);
  const q = (f: number) => +(sorted[Math.floor(f * (N - 1))] / 255).toFixed(2);
  const stats = {
    p50: q(0.5), p90: q(0.9), p99: q(0.99),
    coverageMean: +(cov / N / 255).toFixed(3), typeMean: +(typ / N / 255).toFixed(3), covered: +(covered / N).toFixed(3),
    clusters: big.length, largestShare: +((sz[0] ?? 0) / Math.max(covered, 1)).toFixed(3),
    medianClusterKm2: big.length ? +((big[Math.floor(big.length / 2)] / N) * (s.tileMeters / 1000) ** 2).toFixed(2) : 0,
  };
  out.textContent = `${query.get('label') ?? ''}  recipe ${s.recipe}${s.image ? ' image ' + s.image : ''}  tile ${s.tileMeters / 1000} km  ${JSON.stringify(stats)}`;
  harness.ready({ report: () => ({ gpuMs: {}, frameMs: { p50: 0 }, stats }) });
  const tick = () => { harness.frame(); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
} catch (e) {
  out.textContent = 'failed: ' + (e instanceof Error ? e.message : String(e));
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
}
