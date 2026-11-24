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
| N2 | Our feature pass | **running** (N2a done, N2b running) |
| N3 | Their network on our features | not started |
| N4 | Time of day | not started |
| N5 | Our own engine | design note running (N5-0); moved up, see Known so far |
| N6 | Into the cloud library | not started |
| N7 | Speed and tuning | not started |
| NT | Training foundation | not started; decide after N4 |

## Running

N2b (Opus) and N5-0 (Opus, design only), started 2026-11-24.

## Known so far

- Stock HaloRT in the authors' browser demo on this Mac: 47–55 ms per frame
  at 256², 170–210 ms at 512² (whole frame, features and network not split).
- The released code differs from the paper in several feature encodings; the
  port follows the code. See DIVERGES N-S1 to N-S5.
- Training code is not public.
- **Where the frame goes (N1, N1b; M5 Pro, 512², fp16, authors' demo):** features
  6.5 ms, network 135 ms of wall time, of which only 33 ms shows as GPU shader
  time. The other ~100 ms scales with the 1,825 dispatches ONNX Runtime issues
  per frame. A hand-written engine with fused layers and the six passes
  batched is therefore the main speed lever, so N5 starts after N3, before N4.
- Our own feature pass (first half) works on the Disney cloud (N2a).

## Landed (newest first)

| When | What | Where |
| --- | --- | --- |
| 2026-11-24 | N1, N1b: demo timed, frame split measured | `work/logs/N1.md` |
| 2026-11-24 | N2a: feature pass, optical depth and crossings, lab page `/neural/` | `work/captures/N2a/view.jpg`, `work/logs/N2a.md` |
| 2026-11-23 | N0: 50 reference notes, field summary, HaloRT anatomy, plan | `docs/research/neural/`, `docs/neural/PLAN.md` |
