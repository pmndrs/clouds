import { BILLOW_WGSL } from '../generate/shaders';
import { atmosphereWgsl } from './atmosphere.wgsl';
import { FRAME_WGSL } from './frame.wgsl';
import { LIGHTING_WGSL } from './lighting.wgsl';
import { MARCH_ATMOSPHERE_GROUP, MARCH_RADIANCE_LIMIT } from './march.wgsl';

/** Group 1 bindings of the sky trace pass (0 Frame and 1 scene depth come from FRAME_WGSL). */
export const SKY_COLOR_BINDING = 2;
export const SKY_DEPTH_BINDING = 3;
export const SKY_WEATHER_BINDING = 4;
export const SKY_SAMPLER_BINDING = 5;
export const SKY_LIGHT_STORAGE_BINDING = 6;
export const SKY_PARAMS_BINDING = 7;
/** The part of the layer behind the voxel box (see the handoff note below). */
export const SKY_BACK_BINDING = 8;
/** Group 1 bindings of the resolve pass (0 Frame, 1 scene depth as above). */
export const SKY_RESOLVE_BINDINGS = {
  trace: 4, traceDepth: 5, hist: 6, histDepth: 7, histOut: 8, histDepthOut: 9, params: 10, sampler: 11, traceBack: 13, histBack: 14, histBackOut: 15,
} as const;
/** SkyParams uniform: 10 vec4 + mat4 + 2 vec4 = 64 floats. */
export const SKY_PARAM_FLOATS = 64;
export const SKY_PARAM_BYTES = SKY_PARAM_FLOATS * 4;
/** Temporal amortization: one pixel of every 4x4 block per frame, 16 frames per cycle. */
export const SKY_TEMPORAL_PERIOD = 16;

/**
 * Distant sky layer: the Nubis vertical-profile (2.5D) method [N3 s18, s44]. A cloud shell [shellMin, shellMax] around the whole
 * world, driven by the same world-anchored weather field as the generator (a baked window of weather.ts, uv = (xz - boxMin) / boxSize)
 * and the generator's own shaping law (generate/shaders.ts SHAPE: f = s - h^p + billow, flat base lifted toward lobe rims), turned
 * into the (profile, detail type, density scale) triple analytically instead of through a voxel SDF:
 *
 *   depth below the surface = f / |grad f|   (first-order Euclidean distance; exact for a locally planar level set)
 *
 * P3-C1 used f * depthScale, i.e. assumed a constant gradient. The billow switches on over 0.25 of f (the `near` ramp), where the
 * gradient is up to 5x the smooth field's, so one step across the surface landed 60 m "deep" and fully dense: the vertical cliffs.
 * grad f is analytic: the smooth part from the bilinear coverage gradient (one textureGather gives the four texels, so the value
 * and its gradient are exact and consistent), the billow from the Worley offset vectors (|grad F1| = 1 / cell). The profile then
 * gets the generator's own multiplicative depth noise and PACK_FIT formulas, and goes through the SAME up-rez (cloudDensityShaped)
 * and the SAME lighting chunk (LIGHTING_WGSL) as the voxel march. There is no light grid out here: the sun optical depth is two
 * in-line up-rez samples plus six cheap samples of the smooth field along the sun ray (48..470 m), the ambient 'up' term three
 * cheap samples straight up (0..272 m).
 *
 * Handoff with the voxel box (rimWidth = 0, the default when the generator's weather border is 0): the field is one continuous
 * weather map; view rays skip the box interior (the voxel march renders it) and pick the same field up at the wall. The ray's
 * result is written as two premultiplied layers, the part in front of the box and the part behind it, so the composite can order
 * sky-front / voxel / sky-back exactly (a single mean distance cannot order interleaved layers: P3-C1's per-pixel ordering test
 * flipped along contours and left chains of bright dots). Light samples are not masked, so sky cloud next to the wall is shadowed
 * by the cloud inside the box. rimWidth > 0 keeps the P3-C1 cross-fade (then the split is the middle of the box interval).
 *
 * Temporal amortization [N3 s44]: `trace` renders one pixel of every 4x4 block per frame (Bayer order, all pixels on a reset);
 * `resolve` fills the rest by reprojecting the previous resolved frame through the cloud mean distance, clamped to the min/max of the
 * nine fresh samples around the pixel in proportion to how far the pixel moved, and blends fresh samples into the history (the
 * jitter changes every 16-frame cycle, so the history converges to a jitter-averaged image: no static hatch).
 * Trace: concatenate COMMON_WGSL + volumeWgsl(0) + DENSITY_WGSL + skyLayerWgsl(mode). Group 1 as above, group 2 the atmosphere.
 */
