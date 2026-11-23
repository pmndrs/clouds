# XXZ25 — Real-time Neural Denoising for Volume Rendering Using Dual-Input Feature Fusion Network

- **Authors / year / venue:** Chunxiao Xu, Xinran Xu, Jiatian Zhang, Yufei Liu, Yiheng Cao, Lingxiao Zhao; 2025; Computer Graphics Forum 44(6), doi 10.1111/cgf.70276
- **Paper:** no open PDF found (EG diglib returned 403 to my fetch; Unpaywall says not OA) (local: not downloaded). Summary below is from search-result abstracts only, NOT the paper.
- **Project page:** https://diglib.eg.org/handle/10.1111/cgf70276
- **Official code:** none found
- **Third-party code:** none found
- **Data / weights:** unknown
- **Cited by HaloRT as:** real-time neural volume denoising with dual-input feature fusion.

## Summary
Not read in full. Per the venue abstract as relayed by search: for volumetric path tracing at real-time spp, the radiance is split into components by noise level (reducing bias of earlier decoupled denoisers), and a lightweight dual-input network maps these toward a noise-free reference; for video, a learned temporal step predicts per-pixel weight maps that blend reprojected previous output with the spatially denoised current frame. Claims faster and higher quality than existing methods. Same group published a related kernel-prediction variant, "Real-Time Volume-Rendering Image Denoising Based on Spatiotemporal Weighted Kernel Prediction", J. Imaging 2025 (open access on PMC12028196, MDPI 11/4/126). Exact features, runtime and hardware not verified.

## Use for us
Only as a pointer to the noise-level split plus learned temporal blend; fetch the PDF through the user's institutional access before relying on it. The open J. Imaging sibling paper may be a readable substitute.
