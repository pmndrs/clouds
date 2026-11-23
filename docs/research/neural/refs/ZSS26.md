# ZSS26 — Neural scene baking for permutation invariant transparency rendering with real-time global illumination

- **Authors / year / venue:** Zhang, Simo-Serra (Waseda); 2026; Computational Visual Media 12(2):321-335, doi 10.26599/CVM.2025.9450433
- **Paper:** https://arxiv.org/abs/2405.19056 (arXiv v1, May 2024; local: `artifacts/research/papers/neural/ZSS26-zhang-2026.pdf`). The CVM journal version was not checked against the preprint.
- **Project page:** none found
- **Official code:** https://github.com/ziyangz5/NeuralBakingTransparency is the repo for this paper (MIT) but contains only a README ("code will be available soon") and LICENSE: no code released. Sibling follow-up with real code: https://github.com/ziyangz5/CrystalNet (Python, Apache-2.0, training and evaluation scripts, refraction baking).
- **Third-party code:** none found
- **Data / weights:** none found
- **Cited by HaloRT as:** G-buffer neural GI with order-independent transparency; relevant to semi-transparent media in G-buffers.

## Summary
Problem: neural GI from G-buffers fails behind transparent surfaces because a G-buffer only stores the front surface. They keep separate G-buffers for opaque and for each transparent object, and need a network that does not depend on the order of the transparent layers.

Method: GlassNet has four parts: scene encoder F (U-Net) on opaque G-buffers (position, normal, texture, material, view dir, depth, direct lighting from LTCs); a permutation-invariant transparency blending function T, PointNet-like: a shared CNN h applied to each transparency buffer, summed (g = addition, matching alpha blending), so memory is two buffers regardless of object count; blending network B (U-Net) merges them; render network R (multi-layer CNN, 1x1 kernels at the end to avoid shape distortion). NeRF positional encoding on inputs. Trained at 256x256 on 5 to 10 h with 8 RTX 2080 Ti; a small CNN super-samples 2x. Loss SSIM + L1, Adam.

Results: beats Active Exploration and Neural GI (CNSR) on MAE/PSNR/LPIPS/DSSIM on 4 scenes (e.g. Cornell box PSNR 26.2 dB vs 20.5 for CNSR). Custom OpenGL/C++ renderer with CUDA inference on one RTX 4090: 256x256 at 63 FPS and 512x512 at 32 FPS (about 16 and 31 ms) on scenes with several transparent objects.

## Use for us
Order-independent sum-of-latents blending is a neat pattern if we want to accumulate several cloud layers or media without sorting. A 4090-class 256x256 at 60 FPS gives a realistic number for a small CNN pipeline with CUDA.
