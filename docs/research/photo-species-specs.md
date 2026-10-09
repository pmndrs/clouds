# Photo-derived visual specs per cloud species

Source: the owner's reference photos at `artifacts/research/cloud-photos/` (274 manifest entries, filed into 12 type folders; many appear in two folders). These photos are not copied into the repo. Contact sheets and crops are in the gitignored `work/captures/scratch/photos/` (`sheet_<type>_<n>.jpg`).

**How the numbers were made.** All 12 folders were reviewed on labelled contact sheets. Aspect ratios and edge stats come from a crude numpy segmentation (low-saturation and bright pixels = cloud, bottom 18% masked as ground) on 320 px wide thumbnails. It only counts clouds that do not touch the frame border, and it merges touching clouds. So numbers are "w:h of the connected blob", with n stated. Congestus and cumulonimbus were measured by hand because the mask merges tower and base deck. Colours are sRGB medians or k-means centres from 200 px thumbnails. They come from phone and Sony JPEGs that are HDR tone-mapped, so treat them as relative targets (+-10%).

Every photo is a perspective view. Apparent w:h of a cloud seen near the horizon is foreshortened, so ratios are for clouds at 20-60 degrees elevation unless noted.

---

## 0. Misfiled / questionable photos (flag only, nothing moved)

Index = position in the folder's sorted listing (the number printed on the sheet).

| Folder | Index / file | Problem |
|---|---|---|
| cumulus-humilis | 30, 31, 32, 33 (`B_20220906-122538`, `B_20220908-140449`, `B_20220910-110240`, `B_20220910-155001`) | Beach/hike snapshots; the clouds are a sliver. Weak as references. |
| cumulus-humilis | 6 (`A_20220710-195845_DSC00328`) | Cirrus plus a dusk cloud bank, not humilis. |
| cumulus-humilis | 34, 35 | Field crop and sky seen through trees; poor. |
| cumulus-mediocris | 40 (`B_20200724-000947`) | Lake reflection, no cloud study. |
| cumulus-mediocris | 9 to 15 (`DSC00350`, `00413`, `00416`, `00426`, `00439`, `00441`, `00449`), 50, 51, 52, 86-ish | Sunset-lit cumulus/altocumulus floccus. Fine as sunset refs, not mediocris form refs. |
| cumulus-mediocris | 39, 67 (`20260914` window) | Aerial through a window; belongs in aerial deck. |
| cumulus-mediocris | 58, 59, 65 | Night/moonlit cloud blobs. They are lighting refs, not species refs. |
| congestus | 0, 1 (`20220315-1008xx`) | Smoke-coloured tan cloud (probably smoke or dust-laden). Not a clean congestus. |
| congestus | 17 (`B_20220315-100032`), 18, 22 | Cropped to a wall of cloud; no silhouette visible. |
| congestus | 3 | Dog in lake; cloud tiny. |
| congestus | 14 (`A_20220905-085807`) | Aerial cumulus above a wing. |
| cumulonimbus | 3 (`A_20220909-063822`) | Rainbow under a cirrostratus/nimbostratus deck; no cb tower. |
| cumulonimbus | 10 (`B_20220910-173339`) | Overexposed, no structure. |
| altocumulus | 0, 1 (index 1 is moonlit), 13, 14, 15, 16, 31, 34 | Sunset cloud streaks, stratus fractus or cirrus bands. Not cellular alto. |
| altocumulus | 5, 18, 19, 20, 21, 24, 26, 35 | Scattered cumulus humilis/mediocris at low level, not a mid-level cell field. |
| altocumulus | 30 (`B_20220909-124120`) | Beach with distant cumulus. |
| altocumulus | 33 (`B_20221020-024950`) | Fisheye (180 degree lens) sky dome of small cumulus/cumulus floccus. Reads as a "polka-dot lattice" only because of the lens. Keep as a pattern ref but not as a perspective ref. |
| stratocumulus | 0, 1, 26, 27 | Dog / hill / person subjects; the cloud is incidental. |
| stratocumulus | 7, 8, 9, 10, 11 | Cumulus humilis/mediocris on blue sky (clearly cumuliform, not a stratocumulus deck). |
| stratocumulus | 15 | Rainbow / nimbostratus over Waikiki. |
| stratocumulus | 23, 24 | Aerial. |
| stratocumulus | 38, 40, 44, 45 | Hill-cloud, beach, and sea views where cloud is peripheral. 38 is a good orographic ridge cloud though. |
| altostratus | 1, 7, 8 (`DSC00627`, `DSC00614`, `DSC00654`) | Dark cumulus fractus under a veil; veil is altostratus but the subject is cumulus. |
| altostratus | 5, 6 | Cumulus on blue sky. 2, 9, 10 are hazy smoke/night, not usable. |
| cirrostratus | 3, 4, 5, 6, 7, 12 | Cumulus on blue sky plus thin cirrus streaks, not a cirrostratus sheet. |
| cirrus | 5, 6, 25, 26 (`DSC00138/139/528/534`), 23, 27 | Cumulus humilis with cirrus; fine as combos. |
| cirrus | 47, 48, 49 | Beach, trees, autumn tree: poor. |
| crepuscular-rays | 1, 2, 19, 20, 24, 25 | Sun-behind-cumulus rim lighting (silver lining), not rays. Excellent for the rim-light look but not beams. |
| crepuscular-rays | 3, 18 | Clear-sky wedge glow near the horizon with no cloud occluders. Good anti-crepuscular reference only. |
| sunset-layers | 5, 6 (smoke-tan cloud), 14 (dog in lake), 73 (pink cumulus tower crop) | Not a layered sunset. |
| sunset-layers | 58, 59, 60, 100, 101, 102, 104, 105, 106 | Cloudless twilight gradients. Excellent for sky colour, no layering. |
| sunset-layers | 65, 66, 107 | Airplane-window twilight bands. Good for T7 night/dusk and the aerial look. |
| aerial-cloud-deck | 0, 5, 6, 9 | Dusk window shots and city lights, no cloud deck. |

