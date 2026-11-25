# XTW26 — A generalizable light transport 3D embedding for global illumination

- **Authors / year / venue:** Xu, Varma T, Wang, Li, Wu, Wronski, Ramamoorthi, Salvi (UCSD, NVIDIA); SIGGRAPH 2026 (arXiv 2510.18189, v2 June 2026), doi 10.1145/3799902.3811095
- **Paper:** https://arxiv.org/abs/2510.18189 (local: `artifacts/research/papers/neural/XTW26-xu-2026.pdf`, arXiv v2, 14 pages; CC-BY 4.0). Also https://bingxu.tech/papers/light_transformer_sig_2026.pdf
- **Project page:** https://bingxu.tech/projects/2026_lighttransformer/page.html
- **Official code:** https://github.com/bing-xu-graphics/light_transformer (Python/PyTorch 2.5 + CUDA 12.4, Linux/NVIDIA; no LICENSE file found, so rights unclear; includes train.py, infer.py, paper config, pretrained checkpoint `light_transformer_step350000.ckpt` via Git LFS, six example scenes, Blender/PBRT scene-prep notes, a vendored pointnet2 CUDA FPS op)
- **Third-party code:** none found
- **Data / weights:** weights yes; full training set (13,900 procedural indoor scenes, about 250 CPU/GPU days to generate) not released as far as seen, only a compact test set and the generation workflow
- **Cited by HaloRT as:** generalisable learned light transport from 3D scene data (no G-buffer).

## Summary
Problem: prior GI nets are per-scene, screen-space (view inconsistent) or 3D methods (RenderFormer) limited to small meshes. They predict GI directly from 3D scene configuration, with no rasterised or path-traced illumination cues, and scale to millions of triangles.

Method: scene sampled into about M = 20k Scene points (position, normal, colour/material, emission). A Light Transport Encoder (PointTransformerV3, serialised patches of 1024, linear-complexity attention) turns them into latent codes anchored at the points, after two rounds of farthest-point sampling plus k=32 nearest-neighbour aggregation (so each token sees about 1024 raw points). Rendering: Query points (ray hits, or about 2M sampled surface points in training, giving view- and resolution-independence) gather kappa nearest latents and a Local Query Decoder (cross-attention, query attributes as Q, neighbour latents plus relative geometry as K/V) outputs irradiance (diffuse); a decoder swap plus brief fine-tuning handles glossy. About 42M parameters. Trained on 12k of 13,900 procedural indoor scenes (Infinigen Indoors rules, path traced depth 5) on 4x A10 for about 7 days.

Results: better than RenderFormer and a point-cloud baseline on held-out complex indoor scenes (millions of triangles), unlike RenderFormer which runs out of memory (Fig. 2). Cost: encoder 208 ms, total 368 ms for a 512x512 image on an RTX 5880 Ada (not real time; authors point to fused attention kernels and distillation).

## Use for us
The "latent codes anchored at points, queried by kNN + cross-attention" pattern is the closest analogue to a volumetric embedding of a cloud (anchor latents in a density grid). Latency is too high for browsers today, but the encode-once, query-many split (encoder is view independent, can be cached per cloud) is exactly how we would amortise.
