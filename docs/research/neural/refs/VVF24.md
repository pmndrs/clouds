# VVF24 — Denoising Monte Carlo renders with diffusion models

- **Authors / year / venue:** Vavilala, Vasanth, Forsyth. 2024. arXiv:2404.00491 (v3 dated 21 Jul 2026 in the copy I saved); SIGGRAPH 2024 poster entry in the brief. A shorter version appeared at a NeurIPS 2024 workshop on generative AI and creativity.
- **Paper:** https://arxiv.org/pdf/2404.00491 (local: `artifacts/research/papers/neural/VVF24-vavilala-2024.pdf`)
- **Project page:** none found.
- **Official code:** none confirmed. SOTAVerified lists "Code Available" for the paper but gives no link. The arXiv "Code, Data and Media" section did not come back in search.
- **Third-party code:** none found.
- **Data / weights:** builds on DeepFloyd IF stage II (open source) and OIDN, which the paper cites. No weights of their own found.
- **Cited by HaloRT as:** reference-list entry; the in-text context was not checked.

## Summary
The denoiser is a pixel-space diffusion model. It is ControlNet-style and built on DeepFloyd IF stage II rather than a latent diffusion model, and it is conditioned on render buffers. The authors argue that the image prior of a diffusion model favours reconstructions that look like real images, with straight shadow edges, curved speculars and no fireflies, and that this helps out-of-distribution scenes. Quantitative results are competitive with the state of the art across sampling rates, and Figure 1 shows the 4 spp case against Isik, AFGSA and OIDN. The authors note that diffusion costs more than single-pass denoisers but is still far cheaper than rendering the scene to high quality.

## Use for us
Mainly a quality reference: it shows what a strong image prior can recover at 4 spp, which is useful as a target. It is far too heavy for a real-time WebGPU frame, so any use would be offline or as a distillation teacher.
