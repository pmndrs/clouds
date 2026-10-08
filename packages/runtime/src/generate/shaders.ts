// WGSL for the GPU NVDF generator. No three imports.
// The distance field is an exact separable EDT in one u16-per-voxel buffer (see EDT_COMMON); no jump flood, no seed buffers.

/**
 * Shared params block (PARAM_BYTES in volume-generator.ts, 144 bytes), one dynamic-offset slot per job. zStart/zCount: the job's chunk, a z range
 * (nvdf, edt x/y, profile, sdf) or a y range (edt z). `step` is unused. The first 9 words are what the stamp rebuilder fills (stamp.ts).
 * The storm words (P6-C) describe one cumulonimbus in the generator's own metres (pm space: voxel * voxelSize + origin, z up from the volume base).
 */
const PARAMS = /* wgsl */ `
struct Params {
  dims: vec3<u32>, step: i32,   // step: unused
  zStart: u32, zCount: u32, margin: f32, maxDist: f32,
  voxelSize: f32, covThreshold: f32, useHeights: f32, baseDefault: f32,
  topFrac: f32, domeExp: f32, billowAmp: f32, billowCell: f32,
  seed: f32, scaleBase: f32, scaleTop: f32, sigma: f32,
  detailBias: f32, baseLift: f32, originX: f32, originY: f32,   // origin: world metres of voxel (0,0) along x and the map row
  stormOn: f32, stormX: f32, stormY: f32, stormBase: f32,        // storm cell: on (> 0.5), centre (pm metres), base height above the volume base (m)
  stormR: f32, stormH: f32, anvilR: f32, stormPh: f32,           // mature tower radius / top height (m), mature anvil radius (m), life phase (age / grow)
  shearX: f32, shearY: f32, stormPad0: f32, stormPad1: f32,      // anvil spread direction (pm axes)
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
fn billow(pm: vec3<f32>) -> f32 { return billowAt(pm, P.billowCell, u32(P.seed * 131.0), 3u); }
/** anvil: 0 for the cumulus field and the storm's tower, 1 in the anvil (wispier detail, thinner); the profile pass reads it. */
struct Shape { s: f32, h: f32, f0: f32, f: f32, hcol: f32, base: f32, top: f32, cloudType: f32, anvil: f32, fade: f32 }
fn dome(h: f32, s: f32) -> f32 {
  // g(h): hemisphere-like height law; below the base a steep soft ramp (flat base: a ramp of about s/24 of the height, i.e. one or two voxels, so contours of the base do not stack into shelves).
  return select(-h * 24.0, pow(h, P.domeExp), h >= 0.0);
}
fn shapeAt(p: vec3<i32>, w: vec4<f32>, withNoise: bool) -> Shape {
  var r: Shape;
  r.cloudType = w.g;
  r.anvil = 0.0; r.fade = 1.0;
  r.base = P.baseDefault; r.top = P.topFrac;
  if (P.useHeights > 0.5) { r.base = w.b; r.top = w.a; }
  let pm = vec3<f32>(f32(p.x) + 0.5, f32(p.y) + 0.5, f32(p.z) + 0.5) * P.voxelSize + vec3<f32>(P.originX, P.originY, 0.0);
  let st = stormField(pm);
  r.s = clamp((w.r - P.covThreshold) / (1.0 - P.covThreshold), 0.0, 1.0) * (1.0 - st.sup);
  let hz = (f32(p.z) + 0.5) / f32(P.dims.z);
  // The base is flat in the middle of a lobe and curls up toward its rim (a concave underside; also trims the thin skirts around a cloud).
  r.base = r.base + P.baseLift * pow(1.0 - r.s, 1.5);
  r.h = (hz - r.base) / max(r.top - r.base, 1e-3);
  r.f0 = r.s - dome(r.h, r.s);
  // Fraction of the way up this column's own extent (column top is where s = h^p).
  r.hcol = clamp(r.h / pow(max(r.s, 0.05), 1.0 / P.domeExp), 0.0, 1.0);
  // Billow weight: strongest on tops and near the surface, none deep inside or far outside, none near the ceiling (so towers do not hit the volume top and get cut flat).
  var topW = mix(0.45, 1.0, smoothstep(0.1, 0.7, r.hcol)) * (1.0 - smoothstep(0.82, 1.0, r.h));
  var hasMass = r.s > 0.0;
  var band = vec4<f32>(0.18, 0.45, -0.55, -0.3);   // the band of f0 around the surface that the billow displaces
  if (st.f > r.f0) {
    // The storm cell owns this voxel: its own height fraction and type, its own billow weight (stormField), a wider band so the lobes are bigger.
    r.f0 = st.f; r.hcol = st.hf; r.h = st.hf; r.anvil = st.anvil; r.fade = st.fade;
    r.cloudType = mix(0.95, 0.6, st.anvil);
    topW = st.amp * mix(0.75, 1.0, smoothstep(0.05, 0.4, st.hf)) * (1.0 - smoothstep(0.88, 0.98, hz));
    band = mix(vec4<f32>(0.3, 0.7, -0.65, -0.3), band, st.anvil);
    hasMass = true;
  }
  r.f = r.f0;
  if (withNoise && P.billowAmp > 0.0 && r.f0 > band.z && r.f0 < band.y && hasMass) {
    let b = billow(pm);
    let near = (1.0 - smoothstep(band.x, band.y, r.f0)) * smoothstep(band.z, band.w, r.f0);
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
  // Smooth unit-ish noise, lattice-free (profileNoise), 36-48 m correlation.
  let pm = vec3<f32>(f32(p.x) + 0.5, f32(p.y) + 0.5, f32(p.z) + 0.5) * P.voxelSize + vec3<f32>(P.originX, P.originY, 0.0);
  let n = clamp(profileNoise(pm, P.voxelSize, u32(P.seed * 53.0)) * 3.4, -2.5, 2.5);
  let hf = sh.hcol;
  // The anvil is a plate of ice a few voxels thick: as a thin shell its profile would be low everywhere and the up-rez erosion would leave only the
  // detail noise's minima (a 100 m grid of dots), so its depth counts triple and its spread is reduced (P6-C). The 0.7 density scale keeps it translucent.
  let dEff = depth * mix(1.0, 1.0 + 2.0 * sh.fade, sh.anvil) * exp(P.sigma * (1.0 - 0.7 * sh.anvil) * n);
  let core = pow(clamp((dEff - 1.4) / 66.0, 0.0, 1.0), 1.05);
  let lift = 0.1 + 0.9 * smoothstep(0.0, 0.22, hf);
  let p8 = max(round(clamp(core * lift, 0.0, 1.0) * 255.0), 1.0);
  let detail = clamp(smoothstep(0.1, 0.75, hf - 0.25 * clamp(depth / 32.0, 0.0, 1.0)) + (sh.cloudType - 0.5) * P.detailBias, 0.0, 1.0);
  // The anvil is ice: thinner than the tower, fading out toward its rim (P6-C).
  let scale = mix(P.scaleBase, P.scaleTop, smoothstep(0.0, 0.6, hf)) * mix(1.0, 0.7 * (0.3 + 0.7 * sh.fade), sh.anvil);
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
  cellScale: f32, evoOn: f32, p1: f32, p2: f32,
  uvOrigin: vec2<f32>, uvSize: vec2<f32>,   // window of the map's own uv space this texture shows (default 0,0 / 1,1)
  evo: vec4<f32>,    // evolution: time (s), life cycle (s), pattern advection (uv, x then y)
  drift: vec4<f32>,  // evolution: fBm drift per second (uv units of the fBm domain, x then y), unused zw
  storm: vec4<f32>,  // x: storm field (> 0.5): the low field of a storm scene (P6-C: the cell itself is a 3D field in the generator, shaders.ts STORM_WGSL); unused yzw
  dims: vec4<f32>,   // metres spanned by uv 0..1, height of the volume in metres (storm only: the heights are written as fractions of it), unused zw
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
fn hashS(p: vec2<i32>, salt: u32) -> f32 {
  var h = u32(p.x) * 374761393u + u32(p.y) * 668265263u + (u32(W.seed * 977.0) + salt * 3266489917u) * 2246822519u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h = h ^ (h >> 16u);
  h = (h ^ (h >> 15u)) * 2246822519u;
  h = h ^ (h >> 13u);
  return f32(h) * (1.0 / 4294967295.0);
}
// Evolving cellular mass: every Worley cell carries a cumulus with its own life cycle (grows over the first 22 percent, mature to 66
// percent, dissipates over the rest). A cell restarts each cycle with a new jitter, strength and radius while its envelope is zero, so
// nothing pops. The result is the max over the 3 x 3 neighbours of envelope * dome(distance), continuous in space and time.
fn evolvingCells(p: vec2<f32>, t: f32, life: f32) -> f32 {
  let i = vec2<i32>(floor(p));
  let f = fract(p);
  var m = 0.0;
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let c = i + vec2<i32>(x, y);
    let cyc = t / (life * (0.6 + 0.8 * hashS(c, 3u))) + hashS(c, 4u);
    let gen = floor(cyc);
    let u = cyc - gen;
    let salt = 16u + u32(gen) * 8u;
    let jit = vec2<f32>(hashS(c, salt), hashS(c, salt + 1u));
    let str = 0.95 + 0.4 * hashS(c, salt + 2u);
    let rad = 1.25 * (0.8 + 0.4 * hashS(c, salt + 3u));
    let env = smoothstep(0.0, 0.22, u) * (1.0 - smoothstep(0.66, 1.0, u));
    let d = length(vec2<f32>(f32(x), f32(y)) + jit - f);
    m = max(m, env * str * clamp(1.0 - d * rad, 0.0, 1.0));
  } }
  return m;
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
  let on = W.evoOn > 0.5;
  let uvc = select(uv, uv - W.evo.zw, on);              // the pattern is advected; the window border (edge below) stays with the box
  let q = uvc * W.scale;
  let fb = fbm(q + vec2<f32>(W.seed * 13.0, 0.0) + select(vec2<f32>(0.0), W.drift.xy * W.evo.x, on));
  // Cellular mass: one dome per Worley cell (cumulus lobes), modulated by fBm so cells differ in size and some die out.
  var cell: f32;
  if (on) { cell = evolvingCells(uvc * W.cellScale + vec2<f32>(W.seed * 3.7, 1.3), W.evo.x, W.evo.y); }
  else { cell = 1.0 - clamp(worleyF1(uv * W.cellScale + vec2<f32>(W.seed * 3.7, 1.3)) * 1.25, 0.0, 1.0); }
  let n = mix(fb, clamp(0.25 + 0.75 * cell * (0.45 + 1.1 * fb), 0.0, 1.0), W.cellular);
  let edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  // Wide ramp (no saturation plateau): coverage stays a smooth, peaked mass field. Fade to nothing near the border.
  // Rounded mass profile. The shape stage builds the cloud as f = cov - h^p, so cov must itself be the dome profile: with u the linear ramp
  // (a cone over a Worley cell) and cov = (u (2 - u))^0.8, a column of mass u reaches height h = sqrt(u (2 - u))^(0.8 / p * 2), which for the
  // cumulus exponent p = 1.6 is a hemisphere (r = R sqrt(1 - h^2)): widest at the base, tangent-horizontal at the top, no saturation plateau
  // (the old smoothstep ramp made vertical-walled columns with flat tops) and no straight creases (the cone's ridge never reaches the surface).
  // The ramp starts at 0.2 of the lo..hi range: the old smoothstep ramp was ~0 over its first fifth, and the dome profile rises at once, so this keeps the footprint where the presets tuned it.
  let u = clamp(((n - W.coverageLo) / max(W.coverageHi - W.coverageLo, 1e-4) - 0.2) / 0.8, 0.0, 1.0);
  let cov = pow(1.0 - pow(1.0 - u, 1.7), 1.6) * select(1.0, smoothstep(0.0, W.border, edge), W.border > 0.0);
  let t = fbm(q * 0.7 + vec2<f32>(31.0, W.seed * 7.0));
  let cellType = 1.0 - clamp(worleyF1(q * 1.6) * 1.3, 0.0, 1.0);
  let cloudType = clamp(0.6 * t + 0.5 * cellType - 0.05, 0.0, 1.0);
  let base = 0.06 + 0.14 * fbm(q * 1.3 + vec2<f32>(5.0, 3.0));
  let top = min(0.98, base + 0.2 + 0.7 * cov * (0.55 + 0.45 * fbm(q * 1.1 + vec2<f32>(11.0, 29.0))));
  if (W.storm.x > 0.5) {
    // Storm scene (P6-B/C): the field's heights as fractions of a taller volume (the base/top above are of a 512 m one); tops from a gentle fBm
    // (not from the mass: height ~ mass * dome law would make cones), the dome law rounds them. The cell itself is a 3D field in the generator.
    let k = 512.0 / W.dims.y;
    let bgTop = min(0.98, base + 0.22 + 0.38 * fbm(q * 1.1 + vec2<f32>(11.0, 29.0)));
    textureStore(outTex, vec2<i32>(g.xy), vec4<f32>(cov, cloudType, base * k, min(0.98, bgTop * k)));
    return;
  }
  textureStore(outTex, vec2<i32>(g.xy), vec4<f32>(cov, cloudType, base, top));
}
`;
