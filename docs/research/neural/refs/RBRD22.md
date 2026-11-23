# RBRD22 — Neural Precomputed Radiance Transfer

- **Authors / year / venue:** Rainer, Bousseau, Ritschel, Drettakis; 2022; Computer Graphics Forum 41(2) (Eurographics 2022), doi 10.1111/cgf.14480
- **Paper:** https://inria.hal.science/hal-03581439 (open HAL author version; local: `artifacts/research/papers/neural/RBRD22-rainer-2022.pdf`). Eurographics DL PDF is blocked to scripts, the HAL copy is the open one.
- **Project page:** https://repo-sam.inria.fr/fungraph/neural-prt/
- **Official code:** https://gitlab.inria.fr/fungraph/neural-prt (Python/PyTorch training, plus a Falcor 4.3 fork for data generation, Windows only; custom Inria research licence "allow the research community to use, test and evaluate", not OSI; includes a 2-image example dataset; no pretrained weights seen)
- **Third-party code:** none found
- **Data / weights:** training data is rendered with Falcor (3000 train images 256x256 per scene, 200 test at 400x400); environment maps from the Laval HDR databases (indoor and outdoor). No released dataset found.
- **Cited by HaloRT as:** PRT-inspired neural architecture, G-buffers plus a light code, scene-specific; HaloRT splits transport and lighting similarly.

## Summary
Problem: global illumination of a static synthetic scene under dynamic environment-map lighting, rendered by a per-scene network that takes G-buffers plus the environment map, and no radiance. Framed as neural precomputation: training is the precompute, mirroring classic PRT (freeze geometry and materials, encode light transport, apply as a fast linear op on a lighting vector).

Method: environment map E (normalised by mean, log(1+x)) goes through a CNN encoder (5 blocks of conv-ReLU-maxpool with skip, 32 channels, final linear to a 64-D light code). Per-pixel G-buffer attributes (position, view dir, mirror dir, normal, diffuse albedo, specular albedo, roughness; 19-D) go to an MLP. Four architectures at equal parameter budget (about 290k encoder + about 190 to 220k transport; roughly 4x256 baseline): (1) baseline MLP on [light code, attributes]; (2) PRT-inspired: a transport MLP outputs a descriptor s(x), combined with the light code by a second MLP (sine/SIREN activations help in the first); (3) albedo factorisation L = kd*Phi(s,e) ...; (4) diffuse/specular separation with two tracks. Trained 500 epochs, Adam 1e-4, L1 on log(1+x) tonemapped radiance, 16 to 18 h on an RTX 6000.

Results: each PRT principle improves quality at fixed budget, best is diffuse/specular separation. Inference on a 512x512 image on an RTX 3090: encoder 0.34 ms, baseline 9.7 ms, PRT-inspired 10.6 ms, albedo-fact 10.6 ms, D/S separation 16.0 ms (upper bounds, env-map pixels skipped); compared against Falcor path tracing at about 5 spp.

## Use for us
Closest conceptual precedent for HaloRT's "G-buffer + environment light code, no path": the light-code vs transport split and linear-in-illumination design (our sun/env split). Per-scene training is the opposite of what we need; we want the generalising version.
