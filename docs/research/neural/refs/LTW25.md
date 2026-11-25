# LTW25 — Light transport-aware diffusion posterior sampling for single-view reconstruction of 3D volumes (Cloudy)

- **Authors / year / venue:** Ludwic (Ludwig) Leonard, Nils Thürey, Rüdiger Westermann (TUM); CVPR 2025, pp. 16163-16174; arXiv 2501.05226
- **Paper:** https://arxiv.org/abs/2501.05226 (local: `artifacts/research/papers/neural/LTW25-leonard-2025.pdf`)
- **Project page:** https://cvpr.thecvf.com/virtual/2025/poster/34182
- **Official code:** https://github.com/rendervous/cloudy_project — Python, MIT, 23 stars, package `cloudy` (`src/cloudy/_modeling.py`, `_rendering.py`) plus 8 tutorial notebooks (generation, super-resolution, inpainting, single-view and sparse-view reconstruction, latent manipulation). Differentiable renderer is Vulkan/rendervous (needs a Vulkan GPU). Pretrained diffusion weights not verified.
- **Third-party code:** none found
- **Data / weights:** Cloudy dataset on Hugging Face: https://huggingface.co/datasets/rendervous-project/cloudy (`cloudy.7z`, 29.6 GB, MIT; the repo README says 1400 clouds, the paper says 1000) and the compacted https://huggingface.co/datasets/rendervous-project/compact_clouds (`clouds_500.h5`, 13.69 GB, MIT, 500 clouds, per-cloud layout (D,H,W,1)).
- **Cited by HaloRT as:** source of the "Cloudy" dataset; HaloRT trains on 500 of its clouds (22,000 instances at 4096 spp, with 1000 Stable-Diffusion-synthesised HDR environment maps).

## Summary
Problem: reconstruct a 3D density field (clouds) from a single image when multiple scattering is present. Method: an unconditional diffusion model trained on latent codes of a diffusion-friendly "monoplanar" volume representation (triplane-like, latent about 2 MB per cloud), used inside a tailored diffusion-posterior-sampling loop whose likelihood gradient comes from a physically based differentiable volume renderer (differentiable ratio tracking). Also does multi-view reconstruction and volume super-resolution.

Dataset: Cloudy has about 1,000 synthetic clouds (paper) simulated with the commercial JangaFX fluid simulator, with Perlin noise and varied emitter shapes for diversity, on grids of roughly 512x256x512, and shipped with renders under varying lighting. This is the only open, sizeable collection of simulated cumulus-style density volumes we found, and MIT licensed.

## Use for us
Free training/test volumes (compact_clouds, 13.7 GB) for any network we train, and a ready generative prior if we want random clouds. Check the simulation look (billowy fluid sim, not Nubis-style layered cumulus) before relying on it for hero shots.
