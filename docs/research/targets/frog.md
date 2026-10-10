# Target study: Frog cloud (single cumulus with satellites, 2022-07-29)

A single roundish cumulus mediocris/congestus with a trail of smaller satellites. It is lit from the front, against deep blue sky. At full size it reads as a generic "cotton" cloud. At 105 mm it shows a dense hierarchy of lobes, crisp-but-fuzzy lit edges, and several small features that our renderer has no mechanism for (lit bubbles in shade, lacy undercuts, a dissolving belly skirt).

Sources (owner photos, not in the repo):
- `artifacts/research/cloud-photos/Frog Cloud/DSC00589-Pano.jpg` (10609 × 9230 stitch)
- `detail/DSC00563..587`: 25 frames at 105 mm, 16:27:37–16:27:57 local; the pano is dated 16:28:05

Work copies: `artifacts/research/extracted/targets/frog/` (`pano_1600.jpg`, `sheet_0..4.jpg`, 1:1 crops `c5xx_*.jpg`).

The Frog was shot about **one hour before** Santa's Sleigh (`santa-sleigh.md`), on the same day and from the same camera, so it is likely the same air mass and base height. The view direction is different: the sky here is very saturated (`#003286` at the top), so the camera faced well away from the sun. Santa's frames face toward the sun side.

## 0. Scale

- The 25 frames cover about 48.7° × 42.4°. The 1600 px downsize of the pano is about **0.0304°/px**, assuming the merge kept native scale.
- A tree enters the bottom-right corner (y 1345–1392), so the pano's bottom edge is a few degrees above the horizon.
- Taking the bottom edge as about 2° elevation, the belly bottom (y ≈ 815 at centre) is at about 19.5°. For a base H that puts the belly's far edge at about 2.8H, or **about 4.2 km at H = 1.5 km**.
- One native 105 mm pixel is then about **0.3–0.35 m**: roughly 2–3× finer than on Santa's bodies.
- All metres below assume this and carry ±40%. Pixel ratios do not depend on it.

## 1. Silhouette

Measured on `pano_1600.jpg` (cloud mask B−R < 60, satellites masked out):
- **Main body bbox:** x 255–1385 (1130 px ≈ 34°), y 78–1000 (922 px ≈ 28°). **W:H = 1.23.** At H = 1.5 km that is roughly 2.5 km wide and 1.5–2 km tall.
- **Top profile.** Top y by column, left to right:

  | Part | x range (px) | Top y | Height below summit | Width share |
  |---|---|---|---|---|
  | Upper-left shoulder | 275–575 | 198–336 | 0.13–0.28 | 0.27 |
  | Summit dome | 650–975 | 82–110 (summit 82 at x 800) | — | 0.29 |
  | Right terrace | 1100–1385 | 488–598 | **0.44–0.56** | 0.25 |

  - The summit sits at **0.48 of the width**.
  - Between the summit dome and the right terrace is a sharp step down at x 1025–1100.
  - The terrace is the same "dome plus side shelf" archetype as Santa's main (tower plus shelf at 0.3 of height). Here the shelf sits higher, at about half height.
- **Bumpiness.** Along the top edge there are **13** silhouette bumps with prominence ≥ 0.12°, 7 at ≥ 0.3°, and 1 at ≥ 0.76°. That is one bump per 0.077 of the width, or about 2.6°, about 190 m apart. On Santa's head, measured the same way, there is one bump per 0.2 of its length, about 420 m apart. **The Frog's silhouette has about 2× finer lobing, both in metres and relative to body size.**
- **Base.**
  - The right half is flat at y 804–819, ±8 px across 600 px.
  - The left half hangs lower, to y 854–1000. The **lit "chin" lobes** at x 420–720 reach y 1000, **0.2 of the body height below the flat base**.
  - So the base is not one plane. The same feature appears on Santa's head (D3 there).
- **Belly.** A smooth mauve-grey region at about x 400–1250, y 560–830, roughly 0.75 of the width and 0.3 of the height. It is the darkest part of the body.
  - In the central columns the darkest band is **0.70–0.93 of the way down** from the top. On Santa's head it is at 0.66: the Frog's belly sits lower.
  - Luminance runs from about 111–134 in the belly to about 223–254 on lit lobes, about **2:1**. Santa's backlit head is 2.4:1.
  - Sampled hue: about `#737792` (grey with a violet cast). Lit tops are about `#eeeef6`, and shaded crevices on lit faces are blue-grey (about `#b3bace`), so skylight fill is visible.
- **Smoothness fraction** (local std < 4 in 13 px windows; bright clipped areas also count as smooth, so read it as relative):

  | Body | Smooth overall | By height band (top → bottom) |
  |---|---|---|
  | Main | 68% | 35 / 73 / 59 / 82 / 71 % |
  | Satellite 1 | 48% | |
  | Satellite 2 | 32% | |

  Texture lives on the top fifth and on lit rims. The lower 60% is mostly smooth. The satellites are rougher than the main.

