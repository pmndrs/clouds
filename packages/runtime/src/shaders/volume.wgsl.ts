/**
 * Cloud volume bindings and sampling. World is (x, y-up, z) metres; texture axes are (x, map row, up),
 * so a world point maps to texture (x, z, y). See work/specs/P1-runtime.md.
 *
 * Bindings (group `g`): 0 uniforms, 1 NVDF, 2 SDF, 3 noise, 4 clamp sampler, 5 repeat sampler,
 * 6 fine hero indirection, 7 fine hero brick pool, 8 hero uniforms (P8 spec section 4; placeholders when the volume has none).
 * Every pass uses the explicit layout from createVolumeBindGroupLayout() (never layout: 'auto', which strips
 * unused bindings), so one bind group serves all passes.
 */
export const VOLUME_UNIFORM_BYTES = 48;
/**
 * V2: a direct volume's density (r16float 3D, the VDB's density / densityRef; GpuCloudVolume.direct) is bound at the fine hero pool's binding (7):
 * a direct volume has no fine overlay, and only the fine march variant reads the pool, so no other pass sees it. (A separate binding would
 * take the composite past the 16 sampled textures per stage of the default limits.) Read by shaders/direct.wgsl.ts.
 */
export const VOLUME_DIRECT_BINDING = 7;
/** HeroParams: cells (u32 x3), fine voxel (m), 1 / pool size in texels (x3), fineDistance (m), fineErosion, 3 pad. */
export const HERO_UNIFORM_BYTES = 48;

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
// Fine hero overlay (P8 spec section 4): one r32uint cell per 8^3 fine voxels holds a brick slot (or HERO_EMPTY); bricks are 10^3 rgba8
// texels (8^3 payload + a one-voxel apron), 32 x 32 per slab. fineDistance 0 (no fine data bound) turns the overlay off.
struct HeroParams { cells: vec3<u32>, fineVoxel: f32, invPool: vec3<f32>, fineDistance: f32, fineErosion: f32, _h0: f32, _h1: f32, _h2: f32 }
@group(${group}) @binding(6) var heroIndir: texture_3d<u32>;
@group(${group}) @binding(7) var heroPool: texture_3d<f32>;
@group(${group}) @binding(8) var<uniform> hero: HeroParams;

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
// The modeling triple with the fine hero overlay where a brick exists, the coarse one elsewhere; w = 1 inside a fine brick.
fn sampleModelingHero(p: vec3<f32>, mip: f32) -> vec4<f32> {
  if (!insideVolume(p)) { return vec4(0.0); }
  let q = p - cloudVolume.minCorner;
  let f = vec3(q.x, q.z, q.y) / hero.fineVoxel;   // fine voxel coordinates, texture axes
  let cell = min(vec3<u32>(f * 0.125), hero.cells - 1u);
  let slot = textureLoad(heroIndir, cell, 0).r;
  if (slot == 0xffffffffu) { return vec4(sampleModeling(p, mip), 0.0); }
  let o = vec3(f32(slot & 31u), f32((slot >> 5u) & 31u), f32(slot >> 10u)) * 10.0 + 1.0;
  return vec4(textureSampleLevel(heroPool, clampSampler, (o + f - vec3<f32>(cell) * 8.0) * hero.invPool, 0.0).rgb, 1.0);
}
// Signed distance to cloud in metres, never larger than the true distance.
// Outside the cropped box: the cloud lies inside the box, so the box distance is a lower bound, and so is
// sdf(clamped) - |p - clamped| by the triangle inequality.
fn cloudDistance(p: vec3<f32>) -> f32 {
  let lo = cloudVolume.minCorner;
  let hi = cloudVolume.minCorner + cloudVolume.extent;
  let c = clamp(p, lo, hi);
  let boxDist = length(p - c);
  // Trilinear filtering of a Euclidean field can overstate the distance by up to about half a voxel
  // between texel centres, so subtract that to stay conservative (P1-01 review).
  let s = textureSampleLevel(cloudSdf, clampSampler, volumeUvw(c), 0.0).r - 0.5 * cloudVolume.voxelSize;
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

/** The fine hero overlay's bindings (6-8). `uniforms` holds HeroParams (heroUniformData). */
export interface HeroBindingResources {
  indir: GPUTexture;
  pool: GPUTexture;
  uniforms: GPUBuffer;
}

export interface VolumeBindingResources {
  uniforms: GPUBuffer;
  nvdf: GPUTexture;
  sdf: GPUTexture;
  noise: GPUTexture;
  clampSampler: GPUSampler;
  repeatSampler: GPUSampler;
  /** Omitted: empty placeholders with fineDistance 0, so the shaders take the coarse path only. */
  hero?: HeroBindingResources;
  /** V2: the direct-density texture, bound in place of the hero pool (VOLUME_DIRECT_BINDING); not together with `hero`. */
  direct?: GPUTexture;
}

/** HeroParams for a fine overlay (`cells` indirection size, `poolSize` brick pool size in texels). fineDistance 0 turns it off. */
export function heroUniformData(cells: readonly number[], fineVoxel: number, poolSize: readonly number[], fineDistance: number, fineErosion = 1): ArrayBuffer {
  const b = new ArrayBuffer(HERO_UNIFORM_BYTES), u = new Uint32Array(b), f = new Float32Array(b);
  u.set(cells.slice(0, 3)); f[3] = fineVoxel;
  for (let i = 0; i < 3; i++) f[4 + i] = 1 / poolSize[i];
  f[7] = fineDistance; f[8] = fineErosion;
  return b;
}

const placeholders = new WeakMap<GPUDevice, HeroBindingResources>();
/** Per device: a 1^3 empty indirection, a 1^3 pool and zeroed HeroParams (fineDistance 0). */
function heroPlaceholders(device: GPUDevice): HeroBindingResources {
  let p = placeholders.get(device);
  if (!p) {
    const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;
    const indir = device.createTexture({ label: 'hero indirection (none)', dimension: '3d', format: 'r32uint', size: [1, 1, 1], usage });
    device.queue.writeTexture({ texture: indir }, new Uint32Array([0xffffffff]), { bytesPerRow: 4 }, [1, 1, 1]);
    p = { indir, pool: device.createTexture({ label: 'hero pool (none)', dimension: '3d', format: 'rgba8unorm', size: [1, 1, 1], usage }), uniforms: device.createBuffer({ label: 'hero params (none)', size: HERO_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM }) };
    placeholders.set(device, p);
  }
  return p;
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
      { binding: 6, visibility: v, texture: { sampleType: 'uint', viewDimension: '3d' } },
      { binding: 7, visibility: v, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 8, visibility: v, buffer: { type: 'uniform' } },
    ],
  });
}

export function createVolumeBindGroup(device: GPUDevice, layout: GPUBindGroupLayout, r: VolumeBindingResources): GPUBindGroup {
  const h = r.hero ?? heroPlaceholders(device);
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
      { binding: 6, resource: h.indir.createView() },
      { binding: 7, resource: (r.direct ?? h.pool).createView() },
      { binding: 8, resource: { buffer: h.uniforms } },
    ],
  });
}

export function createVolumeSamplers(device: GPUDevice): { clampSampler: GPUSampler; repeatSampler: GPUSampler } {
  return {
    clampSampler: device.createSampler({ label: 'cloud clamp', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' }),
    repeatSampler: device.createSampler({ label: 'cloud repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat' }),
  };
}
