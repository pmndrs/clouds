import { FRAME_WGSL } from './frame.wgsl';
import { lightGridWgsl } from './light-grid.wgsl';
import { atmosphereWgsl } from './atmosphere.wgsl';
import { LIGHTING_WGSL } from './lighting.wgsl';

/** Bindings in the march pass (group 1): the light grid texture + sampler, then the per-frame sky light buffer. */
export const MARCH_LIGHT_GRID_BINDING = 4;
export const MARCH_SKY_LIGHT_BINDING = 6;
/** Near-pass colour, read by the far pass to skip pixels hidden behind opaque near cloud (a dummy texture for the near pass). */
export const MARCH_NEAR_BINDING = 7;
export const MARCH_ATMOSPHERE_GROUP = 2;
/** Radiance written to the half-float targets never exceeds this (f16 max is 65504). */
export const MARCH_RADIANCE_LIMIT = 60000;

/**
 * SDF sphere-trace march with the Nubis lighting model (N3 s110-128) driven by the sky atmosphere (atmosphereWgsl).
 * Concatenate COMMON_WGSL + volumeWgsl(0) + DENSITY_WGSL + MARCH_WGSL. Group 1: 0 Frame, 1 scene depth,
 * 2 colour out (premultiplied radiance, a = transmittance), 3 depth out (rgba16float, distances / DEPTH_PACK: x = transmittance-weighted mean cloud
 * distance or 0, y = distance the ray was marched to, z = scene distance), 4/5 light grid + sampler, 6 sky light (storage).
 * Group 2: the atmosphere (sky LUTs, see atmosphereWgsl).
 *
 * Direct light: transmittance toward the sun = exp(-(tauMicro + tauInline + tauGrid)): a short full-density sample from every lit
 * step (0-microDist m, Q-1: resolves billow-scale self-shadowing, fetched only within MICRO_DEPTH of the SDF surface), two in-line
 * samples of the real up-rezzed density (to 16 m and 16-48 m: keeps surface detail), the rest from the voxel light grid at
 * p + sun * 48 m. The first 16 m also occlude the glow terms (cloudInScatterMicro).
 * Everything is in the sky's exposure units (sunRadiance = sunRadianceAt, ambient = skyAmbient), no literal colours.
 */
export type MarchLightingMode = 'atmosphere' | 'uniform';
/**
 * 'uniform' drops the atmosphere group (no sky library): sun radiance and ambient come only from the skyLight buffer, and the
 * cloud gets no aerial perspective. Pipeline layout is then [volume, pass] only.
 */
