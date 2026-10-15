import { BILLOW_WGSL } from '../generate/shaders';
import { SPECIES_TOP_TYPES } from '../generate/profile-tables';
import { atmosphereWgsl } from './atmosphere.wgsl';
import { FRAME_WGSL } from './frame.wgsl';
import { LIGHTING_WGSL } from './lighting.wgsl';
import { MARCH_ATMOSPHERE_GROUP, MARCH_RADIANCE_LIMIT, SKY_LIGHT_ENTRIES, SUN_HEIGHT_WGSL } from './march.wgsl';

/** Group 1 bindings of the sky trace pass (0 Frame and 1 scene depth come from FRAME_WGSL). */
export const SKY_COLOR_BINDING = 2;
export const SKY_DEPTH_BINDING = 3;
export const SKY_WEATHER_BINDING = 4;
export const SKY_SAMPLER_BINDING = 5;
export const SKY_LIGHT_STORAGE_BINDING = 6;
export const SKY_PARAMS_BINDING = 7;
/** The part of the layer behind the voxel box (see the handoff note below). */
export const SKY_BACK_BINDING = 8;
/** X3: the procedural trace's extra pass bindings: the voxel march's near and far history depth words (r32uint) at this binding and +1 (after the model's 9..14). */
export const SKY_VOXEL_DEPTH_BINDING = 15;
/** Group 1 bindings of the resolve pass (0 Frame, 1 scene depth as above). */
export const SKY_RESOLVE_BINDINGS = {
  trace: 4, traceDepth: 5, hist: 6, histDepth: 7, histOut: 8, histDepthOut: 9, params: 10, sampler: 11, traceBack: 13, histBack: 14, histBackOut: 15,
} as const;
/**
 * SkyParams uniform: the per-frame header (10 vec4 + mat4 + 7 vec4 = 84 floats, written every frame), then H4's static part written once at
 * creation: the profile tables' top ends (16 vec4, 64 floats), the two N3 s18 tables and their column peaks (768 vec4<u32>: 3 x 64 x 64 bytes).
 */
export const SKY_PARAM_FLOATS = 84;
/** H4: word offsets of the static part (the tables' top ends, then the packed tables) in the params buffer. */
export const SKY_TABLE_TOP_OFFSET = SKY_PARAM_FLOATS;
export const SKY_LUT_OFFSET = SKY_TABLE_TOP_OFFSET + 64;
export const SKY_PARAM_BYTES = (SKY_LUT_OFFSET + 3072) * 4;
/** Temporal amortization: one pixel of every 4x4 block per frame, 16 frames per cycle. */
export const SKY_TEMPORAL_PERIOD = 16;

/**
 * Distant sky layer: the Nubis vertical-profile (2.5D) method [N3 s18, s44]. A cloud shell [shellMin, shellMax] around the whole
 * world, driven by the same world-anchored weather field as the generator (a baked window of weather.ts, uv = (xz - boxMin) / boxSize)
 * and the generator's own shaping law (generate/shaders.ts SHAPE: f = s - h^p + billow, flat base lifted toward lobe rims), turned
 * into the (profile, detail type, density scale) triple analytically instead of through a voxel SDF:
 *
 *   depth below the surface = f / |grad f|   (first-order Euclidean distance; exact for a locally planar level set)
 *
 * P3-C1 used f * depthScale, i.e. assumed a constant gradient. The billow switches on over 0.25 of f (the `near` ramp), where the
 * gradient is up to 5x the smooth field's, so one step across the surface landed 60 m "deep" and fully dense: the vertical cliffs.
 * grad f: the smooth part from the coverage gradient (P9-C2: differences of bilinear samples one texel apart, continuous across texel
 * edges), the billow from the Worley offset vectors (|grad F1| = 1 / cell). The profile then
 * gets the generator's own multiplicative depth noise and PACK_FIT formulas, and goes through the SAME up-rez (cloudDensityShaped)
 * and the SAME lighting chunk (LIGHTING_WGSL) as the voxel march. There is no light grid out here: the sun optical depth is two
 * in-line up-rez samples plus six cheap samples of the smooth field along the sun ray (48..470 m), the ambient 'up' term three
 * cheap samples straight up (0..272 m).
 *
 * Handoff with the voxel box (rimWidth = 0, the default when the generator's weather border is 0): the field is one continuous
 * weather map; view rays skip the box interior (the voxel march renders it) and pick the same field up at the wall. The ray's
 * result is written as two premultiplied layers, the part in front of the box and the part behind it, so the composite can order
 * sky-front / voxel / sky-back exactly (a single mean distance cannot order interleaved layers: P3-C1's per-pixel ordering test
 * flipped along contours and left chains of bright dots). Light samples are not masked, so sky cloud next to the wall is shadowed
 * by the cloud inside the box. rimWidth > 0 keeps the P3-C1 cross-fade (then the split is the middle of the box interval).
 *
 * Temporal amortization [N3 s44]: `trace` renders one pixel of every 4x4 block per frame (Bayer order, all pixels on a reset);
 * `resolve` fills the rest by reprojecting the previous resolved frame through the cloud mean distance, clamped to the min/max of the
 * nine fresh samples around the pixel in proportion to how far the pixel moved, and blends fresh samples into the history (the
 * jitter changes every 16-frame cycle, so the history converges to a jitter-averaged image: no static hatch).
 * Trace: concatenate COMMON_WGSL + volumeWgsl(0) + DENSITY_WGSL + skyLayerWgsl(mode). Group 1 as above, group 2 the atmosphere.
 */
/** The SkyParams struct and the Bayer helpers: needs no other WGSL (the cloud shadow map includes just this). */
export const SKY_STRUCT_WGSL = /* wgsl */ `
struct SkyParams {
  window: vec4<f32>,   // weather window: min x, min z, size x, size z (world metres)
  box: vec4<f32>,      // volume box: min x, min z, size x, size z
  shell: vec4<f32>,    // minY, maxY, maxDistance, curvature (1/(2R), 0 = flat)
  shapeA: vec4<f32>,   // topFrac, domeExp, baseDefault, baseLift
  shapeB: vec4<f32>,   // coverageThreshold, billow weight from B (1: the weather's B is the owning cloud's billow weight, P9-B; 0: weight 1), scaleBase, scaleTop
  shapeC: vec4<f32>,   // detailBias, rimWidth (m; 0 = hard partition at the box wall, < 0 = no mask), extinction multiplier, window edge fade (fraction)
  steps: vec4<f32>,    // stepMin (m), stepRel (per m of distance), maxSteps, transmittance cutoff
  billow: vec4<f32>,   // generator billow: amplitude, first cell (m), seed (as given to the generator), debug view
  extra: vec4<f32>,    // voxel size (m, profile noise scale), profileSigma, billow LOD scale, temporal blend of a fresh sample
  temporal: vec4<f32>, // phase (0..15), cycle (jitter seed), full trace (1 = every pixel), 0
  prevViewProj: mat4x4<f32>,
  prevCam: vec4<f32>,  // previous camera position, w = 1 when the history is valid
  wOrigin: vec4<f32>,  // P7-E: world position (x, z) of the weather map's uv origin: the billow and shape noise are anchored there (default: the box min corner); zw: wind-shear lean (P9-B2)
  species: vec4<f32>,  // P9-C: species profile table on (x > 0.5), upper (altocumulus) layer base and depth (fractions of the shell height; 0 = off); w: P9-C2 density hand-off width (m, 0 = off)
  table: vec4<f32>,    // H4 (S3): x profile mode (1 = the N3 s18 top x bottom tables), y table height of the column's min height (the floor 17/64, or 0), z threshold tau, w top type (< 0: from the species row)
  tableB: vec4<f32>,   // H4: x bottom type (< 0: the world field), y / z the field's range, w the field's feature size (m)
  erosion: vec4<f32>,  // H4 (S4): x erosion law (0 ValueErosion, 1 HZD additive with inverted noise, 2 Nubis Evolved, 3 additive with the raw noise); yzw 0
  cloudMotion: vec4<f32>, // C2: x, y, z the clouds' world displacement since the last frame (m; the wind offset's change times the cloud speed), w = 1 when the resolve follows it
  tableTop: array<vec4<f32>, 16>,   // H4: per top-type column, the table height where the top table ends (generate/profile-tables.ts profileTopEnds)
  lut: array<vec4<u32>, 768>,       // H4: the top table, the bottom table and the column peaks, 64 x 64 bytes each, 4 per word (packProfileTables)
}
const BAYER4 = array<u32, 16>(0u, 8u, 2u, 10u, 12u, 4u, 14u, 6u, 3u, 11u, 1u, 9u, 15u, 7u, 13u, 5u);
fn bayerIndex(px: vec2<i32>) -> u32 { return BAYER4[u32(px.y & 3) * 4u + u32(px.x & 3)]; }
// Position inside a 4x4 block of the pixel traced at this phase.
fn bayerPos(phase: u32) -> vec2<i32> {
  for (var i = 0u; i < 16u; i++) { if (BAYER4[i] == phase) { return vec2<i32>(i32(i & 3u), i32(i >> 2u)); } }
  return vec2<i32>(0);
}
`;
/** skySceneEnd: needs FRAME_WGSL. */
export const SKY_SCENE_END_WGSL = /* wgsl */ `
// Farthest scene distance over the output pixels a layer pixel covers.
fn skySceneEnd(px: vec2<i32>, uv: vec2<f32>) -> f32 {
  let ratio = frame.outputSize / frame.renderSize;
  let lo = vec2<i32>(floor(vec2<f32>(px) * ratio));
  let hi = min(vec2<i32>(ceil(vec2<f32>(px + vec2<i32>(1)) * ratio)) - vec2<i32>(1), lo + vec2<i32>(7));
  let dmax = vec2<i32>(textureDimensions(sceneDepth)) - vec2<i32>(1);
  var depth = 0.0;
  for (var y = lo.y; y <= hi.y; y++) {
    for (var x = lo.x; x <= hi.x; x++) { depth = max(depth, textureLoad(sceneDepth, min(vec2<i32>(x, y), dmax), 0)); }
  }
  return sceneDistance(depth, uv);
}
`;
export const SKY_PARAMS_WGSL = SKY_STRUCT_WGSL + SKY_SCENE_END_WGSL;

