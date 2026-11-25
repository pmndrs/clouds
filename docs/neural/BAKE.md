# Baked cloud imposter — experiment plan

Written 2026-11-25. Branch `neural/bake-experiments` (the HaloRT port is
frozen at tag `neural-halort-port-end`). Protections in `PLAN.md` still apply:
one task = one change + one check, two tries, nothing over 30 minutes.

## Idea (owner's framing)

Use a network as an imposter or level of detail, so that a cloud can be drawn
without marching it. Bake one cloud into a small feature grid plus a tiny
network; at run time each pixel does a few texture reads and one network
query. The gain, if there is one, is in a full sky, where marching every
cloud is the cost.

## What we own already

| Piece | Where | Note |
| --- | --- | --- |
| Tiny network with training on the GPU | pathtracer `packages/mlp` (`MlpEngine`) | WGSL compute, Adam, f16/f32. Shapes 64→5×64→3 and 64→3×32→3. RGB output only, ReLU, no biases. No dependencies; import by link or copy |
| Trainable feature grids | pathtracer `bench/nrc/spatial-features.ts` | multi-level trilinear grids with gradient scatter; written for the radiance cache, not a general API |
| Training pictures | our own raymarcher, `runtime.output` (rgba16float, premultiplied radiance, a = transmittance) | about 1 ms a frame for one cloud, so data is nearly free |
| Density and empty-space SDF | `packages/runtime` (`heroPool`, `cloudSdf`) | the SDF gives a first-surface point in a few steps |
| Reference page with readback and timing | `examples/lab/reference-pt/` (`runtimeTiming`, `readLinear`) | camera and sun are presets; a free camera needs a small patch |

Measured before (pathtracer docs, M5 Pro): inference for the 5×64 shape is
94 ms per million queries in portable f16 WGSL, 12.3 ms with subgroup-matrix
kernels (Chrome flag). A training step of 16k records is 2.7 ms.

## Honest expectation

At 512² the 5×64 network would cost about 25 ms in portable WGSL, against
1.0 ms for marching the same cloud. So the imposter can only win if the
network is much smaller, the cloud is small on screen, or the march is much
dearer than the single-cloud figure suggests. B0 measures exactly that before
anything is built.

## Tasks

| ID | Task | Check | Model |
| --- | --- | --- | --- |
| B0 | **Budget.** Time (a) `MlpEngine` inference for both shapes at 16k, 65k and 262k queries, f16 portable; (b) our raymarch of the Disney cloud at 128², 256², 512²; (c) one full-sky bench frame at the normal quality setting, if a scene and timing hook exist | one table: ms per pixel count for network and for march | Sonnet |
| — | **Gate.** If the smallest network costs more per pixel than the march at every size, stop and ask the owner before B1 | | |
| B1 | **Bake v1, fixed sun.** Import the trainer. Per pixel: SDF first-surface point and thickness → feature grid + small network → premultiplied colour; alpha by the simplest route that works. Train on raymarched frames from random cameras. | bake time; sheet of baked beside raymarched at three unseen views | Opus |
| B2 | **Draw and time it.** The baked cloud as a lab page with a Review switch (baked / raymarched), timed at three on-screen sizes | timing table; sheet | Opus |
| B3 | **Sun as an input.** Retrain with the sun direction varying | sheet at four suns | Opus |
| B4 | **Many clouds.** Only if B2 shows a gain: a sky of baked instances against the same sky marched | one number each | Opus |

## Open design points (decide in B1, write down what was chosen)

- Alpha: the trainer outputs three channels. Options: a second one-output
  network, alpha from thickness with a fitted constant, or grey radiance plus
  alpha in the three outputs.
- Feature grid: reuse the radiance cache's trilinear grids or write a triplane.
- Whether the view direction is an input (the Olajos paper found it unneeded).

## Not in scope

Lighting more correct than our raymarcher (the bake copies our own look);
changing density after the bake; phones.
