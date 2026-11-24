# Neural clouds — tasks

One row per task. A task is one change and one check, about 20 minutes of
agent work. The orchestrator adds rows; the agent doing a task fills in State
and Result and appends its notes to `work/logs/<ID>.md`.

**For agents.** Read `docs/neural/PLAN.md` § Protections, your row here, and
only the files your brief names. Commit by pathspec after each working step
(never `git add -A`). Never remove existing code. Python with `python3 -I`.
Never use vite ports 5180, 5173 or 5201; kill your own servers and headless
Chrome when done. Stop and hand back when the check passes, when you have
failed it twice, or at about 25 minutes, whichever comes first. Hand-back,
under 150 words: done / stuck on / proposed next.

State: todo, running, done, stopped (say why).

| ID | Task | Model | State | Result |
| --- | --- | --- | --- | --- |
| N1 | Serve the authors' HaloRT web demo locally (clone to `artifacts/research/neural/rdv_on_the_web`, main checkout, not committed). Run it in headless Chrome with GPU timestamps. Record features ms and network ms at 256² and 512², fp32 and fp16, and for the sun-only page. One screenshot. | Sonnet | done | M5 Pro, 512² fp16: GPU timestamps 33 ms, frame interval 142 ms. Log `work/logs/N1.md`, script `scripts/neural/time-demo.mjs`. `90e372f` |
| N1b | Wall-time the demo's stages serially and count dispatches. | Sonnet | done | 512² fp16: features 6.5 ms, network 135 ms wall (33 ms on GPU timestamps), 1,825 dispatches, ~55 µs unexplained per dispatch; JS encode 0.5 ms. `2045aa2` |
| N2a | Lab page `examples/lab/neural/` plus WGSL compute pass in `experiments/neural/`: per pixel optical depth `tau`, `S = 1 - exp(-tau)` and the four crossing depths, encoded as the released code does, on a dense density texture. Show them as panels. | Opus | done | Works on the Disney cloud (`wdas_cloud_eighth.vdb`). Sheet `work/captures/N2a/view.jpg`, page `/neural/`, log `work/logs/N2a.md`. No empty-space skipping yet; step 0.004. `8deb910` `f19912c` |
| N2b | Second half of the feature pass in one task: sun transmittance at the first crossing (6), environment samples (7–9), albedo (10–12), g (5); pack all 14 channels in the layout the authors' ONNX input expects. Panels on the page. | Opus | done | All 14 channels + background, packed as the ONNX `condition` input [1,17,H,W]. Sheet `work/captures/N2b/view.jpg`, log `work/logs/N2b.md`. `f242739` |
| N2c | Environment samples: importance-sampled equirect, shadowed, phase-weighted (features 7–9). | — | merged into N2b |  |
| N2d | Parity sheet: our panels beside the authors' for the same cloud, camera and sun. | Sonnet | running |  |
| N3a | ONNX Runtime Web on the page's GPU device, fed by our feature buffer; composite. | Opus | done | First neural-lit picture on `/neural/`: our features → authors' ONNX (ORT Web 1.30 from CDN, fp32, our device). ~180 ms per frame at 512². Sheet `work/captures/N3a/sheet.jpg`. `6127413` |
| N5-0 | Design note for the hand-written engine: op list, dispatch count, batching the six passes, what to reuse from Denoiser `denoiser-wgsl`, task breakdown. No code. Output `docs/neural/ENGINE.md`. | Opus | done | `docs/neural/ENGINE.md`: 82 fused dispatches, batch of 6, task list. Its cost estimate was corrected after N5.1. `bf28163` |
| N5.1 | Dispatch-overhead probe: 82 vs 1,825 dependent dispatches of equal total work. | Sonnet | done | **Hypothesis wrong.** Fixed cost ~6.5 µs per dispatch; 1,825 → 82 saves ~5 ms, not 100. Page `/neural-probe/`, log `work/logs/N5.md`. `d812f2c` |
| N5.2 | `.pt` → `.tza` weight converter, standard library only. | Sonnet | done | 273 tensors, 1,151,649 parameters per file; Denoiser `parseTZA` reads it. Weights are stored channels-last in the `.pt`; the converter reorders. `scripts/neural/pt_to_tza.py`, log `work/logs/N5-2.md`. `7a3f6cb` |
| N5.3 | Kernel throughput probe: run the Denoiser engine's existing fused 3×3 conv on HaloRT-shaped layers (16 → 16 channels at 512², batch 6 and 4, the full-resolution conv count of one frame) and time it. Decides whether hand-written kernels beat ONNX Runtime's ~130 ms and by how much. | Opus | done | **Engine is worth building.** Measured, all 71 conv3×3 layers with the Denoiser kernel: 512² six passes 19.2 ms fp16 / 29.0 ms fp32; 256² four passes 5.3 ms fp16. Full-network estimate 25–35 ms fp16 at 512². Full resolution is 77.5 % of the work. Log `work/logs/N5.md`; probe page on the Denoiser branch `cf25beb`. `a0d5360` |
| N5.4 | Parity fixture: saved feature frame at 256² and 512² plus the authors' ONNX output (wasm and WebGPU). | Sonnet | done | `node scripts/neural/make-fixture.mjs`; files in `artifacts/research/neural/fixture/` (local). wasm vs WebGPU max diff 1.4e-6; re-runs byte-identical. `c86dd29` |
| N5.5 | NumPy reference network with per-layer dumps. | Sonnet | done | Matches ONNX to 1.5e-6 at 256² and 512². `python3 -I scripts/neural/halonet_ref.py --size 256 --check`; dumps in `artifacts/research/neural/fixture/dumps/`. `7925b5a` |
| N5.6 | Engine skeleton in `experiments/neural/engine/` (ENGINE.md task 5): runtime, buffer slots, weight loading from `.tza`, first conv → output matches the NumPy dump. | Opus | running | |
| N5.7 | Conv3×3 + RMSNorm + SiLU fused kernel, skip add and ×2 in the epilogue (ENGINE.md task 6). | Opus | todo | |
| N5.8 | Down (2×2 stride-2 form) and up path, 1×1 packing (ENGINE.md task 7). | Sonnet | todo | |
| N5.9 | Block attention kernel (ENGINE.md task 8). | Opus | todo | |
| N5.10 | Full graph, batch of 6, blend; end-to-end parity (ENGINE.md task 9). | Opus | todo | |
| N5.11 | Timing table beside ONNX Runtime's (ENGINE.md task 10). | Sonnet | todo | |

