# D1 blind set i: judge Fable (2026-10-11)

Set: `scratchpad/blind-d1i/` d01-d12 (4 framings x 3 sources), c01-c36 (12 regions x 3 sources). Judged blind: no key, no D1 reports, no earlier judge files. Method per `rubric.md` judging method: grouped the frames, picked the reference, template-matched every crop to its frame and region (FFT NCC, coarse-to-fine; all 36 matched at ncc >= 0.998, every crop is a 2x zoom of its 1080p frame), looked at every crop at native resolution, then at 1:1 and 2x sub-crops on lit crests, shade faces, silhouettes, creases and trunks. Band std and the floret metric were run afterwards as a cross-check only.

## 1. Grouping and references

| framing | reference | renders | how the reference was picked |
|---|---|---|---|
| F1 two-body cloud, wide, pale haze sky | **d01** | d03, d11 | d01 has a different sky, dense 5-15 px (frame) florets on every lit crest, grainy crisp silhouette, cool blue-grey belly; d03/d11 share the engine sky and are smooth and whiter |
| F2 two-body cloud, framed lower-left, teal sky | **d07** | d09, d12 | same tells; d09/d12 share one sky |
| F3 single body with a left foot, grey-pink sky | **d05** | d04, d08 | d05 pink-cream lit, grainy; d04/d08 share one sky |
| F4 tall tower / trunk, grey-blue sky | **d02** | d06, d10 | d02 pink lit rims, grainy, soft trunk; d06/d10 share one sky |

Crop map (frame box x,y,w,h in 1080p frame pixels; crops are 2x):

| region | box | ref | render A | render B |
|---|---|---|---|---|
| R1 F1 right tower | 1100,150,480x560 | c20 (d01) | c02 (d03) | c26 (d11) |
| R2 F1 base strip | 300,560,900x300 | c10 (d01) | c14 (d03) | c22 (d11) |
| R3 F1 central crease | 820,540,220x160 | c25 (d01) | c36 (d03) | c34 (d11) |
| R4 F2 right tower | 1150,180,400x520 | c24 (d07) | c04 (d09) | c12 (d12) |
| R5 F2 left crests | 350,330,500x330 | c05 (d07) | c23 (d09) | c17 (d12) |
| R6 F2 tower detail | 1200,300,200x200 | c16 (d07) | c07 (d09) | c31 (d12) |
| R7 F3 main body | 560,180,700x500 | c28 (d05) | c08 (d04) | c15 (d08) |
| R8 F3 left foot | 40,520,560x340 | c30 (d05) | c06 (d04) | c27 (d08) |
| R9 F3 right flank notch | 1100,500,160x120 | c09 (d05) | c13 (d04) | c21 (d08) |
| R10 F4 tower top | 500,100,700x450 | c32 (d02) | c18 (d06) | c29 (d10) |
| R11 F4 trunk strip | 650,600,700x300 | c33 (d02) | c03 (d06) | c11 (d10) |
| R12 F4 lower right | 960,620,300x300 | c19 (d02) | c01 (d06) | c35 (d10) |

## 2. Scores (1-10 against the framing's reference; harsh)

Axes: surface (florets, lumps, creases, grain, blotches/rings) / shading (where light and shade fall, shade depth) / colour / edges / overall ("same cloud, same engine").

### F1 (ref d01)

| image | surface | shading | colour | edges | overall | notes |
|---|---|---|---|---|---|---|
| d03 (frame) | 3 | 5 | 5 | 4 | 4 | belly has some of the ref's dark underside; tower-base shade is a dark brown smear; lit crests are smooth balloons |
| d11 (frame) | 3 | 4 | 5 | 4 | 4 | paler, flatter; underside too bright; otherwise the same cloud as d03 |
| c02 (d03, R1) | 2 | 4 | 4 | 4 | 3 | lit top a cream wash with no domes; shade a smooth dark gradient ending in a brown smear at the tower base |
| c26 (d11, R1) | 2 | 4 | 5 | 4 | 3 | same wash; shade lighter and broken into faint lumps, closer to the ref's cool mid-grey base |
| c14 (d03, R2) | 3 | 4 | 5 | 3 | 4 | belly has a faint grey band where the ref is dark blue-grey; base edge defocused |
| c22 (d11, R2) | 3 | 3 | 5 | 3 | 3 | belly flatter and paler still |
| c36 (d03, R3) | 3 | 3 | 4 | 4 | 3 | warm, higher contrast than the ref's soft haze; a dark wedge/slit at the lobe junction |
| c34 (d11, R3) | 3 | 4 | 4 | 4 | 4 | same wedge, lighter; contrast closer to the ref |

