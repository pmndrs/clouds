/**
 * Voxel light grid (Nubis³ slides 113-115). Group 0 is the volume (volumeWgsl(0)); group 1 is this pass.
 *
 * Texture axes match the NVDF: (world x, world z, world y-up). The grid covers the volume bounds exactly, so grid
 * texel (i, j, k) has its centre at uvw = (i + 0.5, j + 0.5, k + 0.5) / gridDims, using the same mapping as volumeUvw().
 *
 * Storage format: rgba16float. rg16float is NOT a core write-only storage format (it needs the
 * `texture-formats-tier1` feature, which Chrome/Metal does not expose by default); rgba16float is core, filterable,
 * and only costs 2x the memory of a 54x54x26 texture (< 0.2 MB). Only .rg is used: x = sun density sum, y = up sum.
 */
export const LIGHT_GRID_BINDINGS = { uniforms: 0, storage: 1 } as const;
export const LIGHT_GRID_MAX_STEPS = 128;
export const LIGHT_GRID_PARAM_BYTES = 32;

export const LIGHT_GRID_BUILD_WGSL = /* wgsl */ `
struct LightGridParams {
  sunDir: vec3<f32>, densityScale: f32,
  zOffset: u32, maxSteps: u32, _p0: u32, _p1: u32,
}
@group(1) @binding(0) var<uniform> lgParams: LightGridParams;
@group(1) @binding(1) var lgDst: texture_storage_3d<rgba16float, write>;

// Distance along dir from an interior point to the volume box. Axis-parallel components are skipped (no 1/0).
fn lgExitDistance(o: vec3<f32>, d: vec3<f32>) -> f32 {
  let lo = cloudVolume.minCorner;
  let hi = cloudVolume.minCorner + cloudVolume.extent;
  var t = 1e30;
  if (d.x > 1e-6) { t = min(t, (hi.x - o.x) / d.x); } else if (d.x < -1e-6) { t = min(t, (lo.x - o.x) / d.x); }
  if (d.y > 1e-6) { t = min(t, (hi.y - o.y) / d.y); } else if (d.y < -1e-6) { t = min(t, (lo.y - o.y) / d.y); }
  if (d.z > 1e-6) { t = min(t, (hi.z - o.z) / d.z); } else if (d.z < -1e-6) { t = min(t, (lo.z - o.z) / d.z); }
  return max(t, 0.0);
}

// Midpoint-rule sum of (profile * densityScaleChannel * densityScale) in density*metres from o to the box exit.
fn lgMarch(o: vec3<f32>, d: vec3<f32>, minStep: f32) -> f32 {
  let tEnd = lgExitDistance(o, d);
  if (tEnd <= 0.0) { return 0.0; }
  let n = clamp(u32(ceil(tEnd / minStep)), 1u, lgParams.maxSteps);
  let step = tEnd / f32(n);
  var acc = 0.0;
  for (var i = 0u; i < n; i++) {
    let m = sampleModeling(o + d * ((f32(i) + 0.5) * step), 0.0);
    acc += m.x * m.z;
  }
  return acc * step * lgParams.densityScale;
}

@compute @workgroup_size(4, 4, 1)
fn buildLightGrid(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(lgDst);
  let id = vec3<u32>(gid.x, gid.y, gid.z + lgParams.zOffset);
  if (any(id >= dims)) { return; }
  let uvw = (vec3<f32>(id) + 0.5) / vec3<f32>(dims);
  // uvw is (x, z, y-up); back to world.
  let p = cloudVolume.minCorner + vec3(uvw.x * cloudVolume.extent.x, uvw.z * cloudVolume.extent.y, uvw.y * cloudVolume.extent.z);
  let cell = vec3(cloudVolume.extent.x / f32(dims.x), cloudVolume.extent.z / f32(dims.y), cloudVolume.extent.y / f32(dims.z));
  let minStep = min(cell.x, min(cell.y, cell.z));
  let sun = lgMarch(p, normalize(lgParams.sunDir), minStep);
  let up = lgMarch(p, vec3(0.0, 1.0, 0.0), minStep);
  textureStore(lgDst, vec3<i32>(id), vec4(sun, up, 0.0, 0.0));
}
`;

/**
 * Consumer-side declarations: a sampled light-grid texture at `binding` and its sampler at `binding + 1` in `group`.
 * Requires volumeWgsl() in the same module. lightGridSample returns (sun, up) summed density in density*metres,
 * trilinearly filtered; zero outside the grid (= volume) bounds.
 */
export function lightGridWgsl(group: number, binding: number): string {
  return /* wgsl */ `
@group(${group}) @binding(${binding}) var lightGridTex: texture_3d<f32>;
@group(${group}) @binding(${binding + 1}) var lightGridSampler: sampler;
fn lightGridSample(p: vec3<f32>) -> vec2<f32> {
  if (!insideVolume(p)) { return vec2(0.0); }
  return textureSampleLevel(lightGridTex, lightGridSampler, volumeUvw(p), 0.0).rg;
}
`;
}