/** The analytic sky field shared by the layer's trace and the reflection dome: the generator's shape law evaluated from the baked weather window.
 * The includer declares `SKY` (SkyParams), `skyWeather` and `skySampler`, and provides BILLOW_WGSL and COMMON_WGSL. */
export const SKY_FIELD_WGSL = /* wgsl */ `
// The generator's billow envelope: on over f00 in (NEAR_A, NEAR_B), off again over (NEAR_C, NEAR_D).
const NEAR_A = -0.55;
const NEAR_B = -0.3;
const NEAR_C = 0.18;
const NEAR_D = 0.45;
// Below this value of the smooth field the billow (<= 0.77 in f) cannot lift the surface up to the sample.
const SKY_BILLOW_REACH = -0.46;

fn dsmooth(a: f32, b: f32, x: f32) -> f32 {
  let t = saturate((x - a) / (b - a));
  return 6.0 * t * (1.0 - t) / (b - a);
}
fn nearRamp(x: f32) -> f32 { return (1.0 - smoothstep(NEAR_C, NEAR_D, x)) * smoothstep(NEAR_A, NEAR_B, x); }
fn dnearRamp(x: f32) -> f32 {
  return (1.0 - smoothstep(NEAR_C, NEAR_D, x)) * dsmooth(NEAR_A, NEAR_B, x) - smoothstep(NEAR_A, NEAR_B, x) * dsmooth(NEAR_C, NEAR_D, x);
}
// Where the surface sits in smooth-field units for a frozen local billow: the root of F(x) = x + K nearRamp(x), K = A b topW.
// F is monotone where the root lies (K > 0: on the rising ramp, K < 0: on the falling one), so a few Newton steps converge.
fn surfaceF00(K: f32) -> f32 {
  var x = clamp(-0.5 * K, -0.45, 0.45);
  for (var i = 0; i < 4; i++) {
    let F = x + K * nearRamp(x);
    let Fp = max(1.0 + K * dnearRamp(x), 0.3);
    x = clamp(x - F / Fp, NEAR_A, 0.6);
  }
  return x;
}

// One layer's shaping (P9-C): base and full-mass top (shell fractions), top and bottom type, billow amplitude and cell multipliers, detail flip
// height (< 0: the old detail law) and density scale. The generator's shapeAt does the same (generate/shaders.ts SHAPE, the SP_* species rows).
// bottom: the slope of g under the base in h units (the rows give it as metres of sag under a full-mass column).
struct SkyRow { base: f32, top: f32, p: f32, bottom: f32, bAmp: f32, bCell: f32, flip: f32, scale: f32 }
fn skyProfiles() -> bool { return SKY.species.x > 0.5 && SKY.shapeB.y > 0.5; }
fn skyRow(g: f32, shellH: f32) -> SkyRow {
  if (!skyProfiles()) { return SkyRow(SKY.shapeA.z, SKY.shapeA.x, SKY.shapeA.y, 24.0, 1.0, 1.0, -1.0, 1.0); }
  let row = speciesRow(g);
  let base = clamp(SKY.shapeA.z + row.baseOff / shellH, 0.004, 0.9);
  let top = min(base + row.depth / shellH, 0.97);
  return SkyRow(base, top, row.topExp, (top - base) * shellH / row.bottom, row.billowAmp, row.billowCell, row.flip, row.scale);
}
fn skyAltoRow() -> SkyRow {
  let row = altoRow();
  let shellH = max(SKY.shell.y - SKY.shell.x, 1.0);
  return SkyRow(SKY.species.y, SKY.species.y + SKY.species.z, row.topExp, SKY.species.z * shellH / row.bottom, row.billowAmp, row.billowCell, row.flip, row.scale);
}
fn skyAltoOn() -> bool { return skyProfiles() && SKY.species.y > 0.0 && SKY.species.z > 0.0; }

// H4 (S3): the Nubis Evolved / N3 s18 vertical-profile tables (generate/profile-tables.ts): vertical_profile = top(top type, h) * bottom(bottom type, h),
// times coverage [N3 s18, NE p.21-29]. The low layer only, and only with the species rows (they give each column its min height and depth).
fn skyTableOn() -> bool { return SKY.table.x > 0.5 && skyProfiles(); }
fn skyLutTexel(t: u32, x: u32, y: u32) -> f32 {
  let i = t * 4096u + y * 64u + x;
  let w = SKY.lut[i >> 4u][(i >> 2u) & 3u];
  return f32((w >> ((i & 3u) * 8u)) & 255u) * (1.0 / 255.0);
}
// Bilinear on texel centres (type: i / 63, height: (i + 0.5) / 64), as profile-tables.ts sampleProfileTable. t: 0 the top table, 1 the bottom one.
// The peaks (t = 2) are read the same way with the bottom type in place of the height: skyLut(2u, tt, bt * 63/64 + 0.5/64).
fn skyLut(t: u32, type_: f32, v: f32) -> f32 {
  let x = clamp(type_, 0.0, 1.0) * 63.0;
  let y = clamp(v * 64.0 - 0.5, 0.0, 63.0);
  let x0 = min(u32(x), 62u);
  let y0 = min(u32(y), 62u);
  let fx = x - f32(x0);
  let a = mix(skyLutTexel(t, x0, y0), skyLutTexel(t, x0 + 1u, y0), fx);
  let b = mix(skyLutTexel(t, x0, y0 + 1u), skyLutTexel(t, x0 + 1u, y0 + 1u), fx);
  return mix(a, b, y - f32(y0));
}
// The vertical profile at height fraction u of the column (0 = its min height, 1 = its max height); the min height sits at table height table.y.
fn skyTableV(tt: f32, bt: f32, u: f32) -> f32 {
  let v = SKY.table.y + u * (1.0 - SKY.table.y);
  return skyLut(0u, tt, v) * skyLut(1u, bt, v);
}
// Where the top table ends for this top type (table height), interpolated over the type columns.
fn skyTableTop(tt: f32) -> f32 {
  let x = clamp(tt, 0.0, 1.0) * 63.0;
  let i0 = min(u32(x), 62u);
  let a = SKY.tableTop[i0 >> 2u][i0 & 3u];
  let b = SKY.tableTop[(i0 + 1u) >> 2u][(i0 + 1u) & 3u];
  return mix(a, b, x - f32(i0));
}
// Top type of a column: one value everywhere (table.w >= 0) or the species row's (profile-tables.ts SPECIES_TOP_TYPES, piecewise linear in g).
const SKY_TOP_TYPES = array<f32, 5>(${SPECIES_TOP_TYPES.map(v => v.toFixed(4)).join(', ')});
fn skyTopType(g: f32) -> f32 {
  if (SKY.table.w >= 0.0) { return SKY.table.w; }
  let x = clamp(g, 0.0, 1.0) * 4.0;
  let i = min(u32(x), 3u);
  return mix(SKY_TOP_TYPES[i], SKY_TOP_TYPES[i + 1u], x - f32(i));
}
// Bottom type of a column, independent of the top type: one value everywhere (tableB.x >= 0) or a world-anchored very-low-frequency field between
// tableB.y and tableB.z with features of about tableB.w metres (two octaves of value noise). The G path's weather map has no free channel for it;
// the NDF's bottom-type field (work/specs/ndf.md, ndfA.B) is where it goes when the sky layer reads the NDF.
fn skyValueNoise2(q: vec2<f32>, s: u32) -> f32 {
  let i = vec2<i32>(floor(q));
  let f = fract(q);
  let u = f * f * (3.0 - 2.0 * f);
  let k = 1.0 / 4294967295.0;
  let a = f32(hashu(vec3<i32>(i, 0), s)) * k;
  let b = f32(hashu(vec3<i32>(i + vec2<i32>(1, 0), 0), s)) * k;
  let c = f32(hashu(vec3<i32>(i + vec2<i32>(0, 1), 0), s)) * k;
  let d = f32(hashu(vec3<i32>(i + vec2<i32>(1, 1), 0), s)) * k;
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn skyBottomType(col: vec2<f32>) -> f32 {
  if (SKY.tableB.x >= 0.0) { return SKY.tableB.x; }
  let q = col / max(SKY.tableB.w, 100.0);
  let n = 0.65 * skyValueNoise2(q, 71u) + 0.35 * skyValueNoise2(q * 2.03 + vec2(17.3, 5.1), 72u);
  return mix(SKY.tableB.y, SKY.tableB.z, smoothstep(0.2, 0.8, n));
}

// The generator's smooth shape field at coverage cov and shell height fraction hz: f = s - g(h) (generate/shaders.ts shapeAt), for the layer row L.
// lift: the rim curl of the base (baseLift; half of it for the upper layer, as the generator).
// p: the top exponent at this column (P9-C: rounded toward the rim, generate/shaders.ts edgeExp).
struct Smooth { f: f32, s: f32, h: f32, base: f32, hcol: f32, p: f32 }
fn skySmooth(cov: f32, hz: f32, L: SkyRow, lift: f32) -> Smooth {
  var r: Smooth;
  let thr = SKY.shapeB.x;
  r.s = saturate((cov - thr) / (1.0 - thr));
  r.base = L.base + lift * pow(1.0 - r.s, 1.5);
  r.p = select(L.p, edgeExp(L.p, r.s), skyProfiles());
  if (skyProfiles()) { r.s = tallMass(r.s, r.p, (L.top - L.base) * max(SKY.shell.y - SKY.shell.x, 1.0)); }   // P9-C2 (generate/shaders.ts)
  r.h = (hz - r.base) / max(L.top - r.base, 1e-3);
  r.f = r.s - profileG(r.h, r.p, L.bottom);
  r.hcol = clamp(r.h / pow(max(r.s, 0.05), 1.0 / r.p), 0.0, 1.0);
  return r;
}

// Worley F1 with the offset to the nearest feature point (xyz = c - q in cell units, w = F1).
fn worleyF1v(q: vec3<f32>, s: u32) -> vec4<f32> {
  let i = vec3<i32>(floor(q));
  let f = fract(q);
  // P9-C3: the own cell first, then a neighbour only if its cell box is nearer than the best point so far (squared distances per axis to the
  // lower / upper neighbour slab): the same F1 and offset as the full 27-cell search, with fewer hashes.
  let dn = f * f;
  let dp = (1.0 - f) * (1.0 - f);
  var best = hash3f(i, s) - f;
  var m = dot(best, best);
  for (var z = -1; z <= 1; z++) { for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let box = select(select(0.0, dp.x, x > 0), dn.x, x < 0) + select(select(0.0, dp.y, y > 0), dn.y, y < 0) + select(select(0.0, dp.z, z > 0), dn.z, z < 0);
    if (box < m && (x != 0 || y != 0 || z != 0)) {
      let o = vec3<i32>(x, y, z);
      let d = vec3<f32>(o) + hash3f(i + o, s) - f;
      let dd = dot(d, d);
      if (dd < m) { m = dd; best = d; }
    }
  } } }
  return vec4(best, sqrt(m));
}
// The generator's billow (billowAt: same octaves, seeds, offsets and normalisation): xyz = its gradient per metre (in pm axis
// order x, z, y), w = the value. Octaves fade out by distance instead of switching, so no surface is displaced at a threshold:
// octave 2 (cell/4) over 5..10 km, octave 1 over 12..24 km (times the LOD scale).
fn billowGrad(pm: vec3<f32>, cell0: f32, s0: u32, dist: f32, octaves: u32) -> vec4<f32> {
  let lod = max(SKY.extra.z, 1e-3);
  let w1 = 1.0 - smoothstep(12000.0 * lod, 24000.0 * lod, dist);
  let w2 = 1.0 - smoothstep(5000.0 * lod, 10000.0 * lod, dist);
  var a = 0.0; var wsum = 0.0; var amp = 0.55; var cell = cell0;
  var g = vec3(0.0);
  for (var o = 0u; o < octaves; o++) {
    let lw = select(select(w2, w1, o == 1u), 1.0, o == 0u);
    if (lw > 0.0) {
      let r = worleyF1v(pm / cell + vec3<f32>(f32(o) * 7.3, f32(o) * 3.1, 0.0), s0 + o * 17u);
      let v = 1.0 - clamp(r.w * 1.1, 0.0, 1.0);
      a += lw * amp * v; wsum += lw * amp;
      // d(1 - 1.1 |q - c|)/dq = 1.1 (c - q) / |c - q|, per metre: / cell. The value has a kink where the clamp bites
      // (1.1 F1 = 1); ramping the gradient to zero there keeps |grad f| (so the depth) continuous.
      if (r.w > 1e-4) { g += lw * amp * (1.1 / (cell * r.w)) * (1.0 - smoothstep(0.85, 1.0, r.w * 1.1)) * r.xyz; }
    }
    cell *= 0.5; amp *= 0.55;
  }
  return vec4(g / wsum, a / wsum - 0.36);
}

// Analytic (profile, detail type, density scale) at a world point, the Euclidean depth below the surface, the shape field f
// (> 0 inside) and a conservative skip distance (metres) for empty space. lodDistance < 0 drops the billow (the smooth field:
// cheap light samples, debug). light = true: the box is never masked (light samples see the cloud inside the box too).
// bGiven / useGiven: reuse this billow evaluation (gradient, value) instead of evaluating the Worley octaves: the in-line sun
// samples sit 8-32 m from the view sample, well under the finest octave's cell, so its billow stands in for theirs.
struct SkyModel { m: vec3<f32>, depth: f32, hz: f32, skip: f32, f: f32, b: vec4<f32>, n: vec2<f32>, empty2d: bool }
// P9-C3: what a light sample reuses from its view sample: the billow (b, as before) and the profile's depth noise and surface patch (n: the
// noise exponent and patchN). Both vary over 36 m and more; the in-line sun samples sit 8-32 m away. valid = false: evaluate everything.
struct SkyGiven { b: vec4<f32>, n: vec2<f32>, valid: bool }

// The generator's wind-shear lean (P9-B, shaders.ts weatherAt): a column reads the weather lean metres upwind per metre above the shell
// base, so every cloud's top is displaced downwind by lean * height and clouds straddling the box wall continue across it.
fn skyLean() -> vec2<f32> { return SKY.wOrigin.zw; }

fn skyModel(p0: vec3<f32>, lodDistance: f32, light: bool) -> SkyModel {
  return skyModelB(p0, lodDistance, light, SkyGiven(vec4(0.0), vec2(0.0), false));
}
// One layer of the field at a point (P9-C: the low species layer or the upper altocumulus one): cov and its gradient dcov (per metre, x and z),
// the layer's row L, its base rim lift, the billow weight wb (the weather's B for the low layer, 1 for the upper one), the species g (old detail law).
fn skyLayerAt(pm: vec3<f32>, hz: f32, shellH: f32, cov: f32, dcov: vec2<f32>, L: SkyRow, lift: f32, wb: f32, g: f32, alto: bool, lodDistance: f32,
    given: SkyGiven) -> SkyModel {
  var r: SkyModel;
  r.m = vec3(0.0); r.depth = 0.0; r.skip = 0.0; r.f = -1.0; r.b = vec4(0.0); r.n = vec2(0.0); r.empty2d = false; r.hz = hz;
  let prof = skyProfiles();
  let sm = skySmooth(cov, hz, L, lift);
  // Gradient of the smooth field: xz through the coverage gradient, y analytic (plus the coverage change along the lean).
  let dfdc = (skySmooth(cov + 0.01, hz, L, lift).f - sm.f) * 100.0;
  let hUnit = max(L.top - sm.base, 1e-3) * shellH;
  let gp = select(L.bottom, sm.p * pow(max(sm.h, 1e-4), sm.p - 1.0), sm.h >= 0.0);
  var grad = vec3(dfdc * dcov.x, -gp / hUnit - dfdc * dot(skyLean(), dcov), dfdc * dcov.y);
  // P9-C2: the tall species' flanks bulge and neck (generate/shaders.ts towerShift; same noise, coordinates and seed). The view samples only:
  // the cheap light samples keep the smooth field. smf is the smooth field with the shift; its gradient is taken as the smooth one.
  var smf = sm.f;
  // Faded out over 6-12 km (times the LOD scale, as the billow octaves): further out a bulge is a few pixels and the noise is most of the cost.
  let towerLod = 1.0 - smoothstep(6000.0 * SKY.extra.z, 12000.0 * SKY.extra.z, lodDistance);
  // Q2: the skips below are measured on the smooth field, but the shift moves the surface outward by up to 1.5 TOWER_AMP metres (the bulge is
  // within +-1.5) and switches on over 48 m at its gate, which the smooth gradient does not see. Without this slack a skip from just outside
  // the gate jumped over the shifted flank: P9-C3's reach-bound skip cut a congestus tower's near flank away along a diagonal (Q2 item 0).
  var towerSlack = 0.0;
  if (prof && !alto && lodDistance >= 0.0 && towerLod > 0.0) {
    towerSlack = 1.5 * TOWER_AMP * towerLod * towerWeight((L.top - L.base) * shellH);
    if (sm.s > 0.0) { smf = sm.f + towerLod * towerShift(pm, u32(SKY.billow.z * 131.0) + 9u, (L.top - L.base) * shellH, length(grad.xz), gp / hUnit, sm.f, sm.h, sm.s); }
  }
  var f0 = smf;
  // Signed distance to the surface in smooth-field units (positive inside) and the gradient of that quantity.
  var fs = smf;
  let withBillow = lodDistance >= 0.0 && SKY.billow.x > 0.0;
  if (withBillow && smf > NEAR_A && smf < 0.5) {
    // NE p.102 (as the generator): thin clouds read the billow up to 40 m higher.
    let thick = pow(max(sm.s, 0.0), 1.0 / sm.p) * (L.top - sm.base) * shellH;
    let pmb = pm + vec3(0.0, 0.0, select(0.0, thinNoiseOffset(thick), prof));
    let seed = u32(SKY.billow.z * 131.0) + select(0u, 5u, alto);
    let A = SKY.billow.x * 3.0 * L.bAmp;
    // P9-B: times the owning cloud's billow weight (B), as the generator does: a small puff keeps a billow sized for it, not for a 1 km cloud.
    // P9-C: with the profile table the ceiling is the shell's top (the generator's volume top), so congestus tops billow.
    let ceiling = select(1.0 - smoothstep(0.82, 1.0, sm.h), 1.0 - smoothstep(select(0.88, 0.9, alto), 0.99, hz), prof);
    let topW = mix(0.45, 1.0, smoothstep(0.1, 0.7, sm.hcol)) * ceiling * wb;
    // P9-C2: the outward billow lifts a column by at most about half its height, as the generator (generate/shaders.ts BILLOW_LIFT).
    let ampW = A * topW;
    // P9-C3: the billow value is at most 0.64 (billowGrad: a - 0.36, a <= 1), so K <= kMax and the surface sits no higher than x_s(kMax) in
    // smooth-field units (x_s falls as K grows). Below it the sample is empty whatever the Worley octaves say: skip them, and step by the smooth
    // field's distance to that level (the global SKY_BILLOW_REACH below assumes the largest billow anywhere; a small puff's is much smaller).
    let kMax = select(0.64 * ampW, min(0.64 * ampW, BILLOW_LIFT * sm.p * max(sm.s, 0.0)), prof);
    let reach = surfaceF00(kMax);
    if (smf < reach - 0.005) {
      r.f = smf + kMax * nearRamp(smf);   // an upper bound of f0 (< 0): the layer union still prefers the other layer's cloud
      r.skip = max((reach - smf) / max(1.5 * length(grad), 1e-3) - towerSlack, 2.0);
      return r;
    }
    // P9-C3: a branch, not select(): select() evaluates both operands, so every in-line sun sample also ran the Worley octaves it meant to reuse.
    var b = given.b;
    if (!given.valid) { b = billowGrad(pmb, SKY.billow.y * L.bCell, seed, lodDistance, select(3u, 2u, alto)); }
    r.b = b;
    let K0 = b.w * ampW;
    let K = select(K0, min(K0, BILLOW_LIFT * sm.p * max(sm.s, 0.0)), prof);
    let freeK = K == K0;
    f0 = smf + K * nearRamp(smf);
    // The billow moves the surface to x_s(K) in smooth-field units; the distance is measured as f00 - x_s, whose gradient
    // is the smooth gradient plus the billow's through dx_s/db (implicit differentiation). Measuring f0 / |grad f0| instead
    // would scale the depth by the ramp's own derivative (up to 5x across the ramp): terraced rings on every lobe.
    let xs = surfaceF00(K);
    fs = smf - xs;
    let Fp = max(1.0 + K * dnearRamp(xs), 0.3);
    grad = grad + (nearRamp(xs) * select(0.0, ampW, freeK) / Fp) * vec3(b.x, b.z, b.y);
  } else if (withBillow && smf < SKY_BILLOW_REACH) {
    // Far outside the billow's reach: skip by the smooth field's distance to where the billow could first surface.
    r.f = f0;
    r.skip = max((SKY_BILLOW_REACH - smf) / max(1.5 * length(grad), 1e-3) - towerSlack, 4.0);
    return r;
  }
  r.f = f0;
  let gl = max(length(grad), 1e-4);
  if (fs <= 0.0 || sm.h >= 1.5) {
    // Empty: first-order distance to the surface, with slack for the gradient growing along the way.
    r.skip = max(-fs / max(1.5 * gl, 0.012) - towerSlack, 2.0);
    return r;
  }
  // Metres below the surface: the dome (top and sides) from the field, capped by the column's vertical distances to its base
  // surface (h = -s/bottom) and to its top (h = s_eff^(1/p), s_eff including the billow). The first-order estimate alone blows up
  // where the gradient vanishes, i.e. along the ridge of a thin skirt at a lobe's edge: those skirts rendered as dense slabs.
  let hBase = sm.h + sm.s / L.bottom;
  let hTop = pow(max(sm.s + (f0 - sm.f), 0.0), 1.0 / sm.p) - sm.h;
  let depth = max(min(fs / gl, min(hBase, hTop) * hUnit), 0.0);
  r.depth = depth;
  // The generator's PACK_FIT profile with its multiplicative depth noise (same noise, same coordinates and seed); the cheap
  // light samples skip the noise (it averages out along a light ray), the in-line ones reuse their view sample's (P9-C3).
  var dEff = depth;
  var patchN = 0.0;
  if (given.valid) {
    patchN = given.n.y;
    dEff = depth * exp(SKY.extra.y * given.n.x);
  } else if (lodDistance >= 0.0) {
    var n = clamp(profileNoise(pm, SKY.extra.x, u32(SKY.billow.z * 53.0)) * 3.4, -2.5, 2.5);
    // P9-C2: the generator's surface patches (generate/shaders.ts surfacePatch): profile depth law and detail flip, with the profile table.
    // (Near the camera only: beyond 4 km the layer's pixels are larger than the dimples the patches break up, and it saves the noise.)
    let patchW = 1.0 - smoothstep(2500.0, 4000.0, lodDistance);
    if (L.flip >= 0.0 && patchW > 0.0) { patchN = patchW * surfacePatch(pm, u32(SKY.billow.z * 53.0) + 31u); n = n + 1.2 * patchN; }
    dEff = depth * exp(SKY.extra.y * n);
    r.n = vec2(n, patchN);
  }
  // Q2 directional detail (generate/shaders.ts directionalDetail): the same law as the generator's profile pass, from the coverage gradient and the lean.
  let dirC = select(0.0, directionalDetail(sm.hcol, dcov, skyLean()), prof);
  let core = pow(clamp((dEff - 1.4) / (66.0 * exp(-DIR_RAMP * dirC)), 0.0, 1.0), 1.05);
  let liftP = 0.1 + 0.9 * smoothstep(0.0, 0.22, sm.hcol);
  let profile = max(core * liftP, 1.0 / 255.0);
  let scale = clamp(mix(SKY.shapeB.z, SKY.shapeB.w, smoothstep(0.0, 0.6, sm.hcol)) * L.scale, 0.0, 1.0);
  let hd = sm.hcol - 0.25 * clamp(depth / 32.0, 0.0, 1.0);
  var detail = clamp(smoothstep(0.1, 0.75, hd) + (g - 0.5) * SKY.shapeC.x, 0.0, 1.0);
  if (L.flip >= 0.0) { detail = detailFlip(hd, L.flip, patchN); }   // P9-C, NE p.99: the species' wispy-to-billowy flip height (P9-C2: patched)
  detail = clamp(detail + DIR_TYPE * dirC, 0.0, 1.0);
  r.m = vec3(profile, detail, scale);
  return r;
}

// H4 (S3): the low layer from the N3 s18 tables instead of the species height law. The column: min height = the species row's base (lifted toward the
// rim as the generator's), max height from the column's mass through the species' height law (s^(1/p) of the species depth: NE sets min and max
// height per column [NE p.20]; ours derives max height from the mass, so small clouds are low domes instead of full-height drums), and the table
// stretched so its top type's end lands on that max height (ext: the fraction of the table the top type fills). The NE dimensional profile
// P = coverage * top * bottom [N3 s18, NE p.29] is turned into a level set with the NE additive structure [N3 s24, NE p.34] and the generator's billow
// as the low-frequency noise: f = P + K - tau, K = the billow in [-0.6 P, BILLOW_LIFT * P]: its outward (cloud-making) part capped so nothing grows where the
// table is 0 (a flat, crisp base under bottom type 0; a billow-ragged one under the slow ramp of bottom type 1). The depth below that surface then goes
// through the same profile ramp, detail type and density scale as skyLayerAt, and the up-rez erodes it (skyDensityShaped).
fn skyTableAt(pm: vec3<f32>, hz: f32, shellH: f32, cov: f32, dcov: vec2<f32>, L: SkyRow, lift: f32, wb: f32, g: f32, lodDistance: f32, given: SkyGiven) -> SkyModel {
  var r: SkyModel;
  r.m = vec3(0.0); r.depth = 0.0; r.skip = 0.0; r.f = -1.0; r.b = vec4(0.0); r.n = vec2(0.0); r.empty2d = false; r.hz = hz;
  let thr = SKY.shapeB.x;
  let s = saturate((cov - thr) / (1.0 - thr));
  let ds = dcov / (1.0 - thr);
  let lean = skyLean();
  let tt = skyTopType(g);
  let bt = skyBottomType(pm.xy - lean * pm.z);
  let f0 = SKY.table.y;
  let ext = clamp((skyTableTop(tt) - f0) / (1.0 - f0), 0.05, 1.0);
  let base = L.base + lift * pow(1.0 - s, 1.5);
  let invP = 1.0 / max(L.p, 1.0);
  let depthFull = max((L.top - L.base) * shellH, 10.0);
  let hMax = pow(max(s, 0.02), invP);   // the column's max height (fraction of the species depth)
  let colM = depthFull * hMax / ext;
  let above = (hz - base) * shellH;      // metres above the column's min height
  let u = above / colM;
  // Under the column's min height the table is 0: skip by the vertical distance (less the slack of the neighbours' base lift).
  if (u < -0.02) { r.skip = max(-above - 0.02 * colM - 20.0, 2.0); return r; }
  if (u > ext + 0.02) {
    // Over this column's top: a neighbour with more mass reaches higher. Skip by the species law's field s - (above / depth)^p, whose surface is
    // the max height of every column, through its gradient (as skyLayerAt's empty skip), less slack for the billow on the neighbours' tops.
    let hf = above / depthFull;
    let fA = s - pow(hf, L.p);
    let gA = vec3(ds.x, -L.p * pow(hf, L.p - 1.0) / depthFull - dot(lean, ds), ds.y);
    r.skip = clamp(-fA / max(1.5 * length(gA), 1e-5) - 30.0, 2.0, 400.0);
    return r;
  }
  let tau = SKY.table.z;
  let du = (1.0 / 64.0) / (1.0 - f0);   // one table row in column units
  // The dimensional profile s * V, normalised by the column's peak for this type pair so a full-mass column peaks at its mass (the threshold then
  // keeps one footprint for every type); the unnormalised table value still says how full the cloud is (softT below).
  let pk = max(skyLut(2u, tt, (bt * 63.0 + 0.5) / 64.0), 0.05);
  let V = skyTableV(tt, bt, u) / pk;
  let Vu = skyTableV(tt, bt, u + du) / pk;
  let Vd = skyTableV(tt, bt, u - du) / pk;
  let P = s * V;
  let fs = P - tau;
  // Gradient of the smooth field per metre: horizontal through the coverage (directly, and through the max height: du/ds = -u / (p s)), vertical
  // through the table (and the coverage change along the lean).
  let dVdu = (Vu - Vd) / (2.0 * du);
  let dfds = V - select(0.0, u * dVdu * invP, s > 0.02);
  var grad = vec3(dfds * ds.x, s * dVdu / colM - dfds * dot(lean, ds), dfds * ds.y);
  let withBillow = lodDistance >= 0.0 && SKY.billow.x > 0.0;
  let A = SKY.billow.x * 3.0 * L.bAmp * wb;
  let liftCap = BILLOW_LIFT * P;
  let kMax = select(0.0, min(0.64 * A, liftCap), withBillow);
  if (fs + kMax < 0.0) {
    // No billow can reach the surface here: step by the smooth field's distance to the reach level (capped: the coverage gradient is local).
    r.f = fs + kMax;
    r.skip = clamp(-(fs + kMax) / max(1.5 * length(grad), 1e-4), 2.0, 40.0);
    return r;
  }
  var K = 0.0;
  if (withBillow) {
    var b = given.b;
    let pmb = pm + vec3(0.0, 0.0, thinNoiseOffset(ext * colM));   // NE p.102 (as skyLayerAt)
    if (!given.valid) { b = billowGrad(pmb, SKY.billow.y * L.bCell, u32(SKY.billow.z * 131.0), lodDistance, 3u); }
    r.b = b;
    // Capped both ways in proportion to P: outward so nothing grows where the table is 0, inward so a billow valley carves a small cloud but does
    // not delete it (the generator's billow is a surface displacement, not NE's density noise).
    let K0 = A * b.w;
    K = clamp(K0, -0.6 * P, liftCap);
    if (K == K0) { grad += A * vec3(b.x, b.z, b.y); }
  }
  let f = fs + K;
  r.f = f;
  let gl = max(length(grad), 1e-4);
  if (f <= 0.0) { r.skip = clamp(-f / (1.5 * gl), 2.0, 40.0); return r; }
  // Metres below the surface: first order, capped by the vertical distances to where the column's field runs out one table row up and down
  // (the first-order estimate blows up where the gradient vanishes: inside a thin sheet's plateau).
  let dm = du * colM;
  let fu = s * Vu + K - tau;
  let fd = s * Vd + K - tau;
  var depth = f / gl;
  if (fu < f) { depth = min(depth, f * dm / (f - fu)); }
  if (fd < f) { depth = min(depth, f * dm / (f - fd)); }
  r.depth = depth;
  let hcol = clamp(u / ext, 0.0, 1.0);
  // The profile's depth noise and surface patches, as skyLayerAt.
  var dEff = depth;
  var patchN = 0.0;
  if (given.valid) {
    patchN = given.n.y;
    dEff = depth * exp(SKY.extra.y * given.n.x);
  } else if (lodDistance >= 0.0) {
    var n = clamp(profileNoise(pm, SKY.extra.x, u32(SKY.billow.z * 53.0)) * 3.4, -2.5, 2.5);
    let patchW = 1.0 - smoothstep(2500.0, 4000.0, lodDistance);
    if (L.flip >= 0.0 && patchW > 0.0) { patchN = patchW * surfacePatch(pm, u32(SKY.billow.z * 53.0) + 31u); n = n + 1.2 * patchN; }
    dEff = depth * exp(SKY.extra.y * n);
    r.n = vec2(n, patchN);
  }
  let dirC = directionalDetail(hcol, dcov, lean);
  let core = pow(clamp((dEff - 1.4) / (66.0 * exp(-DIR_RAMP * dirC)), 0.0, 1.0), 1.05);
  // The table's own softness instead of the generator's base lift: where the vertical profile is low (the slow ramp of a ragged bottom type, a
  // thin top) the up-rez profile stays low, so the erosion reaches deeper there; where the table rises fast (bottom type 0) the base is full right
  // away. The table value, not times the mass: the rims already get their softness from the depth ramp, as in skyLayerAt.
  let softT = 0.15 + 0.85 * smoothstep(0.02, 0.45, V * pk);
  let profile = max(core * softT, 1.0 / 255.0);
  let scale = clamp(mix(SKY.shapeB.z, SKY.shapeB.w, smoothstep(0.0, 0.6, hcol)) * L.scale, 0.0, 1.0);
  let hd = hcol - 0.25 * clamp(depth / 32.0, 0.0, 1.0);
  var detail = clamp(smoothstep(0.1, 0.75, hd) + (g - 0.5) * SKY.shapeC.x, 0.0, 1.0);
  if (L.flip >= 0.0) { detail = detailFlip(hd, L.flip, patchN); }
  detail = clamp(detail + DIR_TYPE * dirC, 0.0, 1.0);
  r.m = vec3(profile, detail, scale);
  return r;
}

fn skyModelB(p0: vec3<f32>, lodDistance: f32, light: bool, given: SkyGiven) -> SkyModel {
  var r: SkyModel;
  r.m = vec3(0.0); r.depth = 0.0; r.skip = 0.0; r.f = -1.0; r.b = vec4(0.0); r.n = vec2(0.0); r.empty2d = false;
  let shellH = max(SKY.shell.y - SKY.shell.x, 1.0);
  // Planet curvature: the shell drops away from the box centre.
  let c = p0.xz - (SKY.box.xy + SKY.box.zw * 0.5);
  let p = vec3(p0.x, p0.y + SKY.shell.w * dot(c, c), p0.z);
  r.hz = (p.y - SKY.shell.x) / shellH;
  if (r.hz < -0.02 || r.hz > 1.02) { r.skip = 4.0; return r; }
  let wuv = (p.xz - skyLean() * (p.y - SKY.shell.x) - SKY.window.xy) / SKY.window.zw;
  if (any(wuv <= vec2(0.0)) || any(wuv >= vec2(1.0))) { r.skip = 2000.0; return r; }
  // Box handoff (view rays only): the wall is at the sample's own position, not at the leaned weather read.
  let bmax = SKY.box.xy + SKY.box.zw;
  let e = min(min(p.x - SKY.box.x, bmax.x - p.x), min(p.z - SKY.box.y, bmax.y - p.z));
  let rim = SKY.shapeC.y;
  var rimFade = 1.0;
  var densW = 1.0;
  if (!light) {
    if (rim > 0.0) {
      if (e > rim) { r.skip = e - rim; return r; }
      rimFade = 1.0 - smoothstep(0.0, rim, e);
    } else if (rim == 0.0 && e > SKY.species.w) {
      r.skip = e - SKY.species.w; return r;   // hard partition: the voxel march renders the inside, the first sample past the wall is ours
    } else if (rim == 0.0 && e > 0.0) {
      // P9-C2 density hand-off (sheets): the same field, its density fading out over species.w metres into the box while the voxel field's fades in.
      densW = 1.0 - smoothstep(0.0, SKY.species.w, e);
    }
  }
  // Coverage: the bilinear value from the sampler. P9-C2: its gradient is the difference of two more bilinear samples one texel along x and
  // along z (all four channels at once), so it is continuous. The gradient of the bilinear interpolant itself (P9-C, from a gather) is
  // constant across a texel and jumps at every texel edge, and the depth below the surface (f / |grad f|) jumped with it: on the steep walls
  // of the tall species those jumps ran up the wall as vertical streaks, and on gentle slopes they drew contour rings.
  let dims = vec2<f32>(textureDimensions(skyWeather, 0));
  let texel = SKY.window.zw / dims;
  let w = textureSampleLevel(skyWeather, skySampler, wuv, 0.0);
  let edgeW = min(min(wuv.x, 1.0 - wuv.x), min(wuv.y, 1.0 - wuv.y));
  let fade = smoothstep(0.0, max(SKY.shapeC.w, 1e-4), edgeW) * rimFade;
  let cov = w.r * fade;
  // P9-C: the upper (altocumulus) layer's mass is the weather's A.
  let covA = select(0.0, w.a * fade, skyAltoOn());
  let thr = SKY.shapeB.x;
  if (cov <= thr && covA <= thr) { r.skip = max((thr - max(cov, covA)) * 80.0, 2.0); r.empty2d = true; return r; }   // the caller skips further through the coverage mips
  let pm = vec3(p.x - SKY.wOrigin.x, p.z - SKY.wOrigin.y, p.y - SKY.shell.x);
  var out = r;
  out.skip = max((thr - cov) * 80.0, 2.0);
  var have = false;
  let wdx = textureSampleLevel(skyWeather, skySampler, wuv + vec2(1.0 / dims.x, 0.0), 0.0) - w;
  let wdz = textureSampleLevel(skyWeather, skySampler, wuv + vec2(0.0, 1.0 / dims.y), 0.0) - w;
  if (cov > thr) {
    let dcov = vec2(wdx.r, wdz.r) * fade / texel;   // per metre (x, z)
    if (skyTableOn()) { out = skyTableAt(pm, r.hz, shellH, cov, dcov, skyRow(w.g, shellH), SKY.shapeA.w, w.b, w.g, lodDistance, given); }   // H4
    else { out = skyLayerAt(pm, r.hz, shellH, cov, dcov, skyRow(w.g, shellH), SKY.shapeA.w, select(1.0, w.b, SKY.shapeB.y > 0.5), w.g, false, lodDistance, given); }
    have = true;
  }
  if (covA > thr) {
    let dcov = vec2(wdx.a, wdz.a) * fade / texel;
    let a = skyLayerAt(pm, r.hz, shellH, covA, dcov, skyAltoRow(), 0.5 * SKY.shapeA.w, 1.0, 0.5, true, lodDistance, given);
    // The voxel belongs to the layer whose field is larger (the generator's union); empty in both, skip by the nearer one.
    let bothEmpty = !(a.m.x > 0.0) && !(out.m.x > 0.0);
    let skip = min(a.skip, out.skip);
    if (!have || a.f > out.f) { out = a; }
    if (bothEmpty) { out.skip = skip; }
  }
  out.hz = r.hz;
  out.m.z = out.m.z * densW;
  return out;
}

// The cheap term (profile * density scale) of the smooth field, the one the voxel light grid sums.
fn skyModelCheap(p: vec3<f32>) -> f32 {
  let sm = skyModel(p, -1.0, true);
  return sm.m.x * sm.m.z;
}

// Empty-space skip through the coverage maxima mips (levels 1..SKY_MIP_TOP of the weather window hold the max of their 2x2):
// the largest texel around p whose maximum coverage is under the threshold is cloud-free, so the ray can jump to its far side
// (in xz; the shell is thin). Returns 0 when no such texel exists. Bilinear sampling at level 0 reads half a fine texel beyond
// the border, hence the margin.
const SKY_MIP_TOP = 6;
fn skyEmptySkip(p: vec3<f32>, dir0: vec3<f32>) -> f32 {
  // In the leaned frame the weather read point moves along dir.xz - lean * dir.y (the lean is linear in height), so the texel exit is exact there.
  let q = p.xz - skyLean() * (p.y - SKY.shell.x);
  let dq = dir0.xz - skyLean() * dir0.y;
  let dir = vec3(dq.x, 0.0, dq.y);
  let wuv = (q - SKY.window.xy) / SKY.window.zw;
  if (any(wuv <= vec2(0.0)) || any(wuv >= vec2(1.0))) { return 0.0; }
  let dims0 = vec2<i32>(textureDimensions(skyWeather, 0));
  let thr = SKY.shapeB.x;
  let texel0 = SKY.window.zw / vec2<f32>(dims0);
  for (var k = SKY_MIP_TOP; k >= 1; k--) {
    let dims = max(dims0 >> vec2<u32>(u32(k)), vec2<i32>(1));
    let tc = clamp(vec2<i32>(floor(wuv * vec2<f32>(dims))), vec2<i32>(0), dims - vec2<i32>(1));
    let mx = textureLoad(skyWeather, tc, k);
    if (max(mx.r, select(0.0, mx.a, skyAltoOn())) <= thr) {
      let texel = SKY.window.zw / vec2<f32>(dims);
      let lo = SKY.window.xy + vec2<f32>(tc) * texel;
      let hi = lo + texel;
      var t = 1.0e9;
      if (dir.x > 1e-6) { t = min(t, (hi.x - q.x) / dir.x); } else if (dir.x < -1e-6) { t = min(t, (lo.x - q.x) / dir.x); }
      if (dir.z > 1e-6) { t = min(t, (hi.y - q.y) / dir.z); } else if (dir.z < -1e-6) { t = min(t, (lo.y - q.y) / dir.z); }
      return max(t - 0.75 * max(texel0.x, texel0.y), 0.0);
    }
  }
  return 0.0;
}

`;

