# RBL22 — High-resolution image synthesis with latent diffusion models (Stable Diffusion)

- **Authors / year / venue:** Rombach, Blattmann, Lorenz, Esser, Ommer; 2022; CVPR 2022 (oral); arXiv 2112.10752
- **Paper:** https://arxiv.org/abs/2112.10752 (local: `artifacts/research/papers/neural/RBL22-rombach-2022.pdf`, arXiv v2)
- **Project page:** https://github.com/CompVis/latent-diffusion
- **Official code:** https://github.com/CompVis/latent-diffusion (Python/PyTorch, MIT; checkpoints for LDM models) and https://github.com/CompVis/stable-diffusion (Stable Diffusion v1; licence reported as NOASSERTION; weights under CreativeML OpenRAIL-M). Stability's SD2 repo link tried (Stability-AI/stablediffusion) did not resolve through the API, not checked further.
- **Third-party code:** https://github.com/huggingface/diffusers (Python, Apache-2.0) is the practical library for running SD/SDXL and LoRAs.
- **Data / weights:** SD v1 weights on Hugging Face (CompVis/stable-diffusion, CreativeML OpenRAIL-M, use-based restrictions)
- **Cited by HaloRT as:** used only to synthesise 1000 HDR-like environment maps for training.

## Summary
Runs diffusion in the latent space of a pretrained autoencoder (downsampling factor f, KL- or VQ-regularised; f=4 to 8 is the sweet spot) instead of pixel space, cutting training and sampling cost by a large factor, with a time-conditional UNet and cross-attention layers for conditioning (text, boxes). Gives state-of-the-art inpainting and class-conditional results and strong text-to-image, super-resolution, and convolutional high-res sampling. It is the basis of Stable Diffusion. HaloRT uses it only as a data generator: 1000 "HDR-like" environment maps (the paper gives no further recipe, so we do not know prompts, tone-mapping inversion or the SD model). The paper's own content is not about HDR.

## Related: generating HDR environment maps with Stable Diffusion, and open HDRI libraries
- DiffusionLight (CVPR 2024): SDXL + LoRA, paints a chrome ball at several exposures, merges into an HDR light probe from a single image (not text-to-HDRI). Code https://github.com/DiffusionLight/DiffusionLight (Python, MIT), weights https://huggingface.co/DiffusionLight/DiffusionLight.
- Text2Light (SIGGRAPH Asia 2022): text to HDR panorama, VQGAN based not SD. https://github.com/FrozenBurning/Text2Light (licence NOASSERTION, last push 2023).
- 360 Diffusion LoRA for SD 1.5 (LDR equirectangular panoramas, needs tone-expansion for HDR): https://huggingface.co/ProGamerGov/360-Diffusion-LoRA-sd-v1-5, also on Civitai; Qwen 360 Diffusion (https://huggingface.co/ProGamerGov/qwen-360-diffusion, MIT per card). EdgeRelight360 (arXiv 2404.09918) trains SD on 8-bit HDR10-quantised HDRIs, no code found. worldBuilder is a Textual-Inversion embedding for SD 1.x. LuxDiT (NVIDIA) predicts HDR env maps from images; the GitHub path NVlabs/LuxDiT returned 404.
- Real data: Poly Haven HDRIs, all CC0 (no attribution needed; site terms forbid scraping, API at api.polyhaven.com with its own API terms): https://polyhaven.com/hdris. Laval HDR databases (indoor, outdoor) used by RBRD22; licence not checked.

## Use for us
For HaloRT-style training we can avoid SD: use CC0 Poly Haven HDRIs plus procedural sky models (Hosek-Wilkie or similar) for the smooth env term; if we want stylised variety, generate LDR panoramas with a 360 LoRA and expand to HDR by exposure-bracket tricks as in DiffusionLight.
