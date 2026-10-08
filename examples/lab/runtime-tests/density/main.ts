// P1-04: GPU vs CPU density parity. Evaluates cloudDensity (DENSITY_WGSL) at thousands of points on Parkouring
// and compares against the CPU reference port of VoxelCloudSampler.cg (packages/runtime/src/reference/density.ts).
// Mip is forced to 0 on both sides (mipDistanceScale = 0, baseMip = 0).
import {
  COMMON_WGSL, createVolumeBindGroup, createVolumeBindGroupLayout, createVolumeSamplers, loadCloudNoise, loadCloudVolume,
  uploadCloudNoise, uploadCloudVolume, volumeUniformData, volumeWgsl,
} from '@clouds/runtime';
import { cloudDensityCpu, cloudDensityFromSamples, sampleModelingCpu, sampleTrilinear, type DensityInputs, type DensityNoise, type DensityVolume } from '../../../../packages/runtime/src/reference/density';
import { installCloudsHarness } from '../../harness/clouds-contract';

const harness = installCloudsHarness();
const out = document.getElementById('out')!;
const print = (s: string) => { out.textContent += s + '\n'; console.log(s); };

type Glob = (pattern: string, options: Record<string, unknown>) => Record<string, unknown>;
type Meta = { glob: Glob };
// DENSITY_WGSL is written by P1-01. import.meta.glob is empty until the file exists.
const densityModules = (import.meta as unknown as Meta).glob('../../../../packages/runtime/src/shaders/density.wgsl.ts', { eager: true }) as Record<string, { DENSITY_WGSL?: string }>;

const STUB_DENSITY_WGSL = /* wgsl */ `
struct DensityInputs { wind: vec3<f32>, mipDistanceScale: f32, baseMip: f32, hfDetails: u32, _p0: f32, _p1: f32 }
fn cloudDensity(p: vec3<f32>, rayDistance: f32, inputs: DensityInputs) -> vec2<f32> {
  let m = sampleModeling(p, inputs.baseMip);
  let profile = m.x; let type_ = m.y; let densityScale = m.z;
  if (!(profile > 0.0)) { return vec2(0.0); }
  let mip = log2(1.0 + abs(rayDistance * inputs.mipDistanceScale)) + inputs.baseMip;
  let n = textureSampleLevel(cloudNoise, repeatSampler, (p - inputs.wind) * cloudVolume.noiseScale, mip);
  let wispy = mix(n.r, n.g, profile);
  let billowy = mix(n.b * 0.3, n.a * 0.3, pow(profile, 0.25));
  var comp = mix(wispy, billowy, type_);
  let hf = inputs.hfDetails != 0u;
  if (hf) {
    let hhf = saturate(mix(1.0 - pow(abs(abs(n.g * 2.0 - 1.0) * 2.0 - 1.0), 4.0), pow(abs(abs(n.a * 2.0 - 1.0) * 2.0 - 1.0), 2.0), type_));
    comp = mix(hhf, comp, valueRemap(rayDistance, 50.0, 150.0, 0.9, 1.0));
  }
  var d = valueErosion(profile, comp);
  let ps = pow(saturate(densityScale), 4.0);
  d = d * ps;
  d = pow(d, mix(0.3, 0.6, max(EPSILON, ps)));
  if (hf) {
    let f = fractionFromValue(rayDistance, 50.0, 150.0);
    d = pow(d, mix(0.5, 1.0, f)) * mix(0.666, 1.0, f);
  }
  return vec2(d * valueRemap(rayDistance, 10.0, 120.0, 0.25, 1.0), profile * densityScale);
}
`;

