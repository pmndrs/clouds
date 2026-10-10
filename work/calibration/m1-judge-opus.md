# M1 blind judging, Opus (2026-10-10)

Rubric v2 (`rubric.md`, 8 criteria, 1–10). I looked at the references first: Santa's Sleigh `end.jpg`, 3 sleigh details, the Frog panorama, FrogFace, and 3 Frog details. The 15 images were judged at full resolution, with side-by-side crops and colour samples. I did not open the key, captures, reports, or the board.

Calibration I used: 9–10 means it could pass in the owner's photos. The owner looks for vapour rather than foam, cohesion, and a crisp bright crust over a darker interior with grey (not sky-blue) shade.

## Grouping (by silhouette and framing)

| Group | Cloud / framing | Images |
|---|---|---|
| B | free-floating star-shaped cloud with two top domes and a sky hole between them, wide view | m23, m36, m75, m28 |
| C | tower on a lower mass ("duck" shape), wide view | m41, m78, m87, m95 |
| D | 20° detail of group C's sunlit upper third | m65, m62, m31, m20 |
| F | Frog-layout procedural (two head domes, long body slab, satellites below), 1600×1392 | m74, m92, m55 |

Each of B, C and D has the same four treatments:
- **grey**: crisp lit tops, neutral-grey belly (m23, m41, m65)
- **blue**: very bright white tops, saturated sky-blue shade (m36, m87, m62)
- **soft**: blurred, dim, warm-neutral, greyer sky (m75, m78, m31). This is probably the offline path-traced reference: different sky and tonemap, denoised or defocused look.
- **eroded**: thresholded and torn, with detached blobs (m28, m95, m20)

## Colour samples (mean RGB of a belly / interior patch; B−R is how blue the shade is)

| | belly B−R | belly luma | lit-top luma |
|---|---|---|---|
| Photos (sleigh detail, Frog pano, Frog detail) | **14 – 38** | 80 – 117 | ~240–250 (near clip) |
| grey m23 / m41 / m65 | 15 / 23 / 29 | ~140–150 | 204–217 |
| blue m36 / m87 / m62 | 66 / 69 / 74 | ~145–150 | 213–238 |
| soft m75 / m78 / m31 | −6 / 3 / 5 | ~127–145 | 191–206 |
| Frog m55 / m74 / m92 | 72 / 47 / 84 | 110–150 | 227–236 |

Only the grey treatment puts the shade hue inside the photo range. Every render is too low in contrast: the photo crust is near white while the belly sits around 80–115. The renders' bellies are about 30 levels too light, and their lit tops are 20–40 levels too dim.

## Scores

Criteria: 1 lobe hierarchy · 2 silhouette · 3 edge character · 4 shading and depth · 5 overall realism · 6 realism of form · 7 material · 8 cohesion.

### Group B (wide, star-shaped cloud)

**m23 (grey)**: 6 · 6 · 6 · 7 · **6** · 5 · **6** · **7**
1. Big domes carry billows, which carry curls; clear 3–4× steps.
2. Plausible puff, but it hangs in the air like a star with arms. No flat base.
3. Domed tops are reasonably crisp; side filaments read as smoke wisps.
4. Grey belly under the domes, and the lobes read as separate volumes. Best shading in the group.
5. Closest of the four to a photo. It loses on contrast and on the pyro-smoke shape.
6. Reads as a puff of smoke more than a cumulus: no base, no updraft tower.
7. Mostly vapour; the curling filaments give a slight smoke or steam feel.
8. Connective low-density between lobes; one body.

**m36 (blue)**: 6 · 6 · 5 · 5 · **4** · 5 · **4** · **6**
1. Same hierarchy as m23.
2. Same silhouette.
3. Rims are blown white and hard all round, including the thin parts.
4. Shade is sky-blue (B−R 66), so crevices read as holes cut through to the sky rather than a darker interior.
5. Eye-catching but not photographic.
6. Same form as m23.
7. Bleached foam or cotton with blue gel in the cracks.
8. Holds together, but the blue gaps visually split the lobes apart.

**m75 (soft, likely path-traced)**: 4 · 6 · 3 · 6 · **4** · 5 · **6** · **8**
1. Detail is blurred away; only the big domes survive.
2. Same outline, softened.
3. Uniformly soft, out-of-focus edges. This fails the owner's crisp-crust rule outright.
4. Neutral grey belly and a smooth gradation. It is the most physically believable light, but dim: the cloud is barely brighter than the sky.
5. Reads as a hazy or defocused photo, not as the owner's sunlit cumulus.
6. Same form as m23.
7. Genuine soft vapour with light passing into it; the tint is beige-warm.
8. Fully cohesive.

