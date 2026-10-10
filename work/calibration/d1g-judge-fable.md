# D1g blind judgement (Fable)

Judge: Fable 5.1, blind. Set: `scratchpad/blind-d1g/` (d01-d12 full frames, c01-c33 crops). No key, report or earlier judge file opened. Method per `rubric.md` judging method: frames grouped by composition, reference picked by eye, crops mapped by NCC template matching (crops are 2:1 from a 4k capture of the same frames), every crop viewed at native resolution, then 2x sub-crops of lit faces, shade sides, silhouettes and creases, pixel statistics last as a cross-check.

## 1. Grouping and reference picks

| Framing | Frames | Reference (my pick) | Why |
|---|---|---|---|
| A tall tower | d01, d05, d08 | d08 | dense floret crust on the lit face, pink-grey shade, knobby crisp silhouette, block-compression in the sky; d01/d05 share the smooth grey look |
| B wide low cloud | d02, d03, d04 | d04 | same crust, same warm shade; d02/d03 share one look |
| C large two-lobed | d07, d10, d11 | d10 | cauliflower everywhere, mid-blue sky; d07/d11 pair |
| D small two-lobed, far | d06, d09, d12 | d09 | fine grain on the lit faces, dark slate underside, pale haze band; d06/d12 pair |

The two render variants are consistent across framings:
- V1 (contrasty): d01, d02, d11, d06
- V2 (washed/soft): d05, d03, d07, d12

Crop map (region: ref / V1 / V2, 1080p frame origin):

| Region | Ref | V1 | V2 | Frame / origin | Content |
|---|---|---|---|---|---|
| R3 | c06 | c03 | c19 | A (500,100) | top of tower, lit face + right lobes |
| R9 | c18 | c26 | c31 | A (960,620) | lower-right shade side |
| R11 | c32 | c28 | c23 | A (650,600) | base / trunk |
| R1 | c01 | c05 | c30 | B (40,520) | lower-left wisp foot |
| R7 | c15 | c11 | c09 | B (560,180) | main body, crest row |
| R4 | c04 | c22 | c33 | C (1200,300) | tower flank, shade |
| R6 | c16 | c08 | c29 | C (1150,180) | right tower |
| R8 | c20 | c10 | c14 | C (350,330) | left lobe crest |
| R2 | c13 | c02 | c24 | D (300,560) | base band |
| R5 | c07 | c12 | c17 | D (1100,148) | right tower |
| R10 | c21 | c25 | c27 | D (820,540) | mid body |

c27 matched d10 at NCC 0.73 (all others 0.93-1.00); by elimination and by its teal cast it is d12's R10 crop.

## 2. Frame scores (1-10, harsh)

Axes: surface / shading / colour / edges / overall.

| Framing | Image | Variant | Surface | Shading | Colour | Edges | Overall | Winner at distance | Winner up close |
|---|---|---|---|---|---|---|---|---|---|
| A | d01 | V1 | 3 | 5 | 4 | 4 | 4 | d01 | d01 |
| A | d05 | V2 | 2 | 3 | 4 | 3 | 3 | | |
| B | d02 | V1 | 4 | 5 | 4 | 4 | 4 | d02 | d02 |
| B | d03 | V2 | 2 | 3 | 4 | 3 | 3 | | |
| C | d11 | V1 | 3 | 4 | 4 | 4 | 4 | d11 | d11 (narrowly; its discs are the worst single artefact in the set, but d07 has nothing to look at) |
| C | d07 | V2 | 2 | 2 | 3 | 3 | 2 | | |
| D | d06 | V1 | 4 | 5 | 4 | 5 | 4 | d06 | d06 |
| D | d12 | V2 | 2 | 2 | 4 | 3 | 2 | | |

V1 wins every framing at both distances. Nothing scores above 5 on any axis: no render reads as "same cloud, same engine". The best frame (d06) would pass as a different renderer's take on the same asset; the V2 frames read as a defocused or under-dense version.

## 3. Crop scores

