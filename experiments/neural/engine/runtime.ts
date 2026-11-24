// HaloRT engine runtime: a device passed in, packed weights for two weight
// sets, liveness-shared activation slots with a batch dimension, all ops in
// ONE compute pass and ONE submit.
// Pattern ported from the Denoiser repo, MIT, owner's own:
//   packages/denoiser-wgsl/src/runtime.ts (Denoiser commit 7014384)
// (one encoder + one pass per run, per-geometry bind, slot buffers sized for
// the largest tensor placed in them). Not ported yet: profile mode
// (timestamps), requestMaxDevice, subgroup-matrix path.
//
// Batch and weight sets (ENGINE.md §3, option c): batch item b uses weight set
// (b < setSplit ? 0 : 1). Default batch 6, setSplit 3: items 0-2 = `dir`
// passes 0-2, items 3-5 = `env` passes 0-2. Batch 4 with setSplit 1 is the
// grey-albedo variant (1 dir + 3 env). Each layer's weight buffer holds set 0
// then set 1 (set 1 at `wStride` mat4x4s); biases likewise (`bStride` vec4s).
import { assignSlots, isAttn, type ConvOp, type Graph, type Source } from './graph';
import { AttentionLayer } from './attention';
import { ceil4, convShader, DEFAULT_TILING, packBias, packGain, packWeights, type ConvTiling } from './conv';
import type { TensorMap } from './tza';

export interface EngineOptions {
  /** fp16 activations and weights (needs `shader-f16`), f16 sums per chunk. Default fp32. */
  f16?: boolean;
  /** Batch items (default 6). */
  batch?: number;
  /** Items below this index use weight set 0, the rest set 1 (default 3). */
  setSplit?: number;
  tiling?: Partial<ConvTiling>;
  /** Tensor ids kept alive for readback (debug / parity). */
  keep?: number[];
}

const F16 = (globalThis as unknown as { Float16Array?: Float32ArrayConstructor }).Float16Array;

interface Layer {
  op: ConvOp;
  pipeline: GPUComputePipeline;
  weights: GPUBuffer;
  bias: GPUBuffer;
  gather?: GPUBuffer;
  /** RMSNorm gain (g * sqrt(C)), both sets, set 1 at bStride (act 'normSilu' only). */
  gain?: GPUBuffer;
  /** Output-channel groups in local z (A/B kernels); dispatch z = batch * ocg / localZ. */
  localZ: number;
  wStride: number; // mat4x4 units
  bStride: number; // vec4 units
  ocg: number;
  tileW: number;
  tileH: number;
}

export class Engine {
  readonly f16: boolean;
  readonly batch: number;
  readonly setSplit: number;
  private layers: Layer[] = [];
  /** N5.10: attention ops (two dispatches each, ./attention.ts), by op index. */
  private attn = new Map<number, AttentionLayer>();

  private constructor(readonly device: GPUDevice, readonly graph: Graph, private opts: EngineOptions) {
    this.f16 = !!opts.f16;
    this.batch = opts.batch ?? 6;
    this.setSplit = opts.setSplit ?? 3;
  }

  /** `sets` = [set 0, set 1] weights (e.g. [halo_dir, halo_env]). */
  static async create(device: GPUDevice, graph: Graph, sets: [TensorMap, TensorMap], opts: EngineOptions = {}): Promise<Engine> {
    const e = new Engine(device, graph, opts);
    if (e.f16 && !device.features.has('shader-f16')) throw new Error('engine: fp16 needs the shader-f16 feature');
    if (e.f16 && !F16) throw new Error('engine: fp16 needs Float16Array');
    await e.init(sets);
    return e;
  }

