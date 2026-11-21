// X1 procedural density model: settings and defaults. Two shapers share one trace (procedural/trace.wgsl.ts) and our lighting:
//   'skypro'  Sky Pro (DRG Software Solutions, MIT, used with the author's permission): a coverage weather map and a 64^3 Perlin-Worley
//             noise dilating a height field (cloud top = weather + coverage - 1 + noise * coverage), eroded by the same noise at a smaller
//             scale. Defaults are Tidewater's "Partly cloudy" preset (tidewater/src/sky/SkyProClouds.js PRESET), not the compare pane's.
//   'takram'  The HZD 2015 per-sample model as Takram's three-clouds implements it (MIT): a weather map with one coverage channel per
//             layer, per-layer height gradients, a 128^3 Perlin-Worley shape and a 32^3 Worley detail texture, a 2D turbulence offset.
//             Defaults are Takram's CloudLayers.DEFAULT and CloudsEffect defaults (@takram/three-clouds 0.7.6).
//   'hzd'     H1: the Horizon Zero Dawn reference path. GPU Pro 7's density chain (gp7 p.103-110) on our own bake of the HZD noise set
//             (procedural/hzd/noise.ts, Nubis noise-generator recipe) and the Nubis-era five-field NDF (work/specs/ndf.md). Values no source
//             publishes are marked "ours" below and in work/reports/H1.md.
// See procedural/NOTICE.md for the credits.

import { PROFILE_TABLE_FLOOR, profilePeaks, profileTablesSmoothed } from '../generate/profile-tables';

export type ProceduralShaper = 'skypro' | 'takram' | 'hzd';

/** Sky Pro's shape settings (SkyProClouds.js PRESET.shape / wind / weather). Metres unless noted. */
export interface SkyProShape {
  /** Shell base altitude and thickness. */
  altitude: number;
  thickness: number;
  /** Extinction (1/m) at density 1. */
  density: number;
  /** 0..1. The compare page maps its common coverage to this (mapCoverage.skypro). */
  coverage: number;
  /** Coverage rises by `horizonCoverageAmount` from `horizonCoverageStart` over `horizonCoverageRamp` metres along the ray. */
  horizonCoverageStart: number;
  horizonCoverageRamp: number;
  horizonCoverageAmount: number;
  /** Width of the soft surface in shell fractions, and its falloff per km of height (1 = none). */
  edgeSoftness: number;
  edgeSoftnessFalloff: number;
  /** Tile of the weather map, of the base noise, the base noise's dilation and the erosion noise's scale relative to the base. */
  weatherScale: number;
  baseScale: number;
  baseStrength: number;
  erosionScaleBaseMultiplier: number;
  /** Erosion strength at the base and at the top of a column, and its shape (0 = 1 - noise: billows, 1 = noise). */
  erosionStrengthBase: number;
  erosionStrengthPeak: number;
  erosionShape: number;
  /** Below `baseWeatherHeightEnd` (shell fraction) a column needs weather >= baseWeatherStrength: flat bases. */
  baseWeatherStrength: number;
  baseWeatherHeightStart: number;
  baseWeatherHeightEnd: number;
  /** Tops lean downwind by `windSkew` metres per shell height; `windDirection` (x, z) is normalised. */
  windSkew: number;
  windDirection: [number, number];
  /** Weather fbm (frequency, octaves, seed, contrast) of the main mass and the detail, and the weather bias. */
  weatherMass: [number, number, number, number];
  weatherDetail: [number, number, number, number];
  weatherCoverage: number;
  weatherResolution: number;
}

/** One Takram cloud layer (CloudLayer.ts). `channel` is the weather channel index (0 = r .. 3 = a). */
export interface TakramLayer {
  channel: 0 | 1 | 2 | 3;
  altitude: number;
  height: number;
  densityScale: number;
  shapeAmount: number;
  shapeDetailAmount: number;
  weatherExponent: number;
  shapeAlteringBias: number;
  coverageFilterWidth: number;
  /** densityProfile: expTerm * exp(exponent * h) + linearTerm * h + constantTerm. */
  densityProfile: [number, number, number, number];
}

export interface TakramShape {
  layers: TakramLayer[];
  /** CloudsEffect.coverage. The compare page maps its common coverage to this (mapCoverage.takram). */
  coverage: number;
  /** Metres per weather tile (Takram: localWeatherRepeat 100 over a cube-sphere face, about 100 km). */
  weatherTileMeters: number;
  /** Per-metre repeats (Takram: shapeRepeat 3e-4, shapeDetailRepeat 6e-3) and turbulence tiles per weather tile (20) and its displacement (m). */
  shapeRepeat: number;
  detailRepeat: number;
  turbulenceRepeat: number;
  turbulenceDisplacement: number;
  /** The detail erosion fades out beyond this distance (Takram gates it by a texel-footprint mip, which reaches about 100 km). */
  detailDistance: number;
  /** S6 (H1): false (default) = the turbulence displaces only the detail lookup (hzd15 s37, gp7 p.108); true = Takram's original, shape and detail. */
  turbulenceOnShape: boolean;
}

/** H1: the generated NDF (work/specs/ndf.md "Generation (until W2 lands)"): fBM coverage with islands, a very-low-frequency top type, mild height variation. */
export interface HzdNdfSettings {
  seed: number;
  /** Texels per tile edge, and metres per tile (NE p.20 uses 16 km x 16 km). */
  resolution: number;
  tileMeters: number;
  /** Coverage: a 4-octave periodic fBM from `coverageCells` cells per tile (H5: 6 -> 9, more separate bodies), plus a 2-octave island gate from `islandCells` (weight `islandWeight`),
   *  mapped linearly from coverageLo..coverageHi onto 0..1 (a gradual field: the coverage remap of noise x gradient shapes the clouds). */
  coverageCells: number;
  islandCells: number;
  islandWeight: number;
  coverageLo: number;
  coverageHi: number;
  /** Top type: a 2-octave fBM from `typeCells` cells per tile, mapped onto typeMin..typeMax. */
  typeCells: number;
  typeMin: number;
  typeMax: number;
  /** Bottom type: the field's centre (with bottomTypeRange 0 and bottomTypeCorrelation 0, the constant of H1-F1). 0 = sharp-onset, flat,
   *  crisp base; 1 = slow, ragged base (n3.md §7a). Read by the 'tables' profile only (the Nutshell profiles have no bottom axis). */
  bottomType: number;
  /** Column base and top as fractions of the layer, each varied by +- heightVariation (a 2-octave fBM from `heightCells` cells per tile). */
  minHeight: number;
  maxHeight: number;
  heightVariation: number;
  /** F2: cells per tile of the height variation (H1-W1: a fixed 3 on the 16 km tile; 6 on the 32 km tile keeps the same feature size). */
  heightCells: number;
  /** H6, N17 p.53-58: the coverage footprint. 0 = R, Perlin fBM ("connected formations", H1-H5); 1 = G, Perlin-Worley ("isolated islands with
   *  connective tissue": the Perlin fBM dilated by an inverted Worley fBM, gp7 p.106's remap in 2D); between = a mix (N17: the artist picks one).
   *  `worleyCells` = cells per tile of the footprint's first Worley octave (ours; N17 gives no frequencies). */
  footprint: number;
  worleyCells: number;
  // ---- W1 weather map (work/reports/W1.md). Own block: the map recipe, the authored-map input. ----
  /** W1: the generator recipe. 'h6' = the H1-H6 map above (footprint fBM + island fBM, summed, mapped coverageLo..coverageHi: one gradual field
   *  everywhere). 'n17' = Nubis 2017 (n17 p.54-58): coverage = gate x footprint. The gate is one low-frequency noise ("large regions where air
   *  masses overlap and clouds are allowed to form", p.55): clear where it is 0, open where it is 1. The footprint is the R/G choice above
   *  (`footprint` 0 Perlin "connected", 1 Perlin-Worley "isolated islands", p.56-57) from `coverageCells`, mapped footLo..footHi. Type: as h6
   *  (typeCells, typeMin..typeMax) with `typeContrast` sharpening it into areas (p.58 "another low frequency noise"). Heights as h6. */
  recipe: 'h6' | 'n17';
  /** n17 gate: a 4-octave fBM from `gateCells` cells per tile (p.55 shows 3-4 open regions per map side), smoothstep(gateLo, gateHi) of it. */
  gateCells: number;
  gateLo: number;
  gateHi: number;
  /** n17 footprint: the 4-octave Perlin fBM (about +-0.5) mapped footLo..footHi onto 0..1 before the Perlin-Worley carve. */
  footLo: number;
  footHi: number;
  /** n17 Perlin-Worley footprint (`footprint` > 0): the inverted Worley lifts the footprint by islandGain x (w - 0.5), round islands at the
   *  cells (a dilation, as the 3D Perlin-Worley; h6's carve halved the coverage). */
  islandGain: number;
  /** n17 type: the type fBM's gain about its middle before typeMin..typeMax (1 = h6's 1.6x; higher = distinct type areas, sharper borders). */
  typeContrast: number;
  /** W1 authored map: a URL of an RGBA PNG holding the NDF's layer 0 (R coverage, G top type, B bottom type, A ignored; 8-bit linear, not sRGB).
   *  '' = none. Loaded by createProceduralClouds (procedural/index.ts), resampled (bilinear, wrapping) into the NDF; the image's centre sits at the
   *  world origin and it spans `tileMeters`. `heightImage` optionally replaces layer 1 (R min height, G max height); without it the heights are the
   *  recipe's. Example maps: assets/clouds/ndf/ (served at /clouds/ndf/). */
  image: string;
  heightImage: string;
  // ---- W2 influence mask (NE22 p.69, p.75): a painted map blended OVER the generated one. ----
  /** W2: how a painted map (`image`, or the painter's live upload) meets the generated one. 'replace' = the painted fields replace the generated
   *  layers outright (W1, kept). 'influence' (default) = blended over the generated map by a painted influence mask, per field: 0 = generated,
   *  1 = painted. It only differs from 'replace' when a mask exists (`maskImage`, R channel, or the painter's influence channel); without a mask
   *  the behaviour is 'replace', unchanged. */
  paintBlend: 'replace' | 'influence';
  /** W2: URL of the influence mask PNG (R channel, 8-bit linear; same centring and span as `image`). '' = none. */
  maskImage: string;
  /** W2: per-field gain on the mask (0..1): coverage, the two types, the heights. 1 = the mask as painted; 0 = that field stays generated. */
  paintCoverage: number;
  paintTypes: number;
  paintHeights: number;
  // ---- STORM1: the default storm area written into the generated map (layer 1, B). ----
  /** STORM1: amount (0..1) of the default storm blob in the generated map: a ragged disc, 1 at its core, 0 at its rim. 0 = none. It only DOES anything
   *  when the HZD shaper's `stormStrength` > 0 and `stormSource` is 'map'. A painted storm channel (painter) or `heightImage`'s B replaces it where painted. */
  stormBlob: number;
  /** STORM1: the blob's centre (world metres in the map's own frame: it moves with the map under ndfMotion 'drift') and radius (m, to the rim). */
  stormX: number;
  stormZ: number;
  stormRadius: number;
  // ---- F2: per-area cloud bases (work/reports/F2.md). Both recipes. ----
  /** F2: the bottom type varies by area: bottomType + bottomTypeRange x a 2-octave fBM (about +-0.5) from `bottomTypeCells` cells per tile,
   *  plus bottomTypeCorrelation x (the column's top type within typeMin..typeMax - 0.5), clamped 0..1. Negative correlation pairs crisp bases
   *  with cumulus and soft, ragged ones with stratiform types: NE p.27 shows its cumulus field at bottom type 0 (flat, crisp undersides; ne22
   *  p.26-28 gives no other pairing), and the photos' stratus and stratocumulus have diffuse or broken bases (photo-species-specs.md). The
   *  pairing strength, range and cells are ours. bottomTypeRange 0 and correlation 0 = the constant bottomType (H1-F1). */
  bottomTypeRange: number;
  bottomTypeCells: number;
  bottomTypeCorrelation: number;
  // ---- CI1: the thin-cloud (cirrus) fields in the map's two spare alpha channels (NE22's own thin-cloud NDF). ----
  /** CI1: the cirrus coverage field written into the map (layer 1, A): a 3-octave fBM from `cirrusCells` cells per sampled cirrus tile (the cirrus layer reads the map `cirrus.mapScale` times larger than the low clouds), 0.5 +- `cirrusContrast` x fBM. Read only while `cirrus.source` is 'map'. */
  cirrusCells: number;
  /** CI1: the cirrus type field (layer 0, A, stored as 0.1 + 0.9 x type so 0 means "no data"): a 2-octave fBM from `cirrusTypeCells` cells per sampled cirrus tile, the same contrast. The layer moves its type about its own `type` by `cirrus.mapTypeRange` x (field - 0.5) x 2. */
  cirrusTypeCells: number;
  cirrusContrast: number;
}