| Region | Crop | Variant | Surface | Shading | Colour | Edges | Overall | Notes |
|---|---|---|---|---|---|---|---|---|
| R3 A tower | c03 | V1 | 3 | 5 | 4 | 4 | 4 | lit face is a flat near-white gradient (ref has a floret crust + grain); right lobes are smooth clay with hard lobe boundaries |
| R3 | c19 | V2 | 2 | 3 | 4 | 3 | 3 | same but blurred and duller, the shade a flat grey |
| R9 A shade | c26 | V1 | 3 | 4 | 4 | 3 | 3 | dark slit, stipple patch, white cut-out rim |
| R9 | c31 | V2 | 3 | 4 | 5 | 3 | 3 | speckle grain across the shade, same hard rim softened |
| R11 A base | c28 | V1 | 3 | 4 | 4 | 3 | 3 | pit, slit, stipple, serrated right silhouette with a bright sliver |
| R11 | c23 | V2 | 2 | 3 | 4 | 3 | 3 | hooked pit, sawtooth edge, flat grey haze |
| R1 B foot | c05 | V1 | 3 | 4 | 3 | 3 | 3 | foot is a flat untextured blob (ref is fibrous, torn); detached bloblet; shelf on the body edge |
| R1 | c30 | V2 | 2 | 3 | 3 | 2 | 2 | foot nearly dissolves into the sky |
| R7 B body | c11 | V1 | 4 | 5 | 4 | 4 | 4 | right lobe scale, no sub-florets, thin light halo on the crest rims, soft dark discs in the shade |
| R7 | c09 | V2 | 2 | 3 | 4 | 3 | 3 | crest row blurred, body a low-contrast haze |
| R4 C flank | c33 | V1 | 2 | 3 | 4 | 4 | 3 | shade is an array of ~50 px dark discs |
| R4 | c22 | V2 | 2 | 2 | 3 | 3 | 2 | featureless pale fog |
| R6 C tower | c29 | V1 | 3 | 4 | 4 | 4 | 4 | lobes read, disc array across the whole shade side, flecks off the crest |
| R6 | c08 | V2 | 2 | 2 | 3 | 3 | 2 | big smooth lobes, stippled sparkle fringe on the silhouette, interior washed |
| R8 C lobe | c14 | V1 | 3 | 4 | 4 | 4 | 4 | frayed spikes on the silhouette, discs and a vertical fibrous striation on the right lobe |
| R8 | c10 | V2 | 2 | 2 | 3 | 3 | 2 | smooth, bright, stipple fringe, no shade |
| R2 D base | c02 | V1 | 3 | 4 | 3 | 4 | 3 | ripple/contour banding on the lit patch, no dark underside (ref is slate grey), extra floating bloblets, too warm |
| R2 | c24 | V2 | 2 | 2 | 3 | 3 | 2 | pale lavender, no base shadow at all |
| R5 D tower | c12 | V1 | 4 | 5 | 4 | 5 | 4 | closest crop in the set: lobe scale and shade placement right; smooth where the ref has grain and sub-florets; soft discs on the shade; a hook and a sky fleck |
| R5 | c17 | V2 | 2 | 2 | 3 | 3 | 2 | out of focus, pale |
| R10 D mid | c25 | V1 | 2 | 4 | 3 | 4 | 3 | fingerprint banding across the whole lit patch, too yellow |
| R10 | c27 | V2 | 2 | 2 | 4 | 3 | 2 | flat washed grey |

## 4. Hard artefacts per image

Coordinates are in the crop's own pixels (crop files are 2:1 to the 1080p frame; frame coordinate = origin + crop/2).

### d01 (A, V1): c03, c26, c28
- c26 (325,290): solid dark slit ~15x60 px in the shade, lighter halo around it. Same feature in c28 at (940,300-380). Frame ≈ (1122,765).
- c28 (545,200-250): dark pit ~70x80 px with a lighter rim. Frame ≈ (922,712).
- c28 (820-880,180-240) and c26 (220-280,120-200): stipple / sparkle grain patch in the shade.
- c26 (480-560,90-200) and c28 (1000-1320,50-290): right silhouette is a cut-out: bright white sliver with 1-px staircase steps; floating fragment at c28 (1160,130). Frame ≈ (1150-1310, 625-745).
- c03 (1060-1380,380-620): smooth clay lobes with hard lobe boundaries, e.g. (1150,500), (1230,540); no grain or sub-florets anywhere on the lit face (500-820,120-360).
- c03 (700-1000,350-650): shade is a single smooth dark gradient, a vertical smudge rather than mottle.

### d05 (A, V2): c19, c31, c23
- c23 (500-560,200-260): hooked dark pit. Frame ≈ (915,715).
- c23 (1100-1250,100-230): sawtooth silhouette with a floating fleck at (1150,110). Frame ≈ (1225-1275, 650-715).
- c31 (150-250,50-150) and across the shade: fine speckle grain.
- c31 (430-520,150-300): hard edge shelf against the sky, white sliver at (470,150-200), protrusion at (490,190).
- c19 whole: defocused; the lit face (480-820,120-360) is a flat gradient, the shade (700-1000,420-660) a flat grey.

### d02 (B, V1): c05, c11
- c05 (650,445): detached round bloblet off the foot. Frame ≈ (365,742).
- c05 (900-1000,350-420): flat vertical shelf / cliff on the body edge; the foot (520-840,400-640) is a hard-edged flat blob with no fibre.
- c11 (560,650), (700,640), (870,660): soft dark discs ~60 px in the shade; small lit flecks inside the shade at (680,620), (820,630).
- c11 (300-620,80-140): thin lighter halo along the crest rims.
- c11 (1230,760-790): hard white slab. Present in the ref (c15 (1240,680)) and in c09 (1220,760): an asset feature, not a render fault.

### d03 (B, V2): c30, c09
- c30 (650,450): same detached bloblet.
- c30 whole foot (520-840,400-640): dissolves into the sky, no edge.
- c09 (300-620,80-320): crest row blurred to a single soft contour; the whole body is a low-contrast haze, no crevices.
- No hard pits or slits; the fault is absence of everything.