  private async init(sets: [TensorMap, TensorMap]) {
    const d = this.device;
    const tiling = { ...DEFAULT_TILING, ...this.opts.tiling };
    // N5.10: attention ops get an AttentionLayer (both weight sets); conv ops a Layer as before.
    await Promise.all(this.graph.ops.map(async (op, i) => {
      if (!isAttn(op)) return;
      const a = await AttentionLayer.create(d, op.prefix, op.bs, sets, { f16: this.f16, batch: this.batch, setSplit: this.setSplit });
      if (a.C !== op.channels) throw new Error(`engine: ${op.name} has ${a.C} channels, op says ${op.channels}`);
      this.attn.set(i, a);
    }));
    const convOps = this.graph.ops.filter((op): op is ConvOp => !isAttn(op));
    this.layers = await Promise.all(convOps.map(async (op): Promise<Layer> => {
      const info = convShader(op, this.f16, tiling);
      const packedW: Float32Array[] = [];
      const packedB: Float32Array[] = [];
      const packedG: Float32Array[] = [];
      for (const s of sets) {
        if (op.act === 'normSilu') {
          const g = op.normG ? s.get(op.normG) : undefined;
          if (!g) throw new Error(`engine: missing norm gain ${op.normG} for ${op.name}`);
          packedG.push(packGain(g.data, op.cout));
        }
        const w = s.get(`${op.weight}.weight`);
        const b = s.get(`${op.weight}.bias`);
        if (!w || !b) throw new Error(`engine: missing weights for ${op.weight}`);
        const [cout, cin] = w.shape;
        // 2x2s2 (Down): the 1x1 weight [cout, 4c] is read as [cout, c, 2, 2] (N5.8)
        if (cout !== op.cout || cin !== (op.c1 + op.c2) * (op.kernel === '2x2s2' ? 4 : 1)) throw new Error(`engine: ${op.name} weight shape ${w.shape} vs op ${op.cout}x${op.c1 + op.c2}`);
        packedW.push(packWeights(w.data, op.cout, op.c1, op.c2, info.taps));
        packedB.push(packBias(b.data, op.cout));
      }
      // conv1x1 skip (res_conv, N5.8): its packed weights / bias for both sets go after the op's own two sets
      const skW: Float32Array[] = [];
      const skB: Float32Array[] = [];
      if (op.skip.kind === 'conv1x1') {
        const sk = op.skip;
        for (const s of sets) {
          const w = s.get(`${sk.weight}.weight`);
          const b = s.get(`${sk.weight}.bias`);
          if (!w || !b) throw new Error(`engine: missing skip weights ${sk.weight}`);
          if (w.shape[0] !== op.cout || w.shape[1] !== sk.c1 + (sk.src2 ? sk.c2 : 0)) throw new Error(`engine: ${op.name} skip weight shape ${w.shape}`);
          skW.push(packWeights(w.data, op.cout, sk.c1, sk.src2 ? sk.c2 : 0, 1));
          skB.push(packBias(b.data, op.cout));
        }
      }
      const concat = (parts: Float32Array[]) => {
        const out = new Float32Array(parts.reduce((n, a) => n + a.length, 0));
        let o = 0;
        for (const a of parts) { out.set(a, o); o += a.length; }
        return out;
      };
      const wAll = concat([packedW[0], packedW[1], ...skW]);
      const bAll = concat([packedB[0], packedB[1], ...skB]);
      const wData = this.f16 ? new F16!(wAll) : wAll;

      const module = d.createShaderModule({ code: info.code, label: op.name });
      const pipeline = await d.createComputePipelineAsync({
        layout: 'auto', compute: { module, entryPoint: 'main' }, label: op.name,
      }).catch(async (err) => {
        const msgs = (await module.getCompilationInfo()).messages
          .map((m) => `${m.type} ${m.lineNum}:${m.linePos} ${m.message}`).join('\n');
        throw new Error(`engine: ${op.name}: ${err}\n${msgs}`);
      });
      const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
      const weights = d.createBuffer({ size: Math.max(16, wData.byteLength), usage, label: `${op.name}.w` });
      d.queue.writeBuffer(weights, 0, wData as unknown as BufferSource);
      const bias = d.createBuffer({ size: bAll.byteLength, usage, label: `${op.name}.b` });
      d.queue.writeBuffer(bias, 0, bAll);
      let gain: GPUBuffer | undefined;
      if (packedG.length) {
        const gAll = new Float32Array(packedG[0].length * 2);
        gAll.set(packedG[0]); gAll.set(packedG[1], packedG[0].length);
        gain = d.createBuffer({ size: gAll.byteLength, usage, label: `${op.name}.g` });
        d.queue.writeBuffer(gain, 0, gAll);
      }
      let gather: GPUBuffer | undefined;
      if (op.src1.kind === 'input') {
        gather = d.createBuffer({ size: this.batch * info.c1_4 * 16, usage, label: `${op.name}.gather` });
        d.queue.writeBuffer(gather, 0, gatherTable(op.src1, this.batch, op.c1));
      }
      return {
        op, pipeline, weights, bias, gather, gain, localZ: info.localZ,
        wStride: packedW[0].length / 16, bStride: packedB[0].length / 4,
        ocg: info.cout4 / info.tiling.oc4, tileW: info.tileW, tileH: info.tileH,
      };
    }));
  }

