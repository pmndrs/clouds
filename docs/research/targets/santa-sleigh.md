# Target study: Santa's Sleigh (multi-body cumulus line, 2022-07-29)

The hero is a **scene made of several cloud bodies**, not one cloud. A line of cumulus runs diagonally away from the camera. Its far end is a growing congestus (the "main body") that is merging with the smaller bodies along the line and pushing volume upward. Behind and above it: cirrus, a near overhead cumulus deck, and a far field of small cumulus.

Sources (owner photos, not in the repo):
- `artifacts/research/cloud-photos/santasSleigh/`: `early.jpg`, `middle.jpg`, `end.jpg`, `detail/DSC00632..643`, `Early detail/DSC00610..613`.
- Owner annotations: `artifacts/research/extracted/santa-sleigh/slide-1..4.png`.
- Work copies, crops and masks: `artifacts/research/extracted/targets/santa/` (gitignored, never copied here).

## 0. Shot list, timing and scale

All shots are from a Sony A7S III. The camera clock reads 08:2x UTC in `mdls`. The catalogue file names (`congestus/A_20220729-172804_DSC00629` is `end`) put the real local time at about 17:2x.

| File | Local time | Focal (mm) | HFOV | What it shows |
|---|---|---|---|---|
| `early.jpg` | 17:23:01 | 34 | 55.8° | whole line, "looser" stage |
| `Early detail/DSC00610` | 17:23:20 | 66 | 30.6° | main body, early (two towers) |
| `DSC00611` | 17:23:23 | 66 | | gap between line and main, small puffs in it |
| `DSC00612` | 17:23:25 | 66 | | left cloud (future head + link), ragged right end |
| `DSC00613` | 17:23:26 | 66 | | left cloud's left end, cirrus bands |
| `middle.jpg` | 17:25:45 | 24 | 73.7° | wide view: the sun is in frame at upper left, the line at lower right |
| `end.jpg` (the hero, slide 1) | 17:28:04 | 40 | 48.5° | 2048 px export (file dated 2022-08-02) |
| `detail/DSC00632..643` | 17:28:54–17:29:11 | 105 | 19.45° | 11-shot pan, left to right: head (632), head-link joint (633), link and arm (635–637), tower (638–641), main base (642), main lower-left and merge zone (643) |

Scale at 105 mm: 1 native px = 0.00459° = 8.0e-5 rad. In the `end` frame at 1600 px wide, 1 px = 0.0303°. That is 6.6 native 105 mm px.

Distances (section 3) are in multiples of the cloud-base height H. Metres are quoted for **H = 1.5 km** (a guess: summer afternoon, inland). They scale linearly with H. At that H, one native 105 mm pixel is about **0.66 m on the head, 0.88 m on the link and 0.96 m on the main body**.

All pixel coordinates below are in the 1600 px wide downsizes, unless marked "native".

## 1. Scene layers (end frame)

| Layer | Where in `end` | Distance class | Notes |
|---|---|---|---|
| **High cloud** | upper-left 60% of the sky, thin streaks across the middle | cirrus altitude | Fibrous cirrus streaks 10–40 px wide, up to 600–1000 px (18–30°) long. They rise to the right at **5–15°** from horizontal. A denser cirrostratus patch sits on the sun side (top-left). It is much thicker in `early` and `middle`, where it veils the sun. In `DSC00613` the cirrus forms two bright fibrous bands about 250 px (66 mm frame) apart, each with a defined lower edge and frayed upper fibres. |
| **Near overhead cumulus** | top edge, x 650–1600, y 0–185 | nearest (high elevation) | Same cumulus layer, seen almost overhead: lumpy, dark grey flat undersides. Its brightness is about 0.6 of the main tower (sample `#808696`). In `middle` these are the big dark masses at the top. Small broken fractus near it (x 1150–1360, y 220–300; `DSC00639`). |
| **Foreground line** (the subject) | y 390–870, x 70–1505 | 5.5H–8H (8–12 km) | Head, link, main body (section 2). |
| **Far cumulus field** | y 868–1000, down to the tree line | 15–40+ km | **29 separate small cumulus** (area ≥40 px). Widths 10–210 px (0.3–6.3°), median h/w ≈ 0.4, flat bases, getting smaller toward the horizon. They are the same layer seen farther away. They are not "in front" of the line: lower in frame means farther. |

