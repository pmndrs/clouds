/**
 * H1 (S1): the 'hzd' shaper, Horizon Zero Dawn's density sampler as GPU Pro 7 prints it (gp7 p.103-110; docs/research/sources/gp7.md), on the
 * Nubis-era NDF (work/specs/ndf.md) and our bake of the HZD noise set (procedural/hzd/noise.ts). The chain, in GP7's order:
 *   1  wind (p.109-110): the tops lean `cloudTopOffset` downwind (p += h * wind * 500), the noise scrolls with the wind offset at its own speed
 *      per texture and rises by `upwardBias` per metre (the book's (0, 0.1, 0), read in a y-up frame)
 *   2  base shape (p.106): fbm = .625 G + .25 B + .125 A; base = remap(R, -(1 - fbm), 1, 0, 1): the Worley fBM dilates the Perlin-Worley
 *   3  height gradient (p.106, body unpublished): the shipped Nutshell trapezoids (nut s7-8: stratus 0.02/0.07/0.11/0.18, stratocumulus
 *      0.04/0.16/0.32/0.48, cumulus 0.01/0.09/0.65/0.80), blended by type (law unpublished: `typeBlend`); h is the column's height fraction
 *      between the NDF's min and max height
 *   4  coverage (HFW p.17 sign): remap(base * gradient, 1 - coverage, 1, 0, 1), then gp7 p.107's `* coverage` (switch)
 *   5  base fade before erosion (hzd15 s35-36): x remap(h, 0, baseFadeHeight, baseFadeMin, 1) so bases erode harder (constants ours)
 *   6  detail (p.108-109): curl displaces the detail lookup only, by (1 - h); 32^3 fBM .625 R + .25 G + .125 B; modifier
 *      mix(fbm, 1 - fbm, sat(h * 10)) (wispy below 10 % of the column, billowy above); final = remap(d, modifier * 0.2, 1, 0, 1)
 *   anvil: `hzdAnvil` is the hook for S7 (N17's coverage exponent); it returns the coverage unchanged.
 * GP7 reads the detail texture at `p * 0.1` relative to the shape texture, which would make the 32^3 "high frequency" texture ten times
 * coarser than the 128^3 one; we read it with its own tile (`detailTile`) instead (see work/reports/H1.md).
 */
import { PROC_SKYPRO_WGSL, PROC_TAKRAM_WGSL, PROC_BINDING_OFFSETS, procBindingsWgsl } from '../density.wgsl';
import type { ProceduralShaper } from '../settings';
import { HZD_NDF_SAMPLE_WGSL } from './ndf.wgsl';

/** The shipped HZD height gradients (Nutshell slide-XML stops; nut.md), (rise start, full, fall start, zero). */
export const HZD_GRADIENTS = {
  stratus: [0.02, 0.07, 0.11, 0.18],
  stratocumulus: [0.04, 0.16, 0.32, 0.48],
  cumulus: [0.01, 0.09, 0.65, 0.8],
} as const;
const v4 = (a: readonly number[]) => `vec4(${a.map(x => x.toFixed(2)).join(', ')})`;

/** CPU mirror of `hzdHeightGradient` (tests and plots). */
export function hzdHeightGradient(type: number, h: number, blend: 'points' | 'curves' = 'points'): number {
  const trap = (s: readonly number[]) => Math.min(1, Math.max(0, (h - s[0]) / (s[1] - s[0]))) * Math.min(1, Math.max(0, (s[3] - h) / (s[3] - s[2])));
  const { stratus: S, stratocumulus: M, cumulus: C } = HZD_GRADIENTS;
  const t = Math.min(1, Math.max(0, type));
  if (blend === 'points') {
    const [a, b, k] = t < 0.5 ? [S, M, t * 2] : [M, C, t * 2 - 1];
    return trap(a.map((x, i) => x + (b[i] - x) * k));
  }
  const ws = Math.max(0, 1 - 2 * t), wc = Math.max(0, 2 * t - 1);
  return ws * trap(S) + (1 - ws - wc) * trap(M) + wc * trap(C);
}

