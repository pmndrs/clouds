# D1 blind set k — judge: Fable (2026-10-11)

Set: `scratchpad/blind-d1k/` (d01–d12 full frames 1920x1080, c01–c36 crops at 2x of frame pixels). Judged blind; no key, no earlier judge files, no D1 reports read.

## 1. Grouping and reference pick

Grouped by eye on the full frames (a thumbnail diff matrix was misleading: sky dominates it). Inside each framing two images share the same silhouette lump-for-lump (same asset, two variants of our engine); the third has a slightly different silhouette, finer surface and a different colour — that is the shipped-engine frame.

| framing | ref | render A | render B |
|---|---|---|---|
| C — flat-based cumulus, ground camera, pale haze | **d04** | d01 | d11 |
| B — tall cumulus with trunk | **d10** | d09 | d07 |
| A2 — long two-tower cloud, close framing | **d12** | d05 | d06 |
| A1 — long two-tower cloud, wide framing with horizon | **d08** | d02 | d03 |

Variant pattern (noted, not relied on): in every framing one render has a measurably rougher surface and a worse sky (d11, d07, d05, d03) and the other is smoother with a sky closer to the reference (d01, d09, d06, d02).

## 2. Crop map (template match, 2x scale, frame box x,y,w,h)

| region | frame box | ref crop | A | B |
|---|---|---|---|---|
| R1 B lower-right trunk | 960,624,300,300 | c02 (d10) | c01 (d09) | c15 (d07) |
| R2 B trunk / lower body | 656,600,700,300 | c03 (d10) | c35 (d09) | c14 (d07) |
| R3 B top crest | 504,104,700,450 | c32 (d10) | c04 (d09) | c33 (d07) |
| R4 C lower-left satellite | 40,520,560,340 | c27 (d04) | c05 (d01) | c21 (d11) |
| R5 C main body | 560,184,700,500 | c06 (d04) | c22 (d01) | c09 (d11) |
| R6 C interior fleck | 1104,496,160,120 | c25 (d04) | c31 (d01) | c10 (d11) |
| R7 A2 tower | 1152,176,400,520 | c07 (d12) | c08 (d05) | c17 (d06) |
| R8 A2 left body | 352,328,500,330 | c16 (d12) | c29 (d05) | c11 (d06) |
| R9 A2 tower detail | 1200,296,200,200 | c13 (d12) | c23 (d05) | c30 (d06) |
| R10 A1 base / horizon | 304,560,900,300 | c28 (d08) | c20 (d02) | c12 (d03) |
| R11 A1 tower | 1096,152,480,560 | c26 (d08) | c36 (d02) | c24 (d03) |
| R12 A1 mid lobe junction | 824,544,220,160 | c18 (d08) | c19 (d02) | c34 (d03) |

Method: every crop viewed at native, then 2x (3x for R6) sub-crops as ref|A|B triptychs of the lit crests, shade sides, lobe junctions, creases/trunk, silhouettes, base edge and sky (`scratchpad/judge-fable/z_*.png`). Stats afterwards (`bands_out.txt`, `florets_out.txt`).

## 3. Scores (1–10 vs the reference; surface / shading / colour / edges / overall)

### Framing C (ref d04)

| image | surf | shade | col | edge | overall | notes |
|---|---|---|---|---|---|---|
| d01 (frame) | 3 | 4 | 4 | 4 | 3 | smooth balloons on every crest, no florets; sky + haze close to ref |
| d11 (frame) | 3 | 4 | 2 | 4 | 3 | same surface; violet sky, no horizon haze, sky bottom (193,188,184) vs ref (239,237,240) |
| c22 (d01, R5 body) | 3 | 4 | 4 | 4 | 3 | crests are single big bubbles, whites flat; ref has florets at 3 scales + grain |
| c09 (d11, R5 body) | 3 | 4 | 3 | 4 | 3 | a little more mid-scale relief (lit 4–12 px 1.68 vs ref 1.24, d01 0.82) but reads as the same balloons; violet sky |
| c05 (d01, R4 satellite) | 2 | 3 | 3 | 3 | 2 | featureless grey blob; ref satellite is sunlit pink-cream with fibrous florety edge (lit L 0.74 vs 0.80) |
| c21 (d11, R4 satellite) | 2 | 3 | 2 | 3 | 2 | as c05, darker and more violet |
| c31 (d01, R6 fleck) | 3 | 3 | 3 | 3 | 3 | bright fleck in a dark halo + olive streak; ref has its own hard triangular chip here, so partly a ref artefact |
| c10 (d11, R6 fleck) | 3 | 3 | 3 | 3 | 3 | same |

