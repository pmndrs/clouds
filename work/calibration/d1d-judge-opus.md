# D1d blind judge (Opus, 2026-10-11)

Set: `scratchpad/blind-d1d/`, d01–d12 full frames, c01–c24 crops. Method: rubric "Judging method". I judged whole frames, then the crops (each is a 2x upsample of a native region), then my own 1:1 to 2x side-by-side strips of the same region in all three sources. The key, `work/` captures and reports were not opened.

## Grouping

I grouped the frames by framing, then placed each crop with NCC template matching (r ≥ 0.97 against its source frame).

| Framing | Reference guess (Decima) | Render P | Render Q |
|---|---|---|---|
| A wide body + legs | **d01** | d06 | d11 |
| B tower, front | **d04** | d10 | d08 |
| C long cloud + tower | **d02** | d03 | d09 |
| D long cloud, sun glare | **d07** | d12 | d05 |

How I picked the references: they have warm pink/cream lit faces and mauve-grey shadows. In A and B they also share a sky with faint radial streaks, and in C and D a teal sky. Each one's silhouette differs slightly from a pair of near-identical silhouettes (different engine, same asset). The two renders split into two consistent looks:
- **P** (d03, d06, d10, d12): grainy, with hatched fibre/moiré, hairy edges and cool blue shadows.
- **Q** (d05, d08, d09, d11): smooth, neutral-to-warm grey, darker shadow mass, blotchy lumps.

Crop map (region, reference, P, Q):
- B tower crown: c01 / c19 / c03
- B lower core: c18 / c08 / c24
- A crown and core: c05 / c04 / c21
- A left leg: c14 / c20 / c17
- C left lobe: c09 / c16 / c06
- C tower shadow side: c10 / c07 / c13
- D tower shadow side: c02 / c11 / c15
- D base / belly: c22 / c12 / c23

Scores below are surface / shading / colour / edges / overall, each out of 10.

## Distance (whole frames)

