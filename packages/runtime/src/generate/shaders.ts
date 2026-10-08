// WGSL for the GPU NVDF generator. No three imports.
// The distance field is an exact separable EDT in one u16-per-voxel buffer (see EDT_COMMON); no jump flood, no seed buffers.

/** Shared params block (96 bytes), one dynamic-offset slot per job. zStart/zCount: the job's chunk, a z range (nvdf, edt x/y, profile, sdf) or a y range (edt z). `step` is unused. */
const PARAMS = /* wgsl */ `
struct Params {
  dims: vec3<u32>, step: i32,   // step: unused
  zStart: u32, zCount: u32, margin: f32, maxDist: f32,
  voxelSize: f32, covThreshold: f32, useHeights: f32, baseDefault: f32,
  topFrac: f32, domeExp: f32, billowAmp: f32, billowCell: f32,
  seed: f32, scaleBase: f32, scaleTop: f32, sigma: f32,
  detailBias: f32, baseLift: f32, originX: f32, originY: f32,   // origin: world metres of voxel (0,0) along x and the map row
}
@group(0) @binding(0) var<uniform> P: Params;
`;

/**
 * The distance field lives in one u16-per-voxel buffer (two voxels per u32, x-fastest, rows padded to 256 B so the same buffer is the
 * copyBufferToTexture source of the SDF):  bit 15 = voxel is inside the cloud, bits 0..14 = distance in 1/64 voxel to the nearest
 * voxel of the opposite class (saturating at 511.98 voxels). Because every voxel has exactly one non-zero partial distance (an inside voxel
 * is at distance 0 from the "inside" set, an outside voxel from the "outside" set), one signed volume carries the whole separable
 * transform of both classes. The passes (x, y, z) run in place; each line is owned by one thread. Distances are floored on every store, so
 * the result never exceeds the exact EDT.
 */
const EDT_COMMON = /* wgsl */ `
const CAP: u32 = 32767u;
const CLS: u32 = 0x8000u;
fn rowWords() -> u32 { return ((P.dims.x * 2u + 255u) / 256u) * 64u; }
fn wIdx(x: u32, y: u32, z: u32) -> u32 { return (z * P.dims.y + y) * rowWords() + (x >> 1u); }
`;

/** Pass 1: along x, one thread per (y, z) row of the z range [zStart, zStart + zCount). Exact two-sweep 1D distance. */
export const EDT_X_WGSL = /* wgsl */ `${PARAMS}${EDT_COMMON}
@group(0) @binding(1) var<storage, read_write> fld: array<atomic<u32>>;

@compute @workgroup_size(64)
fn edtX(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= P.dims.y * P.zCount) { return; }
  let y = g.x % P.dims.y;
  let z = P.zStart + g.x / P.dims.y;
  let base = wIdx(0u, y, z);
  let nw = (P.dims.x + 1u) / 2u;
  var lastIn = -100000; var lastOut = -100000;
  for (var k = 0u; k < nw; k++) {
    let wv = atomicLoad(&fld[base + k]);
    var o = 0u;
    for (var s = 0u; s < 2u; s++) {
      let x = 2u * k + s;
      if (x >= P.dims.x) { break; }
      let raw = (wv >> (16u * s)) & 0xffffu;
      var d: i32;
      if ((raw & CLS) != 0u) { d = i32(x) - lastOut; lastIn = i32(x); } else { d = i32(x) - lastIn; lastOut = i32(x); }
      o = o | (((raw & CLS) | min(CAP, u32(d) * 64u)) << (16u * s));
    }
    atomicStore(&fld[base + k], o);
  }
  var nextIn = 1000000; var nextOut = 1000000;
  for (var kk = 0u; kk < nw; kk++) {
    let k = nw - 1u - kk;
    let wv = atomicLoad(&fld[base + k]);
    var o = wv;
    for (var ss = 0u; ss < 2u; ss++) {
      let s = 1u - ss;
      let x = 2u * k + s;
      if (x >= P.dims.x) { continue; }
      let raw = (wv >> (16u * s)) & 0xffffu;
      var d: i32;
      if ((raw & CLS) != 0u) { d = nextOut - i32(x); nextIn = i32(x); } else { d = nextIn - i32(x); nextOut = i32(x); }
      let code = min(raw & CAP, min(CAP, u32(d) * 64u));
      o = (o & ~(0xffffu << (16u * s))) | (((raw & CLS) | code) << (16u * s));
    }
    atomicStore(&fld[base + k], o);
  }
}
`;

