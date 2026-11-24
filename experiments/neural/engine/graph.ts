// HaloRT engine: op and tensor descriptions, and liveness slot sharing.
// Ported and generalised from the Denoiser repo, MIT, owner's own:
//   packages/denoiser-wgsl/src/graph.ts (Denoiser commit 7014384)
// What changed (docs/neural/ENGINE.md §5): `ConvOp` is no longer 3x3 + relu6
// only. It carries a kernel kind, an activation (none or RMSNorm + SiLU), a
// skip epilogue, an output scale (the x2 of stages without attention), the
// weight-name prefix, and an input source that can gather channels per batch
// item. Only the plain 3x3 path (kernel '3x3', act 'none', skip none,
// scale 1) is implemented in ./conv.ts so far (task N5.6); the others are typed
// and rejected by the shader generator.
//
// Tensor layout (all intermediates): NC4HW4 with a batch dimension, i.e.
// array<vec4<T>> indexed ((b * C4 + c4) * H + y) * W + x, C4 = ceil(C / 4),
// H = size >> level. Channels past C in the last vec4 are zero.
// Batch item b uses weight set (b < setSplit ? 0 : 1): with batch 6 and
// setSplit 3, items 0-2 are the `dir` network and 3-5 the `env` network.

/** Where a conv reads its input channels from. */
export type Source =
  /**
   * The network input: one planar f32 NCHW frame (batch 1, `channels` planes,
   * shared by all batch items). `gather[b]` lists which planes batch item b
   * reads, in order (length = the op's c1).
   */
  | { kind: 'input'; channels: number; gather: number[][] }
  /** A packed intermediate, optionally read 2x nearest-upsampled (`up`: 3x3 kernels only, N5.8). */
  | { kind: 'tensor'; id: number; up?: boolean };

export type Kernel = '3x3' | '1x1' | '2x2s2';
export type Activation = 'none' | 'normSilu';
export type Skip =
  | { kind: 'none' }
  /** Add x (same channels as the output) at the output pixel. Not implemented yet. */
  | { kind: 'identity'; src: Source }
  /** Add a 1x1 conv (weights `${weight}.weight/.bias`) over one or two concatenated sources (N5.8). */
  | { kind: 'conv1x1'; weight: string; src1: Source; c1: number; src2?: Source; c2: number };

export interface ConvOp {
  name: string;
  /** Weight key prefix in the .tza: `${weight}.weight`, `${weight}.bias` (and `${normG}` for normSilu). */
  weight: string;
  /** Key of the RMSNorm gain (act 'normSilu' only). */
  normG?: string;
  kernel: Kernel;
  /** Resolution level the conv writes (0 = full, 1 = 1/2 ...). */
  level: number;
  cout: number;
  src1: Source;
  c1: number;
  src2?: Source;
  c2: number;
  act: Activation;
  skip: Skip;
  /** Output multiplier applied after the skip (2 for stages whose attention is nn.Identity). */
  scale: 1 | 2;
  /** Packed tensor id written. */
  dst: number;
}

export interface TensorInfo { id: number; level: number; channels: number }

export interface Graph {
  ops: ConvOp[];
  tensors: TensorInfo[];
}

const sourcesOf = (op: ConvOp): Source[] => {
  const s: Source[] = [op.src1];
  if (op.src2) s.push(op.src2);
  if (op.skip.kind === 'identity') s.push(op.skip.src);
  if (op.skip.kind === 'conv1x1') { s.push(op.skip.src1); if (op.skip.src2) s.push(op.skip.src2); }
  return s;
};

/**
 * Assign intermediates to reusable buffer slots by liveness (a tensor's slot is
 * free again after its last reader). Tensors in `keep` are never freed (debug
 * readback). Returns slot per tensor id + slot count.
 */
