# NAM17 — Deep Shading: Convolutional Neural Networks for Screen Space Shading

- **Authors / year / venue:** Nalbach, Arabadzhiyska, Mehta, Seidel, Ritschel; 2017; Computer Graphics Forum 36(4) (EGSR 2017), doi 10.1111/cgf.13225
- **Paper:** https://arxiv.org/abs/1603.06078 (local: `artifacts/research/papers/neural/NAM17-nalbach-2017.pdf`, arXiv v2 preprint)
- **Project page:** none found (MPI-INF listing only)
- **Official code:** none found. The paper says "We plan to make our network definitions ... available"; no repo located.
- **Third-party code:** https://github.com/caganselim/DeepShading (Jupyter/PyTorch replication, no licence, last push 2021, 6 stars). Loosely related: https://github.com/bloc97/FSSGI (MIT, Jupyter, screen-space GI with a CNN, includes pretrained model; not a Deep Shading port).
- **Data / weights:** none released
- **Cited by HaloRT as:** the idea HaloRT transfers to volumes: shade from deferred buffers with no radiance input.

## Summary
Problem: screen-space effects (AO, GI, SSS, DOF, motion blur, AA) are each hand-written shaders that turn a deferred-shading buffer (position, normal, reflectance, depth, flow, etc.) into RGB. The paper learns that mapping end to end with a CNN, with no radiance input at all, only per-pixel attributes (3 to 18 channels), and the CNN output is the shaded image (or the indirect term for GI).

Method: a U-shaped fully convolutional net, up to 6 levels from 512x512 down to 16x16. Each step is a conv plus ReLU (same kernel extent everywhere, 3x3 typical); down branch uses 2x2 mean pooling, up branch bilinear upsampling, with skip connections from the same-resolution down step. Channels double on the way down (u0 = 16 typical, so 256 features at the coarsest level) and halve on the way up; grouped convolutions. About 130k learnable parameters (up to ~200k for some effects). Trained in Caffe with ADADELTA and a DSSIM loss (SSIM on 8x8 tiles); 61,000 image/buffer pairs from 10 scenes (4 held-out test scenes), rendered with random textures and lighting; labels are 16-bit HDR with no tone mapping. Mono variants run the same net per colour channel.

Results: SSIM 0.59 to 0.98 on test scenes depending on effect (Table 1). Runtime was an OpenGL re-implementation of the forward pass on array textures (uses hardware up/down-sampling, avoids concat layers by reading two layers), 768x512 on a GTX 980 Ti: about 3.8 ms for the cheapest effect up to about 60 to 97 ms for the heaviest (Table 1). Limits: screen-space only, so no off-screen light or shadow; one net per effect.

## Use for us
Template for a G-buffer-in, radiance-out cloud shader: no cloud radiance fed in, only density-derived buffers. Their hand-written OpenGL forward pass (array textures, no concat) is the precedent for our WebGPU compute port. Small U-Net, 130k params, is a sensible lower bound on cost.
