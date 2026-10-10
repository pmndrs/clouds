# D1 blind set i — judge: Opus (blind)

Set: `scratchpad/blind-d1i/` (d01–d12 frames 1920x1080, c01–c36 crops at 2x of the 1080p frame). I did not open the key or any D1 report, results file or earlier judge file. I followed the rubric's judging method: I looked at every region at native resolution, then at 1:1 and 2-3x sub-crops. Pixel statistics were run only afterwards, as a cross-check.

Coordinates are frame pixels (1920x1080) unless marked otherwise.

## Grouping

Grouped by downsampled-luminance distance, then confirmed by eye. The reference in each framing is the frame with a different sky and grade (teal sky with a white horizon, or a pink/salmon cast) and the low-res crumbly Decima surface.

| Framing | Content | Reference | Renders |
|---|---|---|---|
| A | long body plus right tower, side light | **d01** | d03, d11 |
| B | tall tower with a narrow trunk | **d02** | d06, d10 |
| C | wide block with a left leg | **d05** | d04, d08 |
| D | long body plus right tower, closer | **d07** | d09, d12 |

Crop map (crop x, y, w, h in frame pixels; crops are 2x upscales of these boxes). I matched them by NCC template matching (1.000). For R09, which is flat, I used SSD.

| Region | Box | Ref | Renders |
|---|---|---|---|
| A-R02 tower | 1100,150,480,560 | c20 (d01) | c02 (d03), c26 (d11) |
| A-R10 left body / base | 300,560,900,300 | c10 | c14 (d03), c22 (d11) |
| A-R25 body interior | 820,540,220,160 | c25 | c36 (d03), c34 (d11) |
| B-R18 tower top | 500,100,700,450 | c32 (d02) | c18 (d06), c29 (d10) |
| B-R03 trunk wide | 650,600,700,300 | c33 | c03 (d06), c11 (d10) |
| B-R01 trunk detail | 960,620,300,300 | c19 | c35 (d06), c01 (d10) |
| C-R08 main mass | 560,180,700,500 | c28 (d05) | c08 (d04), c15 (d08) |
| C-R06 left leg | 40,520,560,340 | c30 | c06 (d04), c27 (d08) |
| C-R09 chip / pit | 1100,500,160,120 | c09 | c13 (d04), c21 (d08) |
| D-R04 tower | 1150,180,400,520 | c24 (d07) | c04 (d09), c12 (d12) |
| D-R05 left crests | 350,330,500,330 | c05 | c23 (d09), c17 (d12) |
| D-R07 tower shade | 1200,300,200,200 | c16 | c07 (d09), c31 (d12) |

## Frame scores (1–10, harsh)

| Framing | Image | surface | shading | colour | edges | overall | at distance | up close |
|---|---|---|---|---|---|---|---|---|
| A (ref d01) | d03 | 4 | 3 | 3 | 4 | **4** | **winner** | **winner** |
| | d11 | 2 | 4 | 3 | 3 | 3 | | |
| B (ref d02) | d06 | 3 | 3 | 2 | 3 | 3 | **winner** (marginal) | |
| | d10 | 3 | 3 | 2 | 3 | 3 | | **winner** (fewer fingerprints) |
| C (ref d05) | d04 | 3 | 3 | 2 | 3 | 3 | | |
| | d08 | 4 | 3 | 2 | 3 | 3 | **winner** | **winner** (narrow) |
| D (ref d07) | d09 | 3 | 3 | 3 | 3 | 3 | **winner** (lighter belly) | |
| | d12 | 4 | 2 | 3 | 4 | 3 | | **winner** (crest relief) |

