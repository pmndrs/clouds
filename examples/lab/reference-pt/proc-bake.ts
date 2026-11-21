// P0.4 scene card: a dense bake of the procedural sky's density (the HZD shaper's procSample, exactly the function the procedural trace marches)
// on a world-aligned grid, so a patch of the sky can be path traced and rendered by the runtime from the same grid (the direct-volume route).
//
// Built from the runtime's own shader pieces, compiled on the runtime's device: COMMON_WGSL + volumeWgsl(0) (the N1 noise set reads the
// runtime's cloudNoise, bound with a placeholder volume) + proc.densityWgsl(1, 0) (ProcParams P, the NDF, the HZD noise set, the profile
// tables) + the bake kernel below. Each voxel holds what the trace multiplies by its step length:
//     sigma = procSample(p, t, footprint, full = true, jitter = 0.5).sigma * P.misc.x (densityScale) * procCarve(p)     [1/m]
// The trace also fades the density over the last 20 % of maxDistance (120 km) and picks t (distance from the camera, for the distance-gated
// terms) and the footprint (its pixel cone) per sample. The bake fixes both (see BakeOptions): the grid is one field for every camera.
import { COMMON_WGSL, createVolumeBindGroup, createVolumeBindGroupLayout, createVolumeSamplers, uploadCloudNoise, uploadCloudVolume, volumeUniformData, volumeWgsl, type CloudNoiseAsset } from '@clouds/runtime';
import { createProceduralClouds, proceduralPlaceholderVolume, type ProceduralClouds } from '../../../packages/runtime/src/procedural';
import type { DensityGrid, V3 } from './bake';

const BAKE_WGSL = /* wgsl */ `
struct ProcBake {
  origin: vec3<f32>, voxel: f32,
  dims: vec3<u32>, zOffset: u32,
  camera: vec3<f32>, tFixed: f32,
  footprint: f32, jitter: f32, _a: f32, _b: f32,
}
@group(2) @binding(0) var<uniform> pb: ProcBake;
@group(2) @binding(1) var<storage, read_write> outDensity: array<f32>;
@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= pb.dims)) { return; }
  let k = gid.z + pb.zOffset;
  let p = pb.origin + (vec3<f32>(f32(gid.x), f32(gid.y), f32(k)) + 0.5) * pb.voxel;
  let t = select(distance(p, pb.camera), pb.tFixed, pb.tFixed > 0.0);
  let s = procSample(p, t, pb.footprint, true, pb.jitter);
  outDensity[gid.x + pb.dims.x * (gid.y + pb.dims.y * gid.z)] = max(s.sigma, 0.0) * P.misc.x * procCarve(p);
}
`;

export interface BakeOptions {
  /** Distance (m) handed to procSample as the ray distance t, for its distance-gated terms (N1 hhf detail < 900 m, cubic reads < 30 km,
   *  detail fade at 40 km, mid-slot fade). > 0: one value for every voxel (a camera-independent grid); 0: each voxel's distance to `camera`. */
  t: number;
  /** Texture-LOD footprint (m) handed to procSample. The trace uses its pixel cone (t x about 7e-4 at 1280 x 720, fov 30); the bake uses the
   *  voxel size, so the noise is prefiltered to what the grid can hold instead of aliasing into it. */
  footprint: number;
  /** The curvature / horizon-ring reference (ProcParams origin; the trace's camera). The bake uses the patch centre. */
  camera: V3;
}

export interface ProcBaker {
  proc: ProceduralClouds;
  bake(box: { min: V3; max: V3 }, voxel: number, opts: BakeOptions): Promise<DensityGrid>;
  dispose(): void;
}

