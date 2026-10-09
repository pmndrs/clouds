// P3-A: GPU Nubis voxel-field generator test. Generates 256x256x32 from a procedural weather map, compares the SDF with a
// CPU exact EDT, times full generation (256^2 x 32 and 512^2 x 64, plus per-job cost), and draws profile / SDF slices.
// P9-B2: the SDF checks test the invariants (never overshoots; undershoot within the 1/64-voxel quantization plus the f16 shrink, which scales
// with the distance; two windows agree wherever the nearest surface is inside both), and the tiled weather bake (createWeatherBake) is checked
// against the one-shot map and timed per tile.
import { installCloudsHarness } from '../../harness/clouds-contract';
import { CLOUD_PRESETS, createVolumeGenerator, encodeProceduralWeatherMap, signedDistanceCpu, type CloudPresetName, type VolumeGenerator } from '../../../../packages/runtime/src/generate';
import { fromHalfBits } from '../../../../packages/runtime/src/half';
import { createWeatherBake, type ProceduralWeatherOptions } from '../../../../packages/runtime/src/generate/weather';

const harness = installCloudsHarness();
// Surface the stack, not just the message (the harness keeps only e.message, which is empty for non-Error throws).
window.addEventListener('error', e => { (window.__clouds as Record<string, unknown>).error = `${e.message} ${(e.error as Error | undefined)?.stack ?? String(e.error)}`; });
const out = document.getElementById('out')!;
const lines: string[] = [];
const log = (s: string) => { lines.push(s); out.textContent = lines.join('\n'); if (s.startsWith('FAIL')) console.warn(s); };
const failures: string[] = [];
const check = (ok: boolean, msg: string) => { log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failures.push(msg); };

const adapter = await navigator.gpu?.requestAdapter();
if (!adapter) { harness.fail('WebGPU adapter unavailable'); throw new Error('no adapter'); }
const hasTs = adapter.features.has('timestamp-query');
const device = await adapter.requestDevice({
  requiredFeatures: hasTs ? ['timestamp-query'] : [],
  requiredLimits: { maxBufferSize: Math.min(adapter.limits.maxBufferSize, 1 << 30), maxStorageBufferBindingSize: Math.min(adapter.limits.maxStorageBufferBindingSize, 1 << 30) },
});
device.addEventListener('uncapturederror', e => { harness.fail((e as GPUUncapturedErrorEvent).error.message); });

type Dims = [number, number, number];
const VOXEL = 8;

