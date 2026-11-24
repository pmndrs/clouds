// HaloRT block attention (ENGINE.md §4, task 8; N5.9). Reproduces `block_attention` in
// scripts/neural/halonet_ref.py:
//   xn  = x / max(||x||_C, 1e-12) * g * sqrt(C)           (RMSNorm per pixel)
//   qkv = to_qkv(reflect_pad(xn, 2))                        (1x1, no bias, 48 ch: q 0-15, k 16-31, v 32-47, head h = ch h*4..h*4+3)
//   windows of (bs+4)^2 tokens at stride bs; keys/values = 8 memory tokens (mem_kv[0|1][h]) + window tokens
//   softmax(q.k * 0.5) v per head; keep the centre bs x bs; to_out (1x1 16 -> C, bias).
// The residual (+ x) is optional here (`residual: true` adds the un-normalised x in the epilogue); the
// reference returns the attention WITHOUT it and the UNet adds it.
//
// Simplest correct design (these layers run at <= 64x64 px), two dispatches, both 1-D, 64 threads, one
// thread per (batch item, pixel):
//   1. qkv:  RMSNorm + to_qkv per pixel of the UNPADDED image -> scratch `qkv` (f32, NC4HW4 with batch, 12 vec4
//            per pixel). Reflect padding is applied when reading (a 1x1 conv commutes with the pad).
//   2. attn: per output pixel, per head, online softmax in f32 over the 8 memory keys then the (bs+4)^2 window
//            keys of its block (reflect-indexed: -1 -> 1, H -> H-2), then to_out + bias (+ x), store NC4HW4.
// Batch and weight sets as the engine: item b uses set (b < setSplit ? 0 : 1); one f32 weight buffer per layer
// holds set 0 then set 1 at `setStride` floats. Activations (src, dst) are f32 or f16 (`f16: true`); qkv and all
// arithmetic stay f32.
import type { TensorMap } from './tza';

export const HEADS = 4;
export const DIM_HEAD = 4;
export const MEM = 8;
export const HALO = 2;

export interface AttentionOptions {
  f16?: boolean;
  batch?: number;
  setSplit?: number;
}

/** Per set, floats: g[C], wqkvT[C][48] (input-major), woutT[16][C] (input-major), bout[C], mem[2][4][8][4]. */
export function packAttention(W: TensorMap, prefix: string): { data: Float32Array; C: number } {
  const get = (n: string) => {
    const t = W.get(`${prefix}.${n}`);
    if (!t) throw new Error(`missing ${prefix}.${n}`);
    return t;
  };
  const g = get('norm.g').data, wq = get('to_qkv.weight'), wo = get('to_out.weight'), bo = get('to_out.bias').data, mem = get('mem_kv').data;
  const C = g.length, QKV = 3 * HEADS * DIM_HEAD, HD = HEADS * DIM_HEAD;
  if (wq.shape[0] !== QKV || wq.shape[1] !== C || wo.shape[0] !== C || wo.shape[1] !== HD || mem.length !== 2 * HEADS * MEM * DIM_HEAD) {
    throw new Error(`${prefix}: unexpected attention shapes`);
  }
  const out = new Float32Array(C + C * QKV + HD * C + C + mem.length);
  let o = 0;
  out.set(g, o); o += C;
  for (let c = 0; c < C; c++) for (let j = 0; j < QKV; j++) out[o + c * QKV + j] = wq.data[j * C + c];
  o += C * QKV;
  for (let i = 0; i < HD; i++) for (let c = 0; c < C; c++) out[o + i * C + c] = wo.data[c * HD + i];
  o += HD * C;
  out.set(bo, o); o += C;
  out.set(mem, o);
  return { data: out, C };
}

const header = (f16: boolean) => `${f16 ? 'enable f16;\n' : ''}alias T = ${f16 ? 'f16' : 'f32'};
struct P { B: u32, H: u32, W: u32, C4: u32, bs: u32, setSplit: u32, setStride: u32, residual: u32 }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> wt: array<f32>;
@group(0) @binding(2) var<storage, read> src: array<vec4<T>>;
fn setBase(b: u32) -> u32 { return select(p.setStride, 0u, b < p.setSplit); }
fn w4(o: u32) -> vec4f { return vec4f(wt[o], wt[o + 1u], wt[o + 2u], wt[o + 3u]); }
`;

