import { REFERENCE_SHADOW_WGSL } from '../lighting/reference/index';

/** Reference marcher: fixed sample lattice, physical segment opacity, linear HDR. */
export const CLOUD_WGSL = /* wgsl */`
struct Params {
  inverseVP: mat4x4<f32>,
  camera: vec4<f32>,
  boundsMin: vec4<f32>,
  boundsMax: vec4<f32>,
  sun: vec4<f32>,
  settings: vec4<f32>, // extinction, view steps, light steps, occupancy enabled
  flags: vec4<f32>, // cloud shadows, box shadows, diagnostic constant light, brick size
  boxMin: vec4<f32>,
  boxMax: vec4<f32>,
}
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var density: texture_3d<f32>;
@group(0) @binding(2) var linearSampler: sampler;
@group(0) @binding(3) var occupancy: texture_3d<f32>;
@group(0) @binding(4) var sceneColor: texture_2d<f32>;
@group(0) @binding(5) var sceneDepth: texture_depth_2d;
@group(0) @binding(6) var cloudOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(7) var compositeOut: texture_storage_2d<rgba16float, write>;

${REFERENCE_SHADOW_WGSL}

fn densityAt(world: vec3<f32>) -> f32 {
  let uvw = (world - p.boundsMin.xyz) / (p.boundsMax.xyz - p.boundsMin.xyz);
  if (any(uvw < vec3(0.0)) || any(uvw > vec3(1.0))) { return 0.0; }
  if (p.settings.w > 0.5) {
    let voxel = min(vec3<u32>(uvw * vec3<f32>(textureDimensions(density))), textureDimensions(density) - vec3(1u));
    let brick = voxel / u32(p.flags.w);
    if (textureLoad(occupancy, vec3<i32>(brick), 0).r == 0.0) { return 0.0; }
  }
  return textureSampleLevel(density, linearSampler, uvw, 0.0).r;
}

fn sunVisibility(world: vec3<f32>) -> f32 {
  if (p.flags.y > 0.5 && boxOccludes(world + p.sun.xyz * 0.01, p.sun.xyz, p.boxMin.xyz, p.boxMax.xyz)) { return 0.0; }
  let interval = boxInterval(world, p.sun.xyz, p.boundsMin.xyz, p.boundsMax.xyz);
  let start = max(0.0, interval.x);
  let end = max(start, interval.y);
  let steps = u32(p.settings.z);
  let ds = (end - start) / f32(steps);
  var opticalDepth = 0.0;
  for (var i = 0u; i < steps; i++) {
    opticalDepth += densityAt(world + p.sun.xyz * (start + (f32(i) + 0.5) * ds)) * p.settings.x * ds;
  }
  return exp(-opticalDepth);
}

fn worldAt(ndc: vec2<f32>, depth: f32) -> vec3<f32> {
  let h = p.inverseVP * vec4(ndc, depth, 1.0);
  return h.xyz / h.w;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(compositeOut);
  if (any(id.xy >= size)) { return; }
  let pixel = vec2<i32>(id.xy);
  let uv = (vec2<f32>(id.xy) + 0.5) / vec2<f32>(size);
  let ndc = vec2(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let nearPoint = worldAt(ndc, 0.0);
  let ray = normalize(worldAt(ndc, 1.0) - p.camera.xyz);
  let depth = textureLoad(sceneDepth, pixel, 0);
  let opaquePoint = worldAt(ndc, depth);
  let opaqueDistance = select(1e8, dot(opaquePoint - p.camera.xyz, ray), depth < 0.999999);
  let interval = boxInterval(p.camera.xyz, ray, p.boundsMin.xyz, p.boundsMax.xyz);
  // Near-plane distance is included for cameras inside the volume.
  let start = max(max(0.0, interval.x), dot(nearPoint - p.camera.xyz, ray));
  let end = min(interval.y, opaqueDistance);
  var transmittance = 1.0;
  var radiance = vec3(0.0);
  if (end > start) {
    let steps = u32(p.settings.y);
    let ds = (end - start) / f32(steps);
    let mu = dot(ray, p.sun.xyz);
    let g = 0.45;
    let phase = (1.0-g*g) / (12.5663706 * pow(1.0+g*g-2.0*g*mu, 1.5));
    for (var i = 0u; i < steps; i++) {
      let world = p.camera.xyz + ray * (start + (f32(i)+0.5)*ds);
      let d = densityAt(world);
      if (d > 0.0) {
        let segmentT = exp(-d * p.settings.x * ds);
        var light = vec3(0.18, 0.24, 0.34) + vec3(9.0, 8.6, 7.8) * phase * sunVisibility(world);
        if (p.flags.z > 0.5) { light = vec3(1.0); }
        radiance += transmittance * (1.0-segmentT) * light;
        transmittance *= segmentT;
      }
    }
  }
  var background = textureLoad(sceneColor, pixel, 0).rgb;
  // P1 reference ground receiver only. General material light hooks arrive in P3.
  if (p.flags.x > 0.5 && depth < 0.999999 && abs(opaquePoint.y) < 0.5) {
    background *= 0.25 + 0.75 * sunVisibility(opaquePoint + vec3(0.0,0.02,0.0));
  }
  textureStore(cloudOut, pixel, vec4(radiance, transmittance));
  textureStore(compositeOut, pixel, vec4(radiance + transmittance*background, 1.0));
}
`;
