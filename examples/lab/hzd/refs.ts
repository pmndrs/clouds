// The HZD bench's reference shots: Guerrilla's papers (the "Reference frames" list in docs/research/topics/README.md) and the owner's photos
// (docs/research/photo-species-specs.md §13 and the hero targets). Plain data, read by the page and by the dev-server route (refs-plugin.ts).
// The images are third party or the owner's: they stay in the local research folder (artifacts/research/, never committed) and are served
// only by the dev server. `file` is relative to that folder.
//
// `crop` is the figure inside a page render, as fractions of the page (x, y, w, h); the viewer can show the whole page instead.
// `view` is an approximate starting view (a bookmark plus overrides) that puts the sky near the paper's or the photo's setup: sun, camera,
// coverage. None of these were measured; the papers publish no cameras or sun angles. Pick a reference and the view follows (sidebar switch).

export interface RefView {
  /** The bookmark it starts from (ground, horizon, sunset, dusk, afterglow, above, gp7, high). */
  from: string;
  sunEl?: number; sunAz?: number; lookAz?: number; pitch?: number; posy?: number; coverage?: number; fov?: number;
}
export interface HzdRef {
  id: string;
  /** The picker's group: the paper, or the photo set. */
  group: string;
  title: string;
  /** Where it comes from: paper and page or slide, or the photo folder. */
  source: string;
  file: string;
  crop?: [number, number, number, number];
  view?: RefView;
}

const X = 'extracted';
const P = 'cloud-photos';
// Page renders of the notes (slide in the top third) and of the GP7 chapter.
const NOTES: [number, number, number, number] = [0.097, 0.124, 0.806, 0.342];
const GP7_FRAMING: RefView = { from: 'gp7' };
const SUNSET_WEST = { sunAz: 290, lookAz: 290 };

const hzd15 = (page: number, title: string, view?: RefView): HzdRef => ({
  id: `hzd15-p${String(page).padStart(3, '0')}`, group: 'HZD 2015 (SIGGRAPH course notes)', title, source: `hzd15 p${String(page).padStart(3, '0')}`,
  file: `${X}/hzd15/png/p${String(page).padStart(3, '0')}.png`, crop: NOTES, view,
});
const n17 = (page: number, title: string, view?: RefView): HzdRef => ({
  id: `n17-p${String(page).padStart(3, '0')}`, group: 'Nubis 2017 (SIGGRAPH course notes)', title, source: `n17 p.${page}`,
  file: `${X}/n17/png/p${String(page).padStart(3, '0')}.png`, crop: NOTES, view,
});
const nut = (slide: number, title: string, view?: RefView): HzdRef => ({
  id: `nut-s${slide}`, group: 'Nubis in a Nutshell (2018)', title, source: `nut s${slide}`, file: `${X}/nut/pdf/png/p${String(slide).padStart(3, '0')}.png`, view,
});
const ne22 = (page: number, title: string, view?: RefView): HzdRef => ({
  id: `ne22-p${String(page).padStart(3, '0')}`, group: 'Nubis Evolved (2022)', title, source: `ne22 p.${page}`, file: `${X}/ne22/png/p${String(page).padStart(3, '0')}.png`, view,
});
const n3 = (image: string, slide: number, title: string, view?: RefView): HzdRef => ({
  id: `n3-${image.replace(/\.\w+$/, '')}`, group: 'Nubis Cubed (2023)', title, source: `n3 s${slide} ${image.replace(/\.\w+$/, '')}`, file: `${X}/n3/pptx/media/${image}`, view,
});
const photo = (group: string, path: string, title: string, view?: RefView): HzdRef => ({
  id: `photo-${path.split('/').pop()!.replace(/\.\w+$/, '').replace(/^[AB]_/, '')}`, group, title, source: `owner photo: ${path}`, file: `${P}/${path}`, view,
});

