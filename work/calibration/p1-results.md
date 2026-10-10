# P1 blind judging (2026-10-10): typeFromScale on vs off

Judges: Opus (`p1-judge-opus.md`), Fable (`p1-judge-fable.md`); key `p1-key.json`. "After" = `s.typeFromScale=1` (dense regions can't go wispy); "before" = shipped Nubis sampler.

| Pair | Opus | Fable |
|---|---|---|
| Frog photo (p01 after / p10 before) | after, clearly (p10 pumice pits) | after, clearly |
| CloudPack 02 detail (p02 / p04) | after, slight | after |
| CloudPack 02 photo (p05 / p03) | tie | after, by a hair |
| Parkouring photo (p11 / p06) | after, slight | after, by a hair |
| R1 closed c39 detail (p08 / p07) | after, clearly | **before** (crisper cavity rim) |
| Parkouring detail (p12 / p09) | after, slight | after, by a hair |

Result: after wins or ties in 11 of 12 verdicts; the change is clear on dense, crisp clouds and small elsewhere. Default switched to `typeFromScale: 1` (orchestrator, 2026-10-10); `0` restores the shipped sampler. Both judges: filling pits gives smooth faces, not cauliflower; shared gaps remain (sky-blue shadows, no crisp crust over a darker interior, opaque thin edges, dither grain in thin parts, satellites without connective tissue).