Lighting: in `middle` the sun is at about (200, 290) on the 24 mm frame. That puts it about 25–30° left of the head's azimuth and about 55° left of the main's. Its elevation is roughly 35–40°. So the line is **side and back-lit from the upper left**:
- **head** (closest to the sun direction): dark blue-grey belly, about `#4c5a77`, luminance 85–90; bright silver rims only, luminance 200–216.
- **main body**: lit more from the front, bright white (luminance 150–230), with grey only in deep crevices and the lower right.

The sky is pale toward the sun (`#597ba8`) and deeper toward the right. The same sun gives the two ends of the line opposite tonal looks, and a renderer must reproduce that from geometry alone.

## 2. The bodies (end frame)

Colour names follow the owner's slide 2: **orange = head ("forming head")**, **green = link ("joining piece")**, **red = main body**.

Measured from a column-by-column cloud mask of `end` (B−R < 48 for y 370–885):

| | Head (orange) | Link (green) | Main body (red) |
|---|---|---|---|
| x extent | 70–575 | 575–1050 (overlaps head at 555–600 and main at 870–1050) | core 1075–1505; with the merge flank 870–1505 |
| Top | 515–535, flat-ish crest | 630–700 (domes); arm to 585 | tower summit **392** at x 1175–1200 |
| Base (lowest y) | 703 at the left end, sloping to **766** under the right half | 794 → 842 → 830 | **830–860**, flat |
| Size (px) | 490 long × 200–239 thick | 475 long × 130–160 thick | core width 430, tower height 463 |
| Aspect | L:H ≈ 2.1 | L:H ≈ 3.2 | W:H ≈ 0.93 (core), 1.37 incl. flank |
| Apparent size vs main | thickness 0.51 × main height | thickness 0.31 × main height | 1 |
| Physical size vs main (distance corrected, ×1.45 for main) | main height ≈ 2.9 × head thickness | main height ≈ 3.4 × link thickness | |
| Darkest band | at **0.66 of its height** down from the top (y 676–696), not at the base | 0.6–0.8 down | lower-right shelf and base |
| Texture class | lit cauliflower crust on the top 25–35%; the rest is a smooth dark belly; a lit "chin" lobe under the right half | row of 4 domes on top, flat base | tower: dense multi-scale cauliflower; vertical fluting low-left; laminar flat base |

**Base heights.** The bases are not all at one image height. The head base (mean y ≈ 745) is about 100 px higher in frame than the main base (≈ 845), and the link sits between them (≈ 825). For one shared condensation level, a base that is lower in frame is farther away. This ordering (head nearest, main farthest) is used in section 3. Within each body the base is flat to ±15 px, except the head. The head's base drops by 63 px from its left tip to the chin lobe. Read that as a separate, lower-hanging lit lobe, not as a tilted base.

### 2.1 Main body (red): congestus with an ejected tower
- **Tower.** It rises from the base at y ≈ 855 to y 392, nearly vertical, with the summit leaning about 3° left.
  - Width at y 500: about 250 px (tower plus the right shoulder).
  - Width at y 420: 70–90 px. This is the **summit knob**, 0.17–0.2 of the core width. It sits on the tower like a cap, with a notch on its right side (`DSC00638`, knob 470 native px ≈ 450 m).
- **Right shoulder.** At x 1290–1390, y 490–600, a lobe sticks out to the right, 0.2 of the core width. Its top is crisp. Its underside is translucent and bluish and fades into the sky (`DSC00640`).
- **Lower right shelf.** At x 1325–1505 the shelf top is at y 694–804, so it is 120–150 px thick, about **0.3 of the tower height**. It reaches **0.42 of the core width** out to the right of the tower. Its top is a terrace of rounded lumps.
- **Merge flank (left).** At x 870–1075 a cluster of smaller turrets joins the link to the tower base. The **arm** comes out of it (2.3).
- **Base.** Flat, smooth and darker. The lowest 10–15% shows 2–3 faint horizontal light lamina, roughly 100 m apart (`DSC00642`).
- **Slide-4 reading.** The owner drew the main as 4 overlapping circles. The photo has 4 lobes: tower, shoulder, shelf and merge flank.

