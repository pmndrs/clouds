# Legacy talk (2017) and 2021 survey: targeted findings

Two sources the owner added, read against five questions. Neither is a deep source
for what we are building now, and this note says so where it is true.

| Tag | Source |
| --- | --- |
| **N17** | Schneider and Vos, *Authoring Realtime Volumetric Cloudscapes with the Decima Engine*, SIGGRAPH 2017 (108-page PDF, slides with speaker notes) |
| **GS** | Goswami, *A survey of modeling, rendering and animation of clouds in computer graphics*, The Visual Computer 37 (2021), 1931-1948 (18-page PDF; journal page = PDF page + 1930) |

Page numbers below are **PDF pages** (what the Read tool's `pages` parameter takes).
Quotes are under 15 words. Already covered elsewhere, not repeated: the HZD 2015
density recipe, Nubis Evolved, Nubis Cubed and Synthesizing (see `nubis-sources.md`,
`hzd-nubis-evolved.md`, `deck-scenes.md`, `nubis-classic-lod-notes.md`).

## Verdict up front

- **N17 is the 2015 recipe plus an authoring layer.** It is a short conceptual talk
  and the code is in slide images, not text. Its useful content for us is the
  authoring ideas (Q2), a few lighting tricks (Q4), and the post-process composite
  (Q3). Most of the density and march content is already in our docs.
- **GS is a literature survey, 1980-2019.** It has no game-engine technique we lack.
  It is useful only as a citation list (Q1, Q2, Q3), and as confirmation of what the
  field does not do.
- **Nothing in either source beats our sun-space optical-depth map** (Q1).

## Q1. Ground shadows from distant or 2.5D clouds

**N17: nothing.** A text search for "shadow" returns only the line about shafts of
light. The talk never mentions terrain shadowing from clouds. (The Nubis Cubed table
in `nubis-sources.md` s1 says the vertical-profile 2.5D mode has "No" terrain shadows,
which matches: Guerrilla did not solve this for skybox clouds.)

**GS: nothing usable.** Table 2 (p.9) has a "Shadow" column with only three values:
`Self`, `Ground`, `-`. Exactly one method is marked `Ground`: Bouthors et al. 2006,
stratiform clouds. It models ground-to-cloud inter-reflection by radiosity, not cast
shadows on terrain (p.6: "ground-clouds inter-reflection"). Everything else is
cloud self-shadowing. Relevant older ideas, none better than ours:

- **Shadow-view slices** (Miyazaki 2004, p.6-7): slice the volume along the sun and
  view directions, store attenuation per slice. It is a light-space volume for
  self-shadowing, the ancestor of our light grid, not a ground map.
- **Shadow relation table** (Liao 2008, p.6): a 2D grid giving each voxel its input
  illumination. This is a sun-projected 2D grid, structurally the same as our
  cascaded map, and applied to voxels rather than terrain.
- **Temporal reuse of illumination** (Elek 2012, p.8): keep a low-res grid and
  reshoot a small fraction each frame, "exploited temporal coherence". Our map
  refreshes 1/24 of the rows per frame, which is the same idea in a coarser form.

**Verdict.** Our design (world-anchored toroidal cascades, amortized refresh,
invalidate on sun or weather change) is ahead of both sources. No better technique
here. Two pitfalls these sources hint at, both already in P10-A's open issues:

1. The ground-cloud coupling in Bouthors is two-way. Ground bounce lights the cloud
   underside, which is part of why real undersides are not black. We only do
   cloud-to-ground. See Q4.
2. Surfaces above the shell base over-shadow (P10-A). Neither source offers a fix;
   the 3D or height-split map in P10-A's note remains ours to design.

## Q2. Procedural species shape

Beyond the HZD height gradients, N17 adds an **authoring structure** and a few
behaviours. GS adds a short list of how the older literature models species.

### N17: what is new

- **Cloud map = coverage + type, three channels.** Red and green are two coverage
  noises, blue is type (0 stratus, 0.5 stratocumulus, 1 cumulus) (p.52-58). Our
  weather bake is already this (`hzd-nubis-evolved.md` section 1). New detail: the
  **red channel uses Perlin for connected formations, the green channel uses
  Perlin-Worley for "isolated island like shapes with connective tissue"** (p.55-57).
  A per-species choice between the two footprint noises is cheap and we may not have
  it. This is the only direct hint for *footprint* variety.
- **Footprints come from overlapping air masses.** A low-frequency noise gates where
  clouds may form, higher noises give the footprints inside (p.53-55, p.52 notes).
  Mapping to cell rows or rolls: gate with a low-frequency mask, then stretch the
  footprint noise along the wind (rolls) rather than isotropically. N17 does not do
  the stretch; this is our inference.
- **Weather state = map + extra scalars**: skew, anvil inflation, movement speed and
  direction, density (p.59). These are per-state constants, "treated same at every
  sample", so they cost no texture. A species could be a bundle of these plus a
  type value.
- **Coverage as inflation.** `remap(noise, coverage, 1, 0, 1)` makes clouds inflate
  as coverage rises (p.40-44). A per-cloud coverage, not just a per-map one, is the
  cheap way to get "this cloud is growing, that one is decaying" for 9-D.
- **Anvil.** `pow(coverage, remap(h, 0.7, 0.8, 1, lerp(1, 0.5, anvil_bias)))`
  (p.46-50): the coverage exponent drops near the top, so the top spreads out. The
  wind vector can be varied there to skew anvils "in a direction that is not
  natural" (p.49-50). Already summarised in `hzd-nubis-evolved.md`; noted here as the
  source page.
- **Cumulus as a convection column, wind-skewed with height**:
  `p += height_fraction * wind_direction * 500` (p.45), and the closing observation
  that cumulus clusters merge into stratocumulus "both a sheet and a stack of round
  shapes" (p.18). That sentence is a species rule: stratocumulus = cumulus lobes
  inside a sheet footprint.
- **Cirrus in the shipped game was a 2D texture lookup** and the volumetric
  alto and cirro layers were "experiments" (p.50, p.105). So N17 gives no cirrus or
  altocumulus procedure. The Nubis Evolved NE 65 formula remains the only recipe.
- **Painted overrides.** Any texture can replace the simulated cloud map; the author
  adjusted coverage and type "in an image editor" and, for the boss fight, built a
  "Frankencloudscape" from several weather maps; "I want a hole right here" was
  solved by painting black on the map (p.67-68). This is the 2017 authoring tool: a
  paint layer over the procedural map. There is no type-picker UI beyond the three
  channels and the per-state scalars.
- **Weather scheduler** (p.70-72): states chosen by chance, filtered by time of day
  ("Cumulus clouds usually don't appear in the morning"), blended by a plain lerp
  over 10-30 s, with regional cycles (10 zones plus 70 local ones). Useful as a model
  for T7 and for any species presets we expose.

### GS: species modelling in older work

- **Cirrus is 2D, altocumulus is metaballs, cumulus is a thickness surface**
  (Dobashi 2010, p.4). Their stated reason: cirrus is "thin and seldom contain[s]
  self-shadows". Useful as a justification for a 2.5D cirrus with no light march.
- **Cumulus as a blob hierarchy** (Bouthors and Neyret 2004, p.3): child blobs on
  a parent with field functions for "size, overlap, bottom flatness". This is
  the nearest the survey gets to cauliflower flanks: lobes on lobes, with a flat-base
  control. It matches our 9-D "turrets, then billows, then small cauliflower" plan
  and gives it a pedigree, not a new algorithm.
- **Cylinder look comes from one noise scale.** The survey does not say this; it is
  inference from the blob hierarchy: if lobes are all one size the flank reads as a
  column, so vary lobe radius by a power law down the hierarchy.
- **Rolls and cell rows:** the survey mentions Benard convection once as a way
  to get certain cloud types (Miyazaki, p.12). No procedural detail. Nothing on
  floccus or towering-cumulus flank structure.

**Verdict.** N17 gives authoring ideas (two footprint noises, per-state scalars,
paint override, scheduler) but no new species shape. For cell rows, rolls, floccus
and cirrus fibres, **neither source helps**; keep to NE 65 and our own work.

## Q3. Distant clouds and the horizon

### N17

- **Atmospheric blend factor** (p.100-101). The march writes a 4-channel buffer:
  direct light, atmospheric blend, ambient, alpha. The blend factor is taken **at the
  depth where alpha reaches 0.5**, then "the accumulated atmospheric scattering
  contribution at this depth" is sampled afterwards and used as a lerp between cloud
  colour and sky colour. Our sky layer already applies aerial perspective at the
  mean depth (`applyAerialPerspective(front.rad, front.T, dir, meanFront)` in
  `sky-layer.wgsl.ts`). So the structure exists; Takram beating us at the horizon
  (P8-A) is therefore about **tuning and thinning**, not a missing mechanism.
  Check that our depth is alpha-weighted at the 0.5 crossing and not a mean over the
  whole column, because a mean puts the haze depth too far for thin horizon sheets.
- **Cull below the horizon** (p.98): the cloud sphere "drops below the horizon and
  begins to tile noticeably", so they exclude everything below the vanishing point of
  the spherical volume. 3.34 ms to 1.81 ms. We have a flat plane and a sky dome, so
  the equivalent is making sure the dome stops at the true horizon and the far field
  fades before the tiling is visible.
- **Light shafts as a mask on the Mie term, not added to the scene** (p.102-104):
  render a bright sun highlight where unoccluded, blur it radially, and use it
  "as a mask when we apply the Mie scattering ... only applied [at] larger
  distances". Shafts then match haze colour and never paint over near scenery.
  This ties horizon haze to sun shafts; it is the most reusable idea for the
  atmosphere pass (task 12).

### GS

- **Cloud map for reach to the horizon** (Goswami 2019, p.13): replacing per-parcel
  volume amplification with a precomputed cloud map gave "higher frame rates, more
  realistic cloud shapes and better span, especially toward the horizon." Same idea
  as our weather bake; confirmation, not news.
- **Hierarchical LOD for earth-scale clouds** (Dobashi 2009, p.4): visible blocks
  classified as surface, point or volume to set the level of detail, with
  integrated intensity and opacity precomputed per view and light direction.
  That is the three-tier idea of `nubis-lod.md` (voxel, near sky, far sky).
- **Aerial perspective in the scattering model** (Riley, p.6): treat the atmosphere
  as two particle types, air and moisture, each with its own phase function. This
  matches using Rayleigh plus Mie in the haze, which Takram's atmosphere already does.

**Verdict.** No new LOD or haze trick in either source. The one idea worth taking is
the **sun-shaft mask applied to the Mie haze term**, and the **0.5-alpha haze depth**
as a correctness check. Takram's lead is in its multi-scattered atmosphere LUTs
(P8-A), which neither source describes.

## Q4. Sunset and low-sun lighting

### N17 (p.78-93, the lighting section)

Three tricks, all cheap. Check each against `lighting.wgsl.ts`; Nubis Cubed
replaced some of them (see "overlap" notes).

1. **Two-lobe phase with max()** (p.78-82):
   `max(HG(cos, e), silver_intensity * HG(cos, 0.99 - silver_spread))`, with
   `e = 0.6`. Reason given: the mid-day eccentricity "failed to provide the bright
   highlights around the sun that we needed at sunset"; pushing `e` to 1.0 made clouds
   90 degrees from the sun too dark. The fix is two controls, intensity and spread of
   the second lobe, driven per time of day. Overlap: `nubis-sources.md` already has
   "several art-directed lobes for the silver lining". The only addition is that
   **both controls are meant to be animated with sun elevation**; the video on p.83
   is the time-of-day transition. Worth doing for T7.
2. **Two-Beer multiple-scattering approximation** (p.84-85), after Wrenninge:
   `max(exp(-d), exp(-0.25 d) * 0.7)`. The second term pushes light deeper; its
   weight is faded as the view-to-light angle shrinks, so it acts "only when we look
   away from the sun". Overlap: Nubis Cubed replaced this with the `ms` term in
   `nubis-sources.md` section 4, which is what we implemented. Keep as a fallback for
   the 2.5D sky layer's cheap light samples if they still look flat.
3. **In-scatter probability = depth term x vertical term** (p.88-92):
   `depth = 0.05 + pow(lodded_density, remap(h, 0.3, 0.85, 0.5, 2.0))` and
   `vertical = pow(remap(h, 0.07, 0.14, 0.1, 1.0), 0.8)`. The vertical term makes
   bottoms darker "because there are no strong scattering sources below clouds"
   (p.88). It is the 2017 form of the dark base and dark edge. Superseded by the
   Nubis Cubed profile-as-probability field; the useful fact is the **reason**: bases
   are dark because nothing scatters into them from below. Which leads to the
   gap below.
4. **No clamping, HDR throughout** (p.93). Our pipeline is already HDR; stated for the
   record, and it matters for the sun disk and sunset gain.

### What neither source gives (stated plainly)

- **No warm or purple underside method.** N17 has no sunset colour model beyond the
  phase-function trick above. Sunset colour in Guerrilla's engine came from the
  atmosphere (the `ambient` and `atmospheric blend` channels composited against a
  physical sky), not from cloud-internal tricks. GS, p.6-8, covers only generic
  multiple scattering, and for ground coupling only Bouthors (stratiform, ground
  radiosity, p.6).
- **The only physical hook is ground-to-cloud inter-reflection** (Bouthors 2006,
  p.6): warm or dark ground light fills a stratiform underside. We have none. A
  cheap analogue is to tint the ambient term of cloud undersides with the
  *ground-facing* sky colour at low sun, but that is our inference, not a source
  result.
- **The Takram gap is a transmittance gap.** At 4 degrees the sun's light reaching a
  cloud has passed through a long atmospheric path and is already orange. Colour
  the sun by the transmittance LUT at the cloud's altitude, not at the camera, and
  make the ambient sky term follow the multi-scattered sky radiance near the horizon.
  Neither source says this; it is what Takram does (P8-A).

## Q5. Performance (not already in our docs)

N17 p.95-98 is the whole performance story and is mostly already ours:

| Step | ms (PS4, p.97-98) | Status for us |
| --- | --- | --- |
| Reprojection only | 22 | In use (history/temporal) |
| Adaptive step + LOD | 8.1 | In use (cheap steps in empty space) |
| Light samples only where density is nonzero | 3.34 | Check that it holds in the sky layer |
| Cull below horizon | 1.81 | Equivalent: dome limits |
| Depth cull, conservative `max()` of a low-LOD depth sample | 1.2 | See below |

Two items worth verifying:

- **Conservative depth culling.** Start the march only where the sky is, or "has the
  potential to be un-occluded in the next frame", using a `max()` over a low-LOD
  depth read so thin occluders (trees) moving across a reprojected frame cannot
  expose unmarched pixels (p.98). This is the correct amortization-safe form of depth
  culling for temporal reprojection. Check that our composite depth test uses a
  conservative (max over footprint) value and not a point sample.
GS has nothing new for realtime. Its performance table (p.13-15) covers
2000s-era CPU and GPU methods; the only comparable entry is Goswami 2019 at 3.3 ms
rendering + 1.6 ms animation with a cloud map. The one amortization idea is Elek's
**reshoot a small fraction of photons per frame into a retained low-res grid** (p.8),
which is the pattern our shadow map and light grid already use.

**Verdict.** No new amortization trick in either source.

## Worth doing

Mapped to the plan (`docs/PLAN-2026-10-variety.md`). All small; none is a rewrite.

| Plan task | Item | Source | Effort |
| --- | --- | --- | --- |
| **9-C2** (species look: altocumulus, towers) | Choose the footprint noise per species: Perlin for connected sheets and rolls, Perlin-Worley for isolated cells with connective tissue. Stretch the footprint along the wind for rolls (our inference). | N17 p.55-57 | small |
| **9-C2** | Stratocumulus = cumulus lobes inside a sheet footprint. Use as the definition of the species rule, not a new noise. | N17 p.18 | trivial |
| **9-C3** (cost) | Verify light samples run only at nonzero density in the sky layer, and that depth culling uses a conservative `max()` of a low-LOD footprint. | N17 p.97-98 | check only |
| **9-D** (shape detail) | Per-cloud coverage as inflation (`remap(noise, coverage, 1, 0, 1)`) for rising vs decaying clouds. Cauliflower: lobes on lobes with power-law radii, flat-base control (Bouthors and Neyret). | N17 p.40-44; GS p.3 | small |
| **9-E** (high layer) | Keep cirrus 2.5D with no light march ("seldom contain self-shadows"). Use NE 65 for the formula. Neither source adds fibre structure. | GS p.4; N17 p.50 | none new |
| **10** (shadows) | None. Our map is ahead. Keep the two-way ground coupling idea as a backlog note for 12. | GS p.6 | none |
| **11 T4** (layered sunset) | Animate the second-lobe `silver_intensity` and `silver_spread` with sun elevation; per-state scalars (skew, density, speed) as the species bundle. | N17 p.78-83, p.59 | small |
| **11 T7** (time of day) | Weather-state scheduler pattern: time-of-day gating plus lerp over 10-30 s. | N17 p.70-72 | small |
| **11 T1, T2, T3, T5, T6** | No new content from these sources. | | none |
| **12** (comparison tuning) | (a) Haze depth at the **alpha = 0.5** crossing; verify ours. (b) Sun-shaft mask applied to the Mie haze term, not added to the scene. (c) Colour the sun by transmittance at cloud altitude and ambient by horizon multi-scatter (the Takram sunset gap; inference, not sourced). (d) Optional: ground-bounce tint on cloud undersides, after Bouthors. | N17 p.100-104; GS p.6 | medium |

## Summary

- **N17** is a conceptual talk with a few concrete lighting and composite tricks.
  New for us: two footprint noises, painted override layer, per-state scalars, the
  weather scheduler, animating the silver lobe with sun height, the alpha = 0.5
  haze depth, the shaft-masked Mie haze, and the conservative depth cull. Its
  species content for cirrus and altocumulus is empty: the shipped game used a 2D
  texture for cirrus.
- **GS** is a historical survey and adds no game-grade technique. It confirms that
  cloud-to-terrain shadowing is rarely treated at all, and that our sun-space cascaded
  map is not behind any published method here.
- **Sunset warmth** is not explained by either source. The Takram gap is an
  atmosphere-transmittance and multiple-scattering gap, so the fix belongs in the
  atmosphere work of task 12.
