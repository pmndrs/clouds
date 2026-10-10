# M1 blind judging, Fable (2026-10-10)

Rubric v2 (8 criteria, 1–10). Set: 15 unlabelled images in `scratchpad/blind-m1/`, judged at full resolution with 2× crops of crust and belly regions. References studied first: `santasSleigh/end.jpg`, `santasSleigh/detail/DSC00632, 00637, 00642`, `Frog Cloud/DSC00589-Pano.jpg`, `FrogFace.png`, `Frog Cloud/detail/DSC00563, 00575, 00586`. Key, captures, reports and board not opened.

Calibration: 9–10 means it could pass in one of the owner's photos. What the photos show and the renders must match: a hard, bright lit crust a few metres thick over a slightly darker lit interior; large smooth lobe faces broken by sharp creases, with bumps at 3–4× steps down to the pixel; a neutral grey (not blue) flat belly that is one continuous sheet; thin edges that go translucent into the sky; one body, the satellites bound to it by faint tissue.

Column key: Lobe / Silh / Edge / Shade / Real / Form / Material / Cohesion.

## Grouping

| Group | Images | What it is |
|---|---|---|
| G1 | m55, m74, m92 | 1600×1392, the Frog framing: two columns on the left, a long bar, satellites below. Same forms, three renders. |
| G2 | m23, m36, m75 | 960×540, wide: cloud with a sky hole in the upper middle, dome top-left, dome right, lobe below. Same cloud, three renders. |
| G3 | m41, m78, m87 | 960×540, wide: tall body with a bright cap at top right. Same cloud, three renders. |
| G4 | m31, m62, m65 | 960×540, 20° detail of the G3 cap (big dome top centre, smaller lobe lower right). Same framing, three renders. |
| G5 | m95 + m20, m28 | 960×540. m95 wide and m20 its 20° detail (the ring and the detached droplets match). m28 is a different, torn open cloud at a similar framing; grouped here as the other "open lobed" candidate. |

Within G2, G3 and G4 the three renders are clearly the same three modes: a very soft, smoke-like one with warm-grey shading (m75, m78, m31); a mid-contrast one with grey bellies (m23, m41, m65); a high-key crisp one with blue shade and uniform fine grain (m36, m87, m62). If one mode is the offline path-traced reference, the soft trio is the likeliest (physically smooth light transport, no blue shadow, but the density field looks blurred). In G1, m55 is the raw sphere-sum form with the smoothest, most physical lighting and may be the offline render of the un-noised form. Either way they are scored as candidates.

## Scores

### G1, Frog framing

| id | Lobe | Silh | Edge | Shade | Real | Form | Material | Cohesion | Overall |
|---|---|---|---|---|---|---|---|---|---|
| m92 | 3 | 3 | 4 | 4 | 3 | 3 | 3 | 4 | **3** |
| m74 | 3 | 3 | 3 | 4 | 3 | 3 | 3 | 4 | **3** |
| m55 | 2 | 3 | 3 | 5 | 2 | 2 | 2 | 4 | **2** |

m92. Lobe 3: one level, bun plus pimples, no 3–4× cascade. Silh 3: two mushroom columns and a flat slab are primitives, though the layout echoes the Frog (eyes over a body bar). Edge 4: crisp everywhere, the undersides as hard as the tops. Shade 4: shadowed column faces and bar underside do darken, but the shade is blue-grey and a single tone. Real 3: a toy. Form 3: reads as a model of a cloud, not a cloud. Material 3: dense, dry, cotton-wool grain over a solid; no light enters. Cohesion 4: pieces are fused solids with no low-density tissue; the satellites float.

m74. Same forms; the grain is fibrous and softer. Edge 3: uniformly fuzzy wool. Material 3: cotton wool. Otherwise as m92; ranked below because the crust is softer without the shade improving.

m55. Lobe 2: literally spheres on spheres, cauliflower at one scale. Silh 3. Edge 3: smooth rounded. Shade 5: the best physical lighting of the three (soft occlusion in the creases, the lower column shadowed by the upper), but it lights a bubble surface. Real 2. Form 2: a metaball model. Material 2: plastic/foam. Cohesion 4.

Rank: m92 > m74 > m55. What separates them: the grain. m92 breaks the sphere surface enough to suggest a cumulus crust; m55 shows the sphere-sum nakedly. None of the three has the Frog's flat grey belly sheet or its fine turret cascade.

### G2, cloud with a sky hole