/**
 * Passes 2 (axis 'y', line length h, range = z) and 3 (axis 'z', line length d, range = y): Felzenszwalb-Huttenlocher lower envelope of the
 * squared partial distances along one axis, one thread per line (x, range index), private arrays of `n` entries. Two envelopes per line:
 * features of the inside set (inside voxels at their partial distance, outside voxels at 0) answer the inside voxels, and vice versa.
 * The input values are floors, so the output is an under-estimate of the exact EDT by at most 1/64 voxel per pass.
 */
export function edtLineWGSL(axis: 'y' | 'z', n: number): string {
  const at = axis === 'y' ? 'vec3<u32>(x, q, r)' : 'vec3<u32>(x, r, q)';
  return /* wgsl */ `${PARAMS}${EDT_COMMON}
@group(0) @binding(1) var<storage, read_write> fld: array<atomic<u32>>;
const N: u32 = ${n}u;
var<private> ln: array<u32, ${n}>;
var<private> vv: array<u32, ${n}>;
var<private> zz: array<f32, ${n + 1}>;

fn feat(q: u32, inside: bool) -> f32 {
  let raw = ln[q];
  return select(0.0, f32(raw & CAP) * (1.0 / 64.0), ((raw & CLS) != 0u) == inside);
}

@compute @workgroup_size(64)
fn edtLine(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= P.dims.x * P.zCount) { return; }
  let x = g.x % P.dims.x;
  let r = P.zStart + g.x / P.dims.x;
  let sh = (x & 1u) * 16u;
  var nIn = 0u;
  for (var q = 0u; q < N; q++) {
    let p = ${at};
    let raw = (atomicLoad(&fld[wIdx(p.x, p.y, p.z)]) >> sh) & 0xffffu;
    ln[q] = raw;
    nIn += raw >> 15u;
  }
  for (var ps = 0u; ps < 2u; ps++) {
    let inside = ps == 0u;
    if ((inside && nIn == 0u) || (!inside && nIn == N)) { continue; }
    var k = 0;
    vv[0] = 0u; zz[0] = -1e30; zz[1] = 1e30;
    for (var q = 1u; q < N; q++) {
      let fq = feat(q, inside);
      let fq2 = fq * fq;
      var s: f32;
      loop {
        let p = vv[k];
        let fp = feat(p, inside);
        s = ((fq2 - fp * fp) / f32(q - p) + f32(q + p)) * 0.5;
        if (s <= zz[k]) { k--; } else { break; }
      }
      k++;
      vv[k] = q; zz[k] = s; zz[k + 1] = 1e30;
    }
    k = 0;
    for (var q = 0u; q < N; q++) {
      while (zz[k + 1] < f32(q)) { k++; }
      if (((ln[q] & CLS) != 0u) != inside) { continue; }
      let p = vv[k];
      let dq = f32(q) - f32(p);
      let fp = feat(p, inside);
      let code = min(CAP, u32(floor(sqrt(dq * dq + fp * fp) * 64.0)));
      let pos = ${at};
      let i = wIdx(pos.x, pos.y, pos.z);
      atomicAnd(&fld[i], ~(0xffffu << sh));
      atomicOr(&fld[i], ((ln[q] & CLS) | code) << sh);
    }
  }
}
`;
}

