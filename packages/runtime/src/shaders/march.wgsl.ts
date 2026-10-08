import { FRAME_WGSL } from './frame.wgsl';
import { lightGridWgsl } from './light-grid.wgsl';
import { atmosphereWgsl } from './atmosphere.wgsl';

/** Bindings in the march pass (group 1): the light grid texture + sampler, then the per-frame sky light buffer. */
export const MARCH_LIGHT_GRID_BINDING = 4;
export const MARCH_SKY_LIGHT_BINDING = 6;
export const MARCH_ATMOSPHERE_GROUP = 2;
/** Radiance written to the half-float targets never exceeds this (f16 max is 65504). */
export const MARCH_RADIANCE_LIMIT = 60000;

/**
 * SDF sphere-trace march with the Nubis lighting model (N3 s110-128) driven by the sky atmosphere (atmosphereWgsl).
 * Concatenate COMMON_WGSL + volumeWgsl(0) + DENSITY_WGSL + MARCH_WGSL. Group 1: 0 Frame, 1 scene depth,
 * 2 colour out (premultiplied radiance, a = transmittance), 3 depth out (rg32float: x = transmittance-weighted mean cloud
 * distance or 0, y = scene distance the ray was marched against), 4/5 light grid + sampler, 6 sky light (storage).
 * Group 2: the atmosphere (sky LUTs, see atmosphereWgsl).
 *
 * Direct light: transmittance toward the sun = exp(-(tauInline + tauGrid)): two short in-line samples of the real up-rezzed
 * density (0-16 m, 16-48 m: keeps surface detail), the rest from the voxel light grid at p + sun * 48 m.
 * Everything is in the sky's exposure units (sunRadiance = sunRadianceAt, ambient = skyAmbient), no literal colours.
 */
