# Nubis implementation reference

The code reference for this project. These are our notes, formulas and constants
from Andrew Schneider's talks. Slide numbers are cited so they can be checked.

| Tag | Source |
| --- | --- |
| **N3** | *Nubis Cubed*, SIGGRAPH 2023 Advances (194 slides, Horizon Forbidden West: Burning Shores) |
| **SY** | *Synthesizing Realistic Clouds for Video Games* (83 slides, 2024 overview of the same system) |

- Verbatim slide text, speaker notes and full transcriptions are in
  `artifacts/research/nubis-src/` (gitignored, local working copies).
- The source decks are the user's `.pptx` files.
- Older talks (HZD 2015/2017, Nubis Evolved 2022) are summarized in
  `volumetric.md` and `nubis-classic-lod-notes.md`.

## 1. The system is a family, not a single method

Nubis³ ships three cloud representations side by side [N3 s14, s46, s173]. All
three share one pipeline:

1. Build a low-resolution **dimensional profile**.
2. **Up-rez** it by eroding with 3D noise.
3. Light it with the same model.

| | Vertical profile (2.5D) | Envelope (2.5D) | Voxel (NVDF) |
| --- | --- | --- | --- |
| Use | High clouds you can't reach (skybox) | Orographic clouds you can fly through | Free-form hero cloudscapes, fly-through |
| Inputs | 2D fields: min/max height, coverage, bottom type, top type → profile LUTs | 2D fields: min/max height, type, density | 3D fields: profile, detail type, density scale, plus SDF |
| Evolution | Yes | Pseudomotion | Pseudomotion (realtime evolution is future work) |
| Terrain shadows / lightning / flight | No / Yes / No | Yes / No / Yes | Yes / Yes / Yes |
| Memory per cloudscape [s146] | 0.54 MB | 9.4 MB | 25.2 MB |

**Design consequence for us:** every source (weather maps, voxel fields, authored
VDBs) produces the same triple, *(profile, detail type, density scale)*. The
up-rez, lighting and march are shared.

Vertical profile 2.5D [N3 s18]:

    profile = verticalProfile(bottomType, topType, heightFraction) * coverage

Envelope 2.5D [N3 s20]:

    h = remap(height, minH, maxH, 0, 1)
    profile = pow(h, 2.0) * pow(1 - h, 1.5) * edgeGradient

## 2. Data: NVDF and SDF

- **Modeling NVDF** [N3 s80, SY s21]
  - 512×512×64 voxels at about 8 m, covering about 4 km × 4 km × 500 m [N3 s71–73].
  - Three channels: dimensional profile, detail type, density scale. Shipped as
    BC6 at 1 B/texel, 16.8 MB.
  - The profile is derived from the cloud's SDF, so it is a smooth gradient from
    0 at the edge to 1 at the core [N3 s79, SY s33].
- **SDF** [N3 s140–145]
  - Separate 512×512×64 volume, sampled every step, so kept apart for bandwidth.
  - Range −256 m (inside) to 4096 m, stored normalized 0–1.
  - Shipped as BC1 with a custom 565 scalar encoding at 0.5 B/texel. Decode is
    `dot(rgb, (1, 0.03529415, 0.00069204))`, worth 10–30% of march time.
  - The encoder rounds **down** so the decoded distance never overshoots.
  - *WebGPU:* start with `r16float` or `r16unorm`. BC1 is a later bandwidth
    optimization and needs the `texture-compression-bc` (+ sliced-3D) features.
- **One dense grid**, not many boxes. Switching between voxel boxes in the
  inner loop was slow, so the composited cloudscape is written into a single
  world grid [N3 s67–68]. Sparse formats were rejected only for schedule reasons
  and are called "a good area to explore" [N3 s73].
- **Noise** [N3 s89–90]
  - One 128³ RGBA16 texture, 4.2 MB, tiling every 100 m (`uvw = pos * 0.01`).
  - R = low-frequency *Curly-Alligator* (wispy)
  - G = high-frequency Curly-Alligator
  - B = low-frequency *Alligator* (billowy)
  - A = high-frequency Alligator
  - Alligator is Houdini's Worley-like cellular noise. Curly-Alligator is the
    inverted Alligator distorted with curl noise. These replaced Perlin-Worley
    and inverted Worley, which "looked like packed spheres".
- **Authoring (Atlas, in Houdini)** [N3 s63–67, s161–171]
  - Fluid-sim grown clouds plus voxels, point clouds, meshes and 2.5D data are
    "frankenclouded" together.
  - Edits: cutouts, erosion, squashing.
  - The result is baked into an NVDF.
  - Cinematics move the whole cloudscape with a transform.
