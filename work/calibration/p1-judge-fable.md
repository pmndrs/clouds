# P1 blind judging, Fable (2026-10-10)

Rubric v2 (8 criteria, 1–10, one line each). Blind: images `scratchpad/blind-p1/p01..p12`, key not opened. References studied first: `santasSleigh/end.jpg`, `santasSleigh/detail/DSC00633, 638, 642`, `Frog Cloud/DSC00589-Pano.jpg`, `Frog Cloud/detail/DSC00565, 575, 584`.

What the photos have that I judged against: convex cauliflower domes carrying smaller domes in 3–4× steps; a thin bright lit crust over a slightly darker lit interior; neutral grey bellies with long smooth gradients (never sky-blue); lobes bound by low-density tissue so a body reads as one mass; thin edges that fade translucent into sky; shaded sides still showing lobe structure.

## Pairs

Six pairs, confirmed by pixel difference (mean |diff| 0.3–1.5 of 255, same framing, same silhouette): **p01/p10**, **p02/p04**, **p03/p05**, **p06/p11**, **p07/p08**, **p09/p12**. The difference in every pair is confined to the lit faces and small interior cavities (diff maps in `scratchpad/judge-p1-fable/diff-*.png`); silhouettes, satellites and shading are otherwise identical. In each pair one member has more and darker small pits (pinhole craters) on its lit faces. The low-pit member is better in all six, but the gain is small (half a point to one point) and never changes the material verdict.

| Pair | More pits | Fewer pits | Better | Why |
|---|---|---|---|---|
| p01 / p10 | p10 | p01 | **p01** | p10's tower faces are pocked with dark craters (pumice); p01 is uniformly bubbly, convex. Clearest difference of the six. |
| p02 / p04 | p04 | p02 | **p02** | p04 has a distinct dark pinhole in the central lobe (~848,610) and deeper sponge pockets; p02 has the same pockets softened. Small. |
| p03 / p05 | p03 | p05 | **p05** (hair) | a few interior pinholes filled in p05; otherwise indistinguishable at 1:1. Near tie. |
| p06 / p11 | p06 | p11 | **p11** (hair) | p11's main body is slightly smoother with fewer dark specks; left rim differs by a pixel band. Near tie. |
| p07 / p08 | p08 | p07 | **p07** | p07 keeps a crisper lit rim on the central cavity and fewer pits on the lit humps; p08 is a touch more melted. |
| p09 / p12 | p09 | p12 | **p12** (hair) | p12's satellite fragments are slightly less speckled; main body identical. Near tie. |

## Scores

Criteria: 1 lobe hierarchy, 2 silhouette, 3 edge character, 4 shading and depth, 5 overall realism, 6 realism of form, 7 material, 8 cohesion.

### p01 (wide, two towers on a shelf, satellites; low-pit member)
1. Hierarchy **3**: one fine popcorn grain laid over smooth primitive envelopes; the mid scale (lobes a third the tower width) is missing.
2. Silhouette **4**: broccoli heads on stalks, and a straight horizontal seam where the towers meet the shelf; satellites are plausible blobs.
3. Edges **4**: uniformly hard and granular; no wisp, no soft underside anywhere.
4. Shading **5**: grain self-shadows and the shelf underside is darker, towers read as separate volumes; all shadow is sky-blue.
5. Overall **4**.
6. Form **4**: at thumbnail it is a cumulus cluster; up close it is popcorn balls glued to a slab.
7. Material **3**: opaque, dense, one grain size: popcorn / styrofoam; no light into the volume, no translucency at edges.
8. Cohesion **3**: bodies butt together with hard seams; no connective tissue between towers and shelf; detached blobs float.

### p10 (same as p01, pitted)
1. Hierarchy **3**: as p01.
2. Silhouette **4**: as p01.
3. Edges **4**: as p01, plus crater rims on the lit faces.
4. Shading **5**: as p01.
5. Overall **3**.
6. Form **3**: the pitted faces read as pumice stone, not cloud.
7. Material **2**: pumice; dark pinholes all over the lit crust are the opposite of convex cauliflower.
8. Cohesion **3**: as p01.

