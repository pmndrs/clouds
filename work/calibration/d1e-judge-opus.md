# D1e blind judge (Opus)

Set: `scratchpad/blind-d1e/` (d01–d16 full frames, c01–c32 crops). Judged blind; key not opened.
Method: rubric "Judging method". Whole frames at 1920x1080, crops at native size (they are 2x upscales of frame regions), plus contrast-stretched zooms and Lab statistics inside the reference's cloud mask.

## Grouping and reference

Crops were mapped to frames by pixel matching (error < 6 for the source frame, > 8 for every other frame).

| Framing | Frames | Reference | Crop regions (ref crop first) |
|---|---|---|---|
| A tall tower | d04 d07 d08 **d14** | d14 | tower top: **c02**, c06(d08), c15(d07), c18(d04) · stem: **c12**, c03(d08), c09(d04), c22(d07) |
| B squat body | d01 d11 d12 **d15** | d15 | left foot: **c29**, c01(d11), c13(d01), c30(d12) · top body: **c20**, c08(d12), c27(d11), c28(d01) |
| C wide + tower, near | d02 d06 d10 **d03** | d03 | tower: **c04**, c05(d10), c17(d02), c25(d06) · mid lobes: **c19**, c11(d06), c21(d10), c32(d02) |
| D wide + tower, far | d05 d09 d16 **d13** | d13 | tower: **c14**, c10(d05), c16(d09), c26(d16) · base: **c07**, c23(d05), c24(d09), c31(d16) |

How I picked the reference: in every group one frame has a different sky (teal, or blue-grey with a white horizon haze), a salmon-pink cloud (a* +3 to +5 against +1 to +2 for the others), JPEG blocking and banded 8-bit sky, and no sun glow in the sky. The other three share a sky and a sun glow and differ only in look. The three renders split into three looks that repeat across framings:

- **N (neutral)**: d08, d11, d10, d05. Neutral white, mid contrast, smooth.
- **W (warm)**: d04, d12, d06, d09. Cream or beige cloud on a grey sky, flatter, with hot glare on faces toward the sun.
- **F (fibre)**: d07, d01, d02, d16. Cool white with lavender-to-blue shadows and a stippled fibre grain. In C and D the sky is saturated deep blue.

Scores are 1–10 for match to the reference: S surface, Sh shading, C colour, E edges, O overall "same cloud, same engine".

---

## Framing A (tall tower), reference d14

### Distance (full frames)
| Render | S | Sh | C | E | O |
|---|---|---|---|---|---|
| d08 (N) | 4 | 5 | 5 | 5 | **5** |
| d07 (F) | 4 | 5 | 4 | 4 | **5** |
| d04 (W) | 3 | 4 | 4 | 5 | **4** |

Ranking: d08 > d07 > d04.
- Ref: an even salmon-pink cloud with low contrast and fine cauliflower grain everywhere.
- d08: the closest tone and contrast, with pink in the shadows. Too smooth, and the shadow down the tower's right side is a deeper, cleaner ramp.
- d07: shading as soft as the ref, but the cast is cool lavender and the outline is a fuzzy fibre fringe.
- d04: a hot white glare on the left face of the tower, a cream cast and a heavier grey belly.

### Close-up: tower top (c02)
| Render | S | Sh | C | E | O |
|---|---|---|---|---|---|
| c06 (d08) | 3 | 5 | 5 | 4 | **4** |
| c15 (d07) | 3 | 5 | 4 | 3 | **4** |
| c18 (d04) | 2 | 4 | 3 | 4 | **3** |

Ranking: c06 ≥ c15 > c18.
- Light and dark fall in the right places in all three (lit left, grey right).
- The ref's face is covered in 20–60 px cauliflower lumps, and its outline is knobbly.
- c06 and c18 are airbrushed: one smooth ramp from light to dark, a marshmallow or shaving-foam material.
- c15 replaces the lumps with a 2–4 px stipple. The grain is the wrong scale and reads as fur.

### Close-up: stem (c12)
| Render | S | Sh | C | E | O |
|---|---|---|---|---|---|
| c03 (d08) | 4 | 5 | 5 | 5 | **5** |
| c09 (d04) | 4 | 5 | 3 | 5 | **4** |
| c22 (d07) | 3 | 4 | 4 | 4 | **4** |

Ranking: c03 > c09 ≈ c22.
- Ref: an even pinkish-grey mass (median L 58) with soft billows. The right edge stays grey.
- All three renders light a thin tendril at the upper right that the ref keeps dark.
- c03 and c09 have hard dark pits or notches mid-body (around x 560 and x 940 in the crop) that the ref does not have.
- c22 is too light (median L 66) and lavender, with grain.

---

## Framing B (squat body), reference d15

