import { FRAME_WGSL } from './frame.wgsl';

/**
 * SDF sphere-trace march with TEMPORARY lighting (P1-05 replaces it with the light grid and the full model).
 * Concatenate COMMON_WGSL + volumeWgsl(0) + DENSITY_WGSL + MARCH_WGSL. Per-pass bindings are group 1:
 * 0 Frame, 1 scene depth, 2 colour out (rgb premultiplied radiance, a = transmittance), 3 depth out (rg32float:
 * x = transmittance-weighted mean cloud distance or 0, y = scene distance the ray was marched against).
 */
export const MARCH_WGSL = /* wgsl */ `
${FRAME_WGSL}
@group(1) @binding(2) var marchColor: texture_storage_2d<rgba16float, write>;
@group(1) @binding(3) var marchDepth: texture_storage_2d<rg32float, write>;

const SUN_STEPS = 6;
const SUN_STEP0 = 25.0;
const SUN_GROWTH = 1.6;

fn henyeyGreenstein(cosTheta: f32, g: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
}
// 0.7 * HG(0.2) + 0.3 * forward lobe HG(0.8)
fn cloudPhase(cosTheta: f32) -> f32 {
  return 0.7 * henyeyGreenstein(cosTheta, 0.2) + 0.3 * henyeyGreenstein(cosTheta, 0.8);
}

// Optical depth toward the sun: 6 cheap (profile * density scale) samples, step 25 m growing x1.6.
fn sunOpticalDepth(p: vec3<f32>) -> f32 {
  var tau = 0.0;
  var travelled = 0.0;
  var ds = SUN_STEP0;
  for (var i = 0; i < SUN_STEPS; i++) {
    let m = sampleModeling(p + frame.sunDir * (travelled + 0.5 * ds), frame.baseMip);
    tau += m.x * m.z * ds;
    travelled += ds;
    ds *= SUN_GROWTH;
  }
  return tau * frame.extinction * frame.lightDensityScale;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(vec2<f32>(gid.xy) >= frame.renderSize)) { return; }
  let px = vec2<i32>(gid.xy);
  let uv = (vec2<f32>(gid.xy) + 0.5) / frame.renderSize;

  // Farthest scene depth over the output pixels this march pixel covers.
  let ratio = frame.outputSize / frame.renderSize;
  let lo = vec2<i32>(floor(vec2<f32>(gid.xy) * ratio));
  let hi = min(vec2<i32>(ceil(vec2<f32>(gid.xy + vec2<u32>(1u)) * ratio)) - vec2<i32>(1), lo + vec2<i32>(3));
  let dmax = vec2<i32>(textureDimensions(sceneDepth)) - vec2<i32>(1);
  var depth = 0.0;
  for (var y = lo.y; y <= hi.y; y++) {
    for (var x = lo.x; x <= hi.x; x++) { depth = max(depth, textureLoad(sceneDepth, min(vec2<i32>(x, y), dmax), 0)); }
  }
  let sceneEnd = sceneDistance(depth, uv);

  let origin = frame.cameraPos;
  let dir = normalize(unprojectDepth(uv, 1.0) - origin);
  let interval = volumeRayInterval(origin, dir);
  let tEnd = min(interval.y, sceneEnd);
  var t = max(interval.x, 0.0);

  var T = 1.0;
  var radiance = vec3(0.0);
  var depthSum = 0.0;
  var weightSum = 0.0;

  if (interval.x <= interval.y && t < tEnd) {
    let jitterAnimated = ign(vec2<f32>(gid.xy), frame.frameIndex);
    let jitterStatic = ign(vec2<f32>(gid.xy), 0u);
    let cosSun = dot(dir, frame.sunDir);
    let phase = cloudPhase(cosSun);
    let sunRelax = valueRemap(cosSun, 0.0, 0.9, 0.25, 1.0); // blended with the depth term below
    var inputs = DensityInputs(frame.wind, frame.mipDistanceScale, frame.baseMip, 0u, 0.0, 0.0);

    for (var i = 0u; i < frame.maxSteps; i++) {
      if (t >= tEnd || T < 0.01) { break; }
      let p = origin + dir * t;
      let sdf = cloudDistance(p);
      let step = max(sdf, max(1.0, sqrt(t) * 0.08));
      if (sdf < 0.0) {
        // Jitter moves the sample, not the advance. Animated near the camera, static far away.
        let ts = t + select(jitterStatic, jitterAnimated, t < 250.0) * step;
        let ds = min(step, tEnd - t);
        if (ts < tEnd) {
          inputs.hfDetails = select(0u, 1u, ts < 150.0);
          let ps = origin + dir * ts;
          let d = cloudDensity(ps, ts, inputs);
          if (d.x > 0.0) {
            let sigma = d.x * frame.extinction;
            let tau = sunOpticalDepth(ps);
            // Inner glow: the profile is an in-scatter probability; extinction relaxes deep inside and toward the sun.
            let relax = mix(0.25, valueRemap(sdf, -128.0, 0.0, 0.05, 0.25), valueRemap(cosSun, 0.0, 0.9, 0.0, 1.0));
            let ms = d.y * exp(-tau * relax);
            let h = saturate((ps.y - cloudVolume.minCorner.y) / cloudVolume.extent.y);
            let ambient = pow(1.0 - saturate(d.y), 0.5) * mix(frame.ambientBottom, frame.ambientTop, h);
            let lit = frame.sunRadiance * (exp(-tau) * phase + frame.msStrength * ms / (4.0 * PI)) + ambient;
            // Energy-conserving segment integration (albedo 1, so scattering = extinction).
            let stepT = exp(-sigma * ds);
            let w = T * (1.0 - stepT);
            radiance += lit * w;
            depthSum += ts * w;
            weightSum += w;
            T *= stepT;
          }
        }
      }
      t += step;
    }
    if (T < 0.01) { T = 0.0; }
  }

  let meanDistance = select(0.0, depthSum / max(weightSum, 1e-6), weightSum > 1e-3);
  textureStore(marchColor, px, vec4(radiance, T));
  textureStore(marchDepth, px, vec4(meanDistance, sceneEnd, 0.0, 0.0));
}
`;
