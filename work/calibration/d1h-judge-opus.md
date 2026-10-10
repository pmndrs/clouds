# D1 blind set h: Opus judge

Judged blind: no key file, no D1 report and no earlier judge files were opened. Method follows `work/calibration/rubric.md`. I grouped the frames, picked the reference in each group and template-matched the crops to their frames (NCC, `python3 -I`; every crop matched at NCC 0.994 to 1.000). Each crop is a native-resolution, 2× crop of a 1920×1080 frame region. I looked at every crop natively, then at 1:1 sub-crops of the lit crests, shade faces, silhouettes, creases and trunk. Band statistics were computed last, only as a cross-check.

Coordinates: frame coordinates (fx, fy) are in the 1920×1080 frame. Crop coordinates (cx, cy) are in the crop's own pixels.

## Grouping and references

| Framing | Frames | Reference | Why |
|---|---|---|---|
| A: wide cloud, tower on the right | d01, d03, d09 | **d03** | Teal sky. The cloud is pink-white, and its lit crests carry fine floret grain. The belly is dark and flat. |
| B: same cloud seen closer, tower on the right | d05, d11, d12 | **d12** | Teal sky, pink-white cloud with floret grain. The cloud's placement and scale differ from both renders (left edge at fx 265 vs 180). |
| C: tall tower | d02, d04, d06 | **d02** | Faint radial streaks in the sky (light shafts or compression). The cloud is salmon-pink and backlit-even, with soft fuzzy edges. |
| D: wide flat-topped cloud | d07, d08, d10 | **d07** | The same sky streaks and salmon tone. The tail extends further right (to fx 1515) than in either render. |

Crop map (region: reference / render / render):

- R1, A belly and base (fx 300-1200, fy 560-860): c02 ref, c14 = d01, c01 = d09
- R2, A cleft between body and tower (fx 820-1040, fy 540-700): c16 ref, c29 = d01, c25 = d09
- R3, A tower (fx 1100-1580, fy 148-708): c22 ref, c13 = d01, c09 = d09
- R4, B left lobe (fx 350-850, fy 332-660): c06 ref, c10 = d05, c23 = d11
- R5, B tower (fx 1150-1550, fy 180-700): c27 ref, c24 = d05, c12 = d11
- R6, B tower shade close-up (fx 1200-1400, fy 300-500): c30 ref, c15 = d05, c11 = d11
- R7, C tower top (fx 500-1200, fy 100-548): c05 ref, c28 = d04, c26 = d06
- R8, C trunk (fx 650-1350, fy 600-900): c03 ref, c21 = d04, c32 = d06
- R9, C trunk close-up (fx 960-1260, fy 620-920): c08 ref, c33 = d04, c04 = d06
- R10, D left tail (fx 40-600, fy 520-860): c17 ref, c07 = d08, c18 = d10
- R11, D core and crest (fx 560-1260, fy 180-680): c20 ref, c19 = d08, c31 = d10

Because the reference cloud sits differently in the frame, the crops in A, B and D do not cover identical content. I judged character, not pixel alignment.

## Winners and full-frame scores (1-10, harsh)

| Framing | Image | Surface | Shading | Colour | Edges | Overall | Closer at distance | Closer up close |
|---|---|---|---|---|---|---|---|---|
| A | d01 | 2 | 3 | 4 | 4 | 3 | | |
| A | **d09** | 3 | 3 | 4 | 4 | **4** | **d09** (narrowly) | **d09** |
| B | d05 | 2 | 3 | 4 | 4 | 3 | | |
| B | **d11** | 4 | 4 | 5 | 4 | **4** | **d11** | **d11** |
| C | d04 | 2 | 3 | 3 | 4 | 2 | | |
| C | **d06** | 3 | 3 | 3 | 4 | **3** | **d06** (near tie; d04's extra flank lumps read busier, like the ref's mottle) | **d06** |
| D | d08 | 2 | 4 | 3 | 3 | 2 | | |
| D | **d10** | 3 | 4 | 3 | 3 | **3** | **d10** | **d10** (but d08 wins the tail crop, R10) |

The same variant wins all four framings. d09, d11, d06 and d10 behave as one variant: smoother, with fewer hard artefacts. d01, d05, d04 and d08 behave as the other: more whorls, discs, slits and glows. No render reaches "same cloud, same engine". The best overall score is 4.

