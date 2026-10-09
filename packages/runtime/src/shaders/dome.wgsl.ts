import { FRAME_WGSL } from './frame.wgsl';
import { lightGridWgsl } from './light-grid.wgsl';
import { BILLOW_WGSL } from '../generate/shaders';
import { LIGHTING_WGSL } from './lighting.wgsl';
import { SKY_FIELD_WGSL, SKY_PARAMS_WGSL } from './sky-layer.wgsl';
import { SKY_LIGHT_ENTRIES } from './march.wgsl';

/** Dome refresh pass bindings (group 1). Group 0 is the volume; there is no atmosphere group (sun and ambient come from the sky light buffer). */
export const DOME_FRAME_BINDING = 0;      // Frame uniform (same struct as the march)
export const DOME_DEPTH_BINDING = 1;      // dummy scene depth (the Frame helpers declare it)
export const DOME_OUT_BINDING = 2;        // rgba16float storage, write
export const DOME_PARAMS_BINDING = 3;     // DomeParams uniform
export const DOME_LIGHT_GRID_BINDING = 4; // + sampler at 5
export const DOME_SKY_LIGHT_BINDING = 6;
/** P7-E: the distant sky layer's baked weather window, its sampler and its params, so the dome sees the clouds beyond the voxel box too. */
export const DOME_SKY_WEATHER_BINDING = 7;
export const DOME_SKY_SAMPLER_BINDING = 8;
export const DOME_SKY_PARAMS_BINDING = 9;
/** X3: a procedural density model's bindings start here (ProceduralDensityModel.densityWgsl(1, DOME_PROCEDURAL_BINDING)). */
export const DOME_PROCEDURAL_BINDING = 10;
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
 * X3: `procedural` (a procedural model's densityWgsl(1, DOME_PROCEDURAL_BINDING)) replaces the sky layer's field outside the box with the model's
 * cheap density over its shell, lit by four cheap taps toward the sun and two up, in the model's lighting model. The voxel box keeps its SDF
 * march (hybrid). Either branch takes the 'octave' model when it is selected (frame.haze.w for the voxel field, P.lit.x for the model).
 */
export function domeWgsl(procedural?: string): string {
  return /* wgsl */ `
${FRAME_WGSL}
@group(1) @binding(${DOME_OUT_BINDING}) var domeOut: texture_storage_2d<rgba16float, write>;
struct DomeParams {
  origin: vec3<f32>, densityScale: f32,   // reference point (world, m); P*S density multiplier
  size: u32, slot: u32, maxSteps: u32, slotCount: u32,
  stepMin: f32, stepRel: f32, maxDistance: f32, skyOn: f32,   // skyOn: 1 when the sky layer's weather window is bound and the layer is on
}
@group(1) @binding(${DOME_PARAMS_BINDING}) var<uniform> dome: DomeParams;
${lightGridWgsl(1, DOME_LIGHT_GRID_BINDING)}
@group(1) @binding(${DOME_SKY_LIGHT_BINDING}) var<storage, read> skyLight: array<vec4<f32>, ${SKY_LIGHT_ENTRIES}>;
@group(1) @binding(${DOME_SKY_WEATHER_BINDING}) var skyWeather: texture_2d<f32>;
@group(1) @binding(${DOME_SKY_SAMPLER_BINDING}) var skySampler: sampler;
@group(1) @binding(${DOME_SKY_PARAMS_BINDING}) var<uniform> SKY: SkyParams;
${SKY_PARAMS_WGSL}
${BILLOW_WGSL}
${SKY_FIELD_WGSL}
${DOME_OCT_WGSL}
${LIGHTING_WGSL}
${procedural ?? ''}

const SDF_SKIP_MARGIN = 6.0;
const SDF_SKIP_RANGE = 48.0;
const LIGHT_MIN_OPTICAL_DEPTH = 2.0e-3;

const DOME_LIGHT_REFRESH_M = 24.0;
const DOME_LIGHT_REFRESH_REL = 0.03;
const DOME_SUN_T = array<f32, 3>(84.0, 180.0, 355.0);
const DOME_SUN_L = array<f32, 3>(72.0, 120.0, 230.0);
const DOME_PROC_SUN_T = array<f32, 4>(40.0, 150.0, 450.0, 1200.0);
const DOME_PROC_SUN_L = array<f32, 4>(80.0, 150.0, 450.0, 1000.0);

fn shade(texel: vec2<u32>) {
  let dir = domeOctDecode((vec2<f32>(texel) + 0.5) / f32(dome.size));
  let origin = dome.origin;

  var T = 1.0;
  var radiance = vec3(0.0);
  let interval = volumeRayInterval(origin, dir);
  let boxHit = interval.x <= interval.y && interval.y > 0.0;
  let sky = dome.skyOn > 0.5;
  // The ray runs through the voxel box (SDF march below) and, with the sky layer on, through the analytic cloud field outside it
  // (the same field the layer renders in the main view; without this the reflection of a cloud ends flat at the box wall).
  var tEnd = select(min(interval.y, dome.maxDistance), dome.maxDistance, sky);
  var t = select(max(interval.x, 0.0), 0.0, sky);
  if (sky) {   // clip to the cloud shell's slab
${procedural ? `    // The procedural shell (a little higher for the curvature drop), out to its own range.
    tEnd = min(P.shell.z, 60000.0);
    let sy = P.shell.x - origin.y;
    let sy1 = P.shell.y + 150.0 - origin.y;` : `    let sy = SKY.shell.x - origin.y;
    let sy1 = SKY.shell.y - origin.y;`}
    if (abs(dir.y) > 1.0e-4) {
      let ta = sy / dir.y;
      let tb = sy1 / dir.y;
      t = max(t, min(ta, tb));
      tEnd = min(tEnd, max(ta, tb));
    } else if (sy > 0.0 || sy1 < 0.0) { tEnd = -1.0; }
  }
  if (dir.y > -0.02 && (sky || boxHit) && t < tEnd) {
    let jitter = ign(vec2<f32>(texel), frame.frameIndex);
    let cosSun = dot(dir, frame.sunDir);
    let phase = cloudPhase(cosSun);
    let sunRelax = valueRemap(cosSun, 0.0, 0.9, 0.0, 1.0);
    let frontness = (1.0 - smoothstep(-0.6, 0.1, cosSun));
    let sunRadiance = skyLight[0].xyz;
    let ambientUp = skyLight[1].xyz;
    let ambientDown = skyLight[2].xyz;
    let envUp = skyLight[5].xyz;
    let envDown = skyLight[6].xyz;
    let sunInline0 = frame.sunDir * (0.5 * INLINE_NEAR);
    let sunInline1 = frame.sunDir * (0.5 * (INLINE_NEAR + INLINE_FAR));
    let sunGrid = frame.sunDir * INLINE_FAR;
    let invExtentY = 1.0 / cloudVolume.extent.y;
    let ext = dome.densityScale * frame.extinction;
    var depthMax = 0.0;
    var sdfBound = 0.0;
    var sdfFetchT = -1.0e9;
    var capped = true;
    var litT = -1.0e9; var litTau = 0.0; var litUp = 0.0;   // the sky field's last light evaluation (P9-C3)
    for (var i = 0u; i < dome.maxSteps; i++) {
      if (t >= tEnd || T < frame.tCutoff) { capped = false; break; }
      let inBox = boxHit && t >= interval.x && t < interval.y;
      var step = max(dome.stepMin, t * dome.stepRel);
      if (inBox) {
        let p = origin + dir * t;
        var sdf = sdfBound + (t - sdfFetchT);
        if (sdf > -SDF_SKIP_MARGIN || t - sdfFetchT > SDF_SKIP_RANGE) {
          sdf = cloudDistance(p);
          sdfBound = sdf; sdfFetchT = t;
        }
        step = max(sdf, step);
        if (sdf < 0.0) {
          let ts = t + jitter * step;
          let ds = min(step, tEnd - t);
          if (ts < tEnd) {
            let ps = origin + dir * ts;
            let m = sampleModeling(ps, 0.0);
            let ps0 = m.x * m.z;   // P * S
            if (ps0 > 0.0) {
              let sigma = ps0 * ext;
              let stepT = exp(-sigma * ds);
              if (sigma * ds > LIGHT_MIN_OPTICAL_DEPTH) {
                let m0 = sampleModeling(ps + sunInline0, 0.0);
                let m1 = sampleModeling(ps + sunInline1, 0.0);
                let tauInline = (m0.x * m0.z * INLINE_NEAR + m1.x * m1.z * (INLINE_FAR - INLINE_NEAR)) * ext;
                let grid = lightGridSampleClamped(ps + sunGrid);
                let tau = tauInline + grid.x * frame.lightDensityScale;
                let h = saturate((ps.y - cloudVolume.minCorner.y) * invExtentY);
                var lit: vec3<f32>;
                if (octaveOn()) { lit = cloudOctaveLight(tau, cosSun, h, sigma, sunRadiance, ambientUp, ambientDown, envUp, envDown, OCTAVE_DEFAULT, octaveVoxel()); }
                else { lit = cloudInScatter(ps0, sdf, h, tau, grid.y, phase, sunRelax, sunRadiance, ambientUp, ambientDown); }
                depthMax = max(depthMax, -sdf);
                radiance += lit * (T * (1.0 - stepT));
              }
              T *= stepT;
            }
          }
        }
        if (t + step > interval.y) { step = max(interval.y - t, 0.0) + 1.0e-3; }   // continue just past the wall in the sky field
      } else if (sky) {
${procedural ? `        let ts = t + jitter * step;
        let ps = origin + dir * ts;
        let ds = min(step, tEnd - t);
        let sp = procSample(ps, ts, ts * 0.004, false, jitter);
        let sigma = sp.sigma * P.misc.x * procCarve(ps) * dome.densityScale;
        if (sigma > 0.0) {
          let stepT = exp(-sigma * ds);
          if (sigma * ds > LIGHT_MIN_OPTICAL_DEPTH) {
            if (ts - litT > DOME_LIGHT_REFRESH_M + DOME_LIGHT_REFRESH_REL * ts) {
              litT = ts;
              var tauSun = 0.0;
              for (var k = 0; k < 4; k++) { tauSun += procSample(ps + frame.sunDir * DOME_PROC_SUN_T[k], ts, DOME_PROC_SUN_T[k] * 0.1, false, jitter).sigma * DOME_PROC_SUN_L[k]; }
              litTau = tauSun * P.misc.x * P.misc.y * dome.densityScale;
              litUp = (procSample(ps + vec3(0.0, 125.0, 0.0), ts, 20.0, false, jitter).sigma * 250.0 + procSample(ps + vec3(0.0, 600.0, 0.0), ts, 80.0, false, jitter).sigma * 700.0) * P.misc.x * dome.densityScale;
            }
            var lit: vec3<f32>;
            if (P.lit.x > 0.5) { lit = cloudOctaveLight(litTau, cosSun, saturate(sp.h), sigma, sunRadiance, ambientUp, ambientDown, envUp, envDown, vec4(P.octave.xyz, P.lit.y), vec4(P.octave.w, P.lit.z, 0.0, 0.0)); }
            else {
              let profile = min(pow(saturate(sp.depth / max(P.misc.w, 1.0)), 1.05), sp.coarse);
              lit = cloudInScatter(max(profile, 1.0 / 255.0), -sp.depth, saturate(sp.h), litTau, litUp, phase, sunRelax, sunRadiance, ambientUp, ambientDown);
              depthMax = max(depthMax, sp.depth);
            }
            radiance += lit * (T * (1.0 - stepT));
          }
          T *= stepT;
        }
` : `        let ts = t + jitter * step;
        let ps = origin + dir * ts;
        let sp = skyModel(ps, -1.0, true);
        let ps0 = sp.m.x * sp.m.z;
        if (ps0 > 0.0) {
          let ds = min(step, tEnd - t);
          let sigma = ps0 * ext;
          let stepT = exp(-sigma * ds);
          if (sigma * ds > LIGHT_MIN_OPTICAL_DEPTH) {
            // The layer's light (the voxel light grid, analytically): two in-line cheap samples, three farther along the sun ray, two straight up.
            // P9-C3: the sky layer's six far and three up samples merged pairwise (same segments: 48-120, 120-240, 240-470 m toward the sun; 0-112,
            // 112-272 m up), and re-evaluated only every 24 m + 3% of the distance, as the layer does (the dome is a 256^2 reflection; a texel is
            // 12 m at 1 km). About a third less dome time on the mixed sky.
            if (ts - litT > DOME_LIGHT_REFRESH_M + DOME_LIGHT_REFRESH_REL * ts) {
              litT = ts;
              let c0 = skyModelCheap(ps + sunInline0);
              let c1 = skyModelCheap(ps + sunInline1);
              var sunFar = 0.0;
              for (var k = 0; k < 3; k++) { sunFar += skyModelCheap(ps + frame.sunDir * DOME_SUN_T[k]) * DOME_SUN_L[k]; }
              litUp = skyModelCheap(ps + vec3(0.0, 56.0, 0.0)) * 112.0 + skyModelCheap(ps + vec3(0.0, 192.0, 0.0)) * 160.0;
              litTau = (c0 * INLINE_NEAR + c1 * (INLINE_FAR - INLINE_NEAR)) * ext + sunFar * ext * frame.lightDensityScale;
            }
            let tau = litTau;
            let gridUp = litUp;
            let lit = cloudInScatter(ps0, -sp.depth, saturate(sp.hz), tau, gridUp * ext, phase, sunRelax, sunRadiance, ambientUp, ambientDown);
            depthMax = max(depthMax, sp.depth);
            radiance += lit * (T * (1.0 - stepT));
          }
          T *= stepT;
        } else {
          step = max(step, sp.skip);
          if (sp.empty2d) { step = max(step, skyEmptySkip(ps, dir) - jitter * step); }
        }
`}
        if (boxHit && t < interval.x) { step = min(step, max(interval.x - t, 0.0) + 1.0e-3); }   // do not step over the box: its clouds are the SDF march's
      }
      t += step;
    }
    if (capped && t < tEnd && T < 0.3) { T = 0.0; }
    if (T < frame.tCutoff) { radiance /= max(1.0 - T, 0.5); T = 0.0; }
    radiance *= select(cloudEdgeFactor(depthMax, frontness), 1.0, octaveOn());
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
}
export const DOME_WGSL = domeWgsl();
