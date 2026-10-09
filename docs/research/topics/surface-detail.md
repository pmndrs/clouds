# Topic guide: surface detail (what makes a cloud surface read as real)

RS-5, 2026-10-10. Everything between "the silhouette is right" and "it looks like the owner's photo": noise textures, the up-rez sampler, distance and sampling limits, the metre-scale rim, detail by surface orientation, and travelling versus boiling detail. Map of all guides: [README.md](README.md). The density chain itself (profiles, coverage, erosion laws, base noise recipes, curl) is in [shape.md](shape.md); weather and layering in [weather.md](weather.md) and [layering.md](layering.md); how to make the volumes in [authoring.md](authoring.md).

**Owner direction (2026-10-10).** The targets are Horizon Zero Dawn (the floor) and the owner's photos, never Takram or Sky Pro. Our `packages/runtime/src/procedural/` is a port of those two, so it shows where we are, not what is right. The two target studies define the detail we must produce: [targets/santa-sleigh.md](../targets/santa-sleigh.md) §5 (D1–D13) and [targets/frog.md](../targets/frog.md) §3 (F1–F10).

## Conventions
- Sources by id (`n3`, `syn`, `noise`, `tvn`, `psrd`, `bou08`, `hag`, `gp7`, `survey`) from `docs/research/sources/`; `[s92]` = slide, `[p.7]` = page. `X/` = `/Users/dex/Developer/WebGPUClouds/artifacts/research/extracted/` (local only).
- Runtime paths are under `packages/runtime/src/`. **V** = the voxel up-rez (`shaders/density.wgsl.ts`, used by the voxel march and the sky layer). **P** = `procedural/` (Takram/Sky Pro port). **G** = the paused NVDF generator (`generate/`).
- Metres assume the target studies' base height H = 1.5 km (±30–40 %). Ratios do not depend on it.
- New measurements made for this guide (scripts in the session scratchpad, see the end): the feature sizes of the shipped Nubis³ noise, and the recipe of the Nubis³ noise generator HDA that ships in our repo.

## 0. In five lines
1. **The photos need a lobe ladder of about 3.5× per level**: ~300 → 70 → 20 m → a 5–10 m fuzz (Santa), ~180 → 50 → 9 m (Frog). Lit edges are 3–12 m wide, shaded undersides 20–40 m (3–6× softer).
2. **Only the bottom two rungs can come from runtime noise.** The shipped Nubis³ billow channels have their energy at ~20–25 m wavelength, with 90 % of the power above 6–8 m (§2.2). The 300 m and 70 m rungs must be in the authored shape (or, procedurally, in the profile/coverage noise). Nubis³ says the same thing: the up-rez carries the surface, the 8 m profile carries the form [n3 s66, s77–79].
3. **At the distances in the photos (4–12 km) our runtime filters the noise away.** The noise MIP constant `k = 0.01` (`runtime.ts:427`) puts the 0.78 m texel at 40 m by 5 km, so the 20 m billows are gone past ~1.2 km (§4.1). Our step is 2.5× the deck's (§4.2). These two are the cheapest, biggest surface-detail wins we have.
4. **Sharpness must depend on orientation**: crisp up/sunward/leading faces, soft and fraying under/lee faces. Nubis has the knobs (detail type, density scale) but sets them by height only; the photos need them set from the surface normal and the shear direction (§6).
5. **Detail must travel with the cloud, not boil.** Our noise is anchored to world space minus one global wind. That is right for the sky-wide field but wrong for any authored body that moves on its own (§7).

## 1. What the photos demand (the spec)
From the two target studies (local photos, 105 mm detail frames). "Native px" = a 105 mm pixel.

| Quantity | Santa's Sleigh (bodies at 5.5–8H ≈ 8–12 km) | Frog (≈ 4.2 km) | Source |
| --- | --- | --- | --- |
| Lobe ladder | ~300 m → 70 m → 15–30 m (3–4× per level); tower knob 450 m, sub-lobes 100–190 m, bumps 10–25 m | 150–200 m → 40–65 m → 5–13 m (≈3.5× per level), a 4th level as edge fuzz | santa §5 D1, D9; frog §3 F1, F2 |
| Biggest lobe / body width | 0.15–0.17 | 0.06–0.08 | santa D1, frog F1 |
| Silhouette bumps | one per 0.2 of the head's length (~420 m apart) | one per 0.077 of width (~190 m apart) | frog §1 |
| Lit edge, 10–90 % | 5–13 native px ≈ 3–12 m | 10–20 px ≈ 3–7 m | santa §5, frog §3 |
| Shaded / underside edge | 29–41 px ≈ 20–40 m | 68–76 px ≈ 20–25 m (dissolving skirt) | same |
| Where texture lives | top 25–35 % of the head and link; whole tower | top fifth and lit rims; lower 60 % smooth | santa §5 smoothness, frog §1 |
| Lit : belly luminance | 2.4 : 1 (backlit head) | 2 : 1 (front-lit) | santa §2.4, frog §1 |

