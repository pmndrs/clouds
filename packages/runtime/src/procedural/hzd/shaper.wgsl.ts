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
 *   anvil (F1, S7): N17's coverage exponent (`hzdAnvil`), hag eq 17-18's top flattening and density fix, and a placed storm cell.
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
import { PROFILE_TABLE_FLOOR, PROFILE_TABLE_SIZE, profilePeaks, profileTablesSmoothed, sampleProfileTable } from '../../generate/profile-tables';

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
@group(${group}) @binding(${base + o.lut}) var<storage, read> procLut: array<u32, ${HZD_LUT_BUFFER_WORDS}>;
`;
}

/** F2 step 1: the profile tables for a read-only storage buffer, one u32 per texel holding the texel's whole bilinear quad (the bytes of
 *  (x, y), (x + 1, y), (x, y + 1), (x + 1, y + 1), low byte first; clamped at the last row and column), so a filtered lookup is one load
 *  and an unpack4x8unorm. Tables t = 0 top, 1 bottom, 2 peaks (generate/profile-tables.ts, as P.hzLut), 64 x 64 each: 12288 words. */
export const HZD_LUT_WORDS = 3 * PROFILE_TABLE_SIZE * PROFILE_TABLE_SIZE;
/** PF1: the weather map's bounds grid lives in the same buffer, after the tables: HZD_BOUNDS_GRID^2 words, one per cell of the NDF tile, bytes
 *  (max coverage, min base height, max top height, 0), each 0..255 over 0..1; written by hzd/bounds.ts, read by the trace to skip empty cells. */
export const HZD_BOUNDS_GRID = 64;
export const HZD_BOUNDS_WORDS = HZD_BOUNDS_GRID * HZD_BOUNDS_GRID;
export const HZD_LUT_BUFFER_WORDS = HZD_LUT_WORDS + HZD_BOUNDS_WORDS;
/** A bounds word that never skips (max coverage 1, heights 0..1): what a cell holds before the bounds pass has run. */
export const HZD_BOUNDS_OPEN = 0x00FF00FF;
let lutQuads: Uint32Array<ArrayBuffer> | null = null;
export function packHzdLutQuads(): Uint32Array<ArrayBuffer> {
  if (!lutQuads) {
    const N = PROFILE_TABLE_SIZE;
    const { top, bottom } = profileTablesSmoothed();
    const tables = [top, bottom, profilePeaks()];
    lutQuads = new Uint32Array(HZD_LUT_WORDS);
    for (let t = 0; t < 3; t++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const T = tables[t], x1 = Math.min(x + 1, N - 1), y1 = Math.min(y + 1, N - 1);
      lutQuads[t * N * N + y * N + x] = (T[y * N + x] | (T[y * N + x1] << 8) | (T[y1 * N + x] << 16) | (T[y1 * N + x1] << 24)) >>> 0;
    }
  }
  return lutQuads;
}
/** F2 step 1: the storage buffer of packHzdLutQuads, bound by the HZD shaper at PROC_BINDING_OFFSETS.lut. (A sampled texture would put the
 *  trace over the 16 sampled textures per shader stage of the default limits.) */
export function createHzdLutBuffer(device: GPUDevice): GPUBuffer {
  const words = packHzdLutQuads();
  const buf = device.createBuffer({ label: 'hzd profile tables + bounds', size: HZD_LUT_BUFFER_WORDS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
  const all = new Uint32Array(HZD_LUT_BUFFER_WORDS);
  all.set(words, 0); all.fill(HZD_BOUNDS_OPEN, HZD_LUT_WORDS);
  device.queue.writeBuffer(buf, 0, all);
  return buf;
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
// F2 step 1: P.hzType.x 2 reads the procLut storage buffer, whose word per texel holds its whole bilinear quad (packHzdLutQuads): one load
// and an unpack instead of four reads; 1 keeps F1's read of P.hzLut (3 bytes per float in the uniform). The same bytes and the same filter,
// so the two agree exactly.
fn hzdLut(t: u32, type_: f32, v: f32) -> f32 {
  let x = saturate(type_) * 63.0;
  let y = clamp(v * 64.0 - 0.5, 0.0, 63.0);
  let x0 = min(u32(x), 62u);
  let y0 = min(u32(y), 62u);
  let fx = x - f32(x0);
  if (P.hzType.x > 1.5) {
    let c = unpack4x8unorm(procLut[t * 4096u + y0 * 64u + x0]);
    return mix(mix(c.x, c.y, fx), mix(c.z, c.w, fx), y - f32(y0));
  }
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
// F1 S7: the cumulonimbus gradient (hzd15 s34 = gp7 Fig 4.10's third panel, measured: full 0.08, to 0.74, zero 0.96), or the tallest table type.
const HZD_CUMULONIMBUS = vec4(0.01, 0.08, 0.74, 0.96);
fn hzdStormGradient(h: f32, hr: f32) -> f32 {
  if (P.hzType.x > 0.5) { return hzdTableProfile(1.0, h, hr); }
  let s = HZD_CUMULONIMBUS;
  return hzdRamp((hr - s.x) / (s.y - s.x)) * hzdRamp((s.w - h) / (s.w - s.z));
}
// F1 S7: how much of the anvil terms act on this column (the storm weight, or everywhere when N17's anvil bias is set).
fn hzdAnvilAmount() -> f32 { return max(hzdStormW, sign(P.hzAnvil.x)); }
// H7: hr is the height the rise (base) ramps are read at (h + the base-lump offset); the falls read h.
// F1: the type gradient, mixed toward the cumulonimbus one by the storm weight, then hag eq 17's anvil flattening:
// gradient ^ sat(remap(h, 0.65, 0.95, 1, 1 - flatten)) lifts the top ramp into a plate (0 stays 0).
fn hzdHeightGradientR(cloudType: f32, h: f32, hr: f32) -> f32 {
  var g = hzdTypeGradient(cloudType, h, hr);
  if (hzdStormW > 0.0) { g = mix(g, hzdStormGradient(h, hr), hzdStormW); }
  let fl = P.hzAnvil.z * hzdAnvilAmount();
  if (fl > 0.0 && g > 0.0) { g = pow(g, max(saturate(hzdRemap(h, 0.65, 0.95, 1.0, 1.0 - fl)), 0.05)); }
  return g;
}
fn hzdTypeGradient(cloudType: f32, h: f32, hr: f32) -> f32 {
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
// F1 S7 (n17 p.46-50): coverage = pow(coverage, remap(h, 0.7, 0.8, 1, lerp(1, 0.5, anvil_bias))), the remap unclamped as printed (the exponent
// passes 0 at h 0.9: everything above fills) or clamped to [lerp(1, 0.5, bias), 1] (P.hzAnvil.y: only the top inflates). The bias is N17's
// weather-state scalar P.hzAnvil.x, raised to 1 inside a storm.
fn hzdAnvil(coverage: f32, h: f32, n: NdfSample) -> f32 {
  let bias = max(P.hzAnvil.x, hzdStormW);
  if (bias <= 0.0 || coverage <= 0.0) { return coverage; }
  let lo = mix(1.0, 0.5, bias);
  var e = hzdRemap(h, 0.7, 0.8, 1.0, lo);
  if (P.hzAnvil.y > 0.5) { e = clamp(e, lo, 1.0); }
  return saturate(pow(coverage, max(e, 0.0)));
}
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

// N1 (n3 s89-109): the pack's Nubis Cubed noise (the runtime's up-rez noise, cloudNoise of volumeWgsl(0), bound in every pass that compiles
// the procedural model): R/G LF/HF Curly-Alligator (wispy), B/A LF/HF Alligator (billowy), one tile per P.hzN3.y metres, read at the
// footprint's mip. Returns the deck's noise composite (density.wgsl.ts cloudDensityShaped): wispy = lerp(R, G, P), billowy =
// lerp(0.3 B, 0.3 A, P^0.25), lerp(wispy, billowy, T), and the twice-folded HHF octave blended in near the camera (s103-104, s109).
fn hzdN3Noise(q0: vec3<f32>, h: f32, footprint: f32, t: f32, prof: f32, T: f32) -> f32 {
  var q = q0;
  if (P.hzN3b.z != 0.0) {
    let curl = textureSampleLevel(procAux, procRepeat, q0.xz / P.hzScale.z, 0.0).xyz;
    q += vec3(curl.x, 0.0, curl.y) * (P.hzScale.w * (1.0 - h) * P.hzN3b.z);
  }
  let n = textureSampleLevel(cloudNoise, repeatSampler, q / P.hzN3.y, hzdLod(footprint, P.hzN3.y, 128.0));
  let wispy = mix(n.r, n.g, prof);
  let billowy = mix(n.b * 0.3, n.a * 0.3, sqrt(sqrt(prof)));
  var c = mix(wispy, billowy, T);
  if (P.hzN3b.x > 0.0 && t < P.hzN3b.x) {
    let tg = abs(abs(n.g * 2.0 - 1.0) * 2.0 - 1.0);
    let ta = abs(abs(n.a * 2.0 - 1.0) * 2.0 - 1.0);
    let tg2 = tg * tg;
    let hhf = saturate(mix(1.0 - tg2 * tg2, ta * ta, T));
    let e = P.hzN3b.x;
    c = mix(hhf, c, hzdRemap(clamp(t, e / 3.0, e), e / 3.0, e, 0.9, 1.0));
  }
  return c;
}
// N1: the detail type T (0 wispy, 1 billowy) of an HZD column (ours): wispy below the wispy switch height, stratus partly wispy throughout.
fn hzdN3Type(cloudType: f32, h: f32) -> f32 {
  return saturate(h / P.hzExtra.z) * mix(P.hzN3.w, 1.0, saturate(2.0 * cloudType));
}
// N1: ValueErosion (the pack's definition, s107): sat((P - n) / (1 - n)).
fn hzdValueErosion(prof: f32, n: f32) -> f32 { return saturate((prof - n) / max(1.0 - n, 1e-4)); }
// P2.5a edge character (the owner's photos): the crispness c of the edge at a sample, 0 soft .. 1 crisp. Higher on the body is crisper (top);
// the side the body moves into (coverage falling downwind of the sample) is crisp, the trailing side soft (lead; P.hzEdge2.x = +1, -1 flips,
// 0 = height only). Bases stay soft whatever the direction (top gates it). Ours.
fn hzdEdgeCrisp(xz: vec2<f32>, h: f32) -> f32 {
  let top = smoothstep(P.hzEdge.y, P.hzEdge.z, h);
  let w = vec2(P.hzWind.x, P.hzWind.y) * P.hzEdge.w;
  let dCov = ndfSample(xz - w).coverage - ndfSample(xz + w).coverage;
  let lead = saturate(0.5 + P.hzEdge2.x * dCov / P.hzEdge2.y);
  return saturate(top * mix(1.0, lead * 2.0, abs(P.hzEdge2.x)));
}
// P2.5b: the edge's hardness by c: lerp(soft, hard, c); soft = d ^ softPow (thinned, translucent), hard = sat((d - cut) / (1 - cut) x gain)
// (the thin outer haze cut and the ramp steepened: an opaque edge). gain 0 = the P2.5a shaping d ^ lerp(softPow, crispPow, c) (it lifted the
// thin ramp into a halo on the tops). Ours.
fn hzdEdgeShape(d: f32, c: f32) -> f32 {
  let x = saturate(d);
  if (P.hzEdge3.w <= 0.0) { return pow(x, mix(P.hzEdge3.x, P.hzEdge3.y, c)); }
  let hard = saturate((x - P.hzEdge3.z) / (1.0 - P.hzEdge3.z) * P.hzEdge3.w);
  return mix(pow(x, P.hzEdge3.x), hard, c);
}
// H7 lobe rung's noise (see the 'hzd' detail branch): 1 - the inverted-Worley channel read at lobeTile, curl-displaced like the detail.
fn hzdLobeNoise(qDetail: vec3<f32>, footprint: f32, t: f32) -> f32 {
  let lcurl = textureSampleLevel(procAux, procRepeat, qDetail.xz / P.hzScale.z, 0.0).xy;
  let ql = (qDetail + vec3(lcurl.x, 0.0, lcurl.y) * P.hzScale.w) / P.hzLobe.x;
  let lodL = hzdLod(footprint, P.hzLobe.x, 32.0);
  var L: f32;
  if (lodL <= 0.0 && t < P.hzMisc.w && P.hzLobe.w > 0.5) { L = hzdCubic3(procNoiseB, ql).r; }
  else { L = textureSampleLevel(procNoiseB, procRepeat, ql, lodL).r; }
  return 1.0 - L;
}

// F1: a world-anchored low-frequency field in -1..1 (the shape texture's Perlin-Worley read flat at a coarse mip, contrast x4; ours).
fn hzdLowField(xz: vec2<f32>, tile: f32, z: f32) -> f32 {
  let r = textureSampleLevel(procNoiseA, procRepeat, vec3(xz / tile, z), 2.0).r;
  return clamp((r - 0.5) * 4.0, -1.0, 1.0);
}
// STORM1: the storm area at a world column, 0..1 (times the strength gain): the NDF's storm channel (stormSource 'map'), or F1's placed cell as a soft disc.
fn hzdStormMask(xz: vec2<f32>) -> f32 {
  if (P.hzStorm3.x > 0.5) { return ndfStorm(xz); }
  return 1.0 - smoothstep(0.2 * P.hzStorm.z, 1.3 * P.hzStorm.z, length(xz - P.hzStorm.xy));
}
// STORM1/ST2: the anvil's footprint over a column: the storm area seen from upwind, as a blurred dilation. The mean of the storm channel over an
// elliptical kernel (a Vogel disc of 16 taps) whose centre sits downwind of the column and whose size grows with k (0..1, the height ramp): a storm blob
// grows a smooth teardrop plate that spreads downwind (anvilShear) and sideways (anvilSpread x the blob radius), wider at its downwind end. A mean, not a
// union of a few taps: the taps average into one smooth field (no lobes), so the plate edge is a soft ramp. reach stretches the kernel downwind (the cirrus).
// ST2: replaces the 8-tap soft union (lumpy, angular); the old one is kept below as hzdAnvilFootprintTaps.
fn hzdAnvilBlur(xz: vec2<f32>, k: f32, reach: f32) -> f32 {
  let w = normalize(vec2(P.hzWind.x, P.hzWind.y) + vec2(1e-6, 0.0));
  let side = vec2(-w.y, w.x);
  let R = P.hzStorm.z;
  let sh = P.hzStorm2.z * k + reach;
  let lat = (P.hzStorm2.y - 1.0) * R * 1.8 * k * (1.0 + reach / max(P.hzStorm2.z, 1.0) * 0.5);
  let cA = sh * 0.65;
  let A = sh * 0.45 + 1.25 * R * k;
  // Three rings (6, 12, 18 taps) and the centre (37 taps; 19 taps with two rings show the separate lobes of the taps, 49 the same outline as 37): even coverage of the kernel including its rim, so the dilated outline is
  // not scalloped by a few widely spaced taps (a Vogel disc put 7 km between rim taps).
  var acc = hzdStormMask(xz - w * cA);
  for (var ring = 0; ring < 3; ring++) {
    let n = 6 + 6 * ring;
    let rr = 0.35 + 0.325 * f32(ring);
    let ph = 0.5 * f32(ring);
    for (var i = 0; i < n; i++) {
      let th = (f32(i) + ph) * 6.2831853 / f32(n);
      let dx = rr * cos(th);
      let dy = rr * sin(th);
      let lw = mix(0.5, 1.0, 0.5 + 0.5 * dx);
      acc += hzdStormMask(xz - w * (cA + A * dx) - side * (lat * lw * dy));
    }
  }
  // The mean is the overlap of the storm area with the kernel; scaled so a storm that fills a nominal share of the kernel reads 1 (a flat plate
  // interior) and the rim is the ramp where the overlap falls off.
  let ratio = max(A * (0.75 * lat + 0.5 * R * k) / (0.55 * R * R), 1.0);
  return acc / 37.0 * ratio;
}
// STORM1: the first anvil footprint (kept, ST2): the storm area seen from upwind as a soft union of 8 taps shifted downwind and sideways.
fn hzdAnvilFootprintTaps(xz: vec2<f32>, shear: f32) -> f32 {
  let w = normalize(vec2(P.hzWind.x, P.hzWind.y) + vec2(1e-6, 0.0));
  let side = vec2(-w.y, w.x);
  let sh = P.hzStorm2.z * shear;
  let lat = (P.hzStorm2.y - 1.0) * P.hzStorm.z * 0.8;
  var keep = 1.0 - hzdStormMask(xz - w * (sh * 0.3));
  keep *= 1.0 - hzdStormMask(xz - w * (sh * 0.65));
  keep *= 1.0 - hzdStormMask(xz - w * sh);
  keep *= 1.0 - hzdStormMask(xz - w * (sh * 0.6) + side * (lat * 0.5));
  keep *= 1.0 - hzdStormMask(xz - w * (sh * 0.6) - side * (lat * 0.5));
  keep *= 1.0 - 0.95 * hzdStormMask(xz - w * (sh * 0.7) + side * lat);
  keep *= 1.0 - 0.95 * hzdStormMask(xz - w * (sh * 0.7) - side * lat);
  keep *= 1.0 - 0.9 * hzdStormMask(xz - w * (sh * 1.3));
  return 1.0 - keep;
}
// ST2: the footprint the shaper uses: the blurred dilation (stormAnvilShape 'smooth') or the first taps ('taps'), normalised to about 0..1.
fn hzdAnvilFootprint(xz: vec2<f32>, k: f32) -> f32 {
  if (P.hzStorm5.z > 0.5) { return hzdAnvilFootprintTaps(xz, k); }
  return saturate(hzdAnvilBlur(xz, k, 0.0));
}
// STORM1 anvil cirrus (NE22 p.159-163): a thin fibrous plate on top of the anvil that carries the storm's footprint anvilCirrusLength m further downwind.
// A = the slab: it spans [top - 0.35 depth, top + 0.65 depth], top = the storm top. The fibres are the Perlin-Worley read stretched along the wind.
// ST2 (stormAnvilShape 'smooth'): the gate is the blurred dilation (one smooth sheet), the noise is lower frequency (sheets about a kilometre across, a
// few long) with a fine fibre octave at low weight, and it modulates the density softly (no hard threshold) so it reads as fibrous sheets, not torn streaks.
fn hzdAnvilCirrus(p: vec3<f32>, t: f32, footprint: f32) -> ProcSample {
  var o: ProcSample;
  o.sigma = 0.0; o.coarse = 0.0; o.depth = 0.0; o.h = 0.0;
  let depth = P.hzStorm3.w;
  let alt = procAltitude(p);
  let hc = (alt - (P.hzStorm2.x - 0.35 * depth)) / depth;
  if (hc <= 0.0 || hc >= 1.0) { return o; }
  let w = normalize(vec2(P.hzWind.x, P.hzWind.y) + vec2(1e-6, 0.0));
  let side = vec2(-w.y, w.x);
  let sh = P.hzStorm2.z;
  let L = P.hzStorm3.z;
  let lat = (P.hzStorm2.y - 1.0) * P.hzStorm.z * 0.8;
  var g = 0.0;
  let soft = P.hzStorm5.z < 0.5;
  if (soft) {
    g = smoothstep(0.05, 0.9, hzdAnvilBlur(p.xz, 1.0, L * 0.45));
  } else {
    g = hzdStormMask(p.xz - w * (sh * 0.6));
    g = max(g, 0.9 * hzdStormMask(p.xz - w * (sh + L * 0.33)));
    g = max(g, 0.75 * hzdStormMask(p.xz - w * (sh + L * 0.66) + side * lat * 0.5));
    g = max(g, 0.75 * hzdStormMask(p.xz - w * (sh + L * 0.66) - side * lat * 0.5));
    g = max(g, 0.55 * hzdStormMask(p.xz - w * (sh + L)));
  }
  g *= saturate(P.hzStorm.w);
  if (g <= 0.02) { return o; }
  let xz = p.xz - P.drift.xz * P.hzSpeed.y;
  let T = select(700.0, 3600.0, soft);
  let uv = vec2(dot(xz, w) / P.hzStorm5.x, dot(xz, side));
  let lod = hzdLod(footprint, T, 128.0);
  let N = textureSampleLevel(procNoiseA, procRepeat, vec3(uv / T, 0.17 + alt / (4.0 * T)), lod);
  let N2 = textureSampleLevel(procNoiseA, procRepeat, vec3(uv / (T * 0.3), 0.61 + alt / (4.0 * T)), max(lod - 1.0, 0.0));
  var d = 0.0;
  let vert = smoothstep(0.0, 0.3, hc) * smoothstep(1.0, 0.45, hc);
  if (soft) {
    let n = saturate(N.r * 0.75 + N2.g * 0.25);
    // A continuous sheet (the gate, softly) with the fibres as a modulation of it (30..100 %), not a threshold that tears it into patches.
    d = smoothstep(0.0, 0.6, g) * mix(0.3, 1.0, smoothstep(0.3, 0.8, n)) * vert;
  } else {
    let n = saturate(0.5 + (N.r - 0.5) * 1.7) * mix(0.55, 1.0, N2.g);
    d = saturate(hzdRemap(n * vert, 1.0 - g, 1.0, 0.0, 1.0));
  }
  if (d <= 0.0) { return o; }
  o.sigma = d * P.hzStorm3.y; o.coarse = d; o.h = hc; o.depth = d * depth * 0.25;
  return o;
}
// ST2 rotation (NE22 p.147-158 / hfw p.59-62): the detail noise lookup rotates about the storm centre in nested rings, each its own speed (falling
// outward: the vortex turns faster in the middle), with a per-ring skew (a twist so the outer rings seem to drag against the inner ones) and a
// blended overlap between neighbouring rings (the detail is read at both rotations and lerped). Six rings out to 1.6 x the storm radius, then a static
// seventh (the rest of the sky). P.hzStorm5.w = the inner ring's phase in radians (time x stormRotation, set per frame by the runtime; 0 = off).
// Returns the rotation offsets (x, z) of ring A and ring B; hzdSwirlW = the weight of ring B (0 outside the overlap bands).
var<private> hzdSwirlW: f32 = 0.0;
fn hzdSwirlRot(d: vec2<f32>, ang: f32) -> vec2<f32> {
  let c = cos(ang);
  let s = sin(ang);
  return vec2(d.x * c - d.y * s, d.x * s + d.y * c) - d;
}
fn hzdSwirl(xz: vec2<f32>, amount: f32) -> vec4<f32> {
  hzdSwirlW = 0.0;
  let cen = P.hzStorm.xy + ndfOffset();
  let d = xz - cen;
  let f = length(d) / (1.6 * P.hzStorm.z / 6.0);
  if (f >= 6.0) { return vec4(0.0); }
  let i = floor(f);
  let wB = smoothstep(0.78, 1.0, f - i);
  let angA = P.hzStorm5.w * pow(0.6, i) + 0.12 * i;
  let angB = select(P.hzStorm5.w * pow(0.6, i + 1.0) + 0.12 * (i + 1.0), 0.0, i + 1.0 >= 6.0);
  hzdSwirlW = wB;
  return vec4(hzdSwirlRot(d, angA), hzdSwirlRot(d, angB)) * amount;
}
// STORM1 internal lightning: a flash envelope (a quick decay with a flicker) and its place, a random point inside the storm around the storm centre,
// for flash number floor(time x rate). rate 0 holds one flash on. The trace adds glow (the storm weight x stormGlow) x this to the radiance.
fn hzdHash3(x: f32) -> vec3<f32> {
  var q = fract(vec3(x * 0.1031, x * 0.1030, x * 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xxy + q.yzz) * q.zyx);
}
fn procFlash(p: vec3<f32>, time: f32) -> f32 {
  let rate = P.hzStorm4.w;
  var e = 1.0;
  var k = 0.0;
  if (rate > 0.0) {
    let x = time * rate;
    k = floor(x);
    let age = fract(x) / rate;
    e = exp(-age * 12.0) * (0.65 + 0.35 * cos(age * 70.0));
  }
  if (e < 0.01) { return 0.0; }
  let r = hzdHash3(k + 11.0);
  let c = vec3(P.hzStorm.x + (r.x - 0.5) * 0.9 * P.hzStorm.z, 0.0, P.hzStorm.y + (r.y - 0.5) * 0.9 * P.hzStorm.z);
  let y = mix(P.hzLayer.x, P.hzStorm2.x, 0.15 + 0.35 * r.z);
  let d = length(vec3(p.x - c.x, procAltitude(p) - y, p.z - c.z));
  let g = saturate(1.0 - d / 1500.0);
  return e * g * g;
}
// The HZD low layer (H1-H7, + F1 types and storms). procSample (below) adds the F1 sheets and fractus.
fn hzdMainSample(p: vec3<f32>, t: f32, footprint: f32, full: bool, jitter: f32) -> ProcSample {
  var o: ProcSample;
  o.sigma = 0.0; o.coarse = 0.0; o.depth = 0.0; o.h = 0.0;
  let alt = procAltitude(p);
  // F1 S7: a storm column reaches above the layer, to the storm top.
  let stormOn = P.hzStorm.w > 0.0 || P.hzStorm2.w < 1.0;
  hzdStormW = 0.0;
  if (alt <= P.hzLayer.x || alt >= select(P.hzLayer.y, max(P.hzLayer.y, P.hzStorm2.x), stormOn)) { return o; }
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
  let covN = saturate(n.coverage + P.hzCov.x);
  var cov0 = covN;
  // F1 S7 storms. The placed cell: an envelope (its whole reach, anvil included) where the column is a storm (cumulonimbus gradient, top at the
  // storm top, coverage from the cell); inside it the cell's coverage is 0.85 over the core radius, and above h 0.7..0.8 (n17's anvil band) its
  // radius grows to anvilSpread x and its centre shears anvilShear m downwind from h 0.6 to the top (photos §4). Type-driven storms: NDF top
  // types above stormTypeStart ramp to a storm at type 1 (their coverage stays the NDF's; N17's exponent and hag's flattening make the anvil).
  var se = 0.0;
  var stormCov = 0.0;
  if (stormOn) {
    let wind2 = vec2(P.hzWind.x, P.hzWind.y);
    let R = P.hzStorm.z;
    if (P.hzStorm.w > 0.0 && P.hzStorm3.x > 0.5) {
      // STORM1 map source: the column is a storm where the NDF's storm area is. It narrows upward (the core is thresholded higher with height: a
      // cone), then in the anvil band (n17's 0.7-0.8) the footprint is the storm area seen from upwind (hzdAnvilFootprint), so the plate spreads
      // downwind and sideways of the column.
      let hs = saturate((alt - bottom) / max(P.hzStorm2.x - bottom, 1.0));
      var core = n.storm;
      var fp = 0.0;
      let blurFp = P.hzStorm5.z < 0.5;
      var a = smoothstep(0.7, 0.76, hs);
      if (hs > select(0.6, 0.77, blurFp) && P.hzStorm2.y > 1.0) {
        fp = hzdAnvilFootprint(p.xz, smoothstep(0.6, select(1.0, 0.8, blurFp), hs));
        // ST2: the plate is a lens: its underside rises toward the footprint's edge (an overhanging, thinning rim) instead of ending in a vertical wall.
        if (blurFp) { let hb = mix(0.87, 0.78, smoothstep(0.02, 0.45, fp)); a = smoothstep(hb, hb + 0.08, hs); }
      }
      if (core > 0.0 || fp > 0.0) {
        // A wide fall-off (as the placed cell's) so the shape noise, not the radius, draws the cauliflower wall; the threshold rises with height.
        let thr = mix(0.04, 0.5, smoothstep(0.0, 0.7, hs));
        let c = smoothstep(thr, thr + 0.6, core);
        let m = mix(c, max(c, select(smoothstep(0.1, 0.75, fp), smoothstep(0.02, 1.0, fp), blurFp)), a);
        stormCov = 0.75 * m;
        se = saturate(P.hzStorm.w) * smoothstep(0.0, 0.2, stormCov);
        cov0 = mix(cov0, stormCov, se);
      }
    } else if (P.hzStorm.w > 0.0) {
      let reach = 1.25 * R * max(0.85 * P.hzStorm2.y, 1.15) + 0.5 * abs(P.hzStorm2.z);
      let rEnv = length(p.xz - P.hzStorm.xy - wind2 * (0.5 * P.hzStorm2.z));
      let sp = saturate(P.hzStorm.w) * (1.0 - smoothstep(0.9 * reach, 1.15 * reach, rEnv));
      if (sp > 0.0) {
        let hs = saturate((alt - bottom) / max(P.hzStorm2.x - bottom, 1.0));
        let a = smoothstep(0.7, 0.76, hs);
        // The column narrows upward (a cone, photos §3-4: widest low), then the anvil band widens it. The anvil spreads downwind: upwind of
        // the sheared centre its radius is a third (ours).
        let Rh = R * mix(1.15, 0.85, smoothstep(0.0, 0.7, hs)) * mix(1.0, P.hzStorm2.y, a);
        let dv = p.xz - P.hzStorm.xy - wind2 * (P.hzStorm2.z * smoothstep(0.6, 1.0, hs));
        let along = dot(dv, wind2);
        let r = length(dv + wind2 * (along * (mix(1.0, 3.0, a) - 1.0) * step(along, 0.0)));
        // A wide fall-off so the shape noise, not the radius, draws the cauliflower wall.
        stormCov = 0.75 * (1.0 - smoothstep(0.0, 1.25 * Rh, r));
        // The column is a storm where the cell has coverage at this height; elsewhere in the envelope (under the anvil, around the core) the
        // NDF's own clouds stay, with their own tops.
        se = sp * smoothstep(0.0, 0.2, stormCov);
        cov0 = mix(cov0, stormCov, se);
      }
    }
    if (P.hzStorm2.w < 1.0) {
      let st = smoothstep(P.hzStorm2.w, 1.0, n.topType + P.hzCov.y);
      se = max(se, st);
    }
  }
  if (cov0 <= 0.0) { return o; }
  // H6 height from coverage (hag p.13, ne22 p.20; constants ours): the column top falls toward the thin edges of each coverage patch, so tops
  // dome at the cloud scale instead of meeting one ceiling.
  if (P.hzProf.z > 0.0) { top = bottom + max(top - bottom, 1.0) * mix(1.0, saturate(covN / P.hzProf.w), P.hzProf.z); }
  if (se > 0.0) { top = mix(top, P.hzStorm2.x, se); hzdStormW = se; }
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
  var lowFbm = A.g * 0.625 + A.b * 0.25 + A.a * 0.125;
  // N1 step 2 (shapeNoise 'nubis3'): the dilation from the pack's billows, 1 - (0.625 B + 0.375 A), mapped onto the Worley fBM's mean and
  // spread (pack 0.608 / 0.157 -> 0.69 / 0.10), read with its own tile (P.hzN3b.w m), tricubic where the shape read is.
  if (P.hzN3b.w > 0.0) {
    let uS = qShape / P.hzN3b.w;
    var S: vec4<f32>;
    if (cubic) { S = hzdCubic3(cloudNoise, uS); } else { S = textureSampleLevel(cloudNoise, repeatSampler, uS, hzdLod(footprint, P.hzN3b.w, 128.0)); }
    lowFbm = 0.69 + (0.392 - (0.625 * S.b + 0.375 * S.a)) * (0.10 / 0.157);
  }
  // H7 base lumps (santa D3 / frog F10 "lit chin lobes hanging below a flat base"; the flat stratus slab and base shelves of H6): the base
  // ramp is read baseLump x (G - 0.69) / 0.10 higher in the column (G = the 600 m Worley fBM, mean 0.69, std 0.10), clamped to 0..2 baseLump,
  // so each Worley lobe hangs its own rounded underside instead of one plane per body (ours; HZD has one base per gradient).
  if (P.hzShelf.x > 0.0) {
    gradient = hzdHeightGradientR(n.topType + P.hzCov.y, h, h + clamp(P.hzShelf.x * (A.g - 0.69) / 0.1, 0.0, lumpMax));
    if (gradient <= 0.0) { return o; }
  }   // F1: with no base lumps the early-out's gradient (read at h + 0) is the gradient: no second evaluation (the tables cost 3 bilinear reads).
  let pw = select(saturate(0.5 + (A.r - 0.5) * P.hzExtra.x), A.r, P.hzExtra.x == 1.0);   // H5 shapeContrast (1 = off)
  var base = hzdRemap(pw, -(1.0 - lowFbm), 1.0, 0.0, 1.0);
  // F1 S7: the anvil plate follows the cell's footprint more than the shape noise (a smooth, flat-bottomed plate; its edge frays by the
  // detail erosion, wispy there), ours.
  if (hzdStormW > 0.0) { base = mix(base, 0.75, select(0.6, 0.9, P.hzStorm5.z < 0.5 && P.hzStorm3.x > 0.5) * hzdStormW * smoothstep(0.7, 0.78, h)); }
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
  var qDetail = q - scroll * P.hzSpeed.z;
  // ST2 rotation: ring A's rotation moves the detail lookup; qDetailB (ring B, blended by swirlW in the overlap bands) is read as well there.
  var qDetailB = qDetail;
  var swirlW = 0.0;
  if (P.hzStorm5.w > 0.0 && hzdStormW > 0.0) {
    let sw = hzdSwirl(p.xz, hzdStormW);
    qDetailB = qDetail + vec3(sw.z, 0.0, sw.w);
    qDetail += vec3(sw.x, 0.0, sw.y);
    swirlW = hzdSwirlW;
  }
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
  let n3 = P.hzN3.x > 0.5;
  // P2.5a edge character: the crispness c steers the detail stage (noise kind, erosion strength, edge exponent); off = the old image.
  let edgeOn = P.hzEdge.x > 0.5 && full && stage >= 2.5 && fade > 0.0;
  var crisp = 0.0;
  if (edgeOn) { crisp = hzdEdgeCrisp(p.xz, h); }
  if (full && stage >= 2.5 && fade > 0.0 && n3) {
    // N1 'nubis3': the deck's up-rez on the coarse density (the dimensional profile): the composite frequency follows P = d, the type T
    // follows the height and the HZD type; the erosion order 'hfw' erodes the base noise by the same composite before the profile and the
    // coverage remap, 'gp7' erodes the profile itself (the deck's order).
    let prof = saturate(d);
    var T = hzdN3Type(n.topType + P.hzCov.y, h);
    // P2.5a: the type follows the crispness instead of the height (billowy toward crisp, wispy toward soft); stratus stays partly wispy.
    if (edgeOn) { T = crisp * mix(P.hzN3.w, 1.0, saturate(2.0 * (n.topType + P.hzCov.y))); }
    var n3 = hzdN3Noise(qDetail, h, footprint, t, prof, T);
    if (swirlW > 0.01) { n3 = mix(n3, hzdN3Noise(qDetailB, h, footprint, t, prof, T), swirlW); }
    var comp = saturate(n3 * P.hzN3.z * fade);
    if (edgeOn) { comp = saturate(n3 * P.hzN3.z * fade * mix(P.hzEdge2.z, P.hzEdge2.w, crisp)); }
    // P2.5b edge lobes: the H7 lobe rung at edgeLobes x c (rounded middle-size lobes where crisp), added to the erosion.
    if (edgeOn && P.hzEdge4.x > 0.0) {
      let lc = saturate(cov / max(P.hzShelf.w, 1e-3));
      comp = saturate(comp + hzdLobeNoise(qDetail, footprint, t) * P.hzEdge4.x * crisp * fade * lc * lc);
    }
    if (P.hzExtra.w > 0.5) {
      let be = hzdValueErosion(base, comp);
      density = max(hzdRemap(be * gradient, 1.0 - cov, 1.0, 0.0, 1.0), 0.0) * covK * fadeK;
    } else {
      density = hzdValueErosion(prof, comp);
    }
    // s107 / s109: x S^4, then sharpen with pow(.., lerp(0.3, 0.6, S^4)); S = P.hzN3b.y (0 = off).
    if (P.hzN3b.y > 0.0) {
      let s2 = P.hzN3b.y * P.hzN3b.y;
      let s4 = s2 * s2;
      density = pow(max(density, 0.0) * s4, mix(0.3, 0.6, s4));
    }
    // P2.5a/b: the edge's hardness by c (hzdEdgeShape).
    if (edgeOn) { density = hzdEdgeShape(density, crisp); }
    // The veil keeps its own noise (the HZD detail fBM, as the 'hzd' branch reads it).
    if (P.hzVeil.x < 0.5 && veil > 0.0) { veilW = hzdDetailFbm(select(qDetail, qVeil, skirtOn), h, footprint, false); }
  } else if (full && stage >= 2.5 && fade > 0.0) {
    var hfFbm = hzdDetailFbm(qDetail, h, footprint, t < P.hzMisc.w);
    if (swirlW > 0.01) { hfFbm = mix(hfFbm, hzdDetailFbm(qDetailB, h, footprint, t < P.hzMisc.w), swirlW); }
    if (P.hzVeil.x < 0.5) { veilW = hfFbm; if (skirtOn && veil > 0.0) { veilW = hzdDetailFbm(qVeil, h, footprint, false); } }
    let hag = P.hzCov.w > 0.5;
    // gp7 p.108: wispy (fbm) below, billowy (1 - fbm) above; H6: the switch height is a setting (gp7 0.1 = h * 10; hag 0.2 = h * 5).
    var modifier = mix(hfFbm, 1.0 - hfFbm, saturate(h / select(P.hzExtra.z, 0.2, hag)));
    // F1 S7: a storm's upper 40 % is glaciated: fibrous (wispy) instead of cauliflower (photos §4).
    // P2.5a: billowy toward crisp, wispy toward soft (instead of by height).
    if (edgeOn) { modifier = mix(hfFbm, 1.0 - hfFbm, crisp); }
    if (hzdStormW > 0.0) { modifier = mix(modifier, hfFbm, hzdStormW * smoothstep(0.55, 0.75, h)); }
    // H7: the erosion strength rises from P.hzSkirt.w at the base to erosionStrength at the wispy switch (wispy bottoms erode deeper; gp7 one value).
    var strength = select(mix(P.hzSkirt.w, P.hzExtra.y, saturate(h / P.hzExtra.z)), 0.35 * exp(-0.75 * cov), hag);
    if (edgeOn) { strength *= mix(P.hzEdge2.z, P.hzEdge2.w, crisp); }
    // F1 S7: the anvil plate erodes at half strength (smooth glaciated top, photos §4; ours).
    if (hzdStormW > 0.0) { strength *= 1.0 - 0.5 * hzdStormW * smoothstep(0.65, 0.8, h); }
    // H7 lobe rung: the step between the body (shape noise, 0.6-1.2 km) and the detail grain (75 m cells) that the photos have and we lacked
    // (santa D1 / frog F1: ~3.5x per level; topics/surface-detail.md "a lobe field at ~70-250 m in the profile stage"). One billowy octave:
    // the detail texture's coarsest channel (inverted Worley, 4 cells per tile) read with its own tile (lobeTile; 4 cells = lobeTile / 4 m),
    // curl-displaced like the detail, its cell borders eroding the low-frequency noise so each body grows ~3.5x-smaller domes. It fades in from
    // the wispy switch to lobeFull (h): textured tops, smooth bellies (santa D2, frog F3). Constants ours.
    var lobe = 0.0;
    // P2.5b: with edge character on, the rung's strength is edgeLobes x c instead of lobeStrength x the height ramp.
    if (P.hzLobe.y > 0.0 || (edgeOn && P.hzEdge4.x > 0.0)) {
      // Scaled by sat(coverage / lobeCoverage)^2: small, thin-coverage clouds keep one lobe level instead of shattering into pellets
      // (world-anchored lobes: a small body shows fewer of them, frog F1).
      let lc = saturate(cov / max(P.hzShelf.w, 1e-3));
      var lobeK = P.hzLobe.y * smoothstep(P.hzExtra.z, max(P.hzLobe.z, P.hzExtra.z + 1e-3), h);
      if (edgeOn) { lobeK = P.hzEdge4.x * crisp; }
      lobe = hzdLobeNoise(qDetail, footprint, t) * lobeK * fade * lc * lc;
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
    if (edgeOn) { density = hzdEdgeShape(density, crisp); }
  }
  density = saturate(density);
  // F1 S7, hag eq 18: the anvil density fix, x lerp(1, sat(remap(sqrt(h), 0.4, 0.95, 1, 0.2)), amount) (keeps the plate from going opaque).
  let dfix = P.hzAnvil.w * hzdAnvilAmount();
  if (dfix > 0.0) { density *= mix(1.0, saturate(hzdRemap(sqrt(h), 0.4, 0.95, 1.0, 0.2)), dfix); }
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
  // STORM1 storm lighting: the storm is denser (extinction x stormDensity); the trace dims its light by stormDark (o.storm) and adds the lightning
  // glow (o.glow x the flash envelope).
  if (hzdStormW > 0.0) {
    o.sigma *= 1.0 + hzdStormW * (P.hzStorm4.x - 1.0);
    o.glow = hzdStormW * P.hzStorm4.z;
    o.storm = hzdStormW;
  }
  o.coarse = coarse;
  o.h = h;
  // No surface distance in a per-sample model: the coarse density times the column height stands in (as the Takram shaper).
  o.depth = coarse * (top - bottom) * 0.25;
  // C1 exact light profile (ne22 p.29/p.54; the sky layer's approach): the dimensional profile P = coverage x height gradient (no noise, no lumps), and
  // the depth in cloud f / |df/dy| on the smooth level set f = 0.5 g - (1 - coverage) (the base noise at its mean 0.5), the gradient by a central
  // difference of the type gradient. Read by the trace when ProcParams.lit.w is 1; the sheets and fractus leave 0 (the trace falls back to the stand-in).
  if (P.lit.w > 0.5) {
    let gT = n.topType + P.hzCov.y;
    let g0 = hzdHeightGradientR(gT, h, h);
    let dh = 0.02;
    let dg = (hzdHeightGradientR(gT, h + dh, h + dh) - hzdHeightGradientR(gT, h - dh, h - dh)) / (2.0 * dh);
    let fs = 0.5 * g0 - (1.0 - cov);
    let span = top - bottom;
    o.prof = cov * g0;
    o.depthX = clamp(max(fs, 0.0) / max(0.5 * abs(dg), 1e-3) * span, 0.0, 0.5 * span);
  }
  return o;
}
// F1 step 3: a sheet layer with its own form (photos §5-7, web18 Table 2, ne22 p.15-16; constants ours). A = (form, bottom m, thickness m,
// coverage), B = (cell size m, elongation along the wind, extinction 1/m, detail erosion). The noise is the HZD shape texture read with the
// sheet's own tile in wind-aligned coordinates (stretched B.y : 1 along the wind), under a large-scale coverage field (patches, a density
// gradient across the sky, merged areas).
fn hzdSheetSample(A: vec4<f32>, B: vec4<f32>, p: vec3<f32>, t: f32, footprint: f32, full: bool) -> ProcSample {
  var o: ProcSample;
  o.sigma = 0.0; o.coarse = 0.0; o.depth = 0.0; o.h = 0.0;
  let alt = procAltitude(p);
  let h = (alt - A.y) / A.z;
  if (h <= 0.0 || h >= 1.0) { return o; }
  let wind2 = vec2(P.hzWind.x, P.hzWind.y);
  let xz = p.xz - P.drift.xz * P.hzSpeed.y;
  let uv = vec2(dot(xz, wind2) / B.y, dot(xz, vec2(-wind2.y, wind2.x)));
  // Local coverage: the sheet's coverage moved +-0.35 by a field with features of about 40 cells.
  let c = saturate(A.w + 0.35 * hzdLowField(uv, B.x * 40.0, 0.83));
  if (c <= 0.0) { return o; }
  let form = u32(A.x + 0.5);
  var T = B.x * 10.0;                      // altocumulus: the first Worley octave (G, 10 cells per tile) is one cell
  if (form != 1u) { T = B.x * 6.0; }
  let lod = hzdLod(footprint, T, 128.0);
  let N = textureSampleLevel(procNoiseA, procRepeat, vec3(uv / T, 0.31 + alt / T), lod);
  var n: f32; var grad: f32;
  if (form == 1u) {
    // Altocumulus: jittered Worley cells (inverted Worley fBM: bright cell centres; random feature points give the irregular spacing), flat
    // base, domed lumpy top: the cell value x a quick rise and a long rounded fall.
    n = saturate((N.g * 0.7 + N.b * 0.3 - 0.5) / 0.35);
    grad = smoothstep(0.0, 0.12, h) * smoothstep(1.0, 0.25, h);
  } else if (form == 2u) {
    // Altostratus: a mottled sheet (the Perlin-Worley, low contrast), soft at both ends.
    n = saturate(0.55 + (N.r - 0.5) * 1.2);
    grad = smoothstep(0.0, 0.35, h) * smoothstep(1.0, 0.45, h);
  } else {
    // Stratus deck: flat base, gently lumpy top.
    n = saturate(0.2 + N.r * 0.5 + N.g * 0.4);
    grad = smoothstep(0.0, 0.08, h) * smoothstep(1.0, 0.4, h);
  }
  var d = hzdRemap(n * grad, 1.0 - c, 1.0, 0.0, 1.0);
  if (d <= 0.0) { return o; }
  let coarse = saturate(d);
  // Detail: wispy toward the base, billowy above (gp7 p.108), within the detail distance.
  if (full && B.w > 0.0 && t < P.hzFade.z) {
    let f = hzdDetailFbm(vec3(xz.x, alt, xz.y), h, footprint, false);
    let modifier = mix(f, 1.0 - f, saturate(h / 0.3));
    d = hzdRemap(d, modifier * B.w * (1.0 - smoothstep(0.75, 1.25, t / max(P.hzFade.z, 1.0))), 1.0, 0.0, 1.0);
  }
  d = saturate(d);
  if (d <= 0.0) { return o; }
  o.sigma = d * B.z; o.coarse = coarse; o.h = h; o.depth = coarse * A.z * 0.25;
  return o;
}
// Two samples in one: extinctions add; the rest is extinction-weighted.
fn hzdMerge(a: ProcSample, b: ProcSample) -> ProcSample {
  if (b.sigma <= 0.0) { return a; }
  if (a.sigma <= 0.0) { return b; }
  let s = a.sigma + b.sigma;
  let w = b.sigma / s;
  var o: ProcSample;
  o.sigma = s; o.coarse = mix(a.coarse, b.coarse, w); o.depth = mix(a.depth, b.depth, w); o.h = mix(a.h, b.h, w);
  o.prof = mix(a.prof, b.prof, w); o.depthX = mix(a.depthX, b.depthX, w); o.glow = mix(a.glow, b.glow, w); o.storm = mix(a.storm, b.storm, w);
  return o;
}
// F1 step 4: is there a body base over column xz? Returns (presence 0..1: the coarse body at the belly height fractusBelly, as the main chain
// thresholds it; the belly altitude). Mirrors hzdMainSample's column (NDF heights, height from coverage) without the ring, storms or detail.
fn hzdBelly(xz: vec2<f32>, lod: f32) -> vec2<f32> {
  let n = ndfSample(xz);
  let cov = saturate(n.coverage + P.hzCov.x);
  let span = P.hzLayer.y - P.hzLayer.x;
  let bottom = P.hzLayer.x + n.minHeight * span;
  var top = P.hzLayer.x + n.maxHeight * span;
  if (P.hzProf.z > 0.0) { top = bottom + max(top - bottom, 1.0) * mix(1.0, saturate(cov / P.hzProf.w), P.hzProf.z); }
  let hb = P.hzFrac.w;
  let altB = bottom + hb * max(top - bottom, 1.0);
  if (cov <= 0.0) { return vec2(0.0, altB); }
  hzdBt = saturate(n.bottomType + P.hzType2.x);
  hzdStormW = 0.0;
  let g = hzdHeightGradient(n.topType + P.hzCov.y, hb);
  if (g <= 0.0) { return vec2(0.0, altB); }
  let windDir = vec3(P.hzWind.x, 0.0, P.hzWind.y);
  let scroll = P.drift.xyz + vec3(0.0, P.hzWind.w * length(P.drift.xz), 0.0);
  let q = vec3(xz.x, altB, xz.y) - windDir * (hb * P.hzWind.z) - scroll * P.hzSpeed.y;
  let A = textureSampleLevel(procNoiseA, procRepeat, q / P.hzScale.x, lod);
  let base = hzdRemap(A.r, -(1.0 - (A.g * 0.625 + A.b * 0.25 + A.a * 0.125)), 1.0, 0.0, 1.0);
  return vec2(saturate(hzdRemap(base * g, 1.0 - cov, 1.0, 0.0, 1.0) / 0.15), altB);
}
// F1 step 4: fractus. Ragged shreds hanging from each body's belly line (h fractusBelly) down to fractusDrop m below it and trailing up to
// fractusTrail m downwind: the sample looks fractusTaps taps upwind (0 .. trail) for a body base (hzdBelly), so material exists only under and
// behind real bodies and never above the belly (crisp tops; H7's skirt band attached to nothing and crossed lit crowns). The pieces sink a little
// and thin out with the distance they have trailed. The shreds: the detail fBM read fractusScale x coarser, curl-displaced fractusCurl x (with a
// vertical share), cut where it is below 1 - presence (ragged gaps, no streaks). Ours (n3 s162's skirt, hzd15 s26/s37 wispy bottoms).
fn hzdFractusSample(p: vec3<f32>, t: f32, footprint: f32) -> ProcSample {
  var o: ProcSample;
  o.sigma = 0.0; o.coarse = 0.0; o.depth = 0.0; o.h = 0.0;
  let alt = procAltitude(p);
  let span = P.hzLayer.y - P.hzLayer.x;
  if (alt < P.hzLayer.x - P.hzFrac.z || alt > P.hzLayer.x + 0.45 * span || t > P.hzFrac2.w) { return o; }
  let wind2 = vec2(P.hzWind.x, P.hzWind.y);
  let K = u32(P.hzFrac2.z);
  let lod = hzdLod(footprint, P.hzScale.x, 128.0) + 1.0;
  // The pieces leave the lee edge: the trail term (taps 1..K-1 upwind) is cut where a body sits right overhead (tap 0), so the shreds hang
  // along the edges and stream out behind each body instead of lining its whole underside as a second base. Their hang height wanders by
  // +-0.4 drop over ~1 km (no flat band at one altitude).
  let jit = 0.4 * P.hzFrac.z * hzdLowField(p.xz, 4000.0, 0.47);
  var F = 0.0;
  var over = 0.0;
  for (var k = 0u; k < K; k++) {
    let f = select(f32(k) / f32(K - 1u), 0.0, K == 1u);
    let b = hzdBelly(p.xz - wind2 * (P.hzFrac.y * f), lod);
    if (b.x <= 0.0) { continue; }
    let top = b.y - 0.3 * P.hzFrac.z * f + jit;      // trailing pieces sink
    // Soft at both ends (a thin band with hard ends flickers under the march's jittered steps).
    let v = smoothstep(top - P.hzFrac.z, top - 0.5 * P.hzFrac.z, alt) * (1.0 - smoothstep(top - 0.5 * P.hzFrac.z, top + 40.0, alt));
    if (k == 0u && K > 1u) { over = b.x * v; continue; }
    F = max(F, b.x * v * (1.0 - 0.5 * f));
  }
  F *= 1.0 - 0.85 * over;
  if (F <= 0.0) { return o; }
  let scroll = P.drift.xyz + vec3(0.0, P.hzWind.w * length(P.drift.xz), 0.0);
  let q = vec3(p.x, alt, p.z) - scroll * P.hzSpeed.z;
  let curl = textureSampleLevel(procAux, procRepeat, q.xz / P.hzScale.z, 0.0).xyz;
  var qd = q + vec3(curl.x, 0.5 * curl.z, curl.y) * (P.hzScale.w * P.hzFrac2.y);
  // Mildly stretched along the wind (1.6 : 1, torn pieces trail; H7's 2.5 read as streaks).
  qd -= vec3(wind2.x, 0.0, wind2.y) * dot(qd.xz, wind2) * (1.0 - 1.0 / 1.6);
  let tile = P.hzScale.y * P.hzFrac2.x;
  let B = textureSampleLevel(procNoiseB, procRepeat, qd / tile, hzdLod(footprint, tile, 32.0)).rgb;
  // The wispy form (gp7 p.108: fbm, not 1 - fbm): the detail channels are inverted Worley, so 1 - fBM is the web between the cells, i.e.
  // torn, filamentary pieces instead of the round billows at the cell centres.
  let wv = 1.0 - (B.r * 0.625 + B.g * 0.25 + B.b * 0.125);
  let d = saturate(hzdRemap(wv, 1.0 - 0.7 * F, 1.0, 0.0, 1.0)) * P.hzFrac.x;
  if (d <= 0.0) { return o; }
  o.sigma = d * P.hzLayer.w; o.coarse = d; o.h = 0.02; o.depth = 0.0;
  return o;
}
fn procSample(p: vec3<f32>, t: f32, footprint: f32, full: bool, jitter: f32) -> ProcSample {
  var o = hzdMainSample(p, t, footprint, full, jitter);
  if (P.hzFrac.x > 0.0 && full && o.sigma <= 0.0) { o = hzdFractusSample(p, t, footprint); }
  if (P.hzMid.x > 0.5) {
    // L3: the mid slot's volume share: full close to the camera and fading out with distance in 'hybrid' (the 2.5D layer fades in), none in 'layer'.
    var volW = select(1.0 - smoothstep(P.hzMix.y, P.hzMix.z, t), 0.0, P.hzMix.x > 1.5);
    if (P.hzMix.x < 0.5) { volW = 1.0; }
    if (volW > 0.0) {
      var sh = hzdSheetSample(P.hzMid, P.hzMid2, p, t, footprint, full);
      sh.sigma *= volW;
      o = hzdMerge(o, sh);
    }
  }
  if (P.hzDeck.x > 0.5) { o = hzdMerge(o, hzdSheetSample(P.hzDeck, P.hzDeck2, p, t, footprint, full)); }
  if (P.hzStorm3.y > 0.0 && P.hzStorm.w > 0.0) { o = hzdMerge(o, hzdAnvilCirrus(p, t, footprint)); }
  return o;
}
// PF1 empty-space skipping (settings.ts emptySkip; hzd/bounds.ts makes the grid). The weather map's bounds grid (HZD_BOUNDS_GRID^2 cells over
// one NDF tile, in the map's own space: it moves with ndfOffset) holds, per cell, the largest coverage and the lowest base and highest top over the
// cell's texels and their bilinear neighbours (plus the fractus trail when fractus is on). A coarse-march stretch inside a cell is empty when the
// main layer cannot be there: no coverage anywhere in the cell, or the stretch's altitudes are all above the cell's highest top or below its lowest
// base, and no other contributor (the mid and deck sheets, fractus, storms) can be. Conservative by construction: any doubt returns false.
const HZD_BOUNDS_BASE = ${HZD_LUT_WORDS}u;
const HZD_BOUNDS_GRID = ${HZD_BOUNDS_GRID};
struct ProcCell { data: vec4<f32>, length: f32 }
// emptySkip: 0 off, 2 exact walk (the unskipped march's samples and step budget), 3 free walk (the budget is not charged: rays can reach further).
fn procBoundsMode() -> u32 { return u32(P.hzMix.w); }
fn procBoundsCell(origin: vec3<f32>, dir: vec3<f32>, t: f32) -> ProcCell {
  let g = f32(HZD_BOUNDS_GRID);
  let grid = ((origin.xz + dir.xz * t - ndfOffset()) / P.hzLayer.z) * g;
  let cell = vec2<i32>(floor(grid));
  let c = ((cell % HZD_BOUNDS_GRID) + HZD_BOUNDS_GRID) % HZD_BOUNDS_GRID;
  let data = unpack4x8unorm(procLut[HZD_BOUNDS_BASE + u32(c.y * HZD_BOUNDS_GRID + c.x)]);
  let dist = select(fract(grid), 1.0 - fract(grid), dir.xz >= vec2(0.0)) / max(abs(dir.xz) * g / P.hzLayer.z, vec2(0.0000001));
  return ProcCell(data, max(min(dist.x, dist.y), 0.05));
}
fn hzdAltitudeAlong(t: f32, dir: vec3<f32>, originHeight: f32) -> f32 {
  return originHeight + dir.y * t + dot(dir.xz, dir.xz) * t * t / (2.0 * PROC_EARTH_M);
}
fn procCellIsEmpty(t: f32, end: f32, dir: vec3<f32>, originHeight: f32, data: vec4<f32>) -> bool {
  // A storm (placed cell, painted area, anvil cirrus) can put cloud where the map has none.
  if (P.hzStorm.w > 0.0) { return false; }
  let span = P.hzLayer.y - P.hzLayer.x;
  let turningPoint = -dir.y * PROC_EARTH_M / max(dot(dir.xz, dir.xz), 0.000001);
  let aMin = hzdAltitudeAlong(clamp(turningPoint, t, end), dir, originHeight);
  let aMax = max(hzdAltitudeAlong(t, dir, originHeight), hzdAltitudeAlong(end, dir, originHeight));
  // The sheets (they do not read the map): the mid slot's volume share (the 2.5D layer draws the rest) and the deck.
  if (P.hzMid.x > 0.5 && P.hzMix.x < 1.5 && (P.hzMix.x < 0.5 || t < P.hzMix.z) && aMax > P.hzMid.y && aMin < P.hzMid.y + P.hzMid.z) { return false; }
  if (P.hzDeck.x > 0.5 && aMax > P.hzDeck.y && aMin < P.hzDeck.y + P.hzDeck.z) { return false; }
  // The horizon ring raises the coverage toward its target from ringStart out.
  var cov = data.x;
  if (P.hzRing.x > 0.0) {
    let ringOn = 1.0 - saturate((procAltitude(P.origin.xyz) - 0.5 * P.hzLayer.x) / max(0.5 * P.hzLayer.x, 1.0));
    if (ringOn > 0.0 && length(dir.xz) * end > P.hzRing.x) { cov = max(cov, P.hzRing.z); }
  }
  if (saturate(cov + P.hzCov.x) <= fract(P.hzMix.w) / 0.9) { return true; }   // emptySkipCoverage 0: no coverage anywhere in the cell
  var bottom = P.hzLayer.x + max(data.y - 1.0 / 255.0, 0.0) * span;
  var top = P.hzLayer.x + min(data.z + 1.0 / 255.0, 1.0) * span;
  if (P.hzStorm2.w < 1.0) { top = max(top, P.hzStorm2.x); }   // storms by type lift the top to the storm top
  if (P.hzFrac.x > 0.0) { bottom = min(bottom, P.hzLayer.x - P.hzFrac.z - 1.0); top = max(top, P.hzLayer.x + 0.45 * span); }   // fractus hangs below the base
  return aMin >= top || aMax <= bottom;
}
const PROC_HAS_BOUNDS = true;
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
