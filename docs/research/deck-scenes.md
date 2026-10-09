# Deck scene catalog: Schneider's cloud scenes, shape vocabulary and techniques

> **Superseded by / see also:** [sources/n3.md](sources/n3.md) and [sources/syn.md](sources/syn.md) (figures lists per slide), [topics/layering.md](topics/layering.md) §7 (hero layout), [topics/surface-detail.md](topics/surface-detail.md); the owner-photo scene studies [targets/santa-sleigh.md](targets/santa-sleigh.md) and [targets/frog.md](targets/frog.md). Target scenes should now be judged against HZD and the owner's photos.

A visual catalog of every cloud scene and reference image in the two decks, so we
can pick target scenes to rebuild and list what our generated clouds lack. The
formulas are in [nubis-sources.md](nubis-sources.md); this file does not repeat
them.

| Tag | Source |
| --- | --- |
| **N3** | *Nubis Cubed*, SIGGRAPH 2023 (194 slides, 41 videos) |
| **SY** | *Synthesizing Realistic Clouds for Video Games* (83 slides, 8 videos) |

Method: slide text, speaker notes and slide-to-media mapping from the decks'
`.pptx` files, plus ffmpeg poster frames at 10%, 50% and 90% of every video
(49 videos). I looked at contact sheets of all 277 slides and zoomed into the
promising ones. The pixels live in `work/captures/scratch/deck-scenes/`
(gitignored, never commit): `sheets/N3_slides_01..10.jpg`,
`sheets/SY_slides_01..05.jpg`, `sheets/*_vids_*.jpg` for videos, and
`sheets/hero1..3.jpg` for enlarged key shots. Cloud-type labels below are my
reading of the images, not the author's; he never names types in the Nubis³
talk. In SY s3 he introduces Luke Howard's names (cumulus, stratus, cirrus).

## 1. Scene catalog

Camera: **G** ground, **F** flight (mount or fly-through), **I** inside the
cloud, **E** editor or viewer, **P** real photograph. Slides not listed are
logos, diagrams, graphs, code or pure text.

### 1.1 Game and trailer scenes (the targets worth copying)