/** Hash, 3D Worley, the inverted-Worley billow and the value noise of the generator, parameter-free so the distant sky layer shares them. */
export const BILLOW_WGSL = /* wgsl */ `
fn hashu(p: vec3<i32>, s: u32) -> u32 {
  var h = (u32(p.x) * 0x8da6b343u) ^ (u32(p.y) * 0xd8163841u) ^ (u32(p.z) * 0xcb1ab31fu) ^ (s * 0x9e3779b9u);
  h = h ^ (h >> 15u); h = h * 0x2c1b3c6du; h = h ^ (h >> 12u); h = h * 0x297a2d39u; h = h ^ (h >> 15u);
  return h;
}
fn hash3f(p: vec3<i32>, s: u32) -> vec3<f32> {
  let a = hashu(p, s);
  let b = hashu(p, a + 0x68e31da4u);
  let c = hashu(p, b + 0xb5297a4du);
  return vec3<f32>(f32(a), f32(b), f32(c)) * (1.0 / 4294967295.0);
}
fn worleyF1(q: vec3<f32>, s: u32) -> f32 {
  let i = vec3<i32>(floor(q));
  let f = fract(q);
  var m = 4.0;
  for (var z = -1; z <= 1; z++) { for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let o = vec3<i32>(x, y, z);
    let d = vec3<f32>(o) + hash3f(i + o, s) - f;
    m = min(m, dot(d, d));
  } } }
  return sqrt(m);
}
/** Centred billow in about [-0.5, 0.5]: inverted Worley, up to three octaves, cell size halves each octave. cell0 metres, s0 the seed. */
fn billowAt(pm: vec3<f32>, cell0: f32, s0: u32, octaves: u32) -> f32 {
  var a = 0.0; var wsum = 0.0; var amp = 0.55; var cell = cell0;
  for (var o = 0u; o < octaves; o++) {
    let w = 1.0 - clamp(worleyF1(pm / cell + vec3<f32>(f32(o) * 7.3, f32(o) * 3.1, 0.0), s0 + o * 17u) * 1.1, 0.0, 1.0);
    a += amp * w; wsum += amp; cell *= 0.5; amp *= 0.55;
  }
  return a / wsum - 0.36;
}
/** Smooth value noise in [0, 1] (the profile's multiplicative depth noise); shared with the sky layer too. */
fn valueNoise3(p: vec3<f32>, s: u32) -> f32 {
  let i = vec3<i32>(floor(p));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  var r = 0.0;
  for (var k = 0u; k < 8u; k++) {
    let o = vec3<i32>(i32(k & 1u), i32((k >> 1u) & 1u), i32(k >> 2u));
    let w = mix(1.0 - u, u, vec3<f32>(o));
    r += w.x * w.y * w.z * (f32(hashu(i + o, s)) * (1.0 / 4294967295.0));
  }
  return r;
}
`;

/**
 * Cloud shape (shared by the occupancy and profile passes). Why it is built like this, in terms of the old generator's artefacts:
 * the old occupancy was "profile(height) * edge(2D distance) > 0" with the column's base/top read off a saturating coverage ramp, so
 * a cloud was a stack of per-column [base, top] intervals: the silhouette was a heightfield of a steep, 8-bit-quantised map (vertical
 * walls where the ramp is steep, terraces where it quantises, flat plateaus where it saturates). Here the cloud is the level set
 * f > 0 of a smooth 3D field instead:
 *   s = (coverage - threshold) / (1 - threshold)   smooth 2D "mass" (peaks at lobe centres)
 *   h = (z - base) / (topFrac - base)               height above the flat base
 *   f = s - h^p + noise                             p = 2 gives hemispherical domes (s = 1 - r^2), p > 2 flatter, p < 2 towers
 * so cloud height follows local mass, the sides are rounded by construction, and the base is flat but soft.
 * The noise is inverted-Worley billow (a few octaves from billowCell metres down), applied only near the surface (so it cannot
 * punch holes in the interior or float islands far outside) and strongest on tops.
 */