/** The SkyParams struct and the Bayer helpers: needs no other WGSL (the cloud shadow map includes just this). */
export const SKY_STRUCT_WGSL = /* wgsl */ `
struct SkyParams {
  window: vec4<f32>,   // weather window: min x, min z, size x, size z (world metres)
  box: vec4<f32>,      // volume box: min x, min z, size x, size z
  shell: vec4<f32>,    // minY, maxY, maxDistance, curvature (1/(2R), 0 = flat)
  shapeA: vec4<f32>,   // topFrac, domeExp, baseDefault, baseLift
  shapeB: vec4<f32>,   // coverageThreshold, (unused), scaleBase, scaleTop
  shapeC: vec4<f32>,   // detailBias, rimWidth (m; 0 = hard partition at the box wall, < 0 = no mask), extinction multiplier, window edge fade (fraction)
  steps: vec4<f32>,    // stepMin (m), stepRel (per m of distance), maxSteps, transmittance cutoff
  billow: vec4<f32>,   // generator billow: amplitude, first cell (m), seed (as given to the generator), debug view
  extra: vec4<f32>,    // voxel size (m, profile noise scale), profileSigma, billow LOD scale, temporal blend of a fresh sample
  temporal: vec4<f32>, // phase (0..15), cycle (jitter seed), full trace (1 = every pixel), 0
  prevViewProj: mat4x4<f32>,
  prevCam: vec4<f32>,  // previous camera position, w = 1 when the history is valid
  wOrigin: vec4<f32>,  // P7-E: world position (x, z) of the weather map's uv origin: the billow and shape noise are anchored there (default: the box min corner)
}
const BAYER4 = array<u32, 16>(0u, 8u, 2u, 10u, 12u, 4u, 14u, 6u, 3u, 11u, 1u, 9u, 15u, 7u, 13u, 5u);
fn bayerIndex(px: vec2<i32>) -> u32 { return BAYER4[u32(px.y & 3) * 4u + u32(px.x & 3)]; }
// Position inside a 4x4 block of the pixel traced at this phase.
fn bayerPos(phase: u32) -> vec2<i32> {
  for (var i = 0u; i < 16u; i++) { if (BAYER4[i] == phase) { return vec2<i32>(i32(i & 3u), i32(i >> 2u)); } }
  return vec2<i32>(0);
}
`;
/** skySceneEnd: needs FRAME_WGSL. */
export const SKY_SCENE_END_WGSL = /* wgsl */ `
// Farthest scene distance over the output pixels a layer pixel covers.
fn skySceneEnd(px: vec2<i32>, uv: vec2<f32>) -> f32 {
  let ratio = frame.outputSize / frame.renderSize;
  let lo = vec2<i32>(floor(vec2<f32>(px) * ratio));
  let hi = min(vec2<i32>(ceil(vec2<f32>(px + vec2<i32>(1)) * ratio)) - vec2<i32>(1), lo + vec2<i32>(7));
  let dmax = vec2<i32>(textureDimensions(sceneDepth)) - vec2<i32>(1);
  var depth = 0.0;
  for (var y = lo.y; y <= hi.y; y++) {
    for (var x = lo.x; x <= hi.x; x++) { depth = max(depth, textureLoad(sceneDepth, min(vec2<i32>(x, y), dmax), 0)); }
  }
  return sceneDistance(depth, uv);
}
`;
export const SKY_PARAMS_WGSL = SKY_STRUCT_WGSL + SKY_SCENE_END_WGSL;

/** The analytic sky field shared by the layer's trace and the reflection dome: the generator's shape law evaluated from the baked weather window.
 * The includer declares `SKY` (SkyParams), `skyWeather` and `skySampler`, and provides BILLOW_WGSL and COMMON_WGSL. */