Notes per framing:
- **A**: d01's lit crests are crisp cauliflower domes with fine grain, and its shade is light, cool and grey. d03 keeps some dome outlines on the tower and the left top cluster, but its tower trunk falls into a charcoal-brown core far deeper than the frame's. d11 is the same form melted into smooth plaster balloons and softly defocused, with a lighter but still too-dark trunk. Both renders are cream/beige where the frame is pink-white, and the sky is saturated blue where the frame's is teal with a white horizon.
- **B**: d02 is salmon-pink and evenly crumbly everywhere, with a mottled mauve trunk and dark pits. Both renders have a smooth white balloon top with a crisp bumpy outline, a grey trunk and neutral/grey colour. d06 carries more structure (the right-hand lobes) and so reads a touch busier, like the frame, at distance. Up close the same structure turns into the trunk fingerprints (crescent ring, slit, pits) and warm glows; d10 has them too, only weaker.
- **C**: d05 is pink with a crumbly floret crest and a mottled shade. Both renders have a smooth, bright balloon crest and a grey centre that is much too contrasty against the crest: the 4–12 / 12–32 px band std is 2.06/4.05 against the frame's 0.71/1.69. d08's shade carries crumbly lit flecks that come closest to the frame's mottling, but its central glow disc is stronger than d04's.
- **D**: d07 is bright pink-white with mild grey only in recesses. Both renders carry a heavy grey underbelly and inter-lobe shade, and the camera does not match: the cloud sits lower and fills more of the frame, and the base is cut off. d12 has the most crest relief of the set: on R04 its floret blobs are 1.10 against the frame's 1.29, and d09's 0.81. But d12's belly is darker than d09's (p10 luma about 148 against 162), so d09 reads closer at distance.

## Crop scores (surface / shading / colour / edges / overall)

| Region | Crop | s | sh | c | e | o | Closer |
|---|---|---|---|---|---|---|---|
| A-R02 | c02 (d03) | 3 | 2 | 3 | 3 | 3 | **c02** |
| | c26 (d11) | 2 | 3 | 3 | 2 | 2 | |
| A-R10 | c14 (d03) | 3 | 3 | 3 | 4 | 3 | **c14** |
| | c22 (d11) | 2 | 3 | 3 | 3 | 2 | |
| A-R25 | c36 (d03) | 3 | 3 | 3 | n/a | 3 | |
| | c34 (d11) | 4 | 3 | 3 | n/a | 4 | **c34** (ref is smooth here) |
| B-R18 | c18 (d06) | 3 | 3 | 2 | 4 | 3 | tie |
| | c29 (d10) | 3 | 3 | 2 | 4 | 3 | tie |
| B-R03 | c03 (d06) | 2 | 3 | 2 | 3 | 2 | |
| | c11 (d10) | 3 | 3 | 2 | 3 | 3 | **c11** |
| B-R01 | c35 (d06) | 2 | 3 | 2 | 4 | 2 | |
| | c01 (d10) | 3 | 3 | 2 | 4 | 3 | **c01** |
| C-R08 | c08 (d04) | 3 | 3 | 2 | 4 | 3 | |
| | c15 (d08) | 4 | 3 | 2 | 4 | 3 | **c15** (surface; glow worse) |
| C-R06 | c06 (d04) | 3 | 4 | 2 | 3 | 3 | **c06** (marginal) |
| | c27 (d08) | 3 | 4 | 2 | 2 | 3 | |
| C-R09 | c13 (d04) | 2 | 3 | 3 | n/a | 2 | **c13** (marginal) |
| | c21 (d08) | 2 | 3 | 3 | n/a | 2 | |
| D-R04 | c04 (d09) | 2 | 3 | 3 | 3 | 3 | |
| | c12 (d12) | 4 | 3 | 3 | 4 | 3 | **c12** |
| D-R05 | c23 (d09) | 2 | 4 | 3 | 3 | 3 | |
| | c17 (d12) | 4 | 4 | 3 | 4 | 4 | **c17** |
| D-R07 | c07 (d09) | 2 | 3 | 3 | n/a | 2 | |
| | c31 (d12) | 3 | 3 | 3 | n/a | 3 | **c31** |

