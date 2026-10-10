/**
 * H1 (S2): the HZD noise set, baked on the GPU at init. Three textures, as HZD 2015 s31-33 and GPU Pro 7 p.102 describe them:
 *   shape  128^3 RGBA  R = Perlin-Worley, G/B/A = Worley fBMs of rising frequency (base shape, read with gp7's 0.625/0.25/0.125)
 *   detail  32^3 RGBA  R/G/B = Worley fBMs of rising frequency (edge erosion), A = 1
 *   curl   128^2 RGBA  R/G/B = the curl of a periodic vector potential (signed, "3 curl noise dims"), A = 1
 *
 * Recipe: the Nubis Noise Generator HDA (Schneider 2017, the author's own tool for the HZD low-frequency texture; docs/research/sources/noise.md),
 * read from its network:
 *   R = fit chain over a 5-octave Perlin turbulence (5 cells per tile, roughness 0.54):
 *       r = fit(t, -0.6, 0.6); r = fit(r, -0.1 (1 - W(85))); r = fit(r, -0.1 (1 - W(165))); r = fit(r, 0.5 W(10)); r = fit(r, 0.2 W(20)); R = (r + 0.1) / 1.2
 *   G/B/A = fit(1 - (W(10g) + W(19g)/3 + W(25g)/6 + W(37g)/8 + W(5g)/3) / 5, 0.75, 1), g = 1, 1.7, 2.3
 * Differences from the tool (all written down in work/reports/H1.md):
 *   - exact periodic tiling (periodic Perlin, Worley with wrapped cell indices: tvn.md, psrd.md) instead of the tool's 8-corner cross-blend;
 *   - integer cell counts (the gains 1.7 and 2.3 give 8.5, 32.3, ... cells per tile, which cannot tile; rounded);
 *   - the two unit conventions of Houdini's noises are calibrated, not guessed: W(f) = 0.65 * F1^2 (squared distance in cells) and the Perlin
 *     turbulence * 0.68 reproduce the cooked tool's channel statistics (R mean 0.50 std 0.105, G/B/A mean 0.69 std 0.10; noise.md) within 0.01.
 *   - the 32^3 detail texture is not in the tool: the same multi-octave Worley recipe at gains 0.188 / 0.32 / 0.432, so the finest octave of
 *     the finest channel sits at the 32^3 Nyquist limit (16 cells; tvn.md's rule) with the tool's 1 : 1.7 : 2.3 ladder.
 *   - curl: the curl of three periodic Perlin fBMs (2 octaves, 4 and 8 cells per tile) on one z plane, by central differences.
 */

/** Cells per tile of the five Worley octaves (multipliers 10, 19, 25, 37, 5 times a gain), rounded so the octave tiles. */
export function worleyLadder(gain: number): [number, number, number, number, number] {
  return [10, 19, 25, 37, 5].map(m => Math.max(1, Math.round(m * gain))) as [number, number, number, number, number];
}
/** The shape texture's G/B/A gains (Nubis tool) and the detail texture's R/G/B gains (ours: the same ladder, finest octave at 16 cells). */
export const HZD_SHAPE_GAINS = [1.0, 1.7, 2.3] as const;
export const HZD_DETAIL_GAINS = [16 / 37 / 2.3, (16 / 37 / 2.3) * 1.7, 16 / 37] as const;
/** Calibration of Houdini's noise units (see the header). */
export const HZD_WORLEY_SCALE = 0.65;
export const HZD_PERLIN_SCALE = 0.68;

const ladderWgsl = (name: string, gain: number) => `const ${name} = array<f32, 5>(${worleyLadder(gain).map(n => n.toFixed(1)).join(', ')});`;

