# D1f blind judgement (Fable, 2026-10-11)

Set: `scratchpad/blind-d1f/` — full frames d01–d12 (4 framings × 3 sources), PNG crops c01–c24 (8 regions × 3 sources). Judged blind, per the rubric's judging method: whole frames first, then every crop at native resolution, then 1:1 and 2× sub-crops of the regions where the sources differ (lit faces, shade sides, silhouettes). Key not opened. Pixel statistics (per-image mean, high-frequency energy, pairwise differences, region luminance) were run after the visual pass only as a cross-check on the grouping and on "which render is closer in level"; the scores are visual.

Scores are match-to-reference, 1–10: (S) surface — lumps/florets, creases, grain, circular blotches or rings; (Sh) shading — where light and shadow fall, shade depth; (C) colour; (E) edges; (O) overall "same cloud, same engine".

## Grouping and reference guess

| Framing | Images | Reference guess | Why |
|---|---|---|---|
| A — sleigh cloud, side view, tower right | d01, d02, d06 | **d06** | fine sand grain over every lit face, florets at three scales, warm cream cloud, teal sky with a dense white haze layer, no sun glow at the frame edge. The other two are smooth and waxy. |
| B — tall cauliflower, lavender sky | d03, d09, d11 | **d11** | same grain and warmth; the top dome is lumpy with crease texture. d03/d09 are near-identical waxy renders of the same shape (one lighter than the other). |
| C — wide puffy body with a lower-left tail | d04, d05, d07 | **d04** | grainy, pink cast, wispy tail, soft shade core. d05/d07 are the same waxy pair, with a dark blotched shade core. |
| D — sleigh cloud from a raised angle | d08, d10, d12 | **d08** | grain, warm, distinct dark underbelly band, no glow top-right. d10/d12 near-identical except d12's tower shade carries a polka-dot pattern. |

