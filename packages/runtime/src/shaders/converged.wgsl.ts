/**
 * P0.5 converged march: the accumulation of the composite's output over `convergedSamples` frames. The composite writes this frame's sample
 * (premultiplied linear radiance, a = the scene multiplier) into a scratch target instead of the output; this pass adds it to the running sum
 * (rgba32float, ping-pong) and writes the mean to the output, so the consumer's blend (scene * a + rgb) and tone map see the average of the
 * linear frames. Count 1 starts a new sum (the previous one is not read).
 */
export const CONVERGED_PARAM_BYTES = 16;
export const CONVERGED_WGSL = /* wgsl */ `
struct ConvergedParams { count: u32, pad0: u32, pad1: u32, pad2: u32 }
@group(0) @binding(0) var<uniform> params: ConvergedParams;
@group(0) @binding(1) var sampleTex: texture_2d<f32>;
@group(0) @binding(2) var sumIn: texture_2d<f32>;
@group(0) @binding(3) var sumOut: texture_storage_2d<rgba32float, write>;
@group(0) @binding(4) var outTex: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(outTex);
  if (any(gid.xy >= dims)) { return; }
  let px = vec2<i32>(gid.xy);
  var sum = textureLoad(sampleTex, px, 0);
  if (params.count > 1u) { sum += textureLoad(sumIn, px, 0); }
  textureStore(sumOut, px, sum);
  textureStore(outTex, px, sum / f32(max(params.count, 1u)));
}
`;

/** The converged mode's sample sequence: sample n (0-based) gets a sub-pixel offset in [-0.5, 0.5)^2 (Halton 2, 3 of n + 1: a one-pixel box filter). */
export function convergedSubPixel(n: number): [number, number] {
  const radicalInverse = (i: number, b: number) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
  return [radicalInverse(n + 1, 2) - 0.5, radicalInverse(n + 1, 3) - 0.5];
}