---

## 1. Cumulus humilis (36 files, ~28 usable)

- **Photos used**: 13 hand-picked day photos, 20 blobs with well-defined outlines (n=20). Also eyeballed all 36.
- **Silhouette**
  - Base: flat but not razor flat; base-line wobble std is about 0.09 of cloud height (n=20).
  - Top: shallow 1-3 domes, dome height roughly half the cloud height. Some are like a flattened loaf; some are like a single cauliflower floret.
  - Width:height of the blob is median 2.3 (IQR 1.9-2.7, range 1.2-6) (n=20). Very flat ones (4+) are the elongated rolls, e.g. `A_20220801-105416_DSC00822`.
- **Size and spacing**
  - Individual puffs are 2-8% of frame width at 70-90 degrees FOV, so about 2-6 degrees angular.
  - Sky cover about 10-40%. Spacing is irregular (clustered, mostly in loose streets or rows heading toward the horizon). Sizes in a photo vary 5:1, with a few larger "leaders" and many tiny puffs.
  - Distant clouds get smaller and flatter, and merge into a bright ragged horizon band (`A_20220602-050524_B7EE8102`).
- **Edges**: crisp bright tops, with tiny wisps only at the lee tail and where they decay (`DSC00531`). Bases are soft or slightly ragged. No wispy tops.
- **Shading**: white top (sun side), blue-grey flat base about 30-45% darker. Contrast is moderate (~1:2.5 base to top). Sky behind is deep blue, so edge contrast is high.
- **Layering**: often with a high cirrus veil, or contrails (`DSC00139`, `DSC00595`). Often the small-cell tail of a mediocris field.

## 2. Cumulus mediocris (68 files, ~40 usable)

- **Photos used**: 24 day photos, 18 isolated blobs (n=18).
- **Silhouette**
  - Base: broad, mostly flat. Base wobble std 0.12 of height. Has a grey shaded underside, sometimes a lower ragged skirt.
  - Top: 2-4 stacked bulbous domes (cauliflower) with sharp concave notches between domes. Domes are about 20-35% of cloud width.
  - Blob width:height is median 1.7 (IQR 1.4-2.2, range 0.9-2.8) (n=18). Single pillar clouds approach 1:1; wide elongated ones near 2.5.
  - Flanks: lumpy, not smooth. The lobe scale is hierarchical: big domes with smaller bumps (about 1/4 of dome diameter) on their surfaces.
