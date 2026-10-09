import { COMMON_WGSL } from '../shaders/common.wgsl';

/**
 * P9-E: the cirrus layer's tiling noise set, baked once on the GPU in row slices (no frame stall), then mip-mapped.
 * One rgba8unorm tile, square, x = along the layer's wind (the streak direction), y = across it. Nubis Evolved p.65 keeps three
 * thin-cloud noises selected by a type (streaky, wispy, round); this bakes ours:
 *   r = streaky: fibratus streak bundles (long anisotropic ridged fibres, curved by a domain warp, grouped by an elongated envelope)
 *       and uncinus hooks ("mares' tails": a tufted head that curls, then a long fading tail with fibres along it);
 *   g = wispy: feathery patches (warped fbm) combed by fibres that follow the warp;
 *   b = round: small cells (cirrocumulus-like puffs, about 8 texels) in patches;
 *   a = fine fibre detail (very anisotropic ridged noise, mean about 0.5), read at 4x the frequency as a multiplier.
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
// Ridged fibres: thin bright lines where the noise crosses zero, 1 on the ridge.
fn ridge(uv: vec2<f32>, f: vec2<f32>, s: u32, sharp: f32) -> f32 {
  let n = gnoise(uv * f, vec2<i32>(f), s);
  return pow(saturate(1.0 - abs(n) * 2.2), sharp);
}
fn wrapD(d: f32) -> f32 { return d - round(d); }   // shortest periodic difference in tile units

// Uncinus hooks: one candidate head per cell (NU along the wind x NV across), each with a tail that runs downwind (-x) and a curl at the head.
const HOOK_NU = 6;
const HOOK_NV = 14;
fn hooks(uv: vec2<f32>, s: u32) -> f32 {
  let cu = i32(floor(uv.x * f32(HOOK_NU)));
  let cv = i32(floor(uv.y * f32(HOOK_NV)));
  var best = 0.0;
  for (var du = -1; du <= 4; du++) {   // -1: the head's front (sT < 0) reaches back into the previous cell
    for (var dv = -3; dv <= 3; dv++) {
      let cx = wrapI(cu + du, HOOK_NU); let cy = wrapI(cv + dv, HOOK_NV);
      let r0 = h01(cx, cy, s);
      if (r0 > 0.18) { continue; }   // a few cells hold a hook
      let r1 = h01(cx, cy, s + 1u); let r2 = h01(cx, cy, s + 2u); let r3 = h01(cx, cy, s + 3u); let r4 = h01(cx, cy, s + 4u); let r5 = h01(cx, cy, s + 5u);
      let head = vec2((f32(cx) + r1) / f32(HOOK_NU), (f32(cy) + r2) / f32(HOOK_NV));
      let L = mix(1.2, 3.0, r3) / f32(HOOK_NU);                      // tail length
      let sh = mix(0.22, 0.4, r4) * L;                                  // length of the curl at the head
      let hookH = select(-1.0, 1.0, r5 > 0.5) * mix(0.3, 0.8, r0 / 0.18) / f32(HOOK_NV);
      let sag = (r1 - 0.5) * 1.2 / f32(HOOK_NV);                        // the tail's own gentle curve
      let x = wrapD(head.x - uv.x);                                     // distance behind the head along the wind
      let sT = x / L;
      if (sT < -0.08 || sT > 1.0) { continue; }
      let xc = max(x, 0.0);
      // The curl: a smooth S from the head's offset down to the tail's line (slope at most 1.5 hookH / sh, no kink).
      let k = 1.0 - smoothstep(0.0, sh, xc);
      let xs = saturate(xc / sh);
      let c = hookH * k + sag * sT * sT;
      let slope = -6.0 * hookH / sh * xs * (1.0 - xs) + 2.0 * sag * sT / L;
      let perp = wrapD(uv.y - head.y - c) / sqrt(1.0 + slope * slope);
      let w = mix(0.3, 0.14, saturate(sT * 1.5)) / f32(HOOK_NV) * mix(0.7, 1.3, r2);
      let along = smoothstep(-0.06, 0.03, sT) * pow(1.0 - sT, 1.3) * (1.0 + 0.5 * k);   // the head (tuft) is the densest part
      // Fibres along the tail: striations parallel to it.
      // The ribbon breaks into fibres along it, and fades in and out (never a solid tube).
      let fib = 0.45 + 0.55 * ridge(vec2(uv.x, perp + head.y), vec2(9.0, 380.0), s + 9u, 1.5);
      let flick = smoothstep(0.25, 0.65, fbm(vec2(uv.x, perp + head.y), vec2(18.0, 60.0), 2, s + 11u));
      best = max(best, exp(-(perp / w) * (perp / w)) * along * fib * mix(0.35, 1.0, flick));
    }
  }
  return best;
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
      let d = length(vec2<f32>(c) + 0.15 + 0.7 * o - p);
      if (d < best) { best = d; size = 0.6 + 0.6 * h01(w.x, w.y, s + 2u); }
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

  // ---- streaky (fibratus + uncinus) ----
  // Large warp: the streaks curve and fan instead of running ruler-straight.
  let w0 = vec2(fbm(uv, vec2(3.0, 3.0), 3, s + 100u), fbm(uv, vec2(3.0, 3.0), 3, s + 200u)) - 0.5;
  let w1 = vec2(fbm(uv, vec2(8.0, 6.0), 2, s + 300u), fbm(uv, vec2(8.0, 6.0), 2, s + 400u)) - 0.5;
  let q = uv + vec2(0.05, 0.10) * w0 + vec2(0.008, 0.02) * w1;
  // Bundles: sparse elongated patches a few streaks wide, with a soft sheet of their own.
  let bundle = smoothstep(0.47, 0.84, fbm(q, vec2(2.0, 16.0), 5, s + 500u));
  // Fibres: ridges at three scales, each switched on and off along its length by its own noise (they start, fade and restart).
  let f1 = ridge(q, vec2(4.0, 90.0), s + 600u, 2.5) * smoothstep(0.35, 0.7, fbm(q, vec2(6.0, 90.0), 2, s + 610u));
  let f2 = ridge(q, vec2(8.0, 200.0), s + 700u, 2.5) * smoothstep(0.35, 0.7, fbm(q, vec2(12.0, 200.0), 2, s + 710u));
  let f3 = ridge(q, vec2(16.0, 420.0), s + 800u, 2.0) * smoothstep(0.35, 0.7, fbm(q, vec2(24.0, 420.0), 2, s + 810u));
  let fibres = max(f1, max(0.8 * f2, 0.6 * f3));
  let fibratus = bundle * saturate(0.5 + 0.6 * fibres);
  let hook = hooks(q, s + 1000u);
  let streaky = saturate(max(fibratus, hook * 0.85));

  // ---- wispy (feathery patches combed by fibres along the warp) ----
  let ww = vec2(fbm(uv, vec2(5.0, 5.0), 4, s + 1100u), fbm(uv, vec2(5.0, 5.0), 4, s + 1200u)) - 0.5;
  let qw = uv + vec2(0.06, 0.06) * ww;
  let ww2 = vec2(fbm(qw, vec2(14.0, 14.0), 2, s + 1300u), fbm(qw, vec2(14.0, 14.0), 2, s + 1400u)) - 0.5;
  let qw2 = qw + vec2(0.012, 0.03) * ww2;
  let patchW = smoothstep(0.42, 0.82, fbm(qw, vec2(6.0, 9.0), 5, s + 1500u));
  let combs = 0.6 * ridge(qw2, vec2(16.0, 150.0), s + 1600u, 1.6) + 0.4 * ridge(qw2, vec2(32.0, 330.0), s + 1700u, 1.4);
  let wispy = saturate(patchW * (0.35 + 0.8 * combs));

  // ---- round (small cells in patches) ----
  // Cells of varied size and brightness, some missing, grouped into patches.
  let wr = worley(uv + 0.006 * ww, 150, s + 1800u);
  let puff = pow(saturate(1.0 - wr.x / (0.62 * wr.y)), 1.2);
  let grain = smoothstep(0.3, 0.75, fbm(uv, vec2(48.0, 48.0), 3, s + 1850u));
  let patchR = smoothstep(0.42, 0.75, fbm(uv, vec2(5.0, 7.0), 4, s + 1900u));
  let roundT = saturate((puff * grain * 1.3 + 0.15 * grain) * patchR);

  // ---- fine fibre detail (read at 4x frequency by the renderer) ----
  let qf = uv + vec2(0.02, 0.04) * w0;
  let fine = saturate(0.2 + 0.55 * ridge(qf, vec2(8.0, 200.0), s + 2000u, 1.5) + 0.35 * ridge(qf, vec2(16.0, 460.0), s + 2100u, 1.5) - 0.15 * fbm(qf, vec2(12.0, 24.0), 2, s + 2200u));

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