The Frog is the case for **world-anchored detail scale**: the same metres per lobe, so a smaller body shows more lobes (frog F1). A detail scale that is a fraction of the profile (Nubis, HZD) gives bigger bumps on bigger clouds [bou08 inference; shape.md S10].

### The five detail types and how they map
The two studies list 23 detail items. They reduce to five kinds. "P" = can be procedural (runtime noise or analytic fields); "A" = needs authored geometry (or a sim).

| # | Kind (items) | What makes it | P or A | Where in this guide |
| --- | --- | --- | --- | --- |
| 1 | **Cauliflower crust, ~3.5× lobe steps** (D1, D9, D11, F1, F2, F8) | Rungs 1–2 (300/70 m) as nested spheres or sim lobes in the profile; rungs 3–4 (20 m, 5–10 m) from the billow channels plus the HHF fold; resolved only if noise MIP, step and render scale allow; F8's interior shading needs self-shadow at 20–70 m | rungs 1–2 **A** (or a procedural lobe field for the sky); rungs 3–4 **P** | §2, §4, §8 rows 1–3 |
| 2 | **Orientation-dependent sharpness** (D2, D4, D8, F3, F5, F6) | Detail type and density scale set from the normal (down/lee → wispy, low scale; up/leading → billowy); no fake contrast in shadow; a softer metre-scale rim on down faces | **P** (static fields, baked or computed) | §6 |
| 3 | **Sheared, ejected turrets** (D5, D6, D12) | A chain of 3–4 lobes shrinking toward the tail, leaning 30–48° downshear; tip billowy and dense, tail wispy with lower density scale and curl fringes | **A** (shape); the tip/tail detail switch is **P** once type/scale are painted along the chain | §8 row 6; authoring.md §7 |
| 4 | **Non-planar bases, hanging lit lobes** (D3, D4, F6, F10) | A sub-blob hanging 0.2 of body height below the flat base; flat laminar base elsewhere (hard cut softened over ~30 m, faint 5:1 stretched lamina) vs a dissolving skirt (20–25 m fade, downward curl) | chin lobe **A** (or a per-sub-blob base-height field); base treatment **P** | §8 rows 7–8 |
| 5 | **Lit bubbles and merge ridges** (F4, D7, D10) | ~150–200 m sub-spheres that stick out of the parent's shadow; vertical fluting 100–140 m wide (1:3–4) where bodies join; neck domes on the seam | **A** (they must cast and escape shadow; noise cannot) | §8 rows 9–10; authoring.md §4 |

## 2. The detail engine: the Nubis³ up-rez, in metres
The shipped sampler [n3 s81–109, syn s12] erodes an 8 m dimensional profile P with a 128³ four-channel noise tiled every 100 m. Formulas are in [n3.md §3](../sources/n3.md) and [shape.md §6](shape.md); our port is line-for-line (`shaders/density.wgsl.ts:39-76`). What the formulas mean in metres:

### 2.1 How deep can erosion cut?
- Our profile from depth is `sat((d − 1.4)/66)^1.05` (fitted to the pack: `scripts/vdb/nvdf_math.py:213-214`, generator `generate/passes.ts:491`). So P climbs 0 → 1 over the outer ~66 m.
- Billow erosion is capped at 0.3 of the profile range [s98], so billows only bite where P < 0.3: the outer ~21 m. Our `detailBias = 0.5` (`runtime.ts:432`) lifts the cap to 0.45, ~31 m.
- Wisps are uncapped (R/G means ≈ 0.13), so they can cut through the whole 66 m ramp where the noise peaks.
- **Billow relief is therefore at most ~20–30 m deep.** That matches rung 3 (20 m) and is far below rungs 1–2. A 70 m lobe has to be in the profile.

### 2.2 What sizes does the noise hold? (measured)
Spectrum of the pack's `assets/nubis-voxel-clouds/Noise/Examples/TGA/NubisVoxelCloudNoise.*.tga` (the texture our runtime loads; 128³, 100 m tile):