- **Official sample data: Nubis Voxel Cloud Pack** [N3 s191]
  - Downloaded 2026-10-08 from `http://bit.ly/NubisVoxelCloudPack` (Google
    Drive `NubisVoxelCloudsPack.zip`, 115 MB, release 2023-08-10).
  - Extracted to `artifacts/research/nubis-pack/`, which is gitignored.
  - The pack has no license file. The project owner treats it as MIT, as
    published with the talk (non-commercial project). A subset is committed
    under `assets/nubis-voxel-clouds/`; see its `NOTICE.md`.
  - Contents:
    - `NVDFs/Examples/{ParkouringCloud,StormbirdCloud}/`
      - `TGA/modeling_data.001–064.tga`: 512×512, RGBA8, z-up slices.
        R = dimensional profile, G = detail type (0 wispy, 1 billowy),
        B = density scale, A unused. Background is G = B = 255.
      - `TGA/field_data.001–064.tga`: the SDF in **R only, 8-bit**, mapped
        0–1 → −256 m … 4096 m. That is a quantum of about 17 m, so the march
        must subtract one quantum to stay conservative, or we regenerate a
        finer SDF on the GPU.
      - `VDB/*.vdb` (47–49 MB): the same fields, possibly at float precision.
        Inspect with the Houdini bridge.
    - Occupancy: each NVDF holds one formation, about 0.3–0.6% of the grid.
      - Parkouring: about 92×92 voxels × 37 slices (~740 m wide).
      - Stormbird: about 67×100 voxels × 54 slices.
      - Crop to the bounds plus an SDF margin for web delivery.
    - `Noise/Examples/TGA/NubisVoxelCloudNoise.001–128.tga`: 128³ RGBA8.
      R/G wispy (mean about 32/255), B/A billowy (mean about 100/255).
    - `Noise/Examples/VDB/NubisVoxelCloudNoise.vdb`: the same noise.
    - `Noise/NubisNoiseGenerator.hda`: the Houdini generator. It has tiling and
      border-blend options. Use it to make our own redistributable noise.
    - `Code Fragments/VoxelCloudSampler.cg`: the shipping sampler helpers. Its
      definitions are folded into §3 below.

## 3. Up-rez density (the runtime density function) [N3 s91–109, SY s12, s34–41]

Inputs: profile `P`, detail type `T`, density scale `S` (from the NVDF), sample
position `x`, and ray distance `d`.

```
x      -= vec3(windOffset.xy, 0) * animSpeed           // pseudomotion, horizontal only
mip     = log2(1 + |d * k|)                            // distance noise LOD, ~15% faster
n       = noise3D(x * 0.01, mip)                       // RGBA as above
wispy   = mix(n.r, n.g, P)
billowy = mix(n.b * 0.3, n.a * 0.3, pow(P, 0.25))     // billows erode less
noise   = mix(wispy, billowy, T)                       // T: 0 wispy … 1 billowy
if d < 150:                                            // near-camera extra detail, no extra fetch
  hhfW  = 1 - pow(|fold2(n.g)|, 4)                     // fold2(v) = |v*2-1|*2-1
  hhfB  = pow(|fold2(n.a)|, 2)
  noise = mix(sat(mix(hhfW, hhfB, T)), noise, remap(d, 50,150, 0.9,1.0))
rho     = erode(P, noise)                              // ValueErosion: sat((P - noise) / (1 - noise))
Sp      = pow(sat(S), 4)
rho     = pow(rho * Sp, mix(0.3, 0.6, max(eps, Sp)))   // sharpen; thins low-density areas
if d < 150:
  f   = sat((d - 50) / 100)
  rho = pow(rho, mix(0.5, 1.0, f)) * mix(0.666, 1.0, f) // soften near camera vs undersampling
rho    *= remap(d, 10, 120, 0.25, 1.0)                 // see through clouds near camera; hides noise crawl
```

Helpers, confirmed by the pack's `VoxelCloudSampler.cg`:
- `ValueRemap` clamps:
  `outMin + sat((v - inMin) / (inMax - inMin)) * (outMax - outMin)`.
- `GetFractionFromValue(v, a, b) = sat((v - a) / (b - a))`.
- `mip = log2(1 + |d * fineDetailMipDistanceScale|) + baseMip`. The scale
  constant is not given.
- Reflection-dome renders skip the up-rez and use `P * S` directly.

- Early-out: if `P == 0`, density is zero and no noise is fetched [N3 s81].
- The sampler returns two values [N3 s82]:
  - **full**: the up-rezzed density, for view and lighting precision
  - **profile**: `P * S`, cheap, used to build the light grid
- The 0.1 HHF blend weight at 50 m looks small. Tune it by eye.
- Physical rule behind the noise [SY s24–28]: falling density gives curly,
  layered wisps (undersides, evaporating edges); rising density gives layered
  billows (tops, growth fronts). Wispy noise is the inverted billowy noise.

