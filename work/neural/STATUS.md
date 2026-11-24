# Neural clouds — status

One page for the neural track: what is running, what waits on the owner, what
landed. Plan: `docs/neural/PLAN.md`. Differences from the source:
`work/neural/DIVERGES.md`. Research: `docs/research/neural/README.md`.
Page: https://claude.ai/artifact/VSCDDPexFVSkSRHBub293d (source `work/neural/compass/index.html`;
edit it directly and republish to the same URL).

Agents: read the plan's Protections before starting. Append to
`work/logs/N<phase>-<task>.md`; update the table below when a task changes
state.

_Last updated 2026-11-24._ Tasks: `work/neural/TASKS.md`.

## Waiting on you

Nothing. D1–D4 were answered on 2026-11-24 (see PLAN § Decisions).

## Phases

| Phase | What | State |
| --- | --- | --- |
| N0 | Research and plan | **done** 2026-11-23 |
| N1 | Their demo on our bench, with timings | **done** 2026-11-24 |
| N2 | Our feature pass | features done; parity sheet N2d running |
| N3 | Their network on our features | **first picture done** (N3a) |
| N4 | Time of day | not started |
| N5 | Our own engine | **running**: fixture and reference done, skeleton N5.6 running |
| N6 | Into the cloud library | not started |
| N7 | Speed and tuning | not started |
| NT | Training foundation | not started; decide after N4 |

## Running

N5.6 (Opus) and N2d (Sonnet).

## Known so far

- Stock HaloRT in the authors' browser demo on this Mac: 47–55 ms per frame
  at 256², 170–210 ms at 512² (whole frame, features and network not split).
- The released code differs from the paper in several feature encodings; the
  port follows the code. See DIVERGES N-S1 to N-S5.
- Training code is not public.
- **Where the frame goes (N1, N1b; M5 Pro, 512², fp16, authors' demo):** features
  6.5 ms, network 135 ms of wall time. GPU timestamps report only 33 ms of
  that, but they are unreliable on Metal here.
- **Dispatch count is not the cost (N5.1).** A probe measured ~6.5 µs per
  dispatch; going from 1,825 to 82 dispatches saves about 5 ms. The earlier
  idea that a fused engine would win 100 ms from fewer dispatches was wrong.
  Whether a hand-written engine is faster now depends on kernel throughput,
  which N5.3 measures before any kernel is written.
- **A hand-written engine is worth building (N5.3, measured).** The Denoiser
  engine's conv kernel runs all of HaloRT's 3×3 convs (95 % of its arithmetic)
  in 19.2 ms at 512² for six passes in fp16, against ONNX Runtime's 135 ms for
  the whole network. Estimate for the full network: 25–35 ms; at 256² with
  four passes (grey albedo), 7–9 ms. Full resolution is 77.5 % of the work.
- The parity fixture and a NumPy reference that matches ONNX to 1.5e-6 exist
  (N5.4, N5.5); every kernel is checked against its per-layer dumps.
- Our own feature pass works on the Disney cloud (N2a, N2b), and the authors'
  network lights it from our features (N3a): about 180 ms per frame at 512²
  through plain ONNX Runtime.

## Landed (newest first)

| When | What | Where |
| --- | --- | --- |
| 2026-11-24 | N5.3–N5.5: kernel throughput measured, parity fixture, NumPy reference | `work/logs/N5.md`, `work/logs/N5-4.md`, `work/logs/N5-5.md` |
| 2026-11-24 | N3a: first neural-lit picture from our features | `work/captures/N3a/sheet.jpg` |
| 2026-11-24 | N5-0, N5.1, N5.2: engine design note, dispatch probe (negative), weight converter | `docs/neural/ENGINE.md`, `work/logs/N5.md`, `work/logs/N5-2.md` |
| 2026-11-24 | N2b: feature pass complete (14 channels, packed) | `work/captures/N2b/view.jpg` |
| 2026-11-24 | N1, N1b: demo timed, frame split measured | `work/logs/N1.md` |
| 2026-11-24 | N2a: feature pass, optical depth and crossings, lab page `/neural/` | `work/captures/N2a/view.jpg`, `work/logs/N2a.md` |
| 2026-11-23 | N0: 50 reference notes, field summary, HaloRT anatomy, plan | `docs/research/neural/`, `docs/neural/PLAN.md` |
