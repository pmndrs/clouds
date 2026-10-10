# D1g blind judge — Opus (2026-10-11)

Set: `scratchpad/blind-d1g/` (d01–d12 full frames, c01–c33 zoom crops). Judged blind: no key, no D1 report, no earlier judge files.
Method: rubric judging method first. I grouped the frames by framing, picked the reference by silhouette (the two renders share geometry exactly; the reference differs). Crops were mapped by NCC template matching (`python -I`; every crop is a 2× upsample of a frame region). I viewed every crop at native size, then made 1×–3× sub-crops of the lit faces, shade sides, silhouettes and trunk. Pixel statistics came last, as a cross-check only.
All coordinates below are **full-frame pixels (1920×1080)** of the image named.

## Grouping and reference

| Framing | Reference | Renders | Variant X (deep sky, crisp) | Variant Y (pale sky, soft/hazy) |
|---|---|---|---|---|
| A tall tower (Parkouring-type) | **d08** | d01, d05 | d01 | d05 |
| B wide flat-topped cumulus | **d04** | d02, d03 | d02 | d03 |
| C deck with right tower, close | **d10** | d07, d11 | d11 | d07 |
| D deck with right tower, far | **d09** | d06, d12 | d06 | d12 |

The two render sources stay consistent across framings. **X** = {d01, d02, d06, d11}: darker, more saturated sky, crisper silhouettes, more contrast, deeper shade. **Y** = {d03, d05, d07, d12}: paler sky, hazier and softer, lower contrast.
The references share a look: warm pink-cream cloud, lit crests with dense fine florets, lighter and evenly mottled shade, a white horizon haze. They also carry capture artefacts that I did not score: faint horizontal scan-line banding (c18, c20, c32), arc and streak lines in the sky (c01, c06) and block compression.

## Crop map (frame region x, y, w, h; reference first)

| Region | Frame box | Ref | X | Y |
|---|---|---|---|---|
| R1 B left foot | 40,520 560×340 | c01 | c05 (d02) | c30 (d03) |
| R7 B crown + core | 560,180 700×500 | c15 | c11 (d02) | c09 (d03) |
| R3 A tower top | 500,100 700×450 | c06 | c03 (d01) | c19 (d05) |
| R9 A lower-right shade | 960,620 300×300 | c18 | c26 (d01) | c31 (d05) |
| R11 A trunk | 652,600 700×300 | c32 | c28 (d01) | c23 (d05) |
| R4 C tower shade patch | 1200,300 200×200 | c04 | c33 (d11) | c22 (d07) |
| R6 C tower | 1150,180 400×520 | c16 | c29 (d11) | c08 (d07) |
| R8 C left crown | 350,330 500×330 | c20 | c14 (d11) | c10 (d07) |
| R2 D lower deck | 300,560 900×300 | c13 | c02 (d06) | c24 (d12) |
| R5 D tower | 1100,148 480×560 | c07 | c12 (d06) | c17 (d12) |
| R10 D deck patch | 820,540 220×160 | c21 | c25 (d06) | c27 (d12) |

## Scores (1–10, harsh). S = surface, Sh = shading, C = colour, E = edges, O = overall

### Full frames

| Framing | Image | S | Sh | C | E | O |
|---|---|---|---|---|---|---|
| A (ref d08) | d01 | 3 | 4 | 3 | 4 | 3 |
| A | **d05** | 3 | 5 | 4 | 4 | **4** |
| B (ref d04) | **d02** | 4 | 5 | 3 | 5 | **4** |
| B | d03 | 3 | 4 | 4 | 3 | 3 |
| C (ref d10) | d07 | 3 | 4 | 5 | 2 | 3 |
| C | **d11** | 3 | 5 | 4 | 5 | **4** |
| D (ref d09) | **d06** | 3 | 4 | 4 | 5 | **4** |
| D | d12 | 2 | 4 | 3 | 2 | 3 |

### Crops