Region notes:
- **A-R02 (tower)**: the frame's lit top is a stack of crisp domes with a crumb/grain texture and fine-fringed edges. c02 is a smooth balloon with faint large lobes and a soft edge; c26 is smoother still. In both renders the right side of the trunk falls into a dark core with lit "fingers" below it; the frame's trunk is mid-grey and even.
- **A-R10 (left body)**: the frame has grainy soft domes and a darker mauve band along the base. c14 has curving crease flutes (whorl-like lines) on the top-left mass and a beaded row of small crisp puffs on the silhouette; c22 is featureless haze. Both bases are lighter and warmer than the frame's.
- **A-R25 (interior)**: the geometry differs: the frame shows sky between lobes at the top of the box, while ours show a lobe. c36 shows disc-like lobe outlines with a beige tint; c34 is smoother, which is closer to the frame's soft interior.
- **B-R18 (tower)**: the frame is soft and crumbly-mottled throughout, salmon-pink. Ours have a crisp bumpy silhouette, a smooth white cap and a grey trunk, and the right-hand lobes are sharply separated with warm glows (c18 more than c29). The floret metric ties (blobs 1.48 for the frame, 1.41 and 1.42 for ours), but ours have far more 4–32 px energy (2.26/4.39 against 1.34/3.52) because the light/shade contrast is too strong.
- **B-R03 / R01 (trunk)**: the frame is a mottled mauve with soft dark patches and a pink lit rim. c03/c35 carry a bright crescent ring, a vertical slit, dark pits and bright round blotches, plus a crisp white serrated bulge on the right silhouette. c11/c01 carry the same features, fainter. On the floret balance, c33 has domes about equal to pits (−0.08); c11 is +0.34 and c03 +0.70.
- **C-R08**: the frame's crest is a crumbly floret texture; both renders' crests are smooth balloons. The frame's centre is an even mottle; c08 is a smooth grey with a beige glow disc. c15 has more crumbly lit flecks, which come closer to the frame's mottle, but a stronger glow disc.
- **C-R06 (leg)**: the frame's leg is crumbly with crisp, serrated, pink-lit edges. Ours are smooth cream blobs with soft edges and a punched hole; c27 is hazier.
- **C-R09**: the frame has a soft dark-ringed pit with a small bright wedge. Ours show a flat, lit plateau ("chip") with a crisp outline; c21 adds a warm orange fleck at its tip.
- **D-R04 / R05**: the frame's crests are crisp crenellated domes with grain. c12/c17 show dome outlines on the crest; c04/c23 are blurred balloons. In the tower centre c04 shows round blotch discs; c12 has vertical streak flutes on the right lit edge. Both show warm brown glow patches in the shade core.
- **D-R07**: the frame has a smooth pink-grey surface with a dark hollow. Ours are blue-grey with round bright disc blotches, stronger in c07.

## Hard artefacts per image (frame px)

**d03 (A)**
- Charcoal-brown shade core on the tower trunk, far deeper than the frame's: (1370–1450, 555–640).
- Faint circular blotch/disc outlines on the tower's shade face: (1390–1470, 510–600).
- Lit finger puffs under the dark core, not in the frame: (1357–1422, 625–660).
- Crease flutes/whorls on the top of the left body: (515–650, 575–660).
- Beaded/serrated row of small crisp puffs on the left-body silhouette: (450–520, 560–610).
- Faint yellow fleck: (527, 640).
- Disc lobe outline: (995–1040, 540–590).
- Haze/defocus on the lit tower crest: (1350–1600, 200–300).

**d11 (A)**
- Tower trunk core too dark, but lighter than d03's: (1380–1450, 560–640).
- The same finger puffs: (1357–1422, 625–660).
- Weaker discs on the shade face: (1390–1470, 510–600).
- Serrated puff row: (450–520, 560–610).
- Global haze/defocus: plaster balloons on the tower top (1350–1600, 200–450) and the left body (450–900, 560–700).