| id | Lobe | Silh | Edge | Shade | Real | Form | Material | Cohesion | Overall |
|---|---|---|---|---|---|---|---|---|---|
| m23 | 5 | 6 | 4 | 6 | 5 | 6 | 5 | 7 | **5** |
| m36 | 5 | 6 | 5 | 5 | 4 | 5 | 4 | 6 | **4** |
| m75 | 3 | 5 | 2 | 5 | 3 | 4 | 5 | 7 | **4** |

m23. Lobe 5: three main lobes with some sub-lobes on the top-left dome, no finer step. Silh 6: a plausible cumulus outline, domed top, torn centre reads as a real gap. Edge 4: uniformly soft; no crisp crust anywhere. Shade 6: the belly under the right dome is a neutral grey sheet and the lobes read as separate volumes. Real 5: would pass a glance at small size. Form 6: a real cloud form. Material 5: soft and light gets in, but the lit tops are flat white cotton rather than a crust over an interior. Cohesion 7: one body; the tissue in the hole helps.

m36. Lobe 5. Silh 6. Edge 5: crisper, and the top-left dome shows a thin brighter rim, but every edge is equally crisp including the belly. Shade 5: the shade is sky-blue, the shadows read as blue-white not grey. Real 4. Form 5. Material 4: a uniform sandpaper grain over the whole lit area reads as towel or foam. Cohesion 6: the grain fragments the surface slightly.

m75. Lobe 3: nothing resolved below the three masses. Silh 5. Edge 2: everything is fog. Shade 5: warm neutral grey, the right gradation, but no crevices. Real 3: steam. Form 4. Material 5: vapour, yes, but the kind that comes out of a kettle; cumulus crust is missing entirely. Cohesion 7.

Rank: m23 > m36 > m75. What separates them: m23 has grey shade and a soft interior; m36 trades that for a crisper but blue, uniformly grainy surface; m75 loses the form. The ideal is m36's crispness on m23's shading.

### G3, tall body with cap (wide)

| id | Lobe | Silh | Edge | Shade | Real | Form | Material | Cohesion | Overall |
|---|---|---|---|---|---|---|---|---|---|
| m41 | 5 | 6 | 4 | 6 | 5 | 6 | 5 | 7 | **5** |
| m87 | 5 | 6 | 5 | 5 | 4 | 5 | 4 | 6 | **4** |
| m78 | 3 | 5 | 2 | 5 | 3 | 4 | 5 | 7 | **4** |

m41. Lobe 5: cap, shoulder, lower lobes; sub-lobes faintly on the cap. Silh 6: a good cumulus profile with a flatter base and a satellite on the left. Edge 4: soft everywhere; the cap has no hard crust. Shade 6: the grey belly under the cap is the best belly in the set; the cap stands off it as a volume. Real 5. Form 6. Material 5: soft volume, light passes in, but the cap is flat white cotton with no interior. Cohesion 7: one body.

m87. Edge 5: crisper cap with fine grain. Shade 5: blue shade, high-key, the belly is blue-white. Material 4: the grain is uniform and dry; foam. Cohesion 6. Otherwise as m41.

m78. The fog mode: Edge 2, Lobe 3, Material 5 (steam), Cohesion 7, Form 4.

Rank: m41 > m87 > m78. Same separation as G2: grey shade and soft interior beat crisp blue grain, both beat fog.

### G4, detail of the G3 cap (20°)

| id | Lobe | Silh | Edge | Shade | Real | Form | Material | Cohesion | Overall |
|---|---|---|---|---|---|---|---|---|---|
| m65 | 4 | 5 | 5 | 5 | 4 | 5 | 5 | 6 | **5** |
| m62 | 4 | 5 | 5 | 4 | 4 | 4 | 4 | 6 | **4** |
| m31 | 2 | 4 | 1 | 4 | 2 | 3 | 4 | 7 | **3** |

m65. Lobe 4: at this scale there should be two more steps of bumps on the dome; instead one fine fibrous grain covers everything. Silh 5. Edge 5: the dome rim is reasonably crisp. Shade 5: grey crevices between the dome and the right lobe, lit faces a little flatter than they should be. Real 4. Form 5. Material 5: the grain reads as wool at 2×; the lit faces are not smooth enough (the photo domes are smooth with sharp creases). Cohesion 6.

m62. Same grain, brighter and bluer; Shade 4: blue shadows, lit faces blown to flat white. Material 4: cotton wool. Otherwise as m65.

m31. Edge 1: nothing resolved. Lobe 2. Material 4: fog. Cohesion 7 (trivially). Real 2.

