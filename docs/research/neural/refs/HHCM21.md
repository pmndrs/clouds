# HHCM21 — Interactive Path Tracing and Reconstruction of Sparse Volumes

- **Authors / year / venue:** Nikolai Hofmann, Jon Hasselgren, Petrik Clarberg, Jacob Munkberg; 2021; PACMCGIT 4(1) (I3D 2021, best paper presentation). Real DOI printed in the paper: 10.1145/3451256 (the 10.1145/3585497 in the brief is actually HHM23's DOI; the NVIDIA page also mislabels this paper with 3585497).
- **Paper:** https://d1qx31qr3h6wln.cloudfront.net/publications/paper_v3.pdf (author version) (local: `artifacts/research/papers/neural/HHCM21-hofmann-2021.pdf`)
- **Project page:** https://research.nvidia.com/labs/rtr/publication/hofmann2021volumerecon (PDF and video only)
- **Official code:** none found (page lists none; NanoVDB itself is open, the system is not)
- **Third-party code:** none found
- **Data / weights:** none released
- **Cited by HaloRT as:** sparse volumes; source of HaloRT's CNN baseline architecture and training hyper-parameters.

## Summary
Problem: interactive, high-quality rendering of sparse volumetric data (Disney Cloud, 188M voxels) with multiple scattering. Method: GPU unbiased volume path tracer on NanoVDB (null-collision/delta tracking, max 128 bounces, 1 spp = 11.9 ms at 1080p on RTX 3090 for the Disney cloud), then a temporally recurrent neural denoiser adapted from Hasselgren et al. 2020 (HMS20): a small U-Net that does not predict colour but predicts hierarchical filter-kernel weights, applied at full, 1/2 and 1/4 resolution to the noisy HDR input, plus an extra kernel applied to the denoised history buffer. Optional learned adaptive-sampling network (3.1 ms) trained jointly.

Network inputs (per pixel, from primary scatter position): tone-mapped noisy colour RGB; density mean and std (2 ch); depth mean and std plus fraction of rays that scattered (3 ch); object-space position (3 ch); and the tone-mapped denoised previous output (history). Mean/std taken over the spp. Direct/indirect two-kernel split was tried and dropped (minor gain). Training: 1000 clips of 8 frames, 1-32 spp inputs vs 4096 spp references, 40 HDRI probes, randomised density/albedo/anisotropy/emission, 1/4 static clips, 1000 epochs, random 256x256 crops with 90-degree rotations and flips, about 24 h on one V100. Loss: SMAPE (eps 0.01) on linear HDR plus 0.3 x temporal SMAPE on frame differences (1.0 SMAPE + 0.3 tSMAPE). Optimiser not stated in the text I searched. Ablation: guides help only modestly (PSNR 35.37 colour only vs 35.48 with guides); 2x or 4x more weights gives small gains; adversarial loss helps sharpness at no inference cost.

Cost: at 1920x1080 on RTX 3090, 4 spp total 61 ms on the Disney Cloud including denoise; denoiser 7.3 ms constant, adaptive sampler 3.1 ms; reference about 60 s. Adaptive sampling is roughly worth 2x spp.

## Use for us
The concrete baseline recipe (inputs, SMAPE + tSMAPE, 8-frame clips, 256 crops) to match or beat in the HaloRT-style comparison. Cloud-relevant: feature guides are cheap but marginal, so a path-free network should not rely on them. Kernel prediction at 3 scales is a robust output head for a WebGPU post-pass.
