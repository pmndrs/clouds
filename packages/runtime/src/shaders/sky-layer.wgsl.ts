import { BILLOW_WGSL } from '../generate/shaders';
import { atmosphereWgsl } from './atmosphere.wgsl';
import { FRAME_WGSL } from './frame.wgsl';
import { LIGHTING_WGSL } from './lighting.wgsl';
import { MARCH_ATMOSPHERE_GROUP, MARCH_RADIANCE_LIMIT } from './march.wgsl';

/** Group 1 bindings of the sky layer pass (0 Frame and 1 scene depth come from FRAME_WGSL). */
export const SKY_COLOR_BINDING = 2;
export const SKY_DEPTH_BINDING = 3;
export const SKY_WEATHER_BINDING = 4;
export const SKY_SAMPLER_BINDING = 5;
export const SKY_LIGHT_STORAGE_BINDING = 6;
export const SKY_PARAMS_BINDING = 7;
/** SkyParams uniform: 8 vec4. */
export const SKY_PARAM_FLOATS = 32;
export const SKY_PARAM_BYTES = SKY_PARAM_FLOATS * 4;

/**
 * Distant sky layer: the Nubis vertical-profile (2.5D) method [N3 s18, s44]. A cloud shell [shellMin, shellMax] around the whole
 * world, driven by the same world-anchored weather field as the generator (a baked window of weather.ts, uv = (xz - boxMin) / boxSize)
 * and the generator's own shaping law (generate/shaders.ts SHAPE: f = s - h^p, flat base lifted toward lobe rims), turned into the
 * (profile, detail type, density scale) triple analytically instead of through a voxel SDF:
 *   depth proxy = f * depthScale (metres below the surface), profile/detail/scale = the generator's PACK_FIT formulas on it.
 * That triple goes through the SAME up-rez (cloudDensityShaped) and the SAME lighting chunk (LIGHTING_WGSL) as the voxel march.
 * There is no light grid out here: the sun optical depth is two in-line up-rez samples plus three cheap profile samples along the
 * sun ray, the ambient 'up' term two cheap samples straight up.
 *
 * Handoff with the voxel box: the generator fades its weather coverage to 0 over `border` of the map at the box rim
 * (cov * smoothstep(0, B, e), e = distance inside the box edge). The sky layer uses the complement, cov * (1 - smoothstep(0, B, e)),
 * which is 1 outside the box and 0 deeper inside than B, so the two fields cross-fade over the rim and add up to the full weather.
 * Concatenate COMMON_WGSL + volumeWgsl(0) + DENSITY_WGSL + this. Group 1 as above, group 2 the atmosphere (mode 'atmosphere').
 */