/** The bindings of the HZD shaper: as procBindingsWgsl, but the weather slot is the NDF's 2D array. */
export function hzdBindingsWgsl(group: number, base: number): string {
  const o = PROC_BINDING_OFFSETS;
  return /* wgsl */ `
@group(${group}) @binding(${base + o.params}) var<uniform> P: ProcParams;
@group(${group}) @binding(${base + o.noiseA}) var procNoiseA: texture_3d<f32>;
@group(${group}) @binding(${base + o.noiseB}) var procNoiseB: texture_3d<f32>;
@group(${group}) @binding(${base + o.weather}) var procWeather: texture_2d_array<f32>;
@group(${group}) @binding(${base + o.aux}) var procAux: texture_2d<f32>;
@group(${group}) @binding(${base + o.sampler}) var procRepeat: sampler;
`;
}

export const PROC_HZD_WGSL = /* wgsl */ `
${HZD_NDF_SAMPLE_WGSL}
const HZD_STRATUS = ${v4(HZD_GRADIENTS.stratus)};
const HZD_STRATOCUMULUS = ${v4(HZD_GRADIENTS.stratocumulus)};
const HZD_CUMULUS = ${v4(HZD_GRADIENTS.cumulus)};
// gp7 p.105: Remap without a clamp.
fn hzdRemap(v: f32, a: f32, b: f32, c: f32, d: f32) -> f32 { return c + (v - a) / (b - a) * (d - c); }
// The N17 form remap(h, a, b, 0, 1) * remap(h, c, d, 1, 0), each factor clamped: a linear trapezoid (the Nutshell gradients are linear fills).
fn hzdTrapezoid(s: vec4<f32>, h: f32) -> f32 { return saturate((h - s.x) / (s.y - s.x)) * saturate((s.w - h) / (s.w - s.z)); }
fn hzdHeightGradient(cloudType: f32, h: f32) -> f32 {
  let t = saturate(cloudType);
  if (P.hzSpeed.w < 0.5) {
    // 'points': lerp the stops stratus -> stratocumulus (type 0..0.5) -> cumulus (0.5..1).
    let s = select(mix(HZD_STRATOCUMULUS, HZD_CUMULUS, t * 2.0 - 1.0), mix(HZD_STRATUS, HZD_STRATOCUMULUS, t * 2.0), t < 0.5);
    return hzdTrapezoid(s, h);
  }
  // 'curves': GP7 p.103's weighted sum of the three, tent weights.
  let ws = saturate(1.0 - 2.0 * t);
  let wc = saturate(2.0 * t - 1.0);
  return ws * hzdTrapezoid(HZD_STRATUS, h) + (1.0 - ws - wc) * hzdTrapezoid(HZD_STRATOCUMULUS, h) + wc * hzdTrapezoid(HZD_CUMULUS, h);
}
// S7 hook: N17's anvil exponent pow(coverage, remap(h, 0.7, 0.8, 1, lerp(1, 0.5, anvil_bias))) goes here. Unchanged for now.
fn hzdAnvil(coverage: f32, h: f32, n: NdfSample) -> f32 { return coverage; }
// H5: tricubic B-spline read of the 128^3 shape (and 32^3 detail) texture from 8 trilinear taps (Sigg & Hadwiger, GPU Gems 2 ch. 20). Trilinear filtering leaves a
// gradient kink on every texel face; at a 4 km tile a texel is 31 m, and the coverage threshold turns the kinks into terraced, faceted
// flanks and flat bases ("contour lines" seen from below). The B-spline is C2, so the iso-surfaces are smooth (ours; HZD does not say).
fn hzdCubic3(tex: texture_3d<f32>, uvw: vec3<f32>) -> vec4<f32> {
  let n = vec3<f32>(textureDimensions(tex, 0));
  let x = uvw * n - 0.5;
  let i = floor(x);
  let f = x - i;
  let f2 = f * f; let f3 = f2 * f;
  let w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  let w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  let w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  let w3 = f3 / 6.0;
  let g0 = w0 + w1;
  let g1 = w2 + w3;
  let h0 = (i - 0.5 + w1 / g0) / n;
  let h1 = (i + 1.5 + w3 / g1) / n;
  var r = vec4(0.0);
  for (var k = 0u; k < 8u; k++) {
    let sx = (k & 1u) != 0u; let sy = (k & 2u) != 0u; let sz = (k & 4u) != 0u;
    let c = vec3(select(h0.x, h1.x, sx), select(h0.y, h1.y, sy), select(h0.z, h1.z, sz));
    let w = select(g0.x, g1.x, sx) * select(g0.y, g1.y, sy) * select(g0.z, g1.z, sz);
    r += w * textureSampleLevel(tex, procRepeat, c, 0.0);
  }
  return r;
}
fn hzdLod(footprint: f32, tile: f32, texels: f32) -> f32 { return max(0.0, log2(max(footprint * texels / tile, 1e-6)) + P.hzFade.w); }

fn procSample(p: vec3<f32>, t: f32, footprint: f32, full: bool, jitter: f32) -> ProcSample {
  var o: ProcSample;
  o.sigma = 0.0; o.coarse = 0.0; o.depth = 0.0; o.h = 0.0;
  let alt = procAltitude(p);
  if (alt <= P.hzLayer.x || alt >= P.hzLayer.y) { return o; }
  var n = ndfSample(p.xz);
  // H5 horizon ring (hzd15 s45): coverage toward the ring's target and type toward cumulus from ringStart to ringEnd; nothing beyond ringEnd.
  if (P.hzRing.x > 0.0) {
    let r = length(p.xz - P.origin.xz);
    if (r >= P.hzRing.y) { return o; }
    let w = saturate((r - P.hzRing.x) / (P.hzRing.y - P.hzRing.x));
    // The last 20 % of the band also takes the coverage to 0, so the clouds shrink away instead of ending on a line at ringEnd (ours).
    n.coverage = mix(n.coverage, P.hzRing.z, w) * (1.0 - smoothstep(0.8, 1.0, r / P.hzRing.y));
    n.topType = mix(n.topType, P.hzRing.w, w);
  }
  let span = P.hzLayer.y - P.hzLayer.x;
  let bottom = P.hzLayer.x + n.minHeight * span;
  let top = P.hzLayer.x + n.maxHeight * span;
  if (alt <= bottom || alt >= top) { return o; }
  let h = (alt - bottom) / (top - bottom);
  let cov = hzdAnvil(saturate(n.coverage + P.hzCov.x), h, n);
  if (cov <= 0.0) { return o; }
  let gradient = hzdHeightGradient(n.topType + P.hzCov.y, h);
  if (gradient <= 0.0) { return o; }
  let stage = P.hzMisc.x;

  // 1 Wind: skew the tops downwind; each noise scrolls at its own speed with a small upward drift.
  let windDir = vec3(P.hzWind.x, 0.0, P.hzWind.y);
  let q = vec3(p.x, alt, p.z) - windDir * (h * P.hzWind.z);
  let scroll = P.drift.xyz + vec3(0.0, P.hzWind.w * length(P.drift.xz), 0.0);
  let qShape = q - scroll * P.hzSpeed.y;

  // 2 Base shape: the Perlin-Worley dilated by the low-frequency Worley fBM.
  let shapeLod = hzdLod(footprint, P.hzScale.x, 128.0);
  // The cubic read where the texture is magnified (lod 0) and within P.hzMisc.y metres (0 = off), for full samples only.
  let cubic = full && shapeLod <= 0.0 && t < P.hzMisc.y;
  var A: vec4<f32>;
  if (cubic) { A = hzdCubic3(procNoiseA, qShape / P.hzScale.x); } else { A = textureSampleLevel(procNoiseA, procRepeat, qShape / P.hzScale.x, shapeLod); }
  let lowFbm = A.g * 0.625 + A.b * 0.25 + A.a * 0.125;
  let pw = select(saturate(0.5 + (A.r - 0.5) * P.hzExtra.x), A.r, P.hzExtra.x == 1.0);   // H5 shapeContrast (1 = off)
  let baseCloud = hzdRemap(pw, -(1.0 - lowFbm), 1.0, 0.0, 1.0) * gradient;   // 3 height gradient

  // 4 Coverage: threshold 1 - coverage (HFW p.17), then the gp7 multiply; 5 base fade before erosion (stage 2 and up).
  var d = hzdRemap(baseCloud, 1.0 - cov, 1.0, 0.0, 1.0);
  if (d <= 0.0) { return o; }
  if (stage >= 1.5) {
    if (P.hzCov.z > 0.5) { d *= cov; }
    d *= hzdRemap(saturate(h / P.hzFade.y), 0.0, 1.0, P.hzFade.x, 1.0);
  }
  let coarse = saturate(d);

  // 6 Detail (stage 3, full samples, within the detail distance; the fade is dithered so its end draws no line).
  var density = d;
  let fade = 1.0 - smoothstep(0.75, 1.25, t / max(P.hzFade.z, 1.0) + (jitter - 0.5) * 0.1);
  if (full && stage >= 2.5 && fade > 0.0) {
    var qd = q - scroll * P.hzSpeed.z;
    let curl = textureSampleLevel(procAux, procRepeat, qd.xz / P.hzScale.z, 0.0).xy;
    qd = qd + vec3(curl.x, 0.0, curl.y) * (P.hzScale.w * (1.0 - h));
    let detailLod = hzdLod(footprint, P.hzScale.y, 32.0);
    var B: vec3<f32>;
    if (detailLod <= 0.0 && t < P.hzMisc.w) { B = hzdCubic3(procNoiseB, qd / P.hzScale.y).rgb; }
    else { B = textureSampleLevel(procNoiseB, procRepeat, qd / P.hzScale.y, detailLod).rgb; }
    let hfFbm = B.r * 0.625 + B.g * 0.25 + B.b * 0.125;
    let hag = P.hzCov.w > 0.5;
    let modifier = mix(hfFbm, 1.0 - hfFbm, saturate(h * select(10.0, 5.0, hag)));
    let strength = select(0.2, 0.35 * exp(-0.75 * cov), hag);
    density = hzdRemap(d, modifier * strength * fade, 1.0, 0.0, 1.0);
  }
  density = saturate(density);
  if (density <= 0.0) { return o; }
  // H5 (ne22 p.105's envelope sharpen, pow(.., 0.27), as a setting; 1 = GP7, no shaping): lifts the low densities of the edge ramp so a lit rim
  // reads crisp instead of a wide haze.
  if (P.hzMisc.z != 1.0) { density = pow(density, P.hzMisc.z); }
  o.sigma = density * P.hzLayer.w;
  o.coarse = coarse;
  o.h = h;
  // No surface distance in a per-sample model: the coarse density times the column height stands in (as the Takram shaper).
  o.depth = coarse * (top - bottom) * 0.25;
  return o;
}
fn procCellIsEmpty(t: f32, end: f32, dir: vec3<f32>, originHeight: f32, maximumWeather: f32) -> bool { return false; }
const PROC_HAS_BOUNDS = false;
// The trace re-uses a light tap while the density changes by under 8 % of this reference. The chain's densities stay under about 0.3 of the
// extinction (coverage remap, * coverage, erosion), so the full extinction would re-use the light across whole flanks (visible terraces).
fn procSigmaRef() -> f32 { return P.hzLayer.w * 0.25; }
`;

/** The density WGSL of a shaper (ProcParams struct not included). */
export function procShaperWgsl(shaper: ProceduralShaper): string {
  return shaper === 'skypro' ? PROC_SKYPRO_WGSL : shaper === 'hzd' ? PROC_HZD_WGSL : PROC_TAKRAM_WGSL;
}
/** The bindings of a shaper's density WGSL. */
export function procShaperBindingsWgsl(shaper: ProceduralShaper, group: number, base: number): string {
  return shaper === 'hzd' ? hzdBindingsWgsl(group, base) : procBindingsWgsl(group, base);
}
