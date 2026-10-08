export const CLOUD_QUALITY_WGSL = /* wgsl */ `
struct Params {
  camera: vec4<f32>,
  forward: vec4<f32>,
  right: vec4<f32>,
  up: vec4<f32>,
  sun: vec4<f32>,
  boundsMin: vec4<f32>,
  boundsMax: vec4<f32>,
  settings: vec4<f32>, // extinction, view steps, light steps, source (0 analytic, 1 voxel)
  options: vec4<f32>, // reference, candidate method, desired step metres, frame index
  resolution: vec4<f32>, // width, height, voxel resolution, max mip
}

@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var volume: texture_3d<f32>;
@group(0) @binding(2) var volumeSampler: sampler;
@group(0) @binding(3) var output: texture_storage_2d<rgba16float, write>;

fn boxInterval(origin: vec3<f32>, ray: vec3<f32>, lo: vec3<f32>, hi: vec3<f32>) -> vec2<f32> {
  let inverse = vec3(
    select(1e30, 1.0 / ray.x, abs(ray.x) > 1e-8),
    select(1e30, 1.0 / ray.y, abs(ray.y) > 1e-8),
    select(1e30, 1.0 / ray.z, abs(ray.z) > 1e-8)
  );
  let a = (lo - origin) * inverse;
  let b = (hi - origin) * inverse;
  let near = min(a, b);
  let far = max(a, b);
  return vec2(max(near.x, max(near.y, near.z)), min(far.x, min(far.y, far.z)));
}

fn analyticDensity(world: vec3<f32>) -> f32 {
  let center = vec3(0.0, 450.0, 0.0);
  let q = (world - center) / vec3(650.0, 450.0, 500.0);
  var field = exp(-3.1 * dot(q, q));
  let q1 = (world - vec3(-285.0, 590.0, 25.0)) / vec3(330.0, 300.0, 290.0);
  let q2 = (world - vec3(250.0, 550.0, -45.0)) / vec3(350.0, 330.0, 300.0);
  let q3 = (world - vec3(30.0, 735.0, 35.0)) / vec3(270.0, 250.0, 245.0);
  field += 0.76 * exp(-2.8 * dot(q1, q1));
  field += 0.71 * exp(-2.9 * dot(q2, q2));
  field += 0.62 * exp(-3.0 * dot(q3, q3));
  let vertical = smoothstep(0.0, 95.0, world.y) * (1.0 - smoothstep(790.0, 900.0, world.y));
  let broad = smoothstep(0.25, 0.66, field) * vertical;
  // Continuous, differentiable sub-lobe structure. This is intentionally not
  // voxel noise: it tests integration bandwidth without a grid representation.
  let detail = sin(world.x * 0.058 + sin(world.z * 0.024)) * sin(world.y * 0.071 + world.z * 0.019);
  return broad * (0.86 + 0.14 * detail);
}

fn densityAt(world: vec3<f32>, lod: f32) -> f32 {
  let uvw = (world - p.boundsMin.xyz) / (p.boundsMax.xyz - p.boundsMin.xyz);
  if (any(uvw <= vec3(0.0)) || any(uvw >= vec3(1.0))) { return 0.0; }
  if (p.settings.w < 0.5) { return analyticDensity(world); }
  return textureSampleLevel(volume, volumeSampler, uvw, clamp(lod, 0.0, p.resolution.w)).r;
}

fn sampleLod(segmentLength: f32) -> f32 {
  if (p.options.x < 0.5 || p.options.y < 1.5 || p.options.y > 2.5) { return 0.0; }
  let voxel = min(min(
    (p.boundsMax.x - p.boundsMin.x) / p.resolution.z,
    (p.boundsMax.y - p.boundsMin.y) / p.resolution.z),
    (p.boundsMax.z - p.boundsMin.z) / p.resolution.z);
  return max(0.0, log2(max(1.0, segmentLength / voxel)));
}

fn sunVisibility(world: vec3<f32>, lod: f32) -> f32 {
  let hit = boxInterval(world + p.sun.xyz * 0.02, p.sun.xyz, p.boundsMin.xyz, p.boundsMax.xyz);
  let start = max(0.0, hit.x);
  let end = max(start, hit.y);
  let steps = max(1u, u32(p.settings.z));
  let ds = (end - start) / f32(steps);
  var tau = 0.0;
  for (var i = 0u; i < steps; i++) {
    tau += densityAt(world + p.sun.xyz * (start + (f32(i) + 0.5) * ds), lod) * p.settings.x * ds;
  }
  return exp(-tau);
}

fn integrateSegment(origin: vec3<f32>, ray: vec3<f32>, a: f32, b: f32, subsamples: u32, state: ptr<function, vec4<f32>>) {
  let ds = b - a;
  if (ds <= 0.0) { return; }
  let subDs = ds / f32(subsamples);
  let lod = sampleLod(subDs);
  for (var sub = 0u; sub < subsamples; sub++) {
    let fraction = (f32(sub) + 0.5) / f32(subsamples);
    let world = origin + ray * mix(a, b, fraction);
    let density = densityAt(world, lod);
    if (density > 1e-5) {
      let mu = dot(ray, p.sun.xyz);
      let g = 0.38;
      let phase = (1.0 - g * g) / (12.5663706 * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
      let lighting = vec3(0.18, 0.23, 0.32) + vec3(7.8, 7.25, 6.6) * phase * sunVisibility(world, lod);
      let segmentT = exp(-density * p.settings.x * subDs);
      let current = *state;
      *state = vec4(current.xyz + current.w * (1.0 - segmentT) * lighting, current.w * segmentT);
    }
  }
}

fn hashPixel(pixel: vec2<u32>, frame: u32) -> f32 {
  var value = pixel.x * 1664525u + pixel.y * 1013904223u + frame * 747796405u + 2891336453u;
  value ^= value >> 16u;
  value *= 2246822519u;
  value ^= value >> 13u;
  return f32(value & 0x00ffffffu) / 16777216.0;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(output);
  if (any(id.xy >= size)) { return; }
  let uv = (vec2<f32>(id.xy) + 0.5) / vec2<f32>(size);
  let screen = vec2((uv.x * 2.0 - 1.0) * p.right.w, 1.0 - uv.y * 2.0);
  let ray = normalize(p.forward.xyz + screen.x * p.right.xyz * p.forward.w + screen.y * p.up.xyz * p.forward.w);
  let interval = boxInterval(p.camera.xyz, ray, p.boundsMin.xyz, p.boundsMax.xyz);
  let start = max(0.0, interval.x);
  let end = interval.y;
  var state = vec4(0.0, 0.0, 0.0, 1.0);
  if (end > start) {
    let reference = p.options.x < 0.5;
    let method = u32(p.options.y);
    if (reference || method == 1u) {
      let steps = max(1u, u32(p.settings.y));
      let ds = (end - start) / f32(steps);
      let subsamples = select(1u, 4u, !reference);
      for (var i = 0u; i < steps; i++) {
        integrateSegment(p.camera.xyz, ray, start + f32(i) * ds, start + f32(i + 1u) * ds, subsamples, &state);
      }
    } else {
      // Method 0 mirrors the production camera-distance lattice. Method 2 adds
      // footprint-selected volume mips but deliberately keeps the same lattice.
      // Method 3 jitters that lattice each frame to expose temporal ownership.
      let desired = max(0.25, p.options.z);
      let budgetDs = (end - start) / max(1.0, p.settings.y);
      let ds = max(desired, budgetDs);
      let lattice = floor(start / ds);
      let jitter = select(0.0, hashPixel(id.xy, u32(p.options.w)), method == 3u);
      var boundary = (lattice + 1.0 + jitter) * ds;
      if (boundary <= start) { boundary += ds; }
      integrateSegment(p.camera.xyz, ray, start, min(end, boundary), 1u, &state);
      var a = min(end, boundary);
      for (var i = 0u; i < 1024u; i++) {
        if (a >= end || state.w < 0.0001) { break; }
        let b = min(end, a + ds);
        integrateSegment(p.camera.xyz, ray, a, b, 1u, &state);
        a = b;
      }
    }
  }
  let sky = mix(vec3(0.19, 0.31, 0.49), vec3(0.62, 0.75, 0.90), clamp(ray.y * 0.5 + 0.5, 0.0, 1.0));
  let linear = state.xyz + state.w * sky;
  let mapped = linear / (linear + vec3(1.0));
  let display = pow(max(mapped, vec3(0.0)), vec3(1.0 / 2.2));
  textureStore(output, vec2<i32>(id.xy), vec4(display, 1.0 - state.w));
}
`;

