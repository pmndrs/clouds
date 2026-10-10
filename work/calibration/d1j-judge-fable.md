# D1 blind set j: judge Fable (2026-10-11)

Blind. No key, no D1 reports, no earlier judge files read. Set: `scratchpad/blind-d1j/` (d01–d12 full frames 1920x1080, c01–c36 crops). Rubric: `work/calibration/rubric.md` (judging method: zoomed regions, distance and up-close winners reported separately).

## Method

1. Viewed all 12 frames; grouped them by framing (silhouette and camera).
2. Picked the reference per framing from the frames' own signatures, not from looks: two frames per framing show a dithered sky (high-pass std 0.0020 in a flat sky patch) and full chroma resolution; the third shows a smooth sky (0.0006–0.0012), chroma-subsampled edges and 8x8 blockiness (ratio 1.3–1.7 vs 1.0) i.e. a compressed capture. Those are d01, d02, d06, d07. The composition oddity in B (d02's cloud sits lower-left of d03/d05, which share a camera fit) agrees.
3. Mapped every crop to its frame with normalised cross-correlation (all r ≥ 0.998). Every crop is a 2x blow-up of a frame region (crop px = 2 x frame px).
4. Viewed every crop at native size, then 33 side-by-side sheets (ref | render | render) of sub-regions at 1:1 and 2x crop pixels: lit crests, shade sides, silhouettes, lobe junctions, trunk creases, base and horizon.
5. Cross-checked afterwards with band std (1–3 / 4–12 / 12–32 px, whole cloud and lit half), mean luminance, R−B tint and `florets.py` blob counts. Statistics are quoted only where they confirm or sharpen what was seen.

## Framings and crop map

| Framing | Reference | Renders | Regions (frame box x,y,w,h) and crops (ref, render, render) |
|---|---|---|---|
| A: single cumulus with left trail, grey-blue sky | d01 | d04, d12 | R1 crest 560,180,700,500: c02, c07, c35. R2 left trail 40,520,560,340: c04, c26, c06. R3 right junction 1100,500,160,120: c17, c36, c22 |
| B: two-lobe body with right tower, blue sky | d02 | d03, d05 | R4 left domes 350,330,500,330: c25, c01, c29. R5 tower 1150,180,400,520: c10, c12, c30. R6 tower face 1200,300,200,200: c24, c20, c27 |
| C: same body, lower camera, bright horizon | d07 | d09, d10 | R7 tower 1100,150,480,560: c28, c11, c19. R8 base and horizon 300,560,900,300: c32, c13, c23. R9 lobe junction 820,540,220,160: c31, c15, c09 |
| D: single tall tower, grey-blue sky | d06 | d08, d11 | R10 main dome 500,100,700,450: c34, c05, c16. R11 trunk 650,600,700,300: c08, c03, c18. R12 right shade side 960,620,300,300: c14, c21, c33 |

Variants are not consistent across framings; each framing is judged on its own. One recurring pattern is worth naming because it drives several scores: in every framing one render (d04, d05, d10, d08) paints a stepped sky with a visible horizontal band (luminance step 1.3–1.7 per 4 px at y≈680 / 440 / 644 / 756) and, in A, C and D, a white fog wall that dissolves the cloud base.

## Scores (1–10 against the reference; harsh)

Axes: surface / shading / colour / edges / overall ("same cloud, same engine").

### Framing A (ref d01)

