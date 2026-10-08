import { FRAME_WGSL } from './frame.wgsl';

/** Group 1 bindings of the temporal resolve (0 Frame and 1 scene depth come from FRAME_WGSL). */
export const TEMPORAL_BINDINGS = {
  trace: 2, traceDepth: 3, hist: 4, histDepth: 5, out: 6, outDepth: 7, params: 8, sampler: 9,
} as const;
/** TemporalParams uniform: mat4 + 2 vec4 = 24 floats. */
export const TEMPORAL_PARAM_FLOATS = 24;
export const TEMPORAL_PARAM_BYTES = TEMPORAL_PARAM_FLOATS * 4;

/**
 * Temporal resolve of one march pass (P5-B; the method of the sky layer's resolve, P3-C2, per pass). The march traced 1/k of the
 * pixels this frame (a checkerboard for k = 2, one pixel of every 2x2 block in Bayer order for k = 4; `frame.temporal`); every
 * pixel of the pass is resolved here from those fresh samples and the previous resolved frame:
 *  - history: reprojected with the previous view-projection through the cloud's mean distance (the pixel's own fresh sample, else the
 *    mean of the fresh neighbours, else its old history, else far away: pure rotation);
 *  - rejection: the history texel's scene distance (z of the depth texture) must match what this pixel sees now, measured from the
 *    previous camera, so history that was behind or in front of a different surface (disocclusion) is dropped, as is anything that
 *    reprojects off screen or behind the camera;
 *  - clip: the history is clamped to mean +- gamma sigma of the fresh samples around the pixel (3x3, 5x5 at k = 4), in proportion to
 *    how far the pixel moved, so a still view keeps its converged (jitter-averaged) history;
 *  - a fresh pixel blends in at `temporalBlend` (more when it moved), the others keep the clipped history; a rejected pixel takes
 *    the nearest fresh sample.
 * On a cut (`frame.temporal.z`) every pixel was traced and is copied. Wind is not compensated: the noise scrolls centimetres a frame.
 * Needs COMMON_WGSL + volumeWgsl(0). Output: colour = premultiplied radiance, a = transmittance; depth = (mean cloud distance or 0,
 * the distance the pixel's ray is marched to, scene distance), the march's format.
 */