## Crop scores (surface / shading / colour / edges / overall)

| Region | Render | S | Sh | C | E | O | Notes |
|---|---|---|---|---|---|---|---|
| R1 | c14 (d01) | 2 | 3 | 4 | 4 | 3 | Contour-grain whorl patch at cx 1190-1370, cy 0-130. White flecks at cx 278, cy 270 and cx 323, cy 245. The belly is light with no dark underside. |
| R1 | c01 (d09) | 3 | 3 | 4 | 4 | 3 | Faceted, polygon-edged lumps at cx 1600-1800, cy 50-250. Belly as light as c14. Mid-body smeared. |
| R2 | c29 (d01) | 1 | 3 | 4 | 3 | 2 | Striated fingerprint whorl at cx 140-330, cy 30-190, the worst single artefact in A. |
| R2 | c25 (d09) | 3 | 3 | 4 | 3 | 3 | Flat glowing facet with an angular outline at cx 150-330, cy 0-140, slightly yellow. No grain. |
| R3 | c13 (d01) | 2 | 3 | 4 | 3 | 3 | Lit face is smooth foam with no florets. Disc lumps on the shade side at cx 520-730, cy 550-910. Dark brown smudge at the tower foot, cx 543-617, cy 910-985. Detached fleck at the top, cx 490-510, cy 170-210. |
| R3 | c09 (d09) | 2 | 3 | 4 | 2 | 2 | Same discs at cx 550-750, cy 550-900. Smudge at cx 666-724, cy 870-985. The lit face is flatter and the silhouette blurrier than c13's. |
| R4 | c10 (d05) | 2 | 4 | 3 | 4 | 3 | Fingerprint whorl at cx 870-1000, cy 340-570. Cloud is cool grey rather than pink. |
| R4 | c23 (d11) | 4 | 4 | 4 | 4 | 4 | Bright facet in a crevice at cx 690-760, cy 380-430. Small bright blob at cx 600-640, cy 580-620. Otherwise clean. |
| R5 | c24 (d05) | 2 | 3 | 3 | 4 | 2 | A field of circular disc blotches over the tower's shade face, cx 40-405, cy 280-610. The shade face is too dark. Fleck at cx 330, cy 65. |
| R5 | c12 (d11) | 4 | 4 | 4 | 4 | 4 | Softer disc ghosts at cx 105-325, cy 340-590. Warm glow patch at cx 240-275, cy 610-650. |
| R6 | c15 (d05) | 1 | 2 | 3 | – | 2 | Overlapping dark discs at cx 20-240, cy 190-380. Mean level 153 against the ref's 175. Blue-grey. |
| R6 | c11 (d11) | 3 | 4 | 4 | – | 4 | Faint bright-rimmed rings at cx 220-330, cy 90-200. Level and tone close to the ref. |
| R7 | c28 (d04) | 2 | 3 | 2 | 3 | 2 | Lit top blown to featureless white; the ref is pink and mottled. Disc-rimmed lumps on the right flank, cx 1140-1400, cy 550-885. Silhouette harder and cleaner than the ref's soft fuzzy edge. |
| R7 | c26 (d06) | 3 | 3 | 2 | 3 | 3 | Same blown white top. Flank lumps are softer. |
| R8 | c21 (d04) | 2 | 3 | 3 | 3 | 2 | Dark vertical slit at cx 945-960, cy 232-412. Crescent glow at cx 860-900, cy 190-280 inside a dark pocket (cx 770-900). Round pit at cx 500-560, cy 180-250. Torn, serrated bright wisps at the right edge, cx 1110-1290, cy 0-270. |
| R8 | c32 (d06) | 3 | 3 | 3 | 3 | 3 | Dark oval pit at cx 930-960, cy 308-378. Depression at cx 540-620, cy 190-300. Same torn right-edge wisps. |
| R9 | c33 (d04) | 1 | 2 | 3 | 3 | 2 | Slit at cx 325-340, cy 230-400. Crescent ring at cx 230-290, cy 160-240. Clay-like folds: 4-12 px band 2.58 against the ref's 1.04. |
| R9 | c04 (d06) | 3 | 3 | 3 | 3 | 3 | Oval pit at cx 310-340, cy 260-350. Otherwise too much fold contrast (band 2.41 against 1.04). |
| R10 | c07 (d08) | 2 | 3 | 3 | 3 | 3 | Featureless beige blob, no internal shading. Pit at cx 650, cy 510. Edges defocused. |
| R10 | c18 (d10) | 2 | 3 | 3 | 2 | 2 | Same, and blurrier. |
| R11 | c19 (d08) | 2 | 4 | 3 | 3 | 2 | Warm glow disc at cx 800-920, cy 620-710. Lacy bright flecks at cx 640-800, cy 530-670. Crest lobes smooth, without the ref's grain. |
| R11 | c31 (d10) | 3 | 4 | 3 | 3 | 3 | Small bright flecks at cx 680-710, cy 620-670 and cx 890-930, cy 640-690. No glow disc. |

