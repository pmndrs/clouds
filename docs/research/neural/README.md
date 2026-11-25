# Neural cloud rendering — research index and state of the field

Gathered 2026-11-23 for the neural track (plan: `docs/neural/PLAN.md`, status:
`work/neural/STATUS.md`). Starting point: "Real-Time Volumetric Light Transport
Inference without a Path" (HaloRT, Leonard & Westermann, arXiv 2611.12103).

## What is here

| File | What |
| --- | --- |
| `halort-anatomy.md` | How HaloRT works, read from the paper **and** the released code (they differ) |
| `refs/<KEY>.md` | One note per reference in the paper (50 notes): links, code, 1–3 paragraph summary, use for us |
| `refs/HALORT-ecosystem.md` | Every public repo, dataset and demo by the authors, and what is not public |
| `landscape-uncited.md` | Neural cloud and media work the paper does not cite |
| `web-inference-options.md` | Ways to run a network on WebGPU in late 2026, with a comparison table |

PDFs (44 files) are local only, in the main checkout:
`artifacts/research/papers/neural/`. Papers with no open copy are marked in
their note.

## Does HaloRT build on the others or just cite them?

It builds on three and cites the rest as background.

- **Built on:** the volume denoisers of Hofmann et al. (`HMES20`, `HHCM21`) —
  HaloRT keeps their idea of volume-specific feature images and their training
  settings, and drops the noisy radiance input. Deep Shading (`NAM17`) — the
  idea that a network can shade from feature buffers alone. HaloNet (`VRS21`) —
  the local attention block, though the released code uses its own variant
  (no position embedding, learned memory tokens).
- **Compared against:** MRPNN (`HYL23`), OIDN (`AFR26`), and the two Hofmann
  denoisers (retrained by the authors; weights ship in the HaloRT repo).
- **Data from:** the Cloudy diffusion dataset (`LTW25`, same group, 500 clouds
  public under MIT) and Stable Diffusion environments (`RBL22`, not released).
- **Background only:** the surface denoising line (13 refs), the classic
  rendering papers (10 refs), surface neural GI (`RBRD22`, `ZDP25`, `XTW26`…).

## Where neural cloud rendering stands (late 2026)

There are five families. They differ in where the network sits.

| Family | Network sits | Examples | Trained | Speed (their hardware) | Handles new clouds |
| --- | --- | --- | --- | --- | --- |
| 1. Raymarch + analytic multiple scattering | none | Nubis, Frostbite, Hillaire 2020, **our library** | — | a few ms | yes |
| 2. Radiance prediction per shading point | inside the march | Deep Scattering `KMM17`, MRPNN `HYL23`, WebVDB's `'neural'` mode | once, generalises | minutes → 25–33 ms (RTX 2080, 1024²) | yes |
| 3. Baked per cloud | per-asset grid + tiny MLP | RNA `MLSH24`, Olajos `ODG26`, MRBNN `LYG26` | per cloud (20 min – 4 h) | 0.4–5 ms | no, rebake |
| 4. Denoise a few path samples | image space, after path tracing | `HMES20`, `HHCM21`, `HHM23`, `XXZ25` | once | 24–60 ms, grows with density | yes |
| 5. Infer from primary-ray features | image space, no paths | **HaloRT** | once, generalises | 10 ms (RTX 5090, 512²) | yes |

What the field has settled:

- Multiple scattering in clouds is smooth and predictable enough that a small
  network gets it right from cheap inputs. Every family relies on this.
- The useful inputs are always the same few: optical depth, transmittance
  toward the light at several scales, and the phase and albedo values.
  Deep Scattering gathers them as a 3D stencil, MRPNN as a transmittance mip
  pyramid, HaloRT as per-pixel crossing depths.
- Light is split and scaled outside the network (sun and sky separately,
  intensity factored out). HaloRT and MRBNN both do this.
- Networks have shrunk from 1.4 M parameters per point (2017) to about 50 k
  per point (MRPNN) or about 1.2 M per image (HaloRT).

What is open:

- **Nobody has shipped it.** We found no game or engine using a neural cloud
  renderer, and no browser demo other than the HaloRT authors' own.
- **Time.** No method has a temporal model. HaloRT is stable per frame because
  its features are nearly noise-free; moving clouds and cameras are untested.
