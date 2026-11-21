/**
 * Voxel light grid (Nubis³ slides 113-115). Group 0 is the volume (volumeWgsl(0)); group 1 is this pass.
 *
 * Texture axes match the NVDF: (world x, world z, world y-up). The grid covers the volume bounds exactly, so grid
 * texel (i, j, k) has its centre at uvw = (i + 0.5, j + 0.5, k + 0.5) / gridDims, using the same mapping as volumeUvw().
 *
 * Storage format: rgba16float. rg16float is NOT a core write-only storage format (it needs the
 * `texture-formats-tier1` feature, which Chrome/Metal does not expose by default); rgba16float is core, filterable,
 * and only costs 2x the memory of a 54x54x26 texture (< 0.2 MB). x = sun density sum to the box exit, y = up sum, z (P9-C3) = the sun sum beyond the box through the sky layer's field.
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
  zOffset: u32, maxSteps: u32, skyOn: u32,   // skyOn: 1 when the sky layer's field is bound (LIGHT_GRID_SKY_WGSL)
  procScale: f32,                            // X4: > 0 when a procedural model is bound (LIGHT_GRID_PROC_WGSL): 1 / (densityScale * lightDensityScale)
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
fn reduceLightGrid(@builtin(global_invocation_id) gid: vec3<u32>) { reduceColumn(gid, false); }
// P1.1 diagnostic (CloudSettings.lightGridSource 1, direct volumes only): the same from the direct density texture (heroPool holds r16f
// density / densityRef for a direct volume), unclamped and without the NVDF's 8-bit step and 1/255 floor.
@compute @workgroup_size(8, 8, 1)
fn reduceLightGridDirect(@builtin(global_invocation_id) gid: vec3<u32>) { reduceColumn(gid, true); }
fn reduceColumn(gid: vec3<u32>, direct: bool) {
  let dims = textureDimensions(lgDst);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let cellY = cloudVolume.extent.y / f32(dims.z);
  // Exact integral of the trilinearly interpolated column from each texel centre to the top (clamped constant above the last centre).
  var above = 0.0;
  var vAbove = 0.0;
  for (var k = i32(dims.z) - 1; k >= 0; k--) {
    let uvw = (vec3<f32>(f32(gid.x), f32(gid.y), f32(k)) + 0.5) / vec3<f32>(dims);
    let p = cloudVolume.minCorner + vec3(uvw.x * cloudVolume.extent.x, uvw.z * cloudVolume.extent.y, uvw.y * cloudVolume.extent.z);
    var v: f32;
    if (direct) { v = max(textureSampleLevel(heroPool, clampSampler, uvw, 0.0).r, 0.0); } else { let m = sampleModeling(p, 0.0); v = m.x * m.z; }
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
  let d = normalize(lgParams.sunDir);
  let sun = lgMarch(p, d, minStep);
  // P9-C3: past the box the sun ray continues through the sky layer's field (the wall column: a voxel cloud next to the wall was lit as if
  // the sky had no cloud beyond it, so a bright column ran up the voxel side of every wall the sun shines through). Kept in .b: the cloud
  // shadow map marches the field outside the box itself and reads only the in-box part (.r).
  var outside = 0.0;
  if (lgParams.skyOn != 0u) { outside = lgOutside(p + d * lgExitDistance(p, d), d); }
  // X4: a procedural model's clouds toward the sun, from the texel itself (in 'hybrid' its field can run through the box), in the march's units.
  if (lgParams.procScale > 0.0) { outside += lgProcedural(p, d, minStep) * lgParams.procScale; }
  let up = textureLoad(lgReduced, vec3<i32>(id), 0).g;
  textureStore(lgDst, vec3<i32>(id), vec4(sun, up, outside, 0.0) * lgParams.densityScale);
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
// P9-C3: the full sun optical depth (in the box plus, with the sky layer on, beyond it: .r + .b) and the up sum. A point just past a face
// reads the face (the march's grid tap 48 m toward the sun from a voxel near the wall), where the part beyond the box is held.
fn lightGridSampleClamped(p: vec3<f32>) -> vec2<f32> {
  let g = textureSampleLevel(lightGridTex, lightGridSampler, volumeUvw(p), 0.0);
  return vec2(g.r + g.b, g.g);
}
// D1 round 5: tricubic B-spline read (Sigg & Hadwiger 2005: eight trilinear taps at the weighted offsets), C2 across the 16 m cells where
// trilinear is C0: the trilinear sun sum has creases at every cell plane, which exp(-tau) turns into a faceted shading on smooth lobes.
fn lightGridSampleCubic(p: vec3<f32>) -> vec2<f32> {
  let dims = vec3<f32>(textureDimensions(lightGridTex));
  let c = volumeUvw(p) * dims - 0.5;
  let i = floor(c);
  let f = c - i;
  let f2 = f * f;
  let f3 = f2 * f;
  let omf = 1.0 - f;
  let w0 = omf * omf * omf / 6.0;
  let w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  let w2 = (4.0 - 6.0 * omf * omf + 3.0 * omf * omf * omf) / 6.0;
  let w3 = f3 / 6.0;
  let g0 = w0 + w1;
  let g1 = w2 + w3;
  let h0 = (i + w1 / g0 - 1.0 + 0.5) / dims;
  let h1 = (i + w3 / g1 + 1.0 + 0.5) / dims;
  var acc = vec4(0.0);
  acc += textureSampleLevel(lightGridTex, lightGridSampler, vec3(h0.x, h0.y, h0.z), 0.0) * (g0.x * g0.y * g0.z);
  acc += textureSampleLevel(lightGridTex, lightGridSampler, vec3(h1.x, h0.y, h0.z), 0.0) * (g1.x * g0.y * g0.z);
  acc += textureSampleLevel(lightGridTex, lightGridSampler, vec3(h0.x, h1.y, h0.z), 0.0) * (g0.x * g1.y * g0.z);
  acc += textureSampleLevel(lightGridTex, lightGridSampler, vec3(h1.x, h1.y, h0.z), 0.0) * (g1.x * g1.y * g0.z);
  acc += textureSampleLevel(lightGridTex, lightGridSampler, vec3(h0.x, h0.y, h1.z), 0.0) * (g0.x * g0.y * g1.z);
  acc += textureSampleLevel(lightGridTex, lightGridSampler, vec3(h1.x, h0.y, h1.z), 0.0) * (g1.x * g0.y * g1.z);
  acc += textureSampleLevel(lightGridTex, lightGridSampler, vec3(h0.x, h1.y, h1.z), 0.0) * (g0.x * g1.y * g1.z);
  acc += textureSampleLevel(lightGridTex, lightGridSampler, vec3(h1.x, h1.y, h1.z), 0.0) * (g1.x * g1.y * g1.z);
  return vec2(acc.r + acc.b, acc.g);
}
`;
}

/** Group 1 bindings of the build pass for the sky layer's field (its weather window, sampler and params; dummies while the layer is off). */
export const LIGHT_GRID_SKY_BINDINGS = { weather: 4, sampler: 5, params: 6 } as const;
/**
 * P9-C3: the build's sun march past the box exit, through the distant layer's cheap field (profile * scale, the units of the reduced volume),
 * times the layer's extinction multiplier. Needs SKY_STRUCT_WGSL, BILLOW_WGSL and SKY_FIELD_WGSL after it (light-grid.ts composes them).
 */
