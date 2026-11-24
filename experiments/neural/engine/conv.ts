// HaloRT engine: WGSL generator for the fused conv op, plus weight packing.
// Ported and generalised from the Denoiser repo, MIT, owner's own:
//   packages/denoiser-wgsl/src/conv.ts (Denoiser commit 7014384)
// Kept from Denoiser: register blocking (each thread owns PH x PW output pixels
// x OC4 groups of 4 output channels, vec4 f32 accumulators), the per-chunk
// (TH+2) x (TW+2) input tile in workgroup memory with zero padding resolved in
// the loader, mat4x4 * vec4 per tap, the runtime loop over ky, f16 sums per
// 4-channel chunk for fp16, interleaved output columns, packWeights/packBias.
// Dropped: maxpool epilogue, NCHW final output, the tuning experiment switches.
// New (ENGINE.md §2, §3):
//   - weight set per batch item: set = (b < p.setSplit ? 0 : 1); weights and
//     biases of both sets live in one buffer each, set 1 at offset
//     p.wStride (mat4x4 units) / p.bStride (vec4 units);
//   - the 'input' source gathers channels per batch item through a table
//     (binding 6, array<vec4u>, entry b * C1_4 + chunk), reading the planar
//     f32 feature frame (batch 1) directly: no separate gather pass;
//   - workgroup mapping unchanged (output-channel group in wg.z = b * ocg + og).
//     That is fine for kernel D (no norm). Kernels A/B (RMSNorm) need the
//     channel group in local z instead (ENGINE.md §2); not done here.
// N5.7 adds kernels A/B (ENGINE.md §2), selected by the op, same generator:
//   - act 'normSilu': the output-channel group moves from wg.z into
//     local_invocation_id.z (workgroup wgx x wgy x G, G = cout4 / oc4, so one
//     workgroup owns every output channel of its pixels and stages each input
//     tile once for all of them). Epilogue: per-pixel partial sums of squares
//     in workgroup memory (f32), barrier, sum of the G partials, then
//     y * g*sqrt(C) / max(||y||, 1e-12) and SiLU, in f32. The gain
//     (g * sqrt(C), folded at pack time) is binding 7, laid out like the bias.
//   - skip 'identity': adds x at the output pixel (binding 8, packed, same
//     channel count as the output) after the activation; written as a
//     `skipAt` value so a second skip kind (1x1 over one or two sources) can
//     be generated in the same place.
//   - scale 2: multiplies after the skip (stages whose attention is Identity).
// N5.8 adds (ENGINE.md §2 kernel C, task 7):
//   - kernels '1x1' and '2x2s2' (`directShader`): no tile, each thread reads its
//     input pixels straight from global memory. 1 output pixel x oc4 groups per
//     thread, workgroup 8x8, output-channel group in wg.z (like kernel D).
//     Down = pixel-unshuffle + 1x1 is exactly a 2x2 stride-2 conv: unshuffled
//     channel c*4 + p1*2 + p2 is tap (p1, p2) of channel c, so the 1x1 weight
//     [O, 4C, 1, 1] read as [O, C, 2, 2] needs no re-ordering (packWeights taps 4);
//   - src1.up on 3x3: the loader reads the source at (gy >> 1, gx >> 1) from a
//     (p.sH, p.sW) = (H/2, W/2) tensor (nearest 2x; Up = this conv, no norm);
//   - skip 'conv1x1': `skip1x1()` adds a 1x1 conv + bias over one or two
//     concatenated sources at the output pixel, in the same `skipAt` place as the
//     identity skip (bindings 8, 9 = sources). Its weights and bias are appended to the
//     op's own weight / bias buffers after both sets (at 2 * wStride / 2 * bStride, then
//     per set), which keeps the op at <= 7 storage buffers (the default limit is 8).
import type { ConvOp } from './graph';

export interface ConvTiling {
  /** Output pixels per thread. */
  pw: number;
  ph: number;
  /** vec4 output-channel groups per thread. */
  oc4: number;
  /** Workgroup size in threads. */
  wgx: number;
  wgy: number;
}

export interface ConvShaderInfo {
  code: string;
  tiling: ConvTiling;
  nch: number; // input chunks (vec4 groups)
  c1_4: number;
  cout4: number;
  /** Output pixels per workgroup. */
  tileW: number;
  tileH: number;
  /** Taps per kernel (9 for 3x3). */
  taps: number;
  /** Output-channel groups held in local z (kernels A/B; 1 for D). Dispatch z = batch * (cout4 / oc4) / localZ. */
  localZ: number;
}

