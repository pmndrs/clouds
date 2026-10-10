# D1c blind judge: Fable (2026-10-10)

Blind set `scratchpad/blind-d1c/` (d01–d12 full frames, c01–c24 crops). Method per `rubric.md` "Judging method": whole frames, then zoomed regions at native resolution (I also cut my own 1:1 zooms from the full frames to verify which crop belongs to which frame). Key not opened.

Scores 1–10 are match-to-reference, not beauty. Criteria: (1) surface = lumps, creases, grain/pits/fibre/flecks; (2) shading = where light and shade fall, smudges/dark bands, shade-mass darkness; (3) colour; (4) edges; (5) overall "same cloud, same engine".

## Grouping and reference guesses

| Framing | Images | Reference guess | Why |
|---|---|---|---|
| A tower, grey sky | d01, d07, d11 | **d11** | warm peach lit faces, mauve shade, fibrous fine detail, no grain, no hard artefacts; d01/d07 share an identical sky gradient |
| B wide, white haze below | d02, d08, d12 | **d02** | teal sky, no sun glare, dark flat base band, soft fibrous detail; d08/d12 share the top-left glare |
| C wide, blue sky | d03, d04, d06 | **d03** | same as B: soft, fibrous, warm-white, no glare; d04/d06 share the top-right glare |
| D puff, grey sky | d05, d09, d10 | **d05** | warm pink light, mauve shade, crisp creases; d09/d10 share the sky |

The two renders split consistently into two looks across all four framings:

- **Look S (smooth)**: d01, d08, d06, d09. Low-pass, creamy, no grain; occasional hard artefacts (d01 dark vertical seam lower right; d09 glassy bright flake at the right flank; d08 brown flat plateau with an inner contour on the tower's shaded flank).
- **Look G (grainy)**: d07, d12, d04, d10. Stochastic stipple/dither over the whole surface and along the edges (worst on d04, where it forms a moiré); whiter and colder; lighter shade mass.

Crop regions (by pixel size) and their frames:

| Region | Crops | Framing | ref | S | G |
|---|---|---|---|---|---|
| A1 left lobe + bottom-left wisp (1120x680) | c02, c09, c12 | A | c09 | c12 | c02 |
| A2 shaded right flank (1400x600) | c03, c22, c23 | A | c03 | c23 | c22 |
| B1 right tower (960x1120) | c05, c13, c20 | B | c13 | c20 | c05 |
| B2 base / underside (1800x600) | c15, c19, c24 | B | c24 | c15 | c19 |
| C1 left dome (1000x660) | c01, c10, c16 | C | c10 | c16 | c01 |
| C2 right tower (800x1040) | c04, c07, c17 | C | c07 | c17 | c04 |
| D1 top crust (1400x1000) | c11, c14, c21 | D | c14 | c11 | c21 |
| D2 left lobe + top (1400x900) | c06, c08, c18 | D | c18 | c08 | c06 |

## Distance (whole frames)

Scores: surface / shading / colour / edges / overall.

### Framing A (ref d11)
- **d01 (S): 4 / 5 / 4 / 5 / 5 — winner (narrow).** Shade mass sits in the right place and is dark enough; silhouette matches well. But the interior is washed out (no creases inside the lobes), the lit faces are neutral white instead of peach, and there is a hard dark seam with a stair-stepped bright rim on the lower-right flank that no engine frame would show.
- **d07 (G): 4 / 4 / 4 / 4 / 4.** Puffier and cleaner-looking than d01 at arm's length, but the shade mass is too light and flat (the ref's big mauve shadow half is mostly gone), the whole cloud is cooler, and the outline is frizzy with stipple.

### Framing B (ref d02)
- **d08 (S): 4 / 5 / 5 / 5 / 5 — winner.** Lobe placement and silhouette match closely; shade falls roughly where the ref puts it. Misses: the dark flat base band of the ref is almost absent (the underside is a uniform cream), the tower's shaded flank is a brown flat plateau, and everything is softer than the ref.
- **d12 (G): 4 / 4 / 4 / 4 / 4.** Lumps are more legible than d08 but the stipple reads as noise; blue-grey shade pockets are too contrasty and too cold; base too light; edges frizzy.