| Framing | P | Q | Winner |
|---|---|---|---|
| A (ref d01) | d06: 5/6/4/6/**5** | d11: 4/5/5/6/**4** | P (narrow) |
| B (ref d04) | d10: 5/6/4/5/**5** | d08: 4/5/5/6/**4** | P (narrow) |
| C (ref d02) | d03: 4/3/3/4/**4** | d09: 5/5/5/6/**5** | Q |
| D (ref d07) | d12: 3/3/3/3/**3** | d05: 5/5/5/5/**5** | Q |

Notes:
- **A:** d01 has a mottled mid-grey core, warm and evenly soft. d06 has a similar shadow layout but is blue-grey. d11 is warmer, but its core is too dark and full of glowing tan "lit pits", and a translucent flat smear trails off the right side (around x 1320–1460, y 630–690).
- **B:** d04 is soft and even in tone. d10 matches the softness but is blue and grainy. d08 has an overexposed plastic-white crown over a smoky, high-contrast lower core with hard dark vertical pockets: it looks like an explosion plume.
- **C:** In d02 the shadow sides stay light and warm. Both renders are far too dark on the tower's shadow side: d03 is deep blue, d09 grey with a dark smudge band through the belly. d09's neutral grey is closer.
- **D:** d07 has a solid grey belly with a fairly crisp flat bottom. d05 reproduces the belly band (smudgy) but its tower shadow is too dark. d12 is washed out and wispy, with no belly, blue shadows and hairy edges.
- **Silhouette:** in C and D Decima's tower head is a set of round knobby lobes, and ours is flatter on top. Ours also has a tiny detached fleck above the tower top that Decima lacks. Decima's base in D is more compact.

## Close-up (crops plus 2x strips)

| Region | Ref | P | Q | Winner |
|---|---|---|---|---|
| B tower crown | c01 | c19: 3/5/3/3/**4** | c03: 4/6/4/6/**5** | Q |
| B lower core | c18 | c08: 3/5/4/5/**4** | c24: 4/5/6/6/**5** | Q |
| A crown + core | c05 | c04: 4/5/4/6/**5** | c21: 4/4/5/5/**4** | P (near tie) |
| A left leg | c14 | c20: 4/5/4/4/**4** | c17: 5/6/4/6/**5** | Q |
| C left lobe | c09 | c16: 2/4/3/2/**3** | c06: 5/6/5/6/**6** | Q |
| C tower shadow | c10 | c07: 2/2/3/3/**2** | c13: 4/4/5/6/**4** | Q |
| D tower shadow | c02 | c11: 2/3/3/3/**3** | c15: 4/4/5/6/**4** | Q |
| D base | c22 | c12: 3/2/3/3/**2** | c23: 5/5/5/4/**5** | Q |

Notes:
- **B crown:** Decima's crown is a mid-tone warm cream with soft internal lumps. Both renders are overexposed white and flat. c19 has a torn, hairy left edge. c03 is clean but plastic.
- **B lower core:** Decima is a smooth, low-contrast mauve. c24 matches the warm tone and where the dark mass sits, but has hard dark pits/creases (around 560,230 and 940,330) and fleck clusters. c08 is blue-grey with pepper flecks.
- **A crown and core:** c04's bumpy crown outline is closest to Decima's, but it has a bright vertical seam/crease streak (around 490,210) and grainy lit wisps, and its core is a blue-grey blob. c21 has the warmer colour, but its crown is rounded and plastic and its core has glowing translucent pits.
- **A leg:** Decima's leg is lumpy and pitted with a fairly crisp edge, and it starts further right (the silhouette differs). c17 is clean and lumpy. c20 is fuzzy and grainy.
- **C lobe:** c06 is the closest crop in the set: soft lumps, right darkness. It shows contour/topographic rings on the right flank (around 900,450). c16 has moiré hatching over the whole surface and hatched edges.
- **C and D towers:** Decima keeps the shadow side light, warm grey, with lobes legible inside it.
  - Q (c13, c15) is too dark and grey-brown. Its lumps become soft round "leopard-spot" blotches.
  - c15 also has a pale flat lit sheet/lip at the upper right that Decima lacks.
  - P (c07, c11) is deep blue, with hatched fibre over the whole shadow side and hairy edges.
- **D base:** Decima's base is an opaque mauve belly with a defined bottom. c23 gets the grey belly band, but it is wispier at the bottom and has contour rings at the top centre (around 1200,80). c12 is washed white with no belly, grainy, and has a sky-blue circular hole/flare-like gap at the upper right (around 1530,90).

## Hard artefacts

- **P (d03/d06/d10/d12):**
  - hatched fibre/moiré over whole surfaces (c07, c11, c16)
  - pepper flecks/grain in the shadow mass and lit wisps (c04, c08, c12, c20)
  - hairy, torn edges (c19, c07, c11, c16)
  - a bright seam/crease streak (c04)
  - a circular sky hole in the base (c12)
- **Q (d05/d08/d09/d11):**
  - contour/topographic banding (c06, c23)
  - glowing "lit pits" or bokeh blotches inside the shadow core (c21, d11)
  - leopard-spot smudge blotches on shadow sides (c13, c15)
  - hard black pits and creases (c24)
  - a flat lit sheet/lip (c15)
  - a translucent flat smear sheet off the right of d11
  - a dark smudge band across the belly (d09)
  - plateau-white, overexposed crowns (c03, d08)
- **Both:** a detached fleck above the tower top in C and D.

## Summary

- **Distance:** P wins A and B narrowly (softer, closer to Decima's even tone). Q wins C and D (neutral grey, belly present).
- **Close-up:** Q wins 7 of 8. P wins only the A crown, by a hair, on edge outline.
- Q is the better match overall, but nothing scores above 6. Neither render reads as "same cloud, same engine".

Remaining gaps, most important first:
1. **Colour:** Decima's lit faces are warm pink/cream and its shadows warm mauve. Ours are neutral-white (Q) or cool blue (P), and the crowns are overexposed.
2. **Shadow mass:** too dark on the shadow sides of the C and D towers, where Decima stays light, with lobes readable inside the shadow.
3. **Surface:** Decima has fine mottled lumps everywhere, including in shadow. Q turns them into round blotches and lit pits. P overlays hatched fibre and flecks.
4. **Base:** Decima's belly is opaque with a defined bottom. Ours is wispier, P most of all.
5. **Edges:** P is hairy. Q is clean but too smooth/plastic at the crowns.
6. **Silhouette:** tower-top lobes are flatter in ours, and there is an extra fleck above the tower.