export const SKY_FIELD_WGSL = /* wgsl */ `
// The generator's billow envelope: on over f00 in (NEAR_A, NEAR_B), off again over (NEAR_C, NEAR_D).
const NEAR_A = -0.55;
const NEAR_B = -0.3;
const NEAR_C = 0.18;
const NEAR_D = 0.45;
// Below this value of the smooth field the billow (<= 0.77 in f) cannot lift the surface up to the sample.
const SKY_BILLOW_REACH = -0.46;

fn dsmooth(a: f32, b: f32, x: f32) -> f32 {
  let t = saturate((x - a) / (b - a));
  return 6.0 * t * (1.0 - t) / (b - a);
}
fn nearRamp(x: f32) -> f32 { return (1.0 - smoothstep(NEAR_C, NEAR_D, x)) * smoothstep(NEAR_A, NEAR_B, x); }
fn dnearRamp(x: f32) -> f32 {
  return (1.0 - smoothstep(NEAR_C, NEAR_D, x)) * dsmooth(NEAR_A, NEAR_B, x) - smoothstep(NEAR_A, NEAR_B, x) * dsmooth(NEAR_C, NEAR_D, x);
}
// Where the surface sits in smooth-field units for a frozen local billow: the root of F(x) = x + K nearRamp(x), K = A b topW.
// F is monotone where the root lies (K > 0: on the rising ramp, K < 0: on the falling one), so a few Newton steps converge.
fn surfaceF00(K: f32) -> f32 {
  var x = clamp(-0.5 * K, -0.45, 0.45);
  for (var i = 0; i < 4; i++) {
    let F = x + K * nearRamp(x);
    let Fp = max(1.0 + K * dnearRamp(x), 0.3);
    x = clamp(x - F / Fp, NEAR_A, 0.6);
  }
  return x;
}

// The generator's smooth shape field at coverage cov and shell height fraction hz: f = s - g(h) (generate/shaders.ts shapeAt).
struct Smooth { f: f32, s: f32, h: f32, base: f32, hcol: f32 }
fn skySmooth(cov: f32, hz: f32) -> Smooth {
  var r: Smooth;
  let thr = SKY.shapeB.x;
  r.s = saturate((cov - thr) / (1.0 - thr));
  r.base = SKY.shapeA.z + SKY.shapeA.w * pow(1.0 - r.s, 1.5);
  r.h = (hz - r.base) / max(SKY.shapeA.x - r.base, 1e-3);
  let g = select(-r.h * 24.0, pow(max(r.h, 0.0), SKY.shapeA.y), r.h >= 0.0);
  r.f = r.s - g;
  r.hcol = clamp(r.h / pow(max(r.s, 0.05), 1.0 / SKY.shapeA.y), 0.0, 1.0);
  return r;
}

// Worley F1 with the offset to the nearest feature point (xyz = c - q in cell units, w = F1).
fn worleyF1v(q: vec3<f32>, s: u32) -> vec4<f32> {
  let i = vec3<i32>(floor(q));
  let f = fract(q);
  var m = 4.0;
  var best = vec3(0.0);
  for (var z = -1; z <= 1; z++) { for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let o = vec3<i32>(x, y, z);
    let d = vec3<f32>(o) + hash3f(i + o, s) - f;
    let dd = dot(d, d);
    if (dd < m) { m = dd; best = d; }
  } } }
  return vec4(best, sqrt(m));
}
// The generator's billow (billowAt: same octaves, seeds, offsets and normalisation): xyz = its gradient per metre (in pm axis
// order x, z, y), w = the value. Octaves fade out by distance instead of switching, so no surface is displaced at a threshold:
// octave 2 (cell/4) over 5..10 km, octave 1 over 12..24 km (times the LOD scale).
fn billowGrad(pm: vec3<f32>, cell0: f32, s0: u32, dist: f32) -> vec4<f32> {
  let lod = max(SKY.extra.z, 1e-3);
  let w1 = 1.0 - smoothstep(12000.0 * lod, 24000.0 * lod, dist);
  let w2 = 1.0 - smoothstep(5000.0 * lod, 10000.0 * lod, dist);
  var a = 0.0; var wsum = 0.0; var amp = 0.55; var cell = cell0;
  var g = vec3(0.0);
  for (var o = 0u; o < 3u; o++) {
    let lw = select(select(w2, w1, o == 1u), 1.0, o == 0u);
    if (lw > 0.0) {
      let r = worleyF1v(pm / cell + vec3<f32>(f32(o) * 7.3, f32(o) * 3.1, 0.0), s0 + o * 17u);
      let v = 1.0 - clamp(r.w * 1.1, 0.0, 1.0);
      a += lw * amp * v; wsum += lw * amp;
      // d(1 - 1.1 |q - c|)/dq = 1.1 (c - q) / |c - q|, per metre: / cell. The value has a kink where the clamp bites
      // (1.1 F1 = 1); ramping the gradient to zero there keeps |grad f| (so the depth) continuous.
      if (r.w > 1e-4) { g += lw * amp * (1.1 / (cell * r.w)) * (1.0 - smoothstep(0.85, 1.0, r.w * 1.1)) * r.xyz; }
    }
    cell *= 0.5; amp *= 0.55;
  }
  return vec4(g / wsum, a / wsum - 0.36);
}

// Analytic (profile, detail type, density scale) at a world point, the Euclidean depth below the surface, the shape field f
// (> 0 inside) and a conservative skip distance (metres) for empty space. lodDistance < 0 drops the billow (the smooth field:
// cheap light samples, debug). light = true: the box is never masked (light samples see the cloud inside the box too).
// bGiven / useGiven: reuse this billow evaluation (gradient, value) instead of evaluating the Worley octaves: the in-line sun
// samples sit 8-32 m from the view sample, well under the finest octave's cell, so its billow stands in for theirs.
struct SkyModel { m: vec3<f32>, depth: f32, hz: f32, skip: f32, f: f32, b: vec4<f32>, empty2d: bool }

fn skyModel(p0: vec3<f32>, lodDistance: f32, light: bool) -> SkyModel {
  return skyModelB(p0, lodDistance, light, vec4(0.0), false);
}
fn skyModelB(p0: vec3<f32>, lodDistance: f32, light: bool, bGiven: vec4<f32>, useGiven: bool) -> SkyModel {
  var r: SkyModel;
  r.m = vec3(0.0); r.depth = 0.0; r.skip = 0.0; r.f = -1.0; r.b = vec4(0.0); r.empty2d = false;
  let shellH = max(SKY.shell.y - SKY.shell.x, 1.0);
  // Planet curvature: the shell drops away from the box centre.
  let c = p0.xz - (SKY.box.xy + SKY.box.zw * 0.5);
  let p = vec3(p0.x, p0.y + SKY.shell.w * dot(c, c), p0.z);
  r.hz = (p.y - SKY.shell.x) / shellH;
  if (r.hz < -0.02 || r.hz > 1.02) { r.skip = 4.0; return r; }
  let wuv = (p.xz - SKY.window.xy) / SKY.window.zw;
  if (any(wuv <= vec2(0.0)) || any(wuv >= vec2(1.0))) { r.skip = 2000.0; return r; }
  // Box handoff (view rays only).
  let bmax = SKY.box.xy + SKY.box.zw;
  let e = min(min(p.x - SKY.box.x, bmax.x - p.x), min(p.z - SKY.box.y, bmax.y - p.z));
  let rim = SKY.shapeC.y;
  var rimFade = 1.0;
  if (!light) {
    if (rim > 0.0) {
      if (e > rim) { r.skip = e - rim; return r; }
      rimFade = 1.0 - smoothstep(0.0, rim, e);
    } else if (rim == 0.0 && e > 0.0) {
      r.skip = e; return r;   // hard partition: the voxel march renders the inside, the first sample past the wall is ours
    }
  }
  // Coverage: the bilinear value from the sampler; its gradient from the four texels of the footprint in one gather
  // (w = (i, j), z = (i+1, j), x = (i, j+1), y = (i+1, j+1)). The value is not rebuilt from the gather: the sampler's fixed-point
  // footprint occasionally picks the neighbouring quad, which would scatter one-texel coverage errors into the clouds.
  let dims = vec2<f32>(textureDimensions(skyWeather, 0));
  let texel = SKY.window.zw / dims;
  let st = fract(wuv * dims - 0.5);
  let w = textureSampleLevel(skyWeather, skySampler, wuv, 0.0);
  let g4 = textureGather(0, skyWeather, skySampler, wuv);
  let edgeW = min(min(wuv.x, 1.0 - wuv.x), min(wuv.y, 1.0 - wuv.y));
  let fade = smoothstep(0.0, max(SKY.shapeC.w, 1e-4), edgeW) * rimFade;
  let cov = w.r * fade;
  let thr = SKY.shapeB.x;
  if (cov <= thr) { r.skip = max((thr - cov) * 80.0, 2.0); r.empty2d = true; return r; }   // the caller skips further through the coverage mips
  let dcov = vec2(mix(g4.z - g4.w, g4.y - g4.x, st.y), mix(g4.x - g4.w, g4.y - g4.z, st.x)) * fade / texel;   // per metre (x, z)
  let sm = skySmooth(cov, r.hz);
  // Gradient of the smooth field: xz through the coverage gradient, y analytic.
  let dfdc = (skySmooth(cov + 0.01, r.hz).f - sm.f) * 100.0;
  let hUnit = max(SKY.shapeA.x - sm.base, 1e-3) * shellH;
  let gp = select(24.0, SKY.shapeA.y * pow(max(sm.h, 1e-4), SKY.shapeA.y - 1.0), sm.h >= 0.0);
  var grad = vec3(dfdc * dcov.x, -gp / hUnit, dfdc * dcov.y);
  var f0 = sm.f;
  // Signed distance to the surface in smooth-field units (positive inside) and the gradient of that quantity.
  var fs = sm.f;
  let pm = vec3(p.x - SKY.wOrigin.x, p.z - SKY.wOrigin.y, p.y - SKY.shell.x);
  let withBillow = lodDistance >= 0.0 && SKY.billow.x > 0.0;
  if (withBillow && sm.f > NEAR_A && sm.f < 0.5) {
    let b = select(billowGrad(pm, SKY.billow.y, u32(SKY.billow.z * 131.0), lodDistance), bGiven, useGiven);
    r.b = b;
    let A = SKY.billow.x * 3.0;
    let topW = mix(0.45, 1.0, smoothstep(0.1, 0.7, sm.hcol)) * (1.0 - smoothstep(0.82, 1.0, sm.h));
    let K = A * b.w * topW;
    f0 = sm.f + K * nearRamp(sm.f);
    // The billow moves the surface to x_s(K) in smooth-field units; the distance is measured as f00 - x_s, whose gradient
    // is the smooth gradient plus the billow's through dx_s/db (implicit differentiation). Measuring f0 / |grad f0| instead
    // would scale the depth by the ramp's own derivative (up to 5x across the ramp): terraced rings on every lobe.
    let xs = surfaceF00(K);
    fs = sm.f - xs;
    let Fp = max(1.0 + K * dnearRamp(xs), 0.3);
    grad = grad + (A * nearRamp(xs) * topW / Fp) * vec3(b.x, b.z, b.y);
  } else if (withBillow && sm.f < SKY_BILLOW_REACH) {
    // Far outside the billow's reach: skip by the smooth field's distance to where the billow could first surface.
    r.f = f0;
    r.skip = max((SKY_BILLOW_REACH - sm.f) / max(1.5 * length(grad), 1e-3), 4.0);
    return r;
  }
  r.f = f0;
  let gl = max(length(grad), 1e-4);
  if (fs <= 0.0 || sm.h >= 1.5) {
    // Empty: first-order distance to the surface, with slack for the gradient growing along the way.
    r.skip = max(-fs / max(1.5 * gl, 0.012), 2.0);
    return r;
  }
  // Metres below the surface: the dome (top and sides) from the field, capped by the column's vertical distances to its base
  // surface (h = -s/24) and to its top (h = s_eff^(1/p), s_eff including the billow). The first-order estimate alone blows up
  // where the gradient vanishes, i.e. along the ridge of a thin skirt at a lobe's edge: those skirts rendered as dense slabs.
  let hBase = sm.h + sm.s / 24.0;
  let hTop = pow(max(sm.s + (f0 - sm.f), 0.0), 1.0 / SKY.shapeA.y) - sm.h;
  let depth = max(min(fs / gl, min(hBase, hTop) * hUnit), 0.0);
  r.depth = depth;
  // The generator's PACK_FIT profile with its multiplicative depth noise (same noise, same coordinates and seed); the cheap
  // light samples skip the noise (it averages out along a light ray).
  var dEff = depth;
  if (lodDistance >= 0.0) {
    let n = clamp(profileNoise(pm, SKY.extra.x, u32(SKY.billow.z * 53.0)) * 3.4, -2.5, 2.5);
    dEff = depth * exp(SKY.extra.y * n);
  }
  let core = pow(clamp((dEff - 1.4) / 66.0, 0.0, 1.0), 1.05);
  let lift = 0.1 + 0.9 * smoothstep(0.0, 0.22, sm.hcol);
  let profile = max(core * lift, 1.0 / 255.0);
  let scale = clamp(mix(SKY.shapeB.z, SKY.shapeB.w, smoothstep(0.0, 0.6, sm.hcol)), 0.0, 1.0);
  let detail = clamp(smoothstep(0.1, 0.75, sm.hcol - 0.25 * clamp(depth / 32.0, 0.0, 1.0)) + (w.g - 0.5) * SKY.shapeC.x, 0.0, 1.0);
  r.m = vec3(profile, detail, scale);
  return r;
}

// The cheap term (profile * density scale) of the smooth field, the one the voxel light grid sums.
fn skyModelCheap(p: vec3<f32>) -> f32 {
  let sm = skyModel(p, -1.0, true);
  return sm.m.x * sm.m.z;
}

// Empty-space skip through the coverage maxima mips (levels 1..SKY_MIP_TOP of the weather window hold the max of their 2x2):
// the largest texel around p whose maximum coverage is under the threshold is cloud-free, so the ray can jump to its far side
// (in xz; the shell is thin). Returns 0 when no such texel exists. Bilinear sampling at level 0 reads half a fine texel beyond
// the border, hence the margin.
const SKY_MIP_TOP = 6;
fn skyEmptySkip(p: vec3<f32>, dir: vec3<f32>) -> f32 {
  let wuv = (p.xz - SKY.window.xy) / SKY.window.zw;
  if (any(wuv <= vec2(0.0)) || any(wuv >= vec2(1.0))) { return 0.0; }
  let dims0 = vec2<i32>(textureDimensions(skyWeather, 0));
  let thr = SKY.shapeB.x;
  let texel0 = SKY.window.zw / vec2<f32>(dims0);
  for (var k = SKY_MIP_TOP; k >= 1; k--) {
    let dims = max(dims0 >> vec2<u32>(u32(k)), vec2<i32>(1));
    let tc = clamp(vec2<i32>(floor(wuv * vec2<f32>(dims))), vec2<i32>(0), dims - vec2<i32>(1));
    if (textureLoad(skyWeather, tc, k).r <= thr) {
      let texel = SKY.window.zw / vec2<f32>(dims);
      let lo = SKY.window.xy + vec2<f32>(tc) * texel;
      let hi = lo + texel;
      var t = 1.0e9;
      if (dir.x > 1e-6) { t = min(t, (hi.x - p.x) / dir.x); } else if (dir.x < -1e-6) { t = min(t, (lo.x - p.x) / dir.x); }
      if (dir.z > 1e-6) { t = min(t, (hi.y - p.z) / dir.z); } else if (dir.z < -1e-6) { t = min(t, (lo.y - p.z) / dir.z); }
      return max(t - 0.75 * max(texel0.x, texel0.y), 0.0);
    }
  }
  return 0.0;
}

`;

