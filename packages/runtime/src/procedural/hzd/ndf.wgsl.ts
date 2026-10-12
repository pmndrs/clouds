/**
 * H1 (L1): the Nubis-era NDF (work/specs/ndf.md): five fields per column of sky, all 0..1.
 *   coverage    how much cloud in this column                                     (every shaper)
 *   topType     0 flat stratiform top .. 1 tall tiered cumulus top                (the HZD shaper reads it as HZD's cloud type)
 *   bottomType  0 sharp-onset crisp base .. 1 slow ragged base                   (the HZD shaper's 'tables' profile; F2: varies by area)
 *   minHeight   base of the column, as a fraction of the layer
 *   maxHeight   top of the column
 *
 * Storage (an implementation detail, hidden behind `ndfSample`): one rgba8unorm 2D array texture with two layers, layer 0 = (coverage, topType,
 * bottomType, reserved 0) as the spec's ndfA, layer 1 = (minHeight, maxHeight, 0, 0) for the spec's rg8unorm ndfB. The spec's two textures
 * would cost the procedural trace a 17th sampled texture (WebGPU's default per-stage limit is 16 and the trace pass already binds 16); the
 * array costs one binding. The map tiles (repeat addressing); `P.hzLayer.z` is the world size of one tile.
 */
import { HZD_NOISE_LIB_WGSL, HZD_WORLEY_SCALE } from './noise.wgsl';

/** The sampling helper. Needs `procWeather: texture_2d_array<f32>`, `procRepeat` and `P` (ProcParams). Every HZD-era shaper reads the NDF through it. */
export const HZD_NDF_SAMPLE_WGSL = /* wgsl */ `
struct NdfSample { coverage: f32, topType: f32, bottomType: f32, minHeight: f32, maxHeight: f32 }
// W1 motion: the map moves with the wind offset times P.hzSpeed.x (0 for 'static'; settings.ts ndfMotion packs the policy into hzSpeed).
fn ndfOffset() -> vec2<f32> { return P.drift.xz * P.hzSpeed.x; }
fn ndfSample(xz: vec2<f32>) -> NdfSample {
  let uv = (xz - ndfOffset()) / P.hzLayer.z;
  let a = textureSampleLevel(procWeather, procRepeat, uv, 0, 0.0);
  let b = textureSampleLevel(procWeather, procRepeat, uv, 1, 0.0);
  return NdfSample(a.r, a.g, a.b, b.r, b.g);
}
`;

