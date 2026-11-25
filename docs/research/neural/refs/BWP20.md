# BWP20 — Spatiotemporal Reservoir Resampling for Real-Time Ray Tracing with Dynamic Direct Lighting (ReSTIR)

- **Authors / year / venue:** Benedikt Bitterli, Chris Wyman, Matt Pharr, Peter Shirley, Aaron Lefohn, Wojciech Jarosz; ACM TOG 39(4) (SIGGRAPH 2020), doi 10.1145/3386569.3392481
- **Paper:** https://developer.download.nvidia.com/devblogs/ReSTIR.pdf (local: `artifacts/research/papers/neural/BWP20-bitterli-2020.pdf`)
- **Project page:** https://research.nvidia.com/labs/rtr/publication/bitterli2020spatiotemporal ; https://cs.dartmouth.edu/wjarosz/publications/bitterli20spatiotemporal.html (Dartmouth was down during my session)
- **Official code:** no code for the paper itself; productised as NVIDIA RTXDI SDK https://github.com/NVIDIA-RTX/RTXDI (HLSL, NVIDIA SDK licence, no weights). Verified exists.
- **Third-party code:** many native ones, e.g. https://github.com/kvark/blade (Rust, WGSL shaders, MIT; ReSTIR direct-lighting experiments), https://github.com/alipbcs/ZetaRay (C++, MIT). No browser WebGPU ReSTIR found.
- **Data / weights:** n/a
- **Cited by HaloRT as:** sample reuse via spatiotemporal reservoir resampling.

## Summary
Problem: direct lighting from millions of emissive triangles in real time. Method: resampled importance sampling (RIS) with weighted reservoir sampling: each pixel streams M candidate light samples into a one-sample reservoir (cost independent of M in memory), keeps the winner by weight, evaluates visibility only for that sample, then reuses reservoirs from the previous frame (temporal) and neighbouring pixels (spatial) by combining reservoirs with correct MIS-like weights, which multiplies effective candidate count. An unbiased estimator is derived; a cheaper biased variant (35-65x faster at equal error vs 6-60x for unbiased) is offered. No neural net; no auxiliary features beyond G-buffer for the target function and reprojection.

Cost: up to 3.4M dynamic emissive triangles in under 50 ms per frame, at most 8 rays per pixel, 1080p, GeForce RTX 2080 Ti (Titan RTX for the biggest scene).

## Use for us
Template for per-pixel reservoir buffers and temporal/spatial reuse passes in compute; fits a sun/sky-light-sample reuse for cloud shading. Needs only a few buffers (reservoir per pixel) plus motion vectors.