| Deck, slide | What it shows | Cloud types present | Camera, time |
| --- | --- | --- | --- |
| N3 s2 (video), SY s6 | Massive billowing mass behind a mountain peak, deep orange and pink | Cumulus congestus to towering, with flat-ish bases | F, golden hour |
| N3 s11 (video) | Montage of the old 2.5D system: snowy fog, red lightning superstorm, flight into cloud | Stratus/fog, cumulonimbus supercell, cloud interior | G and F, mixed |
| N3 s34 (video), SY s72, SY s82 | Horizon Forbidden West "Superstorm": a rotating red-lit storm mass, lightning, red desert ground. Lightning sphere glow. | Cumulonimbus, supercell structure, wall cloud | G, sunset or red light |
| N3 s37 | Daylight, sun rays through a broken field of small puffs over a tree and hills | Stratocumulus / altocumulus-like cumulus fractus, crepuscular rays | G, midday-afternoon |
| N3 s37 (2nd image), N3 s61, N3 s75 | Pink cumulus stacks around the flying mount, sunset | Cumulus mediocris/congestus, scattered | F, sunset |
| N3 s40–42 | Orographic cloud pools packed into valleys between red cliffs. Samples shown as red dots. Final frame has a cloud sea below peaks and thin altocumulus above. | Valley fog / cloud sea (stratus-like), stratocumulus pools, altocumulus | F, day |
| N3 s48 | Single small orange cumulus, prototype voxel render | Cumulus humilis/mediocris | G, dusk |
| N3 s50 | Two small cumulus towers standing on a flat cloud deck; second image a glowing single cloud with vertical sun pillar | Cumulus mediocris towers over stratocumulus sheet | G/F, day and dusk |
| N3 s51 (video) | Animatic of the DLC trailer: ellipsoid proxies as clouds, dense flight path | Proxy only (layout) | F |
| N3 s52, s67 | Flight through very pale billowy congestus at several depths, cloud sea floor far below, hazy blue depth fade | Cumulus congestus, cumulonimbus-like towers, stratocumulus sea | F, bright day |
| N3 s53, s56, s57 | Stormbird mount in front of and inside huge white cumulus banks | Cumulus congestus, stratocumulus deck | F, day |
| N3 s55 (video) | Burning Shores trailer: floating volcanic islands, lava, cloud banks and fog threaded among rocks | Cumulus banks, low fog/stratus | F, afternoon |
| N3 s58 | Concept art, volcanic archipelago | (art reference only) | n/a |
| N3 s66 | The "tall neck" cloud built by an artist from a game model: a tall column with a flat cap over mountains | Cumulus congestus column, pileus-like cap, possibly pyrocumulus-style | G, day |
| N3 s110, s115 | Beach and wreck at sunset with red/pink dark-bottom clouds in layers, haze at the horizon | Stratocumulus layer, cumulus mediocris, low haze | G, sunset |
| N3 s131–133 (videos), SY s72/74 | Time-of-day cycle: teal night with aurora and a big towering cloud, bright day with congestus plus wispy cirrus streaks above forested hills, blue dusk | Cumulus congestus, cirrus (streaks, in the 2.5D layer), stratocumulus | G, night, day, dusk |
| N3 s152–154, s158, s159 (video), SY s75, s80, s81 | Fiery orange sunset sky: dense low sun-lit tower banks, thick back-lit cumulus congestus, bright sun burst glow | Cumulus congestus, stratocumulus, altocumulus layer behind | F and G, sunset |
| N3 s156 | Teal night storm over swamp water, dark masses with lit edges | Cumulus congestus/nimbus, storm base | G, night |
| N3 s161 | "In Progress" text spelled in clouds over sea cliffs | Cumulus humilis puffs forming letters (frankencloud) | G, day |
| N3 s162 | Hand sketch: layout of the DLC sky from east and south views, composition of silhouettes against the sun arc | Planning only | n/a |
| N3 s163 (video) | Building a cloud with terrain, wireframe boxes then final bright cumulus | Cumulus mediocris | E then G |
| N3 s164, s165 (videos) | Tunnel dive: wings in a bright cloud, light changes toward the back of the tunnel | Cumulus interior, cave | I, day |
| N3 s167 (video) | Orbit of the finished cloudscape: a chain of voxel clouds along a coastline over a terrain height map | Clusters of cumulus, gaps, coast line | E, overview |
| N3 s168 | Two gameplay views: sunny beach with scattered puffs plus cirrus streaks high up; a red sunset beach | Cumulus humilis/mediocris, cirrus | G, day and sunset |
| N3 s169 (video) | Cinematic: sunset beach, long stratocumulus bands over the sea, small puffs | Stratocumulus bands, cumulus | G, sunset |
| N3 s170, s172 (videos, stills) | Boss arena: grey storm cumulonimbus ring around mountains, volcano glow; second still in monochrome | Cumulus congestus/cumulonimbus, arena wrap | G, overcast |
| N3 s174–176, s185, s186 (videos), SY s7, SY s82 | Stormbird storm: teal-lit cloud, lightning, flight into and inside the cloud, egg at the core | Isolated cumulonimbus, dark interior, anvil-ish skirt | F and I, night/teal |
| N3 s178, s180, s182 | Small localized thunderstorm: red sunset lightning strike (s178); in-game blue-sky puffy plume with inner glow (s180, s182) | Isolated cumulonimbus/ congestus, plume with skirt | G, sunset and day |
| N3 s179, s181 (videos) | Authoring of the storm cloud: first fluid-sim plume, then the scaled and frankencloud version | Cumulonimbus, skirt of wispy base | E |
| N3 s183 (video) | Dense grey interior with static detail | Stratus-like interior | I |
| N3 s184 (video) | Rain shaft under a cloud, wet beach, character in front | Cumulus congestus with precipitation | G, day |
| N3 s187 | Cave interior of the stormbird cloud in voxel blocks (debug) | Interior | E |
| N3 s188 (video) | Inside the storm cloud with openings where light gets in, copper and grey | Interior, broken light | I |
| N3 s192, N3 s193–194 | Closing flight over a sunlit cloud sea at dusk; credits over dim grey storm | Cumulus congestus sea | F, dusk |

### 1.2 Authoring and reference clouds (isolated clouds on black, blue gradient or photos)

