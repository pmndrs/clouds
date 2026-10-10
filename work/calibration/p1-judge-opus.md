# P1 blind judging: Opus (2026-10-10)

Rubric v2 (`rubric.md`, 8 criteria, 1–10). Calibrated to the owner's harsh scale from `results.md` / `r1-results.md`: 9–10 = could pass in the owner's photos; material and cohesion weigh as much as form.

References studied first: Santa's Sleigh `end.jpg` plus details DSC00633/638/642, and Frog Cloud `DSC00589-Pano.jpg` plus details DSC00565/573/582. What the photos show:
- **Lit crowns** are a crisp crust of small **convex** cauliflower domes, a few metres across, stacked on bigger domes.
- **The interior** under that crust is a smooth, **neutral grey** body. The bellies are grey-violet sheets, never sky-blue.
- **Thin edges and fragments** go translucent to the sky.
- **No concave pits** anywhere. The surface only ever bulges outwards.

Method: I viewed every image at full resolution. I made signed difference maps for each pair and full-resolution side-by-side crops of the regions that change. For a rough check I also counted dark spots in fixed regions (pixels darker than their 4–8 px blurred neighbourhood). Scratch files are in the session scratchpad under `judge-p1-opus/`.

## Pairs identified

There are four clouds. Each appears as one or two views, and each view as a pair with one change:

| Cloud | View | Pair |
|---|---|---|
| A, several separate domes on a flat slab (1600×1392 frame) | whole cloud | p01 / p10 |
| B, smooth sim-like clump with curled wisps | photo view | p03 / p05 |
| B | detail of upper body | p02 / p04 |
| C, large smooth lobes with pointed peaks | detail | p07 / p08 |
| D, small cumulus with a ring of detached puffs | photo view | p06 / p11 |
| D | detail | p09 / p12 |

In every pair the change is local surface texture: small dark dimples on the lit faces and in the recesses, plus the density of the thin satellite puffs. The overall form never changes.

## Scores

Columns: 1 Lobe hierarchy, 2 Silhouette, 3 Edge character, 4 Shading/depth, 5 Overall realism, 6 Realism of form, 7 Material, 8 Cohesion.

| id | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| p01 | 3 | 3 | 5 | 4 | **3** | 3 | 3 | 3 |
| p10 | 3 | 3 | 4 | 4 | **2** | 3 | 2 | 3 |
| p02 | 3 | 4 | 3 | 4 | **3** | 3 | 4 | 6 |
| p04 | 3 | 4 | 3 | 4 | **3** | 3 | 4 | 6 |
| p03 | 4 | 5 | 4 | 4 | **4** | 4 | 5 | 6 |
| p05 | 4 | 5 | 4 | 4 | **4** | 4 | 5 | 6 |
| p07 | 3 | 3 | 3 | 5 | **3** | 3 | 2 | 6 |
| p08 | 3 | 3 | 3 | 5 | **3** | 3 | 3 | 6 |
| p06 | 3 | 3 | 4 | 3 | **3** | 3 | 4 | 2 |
| p11 | 3 | 3 | 4 | 3 | **3** | 3 | 4 | 2 |
| p09 | 3 | 3 | 3 | 3 | **3** | 3 | 4 | 3 |
| p12 | 3 | 3 | 3 | 3 | **3** | 3 | 4 | 3 |

### p01: cloud A, whole
1. Lobe hierarchy 3: big round domes carry one uniform fine noise grain. The middle 3–4× step (domes on domes) is missing.
2. Silhouette 3: two mushroom heads on necks, a flat bar-shaped slab and egg-shaped satellites. These are primitives, not a cumulus outline.
3. Edges 5: lit crowns are crisp with a convex lumpy crust, which is right. But flanks and bottoms are just as crisp and rough, so nothing goes soft.
4. Shading 4: the domes read as separate volumes. All shadow is sky-blue, though, with no darker neutral belly. The slab is evenly lit.
5. Overall 3: reads as a CG cloud kit, not something from the owner's photos.
6. Form 3: blobs of blobs. Each body is a noise-displaced primitive.
7. Material 3: opaque cotton or coral. The grain is convex (good), but it covers every face evenly and has no vapour depth.
8. Cohesion 3: separate bodies with clean sky gaps between them and no connective low density.

### p10: cloud A, whole (pair of p01)
1. Lobe hierarchy 3: same domes. The added texture is concave, so it adds a scale with the wrong sign.
2. Silhouette 3: same as p01.
3. Edges 4: crowns are now broken by crater rims, so the lit crust reads as eroded rather than domed.
4. Shading 4: same as p01. The pits add dark specks, not depth.
5. Overall 2: the crowns are covered in **concave pits and craters**. This is pumice, sponge or meringue, which a real cumulus never shows.
6. Form 3: same forms as p01.
7. Material 2: pumice/sponge, the clearest pit failure in the set.
8. Cohesion 3: same as p01.

### p02: cloud B, detail
1. Lobe hierarchy 3: smeared tubes and swirls with no small convex domes on the crowns.
2. Silhouette 4: the cloud body is fine. Curled hook-wisps at the top right and a detached ball look like a fluid sim.
3. Edges 3: everything is uniformly soft, with no crisp lit crust anywhere.
4. Shading 4: blue cavities separate some lobes, but most of the frame is evenly bright.
5. Overall 3: melted, viscous, like whipped cream or smoke more than cumulus.
6. Form 3: melted lobes, not stacked domes.
7. Material 4: soft and somewhat translucent, so closer to vapour than foam, but liquid-like. Moiré dither grain shows in the thin parts at 1:1.
8. Cohesion 6: one connected body, and lobes blend into each other.

