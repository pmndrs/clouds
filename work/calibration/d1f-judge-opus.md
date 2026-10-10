# D1f blind judge (Opus)

Set: `scratchpad/blind-d1f/` with full frames d01–d12 and 2x crops c01–c24. I did not open the key, `work/`, `artifacts/research/d1-parity/` or any report. Method: `work/calibration/rubric.md` ("Judging method"). I looked at every full frame and crop at native size. I also made my own 2x/3x zoom strips of the creases, the tower shade and the edges. To place each crop, I template-matched it back to its full frame. Each crop is a fixed window at the same frame position for all three sources.

Scores are 1–10 for match to the reference: S = surface, Sh = shading, Col = colour, E = edges, O = overall ("same cloud, same engine"). The marking is harsh: 5 means "clearly the same asset, clearly a different engine".

## Grouping and reference picks

| Framing | Frames | Reference | Crop regions (ref / render / render) |
|---|---|---|---|
| A: twin towers, wide (sun upper left in d01) | d01, d02, d06 | **d06** | right tower: c04 / c20 (d01) / c08 (d02); left base and belly: c07 / c10 (d01) / c23 (d02) |
| B: single tall tower | d03, d09, d11 | **d11** | tower top: c21 / c02 (d03) / c06 (d09); lower body: c01 / c22 (d03) / c24 (d09) |
| C: broad cumulus | d04, d05, d07 | **d04** | top and shade core: c14 / c12 (d05) / c16 (d07); left skirt: c18 / c15 (d05) / c11 (d07) |
| D: twin towers, mirrored (sun upper right) | d08, d10, d12 | **d08** | right tower: c09 / c05 (d10) / c19 (d12); left dome: c03 / c13 (d10) / c17 (d12) |

The reference was never in doubt. In every group, one frame has the same features: a fine cauliflower grain on every surface, a 1–2 px fluffy fringe on the silhouettes, a warm peach-and-mauve cloud, faint streaks or banding in the sky, and a teal sky (A, D) or a grey-blue sky (B, C). Both renders in a group look like each other and not like it. The file sizes give it away too: the Decima PNGs are 0.4–0.6 MB and the renders are 1.4 MB. The blind is not really blind.

## Scores

### A (ref d06)
| | S | Sh | Col | E | O |
|---|---|---|---|---|---|
| Distance d01 | 4 | 3 | 3 | 4 | 3 |
| Distance **d02** | 4 | 5 | 5 | 4 | **4** |
| Tower close c20 (d01) | 3 | 3 | 4 | 3 | 3 |
| Tower close **c08 (d02)** | 3 | 5 | 5 | 3 | **4** |
| Base close **c10 (d01)** | 4 | 5 | 4 | 4 | **4** |
| Base close c23 (d02) | 3 | 3 | 5 | 4 | 3 |

At distance d02 wins. The reference tower is almost all lit: its shade side is a light grey at about 0.65–0.7. d01's tower shade and belly are far too deep. d01 also has a sun glow in its upper-left sky that the reference does not have, and its silhouette sits lower. Up close, d02 wins the tower: its shade is lighter, and d01 (c20) has mottled blotches in its shade. d01 wins the base: c10's belly carries the reference's grey flat underside, while c23's belly is washed out.

### B (ref d11)
| | S | Sh | Col | E | O |
|---|---|---|---|---|---|
| Distance d03 | 4 | 4 | 3 | 5 | 4 |
| Distance **d09** | 4 | 4 | 4 | 5 | **4** (by a hair) |
| Top close c02 (d03) | 3 | 5 | 3 | 4 | 4 |
| Top close c06 (d09) | 3 | 5 | 3 | 4 | 4 (tie) |
| Low close c22 (d03) | 3 | 5 | 4 | 5 | 4 |
| Low close c24 (d09) | 3 | 5 | 4 | 5 | 4 (tie) |

The two renders differ almost only in sky exposure: d03's sky is darker and d09's is nearer the reference. The cloud bodies are close to identical. Up close it is a tie:
- c02 has a little more lobe structure on the right shade side, which is closer to the reference.
- c06 is closer to the reference's shade level.

Both renders paint the column top as a smooth white marshmallow pillar. The reference's top is covered in florets and lit peach.

### C (ref d04)
| | S | Sh | Col | E | O |
|---|---|---|---|---|---|
| Distance **d05** | 4 | 4 | 3 | 4 | **4** (by a hair) |
| Distance d07 | 4 | 4 | 3 | 4 | 4 |
| Top close **c12 (d05)** | 4 | 5 | 3 | 5 | **4** |
| Top close c16 (d07) | 3 | 5 | 3 | 4 | 4 |
| Skirt close c15 (d05) | 4 | 5 | 2 | 4 | 3 |
| Skirt close **c11 (d07)** | 4 | 5 | 2 | 4 | **4** |

