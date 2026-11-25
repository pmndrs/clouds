# LWY21 — Fast Volume Rendering with Spatiotemporal Reservoir Resampling (Volumetric ReSTIR)

- **Authors / year / venue:** Daqi Lin, Chris Wyman, Cem Yuksel; ACM TOG 40(6) (SIGGRAPH Asia 2021), art. 278, doi 10.1145/3478513.3480499
- **Paper:** https://graphics.cs.utah.edu/research/projects/volumetric-restir/volumetric_restir.pdf (author version) (local: `artifacts/research/papers/neural/LWY21-lin-2021.pdf`)
- **Project page:** https://dqlin.xyz/pubs/2021-sa-VOR/
- **Official code:** https://github.com/DQLin/VolumetricReSTIRRelease — C++ (Falcor 4.2 render pass "VolumetricReSTIR", GVDB volumes), BSD-3-Clause; example scenes 7.87 GB on Google Drive; needs RTX 2060+, Windows, D3D12. Verified with `gh api`. No weights (not neural).
- **Third-party code:** https://github.com/KaanAres10/Denoising-VolumetricReSTIR (C++, "Other" licence, student study of denoising vs sampling tradeoff). No WGSL/GLSL port found.
- **Data / weights:** scenes only
- **Cited by HaloRT as:** volumetric ReSTIR (sample reuse for volumes).

## Summary
Problem: low-noise real-time volume path tracing with arbitrary dynamic lighting, multiple scattering and volumetric emission. Method: generalise RIS and ReSTIR to path space: per pixel, generate M candidate paths by delta tracking (distance sampling, so transmittance terms cancel in the PDF) plus light-sample connections, keep one in a reservoir, then spatiotemporally reuse reservoirs with MIS; the key observation is that cheap, biased transmittance approximations (e.g. nearest-voxel/trilinear grid lookups, ray-marching) can be used inside resampling decisions without biasing the result, because the final chosen path is evaluated unbiased (ratio/residual-ratio style, majorant grids). Only one fully evaluated path sample per pixel. Compared with an equal-time baseline of decomposition tracking + residual ratio tracking. Works with a denoiser (OptiX AI denoiser used in figures) and preserves small details.

Cost: Falcor on GeForce RTX 3090; bunny cloud 55 ms single scattering, 142 ms for three bounces at the paper's resolution; K (max bounces) 1, 3 or 7. Memory: per-pixel reservoirs storing a path as list of (z_i, omega_i).

## Use for us
Strongest "no-network" alternative to HaloRT-style inference; per-pixel path reservoirs need a G-buffer-like history and fixed memory. Hybrid: use Volumetric ReSTIR to generate a clean low-spp input or training reference. Heavy for WebGPU at multi-bounce.
