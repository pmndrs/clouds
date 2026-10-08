import { FRAME_WGSL } from './frame.wgsl';
import { lightGridWgsl } from './light-grid.wgsl';
import { LIGHTING_WGSL } from './lighting.wgsl';

/** Dome refresh pass bindings (group 1). Group 0 is the volume; there is no atmosphere group (sun and ambient come from the sky light buffer). */
export const DOME_FRAME_BINDING = 0;      // Frame uniform (same struct as the march)
export const DOME_DEPTH_BINDING = 1;      // dummy scene depth (the Frame helpers declare it)
export const DOME_OUT_BINDING = 2;        // rgba16float storage, write
export const DOME_PARAMS_BINDING = 3;     // DomeParams uniform
export const DOME_LIGHT_GRID_BINDING = 4; // + sampler at 5
export const DOME_SKY_LIGHT_BINDING = 6;
export const DOME_PARAM_BYTES = 48;
/** The dome is refreshed over this many frames (1/16 of the texels per frame, 4x4 interleave). */
export const DOME_REFRESH_FRAMES = 16;

/**
 * Octahedral mapping helpers (y up). Uv 0..1 over the whole sphere: the upper hemisphere is the central diamond, the lower
 * hemisphere the folded corners. Needs no other WGSL.
 */
export const DOME_OCT_WGSL = /* wgsl */ `
fn domeOctEncode(d: vec3<f32>) -> vec2<f32> {
  let n = d / (abs(d.x) + abs(d.y) + abs(d.z));
  var o = n.xz;
  if (n.y < 0.0) { o = (vec2(1.0) - abs(o.yx)) * select(vec2(-1.0), vec2(1.0), o >= vec2(0.0)); }
  return o * 0.5 + 0.5;
}
fn domeOctDecode(uv: vec2<f32>) -> vec3<f32> {
  let f = uv * 2.0 - 1.0;
  var n = vec3(f.x, 1.0 - abs(f.x) - abs(f.y), f.y);
  if (n.y < 0.0) {
    let t = (vec2(1.0) - abs(n.zx)) * select(vec2(-1.0), vec2(1.0), n.xz >= vec2(0.0));
    n = vec3(t.x, n.y, t.y);
  }
  return normalize(n);
}
`;

/**
 * Consumer side: declares the dome texture at (group, binding) and defines
 *   cloudDomeSample(dir) -> vec4<f32>   (rgb = premultiplied radiance in the sky's exposure units, a = transmittance)
 * Manual bilinear over textureLoad with octahedral edge mirroring, so there are no seams and no sampler is needed.
 * Blend on a reflective surface as `env * a + rgb`. Directions below the horizon return (0, 0, 0, 1).
 */
export function cloudDomeWgsl(group: number, binding: number): string {
  return /* wgsl */ `
@group(${group}) @binding(${binding}) var cloudDomeTex: texture_2d<f32>;
${DOME_OCT_WGSL}
fn cloudDomeFetch(i: vec2<i32>, n: vec2<i32>) -> vec4<f32> {
  var j = i;
  if (j.x < 0 || j.x >= n.x) { j = vec2(clamp(j.x, 0, n.x - 1), n.y - 1 - j.y); }
  if (j.y < 0 || j.y >= n.y) { j = vec2(n.x - 1 - j.x, clamp(j.y, 0, n.y - 1)); }
  return textureLoad(cloudDomeTex, j, 0);
}
fn cloudDomeSample(dir: vec3<f32>) -> vec4<f32> {
  let n = vec2<i32>(textureDimensions(cloudDomeTex));
  let p = domeOctEncode(normalize(dir)) * vec2<f32>(n) - 0.5;
  let i0 = vec2<i32>(floor(p));
  let f = p - floor(p);
  let a = mix(cloudDomeFetch(i0, n), cloudDomeFetch(i0 + vec2(1, 0), n), f.x);
  let b = mix(cloudDomeFetch(i0 + vec2(0, 1), n), cloudDomeFetch(i0 + vec2(1, 1), n), f.x);
  return mix(a, b, f.y);
}
`;
}

/**
 * Dome refresh. Concatenate COMMON_WGSL + volumeWgsl(0) + DOME_WGSL. Per Nubis (cRenderDome) there is no up-rez: density is
 * profile * density-scale channel (P*S), scaled by domeDensityScale. The same lighting as the march (LIGHTING_WGSL), larger
 * steps and a capped step count, no aerial perspective and no scene depth.
 *
 * One thread per 4x4 block; the thread shades the texel its block-local Bayer slot picks for this frame, so any 16 consecutive
 * frames cover every texel exactly once.
 */
