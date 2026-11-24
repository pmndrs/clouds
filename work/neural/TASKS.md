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
| N2d | Parity sheet: our panels beside the authors' for the same cloud, camera and sun. | Sonnet | done | Features match the authors' for the same camera, sun and medium (means within 2–5 %); environment differs ~10 % because our sky differs (N-F7). Sheet `work/captures/N2d/parity.jpg`. `b30ebe2` |
| N3a | ONNX Runtime Web on the page's GPU device, fed by our feature buffer; composite. | Opus | done | First neural-lit picture on `/neural/`: our features → authors' ONNX (ORT Web 1.30 from CDN, fp32, our device). ~180 ms per frame at 512². Sheet `work/captures/N3a/sheet.jpg`. `6127413` |
| N3b | Quality sheet: Disney cloud, noon and low sun, path trace \| neural (engine fp16) \| our raymarch, each with its cost, one tone map. | Opus | done | 512²: PT 1024 spp 130 / 184 s; neural 33 ms/frame (16 frames shown); raymarch (high, nubis) 1 ms/frame. Neural closest to the PT in lit-face brightness (+8–11 % vs raymarch −46–57 %) but softer and with a much shallower low-sun shadow; raymarch closer in low-sun shadow depth and colour, sharper than both, lit faces too dark. Sky and sun colour of the neural page not matched (log). Sheet `work/captures/N3b/sheet.jpg`, log `work/logs/N3b.md`. `fb1b839` |
| N5-0 | Design note for the hand-written engine: op list, dispatch count, batching the six passes, what to reuse from Denoiser `denoiser-wgsl`, task breakdown. No code. Output `docs/neural/ENGINE.md`. | Opus | done | `docs/neural/ENGINE.md`: 82 fused dispatches, batch of 6, task list. Its cost estimate was corrected after N5.1. `bf28163` |
| N5.1 | Dispatch-overhead probe: 82 vs 1,825 dependent dispatches of equal total work. | Sonnet | done | **Hypothesis wrong.** Fixed cost ~6.5 µs per dispatch; 1,825 → 82 saves ~5 ms, not 100. Page `/neural-probe/`, log `work/logs/N5.md`. `d812f2c` |
| N5.2 | `.pt` → `.tza` weight converter, standard library only. | Sonnet | done | 273 tensors, 1,151,649 parameters per file; Denoiser `parseTZA` reads it. Weights are stored channels-last in the `.pt`; the converter reorders. `scripts/neural/pt_to_tza.py`, log `work/logs/N5-2.md`. `7a3f6cb` |
| N5.3 | Kernel throughput probe: run the Denoiser engine's existing fused 3×3 conv on HaloRT-shaped layers (16 → 16 channels at 512², batch 6 and 4, the full-resolution conv count of one frame) and time it. Decides whether hand-written kernels beat ONNX Runtime's ~130 ms and by how much. | Opus | done | **Engine is worth building.** Measured, all 71 conv3×3 layers with the Denoiser kernel: 512² six passes 19.2 ms fp16 / 29.0 ms fp32; 256² four passes 5.3 ms fp16. Full-network estimate 25–35 ms fp16 at 512². Full resolution is 77.5 % of the work. Log `work/logs/N5.md`; probe page on the Denoiser branch `cf25beb`. `a0d5360` |
| N5.4 | Parity fixture: saved feature frame at 256² and 512² plus the authors' ONNX output (wasm and WebGPU). | Sonnet | done | `node scripts/neural/make-fixture.mjs`; files in `artifacts/research/neural/fixture/` (local). wasm vs WebGPU max diff 1.4e-6; re-runs byte-identical. `c86dd29` |
| N5.5 | NumPy reference network with per-layer dumps. | Sonnet | done | Matches ONNX to 1.5e-6 at 256² and 512². `python3 -I scripts/neural/halonet_ref.py --size 256 --check`; dumps in `artifacts/research/neural/fixture/dumps/`. `7925b5a` |
| N5.6 | Engine skeleton in `experiments/neural/engine/` (ENGINE.md task 5): runtime, buffer slots, weight loading from `.tza`, first conv → output matches the NumPy dump. | Opus | done | Skeleton + init conv, batch 6, two weight sets: 1e-6 vs NumPy (fp32). Layout in `work/logs/N5-6.md`. `c9131f4` `67ded90` |
| N5.7 | Conv3×3 + RMSNorm + SiLU fused kernel, skip add and ×2 in the epilogue (ENGINE.md task 6). | Opus | done | Conv + RMSNorm + SiLU fused, skip, ×2: ≤5.5e-6. fp16 error grows ~1.2× per layer. `2468cc2` |
| N5.8 | Down (2×2 stride-2 form) and up path, 1×1 packing (ENGINE.md task 7). | Sonnet | done | Down, Up, concat, 1×1: ≤1.5e-5. `c566927` `50e6e9e` `6eea280` |
| N5.9 | Block attention kernel (ENGINE.md task 8). | Opus | done | Block attention in 2 dispatches: ≤7.8e-6 at 256² and 512². `cf7fc04` `93ca24c` |
| N5.10 | Full graph, batch of 6, blend; end-to-end parity (ENGINE.md task 9). | Opus | done | **Whole network on our engine**, 88 dispatches, one submit. End to end vs authors: 1.3e-6 (fp32). fp16 not distinguishable by eye. Network wall time, batch 6: 512² 36.1 ms fp32 / 23.2 ms fp16; 256² 12.9 / 8.5 ms. Page `/neural-engine-full/`, sheet `work/captures/N5-10/sheet.jpg`. `c010079` `6c0fddb` |
| N5.11 | Timing table beside ONNX Runtime's (ENGINE.md task 10). | Sonnet | todo | |
| N5.12 | Engine on the live `/neural/` page: GPU blend op, features buffer straight into the engine, an "engine" switch beside ONNX Runtime. | Opus | done | **Live page lit by our engine**, fully on the GPU: `packed` bound straight in (the first conv gathers), GPU blend into the ONNX output buffer (display shared). Review "network" select + `?net=`, default engine. vs ONNX at 512²: fp32 1.0e-6 max abs, fp16 1.1e-2 (same by eye). Frame (features+net+blend) 512²: engine 103 ms fp32 / 33 ms fp16, ONNX 325 / 158 ms; fp32 here is ~3× N5.10's network-only number (log). Sheets `work/captures/N5-12/sheet{,-fp16}.jpg`, log `work/logs/N5-12.md`. `9b1d9c2` |
| N7.1 | Grey-albedo shortcut: batch of 4 (one sun pass). | Sonnet | todo | |
| N7.2 | Network at 256² with the upscaler to 512² and above. | Opus | todo | |