export function qkvShader(f16: boolean): string {
  return `${header(f16)}
@group(0) @binding(3) var<storage, read_write> qkv: array<vec4f>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let HW = p.H * p.W;
  if (gid.x >= p.B * HW) { return; }
  let b = gid.x / HW;
  let px = gid.x % HW;
  let C = p.C4 * 4u;
  let base = setBase(b);
  var ss = 0.0;
  for (var c4 = 0u; c4 < p.C4; c4++) { let v = vec4f(src[(b * p.C4 + c4) * HW + px]); ss += dot(v, v); }
  let scale = sqrt(f32(C)) / max(sqrt(ss), 1e-12);
  var acc: array<vec4f, 12>;
  for (var c4 = 0u; c4 < p.C4; c4++) {
    let v = vec4f(src[(b * p.C4 + c4) * HW + px]) * scale;
    for (var j = 0u; j < 4u; j++) {
      let c = c4 * 4u + j;
      let xn = v[j] * wt[base + c];
      let row = base + C + c * 48u;
      for (var o4 = 0u; o4 < 12u; o4++) { acc[o4] += xn * w4(row + o4 * 4u); }
    }
  }
  for (var o4 = 0u; o4 < 12u; o4++) { qkv[(b * 12u + o4) * HW + px] = acc[o4]; }
}`;
}

export function attnShader(f16: boolean): string {
  return `${header(f16)}
@group(0) @binding(3) var<storage, read> qkv: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> dst: array<vec4<T>>;
fn refl(i: i32, n: i32) -> u32 {
  var r = i;
  if (r < 0) { r = -r; }
  if (r >= n) { r = 2 * n - 2 - r; }
  return u32(r);
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let HW = p.H * p.W;
  if (gid.x >= p.B * HW) { return; }
  let b = gid.x / HW;
  let px = gid.x % HW;
  let y = px / p.W;
  let x = px % p.W;
  let C = p.C4 * 4u;
  let base = setBase(b);
  let woutOff = base + C + C * 48u;
  let boutOff = woutOff + 16u * C;
  let memOff = boutOff + C;
  let K = p.bs + ${2 * HALO}u;
  let y0 = i32((y / p.bs) * p.bs) - ${HALO};
  let x0 = i32((x / p.bs) * p.bs) - ${HALO};
  var o: array<vec4f, 4>;
  for (var h = 0u; h < 4u; h++) {
    let q = qkv[(b * 12u + h) * HW + px] * ${DIM_HEAD ** -0.5};
    var m = -3.0e38;
    var l = 0.0;
    var acc = vec4f(0.0);
    for (var j = 0u; j < ${MEM}u; j++) {
      let k = w4(memOff + (h * ${MEM}u + j) * 4u);
      let v = w4(memOff + ((4u + h) * ${MEM}u + j) * 4u);
      let s = dot(q, k);
      let mn = max(m, s);
      let corr = exp(m - mn);
      let e = exp(s - mn);
      l = l * corr + e;
      acc = acc * corr + e * v;
      m = mn;
    }
    for (var wy = 0u; wy < K; wy++) {
      let sy = refl(y0 + i32(wy), i32(p.H));
      for (var wx = 0u; wx < K; wx++) {
        let pp = sy * p.W + refl(x0 + i32(wx), i32(p.W));
        let k = qkv[(b * 12u + 4u + h) * HW + pp];
        let v = qkv[(b * 12u + 8u + h) * HW + pp];
        let s = dot(q, k);
        let mn = max(m, s);
        let corr = exp(m - mn);
        let e = exp(s - mn);
        l = l * corr + e;
        acc = acc * corr + e * v;
        m = mn;
      }
    }
    o[h] = acc / l;
  }
  for (var c4 = 0u; c4 < p.C4; c4++) {
    var r = w4(boutOff + c4 * 4u);
    for (var i = 0u; i < 16u; i++) { r += o[i / 4u][i % 4u] * w4(woutOff + i * C + c4 * 4u); }
    let at = (b * p.C4 + c4) * HW + px;
    if (p.residual != 0u) { r += vec4f(src[at]); }
    dst[at] = vec4<T>(r);
  }
}`;
}