- **Size and spacing**: individual clouds 10-25% of frame width, 1-3 large clouds with several small satellites. Clusters or streets with 0.5-2 cloud-widths of blue gap. Satellites are 20-40% of the main cloud size.
- **Edges**: crisp lit edges; very crisp against blue sky. The shadowed lee side blends to grey. Some thin wisps at the sheared side (`DSC00441`).
- **Shading**: bright top (nearly white), very dark blue-grey base (0.35-0.5 of the top), strong silver lining when backlit (`DSC00192/195`). Internal self-shadow gives a mid-grey sculpted look.
- **Layering**: most often with cirrus streaks above, humilis puffs below/at the side, and sometimes sheared stratocumulus patches. At sunset the same form picks up pink and orange tops (see sec. 11).

## 3. Congestus (23 files, ~14 usable)

- **Photos used**: 9 photos, tower width and height measured by hand on 6 (n=6 towers), the rest visual.
- **Silhouette (the key point for the "cylinder walls" problem)**
  - A congestus tower is **not** a cylinder. The main body width:height is about 0.5-1.1 (median about 0.8; n=6). It is **widest low and narrows upward**: roughly a cone or "cauliflower pillar" with top width 30-60% of base width.
  - Flanks are made of stacked domes of **varying size**, typically 3-6 per flank, with the sizes shrinking with height. Between domes there are deep concave notches. Edges are bumpy rather than vertical.
  - The tower **leans or shears**: axis tilted 5-25 degrees with height, and the top domes are offset. A pure vertical axis is rare.
  - The tower sits on a **lower, wider pedestal**: either a flat/ragged base deck or neighbouring mediocris. Pedestal width is about 1.5-3 times the tower width (`A_20220902-193404_DSC02418`, `A_20220729-172804_DSC00629`).
  - Typical grouping: 1 main tower, 1-2 shorter companion towers (50-70% of the height) and wing bulges. Towers are separate in time (different growth phases).
  - Top: rounded dome, with a very soft thin cap or "skirt" in some cases. Not a flat anvil yet. Occasionally a thin pileus-like veil near the top.
- **Size and spacing**: main tower height 25-60% of frame at 60-70 degrees FOV. Companion towers spaced about 1 tower width apart.
- **Edges**: cauliflower edges, crisp on the lit side, with fuzzy fibrous ("fibrous / hairy") texture at the very top where it freezes. Soft, mushy at the shaded base.
- **Shading**: sunlit flank near-white to cream, shaded flank blue-grey (about 0.45 of lit). The underside is dark and flat. In sunset shots the tower flank becomes peach and the lee side purple-grey (`DSC02401`, `A7I01413`). The strongest depth cues are the self-shadows between domes.
- **Layering**: ragged mediocris at the base, strong cirrus anvil or streaks above, and a darker base deck in distance.

## 4. Cumulonimbus (12 files, ~9 usable)

- **Photos used**: 9 photos, visual measurement only (no segmentation, merged with deck).
- **Silhouette**
  - Giant column 0.5-0.7 w:h for the updraft core, topped by an **anvil** that spreads 2-4 times wider than the column, flat-bottomed and wispy-edged, often shearing in one direction (`A_20220910-174408_A7I01312`, `A7I01340`).
  - Flanks are smooth/fibrous (glaciated) at the top 40%, and cauliflower in the lower 60%. The transition is visible and is the main species cue.
  - Base is dark, flat, ragged, with a clear rain shaft or virga curtain (`A7I01369`, `A7I01357`).
  - Also a distant one at the horizon, with a flat-top (`A_20220715-085533_82FBB560`).
- **Size and spacing**: a single dominant cell with neighbouring decaying towers, 2-10 km separation (visually a 20-40% frame gap).
- **Edges**: crisp cauliflower at lower flanks, soft fibrous at the top, wispy anvil edge and anvil underside with mammatus-like lumps not captured.
- **Shading**: the base is very dark (0.15-0.25 of the lit top), top bright white. Back-lit: bright rim and inner glow; crepuscular beams leave the base (`A7I01357`, `A7I01396`).
- **Layering**: an anvil cirrus layer, outflow stratocumulus around the base, rain shaft.

## 5. Stratocumulus (46 files, ~30 usable)