export const DOME_WGSL = /* wgsl */ `
${FRAME_WGSL}
@group(1) @binding(${DOME_OUT_BINDING}) var domeOut: texture_storage_2d<rgba16float, write>;
struct DomeParams {
  origin: vec3<f32>, densityScale: f32,   // reference point (world, m); P*S density multiplier
  size: u32, slot: u32, maxSteps: u32, slotCount: u32,
  stepMin: f32, stepRel: f32, maxDistance: f32, _p1: f32,
}
@group(1) @binding(${DOME_PARAMS_BINDING}) var<uniform> dome: DomeParams;
${lightGridWgsl(1, DOME_LIGHT_GRID_BINDING)}
@group(1) @binding(${DOME_SKY_LIGHT_BINDING}) var<storage, read> skyLight: array<vec4<f32>, 3>;
${DOME_OCT_WGSL}
${LIGHTING_WGSL}

const SDF_SKIP_MARGIN = 6.0;
const SDF_SKIP_RANGE = 48.0;
const LIGHT_MIN_OPTICAL_DEPTH = 2.0e-3;

fn shade(texel: vec2<u32>) {
  let dir = domeOctDecode((vec2<f32>(texel) + 0.5) / f32(dome.size));
  let origin = dome.origin;

  var T = 1.0;
  var radiance = vec3(0.0);
  let interval = volumeRayInterval(origin, dir);
  let tEnd = min(interval.y, dome.maxDistance);
  var t = max(interval.x, 0.0);
  if (dir.y > -0.02 && interval.x <= interval.y && t < tEnd) {
    let jitter = ign(vec2<f32>(texel), frame.frameIndex);
    let cosSun = dot(dir, frame.sunDir);
    let phase = cloudPhase(cosSun);
    let sunRelax = valueRemap(cosSun, 0.0, 0.9, 0.0, 1.0);
    let frontness = (1.0 - smoothstep(-0.6, 0.1, cosSun));
    let sunRadiance = skyLight[0].xyz;
    let ambientUp = skyLight[1].xyz;
    let ambientDown = skyLight[2].xyz;
    let sunInline0 = frame.sunDir * (0.5 * INLINE_NEAR);
    let sunInline1 = frame.sunDir * (0.5 * (INLINE_NEAR + INLINE_FAR));
    let sunGrid = frame.sunDir * INLINE_FAR;
    let invExtentY = 1.0 / cloudVolume.extent.y;
    var depthMax = 0.0;
    var sdfBound = 0.0;
    var sdfFetchT = -1.0e9;
    var capped = true;
    for (var i = 0u; i < dome.maxSteps; i++) {
      if (t >= tEnd || T < frame.tCutoff) { capped = false; break; }
      let p = origin + dir * t;
      var sdf = sdfBound + (t - sdfFetchT);
      if (sdf > -SDF_SKIP_MARGIN || t - sdfFetchT > SDF_SKIP_RANGE) {
        sdf = cloudDistance(p);
        sdfBound = sdf; sdfFetchT = t;
      }
      let step = max(sdf, max(dome.stepMin, t * dome.stepRel));
      if (sdf < 0.0) {
        let ts = t + jitter * step;
        let ds = min(step, tEnd - t);
        if (ts < tEnd) {
          let ps = origin + dir * ts;
          let m = sampleModeling(ps, 0.0);
          let ps0 = m.x * m.z;   // P * S
          if (ps0 > 0.0) {
            let sigma = ps0 * dome.densityScale * frame.extinction;
            let stepT = exp(-sigma * ds);
            if (sigma * ds > LIGHT_MIN_OPTICAL_DEPTH) {
              let m0 = sampleModeling(ps + sunInline0, 0.0);
              let m1 = sampleModeling(ps + sunInline1, 0.0);
              let tauInline = (m0.x * m0.z * INLINE_NEAR + m1.x * m1.z * (INLINE_FAR - INLINE_NEAR)) * dome.densityScale * frame.extinction;
              let grid = lightGridSample(ps + sunGrid);
              let tau = tauInline + grid.x * frame.lightDensityScale;
              let h = saturate((ps.y - cloudVolume.minCorner.y) * invExtentY);
              let lit = cloudInScatter(ps0, sdf, h, tau, grid.y, phase, sunRelax, sunRadiance, ambientUp, ambientDown);
              depthMax = max(depthMax, -sdf);
              radiance += lit * (T * (1.0 - stepT));
            }
            T *= stepT;
          }
        }
      }
      t += step;
    }
    if (capped && t < tEnd && T < 0.3) { T = 0.0; }
    if (T < frame.tCutoff) { radiance /= max(1.0 - T, 0.5); T = 0.0; }
    radiance *= cloudEdgeFactor(depthMax, frontness);
  }
  textureStore(domeOut, vec2<i32>(texel), vec4(clamp(radiance, vec3(0.0), vec3(60000.0)), T));
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let blocks = dome.size / 4u;
  if (gid.x >= blocks || gid.y >= blocks) { return; }
  var bayer = array<u32, 16>(0u, 8u, 2u, 10u, 12u, 4u, 14u, 6u, 3u, 11u, 1u, 9u, 15u, 7u, 13u, 5u);
  // slotCount > 1 catches the dome up faster after the light grid swaps in (see runtime.ts).
  for (var s = 0u; s < dome.slotCount; s++) {
    let k = bayer[(dome.slot + s) % 16u];
    shade(gid.xy * 4u + vec2(k & 3u, k >> 2u));
  }
}
`;