### Framing C (ref d03)
- **d06 (S): 4 / 5 / 5 / 5 / 5 — winner.** Good silhouette and shade placement; colour closest of the two (still greyer/cooler than the ref's warm white). Interior creases gone; looks like the ref blurred.
- **d04 (G): 3 / 4 / 3 / 3 / 3.** The dither is visible even at frame scale as a moiré over the lit faces; the cloud is bright white with blue shade (ref is warm white with grey-mauve shade); edges frizzy. Worst frame of the twelve.

### Framing D (ref d05)
- **d09 (S): 4 / 5 / 4 / 5 / 4 — winner (narrow).** Shade mass present (dark central belly), silhouette matches, lower wisps soft like the ref. Hard glassy flake on the right flank and a smooth, featureless crust.
- **d10 (G): 4 / 4 / 4 / 4 / 4.** Crust lumps slightly more defined than d09, but grainy, shade lighter and flatter, colour cold grey.

Distance verdict: Look S wins all four framings, clearly in B and C, narrowly in A and D (and only because its shade masses are darker and better placed; its artefacts would lose it D if the ref were not so soft). Neither look passes as the same engine: 4–5 overall.

## Close-up (crops)

Scores: surface / shading / colour / edges / overall.

### A1 left lobe + wisp (ref c09)
- c12 (S): 3 / 4 / 3 / 4 / 3 — winner (marginal). The lobe is a featureless soft blob with a dark band under it; silhouette of the wisp roughly right; grey where the ref is peach/mauve.
- c02 (G): 3 / 3 / 3 / 4 / 3. Stipple across the lit face, lighting almost uniform (no mauve shade on the far side), outline fuzzed by grain.
- Ref has a fibrous, streaky crust with small crisp bumps; neither render has anything at that scale.

### A2 shaded right flank (ref c03)
- c22 (G): 3 / 4 / 3 / 3 / 3 — winner (marginal).
- c23 (S): 3 / 4 / 4 / 3 / 3. Smoother shade gradient and closer tone, but a hard dark crack and a stair-stepped bright rim at the top right; this is the artefact most unlike an engine frame in the whole set.
- Ref: smooth mauve gradient broken by fine fibrous streaks and small pink-lit crests. c22 replaces the fibre with stipple; c23 replaces it with nothing.

### B1 right tower (ref c13)
- c20 (S): 4 / 4 / 4 / 5 / 4 — winner (marginal, on edges). Lobe stack matches; crust soft-edged like the ref. The right flank is a brown flat plateau with an inner contour line, where the ref has a graded grey with small shadowed pits.
- c05 (G): 4 / 4 / 4 / 3 / 4. More lump definition than c20 but under a heavy stipple; edges frizzy; too white, shade too blue.

### B2 base (ref c24)
- c15 (S): 3 / 3 / 4 / 4 / 3 — winner.
- c19 (G): 3 / 3 / 3 / 3 / 3.
- Both miss the ref's defining feature here: a dark, flat, smoothly graded base band under the whole cloud. Ours are light cream (c15) or grainy white (c19) all the way to the bottom edge.

### C1 left dome (ref c10)
- c16 (S): 4 / 4 / 4 / 4 / 4 — winner.
- c01 (G): 3 / 4 / 3 / 3 / 3. Dense dither/moiré over the dome and a satellite blob with a frizzy outline.
- Ref dome has a soft but legible crust of small bumps and a clean shade mass to the right; c16 is the dome out of focus, c01 is the dome under noise.

### C2 right tower (ref c07)
- c17 (S): 4 / 4 / 4 / 5 / 4 — winner (marginal).
- c04 (G): 4 / 4 / 3 / 3 / 4. Lump hierarchy actually slightly closer to the ref than c17, but blue shade, stipple and frizzy edges.

### D1 top crust (ref c14)
- c21 (G): 4 / 4 / 4 / 4 / 4 — winner.
- c11 (S): 3 / 4 / 4 / 4 / 3. Glassy, featureless crust plus the bright flake artefact at the right; the dark central shade is close in placement.
- Ref: crust of small lumps with internal creases and shade pockets. c21 keeps the small bumps along the top edge and the shade pockets under the grain; c11 loses them.

### D2 left lobe + top (ref c18)
- c06 (G): 4 / 4 / 3 / 4 / 4 — winner.
- c08 (S): 3 / 4 / 4 / 4 / 3. Smooth and featureless with a dark cavity; the bulges along the lobe are there in outline only.

Close-up verdict: mixed. Look S wins B1, B2, C1, C2 and A1 (all marginal except B2/C1); Look G wins D1, D2 and A2. Where the ref's surface is the question (D crops, A2), G is closer because some lump/crease structure survives under the grain; where the shade mass and edge softness are the question (B, C), S is closer. Nothing scores above 4 up close.

## Main remaining differences (both looks)

1. **Surface at the mid/fine scale.** The reference crust is lumps with crisp creases and a fibrous, streaky micro-texture (visible in c03, c09, c13, c14). Look S is a low-pass of that (cotton / shaving foam, no creases). Look G substitutes stochastic stipple for the fibre; it reads as film grain or an unresolved dither, not as cloud texture, and it fuzzes every edge. Neither has detail of the right kind at the right scale.
2. **Colour.** Reference lit faces are warm peach/pink with a mauve to blue-grey shade. Look G is cold white with blue shade (worst in C); Look S is neutral grey-white, with a brown cast in d08's shade. This is the most obvious tell at distance.
3. **Shade mass.** Reference shade is large, fairly dark, and smoothly graded with soft smudge bands (c03, c24). Look G's shade is too light and flat. Look S gets the darkness roughly right but breaks it with hard-edged plateaus and seams (d01 crack, d08 brown plateau with a contour line, d09 glassy flake).
4. **Base band (B).** The reference has a dark flat underside band along the whole base; ours are light to the bottom edge.
5. **Edges.** Reference edges are soft but defined, with tiny bumps and thin wisps. Look G edges are frizzy with grain; Look S edges are blobby/melted, and satellites and wisps are featureless blobs in both.
6. **Hard artefacts (S only).** Dark vertical seam with stair-stepped rim (d01/c23), bright glassy flake (d09/c11), flat brown plateau (d08/c20). These are the first thing a viewer would flag as "not the same engine".
