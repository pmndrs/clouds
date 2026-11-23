# Neural clouds — status

One page for the neural track: what is running, what waits on the owner, what
landed. Plan: `docs/neural/PLAN.md`. Differences from the source:
`work/neural/DIVERGES.md`. Research: `docs/research/neural/README.md`.
Page: https://claude.ai/artifact/VSCDDPexFVSkSRHBub293d (source `work/neural/compass/index.html`;
edit it directly and republish to the same URL).

Agents: read the plan's Protections before starting. Append to
`work/logs/N<phase>-<task>.md`; update the table below when a task changes
state.

_Last updated 2026-11-23._

## Waiting on you

| What | Recommendation | Where |
| --- | --- | --- |
| D1 how the network runs | ONNX Runtime first, hand-written WGSL later | PLAN § D1 |
| D2 where engine work lives | extend the Denoiser engine (needed at N5) | PLAN § D2 |
| D3 training | none through N4, decide after | PLAN § D3 |
| D4 parity reference | authors' browser demo | PLAN § D4 |
| Go-ahead to start N1 | — | — |

## Phases

| Phase | What | State |
| --- | --- | --- |
| N0 | Research and plan | **done** 2026-11-23 |
| N1 | Their demo on our bench, with timings | not started |
| N2 | Our feature pass | not started |
| N3 | Their network on our features | not started |
| N4 | Time of day | not started |
| N5 | Our own engine | not started; needs D1, D2 |
| N6 | Into the cloud library | not started |
| N7 | Speed and tuning | not started |
| NT | Training foundation | not started; needs D3 |

## Running

Nothing.

## Known so far

- Stock HaloRT in the authors' browser demo on this Mac: 47–55 ms per frame
  at 256², 170–210 ms at 512² (whole frame, features and network not split).
- The released code differs from the paper in several feature encodings; the
  port follows the code. See DIVERGES N-S1 to N-S5.
- Training code is not public.

## Landed (newest first)

| When | What | Where |
| --- | --- | --- |
| 2026-11-23 | N0: 50 reference notes, field summary, HaloRT anatomy, plan | `docs/research/neural/`, `docs/neural/PLAN.md` |
