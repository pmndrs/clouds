import { FRAME_WGSL } from './frame.wgsl';
import { lightGridWgsl } from './light-grid.wgsl';
import { cloudShadowMapWgsl } from './shadow-map.wgsl';

export const COMPOSITE_LIGHT_GRID_BINDING = 7;
/**
 * Distant sky layer: front colour, depth, back colour at this binding, +1, +2 (always bound; frame.skyEnabled gates the merge,
 * so with the layer off the output is bit-identical). The layer is split at the voxel box (sky-layer.wgsl.ts): front = the cloud
 * between the camera and the box, back = the cloud beyond it, both premultiplied, so the merge is front over voxel over back.
 */
export const COMPOSITE_SKY_BINDING = 9;
/** Cloud shadow map (shadow-map.wgsl.ts): uniform at this binding, near cascade at +1, far at +2. */
export const COMPOSITE_SHADOW_BINDING = 14;
/**
 * P9-E high cloud layer (cirrus/index.ts): its premultiplied colour (a = transmittance; for opaque pixels nearer than the layer, a = its optional
 * ground shadow) at this binding, a read-only storage buffer of two pack2x16float words per composite pixel, row-major (the composite is at the
 * per-stage sampled-texture limit of 16); at +1 a vec4 uniform: x = on, y = the camera is above the layer (it is then in front).
 * Off: x = 0 and a 1x1 placeholder, so the output is unchanged.
 */
export const COMPOSITE_CIRRUS_BINDING = 17;
/** Linear sampler (colour) at this binding, a non-filtering one (depth gather) at +1. */
export const COMPOSITE_SAMPLER_BINDING = 12;

/**
 * Depth-aware upsample of the near and far march outputs to output resolution, merged front to back
 * (rgb = near.rgb + near.a * far.rgb, a = near.a * far.a). Per-pass bindings are group 1:
 * 0 Frame, 1 scene depth, 2/3 near colour/depth, 4 output (rgba16float), 5/6 far colour/depth
 * (depth textures are rgba16float x DEPTH_PACK, see march.wgsl.ts: x = mean cloud distance or 0, y = the distance the ray was marched to, z = scene distance).
 * Output is what the caller blends: scene * a + rgb.
 *
 * Cloud shadows: for opaque-depth pixels the optical depth along the sun ray comes from the cloud shadow map (P10-A: the voxel box
 * and the sky layer's clouds out to the horizon, shadow-map.wgsl.ts). Until the map holds a complete refresh, or with it off, the
 * sun ray is intersected with the volume box and the light grid (summed sun optical depth, already times densityScale) is read just
 * inside the entry point. shadow = mix(1, 0.8 exp(-tau) + 0.2 exp(-tau/4), shadowStrength) is folded into a, so scene * a + rgb
 * darkens the surface. Sky pixels are never shadowed. The debug views (map.misc.z) draw the map's tau contour as an outline.
 *
 * A tap whose march ended before this pixel's own march would have (min of volume exit, scene, pass limit) was cut short by a
 * nearer surface and carries no information about this pixel: it is skipped. A tap whose cloud lies behind this pixel's
 * surface is replaced by "no cloud". A pixel whose ray misses the volume box accepts every tap (box edges are not surfaces).
 */