/** H1: the HZD reference shaper (GPU Pro 7 chain). Metres unless noted. */
export interface HzdShape {
  /** The cloud layer: NDF min/max height map into it. GP7 p.119 renders a shell 1.5 km up and 3.5 km thick. */
  layerBottom: number;
  layerTop: number;
  /** Extinction (1/m) at density 1 (ours, tuned). F2: 0.5 -> 0.8 with the tables profile, whose lower body values (the profile peaks at 1 at
   *  one height, the Nutshell trapezoids hold 1 over the middle) gave softer, less textured flanks at 0.5 (work/captures/F2/s3/ext). H6's
   *  Nutshell look: profileMode 'nutshell' with extinction 0.5. */
  extinction: number;
  /** HZD 2015's artist override (hzd15 s38-42): coverage +-0.5 and type +-1, added to the NDF. The compare page drives coverageBias. */
  coverageBias: number;
  typeBias: number;
  /** gp7 p.107: multiply by coverage after the remap ("small clouds lighter"). The remap itself uses HFW p.17's sign (threshold 1 - coverage).
   *  H5: off by default, as HFW p.17 and hag eq 12 print the remap without it. With the multiply the density is base + coverage - 1, under 0.15
   *  at our NDF's coverage (p99 0.57), so gp7's fixed 0.2 erosion cap ate small clouds and thinned bodies to popcorn (H1's stage 2 -> 3). */
  coverageMultiply: boolean;
  /** How the three Nutshell gradients (nut s7-8) blend by type; the law is unpublished. 'points' lerps the four stops (n17.md's reading, one
   *  flat core); 'curves' is GP7 p.103's "weighted sum" with tent weights. H5: 'curves' by default (it is what GP7 p.103 writes): between the
   *  types the profile is a sum of two humps, which separates the bodies and rounds their tops (H5 step 2 captures). */
  typeBlend: 'points' | 'curves' | 'hybrid';
  /** World size of one tile of the shape (128^3), detail (32^3) and curl (128^2) textures, and the curl displacement (none published; ours).
   *  H5: shape tile 4 -> 6 km: lobes 1.5x larger and rounder (lobe/body band energy 0.21 -> 0.15; GP7 Fig 4.16 0.09); needs the cubic read. */
  shapeTile: number;
  detailTile: number;
  curlTile: number;
  curlStrength: number;
  /** The detail erosion fades out from 0.75x to 1.25x this distance (cheap-then-expensive, hzd15 s77-80). */
  detailDistance: number;
  /** Texture LOD bias (0: one output pixel's footprint per texel). */
  mipBias: number;
  /** hzd15 s35-36 base fade before erosion: density x remap(h, 0, baseFadeHeight, baseFadeMin, 1) (constants unpublished; ours). */
  baseFadeMin: number;
  baseFadeHeight: number;
  /** 'gp7': mix(fbm, 1-fbm, sat(h*10)) * 0.2 (p.108-109). 'hag': Häggström's sat(h*5) and 0.35 exp(-0.75 coverage) (hag eq 13-16). */
  erosionLaw: 'gp7' | 'hag';
  /** GP7 p.109-110 wind: tops lean `cloudTopOffset` metres along `windDirection` (x, z; normalised), and the noise rises by `upwardBias` per metre of drift. */
  windDirection: [number, number];
  cloudTopOffset: number;
  upwardBias: number;
  /** W1 map-advection policy (weather.md §5, top-20 rank 20). Speeds are fractions of the wind offset; "anchored" = the noise moves with the
   *  map (SD7's volume-local anchor: the detail is carried with the cloud), "free" = it scrolls at its own `shapeSpeed` / `detailSpeed`
   *  (gp7 p.109: "each noise its own speed").
   *    'drift'  (default, owner 2026-10-10) the map moves at `ndfDrift`, both noises free: slow weather, noise flowing over it.
   *    'static' Nubis/HZD (n17 p.45, nut s15, ne22 p.37): the map stays, both noises free: formations persist, detail streams through them.
   *    'rigid'  Häggström (hag p.34): map, shape and detail all at `ndfDrift`, no upward bias: clouds carried whole, nothing evolves.
   *    'shape'  split: map and shape anchored, detail free (detailSpeed 0 = the detail stays in the world while the cloud moves through it).
   *    'detail' split, the reverse: map and detail anchored (the detail rides with the cloud), shape free (the forms evolve as they move). */
  ndfMotion: 'drift' | 'static' | 'rigid' | 'shape' | 'detail';
  /** C1: what the Nubis lighting reads as the in-scatter profile and depth in cloud. 'standin' = min(pow(depth/profileDepth, 1.05), coarse) with the
   *  proxy depth; 'exact' = the analytic dimensional profile (coverage x height gradient, NE22) and depth = (P - tau) / |dP/dy| (as the sky layer's f/|grad f|). */
  lightProfile: 'standin' | 'exact';
  ndfDrift: number;
  shapeSpeed: number;
  detailSpeed: number;
  /** Build stage, to compare with gp7 Fig 4.13 -> 4.14 -> 4.16: 1 base shape x gradient with the coverage remap; 2 + coverage multiply and base
   *  fade; 3 + detail erosion (the full chain). */
  stage: 1 | 2 | 3;
  /** Noise texture format (procedural/hzd/noise.ts): RGBA8 as HZD, or rgba16float (SD8). Changing it re-bakes the noise. */
  noiseFormat: 'rgba8unorm' | 'rgba16float';
  /** H5 (ours, not in the Nubis tool): the R channel's coarse carving remaps (10 and 20 cells per tile, 0.5 F1 / 0.2 F1) and fine dilating
   *  remaps (85 and 165 cells) scaled by these factors (1 = the tool), and the smooth-min width of R's Worley terms (0 = the tool's hard F1;
   *  > 0 rounds the creases along the Voronoi faces). Changing any re-bakes the noise. */
  noiseCarve: number;
  noiseFine: number;
  noiseSmooth: number;
  /** H5 (ours): sub-samples per texel edge of the shape bake: 1 point-samples as the tool, 2 box-filters 2x2x2 (the tool's finest terms alias). */
  noiseSupersample: number;
  /** H5: the 32^3 detail texture's recipe (procedural/hzd/noise.ts): 'nubis' = H1's multi-octave Worley (ours), 'gp7' = one inverted Worley
   *  octave per channel at 4 / 8 / 16 cells per tile (gp7 p.102 "three more Worley octaves", Fig 4.9). Changing it re-bakes. H5 default 'gp7':
   *  its channels have std 0.17 (nubis 0.10) and coarser cells, so the 0.2 erosion cuts visible billows at the edges (GP7 Fig 4.14 -> 4.16). */
  detailRecipe: 'nubis' | 'gp7';
  /** H5 (ours): the same B-spline read for the 32^3 detail texture, nearer than this (m); 0 = trilinear. */
  detailCubicDistance: number;
  /** H5 (ours; default 30 km, +0.25 ms at ultra): the shape (and, see detailCubicDistance, detail) textures are read with a tricubic B-spline (8 trilinear taps) on full samples nearer than this (m) while
   *  magnified; trilinear beyond, and everywhere at 0. Removes the terraces trilinear filtering leaves on flanks and bases (H1 "faceted flanks"). */
  shapeCubicDistance: number;
  /** H5: exponent on the final density (1 = GP7: none; ne22 p.105 sharpens its envelope with 0.27). Below 1 lifts the edge ramp: crisper rims. */
  densityPow: number;
  /** H5 (ours): contrast of the Perlin-Worley (R) about 0.5 before the dilation, R' = 0.5 + (R - 0.5) * shapeContrast (1 = the Nubis tool's
   *  R, std 0.105). The tool keeps R in [0.083, 0.917] "because of Nubis' density model" (noise.md); HZD's own range is not published. */
  shapeContrast: number;
  /** H5, hzd15 s45 (p047 diagram, s43 note): the horizon ring. From `ringStart` to `ringEnd` metres (horizontal distance from the camera) the
   *  NDF's coverage is pulled toward `ringCoverage` and its type toward `ringType` ("about 50 %", "toward cumulus": horizon clouds poke above the
   *  mountains), and nothing is drawn beyond `ringEnd` (HZD's 35 km radius). ringStart 0 = off. The pull is linear over the band (the slide
   *  shades the disc dark to light; ours). Default on (15 / 35 km); ringCoverage 0.4 is "about 50 % cover" on our NDF scale (no *cov, base mean
   *  0.62: cloud where base x gradient > 1 - coverage), ours. The last 20 % of the band fades the coverage to 0 (ours, no hard line at 35 km),
   *  and the whole ring fades out as the camera climbs from half the layer base to the base (ours: HZD is a ground-level view). */
  ringStart: number;
  ringEnd: number;
  ringCoverage: number;
  ringType: number;
  /** H6 (ours): the ring's coverage fade to 0 starts at this fraction of ringEnd (H5: 0.8). */
  ringFadeStart: number;
  /** H6, gp7 p.109: the detail erosion's maximum, `Remap(base_cov, modifier * erosionStrength, 1, 0, 1)` (GP7 0.2; the 'hag' law overrides it). */
  erosionStrength: number;
  /** H6: the wispy-to-billowy switch, mix(fbm, 1 - fbm, sat(h / wispyHeight)) (gp7 p.108: 0.1, i.e. h * 10; hag eq 14: 0.2). */
  wispyHeight: number;
  /** H6: where the detail erodes. 'gp7' = after the coverage remap (p.109); 'hfw' = HFW p.15-17's recap of HZD: the detail erodes the low-frequency
   *  noise first, `remap(lf, strength * modifier, 1, 0, 1)`, then the coverage remap of (noise x profile), so the erosion scales with the coverage
   *  ramp like the base noise does (no thin edge band). */
  erosionOrder: 'gp7' | 'hfw';
  /** H6 (ours, flat-cut tops): widen the top falloff of the type gradient: the fall starts at mix(c, b, topRound) instead of the Nutshell stop c
   *  (0 = the shipped stops; Häggström's SA falls over 0.2 wh..wh, hag eq 6, i.e. about topRound 0.8 for cumulus). */
  topRound: number;
  /** H6 (ours, terraces): smoothstep ramps in the trapezoids instead of linear (C1 at the stops, so the threshold draws no crease line). */
  profileSmooth: boolean;
  /** H6 (flat-cut tops; hag p.13 "high wh toward a cloud's centre gives rounded clouds", ne22 p.20 per-column max height): the column top falls
   *  with the coverage, top = min + (max - min) * mix(1, sat(cov / heightCoverageRef), heightFromCoverage). 0 = off (H5). Constants ours. */
  heightFromCoverage: number;
  heightCoverageRef: number;
  /** H6 (connective material; gp7 p.107 "small clouds lighter", applied at hag eq 16's DA position, i.e. after the erosion so it cannot eat
   *  small clouds): density x sat(cov / coverageDensityRef)^coverageDensityPow. 0 = off (H5). Constants ours. */
  coverageDensityPow: number;
  coverageDensityRef: number;
  /** H6 (connective material; n3 s162's wispy "skirt" between formations, ours as a formula): below the coverage threshold a thin veil continues
   *  each body for `veilWidth` (in base x gradient units) at most `veilDensity` (density units), only below `veilHeight` (h), streaked by the
   *  detail fBM (veilNoise). 0 = off. Cost: the march takes fine steps and light taps through the veil (default 0.08 / 0.04 / 0.25 within
   *  veilDistance 15 km: sky layer about +2.5 ms at ultra; 0.12 / 0.03 / 0.3 about +4 ms; unbounded (the H6 step-1 to step-5 captures) +8-10 ms). */
  veilWidth: number;
  veilDensity: number;
  veilHeight: number;
  /** H6: the veil is multiplied by its noise (veilNoise) to this power (higher = streakier, ours). */
  veilWisp: number;
  /** H6 (ours, cost): the veil fades out from half this distance (m) to it; a ray along the layer otherwise marches fine steps through it to the horizon. */
  veilDistance: number;
  /** H6: what streaks the veil: 'detail' = the curl-displaced detail fBM (wisps; one trilinear detail read per veil sample), 'shape' = the shape
   *  texture's finest Worley channel (no extra read; softer smudges). */
  veilNoise: 'detail' | 'shape';
  /** H7 (connective flow as skirts; the judges read H6's veil as a uniform haze, smog from above): 'veil' = H6's dilated lower-flank shell;
   *  'skirt' = n3 s162's flat, wispy skirt around each formation's base: the body's own column footprint (base noise against the threshold at
   *  gradient 1) dilated by veilWidth, plus the footprint of the body `skirtTrail` metres upwind (so it trails downwind; negative = upwind),
   *  in a thin band of the column that rises to full at `skirtPeak` (h) and is gone at veilHeight, streaked by the detail fBM stretched
   *  `skirtStretch` : 1 along the wind. Shape and constants ours (n3 gives the skirt as an authored piece, no formula). */
  skirtMode: 'veil' | 'skirt';
  skirtTrail: number;
  skirtStretch: number;
  skirtPeak: number;
  /** H7: the skirt's wisps read the detail texture this many times coarser than detailTile (large soft wisps; the 75 m cells read as foam),
   *  and the trailing footprint is this many veil widths wide (ours). */
  skirtScale: number;
  skirtTrailWidth: number;
  /** H7: the skirt noise below this value is cut to 0 (remapped gap..1 to 0..1): gaps of blue between the wisps, and no fine march steps there. */
  skirtGap: number;
  /** H7 wispy bottoms (gp7 p.108 curl at the bottoms, hzd15 s37 "invert the Worley at the base for wisps"): below wispyHeight the curl
   *  displacement grows up to `bottomCurl` x at h = 0 (1 = gp7's (1 - h) only), `bottomCurlDown` of it vertical (the curl's third component:
   *  hanging shreds), and the erosion strength rises from `wispyStrength` at h = 0 to erosionStrength at wispyHeight (= erosionStrength: gp7's
   *  single value). All ours. */
  bottomCurl: number;
  /** H7 wispy bottoms: a second erosion below wispyHeight in gp7's order (after the coverage remap, so it frays the thin base ramp into wisps
   *  while the hfw order keeps flanks and tops intact), strength at h = 0 falling to 0 at wispyHeight. 0 = off. Ours. */
  bottomErosion: number;
  /** H7 lobe rung (the missing middle step between the body and the grain; santa D1, frog F1 ~3.5x per level): a billowy erosion of the
   *  low-frequency noise by the detail texture's coarsest channel read with its own tile `lobeTile` (cells of lobeTile / 4 m), strength
   *  `lobeStrength` (0 = off), fading in from wispyHeight to `lobeFull` (h: textured tops, smooth bellies), tricubic within
   *  detailCubicDistance when `lobeCubic`. Ours. */
  lobeTile: number;
  lobeStrength: number;
  lobeFull: number;
  lobeCubic: boolean;
  /** H7: the lobe strength scales with sat(coverage / lobeCoverage)^2, so small thin-coverage clouds are not shattered into pellets (0 = no scaling). */
  lobeCoverage: number;
  /** H7 base lumps (santa D3, frog F10: lobes hanging below the base; against H6's flat stratus slab and base shelves): the base ramp of the
   *  height gradient is read up to 2 x baseLump (h) higher where the shape's 600 m Worley fBM (G) is above its mean, so the underside follows
   *  the lobes. 0 = off (one base plane per gradient, as HZD). Ours. */
  baseLump: number;
  bottomCurlDown: number;
  wispyStrength: number;
  // ---- F1: cloud types and forms (this block only; packed by packHzdForms) ----
  /** F1 step 1 (ne22 p.21-29, n3 s18): the vertical profile (F2: 'tables' is the default). 'nutshell' = the three HZD trapezoids blended by type (H1-H7); 'tables' = NE's
   *  top table(top type, h) x bottom table(bottom type, h), divided by the pair's peak so a full column still peaks at 1 (H4's tables,
   *  generate/profile-tables.ts, reused). The HZD type maps onto the table's top type piecewise linearly through tableTypeStratus (type 0),
   *  tableTypeStratocumulus (0.5) and tableTypeCumulus (1): NE's insets put stratus at 0.07, stratocumulus 0.27, cumulus 0.40 (ne22 p.23-25);
   *  above 0.44 the table's tops are tall and tiered (towering cumulus). */
  profileMode: 'nutshell' | 'tables';
  tableTypeStratus: number;
  tableTypeStratocumulus: number;
  tableTypeCumulus: number;
  /** F2 step 1: where the shader reads the tables. 'storage' (default) = a read-only storage buffer bound beside the NDF (4 bytes per word,
   *  the sky layer's layout); 'uniform' = F1's path, the bytes packed 3 per float into ProcParams.hzLut (5-8 ms slower at ultra on the
   *  M-series GPU: divergent indexing of a 16 KB uniform array, work/reports/F1.md and F2.md). Both read the same bytes with the same bilinear
   *  filter, so they render the same. (A sampled texture would take the trace past the default 16 sampled textures per shader stage.) */
  tableSource: 'uniform' | 'storage';
  /** F1: bottom type = NDF bottomType + bottomTypeBias + bottomTypeVariation x a world-anchored low-frequency field (the shape texture's
   *  Perlin-Worley read flat with a `bottomTypeTile` m tile), clamped 0..1. 0 = sharp, flat, crisp base; 1 = slow, ragged base (n3.md §7a). Ours. */
  bottomTypeBias: number;
  bottomTypeVariation: number;
  bottomTypeTile: number;
  /** F1: the table height the column base maps to (H4: the tables' shared floor 17/64; 0 = the literal mapping). */
  tableFloor: number;
  /** F1 step 2, S7 anvils. n17 p.46-50: coverage = pow(coverage, remap(h, 0.7, 0.8, 1, lerp(1, 0.5, anvilBias))); `anvilClamp` clamps the
   *  exponent to [lerp(1, 0.5, bias), 1] (only the top inflates) instead of the unclamped remap (thins the body below 0.7, fills above 0.9).
   *  hag eq 17: the height gradient ^ sat(remap(h, 0.65, 0.95, 1, 1 - anvilFlatten)) flattens the top ramp into a plate; hag eq 18's density fix
   *  x lerp(1, sat(remap(sqrt(h), 0.4, 0.95, 1, 0.2)), anvilDensityFix) keeps the plate from going opaque (hag fig 12 vs 13). All 0 = off. The
   *  anvil terms act where the column is a storm (storm cell or storm type below); anvilBias also acts everywhere, as N17's weather-state scalar. */
  anvilBias: number;
  anvilClamp: boolean;
  anvilFlatten: number;
  anvilDensityFix: number;
  /** F1 S7: a placed cumulonimbus cell (gp7 p.104 / hzd15 s42: storm -> cumulonimbus type, coverage >= 0.7). Inside `stormRadius` (m) of
   *  (stormX, stormZ) the column takes the cumulonimbus gradient (hzd15 s34 / gp7 Fig 4.10: full 0.08, to 0.74, zero 0.96) or the tallest
   *  table type, coverage 0.85 falling off radially, and its top rises to `stormTop` (m). Above h 0.7 the coverage footprint widens to
   *  `anvilSpread` x the radius and its centre shears `anvilShear` m downwind (photos §4: anvil 2-4x the column, sheared one way). `stormStrength`
   *  0 = off. `stormTypeStart` < 1: NDF top types above it become storms too (type-driven, ramping to full at type 1). Constants ours. */
  stormX: number;
  stormZ: number;
  stormRadius: number;
  stormStrength: number;
  stormTop: number;
  anvilSpread: number;
  anvilShear: number;
  stormTypeStart: number;
  /** STORM1: where the storm column comes from. 'map' (default) = the NDF's storm channel (layer 1 B: the generated default blob `ndf.stormBlob`, or
   *  the painter's storm channel), `stormStrength` is its gain (0 = off); the column narrows upward, the anvil spreads `anvilSpread` x the blob radius
   *  sideways and `anvilShear` m downwind from it; `ndf.stormX/Z/Radius` give the default blob's place and the lightning's. 'cell' = F1's analytic
   *  placed cell at (stormX, stormZ) with `stormRadius`, kept. */
  stormSource: 'map' | 'cell';
  /** STORM1 anvil cirrus: a thin fibrous plate on top of the anvil, continuing the anvil's footprint `anvilCirrusLength` m further downwind (NE22
   *  p.159-163: a cirrus formation centred on the storm). `anvilCirrus` is its density (0 = off), `anvilCirrusDepth` its thickness (m, from the
   *  storm top down), `anvilCirrusFiber` the elongation of its fibres along the wind. Needs a storm (either source). */
  anvilCirrus: number;
  anvilCirrusLength: number;
  anvilCirrusDepth: number;
  anvilCirrusFiber: number;
  /** STORM1 lighting: `stormDensity` scales the extinction inside the storm (1 = off; denser reads darker), `stormDark` (0..1) dims the light inside the storm
   *  (up to 0.85 x: dark, most at the column and under the anvil), `stormGlow` (0 = off) is an internal lightning glow, flashing `stormFlashRate` times per second (a flash
   *  term in the trace: a random place inside the storm, a short strobing envelope, radius 1.5 km). */
  stormDensity: number;
  stormDark: number;
  stormGlow: number;
  /** STORM1: flashes per second of the internal lightning (0 = one flash held on, for look development). */
  stormFlashRate: number;
  /** STORM1: the map tiles, so a storm in it would repeat every `ndf.tileMeters`. true (default) = the storm channel counts only in the one tile around
   *  the world origin (fading over its outer 12 %); false = it repeats with the map. */
  stormSingle: boolean;
  /** ST2: how the anvil plate's footprint is built from the storm area. 'smooth' (default) = a blurred dilation (16 taps averaged over an elliptical kernel
   *  centred downwind: one smooth teardrop plate, a lens-thin overhanging edge); 'taps' = STORM1's soft union of 8 shifted taps (lumpy, kept). */
  stormAnvilShape: 'smooth' | 'taps';
  /** ST2 rotation (NE22 p.147-158, HFW p.59-62): the storm's detail noise turns about the storm centre in six nested rings, each its own speed (falling
   *  outward, x0.6 per ring), a per-ring twist and a blended overlap between rings. This is the inner ring's speed in degrees per second (0 = off, the
   *  default). Costs a second detail read in the overlap bands. Needs a storm; the sky's temporal blend smears fast rotation (HFW's "pixel soup"). */
  stormRotation: number;
  /** F1 step 3: two sheet layers with their own forms (photos §5-7, web18 Table 2, ne22 p.15-16): 'altocumulus' = jittered cells (the shape
   *  texture's Worley fBM read flat, elongated `cellElongation`:1 along the wind, cell size `cellSize` m) under a large-scale coverage mask,
   *  flat bases and lumpy domed tops; 'altostratus' = a soft mottled sheet; 'stratus' = a flat-based low deck with a gently lumpy top.
   *  Each: base (m), thickness (m), coverage (0..1), extinction (1/m at density 1), detail erosion. 'off' = not drawn. Ours. */
  midForm: 'off' | 'altocumulus' | 'altostratus' | 'stratus';
  midBottom: number;
  midThickness: number;
  midCoverage: number;
  midCellSize: number;
  midElongation: number;
  midExtinction: number;
  midErosion: number;
  /** L3: how the mid slot's altocumulus / altostratus is drawn. 'volume' = F1's volume at every distance (clips at the march limit, ~15-35 km);
   *  'layer' = only the 2.5D thin-cloud layer (cirrus/ model: baked round and wispy noises, sun taps, curvature) at the slot's altitude, type and coverage
   *  read per area from the weather map; 'hybrid' = the volume close to the camera cross-fading to the layer between `midLayerFadeStart` and `midLayerFadeEnd`.
   *  Applies to the mid slot's altocumulus / altostratus only (a stratus form there and the deck slot stay volumes). */
  midLayerMode: 'volume' | 'layer' | 'hybrid';
  /** PF1: empty-space skipping in the coarse march, from a bounds grid of the weather map (64^2 cells of the map tile: the largest coverage and the lowest base and
   *  highest top over each cell). A stretch of ray inside a cell where the main layer cannot be (no coverage, or all above the cell's tops or below its bases), and
   *  no sheet, fractus or storm can be either, is walked without sampling. 'off' = every stride samples; 'exact' = the same strides and the same step budget as 'off', so
   *  the image is the same and only the samples are saved; 'free' = also does not charge the skipped strides to maxSteps, so rays reach further (faster, can add far cloud). */
  emptySkip: 'off' | 'exact' | 'free';
  /** PF1: with emptySkip on, a cell whose largest weather-map coverage is at most this counts as empty. 0 = only cells with no coverage at all (the skip cannot change the image).
   *  Above 0 it is lossy: the thin wisps that a low coverage still lets through the noise's highest peaks are skipped too (0.1 skips about a tenth of the default map's cells). */
  emptySkipCoverage: number;
  /** L3: hybrid cross-fade distances (m, camera to the cloud): the volume is full inside the start and gone beyond the end; the layer the reverse. */
  midLayerFadeStart: number;
  midLayerFadeEnd: number;
  /** L3: 0..1 how far the weather map (NDF) moves the layer's coverage (by its coverage), type and veil (by its top type: cumuliform = altocumulus cells, stratiform = a sheet). 0 = global values. */
  midLayerNdf: number;
  /** L3: the layer's vertical optical depth where the noise is 1 (the volume's is extinction x thickness, 20+, but only the cell cores reach it). */
  midLayerOpticalDepth: number;
  /** L3: added to midCoverage for the layer (the volume's coverage is a threshold on cells; the layer's is an exponent plus a fade-in, so it needs more for the same cover). */
  midLayerCoverageBoost: number;
  deckForm: 'off' | 'altocumulus' | 'altostratus' | 'stratus';
  deckBottom: number;
  deckThickness: number;
  deckCoverage: number;
  deckCellSize: number;
  deckElongation: number;
  deckExtinction: number;
  deckErosion: number;
  /** F1 step 4: fractus attached to each body (both judges after H7). Ragged shreds that leave each cloud's belly line (h `fractusBelly`) and
   *  hang up to `fractusDrop` m below it, trailing up to `fractusTrail` m downwind: a sample looks `fractusTaps` taps upwind for a body base
   *  (the coarse body at belly height), so shreds exist only under and behind real bodies and never above the belly (tops stay crisp). The
   *  shreds are the detail fBM read `fractusScale` x coarser, curl-displaced `fractusCurl` x. `fractusDensity` 0 = off; none beyond
   *  `fractusDistance` m (cost). Ours (n3 s162's skirt and hzd15 s26's wispy bottoms as a per-body formula). */
  fractusDensity: number;
  fractusTrail: number;
  fractusDrop: number;
  fractusBelly: number;
  fractusScale: number;
  fractusCurl: number;
  fractusTaps: number;
  fractusDistance: number;
  // ---- end F1 ----
  // ---- N1: Nubis Cubed noise (this block only; packed by packHzdN3) ----
  /** N1 (n3 s89-90, s95-109): the noise that erodes the coarse density. 'hzd' = the HZD set (the 32^3 Worley detail, `detailRecipe`, read
   *  as gp7 p.108's wispy / billowy modifier); 'nubis3' = the pack's 128^3 Nubis Cubed noise (assets/clouds/noise: R/G LF/HF Curly-Alligator,
   *  B/A LF/HF Alligator), which Guerrilla made because inverted Worley "looked like packed spheres". It is the runtime's up-rez noise, already
   *  bound with the volume (cloudNoise), so no binding changes. With 'nubis3' the erosion is the deck's up-rez (density.wgsl.ts):
   *  wispy = lerp(R, G, P), billowy = lerp(0.3 B, 0.3 A, P^0.25), noise = lerp(wispy, billowy, T) (+ the HHF fold near the camera), then
   *  ValueErosion(P, noise) = sat((P - noise) / (1 - noise)) on the coarse density P (the dimensional profile after the coverage remap). The
   *  veil, skirt, lobe rung, sheets and fractus keep reading the HZD detail texture. N1 step 3: 'nubis3' is the default (H1-F2: 'hzd'). */
  noiseSet: 'hzd' | 'nubis3';
  /** N1: world size (m) of one tile of the pack noise (the voxel path: 100 m, `uvw = p * 0.01`, s92). Ours: sky-scale bodies want larger. */
  n3Tile: number;
  /** N1: the erosion noise x this before the erosion (1 = the deck). */
  n3Strength: number;
  /** N1 detail type T (0 wispy, 1 billowy; ours, the deck reads it from the NVDF): T = sat(h / wispyHeight) x lerp(n3StratusType, 1,
   *  sat(2 type)): wispy below wispyHeight in every column (hzd15 s37, gp7 p.108: wisps at the base, billows above; n3 s83-88: falling
   *  density curls), and stratus (HZD type 0) partly wispy throughout, stratocumulus and cumulus billowy. */
  n3StratusType: number;
  /** N1: the HHF fold (s102-104: the HF channels folded twice, x4 frequency, no extra fetch) blends in over n3HhfDistance / 3 .. n3HhfDistance
   *  metres from the camera (the deck: 50-150 m at the 100 m tile). 0 = off. */
  n3HhfDistance: number;
  /** N1: the deck's density scale S for the sharpen after the erosion, d = pow(d S^4, lerp(0.3, 0.6, S^4)) (s107, s109). 0 = no sharpen
   *  (the eroded density as is); 1 = the deck at full density scale (pow 0.6). */
  n3Sharpen: number;
  /** N1: the curl displacement of the pack read, x the HZD detail's (curlStrength (1 - h)). 0 = none, as the deck (Curly-Alligator has its curl baked in). */
  n3Curl: number;
  /** N1 step 2: the shape noise's dilating Worley fBM (gp7 p.106: base = remap(R, -(1 - fbm), 1, 0, 1)). 'hzd' = the shape texture's G/B/A
   *  Worley fBM (inverted Worley: round lobes, the body-scale "packed spheres"); 'nubis3' = the pack's billows instead, 1 - (0.625 B + 0.375 A)
   *  (bright Alligator cells), read with an `n3ShapeTile` m tile and matched to the Worley fBM's mean and spread (0.69, 0.10; the pack's
   *  0.608, 0.157), so the coverage threshold keeps its meaning. The Perlin-Worley R, the base lumps and the veil keep the HZD texture. */
  shapeNoise: 'hzd' | 'nubis3';
  n3ShapeTile: number;
  // ---- end N1 ----
  // ---- P2.5a: edge character (packed by packHzdEdge; shaper.wgsl.ts hzdEdgeCrisp) ----
  /** P2.5a (the owner's photos): the edge's sharpness depends on where on the cloud and which way it faces. A crispness c (0 soft .. 1 crisp)
   *  per sample: c = sat(top x lerp(1, 2 lead, |edgeLead|)), top = smoothstep(edgeTopLo, edgeTopHi, h) (crisp tops, soft bases), lead from
   *  the coverage gradient along the wind (1 on the side the body moves toward). c then steers the detail erosion: the noise kind (billowy
   *  toward c 1, wispy toward 0, instead of by height alone), its strength x lerp(edgeSoftErosion, edgeCrispErosion, c), and the eroded
   *  density's exponent lerp(edgeSoftPow, edgeCrispPow, c) (< 1 lifts thin density: a hard, opaque edge; > 1 thins it: soft, translucent).
   *  The shape does it, not the lighting. 0 = off (the image as before). */
  edgeCharacter: number;
  /** P2.5a: h (0 base .. 1 top) where the crispness starts / is full. */
  edgeTopLo: number;
  edgeTopHi: number;
  /** P2.5a: metres up- and downwind the coverage is read at for the facing (lead). */
  edgeProbe: number;
  /** P2.5a: +1 the leading side (moving into new air) is crisp and the wisps trail; -1 flips it; 0 = by height only. */
  edgeLead: number;
  /** P2.5a: the coverage difference (upwind - downwind) that makes a side fully leading or trailing. */
  edgeLeadRange: number;
  /** P2.5a: the erosion strength factor at c = 0 (soft) and c = 1 (crisp). */
  edgeSoftErosion: number;
  edgeCrispErosion: number;
  /** P2.5a: the exponent on the eroded density at c = 0 (soft) and c = 1 (crisp). P2.5b: edgeSoftPow is the soft shaping; edgeCrispPow is
   *  used only when edgeCrispGain is 0 (the P2.5a pow(d, lerp(softPow, crispPow, c)), kept as an option: it hazed the tops). */
  edgeSoftPow: number;
  edgeCrispPow: number;
  /** P2.5b: the hard shaping at c = 1: sat((d - edgeCrispCut) / (1 - edgeCrispCut) x edgeCrispGain) (cuts the thin outer haze and steepens
   *  the ramp: an opaque edge); the density is lerp(d ^ edgeSoftPow, hard, c). edgeCrispGain 0 = the P2.5a pow shaping. */
  edgeCrispCut: number;
  edgeCrispGain: number;
  /** P2.5b: with edge character on, the lobe rung (lobeTile) erodes at edgeLobes x c instead of lobeStrength x the height ramp: rounded
   *  middle-size lobes where the edge is crisp, none where it is soft. In both detail branches. 0 = no edge lobes. */
  edgeLobes: number;
  /** P2.5d: what "top" means in c. 0 = the column height (smoothstep(edgeTopLo, edgeTopHi, h), P2.5a-c: from the ground nearly every visible
   *  surface sat below it, c = 0); 1 = the surface faces up: up = sat(0.5 + (d - dUp) / edgeUpRange), d the coarse density (before the detail
   *  erosion) and dUp the same edgeUpStep m higher (density falling upward = the upper side of a bulge, at any height). */
  edgeTopMode: number;
  /** P2.5d: metres above the sample the coarse density is read again for the facing. */
  edgeUpStep: number;
  /** P2.5d: the coarse-density drop over edgeUpStep that makes a surface fully upward-facing (half of it: 0.5 + drop / range). */
  edgeUpRange: number;
  /** P2.5e (debug, to test the factors one at a time): a bit mask of what the edge character does. 1 crisp noise kind (billowy by c),
   *  2 crisp erosion strength (edgeCrispErosion by c), 4 crisp hardness (cut and gain by c), 8 crisp lobes (edgeLobes by c), 16 the soft
   *  branch (wispy noise, edgeSoftErosion, ^ edgeSoftPow, no lobes at low c). A factor that is off leaves its part exactly as with the
   *  feature off. 31 = all (the P2.5d behaviour). */
  edgeFactors: number;
  /** P2.5f: the crisp hardness's form. 0 = the cut and gain (edgeCrispCut, edgeCrispGain; default); 1 = pure gain, no cut:
   *  sat(d x lerp(1, edgeSteepGain, c)) (thin density climbs to opaque over a shorter distance; the outer haze turns opaque too). */
  edgeHardMode: number;
  /** P2.5f: the gain at c = 1 for edgeHardMode 1. */
  edgeSteepGain: number;
  // ---- end P2.5a ----
  // ---- P2.3b: tall-cloud top shape (packed by packHzdTop; shaper.wgsl.ts hzdColumnTop) ----
  /** P2.3b: how the column top follows the coverage when heightFromCoverage is on. 0 = the H6 line (x = sat(cov / heightCoverageRef): a
   *  body's top falls linearly to its edge, so tall bodies are cones); 1 = a dome (x -> mix(x, sqrt(1 - (1 - x)^2), topDome): steep at the
   *  edge, flat on top) broken into turrets (x x mix(1, turret field, turretAmount)). The turret field is a 2D Worley over xz (cells about
   *  turretSize m, moving with the weather map). P2.3c: continuous: every nearby cell contributes a rounded dome (radius 0.75 cell +- 25 %,
   *  height 1 - turretDepth r^2, r uniform, so most heads reach full height) and the field is a smooth max of the domes and a floor of
   *  1 - turretDepth, so neighbouring heads meet in a rounded notch, never a step. Both factors are <= 1: the top never exceeds the H6 top.
   *  Constants ours. Cost: 18 hashes per column sample (only with topShape 1). */
  topShape: number;
  /** P2.3b: 0 = the H6 linear x, 1 = the quarter-circle dome. */
  topDome: number;
  /** P2.3b: turret cell size (m). */
  turretSize: number;
  /** P2.3b: per-turret height spread: each head's height is 1 - turretDepth r^2 (P2.3c); 1 - turretDepth is also the notch floor. */
  turretDepth: number;
  /** P2.3b: 0 = one dome per body, 1 = the full turret field. */
  turretAmount: number;
  // ---- end P2.3b ----
  ndf: HzdNdfSettings;
}