**m28 (eroded)**: 4 · 3 · 5 · 4 · **3** · 3 · **4** · **3**
1. Many equal popcorn tufts.
2. Torn: the left top dome is detached as a floating blob, and the arms are ragged and spiky.
3. Rims are crisp but noisy.
4. Nearly flat-lit, with little self-shadow.
5. A scatter of cotton balls.
6. Blobs of blobs.
7. Cotton wool or popcorn.
8. Lobes are spattered apart, with harsh gaps.

Ranking: **m23 > m36 ≈ m75 > m28**. The grey render wins on the owner's two axes: grey shade under a lit crust, plus cohesion. m36 and m75 fail in opposite directions: m36 has a crust but blue shade, m75 has grey shade but no crust. I give m36 the edge only because it reads as sunlit.

### Group C (wide, tower on a lower mass)

**m41 (grey)**: 6 · 6 · 6 · 7 · **6** · 6 · **6** · **7**
1. Tower dome over the side mass, with billows on both. Good steps.
2. The best outline in the set: a tower rising from a lower, wider mass. The bottom is still rounded rather than flat.
3. Crisp domed crown; the right side frays into smoke wisps.
4. Grey shadow sheet under the tower, and the tower reads in front of the mass.
5. Best wide render. With a brighter crown and darker belly it would sit near the sleigh's right tower.
6. Closest to a real cumulus of all 15.
7. Vapour, with a little steam in the wisps.
8. One body.

**m87 (blue)**: 6 · 6 · 5 · 5 · **4** · 6 · **4** · **6**
1. Same hierarchy as m41.
2. Same outline.
3. Rims are hard and blown white.
4. Sky-blue belly (B−R 69) and blue crevice lines.
5. Looks like a CG render.
6. Same form as m41.
7. Bleached foam.
8. Holds together, but the blue gaps split the lobes.

**m78 (soft)**: 3 · 6 · 3 · 6 · **4** · 5 · **6** · **8**
1. Almost no sub-structure survives the blur.
2. Same outline, softened.
3. Uniformly soft.
4. Grey belly and believable gradation, but low contrast and dim.
5. Out of focus. Thin wisps on the right do fade translucently, which is a good sign.
6. Same form, softened.
7. Vapour.
8. Cohesive.

**m95 (eroded)**: 4 · 4 · 5 · 4 · **3** · 3 · **4** · **3**
1. Equal tufts throughout.
2. Ragged arms, with stray droplets top-right and right.
3. Rims are crisp but lumpy.
4. Some blue self-shadow, but mostly flat.
5. Not a cloud you would photograph.
6. Blobs of blobs.
7. Cotton wool.
8. Lobes are disconnected and the falloff between them is harsh.

Ranking: **m41 > m87 ≈ m78 > m95**.

### Group D (20° detail of C's upper third)

**m65 (grey)**: 7 · 6 · 6 · 7 · **6** · 6 · **6** · **7**
1. Big dome, rolling billows, then curls: the clearest hierarchy in the set.
2. The crown outline is plausible.
3. The lit crust is moderately crisp. Compared with the Frog detail DSC00573 the rim lacks fine cauliflower granules and reads as rolled smoke.
4. Darker grey lower half, and the billows read as volumes.
5. Best detail. Its rims are softer and its folds smokier than the photos.
6. Billows and rolls read as a pyro plume more than cumulus cauliflower.
7. Vapour, with a smoke-plume feel in the curls.
8. Cohesive.

**m62 (blue)**: 7 · 6 · 6 · 5 · **5** · 6 · **4** · **6**
1. Same hierarchy as m65.
2. Same outline.
3. Crisp, bright crust. The best crust in the set, but blown out.
4. Saturated blue crevices (B−R 74) instead of grey.
5. Dramatic but CG.
6. Same form as m65.
7. Whipped cream with blue shadow.
8. Holds together.

**m31 (soft)**: 4 · 5 · 2 · 5 · **3** · 4 · **5** · **8**
1. Blur removes the detail scale, which is the whole point of this framing.
2. The outline is mushy.
3. Fully defocused.
4. Grey gradient, but flat.
5. Fails at detail scale.
6. Reads like steam or fog.
7. Vapour or steam.
8. Cohesive.

