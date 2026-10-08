// GPU test for the voxel light grid: CPU-march parity on a synthetic sphere, 8-frame sun-change behaviour with a
// "front is never partial" check, and update cost on Parkouring's real dims.
import { installCloudsHarness } from '../../harness/clouds-contract';
import {
  GpuTimer, createLightGrid, createVolumeBindGroup, createVolumeBindGroupLayout, createVolumeSamplers, loadCloudNoise, loadCloudVolume,
  uploadCloudNoise, uploadCloudVolume, volumeUniformData, type CloudNoiseAsset, type CloudVolumeAsset, type LightGrid,
} from '../../../../packages/runtime/src';
// Vite serves files outside the lab root under /@fs/; ?url yields that path in dev (directory URLs fall through to index.html).
import parkouringJson from '../../../../assets/clouds/parkouring/cloud.json?url';
import noiseJson from '../../../../assets/clouds/noise/noise.json?url';
import { fromHalfBits } from '../../../../packages/runtime/src/half';

const harness = installCloudsHarness();
const out = document.getElementById('out')!;
const lines: string[] = [];
const log = (s: string) => { lines.push(s); out.textContent = lines.join('\n'); };
const failures: string[] = [];
const check = (ok: boolean, msg: string) => { log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failures.push(msg); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type V3 = [number, number, number];
const norm = (v: V3): V3 => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };

// ---------- setup helpers ----------
function makeVolumeResources(device: GPUDevice, layout: GPUBindGroupLayout, asset: CloudVolumeAsset, noiseAsset: CloudNoiseAsset, position: V3) {
  const volume = uploadCloudVolume(device, asset);
  const noise = uploadCloudNoise(device, noiseAsset);
  const uniforms = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uniforms, 0, volumeUniformData(position, volume.extentMeters, volume.voxelSize) as Float32Array<ArrayBuffer>);
  const bindGroup = createVolumeBindGroup(device, layout, { uniforms, nvdf: volume.nvdf, sdf: volume.sdf, noise, ...createVolumeSamplers(device) });
  return { volume, bindGroup };
}

function syntheticSphere(): CloudVolumeAsset {
  const dims: V3 = [48, 40, 36]; // x, map row, up: deliberately unequal so an axis mix-up shows.
  const [w, h, d] = dims;
  const nvdf = new Uint8Array(w * h * d * 4), sdf = new Float32Array(w * h * d);
  const c = [22, 17, 15], R = 14;
  for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (z * h + y) * w + x;
    const r = Math.hypot(x - c[0], y - c[1], z - c[2]);
    const profile = Math.max(0, 1 - r / R);
    nvdf.set([Math.round(255 * profile), 0, 255, 255], i * 4);
    sdf[i] = (r - R) * 10;
  }
  return { name: 'synthetic-sphere', dims, voxelSizeMeters: 10, nvdf, sdfMeters: sdf };
}

// ---------- CPU reference (independent of the shader; follows the spec mapping) ----------
function cpuGrid(asset: CloudVolumeAsset, position: V3, gridDims: V3, sunIn: V3, densityScale: number, maxSteps: number): Float32Array {
  const [w, h, d] = asset.dims, v = asset.voxelSizeMeters;
  const extent: V3 = [w * v, d * v, h * v]; // world (x, up, z)
  const sun = norm(sunIn);
  const tex = (x: number, y: number, z: number) => { // clamp-to-edge texel fetch → (profile, scale)
    const ix = Math.min(w - 1, Math.max(0, x)), iy = Math.min(h - 1, Math.max(0, y)), iz = Math.min(d - 1, Math.max(0, z));
    const o = ((iz * h + iy) * w + ix) * 4;
    return [asset.nvdf[o] / 255, asset.nvdf[o + 2] / 255];
  };
  const prof = (p: V3): number => {
    const q = [p[0] - position[0], p[1] - position[1], p[2] - position[2]];
    if (q[0] < 0 || q[1] < 0 || q[2] < 0 || q[0] > extent[0] || q[1] > extent[1] || q[2] > extent[2]) return 0;
    const t = [q[0] / extent[0] * w - 0.5, q[2] / extent[2] * h - 0.5, q[1] / extent[1] * d - 0.5]; // texture (x, z, y)
    const b = t.map(Math.floor), f = t.map((x, i) => x - b[i]);
    // filter profile and density-scale channels separately, then multiply (as the sampler does)
    let r = 0, bb = 0;
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const wgt = (dx ? f[0] : 1 - f[0]) * (dy ? f[1] : 1 - f[1]) * (dz ? f[2] : 1 - f[2]);
      const s = tex(b[0] + dx, b[1] + dy, b[2] + dz);
      r += wgt * s[0]; bb += wgt * s[1];
    }
    return r * bb;
  };
  const exit = (o: V3, dir: V3) => {
    let t = 1e30;
    for (let a = 0; a < 3; a++) {
      if (dir[a] > 1e-6) t = Math.min(t, (position[a] + extent[a] - o[a]) / dir[a]);
      else if (dir[a] < -1e-6) t = Math.min(t, (position[a] - o[a]) / dir[a]);
    }
    return Math.max(t, 0);
  };
  const march = (o: V3, dir: V3, minStep: number) => {
    const tEnd = exit(o, dir);
    if (tEnd <= 0) return 0;
    const n = Math.min(maxSteps, Math.max(1, Math.ceil(tEnd / minStep)));
    const step = tEnd / n;
    let acc = 0;
    for (let i = 0; i < n; i++) { const s = (i + 0.5) * step; acc += prof([o[0] + dir[0] * s, o[1] + dir[1] * s, o[2] + dir[2] * s]); }
    return acc * step * densityScale;
  };
  const [gx, gy, gz] = gridDims;
  const minStep = Math.min(extent[0] / gx, extent[2] / gy, extent[1] / gz);
  const res = new Float32Array(gx * gy * gz * 2);
  for (let k = 0; k < gz; k++) for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
    const p: V3 = [position[0] + (i + 0.5) / gx * extent[0], position[1] + (k + 0.5) / gz * extent[1], position[2] + (j + 0.5) / gy * extent[2]];
    const o = ((k * gy + j) * gx + i) * 2;
    res[o] = march(p, sun, minStep);
    res[o + 1] = march(p, [0, 1, 0], minStep);
  }
  return res;
}

