// WGSL for the GPU NVDF generator. No three imports.
// The distance field is an exact separable EDT in one u16-per-voxel buffer (see EDT_COMMON); no jump flood, no seed buffers.

/**
 * Shared params block (PARAM_BYTES in volume-generator.ts, 160 bytes), one dynamic-offset slot per job. zStart/zCount: the job's chunk, a z range
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

/** P9-C: the species profile table and its height law, shared by the generator's shape stage, the weather pass and the sky layer (via BILLOW_WGSL). */
export const SPECIES_WGSL = /* wgsl */ `
/**
 * P9-C species profile table (Nubis Evolved pp. 20-29: a cloud's vertical shape is a top-type profile times a bottom-type profile over its own
 * min..max height, times coverage). Our shape law is the level set f = s - g(h) (SHAPE below), so the NE axes map onto it as:
 *   top type     topExp, the exponent of g(h) = h^p above the base: column top ~ mass^(1/p), so a large p rises steeply at the rim and stays
 *                flat (12 a lid: stratus; 4 flat-topped lumps), 2 a rounded dome; p near 1 makes cones (height proportional to mass). A tower
 *                is a dome of p 1.9 whose depth is several times its radius;
 *   bottom type  bottom, metres the base sags under a full-mass column (g continues below the base as a linear ramp): 6 a flat cut (cumulus),
 *                more a soft, rounded underside that hangs lower under thick parts (stratus);
 *   min height   the layer's condensation level (NvdfParams.baseDefault) + baseOff metres;
 *   max height   depth, metres from the base to the top of a full-mass column; a cloud of peak mass m tops out at m^(1/p) of it, so the per-cloud max
 *                height is the weather map's R peak (P9-B: cell peak by size class and growth state) through this row;
 * plus what NE ties to the type: the billow (amplitude and cell size multipliers on NvdfParams.billowAmp / billowCellMeters), the wispy-to-billowy flip
 * height of the detail type (NE p.99: detail switches over flip +- 0.1 of the column height) and a density scale multiplier.
 * Rows sit along the weather map's species channel G: 0 stratus, 0.25 stratocumulus, 0.5 cumulus humilis, 0.75 mediocris, 1 congestus; G between
 * rows interpolates (species regions are smooth, so a boundary is a gradual change of cloud type). Row 5 is the upper layer (altocumulus, weather A).
 * Shared with the sky layer (sky-layer.wgsl.ts skySmooth), so the distant field has the same shapes.
 */
struct SpeciesRow { depth: f32, topExp: f32, baseOff: f32, bottom: f32, billowAmp: f32, billowCell: f32, flip: f32, scale: f32 }
const SP_STRATUS = SpeciesRow(170.0, 12.0, -70.0, 34.0, 0.1, 1.8, 0.95, 0.7);  // stratus: a flat lid 170 m over a soft base, almost no billow, all wispy
const SP_STRATOCUMULUS = SpeciesRow(360.0, 3.0, 0.0, 14.0, 0.45, 0.5, 0.6, 0.9);     // stratocumulus: flat-topped lumps on the sheet, small billows
const SP_HUMILIS = SpeciesRow(220.0, 2.8, 0.0, 8.0, 0.55, 0.4, 0.45, 1.0);     // cumulus humilis: flat domes, wider than tall
const SP_MEDIOCRIS = SpeciesRow(750.0, 2.1, 0.0, 8.0, 0.6, 0.85, 0.32, 1.0);     // cumulus mediocris: domes as tall as wide
const SP_CONGESTUS = SpeciesRow(1650.0, 1.6, 0.0, 8.0, 0.45, 1.2, 0.18, 1.0);    // cumulus congestus: towers that taper up (P9-C2: p 1.6, column top ~ mass^0.63) with rounded heads, billowy almost to the base
const SP_ALTOCUMULUS = SpeciesRow(0.0, 2.2, 0.0, 12.0, 0.5, 0.16, 0.5, 0.85);      // altocumulus (upper layer; depth from NvdfParams.altoDepth): small rounded cells
// Rows by a switch over consts (no private copy of an indexed table per voxel).
fn speciesRowAt(i: u32) -> SpeciesRow {
  switch i {
    case 0u: { return SP_STRATUS; }
    case 1u: { return SP_STRATOCUMULUS; }
    case 2u: { return SP_HUMILIS; }
    case 3u: { return SP_MEDIOCRIS; }
    default: { return SP_CONGESTUS; }
  }
}
fn speciesRow(g: f32) -> SpeciesRow {
  let x = clamp(g, 0.0, 1.0) * 4.0;
  let i = min(u32(x), 3u);
  let t = x - f32(i);
  let a = speciesRowAt(i); let b = speciesRowAt(i + 1u);
  return SpeciesRow(mix(a.depth, b.depth, t), mix(a.topExp, b.topExp, t), mix(a.baseOff, b.baseOff, t), mix(a.bottom, b.bottom, t),
    mix(a.billowAmp, b.billowAmp, t), mix(a.billowCell, b.billowCell, t), mix(a.flip, b.flip, t), mix(a.scale, b.scale, t));
}
fn altoRow() -> SpeciesRow { return SP_ALTOCUMULUS; }
/** The height law of the level set f = s - g(h): h^p above the base (top type), a linear ramp of slope bottom below it (bottom type). */
fn profileG(h: f32, p: f32, bottom: f32) -> f32 { return select(-h * bottom, pow(max(h, 0.0), p), h >= 0.0); }
/**
 * The top exponent at a column of mass s: the row's toward the core, at most 2 (a rounded dome) toward the rim. A flat-topped species (stratus,
 * stratocumulus) keeps its flat top but gets rounded shoulders instead of vertical walls where its mass ramps up (column top = s^(1/p)).
 */
fn edgeExp(p: f32, s: f32) -> f32 { return mix(min(p, 2.0), p, smoothstep(0.0, 0.3, s)); }
/**
 * P9-C2: the mass of a tall species' column, so a small cloud is low. Under f = s - h^p a column of mass s tops out at s^(1/p) of the row's depth,
 * which rises with infinite slope from the footprint's rim: in a congestus region (1.65 km depth) a puff of mass 0.05 stood on a 250 m vertical
 * drum wall (the near "marshmallows" and boxes of the side views). s (s / (s + s1))^p tops out at s^(1/p) * s / (s + s1) instead: the wall leans
 * over the rim, a small puff is a low dome, a full column keeps 0.87 of its height. s1 = 0.15 for congestus, fading out below mediocris' depth.
 */
/**
 * P9-C2: the billow's outward displacement (in f) is at most BILLOW_LIFT * p * s, which lifts a column of mass s by at most about half its height
 * (generator and sky layer). Inward (erosion) is not capped: it cannot build a wall, and it gives the rims their raggedness.
 */
const BILLOW_LIFT = 0.75;
/** P9-C2: how much of the tall-species treatment a row of this visible depth (metres) gets: 0 up to 400 m, 1 from 1.3 km (congestus). */
fn tallWeight(depthM: f32) -> f32 { return smoothstep(400.0, 1300.0, depthM); }
fn tallMass(s: f32, p: f32, depthM: f32) -> f32 {
  let s1 = 0.15 * tallWeight(depthM);
  if (s1 <= 0.0 || s <= 0.0) { return s; }
  return s * pow(s / (s + s1), p);
}
/** NE p.102: thin clouds read the noise 0..40 m higher than thick ones, so a thin cloud is not a slice of a tall one. thick in metres. */
fn thinNoiseOffset(thick: f32) -> f32 { return (1.0 - clamp(thick * 0.0125, 0.0, 1.0)) * 40.0; }
`;

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
/**
 * Lobes: one rounded bump per Worley feature, each with its own radius (0.75-1.3 cells) and height (0.65-1), the field is the max over the
 * neighbourhood. P6-C: the old inverted F1 (1 - distance) was one identical cone per cell, so its finest octave tiled every smooth flank with
 * same-sized, evenly spaced pebbles (the "dimple lattice" of the storm's flanks and anvil underside, and the pebbling of stratocumulus tops).
 * Varied radii and heights with a smooth falloff give overlapping lobes of different sizes instead. Mean 0.41, spread 0.2 (as before).
 */
