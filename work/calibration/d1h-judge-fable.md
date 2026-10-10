# D1 blind set h — judge: Fable (2026-10-11)

Blind. No key, no D1 report, no earlier judge files read. Method per `rubric.md` (judging method section): full frames first for the distance call, then every crop at native resolution, then 1:1 and 2x sub-crops on lit faces, crests, shade sides, silhouettes, creases and trunk. Pixel statistics (absolute band std at 1-3 / 4-12 / 12-32 px over each whole crop) run last, as a cross-check only.

## 1. Grouping and references

Frames grouped by low-res correlation (0.96-1.00 between the two renders of a framing, 0.76-0.90 to the reference), then confirmed by eye. Crops mapped to frames by zero-mean NCC; every crop matched at scale 0.5 (the crops are 4k-native, the frames 1080p) with NCC >= 0.992.

| Framing | Reference | Render X | Render Y | Crops (ref / X / Y) |
|---|---|---|---|---|
| A: wide cloud, tower right, blue sky | d03 | d01 | d09 | R1 base strip (frame 300,560 900x300): c02 / c14 / c01. R2 tower (1100,148 480x560): c22 / c13 / c09. R3 crease between bodies (820,540 220x160): c16 / c29 / c25 |
| B: tall vertical cloud, grey-blue sky | d02 | d04 | d06 | R4 lower body (652,600 700x300): c03 / c21 / c32. R5 top (500,100 700x450): c05 / c28 / c26. R6 trunk (960,620 300x300): c08 / c33 / c04 |
| C: wide cumulus, grey sky | d07 | d08 | d10 | R7 lower-left leg (40,520 560x340): c17 / c07 / c18. R8 main body (560,180 700x500): c20 / c19 / c31 |
| D: same cloud as A, closer framing | d12 | d05 | d11 | R9 left body (348,332 500x330): c06 / c10 / c23. R10 tower (1152,180 400x520): c27 / c24 / c12. R11 tower crest shade (1200,300 200x200): c30 / c15 / c11 |

Reference picks: d03, d02, d07, d12. They are the odd one out in each triple (warm cream/pink tint, hazier lower sky, fine floret texture with visible compression grain, flat dark bases); the other two in each framing share one look and differ only in fine detail.

Variant identification (my inference, not from any key): the renders split into two consistent variants across all four framings. **X = {d01, d04, d08, d05}**: sharper, carries a fingerprint-like striation ("whorl") patch, hard disc blotches in the shade, detached crest flecks, hard white chips. **Y = {d09, d06, d10, d11}**: the same shape and lighting, softer; the discs and whorl are suppressed, the hard chips softened. X reads as the sharper history filter / less temporal smoothing of the same look; Y as the smoother one.

## 2. Winners

| Framing | At distance | Up close | Margin |
|---|---|---|---|
| A (ref d03) | **d09** (Y) | **d09** (Y) | small; d01 adds a whorl and a detached crest fleck, d09's right flank has a little more shade depth |
| B (ref d02) | **d06** (Y) | **d06** (Y) | small; both have the same pits/slit/white blob on the trunk, d06's are softer |
| C (ref d07) | **d10** (Y) | **d10** (Y) | small-moderate; d08's shade is broken into hard ink-stain blotches with a hard white chip, d10 softens both |
| D (ref d12) | **d11** (Y) | **d11** (Y) | moderate; d05's shade face is tiled with discs and striations, d11's is not, and d11's crest tone is nearer the frame |

Y wins all eight calls, but by a margin far smaller than the gap between either render and its reference. Neither variant would pass as "same cloud, same engine" in any framing.

## 3. Scores (1-10, harsh; surface / shading / colour / edges / overall)

### Full frames

