# Neural clouds — plan

Written 2026-11-23. Status lives in `work/neural/STATUS.md`, differences from
the source in `work/neural/DIVERGES.md`, research in `docs/research/neural/`.

## Goal

WebGPU neural rendering of clouds at different times of day.

The first step is a web implementation of HaloRT (arXiv 2611.12103), used as a
learning ground. It need not match the original everywhere: where our own
pieces are better suited (WebVDB loading, our sky, our path tracer, the
Denoiser repo's inference engine) we use them and write the difference down.

## What we start with

| Piece | State | Where |
| --- | --- | --- |
| HaloRT weights and model code | public, MIT | `github.com/rendervous/HaloRT` |
| HaloRT running in a browser | public demo by the authors (ONNX Runtime Web); 170–210 ms per frame at 512² on this Mac | `rendervous.github.io/rdv_on_the_web/halort/` |
| HaloRT training code and data | **not public** | — |
| Density on the GPU | `.vdb` → dense r16float 3D texture + empty-space SDF | `examples/lab/vdb-sky/vdb-direct.ts` |
| Sky and time of day | Hillaire LUTs, `solarPosition`, LUT → equirect bake | `@pmndrs/sky`, `examples/lab/reference-pt/bake.ts` |
| Ground truth | sibling path tracer, validated for dense clouds, headless float output | `examples/lab/reference-pt/`, pathtracer branch `clouds/volume-reference` |
| Network engine | hand-written WGSL conv U-Net, 5 ms at 512² for 0.9 M parameters; no attention, norm or residual ops yet | Denoiser `packages/denoiser-wgsl` |
| Small MLP engine with training | hand-written WGSL | pathtracer `packages/mlp` |

## Phases

Each phase ends in something the owner can look at. A phase is a handful of
tasks of about 20 minutes each. Timing and tuning are left to N7 on purpose.

### N0 — Research and plan ✅

Done 2026-11-23. 50 reference notes, field summary, this plan.

### N1 — Their demo, on our bench

**Goal:** know what stock HaloRT looks like and costs on our hardware.

- Serve the authors' demo files locally (kept under `artifacts/`, not
  committed: the demo repo has no licence).
- Run it in headless Chrome with the capture harness, with GPU timestamps.
- **Look at:** one sheet of their cloud at four sun angles; one line of
  numbers: features ms and network ms at 256² and 512².
- **Not in this phase:** any of our own code.

### N2 — Our feature pass

**Goal:** HaloRT's 14 feature channels, computed by our own WGSL on our own
density texture.

- Task a: optical depth and the four crossing depths (two-pass march, our SDF
  for empty-space skipping).
- Task b: sun transmittance at the first-interaction point.
- Task c: environment samples (importance-sampled equirect, shadowed).
- Task d: feature viewer page in the lab (nine panels, like the authors'
  explorer).
- **Look at:** our feature panels beside the authors' for the same Disney
  cloud, camera and sun.
- **Check:** the panels look the same side by side. Differences that survive
  go in DIVERGES, they do not block.

### N3 — Their network on our features

**Goal:** the first neural-lit picture of one of our clouds.

- Feed our feature buffer to the authors' ONNX network through ONNX Runtime
  Web on the renderer's own GPU device, then composite.
- Lab page with cloud picker, sun and sky sliders.
- **Look at:** sheet of two clouds × two suns: neural, path trace, our
  current raymarched lighting.
- **Not in this phase:** speed, integration with the cloud library.

### N4 — Time of day

**Goal:** the stated end goal, in slow form.

- Sun direction and colour from `solarPosition` and the sky LUTs; the sky
  baked to an equirect each time the sun moves, with the sun disc removed
  (HaloRT wants a smooth environment plus one directional light).
- **Look at:** a time-of-day strip (noon, low, sunset, dusk, afterglow) for
  one cloud, neural beside path trace.
- **Owner gate:** is this worth making fast and our own? The answers decide
  N5–N7.

### N5 — Our own engine

**Goal:** HaloRT running in hand-written WGSL with no ONNX runtime. This is
the foundation for any later network.

- Weight converter: PyTorch `.pt` state dict → our packed web format.
- New ops, one task each: 1×1 conv, RMSNorm + SiLU, residual add,
  pixel-unshuffle down / nearest up, block attention with memory tokens.
- **Check:** our output equals the ONNX output on one saved feature frame
  (a difference image that looks black).
- **Look at:** same picture as N3 from our engine, and one timing number.

### N6 — Into the cloud library

**Goal:** neural lighting as a selectable mode for VDB hero clouds.

- Behind a setting, with a Review switch and a tune-panel entry.
- Composited with our sky, aerial perspective and scene depth.
- **Look at:** the bench with the switch flipped.

### N7 — Speed and tuning (last on purpose)

- Lower resolution plus the upscaler; sun every frame and sky every few
  frames; the one-pass sun shortcut for grey albedo; fp16; fewer environment
  samples.
- Full timing tables happen here and nowhere earlier.

### NT — Training foundation (side track, starts only on the owner's yes)

**Goal:** be able to train or fine-tune, since the authors' training code is
not public and any network of our own needs it.