### Distance
| Render | S | Sh | C | E | O |
|---|---|---|---|---|---|
| d11 (N) | 4 | 5 | 5 | 5 | **5** |
| d01 (F) | 4 | 4 | 4 | 4 | **4** |
| d12 (W) | 3 | 4 | 4 | 5 | **4** |

Ranking: d11 > d01 ≈ d12.
- Ref: pink, with cauliflower lumps over the whole body and a grey interior with pock marks.
- d11 is closest in level and contrast. Its interior is smooth haze sprinkled with lit flecks, and a flat hazy slab sticks out on the right at y 630–690.
- d01: a cool cast, glowing patches in the interior, a fuzzy outline, and a more detached right foot.
- d12: a cream, flat version of d11.

### Close-up: top body (c20)
| Render | S | Sh | C | E | O |
|---|---|---|---|---|---|
| c27 (d11) | 3 | 4 | 5 | 5 | **4** |
| c28 (d01) | 3 | 4 | 3 | 5 | **4** |
| c08 (d12) | 2 | 3 | 4 | 4 | **3** |

Ranking: c27 ≥ c28 > c08.
- The ref is all billows: rounded lobes at several scales, each lit on top and darker underneath. None of the renders has this.
- c27: a smooth grey slab with bokeh-like lit flecks floating in it, a hard artefact.
- c28: a lumpier top edge, but a blue cast and a dark blue smudge in the lower right.
- c08: white-hot glare on the left and a featureless grey body.

### Close-up: left foot (c29)
| Render | S | Sh | C | E | O |
|---|---|---|---|---|---|
| c13 (d01) | 4 | 5 | 4 | 4 | **5** |
| c01 (d11) | 4 | 4 | 4 | 5 | **4** |
| c30 (d12) | 3 | 4 | 3 | 5 | **4** |

Ranking: c13 > c01 ≈ c30.
- Ref: a bright pink, knobbly foot (median L 88). The column to its right is lit pink.
- c13 is closest in brightness, but its edges are spray-paint fuzz rather than knobs.
- c01 and c30 put a grey shadow column on the right where the ref is lit. Their surfaces are smooth.
- The ref's foot also sits about 15 px further right and is slightly shorter.

---

## Framing C (near, wide + tower), reference d03

### Distance
| Render | S | Sh | C | E | O |
|---|---|---|---|---|---|
| d10 (N) | 4 | 3 | 4 | 5 | **4** |
| d06 (W) | 3 | 4 | 3 | 5 | **4** |
| d02 (F) | 3 | 2 | 2 | 3 | **3** |

Ranking: d10 ≥ d06 > d02.
- Ref: the cloud is front-lit, and its shadow sides are only slightly grey (p5 L 59). The renders put big dark faces on the tower's left side, the middle lobe and the connecting block (p5 L 47–55).
- The silhouette does not match fully. The renders have extra low skirts and feet at the bottom left that reach x 180 (the ref stops near x 265), and the middle lobes and tower base sit 30–80 px off. This may be the bookmark rather than the renderer.
- d02 has saturated blue shadows and a grain fringe.

### Close-up: tower (c04)
| Render | S | Sh | C | E | O |
|---|---|---|---|---|---|
| c25 (d06) | 3 | 3 | 3 | 4 | **3** |
| c05 (d10) | 3 | 2 | 4 | 4 | **3** |
| c17 (d02) | 2 | 1 | 1 | 2 | **2** |

Ranking: c25 ≥ c05 > c17.
- This is the worst mismatch in the set. The ref tower is bright pink-white almost everywhere, with fine lumps and one small grey cavity.
- All three renders fill the left two-thirds of the tower with a large smooth dark shadow, and the surface is airbrushed.
- c17 is navy-blue in the shadow, with stipple speckle along every edge.

### Close-up: mid lobes (c19)
| Render | S | Sh | C | E | O |
|---|---|---|---|---|---|
| c21 (d10) | 3 | 4 | 4 | 5 | **4** |
| c11 (d06) | 3 | 4 | 3 | 5 | **4** |
| c32 (d02) | 2 | 3 | 2 | 1 | **2** |

Ranking: c21 ≥ c11 > c32.
- c21 and c11 have a marbled, swirling contour-line texture on the lit patch at the right of the crop. It is plainly visible at 2x zoom.
- The big lobe's shadow core is darker and smoother than the ref's.
- c32 has heavy salt-and-pepper grain on every edge, so the detached puff looks dithered. Its shadows are blue.

---

## Framing D (far, wide + tower), reference d13

### Distance
| Render | S | Sh | C | E | O |
|---|---|---|---|---|---|
| d05 (N) | 4 | 4 | 4 | 5 | **4** |
| d09 (W) | 4 | 4 | 3 | 5 | **4** |
| d16 (F) | 3 | 3 | 3 | 3 | **3** |

