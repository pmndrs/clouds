// Generator-only WGSL (B2): the core runtime never imports this file; the shared field functions are in shaders.ts.
import { BILLOW_WGSL, SPECIES_WGSL } from './shaders';
// WGSL for the GPU NVDF generator. No three imports.
// The distance field is an exact separable EDT in one u16-per-voxel buffer (see EDT_COMMON); no jump flood, no seed buffers.

/**
 * Shared params block (PARAM_BYTES in volume-generator.ts; the GPU generator is generator.ts, 160 bytes), one dynamic-offset slot per job. zStart/zCount: the job's chunk, a z range
 * (nvdf, edt x/y, profile, sdf) or a y range (edt z). Word 3 (`edgeFade`) is the stamp rebuilder's step there; the EDT passes do not read it. The first 9 words are what the stamp rebuilder fills (stamp.ts).
 * The storm words (P6-C) describe one cumulonimbus in the generator's own metres (pm space: voxel * voxelSize + origin, z up from the volume base).
 */
const PARAMS = /* wgsl */ `
struct Params {
  dims: vec3<u32>, edgeFade: f32,   // P9-C2: metres over which the density fades in from the side walls (the sky layer's density fade, 0 = off)
  zStart: u32, zCount: u32, margin: f32, maxDist: f32,
  voxelSize: f32, covThreshold: f32, useHeights: f32, baseDefault: f32,
  topFrac: f32, domeExp: f32, billowAmp: f32, billowCell: f32,
  seed: f32, scaleBase: f32, scaleTop: f32, sigma: f32,
  detailBias: f32, baseLift: f32, originX: f32, originY: f32,   // origin: world metres of voxel (0,0) along x and the map row
  stormOn: f32, stormX: f32, stormY: f32, stormBase: f32,        // storm cell: on (> 0.5), centre (pm metres), base height above the volume base (m)
  stormR: f32, stormH: f32, anvilR: f32, stormPh: f32,           // mature tower radius / top height (m), mature anvil radius (m), life phase (age / grow)
  shearX: f32, shearY: f32, leanX: f32, leanY: f32,              // anvil spread direction (pm axes); lean: wind-shear lean of every column, metres per metre of height (P9-B)
  profiles: f32, altoBase: f32, altoDepth: f32, terrainOn: f32,  // P9-C: species profile table on (> 0.5); upper (altocumulus) layer base and depth (fractions of the volume height, 0 = off); terrain stub bound
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



/**
 * Storm cell (P6-C): one cumulonimbus as a 3D field in the generator's metres, so it has real overhangs (the weather map is 2.5D: one [base, top]
 * per column, so P6-B's cell was an extrusion). Life cycle on ph = age / grow (P6-B timing, unchanged): tower rises over ph 0..0.75, the anvil
 * starts at 0.42 and spreads to 1.05, the tower decays from 1.7 (gone by 2.6), the anvil from 2.6 (gone by 3.6).
 *   Tower   a leaning core (0.5-0.62 R, domed from 0.55 of its height) and eight turrets around it, each a column that widens toward its own
 *           rounded top (0.55-1.15 of the cell height, so some overshoot the anvil) and spreads outward with height; smooth max of all of them,
 *           so the silhouette is lobes at several heights, widest under the anvil. The base is a soft ramp of 3% of the height: flat, not a cut.
 *   Anvil   a plume carried downwind (upwind edge 1.4 R from the axis, downwind reach AR, ragged rim), top at 0.9 of the mature height with a
 *           900 m undulation; thickness a deep root over the tower that becomes a plate of a quarter of it, undulating, with mammatus pouches
 *           on its underside; the rim fades in density (`fade`) rather than tapering to a wedge (which terraces at 16 m voxels).
 * The field is in the mass units of the cumulus field (1 on the axis, 0 at the surface), so the same billow erosion applies; the caller
 * reads `hf` (height fraction for the profile fit), `anvil` (0 tower .. 1 anvil: thinner, billowy-typed), `amp` (billow weight), `fade`
 * and `sup` (how much of the low field to suppress under the cell).
 */
const STORM_WGSL = /* wgsl */ `
struct StormF { f: f32, hf: f32, anvil: f32, sup: f32, amp: f32, fade: f32 }
fn smax(a: f32, b: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(a, b, h) + k * h * (1.0 - h);
}
fn stormField(pm: vec3<f32>) -> StormF {
  var o: StormF; o.f = -4.0; o.hf = 0.0; o.anvil = 0.0; o.sup = 0.0; o.amp = 1.0; o.fade = 1.0;
  if (P.stormOn < 0.5) { return o; }
  let ph = P.stormPh;
  let rise = smoothstep(0.0, 0.75, ph);
  let envT = smoothstep(0.0, 0.06, ph) * (1.0 - smoothstep(1.7, 2.6, ph));
  let tA = smoothstep(0.42, 1.05, ph);
  let envA = smoothstep(0.42, 0.56, ph) * (1.0 - smoothstep(2.6, 3.6, ph));
  let R = mix(0.4, 1.0, rise) * P.stormR;
  let Ht = mix(0.2, 1.0, pow(rise, 0.85)) * P.stormH * envT;
  let AR = mix(P.stormR, P.anvilR, tA);
  let dir = normalize(vec2<f32>(P.shearX, P.shearY) + vec2<f32>(1e-4, 0.0));
  let q0 = pm.xy - vec2<f32>(P.stormX, P.stormY);
  let z = pm.z - P.stormBase;
  let reach = max(1.9 * R, 1.25 * AR) + 0.4 * P.stormH;
  if (dot(q0, q0) > reach * reach || z < -0.1 * P.stormH || z > 1.3 * P.stormH) { return o; }
  let seed = u32(P.seed * 131.0);
  // ---- tower: a cluster of eight turrets (updraft pulses) around a core, each a column that widens toward its own rounded top (0.55-1.15 of
  //      the cell height) and leans downwind, so the silhouette is lobes at several heights, widest under the anvil, not one wall ----
  var fT = -4.0;
  var hfT = 0.0;
  if (envT > 0.0) {
    let lean = 0.07;
    let q = q0 - dir * lean * max(z, 0.0);
    let hn = z / max(Ht, 1.0);
    // Radial law 1 - (r/R)^1.4 (not squared): a gentler gradient at the surface, so the same billow amplitude moves the surface further (bigger lobes).
    let Rw = R * (0.5 + 0.12 * smoothstep(0.0, 0.5, hn));
    let cap = max(0.0, (hn - 0.55) / 0.45);
    fT = 1.0 - pow(length(q) / Rw, 1.4) - cap * cap;
    let spread = 0.55 + 0.45 * smoothstep(0.0, 0.6, hn);
    for (var i = 0; i < 8; i++) {
      let h3 = hash3f(vec3<i32>(i, 11, 0), seed);
      let h4 = hash3f(vec3<i32>(i, 23, 0), seed);
      let a = 6.2831853 * (f32(i) / 8.0 + 0.25 * h3.x) + P.seed;
      let c = vec2<f32>(cos(a), sin(a)) * (0.35 + 0.55 * h3.y) * R * spread;
      let hi = 0.55 + 0.6 * h4.x;
      let zi = z / max(hi * Ht, 1.0);
      let Ri = R * (0.3 + 0.2 * h3.z) * (0.6 + 0.4 * smoothstep(0.0, 0.8, zi));   // a thermal: narrow stem, bulging head
      let capi = max(0.0, (zi - 0.65) / 0.35);
      let fi = 1.0 - pow(length(q - c) / Ri, 1.4) - capi * capi;
      fT = smax(fT, fi, 0.2);
    }
    fT = fT - max(0.0, -z) / max(0.03 * Ht, 10.0);
    hfT = clamp(0.15 + 0.85 * hn, 0.0, 1.0);
  }
  // ---- anvil: a plume carried downwind (upwind edge 1.4 R from the axis, downwind reach AR, about 0.6 AR across), top at 0.9 of the mature
  //      height (the overshooting turrets poke through it), a deep root over the tower thinning to a plate whose rim fades out ----
  var fA = -4.0;
  var ra = 2.0;
  var T = 0.0;
  var zm = 0.0;
  if (envA > 0.0) {
    let u = dot(q0, dir); let v = dot(q0, vec2<f32>(-dir.y, dir.x));
    let ru = select(AR, min(1.4 * R, AR), u < 0.0);
    // Ragged reach: the rim wanders by +-25 percent over about 700 m.
    let rag = 1.0 + 0.5 * (valueNoise3(vec3<f32>(q0 / 700.0, 0.37) + vec3<f32>(f32(seed % 101u), 2.1, 0.0), seed + 5u) - 0.5);
    ra = length(vec2<f32>(u / ru, v / (0.5 * AR + 0.3 * ru))) / rag;
    // Thickness: a deep root over the tower (T0) that becomes a plate of about a quarter of it beyond 0.6 of the reach. The rim is not a
    // geometric wedge (a few voxels thick it would terrace): the plate keeps about four voxels and fades in density toward the rim (fade).
    let T0 = 0.26 * P.stormH * envA;
    // Undulation of the whole plate (about 900 m, +-40 m, plus a +-20 m ripple at 130-300 m so the slow surfaces do not step through the voxel
    // layers as contour terraces) and mammatus: rounded pouches of 150-400 m hanging up to 90 m below the plate.
    let wave = 80.0 * (valueNoise3(vec3<f32>(q0 / 900.0, 1.7), seed + 9u) - 0.5)
      + 28.0 * (valueNoise3(vec3<f32>(q0 / 300.0, z / 300.0 + 4.2), seed + 15u) - 0.5) + 14.0 * (valueNoise3(vec3<f32>(q0 / 130.0, 7.9), seed + 17u) - 0.5);
    let pouch = 90.0 * worleyLobes(vec3<f32>(q0 / 380.0, 0.5), seed + 21u) * smoothstep(0.25, 0.5, ra) * envA;
    let zt = P.stormH * (0.9 - 0.05 * ra * ra) + wave;
    T = max(T0 * (0.22 + 0.78 * (1.0 - smoothstep(0.2, 0.6, ra))), 4.5 * P.voxelSize) * (1.0 - smoothstep(0.9, 1.0, ra)) + pouch;
    zm = zt - 0.5 * T;
    let dz = (z - zm) / max(0.5 * T, 12.0);
    let out = max(0.0, ra - 1.0);
    fA = 1.0 - dz * dz - out * out * 60.0;
    o.fade = 1.0 - smoothstep(0.55, 0.97, ra);
  }
  o.f = smax(fT, fA, 0.3);
  let wA = smoothstep(-0.3, 0.3, fA - fT);
  o.anvil = wA;
  o.hf = mix(hfT, 0.8, wA);   // the anvil as billowy, top-like material: the wispy up-rez would erode a uniform plate into the detail noise's tiling
  // Billow amplitude: full cauliflower on the tower, smoother anvil top, lumpier underside (mammatus), none where the anvil is thin (no islands off the rim).
  let ampA = select(0.8, 0.45, z > zm) * smoothstep(60.0, 200.0, T);
  o.amp = mix(1.2, ampA, wA);
  // The low field does not live under the cell: fully under the anvil's body and the tower's footprint, fading over the rim.
  let r0 = length(q0);
  o.sup = max(envA * (1.0 - smoothstep(0.7, 1.05, ra)), envT * (1.0 - smoothstep(1.2 * R, 1.8 * R, r0)));
  return o;
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
const SHAPE = /* wgsl */ `${BILLOW_WGSL}${STORM_WGSL}
/**
 * f0 + k * billowAt(pm, cell0, s0, octaves), evaluated octave by octave and stopped as soon as the octaves still to come cannot change its sign
 * (each adds amp * [0, 1] of the lobes): the occupancy pass only needs the sign, and most voxels of the band are decided after one or two octaves.
 * When it stops early the value is the middle of the remaining range (right sign, not the exact field). Same octaves, offsets and seeds as billowAt.
 */
fn billowSigned(f0: f32, k: f32, pm: vec3<f32>, cell0: f32, s0: u32, octaves: u32, liftMax: f32) -> f32 {
  var wsum = 0.0; var a = 0.55;
  for (var o = 0u; o < octaves; o++) { wsum += a; a *= 0.5; }
  var acc = 0.0; var rem = wsum; var amp = 0.55; var cell = cell0;
  for (var o = 0u; o < octaves; o++) {
    // P9-C2: the outward (positive) displacement is capped at liftMax (BILLOW_LIFT); min is monotone, so the bounds stay bounds.
    let lo = f0 + min(k * (acc / wsum - 0.41), liftMax);
    let hi = f0 + min(k * ((acc + rem) / wsum - 0.41), liftMax);
    if (lo > 0.0 || hi < 0.0) { return 0.5 * (lo + hi); }
    acc += amp * worleyLobes(pm / cell + vec3<f32>(f32(o) * 7.3, f32(o) * 3.1, 0.0), s0 + o * 17u);
    rem -= amp; cell *= 0.5; amp *= 0.5;
  }
  return f0 + min(k * (acc / wsum - 0.41), liftMax);
}
/**
 * anvil: 0 for the cumulus field and the storm's tower, 1 in the anvil (wispier detail, thinner); the profile pass reads it.
 * flip: the species' wispy-to-billowy switch height (NE p.99), < 0 with the profile table off (the old detail law); scaleMul its density scale.
 */
struct Shape { s: f32, h: f32, f0: f32, f: f32, hcol: f32, base: f32, top: f32, cloudType: f32, anvil: f32, fade: f32, flip: f32, scaleMul: f32 }
/**
 * The weather at voxel p, with the wind-shear lean (P9-B): the column is read lean metres downwind per metre above the volume base, so every
 * cloud leans the same way (its top displaced by lean * height). The map spans the volume footprint 1:1 (uv = (voxel + 0.5) / dims).
 */
fn weatherAt(p: vec3<i32>) -> vec4<f32> {
  let uv = (vec2<f32>(f32(p.x), f32(p.y)) + 0.5) / vec2<f32>(f32(P.dims.x), f32(P.dims.y));
  let lean = vec2<f32>(P.leanX, P.leanY) * (f32(p.z) + 0.5) / vec2<f32>(f32(P.dims.x), f32(P.dims.y));   // voxel units of z, over the map's voxel extent: lean is metres per metre
  return textureSampleLevel(weather, weatherSampler, uv - lean, 0.0);
}
/** Terrain stub (P9-C, for T3): ground height in metres above the volume base under voxel p (no lean: the ground does not shear). */
fn terrainAt(p: vec3<i32>) -> f32 {
  let uv = (vec2<f32>(f32(p.x), f32(p.y)) + 0.5) / vec2<f32>(f32(P.dims.x), f32(P.dims.y));
  return textureSampleLevel(terrain, weatherSampler, uv, 0.0).r;
}
// The band of f0 around the surface that the billow displaces (on over (z, w), off again over (x, y)).
const BAND = vec4<f32>(0.18, 0.45, -0.55, -0.3);
fn nearBand(f0: f32, band: vec4<f32>) -> f32 { return (1.0 - smoothstep(band.x, band.y, f0)) * smoothstep(band.z, band.w, f0); }
fn shapeAt(p: vec3<i32>, withNoise: bool) -> Shape {
  var r: Shape;
  let w = weatherAt(p);
  r.cloudType = w.g;
  r.anvil = 0.0; r.fade = 1.0; r.flip = -1.0; r.scaleMul = 1.0;
  r.base = P.baseDefault; r.top = P.topFrac;
  let H = f32(P.dims.z) * P.voxelSize;
  let prof = P.profiles > 0.5 && P.useHeights < 0.5;
  var dexp = P.domeExp; var bottom = 24.0; var bAmp = 1.0; var bCell = 1.0; var rowDepth = 0.0;
  if (P.useHeights > 0.5) { r.base = w.b; r.top = w.a; }
  else if (prof) {
    // P9-C: the species row of this column (G) gives the base, the full-mass top, the top and bottom types and the billow (the SP_* species rows).
    let row = speciesRow(w.g);
    r.base = clamp(P.baseDefault + row.baseOff / H, 0.004, 0.9);
    r.top = min(r.base + row.depth / H, 0.97);
    dexp = row.topExp; bottom = (r.top - r.base) * H / row.bottom; bAmp = row.billowAmp; bCell = row.billowCell; r.flip = row.flip; r.scaleMul = row.scale;
    rowDepth = (r.top - r.base) * H;   // the row's depth as far as the volume shows it (a congestus row in a 512 m volume is a 400 m one)
  }
  let pm = vec3<f32>(f32(p.x) + 0.5, f32(p.y) + 0.5, f32(p.z) + 0.5) * P.voxelSize + vec3<f32>(P.originX, P.originY, 0.0);
  let st = stormField(pm);
  r.s = clamp((w.r - P.covThreshold) / (1.0 - P.covThreshold), 0.0, 1.0) * (1.0 - st.sup);
  let hz = (f32(p.z) + 0.5) / f32(P.dims.z);
  if (P.terrainOn > 0.5) {
    // The cloud stands on the ground where the ground is above its base (a valley sea fills the valleys up to its flat top) and thins out where
    // the ground rises to within 48 m of the layer's top (soft edges at the cliffs, not a sliver).
    let tz = terrainAt(p) / H;
    r.s = r.s * smoothstep(0.0, 48.0 / H, r.top - tz);
    r.base = min(max(r.base, tz), r.top - 1e-3);
  }
  // The base is flat in the middle of a lobe and curls up toward its rim (a concave underside; also trims the thin skirts around a cloud). One
  // condensation level per layer: the presets keep baseLift at about 15 m (P9-B), the sky layer mirrors this law (sky-layer.wgsl.ts skySmooth).
  r.base = r.base + P.baseLift * pow(1.0 - r.s, 1.5);
  if (prof) { dexp = edgeExp(dexp, r.s); r.s = tallMass(r.s, dexp, rowDepth); }
  r.h = (hz - r.base) / max(r.top - r.base, 1e-3);
  r.f0 = r.s - profileG(r.h, dexp, bottom);
  // Fraction of the way up this column's own extent (column top is where s = h^p).
  r.hcol = clamp(r.h / pow(max(r.s, 0.05), 1.0 / dexp), 0.0, 1.0);
  // P9-C2: the tall species' flanks bulge and neck (towerShift). |grad s| by forward differences over one map texel (the map is 1:1 with the voxels).
  if (prof && rowDepth > 550.0 && r.s > 0.0 && st.f <= -3.9) {
    let thr = P.covThreshold;
    let sx = tallMass(clamp((weatherAt(p + vec3<i32>(1, 0, 0)).r - thr) / (1.0 - thr), 0.0, 1.0), dexp, rowDepth);
    let sy = tallMass(clamp((weatherAt(p + vec3<i32>(0, 1, 0)).r - thr) / (1.0 - thr), 0.0, 1.0), dexp, rowDepth);
    let s0 = tallMass(clamp((w.r - thr) / (1.0 - thr), 0.0, 1.0), dexp, rowDepth);
    let gxy = length(vec2<f32>(sx - s0, sy - s0)) / P.voxelSize;
    let gz = select(bottom, dexp * pow(max(r.h, 1e-4), dexp - 1.0), r.h >= 0.0) / max((r.top - r.base) * H, 1.0);
    r.f0 = r.f0 + towerShift(pm, u32(P.seed * 131.0) + 9u, rowDepth, gxy, gz, r.f0, r.h, r.s);
  }
  // Billow weight: strongest on tops and near the surface, none deep inside or far outside, none near the ceiling (so towers do not hit the volume top and get cut flat).
  // P9-B: times the map's billow weight (B when the map's heights are not in use): the mass of the cloud the column belongs to, so a 100 m puff of mass
  // 0.1 is not displaced by a billow sized for a 1 km cloud of mass 1 (which made every small cell a 250 m spike), while big clouds keep ragged rims.
  // P9-C: with the profile table the ceiling is the volume's (the full-mass top h = 1 is the top of a congestus tower, which should billow).
  let ceiling = select(1.0 - smoothstep(0.82, 1.0, r.h), 1.0 - smoothstep(0.88, 0.99, hz), prof);
  var topW = mix(0.45, 1.0, smoothstep(0.1, 0.7, r.hcol)) * ceiling * select(w.b, 1.0, P.useHeights > 0.5);
  var hasMass = r.s > 0.0;
  // P9-C2: the billow may lift a column by at most about half its own height (its outward part; BILLOW_LIFT). Under f = s - g(h) a billow of k (in f) lifts the top of a column of
  // mass s by about k / (p s) of its height, and the f-unit billow was sized for the 1 km clouds: on a small cloud, near any footprint's rim, and
  // most of all on the tall rows (whose low part is nearly flat in f), it lifted the column by its own height or more, up to where the field is
  // cut at the footprint's rim. That cut was a vertical wall: the cylinder towers and the boxes ("marshmallows") of the side views. With profiles
  // only (the storm scene keeps its look); the sky layer bounds its billow the same way.
  var liftCap = select(1e9, BILLOW_LIFT * dexp * max(r.s, 0.0), prof);
  var band = BAND;
  if (st.f > r.f0) {
    // The storm cell owns this voxel: its own height fraction and type, its own billow weight (stormField), a wider band so the lobes are bigger.
    r.f0 = st.f; r.hcol = st.hf; r.h = st.hf; r.anvil = st.anvil; r.fade = st.fade;
    r.cloudType = mix(0.95, 0.6, st.anvil);
    topW = st.amp * mix(0.75, 1.0, smoothstep(0.05, 0.4, st.hf)) * (1.0 - smoothstep(0.88, 0.98, hz));
    band = mix(vec4<f32>(0.3, 0.7, -0.65, -0.3), band, st.anvil);
    hasMass = true;
    liftCap = 1e9;   // the storm cell's own billow is not bounded (its field is not the h^p law)
  }
  r.f = r.f0;
  // The billow is centred in about [-0.41, 0.59] (billowAt), so where |f0| exceeds what it can move, the sign of f (all the occupancy pass needs)
  // is known without it: the 3D Worley octaves are skipped there, and billowSigned stops after the octaves that settle the sign (P9-C: the taller
  // species have thicker bands in metres, which doubled the occupancy pass).
  let kAmp = P.billowAmp * bAmp * 3.0 * nearBand(r.f0, band) * topW;
  if (withNoise && P.billowAmp > 0.0 && r.f0 > band.z && r.f0 < band.y && hasMass && r.f0 < 0.42 * kAmp && r.f0 > -0.6 * kAmp) {
    // NE p.102: thin clouds sample the billow a little higher (their column thickness in metres).
    let thick = select(0.0, pow(max(r.s, 0.0), 1.0 / dexp) * (r.top - r.base) * H, prof);
    r.f = billowSigned(r.f0, kAmp, pm + vec3<f32>(0.0, 0.0, select(0.0, thinNoiseOffset(thick), prof)), P.billowCell * bCell, u32(P.seed * 131.0), 3u, liftCap);
  }
  // P9-C upper layer (altocumulus): its own mass (weather A), base and depth, the alto row's profile and a small billow; the voxel belongs to
  // whichever layer's field is larger (the layers are apart in height, so this is a union).
  if (prof && P.altoBase > 0.0 && P.altoDepth > 0.0 && st.f <= -3.9) {
    let sa = clamp((w.a - P.covThreshold) / (1.0 - P.covThreshold), 0.0, 1.0);
    if (sa > 0.0) {
      let arow = altoRow();
      let ab = P.altoBase + 0.5 * P.baseLift * pow(1.0 - sa, 1.5);
      let atop = P.altoBase + P.altoDepth;
      let ha = (hz - ab) / max(atop - ab, 1e-3);
      let pa = edgeExp(arow.topExp, sa);
      let fa0 = sa - profileG(ha, pa, P.altoDepth * H / arow.bottom);
      var fa = fa0;
      let hcolA = clamp(ha / pow(max(sa, 0.05), 1.0 / pa), 0.0, 1.0);
      let kA = P.billowAmp * arow.billowAmp * 3.0 * nearBand(fa0, BAND) * mix(0.45, 1.0, smoothstep(0.1, 0.7, hcolA)) * (1.0 - smoothstep(0.9, 0.99, hz));
      if (withNoise && P.billowAmp > 0.0 && fa0 > BAND.z && fa0 < BAND.y && fa0 < 0.42 * kA && fa0 > -0.6 * kA) {
        let thickA = pow(sa, 1.0 / pa) * (atop - ab) * H;
        fa = billowSigned(fa0, kA, pm + vec3<f32>(0.0, 0.0, thinNoiseOffset(thickA)), P.billowCell * arow.billowCell, u32(P.seed * 131.0) + 5u, 2u, 1e9);
      }
      if (fa > r.f) {
        r.f = fa; r.f0 = fa0; r.s = sa; r.h = ha; r.hcol = hcolA; r.base = ab; r.top = atop;
        r.flip = arow.flip; r.scaleMul = arow.scale; r.cloudType = 0.5;
      }
    }
  }
  return r;
}
`;

/** Occupancy: f > 0 (before the profile is known) -> the class bit of the distance field. Binding 3 is the field. One thread, two voxels. */
export const NVDF_WGSL = /* wgsl */ `${PARAMS}
@group(0) @binding(1) var weather: texture_2d<f32>;
@group(0) @binding(2) var weatherSampler: sampler;
@group(0) @binding(3) var<storage, read_write> fld: array<u32>;
@group(0) @binding(6) var terrain: texture_2d<f32>;
${SHAPE}${EDT_COMMON}

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
    let sh = shapeAt(p, true);
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
export const PROFILE_WGSL = /* wgsl */ `${PARAMS}
@group(0) @binding(1) var weather: texture_2d<f32>;
@group(0) @binding(2) var weatherSampler: sampler;
@group(0) @binding(3) var<storage, read> fld: array<u32>;
@group(0) @binding(5) var nvdf: texture_storage_3d<rgba8unorm, write>;
@group(0) @binding(6) var terrain: texture_2d<f32>;
${SHAPE}${EDT_COMMON}

@compute @workgroup_size(8, 8, 4)
fn profileMain(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= P.dims.x || g.y >= P.dims.y || g.z >= P.zCount) { return; }
  let p = vec3<i32>(i32(g.x), i32(g.y), i32(P.zStart + g.z));
  let raw = (fld[wIdx(g.x, g.y, P.zStart + g.z)] >> ((g.x & 1u) * 16u)) & 0xffffu;
  if ((raw & CLS) == 0u) { textureStore(nvdf, p, vec4<f32>(0.0, 1.0, 1.0, 1.0)); return; }
  let sh = shapeAt(p, false);
  var depth = P.maxDist;
  if ((raw & CAP) != CAP) { depth = max(0.0, (f32(raw & CAP) * (1.0 / 64.0) - 0.5) * P.voxelSize); }
  // Smooth unit-ish noise, lattice-free (profileNoise), 36-48 m correlation.
  let pm = vec3<f32>(f32(p.x) + 0.5, f32(p.y) + 0.5, f32(p.z) + 0.5) * P.voxelSize + vec3<f32>(P.originX, P.originY, 0.0);
  var n = clamp(profileNoise(pm, P.voxelSize, u32(P.seed * 53.0)) * 3.4, -2.5, 2.5);
  let hf = sh.hcol;
  // P9-C2: with the profile table, surface patches (surfacePatch) move the profile's depth law and the detail flip regionally.
  var patchN = 0.0;
  if (sh.flip >= 0.0) { patchN = surfacePatch(pm, u32(P.seed * 53.0) + 31u); n = n + 1.2 * patchN; }
  // The anvil is a plate of ice a few voxels thick: as a thin shell its profile would be low everywhere and the up-rez erosion would leave only the
  // detail noise's minima (a 100 m grid of dots), so its depth counts triple and its spread is reduced (P6-C). The 0.7 density scale keeps it translucent.
  let dEff = depth * mix(1.0, 1.0 + 2.0 * sh.fade, sh.anvil) * exp(P.sigma * (1.0 - 0.7 * sh.anvil) * n);
  // Q2 directional detail: the coverage gradient (central difference, per metre) against the shear lean.
  let gx = weatherAt(p + vec3<i32>(1, 0, 0)).r - weatherAt(p - vec3<i32>(1, 0, 0)).r;
  let gy = weatherAt(p + vec3<i32>(0, 1, 0)).r - weatherAt(p - vec3<i32>(0, 1, 0)).r;
  let dirC = select(0.0, directionalDetail(hf, vec2<f32>(gx, gy) / (2.0 * P.voxelSize), vec2<f32>(P.leanX, P.leanY)), sh.anvil < 0.5);
  let core = pow(clamp((dEff - 1.4) / (66.0 * exp(-DIR_RAMP * dirC)), 0.0, 1.0), 1.05);
  let lift = 0.1 + 0.9 * smoothstep(0.0, 0.22, hf);
  let p8 = max(round(clamp(core * lift, 0.0, 1.0) * 255.0), 1.0);
  let hd = hf - 0.25 * clamp(depth / 32.0, 0.0, 1.0);
  var detail = clamp(smoothstep(0.1, 0.75, hd) + (sh.cloudType - 0.5) * P.detailBias, 0.0, 1.0);
  // P9-C (NE p.99): the species sets the height at which the detail flips from wispy (below) to billowy (above), over +- 0.1 of the column.
  if (sh.flip >= 0.0) { detail = detailFlip(hd, sh.flip, patchN); }
  detail = clamp(detail + DIR_TYPE * dirC, 0.0, 1.0);
  // The anvil is ice: thinner than the tower, fading out toward its rim (P6-C).
  var scale = mix(P.scaleBase, P.scaleTop, smoothstep(0.0, 0.6, hf)) * sh.scaleMul * mix(1.0, 0.7 * (0.3 + 0.7 * sh.fade), sh.anvil);
  // P9-C2 density hand-off (sheets): the field fades in from the side walls over edgeFade metres while the sky layer fades out (sky-layer.wgsl.ts).
  if (P.edgeFade > 0.0) {
    let e = min(min(f32(p.x) + 0.5, f32(P.dims.x) - f32(p.x) - 0.5), min(f32(p.y) + 0.5, f32(P.dims.y) - f32(p.y) - 0.5)) * P.voxelSize;
    scale = scale * smoothstep(0.0, P.edgeFade, e);
  }
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