export function marchWgsl(mode: MarchLightingMode): string {
  const atm = mode === 'atmosphere';
  return /* wgsl */ `
${FRAME_WGSL}
@group(1) @binding(2) var marchColor: texture_storage_2d<rgba16float, write>;
@group(1) @binding(3) var marchDepth: texture_storage_2d<rgba16float, write>;
${lightGridWgsl(1, MARCH_LIGHT_GRID_BINDING)}
// [0] sun radiance (illuminance, exposure units), [1] sky ambient from above, [2] from below (mean radiance per hemisphere)
@group(1) @binding(${MARCH_SKY_LIGHT_BINDING}) var<storage, read> skyLight: array<vec4<f32>, 3>;
@group(1) @binding(${MARCH_NEAR_BINDING}) var nearColor: texture_2d<f32>;
${atm ? atmosphereWgsl(MARCH_ATMOSPHERE_GROUP) : ''}
${LIGHTING_WGSL}

const STEP_GROWTH_FROM = 256u;
const STEP_MIN = 3.0;
const STEP_SQRT = 0.2;
const SDF_SKIP_MARGIN = 6.0;     // metres: closer than this to the surface, fetch the real distance
const SDF_SKIP_RANGE = 24.0;     // metres: refetch at least this often so the inner-glow remap stays accurate
const DENSE_STEP_GAIN = 3.0;     // P3-E: step *= 1 + gain * (1 - T)^2: samples deep in thick media carry little weight (T * (1 - stepT)), so they are spaced wider
const INLINE_REUSE_DIST = 4.0;   // P3-E: the two in-line sun samples are reused for steps closer than this to where they were taken
const DEPTH_CAP = 0.5;        // fraction of the depth below the surface a widened step may cover
const SPARSE_GAIN = 1.0;   // P3-E: inside the SDF but with almost no density (eroded haze) the step grows by this per consecutive thin sample...
const SPARSE_MAX = 6.0;     // ...up to this many
const SPARSE_THIN = 0.1;   // a sample is thin when sigma * step is below this (optical depth of the segment)
const LIGHT_MIN_OPTICAL_DEPTH = 2.0e-3; // segments thinner than this skip the sun/ambient evaluation
const MICRO_DEPTH = 40.0;   // Q-1: metres below the SDF surface within which the micro sun sample is fetched (the eroded billow shell)

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  // Temporal amortization (P5-B): the dispatch covers only this frame's traced pixels (all of them when k = 1 or on a cut).
  let pxu = tracedPixel(gid.xy);
  if (any(vec2<f32>(pxu) >= frame.renderSize)) { return; }
  let px = vec2<i32>(pxu);
  let uv = (vec2<f32>(pxu) + 0.5) / frame.renderSize;

  // Farthest scene depth over the output pixels this march pixel covers.
  let sceneEnd = passSceneEnd(pxu, uv);

  let origin = frame.cameraPos;
  let dir = normalize(unprojectDepth(uv, 1.0) - origin);
  let interval = volumeRayInterval(origin, dir);
  let isNear = frame.passMode == 0u;
  let tCap = select(FAR_T, frame.splitDistance, isNear);
  let tEnd = min(min(interval.y, sceneEnd), tCap);
  var t = max(interval.x, select(frame.splitDistance, 0.0, isNear));

  // Far pass: pixels whose neighbourhood in the near pass is (almost) opaque contribute nothing; skip them.
  var hidden = false;
  if (!isNear) {
    let nd = vec2<i32>(textureDimensions(nearColor));
    let c = vec2<i32>(floor(uv * vec2<f32>(nd))) - vec2<i32>(1);
    var maxT = 0.0;
    for (var y = 0; y < 4; y++) {
      for (var x = 0; x < 4; x++) { maxT = max(maxT, textureLoad(nearColor, clamp(c + vec2<i32>(x, y), vec2<i32>(0), nd - vec2<i32>(1)), 0).a); }
    }
    hidden = maxT < 0.02;
  }

  var T = 1.0;
  var depthMax = 0.0;   // deepest point below the cloud surface this ray reached (thin silhouettes stay shallow)
  var radiance = vec3(0.0);
  var depthSum = 0.0;
  var weightSum = 0.0;

  if (interval.x <= interval.y && t < tEnd && !hidden) {
    let jitterAnimated = ign(vec2<f32>(pxu), frame.frameIndex);
    let jitterStatic = ign(vec2<f32>(pxu), 0u);
    let cosSun = dot(dir, frame.sunDir);
    let phase = cloudPhase(cosSun);
    let sunRelax = valueRemap(cosSun, 0.0, 0.9, 0.0, 1.0);
    // 1 with the sun behind the viewer, 0 when looking toward it or sideways: where the dark edges apply.
    let frontness = (1.0 - smoothstep(-0.6, 0.1, cosSun));
    let sunRadiance = skyLight[0].xyz;
    let ambientUp = skyLight[1].xyz;
    let ambientDown = skyLight[2].xyz;
    let sunInline0 = frame.sunDir * (0.5 * INLINE_NEAR);
    let sunInline1 = frame.sunDir * (0.5 * (INLINE_NEAR + INLINE_FAR));
    let sunGrid = frame.sunDir * INLINE_FAR;
    let invExtentY = 1.0 / cloudVolume.extent.y;
    var inputs = DensityInputs(frame.wind, frame.mipDistanceScale, frame.baseMip, 0u, frame.wispyBias, frame.detailBias);
    // The in-line sun samples skip the high-frequency fold (they are 8-32 m from the sample, below its scale).
    let lightInputs = DensityInputs(frame.wind, frame.mipDistanceScale, frame.baseMip, 0u, frame.wispyBias, frame.detailBias);
    let sunMicro = frame.sunDir * (0.5 * frame.microDist);
    let microOn = frame.microDist > 0.0;
    var capped = true;
    // Lipschitz bound on the signed distance: |sdf(p + s) - sdf(p)| <= s, so the last fetched value minus the distance
    // travelled since is a conservative (more negative would be wrong) bound while we are deep inside; refetch when it nears 0.
    var sdfBound = 0.0;
    var sdfFetchT = -1.0e9;
    var sparseRun = 0.0;
    var inlineT = -1.0e9;
    var tauInline = 0.0;
    var tauNear = 0.0;   // the 0..INLINE_NEAR m part of tauInline (micro sample excluded)

    for (var i = 0u; i < frame.maxSteps; i++) {
      if (t >= tEnd || T < frame.tCutoff) { capped = false; break; }
      let p = origin + dir * t;
      var sdf = sdfBound + (t - sdfFetchT);   // upper bound of the true distance at t
      if (sdf > -SDF_SKIP_MARGIN || t - sdfFetchT > SDF_SKIP_RANGE) {
        sdf = cloudDistance(p);
        sdfBound = sdf; sdfFetchT = t;
      }
      var step = max(sdf, max(STEP_MIN, sqrt(t) * STEP_SQRT) * frame.stepScale);
      // Never silently truncate a long ray at the step cap: coarsen the step once a ray has used a lot of them.
      {
        // P3-E: widen the step in thin or dark-deep media, but never by more than half the depth below the surface (the SDF is a bound,
        // so such a step stays inside the cloud and cannot skip across a skin or a bulge).
        let wide = step * (1.0 + sparseRun * SPARSE_GAIN) * (1.0 + DENSE_STEP_GAIN * (1.0 - T) * (1.0 - T));
        step = min(wide, max(step, -sdf * DEPTH_CAP));
      }
      if (i > STEP_GROWTH_FROM) { step *= 1.0 + 0.02 * f32(i - STEP_GROWTH_FROM); }
      if (sdf < 0.0) {
        // Jitter moves the sample, not the advance. Animated near the camera, static far away.
        let ts = t + select(jitterStatic, jitterAnimated, t < 250.0) * step;
        let ds = min(step, tEnd - t);
        if (ts < tEnd) {
          inputs.hfDetails = select(0u, 1u, ts < 150.0);
          let ps = origin + dir * ts;
          let d = cloudDensity(ps, ts, inputs);
          sparseRun = select(0.0, min(sparseRun + 1.0, SPARSE_MAX), d.x * frame.extinction * step < SPARSE_THIN);
          if (d.x > 0.0) {
            let sigma = d.x * frame.extinction;
            let stepT = exp(-sigma * ds);
            if (sigma * ds > LIGHT_MIN_OPTICAL_DEPTH) {
              // Optical depth toward the sun: two in-line samples, then the light grid from 48 m on.
              if (ts - inlineT >= INLINE_REUSE_DIST) {
                let d0 = cloudDensity(ps + sunInline0, ts, lightInputs).x;
                let d1 = cloudDensity(ps + sunInline1, ts, lightInputs).x;
                tauNear = d0 * (INLINE_NEAR - frame.microDist) * frame.extinction;
                tauInline = tauNear + d1 * (INLINE_FAR - INLINE_NEAR) * frame.extinction;
                inlineT = ts;
              }
              // Q-1: one short full-density sample toward the sun from every lit step (never reused: it is what resolves the
              // billows). Its optical depth joins the direct term, and the first INLINE_NEAR metres toward the sun also occlude the
              // glow terms (microOcc): multiply-scattered light diffuses only a few metres in dense cloud, so a lobe's shadow side
              // glows less than its lit side. The relaxed, grid-fed tau in the lighting keeps the inner glow of deep interiors.
              // Deeper than the erosion shell the sample's own density stands in for it (the lobes are all within MICRO_DEPTH of the surface).
              var tauMicro = d.x * frame.microDist * frame.extinction;
              if (microOn && sdf > -MICRO_DEPTH) { tauMicro = cloudDensity(ps + sunMicro, ts, inputs).x * frame.microDist * frame.extinction; }
              let microOcc = exp(-frame.microShadow * (tauMicro + tauNear));
              let grid = lightGridSample(ps + sunGrid);
              let tau = tauMicro + tauInline + grid.x * frame.lightDensityScale;
              let h = saturate((ps.y - cloudVolume.minCorner.y) * invExtentY);
              let lit = cloudInScatterMicro(d.y, sdf, h, tau, grid.y, phase, sunRelax, sunRadiance, ambientUp, ambientDown, microOcc);
              depthMax = max(depthMax, -sdf);
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
    if (T < frame.tCutoff) {
      // Early-out at the cutoff: let the remaining light continue as the mean colour of what was accumulated,
      // so a high cutoff does not darken or brighten the ray by the ignored residual (what the sky would show through it).
      radiance /= max(1.0 - T, 0.5);
      T = 0.0;
    }
    radiance *= cloudEdgeFactor(depthMax, frontness);
  }

  let meanDistance = select(0.0, depthSum / max(weightSum, 1e-6), weightSum > 1e-3);
${atm ? `  if (meanDistance > 0.0) {
    // Aerial perspective of the cloud as a whole, at its transmittance-weighted mean distance.
    radiance = applyAerialPerspective(radiance, T, normalize(unprojectDepth(uv, 1.0) - origin), meanDistance);
  }` : ''}
  radiance = clamp(radiance, vec3(0.0), vec3(${MARCH_RADIANCE_LIMIT}.0));
  textureStore(marchColor, px, vec4(radiance, T));
  textureStore(marchDepth, px, vec4(meanDistance, tEnd, sceneEnd, 0.0) / DEPTH_PACK);
}
`;
}
export const MARCH_WGSL = marchWgsl('atmosphere');

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
