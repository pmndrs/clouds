# D1 blind judge — Fable

Blind set: `scratchpad/blind-d1/d01–d16` (1920x1080 JPEG). Judged by eye at 1:1 and 3x nearest-neighbour zooms of lit lobes, shadowed undersides and silhouette edges; key, work/, artifacts/research/d1-parity/ and reports not opened. Colour/grain numbers below are supporting only (300x200 patches, mean RGB and RMS of a 3px high-pass).

## Grouping

| Framing | Frames | Camera |
|---|---|---|
| F1 "tower" | d01 d05 d06 d07 | single cumulus body, sun glare top-left, low haze |
| F2 "two-lobe, hazy cam" | d02 d03 d09 d10 | left mound + right tower, horizon mid-low, sun glare top-left |
| F3 "two-lobe, blue cam" | d08 d14 d15 d16 | same asset, deeper blue sky, horizon at bottom edge |
| F4 "tall vertical" | d04 d11 d12 d13 | one tall body, sun glare top-left |

Reference guess per framing: **d07, d02, d16, d13**. Reasons: all four share a warm pink-grey cloud colour on a sky that has no renderer sun-glare blob and (d07, d13) faint radial sky streaks; their silhouettes differ in detail from the other three in the group (different erosion noise) while the other three share one silhouette exactly; their surfaces are the only ones with zero speckle/fibre texture — smooth lumpy billows with clean shadow pockets.

Our three settings are recognisable across all four groups as the same three looks:

- **Look N (neutral-soft)**: d01, d10, d12, d14 — neutral/cool white, low contrast, soft blurred lobes. (d14 is the blue-leaning one of these.)
- **Look B (blue-speckled)**: d05, d03, d15, d04 — blue-cast shadows, fine speckle / fibrous "brush-stroke" grain on the lit surface, translucent.
- **Look D (dirty-smudge)**: d06, d09, d08, d11 — white tops but a brown-grey desaturated smudge in the shadow mass, speckle inside the smudge.

Scores are 1–10 match to the reference in that framing.

---

## F1 — tower (ref: d07)

Reference character: warm pink-grey; large smooth billows with soft but distinct lobe boundaries; dark underside is a smooth gradient, not a patch; edges crisp-ish with fine wisps; a small sky hole shows through near the top-right.

### d01 — overall 5/10 (rank 1)
| Criterion | Score | Reason |
|---|---|---|
| Surface | 6 | Smooth, no pitting, but lobes are mushy and under-defined — billow count is far below the ref |
| Shading | 5 | Shadows are faint and low-contrast; the ref's dark underside is almost missing, no dirty patches though |
| Colour | 4 | Cool-neutral white (R-B −7 lit) vs ref's warm (+7); reads as a different sky |
| Edges | 5 | Uniformly soft/cottony; ref has crisper lobe silhouettes and wispy skirt |
| Same engine | 5 | Same asset, but looks like a defocused version — too flat |

### d06 — overall 4/10 (rank 2)
| Criterion | Score | Reason |
|---|---|---|
| Surface | 4 | Lit top is smooth, but the whole shadow mass carries fine speckle/sparkle at 3x |
| Shading | 3 | Large brown-grey dirty smudge across the lower-middle, blotchy with a hard-ish boundary; ref's underside is darker but clean and graded |
| Colour | 6 | Lit area is the right warmth (R-B +3); the smudge is desaturated mud, not the ref's pink-grey shadow |
| Edges | 6 | Closest edge crispness of the three; lobes read |
| Same engine | 4 | The smudge is the thing you see first and the ref has nothing like it |

### d05 — overall 2/10 (rank 3)
| Criterion | Score | Reason |
|---|---|---|
| Surface | 2 | Dense fine speckle everywhere, strongest in shadow (hf 1.40 vs ref 0.66), sparkly wisps — pitting-class artefact |
| Shading | 3 | Translucent, washed out; interior lobes barely shaded |
| Colour | 2 | Clearly blue (R-B −17 in shadow) vs warm ref |
| Edges | 3 | Edges dissolve into speckled haze rather than wisps |
| Same engine | 2 | Different engine at a glance |

**F1 ranking: d01 > d06 > d05.**

---

## F2 — two-lobe, hazy camera (ref: d02)

Reference character: warm pink-grey turning to blue-grey in shadow; big smooth round lobes with soft shadow between them; nearly flat dark base; edges crisp but soft-cornered; no visible grain at 3x.

