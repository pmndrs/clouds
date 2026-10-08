import { FRAME_WGSL } from './frame.wgsl';

/**
 * Depth-aware upsample of the near and far march outputs to output resolution, merged front to back
 * (rgb = near.rgb + near.a * far.rgb, a = near.a * far.a). Per-pass bindings are group 1:
 * 0 Frame, 1 scene depth, 2/3 near colour/depth, 4 output (rgba16float), 5/6 far colour/depth
 * (depth textures are rg32float, see march.wgsl.ts: x = mean cloud distance or 0, y = the distance the ray was marched to).
 * Output is what the caller blends: scene * a + rgb.
 *
 * A tap whose march ended before this pixel's own march would have (min of volume exit, scene, pass limit) was cut short by a
 * nearer surface and carries no information about this pixel: it is skipped. A tap whose cloud lies behind this pixel's
 * surface is replaced by "no cloud". A pixel whose ray misses the volume box accepts every tap (box edges are not surfaces).
 */
export const COMPOSITE_WGSL = /* wgsl */ `
${FRAME_WGSL}
@group(1) @binding(2) var nearColor: texture_2d<f32>;
@group(1) @binding(3) var nearDepth: texture_2d<f32>;
@group(1) @binding(4) var outputTex: texture_storage_2d<rgba16float, write>;
@group(1) @binding(5) var farColor: texture_2d<f32>;
@group(1) @binding(6) var farDepth: texture_2d<f32>;

fn tapResult(colorTex: texture_2d<f32>, depthTex: texture_2d<f32>, tap: vec2<i32>, sceneT: f32, pixelEnd: f32, strict: bool) -> vec4<f32> {
  // w < 0 marks a skipped tap
  let d = textureLoad(depthTex, tap, 0).xy;
  if (strict && d.y < pixelEnd * 0.97 - 1.0) { return vec4(0.0, 0.0, 0.0, -1.0); }
  var c = textureLoad(colorTex, tap, 0);
  if (d.x > 0.0 && d.x > sceneT * 1.02 + 1.0) { c = vec4(0.0, 0.0, 0.0, 1.0); }
  return c;
}

fn upsample(colorTex: texture_2d<f32>, depthTex: texture_2d<f32>, uv: vec2<f32>, sceneT: f32, pixelEnd: f32) -> vec4<f32> {
  let size = vec2<f32>(textureDimensions(colorTex));
  let m = uv * size - 0.5;
  let b = floor(m);
  let f = m - b;
  let hi = vec2<i32>(size) - vec2<i32>(1);
  var acc = vec4(0.0);
  var wsum = 0.0;
  for (var i = 0; i < 4; i++) {
    let o = vec2<f32>(f32(i & 1), f32(i >> 1));
    let w = mix(1.0 - f.x, f.x, o.x) * mix(1.0 - f.y, f.y, o.y);
    let tap = clamp(vec2<i32>(b + o), vec2<i32>(0), hi);
    let r = tapResult(colorTex, depthTex, tap, sceneT, pixelEnd, true);
    if (r.a >= 0.0) { acc += r * w; wsum += w; }
  }
  if (wsum > 1e-4) { return acc / wsum; }
  return tapResult(colorTex, depthTex, clamp(vec2<i32>(round(m)), vec2<i32>(0), hi), sceneT, pixelEnd, false);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(vec2<f32>(gid.xy) >= frame.outputSize)) { return; }
  let uv = (vec2<f32>(gid.xy) + 0.5) / frame.outputSize;
  let sceneT = sceneDistance(textureLoad(sceneDepth, vec2<i32>(gid.xy), 0), uv);

  let origin = frame.cameraPos;
  let dir = normalize(unprojectDepth(uv, 1.0) - origin);
  let interval = volumeRayInterval(origin, dir);
  let hit = interval.x <= interval.y;
  let volumeEnd = select(0.0, min(interval.y, sceneT), hit);   // 0 disables the tap rejection
  let split = frame.splitDistance;

  let near = upsample(nearColor, nearDepth, uv, sceneT, min(volumeEnd, split));
  var result = near;
  // The far layer only matters where the near layer lets light through and the ray reaches past the split.
  if (near.a > 0.004 && (!hit || volumeEnd > split)) {
    let far = upsample(farColor, farDepth, uv, sceneT, volumeEnd);
    result = vec4(near.rgb + near.a * far.rgb, near.a * far.a);
  }
  textureStore(outputTex, vec2<i32>(gid.xy), result);
}
`;