| Image | surface | shading | colour | edges | overall | Notes |
|---|---|---|---|---|---|---|
| d04 (frame) | 3 | 3 | 3 | 4 | 3 | milky, low-contrast, cold blue-grey; stepped sky band at y≈680; fog wall under the base |
| d12 (frame) | 4 | 5 | 5 | 4 | 4 | contrast and shade depth near the ref; cooler than the ref's warm pink; no florets |
| c07 (d04, R1 crest) | 2 | 3 | 3 | 4 | 3 | smooth balloons under haze; ref crest is tiled with 10–30 px florets with their own mini-shadows |
| c35 (d12, R1 crest) | 3 | 5 | 5 | 4 | 4 | balloons with soft dome bubbles, no floret tiling; band 4–12 amplitude matches the ref (3.9 vs 3.7) but it is lobe-scale shading, not florets |
| c26 (d04, R2 trail) | 3 | 4 | 3 | 2 | 3 | trail is one solid rounded blob with cut-out knobs; ref trail is torn, feathered at 1–3 px |
| c06 (d12, R2 trail) | 3 | 4 | 5 | 2 | 3 | same solid blob, slightly softer; colour closer |
| c36 (d04, R3 junction) | 2 | 2 | 3 | 3 | 2 | ref: dark pit with a crisp lit chip; render: bright glow blob with a green-yellow smear, no pit |
| c22 (d12, R3 junction) | 2 | 3 | 4 | 3 | 3 | pale glow blob, tan smear, no pit |

Winner at distance: d12. Winner up close: d12 (every region). d04 loses on contrast and the stepped sky before any detail is compared.

### Framing B (ref d02)

| Image | surface | shading | colour | edges | overall | Notes |
|---|---|---|---|---|---|---|
| d03 (frame) | 4 | 5 | 5 | 3 | 4 | clean, well-placed light; silhouette too hard everywhere (cut-out lobes with a 1 px bright rim) |
| d05 (frame) | 3 | 5 | 4 | 4 | 4 | egg-crate bubble relief on the tower; stepped sky band at y≈440; edges a touch softer than d03 |
| c01 (d03, R4 domes) | 4 | 5 | 5 | 3 | 4 | stacked balloons, each with a hard lit rim; ref dome is one soft gradient with grain and a fuzzy edge |
| c29 (d05, R4 domes) | 3 | 5 | 4 | 4 | 4 | bubble wrinkles over the dome (whorls); edge softer |
| c12 (d03, R5 tower) | 3 | 4 | 5 | 3 | 4 | flat lit plateau on the crest, ledge where lobes overlap, serrated chip turrets on the right edge |
| c30 (d05, R5 tower) | 3 | 4 | 4 | 3 | 3 | uniform-scale bubble tiling across the lit face (same-size blobs everywhere, no 3–4x hierarchy); serrated turrets |
| c20 (d03, R6 face) | 3 | 4 | 3 | – | 3 | smooth, cool blue cast (R−B +1.3 vs ref +3.6), faint dome bubbles |
| c27 (d05, R6 face) | 3 | 4 | 4 | – | 3 | mottled, blotchy light patches |

Winner at distance: d03 (narrow). Winner up close: d03 (narrow; its balloons read better than d05's bubble tiling, but both miss the ref's soft, grained single dome). Band 4–12 / 12–32 on the lit half: ref 4.7/8.4 (R4) and 5.6/9.8 (R5); d03 3.2/6.0 and 4.3/7.4; d05 2.8/4.7 and 4.3/7.3. Both renders carry less mid-scale relief than the ref while looking harder-edged, which is the wrong combination.

### Framing C (ref d07)

| Image | surface | shading | colour | edges | overall | Notes |
|---|---|---|---|---|---|---|
| d09 (frame) | 4 | 3 | 3 | 3 | 3 | too warm (cloud R−B +11 vs ref −2.5), saturated blue below the base where the ref has white haze, warm band at y≈880; trunk shade dark brown |
| d10 (frame) | 3 | 4 | 4 | 3 | 4 | sky and haze brightness nearer the ref, but fog wall dissolves the base and the whole cloud reads defocused; stepped band at y≈644 |
| c11 (d09, R7 tower) | 3 | 3 | 3 | 3 | 3 | blown flat dome, hard chip turrets with white rims, dark brown trunk; ref dome is grained cauliflower with a luminous pale shade side |
| c19 (d10, R7 tower) | 3 | 3 | 4 | 4 | 3 | same smooth dome, hazier (band 4–12 lit 2.3 vs ref 4.8); trunk brown; edge softness nearer the ref |
| c13 (d09, R8 base) | 3 | 4 | 3 | 4 | 3 | base edge plausible but tan; sky under it too blue; bluish ghost lobe at left |
| c23 (d10, R8 base) | 2 | 3 | 4 | 2 | 3 | base and satellites dissolve into white fog; nothing left to judge below y≈780 |
| c15 (d09, R9 junction) | 3 | 3 | 2 | – | 3 | darker, higher-contrast crevice than the ref's soft pink-grey; tan lobe |
| c09 (d10, R9 junction) | 3 | 4 | 3 | – | 3 | hazy; ochre-tinted lobe top-right |