  /**
   * Allocate activations for one input size. `input` is the planar f32 NCHW
   * feature frame (batch 1) every 'input' source reads. Size must be a
   * multiple of 16 (and of 256 for the full network).
   */
  bind(size: number, input: GPUBuffer): Binding {
    if (size % 16) throw new Error(`engine: size ${size} must be a multiple of 16`);
    const d = this.device;
    const B = this.batch;
    const bpe = this.f16 ? 2 : 4;
    const { slotOf, slots } = assignSlots(this.graph, new Set(this.opts.keep ?? []));
    const slotBytes = new Array<number>(slots).fill(16);
    for (const t of this.graph.tensors) {
      const s = size >> t.level;
      slotBytes[slotOf[t.id]] = Math.max(slotBytes[slotOf[t.id]], B * ceil4(t.channels) * s * s * 4 * bpe);
    }
    const slotBufs = slotBytes.map((sz, i) => d.createBuffer({
      size: sz, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, label: `engine.slot${i}`,
    }));
    const tensorBuf = (id: number) => slotBufs[slotOf[id]];
    const srcBuf = (s: Source) => (s.kind === 'input' ? input : tensorBuf(s.id));
    const owned: GPUBuffer[] = [...slotBufs];

    const convSteps = this.layers.map(({ op, pipeline, weights, bias, gather, gain, localZ, wStride, bStride, ocg, tileW, tileH }) => {
      const s = size >> op.level;
      const params = new Uint32Array([s, s, s >> 1, s >> 1, ocg, this.setSplit, wStride, bStride]);
      const ub = d.createBuffer({ size: params.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(ub, 0, params);
      owned.push(ub);
      const entries: GPUBindGroupEntry[] = [
        { binding: 0, resource: { buffer: ub } },
        { binding: 1, resource: { buffer: weights } },
        { binding: 2, resource: { buffer: bias } },
        { binding: 3, resource: { buffer: srcBuf(op.src1) } },
        { binding: 5, resource: { buffer: tensorBuf(op.dst) } },
      ];
      if (op.src2) entries.push({ binding: 4, resource: { buffer: srcBuf(op.src2) } });
      if (gather) entries.push({ binding: 6, resource: { buffer: gather } });
      if (gain) entries.push({ binding: 7, resource: { buffer: gain } });
      if (op.skip.kind === 'identity') entries.push({ binding: 8, resource: { buffer: srcBuf(op.skip.src) } });
      if (op.skip.kind === 'conv1x1') {
        entries.push({ binding: 8, resource: { buffer: srcBuf(op.skip.src1) } });
        if (op.skip.src2) entries.push({ binding: 9, resource: { buffer: srcBuf(op.skip.src2) } });
      }
      const bindGroup = d.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries, label: op.name });
      const groups: [number, number, number] = [Math.ceil(s / tileW), Math.ceil(s / tileH), B * (ocg / localZ)];
      return { name: op.name, pipeline, bindGroup, groups };
    });
    // N5.10: interleave conv steps and attention bindings in graph order (one pass either way).
    type Step = { encode(pass: GPUComputePassEncoder): void };
    const steps: Step[] = [];
    const attnBindings: { release(): void }[] = [];
    let ci = 0;
    this.graph.ops.forEach((op, i) => {
      if (isAttn(op)) {
        const s = size >> op.level;
        const ab = this.attn.get(i)!.bind(s, s, tensorBuf(op.src), tensorBuf(op.dst), { residual: op.residual });
        attnBindings.push(ab);
        steps.push(ab);
      } else {
        const st = convSteps[ci++];
        steps.push({ encode: (pass) => { pass.setPipeline(st.pipeline); pass.setBindGroup(0, st.bindGroup); pass.dispatchWorkgroups(...st.groups); } });
      }
    });

    const run = () => {
      const enc = d.createCommandEncoder({ label: 'engine.halonet' });
      const pass = enc.beginComputePass();
      for (const st of steps) st.encode(pass);
      pass.end();
      d.queue.submit([enc.finish()]);
    };

    /** Read a packed tensor back as f32 [B][C][H][W] (NC4HW4 -> NCHW). Only valid for tensors in `keep` or the last op's output. */
    const readTensor = async (id: number): Promise<Float32Array> => {
      const t = this.graph.tensors[id];
      const s = size >> t.level;
      const c4 = ceil4(t.channels);
      const bytes = B * c4 * s * s * 4 * bpe;
      const staging = d.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = d.createCommandEncoder();
      enc.copyBufferToBuffer(tensorBuf(id), 0, staging, 0, bytes);
      d.queue.submit([enc.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const raw = staging.getMappedRange().slice(0);
      staging.destroy();
      const packed: ArrayLike<number> = this.f16 ? new F16!(raw) : new Float32Array(raw);
      const plane = s * s;
      const out = new Float32Array(B * t.channels * plane);
      for (let b = 0; b < B; b++) for (let c = 0; c < t.channels; c++) {
        const src = (b * c4 + (c >> 2)) * plane * 4 + (c & 3);
        const dst = (b * t.channels + c) * plane;
        for (let i = 0; i < plane; i++) out[dst + i] = packed[src + i * 4];
      }
      return out;
    };

    /** Upload f32 [B][C][H][W] (NCHW per item) into a tensor's slot (NC4HW4, T). For external tensors (N5.8 checks). */
    const writeTensor = (id: number, data: Float32Array) => {
      const t = this.graph.tensors[id];
      const s = size >> t.level;
      const c4 = ceil4(t.channels);
      const plane = s * s;
      if (data.length !== B * t.channels * plane) throw new Error(`engine: writeTensor ${id}: ${data.length} floats, want ${B}x${t.channels}x${s}x${s}`);
      const packed = new Float32Array(B * c4 * plane * 4);
      for (let b = 0; b < B; b++) for (let c = 0; c < t.channels; c++) {
        const dst = (b * c4 + (c >> 2)) * plane * 4 + (c & 3);
        const src = (b * t.channels + c) * plane;
        for (let i = 0; i < plane; i++) packed[dst + i * 4] = data[src + i];
      }
      const bytes = this.f16 ? new F16!(packed) : packed;
      d.queue.writeBuffer(tensorBuf(id), 0, bytes as unknown as BufferSource);
    };

    return {
      size, run, readTensor, writeTensor,
      release: () => { for (const b of owned) b.destroy(); for (const a of attnBindings) a.release(); },
    };
  }

  release() {
    for (const l of this.layers) { l.weights.destroy(); l.bias.destroy(); l.gather?.destroy(); l.gain?.destroy(); }
    this.layers = [];
    for (const a of this.attn.values()) a.release();
    this.attn.clear();
  }

  /** Dispatch count (attention = 2 dispatches per op). */
  get dispatches(): number { return this.layers.length + 2 * this.attn.size; }
}

export interface Binding {
  size: number;
  /** Encode every op into one compute pass and submit once. */
  run(): void;
  readTensor(id: number): Promise<Float32Array>;
  /** Upload f32 [B][C][H][W] into a tensor (graph inputs written by no op; N5.8). */
  writeTensor(id: number, data: Float32Array): void;
  release(): void;
}

/** Per-item channel table, vec4u per (item, chunk); entries past c1 are 0 (masked in the shader). */
function gatherTable(src: Extract<Source, { kind: 'input' }>, batch: number, c1: number): Uint32Array<ArrayBuffer> {
  const c1_4 = ceil4(c1);
  const out = new Uint32Array(batch * c1_4 * 4);
  for (let b = 0; b < batch; b++) {
    const row = src.gather[b];
    if (!row || row.length !== c1) throw new Error(`engine: gather row ${b} must list ${c1} channels`);
    for (let c = 0; c < c1; c++) {
      if (row[c] < 0 || row[c] >= src.channels) throw new Error(`engine: gather channel ${row[c]} out of range`);
      out[b * c1_4 * 4 + c] = row[c];
    }
  }
  return out;
}