export function skyLayerWgsl(mode: 'atmosphere' | 'uniform'): string {
  const atm = mode === 'atmosphere';
  return /* wgsl */ `
${FRAME_WGSL}
struct SkyParams {
  window: vec4<f32>,   // weather window: min x, min z, size x, size z (world metres)
  box: vec4<f32>,      // volume box: min x, min z, size x, size z
  shell: vec4<f32>,    // minY, maxY, maxDistance, curvature (1/(2R), 0 = flat)
  shapeA: vec4<f32>,   // topFrac, domeExp, baseDefault, baseLift
  shapeB: vec4<f32>,   // coverageThreshold, depthScale (m per unit of the shape field), scaleBase, scaleTop
  shapeC: vec4<f32>,   // detailBias, rimWidth (m), extinction multiplier, window edge fade (fraction of the window)
  steps: vec4<f32>,    // stepMin (m), stepRel (per m of distance), maxSteps, transmittance cutoff
  billow: vec4<f32>,   // generator billow: amplitude, first cell (m), seed (as given to the generator), 0
}
@group(1) @binding(${SKY_COLOR_BINDING}) var skyColorOut: texture_storage_2d<rgba16float, write>;
@group(1) @binding(${SKY_DEPTH_BINDING}) var skyDepthOut: texture_storage_2d<rg32float, write>;
@group(1) @binding(${SKY_WEATHER_BINDING}) var skyWeather: texture_2d<f32>;
@group(1) @binding(${SKY_SAMPLER_BINDING}) var skySampler: sampler;
@group(1) @binding(${SKY_LIGHT_STORAGE_BINDING}) var<storage, read> skyLight: array<vec4<f32>, 3>;
@group(1) @binding(${SKY_PARAMS_BINDING}) var<uniform> SKY: SkyParams;
${atm ? atmosphereWgsl(MARCH_ATMOSPHERE_GROUP) : ''}
${LIGHTING_WGSL}
${BILLOW_WGSL}

const SKY_SUN_FAR_T0 = 96.0;     // cheap sun samples along the ray beyond the in-line ones: distance, length of the segment each stands for
const SKY_SUN_FAR_T1 = 240.0;
const SKY_SUN_FAR_T2 = 480.0;
const SKY_SUN_FAR_L0 = 96.0;
const SKY_SUN_FAR_L1 = 192.0;
const SKY_SUN_FAR_L2 = 288.0;
const SKY_UP_T0 = 50.0;          // cheap samples straight up for the ambient term
const SKY_UP_T1 = 160.0;
const SKY_LIGHT_MIN_OPTICAL_DEPTH = 2.0e-3;
const SKY_LIGHT_CACHE_FROM = 3000.0;   // nearer than this every step is lit (cached lighting bands visibly up close)
const SKY_LIGHT_REFRESH_M = 24.0;
const SKY_LIGHT_REFRESH_REL = 0.02;

// Analytic (profile, detail type, density scale) at a world point, plus the shape field f0 (> 0 inside) and a conservative skip
// distance in metres for empty space.
struct SkyModel { m: vec3<f32>, depth: f32, hz: f32, skip: f32 }

fn skyModel(p0: vec3<f32>, lodDistance: f32) -> SkyModel {
  var r: SkyModel;
  r.m = vec3(0.0); r.depth = 0.0; r.skip = 0.0;
  let shellH = max(SKY.shell.y - SKY.shell.x, 1.0);
  // Planet curvature: the shell drops away from the box centre.
  let c = p0.xz - (SKY.box.xy + SKY.box.zw * 0.5);
  let p = vec3(p0.x, p0.y + SKY.shell.w * dot(c, c), p0.z);
  r.hz = (p.y - SKY.shell.x) / shellH;
  let wuv = (p.xz - SKY.window.xy) / SKY.window.zw;
  if (any(wuv <= vec2(0.0)) || any(wuv >= vec2(1.0))) { r.skip = 2000.0; return r; }
  let w = textureSampleLevel(skyWeather, skySampler, wuv, 0.0);
  let edgeW = min(min(wuv.x, 1.0 - wuv.x), min(wuv.y, 1.0 - wuv.y));
  let thr = SKY.shapeB.x;
  var cov = w.r * smoothstep(0.0, max(SKY.shapeC.w, 1e-4), edgeW);
  // Box rim: complement of the generator's border fade.
  let bmax = SKY.box.xy + SKY.box.zw;
  let e = min(min(p.x - SKY.box.x, bmax.x - p.x), min(p.z - SKY.box.y, bmax.y - p.z));
  let rim = max(SKY.shapeC.y, 1e-3);
  if (SKY.shapeC.y >= 0.0) { cov *= 1.0 - smoothstep(0.0, rim, e); }
  let s = saturate((cov - thr) / (1.0 - thr));
  if (s <= 0.0) {
    // No mass here. Deep inside the box nothing can appear until the rim zone; elsewhere weather varies over about depthScale.
    r.skip = select(max(0.3 * (thr - cov) * SKY.shapeB.y, 0.0), max(e - rim, 0.0), e > rim);
    return r;
  }
  let topF = SKY.shapeA.x;
  let base = SKY.shapeA.z + SKY.shapeA.w * pow(1.0 - s, 1.5);
  let h = (r.hz - base) / max(topF - base, 1e-3);
  let g = select(-h * 24.0, pow(h, SKY.shapeA.y), h >= 0.0);
  let f00 = s - g;
  let hcol = clamp(h / pow(max(s, 0.05), 1.0 / SKY.shapeA.y), 0.0, 1.0);
  var f0 = f00;
  // The generator's billow erosion (same functions, same world anchoring), fewer octaves with distance.
  if (lodDistance >= 0.0 && SKY.billow.x > 0.0 && f00 > -0.55 && f00 < 0.5) {
    let pm = vec3(p.x - SKY.box.x, p.z - SKY.box.y, p.y - SKY.shell.x);
    let b = billowLod(pm, SKY.billow.y, u32(SKY.billow.z * 131.0), lodDistance);
    let near = (1.0 - smoothstep(0.18, 0.45, f00)) * smoothstep(-0.55, -0.3, f00);
    let topW = mix(0.45, 1.0, smoothstep(0.1, 0.7, hcol)) * (1.0 - smoothstep(0.82, 1.0, h));
    f0 = f00 + SKY.billow.x * 3.0 * b * near * topW;
  }
  if (f0 <= 0.0 || h >= 1.5) {
    // Conservative empty-space skip: below the base the field is steep (24 per unit h), so use the vertical distance to the base
    // surface; elsewhere the gradient is about 1/depthScale. (An over-long skip jumps over the soft base and cuts clouds off.)
    let hb = h + s / 24.0;
    r.skip = select(0.3 * (-f0) * SKY.shapeB.y, -hb * max(topF - base, 1e-3) * shellH * 0.5, h < 0.0);
    return r;
  }
  // Metres below the surface: the dome (top and sides) from the shape field, the flat base from the height above it, so the base
  // ramps in over the same ~66 m the voxel profile does (f * depthScale alone would make the base ramp 15x too sharp).
  let hBase = h + s / 24.0;
  let depth = max(min(f0 * SKY.shapeB.y, hBase * max(topF - base, 1e-3) * shellH), 0.0);
  r.depth = depth;
  let core = pow(clamp((depth - 1.4) / 66.0, 0.0, 1.0), 1.05);
  let lift = 0.1 + 0.9 * smoothstep(0.0, 0.22, hcol);
  let profile = max(core * lift, 1.0 / 255.0);
  let detail = clamp(smoothstep(0.1, 0.75, hcol - 0.25 * clamp(depth / 32.0, 0.0, 1.0)) + (w.g - 0.5) * SKY.shapeC.x, 0.0, 1.0);
  let scale = clamp(mix(SKY.shapeB.z, SKY.shapeB.w, smoothstep(0.0, 0.6, hcol)), 0.0, 1.0);
  r.m = vec3(profile, detail, scale);
  return r;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(vec2<f32>(gid.xy) >= frame.renderSize)) { return; }
  let px = vec2<i32>(gid.xy);
  let uv = (vec2<f32>(gid.xy) + 0.5) / frame.renderSize;

  // Farthest scene depth over the output pixels this pixel covers (the layer is rendered at reduced resolution).
  let ratio = frame.outputSize / frame.renderSize;
  let lo = vec2<i32>(floor(vec2<f32>(gid.xy) * ratio));
  let hi = min(vec2<i32>(ceil(vec2<f32>(gid.xy + vec2<u32>(1u)) * ratio)) - vec2<i32>(1), lo + vec2<i32>(7));
  let dmax = vec2<i32>(textureDimensions(sceneDepth)) - vec2<i32>(1);
  var depth = 0.0;
  for (var y = lo.y; y <= hi.y; y += 2) {
    for (var x = lo.x; x <= hi.x; x += 2) { depth = max(depth, textureLoad(sceneDepth, min(vec2<i32>(x, y), dmax), 0)); }
  }
  let sceneEnd = sceneDistance(depth, uv);

  let origin = frame.cameraPos;
  let dir = normalize(unprojectDepth(uv, 1.0) - origin);
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

  var T = 1.0;
  var depthMax = 0.0;
  var radiance = vec3(0.0);
  var depthSum = 0.0;
  var weightSum = 0.0;

  if (t0 < tEnd) {
    let jitter = ign(vec2<f32>(gid.xy), 0u);   // static: this layer is far away (no resolve), P3-C2 amortises it over 16 frames
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
      // One jittered sample per step (static jitter): the sample position stands for the whole step.
      let ts = t + jitter * step;
      let ps = origin + dir * ts;
      let sp = skyModel(ps, ts);
      if (sp.m.x > 0.0) {
        let ds = min(step, tEnd - t);
        if (ts < tEnd) {
          let d = cloudDensityShaped(ps, ts, inputs, sp.m, saturate(sp.hz));
          if (d.x > 0.0) {
            // Fade out toward the end of the range so the layer does not end on a line.
            let fade = 1.0 - smoothstep(0.75 * SKY.shell.z, SKY.shell.z, ts);
            let sigma = d.x * ext * fade;
            let stepT = exp(-sigma * ds);
            if (sigma * ds > SKY_LIGHT_MIN_OPTICAL_DEPTH) {
              // Lighting varies slowly along the ray: re-evaluate it every ~(24 m + 2% of the distance) and reuse it between.
              if (ts < SKY_LIGHT_CACHE_FROM || ts - litT > SKY_LIGHT_REFRESH_M + SKY_LIGHT_REFRESH_REL * ts) {
                litT = ts;
                let d0 = skyDensityLight(ps + sunInline0, ts, inputs);
                let d1 = skyDensityLight(ps + sunInline1, ts, inputs);
                let tauInline = (d0 * INLINE_NEAR + d1 * (INLINE_FAR - INLINE_NEAR)) * ext;
                let c0 = skyModelCheap(ps + frame.sunDir * SKY_SUN_FAR_T0);
                let c1 = skyModelCheap(ps + frame.sunDir * SKY_SUN_FAR_T1);
                let c2 = skyModelCheap(ps + frame.sunDir * SKY_SUN_FAR_T2);
                let sunFar = (c0 * SKY_SUN_FAR_L0 + c1 * SKY_SUN_FAR_L1 + c2 * SKY_SUN_FAR_L2) * ext;
                let u0 = skyModelCheap(ps + vec3(0.0, SKY_UP_T0, 0.0));
                let u1 = skyModelCheap(ps + vec3(0.0, SKY_UP_T1, 0.0));
                let gridUp = (u0 * SKY_UP_T0 + u1 * (SKY_UP_T1 - SKY_UP_T0)) * ext;
                let tau = tauInline + sunFar * frame.lightDensityScale;
                lit = cloudInScatter(sp.m.x, -sp.depth, saturate(sp.hz), tau, gridUp, phase, sunRelax, sunRadiance, ambientUp, ambientDown);
              }
              depthMax = max(depthMax, sp.depth);
              let w = T * (1.0 - stepT);
              radiance += lit * w;
              depthSum += ts * w;
              weightSum += w;
            }
            T *= stepT;
          }
        }
      } else {
        step = max(step, sp.skip);
      }
      t += step;
    }
    if (capped && t < tEnd && T < 0.3) { T = 0.0; }
    if (T < SKY.steps.w) {
      radiance /= max(1.0 - T, 0.5);
      T = 0.0;
    }
    radiance *= cloudEdgeFactor(depthMax, frontness);
  }

  let meanDistance = select(0.0, depthSum / max(weightSum, 1e-6), weightSum > 1e-3);
${atm ? `  if (meanDistance > 0.0) {
    radiance = applyAerialPerspective(radiance, T, dir, meanDistance);
  }` : ''}
  radiance = clamp(radiance, vec3(0.0), vec3(${MARCH_RADIANCE_LIMIT}.0));
  textureStore(skyColorOut, px, vec4(radiance, T));
  textureStore(skyDepthOut, px, vec4(meanDistance, sceneEnd, 0.0, 0.0));
}

// The generator's billow (billowAt) with its octaves faded out by distance instead of switched, so no surface is displaced at a
// distance threshold: octave 1 (half cell) fades over 1000..2000 m, octave 2 over 300..700 m. The weights normalise away.
fn billowLod(pm: vec3<f32>, cell0: f32, s0: u32, dist: f32) -> f32 {
  let w1 = 1.0 - smoothstep(1000.0, 2000.0, dist);
  let w2 = 1.0 - smoothstep(300.0, 700.0, dist);
  var a = 0.0; var wsum = 0.0; var amp = 0.55; var cell = cell0;
  for (var o = 0u; o < 3u; o++) {
    let lw = select(select(w2, w1, o == 1u), 1.0, o == 0u);
    if (lw > 0.0) {
      let w = 1.0 - clamp(worleyF1(pm / cell + vec3<f32>(f32(o) * 7.3, f32(o) * 3.1, 0.0), s0 + o * 17u) * 1.1, 0.0, 1.0);
      a += lw * amp * w; wsum += lw * amp;
    }
    cell *= 0.5; amp *= 0.55;
  }
  return a / wsum - 0.36;
}

// Full up-rez density at a light-sample point (the in-line sun samples).
fn skyDensityLight(p: vec3<f32>, rayDistance: f32, inputs: DensityInputs) -> f32 {
  let sm = skyModel(p, -1.0);
  if (!(sm.m.x > 0.0)) { return 0.0; }
  return cloudDensityShaped(p, rayDistance, inputs, sm.m, saturate(sm.hz)).x;
}
// The cheap term (profile * density scale), the one the voxel light grid sums.
fn skyModelCheap(p: vec3<f32>) -> f32 {
  let sm = skyModel(p, -1.0);
  return sm.m.x * sm.m.z;
}
`;
}
