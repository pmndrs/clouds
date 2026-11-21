# P2-1: shape measures from silhouettes (audit step 2.1)

Scripts are in `scripts/shape/`: `segment.py` (colour mask), `measure.py` (measures, `--selftest`, and `--alpha` for exact masks), `run_all.py` (this run) and `sheets.py`. The numbers are in `work/captures/P2-1/table.md`, `summary.json` and `measures/*.json`. The two sheets are `overlays.jpg` and `lobe-spectrum.jpg`. The whole run takes 61 s on the CPU (4 processes); the self-test takes 20 s.

**Verdict.** The measures separate photos from today's sky on fine outline structure, on how much of the outline faces down, and on large clear-sky gaps. They do **not** support "nothing between": our mid-scale lobe energy sits inside the photo range. They cannot test "same-thickness slabs" yet. Seen from below, our sky is one connected deck, so there are almost no separate bodies to take aspect ratios from (2.5 per image, mostly fragments). Fix the measure inputs before 2.3: use exact alpha with a per-body ID.

## Inputs
- **Photos (33)**: texas-afternoon (the target), santasSleigh/early, and from the cumulus folders: humilis 050524, DSC00138, DSC00139, DSC00268, DSC00822, 530EF5C2, 3CCBC693, DSC00838; mediocris 052716, DSC00194, DSC00200, DSC00234, 852856DC, DSC00528, DSC00534, BE3E3F66, DSC00809, DSC00850, DSC00873, 873F9F38, 3F491003, E74922AE, 92CB2AA7, A87BA223, FC253C20, 2D72F567, IMG_4922; congestus DSC00531, DSC00570, DSC00669, DSC00678. Full paths are in `run_all.py`. Every photo was downscaled to 1600 px.
- **Candidates and rejections**: 59 grade A/B, daytime, ground-view photos were tagged humilis, mediocris or congestus. Before looking, I excluded manifest notes that say backlit, rays, veil, cirrostratus, altostratus or panorama: the sun or a veil breaks the sky model, and panoramas distort the shapes. I then rejected from the contact sheets: overcast or dense decks (A_042340, A_104914), sun in frame or dark backlit (DSC00649, 373D941F, DSC00167, D1180D5D, santa-middle), hazy or tinted sky (DSC02418, DSC00115), clouds that are mostly ocean or skyline (Waikiki and Diamond Head frames, Koko Head), and close-ups that are all cloud (DSC00161, DSC00219, DSC00588). I also removed duplicates: santasSleigh/end and congestus DSC00629 are the same frame as texas-afternoon, and the root DSC00570.JPG repeats congestus DSC00570.
- **Skipped categories**: stratocumulus, altocumulus, cirrus, cumulonimbus, sunset-layers and aerial: they are not the cumulus target, they are not against a clear sky, or they are not seen from below.
- **Our renders (6)**: `S1/final/{horizon,early,real}/{ground,gp7}.jpg`. The three styles share one density field, so there are **2 independent shapes**, not 6. The p-values below assume n=6 and are optimistic.
- **Parkouring (third data point)**: the exact alpha `PT1/alpha-noon.png` (Guerrilla's cloud, which you scored 4/10). I skipped V1 (EmberGen): its previews carry the HUD and the cloud sits inside the procedural sky, so it cannot be isolated without an alpha.

## Segmentation
The sky is modelled per image as a smooth cubic field of warmth (R/G), seeded from each row's lower envelope so that horizon haze stays in the model. A pixel is cloud if it has moved 40 % of the way from the local sky toward neutral, or if it is 20 % darker than the local sky luminance. Three zones are marked invalid and excluded: the ground below a detected horizon, haze where the local sky is itself near neutral, and obstacles (trees, poles).

R/G was needed because shaded bases keep the sky's blueness. In our renders they are within about 10 % of the sky in B−R and in luminance at the same height. I looked at an overlay for every image.

- **Dropped**: med-FE402C72, where power lines are segmented as cloud strands.
- **Known residual errors**: thin cirrus is counted as cloud in texas-afternoon (top band) and hum-DSC00139. Some invalid zones are too large where the sky model extrapolates into a corner (santa-early, DSC00534, E74922AE). Our renders lose part of the shaded underside of the large overhead cloud (ours-horizon-ground, top left).
- **Check against an exact alpha**: on Parkouring, the colour mask has IoU 0.87 against alpha > 0.5 on the path-traced frame (13 % larger) and 0.75 on our Nubis frame (29 % larger, because it picks up the soft fringe). On the path-traced frame, colour segmentation moves the band energies by −10 to −20 %. That is about the width of the photo IQR, so it is the main error term.

## Results (per image; photos n=33, ours n=6; AUC = P(photo > ours), 0.5 = no separation)
| measure | photos p10 / p25 / **med** / p75 / p90 | ours p25 / **med** / p75 | Parkouring | AUC | p | separates? |
|---|---|---|---|---|---|---|
| E64, finest band (lobe ~D/13) | 0.29 / 0.30 / **0.33** / 0.35 / 0.38 | 0.39 / **0.40** / 0.42 | 0.26 | 0.09 | 0.002 | **yes**, no IQR overlap |
| E_base64, fine structure on bases | 0.25 / 0.26 / **0.30** / 0.34 / 0.36 | 0.40 / **0.40** / 0.42 | 0.23 | 0.05 | 0.0006 | **yes** |
| E8, body-scale irregularity | 0.24 / 0.27 / **0.33** / 0.35 / 0.42 | 0.40 / **0.45** / 0.49 | 0.27 | 0.10 | 0.002 | **yes** |
| base_frac, outline facing down | 0.19 / 0.22 / **0.27** / 0.34 / 0.40 | 0.36 / **0.37** / 0.37 | 0.23 | 0.19 | 0.02 | **yes** |
| gap_p90, large clear gaps / width | 0.095 / 0.13 / **0.16** / 0.23 / 0.26 | 0.069 / **0.079** / 0.12 | 0.075 | 0.86 | 0.006 | **yes** |
| E16, E32, mid lobes (D/3, D/6) | 0.26–0.45, **0.34**; 0.27–0.43, **0.37** | **0.42**; **0.36** | 0.31; 0.25 | 0.26; 0.45 | 0.06; 0.7 | no |
| mid_share (E16+E32 over E8..E64) | 0.47 / 0.48 / **0.51** / 0.54 / 0.56 | 0.44 / **0.47** / 0.49 | 0.51 | 0.72 | 0.09 | weak, IQRs touch |
| top round-over-fuzz (T8..32 / T64) | 0.87 / 0.97 / **1.07** / 1.24 / 1.28 | 1.09 / **1.14** / 1.24 | 1.37 | 0.35 | 0.26 | no |
| aspect_mom, median body | 0.41 / 0.45 / **0.58** / 0.76 / 1.08 | 0.61 / **0.62** / 0.64 | 0.52 | 0.53 | 0.8 | no, and few bodies |
| aspect spread (log2 IQR) | 0.44 / 0.51 / **0.65** / 0.92 / 1.02 | 1.38 / **1.39** / 1.51 | - | 0.03 | 0.01 | an artefact (fragments) |
| base_rms / width | 0.028 / 0.031 / **0.048** / 0.075 / 0.10 | 0.037 / **0.043** / 0.047 | 0.033 | 0.50 | 1.0 | no |
| body area spread, gap median | in range | in range | | 0.37, 0.70 | >0.1 | no |

**Reading.** The photo spectrum is flat at about 0.3 to 0.37 per octave from body scale down to D/64: the outline is self-similar, so every scale carries the same relative structure. Ours has more at body scale (E8) and much more at the finest octave, above all on bases. The mid octaves are in range. So the numbers support "fuzz" and "flat bases with structure" (high base_frac and high E_base64). They do not support a missing mid band in the silhouette. The mid-scale defect, if real, is in interior shading, which a silhouette does not see.

Our sky has more cloud (0.56 against 0.43), and that confounds the gaps. The per-render spectra also vary a lot between styles (E8 from 0.35 to 0.77), although the density is the same. Each render is one merged body, and lighting changes where the colour mask joins pieces. That instability is itself a reason to measure from alpha.

## Proposed gates (our render must fall inside the photos' 10th to 90th percentile; per-image medians; render masks from exact alpha)
- **2.3 Bodies**: at least 3 complete bodies per frame; aspect_mom median 0.41–1.08; aspect log2 IQR 0.44–1.02; gap_p90 0.095–0.26 of width; chord median 0.013–0.027; area log10 p90/p10 1.35–2.4.
- **2.4 Lobes**: E16 0.26–0.45, E32 0.27–0.43 and mid_share 0.47–0.56. This gate has to be checked on frames where bodies are separate. On today's merged deck, E16 and E32 already pass and mid_share sits at the edge (0.47).
- **2.5 Erosion**: E64 0.29–0.38 and E_top64 0.27–0.36. Today fails at 0.40.
- **2.6 Bases**: base_frac 0.19–0.40, E_base64 0.25–0.36 (today 0.40, fails) and base_rms 0.028–0.10.

## Limits
- A silhouette sees no interior shading, lobe shading on lit faces, or depth order. Overlapping bodies at different distances merge into one outline, which is our renders' main problem here. The "lit faces covered in texture" finding needs an interior measure (Phase 1 band energy).
- Perspective: there is no camera pitch for the photos. Aspect split by frame half gives the same result (upper half medians 0.63 against 0.63). Horizon-band bodies are foreshortened and mostly fall in the invalid haze zone.
- Resolution: bands are computed only where σ ≥ 2 px. Spectrum bodies must be at least 128 px thick at 1600 px wide. I trust σ ≥ 3 px. JPEG 8x8 blocks and the 1 px mask blur touch the D/64 band for bodies thinner than about 200 px. The self-test shows half resolution reproduces every band within 0.01 where σ ≥ 3 px.
- Render path: give `measure.py --alpha` the renderer's own alpha. A per-body ID (or one capture per body) is better still, so that the deck splits into bodies. Everything after segmentation is shared, and the photos keep their colour masks, which carry an error of about 15 % on band energy.
