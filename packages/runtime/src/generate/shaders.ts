// WGSL for the GPU NVDF generator. No three imports.
// Seeds are packed voxel coordinates (x:11 | y:11 | z:10 bits); 0xffffffff means "no seed yet".

/** Shared params block (64 bytes), one dynamic-offset slot per job. */
const PARAMS = /* wgsl */ `
struct Params {
  dims: vec3<u32>, step: i32,
  zStart: u32, zCount: u32, margin: f32, maxDist: f32,
  voxelSize: f32, edgeWidth: f32, covThreshold: f32, useHeights: f32,
  baseDefault: f32, topMin: f32, topMax: f32, densityMin: f32,
}
@group(0) @binding(0) var<uniform> P: Params;
const NONE: u32 = 0xffffffffu;
fn packSeed(p: vec3<i32>) -> u32 { return u32(p.x) | (u32(p.y) << 11u) | (u32(p.z) << 22u); }
fn unpackSeed(s: u32) -> vec3<i32> { return vec3<i32>(i32(s & 2047u), i32((s >> 11u) & 2047u), i32(s >> 22u)); }
fn voxelIndex(p: vec3<i32>) -> u32 { return (u32(p.z) * P.dims.y + u32(p.y)) * P.dims.x + u32(p.x); }
`;

/** 2D coverage mask → seeds. Reuses the 3D seed buffers with dims = (w, h, 1). Bindings 1,2 weather+sampler, 3,4 seed buffers. */
export const SEED2D_WGSL = /* wgsl */ `${PARAMS}
@group(0) @binding(1) var weather: texture_2d<f32>;
@group(0) @binding(2) var weatherSampler: sampler;
@group(0) @binding(3) var<storage, read_write> seedsA: array<u32>; // nearest inside (cloud) pixel
@group(0) @binding(4) var<storage, read_write> seedsB: array<u32>; // nearest outside pixel

@compute @workgroup_size(8, 8, 1)
fn seed2d(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= P.dims.x || g.y >= P.dims.y) { return; }
  let uv = (vec2<f32>(f32(g.x), f32(g.y)) + 0.5) / vec2<f32>(f32(P.dims.x), f32(P.dims.y));
  let inside = textureSampleLevel(weather, weatherSampler, uv, 0.0).r > P.covThreshold;
  let p = vec3<i32>(i32(g.x), i32(g.y), 0);
  let i = voxelIndex(p);
  let me = packSeed(p);
  seedsA[i] = select(NONE, me, inside);
  seedsB[i] = select(me, NONE, inside);
}
`;

/** One jump-flood step over a z-range, for both seed sets. Works for dims.z = 1 (2D). */
export const JFA_WGSL = /* wgsl */ `${PARAMS}
@group(0) @binding(1) var<storage, read> srcA: array<u32>;
@group(0) @binding(2) var<storage, read> srcB: array<u32>;
@group(0) @binding(3) var<storage, read_write> dstA: array<u32>;
@group(0) @binding(4) var<storage, read_write> dstB: array<u32>;

fn dist2(s: u32, p: vec3<i32>) -> i32 { let d = unpackSeed(s) - p; return dot(d, d); }

@compute @workgroup_size(8, 8, 4)
fn jfa(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= P.dims.x || g.y >= P.dims.y || g.z >= P.zCount) { return; }
  let p = vec3<i32>(i32(g.x), i32(g.y), i32(P.zStart + g.z));
  let i = voxelIndex(p);
  var bestA = srcA[i]; var bestB = srcB[i];
  var dA = select(0x7fffffff, dist2(bestA, p), bestA != NONE);
  var dB = select(0x7fffffff, dist2(bestB, p), bestB != NONE);
  let dims = vec3<i32>(P.dims);
  for (var dz = -1; dz <= 1; dz++) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (dx == 0 && dy == 0 && dz == 0) { continue; }
        let q = p + vec3<i32>(dx, dy, dz) * P.step;
        if (any(q < vec3<i32>(0)) || any(q >= dims)) { continue; }
        let qi = voxelIndex(q);
        let sa = srcA[qi];
        if (sa != NONE) { let d = dist2(sa, p); if (d < dA) { dA = d; bestA = sa; } }
        let sb = srcB[qi];
        if (sb != NONE) { let d = dist2(sb, p); if (d < dB) { dB = d; bestB = sb; } }
      }
    }
  }
  dstA[i] = bestA; dstB[i] = bestB;
}
`;