export function skyLayerWgsl(mode: 'atmosphere' | 'uniform'): string {
  const atm = mode === 'atmosphere';
  return /* wgsl */ `
${FRAME_WGSL}
${SKY_PARAMS_WGSL}
@group(1) @binding(${SKY_COLOR_BINDING}) var skyColorOut: texture_storage_2d<rgba16float, write>;
@group(1) @binding(${SKY_DEPTH_BINDING}) var skyDepthOut: texture_storage_2d<rgba32float, write>;
@group(1) @binding(${SKY_WEATHER_BINDING}) var skyWeather: texture_2d<f32>;
@group(1) @binding(${SKY_SAMPLER_BINDING}) var skySampler: sampler;
@group(1) @binding(${SKY_LIGHT_STORAGE_BINDING}) var<storage, read> skyLight: array<vec4<f32>, ${SKY_LIGHT_ENTRIES}>;
${SUN_HEIGHT_WGSL}
@group(1) @binding(${SKY_PARAMS_BINDING}) var<uniform> SKY: SkyParams;
@group(1) @binding(${SKY_BACK_BINDING}) var skyBackOut: texture_storage_2d<rgba16float, write>;
${atm ? atmosphereWgsl(MARCH_ATMOSPHERE_GROUP) : ''}
${LIGHTING_WGSL}
${BILLOW_WGSL}

const SKY_HALTON_BASE = 1u;
const SKY_SUBPIXEL_SPAN = 2.0;   // jitter range in layer pixels
fn radicalInverse(i0: u32, base: u32) -> f32 {
  var i = i0; var f = 1.0; var r = 0.0;
  let b = f32(base);
  for (var k = 0; k < 8 && i > 0u; k++) { f = f / b; r += f * f32(i % base); i = i / base; }
  return r;
}
// Cheap sun samples beyond the in-line ones (segment midpoints and lengths, metres from the sample), then the 'up' ones.
const SKY_SUN_T = array<f32, 6>(64.0, 100.0, 145.0, 205.0, 285.0, 400.0);
const SKY_SUN_L = array<f32, 6>(32.0, 40.0, 50.0, 70.0, 90.0, 140.0);
const SKY_UP_T = array<f32, 3>(24.0, 80.0, 192.0);
const SKY_UP_L = array<f32, 3>(48.0, 64.0, 160.0);
const SKY_LIGHT_MIN_OPTICAL_DEPTH = 2.0e-3;
const SKY_LIGHT_REFRESH_M = 24.0;      // lighting varies slowly along the ray: re-evaluate every (24 m + 3% of the distance)
const SKY_LIGHT_REFRESH_REL = 0.03;
const SKY_MICRO_NEAR = 700.0;   // Q2: metres; the near micro shadow fades out over 0.7-1.4 km (further out it shows the noise tile as a regular weave)
${SKY_FIELD_WGSL}
/**
 * H4 (S4): the up-rez with a selectable erosion law (SKY.erosion.x). 0 is cloudDensityShaped itself (the voxel march's N3 law, ValueErosion). The
 * others replace only the erosion line [shape.md §4]; the noise composite, the HHF fold, the density-scale chain and the near fade are the same:
 *   1 HZD additive   sat(n' - (1 - P)) with n' = 1 - composite [N3 s24, NE p.34]: the N3 channels are tuned for ValueErosion (high = more erosion,
 *                    billows scaled 0.3), so the additive law, where high noise means more cloud, reads them inverted. Same zero set as
 *                    ValueErosion, but the core keeps the noise (1 - n) instead of going flat to 1.
 *   2 Nubis Evolved  the same additive erosion with NE's own sharpening, pow(.., 0.27) [NE p.105], in place of N3's pow(d, lerp(0.3, 0.6, S^4))
 *                    (S^4 still scales the density). Ours: NE prints the 0.27 for its envelope model; the vertical-profile model's is not shown.
 *   3 additive raw   sat(n - (1 - P)) with the composite as it is (the sign check shape.md asks for: the core reads as negative space).
 */
fn skyDensityShaped(p: vec3<f32>, rayDistance: f32, inputs: DensityInputs, modeling: vec3<f32>, hFrac: f32) -> vec2<f32> {
  let law = u32(SKY.erosion.x + 0.5);
  if (law == 0u) { return cloudDensityShaped(p, rayDistance, inputs, modeling, hFrac); }
  let profile = modeling.x;
  let type_ = modeling.y * (1.0 - inputs.wispyBias * (1.0 - hFrac) * (1.0 - hFrac));
  let densityScale = modeling.z;
  if (!(profile > 0.0)) { return vec2(0.0); }
  let hf = inputs.hfDetails != 0u;
  let mip = log2(1.0 + abs(rayDistance * inputs.mipDistanceScale)) + inputs.baseMip;
  let n = textureSampleLevel(cloudNoise, repeatSampler, (p - inputs.wind) * cloudVolume.noiseScale, mip);
  let wispy = mix(n.r, n.g, profile);
  let billowy = mix(n.b * 0.3, n.a * 0.3, sqrt(sqrt(profile)));
  var noiseComposite = mix(wispy, billowy, type_);
  if (hf) {
    let tg = abs(abs(n.g * 2.0 - 1.0) * 2.0 - 1.0);
    let ta = abs(abs(n.a * 2.0 - 1.0) * 2.0 - 1.0);
    let tg2 = tg * tg;
    let hhf = saturate(mix(1.0 - tg2 * tg2, ta * ta, type_));
    noiseComposite = mix(hhf, noiseComposite, valueRemap(rayDistance, 50.0, 150.0, 0.9, 1.0));
  }
  noiseComposite = saturate(noiseComposite * (1.0 + inputs.detailBias));
  let ds2 = saturate(densityScale) * saturate(densityScale);
  let poweredScale = ds2 * ds2;
  var d = 0.0;
  if (law == 3u) { d = saturate(noiseComposite - (1.0 - profile)); }
  else { d = saturate((1.0 - noiseComposite) - (1.0 - profile)); }
  if (law == 2u) {
    d = pow(d, 0.27) * poweredScale;
  } else {
    d = d * poweredScale;
    d = pow(d, mix(0.3, 0.6, max(EPSILON, poweredScale)));
  }
  if (hf) {
    let f = fractionFromValue(rayDistance, 50.0, 150.0);
    d = pow(d, mix(0.5, 1.0, f)) * mix(0.666, 1.0, f);
  }
  return vec2(d * valueRemap(rayDistance, 10.0, 120.0, 0.25, 1.0), profile * densityScale);
}
// Full up-rez density at a light-sample point (the in-line sun samples: the surface detail matters there).
fn skyDensityLight(p: vec3<f32>, rayDistance: f32, inputs: DensityInputs, view: SkyModel) -> f32 {
  let sm = skyModelB(p, rayDistance, true, SkyGiven(view.b, view.n, true));
  if (!(sm.m.x > 0.0)) { return 0.0; }
  return skyDensityShaped(p, rayDistance, inputs, sm.m, saturate(sm.hz)).x;
}
fn heat(x0: f32) -> vec3<f32> {
  let x = saturate(x0);
  return vec3(smoothstep(0.25, 0.6, x), smoothstep(0.0, 0.35, x) * (1.0 - smoothstep(0.7, 1.0, x)), 1.0 - smoothstep(0.1, 0.5, x));
}

// One premultiplied layer being accumulated (front of the box, or behind it).
// depthSum / depthSqSum: the opacity-weighted first and second moments of the sample distance (C2, Ghost of Yotei: mean and mean square).
struct Part { rad: vec3<f32>, T: f32, depthSum: f32, depthSqSum: f32, weightSum: f32, depthMax: f32 }
fn partInit() -> Part { return Part(vec3(0.0), 1.0, 0.0, 0.0, 0.0, 0.0); }

@compute @workgroup_size(8, 8)
fn trace(@builtin(global_invocation_id) gid: vec3<u32>) {
  let full = SKY.temporal.z > 0.5;
  var px = vec2<i32>(gid.xy);
  if (!full) { px = px * 4 + bayerPos(u32(SKY.temporal.x)); }
  if (any(vec2<f32>(px) >= frame.renderSize)) { return; }
  let uv = (vec2<f32>(px) + 0.5) / frame.renderSize;
  let sceneEnd = skySceneEnd(px, uv);

  let origin = frame.cameraPos;
  // P7-E: the pixel is point-sampled at a Halton offset that changes every cycle, so the resolved history converges to the average over
  // the layer pixel instead of one point per pixel: thin stacked layers near the horizon (sub-pixel in height) otherwise alias to bricks.
  let subPx = (vec2<f32>(radicalInverse(SKY_HALTON_BASE + u32(SKY.temporal.y) % 16u, 2u), radicalInverse(SKY_HALTON_BASE + u32(SKY.temporal.y) % 16u, 3u)) - 0.5) * SKY_SUBPIXEL_SPAN;
  let dir = normalize(unprojectDepth((vec2<f32>(px) + 0.5 + select(subPx, vec2<f32>(0.0), SKY.billow.w == 6.0)) / frame.renderSize, 1.0) - origin);
  // Shell: slab between shell.x and shell.y. (Curvature is applied to the sample, not the slab: it is a few tens of metres.)
  var t0 = 0.0;
  var t1 = SKY.shell.z;
  if (abs(dir.y) > 1e-5) {
    let ta = (SKY.shell.x - origin.y) / dir.y;
    let tb = (SKY.shell.y - origin.y) / dir.y;
    t0 = max(0.0, min(ta, tb));
    t1 = min(t1, max(ta, tb));
  } else if (origin.y < SKY.shell.x || origin.y > SKY.shell.y) {
    t1 = -1.0;
  }
  let tEnd = min(t1, sceneEnd);
  // Samples before the ray enters the voxel box belong to the front layer, the rest to the back layer. P9-C2: the split is taken from the pixel's
  // centre ray, not the jittered one. The history averages the jitter, and where the jitter moved a surface from one part to the other (along every
  // box edge seen across a sheet) the composite of the averaged parts (front over voxel over back) let the background through: a dark line.
  let iv = volumeRayInterval(origin, normalize(unprojectDepth((vec2<f32>(px) + 0.5) / frame.renderSize, 1.0) - origin));
  let tSplit = select(FAR_T, 0.5 * (max(iv.x, 0.0) + iv.y), iv.x <= iv.y && iv.y > 0.0);

  var front = partInit();
  var back = partInit();
  var T = 1.0;

  if (t0 < tEnd) {
    let dbg = u32(SKY.billow.w);
    // The jitter changes every amortization cycle: the resolved history converges to the jitter average.
    var jitter = ign(vec2<f32>(px), u32(SKY.temporal.y));
    if (dbg == 6u) { jitter = 0.5; }
    var firstHit = -1.0; var firstF = 0.0; var firstCov = 0.0; var stepsUsed = 0u; var firstTau = -1.0; var firstUp = 0.0;
    let cosSun = dot(dir, frame.sunDir);
    let phase = cloudPhase(cosSun);
    let sunRelax = valueRemap(cosSun, 0.0, 0.9, 0.0, 1.0);
    let frontness = (1.0 - smoothstep(-0.6, 0.1, cosSun));
    let ambientUp = skyLight[1].xyz;
    let ambientDown = skyLight[2].xyz;
    let envUp = skyLight[5].xyz;
    let envDown = skyLight[6].xyz;
    let sunInline0 = frame.sunDir * (0.5 * INLINE_NEAR);
    let sunInline1 = frame.sunDir * (0.5 * (INLINE_NEAR + INLINE_FAR));
    let ext = frame.extinction * SKY.shapeC.z;
    // C2: a low sun crosses the shell nearly horizontally, so the path through a cloud toward it is about depth / sin(elevation): the cheap sun samples
    // (48..470 m at and above 45 degrees) stretch with 1 / sin(elevation), up to 4x at 10 degrees and below. Without it, sunset cumulus out here saw only
    // the first 470 m of a 1-2 km path, so the whole far field lit up like a rim: a bright speckled band along the horizon.
    let sunReach = clamp(0.7071 / max(dot(frame.sunDir, vec3(0.0, 1.0, 0.0)), 0.01), 1.0, 4.0);
    // Same up-rez inputs as the voxel march (Q2: with its erosion bias, which the layer had left at 0: softer, rounder clouds than the voxel field
    // next to them); the high-frequency fold is a near-camera detail (rayDistance < 150 m only).
    let inputs = DensityInputs(frame.wind, frame.mipDistanceScale, frame.baseMip, 0u, frame.wispyBias, frame.detailBias, frame.uprez);
    let maxSteps = u32(SKY.steps.z);
    var capped = true;
    var t = t0;
    var litT = -1.0e9;
    var lit = vec3(0.0);
    for (var i = 0u; i < maxSteps; i++) {
      if (t >= tEnd || T < SKY.steps.w) { capped = false; break; }
      var step = SKY.steps.x + SKY.steps.y * t;
      // One jittered sample per step: the sample position stands for the whole step.
      let ts = t + jitter * step;
      let ps = origin + dir * ts;
      let sp = skyModel(ps, select(ts, -1.0, dbg == 4u), false);
      stepsUsed = i + 1u;
      if (sp.m.x > 0.0) {
        if (firstHit < 0.0) { firstHit = ts; firstF = sp.depth; firstCov = sp.m.x; }
        let ds = min(step, tEnd - t);
        if (ts < tEnd) {
          let d = skyDensityShaped(ps, ts, inputs, sp.m, saturate(sp.hz));
          if (d.x > 0.0) {
            // Fade out toward the end of the range so the layer does not end on a line.
            let fade = 1.0 - smoothstep(0.75 * SKY.shell.z, SKY.shell.z, ts);
            let sigma = d.x * ext * fade;
            let stepT = exp(-sigma * ds);
            if (sigma * ds > SKY_LIGHT_MIN_OPTICAL_DEPTH) {
              // Q2: near the camera (the puffs overhead) the light is evaluated at every step with the march's billow-scale micro shadow (below).
              let nearW = select(0.0, 1.0 - smoothstep(SKY_MICRO_NEAR, 2.0 * SKY_MICRO_NEAR, ts), frame.microDist > 0.0);
              if (nearW > 0.0 || ts - litT > SKY_LIGHT_REFRESH_M + SKY_LIGHT_REFRESH_REL * ts) {
                litT = ts;
                let d0 = skyDensityLight(ps + sunInline0, ts, inputs, sp);
                let d1 = skyDensityLight(ps + sunInline1, ts, inputs, sp);
                let tauInline = (d0 * INLINE_NEAR + d1 * (INLINE_FAR - INLINE_NEAR)) * ext;
                var sunFar = 0.0;
                for (var k = 0; k < 6; k++) { sunFar += skyModelCheap(ps + frame.sunDir * (SKY_SUN_T[k] * sunReach)) * (SKY_SUN_L[k] * sunReach); }
                var gridUp = 0.0;
                for (var k = 0; k < 3; k++) { gridUp += skyModelCheap(ps + vec3(0.0, SKY_UP_T[k], 0.0)) * SKY_UP_L[k]; }
                let tau = tauInline + sunFar * ext * frame.lightDensityScale;
                if (firstTau < 0.0) { firstTau = tau; firstUp = gridUp * ext * frame.lightDensityScale * frame.ambientExtinction; }
                // C2: the glow terms' sun-side occlusion, as the voxel march's Q-1 microOcc but from the smooth field (the cheap term INLINE_NEAR / 2 toward
                // the sun, over INLINE_NEAR): the up-rezzed density there aliased into a herringbone at the layer's quarter resolution. Without it (1.0)
                // the far field's glow was never occluded, so every distant cloud glowed like a thin rim: brighter than the voxel clouds next to it and a
                // bright speckled band along the horizon toward a low sun.
                var microTau = skyModelCheap(ps + sunInline0) * INLINE_NEAR * ext;
                // Q2: near the camera, the voxel march's Q-1 term: the full up-rezzed density microDist toward the sun plus the first in-line sample.
                // It resolves the lobes' own shadow sides (the near puffs read as smooth potatoes without it); further out it aliased (C2), so it fades.
                if (nearW > 0.0) {
                  let dm = skyDensityLight(ps + frame.sunDir * (0.5 * frame.microDist), ts, inputs, sp);
                  microTau = mix(microTau, (dm * frame.microDist + d0 * (INLINE_NEAR - frame.microDist)) * ext, nearW);
                }
                let microOcc = exp(-frame.microShadow * microTau);
                // Same arguments as the voxel march: the cheap term (profile * scale) as the in-scatter probability, -depth as the sdf.
                if (octaveOn()) { lit = cloudOctaveLight(tau, cosSun, saturate(sp.hz), sigma, sunRadianceAtHeight(ps.y), ambientUp, ambientDown, envUp, envDown, OCTAVE_DEFAULT, octaveVoxel()); }
                else { lit = cloudInScatterMicro(sp.m.x * sp.m.z, -sp.depth, saturate(sp.hz), tau, gridUp * ext, phase, sunRelax, sunRadianceAtHeight(ps.y), ambientUp, ambientDown, envUp, envDown, microOcc); }
              }
              if (ts < tSplit) {
                let w = front.T * (1.0 - stepT);
                front.rad += lit * w; front.depthSum += ts * w; front.depthSqSum += ts * ts * w; front.weightSum += w; front.depthMax = max(front.depthMax, sp.depth);
              } else {
                let w = back.T * (1.0 - stepT);
                back.rad += lit * w; back.depthSum += ts * w; back.depthSqSum += ts * ts * w; back.weightSum += w; back.depthMax = max(back.depthMax, sp.depth);
              }
            }
            if (ts < tSplit) { front.T *= stepT; } else { back.T *= stepT; }
            T = front.T * back.T;
          }
        }
      } else {
        step = max(step, sp.skip);
        if (sp.empty2d && dbg != 9u) { step = max(step, skyEmptySkip(ps, dir) - jitter * step); }
      }
      t += step;
    }
    // Ran out of steps with cloud left, or hit the cutoff: close the part being marched. Below the cutoff the remaining light
    // continues as the mean colour of what was accumulated, so the cutoff neither darkens nor brightens the ray.
    let inBack = t >= tSplit;
    if (capped && t < tEnd && T < 0.3) { if (inBack) { back.T = 0.0; } else { front.T = 0.0; } }
    if (T < SKY.steps.w) {
      if (inBack) { back.rad /= max(1.0 - back.T, 0.5); back.T = 0.0; } else { front.rad /= max(1.0 - front.T, 0.5); front.T = 0.0; }
    }
    // One edge factor for the whole ray (P9-C2): per part, a split falling just under a surface gave the front part a small depthMax and so a
    // different edge factor, a thin line along every box edge seen across a sheet (stratus from above).
    let edge = select(cloudEdgeFactor(max(front.depthMax, back.depthMax), frontness), 1.0, octaveOn());
    front.rad *= edge;
    back.rad *= edge;
    if (dbg != 0u && dbg != 4u && dbg != 6u) {
      let k = max(ambientUp.x + ambientUp.y + ambientUp.z, 1e-3);
      var c = vec3(0.0);
      if (dbg == 1u) { c = select(vec3(0.0, 0.0, 0.3), heat(firstHit / 6000.0), firstHit >= 0.0); }
      else if (dbg == 2u) { c = heat(f32(stepsUsed) / SKY.steps.z); }
      else if (dbg == 3u) { c = heat(max(front.depthMax, back.depthMax) / 120.0); }
      else if (dbg == 5u) { c = vec3(firstCov); }
      else if (dbg == 7u) { c = heat(firstF / 60.0); }
      else if (dbg == 10u) { c = heat(firstTau / 6.0); }
      else if (dbg == 11u) { c = heat(firstUp / 6.0); }
      front.rad = c * k; front.T = select(1.0, 0.0, firstHit >= 0.0 || dbg == 2u);
      back = partInit();
    }
  }

  let meanFront = select(0.0, front.depthSum / max(front.weightSum, 1e-6), front.weightSum > 1e-3);
  let meanBack = select(0.0, back.depthSum / max(back.weightSum, 1e-6), back.weightSum > 1e-3);
${atm ? `  if (meanFront > 0.0 && frame.lightDebug < 0.5) {
    front.rad = applyHorizonHaze(applyAerialPerspective(front.rad, front.T, dir, meanFront), front.T, origin, dir, meanFront, frame.haze);
  }
  if (meanBack > 0.0 && frame.lightDebug < 0.5) {
    back.rad = applyHorizonHaze(applyAerialPerspective(back.rad, back.T, dir, meanBack), back.T, origin, dir, meanBack, frame.haze);
  }` : ''}
  front.rad = clamp(front.rad, vec3(0.0), vec3(${MARCH_RADIANCE_LIMIT}.0));
  back.rad = clamp(back.rad, vec3(0.0), vec3(${MARCH_RADIANCE_LIMIT}.0));
  textureStore(skyColorOut, px, vec4(front.rad, front.T));
  textureStore(skyBackOut, px, vec4(back.rad, back.T));
  // C2: the whole ray's opacity distribution along the view ray (both parts): its mean and spread let the composite keep the share of the cloud
  // in front of a surface instead of an all-or-nothing test at one distance (Ghost of Yotei stores mean and mean square for the same reason).
  let wAll = front.weightSum + back.weightSum;
  var meanAll = 0.0;
  var spread = 0.0;
  if (wAll > 1e-3) {
    meanAll = (front.depthSum + back.depthSum) / wAll;
    spread = sqrt(max((front.depthSqSum + back.depthSqSum) / wAll - meanAll * meanAll, 0.0));
  }
  textureStore(skyDepthOut, px, vec4(select(meanBack, meanFront, meanFront > 0.0), sceneEnd, meanAll, spread));
}
`;
}

