/** Shared WGSL helpers. Remap/erosion match assets/nubis-voxel-clouds/Code Fragments/VoxelCloudSampler.cg. */
export const COMMON_WGSL = /* wgsl */ `
const PI = 3.14159265358979;
const EPSILON = 1e-5;

// Clamped remap (ValueRemap in the shipping sampler).
fn valueRemap(v: f32, oldMin: f32, oldMax: f32, newMin: f32, newMax: f32) -> f32 {
  return newMin + saturate((v - oldMin) / (oldMax - oldMin)) * (newMax - newMin);
}
// ValueErosion: -inValues inflate, +inValues erode.
fn valueErosion(v: f32, oldMin: f32) -> f32 {
  return saturate((v - oldMin) / max(1.0 - oldMin, EPSILON)); // guard 0/0 when the noise reaches 1
}
fn fractionFromValue(v: f32, lo: f32, hi: f32) -> f32 {
  return saturate((v - lo) / (hi - lo));
}

// PCG hash → [0, 1).
fn pcg(v: u32) -> u32 {
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
fn hash01(v: u32) -> f32 { return f32(pcg(v)) / 4294967296.0; }
// Interleaved gradient noise (Jimenez 2014): cheap, well-distributed per-pixel jitter.
fn ign(pixel: vec2<f32>, frame: u32) -> f32 {
  let p = pixel + 5.588238 * f32(frame % 64u);
  return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y));
}
`;