### p02 (detail, large soft mass; low-pit member)
1. Hierarchy **4**: big soft mounds carry some medium bulges, but the smallest scale is sponge mottling, not domes.
2. Silhouette **4**: rounded masses, but thin antler strands at top-left and a box-shaped detached chunk at right (~1450,300) that looks like a tile/voxel artifact.
3. Edges **3**: uniformly soft and blurred; no crisp lit crust anywhere; the detached chunk is the only hard edge.
4. Shading **4**: blue-grey hollows give some depth, but it is mottling, not lobe casting onto lobe; all shadow sky-blue.
5. Overall **4**.
6. Form **4**: reads as a cloud-ish mass of whipped cream; the interior pockets read as bath sponge.
7. Material **4**: soft and diffusing, better than foam, but it is cotton wool / whipped cream; lit side a flat white plateau, no translucent thin edges.
8. Cohesion **6**: one continuous body, lobes blend with soft falloff; the best cohesion in the set.

### p04 (same as p02, pitted)
1. Hierarchy **4**: as p02.
2. Silhouette **4**: as p02.
3. Edges **3**: as p02.
4. Shading **4**: as p02.
5. Overall **4**.
6. Form **4**: as p02.
7. Material **3**: the central pinhole and deeper sponge pockets push it toward sponge.
8. Cohesion **6**: as p02.

### p03 (wide, leaning lone cloud with satellites; higher-pit member, barely)
1. Hierarchy **5**: real steps here: big rounded masses, medium lobes, fine cauliflower grain on the upper-left body; closest to the photos.
2. Silhouette **5**: domed upper mass with plausible satellites; lower-right dissolves into torn lumps; small loop holes at top-left are noise artifacts.
3. Edges **5**: crisper than the detail shots with fine granularity; but every edge has the same crispness, no soft undersides or wisps.
4. Shading **5**: lit lobes read as volumes over a darker interior and the belly is darker; shadow is sky-blue and the lit side is flat white with no crust-over-interior gradient.
5. Overall **5**.
6. Form **5**: reads as a cloud at thumbnail; the lower-right is blobs.
7. Material **4**: dense cotton; bright plateau white; little light penetration; the only edges that fade are the small satellites.
8. Cohesion **5**: upper mass coherent; the bridge to the lower-right cluster is weak and that cluster is spattered blobs with harsh falloff.

### p05 (same as p03, a few pinholes filled)
1. Hierarchy **5**, 2. Silhouette **5**, 3. Edges **5**, 4. Shading **5**: as p03.
5. Overall **5**.
6. Form **5**: as p03.
7. Material **4**: as p03, a hair cleaner on the lit faces.
8. Cohesion **5**: as p03.

### p06 (small cloud with confetti satellites; higher-pit member)
1. Hierarchy **3**: one scale; the main body is a smooth blob with a scooped top, satellites are equal small blobs.
2. Silhouette **3**: a kidney with a crater in its top; the concave scoop is the inverse of a cumulus dome.
3. Edges **4**: crisp but dithered (visible stipple on every fragment); all one hardness.
4. Shading **4**: the bowl's inner shadow and the darker lower body give some volume; sky-blue shadows.
5. Overall **3**.
6. Form **3**: a blob with a crater plus dandruff; not a cumulus form.
7. Material **4**: fragments look like cotton tufts; body smooth and dense.
8. Cohesion **2**: the satellites are a spatter of disconnected equal blobs with no connective tissue: the owner's exact complaint.

### p11 (same as p06, smoother body)
1. Hierarchy **3**, 2. Silhouette **3**, 3. Edges **4**, 4. Shading **4**: as p06.
5. Overall **3**.
6. Form **3**: as p06.
7. Material **4**: as p06, a hair smoother.
8. Cohesion **2**: as p06.

### p07 (detail, ridge with spires and a central bowl; low-pit member)
1. Hierarchy **3**: conical peaks and one big smooth bowl; faint grain; no nested domes.
2. Silhouette **3**: two pointed spires and smooth humps read as meringue, not cumulus turrets.
3. Edges **3**: smooth and rounded everywhere; lit ridges only mildly crisp; stipple on the lit surfaces; no thin parts.
4. Shading **5**: strongest depth in the set: shaded cavity, lit rims, lobes in front of lobes; but the whole shaded side is one smooth sky-blue bowl.
5. Overall **4**.
6. Form **3**: melted marshmallow / taffy landscape; the central concavity is the opposite of cumulus convexity.
7. Material **3**: smooth dense surfaces with a near-glossy look: whipped cream / marshmallow; no vapour softness, no translucency.
8. Cohesion **7**: fully one body; if anything too melted together.

