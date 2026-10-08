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
export const LIGHT_GRID_BINDINGS = { uniforms: 0, storage: 1, reduced: 2, reducedSampler: 3 } as const;
/** Iteration cap of the sun march through the reduced volume (the step grows geometrically, so ~35 are typical). */
export const LIGHT_GRID_MAX_STEPS = 96;
export const LIGHT_GRID_PARAM_BYTES = 32;

/**
 * P3-E: the grid used to march the full-resolution NVDF (up to 128 trilinear samples per voxel and channel). It now works from a
 * reduced volume at grid resolution, built once per volume ('reduce' pass, one thread per column):
 *   .r = profile * densityScale-channel at the grid texel centre (a single hardware trilinear NVDF fetch, which is exactly the
 *        average of the 2x2x2 source block for even dims, so it equals what the old march sampled at its first step),
 *   .g = upward optical depth in density*metres (a prefix sum down the column, midpoint rule: exact, no march).
 * The sun channel then marches the small reduced volume with a step that grows with distance (cell size up to 12% of the
 * distance): ~35 samples instead of 128, from a texture 8x smaller than the NVDF. Both channels are scaled by densityScale only
 * at grid-write time, so the reduced volume does not depend on the sun or the density scale.
 */
export const LIGHT_GRID_BUILD_WGSL = /* wgsl */ `
struct LightGridParams {
  sunDir: vec3<f32>, densityScale: f32,
  zOffset: u32, maxSteps: u32, _p0: u32, _p1: u32,
}
@group(1) @binding(0) var<uniform> lgParams: LightGridParams;
@group(1) @binding(1) var lgDst: texture_storage_3d<rgba16float, write>;
@group(1) @binding(2) var lgReduced: texture_3d<f32>;
@group(1) @binding(3) var lgSampler: sampler;

const LG_STEP_GROWTH = 0.12;

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

// Midpoint-rule sum of the reduced volume (profile * density-scale channel, density*metres per metre) from o to the box exit.
// The step starts at one grid cell and grows with the distance travelled; the last step is clipped to the exit.
fn lgMarch(o: vec3<f32>, d: vec3<f32>, minStep: f32) -> f32 {
  let tEnd = lgExitDistance(o, d);
  if (tEnd <= 0.0) { return 0.0; }
  var t = 0.0;
  var acc = 0.0;
  for (var i = 0u; i < lgParams.maxSteps; i++) {
    var s = max(minStep, t * LG_STEP_GROWTH);
    if (i + 1u == lgParams.maxSteps || t + s > tEnd) { s = tEnd - t; }
    acc += textureSampleLevel(lgReduced, lgSampler, volumeUvw(o + d * (t + 0.5 * s)), 0.0).r * s;
    t += s;
    if (t >= tEnd) { break; }
  }
  return acc;
}

// Reduce: one thread per (x, z) column. Fetches the NVDF once per grid texel and accumulates the upward optical depth from the top.
@compute @workgroup_size(8, 8, 1)
fn reduceLightGrid(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(lgDst);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let cellY = cloudVolume.extent.y / f32(dims.z);
  // Exact integral of the trilinearly interpolated column from each texel centre to the top (clamped constant above the last centre).
  var above = 0.0;
  var vAbove = 0.0;
  for (var k = i32(dims.z) - 1; k >= 0; k--) {
    let uvw = (vec3<f32>(f32(gid.x), f32(gid.y), f32(k)) + 0.5) / vec3<f32>(dims);
    let p = cloudVolume.minCorner + vec3(uvw.x * cloudVolume.extent.x, uvw.z * cloudVolume.extent.y, uvw.y * cloudVolume.extent.z);
    let m = sampleModeling(p, 0.0);
    let v = m.x * m.z;
    if (k == i32(dims.z) - 1) { vAbove = v; above = 0.5 * cellY * v; } else { above += 0.5 * cellY * (v + vAbove); vAbove = v; }
    textureStore(lgDst, vec3<i32>(i32(gid.x), i32(gid.y), k), vec4(v, above, 0.0, 0.0));
  }
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
  let up = textureLoad(lgReduced, vec3<i32>(id), 0).g;
  textureStore(lgDst, vec3<i32>(id), vec4(sun, up, 0.0, 0.0) * lgParams.densityScale);
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