## 2. Satellites

| | bbox (pano_1600) | Width vs main | Notes |
|---|---|---|---|
| Satellite 1 | x 705–1460, y 730–1080 | 0.67 | Two lobes: a rounded left mass and a ragged right mass at x 1200–1460. A sky gap of 20–40 px (0.6–1.2°) separates it from the belly at x 860–1000. Its frayed right edge has fingers and holes (`DSC00580`). |
| Satellite 2 | x 1040–1400, y 1010 to the frame bottom | 0.32 | A separate cumulus with its own dome and a smooth grey core; a soft hooked cap puff on its upper left (`DSC00584`) |
| Fragments | (885–940, 1312–1338), (955–1020, 1318–1340) | 0.05 | Small flat humilis-like scraps |

The satellites run **diagonally down and to the right**, getting smaller (1 : 0.67 : 0.32 : 0.05). Each sits lower in frame than the one before. If they share one base height, they recede from the camera. That makes it a **trail of decreasing bodies receding along a line**, as on Santa's Sleigh but smaller and with the big body at the near end. Whether the satellites are breaking off the main or are new cells feeding it cannot be told from one moment (owner question).

## 3. Surface-detail catalogue

Edge widths are the local 10–90% cloud/sky transition at native 105 mm, measured the same way as for Santa. Metres assume about 0.33 m/px.

| # | Detail type | Where | Scale | Edge | Best photo (crop) | How to make it |
|---|---|---|---|---|---|---|
| F1 | **Fine multi-level cauliflower** | upper-left shoulder, summit, upper right | lobes 400–600 / 120–200 / 15–40 native px, about **150–200 m / 40–65 m / 5–13 m**: about 3.5× per level, 3 levels, with a 4th visible only as edge fuzz. Biggest lobes ≈ 0.06–0.08 of body width (Santa: 0.15). | lit 10–20 px (3–7 m) | `DSC00570`, `DSC00573` (`c573_top`) | As Santa D1, but one octave finer relative to the body: either a world-metre noise scale on a smaller body, or one more octave. The Frog is the argument for **world-anchored detail scale**: same metres, a different count of lobes per body. |
| F2 | **Fuzzy micro-halo on lit edges** | every lit silhouette edge | 10–25 native px bumps on top of a 10–20 px transition | "crisp" at body scale, cotton-fibre at 1:1 | `DSC00573` (`c573_top`) | A last high-frequency octave (about 5–10 m) applied only where density is low and the sun term is high. Without it, lit edges look plastic or vector-smooth. |
| F3 | **Lit rim around a smooth shaded core** | left flank of the belly | textured lit band 250–400 native px wide; the texture fades into smooth shadow over 300–400 px | outer edge 10 px (3 m) | `DSC00565` (`c565_rim`) | Same erosion everywhere. The core reads smooth because shadowed regions get only multiple-scattered light. Check that our lighting flattens there, and do not add AO-like contrast in shade. If it still reads busy, scale erosion by a baked sun-visibility term. |
| F4 | **Lit bubble on a shaded face** | right flank of the upper mass, near the belly (`DSC00577`, 495–715 × 635–780 at 1400 px) | 220 × 145 px at 1400 (about 670 × 440 native, ≈ 200 × 150 m); about 4 bubbles visible on that face | soft, 30–80 px; separated from the surrounding grey by a soft shadow ring | `DSC00577` (`c577_bubble`) | A protruding sub-lobe that reaches out of its parent's shadow. Needs real geometry: a sphere offset outward from an SDF surface. Noise erosion alone cannot do it, because the bubble must cast and escape shadow. Houdini: scatter small spheres on the shaded side of the body SDF, union with a small smooth-min. |
| F5 | **Lacy undercut** | underside of the upper-left overhang lobe | holes 30–80 native px, frayed tissue about 400 px deep | top of the same lobe crisp (10–20 px); underside 50–150 px, see-through | `DSC00570` (`c570_undercut`) | Detail type by **surface orientation**: downward-facing surfaces of overhangs use wispy erosion with a high threshold, so holes open. Height fraction alone puts the switch in the wrong place, because this is high on the body. |
| F6 | **Dissolving belly skirt** | lower edge of the belly | soft gradient band 150–300 native px; dangling shreds 50–120 px | 68–76 px (20–25 m), the softest edge on the cloud | `DSC00587` (`c587_skirt`), `DSC00582` | Low density at the base edge with wispy erosion and curl distortion pointing down. Fade density out over about 20–40 m instead of a hard cut. This differs from Santa's main base (D4), which is flat and harder (31 px). |
| F7 | **Frayed satellite fingers** | right and lower edges of satellite 1 | fingers 60–150 native px long; holes; thin parts look blue | 18 px at the dense core; most of the edge is 40–100 px and translucent | `DSC00580` (`c580_fray`) | A satellite that is decaying or still forming: lower density scale per body, so the same erosion bites deeper. The cheapest way: a per-body density-scale channel (the Nubis "density scale" field). |
| F8 | **Low-contrast nested billows inside lit faces** | summit and left shoulder interiors | 3 visible scales (300 / 100 / 30 native px), contrast only about 10–15% | soft blue-grey creases 20–40 px | `DSC00573`, `DSC00570` | Comes from light transport (self-shadowing between lobes). Needs the up-rez noise to reach the interior band just inside the surface (about 50–150 m deep), not only the very edge, plus enough shadow-ray resolution to resolve it. |
| F9 | **Hooked cap puff** | upper left of satellite 2 | about 0.3 of the satellite's width | soft | `DSC00584` | A small separate puff leaning over a dome. An optional extra sphere in a library template. |
| F10 | **Lit chin lobe** | under the left half of the belly | x 420–720 (0.27 of width), hanging 0.2 of height below the base | lit lower edges crisp | `pano_1600`, `DSC00563`–`565` | As Santa D3: a per-sub-blob base offset. |