/**
 * Resolve: every layer pixel, from the fresh trace samples and the reprojected history. Needs COMMON_WGSL in front.
 * Group 1: 0 Frame, 1 scene depth, then SKY_RESOLVE_BINDINGS. Writes the new history, which the host copies to the composite's
 * targets (the default limit is four storage textures per stage).
 */
export const SKY_RESOLVE_WGSL = /* wgsl */ `
${FRAME_WGSL}
${SKY_PARAMS_WGSL}
@group(1) @binding(${SKY_RESOLVE_BINDINGS.trace}) var traceColor: texture_2d<f32>;
@group(1) @binding(${SKY_RESOLVE_BINDINGS.traceDepth}) var traceDepth: texture_2d<f32>;
@group(1) @binding(${SKY_RESOLVE_BINDINGS.hist}) var histColor: texture_2d<f32>;
@group(1) @binding(${SKY_RESOLVE_BINDINGS.histDepth}) var histDepth: texture_2d<f32>;
@group(1) @binding(${SKY_RESOLVE_BINDINGS.histOut}) var histColorOut: texture_storage_2d<rgba16float, write>;
@group(1) @binding(${SKY_RESOLVE_BINDINGS.histDepthOut}) var histDepthOut: texture_storage_2d<rgba32float, write>;
@group(1) @binding(${SKY_RESOLVE_BINDINGS.params}) var<uniform> SKY: SkyParams;
@group(1) @binding(${SKY_RESOLVE_BINDINGS.sampler}) var histSampler: sampler;
@group(1) @binding(${SKY_RESOLVE_BINDINGS.traceBack}) var traceBack: texture_2d<f32>;
@group(1) @binding(${SKY_RESOLVE_BINDINGS.histBack}) var histBack: texture_2d<f32>;
@group(1) @binding(${SKY_RESOLVE_BINDINGS.histBackOut}) var histBackOut: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn resolve(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(vec2<f32>(gid.xy) >= frame.renderSize)) { return; }
  let px = vec2<i32>(gid.xy);
  let uv = (vec2<f32>(gid.xy) + 0.5) / frame.renderSize;
  let sceneEnd = skySceneEnd(px, uv);
  let size = vec2<i32>(frame.renderSize);
  let hi = size - vec2<i32>(1);
  let full = SKY.temporal.z > 0.5;
  let phase = u32(SKY.temporal.x);
  let fresh = full || bayerIndex(px) == phase;
  // This frame's fresh sample of the pixel's own 4x4 block (the pixel itself when fresh).
  let b0 = (px / 4) * 4;
  let bp = bayerPos(phase);
  let freshPx = select(b0 + bp, px, fresh);
  let tc = textureLoad(traceColor, freshPx, 0);
  let tb = textureLoad(traceBack, freshPx, 0);
  let tdv = textureLoad(traceDepth, freshPx, 0);
  let td = tdv.x;
  var dist4 = tdv.zw;
  var out = tc;
  var outB = tb;
  var dist = td;
  if (!full) {
    // Neighbourhood of the nine fresh samples around this block (front layer only: the back layer is far, and its reprojection
    // error is below a texel). Variance clipping (mean +- 1.5 sigma) rather than min/max: it rejects a history that no longer
    // matches the scene (a ghost) but tolerates the normal spread, so it does not stamp 4x4 blocks during motion.
    var m1 = vec4(0.0); var m2 = vec4(0.0);
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let q = clamp(b0 + vec2<i32>(dx, dy) * 4 + bp, vec2<i32>(0), hi);
        let c = textureLoad(traceColor, q, 0);
        m1 += c; m2 += c * c;
      }
    }
    let mean = m1 / 9.0;
    let sigma = sqrt(max(m2 / 9.0 - mean * mean, vec4(0.0)));
    let lo = mean - 1.5 * sigma;
    let hi4 = mean + 1.5 * sigma;
    // Reproject through the cloud mean distance (the block's fresh sample, else the old history, else far away).
    let dir = normalize(unprojectDepth(uv, 1.0) - frame.cameraPos);
    var rd = td;
    let hd0 = textureLoad(histDepth, px, 0).x;
    if (rd <= 0.0) { rd = hd0; }
    if (rd <= 0.0) { rd = 1.0e5; }
    // C2: the cloud moved with the wind since last frame: its history is where it was, one displacement back. cloudMotion.w = 0: the camera-only path.
    let cloudShift = select(vec3(0.0), SKY.cloudMotion.xyz, SKY.cloudMotion.w > 0.5);
    let clip = SKY.prevViewProj * vec4(frame.cameraPos + dir * rd - cloudShift, 1.0);
    var valid = SKY.prevCam.w > 0.5 && clip.w > 1e-3;
    var puv = vec2(0.0);
    if (valid) {
      let ndc = clip.xy / clip.w;
      puv = vec2(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
      valid = all(puv >= vec2(0.0)) && all(puv <= vec2(1.0));
    }
    // C2: screen motion in layer pixels, camera and cloud motion together (the motion vector an external upscaler needs is puv - uv).
    let motionPx = length((puv - uv) * frame.renderSize);
    if (valid) {
      // The clip guards against reprojection error; with the view still (the harness, a static camera) the converged history
      // is the better estimate, so it only bites as much as the pixel actually moved.
      // C2: with the cloud motion followed, the shifted history matches the cloud, so the clip bites only as much as the camera moved
      // (a clip at every cloud-motion pixel would pull the history to the 4-pixel-spaced fresh samples and block the detail).
      var movedPx = motionPx;
      if (SKY.cloudMotion.w > 0.5) {
        let c0 = SKY.prevViewProj * vec4(frame.cameraPos + dir * rd, 1.0);
        let n0 = c0.xy / max(c0.w, 1e-3);
        movedPx = length((vec2(n0.x * 0.5 + 0.5, 0.5 - n0.y * 0.5) - uv) * frame.renderSize);
      }
      let moved = smoothstep(0.1, 0.6, movedPx);
      let h0 = textureSampleLevel(histColor, histSampler, puv, 0.0);
      let hist = mix(h0, clamp(h0, lo, hi4), moved);
      let histB = textureSampleLevel(histBack, histSampler, puv, 0.0);
      let hdv = textureLoad(histDepth, clamp(vec2<i32>(puv * frame.renderSize), vec2<i32>(0), hi), 0);
      let hdist = hdv.x;
      if (fresh) {
        // C2: a fast-moving cloud (a time-lapse) trusts the history less: the fresh sample takes over as the motion grows past a few pixels.
        let wFresh = select(SKY.extra.w, max(SKY.extra.w, smoothstep(6.0, 40.0, motionPx)), SKY.cloudMotion.w > 0.5);
        out = mix(hist, tc, wFresh);
        outB = mix(histB, tb, wFresh);
      } else {
        out = hist;
        outB = histB;
        dist = hdist;
        dist4 = hdv.zw;
      }
    }
  }
  textureStore(histColorOut, px, out);
  textureStore(histBackOut, px, outB);
  textureStore(histDepthOut, px, vec4(dist, sceneEnd, dist4));
}
`;
