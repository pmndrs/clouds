// P13-H1: the fine hero overlay (work/specs/P8-hero-vdb.md section 4) on a procedural 4 m field.
//
// Field: a 150 m sphere with 1,600 bumps of 6-12 m (lobes of 3-6 m radius) on its surface, on a 128^3 lattice at 4 m (512 m box). Volumes:
//   dense   the 4 m lattice as a plain 128^3 volume (the reference)
//   coarse  its 8 m reduction (64^3, P8 rule: mean, floored at 1/255 where any fine voxel is set), no overlay
//   fine    the 8 m reduction plus the 4 m lattice as bricks (the H1 path)
//   allfine the dense 4 m volume plus an overlay of the same lattice with a brick in every cell: same image as `dense`, every profile
//           fetch through the pool (the cost test: march <= 1.2x dense)
// Checks at load (fail the page): pool vs dense trilinear on smooth ramps within 1/255 everywhere (brick borders, volume faces, cells
// past the lattice), with every brick and with a random half of them.
// Bookmarks: <volume>, or cost-<volume> (same view, GPU medians in the report); ?bookmark= picks the start.
import { COMMON_WGSL, createVolumeBindGroup, createVolumeBindGroupLayout, createVolumeSamplers, heroUniformData, loadCloudNoise, signedDistanceCpu, uploadCloudVolume, uploadFineBricks, volumeUniformData, volumeWgsl, HERO_UNIFORM_BYTES, VOLUME_UNIFORM_BYTES, type CloudQuality, type GpuCloudVolume } from '@clouds/runtime';
import { packFineBricks, reduceFineLattice } from '../../../../packages/runtime/src/hero';
import { installCloudsHarness } from '../../harness/clouds-contract';
import { createStage } from './stage';

type V3 = [number, number, number];
const harness = installCloudsHarness();
const query = new URLSearchParams(location.search);
const notes: string[] = [];
const failures: string[] = [];
const check = (ok: boolean, msg: string) => { notes.push(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failures.push(msg); console.log(ok ? 'PASS' : 'FAIL', msg); };
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const FINE = 4;
const N = 128;
const DIMS: V3 = [N, N, N];
const BOX = N * FINE;
const POS: V3 = [-BOX / 2, 300, -BOX / 2];
const CENTRE: V3 = [0, POS[1] + BOX / 2, 0];
const RADIUS = 150;

/** The procedural fine field, rgba8 in texture axes (x, row = world z, up = world y). */
function buildField(): Uint8Array<ArrayBuffer> {
  const r = rng(13);
  const lobes: { c: V3; r: number }[] = [];
  for (let i = 0; i < 1600; i++) {
    // Uniform direction; lobe radius 3-6 m (bumps 6-12 m across), centre half a radius outside the sphere.
    const u = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u), lr = 3 + 3 * r();
    const d = RADIUS + 0.5 * lr;
    lobes.push({ c: [s * Math.cos(a) * d, u * d, s * Math.sin(a) * d], r: lr });
  }
  const out = new Uint8Array(N * N * N * 4);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    // Voxel centre relative to the sphere centre, world axes.
    const px = POS[0] + (x + 0.5) * FINE - CENTRE[0], py = POS[1] + (z + 0.5) * FINE - CENTRE[1], pz = POS[2] + (y + 0.5) * FINE - CENTRE[2];
    let dist = Math.hypot(px, py, pz) - RADIUS;
    if (dist < 8) for (const l of lobes) { const dl = Math.hypot(px - l.c[0], py - l.c[1], pz - l.c[2]) - l.r; if (dl < dist) dist = dl; }
    const o = ((z * N + y) * N + x) * 4;
    out[o] = dist < 0 ? Math.round(255 * Math.min(1, 0.5 + -dist / 30)) : 0;
    out[o + 1] = 255;   // billowy
    out[o + 2] = 255;
    out[o + 3] = 255;
  }
  return out;
}