export interface ProceduralSettings {
  shaper: ProceduralShaper;
  /** March (Sky Pro "high"): fine step floor (m; it grows with the pixel cone), step cap, light taps (1..7), and the opacity after which light taps use the cheap density. */
  stepMeters: number;
  maxSteps: number;
  lightTaps: number;
  fullLightingAlpha: number;
  /** Ray length cap (m); the density fades out over the last 20 percent. */
  maxDistance: number;
  /** Multiplier on the shaper's extinction (art knob, 1 = the source's). */
  densityScale: number;
  /** Multiplier on the optical depth the light taps see beyond the first 25 m (CloudSettings.lightDensityScale plays this role for the voxel march). */
  lightScale: number;
  /** Depth below the surface (m) over which the in-scatter probability ('profile' of our lighting) ramps from 0 to 1. */
  profileDepth: number;
  /** Debug view: 0 off, 1 step count, 2 first-hit distance, 3 profile at the first hit, 4 hybrid split, 5 (P2.5c) HZD edge crispness c at the first hit (grey = not applied). */
  debug: number;
  /**
   * X3 lighting model. 'octave' (default for this model): the per-sample Frostbite / Takram model (LIGHTING_WGSL cloudOctaveLight: 8 Wrenninge
   * octaves with a two-lobe HG, the sky irradiance / 4 pi along a height gradient, powder, C1's low-sun handoff on the body octaves).
   * 'nubis': our N3 model (cloudInScatterMicro), with the depth below the surface and the in-scatter profile from proxies (`profileDepth`).
   * Both get the same sun (per altitude, with the earth's shadow), sky and optical depths.
   * P1.2d 'fit': the voxel march's fitted model (LIGHTING_WGSL cloudFitLight, CloudSettings fit* constants) with the trace's own tau and
   * skyTau, the same sun and ambient pair; no profile, micro-shadow or edge darkening (P.lit.x = 2).
   */
  lightingModel: 'nubis' | 'octave' | 'fit';
  /** Octave model: powder, radiance *= 1 - powderScale * exp(-extinction * 150 m) (Takram 0.8). */
  powderScale: number;
  /** Octave model: the two-lobe HG (forward g, back g, back-lobe weight; Takram 0.7, -0.2, 0.5) and the gain of the sky ambient (Takram 1). */
  octavePhase: [number, number, number];
  ambientGain: number;
  /**
   * Octave model: weight of the diffusion tail, an isotropic sun term falling as 1 / (1 + 0.11 tau) (two-stream diffuse transmittance), so a
   * cloud in another's shadow keeps the light that diffuses through it instead of the octaves' 5 percent (X1's "drip"). 0 = Takram's model.
   */
  octaveDiffuse: number;
  /**
   * P1.3a: the sun taps stop once their optical depth reaches this (the remaining cone taps and all far taps are skipped). 0 = auto: 32 for
   * 'nubis' and 'octave' (their exp(-tau) cannot tell 32 from more), no cap for 'fit' (its multiple scattering, 1 / (1 + fitK tau), can: the
   * early stop printed flat, hard-edged patches on shaded bases wherever the cone alone reached 32). Any other value is used as given.
   */
  lightTauCap: number;
  /**
   * X3 hybrid (CloudSettings.densityModel 'hybrid'): 0 (default) = density union, the procedural field continues through the voxel box and the
   * two add where they overlap. > 0: the procedural density fades out over this many metres inside the box walls, so a generated voxel field
   * replaces the procedural one there (the NVDF sky layer's hard partition, softened).
   */
  boxCarve: number;
  /** X3 hybrid: the light taps toward the sun also integrate the voxel field (heroes shade the procedural cloud beside and below them). */
  voxelShadow: boolean;
  /**
   * X4 hybrid: strength of the procedural clouds' shadow on the voxel field (0 = none, 1 = their own extinction). The voxel light grid's sun channel
   * integrates the model's density toward the sun, so a hero under a procedural cloud is shadowed by it. A number so pages can A/B it (?proc_heroShadow=0).
   */
  heroShadow: number;
  /**
   * S2: bisection steps where the fine march enters a cloud from an empty sample (0 = off, the pre-S2 march). The march point-samples once per step
   * and the jitter sets where the first sample inside lands: anywhere up to a fine step (25 m and more) under a hard surface, so the colour of a
   * hard lit face followed the per-pixel jitter (S1's hatch). n halvings of the last empty step put the first sample within step / 2^n of the
   * surface, at n full samples per cloud entry.
   */
  surfaceRefine: number;
  /** S2: after a bisected entry, grow the step from the surface (0.15, 0.3, 0.6 of a fine step) instead of the 0.5 / sigma rule (a full step where the density has just begun). */
  surfaceGrow: boolean;
  /**
   * S2: what the bisected entry integrates from the surface it found. 1 (default): the first sample inside (its density, depth and height), only the
   * position (and so the light taps) moved to the surface. 0: the sample at the surface itself; its density has only just begun, and with the step growth
   * its weak, unshadowed light was reused by the denser samples after it: bright one-pixel specks on smooth shaded bases (S2 report).
   */
  surfaceRefineMode: number;
  /** S2: bisect only where the first sample inside makes its fine step at least this optically thick (0 = every entry from an empty sample). */
  surfaceRefineTau: number;
  skypro: SkyProShape;
  takram: TakramShape;
  hzd: HzdShape;
}

