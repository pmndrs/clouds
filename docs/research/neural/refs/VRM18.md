# VRM18 — Denoising with Kernel Prediction and Asymmetric Loss Functions

- **Authors / year / venue:** Vogels, Rousselle, McWilliams, Röthlin, Harvill, Adler, Meyer, Novák. 2018. ACM Trans. Graph. 37(4), art. 124.
- **Paper:** https://www.jannovak.info/publications/KPAL/KPAL.pdf (author site; local: `artifacts/research/papers/neural/VRM18-vogels-2018.pdf`)
- **Project page:** https://studios.disneyresearch.com/?p=28240 (not opened)
- **Official code:** none found.
- **Third-party code:** none found.
- **Data / weights:** Production sequences are not public. No weights found.
- **Cited by HaloRT as:** reference-list entry; the in-text context was not checked.

## Summary
The paper extends the kernel-predicting architecture of BVM17 into a modular network for temporal, multi-scale denoising of rendered sequences. A source-aware encoder extracts low-level features and embeds them into a common feature space, so a trained network adapts quickly to new data. Spatial and temporal modules then extract higher-level features and predict kernels, with the spatial modules working at several scales to reduce low-frequency artefacts. The whole network is trained with a family of asymmetric loss functions. These preserve detail and give the artist direct control over the variance-bias trade-off at inference. The paper also adds an error-predicting module that estimates the reconstruction error to drive adaptive sampling, and it gives a convergence analysis of kernel prediction. The authors report results that compare favourably with the state of the art on detail preservation, low-frequency noise removal and temporal stability.

## Use for us
The asymmetric loss and the inference-time variance-bias knob are a useful control to expose in our bench, which fits the controls-not-URLs rule. The error-predicting module is a candidate for guiding where to spend samples in a real-time renderer.
