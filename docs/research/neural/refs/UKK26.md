# UKK26 — Lightweight attention-based indirect illumination

- **Authors / year / venue:** Uss, Kim, Kaliński, Anand, Kuznetsov, Harihara (AMD); 2026; SIGGRAPH Posters '26, doi 10.1145/3799825.3818739 (3-page poster)
- **Paper:** https://gpuopen.com/download/lightweight_attention-based_indirect_illumination.pdf (open, CC-BY 4.0; local: `artifacts/research/papers/neural/UKK26-uss-2026.pdf`). Blog summary: https://gpuopen.com/learn/lightweight-attention-based-indirect-illumination/
- **Project page:** the GPUOpen page above
- **Official code:** none found
- **Third-party code:** none found. (Careful: arXiv 2508.08826 is a different paper, Gai et al. "Geometry-Aware Global Feature Aggregation for Real-Time Indirect Illumination"; do not confuse.)
- **Data / weights:** none released. Training data: 11 Blender scenes, 14,320 frames.
- **Cited by HaloRT as:** lightweight attention model on G-buffers plus extra light-view inputs.

## Summary
Problem: screen-space neural GI (Deep Shading, BCNN, Gai et al.) is fast but blind to off-screen light; scene-wide methods (Xu et al., RenderFormer) need non-pipeline data gathering. They bridge this by feeding screen-space G-buffers plus reflective-shadow-map (RSM) data rendered from each light's view (equirectangular, 128x128, G-buffers + reflected flux; each texel is an indirect virtual point light), and spend the budget on inputs instead of model size.

Method: predicts only the indirect term, diffuse and specular separately: I_gi = I_di + I_diff_hat * A_diff + I_spec. Inputs: main camera direct illumination, a noisy 1 spp one-bounce buffer, G-buffers (position, normal, roughness, metallic, albedos, view dir), scene size; RSM cameras at 128x128. Three encoders: iVPL MLP (5 layers), pixel-light UNet (aggregates spatial context from the noisy 1spp buffer), pixel-geometry MLP (4 layers). Core is multi-head attention (8 heads) with pixel-geometry embeddings as queries and the light data as keys/values; two 4-layer MLP decoders. Loss: L1 linear (0.1) + tonemapped L1 (0.2), MS-SSIM (1.0), luminance (0.5), LPIPS (1.0). Ground truth 2k to 16k spp + OptiX denoise; main camera 512x512.

Results: 2.19M params, 432 GFLOPs; 45.56 ms at 512x512 in unoptimised FP32 PyTorch on an AMD Instinct MI250. Generalises to the held-out White Room scene and beats BCNN (PSNR 44.2 vs 42.8 dB on the shown frame); a residual colour shift remains, reduced by adding more training scenes.

## Use for us
Confirms the per-pixel attention (geometry queries, light keys/values) idea and the trick of using a noisy 1 spp guide plus a small UNet for spatial context; a cheap variant could feed a low-spp march result. Cost (45 ms on a datacentre GPU, FP32) shows it is far from our browser budget.