Ranking: d05 > d09 > d16.
- Ref: very bright and front-lit (median L 92), pink, cauliflower surface, with a flat grey belly along the base.
- The renders are 13–18 L darker overall. They darken the cores of the middle lobe and the tower, and their bright sky glow is absent from the ref.
- d16 loses the belly: its base is bright white. It has a dark smudge at the base of the tower's right side and fibre fringes.

### Close-up: tower (c14)
| Render | S | Sh | C | E | O |
|---|---|---|---|---|---|
| c10 (d05) | 3 | 2 | 4 | 4 | **3** |
| c16 (d09) | 3 | 2 | 3 | 4 | **3** |
| c26 (d16) | 2 | 2 | 2 | 2 | **2** |

Ranking: c10 ≈ c16 > c26.
- Ref: lit pink-white with a soft grey only at the lower right.
- c10 and c16: the right half is dark brown-grey, rolled into smoke-like folds, and a hard-edged lit sheet (a hook) sits on top of it.
- c26: a blue-grey dark smudge and spray-paint stipple edges.

### Close-up: base (c07)
| Render | S | Sh | C | E | O |
|---|---|---|---|---|---|
| c23 (d05) | 4 | 5 | 4 | 4 | **5** |
| c24 (d09) | 4 | 5 | 3 | 4 | **4** |
| c31 (d16) | 3 | 3 | 3 | 3 | **3** |

Ranking: c23 > c24 > c31.
- The dark belly at the right of the base is in the right place in c23 and c24.
- But the renders have feathered low skirts at the left (x 0–300) that the ref lacks; the ref ends in a smooth tapered lobe. The base also sits about 25 px lower.
- c23 and c24 show the same marbled swirl texture on the lit patch at the top right.
- c31 has no belly, is uniformly bright, and is grainy.

---

## Summary

| Look | Distance (A/B/C/D) | Close-up (8 crops) | Mean O |
|---|---|---|---|
| N (d08, d11, d10, d05) | 5 / 5 / 4 / 4 | 4, 5, 4, 4, 3, 4, 3, 5 | **4.3** |
| W (d04, d12, d06, d09) | 4 / 4 / 4 / 4 | 3, 4, 3, 4, 3, 4, 3, 4 | **3.7** |
| F (d07, d01, d02, d16) | 5 / 4 / 3 / 3 | 4, 4, 4, 5, 2, 2, 2, 3 | **3.5** |

N is the closest at distance and close up. F does relatively well on the soft framings A and B and badly on C and D, where its blue shadows and grain dominate. No render reaches "same engine". A human would pick out every reference at a glance by colour alone.

## Remaining differences (all looks)
1. **Colour.** The Decima cloud is salmon or pink (a* +3 to +5) everywhere, including the shadows. The renders are neutral, cream or blue (a* +1 to +2). This is the first thing anyone sees.
2. **Shading.** Decima is front-lit with light shadow sides (p5 L about 59–67 in C and D). The renders cut deep, smooth shadow faces into the towers and lobes (p5 L 42–55), worst in C and D. The renders also light thin rim tendrils that Decima keeps grey, and the D renders are 13–18 L darker overall.
3. **Surface.** Decima has dense cauliflower billows at 20–80 px on every face, lit and shadowed. The renders are airbrushed: smooth ramps with no billow structure (N, W), or covered in a 2–4 px stipple (F). This is the biggest close-up gap.
4. **Edges.** Decima outlines are soft but knobbly. N and W are smooth-soft. F has fuzzy spray-paint or fibre fringes.
5. **Silhouette and placement (C, D).** The renders have extra low-density skirts and feet at the bottom left, and lobes are offset by 30–80 px. Check whether this is the camera bookmarks or the density cut-off. A and B match well.

## Hard artefacts per render
- **N (d08, d11, d10, d05):**
  - Lit flecks and bokeh blotches inside shadowed interiors (d11/c27, d10/c21).
  - Marbled swirl contour texture on lit patches (c21, c23).
  - Hard dark pits and notches in the stem (c03).
  - A hard-edged lit cusp sheet over smoky folds in the D tower (c10).
  - A flat hazy slab extending right in B (d11).
- **W (d04, d12, d06, d09):**
  - The same geometry artefacts as N (pits in c09; swirl in c11 and c24; cusp in c16; flecks in c08).
  - White-hot glare on sun-facing faces (c18, c08).
  - A beige-grey cast that flattens contrast.
- **F (d07, d01, d02, d16):**
  - Salt-and-pepper stipple or fibre grain over surfaces and outlines (c15, c13, c17, c32, c26, c31), very strong in C and D.
  - Saturated blue shadow cast (d02, d16).
  - Dark smudges (c28; c26; d16 at the base of the tower's right side).
  - Glowing, sparkling interior patches (d01).
  - Missing belly darkening (d16/c31).
- No contour or banding rings were found in any render's shadow gradients under a contrast stretch: the dither works. The only banding in the set is in the reference skies, which come from 8-bit JPEGs.
