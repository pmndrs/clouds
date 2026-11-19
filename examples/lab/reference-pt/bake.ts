// PT1: what the path tracer needs from our runtime, computed on the runtime's own device with the runtime's own WGSL so both sides see the
// same cloud and the same sky:
//  - bakeDensity: the up-rezzed density (DENSITY_WGSL cloudDensity(...).x, the value the march multiplies by the view extinction) on a dense
//    world-aligned grid, with each voxel's noise mip and hf/near terms taken at its distance to the camera, as the march would see it;
//  - bakeSky: the sky-view LUT as an equirect map in the path tracer's convention, the sun irradiance at the cloud centre, and the
//    hemisphere means the runtime's ambient terms use (for the report).
import { COMMON_WGSL, DENSITY_WGSL, atmosphereWgsl, createVolumeBindGroup, createVolumeBindGroupLayout, createVolumeSamplers, uploadCloudNoise, uploadCloudVolume, volumeUniformData, volumeWgsl, type CloudNoiseAsset, type CloudSettings, type CloudVolumeAsset } from '@clouds/runtime';

export type V3 = [number, number, number];

export interface DensityGrid {
  /** World-axis grid (x, y-up, z), x fastest then y then z; voxel centres at min + (i + 0.5) * voxel. */
  resolution: V3;
  min: V3;
  max: V3;
  voxel: number;
  density: Float32Array;
  densityMax: number;
  /** Fraction of voxels with density > 0. */
  occupancy: number;
  ms: number;
}

const BAKE_WGSL = /* wgsl */ `
struct BakeParams {
  origin: vec3<f32>, voxel: f32,
  dims: vec3<u32>, zOffset: u32,
  camera: vec3<f32>, mipDistanceScale: f32,
  wind: vec3<f32>, baseMip: f32,
  uprez: vec4<f32>,
  wispyBias: f32, detailBias: f32, hfDistance: f32, _p: f32,
}
@group(1) @binding(0) var<uniform> bake: BakeParams;
@group(1) @binding(1) var<storage, read_write> outDensity: array<f32>;
@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid >= bake.dims)) { return; }
  let k = gid.z + bake.zOffset;
  let p = bake.origin + (vec3<f32>(f32(gid.x), f32(gid.y), f32(k)) + 0.5) * bake.voxel;
  let rd = distance(p, bake.camera);
  let inputs = DensityInputs(bake.wind, bake.mipDistanceScale, bake.baseMip, select(0u, 1u, rd < bake.hfDistance), bake.wispyBias, bake.detailBias, bake.uprez);
  outDensity[gid.x + bake.dims.x * (gid.y + bake.dims.y * gid.z)] = cloudDensity(p, rd, inputs).x;
}
`;

/**
 * Dense bake of the runtime's density over `box` (world metres) at `voxel` metres. `settings` are the runtime's live settings (wind, mips,
 * art biases, uprez); `volumeMin` is where the runtime placed the volume (placeCloud). Read back in z slabs.
 */