| Image | Framing | Var | Surface | Shading | Colour | Edges | Overall | Notes |
|---|---|---|---|---|---|---|---|---|
| d01 | A | X | 3 | 4 | 4 | 4 | 4 | balloon lobes, no florets; whorl on the base at (900-1010, 560-635); sky too deep a blue, cloud too white |
| d09 | A | Y | 3 | 5 | 4 | 4 | 4 | same, no whorl; right flank shade slightly deeper and better placed |
| d04 | B | X | 2 | 3 | 3 | 3 | 3 | blown-out white top where the frame is textured pink; trunk carved with a ring, pits and a vertical slit; serrated white bulge on the right silhouette |
| d06 | B | Y | 3 | 4 | 3 | 4 | 3 | same carving, softer; still blown-out |
| d08 | C | X | 2 | 3 | 3 | 3 | 3 | smooth grey balloons; shade centre broken into hard dark blotches; hard white chip at (1153-1208, 550-580) |
| d10 | C | Y | 3 | 4 | 3 | 4 | 3 | blotches softened, chip softened but present; still no fibre, tops too bright |
| d05 | D | X | 3 | 4 | 4 | 4 | 4 | discs across the tower's shade face (1190-1290, 410-480); striation patch at (786-852, 532-602); spike on the crest at (1322, 210) |
| d11 | D | Y | 3 | 5 | 4 | 5 | 4 | discs faint, no striations; closest render in the set but still smooth and blue-white |

### Crops

| Crop | Region | Var | Surface | Shading | Colour | Edges | Overall | Notes |
|---|---|---|---|---|---|---|---|---|
| c14 | A-R1 base | X | 3 | 4 | 4 | 4 | 3 | whorl; base edge diffuse, no flat dark underside |
| c01 | A-R1 base | Y | 3 | 4 | 4 | 4 | 4 | no whorl; same pale, soft base |
| c13 | A-R2 tower | X | 2 | 4 | 4 | 3 | 3 | one smooth balloon where the frame has 20-40 px florets and grain; detached fleck on the crest; serrated flank with a dark pit |
| c09 | A-R2 tower | Y | 3 | 5 | 4 | 4 | 4 | same balloon, flank lumps softer, no fleck |
| c29 | A-R3 crease | X | 2 | 4 | 4 | 3 | 2 | fingerprint whorl fills the crop; the frame shows a sky gap here that the renders do not |
| c25 | A-R3 crease | Y | 3 | 4 | 4 | 4 | 3 | smooth, ghosted; no whorl |
| c21 | B-R4 lower | X | 2 | 3 | 3 | 3 | 2 | eye-socket ring, vertical slit, hard white serrated blob; frame is soft pink fibre |
| c32 | B-R4 lower | Y | 3 | 3 | 3 | 3 | 3 | same features softened; dark pit at (942,330) |
| c28 | B-R5 top | X | 2 | 3 | 3 | 3 | 2 | blown-out white, no texture; hard cut-out junction between lobes with a fleck |
| c26 | B-R5 top | Y | 2 | 3 | 3 | 4 | 3 | blown-out, smoother junction |
| c33 | B-R6 trunk | X | 2 | 2 | 3 | 3 | 2 | ring, slit, bright rim; frame is haze with sky showing bottom right |
| c04 | B-R6 trunk | Y | 2 | 3 | 3 | 3 | 2 | slit remains; mottle softer |
| c07 | C-R7 leg | X | 2 | 3 | 3 | 3 | 2 | flat grey blob with clean hard edge; frame is torn pink fibre |
| c18 | C-R7 leg | Y | 2 | 3 | 3 | 4 | 3 | same blob, edge softer |
| c19 | C-R8 body | X | 2 | 3 | 3 | 3 | 2 | ink-stain blotches with hard edges in the shade; bright flecks; hard white chip at (1186-1296, 740-800) |
| c31 | C-R8 body | Y | 3 | 4 | 3 | 4 | 3 | blotches softer; chip at (1197-1282, 745-800) still hard-edged |
| c10 | D-R9 left | X | 3 | 4 | 4 | 4 | 3 | striation patch at right edge (868-1000, 400-540); dark stain on a lit lobe at (276-316, 430-460) |
| c23 | D-R9 left | Y | 3 | 5 | 4 | 5 | 4 | smooth lobes, no striations; still no florets, too blue-white |
| c24 | D-R10 tower | X | 2 | 3 | 4 | 3 | 3 | discs 60-80 px across the shade face; hard cut edge between lit lower lobe and shade (216-286, 620-880); spike on the crest; serrated right silhouette |
| c12 | D-R10 tower | Y | 3 | 4 | 4 | 4 | 4 | discs faint; cut edge softer but present |
| c15 | D-R11 crest | X | 2 | 3 | 3 | 3 | 2 | discs dominate (dark circles ~70 px); crop mean 0.59 vs frame 0.68, shade too deep |
| c11 | D-R11 crest | Y | 3 | 4 | 4 | 4 | 3 | discs faint, mottle at (65-155, 160-250); tone 0.66 vs 0.68 |