## Hard artefacts per full frame

- **d01**
  - Whorl/fingerprint grain in the cleft, fx 890-985, fy 555-635.
  - Fleck above the tower top, fx 1345-1355, fy 233-253.
  - Disc lumps on the tower shade side, fx 1360-1465, fy 423-603.
  - Dark smudge at the tower foot, fx 1371-1408, fy 603-640.
  - White flecks on the left belly, about fx 439-462, fy 682-695.
  - Smeared mid-body.
- **d09**
  - Faceted glowing patch in the cleft, fx 895-985, fy 540-610.
  - Polygon-faceted lumps, fx 1100-1200, fy 585-685.
  - Tower shade discs, fx 1375-1475, fy 423-598.
  - Dark smudge at the tower foot, fx 1433-1462, fy 583-640.
  - Blurry silhouette on the tower.
- **d05**
  - Disc field on the tower shade face, fx 1172-1355, fy 320-485, and darker still in the close-up crop.
  - Whorl/sparkle grain patch on the left lobe, fx 783-848, fy 502-617.
  - Fleck at the tower top, fx 1317, fy 212.
- **d11**
  - Soft disc ghosts on the tower, fx 1205-1315, fy 350-475.
  - Bright-rimmed rings, fx 1310-1365, fy 345-400.
  - Warm glow, fx 1272-1290, fy 485-505.
  - Bright facet in a crevice, fx 693-728, fy 522-547.
  - Bright blob, fx 648-668, fy 622-642.
- **d04**
  - Vertical dark slit in the trunk, fx 1122-1130, fy 735-820.
  - Crescent glow, fx 1075-1105, fy 700-740.
  - Round pit, fx 898-928, fy 690-725.
  - Disc-rimmed lumps on the right flank, fx 1070-1200, fy 375-542.
  - Torn, serrated bright wisps on the trunk's right edge, fx 1205-1295, fy 600-735.
  - Blown-out white tower top.
- **d06**
  - Dark oval pit/slit, fx 1115-1130, fy 750-795.
  - Dark depression, fx 922-962, fy 695-750.
  - The same torn right-edge wisps, fx 1200-1295, fy 600-740.
  - Blown-out white tower top.
- **d08**
  - Warm glow disc in the core, fx 960-1020, fy 490-535 (visible at full frame).
  - Lacy bright flecks, fx 880-960, fy 445-515.
  - Semi-transparent haze slab off the right shoulder, fx 1300-1440, fy 650-700.
  - Pit in the tail, fx 365, fy 775.
  - Defocused tail edges.
- **d10**
  - Bright flecks, fx 900-915, fy 490-515 and fx 1005-1025, fy 500-525.
  - The same haze slab, fx 1300-1440, fy 650-700.
  - Defocused, blurry tail edges.

The torn hole with a bright flake at fx about 1160-1200, fy 550-580 in D is also in the reference (c20, cx 1230-1310, cy 660-740). It belongs to the asset and is not counted as an artefact. In the renders its rim is harder.

## Main remaining differences, biggest first