export function assignSlots(g: Graph, keep: ReadonlySet<number> = new Set()): { slotOf: number[]; slots: number } {
  const lastUse = new Array<number>(g.tensors.length).fill(-1);
  g.ops.forEach((op, i) => {
    for (const s of sourcesOf(op)) if (s.kind === 'tensor') lastUse[s.id] = i;
  });
  const slotOf = new Array<number>(g.tensors.length).fill(-1);
  const free: number[] = [];
  let slots = 0;
  // External tensors (read but written by no op, e.g. uploaded with writeTensor, N5.8) get their own slots first.
  const written = new Set(g.ops.map((op) => op.dst));
  for (const t of g.tensors) if (!written.has(t.id)) slotOf[t.id] = slots++;
  g.ops.forEach((op, i) => {
    slotOf[op.dst] = free.length ? free.shift()! : slots++;
    // release inputs whose last reader is this op (after the output is placed,
    // so an op never writes the buffer it reads)
    for (const s of sourcesOf(op)) {
      if (s.kind === 'tensor' && lastUse[s.id] === i && !keep.has(s.id) && !free.includes(slotOf[s.id])) free.push(slotOf[s.id]);
    }
  });
  return { slotOf, slots };
}

/** HaloRT's channel gather (`_modeling.py` INDICES): pass k of each set, 8 of the 17 packed feature channels. */
export const HALO_GATHER = {
  dir: [[0, 1, 2, 3, 4, 5, 6, 10], [0, 1, 2, 3, 4, 5, 6, 11], [0, 1, 2, 3, 4, 5, 6, 12]],
  env: [[0, 1, 2, 3, 4, 5, 7, 10], [0, 1, 2, 3, 4, 5, 8, 11], [0, 1, 2, 3, 4, 5, 9, 12]],
} as const;

/** Batch of 6: items 0-2 dir passes 0-2, items 3-5 env passes 0-2. */
export const HALO_GATHER_B6: number[][] = [...HALO_GATHER.dir, ...HALO_GATHER.env].map((r) => [...r]);

/** The first layer only: init_conv, 3x3, 8 -> 16, bias, no norm, no activation (N5.6). */
export function initConvGraph(gather: number[][] = HALO_GATHER_B6): Graph {
  return {
    tensors: [{ id: 0, level: 0, channels: 16 }],
    ops: [{
      name: 'init_conv', weight: 'init_conv', kernel: '3x3', level: 0, cout: 16,
      src1: { kind: 'input', channels: 17, gather }, c1: 8, c2: 0,
      act: 'none', skip: { kind: 'none' }, scale: 1, dst: 0,
    }],
  };
}

/**
 * A ResnetBlock with identity skip (dim == dim_out) as two ops (kernels A and B, N5.7):
 * `block1` = conv3x3 + RMSNorm + SiLU, `block2` = the same, then + x, then x `scale`.
 * `prefix` is the weight prefix (e.g. 'downs.0.0'); x is tensor `xId`; writes `midId`, then `outId`.
 */
export function resnetBlockOps(prefix: string, name: string, level: number, channels: number,
  xId: number, midId: number, outId: number, scale: 1 | 2 = 1): ConvOp[] {
  const blk = (k: 'block1' | 'block2', src: number, dst: number, skip: Skip, sc: 1 | 2): ConvOp => ({
    name: `${name}.${k}`, weight: `${prefix}.${k}.proj`, normG: `${prefix}.${k}.norm.g`, kernel: '3x3', level,
    cout: channels, src1: { kind: 'tensor', id: src }, c1: channels, c2: 0, act: 'normSilu', skip, scale: sc, dst,
  });
  return [
    blk('block1', xId, midId, { kind: 'none' }, 1),
    blk('block2', midId, outId, { kind: 'identity', src: { kind: 'tensor', id: xId } }, scale),
  ];
}

/**
 * init_conv plus stage 0's two ResnetBlocks (N5.7 check). Tensors: 0 init_conv, 1 downs.0.0 block1,
 * 2 downs.0.0 out (dump `downs.0.block1`), 3 downs.0.1 block1, 4 downs.0.1 out x2 (dump `downs.0.post_attn_add`;
 * stage 0's attention is Identity, so the x2 is fused into the second block's epilogue).
 */
