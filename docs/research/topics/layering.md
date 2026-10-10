# Topic guide: layering (many cloud types and layers in one sky)

RS-5, 2026-10-10. How the sources put stratus, cumulus, cumulonimbus, alto and cirro clouds into one sky, and how authored voxel heroes sit inside a procedural field. Conventions, source ids and the three runtime paths (**P** `procedural/`, **G** generator + sky layer, **V** voxel up-rez) are as in [shape.md](shape.md#conventions). `X/` = `/Users/dex/Developer/WebGPUClouds/artifacts/research/extracted/`. Map generation and animation are in [weather.md](weather.md).

**The HZD floor in one line.** One volumetric shell (1.5-4 km) whose type varies continuously across the map (stratus → stratocumulus → cumulus), cumulonimbus as a precipitation override of that same shell, a cheap 2D alto/cirro layer above it, and a far-field ring that never empties [hzd15 s38-46, s73, s84-87; gp7 p.98-104, p.125]. **Ours (P)** is four independent Takram layers, one coverage channel each, summed; no type, no precipitation, no ring with a type half.

## 1. Weather-map channel schemes
| Scheme | R | G | B | A / other | Source |
| --- | --- | --- | --- | --- | --- |
| HZD 2015 | coverage | **precipitation** | type (0 stratus, 0.5 stratocumulus, 1 cumulus) | cirrus density is a separate control | hzd15 s38-42 (s40 note), gp7 p.103-104 (60 km map) |
| Nubis 2017 cloud map | coverage, Perlin footprint (connected) | **coverage, Perlin-Worley footprint** (islands) | type | per weather state, not in the map: skew, anvil bias, speed, direction, density | n17 p.53-60 |
| Nutshell 2018 | coverage | **coverage** | type | | nut s16 |
| Häggström | sparse coverage `wc0` | **fill coverage `wc1`** | max height | density | hag eq 4: `WMc = max(wc0, sat(gc - 0.5)·wc1·2)` |
| Frostbite H16 | 2D density | type index into a LUT (x type, y h; LUT R = density, G = erosion amount) | | | H16 p.33 (`frostbite-yusov-hogfeldt.md`) |
| Högfeldt | coverage / density | cloud height | base altitude | | `procedural-shape.md` M6 |
| NE vertical-profile NDF | min height, max height, coverage, bottom type, top type (5 fields) | | | | ne22 p.20, n3 s18 |
| NE 2.5D (high layer) | coverage, type | | | | ne22 p.64 |
| NE envelope | min height, max height, type, density, distance (+ upper/lower angle at locations) | | | | ne22 p.106, p.129; n3 s19 |
| HFW superstorm | + superstorm coverage / mask, min/max height field | | | | hfw p.52-57, ne22 p.139-140 |
| Unity HDRP (shipped) | coverage (squared) | rain | type → LUT | max height | `native-implementations.md` #2 |
| **Ours P Takram** | one coverage channel per layer, 4 layers (`procedural/density.wgsl.ts:182-186`, `settings.ts:51-64, 150-155`) | | | | |
| **Ours P Sky Pro** | R coverage only (Perlin fBM, `procedural/textures.ts:97-103`) | | | | |
| **Ours G** | coverage | species row (0 St, .25 Sc, .5 humilis, .75 mediocris, 1 congestus) | billow weight (storm: base height) | upper alto layer mass (storm: top height) | `generate/shaders.ts:229-247` |

**The G-channel disagreement.** HZD 2015 and GP7 say G is precipitation; N17 and the Nutshell say G is a second coverage footprint and there is no rain channel; Häggström uses G as fill coverage; we use it for species. These are different talks, not transcription errors (gp7.md review). Nobody else's G matches ours.

**Decision (owner, 2026-10-10): follow Nubis Evolved / Nubis Cubed, not the HZD 2015-2017 weather map.** The R/G/B weather map (and the G-channel question) is retired. The sky reads one **NDF** with NE's five per-column fields: **coverage, top type, bottom type, min height, max height** [ne22 p.20; n3 s18]. No precipitation channel: storms come later as NE-style influence NDFs and a superstorm mask [ne22 p.69-78, p.139]. The high 2.5D layer gets NE's two-field NDF (coverage, type) [ne22 p.64]. Storage is an implementation detail (five fields need two textures, e.g. RGBA8 coverage/top/bottom/spare + RG8 min/max height); the shaders must address fields by name so packing can change.

Superseded recommendation, kept for history: follow NE, which is where HZD ended up, and keep HZD's rain as a field:
- NDF texture A, RGBA8: R coverage, G top type, B bottom type, A precipitation.
- NDF texture B, RG8: min height, max height (or base + depth). Häggström's density (A) can go here as B's third channel.
- N17's "Perlin vs Perlin-Worley footprint" becomes a choice made when the map is generated (weather.md W2), not a runtime channel.
- The HZD floor shaper (shape.md S1) reads only R, G-as-type (or B) and A. Decide once, before S1 and weather W2, so maps stay portable between paths.

## 2. Type blending: one shell with continuous type, or many layers
| Source | How types coexist |
| --- | --- |
| hzd15 s73, s42; gp7 p.98 | **One** volumetric layer for all low types, distinguished by the type-blended gradient at the sample; cumulonimbus is the precipitation override (type → cumulonimbus, coverage ≥ 0.7) [gp7 p.104, hzd15 s42 note]; no stratus layer, no mid layer |
| n17 p.27-32 | coverage + type drive everything; per-state constants are global |
| ne22 p.20-28, p.77 | top and bottom type per column; **regional sets** of procedural NDFs (cumulus in one region, stratocumulus in another), layered with regional influence NDFs |
| web18 p.5 | each type its own density function in its own altitude band; layers **add**, squashed with `σ(x) = x/sqrt(1+x^2)` per type and on the sum |
| Frostbite H16 p.33 | one slab, the type LUT holds multiple layers and anvils |
| hag | one layer; "types" are recipes of global coverage/density (cumulus gc 0.6 gd 1; stratocumulus 0.8 / 0.5; stratus 1.0 / 0.35; cumulonimbus 1 / 1 with anvil) [hag p.53-57] |
| Ours P Takram | four layers (750 m + 650, 1000 m + 1200, 7500 m + 500, off), each its own channel, densities **summed** without a squash (`density.wgsl.ts:227`); layers 0 and 1 overlap from 1000 to 1400 m, so they add into a smear |
| Ours G | one species field with rows interpolated by G (`generate/shaders.ts:39-46`) plus an upper alto layer (A); per-cell species set size class, growth and turrets (`:337, :400`) |

**Recommendation.** The HZD floor is one shell with continuous type. In P, replace the four summed Takram layers with one volumetric shell (HZD altitudes) plus the 2D high layer, and keep Takram's layout only as the baseline (try-next L2). If two volumetric layers must overlap, give them disjoint height ranges or apply web18's `σ` to the sum.

## 3. Altitude bands
| Source | Low | Mid | High | Notes |
| --- | --- | --- | --- | --- |
| hzd15 s20, s73 | strato class, volumetric 1500-4000 m | 2D alto above 4000 m | 2D cirro | cumulonimbus drawn 1500 → 8000+ m (one column) |
| gp7 p.98, p.119 | stratus class 1.5-4 km; cumulonimbus 1-8 km; march shell starts 1.5 km, 3.5 km thick | 2D | 2D | |
| ne22 p.15-16, p.20 | St / Sc / Cu bases 0-1500 m | As / Ac 1500-4000 m | Cs / Ci 4000-8000 m | cumulonimbus spans all; the VP layer is 256-2048 m; stratus and cirrus sub-layers |
| web18 Table 2 (base / thickness, km) | Stratus 0.1-0.7 / 0.2-0.8; Stratocumulus 0.5-1.5 / 0.2-1.2; Cumulus 0.8-1.5 / 0.1-5.0; Nimbostratus 0.1-1 / 2-5; Cumulonimbus 0.8-1.0 / 7-12 | Altocumulus 2-6 / 0.2-0.7; Altostratus 3-5 / 1.0 | Cirrus 8.6-13 / 1-2; Cirrostratus 6-8 / 0.1-3; Cirrocumulus 6-8 / 0.2-0.4 | the paper groups Stratus and Stratocumulus under "Medium"; Fig 3 draws low < 2 km, medium 2-7, high 7-12 |
| hag p.10 | 400-1000 m (one layer, an artistic choice) | | | |
| n3 s71 | voxel world 4 km × 4 km × 512 m | | | |
| Photos | humilis/mediocris low | altocumulus about 3-6 km, smaller angular cells | cirrus always on top | `photo-species-specs.md` §6, §8 |
| Ours P | Takram 750 + 650, 1000 + 1200 (`settings.ts:151-152`); Sky Pro 4000 m + 5200 m (`:134`) | | Takram 7500 + 500 (`:153`) | |
| Ours G / cirrus | volume 512 m at 8 m by default; alto as fractions of it | alto row (`generate/shaders.ts:28`) | cirrus 9000 m, 600 m thick (`cirrus/index.ts:56`) | |

**Recommendation.** Seed presets from web18 Table 2 and NE's bands; keep the HZD volumetric shell at 1.5-4 km for the floor. Our Sky Pro shell (4-9.2 km) is far above any HZD low layer, which explains why its cumulus reads as a mid-level field.

## 4. Cirrus and other high layers
- **Sources:** hzd15 s84-87 (last step of the march; three tiling textures, fibrous streaks, patchy sheet, fine speckle, scrolled at different speeds and directions); hzd15 s38 (cirrus density is a separate artist control); gp7 p.125 (512^2 three-channel textures sampled once at the ray end, own wind); n17 p.50, p.105-106 (shipped game: cirrus is a 2D lookup); **ne22 p.65** (the recipe), p.67 (a few light samples to the sun through the sub-layer); hfw p.19 (3 tiling cloudscapes blended by type, eroded by inverse coverage), p.73 (storm cirrus offset downwind).
- **Code:** `X/ne22/code/ne22-p065.hlsl`.
- **NE p.65:** `d = ValueRemap(type, 0.5, 1, ValueRemap(type, 0, 0.5, streaky, wispy), round)`; `d = pow(d, 1 - ValueRemap(cov, 0, 1, -0.9, 0.9))` (exponent 1.9 at cov 0 to 0.1 at cov 1); `d *= ValueRemap(pow(cov, 3), 0, 0.5, 0, 1)` (full at cov 0.79).
- **Ours:** `cirrus/render.wgsl.ts:121-130` implements p.65 but the fade is `cov^2` over 0..0.36 (full at cov 0.6), not `cov^3` over 0..0.5; type is one global scalar (`cp.shape.y`, default 0.15, `cirrus/index.ts:56`), not a map; own wind and streak direction (`cirrus/index.ts:223-228`); per-altitude sun, so it stays pink after the low clouds go dark (matches the photo spec §11).
- **Recommendation:** A/B the NE `cov^3` fade; read type and coverage from the NE 2.5D NDF (two channels) so streaky, wispy and round regions coexist; add HZD's separate cirrus-density control (weather W4). Add a downwind cirrus patch tied to any storm (hfw p.73). (Try-next L6.)

## 5. The far-field variety ring
- **Sources:** hzd15 s45 diagram and notes: clouds drawn to 35 km; from 15 km, coverage pulled toward about 50 % and type toward cumulus, so the horizon is never empty or uniform. Also n17 p.98: below the horizon the shell tiles visibly, so those pixels are skipped.
- **Ours:** G has it fully (`generate/shaders.ts:306-312` `horizonAt`, options `generate/weather.ts:52-55, 153-154`, sky-layer default 15/35 of the range `sky-layer.ts:87-91, 406`). P Sky Pro has the coverage half only (+0.12 over 45 km from 20 km, `procedural/density.wgsl.ts:129-131`, `settings.ts:135`). P Takram has none.
- **Recommendation:** port `horizonAt`'s rule (coverage → 0.5, type → cumulus) into the HZD shaper (try-next L4). Accept against hzd15 p047 (ring diagram) and the humilis photo where puffs shrink into a bright ragged horizon band (`photo-species-specs.md` §1).

## 6. Envelope layers: valley fog and peak caps
- **Sources:** ne22 p.84-114 (why the vertical-profile model fails on terrain, p.91-93; envelope profile p.97; type switch p.99; slice offset p.102; density and coarse density p.105; authoring in Houdini p.107-109; light with a long-distance shadow map p.110-113); envelope march with cone step mapping 4.2 → 1.3 ms (p.116-126); n3 s14 (envelope layer hugs terrain below the peaks, vertical-profile shell above), s19-20, s40-42 (orographic pools in valleys, sample dots cluster on clouds); web18 p.7-8 (layer elevation warped by smoothed terrain), Fig 17 (fog-rise layer under cumulus, 460 primitives).
- **Code:** `X/ne22/code/ne22-p097.hlsl`, `ne22-p099.hlsl`, `ne22-p102.hlsl`, `ne22-p105.hlsl`, `ne22-p112.hlsl`, `ne22-p113.hlsl`; `X/n3/code/n3-s019.hlsl`, `n3-s020.hlsl`.
- **Formula:** `h = remap(height, min, max, 0, 1)`; `profile = h^2 · (1-h)^1.5 · remap(sample_height, 0, 35, 1, 0)`; density `height_fraction · pow(sat(n - (1 - profile)), 0.27)`. The raw product peaks at 0.091 (h 0.571), so it must be rescaled; N3 does not say how.
- **Ours:** G has a terrain stub (`generate/passes.ts:312-345`) and a flat stratus preset for a valley sea (`generate/presets.ts:71-73`); no envelope NDFs, no terrain-relative edge gradient, nothing in P.
- **Recommendation:** later. It needs terrain and target T3, and the owner has no valley-fog photos (`photo-species-specs.md` §14). (Try-next L7.)

## 7. Voxel heroes and procedural layers in one sky
**What Guerrilla did** (the production answer, N3):
- Two methods for the 2.5D sky (n3 s14): the vertical-profile shell for unreachable high clouds, the envelope layer for clouds the player flies through. The voxel field (4 km × 4 km × 512 m) handles the reachable hero clouds in Burning Shores (n3 s71).
- The comparison tables (n3 s46, s173, s190) set roles: vertical profile = sky only, evolves, no flight, casts no terrain shadow; envelope and voxel cast terrain shadows; voxel = free-form, flight, no realtime evolution.
- Hero-first workflow (n3 s162-167): sketch the east-west and north-south views against the sun arc; place one big cloud, check it from the ground at every time of day, built from 4-5 rotated sub-boxes; add a flat wispy **skirt** as connective tissue and tunnels from mesh paths; repeat per formation into a coastline chain, inland heaps and one isolated offshore cloud.
- Bases are deliberately offset in height, because grazing rays along undersides are expensive (n3 s153, via `deck-scenes.md` §2.2).
- Solvers are integrated by an **opacity-weighted mean hit distance** for the atmospheric blend (ne22 p.186-187, `X/ne22/code/ne22-p187.hlsl`).

**Ours:**
- P hybrid: the procedural trace splits its samples at the voxel cloud's mean distance into front and back parts, so the composite orders sky-front / voxel / sky-back; densities add (union) unless `boxCarve` fades the procedural field inside the box; light taps also integrate the voxel field, and the procedural field shadows heroes through the light grid (`procedural/trace.wgsl.ts:10-25`; `procedural/settings.ts:115-127`).
- G: the sky layer continues the generator's own weather field outside the box and picks it up at the wall, written as two premultiplied layers (`shaders/sky-layer.wgsl.ts:45-50`).
- Stamps: `max` / `replace` / `cutout`, yaw only, uniform scale (`generate/stamp.ts:23-31`): no pitch/roll, no squash, no erode op, no skirt piece.

**Recommendation.** Keep the union-plus-split hybrid, but make the hero layout an authored step (n3 s162 sun-arc sketch, s167 chain), add stamp pitch/roll, xyz squash, an erode op and a skirt piece (n3 §9 #9), and offset hero bases from the procedural base height (try-next L8). The authoring side belongs to `authoring.md`.

## 8. Multi-body scenes: clusters, lines, gaps
| Source | Mechanism | Use |
| --- | --- | --- |
| n17 p.55-58 | low-frequency **gate** × higher-frequency footprint: Perlin (R) gives connected formations, Perlin-Worley (G) isolated islands with connective tissue | islands vs sheets from one map (weather.md W2) |
| web18 p.6, p.13 | cover painted per layer, sampled into overlapping spheres `x_j (1 - r^2/R^2)^3`; shape noise stretched `px·0.35` (2.86x along x) for bands | streets aligned with wind; sphere stamps for holes and lines |
| `survey.md` | Bouthors and Neyret 2004 blob hierarchy (child blobs on a parent; size, overlap and bottom-flatness fields); Neyret 1997 bubbles that attract and merge | shape grammar for clusters (not fetched) |
| n3 s167 | the same formation repeated into a coastline chain with gaps | hero layout |
| Photos §1-2, §5-6 | humilis 10-40 % cover, sizes 5:1 with a few leaders, loose streets toward the horizon; mediocris 1-3 large clouds with satellites 20-40 % of their size and 0.5-2 cloud widths of gap; stratocumulus spacing CV 0.3-0.7, roll w:h 2-5; altocumulus spacing CV 0.57-0.81 (a lattice is below 0.15), size 5:1, elongation about 1.5:1 along the wind, wave bands at 10-20 % of the frame | acceptance numbers |
| Ours G | fBM cluster field gates four jittered Worley cell layers (big, mid, small, fractus), each cell with its own radius, peak, profile and sub-lobes; deck carpet; stratocumulus bands stretched 3.5x along the wind; alto cells with jitter (`generate/shaders.ts:229-247, 313-337, 400`) | already the richest multi-body model we have |
| Ours P | one Perlin fBM coverage (Sky Pro) or a loaded PNG (Takram) | no islands, no streets, no clusters |

**Recommendation.** Bring G's cluster-and-cells weather (or N17's gate × footprint as the HZD-faithful version) to the P path so procedural skies get islands, satellites and streets (weather.md W2), and add web18's anisotropic stretch for streets and altocumulus bands (try-next L5).

---

## Try next (ranked, for the board)
Acceptance on the compare page against [README.md §Reference frames](README.md#reference-frames) and the owner's photos.

| # | What | Why (visual failure it fixes) | Sources | Files | A/B acceptance | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| **L1** | **Decide the weather layout** (proposal §1: NDF A = coverage, top type, bottom type, precipitation; NDF B = min/max height) and write it down once for P and G | Every later item reads these channels; the sources disagree on G | hzd15 s40, gp7 p.103, n17 p.53-56, nut s16, hag eq 4, ne22 p.20 | spec in `work/specs/`; `generate/shaders.ts:229-265`, `procedural/settings.ts` | n/a (decision) | L, **owner input** |
| **L2** | **One volumetric shell with continuous type** in P (HZD 1.5-4 km) plus the 2D high layer, replacing four summed Takram layers | Overlapping layers smear (1000-1400 m); no stratus-to-cumulus transition across the map | hzd15 s73, gp7 p.98-104 | `procedural/settings.ts:150-155`, `density.wgsl.ts:182-200, 227` (with shape.md S1) | hzd15 p042-p048: the minimap pattern (magenta cumulus, red stratus lumps) gives the matching sky; photo T1 field | M |
| **L3** | **Precipitation → cumulonimbus override**: where rain is high, type → cumulonimbus and coverage ≥ 0.7; rain raises absorption (`e^(-d·r)`) | No storms in the procedural sky; no dark rain bases | gp7 p.104, p.118-119; hzd15 s42, s69 | S1 shader; weather A channel | hzd15 p044 (white regions) and s44-45 videos; cumulonimbus photos (base 0.15-0.25 of the lit top) | M, needs L1 |
| **L4** | **Far-field ring with the type half** in P | Sky Pro's horizon only adds coverage; Takram's horizon can empty or go uniform | hzd15 s45 | port `generate/shaders.ts:306-312` into the S1 shader | hzd15 p047; humilis horizon-band photo | L |
| **L5** | **Mid layer (altocumulus / stratocumulus bands)**: a thin layer at 2-6 km with its own scale and wind, anisotropic `px·0.35`-style stretch along the wind, jittered cells | Alto reads as a polka-dot lattice or is absent in P | web18 p.13 + Table 2; photos §5-6; G's alto (`generate/shaders.ts:495`) | S1 shader or a second P layer | Spacing CV 0.5-0.8, size 5:1, elongation 1.5:1, wave bands (photo §6); SY s67 and sunset-layers picks | M |
| **L6** | **Cirrus to NE p.65 and a map**: `cov^3` fade, type and coverage from a 2-channel NDF, a separate cirrus-density control | One global cirrus type; fade differs from NE | ne22 p.65, hzd15 s38, s87 | `cirrus/render.wgsl.ts:121-130`, `cirrus/index.ts:56` | hzd15 p089 textures; cirrus photos (streak width 1-5 %, length 15-60 % of frame, bundles of 3-8) | L |
| **L7** | **Envelope layer** for valley fog and peak caps | No orographic cloud (T3) | ne22 p.91-126, n3 s14, s19-20, s40-42, web18 p.7-8 | new sky-layer mode; terrain input | ne22 p.109, p.114; n3 s40-42; owner to supply valley-fog photos | H, **owner input** (photos, priority) |
| **L8** | **Hero layout over the procedural field**: stamp pitch/roll, xyz squash, erode op, skirt piece; hero bases offset from the procedural base; sun-arc layout | Heroes read pasted-on; no connective tissue | n3 s153, s162-167, ne22 p.187 | `generate/stamp.ts:23-31`, `procedural/settings.ts:115-127` | n3 s163/s167 frames; congestus photos (pedestal 1.5-3x tower width, companions at 50-70 % height) | M |
| **L9** | **σ squash or disjoint ranges** where two volumetric layers overlap | Summed overlaps oversaturate | web18 p.5 | `procedural/density.wgsl.ts:227` | Two-layer test: no bright seam at the overlap | L |
