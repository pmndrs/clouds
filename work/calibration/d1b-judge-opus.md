# D1b blind judge (Opus)

I judged the set blind, using only `scratchpad/blind-d1b/` and the rubric's "Judging method". I did not open the key, `work/`, the parity folder or any report. All scores are 1–10 for match to the Decima reference. Scoring is harsh: 5 means "recognisably the same cloud with clear engine differences".

## Grouping and reference picks

In every group the two WebGPU renders share an identical sky. The Decima frame has its own sky, so it is the odd one out.

| Framing | Frames | Decima guess | Look W (warm-grey, smooth) | Look C (cool/blue, fibrous) |
|---|---|---|---|---|
| A: long cloud, tower right, sun upper-left | d03 d04 d07 | **d04** (teal sky) | d03 | d07 |
| B: same cloud wider, sun upper-right | d02 d09 d10 | **d02** (teal sky) | d10 | d09 |
| C: broad crown with left/right legs | d01 d05 d11 | **d01** (streaked grey-blue sky, peach cloud) | d05 | d11 |
| D: tower/head on a neck | d06 d08 d12 | **d12** (streaked sky, peach cloud) | d06 | d08 |

| Crop region | Crops | Decima | W | C |
|---|---|---|---|---|
| A tower | c08 c15 c18 | **c15** | c18 | c08 |
| A base / left mass | c03 c06 c13 | **c06** | c13 | c03 |
| B left mass top | c02 c11 c24 | **c11** | c24 | c02 |
| B tower | c09 c10 c21 | **c21** | c10 | c09 |
| C crown | c01 c05 c16 | **c01** | c16 | c05 |
| C left leg | c04 c14 c19 | **c14** | c04 | c19 |
| D neck (lower trunk) | c07 c17 c20 | **c17** | c20 | c07 |
| D head | c12 c22 c23 | **c12** | c22 | c23 |

The Decima frames are not perfectly registered to ours. In A and D the geometry is slightly offset and scaled, so the crops do not overlay exactly. The skies are also different, which shifts how the colour reads.

## Whole-frame distance

Scores are surface / shading / colour / edges / **overall**.

| Framing | W | C | Winner |
|---|---|---|---|
| A (d04) | d03: 3 / 3 / 4 / 4 / **3** | d07: 3 / 4 / 3 / 3 / **4** | **C** |
| B (d02) | d10: 3 / 3 / 4 / 4 / **3** | d09: 3 / 5 / 2 / 3 / **4** | **C** |
| C (d01) | d05: 4 / 5 / 4 / 4 / **5** | d11: 3 / 3 / 3 / 3 / **3** | **W** |
| D (d12) | d06: 3 / 4 / 4 / 4 / **4** | d08: 3 / 3 / 3 / 3 / **3** | **W** |

**A/B at distance.** The Decima cloud is luminous pink-white with very light shadows. Its lobes are many, small and clearly separated.
- **C is closer at this scale.** It keeps the brightness, and its blue crevices separate the lobes about as much as Decima's do. Its weaknesses are the strong blue tint and the hairy edges.
- **W fails on darkness.** Its tower shadow column is dark grey, far darker than Decima's. d10 also has dark smudges under the left mass and in the middle that Decima does not have.

**C/D at distance.** The Decima cloud is peach, dimmer, and mottled with dark creases and pits (the dark "eye" in the C crown).
- **W matches the value and the mottling better.**
- **C is washed out and lavender**, with one large smooth smudge.
- **The D head is blown white in both of ours.** Decima's head is tinted and textured.

## Crops (close up)

| Region | W | C | Winner |
|---|---|---|---|
| A tower | c18: 3 / 3 / 5 / 4 / **4** | c08: 2 / 4 / 3 / 2 / **3** | **W** |
| A base | c13: 3 / 4 / 5 / 4 / **4** | c03: 2 / 2 / 3 / 2 / **2** | **W** |
| B left top | c24: 3 / 4 / 5 / 4 / **4** | c02: 2 / 3 / 2 / 2 / **2** | **W** |
| B tower | c10: 3 / 2 / 5 / 4 / **3** | c09: 2 / 4 / 2 / 2 / **3** | tie; W by a hair (no artefacts) |
| C crown | c16: 4 / 5 / 5 / 4 / **5** | c05: 3 / 3 / 3 / 3 / **3** | **W** |
| C left leg | c04: 2 / 3 / 4 / 2 / **3** | c19: 3 / 3 / 3 / 4 / **4** | **C** |
| D neck | c20: 3 / 5 / 5 / 3 / **4** | c07: 2 / 3 / 3 / 3 / **3** | **W** |
| D head | c22: 2 / 3 / 3 / 3 / **3** | c23: 2 / 2 / 2 / 2 / **2** | **W** |

Close up, W wins 6 regions, C wins 1 (C leg) and 1 is a tie. **The winner changes with scale for A and B:**
- At distance, C's brightness and lobe separation read as closer.
- Up close, C's surface artefacts sink it. Its lit surfaces carry a directional hatch/fibre sampling pattern (c08, c09, c02) and its edges have a stippled, hairy fringe (c03, c23).

