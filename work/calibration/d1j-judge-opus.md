# D1 blind set j: Opus judge

Set: `scratchpad/blind-d1j/` (d01–d12 full frames at 1920x1080, c01–c36 crops). I judged it blind: I opened no key files, D1 reports, d1 results or earlier judge files. I followed the rubric's judging method. I looked at every region at native size and at 2–4x sub-crops. Pixel statistics came after the visual pass and served only as a cross-check.

## 1. Grouping and references

The frames fall into four framings. In each, exactly one frame has no render dither: its sky high-pass std is 0.05–0.11, against about 0.49 for every other frame. Two of those four also carry 8x8 JPEG blocking (d01 1.80, d06 1.57). Their look matches too: warm pink lit faces, dense floret grain and scanline banding in the sky. Those four frames are the references.

| Framing | Content | Reference | Renders |
|---|---|---|---|
| A | wide cloud with a tower on the right, deep-blue sky | **d02** | d03, d05 |
| B | the same cloud in another framing, white haze below the horizon | **d07** | d09, d10 |
| C | a flat-topped mass with a left foot | **d01** (JPEG) | d04, d12 |
| D | a tall tower | **d06** (JPEG) | d08, d11 |

Template matching (NCC about 1.000) shows the crops are 2x of the 1080p frames. The regions below are given in frame pixels (x, y, w, h).

| Region | Box | Ref crop | Renders |
|---|---|---|---|
| A-R1 left lobe and crest | 350,330,500,330 | c25 | c01 = d03, c29 = d05 |
| A-R2 tower | 1150,180,400,520 | c10 | c12 = d03, c30 = d05 |
| A-R3 tower shade face | 1200,300,200,200 | c24 | c20 = d03, c27 = d05 |
| B-R4 central junction | 820,540,220,160 | c31 | c15 = d09, c09 = d10 |
| B-R5 tower | 1100,150,480,560 | c28 | c11 = d09, c19 = d10 |
| B-R6 base and belly | 300,560,900,300 | c32 | c13 = d09, c23 = d10 |
| C-R7 left foot | 40,520,560,340 | c04 | c26 = d04, c06 = d12 |
| C-R8 top crest | 560,180,700,500 | c02 | c07 = d04, c35 = d12 |
| C-R9 "eye" pocket | 1100,500,160,120 | c17 | c36 = d04, c22 = d12 |
| D-R10 lower trunk | 650,600,700,300 | c08 | c03 = d08, c18 = d11 |
| D-R11 dome top | 500,100,700,450 | c34 | c05 = d08, c16 = d11 |
| D-R12 shade junction | 960,620,300,300 | c14 | c21 = d08, c33 = d11 |

The variants pair up by sky. One variant paints a ramp sky with a visible step (d05, d10, d04, d08). The other uses an Earth-style sky (d03, d09, d12, d11). I still judged each framing on its own.

## 2. Full-frame scores (1–10, harsh)

| Framing | Image | Surface | Shading | Colour | Edges | Overall |
|---|---|---|---|---|---|---|
| A | d03 | 4 | 4 | 3 | 5 | 4 |
| A | d05 | 4 | 4 | 4 | 4 | 4 |
| B | d09 | 3 | 4 | 3 | 4 | 3 |
| B | d10 | 4 | 4 | 4 | 3 | 4 |
| C | d04 | 3 | 3 | 3 | 4 | 3 |
| C | d12 | 5 | 5 | 3 | 5 | 4 |
| D | d08 | 3 | 3 | 3 | 4 | 3 |
| D | d11 | 4 | 5 | 3 | 5 | 4 |

**Winners**

| Framing | At distance | Up close |
|---|---|---|
| A | d05, narrowly: belly a touch lighter, tower lumpier, sky hue nearer d02 | d03, narrowly: crisper crests, fewer whorls and rings |
| B | d10: scene colour and haze match d07 | d10, narrowly: more lumps on the tower, but its base dissolves |
| C | d12: tonal range and crest relief nearer d01 | d12 |
| D | d11: dark shade and bright lit range nearer d06 | d11 on the trunk and dome; d08 on the deep-shade junction (R12) |