const SHAPE = /* wgsl */ `${BILLOW_WGSL}
fn billow(pm: vec3<f32>) -> f32 { return billowAt(pm, P.billowCell, u32(P.seed * 131.0), 3u); }
struct Shape { s: f32, h: f32, f0: f32, f: f32, hcol: f32, base: f32, top: f32, cloudType: f32 }
fn dome(h: f32, s: f32) -> f32 {
  // g(h): hemisphere-like height law; below the base a steep soft ramp (flat base: a ramp of about s/24 of the height, i.e. one or two voxels, so contours of the base do not stack into shelves).
  return select(-h * 24.0, pow(h, P.domeExp), h >= 0.0);
}
fn shapeAt(p: vec3<i32>, w: vec4<f32>, withNoise: bool) -> Shape {
  var r: Shape;
  r.cloudType = w.g;
  r.base = P.baseDefault; r.top = P.topFrac;
  if (P.useHeights > 0.5) { r.base = w.b; r.top = w.a; }
  r.s = clamp((w.r - P.covThreshold) / (1.0 - P.covThreshold), 0.0, 1.0);
  let hz = (f32(p.z) + 0.5) / f32(P.dims.z);
  // The base is flat in the middle of a lobe and curls up toward its rim (a concave underside; also trims the thin skirts around a cloud).
  r.base = r.base + P.baseLift * pow(1.0 - r.s, 1.5);
  r.h = (hz - r.base) / max(r.top - r.base, 1e-3);
  r.f0 = r.s - dome(r.h, r.s);
  r.f = r.f0;
  // Fraction of the way up this column's own extent (column top is where s = h^p).
  r.hcol = clamp(r.h / pow(max(r.s, 0.05), 1.0 / P.domeExp), 0.0, 1.0);
  if (withNoise && P.billowAmp > 0.0 && r.f0 > -0.55 && r.f0 < 0.5 && r.s > 0.0) {
    let pm = vec3<f32>(f32(p.x) + 0.5, f32(p.y) + 0.5, f32(p.z) + 0.5) * P.voxelSize + vec3<f32>(P.originX, P.originY, 0.0);
    let b = billow(pm);
    // Strongest on tops and near the surface, none deep inside or far outside.
    let near = (1.0 - smoothstep(0.18, 0.45, r.f0)) * smoothstep(-0.55, -0.3, r.f0);
    let topW = mix(0.45, 1.0, smoothstep(0.1, 0.7, r.hcol)) * (1.0 - smoothstep(0.82, 1.0, r.h)); // no billow near the ceiling, so towers do not hit the volume top and get cut flat
    r.f = r.f0 + P.billowAmp * 3.0 * b * near * topW;
  }
  return r;
}
`;

/** Occupancy: f > 0 (before the profile is known) -> the class bit of the distance field. Binding 3 is the field. One thread, two voxels. */
export const NVDF_WGSL = /* wgsl */ `${PARAMS}${SHAPE}${EDT_COMMON}
@group(0) @binding(1) var weather: texture_2d<f32>;
@group(0) @binding(2) var weatherSampler: sampler;
@group(0) @binding(3) var<storage, read_write> fld: array<u32>;

@compute @workgroup_size(8, 8, 4)
fn nvdfMain(@builtin(global_invocation_id) g: vec3<u32>) {
  let x0 = g.x * 2u;
  if (x0 >= P.dims.x || g.y >= P.dims.y || g.z >= P.zCount) { return; }
  let z = P.zStart + g.z;
  var o = 0u;
  for (var s = 0u; s < 2u; s++) {
    let x = x0 + s;
    if (x >= P.dims.x) { break; }
    let p = vec3<i32>(i32(x), i32(g.y), i32(z));
    let uv = (vec2<f32>(f32(x), f32(g.y)) + 0.5) / vec2<f32>(f32(P.dims.x), f32(P.dims.y));
    let sh = shapeAt(p, textureSampleLevel(weather, weatherSampler, uv, 0.0), true);
    if (sh.f > 0.0 && sh.h < 1.5) { o = o | (CLS << (16u * s)); }
  }
  fld[wIdx(x0, g.y, z)] = o;
}
`;