| Channel | Role [s90] | Mean / std | Peak of k·P(k) (wavelength) | 90 % of power above | Autocorr. half-width |
| --- | --- | --- | --- | --- | --- |
| R | LF Curly-Alligator (wispy) | 0.126 / 0.182 | 50 m | 14 m | 14 m |
| G | HF Curly-Alligator (wispy) | 0.135 / 0.181 | 25 m | 6.7 m | 7 m |
| B | LF Alligator (billowy) | 0.389 / 0.210 | 20–25 m | 8.3 m | 7 m |
| A | HF Alligator (billowy) | 0.397 / 0.217 | 20 m | 5.9 m | 4.7 m |

Reading: the billow pair are only ~1.25× apart in scale; "LF→HF over P^0.25" mostly adds fine power, it does not add a rung. The wisp pair are 2× apart. **The noise spans ~6–50 m, centred at 20–25 m.** The HHF fold (×4 apparent frequency [s103]) adds ~5 m creases within 150 m of the camera.

### 2.3 The recipe of the shipped noise (new: read from our repo's HDA)
`assets/nubis-voxel-clouds/Noise/NubisNoiseGenerator.hda` is the **Nubis³** generator (SOP `nubis_noise_generator`, fields `lf_curly_alligator`, `hf_curly_aligator`, `lf_alligator`, `hf_alligator`, 128³, tiling by border blend 0.125). It is a different tool from the 2017 HZD generator in [noise.md](../sources/noise.md), which has no Alligator. Read with hython from the `noise_sample` VOP subnet (all `turbnoise` nodes use type `anoise` = Alligator, 5 octaves; P in the unit tile, centred):

```
// billowy (B, A): inverted Alligator to the 6th, floored by a fine Alligator
B = max( pow(1 - fit(anoise(P-.5, f=3.4, rough .5), .003, .734, 0, 1), 6),  fit(anoise(P-.5, f=26.5, atten .5), 0, 1, .214, 0) )
A = same with f = 5.0 for the first term and the fine term offset by (0,100,0)
// wispy (R, G): Alligator on a curl-displaced position, contrast-stretched, to the 4th
R = pow( sat((an - 0.3)/0.4), 4 ),  an = (anoise(P + 0.01*curl(P, f=3, perlin 3 oct), f=2.294, rough .608) + 0.6)/1.481
G = same with anoise f = 3.9 and curl f = 5, amplitude 0.005
```
So the ladder is set by base frequencies 2.29 / 3.9 (wisps) and 3.4 / 5.0 (billows) per 100 m, plus a shared fine floor at 26.5 (≈ 3.8 m cells, ≤ 0.214 high). Treat exact semantics of `fit` and frequency as read from the network, not re-derived. This gives us the **exact knobs to re-bake a variant** (different ladder, 16-bit, periodic tiling) without guessing; see authoring.md §5.

### 2.4 Status of each step in our runtime
Covered row by row in [n3.md §5](../sources/n3.md) and [n3/slides-075-109.md](../sources/n3/slides-075-109.md). The rows that matter for surface detail:

| Step | Deck | Ours (file:line) | Verdict |
| --- | --- | --- | --- |
| Noise MIP | `log2(1 + d·k)`, k unpublished [s92] | `shaders/density.wgsl.ts:48`, k = 0.01 (`runtime.ts:427`) | **too blurry at range** (§4.1) |
| Wispy / billowy / type | [s95, s98, s100] | `:51-53`, type biased by `wispyBias = 1` (`:42`, `runtime.ts:425`) | match, except the bias (shape.md S5) |
| HHF fold, soften | [s103–104, s109] | `:55-61`, `:70-73`; gate `shaders/march.wgsl.ts:218` | match on ultra/high/medium; a density step on low (§4.3) |
| Erosion amplitude | none | `noise·(1 + detailBias)`, 0.5 (`:64`, `runtime.ts:432`) | deviation (shape.md S5) |
| Erode, S⁴, sharpen | [s107, s109] | `:65-69` | match |
| Fine hero overlay | none (deck rejected sparse) | 4 m bricks within `hero.fineDistance` (`:25-35`; `hero/bricks.ts`) | ahead of the deck; scales erosion by `fineErosion` |
| Sky layer | (2.5D) | same function on an analytic profile (`shaders/sky-layer.wgsl.ts:582`) | inherits every limit above |
| P path | gp7 32³ detail | `.r` of a 32³ R8, near camera only (`procedural/density.wgsl.ts:218-223`) | below the HZD floor; shape.md S1/S2 |