## 4. Hard artefacts per image (crop pixel coordinates; frame 1080p coordinates in brackets where useful)

### Variant X

**d01 / c14 / c13 / c29**
- Whorl (fingerprint striations, concentric ripples) on the base top-right: c14 (1200-1420, 0-150), c29 (130-300, 30-170) [d01 frame (885-1010, 555-635)]. Absent from d09.
- Detached fleck/spike on the tower crest: c13 (488, 185) [d01 (1344, 240)].
- Dark pit at the tower's foot: c13 (600, 920) [d01 (1400, 608)].
- Serrated/scalloped flank silhouette: c13 right edge (680-760, 540-900).
- Small detached round puff with a hard edge off the left body: c14 (311-326, 250-275).
- Soft, pale base edge where the frame has a flat dark underside: c14 (700-1800, 330-420).

**d04 / c21 / c28 / c33**
- Eye-socket ring (bright arc around a dark pit): c21 (796-896, 200-290), c33 (186-276, 150-250) [d04 (1050-1100, 695-745)].
- Vertical dark slit: c21 (941-961, 230-520), c33 (321-336, 180-420) [d04 (1120-1132, 710-860)].
- Hard-edged bright white serrated bulge on the right silhouette: c21 (1116-1296, 0-270) [d04 (1210-1300, 600-735)].
- Detached round puff with hard edge: c21 (256, 380); sky notch at (216, 520).
- Serrations on the top dome edge: c28 (456-476, 130-200).
- Hard cut-out junction between the two left lobes with a fleck: c28 (256-296, 800-860), fleck (261, 815) [d04 (628-648, 500-530)].
- Blown-out top: c28 p90 0.916 vs frame 0.875; zero visible texture over (300-780, 0-480).

**d08 / c07 / c19**
- Hard white chip (sparkle) in the shade pocket: c19 (1186-1296, 740-800), with crisp white specks at its left tip (1183, 745) [d08 (1153-1208, 550-580)]. The frame has a soft lit edge here, c20 (1240, 690), a fraction of the size and contrast.
- Ink-stain blotches (dark patches with hard edges) in the shade centre: c19 (496-596, 500-600), (656-696, 550-600) [d08 (808-858, 430-480)].
- Bright flecks in the shade: c19 (576, 640), (756, 530), (866, 680).
- Hard dark cut: c19 (1066-1096, 660-680).
- Serration flecks on the left crest: c19 (206-226, 130-150).
- Leg is a flat grey blob with a clean hard edge and a sky hole: c07 (651, 505) [d08 (365, 772)]; the frame's leg is torn fibre.