const ENTRY_WGSL = /* wgsl */ `
struct PointIn { p: vec4<f32>, w: vec4<f32> }   // p.xyz position, p.w ray distance; w.xyz wind, w.w = bitcast hfDetails
@group(1) @binding(0) var<storage, read> pts: array<PointIn>;
@group(1) @binding(1) var<storage, read_write> outDensity: array<vec2<f32>>;
@group(1) @binding(2) var<storage, read_write> outModel: array<vec4<f32>>;
@group(1) @binding(3) var<storage, read_write> outNoise: array<vec4<f32>>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= arrayLength(&pts)) { return; }
  let pt = pts[id.x];
  let inputs = DensityInputs(pt.w.xyz, 0.0, 0.0, bitcast<u32>(pt.w.w), 0.0, 0.0);
  outDensity[id.x] = cloudDensity(pt.p.xyz, pt.p.w, inputs);
  outModel[id.x] = vec4(sampleModeling(pt.p.xyz, 0.0), 0.0);
  outNoise[id.x] = textureSampleLevel(cloudNoise, repeatSampler, (pt.p.xyz - pt.w.xyz) * cloudVolume.noiseScale, 0.0);
}
`;

// Deterministic RNG.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const WEIGHT_STEPS = Number(new URLSearchParams(location.search).get("steps") ?? 256);
const CATEGORIES = ['deep', 'surface', 'emptyInside', 'outside', 'nearHF'] as const;
type Category = typeof CATEGORIES[number];

function stats(values: number[]) {
  const sorted = Float64Array.from(values).sort();
  const n = sorted.length;
  let sum = 0; for (const v of sorted) sum += v;
  return { n, max: n ? sorted[n - 1] : 0, p99: n ? sorted[Math.min(n - 1, Math.floor(0.99 * (n - 1) + 0.5))] : 0, mean: n ? sum / n : 0 };
}

