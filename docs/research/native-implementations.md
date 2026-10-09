# Native and open-source implementations of HZD/Nubis-style clouds

Research task RS-N, 2026-10-10. Question: who runs "the same clouds as HZD", which of them really do, and which are worth comparing against?

Method: GitHub search API, READMEs, and shader source read through raw files where it was cheap. Nothing was downloaded or run. Anything marked **(README only)** was not checked in code. Quotes are under 15 words.

## Short answer

- **Nobody ships Guerrilla's renderer.** The only official release is the **Nubis Voxel Cloud Pack** (two NVDFs, the voxel noise generator, the 3D noise texture; TGA slices and VDB). It is data and tooling, not a renderer. Schneider announced it with the SIGGRAPH 2023 talk. Everything else is a third-party reimplementation from slides, GPU Pro 7, or the Nubis articles.
- **Faithful to the 2015/2017 weather-map model:** Project-Marshmallow (Vulkan) is the clearest. Unity HDRP is the best maintained and shipped, but it is a lite version of the same family.
- **Faithful to Nubis Cubed (NVDF, SDF stepping, uprez noise):** Cumulus, Frostnova, Volumarcher, and the Vapor UE5 plugin. They are student or hobby code, and all are single-cloud-type in practice.
- **Nothing found implements Nubis Evolved's cirrus recipe, the NE profile tables, or Forbidden West superstorms.** We looked in Unreal, Unity, Godot, Bevy, Vulkan, DX12 and WebGPU.
- **Popular does not mean HZD.** Sunshine Clouds 2 (Godot, 609 stars) has no weather map or cloud types in its compute shader. Unreal's built-in Volumetric Cloud is material-driven and cites neither Horizon nor Schneider.

## Ranked table (most faithful to HZD/Nubis first)

Legend for technique columns: W = weather map channels, T = more than one cloud type or profile, N = Perlin-Worley / Worley shape plus erosion, C = curl, A = anvil, V = NVDF/voxel (Nubis Cubed), L = lighting, R = temporal reprojection. Y = in code, r = README claim only, - = absent or not found.