/** Tidewater "Partly cloudy" (SkyProClouds.js PRESET, commit 4811ba4). */
export const SKYPRO_DEFAULTS: SkyProShape = {
  altitude: 4000, thickness: 5200, density: 0.019, coverage: 0.49,
  horizonCoverageStart: 20000, horizonCoverageRamp: 45000, horizonCoverageAmount: 0.12,
  edgeSoftness: 0.095, edgeSoftnessFalloff: 1, weatherScale: 29000, baseScale: 7500, baseStrength: 0.69,
  erosionScaleBaseMultiplier: 0.13, erosionStrengthBase: 0.24, erosionStrengthPeak: 2.15, erosionShape: 1,
  baseWeatherStrength: 0.54, baseWeatherHeightStart: 0, baseWeatherHeightEnd: 0.13,
  windSkew: 1750, windDirection: [0, 1],
  weatherMass: [4, 5, 0, 1.32], weatherDetail: [6, 6, 1, 0.13], weatherCoverage: 0.26, weatherResolution: 1024,
};

const takramLayer = (o: Partial<TakramLayer> & Pick<TakramLayer, 'channel'>): TakramLayer => ({
  altitude: 0, height: 0, densityScale: 0.2, shapeAmount: 1, shapeDetailAmount: 1, weatherExponent: 1, shapeAlteringBias: 0.35, coverageFilterWidth: 0.6,
  densityProfile: [0, 0, 0.75, 0.25], ...o,
});

