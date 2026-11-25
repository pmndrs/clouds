# MLSH24 — RNA: Relightable Neural Assets

- **Authors / year / venue:** Mullia, Luan, Sun, Hašan (Adobe Research); ACM TOG 44(1), Art. 2, published Feb 2025 (arXiv Dec 2023, v2 Sep 2024); doi 10.1145/3695866
- **Paper:** https://arxiv.org/abs/2312.09398 (local: `artifacts/research/papers/neural/MLSH24-mullia-2024.pdf`)
- **Project page:** https://krishnamullia.com/rna (also https://research.adobe.com/publication/rna-relightable-neural-assets)
- **Official code:** https://github.com/adobe-research/relightable-neural-assets — Python (uv, Python 3.10), Adobe Research License (non-commercial research and teaching only), 7 stars. Contains data generation configs, training and inference, and a pretrained `lego.ckpt` / `lego_rt.ckpt`. Needs a custom Blender (bpy) wheel from the repo releases that adds per-pixel light directions to Cycles. Linux only.
- **Third-party code:** none found; the cloud adaptation ODG26 has its own repo.
- **Data / weights:** lego checkpoints in the repo; datasets are generated with the provided scripts.
- **Cited by HaloRT as:** feature grid plus small MLP that encodes the shading and scattering of an asset; ODG26 adapts it to clouds.

## Summary
Problem: assets with heavy shading (hair fibres, layered or subsurface materials) are expensive to path trace and hard to reproduce in every downstream renderer. Method: keep explicit geometry (mesh or fibres) and replace all shading and scattering at the first ray hit by a neural function. A triplane feature grid (three planes, 8 channels each, default 512x512, features summed) is sampled at the hit point, concatenated with view direction, light direction and optionally a visibility hint and surface properties, and decoded by a small MLP to RGB reflectance for a distant directional light. Arbitrary lighting is handled by evaluating once per light, so the asset drops into a path tracer without multiple-scattering paths.

Results and cost: close to Monte Carlo ground truth even at extreme close-ups; data is 400 camera views per asset rendered with the custom Cycles build in about 4-6 hours; training is about 90 minutes (100k iterations, 250 epochs) on one A100 40 GB with the dataset resident in GPU memory. The visibility hint noticeably reduces noise around shadow edges. Per-asset training; no generalisation across assets.

## Use for us
The triplane + tiny-MLP + visibility-hint decoder is the template for a per-cloud neural asset; ODG26 shows it works for clouds at a few ms. Licence is non-commercial, so reimplement from the paper rather than reuse the code.