**F1 winner at distance: d03** (the belly carries more of the ref's dark underside). **Up close: d11** by a hair (R1 and R3 closer; R2 goes to d03). Both within a point; neither has florets.

### F2 (ref d07)

| image | surface | shading | colour | edges | overall | notes |
|---|---|---|---|---|---|---|
| d09 (frame) | 3 | 5 | 5 | 4 | 4 | tower has 20-40 px pale cobbles on the lit flank and a grey pocket; left body smooth |
| d12 (frame) | 3 | 4 | 5 | 4 | 4 | washed; cobbles softer; pocket lighter; whites blown at the tower top |
| c04 (d09, R4) | 3 | 4 | 5 | 4 | 4 | cobbles read as discrete pale discs, not florets; notch between lobes lighter than the ref's dark pocket |
| c12 (d12, R4) | 3 | 3 | 4 | 4 | 3 | same, lower contrast; more haze |
| c23 (d09, R5) | 2 | 4 | 4 | 4 | 3 | smooth lumps, no grain, defocused silhouette |
| c17 (d12, R5) | 3 | 4 | 4 | 4 | 3 | marginally more mid-scale lumps on the lower crest |
| c07 (d09, R6) | 2 | 4 | 4 | 3 | 3 | smooth grey wall with one soft dark pocket |
| c31 (d12, R6) | 2 | 4 | 4 | 3 | 3 | identical to c07 within noise |

**F2 winner at distance: d09. Up close: d09** (R4 decisive; R5 a hair to d12; R6 tie).

### F3 (ref d05)

| image | surface | shading | colour | edges | overall | notes |
|---|---|---|---|---|---|---|
| d04 (frame) | 3 | 4 | 5 | 5 | 4 | smooth, lighter than ref; cap blown white; centre shade a soft grey |
| d08 (frame) | 3 | 3 | 5 | 5 | 3 | centre shade mottled with dark pits; reads as a dirty mass |
| c08 (d04, R7) | 3 | 4 | 5 | 4 | 4 | shade smooth but with ~1.4x the ref's mid-band energy; cap blown; chip at the right notch |
| c15 (d08, R7) | 3 | 2 | 5 | 4 | 3 | dark blotches/pits in the centre shade; same chip, whiter |
| c06 (d04, R8) | 3 | 4 | 5 | 3 | 4 | foot is a smooth pale blob, no fibre/grain; small dark pit at its upper edge |
| c27 (d08, R8) | 3 | 4 | 5 | 3 | 4 | same within noise, top-right junction a touch greyer |
| c13 (d04, R9) | 3 | 4 | 4 | 3 | 3 | pocket lighter than ref; chip harder than the ref's sliver; pale cylindrical knob on the right |
| c21 (d08, R9) | 3 | 3 | 4 | 3 | 3 | pocket darker, chip whiter and sharper |

**F3 winner at distance: d04. Up close: d04** (R7 and R9; R8 tie). d08 has more lump structure up close but pays for it with pits.

### F4 (ref d02)

| image | surface | shading | colour | edges | overall | notes |
|---|---|---|---|---|---|---|
| d06 (frame) | 2 | 3 | 4 | 3 | 3 | main dome a blown white balloon; trunk ring, slit, serrated right rim |
| d10 (frame) | 2 | 3 | 4 | 3 | 3 | same; ring a little fainter |
| c18 (d06, R10) | 2 | 3 | 4 | 4 | 3 | dome flat white with no tone; ref is pink-grey with grain and a crease on the right flank |
| c29 (d10, R10) | 2 | 3 | 4 | 4 | 3 | identical within noise |
| c03 (d06, R11) | 2 | 3 | 4 | 2 | 2 | ring/eye-socket, vertical slit, pit cluster, serrated white rim; ref trunk is soft pink-grey with gentle lumps |
| c11 (d10, R11) | 2 | 3 | 4 | 2 | 3 | same set, ring and pits fainter |
| c01 (d06, R12) | 2 | 3 | 4 | 2 | 2 | ring top-left, dark slit, serrated rim, ~2x the ref's mid/coarse energy |
| c35 (d10, R12) | 2 | 3 | 4 | 2 | 2 | same; slightly lighter mean |

**F4 winner at distance: d10 by a hair (fainter ring). Up close: d10 by a hair** (R11; R10 and R12 ties). Treat F4 as a tie; both are far from the ref.

## 3. Hard artefacts per image (frame pixel coordinates, 1080p)

d03 (F1)
- dark brown smear at the tower's shaded base, darker than the ref's mid-grey: (1380-1480, 560-650)
- featureless cream wash on the tower's lit crests, no domes: (1250-1450, 230-400)
- underside too bright, base edge defocused: (450-1150, 700-790)
- dark wedge/slit at the lobe junction: (870-945, 560-605)

d11 (F1)
- same wash on the tower crests: (1250-1450, 230-400)
- underside paler and flatter than d03, defocused base edge: (450-1150, 650-790)
- wedge at the lobe junction, lighter: (870-945, 560-605)
- tower-base shade lighter than d03 but still a smooth gradient, no grain: (1380-1480, 540-650)

d09 (F2)
- pale cobble discs (20-40 px) on the tower's lit flank: (1315-1440, 345-455)
- grey pocket between lobes lighter than the ref's dark pocket: (1275-1375, 380-480)
- small knob top-right with a serrated rim: (1440-1510, 255-310)
- smooth featureless top dome: (1250-1400, 200-300)
- left-body crests smooth, defocused silhouette: (600-850, 350-450)

d12 (F2)
- same cobbles, softer: (1315-1440, 345-455)
- pocket washed out: (1275-1375, 380-480)
- blown whites at the tower top: (1250-1400, 200-330)
- knob with serrated rim: (1440-1510, 255-310)
- overall haze/low contrast on the tower face: (1200-1500, 200-500)

d04 (F3)
- bright chip/fleck in the right-flank notch (the ref has a soft sliver there too; the render's is harder and whiter): (1147-1162, 525-540)
- pale cylindrical knob on the right silhouette: (1210-1260, 510-580)
- blown white smooth cap: (600-900, 220-330)
- faint blotches in the centre shade: (800-1000, 420-560)
- dark pit at the foot's upper edge: (~525, ~775)

d08 (F3)
- dark blotches/pits in the centre shade: (820-910, 440-530), (1010-1060, 480-540), (910-1010, 560-630)
- mottled dirty shade overall: (750-1100, 400-650)
- chip in the right-flank notch, whiter and sharper than d04: (1147-1162, 525-540)
- blown white cap: (600-900, 220-330)
- same knob: (1210-1260, 510-580)

d06 (F4)
- trunk ring / eye-socket: (1040-1100, 690-740)
- vertical dark slit: (1115-1130, 710-780)
- dark pit cluster: (900-930, 720-740)
- serrated white rim on the right silhouette: (1200-1290, 620-700)
- blown white dome, no tone: (725-950, 140-325)
- pale smear on the lower bulge: (960-1085, 845-920)

d10 (F4)
- same ring, fainter: (1040-1100, 690-740)
- same slit: (1115-1130, 710-780)
- pit cluster, fainter: (900-930, 720-740)
- serrated white rim: (1200-1290, 620-700)
- blown dome: (725-950, 140-325)
- lower-bulge smear: (960-1085, 845-920)

## 4. Main remaining differences from the references, biggest first

1. **No cauliflower florets.** Every reference crest is tiled with 5-15 px (frame) domes down to the silhouette; every render crest is a smooth balloon or, at best, a few 20-40 px pale cobbles (d09 tower). On the lit half the renders carry about half the ref's 4-12 px energy in F1/F2 (c20 1.36 vs c02 0.58 / c26 0.44; c24 1.46 vs c04 0.39 / c12 0.72; c05 0.76 vs c23 0.36 / c17 0.40). This alone keeps "same engine" at 3-4.
2. **Edge character.** Reference silhouettes are grainy-crisp with tiny protrusions; the renders are clean, soft and slightly defocused, and where they do break up it is as serrated white rims (F4 right flank, F2 knob) rather than grain.
3. **Shade.** The references' shade sides are smooth, cool blue-grey with fine granularity. F1/F2 renders under-shade (bellies and pockets too bright and warm); F3/F4 renders over-structure the shade (blotches, pits, the trunk ring and slit: c15 and c18/c29 carry 1.4-1.7x the ref's mid-band energy, c01/c35 ~2x).
4. **Colour and exposure.** Renders are warmer and whiter; lit tops go to flat white (F4 dome, F3 cap) where the ref keeps pink-cream tone; ref shade is cool, render shade is neutral-warm.
5. **Hard artefacts.** Trunk ring + slit + serrated rim (F4 both), centre pits (F3 d08), tower-base smear (F1 d03), hard chip (F3 both, softer in the ref).
6. **Cohesion at junctions.** The ref's lobe junction (R3) is a low-contrast haze; the renders cut it with a dark wedge.

## 5. Cross-check numbers

Band std on the cloud mask (fine 1-3 / mid 4-12 / coarse 12-32 px, crop pixels): see `scratchpad/judge/bands.txt`. Floret metric: `scratchpad/judge/florets.txt`. The floret blob count barely separates renders from refs on the big crops (ref 0.9-2.1 vs renders 0.5-1.4 per 1e4 lit px) because the renders' cobbles and shade lumps count as blobs; the lit-half mid-band amount separates cleanly and matches the visual call. Numbers were read only after the visual pass and did not change any winner.
