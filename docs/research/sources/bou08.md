# Interactive multiple anisotropic scattering in clouds (Bouthors, Neyret, Max, Bruneton, Crassin; I3D 2008): shape and surface-detail side
Local: `artifacts/research/papers/bouthors08.pdf` (10 pp) · Dump: `artifacts/research/extracted/bou08/` (text, `png/p003,p004,p005,p007,p008,p010`, `hi200/png/p008.png`) · Tags: shape detail (light is out of scope here) · Status: 🟦 note written (no code in the paper; 0 listings)

Lighting is covered in `frostbite-yusov-hogfeldt.md` (scattering-order analysis, collector areas, 8 order sets). This note covers only what the paper says about **how the cloud shape and its surface detail are represented**. Page numbers are PDF pages.

## In one paragraph
The shape is a **two-scale model**: a low-resolution closed surface mesh carries the large form (5K triangles for the cumulus, 130K for the stratocumulus layer), and a thin **hypertexture layer under that surface** carries every finer frequency. Inside the layer, density is a sigmoid of "signed distance to the mesh surface plus Perlin noise"; deeper than the layer depth `h` the interior is treated as **homogeneous**, so no volume is stored or marched there [p.3-4, p.7]. The point is cost: one thin shell of voxels instead of a full volume, with a crisp, noisy silhouette. The paper gives the **form** of the detail function but almost none of its **parameters**: no amplitude, frequency, octave count, sigmoid width or layer depth `h` is stated. Do not expect constants from this source.

