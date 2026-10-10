# D1c blind judgement (Opus)

The set is `scratchpad/blind-d1c/`. I did not open the key. I used the "Judging method" from `rubric.md`. I looked at whole frames at native 1920x1080 and at the supplied crops. I also made my own native-resolution side-by-side montages and 3x nearest-neighbour edge zooms of the same regions, plus per-region tone and detail-band statistics (grey std in the 0-2 px, 2-8 px and 8-30 px blur bands).

Scores run from 1 to 10 for how well each render matches the reference: surface / shading / colour / edges / overall.

## Grouping and reference picks

| Framing | Frames | Reference | Why |
|---|---|---|---|
| A: tall tower, front | d01, d07, d11 | **d11** | Its sky differs from the other two (radial streak banding, white horizon fade) and the cloud is pink/mauve. d01 and d07 share the same sky. |
| B: wide, two masses and tower | d03, d04, d06 | **d03** | Teal sky and pink-white cloud. d04 and d06 share the same sky. The framing is also slightly different. |
| C: same cloud, sun glare top-left | d02, d08, d12 | **d02** | Teal sky and white haze floor. d08 and d12 share the same sky and the same glare. |
| D: wide cumulus with side tails | d05, d09, d10 | **d05** | Streaked sky as in d11, pink cloud. |

The two renders differ in the same way in every framing, so I label them by look:
- **Render Q** (warm-neutral grey, darker, crisper lobes): d01, d06, d08, d09.
- **Render P** (cool blue/lavender shade, fibrous or hatched fringe, brighter): d07, d04, d12, d10.

Crop groups (each is the same region in all three sources):

| Region | Ref | Q | P |
|---|---|---|---|
| A tower top | c18 | c08 | c06 |
| A lower trunk/skirt | c03 | c23 | c22 |
| B left lumps | c10 | c16 | c01 |
| B tower | c07 | c17 | c04 |
| C tower | c13 | c20 | c05 |
| C base/underside | c24 | c15 | c19 |
| D crown | c14 | c11 | c21 |
| D left tail | c09 | c12 | c02 |

## Distance (whole frames)

| Framing | Render | Surface | Shading | Colour | Edges | Overall | Winner |
|---|---|---|---|---|---|---|---|
| A | Q d01 | 5 | 4 | 3 | 4 | **4** | **Q** |
| A | P d07 | 3 | 3 | 2 | 5 | 3 | |
| B | Q d06 | 5 | 3 | 4 | 5 | **4** | **Q** |
| B | P d04 | 4 | 2 | 2 | 3 | 2 | |
| C | Q d08 | 5 | 4 | 4 | 5 | **5** | **Q** |
| C | P d12 | 4 | 3 | 2 | 3 | 3 | |
| D | Q d09 | 4 | 5 | 4 | 5 | **5** | **Q** |
| D | P d10 | 3 | 4 | 3 | 4 | 3 | |

