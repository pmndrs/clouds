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
// Still stubbed: kernels '1x1' / '2x2s2', skip 'conv1x1', upsampled sources.
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
  if (op.kernel !== '3x3') no(`kernel ${op.kernel}`);
  if (op.act !== 'none' && op.act !== 'normSilu') no(`activation ${op.act}`);
  if (op.skip.kind !== 'none' && op.skip.kind !== 'identity') no(`skip ${op.skip.kind}`);
  if (op.skip.kind === 'identity' && (op.skip.src.kind !== 'tensor' || op.skip.src.up)) no('identity skip from a non-tensor or upsampled source');
  if (op.scale !== 1 && op.scale !== 2) no(`scale x${op.scale}`);
  if (op.src1.kind === 'tensor' && op.src1.up) no('upsampled source');
  if (op.src2?.kind === 'input') no('input as second source');
}

export function convShader(op: ConvOp, f16: boolean, tiling: ConvTiling): ConvShaderInfo {
  checkSupported(op);
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
  // skipAt(oc, y, x): the residual added after the activation. Identity reads x at the output pixel.
  // A conv1x1 skip would be generated here as a 1x1 over one or two sources (N5.8).
  const skipAt = op.skip.kind === 'identity' ? `vec4f(sk[((b * ${cout4}u + oc) * H + y) * W + x])` : '';
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
// ${op.name}: ${op.kernel} ${op.c1}${op.c2 ? `+${op.c2}` : ''} -> ${op.cout}${gather ? ' (gathered input)' : ''}${norm ? `, RMSNorm+SiLU (G=${G} in local z)` : ''}${skipAt ? ', identity skip' : ''}${op.scale !== 1 ? `, x${op.scale}` : ''}
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