| Region | Crop | S | Sh | C | E | O | Note |
|---|---|---|---|---|---|---|---|
| R1 | **c05** d02 | 3 | 5 | 3 | 4 | **4** | Smooth grey blob. The reference foot has fibrous wisps and florets. |
| R1 | c30 d03 | 2 | 3 | 3 | 2 | 2 | Washed into the sky, almost no edge. |
| R7 | **c11** d02 | 4 | 4 | 4 | 4 | **4** | Matches the reference's mid-band texture energy. Crown is smooth rolls, not a floret crust. |
| R7 | c09 d03 | 3 | 4 | 4 | 3 | 3 | Softer rolls; pale discs in the body. |
| R3 | c03 d01 | 3 | 4 | 3 | 4 | 3 | Plastic lit face, too-white highlight, shade too deep and cool. |
| R3 | **c19** d05 | 3 | 5 | 3 | 4 | **4** | Shade depth right (p10 equals the reference's); lit face still smooth. |
| R9 | c26 d01 | 3 | 3 | 4 | 3 | 3 | Slit and white lip break the reference's flat shade. |
| R9 | **c31** d05 | 4 | 5 | 4 | 4 | **4** | Closest flat shade; crease still too defined. |
| R11 | c28 d01 | 3 | 3 | 3 | 3 | 3 | Pit plus slit; torn lit tatters on the right silhouette. |
| R11 | **c23** d05 | 3 | 4 | 4 | 3 | 3 | One pit; tatters milder. Narrow win. |
| R4 | c33 d11 | 2 | 3 | 3 | 4 | 2 | Leopard-spot dark discs. |
| R4 | **c22** d07 | 4 | 4 | 3 | 4 | **4** | Clean but cool blue-grey; the reference is warm mauve. |
| R6 | c29 d11 | 2 | 3 | 4 | 5 | 3 | Crisp silhouette, but the shade cavity is a honeycomb of discs and too deep. |
| R6 | **c08** d07 | 3 | 4 | 3 | 2 | 3 | Shade depth right, but the whole tower looks out of focus. Narrow win. |
| R8 | **c14** d11 | 3 | 4 | 4 | 4 | **4** | Edges and sculpting close; whorl patch at the bottom right. |
| R8 | c10 d07 | 3 | 3 | 4 | 2 | 3 | Blurred, flat. |
| R2 | c02 d06 | 2 | 3 | 4 | 4 | 3 | Over-lit, flat base; whorl patch. |
| R2 | c24 d12 | 3 | 4 | 3 | 2 | 3 | Has the reference's darker base band, but lavender and mushy; greenish sky. |
| R5 | **c12** d06 | 3 | 3 | 3 | 4 | **3** | Reference tower is front-lit florets; render is a smooth beige lit face with a smoky dark shade and discs. |
| R5 | c17 d12 | 2 | 3 | 3 | 2 | 2 | Same, plus haze and soft edges. |
| R10 | c25 d06 | 1 | 4 | 4 | 4 | 2 | Whorl (contour lines) fills a third of the crop. |
| R10 | **c27** d12 | 3 | 4 | 4 | 3 | **3** | Mushy but clean. |

## Winners

| Framing | At distance | Up close | Comment |
|---|---|---|---|
| A (ref d08) | **d05** (Y) | **d05** (Y) | 3 of 3 regions. Closer shade depth, edge contrast and sky. |
| B (ref d04) | **d02** (X) | **d02** (X) | 2 of 2. d03's haze erases the foot (R1). |
| C (ref d10) | **d11** (X) | **d07** (Y), narrowly | d11 reads right at distance (crisp, sculpted belly). Up close its hero shade is a disc honeycomb (R4, R6), while d07 is clean but blurred. R8 goes to d11. Near tie. |
| D (ref d09) | **d06** (X) | **d06** (X), narrowly | Crop totals tie (8–8). d06 wins the hero tower (R5); d12 wins R10 only because d06 carries the whorl there. |

Neither variant wins outright. X is closer at distance in 3 of 4 framings, Y in A. Up close the split is 2–2. X brings crisp silhouettes and sculpting, but it also carries the hard artefacts: both whorl patches and the disc honeycomb. Y is cleaner but hazy or out of focus, worst in C (d07) and D (d12).

## Hard artefacts (frame coordinates)

References: none from the renderer. Capture artefacts only: horizontal scan-line banding in shade and sky (d08 near 960–1260, 620–920; d10 sky), sky streaks and arcs (d04 upper-left sky; d08 near 520–650, 100–500), block compression.

**d01 (A, X)**
- Pit, a dark hollow in the trunk: (922–967, 736–796).
- Slit, a dark vertical crease: (1117–1130, 750–786).
- Glow and hard edge, a bright white sharp-edged lip on the right silhouette: (1200–1225, 620–735).
- Torn lit tatters, serrated, on the right silhouette: about (1200–1290, 600–700).
- Faint dark fleck on the lit tower face: about (810–830, 345–352).
- Pale bokeh-like discs in the right shade: (1060–1150, 400–520).

**d05 (A, Y)**
- Pit: (902–962, 698–748).
- Dark notch: (1037–1067, 638–673).
- Softer slit or streak: (1132–1157, 728–798).
- Dark fleck or slit on the lit tower face: (803–818, 345–356), more visible than in d01.
- Faint peach glow patch on the lit face: about (920–950, 235–265).
- Pale discs in the right shade: (1060–1130, 440–500).
- Milder lit lip on the right silhouette: (1200–1230, 650–720).

**d02 (B, X)**
- Pale glowing discs in the core: (840–860, 495–510).
- Bright flecks in the core: (896, 495) and around (880–960, 560–620).
- Lit-rimmed pocket: (1160–1190, 552–574). The reference has this as a crease.

**d03 (B, Y)**
- Pale glowing discs in the core: (818–856, 499–545), (938–983, 615–655).
- Pocket: (1160–1190, 552–574).
- Haze dissolves the left foot silhouette: (290–600, 700–860).

**d11 (C, X)**
- Disc honeycomb, 8 or more overlapping dark circular blotches across the hero tower's shade cavity: (1170–1370, 350–485).
- Whorl, contour-line or fibre swirl texture: (780–880, 520–620).
- Glowing white curl: (905–935, 535–580).
- Straight vertical cut edge on a lobe: (1022–1030, 530–610).
- Detached fleck at the tower top: about (1314, 207–216).

**d07 (C, Y)**
- Global defocus-like blur on silhouettes and surfaces, worst on the tower: (1150–1550, 180–700); and the left crown: (350–850, 330–660).
- Pale discs in the tower shade: about (1230–1290, 400–450).
- Pale disc: (526–556, 594–620).
- Pale glow where d11 has the whorl: (805–850, 530–560).
- Glowing curl: (910–940, 540–577).

**d06 (D, X)**
- Whorl, strong contour-line or wood-grain terracing on a lit patch: (890–1010, 540–627).
- Dark-rimmed sky hole: (1070–1100, 563–608).
- Pale discs in the tower shade: (1369–1389, 463–488), (1419–1434, 523–543).
- Smoky near-black smear at the tower base: about (1380–1440, 560–620).
- Detached fleck at the tower top: (1343, 238).

**d12 (D, Y)**
- Pale discs in the tower shade: (1276–1306, 423–458), (1391–1421, 483–513).
- Dark-rimmed sky hole: about (1060–1100, 560–610).
- Global haze or mush on the deck and tower edges.
- Greenish-cream horizon band, a colour error rather than a structural one.

## Main remaining differences from the reference (biggest first)

1. **Lit-face surface.** The references carry dense small cauliflower florets and mottle across every lit crest and face, at roughly 3–15 frame px (R3, R5, R6, R7, R8). Both renders give smooth plastic domes and rolls. This is the single biggest "not the same engine" cue, up close and at distance.
2. **Shade character.** The reference shade is light, warm and evenly mottled, with one or two broad dark pockets. The renders' shade is built from discrete lobes with cut-out edges, plus pale or dark discs, slits and pits. X is also too deep and cool (d11 tower, d06 tower base, d01 right side). Y gets the depth closer, but the lobes and discs remain.
3. **Colour.** All references are warm pink-cream: R−B is about +15 on A and B, smaller on C and D. Both renders are neutral or grey, and Y adds a lavender or green cast (d12). Skies are off: X is too navy or royal, Y is closer on A and B but green on D. The references' white horizon haze is missing or mis-coloured.
4. **Edges.** Reference crests are crisp with fine serration, and the thin feet are wispy and fibrous. X has the right sharpness but smooth outlines, plus torn lit tatters on the A trunk. Y is too soft: hazed on B and D, blurred on C.
5. **Hard artefacts in X.** Two whorl patches (d06, d11) and the disc honeycomb (d11). Y has the same features only as mild pale glows, which suggests Y's haze or blur is hiding them, not fixing them.
6. **Light distribution.** The references put a bright lit band on crests with mid-tone shade immediately below (R7). The renders light the whole upper body evenly (d02, d03 crown; d06 over-lit deck), and the D frame's lower deck lacks the reference's dark base band (c02).

Pixel cross-check (crops at native, cloud mask): reference mid-band energy beats both renders on lit regions (R3 3.9, R5 4.6, R6 5.3) except c03 and c11, where it comes from lobe edges, not florets. Reference shade regions (R9 0.8, R11 1.5) are flatter than either render. Mean R−B gap: reference +8 to +22, renders −4 to +9. The statistics agree with the visual calls above.