### 2.2 Link (green): low connector with a dome row
- It is a long, low body. Its base is fairly flat, at y 794–842, and dips toward the main.
- On top is a row of **4 domes**, 180–300 native px wide (160–260 m), spaced about 300 native px apart (`DSC00636`). The notches between domes are narrow V crevices. Each dome has a crisp lit top and small edge bumps of 15–30 native px.
- At the head-link joint there is a short neck with 2–3 small domes (`DSC00633`, x 840–1010), and fine hair-like fibres at the top of the joint (`c636_link` crop, upper left).

### 2.3 The arm: an ejected turret
- It is a detached finger, rooted on the main's merge flank at about (1000, 700). It points up and left to about (870, 585).
- Length 174 px, about 1 km. Width 50–60 px, so the length is 3× the width. It leans **48° from vertical** toward the head.
- Its gap to the link below is 130 px at x 900, which shows it is lifted, not resting.
- Structure (`DSC00636`, `DSC00637`): a chain of 3–4 lumps, 330–360 native px each (about 300 m).
  - The upper-left **tip is densest, with crisp edges** (10–90% edge width 10 native px).
  - The lower-right **tail breaks up** into separate puffs of 70–150 native px with soft, translucent undersides (edge width about 40 native px). There are also two free puffs of 70–150 px beside it.
- The same lean shows in `early`. In `DSC00612`, ragged fragments rise off the right end of the left cloud, leaning up-left at 30–40°. In `DSC00610`/`11`, a narrow finger turret on the main's left edge leans slightly left.

### 2.4 Head (orange): the new body
- **Two tiers.**
  - Upper body: x 70–575, with a crest of **6–8 domes**, each 0.08–0.15 of the head's length (`DSC00632`).
  - Lower lobe ("chin"): under the right half (`c632_belly`), lit and bright, with fine fibrous fringes on its lower-left edge (filaments 5–10 native px thick).
- **Dark belly.** It covers about 55% of the visible face (smoothness measure, section 4). It is smooth, blue-grey and has no detail at any scale. Luminance runs from about 200 at the crest down to 85–90 in the belly, a **2.4:1** ratio. The bottom edge has a narrow lighter rim (silver lining) 15–30 native px wide.
- **Same state as the main 5 minutes earlier.** In `early` (`DSC00610`) the main had the same look: dark belly, lit crust, chin lobe, and a height-to-width ratio of 0.48. The head at `end` has a thickness-to-length ratio of 0.50. This is "new head forming" in the owner's words.

## 3. Plan layout and depth (reconciling slide 4)

**Depth from base elevation.**
- Assumption: the true horizon sits at y ≈ 1080 ± 40 in `end`. It is hidden by trees, and the far cumulus bases end at y ≈ 1035.
- With f = 1778 px, the elevation of each body's lowest base point is:
  - head 10.3°
  - link 7.8°
  - main 7.2°
- For a shared base height H, horizontal range = H / tan(elevation):
  - head ≈ 5.5H
  - link ≈ 7.3H
  - main ≈ 8.0H
- With the horizon at y 1040 instead, these become 6.2H, 8.7H and 9.6H. **The main is 1.45–1.55× farther away than the head.** These ranges are to each body's far base edge.

**Plan positions.** Camera at the origin, looking along +y, units of H:

| Body | Azimuth | Range | Plan (x, y) |
|---|---|---|---|
| Head | −15.3° | 5.5H | (−1.45, 5.31) |
| Link | +0.3° | 7.3H | (0.04, 7.33) |
| Main | +15.4° | 8.0H | (2.12, 7.68) |

- The line runs from the near-left head to the far-right main, at **about 34° to the picture plane**.
- Centre-to-centre spacing: head–link ≈ 2.5H, link–main ≈ 2.1H, head–main ≈ 4.3H. At H = 1.5 km that is about 3.8, 3.2 and 6.4 km.
- Rough physical sizes at H = 1.5 km, all ±30%:
  - main core width about 2.7 km (4 km with the flank)
  - tower about 2.5–3 km tall above the base, so the top is near 4–4.5 km
  - head thickness about 0.9 km, projected length about 2 km