export interface AttentionBinding {
  /** Record both dispatches into an open compute pass (the engine's single pass). */
  encode(pass: GPUComputePassEncoder): void;
  release(): void;
}

/** One attention layer (e.g. prefix `downs.3.2`, `ups.1.2`, `mid_attn`; bs 8, or 4 for mid_attn). */
export class AttentionLayer {
  readonly f16: boolean;
  readonly batch: number;
  readonly setSplit: number;
  private constructor(
    readonly device: GPUDevice, readonly prefix: string, readonly C: number, readonly bs: number,
    private weights: GPUBuffer, private setStride: number, private qkvPipe: GPUComputePipeline, private attnPipe: GPUComputePipeline,
    opts: AttentionOptions,
  ) {
    this.f16 = !!opts.f16;
    this.batch = opts.batch ?? 6;
    this.setSplit = opts.setSplit ?? 3;
  }

  static async create(device: GPUDevice, prefix: string, bs: number, sets: [TensorMap, TensorMap], opts: AttentionOptions = {}): Promise<AttentionLayer> {
    const a = packAttention(sets[0], prefix), b = packAttention(sets[1], prefix);
    if (a.C !== b.C || a.data.length !== b.data.length) throw new Error(`${prefix}: weight sets differ in shape`);
    if (a.C % 4) throw new Error(`${prefix}: C=${a.C} not a multiple of 4`);
    const setStride = a.data.length;
    const all = new Float32Array(2 * setStride);
    all.set(a.data, 0);
    all.set(b.data, setStride);
    const weights = device.createBuffer({ size: all.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, label: `${prefix} attn weights` });
    device.queue.writeBuffer(weights, 0, all);
    const f16 = !!opts.f16;
    const mk = async (code: string, label: string) => device.createComputePipelineAsync({
      layout: 'auto', label, compute: { module: device.createShaderModule({ code, label }), entryPoint: 'main' },
    });
    const [qkvPipe, attnPipe] = await Promise.all([mk(qkvShader(f16), `${prefix} qkv`), mk(attnShader(f16), `${prefix} attn`)]);
    return new AttentionLayer(device, prefix, a.C, bs, weights, setStride, qkvPipe, attnPipe, opts);
  }

  /** src, dst: NC4HW4-with-batch activation buffers (T = f32 or f16) of this layer's C at H x W. */
  bind(H: number, W: number, src: GPUBuffer, dst: GPUBuffer, opts: { residual?: boolean } = {}): AttentionBinding {
    if (H % this.bs || W % this.bs) throw new Error(`${this.prefix}: ${H}x${W} not a multiple of block ${this.bs}`);
    if (H < HALO + 1 || W < HALO + 1) throw new Error(`${this.prefix}: ${H}x${W} too small for reflect pad ${HALO}`);
    const d = this.device, B = this.batch, n = B * H * W;
    const uni = d.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: `${this.prefix} attn P` });
    d.queue.writeBuffer(uni, 0, new Uint32Array([B, H, W, this.C / 4, this.bs, this.setSplit, this.setStride, opts.residual ? 1 : 0]));
    const qkv = d.createBuffer({ size: n * 12 * 16, usage: GPUBufferUsage.STORAGE, label: `${this.prefix} qkv` });
    const bgQ = d.createBindGroup({ layout: this.qkvPipe.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: uni } }, { binding: 1, resource: { buffer: this.weights } },
      { binding: 2, resource: { buffer: src } }, { binding: 3, resource: { buffer: qkv } }] });
    const bgA = d.createBindGroup({ layout: this.attnPipe.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: uni } }, { binding: 1, resource: { buffer: this.weights } },
      { binding: 2, resource: { buffer: src } }, { binding: 3, resource: { buffer: qkv } }, { binding: 4, resource: { buffer: dst } }] });
    const groups = Math.ceil(n / 64);
    return {
      encode: (pass) => {
        pass.setPipeline(this.qkvPipe); pass.setBindGroup(0, bgQ); pass.dispatchWorkgroups(groups);
        pass.setPipeline(this.attnPipe); pass.setBindGroup(0, bgA); pass.dispatchWorkgroups(groups);
      },
      release: () => { uni.destroy(); qkv.destroy(); },
    };
  }

  release(): void { this.weights.destroy(); }
}
