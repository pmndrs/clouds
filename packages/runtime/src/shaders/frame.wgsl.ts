/** Per-frame uniforms and scene-depth helpers shared by the march and composite passes (group 1, bindings 0 and 1). */
export const FRAME_UNIFORM_BYTES = 224;

export const FRAME_WGSL = /* wgsl */ `
struct Frame {
  invViewProj: mat4x4<f32>,
  cameraPos: vec3<f32>, time: f32,
  sunDir: vec3<f32>, extinction: f32,
  wind: vec3<f32>, mipDistanceScale: f32,
  renderSize: vec2<f32>, outputSize: vec2<f32>,
  baseMip: f32, maxSteps: u32, frameIndex: u32, lightDensityScale: f32,
  msStrength: f32, ambientStrength: f32, silverStrength: f32, ambientExtinction: f32,
  phaseG: f32, silverG: f32, shadowStrength: f32, _pad1: f32,
  // near/far split: marching range of this pass is [0, splitDistance) for passMode 0 (near) and [splitDistance, inf) for 1 (far)
  splitDistance: f32, tCutoff: f32, passMode: u32, _pad2: f32,
  // art controls (P1-09)
  edgeDarkening: f32, glowBoost: f32, ambientSkyBias: f32, wispyBias: f32,
  glowFront: f32, skyEnabled: f32, _pad4: f32, _pad5: f32,   // skyEnabled: 1 when the distant sky layer is merged by the composite
}
@group(1) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(1) var sceneDepth: texture_depth_2d;

const FAR_T = 1.0e6;

fn unprojectDepth(uv: vec2<f32>, depth: f32) -> vec3<f32> {
  let w = frame.invViewProj * vec4(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth, 1.0);
  return w.xyz / w.w;
}
// Distance from the camera along the pixel's ray to the scene surface; FAR_T for sky (conventional depth 1).
fn sceneDistance(depth: f32, uv: vec2<f32>) -> f32 {
  if (depth >= 1.0) { return FAR_T; }
  return min(FAR_T, length(unprojectDepth(uv, depth) - frame.cameraPos));
}
`;
