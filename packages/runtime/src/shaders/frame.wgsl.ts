/** Per-frame uniforms and scene-depth helpers shared by the march and composite passes (group 1, bindings 0 and 1). */
export const FRAME_UNIFORM_BYTES = 256;

export const FRAME_WGSL = /* wgsl */ `
struct Frame {
  invViewProj: mat4x4<f32>,
  cameraPos: vec3<f32>, time: f32,
  sunDir: vec3<f32>, extinction: f32,
  wind: vec3<f32>, mipDistanceScale: f32,
  renderSize: vec2<f32>, outputSize: vec2<f32>,
  baseMip: f32, maxSteps: u32, frameIndex: u32, lightDensityScale: f32,
  msStrength: f32, ambientStrength: f32, silverStrength: f32, ambientExtinction: f32,
  phaseG: f32, silverG: f32, shadowStrength: f32, deepScatter: f32,
  // near/far split: marching range of this pass is [0, splitDistance) for passMode 0 (near) and [splitDistance, inf) for 1 (far)
  splitDistance: f32, tCutoff: f32, passMode: u32, _pad2: f32,
  // art controls (P1-09)
  edgeDarkening: f32, glowBoost: f32, ambientSkyBias: f32, wispyBias: f32,
  glowFront: f32, skyEnabled: f32, deepAttenuation: f32, ambientFloor: f32,   // skyEnabled: 1 when the distant sky layer is merged by the composite
  // Q-1 billow-scale shading: microDist = length (m) of the short full-density sun sample taken from every lit step (0 = off),
  // microShadow = weight of its occlusion on the glow terms, detailBias = erosion amplitude bias (0 = Nubis), stepScale scales the march step floor
  microDist: f32, microShadow: f32, detailBias: f32, stepScale: f32,
  // P5-B temporal amortization of this pass: (k = 1, 2 or 4 (1 = every pixel every frame), phase 0..k-1, full trace (1 = every pixel this frame), 0)
  temporal: vec4<f32>,
}
@group(1) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(1) var sceneDepth: texture_depth_2d;

const FAR_T = 1.0e6;
// The march passes' depth targets are rgba16float (P5-B: bandwidth) holding distances / DEPTH_PACK, so 1e6 m (FAR_T) still fits.
const DEPTH_PACK = 32.0;

fn unprojectDepth(uv: vec2<f32>, depth: f32) -> vec3<f32> {
  let w = frame.invViewProj * vec4(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth, 1.0);
  return w.xyz / w.w;
}
// Distance from the camera along the pixel's ray to the scene surface; FAR_T for sky (conventional depth 1).
fn sceneDistance(depth: f32, uv: vec2<f32>) -> f32 {
  if (depth >= 1.0) { return FAR_T; }
  return min(FAR_T, length(unprojectDepth(uv, depth) - frame.cameraPos));
}

// ---- P5-B temporal amortization: which pixels of a march pass are traced this frame ----
// k = 2: a checkerboard (two phases); k = 4: one pixel of every 2x2 block in Bayer order (0 2 / 3 1).
fn bayerOffset(phase: u32) -> vec2<u32> {
  let p = phase & 3u;
  return vec2<u32>(select(0u, 1u, p == 1u || p == 2u), select(0u, 1u, p == 1u || p == 3u));
}
fn isTracedPixel(px: vec2<i32>) -> bool {
  let k = u32(frame.temporal.x);
  if (k <= 1u || frame.temporal.z > 0.5) { return true; }
  let phase = u32(frame.temporal.y);
  if (k == 2u) { return u32((px.x + px.y) & 1) == (phase & 1u); }
  return all(vec2<u32>(px & vec2<i32>(1)) == bayerOffset(phase));
}
// Dispatch thread -> traced pixel. The dispatch covers only the traced pixels, so every lane works (k = 2 halves x, k = 4 halves x and y).
fn tracedPixel(g: vec2<u32>) -> vec2<u32> {
  let k = u32(frame.temporal.x);
  if (k <= 1u || frame.temporal.z > 0.5) { return g; }
  let phase = u32(frame.temporal.y);
  if (k == 2u) { return vec2<u32>(g.x * 2u + ((phase ^ g.y) & 1u), g.y); }
  return g * 2u + bayerOffset(phase);
}
// Farthest scene depth over the output pixels this pass pixel covers, as a distance from the camera (FAR_T for sky).
fn passSceneEnd(px: vec2<u32>, uv: vec2<f32>) -> f32 {
  let ratio = frame.outputSize / frame.renderSize;
  let lo = vec2<i32>(floor(vec2<f32>(px) * ratio));
  let hi = min(vec2<i32>(ceil(vec2<f32>(px + vec2<u32>(1u)) * ratio)) - vec2<i32>(1), lo + vec2<i32>(3));
  let dmax = vec2<i32>(textureDimensions(sceneDepth)) - vec2<i32>(1);
  var depth = 0.0;
  for (var y = lo.y; y <= hi.y; y++) {
    for (var x = lo.x; x <= hi.x; x++) { depth = max(depth, textureLoad(sceneDepth, min(vec2<i32>(x, y), dmax), 0)); }
  }
  return sceneDistance(depth, uv);
}
`;
