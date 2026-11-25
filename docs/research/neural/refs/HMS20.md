# HMS20 — Neural Temporal Adaptive Sampling and Denoising

- **Authors / year / venue:** Hasselgren, Munkberg, Salvi, Patney, Lefohn. 2020. Computer Graphics Forum 39(2), pp. 147-155 (Eurographics 2020). DOI 10.1111/cgf.13919.
- **Paper:** https://research.nvidia.com/sites/default/files/pubs/2020-05_Neural-Temporal-Adaptive/NTASAD_preprint.pdf (NVIDIA preprint; local: `artifacts/research/papers/neural/HMS20-hasselgren-2020.pdf`). Published version: https://diglib7.eg.org/bitstream/handle/10.1111/cgf13919/v39i2pp147-155.pdf (not downloaded).
- **Supplemental:** https://research.nvidia.com/sites/default/files/publications/supplemental.pdf (not downloaded)
- **Project page:** https://research.nvidia.com/publication/2020-05_Neural-Temporal-Adaptive
- **Official code:** none found.
- **Third-party code:** none found.
- **Data / weights:** none found.
- **Cited by HaloRT as:** reference-list entry; the in-text context was not checked.

## Summary
The method targets sparse path-traced animation at interactive rates. It jointly trains two neural networks end to end over consecutive frames: a sample predictor that decides where to spend the sample budget, and a denoiser. Optimising the sampler over time lets it learn strategies such as sampling disoccluded regions more heavily and tracking specular highlights. Temporal feedback in the denoiser raises the effective sample count and improves stability. The method drops the uniform first sampling pass that most adaptive samplers use. The abstract reports near real-time rates with better image quality and temporal stability than earlier methods. The Figure 1 sample map and 4 spp results illustrate the effect.

## Use for us
Co-training a sample-placement network with the denoiser is a direct route to better detail per sample, which suits a budget-limited WebGPU renderer. The temporal feedback path is the piece to borrow, since it attacks flicker. The paper is a two-network design, so start with the denoiser alone if we need a first step.
