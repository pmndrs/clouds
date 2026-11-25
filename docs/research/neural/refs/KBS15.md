# KBS15 — A Machine Learning Approach for Filtering Monte Carlo Noise

- **Authors / year / venue:** Kalantari, Bako, Sen. 2015. ACM Trans. Graph. 34(4), art. 122.
- **Paper:** https://people.engr.tamu.edu/nimak/Data/SIGGRAPH15_LBF.pdf (author-hosted, Texas A&M; local: `artifacts/research/papers/neural/KBS15-kalantari-2015.pdf`)
- **Project page:** none found.
- **Official code:** none found.
- **Third-party code:** none found in searches.
- **Data / weights:** training scenes not checked. No weights found.
- **Cited by HaloRT as:** reference-list entry; the in-text context was not checked.

## Summary
This is the first supervised-learning approach to Monte Carlo noise reduction in the paper's framing. It works as a post-process on a noisy rendered image. A multilayer perceptron is trained offline on noisy and reference renders of scenes with several distributed effects, including depth of field, motion blur, area lights, glossy reflections and global illumination. At run time the trained network predicts the filter parameters for a conventional feature-based filter, which is either a cross-bilateral or a non-local means filter, and the filter then produces the output. The inputs are the noisy image and scene features such as world positions and shading normals. The paper reports results in seconds at 4 spp, better than earlier feature-based approaches. Its main limit is that it uses a shallow MLP trained on a small set of scenes, which the later kernel-predicting CNN work set out to fix.

## Use for us
This is a historical baseline. The idea of predicting filter parameters from features, rather than hand-tuning them, carries over to a WebGPU pipeline. Use the later CNN papers (BVM17, VRM18) for the architecture to build on.
