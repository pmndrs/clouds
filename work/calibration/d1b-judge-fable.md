# D1b blind judge — Fable (2026-10-10)

Method: `work/calibration/rubric.md` "Judging method". Set: `scratchpad/blind-d1b/` (d01–d12 full frames, c01–c24 crops). Key not opened. Judged at native resolution, with extra 2x nearest-neighbour side-by-side strips of sub-regions (ref | A | B) built with PIL, plus a per-image Laplacian high-frequency measure (`hf`) to back the grain calls.

Scores are 1–10 for match to the reference on (1) surface, (2) shading, (3) colour, (4) edges, (5) overall "same cloud, same engine".

## Grouping

Crops grouped by dimension (three of each); full frames grouped by cloud and camera. Within each group the reference was picked as the odd one out: two of the three always share an identical sky/ground (same engine), the third has a different sky, a white haze band at the bottom and warmer colour.

| Framing | Ref | Render "W" | Render "G" | Crop regions |
|---|---|---|---|---|
| B — wide cumulus, left tail | d01 | d05 | d11 | R1 = c01 / c05 / c16 (top lumps + interior) |
| F1 — two-body cloud, close | d02 | d09 | d10 | R2 = c11 / c02 / c24 (left body top + puff); R7 = c21 / c09 / c10 (tower) |
| F2 — two-body cloud, far, sun glow | d04 | d07 | d03 | R3 = c06 / c03 / c13 (underside); R6 = c15 / c08 / c18 (tower) |
| C — tall tower | d12 | d08 | d06 | R4 = c14 / c04 / c19 (lower-right puff); R5 = c17 / c07 / c20 (shadow core); R8 = c12 / c22 / c23 (tower top) |

Our two renders are consistently recognisable as two looks:

- **W** — white, cool; shadows blue-grey; crisper lump silhouettes; visible dither/moiré stipple over the whole cloud in F1/F2 (hf 2–3x the reference: c02 0.0090, c09 0.0074, c08 0.0055, c03 0.0047 vs ref ~0.0031); stair-stepped edges; almost no dense shadow mass.
- **G** — neutral grey, slightly warm; smooth/smudged, low-pass surface (hf below the reference: c04 0.0013, c22 0.0022, c13 0.0026); shadow mass present and placed about right but darker and more neutral than the reference; soft clean edges; no fine structure.

Reference character for comparison: peach/pink lit faces, mauve-grey shade, nested small lumps inside big lumps, fine cotton-wool fibre visible at every zoom, dark creases between lumps, dense mauve-grey underside, crisp fibrous edges with small wisps.

## Whole-frame distance

| Framing | Ref | Winner at distance | W scores (s/sh/c/e/overall) | G scores |
|---|---|---|---|---|
| B (d01) | d01 | **d05 (W)**, narrow | 5/4/3/5/5 | 4/5/5/5/4 |
| F1 (d02) | d02 | **d09 (W)**, narrow | 5/4/3/5/5 | 4/5/5/5/4 |
| F2 (d04) | d04 | **d07 (W)** | 5/4/4/5/5 | 4/5/4/5/4 |
| C (d12) | d12 | tie, **d08 (W)** by a hair | 5/4/3/5/4 | 4/5/4/5/4 |

At whole-frame distance W reads closer because the lump structure is legible and the silhouettes have the reference's crispness; the grain is invisible at that scale. G reads as a dull grey, slightly out-of-focus version of the same shape. Neither has the reference's warm-light / mauve-shade hue split; W's shadows are blue, G's are grey. Both render the lit tops lighter than the reference (p50 luminance ~0.66–0.68 vs ref ~0.60) and W has the least shadow mass (d07's underside is white where d04's is mauve-grey).

## Detail crops (native resolution, 2x strips)