- **Photos used**: 7 photos on segmentation (merged blobs, so only trends); the rest visual.
- **Silhouette**
  - Sheets and rolls with clear flat bases and bumpy tops. Cell/roll width 4-13% of frame width; roll width:height of about 2-5 (very elongated, e.g. `A_20221018-223524_7810A654`).
  - Typical forms: sheared rolls/bands in parallel streets (`20221018-2235xx`), or a patchy lumpy layer with large blue gaps (`DSC00873`, `DSC00753`).
  - Flanks are soft and rounded with little notching. Bumps are 5-10% of the roll width.
- **Size and spacing**: **very irregular**: area coefficient of variation about 1.7-2.4 and nearest-neighbour spacing CV about 0.3-0.7 (n=6 photos; blob merging inflates the CV). Gaps close to each other near the horizon (perspective). Coverage 50-80% with blue holes (the holes are mostly ragged, not round).
- **Edges**: crisp on the bright sides and a smoky/soft fade on the lee side. Big holes have ragged edges.
- **Shading**: bright grey-white tops and dark grey-blue bases (about 0.4-0.6 of the top), sun-lit rims, with the underside colours picking up the sky. At sunset the bases are lit from below with orange-pink and the tops stay grey-blue (`A_20220710-202535`, `A_20220827-205040_E7CA1E5F`).
- **Layering**: usually the lowest layer with cirrus or altocumulus above. Gaps show the upper layers.

## 6. Altocumulus (38 files, ~16 true altocumulus)

- **Photos used**: 8 on cell segmentation (5 returned usable counts). Visual on all 38. **True altocumulus** (cellular mid-level cloud) are: index 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 17 (moonlit), 22, 29, 32, 36, 37 plus 33 (fisheye).
- **Why ours reads as a polka-dot lattice**: real altocumulus is **not** evenly spaced. From the photos:
  - Cell **size varies by about 5:1** within one view, and the area CV is 1.7-2.7 (n=5 photos; segmentation merges cells, so real cell CV is probably 0.6-1.0).
  - Nearest-neighbour spacing CV is 0.57-0.81 (n=5). A lattice has CV below 0.15. Only the fisheye `33` looks regular, and even there cell size varies 2:1.
  - Cells are **flattened and elongated** along the wind: element w:h of 1.2-2.2 (median ~1.6; n=5).
  - Cell width is 3-7% of frame width (about 2-5 degrees). Gap-to-diameter ratio is about 1.4-2 (so mostly **bright, touching or merging**, blue gaps are smaller than the cells in the dense parts).
  - **Organisation**: a density gradient. Cells grow bigger and brighter on one side and shrink toward a thin edge (`A_20220511-093504`, `A_20220710-201409_DSC00415`); there are also parallel bands/wave rows with wavelength 10-20% of frame width (`A_20220616-104051_67912834` and `B_20221008-085731`). Merged patches and larger "mother" clouds interrupt the pattern.
  - Cell shape: **flat bottom, soft lumpy top, wispy shear tails**; the edge towards the sun is bright. The cells have a dark underside; many are grey-blue in the centre and have a bright rim.
  - The pattern **fades into a blur near the horizon**, because cells overlap in perspective.
- **Shading**: white/yellow-white rims, grey-blue to mauve centres, and a dark base. At sunset: orange-pink underlit cell undersides, grey-blue tops.
- **Layering**: usually sits above stratocumulus/humilis, with cirrus streaks above it. Mid-level (about 3-6 km), so smaller angular cells than humilis.
- **Renderer implications**: jitter cell centres (spacing CV 0.5-0.8), a 4-6 octave size distribution, anisotropic elongation 1.5:1 along the wind, add thickness variation (thin gaps of cirrus-like haze), add density gradient and wave bands, and apply a large-scale coverage mask with merged patches.

## 7. Altostratus (11 files, ~4 usable)