Closer at distance: **d01** (sky, haze, neutral whites). Closer up close: **d11** by a hair (slightly more crest relief), both far off.

### Framing B (ref d10)

| image | surf | shade | col | edge | overall | notes |
|---|---|---|---|---|---|---|
| d09 (frame) | 2 | 4 | 4 | 4 | 3 | top dome a dead-flat balloon; sky/haze close |
| d07 (frame) | 2 | 4 | 2 | 4 | 3 | same; violet sky, no haze, whites a shade grey |
| c04 (d09, R3 crest) | 2 | 3 | 3 | 4 | 2 | lit dome has no structure at all (blobs 0.58 vs ref 1.41, lit 4–12 px 1.33 vs 1.61), blown white, hard shade bite at the lobe junction |
| c33 (d07, R3 crest) | 3 | 4 | 3 | 4 | 3 | faint lumps and grain on the dome (lit 1–3 px 0.47 vs ref 0.52), still no nested florets |
| c35 (d09, R2 trunk) | 3 | 3 | 4 | 3 | 3 | no grain, whorl/ring in the shade, faint vertical slit, serrated chalk edge right |
| c14 (d07, R2 trunk) | 2 | 3 | 3 | 3 | 2 | ring and slit stronger, violet sky |
| c01 (d09, R1 lower right) | 3 | 3 | 4 | 3 | 3 | dark pit + slit, chalky bright rim on the lower-right edge |
| c15 (d07, R1 lower right) | 2 | 3 | 3 | 3 | 2 | ring/whorl + slit, violet sky |

Closer at distance: **d09**. Closer up close: **d07** (only render with any lumps on the crest), but its shade artefacts are stronger.

### Framing A2 (ref d12)

| image | surf | shade | col | edge | overall | notes |
|---|---|---|---|---|---|---|
| d05 (frame) | 4 | 4 | 4 | 4 | 4 | more mid-scale structure but it is pocks/rings, not nested domes; sky close but lighter |
| d06 (frame) | 3 | 4 | 3 | 4 | 3 | smooth balloons; sky top too dark/saturated, olive horizon band |
| c08 (d05, R7 tower) | 4 | 3 | 3 | 3 | 3 | lumps present, but donut dimples/rings on the face, grey-blue mottled shade, serrated chalk rim + slit on the right edge |
| c17 (d06, R7 tower) | 3 | 4 | 4 | 3 | 3 | smoother, fewer lumps, same serrated rim |
| c29 (d05, R8 left body) | 4 | 3 | 3 | 4 | 3 | bubbles with ring creases; lit lobes grey (lit L 0.75 vs ref 0.80), shade blotchy blue-grey |
| c11 (d06, R8 left body) | 3 | 4 | 4 | 4 | 3 | one smooth bubble per lobe (lit 4–12 px 0.59 vs ref 1.04) |
| c23 (d05, R9 tower detail) | 3 | 2 | 2 | 4 | 2 | too dark (lit L 0.62 vs 0.72), ochre/beige blotches, rings |
| c30 (d06, R9 tower detail) | 2 | 3 | 3 | 4 | 3 | smooth, blue-grey |

Closer at distance: **d05**. Closer up close: **d05** (its relief is the wrong kind, but d06 has none).

### Framing A1 (ref d08)