export function stage0Graph(gather: number[][] = HALO_GATHER_B6): Graph {
  const g = initConvGraph(gather);
  for (let i = 1; i <= 4; i++) g.tensors.push({ id: i, level: 0, channels: 16 });
  g.ops.push(...resnetBlockOps('downs.0.0', 'downs.0.0', 0, 16, 0, 1, 2, 1));
  g.ops.push(...resnetBlockOps('downs.0.1', 'downs.0.1', 0, 16, 2, 3, 4, 2));
  return g;
}

// ---------------------------------------------------------------------------------------------
// N5.8: Down, Up, concat ResnetBlocks, 1x1. Weight prefixes follow `_modeling.py` / halonet_ref.py.
// ---------------------------------------------------------------------------------------------

/**
 * Down (`downs.N.3`, N < 6): pixel-unshuffle 2x + 1x1 conv with bias, as ONE 2x2 stride-2 op (kernel C).
 * Weights `${prefix}.1.weight` [cout, 4*c, 1, 1] are used unchanged (channel c*4 + p1*2 + p2 = tap (p1, p2)).
 * `level` is the OUTPUT level (the input is at level - 1).
 */
export function downOp(prefix: string, level: number, c: number, cout: number, xId: number, dst: number): ConvOp {
  return {
    name: `${prefix}.down`, weight: `${prefix}.1`, kernel: '2x2s2', level, cout,
    src1: { kind: 'tensor', id: xId }, c1: c, c2: 0, act: 'none', skip: { kind: 'none' }, scale: 1, dst,
  };
}

/**
 * Up (`ups.N.3`, N < 6): nearest 2x then conv3x3 + bias, no norm (kernel D with an `up` source).
 * Weights `${prefix}.1.*`. `level` is the OUTPUT level (the source is at level + 1).
 */
export function upOp(prefix: string, level: number, c: number, cout: number, xId: number, dst: number): ConvOp {
  return {
    name: `${prefix}.up`, weight: `${prefix}.1`, kernel: '3x3', level, cout,
    src1: { kind: 'tensor', id: xId, up: true }, c1: c, c2: 0, act: 'none', skip: { kind: 'none' }, scale: 1, dst,
  };
}

/** Plain conv3x3 + bias, no norm: the last stage of each path (`downs.6.3`, `ups.6.3`; weights `${weight}.*`). */
export function plainConvOp(weight: string, level: number, c: number, cout: number, xId: number, dst: number): ConvOp {
  return {
    name: weight, weight, kernel: '3x3', level, cout,
    src1: { kind: 'tensor', id: xId }, c1: c, c2: 0, act: 'none', skip: { kind: 'none' }, scale: 1, dst,
  };
}

/** 1x1 conv + bias, no activation (`final_conv`, 16 -> 1). */
export function conv1x1Op(weight: string, level: number, c: number, cout: number, xId: number, dst: number): ConvOp {
  return {
    name: weight, weight, kernel: '1x1', level, cout,
    src1: { kind: 'tensor', id: xId }, c1: c, c2: 0, act: 'none', skip: { kind: 'none' }, scale: 1, dst,
  };
}

/**
 * A ResnetBlock over cat(x, s) (x FIRST) with the 1x1 `res_conv` skip (up path and final_res_block), two ops:
 * block1 reads the concat through two sources; block2's epilogue adds res_conv(cat(x, s)) read from the same
 * two sources, then x `scale`. Tensors: x `xId` (cx channels), s `sId` (cs), writes `midId`, then `outId`.
 */
