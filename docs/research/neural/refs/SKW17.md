# SKW17 — Spatiotemporal Variance-Guided Filtering: Real-Time Reconstruction for Path-Traced Global Illumination (SVGF)

- **Authors / year / venue:** Schied, Kaplanyan, Wyman, Patney, Chaitanya, Burgess, Liu, Dachsbacher, Lefohn, Salvi. 2017. HPG 2017.
- **Paper:** https://cg.ivd.kit.edu/publications/2017/svgf/svgf_preprint.pdf (author preprint; local: `artifacts/research/papers/neural/SKW17-schied-2017.pdf`)
- **Project page:** https://research.nvidia.com/publication/2017-07_spatiotemporal-variance-guided-filtering-real-time-reconstruction-path-traced
- **Official code:** NVIDIAGameWorks/Falcor, C++, licence file not auto-detected (GitHub reports NOASSERTION), active (pushed 2026-09). I did not verify that its SVGF pass is in that repo, and the search did not confirm the path.
- **Third-party code:** https://github.com/TheVaffel/spatiotemporal-variance-guided-filtering, C++ (OpenCL), no licence, last pushed 2020-06. Static scenes only. https://github.com/HummaWhite/Project4-CUDA-Denoiser, C++/CUDA student project, no licence, last pushed 2023-10.
- **Data / weights:** no learned weights (a hand-designed filter).
- **Cited by HaloRT as:** reference-list entry; the in-text context was not checked.

## Summary
SVGF is a non-learned real-time reconstruction filter for one-path-per-pixel global illumination. It uses temporal accumulation to raise the effective sample count, and it estimates spatiotemporal luminance variance to guide a hierarchical, image-space wavelet filter (an à-trous style scheme). The variance estimate is taken from past frames when enough history is valid, and falls back to a spatial estimate on disocclusions. The filter is therefore strong at edges and at detail that the variance reveals. The paper reports a temporally stable 1920x1080 result in about 10 ms on the hardware of the time. It also reports about 10x better temporal stability than earlier interactive filters, and SSIM 5 to 47 percent better than the reference comparisons. The paper's Figure 1 shows direct and indirect lighting filtered separately.

## Use for us
SVGF is the hand-designed baseline a learned WebGPU denoiser should beat, and it gives a cheap temporal and variance-guided structure to borrow. Falcor is the natural source to inspect for a reference implementation, though the exact path needs checking before we rely on it.