// ---------- readback ----------
async function readGrid(device: GPUDevice, grid: LightGrid, texture: GPUTexture): Promise<Uint16Array> {
  const [gx, gy, gz] = grid.dims;
  const bpr = Math.ceil(gx * 8 / 256) * 256;
  const buffer = device.createBuffer({ size: bpr * gy * gz, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: bpr, rowsPerImage: gy }, { width: gx, height: gy, depthOrArrayLayers: gz });
  device.queue.submit([enc.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const raw = new Uint16Array(buffer.getMappedRange().slice(0));
  buffer.unmap(); buffer.destroy();
  // Pack to (r, g) halves per voxel, dropping row padding and the unused b/a channels.
  const out = new Uint16Array(gx * gy * gz * 2);
  for (let z = 0; z < gz; z++) for (let y = 0; y < gy; y++) for (let x = 0; x < gx; x++) {
    const s = (z * gy + y) * (bpr / 2) + x * 4, o = ((z * gy + y) * gx + x) * 2;
    out[o] = raw[s]; out[o + 1] = raw[s + 1];
  }
  return out;
}
const halves = (a: Uint16Array) => Float32Array.from(a, fromHalfBits);
const same = (a: Uint16Array, b: Uint16Array) => a.length === b.length && a.every((x, i) => x === b[i]);

async function frame(device: GPUDevice, grid: LightGrid, bg: GPUBindGroup, sun: V3, index: number, timer?: GpuTimer, densityScale = 1) {
  timer?.beginFrame();
  const enc = device.createCommandEncoder();
  const step = grid.encode(enc, bg, { sunDirection: sun, densityScale, frameIndex: index }, timer);
  timer?.endFrame(enc);
  device.queue.submit([enc.finish()]);
  return step;
}

// ---------- main ----------
const adapter = await navigator.gpu?.requestAdapter();
if (!adapter) { harness.fail('WebGPU adapter unavailable'); throw new Error('no adapter'); }
const features: GPUFeatureName[] = adapter.features.has('timestamp-query') ? ['timestamp-query'] : [];
const device = await adapter.requestDevice({ requiredFeatures: features });
device.addEventListener('uncapturederror', (e: Event) => { harness.fail((e as GPUUncapturedErrorEvent).error.message); });
const layout = createVolumeBindGroupLayout(device);
const dummyNoise: CloudNoiseAsset = { size: 1, mips: [new Uint8Array(4)], tilingMeters: 100 };
const report: Record<string, unknown> = {};

// 1. CPU parity on the synthetic sphere
{
  const asset = syntheticSphere();
  const position: V3 = [-100, 200, 300];
  const { volume, bindGroup } = makeVolumeResources(device, layout, asset, dummyNoise, position);
  const grid = createLightGrid(device, layout, volume);
  const sun = norm([0.4, 0.7, 0.5]);
  const step = await frame(device, grid, bindGroup, sun, 0);
  check(step.swapped, 'first build completes in a single frame');
  const gpu = halves(await readGrid(device, grid, grid.frontTexture));
  const cpu = cpuGrid(asset, position, grid.dims, sun, 1, 128);
  let max = 0; for (let i = 0; i < cpu.length; i++) max = Math.max(max, cpu[i]);
  // P3-E: the grid now marches a grid-resolution reduced volume (2x2x2 box filtered) instead of the full-res NVDF, so a sharp
  // synthetic cone differs from the full-res CPU march near the cloud edge. Tolerance: worst |error| <= 4% of the channel max, and
  // <= 5% relative where the value is above 10% of the channel max (the part of the grid that moves the lighting).
  const candidates: number[] = [];
  for (let i = 0; i < cpu.length; i++) if (cpu[i] > 0.01 * max) candidates.push(i);
  const parity = (g: Float32Array, c: Float32Array) => {
    const out = [0, 1].map(ch => {
      let chMax = 0; for (let v = 0; v < c.length / 2; v++) chMax = Math.max(chMax, c[v * 2 + ch]);
      let abs = 0, rel = 0, n10 = 0, sum = 0;
      for (let v = 0; v < c.length / 2; v++) {
        const cv = c[v * 2 + ch], gv = g[v * 2 + ch];
        abs = Math.max(abs, Math.abs(gv - cv) / chMax);
        if (cv > 0.1 * chMax) { n10++; rel = Math.max(rel, Math.abs(gv - cv) / cv); sum += Math.abs(gv - cv) / cv; }
      }
      return { chMax, abs, rel, n10, mean: sum / n10 };
    });
    return out;
  };
  const par = parity(gpu, cpu);
  par.forEach((p, ch) => {
    check(p.abs <= 0.04, `${ch ? 'up' : 'sun'}: worst abs error ${(p.abs * 100).toFixed(2)}% of max (${p.chMax.toFixed(1)}) <= 4%`);
    check(p.rel <= 0.05, `${ch ? 'up' : 'sun'}: worst rel error ${(p.rel * 100).toFixed(2)}% (mean ${(p.mean * 100).toFixed(2)}%) over ${p.n10} voxels above 10% of max <= 5%`);
  });
  const worst = Math.max(...par.map(p => p.rel)), worstAll = Math.max(...par.map(p => p.abs)), n = par[0].n10 + par[1].n10;
  const sunMax = Math.max(...Array.from({ length: cpu.length / 2 }, (_, v) => cpu[v * 2]));
  const upMax = Math.max(...Array.from({ length: cpu.length / 2 }, (_, v) => cpu[v * 2 + 1]));
  check(n >= 20, `compared ${n} voxels above 10% of max (${candidates.length} candidates > 1% of max=${max.toFixed(2)})`);
  check(sunMax > 1 && upMax > 1, `non-trivial sums: sun max ${sunMax.toFixed(2)}, up max ${upMax.toFixed(2)} density*m`);
  let zerosOk = true; for (let i = 0; i < cpu.length; i++) if (cpu[i] === 0 && gpu[i] > 0.01 * max) zerosOk = false;
  check(zerosOk, 'voxels with no cloud along the ray stay below 1% of max (reduced-volume filtering leaks at most one cell)');
  report.parity = { voxels: n, worstSampledPct: worst * 100, worstAllPct: worstAll * 100, gridDims: grid.dims };

  // 2. sun change: exactly 8 frames, front never partial
  const A = await readGrid(device, grid, grid.frontTexture);
  const sunB = norm([-0.5, 0.5, 0.3]);
  const fronts: number[] = [], seen: Uint16Array[] = [];
  let swapFrame = -1;
  for (let f = 1; f <= 8; f++) {
    const s = await frame(device, grid, bindGroup, sunB, f);
    if (s.swapped) swapFrame = f;
    fronts.push(grid.frontIndex);
    seen.push(await readGrid(device, grid, grid.frontTexture));
  }
  const B = seen[7];
  check(swapFrame === 8, `sun change swaps on frame 8 (swapped at ${swapFrame})`);
  check(seen.slice(0, 7).every(g => same(g, A)), 'frames 1-7 still sample the complete old grid (bit-identical)');
  check(!same(A, B), 'frame 8 front differs from old grid');
  const cpuB = cpuGrid(asset, position, grid.dims, sunB, 1, 128);
  const gpuB = halves(B);
  const parB = parity(gpuB, cpuB);
  parB.forEach((p, ch) => check(p.abs <= 0.04 && p.rel <= 0.05, `new-sun ${ch ? 'up' : 'sun'}: abs ${(p.abs * 100).toFixed(2)}% of max, rel ${(p.rel * 100).toFixed(2)}% over ${p.n10} voxels`));
  const idle = await frame(device, grid, bindGroup, sunB, 9);
  check(idle.dispatch === null, 'no work recorded once the grid is current');
  check(fronts.slice(0, 7).every(f => f === fronts[0]) && fronts[7] !== fronts[0], `front index flips only on frame 8 (${fronts.join(',')})`);

  // mid-build restart: sun D for 3 frames, then sun E: every observed front is a complete grid (B or E)
  const sunD = norm([0.9, 0.3, -0.2]), sunE = norm([0.1, 0.9, -0.4]);
  const obs: Uint16Array[] = [];
  let f = 10, swaps = 0, swapAt = -1;
  for (let i = 0; i < 3; i++, f++) { await frame(device, grid, bindGroup, sunD, f); obs.push(await readGrid(device, grid, grid.frontTexture)); }
  const restartAt = f;
  for (let i = 0; i < 8; i++, f++) {
    const s = await frame(device, grid, bindGroup, sunE, f);
    if (s.swapped) { swaps++; swapAt = f; }
    obs.push(await readGrid(device, grid, grid.frontTexture));
  }
  const E = obs[obs.length - 1];
  check(swaps === 1 && swapAt === restartAt + 7, `restart mid-build completes 8 frames after the restart (frame ${swapAt - restartAt + 1} of the new build)`);
  check(obs.slice(0, -1).every(g => same(g, B)) && !same(E, B), 'every bound front during the restart was a complete grid (old or new, never mixed)');
  grid.destroy(); volume.destroy();
}

// 3. Parkouring: real dims, per-frame update cost
{
  const dirOf = (u: string) => u.slice(0, u.lastIndexOf('/') + 1);
  const [asset, noiseAsset] = await Promise.all([loadCloudVolume(dirOf(parkouringJson)), loadCloudNoise(dirOf(noiseJson))]);
  const position: V3 = [-432, 300, -432];
  const { volume, bindGroup } = makeVolumeResources(device, layout, asset, noiseAsset, position);
  const grid = createLightGrid(device, layout, volume);
  const sunAt = (frameNo: number): V3 => { const a = frameNo * 0.05 * Math.PI / 180, el = 35 * Math.PI / 180; return [Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)]; };
  report.parkouring = { volumeDims: asset.dims, gridDims: grid.dims, voxelM: asset.voxelSizeMeters };
  let startupMs: number | null = null, sliceMs: number | null = null;
  if (device.features.has('timestamp-query')) {
    const t0 = new GpuTimer(device);
    await frame(device, grid, bindGroup, sunAt(0), 0, t0);
    await device.queue.onSubmittedWorkDone();
    for (let i = 0; i < 6 && startupMs === null; i++) {
      await sleep(30); t0.beginFrame();
      startupMs = t0.last().lightGrid ?? null;
    }
    t0.dispose();
    const t1 = new GpuTimer(device);
    for (let f = 1; f <= 240; f++) { await frame(device, grid, bindGroup, sunAt(f), f, t1); await device.queue.onSubmittedWorkDone(); await sleep(1); }
    await sleep(50); t1.beginFrame();
    sliceMs = t1.averages().lightGrid ?? null;
    t1.dispose();
  } else {
    log('timestamp-query unavailable: GPU ms not measured');
  }
  const fmt = (v: number | null) => v === null ? 'n/a' : v.toFixed(4);
  log(`Parkouring ${asset.dims.join('x')} -> grid ${grid.dims.join('x')}: startup full build ${fmt(startupMs)} ms, per-frame slice (avg) ${fmt(sliceMs)} ms`);
  check(device.features.has('timestamp-query') ? sliceMs !== null : true, 'per-frame update GPU ms reported');
  report.startupMs = startupMs; report.sliceMs = sliceMs;

  // keep rendering real encodes so the capture harness has live frames
  let n = 1000, last = performance.now(), frameMs = 0;
  const loop = () => {
    const enc = device.createCommandEncoder();
    grid.encode(enc, bindGroup, { sunDirection: sunAt(n), densityScale: 1, frameIndex: n }, undefined);
    device.queue.submit([enc.finish()]);
    n++;
    const now = performance.now(); frameMs = now - last; last = now;
    (loop as unknown as { ms: number }).ms = frameMs;
    harness.frame();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  harness.ready({
    report: () => ({ gpuMs: { lightGridSlice: sliceMs, lightGridStartupFull: startupMs }, frameMs, renderSize: [0, 0], checks: lines.filter(l => l.startsWith('PASS') || l.startsWith('FAIL')).length, failures, ...report }),
  });
}
log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED');
if (failures.length) harness.fail(`light-grid: ${failures.join('; ')}`);
