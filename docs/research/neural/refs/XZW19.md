# XZW19 — Adversarial Monte Carlo Denoising with Conditioned Auxiliary Feature Modulation

- **Authors / year / venue:** Xu, Zhang, Wang, Xu, Yang, Li, Tang. 2019. ACM Trans. Graph. 38(6), art. 224. DOI 10.1145/3355089.3356547.
- **Paper:** https://cg.cs.tsinghua.edu.cn/papers/SIG-2019-denoising.pdf (author-hosted; local: `artifacts/research/papers/neural/XZW19-xu-2019.pdf`)
- **Project page:** none found.
- **Official code:** none found.
- **Third-party code:** https://github.com/qbhan/GuidanceMCDenoising, Python, BSD-2-Clause. Search snippet says it contains an AdvMCD baseline; not inspected.
- **Data / weights:** none found.
- **Cited by HaloRT as:** reference-list entry; the in-text context was not checked.

## Summary
The paper proposes a GAN-based denoiser for Monte Carlo path tracing. The authors argue that adversarial training pushes the network to recover high-frequency detail and global illumination, which handcrafted regression losses tend to blur. The second contribution is a feature modulation module, which conditions the network on auxiliary buffers such as normal, albedo and depth. The modulation works per pixel, in the style of conditional normalisation, with learned scale and shift. Figure 1 compares against NFOR, a recurrent autoencoder, KPCN and the reference at 32 spp, and reports 1-SSIM of 0.0581 for the proposed method against 0.0600 for KPCN. The abstract claims about a second per megapixel image.

## Use for us
The conditioned modulation of auxiliary buffers is a cheap way to inject geometry and material features into a small WebGPU network. A GAN is heavier to train and ship than a regression model, so treat it as a later quality step rather than a first build.
