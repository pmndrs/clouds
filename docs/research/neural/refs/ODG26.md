# ODG26 — Environmental volumetric neural shading of clouds for real-time rendering

- **Authors / year / venue:** Olajos (Lund), Doggett (Lund), Goswami (Blekinge); Proc. ACM Comput. Graph. Interact. Tech. 9(4), Art. 59, 17 pp., 29 June 2026 (presented at High-Performance Graphics, July 2026); doi 10.1145/3820020. Marked open access on the Lund portal.
- **Paper:** https://dl.acm.org/doi/10.1145/3820020 (CC BY 4.0). Local: `artifacts/research/papers/neural/ODG26-olajos-2026.pdf` (full paper, supplied by the owner 2026-11-25; the ACM download had returned 403) and the HPG 2026 slides `ODG26-olajos-2026-slides.pdf`. Supplementary video linked from the ACM page.
- **Project page:** the Lund graphics page above (abstract, teaser, downloads)
- **Official code:** https://github.com/LUGGPublic/evns-clouds-rtr — GitHub reports Python, no licence file declared, CMake project (`Clouds.bin` executable), tested on Windows (Visual Studio) and Linux, submodules. Not inspected in depth.
- **Third-party code:** none found
- **Data / weights:** the Lund page lists `evns_clouds_rtr_resources.zip` and `wdas_mesh.zip` (Disney/WDAS cloud mesh) for download; sizes and contents not checked.
- **Cited by HaloRT as:** RNA-style relightable clouds under environment light in a rasterisation pipeline.

## Summary
(Full paper read 2026-11-25.) Problem: relight a high-fidelity volumetric cloud in real time with no ray march. Method: adapt Relightable Neural Assets (RNA) to clouds. The VDB is converted to a mesh in Blender (5.1 M triangles; a decimated 84 k version also works at run time without retraining). Per pixel, the network gets: a triplane feature at the front-surface position (three planes, 8 features each, 512², summed), the sun direction as two angles, and a thickness value (front-face minus back-face position along the view ray, smoothstepped). It has no view direction and no normal. A 4x64 ReLU MLP outputs two colours, one for directly lit and one for shadowed points, plus an alpha. A PCF shadow map blends between the two colours. Run time is four raster passes (back-face positions, front depth, shadow map, shading) with the MLP in the fragment shader through Vulkan's cooperative-vector extension, fp16 weights.

Training: Blender Cycles Principled Volume lit by a Nishita sky, 1000 frames at 1024², random camera on a sphere and sun elevation -5 to 90 degrees; log(x+1) L2 loss, Adam, 250 epochs, about 20 minutes on an A100. The sky model is baked into the weights: another sky needs retraining.

Results (RTX 4080): 4x64 gives 22.3 dB PSNR, FLIP 0.059, at 3.7 ms per frame on the high-poly mesh and 0.41 ms on the low-poly one. Without thickness 18.1 dB. Wider MLPs gain little (4x256: 22.9 dB at 10.2 ms; 4x512: 190 ms). PSNR is measured in PyTorch on held-out frames, so it excludes mesh and raster errors. They render with triplane mip level 4, which lowers PSNR to 20.0 dB but removes visible noise.

Limits they state: evaluated on ONE static cloud (the Disney cloud); cost is dominated by triangle count; sharp edges and seams where the two colours blend or the triplane changes abruptly; thickness is geometric, so it assumes uniform density and is wrong when two separate parts line up along the view; ground truth is Blender's Principled Volume, not a validated cloud path tracer.

## Use for us
Per-asset and fixed density, so only for an artist's VDB hero cloud. The interesting parts are small and portable: a triplane feature plus a 4x64 MLP is trivial in WGSL, and the split into a lit colour and a shadowed colour blended by a cheap visibility term is a neat way to keep shadow edges out of the network. Against our raymarcher it is not an obvious win: our march of the same Disney cloud measured 1.0 ms at 512² on the M5 Pro (N3b), in the same range as their 0.41-3.7 ms on an RTX 4080, and theirs loses the soft volumetric silhouette, has no multiple clouds, and reaches only 22 dB. Its value to us is as evidence that a network this small can carry a cloud's lighting once position features are baked, which is the same lesson as MRBNN (`LYG26`).
