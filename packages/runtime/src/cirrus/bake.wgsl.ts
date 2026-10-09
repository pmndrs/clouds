import { COMMON_WGSL } from '../shaders/common.wgsl';

/**
 * P9-E: the cirrus layer's tiling noise set, baked once on the GPU in row slices (no frame stall), then mip-mapped.
 * One rgba8unorm tile, square, x = along the layer's wind (the streak direction), y = across it. Nubis Evolved p.65 keeps three
 * thin-cloud noises selected by a type (streaky, wispy, round); this bakes ours:
 *   r = streaky: brush strokes (P9-E2): a few broad sweeps and more medium strokes with some uncinus hooks, over open sky; each stroke has
 *       its own curved centre line, tapered width, feathered edge and fibres along itself (see strokes());
 *   g = wispy: shorter, wider, more curved and fanned strokes with ragged edges;
 *   b = round: small cells (cirrocumulus-like puffs, about 8 texels) in patches;
 *   a = fine detail (low-contrast anisotropic fbm, mean about 0.5, no ridges), read at 4x the frequency as a multiplier.
 * Every noise is periodic in the tile (integer lattice periods per axis), so the tile wraps without seams; domain warps are periodic too.
 */
export const CIRRUS_BAKE_WGSL = /* wgsl */ `
${COMMON_WGSL}
struct BakeParams { rowStart: u32, rows: u32, size: u32, seed: u32 }
@group(0) @binding(0) var<uniform> bp: BakeParams;
@group(0) @binding(1) var outTex: texture_storage_2d<rgba8unorm, write>;

fn wrapI(a: i32, n: i32) -> i32 { return ((a % n) + n) % n; }
fn hashCell(x: i32, y: i32, s: u32) -> u32 { return pcg(pcg(bitcast<u32>(x) ^ (s * 0x9E3779B9u)) ^ (bitcast<u32>(y) * 0x85EBCA6Bu)); }
fn h01(x: i32, y: i32, s: u32) -> f32 { return f32(hashCell(x, y, s)) / 4294967296.0; }
fn gradAt(x: i32, y: i32, s: u32) -> vec2<f32> { let a = h01(x, y, s) * 6.2831853; return vec2(cos(a), sin(a)); }
// Periodic gradient noise, about [-0.7, 0.7]. period = lattice cells per tile on each axis.
fn gnoise(p: vec2<f32>, period: vec2<i32>, s: u32) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let ix = i32(i.x); let iy = i32(i.y);
  let x0 = wrapI(ix, period.x); let x1 = wrapI(ix + 1, period.x);
  let y0 = wrapI(iy, period.y); let y1 = wrapI(iy + 1, period.y);
  let a = dot(gradAt(x0, y0, s), f);
  let b = dot(gradAt(x1, y0, s), f - vec2(1.0, 0.0));
  let c = dot(gradAt(x0, y1, s), f - vec2(0.0, 1.0));
  let d = dot(gradAt(x1, y1, s), f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// fbm in [0, 1] over a tile coordinate uv in [0, 1): base frequency f (cells per tile per axis), octaves n.
fn fbm(uv: vec2<f32>, f: vec2<f32>, n: i32, s: u32) -> f32 {
  var sum = 0.0; var amp = 0.5; var norm = 0.0; var fr = f;
  for (var k = 0; k < n; k++) {
    sum += amp * gnoise(uv * fr, vec2<i32>(fr), s + u32(k) * 17u);
    norm += amp; amp *= 0.5; fr *= 2.0;
  }
  return saturate(0.5 + 0.75 * sum / norm);
}
fn wrapD(d: f32) -> f32 { return d - round(d); }   // shortest periodic difference in tile units

// Non-periodic noise for stroke-local coordinates (a stroke tiles as a whole, so its own texture needs no lattice period).
fn gnoiseL(p: vec2<f32>, s: u32) -> f32 { return gnoise(p, vec2<i32>(65536), s); }
fn fbmL(p: vec2<f32>, n: i32, s: u32) -> f32 {
  var sum = 0.0; var amp = 0.5; var norm = 0.0; var q = p;
  for (var k = 0; k < n; k++) {
    sum += amp * gnoiseL(q, s + u32(k) * 31u);
    norm += amp; amp *= 0.5; q = q * 2.03 + vec2(17.1, 3.7);
  }
  return saturate(0.5 + 0.75 * sum / norm);
}

// P9-E2 brush strokes. One candidate stroke per cell (nu along the wind x nv across); a stroke is a curved centre line (a polyline of
// SEG segments, heading theta(t) = a0 + k1 t + k2 t^2, plus a curl at the head for hooks), a width that tapers to points, a feathered edge
// (eroded by a coarse noise and pushed out along the fibres), and fibres that run along its own centre line (so every stroke has its own
// grain direction and spacing, never one global set of parallel lines). Strokes merge as a soft union.
struct StrokeSet {
  nu: i32, nv: i32, su: i32, sv: i32,        // cells along, across; neighbour search along, across
  prob: f32, lenLo: f32, lenHi: f32, wLo: f32,  // stroke per cell probability; length range; width range (tile units)
  wHi: f32, ang: f32, curv: f32, hook: f32,    // heading spread (rad), curvature (rad over the stroke), hook probability
  feather: f32, fibre: f32, fibreAcross: f32, seed: u32,  // edge feathering, fibre contrast, fibre frequency across (per tile unit)
}
const SEG = 16;
// Width (x) and density (y) along a stroke, t in [0, 1] from the head. Ordinary strokes taper to points around a random swell; a hook's head
// is a dense tuft and its tail thins and fades (the uncinus comma).
fn strokeWidth(t: f32, W: f32, L: f32, isHook: bool, skew: f32) -> vec2<f32> {
  if (isHook) {
    // A round head: the width grows as a circle cap over the head's own radius (in t units), not over a fixed share of the length.
    let wh = W * (0.25 + 1.2 * exp(-t / 0.12));
    let t0 = clamp(0.9 * W / L, 0.01, 0.45);
    let c = 1.0 - min(t / t0, 1.0);
    return vec2(wh * sqrt(saturate(1.0 - c * c)) * (1.0 - smoothstep(0.75, 1.0, t)), mix(0.08, 1.25, exp(-t / 0.22)));
  }
  let tt = pow(t, skew);
  return vec2(W * pow(sin(PI * clamp(tt, 0.0, 1.0)), 0.8), smoothstep(0.0, 0.25, tt) * (1.0 - smoothstep(0.6, 1.0, tt)));
}
fn strokeHeading(t: f32, a0: f32, k1: f32, k2: f32, curl: f32, cw: f32) -> f32 {
  // t in [0, 1] from the head (upwind end) to the tail. The curl bends the head across the wind (the uncinus comma).
  return a0 + k1 * (t - 0.5) + k2 * ((t - 0.5) * (t - 0.5) - 0.0833) + curl * exp(-t / cw);
}
fn strokes(uv: vec2<f32>, S: StrokeSet) -> f32 {
  let cu = i32(floor(uv.x * f32(S.nu)));
  let cv = i32(floor(uv.y * f32(S.nv)));
  var keep = 1.0;
  for (var du = -S.su; du <= S.su; du++) {
    for (var dv = -S.sv; dv <= S.sv; dv++) {
      let cx = wrapI(cu + du, S.nu); let cy = wrapI(cv + dv, S.nv);
      let r0 = h01(cx, cy, S.seed);
      if (r0 > S.prob) { continue; }
      let r1 = h01(cx, cy, S.seed + 1u); let r2 = h01(cx, cy, S.seed + 2u); let r3 = h01(cx, cy, S.seed + 3u);
      let r4 = h01(cx, cy, S.seed + 4u); let r5 = h01(cx, cy, S.seed + 5u); let r6 = h01(cx, cy, S.seed + 6u);
      let r7 = h01(cx, cy, S.seed + 7u); let r8 = h01(cx, cy, S.seed + 8u); let r9 = h01(cx, cy, S.seed + 9u);
      // Unwrapped cell position (the wrapped index only seeds the hash): with few cells per tile, two neighbours can be the same
      // wrapped cell, and must then be two periodic images of the stroke, not the same one twice.
      let mid = vec2((f32(cu + du) + r1) / f32(S.nu), (f32(cv + dv) + r2) / f32(S.nv));
      let rel = uv - mid;
      let L = mix(S.lenLo, S.lenHi, r3);
      let W = mix(S.wLo, S.wHi, r4 * r4);
      if (length(rel) > 0.5 * L + 3.3 * W) { continue; }
      let isHook = r5 < S.hook;
      let a0 = (r6 - 0.5) * 2.0 * S.ang;
      let k1 = (r7 - 0.5) * 2.0 * S.curv;
      let k2 = (r8 - 0.5) * 2.0 * S.curv;
      let curl = select(0.0, select(-1.0, 1.0, r9 > 0.5) * mix(0.9, 1.5, r1), isHook);
      let cw = mix(0.14, 0.24, r2);
      // The head is the upwind end (+x): walk the centre line from the head downwind (heading pi + theta).
      let ds = L / f32(SEG);
      // First pass: the midpoint's offset from the head, so the stroke is centred on its cell point.
      var pm = vec2(0.0);
      for (var k = 0; k < SEG / 2; k++) {
        let th = strokeHeading((f32(k) + 0.5) / f32(SEG), a0, k1, k2, curl, cw);
        pm -= ds * vec2(cos(th), sin(th));
      }
      var a = -pm;    // the head, relative to the midpoint
      // Each segment scores its own width-normalised distance weighted by the density along the stroke there; the stroke-local
      // coordinates are a sharp soft-max blend over the segments. Everything stays continuous where the nearest part of a curled stroke
      // switches (a tapered end vs its body, the two arms of a hook), so neither the edge nor the fibres show a seam.
      let skew = mix(0.55, 1.8, r7);
      var wsum = 0.0; var e0 = 0.0; var bt = 0.0; var bn = 0.0; var along = 0.0;
      for (var k = 0; k < SEG; k++) {
        let th = strokeHeading((f32(k) + 0.5) / f32(SEG), a0, k1, k2, curl, cw);
        let dir = -vec2(cos(th), sin(th));
        let b = a + ds * dir;
        let rr = rel - a;
        let hl = dot(rr, dir) / ds;
        let h = clamp(hl, 0.0, 1.0);
        let off = rr - dir * (h * ds);
        let t = (f32(k) + h) / f32(SEG);
        let wa = strokeWidth(t, W, L, isHook, skew);
        let ek = length(off) / max(wa.x, 1e-6);
        let sc = wa.y * exp(-ek * ek);
        let wk = sc * sc * sc;
        wsum += wk; e0 += wk * ek; bt += wk * (f32(k) + hl) / f32(SEG); bn += wk * (dir.x * rr.y - dir.y * rr.x); along += wk * wa.y;
        a = b;
      }
      if (wsum < 1e-30) { continue; }   // far from the whole stroke
      e0 /= wsum; bt = clamp(bt / wsum, 0.0, 1.0); bn /= wsum; along /= wsum;
      if (e0 > 2.2) { continue; }
      // Stroke-local coordinates (tile units): s along the centre line, n across it. Per-stroke noise offsets.
      let s = bt * L;
      let ofs = vec2(r3 * 911.0, r4 * 577.0);
      // Fibres: anisotropic fbm (streaks of uneven spacing that start and stop), along the stroke.
      let fib = fbmL(vec2(s * S.fibreAcross * 0.06, bn * S.fibreAcross) + ofs, 3, S.seed + 40u);
      let fs = smoothstep(0.32, 0.78, fib);
      // A coarse lumpy erosion of the edge (feathery, not a clean tube) and a slow brightness variation along the stroke.
      let en = fbmL(vec2(s * 22.0, bn * 30.0) + ofs * 1.7, 3, S.seed + 50u);
      let lum = fbmL(vec2(s * 12.0, bn * 8.0) + ofs, 3, S.seed + 60u);
      let e = e0 + S.feather * (0.6 * (0.5 - en) - 0.7 * (fs - 0.5));
      let prof = pow(smoothstep(1.1, -0.2, e), 1.5) + 0.18 * exp(-e0 * e0 * 0.8);
      let inten = mix(0.4, 1.0, r9) * along * mix(0.3, 1.25, smoothstep(0.2, 0.8, lum));
      let dens = inten * prof * (1.0 - S.fibre + S.fibre * (0.35 + 0.85 * fs));
      keep *= 1.0 - saturate(dens);
    }
  }
  return 1.0 - keep;
}

// Small cells for the round type: periodic Worley F1 over N x N cells.
fn worley(uv: vec2<f32>, n: i32, s: u32) -> vec2<f32> {
  let p = uv * f32(n);
  let i = vec2<i32>(floor(p));
  var best = 9.0; var size = 1.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let c = i + vec2(x, y);
      let w = vec2(wrapI(c.x, n), wrapI(c.y, n));
      let o = vec2(h01(w.x, w.y, s), h01(w.x, w.y, s + 1u));
      let d = length(vec2<f32>(c) + o - p);
      if (d < best) { best = d; size = 0.4 + 0.7 * h01(w.x, w.y, s + 2u); }
    }
  }
  return vec2(best, size);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let y = bp.rowStart + gid.y;
  if (gid.x >= bp.size || gid.y >= bp.rows || y >= bp.size) { return; }
  let uv = (vec2<f32>(f32(gid.x), f32(y)) + 0.5) / f32(bp.size);
  let s = bp.seed * 977u;

  // ---- streaky (fibratus + uncinus): brush strokes ----
  // A few broad sweeps (12-36 km long, 1.5-5 km wide) and more medium strokes (5-14 km, 0.5-1.8 km) with some hooks, over open sky.
  let w0 = vec2(fbm(uv, vec2(3.0, 3.0), 3, s + 100u), fbm(uv, vec2(3.0, 3.0), 3, s + 200u)) - 0.5;
  let q = uv + vec2(0.03, 0.05) * w0;
  let broad = strokes(q, StrokeSet(4, 14, 2, 6, 0.45, 0.2, 0.5, 0.012, 0.045, 0.22, 0.5, 0.0, 0.8, 0.45, 420.0, s + 500u));
  let medium = strokes(q, StrokeSet(8, 26, 2, 5, 0.28, 0.06, 0.17, 0.006, 0.022, 0.3, 0.9, 0.22, 0.9, 0.5, 520.0, s + 600u));
  let streaky = saturate(1.0 - (1.0 - broad) * (1.0 - 0.9 * medium));

  // ---- wispy (feathery strokes: shorter, wider, more curved and fanned, ragged edges) ----
  let ww = vec2(fbm(uv, vec2(5.0, 5.0), 4, s + 1100u), fbm(uv, vec2(5.0, 5.0), 4, s + 1200u)) - 0.5;
  let ww2 = vec2(fbm(uv, vec2(14.0, 14.0), 2, s + 1300u), fbm(uv, vec2(14.0, 14.0), 2, s + 1400u)) - 0.5;
  let qw = uv + vec2(0.04, 0.04) * ww;
  let wA = strokes(qw, StrokeSet(6, 10, 2, 3, 0.45, 0.08, 0.22, 0.02, 0.055, 0.6, 1.6, 0.12, 1.3, 0.55, 380.0, s + 1500u));
  let wB = strokes(qw, StrokeSet(10, 18, 2, 3, 0.3, 0.04, 0.1, 0.008, 0.025, 0.7, 2.2, 0.3, 1.2, 0.5, 480.0, s + 1600u));
  let wispy = saturate(1.0 - (1.0 - wA) * (1.0 - 0.85 * wB));

  // ---- round (small cells in patches) ----
  // Cells of varied size and brightness, some missing, grouped into patches.
  // Two fully jittered cell sets of different sizes, so no lattice shows.
  let wr = worley(uv + 0.006 * ww, 230, s + 1800u);
  let wr2 = worley(uv + 0.004 * ww2, 340, s + 1820u);
  let puff = max(pow(saturate(1.0 - wr.x / (0.55 * wr.y)), 1.2), 0.8 * pow(saturate(1.0 - wr2.x / (0.5 * wr2.y)), 1.2));
  let grain = smoothstep(0.3, 0.75, fbm(uv, vec2(48.0, 48.0), 3, s + 1850u));
  let patchR = smoothstep(0.42, 0.75, fbm(uv, vec2(5.0, 7.0), 4, s + 1900u));
  let roundT = saturate((puff * grain * 1.3 + 0.15 * grain) * patchR);

  // ---- fine detail (read at 4x frequency by the renderer): low-contrast streaky fbm, uneven spacing (no ridges, no regular lines) ----
  let qf = uv + vec2(0.02, 0.04) * w0;
  let fa = fbm(qf, vec2(6.0, 40.0), 4, s + 2000u);
  let fb = fbm(qf + vec2(0.37, 0.11), vec2(12.0, 64.0), 3, s + 2100u);
  let fine = saturate(0.5 + 1.1 * (0.6 * fa + 0.4 * fb - 0.5));

  textureStore(outTex, vec2<i32>(i32(gid.x), i32(y)), vec4(streaky, wispy, roundT, fine));
}
`;

/** 2x2 box downsample of one mip level into the next (rgba8unorm). */
export const CIRRUS_MIP_WGSL = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba8unorm, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let size = textureDimensions(dst);
  if (gid.x >= size.x || gid.y >= size.y) { return; }
  let p = vec2<i32>(gid.xy) * 2;
  let c = textureLoad(src, p, 0) + textureLoad(src, p + vec2(1, 0), 0) + textureLoad(src, p + vec2(0, 1), 0) + textureLoad(src, p + vec2(1, 1), 0);
  textureStore(dst, vec2<i32>(gid.xy), c * 0.25);
}
`;
