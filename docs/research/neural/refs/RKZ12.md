# RKZ12 — Adaptive rendering with non-local means filtering

- **Authors / year / venue:** Fabrice Rousselle, Claudia Knaus, Matthias Zwicker, ACM TOG 31(6), art. 195, SIGGRAPH Asia 2012. DOI 10.1145/2366145.2366214
- **Paper:** `/Users/dex/Developer/WebGPUClouds/artifacts/research/papers/neural/RKZ12-rousselle-2012.pdf` (UC San Diego CSE274 course mirror; ACM copyright)
- **Project page:** none
- **Official code:** none found
- **Third-party code:** none found
- **Data / weights:** none
- **Cited by HaloRT as:** non-local means denoising background

## Summary
Applies non-local means filtering to Monte Carlo renders: each pixel is averaged with others whose surrounding patches look similar, guided by auxiliary features (albedo, normal). It pairs this with an adaptive sampling step that uses the filter's error estimate to decide where to spend more samples. Quality is strong on static scenes; the patch comparisons are expensive, so it is an offline or high-cost technique.

## Use for us
Quality reference for denoising and adaptive sample allocation; probably too heavy for the realtime browser path, but useful to judge how far the a-trous result is from the best denoiser.