**d06 (B)**
- Bright crescent ring: (1075–1100, 700–741).
- Vertical dark slit: (1122–1128, 720–790).
- Dark pits: (900–930, 720–746).
- Bright round blotches: (1070–1090, 806–826).
- Crisp white serrated bulge on the right silhouette of the trunk: (1200–1295, 600–730).
- Warm glow patches in the shaded right-hand lobes: (1067–1117, 415–465).
- Smooth balloon cap with a crisp bumpy outline (the frame's is soft and crumbly): (700–900, 120–250).

**d10 (B)**
- Crescent ring, faint: (1082–1092, 705–737).
- Slit, faint: (1124, 720–780).
- Serrated white bulge: (1200–1295, 600–730).
- Weak glows in the right lobes: (1067–1117, 415–465).
- Smooth balloon cap: (700–900, 120–250).

**d04 (C)**
- Warm beige glow disc in the shade centre: (958–1023, 465–515).
- Flat bluish lit chip with a crisp outline where the frame has a pit: (1150–1190, 545–575).
- Smooth balloon crest with a crisp edge: (650–1000, 220–300).
- Hazy, defocused left leg with a punched hole: hole at (365, 776), leg (300–420, 735–850).

**d08 (C)**
- Stronger glow disc: (954–1020, 465–520).
- Warm orange fleck at the tip of the chip: (1155–1165, 552–562).
- Lit chip: (1150–1190, 545–575).
- Crumbly bright flecks in the shade: (899–979, 430–505). Partly what the frame has, but too bright.
- Hazy leg and hole: (365, 776).

**d09 (D)**
- Floating dark speck in the sky above the left crest: (780, 331).
- Warm brown glow patches in the tower's shade core: (1265–1290, 465–500).
- Circular blotch discs on the tower's shade face: (1238–1338, 370–455).
- Bright round blotch discs: (1365–1390, 390–415), (645, 621), (762, 633).
- Haze/defocus on all lit crests.
- Heavy grey underbelly.

**d12 (D)**
- Floating speck: (780, 331).
- Glow patches: (1269–1289, 470–495).
- Vertical streak/smear flutes on the tower's right lit side: (1420–1430, 305–455).
- Weaker blotch discs: (645, 621), (1365–1390, 390–415).
- Darkest underbelly of the set: the bottom band of the frame below y ≈ 900.
- Mild concentric dome rings on the upper left lobe: (630–825, 360–460).

## Main remaining differences, biggest first

1. **Crest surface.** Every frame's lit crests carry fine cauliflower florets with crumb/grain, crisp but fringed. Ours are smooth balloons with soft, defocused edges. On A-R02 the frame has 2.08 floret blobs per 1e4 lit px against 0.94 (d03) and 0.45 (d11), and 4–12 / 12–32 px band std of 1.36/3.13 against 0.58/1.20 and 0.44/1.00. The same holds on D-R04 and D-R05.
2. **Shade depth and contrast.** Ours are much darker and greyer in the shade than every frame: the A and D tower trunks, the D underbelly, and the C centre (band std 2.06/4.05 against 0.71/1.69). The frames keep the shade light, pink-mauve and evenly mottled.
3. **Colour and grade.** The frames are pink-white (A, D) or salmon (B, C), with a teal or grey-blue sky and a pale horizon. Ours are neutral grey or cream/beige with a saturated blue or purple sky. Colour is never above 3.
4. **Shade fingerprints.** Glow discs and patches (C centre, D tower), the B trunk's crescent ring, slit and pits, round blotch discs (D), the lit chip with an orange fleck (C), the dark core with lit fingers (A), and a floating speck (D).
5. **Edges and geometry.** The frames' silhouettes are crisp and crumbly-serrated. Ours are either soft and hazy (legs, crests) or have isolated crisp white bulges (the B trunk). The D camera does not match (the cloud is lower and larger), the C cloud sits about 15 px lower, and the A interior lobes differ (R25).
