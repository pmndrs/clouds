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
| N2 | Our feature pass | **done** 2026-11-24 (parity sheet N2d) |
| N3 | Their network on our features | **first picture done** (N3a) |
| N4 | Time of day | not started |
| N5 | Our own engine | **network done and verified** (N5.10); live-page wiring N5.12 next |
| N6 | Into the cloud library | not started |
| N7 | Speed and tuning | not started |
| NT | Training foundation | not started; decide after N4 |

## Running

Nothing.

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
- **HaloRT runs on our own hand-written WGSL engine (N5.6–N5.10).** 88
  dispatches in one submit, batch of six. Output equals the authors' to 1.3e-6
  in fp32; fp16 cannot be told apart by eye. Network wall time on the M5 Pro:

  | | ONNX Runtime | ours fp32 | ours fp16 |
  | --- | --- | --- | --- |
  | 512², six passes | 135–180 ms | 36.1 ms | 23.2 ms |
  | 256², six passes | ~40 ms | 12.9 ms | 8.5 ms |

  No tuning has been done. Not yet on the live page: the blend runs on the CPU
  in the test page, and `/neural/` still uses ONNX Runtime (N5.12).
- Features match the authors' for matched settings (N2d).
- Our own feature pass works on the Disney cloud (N2a, N2b), and the authors'
  network lights it from our features (N3a): about 180 ms per frame at 512²
  through plain ONNX Runtime.

## Landed (newest first)

| When | What | Where |
| --- | --- | --- |
| 2026-11-24 | N5.6–N5.10: HaloRT on our WGSL engine, verified end to end, 23 ms at 512² fp16 | `work/captures/N5-10/sheet.jpg`, `work/logs/N5-10.md` |
| 2026-11-24 | N2d: feature parity sheet | `work/captures/N2d/parity.jpg` |
| 2026-11-24 | N5.3–N5.5: kernel throughput measured, parity fixture, NumPy reference | `work/logs/N5.md`, `work/logs/N5-4.md`, `work/logs/N5-5.md` |
| 2026-11-24 | N3a: first neural-lit picture from our features | `work/captures/N3a/sheet.jpg` |
| 2026-11-24 | N5-0, N5.1, N5.2: engine design note, dispatch probe (negative), weight converter | `docs/neural/ENGINE.md`, `work/logs/N5.md`, `work/logs/N5-2.md` |
| 2026-11-24 | N2b: feature pass complete (14 channels, packed) | `work/captures/N2b/view.jpg` |
| 2026-11-24 | N1, N1b: demo timed, frame split measured | `work/logs/N1.md` |
| 2026-11-24 | N2a: feature pass, optical depth and crossings, lab page `/neural/` | `work/captures/N2a/view.jpg`, `work/logs/N2a.md` |
| 2026-11-23 | N0: 50 reference notes, field summary, HaloRT anatomy, plan | `docs/research/neural/`, `docs/neural/PLAN.md` |
