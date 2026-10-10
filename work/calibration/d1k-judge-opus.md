# D1 blind set k: judge (Opus), 2026-10-11

Judged blind. I did not open any key file, D1 report or earlier judge file. Method: work/calibration/rubric.md (judging method). I looked at the frames first, then each region as a crop triplet at native size, then 1:1 and 2× sub-crops of crests, shade, silhouettes, bases, junctions and trunks. Statistics came last, as a cross-check only.

## Grouping and references

| framing | frames | reference | why |
|---|---|---|---|
| F1 tall front body + left leg | d01, d04, d11 | **d04** | different asset time (bigger leg, different holes), pink-cream grade, radial streaks in the sky; d01 and d11 have pixel-identical silhouettes |
| F2 wide two-tower, small | d02, d03, d08 | **d08** | different asset time, horizontal streak banding in the sky, crisp dark flat base; d02 and d03 share a silhouette |
| F3 wide two-tower, large | d05, d06, d12 | **d12** | different time and camera, horizontal sky banding; d05 and d06 share the asset (d06's camera is slightly lower and wider) |
| F4 tall tower | d07, d09, d10 | **d10** | pink grade, radial sky streaks, different silhouette details |

Our two variants are consistent across framings:
- **P** has a painted symmetric sky ramp: d01, d03, d05, d09.
- **L** has a sun-side gradient sky: d11, d02, d06, d07.

The P sky's vertical profile tracks the reference's within a few levels in every framing (left-strip luminance, top to bottom: d04 156 to 231 vs d01 139 to 227; d08 131 to 243 vs d03 130 to 235). The L sky has no bright horizon haze in F1 and F4 (it ends at 178 to 185 against the reference's 230), and it has a tan or green horizon band in F2 and F3.

## Crop map (template matching, crops are 2× of the 1080p frames; region given as a 1080p frame box)

| region | frame box (x, y, w, h) | ref | P | L |
|---|---|---|---|---|
| R1 F1 main body | 560,180,700,500 | c06 | c22 (d01) | c09 (d11) |
| R2 F1 left leg | 40,520,560,340 | c27 | c05 (d01) | c21 (d11) |
| R3 F1 shade pocket | 1100,500,160,120 | c25 | c31 (d01) | c10 (d11) |
| R4 F2 base / left body | 300,560,900,300 | c28 | c12 (d03) | c20 (d02) |
| R5 F2 junction | 820,540,220,160 | c18 | c34 (d03) | c19 (d02) |
| R6 F2 right tower | 1100,150,480,560 | c26 | c24 (d03) | c36 (d02) |
| R7 F3 right tower | 1150,180,400,520 | c07 | c08 (d05) | c17 (d06) |
| R8 F3 left body crests | 350,330,500,330 | c16 | c29 (d05) | c11 (d06) |
| R9 F3 tower shade detail | 1200,300,200,200 | c13 | c23 (d05) | c30 (d06) |
| R10 F4 top dome | 500,100,700,450 | c32 | c04 (d09) | c33 (d07) |
| R11 F4 lower trunk | 650,600,700,300 | c03 | c35 (d09) | c14 (d07) |
| R12 F4 trunk edge | 960,620,300,300 | c02 | c01 (d09) | c15 (d07) |

## Scores (1–10 against the framing's reference; harsh)

### Frames
| framing | image | surface | shading | colour | edges | overall |
|---|---|---|---|---|---|---|
| F1 (ref d04) | d01 | 3 | 4 | 4 | 4 | **4** |
| | d11 | 3 | 3 | 3 | 4 | **3** |
| F2 (ref d08) | d03 | 4 | 3 | 4 | 3 | **4** |
| | d02 | 3 | 3 | 3 | 4 | **3** |
| F3 (ref d12) | d06 | 3 | 4 | 4 | 4 | **4** |
| | d05 | 3 | 3 | 4 | 4 | **3** |
| F4 (ref d10) | d09 | 2 | 3 | 3 | 3 | **3** |
| | d07 | 2 | 3 | 2 | 3 | **2** |

### Crops
| region | crop | surface | shading | colour | edges | overall | note |
|---|---|---|---|---|---|---|---|
| R1 | c22 | 3 | 4 | 3 | 4 | 3 | smooth balloon crest; crisp glow disc in the shade |
| R1 | c09 | 3 | 3 | 3 | 4 | 3 | same crest; glow softer but tan; shade washed |
| R2 | c05 | 2 | 3 | 3 | 2 | 2 | grey putty leg, no grain, defocused base, pit |
| R2 | c21 | 2 | 3 | 3 | 2 | 2 | identical; sky lilac-grey |
| R3 | c31 | 2 | 2 | 3 | 3 | 2 | ref has a dark ring pit; ours has a bright ribbon and a sky hole |
| R3 | c10 | 2 | 2 | 3 | 3 | 2 | same, ribbon slightly brighter |
| R4 | c12 | 3 | 3 | 3 | 2 | 3 | vertical streak smears; base drowned in haze |
| R4 | c20 | 3 | 3 | 3 | 3 | 3 | streaks; tan band over a defined but ticked base; sky shows through the base |
| R5 | c34 | 3 | 3 | 3 | – | 3 | tan smudge, crease rings, no grain (ref shows sky here) |
| R5 | c19 | 3 | 3 | 3 | – | 3 | same, fainter creases |
| R6 | c24 | 4 | 3 | 4 | 4 | 4 | relief, but as single-scale bubbles with dark crescents; trunk too dark |
| R6 | c36 | 2 | 3 | 3 | 4 | 3 | waxy smooth balloon; yellow glow on trunk; trunk too dark |
| R7 | c08 | 3 | 3 | 3 | 4 | 3 | wormy whorls over the shaded face; tan glows; too grey |
| R7 | c17 | 3 | 4 | 4 | 4 | 4 | smooth but tone close; tan glow |
| R8 | c29 | 4 | 3 | 3 | 3 | 3 | more lobe structure, grey, soft crest edge |
| R8 | c11 | 2 | 4 | 4 | 3 | 3 | brighter but a smooth balloon, soft crest edge |
| R9 | c23 | 3 | 3 | 3 | – | 3 | whorls, tan glow, blue-grey cast |
| R9 | c30 | 3 | 3 | 3 | – | 3 | washed, tan glow blotches |
| R10 | c04 | 1 | 3 | 3 | 3 | 2 | airbrushed white balloon vs dense multi-scale cauliflower |
| R10 | c33 | 1 | 3 | 2 | 3 | 2 | identical, slightly more contrast; lilac sky |
| R11 | c35 | 2 | 3 | 3 | 3 | 2 | grey, pits, slit, crescent, extra lit fragment |
| R11 | c14 | 2 | 3 | 2 | 3 | 2 | identical, slit more visible |
| R12 | c01 | 2 | 3 | 3 | 3 | 2 | hook, slit, crescent; ref is a plain mottled edge |
| R12 | c15 | 2 | 3 | 2 | 3 | 2 | slit darker and crisper |

### Winners
| framing | at distance | up close |
|---|---|---|
| F1 | **d01**: sky ramp and horizon haze match, slightly deeper body shade | **d11** by a hair: its glow is a soft tan patch, not d01's crisp disc. Crest and leg are identical |
| F2 | **d03**: sky and horizon match, more tower relief | **d03** on crests (c24); d02 keeps the better base (c20) |
| F3 | **d06**: cloud brightness and tone closer, despite the green-tan horizon | **d06**: no whorls; d05 has more lumps, but they are wormy whorls |
| F4 | **d09**: sky matches | **d09** marginal: same cloud, but c15's slit is crisper |

At distance the P variant wins three framings of four, almost entirely on the sky. In the cloud itself the two variants are nearly identical in F1 and F4. They differ in F2 (d03 shows more relief, d02 more tan colour) and in F3 (d05 is greyer with whorls, d06 smoother and brighter).

## Hard artefacts (1080p frame pixel coordinates)

**d01**
- Glow disc, a crisp pale oval in the body shade: (955–1022, 480–517).
- Pale slit or ribbon in the shade pocket where the ref has a dark ring pit: (1155–1202, 550–580).
- Sky hole through the body where the ref is solid cloud: (1225–1260, 480–510).
- Pit or slit in the left leg: (355–370, 765–780).
- Left-leg base smeared and defocused: (290–600, 820–860).
- Crests read as smooth balloons: (650–1100, 230–330).

**d11**
- Every cloud artefact listed for d01, except that the glow is a softer tan patch: (947–997, 485–517).
- Sky has no horizon haze: lower third (y > 800) at about 185 vs the ref's 230, with a lilac-to-navy gradient.

**d02**
- Vertical streak smears (drip striations) on the lit left lobes: (650–800, 560–635).
- Translucent base with sky showing through: (400–560, 750–785).
- Serrated or ticked base edge: (850–1000, 770–790).
- Warm tan band along the belly: (300–1200, 740–780).
- Dark brown trunk core under the right tower: (1410–1475, 575–635).
- Yellow glow on the trunk: (1235–1300, 475–550).
- Sky: tan horizon with a grey-blue band, y ≈ 860–1000. The ref is white haze.

**d03**
- The same streak smears: (650–800, 560–635).
- Base dissolved into the horizon haze, a fog wall on the cloud: (300–1300, 740–800). The ref keeps a crisp dark base above its haze.
- Single-scale bubble pattern with dark crescents on the tower face: (1250–1500, 250–450).
- Dark trunk core: (1410–1475, 575–635).
- Faint sky band: y ≈ 930–945.

**d05**
- Wormy whorls (squiggle creases) on the tower's shaded face: (1275–1375, 280–380).
- Tan glow blotches: (1255–1297, 430–465).
- Blue-grey cast on the tower shade: (1200–1260, 330–450).
- Whole cloud greyer than the ref.
- Belly band too dark: (450–800, 690–740).

**d06**
- Tan glow blotches: (1270–1305, 475–510) and (1347–1373, 377–413).
- Belly band too dark and blue-grey where the ref belly is pale pink: (450–1250, 690–760).
- Sky: green-tan horizon band at y ≈ 880–1080, where the ref is clean light blue.

**d07**
- Top dome airbrushed smooth: (700–1000, 130–400).
- Faint slit line on the dome: (755–805, 260–285).
- Smoke-curl wisps at the lobe junction: (620–650, 480–550).
- Dark pits: (900–930, 720–750).
- Bright crescent whorl: (1080–1105, 700–745).
- Dark vertical slit: (1120–1132, 715–775).
- Lit wispy hook standing in the sky, absent in the ref: (1200–1295, 600–735).
- Sky: lilac-to-navy with no horizon haze.

**d09**
- The same cloud artefacts as d07; the slit at (1120–1132, 715–775) is softer.
- The sky matches the ref.

## Main remaining differences from the reference (biggest first)

1. **Surface.** The references carry a dense fine grain and cauliflower at several scales over everything, lit crests and shade alike. Ours are smooth, airbrushed balloons. The worst case is the F4 dome (d07/d09, R10: score 1). Where we do show relief (d03 tower, d05 shade), it comes out as single-scale bubbles or wormy whorls rather than florets.
2. **Colour grade.** The references are pink-cream on the lit side with lilac-grey shade, in every framing. Ours are neutral white to grey, with tan or yellow patches in shade and along the bellies.
3. **Shade interior artefacts.** Glow discs and tan blotches, slits, crescents, smoke-curl wisps and pits, listed above. Where the ref has a dark pit (F1 R3), we render a bright ribbon.
4. **Shade depth and placement.** The F2 tower trunk is far too dark and brown, and the F3 bellies are too dark and blue-grey. In F1 and F4 the depth is roughly right, but the shade is smooth gradient, not mottled.
5. **Edges.** On F1/F4 crests our silhouettes are cleaner and more crisply scalloped than the ref's frayed, grainy edges. On F3 crests the ref is crisper than ours. Our base edges are defocused (F1 leg) or drowned in haze (d03).
6. **Sky (L variant).** No horizon haze in F1/F4 (d11, d07), a tan and grey band in d02, a green-tan horizon in d06. The P variant's sky matches the reference well.
7. **Asset time and camera mismatch.** Leg size, holes, the extra lit fragment in F4 and the F3 camera framing all differ from the ref. This limits silhouette scoring regardless of the renderer.

## Statistics cross-check (after the visual pass)

florets.py img over each full crop. The figures are b3lit at 4–12 px, then the blob count.

| region | ref | P | L |
|---|---|---|---|
| R1 | c06 0.79 / 0.83 | c22 0.44 / 0.90 | c09 2.01* / 0.85 |
| R2 | c27 1.12 / 1.91 | c05 0.82 / 1.11 | c21 0.97 / 1.36 |
| R4 | c28 0.64 / 1.14 | c12 0.35 / 1.05 | c20 0.41 / 1.31 |
| R6 | c26 1.37 / 2.07 | c24 0.81 / 1.99 | c36 0.59 / 0.94 |
| R7 | c07 1.47 / 1.29 | c08 0.83 / 1.44 | c17 0.72 / 1.10 |
| R8 | c16 0.76 / 1.43 | c29 0.63 / 1.65 | c11 0.41 / 0.87 |
| R10 | c32 1.38 / 1.41 | c04 0.55 / 0.58 | c33 2.28* / 1.38 |
| R11 | c03 0.72 / 1.81 | c35 0.50 / 1.28 | c14 0.56 / 1.59 |

The reference carries more 4–12 px energy in nearly every region, which agrees with the surface gap. The 1–3 px band is also higher in the references (c26 0.52 vs 0.37/0.34; c07 0.50 vs 0.35/0.34), consistent with the fine grain I saw. c24 matches c26's blob count, which agrees with d03's tower winning on relief. c29 has more blobs than its ref, which fits its lumpy grey crest.

\* c09 and c33 are inflated: the lilac L sky passes the low-chroma cloud mask, so their figures are not usable.