The shade-core level is about right in both renders: p50 is 137–139 against the reference's 141. That is the best shading match in the set. Colour is the worst:
- The reference is warm peach on a grey-blue sky.
- Both renders are neutral or cool grey on a lavender sky.

The camera fit disagrees between the two. d05's top lines up with the reference but its skirt sits about 35 px too far left. d07's skirt lines up but its top sits too low.

### D (ref d08)
| | S | Sh | Col | E | O |
|---|---|---|---|---|---|
| Distance **d10** | 4 | 3 | 4 | 4 | **4** |
| Distance d12 | 3 | 4 | 4 | 4 | 3 |
| Tower close **c05 (d10)** | 4 | 2 | 3 | 3 | **3** |
| Tower close c19 (d12) | 2 | 3 | 3 | 3 | 2 |
| Left dome close **c13 (d10)** | 4 | 4 | 4 | 4 | **4** |
| Left dome close c17 (d12) | 3 | 4 | 4 | 4 | 3 |

The reference is high-key: every surface is brightly lit, the shade is a light pink-grey, and the belly is light. Both renders turn the tower's shade side into a deep blue-grey (d10 is darker) and put a dark band along the belly. Both also have a sun glow in the upper-right corner that the reference does not have. d12's tower shade is a little lighter, but it carries the worst artefact in the set: circular disc blotches that can be seen even at full-frame distance.

## Winners

| Region | Distance | Close-up |
|---|---|---|
| A | d02 | tower: d02 (c08); base: d01 (c10) |
| B | d09 (marginal) | top: tie; low: tie |
| C | d05 (marginal) | top: d05 (c12); skirt: d07 (c11) |
| D | d10 | tower: d10 (c05); left dome: d10 (c13) |

No render scores above 4 overall anywhere.

## Hard artefacts per render
- **d01**: a sun glow disc in the upper-left sky that the reference lacks. A grainy, sparkly speckle patch in the lit crease between the left mass and the middle lobe (about x 880–960, y 590–650). Mottled round blotches in the tower's shade side (c20). A faint fingerprint ripple on the lit crease above the base (c10, top right).
- **d02**: the same sparkly grain patch in the central crease, more visible here. A fingerprint or wood-grain swirl on the lit face above the base (c23, about crop x 1150–1300, y 0–120). A washed-out belly.
- **d03**: two dark elliptical pits or slits in the lower body (c22 at crop (540, 230) and (940, 330); frame about (920, 715) and (1120, 765)). Bright lit flecks inside the shade core. A smooth pillar top with no florets.
- **d09**: the same pits and flecks as d03. The two are nearly the same cloud.
- **d05**: bright warm "light-leak" flecks scattered through the shade core (c12: (540, 630), (680, 610), (900, 630)). A translucent grey smear that runs off the right flank (about x 1310–1460, y 630–690), where the reference has a peach satellite lobe lower down.
- **d07**: the same flecks, more of them (highest fine-scale energy in C-top). The same right-flank smear.
- **d10**: a sun glow in the upper-right corner. A faint fingerprint contour on the central lit face (about x 800–870, y 560–620). A sharp bright crescent sliver at the gap between the lobes.
- **d12**: circular disc and ring blotches across the tower's shade side (about x 1230–1380, y 330–480), the worst artefact in the set. Strong fingerprint and wood-grain whorls on the central lit face (c17, crop x 850–1000, y 380–520; frame about 780–880, 560–640). A sun glow in the corner.

## Main remaining differences (every framing)
1. **Surface.** Decima has a crisp, fine cauliflower grain (2–6 px lumps) on every lit face and through the shade, plus a 1–2 px fluffy fringe on the silhouettes. Ours is smooth marshmallow: only the large lobes, with a soft 3–6 px roll-off at every edge. This is the biggest gap and it shows up close in every crop.
2. **Tonal key.** In A and D, the reference's lit tops are brighter: cloud p95 is 231–244 against our 215–224. Our shade cores and bellies are deeper and bluer, so we have too much contrast and the image reads lower-key. In B and C the shade level is about right, but our lit faces are still dimmer and flatter-white.
3. **Colour.** The reference is warm: peach lit faces and mauve-pink shade, with R−B of +3 to +20 on the cloud. Ours is neutral to cool grey (R−B −7 to +1). The skies are also off:
   - A and D: the reference is teal; ours is saturated blue with a sun glow.
   - B and C: the reference is grey-blue with faint streaks; ours is lavender.
4. **Engine fingerprints the reference never shows.**
   - Bright flecks inside the shade core (B, C).
   - Disc or ring blotches in the shade (D tower, A d01 tower).
   - Fingerprint or wood-grain whorls on lit creases (A, D).
   - Sparkly grain in the creases (A).
   - Dark pits in the lower body (B).
5. **Camera and silhouette.** The fit is within about 20–40 px, but it pulls different ways in different parts of the frame (C top against C skirt), so a scale or FOV mismatch remains.