fn worleyLobes(q: vec3<f32>, s: u32) -> f32 {
  let i = vec3<i32>(floor(q));
  let f = fract(q);
  var m = 0.0;
  for (var z = -1; z <= 1; z++) { for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let o = vec3<i32>(x, y, z);
    let h = hash3f(i + o, s);
    let h2 = hash3f(i + o, s + 977u);
    let d = length(vec3<f32>(o) + h - f);
    let t = max(0.0, 1.0 - d / (0.75 + 0.55 * h2.x));
    m = max(m, (0.65 + 0.35 * h2.y) * t * t * (3.0 - 2.0 * t));
  } } }
  return m;
}
/** Centred billow in about [-0.4, 0.6]: lobes (worleyLobes), up to three octaves, cell size halves each octave. cell0 metres, s0 the seed. */
fn billowAt(pm: vec3<f32>, cell0: f32, s0: u32, octaves: u32) -> f32 {
  var a = 0.0; var wsum = 0.0; var amp = 0.55; var cell = cell0;
  for (var o = 0u; o < octaves; o++) {
    let w = worleyLobes(pm / cell + vec3<f32>(f32(o) * 7.3, f32(o) * 3.1, 0.0), s0 + o * 17u);
    a += amp * w; wsum += amp; cell *= 0.5; amp *= 0.5;
  }
  return a / wsum - 0.41;
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
/**
 * The profile's multiplicative depth noise (PACK_FIT sigma), centred, unit-ish spread. P6-C: three octaves of value noise, each in its own
 * rotated frame, none finer than 2.5 voxels. One axis-aligned octave on a 3-voxel lattice (the old noise) put a blob on every lattice point,
 * and the trilinearly sampled NVDF showed them as a regular dimple grid on any smooth flank (48 m dimples at 16 m voxels). Rotated,
 * incommensurate octaves share no lattice, and no octave is sampled below the lattice spacing the texture can carry.
 */
fn profileNoise(pm: vec3<f32>, voxelSize: f32, s: u32) -> f32 {
  let c0 = max(3.0 * voxelSize, 36.0);
  let c1 = max(0.47 * c0, 2.5 * voxelSize);
  let c2 = max(0.23 * c0, 2.5 * voxelSize);
  // rotations about three different axes (37, 61 and 23 degrees), so no octave shares a plane with the voxel grid or with another
  let r0 = mat3x3<f32>(0.80, 0.60, 0.0, -0.46, 0.61, 0.64, 0.38, -0.51, 0.77);
  let r1 = mat3x3<f32>(0.48, 0.0, -0.87, 0.60, 0.72, 0.33, 0.63, -0.69, 0.35);
  let r2 = mat3x3<f32>(0.92, -0.39, 0.0, 0.31, 0.74, 0.60, -0.23, -0.55, 0.80);
  let n0 = valueNoise3(r0 * pm / c0, s) - 0.5;
  let n1 = valueNoise3(r1 * pm / c1 + vec3<f32>(3.7, 1.3, 9.1), s + 7u) - 0.5;
  let n2 = valueNoise3(r2 * pm / c2 + vec3<f32>(5.1, 7.7, 2.3), s + 13u) - 0.5;
  return (n0 + 0.6 * n1 + 0.35 * n2) * (1.0 / 1.22);   // same spread as one octave: variances 1 + 0.36 + 0.12
}
/**
 * P9-C2 surface patches: a smooth, roughly unit-spread noise of 240 m features (one rotated value-noise octave), centred. The detail-type flip and the profile's depth
 * law read it, so the up-rez noise (a repeating 3D texture) is not shown through one uniform erosion over a whole flat surface: on the flat top of a
 * sheet, profile and detail type are constant, and the voxel field showed the noise tile as a regular grid of dimples from above (stratus).
 */
fn surfacePatch(pm: vec3<f32>, s: u32) -> f32 {
  let r0 = mat3x3<f32>(0.48, 0.0, -0.87, 0.60, 0.72, 0.33, 0.63, -0.69, 0.35);
  return (valueNoise3(r0 * pm * (1.0 / 240.0), s) - 0.5) * 3.4;
}
/** P9-C2: the detail type with the species' flip height (NE p.99), the flip moved by up to +-0.2 of the column by surfacePatch. */
fn detailFlip(hd: f32, flip: f32, patchN: f32) -> f32 {
  let fl = flip + 0.2 * clamp(patchN, -1.0, 1.0);
  return smoothstep(fl - 0.1, fl + 0.1, hd);
}
/**
 * P9-C2 tower flanks. Under f = s - h^p the wall of a tall column is where s = h^p, and the billow moves it by (billow / |grad s|): about 10 m on a
 * congestus wall, whose mass ramps up over a few voxels, so the towers stood on straight vertical walls (cylinders) with pockmarks. The tall species
 * instead get a displacement in metres along the surface normal (f += |grad f| * D, D in metres, walls only): the flank bulges and necks at
 * different heights, so a tower is a stack of lobes. D: one rotated octave of value noise, 320 m across and 0.7 of that in height, about +-1 times
 * TOWER_AMP (std about 0.5; the billow adds the finer lobes). towerWeight: 0 up to mediocris' depth, 1 from about 1.3 km (congestus).
 */
const TOWER_AMP = 120.0;
fn towerWeight(depthM: f32) -> f32 { return smoothstep(550.0, 1300.0, depthM); }
fn towerBulge(pm: vec3<f32>, s: u32) -> f32 {
  let r0 = mat3x3<f32>(0.80, 0.60, 0.0, -0.60, 0.80, 0.0, 0.0, 0.0, 1.0);   // 37 degrees about z: off the map axes, still a vertical squash
  let q = r0 * (pm * vec3<f32>(1.0 / 320.0, 1.0 / 320.0, 1.0 / 225.0));
  return (valueNoise3(q, s) - 0.5) * 3.0;
}
/**
 * The f shift of the tower displacement at a column: gradXY / gradZ the smooth field's gradient per metre (horizontal, vertical), f0 the smooth field,
 * h the height fraction, mass the column's mass s. Walls only (the horizontal share of the gradient); none at the flat base (h < 0.03) and none
 * where the mass runs out (s < 0.12: there is no field beyond the footprint to move the wall into, so a bulge there would end on a cut). Gated in
 * metres: evaluated within 2 TOWER_AMP of the smooth surface (f0 / |grad f0|), faded in over the outer fifth, so there is no seam where it starts.
 */
fn towerShift(pm: vec3<f32>, s: u32, depthM: f32, gradXY: f32, gradZ: f32, f0: f32, h: f32, mass: f32) -> f32 {
  let tw = towerWeight(depthM) * smoothstep(0.03, 0.2, h) * smoothstep(0.0, 0.12, mass);
  if (tw <= 0.0) { return 0.0; }
  let gl = max(sqrt(gradXY * gradXY + gradZ * gradZ), 1e-6);
  let reach = 2.0 * TOWER_AMP;
  let gate = smoothstep(-reach, -0.8 * reach, f0 / gl);
  if (gate <= 0.0) { return 0.0; }
  return gl * TOWER_AMP * tw * gate * (gradXY / gl) * towerBulge(pm, s);
}
${SPECIES_WGSL}
`;

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
  let core = pow(clamp((dEff - 1.4) / 66.0, 0.0, 1.0), 1.05);
  let lift = 0.1 + 0.9 * smoothstep(0.0, 0.22, hf);
  let p8 = max(round(clamp(core * lift, 0.0, 1.0) * 255.0), 1.0);
  let hd = hf - 0.25 * clamp(depth / 32.0, 0.0, 1.0);
  var detail = clamp(smoothstep(0.1, 0.75, hd) + (sh.cloudType - 0.5) * P.detailBias, 0.0, 1.0);
  // P9-C (NE p.99): the species sets the height at which the detail flips from wispy (below) to billowy (above), over +- 0.1 of the column.
  if (sh.flip >= 0.0) { detail = detailFlip(hd, sh.flip, patchN); }
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

/**
 * Procedural weather map v2 (P9-B, P9-C): R coverage (the 2D mass the shape stage turns into a dome), G species (the row of the profile table,
 * shaders.ts the SP_* species rows: 0 stratus, 0.25 stratocumulus, 0.5 humilis, 0.75 mediocris, 1 congestus; a regional field over the preset's range),
 * B the billow weight, A the upper (altocumulus) layer's mass (storm: B base and A top heights, fractions of the volume height, read with
 * useMapHeights). The map describes a sky, not a lattice:
 *   clusters   an fBm at `scale` cells across the map (2-8 km features) through the coverageLo..Hi ramp says where clouds gather and where the
 *              gaps are (clusterAt: 0 clear gap .. 1 cluster core);
 *   cells      four sparse jittered Worley layers (big, mid, small, fractus) at cellScale/2, cellScale, 2x and 4x cells across the map. Every lattice
 *              cell holds a cloud with some probability, with its own radius, peak mass, profile exponent (plateau .. tower) and sub-lobe split from
 *              hashes, and is scaled by the cluster field at its centre: big cells only in cluster cores, small ones out to the rims, so the size
 *              distribution is wide and nothing repeats at the cell spacing (cellLayer);
 *   fractus    scraps of the finest layer where the mass of the larger clouds is low but not zero: ragged bits around the big cells;
 *   deck       a carpet the cells stand on: (1 - cellular) of the cluster field, or the species' own (stratus a sheet, stratocumulus long bands
 *              along the wind with gaps);
 *   species    a regional fBm over the preset's range of rows; each cell's species sets its size class presence, radius, growth state, turrets and
 *              elongation (H_* rows: congestus bigger, peakier, turreted; humilis small plateaus; stratocumulus stretched along the wind);
 *   alto       an upper layer of small near-regular cells in patches (A, altoAt);
 *   horizon    HZD s45: far from the map centre (the sky layer's window) species and clusters blend to a mid-coverage cumulus sky.
 * B is the billow weight of the column's cloud (its peak mass, so small puffs are not displaced by a billow sized for a 1 km cloud); with `storm`
 * (useMapHeights) B is instead one condensation level (0.08 +- 15 m of a 512 m volume, regional). Shear is not here: the map is 2D, the generator leans the
 * column (shaders.ts SHAPE, NvdfParams.shearX/Y). Evolution (`evolve`): every cell has the life cycle of P6-A (grow 22 percent, mature to 66,
 * dissipate, restart elsewhere with new parameters), the pattern is advected and the cluster fBm drifts.
 */
export const WEATHER_WGSL = /* wgsl */ `
struct WeatherParams {
  size: vec2<u32>, seed: f32, scale: f32,
  coverageLo: f32, coverageHi: f32, border: f32, cellular: f32,
  cellScale: f32, evoOn: f32, fractus: f32, species: f32,
  uvOrigin: vec2<f32>, uvSize: vec2<f32>,   // window of the map's own uv space this texture shows (default 0,0 / 1,1)
  evo: vec4<f32>,    // evolution: time (s), life cycle (s), pattern advection (uv, x then y)
  drift: vec4<f32>,  // evolution: fBm drift per second (uv units of the fBm domain, x then y), unused zw
  storm: vec4<f32>,  // x: storm field (> 0.5): the low field of a storm scene (P6-C: the cell itself is a 3D field in the generator, shaders.ts STORM_WGSL); y: lobeSplit; z: sizeSpread; w: unused
  dims: vec4<f32>,   // metres spanned by uv 0..1, height of the volume in metres (storm only: the heights are written as fractions of it), unused zw
  spec: vec4<f32>,   // P9-C: G of the species field's low and high end (xy); wind direction in map uv axes, normalised (zw): bands and streets align with it
  alto: vec4<f32>,   // P9-C upper layer (A): cover (0 = off), cells across the map, patches across the map, cell jitter (0 a lattice .. 1 fully jittered)
  horizon: vec4<f32>,// HZD s45: start and end (metres from the map centre; end <= start = off), species and cluster value the far field blends to
}
@group(0) @binding(0) var<uniform> W: WeatherParams;
@group(0) @binding(1) var outTex: texture_storage_2d<rgba8unorm, write>;
${SPECIES_WGSL}

fn hash(p: vec2<i32>) -> f32 {
  var h = u32(p.x) * 374761393u + u32(p.y) * 668265263u + u32(W.seed * 977.0) * 2246822519u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h = h ^ (h >> 16u);
  return f32(h) * (1.0 / 4294967295.0);
}
fn valueNoise(p: vec2<f32>) -> f32 {
  let i = vec2<i32>(floor(p));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2<i32>(1, 0)), u.x), mix(hash(i + vec2<i32>(0, 1)), hash(i + vec2<i32>(1, 1)), u.x), u.y);
}
fn fbmN(p0: vec2<f32>, octaves: i32) -> f32 {
  var p = p0; var a = 0.5; var s = 0.0; var n = 0.0;
  for (var o = 0; o < octaves; o++) { s += a * valueNoise(p); n += a; p = p * 2.03 + vec2<f32>(17.1, 9.7); a *= 0.5; }
  return s / n;
}
fn fbm(p0: vec2<f32>) -> f32 { return fbmN(p0, 5); }
fn hashSu(p: vec2<i32>, salt: u32) -> u32 {
  var h = u32(p.x) * 374761393u + u32(p.y) * 668265263u + (u32(W.seed * 977.0) + salt * 3266489917u) * 2246822519u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h = h ^ (h >> 16u);
  h = (h ^ (h >> 15u)) * 2246822519u;
  return h ^ (h >> 13u);
}
fn hashS(p: vec2<i32>, salt: u32) -> f32 { return f32(hashSu(p, salt)) * (1.0 / 4294967295.0); }
/** Two uniform values (16 bits each) from one hash: the per-cell parameters need no more. */
fn hash2S(p: vec2<i32>, salt: u32) -> vec2<f32> {
  let h = hashSu(p, salt);
  return vec2<f32>(f32(h & 0xffffu), f32(h >> 16u)) * (1.0 / 65535.0);
}
// ---- the cluster and species fields (uvc: the advected pattern uv; dOff: the fBm drift) ----
// Where clouds gather, 0 clear gap .. 1 cluster core: 1.5 x the fBm (mean 0.5, spread about 0.12) through the coverageLo..Hi window, scaled so
// the demos' fair-weather window (lo 0.56 / hi 0.9, the cumulus preset too) gives gaps over about a quarter of the map and cores over a fifth:
// the window keeps its old sense (lower lo = more cloud; the compare page's coverage slider maps onto it).
// Three octaves: it is read at cell centres (at least 100 m apart) and gates whole cells, so the finer octaves would only cost (the deck keeps five).
// HZD s45 horizon rule (P9-C): 0 within horizon.x metres of the map centre, 1 beyond horizon.y. The far field blends toward a mid-coverage cumulus
// sky there, so the horizon is never empty and never one uniform species (only the sky layer's window reaches that far).
fn horizonAt(uvc: vec2<f32>) -> f32 {
  if (W.horizon.y <= W.horizon.x) { return 0.0; }
  let uvBox = uvc + select(vec2<f32>(0.0), W.evo.zw, W.evoOn > 0.5);
  return smoothstep(W.horizon.x, W.horizon.y, length((uvBox - 0.5) * W.dims.x));
}
fn clusterAt(uvc: vec2<f32>, dOff: vec2<f32>) -> f32 {
  let fb = fbmN(uvc * W.scale + vec2<f32>(W.seed * 13.0, 0.0) + dOff, 3);
  let c = clamp(((1.5 * fb - W.coverageLo) / max(W.coverageHi - W.coverageLo, 1e-4) - 0.2) / 0.8, 0.0, 1.0);
  return mix(c, W.horizon.w, horizonAt(uvc));
}
/** Coordinates in the wind frame, stretched along the wind by 1/along and across it by 1/across (bands and streets). */
fn windFrame(q: vec2<f32>, along: f32, across: f32) -> vec2<f32> {
  let wd = W.spec.zw;
  return vec2<f32>(dot(q, wd) / along, (q.x * wd.y - q.y * wd.x) / across);
}
// The carpet (stratocumulus, stratus) the cells stand on: the old map's fBm coverage with the P7-F dome ramp, times its weight (1 - cellular, or the
// species' deck weight). band (P9-C, stratocumulus): the fBm is read in the wind frame, stretched 3.5x along it, so the sheet breaks into long bands with gaps.
fn deckAt(uvc: vec2<f32>, dOff: vec2<f32>, weight: f32, band: f32) -> f32 {
  let q = uvc * W.scale + vec2<f32>(W.seed * 13.0, 0.0) + dOff;
  var fb = 0.0;
  if (band < 1.0) { fb = fbm(q); }
  if (band > 0.0) { fb = mix(fb, fbm(windFrame(q, 2.2, 0.6) + vec2<f32>(3.1, 7.7)), band); }
  let u = clamp(((fb - W.coverageLo) / max(W.coverageHi - W.coverageLo, 1e-4) - 0.2) / 0.8, 0.0, 1.0);
  // P9-C: the sheet's mass (so its thickness under the flat-top law) wanders over about a kilometre: thick and thin stretches of one sheet.
  let thick = 0.2 + 0.8 * fbmN(q * 3.1 + vec2<f32>(9.1, 4.4), 3);
  return pow(1.0 - pow(1.0 - u, 1.7), 1.6) * weight * thick;
}
// Regional species (G): a coarser fBm (0.6 of the cluster scale), stretched so regions reach both ends of the preset's range spec.xy, plus the bias.
// G rows (shaders.ts the SP_* species rows): 0 stratus, 0.25 stratocumulus, 0.5 humilis, 0.75 mediocris, 1 congestus. HZD s45: toward horizon.z far out.
fn speciesAt(uvc: vec2<f32>, dOff: vec2<f32>) -> f32 {
  let t = fbmN(uvc * W.scale * 0.6 + vec2<f32>(31.0, W.seed * 7.0) + dOff * 0.6, 3);
  let g = mix(W.spec.x, W.spec.y, clamp((t - 0.5) * 3.2 + 0.5 + W.species, 0.0, 1.0));
  return mix(g, W.horizon.z, horizonAt(uvc));
}
/**
 * P9-C horizontal species table (the weather's half of the species: the SP_* species rows is the vertical half), at the same G rows. Per cell (its species at
 * its centre): size (radius multiplier), pk (push on the growth state: + rising, tall, peaked; - decaying plateau), split (turret strength), elong
 * (footprint elongation) and align (0 random direction .. 1 along the wind), deck (weight of the carpet under the cells), presence of the big and of
 * the small size classes (mid in between).
 */