**The owner's sketch (slide 4).** It shows a diagonal line from the main (top-left, a cluster of 4 circles) to the head (bottom-right). Between them are a trail of 4 small circles, the green ellipse, and 1 small circle between green and orange.
- It matches the photo if the **camera is at the sketch's right edge looking left**. Then image-left is the sketch's bottom, so the head is near and the main far, and the line sits at about 42° to the picture plane (measured: about 34°).
- Read with the camera at the bottom edge instead, the sketch is the mirror image of the photo.

Sketch element → photo element:
- 4 circles of the main → tower, shoulder, shelf, merge flank (2.1)
- trail of 4 small circles between main and green → the **arm plus the 2–3 free puffs and small flank turrets** at x 870–1075
- small circle between green and orange → the neck domes at the head-link joint (`DSC00633`)

Ambiguities (owner questions, section 7):
- the sketch's orientation
- whether the trail is the arm
- whether the head's long axis lies along the line or across it. If along it, its true length is about 1/cos 34° = 1.2× the projected length.

## 4. Dynamics: early → middle → end

The camera moved between frames, so positions are compared as **fractions of the formation's own angular span**, from the head's left tip to the main's right edge, using rectilinear angles.

| Measure | early (0:00) | middle (+2:44) | end (+5:03) |
|---|---|---|---|
| Total span (head tip → main right) | 52.2° | 47.7° | 43.9° |
| Head+link length | 28.5° (0.546 of span) | 27.6° (0.58) | 24.6° (0.56) |
| Main width | 22.7° (0.435) | 20.1° (0.42) | 19.4° (0.44) |
| Gap, line to main | ≈ 1–1.6° clear sky with 2 small puffs in it (`DSC00611`) | touching (link turrets reach the main) | merged; arm and flank turrets fill it |
| Main's left edge, as a fraction of span | 0.565 | ≈ 0.58 | 0.560 |
| **Main tower height ÷ main width** | **0.48** | **0.68** | **0.76** |
| Head (or left-cloud) thickness ÷ length | 0.26 (still one loose cloud with a ragged right end) | — | **0.50** (compact head) |

What the numbers support:
1. **The whole formation shrinks uniformly to 0.85× its angular size in 5 minutes.** Head, link and main all shrink by about the same factor (0.86, 0.85, 0.84). Read that as the formation **drifting away from the camera** by about 18% of its range. That is about 5–6 m/s at H = 1.5 km (4–5 m/s at H = 1.2 km). It is not relative motion between the bodies. The alternative is a focal-length or crop mismatch in the `end` export; EXIF accuracy of ±1 mm cannot explain 15%.
2. **Upward ejection is the big change.** Measured against the shrinking formation, the main tower's height grew about **1.6×** (10.8° → 14.8° raw; 17.4° after removing the 0.85 shrink). At the main's range that is roughly +1 km in 5 minutes, a **tower-top rise of about 3 m/s**. Most of it happened in the first 2.7 minutes (0.48 → 0.68).
3. **Merge.** The 1–1.6° gap closed by `middle` and was filled by `end`. In normalised position the main's left edge barely moved (0.565 → 0.560). The link's right end advanced (0.546 → 0.56), and the free puffs in the gap became the flank turrets and the arm.
   - So, **in azimuth, the "consumption" looks like the line and the gap puffs building into the main**, not the main sliding over them.
   - The relative closing speed in the picture plane is ≤ 1 m/s.
   - Motion along the line of sight cannot be measured here. The line recedes at 34°, so cos 34° = 0.83 of any along-line approach would still show in azimuth. A fast overtake should therefore have been visible.
4. **Shear and travel direction.** Every detached turret leans up and toward the head, image-left:
   - early fragments: 30–40°
   - the arm: 48°
   - the tower summit: about 3°

   So the flow at turret height moves image-left relative to the base layer. A deep cloud is steered by a deeper, faster layer of wind than the shallow clouds. That is the physical reason the owner's "its mass rides the wind faster" would hold: the main should drift left faster than the shallow line ahead of it.