## 3. Noise textures: which one, which ladder, tiling, bit depth
Recipes and the base-noise comparison are in [shape.md §5](shape.md). Decisions for surface detail:

| Option | Ladder | Tiling | Detail role | Verdict |
| --- | --- | --- | --- | --- |
| **Nubis³ Alligator / Curly-Alligator** (pack texture; HDA recipe §2.3) | billows 3.4 → 5 (+26.5 floor), wisps 2.3 → 3.9, 5 octaves each | border blend 0.125 | the voxel up-rez, all distances | **keep as the reference**; re-bake variants from the HDA |
| HZD generator, Perlin-Worley + Worley fBMs [noise] | 1 : 1.7 : 2.3 between channels | 8-corner blend, 25 % border, 58 % of voxels softened | the 2.5D/HZD shaper (shape.md S1–S2) | for the procedural floor, not for the up-rez |
| TileableVolumeNoise [tvn] | doubling (8/16/32 cells) | exact periodic | cross-check, tiling method | use its periodic Worley idea, fix its diagonal feature points |
| psrdnoise [psrd] | any (periods ≤ 289) | exact periodic | bake source; analytic curl; optional near-camera octave | bake tool, and the curl for advected detail (§7); too heavy as a per-sample fBM |
| Houdini `cloudnoise3d` COP (21.0), `worleynoise3d`, VOP `anoise`/`pworleynoise`/`curlnoise` | free | non-periodic (COP) / periodic Worley VOP | authoring-time variants | how we author new channels (authoring.md §4) |