## What the paper says, exactly
- **Representation** [p.4, Fig 6 caption]: a low-resolution mesh gives the outer boundary; a procedural volumetric hypertexture adds detail beneath it down to depth `h`; the core is "considered homogeneous". In Fig 6 the shell of thickness `h` is drawn as a band hugging the mesh on the inside, with the voxel grid drawn only over the part of the cloud near the surface.
- **Why this split** [p.3-4, sec 3.3]: slices/billboards overdraw and blur the silhouette (3D texture memory caps resolution); pure-surface shaders (Gardner 1985, Elinas 2000, Trembilski 2002) fake detail with a transparency shader and have no volume light transport; Bouthors 2006 had no silhouette enrichment so edges looked "polygonal and opaque". The 2008 hybrid keeps the surface's cheapness and adds a real volume only where detail is visible.
- **The detail function** [p.7, sec 8]:
  - `rho(p) = S( D(p) + noise(p) )`
  - `D(p)` is the distance to the surface: 0 on it, **increasing inward**. It is **precomputed and stored as a volumetric texture** (cost of evaluating distance fields); the paper voxelises it with a method from Crassin and Neyret 2007 (a French master's thesis, not available to us), "using only the minimal necessary memory".
  - `S` is "a sigmoid function". No formula, no width.
  - `noise` is "a scalar 3D Perlin noise [Perlin 1985]", **evaluated on the fly in the shader**. Single noise, no octave count, no amplitude, no frequency scale stated. Whether it is signed (-1..1) is not stated; Perlin 1985 noise is signed, so the sum `D + noise` can shift the surface both outward and inward (inference).
  - `rho` is a **modulation factor of the droplet density**: it multiplies `N0` in the droplet size distribution (Eq. 3) and therefore the extinction `kappa = rho * N0 * pi * re^2` (Eq. 4) [appendix A, p.8]. Typical cumulus values given: `re = 6 um`, `gamma = 2`, `N0 = 4e8 m^-3` (the page render prints `4.10^8`, European notation for 4 x 10^8; text extraction drops the superscript and reads "4.108". I computed kappa = 0.045 per m for rho = 1, a free path of about 22 m; treat that number as mine, not the paper's; appendix A also says the modified Mie approximation strips the 5-degree forward peak and halves the density, and does not say whether Eq. 4 already includes that halving, so the effective value may be about 0.023 per m).
- **Where the layer is used** [p.7]: three places, all consistent with the same `rho`:
  1. **Opacity** (6.3): ray-march only through the hypertexture layer, accumulate `exp(-kappa x)` per segment with `kappa` read from the layer. Away from the silhouette and thin parts, high opacity ends the ray near its entry point, so the average march is short.
  2. **Single scattering** (6.2): the per-segment `kappa` is modulated by `rho(p)`.
  3. **Multiple scattering** (6.1): the surface used to find collectors is the **noise-displaced** one. The depth map `Zmin_L` stores "the depth of the first voxel having rho > rho0". So the detail changes where the cloud surface is for lighting, not only for opacity. `rho0` is "a user-defined threshold" that defines the surface everywhere in the paper [p.5, sec 6.1].
- **Cost** [p.7, sec 9]: cumulus = 5K triangles with a **512^3 hypertexture**, **2 fps**; the same cumulus without the procedural noise runs at 10 fps. The paper says the noise and the layer march are about **80% of the render cost** (unoptimised) [p.8, sec 10]. Hardware: 8800 GTS, 800x600. The stratocumulus layer (130K triangles, **no** procedural noise) ran at 10 fps. Cloud animation: re-run the distance-field voxelisation each time the shape changes (Crassin and Neyret) [p.7].
- **Detail needed** [p.2, sec 2.1; p.3, sec 3.3, Fig 5]: real convective clouds are not blurry at the boundary but "usually sharp or wispy"; **collapsing turrets or weak clouds may have a larger wispy layer** [p.2] (i.e. the detail-layer thickness should vary with cloud state; no numbers given). Sub-resolution density variation must be added or the result is "blurry" [p.3]. Fig 5 shows the progression: slices (a, b) blurry; photographs of a **wispy** cloud (c) and a **sharp** one (d); 3D noise advected (e, Schpok) uniform look; procedural surface (f, Gardner) contrasty. Caption: adding procedural detail gives "a less blurry and more contrasted appearance".

## What the hypertexture form means for a density-field detail scheme
`rho = S(D + n)` is an **erosion of a signed-distance field by noise, in length units**. Rearranged, the cloud surface is where `D = -n` (or where `D + n` crosses the sigmoid's centre). So the noise moves the surface along its normal by `n` metres (if `D` is metric). The sigmoid width `w` is the **soft rim width** (also in metres). Both are lengths, independent of the cloud's density.

How that differs from the Nubis chain:

| | Bouthors 2008 | Nubis (shipped) |
| --- | --- | --- |
| Coordinate the noise acts in | signed distance (metres), added | profile value 0..1, `erosion = sat((P - n)/(1 - n))` [s35, `syn.md`] |
| Soft rim | sigmoid on the sum | the profile's own gradient width |
| Frequency control | one Perlin; none stated | channel choice by depth and detail type (R/G wispy, B/A billowy) |
| Depth dependence | implicit: noise only matters where `|D| < noise amplitude` or inside the sigmoid; `D > h` is saturated (homogeneous core) | explicit: `lerp(low-freq, high-freq, profile)` |
| Sign | noise can displace outward or inward | erosion only removes (`n >= 0`) |
| Cost | noise live at 512^3-effective; paper says it dominates | 3D noise tile sampled once per step |

The practical consequences (inference, not stated in the paper):
- **Boundary-layer thickness = what the noise can reach.** A noise of amplitude `A` (in D units) only affects voxels with `D` within about `A` of the surface. A `D` clamp beyond `h = A` plus the rim width lets you stop evaluating noise in the interior. That is the same economy as the "homogeneous core".
- **Detail "depends on distance to the surface" by being added to the distance, not by a separate fade.** Nothing else (no `P^0.25`, no weights) is needed to localise it at the rim.
- **Noise amplitude is a length**, so bump size stays the same on a 200 m and a 2 km cloud. A profile-fraction erosion makes bumps scale with cloud thickness, which is the Nubis/HZD behaviour and one reason tall clouds get over-large bumps.

## Figures that explain shape
| Page | Figure | Use |
| --- | --- | --- |
| p.4 | Fig 6 | Mesh + hypertexture shell of depth `h` + homogeneous core: the cleanest picture of the two-scale model |
| p.3 | Fig 5 (a-f) | Blurry slice clouds vs sharp and wispy real cumulus vs procedural detail; reference for "what detail is for" |
| p.4 | Fig 7 | Slab canonical-transport setup (lighting; not shape) |
| p.1, p.10 | Teaser and Fig 12 | Cumulus with the hypertexture lit by the scattering model; look at silhouette roughness against Fig 5 |

## Code listings
None. The paper has no code and no pseudocode.

## What we already do / don't / try (runtime cross-check)
- **Sky Pro / procedural path already has this structure.** `procErodedDensity` computes `d = smoothstep(-edge, edge, top - erosion - shellHeight) * smoothstep(-edge, edge, shellHeight - erosion)` [`packages/runtime/src/procedural/density.wgsl.ts:125`]: `S` = smoothstep, `D` = vertical distance to the top or base (a height-field proxy), noise = `erosion`. `edge` is the soft width, **shrinking exponentially with height** [`:100`, `edge = spBase.y * exp2(-h * spBase.z)`], which Bouthors does not have (constant `S`). Erosion is one-sided, `dot(field, (0.113, 0.04, 0.02)) * strength * coverage` [`:123-124`], and capped by `0.173 * strength * coverage` for an early-out [`:120-121`].
- **Voxel path has a real SDF but applies noise in profile space.** `valueErosion(profile, noiseComposite)` [`packages/runtime/src/shaders/density.wgsl.ts:65`, helper `common.wgsl.ts:11-13`] is the Nubis form. There is **no metre-scale `S(D + n)` pass** on the SDF.
- **Existing note `procedural-shape.md` M12** already proposes that second pass (`density = S((-sdf + A (n - 0.5)) / w)`, A 2-6 m near camera, w 1-3 m). This note supports it and adds two things it did not have: (1) the paper's surface definition is the `rho > rho0` iso-level of the **noised** density, used for lighting too (`Zmin_L`), so a shadow/light-grid surface should use the eroded density, not the mesh/SDF; (2) the paper shows no parameter values, so A and w remain our tuning, not sourced.
- **Contradiction in `procedural-shape.md` M12:** it cites "B08 section 5, p.5-6". The hypertexture is **section 8, PDF p.7**; section 5 is the canonical light transport. Fix the cite.

**Try next (ours):**
1. Add a signed metre-scale SDF displacement pass on the voxel path at rim only (Bouthors form), distance-faded to 150 m like the Nubis HHF band. Use `n - 0.5` so it can bulge as well as bite; keep Nubis erosion for the body. Source: B08 p.7 + `procedural-shape.md` M12.
2. Bound the noise by `|D| < A + w`; outside that skip the fetch (the paper's homogeneous core). Near-free perf win on the voxel march.
3. Use the eroded density for the surface the light grid / shadow map sees (Bouthors `Zmin_L`); check what our light-grid taps do at the rim.
4. For the height-field shapers, express `erosion` in metres and cap it (Bouthors amplitude-as-length) so tall layers stop getting larger bumps.
5. Decide sigmoid width per rim: Bouthors has constant width; ours shrinks with height (`density.wgsl.ts:100`). A wider rim at the top and base of a turret versus its flank is the unexplored lever.

## Superseded by / supersedes
Supersedes the one-line "Hypertexture section for detail" tracker entry. It does not supersede Perlin and Hoffert 1989 (original hypertexture; on the fetch list in `survey.md`) or Bouthors and Neyret 2004 (shape grammar, same list).

## Review (Opus spot-check, 2026-10-10)
- `rho(p) = S(D(p) + noise(p))`, D = 0 on surface increasing inward, stored as volume texture, noise = scalar 3D Perlin evaluated live [p.7 text + render] → ✔
- `N0 = 4e8 m^-3`, `re = 6 um`, `gamma = 2`, `kappa = rho N0 pi re^2` (Eq. 3-4) [p.8, 200 dpi render] → ✘ fixed: the "4.108" is not an OCR error but the paper's `4.10^8` notation with the superscript lost in extraction; added the appendix's 50%-density caveat to my kappa = 0.045/m (arithmetic re-checked: 0.0452/m, 22.1 m)
- Cumulus 5K tris + 512^3 hypertexture at 2 fps, 10 fps without noise; stratocumulus 130K tris at 10 fps; noise + march 80% of cost; 8800 GTS at 800x600 [p.7 sec 9, p.8 sec 10] → ✔
- `Zmin_L` = depth of first voxel with rho > rho0; rho0 user-defined surface threshold [p.7, p.5 sec 6.1] → ✔
- "sharp or wispy" boundaries cited to p.3 sec 3.3 [p.2 sec 2.1] → ✘ fixed: the quote is on p.2 sec 2.1; added the paper's point that collapsing turrets / weak clouds have a thicker wispy layer (a shape lever)
- Fig 6 caption and p.7 opacity sentence quoted verbatim (over 15 words) [p.4, p.7] → ✘ fixed: paraphrased both
- Crassin and Neyret 2007 is a French master's thesis [p.9 refs] → ✔
- Runtime: `edge = spBase.y * exp2(-h * spBase.z)` at `procedural/density.wgsl.ts:100`; erosion `dot(field, (0.113, 0.04, 0.02))` at `:124`, `0.173` cap at `:120-121`, smoothstep pair at `:125` → ✔ (code also clamps `h >= 0` and `edge >= 0.0001`)
- Runtime: `valueErosion(profile, noiseComposite)` at `shaders/density.wgsl.ts:65`, helper `common.wgsl.ts:11-13` → ✔ (helper comment notes negative inputs inflate, so "erosion only removes" in the table holds only while the composite noise is >= 0)
- Try-next items 1-5: cite B08 / M12 and our own code, none uses Takram or Sky Pro as the correctness reference → ✔ (no reword needed)