const volumeAsset = (name: string, rgba: Uint8Array<ArrayBuffer>, dims: V3, voxel: number) => {
  const n = dims[0] * dims[1] * dims[2], mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = rgba[i * 4] > 0 ? 1 : 0;
  return { name, dims, voxelSizeMeters: voxel, nvdf: rgba, sdfMeters: signedDistanceCpu(mask, dims, voxel) };
};

/**
 * Pool vs dense trilinear: a ramp lattice (R along x, G along y, B along z, 0..255 over the axis) is both the volume's NVDF (sampleModeling,
 * hardware trilinear, clamp-to-edge) and an overlay at the same voxel size. Samples on a 1/4-voxel grid over the closed box [0, dims], so they
 * hit texel centres, texel edges, brick borders (multiples of 8) and both volume faces. Compared where a brick exists (w = 1).
 */
async function rampTest(device: GPUDevice, dims: V3, keep?: (cell: number) => boolean, shift = 0) {
  const [nx, ny, nz] = dims;
  const rgba = new Uint8Array(nx * ny * nz * 4);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const o = ((z * ny + y) * nx + x) * 4;
    rgba[o] = Math.round(255 * x / (nx - 1)); rgba[o + 1] = Math.round(255 * y / (ny - 1)); rgba[o + 2] = Math.round(255 * z / (nz - 1)); rgba[o + 3] = 255;
  }
  const vol = uploadCloudVolume(device, { name: 'ramp', dims, voxelSizeMeters: FINE, nvdf: rgba, sdfMeters: new Float32Array(nx * ny * nz) });
  const bricks = packFineBricks(rgba, dims, FINE, { all: true, keep });
  const fine = uploadFineBricks(device, bricks, 'ramp');
  const layout = createVolumeBindGroupLayout(device);
  const uniforms = device.createBuffer({ size: VOLUME_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uniforms, 0, new Float32Array(volumeUniformData([10, 20, 30], vol.extentMeters, FINE)));
  const heroBuf = device.createBuffer({ size: HERO_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(heroBuf, 0, heroUniformData(fine.cells, FINE, fine.poolSize, 1e9));
  const noise = device.createTexture({ dimension: '3d', size: [1, 1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
  const group0 = createVolumeBindGroup(device, layout, { uniforms, nvdf: vol.nvdf, sdf: vol.sdf, noise, ...createVolumeSamplers(device), hero: { indir: fine.indir, pool: fine.pool, uniforms: heroBuf } });
  const code = COMMON_WGSL + volumeWgsl(0) + /* wgsl */ `
struct RampParams { n: vec3<u32>, step: f32, shift: f32 }
@group(1) @binding(0) var<uniform> rp: RampParams;
@group(1) @binding(1) var<storage, read_write> res: array<atomic<u32>, 8>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= rp.n.x || id.y >= rp.n.y) { return; }
  var m = vec3(0.0);
  var cnt = 0u;
  var worst = 0.0;
  var worstZ = 0u;
  for (var z = 0u; z < rp.n.z; z++) {
    let f = vec3<f32>(f32(id.x), f32(id.y), f32(z)) * rp.step;
    let p = cloudVolume.minCorner + vec3(f.x, f.z, f.y) * hero.fineVoxel;
    let h = sampleModelingHero(p, 0.0);
    if (h.w == 0.0) { continue; }
    let ps = p + vec3(rp.shift * hero.fineVoxel, 0.0, 0.0);
    if (!insideVolume(ps)) { continue; }
    let d = abs(h.xyz - sampleModeling(ps, 0.0));
    m = max(m, d);
    cnt++;
    let dm = max(d.x, max(d.y, d.z));
    if (dm > worst) { worst = dm; worstZ = z; }
  }
  atomicMax(&res[0], u32(m.x * 1e7));
  atomicMax(&res[1], u32(m.y * 1e7));
  atomicMax(&res[2], u32(m.z * 1e7));
  atomicAdd(&res[3], cnt);
  let key = u32(worst * 1e7);
  let prev = atomicMax(&res[4], key);
  if (key > prev && key > 0u) { atomicStore(&res[5], id.x); atomicStore(&res[6], id.y); atomicStore(&res[7], worstZ); }
}`;
  const passLayout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
  ] });
  const pipeline = device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [layout, passLayout] }), compute: { module: device.createShaderModule({ code }), entryPoint: 'main' } });
  const n: V3 = [nx * 4 + 1, ny * 4 + 1, nz * 4 + 1];
  const params = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const pb = new ArrayBuffer(32); new Uint32Array(pb).set(n); new Float32Array(pb)[3] = 0.25; new Float32Array(pb)[4] = shift;
  device.queue.writeBuffer(params, 0, pb);
  const res = device.createBuffer({ size: 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  const read = device.createBuffer({ size: 32, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const group1 = device.createBindGroup({ layout: passLayout, entries: [{ binding: 0, resource: { buffer: params } }, { binding: 1, resource: { buffer: res } }] });
  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline); pass.setBindGroup(0, group0); pass.setBindGroup(1, group1);
  pass.dispatchWorkgroups(Math.ceil(n[0] / 8), Math.ceil(n[1] / 8));
  pass.end();
  enc.copyBufferToBuffer(res, 0, read, 0, 32);
  device.queue.submit([enc.finish()]);
  await read.mapAsync(GPUMapMode.READ);
  const r = new Uint32Array(read.getMappedRange().slice(0));
  read.unmap();
  [vol, fine].forEach(x => x.destroy()); [uniforms, heroBuf, params, res, read].forEach(x => x.destroy()); noise.destroy();
  const maxDiff = [r[0], r[1], r[2]].map(v => v / 1e7 * 255);   // in 1/255 units
  return { dims, bricks: bricks.count, cells: bricks.cells, samples: n[0] * n[1] * n[2], compared: r[3], maxDiff255: maxDiff.map(v => +v.toFixed(4)), worstAtFineVoxel: [r[5], r[6], r[7]].map(v => v * 0.25) };
}

try {
  const quality = (query.get('quality') ?? 'high') as CloudQuality;
  const stage = await createStage({ quality, timeOfDay: 14, deterministic: query.get('deterministic') === '1' });
  const { device, runtime } = stage;
  device.addEventListener('uncapturederror', e => harness.fail((e as GPUUncapturedErrorEvent).error.message));

  // ---- ramp tests (the apron / seam check) ----
  const t0 = performance.now();
  const rampDims: V3 = [61, 44, 29];   // not multiples of 8: cells past the lattice, payload clamped at the faces
  const rampAll = await rampTest(device, rampDims);
  const keepRng = rng(5);
  const keepSet = new Set<number>();
  for (let i = 0; i < 8 * 6 * 4; i++) if (keepRng() < 0.5) keepSet.add(i);
  const rampHalf = await rampTest(device, rampDims, c => keepSet.has(c));
  const rampCube = await rampTest(device, [64, 64, 64]);
  for (const [name, r] of [['all bricks', rampAll], ['half the bricks', rampHalf], ['64^3, all bricks', rampCube]] as const) {
    check(Math.max(...r.maxDiff255) <= 1 && r.compared > 0, `pool vs dense trilinear (${name}, ${r.dims.join('x')}, ${r.bricks} bricks, ${r.compared} samples): max |diff| R/G/B ${r.maxDiff255.join(' / ')} /255 (<= 1)`);
  }
  // Negative control: the dense sample moved by half a fine voxel along x must show up (R off by about 2/255, G and B exact).
  const rampShift = await rampTest(device, rampDims, undefined, 0.5);
  check(rampShift.maxDiff255[0] > 1 && rampShift.maxDiff255[1] === 0, `the ramp test detects a half-voxel offset (control: max |diff| R/G/B ${rampShift.maxDiff255.join(' / ')} /255)`);
  const rampMs = performance.now() - t0;

  // ---- the hero field and its volumes ----
  const t1 = performance.now();
  const field = buildField();
  const coarse = reduceFineLattice(field, DIMS, 2);
  const bricks = packFineBricks(field, DIMS, FINE, { margin: 3 });
  const allBricks = packFineBricks(field, DIMS, FINE, { all: true });
  const buildMs = performance.now() - t1;
  const dense = uploadCloudVolume(device, volumeAsset('dense 4 m', field, DIMS, FINE));
  const coarseVol = uploadCloudVolume(device, volumeAsset('coarse 8 m', coarse.rgba, coarse.dims, 2 * FINE));
  const fineOverlay = uploadFineBricks(device, bricks, 'hero 4 m');
  const allOverlay = uploadFineBricks(device, allBricks, 'hero 4 m all');
  const volumes: Record<string, GpuCloudVolume> = {
    dense, coarse: coarseVol, fine: { ...coarseVol, fine: fineOverlay }, allfine: { ...dense, fine: allOverlay },
  };
  let occupied = 0; for (let i = 0; i < N * N * N; i++) if (field[i * 4]) occupied++;
  notes.push(`field: ${occupied} occupied fine voxels (${(100 * occupied / N ** 3).toFixed(1)}%), coarse ${coarse.dims.join('x')}, ${bricks.count} bricks (margin 3) of ${bricks.cells.join('x')} cells, pool ${(fineOverlay.bytes / 1048576).toFixed(1)} MB; all-fine ${allBricks.count} bricks; CPU build ${buildMs.toFixed(0)} ms`);
  await runtime.setNoise(await loadCloudNoise('/clouds/noise/'));
  for (const [k, v] of query) if (k.startsWith('s.') && k.slice(2) in runtime.settings) (runtime.settings as unknown as Record<string, number>)[k.slice(2)] = Number(v);

  // ---- views ----
  const VIEWS: Record<string, { pos: V3; target: V3; sunEl: number; sunAz: number }> = {
    // Side-lit, 200 m from the sphere's surface: the lobes are 12-24 m across.
    near: { pos: [CENTRE[0] + 250, CENTRE[1] + 60, CENTRE[2] + 260], target: [CENTRE[0] + 20, CENTRE[1] + 30, CENTRE[2]], sunEl: 25, sunAz: 250 },
    close: { pos: [CENTRE[0] + 110, CENTRE[1] + 130, CENTRE[2] + 150], target: [CENTRE[0] + 40, CENTRE[1] + 110, CENTRE[2] + 40], sunEl: 25, sunAz: 250 },
  };
  let current = '';
  const apply = async (name: string) => {
    const m = /^(cost-)?(dense|coarse|fine|allfine)(?:@(near|close))?$/.exec(name);
    if (!m) throw new Error(`unknown bookmark ${name}`);
    const v = VIEWS[m[3] ?? (m[1] ? 'close' : 'near')];
    await runtime.setVolume(volumes[m[2]], { position: POS });
    stage.sky.setSunDirection({ elevation: v.sunEl, azimuth: v.sunAz });
    stage.rig.set(v.pos, v.target);
    stage.resetSamples();
    current = name;
  };
  await apply(query.get('bookmark') ?? 'fine');
  const hud = document.getElementById('hud')!;
  if (query.get('hud') === '0') hud.style.display = 'none';
  let frames = 0;
  stage.start(() => {
    if (frames++ % 15 === 0) hud.textContent = `${current}  fineDistance ${runtime.settings.fineDistance} m\n` + Object.entries(stage.gpuMedian()).map(([k, v]) => `${k.padEnd(12)} ${v.toFixed(3)}`).join('\n') + '\n' + notes.join('\n');
    harness.frame();
  });
  const summary = { ramp: { all: rampAll, half: rampHalf, cube: rampCube, control: rampShift, ms: Math.round(rampMs) }, notes };
  console.log(JSON.stringify(summary));
  if (failures.length) harness.fail(`hero-fine checks failed: ${failures.join(' | ')}`);
  else harness.ready({
    bookmark: name => apply(name),
    report: () => ({ gpuMs: stage.gpuMedian(), frameMs: stage.frameMs(), renderSize: [innerWidth, innerHeight], bookmark: current, quality: runtime.quality, ...summary }),
  });
} catch (e) {
  harness.fail(e instanceof Error ? (e.stack ?? e.message) : String(e));
  throw e;
}
