# Calibration round 1 results (2026-10-10)

Nine renders, scored blind by the owner (review page https://claude.ai/artifact/1oZ29NEwszTYT5qquMqSKS, collection `scores`), Opus (`judge-opus.md`) and Fable (`judge-fable.md`). Key: `key.json`.

| id | Source | Owner | Fable | Opus | Owner's note (short) |
|---|---|---|---|---|---|
| c94 | EmberGen 02 | **8** | 6 | 5 | best of the lot; some foam feel but cohesive |
| c42 | EmberGen 08 | **7** | 5 | 3 | fun shape, ok bottoms, starting to come together |
| c51 | our generated (open water) | **7** | 2 | 2 | good vibe, a bit egg-like, odd jump at the bottom; shading and edges ok |
| c15 | EmberGen 03 | 6 | 5 | 4 | blobs don't blend; harsh falloff between them; bottom protrusions where real bottoms go loose |
| c52 | EmberGen 09 | 6 | 3 | 3 | shape fine, lost cohesion |
| c61 | EmberGen 10 | 6 | 5 | 3 | fun grouping, inner detail lost, "foam world" |
| c39 | A2 lens-seed "wide" | 4 | 3 | 3 | good silhouette and bottoms, shaving-foam effect, no inner ridges |
| c54 | A2 lens-seed "base" | 4 | 4 | 4 | shapes right but not blending |
| c55 | Parkouring (Nubis pack) | 4 | 4 | 3 | surface way too softened |

Agreement with the owner's overall scores (Spearman rank correlation, n = 9):
- **Fable 0.38** (0.74 without c51), mean |difference| 1.7
- **Opus 0.04** (0.30 without c51), mean |difference| 2.4
- Opus vs Fable 0.70

Findings:
- **Fable tracks the owner much better than Opus.** Both judges score about 2 points harsher overall.
- **Both judges missed the owner's main axis:** material and cohesion. The owner reads most renders as shaving foam or liquid: lobes don't blend into each other, falloff between blobs is harsh, and there is no low-density connective tissue binding the forms. The judges' rubric rewarded lobe hierarchy and penalised the smooth generated cloud (c51), which the owner rated 7 for its cohesive, soft material.
- **Owner's hypothesis to test:** the foam look may come from how we render (density-to-opacity mapping, extinction, the N3 sharpening pow, the converter's plateau density), not only from the forms.

Owner's response: their own scores were forgiving (judged against what they had seen, no fixed idea of a 10); they prefer the harsher judging and find both judges useful, Opus more technical and Fable more polished. **Both judges score every look acceptance for now**, with the owner as final judge.

Next: rubric v2 adds Realism (does it read as a real cloud form at all), Material (vapour vs foam/liquid/cotton) and Cohesion (connective low density binding the lobes). Fable judges look acceptance; Opus builds.