/** Max invocations per workgroup the A/B kernels may use (WebGPU default limit). */
export const MAX_INVOCATIONS = 256;

export const ceil4 = (c: number) => Math.ceil(c / 4);

export const DEFAULT_TILING: ConvTiling = { pw: 2, ph: 2, oc4: 2, wgx: 8, wgy: 8 };

/** Throws for the op options that are typed but not implemented yet. */
export function checkSupported(op: ConvOp) {
  const no = (what: string) => { throw new Error(`engine: ${op.name}: ${what} not implemented yet`); };
  if (op.kernel !== '3x3' && op.kernel !== '1x1' && op.kernel !== '2x2s2') no(`kernel ${op.kernel}`);
  if (op.act !== 'none' && op.act !== 'normSilu') no(`activation ${op.act}`);
  const skipKind: string = op.skip.kind;
  if (skipKind !== 'none' && skipKind !== 'identity' && skipKind !== 'conv1x1') no(`skip ${skipKind}`);
  if (op.skip.kind === 'identity' && (op.skip.src.kind !== 'tensor' || op.skip.src.up)) no('identity skip from a non-tensor or upsampled source');
  if (op.skip.kind === 'conv1x1' && [op.skip.src1, op.skip.src2].some((s) => s && (s.kind !== 'tensor' || s.up))) no('conv1x1 skip from a non-tensor or upsampled source');
  if (op.scale !== 1 && op.scale !== 2) no(`scale x${op.scale}`);
  if (op.src1.kind === 'tensor' && op.src1.up && op.kernel !== '3x3') no('upsampled source on a non-3x3 kernel');
  if (op.src2?.kind === 'input') no('input as second source');
  if (op.src2?.kind === 'tensor' && op.src2.up) no('upsampled second source');
  if (op.kernel !== '3x3' && (op.act !== 'none' || op.skip.kind !== 'none' || op.scale !== 1 || op.src1.kind !== 'tensor')) {
    no(`kernel ${op.kernel} with norm, skip, scale or the gathered input`);
  }
}

