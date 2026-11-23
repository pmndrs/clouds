# LYG26 — Multi-feature radiance baking neural networks for instant volumetric rendering (MRBNN)

- **Authors / year / venue:** Liang, Yuan (Xiaomi), Gai, Wang, Li (Peking Univ.); SIGGRAPH 2026 Conference Papers, Los Angeles, 19-23 July 2026; doi 10.1145/3799902.3811179 (CC BY 4.0)
- **Paper:** https://extra-creativity.github.io/assets/pdf/MRBNN/paper.pdf (local: `artifacts/research/papers/neural/LYG26-liang-2026.pdf`; supplementary `LYG26-liang-2026-supp.pdf`). No arXiv version found.
- **Project page:** https://extra-creativity.github.io/projects/MRBNN (paper, supplementary, slides, poster; supplementary video listed there)
- **Official code:** https://github.com/xiaomi-research/mrbnn — C++20/CUDA renderer, GitHub licence shows NOASSERTION (README: non-commercial use only), last push 2026-08. Includes three baked sample scenes with trained MLP and feature-grid binaries under `data/` (cloud-03, bunny-albedo, ...). The README states training code and dataset are NOT released (company policy). Tested MSVC + CUDA 12.6/13.0 on an RTX 40xx; Linux untested.
- **Third-party code:** none found (https://github.com/PeterZs/MRBNN is a fork/mirror of the official repo).
- **Data / weights:** baked per-scene weights and grids in the official repo; the Cloud1 volume must be fetched from the MRPNN OneDrive demo (4 GB).
- **Cited by HaloRT as:** per-volume baked low-rank latent of the scattering operator; HaloRT stresses that it must be trained for each volume it renders, while HaloRT generalises to unseen volumes.

## Summary
Problem: MRPNN is real time but still heavy, is limited to globally constant albedo and phase, and shows over-illumination. Method: they show the in-scattering integral of the volumetric radiance transfer equation is a diagonal scaling operator in the spherical-harmonics spectrum, and exploit that with a low-rank factorised latent representation of the radiance and scattering field that is BAKED per volume (feature grids over position and direction plus a mipmapped transmittance map). Rendering does a dual-pattern feature query (a base position grid plus towards-the-light samples at several levels of detail) and decodes with tiny MLPs: roughly two 64-neuron fully connected layers per MLP, ReLU6 output activation, fully fused (tiny-cuda-nn style, a single kernel). Spatially varying albedo and heterogeneous phase are supported through extra grids.

Results and cost: about 200 FPS at 1024x1024 with three-channel albedo on an RTX 4080 SUPER, 4-5x faster than MRPNN (about 1.6x from sampling, over 20x from the smaller network) with comparable RMSE (1.65e-02 vs 1.64e-02 on cloud0). Baking/training takes up to about four hours per scene on an RTX 4090. Limitations they state: density field is fixed at bake time, and per-scene training cost is high.

## Use for us
The fastest published design for a FIXED hero cloud (per-asset baked grids plus a tiny decoder fits a WGSL compute pass), and the SH-diagonal scaling view is a clean way to think about multiple scattering. Not usable for dynamic or user-edited density without rebaking; HaloRT is the general option.
