# KAJ86 — The rendering equation

- **Authors / year / venue:** James T. Kajiya, SIGGRAPH 1986 (Computer Graphics 20(4), pp. 143–150). DOI 10.1145/15922.15902
- **Paper:** open-ish copy from Princeton COS 526 course site, saved as `/Users/dex/Developer/WebGPUClouds/artifacts/research/papers/neural/KAJ86-kajiya-1986.pdf` (course mirror, ACM copyright; not an ACM open-access release)
- **Project page:** none
- **Official code:** none found
- **Third-party code:** none found
- **Data / weights:** none
- **Cited by HaloRT as:** rendering equation (light transport background)

## Summary
Defines the rendering equation: outgoing radiance at a surface point equals emitted radiance plus the integral of incoming radiance over the hemisphere, weighted by the BRDF and cosine. It unifies earlier global-illumination methods under one integral operator and motivates Monte Carlo estimation of that integral. Paper is short and conceptual; no cost or results to speak of.

## Use for us
The operator that every neural inference in HaloRT approximates; keep it as the definition of the reference radiance our renderer must match.
