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
// Only kernel '3x3', act 'none', skip none, scale 1 is implemented (N5.6).
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
}

export const ceil4 = (c: number) => Math.ceil(c / 4);

export const DEFAULT_TILING: ConvTiling = { pw: 2, ph: 2, oc4: 2, wgx: 8, wgy: 8 };

/** Throws for the op options that are typed but not implemented yet. */
export function checkSupported(op: ConvOp) {
  const no = (what: string) => { throw new Error(`engine: ${op.name}: ${what} not implemented yet`); };
  if (op.kernel !== '3x3') no(`kernel ${op.kernel}`);
  if (op.act !== 'none') no(`activation ${op.act}`);
  if (op.skip.kind !== 'none') no(`skip ${op.skip.kind}`);
  if (op.scale !== 1) no(`scale x${op.scale}`);
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
  const oc4 = Math.min(tiling.oc4, cout4);
  if (cout4 % oc4) throw new Error(`oc4 ${oc4} must divide cout4 ${cout4}`);
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
  for (let o = 0; o < oc4; o++) {
    epi.push(`{ let oc = og * ${oc4}u + ${o}u;`);
    for (let py = 0; py < ph; py++) for (let px = 0; px < pw; px++) {
      epi.push(`  { let y = oy + ${py}u; let x = ox + ${colOf(px)}u; if (y < H && x < W) {`);
      epi.push(`    dst[((b * ${cout4}u + oc) * H + y) * W + x] = vec4<${T}>(${acc(py, px, o)}); } }`);
    }
    epi.push('}');
  }

  const code = /* wgsl */ `${f16 ? 'enable f16;\n' : ''}
// ${op.name}: ${op.kernel} ${op.c1}${op.c2 ? `+${op.c2}` : ''} -> ${op.cout}${gather ? ' (gathered input)' : ''}
struct P { H: u32, W: u32, sH: u32, sW: u32, ocg: u32, setSplit: u32, wStride: u32, bStride: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> w: array<${MT}>;
@group(0) @binding(2) var<storage, read> bias: array<vec4f>;
${srcDecl(3, gather)}
${c2_4 ? srcDecl(4, false) : ''}
@group(0) @binding(5) var<storage, read_write> dst: array<vec4<${T}>>;
${gather ? '@group(0) @binding(6) var<storage, read> gtab: array<vec4u>;' : ''}

var<workgroup> tile: array<${VT}, ${tn}>;

@compute @workgroup_size(${wgx}, ${wgy}, 1)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) l: vec3u, @builtin(local_invocation_index) li: u32) {
  let H = p.H;
  let W = p.W;
  let og = wg.z % p.ocg;
  let b = wg.z / p.ocg;
  let wsi = select(1u, 0u, b < p.setSplit);
  let wset = wsi * p.wStride;
  let ty0 = i32(wg.y * ${tileH}u) - 1;
  let tx0 = i32(wg.x * ${tileW}u) - 1;
  let oy = wg.y * ${tileH}u + l.y * ${ph}u;
  let ox = wg.x * ${tileW}u + l.x;
  let base = l.y * ${ph * ttw}u + l.x;
  ${Array.from({ length: oc4 }, (_, o) => `let bv${o} = bias[wsi * p.bStride + og * ${oc4}u + ${o}u];`).join('\n  ')}
  ${accDecl}
  for (var k = 0u; k < ${nch}u; k++) {
    for (var i = li; i < ${tn}u; i += ${wgx * wgy}u) {
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
  return { code, tiling: { ...tiling, oc4 }, nch, c1_4, cout4, tileW, tileH, taps };
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