struct HRow { size: f32, pk: f32, split: f32, elong: f32, align: f32, deck: f32, presBig: f32, presSmall: f32, emul: f32 }
const H_STRATUS = HRow(1.3, -0.5, 0.0, 1.8, 0.5, 1.0, 0.3, 0.3, 1.0);  // stratus: a sheet; the few cells are broad swells in it
const H_STRATOCUMULUS = HRow(1.1, 0.05, 0.6, 3.2, 1.0, 0.8, 0.9, 0.9, 1.0);  // stratocumulus: a banded sheet, its lumps stretched 3:1 along the wind
const H_HUMILIS = HRow(0.7, -0.4, 0.2, 1.5, 0.2, 0.0, 0.15, 1.0, 1.0);  // humilis: small flat puffs, almost no big cells
const H_MEDIOCRIS = HRow(1.2, 0.05, 0.6, 1.6, 0.2, 0.0, 1.0, 1.0, 0.85);  // mediocris
const H_CONGESTUS = HRow(1.25, 0.5, 1.0, 1.3, 0.2, 0.0, 1.0, 0.4, 1.15);  // congestus: big cells pushed to rising towers with turrets; P9-C2: a peaked mass profile (emul 0.45 made plateaus: under the tower law a plateau is a flat-topped cylinder, and its wall cannot bulge), so a tower tapers up
fn hRowAt(i: u32) -> HRow {
  switch i {
    case 0u: { return H_STRATUS; }
    case 1u: { return H_STRATOCUMULUS; }
    case 2u: { return H_HUMILIS; }
    case 3u: { return H_MEDIOCRIS; }
    default: { return H_CONGESTUS; }
  }
}
fn hRow(g: f32) -> HRow {
  let x = clamp(g, 0.0, 1.0) * 4.0;
  let i = min(u32(x), 3u);
  let t = x - f32(i);
  let a = hRowAt(i); let b = hRowAt(i + 1u);
  return HRow(mix(a.size, b.size, t), mix(a.pk, b.pk, t), mix(a.split, b.split, t), mix(a.elong, b.elong, t), mix(a.align, b.align, t),
    mix(a.deck, b.deck, t), mix(a.presBig, b.presBig, t), mix(a.presSmall, b.presSmall, t), mix(a.emul, b.emul, t));
}
// ---- cells ----
// The mass profile of one cell: 1 at the centre, 0 at the rim (d = distance / radius). The rounded ramp is P7-F's: under the shape law f = s - h^p
// it is a mound with a tapered foot and a horizontal top. Raised to the cell's own exponent e: below 1 a plateau (wide, flat humilis), above 1 a peak (tower).
fn cellDome(d: f32, e: f32) -> f32 {
  let u = clamp(1.0 - d, 0.0, 1.0);
  return pow(pow(1.0 - pow(1.0 - u, 1.7), 1.6), e);
}
// Sub-lobe field: rounded bumps, one per jittered lattice point, radius 0.75-1.3 cells and height 0.65-1, max over the neighbourhood (0.3..1 inside a cloud).
fn lobes2(p: vec2<f32>, salt: u32) -> f32 {
  let i = vec2<i32>(floor(p));
  let f = fract(p);
  var m = 0.0;
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let c = i + vec2<i32>(x, y);
    let d = length(vec2<f32>(f32(x), f32(y)) + vec2<f32>(hashS(c, salt), hashS(c, salt + 1u)) - f);
    let t = max(0.0, 1.0 - d / (0.75 + 0.55 * hashS(c, salt + 2u)));
    m = max(m, (0.65 + 0.35 * hashS(c, salt + 3u)) * t * t * (3.0 - 2.0 * t));
  } }
  return m;
}
/**
 * One sparse layer of cells on a jittered lattice of across cells across the map. Each lattice cell holds a cloud with probability presence; its
 * feature point is jittered over the whole cell, its radius is rMin..rMax cells (so neighbouring domes rarely merge and the footprints spread), its
 * peak mass mMin..mMax, its profile exponent eMin..eMax (plateau .. tower, following the peak), its footprint an ellipse of up to 1:elong in a random
 * direction, its sub-lobe split up to split; all from hashes. The cluster field at the cell's
 * centre gates it (smoothstep gate0..gate1: 0 = absent) and shrinks and lowers it toward the cluster rim; the regional species makes congestus
 * cells bigger, taller and peakier. Evolving (on): P6-A's per-cell life cycle (grow over 22 percent, mature to 66, dissipate; restart with new
 * parameters while the envelope is zero, so nothing pops). Returns the max over the 3 x 3 neighbours of envelope * peak * profile.
 */