/** Takram CloudLayers.DEFAULT and the CloudsEffect / uniforms.ts defaults. */
export const TAKRAM_DEFAULTS: TakramShape = {
  layers: [
    takramLayer({ channel: 0, altitude: 750, height: 650 }),
    takramLayer({ channel: 1, altitude: 1000, height: 1200 }),
    takramLayer({ channel: 2, altitude: 7500, height: 500, densityScale: 0.003, shapeAmount: 0.4, shapeDetailAmount: 0, coverageFilterWidth: 0.5 }),
    takramLayer({ channel: 3, densityScale: 0 }),
  ],
  coverage: 0.3, weatherTileMeters: 100000, shapeRepeat: 3e-4, detailRepeat: 6e-3, turbulenceRepeat: 20, turbulenceDisplacement: 350, detailDistance: 60000, turbulenceOnShape: false,
};

// F2 (owner, 2026-10-12): the map tile is 32 km at 1024^2 (the 16 km tile at 512^2 repeated visibly in far rows, W1). Every cell count is
// doubled so the features keep their size (W1 found it equivalent): coverage 9 -> 18, islands 2 -> 4, types 2 -> 4, Worley 6 -> 12, gate 3 -> 6,
// bottom type 3 -> 6, heights 3 -> 6; the texel stays 31.25 m. HZD_NDF_TILE_16KM restores the 16 km tile. Map LOD comes later.
export const HZD_NDF_DEFAULTS: HzdNdfSettings = {
  seed: 3, resolution: 1024, tileMeters: 32000, coverageCells: 18, islandCells: 4, islandWeight: 0.8, coverageLo: -0.47, coverageHi: 0.83,
  typeCells: 4, typeMin: 0.4, typeMax: 1, bottomType: 0.45, minHeight: 0, maxHeight: 0.9, heightVariation: 0.2, heightCells: 6, footprint: 0, worleyCells: 12,
  // W1 weather map
  // W1 step 1 (sheet artifacts/research/w1/step1-n17-recipe.jpg): 'n17' replaces 'h6' as the default (hzn_recipe=h6 restores H6). Gate open
  // over about 60 % of the map; footprint and gate ranges put the coverage percentiles near H6's (p50 0.30, p90 0.52, p99 0.67 vs 0.35/0.50/0.65).
  recipe: 'n17', gateCells: 6, gateLo: -0.2, gateHi: 0.05, footLo: -0.4, footHi: 0.6, islandGain: 1, typeContrast: 2, image: '', heightImage: '', paintBlend: 'influence', maskImage: '', paintCoverage: 1, paintTypes: 1, paintHeights: 1,
  stormBlob: 1, stormX: -4500, stormZ: -10500, stormRadius: 3000,
  // F2 per-area bases (bottomType above is the field's centre)
  bottomTypeRange: 1.5, bottomTypeCells: 6, bottomTypeCorrelation: -0.6,
  // CI1 thin-cloud fields
  cirrusCells: 4, cirrusTypeCells: 3, cirrusContrast: 1.6,
};
/** F2: the 16 km tile at 512^2 (H1-W1's tile, F2 step 2's captures): `Object.assign(settings.hzd.ndf, HZD_NDF_TILE_16KM)`, or the URL
 *  hzn_tileMeters=16000&hzn_resolution=512&hzn_coverageCells=9&hzn_islandCells=2&hzn_typeCells=2&hzn_worleyCells=6&hzn_gateCells=3&hzn_bottomTypeCells=3&hzn_heightCells=3 */
