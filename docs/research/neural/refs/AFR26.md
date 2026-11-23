# AFR26 — Intel Open Image Denoise (OIDN)

- **Authors / year / venue:** Áfra (first name not checked), Intel. Software library and documentation, not a paper in this batch.
- **Paper:** no paper PDF. Library docs: https://www.openimagedenoise.org
- **Project page:** https://www.openimagedenoise.org
- **Official code:** https://github.com/RenderKit/oidn, C++, Apache-2.0 licence, active (pushed 2026-10). Runs on CPU (SSE4.1 and ARM64) and on Intel Xe, Xe2, Xe3 and AMD RDNA GPUs. Weights are shipped per filter (`OIDN_FILTER_RT`, `OIDN_FILTER_RTLIGHTMAP`), and the repo includes a training export tool (`export.py`) that writes a Tensor Archive format.
- **Third-party code (WebGPU / web):**
  - https://github.com/pissang/oidn-webgpu, Rust, MIT, active (pushed 2026-10). Its description is "Open Image Denoise on WebGPU", so it is the closest match to our target. I did not run it.
  - https://github.com/DennisSmolek/Denoiser, TypeScript, MIT, pushed 2026-07. This is the owner's own repository. Its description says it is based on OIDN and runs on TensorFlow.js, mainly on WebGL and WebGPU, so it is not a real OIDN port.
  - An npm package `oidn-web` appeared in search mirrors. I did not check it, and the mirror page carried a supply-chain warning, so do not install it without review.
  - Search found no official Intel WebAssembly or browser build.
- **Data / weights:** trained weights are in the OIDN release. Licence of the weights follows the repo.
- **Cited by HaloRT as:** reference-list entry; the in-text context was not checked.

## Summary
OIDN is a production denoiser for path-traced images. It is a CNN trained offline on render data and shipped as a runtime library with several pretrained filters, such as RT for general path tracing and RTLightmap for lightmaps. The RT filter takes the noisy colour plus auxiliary albedo and normal buffers. The oidn-webgpu description calls the network a UNet, which fits the usual encoder-decoder with skip connections, but I did not verify the layer layout against the OIDN source. The runtime has CPU and GPU paths, and the web port reimplements the network on WebGPU and processes images tile by tile.

## Use for us
OIDN is the practical baseline: a ready denoiser with weights and an Apache-2.0 licence, plus a WebGPU port to study. Check the oidn-webgpu code for its WGSL layers and tiling before we write our own, and confirm the weight licence before shipping any of them.
