# N5 engine design: HaloRT's network in hand-written WGSL

Design note for phase N5 of `docs/neural/PLAN.md`. No code yet. Sources:
`halort/_modeling.py` (HaloRT repo, MIT), `docs/research/neural/halort-anatomy.md`,
`work/logs/N1.md`, and the Denoiser WGSL engine (`packages/denoiser-wgsl`, Denoiser
commit `7014384`). Every number marked *estimate* is reasoning, not a measurement.

**Summary.** One HaloRT pass becomes **82 fused dispatches**. All six passes
run as one batch of 6 (weight set chosen per batch item), so a frame is
**82 dispatches in one compute pass and one submit**, against the 1,825 that ORT
Web issues. Estimated network time on the M5 Pro is **25–45 ms at 512² and
7–12 ms at 256²**, against 135 ms of measured wall time today. Build it first in
WebGPUClouds `experiments/neural/engine/`, then move the generic ops to Denoiser.

## 1. Op inventory (one pass, 512² input)

Resolution levels: 512, 256, 128, 64, 32, 16, 8. "Block" means conv3×3, then
RMSNorm, then SiLU. A ResnetBlock is two Blocks plus a skip connection.

| Op | Channels in → out | Resolution (px) | Count |
|---|---|---|---|
| conv3×3, first layer | 8 → 16 | 512 | 1 |
| ResnetBlock, identity skip | 16 → 16 | 512, 256, 128, 64 (×2 each) | 8 |
| ResnetBlock, identity skip | 32 → 32 | 32, 16 (×2 each) | 4 |
| ResnetBlock, identity skip | 64 → 64 | 8 (stage 6 ×2, mid ×2) | 4 |
| ResnetBlock, concatenated input, 1×1 skip | 128→64 @8, 96→64 @16, 64→32 @32, 48→32 @64 (×2 each) | 8–64 | 8 |
| ResnetBlock, concatenated input, 1×1 skip | 32 → 16 | 128, 256, 512 (×2 each), plus the final block @512 | 7 |
| Down: pixel-unshuffle 2×, then conv1×1 | 64→16 (×3), 64→32, 128→32, 128→64 | output at 256 … 8 | 6 |
| Up: nearest 2×, then conv3×3 | 64→64, 64→32, 32→32, 32→16, 16→16 ×2 | output at 16 … 512 | 6 |
| conv3×3 with no norm (end of the down path, end of the up path) | 64→64 @8, 16→16 @512 | | 2 |
| BlockAttention, 8×8 blocks with a 2 px halo | dim 16 @64 and 32 @16 (down); 64 @16 and 32 @64 (up) | | 4 |
| BlockAttention, 4×4 blocks with a 2 px halo (mid) | dim 64 @8 | | 1 |
| conv1×1, output | 16 → 1 | 512 | 1 |
| Concatenation | | inside the up ResnetBlocks, and before the final block | 15 |
| **×2, which is easy to miss**: stages without attention use `nn.Identity`, so `x = attn(x) + x` doubles x | | 5 down stages and 5 up stages | 10 |

Totals: 71 conv3×3, 22 conv1×1 (plus 5 qkv and 5 output 1×1s inside the
attention blocks) and 67 RMSNorms. **1,151,649 parameters per network**,
counted by parsing `halo_dir.pt` (273 tensors, fp32; 1.15 M × 4 B = 4.6 MB,
which matches the 4.7 MB file). Work per pass: **12.6 GMAC at 512²** (78 % of it
in the 16-channel full-resolution layers) and 3.1 GMAC at 256². Attention is
only 0.06 GMAC. The input size must be a **multiple of 256** in each
dimension, because the attention at 1/32 resolution needs a multiple of 8 and
the mid attention at 1/64 needs a multiple of 4. A 1280×720 frame would be
padded to 1280×768.

## 2. Fusion plan