/** Shared periodic noise kernels (PCG hash, periodic Perlin with random unit gradients, periodic Worley F1^2). */
export const HZD_NOISE_LIB_WGSL = /* wgsl */ `
fn hzdPcg3(v0: vec3<u32>) -> vec3<u32> {
  var v = v0 * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v = v ^ (v >> vec3<u32>(16u));
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
fn hzdWrap(c: vec3<i32>, period: i32) -> vec3<u32> { return vec3<u32>(((c % vec3<i32>(period)) + vec3<i32>(period)) % vec3<i32>(period)); }
fn hzdRand3(c: vec3<u32>, seed: u32) -> vec3<f32> {
  return vec3<f32>(hzdPcg3(c + vec3<u32>(seed * 1013u, seed * 2971u, seed * 7919u)) >> vec3<u32>(8u)) / 16777216.0;
}
// Perlin's gradient noise with a random unit gradient per lattice point (uniform on the sphere) and the cubic s-curve, periodic in all three
// axes with an integer period (lattice indices wrapped before hashing). Range about +-0.9, mean 0.
fn hzdGrad(c: vec3<i32>, period: i32, seed: u32, d: vec3<f32>) -> f32 {
  let r = hzdRand3(hzdWrap(c, period), seed);
  let z = r.x * 2.0 - 1.0;
  let a = r.y * 6.2831853;
  let s = sqrt(max(1.0 - z * z, 0.0));
  return dot(vec3(s * cos(a), s * sin(a), z), d);
}
// quintic = false: Perlin's 1985 cubic fade (Houdini's onoise; the shape texture). true: the 2002 quintic fade, C2, for the curl, whose
// derivatives would otherwise crease along every lattice plane.
fn hzdPerlin(p: vec3<f32>, period: i32, seed: u32, quintic: bool) -> f32 {
  let c = vec3<i32>(floor(p));
  let f = fract(p);
  let u = select(f * f * (3.0 - 2.0 * f), f * f * f * (f * (f * 6.0 - 15.0) + 10.0), quintic);
  let n000 = hzdGrad(c, period, seed, f);
  let n100 = hzdGrad(c + vec3<i32>(1, 0, 0), period, seed, f - vec3(1.0, 0.0, 0.0));
  let n010 = hzdGrad(c + vec3<i32>(0, 1, 0), period, seed, f - vec3(0.0, 1.0, 0.0));
  let n110 = hzdGrad(c + vec3<i32>(1, 1, 0), period, seed, f - vec3(1.0, 1.0, 0.0));
  let n001 = hzdGrad(c + vec3<i32>(0, 0, 1), period, seed, f - vec3(0.0, 0.0, 1.0));
  let n101 = hzdGrad(c + vec3<i32>(1, 0, 1), period, seed, f - vec3(1.0, 0.0, 1.0));
  let n011 = hzdGrad(c + vec3<i32>(0, 1, 1), period, seed, f - vec3(0.0, 1.0, 1.0));
  let n111 = hzdGrad(c + vec3<i32>(1, 1, 1), period, seed, f - vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
// Worley F1^2 in cell units, scaled to Houdini's worleynoise (calibrated, see the header): p in [0,1)^3, 'cells' feature points per tile edge,
// one jittered point per cell (three independent hashes, not tvn's diagonal-only offset), cell indices wrapped so the field tiles exactly.
fn hzdWorley(p: vec3<f32>, cells: f32, seed: u32) -> f32 {
  let q = p * cells;
  let c = vec3<i32>(floor(q));
  let period = i32(cells);
  var best = 1.0e9;
  for (var z = -1; z <= 1; z++) {
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let n = c + vec3<i32>(x, y, z);
        let d = vec3<f32>(n) + hzdRand3(hzdWrap(n, period), seed) - q;
        best = min(best, dot(d, d));
      }
    }
  }
  return ${HZD_WORLEY_SCALE} * best;
}
fn hzdFit(v: f32, a: f32, b: f32) -> f32 { return saturate((v - a) / (b - a)); }
// The Nubis multi-octave Worley sampler: a weighted average of five octaves, inverted, black point 0.75.
fn hzdWorleyFbm(p: vec3<f32>, cells: array<f32, 5>, seed: u32) -> f32 {
  let a = (hzdWorley(p, cells[0], seed) + hzdWorley(p, cells[1], seed + 1u) / 3.0 + hzdWorley(p, cells[2], seed + 2u) / 6.0
    + hzdWorley(p, cells[3], seed + 3u) / 8.0 + hzdWorley(p, cells[4], seed + 4u) / 3.0) / 5.0;
  return hzdFit(1.0 - a, 0.75, 1.0);
}
`;