Crops (matched by dimensions and content): c03 / c13 / c17 = A left lobes (ref **c03**); c04 / c08 / c20 = A tower (ref **c04**); c21 / c02 / c06 = B top dome (ref **c21**); c01 / c22 / c24 = B trunk (ref **c01**); c14 / c12 / c16 = C top (ref **c14**); c18 / c11 / c15 = C tail (ref **c18**); c09 / c05 / c19 = D tower (ref **c09**); c07 / c10 / c23 = D base (ref **c07**). In every crop the reference is the one with sand grain, warm cast and soft edges; the cross-check agreed (the reference always has the lowest high-frequency energy, i.e. it is the upscaled frame, and the two renders are always each other's nearest neighbour).

Probable pairings between crop renders and frame renders, from shared fingerprints: c19 ↔ d12 (polka dots), c20 and c17 ↔ d01 (dark mottled shade, ring flecks), so c08, c13 ↔ d02; c05 ↔ d10. B and C pairings are not visible; the two renders differ there only in level.

## Distance (full frames)

| Framing | Render | S | Sh | C | E | O | Notes |
|---|---|---|---|---|---|---|---|
| A (ref d06) | d01 | 4 | 4 | 4 | 6 | 4 | More lobe structure than d02 but waxy; tower shade far too deep (region mean 127 vs 164 in the ref) and mottled with bulbs; a bright sun glow top-left that the ref does not have; sky deep saturated blue vs the ref's teal + white haze. |
| | **d02** | 3 | 6 | 5 | 6 | 5 | Foam-smooth and flat, but shade depth and placement are closest to the ref (147 vs 164) and the sky has no glow. Wins on shading, loses on form. |
| B (ref d11) | d03 | 3 | 5 | 4 | 6 | 4 | Egg-smooth top dome; a dark vertical slit in the trunk at ~(1120,770); overall darker/cooler than the ref. |
| | **d09** | 3 | 5 | 5 | 6 | 5 | Identical geometry and the same slit; overall level closer to the ref (ref is the brightest of the three). Wins only on level. |
| C (ref d04) | **d05** | 3 | 5 | 5 | 5 | 4 | Waxy; shade core is a dark smear with crater-like blotches where the ref keeps lumps visible; tail is a row of hard blobs where the ref is wispy. Level closer than d07. |
| | d07 | 3 | 4 | 4 | 5 | 4 | Same, darker overall; shade core deeper than the ref. |
| D (ref d08) | **d10** | 3 | 4 | 4 | 6 | 4 | Tower shade too dark (149 vs 181); a stippled/cellular patch on the lit face of the left body (~(800,580)); sun glow top-right absent in the ref; underbelly brighter and flatter than the ref's dark band. |
| | d12 | 2 | 5 | 4 | 6 | 4 | Shade level closest (175 vs 181) but the tower's shade side shows a regular polka-dot pattern that reads at full-frame scale; same stipple patch and glow. Closer in tone, worse in surface. |

Distance winners: A d02, B d09, C d05, D d10 — all narrow, and in B and C the two renders are the same image at two exposures. Nothing at distance passes as the same engine: the renders are smoother, cooler and bluer-skied, with none of the frames' grain, haze or warm cast.

## Close-up (crops, native resolution)

| Region | Render | S | Sh | C | E | O | Notes |
|---|---|---|---|---|---|---|---|
| A left lobes (ref c03) | **c13** | 4 | 6 | 4 | 5 | 5 | Lobe placement right; lit domes waxy with no grain; silhouette carries a fine sand-stipple (visible at 2×) where the ref's edge is a soft blur; sky saturated blue, cloud grey-white vs cream-pink. |
| | c17 | 3 | 5 | 4 | 5 | 4 | As c13 plus a field of small ring/fleck blotches on the shaded lobe at right. |
| A tower (ref c04) | **c08** | 3 | 5 | 4 | 5 | 4 | Putty-smooth lit faces, no grain, no third-scale florets; shade side a smeared gradient with a vertical crease smear; lobes rounder than the ref. |
| | c20 | 3 | 4 | 4 | 5 | 4 | Slightly more lump structure on the lit side, but the shade side is darker and carries bulb mottle. |
| B top dome (ref c21) | **c02** | 2 | 5 | 5 | 6 | 4 | The ref's dome is covered in mid-scale lumps and crease texture; both renders are a smooth egg with lumps only at the base. c02's level is nearest the ref. |
| | c06 | 2 | 4 | 4 | 6 | 3 | Same egg, brighter and flatter. |
| B trunk (ref c01) | c22 | 3 | 4 | 4 | 3 | 3 | Dark vertical slit through the trunk; a serrated, stair-stepped bright edge at upper right where the ref is soft; shade more contrasty and greyer than the ref's even pink-grey. |
| | **c24** | 3 | 5 | 5 | 3 | 4 | Same slit and serrated edge, slightly lower contrast, nearer the ref's level. |
| C top (ref c14) | **c12** | 3 | 5 | 5 | 5 | 4 | Waxy top lobes; shade centre a dark smear with crater-like blotches vs the ref's soft grey with lumps still legible; the bright notch at right is shared with the ref (asset), not an artefact. |
| | c16 | 3 | 4 | 4 | 5 | 4 | Same, darker. |
| C tail (ref c18) | c11 | 3 | 5 | 4 | 3 | 3 | Ref tail is wispy, grainy, low-density with striated edges; both renders are a chain of hard, rounded blobs with clean edges. |
| | c15 | 3 | 5 | 4 | 3 | 3 | Same, brighter. Tie. |
| D tower (ref c09) | **c05** | 3 | 5 | 5 | 6 | 4 | Cotton grain and lumps missing; shade a smooth gradient; silhouette right. Cleanest render in the set. |
| | c19 | 1 | 4 | 5 | 6 | 3 | A regular polka-dot pattern of darker discs across the shade side of the tower — the hardest artefact in the set. |
| D base (ref c07) | c10 | 2 | 4 | 4 | 5 | 3 | A fingerprint-like whorl (concentric ripples) on the lit face at top centre (clear at 2×); underside bright and flat where the ref has a dark grey underbelly band; base edge a row of equal small blobs. |
| | c23 | 2 | 4 | 4 | 5 | 3 | Same whorl, slightly greyer. Tie. |

Close-up winners: A-left c13, A-tower c08, B-dome c02, B-trunk c24, C-top c12, C-tail tie, D-tower c05, D-base tie. The distance and close-up winners agree where the pairings are visible (d02 / c13 / c08; d10 / c05); the close-up margin is larger than the distance margin only where a hard artefact appears (c19 dots, c17 flecks).

## Hard artefacts per render

- **Polka-dot shade** — c19 (D tower, strong, visible in d12 at full frame); weaker bulb/ring mottle in c20 and c17 (A, probably d01); crater-like blotches in the shade core of c12/c16 and d05/d07 (C).
- **Trunk slit** — a dark vertical gash in the B trunk in both renders (c22, c24; d03, d09 at ~(1120,770)). Not in the ref.
- **Fingerprint whorl** — concentric ripples on the brightest lit faces: c10/c23 top centre (D base), and the stippled/cellular patch on d10/d12's left body (~(800,580)). The ref has grain there, never contours.
- **Serrated edge** — a stair-stepped bright silhouette on the B trunk's upper right (c22, c24) where the ref is soft.
- **Edge stipple** — a sand-like speckle along every render silhouette at 1:1 (c13, c17, c08, c20 most visible). The ref edges are a smooth blur.
- **Sun glow** at the frame edge (d01 top-left, d10/d12 top-right) that the reference frames do not show; and a saturated blue sky with a pale gradient instead of the ref's teal sky over a dense white haze.

## Main remaining differences (what still says "different engine")

1. **Grain.** Every reference surface, lit or shaded, carries a fine sand grain at roughly pixel scale; the renders are putty-smooth everywhere. This is the single biggest tell at close-up and it also reads at distance as "wax vs cotton".
2. **Mid-scale florets on the lit domes.** The frames' domes (B top, A tower, C top) are covered in lumps one step below the lobe scale, with creases between them; the renders have the lobes and then nothing until the pixel level. The B dome is the clearest case: a lumpy cap in the ref, an egg in both renders.
3. **Shade-side texture.** Where the frames show soft, grainy, still-lumpy shade, the renders show either a smooth smear (c08, c05) or a regular dot/bulb pattern (c19, c20, c12/c16). The dot pattern is a hard artefact; the smear is a missing-detail problem.
4. **Shade depth** is still inconsistent between the two renders: one render per framing is 15–30 levels too dark on the tower shade (d01, d10, d07), the other is near the ref's level but flatter.
5. **Colour.** The frames are warm (cream to pink) under a teal sky with a bright haze; the renders are neutral grey-white under a saturated blue sky. The sun-glow at the frame edge is an extra mismatch.
6. **Low-density parts.** The C tail is wispy and striated in the ref and a chain of hard blobs in the renders; the D underbelly is a dark band in the ref and a bright flat base in the renders.
7. **Silhouettes** are the renders' strongest point (same asset, same lobes), spoiled only by the slit, the serrated edge and the edge stipple.

Overall, blind: the reference is identifiable in every group in under a second from grain, warmth and haze. The renders are consistently a 4/10 "same cloud, different engine" at both distances, with no framing where either render would pass as a frame from the same engine.