Rank: m65 > m62 > m31. At 20° the detail renders give themselves away: the photos (DSC00575, DSC00637) have smooth lobe faces with sharp creases and tiny crust bumps; these have a uniform fuzz at one scale and no smooth faces.

### G5, open lobed clouds

| id | Lobe | Silh | Edge | Shade | Real | Form | Material | Cohesion | Overall |
|---|---|---|---|---|---|---|---|---|---|
| m95 | 4 | 4 | 4 | 5 | 3 | 4 | 3 | 5 | **4** |
| m28 | 3 | 3 | 4 | 3 | 3 | 3 | 3 | 3 | **3** |
| m20 | 3 | 3 | 3 | 5 | 2 | 3 | 2 | 4 | **3** |

m95. Lobe 4: the left mass has a decent dome cluster; the upper-right turret is a single blob. Silh 4: the ring with a hole and the detached spherical droplets read as metaballs or liquid. Edge 4: soft, but the blob boundaries are those of rounded solids. Shade 5: good gradation and a greyish lower half. Real 3. Form 4. Material 3: liquid/metaball; the droplets are the giveaway. Cohesion 5: one main body, but satellites float as drops.

m28. Lobe 3: popcorn turrets at a single scale. Silh 3: noise-torn, with a detached fragment and tendrils. Edge 4: uniformly hard. Shade 3: almost flat white, little belly, no crevice darkening. Real 3. Form 3. Material 3: shaving foam. Cohesion 3: a spattering of blobs with harsh falloff between them.

m20. The 20° detail of m95: the ring and droplets up close are plainly liquid; the left mass has pleasant soft gradation but no crust. Material 2, Cohesion 4, Shade 5, Real 2.

Rank: m95 > m28 > m20. m95's main body is the only part of this group that reads as cloud; m28 is torn foam; m20 shows m95's worst features large.

## Overall ranking (all 15)

1. m23 (5) 2. m41 (5) 3. m65 (5) 4. m36 (4) 5. m87 (4) 6. m62 (4) 7. m95 (4) 8. m75 (4) 9. m78 (4) 10. m28 (3) 11. m92 (3) 12. m74 (3) 13. m31 (3) 14. m20 (3) 15. m55 (2)

Material caps the set at 5 again, as in R1. Nothing here would pass in a photo.

## Remaining gap to the photos

In order of how much each would move the owner's scores, from what the photos show and these renders lack:

1. **Crust over interior.** Every lit face is a single flat white (m36, m87, m62) or a soft flat white (m23, m41). The photos have a thin bright rim a few metres thick, then a slightly darker lit interior, then grey crevices. No render has that three-tone lit face. This is the single biggest material tell.
2. **Smooth faces with sharp creases, not uniform fuzz.** At 20° (G4) the renders put one fine fibrous grain over the whole surface. The photo domes are smooth across tens of metres and broken by sharp dark creases, with bumps at the next scale down only along the crest. The grain should be concentrated at the lit rim and crests and damped on faces and the belly.
3. **Grey shade, not blue.** The crisp mode (m36, m87, m62) has sky-blue shadows and a blue-white belly. The owner's bellies are neutral warm grey (DSC00563, DSC00586). The mid mode (m23, m41, m65) has this nearly right and wins every pair for it.
4. **Lobe cascade.** Three steps are visible in the photos (dome, sub-dome, crest bump at roughly 3–4× each). The renders have at most two (G2, G3) or one (G1, m28).
5. **Thin edges to sky.** The photos' wispy bits and undersides fade translucent; here either every edge is equally crisp (m36, m87, m28, G1) or everything is fog (m75, m78, m31). Soft should be a property of thin parts only.
6. **Cohesion is solved in G2/G3 and not in G1/G5.** The G2/G3 bodies hold together (6–7). G1 is fused solids with floating satellites; m28 is a spatter; m95 has droplet satellites. Satellites need faint connective tissue, not clean separation.
7. **The Frog forms.** G1 is the right arrangement at the wrong level of abstraction: columns plus slab plus buns. The real Frog has a vast flat grey belly sheet carrying a fine bright crust, and the eye turrets are cauliflower at three scales.

Suggested direction, consistent with R1: the mid mode's shading (m23/m41/m65) with the crisp mode's rim definition, grain restricted to rims and crests, lit-face interior a step darker than the rim, and thin-edge density allowed to go translucent. The fog mode is useful only as evidence that the warm-grey tone is reachable.
