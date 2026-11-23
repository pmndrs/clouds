# IMF21 — Interactive Monte Carlo Denoising using Affinity of Neural Features

- **Authors / year / venue:** Işık, Mullia, Fisher, Eisenmann, Gharbi. 2021. ACM Trans. Graph. 40(4), art. 37. DOI 10.1145/3450626.3459793.
- **Paper:** no open PDF found. Only publisher and metadata pages surfaced in search. A copy hosted on a university faculty site (faculty.digipen.edu) appeared in search, but I did not download it because it is not an author, lab or publisher open-access copy. Local: no PDF.
- **Project page:** none found.
- **Official code:** none found (the GitHub hit was an unrelated self-supervised denoising repo).
- **Third-party code:** none found.
- **Data / weights:** none found.
- **Cited by HaloRT as:** reference-list entry; the in-text context was not checked.

## Summary
The denoiser is built for interactive rates at 1080p with very few samples (about 2 to 8 spp). A lightweight network extracts a feature vector for each pixel from the noisy path-traced samples. A pairwise affinity between these learned features weights the neighbouring pixels, and the weights assemble dilated spatial kernels that filter the noisy radiance. For temporal stability, the method keeps a running average of the noisy radiance and of intermediate features, using a per-pixel recursive filter with learned weights. It also adds a small temporal kernel driven by the feature affinity between consecutive frames. The search snippets report that it matches or beats offline state-of-the-art denoisers in the 2 to 8 spp regime. I did not read the full text, so these details come from the abstract-level summaries.

## Use for us
The feature-affinity kernel is a good fit for a WebGPU compute pipeline, and the running-average temporal path is cheap to implement. Read the full paper before adopting it, because the snippets I saw do not give the layer sizes or the timing breakdown.