## 4. Lighting [N3 s110–134, SY s43–73]

Total light energy = direct + ambient + secondary (lightning).

- **Direct transmittance**
  - Beer–Lambert: `T = exp(-τ)`.
  - The first two light samples are marched normally, for crisp near-surface
    detail.
  - The rest is looked up from a **voxel light grid** of summed density:
    256×256×32, built by marching from each occupied voxel to the grid boundary
    toward the sun.
  - Cost 0.1–0.2 ms, amortized over 8 frames. Render time −40%, and it gives
    long inter-cloud shadows (the old march stopped at 256 m with 10 samples)
    [N3 s113–115].
- **Phase**
  - HG with `g ≈ 0.2`, plus several art-directed lobes for the silver lining
    [SY s51–52]. Weights are not given.
  - The talk suggests baking phase into a 2D LUT.
- **Multiple scattering / inner glow and dark edges** [N3 s116–125, SY s54–64]
  - The profile acts as an in-scatter probability field.
  - Near the surface (little material) gives dark edges; deep inside and
    backlit gives glow, "a flashlight behind cotton".

  ```
  ms = P * exp(-τ_sun * remap(sunDot, 0, 0.9, 0.25, remap(sdf, -128, 0, 0.05, 0.25)))
  ```

  - The extinction is relaxed deep inside (sdf ≤ −128 m → 0.05) and when looking
    toward the sun.
  - **There is no powder term.** This term replaces it.
  - How `ms` combines with direct light and phase is not shown. The author says
    modulating HG by this field is in development.
- **Ambient**:

  ```
  amb = pow(1 - P, 0.5) * exp(-τ_up)
  ```

  where `τ_up` is summed density toward the sky, from the same grid
  [N3 s126–128; SY s68 shows it without the 0.5 power]. Ambient color comes
  from the sky.
- **Lightning** [N3 s130, SY s71]:

  ```
  glow = pow(1 - d/r, 12) * (1 - sat(rho * 5))
  ```

- **Accumulation** [SY s79]
  - Direct and ambient intensity are accumulated separately, front to back,
    then tinted by sun and sky color at the end.
  - We use the energy-conserving exponential segment form (Hillaire 2016)
    instead of the slide's linear alpha.

## 5. Ray march [N3 s135–160, SY s77–81]

```
t = segment.start
while T > limit and t < min(segment.end, maxDist):
  p        = camPos + dir * t
  sdf      = cloudDistance(p)
  adaptive = max(1, sqrt(t) * 0.08)          // 1 m to 156 m, 2 m at 625 m, 4 m at 2.5 km
  step     = max(sdf, adaptive)
  jitter   = (t < 250 ? animatedHash : staticHash) * step
  if sdf < 0: sample(p + dir * jitter)       // jitter moves the sample, not the advance
  t += step
```

- The ray runs from the camera to the nearer of the grid exit and scene depth
  [N3 s147].
- Jitter is animated near the camera (it resolves) and static far away (no
  shimmer).

## 6. Resolution and budget [N3 s44–45, s151–160, SY s80–81]

- **No temporal upscaling for voxel or envelope clouds.** They can't resolve
  under fast flight [N3 s44, s157].
- Instead, two passes: rays nearer than 200 m at 480×270, farther than 200 m at
  960×540. The same frame drops from 4 ms to 2.1 ms. Far needs the higher
  resolution to avoid aliasing; near is where the expensive marching is.
- Temporal amortization over 16 frames is used for the **vertical-profile** sky
  layer (20 ms → 2 ms) [N3 s44].
- Cloud cost on PS5 at 960×540, in ms:

  | View | Base | + voxel light grid | + SDF/adaptive march |
  | --- | --- | --- | --- |
  | Ground | 10 | 6.1 | 2.2 |
  | Between clouds | 12 | 8.2 | 4.0 |
  | Inside | 10 | 8.0 | 4.0 |

- Budget: clouds plus geometry under 10 ms [SY s80].

## 7. Stated future work (our "beyond Nubis³" opportunities)

- Realtime voxel cloud **evolution** and **on-the-fly SDF generation**
  [N3 s173]. WebGPU compute makes this practical for us.
- Sparse voxel storage [N3 s73].
- Modulating the phase function by the in-scatter probability field [SY s60].
- Baking more math into LUTs [SY s13–14].

## 8. Unknowns to resolve by experiment

- The `fineDetailMipDistanceScale` value.
- The sign of `sunDot`, and how `ms` and ambient combine with direct light.
- Light-grid world extent and channel layout (sun τ and up τ).
- Hash type and transmittance limit.
- Whether the pack VDBs carry a float-precision SDF.
