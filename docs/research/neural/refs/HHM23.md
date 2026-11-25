# HHM23 — Joint Neural Denoising of Surfaces and Volumes

- **Authors / year / venue:** Nikolai Hofmann, Jon Hasselgren, Jacob Munkberg; 2023; PACMCGIT 6(1) (I3D 2023), doi 10.1145/3585497
- **Paper:** https://d1qx31qr3h6wln.cloudfront.net/publications/hofmann_i3d2023.pdf (local: `artifacts/research/papers/neural/HHM23-hofmann-2023.pdf`)
- **Project page:** https://research.nvidia.com/labs/rtr/publication/hofmann2023jointdenoising (also video and `viewer.zip` supplementary image viewer)
- **Official code:** none found (NVIDIA patent US 12,347,076 B2 covers it)
- **Third-party code:** none found
- **Data / weights:** none released (supplementary viewer zip only)
- **Cited by HaloRT as:** surface + volume layers with dedicated denoisers.

## Summary
Problem: scenes mixing surfaces and volumes break G-buffer-guided denoisers (a surface edge seen through semi-transparent smoke). Method: split the noisy signal by primary intersection into a surface layer (diffuse + specular, with albedo/normal guides) and a volume layer (colour plus a transmittance estimate), denoise each with its own small kernel-predicting U-Net (hierarchical kernels like HHCM21/HMS20; volume net gets a 4th kernel level for larger footprint), predict weights for adaptive temporal reuse, then composite with the learned/denoised primary transmittance. Inputs are tone-mapped LDR; kernels are applied to HDR. Surface net input is a 32-scalar vector (history, noisy samples, first and second moments, emission, normals); volume net is 21 scalars (history, noisy volume and transmittance samples, moments, emission, volume motion vectors). Transmittance guide is estimated along the eye ray with ratio tracking (Novak 2014) or a separate query.

Results: beats OIDN (with and without guides) and SVGF variants on mixed scenes at 4 spp; reported PSNR 36.01 / 29.87 / 31.67 / 29.97 on four scenes vs 32.00 / 25.07 / 25.92 / 24.68 for SVGF+hierarchical-KPN (8.5 ms). Runtime in Falcor at 1080p: 12 ms on RTX 4090 (about 20 ms on 3090); a shared-features variant 7 ms with a quality drop. 4 spp input.

## Use for us
Clouds in front of sky or terrain need exactly this layer/transmittance composite; a denoised-transmittance alpha is the key trick. Moments as explicit inputs and a larger-footprint kernel level for volume are cheap, copyable design choices.