| Region | Ref | Winner up close | W scores | G scores | Notes |
|---|---|---|---|---|---|
| R1 — B top lumps + interior (c01) | c01 | **c16 (G)** | c05: 4/4/3/3/4 | c16: 4/5/6/5/5 | c05 top edge stair-stepped at 2x, blown white, blue-grey interior with a bright blotch (light leak) in the shadow. c16 colour and shadow softness closest of all crops; still no fibre, creases smudged. |
| R2 — F1 left body + puff (c11) | c11 | **c24 (G)** | c02: 2/4/3/3/3 | c24: 4/5/5/5/5 | c02 has a woven moiré stipple across the entire cloud and a cobalt shadow: a different engine at this scale. c24 smoother and warmer but creases between the lumps are gone. Both place the small puff lower/further out than the reference. |
| R7 — F1 tower (c21) | c21 | **c10 (G)**, narrow | c09: 3/4/2/3/3 | c10: 4/5/5/5/5 | c09: crisp lump shapes but dither grain, cobalt shadow, stepped edges. c10: smooth grey, shadow mass in the right place but darker and neutral, interior a bland gradient. Reference interior has nested lumps and fibre; neither has it. |
| R3 — F2 underside (c06) | c06 | **c13 (G)**, clear | c03: 3/2/4/4/3 | c13: 4/6/5/5/5 | The reference's underside is a dense mauve-grey band with ragged fibre. c03 is nearly white with no shadow mass at all plus grain. c13 has the band at the right place and depth but it is smooth and neutral grey. |
| R6 — F2 tower (c15) | c15 | **c18 (G)**, narrow | c08: 4/4/3/3/4 | c18: 4/4/5/5/5 | c08 has the best lump shapes of any crop but is covered in woven stipple, blue in shade, stepped at the edge, and grows an extra nub on the top. c18 keeps the lumps but blurred; its shaded right flank is a much darker grey smudge than the reference's light mauve. |
| R4 — C lower-right puff (c14) | c14 | **c19 (W)**, narrow; both poor | c19: 3/3/4/4/4 | c04: 2/3/4/4/3 | Reference puff is pink with defined fibrous lumps and a mauve crease. c04 is a flat beige blur (hf half the ref). c19 has a hint of surface but speckled edges. |
| R5 — C shadow core (c17) | c17 | **c20 (G)**, narrow | c07: 4/4/3/4/4 | c20: 3/5/5/4/5 | Reference is a smooth mauve-grey core with faint lumps. c07 is too light, blue-grey, fine grain. c20 is warm grey (closer hue) but darker and blotchy. |
| R8 — C tower top (c12) | c12 | tie (3/3); c23 by surface, c22 by edges | c23: 3/3/4/3/3 | c22: 2/3/4/5/3 | Both blow the lit top to flat white; the reference keeps peach fibre, creases and lumps there. c22 has zero surface; c23 has faint lumps but a stippled edge visible at 2x. The worst region for both looks. |

Crop tally: G wins 5 of 8 regions, W wins 1 (R4, both poor), 2 ties/near-ties (R8, and R6 is close). Average overall score up close: W 3.5, G 4.5. At distance: W 4.75, G 4.0.

So, as the owner reports, the winner flips with scale: W at distance (structure, crispness), G up close (colour, edges, no grain). Neither is above 6 on any axis in any crop.

## Main remaining differences (both looks)

1. **Colour split.** The reference has warm peach/pink lit faces and mauve-grey shade. W is cool white with blue shadows; G is neutral grey throughout. Neither has the hue separation between light and shade — that is the single most "different engine" tell up close.
2. **Fine surface.** The reference shows nested small lumps and fine cotton fibre at every zoom. W replaces it with a dither/moiré stipple (sampling pattern, strongest in F1/F2 where hf is 2–3x the reference) that reads as noise, not fibre. G is low-passed: no fibre, no small lumps, smudged creases (hf below the reference).
3. **Shadow mass.** W has almost none — the F2 underside (c03) is white where the reference is a dense mauve band. G has the mass in the right places but too dark, too neutral and blotchy (c18 right flank, c20 core, c13 band).
4. **Edges.** W edges are stair-stepped/stippled at 2x (c05, c09, c23, c08). G edges are soft and clean but featureless. The reference edge is crisp with small wisps and fibre.
5. **Lit tops blow out.** Both looks render the sunlit tower tops as flat white (c22/c23, c05 top). The reference keeps texture and creases in the brightest regions — exposure/tonemap headroom, not just shading.
6. **Shape.** Minor but visible: W grows extra nubs (c08 tower top), and both place the small puffs in F1/C slightly differently from the reference.

## Caveats

- Reference identification relied on the odd-sky-out rule; it was unambiguous in all 12 groups, but if the renders were given different skies per look this would be wrong.
- hf numbers include sky area and JPEG noise; they are used only to confirm what was visible in the 2x strips, not as scores.
