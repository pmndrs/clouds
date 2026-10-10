import { FRAME_WGSL } from './frame.wgsl';

/** Group 1 bindings of the temporal resolve (0 Frame and 1 scene depth come from FRAME_WGSL). */
export const TEMPORAL_BINDINGS = {
  trace: 2, traceDepth: 3, hist: 4, histDepth: 5, out: 6, outDepth: 7, params: 8, sampler: 9,
} as const;
/** TemporalParams uniform: mat4 + 3 vec4 = 28 floats. */
export const TEMPORAL_PARAM_FLOATS = 28;
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
 * On a cut the march traces every pixel straight into the history and this pass is skipped (P5-C: no full-size trace target). The fresh samples
 * are kept compactly (traceIndex). The wind's scroll of the noise is compensated (D1 round 8, windCompensate: prevRect.zw).
 * Needs COMMON_WGSL + volumeWgsl(0). Output: colour = premultiplied radiance, a = transmittance; depth = packDepth(mean cloud distance or 0,
 * the distance the pixel's ray is marched to, scene distance), the march's direct format (r32uint).
 */
export const TEMPORAL_WGSL = /* wgsl */ `
${FRAME_WGSL}
struct TemporalParams {
  prevViewProj: mat4x4<f32>,
  prevCam: vec4<f32>,    // xyz = previous camera position, w = 1 when the previous frame is a valid history
  settings: vec4<f32>,   // x = blend of a fresh sample, y = clip gamma (sigmas), z = relative margin, w = historyDither (D1 round 7, see main)
  prevRect: vec4<f32>,   // xy = this pass's rendered size last frame (dynamic resolution moves the grid), zw = the wind's world displacement (x, z) since the previous frame (D1 round 8, windCompensate)
}
@group(1) @binding(${TEMPORAL_BINDINGS.trace}) var traceColor: texture_2d<f32>;
@group(1) @binding(${TEMPORAL_BINDINGS.traceDepth}) var traceDepth: texture_2d<f32>;
@group(1) @binding(${TEMPORAL_BINDINGS.hist}) var histColor: texture_2d<f32>;
@group(1) @binding(${TEMPORAL_BINDINGS.histDepth}) var histDepth: texture_2d<u32>;
@group(1) @binding(${TEMPORAL_BINDINGS.out}) var outColor: texture_storage_2d<rgba16float, write>;
@group(1) @binding(${TEMPORAL_BINDINGS.outDepth}) var outDepth: texture_storage_2d<r32uint, write>;
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

// The trace holds only the traced pixels, compactly: k = 2 packs each row's every second pixel, k = 4 one pixel per 2x2 block.
// D1 (temporalAccumulate): at k = 1 the trace is full size (every pixel fresh every frame) and the resolve is an exponential average over
// the still view's jitter, the TAA Decima's frames have; without it a k = 1 frame is one jittered sample set (the IGN whorls in every surface).
fn traceIndex(q: vec2<i32>) -> vec2<i32> {
  let k = u32(frame.temporal.x);
  if (k <= 1u) { return q; }
  return select(vec2<i32>(q.x >> 1u, q.y >> 1u), vec2<i32>(q.x >> 1u, q.y), k == 2u);
}
fn traceColorAt(q: vec2<i32>) -> vec4<f32> { return textureLoad(traceColor, traceIndex(q), 0); }
fn traceDistAt(q: vec2<i32>) -> f32 { return textureLoad(traceDepth, traceIndex(q), 0).x; }

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(vec2<f32>(gid.xy) >= frame.renderSize)) { return; }
  let px = vec2<i32>(gid.xy);
  let uv = (vec2<f32>(gid.xy) + 0.5) / frame.renderSize;
  let origin = frame.cameraPos;
  let dir = normalize(unprojectDepth(uv, 1.0) - origin);
  // The march's own end distance for this pixel (it must match march.wgsl.ts: the composite rejects taps against it).
  let sceneEnd = sceneEndCorners(gid.xy, uv);
  let interval = volumeRayInterval(origin, dir);
  let tCap = select(frame.misc.y, frame.splitDistance, frame.passMode == 0u);
  let tEnd = min(min(interval.y, sceneEnd), tCap);

  let fresh = isTracedPixel(px);
  let k = u32(frame.temporal.x);
  // The history is a texture allocated at the pass's full size, of which the previous frame filled the top-left prevSize pixels.
  let prevSize = TP.prevRect.xy;
  let prevHi = vec2<i32>(prevSize) - vec2<i32>(1);
  let texDims = select(frame.texDims.zw, frame.texDims.xy, frame.passMode == 0u);

  // Reproject through the cloud's mean distance: the pixel's own fresh sample, else its own old history, else far away (rotation only).
  var rd = 1.0e5;
  let own = select(0.0, traceDistAt(px), fresh);
  let h0d = depthWordX(textureLoad(histDepth, clamp(vec2<i32>(uv * prevSize), vec2<i32>(0), prevHi), 0).x);
  if (own > 0.0) { rd = own; } else if (h0d > 0.0) { rd = h0d; }
  // D1 round 8 (windCompensate): the up-rez noise scrolls with the wind (density.wgsl.ts samples it at p - wind), so the detail this pixel sees now
  // was, last frame, at p - (wind_now - wind_prev); reprojecting there keeps the exponential resolve from smearing the florets along the wind
  // (at 3.4 m/s the 10-20 frame window moved them 2-4 px at 4k, which halved the 4-12 px energy of the lit crests). The profile does not move,
  // so the lobe shading is read 2-4 px off, well under its 30-80 px scale.
  // The camera-only reprojection decides validity and how far the pixel moved; the wind shift (a fraction of a pixel per frame) only moves where
  // the history is read, so that it is not taken for camera motion (which would clip and partly reset the history every frame).
  let world = origin + dir * rd;
  let clip = TP.prevViewProj * vec4(world, 1.0);
  let clipW = TP.prevViewProj * vec4(world - vec3(TP.prevRect.z, 0.0, TP.prevRect.w), 1.0);
  var valid = TP.prevCam.w > 0.5 && clip.w > 1e-3 && clipW.w > 1e-3;
  var puv = vec2(0.0);
  var puvW = vec2(0.0);
  if (valid) {
    let ndc = clip.xy / clip.w;
    puv = vec2(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
    let ndcW = clipW.xy / clipW.w;
    puvW = vec2(ndcW.x * 0.5 + 0.5, 0.5 - ndcW.y * 0.5);
    valid = all(puv >= vec2(0.0)) && all(puv <= vec2(1.0)) && all(puvW >= vec2(0.0)) && all(puvW <= vec2(1.0));
  }
  var hdx = 0.0;
  if (valid) {
    // Disocclusion: the surface this pixel sees now, from the previous camera, against what the history texel saw then.
    let hw = textureLoad(histDepth, clamp(vec2<i32>(puv * prevSize), vec2<i32>(0), prevHi), 0).x;
    let hdz = depthWordZ(hw);
    hdx = depthWordX(hw);
    let nowFar = sceneEnd >= FAR_T;
    let thenFar = hdz >= FAR_T * 0.99;
    if (nowFar != thenFar) { valid = false; }
    else if (!nowFar) {
      let sp = length(origin + dir * sceneEnd - TP.prevCam.xyz);
      valid = abs(sp - hdz) <= 0.25 * max(sp, hdz) + 3.0;
    }
  }
  // Bilinear history at the reprojected position, kept inside the previous frame's rectangle of the (possibly larger) texture.
  let histUv = clamp(puvW * prevSize, vec2(0.5), prevSize - vec2(0.5)) / texDims;
  // The clip guards against reprojection error; a still view keeps its converged history (it only bites as much as the pixel moved).
  let moved = select(0.0, smoothstep(0.1, 0.6, length((puv - uv) * frame.renderSize)), valid);

  var result = vec4(0.0, 0.0, 0.0, 1.0);
  var dist = 0.0;
  if (valid && moved <= 0.0) {
    // Static pixel: its history; a fresh sample blends in. No neighbourhood needed (it only guards moving history).
    let history = textureSampleLevel(histColor, histSampler, histUv, 0.0);
    result = history;
    dist = hdx;
    if (fresh) { result = mix(history, traceColorAt(px), TP.settings.x); dist = own; }
  } else {
    // The fresh samples around the pixel: moments for the clip, the nearest one for a rejected history.
    let hi = vec2<i32>(frame.renderSize) - vec2<i32>(1);
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
          let c = traceColorAt(q);
          m1 += c; m2 += c * c; n += 1.0;
          if (dx == 0 && dy == 0) { nearC = c; nearD = traceDistAt(q); }
        }
      }
    } else {
      var nearR = 1.0e9;
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          let q = px + vec2<i32>(dx, dy);
          if (any(q < vec2<i32>(0)) || any(q > hi) || !isTracedPixel(q)) { continue; }
          let c = traceColorAt(q);
          m1 += c; m2 += c * c; n += 1.0;
          let r = f32(dx * dx + dy * dy);
          if (r < nearR) { nearR = r; nearC = c; nearD = traceDistAt(q); }
        }
      }
    }
    result = nearC;
    dist = nearD;
    if (valid) {
      let mean = m1 / max(n, 1.0);
      let sigma = sqrt(max(m2 / max(n, 1.0) - mean * mean, vec4(0.0)));
      let margin = TP.settings.y * sigma + TP.settings.z * abs(mean);
      let h0 = textureSampleLevel(histColor, histSampler, histUv, 0.0);
      let history = mix(h0, clamp(h0, mean - margin, mean + margin), moved);
      if (fresh) {
        result = mix(history, nearC, mix(TP.settings.x, max(TP.settings.x, 0.6), moved));
      } else {
        result = history;
        dist = hdx;
      }
    }
  }
  // D1 round 7 (historyDither): the history is rgba16float; at blend 0.1 the update stalls once |fresh - history| is under 5 ulp (0.0025 at
  // 0.5-1.0, over half an 8-bit step), so a converged bright face sits at whichever of a few levels its path ended on: concentric contour
  // rings on the lit tops. Stochastic rounding (a uniform +-0.5 ulp per channel, per pixel and frame) makes the stored mean unbiased.
  if (TP.settings.w > 0.5) {
    let h = vec4(hash01(pcg(gid.x * 1973u + gid.y * 9277u + frame.frameIndex * 26699u)), hash01(pcg(gid.x * 7919u + gid.y * 104729u + frame.frameIndex * 3331u)),
                 hash01(pcg(gid.x * 2459u + gid.y * 6271u + frame.frameIndex * 7793u)), hash01(pcg(gid.x * 4201u + gid.y * 3061u + frame.frameIndex * 1181u)));
    let mag = max(abs(result), vec4(1.0e-6));
    let ulp = exp2(floor(log2(mag)) - 10.0);
    result += (h - 0.5) * ulp;
  }
  textureStore(outColor, px, result);
  textureStore(outDepth, px, vec4<u32>(packDepth(dist, tEnd, sceneEnd), 0u, 0u, 0u));
}
`;