Neither render in any framing reads as "same cloud, same engine". The best overall score is 4.

### Notes per framing

**A (ref d02)**
- d02 is pink-white throughout. Its lit crests are crisp with fine florets and grain. The belly is an even mauve-grey and the base edge is crisp with small puffs.
- d03 and d05 are nearly the same cloud as each other, and both differ from d02:
  - Both are cool neutral grey; the lit-face mean is 216,212,209 against d02's 232,222,220.
  - Both have a dark grey belly stripe and a deep V crease at about 650–1000, 640–760 that d02 does not have.
  - Both have a soft, defocused base edge.
  - The tower interior of both carries amber glows.
- Surface: d03 reads as smooth balloon lobes. d05 has more relief, but as whorls and rings rather than florets. Floret blob density on the whole cloud is d02 1.36, d03 0.88, d05 1.07. The 4–12 px band is d02 1.01, d03 0.61, d05 0.63.

**B (ref d07)**
- d07's lit tops are bright pink-white (236,228,226) with dense cauliflower. The underside is crisp and slate-grey.
- Both renders:
  - The lit tops are beige or neutral and dim (about 216).
  - The silhouettes are soft balloons.
  - A sooty dark smudge sits on the tower's right-lower trunk. d07 has none.
- d09 is a cream-beige cloud on a deep-blue sky, with a whitish glow at the left edge and a horizon band.
- d10's sky and haze match d07, but its base dissolves into the white fog, while d07's base stays visible and crisp.
- Blob density: d07 1.76, d10 1.60, d09 0.84. The 4–12 px band: d07 1.09, d10 0.56, d09 0.51. So d10 has nearly the right number of lumps at half the amplitude.

**C (ref d01)**
- d01 is warm salmon-pink, with dense floret relief over the whole face and dark pits (the "eye" at about 1185,530).
- d04 is washed flat: median luminance 159 against 142, 95th percentile 209 against 233. It is grey and hazy, with whorl creases on the crest. Its sky ramp (a white horizon) is the better sky match.
- d12 has the right drama: median 148, crisp bumpy crest, darker shade. Its cloud is still neutral grey, and its sky is purple-blue with no white horizon.
- The 4–12 px band is d01 0.87, d04 0.78, d12 1.54. d12 overshoots, but through larger-scale contrast, not florets. Blob density is d01 1.21, d12 1.01, d04 0.69.

**D (ref d06)**
- d06 is pink-salmon, with mottled floret texture across the dome and mauve shade.
- d08 is washed out (luminance 5th/95th percentile 141/209 against 130/230), grey and flat, with thin whorl crease lines on the dome. Its base melts into the ramp fog.
- d11 has the right tonal range (123/232). But its main dome is a smooth blown plateau (a balloon), and the shade side has a slit and a crescent.
- Blob density is d06 1.45, d11 1.13, d08 1.05. The 4–12 px band is d06 1.10, d11 1.59 (overshoot, from contrast), d08 0.47.

## 3. Crop scores (surface / shading / colour / edges / overall)

