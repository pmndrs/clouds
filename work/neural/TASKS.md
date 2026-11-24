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
| N2b | Second half of the feature pass in one task: sun transmittance at the first crossing (6), environment samples (7–9), albedo (10–12), g (5); pack all 14 channels in the layout the authors' ONNX input expects. Panels on the page. | Opus | running |  |
| N2c | Environment samples: importance-sampled equirect, shadowed, phase-weighted (features 7–9). | — | merged into N2b |  |
| N2d | Parity sheet: our panels beside the authors' for the same cloud, camera and sun. | Sonnet | todo | |
| N3a | ONNX Runtime Web on the page's GPU device, fed by our feature buffer; composite. | Opus | todo | |
| N5-0 | Design note for the hand-written engine: op list, dispatch count, batching the six passes, what to reuse from Denoiser `denoiser-wgsl`, task breakdown. No code. Output `docs/neural/ENGINE.md`. | Opus | running | |