export const COMPOSITE_WGSL = /* wgsl */ `
${FRAME_WGSL}
@group(1) @binding(2) var nearColor: texture_2d<f32>;
@group(1) @binding(3) var nearDepth: texture_2d<u32>;
@group(1) @binding(4) var outputTex: texture_storage_2d<rgba16float, write>;
@group(1) @binding(5) var farColor: texture_2d<f32>;
@group(1) @binding(6) var farDepth: texture_2d<u32>;
@group(1) @binding(${COMPOSITE_SAMPLER_BINDING}) var linSampler: sampler;
@group(1) @binding(${COMPOSITE_SAMPLER_BINDING + 1}) var gatherSampler: sampler;
${lightGridWgsl(1, COMPOSITE_LIGHT_GRID_BINDING)}
@group(1) @binding(${COMPOSITE_SKY_BINDING}) var skyColor: texture_2d<f32>;
@group(1) @binding(${COMPOSITE_SKY_BINDING + 1}) var skyDepth: texture_2d<f32>;
@group(1) @binding(${COMPOSITE_SKY_BINDING + 2}) var skyBack: texture_2d<f32>;

${cloudShadowMapWgsl(1, COMPOSITE_SHADOW_BINDING)}
@group(1) @binding(${COMPOSITE_CIRRUS_BINDING}) var<storage, read> cirrusColor: array<vec2<u32>>;
@group(1) @binding(${COMPOSITE_CIRRUS_BINDING + 1}) var<uniform> cirrusOn: vec4<f32>;

// The fallback: the light grid read where the sun ray enters the volume box (voxel region only).
fn cloudShadowGridTau(p: vec3<f32>) -> f32 {
  let sun = frame.sunDir;
  let iv = volumeRayInterval(p, sun);
  if (iv.x > iv.y || iv.y <= 0.0) { return 0.0; }
  // Enter the box, then step one voxel in so the trilinear tap is not half clamped to the zero outside.
  let t = min(max(iv.x, 0.0) + 1.5 * cloudVolume.voxelSize, 0.5 * (max(iv.x, 0.0) + iv.y));
  return lightGridSample(p + sun * t).x * frame.lightDensityScale;
}

fn cloudShadow(p: vec3<f32>) -> f32 {
  let sun = frame.sunDir;
  if (frame.shadowStrength <= 0.0 || sun.y <= 0.0) { return 1.0; }
  var tau = 0.0;
  if (cloudShadowValid()) { tau = cloudShadowTau(p); } else { tau = cloudShadowGridTau(p); }
  let soft = 0.8 * exp(-tau) + 0.2 * exp(-tau * 0.25);
  return mix(1.0, soft, frame.shadowStrength);
}

// P5-C. The march depth words are compared as codes (frame.wgsl.ts packDepth): the thresholds below are coded once per pixel.
// Fast path: one gather of the four taps' depth words, and when none is skipped or replaced (almost every pixel) a single hardware
// bilinear sample of the colour. Otherwise the per-tap loop. The pass textures may be bigger than the rendered rectangle (dynamic
// resolution), so the footprint is clamped to the rectangle by hand.
fn upsample(colorTex: texture_2d<f32>, depthTex: texture_2d<u32>, uv: vec2<f32>, rect: vec2<f32>, tex: vec2<f32>, yThr: u32, xThr: u32, strict: bool) -> vec4<f32> {
  let m = uv * rect - 0.5;
  let s = clamp(floor(m), vec2(0.0), max(rect - 2.0, vec2(0.0)));
  let w1 = clamp(m - s, vec2(0.0), vec2(1.0));
  let g = textureGather(0, depthTex, gatherSampler, (s + 1.0) / tex);   // (x0,y1) (x1,y1) (x1,y0) (x0,y0)
  let words = vec4<u32>(g.w, g.z, g.x, g.y);
  var clean = true;
  for (var i = 0; i < 4; i++) {
    let w = words[i];
    let behind = (w & 2047u) > xThr;   // xThr >= 0, and a code of 0 (no cloud) is never above it
    let cut = strict && ((w >> 11u) & 2047u) < yThr;
    if (behind || cut) { clean = false; }
  }
  if (clean) { return textureSampleLevel(colorTex, linSampler, (s + w1 + 0.5) / tex, 0.0); }
  var acc = vec4(0.0);
  var wsum = 0.0;
  for (var i = 0; i < 4; i++) {
    let o = vec2<f32>(f32(i & 1), f32(i >> 1));
    let w = mix(1.0 - w1.x, w1.x, o.x) * mix(1.0 - w1.y, w1.y, o.y);
    let word = words[i];
    if (strict && ((word >> 11u) & 2047u) < yThr) { continue; }
    var c = textureLoad(colorTex, vec2<i32>(s + o), 0);
    if ((word & 2047u) > xThr) { c = vec4(0.0, 0.0, 0.0, 1.0); }
    acc += c * w; wsum += w;
  }
  if (wsum > 1e-4) { return acc / wsum; }
  // Every tap was skipped: the nearest one, replaced only if its cloud is behind the surface.
  let n = vec2<i32>(clamp(round(m), vec2(0.0), rect - 1.0));
  var c = textureLoad(colorTex, n, 0);
  if ((textureLoad(depthTex, n, 0).x & 2047u) > xThr) { c = vec4(0.0, 0.0, 0.0, 1.0); }
  return c;
}

// Distant sky layer: merged per tap (front over the voxel result over back), then bilinear. Interpolating front and back
// separately would leave cross terms where a cloud moves between the two textures across adjacent texels (rays that just graze
// the box split there, their neighbours do not): 0.5c over 0.5c is not c. Per-tap merging makes both assignments identical.
fn mergeSky(voxel: vec4<f32>, uv: vec2<f32>, sceneT: f32) -> vec4<f32> {
  let size = vec2<f32>(textureDimensions(skyColor));
  let m = uv * size - 0.5;
  let b = floor(m);
  let f = m - b;
  let hi = vec2<i32>(size) - vec2<i32>(1);
  var acc = vec4(0.0);
  var wsum = 0.0;
  var nearest = vec4(0.0);
  for (var i = 0; i < 4; i++) {
    let o = vec2<f32>(f32(i & 1), f32(i >> 1));
    let w = mix(1.0 - f.x, f.x, o.x) * mix(1.0 - f.y, f.y, o.y);
    let tap = clamp(vec2<i32>(b + o), vec2<i32>(0), hi);
    let d = textureLoad(skyDepth, tap, 0);
    var front = textureLoad(skyColor, tap, 0);
    var back = textureLoad(skyBack, tap, 0);
    // C2: the share of the layer's cloud in front of this pixel's surface, from the opacity distribution along the ray (mean d.z, spread d.w):
    // a linear stand-in for the normal CDF over +-1.25 sigma. With no spread it is the old test at the mean (cloud behind the surface dropped).
    if (d.z > 0.0 && sceneT < FAR_T) {
      let inFront = saturate(0.5 + 0.4 * (sceneT * 1.02 + 1.0 - d.z) / max(d.w, 1.0));
      front = vec4(front.rgb * inFront, 1.0 - (1.0 - front.a) * inFront);
      back = vec4(back.rgb * inFront, 1.0 - (1.0 - back.a) * inFront);
    }
    let c = vec4(front.rgb + front.a * (voxel.rgb + voxel.a * back.rgb), front.a * voxel.a * back.a);
    if (i == 0 || ((f.x >= 0.5) == (o.x > 0.5) && (f.y >= 0.5) == (o.y > 0.5))) { nearest = c; }
    if (d.y < sceneT * 0.97 - 1.0) { continue; }   // this tap's rays stopped at a nearer surface than this pixel's
    acc += c * w; wsum += w;
  }
  if (wsum > 1e-4) { return acc / wsum; }
  return nearest;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  // frame.misc.zw = the composite's own size (P5-C: a tier may composite below the scene's resolution; the consumer upsamples). Its pixel covers
  // ratio x ratio scene pixels and sees the farthest of them (up to 4 x 4), as the march passes do.
  let cs = frame.misc.zw;
  if (any(vec2<f32>(gid.xy) >= cs)) { return; }
  let uv = (vec2<f32>(gid.xy) + 0.5) / cs;
  var sceneDepthMax = 0.0;
  if (cs.x >= frame.outputSize.x) {
    sceneDepthMax = textureLoad(sceneDepth, vec2<i32>(gid.xy), 0);
  } else {
    let ratio = frame.outputSize / cs;
    let lo = vec2<i32>(floor(vec2<f32>(gid.xy) * ratio));
    let hi = min(vec2<i32>(ceil(vec2<f32>(gid.xy + vec2<u32>(1u)) * ratio)) - vec2<i32>(1), lo + vec2<i32>(3));
    let dmax = vec2<i32>(textureDimensions(sceneDepth)) - vec2<i32>(1);
    for (var y = lo.y; y <= hi.y; y++) {
      for (var x = lo.x; x <= hi.x; x++) { sceneDepthMax = max(sceneDepthMax, textureLoad(sceneDepth, min(vec2<i32>(x, y), dmax), 0)); }
    }
  }
  let sceneT = sceneDistance(sceneDepthMax, uv);

  let origin = frame.cameraPos;
  let dir = normalize(unprojectDepth(uv, 1.0) - origin);
  let interval = volumeRayInterval(origin, dir);
  let hit = interval.x <= interval.y;
  let volumeEnd = select(0.0, min(interval.y, sceneT), hit);   // 0 disables the tap rejection
  let split = frame.splitDistance;

  // A ray that misses the voxel box has no voxel cloud: the march traced exactly nothing there, so skip the upsamples (P5-B).
  var result = vec4(0.0, 0.0, 0.0, 1.0);
  if (hit) {
    let xThr = depthCode(sceneT * 1.02 + 1.0, DEPTH_XY_MAX);
    let nearEnd = min(volumeEnd, split);
    var near = vec4(0.0, 0.0, 0.0, 1.0);   // splitDistance 0: no near pass, the far one covers the whole ray
    if (split > 0.0) { near = upsample(nearColor, nearDepth, uv, frame.rects.xy, frame.texDims.xy, depthCode(nearEnd * 0.97 - 1.0, DEPTH_XY_MAX), xThr, true); }
    result = near;
    // The far layer only matters where the near layer lets light through and the ray reaches past the split.
    if (near.a > 0.004 && volumeEnd > split) {
      let far = upsample(farColor, farDepth, uv, frame.rects.zw, frame.texDims.zw, depthCode(min(volumeEnd, frame.misc.y) * 0.97 - 1.0, DEPTH_XY_MAX), xThr, true);
      result = vec4(near.rgb + near.a * far.rgb, near.a * far.a);
    }
  }
  if (frame.skyEnabled > 0.5) {
    // Distant sky layer (sky-layer.wgsl.ts): the part in front of the voxel box over the voxel result over the part behind it.
    result = mergeSky(result, uv, sceneT);
  }
  if (cirrusOn.x > 0.5) {
    // P9-E: the high layer is the farthest cloud: behind everything merged so far, or in front of it all when the camera is above it.
    let w = cirrusColor[gid.y * u32(cs.x) + gid.x];
    let c = vec4(unpack2x16float(w.x), unpack2x16float(w.y));
    if (cirrusOn.y > 0.5) { result = vec4(c.rgb + c.a * result.rgb, c.a * result.a); }
    else { result = vec4(result.rgb + result.a * c.rgb, result.a * c.a); }
  }
  // The shadow darkens only the surface term (scene * a). Applied after the sky merge so that the sky layer's cloud behind or in front of the
  // surface keeps its own colour: folding it into the voxel alpha before the merge scaled the sky 'back' radiance too (grey ghosts over distant cloud).
  if (sceneT < FAR_T) { result.a *= cloudShadow(origin + dir * sceneT); }
  if (csMap.misc.z > 0.5 && cloudShadowValid()) {
    // Debug: the tau contour of the map as a flat colour. 1: where the ground is. 2: where the view ray crosses the shell's base plane.
    var q = vec2(0.0);
    var on = false;
    if (csMap.misc.z < 1.5) {
      on = sceneT < FAR_T;
      q = cloudShadowPlanePoint(origin + dir * sceneT);
    } else if (abs(dir.y) > 1e-4) {
      let th = (csMap.sun.w - origin.y) / dir.y;
      on = th > 0.0 && th < min(sceneT, 80000.0);
      q = (origin + dir * th).xz;
    }
    if (on && cloudShadowOutline(q) > 0.5) {
      let c = select(vec3(1.0, 0.1, 0.9), vec3(0.1, 1.0, 0.9), csMap.misc.z > 1.5);
      result = vec4(c * csMap.work2.w, 0.0);
    }
  }
  textureStore(outputTex, vec2<i32>(gid.xy), result);
}
`;