/** Compute kernels: `shape` (128^3), `detail` (32^3), `curl` (128^2), `mip` (2x2x2 box down-sample of one 3D level). */
export function hzdNoiseBakeWgsl(format: GPUTextureFormat): string {
  return /* wgsl */ `
${HZD_NOISE_LIB_WGSL}
${ladderWgsl('HZD_G', HZD_SHAPE_GAINS[0])}
${ladderWgsl('HZD_B', HZD_SHAPE_GAINS[1])}
${ladderWgsl('HZD_A', HZD_SHAPE_GAINS[2])}
${ladderWgsl('HZD_DR', HZD_DETAIL_GAINS[0])}
${ladderWgsl('HZD_DG', HZD_DETAIL_GAINS[1])}
${ladderWgsl('HZD_DB', HZD_DETAIL_GAINS[2])}
struct BakeParams { seed: u32, size: u32, _a: u32, _b: u32 }
@group(0) @binding(0) var<uniform> B: BakeParams;
@group(0) @binding(1) var out3d: texture_storage_3d<${format}, write>;

// The Nubis Perlin-Worley (R): Houdini turbnoise (original Perlin, 5 octaves from 5 cells per tile, roughness 0.54) through four Worley
// black-point remaps; the coarse ones (10, 20 cells) carve, the fine ones (85, 165) dilate.
fn hzdPerlinWorley(p: vec3<f32>, seed: u32) -> f32 {
  var t = 0.0; var amp = 1.0; var period = 5;
  for (var i = 0u; i < 5u; i++) {
    t += amp * hzdPerlin(p * f32(period), period, seed + 40u + i, false);
    amp *= 0.54; period *= 2;
  }
  var r = hzdFit(t * ${HZD_PERLIN_SCALE}, -0.6, 0.6);
  r = hzdFit(r, -0.1 * (1.0 - hzdWorley(p, 85.0, seed + 50u)), 1.0);
  r = hzdFit(r, -0.1 * (1.0 - hzdWorley(p, 165.0, seed + 51u)), 1.0);
  r = hzdFit(r, 0.5 * hzdWorley(p, 10.0, seed + 52u), 1.0);
  r = hzdFit(r, 0.2 * hzdWorley(p, 20.0, seed + 53u), 1.0);
  return (r + 0.1) / 1.2;
}

@compute @workgroup_size(4, 4, 4)
fn shape(@builtin(global_invocation_id) id: vec3<u32>) {
  if (any(id >= vec3<u32>(B.size))) { return; }
  let p = (vec3<f32>(id) + 0.5) / f32(B.size);
  let r = hzdPerlinWorley(p, B.seed);
  let g = hzdWorleyFbm(p, HZD_G, B.seed + 100u);
  let b = hzdWorleyFbm(p, HZD_B, B.seed + 200u);
  let a = hzdWorleyFbm(p, HZD_A, B.seed + 300u);
  textureStore(out3d, id, vec4(r, g, b, a));
}

@compute @workgroup_size(4, 4, 4)
fn detail(@builtin(global_invocation_id) id: vec3<u32>) {
  if (any(id >= vec3<u32>(B.size))) { return; }
  let p = (vec3<f32>(id) + 0.5) / f32(B.size);
  textureStore(out3d, id, vec4(hzdWorleyFbm(p, HZD_DR, B.seed + 400u), hzdWorleyFbm(p, HZD_DG, B.seed + 500u), hzdWorleyFbm(p, HZD_DB, B.seed + 600u), 1.0));
}
`;
}

export const HZD_CURL_BAKE_WGSL = /* wgsl */ `
${HZD_NOISE_LIB_WGSL}
struct BakeParams { seed: u32, size: u32, _a: u32, _b: u32 }
@group(0) @binding(0) var<uniform> B: BakeParams;
@group(0) @binding(1) var out2d: texture_storage_2d<rgba16float, write>;
// One component of the vector potential: a 2-octave periodic Perlin fBM (4 and 8 cells per tile). Only one z plane is stored, between lattice
// planes (z = 0.0917 is 0.37 and 0.73 of a cell): on a lattice plane the z derivative is a bilinear blend of the corner gradients and shows the grid.
fn hzdPotential(p: vec3<f32>, seed: u32) -> f32 {
  return hzdPerlin(p * 4.0, 4, seed, true) + 0.5 * hzdPerlin(p * 8.0, 8, seed + 1u, true);
}
fn hzdPsi(p: vec3<f32>) -> vec3<f32> { return vec3(hzdPotential(p, B.seed + 700u), hzdPotential(p, B.seed + 710u), hzdPotential(p, B.seed + 720u)); }
@compute @workgroup_size(8, 8)
fn curl(@builtin(global_invocation_id) id: vec3<u32>) {
  if (any(id.xy >= vec2<u32>(B.size))) { return; }
  let p = vec3((vec2<f32>(id.xy) + 0.5) / f32(B.size), 0.0917);
  let e = 0.25 / f32(B.size);
  let dx = (hzdPsi(p + vec3(e, 0.0, 0.0)) - hzdPsi(p - vec3(e, 0.0, 0.0))) / (2.0 * e);
  let dy = (hzdPsi(p + vec3(0.0, e, 0.0)) - hzdPsi(p - vec3(0.0, e, 0.0))) / (2.0 * e);
  let dz = (hzdPsi(p + vec3(0.0, 0.0, e)) - hzdPsi(p - vec3(0.0, 0.0, e))) / (2.0 * e);
  // curl = (dPz/dy - dPy/dz, dPx/dz - dPz/dx, dPy/dx - dPx/dy); the gradients are about 4 * 2.5 per unit at most: scaled to about +-1.
  let c = vec3(dy.z - dz.y, dz.x - dx.z, dx.y - dy.x) / 12.0;
  textureStore(out2d, id.xy, vec4(c, 1.0));
}
`;

/** 2x2x2 box down-sample of a 3D texture level (sizes are powers of two, so the tiling is kept exactly). */
export function hzdMipWgsl(format: GPUTextureFormat): string {
  return /* wgsl */ `
@group(0) @binding(0) var src: texture_3d<f32>;
@group(0) @binding(1) var dst: texture_storage_3d<${format}, write>;
@compute @workgroup_size(4, 4, 4)
fn mip(@builtin(global_invocation_id) id: vec3<u32>) {
  if (any(id >= textureDimensions(dst))) { return; }
  var s = vec4(0.0);
  for (var k = 0u; k < 8u; k++) { s += textureLoad(src, vec3<i32>(id * 2u + vec3<u32>(k & 1u, (k >> 1u) & 1u, k >> 2u)), 0); }
  textureStore(dst, id, s * 0.125);
}
`;
}
