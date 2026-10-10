# D1d blind judge (Fable), 2026-10-11

Set: `scratchpad/blind-d1d/` d01–d12 (full frames) and c01–c24 (crops). Judged blind; key, `work/` reports and `artifacts/research/d1-parity/` not opened. Method per `rubric.md` "Judging method": whole frames, then the crops at native pixels, plus my own 2x nearest-neighbour sub-cuts of each crop trio (same box in all three) to separate texture from resampling.

Scores are 1–10 for *match to the reference* on (1) surface, (2) shading, (3) colour, (4) edges, (5) same cloud / same engine. Harsh scale: 10 = indistinguishable, 5 = clearly the same asset but obviously a different renderer, 3 = the asset is recognisable but the surface is wrong in kind.

## Grouping

Four framings, each a trio. Within every trio the two non-reference frames come in the same two flavours, so I name them:

- **G (grainy)**: a fine regular stipple / cross-hatch over every lit surface, and a dotted serrated halo on every silhouette. Frames d03, d06, d10, d12; crops c04, c07, c08, c11, c12, c16, c19, c20.
- **S (smooth)**: no stipple; soft blobby lobes, flat bright plateaus on tower tops, and in places a "topographic contour" ring pattern and blotchy mid-frequency mottle in shadow. Frames d05, d08, d09, d11; crops c03, c06, c13, c15, c17, c21, c23, c24.

| Framing | Frames | Reference guess | Why |
|---|---|---|---|
| A: wide cloud, right tower, camera 1 | d02, d03, d09 | **d02** | fine fibre with no stipple and no plateaus; crisp lit crusts; neutral grey-pink shadow; no sun-glow corner (the other two share an identical glow top-right) |
| B: same cloud, camera 2, white fog horizon | d05, d07, d12 | **d07** | same reasons; white fog at the horizon, no glow (d05 and d12 share a glow top-left) |
| C: tall single cumulus | d04, d08, d10 | **d04** | warm pink-grey tint, soft real fibre, faint diagonal banding in the sky (a captured/compressed frame, not a clean gradient) |
| D: wide lump with left streamer | d01, d06, d11 | **d01** | same tell-tales as d04 |

Crops map by size: R1 1400x900 = C tower dome (c01 ref, c03 S, c19 G). R2 960x1120 = A tower (c02 ref, c11 G, c15 S). R3 1400x1000 = D top (c05 ref, c04 G, c21 S). R4 1000x660 = A left lobe (c09 ref, c06 S, c16 G). R5 800x1040 = B tower (c10 ref, c07 G, c13 S). R6 1400x600 = C base (c18 ref, c08 G, c24 S). R7 1800x600 = B base (c22 ref, c12 G, c23 S). R8 1120x680 = D streamer (c14 ref, c17 S, c20 G).

## Distance (whole frames)

Scores: surface / shading / colour / edges / same-engine.

### A (ref d02)
- d03 (G): 5 / 6 / 5 / 4 / 5. Lump scales and the tower's lit-vs-shadow split are right; the whole cloud wears a film-grain stipple visible even at 1920 wide, and the silhouette is a fuzz halo rather than a crust. Shadows pushed blue.
- d09 (S): 4 / 6 / 6 / 5 / 5. Cleaner whites and a grey (not blue) shadow mass in the right places, but the lobes are blobs with flat lit faces; the small lumps on the ref's crusts are smeared away.
- **Winner: d09, narrowly** (26 vs 25). Neither is close to the ref's fibre.

### B (ref d07)
- d05 (S): 4 / 5 / 6 / 5 / 5. The tower's right flank is a hard dark slab with a visible seam where it meets the lit front; the ref's flank is a continuous soft gradient. Blob-like lobes. Colour (white, slight warm grey) is the closest of any render.
- d12 (G): 5 / 6 / 5 / 4 / 5. Better flank gradient and more lump structure, but the structure is partly grain; silhouette serrated; blue shadows.
- **Winner: d12, narrowly** (25 vs 25, tie on sum; I lean d12 for shading because the flank slab on d05 is the single most "wrong engine" feature in this framing).

### C (ref d04)
- d08 (S): 3 / 5 / 4 / 5 / 4. The top dome is one big flat white sheet, the whole upper half reads as a single soft blob; the lower-right shadow mass is placed right but flat. Cool white against the ref's warm pink-grey.
- d10 (G): 5 / 5 / 5 / 4 / 5. Lump hierarchy and a dark belly comparable to the ref, but the fine "detail" is the stipple, and the top dome is still a plateau.
- **Winner: d10** (24 vs 21).

### D (ref d01)
- d06 (G): 5 / 5 / 5 / 4 / 5. Streamer and lump placement match; shadow centre is blotchy; stipple and fuzz halo.
- d11 (S): 4 / 5 / 5 / 5 / 4. Shadow centre is a patchwork of flat grey blotches with bright spots; the lit top-left dome is a plateau; the streamer is soft but blob-like.
- **Winner: d06, narrowly** (24 vs 23).

Distance tally: G wins 3 (B lean, C, D), S wins 1 (A). All eight renders sit at 4–5 overall: same asset, clearly not the same engine.

## Close-up (crops, at native pixels and 2x sub-cuts)

### R1, C tower dome (ref c01)
- c03 (S): 3 / 4 / 4 / 4 / 3. A bare white plateau with one faint grey smudge; the ref dome has a soft lit-to-shadow turn and small creases on it. No fibre at all.
- c19 (G): 3 / 4 / 4 / 3 / 3. Same plateau, plus cross-hatch stipple across it and a dotted edge.
- **Winner: c03, by edges only** (18 vs 17). Both fail the dome.