Winner at distance: d10 (sky/haze tone and lower contrast sit nearer the ref). Winner up close: d09 (it keeps structure at the base and junction where d10's fog erases it; the tower is a draw). Neither is close: the ref's tower shade is pale and luminous, both renders paint it dirty brown.

### Framing D (ref d06)

| Image | surface | shading | colour | edges | overall | Notes |
|---|---|---|---|---|---|---|
| d08 (frame) | 2 | 2 | 3 | 3 | 2 | milky, blown dome, fog wall from y≈760 and a stepped band there; shade greenish-grey |
| d11 (frame) | 3 | 3 | 4 | 3 | 3 | contrast nearer the ref but the dome is a blown white plateau and the shade is a dark brown-olive |
| c05 (d08, R10 dome) | 2 | 2 | 3 | 2 | 2 | flat milky disc (mean L 187 vs ref 169), scalloped sawtooth outline, no gradient or creases |
| c16 (d11, R10 dome) | 2 | 2 | 3 | 2 | 2 | pure white plateau, zero relief inside the dome; same serrated outline; band amount (4.5/7.0) is close to the ref (4.6/8.0) but it all sits at the outline and the cleft, not on the face |
| c03 (d08, R11 trunk) | 2 | 2 | 2 | 3 | 2 | dark brown vertical slit, jagged silhouette with a lit flap; ref trunk is a soft pale pink-grey with a single lit scrap on the edge |
| c18 (d11, R11 trunk) | 2 | 2 | 3 | 2 | 2 | darker still: slit, pits, white-rim flap, dark smudge |
| c21 (d08, R12 shade) | 2 | 2 | 2 | 3 | 2 | olive-grey pits and a vertical dark seam; ref shade is one soft mauve gradient with a pink rim |
| c33 (d11, R12 shade) | 2 | 2 | 3 | 2 | 2 | dark "eye" whorl, pits, hard sawtooth rim at right |

Winner at distance: d11. Winner up close: d11 by a hair (contrast), but both fail the same way: blown lit face, dark brown shade, serrated outline. This is the weakest framing.

## Hard artefacts per image (frame pixel coordinates)

d04 (A)
- Stepped sky band across the frame at y≈680 (x 0–1920).
- Fog wall: base dissolves below y≈760 (x 900–1500, y 780–860).
- Ochre/tan blotch on the lit face at (980, 490).
- Green-yellow smear at (1125, 550) and a bright glow blob at (1148, 541) in the right junction, where the ref has a dark pit with a lit chip.
- Trail (300–560, 730–830): one solid rounded blob with cut-out knobs, no feathering.
- Milky haze/defocus over the upper half (650–1250, 230–500); crest florets absent.

d12 (A)
- Ochre blotch at (975, 505).
- Pale glow blobs at (1152, 543) and (1175, 565) in the right junction; no pit.
- Trail (300–560, 730–830): solid blob, cut-out edge.
- Crest (650–1100, 230–400): smooth balloons, no floret tiling.

d03 (B)
- Cut-out lobes with a 1 px bright rim along the left domes (640–880, 350–450) and the tower crest (1260–1520, 220–330).
- Serrated chip turrets on the tower's right edge (1420–1520, 300–450).
- Flat lit plateau on the tower face (1250–1450, 250–450).
- Tan blotch in the tower cleft at (1270, 485).
- Left satellites (180–300, 740–790) blobby and hard.

d05 (B)
- Stepped sky band at y≈440 (x 0–1920).
- Egg-crate bubble tiling on the tower's lit face (1300–1450, 300–450), e.g. (1365, 355).
- Bubble wrinkles/whorls on the left dome (620–800, 380–520).
- Tan blotch in the cleft at (1270, 485).
- Serrated turrets (1430–1530, 300–450).

d09 (C)
- Dark brown trunk shade (1380–1500, 500–650), centre (1440, 595); ref is pale grey-blue.
- Hard chip turret with white rim at (1190, 460).
- Bluish ghost lobe at (565–615, 755–785).
- Warm horizon band at y≈880–900 across the frame; sky under the base (300–1200, 800–900) saturated blue where the ref is white haze.
- Blown flat dome top (1250–1450, 250–400).
- Tan tint on the junction lobe at (935, 565).

d10 (C)
- Fog wall: base and satellites dissolve below y≈760 (300–1500, 760–860).
- Stepped sky band at y≈644.
- Dark brown trunk shade (1380–1500, 500–650).
- Ochre-tinted lobe at (970–1020, 550–580).
- Defocus/haze over the whole tower (1200–1500, 200–700): band 4–12 at 2.3 vs ref 4.8.
- Serrated turret edges (1180–1250, 450–520).

d08 (D)
- Stepped sky band at y≈756; fog wall eats the base (700–1300, 800–1000).
- Blown milky plateau on the main dome (700–1000, 130–400).
- Scalloped sawtooth crest outline (700–1000, 130–150).
- Bubble whorls on the left satellite (595–650, 440–515).
- Dark brown vertical slit in the trunk (1140–1160, 650–850).
- Olive-grey pits in the shade (1100–1200, 700–780); greenish cast on the right side (1100–1250, 620–920).

d11 (D)
- Blown white plateau on the main dome (700–1000, 130–400), no gradient or creases.
- Serrated crest outline (700–1000, 130–150); lit flap with a white rim at (1210–1260, 630–730).
- Dark brown slit at (1140, 750); dark "eye" whorl at (1110–1185, 695–770); dark smudge at (910, 732).
- Bubble whorls on the left satellite (595–650, 440–515).
- Shade too dark and brown-olive throughout (1050–1250, 600–900).

## Main remaining differences from the references, biggest first

1. Lit crests are smooth balloons, not cauliflower. Every reference crest (R1, R4, R5, R7, R10) is tiled with 10–30 px florets that carry their own mini-shadows plus a fine grain; the renders show lobe-scale balloons with either a flat plateau (d03, d09, d11, d08) or soft dome bubbles (d12, d05). Where the band amplitude is near the ref's (c35, c16) it is lobe shading and outline, not florets. The uniform bubble tiling in d05 is the wrong shape at the wrong single scale.
2. Shade is the wrong value and hue. The references' shade sides are pale, luminous grey-mauve (framings C and D especially: trunk at R7/R11, shade at R12). The renders go dark brown-olive with slits and pits (d09, d10, d08, d11) or, in the fog-wall variants, wash out (d04, d08).
3. Silhouettes are cut-outs. Renders have hard lobe outlines with a 1 px bright rim and serrated chip turrets (d03, d05, d09, d11); thin parts that should feather (A's trail, C's satellites) are solid blobs. The ref is crisp on lit ridges but torn and fuzzy on wisps and undersides.
4. Sky/atmosphere mismatch in one variant per framing: a stepped horizontal band (d04 y≈680, d05 y≈440, d10 y≈644, d08 y≈756) and a white fog wall that dissolves the base; the ref haze is a smooth ramp that leaves the base edge readable (R8).
5. Colour: the references are warm pink-grey with blue-grey shade. d04 and d03's tower face (c20) run cold (R−B −7.6, +1.3 vs ref +0.6, +3.6); d09 runs too tan (+11 at the tower, +14 at the junction c15, vs ref −2.5, +7.3). Ochre/tan blotches appear on lit faces and in clefts (d04, d12, d03, d05, d10).
6. Junction micro-structure: the ref's dark pits with a single crisp lit chip (R3, R11 edge scrap) are replaced by bright glow blobs or dark slits.
7. Blown tops: the renders' main domes sit 15–20 L higher than the ref (c05 187 vs 169) with no gradient across the face; the ref keeps a gradient and creases even at the brightest point.