fn cellLayer(uvc: vec2<f32>, across: f32, salt: u32, presence: f32, rMin: f32, rMax: f32, mMin: f32, mMax: f32, eMin: f32, eMax: f32, elong: f32, gate0: f32, gate1: f32, split: f32, lt: f32, dOff: vec2<f32>) -> vec2<f32> {
  let off = vec2<f32>(W.seed * 3.7 + f32(salt) * 0.37, 1.3 + f32(salt) * 0.71);
  let p = uvc * across + off;
  let i = vec2<i32>(floor(p));
  let f = fract(p);
  let on = W.evoOn > 0.5;
  let spread = W.storm.z;
  // The sub-lobe field is a function of the layer's lattice coordinates, not of the cell: once per layer, not per neighbour.
  var sub = 1.0;
  if (split > 0.0) { sub = lobes2(p * 2.2 + vec2<f32>(f32(salt) * 0.13, 0.0), salt + 99u); }
  // The furthest a cell can reach (its long semi-axis; the radius is capped at rMax after the species, growth and gate factors), and the lattice
  // neighbourhood that covers it: 3 x 3 up to 1 cell (rMax 0.75 with elong 1.8), 5 x 5 beyond (2.8x the hashes).
  let reachMax = rMax * sqrt(elong);
  let n = select(1, 2, reachMax > 1.0);
  var m = vec2<f32>(0.0);
  for (var y = -n; y <= n; y++) { for (var x = -n; x <= n; x++) {
    let c = i + vec2<i32>(x, y);
    var env = 1.0;
    var s2 = salt + 16u;
    if (on) {
      let cyc = W.evo.x / (W.evo.y * (0.6 + 0.8 * hashS(c, salt + 3u))) + hashS(c, salt + 4u);
      let gen = floor(cyc);
      let u = cyc - gen;
      env = smoothstep(0.0, 0.22, u) * (1.0 - smoothstep(0.66, 1.0, u));
      s2 = salt + 16u + u32(gen) * 8u;
    }
    let h0 = hash2S(c, s2);          // presence, jitter x
    if (h0.x > presence || env <= 0.0) { continue; }
    let h1 = hash2S(c, s2 + 1u);     // jitter y, radius
    let jit = vec2<f32>(h0.y, h1.x);
    let v = vec2<f32>(f32(x), f32(y)) + jit - f;
    if (dot(v, v) >= reachMax * reachMax) { continue; }   // beyond the largest possible reach: skip before the cluster and species fBm (most of the neighbourhood)
    let centreUv = (vec2<f32>(c) + jit - off) / across;
    let g = smoothstep(gate0, gate1, clusterAt(centreUv, dOff));
    if (g <= 0.0) { continue; }
    let sp = speciesAt(centreUv, dOff);
    let hr = hRow(sp);
    // P9-C: the species' presence of this size class (humilis skies have almost no big cells, congestus few small ones).
    if (h0.x > presence * mix(hr.presBig, hr.presSmall, lt)) { continue; }
    let h2 = hash2S(c, s2 + 2u);     // peak, profile exponent jitter
    let h3 = hash2S(c, s2 + 3u);     // elongation direction, elongation
    // Growth state pk (0 decaying .. 1 rising): rising cells are tall, narrow and peaked; decaying ones low, wide plateaus (deck-scenes.md 2.3: the
    // growing / spreading pair is what a sky of one recipe lacks). The species (P9-C: congestus up, humilis and the stratiform down) and cluster cores push it.
    let pk = clamp(mix(0.5, h2.x, spread) + hr.pk + (g - 1.0) * 0.2, 0.0, 1.0);
    // Elliptical footprint: semi-axes r sqrt(a) along a direction and r / sqrt(a) across (cloud streets, no two outlines alike). The direction is
    // random, pulled toward the wind by the species (stratocumulus rolls); an elongation beyond the layer's narrows the cell so it stays in reach.
    let a = mix(1.0, max(elong, hr.elong), h3.y);
    // A species taller than the volume (dims.y metres) is shrunk across by the square root of the height it loses (down to half), so a short volume keeps more of its aspect ratios
    // (congestus in 512 m: narrower towers, not 1 km domes clipped flat) instead of clipping its height alone.
    let vr = speciesRow(sp);
    let fitK = sqrt(clamp(0.85 * W.dims.y / max(vr.depth, 1.0), 0.25, 1.0));
    let visDepth = min(vr.depth, W.dims.y);   // the row's depth as far as the volume shows it
    let r = min(min(mix(rMin, rMax, mix(0.5, h1.y, spread)) * mix(1.25, 0.75, pk) * mix(0.55, 1.0, g) * hr.size * fitK, rMax), reachMax / sqrt(a));
    var peak = mix(mMin, mMax, pk);
    var e = mix(eMin, eMax, clamp(pk * 0.75 + h2.y * 0.25, 0.0, 1.0)) * hr.emul;
    if (W.storm.x < 0.5) {
      // P9-C2 (tall rows, tallWeight): no cloud is taller than about 0.7-2 times its width. The column top of mass m is m^(1/p) of the row's depth, so a small cell of a tall
      // species (a 250 m cell under the congestus row's 1.65 km) was a thin tower: the "tree trunks". The peak is capped at that height.
      let rM = r / across * W.dims.x;
      // The aspect bound is the cell's own (height 0.7-2 times its width), so the capped cells do not all come out with one aspect ratio
      // (congestus towers measure 0.5-1.1 width:height, median 0.8, in the owner's photos: docs/research/photo-species-specs.md).
      let aspect = mix(1.4, 4.0, hash2S(c, s2 + 5u).x);
      peak = mix(peak, min(peak, pow(clamp(aspect * rM / max(visDepth, 1.0), 0.05, 1.0), vr.topExp)), tallWeight(visDepth));
      // And the tall species have no plateau cells: under the tower law a plateau is a flat-topped drum with vertical walls.
      e = max(e, smoothstep(550.0, 1300.0, visDepth));
    }
    let ang = h3.x * 3.14159265;
    let u0 = vec2<f32>(cos(ang), sin(ang));
    let wd = W.spec.zw * select(-1.0, 1.0, dot(u0, W.spec.zw) >= 0.0);   // the wind axis on u0's side (a footprint axis has no sign)
    let u = normalize(mix(u0, wd, hr.align) + vec2<f32>(1e-5, 0.0));
    let along = dot(v, u); let across2 = v.x * u.y - v.y * u.x;
    let d = sqrt(along * along / a + across2 * across2 * a) / max(r, 1e-3);
    if (d >= 1.0) { continue; }
    var prof = cellDome(d, e);
    if (split > 0.0) {
      // Turrets on rising cells; a decaying plateau stays one smooth lobe.
      let amp = min(split * (0.45 + 0.4 * hash2S(c, s2 + 4u).x) * pk * hr.split * 1.6, 0.9);
      prof = prof * (1.0 - amp * (1.0 - sub));
    }
    m = max(m, vec2<f32>(env * peak * prof, env * peak));
  } }
  return m;
}
/**
 * Upper layer (altocumulus, written to A). P9-C placed equal round cells on a near-regular lattice, which read as a polka-dot grid (acf peak 0.21 at
 * the cell spacing). P9-C2: altocumulus cells are regular-ish but vary in size and merge into rows, rolls and patches, so here:
 *   lattice   cells alto.y across the map, jittered by alto.w over the cell, read through a smooth domain warp (about half a cell over ~4 cells) so
 *             no row of cells stays straight; cells are missing toward a patch's edge and between clumps (a 3-cell fBm: dense merged zones and
 *             thin scatters, so the spacing is irregular);
 *   size      radius 0.18-0.5 of the spacing (skewed small: a few big cells among many small), larger in a patch's core, where neighbours overlap;
 *   merging   cells combine as a soft union (1 - prod(1 - a)), so overlapping rims bridge: clumps and rows instead of separate dots;
 *   rolls     (undulatus) crests across the wind about 2.6 cells apart with a wandering phase; cells are stretched along the crest and the mass
 *             thins in the troughs. Roll strength is regional, so some patches are rolls and some are floccus clumps;
 *   patches   an fBm at alto.z across the map read in the wind frame; cells shrink, thin out and drop out toward a patch's edge.
 */