**d05 / c10 / c24 / c15**
- Discs (dark circular blotches 60-80 px) across the tower's shade face: c24 (76-136, 470-530), (196-256, 460-520), (96-176, 530-600), (216-276, 540-600); c15 (30-300, 150-350), one ~70 px circle at (93-168, 205-285) [d05 (1190-1350, 375-480)].
- Striation patch (whorl) on the left body: c10 (868-1000, 400-540) [d05 (786-852, 532-602)].
- Spike/detached fleck on the crest: c24 (341, 60) [d05 (1322, 210)].
- Hard cut edge between the lit lower lobe and the shade face: c24 (216-286, 620-880) [d05 (1260-1295, 490-620)].
- Serrated right lobe crest: c24 (616-666, 140-160); jagged right silhouette lower down (576-636, 620-740).
- Dark stain on a lit lobe: c10 (276-316, 430-460).
- Crest shade too deep: c15 mean 0.59 vs c30 0.68.

### Variant Y

**d09 / c01 / c09 / c25**
- Same balloon lobes and soft base; no whorl, no crest fleck.
- Flank lumps with soft dark creases: c09 (560-760, 600-900); silhouette less serrated than c13 but still knuckled.
- Ghosted/defocused crease region: c25 whole crop reads as out of focus.

**d06 / c32 / c26 / c04**
- Vertical dark slit: c32 (937-952, 290-470), c04 (307-332, 260-330) [d06 (1113-1128, 745-835)].
- Pits: c32 (542-612, 190-290), (942, 330).
- Same hard-edged white serrated bulge: c32 (1116-1300, 0-270).
- Detached puff: c32 (152, 400).
- Blown-out top: c26 p90 0.912; no texture.

**d10 / c18 / c31**
- White chip still hard-edged: c31 (1197-1282, 745-800) [d10 (1158-1201, 552-580)].
- Shade blotches softer than c19 but still patchy: c31 (500-700, 500-700); fleck at (682, 620).
- Leg blob, softer edge, sky bite: c18 (832, 475).

**d11 / c23 / c12 / c11**
- Faint discs/mottle on the crest shade: c11 (65-155, 160-250) [d11 (1232-1277, 380-425)].
- Cut edge between lit lobe and shade, softened: c12 (216-290, 620-880).
- Otherwise the cleanest render in the set: no whorl, no spike, no hard chip.

## 5. Pixel cross-check (after the visual pass)

Band std (x1000) at 1-3 / 4-12 / 12-32 px over each whole crop, luminance:

| Region | ref | X | Y | Reading |
|---|---|---|---|---|
| A-R1 | 1.5 / 4.7 / 9.2 | 2.6 / 4.5 / 8.0 | 2.6 / 4.5 / 7.9 | renders short at 12-32 (missing lobe relief on the base); their 1-3 px excess is dither/noise, not florets |
| A-R2 | 2.6 / 10.6 / 17.7 | 3.4 / 10.6 / 16.6 | 3.4 / 10.3 / 16.5 | near-equal; the metric does not see balloon-vs-floret because the silhouette dominates |
| A-R3 | 1.9 / 7.0 / 12.6 | 2.6 / 4.2 / 8.0 | 2.6 / 4.4 / 8.6 | renders 40 percent short at 4-32 px in the crease: the smallest-lobe layer is absent |
| B-R4 | 1.2 / 3.9 / 7.7 | 1.4 / 5.3 / 10.4 | 1.4 / 5.6 / 9.9 | renders over the frame: the ring/slit/pits add relief the frame does not have |
| B-R5 | 1.8 / 9.4 / 18.2 | 2.5 / 11.8 / 19.2 | 2.4 / 11.7 / 19.4 | renders higher from the blown-out white against sky; the top itself is textureless |
| B-R6 | 1.0 / 2.5 / 4.9 | 1.5 / 6.0 / 12.2 | 1.5 / 5.9 / 11.0 | renders 2.4x the frame at 4-32 px: the trunk is carved where the frame is haze |
| C-R7 | 1.4 / 6.4 / 12.1 | 1.1 / 5.0 / 8.6 | 1.1 / 5.0 / 8.9 | renders short at every band: the fibre is missing |
| C-R8 | 1.7 / 7.8 / 14.2 | 2.4 / 9.7 / 15.3 | 2.4 / 9.9 / 15.4 | renders higher: blotches and chip, not florets |
| D-R9 | 2.6 / 11.5 / 20.9 | 3.3 / 10.8 / 19.1 | 3.4 / 11.1 / 18.6 | near-equal |
| D-R10 | 3.7 / 15.7 / 25.8 | 3.9 / 13.6 / 21.1 | 4.4 / 14.6 / 22.5 | renders short at 12-32 (florets on the lit face) |
| D-R11 | 2.8 / 10.8 / 17.7 | 3.0 / 7.9 / 12.6 | 3.1 / 8.9 / 12.8 | renders 25-30 percent short at 4-32: the crest's small lobes are missing; X also 0.09 darker in mean |

