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

## Decisions (owner, 2026-11-24)

| ID | Decision |
| --- | --- |
| D1 | ONNX Runtime Web first to get running, hand-written WGSL after. Do not expect the network to get faster until it is hand-written. Subgroup-matrix kernels count as an option though still behind a Chrome flag. |
| D2 | Experiments go wherever is easiest. For delivery, work that changes the denoiser engine lives in Denoiser; work that is about cloud rendering lives in WebGPUClouds. Decide per sprint by what that sprint's work is about. Cross-project work is fine. |
| D3 | Stock weights through N4, then decide. No rented GPU until we know the path is right. The owner has an NVIDIA 3060 (low memory); Colab is a later option. |
| D4 | The authors' browser demo is the parity reference. |

The owner's framing: build as planned, but this is a foundation and a way to
learn. Our own work may end up differing from HaloRT's approach. Bringing the
frame time down matters.

### The bar (owner, 2026-11-24, later the same day)

- The goal is speed and quality of cloud rendering. Our VDB and cloud
  raymarchers are already fast. Lighting that costs more than a frame is a
  step backwards, so every neural result is judged against the raymarcher:
  milliseconds, and the picture beside the path trace. Being faster than ONNX
  Runtime or close to the paper does not count.
- The HaloRT port is finished as a base for completeness. It stays on this
  experimental branch. **It does not go to main unless it is a speed
  improvement.** N6 (into the cloud library) is on hold for that reason.
- The follow-up directions are documented only (`docs/neural/FOLLOWUPS.md`),
  each with how it could raise speed or quality against the core raymarcher.
  No training or design work on them until the owner says we are closer.

**How agents are used:** Sonnet for gathering and minor code, Opus for code
and first-pass reviews, nothing higher unless Opus struggles. Short runs with
a fresh agent per task; reuse an agent's context only when it helps the next
task. Shared state lives in `work/neural/STATUS.md`, `TASKS.md`, `DIVERGES.md`
and `work/logs/`, so a fresh agent can pick up from the files.

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
