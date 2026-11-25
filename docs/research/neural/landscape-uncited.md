# Neural cloud / participating-media landscape NOT cited by HaloRT

Scouted 2026-11-23. Scope: work other than HaloRT's own reference list (other agents cover that). All links below returned HTTP 200 when fetched, except ACM/DOI links, which return 403 to scripted clients (marked "ACM, not verified by fetch"). Summaries come from abstracts / slides, not full reads, unless noted. Where the search did not find something, that is stated.

PDFs saved (prefix `X-`) in `/Users/dex/Developer/WebGPUClouds/artifacts/research/papers/neural/`:
`X-Olajos2026-EnvVolumetricNeuralShadingClouds-HPG-slides.pdf`, `X-Fang2024-NeuralRealtimeVolume-2401.14051.pdf`, `X-Leonard2025-LightTransportDiffusionPosterior-2501.05226.pdf` (identical bytes to existing `LTW25-leonard-2025.pdf`), `X-Li2026-NeuralSixWayLightmaps-2604.03748.pdf`, `X-Condor2024-DontSplatYourGaussians-2405.15425.pdf`.

---

## A. Directly competing real-time neural cloud / media shading (most relevant)

1. **Environmental Volumetric Neural Shading of Clouds for Real-Time Rendering** (Rikard Olajos, Michael Doggett, Prashant Goswami; Lund Univ. / BTH). HPG 2026; journal record Proc. ACM CGIT, DOI 10.1145/3820020 (ACM, not verified by fetch).
   Slides: https://www.highperformancegraphics.org/2026/_assets/slides/environmental_volumetric_neural_shading_of_clouds_for_real-time_rendering.pdf (saved, X-).
   - Builds on Relightable Neural Assets (Mullia et al., TOG 2025). A per-cloud MLP with triplane feature encoding, run in a *rasterisation* pipeline on cloud meshes (front/back face position passes, thickness, a shadow-map visibility term, Nishita sky model for environment). No ray marching.
   - Training: 1000 frames of 1024x1024 path-traced data, varying camera and sun; 250 epochs, ~20 min on an A100.
   - Slide ablation (frame time, per-cloud): 4x64 MLP 3.7 ms (high-poly mesh) / 0.41 ms (low-poly); 4x256 10.2 / 3.1 ms; 4x512 190 / 77 ms. Hardware not stated in slides. Per-asset network (not generalising across clouds, unlike HaloRT).
   - No code link found.

2. **Real-time Neural Six-way Lightmaps** (Wei Li, Hanxiao Sun, Tao Huang, Haoxiang Wang, Tongtong Wang, Zherong Pan, Kui Wu), arXiv 2604.03748, Apr 2026. https://arxiv.org/abs/2604.03748 (saved, X-).
   - Smoke/media for games: coarse ray march from current camera makes a guiding map; a network predicts the six lightmaps used by classic six-way-lightmap billboards. Camera-, lighting- and collision-responsive. Plugs into existing engine billboard pipelines. Code: none found.

3. **A real-time rendering method for high albedo anisotropic materials with multiple scattering** (Shun Fang, Xing Feng, Ming Cui), arXiv 2401.14051, Jan 2024 (preprint; the "Lumverse" paper). https://arxiv.org/abs/2401.14051 (saved, X-; PDF is only 3 pages).
   - Density/transmittance/phase features, 3D-CNN on transmittance, diffuse and highlight sampling templates, channel attention + backbone. No code. Short and thin; treat as a lead only.

4. **Faster RPNN: Rendering Clouds with Latent Space Light Probes** (Mikhail Panin, Sergey I. Nikolenko), SIGGRAPH Asia 2019 Technical Briefs. Catalogue record: https://katalog.lib.cas.cz/KNAV/EdsRecord/edsair,edsair.doi...........75d881ff27c47b77ccd5f15f98fcae5e (only a library record was found; no open PDF or code located).
   - Precomputes the view-independent parts of Deep Scattering's RPNN into latent-space light probes, leaving only view-dependent parts at render time; claimed 2-3x faster than RPNN. (Abstract-level info only.)

