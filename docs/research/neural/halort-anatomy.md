# HaloRT anatomy — what the paper and the released code actually do

Source: arXiv 2611.12103 (Leonard & Westermann, TUM, 9 Nov 2026) and
`github.com/rendervous/HaloRT` at the commit pushed 2026-11-13 (MIT). Paper
copy: `artifacts/research/papers/neural/HALORT-leonard-westermann-2026.pdf`.
File and line references are to `halort/` in that repo.

## The idea in five lines

1. Do not path trace. March each **primary ray** once through the density grid
   and write a handful of cheap numbers per pixel (features).
2. At one point on the ray (the expected first scattering event) take one
   shadow ray to the sun and about 8 shadow rays to the environment map.
3. A small image-to-image network turns those feature images into the
   multiply-scattered radiance. It never sees a radiance sample.
4. Light is linear, so sun and environment are inferred separately with unit
   intensity and scaled afterwards. Colour channels are independent, so the
   same 8-in / 1-out network runs once per channel.
5. Final image: `(sun * I_dir + envScale * I_env) * S + background * envScale * (1 - S)`
   where `S = 1 - exp(-tau)` is the pixel's interaction probability
   (`_modeling.py:1396`).

## What is released, and what is not

| Released | Not released |
| --- | --- |
| Inference model code (`_modeling.py`) | Training code (`training/_halo_channel_training.py` is referenced, absent) |
| Weights: `halo_dir.pt`, `halo_env.pt` (4.7 MB each, fp32 state dicts), `denoiser.pt`, `denoiserx.pt` | Dataset generation, the 22 000 rendered training instances |
| Feature shader in GLSL (`volume_deep_profile.h`, 316 lines) | The 1000 synthesised HDR environments |
| Two sample clouds (max 160 voxels), 500-cloud set on Hugging Face (`rendervous-project/compact_clouds`, 13.7 GB) | Evaluation scripts |
| Reference path tracer through the `rendervous` engine (`render_full_radiance`) | — |

The code needs `rendervous` (Vulkan + CUDA interop), so it runs on an NVIDIA
card under Linux/Windows or Colab, not on a Mac. It is our reference
implementation: features and outputs dumped from it are the parity targets.

## Features (per pixel)

`VolumeDeepProfile` writes 14 channels (+3 background) (`_modeling.py:1425`):

| # | Name | Meaning | Encoding in the released code |
| --- | --- | --- | --- |
| 0 | depth | distance `t1` to the expected first interaction | `log(1 + 0.2 * t1)` |
| 1–3 | crossings | gaps between the crossing depths at density scales ×1, ×0.25, ×0.125 (first is ×4) | `(t_i - t_{i-1}) ^ 0.25` |
| 4 | tr | reduced optical depth | `1 - exp(-0.2 * tau)` |
| 5 | g | Henyey–Greenstein anisotropy | raw |
| 6 | nee | transmittance from `x(t1)` to the sun | raw, stochastic (ratio tracking beyond 0.1 units) |
| 7–9 | env rgb | mean over N env samples of `T * phase * L_env / pdf` | raw, stochastic |
| 10–12 | sa rgb | albedo, as path-through absorption | `sa ^ (2 * tau * (1 - sa * g))` |
| 13 | S | `1 - exp(-tau)`, used only in the composite | raw |

Per-channel network input (8): `depth, d1, d2, d3, tr, g, <nee | env_c>, sa_c`.

The crossing rule: for scale `s`, `tau_c = 1 - (s*tau * exp(-s*tau)) / (1 - exp(-s*tau))`,
and the crossing depth is the first `t` where `s * tau(t) >= tau_c`. Scales are
sorted so one second traversal finds all four.

**Code ≠ paper (use the code; the weights were trained on it):**

- Density scales are `[4, 1, 0.25, 0.125]`, the paper says `×4, ×1, ×0.25, ×0.1`.
- Reduced optical depth is `1 - exp(-0.2 tau)`, the paper prints `1 - 1/(1 + 0.5 tau)`.
- Depth and crossings are re-encoded (log and fourth root); albedo is the
  accumulated-absorption form. The paper describes neither.
- `use_similarity_anisotropy` is **off** for the shipped checkpoints.
- Default environment samples is 16 in code, 8 in the paper.

## How the features are marched

- Volume fits a `[-1, 1]^3` cube. Fixed step `0.001` units (up to ~2000 steps
  across), skipping empty cells by DDA over a coarse majorant grid (about
  64 cells on the long axis). Stops at `tau > 20`.
- Pass 1 accumulates `tau`. Pass 2 restarts at the first non-empty sample and
  finds the four crossings.
- Sun transmittance: deterministic march over the first 0.2 units, then ratio
  tracking with a sphere-radius majorant field.
- Environment: importance-sample the env map by luminance, ratio-track
  transmittance, weight by the HG phase.

## Network (`_modeling.py:559`, built at `:1485`)

`HaloNetFast(channels=8, dim=16, out_dim=1, dim_mults=(1,1,1,2,2,4,4), attn_modes=(0,0,0,2,0,2,0), attn_heads=4, attn_dim_head=4)`

- U-Net, 7 stages, channel widths 16, 16, 16, 32, 32, 64, 64; six 2× downsamples
  (input must divide by 64). About 1.17 M parameters per network.
- Stage = ResNet block, ResNet block, optional attention (residual), down/up.
  ResNet block = two × (conv 3×3 → RMSNorm → SiLU) + 1×1 skip.
- RMSNorm is an L2 normalise over channels times a learned gain times `sqrt(C)`.
- Down = pixel-unshuffle 2× then conv 1×1. Up = nearest 2× then conv 3×3.
- Skip connections concatenate (two per stage), plus the first conv's output
  into a final ResNet block, then conv 1×1 to one channel.
- Attention (`BlockAttention`, `:352`): local windows. Blocks of 8×8 with a
  2-pixel reflected halo (12×12 = 144 tokens) at two stages (down and up, at
  1/8 and 1/32 resolution), and 4×4 blocks (8×8 = 64 tokens) at the bottleneck.
  4 heads of 4 dims (16 hidden), 8 learned memory key/values per head, no
  position embedding. Query, key and value all cover the padded window; only
  the centre block is kept.
- Runs in half precision already (`.half()`), six passes per frame
  (2 light components × 3 channels). A one-pass sun shortcut exists when the
  albedo is grey.

## Cost reported

| Resolution | One pass (RTX 5090) | Six passes |
| --- | --- | --- |
| 256² | 1.4 ms | ~8.5 ms |
| 512² | 1.6 ms | ~9.4 ms |
| 1024² | 2.9 ms | ~17.5 ms |
| 2048² | 10.5 ms | ~63 ms |

Feature capture is on top of this. A Mac GPU in a browser will be many times
slower; nobody has measured it yet. That measurement is phase N3 of the plan.

## Limits the authors state

Clouds only; HG phase only; one volume; distant light only (smooth environment
plus one sun); no surfaces or local lights inside the medium; no emission;
shared extinction across colour channels; synthetic training environments.
No temporal model: each frame is independent (stable because the features are
nearly deterministic).
