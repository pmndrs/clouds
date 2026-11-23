# ODG26 — Environmental volumetric neural shading of clouds for real-time rendering

- **Authors / year / venue:** Olajos (Lund), Doggett (Lund), Goswami (Blekinge); Proc. ACM Comput. Graph. Interact. Tech. 9(4), Art. 59, 17 pp., 29 June 2026 (presented at High-Performance Graphics, July 2026); doi 10.1145/3820020. Marked open access on the Lund portal.
- **Paper:** https://dl.acm.org/doi/10.1145/3820020 (direct PDF download returned 403 to curl, so no local copy of the paper; also linked from https://fileadmin.cs.lth.se/graphics/research/papers/2026/environmental_volumetric_neural_shading_of_clouds_for_real_time_rendering/ ). Local: only the HPG 2026 slides, `artifacts/research/papers/neural/ODG26-olajos-2026-slides.pdf`. Slides are from https://www.highperformancegraphics.org/2026/_assets/slides/environmental_volumetric_neural_shading_of_clouds_for_real-time_rendering.pdf. Supplementary video linked from the ACM page.
- **Project page:** the Lund graphics page above (abstract, teaser, downloads)
- **Official code:** https://github.com/LUGGPublic/evns-clouds-rtr — GitHub reports Python, no licence file declared, CMake project (`Clouds.bin` executable), tested on Windows (Visual Studio) and Linux, submodules. Not inspected in depth.
- **Third-party code:** none found
- **Data / weights:** the Lund page lists `evns_clouds_rtr_resources.zip` and `wdas_mesh.zip` (Disney/WDAS cloud mesh) for download; sizes and contents not checked.
- **Cited by HaloRT as:** RNA-style relightable clouds under environment light in a rasterisation pipeline.

## Summary
(Abstract and slides read; the full paper text was not obtained.) Problem: relight high-fidelity volumetric clouds in real time without ray marching. Method: adapt RNA to clouds. The cloud density is converted to a MESH (front and back surfaces rasterised as position passes), each pixel gets a per-pixel thickness value (view-dependent opacity), the single directional light is replaced by a Nishita sky model so the network learns atmospheric scattering, and a visibility hint from shadow mapping is fed in. A triplane feature grid is sampled at the front-face position and decoded by a small MLP; the result is composited over the sky. Training data: path-traced images at 1024x1024, 1000 frames with varying camera and sun direction; L2 loss, Adam, 250 epochs, batch 1024^2 pixels, about 20 minutes on an A100.

Results and cost: reconstruction improves from 18.13 dB to 22.32 dB PSNR (FLIP 0.059) with the adaptations, at 3.7 ms per frame for the high-poly mesh (0.41 ms low-poly). Slide ablation: MLP 4x16 gives 20.9 dB, 4x64 22.3 dB, 4x128 22.7 dB at 5.2 ms, 4x512 22.9 dB at 190 ms. Per-asset, fixed density, sky-lit only.

## Use for us
Closest existing precedent to a rasterised neural cloud: mesh shell plus triplane plus 4x64 MLP is cheap enough for WebGPU and trains in minutes. Weakness for our goal: the mesh loses the soft volumetric silhouette, so thickness and opacity are doing a lot of work.