| image | surf | shade | col | edge | overall | notes |
|---|---|---|---|---|---|---|
| d02 (frame) | 3 | 3 | 3 | 4 | 3 | balloon tower, belly too light, cream horizon band with blue below it, saturated sky top |
| d03 (frame) | 3 | 3 | 3 | 3 | 3 | egg-crate pocks on the tower, khaki shade, white fog wall flattening the lower half |
| c36 (d02, R11 tower) | 2 | 3 | 3 | 3 | 3 | smooth balloon dome (blobs 0.94 vs ref 2.07), khaki shade smudge in the trunk, slit + serrated rim at right |
| c24 (d03, R11 tower) | 3 | 3 | 3 | 3 | 3 | single-scale pocks everywhere (blobs 1.99 but dfrac 0.67, ref 0.52 — domes without the hollows), bright rim, khaki shade |
| c20 (d02, R10 base) | 3 | 3 | 2 | 3 | 2 | belly beige and too light, base edge smeared, cream band then blue sky beneath |
| c12 (d03, R10 base) | 2 | 2 | 2 | 2 | 2 | lower cloud washed out by the fog wall (lit 12–32 px 0.75 vs ref 1.49), base dissolves |
| c19 (d02, R12 junction) | 3 | 3 | 3 | 3 | 3 | mottled dimples the ref does not have (ref is soft large lobes), beige |
| c34 (d03, R12 junction) | 3 | 3 | 2 | 3 | 3 | same plus khaki cast |

