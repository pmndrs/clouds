/**
 * Cloud volume bindings and sampling. World is (x, y-up, z) metres; texture axes are (x, map row, up),
 * so a world point maps to texture (x, z, y). See work/specs/P1-runtime.md.
 *
 * Bindings (group `g`): 0 uniforms, 1 NVDF, 2 SDF, 3 noise, 4 clamp sampler, 5 repeat sampler.
 * Every pass uses the explicit layout from createVolumeBindGroupLayout() (never layout: 'auto', which strips
 * unused bindings), so one bind group serves all passes.
 */
export const VOLUME_UNIFORM_BYTES = 48;

export function volumeWgsl(group: number): string {
  return /* wgsl */ `
struct CloudVolume {
  minCorner: vec3<f32>, voxelSize: f32,   // world min corner (x, y-up, z), metres per voxel
  extent: vec3<f32>, _pad0: f32,          // world extent (x, y-up, z) in metres
  noiseScale: f32, _pad1: f32, _pad2: f32, _pad3: f32,
}
@group(${group}) @binding(0) var<uniform> cloudVolume: CloudVolume;
@group(${group}) @binding(1) var cloudNvdf: texture_3d<f32>;
@group(${group}) @binding(2) var cloudSdf: texture_3d<f32>;
@group(${group}) @binding(3) var cloudNoise: texture_3d<f32>;
@group(${group}) @binding(4) var clampSampler: sampler;
@group(${group}) @binding(5) var repeatSampler: sampler;

fn volumeUvw(p: vec3<f32>) -> vec3<f32> {
  let q = p - cloudVolume.minCorner;
  return vec3(q.x, q.z, q.y) / vec3(cloudVolume.extent.x, cloudVolume.extent.z, cloudVolume.extent.y);
}
fn insideVolume(p: vec3<f32>) -> bool {
  let q = p - cloudVolume.minCorner;
  return all(q >= vec3(0.0)) && all(q <= cloudVolume.extent);
}
// (profile, detail type, density scale); zero outside the volume.
fn sampleModeling(p: vec3<f32>, mip: f32) -> vec3<f32> {
  if (!insideVolume(p)) { return vec3(0.0); }
  return textureSampleLevel(cloudNvdf, clampSampler, volumeUvw(p), mip).rgb;
}
// Signed distance to cloud in metres, never larger than the true distance.
// Outside the cropped box: the cloud lies inside the box, so the box distance is a lower bound, and so is
// sdf(clamped) - |p - clamped| by the triangle inequality.
fn cloudDistance(p: vec3<f32>) -> f32 {
  let lo = cloudVolume.minCorner;
  let hi = cloudVolume.minCorner + cloudVolume.extent;
  let c = clamp(p, lo, hi);
  let boxDist = length(p - c);
  let s = textureSampleLevel(cloudSdf, clampSampler, volumeUvw(c), 0.0).r;
  if (boxDist <= 0.0) { return s; }
  return max(boxDist, s - boxDist);
}
// Ray/box entry and exit distances; x > y means a miss.
fn volumeRayInterval(origin: vec3<f32>, dir: vec3<f32>) -> vec2<f32> {
  let inv = 1.0 / dir;
  let t0 = (cloudVolume.minCorner - origin) * inv;
  let t1 = (cloudVolume.minCorner + cloudVolume.extent - origin) * inv;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}
`;
}

/** Write the CloudVolume uniform (48 bytes). `position` is the world min corner in metres. */
export function volumeUniformData(position: readonly [number, number, number], extentMeters: readonly [number, number, number], voxelSize: number, noiseScale = 0.01): Float32Array {
  return new Float32Array([...position, voxelSize, ...extentMeters, 0, noiseScale, 0, 0, 0]);
}

export interface VolumeBindingResources {
  uniforms: GPUBuffer;
  nvdf: GPUTexture;
  sdf: GPUTexture;
  noise: GPUTexture;
  clampSampler: GPUSampler;
  repeatSampler: GPUSampler;
}

export function createVolumeBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
  const v = GPUShaderStage.COMPUTE;
  return device.createBindGroupLayout({
    label: 'cloud volume',
    entries: [
      { binding: 0, visibility: v, buffer: { type: 'uniform' } },
      { binding: 1, visibility: v, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 2, visibility: v, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 3, visibility: v, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 4, visibility: v, sampler: { type: 'filtering' } },
      { binding: 5, visibility: v, sampler: { type: 'filtering' } },
    ],
  });
}

export function createVolumeBindGroup(device: GPUDevice, layout: GPUBindGroupLayout, r: VolumeBindingResources): GPUBindGroup {
  return device.createBindGroup({
    label: 'cloud volume',
    layout,
    entries: [
      { binding: 0, resource: { buffer: r.uniforms } },
      { binding: 1, resource: r.nvdf.createView() },
      { binding: 2, resource: r.sdf.createView() },
      { binding: 3, resource: r.noise.createView() },
      { binding: 4, resource: r.clampSampler },
      { binding: 5, resource: r.repeatSampler },
    ],
  });
}

export function createVolumeSamplers(device: GPUDevice): { clampSampler: GPUSampler; repeatSampler: GPUSampler } {
  return {
    clampSampler: device.createSampler({ label: 'cloud clamp', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' }),
    repeatSampler: device.createSampler({ label: 'cloud repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat' }),
  };
}