export async function bakeDensity(device: GPUDevice, volumeAsset: CloudVolumeAsset, noiseAsset: CloudNoiseAsset, volumeMin: V3, settings: CloudSettings, camera: V3, box: { min: V3; max: V3 }, voxel: number): Promise<DensityGrid> {
  const t0 = performance.now();
  const volume = uploadCloudVolume(device, volumeAsset);
  const noise = uploadCloudNoise(device, noiseAsset);
  const layout = createVolumeBindGroupLayout(device);
  const uniforms = device.createBuffer({ label: 'pt1 bake volume', size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uniforms, 0, volumeUniformData(volumeMin, volume.extentMeters, volume.voxelSize, settings.noiseScale) as Float32Array<ArrayBuffer>);
  const volumeGroup = createVolumeBindGroup(device, layout, { uniforms, nvdf: volume.nvdf, sdf: volume.sdf, noise, ...createVolumeSamplers(device) });
  const bakeLayout = device.createBindGroupLayout({ label: 'pt1 bake', entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
  ] });
  const module = device.createShaderModule({ label: 'pt1 density bake', code: COMMON_WGSL + volumeWgsl(0) + DENSITY_WGSL + BAKE_WGSL });
  const pipeline = await device.createComputePipelineAsync({ label: 'pt1 density bake', layout: device.createPipelineLayout({ bindGroupLayouts: [layout, bakeLayout] }), compute: { module, entryPoint: 'main' } });

  const res = [0, 1, 2].map(a => Math.max(1, Math.ceil((box.max[a] - box.min[a]) / voxel))) as V3;
  const [nx, ny, nz] = res;
  const max: V3 = [box.min[0] + nx * voxel, box.min[1] + ny * voxel, box.min[2] + nz * voxel];
  const density = new Float32Array(nx * ny * nz);
  const slabZ = Math.max(1, Math.min(nz, Math.floor((64 << 20) / (nx * ny * 4))));
  const params = device.createBuffer({ label: 'pt1 bake params', size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const out = device.createBuffer({ label: 'pt1 bake out', size: nx * ny * slabZ * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const staging = device.createBuffer({ label: 'pt1 bake staging', size: nx * ny * slabZ * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const group = device.createBindGroup({ layout: bakeLayout, entries: [{ binding: 0, resource: { buffer: params } }, { binding: 1, resource: { buffer: out } }] });
  for (let z0 = 0; z0 < nz; z0 += slabZ) {
    const zs = Math.min(slabZ, nz - z0);
    const p = new ArrayBuffer(96), f = new Float32Array(p), u = new Uint32Array(p);
    f.set(box.min, 0); f[3] = voxel;
    u[4] = nx; u[5] = ny; u[6] = zs; u[7] = z0;
    f.set(camera, 8); f[11] = settings.mipDistanceScale;
    f.set(settings.windOffset, 12); f[15] = settings.baseMip;
    f[16] = settings.noiseInvert; f[17] = settings.detailTypeOverride; f[18] = settings.typeFromScale; f[19] = settings.ambientLaw;
    f[20] = settings.wispyBias; f[21] = settings.detailBias; f[22] = Math.max(settings.detailDistance, 150);
    device.queue.writeBuffer(params, 0, p);
    const enc = device.createCommandEncoder({ label: 'pt1 bake' });
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, volumeGroup); pass.setBindGroup(1, group);
    pass.dispatchWorkgroups(Math.ceil(nx / 8), Math.ceil(ny / 8), Math.ceil(zs / 4));
    pass.end();
    enc.copyBufferToBuffer(out, 0, staging, 0, nx * ny * zs * 4);
    device.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ, 0, nx * ny * zs * 4);
    density.set(new Float32Array(staging.getMappedRange(0, nx * ny * zs * 4)), nx * ny * z0);
    staging.unmap();
  }
  for (const b of [params, out, staging, uniforms]) b.destroy();
  volume.nvdf.destroy(); volume.sdf.destroy(); noise.destroy();
  let densityMax = 0, occupied = 0;
  for (let i = 0; i < density.length; i++) { const d = density[i]; if (d > densityMax) densityMax = d; if (d > 0) occupied++; }
  return { resolution: res, min: [...box.min], max, voxel, density, densityMax, occupancy: occupied / density.length, ms: performance.now() - t0 };
}

export interface SkyBake {
  /** Equirect, row 0 = +Y, u = atan2(x, -z) / 2 pi (the path tracer's map convention), RGBA f32, exposure units. */
  env: { width: number; height: number; channels: 4; data: Float32Array };
  /** sunRadianceAt(cloud centre): the sun's irradiance normal to its direction, exposure units (what the march calls sun radiance). */
  sun: V3;
  /** skyAmbient(centre).upper / .lower (cosine-weighted hemisphere means; the runtime's ambientUp / ambientDown by day). */
  ambientUp: V3;
  ambientDown: V3;
  /** Cosine-weighted means of the baked map itself (should match the two above). */
  envUp: V3;
  envDown: V3;
}

const SKY_WGSL = /* wgsl */ `
struct SkyParams { size: vec2<u32>, _p: vec2<u32>, centre: vec3<f32>, _q: f32 }
@group(1) @binding(0) var<uniform> skyBake: SkyParams;
@group(1) @binding(1) var<storage, read_write> outSky: array<vec4<f32>>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let w = skyBake.size.x; let h = skyBake.size.y;
  if (gid.x == 0u && gid.y == 0u) {
    let a = skyAmbient(skyBake.centre);
    outSky[w * h] = vec4(sunRadianceAt(skyBake.centre), 0.0);
    outSky[w * h + 1u] = vec4(a.upper, 0.0);
    outSky[w * h + 2u] = vec4(a.lower, 0.0);
  }
  if (gid.x >= w || gid.y >= h) { return; }
  let u = (f32(gid.x) + 0.5) / f32(w);
  let v = (f32(gid.y) + 0.5) / f32(h);
  let phi = 2.0 * ATM_PI * u;
  let theta = ATM_PI * v;
  let dir = vec3(sin(theta) * sin(phi), cos(theta), -sin(theta) * cos(phi));
  // As the runtime's hemisphere means read the LUT (atmHemisphereMean): view zenith cosine about the camera's up, azimuth to the sun,
  // shaped with the ambient's ramp weight, in exposure units. Below the horizon the LUT's own ground branch, as the 'lower' mean.
  let up = atmosphere.cameraUp;
  let mu = dot(dir, up);
  let dirH = dir - up * mu;
  let sunH = atmosphere.sunDirection - up * dot(atmosphere.sunDirection, up);
  let cosPhi = dot(dirH, sunH) / max(length(dirH) * length(sunH), 1e-6);
  let dims = vec2<f32>(textureDimensions(atmSkyViewLut, 0));
  let lut = textureSampleLevel(atmSkyViewLut, atmSampler, atmSkyViewUv(mu, cosPhi, dims), 0.0).rgb;
  outSky[gid.y * w + gid.x] = vec4(atmSkyShapeW(lut, mu, atmosphere.rampAmbient) * atmosphere.luminanceScale * atmosphere.sunColor, 1.0);
}
`;

export async function bakeSky(device: GPUDevice, atmosphereLayout: GPUBindGroupLayout, atmosphereGroup: GPUBindGroup, centre: V3, width = 512, height = 256): Promise<SkyBake> {
  const layout = device.createBindGroupLayout({ label: 'pt1 sky bake', entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
  ] });
  const module = device.createShaderModule({ label: 'pt1 sky bake', code: atmosphereWgsl(0) + SKY_WGSL });
  const pipeline = await device.createComputePipelineAsync({ label: 'pt1 sky bake', layout: device.createPipelineLayout({ bindGroupLayouts: [atmosphereLayout, layout] }), compute: { module, entryPoint: 'main' } });
  const params = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const p = new ArrayBuffer(32); new Uint32Array(p).set([width, height], 0); new Float32Array(p).set(centre, 4);
  device.queue.writeBuffer(params, 0, p);
  const bytes = (width * height + 3) * 16;
  const out = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const staging = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const enc = device.createCommandEncoder({ label: 'pt1 sky bake' });
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline); pass.setBindGroup(0, atmosphereGroup);
  pass.setBindGroup(1, device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: params } }, { binding: 1, resource: { buffer: out } }] }));
  pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
  pass.end();
  enc.copyBufferToBuffer(out, 0, staging, 0, bytes);
  device.queue.submit([enc.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const all = new Float32Array(staging.getMappedRange().slice(0));
  staging.unmap();
  for (const b of [params, out, staging]) b.destroy();
  const data = all.slice(0, width * height * 4);
  const at = (i: number): V3 => [all[(width * height + i) * 4], all[(width * height + i) * 4 + 1], all[(width * height + i) * 4 + 2]];
  // Cosine-weighted hemisphere means of the map (check against the runtime's).
  const up: V3 = [0, 0, 0], down: V3 = [0, 0, 0];
  let wu = 0, wd = 0;
  for (let j = 0; j < height; j++) {
    const theta = Math.PI * (j + 0.5) / height, c = Math.cos(theta), w = Math.abs(c) * Math.sin(theta);
    for (let i = 0; i < width; i++) {
      const o = (j * width + i) * 4, acc = c >= 0 ? up : down;
      for (let k = 0; k < 3; k++) acc[k] += data[o + k] * w;
      if (c >= 0) wu += w; else wd += w;
    }
  }
  return { env: { width, height, channels: 4, data }, sun: at(0), ambientUp: at(1), ambientDown: at(2), envUp: up.map(v => v / wu) as V3, envDown: down.map(v => v / wd) as V3 };
}
