/** Per-frame uniforms and scene-depth helpers shared by the march and composite passes (group 1, bindings 0 and 1). */
export const FRAME_UNIFORM_BYTES = 544;

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
  splitDistance: f32, tCutoff: f32, passMode: u32, lightDebug: f32,   // lightDebug (C1): 0 = normal, 1..5 = only the direct / ms / deep / ambient / environment-body term (no aerial perspective)
  // art controls (P1-09)
  edgeDarkening: f32, glowBoost: f32, ambientSkyBias: f32, wispyBias: f32,
  glowFront: f32, skyEnabled: f32, deepAttenuation: f32, ambientFloor: f32,   // skyEnabled: 1 when the distant sky layer is merged by the composite
  // Q-1 billow-scale shading: microDist = length (m) of the short full-density sun sample taken from every lit step (0 = off),
  // microShadow = weight of its occlusion on the glow terms, detailBias = erosion amplitude bias (0 = Nubis), stepScale scales the march step floor
  microDist: f32, microShadow: f32, detailBias: f32, stepScale: f32,
  // P5-B temporal amortization of this pass: (k = 1, 2 or 4 (1 = every pixel every frame), phase 0..k-1, full trace (1 = every pixel this frame), 0)
  temporal: vec4<f32>,
  // P5-C dynamic resolution: the textures are allocated at the pass's full size; a pass renders into the top-left renderSize rectangle of them.
  // rects = (near w, near h, far w, far h) as rendered this frame, texDims = the same textures' allocated sizes.
  rects: vec4<f32>,
  texDims: vec4<f32>,
  // P5-C tier levers: x = distance (m) within which the high-frequency detail octave is evaluated, y = far pass limit (m, FAR_T = none), zw = 0
  misc: vec4<f32>,
  // P6-B lightning: flash = (position xyz in metres, radius in metres; radius 0 = no flash this frame, the march's glow branch is skipped),
  // flashColor = linear RGB of the flash, already multiplied by its envelope; flashColor.w is the envelope 0..1 (unused by the march).
  flash: vec4<f32>,
  flashColor: vec4<f32>,
  // C1 low-sun lighting: body = (sun share of the multiple-scattering body terms by elevation, environment gain, phase model 0 = HG mix | 1 = Mie fit,
  // extinction of the sun share with the optical depth toward the sun),
  // mie = the HG + Draine fit's (gHG, gD, alpha, wD) for the droplet diameter (used when body.z = 1).
  body: vec4<f32>,
  mie: vec4<f32>,
  // C2 horizon haze: (extinction per metre at the base height, 1 / scale height (per metre), base altitude (m), X3 lighting model: 0 nubis, 1 octave). x = 0: off.
  haze: vec4<f32>,
  // P1 up-rez noise convention: x = noiseInvert bit flags (1 billowy B/A as 1 - n, 2 wispy R/G as 1 - n), y = detail type override (< 0 = the NVDF's), z = typeFromScale, w = ambientLaw (D0: 0 = 1 / (1 + tauUp), 1 = exp(-tauUp)).
  uprez: vec4<f32>,
  // M1 material balance (Nubis lighting): x = diffuseSun (weight of the two-stream diffuse sun term), y = ambientSaturation (1 = the sky's own colour),
  // z = ambientWarmth (0..1 toward the sun's chromaticity at the same luminance), w = directInScatterFlat (direct volumes: 0 = in-scatter weight saturate(density), 1 = 1).
  material: vec4<f32>,
  // M1: x = diffuseFalloff (k of the diffuse sun's 1 / (1 + k tau)); D1: y = inlineLightScale (scale of the in-line sun taps' optical depth,
  // 1 = the view extinction), z = jitterStatic (1 = static march jitter beyond 250 m, N3 s150), w = profileFilter (D1 round 6: bit 1 = the
  // lighting's profile read tricubic, bit 2 = its SDF read tricubic).
  material2: vec4<f32>,
  // D1 sun taps: x = inlineProfile (1 = the two in-line sun samples read the cheap profile P * S instead of the up-rezzed density),
  // y = lightMipBias (mip added to the field and noise fetches of the in-line sun samples), z = ambientTap (m, upward occlusion sample of the
  // ambient; 0 = off), w = inScatterProfile (1 = the lighting's profile is the deck's dimensional profile P, 0 = P x density scale).
  d1: vec4<f32>,
  // D1 round 5: x = jitterNoise (1 = blue-noise mask + golden-ratio frame sequence for the march jitter, 0 = interleaved gradient noise),
  // y = stepJitter (1 = the step sequence's phase is also randomised per pixel and frame where the ray enters the cloud), z = lightGridFilter
  // (1 = tricubic B-spline reads of the light grid, 0 = trilinear), w = inlineReuse (m: the in-line sun samples are reused for steps closer than this).
  d2: vec4<f32>,
  // D1 round 8: x = glowDepth (m: the glow's profile P is read this far along the view ray past the sample, inside the volume; 0 = at the
  // sample), y = glowDepthMode (0 = the deeper read, 1 = max of the sample's and the deeper read, 2 = inward along the SDF gradient),
  // z = microLightScale (D1 round 9: the micro tap's optical depth as a fraction of the view extinction; 0 = the in-line taps' units), w = microShadowMode (D1 round 10: 1 = the glow's micro occlusion by the up-rez residual over the profile).
  d3: vec4<f32>,
  // D1 round 11: x = microDist2 (m, a second micro sun tap from microDist to microDist2; 0 = off), y = microShadow2 (its occlusion weight), z = directProfile (the direct term weighted by the in-scatter probability, 0..1), w = directRimDepth (m: that weight within this depth of the surface only; 0 = everywhere).
  d4: vec4<f32>,
  // P0.5 converged march: x = the step divisor (0 = off: the normal march), yz = the ray's sub-pixel offset (pass pixels), w = diagnostic bit flags of shortcuts kept (1 the thin-segment light skip).
  conv: vec4<f32>,
  // P0.5: x = the first row (pass pixels) of the band of rows the converged march traces this frame (a sample is traced over several frames); yzw 0.
  conv2: vec4<f32>,
  // P1.1b sun shadow (CloudSettings sunShadow* block, runtime.ts): x = inline reach (m: the in-line sun taps cover 0..x, the light grid is read x m
  // toward the sun; 48 = before P1.1b), y = in-line taps beyond the first 16 m (1 = the one 16-48 m tap before P1.1b), z = directAlbedo (the
  // single-scattering albedo on the direct term; 1 = none), w = sunShadowInlineJitter (1 = the ladder's taps jittered, 0 = midpoints).
  sunShadow: vec4<f32>,
}
@group(1) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(1) var sceneDepth: texture_depth_2d;