export const MARCH_WGSL = /* wgsl */ `
${FRAME_WGSL}
@group(1) @binding(2) var marchColor: texture_storage_2d<rgba16float, write>;
@group(1) @binding(3) var marchDepth: texture_storage_2d<rg32float, write>;
${lightGridWgsl(1, MARCH_LIGHT_GRID_BINDING)}
// [0] sun radiance (illuminance, exposure units), [1] sky ambient from above, [2] from below (mean radiance per hemisphere)
@group(1) @binding(${MARCH_SKY_LIGHT_BINDING}) var<storage, read> skyLight: array<vec4<f32>, 3>;
${atmosphereWgsl(MARCH_ATMOSPHERE_GROUP)}

const INLINE_NEAR = 16.0;   // first in-line sun sample covers 0..16 m
const INLINE_FAR = 48.0;    // second covers 16..48 m, the grid takes over from there
// Art-tuned against the Tidewater captures: the knobs (msStrength, ambientStrength) stay 1 by default.
const MS_NORMALISATION = 3.0 / (4.0 * PI);
const AMBIENT_GAIN = 1.5;
const STEP_GROWTH_FROM = 256u;

fn henyeyGreenstein(cosTheta: f32, g: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
}
// HG(g = phaseG) with an art-directable forward lobe (silver lining).
fn cloudPhase(cosTheta: f32) -> f32 {
  return mix(henyeyGreenstein(cosTheta, frame.phaseG), henyeyGreenstein(cosTheta, frame.silverG), frame.silverStrength);
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
    let sunRelax = valueRemap(cosSun, 0.0, 0.9, 0.0, 1.0);
    let sunRadiance = skyLight[0].xyz;
    let ambientUp = skyLight[1].xyz;
    let ambientDown = skyLight[2].xyz;
    var inputs = DensityInputs(frame.wind, frame.mipDistanceScale, frame.baseMip, 0u, 0.0, 0.0);
    // The in-line sun samples skip the high-frequency fold (they are 8-32 m from the sample, below its scale).
    let lightInputs = DensityInputs(frame.wind, frame.mipDistanceScale, frame.baseMip, 0u, 0.0, 0.0);
    var capped = true;

    for (var i = 0u; i < frame.maxSteps; i++) {
      if (t >= tEnd || T < 0.01) { capped = false; break; }
      let p = origin + dir * t;
      let sdf = cloudDistance(p);
      var step = max(sdf, max(1.0, sqrt(t) * 0.08));
      // Never silently truncate a long ray at the step cap: coarsen the step once a ray has used a lot of them.
      if (i > STEP_GROWTH_FROM) { step *= 1.0 + 0.02 * f32(i - STEP_GROWTH_FROM); }
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
            let stepT = exp(-sigma * ds);
            if (sigma * ds > 1.0e-4) {
              // Optical depth toward the sun: two in-line samples, then the light grid from 48 m on.
              let d0 = cloudDensity(ps + frame.sunDir * (0.5 * INLINE_NEAR), ts, lightInputs).x;
              let d1 = cloudDensity(ps + frame.sunDir * (0.5 * (INLINE_NEAR + INLINE_FAR)), ts, lightInputs).x;
              let tauInline = (d0 * INLINE_NEAR + d1 * (INLINE_FAR - INLINE_NEAR)) * frame.extinction;
              let grid = lightGridSample(ps + frame.sunDir * INLINE_FAR);
              let tau = tauInline + grid.x * frame.lightDensityScale;
              // Inner glow: the profile is an in-scatter probability; extinction relaxes deep inside and toward the sun.
              let relax = mix(0.25, valueRemap(sdf, -128.0, 0.0, 0.05, 0.25), sunRelax);
              let ms = d.y * exp(-tau * relax);
              // Ambient: dark where the profile is high, sky light attenuated by the density above, ground light from below.
              let h = saturate((ps.y - cloudVolume.minCorner.y) / cloudVolume.extent.y);
              let tauUp = grid.y * frame.lightDensityScale * frame.ambientExtinction;
              let skyAbove = ambientUp * exp(-tauUp);
              let ambient = AMBIENT_GAIN * frame.ambientStrength * pow(1.0 - saturate(d.y), 0.5) * mix(ambientDown, skyAbove, 0.3 + 0.7 * h);
              let lit = sunRadiance * (exp(-tau) * phase + frame.msStrength * ms * MS_NORMALISATION) + ambient;
              // Energy-conserving segment integration (albedo 1, so scattering = extinction).
              let w = T * (1.0 - stepT);
              radiance += lit * w;
              depthSum += ts * w;
              weightSum += w;
            }
            T *= stepT;
          }
        }
      }
      t += step;
    }
    // Ran out of steps with cloud left to march: finish thin remainders rather than dropping them as transparent.
    if (capped && t < tEnd && T < 0.3) { T = 0.0; }
    if (T < 0.01) { T = 0.0; }
  }

  let meanDistance = select(0.0, depthSum / max(weightSum, 1e-6), weightSum > 1e-3);
  if (meanDistance > 0.0) {
    // Aerial perspective of the cloud as a whole, at its transmittance-weighted mean distance.
    radiance = applyAerialPerspective(radiance, T, normalize(unprojectDepth(uv, 1.0) - origin), meanDistance);
  }
  radiance = clamp(radiance, vec3(0.0), vec3(${MARCH_RADIANCE_LIMIT}.0));
  textureStore(marchColor, px, vec4(radiance, T));
  textureStore(marchDepth, px, vec4(meanDistance, sceneEnd, 0.0, 0.0));
}
`;

/** One thread per frame: sun radiance and sky ambient at the volume centre -> a small buffer the march reads. */
export const SKY_LIGHT_BINDING = 0;
export const SKY_LIGHT_WGSL = /* wgsl */ `
@group(1) @binding(${SKY_LIGHT_BINDING}) var<storage, read_write> skyLightOut: array<vec4<f32>, 3>;
${atmosphereWgsl(MARCH_ATMOSPHERE_GROUP)}

@compute @workgroup_size(1)
fn main() {
  let c = cloudVolume.minCorner + cloudVolume.extent * 0.5;
  let a = skyAmbient(c);
  skyLightOut[0] = vec4(sunRadianceAt(c), 0.0);
  skyLightOut[1] = vec4(a.upper, 0.0);
  skyLightOut[2] = vec4(a.lower, 0.0);
}
`;
