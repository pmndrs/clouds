# ZIE18 — The unreasonable effectiveness of deep features as a perceptual metric (LPIPS)

- **Authors / year / venue:** Richard Zhang, Phillip Isola, Alexei A. Efros, Eli Shechtman, Oliver Wang, CVPR 2018, arXiv:1801.03924
- **Paper:** `/Users/dex/Developer/WebGPUClouds/artifacts/research/papers/neural/ZIE18-zhang-2018.pdf` (arXiv, open)
- **Project page:** none
- **Official code:** https://github.com/richzhang/PerceptualSimilarity (repo HTTP 200; check LICENSE, believed BSD-2-Clause)
- **Third-party code:** no JS / WebGPU / ONNX port found
- **Data / weights:** linear calibration weights ship with the official repo; backbones (AlexNet, VGG, SqueezeNet) are ImageNet-pretrained; BAPPS human-judgement dataset is released with the paper's project
- **Cited by HaloRT as:** learned perceptual metric

## Summary
Distance is computed from ImageNet-trained CNN activations, normalised per channel and reweighted with learned linear weights fitted to human similarity judgements. It agrees with human perception better than SSIM, PSNR or other hand-crafted metrics across many distortion types. Known limitations are that it needs a network and GPU or CPU inference, and it can be sensitive to the backbone choice.

## Use for us
Offline perceptual metric for A/B crops, run as `python3 -I` against the official repo; the owner's eye still outranks it, and no browser port was found, so it stays off the realtime path.