/** Weather map + 2D edge distance → NVDF voxels and initial 3D seeds. */
export const NVDF_WGSL = /* wgsl */ `${PARAMS}
@group(0) @binding(1) var weather: texture_2d<f32>;
@group(0) @binding(2) var weatherSampler: sampler;
@group(0) @binding(3) var<storage, read> edgeSeeds: array<u32>;     // 2D: nearest outside pixel, per pixel (dims.x*dims.y)
@group(0) @binding(4) var nvdf: texture_storage_3d<rgba8unorm, write>;
@group(0) @binding(5) var<storage, read_write> seedsA: array<u32>;  // 3D nearest inside voxel
@group(0) @binding(6) var<storage, read_write> seedsB: array<u32>;  // 3D nearest outside voxel

// pow(h,2) * pow(1-h,1.5) peaks at h = 4/7 with this value.
const ENVELOPE_PEAK: f32 = 0.0916;

@compute @workgroup_size(8, 8, 4)
fn nvdfMain(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= P.dims.x || g.y >= P.dims.y || g.z >= P.zCount) { return; }
  let p = vec3<i32>(i32(g.x), i32(g.y), i32(P.zStart + g.z));
  let uv = (vec2<f32>(f32(g.x), f32(g.y)) + 0.5) / vec2<f32>(f32(P.dims.x), f32(P.dims.y));
  let w = textureSampleLevel(weather, weatherSampler, uv, 0.0);
  let cov = w.r;
  let cloudType = w.g;
  var base = P.baseDefault;
  var top = mix(P.topMin, P.topMax, smoothstep(P.covThreshold, 1.0, cov));
  if (P.useHeights > 0.5) { base = w.b; top = w.a; }

  // Edge gradient from the distance to the coverage boundary in the 2D map (voxels, minus half a pixel).
  var edge = 0.0;
  if (cov > P.covThreshold) {
    let s = edgeSeeds[u32(p.y) * P.dims.x + u32(p.x)];
    if (s == NONE) { edge = 1.0; }
    else {
      let o = unpackSeed(s);
      let d = length(vec2<f32>(f32(o.x - p.x), f32(o.y - p.y))) - 0.5;
      edge = smoothstep(0.0, P.edgeWidth, d);
    }
  }

  // Envelope method: height fraction from min/max height, bottom pow(h,2), top pow(1-h,1.5).
  let hz = (f32(p.z) + 0.5) / f32(P.dims.z);
  let h = (hz - base) / max(top - base, 1e-3);
  var profile = 0.0;
  if (h > 0.0 && h < 1.0) { profile = pow(h, 2.0) * pow(1.0 - h, 1.5) / ENVELOPE_PEAK * edge; }
  let p8 = round(clamp(profile, 0.0, 1.0) * 255.0);
  let occupied = p8 > 0.0;

  // Detail type: wispy (0) at the base to billowy (1) at the top, pushed by the cloud type.
  let detail = clamp(mix(clamp(h, 0.0, 1.0), cloudType, 0.5), 0.0, 1.0);
  let scale = mix(P.densityMin, 1.0, smoothstep(P.covThreshold, 1.0, cov));
  // Outside the cloud the shipped assets hold G = B = 1.
  textureStore(nvdf, p, select(vec4<f32>(0.0, 1.0, 1.0, 1.0), vec4<f32>(p8 / 255.0, detail, scale, 1.0), occupied));

  let i = voxelIndex(p);
  let me = packSeed(p);
  seedsA[i] = select(NONE, me, occupied);
  seedsB[i] = select(me, NONE, occupied);
}
`;

/**
 * Final signed distance. r16float is not a core storage-texture format, so each thread packs two adjacent texels as f16
 * into a row-padded (256 B) buffer and the result is copied into the r16float texture with copyBufferToTexture.
 */