| Region | Crop (source) | S | Sh | C | E | O | Pick | Note |
|---|---|---|---|---|---|---|---|---|
| A-R1 | c01 (d03) | 4 | 4 | 3 | 5 | 4 | **c01** | Smooth lobes, crisper outline. d02 has crisp fine florets on the edge and pinker light. |
| A-R1 | c29 (d05) | 4 | 4 | 3 | 4 | 4 | | More lumps, but whorl rings on the right dome; hazier edge. |
| A-R2 | c12 (d03) | 4 | 4 | 3 | 4 | 4 | **c12** | Balloon lobes, thin bright ridge lines, amber glow in the trunk. |
| A-R2 | c30 (d05) | 4 | 4 | 3 | 4 | 3 | | Rings and stringy slits on the right flank; a stronger amber glow. |
| A-R3 | c20 (d03) | 3 | 4 | 3 | – | 3 | | Smeared, blue-grey, few lumps; vertical amber streak. |
| A-R3 | c27 (d05) | 4 | 4 | 3 | – | 4 | **c27** | Closer to d02's defined lumps and dark pockets, but whorl creases and an amber glow. |
| B-R4 | c15 (d09) | 4 | 4 | 3 | – | 4 | | Beige; lump contrast higher than d07's smooth pink junction. |
| B-R4 | c09 (d10) | 4 | 4 | 4 | – | 4 | **c09** (narrow) | More neutral colour; a ring/whorl at upper left. |
| B-R5 | c11 (d09) | 3 | 3 | 3 | 4 | 3 | | Balloon tower, soft crest, sooty trunk. |
| B-R5 | c19 (d10) | 4 | 3 | 4 | 3 | 4 | **c19** | More lumps; hazed crest; sooty trunk. |
| B-R6 | c13 (d09) | 4 | 4 | 3 | 4 | 4 | **c13** | Base outline present, but the belly is a dark blurred band. |
| B-R6 | c23 (d10) | 3 | 3 | 4 | 2 | 3 | | The base dissolves into the fog; d07's base is crisp. |
| C-R7 | c26 (d04) | 3 | 3 | 3 | 5 | 3 | | Grey smooth foot (d01's is warm cauliflower); dark slit pit. |
| C-R7 | c06 (d12) | 4 | 4 | 3 | 5 | 4 | **c06** | Same slit; better relief. |
| C-R8 | c07 (d04) | 3 | 3 | 3 | 4 | 3 | | Washed flat; whorl creases on the crest; amber glow. |
| C-R8 | c35 (d12) | 5 | 5 | 3 | 5 | 4 | **c35** | Crisp bumpy crest, but a white plateau; amber glow; sparkle. |
| C-R9 | c36 (d04) | 4 | 3 | 3 | – | 3 | | d01's dark eye with a pale sliver is reduced to a flat crescent. |
| C-R9 | c22 (d12) | 4 | 4 | 3 | – | 4 | **c22** | Darker, closer pocket. |
| D-R10 | c03 (d08) | 3 | 3 | 3 | 4 | 3 | | Flat grey, faint vertical slit. |
| D-R10 | c18 (d11) | 4 | 5 | 3 | 4 | 4 | **c18** | Shade depth right; slit and crescent; bright white hook at about 1215,690 (pinker and dimmer in d06). |
| D-R11 | c05 (d08) | 3 | 3 | 3 | 4 | 3 | | Grey flat dome with thin curly whorl lines. |
| D-R11 | c16 (d11) | 3 | 4 | 3 | 5 | 4 | **c16** | Blown smooth plateau (balloon); swirl fringe on the left lobe. |
| D-R12 | c21 (d08) | 4 | 4 | 3 | 4 | 4 | **c21** | Soft low-contrast shade like d06 (blobs 0.98 against 0.73); faint slit. |
| D-R12 | c33 (d11) | 3 | 3 | 3 | 4 | 3 | | Too contrasty; ring/crescent whorl and a dark slit. |

## 4. Hard artefacts (frame pixel coordinates)

Features present in the reference as well, such as the white sliver in A's notch at about 946,530, are not listed.

**d03**
- Fleck: a 2 px speck in the sky above the left lobe at about 780,343.
- Glow: an amber vertical streak in the tower shade at about 1281,490 (about 15x40 px).
- Thin bright ridge lines on the tower's right flank, about 1455–1490, 320–410.
- Defocus: a soft, defocused silhouette on the tower's left side (about 1160–1200, 300–500) and on the base edge (about 300–1000, 780–820).
- Sky: a warm grey-yellow horizon haze below y≈900 that d02 does not have.

**d05**
- Fleck: about 788,308.
- Glow: amber, at about 1279,450 (about 15x40 px).
- Rings: a ring/whorl about 20 px across at about 1389,357; whorl creases at about 1376,350.
- Slits: stringy slits on the tower's right flank, x≈1430–1450, y≈300–420.
- Haze: the base edge is hazed.
- Sky: a horizontal step band at y≈400–430 across the whole frame.

**d09**
- Fleck: about 888,377.
- Smear: a sooty dark smudge on the tower's right-lower trunk at about 1392,600 (about 60x100 px).
- Defocus: soft, defocused crest silhouettes (tower left edge about 1150–1200, 300–450).
- Sky: a whitish glow at the left edge (x<300) and a horizon band at y≈880–920.

**d10**
- Fleck: faint, at about 888,376.
- Ring: a ring/whorl at about 876,558.
- Smear: a sooty trunk smudge at about 1392,600.
- Haze: the base dissolves into the fog (about 330–900, 720–790), and a grey veil sits over the lit crests.
- Sky: a step band at y≈400–440.

**d04**
- Slit: a dark slit/pit in the lit foot at about 365,773 (about 10x4 px).
- Sparkle: a white fleck/disc in the shade at about 803,655 (about 6 px).
- Glow: faint amber, at about 1010,490.
- Whorls: whorl creases on the top crest, about 910–985, 255–305.
- Haze: a haze veil over the whole body.
- Sky: a curved ramp band at y≈650–700.

**d12**
- Slit: the same slit/pit at about 365,773.
- Sparkle: a white disc at about 803,655, brighter than in d04.
- Glow: an amber blotch at about 970,505 (about 30 px).
- Sky: a purple-blue sky with no white horizon.

**d08**
- Whorls: whorl and slit crease lines across the main dome at about 820,210 and 800,262, and curly whorls on the left lobe at about 615,460.
- Slit: a faint vertical crease slit at about 1127,745.
- Haze: the base dissolves into the fog (about 800–1250, 880–950).
- Sky: a curved ramp band at y≈760–800.

**d11**
- Slit: a dark vertical slit at about 1127,745 (about 3x60 px).
- Crescent: a crescent/ring whorl at about 1079,715 (about 30 px).
- Blown smooth plateau on the main dome, about 700–950, 140–350.
- Swirl fringe on the left lobe edge at about 630,500.
- A small detached puff at about 1289,675 (minor).

## 5. Main remaining differences, biggest first

1. **Colour of the cloud.** All four references have warm pink-salmon lit faces (R−B +12 to +25) and mauve shade. Every render is neutral grey, or cream-beige in d09. The lit faces are also too dim: about 206–217 against 230–236. The exception is d11, at 226.
2. **Surface.** The references are covered in small cauliflower florets and grain on both lit and shade faces. The renders read as smooth balloons:
   - The 4–12 px amplitude is about 40–60% of the reference in A, B and d08.
   - Where d12 and d11 match or exceed the amplitude, it comes from larger-scale contrast and blown white plateaus, not from florets.
   - What fine relief the renders do have comes as whorls, rings and slits rather than domes.
3. **Edges and haze.** Render silhouettes and bases are softer, and often look defocused. The ramp-sky variant dissolves the base into the fog in B and D. The references keep crisp lit edges and a visible underside.
4. **Shading distribution.**
   - A: both renders have a dark belly stripe and a deep central crease that d02 does not have.
   - B: both have a sooty smudge on the tower trunk.
   - C and D: one variant (d04, d08) is washed flat; the other (d12, d11) has the right range but a blown top.
5. **Sky.** Neither variant matches. The ramp variant shows a visible step or curved band. The Earth variant has the wrong hue: purple-blue, a warm horizon, a left-edge glow in d09.
6. **Small hard artefacts.** Amber glows in the shaded interiors (A, C), sky flecks above the left lobe (A, B), the slit in C's foot and the white sparkle disc, and the slit and crescent in D.
7. **Framing.** In A and B the reference cloud sits differently from the renders: the lobes are lower and placed differently. Some silhouette difference therefore comes from camera or framing, not from the look.