### R2, A tower (ref c02)
- c11 (G): 4 / 5 / 5 / 3 / 4. Lobe sizes roughly right; the cross-hatch is at its worst here (clearly regular, rotates with the surface), silhouette serrated.
- c15 (S): 4 / 5 / 6 / 5 / 4. Soft, correct whites, but big flat lit faces and a "crumpled foil" mottle on the right flank (contour-ring pattern in the dark zone).
- **Winner: c15** (24 vs 21).

### R3, D top (ref c05)
- c04 (G): 4 / 5 / 4 / 4 / 4. Grey belly tones and lump placement nearest the ref; stipple; the top-left dome is a flat bright sheet.
- c21 (S): 3 / 4 / 5 / 5 / 4. Belly is a patchwork of blotches with bright flat patches inside the grey; the lit rim along the top is crisp and closer to the ref's crust than anything in G.
- **Tie** (21 vs 21). Lean c04 for surface and shading, c21 for edges.

### R4, A left lobe (ref c09)
- c06 (S): 4 / 5 / 6 / 5 / 5. Shape and shading of the lobe are close; faint fingerprint/contour rings on the right lobe; no fibre.
- c16 (G): 4 / 5 / 5 / 3 / 4. Stipple everywhere, serrated edges with dots floating off the silhouette.
- **Winner: c06** (25 vs 22).

### R5, B tower (ref c10)
- c07 (G): 4 / 5 / 5 / 3 / 4. Reads as cloud shape, but every surface is stipple and the rim is a line of dots.
- c13 (S): 4 / 5 / 6 / 5 / 4. Soft and the right colour; lobes blobby; a mottled contour patch at lower-left and the dark flank at lower-right is a flat slab.
- **Winner: c13** (24 vs 21).

### R6, C base (ref c18)
- c08 (G): 4 / 5 / 4 / 4 / 4. The grey belly with darker crease bands is roughly there, lighter and bluer than the ref; stipple throughout.
- c24 (S): 3 / 4 / 5 / 4 / 3. Hard artefacts: a dark vertical slit/seam centre-right, patches of coarse dotted stipple at depth inside the smooth shading, and crisp dark cut edges along the right.
- **Winner: c08** (21 vs 19).

### R7, B base (ref c22)
- c12 (G): 4 / 4 / 5 / 3 / 4. Base is lighter and bluer than the ref's dark flat-bottomed belly; stipple on the lit face, serrated top edge against the dark tower.
- c23 (S): 3 / 4 / 5 / 5 / 4. Clear topographic contour rings in the lit patch at top centre (a hard engine tell); otherwise smooth and close in tone.
- **Tie** (20 vs 21). Lean c12 for shading, c23 for edges.

### R8, D streamer (ref c14)
- c17 (S): 4 / 5 / 5 / 5 / 5. Outline and the soft fibrous ends of the streamer are the closest crop in the set; the lobes are still flat sheets with no grain.
- c20 (G): 4 / 5 / 4 / 3 / 4. Stipple is very visible on the thin streamer and the edge is a dotted halo.
- **Winner: c17** (24 vs 20).

Close-up tally: S wins 5 (R1, R2, R4, R5, R8), G wins 1 (R6), ties R3 and R7.

So the split is the reverse of what one might expect: **G looks better at distance** (the stipple masquerades as fine structure and gives the lumps a crust) **and S looks better up close** (where the stipple becomes a hard artefact and S's softness at least reads as water vapour). Neither flavour is above 5 anywhere.

## Hard artefacts

G (d03, d06, d10, d12 and their crops)
- Regular cross-hatch / checkerboard stipple over every lit surface, strongest where the surface is bright and facing the camera (c11, c16, c07, c19, c04). It is a fixed-pattern residual, not noise: the lattice is visible at 2x.
- Dotted serrated silhouettes with isolated dots floating off the edge (c16 top-left, c20, c07).
- Lit domes still flat plateaus under the stipple (c19, c04).
- Shadows pushed blue relative to the ref's neutral grey.

S (d05, d08, d09, d11 and their crops)
- Topographic contour rings / fingerprint pattern in mid-tone patches: c23 top centre (clearest), c06 right lobe, c13 lower-left, c15 right flank.
- Blotchy mid-frequency mottle in shadow with bright flat patches inside grey: c21, d11 centre.
- Flat white plateaus on every tower top: c03, c15, c13, d08.
- Dark flat slab on the tower's shadow flank with a seam to the lit front: d05 / c13 lower-right.
- c24: a dark vertical slit, patches of coarse dotted stipple embedded in otherwise smooth shading, crisp dark cut edges.

## Main remaining differences from the reference (both flavours)

1. **No real fibre.** The ref surface is soft fine fibre with small lumps riding on the big ones; G fakes it with a lattice, S has none. This is the biggest gap and it dominates every crop.
2. **Lit crusts.** The ref's sunlit rims are crisp over a few pixels and then turn softly into the body. G's rims are dotted fuzz; S's are soft blobs. Only c21's top rim and c17's streamer ends approach it.
3. **Domes are plateaus.** Every render tower top (R1, R2, R5, R3 top-left) is a flat white sheet; the ref domes carry a tonal turn and creases.
4. **Shadow mass character.** Ref: a continuous soft gradient with darker crease bands. Renders: either a hard dark slab with a seam (S, framing B) or blotchy patches (S, framing D) or grain (G). Shadow darkness is about right in A/B and a little light in C/D; blue cast in G.
5. **Colour.** Ref deck frames are warm pink-grey; renders are cool white with blue shadows (G) or neutral (S). S is closer. Sky glow corners appear only in the renders.
6. **Resolution tells.** Contour rings (S) and the checkerboard (G) are both engine fingerprints that would never pass as "same engine" at crop scale.
