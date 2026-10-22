import { BILLOW_WGSL } from '../generate/shaders';
import { lightGridWgsl } from './light-grid.wgsl';
import { SKY_FIELD_WGSL, SKY_STRUCT_WGSL } from './sky-layer.wgsl';

/** Refresh pass bindings (group 1). Group 0 is the volume. The light grid takes 3 and 4. */
export const SHADOW_MAP_BINDINGS = { params: 0, outNear: 1, outFar: 2, lightGrid: 3, skyWeather: 5, skySampler: 6, skyParams: 7, procedural: 8 } as const;
/** Bytes of the CloudShadowMap uniform: 12 vec4. */
export const SHADOW_MAP_PARAM_BYTES = 192;

/**
 * Cloud shadow map (P10-A). A world-anchored 2D map of the cloud optical depth along the sun ray.
 *
 * The map plane is the cloud shell's base (the volume box's bottom face). Texel (i, j) of a cascade stands for the plane point
 * ((i + 0.5) c, (j + 0.5) c) and holds tau = the optical depth (extinction integrated, already times the light density scale) of
 * the cloud along the sun ray from that point up through the shell: the voxel box through the light grid (exact, the same value
 * the old composite path read), everything else through the sky layer's analytic cheap field (SKY_FIELD_WGSL: the model the
 * layer's own sun samples integrate). A surface below the shell base is shadowed by the texel its sun ray crosses the plane at:
 * q = p.xz + sun.xz (planeY - p.y) / sun.y, so the lookup is one projection and a bilinear fetch.
 *
 * World-anchored and toroidal: a texel's world cell is fixed (cell = floor(x / c)), its storage index is cell mod N, so the
 * window follows the camera by changing which cells it spans, never by moving data. Nothing swims when the camera moves; the
 * cells that enter the window are refreshed by the next sweep (a few frames, at the window's edge). Two cascades: the near one
 * (8 m texels, 8 km) and the far one (64 m texels, 64 km); the lookup blends near into far over the near window's outer
 * `misc.y` cells and fades the far one out at its edge.
 */
export const SHADOW_MAP_STRUCT_WGSL = /* wgsl */ `
struct CloudShadowMap {
  sun: vec4<f32>,    // xyz: unit vector toward the sun; w: height of the map plane (metres)
  near: vec4<f32>,   // cascade 0: window min cell (x, z), cell size (m), window size (cells; 0 = cascade absent)
  far: vec4<f32>,    // cascade 1, same layout
  misc: vec4<f32>,   // x: 1 when the map holds a complete refresh, y: blend width (cells), z: debug view (0 off, 1 ground outline, 2 plane outline), w: outline tau
  work: vec4<f32>,   // refresh pass: extinction, light density scale, first row, row count
  work2: vec4<f32>,  // refresh pass: sky field on (0/1), shell height (m), march steps, debug gain
  work3: vec4<f32>,  // X3 refresh pass: procedural shell min y, max y (m), march steps (0 = no procedural model), 0
  adv: vec4<f32>,    // SH1 lookup: xy = how far the clouds have moved since the stored snapshot was taken (m); the lookup reads the map at q - xy
  rsun: vec4<f32>,   // SH1 refresh pass: the sun and plane height the rows are built with (equal to \`sun\` unless the refresh runs into a back buffer)
  rnear: vec4<f32>,  // SH1 refresh pass: the window being written (cascade 0). Equal to \`near\` unless the refresh runs into a back buffer (advect)
  rfar: vec4<f32>,   // the same for cascade 1
  rshift: vec4<f32>, // SH1 refresh pass: xy = how far the clouds have moved since this sweep's snapshot time (m); the sun ray's start is moved by it
}
`;

/**
 * Consumer side: declares the uniform at `binding` and the two cascades (r32float, sampled by textureLoad) at +1 and +2 in `group`, and defines
 *   cloudShadowTau(p) -> f32     optical depth along the sun ray from a world point below the shell base (0 outside both cascades)
 *   cloudShadowValid() -> bool   false until the first complete refresh: fall back to another shadow source
 * Needs nothing else. The map holds tau; the caller turns it into light (exp(-tau), a soft mix, ...).
 */