| Dispatch | What it fuses | Per pass |
|---|---|---|
| **A** First conv of a ResnetBlock | conv3×3 + bias + RMSNorm + SiLU. The loader reads the concatenation of two sources (up path), as Denoiser does | 31 |
| **B** Second conv of a ResnetBlock | conv3×3 + bias + RMSNorm + SiLU + skip in the epilogue. The skip is either an identity read of x at that pixel, or a 1×1 over x's one or two concatenated sources, read straight from global memory. Then the ×2 where the stage has no attention. The final block also does the output 1×1 (16→1) | 31 |
| **C** Down | Pixel-unshuffle is folded into the loader. It is exactly a 2×2 stride-2 conv: input channel `c·4 + p1·2 + p2` maps to tap (p1, p2) of channel c | 6 |
| **D** Conv3×3 with no norm | The first conv, whose loader gathers 8 of the 17 feature channels by a per-item index table, so no gather pass is needed. The 6 up convs, with nearest-up in the loader (Denoiser's `up` source, reading at `(y>>1, x>>1)`). The 2 end-of-path convs | 9 |
| **E** Attention | RMSNorm + qkv 1×1 + local attention + output 1×1 + bias + residual (see §4) | 5 |
| | **Total** | **82** |

A later step can fold C into its producer's epilogue, the way Denoiser folds
maxpool. The producer then writes the full-resolution skip and the
downsampled tensor together, which brings a pass to 76 dispatches. The final
blend is one more dispatch per frame, or it goes into the cloud composite
shader we already have.

**RMSNorm constrains the kernel layout.** `F.normalize(x, dim=1)` divides each
pixel by the L2 norm over all of its output channels. Denoiser puts
output-channel groups in `workgroup_id.z` (`og = wg.z % p.ocg`), so different
workgroups own different channels of the same pixel, and no workgroup can
compute the norm. The change: move the channel group into
`local_invocation_id.z`. A workgroup is then 8×8 threads × G groups (each
thread owns 2×2 px × 8 channels, so G = C/8). The steps are:

1. Every thread writes the partial sum of squares for its pixels to
   `ss[G][pixels]` in workgroup memory, in f32.
2. Barrier.
3. Each thread sums its pixel's G partials and applies
   `y · g·√C / max(‖y‖, 1e-12)`, then SiLU (f32 math, f16 store).

Fold `√C` into `g` at load time. A side benefit is that the input tile is
staged once for all output channels, where Denoiser stages it once per channel
group. The limit is 256 invocations per workgroup, so 64-channel layers (only
at ≤16² from a 512² input) use 4×4-thread tiles with 1 px per thread. The
16-channel layers can also use G = 1 with 4 vec4 accumulators per thread.
Tune both.

## 3. Batching the six passes

| Option | Dispatches per frame | Live intermediates, 512² fp16 | 256² | Notes |
|---|---|---|---|---|
| (a) six sequential runs | 492 | ~50 MB | ~13 MB | Each low-resolution layer launches very few workgroups |
| (b) batch of 3 per weight set, 2 runs | 164 | ~150 MB | ~38 MB | Denoiser already batches through `wg.z` |
| **(c) one run, batch 6, weight set = item / 3** | **82** | **~300 MB** | **~75 MB** | Both weight sets in one buffer, offset by `set · stride` per layer |

Memory per item: the peak is about 6 live 16-channel full-resolution tensors
during the last up stage (the skip `r`, two skips `h`, x, and two temporaries)
at 8.4 MB each. Weights add 2 × 2.3 MB in f16.

**Recommendation: (c).** It needs the fewest dispatches, and the 6× batch fills
the 8²–32² layers that would otherwise run a handful of workgroups. Clouds have
grey albedo, so the sun's three colour inputs are identical (the anatomy note's
"one-pass sun shortcut"). Run 1 dir + 3 env = **batch 4**: the same 82
dispatches, ~200 MB and ⅔ of the work. At 1024², one 6-item level-0 slot is
201 MB, which is over the default 128 MB `maxStorageBufferBindingSize`. Request
the adapter's maximum limits there, as `requestMaxDevice` does, or fall back
to (b).

## 4. Block attention kernel

**One dispatch per attention layer** (5 per pass). One workgroup handles one
output block per batch item: 64 threads for an 8×8 block, 16 threads for the
4×4 mid block (pack 4 mid blocks per workgroup).

1. **Load the window.** Read the 12×12 window (8×8 at mid) of x, all `dim`
   channels, from the NC4HW4 f16 tensor. The padding is global, so only the
   image edges reflect: index `-1 → 1` and `H → H-2`. Interior halos are plain
   neighbour pixels. This matches `F.pad(reflect)` followed by `unfold`,
   because qkv is a 1×1 (per pixel), so it does not matter whether we pad
   before or after qkv.
2. **Norm and projection, per token.** Apply RMSNorm (all channels are
   present), then `to_qkv` (dim → 48, no bias). Keep k and v for all 144 tokens
   and q only for the 64 centre tokens; queries in the halo are computed by
   PyTorch and then cropped. Store them in workgroup memory as f16:
   (144·32 + 64·16) · 2 B = **11.3 KB**. f32 would need 22.5 KB, over the
   16 KB default. Each thread projects about 2.25 tokens.