**m20 (eroded)**: 4 · 3 · 4 · 4 · **2** · 2 · **2** · **3**
1. Gooey lumps of one size.
2. Melted outline, with floating droplets.
3. Rims are rounded gel blobs.
4. Little depth.
5. Not a cloud.
6. Molten blobs.
7. Melted plastic or liquid gel. The worst material in the set.
8. Lumps are separated by harsh gaps.

Ranking: **m65 > m62 > m31 > m20**.

### Group F (Frog-layout procedural)

**m74**: 6 · 6 · 6 · 5 · **4** · 5 · **5** · **6**
1. Body, then domes, then grain: good steps, with the grain kept reasonably small.
2. Matches the Frog layout (two crowns, long body, satellites). But the heads are mushroom or broccoli caps on narrow necks, and the body is a flat-sided slab.
3. Rims are fairly crisp, and the smooth belly sheet is right.
4. The belly is the right idea (one smoother sheet, as in FrogFace) but sky-blue (B−R 47), and the shadow under the heads is blue.
5. Recognisably the Frog cloud, but CG: blue shade and stalked heads.
6. Layout is right; the heads read as separate cauliflowers rather than one mass with two crowns.
7. Soft cotton, the least foamy of the three.
8. The body is cohesive. A sky gap separates the heads from the body, and the satellites float apart.

**m92**: 5 · 6 · 6 · 5 · **4** · 5 · **4** · **6**
1. The same fine grain covers everything, including the belly; a single texture scale dominates.
2. Same as m74.
3. Rims are crispy and grainy.
4. The bluest shade in the set (B−R 84).
5. Cotton-wool model.
6. Same as m74.
7. Cotton wool or pumice grain.
8. Same as m74.

**m55**: 4 · 5 · 4 · 4 · **2** · 2 · **2** · **4**
1. The hierarchy is made of visible spheres.
2. Sphere-packed caps, and a sphere outline shows on every rim.
3. Hard sphere boundaries everywhere.
4. Blue shade; the spheres shade individually.
5. Primitive spheres, not a cloud.
6. Literally blobs of blobs.
7. Soap bubbles or plastic.
8. The slab is cohesive, but the spheres never blend.

Ranking: **m74 > m92 > m55**. m74 keeps the hierarchy but damps the grain on the belly. m92 puts grain everywhere, so it reads as cotton wool. m55 shows the raw sphere primitives.

## What separates best from worst

- **B, C and D:** the grey treatment wins every group. It is the only one that is grey under a lit crust, cohesive, and not blurred. The eroded treatment loses every group: it tears the body into cotton or gel blobs with harsh gaps and kills cohesion, which is the owner's main axis. The blue and soft treatments land in the middle for opposite reasons (crust without grey shade, grey shade without crust).
- **F:** what separates them is how the detail is applied. Visible primitives are worst, uniform fine grain is next, and grain that is damped on the belly is best. Shade colour is wrong in all three.
- **The path-traced candidate is not the best image.** Its light transport is the most physically plausible: neutral shade, translucent thin wisps, full cohesion. But it is blurred and dim, and it fails the crisp-crust rule. Use it as the target for shade colour and translucency, not for edges or brightness.

## Remaining gap to the photos (best renders: m41, m65, m23 at 6)

1. **Contrast.** The photos' lit crust is near white, with the belly at about 80–115 luma. The best renders' crowns are about 205–217 and their bellies about 140–150. The crust needs to be brighter and the interior and belly darker, or they will not pass. This is the single biggest step to a 7–8.
2. **Rim micro-structure.** Photo rims carry fine crisp cauliflower granules a few metres across. The VDB renders show rolled smoke curls and fraying filaments: the pyro-sim signature is still visible.
3. **Form.** Both VDB clouds are free-floating puffs with rounded bottoms. The photos have flatter bases, a vertical tower carrying domes, and one smooth dark belly sheet (FrogFace "mouth", sleigh left body).
4. **Shade hue.** This is solved by the grey treatment (B−R 15–29, inside the photo range of 14–38). The Frog procedural is still sky-blue (47–84) and needs the same lighting.
5. **Frog procedural.** The heads should merge into one mass with two crowns rather than mushroom caps on necks, and the sky gap between heads and body should close.
6. **Thin edges** need to fade translucent to sky as in m78's right side, without blurring the dense crust.