5. **What grows.**
   - The head consolidates: thickness ÷ length goes 0.26 → 0.50, and the raw angular thickness stays at 7.5° while everything else shrinks 15%, so it really thickened by about 18%.
   - The link grows domes.
   - The ejected arm's tip is the densest part of it.
   - The later `congestus/A_20220729-173330_DSC00669` and `-173342_DSC00678` (17:33, unknown focal length) look like the same line five minutes after `end`, with a much taller middle body. Not measured; owner to confirm.
6. **Life-cycle phase lag.** The head at `end` matches the main at `early`: the same h/w (0.50 vs 0.48), the same two-tier look with dark belly, lit crust and chin. The bodies along the line are one life cycle at staggered phases. That is useful for authoring: one template set, offset in time.

**Where the volume is ejected.** All upward growth is on the main's **leading (head-facing) half**:
- the tower stands over the left 55% of the core
- the arm comes out of the merge flank
- the flank turrets rise where the link joins

The trailing right side is a low shelf (0.3 of the tower height) with a soft, translucent shoulder underside. This matches the owner's motion notes (`../cloud-motion-ideas.md`): sharp, compacted leading face; soft, lower trailing side.

## 5. Surface-detail catalogue

**How edges were measured.** Edge sharpness is the local 10–90% transition width across the cloud/sky edge, at native 105 mm resolution, using the B−R channel, 5 px averaged (ad-hoc script, not kept; crops in `extracted/targets/santa/c*.jpg`). Lit edges came out at **5–13 native px (about 3–12 m)**. Shaded undersides and tails came out at **29–41 px (about 20–40 m)**: **3–6× softer**.

**Smoothness fraction.** Local luminance std < 4 in a 9 px window on the 1600 px frame. It is resolution-limited, so it is comparable within this frame only.

| Body | Smooth overall | By height band (top → bottom) |
|---|---|---|
| Head | 55% | 25 / 36 / 77 / 70 / 38 % |
| Link | 34% | 7 / 25 / 48 / 35 / 25 % |
| Main | 63% | 52 / 73 / 76 / 46 / 63 % |

For the main, this mostly reflects the `end` frame's resolution.