/**
 * NVDF channels from the finished jump flood, with Guerrilla's fitted statistics (scripts/vdb/nvdf_math.py PACK_FIT):
 *   profile = sat((d_eff - 1.4) / 66)^1.05 * (0.1 + 0.9 smoothstep(0, 0.22, hfrac)),  d_eff = depth * exp(sigma * noise)
 *   detail  = smoothstep(0.1, 0.75, hfrac - 0.25 sat(depth / 32));   density scale = lerp(s0, s1, smoothstep(0, 0.6, hfrac))
 * depth = distance (m) to the nearest outside voxel centre minus half a voxel. Occupied voxels keep profile >= 1/255 so the
 * texture's non-zero set equals the SDF mask. Outside the cloud the shipped assets hold G = B = 1.
 */
export const PROFILE_WGSL = /* wgsl */ `${PARAMS}${SHAPE}${EDT_COMMON}
@group(0) @binding(1) var weather: texture_2d<f32>;
@group(0) @binding(2) var weatherSampler: sampler;
@group(0) @binding(3) var<storage, read> fld: array<u32>;
@group(0) @binding(5) var nvdf: texture_storage_3d<rgba8unorm, write>;

@compute @workgroup_size(8, 8, 4)
fn profileMain(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= P.dims.x || g.y >= P.dims.y || g.z >= P.zCount) { return; }
  let p = vec3<i32>(i32(g.x), i32(g.y), i32(P.zStart + g.z));
  let raw = (fld[wIdx(g.x, g.y, P.zStart + g.z)] >> ((g.x & 1u) * 16u)) & 0xffffu;
  if ((raw & CLS) == 0u) { textureStore(nvdf, p, vec4<f32>(0.0, 1.0, 1.0, 1.0)); return; }
  let uv = (vec2<f32>(f32(g.x), f32(g.y)) + 0.5) / vec2<f32>(f32(P.dims.x), f32(P.dims.y));
  let sh = shapeAt(p, textureSampleLevel(weather, weatherSampler, uv, 0.0), false);
  var depth = P.maxDist;
  if ((raw & CAP) != CAP) { depth = max(0.0, (f32(raw & CAP) * (1.0 / 64.0) - 0.5) * P.voxelSize); }
  // Smooth unit-ish noise with about 3 voxels of correlation.
  let pm = vec3<f32>(f32(p.x) + 0.5, f32(p.y) + 0.5, f32(p.z) + 0.5) * P.voxelSize + vec3<f32>(P.originX, P.originY, 0.0);
  let n = clamp((valueNoise3(pm / (3.0 * P.voxelSize), u32(P.seed * 53.0)) - 0.5) * 3.4, -2.5, 2.5);
  let hf = sh.hcol;
  let dEff = depth * exp(P.sigma * n);
  let core = pow(clamp((dEff - 1.4) / 66.0, 0.0, 1.0), 1.05);
  let lift = 0.1 + 0.9 * smoothstep(0.0, 0.22, hf);
  let p8 = max(round(clamp(core * lift, 0.0, 1.0) * 255.0), 1.0);
  let detail = clamp(smoothstep(0.1, 0.75, hf - 0.25 * clamp(depth / 32.0, 0.0, 1.0)) + (sh.cloudType - 0.5) * P.detailBias, 0.0, 1.0);
  let scale = mix(P.scaleBase, P.scaleTop, smoothstep(0.0, 0.6, hf));
  textureStore(nvdf, p, vec4<f32>(p8 / 255.0, detail, clamp(scale, 0.0, 1.0), 1.0));
}
`;