export const HZD_REFS: HzdRef[] = ([] as HzdRef[]).concat([
  // --- HZD 2015 build steps and maps (hzd15) ---
  hzd15(37, 'Base shape: low-frequency noise x height gradient (view about 30° above the horizon)', { from: 'ground', pitch: 30 }),
  hzd15(38, 'With the coverage multiply and the base fade', { from: 'ground', pitch: 30 }),
  hzd15(39, 'With the detail erosion (curl-distorted Worley)', { from: 'ground', pitch: 30 }),
  hzd15(42, 'Minimap R/G/B (coverage, precipitation, type) and its sky', { from: 'ground', pitch: 10 }),
  hzd15(43, 'Default weather: cumulus and stratus mix', { from: 'ground', pitch: 10 }),
  hzd15(44, 'Precipitation: the map turns to cumulonimbus at 70 % coverage', { from: 'ground', pitch: 10, coverage: 0.7 }),
  hzd15(45, 'Precipitation raised gradually to 100 % (video still)', { from: 'ground', pitch: 10, coverage: 0.8 }),
  hzd15(46, 'Wind and rain: storm clouds rolling in (video still)', { from: 'ground', pitch: 8, coverage: 0.85 }),
  hzd15(47, 'The horizon ring: 15 km to 35 km toward cumulus (diagram)'),
  hzd15(48, 'Weather variation from the scheduler', { from: 'ground', pitch: 10 }),
  hzd15(49, 'E3 trailer: painted cutscene weather textures', { from: 'ground', pitch: 6, sunEl: 20 }),
  hzd15(89, 'Cirrus and alto textures (2D layers above the volume)'),
  // --- GPU Pro 7 (gp7) ---
  { id: 'gp7-f4.10', group: 'GPU Pro 7, chapter 4', title: 'Fig 4.10-4.11: the stratus, cumulus, cumulonimbus gradients and their clouds', source: 'gp7 p.103', file: `${X}/gp7/png/p007.png`, crop: [0.14, 0.1, 0.72, 0.4] },
  { id: 'gp7-f4.12', group: 'GPU Pro 7, chapter 4', title: 'Fig 4.12: the weather map broken into its channels', source: 'gp7 p.104', file: `${X}/gp7/png/p008.png`, crop: [0.275, 0.189, 0.554, 0.103] },
  { id: 'gp7-f4.13', group: 'GPU Pro 7, chapter 4', title: 'Fig 4.13: base shape x gradient, coverage remap only (panel: Build stage 1)', source: 'gp7 p.106', file: `${X}/gp7/png/p010.png`, crop: [0.296, 0.185, 0.515, 0.225], view: GP7_FRAMING },
  { id: 'gp7-f4.14', group: 'GPU Pro 7, chapter 4', title: 'Fig 4.14: with coverage (panel: Build stage 2)', source: 'gp7 p.107', file: `${X}/gp7/png/p011.png`, crop: [0.193, 0.185, 0.511, 0.222], view: GP7_FRAMING },
  { id: 'gp7-f4.16', group: 'GPU Pro 7, chapter 4', title: 'Fig 4.16: with detail erosion, the full chain (the H-reports\' main target)', source: 'gp7 p.109', file: `${X}/gp7/png/p013.png`, crop: [0.193, 0.185, 0.511, 0.225], view: GP7_FRAMING },
  // --- Nubis 2017 (n17) ---
  n17(30, 'Cumulus gradient, in-game render', { from: 'ground', pitch: 10 }),
  n17(31, 'Stratocumulus gradient, in-game render', { from: 'ground', pitch: 10 }),
  n17(32, 'Stratus gradient, in-game render', { from: 'ground', pitch: 10 }),
  n17(37, 'Without noise: gradient x coverage only', { from: 'ground', pitch: 10 }),
  n17(38, 'Low-frequency noise added', { from: 'ground', pitch: 10 }),
  n17(39, 'High-frequency noise added', { from: 'ground', pitch: 10 }),
  n17(41, 'Coverage inflation 1/4', { from: 'ground', pitch: 10, coverage: 0.35 }),
  n17(42, 'Coverage inflation 2/4', { from: 'ground', pitch: 10, coverage: 0.5 }),
  n17(43, 'Coverage inflation 3/4', { from: 'ground', pitch: 10, coverage: 0.65 }),
  n17(44, 'Coverage inflation 4/4', { from: 'ground', pitch: 10, coverage: 0.8 }),
  n17(46, 'Anvil: coverage = pow(coverage, remap(h, 0.7, 0.8, 1, lerp(1, 0.5, anvil_bias))) 1/5', { from: 'ground', pitch: 10 }),
  n17(47, 'Anvil 2/5', { from: 'ground', pitch: 10 }),
  n17(48, 'Anvil 3/5', { from: 'ground', pitch: 10 }),
  n17(49, 'Anvil 4/5', { from: 'ground', pitch: 10 }),
  n17(50, 'Anvil 5/5', { from: 'ground', pitch: 10 }),
  n17(54, 'Map construction: a low-frequency noise gates the coverage into large regions'),
  n17(55, 'Map construction: Perlin (R) and Perlin-Worley (G) footprint composites'),
  n17(56, 'Perlin fBM footprint: connected formations', { from: 'ground', pitch: 10 }),
  n17(57, 'Perlin-Worley footprint: isolated islands with connective tissue', { from: 'ground', pitch: 10 }),
  n17(58, 'Map construction: the type channel (0 stratus, 0.5 stratocumulus, 1 cumulus)'),
  n17(64, 'Authored map: desert morning', { from: 'ground', pitch: 8, sunEl: 8, sunAz: 80, lookAz: 60 }),
  n17(65, 'Authored map: cumulus building in the afternoon (into the sun)', { from: 'ground', pitch: 10, sunEl: 25, sunAz: 200, lookAz: 200 }),
  n17(66, 'Authored map: alpine region, cumulus and stratus', { from: 'ground', pitch: 12, sunEl: 35 }),
  n17(67, 'Weather simulation to cloud map (diagram)'),
  n17(68, 'Custom cloud map for a boss fight', { from: 'ground', pitch: 15, coverage: 0.75 }),
  // --- Nutshell (nut) ---
  nut(8, 'Gradients: stratocumulus, cumulus, stratus', { from: 'ground', pitch: 10 }),
  nut(12, 'Without noise: gradient x coverage only (the shelved look)', { from: 'ground', pitch: 10 }),
  nut(14, 'Coverage inflation: the clouds inflate as the coverage rises', { from: 'ground', pitch: 10, coverage: 0.7 }),
  nut(16, 'The cloud map: a 2D probability field of coverage and type'),
  nut(17, 'Desert morning map: type 0, stratus', { from: 'ground', pitch: 8, sunEl: 6, sunAz: 80, lookAz: 60 }),
  nut(18, 'Afternoon map: higher type, cumulus (into the sun)', { from: 'ground', pitch: 10, sunEl: 25, sunAz: 200, lookAz: 200 }),
  nut(19, 'Custom map for the final boss fight', { from: 'ground', pitch: 15, coverage: 0.75 }),
  nut(20, 'Blending from one cloud map to another (10-30 s)', { from: 'ground', pitch: 10 }),
  // --- Nubis Evolved (ne22) ---
  ne22(22, 'Top type table (height x top type)'),
  ne22(23, 'Type render: cumulus', { from: 'ground', pitch: 20, sunEl: 45 }),
  ne22(24, 'Type render: stratocumulus', { from: 'ground', pitch: 20, sunEl: 45 }),
  ne22(25, 'Type render: stratus', { from: 'ground', pitch: 20, sunEl: 45 }),
  ne22(26, 'Bottom type table (height x bottom type)'),
  ne22(27, 'Bottom type 0: crisp flat bases', { from: 'ground', pitch: 20 }),
  ne22(28, 'Vertical profile = top table x bottom table (diagram)'),
  ne22(30, 'Profile render, no noise', { from: 'ground', pitch: 20 }),
  ne22(35, 'Final 1', { from: 'ground', pitch: 20 }),
  ne22(36, 'Final 2', { from: 'ground', pitch: 20 }),
  ne22(64, '2.5D cirrus: structure (diagram)'),
  ne22(65, '2.5D cirrus: type 0..1 streaky, wispy, round'),
  ne22(66, '2.5D cirrus render', { from: 'ground', pitch: 25 }),
  ne22(67, '2.5D cirrus: lighting (diagram)'),
  ne22(68, 'Cirrus at sunset', { from: 'sunset', sunEl: 1, ...SUNSET_WEST }),
  ne22(109, 'Envelope model: valley cap over a peak (no counterpart in this sky)', { from: 'above' }),
  ne22(114, 'Envelope model at sunset (no counterpart in this sky)', { from: 'above', sunEl: 3, ...SUNSET_WEST }),
  // --- Nubis Cubed (n3) ---
  n3('image28.png', 17, 'Poster: the 2.5D sky, method A', { from: 'ground', pitch: 25 }),
  n3('image29.png', 17, 'Poster: one cloud before erosion'),
  n3('image30.png', 17, 'Poster: one cloud after erosion'),
  n3('image31.png', 17, 'Poster: the 2.5D sky, method B', { from: 'ground', pitch: 25 }),
  n3('image41.png', 25, 'Sky with the sun in frame', { from: 'ground', pitch: 15, sunEl: 35, sunAz: 30, lookAz: 0 }),
  n3('image42.png', 25, 'One cloud in haze'),
  n3('image44.png', 29, 'In-game cumulus 1', { from: 'ground', pitch: 12 }),
  n3('image45.png', 29, 'In-game cumulus 2', { from: 'ground', pitch: 12 }),
  n3('image46.png', 31, 'Cumulus mass, lit', { from: 'ground', pitch: 15 }),
  n3('image47.png', 31, 'Cumulus mass, shadowed lobes', { from: 'ground', pitch: 15 }),
  n3('image48.png', 31, 'Cumulus mass, overcast light', { from: 'ground', pitch: 15, coverage: 0.7 }),
  n3('image55.png', 37, 'HFW in-game sunset cumulus (the HZD floor)', { from: 'sunset', sunEl: 3, pitch: 12 }),
  n3('image56.png', 37, 'HFW in-game backlit cumulus (the HZD floor)', { from: 'ground', pitch: 15, sunEl: 25, sunAz: 330, lookAz: 330 }),
  n3('image118.png', 96, 'Noise composite 1 (close cumulus)', { from: 'ground', pitch: 20 }),
  n3('image119.png', 96, 'Noise composite 2', { from: 'ground', pitch: 20 }),
  n3('image120.png', 96, 'Noise composite 3', { from: 'ground', pitch: 20 }),
  n3('image122.png', 99, 'Tower, noise stage 1', { from: 'ground', pitch: 20 }),
  n3('image123.png', 99, 'Tower, noise stage 2', { from: 'ground', pitch: 20 }),
  n3('image124.png', 99, 'Tower, noise stage 3', { from: 'ground', pitch: 20 }),
  n3('image125.png', 101, 'One cumulus, stage 1', { from: 'ground', pitch: 12 }),
  n3('image126.png', 101, 'One cumulus, stage 2', { from: 'ground', pitch: 12 }),
  n3('image127.png', 101, 'One cumulus, stage 3', { from: 'ground', pitch: 12 }),
  n3('image186.png', 162, 'Hero layout sketch'),
  n3('image188.png', 164, 'Flight between heroes 1', { from: 'high' }),
  n3('image189.png', 165, 'Flight between heroes 2', { from: 'high' }),
  n3('image190.jpeg', 166, 'Hero deck from the ground', { from: 'ground', pitch: 15, coverage: 0.7 }),
  // --- Häggström 2018 (hag) ---
  { id: 'hag-f9', group: 'Häggström 2018 (thesis)', title: 'Fig 9: weather map x shape noise x height gradient (shape only)', source: 'hag p.27 fig 9', file: `${X}/hag/png/p027.png`, crop: [0.213, 0.103, 0.668, 0.232], view: { from: 'ground', pitch: 10 } },
  { id: 'hag-f11', group: 'Häggström 2018 (thesis)', title: 'Fig 11: with detail noise', source: 'hag p.28 fig 11', file: `${X}/hag/png/p028.png`, crop: [0.116, 0.503, 0.672, 0.232], view: { from: 'ground', pitch: 10 } },
  { id: 'hag-f12', group: 'Häggström 2018 (thesis)', title: 'Fig 12: anvil comparison', source: 'hag p.29 fig 12', file: `${X}/hag/png/p029.png`, crop: [0.213, 0.303, 0.672, 0.132] },
  { id: 'hag-f13', group: 'Häggström 2018 (thesis)', title: 'Fig 13: cloud with anvil, altered density model', source: 'hag p.29 fig 13', file: `${X}/hag/png/p029.png`, crop: [0.37, 0.655, 0.28, 0.15] },

  // --- Owner photos: photo-species-specs.md §13 picks ---
  photo('T1 fair-weather cumulus field', 'cumulus-humilis/A_20220701-151538_DSC00139.jpg', 'Flat-based puffs of mixed sizes under a cirrus veil', { from: 'ground', pitch: 20, sunEl: 50, coverage: 0.45 }),
  photo('T1 fair-weather cumulus field', 'cumulus-humilis/A_20220602-050524_B7EE8102.jpg', 'Big puffs shrinking into a bright horizon band', { from: 'ground', pitch: 8, sunEl: 55, coverage: 0.5 }),
  photo('T1 fair-weather cumulus field', 'cumulus-humilis/A_20220729-163005_DSC00595.jpg', 'Puffs, cirrus streaks and a contrail', { from: 'ground', pitch: 20, sunEl: 45, coverage: 0.4 }),
  photo('T1 fair-weather cumulus field', 'aerial-cloud-deck/A_20220905-085425_36F59589.jpg', 'Fair-weather scatter from above, cast shadows on the ocean', { from: 'above', posy: 9000, pitch: -45, sunEl: 50, coverage: 0.4 }),
  photo('T1 fair-weather cumulus field', 'cumulus-mediocris/A_20220801-105825_DSC00889.jpg', 'Street of cumulus to the horizon, dark base', { from: 'ground', pitch: 15, sunEl: 55, coverage: 0.6 }),
  photo('T2 dusk congestus', 'congestus/A_20220910-182243_A7I01413.jpg', 'Backlit tower on a wide base, silver and peach', { from: 'dusk', sunEl: 4, pitch: 8, ...SUNSET_WEST }),
  photo('T2 dusk congestus', 'congestus/A_20220902-222220_6F4BC35D.jpg', 'Layered towers with inner glow at sunset', { from: 'dusk', sunEl: 1, pitch: 8, ...SUNSET_WEST }),
  photo('T2 dusk congestus', 'congestus/B_20220827-203504_34821A98.jpg', 'Towers in dusk gloom with a gold fringe', { from: 'dusk', sunEl: 0.5, pitch: 6, ...SUNSET_WEST }),
  photo('T2 dusk congestus', 'aerial-cloud-deck/A_20220905-085807_7FE917DC.jpg', 'Tower tops seen from altitude', { from: 'above', posy: 7000, pitch: -35, sunEl: 40, coverage: 0.6 }),
  photo('T2 dusk congestus', 'congestus/A_20220827-211108_AE637F1E.jpg', 'Dusk towers over a sea, warm underlight', { from: 'dusk', sunEl: 1, pitch: 6 }),
  photo('T3 cloud sea and decks', 'aerial-cloud-deck/A_20260914-080231_A043335D.jpg', 'Flat deck from above, a peak above it', { from: 'above', posy: 10000, pitch: -12, sunEl: 25, coverage: 0.8 }),
  photo('T3 cloud sea and decks', 'aerial-cloud-deck/A_20260914-080227_A5431A0E.jpg', 'Deck with soft edges near terrain', { from: 'above', posy: 10000, pitch: -20, sunEl: 25, coverage: 0.8 }),
  photo('T3 cloud sea and decks', 'stratocumulus/B_20220904-185312_DSC00019.jpg', 'Cloud hugging a ridge above a valley', { from: 'ground', pitch: 5, sunEl: 10, coverage: 0.6 }),
  photo('T3 cloud sea and decks', 'stratocumulus/A_20260915-171733_A1BB10D2.jpg', 'Low deck over water, a mountain beyond', { from: 'sunset', sunEl: 4, pitch: 3, coverage: 0.7, ...SUNSET_WEST }),
  photo('T4 layered sunset bands', 'sunset-layers/A_20220710-201409_DSC00415.jpg', 'Three layers, alto cells in orange', { from: 'sunset', sunEl: 2, pitch: 25, sunAz: 290, lookAz: 250 }),
  photo('T4 layered sunset bands', 'sunset-layers/A_20220425-095012_7089017A.jpg', 'Alto cells over dark stratocumulus, warm horizon', { from: 'sunset', sunEl: 2, pitch: 15, ...SUNSET_WEST }),
  photo('T4 layered sunset bands', 'sunset-layers/A_20221012-083712_1458ED3F.jpg', 'Sheared stratocumulus bands with gaps and sun glare', { from: 'sunset', sunEl: 2, pitch: 12, ...SUNSET_WEST }),
  photo('T4 layered sunset bands', 'sunset-layers/A_20221016-084611_ABB372B0.jpg', 'Bands with underlight and rays', { from: 'sunset', sunEl: 0.5, pitch: 10, ...SUNSET_WEST }),
  photo('T4 layered sunset bands', 'sunset-layers/A_20220815-102212_14751A6E.jpg', 'High pink-orange streak layer over a purple sky', { from: 'afterglow', sunEl: -1, pitch: 20 }),
  photo('T5 cumulonimbus', 'cumulonimbus/A_20220910-174832_A7I01326.jpg', 'Column, shaft and anvil, dark base', { from: 'ground', pitch: 12, sunEl: 25, coverage: 0.65 }),
  photo('T5 cumulonimbus', 'cumulonimbus/A_20220910-180303_A7I01369.jpg', 'Rain curtain under a backlit column', { from: 'ground', pitch: 10, sunEl: 12, ...SUNSET_WEST }),
  photo('T5 cumulonimbus', 'cumulonimbus/A_20220910-180016_A7I01357.jpg', 'Dark base with beams and a surface glint', { from: 'ground', pitch: 8, sunEl: 10, ...SUNSET_WEST }),
  photo('T5 cumulonimbus', 'cumulonimbus/A_20220715-085533_82FBB560.jpg', 'Bright cauliflower cumulonimbus on the horizon', { from: 'ground', pitch: 5, sunEl: 50 }),
  photo('T5 cumulonimbus', 'cumulonimbus/A_20220910-174408_A7I01312.jpg', 'Tilted tower with a sheared anvil', { from: 'ground', pitch: 15, sunEl: 25 }),
  photo('T6 tall-neck towers', 'congestus/A_20220729-173342_DSC00678.jpg', 'Big cauliflower neck, close', { from: 'ground', pitch: 25, sunEl: 40 }),
  photo('T6 tall-neck towers', 'congestus/A_20220902-193404_DSC02418.jpg', 'Tall narrow leaning towers on a pedestal', { from: 'ground', pitch: 15, sunEl: 20 }),
  photo('T6 tall-neck towers', 'congestus/A_20220729-172804_DSC00629.jpg', 'Tower on a wide base', { from: 'ground', pitch: 15, sunEl: 40 }),
  photo('T6 tall-neck towers', 'congestus/A_20220729-173330_DSC00669.jpg', 'Big tower with companions', { from: 'ground', pitch: 15, sunEl: 40 }),
  photo('T7 time of day (Waikiki 2022-09-10)', 'cumulonimbus/A_20220910-174408_A7I01312.jpg', 'Day', { from: 'ground', pitch: 15, sunEl: 25 }),
  photo('T7 time of day (Waikiki 2022-09-10)', 'cumulonimbus/A_20220910-180303_A7I01369.jpg', 'Golden', { from: 'ground', pitch: 10, sunEl: 12, ...SUNSET_WEST }),
  photo('T7 time of day (Waikiki 2022-09-10)', 'congestus/A_20220910-182243_A7I01413.jpg', 'Sunset', { from: 'dusk', sunEl: 4, pitch: 8, ...SUNSET_WEST }),
  photo('T7 time of day (Waikiki 2022-09-10)', 'cumulonimbus/B_20220910-180513_A7I01381.jpg', 'Dusk', { from: 'dusk', sunEl: 0, pitch: 8 }),
  photo('T7 time of day (Texas 2022-07-10)', 'sunset-layers/A_20220710-195845_DSC00328.jpg', 'Golden', { from: 'sunset', sunEl: 6, pitch: 15, ...SUNSET_WEST }),
  photo('T7 time of day (Texas 2022-07-10)', 'sunset-layers/A_20220710-201316_DSC00407.jpg', 'Sunset', { from: 'sunset', sunEl: 2, pitch: 15, ...SUNSET_WEST }),
  photo('T7 time of day (Texas 2022-07-10)', 'sunset-layers/A_20220710-201521_DSC00426.jpg', 'Sun down', { from: 'afterglow', sunEl: -0.5, pitch: 15 }),
  photo('T7 time of day (Texas 2022-07-10)', 'sunset-layers/A_20220710-202729_DSC00459.jpg', 'Dusk', { from: 'afterglow', sunEl: -3, pitch: 15 }),
  photo('T7 time of day (Galveston 2022-09-02)', 'sunset-layers/A_20220902-071919_DSC02390.jpg', 'Dawn', { from: 'sunset', sunEl: 3, pitch: 8, sunAz: 80, lookAz: 80 }),
  photo('T7 time of day (Galveston 2022-09-02)', 'congestus/A_20220902-222220_6F4BC35D.jpg', 'Dusk', { from: 'dusk', sunEl: 1, pitch: 8, ...SUNSET_WEST }),
  photo('T7 time of day (sky ramps)', 'sunset-layers/A_20221021-084217_DSC02782.jpg', 'Twilight sky ramp, no cloud', { from: 'afterglow', sunEl: -3, pitch: 10, coverage: 0 }),
  photo('T7 time of day (sky ramps)', 'sunset-layers/B_20221019-202153_DSC02627.jpg', 'Blue-hour sky ramp', { from: 'afterglow', sunEl: -6, pitch: 10, coverage: 0 }),
  // --- Hero targets (docs/research/targets/) ---
  photo('Hero targets', 'santasSleigh/early.jpg', 'Santa\'s Sleigh: early', { from: 'ground', pitch: 12, sunEl: 35, coverage: 0.6 }),
  photo('Hero targets', 'santasSleigh/middle.jpg', 'Santa\'s Sleigh: middle', { from: 'ground', pitch: 12, sunEl: 35, coverage: 0.6 }),
  photo('Hero targets', 'santasSleigh/end.jpg', 'Santa\'s Sleigh: end (the H6 sheets\' photo)', { from: 'ground', pitch: 12, sunEl: 35, coverage: 0.6 }),
  photo('Hero targets', 'Frog Cloud/FrogFace.png', 'Frog cloud: the face', { from: 'ground', pitch: 15, sunEl: 40, coverage: 0.6 }),
]).map((r, i, all) => (all.findIndex(o => o.id === r.id) < i ? { ...r, id: `${r.id}-${i}` } : r));   // a photo used in two sets keeps one id each

export const HZD_REF_BY_ID = new Map(HZD_REFS.map(r => [r.id, r]));