### p08 (same as p07, softer and more pitted)
1. Hierarchy **3**, 2. Silhouette **3**: as p07.
3. Edges **3**: the cavity rim loses its crispness; more pinholes on the lit humps.
4. Shading **5**: as p07.
5. Overall **3**.
6. Form **3**: as p07.
7. Material **3**: as p07, a touch more melted.
8. Cohesion **7**: as p07.

### p09 (mid shot, dish-shaped body with confetti; higher-pit member, barely)
1. Hierarchy **3**: a handful of equal lumps on a smooth dish.
2. Silhouette **3**: a scooped top with two bumps on the rim; the right-hand satellite is a torn tile.
3. Edges **4**: crisp but with heavy stipple along every edge; fragments fuzzy; no soft undersides.
4. Shading **4**: the dish shadow and left body give some depth; sky-blue shadows; lit faces flat white.
5. Overall **3**.
6. Form **3**: a bowl with lumps plus scatter; blobs of blobs.
7. Material **4**: cotton tufts; the fragments do fade translucent into sky, the one vapour-like thing in the set.
8. Cohesion **3**: main body cohesive; satellites are a spatter with harsh falloff.

### p12 (same as p09, fragments slightly less speckled)
1. Hierarchy **3**, 2. Silhouette **3**, 3. Edges **4**, 4. Shading **4**: as p09.
5. Overall **3**.
6. Form **3**: as p09.
7. Material **4**: as p09.
8. Cohesion **3**: as p09.

## Ranking by overall realism

1. p05 (5)
2. p03 (5)
3. p02 (4)
4. p04 (4)
5. p01 (4)
6. p07 (4)
7. p10 (3)
8. p08 (3)
9. p12 (3)
10. p09 (3)
11. p11 (3)
12. p06 (3)

Nothing in the set could pass in the owner's photos. Best is the lone wide cloud (p03/p05), which has real scale steps on its upper-left body; everything else is capped at 3–4 by material and form.

## Surface texture, specifically

- **Convex cauliflower** exists only on the upper-left body of p03/p05 (medium lobes with fine grain) and as fine uniform popcorn on p01/p10. Nowhere does a big dome carry smaller domes in the photos' 3–4× steps.
- **Concave bowls** dominate the detail shots: p07/p08 has one large scooped crater in the centre of frame, p02/p04 has sponge pockets, and the main bodies of p06/p11 and p09/p12 are dish-shaped with the scoop facing the camera. Real cumulus is convex almost everywhere; a concavity this size reads as melted or scooped.
- **Pits / pumice**: p10 is the worst (lit tower faces pocked with dark craters), then p04 (distinct pinhole plus deeper pockets) and p08 (pinholes on the lit humps). The low-pit members of every pair are better, which supports removing whatever makes them, but filling the pits does not create bumps: the faces become smooth, not cauliflower.
- **Sponge**: p02/p04 interior reads as bath sponge (blue-grey hollows in white) rather than lobes in shadow.
- **Stipple/dither noise** along edges and across lit surfaces in p06/p11, p09/p12 and p07/p08 (visible at 1:1) looks like under-sampled marching; the photos have none and it reads as grain, not vapour.

## Shared gaps (unchanged from R1)

- Every shadow and belly is sky-blue; the photos' bellies are neutral grey with a long smooth gradient.
- The lit side is a flat white plateau; no thin brighter crust over a slightly darker lit interior.
- Thin edges stay opaque; only the small satellite fragments of p09/p12 fade translucent.
- Satellites in p06/p11 and p09/p12 are a spatter of equal blobs with harsh falloff and no connective tissue (cohesion 2–3).
- A box-shaped detached chunk in p02/p04 (right of frame) looks like a tile or voxel artifact and should be checked.
