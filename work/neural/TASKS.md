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
| N1 | Serve the authors' HaloRT web demo locally (clone to `artifacts/research/neural/rdv_on_the_web`, main checkout, not committed). Run it in headless Chrome with GPU timestamps. Record features ms and network ms at 256² and 512², fp32 and fp16, and for the sun-only page. One screenshot. | Sonnet | running | |
| N2a | Lab page `examples/lab/neural/` plus WGSL compute pass in `experiments/neural/`: per pixel optical depth `tau`, `S = 1 - exp(-tau)` and the four crossing depths, encoded as the released code does, on a dense density texture. Show them as panels. | Opus | running | |
| N2b | Sun transmittance at the first crossing point (feature 6). | Opus | todo | |
| N2c | Environment samples: importance-sampled equirect, shadowed, phase-weighted (features 7–9). | Opus | todo | |
| N2d | Parity sheet: our panels beside the authors' for the same cloud, camera and sun. | Sonnet | todo | |
| N3a | ONNX Runtime Web on the page's GPU device, fed by our feature buffer; composite. | Opus | todo | |
