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
  /** A packed intermediate, optionally read 2x nearest-upsampled (not implemented yet). */
  | { kind: 'tensor'; id: number; up?: boolean };

export type Kernel = '3x3' | '1x1' | '2x2s2';
export type Activation = 'none' | 'normSilu';
export type Skip =
  | { kind: 'none' }
  /** Add x (same channels as the output) at the output pixel. Not implemented yet. */
  | { kind: 'identity'; src: Source }
  /** Add a 1x1 conv (weights `${weight}.weight/.bias`) over one or two concatenated sources. Not implemented yet. */
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
