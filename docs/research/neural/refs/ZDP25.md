# ZDP25 — RenderFormer: Transformer-based neural rendering of triangle meshes with global illumination

- **Authors / year / venue:** Zeng, Dong, Peers, Wu, Tong; 2025; SIGGRAPH 2025 (ACM TOG / Conference Papers), doi 10.1145/3721238.3730595; arXiv 2505.21925
- **Paper:** https://arxiv.org/abs/2505.21925 (local: `artifacts/research/papers/neural/ZDP25-zeng-2025.pdf`, arXiv v1)
- **Project page:** https://microsoft.github.io/renderformer/
- **Official code:** https://github.com/microsoft/renderformer (Python/PyTorch, MIT, about 990 stars, inference and video scripts; pretrained weights on Hugging Face: microsoft/renderformer-v1-base 205M params, microsoft/renderformer-v1.1-swin-large 483M params; example video data on HF). Training, data generation and RenderFormer-V2 (ECCV 2026) at https://github.com/iamNCJ/RenderFormer-Studio (Python, MIT).
- **Third-party code:** https://github.com/BANANASJIM/renderformer-cuda (CUDA/C++20 inference engine, MIT, 78 ms per 512x512 view on RTX 3080 Ti, about 34 ms at 320x320; 8.3x faster than PyTorch); https://github.com/iamNCJ/renderformer-blender-extension (Blender add-on). Follow-ups: RenderFormer-V2 and RenderFormer++ (not read).
- **Data / weights:** weights yes (HF, safetensors only); training scenes are generated (Objaverse objects in 4 template scenes); 8M HDR images for 2M scenes rendered with Blender Cycles at 4096 spp, not checked whether the dataset itself is released.
- **Cited by HaloRT as:** transformer-based neural renderer, no per-scene training.

## Summary
Problem: learn a whole rendering pipeline (not a per-scene model) that maps a triangle mesh scene to an image with full GI, no rasteriser or ray tracer.

Method: sequence-to-sequence with two transformer stages. View-independent stage: each triangle is a token (per-vertex normals with NeRF positional encoding, GGX reflectance parameters and emission, 768-D; triangle position/shape enters only through a relative spatial positional embedding) plus 16 register tokens; 12 transformer layers, 6 heads, RMSNorm, SwiGLU, relative spatial positional embedding (invariant to translation), models triangle-to-triangle transport. View-dependent stage: ray-bundle tokens for 8x8 pixel patches cross-attend to the triangle tokens (6 layers), then a dense ViT decodes the patch to log-encoded HDR pixels. Trained end to end (AdamW, batch 128, 8x A100 40 GB): 500k iters at 256x256 and up to 1,536 triangles (about 5 days) then 100k at 512x512 up to 4,096 triangles (about 3 days). Model about 205M params.

Results: handles diffuse and glossy interreflection, soft and hard shadows, up to 8 lights, without scene retraining; unoptimised PyTorch takes about 0.06 to 0.1 s per 512x512 image on an A100 (Table 2; view-independent 0.02 s + view-dependent 0.04 to 0.05 s), faster than Cycles at 4096 spp. Limits: at most 4,096 triangles (O(N^2) attention), white lights outside the scene, camera outside bounding box, no textures.

## Use for us
Proves generalising neural GI works but at triangle-count scale; for clouds a point or voxel-token variant would be needed (see XTW26). The rendering-from-tokens idea is too heavy for browser real time.