async function run() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error('WebGPU adapter unavailable');
  const device = await adapter.requestDevice();
  device.addEventListener('uncapturederror', (e) => { throw new Error('GPU error: ' + (e as GPUUncapturedErrorEvent).error.message); });

  const [asset, noiseAsset] = await Promise.all([loadCloudVolume('/clouds/parkouring/'), loadCloudNoise('/clouds/noise/')]);
  const gpuVolume = uploadCloudVolume(device, asset);
  const noiseTexture = uploadCloudNoise(device, noiseAsset);
  const NOISE_SCALE = 0.01;
  const minCorner: [number, number, number] = [1234.5, 321.25, -777.75]; // arbitrary, exercises the offset
  const [ex, ey, ez] = gpuVolume.extentMeters;
  const v = asset.voxelSizeMeters;
  const [dx, dy, dz] = asset.dims;

  const cpuVolume: DensityVolume = { dims: asset.dims, voxelSize: v, nvdf: asset.nvdf, minCorner };
  const cpuNoise: DensityNoise = { size: noiseAsset.size, data: noiseAsset.mips[0], noiseScale: NOISE_SCALE };

  // Diagnostic: same reference with 8-bit fixed-point filter weights, which is what most GPUs' texture units do.
  const cpuVolumeQ = { ...cpuVolume, weightSteps: WEIGHT_STEPS };
  const cpuNoiseQ = { ...cpuNoise, weightSteps: WEIGHT_STEPS };

  // ---- points ----
  const rand = rng(0xc10d5);
  const deep: number[] = [], edge: number[] = [], empty: number[] = [], any: number[] = [];
  for (let i = 0; i < dx * dy * dz; i++) {
    const r = asset.nvdf[i * 4];
    if (r >= 200) deep.push(i); else if (r > 0 && r <= 70) edge.push(i); else if (r === 0) empty.push(i);
    if (r > 0) any.push(i);
  }
  const pick = (list: number[]) => list[Math.floor(rand() * list.length)];
  const texelPoint = (i: number): [number, number, number] => {
    const tx = i % dx, ty = Math.floor(i / dx) % dy, tz = Math.floor(i / (dx * dy));
    // texture (x, row, slice) -> world (x, z, y); jitter within +-1 voxel to include interpolation across texels.
    return [minCorner[0] + (tx + 0.5 + (rand() * 2 - 1)) * v, minCorner[1] + (tz + 0.5 + (rand() * 2 - 1)) * v, minCorner[2] + (ty + 0.5 + (rand() * 2 - 1)) * v];
  };
  const farDistance = () => (rand() < 0.35 ? rand() * 150 : rand() * 1500);
  const N_PER = 1000;
  const raw: { cat: Category; p: [number, number, number]; rd: number }[] = [];
  for (let k = 0; k < N_PER; k++) raw.push({ cat: 'deep', p: texelPoint(pick(deep)), rd: farDistance() });
  for (let k = 0; k < N_PER; k++) raw.push({ cat: 'surface', p: texelPoint(pick(edge)), rd: farDistance() });
  for (let k = 0; k < N_PER; k++) raw.push({ cat: 'emptyInside', p: texelPoint(pick(empty)), rd: farDistance() });
  for (let k = 0; k < N_PER; k++) {
    // Within 300 m of the box, outside it on at least one axis.
    let p: [number, number, number];
    do { p = [minCorner[0] + (rand() * 2 - 0.3) * ex * 0.6 - 0.2 * ex, minCorner[1] + (rand() * 1.8 - 0.4) * ey, minCorner[2] + (rand() * 1.6 - 0.3) * ez]; }
    while (p[0] >= minCorner[0] && p[0] <= minCorner[0] + ex && p[1] >= minCorner[1] && p[1] <= minCorner[1] + ey && p[2] >= minCorner[2] && p[2] <= minCorner[2] + ez);
    raw.push({ cat: 'outside', p, rd: farDistance() });
  }
  for (let k = 0; k < N_PER; k++) raw.push({ cat: 'nearHF', p: texelPoint(pick(any)), rd: rand() * 150 });

  const count = raw.length;
  const inputBuf = new Float32Array(count * 8);
  const inputU32 = new Uint32Array(inputBuf.buffer);
  const cpuInputs: DensityInputs[] = [];
  const hfFlags: boolean[] = [];
  raw.forEach((pt, i) => {
    const windy = rand() < 0.5;
    const wind: [number, number, number] = windy ? [(rand() * 2 - 1) * 400, 0, (rand() * 2 - 1) * 400] : [0, 0, 0];
    const hf = (pt.rd < 150) !== (rand() < 0.1); // mostly rd < 150, with a few flipped to cover hf far / non-hf near
    inputBuf.set([...pt.p, pt.rd, ...wind], i * 8);
    inputU32[i * 8 + 7] = hf ? 1 : 0;
    hfFlags.push(hf);
    cpuInputs.push({ wind: [inputBuf[i * 8 + 4], inputBuf[i * 8 + 5], inputBuf[i * 8 + 6]], mipDistanceScale: 0, baseMip: 0, hfDetails: hf });
  });

  // ---- GPU ----
  const usingReal = typeof densityModules[Object.keys(densityModules)[0]]?.DENSITY_WGSL === 'string' && new URLSearchParams(location.search).get('stub') !== '1';
  const densityWgsl = usingReal ? densityModules[Object.keys(densityModules)[0]].DENSITY_WGSL! : STUB_DENSITY_WGSL;
  print(`density source: ${usingReal ? 'REAL DENSITY_WGSL (packages/runtime/src/shaders/density.wgsl.ts)' : 'LOCAL STUB (density.wgsl.ts not found or ?stub=1)'}`);
  const code = COMMON_WGSL + volumeWgsl(0) + densityWgsl + ENTRY_WGSL;
  const module = device.createShaderModule({ label: 'density parity', code });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter(m => m.type === 'error');
  if (errors.length) throw new Error('WGSL compile: ' + errors.map(m => `${m.lineNum}:${m.linePos} ${m.message}`).join('; '));

  const volumeLayout = createVolumeBindGroupLayout(device);
  const c = GPUShaderStage.COMPUTE;
  const passLayout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: c, buffer: { type: 'read-only-storage' } },
    { binding: 1, visibility: c, buffer: { type: 'storage' } },
    { binding: 2, visibility: c, buffer: { type: 'storage' } },
    { binding: 3, visibility: c, buffer: { type: 'storage' } },
  ] });
  const pipeline = device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [volumeLayout, passLayout] }), compute: { module, entryPoint: 'main' } });

  const uniformData = new Float32Array(volumeUniformData(minCorner, gpuVolume.extentMeters, v, NOISE_SCALE));
  const uniforms = device.createBuffer({ size: uniformData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uniforms, 0, uniformData);
  const volumeGroup = createVolumeBindGroup(device, volumeLayout, { uniforms, nvdf: gpuVolume.nvdf, sdf: gpuVolume.sdf, noise: noiseTexture, ...createVolumeSamplers(device) });

  const storage = (bytes: number, extra = 0) => device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | extra });
  const inBuf = storage(inputBuf.byteLength); device.queue.writeBuffer(inBuf, 0, inputBuf);
  const outD = storage(count * 8), outM = storage(count * 16), outN = storage(count * 16);
  const passGroup = device.createBindGroup({ layout: passLayout, entries: [inBuf, outD, outM, outN].map((buffer, binding) => ({ binding, resource: { buffer } })) });
  const readbacks = [outD, outM, outN].map(b => device.createBuffer({ size: b.size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }));

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline); pass.setBindGroup(0, volumeGroup); pass.setBindGroup(1, passGroup);
  pass.dispatchWorkgroups(Math.ceil(count / 64));
  pass.end();
  [outD, outM, outN].forEach((b, i) => encoder.copyBufferToBuffer(b, 0, readbacks[i], 0, b.size));
  device.queue.submit([encoder.finish()]);
  await Promise.all(readbacks.map(r => r.mapAsync(GPUMapMode.READ)));
  const gDensity = new Float32Array(readbacks[0].getMappedRange().slice(0));
  const gModel = new Float32Array(readbacks[1].getMappedRange().slice(0));
  const gNoise = new Float32Array(readbacks[2].getMappedRange().slice(0));

  // ---- compare ----
  const errByCat: Record<string, number[]> = {};
  const formula: number[] = [], modelErrQ: number[] = [], noiseErrQ: number[] = [], allQ: number[] = [], all: number[] = [], modelErr: number[] = [], noiseErr: number[] = [];
  const worstQ: { i: number; cat: string; err: number; gpu: number[]; cpu: number[]; rd: number; hf: boolean; wind: readonly number[]; model: number[]; gModel: number[] }[] = [];
  const worst: { i: number; cat: string; err: number; gpu: number[]; cpu: number[]; rd: number; hf: boolean }[] = [];
  let nonZero = 0, nonZeroHf = 0, nonZeroOutside = 0;
  for (let i = 0; i < count; i++) {
    const pt: [number, number, number] = [inputBuf[i * 8], inputBuf[i * 8 + 1], inputBuf[i * 8 + 2]];
    const rd = inputBuf[i * 8 + 3];
    const cpu = cloudDensityCpu(cpuVolume, cpuNoise, pt, rd, cpuInputs[i]);
    const cpuQ = cloudDensityCpu(cpuVolumeQ, cpuNoiseQ, pt, rd, cpuInputs[i]);
    const gpu = [gDensity[i * 2], gDensity[i * 2 + 1]];
    const e = Math.max(Math.abs(cpu[0] - gpu[0]), Math.abs(cpu[1] - gpu[1]));
    if (!Number.isFinite(e)) throw new Error(`non-finite result at point ${i}: gpu ${gpu} cpu ${cpu}`);
    const fo = cloudDensityFromSamples([gModel[i * 4], gModel[i * 4 + 1], gModel[i * 4 + 2]], [gNoise[i * 4], gNoise[i * 4 + 1], gNoise[i * 4 + 2], gNoise[i * 4 + 3]], rd, cpuInputs[i]);
    formula.push(Math.max(Math.abs(fo[0] - gpu[0]), Math.abs(fo[1] - gpu[1])));
    allQ.push(Math.max(Math.abs(cpuQ[0] - gpu[0]), Math.abs(cpuQ[1] - gpu[1])));
    all.push(e); (errByCat[raw[i].cat] ??= []).push(e);
    if (gpu[0] > 0) { nonZero++; if (hfFlags[i]) nonZeroHf++; if (raw[i].cat === 'outside') nonZeroOutside++; }
    const mq = sampleModelingCpu(cpuVolumeQ, pt);
    modelErrQ.push(Math.max(...mq.map((x, k) => Math.abs(x - gModel[i * 4 + k]))));
    const m = sampleModelingCpu(cpuVolume, pt);
    modelErr.push(Math.max(...m.map((x, k) => Math.abs(x - gModel[i * 4 + k]))));
    const nz = sampleTrilinear(cpuNoise.data, [cpuNoise.size, cpuNoise.size, cpuNoise.size], [0, 1, 2].map(a => (pt[a] - cpuInputs[i].wind[a]) * NOISE_SCALE) as [number, number, number], true);
    noiseErr.push(Math.max(...nz.map((x, k) => Math.abs(x - gNoise[i * 4 + k]))));
    const nzq = sampleTrilinear(cpuNoise.data, [cpuNoise.size, cpuNoise.size, cpuNoise.size], [0, 1, 2].map(a => (pt[a] - cpuInputs[i].wind[a]) * NOISE_SCALE) as [number, number, number], true, WEIGHT_STEPS);
    noiseErrQ.push(Math.max(...nzq.map((x, k) => Math.abs(x - gNoise[i * 4 + k]))));
    worst.push({ i, cat: raw[i].cat, err: e, gpu, cpu, rd, hf: hfFlags[i] });
    worstQ.push({ i, cat: raw[i].cat, err: allQ[allQ.length - 1], gpu, cpu: cpuQ, rd, hf: hfFlags[i], wind: cpuInputs[i].wind, model: [...sampleModelingCpu(cpuVolumeQ, pt)], gModel: [gModel[i * 4], gModel[i * 4 + 1], gModel[i * 4 + 2]] });
  }
  worst.sort((a, b) => b.err - a.err);
  worstQ.sort((a, b) => b.err - a.err);
  const TOLERANCE = 1e-3;            // formula parity (hardware filtering removed)
  const E2E_TOLERANCE = 5e-3;        // end to end, includes GPU fixed-point filter weights; see work/reports/P1-04.md
  const overall = stats(all);
  const result = {
    densitySource: usingReal ? 'real' : 'stub',
    points: count, tolerance: TOLERANCE, e2eTolerance: E2E_TOLERANCE, formulaParity: stats(formula), strictEndToEndPass: overall.max <= TOLERANCE,
    pass: stats(formula).max <= TOLERANCE && overall.max <= E2E_TOLERANCE,
    error: overall, errorVsQuantizedWeightReference: stats(allQ), weightSteps: WEIGHT_STEPS, byCategory: Object.fromEntries(CATEGORIES.map(k => [k, stats(errByCat[k] ?? [])])),
    nvdfFilterError: stats(modelErr), noiseFilterError: stats(noiseErr), nvdfFilterErrorQuantized: stats(modelErrQ), noiseFilterErrorQuantized: stats(noiseErrQ),
    nonZeroDensityPoints: nonZero, nonZeroWithHf: nonZeroHf, nonZeroOutsideBox: nonZeroOutside,
    hfPoints: hfFlags.filter(Boolean).length,
    worstVsQuantized: worstQ.slice(0, 5),
    worst: worst.slice(0, 5).map(w => ({ ...w, pos: [...raw[w.i].p] })),
  };
  print(JSON.stringify(result, null, 2));
  if (nonZero < 500 || nonZeroHf < 100) throw new Error(`test is not exercising the density path (nonZero=${nonZero}, nonZeroHf=${nonZeroHf})`);
  if (nonZeroOutside > 0) throw new Error(`${nonZeroOutside} outside-box points returned density > 0`);
  if (!result.pass) throw new Error(`density mismatch: formula max ${stats(formula).max}, end-to-end max ${overall.max}\n${JSON.stringify(result)}`);
  return result;
}

try {
  const result = await run();
  harness.ready({ report: () => ({ ...result, gpuMs: {}, frameMs: 0, renderSize: [0, 0] }) });
  const loop = () => { harness.frame(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  print('FAIL: ' + msg);
  harness.fail(msg);
}
