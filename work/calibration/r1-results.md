# R1 blind judging (2026-10-10): foam vs vapour variants

Judges: Opus (`r1-judge-opus.md`) and Fable (`r1-judge-fable.md`), rubric v2. Key: `r1-key.json`. Variants: A-render = quality ultra + `mipDistanceScale 0.001` + `deepAttenuation 0.15` on the original data; B-form = converter closing at 32 m (`--close 32 --scale hconst:1 --depth-shift 0`) at C1 render settings; C-both = B-form + A-render.

| Cloud | Variant | id | Opus overall / material / cohesion | Fable overall / material / cohesion |
|---|---|---|---|---|
| EmberGen 02 (c94) | original | r14 | 3 / 5 / 6 | 3 / 5 / 6 |
| | A-render | r60 | **5** / 6 / 6 | 4 / 5 / 6 |
| | B-form | r80 | 4 / 4 / 6 | 4 / 4 / 7 |
| | C-both | r63 | **5** / 5 / 6 | **5** / 3 / 7 |
| A2 lens-seed wide (c39) | original | r18 | 2 / 4 / 4 | 4 / 4 / 5 |
| | A-render | r79 | 3 / 4 / 4 | 5 / 4 / 5 |
| | B-form | r48 | 3 / 3 / 7 | 4 / 3 / 7 |
| | C-both | r81 | **4** / 5 / 7 | **6** / 5 / 7 |
| Parkouring (c55) | original | r16 | 2 / 4 / 3 | 4 / 6 / 4 |
| | A-render | r62 | **3** / 5 / 3 | 4 / 4 / 4 |

Both judges: **C-both is the best variant of each cloud** (+1 to +2 overall over the original); the sharper render beats the soft one in every pair; closing fixes cohesion (6–7) but on its own trades material for structure (marshmallow, sponge, whipped cream). **Material caps the whole set at about 5.** Remaining gap, both judges: no thin bright lit crust over a slightly darker lit interior; thin edges don't fade translucent to sky; every shadow and cavity is sky-blue where the photos' bellies are neutral grey, often one smooth grey belly sheet. Fable's suggestion: r81's recipe (smooth large envelope carrying fine grain with real crevices) with grain damped on the belly and thin-edge density allowed to go translucent.