// ---------- timestamps: one pair per pass, summed by stage ----------
class PassTimes {
  private qs: GPUQuerySet; private resolve: GPUBuffer; private read: GPUBuffer; private labels: string[] = [];
  constructor(private cap = 1024) {
    this.qs = device.createQuerySet({ type: 'timestamp', count: cap * 2 });
    this.resolve = device.createBuffer({ size: cap * 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    this.read = device.createBuffer({ size: cap * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  }
  writes = (label: string): GPUComputePassTimestampWrites | undefined => {
    if (!hasTs || this.labels.length >= this.cap) return undefined;
    const i = this.labels.length; this.labels.push(label);
    return { querySet: this.qs, beginningOfPassWriteIndex: i * 2, endOfPassWriteIndex: i * 2 + 1 };
  };
  finish(encoder: GPUCommandEncoder) {
    if (!this.labels.length) return;
    encoder.resolveQuerySet(this.qs, 0, this.labels.length * 2, this.resolve, 0);
    encoder.copyBufferToBuffer(this.resolve, 0, this.read, 0, this.labels.length * 16);
  }
  async collect() {
    const n = this.labels.length;
    const byLabel: Record<string, { sum: number; max: number; count: number }> = {};
    let total = 0;
    if (n) {
      await this.read.mapAsync(GPUMapMode.READ, 0, n * 16);
      const t = new BigUint64Array(this.read.getMappedRange(0, n * 16).slice(0));
      this.read.unmap();
      this.labels.forEach((l, i) => {
        const ms = Number(t[i * 2 + 1] - t[i * 2]) / 1e6;
        const e = byLabel[l] ??= { sum: 0, max: 0, count: 0 };
        e.sum += ms; e.max = Math.max(e.max, ms); e.count++; total += ms;
      });
    }
    this.qs.destroy(); this.resolve.destroy(); this.read.destroy();
    return { total, byLabel, passes: n };
  }
}

// ---------- helpers ----------
async function readTexture(tex: GPUTexture, bytesPerTexel: number): Promise<ArrayBuffer> {
  const w = tex.width, h = tex.height, d = tex.depthOrArrayLayers;
  const bpr = w * bytesPerTexel;
  if (bpr % 256) throw new Error('row bytes must be a multiple of 256 for readback');
  const buffer = device.createBuffer({ size: bpr * h * d, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex }, { buffer, bytesPerRow: bpr, rowsPerImage: h }, { width: w, height: h, depthOrArrayLayers: d });
  device.queue.submit([enc.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const copy = buffer.getMappedRange().slice(0);
  buffer.unmap(); buffer.destroy();
  return copy;
}

interface Built { gen: VolumeGenerator; weather: GPUTexture; times: PassTimes; wallMs: number }
async function build(dims: Dims, opts: { margin?: number; sliceDepth?: number; seed?: number; preset?: CloudPresetName } = {}): Promise<Built> {
  const preset = opts.preset ? CLOUD_PRESETS[opts.preset] : undefined;
  const times = new PassTimes();
  const enc = device.createCommandEncoder();
  const weather = encodeProceduralWeatherMap(device, enc, { ...preset?.weather, size: [dims[0], dims[1]], seed: opts.seed ?? 3 });
  device.queue.submit([enc.finish()]);
  const gen = createVolumeGenerator(device, { dims, voxelSize: VOXEL, weather, params: preset?.params, marginVoxels: opts.margin, sliceDepth: opts.sliceDepth, timestamps: times.writes });
  await device.queue.onSubmittedWorkDone();
  const t0 = performance.now();
  const e2 = device.createCommandEncoder();
  gen.generate(e2);
  times.finish(e2);
  device.queue.submit([e2.finish()]);
  await device.queue.onSubmittedWorkDone();
  return { gen, weather, times, wallMs: performance.now() - t0 };
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const pct = (a: number[], q: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };

/**
 * Undershoot the stored SDF may have at true distance |d| (metres): each of the three separable EDT passes floors its distance to 1/64 voxel
 * (shaders.ts edtLine; the next pass builds on the floored value, which lowers its result by at most the same amount), and the f16 store shrinks |d|
 * by one ulp (2^-10 relative, shaders.ts SDF) before rounding to nearest (another 2^-11). The f16 part grows with the distance, so a clustered
 * field with large empty spaces needs more than a fixed bound (P9-B: 0.81 m at about 800 m failed the old fixed 0.64 m).
 */
const undershootAllowance = (d: number) => (3 * VOXEL) / 64 + Math.abs(d) * (1 / 1024 + 1 / 2048) + 1e-3;
interface Stats { n: number; maxOvershoot: number; maxUndershoot: number; medianAbs: number; p99Abs: number; signFlips: number; worstUnderRatio: number; worstUnderAt: number; underViolations: number }
function stats(idx: ArrayLike<number>, gpu: Float32Array, cpu: Float32Array): Stats {
  const err: number[] = [];
  let over = -Infinity, under = 0, flips = 0, ratio = 0, ratioAt = 0, viol = 0;
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k];
    const e = Math.abs(gpu[i]) - Math.abs(cpu[i]); // > 0 means the GPU claims a larger distance than the truth
    err.push(Math.abs(e));
    over = Math.max(over, e); under = Math.min(under, e);
    if (gpu[i] * cpu[i] < 0) flips++;
    if (e < 0) { const r = -e / undershootAllowance(cpu[i]); if (r > ratio) { ratio = r; ratioAt = Math.abs(cpu[i]); } if (r > 1) viol++; }
  }
  return { n: idx.length, maxOvershoot: over, maxUndershoot: under, medianAbs: median(err), p99Abs: pct(err, 0.99), signFlips: flips, worstUnderRatio: ratio, worstUnderAt: ratioAt, underViolations: viol };
}
const fmt = (s: Stats) => `n=${s.n} maxOver=${s.maxOvershoot.toFixed(3)}m maxUnder=${s.maxUndershoot.toFixed(2)}m medianAbs=${s.medianAbs.toFixed(3)}m p99Abs=${s.p99Abs.toFixed(2)}m signFlips=${s.signFlips} worst undershoot/allowance ${s.worstUnderRatio.toFixed(2)} at |d|=${s.worstUnderAt.toFixed(0)}m`;

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// ---------- 1. correctness: 256x256x32 ----------
const DIMS: Dims = [256, 256, 32];
const N = DIMS[0] * DIMS[1] * DIMS[2];
log(`GPU timestamp-query: ${hasTs}`);
const main = await build(DIMS);
const raw = await build(DIMS, { margin: 0 });
const nvdf = new Uint8Array(await readTexture(main.gen.volume.nvdf, 4));
const halfs = new Uint16Array(await readTexture(main.gen.volume.sdf, 2));
const gpuSdf = new Float32Array(N); for (let i = 0; i < N; i++) gpuSdf[i] = fromHalfBits(halfs[i]);
const rawSdf = new Float32Array(N); { const hh = new Uint16Array(await readTexture(raw.gen.volume.sdf, 2)); for (let i = 0; i < N; i++) rawSdf[i] = fromHalfBits(hh[i]); }
const mask = new Uint8Array(N); let occupied = 0;
for (let i = 0; i < N; i++) { mask[i] = nvdf[i * 4] > 0 ? 1 : 0; occupied += mask[i]; }
const cpuSdf = signedDistanceCpu(mask, DIMS, VOXEL);
log(`256x256x32 occupied voxels ${occupied} (${(100 * occupied / N).toFixed(2)}%)`);
check(occupied > 0.01 * N && occupied < 0.6 * N, 'weather map yields a plausible cloud fraction');
// NVDF channel sanity
{
  let maxP = 0, gMin = 255, gMax = 0, bMin = 255, wrongOutside = 0;
  for (let i = 0; i < N; i++) {
    if (mask[i]) { maxP = Math.max(maxP, nvdf[i * 4]); gMin = Math.min(gMin, nvdf[i * 4 + 1]); gMax = Math.max(gMax, nvdf[i * 4 + 1]); bMin = Math.min(bMin, nvdf[i * 4 + 2]); }
    else if (nvdf[i * 4 + 1] !== 255 || nvdf[i * 4 + 2] !== 255) wrongOutside++;
  }
  log(`NVDF: max profile ${maxP}/255, detail type ${gMin}..${gMax}, min density scale ${bMin}, outside G/B != 255: ${wrongOutside}`);
  check(maxP > 200 && gMax - gMin > 60 && wrongOutside === 0, 'NVDF channels span their ranges (profile peaks, wispy to billowy, outside G=B=1)');
}
const all = new Uint32Array(N); for (let i = 0; i < N; i++) all[i] = i;
const rand = rng(42);
const nearSurface: number[] = [];
for (let i = 0; i < N; i++) if (Math.abs(cpuSdf[i]) < 6 * VOXEL) nearSurface.push(i);
const samples = new Uint32Array(2000);
for (let k = 0; k < samples.length; k++) samples[k] = k % 2 ? nearSurface[Math.floor(rand() * nearSurface.length)] : Math.floor(rand() * N);
const sRaw = stats(samples, rawSdf, cpuSdf), sCons = stats(samples, gpuSdf, cpuSdf);
const fRaw = stats(all, rawSdf, cpuSdf), fCons = stats(all, gpuSdf, cpuSdf);
log(`raw EDT (margin 0), 2000 samples: ${fmt(sRaw)}`);
log(`raw EDT (margin 0), all voxels:   ${fmt(fRaw)}`);
log(`conservative (margin 1), 2000 samples: ${fmt(sCons)}`);
log(`conservative (margin 1), all voxels:   ${fmt(fCons)}`);
check(samples.length >= 1000, `>= 1000 samples compared (${samples.length})`);
check(sRaw.maxOvershoot <= 1e-3, `raw exact EDT (margin 0) never overshoots the CPU EDT on samples (${sRaw.maxOvershoot.toExponential(2)} m, voxel ${VOXEL} m)`);
check(fRaw.maxOvershoot <= 1e-3, `raw exact EDT (margin 0) never overshoots the CPU EDT over all voxels (${fRaw.maxOvershoot.toExponential(2)} m)`);
check(fRaw.underViolations === 0, `raw exact EDT (margin 0) undershoot stays within the three 1/64-voxel floors plus the f16 shrink at each voxel's distance (worst ${fRaw.worstUnderRatio.toFixed(2)} of the allowance at ${fRaw.worstUnderAt.toFixed(0)} m; max ${fRaw.maxUndershoot.toFixed(3)} m)`);
check(sCons.maxOvershoot <= 1e-3 && fCons.maxOvershoot <= 1e-3, `conservative field never overshoots exact EDT (max ${fCons.maxOvershoot.toExponential(2)} m)`);
check(sCons.signFlips === 0 && fCons.signFlips === 0, 'conservative field has no sign flips');
check(Math.abs(fCons.maxUndershoot) <= 4 * VOXEL, `conservative undershoot bounded (${fCons.maxUndershoot.toFixed(2)} m)`);
const vol = main.gen.volume;
check(vol.dims.join() === DIMS.join() && vol.extentMeters.join() === [DIMS[0] * VOXEL, DIMS[2] * VOXEL, DIMS[1] * VOXEL].join(), 'GpuCloudVolume shape: dims (x,row,up), extent (x,up,z)');

// ---------- 1b. the same conservativeness check on every weather preset (billow-eroded surfaces) ----------
const presetStats: Record<string, { occupiedPct: number; maxOvershoot: number; maxUndershoot: number; signFlips: number }> = {};
for (const name of Object.keys(CLOUD_PRESETS) as CloudPresetName[]) {
  const b = await build(DIMS, { preset: name, seed: 7 });
  const nv = new Uint8Array(await readTexture(b.gen.volume.nvdf, 4));
  const hs = new Uint16Array(await readTexture(b.gen.volume.sdf, 2));
  const g = new Float32Array(N); for (let i = 0; i < N; i++) g[i] = fromHalfBits(hs[i]);
  const m = new Uint8Array(N); let occ = 0; for (let i = 0; i < N; i++) { m[i] = nv[i * 4] > 0 ? 1 : 0; occ += m[i]; }
  const c = signedDistanceCpu(m, DIMS, VOXEL);
  const st = stats(all, g, c);
  presetStats[name] = { occupiedPct: 100 * occ / N, maxOvershoot: st.maxOvershoot, maxUndershoot: st.maxUndershoot, signFlips: st.signFlips };
  log(`preset ${name}: occupied ${(100 * occ / N).toFixed(1)}%, conservative vs exact EDT (all voxels): ${fmt(st)}`);
  check(occ > 0.005 * N, `preset ${name} makes clouds`);
  check(st.maxOvershoot <= 1e-3 && st.signFlips === 0, `preset ${name}: SDF never overshoots the exact EDT of the NVDF mask (max ${st.maxOvershoot.toExponential(2)} m), no sign flips`);
  b.gen.destroy(); b.weather.destroy();
}

// ---------- 2. amortization ----------
{
  const w = await (async () => {
    const enc = device.createCommandEncoder();
    const weather = encodeProceduralWeatherMap(device, enc, { size: [DIMS[0], DIMS[1]], seed: 3 });
    device.queue.submit([enc.finish()]);
    const gen = createVolumeGenerator(device, { dims: DIMS, voxelSize: VOXEL, weather, sliceDepth: 4 });
    let frames = 0, encoded = 0;
    while (!gen.done) {
      const e = device.createCommandEncoder();
      const r = gen.generate(e, 6);
      device.queue.submit([e.finish()]);
      encoded += r.jobsEncoded; frames++;
    }
    await device.queue.onSubmittedWorkDone();
    const h2 = new Uint16Array(await readTexture(gen.volume.sdf, 2));
    let diff = 0; for (let i = 0; i < N; i++) if (h2[i] !== halfs[i]) diff++;
    const res = { frames, jobs: gen.jobsTotal, encoded, diff, sliced: gen.jobsTotal };
    gen.destroy(); weather.destroy();
    return res;
  })();
  log(`amortized (sliceDepth 4, 6 jobs/frame): ${w.jobs} jobs over ${w.frames} frames, voxels differing from one-shot: ${w.diff}`);
  check(w.diff === 0 && w.encoded === w.jobs, 'sliced generation over frames matches one-shot output and reports completion');
}

// ---------- 2b. world-anchored windows: two windows offset by 1/4 window agree in the overlap ----------
const worldAnchor: Record<string, unknown> = {};
{
  const preset = CLOUD_PRESETS.cumulus, REF = 4096, seed = 7;
  const make = async (origin: [number, number]) => {
    const enc = device.createCommandEncoder();
    const weather = encodeProceduralWeatherMap(device, enc, {
      ...preset.weather, border: 0, size: [DIMS[0], DIMS[1]], seed,
      window: { origin: [origin[0] / REF, origin[1] / REF], size: [DIMS[0] * VOXEL / REF, DIMS[1] * VOXEL / REF] },
    });
    device.queue.submit([enc.finish()]);
    const gen = createVolumeGenerator(device, { dims: DIMS, voxelSize: VOXEL, weather, origin, sliceDepth: 4, params: { ...preset.params, seed } });
    const e2 = device.createCommandEncoder(); gen.generate(e2); device.queue.submit([e2.finish()]);
    await device.queue.onSubmittedWorkDone();
    return { gen, weather, nvdf: new Uint8Array(await readTexture(gen.volume.nvdf, 4)), sdf: new Uint16Array(await readTexture(gen.volume.sdf, 2)) };
  };
  for (const [name, shift] of [['x quarter', [64, 0]], ['diagonal quarter', [64, 64]]] as [string, [number, number]][]) {
    const a = await make([0, 0]);
    const b = await make([shift[0] * VOXEL, shift[1] * VOXEL]);
    const margin = 12; // voxels from a window edge: the generator's NVDF near the edge may differ (its own border handling)
    // SDF: each window's transform sees only its own box, so an empty voxel's distance differs when its nearest cloud lies outside one window.
    // Invariant: if the nearer of the two distances is less than the voxel's distance to the overlap's interior edge, that nearest surface lies
    // inside both windows (where their NVDFs agree), so both must report it, to within the quantization and the f16 shrink at that distance.
    const ow = DIMS[0] - shift[0], oh = DIMS[1] - shift[1];
    let n = 0, nInterior = 0, over1 = 0, over1Interior = 0, maxD = 0, maxDInterior = 0, sdfBad = 0, sdfBadInterior = 0, occA = 0, occMismatch = 0;
    let sdfCompared = 0, sdfMaxDiff = 0, sdfWorstRatio = 0;
    for (let z = 0; z < D3(); z++) for (let y = 0; y + shift[1] < DIMS[1]; y++) for (let x = 0; x + shift[0] < DIMS[0]; x++) {
      const ia = (z * DIMS[1] + y + shift[1]) * DIMS[0] + x + shift[0], ib = (z * DIMS[1] + y) * DIMS[0] + x; // A voxel (x + shift) is B voxel x
      const interior = x >= margin && y >= margin && x + shift[0] < DIMS[0] - margin && y + shift[1] < DIMS[1] - margin;
      let d = 0; for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(a.nvdf[ia * 4 + c] - b.nvdf[ib * 4 + c]));
      const sa = fromHalfBits(a.sdf[ia]), sb = fromHalfBits(b.sdf[ib]);
      const edgeM = Math.min(x + 0.5, ow - x - 0.5, y + 0.5, oh - y - 0.5) * VOXEL;
      const near = Math.min(Math.abs(sa), Math.abs(sb));
      // The nearest occupied voxel centre is within near + (0.5 + margin 1) voxels; it must also lie where the two NVDFs agree (the interior).
      const inBoth = near + 2 * VOXEL < edgeM - margin * VOXEL;
      const tol = 2 * undershootAllowance(Math.max(Math.abs(sa), Math.abs(sb)));
      const sdfDiff = inBoth && Math.abs(sa - sb) > tol;
      if (inBoth) { sdfCompared++; sdfMaxDiff = Math.max(sdfMaxDiff, Math.abs(sa - sb)); sdfWorstRatio = Math.max(sdfWorstRatio, Math.abs(sa - sb) / tol); }
      n++; maxD = Math.max(maxD, d); if (d > 1) over1++; if (sdfDiff) sdfBad++;
      if (a.nvdf[ia * 4] > 0) occA++;
      if ((a.nvdf[ia * 4] > 0) !== (b.nvdf[ib * 4] > 0)) occMismatch++;
      if (interior) { nInterior++; maxDInterior = Math.max(maxDInterior, d); if (d > 1) over1Interior++; if (sdfDiff) sdfBadInterior++; }
    }
    worldAnchor[name] = { overlapVoxels: n, occupied: occA, occupancyMismatch: occMismatch, maxDelta: maxD, over1: over1, interiorVoxels: nInterior, interiorMaxDelta: maxDInterior, interiorOver1: over1Interior, sdfCompared, sdfMaxDiff, sdfWorstRatio, sdfMismatches: sdfBad, sdfMismatchesInterior: sdfBadInterior };
    log(`world anchor, window B offset ${name} (${shift.map(v => v * VOXEL).join(', ')} m): overlap ${n} voxels (${occA} occupied), occupancy mismatches ${occMismatch}; NVDF max |delta| ${maxD}/255 (${over1} voxels > 1); interior (>${margin} voxels from edges, ${nInterior} voxels) max ${maxDInterior}, ${over1Interior} > 1; SDF where the nearest surface is inside both windows: ${sdfCompared} voxels, max |dA - dB| ${sdfMaxDiff.toFixed(3)} m (worst ${sdfWorstRatio.toFixed(2)} of the tolerance), ${sdfBad} over`);
    check(occA > 1000, `world anchor (${name}): the overlap contains clouds`);
    check(maxDInterior <= 1, `world anchor (${name}): NVDF within 1/255 across the overlap interior (max ${maxDInterior})`);
    check(sdfCompared > 0.5 * n && sdfBad === 0, `world anchor (${name}): SDF agrees wherever the nearest surface lies inside both windows (${sdfCompared} of ${n} voxels, max ${sdfMaxDiff.toFixed(3)} m)`);
    a.gen.destroy(); a.weather.destroy(); b.gen.destroy(); b.weather.destroy();
  }
}
function D3() { return DIMS[2]; }

// ---------- 2c. tiled weather bake (P9-B2): same pixels as the one-shot map, every tile under the 1 ms frame budget ----------
const tiledBake: Record<string, unknown> = {};
{
  // The sky layer's window as cloudscape-gen bakes it (4096 m box at the uv origin, 51200 m window at 2048^2), and the generator's 512^2 map.
  const skyWindow: ProceduralWeatherOptions = { ...CLOUD_PRESETS.cumulus.weather, size: [2048, 2048], seed: 7, border: 0, window: { origin: [(2048 - 25600) / 4096, (2048 - 25600) / 4096], size: [12.5, 12.5] } };
  const cases: { name: string; opts: ProceduralWeatherOptions; tileRows: number }[] = [
    { name: 'sky window 2048^2', tileRows: 32, opts: skyWindow },   // SkyLayerSettings.bakeRows default
    { name: 'sky window 2048^2, 64-row tiles', tileRows: 64, opts: skyWindow },
    { name: 'generator 512^2', tileRows: 128, opts: { ...CLOUD_PRESETS.cumulus.weather, size: [512, 512], seed: 7 } },
  ];
  for (const c of cases) {
    // One-shot reference: encodeProceduralWeatherMap (its pixels), and its cost timed as a single tile covering the whole map (best of 3 after a warm-up).
    let oneShot = Infinity;
    for (let rep = 0; rep < 4; rep++) {
      const t = new PassTimes(4);
      const whole = createWeatherBake(device, c.opts, { tileRows: c.opts.size[1] });
      const enc = device.createCommandEncoder();
      whole.step(enc, t.writes('oneShot'));
      t.finish(enc); device.queue.submit([enc.finish()]);
      const r = await t.collect();
      whole.destroy();
      if (rep > 0) oneShot = Math.min(oneShot, r.byLabel.oneShot?.sum ?? NaN);
    }
    const refEnc = device.createCommandEncoder();
    const ref = encodeProceduralWeatherMap(device, refEnc, c.opts);
    device.queue.submit([refEnc.finish()]);
    // Tiled: one tile per submit (a frame each), timed per tile. Twice; the second run is reported (the first warms the pipeline).
    let tileMs: number[] = [], tiled: GPUTexture | null = null;
    for (let rep = 0; rep < 2; rep++) {
      const bake = createWeatherBake(device, c.opts, { tileRows: c.tileRows });
      const t = new PassTimes(bake.tiles + 1);
      for (let i = 0; !bake.done; i++) {
        const enc = device.createCommandEncoder();
        bake.step(enc, t.writes(`tile${i}`));
        device.queue.submit([enc.finish()]);
        await device.queue.onSubmittedWorkDone();
      }
      const enc = device.createCommandEncoder(); t.finish(enc); device.queue.submit([enc.finish()]);
      const r = await t.collect();
      tileMs = Array.from({ length: bake.tiles }, (_, i) => r.byLabel[`tile${i}`]?.sum ?? NaN);
      bake.destroy(true);
      if (tiled) tiled.destroy();
      tiled = bake.texture;
    }
    const a = new Uint8Array(await readTexture(ref, 4)), b = new Uint8Array(await readTexture(tiled!, 4));
    let maxDiff = 0, texelsDiff = 0;
    for (let i = 0; i < a.length; i += 4) {
      let d = 0; for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(a[i + k] - b[i + k]));
      maxDiff = Math.max(maxDiff, d); if (d) texelsDiff++;
    }
    const texels = a.length / 4;
    const worst = Math.max(...tileMs), sum = tileMs.reduce((x, y) => x + y, 0);
    tiledBake[c.name] = { tileRows: c.tileRows, tiles: tileMs.length, oneShotMs: oneShot, tileMs, worstTileMs: worst, sumTileMs: sum, maxDiff, texelsDiff, texels };
    log(`tiled weather bake, ${c.name}: one-shot ${oneShot.toFixed(3)} ms; ${tileMs.length} tiles of ${c.tileRows} rows: worst ${worst.toFixed(3)} ms, sum ${sum.toFixed(2)} ms; per tile ${tileMs.map(v => v.toFixed(2)).join(' ')}`);
    log(`  tiled vs one-shot: ${texelsDiff} of ${texels} texels differ, max ${maxDiff}/255`);
    check(maxDiff <= 1 && texelsDiff <= texels * 1e-4, `tiled bake (${c.name}) reproduces the one-shot map (${texelsDiff} texels differ, max ${maxDiff}/255)`);
    if (hasTs) check(worst <= 1, `tiled bake (${c.name}): every tile within 1 ms (worst ${worst.toFixed(3)} ms of ${tileMs.length})`);
    ref.destroy(); tiled!.destroy();
  }
}

// ---------- 3. timing ----------
interface Timing { dims: Dims; unslicedMs: number | null; slicedMs: number | null; wallMs: number; jobs: number; perJobMs: number | null; byLabel: Record<string, { sum: number; max: number; count: number }> }
async function time(dims: Dims): Promise<Timing> {
  let best: Timing | null = null;
  for (let rep = 0; rep < 3; rep++) {
    const a = await build(dims, { sliceDepth: dims[2] });
    const ta = await a.times.collect();
    a.gen.destroy(); a.weather.destroy();
    const b = await build(dims, { sliceDepth: 8 });
    const tb = await b.times.collect();
    const jobs = b.gen.jobsTotal, wall = a.wallMs;
    b.gen.destroy(); b.weather.destroy();
    const cand: Timing = { dims, unslicedMs: hasTs ? ta.total : null, slicedMs: hasTs ? tb.total : null, wallMs: wall, jobs, perJobMs: hasTs ? tb.total / jobs : null, byLabel: tb.byLabel };
    if (rep > 0 && (!best || (cand.unslicedMs ?? wall) < (best.unslicedMs ?? best.wallMs))) best = cand; // rep 0 is warm-up
  }
  return best!;
}
const timings: Timing[] = [];
for (const dims of [[256, 256, 32], [512, 512, 64]] as Dims[]) {
  const t = await time(dims);
  timings.push(t);
  const f = (x: number | null) => x === null ? 'n/a' : x.toFixed(3);
  log(`${dims.join('x')}: GPU ${f(t.unslicedMs)} ms one-shot, ${f(t.slicedMs)} ms in ${t.jobs} jobs of 8 z (avg ${f(t.perJobMs)} ms/job), wall ${t.wallMs.toFixed(1)} ms`);
  log('  per stage (sliced, sum / max pass / count): ' + Object.entries(t.byLabel).map(([k, v]) => `${k} ${v.sum.toFixed(2)}/${v.max.toFixed(3)}/${v.count}`).join('  '));
}
check(hasTs ? timings.every(t => t.unslicedMs !== null && t.unslicedMs > 0) : true, 'GPU ms reported for 256x256x32 and 512x512x64');

// ---------- 4. visual ----------
const canvas = document.getElementById('view') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
const [W, H, D] = DIMS;
function paint(ox: number, oy: number, pw: number, ph: number, scaleX: number, scaleY: number, pixel: (x: number, y: number) => [number, number, number], title: string) {
  const img = ctx.createImageData(pw, ph);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const c = pixel(Math.floor(x / scaleX), Math.floor(y / scaleY));
    img.data.set([c[0], c[1], c[2], 255], (y * pw + x) * 4);
  }
  ctx.putImageData(img, ox, oy);
  ctx.fillStyle = '#fff'; ctx.font = '12px ui-monospace, monospace'; ctx.fillText(title, ox + 4, oy + 14);
}
const sdfColor = (d: number): [number, number, number] => {
  // blue inside, orange outside, dark bands every 4 voxels, bright rim at the surface
  const a = Math.min(1, Math.abs(d) / (24 * VOXEL));
  const band = 0.75 + 0.25 * Math.cos(d / (4 * VOXEL) * Math.PI * 2);
  if (Math.abs(d) < VOXEL * 0.5) return [255, 255, 255];
  return d < 0 ? [30 * band, 90 * band + 80 * (1 - a), 255 * band] : [255 * (1 - a * 0.6) * band, 170 * (1 - a) * band, 40 * band];
};
const idx = (x: number, y: number, z: number) => (z * H + y) * W + x;
const midZ = 12;
// row 1: top-down max profile (2x), SDF at one height (2x), detail type max-density projection (2x)
paint(0, 0, 512, 512, 2, 2, (x, y) => { let m = 0; for (let z = 0; z < D; z++) m = Math.max(m, nvdf[idx(x, y, z) * 4]); return [m, m, m]; }, 'profile: max over height (top-down)');
paint(520, 0, 512, 512, 2, 2, (x, y) => sdfColor(gpuSdf[idx(x, y, midZ)]), `SDF (conservative) at z=${midZ}`);
paint(1040, 0, 496, 512, 1.9375, 2, (x, y) => { let best = 0, g = 0; for (let z = 0; z < D; z++) { const p = nvdf[idx(x, y, z) * 4]; if (p > best) { best = p; g = nvdf[idx(x, y, z) * 4 + 1]; } } return best ? [g, 90 + g * 0.3, 255 - g] : [10, 10, 10]; }, 'detail type at densest voxel: red=billowy, blue=wispy');
// row 2: x-z cross-sections through the row with most cloud: profile, SDF, detail
let bestRow = 0, bestCount = -1;
for (let y = 0; y < H; y++) { let c = 0; for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) c += mask[idx(x, y, z)]; if (c > bestCount) { bestCount = c; bestRow = y; } }
const sx = 2, sz = 8;
const up = (z: number) => D - 1 - z;
paint(0, 520, W * sx, D * sz, sx, sz, (x, zz) => { const v = nvdf[idx(x, bestRow, up(zz)) * 4]; return [v, v, v]; }, `profile, x-up section at map row ${bestRow}`);
paint(520, 520, W * sx, D * sz, sx, sz, (x, zz) => sdfColor(gpuSdf[idx(x, bestRow, up(zz))]), 'SDF, same section');
paint(1040, 520, W * sx, D * sz, sx, sz, (x, zz) => { const o = idx(x, bestRow, up(zz)) * 4; return nvdf[o] ? [nvdf[o + 1], 90 + nvdf[o + 1] * 0.3, 255 - nvdf[o + 1]] : [10, 10, 10]; }, 'detail type, same section');
// row 3: error map of the raw EDT vs exact, at the same height as the SDF slice (green = exact, red = overestimate)
paint(0, 784, 256, 256, 1, 1, (x, y) => {
  const i = idx(x, y, midZ), e = (Math.abs(rawSdf[i]) - Math.abs(cpuSdf[i])) / VOXEL;
  if (!mask[i] && Math.abs(cpuSdf[i]) > 24 * VOXEL) return [12, 12, 12];
  return e > 1e-3 ? [255 * Math.min(1, e / 2), 40, 40] : e < -1e-3 ? [40, 40, 255 * Math.min(1, -e / 2)] : [30, 160, 60];
}, `raw GPU EDT vs CPU EDT at z=${midZ}: green exact, red overestimate (2 voxels = full), blue underestimate`);

log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED');
if (failures.length) harness.fail(`generate: ${failures.join('; ')}`);

main.gen.destroy(); raw.gen.destroy();
let last = performance.now(), frameMs = 0;
const loop = () => { const now = performance.now(); frameMs = now - last; last = now; harness.frame(); requestAnimationFrame(loop); };
requestAnimationFrame(loop);
harness.ready({
  report: () => ({
    gpuMs: Object.fromEntries(timings.flatMap(t => [[`generate${t.dims.join('x')}`, t.unslicedMs], [`generate${t.dims.join('x')}Sliced`, t.slicedMs], [`perJob${t.dims.join('x')}`, t.perJobMs]])),
    frameMs, renderSize: [canvas.width, canvas.height],
    sdf256: { rawSamples: sRaw, rawAll: fRaw, conservativeSamples: sCons, conservativeAll: fCons, voxelMeters: VOXEL },
    timings: timings.map(t => ({ dims: t.dims, oneShotGpuMs: t.unslicedMs, slicedGpuMs: t.slicedMs, wallMs: t.wallMs, jobs: t.jobs, perJobMs: t.perJobMs, byStage: t.byLabel })),
    presetStats, worldAnchor, tiledBake, checks: lines.filter(l => l.startsWith('PASS') || l.startsWith('FAIL')).length, failures,
  }),
});