- **Scale.** All of them light one cloud in a box. None handles a cloudscape,
  aerial perspective, or terrain inside the medium.
- **Training is not reproducible from public code** for HaloRT, MRPNN or MRBNN
  (weights only). The data and tools to rebuild it are public.
- **Phase function.** Everything uses Henyey–Greenstein. Our dual-lobe and Mie
  work has no counterpart.

## How this relates to a raymarched renderer like ours

A raymarcher and HaloRT do the same first half. Both march the primary ray,
both march toward the sun, both read the sky. The difference is what happens
with those numbers.

| Step | Our raymarcher | HaloRT |
| --- | --- | --- |
| Primary march | per step: density, accumulate colour | once: optical depth, four crossing depths |
| Sun shadow | light march or light grid at every step | one shadow ray at one point per pixel |
| Sky | 8 hemisphere means, unshadowed | about 8 shadowed, importance-sampled rays at one point |
| Multiple scattering | octave or fit formula per step | a U-Net over the feature images |
| Cost | steps × light taps | features (cheap) + network (fixed) |
| Detail | every step shades, so edges are as sharp as the density | network output at image resolution; fine detail has to come through the features |

Three ways to combine them, from least to most change:

1. **Network as the lighting model for a hero cloud.** Keep our density, VDB
   loading, sky and compositing. Replace the lighting of one VDB cloud with
   the HaloRT feature pass plus network. This is the plan's main line.
2. **Network for the multiple-scattering part only.** Keep our marched single
   scattering (crisp, cheap, already right) and let a network add orders 2+.
   The path tracer already splits orders 0–1 from 2+, so the training target
   exists. Needs our own training.
3. **Network inside the march (family 2).** A per-sample MLP fed by our light
   grid. WebVDB already has a small one. Fits procedural cloudscapes better
   than an image-space U-Net does, since it needs no cube.

Our P2.4b result says the fit lighting is 25–35 % too dark on lit faces
against the path trace. That gap is the kind of error these networks remove,
which is why the experiment is worth doing even if the U-Net is too slow to
ship.

## What we measured ourselves (2026-11-23)

The authors' WebGPU demo (`rendervous.github.io/rdv_on_the_web/halort/`,
ONNX Runtime Web, features + six network passes) on this Mac, in the app's
browser pane, whole-frame interval:

| Resolution | fp32 | fp16 |
| --- | --- | --- |
| 256² | 55 ms | 47 ms |
| 512² | 208 ms | 170 ms |

The pane had no GPU timestamp queries, so features and network are not split.
For scale, the Denoiser repo's hand-written WGSL engine runs a similar-sized
U-Net (0.9 M parameters, no attention) at 512² in about 5 ms per pass on an
M5 Pro. Whether a hand-written HaloRT lands near 6 × 5 ms is not known.

## Code worth having

| What | Where | Licence |
| --- | --- | --- |
| HaloRT model, weights, GLSL features | `github.com/rendervous/HaloRT` | MIT |
| HaloRT in the browser (ONNX, WGSL features) | `github.com/rendervous/rdv_on_the_web` | no licence file; cloud data CC BY-SA |
| Reference path tracer, CLI | `github.com/rendervous/cloud_renderer`, `rdv_project` | none / MIT |
| 500 clouds | `huggingface.co/datasets/rendervous-project/compact_clouds` (13.7 GB) | MIT |
| MRPNN | `github.com/What-a-stupid-username/MRPNN` (CUDA) + Unity port | GPL-3.0 |
| MRBNN | `github.com/xiaomi-research/mrbnn` | non-commercial |
| Olajos cloud shading | `github.com/LUGGPublic/evns-clouds-rtr` | none |
| Volume denoiser (Hofmann 2020) | `github.com/nihofm/ndptmvd` | none |
| Volumetric ReSTIR | `github.com/DQLin/VolumetricReSTIRRelease` | BSD-3 |
| HaloNet attention | `lucidrains/halonet-pytorch`, timm | MIT / Apache-2.0 |

## Errors found in the paper's reference list

- `HHCM21` is printed with DOI 10.1145/3585497, which is `HHM23`'s. The right
  one is 10.1145/3451256.
- `YGH25`: Crossref gives 10.1145/3768618, not the printed 10.1145/3759487.
- `IGMM22` is not a neural method (weighted recursive least squares).
- `DFNB25` is a survey of clinicians, not of methods.
