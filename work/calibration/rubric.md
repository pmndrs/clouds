# Calibration rubric (2026-10-10)

Purpose: find out which judge (Opus, Fable, …) scores cloud renders the way the owner does, so art-heavy tasks can be judged reliably. The owner scores the same set; the closest judge becomes the default judge for shape and authoring work.

Set: `work/captures/C1/calibration/photo/*.jpg` (48° HFOV, ground camera, cloud fills ~half the frame) and `detail/*.jpg` (20° HFOV on the sunlit upper third). Nine sources; the judge sees them **unlabelled** (shuffled ids).

References (the target, owner photos, local only): `artifacts/research/cloud-photos/santasSleigh/end.jpg`, `santasSleigh/detail/*.jpg`, `Frog Cloud/DSC00589-Pano.jpg`, `Frog Cloud/detail/*.jpg`; measurements in `docs/research/targets/santa-sleigh.md` and `frog.md`.

Score each image 1–10 on:
1. **Lobe hierarchy**: big domes carrying smaller domes in roughly 3–4× steps, vs one texture scale everywhere or many equal small turrets.
2. **Silhouette**: plausible cumulus outline (domed top, flatter base, natural satellites) vs primitive (egg, cone, cylinder) or noise-torn.
3. **Edge character**: lit crusts and ridges crisp (a few metres), only thin/wispy parts and undersides soft (owner rule) vs uniformly fuzzy or uniformly hard.
4. **Shading and depth**: self-shadowed crevices, darker bellies, lit lobes reading as separate volumes vs flat, evenly lit cotton.
5. **Overall realism**: could it pass in one of the owner's photos?
Give a one-line reason per criterion. Then rank all images by overall realism.