export function skyLayerWgsl(mode: 'atmosphere' | 'uniform'): string {
  const atm = mode === 'atmosphere';
  return /* wgsl */ `
${FRAME_WGSL}
${SKY_PARAMS_WGSL}
@group(1) @binding(${SKY_COLOR_BINDING}) var skyColorOut: texture_storage_2d<rgba16float, write>;
@group(1) @binding(${SKY_DEPTH_BINDING}) var skyDepthOut: texture_storage_2d<rg32float, write>;
@group(1) @binding(${SKY_WEATHER_BINDING}) var skyWeather: texture_2d<f32>;
@group(1) @binding(${SKY_SAMPLER_BINDING}) var skySampler: sampler;
@group(1) @binding(${SKY_LIGHT_STORAGE_BINDING}) var<storage, read> skyLight: array<vec4<f32>, 3>;
@group(1) @binding(${SKY_PARAMS_BINDING}) var<uniform> SKY: SkyParams;
@group(1) @binding(${SKY_BACK_BINDING}) var skyBackOut: texture_storage_2d<rgba16float, write>;
${atm ? atmosphereWgsl(MARCH_ATMOSPHERE_GROUP) : ''}
${LIGHTING_WGSL}
${BILLOW_WGSL}

const SKY_HALTON_BASE = 1u;
const SKY_SUBPIXEL_SPAN = 2.0;   // jitter range in layer pixels
fn radicalInverse(i0: u32, base: u32) -> f32 {
  var i = i0; var f = 1.0; var r = 0.0;
  let b = f32(base);
  for (var k = 0; k < 8 && i > 0u; k++) { f = f / b; r += f * f32(i % base); i = i / base; }
  return r;
}
// Cheap sun samples beyond the in-line ones (segment midpoints and lengths, metres from the sample), then the 'up' ones.
const SKY_SUN_T = array<f32, 6>(64.0, 100.0, 145.0, 205.0, 285.0, 400.0);
const SKY_SUN_L = array<f32, 6>(32.0, 40.0, 50.0, 70.0, 90.0, 140.0);
const SKY_UP_T = array<f32, 3>(24.0, 80.0, 192.0);
const SKY_UP_L = array<f32, 3>(48.0, 64.0, 160.0);
const SKY_LIGHT_MIN_OPTICAL_DEPTH = 2.0e-3;
const SKY_LIGHT_REFRESH_M = 24.0;      // lighting varies slowly along the ray: re-evaluate every (24 m + 3% of the distance)
const SKY_LIGHT_REFRESH_REL = 0.03;
${SKY_FIELD_WGSL}
// Full up-rez density at a light-sample point (the in-line sun samples: the surface detail matters there).
fn skyDensityLight(p: vec3<f32>, rayDistance: f32, inputs: DensityInputs, b: vec4<f32>) -> f32 {
  let sm = skyModelB(p, rayDistance, true, b, true);
  if (!(sm.m.x > 0.0)) { return 0.0; }
  return cloudDensityShaped(p, rayDistance, inputs, sm.m, saturate(sm.hz)).x;
}
fn heat(x0: f32) -> vec3<f32> {
  let x = saturate(x0);
  return vec3(smoothstep(0.25, 0.6, x), smoothstep(0.0, 0.35, x) * (1.0 - smoothstep(0.7, 1.0, x)), 1.0 - smoothstep(0.1, 0.5, x));
}

// One premultiplied layer being accumulated (front of the box, or behind it).
struct Part { rad: vec3<f32>, T: f32, depthSum: f32, weightSum: f32, depthMax: f32 }
fn partInit() -> Part { return Part(vec3(0.0), 1.0, 0.0, 0.0, 0.0); }

@compute @workgroup_size(8, 8)
fn trace(@builtin(global_invocation_id) gid: vec3<u32>) {
  let full = SKY.temporal.z > 0.5;
  var px = vec2<i32>(gid.xy);
  if (!full) { px = px * 4 + bayerPos(u32(SKY.temporal.x)); }
  if (any(vec2<f32>(px) >= frame.renderSize)) { return; }
  let uv = (vec2<f32>(px) + 0.5) / frame.renderSize;
  let sceneEnd = skySceneEnd(px, uv);

  let origin = frame.cameraPos;
  // P7-E: the pixel is point-sampled at a Halton offset that changes every cycle, so the resolved history converges to the average over
  // the layer pixel instead of one point per pixel: thin stacked layers near the horizon (sub-pixel in height) otherwise alias to bricks.
  let subPx = (vec2<f32>(radicalInverse(SKY_HALTON_BASE + u32(SKY.temporal.y) % 16u, 2u), radicalInverse(SKY_HALTON_BASE + u32(SKY.temporal.y) % 16u, 3u)) - 0.5) * SKY_SUBPIXEL_SPAN;
  let dir = normalize(unprojectDepth((vec2<f32>(px) + 0.5 + select(subPx, vec2<f32>(0.0), SKY.billow.w == 6.0)) / frame.renderSize, 1.0) - origin);
  // Shell: slab between shell.x and shell.y. (Curvature is applied to the sample, not the slab: it is a few tens of metres.)
  var t0 = 0.0;
  var t1 = SKY.shell.z;
  if (abs(dir.y) > 1e-5) {
    let ta = (SKY.shell.x - origin.y) / dir.y;
    let tb = (SKY.shell.y - origin.y) / dir.y;
    t0 = max(0.0, min(ta, tb));
    t1 = min(t1, max(ta, tb));
  } else if (origin.y < SKY.shell.x || origin.y > SKY.shell.y) {
    t1 = -1.0;
  }
  let tEnd = min(t1, sceneEnd);
  // Samples before the ray enters the voxel box belong to the front layer, the rest to the back layer.
  let iv = volumeRayInterval(origin, dir);
  let tSplit = select(FAR_T, 0.5 * (max(iv.x, 0.0) + iv.y), iv.x <= iv.y && iv.y > 0.0);

  var front = partInit();
  var back = partInit();
  var T = 1.0;

  if (t0 < tEnd) {
    let dbg = u32(SKY.billow.w);
    // The jitter changes every amortization cycle: the resolved history converges to the jitter average.
    var jitter = ign(vec2<f32>(px), u32(SKY.temporal.y));
    if (dbg == 6u) { jitter = 0.5; }
    var firstHit = -1.0; var firstF = 0.0; var firstCov = 0.0; var stepsUsed = 0u; var firstTau = -1.0; var firstUp = 0.0;
    let cosSun = dot(dir, frame.sunDir);
    let phase = cloudPhase(cosSun);
    let sunRelax = valueRemap(cosSun, 0.0, 0.9, 0.0, 1.0);
    let frontness = (1.0 - smoothstep(-0.6, 0.1, cosSun));
    let sunRadiance = skyLight[0].xyz;
    let ambientUp = skyLight[1].xyz;
    let ambientDown = skyLight[2].xyz;
    let sunInline0 = frame.sunDir * (0.5 * INLINE_NEAR);
    let sunInline1 = frame.sunDir * (0.5 * (INLINE_NEAR + INLINE_FAR));
    let ext = frame.extinction * SKY.shapeC.z;
    // Same up-rez inputs as the voxel march; the high-frequency fold is a near-camera detail (rayDistance < 150 m only).
    let inputs = DensityInputs(frame.wind, frame.mipDistanceScale, frame.baseMip, 0u, frame.wispyBias, 0.0);
    let maxSteps = u32(SKY.steps.z);
    var capped = true;
    var t = t0;
    var litT = -1.0e9;
    var lit = vec3(0.0);
    for (var i = 0u; i < maxSteps; i++) {
      if (t >= tEnd || T < SKY.steps.w) { capped = false; break; }
      var step = SKY.steps.x + SKY.steps.y * t;
      // One jittered sample per step: the sample position stands for the whole step.
      let ts = t + jitter * step;
      let ps = origin + dir * ts;
      let sp = skyModel(ps, select(ts, -1.0, dbg == 4u), false);
      stepsUsed = i + 1u;
      if (sp.m.x > 0.0) {
        if (firstHit < 0.0) { firstHit = ts; firstF = sp.depth; firstCov = sp.m.x; }
        let ds = min(step, tEnd - t);
        if (ts < tEnd) {
          let d = cloudDensityShaped(ps, ts, inputs, sp.m, saturate(sp.hz));
          if (d.x > 0.0) {
            // Fade out toward the end of the range so the layer does not end on a line.
            let fade = 1.0 - smoothstep(0.75 * SKY.shell.z, SKY.shell.z, ts);
            let sigma = d.x * ext * fade;
            let stepT = exp(-sigma * ds);
            if (sigma * ds > SKY_LIGHT_MIN_OPTICAL_DEPTH) {
              if (ts - litT > SKY_LIGHT_REFRESH_M + SKY_LIGHT_REFRESH_REL * ts) {
                litT = ts;
                let d0 = skyDensityLight(ps + sunInline0, ts, inputs, sp.b);
                let d1 = skyDensityLight(ps + sunInline1, ts, inputs, sp.b);
                let tauInline = (d0 * INLINE_NEAR + d1 * (INLINE_FAR - INLINE_NEAR)) * ext;
                var sunFar = 0.0;
                for (var k = 0; k < 6; k++) { sunFar += skyModelCheap(ps + frame.sunDir * SKY_SUN_T[k]) * SKY_SUN_L[k]; }
                var gridUp = 0.0;
                for (var k = 0; k < 3; k++) { gridUp += skyModelCheap(ps + vec3(0.0, SKY_UP_T[k], 0.0)) * SKY_UP_L[k]; }
                let tau = tauInline + sunFar * ext * frame.lightDensityScale;
                if (firstTau < 0.0) { firstTau = tau; firstUp = gridUp * ext * frame.lightDensityScale * frame.ambientExtinction; }
                // Same arguments as the voxel march: the cheap term (profile * scale) as the in-scatter probability, -depth as the sdf.
                lit = cloudInScatter(sp.m.x * sp.m.z, -sp.depth, saturate(sp.hz), tau, gridUp * ext, phase, sunRelax, sunRadiance, ambientUp, ambientDown);
              }
              if (ts < tSplit) {
                let w = front.T * (1.0 - stepT);
                front.rad += lit * w; front.depthSum += ts * w; front.weightSum += w; front.depthMax = max(front.depthMax, sp.depth);
              } else {
                let w = back.T * (1.0 - stepT);
                back.rad += lit * w; back.depthSum += ts * w; back.weightSum += w; back.depthMax = max(back.depthMax, sp.depth);
              }
            }
            if (ts < tSplit) { front.T *= stepT; } else { back.T *= stepT; }
            T = front.T * back.T;
          }
        }
      } else {
        step = max(step, sp.skip);
        if (sp.empty2d && dbg != 9u) { step = max(step, skyEmptySkip(ps, dir) - jitter * step); }
      }
      t += step;
    }
    // Ran out of steps with cloud left, or hit the cutoff: close the part being marched. Below the cutoff the remaining light
    // continues as the mean colour of what was accumulated, so the cutoff neither darkens nor brightens the ray.
    let inBack = t >= tSplit;
    if (capped && t < tEnd && T < 0.3) { if (inBack) { back.T = 0.0; } else { front.T = 0.0; } }
    if (T < SKY.steps.w) {
      if (inBack) { back.rad /= max(1.0 - back.T, 0.5); back.T = 0.0; } else { front.rad /= max(1.0 - front.T, 0.5); front.T = 0.0; }
    }
    front.rad *= cloudEdgeFactor(front.depthMax, frontness);
    back.rad *= cloudEdgeFactor(back.depthMax, frontness);
    if (dbg != 0u && dbg != 4u && dbg != 6u) {
      let k = max(ambientUp.x + ambientUp.y + ambientUp.z, 1e-3);
      var c = vec3(0.0);
      if (dbg == 1u) { c = select(vec3(0.0, 0.0, 0.3), heat(firstHit / 6000.0), firstHit >= 0.0); }
      else if (dbg == 2u) { c = heat(f32(stepsUsed) / SKY.steps.z); }
      else if (dbg == 3u) { c = heat(max(front.depthMax, back.depthMax) / 120.0); }
      else if (dbg == 5u) { c = vec3(firstCov); }
      else if (dbg == 7u) { c = heat(firstF / 60.0); }
      else if (dbg == 10u) { c = heat(firstTau / 6.0); }
      else if (dbg == 11u) { c = heat(firstUp / 6.0); }
      front.rad = c * k; front.T = select(1.0, 0.0, firstHit >= 0.0 || dbg == 2u);
      back = partInit();
    }
  }

  let meanFront = select(0.0, front.depthSum / max(front.weightSum, 1e-6), front.weightSum > 1e-3);
  let meanBack = select(0.0, back.depthSum / max(back.weightSum, 1e-6), back.weightSum > 1e-3);
${atm ? `  if (meanFront > 0.0) { front.rad = applyAerialPerspective(front.rad, front.T, dir, meanFront); }
  if (meanBack > 0.0) { back.rad = applyAerialPerspective(back.rad, back.T, dir, meanBack); }` : ''}
  front.rad = clamp(front.rad, vec3(0.0), vec3(${MARCH_RADIANCE_LIMIT}.0));
  back.rad = clamp(back.rad, vec3(0.0), vec3(${MARCH_RADIANCE_LIMIT}.0));
  textureStore(skyColorOut, px, vec4(front.rad, front.T));
  textureStore(skyBackOut, px, vec4(back.rad, back.T));
  textureStore(skyDepthOut, px, vec4(select(meanBack, meanFront, meanFront > 0.0), sceneEnd, 0.0, 0.0));
}
`;
}