export const PRESENT_WGSL = /* wgsl */ `
struct VertexOut { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOut {
  let positions = array(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  var out: VertexOut;
  out.position = vec4(positions[index], 0.0, 1.0);
  out.uv = positions[index] * vec2(0.5, -0.5) + vec2(0.5);
  return out;
}
@group(0) @binding(0) var candidate: texture_2d<f32>;
@group(0) @binding(1) var reference: texture_2d<f32>;
@group(0) @binding(2) var nearestSampler: sampler;
@fragment fn fragmentMain(in: VertexOut) -> @location(0) vec4<f32> {
  let panel = min(2u, u32(in.uv.x * 3.0));
  let uv = vec2(fract(in.uv.x * 3.0), in.uv.y);
  let candidateColor = textureSample(candidate, nearestSampler, uv);
  let referenceColor = textureSample(reference, nearestSampler, uv);
  if (panel == 0u) { return vec4(candidateColor.rgb, 1.0); }
  if (panel == 1u) { return vec4(referenceColor.rgb, 1.0); }
  let error = abs(candidateColor.rgb - referenceColor.rgb);
  let heat = vec3(4.0 * max(error.r, max(error.g, error.b)), 0.65 * error.g, 0.16 + 0.7 * error.b);
  return vec4(clamp(heat, vec3(0.0), vec3(1.0)), 1.0);
}
`;