export const TEMPORAL_WGSL = /* wgsl */ `
${FRAME_WGSL}
struct TemporalParams {
  prevViewProj: mat4x4<f32>,
  prevCam: vec4<f32>,    // xyz = previous camera position, w = 1 when the previous frame is a valid history
  settings: vec4<f32>,   // x = blend of a fresh sample, y = clip gamma (sigmas), z = relative margin, w = 0
}
@group(1) @binding(${TEMPORAL_BINDINGS.trace}) var traceColor: texture_2d<f32>;
@group(1) @binding(${TEMPORAL_BINDINGS.traceDepth}) var traceDepth: texture_2d<f32>;
@group(1) @binding(${TEMPORAL_BINDINGS.hist}) var histColor: texture_2d<f32>;
@group(1) @binding(${TEMPORAL_BINDINGS.histDepth}) var histDepth: texture_2d<f32>;
@group(1) @binding(${TEMPORAL_BINDINGS.out}) var outColor: texture_storage_2d<rgba16float, write>;
@group(1) @binding(${TEMPORAL_BINDINGS.outDepth}) var outDepth: texture_storage_2d<rgba16float, write>;
@group(1) @binding(${TEMPORAL_BINDINGS.params}) var<uniform> TP: TemporalParams;
@group(1) @binding(${TEMPORAL_BINDINGS.sampler}) var histSampler: sampler;

// passSceneEnd (frame.wgsl.ts) with the four corners of the covered output pixels instead of all of them (the resolve runs on every
// pixel; a feature thinner than a pass pixel that sits between the corners is the only difference).
fn sceneEndCorners(px: vec2<u32>, uv: vec2<f32>) -> f32 {
  let ratio = frame.outputSize / frame.renderSize;
  let lo = vec2<i32>(floor(vec2<f32>(px) * ratio));
  let hi = min(vec2<i32>(ceil(vec2<f32>(px + vec2<u32>(1u)) * ratio)) - vec2<i32>(1), lo + vec2<i32>(3));
  let dmax = vec2<i32>(textureDimensions(sceneDepth)) - vec2<i32>(1);
  let a = textureLoad(sceneDepth, min(lo, dmax), 0);
  let b = textureLoad(sceneDepth, min(vec2<i32>(hi.x, lo.y), dmax), 0);
  let c = textureLoad(sceneDepth, min(vec2<i32>(lo.x, hi.y), dmax), 0);
  let d = textureLoad(sceneDepth, min(hi, dmax), 0);
  return sceneDistance(max(max(a, b), max(c, d)), uv);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(vec2<f32>(gid.xy) >= frame.renderSize)) { return; }
  let px = vec2<i32>(gid.xy);
  let size = vec2<i32>(frame.renderSize);
  let hi = size - vec2<i32>(1);
  let uv = (vec2<f32>(gid.xy) + 0.5) / frame.renderSize;
  let origin = frame.cameraPos;
  let dir = normalize(unprojectDepth(uv, 1.0) - origin);
  // The march's own end distance for this pixel (it must match march.wgsl.ts: the composite rejects taps against it).
  let sceneEnd = sceneEndCorners(gid.xy, uv);
  let interval = volumeRayInterval(origin, dir);
  let tCap = select(FAR_T, frame.splitDistance, frame.passMode == 0u);
  let tEnd = min(min(interval.y, sceneEnd), tCap);

  if (frame.temporal.z > 0.5) {
    textureStore(outColor, px, textureLoad(traceColor, px, 0));
    textureStore(outDepth, px, vec4(textureLoad(traceDepth, px, 0).x * DEPTH_PACK, tEnd, sceneEnd, 0.0) / DEPTH_PACK);
    return;
  }

  let fresh = isTracedPixel(px);
  let k = u32(frame.temporal.x);

  // Reproject through the cloud's mean distance: the pixel's own fresh sample, else its own old history, else far away (rotation only).
  var rd = 1.0e5;
  let own = select(0.0, textureLoad(traceDepth, px, 0).x * DEPTH_PACK, fresh);
  let h0d = textureLoad(histDepth, px, 0).x * DEPTH_PACK;
  if (own > 0.0) { rd = own; } else if (h0d > 0.0) { rd = h0d; }
  let clip = TP.prevViewProj * vec4(origin + dir * rd, 1.0);
  var valid = TP.prevCam.w > 0.5 && clip.w > 1e-3;
  var puv = vec2(0.0);
  if (valid) {
    let ndc = clip.xy / clip.w;
    puv = vec2(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
    valid = all(puv >= vec2(0.0)) && all(puv <= vec2(1.0));
  }
  var hd = vec4(0.0);
  if (valid) {
    // Disocclusion: the surface this pixel sees now, from the previous camera, against what the history texel saw then.
    hd = textureLoad(histDepth, clamp(vec2<i32>(puv * frame.renderSize), vec2<i32>(0), hi), 0) * DEPTH_PACK;
    let nowFar = sceneEnd >= FAR_T;
    let thenFar = hd.z >= FAR_T * 0.99;   // the f16 depth target does not round-trip 1e6 exactly
    if (nowFar != thenFar) { valid = false; }
    else if (!nowFar) {
      let sp = length(origin + dir * sceneEnd - TP.prevCam.xyz);
      valid = abs(sp - hd.z) <= 0.25 * max(sp, hd.z) + 3.0;
    }
  }
  // The clip guards against reprojection error; a still view keeps its converged history (it only bites as much as the pixel moved).
  let moved = select(0.0, smoothstep(0.1, 0.6, length((puv - uv) * frame.renderSize)), valid);

  var result = vec4(0.0, 0.0, 0.0, 1.0);
  var dist = 0.0;
  if (valid && moved <= 0.0) {
    // Static pixel: its history; a fresh sample blends in. No neighbourhood needed (it only guards moving history).
    let history = textureSampleLevel(histColor, histSampler, puv, 0.0);
    result = history;
    dist = hd.x;
    if (fresh) { result = mix(history, textureLoad(traceColor, px, 0), TP.settings.x); dist = own; }
  } else {
    // The fresh samples around the pixel: moments for the clip, the nearest one for a rejected history.
    var m1 = vec4(0.0);
    var m2 = vec4(0.0);
    var n = 0.0;
    var nearC = vec4(0.0, 0.0, 0.0, 1.0);
    var nearD = 0.0;
    if (k >= 4u) {
      // The fresh lattice: one sample per 2x2 block, the pixel's own block in the middle of a 3x3 of blocks.
      let base = (px & vec2<i32>(-2)) + vec2<i32>(bayerOffset(u32(frame.temporal.y)));
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          let q = clamp(base + vec2<i32>(dx, dy) * 2, vec2<i32>(0), hi);
          let c = textureLoad(traceColor, q, 0);
          m1 += c; m2 += c * c; n += 1.0;
          if (dx == 0 && dy == 0) { nearC = c; nearD = textureLoad(traceDepth, q, 0).x * DEPTH_PACK; }
        }
      }
    } else {
      var nearR = 1.0e9;
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          let q = px + vec2<i32>(dx, dy);
          if (any(q < vec2<i32>(0)) || any(q > hi) || !isTracedPixel(q)) { continue; }
          let c = textureLoad(traceColor, q, 0);
          m1 += c; m2 += c * c; n += 1.0;
          let r = f32(dx * dx + dy * dy);
          if (r < nearR) { nearR = r; nearC = c; nearD = textureLoad(traceDepth, q, 0).x * DEPTH_PACK; }
        }
      }
    }
    result = nearC;
    dist = nearD;
    if (valid) {
      let mean = m1 / max(n, 1.0);
      let sigma = sqrt(max(m2 / max(n, 1.0) - mean * mean, vec4(0.0)));
      let margin = TP.settings.y * sigma + TP.settings.z * abs(mean);
      let h0 = textureSampleLevel(histColor, histSampler, puv, 0.0);
      let history = mix(h0, clamp(h0, mean - margin, mean + margin), moved);
      if (fresh) {
        result = mix(history, nearC, mix(TP.settings.x, max(TP.settings.x, 0.6), moved));
      } else {
        result = history;
        dist = hd.x;
      }
    }
  }
  textureStore(outColor, px, result);
  textureStore(outDepth, px, vec4(dist, tEnd, sceneEnd, 0.0) / DEPTH_PACK);
}
`;
