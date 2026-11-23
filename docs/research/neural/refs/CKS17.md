# CKS17 — Interactive Reconstruction of Monte Carlo Image Sequences using a Recurrent Denoising Autoencoder

- **Authors / year / venue:** Chaitanya, Kaplanyan, Schied, Salvi, Lefohn, Nowrouzezahai, Aila. 2017. ACM Trans. Graph. 36(4), art. 98. DOI 10.1145/3072959.3073601.
- **Paper:** https://research.nvidia.com/sites/default/files/publications/dnn_denoise_author.pdf (author version; local: `artifacts/research/papers/neural/CKS17-chaitanya-2017.pdf`). Supplemental: https://research.nvidia.com/sites/default/files/publications/dnn_supp_author.pdf (not downloaded).
- **Project page:** https://research.nvidia.com/publication/2017-07_interactive-reconstruction-monte-carlo-image-sequences-using-recurrent
- **Official code:** none found.
- **Third-party code:** https://github.com/AakashKT/pytorch-recurrent-ae-siggraph17, Python, no licence file, last pushed 2019-03. It describes itself as an unofficial PyTorch implementation.
- **Data / weights:** none found.
- **Cited by HaloRT as:** reference-list entry; the in-text context was not checked.

## Summary
The method reconstructs global illumination from 1 spp path-traced sequences at interactive rates. It uses an encoder-decoder denoising autoencoder with a much larger pixel neighbourhood than earlier CNN denoisers, and it runs about an order of magnitude faster than the comparison methods. Its main addition is recurrent connections inside the network, which carry state from frame to frame and sharply improve temporal stability. The network takes the albedo-demodulated 1 spp colour as input, along with auxiliary per-pixel buffers such as depth and normals, and learns the relationships between these channels by itself. The paper reports much higher quality than edge-avoiding wavelets and SURE-based filters at comparable cost. Figure 1 gives 54.9 ms per frame for the recurrent autoencoder.

## Use for us
This is the closest prior art for a per-frame, real-time learned denoiser that runs on sparse path-traced input. The recurrent state is the part to copy for temporal stability, and the auxiliary-buffer input matches our renderer's natural outputs. The unofficial PyTorch code is a starting point for a reference, but it has no licence and has not been updated since 2019.