### d11 (C, V1): c33, c29, c14
- c33 (100-300,150-350): regular array of dark round discs ~50-60 px, e.g. (120,230), (170,290), (240,210), (290,280), (220,330). Frame ≈ (1250-1350, 375-475).
- c29 (40-360,400-650): same disc array across the entire shade side of the tower, roughly (90,470), (150,520), (230,470), (300,510), (120,580), (210,600). Frame ≈ (1170-1330, 380-505).
- c14 (820-900,400-480): discs again; (800-960,350-500): vertical fibrous striation on the right lobe.
- c14 (400-480,290-360) and (320-360,350): frayed spiky fringe on the silhouette.
- c29 (330,70), (620,140): flecks detached off the crest.

### d07 (C, V2): c22, c08, c10
- c08 (560-620,100-130), (650-700,330-370), (600-700,500-560): stippled sparkle fringe along the silhouette (1-2 px noise where the edge should be a smooth gradient).
- c10 (300-480,300-350): same stipple fringe.
- c08 (350-520,400-600) and c10 (650,400), (840,420): faint pale discs in otherwise featureless interior.
- c22 whole: no structure at all; c04 (ref) at the same spot has a lumpy pink shade.

### d06 (D, V1): c02, c12, c25
- c25 (150-330,20-170): fingerprint / contour banding over the whole lit patch (concentric wavy bands a few px apart). Frame ≈ (895-985, 550-625).
- c02 (1150-1340,0-120): same ripple banding on the top shade boundary. Frame ≈ (875-970, 560-620).
- c02 (175,235), (200,205), (280,255), (320,245): extra floating bloblets left of the body (the ref has one satellite at (130,290)).
- c12 (650,620), (700,700), (690,880): soft dark discs on the tower's shade; (490,175): hook / fleck in the sky above the crest; (230,700): sharp notch on the left edge.
- c02 (600-920,300-540): underside is light grey where the ref is dark slate; no base shadow.

### d12 (D, V2): c24, c17, c27
- c17 (580-720,600-800): faint ripple banding in the shade.
- c17, c24, c27 whole: defocused, no dark underside, no grain; c27 is a flat grey field with a faint dark disc at (350,120).

## 5. Pixel cross-check

Band energies (std of Gaussian difference-of-blurs inside a cloud mask, 4k crop pixels) and mean colour agree with the eye:

- V2 has the lowest 1-3, 4-12 and 12-32 px energy in every region (e.g. R6 12-32 px: ref 9.1, V1 7.5, V2 7.0; R1: ref 6.9, V1 4.6, V2 2.5; R5: ref 9.1, V1 6.4, V2 3.2). The "washed" read is a real loss of mid- and large-scale relief, not just exposure.
- V1 matches the ref's 4-32 px energy on the A tower and B body (R3 4-12: 4.2 vs 4.2; R7: 3.1 vs 2.8) but its 1-3 px energy there is sky-edge and artefact driven, not floret grain; in A's shade V1 is well above the ref (R9 4-12: 2.4 vs 1.0) because of the slit, pit and stipple.
- Colour: the ref is warmer in every lit region (R-B: R1 +22 vs +9 / +6; R3 +15 vs +6 / +5; R6 +8 vs +6 / +3), except framing D where V1 overshoots (R2 +10.5 vs +4.8; R10 +12 vs +8) and V2 is neutral everywhere (R-B within +-2).

## 6. Main remaining differences from the reference, biggest first

1. Surface grain and floret crust. The reference's lit faces are a crust of 30-80 px (4k) cauliflower florets with their own crisp crests, plus a fine stochastic grain; both renders are smooth at every scale below the main lobe. This is the one difference visible in every region and the reason no crop reaches "same engine".
2. Painted shade artefacts in V1. Regular ~50 px dark discs on every shade side in framing C (d11), soft discs in B and D, ripple / fingerprint banding on the lit patches in D (d06), a dark slit and pit on the A trunk (d01). The reference's shade is a soft pink-grey mottle with none of these.
3. V2 relief loss. d05/d03/d07/d12 lose 30-60 percent of the reference's 4-32 px energy and read as defocused or under-dense: no crevices, no dark underside (D), the B foot dissolves.
4. Colour. Lit tone cold grey-white against the reference's cream; shade neutral grey-blue against pink-mauve; in D the V1 lit patches go too yellow instead. Sky differs per variant (V1 darker and bluer, V2 lighter) and never matches the reference's haze band in C/D.
5. Silhouettes. A: a cut-out right edge with staircase steps and bright slivers in both variants. C: stippled sparkle fringe (V2) or frayed spikes and flecks (V1). B/D: detached bloblets and hooks the reference does not have. The reference's silhouette is crenellated at a few px and otherwise soft only where the cloud is thin.
6. Shading depth. Where the shade falls is roughly right in V1 (A, B, D within a lobe or two), but the dark slate underside in D and the deep inter-floret crevices everywhere are missing; the lit faces lack the per-floret lit/shade alternation that gives the reference its mid-scale sparkle.