| # | Project | Engine / API | Licence | Code | W | T | N | C | A | V | R | Maturity | Captures |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | [mccannd/Project-Marshmallow](https://github.com/mccannd/Project-Marshmallow) | Vulkan, C++/GLSL | none stated | open | r | r (nimbus, cumulonimbus, cumulus) | r | r | r | - | r (quarter-res) | 210 commits, 61 stars, last push 2018-12 | Vimeo demo, README images |
| 2 | Unity HDRP Volumetric Clouds ([Unity Graphics](https://github.com/Unity-Technologies/Graphics), `VolumetricClouds/`) | Unity HDRP | Unity Companion License (verify; not an OSS licence) | source readable in the package | Y (coverage, rain, type, max height) | Y (type indexes a LUT) | Y (Worley128 shape + erosion) | - | - | - | Y (accumulation, denoise) | shipped, maintained | any HDRP project; Unity docs |
| 3 | [rubenaryo/Cumulus](https://github.com/rubenaryo/Cumulus) | DX12, HLSL | README badge says MIT; GitHub API lists none, so verify | open | - | - (one blob family) | Y (billow/wispy uprez of NVDF) | - | - | Y (NVDF + SDF + light cache) | - | 126 commits, last push 2025-12 | GIF fly-through, jet trails, day/night |
| 4 | [YueZhang1027/CIS5650-Final-Project-Frostnova](https://github.com/YueZhang1027/CIS5650-Final-Project-Frostnova) | Vulkan | none stated | open | r | r | r (128^3 four-channel noise) | r | - | Y per README (VDB/TGA NVDF input, 256x256x32 light grid, near/far upscale) | r (temporal upscale) | 164 commits, 50 stars, last push 2023-12 | **YouTube**: [Nubis3](https://youtu.be/DjDdMux2X8Y), [Nubis2](https://www.youtube.com/watch?v=Ejm8KpYlGQM) |
| 5 | [Twenmod/Volumarcher](https://github.com/Twenmod/Volumarcher) | DX12 on MiniEngine, OpenVDB | MIT | open | - | - | r (Nubis noise, Houdini) | - | - | Y per article (dense VDB grid, distance-field stepping) | r (jitter + reprojection) | 69 commits, 34 stars | showcase video (per article), hero images; [article](https://www.jacktollenaar.top/articles/clouds.html) |
| 6 | [mxcop/vapor](https://github.com/mxcop/vapor) | **UE 5.6 plugin**, C++/USF | none stated | open, archived 2026-08-10 | - | - | Y (uprez noise, billow only; wispy blend is hardcoded off) | - | - | Y (VDB, SDF, density cache bake) | - (none) | WIP, 55 commits, 17 stars | one banner image |
| 7 | [yangrc1234/VolumeCloud](https://github.com/yangrc1234/VolumeCloud) | Unity built-in pipeline only | MIT | open, author says unmaintained | Y (R coverage, G wetness, B type) | Y (height-density map by type) | Y | Y | - | - | Y | 669 stars, last push 2020-07 | 4 screenshots, frame times |
| 8 | [AmanSachan1/Meteoros](https://github.com/AmanSachan1/Meteoros) | Vulkan | MIT | open | r (credits a weather map, not described) | - | Y (128^3 Perlin-Worley, 32^3 Worley) | Y (128^2) | - | - | Y (1 in 16 pixels per frame) | 227 stars, last push 2019-04 | screenshots only |
| 9 | [joshbrew/webgpu_realtime_clouds](https://github.com/joshbrew/webgpu_realtime_clouds) | **WebGPU**, WGSL | MIT | open | Y (512^2 weather: R coverage, G billow, B optional) | Y (fair/broken/towering Cu, Cb with anvil, rain shelf, stratus, wispy, cirrus, asperitas) | Y (128^3 shape, 32^3 detail) but built from analytic ellipsoids | - (planet gas only) | Y (hand-built) | - | Y (history blend 0.94, 8x8 interleave) | active, last push 2026-10-05 | **demo [site](https://webgpuclouds.netlify.app/)**, 18 screenshots, 3 demo videos |
| 10 | [Faraz-Portfolio/demo-2025-raymarch-clouds](https://github.com/Faraz-Portfolio/demo-2025-raymarch-clouds) and [FarazzShaikh/three-volumetric-clouds](https://github.com/FarazzShaikh/three-volumetric-clouds) | three.js, WebGL | none stated | open, older one archived 2024-09 | - | - | Y (Perlin-Worley) | - | - | - | - | Nubis Evolved "envelope" only; self-described incomplete | demo page, one screen recording |
| 11 | [CaptainProton42/VolumetricCloudDemo](https://github.com/CaptainProton42/VolumetricCloudDemo) | OpenGL, C++/GLSL | none stated | open | r | r | r | r | - | - | - | tiny, 2021 | `demo_preview.png`, a RenderDoc capture |
| 12 | [adrianderstroff/realtime-clouds](https://github.com/adrianderstroff/realtime-clouds) | OpenGL 4.3, Go | MIT | open | r | - | r | - | - | - | - | 34 commits; theory section is a TODO | none |
| 13 | [spencer-melnick/ChaliceUnity](https://github.com/spencer-melnick/ChaliceUnity) | Unity | MIT | open | - | - | Y (custom Perlin/Worley) | - | - | - | "does not work properly" | 64 commits, 1 star | one GIF |
| 14 | [KonaBaker/Aerkanis](https://github.com/KonaBaker/Aerkanis), [Pentalimbed/cloud-render](https://github.com/Pentalimbed/cloud-render) | Vulkan+Slang; D3D11+NanoVDB | none stated | open, early (35 and 32 commits, 0-1 stars) | ? | ? | ? | ? | ? | claim Nubis Cubed | ? | not assessed beyond README | Aerkanis has 6 screenshots |
| 15 | [jiaozi158/UnityVolumetricCloudsURP](https://github.com/jiaozi158/UnityVolumetricCloudsURP) | Unity URP | MIT | open | port of HDRP (same as #2) | same | same | - | - | - | HDRP-style | 520 stars, last push 2025-05 | screenshots |
| 16 | [evroon/bevy-volumetric-clouds](https://github.com/evroon/bevy-volumetric-clouds) | Bevy (Rust/WGSL) | MIT | open | r | r | r | r | r | - | r | 55 stars, last push 2026-08 | one screenshot |
| 17 | [FASTDROPX/BetterVoxels](https://github.com/FASTDROPX/BetterVoxels) ("Nubis Extended") | Minecraft shader pack | Complementary License 1.6 | open | r (highs/lows, humidity) | r (eight types, Cb with anvil) | - | - | r | - | - | 18 commits, 3 stars | three screenshots |
| 18 | [Bonkahe/SunshineClouds2](https://github.com/Bonkahe/SunshineClouds2) | Godot 4.5+ compositor, GLSL compute | MIT | open | **no** | **no** | Y (own noise set, not Perlin-Worley) | Y | - | - | Y (history reprojection) | 609 stars, push 2026-04; popular | 2 YouTube videos, GIFs |
| 19 | Unreal built-in Volumetric Cloud | UE 5 | Epic EULA (source-available to licensees) | no public repo | material-defined | material-defined | material-defined | - | - | - (SVT/VDB route instead) | Y (VolumetricRenderTarget) | shipped | [Epic docs](https://dev.epicgames.com/documentation/en-us/unreal-engine/volumetric-cloud-component-in-unreal-engine) |

Rows 14 to 19 are listed for completeness and are not close to HZD. Other repos seen and dropped: clayjohn's Godot demos (no HZD citation, no weather map), jaagupku, kode80, MagicStones23 and many other Unity raymarchers (generic FBM clouds), Luna5ama/Alpha-Piscium and Spartan Engine (clouds are a side feature; not inspected).

## Notes per entry

### 1. Project-Marshmallow (Vulkan, 2018)

- The README maps closely to HZD 2015/2017: a weather map for coverage and type; height gradients for three types (nimbus, cumulonimbus, cumulus); coverage that grows with height to make anvils; Perlin-Worley plus the Nubis-supplied 3D noise; a 2D curl texture for wisps; a six-cone light march with HG silver lining and powder look; quarter-resolution reprojection. **(README only; I did not open the shaders because the tree listing was truncated.)**
- Gaps: no licence, 2018, Windows-only prebuilt libraries, no NVDF.
- Value: it is the only open code I found that claims *all* of HZD 2015's pieces together, including anvils and curl. Worth reading as a cross-check of our own `procedural/` chain.

### 2. Unity HDRP Volumetric Clouds (shipped, Unity 2021.2+)

Read in `VolumetricCloudsUtilities.hlsl`:
- Cloud map channels: x coverage (squared in the final multiply), y rain clouds (drives extinction), z cloud type, w max cloud height.
- A `_CloudLutTexture` indexed by (type, normalised height) returns density, erosion weight and AO. That is exactly the HZD "type-blended height gradient" idea, in LUT form.
- Shape: `_Worley128RGBA` plus `DensityRemap`. Erosion: a separate 3D texture, optional micro erosion.
- Lighting: two multiple-scattering octaves with dual HG lobes (0.7 forward, 0.7 backward, eccentricity scaled per octave), a powder term, an energy-conserving per-step integral, ambient from SH9 up/down probes.
- Marching: jittered, large steps after 8 empty samples, early exit at 0.003 transmittance, mean depth output.
- **Not present:** curl, anvil shaping (only the max-height cutoff), NVDF, any Evolved/Cubed feature. The default "Simple" preset replaces the map with a constant.
- Value: the only maintained production reference where cloud type is a real per-pixel input. The lighting is close to Nubis 2017/Frostbite. Free to try inside any HDRP project; shadows onto terrain included.
- Caution: the repo licence is the Unity Companion License, not OSS. Reading is fine for comparison; do not copy code.

### 3. Cumulus (DX12, Nubis Cubed)

- Shader read: `ProceduralNVDFSample` has encoded SDF in r, dimensional profile g, detail type b, collision factor a. `GetUprezzedVoxelCloudDensity` blends wispy and billowy erosion by `detailType`. Stepping is `max(SDF distance, adaptive floor)` with a light cache for sun and vertical optical depth. This is very near the Cubed slides.
- Lighting is thinner than the slides: one HG lobe (g 0.75), a single exponential "multiple scattering" term, **no powder**, and no temporal reprojection. Some code paths are unused or may not compile.
- The NVDF is generated procedurally from smooth-minned round cones and vesicas. **One shape family; no weather map, no cloud types.**
- Extras: collision with convex hulls, jet-trail clouds, Bruneton atmosphere, day/night.
- Licence: README badge MIT, but the GitHub API reports none. Verify before reuse.

### 4. Frostnova (Vulkan, Nubis 1/2/3 course project)

- Per the README: Nubis 2 clouds projected onto an atmosphere shell, Nubis 3 voxel clouds from `.vdb` or TGA-slice NVDFs, a 256x256x32 light-density grid, a 128^3 four-channel noise (alligator and curl-alligator, low and high), SDF big steps, near/far split with temporal upscaling, god rays. **(README only; the shader tree was not read.)**
- Value: the best-documented open **Nubis Cubed** project with **video**, and it is built to load the Guerrilla VDB pack. Good for a side-by-side on the pack's two NVDFs.
- Gaps: no licence, 2023, student project.

### 5. Volumarcher (DX12, Breda University)

- Dense OpenVDB voxel grid, Nubis noise from Houdini, sphere tracing against a precomputed distance field, adaptive minimum step, ambient from one precomputed up-ray, an approximated multiple in-scattering, jitter plus reprojection. The renderer is a library with a demo. **(from the author's article; code not read.)**
- MIT, so it is the safest Cubed-style codebase to read.

### 6. Vapor (UE 5.6 plugin, archived)

- The only **Unreal** project found that is actually Nubis Cubed. Reads a VDB (AlligatorNoise.vdb ships in `Resources/`, 31 MB), SDF-steps, and bakes a sun-path and AO cache in 1/8 sub-voxel slices per frame.
- Shader read: density is `saturate(DensityScale * Density)^4` times a profile, then `ValueErosion` with the four packed noise channels. The wispy term is computed but the blend is `lerp(Wispy, Billowy, 1.0)`, so only billowy is used (author left a TODO). Lighting is one HG at g 0.2, an `exp(absorption * anisotropy)` multiscatter, and a power-of-profile ambient. No temporal. One loop (`TracePathDensity`) is dead code.
- No licence stated (the template it came from is MIT). Unfinished.

### 7. yangrc1234/VolumeCloud (Unity)

- Weather map (R coverage, G wetness, B type), a height-density map per type credited to Frostbite, curl offsets, Frostbite multi-scattering, silver lining, aerial tint, and reprojection. Explicitly cites HZD and Nubis, but does not claim to match.
- Built-in pipeline only, unmaintained, 2020. Useful as a readable GPU Pro 7-era design; the "weather map generator" and cloud shadows are still on its TODO list.

### 8. Meteoros (Vulkan, 2019)

- Faithful to the GPU Pro 7 texture set (128^3 Perlin-Worley, 32^3 Worley, 128^2 curl) and the 1-in-16 reprojection. The weather map is a credited texture, not a described system; no cloud types.
- MIT, so it is a clean reading copy of the 2015 pipeline.

### 9. joshbrew/webgpu_realtime_clouds (WebGPU)

- The closest WebGPU peer, and the only one with a real **range of types** (Cu variants, Cb with anvil, rain shelf, stratus, wispy, cirrus, asperitas) plus an evolving weather cycle. Credits Häggström's thesis and does not cite Schneider.
- Shader read (`cloudFields.wgsl`): it shares the weather-driven coverage, shape plus detail erosion, and a baked density volume with HZD. But the shape is built from soft-unioned ellipsoids, hand-placed shoulders and cap fans, not per-type height gradients. It is the same family of ideas, not a reimplementation.
- Lighting: sun-march field, in-scatter and out-scatter HG blend, silver lining, baked AO. Temporal: motion texture, blend 0.94, 8x8 interleave, TAA clamps.
- Most useful for us as a **WebGPU performance and types comparison**, not for HZD faithfulness.

### 10. three.js Nubis Evolved demos (Faraz)

- Envelope generation and erosion following Nubis Evolved, Perlin-Worley 3D texture, adaptive march, multiscatter. Author says it is not a full implementation. Archived 2024-09. A short screen recording only.

### 11 to 13. Small GPU Pro 7 / HZD 2015 ports

- CaptainProton42 (OpenGL, includes a RenderDoc capture), adrianderstroff (Go; theory TODO), ChaliceUnity (Unity; reprojection broken by its own admission). Useful only as extra reading; none documents weather channels.

### 14. Aerkanis, cloud-render

- Both claim Nubis Cubed (Vulkan+Slang; D3D11+NanoVDB with `nubis.dds` loaded as the Cubed detail noise). Too early to assess, and the tree listings were truncated.

### 15. UnityVolumetricCloudsURP

- A port of HDRP's clouds to URP with cookie-based cloud shadows. Treat as HDRP behaviour on a lighter pipeline. Custom cloud map override still WIP.

### 16. bevy-volumetric-clouds

- Claims the HZD method and credits Hillaire as well; sky-dome only, fixed 1920x1080 render, no depth. Not verified in code. Rust/WGSL, so the shaders may be easy to read.

### 17. BetterVoxels "Nubis Extended"

- A Minecraft shader pack. Claims Nubis 2017 and Cubed influence, eight cloud types, a cumulonimbus anvil, a high and low deck, and a weather simulation. Cumulus shape was ported from another shader pack (Photon). The claim is plausible as an art design but it is bound to a game voxel world, and the licence is a custom fork licence. Possible source of screenshots only.

### 18. Sunshine Clouds 2 (Godot)

- The compute shader has a single coverage scalar, a height mask texture, three noise volumes, and a curl texture. There are no cloud types, no weather map, and no multiple scattering. Lighting is single scatter plus a pow-based powder term. It reprojects and accumulates.
- It is popular because it works well in Godot; it is **not** HZD-like. Skip for comparison.

### 19. Unreal built-in and the Fab packs

- Epic's component is a material-driven 3D volume texture march with 0 to 2 scattering octaves, Beer shadow maps, and quarter/half-res tracing. The docs cite neither Horizon nor Schneider, and cloud type is whatever the material does. The 18 sample cloud materials sit in the Volumetrics plugin content.
- Fab packs (Mathew81 "176/185/198 presets" and similar) are closed material presets driven by a grayscale texture. Quick Cloud and SVT Helper use VDB to sparse volume textures. None are Nubis. The Epic forum thread "Implementing the Nubis cloud density model" (2020) reports no visible effect when following the GPU Pro 7 code.
- A 2026 Cinevva blog describes a "Nubis-style" WebGPU renderer (128^3 Perlin-Worley eroded by 32^3 Worley, dual-lobe phase, powder). It links no repository, so it is a claim only.

## Where each is thin against HZD/Nubis

| Feature (from our reference docs) | Anybody implement it? |
| --- | --- |
| Weather channels with per-type profiles | HDRP (LUT), VolumeCloud, Project-Marshmallow (claimed), joshbrew (own scheme) |
| Anvils | Project-Marshmallow (claimed), joshbrew (hand-built); HDRP no |
| Curl distortion | Meteoros, VolumeCloud, Project-Marshmallow, Sunshine Clouds 2 |
| NVDF + SDF stepping + wispy/billowy uprez | Cumulus, Vapor, Frostnova, Volumarcher, Aerkanis (claimed) |
| Nubis Cubed light cache | Cumulus, Vapor, Frostnova (light grid) |
| Nubis Evolved envelope | Faraz demos (partial) |
| Cirrus per NE p.65, NE profile tables, superstorm | **No one found** |
| Mixing NVDF clouds with a weather-map layer (the full Nubis Cubed pipeline) | **No one found**; every Cubed project is one cloud style |

## Worth comparing against

1. **Unity HDRP volumetric clouds.** The only maintained, shipped engine feature where cloud type, coverage and rain are per-pixel inputs, with a LUT of density, erosion and AO per type, 2-octave multiple scattering and temporal accumulation. Easy to run locally with cloud shadows. It tells us what "HZD 2015 in a commercial engine" looks like at its best, and where it lacks curl and anvils. Read-only for licensing reasons.
2. **Frostnova, then Volumarcher.** They are the two open Nubis Cubed implementations that read VDB/NVDF input, so they can be loaded with the same Guerrilla Voxel Cloud Pack assets we already have (`assets/nubis-voxel-clouds/`). Frostnova has YouTube captures we can use as targets today; Volumarcher is MIT and has an article that explains its choices. Use them to judge our NVDF uprez and light sampling.
3. **Project-Marshmallow.** The closest open reproduction of the HZD 2015/2017 weather-map model with cloud types, anvils and curl. Has a Vimeo video. Old, unlicensed, Windows binaries; use as a visual reference for the species' look from that model.
4. **Cumulus**, for Cubed shader structure only. Its NVDF decode, `ValueErosion` and light cache are the cleanest to read. Its lighting is simpler than the slides, so do not use it as a lighting target.
5. **joshbrew/webgpu_realtime_clouds**, as the WebGPU peer. It is the only browser project with many cloud types, anvils and temporal interleave, and has a hosted demo and videos. It is a different construction (analytic ellipsoids), so use it for cost and look comparison, not for formula checks.

Skip: Sunshine Clouds 2, Fab/Unreal preset packs, BetterVoxels, the generic Unity raymarchers.

## Gaps and follow-ups

- The Frostnova, Marshmallow and Meteoros shaders were not read (the tree listings were truncated); open them before relying on any README claim, especially Marshmallow's anvil and type blend.
- Licence for Cumulus needs a look at the repo's LICENSE file.
- To extract captures: Frostnova's two YouTube videos, Marshmallow's Vimeo, the joshbrew demo and videos, and Cumulus GIFs. No frames were taken.
- Not checked: whether Unreal's default cloud material in the Volumetrics plugin is HZD-derived (no source cited).