## 4. What differs from Santa's Sleigh

| Aspect | Frog | Santa's Sleigh |
|---|---|---|
| Composition | one body plus a shrinking satellite trail; the large body is the near end | several comparable bodies on a line; the large body is the far end |
| Lighting | lit from the front; white tops, blue-grey crevices, mauve belly; sky `#003286` | side and back-lit; blue-grey belly with silver rims on the head, white tower on the main; pale sky |
| Lobe scale | 150–200 / 40–65 / 5–13 m; one silhouette bump per 0.077 of width | 300 / 70 / 15–30 m; one bump per 0.12–0.2 of length |
| Lit edge softness | 10–20 native px ≈ 3–7 m | 5–13 px ≈ 3–12 m (similar in metres) |
| Shaded / underside edge | 68–76 px ≈ 20–25 m, a dissolving skirt with shreds | 29–41 px ≈ 20–40 m; laminar, flat main base |
| Vertical growth | moderate dome; summit at 0.48 of width; right terrace at about half height | narrow tower (core W:H 0.93), knob 0.17–0.2 of width, ejected turrets |
| Shear | no strong lean on any lobe | every loose turret leans 30–48° toward the head |
| Unique details | lit bubbles on shaded faces (F4), lacy undercut (F5), dissolving skirt (F6), fuzz halo visible at 1:1 (F2) | vertical fluting in the merge zone, sheared arm, dome rows, cirrus fibres, laminar base |
| Shared details | lit chin lobe under a dark belly (Frog F10 = Santa D3); dome-plus-side-shelf profile; smooth lower 60% vs textured top 20–35% | |

## 5. Recipe sketch (single hero)

1. **Base shape.** VDB from particles with 3 nested sphere levels (radius ratio about 3.5), placed on a lopsided dome:
   - summit at 0.48 of width
   - left shoulder 0.13–0.28 below the summit
   - right terrace 0.44–0.56 below the summit
   - chin lobes hanging 0.2 of height below a flat right-hand base
2. **Satellites.** 2–3 separate VDBs placed down-right and receding. Widths 0.67 / 0.32 / 0.05 of the main. Each gets a lower per-body density scale so the shared erosion frays them (F7).
3. **Up-rez.** Billowy erosion on upward and sunward surfaces (F1, F2). Wispy erosion with hole-opening on downward surfaces at any height (F5, F6). No extra detail in shadow (F3).
4. **Geometry the noise cannot fake.** Lit bubbles on the shaded face (F4) and chin lobes (F10) must be in the authored or particle shape.
5. **Lighting check.** A 2:1 lit-to-belly luminance ratio with the sun behind the camera. The belly reads violet-grey, and crevices on lit faces read sky-blue.

## 6. Open questions for the owner
1. What makes it a "frog"? Which part is the head? That tells us which silhouette features matter most for the read.
2. Are the satellites breaking off the main or growing toward it? Satellite 1's frayed edge suggests decay. Do you remember, or is there a video?
3. Is satellite 2 a separate cloud farther away, or attached and lower?
4. Was the pano merged at native scale (no reduction)? The scale and every metre figure depend on it.

## 7. Owner answers (2026-10-10, research review page)
- **Why "frog":** there is a face in the cloud. The owner's outline is `cloud-photos/Frog Cloud/FrogFace.png` (local): the upper twin lobes are the head with two eyes, and the smooth, darker middle belly is the wide mouth. So the defining features are the two upper domes with the notch between them, and the long smooth shaded belly under a textured top.
- **Pano scale:** the file is named "Pano" but the owner trusts it as a single-scale image; other shots of the same cloud at the same time look identical. They can share another frame with metadata if needed.
- Satellites breaking off or growing: unknown. Satellite 2 is probably **far behind**, not attached.
