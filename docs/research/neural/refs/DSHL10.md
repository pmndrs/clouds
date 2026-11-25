# DSHL10 — Edge-avoiding à-trous wavelet transform for fast global illumination filtering

- **Authors / year / venue:** Holger Dammertz, Daniel Sewtz, Johannes Hanika, Hendrik P. A. Lensch, High-Performance Graphics 2010
- **Paper:** `/Users/dex/Developer/WebGPUClouds/artifacts/research/papers/neural/DSHL10-dammertz-2010.pdf` (author's page https://jo.dreggn.org/home/2010_atrous.pdf, open)
- **Project page:** none
- **Official code:** none found
- **Third-party code:** none found (not verified)
- **Data / weights:** none
- **Cited by HaloRT as:** edge-aware filtering for denoising

## Summary
Applies an à-trous (dilated) wavelet filter to noisy global-illumination images. Each iteration uses a small fixed kernel with growing spacing, so a few passes cover a large support cheaply. Edge-stopping weights come from auxiliary buffers (normal, depth, albedo) so the filter does not blur across geometric or material edges. Designed for interactive GI, so it fits a multi-pass GPU pipeline.

## Use for us
A fixed number of compute passes with edge stopping on depth and normal is a natural fit for a WebGPU denoiser on cloud shading; the main candidate to build first.