const FAR_T = 1.0e6;
// P5-C: a march pass keeps its three distances per pixel in ONE r32uint word, log-coded (4 bytes instead of rgba16float's 8):
//   x = transmittance-weighted mean cloud distance or 0 (11 bits, 0.74 percent steps), y = the distance the ray is marched to (11 bits),
//   z = scene distance (10 bits, 1.5 percent steps; its consumers have a 25 percent tolerance). Code 0 = 0 m, the top code = FAR_T exactly.
// The composite compares codes instead of decoding (thresholds are coded once per pixel).
const DEPTH_LO = 0.25;
const DEPTH_LN = 15.201805;   // ln(FAR_T / DEPTH_LO)
const DEPTH_XY_MAX = 2047u;
const DEPTH_Z_MAX = 1023u;
fn depthCode(d: f32, maxCode: u32) -> u32 {
  if (!(d >= DEPTH_LO)) { return 0u; }
  let c = round(log(d / DEPTH_LO) * (f32(maxCode - 1u) / DEPTH_LN)) + 1.0;
  return u32(min(c, f32(maxCode)));
}
fn depthDecode(c: u32, maxCode: u32) -> f32 {
  if (c == 0u) { return 0.0; }
  if (c >= maxCode) { return FAR_T; }
  return DEPTH_LO * exp(f32(c - 1u) * (DEPTH_LN / f32(maxCode - 1u)));
}
fn packDepth(x: f32, y: f32, z: f32) -> u32 {
  return depthCode(x, DEPTH_XY_MAX) | (depthCode(y, DEPTH_XY_MAX) << 11u) | (depthCode(z, DEPTH_Z_MAX) << 22u);
}
fn depthWordX(w: u32) -> f32 { return depthDecode(w & 2047u, DEPTH_XY_MAX); }
fn depthWordZ(w: u32) -> f32 { return depthDecode(w >> 22u, DEPTH_Z_MAX); }

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
