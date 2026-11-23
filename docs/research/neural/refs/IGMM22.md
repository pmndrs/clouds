# IGMM22 — Real-Time Denoising of Volumetric Path Tracing for Direct Volume Rendering

- **Authors / year / venue:** Jose A. Iglesias-Guitian, Prajita Mane, Bochang Moon; IEEE TVCG 28(7), 2022 pp. 2734-2747, doi 10.1109/TVCG.2020.3037680 (arXiv 2106.08034)
- **Paper:** https://arxiv.org/pdf/2106.08034 (local: `artifacts/research/papers/neural/IGMM22-iglesias-guitian-2022.pdf`)
- **Project page:** https://cglab.gist.ac.kr/publications/2022_Real-Time_Denoising_of_Volumetric_Path_Tracing_for_Direct_Volume_Rendering.html
- **Official code:** none found
- **Third-party code:** none found
- **Data / weights:** none (not a learned method)
- **Cited by HaloRT as:** real-time denoising of volumetric path tracing for DVR.

## Summary
Not neural: a non-learned temporal denoiser. Problem: G-buffers for volumes (normal, depth, albedo) are very noisy at 1-2 spp, so SVGF/RAE-style denoisers relying on clean G-buffers fail. Method: adapt a recursive-least-squares (RLS) temporal linear-regression denoiser (per-pixel linear model over accumulated, temporally reprojected features, followed by a reconstruction filter) into a weighted RLS (wRLS) that handles heterogeneous volumetric noise via a temporally stable accumulated-colour feature, without needing noise-free G-buffers; also handles camera, light and transfer-function edits. Path tracer uses delta/Woodcock tracking with multiple bounces at 2 spp (about 40 ms render per frame).

Results: better PSNR/LPIPS and temporal stability than RAE, SVGF and plain RLS variants on real volume datasets (Manix etc.) at 1-16 spp. Denoiser costs about 12 ms (+/- 2.5) per frame at the tested resolution, a resolution-only cost independent of volume; (GPU model not read from the text I extracted).

## Use for us
A cheap, trainable-free fallback and a comparison point: wRLS temporal regression needs no network and no clean G-buffers, so it could be the temporal stage after a neural cloud inference pass.