5. **Deep Real-time Volumetric Rendering Using Multi-feature Fusion (MRPNN)** (Hu et al.), SIGGRAPH 2023. Open PDF: https://sites.cs.ucsb.edu/~lingqi/publications/paper_mrpnn.pdf. Already in our papers folder as HYL23 (likely cited by HaloRT; listed for completeness). Uses transmittance fields as auxiliary inputs; 1024x1024 real time.

6. **Volumetric Inverse Rendering via Neural Radiative Transfer** (Nsampi et al., MPI-INF), EGSR / CGF 2026. https://neural-radiative-transfer.mpi-inf.mpg.de/ (PDF at /static/paper/paper_c.pdf). Inverse rendering of clouds/fog optical properties via a neural radiative-transfer representation; not real-time shading but a differentiable forward model that could supply training data/fits.

7. **Machine Learning-Driven Volumetric Cloud Rendering: Procedural Shader Optimization and Dynamic Lighting in Unreal Engine** (2025), arXiv 2502.08107. https://arxiv.org/abs/2502.08107. Engine-oriented; ~35 ms/frame average per the search summary; two-term HG phase. Low rigour, useful only as a "shipping engine" data point; the "ML" part is shader-parameter tuning, not a network in the render loop (not read in full).

## B. Neural volumes / caching / compression (adjacent tech)

8. **NeuralVDB: High-resolution Sparse Volume Representation using Hierarchical Neural Networks** (Doyub Kim, Minjae Lee, Ken Museth; NVIDIA), ACM TOG 43(2), Feb 2024. https://arxiv.org/abs/2208.04448 ; https://research.nvidia.com/labs/prl/publication/neuralvdb
   - Replaces lower VDB tree nodes with topology classifiers + value regressors; 10x to >100x compression over compressed VDB. Disney cloud: ~5 min encode / 3 min decode. Authors state speeding up rendering is a non-goal. A storage format, not a lighting model.

9. **Relightable Neural Assets (RNA)** (Krishna Mullia, Fujun Luan, Xin Sun, Milos Hasan), ACM TOG 44(1), 2025, DOI 10.1145/3695866 (ACM, not verified by fetch). We already hold it as MLSH24. Foundation for Olajos 2026 above.

10. **GSCache: Real-Time Radiance Caching for Volume Path Tracing using 3D Gaussian Splatting** (David Bauer, Qi Wu, Hamid Gadirov, Kwan-Liu Ma), arXiv 2507.19718, Jul 2025. https://arxiv.org/abs/2507.19718. Radiance cache for volumetric path tracing built on Gaussians; NVIDIA-affiliated co-author. A path-tracer accelerator, not a rasteriser/shader.

11. **Real-time Rendering with a Neural Irradiance Volume** (Coomans, Nazzaro, Dominici, Doring, Verhoeven, Vardis, Steinberger), Eurographics 2026, arXiv 2602.12949. https://arxiv.org/abs/2602.12949. Surface diffuse GI, ~1 ms at Full HD from a G-buffer only; 1-5 MB per scene. Not for volumes, but a template for "small net + G-buffer inputs" cost numbers.

