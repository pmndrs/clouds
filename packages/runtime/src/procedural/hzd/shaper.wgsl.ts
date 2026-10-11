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
 * coarser than the 128^3 one; we read it with its own tile (`detailTile`) instead (see work/reports/H1.md). H5 re-tested the literal reading
 * (detail tile = 10 x the shape tile = 60 km): the erosion turns into a near-constant offset and the edge billows of Fig 4.16 vanish, so the
 * separate 400 m tile stays (work/captures/H5/step6/).
 * H5 defaults (work/reports/H5.md): no `* coverage` (HFW p.17), GP7's weighted-sum type blend, a 6 km shape tile with a tricubic read,
 * the GP7 Fig 4.9 detail recipe, and HZD 2015's 15-35 km horizon ring.
 */
import { PROC_SKYPRO_WGSL, PROC_TAKRAM_WGSL, PROC_BINDING_OFFSETS, procBindingsWgsl } from '../density.wgsl';
import type { ProceduralShaper } from '../settings';
import { HZD_NDF_SAMPLE_WGSL } from './ndf.wgsl';
import { PROFILE_TABLE_FLOOR, profilePeaks, profileTablesSmoothed, sampleProfileTable } from '../../generate/profile-tables';

/** The shipped HZD height gradients (Nutshell slide-XML stops; nut.md), (rise start, full, fall start, zero). */
export const HZD_GRADIENTS = {
  stratus: [0.02, 0.07, 0.11, 0.18],
  stratocumulus: [0.04, 0.16, 0.32, 0.48],
  cumulus: [0.01, 0.09, 0.65, 0.8],
} as const;
const v4 = (a: readonly number[]) => `vec4(${a.map(x => x.toFixed(2)).join(', ')})`;

/** CPU mirror of `hzdHeightGradient` (tests and plots). */
export function hzdHeightGradient(type: number, h: number, blend: 'points' | 'curves' | 'hybrid' = 'points', opts: { topRound?: number; smooth?: boolean } = {}): number {
  const ramp = (x: number) => { const t = Math.min(1, Math.max(0, x)); return opts.smooth ? t * t * (3 - 2 * t) : t; };
  const rise = (s: readonly number[]) => ramp((h - s[0]) / (s[1] - s[0]));
  const fall = (s: readonly number[]) => { const c = s[2] + (s[1] - s[2]) * (opts.topRound ?? 0); return ramp((s[3] - h) / Math.max(s[3] - c, 1e-3)); };
  const trap = (s: readonly number[]) => rise(s) * fall(s);
  const { stratus: S, stratocumulus: M, cumulus: C } = HZD_GRADIENTS;
  const t = Math.min(1, Math.max(0, type));
  const [a, b, k] = t < 0.5 ? [S, M, t * 2] : [M, C, t * 2 - 1];
  const lerped = a.map((x, i) => x + (b[i] - x) * k);
  if (blend === 'points') return trap(lerped);
  const ws = Math.max(0, 1 - 2 * t), wc = Math.max(0, 2 * t - 1);
  if (blend === 'curves') return ws * trap(S) + (1 - ws - wc) * trap(M) + wc * trap(C);
  return rise(lerped) * (ws * fall(S) + (1 - ws - wc) * fall(M) + wc * fall(C));
}