- Dataset generator on our path tracer: feature frames plus sun-only and
  sky-only targets, as float files.
- Training script in PyTorch reproducing the paper's loss and schedule.
- One small proof (for example a fine-tune for our dual-lobe phase).
- Needs decision D3 below.

## Protections

These exist because earlier work got stuck in gates, parity and long runs.

1. **One task = one change + one check.** About 20 minutes of agent work, at
   most 5 minutes of rendering. Hand-back: done / stuck on / proposed next.
2. **The check is a picture.** A side-by-side sheet, judged by eye. Numbers
   only say where to look. A difference nobody can see, or under about 15 %
   in brightness, is not a task.
3. **Two tries.** If a step fails its check twice, stop. Write it in DIVERGES
   as open and move on, or ask the owner. No third try without new
   information.
4. **Parity is not the goal.** A difference from the paper that we understand
   is a row in DIVERGES, not a bug.
5. **No timing or tuning before N7**, apart from one measurement per phase.
6. **Fixed check set:** Disney cloud and one of ours, noon and low sun, 256²
   or 512². The full time-of-day strip once per phase from N4 on.
7. **Nothing runs over 30 minutes** (render, test, training) without a stated
   decision that depends on it and the owner's yes.
8. **Never remove code.** New behaviour goes behind a setting; anything that
   reaches the bench gets a Review switch.
9. **Stuck or drifting agents stop and say so.** A fresh agent with a short
   brief replaces one that overran.
10. **Out of scope until the owner says otherwise:** cloudscapes, terrain or
    lights inside the cloud, phones, a temporal model, matching the paper's
    PSNR.

## Decisions for the owner

### D1 — How the network runs in the browser

| | A. ONNX Runtime Web | B. Hand-written WGSL | C. A first, then B (recommended) |
| --- | --- | --- | --- |
| Quality | exact | exact once verified | exact |
| Speed | 170–210 ms at 512² measured (whole frame, authors' demo) | unknown; the Denoiser engine suggests roughly 30–60 ms for six passes | A's now, B's later |
| Difficulty | low: weights already exported | high: five new ops, a weight converter, a parity check | spread over two phases |
| For future neural work | poor: new architectures depend on ONNX operator support; buffers only, no textures | best: any layer, fusions, caching, shared with the denoiser | best |
| Risk | runtime bugs outside our control (the Denoiser repo already hit an ORT conv bug) | we maintain every kernel | low |

**Recommendation: C.** A gives a picture within days and a reference to test
B against. B is where the speed and the reusable foundation are, and it
matches the goal of learning how these networks work.

### D2 — Where the engine work lives

| | A. Extend Denoiser's `denoiser-wgsl` (recommended) | B. Copy it into WebGPUClouds |
| --- | --- | --- |
| Quality | same | same |
| Speed | inherits its fp16 and fused-conv work | same at the time of the copy, then drifts |
| Difficulty | medium: its graph assumes 3×3 conv only, so it must be generalised without breaking OIDN | lower at first |
| Trade-off | one engine for denoising and clouds; touches a published package | two engines to maintain |

**Recommendation: A**, on a branch in the Denoiser worktree, with OIDN parity
re-run before any merge. Needed only at N5.

### D3 — Training

| | A. No training: stock weights only | B. Train on this Mac (PyTorch MPS), data from our path tracer | C. Rent an NVIDIA GPU, authors' renderer for data |
| --- | --- | --- | --- |
| Quality | the paper's; HG phase only, synthetic environments | ours to shape: our phase, our sky, smaller nets | same as B, closer to the paper's data |
| Speed of the result | fixed architecture | can train smaller, faster networks | same |
| Difficulty | none | high: generator, training loop, days of rendering | medium-high, plus cost and an account |
| Cost | none | machine time; the paper used 22 000 images at 4096 spp and 360 k steps | money per hour |

**Recommendation: A through N4, then decide.** Time of day needs no training:
it is a different sun and sky fed to the same weights. Build the dataset
generator (the first NT task) only after N4 shows the look is worth it. If we
train, start with B at small scale, because the generator on our own path
tracer serves every later neural idea.

### D4 — Reference for parity

The original Python code needs an NVIDIA card. Two options: use the authors'
browser demo as the oracle (runs here, verified against ONNX by them), or run
their notebooks on Colab (needs the owner's Google account).

**Recommendation:** the browser demo. Colab only if a difference cannot be
explained.

## Defaults chosen without asking (say if any is wrong)

- The neural track gets its own status and divergence files under
  `work/neural/` rather than rows in the main `work/STATUS.md` and
  `DIVERGES.md`, to keep the audit plan's tracking clean. The main status page
  has one line pointing here.
- Experiment code goes in `experiments/neural/` with lab pages under
  `examples/lab/neural/`.
- The feature pass is a hand port of the MIT-licensed GLSL, not the
  machine-translated WGSL in the authors' demo (no licence, unreadable).
- Scenes are one cloud in a box, as in the paper.
- The authors' demo files and the 13.7 GB cloud set stay local under
  `artifacts/`.