12. **Joint neural denoising of surfaces and volumes** (NVIDIA; found as a patent document, https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12347076) and **Denoising Production Volumetric Rendering** (Pixar / Disney Research, SIGGRAPH 2023 talk, https://graphics.pixar.com/library/VolumeDenoising/paper.pdf). Temporal kernel-predicting denoisers for volumes; notes that volumetric motion vectors are ill-defined. Relevant to a temporal stage after the net.

13. Searched specifically for NVIDIA "neural transmittance / learned deep shadow maps for clouds": **nothing found**. NVIDIA research page for participating media only lists ray-marching transmittance estimators and the joint denoiser: https://research.nvidia.com/labs/rtr/tag/participating-media

## C. Gaussian / splat / NeRF-style relightable media

14. **Don't Splat your Gaussians: Volumetric Ray-Traced Primitives for Modeling and Rendering Scattering and Emissive Media** (Jorge Condor, Sebastien Speierer, Lukas Bode, Aljaz Bozic, Simon Green, Piotr Didyk, Adrian Jarabo), arXiv 2405.15425, 2024 (ACM TOG 2025). https://arxiv.org/abs/2405.15425 (saved, X-).
   - Represents the Disney cloud with ~5.6k Gaussian kernels instead of 1024^3 voxels; ray-traced, supports secondary rays, multiple scattering and relighting. Not real-time on a web stack.

15. **VolS-GS: Relightable Gaussian Splatting with Volumetric Subsurface Scattering** (Junyeong Ahn, Jaegul Choo), arXiv 2610.04007, Oct 2026. https://arxiv.org/abs/2610.04007. Diffusion approximation over Gaussian cells for multiple scattering; surface/SSS focus, not clouds.

16. **Gabor Fields: Orientation-Selective Level-of-Detail for Volume Rendering** (Condor, Hermann, Yurtsever, Didyk), arXiv 2602.05081, Feb 2026. https://arxiv.org/abs/2602.05081. Alternative to Gaussian kernels for scalable multi-scatter path tracing of volumes (LOD).

17. **Unified Gaussian Primitives for Scene Representation and Rendering** (Yang Zhou, Songyin Wu, Lingqi Yan), arXiv 2406.09733, 2024. https://arxiv.org/abs/2406.09733.

18. **Neural Relightable Participating Media Rendering** (NeurIPS 2021; SH for multiple scattering, ray-traced single scattering): https://papers.neurips.cc/paper_files/paper/2021/file/80f24ef493982c552b6943f1411f7e2c-Paper.pdf (older; listed for lineage).

## D. Non-neural multiple-scattering approximations (the competition)

19. **Art-Directable Multiple Volumetric Scattering ("Oz")** (Magnus Wrenninge, SIGGRAPH 2015 talk). Slides: https://fpsunflower.github.io/ckulla/data/oz_volumes.pdf. N "octaves" with attenuation a, contribution b, eccentricity c per octave. Hillaire 2020 states the cloud multi-scatter path is [Wrenninge]: https://blog.selfshadow.com/publications/s2020-shading-course/hillaire/s2020_pbs_hillaire_slides.pdf (we hold this as s2020_pbs_hillaire_slides.pdf).
20. **Hillaire, Frostbite sky and clouds (2016)**: https://media.contentapi.ea.com/content/dam/eacom/frostbite/files/s2016_pbs_frostbite_sky_clouds.pdf (held locally; sec. 5.8 multiple scattering).
21. **Bouthors et al., Interactive multiple anisotropic scattering in clouds** (I3D 2008): https://hal.archives-ouvertes.fr/inria-00333007 (held as bouthors08.pdf). Per-order energy transport without marching.
22. **Real-time voxel cloud single + multi-scatter with analytic expansion** (Bajkowski and Szajerman, ICCS 2024), https://iccs-meeting.org/archive/iccs2024/papers/148360159.pdf. Compared with flux-limited diffusion. Not read in detail.
23. **Parker Ford, UW thesis 2024** adapting Hillaire energy-conserving integration + Wrenninge multi-bounce; reports 2-3 ms. https://digital.lib.washington.edu/researchworks/bitstreams/fe31500e-8547-4688-95ee-f08e7e096d19/download
24. **Disney / WDAS cloud dataset**: the Moana cloud (used as the reference in NeuralVDB, Don't Splat, Hillaire slides). I did not find a separate "Disney cloud dataset paper"; the asset is distributed by WDAS (not verified here which URL is current; search "Walt Disney Animation Studios Moana Island / Cloud data set").
25. **Production cloud context**: DreamWorks "Puss in Boots" clouds (https://research.dreamworks.com/wp-content/uploads/2018/07/PussInBoots_Clouds_DWA_2012.pdf).
26. **Nubis / "Bitterli-style"**: the existing local set (Nubis Cubed 4k pptx, HZD papers) is the primary source. I found no new 2025-26 Nubis publication in searches.

## E. Phase functions

27. **An Approximate Mie Scattering Function for Fog and Cloud Rendering** (Jendersie and d'Eon, NVIDIA, SIGGRAPH 2023 talk): https://research.nvidia.com/labs/rtr/approximate-mie (paper + supplemental PDFs there). Analytic HG + Draine blend matching ~95% of Mie across droplet sizes; analytic CDF inversion, cheap to evaluate in WGSL. Searched for a *learned* neural phase function for clouds: none found. Deep Scattering's paper notes HG loses silver lining and glory.

## F. Diffusion / generative cloud density

28. **Light Transport-aware Diffusion Posterior Sampling for Single-View Reconstruction of 3D Volumes** (Ludwic Leonard, Nils Thuerey, Ruediger Westermann), CVPR 2025, arXiv 2501.05226. https://arxiv.org/abs/2501.05226 (saved, X-; same authors group as HaloRT, 1000 synthetic JangaFX-sim clouds, monoplanar latent). Possible source of training volumes or a density prior for a "novel cloud" generator.
29. **NnD: Diffusion-based Generation of Physically-Nonnegative Objects** (Nadav Torem, Tamar Sde-Chen, Yoav Y. Schechner), arXiv 2506.10112, Jun 2025. https://arxiv.org/abs/2506.10112. Non-negative diffusion generating 32^3 LES cloud scenes with microphysics (LWC, effective radius). Meteorological rather than artist-driven.
30. **Volumetric Cloud Field Reconstruction** (Jacob Lin et al.), arXiv 2311.17657. https://arxiv.org/abs/2311.17657. Satellite/NeRF-style cloud reconstruction (cited by Olajos-era reading lists; not read in detail).
31. Procedural-noise-synthesis via diffusion for clouds: **nothing found**.

## G. Web / WebGPU demos

32. **Visionary: The World Model Carrier Built on WebGPU-Powered Gaussian Splatting Platform** (Gong et al.), arXiv 2512.08478, Dec 2025. https://arxiv.org/abs/2512.08478. Per-frame ONNX Runtime WebGPU inference whose outputs feed a WebGPU splat renderer as storage buffers (paper does not state explicitly that ORT and the renderer share one GPUDevice). Timings on RTX 4090: Scaffold-GS MLP decode 9.29 ms (2.49M Gaussians); 4DGS 4.76-7.93 ms; avatars ~7.5-8 ms. The closest published "neural net in the frame loop of a WebGPU renderer" we found.
33. **TU Wien thesis (Muth 2026)**, WebGPU ray-marcher for meteorological cloud data in weBIGeo (non-neural): https://www.cg.tuwien.ac.at/research/publications/2026/muth-2026-clouds/
34. **oopera/clouds** (WebGPU/WGSL cloud generator, procedural): https://github.com/oopera/clouds ; **jeantimex/procedural-clouds** (WebGPU, compute density cache + raymarch): https://github.com/jeantimex/procedural-clouds. Neither is neural.
35. No Shadertoy / three.js neural volumetric cloud demo found; no shipped game-engine neural cloud product found (NVIDIA RTX NRC / ReSTIR is surface GI).

## Gaps (did not find)
- Any 2025-26 follow-up to Faster RPNN with code.
- Learned phase functions for clouds; neural deep shadow maps for clouds; neural temporal upscaler specific to volumetric clouds.
- Open code for Olajos 2026 or Six-way Lightmaps.