/** The generator (work/specs/ndf.md "Generation (until W2 lands)"): periodic fBMs, so the map tiles exactly. */
export const HZD_NDF_GEN_WGSL = /* wgsl */ `
${HZD_NOISE_LIB_WGSL}
struct NdfGen {
  cells: vec4<f32>,     // coverage cells, island cells, type cells, height cells
  coverage: vec4<f32>,  // island weight, coverage lo, coverage hi, seed
  types: vec4<f32>,     // type min, type max, bottom type (F2: the field's centre), F2 bottom-type range
  heights: vec4<f32>,   // min height, max height, variation, F2 bottom-type cells
  foot: vec4<f32>,      // H6: footprint (0 Perlin .. 1 Perlin-Worley, N17 p.56-57), Worley cells, F2 bottom-type correlation with the top type, 0
  n17: vec4<f32>,       // W1: recipe (0 h6, 1 n17), gate cells, gate lo, gate hi
  n17b: vec4<f32>,      // W1: footprint lo, footprint hi, type contrast, island gain
}
@group(0) @binding(0) var<uniform> G: NdfGen;
@group(0) @binding(1) var ndfOut: texture_storage_2d_array<rgba8unorm, write>;
// fBM of periodic Perlin on the plane z = const (between lattice planes): 'octaves' octaves from 'cells' cells per tile, amplitudes halving.
fn ndfFbm(uv: vec2<f32>, cells: f32, octaves: u32, seed: u32) -> f32 {
  var sum = 0.0; var norm = 0.0; var amp = 1.0; var c = max(1.0, round(cells));
  for (var i = 0u; i < octaves; i++) {
    sum += amp * hzdPerlin(vec3(uv * c, 0.37), i32(c), seed + i * 17u, true);
    norm += amp; amp *= 0.5; c *= 2.0;
  }
  return sum / norm;
}
@compute @workgroup_size(8, 8)
fn generate(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(ndfOut);
  if (any(id.xy >= size)) { return; }
  let uv = (vec2<f32>(id.xy) + 0.5) / vec2<f32>(size);
  let seed = u32(G.coverage.w) * 7919u;
  let n17 = G.n17.x > 0.5;
  // h6 coverage: footprints (4 octaves) lifted and sunk region by region by a low-frequency island gate, mapped linearly from lo..hi to 0..1.
  // A gradual field, as HZD's maps are: the coverage remap of noise x gradient (not the map's edge) shapes each cloud.
  // W1 n17 coverage (n17 p.54-57): the same 4-octave footprint, mapped footLo..footHi, carved below (Perlin-Worley), then times the gate.
  let fp = ndfFbm(uv, G.cells.x, 4u, seed + 1u);
  let v = select(fp + G.coverage.x * ndfFbm(uv, G.cells.y, 2u, seed + 101u), fp, n17);
  let lo = select(G.coverage.y, G.n17b.x, n17);
  let hi = select(G.coverage.z, G.n17b.y, n17);
  var coverage = saturate((v - lo) / (hi - lo));
  // H6, N17 p.56-57: the Perlin-Worley footprint ("isolated islands with connective tissue"). N17 p.34's Perlin-Worley in 2D:
  // remap(perlin, 1 - worley, 1, 0, 1) with an inverted 2-octave Worley fBM (cells ours): the Perlin coverage is carved along the Worley cell
  // borders into round islands; where the Perlin is high the borders stay partly covered (the connective tissue).
  if (G.foot.x > 0.0) {
    let c = max(1.0, round(G.foot.y));
    let f1 = sqrt(hzdWorley(vec3(uv, 0.37), c, seed + 501u) / ${HZD_WORLEY_SCALE});
    let f2 = sqrt(hzdWorley(vec3(uv, 0.37), c * 2.0, seed + 502u) / ${HZD_WORLEY_SCALE});
    let w = saturate(1.0 - (0.7 * f1 + 0.3 * f2));
    // h6: carve (remap(cov, 1 - w, 1, 0, 1)); it halves the coverage (H6). W1 n17: dilate instead, as the 3D Perlin-Worley does (gp7 p.106:
    // the Worley lifts the Perlin at cell centres): cov + islandGain x (w - 0.5) raises round islands at the cells and sinks their borders,
    // leaving the Perlin's high ridges as the connective tissue. Mean coverage stays about the same.
    let pw = select(saturate((coverage - (1.0 - w)) / max(w, 1e-3)), saturate(coverage + G.n17b.w * (w - 0.5)), n17);
    coverage = mix(coverage, pw, G.foot.x);
  }
  // W1 n17 gate (p.55): one low-frequency noise, open (1) where clouds may form, closed (0) between: clear-sky regions and clusters.
  if (n17) {
    coverage *= smoothstep(G.n17.z, G.n17.w, ndfFbm(uv, G.n17.y, 4u, seed + 601u));
  }
  // Top type: a very-low-frequency field over typeMin..typeMax (W1 n17: typeContrast sharpens it into type areas).
  let typeGain = select(1.6, 1.6 * G.n17b.z, n17);
  let topType = mix(G.types.x, G.types.y, saturate(0.5 + typeGain * ndfFbm(uv, G.cells.z, 2u, seed + 201u)));
  // Heights: the layer range with mild variation; the top stays at least 5 % of the layer above the base.
  let minHeight = saturate(G.heights.x + G.heights.z * ndfFbm(uv, G.cells.w, 2u, seed + 301u));
  let maxHeight = max(saturate(G.heights.y + G.heights.z * ndfFbm(uv, G.cells.w, 2u, seed + 401u)), min(minHeight + 0.05, 1.0));
  // F2 bottom type, per area (both recipes): the centre + range x a 2-octave fBM, + correlation x the top type's place in its range (negative:
  // crisp bases under cumulus, soft ragged ones under stratiform types). Range 0 and correlation 0 = the H1-F1 constant.
  let tN = saturate((topType - G.types.x) / max(G.types.y - G.types.x, 1e-3));
  var bottomType = G.types.z + G.foot.z * (tN - 0.5);
  if (G.types.w != 0.0) { bottomType += G.types.w * 1.6 * ndfFbm(uv, G.heights.w, 2u, seed + 701u); }
  textureStore(ndfOut, id.xy, 0, vec4(coverage, topType, saturate(bottomType), 0.0));
  textureStore(ndfOut, id.xy, 1, vec4(minHeight, maxHeight, 0.0, 0.0));
}
`;

/**
 * W1 authored map: resample painted images into the NDF (bilinear, wrapping). The image's centre sits at the world origin (uv + 0.5), so a map
 * painted around its middle is the sky around the camera's start. Layer 0 from `imgA` (R coverage, G top type, B bottom type), layer 1 from
 * `imgB` (R min height, G max height; the top kept at least 1/255 above the base). A flag of 0 leaves that layer as generated.
 */
export const HZD_NDF_IMAGE_WGSL = /* wgsl */ `
@group(0) @binding(0) var<uniform> flags: vec4<f32>;   // x: write layer 0, y: write layer 1
@group(0) @binding(1) var imgA: texture_2d<f32>;
@group(0) @binding(2) var imgB: texture_2d<f32>;
@group(0) @binding(3) var imgSampler: sampler;
@group(0) @binding(4) var ndfOut: texture_storage_2d_array<rgba8unorm, write>;
@compute @workgroup_size(8, 8)
fn overlay(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(ndfOut);
  if (any(id.xy >= size)) { return; }
  let uv = (vec2<f32>(id.xy) + 0.5) / vec2<f32>(size) + 0.5;
  let a = textureSampleLevel(imgA, imgSampler, uv, 0.0);
  let b = textureSampleLevel(imgB, imgSampler, uv, 0.0);
  if (flags.x > 0.5) { textureStore(ndfOut, id.xy, 0, vec4(a.rgb, 0.0)); }
  if (flags.y > 0.5) { textureStore(ndfOut, id.xy, 1, vec4(b.r, max(b.g, min(b.r + 1.0 / 255.0, 1.0)), 0.0, 0.0)); }
}
`;