export function convShader(op: ConvOp, f16: boolean, tiling: ConvTiling): ConvShaderInfo {
  checkSupported(op);
  if (op.kernel !== '3x3') return directShader(op, f16, tiling);
  const { pw, ph, wgx, wgy } = tiling;
  const MT = f16 ? 'mat4x4<f16>' : 'mat4x4f';
  const VT = f16 ? 'vec4<f16>' : 'vec4f';
  const T = f16 ? 'f16' : 'f32';
  const taps = 9;
  const cout4 = ceil4(op.cout);
  const norm = op.act === 'normSilu';
  let oc4 = Math.min(tiling.oc4, cout4);
  // A/B: all channel groups in one workgroup; widen oc4 until wgx*wgy*G fits the invocation limit
  while (norm && (cout4 / oc4) * wgx * wgy > MAX_INVOCATIONS && oc4 < cout4) oc4 *= 2;
  if (cout4 % oc4) throw new Error(`oc4 ${oc4} must divide cout4 ${cout4}`);
  const G = norm ? cout4 / oc4 : 1;
  if (G * wgx * wgy > MAX_INVOCATIONS) throw new Error(`engine: ${op.name}: ${wgx}x${wgy}x${G} invocations > ${MAX_INVOCATIONS}`);
  const threads = wgx * wgy * G;
  const npix = wgx * wgy * ph * pw; // output pixels per workgroup
  const c1_4 = ceil4(op.c1);
  const c2_4 = ceil4(op.c2);
  const nch = c1_4 + c2_4;
  const tileW = wgx * pw;
  const tileH = wgy * ph;
  const ttw = tileW + 2;
  const tth = tileH + 2;
  const tn = ttw * tth;
  const colOf = (px: number) => px * wgx; // interleaved columns: contiguous vec4 stores across the SIMD group

  const gather = op.src1.kind === 'input';
  const srcDecl = (n: number, planar: boolean) =>
    `@group(0) @binding(${n}) var<storage, read> s${n - 2}: array<${planar ? 'f32' : `vec4<${T}>`}>;`;

  // load one chunk (vec4 of channels) for pixel (gy, gx) of batch item b
  let load1: string;
  if (op.src1.kind === 'input') {
    // gathered planar f32 read: channel table entry gt = gather[b * C1_4 + k]
    const parts: string[] = [];
    for (let j = 0; j < 4; j++) {
      parts.push(`select(0.0, s1[(gt[${j}] * H + u32(gy)) * W + u32(gx)], k * 4u + ${j}u < ${op.c1}u)`);
    }
    load1 = `let gt = gtab[b * ${c1_4}u + k];\n        v = vec4f(${parts.join(',\n          ')});`;
  } else if (op.src1.up) {
    // nearest 2x upsample resolved in the loader: the source is (p.sH, p.sW) = (H/2, W/2)
    load1 = `v = vec4f(s1[((b * ${c1_4}u + k) * p.sH + (u32(gy) >> 1u)) * p.sW + (u32(gx) >> 1u)]);`;
  } else {
    load1 = `v = vec4f(s1[((b * ${c1_4}u + k) * H + u32(gy)) * W + u32(gx)]);`;
  }
  const load = c2_4
    ? `if (k < ${c1_4}u) { ${load1} } else { let k2 = k - ${c1_4}u; v = vec4f(s2[((b * ${c2_4}u + k2) * H + u32(gy)) * W + u32(gx)]); }`
    : load1;

  const acc = (py: number, px: number, o: number) => `a${py}_${px}_${o}`;
  const part = (py: number, px: number, o: number) => `h${py}_${px}_${o}`;
  const each = (f: (py: number, px: number, o: number) => string) => {
    const out: string[] = [];
    for (let o = 0; o < oc4; o++) for (let py = 0; py < ph; py++) for (let px = 0; px < pw; px++) out.push(f(py, px, o));
    return out;
  };
  const accDecl = each((py, px, o) => `var ${acc(py, px, o)} = bv${o};`).join('\n  ');

  // Taps: runtime loop over ky (Denoiser: keeps the compiler from hoisting all 9 taps' weight loads).
  const body: string[] = [];
  if (f16) body.push(...each((py, px, o) => `var ${part(py, px, o)} = vec4<f16>(0.0);`));
  body.push('for (var ky = 0u; ky < 3u; ky++) {');
  for (let kx = 0; kx < 3; kx++) {
    for (let o = 0; o < oc4; o++) body.push(`let m${o}_${kx} = ${MT}(w[wb${o} + ky * 3u + ${kx}u]);`);
    for (let py = 0; py < ph; py++) for (let px = 0; px < pw; px++) {
      body.push(`{ let x = tile[base + ky * ${ttw}u + ${py * ttw + colOf(px) + kx}u];`);
      for (let o = 0; o < oc4; o++) {
        body.push(f16 ? `  ${part(py, px, o)} += m${o}_${kx} * x;` : `  ${acc(py, px, o)} += m${o}_${kx} * x;`);
      }
      body.push('}');
    }
  }
  body.push('}');
  if (f16) body.push(...each((py, px, o) => `${acc(py, px, o)} += vec4f(${part(py, px, o)});`));

  const epi: string[] = [];
  const pix = (py: number, px: number) => `pb + ${py * pw + px}u`; // this thread's pixel slot in ss[]
  if (norm) {
    // RMSNorm across the G channel groups: partial sums of squares -> workgroup memory -> barrier -> sum
    for (let py = 0; py < ph; py++) for (let px = 0; px < pw; px++) {
      const terms = Array.from({ length: oc4 }, (_, o) => `dot(${acc(py, px, o)}, ${acc(py, px, o)})`).join(' + ');
      epi.push(`ss[l.z * ${npix}u + ${pix(py, px)}] = ${terms};`);
    }
    epi.push('workgroupBarrier();');
    for (let py = 0; py < ph; py++) for (let px = 0; px < pw; px++) {
      const sum = Array.from({ length: G }, (_, g) => `ss[${g * npix}u + ${pix(py, px)}]`).join(' + ');
      epi.push(`let n${py}_${px} = 1.0 / max(sqrt(${sum}), 1e-12);`);
    }
  }
  // skipAt(oc, y, x): the residual added after the activation. Identity reads x at the output pixel;
  // conv1x1 (N5.8) is a 1x1 + bias over one or two concatenated sources at that pixel (skip1x1 below).
  const sk = op.skip;
  const sc1_4 = sk.kind === 'conv1x1' ? ceil4(sk.c1) : 0;
  const sc2_4 = sk.kind === 'conv1x1' && sk.src2 ? ceil4(sk.c2) : 0;
  const snch = sc1_4 + sc2_4;
  const skipAt = sk.kind === 'identity' ? `vec4f(sk[((b * ${cout4}u + oc) * H + y) * W + x])`
    : sk.kind === 'conv1x1' ? 'skip1x1(b, wsi, oc, y, x, H, W)' : '';
  const skipFn = sk.kind !== 'conv1x1' ? '' : /* wgsl */ `
fn skip1x1(b: u32, wsi: u32, oc: u32, y: u32, x: u32, H: u32, W: u32) -> vec4f {
  var r = bias[2u * p.bStride + wsi * ${cout4}u + oc];
  let wb = 2u * p.wStride + wsi * ${cout4 * snch}u + oc * ${snch}u;
  for (var k = 0u; k < ${sc1_4}u; k++) { r += mat4x4f(w[wb + k]) * vec4f(sk[((b * ${sc1_4}u + k) * H + y) * W + x]); }
  ${sc2_4 ? `for (var k = 0u; k < ${sc2_4}u; k++) { r += mat4x4f(w[wb + ${sc1_4}u + k]) * vec4f(sk2[((b * ${sc2_4}u + k) * H + y) * W + x]); }` : ''}
  return r;
}`;
  for (let o = 0; o < oc4; o++) {
    epi.push(`{ let oc = og * ${oc4}u + ${o}u;`);
    if (norm) epi.push(`  let gv = gain[wsi * p.bStride + oc];`);
    for (let py = 0; py < ph; py++) for (let px = 0; px < pw; px++) {
      epi.push(`  { let y = oy + ${py}u; let x = ox + ${colOf(px)}u; if (y < H && x < W) {`);
      epi.push(`    var r = ${acc(py, px, o)};`);
      if (norm) epi.push(`    r = r * (gv * n${py}_${px}); r = r / (1.0 + exp(-r));`);
      if (skipAt) epi.push(`    r += ${skipAt};`);
      if (op.scale !== 1) epi.push(`    r *= ${op.scale.toFixed(1)};`);
      epi.push(`    dst[((b * ${cout4}u + oc) * H + y) * W + x] = vec4<${T}>(r); } }`);
    }
    epi.push('}');
  }

  const code = /* wgsl */ `${f16 ? 'enable f16;\n' : ''}
// ${op.name}: ${op.kernel} ${op.c1}${op.c2 ? `+${op.c2}` : ''} -> ${op.cout}${gather ? ' (gathered input)' : ''}${norm ? `, RMSNorm+SiLU (G=${G} in local z)` : ''}${skipAt ? `, ${sk.kind} skip` : ''}${op.src1.kind === 'tensor' && op.src1.up ? ', 2x nearest-up source' : ''}${op.scale !== 1 ? `, x${op.scale}` : ''}
struct P { H: u32, W: u32, sH: u32, sW: u32, ocg: u32, setSplit: u32, wStride: u32, bStride: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> w: array<${MT}>;
@group(0) @binding(2) var<storage, read> bias: array<vec4f>;
${srcDecl(3, gather)}
${c2_4 ? srcDecl(4, false) : ''}
@group(0) @binding(5) var<storage, read_write> dst: array<vec4<${T}>>;
${gather ? '@group(0) @binding(6) var<storage, read> gtab: array<vec4u>;' : ''}
${norm ? '@group(0) @binding(7) var<storage, read> gain: array<vec4f>;' : ''}
${skipAt ? `@group(0) @binding(8) var<storage, read> sk: array<vec4<${T}>>;` : ''}
${sc2_4 ? `@group(0) @binding(9) var<storage, read> sk2: array<vec4<${T}>>;` : ''}
${skipFn}

var<workgroup> tile: array<${VT}, ${tn}>;
${norm ? `var<workgroup> ss: array<f32, ${G * npix}>;` : ''}

@compute @workgroup_size(${wgx}, ${wgy}, ${G})
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) l: vec3u, @builtin(local_invocation_index) li: u32) {
  let H = p.H;
  let W = p.W;
  let og = ${norm ? 'l.z' : 'wg.z % p.ocg'};
  let b = ${norm ? 'wg.z' : 'wg.z / p.ocg'};
  let wsi = select(1u, 0u, b < p.setSplit);
  let wset = wsi * p.wStride;
  let ty0 = i32(wg.y * ${tileH}u) - 1;
  let tx0 = i32(wg.x * ${tileW}u) - 1;
  let oy = wg.y * ${tileH}u + l.y * ${ph}u;
  let ox = wg.x * ${tileW}u + l.x;
  let base = l.y * ${ph * ttw}u + l.x;
  ${norm ? `let pb = (l.y * ${wgx}u + l.x) * ${ph * pw}u;` : ''}
  ${Array.from({ length: oc4 }, (_, o) => `let bv${o} = bias[wsi * p.bStride + og * ${oc4}u + ${o}u];`).join('\n  ')}
  ${accDecl}
  for (var k = 0u; k < ${nch}u; k++) {
    for (var i = li; i < ${tn}u; i += ${threads}u) {
      let gy = ty0 + i32(i / ${ttw}u);
      let gx = tx0 + i32(i % ${ttw}u);
      var v = vec4f(0.0);
      if (gy >= 0 && gy < i32(H) && gx >= 0 && gx < i32(W)) {
        ${load}
      }
      tile[i] = ${VT}(v);
    }
    workgroupBarrier();
    ${Array.from({ length: oc4 }, (_, o) => `let wb${o} = wset + ((og * ${oc4}u + ${o}u) * ${nch}u + k) * ${taps}u;`).join('\n    ')}
    ${body.join('\n    ')}
    workgroupBarrier();
  }
  {
  ${epi.join('\n  ')}
  }
}
`;
  return { code, tiling: { ...tiling, oc4 }, nch, c1_4, cout4, tileW, tileH, taps, localZ: G };
}

