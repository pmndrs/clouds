# BVM17 — Kernel-Predicting Convolutional Networks for Denoising Monte Carlo Renderings (KPCN)

- **Authors / year / venue:** Bako, Vogels, McWilliams, Meyer, Novák, Harvill, Sen, DeRose, Rousselle. 2017. ACM Trans. Graph. 36(4), art. 97.
- **Paper:** https://la.disneyresearch.com/wp-content/uploads/Kernel-Predicting-Convolutional-Networks-for-Denoising-Monte-Carlo-Renderings-Paper33.pdf (local: `artifacts/research/papers/neural/BVM17-bako-2017.pdf`). Also at https://graphics.pixar.com/library/MLDenoisingB/paper.pdf (that URL returned HTML, not a PDF).
- **Project page:** https://studios.disneyresearch.com/2017/07/20/kernel-predicting-convolutional-networks-for-denoising-monte-carlo-renderings/
- **Official code:** none found.
- **Third-party code:** https://github.com/qbhan/GuidanceMCDenoising, Python, BSD-2-Clause, pushed 2023-12. Search snippet says it has KPCN and AdvMCD baseline training scripts; I did not inspect the contents, and some scripts are marked TODO in the snippet.
- **Data / weights:** Production training data is not public. No weights found.
- **Cited by HaloRT as:** reference-list entry; the in-text context was not checked.

## Summary
The paper trains a CNN on noisy path-traced frames and reference renders from the film Finding Dory, then applies it to other films such as Cars 3. Instead of regressing the pixel colour directly, the network predicts a per-pixel filter kernel. Each output pixel is a weighted sum of its neighbours in the noisy input, with the weights set by the network. The network also takes auxiliary feature buffers from the renderer, which carry geometry and material information. The paper reports better results than earlier state-of-the-art denoisers on production data, and it argues the method generalises across scenes with different style and content.

## Use for us
This is the base recipe for a learned per-pixel kernel filter, and our renderer can supply the same kinds of auxiliary buffers. Keep it as the reference design, because the later Vogels 2018 and Hasselgren 2020 papers build on it.