Closer at distance: **d03** (the ref also has white haze at the bottom; d02's cream band with blue beneath is wrong), with reservations: d03's cloud is washed out. Closer up close: **d03** (has structure on the tower; d02 has none), reservations: the structure is pocks, not cauliflower.

## 4. Hard artefacts per image (frame pixels)

Reference note: d04 itself has a hard bright triangular chip in a dark pit at ~(1104–1140, 500–560); R6 was cut around it in all three sources.

**d01**
- bright fleck with a dark halo ~(1150,548); olive/ochre discoloured streak ~(1105–1135, 525–610)
- dark notch/pit at the satellite junction ~(360,775)
- S-shaped whorl creases on the top-right crest ~(1012,270) and ~(930,300)
- dead-flat blown domes 560–1100 x 230–400 (no florets, no grain)

**d11**
- same geometry artefacts as d01: fleck ~(1150,545), olive streak ~(1110–1125, 520–600), pit ~(360,775), whorl creases ~(1012,270)
- violet sky over the whole frame; no horizon haze (bottom rows (193,188,184)); sky too dark top to bottom

**d09**
- whorl/ring in the shade ~(1077,718); faint vertical slit ~(1130,760); dark pit ~(1144,765)
- hard-edged shade bite at the crest lobe junction ~(878,414); dark chip at the left lobe junction ~(643,509)
- detached speck ~(1050,255)
- serrated chalky edge on the right lobes 1156–1320 x 620–750; bright chalk rim 1095–1260 x 774–904
- dead-flat blown top dome 700–1000 x 150–400

**d07**
- ring/whorl ~(1077,718) and ~(1080,724), stronger than d09; vertical slit ~(1129,756) darker and longer
- same bites, chip, speck and serrated/chalk edges as d09
- violet sky, no horizon haze (bottom rows (184,182,185))

**d05**
- donut dimples/rings on the tower face ~(1377,357) and the cluster 1330–1420 x 300–420
- vertical slit at the tower's right edge ~(1445,391); serrated chalk rim 1430–1500 x 300–560
- ochre/beige blotches in the shade ~(1325–1390, 326–396)
- grey-blue cast over the left-body shade (R8)
- sky band reversal: brightness falls again in rows 1000–1079 ((169,200,221) to (157,191,216))

**d06**
- smooth balloon lobes over the whole tower 1150–1500 x 180–650 and the left body
- serrated chalk rim 1430–1500 x 300–560; weak dimples ~(1377,357)
- olive-grey horizon band rows 950–1079 (hue drifts to (177,188,184)); sky top too dark/saturated ((47,85,130) vs ref (59,94,122))

**d02**
- cream horizon band rows ~850–950 with blue sky returning beneath it ((221,214,207) at row 900, (190,199,208) at 1079)
- smooth balloon dome 1250–1450 x 250–400
- khaki shade smudge with a hard boundary in the trunk 1270–1440 x 530–660; vertical slit ~(1457,425); serrated chalk rim 1430–1500 x 330–560
- mottled dimples at the mid lobe junction 824–1044 x 544–704
- belly too light; base edge smeared rows 740–800; saturated sky top

**d03**
- white fog wall rows ~700–1079 washing out the whole lower half; base edge dissolved
- khaki/beige cast on every shade side; grey band under the fog, rows 1000–1079 ((236,236,238) to (215,216,221))
- single-scale egg-crate pocks over the tower 1150–1500 x 200–600; bright rim along the tower edges
- vertical slit ~(1457,425); serrated rim 1430–1500 x 330–560

## 5. Stats cross-check (lit half, band std at 1–3 / 4–12 / 12–32 px; floret blobs per 1e4 lit px)

- Fine grain 1–3 px: references 0.43–0.52 everywhere; renders 0.32–0.39, except the rough variant in B/C (c33 0.47, c09 0.47–0.51) — the smooth renders look defocused up close.
- Mid band 4–12 px (the floret scale): ref > renders in R3 (1.61 vs 1.33), R4 (1.12 vs 0.71/0.78), R7 (1.30 vs 1.00/0.88), R8 (1.04 vs 0.70/0.59), R11 (1.39 vs 0.67/0.94), R12 (0.89 vs 0.65/0.72). Where a render exceeds the ref (c33 1.85, c09 1.68) the energy is a few big creases and rings, not nested domes.
- Blob count: ref 1.3–2.1 on the lit crests; smooth renders 0.6–1.1 (c04 0.58, c36 0.94, c11 0.87); rough renders 1.4–2.0 but with dfrac 0.67–0.87 (domes without hollows) where the ref sits at 0.52–0.62. Matches the eye: pocks, not cauliflower.
- Colour (lit mean RGB): refs are warm (d04 crops 222/205/198, d10 209/203/205, d12 221/211/209); B/C/A2 renders neutral or cool (223/219/216, 190/188/193, 211/206/203); A1 renders beige where the ref is neutral (205/197/191 vs 207/202/204).
- Lit luminance: shaded satellites and tower detail too dark in the renders (R4 0.74/0.71 vs 0.80, R9 0.62/0.69 vs 0.72); R3 d09 too bright (0.86 vs 0.82, blown).

## 6. Main remaining differences, biggest first

1. **No cauliflower hierarchy on the lit crests.** Every render's crest is either one smooth balloon per lobe (d01, d09, d06, d02) or a field of same-size pocks/rings (d11, d07, d05, d03). The reference carries domes on domes down to a 1–3 px grain, with a soft pink rim where a lobe catches light. This is the single biggest "different engine" tell in all four framings.
2. **Colour of the lit body.** Reference lit faces are warm cream/pink; our renders are neutral-to-cool white, blown flat on the top domes in B, and khaki/beige on the shade sides in A1. No render carries the ref's warmth.
3. **Sky and haze.** Violet sky with no horizon haze (d07, d11); a cream band with blue returning beneath it (d02); a fog wall that eats the lower half (d03); an olive horizon band (d06) and a brightness reversal at the bottom (d05). Only d01 and d09 have a believable sky/haze.
4. **Shade transitions.** Hard-edged shade bites and vertical slits at lobe junctions, rings/whorls and ochre blotches inside the shade, a hard-bounded khaki smudge in the A1 trunk; shaded satellites and lobes too dark and featureless (R4, R9). The reference's shade is a soft grainy smudge with lumps still readable inside it.
5. **Edges.** Lit silhouettes are serrated chalky rims with a bright outline; the ref's are fibrous, florety and softly pink. Shade-side edges are dull and soft. Base edges smear (d02) or dissolve (d03) where the ref's belly keeps a crisp lower edge over the haze.
6. **Fine grain / defocus.** The smooth variants read as slightly out of focus up close; the ref has grain everywhere, including in the shade.