- **Ladder.** The photos want 3.5× steps between *rungs*; inside one noise channel the octaves step by 2 (Houdini turbulence), which reads as fBm texture, not as discrete lobes. Do not try to make the noise carry 3.5× rungs; make the authored shape carry rungs 1–2 and let the noise be rung 3 plus fuzz. If a procedural (sky-wide) path needs rung 2 without authored data, add it as a lobe field at ~70 m in the profile/coverage stage (G's `worleyLobes`, `generate/shaders.ts:107-125`, already does lobes; the HZD shape noise does it with Perlin-Worley) rather than in the up-rez.
- **Tile.** 100 m tiles with 20 m cells repeat 25× across a 2.5 km face. N3 accepted it; check the Frog-distance render for visible repetition before adding a second, rotated fetch (cost).
- **Bit depth.** The pack noise is RGBA8 (n3 §7b). The HHF fold multiplies the slope by 4, so near-camera creases are effectively ~6-bit. The billow channel's `pow(·, 6)` also crushes the dark range. A/B an RGBA16 (or R16 for G/A) bake from the HDA (it writes float VDB) on a close fly-by (n3 range note try-next 5). The 2017 generator's TGA output is premultiplied and wrong for G/B/A; always export EXR/VDB (noise.md).

## 4. Distance and sampling: can the detail reach the screen?
Four limits sit between the noise and the pixel. At the photos' distances, two of ours are the binding ones.

| Distance | Pixel footprint (high preset, see note) | Our noise texel (k = 0.01) | Texel at k = 0.002 | Our step `max(3, 0.2√t)` | Deck step `max(1, 0.08√t)` [s150] |
| --- | --- | --- | --- | --- | --- |
| 1 km | ~1 m | 8.6 m | 2.3 m | 6.3 m | 2.5 m |
| 2.5 km | ~2.5 m | 20 m | 4.7 m | 10 m | 4.0 m |
| 5 km | ~5 m | 40 m | 8.6 m | 14 m | 5.7 m |
| 10 km | ~10 m | 79 m | 16 m | 20 m | 8.0 m |

Note: pixel footprint assumes 2560 px across a ~60° view and the far pass at 0.41 scale (`runtime.ts:71`), i.e. about 1e-3 rad per traced pixel. Texel = 0.78 m × 2^mip. Steps are before the sparse/dense widening (`shaders/march.wgsl.ts:202-210`).

### 4.1 Noise MIP: the biggest single loss
- `mip = log2(1 + d·k) + baseMip` (`shaders/density.wgsl.ts:48`) with `k = 0.01` (`runtime.ts:427`; our guess, the deck does not publish it [s92]). The texel is then 0.78 m × (1 + d·k).
- A 20 m billow needs a texel ≤ 10 m. With k = 0.01 that fails past **~1.2 km**; the 50 m R channel fails past ~3 km. Every Santa and Frog body is 4–12 km away. Our far clouds are eroded by a blurred grey, which is the "soft, plastic" read L1 measured (edge 0.14–0.22 vs the photo's 0.35, `work/reports/L1.md`).
- Matching the texel to the traced pixel gives k ≈ 0.0013; k = 0.001–0.002 keeps 20 m billows to ~5–10 km. The deck says its distance MIP was ~15 % faster than a fixed MIP with no visible change [s92], which suggests a mild k, not ours.
- Cost risk: lower mips mean more cache misses on a 128³ RGBA8 texture (8.4 MB). Measure on the GPU timer.

### 4.2 Step size
- Ours `STEP_MIN 3`, `STEP_SQRT 0.2` (`shaders/march.wgsl.ts:110-111`), ×1.5–2 on medium/low (`runtime.ts:72-73`); the deck's `max(1, 0.08√t)` [s150]. Ours is 2.5× coarser at every distance and crosses the 20 m billow's Nyquist (10 m) at ~2.5 km; the deck stays under 10 m to ~15 km.
- Coarse steps mostly cost interior lobe shading (F8, low-contrast nested billows) and the light taps that separate lobes; silhouettes are protected by the SDF. A/B the deck constants on high/ultra (n3 §9 #2).
- The sky layer's `8 + 0.006t` is 2.7× the HZD `3 + 60d/16384` near the camera (shape.md S9).

### 4.3 The near-camera band (HHF, soften)
- The fold, the soften and the near fade only act inside 150 m [s104, s109]. Our gate `ts < detailDistance` (`shaders/march.wgsl.ts:218`) is 100 m on **low** and 60 m on mobile (`runtime.ts:73-74`), which cuts the 50–150 m ramps mid-way and leaves a dithered density shell (n3 §7d). Fix: gate at `max(detailDistance, 150)` or rescale the ramp.
- Swap test (n3 §7c): the deck's wisps put LF at the thin edge; the narration says HF. A/B `lerp(g, r, P)` against the shipped `lerp(r, g, P)` at 100–300 m.

### 4.4 Render scale and temporal
High traces the far field at 0.41 scale with 4-frame temporal (`runtime.ts:71`). The F2/D9 fuzz octave (5–10 m) is at or below one traced pixel past ~5–10 km. It cannot be resolved there and should fade rather than shimmer: this is what the distance MIP is for once k is right. Up close (< 1 km) the 4 m fine overlay plus HHF carry it.

## 5. Metre-scale rim (Bouthors)
[bou08 p.7]: density `ρ = S(D + noise)` where D is distance to the surface (metres, inward) and S a sigmoid. The noise moves the surface along its normal by a length, and the sigmoid width is the rim width, also a length. No parameters are given (bou08.md). [bou08 p.2] adds that collapsing turrets and weak clouds have a thicker wispy layer.

Why it matters for the photos:
- **World-anchored detail**: bump size in metres, independent of cloud size (the Frog vs Santa argument, §1).
- **An explicit rim width** we can set per orientation: ~3–7 m on lit/up faces, 20–40 m on down/lee faces (the 3–6× ratio). Nubis gets edge width only indirectly (profile slope × noise slope × sharpen exponent).
- **Outward bulges**: `n − 0.5` can add as well as remove, so a fine octave can make the D9/F2 "cotton" fuzz stand proud of a crisp edge instead of only biting into it.

Ours: the voxel path has a real SDF (`r16float`, `resources.ts:29-31`) but applies noise only in profile space (`shaders/density.wgsl.ts:65`). P's Sky Pro shaper has the height-field form of it (`procedural/density.wgsl.ts:100,125`). Recommendation: a rim pass inside ~1–2 km on the voxel path, `ρ' = ρ · S((−sdf + A(n−0.5))/w)` with A ≈ 2–6 m and w set from orientation (§6), using the A channel or the fold for n. Cost: one SDF fetch already done by the march. This is shape.md's S10, owned here (SD6).

## 6. Detail by surface orientation
**What the photos show** (santa §5, frog §3, `cloud-motion-ideas.md` §4): up- and sun-facing and leading surfaces are crisp and billowy; undersides, lee faces and overhang undersides are soft, see-through and fraying (F5 lacy undercut sits high on the body, so height alone puts the switch in the wrong place). Shaded cores read smooth because they get only multiple-scattered light (F3, D2).

**What Nubis gives**: the per-voxel detail type and density scale fields [s80, syn s37–40], painted by artists in Atlas; in the shipped NVDF figures both concentrate at the base (syn.md figures). Our converter derives them from height only (`scripts/vdb/nvdf_math.py:252-262`, `--detail-bottom/--detail-top`), and the runtime then pushes bases wispier again (`wispyBias`, `shaders/density.wgsl.ts:42`). G has a first directional term (top/base/lee from the coverage gradient against the shear, `generate/shaders.ts:183-195`), but G is paused.

**Methods, cheapest first:**
1. **Lighting only, no fakes.** Before adding detail fields, check that shade is flat: no extra AO-like contrast in shadow (frog F3, santa D2). Our ambient floors (`ambientFloor 0.15`) and front glow (`glowFront 1`) flatten crown/base contrast (n3 §9 #6–7). This is lighting.md territory, but it decides whether D2/F3 need any detail change at all.
2. **Bake type and scale from the normal at authoring/convert time.** From the SDF gradient n̂ (we compute the EDT in `vdb_to_nvdf.py` anyway): `type = sat(a + b·n̂.y + c·dot(n̂, lead))`, `scale` lowered where n̂.y < −0.3 (overhang undersides, skirts) and on the trailing side. This is static, costs nothing at runtime, and covers D8, F5, F6, F7. Houdini can author the same as VDB grids and pass them with `--detail-grid/--scale-grid` (`scripts/vdb/vdb_to_nvdf.py:527-528`).
3. **Orientation-dependent rim width** in the Bouthors pass (§5): narrow on up/lit faces, wide on down/lee faces.
4. **Sun term.** The studies say "sunward crisp". Sun direction changes with time of day, so it should not be baked. Most of the sunward crispness is lighting contrast (lit edge against sky) plus growth direction (updrafts face up and into the shear), and both are covered by 1–3. Only if a lit-side A/B still reads soft, scale the fold weight by a sun-visibility term from the light grid (frog F3's fallback).

## 7. Travelling versus boiling
**Owner rule** (`cloud-motion-ideas.md` §3): real detail is carried with the cloud; it almost never changes in place.
- **Ours.** Noise is sampled at `(p − wind)` with one global wind (`shaders/density.wgsl.ts:49`; `runtime.ts:426`), horizontal only like the deck [s91]. For the regional field that is right: G regenerates the field at a voxel-snapped wind offset and anchors the billow noise to it (`generate/evolution.ts:8-12`). **For an authored body moved with `setVolumePosition` (`runtime.ts:764`) or a future per-body velocity, the cloud slides through fixed noise**: detail appears to crawl across the surface. Fix: sample noise in volume-local coordinates plus the wind offset of that volume (one vec3 per volume).
- **Curl.** Nubis³ bakes curl into the wisp channels (§2.3: curl at f 3–5, displacement 0.005–0.01 of the tile) and has no runtime warp [n3 s89]. The P path's 2D turbulence moves the shape lookup too and tears silhouettes (shape.md §7). Keep curl static in the texture.
- **Flow noise.** psrdnoise's `alpha` rotates gradients in place: that is boiling by construction; use it, if at all, as a small perturbation tied to local vorticity [psrd].
- **Per-body evolution** (merge, ejection, roll-back): advected textures [Neyret 2003, survey fetch #6] or playing baked sim frames through `swapVolume` (`runtime.ts:251, 753`). Parked with the motion session; the static directional detail of §6 does not need it.

## 8. Method catalogue
| # | Method | Detail kinds | Sources | Code pointer | Our status | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Up-rez erosion of an 8 m profile (wispy/billowy over P, type blend, S⁴, sharpen) | 1 (rungs 3–4), 2 | n3 s81–109, syn s12 | `X/n3/code/n3-s109.hlsl`, `n3-sampler-full.hlsl` | ported, `shaders/density.wgsl.ts:39-76` | keep; return the two art biases to 0 (shape.md S5) |
| 2 | Distance noise MIP | 1 | n3 s92 | `n3-s092.hlsl` | k = 0.01 (`runtime.ts:427`) | k 0.001–0.002 (SD1) |
| 3 | Adaptive step, 1 m floor | 1 (F8), 2 | n3 s150, s138 | `n3-s150.hlsl` | 2.5× coarser (`shaders/march.wgsl.ts:110-111`) | deck constants on high/ultra (SD2) |
| 4 | HHF fold + soften within 150 m | 1 (fuzz up close) | n3 s102–106, s109 | `n3-s103.hlsl` | match; low/mobile gate bug (`shaders/march.wgsl.ts:218`) | fix the gate (SD4) |
| 5 | Noise texture variant (ladder, 16-bit, periodic) | 1 | n3 s89–90; §2.3 HDA; tvn; psrd | `assets/nubis-voxel-clouds/Noise/NubisNoiseGenerator.hda` | pack RGBA8 as is (`resources.ts:45-48`) | re-bake from the HDA (SD8) |
| 6 | Type and density scale along a sheared chain (tip billowy, tail wispy) | 3 | santa D5–D6; syn s28 | — | none (height-only type) | authoring.md recipe; paint along the chain |
| 7 | Flat laminar base (hard cut, ~30 m softening, 5:1 lamina) | 4 | santa D4; n3 s18 bottom type 0 | `n3-s018-lut-bottom-type.csv` | base fade `nvdf_math.py` (`baseH 0.22`); flat-base wrangle `build_heroes.py:228` | Houdini `cloudclip` + type/scale grids; procedural via bottom type (shape.md S3) |
| 8 | Dissolving skirt / hanging chin lobe | 4 | frog F6, F10; santa D3; n3 s163 (skirt) | — | none | chin = geometry; skirt = low scale + wispy + downward curl, from the normal (§6) |
| 9 | Lit bubbles on shaded faces | 5 | frog F4 | — | none | authored sub-spheres (`cloudshapereplicate` with normal jitter) |
| 10 | Merge fluting and neck domes | 5 | santa D7, D10 | — | none | `cloudshapefromintersection` + stretched billow noise in a merge mask |
| 11 | Detail type and scale from the normal | 2 | santa §6c, frog §5; syn s28; bou08 p.2 | — | G only: `generate/shaders.ts:183-195` | bake at convert time (SD3) |
| 12 | Metre-scale rim `S(D + n)` | 1 (fuzz), 2 | bou08 p.7; `procedural-shape.md` M12 | — | none on V; P Sky Pro form `procedural/density.wgsl.ts:125` | SD6 |
| 13 | Use the eroded density for the light surface | 1 (F8 contrast) | bou08 p.7 (`Zmin_L`); n3 s113–115 | — | light grid reads its own density (`light-grid.ts`) | check what the grid sees at the rim (lighting) |
| 14 | Volume-local noise anchor | all (motion) | owner; survey (Neyret 2003) | — | world − global wind (`shaders/density.wgsl.ts:49`) | SD7 |
| 15 | HZD 2.5D detail for the sky-wide procedural floor | 1, 2 | gp7 p.107–109, hzd15 s32–37, hag eq 13–16 | `X/gp7/code/gp7-p11-13-detail.hlsl` | P `.r` only (`procedural/density.wgsl.ts:218-223`) | shape.md S1, S2, S6 |

## Try next (ranked, for the board)
Acceptance runs on the compare page with a matched camera against the target crops (`X/targets/santa/c*.jpg`, `X/targets/frog/c5xx_*.jpg`, local only), using the target studies' own measures: 10–90 % edge width on lit vs shaded edges (B−R channel, 5 px averaged), smoothness fraction by height band, and silhouette bump spacing. Deck references: n3 s78, s96/s99/s101, s105, s107. Risk: L low, M medium, H high.

| # | What | Why (visual failure fixed) | Sources | Files | A/B acceptance | Risk | Owner input? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **SD1** | **Noise MIP constant** k 0.01 → 0.0015 (A/B 0.001/0.002/0.005) | Far clouds look plastic: the billow noise is filtered to grey past ~1.2 km | n3 s92; §4.1 | `runtime.ts:427` (one number); check `shaders/sky-layer.wgsl.ts:564` uses the same | Santa/Frog framing at 5–10 km: lit-edge width moves toward 3–12 m equivalent, L1 edge score ≥ 0.3; no shimmer in a 10 s pan; GPU timer ≤ +10 % | L | no |
| **SD2** | **Deck step** `max(1, 0.08√t)` on high/ultra | Interior lobes and nested billows (F8) undersampled; 20 m features aliased past 2.5 km | n3 s150, s108 | `shaders/march.wgsl.ts:110-111` | Frog `c573_top` crop: 3 visible billow scales at 10–15 % contrast; cost on the timer, then decide per tier | M (cost) | no |
| **SD3** | **Type and density scale from the surface normal**, baked in the converter (n̂.y, lead/lee vs shear), replacing height-only type; keep `wispyBias` at 0 | Undersides and overhangs as crisp as tops; lacy undercut and skirt missing; bases forced wispy everywhere | santa D2, D8, §6c; frog F3, F5, F6; syn s28; bou08 p.2 | `scripts/vdb/nvdf_math.py:252-262`, `scripts/vdb/vdb_to_nvdf.py` (new `--detail-from normal`); `runtime.ts:425` | Lit vs shaded edge width ratio 3–6× (photo) on a library cloud and a Frog rebuild; smoothness top band < 40 %, lower 60 % > 60 % | L-M | yes: lead direction per asset (shear vector) |
| **SD4** | **HF gate fix** on low (and mobile, deferred) | Dithered density shell at 100 m | n3 s104, s109; n3 §7d | `shaders/march.wgsl.ts:218`, `runtime.ts:73-74` | Fly-through on low: no ring | L | no |
| **SD5** | **Rungs 1–2 in the authored shape, not the noise**: rebuild one Frog hero as a 3-level sphere hierarchy (ratio ~3.5) with no baked fine noise, up-rez only | Our heroes bake 210/70/28 m noise that the 8 m grid cannot hold, and have no 3.5× ladder | n3 s66, s77–79; frog F1; authoring.md §7 | `scripts/vdb/authoring/build_heroes.py` (new recipe) or the new rigs | Silhouette bumps one per 0.077 of width; lobe spectrum peaks at ~180/50 m; side by side with `pano_1600` | M | yes: confirm Frog scale (pano native?) |
| **SD6** | **Metre-scale rim pass** `S((−sdf + A(n−0.5))/w)` within ~2 km, w from orientation | No cotton fuzz on lit edges (D9, F2); bump size grows with cloud size | bou08 p.7; frog F1–F2 | `shaders/density.wgsl.ts` (after `:65`), SDF from `shaders/volume.wgsl.ts` | `c573_top` and `c638_top` crops at 1:1 equivalent; edge 10–90 % 3–7 m lit; cost ≤ +5 % | M | no |
| **SD7** | **Volume-local noise anchor** for authored volumes | Detail crawls across a hero when it moves | owner motion notes; n3 s91 | `shaders/density.wgsl.ts:49`, volume uniform | Move a hero at 10 m/s for 20 s: a tracked lobe keeps its shape (optical flow on two captures) | L | no |
| **SD8** | **Re-bake the noise from the Nubis³ HDA**: RGBA16 and a periodic variant; optional finer billow base (f 5 → 7) | 8-bit banding in the fold; possible tile softness | §2.3; n3 s90, s103; tvn; psrd | new bake script (authoring.md §5), `resources.ts:45-48` | Close fly-by vs n3 s105; spectrum of the new bake vs §2.2 table | L | no |
| **SD9** | **Wisp LF/HF direction A/B** | Wisp edges read too coarse at 100–300 m? | n3 s93, s95; n3 §7c | `shaders/density.wgsl.ts:51` | n3 s96 triplet; santa `c612_ragged` | L | owner judges |
| **SD10** | **Procedural sky-wide detail at the HZD floor** (32³ fBM detail, `h*10` switch, curl on detail only) | P path has `.r`-only detail near the camera only | gp7 p.107–109; hzd15 s32–37 | shape.md S1, S2, S6 | shape.md's acceptance | M | no |

## Open questions for the owner
1. **Distance of interest.** Should "surface detail" be judged at the photos' distances (4–12 km, where SD1/SD2 matter most) or close fly-bys (< 1 km, where the 4 m overlay and HHF matter)? Both are planned; the order changes.
2. **Lead direction.** For SD3 each authored cloud needs a shear/lead vector. Take it from the weather wind, from the asset's own lean, or paint it?
3. **How crisp is crisp?** Lit edges are 3–12 m in metres but only 1–3 traced pixels at 5–10 km. Is a slightly soft far edge acceptable if 1 km views are crisp?

## Scratch files (local, not committed)
Session scratchpad `.../scratchpad/houdini/`: `noise_spectrum.py` (channel spectra, §2.2), `read_n3_hda.py` and `read_n3_sample.py` (HDA network, §2.3), `list_cloud_nodes.py`, `cloud_node_details.py` (authoring.md §4). The tool hook blocked writing into `artifacts/research/extracted/houdini/` from this worktree session; copy them there if wanted.
