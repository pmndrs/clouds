# HSG22 — Real-time deep radiance reconstruction from imperfect caches

- **Authors / year / venue:** Huang, Song, Guo, Tao, Zong, Fu, Li, Guo (Nanjing Univ., Huawei Cloud); 2022; Computer Graphics Forum 41(7) (Pacific Graphics 2022), doi 10.1111/cgf.14675
- **Paper:** https://dcjmj.github.io/uploads/Real_time_Deep_Radiance_Reconstruction_from_Imperfect_Caches.pdf (author-hosted; local: `artifacts/research/papers/neural/HSG22-huang-2022.pdf`). Landing: https://diglib.eg.org/handle/10.1111/cgf14675
- **Project page:** https://dcjmj.github.io/publications/10-1111-cgf-14675 (lead author's homepage, PDF only)
- **Official code:** none found
- **Third-party code:** none found
- **Data / weights:** none found
- **Cited by HaloRT as:** G-buffers plus cached (imperfect) radiance as network input.

## Summary
Problem: baked light/glossy probes need very high sampling and resolution (for glossy probes about 30 h on a cluster). Instead bake cheaply and let a network fix the result.

Method: static scene, per-scene network. A low-quality radiance cache (180-degree panorama, about 64x16 px, 32 spp, offline path tracer) is stored at the barycentre of every triangle. At runtime, for each pixel a ray-differential based query and interpolation of the caches (Direct3D 12) produces an imperfect radiance (IR) map with noise and aliasing. An encoder-decoder network with two encoder branches (IR map, 3 ch; G-buffers, 7 ch: normal, albedo, depth) fuses features at multiple scales through a fusion module (residual blocks, 1x1 + 3x3 conv, squeeze-and-excitation) and skip connections into the decoder reconstructs the final image. Loss: L1 + LPIPS perceptual; the exact parameter count is not given in the sections read.

Results: full GI including glossy interreflections at above 90 FPS at 1920x1080 on an RTX 3090: about 0.7 ms cache query plus about 10.1 ms network (10.7 ms total). Precompute averages 6.5 h per scene; equivalent plain cache interpolation at quality would need 1024x256 caches and about 768 h. Compared with glossy probe reprojection and real-time path tracing and PRT.

## Use for us
Same shape as a "cheap low-sample march or cache as one input, G-buffer-like guides as the other, small encoder-decoder cleans it up" design; 10 ms at 1080p on 3090 is a reference for a small two-branch UNet.