export const LIGHT_GRID_SKY_WGSL = /* wgsl */ `
@group(1) @binding(4) var skyWeather: texture_2d<f32>;
@group(1) @binding(5) var skySampler: sampler;
@group(1) @binding(6) var<uniform> SKY: SkyParams;
// The reach matches the sky layer's own sun samples (sky-layer.wgsl.ts SKY_SUN_T: out to 470 m, stretched by 1 / sin(elevation) up to 4x below
// 45 degrees), so cloud on both sides of a wall sees about as much of the field toward the sun. A longer reach here (8 km) turned the voxel half
// of a tower standing across the wall grey while the layer's half stayed white: the same split as the wall column, the other way round.
const LG_OUT_REACH = 470.0;
const LG_OUT_STEPS = 24u;
fn lgOutside(o: vec3<f32>, d: vec3<f32>) -> f32 {
  var tEnd = LG_OUT_REACH * clamp(0.7071 / max(d.y, 0.01), 1.0, 4.0);
  if (d.y > 1e-4) { tEnd = min(tEnd, (SKY.shell.y - o.y) / d.y); } else if (d.y < -1e-4) { tEnd = min(tEnd, (SKY.shell.x - o.y) / d.y); }
  var t = 0.0;
  var acc = 0.0;
  for (var i = 0u; i < LG_OUT_STEPS; i++) {
    if (t >= tEnd) { break; }
    let s = min(max(32.0, t * LG_STEP_GROWTH), tEnd - t);
    let sp = skyModel(o + d * (t + 0.5 * s), -1.0, false);   // light = false: the box interior is the grid's
    let v = sp.m.x * sp.m.z;
    if (v > 0.0) { acc += v * s; t += s; } else { t += max(s, sp.skip); }
  }
  return acc * SKY.shapeC.z;
}
`;