/**
 * Kernels '1x1' and '2x2s2' (N5.8; ENGINE.md kernel C for Down, and final_conv): no tile and no norm.
 * One thread = one output pixel x oc4 output-channel groups; workgroup 8x8; group z = b * ocg + og.
 * 2x2s2 reads input (2y + ty, 2x + tx) of a (2H, 2W) source for tap ty*2 + tx. Bias only, no activation.
 */
export function directShader(op: ConvOp, f16: boolean, tiling: ConvTiling): ConvShaderInfo {
  const MT = f16 ? 'mat4x4<f16>' : 'mat4x4f';
  const T = f16 ? 'f16' : 'f32';
  const s2 = op.kernel === '2x2s2';
  const taps = s2 ? 4 : 1;
  const F = s2 ? 2 : 1;
  const cout4 = ceil4(op.cout);
  const oc4 = Math.min(tiling.oc4, cout4);
  if (cout4 % oc4) throw new Error(`oc4 ${oc4} must divide cout4 ${cout4}`);
  const c1_4 = ceil4(op.c1);
  const c2_4 = ceil4(op.c2);
  const nch = c1_4 + c2_4;
  const wg = 8;
  const os = Array.from({ length: oc4 }, (_, o) => o);
  const tapCode: string[] = [];
  for (let t = 0; t < taps; t++) {
    const ty = t >> 1, tx = t & 1;
    const yy = s2 ? `y * 2u + ${ty}u` : 'y';
    const xx = s2 ? `x * 2u + ${tx}u` : 'x';
    const rd = (n: number, c4: number, kk: string) => `vec4f(s${n}[((b * ${c4}u + ${kk}) * SH + ${yy}) * SW + ${xx}])`;
    const read = c2_4 ? `if (k < ${c1_4}u) { v = ${rd(1, c1_4, 'k')}; } else { v = ${rd(2, c2_4, 'k - ' + c1_4 + 'u')}; }` : `v = ${rd(1, c1_4, 'k')};`;
    tapCode.push(`{ var v: vec4f; ${read}`);
    for (const o of os) tapCode.push(`  a${o} += mat4x4f(w[wb${o} + ${t}u]) * v;`);
    tapCode.push('}');
  }
  const code = /* wgsl */ `${f16 ? 'enable f16;\n' : ''}
// ${op.name}: ${op.kernel} ${op.c1}${op.c2 ? `+${op.c2}` : ''} -> ${op.cout} (direct, bias, no activation)
struct P { H: u32, W: u32, sH: u32, sW: u32, ocg: u32, setSplit: u32, wStride: u32, bStride: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> w: array<${MT}>;
@group(0) @binding(2) var<storage, read> bias: array<vec4f>;
@group(0) @binding(3) var<storage, read> s1: array<vec4<${T}>>;
${c2_4 ? `@group(0) @binding(4) var<storage, read> s2: array<vec4<${T}>>;` : ''}
@group(0) @binding(5) var<storage, read_write> dst: array<vec4<${T}>>;

@compute @workgroup_size(${wg}, ${wg}, 1)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(global_invocation_id) gid: vec3u) {
  let H = p.H;
  let W = p.W;
  let SH = H * ${F}u;
  let SW = W * ${F}u;
  let og = wg.z % p.ocg;
  let b = wg.z / p.ocg;
  let wsi = select(1u, 0u, b < p.setSplit);
  let wset = wsi * p.wStride;
  let y = gid.y;
  let x = gid.x;
  if (y >= H || x >= W) { return; }
  ${os.map((o) => `var a${o} = bias[wsi * p.bStride + og * ${oc4}u + ${o}u];`).join('\n  ')}
  for (var k = 0u; k < ${nch}u; k++) {
    ${os.map((o) => `let wb${o} = wset + ((og * ${oc4}u + ${o}u) * ${nch}u + k) * ${taps}u;`).join('\n    ')}
    ${tapCode.join('\n    ')}
  }
  ${os.map((o) => `dst[((b * ${cout4}u + og * ${oc4}u + ${o}u) * H + y) * W + x] = vec4<${T}>(a${o});`).join('\n  ')}
}
`;
  return { code, tiling: { ...tiling, oc4 }, nch, c1_4, cout4, tileW: wg, tileH: wg, taps, localZ: 1 };
}