export function cloudShadowMapWgsl(group: number, binding: number): string {
  return /* wgsl */ `
${SHADOW_MAP_STRUCT_WGSL}
@group(${group}) @binding(${binding}) var<uniform> csMap: CloudShadowMap;
@group(${group}) @binding(${binding + 1}) var csNearTex: texture_2d<f32>;
@group(${group}) @binding(${binding + 2}) var csFarTex: texture_2d<f32>;

fn cloudShadowValid() -> bool { return csMap.misc.x > 0.5; }

// Bilinear tau of one cascade at plane point q (metres); y = weight 0..1 that falls to 0 over the window's outer misc.y cells.
fn csCascade(tex: texture_2d<f32>, c: vec4<f32>, q: vec2<f32>) -> vec2<f32> {
  let n = i32(c.w);
  let u = q / max(c.z, 1e-3) - vec2(0.5);
  let b = floor(u);
  let f = u - b;
  let bi = vec2<i32>(b);
  let rel = bi - vec2<i32>(c.xy);
  if (n < 2 || any(rel < vec2<i32>(0)) || any(rel > vec2<i32>(n - 2))) { return vec2(0.0); }
  let m = vec2<i32>(n - 1);
  let i0 = bi & m;
  let i1 = (bi + vec2<i32>(1)) & m;
  let a = textureLoad(tex, vec2<i32>(i0.x, i0.y), 0).x;
  let b1 = textureLoad(tex, vec2<i32>(i1.x, i0.y), 0).x;
  let c1 = textureLoad(tex, vec2<i32>(i0.x, i1.y), 0).x;
  let d = textureLoad(tex, vec2<i32>(i1.x, i1.y), 0).x;
  let tau = mix(mix(a, b1, f.x), mix(c1, d, f.x), f.y);
  let e = min(min(rel.x, rel.y), min(n - 2 - rel.x, n - 2 - rel.y));
  return vec2(tau, saturate(f32(e) / max(csMap.misc.y, 1.0)));
}
// Q2: the far cascade (64 m texels) with a cubic B-spline instead of bilinear. A small cloud covers two or three far texels, and bilinear drew its
// ground shadow as a hard-cornered diamond (a visible pattern of squares in every view from above); the B-spline weights are smooth, so the same
// texels give a rounded blob. 16 loads, only where the near cascade does not cover.
fn csBspline(t: f32) -> vec4<f32> {
  let t2 = t * t; let t3 = t2 * t;
  return vec4((1.0 - t) * (1.0 - t) * (1.0 - t), 3.0 * t3 - 6.0 * t2 + 4.0, -3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0, t3) * (1.0 / 6.0);
}
fn csCascadeCubic(tex: texture_2d<f32>, c: vec4<f32>, q: vec2<f32>) -> vec2<f32> {
  let n = i32(c.w);
  let u = q / max(c.z, 1e-3) - vec2(0.5);
  let b = floor(u);
  let f = u - b;
  let bi = vec2<i32>(b);
  let rel = bi - vec2<i32>(c.xy);
  if (n < 4 || any(rel < vec2<i32>(1)) || any(rel > vec2<i32>(n - 3))) { return csCascade(tex, c, q); }
  let m = vec2<i32>(n - 1);
  let wx = csBspline(f.x);
  let wy = csBspline(f.y);
  var tau = 0.0;
  for (var j = 0; j < 4; j++) {
    var row = 0.0;
    for (var i = 0; i < 4; i++) { row += wx[i] * textureLoad(tex, (bi + vec2<i32>(i - 1, j - 1)) & m, 0).x; }
    tau += wy[j] * row;
  }
  let e = min(min(rel.x, rel.y), min(n - 2 - rel.x, n - 2 - rel.y));
  return vec2(tau, saturate(f32(e) / max(csMap.misc.y, 1.0)));
}
// The point where the sun ray through world point p crosses the map plane.
fn cloudShadowPlanePoint(p: vec3<f32>) -> vec2<f32> {
  let s = csMap.sun.xyz;
  return p.xz + s.xz * ((csMap.sun.w - p.y) / s.y);
}
fn cloudShadowTauQ(q0: vec2<f32>) -> f32 {
  // SH1: the stored snapshot is older than now; the clouds have moved by adv.xy since, so what is at q now was at q - adv.xy then.
  let q = q0 - csMap.adv.xy;
  let n = csCascade(csNearTex, csMap.near, q);
  var f = vec2(0.0);
  if (n.y < 1.0) { f = csCascadeCubic(csFarTex, csMap.far, q); }
  return n.x * n.y + (1.0 - n.y) * f.x * f.y;
}
fn cloudShadowTau(p: vec3<f32>) -> f32 { return cloudShadowTauQ(cloudShadowPlanePoint(p)); }

// Debug: 1 on the outline of the tau = misc.w iso-contour at plane point q (about two near-cascade texels wide).
fn cloudShadowOutline(q: vec2<f32>) -> f32 {
  let e = max(csMap.near.z, 1.0);
  let thr = csMap.misc.w;
  let c = cloudShadowTauQ(q) > thr;
  var o = array<vec2<f32>, 4>(vec2(e, 0.0), vec2(-e, 0.0), vec2(0.0, e), vec2(0.0, -e));
  var edge = false;
  for (var i = 0; i < 4; i++) { if ((cloudShadowTauQ(q + o[i]) > thr) != c) { edge = true; } }
  return select(0.0, 1.0, edge);
}
`;
}