/** F1: CPU mirror of the WGSL table type map (HZD type -> table top type through the three anchors). */
export function hzdTableType(type: number, anchors: readonly [number, number, number]): number {
  const x = Math.min(1, Math.max(0, type));
  return x < 0.5 ? anchors[0] + (anchors[1] - anchors[0]) * x * 2 : anchors[1] + (anchors[2] - anchors[1]) * (x * 2 - 1);
}
/** F1: CPU mirror of `hzdTableProfile`: top(tt, h) x bottom(bt, h) / peak(tt, bt), the column base at table height `floor`. */
let peaks: Uint8Array | null = null;
export function hzdTableProfile(tt: number, bt: number, h: number, floor = PROFILE_TABLE_FLOOR): number {
  const { top, bottom } = profileTablesSmoothed();
  peaks ??= profilePeaks();
  const v = floor + Math.min(1, Math.max(0, h)) * (1 - floor);
  const pk = Math.max(sampleProfileTable(peaks, tt, (Math.min(1, Math.max(0, bt)) * 63 + 0.5) / 64), 0.05);
  return Math.min(1, sampleProfileTable(top, tt, v) * sampleProfileTable(bottom, bt, v) / pk);
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
// H6: topRound moves the fall's start from the stop c toward b (a wider, rounder top ramp; hag eq 6 falls over 0.2 wh..wh), and
// profileSmooth makes both ramps smoothstep (C1 at the stops). Both 0 = the Nutshell trapezoid.
fn hzdRamp(x: f32) -> f32 { let t = saturate(x); return select(t, t * t * (3.0 - 2.0 * t), P.hzProf.y > 0.5); }
fn hzdFall(s: vec4<f32>, h: f32) -> f32 { let c = mix(s.z, s.y, P.hzProf.x); return hzdRamp((s.w - h) / max(s.w - c, 1e-3)); }
fn hzdTrapezoid(s: vec4<f32>, h: f32, hr: f32) -> f32 { return hzdRamp((hr - s.x) / (s.y - s.x)) * hzdFall(s, h); }
fn hzdHeightGradient(cloudType: f32, h: f32) -> f32 { return hzdHeightGradientR(cloudType, h, h); }
// F1 step 1 (ne22 p.21-29, n3 s18): the NE vertical profile from H4's tables (generate/profile-tables.ts), packed 3 bytes per float in
// P.hzLut: t 0 = the top table (type across, height up), 1 = the bottom table, 2 = the column peaks (top type across, bottom type up).
fn hzdLutTexel(t: u32, x: u32, y: u32) -> f32 {
  let i = t * 4096u + y * 64u + x;
  let f = i / 3u;
  let w = u32(P.hzLut[f >> 2u][f & 3u]);
  return f32((w >> ((i - f * 3u) * 8u)) & 255u) * (1.0 / 255.0);
}
// Bilinear on texel centres (type: i / 63, height: (i + 0.5) / 64), as profile-tables.ts sampleProfileTable and sky-layer.wgsl.ts skyLut.
fn hzdLut(t: u32, type_: f32, v: f32) -> f32 {
  let x = saturate(type_) * 63.0;
  let y = clamp(v * 64.0 - 0.5, 0.0, 63.0);
  let x0 = min(u32(x), 62u);
  let y0 = min(u32(y), 62u);
  let fx = x - f32(x0);
  let a = mix(hzdLutTexel(t, x0, y0), hzdLutTexel(t, x0 + 1u, y0), fx);
  let b = mix(hzdLutTexel(t, x0, y0 + 1u), hzdLutTexel(t, x0 + 1u, y0 + 1u), fx);
  return mix(a, b, y - f32(y0));
}
// The HZD type (0 stratus, 0.5 stratocumulus, 1 cumulus) as a table top type, piecewise linear through P.hzType.yzw.
fn hzdTableType(cloudType: f32) -> f32 {
  let x = saturate(cloudType);
  return select(mix(P.hzType.z, P.hzType.w, x * 2.0 - 1.0), mix(P.hzType.y, P.hzType.z, x * 2.0), x < 0.5);
}
// The bottom type of the current column (procSample sets it; the gradient reads it).
var<private> hzdBt: f32 = 0.0;
// F1 S7: the storm weight of the current column (0..1) and its anvil amount; set in procSample.
var<private> hzdStormW: f32 = 0.0;
// top(tt, h) x bottom(bt, hr) / peak(tt, bt): the column base maps to the table floor P.hzType2.w, so min height is where the base is (H4).
fn hzdTableProfile(tt: f32, h: f32, hr: f32) -> f32 {
  let f0 = P.hzType2.w;
  let pk = max(hzdLut(2u, tt, (hzdBt * 63.0 + 0.5) / 64.0), 0.05);
  return saturate(hzdLut(0u, tt, f0 + saturate(h) * (1.0 - f0)) * hzdLut(1u, hzdBt, f0 + saturate(hr) * (1.0 - f0)) / pk);
}
// H7: hr is the height the rise (base) ramps are read at (h + the base-lump offset); the falls read h.
fn hzdHeightGradientR(cloudType: f32, h: f32, hr: f32) -> f32 {
  if (P.hzType.x > 0.5) { return hzdTableProfile(hzdTableType(cloudType), h, hr); }
  let t = saturate(cloudType);
  // 'points': lerp the stops stratus -> stratocumulus (type 0..0.5) -> cumulus (0.5..1).
  let s = select(mix(HZD_STRATOCUMULUS, HZD_CUMULUS, t * 2.0 - 1.0), mix(HZD_STRATUS, HZD_STRATOCUMULUS, t * 2.0), t < 0.5);
  if (P.hzSpeed.w < 0.5) { return hzdTrapezoid(s, h, hr); }
  // 'curves': GP7 p.103's weighted sum of the three, tent weights.
  let ws = saturate(1.0 - 2.0 * t);
  let wc = saturate(2.0 * t - 1.0);
  if (P.hzSpeed.w < 1.5) {
    return ws * hzdTrapezoid(HZD_STRATUS, h, hr) + (1.0 - ws - wc) * hzdTrapezoid(HZD_STRATOCUMULUS, h, hr) + wc * hzdTrapezoid(HZD_CUMULUS, h, hr);
  }
  // H7 'hybrid': one rise from the lerped stops times the weighted sum of the falls. The summed rises (cumulus full at 0.09, stratocumulus at
  // 0.16) put two base heights under every mixed-type body, which the coverage threshold cut into a base shelf; the summed falls keep
  // 'curves'' separate, rounded bodies (ours).
  return hzdRamp((hr - s.x) / (s.y - s.x)) * (ws * hzdFall(HZD_STRATUS, h) + (1.0 - ws - wc) * hzdFall(HZD_STRATOCUMULUS, h) + wc * hzdFall(HZD_CUMULUS, h));
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
// gp7 p.108: the curl displaces the detail lookup by (1 - h); the 32^3 fBM .625 R + .25 G + .125 B. 'cubic' = the H5 B-spline read when magnified.
// H7 (wispy bottoms, gp7 p.108 / hzd15 s37): below the wispy switch the curl displacement grows by up to P.hzSkirt.y (1 = gp7's (1 - h) only) and a
// share P.hzSkirt.z of it goes vertical (the curl's third component), so the eroded bottoms swirl and hang in shreds instead of cutting flat.
fn hzdDetailFbm(q0: vec3<f32>, h: f32, footprint: f32, cubic: bool) -> f32 {
  let curl = textureSampleLevel(procAux, procRepeat, q0.xz / P.hzScale.z, 0.0).xyz;
  let low = 1.0 - saturate(h / P.hzExtra.z);
  let gain = P.hzScale.w * (1.0 - h) * (1.0 + (P.hzSkirt.y - 1.0) * low);
  let qd = q0 + vec3(curl.x, curl.z * P.hzSkirt.z * low, curl.y) * gain;
  let detailLod = hzdLod(footprint, P.hzScale.y, 32.0);
  var B: vec3<f32>;
  if (cubic && detailLod <= 0.0) { B = hzdCubic3(procNoiseB, qd / P.hzScale.y).rgb; }
  else { B = textureSampleLevel(procNoiseB, procRepeat, qd / P.hzScale.y, detailLod).rgb; }
  return B.r * 0.625 + B.g * 0.25 + B.b * 0.125;
}

// F1: a world-anchored low-frequency field in -1..1 (the shape texture's Perlin-Worley read flat at a coarse mip, contrast x4; ours).
fn hzdLowField(xz: vec2<f32>, tile: f32, z: f32) -> f32 {
  let r = textureSampleLevel(procNoiseA, procRepeat, vec3(xz / tile, z), 2.0).r;
  return clamp((r - 0.5) * 4.0, -1.0, 1.0);
}
// The HZD low layer (H1-H7, + F1 types and storms). procSample (below) adds the F1 sheets and fractus.
fn hzdMainSample(p: vec3<f32>, t: f32, footprint: f32, full: bool, jitter: f32) -> ProcSample {
  var o: ProcSample;
  o.sigma = 0.0; o.coarse = 0.0; o.depth = 0.0; o.h = 0.0;
  let alt = procAltitude(p);
  if (alt <= P.hzLayer.x || alt >= P.hzLayer.y) { return o; }
  var n = ndfSample(p.xz);
  // H5 horizon ring (hzd15 s45): coverage toward the ring's target and type toward cumulus from ringStart to ringEnd; nothing beyond ringEnd.
  // The ring is HZD's ground-level far field: it fades out as the camera climbs from half the layer base to the base (ours), so a view from
  // inside or above the layer sees the field to its horizon.
  let ringOn = 1.0 - saturate((procAltitude(P.origin.xyz) - 0.5 * P.hzLayer.x) / max(0.5 * P.hzLayer.x, 1.0));
  if (P.hzRing.x > 0.0 && ringOn > 0.0) {
    let r = length(p.xz - P.origin.xz);
    if (r >= P.hzRing.y && ringOn >= 1.0) { return o; }
    let w = saturate((r - P.hzRing.x) / (P.hzRing.y - P.hzRing.x)) * ringOn;
    // The last 20 % of the band also takes the coverage to 0, so the clouds shrink away instead of ending on a line at ringEnd (ours).
    n.coverage = mix(n.coverage, P.hzRing.z, w) * (1.0 - ringOn * smoothstep(P.hzH6.y, 1.0, r / P.hzRing.y));
    n.topType = mix(n.topType, P.hzRing.w, w);
  }
  // F1: the column's bottom type (NDF + bias + a low-frequency variation), read by the table profile.
  var bt = n.bottomType + P.hzType2.x;
  if (P.hzType2.y != 0.0) { bt += P.hzType2.y * hzdLowField(p.xz, P.hzType2.z, 0.61); }
  hzdBt = saturate(bt);
  let span = P.hzLayer.y - P.hzLayer.x;
  let bottom = P.hzLayer.x + n.minHeight * span;
  var top = P.hzLayer.x + n.maxHeight * span;
  let cov0 = saturate(n.coverage + P.hzCov.x);
  if (cov0 <= 0.0) { return o; }
  // H6 height from coverage (hag p.13, ne22 p.20; constants ours): the column top falls toward the thin edges of each coverage patch, so tops
  // dome at the cloud scale instead of meeting one ceiling.
  if (P.hzProf.z > 0.0) { top = bottom + max(top - bottom, 1.0) * mix(1.0, saturate(cov0 / P.hzProf.w), P.hzProf.z); }
  if (alt <= bottom || alt >= top || top - bottom < 1.0) { return o; }
  let h = (alt - bottom) / (top - bottom);
  let cov = hzdAnvil(cov0, h, n);
  if (cov <= 0.0) { return o; }
  // H7 base lumps: the rise is read up to baseLump (h) higher where the shape's Worley fBM is high (below); the early-out takes the largest offset.
  let lumpMax = 2.0 * P.hzShelf.x;
  var gradient = hzdHeightGradientR(n.topType + P.hzCov.y, h, h + lumpMax);
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
  // H7 base lumps (santa D3 / frog F10 "lit chin lobes hanging below a flat base"; the flat stratus slab and base shelves of H6): the base
  // ramp is read baseLump x (G - 0.69) / 0.10 higher in the column (G = the 600 m Worley fBM, mean 0.69, std 0.10), clamped to 0..2 baseLump,
  // so each Worley lobe hangs its own rounded underside instead of one plane per body (ours; HZD has one base per gradient).
  if (P.hzShelf.x > 0.0) {
    gradient = hzdHeightGradientR(n.topType + P.hzCov.y, h, h + clamp(P.hzShelf.x * (A.g - 0.69) / 0.1, 0.0, lumpMax));
    if (gradient <= 0.0) { return o; }
  } else { gradient = hzdHeightGradient(n.topType + P.hzCov.y, h); }
  let pw = select(saturate(0.5 + (A.r - 0.5) * P.hzExtra.x), A.r, P.hzExtra.x == 1.0);   // H5 shapeContrast (1 = off)
  let base = hzdRemap(pw, -(1.0 - lowFbm), 1.0, 0.0, 1.0);
  let baseCloud = base * gradient;   // 3 height gradient (gp7 p.106: hzdRemap(pw, -(1.0 - lowFbm), 1.0, 0.0, 1.0) * gradient)

  // 4 Coverage: threshold 1 - coverage (HFW p.17), then the gp7 multiply; 5 base fade before erosion (stage 2 and up).
  var d = hzdRemap(baseCloud, 1.0 - cov, 1.0, 0.0, 1.0);
  // H6 veil: how far below the coverage threshold this sample is, in base x gradient units (0..1 over veilWidth), low in the column only.
  let veilOn = P.hzConn.z > 0.0 && P.hzConn.w > 0.0 && stage >= 2.5;
  let skirtOn = P.hzVeil.y > 0.5;
  var veil = 0.0;
  if (veilOn) {
    let far = 1.0 - smoothstep(0.5, 1.0, t / P.hzH6.w);
    if (!skirtOn) { veil = saturate(1.0 + (baseCloud - (1.0 - cov)) / P.hzConn.z) * saturate(1.0 - h / P.hzH6.x) * far; }
    else if (h < P.hzH6.x && far > 0.0) {
      // H7 skirt (n3 s162: a flat, wispy, horizontally spread skirt around each formation's base; hzd15 s26 "wispy shapes at the bottoms"):
      // H6's footprint (how far below the coverage threshold, in base x gradient units, over veilWidth) and the same footprint of the body
      // skirtTrail metres upwind, so the skirt trails downwind of each body instead of lying round it as a haze. It lives in a thin band of the
      // column that rises to full at skirtPeak and is gone at veilHeight (ours).
      var foot = saturate(1.0 + (baseCloud - (1.0 - cov)) / P.hzConn.z);
      if (P.hzVeil.z != 0.0) {
        let off = windDir * P.hzVeil.z;
        let AU = textureSampleLevel(procNoiseA, procRepeat, (qShape - off) / P.hzScale.x, shapeLod + 1.0);
        let baseU = hzdRemap(AU.r, -(1.0 - (AU.g * 0.625 + AU.b * 0.25 + AU.a * 0.125)), 1.0, 0.0, 1.0);
        let covU = saturate(ndfSample(p.xz - off.xz).coverage + P.hzCov.x);
        foot = max(foot, saturate(1.0 + (baseU * gradient - (1.0 - covU)) / (P.hzConn.z * P.hzSkirt2.y)));
      }
      let prof = smoothstep(0.0, P.hzSkirt.x, h) * (1.0 - smoothstep(P.hzSkirt.x, P.hzH6.x, h));
      veil = foot * prof * far;
    }
  }
  if (d <= 0.0 && veil <= 0.0) { return o; }
  let qDetail = q - scroll * P.hzSpeed.z;
  // H7: the skirt's wisps are stretched along the wind (skirtStretch : 1), streaks rather than blobs.
  var qVeil = qDetail;
  // The skirt's noise is read skirtScale x coarser than the detail (large, soft wisps instead of the 75 m cells: the cells read as foam).
  if (skirtOn) {
    let wd = vec3(P.hzWind.x, 0.0, P.hzWind.y);
    qVeil = (qDetail - wd * dot(qDetail, wd) * (1.0 - 1.0 / max(P.hzVeil.w, 1.0))) / max(P.hzSkirt2.x, 1e-3);
  }
  // H6: a veil-only sample (below the threshold) is streaked either by the detail fBM, read trilinear (veilNoise 'detail'), or by the shape
  // texture's finest Worley octave A.a (veilNoise 'shape', no extra read; softer, smudgier streaks).
  if (d <= 0.0) {
    let fadeV = select(1.0, hzdRemap(saturate(h / P.hzFade.y), 0.0, 1.0, P.hzFade.x, 1.0), stage >= 1.5);
    var w = A.a;
    if (P.hzVeil.x < 0.5) { w = hzdDetailFbm(qVeil, h, footprint, false); }
    if (skirtOn) { w = saturate((w - P.hzSkirt2.w) / (1.0 - P.hzSkirt2.w)); }   // H7: gaps in the skirt (true zeros: sky between wisps, and cheaper)
    let vd = P.hzConn.w * veil * pow(w, P.hzH6.z) * fadeV;
    if (vd <= 0.0) { return o; }
    o.sigma = vd * P.hzLayer.w; o.coarse = 0.0; o.h = h; o.depth = 0.0;
    return o;
  }
  var fadeK = 1.0;
  if (stage >= 1.5) { fadeK = hzdRemap(saturate(h / P.hzFade.y), 0.0, 1.0, P.hzFade.x, 1.0); }
  let covK = select(1.0, cov, stage >= 1.5 && P.hzCov.z > 0.5);
  d = max(d, 0.0) * covK * fadeK;
  let coarse = saturate(d);

  // 6 Detail (stage 3, full samples, within the detail distance; the fade is dithered so its end draws no line).
  var density = d;
  let fade = 1.0 - smoothstep(0.75, 1.25, t / max(P.hzFade.z, 1.0) + (jitter - 0.5) * 0.1);
  var veilW = A.a;
  if (full && stage >= 2.5 && fade > 0.0) {
    let hfFbm = hzdDetailFbm(qDetail, h, footprint, t < P.hzMisc.w);
    if (P.hzVeil.x < 0.5) { veilW = hfFbm; if (skirtOn && veil > 0.0) { veilW = hzdDetailFbm(qVeil, h, footprint, false); } }
    let hag = P.hzCov.w > 0.5;
    // gp7 p.108: wispy (fbm) below, billowy (1 - fbm) above; H6: the switch height is a setting (gp7 0.1 = h * 10; hag 0.2 = h * 5).
    let modifier = mix(hfFbm, 1.0 - hfFbm, saturate(h / select(P.hzExtra.z, 0.2, hag)));
    // H7: the erosion strength rises from P.hzSkirt.w at the base to erosionStrength at the wispy switch (wispy bottoms erode deeper; gp7 one value).
    let strength = select(mix(P.hzSkirt.w, P.hzExtra.y, saturate(h / P.hzExtra.z)), 0.35 * exp(-0.75 * cov), hag);
    // H7 lobe rung: the step between the body (shape noise, 0.6-1.2 km) and the detail grain (75 m cells) that the photos have and we lacked
    // (santa D1 / frog F1: ~3.5x per level; topics/surface-detail.md "a lobe field at ~70-250 m in the profile stage"). One billowy octave:
    // the detail texture's coarsest channel (inverted Worley, 4 cells per tile) read with its own tile (lobeTile; 4 cells = lobeTile / 4 m),
    // curl-displaced like the detail, its cell borders eroding the low-frequency noise so each body grows ~3.5x-smaller domes. It fades in from
    // the wispy switch to lobeFull (h): textured tops, smooth bellies (santa D2, frog F3). Constants ours.
    var lobe = 0.0;
    if (P.hzLobe.y > 0.0) {
      let lcurl = textureSampleLevel(procAux, procRepeat, qDetail.xz / P.hzScale.z, 0.0).xy;
      let ql = (qDetail + vec3(lcurl.x, 0.0, lcurl.y) * P.hzScale.w) / P.hzLobe.x;
      let lodL = hzdLod(footprint, P.hzLobe.x, 32.0);
      var L: f32;
      if (lodL <= 0.0 && t < P.hzMisc.w && P.hzLobe.w > 0.5) { L = hzdCubic3(procNoiseB, ql).r; }
      else { L = textureSampleLevel(procNoiseB, procRepeat, ql, lodL).r; }
      // Scaled by sat(coverage / lobeCoverage)^2: small, thin-coverage clouds keep one lobe level instead of shattering into pellets
      // (world-anchored lobes: a small body shows fewer of them, frog F1).
      let lc = saturate(cov / max(P.hzShelf.w, 1e-3));
      lobe = (1.0 - L) * P.hzLobe.y * smoothstep(P.hzExtra.z, max(P.hzLobe.z, P.hzExtra.z + 1e-3), h) * fade * lc * lc;
    }
    if (P.hzExtra.w > 0.5) {
      // H6 'hfw' order (HFW p.15-17): erode the low-frequency noise, then apply the profile and the coverage remap.
      let be = hzdRemap(base, modifier * strength * fade + lobe, 1.0, 0.0, 1.0);
      density = max(hzdRemap(be * gradient, 1.0 - cov, 1.0, 0.0, 1.0), 0.0) * covK * fadeK;
    } else {
      density = hzdRemap(d, modifier * strength * fade + lobe, 1.0, 0.0, 1.0);
    }
    // H7 wispy bottoms: below the wispy switch, a second erosion in gp7's order (p.109: after the coverage remap, on the density itself), so it
    // bites the thin ramp at the base and frays it into curl-distorted wisps, while the 'hfw' order above keeps the flanks and tops intact.
    // P.hzSkirt2.z = its strength at h = 0 (0 = off), falling to 0 at the switch height (ours; gp7 has one order everywhere).
    if (P.hzSkirt2.z > 0.0) {
      let lowB = 1.0 - saturate(h / select(P.hzExtra.z, 0.2, hag));
      density = hzdRemap(max(density, 0.0), modifier * P.hzSkirt2.z * lowB * fade, 1.0, 0.0, 1.0);
    }
  }
  density = saturate(density);
  // H6 density from coverage (gp7 p.107's "small clouds lighter" at hag eq 16's DA position: after the erosion, so it cannot eat them).
  if (P.hzConn.x > 0.0) { density *= pow(saturate(cov / P.hzConn.y), P.hzConn.x); }
  // H6 veil: a thin low skirt continuing each body below the threshold, streaked by the detail fBM or A.a (n3 s162's connective skirt; ours).
  if (veilOn) {
    if (skirtOn) { veilW = saturate((veilW - P.hzSkirt2.w) / (1.0 - P.hzSkirt2.w)); }
    density = max(density, P.hzConn.w * veil * pow(veilW, P.hzH6.z) * fadeK);
  }
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
fn procSample(p: vec3<f32>, t: f32, footprint: f32, full: bool, jitter: f32) -> ProcSample {
  var o = hzdMainSample(p, t, footprint, full, jitter);
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