### d10 — overall 5/10 (rank 1)
| Criterion | Score | Reason |
|---|---|---|
| Surface | 4 | Lobes are the right size and smooth from a distance, but at 3x the tower carries fine directional "fibre"/brush-stroke streaks (step-jitter smear) |
| Shading | 6 | Shadow placement matches (tower's left face and underside); lower left mass goes very bright/flat (lum 206 vs ref 176) |
| Colour | 4 | Shadows are blue (R-B −38 on tower) where the ref is neutral grey-pink |
| Edges | 6 | Edge softness close to ref; slight hairiness on the tower rim |
| Same engine | 5 | Nearest overall; blue shadows and fibre texture give it away |

### d09 — overall 4/10 (rank 2)
| Criterion | Score | Reason |
|---|---|---|
| Surface | 4 | Billows smooth and well-defined (best lobe definition of the three) but coarse speckle in the shadowed right flank of the tower |
| Shading | 3 | Brown-grey smudge over the tower's right face and under the base; ref's shadows there are clean cool grey |
| Colour | 6 | Lit areas near-neutral (R-B −12), closest to ref; smudge is desaturated brown |
| Edges | 6 | Crisp lobe edges, good wisps |
| Same engine | 4 | Would be rank 1 without the smudge |

### d03 — overall 2/10 (rank 3)
| Criterion | Score | Reason |
|---|---|---|
| Surface | 2 | Strong fibrous hatch pattern across every lobe, speckle in the base — reads as combed/pitted |
| Shading | 3 | Shadow sides collapse into translucent blue; no solid dark base |
| Colour | 1 | Heavily blue (R-B −51 lit) |
| Edges | 3 | Hairy, sparkly rims |
| Same engine | 2 | Different engine |

**F2 ranking: d10 > d09 > d03.**

---

## F3 — two-lobe, blue camera (ref: d16)

Reference character: pink-grey, soft round lobes, defined but gentle shadow pockets inside the tower, smooth flat dark base, soft-cornered edges, no grain.

### d08 — overall 4/10 (rank 1)
| Criterion | Score | Reason |
|---|---|---|
| Surface | 4 | Lobes read well, but tower shadow is speckled and faint fibre streaks on the lit face |
| Shading | 3 | Brown-grey dirty smudge filling the tower's shadow side and under the base; too dark and desaturated vs ref's pink-grey |
| Colour | 6 | Lit tops neutral (R-B −8), closest of the three to the warm ref |
| Edges | 5 | Slightly "hairy" stepped rims |
| Same engine | 4 | Shape and lobe layout closest; smudge wrong |

### d14 — overall 3/10 (rank 2)
| Criterion | Score | Reason |
|---|---|---|
| Surface | 3 | Fibrous brush-stroke texture across the whole tower at 3x, light speckle on the mound |
| Shading | 4 | Shadow placement OK and no dirty patch, but shadow is a flat blue wash |
| Colour | 2 | Strong blue shadows (R-B −47 lit tower) |
| Edges | 4 | Fuzzy, fibrous rims |
| Same engine | 3 | Looks like a bluer, noisier engine |

### d15 — overall 2/10 (rank 3)
| Criterion | Score | Reason |
|---|---|---|
| Surface | 2 | Heaviest fibre/speckle; sparkly flecks in the mound's shadow |
| Shading | 3 | Everything blue and translucent; little solid shadow |
| Colour | 1 | Deep blue (R-B −67 lit, −57 shadow) |
| Edges | 3 | Sparkly, hairy rims |
| Same engine | 2 | Different engine |

**F3 ranking: d08 > d14 > d15.**

---

## F4 — tall vertical (ref: d13)

Reference character: warm pink; smooth lumpy billows with clear shadow pockets between lobes (left bump reads as a separate mass); base lobes soft but discrete; no grain.

### d12 — overall 5/10 (rank 1)
| Criterion | Score | Reason |
|---|---|---|
| Surface | 6 | Smooth, no fibre; faint speckle only at the base edge |
| Shading | 4 | Very low contrast — the ref's shadow pockets are almost gone, the body is a bright white blob (lum 199–203 vs ref 172–180) |
| Colour | 5 | Neutral (R-B −2) rather than warm; no blue cast |
| Edges | 6 | Soft, close to the ref's edge character |
| Same engine | 5 | Right shape, far too flat and bright |

### d11 — overall 4/10 (rank 2)
| Criterion | Score | Reason |
|---|---|---|
| Surface | 5 | Smooth top; speckle inside the dark lower mass |
| Shading | 3 | Brown-grey smudge across the lower third; top is blown out; ref has graded pink-grey shadow |
| Colour | 6 | Lit area warm-neutral (R-B +5), nearest the ref's warmth |
| Edges | 5 | Soft, fine |
| Same engine | 4 | Smudge again |

### d04 — overall 3/10 (rank 3)
| Criterion | Score | Reason |
|---|---|---|
| Surface | 3 | Fine speckle throughout the lower half, bottom dissolves into grainy haze |
| Shading | 3 | Washed out, translucent; little internal shading |
| Colour | 3 | Blue-grey (R-B −10/−14) |
| Edges | 3 | Base edge disintegrates into speckle instead of lobes |
| Same engine | 3 | Different engine |

**F4 ranking: d12 > d11 > d04.**

---

## Main remaining differences (all framings)

1. **Colour**: every one of ours is neutral-to-blue; the refs are consistently warm pink-grey in both lit and shadowed areas. The blue-speckled look is worst (R-B down to −67), the neutral look is nearest but still cold.
2. **Dirty smudge**: the "D" look (d06, d09, d08, d11) puts a desaturated brown-grey patch in the shadow mass with speckle inside it. The refs darken there too, but with a smooth, slightly cool pink-grey gradient and no blotch boundary.
3. **Fibre / speckle texture**: the "B" look (d05, d03, d15, d04) and to a lesser extent d10/d14 show a fine directional brush-stroke or sparkle pattern on lit surfaces at 1:1 — this is the pitting-class artefact and is visible without zooming on F2/F3. The refs have none.
4. **Contrast / lobe definition**: the "N" look (d01, d10, d12, d14) is clean but flat — shadow pockets between lobes are far weaker than the refs', so the clouds read as blown-out blobs rather than stacked billows.
5. **Edges**: refs are soft-cornered but defined, with thin wisps at skirts. Ours are either uniformly cottony (N look) or hairy/sparkly (B look); the D look has the closest edge character.
6. **Silhouette**: our three share one identical silhouette per framing that differs in detail from the ref's (different erosion), which makes "same cloud" convincing but "same engine" not.

No single setting wins everything: the N look is cleanest, the D look has the best lobe definition and warmth but the smudge, the B look is a clear loss. Target: N-look cleanliness + D-look lobe contrast + a warm shadow tint and no smudge.