export function resnetBlockCatOps(prefix: string, name: string, level: number, cx: number, cs: number, cout: number,
  xId: number, sId: number, midId: number, outId: number, scale: 1 | 2 = 1): ConvOp[] {
  const x: Source = { kind: 'tensor', id: xId };
  const s: Source = { kind: 'tensor', id: sId };
  return [
    {
      name: `${name}.block1`, weight: `${prefix}.block1.proj`, normG: `${prefix}.block1.norm.g`, kernel: '3x3', level,
      cout, src1: x, c1: cx, src2: s, c2: cs, act: 'normSilu', skip: { kind: 'none' }, scale: 1, dst: midId,
    },
    {
      name: `${name}.block2`, weight: `${prefix}.block2.proj`, normG: `${prefix}.block2.norm.g`, kernel: '3x3', level,
      cout, src1: { kind: 'tensor', id: midId }, c1: cout, c2: 0, act: 'normSilu',
      skip: { kind: 'conv1x1', weight: `${prefix}.res_conv`, src1: x, c1: cx, src2: s, c2: cs }, scale, dst: outId,
    },
  ];
}

/** One N5.8 check piece: tensors uploaded from dumps (`inputs`: tensor id -> dump name) and outputs compared. */
export interface CheckPiece { name: string; inputs: Record<number, string>; outputs: Record<number, string> }

/**
 * N5.8 check graph: independent pieces, each fed its reference INPUT from a dump (so errors do not chain).
 * All in one graph, one pass, one submit. Returns the graph and the pieces (dump names without `dir.`/`env.`).
 */