Notes:
- **A.** The reference body is one even mauve mid-tone (shadow mass about L138, rgb 141,133,139) with a warm-lit lower rim. Q is close in value (L147) but neutral grey. It has a hard-edged lit lobe against a dark vertical crease, a dark horizontal band across the lower body and a skirt that is too white. Glitter flecks show in the right-side shadow. P is lavender (L156, blue-biased), mushy and grainy, and its skirt is white (L192 against the reference's 162). At the silhouette on the shade side, the reference edge is soft and rounded. Q shows stepped, flat lit "paper sheets" there. P's softer edge is actually closer.
- **B.** The reference is bright almost everywhere: the lumps are lit and only the base is shaded, and the tower is about L182. Both renders carve deep shadow cores into the camera-facing lumps and the tower: Q is grey at about L144 and P is blue at about L135 (rgb 115,130,159). This is the worst framing for both renders. Q has a dark grey base band that the reference only hints at.
- **C.** Q's dark flat underside band is in the right place. Its lump faces still have dark cupped cores the reference does not have. There is speckle glitter on the left lump, and the lit faces are dim (L183 against 201). P has blue cores and a base that is too light.
- **D.** Q matches the reference's body value best (L149 against 147). It is too smooth, lacks the reference's small pits and dark cells, and has yellowish glitter flecks in the centre plus a flat lit sheet at the right edge. Both renders brighten the bottom lumps to white, where the reference keeps the body mauve down to a thin pink rim.

## Close-up (crops)

| Region | Render | Surface | Shading | Colour | Edges | Overall | Winner |
|---|---|---|---|---|---|---|---|
| A tower top (ref c18) | Q c08 | 4 | 5 | 3 | 5 | **4** | **Q** |
| | P c06 | 3 | 4 | 3 | 4 | 3 | |
| A lower (ref c03) | Q c23 | 4 | 5 | 4 | 4 | **4** | **Q** |
| | P c22 | 3 | 3 | 2 | 4 | 3 | |
| B lumps (ref c10) | Q c16 | 5 | 4 | 4 | 6 | **5** | **Q** |
| | P c01 | 3 | 3 | 2 | 3 | 3 | |
| B tower (ref c07) | Q c17 | 4 | 2 | 4 | 5 | **3** | **Q** (narrow) |
| | P c04 | 3 | 1 | 2 | 3 | 2 | |
| C tower (ref c13) | Q c20 | 4 | 3 | 4 | 4 | **4** | **Q** |
| | P c05 | 3 | 3 | 2 | 3 | 3 | |
| C base (ref c24) | Q c15 | 4 | 6 | 4 | 5 | **5** | **Q** |
| | P c19 | 3 | 3 | 2 | 3 | 3 | |
| D crown (ref c14) | Q c11 | 3 | 5 | 4 | 5 | **4** | **Q** (narrow) |
| | P c21 | 4 | 4 | 2 | 3 | 3 | |
| D tail (ref c09) | Q c12 | 4 | 5 | 4 | 6 | **5** | **Q** |
| | P c02 | 3 | 4 | 3 | 4 | 3 | |

Notes:
- **A top.** The reference has busy internal mottling: lighter and darker cells, creases and cotton tufts on the rim. Q has the right big lobes and creases but a marshmallow-smooth skin. P is almost featureless with a feathered rim.
- **A lower.** The reference is smooth billows in pink-mauve. Q's value is right, but it has crisp planar lit sheets on the right edge and speckle pits in the mid-right. P is grainy all over and too light.
- **B lumps.** Q's soft lumps are the closest of all the crops, with some moiré hatching at right and a grey pocket that is too dark. P has a directional hatched fibre texture across all its lit lumps and fringe.
- **B tower.** In the reference the tower is evenly bright, with one shallow soft pocket and fine cotton grain. Q has a big grey shadow mass and contour-line ("wood grain") banding on the upper left. P has a deep blue cavity plus hatching.
- **C tower.** The reference has crisp round cauliflower lobes on top and only modest lavender shade on the right. Q's lobes are softer and less defined. Its right side is too dark brown-grey and has a sharp white crescent sheet. P has hatching and a blue right side.
- **C base.** Q's dark underside band matches. It has a marbled contour artifact on the shadowed lump above and lacks the reference's cotton tufts on the upper left. P's base is too light and blue.
- **D crown.** At 3x the reference silhouette is soft with slight tufting. Q is clean and smooth, and its lobe shape matches. P has spiky fibre tufts. Inside the body the reference is dense small cauliflower cells. Q is plastic-smooth with glitter flecks, and P has some lumpy mottling lower down but is soft and cool.
- **D tail.** Q's lumpy tufted outline and notch match the reference. P is soft and fuzzy.

## Main remaining differences (both renders unless stated)

1. **Colour.** The reference's lit faces are pink/peach (R above B by about 10–25) and its shadows are mauve (R ≈ B > G). Q is neutral white and grey. P is blue-lavender. This is the most obvious gap at distance.
2. **Shadow placement.**
   - B and C: the reference keeps camera-facing lumps and the tower lit, with shade mainly on undersides. Both renders put deep self-shadow cores in lump faces and in the tower: grey in Q, blue in P.
   - A and D: both renders brighten the bottom skirt and lumps to white and leave a dark band above them. The reference body stays an even mauve down to a thin warm rim.
3. **Surface.** The reference has more mid-band structure in lit lobes: small cells, pits and dark flecks inside the shadow mass. Its 2–8 px band std is about 3.9 against Q 2.9 and P 1.6 on the A lit lobe, and about 5.7 against 3.6 and 4.7 on the C lit area. Q reads as smooth marshmallow with occasional creases. P reads as soft mush with grain.
4. **Artifacts in Q.**
   - Glitter/yellow speckle flecks in shadow interiors: d01 right side, d09 centre, d08 left lump.
   - Crisp flat lit "paper sheets" at the silhouette: d01 right edge, d09 right, d08 tower crescent.
   - Contour/wood-grain banding: d06 tower, d08 base top.
5. **Artifacts in P.** A directional hatched or fibrous fringe and moiré on edges and lit lumps (c01, c04, c05, c19), plus speckle grain across the body.
6. **Exposure.** Q's lit faces are dimmer than the reference's (C: L183 against 201; A lit lobe: rgb 205,200,198 against 208,191,184 — similar luminance but no warmth).

**Verdict.** Render Q wins all 4 framings at distance and all 8 crop regions up close. It is never close to "same engine": overall scores are 4–5 at best. The B tower (shading 2) is the weakest comparison.