1. **Lit-face surface.** Every reference lit crest carries fine floret or cauliflower grain: crisp sub-domes a few pixels across, with tiny shaded crevices. The renders' lit faces are smooth foam or plastic. In C (R7) the top is blown to featureless white. This shows at distance as well as up close.
2. **Tone and colour.** The references are warm pink or salmon, and the gap between lit and shade is small and even. The renders are neutral white over cool grey: lit tops are too bright and shade faces too cold and dark (d05's tower shade sits at 153 against the ref's 175). The skies also differ: A and B references are teal where the renders are royal blue, and C and D references are grey-blue where the renders have a purple gradient.
3. **Where the shade falls.**
   - A: the reference has a dark grey belly under a flat base and a light tower flank. The renders invert this, with a light belly and a dark, brown-smudged tower flank.
   - C and D: the renders' trunk and core crevices are clay folds, too contrasty (the 4-12 px band is twice the ref's in R9). The references have soft, low-contrast mottle.
4. **Hard artefacts.** Disc and ring fields on shade faces (B tower, A tower, C flank). Whorl or fingerprint grain patches (d01 cleft, d05 lobe). Slits, pits and crescents in the C trunk. Warm glow discs and lacy flecks (d08 core). Faceted flat patches (d09).
5. **Edges.**
   - A and B: the reference lit crests are crisp with small knobbly bumps; the renders' outlines are smooth wavy curves and slightly soft.
   - D tail: the reference is fragmented and fluffy, while the renders are defocused blobs.
   - C: the reverse holds. The reference edge is softer and fuzzier than the renders'.
   - C trunk: the renders add torn, serrated bright wisps that the reference does not have.
6. **Framing.** In B and D the reference cloud's placement and scale differ from the renders' (B is shifted by about 85 px and scaled; D's tail is longer in the ref). In A there is a small vertical offset. This makes region-for-region comparison loose.

## Pixel cross-check (after the visual pass)

Absolute band std of luminance over each whole crop. Columns are the 1-3, 4-12 and 12-32 px bands.

| Region | Ref | Render (variant 1) | Render (variant 2) |
|---|---|---|---|
| R1 | c02: 0.64 / 1.98 / 3.97 | c14: 0.76 / 1.76 / 3.31 | c01: 0.76 / 1.71 / 3.35 |
| R2 | c16: 0.89 / 2.83 / 4.95 | c29: 0.72 / 1.77 / 3.33 | c25: 0.71 / 1.86 / 3.69 |
| R3 | c22: 1.32 / 4.02 / 6.72 | c13: 1.40 / 3.82 / 6.26 | c09: 1.39 / 3.77 / 6.27 |
| R4 | c06: 1.37 / 4.62 / 8.08 | c10: 1.35 / 4.31 / 7.22 | c23: 1.43 / 4.22 / 7.10 |
| R5 | c27: 1.95 / 5.88 / 9.48 | c24: 1.75 / 4.91 / 7.79 | c12: 1.94 / 5.24 / 8.17 |
| R6 | c30: 1.39 / 4.03 / 6.10 | c15: 1.09 / 2.92 / 4.31 | c11: 1.23 / 3.08 / 4.54 |
| R7 | c05: 1.08 / 4.01 / 6.98 | c28: 1.47 / 4.40 / 7.19 | c26: 1.43 / 4.43 / 7.26 |
| R8 | c03: 0.55 / 1.65 / 3.42 | c21: 0.73 / 2.23 / 3.93 | c32: 0.77 / 2.23 / 3.70 |
| R9 | c08: 0.41 / 1.04 / 2.25 | c33: 0.79 / 2.58 / 4.70 | c04: 0.79 / 2.41 / 4.18 |
| R10 | c17: 0.80 / 2.66 / 4.87 | c07: 0.73 / 1.93 / 3.34 | c18: 0.73 / 1.97 / 3.45 |
| R11 | c20: 0.96 / 3.16 / 5.50 | c19: 1.28 / 3.53 / 5.68 | c31: 1.30 / 3.56 / 5.63 |

These numbers agree with the visual pass:

- **A, B and D:** the renders sit below the reference at 4-32 px. Their lit faces are under-detailed.
- **C trunk and close-up:** the renders sit 1.3-2.5× above the reference. Their folds and slits are over-contrasted.
- **R7:** the 1-3 px band is higher in the renders only because of their harder silhouette against the sky; the lit face itself is flatter.

The numbers include silhouette and sky, and the framing offsets inflate them. Treat them as indicative only.