/** A procedural model (HZD shaper, `configure` applied to its fresh default settings) and the bake pipeline, on the runtime's device. */
export async function createProcBaker(device: GPUDevice, noiseAsset: CloudNoiseAsset, configure: (p: ProceduralClouds) => void): Promise<ProcBaker> {
  const proc = createProceduralClouds(device, { shaper: 'hzd' });
  configure(proc);
  await proc.load({ hzd: true });
  if (!proc.ready) throw new Error('procedural bake: the HZD model did not become ready');
  const volumeLayout = createVolumeBindGroupLayout(device);
  const placeholder = uploadCloudVolume(device, proceduralPlaceholderVolume());
  const noise = uploadCloudNoise(device, noiseAsset);
  const volumeUniforms = device.createBuffer({ label: 'proc bake volume', size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  // The placeholder sits far below the world: procCarve (boxCarve 0 = always 1 anyway) never sees it.
  device.queue.writeBuffer(volumeUniforms, 0, volumeUniformData([0, -100000, 0], placeholder.extentMeters, placeholder.voxelSize, 0.01) as Float32Array<ArrayBuffer>);
  const volumeGroup = createVolumeBindGroup(device, volumeLayout, { uniforms: volumeUniforms, nvdf: placeholder.nvdf, sdf: placeholder.sdf, noise, ...createVolumeSamplers(device) });
  const C = GPUShaderStage.COMPUTE;
  const procLayout = device.createBindGroupLayout({ label: 'proc bake model', entries: proc.layoutEntries(0, C) });
  const bakeLayout = device.createBindGroupLayout({ label: 'proc bake out', entries: [
    { binding: 0, visibility: C, buffer: { type: 'uniform' } },
    { binding: 1, visibility: C, buffer: { type: 'storage' } },
  ] });
  const code = COMMON_WGSL + volumeWgsl(0) + proc.densityWgsl(1, 0) + BAKE_WGSL;
  const pipeline = await device.createComputePipelineAsync({ label: 'proc bake', layout: device.createPipelineLayout({ bindGroupLayouts: [volumeLayout, procLayout, bakeLayout] }), compute: { module: device.createShaderModule({ label: 'proc bake', code }), entryPoint: 'main' } });

  async function bake(box: { min: V3; max: V3 }, voxel: number, opts: BakeOptions): Promise<DensityGrid> {
    const t0 = performance.now();
    // A still: time 0, no wind offset. update() writes ProcParams (the model settings, the curvature reference, the drift).
    proc.update(0, { camera: opts.camera, wind: [0, 0, 0] });
    const procGroup = device.createBindGroup({ label: 'proc bake model', layout: procLayout, entries: proc.resourceEntries(0) });
    const res = [0, 1, 2].map(a => Math.max(1, Math.ceil((box.max[a] - box.min[a]) / voxel))) as V3;
    const [nx, ny, nz] = res;
    const max: V3 = [box.min[0] + nx * voxel, box.min[1] + ny * voxel, box.min[2] + nz * voxel];
    const density = new Float32Array(nx * ny * nz);
    const slabZ = Math.max(1, Math.min(nz, Math.floor((64 << 20) / (nx * ny * 4))));
    const params = device.createBuffer({ label: 'proc bake params', size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const out = device.createBuffer({ label: 'proc bake out', size: nx * ny * slabZ * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const staging = device.createBuffer({ label: 'proc bake staging', size: nx * ny * slabZ * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const group = device.createBindGroup({ layout: bakeLayout, entries: [{ binding: 0, resource: { buffer: params } }, { binding: 1, resource: { buffer: out } }] });
    for (let z0 = 0; z0 < nz; z0 += slabZ) {
      const zs = Math.min(slabZ, nz - z0);
      const p = new ArrayBuffer(64), f = new Float32Array(p), u = new Uint32Array(p);
      f.set(box.min, 0); f[3] = voxel;
      u[4] = nx; u[5] = ny; u[6] = zs; u[7] = z0;
      f.set(opts.camera, 8); f[11] = opts.t;
      f[12] = opts.footprint; f[13] = 0.5;
      device.queue.writeBuffer(params, 0, p);
      const enc = device.createCommandEncoder({ label: 'proc bake' });
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline); pass.setBindGroup(0, volumeGroup); pass.setBindGroup(1, procGroup); pass.setBindGroup(2, group);
      pass.dispatchWorkgroups(Math.ceil(nx / 8), Math.ceil(ny / 8), Math.ceil(zs / 4));
      pass.end();
      enc.copyBufferToBuffer(out, 0, staging, 0, nx * ny * zs * 4);
      device.queue.submit([enc.finish()]);
      await staging.mapAsync(GPUMapMode.READ, 0, nx * ny * zs * 4);
      density.set(new Float32Array(staging.getMappedRange(0, nx * ny * zs * 4)), nx * ny * z0);
      staging.unmap();
    }
    for (const b of [params, out, staging]) b.destroy();
    let densityMax = 0, occupied = 0;
    for (let i = 0; i < density.length; i++) { const d = density[i]; if (d > densityMax) densityMax = d; if (d > 0) occupied++; }
    return { resolution: res, min: [...box.min], max, voxel, density, densityMax, occupancy: occupied / density.length, ms: performance.now() - t0 };
  }

  return {
    proc, bake,
    dispose() { volumeUniforms.destroy(); placeholder.nvdf.destroy(); placeholder.sdf.destroy(); noise.destroy(); proc.dispose(); },
  };
}

/** Column statistics of a (coarse) grid for choosing a patch: per (x, z) column the optical depth through it and the top and base heights. */
export function columnStats(g: DensityGrid): { nx: number; nz: number; tau: Float32Array; top: Float32Array; base: Float32Array } {
  const [nx, ny, nz] = g.resolution;
  const tau = new Float32Array(nx * nz), top = new Float32Array(nx * nz).fill(-1), base = new Float32Array(nx * nz).fill(-1);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const d = g.density[x + nx * (y + ny * z)];
    if (d <= 0) continue;
    const c = x + nx * z, h = g.min[1] + (y + 0.5) * g.voxel;
    tau[c] += d * g.voxel;
    if (base[c] < 0) base[c] = h;
    top[c] = h;
  }
  return { nx, nz, tau, top, base };
}