export const HZD_NDF_TILE_16KM = {
  tileMeters: 16000, resolution: 512, coverageCells: 9, islandCells: 2, typeCells: 2, worleyCells: 6, gateCells: 3, bottomTypeCells: 3, heightCells: 3,
} satisfies Partial<HzdNdfSettings>;
/** F1 type and form settings. F2: the tables profile is the default (profileMode 'nutshell' + extinction 0.5 = the H6 look); the F1 forms
 *  (storms, sheets, fractus) stay off. */
export const HZD_FORM_DEFAULTS = {
  profileMode: 'tables', tableTypeStratus: 0.14, tableTypeStratocumulus: 0.27, tableTypeCumulus: 0.4, tableSource: 'storage',
  bottomTypeBias: 0, bottomTypeVariation: 0, bottomTypeTile: 24000, tableFloor: PROFILE_TABLE_FLOOR,
  anvilBias: 0, anvilClamp: true, anvilFlatten: 0, anvilDensityFix: 0,
  stormX: -6000, stormZ: -15000, stormRadius: 2500, stormStrength: 0, stormTop: 10000, anvilSpread: 3, anvilShear: 4000, stormTypeStart: 2,
  stormSource: 'cell', anvilCirrus: 0, anvilCirrusLength: 8000, anvilCirrusDepth: 700, anvilCirrusFiber: 6, stormDensity: 1, stormDark: 0, stormGlow: 0, stormFlashRate: 0.7, stormSingle: true, stormAnvilShape: 'smooth', stormRotation: 0,
  midForm: 'off', midBottom: 5400, midThickness: 450, midCoverage: 0.5, midCellSize: 550, midElongation: 1.5, midExtinction: 0.05, midErosion: 0.3,
  emptySkip: 'exact', emptySkipCoverage: 0, midLayerMode: 'hybrid', midLayerFadeStart: 12000, midLayerFadeEnd: 22000, midLayerNdf: 1, midLayerOpticalDepth: 4, midLayerCoverageBoost: 0.4,
  deckForm: 'off', deckBottom: 600, deckThickness: 400, deckCoverage: 0.45, deckCellSize: 1800, deckElongation: 1.2, deckExtinction: 0.1, deckErosion: 0.25,
  fractusDensity: 0, fractusTrail: 900, fractusDrop: 220, fractusBelly: 0.08, fractusScale: 3, fractusCurl: 2, fractusTaps: 3, fractusDistance: 15000,
} satisfies Partial<HzdShape>;
const FORM_CODE = { off: 0, altocumulus: 1, altostratus: 2, stratus: 3 } as const;
/** ProcParams floats of the F1 block: 11 vec4 after hzShelf, then (N1) 2 vec4 of the Nubis Cubed noise, then the 64x64 top, bottom and
 *  peak tables at 3 bytes per float. */
export const PROC_HZD_FORMS_OFFSET = 188;
export const PROC_HZD_N3_OFFSET = PROC_HZD_FORMS_OFFSET + 44;
/** L3: one more vec4 (hzMix) between the N1 block and the tables. */
export const PROC_HZD_MIX_OFFSET = PROC_HZD_N3_OFFSET + 8;
/** STORM1: three more vec4 (hzStorm3, hzStorm4, hzStorm5) between hzMix and the tables. */
export const PROC_HZD_STORM_OFFSET = PROC_HZD_MIX_OFFSET + 4;
/** P2.5a: three more vec4 (hzEdge, hzEdge2, hzEdge3) between hzStorm5 and the tables; P2.5b: hzEdge4. */
export const PROC_HZD_EDGE_OFFSET = PROC_HZD_STORM_OFFSET + 12;
/** P2.3b: one more vec4 (hzTop) after hzEdge4. */
export const PROC_HZD_TOP_OFFSET = PROC_HZD_EDGE_OFFSET + 16;
export const PROC_HZD_LUT_OFFSET = PROC_HZD_TOP_OFFSET + 4;
export const PROC_HZD_LUT_FLOATS = 4096;
let hzdLut: Float32Array | null = null;
/** The N3 s18 tables as H4 uses them (smoothed top, bottom, and the per-pair peaks), 3 bytes per float (exact in f32; never NaN, so the
 *  per-frame change test in procedural/index.ts stays stable). Byte i lives in float i / 3 at bits 8 (i % 3). */
export function packHzdLut(): Float32Array {
  if (!hzdLut) {
    const { top, bottom } = profileTablesSmoothed();
    const peaks = profilePeaks();
    const bytes = new Uint8Array(PROC_HZD_LUT_FLOATS * 3);
    bytes.set(top, 0); bytes.set(bottom, 4096); bytes.set(peaks, 8192);
    hzdLut = new Float32Array(PROC_HZD_LUT_FLOATS);
    for (let i = 0; i < PROC_HZD_LUT_FLOATS; i++) hzdLut[i] = bytes[3 * i] + bytes[3 * i + 1] * 256 + bytes[3 * i + 2] * 65536;
  }
  return hzdLut;
}
/** Pack the F1 block (layout in procedural/density.wgsl.ts hzType .. hzLut). */
export function packHzdForms(hz: HzdShape, out: Float32Array): void {
  const o = PROC_HZD_FORMS_OFFSET;
  out.set([hz.profileMode === 'tables' ? (hz.tableSource === 'uniform' ? 1 : 2) : 0, hz.tableTypeStratus, hz.tableTypeStratocumulus, hz.tableTypeCumulus], o);
  out.set([hz.bottomTypeBias, hz.bottomTypeVariation, Math.max(hz.bottomTypeTile, 1), Math.min(Math.max(hz.tableFloor, 0), 0.9)], o + 4);
  out.set([Math.max(hz.anvilBias, 0), hz.anvilClamp ? 1 : 0, Math.min(Math.max(hz.anvilFlatten, 0), 1), Math.min(Math.max(hz.anvilDensityFix, 0), 1)], o + 8);
  // STORM1: the map source takes its centre and radius (anvil's sideways spread, lightning place) from the default blob, ndf.stormX/Z/Radius.
  const fromMap = hz.stormSource === 'map';
  out.set([fromMap ? hz.ndf.stormX : hz.stormX, fromMap ? hz.ndf.stormZ : hz.stormZ, Math.max(fromMap ? hz.ndf.stormRadius : hz.stormRadius, 1), Math.max(hz.stormStrength, 0)], o + 12);
  out.set([hz.stormTop, Math.max(hz.anvilSpread, 1), hz.anvilShear, hz.stormTypeStart], o + 16);
  out.set([FORM_CODE[hz.midForm] ?? 0, hz.midBottom, Math.max(hz.midThickness, 1), hz.midCoverage], o + 20);
  out.set([Math.max(hz.midCellSize, 1), Math.max(hz.midElongation, 0.1), hz.midExtinction, hz.midErosion], o + 24);
  out.set([FORM_CODE[hz.deckForm] ?? 0, hz.deckBottom, Math.max(hz.deckThickness, 1), hz.deckCoverage], o + 28);
  out.set([Math.max(hz.deckCellSize, 1), Math.max(hz.deckElongation, 0.1), hz.deckExtinction, hz.deckErosion], o + 32);
  out.set([Math.max(hz.fractusDensity, 0), hz.fractusTrail, Math.max(hz.fractusDrop, 1), Math.max(hz.fractusBelly, 1e-3)], o + 36);
  out.set([Math.max(hz.fractusScale, 1e-3), hz.fractusCurl, Math.min(Math.max(Math.round(hz.fractusTaps), 1), 6), Math.max(hz.fractusDistance, 1)], o + 40);
  out.set(packHzdLut(), PROC_HZD_LUT_OFFSET);
}
/** N1 defaults (work/reports/N1.md): the Nubis Cubed noise erodes by default (step 3: closer to n3 s99/s101's billowed surfaces, no pellets
 *  on the tops, skyLayer within run noise); noiseSet 'hzd' is the H1-F2 erosion. The shape noise stays HZD's (step 2: +6-10 ms, no clear gain). */