### p04: cloud B, detail (pair of p02)
Same as p02 on every criterion. Some lit ridges are a touch crisper. A few dark dimples are sharper, for example the hole about 1/3 from the left at the base of the central lobe. Overall 3.

### p03: cloud B, photo view
1. Lobe hierarchy 4: main mass, an upper tower and mid-size lobes, with some small lumps on the left flank. Still no cauliflower crust.
2. Silhouette 5: a plausible irregular cumulus clump. Hooked wisps at the top right, and balls budding off the left and right, give it away.
3. Edges 4: soft overall. The left flank has some crisp detail, but the lit crown is not crisp.
4. Shading 4: small blue crevices. No darker belly; the underside is as light as the top.
5. Overall 4: the best of the set at photo distance, but too soft and too evenly lit to pass.
6. Form 4: reads as a cloud, although a smoke-sim cloud.
7. Material 5: vapour-ish. Light goes into it and it is not foam, but it is cottony and lacks a bright crust over a darker interior.
8. Cohesion 6: one body with connective density. The fragments break away, not spatter.

### p05: cloud B, photo view (pair of p03)
Indistinguishable from p03 at this distance. The difference map shows only scattered, tiny dimple changes. Scores are identical. Overall 4.

### p07: cloud C, detail
1. Lobe hierarchy 3: only large smooth lobes, with no smaller domes on them.
2. Silhouette 3: the crown rises into pointed cones or horns, which cumulus does not do.
3. Edges 3: uniformly rounded and soft, marshmallow edges with no crisp crust.
4. Shading 5: strong self-shadowed recesses separate the lobes as volumes. This is the best depth in the set, but it is all sky-blue.
5. Overall 3: smooth putty or marshmallow sculpture.
6. Form 3: blobs with horns.
7. Material 2: plastic or putty. The shadowed recesses hold **dark crater dimples** with moiré grain in them.
8. Cohesion 6: one connected body.

### p08: cloud C, detail (pair of p07)
Same as p07, except the recesses are clean, smooth and convex, and most of the dimples and moiré are gone. Material 3 (marshmallow without craters). Overall 3.

### p06: cloud D, photo view
1. Lobe hierarchy 3: small towers on a core, no further hierarchy.
2. Silhouette 3: a humilis core surrounded by confetti, a dozen detached puffs that look exploded rather than evaporating.
3. Edges 4: puffs are soft with a dithered fringe. The core is soft. The lit tops are moderately defined.
4. Shading 3: an odd blurred, defocused smudge band runs across the core, and there is no belly.
5. Overall 3: the scattered fragments do not read as a real cumulus field.
6. Form 3: blobs plus spatter.
7. Material 4: soft, vapour-ish puffs with grainy dithering.
8. Cohesion 2: textbook "spattering of mid-density blobs". The fragments sit in clean sky with no connective wisps.

### p11: cloud D, photo view (pair of p06)
Same as p06. The satellite puffs are a touch more translucent and smoother, with slightly fewer holes. Overall 3.

### p09: cloud D, detail
1. Lobe hierarchy 3: a few rounded towers, no smaller domes.
2. Silhouette 3: a ring of floating, rag-like puffs around the crown.
3. Edges 3: fuzzy, dithered fringes everywhere, with no crisp crust.
4. Shading 3: a large blurred blue sheet in the middle looks like a smear or a hole, not a belly.
5. Overall 3: soft and incoherent.
6. Form 3: blobs.
7. Material 4: soft vapour-like puffs, but grainy, with dark holes in the puffs.
8. Cohesion 3: the main body holds together, but the satellites are separate.

### p12: cloud D, detail (pair of p09)
Same as p09. The satellite puffs are thinner and more translucent, with fewer dark holes in them. Overall 3.

## Pair verdicts

1. **p01 > p10, clear.** p10 puts concave pits and craters across every lit crown and the slab top, a pumice/sponge look. p01's grain is convex lumps. The domes are the same.
2. **p02 ≈ p04, slight lean p02.** p04 has slightly crisper lit ridges but also a couple of sharper dark pits. The difference is barely visible at 1:1.
3. **p03 = p05, tie.** No difference I can see at photo distance.
4. **p06 ≈ p11, slight lean p11.** The satellites are a touch more translucent and less pockmarked. The core is unchanged.
5. **p08 > p07, clear.** p07's shadowed recesses hold dark crater dimples with moiré grain. p08's recesses are smooth, convex lobes.
6. **p12 > p09, slight.** p12's satellite puffs are thinner and more translucent, with fewer holes. p09's are denser and pockmarked.

Pattern: in every pair where I can see a difference, the better image has **fewer concave dimples**. The change is clear on the dense, crisp-surfaced clouds (A, C), and on the soft sim cloud (B) it barely registers. The pit counts agree in direction: p10 > p01, p07 > p08, p09 > p12, p04 ≥ p02, and p03 = p05 and p06 = p11.

## Ranking (overall realism)

p03 = p05 (4) > p04 ≈ p02 > p01 > p08 > p11 > p06 > p12 > p09 > p07 (3) > p10 (2)

## What separates all of them from the photos
- **No crisp cauliflower crust over a softer, darker interior.** Cloud A has a crisp surface everywhere; clouds B, C and D are soft everywhere.
- **Every shadow and cavity is sky-blue.** The photos' bellies are neutral grey to grey-violet.
- **Moiré or dither grain shows at 1:1** in the thin regions of every 1920×1080 image.
- **Wrong primitives.** Cloud A is built from noise-displaced primitives (mushrooms, slab, eggs). Cloud C's crown has pointed horns. Cloud D is a core in a confetti of detached puffs.