/**
 * Refresh pass. Concatenate COMMON_WGSL + volumeWgsl(0) + shadowMapWgsl(procedural).
 * X3: `procedural` is a procedural density model's WGSL (ProceduralDensityModel.densityWgsl(1, SHADOW_MAP_BINDINGS.procedural)); its clouds are
 * integrated too (the cheap density, midpoint steps over the model's shell, work3), so they cast ground shadows like the sky layer's. Dispatch (ceil(N / 8), ceil(rows / 8), cascades): one thread
 * per texel of the row range [work.z, work.z + work.w) of each cascade. Marches the sun ray over the shell with a fixed step (the
 * same texel always takes the same samples, so the map is stable between refreshes), skipping empty space through the sky field's
 * own conservative skip distances and its coverage-maxima mips.
 */
export function shadowMapWgsl(procedural?: string): string {
  return /* wgsl */ `
${SHADOW_MAP_STRUCT_WGSL}
@group(1) @binding(${SHADOW_MAP_BINDINGS.params}) var<uniform> csMap: CloudShadowMap;
@group(1) @binding(${SHADOW_MAP_BINDINGS.outNear}) var csOutNear: texture_storage_2d<r32float, write>;
@group(1) @binding(${SHADOW_MAP_BINDINGS.outFar}) var csOutFar: texture_storage_2d<r32float, write>;
${lightGridWgsl(1, SHADOW_MAP_BINDINGS.lightGrid)}
@group(1) @binding(${SHADOW_MAP_BINDINGS.skyWeather}) var skyWeather: texture_2d<f32>;
@group(1) @binding(${SHADOW_MAP_BINDINGS.skySampler}) var skySampler: sampler;
@group(1) @binding(${SHADOW_MAP_BINDINGS.skyParams}) var<uniform> SKY: SkyParams;
${SKY_STRUCT_WGSL}
${BILLOW_WGSL}
${SKY_FIELD_WGSL}
${procedural ?? ''}

const CS_MAX_RAY = 60000.0;

fn csIntegrate(q: vec2<f32>) -> f32 {
  let sun = csMap.rsun.xyz;
  // SH1: with a snapshot time (rshift), the ray starts where the clouds were at that time: moved back by the displacement since.
  let p0 = vec3(q.x + csMap.rshift.x, csMap.rsun.w, q.y + csMap.rshift.y);
  var tau = 0.0;
  // The voxel box: the light grid already holds the sun optical depth from every voxel to the box exit. Read it just inside the
  // entry point (one voxel and a half in, so the trilinear tap is not half clamped to the zero outside), as the old composite path did.
  let iv = volumeRayInterval(p0, sun);
  if (iv.x <= iv.y && iv.y > 0.0) {
    let t0 = max(iv.x, 0.0);
    let t = min(t0 + 1.5 * cloudVolume.voxelSize, 0.5 * (t0 + iv.y));
    tau += lightGridSample(p0 + sun * t).x * csMap.work.y;
  }
  // Everything outside the box: the sky layer's cheap field (profile * density scale) times the layer's extinction. skyModel with light = false
  // reports the box interior as empty (the grid covered it).
  if (csMap.work2.x > 0.5) {
    let ext = csMap.work.x * SKY.shapeC.z * csMap.work.y;
    let len = min(csMap.work2.y / max(sun.y, 0.02), CS_MAX_RAY);
    let step = len / max(csMap.work2.z, 1.0);
    var t = 0.0;
    for (var i = 0u; i < 192u; i++) {
      if (t >= len) { break; }
      let ds = min(step, len - t);
      let tm = t + 0.5 * ds;
      let ps = p0 + sun * tm;
      let sp = skyModel(ps, -1.0, false);
      let d = sp.m.x * sp.m.z;
      if (d > 0.0) {
        tau += d * ds * ext;
        t += ds;
      } else {
        var adv = max(ds, sp.skip);
        if (sp.empty2d) { adv = max(adv, skyEmptySkip(ps, sun)); }
        t = tm + adv - 0.5 * ds;
      }
    }
  }
${procedural ? `  // X3: the procedural model's clouds between its shell's base and top (a little higher for the curvature drop out to the far cascade).
  if (csMap.work3.z > 0.0) {
    let ta = max((csMap.work3.x - p0.y) / sun.y, 0.0);
    let tb = min((csMap.work3.y + 150.0 - p0.y) / sun.y, CS_MAX_RAY);
    let n = csMap.work3.z;
    let ds = (tb - ta) / n;
    let ext = P.misc.x * P.misc.y;   // the model's extinction and light scale (its own light taps use the same)
    for (var i = 0.0; i < n; i += 1.0) {
      let ps = p0 + sun * (ta + (i + 0.5) * ds);
      tau += procSample(ps, 0.0, 0.0, false, 0.5).sigma * procCarve(ps) * ext * ds;
    }
  }` : ''}
  return tau;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let casc = gid.z;
  let c = select(csMap.rnear, csMap.rfar, casc == 1u);
  let n = i32(c.w);
  if (n < 2 || gid.x >= u32(n) || gid.y >= u32(csMap.work.w)) { return; }
  let sx = i32(gid.x);
  let sy = i32(csMap.work.z) + i32(gid.y);
  let m = vec2<i32>(c.xy);
  let mask = n - 1;
  // The world cell the storage texel (sx, sy) holds while the window starts at cell m: the one congruent to it mod n inside the window.
  let cell = vec2<i32>(m.x + ((sx - m.x) & mask), m.y + ((sy - m.y) & mask));
  let q = (vec2<f32>(cell) + 0.5) * c.z;
  let tau = csIntegrate(q);
  if (casc == 0u) { textureStore(csOutNear, vec2<i32>(sx, sy), vec4(tau, 0.0, 0.0, 0.0)); }
  else { textureStore(csOutFar, vec2<i32>(sx, sy), vec4(tau, 0.0, 0.0, 0.0)); }
}
`;
}