/** X4: group 1 base binding of a procedural model's bindings (ProceduralDensityModel.densityWgsl(1, LIGHT_GRID_PROC_BINDING)). */
export const LIGHT_GRID_PROC_BINDING = 8;
/** X4: the build without a procedural model (procScale is 0 then; the stub keeps one build source). */
export const LIGHT_GRID_PROC_STUB_WGSL = /* wgsl */ `
fn lgProcedural(p: vec3<f32>, d: vec3<f32>, minStep: f32) -> f32 { return 0.0; }
`;
/**
 * X4: the sun optical depth of a procedural model's clouds from a grid texel, so a voxel hero under a procedural cloud is in its shadow. Needs the
 * model's densityWgsl (P, procSample, procCarve, procAltitude) before it. The same cheap density and extinction (P.misc.x * P.misc.y) as the model's
 * own shadow map pass, times P.hybrid.z (ProceduralSettings.heroShadow).
 *
 * The march starts where the sun ray enters the model's shell (or at the texel inside it) with one grid cell and grows 10 % per step: 64 steps reach
 * about 40 km, fine where the ray is near the hero and coarse far away, where a cloud only casts a soft shadow anyway. It stops once the sun is gone.
 * Texels no voxel reads are skipped: the march samples the grid INLINE_FAR (48 m) toward the sun from each voxel, trilinearly, so the texel matters
 * only when the reduced volume has density within a cell of the segment from it back 48 m away from the sun.
 */
export const LIGHT_GRID_PROC_WGSL = /* wgsl */ `
const LG_PROC_STEPS = 64u;
const LG_PROC_GROWTH = 0.1;
const LG_PROC_REACH = 20000.0;   // the model's own far light taps (trace.wgsl.ts PROC_FAR_REACH)
const LG_PROC_TAU_MAX = 12.0;
const LG_READ_OFFSET = 48.0;   // lighting.wgsl.ts INLINE_FAR
fn lgProcOccupied(p: vec3<f32>, d: vec3<f32>, cell: f32) -> bool {
  let dims = vec3<f32>(textureDimensions(lgReduced));
  let half = 0.5 * vec3(cloudVolume.extent.x / dims.x, cloudVolume.extent.y / dims.z, cloudVolume.extent.z / dims.y);
  let n = i32(ceil(LG_READ_OFFSET / cell)) + 1;
  for (var k = 0; k <= n; k++) {
    let q = p - d * (f32(k) * cell);
    for (var c = 0; c < 8; c++) {
      let s = vec3(f32(c & 1), f32((c >> 1) & 1), f32((c >> 2) & 1)) * 2.0 - 1.0;
      let uvw = volumeUvw(q + s * half);
      if (textureSampleLevel(lgReduced, lgSampler, uvw, 0.0).r > 0.0) { return true; }
    }
  }
  return false;
}
fn lgProcedural(p: vec3<f32>, d: vec3<f32>, minStep: f32) -> f32 {
  let ext = P.misc.x * P.misc.y * P.hybrid.z;
  if (ext <= 0.0 || d.y <= 0.0) { return 0.0; }
  // Flat heights about the texel: the model's curvature drop is a few metres over the march's near part, and the shell top gets a margin for the far part.
  let y0 = procAltitude(p);
  let ta = max((P.shell.x - y0) / d.y, 0.0);
  let tb = min((P.shell.y + 150.0 - y0) / d.y, LG_PROC_REACH);
  if (tb <= ta) { return 0.0; }
  if (!lgProcOccupied(p, d, minStep)) { return 0.0; }
  var t = ta;
  var acc = 0.0;
  for (var i = 0u; i < LG_PROC_STEPS; i++) {
    if (t >= tb || acc * ext > LG_PROC_TAU_MAX) { break; }
    let s = min(max(minStep, (t - ta) * LG_PROC_GROWTH), tb - t);
    let ps = p + d * (t + 0.5 * s);
    acc += procSample(ps, 0.0, 0.0, false, 0.5).sigma * procCarve(ps) * s;
    t += s;
  }
  return acc * ext;
}
`;