export const SDF_WGSL = /* wgsl */ `${PARAMS}
@group(0) @binding(1) var<storage, read> seedsA: array<u32>;
@group(0) @binding(2) var<storage, read> seedsB: array<u32>;
@group(0) @binding(3) var<storage, read_write> packed: array<u32>;

fn signedDistance(p: vec3<i32>) -> f32 {
  let i = voxelIndex(p);
  let me = packSeed(p);
  let a = seedsA[i];
  let b = seedsB[i];
  var d: f32;
  if (a == me) {
    // Inside: centre to nearest outside centre, minus half a voxel (surface lies between), minus the conservative margin.
    d = select(-P.maxDist, -max(0.0, length(vec3<f32>(unpackSeed(b) - p)) - 0.5 - P.margin) * P.voxelSize, b != NONE);
  } else {
    d = select(P.maxDist, max(0.0, length(vec3<f32>(unpackSeed(a) - p)) - 0.5 - P.margin) * P.voxelSize, a != NONE);
  }
  d = clamp(d, -P.maxDist, P.maxDist);
  // The f16 conversion rounds to nearest; bias by 2^-10 relative (one ulp) so the stored value is never larger.
  return d - abs(d) * (1.0 / 1024.0);
}

@compute @workgroup_size(8, 8, 4)
fn sdfMain(@builtin(global_invocation_id) g: vec3<u32>) {
  let x0 = g.x * 2u;
  if (x0 >= P.dims.x || g.y >= P.dims.y || g.z >= P.zCount) { return; }
  let z = P.zStart + g.z;
  let p0 = vec3<i32>(i32(x0), i32(g.y), i32(z));
  let d0 = signedDistance(p0);
  var d1 = 0.0;
  if (x0 + 1u < P.dims.x) { d1 = signedDistance(p0 + vec3<i32>(1, 0, 0)); }
  let rowWords = ((P.dims.x * 2u + 255u) / 256u) * 64u;
  packed[(z * P.dims.y + g.y) * rowWords + g.x] = pack2x16float(vec2<f32>(d0, d1));
}
`;

/** Procedural weather map: R coverage, G cloud type, B base height, A top height (fractions of the volume height). */
export const WEATHER_WGSL = /* wgsl */ `
struct WeatherParams {
  size: vec2<u32>, seed: f32, scale: f32,
  coverageLo: f32, coverageHi: f32, border: f32, _pad: f32,
}
@group(0) @binding(0) var<uniform> W: WeatherParams;
@group(0) @binding(1) var outTex: texture_storage_2d<rgba8unorm, write>;

fn hash(p: vec2<i32>) -> f32 {
  var h = u32(p.x) * 374761393u + u32(p.y) * 668265263u + u32(W.seed * 977.0) * 2246822519u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h = h ^ (h >> 16u);
  return f32(h) * (1.0 / 4294967295.0);
}
fn hash2(p: vec2<i32>) -> vec2<f32> { return vec2<f32>(hash(p), hash(p + vec2<i32>(101, 57))); }
fn valueNoise(p: vec2<f32>) -> f32 {
  let i = vec2<i32>(floor(p));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2<i32>(1, 0)), u.x), mix(hash(i + vec2<i32>(0, 1)), hash(i + vec2<i32>(1, 1)), u.x), u.y);
}
fn fbm(p0: vec2<f32>) -> f32 {
  var p = p0; var a = 0.5; var s = 0.0; var n = 0.0;
  for (var o = 0; o < 5; o++) { s += a * valueNoise(p); n += a; p = p * 2.03 + vec2<f32>(17.1, 9.7); a *= 0.5; }
  return s / n;
}
fn worleyF1(p: vec2<f32>) -> f32 {
  let i = vec2<i32>(floor(p));
  let f = fract(p);
  var m = 8.0;
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let o = vec2<i32>(x, y);
    let d = vec2<f32>(f32(x), f32(y)) + hash2(i + o) - f;
    m = min(m, dot(d, d));
  } }
  return sqrt(m);
}

@compute @workgroup_size(8, 8, 1)
fn weatherMain(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= W.size.x || g.y >= W.size.y) { return; }
  let uv = (vec2<f32>(f32(g.x), f32(g.y)) + 0.5) / vec2<f32>(f32(W.size.x), f32(W.size.y));
  let q = uv * W.scale;
  let n = fbm(q + vec2<f32>(W.seed * 13.0, 0.0));
  let edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  // Fade to nothing near the map border so every cloud has an outside pixel around it.
  var cov = smoothstep(W.coverageLo, W.coverageHi, n) * smoothstep(0.0, W.border, edge);
  let t = fbm(q * 0.7 + vec2<f32>(31.0, W.seed * 7.0));
  let cellular = 1.0 - clamp(worleyF1(q * 1.6) * 1.3, 0.0, 1.0);
  let cloudType = clamp(0.6 * t + 0.5 * cellular - 0.05, 0.0, 1.0);
  let base = 0.06 + 0.14 * fbm(q * 1.3 + vec2<f32>(5.0, 3.0));
  let top = min(0.98, base + 0.2 + 0.7 * cov * (0.55 + 0.45 * fbm(q * 1.1 + vec2<f32>(11.0, 29.0))));
  textureStore(outTex, vec2<i32>(g.xy), vec4<f32>(cov, cloudType, base, top));
}
`;