/**
 * Final signed distance. r16float is not a core storage-texture format, so each thread packs two adjacent texels as f16
 * into a row-padded (256 B) buffer and the result is copied into the r16float texture with copyBufferToTexture.
 */
export const SDF_WGSL = /* wgsl */ `${PARAMS}${EDT_COMMON}
@group(0) @binding(1) var<storage, read_write> fld: array<u32>;

fn signedDistance(raw: u32) -> f32 {
  // Centre to nearest opposite centre, minus half a voxel (the surface lies between) and the conservative margin.
  let m = min(max(0.0, f32(raw & CAP) * (1.0 / 64.0) - 0.5 - P.margin) * P.voxelSize, P.maxDist);
  let d = select(m, -m, (raw & CLS) != 0u);
  // The f16 conversion rounds to nearest; shrink the magnitude by 2^-10 relative (one ulp) so the stored |d| is never larger.
  return d * (1.0 - 1.0 / 1024.0);
}

@compute @workgroup_size(8, 8, 4)
fn sdfMain(@builtin(global_invocation_id) g: vec3<u32>) {
  let x0 = g.x * 2u;
  if (x0 >= P.dims.x || g.y >= P.dims.y || g.z >= P.zCount) { return; }
  let i = wIdx(x0, g.y, P.zStart + g.z);
  let wv = fld[i];
  let d0 = signedDistance(wv & 0xffffu);
  var d1 = 0.0;
  if (x0 + 1u < P.dims.x) { d1 = signedDistance(wv >> 16u); }
  fld[i] = pack2x16float(vec2<f32>(d0, d1));
}
`;

/** Procedural weather map: R coverage, G cloud type, B base height, A top height (fractions of the volume height). */
export const WEATHER_WGSL = /* wgsl */ `
struct WeatherParams {
  size: vec2<u32>, seed: f32, scale: f32,
  coverageLo: f32, coverageHi: f32, border: f32, cellular: f32,
  cellScale: f32, p0: f32, p1: f32, p2: f32,
  uvOrigin: vec2<f32>, uvSize: vec2<f32>,   // window of the map's own uv space this texture shows (default 0,0 / 1,1)
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
  let uv = W.uvOrigin + (vec2<f32>(f32(g.x), f32(g.y)) + 0.5) / vec2<f32>(f32(W.size.x), f32(W.size.y)) * W.uvSize;
  let q = uv * W.scale;
  let fb = fbm(q + vec2<f32>(W.seed * 13.0, 0.0));
  // Cellular mass: one dome per Worley cell (cumulus lobes), modulated by fBm so cells differ in size and some die out.
  let cell = 1.0 - clamp(worleyF1(uv * W.cellScale + vec2<f32>(W.seed * 3.7, 1.3)) * 1.25, 0.0, 1.0);
  let n = mix(fb, clamp(0.25 + 0.75 * cell * (0.45 + 1.1 * fb), 0.0, 1.0), W.cellular);
  let edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  // Wide ramp (no saturation plateau): coverage stays a smooth, peaked mass field. Fade to nothing near the border.
  let cov = smoothstep(W.coverageLo, W.coverageHi, n) * select(1.0, smoothstep(0.0, W.border, edge), W.border > 0.0);
  let t = fbm(q * 0.7 + vec2<f32>(31.0, W.seed * 7.0));
  let cellType = 1.0 - clamp(worleyF1(q * 1.6) * 1.3, 0.0, 1.0);
  let cloudType = clamp(0.6 * t + 0.5 * cellType - 0.05, 0.0, 1.0);
  let base = 0.06 + 0.14 * fbm(q * 1.3 + vec2<f32>(5.0, 3.0));
  let top = min(0.98, base + 0.2 + 0.7 * cov * (0.55 + 0.45 * fbm(q * 1.1 + vec2<f32>(11.0, 29.0))));
  textureStore(outTex, vec2<i32>(g.xy), vec4<f32>(cov, cloudType, base, top));
}
`;
