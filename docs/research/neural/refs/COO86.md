# COO86 — Stochastic sampling in computer graphics

- **Authors / year / venue:** Robert L. Cook, ACM Transactions on Graphics 5(1), pp. 51–72, 1986. DOI 10.1145/7529.8927
- **Paper:** not found (no verified open PDF). Author archive page exists at https://graphics.pixar.com/library/StochasticSampling but I could not extract a PDF link from it. Typeset.io copy returned 403, not used.
- **Project page:** https://graphics.pixar.com/library/StochasticSampling (author archive, Pixar)
- **Official code:** none found
- **Third-party code:** none found
- **Data / weights:** none
- **Cited by HaloRT as:** stochastic/Monte Carlo sampling background

## Summary
Introduces stochastic (jittered) sampling for ray tracing: replacing regular sampling patterns with randomised ones turns aliasing into noise, which the eye tolerates better. The same sampling idea is extended to motion blur, depth of field, soft shadows and glossy reflection by distributing rays over time, lens and light area. Foundational for the noisy one-sample-per-pixel input that denoisers work on.

## Use for us
Explains why a 1 spp path-traced reference is noise rather than aliasing, which is the input our denoise/reconstruction pass has to clean up.