export const HZD_N3_DEFAULTS = {
  noiseSet: 'nubis3', n3Tile: 600, n3Strength: 1, n3StratusType: 0.5, n3HhfDistance: 900, n3Sharpen: 1, n3Curl: 0, shapeNoise: 'hzd', n3ShapeTile: 4000,
} satisfies Partial<HzdShape>;
/** PF1: hzMix.w = the emptySkip mode (0 off, 2 exact, 3 free; the shader truncates it) plus emptySkipCoverage x 0.9 in the fraction
 *  (merged with ST2, which took hzStorm5.z/w). */
const skipW = (hz: HzdShape) => { const m = hz.emptySkip === 'exact' ? 2 : hz.emptySkip === 'free' ? 3 : 0; return m && m + Math.min(Math.max(hz.emptySkipCoverage, 0), 1) * 0.9; };
/** L3: the mid-layer mix (procedural/density.wgsl.ts hzMix). */
export function packHzdMix(hz: HzdShape, out: Float32Array): void {
  // x: the mid slot's volume share: 0 = full volume, 1 = fades with distance (hybrid), 2 = none (the layer draws it); only for the 2.5D-capable forms.
  const alto = hz.midForm === 'altocumulus' || hz.midForm === 'altostratus';
  const x = !alto ? 0 : hz.midLayerMode === 'layer' ? 2 : hz.midLayerMode === 'hybrid' ? 1 : 0;
  // w: PF1 emptySkip (0 off, 2 exact walk, 3 free walk: the trace's procBoundsMode).
  out.set([x, hz.midLayerFadeStart, Math.max(hz.midLayerFadeEnd, hz.midLayerFadeStart + 1), skipW(hz)], PROC_HZD_MIX_OFFSET);
}
/** STORM1: the storm source, anvil cirrus and storm lighting (hzStorm3 .. hzStorm5 in density.wgsl.ts). */
export function packHzdStorm(hz: HzdShape, out: Float32Array): void {
  const o = PROC_HZD_STORM_OFFSET;
  out.set([hz.stormSource === 'map' ? 1 : 0, Math.max(hz.anvilCirrus, 0), Math.max(hz.anvilCirrusLength, 0), Math.max(hz.anvilCirrusDepth, 1)], o);
  out.set([Math.max(hz.stormDensity, 0), Math.min(Math.max(hz.stormDark, 0), 1), Math.max(hz.stormGlow, 0), Math.max(hz.stormFlashRate, 0)], o + 4);
  out.set([Math.max(hz.anvilCirrusFiber, 1), hz.stormSingle ? 1 : 0, hz.stormAnvilShape === 'taps' ? 1 : 0, hz.stormRotation > 0 ? 1e-4 : 0], o + 8);   // w: the rotation phase, written per frame by the runtime
}
/** P2.5a: edge character defaults (off; agent-chosen). P2.5b: probe 300 -> 1200 m, lead range 0.15 -> 0.05, crisp erosion 0.7 -> 1 (crisp parts
 *  keep the full erosion), the hard shaping (cut 0.12, gain 3) instead of pow 0.55, edge lobes 0.6. P2.5d: top by surface facing (edgeTopMode 1,
 *  up step 80 m, range 0.15), lead range 0.05 -> 0.25 (the measured spread of the coverage difference at 1200 m). */
export const HZD_EDGE_DEFAULTS = {
  edgeCharacter: 0, edgeTopLo: 0.25, edgeTopHi: 0.7, edgeProbe: 1200, edgeLead: 1, edgeLeadRange: 0.25, edgeSoftErosion: 1.4, edgeCrispErosion: 1, edgeSoftPow: 1.6, edgeCrispPow: 0.55,
  edgeCrispCut: 0.12, edgeCrispGain: 3, edgeLobes: 0.6,
  edgeTopMode: 1, edgeUpStep: 80, edgeUpRange: 0.15, edgeFactors: 31, edgeHardMode: 0, edgeSteepGain: 4,
} satisfies Partial<HzdShape>;
/** P2.5a: the edge character block (hzEdge .. hzEdge4 in density.wgsl.ts). */
export function packHzdEdge(hz: HzdShape, out: Float32Array): void {
  const o = PROC_HZD_EDGE_OFFSET;
  // P2.5e: x = 1 + the factor mask when on (0 = off), so the mask rides in the on flag.
  // P2.5f: bit 32 = edgeHardMode 1 (pure gain); its gain edgeSteepGain then takes the edgeCrispGain slot.
  const steep = (hz.edgeHardMode ?? 0) > 0.5;
  out.set([hz.edgeCharacter > 0.5 ? 1 + (Math.round(hz.edgeFactors ?? 31) & 31) + (steep ? 32 : 0) : 0, hz.edgeTopLo, Math.max(hz.edgeTopHi, hz.edgeTopLo + 1e-3), Math.max(hz.edgeProbe, 1)], o);
  out.set([Math.min(Math.max(hz.edgeLead, -1), 1), Math.max(hz.edgeLeadRange, 1e-3), Math.max(hz.edgeSoftErosion, 0), Math.max(hz.edgeCrispErosion, 0)], o + 4);
  out.set([Math.max(hz.edgeSoftPow, 0.05), Math.max(hz.edgeCrispPow, 0.05), Math.min(Math.max(hz.edgeCrispCut, 0), 0.95), Math.max(steep ? (hz.edgeSteepGain ?? 4) : hz.edgeCrispGain, 0)], o + 8);
  out.set([Math.max(hz.edgeLobes, 0), hz.edgeTopMode > 0.5 ? 1 : 0, Math.max(hz.edgeUpStep, 1), Math.max(hz.edgeUpRange, 1e-3)], o + 12);
}
/** P2.3b: tall-cloud top shape defaults (off = the H6 line; agent-chosen constants). */
export const HZD_TOP_DEFAULTS = { topShape: 0, topDome: 1, turretSize: 700, turretDepth: 0.45, turretAmount: 1 } satisfies Partial<HzdShape>;
/** P2.3b: hzTop = (0 off, else 1 + turretAmount; topDome; turretSize; turretDepth). */
export function packHzdTop(hz: HzdShape, out: Float32Array): void {
  const on = (hz.topShape ?? 0) > 0.5;
  out.set([on ? 1 + Math.min(Math.max(hz.turretAmount ?? 1, 0), 1) : 0, Math.min(Math.max(hz.topDome ?? 1, 0), 1), Math.max(hz.turretSize ?? 700, 10),
    Math.min(Math.max(hz.turretDepth ?? 0.45, 0), 1)], PROC_HZD_TOP_OFFSET);
}
/** Pack the N1 block (see above). */
export function packHzdN3(hz: HzdShape, out: Float32Array): void {
  const o = PROC_HZD_N3_OFFSET;
  out.set([hz.noiseSet === 'nubis3' ? 1 : 0, Math.max(hz.n3Tile, 1), Math.max(hz.n3Strength, 0), Math.min(Math.max(hz.n3StratusType, 0), 1)], o);
  out.set([Math.max(hz.n3HhfDistance, 0), Math.min(Math.max(hz.n3Sharpen, 0), 1), hz.n3Curl, hz.shapeNoise === 'nubis3' ? Math.max(hz.n3ShapeTile, 1) : 0], o + 4);
}
/** The march shell of the HZD shaper with the F1 forms: the storm top, the sheets and the fractus below the base widen it. */
export function hzdShell(hz: HzdShape): [number, number] {
  let lo = hz.layerBottom, hi = Math.max(hz.layerTop, hz.layerBottom + 1);
  if (hz.stormStrength > 0 || hz.stormTypeStart < 1) hi = Math.max(hi, hz.stormTop + (hz.anvilCirrus > 0 ? 200 : 0));
  for (const [f, b, t] of [[hz.midForm, hz.midBottom, hz.midThickness], [hz.deckForm, hz.deckBottom, hz.deckThickness]] as const) {
    if (f !== 'off') {
      // L3: the 2.5D layer alone draws the mid slot's altocumulus / altostratus, so it does not widen the march shell.
      if (hz.midLayerMode === 'layer' && b === hz.midBottom && (f === 'altocumulus' || f === 'altostratus')) continue;
      lo = Math.min(lo, b); hi = Math.max(hi, b + t);
    }
  }
  if (hz.fractusDensity > 0) lo = Math.min(lo, hz.layerBottom - hz.fractusDrop);
  return [Math.max(lo, 0), hi];
}
export const HZD_DEFAULTS: HzdShape = {
  layerBottom: 1500, layerTop: 5000, extinction: 0.8, coverageBias: 0, typeBias: 0, coverageMultiply: false, typeBlend: 'curves', // H7 'hybrid' kept as an option; judged 2026-10-10: H6 defaults restored
  shapeTile: 6000, detailTile: 300, curlTile: 3000, curlStrength: 150, detailDistance: 40000, mipBias: 0, baseFadeMin: 0.3, baseFadeHeight: 0.2,
  erosionLaw: 'gp7', windDirection: [2, 1], cloudTopOffset: 500, upwardBias: 0.1, ndfMotion: 'drift', lightProfile: 'standin', ndfDrift: 0.5, shapeSpeed: 1, detailSpeed: 1,
  stage: 3, noiseFormat: 'rgba8unorm', noiseCarve: 1, noiseFine: 1, noiseSmooth: 0, noiseSupersample: 1, detailRecipe: 'gp7', shapeCubicDistance: 30000, detailCubicDistance: 30000, densityPow: 1, shapeContrast: 1, ringStart: 15000, ringEnd: 35000, ringCoverage: 0.3, ringType: 1, ringFadeStart: 0.5,
  erosionStrength: 0.3, wispyHeight: 0.2, erosionOrder: 'hfw', topRound: 0.7, profileSmooth: true, heightFromCoverage: 0.4, heightCoverageRef: 0.4,
  coverageDensityPow: 0, coverageDensityRef: 0.5, veilWidth: 0.08, veilDensity: 0.04, veilHeight: 0.25, veilWisp: 3, veilDistance: 15000, veilNoise: 'detail',
  skirtMode: 'veil', skirtTrail: 500, skirtStretch: 2.5, skirtPeak: 0.08, skirtScale: 3, skirtTrailWidth: 2, skirtGap: 0.25, bottomCurl: 1, lobeTile: 1050, lobeStrength: 0, lobeFull: 0.45, lobeCubic: true, lobeCoverage: 0.5, baseLump: 0, bottomErosion: 0, bottomCurlDown: 0, wispyStrength: 0.3, ...HZD_FORM_DEFAULTS, ...HZD_N3_DEFAULTS, ...HZD_EDGE_DEFAULTS, ...HZD_TOP_DEFAULTS, ndf: HZD_NDF_DEFAULTS,
};
/** A deep copy of the HZD defaults. */
export const hzdDefaults = (): HzdShape => ({ ...HZD_DEFAULTS, windDirection: [...HZD_DEFAULTS.windDirection], ndf: { ...HZD_NDF_DEFAULTS } });
/** The NDF generator's inputs as a cache key: a new key re-generates the map. */
export const hzdNdfKey = (n: HzdNdfSettings) => [n.seed, n.resolution, n.coverageCells, n.islandCells, n.islandWeight, n.coverageLo, n.coverageHi, n.typeCells, n.typeMin, n.typeMax, n.bottomType, n.minHeight, n.maxHeight, n.heightVariation, n.heightCells, n.footprint, n.worleyCells,
  n.recipe, n.gateCells, n.gateLo, n.gateHi, n.footLo, n.footHi, n.islandGain, n.typeContrast, n.bottomTypeRange, n.bottomTypeCells, n.bottomTypeCorrelation, n.stormBlob, n.stormX, n.stormZ, n.stormRadius, n.cirrusCells, n.cirrusTypeCells, n.cirrusContrast].join(',');