fn altoAt(uvc: vec2<f32>, dOff: vec2<f32>) -> f32 {
  let q = uvc * W.alto.z + vec2<f32>(W.seed * 5.3, 17.0) + dOff;
  let pf = fbmN(windFrame(q, 1.8, 0.8), 4);
  let patchW = smoothstep(0.42, 0.66, pf) * W.alto.x;
  if (patchW <= 0.0) { return 0.0; }
  let pn = patchW / max(W.alto.x, 1e-3);   // 0 at a patch's edge .. 1 in its core
  let p0 = uvc * W.alto.y + vec2<f32>(W.seed * 2.9, 0.37);
  let wq = p0 * 0.23;
  let p = p0 + 1.1 * (vec2<f32>(fbmN(wq + vec2<f32>(1.7, 9.2), 2), fbmN(wq + vec2<f32>(8.3, 2.8), 2)) - 0.5);
  // Rolls: phase along the wind (crests lie across it), 2.6 cells apart, bent by a slow fBm; strength by region.
  let wf = windFrame(p0, 1.0, 1.0);
  let rollStr = smoothstep(0.38, 0.62, fbmN(q * 0.8 + vec2<f32>(4.4, 1.9), 2));
  let phase = wf.x / 2.6 + 1.4 * fbmN(vec2<f32>(wf.y * 0.12, wf.x * 0.04) + vec2<f32>(2.0, 5.0), 2);
  let roll = 0.5 + 0.5 * cos(6.2831853 * phase);
  let stretch = mix(1.1, 1.55, rollStr);
  // Clumps (P9-C2, photo specs: nearest-neighbour spacing CV 0.57-0.81, cells touching and merging in dense zones): a 3-cell fBm sets how many
  // lattice cells hold a cloud and how big they are, so dense, merged zones alternate with thin scatters.
  let clump = smoothstep(0.4, 0.6, fbmN(p0 * 0.25 + vec2<f32>(6.1, 2.4), 2));
  let keepP = mix(0.08, 0.97, clamp(0.3 * pn + clump, 0.0, 1.0));
  let i = vec2<i32>(floor(p));
  let f = fract(p);
  var keep = 1.0;   // prod(1 - a): the soft union
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let c = i + vec2<i32>(x, y);
    let h0 = hash2S(c, 61u);
    let h1 = hash2S(c, 62u);
    let h2 = hash2S(c, 63u);
    if (h1.y > keepP) { continue; }   // missing cells: more toward a patch's edge and between clumps
    let jit = vec2<f32>(0.5) + (h0 - 0.5) * W.alto.w;
    let v0 = windFrame(vec2<f32>(f32(x), f32(y)) + jit - f, 1.0, 1.0);
    // Each cell's own stretch (1 .. the roll's) and axis (+-25 degrees off the crest), so the cells are not one stamped flake.
    let h3 = hash2S(c, 64u);
    let sc = mix(1.0, stretch, h3.x);
    let ca = (h3.y - 0.5) * 0.87;
    let v = vec2<f32>(cos(ca) * v0.x - sin(ca) * v0.y, sin(ca) * v0.x + cos(ca) * v0.y);
    let r = min((0.15 + 0.3 * h2.x * h2.x + 0.22 * pn * pn + 0.18 * clump) * mix(1.0, mix(0.7, 1.2, roll), rollStr), 0.95 / sc);
    let d = length(vec2<f32>(v.x * sc, v.y / sc)) / r;
    // Peak 0.4-0.95 (skewed low) and profile exponent 0.6 (a flat floccus tuft) .. 1.6 (a castellanus turret): heights and aspects vary per cell.
    if (d < 1.0) { keep *= 1.0 - mix(0.4, 0.95, h1.x * h1.x) * cellDome(d, mix(0.6, 1.6, h2.y)); }
  } }
  let m = 1.0 - keep;
  return m * min(1.0, patchW * 1.5) * mix(1.0, mix(0.3, 1.1, roll), rollStr);
}
@compute @workgroup_size(8, 8, 1)
fn weatherMain(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= W.size.x || g.y >= W.size.y) { return; }
  let uv = W.uvOrigin + (vec2<f32>(f32(g.x), f32(g.y)) + 0.5) / vec2<f32>(f32(W.size.x), f32(W.size.y)) * W.uvSize;
  let on = W.evoOn > 0.5;
  let uvc = select(uv, uv - W.evo.zw, on);              // the pattern is advected; the window border (edge below) stays with the box
  let dOff = select(vec2<f32>(0.0), W.drift.xy * W.evo.x, on);
  let cs = W.cellScale;
  let split = W.storm.y;
  // Cells, large to small (x: mass, y: the owning cloud's peak): big mediocris only in cluster cores (peak 0.7-1, so their footprint is most of the
  // radius), mid cells, small humilis puffs (low peaks: 60-110 m tall, 100-200 m across) out to the cluster rims.
  // Profile exponents: big and mid cells are mounds to peaks (1 .. 1.7: a plateau at their size is a slab), small puffs may be plateaus (0.6 ..).
  // Peaks span 2-3x within a layer (heights 3x, widths 2x the other way: aspect ratios from flat sheets to towers), footprints up to 1.8x elongated.
  // P9-C: each cell's species (at its centre) scales its presence per size class, radius, growth state, turrets and elongation (the H_* rows).
  var cells = cellLayer(uvc, cs * 0.5, 1u, 0.8, 0.45, 0.75, 0.45, 1.0, 0.8, 1.7, 1.8, 0.15, 0.6, split, 0.0, dOff);
  cells = max(cells, cellLayer(uvc, cs, 2u, 0.8, 0.35, 0.75, 0.3, 1.0, 0.6, 1.6, 1.8, 0.05, 0.45, 0.6 * split, 0.5, dOff));
  cells = max(cells, cellLayer(uvc, cs * 2.0, 3u, 0.7, 0.4, 0.75, 0.18, 0.36, 0.55, 1.3, 1.6, 0.0, 0.3, 0.5 * split, 1.0, dOff));
  // Fractus: scraps of the finest layer in the band where the larger clouds' mass is low but not zero (their rims, just inside and outside the footprint).
  if (W.fractus > 0.0) {
    let band = smoothstep(0.0, 0.06, cells.x) * (1.0 - smoothstep(0.3, 0.5, cells.x));
    if (band > 0.0) {
      let scrap = cellLayer(uvc, cs * 4.0, 4u, 0.5, 0.35, 0.75, 0.18, 0.26, 0.6, 1.0, 1.5, 0.0, 0.3, 0.0, 1.0, dOff);
      cells = max(cells, W.fractus * band * scrap);
    }
  }
  let cloudType = speciesAt(uvc, dOff);
  // The carpet the cells stand on: 1 - cellular of the deck, or the species' own (stratus a sheet, stratocumulus bands), then the border fade.
  let hr = hRow(cloudType);
  let deckW = max(1.0 - W.cellular, hr.deck);
  var carpet = 0.0;
  if (deckW > 0.0) { carpet = deckAt(uvc, dOff, deckW, hr.align * smoothstep(0.5, 0.9, hr.deck) * (1.0 - smoothstep(0.9, 1.0, hr.deck))); }
  // A sheet species' cells are the lumps of its sheet: none in the gaps between its bands (stratocumulus gaps are clear sky).
  let lumps = cells.x * mix(1.0, smoothstep(0.0, 0.25 * max(deckW, 1e-3), carpet), hr.deck);
  let mass = carpet + lumps * (1.0 - carpet);
  // Billow weight (B when the heights are not in use, shaders.ts SHAPE): the mass of the cloud this column belongs to, 1 from mass 0.5 up.
  let billowW = min(1.0, 2.0 * max(cells.y, carpet));
  let edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  let edgeFade = select(1.0, smoothstep(0.0, W.border, edge), W.border > 0.0);
  let cov = mass * edgeFade;
  if (W.storm.x > 0.5) {
    // One condensation level: 0.08 of the volume with a regional +-15 m (of 512 m) wander.
    let base = 0.08 + 0.03 * (2.0 * fbm(uvc * W.scale * 0.5 + vec2<f32>(5.0, 3.0)) - 1.0);
    // Storm scene (P6-B/C): the field's heights as fractions of a taller volume (the base/top above are of a 512 m one); tops from a gentle fBm
    // (not from the mass: height ~ mass * dome law would make cones), the dome law rounds them. The cell itself is a 3D field in the generator.
    let k = 512.0 / W.dims.y;
    let bgTop = min(0.98, base + 0.22 + 0.38 * fbm(uvc * W.scale * 1.1 + vec2<f32>(11.0, 29.0)));
    textureStore(outTex, vec2<i32>(g.xy), vec4<f32>(cov, cloudType, base * k, min(0.98, bgTop * k)));
    return;
  }
  // A: the upper (altocumulus) layer's mass, 0 when it is off (P9-C; it was the unused top height before).
  var alto = 0.0;
  if (W.alto.x > 0.0) { alto = altoAt(uvc, dOff) * edgeFade; }
  textureStore(outTex, vec2<i32>(g.xy), vec4<f32>(cov, cloudType, billowW, alto));
}
`;