- **Photos used**: 11 viewed. No measurement possible.
- **Silhouette**: no silhouette. A featureless, slightly mottled sheet with a smooth luminance gradient. The sun is seen as a **diffuse bright disc** with no sharp edge (`A_20220317-101837`, `A_20220811-125042` with the moon).
- **Edges**: none, or a very soft sheet edge, with a rippled/wispy transition to blue sky.
- **Shading**: milky grey-blue (about #8E97A6 to #B0B6C0 daytime), brightest around the sun, darker toward the horizon. Low contrast (max 1:2 across the sky).
- **Layering**: usually thick enough to hide cirrus. Low cumulus fractus appear as dark blobs under it (`DSC00627` and `DSC00654`; these are visible in 3 photos).

## 8. Cirrus (50 files, ~38 usable)

- **Photos used**: all 50 viewed.
- **Silhouette**: fibrous streaks, hooks (uncinus), and "mares' tails" with a head and a trailing streak. Streak width 1-5% of frame, length 15-60% of frame. Streaks are sheared and nearly parallel, with fan-shaped convergence toward one horizon (perspective). Occasional broader patches (cirrus spissatus, `A_20220612-101117_77F0069F`).
- **Size and spacing**: coverage 10-60%, bundles of 3-8 streaks, spacing irregular.
- **Edges**: very wispy; fibre texture runs along the streak; the head is sharper than the tail. No hard edge.
- **Shading**: nearly translucent; white on deep blue by day (#E8EEF8 over #1F4C9A at zenith). At low sun they glow bright peach/pink/red **long before** the lower clouds do (`A_20220815-102212_14751A6E`, `A_20210315-094813_E2F25736`).
- **Layering**: always above everything else. Over cumulus fields (`DSC00139`), or an anvil outflow.

## 9. Cirrostratus (13 files, ~5 usable)

- **Photos used**: 13 viewed (5 true: 0, 8, 9, 10, 11).
- **Silhouette**: a thin high veil with no edges; a gradient or fine fibre texture; **22-degree halo** around the sun (`A_20220317-101837`; slight).
- **Shading**: the sky looks milky white-blue, with the sun at about 3-5x the sky luminance. At sunset the veil is pink-peach with radial fans of streaks converging to the sun (`A_20220807-101138_5B88546D`, `A_20220807-103558_2932AA8A`).
- **Layering**: usually over cumulus or beneath cirrus streaks.

## 10. Aerial cloud deck (11 files, 6 relevant)

- **Photos used**: 11 viewed.
- **Fair-weather scatter from above**: `A_20220905-085425_36F59589`, `..._667906DB`, `..._A2DBA604`. Puffs 0.5-3% of frame width, mostly **white tops with crisp cast shadows** that are displaced on the dark ocean; cloud sizes follow a power law; there are streets/rows; whitecaps look like small bright dots (watch for confusion).
- **Large cumulus from above**: `A_20220905-085807_7FE917DC`. Cauliflower tops. Dense, bright top surface, dark gaps and cliffs; wing visible for scale.
- **High deck**: `A_20260914-080227_A5431A0E`, `A_20260914-080231_A043335D`: stratocumulus/altocumulus deck with Mt Fuji above it. A flat deck with a soft bumpy top, a horizon haze band (#B9C8DA), and a deep blue zenith (#27508F-ish, darkening to near black at the top of the frame).
- **Twilight band from altitude**: `A_20200116-022010_3369524A`, `A_20260517-101232_5D6BBE20`, `A_20260914-061333`: very thin saturated orange band at the horizon (#E0733A) under a dark navy (#101A3A), with a visible blue-white "limb glow".

## 11. Sunset layers (109 files, ~85 relevant)

Sample positions: sun-side horizon, 45 degrees up on the sun side, zenith, and anti-solar sky. All sampled from medians of horizontal bands (top = zenith side, bottom = near horizon, ground masked), n = 22 photos (listed under each row).

### Sky colour gradient, sun just above or below the horizon (clear sky)
Photos 58-60, 100-102 (n=6).

| Position | Warm sunset (sun on or just below the horizon) | Late twilight / blue hour |
|---|---|---|
| Horizon, sun side | #D6C1BF to #F1E1D3 (pinkish white) or #C79A5A / #D98344 (orange band) | #869CB9 to #9EC5E0 (pale blue) |
| 10-20 degrees up | #927D97 (mauve) | #3C6492 |
| 30-45 degrees up | #5F5276 / #3F395E (purple-indigo) | #1F426E |
| Zenith | #1B1E3D / #2A2A4C (dark indigo) | #071832 to #0C1834 |
| Anti-solar horizon | #9EA9B5 / #B8B496 (the "belt of Venus", pink-grey) and a dark blue-grey band below | similar, lower luminance |

The twilight sequence in `A_20221021-084217_DSC02782` (sun below horizon, clear sky) is the best single reference for a smooth sky ramp: bands #D6C1BF -> #927D97 -> #5F5276 -> #3F395E -> #2A2A4C -> #1B1E3D. The purple band is real and wide (about 25% of the sky).

### Clouds at sunset
Sampled across photos 3, 8, 21, 25, 26, 31, 40, 45, 51, 53, 62 and 20 (n=12).

| Part | Colour range | Notes |
|---|---|---|
| **Cloud base, lit from below (sun-side, low cloud)** | #D98344, #CD825A, #D3765F, #DCA97C, #E6C499, #F8FBE2 (the brightest) | Orange to salmon to peach; ratio to the dark side up to 6:1. Pink-red in cirrus (#D3765F, #C35D5D) is the most saturated. |
| **Cloud tops / sky-facing sides** | #8B4D87 (mauve), #97829A, #9D848B, #6B5C7E, #A39A8E, #777678 | Grey-lilac to grey-blue. They are **cooler and lower in luminance** than the lit bases. Not white. |
| **Cloud shadow side / thick body** | #404147, #3A425D, #45556E, #615C5C | Dark blue-slate. Saturation under 0.2. |
| **Rim / silver lining** | #F8FBE2, #FAE4C0 (near white-warm) | Thin, 1-3% of cloud width, bright. |
| **High cirrus at deep sunset** | #C35D5D, #D3765F, #D98344 | Lit brighter than low clouds because they still see the sun. |
| **Low clouds after sun is gone** | #404147, #3A425D | Dark slate, no orange. |

- **Near the sun (within 15 degrees)**: sky #E6C499 / #F1E1D3 to #DCA97C. Clouds become dark silhouettes edged with gold (#E6C499).
- **Away from the sun (anti-solar side)**: sky #5A77A2 -> #8796B2 -> #AFB2BD (blue-grey to lilac), with a pink belt of Venus (#B8B496 / #C4ACA3) at the horizon. Clouds appear lit pink-peach from the side (`B_20220413-095954`, `A_20220419-100624`).
- **What the "Takram" look has that ours lacks**: (from `work/captures/P8-A/three-rows/sunset.jpg`) cloud tops/bodies are **blue-violet to mauve** (#5F6482-ish) and the warm light is concentrated into thin low orange/peach fringes near the horizon. Ours (row 1) has uniform warm-cream cloud sides and a plain gold horizon. In the photos, the bulk of each cloud is the *cool* colour (mauve/slate, 60-75% of cloud area), and warm colour is limited to the lit edge and the underside facing the sun (15-25%). The sky has a purple-to-pink gradient, never a plain blue-to-gold gradient.
- **Contrast**: lit/shadow luminance ratio of 4-6:1 at sunset, vs 2-3:1 at noon.

### Layering at sunset
Typically 3 layers: low cumulus/stratocumulus (dark, rim-lit), mid altocumulus (orange-pink underside), high cirrus (brightest pink/red). Reference: `A_20220710-201409_DSC00415` and `A_20220710-201650_DSC00439`.

## 12. Crepuscular rays (26 files, ~13 true)

- **Photos used**: 26 viewed.
- **True ray photos**: `A_20220710-201316_DSC00407`, `A_20220710-201442_DSC00422`, `A_20220710-201429_DSC00416`, `A_20220910-180016_A7I01357`, `A_20220910-175904_A7I01351`, `A_20220902-071919_DSC02390`, `A_20220902-222220_6F4BC35D`, `A_20220618-071114_B5ECB4AB`.
- **Look**
  - Rays fan out from the sun/cloud gap, with a half-angle of 30-60 degrees and 8-20 rays per fan, at **uneven widths** (1 to 5 degrees) and uneven brightness.
  - Contrast is subtle: bright rays are only about 10-25% brighter than the darker gaps, except in hazy golden light (up to 40%).
  - Rays are **soft-edged** and nearly straight; they converge on the sun, and they are best visible next to a dark cloud. Anti-crepuscular rays converge at the opposite horizon (`A_20220709-105951`, `A_20221226-085331`) as pale blue wedges.
  - Colour: warm cream-gold (#E6C499) on the sun side; blue-grey elsewhere. The sky between rays is darker (#5F6A7A).
- **Occluders**: the rays need distinct cumulus/cb casting shadows (spacing about 1 cloud width).

---

## 13. Reference picks for target scenes T1-T7

Paths are relative to `artifacts/research/cloud-photos/`.

**T1: Fair-weather cumulus field with cirrus veil**
- `cumulus-humilis/A_20220701-151538_DSC00139.jpg`: field of flat-based puffs of mixed sizes with a cirrus veil above.
- `cumulus-humilis/A_20220602-050524_B7EE8102.jpg`: big puffs shrinking into a bright horizon band.
- `cumulus-humilis/A_20220729-163005_DSC00595.jpg`: puffs plus cirrus streaks plus a contrail.
- `aerial-cloud-deck/A_20220905-085425_36F59589.jpg`: fair-weather scatter from above with crisp cast shadows on the ocean.
- `cumulus-mediocris/A_20220801-105825_DSC00889.jpg`: street of cumulus toward the horizon, with a dark base.

**T2: Dusk congestus sea, flight view**
- `congestus/A_20220910-182243_A7I01413.jpg`: backlit tower on a wide base with silver and peach tones.
- `congestus/A_20220902-222220_6F4BC35D.jpg`: layered towers with inner glow at sunset.
- `congestus/B_20220827-203504_34821A98.jpg`: towers in dusk gloom with a gold fringe.
- `aerial-cloud-deck/A_20220905-085807_7FE917DC.jpg`: tower tops seen from altitude.
- `congestus/A_20220827-211108_AE637F1E.jpg`: dusk towers over a sea with warm underlight.

**T3: Orographic cloud sea in valleys** (there are no direct photos; closest)
- `aerial-cloud-deck/A_20260914-080231_A043335D.jpg`: flat cloud deck from above with a peak above it.
- `aerial-cloud-deck/A_20260914-080227_A5431A0E.jpg`: deck with soft edges near terrain.
- `stratocumulus/B_20220904-185312_DSC00019.jpg`: cloud hugging a ridge above a valley.
- `stratocumulus/A_20260915-171733_A1BB10D2.jpg`: low deck over water with a mountain beyond.

**T4: Layered sunset bands**
- `sunset-layers/A_20220710-201409_DSC00415.jpg` (also in altocumulus): three layers, with alto cells in orange.
- `sunset-layers/A_20220425-095012_7089017A.jpg`: alto cells over dark stratocumulus with a warm horizon.
- `sunset-layers/A_20221012-083712_1458ED3F.jpg`: sheared stratocumulus bands with gaps and a sun glare.
- `sunset-layers/A_20221016-084611_ABB372B0.jpg`: bands with underlight and rays.
- `sunset-layers/A_20220815-102212_14751A6E.jpg`: high pink-orange streak layer, over a purple sky.

**T5: Cumulonimbus with lightning** (there is no lightning in the set; cb forms)
- `cumulonimbus/A_20220910-174832_A7I01326.jpg`: column, shaft and anvil, with a dark base.
- `cumulonimbus/A_20220910-180303_A7I01369.jpg`: rain curtain under a column, backlit.
- `cumulonimbus/A_20220910-180016_A7I01357.jpg`: dark base with beams and a surface glint.
- `cumulonimbus/A_20220715-085533_82FBB560.jpg`: clean bright cauliflower cb on the horizon.
- `cumulonimbus/A_20220910-174408_A7I01312.jpg`: tilted tower with a sheared anvil.

**T6: Tall-neck hero with cap and tunnel** (no pileus photos; use tower necks)
- `congestus/A_20220729-173342_DSC00678.jpg`: big cauliflower neck, close.
- `congestus/A_20220902-193404_DSC02418.jpg`: tall narrow leaning towers (0.5-0.6 w:h) with a pedestal.
- `congestus/A_20220729-172804_DSC00629.jpg`: tower plus a wide base.
- `congestus/A_20220729-173330_DSC00669.jpg`: big tower with companions.
- `cumulonimbus/A_20220910-174408_A7I01312.jpg`: a tall neck with a top cap and anvil.

**T7: Time of day on one cloudscape** (best use is a sequence from one spot)
- Waikiki balcony 2022-09-10: `cumulonimbus/A_20220910-174408_A7I01312.jpg` (day), `A_20220910-180303_A7I01369.jpg` (golden), `congestus/A_20220910-182243_A7I01413.jpg` (sunset), `cumulonimbus/B_20220910-180513_A7I01381.jpg` (dusk).
- Texas sky 2022-07-10: `sunset-layers/A_20220710-195845_DSC00328.jpg`, `...201316_DSC00407.jpg`, `...201521_DSC00426.jpg`, `...202729_DSC00459.jpg` (golden to dusk).
- Galveston 2022-09-02: `sunset-layers/A_20220902-071919_DSC02390.jpg` (dawn), `A_20220902-222220_6F4BC35D.jpg` (dusk).
- `sunset-layers/A_20221021-084217_DSC02782.jpg`: twilight sky ramp with no cloud.
- `sunset-layers/B_20221019-202153_DSC02627.jpg`: blue-hour sky ramp.

## 14. Gaps (types with no photos)

| Type | What we need |
|---|---|
| Stratus / fog valley | Aerial or hilltop photos of a flat fog layer filling valleys, with ridges poking through, edges at the cliffs, and the top-surface texture. Ideal: dawn from a hill or a plane. |
| Lenticular | Wave clouds over a mountain, stacked lenticular discs with smooth, lens-shaped, nearly static edges. Needs both the side silhouette and the lit/dusk colours. |
| Mammatus | Pouches hanging beneath anvils: scale, spacing (about 1-3 pouch widths), and the underlit colour. |
| Shelf / arcus | A low, roll-like leading edge with a flat base and a shaft behind it. Silhouette and the dark gust-front colour. |
| Nimbostratus | Uniform dark grey sheet with rain streaks, low contrast, and ragged scud below. |
| Cirrocumulus | Tiny (under 1 degree) ripples and cells in a cirrus layer, high-altitude. Needed to differentiate from altocumulus. |
| Also missing | Pileus caps, lightning, rain shafts in daylight with lit edges, and a true altocumulus lenticularis or castellanus. Also: nearly every photo is a phone or wide-angle shot with HDR tone-mapping, so exact radiometry is unavailable. |

## 15. Summary of the most useful findings

**Altocumulus**
1. Make the cell field **irregular**: nearest-neighbour spacing CV 0.5-0.8 (a lattice is under 0.15), and area varies 5:1 or more inside one view.
2. Cells are **elongated about 1.5:1 along the wind**, and touch or merge in dense zones (gap about 1.5-2 cell diameters in the sparse zones only).
3. Add **density gradients** and **wave bands** (10-20% of the frame wavelength), plus larger merged patches and thin haze gaps.
4. The fisheye photo `altocumulus/B_20221020-024950` is the only regular one, because of the lens. Do not use it as a perspective reference.
5. Each cell has a flat dark base, a lumpy top, and a shear tail. The sunward rim is bright.

**Congestus**
1. A tower is a **cone/cauliflower pillar** with w:h of 0.5-1.1 (median about 0.8), widest at the bottom and about 30-60% as wide at the top, not a cylinder.
2. The flank is **3-6 stacked domes** of decreasing size, with deep notches. Add a smaller second bump scale on the domes.
3. The tower **leans or shears** 5-25 degrees and sits on a wider **pedestal** (1.5-3x tower width) of mediocris or a base deck. Add 1-2 shorter companion towers at 50-70% of the height.
4. Shading is dominated by self-shadow between domes: lit flank near-white, shaded flank blue-grey at about 0.45x, dark flat base.

**Sunset colour**
1. Cloud bodies are mostly **cool** (mauve #8B4D87, #97829A, slate #404147, #3A425D). Warm tones (#D98344, #CD825A, #DCA97C, #E6C499) are limited to the sun-facing underside and edges (about 15-25% of the area), with thin near-white rims (#F8FBE2).
2. The sky ramps **pink-white at the horizon (#D6C1BF) -> mauve (#927D97) -> purple (#5F5276, #3F395E) -> indigo (#1B1E3D)** over about 25% of the sky, instead of blue to gold. The anti-solar horizon has a pink-grey belt of Venus (#B8B496 / #C4ACA3).
3. High cirrus stays the brightest pink or red (#D3765F, #C35D5D) after low clouds have gone dark slate. Layer lighting should be **per altitude**: the higher the layer, the longer it stays lit.
4. Lit-to-shadow ratio is 4-6:1 at sunset.
