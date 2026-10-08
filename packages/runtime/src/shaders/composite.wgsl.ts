import { FRAME_WGSL } from './frame.wgsl';

/**
 * Depth-aware upsample of the march output to output resolution (4 taps). Per-pass bindings are group 1:
 * 0 Frame, 1 scene depth, 2 march colour, 3 march depth (rg32float, see march.wgsl.ts), 4 output (rgba16float).
 * Output is what the caller blends: scene * a + rgb.
 *
 * A tap that was marched against a nearer surface than this pixel's carries no information about it and is skipped.
 * A tap whose cloud lies behind this pixel's surface is replaced by "no cloud".
 */
export const COMPOSITE_WGSL = /* wgsl */ `
${FRAME_WGSL}
@group(1) @binding(2) var marchColor: texture_2d<f32>;
@group(1) @binding(3) var marchDepth: texture_2d<f32>;
@group(1) @binding(4) var outputTex: texture_storage_2d<rgba16float, write>;

fn tapResult(tap: vec2<i32>, sceneT: f32, strict: bool) -> vec4<f32> {
  // w < 0 marks a skipped tap
  let d = textureLoad(marchDepth, tap, 0).xy;
  if (strict && d.y < sceneT * 0.97 - 1.0) { return vec4(0.0, 0.0, 0.0, -1.0); }
  var c = textureLoad(marchColor, tap, 0);
  if (d.x > 0.0 && d.x > sceneT * 1.02 + 1.0) { c = vec4(0.0, 0.0, 0.0, 1.0); }
  return vec4(c.rgb, c.a);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(vec2<f32>(gid.xy) >= frame.outputSize)) { return; }
  let uv = (vec2<f32>(gid.xy) + 0.5) / frame.outputSize;
  let sceneT = sceneDistance(textureLoad(sceneDepth, vec2<i32>(gid.xy), 0), uv);

  let m = uv * frame.renderSize - 0.5;
  let b = floor(m);
  let f = m - b;
  let hi = vec2<i32>(frame.renderSize) - vec2<i32>(1);
  var acc = vec4(0.0);
  var wsum = 0.0;
  for (var i = 0; i < 4; i++) {
    let o = vec2<f32>(f32(i & 1), f32(i >> 1));
    let w = mix(1.0 - f.x, f.x, o.x) * mix(1.0 - f.y, f.y, o.y);
    let tap = clamp(vec2<i32>(b + o), vec2<i32>(0), hi);
    let r = tapResult(tap, sceneT, true);
    if (r.a >= 0.0) { acc += vec4(r.rgb, r.a) * w; wsum += w; }
  }
  var result: vec4<f32>;
  if (wsum > 1e-4) {
    result = acc / wsum;
  } else {
    result = tapResult(clamp(vec2<i32>(round(m)), vec2<i32>(0), hi), sceneT, false);
  }
  textureStore(outputTex, vec2<i32>(gid.xy), result);
}
`;