/** Bindings of the blend pass (group 0). */
export const SHADOW_BLEND_BINDINGS = { params: 0, prevNear: 1, prevFar: 2, freshNear: 3, freshFar: 4, outNear: 5, outFar: 6 } as const;
/** Bytes of the blend uniform: 5 vec4. */
export const SHADOW_BLEND_PARAM_BYTES = 80;

/**
 * SH1 blend pass: after a sweep lands, the map eases from the old snapshot to the new one instead of switching (the switch would pop, the clouds
 * having changed shape since). One thread per texel of each cascade (dispatch (N / 8, N / 8, cascades)): out = mix(prev(q - shift), fresh(q), t) where
 * q is the texel's plane point in the new window, prev is the old snapshot (its own window and cell size, bilinear, toroidal) carried to the new
 * snapshot's moment by `shift` (the clouds' displacement between the two moments), and fresh is the new snapshot (same window as the output).
 * Where prev does not cover q the output is fresh. t = 1 copies fresh.
 *   u.prevNear / u.prevFar / u.newNear / u.newFar: window min cell (x, z), cell size (m), window size (cells; 0 = cascade absent)
 *   u.misc: xy = shift (m), z = t
 */
export function shadowBlendWgsl(): string {
  return /* wgsl */ `
struct ShadowBlend { prevNear: vec4<f32>, newNear: vec4<f32>, prevFar: vec4<f32>, newFar: vec4<f32>, misc: vec4<f32> }
@group(0) @binding(${SHADOW_BLEND_BINDINGS.params}) var<uniform> u: ShadowBlend;
@group(0) @binding(${SHADOW_BLEND_BINDINGS.prevNear}) var prevNearTex: texture_2d<f32>;
@group(0) @binding(${SHADOW_BLEND_BINDINGS.prevFar}) var prevFarTex: texture_2d<f32>;
@group(0) @binding(${SHADOW_BLEND_BINDINGS.freshNear}) var freshNearTex: texture_2d<f32>;
@group(0) @binding(${SHADOW_BLEND_BINDINGS.freshFar}) var freshFarTex: texture_2d<f32>;
@group(0) @binding(${SHADOW_BLEND_BINDINGS.outNear}) var outNear: texture_storage_2d<r32float, write>;
@group(0) @binding(${SHADOW_BLEND_BINDINGS.outFar}) var outFar: texture_storage_2d<r32float, write>;

// Bilinear tau of the old snapshot at plane point q, and whether its window covers q.
fn prevTau(tex: texture_2d<f32>, pw: vec4<f32>, q: vec2<f32>) -> vec2<f32> {
  let n = i32(pw.w);
  if (n < 2) { return vec2(0.0); }
  let uu = q / max(pw.z, 1e-3) - vec2(0.5);
  let b = floor(uu);
  let f = uu - b;
  let bi = vec2<i32>(b);
  let rel = bi - vec2<i32>(pw.xy);
  if (any(rel < vec2<i32>(0)) || any(rel > vec2<i32>(n - 2))) { return vec2(0.0); }
  let m = vec2<i32>(n - 1);
  let i0 = bi & m;
  let i1 = (bi + vec2<i32>(1)) & m;
  let a = textureLoad(tex, vec2<i32>(i0.x, i0.y), 0).x;
  let b1 = textureLoad(tex, vec2<i32>(i1.x, i0.y), 0).x;
  let c1 = textureLoad(tex, vec2<i32>(i0.x, i1.y), 0).x;
  let d = textureLoad(tex, vec2<i32>(i1.x, i1.y), 0).x;
  return vec2(mix(mix(a, b1, f.x), mix(c1, d, f.x), f.y), 1.0);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let casc = gid.z;
  let pw = select(u.prevNear, u.prevFar, casc == 1u);
  let nw = select(u.newNear, u.newFar, casc == 1u);
  let n = i32(nw.w);
  if (n < 2 || gid.x >= u32(n) || gid.y >= u32(n)) { return; }
  let s = vec2<i32>(gid.xy);
  let m = vec2<i32>(nw.xy);
  let mask = n - 1;
  let cell = vec2<i32>(m.x + ((s.x - m.x) & mask), m.y + ((s.y - m.y) & mask));
  let q = (vec2<f32>(cell) + 0.5) * nw.z;
  var fresh = 0.0;
  if (casc == 0u) { fresh = textureLoad(freshNearTex, s, 0).x; } else { fresh = textureLoad(freshFarTex, s, 0).x; }
  var v = fresh;
  let t = u.misc.z;
  if (t < 1.0) {
    var p = vec2(0.0);
    if (casc == 0u) { p = prevTau(prevNearTex, pw, q - u.misc.xy); } else { p = prevTau(prevFarTex, pw, q - u.misc.xy); }
    if (p.y > 0.5) { v = mix(p.x, fresh, t); }
  }
  if (casc == 0u) { textureStore(outNear, s, vec4(v, 0.0, 0.0, 0.0)); } else { textureStore(outFar, s, vec4(v, 0.0, 0.0, 0.0)); }
}
`;
}