W is not good up close either. It is airbrushed: smooth, waxy and blurry-edged, where Decima has dense micro-lumps.

### Per-crop notes
- **A tower (c15).** Decima shows crisp separate lobe heads on the crown and fine cotton micro-lumps across the whole surface. Its shadow side is barely darker than the lit side (5th-percentile luminance (L) 156).
  - c18 (W): the shadow side is dark warm-grey (L 119) and smudgy. The crown lobes merge, and a translucent bright "tissue" sheet floats on the shadow side.
  - c08 (C): shadow value is right (L 154) but blue, and hatch texture covers the lit faces.
- **A base (c06).** Decima has a flat mauve-grey underside, with pink lit tops and lumpy crowns.
  - c13 (W): the base shadow becomes one dark smudge at the right. It also has wispy trailing fragments at the left and bottom that Decima lacks.
  - c03 (C): almost no base shadow, white-blue, with a fibrous left edge.
- **B left top (c11).** Decima has crisp pink lobes with soft warm occlusion between them.
  - c24 (W): the lobes are mushy and grey, with a faint cross-hatch dither on the right lobe.
  - c02 (C): strong hatch on every edge and blue shadows.
- **B tower (c21).** Decima's tower is almost entirely lit and pink, with a very faint lavender shadow and lots of fine billows.
  - c10 (W): the central column is far too dark (L 122 vs 163).
  - c09 (C): the value is about right, but the blue is saturated and the hatch is heavy.
- **C crown (c01).** The Decima interior is mottled with overlapping billow outlines and darker creases, and the crown edge is a row of small rounded lumps.
  - c16 (W): matches the value (median L 150 vs 141) and has some mottling. It shows bright "salt" flecks in the lower interior, and its crown edge is smoother, with fewer lumps.
  - c05 (C): bluish and smooth, with one large central smudge and a fuzzy crown edge.
- **C leg (c14).** Decima has a crisp peach silhouette with small turrets and wisps, and strong contrast against the sky.
  - Both of ours have very low cloud-to-sky contrast.
  - c04 (W): the blurriest.
  - c19 (C): crisper, so it wins on edges.
- **D neck (c17).** Decima is a dim mauve mass, its right silhouette is dim with a faint pink glint, and its lit left side is peach and lumpy.
  - c20 (W): matches the body darkness but adds a hard bright white rim down the right edge that Decima does not have.
  - c07 (C): lighter, lavender, with the same white rim plus salt-and-pepper grain in the shadow.
- **D head (c12).** Decima's head is tinted peach-mauve with a granular lumpy surface, a visible crease between head and neck, and a mauve shadow on the right.
  - Both of ours are over-exposed, smooth white "marshmallow" heads with almost no internal structure.
  - c23 (C) also has a bright arc line inside the left lobe and a stair-stepped left edge.

## Main remaining differences, in order of size

1. **Surface micro-structure.** Decima has dense cauliflower micro-lumps on the lit side and in the shadow mass. Ours are either airbrushed smooth (W) or carry sampling artefacts that pass for fibre (C). Neither has real lumps. A mid-frequency structure measure (3–12 px band-pass) is about 1.5–2× higher in Decima on the D head, B left mass and A/B towers.
2. **Edges.** Decima silhouettes are crisp, with small rounded turrets and a thin soft fringe. W's are blurry; C's are hairy and stippled.
3. **Shadow value does not follow the reference across lighting.**
   - In A/B, Decima's shadow side is very light. W's tower shadows are far too dark, and C gets the value right with the wrong hue.
   - In C/D, Decima is a dark mauve mass. W matches it and C is too light.
4. **Colour.** Decima is warm pink (A/B) and peach (C/D). W is neutral grey and C is blue-lavender, neither carrying the warm sun tint into the lit faces. W is closer.
5. **Exposure on the D head.** Both looks blow the head out to white; Decima keeps it tinted and textured.
6. **Specific artefacts, all absent in Decima:**
   - a white silver-lining rim on the D neck (both looks)
   - a translucent sheet on the A tower shadow side (W)
   - bright salt flecks in the C crown (W)
   - dark smudges under the B left mass (W)
   - hatch/fibre texture and stair-stepped edges (C)
   - wispy trailing fragments under A/B where Decima has a flat underside (both)
7. **Lobe count at distance.** The left masses in A/B have more, smaller and better-separated lobes in Decima. Ours read as fewer, larger, merged blobs. This could be geometry or noise scale rather than shading.

**Verdict:**
- **Look W is the better base:** it wins C/D at distance and 6 of 8 crop regions, on colour and value structure.
- **Look C reads closer at distance in the A/B teal-sky shots,** because it keeps the bright, light-shadowed lobes.
- **The gap is still large for both.** Neither scores above 5 anywhere, and the surface lumps and edge crispness are the biggest gap.