| Deck, slide | What it shows | Cloud types present |
| --- | --- | --- |
| N3 s1, SY s1 | The studio logo built from cumulus puffs against a dusk sky | Cumulus humilis (chained) |
| N3 s5 | A voxel cloud in the Houdini viewer | cumulus |
| N3 s7, s18 (SY), s64 (videos) | Four simulated "voxel clouds" rotating on black: cauliflower cumuli of different sizes and shapes | Cumulus humilis to congestus, one lumpy and one wispy |
| N3 s8 (video) | Voxel clouds in a 3D viewport with a bounding box slice | Cumulus |
| N3 s17, s21, s24, s25 (videos) | A single broad flat-topped hazy dusk cloud (2.5D envelope example) | Wide cumulus/stratocumulus lens |
| N3 s25 (video, 2nd) | Field of fair-weather cumuli over blue sky and a horizon of flat dark bases (vertical profile 2.5D) | Cumulus humilis/mediocris in a regular field |
| N3 s29, s31 | The same cumulus field with mountain foreground: ambient only, direct only, both | Cumulus mediocris |
| N3 s32–33 | A dark silhouette of a large cumulus tower with skirt, light-probe style | Cumulus congestus |
| N3 s77–81, SY s22, s32–33 | The hero test cloud: flat bottom, heavy left shelf, tower at right; shown as profile and up-rezzed, and its profile/mask views | Cumulus mediocris with a tower |
| N3 s83–84, SY s23–24 (videos) | Real timelapse of billowing cumulus, rendered upside-down | Cumulus congestus (photo) |
| N3 s87, SY s27 (videos) | Real timelapse of small clouds web-like, evaporating | Cumulus fractus, evaporating wisps |
| N3 s93, s96–97, s99–101, s107, s116–121, s129, s191, SY s36–39, s44, s53–59, s70 | Photo and render pairs for noise composites: wispy fractus, billowy cauliflower tops, aerial view of cumulus tops, pool foam | Mostly cumulus; cumulus fractus; real-photo references |
| N3 s102, s105–106 (videos) | Sun-lit inner glow from inside a thick cloud | Cumulus interior |
| N3 s122–124 | Isolated dark and bright cumulus under different lighting (dark base, lit top) | Cumulus mediocris |
| N3 s124–127 | Strongly back-lit cauliflower tower, copper and grey | Cumulus congestus |
| N3 s135 | The mount flying in front of a huge white towering bank | Cumulus congestus |
| N3 s166 | Photo: dark-bottomed congestus with a tunnel hole, stratocumulus layer below | Cumulus congestus, stratocumulus, altocumulus |

### 1.3 Photographs in the SY deck

| Slide | What it shows | Cloud types present |
| --- | --- | --- |
| SY s2 | B&W towering cumulus | Cumulus congestus |
| SY s3 | Portrait of Luke Howard and an engraving of his cloud classification | Cumulus, stratus, cirrus (plus intermediates) |
| SY s5 | Sunny blue sky with a handful of small puffs and haze, plus a contrast-boosted copy to expose condensation | Cumulus humilis, sparse |
| SY s43 | Aerial view of cloud tops, sun behind camera, bright crevasses and dark edges | Cumulus congestus top, stratocumulus |
| SY s50 | Midday grey sky with cumulus and dark bases vs bright sun-side | Cumulus mediocris, stratocumulus |
| SY s52 | Sunset with sun pillar over a tower and cumulus field, render | Cumulus humilis |
| SY s67 | Wide-angle photo at sunset: long dark altocumulus/stratocumulus bank across the sky, gradient from blue to orange, gaps | Altocumulus, stratocumulus, cumulus fractus |
| SY s74, N3 s133 | Day sky with a large towering cumulus, smaller companion cumuli, thin cirrus streaks above | Cumulus congestus, cumulus humilis, cirrus |

## 2. Shape vocabulary: what makes the clouds varied

Observations from the images, with the notes quoted briefly.

### 2.1 Scale range

- A single authored voxel cloud is a few hundred metres wide (about 740 m for
  the "Parkouring" cloud, see nubis-sources.md §2). They are clustered into
  cloudscapes over a 4 km x 4 km x 500 m area [N3 s71].
- The sky has at least four scales at once: tiny puffs and fractus bits at
  distance (N3 s87, s168, s161), mid cumulus at a few hundred metres, giant
  banks and arena-scale rings of storm cloud [N3 s170, s172], plus a high
  cirrus layer (N3 s133, s168).
- 2.5D clouds are mapped over a 16 km area [N3 s16], so the far sky is a
  different density source from the near sky.