/**
 * Resolve: every layer pixel, from the fresh trace samples and the reprojected history. Needs COMMON_WGSL in front.
 * Group 1: 0 Frame, 1 scene depth, then SKY_RESOLVE_BINDINGS. Writes the new history, which the host copies to the composite's
 * targets (the default limit is four storage textures per stage).
 */
export const SKY_RESOLVE_WGSL = /* wgsl */ `
${FRAME_WGSL}
${SKY_PARAMS_WGSL}
@group(1) @binding(${SKY_RESOLVE_BINDINGS.trace}) var traceColor: texture_2d<f32>;
@group(1) @binding(${SKY_RESOLVE_BINDINGS.traceDepth}) var traceDepth: texture_2d<f32>;
@group(1) @binding(${SKY_RESOLVE_BINDINGS.hist}) var histColor: texture_2d<f32>;
@group(1) @binding(${SKY_RESOLVE_BINDINGS.histDepth}) var histDepth: texture_2d<f32>;
@group(1) @binding(${SKY_RESOLVE_BINDINGS.histOut}) var histColorOut: texture_storage_2d<rgba16float, write>;
@group(1) @binding(${SKY_RESOLVE_BINDINGS.histDepthOut}) var histDepthOut: texture_storage_2d<rg32float, write>;
@group(1) @binding(${SKY_RESOLVE_BINDINGS.params}) var<uniform> SKY: SkyParams;
@group(1) @binding(${SKY_RESOLVE_BINDINGS.sampler}) var histSampler: sampler;
@group(1) @binding(${SKY_RESOLVE_BINDINGS.traceBack}) var traceBack: texture_2d<f32>;
@group(1) @binding(${SKY_RESOLVE_BINDINGS.histBack}) var histBack: texture_2d<f32>;
@group(1) @binding(${SKY_RESOLVE_BINDINGS.histBackOut}) var histBackOut: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn resolve(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(vec2<f32>(gid.xy) >= frame.renderSize)) { return; }
  let px = vec2<i32>(gid.xy);
  let uv = (vec2<f32>(gid.xy) + 0.5) / frame.renderSize;
  let sceneEnd = skySceneEnd(px, uv);
  let size = vec2<i32>(frame.renderSize);
  let hi = size - vec2<i32>(1);
  let full = SKY.temporal.z > 0.5;
  let phase = u32(SKY.temporal.x);
  let fresh = full || bayerIndex(px) == phase;
  // This frame's fresh sample of the pixel's own 4x4 block (the pixel itself when fresh).
  let b0 = (px / 4) * 4;
  let bp = bayerPos(phase);
  let freshPx = select(b0 + bp, px, fresh);
  let tc = textureLoad(traceColor, freshPx, 0);
  let tb = textureLoad(traceBack, freshPx, 0);
  let td = textureLoad(traceDepth, freshPx, 0).x;
  var out = tc;
  var outB = tb;
  var dist = td;
  if (!full) {
    // Neighbourhood of the nine fresh samples around this block (front layer only: the back layer is far, and its reprojection
    // error is below a texel). Variance clipping (mean +- 1.5 sigma) rather than min/max: it rejects a history that no longer
    // matches the scene (a ghost) but tolerates the normal spread, so it does not stamp 4x4 blocks during motion.
    var m1 = vec4(0.0); var m2 = vec4(0.0);
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let q = clamp(b0 + vec2<i32>(dx, dy) * 4 + bp, vec2<i32>(0), hi);
        let c = textureLoad(traceColor, q, 0);
        m1 += c; m2 += c * c;
      }
    }
    let mean = m1 / 9.0;
    let sigma = sqrt(max(m2 / 9.0 - mean * mean, vec4(0.0)));
    let lo = mean - 1.5 * sigma;
    let hi4 = mean + 1.5 * sigma;
    // Reproject through the cloud mean distance (the block's fresh sample, else the old history, else far away).
    let dir = normalize(unprojectDepth(uv, 1.0) - frame.cameraPos);
    var rd = td;
    let hd0 = textureLoad(histDepth, px, 0).x;
    if (rd <= 0.0) { rd = hd0; }
    if (rd <= 0.0) { rd = 1.0e5; }
    let clip = SKY.prevViewProj * vec4(frame.cameraPos + dir * rd, 1.0);
    var valid = SKY.prevCam.w > 0.5 && clip.w > 1e-3;
    var puv = vec2(0.0);
    if (valid) {
      let ndc = clip.xy / clip.w;
      puv = vec2(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
      valid = all(puv >= vec2(0.0)) && all(puv <= vec2(1.0));
    }
    if (valid) {
      // The clip guards against reprojection error; with the view still (the harness, a static camera) the converged history
      // is the better estimate, so it only bites as much as the pixel actually moved.
      let moved = smoothstep(0.1, 0.6, length((puv - uv) * frame.renderSize));
      let h0 = textureSampleLevel(histColor, histSampler, puv, 0.0);
      let hist = mix(h0, clamp(h0, lo, hi4), moved);
      let histB = textureSampleLevel(histBack, histSampler, puv, 0.0);
      let hdist = textureLoad(histDepth, clamp(vec2<i32>(puv * frame.renderSize), vec2<i32>(0), hi), 0).x;
      if (fresh) {
        out = mix(hist, tc, SKY.extra.w);
        outB = mix(histB, tb, SKY.extra.w);
      } else {
        out = hist;
        outB = histB;
        dist = hdist;
      }
    }
  }
  textureStore(histColorOut, px, out);
  textureStore(histBackOut, px, outB);
  textureStore(histDepthOut, px, vec4(dist, sceneEnd, 0.0, 0.0));
}
`;