| # | Detail type | Where | Scale | Edge | Best photo | How to make it |
|---|---|---|---|---|---|---|
| D1 | **Cauliflower crust, 3–4 nested lobe sizes** | top 25–35% of the head and link; the whole tower | Lobes step about **3–4× per level**: about 300 m → 70 m → 15–30 m (head: 460 / 105–115 / 20–50 native px). Tower knob 450 m, sub-lobes 100–190 m, edge bumps 10–25 m. Biggest lobes ≈ 0.15–0.17 of body width | lit tops 5–13 px (3–12 m); crevices between lobes are soft grey bands 20–40 px | `DSC00632` (head crest), `DSC00638` (tower top), `DSC00636` (link domes) | Inverted-Worley billows in 3 octaves with lacunarity about 4, not 2. Erode only where height fraction is above about 0.65, or where the sun term is high. Houdini: VDB from particles with a 3-level pscale hierarchy (ratio 4), then Cloud Noise with a billowy type and the amplitude masked by an "up and sunward" attribute. |
| D2 | **Smooth dark belly** | middle-lower 50–65% of the head, on the side away from the sun | whole-body scale, no structure below about 300 m | edge to sky 29 px with a 15–30 px silver rim | `DSC00632` (`c632_belly` crop) | Do **not** erode here. Set detail amplitude to about 0 below the crest band, or let the dimensional profile's interior hold density so the noise remap never cuts in. The smoothness comes from the lighting (multiple scattering only), so the renderer must not add a fake AO/detail term in shadow. Houdini: mask Cloud Noise by height fraction and normal·sun. |
| D3 | **Lit under-lobe ("chin")** | under the right half of the head; the same look under the main in `DSC00610` | 0.3–0.5 of the body's length, 0.25 of its thickness | crisp lit lower-left edge with 5–10 px fibrous fringes | `DSC00632`, `DSC00610` | Author a second, lower blob that sticks out past the belly's self-shadow. Procedurally: a negative base offset per sub-blob in the dimensional profile, so base height is not one plane per body. |
| D4 | **Flat laminar base** | main base, link base | flat to ±15 px across 400 px; 2–3 faint horizontal lamina about 100 m apart in the lowest 10–15% | 31 px (about 30 m) | `DSC00642` | Hard base cut at the condensation height, softened over about 30 m. Add a weak horizontal-stretch noise (5:1 anisotropic) in the bottom 10%. Houdini: VDB clip at base height, then a small VDB Smooth in y only. |
| D5 | **Sheared detached turret (the arm)** | rises from the merge flank toward the head | about 1 km long, 3:1, lean 48°; lumps 300 m shrinking to 60–140 m toward the tail | tip 10 px (9 m); tail underside 41 px (36 m) | `DSC00636`, `DSC00637` | Particle chain (3–4 spheres, size falling toward the tail) along a sheared rising path. Tip uses billowy erosion, tail uses wispy erosion, controlled by distance along the chain. Houdini: Pyro with a small hot source on the flank, a sheared wind field (speed rising with height, toward the head) and dissipation raised at the tail. |
| D6 | **Ragged rising fragments** | right end of the left cloud in `early` | 20–40 px puffs (66 mm), necks between them, lean 30–40° | soft, translucent, sky showing through | `DSC00612` (`c612_ragged`) | The same as D5 at an earlier, looser stage: low density, high wispy erosion, curl distortion along the lean direction. |
| D7 | **Vertical fluting in the merge zone** | main lower-left, where the link meets the tower | lit ridges and shaded grooves 100–150 native px wide (about 100–140 m), 400–500 px long, aspect 1:3–4 | 10–30 px, slightly fibrous | `DSC00643`, `DSC00642` (x 340–400) | Up-stretched noise: Worley scaled 1:3 in y inside a merge mask. Or the result of several small rising columns: in Houdini, a row of thin Pyro sources along the joint. |
| D8 | **Overhang lobe with translucent underside** | the tower's right shoulder | lobe 0.2 of core width | top crisp; underside fades into blue over 100–200 native px | `DSC00640` (`c640_shoulder`) | Wispy erosion and lower density on surfaces facing down. Detail type from the normal's y component, not only from height fraction. |
| D9 | **Summit knob with notch** | tower top | knob 0.17–0.2 of core width | cottony micro-fuzz, 8–47 px | `DSC00638` (`c638_top`) | One extra small sphere on the tower axis plus a subtractive notch. At 1:1 the "crisp" top is a fuzz of 10–25 px bumps. That needs a final high-frequency octave at about 10 m, not a smooth SDF edge. |
| D10 | **Neck domes at a joint** | head-link joint | 2–3 domes about 0.1 of link length | crisp | `DSC00633` | Smooth-min union of two bodies with a small k, plus a row of dome spheres seeded on the union seam. |
| D11 | **Dome row on a low body** | top of the link | 4 domes, 160–260 m, spacing ≈ dome width | crisp tops, sharp V notches | `DSC00636` (`c636_link`) | Seed spheres along the body's top ridge at a spacing about equal to their radius ×2. Billowy erosion. |
| D12 | **Fibrous hairs** | top of the head-link joint; the chin's lower-left | 5–10 native px filaments | very soft | `c636_link`, `c632_belly` | The highest wispy octave with curl distortion. Only at thin, low-density edges. |
| D13 | **Cirrus fibres** | high layer | streaks 10–40 px wide, 18–30° long, 5–15° slope; bands with defined lower edges | fibrous | `end.jpg`, `DSC00613` | 2D layer, anisotropic noise 20–40:1 along the wind direction, plus a domain-warped band mask. |

## 6. Recipe sketch

### (a) Procedural layers
1. **Cirrus** 2D layer at about 8–10 km.
   - Fibre noise stretched along a single wind direction (D13).
   - A thicker cirrostratus patch on the sun side, about 0.3–0.5 of the sky.
2. **Cumulus field** at base H.
   - Weather map with Worley islands for the far field: 25–30 cells visible in the last 10° above the horizon, h/w 0.3–0.5.
   - A few large mediocris close overhead with dark flat bases.
   - One flat base height for every cumulus. The depth ordering in section 3 depends on it.