- Quote: the hero cloud is placed so it "looks good from the ground from
  multiple angles at all times of day" [N3 s163].

### 2.2 Flat bases at the condensation level

- Almost every cumulus in the decks has a flat, darker underside: s25 (video),
  s29, s31, s77–78, s101, s107, s168. The base is sharp, the top is billowy.
- The vertical-profile method makes this explicit with separate "bottom type"
  and "top type" profile lookups [N3 s18, s17]. The voxel "dimensional profile"
  keeps it by baking a flat base into the modeled data [N3 s77–81].
- Authoring tip for stacking: heights of clouds are offset because "rays that
  just glance along the undersides" are expensive [N3 s153]. In other words,
  the author lifts bases to avoid grazing views, so bases are near but not
  exactly on a single plane.

### 2.3 Rising towers vs spreading tops

- Towers: s66 (tall neck with cap), s77–81 (right-hand tower), s52/s67 (stacked
  congestus), s170 (arena storm).
- Spreading: s17/s21 (wide lens), s50 (flat deck with towers growing out), s40–42
  (cloud sea in valleys), s110 (layered banks).
- Pairs like these coexist in one view in s52, s67, s158. That is the main thing
  our "cloned blob" lacks: a clear difference between growing (rising,
  billowy, hard top) and decaying (spreading, wispy, soft) clouds.
- Physical rule from the author: "layered Wisps and curly distortions form where
  density is decreasing" [N3 s88, SY s28]. See nubis-sources.md §3.

### 2.4 Shear, lean and orientation

- Few decks images show explicit shear. The clearest are the sunset layer in
  SY s67 (long, tilted altocumulus bands), N3 s169 (long stratocumulus bands),
  the cirrus streaks above the day scene (N3 s133, s168) and the storm
  skirt/leaning plume of the small stormbird cloud (N3 s179–182).
- The "tall neck" cloud (N3 s66) and the sketch (N3 s162) show the author
  authoring silhouettes against the sun direction, not shear as such.
- Not stated in the notes: no wind-shear tilt parameter. The voxel clouds are
  static shapes, moved only by pseudomotion of the noise [N3 s173].

### 2.5 Wispy evaporating edges

- Photo and timelapse: N3 s87, s93 (real wisps), SY s27.
- The noise blend goes wispy at the edges of low-density regions [N3 s93–95,
  s100–101]. The composite: low-frequency wisps for structure, high-frequency
  wisps at the outer edge.
- Fractus-like puffs next to solid cumulus are common in the game shots:
  N3 s37, s168, s133.

### 2.6 Clustering, gaps and composition

- The author composes by silhouettes against the sun arc, from the east and
  from the south [N3 s162]. Clouds read as groups with clear sky between.
- Gameplay cloudscape: "multiple times for each cloud formation" combined
  into one scene [N3 s167]; chain along the coast in the overview (s167 video).
- Tunnels and caves for exploration [N3 s163–166], plus a real photo to defend
  the idea [N3 s166].
- Clouds are placed as foreground depth tools. The art director's reply to
  hiding a 200 m mountaintop was "No. Leave it." [N3 s57].
- Text and logos are possible: "you can pretty much make anything including
  writing text in the sky" [N3 s171, s161, s1].

### 2.7 Multiple layers at different altitudes

- Layer 1 (low): cloud sea or fog filling valleys [N3 s40–42, s52, s67, s192].
- Layer 2 (mid): cumulus towers above it [N3 s50, s52, s158].
- Layer 3 (high): altocumulus/cirrus streaks and thin sheets [N3 s41, s132/133,
  s168; SY s67, s74]. These are the 2.5D vertical-profile sky [N3 s14].
- The high layer is never reachable and is cheap (0.54 MB per scape, N3 s146).

### 2.8 Per-type variation

Types seen, by the decks' own images:

| Type | Where |
| --- | --- |
| Cumulus humilis | N3 s1, s161, s168, SY s5 |
| Cumulus mediocris | N3 s25 (video 2), s29, s48, s50, s77–81 |
| Cumulus congestus / towering | N3 s2, s52, s67, s124–127, s132, s152–158, SY s2, s74 |
| Cumulonimbus, isolated | N3 s34, s174–186 |
| Supercell / rotating wall | N3 s34, SY s72 |
| Stratocumulus (layers, bands) | N3 s37, s110, s169, SY s67 |
| Altocumulus | N3 s41, SY s67 |
| Cirrus | N3 s133, s168, SY s74 |
| Cirrostratus / thin veils | not clearly shown |
| Stratus / valley fog / cloud sea | N3 s11, s40–42, s55, s183 |
| Cumulus fractus (broken, evaporating) | N3 s37, s87, s168 |
| Pileus cap, anvil, skirt | N3 s66 (cap), s179–182 (skirt) |
| Mammatus, shelf cloud, arcus | none seen |
| Rain shaft / precipitation | N3 s184 (local weather system) |
| Sun pillar / crepuscular rays | N3 s37, s50, SY s52 |
| Inside-the-cloud | N3 s102, s106, s135, s164–165, s183, s186, s188 |

The per-cloud variation in the game scenes comes from three axes:
*(a)* different authored sources (fluid sims, "frankenclouds": "Frankencloudscapes"
[N3 s3, s63–65]); *(b)* a per-voxel **detail type** (wispy to billowy) and
**density scale** [nubis-sources.md §2]; *(c)* the same cloud re-posed with a
transform, "to create variation without increasing memory" [N3 s169].

## 3. Techniques shown that we may lack

Compared against a one-blob-cloned look. Check each against our code before
building.

### 3.1 Weather and type maps

- 2D "Nubis Data Fields" (NDF) drive the high sky: min height, max height,
  coverage, bottom type, top type (vertical profile) [N3 s15–18]. The envelope
  method uses min height, max height, type, density [N3 s19].
- These are mapped over a 16 km area [N3 s16]. Type changes spatially because
  the top/bottom type values are sampled from the map and used for profile
  lookup textures.
- Not shown in these two decks: the map images themselves, or how they are
  authored. They were in earlier talks (see nubis-classic-lod-notes.md).
- For our system: a 2D type/height/coverage map gives us many cloud types in one
  sky without per-cloud assets. This is the main fix for the "one blob" look.

### 3.2 Cloud library and Atlas (Houdini)

- "I created a library of simulated voxel clouds" and then assembled them [N3 s3].
- Atlas is "a compositing pipeline for voxel data" [N3 s65]. Edits are cutouts,
  erosion, squashing; the cloudscape is baked to one dense grid [N3 s67–68].
- Fluid-sim "Aero" solver grows the clouds [N3 s63–64, s74].
- The shipped sample pack has only two clouds, Parkouring and Stormbird
  (nubis-sources.md §2). We lack a library of more shapes.

### 3.3 2.5D sky vs voxel

- Three systems side by side in N3 s46, s173, s190 (table: evolution,
  time of day, lightning, terrain-cast shadows, flight, freeform modeling).
- Vertical profile: sky only, evolution yes, flight no [N3 s46].
- Voxel: free-form, flight yes, evolution not realtime [N3 s173].
- We should pair a cheap 2.5D high sky (cirrus, altocumulus, distant cumulus
  fields) with voxel hero clouds. That is how every wide shot in the decks is
  built.

### 3.4 Cloud shadows on the ground (what the decks say, exactly)

The honest result: **neither deck explains how ground shadows are done.** There
is no shadow slide, no shadow map image, no "shadow caster" proxy, and no shadow
texture made from the weather map. Everything the decks say:

1. **A capability row, nothing more.** The comparison table has a row
   "Terrain-Cast Shadows" with values No (vertical profile), Yes (envelope),
   Yes (voxel) [N3 s173, s190]. The notes on s173 and s190 do not mention
   shadows at all. The author does not describe the mechanism anywhere.
2. **Implication for the sky layer:** vertical-profile clouds cast **no**
   terrain shadows [N3 s173]. So the high 2.5D sky in the game does not shadow
   the ground. Only the near envelope and voxel clouds do.
3. **Inter-cloud shadows are explained, and they are different.** A voxel
   light grid (256x256x32) holds summed density per cell, filled by marching from
   each occupied voxel toward the sun; the view ray takes two real light
   samples then reads the grid [N3 s113–114]. The notes say: "finally render
   long distance inter-cloud shadows" [N3 s115]; s133 repeats "Those long
   distance shadows make quite a difference", and s134 lists "Better Results:
   Long Distance Shadows" as a result. Cost 0.1 to 0.2 ms, amortized over 8
   frames [N3 s114]. This is cloud-on-cloud and cloud-on-self shadowing inside
   the voxel volume, not ground shadow.