3. **Barrier.** Each thread then owns one query pixel. For each of the 4 heads
   it runs an **online softmax in f32** (running max and sum) over 8 memory
   keys (read from `mem_kv` in the weights buffer) plus 144 window keys, with
   a 4-wide dot product and scale 0.5 (SDPA's default `1/√4`).
4. **Epilogue.** Apply the output projection 16 → dim + bias, add the
   residual with the **un-normalised** x, and store. In down stages 3 and 5 the
   epilogue can also do the following Down (see §2).

Per thread: 152 keys × 4 heads × 8 FMA = **~4.9 k FMA + 608 exp**, plus
about 2.25 × dim × 48 for qkv. A 3×3 conv costs 2.3 k MAC per pixel at 16→16
and 9.2 k at 32→32. So **an attention layer costs about 1–2 convs at its own
resolution**. All five together are under 1 % of the pass's MACs, so they are
not worth tuning before the convs.

## 5. Reuse or new (Denoiser paths under `packages/`)

| Part | Status |
|---|---|
| `denoiser-wgsl/src/conv.ts`: `packWeights`, `packBias`, `ceil4`, the tile loader (zero pad, `up`, two-source concat), f16 sums per 4-channel chunk, the runtime `ky` loop | **Reuse.** These are the parts that took Denoiser from 200 ms to 37 ms. `packWeights` handles 1×1 and 2×2 kernels once the tap count is a parameter |
| `denoiser-wgsl/src/graph.ts`: `assignSlots` (liveness slot sharing) | **Reuse**, extended to the residual source and to two outputs |
| `denoiser-wgsl/src/runtime.ts`: one encoder and one pass per run, per-op timestamp `profile` mode, `requestMaxDevice`, per-geometry `bind` | **Reuse the pattern** |
| `denoiser-core/src/tza.ts` `parseTZA` | **Reuse as is.** It accepts any number of dims and f32/f16 tensors, so the converter writes `.tza` (§6) |
| `graph.ts` `ConvOp` / `buildGraph` | **Generalise.** It requires 3×3 pad-1 (throws otherwise) and relu6, and has one output. It needs kernel ∈ {1×1, 2×2 s2, 3×3}, an activation of none or norm+SiLU, a skip (none, identity, or 1×1 over 1–2 sources), an output scale, a weight-set stride, an input gather table, and an attention op kind |
| `conv.ts` epilogue and workgroup mapping | **Generalise.** Channel groups move from `wg.z` to local z (§2). The skip and ×2 go in the epilogue |
| `runtime.ts` `bind` | **Generalise.** It assumes a 3-channel NCHW output and an OIDN `.tza` URL. Dimensions here must be multiples of 256 |
| `denoiser-wgsl/src/mma.ts` (subgroup matrix) | **Not at first.** It is 3×3 only and uses f32 operands. For fp16, Denoiser's portable kernel was already faster |
| Attention kernel, HaloNet graph builder, converter, blend | **New** |

**Where the code lives.** Experiment in **WebGPUClouds**:

- `experiments/neural/engine/` for the ported and generalised conv, the graph,
  attention and the runtime. Each ported file's header names Denoiser
  `7014384`.
- `scripts/neural/` for the converter and the NumPy reference.
- `examples/lab/neural/` for an "engine: ORT / ours" switch.

The fixture, the weights, the ORT demo and the lab page all live here, and the
Denoiser `NetworkRuntime` contract (3-channel NCHW, OIDN names) does not fit
HaloRT. That makes this the easiest place, which is what the owner's D2 rule
asks for. For delivery, once parity passes, move the **generic ops** (the
generalised conv, attention, graph types) into Denoiser
`packages/denoiser-wgsl/src/` under its own parity run. The **HaloNet graph,
converter and blend** stay in WebGPUClouds and import those ops.

## 6. Weight import

- **Source: the `.pt` files.** Each is a zip holding `halo_dir/data.pkl` plus
  raw little-endian fp32 storages in `halo_dir/data/N`. Python's standard
  library can read them with a small `pickle.Unpickler` that maps
  `torch._utils._rebuild_tensor_v2` to (storage, offset, size). This was done
  for this note; it needs no torch, which is not installed on the Mac. The
  **ONNX files are harder**: they need a protobuf parser (no `onnx` package
  here either), their initializer names are export-generated, and the fp16
  file is a lossy re-export. Use them only as the parity reference.
- **Keys** follow the module tree, for example
  `downs.{0-6}.{0,1}.block{1,2}.proj.{weight,bias}`, `….norm.g`,
  `ups.{i}.{0,1}.res_conv.*`, `downs.{i}.3.1.*` (Down's 1×1),
  `ups.{i}.3.1.*` (Up's conv), `downs.6.3.*` / `ups.6.3.*` (end-of-path
  convs), `{downs.3,downs.5,ups.1,ups.3}.2.{mem_kv,norm.g,to_qkv.weight,to_out.*}`,
  `mid_block{1,2}.*`, `mid_attn.*`, `final_res_block.*`, `final_conv.*`.
- **Format:** write `.tza`, one per network (`halo_dir.tza`, `halo_env.tza`),
  in fp32 with key names unchanged. The converter stays dumb, and packing and
  f16 conversion happen at load (as in Denoiser's `runtime.ts`), so kernel
  layouts can change without re-converting.
- **Re-layout at load:**
  - 3×3 weights go through `packWeights` (mat4x4 per oc4 × chunk × tap).
  - 1×1 weights use the same function with 1 tap.
  - **Down's 1×1 (cout, 4c) is reshaped to (cout, c, 2, 2)** and packed with 4 taps.
  - `res_conv` and `to_out` use the 1-tap packing.
  - `to_qkv` rows are q 0–15, k 16–31, v 32–47, each laid out as head·4 + d.
  - `norm.g` is pre-multiplied by `√C`.
  - `mem_kv` (2, 4, 8, 4) is kept as is.
  - Biases are stored as f32 vec4.

## 7. Parity test

1. **Fixture.** Save one feature frame (17 × H × W f32, from our N2 feature
   pass or from the demo's input) at 256² and 512². Run the authors' ONNX on
   it in ORT Web with the **wasm EP as the reference**. Denoiser found
   ORT-WebGPU conv bugs with first convs of more than 3 channels, and
   HaloRT's has 8. Record the WebGPU EP output beside it.
2. **Reference.** Write a NumPy forward pass (NumPy 2.5 is installed) built
   from the `.tza`, which dumps every op's output. It must match ORT-wasm end
   to end to within 1e-4 relative before it is trusted.
3. **Per layer.** Add a debug mode to the engine that copies each op's output
   to a readback buffer (NC4HW4 → NCHW). Compare it with the NumPy dump.
   Thresholds: fp32 ≤ 1e-4 relative L2, fp16 ≤ 5e-3. Denoiser's fp16 runs
   were 3–7e-3 off.
4. **End to end.** Compare the 6 outputs and the blended image against
   ORT-wasm: max abs error, PSNR, and a difference PNG at ×10 that should
   look black. Do this at both sizes.

## 8. Expected cost (*estimate*)

Assumptions:

- **Work:** 12.6 GMAC per pass at 512², so 75 GMAC for 6 passes (50 for 4).
- **Shader throughput:** ORT's own kernels manage 75 GMAC in 32.7 ms of
  timestamped shader time, about 2.3 TMAC/s. Denoiser's tuned fp16 kernel
  reaches 2.7–3.4 TMAC/s on wide layers. Our 16-channel layers will be less
  efficient, so assume ORT's kernel time ±25 %.
- **Dispatch overhead:** at most 55 µs × 82 = 4.5 ms per frame if N1b's gap is
  per dispatch. Denoiser's 16-dispatch run shows no such gap, so it is likely
  less.

| Batch | 512² network | 256² network | 512² frame incl. features (6.5 ms) | 256² frame (~2 ms features) |
|---|---|---|---|---|
| 6 passes | **25–45 ms** | **7–12 ms** | 32–50 ms | 9–14 ms |
| 4 passes (grey albedo) | 17–30 ms | 5–8 ms | 24–37 ms | 7–10 ms |

Today the same work takes 135 ms of network wall time at 512². The win is
almost all from removing the dispatch overhead (1,825 → 82), not from faster
maths. The 256² figure is the realistic real-time target, upscaled as in the
performance strategy. 256² scales worse than ¼ because its low-resolution
layers run few workgroups; the batch of 6 helps here.

**Subgroup matrix: about 0 % for the fp16 path.** Denoiser gained 15–30 % only
in fp32 (57 → 44–50 ms at 1080p). f16 subgroup matrices exist only with f16
accumulation, and the portable f16-sum kernel already beat them. It would
matter only if fp16 parity failed and we had to run fp32. Keep it as a later
option behind its flag.

## 9. Task list

Each task is one change and one check, about 20 minutes. The `‖` column lists
tasks that can run at the same time as this one.

| # | Task (change → check) | Model | ‖ |
|---|---|---|---|
| 1 | **Dispatch-overhead probe:** a page issuing 82 vs 1,825 small dependent dispatches in one pass and one submit → wall time per dispatch on the M5 Pro, logged in `work/logs/N5.md`. This settles N1b's open question before any kernel work | Sonnet | 2, 3 |
| 2 | **Converter** `scripts/neural/pt_to_tza.py` (stdlib, `python3 -I`) → 273 tensors and 1,151,649 parameters per file; `parseTZA` reads 3 sampled tensors back bit-identical | Sonnet | 1, 3 |
| 3 | **Fixture:** a saved feature frame at 256²/512² plus ORT-wasm and ORT-WebGPU outputs of the authors' ONNX → a re-run of wasm is byte-identical; the wasm vs WebGPU difference is recorded | Sonnet | 1, 2 |
| 4 | **NumPy reference** `scripts/neural/halonet_ref.py` with per-op dumps → matches task 3's ORT-wasm output to within 1e-4 | Sonnet (Opus if attention disagrees) | — |
| 5 | **Engine skeleton** in `experiments/neural/engine/`: ported runtime and slots, generalised `ConvOp`, the D kernel (first conv with gather, plain 3×3) → first-conv output vs the NumPy dump within the fp16 threshold | Opus | — |
| 6 | **A/B kernels:** norm+SiLU with channel groups in local z, skip and ×2 in the epilogue → `downs.0.0`, `downs.0.1`, `ups.6.0` and `final_res_block` vs dumps | Opus | 7, 8 |
| 7 | **C kernel and 1×1 packing:** Down as a 2×2 stride-2 conv, plus the up path through `up` sources → `downs.0.3` and `ups.5.3` vs dumps | Sonnet | 6, 8 |
| 8 | **Attention kernel (E)** → `downs.3.2`, `ups.1.2` and `mid_attn` vs dumps at 256² and 512² | Opus | 6, 7 |
| 9 | **Full graph:** HaloNet builder (82 ops), batch of 6 with weight-set stride, one pass and one submit, blend → end-to-end parity vs ORT-wasm (difference PNG looks black) at both sizes | Opus | — |
| 10 | **Timing:** profile mode per op, plus `onSubmittedWorkDone` wall time at 256²/512², batch 6 and 4 → a table in `work/logs/N5.md` beside N1's 142 ms | Sonnet | — |

After task 10:

- Fold Down into its producer (76 dispatches).
- Run the lab "engine" switch.
- Upstream the generic ops to Denoiser.
- Optionally probe the subgroup matrix.

## 10. Risks and open questions

- **The premise rests on dispatch overhead.** If N1b's ~100 ms is Metal idling
  between *dependent* dispatches, and not per-dispatch API cost, even 82
  dispatches pay some of it, and ORT's 2.3 TMAC/s leaves little to win on
  shader time. Task 1 answers this first.
- **Precision:** ORT's fp16 export may differ from fp32 PyTorch by more than
  our fp16 threshold. Judge parity against fp32 wasm, and compare picture
  differences by eye (the owner's eye counts over statistics).
- **Low-resolution layers:** the 64-channel layers at 8²–16² with a 256-thread
  workgroup cap may need their own tilings, which Denoiser lists as unfinished.
- **Two copies of the conv kernel** will drift until the upstream task is
  done. Keep the port small and name its source commit.
- **Open:** does the demo's ONNX expose the six per-channel outputs, or only
  the blended image? Task 3 finds out. It decides whether the fixture checks
  per item or only the composite.

## Beyond HaloRT

- **A much smaller U-Net** (8–16 channels, 3–4 levels) needs the same ops. The
  dispatch count then tracks depth, not width. The next step would fuse the
  whole low-resolution tail (≤ 32², which fits in one workgroup's memory) into
  a single dispatch, and fuse pairs of 3×3 convs with halo recompute.
- **A per-sample MLP** inside the ray march needs none of the image ops. It is
  a WGSL function called from the march shader, with weights in workgroup
  memory and activations in registers. Pathtracer `packages/mlp` already has
  this, with training, so start there rather than from this engine.
- **Shared tooling for both:** the `.tza` converter, the NumPy per-op
  reference and parity harness, profile mode, and per-item weight-set indexing.
- **Training** stays in PyTorch (the owner's 3060, Colab later). The engine
  only needs the state dict's key names to stay stable.