export function defaultProceduralSettings(shaper: ProceduralShaper = 'takram'): ProceduralSettings {
  return {
    shaper, stepMeters: 25, maxSteps: 256, lightTaps: 6, fullLightingAlpha: 0.5, maxDistance: 120000, densityScale: 1, lightScale: 1, profileDepth: 120, debug: 0,
    lightingModel: 'octave', powderScale: 0.8, octavePhase: [0.7, -0.2, 0.5], ambientGain: 1, octaveDiffuse: 0.5, lightTauCap: 0, boxCarve: 0, voxelShadow: true, heroShadow: 1, surfaceRefine: 3, surfaceGrow: true, surfaceRefineMode: 1, surfaceRefineTau: 0,   // S2 (agent-chosen): the hatch fix on; surfaceRefine 0 = the old march
    skypro: { ...SKYPRO_DEFAULTS, windDirection: [...SKYPRO_DEFAULTS.windDirection], weatherMass: [...SKYPRO_DEFAULTS.weatherMass], weatherDetail: [...SKYPRO_DEFAULTS.weatherDetail] },
    takram: { ...TAKRAM_DEFAULTS, layers: TAKRAM_DEFAULTS.layers.map(l => ({ ...l, densityProfile: [...l.densityProfile] })) },
    hzd: hzdDefaults(),
  };
}

/** ProcParams uniform: 58 vec4 (the last twenty-eight are the HZD shaper's) and the F1 tables (4096 floats). */
export const PROC_PARAM_FLOATS = PROC_HZD_LUT_OFFSET + PROC_HZD_LUT_FLOATS;
/** Floats [PROC_VIEW_FLOATS[0], [1]) are written every frame (camera, wind offset): not part of the model version. */
export const PROC_VIEW_FLOATS = [108, 116] as const;
export const PROC_PARAM_BYTES = PROC_PARAM_FLOATS * 4;

/** Pack the settings into the ProcParams uniform (layout in procedural/density.wgsl.ts). Returns the shell [minY, maxY] in metres. */
export function packProceduralParams(s: ProceduralSettings, out: Float32Array): [number, number] {
  out.fill(0);
  const sp = s.skypro, tk = s.takram;
  let minY: number, maxY: number;
  const hz = s.hzd;
  if (s.shaper === 'skypro') {
    minY = sp.altitude; maxY = sp.altitude + sp.thickness * 1.3;   // the shape reads up to 1.3 shell heights (scCandidate)
  } else if (s.shaper === 'hzd') {
    [minY, maxY] = hzdShell(hz);
  } else {
    const on = tk.layers.filter(l => l.height > 0 && l.densityScale > 0);
    minY = on.length ? Math.min(...on.map(l => l.altitude)) : 0;
    maxY = on.length ? Math.max(...on.map(l => l.altitude + l.height)) : 1;
  }
  out.set([minY, maxY, s.maxDistance, s.shaper === 'skypro' ? sp.coverage : tk.coverage], 0);
  out.set([s.stepMeters, s.maxSteps, Math.max(1, Math.min(7, Math.round(s.lightTaps))), s.fullLightingAlpha], 4);
  out[11] = s.lightTauCap > 0 ? s.lightTauCap : s.lightingModel === 'fit' ? 1e30 : 32;   // P1.3a: P.wind.w, the sun taps' tau cap (a free lane; 10 is per frame)
  out.set([s.densityScale, s.lightScale, s.debug, s.profileDepth], 12);
  // Sky Pro (SkyProClouds.js settingsBlock): shell, shape, erosion, base, horizon, wind.
  out.set([sp.altitude, sp.thickness, sp.density, sp.coverage], 16);
  out.set([sp.weatherScale, sp.baseScale, sp.baseStrength, sp.erosionScaleBaseMultiplier], 20);
  out.set([sp.erosionStrengthBase, sp.erosionStrengthPeak, sp.erosionShape, sp.baseWeatherHeightEnd], 24);
  out.set([sp.baseWeatherStrength, sp.edgeSoftness, Math.log2(Math.max(sp.edgeSoftnessFalloff, 0.001)) * sp.thickness * 0.001, sp.baseWeatherHeightStart], 28);
  out.set([sp.horizonCoverageStart, sp.horizonCoverageRamp, sp.horizonCoverageAmount, s.surfaceRefineMode], 32);   // .w: S2 surfaceRefineMode (a free lane)
  const wl = Math.hypot(sp.windDirection[0], sp.windDirection[1]) || 1;
  out.set([sp.windDirection[0] / wl, sp.windDirection[1] / wl, sp.windSkew, Math.max(0, s.surfaceRefineTau)], 36);   // .w: S2 surfaceRefineTau (a free lane)
  // Takram (CloudLayers.packValues order, one layer per lane).
  const L = [0, 1, 2, 3].map(i => tk.layers[i] ?? takramLayer({ channel: 3, densityScale: 0 }));
  const lane = (o: number, f: (l: TakramLayer) => number) => { for (let i = 0; i < 4; i++) out[o + i] = f(L[i]); };
  lane(40, l => l.altitude); lane(44, l => l.altitude + l.height);
  lane(48, l => (l.height > 0 ? l.densityScale : 0)); lane(52, l => l.shapeAmount); lane(56, l => l.shapeDetailAmount);
  lane(60, l => l.weatherExponent); lane(64, l => l.shapeAlteringBias); lane(68, l => l.coverageFilterWidth);
  lane(72, l => l.densityProfile[0]); lane(76, l => l.densityProfile[1]); lane(80, l => l.densityProfile[2]); lane(84, l => l.densityProfile[3]);
  lane(88, l => l.channel);
  out.set([tk.weatherTileMeters, tk.shapeRepeat, tk.detailRepeat, tk.turbulenceRepeat], 92);
  out.set([tk.turbulenceDisplacement, tk.detailDistance, tk.turbulenceOnShape ? 1 : 0, s.surfaceGrow ? 1 : 0], 96);
  out.set([s.lightingModel === 'fit' ? 2 : s.lightingModel === 'octave' ? 1 : 0, s.powderScale, s.ambientGain, s.shaper === 'hzd' && hz.lightProfile === 'exact' ? 1 : 0], 100);
  out.set([s.octavePhase[0], s.octavePhase[1], s.octavePhase[2], s.octaveDiffuse], 104);
  // 108..115: the camera and the wind offset (packProceduralView).
  out.set([Math.max(0, s.boxCarve), s.voxelShadow ? 1 : 0, Math.max(0, s.heroShadow), Math.max(0, Math.min(8, Math.round(s.surfaceRefine)))], 116);
  // H1 HZD shaper (PROC_HZD_WGSL): hzLayer, hzScale, hzCov, hzFade, hzWind, hzSpeed, hzMisc.
  out.set([hz.layerBottom, Math.max(hz.layerTop, hz.layerBottom + 1), hz.ndf.tileMeters, hz.extinction], 120);
  out.set([hz.shapeTile, hz.detailTile, hz.curlTile, hz.curlStrength], 124);
  out.set([hz.coverageBias, hz.typeBias, hz.coverageMultiply ? 1 : 0, hz.erosionLaw === 'hag' ? 1 : 0], 128);
  out.set([hz.baseFadeMin, Math.max(hz.baseFadeHeight, 1e-3), hz.detailDistance, hz.mipBias], 132);
  const hl = Math.hypot(hz.windDirection[0], hz.windDirection[1]) || 1;
  out.set([hz.windDirection[0] / hl, hz.windDirection[1] / hl, hz.cloudTopOffset, hz.ndfMotion === 'rigid' ? 0 : hz.upwardBias], 136);
  // W1 advection policy -> hzSpeed (map, shape, detail): anchored noises take the map's speed.
  const m = hz.ndfMotion, mapSpeed = m === 'static' ? 0 : hz.ndfDrift;
  const shapeSpeed = m === 'rigid' || m === 'shape' ? mapSpeed : hz.shapeSpeed, detailSpeed = m === 'rigid' || m === 'detail' ? mapSpeed : hz.detailSpeed;
  out.set([mapSpeed, shapeSpeed, detailSpeed, hz.typeBlend === 'curves' ? 1 : hz.typeBlend === 'hybrid' ? 2 : 0], 140);
  out.set([hz.stage, hz.shapeCubicDistance, hz.densityPow, hz.detailCubicDistance], 144);
  out.set([hz.ringStart, Math.max(hz.ringEnd, hz.ringStart + 1), hz.ringCoverage, hz.ringType], 148);
  out.set([hz.shapeContrast, hz.erosionStrength, Math.max(hz.wispyHeight, 1e-3), hz.erosionOrder === 'hfw' ? 1 : 0], 152);
  out.set([hz.topRound, hz.profileSmooth ? 1 : 0, hz.heightFromCoverage, Math.max(hz.heightCoverageRef, 1e-3)], 156);
  out.set([hz.coverageDensityPow, Math.max(hz.coverageDensityRef, 1e-3), hz.veilWidth, hz.veilDensity], 160);
  out.set([Math.max(hz.veilHeight, 1e-3), hz.ringFadeStart, hz.veilWisp, Math.max(hz.veilDistance, 1)], 164);
  out.set([hz.veilNoise === 'shape' ? 1 : 0, hz.skirtMode === 'skirt' ? 1 : 0, hz.skirtTrail, Math.max(hz.skirtStretch, 1)], 168);
  out.set([Math.max(hz.skirtPeak, 1e-3), Math.max(hz.bottomCurl, 0), hz.bottomCurlDown, hz.wispyStrength], 172);
  out.set([Math.max(hz.skirtScale, 1e-3), Math.max(hz.skirtTrailWidth, 1e-3), hz.bottomErosion, Math.min(Math.max(hz.skirtGap, 0), 0.95)], 176);
  out.set([Math.max(hz.lobeTile, 1), Math.max(hz.lobeStrength, 0), hz.lobeFull, hz.lobeCubic ? 1 : 0], 180);
  out.set([Math.max(hz.baseLump, 0), 0, 0, hz.lobeCoverage], 184);
  packHzdForms(hz, out);
  packHzdN3(hz, out);
  packHzdMix(hz, out);
  packHzdStorm(hz, out);
  packHzdEdge(hz, out);
  packHzdTop(hz, out);
  return [minY, maxY];
}

/** The per-frame part of ProcParams: the camera (curvature reference) and the wind offset. */
export function packProceduralView(camera: ArrayLike<number>, wind: ArrayLike<number>, out: Float32Array): void {
  out[108] = camera[0]; out[109] = camera[1]; out[110] = camera[2]; out[111] = 0;
  out[112] = wind[0]; out[113] = wind[1]; out[114] = wind[2]; out[115] = 0;
}