4. **Hint at how the ground is sampled:** the march code stops at "the end of the
   segment or terrain intersection" [N3 s150, code slide],
   so the terrain depth bounds the ray. That is occlusion of clouds by terrain,
   not shadow from clouds onto terrain.
5. **Light grid reuse (our inference, not stated).** The light grid already holds
   summed density along the sun direction at every cell. Sampling the cell at
   the ground (or reading the sun transmittance column from the top) would give
   a ground shadow for free. The slides do not claim this; it is an option for
   us.
6. **Related, for contrast, from our own notes:**
   SkyPro bakes a projected cloud shadow texture: it marches from each shadow-map
   texel toward the sun through the cloud shell and stores `exp(-integratedDensity)`,
   invalidated on camera, light, density change
   ([skypro-demo-reference.md](skypro-demo-reference.md), "Ray marching, lighting,
   shadows"). Takram's route is a separate Beer optical-depth pass
   ([realism-gap.md](realism-gap.md)). Our morphology viewer has ground shadows
   disabled ([morphology-study.md](morphology-study.md)).

What the screenshots do show about ground shadow (visual only): in N3 s37 and
N3 s110 the terrain has large soft light/dark patches and rays, in N3 s115 the
before/after pair shows long shadows between clouds in the sky and on the
landscape beneath. They look like soft, low-frequency cloud-shaped shading with
no hard edges, as expected for a transmittance from a thick volume. I cannot
tell from the images whether a separate shadow texture is used.

**Recommendation:** treat ground shadows as our own design. Cheapest option: reuse
the sun-direction summed-density light grid and add a top-down sampling for
terrain. A SkyPro-style baked shadow map is the safer second option. Leave
vertical-profile (2.5D) layers unshadowed, as the game does.

### 3.5 Other techniques visible in the decks

| Technique | Slide | Note |
| --- | --- | --- |
| Voxel light grid (inter-cloud shadows, ambient) | s113–115, s126–128, s133–134 | In nubis-sources.md §4 |
| SDF sphere tracing + adaptive step | s135–160, SY s78 | In nubis-sources.md §5 |
| Cone-step map for height-field clouds | s38–42 | Samples cluster around clouds, 4.2 ms to 1.3 ms |
| Two-resolution render over depth | s45, s157–160 | Near 480x270, far 960x540 |
| Pseudomotion by scrolling noise | s25, s173 | Voxel clouds are not simulated in realtime |
| Time-of-day cycle on the same cloudscape | s131–133 | Teal night to day to dusk |
| Lightning glow, ground discharge, internal flashes | s130, s178, s183, s186 | See nubis-sources.md §4 |
| Localized rain under a cloud | s184 | "local weather system" from Forbidden West |
| Particles at wing tips on cloud contact | s165 | Gameplay feedback |
| Cloud dissipation on a script event | s176–177 | Fade by authored scale |
| Cloudscape re-posed per cinematic shot by a transform | s169 | Variation for free |
| Cloud tunnels, caves and carved interior | s163–165, s187–188 | Atlas cutouts |
| Sun pillar and crepuscular rays | s37, s50, SY s52 | Post effect, not a cloud feature |
| Cloud sea beneath the camera with terrain poking through | s40–42, s57, s192 | Envelope method plus mountain tops |

## 4. Recommended target scenes (5 to 7)

Each is chosen to force a different system. "Exercises" names our systems; check
names against the repo.

### T1. Fair-weather cumulus field with a high cirrus veil

- **Slides:** N3 s25 (video 2), s29, s31, s168, SY s5, SY s74, N3 s133.
- **Description:** a regular field of flat-based cumulus humilis and mediocris
  over a blue sky, differing sizes, gaps, a few evaporating fractus bits, one
  larger congestus and thin cirrus streaks above. Ground view, midday.
- **Hard parts:** size and spacing variation (not one blob cloned), per-type
  profile, clean flat bases, fractus edges, cloud shadows moving over terrain.
- **Exercises:** type/coverage weather map, vertical-profile layer with type
  lookups, wispy-to-billowy detail blend, ground shadow, LOD for far clouds.

### T2. Dusk cumulus congestus sea, flight view

- **Slides:** N3 s52, s67, s153, s154, s158, s159, s192, N3 s2 (video).
- **Description:** flight at cloud top level among big warm-lit billowy towers
  over a distant cloud sea at sunset, backlit, with sun burst.
- **Hard parts:** several heights in one frame, scale range from near to far, inner
  glow and dark edges, silver lining, aerial perspective colors.
- **Exercises:** voxel/NVDF clouds, light grid, multiple scattering, ray-march
  budget, near/far split, haze.

### T3. Orographic cloud sea in valleys

- **Slides:** N3 s40, s41, s42, s55 (video), s57.
- **Description:** pools of stratus-like cloud between cliffs with peaks and thin
  altocumulus above; samples cluster on clouds.
- **Hard parts:** clouds interacting with terrain height, flat top surface
  with soft side fade, fog-like transition.
- **Exercises:** envelope (min/max height + type + density map), cone-step
  or SDF stepping, terrain depth occlusion, terrain-cast shadows.

### T4. Layered sunset sky: stratocumulus and altocumulus bands with cumulus

- **Slides:** SY s67, N3 s37, s110, s115, s166, s169.
- **Description:** long dark bands across the sky with gaps and warm underlight,
  scattered cumulus below, haze near the horizon, sun rays.
- **Hard parts:** tilted, sheared elongated bands; many scales in one view;
  color from sky and neighbours; long shadows between clouds.
- **Exercises:** type map with directional stretch/shear, 2.5D layers at two
  altitudes, light grid shadows, sky ambient color.

### T5. Superstorm / isolated cumulonimbus with lightning

- **Slides:** N3 s34 (video), s11, s130, s156, s131, s178, s179–182, SY s72.
- **Description:** huge rotating dark mass with red or teal light and lightning;
  a localized small version with plume and wispy skirt.
- **Hard parts:** lightning energy injected into the volume, rotation structure,
  towering top and spread anvil or skirt, rain shaft under it [N3 s184].
- **Exercises:** lightning light volume, vertical profile top/bottom types for
  cumulonimbus, local weather rain, time-of-day tint.

### T6. Tall-neck hero cloud with cap and a tunnel

- **Slides:** N3 s66, s77–81, s163–166, s181.
- **Description:** one hand-built cloud with a flat base, a tall column and a
  capping pileus, with a carved tunnel for fly-through.
- **Hard parts:** authored shape (SDF cutouts), interior lighting changes toward
  the tunnel back, no popping when crossing the surface.
- **Exercises:** NVDF loading, SDF generation, inside-cloud march, detail type
  channel, near-camera noise handling.

### T7. Time-of-day cycle on one cloudscape

- **Slides:** N3 s131–133, s168, s169, s110.
- **Description:** same cloud set at midday, sunset, dusk and night (teal).
- **Hard parts:** consistent look as sun angle changes, sky-driven ambient color,
  horizon haze, no flicker.
- **Exercises:** ambient and direct light accumulation, light grid refresh,
  atmospheric tinting, shadow bake invalidation.

## 5. Summary of top findings

1. **Ground shadows: the decks say almost nothing.** The only explicit statements are the table row "Terrain-Cast Shadows" (vertical profile No, envelope Yes, voxel Yes) [N3 s173, s190] and the voxel light grid that provides long inter-cloud shadows [N3 s113–115, s133–134]. No shadow map, no weather-map shadow texture and no caster proxy is mentioned. We should design our own: reuse the sun-direction summed-density grid, or bake a SkyPro-style projected shadow map. High 2.5D clouds do not shadow the ground in the game.
2. **Shape variety is mostly composition, not noise.** The scenes get variety from (a) separate authored sources, (b) three altitude layers, (c) per-cloud wispy/billowy and density channels, (d) transforms to re-pose the same cloud, and (e) hand-composed silhouettes against the sun arc [N3 s162].
3. **We lack types and layers**: stratocumulus and altocumulus bands, cirrus, valley cloud seas, towering cumulus with caps and skirts, cumulonimbus with lightning. Mammatus, shelf cloud and cirrostratus are not shown in the decks at all.
4. **The type/height/coverage 2D maps are what vary a sky spatially** [N3 s15–19], but the decks do not show the maps. We will have to author them.
5. Most cumulus in the decks have flat bases and billowy tops, with fractus bits beside them.
6. The 41 N3 and 8 SY videos were sampled only at three frames each; motion behaviour (growth, dissipation, flight) is not captured here.