export function n58Graph(): { graph: Graph; pieces: CheckPiece[] } {
  const tensors: TensorInfo[] = [];
  const ops: ConvOp[] = [];
  const T = (level: number, channels: number) => { tensors.push({ id: tensors.length, level, channels }); return tensors.length - 1; };
  const pieces: CheckPiece[] = [];

  // 1. Down, stage 0: downs.0.post_attn_add (16, L0) -> 2x2 s2 -> downs.0.down (16, L1)
  const pa0 = T(0, 16), d0 = T(1, 16);
  ops.push(downOp('downs.0.3', 1, 16, 16, pa0, d0));
  pieces.push({ name: 'Down downs.0.3 (2x2 s2, 16 -> 16, 256 -> 128)', inputs: { [pa0]: 'downs.0.post_attn_add' }, outputs: { [d0]: 'downs.0.down' } });

  // 2. 32-channel ResnetBlock (identity skip): downs.3.down (32, L4) -> downs.4.0 -> downs.4.block1
  const x4 = T(4, 32), m4 = T(4, 32), o4 = T(4, 32);
  ops.push(...resnetBlockOps('downs.4.0', 'downs.4.0', 4, 32, x4, m4, o4, 1));
  pieces.push({ name: 'ResnetBlock downs.4.0 (32 ch, 16x16)', inputs: { [x4]: 'downs.3.down' }, outputs: { [o4]: 'downs.4.block1' } });

  // 3. 64-channel ResnetBlock: downs.5.down (64, L6) -> downs.6.0 -> downs.6.block1
  const x6 = T(6, 64), m6 = T(6, 64), o6 = T(6, 64);
  ops.push(...resnetBlockOps('downs.6.0', 'downs.6.0', 6, 64, x6, m6, o6, 1));
  pieces.push({ name: 'ResnetBlock downs.6.0 (64 ch, 4x4)', inputs: { [x6]: 'downs.5.down' }, outputs: { [o6]: 'downs.6.block1' } });

  // 4. Up stage 0 (coarsest): x = mid_block2, skips downs.6.post_attn_add then downs.6.block1 (all 64, L6)
  //    ups.0.0 (cat 128 -> 64, res_conv) -> ups.0.1 (cat 128 -> 64, res_conv, x2) -> Up (64 -> 64, L5)
  const u0x = T(6, 64), u0s1 = T(6, 64), u0s0 = T(6, 64);
  const u0m0 = T(6, 64), u0o0 = T(6, 64), u0m1 = T(6, 64), u0o1 = T(6, 64), u0 = T(5, 64);
  ops.push(...resnetBlockCatOps('ups.0.0', 'ups.0.0', 6, 64, 64, 64, u0x, u0s1, u0m0, u0o0, 1));
  ops.push(...resnetBlockCatOps('ups.0.1', 'ups.0.1', 6, 64, 64, 64, u0o0, u0s0, u0m1, u0o1, 2));
  ops.push(upOp('ups.0.3', 5, 64, 64, u0o1, u0));
  pieces.push({
    name: 'Up stage ups.0 (concat + res_conv at 4x4, x2, Up 4 -> 8)',
    inputs: { [u0x]: 'mid_block2', [u0s1]: 'downs.6.post_attn_add', [u0s0]: 'downs.6.block1' },
    outputs: { [u0o0]: 'ups.0.block1', [u0]: 'ups.0' },
  });

  // 5. Up stage 5 (Up at full resolution): x = ups.4 (16, L1), skips downs.1.post_attn_add, downs.1.block1
  const u5x = T(1, 16), u5s1 = T(1, 16), u5s0 = T(1, 16);
  const u5m0 = T(1, 16), u5o0 = T(1, 16), u5m1 = T(1, 16), u5o1 = T(1, 16), u5 = T(0, 16);
  ops.push(...resnetBlockCatOps('ups.5.0', 'ups.5.0', 1, 16, 16, 16, u5x, u5s1, u5m0, u5o0, 1));
  ops.push(...resnetBlockCatOps('ups.5.1', 'ups.5.1', 1, 16, 16, 16, u5o0, u5s0, u5m1, u5o1, 2));
  ops.push(upOp('ups.5.3', 0, 16, 16, u5o1, u5));
  pieces.push({
    name: 'Up stage ups.5 (concat at 128, x2, Up 128 -> 256)',
    inputs: { [u5x]: 'ups.4', [u5s1]: 'downs.1.post_attn_add', [u5s0]: 'downs.1.block1' },
    outputs: { [u5o0]: 'ups.5.block1', [u5]: 'ups.5' },
  });

  // 6. Up stage 6 (full resolution, last: plain conv): x = ups.5, skips downs.0.post_attn_add (tensor pa0), downs.0.block1
  const u6x = T(0, 16), u6s0 = T(0, 16);
  const u6m0 = T(0, 16), u6o0 = T(0, 16), u6m1 = T(0, 16), u6o1 = T(0, 16), u6 = T(0, 16);
  ops.push(...resnetBlockCatOps('ups.6.0', 'ups.6.0', 0, 16, 16, 16, u6x, pa0, u6m0, u6o0, 1));
  ops.push(...resnetBlockCatOps('ups.6.1', 'ups.6.1', 0, 16, 16, 16, u6o0, u6s0, u6m1, u6o1, 2));
  ops.push(plainConvOp('ups.6.3', 0, 16, 16, u6o1, u6));
  pieces.push({
    name: 'Up stage ups.6 (concat at 256, x2, plain conv3x3)',
    inputs: { [u6x]: 'ups.5', [u6s0]: 'downs.0.block1' },
    outputs: { [u6o0]: 'ups.6.block1', [u6]: 'ups.6' },
  });

  // 7. final_res_block: cat(ups.6, init_conv) 32 -> 16, res_conv
  const fx = T(0, 16), fr = T(0, 16), fm = T(0, 16), fo = T(0, 16);
  ops.push(...resnetBlockCatOps('final_res_block', 'final_res_block', 0, 16, 16, 16, fx, fr, fm, fo, 1));
  pieces.push({ name: 'final_res_block (cat 32 -> 16, res_conv)', inputs: { [fx]: 'ups.6', [fr]: 'init_conv' }, outputs: { [fo]: 'final_res_block' } });

  // 8. final_conv: 1x1 16 -> 1
  const cx = T(0, 16), co = T(0, 1);
  ops.push(conv1x1Op('final_conv', 0, 16, 1, cx, co));
  pieces.push({ name: 'final_conv (1x1 16 -> 1)', inputs: { [cx]: 'final_res_block' }, outputs: { [co]: 'final_conv' } });

  return { graph: { ops, tensors }, pieces };
}
