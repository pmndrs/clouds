# KMM17 — Deep Scattering: Rendering atmospheric clouds with radiance-predicting neural networks (RPNN)

- **Authors / year / venue:** Kallweit, Müller, McWilliams, Gross, Novák (Disney Research, ETH Zürich); ACM TOG 36(6), Art. 231, 2017; doi 10.1145/3130800.3130880
- **Paper:** https://arxiv.org/abs/1709.05418 (local: `artifacts/research/papers/neural/KMM17-kallweit-2017.pdf`). Author copy also at https://jannovak.info/publications/DeepScattering/DeepScattering.pdf
- **Project page:** https://studios.disneyresearch.com/?p=28796 (Disney Research page; paper footnote says a subset of the data was hosted on the Disney publication page, not re-verified)
- **Official code:** none found
- **Third-party code:** none found as a standalone repo. The MRPNN repo (see HYL23) contains an RPNN comparison implementation (`core/NNWeight_RPNN.cuh`, CMake option `RPNN`), CUDA, GPL-3.0: https://github.com/What-a-stupid-username/MRPNN
- **Data / weights:** none public found (paper says a subset of training data was posted at Disney; unverified)
- **Cited by HaloRT as:** origin of radiance-predicting networks for clouds and of Monte Carlo denoisers/predictors for volumes [KMM*17]; HaloRT cites it twice, as a "denoiser" comparison class and as the first learned volumetric transport model.

## Summary
Problem: path tracing clouds needs tens of hours for acceptable error because of thousands of scattering events (high albedo, Lorenz-Mie phase). Method: pre-learn the spatial/directional distribution of in-scattered radiance from tens of cloud exemplars (75 clouds used for training/validation), then at render time sample visible points, extract a hierarchical 3D density descriptor around each shading point and feed it to an MLP that predicts the indirect in-scattered radiance Li(x, w). The first bounce stays Monte Carlo (delta tracking) and the network supplies the rest. Directional (sun) light only; environment lighting is handled by integrating several light directions.

Descriptor and network: a 5x5x9 point stencil, repeated at K=10 progressively larger scales (each level covers a larger region measured in mean free paths, with mip-filtered density), oriented towards the light, plus the angle between view and light. The network feeds one level of the hierarchy per block (two FC layers of 200 nodes, ReLU, with residual connections), then 3 more FC layers: 23 layers, about 1.4M parameters. This "progressive feeding" learned faster and reached lower error than feeding all levels into layer one. Loss: squared error between log(1+prediction) and log(1+target); Adam, batch 1000; two datasets of 15M records each (Lorenz-Mie chopped phase, and Henyey-Greenstein g=0.857).

Results and cost: images at 1280x720 on an NVIDIA Titan X (Pascal) in roughly 6 seconds to 9 minutes depending on the sample count, versus a CPU path-traced reference that took hours, with equal-time error far below path tracing (their table lists error-reduction ratios from about 30x to about 2000x depending on cloud and view; column meanings not re-verified) and a comparison to flux-limited diffusion. Temporally stable, so usable for animation. Not real time, and the whole hierarchy has to be gathered per shading point.

## Use for us
Historical baseline only. The hierarchical-descriptor idea (multiscale density gathers aimed at the light) reappears in MRPNN/MRBNN and in HaloRT's "crossing" features; the log1p loss and progressive feeding are cheap tricks worth copying into any per-sample radiance MLP.