Tone and colour: in B and C the renders are higher-contrast than the frames (p90 up 0.05-0.08, p10 down 0.05-0.06); in A and D the renders are bluer (R-B 0.01-0.035 further negative) and the sky a deeper blue. The references carry visible block-compression grain at 1-3 px; the renders' 1-3 px excess is a smooth dither, not that grain. The band metric confirms where relief is missing (R3, R7, R11) or invented (R4, R6, R8) but is blind to the shape of the detail (balloon vs floret) at R2 and R9, which is the main visual difference. It should not be used alone.

## 6. Main remaining differences from the reference, biggest first

1. **Surface detail is the wrong kind.** The frames' lit faces are built of 20-60 px florets with crisp lit crusts and small creases between them, down to grain. The renders' lit faces are large smooth balloons with almost no sub-lobe structure (A-R2, B-R5, C-R8, D-R9, D-R10). Where the renders do carry fine detail it is the wrong detail: fingerprint striations (X: c14, c29, c10), discs (X: c24, c15; faint in Y: c11), ink-stain blotches (c19, c31). No render crop has floret-scale structure the frame would recognise.
2. **Shade is painted, not volumetric.** The trunk and lower body in B (c21, c32, c33, c04) are carved with a ring, pits and a vertical slit where the frame is soft haze; C's shade centre (c19, c31) is broken into hard-edged blotches with bright flecks and a hard white chip; D's shade face (c24, c15) is tiled with discs. The frames' shade is a soft, continuous gradient with gentle mottle. Y reduces but does not remove this; the slit, chip and cut edge survive in d06, d10, d11.
3. **Edges: the lit silhouette is hard and serrated, the base and thin parts are not soft enough in the right way.** Tower crests and the B right bulge show scalloped/jagged outlines and detached flecks (c13, c21, c24, c28); C's leg is a clean-edged flat blob where the frame's leg is torn fibre (c07, c18). Meanwhile the frames' flat dark bases (c02) have a definite lower edge the renders lose to a pale diffuse fade (c14, c01).
4. **Tone and colour.** Renders are blue-white against a deep saturated sky; the frames are cream/pink against a paler, hazier sky with a bright horizon. In B and C the renders' tops are blown out (p90 0.91 vs 0.875) and the shade/sky darker, so contrast is too high; in D-R11 the X variant's crest shade is 0.09 too dark. The A/D frames also have a visible sky gap in the crease (c16) that the renders fill.
5. **Lobe hierarchy.** The frames carry two or three nested scales (big dome, mid lobes, florets); the renders carry one and a half. Band std at 4-32 px is 25-40 percent short in the crease (A-R3), the leg (C-R7) and the crest (D-R11), and the deficit is entirely at the smallest scale.

Variant X vs Y: X's extra sharpness buys nothing that matches the frame and adds the whorl, discs, spikes and chips; Y's softening hides those at the cost of a slightly defocused look (c25, c18). Y is preferred in every framing, but the gap between X and Y (about half a point) is small next to the gap between either and the reference (4-6 points).