3. **Up-rez rules** for all cumulus, carried into the authored bodies:
   - billowy and crisp at the top and on the sunward side
   - no erosion in the shaded belly
   - a hard, softened base with faint laminae
   - wispy erosion on surfaces facing down and on trailing surfaces
   - lobe octaves stepping about 3–4× in world metres (about 300/70/20 m)
   - a final roughly 10 m fuzz octave on lit edges

### (b) Authored volumes: 3 bodies plus 1 ejecta
Place them on a line at 34° to the camera: head at (−1.45, 5.3)H, link at (0, 7.3)H, main at (2.1, 7.7)H, all on base H.

| VDB / sim | Shape | Houdini route |
|---|---|---|
| Main | congestus: tower 1.0–1.1 × core width tall over the head-side 55% of the core, knob 0.17–0.2 width, right shoulder, right shelf 0.3 × tower height, merge flank of 3–5 small turrets | Pyro sim from a broad base source. Extra temperature on the head-side half. Wind shear toward the head. Cloud Noise masked by height and sun. |
| Link | low, L:H 3.2, flat base, 4-dome row | VDB from particles (dome spheres on a ridge curve), Cloud Noise billowy at the top only |
| Head | L:H 2.1, two tiers (crest + chin), crest of 6–8 domes | Particles: a crest row of large spheres plus a lower offset chin blob. No noise below the crest band. |
| Arm (ejecta) | 3–4 sphere chain, 3:1, lean 35–50° | Small Pyro puff on a sheared path, or an animated particle chain with tail dissipation |

### (c) What the multi-body interaction needs (missing today)
- **Per-body transforms and velocities.**
  - Shared drift about 5–6 m/s along the line, away from the camera.
  - The main gets an extra leftward component (deeper steering layer). Measured ≤ 1 m/s in the picture plane; the owner believes it is larger.
  - Detail must be **advected with each body**, never re-rolled (owner's "no boiling" rule).
- **Merge masks.** A per-pair blend field where two body SDFs meet. Smooth-min with a k that grows over minutes; in our evidence the gap closed in under 2.7 minutes. Inside the mask:
  - switch detail to vertical fluting (D7)
  - seed neck domes (D10)
  - raise the local updraft
- **Upward ejection.** An emitter on the main's leading flank, inside the merge mask:
  - it grows the tower at about 3 m/s (tower h/w 0.48 → 0.76 over 5 minutes)
  - it spawns detached turrets that lean 35–50° downshear
  - the turrets have dense tips and fraying tails (D5)
- **Life-cycle staging.** A per-body phase, so the forward body ("head") steps through the same states the main went through about 5 minutes earlier:
  - loose with ragged fragments (D6)
  - compact two-tier with a dark belly (D2, D3)
  - towering (D1, D9)
  - Implemented as a time offset on one template family, not three unrelated assets.
- **Directional detail.** Billowy and sharp on the leading, head-facing face. Translucent and soft on the trailing right shoulder and shelf (D8). This is plan task 9-D.

## 7. Open questions for the owner
1. **Sketch orientation.** Where were you standing, and which way does slide 4 face? The photo puts the head (orange) nearest and the main about 1.5× farther away, with the line receding to the right at about 34°. That matches the sketch only if the camera is at its right edge.
2. **Direction of travel.** All loose turrets lean up and toward the head (30–48°). Was the formation drifting image-left and away from you? Its angular size shrank 15% in 5 minutes.
3. **The catch-up.** In azimuth the main's left edge did not move relative to the line (within about 1°). The gap closed by the link and the gap puffs building into it. Did you see the main overtake, or the pieces grow into it? Do you have a video?
4. Are `congestus/A_20220729-173330_DSC00669` and `-173342_DSC00678` (17:33) this formation about 5 minutes after `end`? They seem to show the forward bodies grown much taller.
5. **Is `end.jpg` cropped?** It is a 2048 px export dated 2022-08-02. The original `DSC00629` would confirm the 40 mm scale.
6. **The early boxes.** In `early` your green box covers the middle of the left cloud (x 404–677 of 1600), and its ragged right third (677–885) is unboxed. Is that ragged end what became the link, or the arm?
7. Is the slide-4 "trail of small blobs" the arm plus the free puffs between the link and the main?
8. Roughly where were you, and which way were you facing? Knowing the base height would turn every distance here into metres.
