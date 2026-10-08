/**
 * Depth guided optical resolve. The source optical texture is deliberately
 * sampled with four explicit loads so radiance and transmittance retain the
 * same weights; treating the optical pair as generic opaque color loses its
 * compositing meaning at silhouettes.
 */
export const OPTICAL_RESOLVE_WGSL = /* wgsl */ `
struct Params {
  fullSize: vec2<f32>,
  lowSize: vec2<f32>,
  cameraNear: f32,
  cameraFar: f32,
  relativeDepthThreshold: f32,
  _padding: f32,
}

@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var opticalLow: texture_2d<f32>;
@group(0) @binding(2) var sceneColorFull: texture_2d<f32>;
@group(0) @binding(3) var sceneDepthFull: texture_depth_2d;
@group(0) @binding(4) var output: texture_storage_2d<rgba16float, write>;

struct Tap {
  value: vec4<f32>,
  accepted: bool,
}

fn clampPixel(pixel: vec2<i32>, size: vec2<i32>) -> vec2<i32> {
  return max(vec2<i32>(0), min(pixel, size - vec2<i32>(1)));
}

// Conventional WebGPU [0, 1] depth, with the camera looking down -Z.
fn linearEyeZ(depth: f32) -> f32 {
  let near = max(p.cameraNear, 1e-6);
  let far = max(p.cameraFar, near + 1e-6);
  return (near * far) / max(far - depth * (far - near), 1e-6);
}

fn depthCompatible(a: f32, b: f32) -> bool {
  let relativeScale = max(1.0, max(a, b));
  let threshold = max(0.01, relativeScale * p.relativeDepthThreshold);
  return abs(a - b) <= threshold;
}

fn readTap(lowPixel: vec2<i32>, outputEyeZ: f32, lowSize: vec2<i32>, fullSize: vec2<i32>) -> Tap {
  let low = clampPixel(lowPixel, lowSize);
  // The guide depth belongs to the full-resolution pixel under the low texel
  // centre. This makes the low cloud march's opaque-depth decision the guide
  // for all four taps, while still rejecting foreground silhouette leakage.
  let lowCentreUv = (vec2<f32>(low) + vec2(0.5)) / p.lowSize;
  let guidePixel = clampPixel(vec2<i32>(floor(lowCentreUv * p.fullSize)), fullSize);
  let guideEyeZ = linearEyeZ(textureLoad(sceneDepthFull, guidePixel, 0));
  return Tap(textureLoad(opticalLow, low, 0), depthCompatible(guideEyeZ, outputEyeZ));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let fullSize = vec2<i32>(textureDimensions(output));
  if (any(id.xy >= vec2<u32>(fullSize))) { return; }
  let pixel = vec2<i32>(id.xy);
  let uv = (vec2<f32>(id.xy) + vec2(0.5)) / p.fullSize;
  let sceneSize = vec2<i32>(textureDimensions(sceneDepthFull));
  let outputDepth = textureLoad(sceneDepthFull, clampPixel(pixel, sceneSize), 0);
  let outputEyeZ = linearEyeZ(outputDepth);

  // Texture coordinates are expressed relative to texel centres. The four
  // integer taps and their original bilinear weights are retained exactly;
  // accepted weights are renormalized only after depth rejection.
  let lowCoord = uv * p.lowSize - vec2(0.5);
  let lowBaseF = floor(lowCoord);
  let lowBase = vec2<i32>(lowBaseF);
  let fraction = lowCoord - lowBaseF;
  let lowSize = vec2<i32>(textureDimensions(opticalLow));
  var radiance = vec3(0.0);
  var transmittance = 0.0;
  var acceptedWeight = 0.0;

  let w00 = (1.0 - fraction.x) * (1.0 - fraction.y);
  let w10 = fraction.x * (1.0 - fraction.y);
  let w01 = (1.0 - fraction.x) * fraction.y;
  let w11 = fraction.x * fraction.y;
  let tap00 = readTap(lowBase, outputEyeZ, lowSize, sceneSize);
  let tap10 = readTap(lowBase + vec2(1, 0), outputEyeZ, lowSize, sceneSize);
  let tap01 = readTap(lowBase + vec2(0, 1), outputEyeZ, lowSize, sceneSize);
  let tap11 = readTap(lowBase + vec2(1, 1), outputEyeZ, lowSize, sceneSize);
  if (tap00.accepted) { radiance += tap00.value.rgb * w00; transmittance += tap00.value.a * w00; acceptedWeight += w00; }
  if (tap10.accepted) { radiance += tap10.value.rgb * w10; transmittance += tap10.value.a * w10; acceptedWeight += w10; }
  if (tap01.accepted) { radiance += tap01.value.rgb * w01; transmittance += tap01.value.a * w01; acceptedWeight += w01; }
  if (tap11.accepted) { radiance += tap11.value.rgb * w11; transmittance += tap11.value.a * w11; acceptedWeight += w11; }

  var resolved = vec4(0.0, 0.0, 0.0, 1.0);
  if (acceptedWeight > 1e-6) {
    radiance /= acceptedWeight;
    transmittance = clamp(transmittance / acceptedWeight, 0.0, 1.0);
    resolved = vec4(max(radiance, vec3(0.0)), transmittance);
  }
  let scene = textureLoad(sceneColorFull, clampPixel(pixel, sceneSize), 0).rgb;
  textureStore(output, pixel, vec4(resolved.rgb + resolved.a * scene, 1.0));
}
`;