/**
 * Pack OIHW conv weights into the shader's layout: mat4x4 per (oc4, chunk, tap),
 * column j = input channel j of the chunk, row i = output channel 4*oc4 + i.
 * Chunks [0, c1_4) cover src1's channels, the rest src2's (concat order); padded
 * channels are zero. `taps` = kh * kw (9 for 3x3, 1 for 1x1, 4 for 2x2).
 * Result length: ceil4(cout) * nch * taps * 16 floats.
 */
export function packWeights(w: Float32Array, cout: number, c1: number, c2: number, taps = 9): Float32Array {
  const cin = c1 + c2;
  if (w.length !== cout * cin * taps) throw new Error(`packWeights: ${w.length} != ${cout}x${cin}x${taps}`);
  const cout4 = ceil4(cout);
  const c1_4 = ceil4(c1);
  const nch = c1_4 + ceil4(c2);
  const out = new Float32Array(cout4 * nch * taps * 16);
  for (let o4 = 0; o4 < cout4; o4++) {
    for (let k = 0; k < nch; k++) {
      for (let t = 0; t < taps; t++) {
        const m = ((o4 * nch + k) * taps + t) * 16;
        for (let j = 0; j < 4; j++) {
          let ch: number;
          if (k < c1_4) ch = 4 * k + j < c1 ? 4 * k + j : -1;
          else ch = 4 * (k - c1_4) + j < c2 ? c1 + 4 * (k - c1_4) + j : -1;
          if (ch < 0) continue;
          for (let i = 0; i < 4; i++) {
            const oc = 4 * o4 + i;
            if (oc >= cout) continue;
            out[m + j * 4 + i] = w[(oc * cin + ch) * taps + t];
          }
        }
      }
    }
  }
  return out;
}

export function packBias(b: Float32Array, cout: number): Float32Array {
  const out = new Float32Array(ceil4(cout) * 4);
  out.set(b.subarray(0, cout));
  return out;
}

/** RMSNorm gain with sqrt(C) folded in (ENGINE.md §2), padded to vec4s like the bias. */
export function packGain(g: Float32Array, cout: number): Float32Array {
  if (g.length !== cout) throw new Error(`packGain: ${g.length} != ${cout}`);
  const out = new Float32Array(ceil4(cout) * 4);
  const k = Math.fround(Math.sqrt(cout));
  for (let c = 0; c < cout; c++) out[c] = g[c] * k;
  return out;
}
